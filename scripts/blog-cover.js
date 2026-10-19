// Renders a 1200x630 blog cover (also the og:image) from the market brief.
// Built as a single slide: one headline assertion, one hero number (the S&P 500),
// a stat strip of real figures, one accent colour on the site's newsprint paper.
// Usage: node scripts/blog-cover.js brief.json "Headline (<= 12 words)" cover.png
import { readFileSync, writeFileSync, mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const [briefPath, headline, outPath = 'cover.png'] = process.argv.slice(2);
if (!briefPath || !headline) {
  console.error('usage: node scripts/blog-cover.js brief.json "Headline" cover.png');
  process.exit(1);
}
if (headline.split(/\s+/).length > 12) console.error('warn: headline is over 12 words; it may wrap to 4 lines');

const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lvl = (n) => (n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (n) => (n == null ? '' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`);
const tone = (n) => (n == null ? '' : n >= 0 ? 'up' : 'down');

const ix = (sym) => brief.indices?.find((q) => q.symbol === sym);
const fut = (sym) => brief.futures?.find((q) => q.symbol === sym);
const spx = ix('SPX'), ndx = ix('IXIC'), dji = ix('DJIA'), es = fut('ES');
const pre = brief.session === 'pre' || brief.session === 'closed';
const ty = brief.ten_year_yield, vix = brief.vix;
// Each stat: big value + small sub-line; `tone` colours whichever part carries the direction.
const stats = [
  pre && es && { label: 'S&P futures', value: pct(es.change_pct), valueTone: tone(es.change_pct), sub: 'pre-market' },
  ndx && { label: 'Nasdaq', value: lvl(ndx.level), sub: pct(ndx.change_pct), subTone: tone(ndx.change_pct) },
  dji && { label: 'Dow', value: lvl(dji.level), sub: pct(dji.change_pct), subTone: tone(dji.change_pct) },
  vix && { label: 'VIX', value: vix.level?.toFixed(2), sub: pct(vix.change_pct) },
  ty && { label: '10Y yield', value: `${ty.yield_pct?.toFixed(2)}%`, sub: ty.change_bp == null ? '' : `${ty.change_bp >= 0 ? '+' : '−'}${Math.abs(ty.change_bp)} bp` },
].filter(Boolean).slice(0, 4);

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,600;6..72,700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
  :root{--bg:#f4efe6;--rule:#1a1712;--text:#0e0c09;--muted:#5e564b;--dim:#857b6d;--accent:#1f3f8f;--up:#13794a;--down:#b3261e;
    --display:'Newsreader',Georgia,serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
  *{box-sizing:border-box;margin:0}
  html,body{width:1200px;height:630px;overflow:hidden}
  body{background:var(--bg);color:var(--text);font-family:var(--display);position:relative}
  .slide{position:absolute;inset:48px 64px 44px;display:flex;flex-direction:column}
  .top{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:14px;border-bottom:4px double var(--rule)}
  .brand{font:700 34px/1 var(--display);letter-spacing:-.02em}.brand i{font-style:italic;font-weight:600;color:var(--accent)}
  .kicker{font:600 14px var(--mono);letter-spacing:.14em;color:var(--muted);text-transform:uppercase}
  .main{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:48px;align-items:center}
  h1{font:700 58px/1.06 var(--display);letter-spacing:-.022em;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
  .hero{border-left:1px solid var(--rule);padding-left:36px}
  .hero small{display:block;font:600 14px var(--mono);letter-spacing:.12em;color:var(--muted);margin-bottom:10px}
  .hero b{display:block;font:600 56px/1 var(--mono);letter-spacing:-.04em;font-variant-numeric:tabular-nums}
  .hero span{display:block;font:600 24px var(--mono);margin-top:12px}
  .hero em{display:block;font:500 13px var(--mono);font-style:normal;color:var(--dim);margin-top:8px}
  .strip{display:grid;grid-template-columns:repeat(${Math.max(stats.length, 1)},1fr);border-top:1px solid var(--rule);padding-top:18px;gap:24px}
  .strip small{display:block;font:600 12px var(--mono);letter-spacing:.12em;color:var(--dim);text-transform:uppercase;margin-bottom:6px}
  .strip b{font:600 25px var(--mono);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .strip span{font:600 15px var(--mono);margin-left:8px;color:var(--muted)}
  .up{color:var(--up)!important}.down{color:var(--down)!important}
</style></head><body><div class="slide">
  <div class="top"><span class="brand">Stock<i>Talk</i></span><span class="kicker">Morning note · ${esc(brief.date_et || '')}</span></div>
  <div class="main">
    <h1>${esc(headline)}</h1>
    ${spx ? `<div class="hero"><small>S&amp;P 500</small><b>${lvl(spx.level)}</b><span class="${tone(spx.change_pct)}">${pct(spx.change_pct)}</span><em>${pre ? 'last close' : 'latest'}</em></div>` : '<div></div>'}
  </div>
  <div class="strip">${stats.map((s) => `<div><small>${esc(s.label)}</small><b class="${s.valueTone || ''}">${esc(s.value)}</b><span class="${s.subTone || ''}">${esc(s.sub)}</span></div>`).join('')}</div>
</div></body></html>`;

const dir = mkdtempSync(path.join(tmpdir(), 'st-cover-'));
const htmlPath = path.join(dir, 'cover.html');
writeFileSync(htmlPath, html);
const out = path.resolve(outPath);

// Playwright's CLI renders the slide; pinned version, Chromium installed on first use.
const PW = 'playwright@1.49.1';
const run = (args) => spawnSync('npx', ['-y', PW, ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
if (!process.env.SKIP_BROWSER_INSTALL) run(['install', 'chromium']);
const shot = run(['screenshot', '--viewport-size=1200,630', '--wait-for-timeout=1500', pathToFileURL(htmlPath).href, out]);
if (shot.status !== 0 || !existsSync(out) || statSync(out).size < 1000) {
  console.error(`cover render failed; slide HTML kept at ${htmlPath}`);
  process.exit(1);
}
console.log(`cover written: ${out} (${statSync(out).size} bytes)`);
