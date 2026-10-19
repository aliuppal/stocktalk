// Local preview without the Vercel CLI: `npm run dev` → http://localhost:3000
// Mirrors vercel.json: /api/* handlers, the page rewrites, and root static files.
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const api = {
  '/api/news': () => import('../api/news.js'),
  '/api/prices': () => import('../api/prices.js'),
  '/api/radar': () => import('../api/radar.js'),
  '/api/movers': () => import('../api/movers.js'),
  '/api/blog': () => import('../api/blog.js'),
  '/api/calendar': () => import('../api/calendar.js'),
  '/api/page': () => import('../api/page.js'),
};
// Same rewrites as vercel.json → /api/page?view=…
const rewrites = [
  [/^\/$/, () => '/api/page'],
  [/^\/blog\/?$/, () => '/api/page?view=blog'],
  [/^\/blog\/rss\.xml$/, () => '/api/page?view=rss&feed=blog'],
  [/^\/rss\.xml$/, () => '/api/page?view=rss&feed=news'],
  [/^\/blog\/([^/]+)\/cover\.png$/, (m) => `/api/page?view=image&slug=${m[1]}`],
  [/^\/blog\/([^/]+)\/?$/, (m) => `/api/page?view=post&slug=${m[1]}`],
  [/^\/sitemap\.xml$/, () => '/api/page?view=sitemap'],
  [/^\/admin\/?$/, () => '/api/page?view=admin'],
];
// Only public/ is served as static files (vercel.json "outputDirectory"), same as production.
const statics = { '/robots.txt': 'text/plain; charset=utf-8', '/favicon.svg': 'image/svg+xml', '/admin.js': 'text/javascript; charset=utf-8' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(d)); };
  for (const [re, to] of rewrites) {
    const m = url.pathname.match(re);
    if (m) { req.url = to(m); break; }
  }
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (api[path]) return await (await api[path]()).default(req, res);
    if (statics[path]) {
      res.setHeader('content-type', statics[path]);
      return res.end(await readFile(new URL(`../public${path}`, import.meta.url)));
    }
    res.status(404).end('not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).end('server error');
  }
}).listen(process.env.PORT || 3000, () => console.log(`StockTalk on http://localhost:${process.env.PORT || 3000}`));
