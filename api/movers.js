import { rejectUnknownParams } from '../lib/http.js';
import { yahoo, withLastGood } from '../lib/quotes.js';

// NY Open watchlist: the 5 biggest gainers and losers among US-listed stocks,
// from Yahoo's day_gainers / day_losers screeners (US region, market cap ≥ $2B).
// Large caps (≥ $10B) are preferred so the list is names people follow; the
// smaller ones fill in only when fewer than 5 large caps qualify.
// Before 9:30 ET the screeners still show the previous session's moves, so the
// response says which session the numbers describe. This is what already moved,
// not a forecast. Cached at the CDN for 5 minutes.
const LARGE = 10e9;

const SESSION = { PRE: 'pre', PREPRE: 'closed', REGULAR: 'regular', POST: 'post', POSTPOST: 'closed', CLOSED: 'closed' };

async function screen(id) {
  const d = await yahoo(`/v1/finance/screener/predefined/saved?scrIds=${id}&count=100`);
  return (d?.finance?.result?.[0]?.quotes ?? [])
    .filter((q) => q.quoteType === 'EQUITY' && Number.isFinite(q.regularMarketChangePercent) && Number.isFinite(q.regularMarketPrice))
    .map((q) => ({
      symbol: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      price: q.regularMarketPrice,
      changePct: q.regularMarketChangePercent,
      marketCap: q.marketCap ?? null,
      // Today's volume vs the 3-month average: > 1 means unusually heavy trading.
      relVolume: q.regularMarketVolume && q.averageDailyVolume3Month ? +(q.regularMarketVolume / q.averageDailyVolume3Month).toFixed(2) : null,
      marketState: q.marketState ?? null,
      asOf: q.regularMarketTime ? new Date(q.regularMarketTime * 1000).toISOString() : null,
    }));
}

function top5(list, dir) {
  const sorted = [...list].sort((a, b) => dir * (b.changePct - a.changePct));
  const large = sorted.filter((q) => q.marketCap >= LARGE);
  return (large.length >= 5 ? large : [...large, ...sorted.filter((q) => !(q.marketCap >= LARGE))]).slice(0, 5);
}

async function load() {
  const [up, down] = await Promise.all([screen('day_gainers'), screen('day_losers')]);
  const session = SESSION[up[0]?.marketState ?? down[0]?.marketState] ?? null;
  return {
    updated_at: new Date().toISOString(),
    session,
    // Regular-session % changes; outside market hours they describe the last completed session.
    basis: session === 'regular' ? 'today' : 'last session',
    asOf: up[0]?.asOf ?? down[0]?.asOf ?? null,
    universe: up.length + down.length,
    gainers: top5(up, 1),
    losers: top5(down, -1),
  };
}

export default async function handler(req, res) {
  if (rejectUnknownParams(req, res)) return;
  try {
    const data = await withLastGood('movers', load, (d) => d.gainers.length && d.losers.length);
    res.setHeader('Cache-Control', data.stale ? 'public, s-maxage=60' : 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (err) {
    console.error('movers failed', err.message);
    res.status(502).json({ error: 'movers unavailable' });
  }
}
