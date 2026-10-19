// Ranking: authority of the outlet + how many *other* outlets ran the same
// story + freshness + how hot the topic is across today's whole news cycle.

const STOP = new Set(`the a an and or but of to in on for with at by from as is are was were be been it its this that these those
into over after before amid about than then via vs new says say said could would will may might can just now more most
up down out off what why how who when where which while here there his her their our your has have had not no yes
week day today year report reports update news price prices market markets stock stocks shares share investors investor
billion million trillion trading first high low record ahead gets gains data quarter quarterly company companies inc corp`.split(/\s+/));

// Company names → tickers, so "Apple" and "AAPL" land in the same story cluster.
const ALIAS = { apple: 'aapl', microsoft: 'msft', nvidia: 'nvda', amazon: 'amzn', alphabet: 'googl', google: 'googl',
  tesla: 'tsla', broadcom: 'avgo', netflix: 'nflx', jpmorgan: 'jpm', goldman: 'gs', berkshire: 'brk', oracle: 'orcl',
  intel: 'intc', micron: 'mu', palantir: 'pltr', walmart: 'wmt', boeing: 'ba', exxon: 'xom', treasuries: 'treasury',
  yields: 'yield', tariffs: 'tariff', etfs: 'etf', regulators: 'regulator', 'u.s.': 'us', federal: 'fed', fomc: 'fed', powell: 'fed' };

export function tokens(title) {
  const out = new Set();
  for (let w of title.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9.$]+/)) {
    w = w.replace(/^[.$]+|\.+$/g, '');
    w = ALIAS[w] ?? w;
    if ((w.length >= 3 || ['us', 'ai', 'uk'].includes(w)) && !STOP.has(w) && !/^[\d.]+$/.test(w)) out.add(w);
  }
  return out;
}

// First match wins, so the more specific desks come first. `kind` drives the
// homepage filter chips; `tag` is the label on each story.
const CATEGORIES = [
  ['earnings', 'Earnings', /\b(earnings|eps|quarterly results|q[1-4] (results|profit|revenue|sales)|revenue|profit\w*|guidance|beats?|misses|missed|outlook|forecasts?|earnings call|transcript)\b/i],
  ['macro', 'Fed & Macro', /\b(fed|federal reserve|fomc|powell|rate (cut|hike)s?|interest rates?|inflation|cpi|ppi|pce|payrolls?|jobs report|jobless|unemployment|gdp|recession|treasur(y|ies)|yields?|bond market|economy|economic|consumer (confidence|sentiment|spending)|retail sales)\b/i],
  ['tech', 'Tech & AI', /\b(ai|artificial intelligence|chips?|chipmakers?|semiconductors?|nvidia|nvda|openai|anthropic|data cent(er|re)s?|cloud|software|magnificent seven|big tech|apple|microsoft|alphabet|google|meta|amazon|tesla|broadcom|amd|micron|palantir)\b/i],
  ['policy', 'Policy', /\b(sec|ftc|doj|antitrust|regulat\w*|laws?|bill|senate|congress|court|lawsuit|sued|tax\w*|tariffs?|trade war|sanction\w*|white house|trump|government shutdown|lawmaker\w*|legislat\w*)\b/i],
  ['markets', 'Markets', /\b(s&p|nasdaq|dow|russell|wall street|stocks? (rise|fall|rally|slide|drop|climb|gain)\w*|rall(y|ies|ied)|sell-?off|surge\w*|plunge\w*|tumbles?|slides?|record (high|close)|all-time high|futures|vix|volatility|correction|bull market|bear market|etf\w*|index|indexes|indices|sector)\b/i],
];
export function categorize(title) {
  for (const [kind, tag, re] of CATEGORIES) if (re.test(title)) return { kind, tag };
  return { kind: 'companies', tag: 'Companies' };
}

function overlap(a, b) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return { shared, j: shared / (a.size + b.size - shared || 1) };
}

/**
 * @param {Array<{url,title,source_id,published_at}>} articles  recent window (e.g. last 7 days)
 * @param {Record<string, number>} weights  source_id -> authority 1..10
 */
export function rankArticles(articles, weights, now = Date.now()) {
  const toks = articles.map((a) => tokens(a.title));
  const times = articles.map((a) => Date.parse(a.published_at));

  // Same story across outlets: published within 48h of each other and sharing
  // enough key terms. Matching articles are joined into one story cluster.
  const parent = articles.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const coverage = articles.map((a, i) => {
    const others = new Set();
    articles.forEach((b, k) => {
      if (k === i || b.source_id === a.source_id) return;
      if (Math.abs(times[k] - times[i]) > 48 * 3600e3) return;
      const { shared, j } = overlap(toks[i], toks[k]);
      if (shared >= 3 && j >= 0.25) {
        others.add(b.source_id);
        parent[find(k)] = find(i);
      }
    });
    return others.size;
  });

  // Topic heat: terms that at least 3 distinct outlets used in the last 36h.
  const termSources = new Map();
  articles.forEach((a, i) => {
    if (now - times[i] > 36 * 3600e3) return;
    for (const t of toks[i]) {
      if (!termSources.has(t)) termSources.set(t, new Set());
      termSources.get(t).add(a.source_id);
    }
  });
  const heat = new Map([...termSources].map(([t, s]) => [t, s.size]).filter(([, n]) => n >= 3));
  const trending = [...heat].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([topic, outlets]) => ({ topic, outlets }));

  const scored = articles.map((a, i) => {
    const ageH = Math.max(0, (now - times[i]) / 3600e3);
    const authority = (weights[a.source_id] ?? 5) * 8;   // 40–80
    const freshness = 100 * Math.pow(0.5, ageH / 18);      // halves every 18h
    const cover = Math.min(coverage[i], 6) * 30;           // up to 180
    let h = 0;
    for (const t of toks[i]) h += heat.get(t) ?? 0;
    return { ...a, ...categorize(a.title), coverage: coverage[i] + 1, score: Math.round((authority + freshness + cover + Math.min(h, 40)) * 10) / 10 };
  });

  // Each cluster is keyed by its best-scoring article's URL; the feed shows
  // that one as the headline and the rest as "also covered by" links.
  const lead = new Map();
  scored.forEach((a, i) => {
    const root = find(i);
    if (!lead.has(root) || a.score > scored[lead.get(root)].score) lead.set(root, i);
  });
  scored.forEach((a, i) => { a.story_id = scored[lead.get(find(i))].url; });

  return { scored, trending };
}

// Outlets ranked by authority plus how many stories they placed in the top 50.
export function rankSources(sources, scored) {
  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 50);
  return sources
    .map((s) => {
      const inTop = top.filter((a) => a.source_id === s.id).length;
      return { ...s, articles: scored.filter((a) => a.source_id === s.id).length, in_top: inTop, source_score: s.weight * 10 + inTop * 4 };
    })
    .sort((a, b) => b.source_score - a.source_score)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}
