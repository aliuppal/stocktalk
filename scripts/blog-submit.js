// Sends a draft post + cover to StockTalk (published immediately unless BLOG_REQUIRE_REVIEW=true).
// Usage: BLOG_SECRET=... node scripts/blog-submit.js draft.json [cover.png] [brief.json]
// draft.json: { title, meta_description, keywords[], excerpt, body_md, image_alt }
import { readFileSync } from 'node:fs';

const [draftPath, coverPath, briefPath] = process.argv.slice(2);
const BASE = process.env.STOCKTALK_URL || 'https://stocktalk.vercel.app';
if (!draftPath || !process.env.BLOG_SECRET) {
  console.error('usage: BLOG_SECRET=... node scripts/blog-submit.js draft.json [cover.png] [brief.json]');
  process.exit(1);
}

const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
if (coverPath) {
  draft.image_base64 = readFileSync(coverPath).toString('base64');
  draft.image_mime = coverPath.toLowerCase().endsWith('.jpg') || coverPath.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
}
if (briefPath) {
  const b = JSON.parse(readFileSync(briefPath, 'utf8'));
  // Keep the numbers the post was written from, without the long story list.
  draft.market_snapshot = { generated_at: b.generated_at, session: b.session, indices: b.indices, futures: b.futures, vix: b.vix, ten_year_yield: b.ten_year_yield, sectors: b.sectors, movers: b.movers, trending: b.trending };
}

const r = await fetch(`${BASE}/api/blog?action=submit`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.BLOG_SECRET}` },
  body: JSON.stringify(draft),
});
const body = await r.json().catch(() => ({}));
if (!r.ok) {
  console.error(`submit failed (${r.status}): ${body.error || 'unknown error'}`);
  process.exit(1);
}
console.log(`post #${body.id} saved as ${body.status}: /blog/${body.slug}`);
console.log(body.status === 'published' ? `live at ${body.url}` : `waiting for review at ${body.admin_url}`);
