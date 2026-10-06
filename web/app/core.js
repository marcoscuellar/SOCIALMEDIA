// Shared state, API access and the save engine. No framework: views re-render from this state.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class ApiError extends Error { constructor(status, message, data) { super(message); this.status = status; this.data = data || {}; } }
export async function api(method, path, body, headers = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body instanceof Blob || body instanceof ArrayBuffer) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(path, opts); } catch { throw new ApiError(0, 'Could not reach the server. Check your connection; your edits are still on this page.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error || 'Something went wrong.', data);
  return data;
}

export const S = {
  caps: null, brands: [], founder: null, usage: null, starterAvailable: false, legacyDataPresent: false,
  brandId: null, brand: null, posts: [], files: [], excerpts: [], history: [], loadingBrand: false,
  view: 'today', step: 1, platform: 'linkedin', month: null, selectedId: null, reviewBusy: false, uploadBusy: false,
  conflicts: new Map(),
};
export const brandById = (id) => S.brands.find((b) => b.id === id);
export const postById = (id) => S.posts.find((p) => p.id === id);
export const current = () => postById(S.selectedId) || null;
export const bpath = (suffix = '', id = S.brandId) => `/api/brands/${encodeURIComponent(id)}${suffix}`;
export const fileUrl = (f, download = false, brandId = S.brandId) => `/api/brands/${encodeURIComponent(brandId)}/files/${encodeURIComponent(f.id)}${download ? '?download=1' : ''}`;
export const isImg = (f) => ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(f.type);

let toastTimer;
export function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 5000); }
export function setStatus(s) { $('#saveStatus').textContent = s; }
export function banner(msg) { const b = $('#banner'); if (!msg) { b.classList.add('hidden'); return; } b.textContent = msg; b.classList.remove('hidden'); }

export function fmtDate(s, long = false) {
  if (!s) return 'Unscheduled';
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', long ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', weekday: 'short' });
}
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function postStatus(p) {
  if (p.postedLinkedinAt && p.postedInstagramAt) return 'Posted';
  if (p.postedLinkedinAt || p.postedInstagramAt) return 'Posted on one';
  if (p.paused) return 'Set aside';
  if (p.imageReady) return 'Ready to post';
  if (p.approved) return 'Caption approved';
  return 'Draft';
}
export const isDone = (p) => !!(p.postedLinkedinAt && p.postedInstagramAt);

// ---------- save engine (per-post, revision-checked) ----------
const pending = new Map(), inflight = new Map(), timers = new Map();
export const hasUnsaved = () => pending.size > 0 || inflight.size > 0;
let onChange = () => {};
export const onConflict = (fn) => { onChange = fn; };

function applyLocal(post, ch) {
  for (const [k, v] of Object.entries(ch)) {
    if (k === 'graphic') post.graphic = { ...post.graphic, ...v };
    else if (k === 'reviewQuestions') post.reviewQuestions = { ...post.reviewQuestions, ...v };
    else post[k] = v;
  }
  if ('linkedin' in ch || 'instagram' in ch) { post.approved = false; post.imageReady = false; post.needs = { voiceReview: false, styleReview: false }; }
  else if ('graphic' in ch) post.imageReady = false;
}
export function editPost(postId, changes) {
  const post = postById(postId); if (!post) return;
  const merged = { ...(pending.get(postId) || {}) };
  for (const [k, v] of Object.entries(changes)) merged[k] = (k === 'graphic' || k === 'reviewQuestions') ? { ...(merged[k] || {}), ...v } : v;
  pending.set(postId, merged);
  applyLocal(post, changes);
  setStatus('Unsaved changes');
  clearTimeout(timers.get(postId)); timers.set(postId, setTimeout(() => flush(postId), 700));
}
function mergeServer(server) {
  const i = S.posts.findIndex((p) => p.id === server.id);
  if (i < 0) return server;
  const local = { ...server };
  const left = pending.get(server.id); if (left) applyLocal(local, left);
  S.posts[i] = local; return local;
}
export async function flush(postId) {
  clearTimeout(timers.get(postId));
  if (inflight.has(postId)) await inflight.get(postId);
  const changes = pending.get(postId);
  if (!changes) { if (!hasUnsaved()) setStatus('Saved'); return true; }
  if (S.conflicts.has(postId)) return false;
  pending.delete(postId);
  const post = postById(postId); if (!post) return true;
  const run = (async () => {
    setStatus('Saving…');
    try {
      const d = await api('PATCH', bpath(`/posts/${encodeURIComponent(postId)}`, post.brandId), { revision: post.revision, changes });
      mergeServer(d.post); banner(''); return true;
    } catch (e) {
      if (e.status === 409 && e.data.current) { S.conflicts.set(postId, { mine: { ...changes, ...(pending.get(postId) || {}) }, theirs: e.data.current }); pending.delete(postId); setStatus('Needs a choice'); onChange(postId); return false; }
      pending.set(postId, { ...changes, ...(pending.get(postId) || {}) });
      setStatus('Not saved'); banner(e.message + ' Your edits are still on this page. They will save when you make the next change or press “Save again”.'); return false;
    }
  })();
  inflight.set(postId, run);
  const ok = await run; inflight.delete(postId);
  if (ok && pending.has(postId)) return flush(postId);
  if (ok && !hasUnsaved()) setStatus('Saved');
  return ok;
}
export const flushAll = async () => { let ok = true; for (const id of [...pending.keys()]) ok = (await flush(id)) && ok; return ok; };
export function resolveConflict(postId, keepMine) {
  const c = S.conflicts.get(postId); if (!c) return;
  S.conflicts.delete(postId);
  const i = S.posts.findIndex((p) => p.id === postId); S.posts[i] = c.theirs;
  if (keepMine) { editPost(postId, c.mine); flush(postId); } else setStatus('Saved');
}
export async function postAction(postId, action, extra = {}) {
  const ok = await flush(postId); if (!ok) { toast('Resolve the unsaved change first.'); return null; }
  const post = postById(postId);
  try {
    const d = await api('POST', bpath(`/posts/${encodeURIComponent(postId)}/actions/${action}`, post.brandId), { revision: post.revision, ...extra });
    mergeServer(d.post); return postById(postId);
  } catch (e) {
    if (e.status === 409 && e.data.current) { S.conflicts.set(postId, { mine: {}, theirs: e.data.current }); onChange(postId); } else toast(e.message);
    return null;
  }
}
// The brand id is passed explicitly so a note typed in one brand can never be saved into another.
export async function savePlace(brandId, patch) {
  try {
    const d = await api('PUT', bpath('/place', brandId), patch);
    const i = S.brands.findIndex((b) => b.id === brandId); if (i >= 0) S.brands[i] = d.brand;
    if (S.brandId === brandId) S.brand = d.brand;
    return true;
  } catch { return false; }
}
