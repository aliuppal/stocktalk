# The 9 AM morning note: routine playbook

The Claude routine follows this file every weekday at 9:00 AM New York time, 30 minutes before the
opening bell. It writes a pre-market brief on US stocks and indices from live data, renders a cover
image, and submits both. Submitted posts are **published immediately** (no manual review), so accuracy
is on you: every fact must come from the brief. The owner can edit, hide or delete any post at
`<site>/admin`. (If the site sets BLOG_REQUIRE_REVIEW=true, posts wait there as drafts instead.)

Do not commit, push, or edit any files in the repository. Work in a temporary folder.

## 1. Gather facts

```bash
npm ci
node scripts/market-brief.js > brief.json
```

`brief.json` is the **only** source of facts. Every level, percentage, ticker, event and headline in the
post must appear in it. If a field is `null`, leave that topic out — never estimate or fill it in.

Stop without posting if `is_weekday` is `false` (weekend), or if `indices` is `null`.
If `data_is_stale` is `true`, say in the summary that market data may be from the last update.

Read the timing fields carefully. The routine runs **before** the 9:30 AM open:

- `session` is normally `"pre"`. Then `indices[].level` is the **previous close** and `change_pct` is the
  **previous session's** move. Write "the S&P 500 closed at 7,698.23 on Friday, up 0.51%" — never "is up today".
- `futures` are live: they show where the market is pointed **this morning** ("S&P 500 futures are up 0.4%
  ahead of the open").
- `movers.basis` is `"last session"` before the open: these are the previous trading day's biggest gainers
  and losers. Say so.
- `ten_year_yield.change_bp` is in basis points. `vix` below 15 is calm, 15–20 normal, 20–30 elevated, above 30 fearful.
- `economic_calendar.today` lists today's high- and medium-impact US releases with New York times.
- `top_stories` are already ranked by how many newsrooms covered them. Cite the outlet by name and link the story `url`.

## 2. Write `draft.json`

```json
{
  "title": "...",
  "slug": "stock-market-today-YYYY-MM-DD",
  "meta_description": "...",
  "keywords": ["stock market today", "s&p 500 today", "..."],
  "excerpt": "...",
  "body_md": "...",
  "image_alt": "..."
}
```

### SEO rules (the API rejects drafts outside these limits)

| Field | Rule |
|---|---|
| `title` | 50–65 characters (hard limit 20–75). Starts with the primary keyword, includes the date, makes one claim. Pattern: `Stock Market Today (Oct 20, 2026): Futures Rise as Tech Leads` |
| `slug` | `stock-market-today-YYYY-MM-DD` (use `date_iso_et`). |
| `meta_description` | 140–160 characters (hard limit 70–170). Says what happened and why to read: futures direction, last close, the day's key catalyst. |
| `keywords` | 6–10 lowercase phrases people search: `stock market today`, `s&p 500 today`, `dow jones today`, `nasdaq today`, `stock futures`, `premarket movers`, plus the day's tickers/topics (`nvidia stock`, `cpi report`). No duplicates. |
| `excerpt` | 1–2 sentences, 120–220 characters, for the blog cards. |
| `body_md` | 700–1,100 words of Markdown. |
| `image_alt` | Describes the cover: "StockTalk morning note for October 20, 2026: S&P 500 at 7,698.23 after a 0.51% gain". |

### Body structure (use these H2s, in this order; no H1 — the page adds it)

1. `## Stock market today: the summary` — 2-sentence answer first (where futures point and why it matters), then 3 bullets (index futures, the last close, the day's key catalyst).
2. `## S&P 500, Nasdaq and Dow: where they stand` — last close of each index with its change, and the matching futures this morning. A Markdown table works well (index, last close, change, futures).
3. `## Sectors and market breadth` — how many of the 11 sectors rose (`sectors.up`/`sectors.total`), the leading and lagging sectors with their %, plus VIX and the 10-year yield.
4. `## Biggest stock movers` — a Markdown table of the 5 gainers and 5 losers (ticker, company, price, % change, relative volume), labelled with the session they describe, then 2–3 sentences of context. Only explain a move if a `top_stories` headline names that company.
5. `## Today's top market news` — the 4–6 most-covered stories. Each: what happened in one sentence, why it matters for stocks, and a link with descriptive anchor text to the original article (e.g. `[CNBC reports Nvidia shares jumped after earnings](url)`). Mention how many newsrooms covered it.
6. `## What to watch today` — `economic_calendar.today` releases with their ET times, forecast and previous; earnings or events named in `top_stories`; the dollar, gold and oil only if they moved notably. No price predictions or targets.
7. `## FAQ` — 2–3 questions phrased the way people search ("Is the stock market up today?", "What time does the stock market open?", "Why are stock futures down today?"), each answered in 1–3 sentences from the data. The regular session runs 9:30 AM–4:00 PM ET.

End with: `*Data: Yahoo Finance (may be delayed), Forex Factory and 12 US market newsrooms via [StockTalk](/). Not financial advice.*`

### Writing rules

- Use the primary keyword in the title, the first sentence and one H2; then write naturally. No keyword stuffing.
- Link to StockTalk at least twice: [today's ranked market news](/) and [all morning notes](/blog).
- Plain, confident sentences. Numbers formatted as `7,698.23`, `+0.51%`, `$182.40`, `4.21%`, `+5 bp`. Tickers in capitals.
- Keep tenses honest: the last session is past tense; futures and today's calendar are present/future.
- No invented quotes, analyst names, forecasts, price targets, "could reach" claims or buy/sell advice. No emoji.
- Never include raw HTML; Markdown only.

## 3. Render the cover

The cover is a single 1200×630 slide in the site's newsprint style: one headline assertion, one hero
number (the S&P 500), a stat strip of real figures, one accent colour. Pick a headline of **12 words or
fewer** that states the morning's main fact.

```bash
node scripts/blog-cover.js brief.json "Stock futures rise as chipmakers extend their rebound" cover.png
```

Open `cover.png` and check the headline fits on 2–3 lines and nothing overlaps. If rendering fails, submit without the cover and say so in the run summary.

## 4. Publish

Before submitting, re-read `draft.json` against `brief.json` once: every number, ticker, time and outlet must match. The post goes live as soon as it is accepted.

```bash
BLOG_SECRET=<from the routine prompt> node scripts/blog-submit.js draft.json cover.png brief.json
```

On a 400 error, fix the field named in the message and resubmit. Finish with a one-paragraph summary:
the title, the slug, and the live URL the script prints (`<site>/blog/<slug>`).
