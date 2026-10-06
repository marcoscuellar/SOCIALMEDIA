import { $, $$, S, esc, api, bpath, current, postById, flush, flushAll, hasUnsaved, onConflict, savePlace, setStatus, banner, toast, isDone } from './core.js';
import { ask } from './ui.js';
import { renderToday, renderConflict, bindToday, refreshChrome } from './today.js';
import { renderPlan, bindPlan, createPostFlow } from './plan.js';
import { renderFiles, bindFiles } from './files.js';
import { renderBrand, bindBrand, discardDraft } from './brand.js';
import { renderVoice } from './voice.js';

const NEW = '__new';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* optional */ } } };

function stepFor(p, wanted) { const max = p.imageReady ? 3 : p.approved ? 2 : 1; return Math.min(wanted || max, max); }
const suggested = () => S.posts.find((p) => !p.paused && !isDone(p)) || S.posts[0] || null;

export function render() {
  $$('#nav [data-view]').forEach((b) => (b.dataset.view === S.view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (S.view === 'voice') return renderVoice();
  if (!S.brand) return renderOnboarding();
  ({ today: renderToday, plan: renderPlan, files: renderFiles, brand: renderBrand })[S.view]();
}

function renderOnboarding() {
  $('#content').innerHTML = `<div class="card empty"><div class="eyebrow">Welcome</div><h1>Add your first brand.</h1><p class="muted">Each brand gets its own posts, files, calendar, voice, return note and posting history. You can add more any time.</p>
  <div class="actions" style="justify-content:center"><button class="btn primary" id="addFirst" type="button">Add a brand</button>${S.starterAvailable ? '<button class="btn" id="starter" type="button">Load the NÈNÈMI starter (21 drafts + voice)</button>' : ''}</div>
  ${S.legacyDataPresent ? '<p class="note">Existing Launch Room data was found in this database. Follow the migration guide (docs/MIGRATION.md) to bring it in safely rather than starting fresh.</p>' : ''}</div>`;
  $('#addFirst').onclick = addBrand;
  if ($('#starter')) $('#starter').onclick = async () => { try { setStatus('Loading…'); await api('POST', '/api/setup/nenemi-starter', {}); await boot(); toast('NÈNÈMI starter loaded.'); } catch (e) { toast(e.message); setStatus('Saved'); } };
}

async function addBrand() {
  const d = $('#dlg');
  d.innerHTML = `<h2 id="dlgTitle">Add a brand</h2><label for="nb_name">Brand name</label><input id="nb_name" type="text" maxlength="100"><label for="nb_desc">One-line description (optional)</label><textarea id="nb_desc" rows="2" maxlength="2000"></textarea><p class="small muted">You’ll add voice, colors, fonts and logo next.</p><div class="actions"><button class="btn primary" id="nb_ok" type="button">Create brand</button><button class="btn link" id="nb_cancel" type="button">Cancel</button></div>`;
  d.setAttribute('aria-labelledby', 'dlgTitle');
  const created = await new Promise((resolve) => {
    d.onclose = () => resolve(null);
    $('#nb_cancel').onclick = () => d.close();
    $('#nb_ok').onclick = async () => { try { const r = await api('POST', '/api/brands', { name: $('#nb_name').value, profile: { description: $('#nb_desc').value } }); d.onclose = null; d.close(); resolve(r.brand); } catch (e) { toast(e.message); } };
    d.showModal(); $('#nb_name').focus();
  });
  if (!created) { refreshSwitcher(); return; }
  S.brands.push(created); await switchBrand(created.id, 'brand'); toast(`${created.name} created. Add its voice and look.`);
}

export function refreshSwitcher() {
  const sel = $('#brandSwitch'); const act = S.brands.filter((b) => b.status === 'active'), arch = S.brands.filter((b) => b.status === 'archived');
  sel.innerHTML = `${act.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}${arch.length ? `<optgroup label="Archived">${arch.map((b) => `<option value="${esc(b.id)}">${esc(b.name)} (archived)</option>`).join('')}</optgroup>` : ''}<option value="${NEW}">＋ Add brand…</option>`;
  if (S.brandId) sel.value = S.brandId; else if (!S.brands.length) sel.innerHTML = `<option value="">No brands yet</option><option value="${NEW}">＋ Add brand…</option>`;
}

async function loadBrandData(id) {
  const [b, p, f] = await Promise.all([api('GET', bpath('', id)), api('GET', bpath('/posts', id)), api('GET', bpath('/files', id))]);
  if (S.brandId !== id) return false; // the person switched again while this loaded; ignore stale data
  S.brand = b.brand; S.posts = p.posts; S.files = f.files; S.excerpts = f.excerpts; return true;
}
export async function switchBrand(id, view) {
  if (!(await flushAll())) { toast('Resolve the unsaved change before switching brands.'); refreshSwitcher(); return; }
  discardDraft(); S.conflicts.clear(); S.brandId = id; store.set('lr-brand', id); S.brand = null; S.posts = []; S.files = []; S.excerpts = []; S.selectedId = null;
  refreshSwitcher(); setStatus('Loading…'); $('#content').innerHTML = '<p class="muted">Opening…</p>';
  try {
    if (!(await loadBrandData(id))) return;
    const keep = S.posts.find((p) => p.id === S.brand.lastPostId); const p = keep || suggested();
    S.selectedId = p?.id || null; S.step = p ? stepFor(p, keep ? S.brand.lastStep : 0) : 1; S.platform = 'linkedin'; S.month = null;
    S.view = view || (S.view === 'voice' ? 'today' : S.view); setStatus('Saved'); banner(''); render();
  } catch (e) { $('#content').innerHTML = `<div class="card"><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; setStatus('Not loaded'); }
}

async function choose(id) {
  if (!(await flushAll())) return toast('Resolve the unsaved change first.');
  const p = postById(id); if (!p) return;
  if (p.paused) { /* opening a set-aside post brings it back */ }
  S.selectedId = id; S.step = stepFor(p, 0); S.view = 'today'; S.platform = 'linkedin';
  savePlace(S.brandId, { lastPostId: id, lastStep: S.step }); render(); window.scrollTo({ top: 0 }); $('#main').focus();
}
async function reloadPosts() { const id = S.brandId; const r = await api('GET', bpath('/posts', id)); if (S.brandId === id) S.posts = r.posts; }
async function reloadFiles() { const id = S.brandId; const r = await api('GET', bpath('/files', id)); if (S.brandId === id) { S.files = r.files; S.excerpts = r.excerpts; } }
async function reloadBrand() { const id = S.brandId; await loadBrandData(id); }
async function newPost(date = '') {
  const p = await createPostFlow(date); if (!p) return;
  S.posts.push(p); S.posts.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  await choose(p.id); toast('New post created. Start with the words.');
}
const ctl = { rerender: () => render(), reloadPosts, reloadFiles, reloadBrand, newPost, choose, go: (v) => { S.view = v; render(); }, refreshSwitcher };
bindToday(ctl); bindPlan(ctl); bindFiles(ctl); bindBrand(ctl);
onConflict((id) => { if (S.view === 'today' && current()?.id === id) renderConflict(current()); else banner('A post changed in another tab. Open it to choose which version to keep.'); });

async function boot() {
  setStatus('Opening…');
  try {
    const d = await api('GET', '/api/bootstrap');
    Object.assign(S, { caps: d.capabilities, brands: d.brands, founder: d.founder, usage: d.usage, starterAvailable: d.starterAvailable, legacyDataPresent: d.legacyDataPresent });
    const saved = store.get('lr-brand'); const pick = S.brands.find((b) => b.id === saved && b.status === 'active') || S.brands.find((b) => b.status === 'active') || S.brands[0];
    refreshSwitcher();
    if (!pick) { S.brandId = null; S.brand = null; setStatus('Saved'); return render(); }
    await switchBrand(pick.id, 'today');
  } catch (e) {
    if (e.status === 503 && /not set up yet/.test(e.message)) {
      $('#content').innerHTML = `<div class="card empty"><div class="eyebrow">First-time setup</div><h1>Set up your database.</h1><p class="muted">This creates the empty tables Launch Room needs. It doesn’t touch any other data and is safe to press twice.</p><div class="actions" style="justify-content:center"><button class="btn primary" id="setupDb" type="button">Set up database</button></div></div>`;
      $('#setupDb').onclick = async () => { $('#setupDb').disabled = true; try { await api('POST', '/api/setup/database', {}); toast('Database ready.'); await boot(); } catch (err) { toast(err.message); $('#setupDb').disabled = false; } };
      return setStatus('Setup needed');
    }
    $('#content').innerHTML = `<div class="card"><h2>Your room couldn’t open.</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; setStatus('Not loaded');
  }
}

$$('#nav [data-view]').forEach((b) => (b.onclick = async () => { if (!(await flushAll())) return toast('Resolve the unsaved change first.'); S.view = b.dataset.view; render(); $('#main').focus(); }));
$('#brandSwitch').onchange = (e) => { if (e.target.value === NEW) return addBrand(); if (e.target.value && e.target.value !== S.brandId) switchBrand(e.target.value); };
const themeBtn = $('#themeBtn');
function applyTheme(t) { document.documentElement.dataset.theme = t; themeBtn.textContent = t === 'dark' ? 'Light' : 'Dark'; themeBtn.setAttribute('aria-label', `Switch to ${t === 'dark' ? 'light' : 'dark'} appearance`); }
applyTheme(document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
themeBtn.onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(t); store.set('lr-theme', t); };
window.addEventListener('beforeunload', (e) => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } });
// Pick up edits made in another tab when this one is idle and fully saved.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !S.brandId || hasUnsaved() || S.view !== 'today' || S.reviewBusy) return;
  const before = current(); const rev = before?.revision; const id = S.brandId;
  try { await reloadPosts(); if (S.brandId === id && current() && current().revision !== rev) { render(); toast('Updated from another tab.'); } } catch { /* silent */ }
});
boot();
