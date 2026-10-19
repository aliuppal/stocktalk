import { rejectUnknownParams } from '../lib/http.js';
import { quotes, withLastGood } from '../lib/quotes.js';

// Sector radar: the 11 S&P 500 sectors through their SPDR ETFs, plus breadth
// (how many sectors are up). Cached at the CDN for 5 minutes.
const SECTORS = [
  ['XLK', 'Technology'], ['XLC', 'Communication'], ['XLY', 'Consumer Disc.'], ['XLF', 'Financials'],
  ['XLV', 'Health Care'], ['XLI', 'Industrials'], ['XLP', 'Consumer Staples'], ['XLE', 'Energy'],
  ['XLB', 'Materials'], ['XLU', 'Utilities'], ['XLRE', 'Real Estate'],
];

async function load() {
  const sectors = (await quotes(SECTORS)).map(({ symbol, name, price, changePct, session, asOf }) => ({ symbol, name, price, changePct, session, asOf }));
  const valid = sectors.filter((s) => Number.isFinite(s.changePct));
  return {
    sectors: valid.sort((a, b) => b.changePct - a.changePct),
    up: valid.filter((s) => s.changePct > 0).length,
    total: valid.length,
    updated_at: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (rejectUnknownParams(req, res)) return;
  try {
    const data = await withLastGood('radar', load, (d) => d.total >= 6);
    res.setHeader('Cache-Control', data.stale ? 'public, s-maxage=60' : 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (err) {
    console.error('radar failed', err.message);
    res.status(502).json({ error: 'sector data unavailable' });
  }
}
