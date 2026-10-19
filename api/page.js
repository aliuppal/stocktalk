import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getNews } from '../lib/news.js';
import { listPosts, getPost, getImage, renderMarkdown, readingMinutes, SITE } from '../lib/blog.js';

// Server-rendered pages (one function for Vercel Hobby's function limit).
// vercel.json rewrites map URLs to ?view=:
//   /                      home: ranked stories + latest blog posts in the HTML
//   /blog                  blog index          (view=blog)
//   /blog/:slug            blog post           (view=post)
//   /blog/:slug/cover.png  cover image from the base64 column (view=image)
//   /sitemap.xml           home + blog + posts (view=sitemap)
//   /admin                 review page for pending posts (view=admin, noindex)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } };
// JSON inside <script> must not be able to close the tag.
const BACKSLASH = String.fromCharCode(92);
const scriptJson = (v) => JSON.stringify(v).replace(/</g, BACKSLASH + "u003c");
const ldScript = (obj) => `<script type="application/ld+json">${scriptJson({ '@context': 'https://schema.org', ...obj })}</script>`;
const iso = (d) => new Date(d).toISOString();
const longDate = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
const PUBLISHER = { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'StockTalk', url: `${SITE}/`, logo: { '@type': 'ImageObject', url: `${SITE}/favicon.svg` } };

const templates = {};
const loadTpl = async (name) => (templates[name] ??= await readFile(path.join(process.cwd(), 'templates', name), 'utf8'));

// Google Analytics 4: off until GA_MEASUREMENT_ID (G-XXXXXXXXXX) is set in the environment.
function gaSnippet() {
  const id = String(process.env.GA_MEASUREMENT_ID || '').trim();
  if (!/^G-[A-Z0-9]{4,20}$/.test(id)) return '';
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`;
}
// Templates hard-code the default origin; swap in SITE so a custom domain only needs SITE_URL.
const tpl = async (name) => (await loadTpl(name)).replaceAll('https://stocktalk-rosy.vercel.app', SITE).replace('<!--SSR:GA-->', gaSnippet());

// ---------- home ----------
function feedHtml(stories) {
  return stories.map((s, i) => `<article class="story">
      <div class="num">${String(i + 1).padStart(2, '0')}</div>
      <div class="body">
        <div class="badges"><span class="badge k-${esc(s.kind)}">${esc(s.tag)}</span><time datetime="${esc(iso(s.published_at))}">${esc(new Date(s.published_at).toUTCString())}</time></div>
        <h2><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></h2>
        ${s.summary ? `<p class="summary">${esc(s.summary)}</p>` : ''}
        <div class="meta"><span class="m"><span class="src">${esc(s.source)}</span></span><span class="m"><b>${s.coverage} outlet${s.coverage > 1 ? 's' : ''}</b></span></div>
        ${s.also?.length ? `<div class="also"><small>ALSO ON</small>${s.also.map((a) => `<a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.source)}</a>`).join('')}</div>` : ''}
      </div>
    </article>`).join('');
}

function homeJsonLd(data) {
  return ldScript({
    '@graph': [
      { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: 'StockTalk', description: 'US stock market news from 12 newsrooms, merged by story and ranked daily.', inLanguage: 'en', publisher: { '@id': `${SITE}/#org` } },
      PUBLISHER,
      {
        '@type': 'ItemList', name: 'Top ranked US stock market stories', ...(data.updated_at ? { dateModified: iso(data.updated_at) } : {}),
        itemListOrder: 'https://schema.org/ItemListOrderDescending', numberOfItems: Math.min(data.stories.length, 20),
        itemListElement: data.stories.slice(0, 20).map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: safeUrl(s.url), name: s.title })),
      },
    ],
  });
}

async function home(res) {
  const html = await tpl('index.html');
  // Blog posts live only on /blog; the homepage links there from the nav.
  const news = await getNews().catch((err) => { console.error('page: news unavailable', err.message); return null; });
  let out = html;
  if (news?.stories?.length) {
    out = out
      .replace('<!--SSR:JSONLD-->', homeJsonLd(news))
      .replace('<!--SSR:FEED-->', feedHtml(news.stories))
      .replace('<!--SSR:DATA-->', `<script id="initial-news" type="application/json">${scriptJson(news)}</script>`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Short CDN cache when the DB was down so a real render replaces the shell soon.
  res.setHeader('Cache-Control', news ? 'public, s-maxage=900, stale-while-revalidate=86400' : 'public, s-maxage=60');
  res.status(200).end(out);
}

// ---------- blog ----------
function head({ title, description, canonical, image, type = 'website', extra = '' }) {
  return `<title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta property="og:type" content="${type}" />
  <meta property="og:site_name" content="StockTalk" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  ${image ? `<meta property="og:image" content="${esc(image)}" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />` : ''}
  <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  ${image ? `<meta name="twitter:image" content="${esc(image)}" />` : ''}
  ${extra}`;
}

async function blogIndex(res) {
  const posts = await listPosts({ limit: 50 });
  const canonical = `${SITE}/blog`;
  const main = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">StockTalk</a> / <span>Blog</span></nav>
    <header class="blog-hero"><div class="eyebrow">The 9 AM pre-market brief</div><h1>The StockTalk <em>morning note</em></h1>
      <p class="lede">Every weekday at 9 AM New York time, half an hour before the opening bell: where the S&amp;P 500, Nasdaq and Dow stand, what futures are signalling, which stocks and sectors moved, and the stories every newsroom is covering.</p>
      <p class="rss-link"><a href="/blog/rss.xml">Subscribe via RSS</a></p></header>
    ${posts.length ? `<div class="post-list">${posts.map((p) => `<article class="post-card">
        <a href="/blog/${esc(p.slug)}">${p.has_image ? `<img src="/blog/${esc(p.slug)}/cover.png" alt="${esc(p.image_alt || p.title)}" width="1200" height="630" loading="lazy">` : ''}</a>
        <div><time datetime="${esc(iso(p.published_at))}">${esc(longDate(p.published_at))}</time>
        <h2><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h2><p>${esc(p.excerpt || p.meta_description)}</p></div>
      </article>`).join('')}</div>` : '<p class="empty">The first morning note lands at 9 AM New York time on the next trading day.</p>'}`;
  const ld = ldScript({
    '@graph': [
      PUBLISHER,
      { '@type': 'Blog', '@id': `${canonical}#blog`, url: canonical, name: 'StockTalk blog', publisher: { '@id': `${SITE}/#org` },
        blogPost: posts.map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}/blog/${p.slug}`, datePublished: iso(p.published_at) })) },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'StockTalk', item: `${SITE}/` }, { '@type': 'ListItem', position: 2, name: 'Blog', item: canonical }] },
    ],
  });
  return sendBlog(res, head({ title: 'Stock Market Today: Daily Pre-Market Brief | StockTalk', description: 'A daily stock market brief before the open: S&P 500, Nasdaq and Dow levels, futures, sector moves, top gainers and losers, and the most-covered market news.', canonical, extra: ld }), main);
}

async function blogPost(res, slug) {
  const p = slug && await getPost(slug);
  if (!p) return notFound(res);
  const canonical = `${SITE}/blog/${p.slug}`;
  const image = p.has_image ? `${canonical}/cover.png` : null;
  const main = `<article class="post">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">StockTalk</a> / <a href="/blog">Blog</a> / <span>${esc(longDate(p.published_at))}</span></nav>
      <header><div class="eyebrow">Pre-market brief</div><h1>${esc(p.title)}</h1>
        <p class="post-meta">By StockTalk · <time datetime="${esc(iso(p.published_at))}">${esc(longDate(p.published_at))}</time> · ${readingMinutes(p.body_md)} min read</p></header>
      ${image ? `<img class="cover" src="/blog/${esc(p.slug)}/cover.png" alt="${esc(p.image_alt || p.title)}" width="1200" height="630">` : ''}
      <div class="prose">${renderMarkdown(p.body_md)}</div>
      ${p.keywords?.length ? `<p class="tags">${p.keywords.map((k) => `<span>${esc(k)}</span>`).join('')}</p>` : ''}
      <p class="disclaimer">Market data from Yahoo Finance (may be delayed). Economic calendar from Forex Factory. Not financial advice.</p>
      <p class="back"><a href="/">← Today’s ranked market news</a> · <a href="/blog">All morning notes</a></p>
    </article>`;
  const ld = ldScript({
    '@graph': [
      PUBLISHER,
      { '@type': 'BlogPosting', '@id': `${canonical}#post`, headline: p.title, description: p.meta_description, keywords: (p.keywords || []).join(', '),
        datePublished: iso(p.published_at), dateModified: iso(p.reviewed_at || p.published_at), mainEntityOfPage: canonical, url: canonical,
        ...(image ? { image: { '@type': 'ImageObject', url: image, width: 1200, height: 630 } } : {}),
        author: { '@id': `${SITE}/#org` }, publisher: { '@id': `${SITE}/#org` }, inLanguage: 'en', wordCount: String(p.body_md).split(/\s+/).length },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'StockTalk', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` },
        { '@type': 'ListItem', position: 3, name: p.title, item: canonical }] },
    ],
  });
  return sendBlog(res, head({ title: `${p.title} | StockTalk`, description: p.meta_description, canonical, image, type: 'article',
    extra: `<meta property="article:published_time" content="${esc(iso(p.published_at))}" />${(p.keywords || []).map((k) => `<meta property="article:tag" content="${esc(k)}" />`).join('')}${ld}` }), main);
}

async function sendBlog(res, headHtml, mainHtml) {
  const html = (await tpl('blog.html')).replace('<!--SSR:HEAD-->', headHtml).replace('<!--SSR:MAIN-->', mainHtml);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Short cache: posts auto-publish, so a new one should appear within a minute.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
  res.status(200).end(html);
}

async function notFound(res) {
  const html = (await tpl('blog.html'))
    .replace('<!--SSR:HEAD-->', '<title>Not found | StockTalk</title><meta name="robots" content="noindex" />')
    .replace('<!--SSR:MAIN-->', '<article class="post"><h1>Post not found</h1><p class="back"><a href="/blog">← All morning notes</a></p></article>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(404).end(html);
}

async function coverImage(res, slug) {
  const img = slug && await getImage(slug);
  if (!img) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Content-Length', img.bytes.length);
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
  res.status(200).end(img.bytes);
}

// ---------- RSS 2.0 feeds ----------
//   /blog/rss.xml  morning notes, full post HTML + cover image
//   /rss.xml       today's top ranked stock market stories (links to the original outlets)
const rfc822 = (d) => new Date(d).toUTCString();
const cdata = (s) => `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

async function rssFeed(res, feed) {
  const self = feed === 'blog' ? `${SITE}/blog/rss.xml` : `${SITE}/rss.xml`;
  let channel, items;
  if (feed === 'blog') {
    const posts = await listPosts({ limit: 30, withBody: true });
    channel = { title: 'StockTalk: Daily Pre-Market Brief', link: `${SITE}/blog`,
      description: 'A daily stock market brief before the open: S&P 500, Nasdaq and Dow levels, futures, sector moves, top gainers and losers, and the most-covered market news.',
      updated: posts[0]?.reviewed_at || posts[0]?.published_at };
    items = posts.map((p) => {
      const url = `${SITE}/blog/${p.slug}`;
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="true">${esc(url)}</guid>
      <pubDate>${rfc822(p.published_at)}</pubDate>
      <dc:creator>StockTalk</dc:creator>
      ${(p.keywords || []).map((k) => `<category>${esc(k)}</category>`).join('')}
      <description>${esc(p.excerpt || p.meta_description)}</description>
      <content:encoded>${cdata(`${p.has_image ? `<p><img src="${url}/cover.png" alt="${esc(p.image_alt || p.title)}" width="1200" height="630"></p>` : ''}${renderMarkdown(p.body_md)}`)}</content:encoded>
      ${p.has_image ? `<media:content url="${esc(url)}/cover.png" medium="image" type="image/png" width="1200" height="630"/>` : ''}
    </item>`;
    });
  } else {
    const news = await getNews();
    channel = { title: 'StockTalk: Top Ranked Stock Market News', link: `${SITE}/`,
      description: 'The US stock market stories every outlet is covering, merged across 12 newsrooms and ranked by coverage, source authority and freshness.',
      updated: news.updated_at };
    items = news.stories.slice(0, 30).map((s) => {
      const also = (s.also || []).map((a) => a.source);
      const desc = `${s.summary ? `${s.summary} ` : ''}Covered by ${s.coverage} outlet${s.coverage > 1 ? 's' : ''}: ${[s.source, ...also].join(', ')}.`;
      return `    <item>
      <title>${esc(s.title)}</title>
      <link>${esc(safeUrl(s.url))}</link>
      <guid isPermaLink="true">${esc(safeUrl(s.url))}</guid>
      <pubDate>${rfc822(s.published_at)}</pubDate>
      <source url="${esc(self)}">${esc(s.source)}</source>
      <category>${esc(s.tag)}</category>
      <description>${esc(desc)}</description>
    </item>`;
    });
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${esc(channel.title)}</title>
    <link>${esc(channel.link)}</link>
    <atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>
    <description>${esc(channel.description)}</description>
    <language>en</language>
    ${channel.updated ? `<lastBuildDate>${rfc822(channel.updated)}</lastBuildDate>` : ''}
    <ttl>60</ttl>
    <image><url>${SITE}/favicon.svg</url><title>${esc(channel.title)}</title><link>${esc(channel.link)}</link></image>
${items.join('\n')}
  </channel>
</rss>
`;
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', feed === 'blog' ? 'public, s-maxage=300, stale-while-revalidate=3600' : 'public, s-maxage=900, stale-while-revalidate=86400');
  res.status(200).end(xml);
}

async function sitemap(res) {
  const posts = await listPosts({ limit: 1000 }).catch(() => []);
  const urls = [
    { loc: `${SITE}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${SITE}/blog`, changefreq: 'daily', priority: '0.8', lastmod: posts[0]?.published_at },
    ...posts.map((p) => ({ loc: `${SITE}/blog/${p.slug}`, lastmod: p.reviewed_at || p.published_at, priority: '0.7' })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) =>
    `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${iso(u.lastmod)}</lastmod>` : ''}${u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ''}<priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).end(xml);
}

async function admin(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(200).end(await loadTpl('admin.html'));
}

export default async function handler(req, res) {
  const q = new URL(req.url, 'http://localhost').searchParams;
  const view = q.get('view');
  const slug = (q.get('slug') || '').replace(/[^a-z0-9-]/g, '');
  try {
    if (view === 'blog') return await blogIndex(res);
    if (view === 'post') return await blogPost(res, slug);
    if (view === 'image') return await coverImage(res, slug);
    if (view === 'sitemap') return await sitemap(res);
    if (view === 'rss') return await rssFeed(res, q.get('feed') === 'blog' ? 'blog' : 'news');
    if (view === 'admin') return await admin(res);
    return await home(res);
  } catch (err) {
    console.error('page failed', view, err);
    res.statusCode = 500;
    res.end('Something went wrong.');
  }
}
