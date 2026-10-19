# StockTalk

US stock market news from 12 newsrooms (WSJ, Bloomberg, CNBC, MarketWatch, FT and more), merged by story and
ranked daily, with a live index board, market radar, NY-open watchlist, US economic calendar and a daily
9 AM ET pre-market blog post ("the morning note") written by a Claude routine.

Built on the same stack as BlockTalk: Vercel serverless functions, Neon Postgres, no framework.

## Pieces

| Path | What it does |
|---|---|
| `api/cron/scrape.js` | Daily scrape at 8:45 AM New York time (Vercel Cron fires at 12:45 and 13:45 UTC; the off-hour slot skips). |
| `lib/sources.js`, `lib/feeds.js`, `lib/rank.js` | Newsroom feeds, the US-stocks-only relevance filter, story clustering and ranking. |
| `api/prices.js` | S&P 500, Nasdaq, Dow, Russell 2000 (with sparklines), their futures, VIX, 10Y yield, DXY, gold, oil. |
| `api/radar.js` | The 11 S&P 500 sectors via SPDR ETFs, plus breadth. |
| `api/movers.js` | Biggest large-cap gainers and losers (Yahoo screeners). |
| `api/calendar.js` | High and medium impact US releases this week (Forex Factory). |
| `api/blog.js`, `lib/blog.js` | Blog API: routine submits, admin edits / hides / deletes. |
| `api/page.js` | Server-rendered home, blog, posts, RSS, sitemap, admin. |
| `scripts/market-brief.js`, `scripts/blog-cover.js`, `scripts/blog-submit.js` | Used by the 9 AM routine — see `docs/blog-routine.md`. |

Market data comes from Yahoo Finance's public endpoints (no key; may be delayed). Each market endpoint keeps
its last good answer in Neon and serves it, marked stale, if Yahoo refuses.

## Setup

1. Copy `.env.example` to `.env` and fill it in (`DATABASE_URL` from Neon; generate the three secrets).
2. `npm ci`, then `npm run scrape` to load the first day of news, and `npm run dev` for http://localhost:3000.
3. On Vercel set the same variables, plus `SITE_URL` once you have a custom domain.

Not financial advice.
