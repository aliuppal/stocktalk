import { rejectUnknownParams } from '../lib/http.js';
import { sql } from '../lib/db.js';

// Economic calendar: this week's high- and medium-impact (red and orange folder) US events from the
// Forex Factory calendar feed. The feed rate-limits hard (429), so the last good
// copy lives in Neon: it is re-fetched at most once an hour and served stale if
// the feed refuses. The feed only publishes the current week.
const FEED = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const UA = 'Mozilla/5.0 (compatible; StockTalkBot/1.0; +https://github.com/aliuppal/stocktalk)';
const REFRESH_MS = 60 * 60 * 1000;
// Bump when the event filter changes so a cached copy built with the old filter is ignored.
const CACHE_ID = 2;

async function fetchFeed() {
  const r = await fetch(FEED, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`calendar feed ${r.status}`);
  const all = await r.json();
  if (!Array.isArray(all) || !all.length) throw new Error('calendar feed returned no events');
  const times = all.map((e) => Date.parse(e.date)).filter(Number.isFinite);
  return {
    week_start: new Date(Math.min(...times)).toISOString(),
    week_end: new Date(Math.max(...times)).toISOString(),
    source: 'Forex Factory economic calendar',
    events: all
      .filter((e) => (e.impact === 'High' || e.impact === 'Medium') && e.country === 'USD' && Number.isFinite(Date.parse(e.date)))
      .map((e) => ({ title: e.title, country: e.country, date: e.date, impact: e.impact, forecast: e.forecast || null, previous: e.previous || null }))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
  };
}

export default async function handler(req, res) {
  if (rejectUnknownParams(req, res)) return;
  const db = sql();
  await db`create table if not exists calendar_cache (id int primary key, data jsonb not null, fetched_at timestamptz not null)`;
  const [cached] = await db`select data, fetched_at from calendar_cache where id = ${CACHE_ID}`;
  const age = cached ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;

  let data = cached?.data ?? null, fetchedAt = cached?.fetched_at ?? null, stale = false;
  if (age > REFRESH_MS) {
    try {
      data = await fetchFeed();
      fetchedAt = new Date().toISOString();
      await db`insert into calendar_cache (id, data, fetched_at) values (${CACHE_ID}, ${JSON.stringify(data)}, ${fetchedAt})
               on conflict (id) do update set data = excluded.data, fetched_at = excluded.fetched_at`;
    } catch (err) {
      console.warn('calendar refresh failed, serving cached copy:', err.message);
      stale = true;
    }
  }

  if (!data) return res.status(502).json({ error: 'calendar unavailable' });
  res.setHeader('Cache-Control', stale ? 'public, s-maxage=300' : 'public, s-maxage=900, stale-while-revalidate=3600');
  res.status(200).json({ ...data, updated_at: new Date(fetchedAt).toISOString(), stale });
}
