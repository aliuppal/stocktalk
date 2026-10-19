import { rejectUnknownParams } from '../lib/http.js';
import { quotes, withLastGood } from '../lib/quotes.js';

// Index board + ticker: the four US indices (with intraday sparklines), their
// futures (live before the 9:30 ET open), and the macro gauges equities trade off.
// Cached at the CDN for 5 minutes; last good copy served if Yahoo refuses.
const INDICES = [
  ['^GSPC', 'S&P 500', { spark: true, meta: { short: 'SPX' } }],
  ['^IXIC', 'Nasdaq Composite', { spark: true, meta: { short: 'IXIC' } }],
  ['^DJI', 'Dow Jones', { spark: true, meta: { short: 'DJIA' } }],
  ['^RUT', 'Russell 2000', { spark: true, meta: { short: 'RUT' } }],
];
const FUTURES = [
  ['ES=F', 'S&P 500 futures', { meta: { short: 'ES' } }],
  ['NQ=F', 'Nasdaq 100 futures', { meta: { short: 'NQ' } }],
  ['YM=F', 'Dow futures', { meta: { short: 'YM' } }],
  ['RTY=F', 'Russell 2000 futures', { meta: { short: 'RTY' } }],
];
// ^TNX quotes the 10-year yield in percent (4.21 = 4.21%), so its move is shown in basis points.
const MACRO = [
  ['^VIX', 'VIX volatility index', { meta: { short: 'VIX' } }],
  ['^TNX', '10-year Treasury yield', { meta: { short: 'US10Y', unit: 'yield' } }],
  ['DX-Y.NYB', 'US dollar index', { meta: { short: 'DXY' } }],
  ['GC=F', 'Gold', { meta: { short: 'GOLD' } }],
  ['CL=F', 'WTI crude oil', { meta: { short: 'WTI' } }],
];

async function load() {
  const [indices, futures, macro] = await Promise.all([quotes(INDICES), quotes(FUTURES), quotes(MACRO)]);
  const spx = indices.find((q) => q.symbol === '^GSPC');
  return { indices, futures, macro, session: spx?.session ?? null, updated_at: new Date().toISOString() };
}

export default async function handler(req, res) {
  if (rejectUnknownParams(req, res)) return;
  try {
    const data = await withLastGood('prices', load, (d) => d.indices.length >= 2);
    res.setHeader('Cache-Control', data.stale ? 'public, s-maxage=60' : 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (err) {
    console.error('prices failed', err.message);
    res.status(502).json({ error: 'price providers unavailable' });
  }
}
