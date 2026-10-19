import { sql, ensureSchema } from './db.js';
import { SOURCES } from './sources.js';
import { fetchSource } from './feeds.js';
import { rankArticles, rankSources } from './rank.js';

// One daily pass: fetch every feed, store new articles, re-rank the last
// 7 days, re-rank the outlets, and prune anything older than 30 days.
export async function runDailyScrape() {
  const db = sql();
  await ensureSchema();

  await db.query(
    `insert into sources (id, name, domain, homepage, feed_url, weight)
     select * from jsonb_to_recordset($1::jsonb) as x(id text, name text, domain text, homepage text, feed_url text, weight int)
     on conflict (id) do update set name = excluded.name, domain = excluded.domain, homepage = excluded.homepage,
       feed_url = excluded.feed_url, weight = excluded.weight`,
    [JSON.stringify(SOURCES.map(({ feeds, ...s }) => ({ ...s, feed_url: feeds[0] })))]
  );

  const results = await Promise.allSettled(SOURCES.map((s) => fetchSource(s)));
  const fetched = [];
  const status = SOURCES.map((s, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') fetched.push(...r.value);
    return { id: s.id, count: r.status === 'fulfilled' ? r.value.length : 0, error: r.status === 'rejected' ? String(r.reason?.message ?? r.reason).slice(0, 200) : null };
  });
  const unique = [...new Map(fetched.map((a) => [a.url, a])).values()];

  const [{ inserted }] = await db.query(
    `with ins as (
       insert into articles (url, title, summary, image, source_id, published_at)
       select url, title, summary, image, source_id, published_at
       from jsonb_to_recordset($1::jsonb) as x(url text, title text, summary text, image text, source_id text, published_at timestamptz)
       on conflict (url) do update set title = excluded.title, summary = excluded.summary, image = coalesce(excluded.image, articles.image)
       returning (xmax = 0) as is_new)
     select count(*) filter (where is_new)::int as inserted from ins`,
    [JSON.stringify(unique)]
  );

  await db.query(
    `update sources s set last_fetched = now(), last_count = x.count, last_error = x.error
     from jsonb_to_recordset($1::jsonb) as x(id text, count int, error text) where s.id = x.id`,
    [JSON.stringify(status)]
  );

  const recent = await db`select url, title, source_id, published_at from articles where published_at > now() - interval '7 days'`;
  const weights = Object.fromEntries(SOURCES.map((s) => [s.id, s.weight]));
  const { scored, trending } = rankArticles(recent.map((a) => ({ ...a, published_at: new Date(a.published_at).toISOString() })), weights);

  await db.query(
    `update articles a set score = x.score, coverage = x.coverage, kind = x.kind, tag = x.tag, story_id = x.story_id
     from jsonb_to_recordset($1::jsonb) as x(url text, score real, coverage int, kind text, tag text, story_id text) where a.url = x.url`,
    [JSON.stringify(scored.map(({ url, score, coverage, kind, tag, story_id }) => ({ url, score, coverage, kind, tag, story_id })))]
  );

  const ranked = rankSources(SOURCES, scored);
  await db.query(
    `update sources s set rank = x.rank, source_score = x.source_score, articles = x.articles, in_top = x.in_top
     from jsonb_to_recordset($1::jsonb) as x(id text, rank int, source_score real, articles int, in_top int) where s.id = x.id`,
    [JSON.stringify(ranked.map(({ id, rank, source_score, articles, in_top }) => ({ id, rank, source_score, articles, in_top })))]
  );

  // Retention: keep 30 days of articles.
  await db`delete from articles where published_at < now() - interval '30 days'`;
  const errors = status.filter((s) => s.error);
  await db`insert into scrape_runs (inserted, total, trending, errors) values (${inserted}, ${unique.length}, ${JSON.stringify(trending)}, ${JSON.stringify(errors)})`;

  return { fetched: unique.length, inserted, ranked: scored.length, trending, sources: status };
}
