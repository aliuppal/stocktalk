import { sql } from './db.js';

// Market data from Yahoo Finance's public chart and screener endpoints (no API key).
// Each symbol is fetched on its own so one bad symbol only blanks its own tile.
// Yahoo sometimes rate-limits cloud IPs, so every endpoint keeps its last good
// answer in Neon (`market_cache`) and serves it, marked stale, when Yahoo refuses.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

export async function yahoo(path) {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const r = await fetch(host + path, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`yahoo ${r.status}`);
      return await r.json();
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

// What the chart's numbers mean right now: 'pre' (before the 9:30 ET open),
// 'regular', 'post' (after the 4:00 ET close) or 'closed' (overnight/weekend).
function sessionOf(meta, now = Date.now() / 1000) {
  const p = meta.currentTradingPeriod;
  if (!p?.regular) return 'closed';
  if (now >= p.regular.start && now < p.regular.end) return 'regular';
  if (p.pre && now >= p.pre.start && now < p.pre.end) return 'pre';
  if (p.post && now >= p.post.start && now < p.post.end) return 'post';
  return 'closed';
}

// One instrument: last price, change vs the previous close, and an intraday
// sparkline (≤ 48 points) of the latest session.
export async function quote(symbol, { name, spark = false } = {}) {
  const d = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`);
  const res = d?.chart?.result?.[0];
  const meta = res?.meta;
  if (!meta || !Number.isFinite(meta.regularMarketPrice)) throw new Error(`${symbol}: no price`);
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  const price = meta.regularMarketPrice;
  const out = {
    symbol, name: name ?? meta.shortName ?? symbol, price, prevClose: prev ?? null,
    change: prev ? price - prev : null,
    changePct: prev ? ((price - prev) / prev) * 100 : null,
    session: sessionOf(meta),
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
  if (spark) {
    const closes = (res.indicators?.quote?.[0]?.close ?? []).filter(Number.isFinite);
    const step = Math.max(1, Math.ceil(closes.length / 48));
    out.points = closes.filter((_, i) => i % step === 0 || i === closes.length - 1).map((v) => +v.toFixed(2));
  }
  return out;
}

// Many instruments in parallel; failures are dropped (and logged), not fatal.
// list: [[symbol, displayName, { spark?, meta? }], ...]; `meta` is merged into the result.
export async function quotes(list) {
  const results = await Promise.allSettled(list.map(([symbol, name, opts = {}]) => quote(symbol, { name, spark: opts.spark })));
  return results.flatMap((r, i) => {
    if (r.status === 'fulfilled') return [{ ...r.value, ...(list[i][2]?.meta ?? {}) }];
    console.warn(`quote ${list[i][0]} failed:`, r.reason?.message);
    return [];
  });
}

// ---------- last-good cache in Neon ----------
// Runs `load()`; on success stores the result under `key`. On failure, or when
// `isUsable(result)` is false, returns the stored copy with stale: true.
export async function withLastGood(key, load, isUsable = () => true) {
  let fresh = null, error = null;
  try { fresh = await load(); } catch (err) { error = err; }
  let db = null;
  try {
    if (process.env.DATABASE_URL) {
      db = sql();
      await db`create table if not exists market_cache (key text primary key, data jsonb not null, fetched_at timestamptz not null default now())`;
    }
  } catch (err) { console.warn('market cache unavailable:', err.message); db = null; }
  if (fresh && isUsable(fresh)) {
    if (db) await db`insert into market_cache (key, data, fetched_at) values (${key}, ${JSON.stringify(fresh)}, now())
      on conflict (key) do update set data = excluded.data, fetched_at = excluded.fetched_at`.catch((err) => console.warn('cache write failed:', err.message));
    return { ...fresh, stale: false };
  }
  if (db) {
    const [row] = await db`select data, fetched_at from market_cache where key = ${key}`.catch(() => []);
    if (row) return { ...row.data, stale: true, cached_at: new Date(row.fetched_at).toISOString() };
  }
  throw error ?? new Error(`${key}: no usable data`);
}
