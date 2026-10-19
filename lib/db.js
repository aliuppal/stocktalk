import { neon } from '@neondatabase/serverless';

let client;
export function sql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  return (client ??= neon(process.env.DATABASE_URL));
}

export async function ensureSchema() {
  const db = sql();
  await db`create table if not exists sources (
    id text primary key, name text not null, domain text not null, homepage text not null, feed_url text not null,
    weight int not null, rank int, source_score real, articles int default 0, in_top int default 0,
    last_fetched timestamptz, last_count int default 0, last_error text)`;
  await db`create table if not exists articles (
    url text primary key, title text not null, summary text, image text,
    source_id text not null references sources(id) on delete cascade,
    published_at timestamptz not null, fetched_at timestamptz not null default now(),
    kind text not null default 'companies', tag text not null default 'Companies',
    coverage int not null default 1, score real not null default 0)`;
  await db`alter table articles add column if not exists story_id text`;
  await db`create index if not exists articles_score_idx on articles (score desc)`;
  await db`create index if not exists articles_published_idx on articles (published_at desc)`;
  await db`create table if not exists scrape_runs (
    id serial primary key, ran_at timestamptz not null default now(), inserted int, total int, trending jsonb, errors jsonb)`;
}
