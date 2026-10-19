import { timingSafeEqual } from 'node:crypto';
import { validateDraft, createDraft, listPosts, reviewPost, getPostById, listManaged, updatePost, setHidden, deletePost, SITE } from '../lib/blog.js';

// Blog API (one function to stay inside Vercel Hobby's function limit):
//   POST ?action=submit   Bearer BLOG_SECRET   routine submits a post → published immediately
//                                              (or 'pending' when BLOG_REQUIRE_REVIEW=true)
//   GET  ?action=pending  Bearer ADMIN_SECRET  drafts waiting for review (with cover image)
//   GET  ?action=recent   Bearer ADMIN_SECRET  published + hidden posts for the admin list
//   GET  ?action=get&id=  Bearer ADMIN_SECRET  one post with its Markdown body (for editing)
//   POST ?action=update   Bearer ADMIN_SECRET  { id, title?, meta_description?, excerpt?, body_md? }  edit in place
//   POST ?action=hide | show | delete   Bearer ADMIN_SECRET  { id }
//   POST ?action=review   Bearer ADMIN_SECRET  { id, decision: 'publish'|'reject', title?, meta_description?, body_md?, note? }
//                                              'reject' on a published post unpublishes it
//   GET  ?action=list                          published posts (public)
const requireReview = () => String(process.env.BLOG_REQUIRE_REVIEW || '').toLowerCase() === 'true';
function bearerMatches(req, secret) {
  if (!secret) return false;
  const got = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(req, res) {
  const action = new URL(req.url, 'http://localhost').searchParams.get('action');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (action === 'list' && req.method === 'GET') {
      const posts = await listPosts({ status: 'published', limit: 30 });
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
      return res.status(200).json({ posts: posts.map((p) => ({ ...p, url: `${SITE}/blog/${p.slug}`, image: p.has_image ? `${SITE}/blog/${p.slug}/cover.png` : null })) });
    }

    if (action === 'submit' && req.method === 'POST') {
      if (!bearerMatches(req, process.env.BLOG_SECRET)) return res.status(401).json({ error: 'unauthorized' });
      let draft;
      try { draft = validateDraft(await readJson(req)); } catch (err) { return res.status(400).json({ error: err.message }); }
      const publish = !requireReview();
      const row = await createDraft(draft, { publish });
      return res.status(201).json({ ok: true, ...row, url: publish ? `${SITE}/blog/${row.slug}` : null, admin_url: `${SITE}/admin` });
    }

    if (['recent', 'get', 'update', 'hide', 'show', 'delete'].includes(action)) {
      if (!bearerMatches(req, process.env.ADMIN_SECRET)) return res.status(401).json({ error: 'unauthorized' });
      if (action === 'recent' && req.method === 'GET') return res.status(200).json({ posts: await listManaged({ limit: 30 }) });
      if (action === 'get' && req.method === 'GET') {
        const post = await getPostById(Number(new URL(req.url, 'http://localhost').searchParams.get('id')));
        return post ? res.status(200).json({ post }) : res.status(404).json({ error: 'post not found' });
      }
      if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
      const body = await readJson(req);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'id required' });
      try {
        const row = action === 'update' ? await updatePost({ ...body, id })
          : action === 'hide' ? await setHidden(id, true)
          : action === 'show' ? await setHidden(id, false)
          : await deletePost(id);
        return res.status(200).json({ ok: true, action, ...row, url: row.status === 'published' ? `${SITE}/blog/${row.slug}` : null });
      } catch (err) { return res.status(400).json({ error: err.message }); }
    }

    if (action === 'pending' && req.method === 'GET') {
      if (!bearerMatches(req, process.env.ADMIN_SECRET)) return res.status(401).json({ error: 'unauthorized' });
      const { sql } = await import('../lib/db.js');
      const rows = await sql()`select id, slug, title, meta_description, keywords, excerpt, body_md, image_base64, image_mime, image_alt, created_at
        from blog_posts where status = 'pending' order by created_at desc limit 20`;
      return res.status(200).json({ posts: rows });
    }

    if (action === 'review' && req.method === 'POST') {
      if (!bearerMatches(req, process.env.ADMIN_SECRET)) return res.status(401).json({ error: 'unauthorized' });
      const body = await readJson(req);
      try {
        const row = await reviewPost({ ...body, id: Number(body.id) });
        return res.status(200).json({ ok: true, ...row, url: row.status === 'published' ? `${SITE}/blog/${row.slug}` : null });
      } catch (err) { return res.status(400).json({ error: err.message }); }
    }

    return res.status(404).json({ error: 'unknown action' });
  } catch (err) {
    console.error('blog api failed', err);
    return res.status(500).json({ error: 'blog api failed' });
  }
}
