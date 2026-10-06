import { $, $$, S, esc, api, bpath, editPost, flush, fmtDate, postStatus, todayStr, isDone, toast } from './core.js';

let ctl;
export const bindPlan = (c) => { ctl = c; };
const pad = (n) => String(n).padStart(2, '0');

export async function createPostFlow(date = '') {
  const d = $('#dlg'); let voice = 'brand';
  d.innerHTML = `<h2 id="dlgTitle">New post in ${esc(S.brand.name)}</h2><label for="np_title">Title (optional)</label><input id="np_title" type="text" maxlength="200" placeholder="What is this post about?">
  <label for="np_date">Date (optional)</label><input id="np_date" type="date" value="${esc(date)}"><p class="small muted">Leave the date empty to keep it in your draft queue.</p>
  <label>Voice</label><div class="seg" role="group" aria-label="Voice">${[['brand', S.brand.name], ['founder', 'Personal'], ['both', 'Both']].map(([v, n], i) => `<button type="button" data-v="${v}" aria-pressed="${i === 0}">${esc(n)}</button>`).join('')}</div>
  <div class="actions"><button class="btn primary" id="np_ok" type="button">Create post</button><button class="btn link" id="np_cancel" type="button">Cancel</button></div>`;
  d.setAttribute('aria-labelledby', 'dlgTitle');
  $$('[data-v]', d).forEach((b) => (b.onclick = () => { voice = b.dataset.v; $$('[data-v]', d).forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  return new Promise((resolve) => {
    d.onclose = () => resolve(null);
    $('#np_cancel').onclick = () => d.close();
    $('#np_ok').onclick = async () => {
      try {
        const r = await api('POST', bpath('/posts'), { title: $('#np_title').value, date: $('#np_date').value || null, voiceMode: voice });
        d.onclose = null; d.close(); resolve(r.post);
      } catch (e) { toast(e.message); }
    };
    d.showModal(); $('#np_title').focus();
  });
}

export function renderPlan() {
  if (!S.month) { const t = todayStr(); S.month = t.slice(0, 7); }
  const [y, m] = S.month.split('-').map(Number); const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
  const byDate = {}; for (const p of S.posts) if (p.date) (byDate[p.date] ||= []).push(p);
  const monthName = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const lead = first.getDay(); const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div></div>');
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(m)}-${pad(d)}`; const list = byDate[ds] || [];
    cells.push(`<div class="day ${ds === todayStr() ? 'today' : ''}" role="group" aria-label="${fmtDate(ds, true)}"><button type="button" class="btn link" style="min-height:32px;padding:0;text-decoration:none;color:var(--muted);text-align:left" data-newday="${ds}" aria-label="New post on ${fmtDate(ds, true)}"><span class="n">${d} <span aria-hidden="true">＋</span></span></button>${list.map((p) => `<button type="button" class="chip ${isDone(p) ? 'done' : ''}" data-open="${p.id}" title="${esc(p.title)}">${esc(p.title || 'Untitled')}</button>`).join('')}</div>`);
  }
  const monthPosts = Object.entries(byDate).filter(([d]) => d.startsWith(S.month)).sort();
  const open = S.posts.filter((p) => !isDone(p));
  const unscheduled = S.posts.filter((p) => !p.date && !isDone(p));
  const scheduled = open.filter((p) => p.date);
  const posted = S.posts.filter((p) => p.postedLinkedinAt || p.postedInstagramAt);
  $('#content').innerHTML = `
  <div class="row between" style="margin-bottom:18px"><div><div class="eyebrow">${esc(S.brand.name)} · calendar and drafts</div><h1>Plan, at your pace.</h1><p class="muted">Dates are suggestions. Move things as life happens; there is no catching up to do.</p></div>
  <div class="row"><button class="btn primary" id="newpost" type="button">New post</button><button class="btn" id="backup" type="button">Export backup</button></div></div>
  <section class="card" aria-label="Calendar"><div class="row between"><h2 style="margin:0">${monthName}</h2><div class="row"><button class="btn small" id="prevm" type="button" aria-label="Previous month">‹ Prev</button><button class="btn small" id="thism" type="button">Today</button><button class="btn small" id="nextm" type="button" aria-label="Next month">Next ›</button></div></div>
  <div class="cal" style="margin-top:14px">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>
  <div class="agenda">${monthPosts.length ? monthPosts.map(([d, l]) => `<div class="qitem"><strong style="min-width:110px">${fmtDate(d)}</strong>${l.map((p) => `<button class="btn small" data-open="${p.id}" type="button">${esc(p.title || 'Untitled')}</button>`).join('')}</div>`).join('') : '<p class="muted">Nothing scheduled this month.</p>'}<div class="qitem"><button class="btn small" data-newday="" type="button">New post</button></div></div></section>
  <section class="card" aria-label="Draft queue"><h2>Draft queue</h2><p class="muted small">Anything not posted yet. Set a date, change it, or leave it unscheduled.</p>
  ${[...unscheduled, ...scheduled].length ? [...unscheduled, ...scheduled].map((p) => `<div class="qitem"><div class="t"><button class="btn link" data-open="${p.id}" style="color:var(--text);font-weight:600;text-align:left" type="button">${esc(p.title || 'Untitled')}</button><div class="small muted">${esc(p.kind || '')} ${p.kind ? '·' : ''} ${p.date ? fmtDate(p.date) : 'Unscheduled'}</div></div><span class="pill ${p.imageReady || p.approved ? 'ok' : ''}">${postStatus(p)}</span><label class="sr-only" for="d_${p.id}">Date for ${esc(p.title)}</label><input type="date" id="d_${p.id}" data-date="${p.id}" value="${esc(p.date || '')}"><button class="btn small" data-clear="${p.id}" type="button" ${p.date ? '' : 'hidden'}>Unschedule</button></div>`).join('') : '<p class="muted">No drafts waiting. Create a new post for any date.</p>'}</section>
  <section class="card" aria-label="Posting history"><h2>Posting history</h2>${posted.length ? posted.map((p) => `<div class="qitem"><div class="t"><button class="btn link" data-open="${p.id}" style="color:var(--text);font-weight:600" type="button">${esc(p.title)}</button></div>${p.postedLinkedinAt ? `<span class="pill ok">LinkedIn · ${new Date(p.postedLinkedinAt).toLocaleDateString()}</span>` : ''}${p.postedInstagramAt ? `<span class="pill ok">Instagram · ${new Date(p.postedInstagramAt).toLocaleDateString()}</span>` : ''}</div>`).join('') : '<p class="muted">Nothing marked as posted yet.</p>'}</section>`;
  const shift = (n) => { const dt = new Date(y, m - 1 + n, 1); S.month = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`; renderPlan(); };
  $('#prevm').onclick = () => shift(-1); $('#nextm').onclick = () => shift(1); $('#thism').onclick = () => { S.month = todayStr().slice(0, 7); renderPlan(); };
  $('#newpost').onclick = () => ctl.newPost('');
  $$('[data-newday]').forEach((b) => (b.onclick = () => ctl.newPost(b.dataset.newday)));
  $$('[data-open]').forEach((b) => (b.onclick = () => ctl.choose(b.dataset.open)));
  $$('[data-date]').forEach((i) => (i.onchange = async () => { editPost(i.dataset.date, { date: i.value || null }); await flush(i.dataset.date); renderPlan(); toast('Date updated. No catching up needed.'); }));
  $$('[data-clear]').forEach((b) => (b.onclick = async () => { editPost(b.dataset.clear, { date: null }); await flush(b.dataset.clear); renderPlan(); toast('Moved to unscheduled.'); }));
  $('#backup').onclick = async () => {
    try { const d = await api('GET', '/api/backup'); const u = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = u; a.download = `launch-room-backup-${todayStr()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 3000); toast('Backup downloaded (all brands; file bytes not included).'); } catch (e) { toast(e.message); }
  };
}
