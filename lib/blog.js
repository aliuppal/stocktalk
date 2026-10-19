import { Marked } from 'marked';
import { sql } from './db.js';

// Blog posts written by the daily Claude routine. Every post starts as
// 'pending' and only appears on the site after it is approved at /admin.
// The cover image lives in the row as base64 next to the text.

// Public origin of the site (canonical URLs, RSS, sitemap). Set SITE_URL in Vercel when a custom domain is added.
export const SITE = (process.env.SITE_URL || 'https://stocktalk.vercel.app').replace(/\/+$/, '');
const MAX_IMAGE_BYTES = 2_000_000;
const IMAGE_TYPES = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
};

export async function ensureBlogSchema() {
  const db = sql();
  await db`create table if not exists blog_posts (
    id serial primary key,
    slug text unique not null,
    title text not null,
    meta_description text not null,
    keywords text[] not null default '{}',
    excerpt text,
    body_md text not null,
    image_base64 text,
    image_mime text,
    image_alt text,
    status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
    market_snapshot jsonb,
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,
    published_at timestamptz,
    review_note text)`;
  await db`create index if not exists blog_posts_status_idx on blog_posts (status, published_at desc)`;
}

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}

const str = (v, name, min, max) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) throw new Error(`${name} must be ${min}-${max} characters (got ${s.length})`);
  return s;
};

// Validates a draft from the routine. Throws with a readable message on bad input.
export function validateDraft(input) {
  const title = str(input.title, 'title', 20, 75);
  const meta_description = str(input.meta_description, 'meta_description', 70, 170);
  const body_md = str(input.body_md, 'body_md', 600, 40_000);
  const excerpt = input.excerpt ? str(input.excerpt, 'excerpt', 40, 300) : meta_description;
  const keywords = Array.isArray(input.keywords) ? input.keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 12) : [];
  if (keywords.length < 3) throw new Error('keywords: provide at least 3');
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(input.slug || `${title}-${date}`);
  if (slug.length < 10) throw new Error('slug too short');

  let image_base64 = null, image_mime = null;
  if (input.image_base64) {
    image_mime = String(input.image_mime || 'image/png');
    if (!IMAGE_TYPES[image_mime]) throw new Error('image_mime must be image/png, image/jpeg or image/webp');
    const raw = String(input.image_base64).replace(/^data:[^,]+,/, '');
    const bytes = Buffer.from(raw, 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error(`image must be 1 byte to ${MAX_IMAGE_BYTES} bytes`);
    if (!IMAGE_TYPES[image_mime](bytes)) throw new Error(`image bytes are not a valid ${image_mime}`);
    image_base64 = bytes.toString('base64');
  }
  const image_alt = input.image_alt ? str(input.image_alt, 'image_alt', 10, 200) : title;
  const market_snapshot = input.market_snapshot && typeof input.market_snapshot === 'object' ? input.market_snapshot : null;
  return { slug, title, meta_description, keywords, excerpt, body_md, image_base64, image_mime, image_alt, market_snapshot };
}

// publish: true puts the post live immediately (auto-publish); otherwise it waits as 'pending'.
export async function createDraft(draft, { publish = false } = {}) {
  const db = sql();
  await ensureBlogSchema();
  // Same title on the same day → suffix rather than fail.
  let slug = draft.slug;
  for (let n = 2; (await db`select 1 from blog_posts where slug = ${slug}`).length; n++) slug = `${draft.slug}-${n}`;
  const status = publish ? 'published' : 'pending';
  const publishedAt = publish ? new Date().toISOString() : null;
  const [row] = await db`
    insert into blog_posts (slug, title, meta_description, keywords, excerpt, body_md, image_base64, image_mime, image_alt, market_snapshot, status, published_at, review_note)
    values (${slug}, ${draft.title}, ${draft.meta_description}, ${draft.keywords}, ${draft.excerpt}, ${draft.body_md},
            ${draft.image_base64}, ${draft.image_mime}, ${draft.image_alt}, ${draft.market_snapshot ? JSON.stringify(draft.market_snapshot) : null},
            ${status}, ${publishedAt}, ${publish ? 'auto-published' : null})
    returning id, slug, status, created_at, published_at`;
  return row;
}

const LIST_COLS = 'id, slug, title, meta_description, keywords, excerpt, image_mime, image_alt, status, created_at, reviewed_at, published_at, review_note, (image_base64 is not null) as has_image';

export async function listPosts({ status = 'published', limit = 20, withBody = false } = {}) {
  const db = sql();
  await ensureBlogSchema();
  const order = status === 'published' ? 'published_at desc' : 'created_at desc';
  const cols = withBody ? `${LIST_COLS}, body_md` : LIST_COLS;
  return db.query(`select ${cols} from blog_posts where status = $1 order by ${order} limit $2`, [status, limit]);
}

export async function getPost(slug, { publishedOnly = true } = {}) {
  const db = sql();
  await ensureBlogSchema();
  const rows = await db.query(`select ${LIST_COLS}, body_md from blog_posts where slug = $1 ${publishedOnly ? "and status = 'published'" : ''}`, [slug]);
  return rows[0] ?? null;
}

export async function getImage(slug, { publishedOnly = true } = {}) {
  const db = sql();
  await ensureBlogSchema();
  const rows = await db.query(`select image_base64, image_mime from blog_posts where slug = $1 and image_base64 is not null ${publishedOnly ? "and status = 'published'" : ''}`, [slug]);
  return rows[0] ? { bytes: Buffer.from(rows[0].image_base64, 'base64'), mime: rows[0].image_mime } : null;
}

// Approve (optionally with edits) or reject a pending post.
export async function reviewPost({ id, decision, title, meta_description, body_md, note }) {
  const db = sql();
  await ensureBlogSchema();
  if (!['publish', 'reject'].includes(decision)) throw new Error('decision must be publish or reject');
  const [cur] = await db`select * from blog_posts where id = ${id}`;
  if (!cur) throw new Error('post not found');
  const t = title != null ? str(title, 'title', 20, 75) : cur.title;
  const m = meta_description != null ? str(meta_description, 'meta_description', 70, 170) : cur.meta_description;
  const b = body_md != null ? str(body_md, 'body_md', 600, 40_000) : cur.body_md;
  const status = decision === 'publish' ? 'published' : 'rejected';
  const [row] = await db`
    update blog_posts set title = ${t}, meta_description = ${m}, body_md = ${b}, status = ${status},
      reviewed_at = now(), published_at = ${status === 'published' ? new Date().toISOString() : null}, review_note = ${note ?? null}
    where id = ${id} returning id, slug, status, published_at`;
  return row;
}

// ---------- admin: manage published posts ----------
const ADMIN_COLS = 'id, slug, title, meta_description, keywords, excerpt, body_md, status, created_at, reviewed_at, published_at, review_note, (image_base64 is not null) as has_image';

export async function getPostById(id) {
  const db = sql();
  await ensureBlogSchema();
  const rows = await db.query(`select ${ADMIN_COLS} from blog_posts where id = $1`, [id]);
  return rows[0] ?? null;
}

// Published and hidden posts for the admin list (hidden = taken down but kept, published_at retained).
export async function listManaged({ limit = 30 } = {}) {
  const db = sql();
  await ensureBlogSchema();
  return db.query(`select id, slug, title, status, published_at, reviewed_at, review_note, (image_base64 is not null) as has_image
    from blog_posts where status = 'published' or (status = 'rejected' and review_note = 'hidden')
    order by published_at desc nulls last limit $1`, [limit]);
}

// Edit a post in place; status is unchanged. reviewed_at doubles as "last modified" (BlogPosting dateModified, sitemap lastmod).
export async function updatePost({ id, title, meta_description, excerpt, body_md }) {
  const db = sql();
  const cur = await getPostById(id);
  if (!cur) throw new Error('post not found');
  const t = title != null ? str(title, 'title', 20, 75) : cur.title;
  const m = meta_description != null ? str(meta_description, 'meta_description', 70, 170) : cur.meta_description;
  const e = excerpt != null && String(excerpt).trim() ? str(excerpt, 'excerpt', 40, 300) : cur.excerpt;
  const b = body_md != null ? str(body_md, 'body_md', 600, 40_000) : cur.body_md;
  const [row] = await db`update blog_posts set title = ${t}, meta_description = ${m}, excerpt = ${e}, body_md = ${b}, reviewed_at = now()
    where id = ${id} returning id, slug, status, reviewed_at`;
  return row;
}

// Hide takes a published post off the site but keeps it; show puts it back with its original publish date.
export async function setHidden(id, hidden) {
  const db = sql();
  const cur = await getPostById(id);
  if (!cur) throw new Error('post not found');
  const [row] = hidden
    ? await db`update blog_posts set status = 'rejected', review_note = 'hidden', reviewed_at = now() where id = ${id} returning id, slug, status`
    : await db`update blog_posts set status = 'published', review_note = null, reviewed_at = now(),
               published_at = coalesce(published_at, now()) where id = ${id} returning id, slug, status`;
  return row;
}

// Permanent: removes the row, including its cover image.
export async function deletePost(id) {
  const db = sql();
  const rows = await db`delete from blog_posts where id = ${id} returning id, slug`;
  if (!rows.length) throw new Error('post not found');
  return rows[0];
}

// Markdown → HTML. Raw HTML in the markdown is escaped, links open safely.
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const md = new Marked({
  gfm: true,
  renderer: {
    html({ text }) { return escHtml(text); },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      let url = '#';
      try { const u = new URL(href, SITE); if (/^https?:$/.test(u.protocol)) url = u.href; } catch {}
      const external = !url.startsWith(SITE);
      return `<a href="${escHtml(url)}"${title ? ` title="${escHtml(title)}"` : ''}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    },
    image({ text }) { return escHtml(text); },
  },
});
export const renderMarkdown = (text) => md.parse(String(text ?? ''));

export const readingMinutes = (text) => Math.max(1, Math.round(String(text).split(/\s+/).length / 220));
