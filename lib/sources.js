// US stock-market newsrooms we pull from once a day. `weight` is editorial authority
// (1–10) and is the biggest single input to each article's rank. A source can list
// several feeds (e.g. a markets feed and an earnings feed); they count as one outlet.
export const SOURCES = [
  { id: 'wsj',         name: 'WSJ Markets',      domain: 'wsj.com',                     homepage: 'https://www.wsj.com/finance/stocks',    weight: 10,
    feeds: ['https://feeds.a.dj.com/rss/RSSMarketsMain.xml', 'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml'] },
  { id: 'bloomberg',   name: 'Bloomberg',        domain: 'bloomberg.com',               homepage: 'https://www.bloomberg.com/markets',     weight: 10,
    feeds: ['https://feeds.bloomberg.com/markets/news.rss'] },
  { id: 'cnbc',        name: 'CNBC',             domain: 'cnbc.com',                    homepage: 'https://www.cnbc.com/markets/',         weight: 9,
    feeds: ['https://www.cnbc.com/id/15839069/device/rss/rss.html', 'https://www.cnbc.com/id/15839135/device/rss/rss.html', 'https://www.cnbc.com/id/20910258/device/rss/rss.html'] },
  { id: 'marketwatch', name: 'MarketWatch',      domain: 'marketwatch.com',             homepage: 'https://www.marketwatch.com',           weight: 9,
    feeds: ['https://feeds.content.dowjones.io/public/rss/mw_topstories', 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse'] },
  { id: 'ft',          name: 'Financial Times',  domain: 'ft.com',                      homepage: 'https://www.ft.com/markets',            weight: 8,
    feeds: ['https://www.ft.com/markets?format=rss'] },
  { id: 'seekingalpha',name: 'Seeking Alpha',    domain: 'seekingalpha.com',            homepage: 'https://seekingalpha.com/market-news',  weight: 7,
    feeds: ['https://seekingalpha.com/market_currents.xml'] },
  { id: 'investing',   name: 'Investing.com',    domain: 'investing.com',               homepage: 'https://www.investing.com/news/stock-market-news', weight: 6,
    feeds: ['https://www.investing.com/rss/news_25.rss', 'https://www.investing.com/rss/news_1062.rss'] },
  { id: 'guardian',    name: 'The Guardian',     domain: 'theguardian.com',             homepage: 'https://www.theguardian.com/business/stock-markets', weight: 6,
    feeds: ['https://www.theguardian.com/business/stock-markets/rss'] },
  { id: 'benzinga',    name: 'Benzinga',         domain: 'benzinga.com',                homepage: 'https://www.benzinga.com',              weight: 5,
    feeds: ['https://www.benzinga.com/feed'] },
  { id: 'thestreet',   name: 'TheStreet',        domain: 'thestreet.com',               homepage: 'https://www.thestreet.com',             weight: 5,
    feeds: ['https://www.thestreet.com/.rss/full/'] },
  { id: 'fxstreet',    name: 'FXStreet Stocks',  domain: 'fxstreet.com',                homepage: 'https://www.fxstreet.com/news',         weight: 5,
    feeds: ['https://www.fxstreet.com/rss/stocks'] },
  { id: 'businessinsider', name: 'Business Insider', domain: 'markets.businessinsider.com', homepage: 'https://markets.businessinsider.com/news', weight: 4,
    feeds: ['https://markets.businessinsider.com/rss/news'] },
];
