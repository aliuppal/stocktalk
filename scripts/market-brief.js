// Collects today's facts from the live StockTalk APIs into one JSON brief.
// The blog routine writes ONLY from this file, so every number in a post is
// traceable to a real source. Usage: node scripts/market-brief.js > brief.json
const BASE = process.env.STOCKTALK_URL || 'https://stocktalk-rosy.vercel.app';

async function get(path) {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return await r.json();
  } catch (err) {
    console.error(`warn: ${err.message}`);
    return null;
  }
}

const [news, prices, radar, movers, calendar] = await Promise.all([
  get('/api/news'), get('/api/prices'), get('/api/radar'), get('/api/movers'), get('/api/calendar'),
]);
const now = new Date();
const r2 = (n) => (Number.isFinite(n) ? +n.toFixed(2) : null);
const etDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);   // YYYY-MM-DD
const etTime = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d);
const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now);
const find = (list, short) => list?.find((q) => q.short === short) ?? null;

const quote = (q) => q && { name: q.name, symbol: q.short, level: r2(q.price), change: r2(q.change), change_pct: r2(q.changePct), as_of: q.asOf };
const today = etDate(now);
const events = (calendar?.events ?? []).map((e) => ({ title: e.title, date_et: etDate(new Date(e.date)), time_et: etTime(new Date(e.date)), forecast: e.forecast, previous: e.previous }));
const tnx = find(prices?.macro, 'US10Y');
const pick = (m) => m && { symbol: m.symbol, name: m.name, price: r2(m.price), change_pct: r2(m.changePct), market_cap_billions: m.marketCap ? +(m.marketCap / 1e9).toFixed(1) : null, rel_volume: m.relVolume };

const brief = {
  generated_at: now.toISOString(),
  date_et: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' }),
  date_iso_et: today,
  time_et: etTime(now),
  is_weekday: !['Sat', 'Sun'].includes(etDay),
  // 'pre' before 9:30 ET: index levels are the LAST CLOSE and their change is the last session's move; futures are live.
  session: prices?.session ?? null,
  sources: 'Yahoo Finance (indices, futures, VIX, yields, dollar, commodities, sector ETFs, movers), Forex Factory (US economic calendar), 12 US market newsrooms via StockTalk',
  data_is_stale: Boolean(prices?.stale || radar?.stale || movers?.stale),
  indices: prices?.indices?.map(quote) ?? null,
  futures: prices?.futures?.map(quote) ?? null,
  vix: quote(find(prices?.macro, 'VIX')),
  ten_year_yield: tnx && { yield_pct: r2(tnx.price), change_bp: Number.isFinite(tnx.change) ? Math.round(tnx.change * 100) : null },
  dollar_index: quote(find(prices?.macro, 'DXY')),
  gold: quote(find(prices?.macro, 'GOLD')),
  wti_crude: quote(find(prices?.macro, 'WTI')),
  sectors: radar ? { up: radar.up, total: radar.total, ranked: radar.sectors.map((s) => ({ name: s.name, etf: s.symbol, change_pct: r2(s.changePct) })) } : null,
  // basis 'last session' = these are the previous trading day's biggest moves (the screener resets at the open).
  movers: movers ? { basis: movers.basis, universe: 'US-listed stocks, market cap >= $10B preferred', gainers: movers.gainers.map(pick), losers: movers.losers.map(pick) } : null,
  economic_calendar: calendar ? {
    today: events.filter((e) => e.date_et === today),
    rest_of_week: events.filter((e) => e.date_et > today),
  } : null,
  trending: news?.trending ?? [],
  top_stories: (news?.stories ?? []).slice(0, 12).map((s) => ({
    title: s.title, url: s.url, source: s.source, published_at: s.published_at, tag: s.tag, outlets_covering: s.coverage,
    also: (s.also ?? []).map((a) => ({ source: a.source, url: a.url })),
  })),
};

process.stdout.write(JSON.stringify(brief, null, 2) + '\n');
