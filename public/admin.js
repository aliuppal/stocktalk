// Blog admin page logic. Served as a separate file so /admin can use a strict
// Content-Security-Policy (script-src 'self', no inline scripts).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
let secret = '';
try { secret = sessionStorage.getItem('bt_admin') || ''; } catch {}
$('#secret').value = secret;

async function api(action, { method = 'GET', body, query = '' } = {}) {
  const r = await fetch(`/api/blog?action=${action}${query}`, {
    method,
    headers: { authorization: `Bearer ${secret}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Failed (${r.status})`), { status: r.status });
  return d;
}

const counter = (el, min, max) => {
  const out = $(`label[for="${el.id}"] small`);
  if (!out) return;
  const n = el.value.trim().length;
  out.textContent = `${n} chars (target ${min}-${max})`;
  out.classList.toggle('bad', n < min || n > max);
};
const LIMITS = { title: [20, 75], meta_description: [70, 170], excerpt: [40, 300], body_md: [600, 40000] };

function editorHtml(p) {
  const f = (k, label, tag = 'input', cls = '') => tag === 'input'
    ? `<label for="${k}-${p.id}">${label} <small></small></label><input id="${k}-${p.id}" data-f="${k}" value="${esc(p[k])}">`
    : `<label for="${k}-${p.id}">${label} <small></small></label><textarea id="${k}-${p.id}" data-f="${k}" class="${cls}">${esc(p[k])}</textarea>`;
  return `<div class="editor">
      ${f('title', 'Title')}
      ${f('meta_description', 'Meta description')}
      ${f('excerpt', 'Excerpt (blog card text)', 'textarea', 'short')}
      ${f('body_md', 'Post (Markdown)', 'textarea')}
      <div class="ed-acts"><button class="pri" data-act="save">Save changes</button><button data-act="cancel">Cancel</button></div>
    </div>`;
}

function managedRow(p) {
  const hidden = p.status !== 'published';
  return `<div class="row${hidden ? ' hidden-post' : ''}" data-id="${p.id}" data-slug="${esc(p.slug)}">
      <div class="row-h">
        <time>${esc(day(p.published_at))}</time>
        <div class="t">${hidden ? `<a>${esc(p.title)}</a>` : `<a href="/blog/${esc(p.slug)}" target="_blank" rel="noopener">${esc(p.title)} ↗</a>`}
          <small>/blog/${esc(p.slug)}${p.reviewed_at && Date.parse(p.reviewed_at) - Date.parse(p.published_at) > 60000 ? ` · edited ${esc(day(p.reviewed_at))}` : ''}${p.review_note === 'auto-published' ? ' · auto-published' : ''}</small></div>
        <div class="acts">
          <button data-act="edit">Edit</button>
          ${hidden ? '<button data-act="show">Show</button>' : '<button class="warn" data-act="hide">Hide</button>'}
          <button class="del" data-act="delete">Delete</button>
        </div>
      </div>
      <div class="msg" role="status"></div>
    </div>`;
}

async function loadManaged() {
  const { posts } = await api('recent');
  const pub = posts.filter((p) => p.status === 'published'), hid = posts.filter((p) => p.status !== 'published');
  $('#pub-count').textContent = `${pub.length} live`;
  $('#published').innerHTML = pub.length ? pub.map(managedRow).join('') : '<p class="empty">No published posts yet. The routine publishes the next market summary automatically.</p>';
  $('#hidden').innerHTML = hid.length ? hid.map(managedRow).join('') : '<p class="empty">No hidden posts.</p>';
}

async function loadPending() {
  const { posts } = await api('pending');
  $('#pending').innerHTML = posts.length ? posts.map((p) => `<div class="card" data-id="${p.id}">
      ${p.image_base64 ? `<img src="data:${esc(p.image_mime)};base64,${esc(p.image_base64)}" alt="${esc(p.image_alt)}">` : ''}
      <p class="meta">Draft #${p.id} · created ${esc(new Date(p.created_at).toLocaleString())} · /blog/${esc(p.slug)}</p>
      <div class="kw">${(p.keywords || []).map((k) => `<span>${esc(k)}</span>`).join('')}</div>
      <p><b>${esc(p.title)}</b></p>
      <div class="acts"><button class="pri" data-review="publish">Publish</button><button class="del" data-review="reject">Reject</button></div>
      <p class="msg" role="status"></p>
    </div>`).join('') : '<p class="empty">Nothing waiting. New posts are published automatically.</p>';
}

async function loadAll() {
  $('#login-msg').textContent = '';
  try {
    await Promise.all([loadManaged(), loadPending()]);
    $('#manage').hidden = false;
  } catch (err) {
    $('#manage').hidden = true;
    $('#login-msg').innerHTML = `<span class="bad">${err.status === 401 ? 'Wrong secret. Use the ADMIN_SECRET value.' : esc(err.message)}</span>`;
  }
}

$('#login').addEventListener('submit', (e) => {
  e.preventDefault();
  secret = $('#secret').value.trim();
  try { sessionStorage.setItem('bt_admin', secret); } catch {}
  loadAll();
});

// Published / hidden rows: edit, hide, show, delete.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.row button[data-act]');
  if (!btn) return;
  const row = btn.closest('.row'), id = Number(row.dataset.id), msg = $('.msg', row);
  const act = btn.dataset.act;
  const say = (text, ok = true) => { msg.className = `msg ${ok ? 'ok' : 'err'}`; msg.textContent = text; };

  if (act === 'edit') {
    if ($('.editor', row)) return $('.editor', row).remove();
    btn.disabled = true;
    try {
      const { post } = await api('get', { query: `&id=${id}` });
      row.insertAdjacentHTML('beforeend', editorHtml(post));
      row.querySelectorAll('[data-f]').forEach((el) => {
        const upd = () => counter(el, ...LIMITS[el.dataset.f]);
        el.addEventListener('input', upd); upd();
      });
    } catch (err) { say(err.message, false); }
    btn.disabled = false;
    return;
  }
  if (act === 'cancel') return $('.editor', row)?.remove();
  if (act === 'save') {
    const body = { id };
    row.querySelectorAll('[data-f]').forEach((el) => (body[el.dataset.f] = el.value));
    btn.disabled = true;
    try {
      await api('update', { method: 'POST', body });
      say('Saved. The live page updates within about a minute.');
      await loadManaged();
    } catch (err) { say(err.message, false); btn.disabled = false; }
    return;
  }
  if (act === 'hide' && !confirm('Hide this post? It comes off the blog and sitemap but is kept, so you can show it again.')) return;
  if (act === 'delete' && !confirm('Delete this post permanently? The text and cover image are removed and cannot be recovered.')) return;
  row.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await api(act, { method: 'POST', body: { id } });
    await loadManaged();
  } catch (err) {
    say(err.message, false);
    row.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
});

// Pending drafts (only when review is switched on).
$('#pending').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-review]');
  if (!btn) return;
  const card = btn.closest('.card'), msg = $('.msg', card);
  if (btn.dataset.review === 'reject' && !confirm('Reject this draft?')) return;
  card.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await api('review', { method: 'POST', body: { id: card.dataset.id, decision: btn.dataset.review } });
    await loadAll();
  } catch (err) {
    msg.className = 'msg err'; msg.textContent = err.message;
    card.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
});

if (secret) loadAll();
