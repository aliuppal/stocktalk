import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', processEntities: true, htmlEntities: true });
const UA = 'Mozilla/5.0 (compatible; StockTalkBot/1.0; +https://github.com/aliuppal/stocktalk)';
const MAX_PER_SOURCE = 30;

const text = (v) => (v == null ? '' : typeof v === 'object' ? text(v['#text'] ?? '') : String(v));
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—' };
function clean(s) {
  return text(s)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function linkOf(item) {
  for (const l of arr(item.link)) {
    if (typeof l === 'string') return l.trim();
    if (l?.['@href'] && (!l['@rel'] || l['@rel'] === 'alternate')) return l['@href'].trim();
  }
  const guid = text(item.guid);
  return /^https?:\/\//.test(guid) ? guid.trim() : '';
}

function imageOf(item) {
  const cands = [...arr(item['media:content']), ...arr(item['media:thumbnail']), ...arr(item.enclosure)];
  for (const c of cands) {
    const url = c?.['@url'];
    if (url && /^https:\/\//.test(url) && (!c['@type'] || c['@type'].startsWith('image'))) return url;
  }
  return null;
}

// Strip tracking params so the same story from one source dedupes cleanly.
function canonical(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    [...u.searchParams.keys()].filter((k) => /^(utm_|ref$|source$)/i.test(k)).forEach((k) => u.searchParams.delete(k));
    u.hash = '';
    return u.toString();
  } catch { return ''; }
}

// US stocks and indices only. General business feeds also carry crypto, personal
// finance and foreign-market stories, so a headline must mention the US market
// (or a market term) and must not be about crypto. Foreign-market stories are kept
// only when they also name Wall Street, a US index or the Fed.
const MARKET = /\b(stocks?|shares?|equit(y|ies)|s&p|nasdaq|dow|russell|wall street|nyse|earnings|eps|revenue|guidance|profit|ipo|dividends?|buybacks?|fed|fomc|powell|treasur(y|ies)|yields?|inflation|cpi|ppi|pce|payrolls?|jobs report|jobless|gdp|rate (cut|hike)s?|futures|rall(y|ies|ied)|sell-?off|index|indexes|indices|etfs?|analysts?|upgrades?|downgrades?|price target|outlook|forecast|investors?|markets?|traders?|valuation|market cap|merger|acquisition|deal|tariffs?|vix|bull(ish)?|bear(ish)?|chip ?makers?|semiconductors?)\b|\$[A-Z]{1,5}\b|\((NYSE|NASDAQ|Nasdaq|AMEX)\s*:/i;
const CRYPTO = /\b(crypto\w*|bitcoin|btc|ethereum|ether|eth|solana|xrp|dogecoin|altcoins?|blockchain|stablecoins?|memecoins?|nfts?|defi|tokens?|web3|price prediction)\b/i;
const FOREIGN = /\b(ftse|stoxx|dax|cac 40|nikkei|topix|hang seng|sensex|nifty|asx|kospi|shanghai|shenzhen|tsx|indonesia|jakarta|india|indian|france|french|italy|germany|german|britain|british|uk|london|europe|european|eurozone|japan|tokyo|korea|australia|canada|brazil)\b/i;
// Wire press releases ("EQS-Adhoc: …", "X announces …") are not news coverage.
const NOISE = /^(eqs|press release)\b|\bannounces\b/i;
const US_ANCHOR = /\b(u\.?s\.?|us|american|wall street|s&p|nasdaq|dow|russell|nyse|fed|treasur(y|ies))\b/i;
export function isUsStockStory(title, summary = '') {
  if (CRYPTO.test(title) || NOISE.test(title)) return false;
  if (!MARKET.test(`${title} ${summary}`)) return false;
  if (FOREIGN.test(title) && !US_ANCHOR.test(title)) return false;
  return true;
}

async function fetchFeed(url, source, timeoutMs) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml, */*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = parser.parse(await res.text());
  const items = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.['rdf:RDF']?.item;
  const now = Date.now();
  return arr(items).slice(0, MAX_PER_SOURCE).map((item) => {
    const url = canonical(linkOf(item));
    const title = clean(item.title);
    const when = Date.parse(text(item.pubDate || item.published || item.updated || item['dc:date']));
    return {
      url,
      title,
      summary: clean(item.description || item.summary || item['content:encoded']).slice(0, 280),
      image: imageOf(item),
      source_id: source.id,
      // Never trust future dates from feeds.
      published_at: new Date(Number.isFinite(when) ? Math.min(when, now) : now).toISOString(),
    };
  }).filter((a) => a.url && a.title);
}

// All feeds of one outlet, merged. Fails only when every feed fails.
export async function fetchSource(source, { timeoutMs = 12000 } = {}) {
  const results = await Promise.allSettled(source.feeds.map((url) => fetchFeed(url, source, timeoutMs)));
  if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
  const seen = new Set();
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((a) => !seen.has(a.url) && seen.add(a.url) && isUsStockStory(a.title, a.summary));
}
