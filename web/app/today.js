import { $, $$, S, esc, api, bpath, fileUrl, isImg, current, postById, editPost, flush, postAction, resolveConflict, toast, fmtDate, postStatus, savePlace, setStatus, banner, isDone } from './core.js';
import { ask, form, sizeText } from './ui.js';
import { renderGraphic, exportPng, exportSlides, slideCount, FORMATS, palette } from './graphics.js';
import { buildZip, buildPdf } from './carousel.js';

let ctl = { rerender: () => {}, reloadFiles: async () => {}, go: () => {}, choose: () => {} };
export const bindToday = (c) => { ctl = c; };
let noteTimer, previewTimer;

const filesFor = (p) => S.files.filter((f) => !f.postId || f.postId === p.id);
const imagesFor = (p) => filesFor(p).filter((f) => isImg(f) && ['attachment', 'reference'].includes(f.role));
const voiceLabel = { brand: 'Brand voice', founder: 'My voice', both: 'Both' };
const PLATFORM_TIP = {
  linkedin: 'LinkedIn tip: the audience likes document-style, easy-to-skim posts (a step-by-step carousel does well). Open with a hook line, keep warm and plain, and use real detail over polish.',
  instagram: 'Instagram tip: carousels (about 5 to 10 slides) tend to beat single images. Make slide 1 stop the scroll, and give people a reason to save or send it. Real and a little imperfect beats glossy.',
};
const platformName = (k) => (k === 'linkedin' ? 'LinkedIn' : 'Instagram');
const nextDraft = (p) => S.posts.find((x) => x.id !== p.id && !x.paused && !isDone(x));

export function renderToday() {
  const p = current(); const el = $('#content');
  if (!p) {
    el.innerHTML = `<div class="card empty"><h1>No posts in ${esc(S.brand.name)} yet.</h1><p class="muted">Start one for any date, or leave it unscheduled.</p><button class="btn primary" id="firstPost" type="button">New post</button></div>`;
    $('#firstPost').onclick = () => ctl.newPost(); return;
  }
  const nx = nextDraft(p);
  el.innerHTML = `
  <div class="row between" style="margin-bottom:18px"><div><div class="eyebrow">${esc(S.brand.name)} · your place is kept</div><h1>One post. One small move.</h1><p class="muted" id="lede"></p></div><button class="btn small" id="pause" type="button">${p.paused ? 'Bring back' : 'Set this aside'}</button></div>
  <div id="conflict"></div>
  <div class="grid2"><div><section class="card" aria-label="Post editor">
    <label for="ptitle" class="sr-only">Post title</label><input type="text" id="ptitle" maxlength="200" value="${esc(p.title)}" placeholder="Title for this post" style="font-weight:650;font-size:1.15rem">
    <div class="row between" style="margin-top:10px"><span class="small muted">${esc(p.kind || 'Post')}</span><div class="row"><label for="pdate" class="sr-only">Post date</label><input type="date" id="pdate" value="${esc(p.date || '')}" style="width:auto"><button class="btn link" id="cleardate" type="button" ${p.date ? '' : 'hidden'}>Unschedule</button><span class="pill" id="pstatus"></span></div></div>
    <div class="steps" role="group" aria-label="Post steps" style="margin-top:14px">${['Caption', 'Image', 'Post it'].map((s, i) => `<button type="button" data-step="${i + 1}">${i + 1}. ${s}</button>`).join('')}</div>
    <div id="stepbody"></div>
  </section><section class="card" id="attachments" aria-label="Files for this post"></section></div>
  <aside class="stack"><section class="preview" aria-label="Image preview"><div class="row between small muted" style="margin-bottom:10px"><span id="prevLabel">IMAGE PREVIEW</span><span>4:5 portrait</span></div><div id="prevBox"></div></section>
  <section class="card"><h3>Leave your place here.</h3><p class="muted small">A note for when you come back to ${esc(S.brand.name)}.</p><label for="returnnote" class="sr-only">Where I left off</label><textarea id="returnnote" rows="4" maxlength="10000" placeholder="I was working on… Next, I want to…">${esc(S.brand.note)}</textarea><p class="muted small" style="margin:8px 0 0" id="noteStatus">Saved with this brand.</p></section>
  ${nx ? `<div class="card"><div class="eyebrow">When you’re ready</div><h3>${esc(nx.title)}</h3><button class="btn small" id="nextpost" type="button">Open next draft</button></div>` : ''}</aside></div>`;
  bindHeader(p); renderStepBody(); renderAttachments(); refreshChrome(); drawPreview();
  if (nx) $('#nextpost').onclick = () => ctl.choose(nx.id);
  const note = $('#returnnote'); const brandId = S.brandId;
  note.oninput = () => { $('#noteStatus').textContent = 'Saving…'; clearTimeout(noteTimer); noteTimer = setTimeout(async () => { $('#noteStatus') && ($('#noteStatus').textContent = (await savePlace(brandId, { note: note.value })) ? 'Saved with this brand.' : 'Not saved yet. It will retry on your next edit.'); }, 800); };
  renderConflict(p);
}

function bindHeader(p) {
  $('#pause').onclick = async () => { editPost(p.id, { paused: !p.paused }); await flush(p.id); ctl.go(p.paused ? 'today' : 'plan'); toast(p.paused ? 'Set aside. You can return anytime.' : 'Back in your plan.'); };
  $('#ptitle').oninput = (e) => editPost(p.id, { title: e.target.value });
  $('#pdate').onchange = (e) => { editPost(p.id, { date: e.target.value || null }); $('#cleardate').hidden = !e.target.value; };
  $('#cleardate').onclick = () => { editPost(p.id, { date: null }); $('#pdate').value = ''; $('#cleardate').hidden = true; };
  $$('[data-step]').forEach((b) => (b.onclick = () => { S.step = +b.dataset.step; savePlace(S.brandId, { lastStep: S.step }); renderStepBody(); refreshChrome(); }));
}

export function renderConflict(p) {
  const box = $('#conflict'); if (!box) return;
  const c = S.conflicts.get(p.id); if (!c) { box.innerHTML = ''; return; }
  const keys = Object.keys(c.mine).filter((k) => typeof c.mine[k] !== 'object' || k === 'graphic');
  box.innerHTML = `<div class="banner" role="alert"><strong>This post was changed somewhere else (another tab or device).</strong><p class="small">Nothing has been overwritten. ${keys.length ? 'You have unsaved changes on this page.' : 'The latest version is shown below.'}</p>
  ${keys.map((k) => `<details><summary>${esc(k)}</summary><p class="small"><strong>Yours:</strong> ${esc(typeof c.mine[k] === 'object' ? JSON.stringify(c.mine[k]) : c.mine[k])}</p><p class="small"><strong>Theirs:</strong> ${esc(typeof c.theirs[k] === 'object' ? JSON.stringify(c.theirs[k]) : c.theirs[k])}</p></details>`).join('')}
  <div class="actions"><button class="btn primary" type="button" id="keepMine" ${keys.length ? '' : 'hidden'}>Keep my version</button><button class="btn" type="button" id="useTheirs">Use the other version</button></div></div>`;
  $('#keepMine').onclick = () => { resolveConflict(p.id, true); ctl.rerender(); };
  $('#useTheirs').onclick = () => { resolveConflict(p.id, false); ctl.rerender(); };
}

// Updates status text, step buttons and approval-dependent pieces without replacing the textarea being typed in.
export function refreshChrome() {
  const p = current(); if (!p || S.view !== 'today') return;
  $('#pstatus').textContent = postStatus(p); $('#pstatus').className = 'pill ' + (p.approved ? 'ok' : '');
  $('#lede').textContent = p.approved ? (p.imageReady ? 'Everything is ready for you to post.' : 'Your caption is approved. Let’s give it an image.') : 'Start with the words. Everything else can wait.';
  $$('[data-step]').forEach((b) => { const n = +b.dataset.step; b.disabled = (n >= 2 && !p.approved) || (n === 3 && !p.imageReady); if (n === S.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  const ab = $('#approve'); if (ab) { ab.disabled = !p.linkedin.trim() || !p.instagram.trim(); ab.textContent = p.approved ? 'Captions approved ✓' : bothReviewed(p) ? 'AI reviewed · I approve both' : 'I approve both captions'; ab.disabled = ab.disabled || p.approved; }
  const rv = $('#reviewBadge'); if (rv) setBadge(rv, p);
  // Keep the visible review result honest while typing: stale feedback must not look current.
  const rr = $('#reviewresult'), r = reviewOf(p);
  if (rr && r && (rr.dataset.stale || '') !== (r.stale || '')) { const open = rr.querySelector('details')?.open; renderResult(p, r); if (open) rr.querySelector('details').open = true; }
}

// ---------- AI review helpers ----------
// Staleness is also computed locally so an edit marks the review stale immediately, before the server round trip.
const reviewOf = (p, k = S.platform) => { const r = p.reviews?.[k]; if (!r) return r; return r.stale ? r : r.caption !== undefined && r.caption !== p[k] ? { ...r, stale: 'caption' } : r; };
const reviewFresh = (p, k) => { const r = reviewOf(p, k); return !!r && !r.stale; };
const bothReviewed = (p) => ['linkedin', 'instagram'].every((k) => reviewFresh(p, k) && reviewOf(p, k).ready);
function setBadge(el, p) {
  const r = reviewOf(p);
  const [text, cls] = !r ? [S.caps.ai ? 'Not reviewed' : 'AI not connected', ''] : r.stale === 'caption' ? ['Caption changed since review', 'warn'] : r.stale === 'voice' ? ['Voice changed since review', 'warn'] : r.ready ? ['AI: ready', 'ok'] : ['AI: suggestions', ''];
  el.textContent = text; el.className = 'pill ' + cls;
}

function voiceChooser(p) {
  const founderName = S.founder?.name || 'My voice';
  return `<div class="row between"><div><label style="margin:0">Voice for this post</label></div><div class="seg" role="group" aria-label="Voice for this post">${['brand', 'founder', 'both'].map((m) => `<button type="button" data-voice="${m}" aria-pressed="${p.voiceMode === m}">${m === 'brand' ? esc(S.brand.name) + ' voice' : m === 'founder' ? esc(founderName.replace(/ \(founder voice\)/, '')) + ' · personal' : 'Both'}</button>`).join('')}</div></div>`;
}

export function renderStepBody() {
  const p = current(); const box = $('#stepbody'); if (!p) return;
  if (S.step === 1) renderCaption(p, box); else if (S.step === 2) renderImage(p, box); else renderPost(p, box);
}

function platformTabs() { return `<div class="seg" role="group" aria-label="Caption platform">${['linkedin', 'instagram'].map((k) => `<button type="button" data-platform="${k}" aria-pressed="${S.platform === k}">${platformName(k)}</button>`).join('')}</div>`; }
function bindPlatform() { $$('[data-platform]').forEach((b) => (b.onclick = () => { S.platform = b.dataset.platform; renderStepBody(); })); }

function renderCaption(p, box) {
  const k = S.platform;
  box.innerHTML = `${voiceChooser(p)}
  ${p.approved && p.needs.voiceReview ? `<div class="note warn" id="voiceNote"><strong>Voice guidance changed since you approved this.</strong> Nothing was edited. Take another look, then confirm or change it. <div class="actions"><button type="button" class="btn small" id="reconfirm">Still good — keep my approval</button></div></div>` : ''}
  <div class="row between" style="margin-top:16px">${platformTabs()}<span class="small muted" id="count"></span></div>
  <p class="small muted" id="platformTip" style="margin:12px 0 0">${esc(PLATFORM_TIP[k])} <span class="muted">(Industry-research tendencies, not guarantees.)</span></p>
  <label for="caption" class="sr-only">${platformName(k)} caption</label><textarea id="caption" style="margin-top:12px" placeholder="Write your ${platformName(k)} caption. It’s yours; nothing here is sent anywhere until you ask for a review.">${esc(p[k])}</textarea>
  <div class="small muted" style="margin-top:8px">Editable draft. Editing a caption clears its approval so you always approve the final words.</div>
  <details class="box" id="reviewbox" open><summary>Second pair of eyes <span id="reviewBadge" class="pill"></span></summary><div id="reviewbody"></div></details>
  <div class="actions"><button class="btn primary" id="approve" type="button">I approve both captions</button><button class="btn" id="copy" type="button">Copy ${platformName(k)} caption</button>${p.approved ? '<button class="btn link" id="unapprove" type="button">Take back approval</button>' : ''}</div>
  ${p.approved ? '' : '<p class="small muted" style="margin-top:10px">AI review is optional. Approval is always yours.</p>'}`;
  $$('[data-voice]').forEach((b) => (b.onclick = () => { editPost(p.id, { voiceMode: b.dataset.voice }); flush(p.id).then(() => { renderStepBody(); refreshChrome(); }); }));
  bindPlatform();
  const ta = $('#caption'); const count = () => ($('#count').textContent = ta.value.length + ' characters');
  count();
  ta.oninput = () => { editPost(p.id, { [k]: ta.value }); count(); refreshChrome(); drawPreview(); $('#voiceNote')?.remove(); };
  $('#approve').onclick = async () => { const r = await postAction(p.id, 'approve'); if (r) { S.step = 2; savePlace(S.brandId, { lastStep: 2 }); ctl.rerender(); toast('Captions approved. Let’s make the image.'); } };
  $('#copy').onclick = () => copyCaption(p);
  if ($('#unapprove')) $('#unapprove').onclick = async () => { if (await postAction(p.id, 'unapprove')) ctl.rerender(); };
  if ($('#reconfirm')) $('#reconfirm').onclick = async () => { if (await postAction(p.id, 'acknowledge')) { ctl.rerender(); toast('Kept as approved.'); } };
  renderReview(p);
}

async function copyCaption(p) {
  try { await navigator.clipboard.writeText(p[S.platform]); toast('Caption copied.'); } catch { toast('Copy isn’t available here. Select the caption text to copy it.'); S.step = 1; renderStepBody(); $('#caption')?.select(); }
}

function sourceRows(p) {
  const sel = new Set((p.aiSources || []).map((s) => s.type + ':' + s.id));
  const rows = [];
  for (const f of filesFor(p).filter((f) => ['attachment', 'reference'].includes(f.role))) {
    const ok = f.ai.supported; const id = 'src_' + f.id;
    rows.push(`<div class="srcitem"><input type="checkbox" id="${id}" data-src="file:${f.id}" ${sel.has('file:' + f.id) ? 'checked' : ''} ${ok ? '' : 'disabled'}><div style="flex:1;min-width:0"><label for="${id}" style="margin:0;font-weight:600;overflow-wrap:anywhere">${esc(f.name)}</label>
      <div class="small muted">${f.postId ? 'This post' : 'Brand file'} · ${sizeText(f.size)} · ${sel.has('file:' + f.id) ? '<span class="pill ok">Included in AI review</span>' : '<span class="pill">Stored attachment only</span>'}</div>
      <div class="small ${ok ? 'muted' : ''}">${esc(ok ? f.ai.note : f.ai.reason)}</div>
      ${!ok && f.ai.kind !== 'font' ? `<button type="button" class="btn link" data-excerpt-file="${f.id}">${f.ai.excerptOnly ? 'Select an excerpt…' : 'Paste an excerpt…'}</button>` : ''}</div></div>`);
  }
  for (const e of S.excerpts.filter((e) => !e.postId || e.postId === p.id)) {
    const id = 'src_' + e.id;
    rows.push(`<div class="srcitem"><input type="checkbox" id="${id}" data-src="excerpt:${e.id}" ${sel.has('excerpt:' + e.id) ? 'checked' : ''}><div style="flex:1;min-width:0"><label for="${id}" style="margin:0;font-weight:600">Excerpt: ${esc(e.label)}</label><div class="small muted">${e.postId ? 'This post' : 'Brand'} · ${e.body.length} characters · ${sel.has('excerpt:' + e.id) ? '<span class="pill ok">Included in AI review</span>' : '<span class="pill">Stored only</span>'}</div><div class="small muted">${esc(e.body.slice(0, 140))}${e.body.length > 140 ? '…' : ''}</div></div></div>`);
  }
  return rows.join('');
}

function renderReview(p) {
  const k = S.platform; const r = reviewOf(p, k); const body = $('#reviewbody');
  const u = S.usage; const quiet = u && (u.remainingToday <= 2 || u.monthDollars >= 0.8 * u.monthlyLimitDollars) ? `<p class="small muted">${u.remainingToday <= 0 ? 'Today’s AI reviews are used. Editing and approving still work.' : `${u.remainingToday} AI review${u.remainingToday === 1 ? '' : 's'} left today.`}</p>` : '';
  body.innerHTML = `<p class="muted small">Honest feedback on your words. You decide what stays. ${S.caps.ai ? '' : esc(S.caps.aiReason || 'AI is not connected.')}</p>
  <label for="rq">What would you like to check?</label><textarea id="rq" rows="2" maxlength="1000" placeholder="Does this sound like me? Keep it honest, but tighten the ending.">${esc(p.reviewQuestions?.[k] || '')}</textarea>
  <h3 style="margin-top:18px">Sources for AI to read <span class="small muted">(optional)</span></h3>
  <p class="small muted">Files are stored here. Nothing is sent to AI unless you tick it, and only for this review. AI will say which ticked sources support each claim and flag claims with no support.</p>
  <div id="srcs">${sourceRows(p) || '<p class="small muted">No files or excerpts yet. Add some under “Files for this post” below or in the brand’s Files page.</p>'}</div>
  <div class="row"><button class="btn small" type="button" id="addExcerpt">Add a pasted excerpt…</button></div>
  <div class="actions"><button class="btn" id="askreview" type="button" ${!S.caps.ai || S.reviewBusy || !p[k].trim() ? 'disabled' : ''}>${S.reviewBusy ? 'Reading your caption…' : r ? 'Review again' : 'Review with AI'}</button></div>${quiet}
  <div id="reviewresult"></div>`;
  setBadge($('#reviewBadge'), p);
  $('#rq').oninput = (e) => editPost(p.id, { reviewQuestions: { [k]: e.target.value } });
  $$('[data-src]').forEach((c) => (c.onchange = () => {
    const [type, id] = c.dataset.src.split(':'); const cur = (p.aiSources || []).filter((s) => !(s.type === type && s.id === id));
    editPost(p.id, { aiSources: c.checked ? [...cur, { type, id }] : cur }); renderReview(p);
  }));
  $$('[data-excerpt-file]').forEach((b) => (b.onclick = () => excerptFromFile(p, b.dataset.excerptFile)));
  $('#addExcerpt').onclick = () => addExcerpt(p, {});
  $('#askreview').onclick = () => runReview(p);
  if (r) renderResult(p, r);
}

function renderResult(p, r) {
  const k = S.platform; const hist = p.captionHistory?.[k];
  $('#reviewresult').dataset.stale = r.stale || '';
  $('#reviewresult').innerHTML = `<div class="${r.stale ? 'muted' : ''}" style="margin-top:18px"><p><strong>${esc(r.summary)}</strong></p>
  ${r.stale ? `<div class="note warn">${r.stale === 'caption' ? 'This feedback is about earlier wording.' : 'Your voice guidance or voice choice changed after this review.'} Review again when you’re ready.</div>` : ''}
  ${r.works?.length ? `<h3>What works</h3><ul>${r.works.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  ${r.tips?.length ? `<h3>Worth a look</h3><ul>${r.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  <h3>Claims and sources</h3>${r.claims?.length ? r.claims.map((c) => `<div class="claim"><span class="pill ${c.status === 'supported' ? 'ok' : 'warn'}">${c.status === 'supported' ? 'Supported' : 'No supplied source supports this'}</span> ${esc(c.claim)}${c.sources?.length ? `<div class="small muted">Sources: ${c.sources.map(esc).join('; ')}</div>` : ''}${c.note ? `<div class="small muted">${esc(c.note)}</div>` : ''}</div>`).join('') : '<p class="small muted">No factual claims were found to check.</p>'}
  <p class="small muted">Sent to AI: ${r.sourcesSent?.length ? r.sourcesSent.map((s) => esc(s.label)).join(', ') : 'the caption and voice guidance only'}.</p>
  <details class="box"><summary>See suggested wording</summary><div style="white-space:pre-wrap;margin:8px 0">${esc(r.suggestedCaption)}</div><button class="btn" type="button" id="useSuggestion" ${r.stale ? 'disabled' : ''}>Use this wording</button></details>
  ${hist ? '<button class="btn link" type="button" id="restore">Restore my previous wording</button>' : ''}</div>`;
  const use = $('#useSuggestion'); if (use) use.onclick = () => { editPost(p.id, { captionHistory: { ...(p.captionHistory || {}), [k]: p[k] }, [k]: r.suggestedCaption }); flush(p.id).then(() => ctl.rerender()); toast('Suggestion applied. Review this version before approving.'); };
  const rs = $('#restore'); if (rs) rs.onclick = () => { editPost(p.id, { [k]: hist, captionHistory: { ...(p.captionHistory || {}), [k]: '' } }); flush(p.id).then(() => ctl.rerender()); };
}

async function runReview(p) {
  if (S.reviewBusy) return;
  const k = S.platform, caption = p[k]; if (!caption.trim()) return toast('Add your caption first.');
  if (!(await flush(p.id))) return toast('Resolve the unsaved change first.');
  const sources = (postById(p.id).aiSources || []);
  const payload = { platform: k, question: p.reviewQuestions?.[k] || '', sources };
  const path = bpath(`/posts/${encodeURIComponent(p.id)}`, p.brandId);
  try {
    if (sources.length) {
      const pv = await api('POST', path + '/review-preview', payload);
      const ok = await ask({ title: 'Send these to AI?', body: `<p>This review will send:</p><ul><li>Your ${platformName(k)} caption and question</li><li>${pv.sends.voice === 'both' ? 'Brand voice and your personal voice' : pv.sends.voice === 'founder' ? 'Your personal voice' : 'The brand voice'}${pv.sends.brandFacts ? ` and ${pv.sends.brandFacts} confirmed brand fact${pv.sends.brandFacts === 1 ? '' : 's'}` : ''}</li>${pv.sends.sources.map((s) => `<li>${esc(s.label)} <span class="pill">${s.kind}</span></li>`).join('')}</ul>${pv.cached ? '<p class="note">An identical review is saved, so this will reuse it at no extra cost.</p>' : ''}<p class="small muted">Nothing else is sent. No files you did not tick.</p>`, buttons: [{ label: pv.cached ? 'Show saved review' : 'Send for review', value: true, primary: true }] });
      if (!ok) return;
    }
    S.reviewBusy = true; renderReview(postById(p.id));
    const d = await api('POST', path + '/review', payload);
    if (d.usage) S.usage = d.usage;
    const cur = postById(p.id); if (cur) cur.reviews = { ...cur.reviews, [k]: d.review };
    toast(d.cached ? 'Saved review reused. No new AI request.' : 'Review ready. Your words are still yours.');
  } catch (e) {
    toast(e.message);
    try { S.usage = (await api('GET', '/api/ai-usage')).usage; } catch { /* usage line simply stays hidden */ }
  } finally { S.reviewBusy = false; if (S.view === 'today' && S.step === 1 && current()?.id === p.id) { renderReview(current()); refreshChrome(); } }
}

async function addExcerpt(p, { label = '', body = '', sourceFileId = null, intro = '' }) {
  const v = await form({ title: 'Add an excerpt for AI to read', intro: intro || `Paste only the passage you want read (up to ${S.caps.limits.maxExcerptChars.toLocaleString()} characters). It stays attached to this post.`, fields: [{ name: 'label', label: 'Label', value: label, max: 120 }, { name: 'body', label: 'Text', type: 'textarea', rows: 10, value: body, max: S.caps.limits.maxExcerptChars }], submit: 'Save excerpt' });
  if (!v) return;
  try {
    const d = await api('POST', bpath('/excerpts', p.brandId), { label: v.label, body: v.body, postId: p.id, sourceFileId });
    S.excerpts.push(d.excerpt); editPost(p.id, { aiSources: [...(postById(p.id).aiSources || []), { type: 'excerpt', id: d.excerpt.id }] }); flush(p.id); renderReview(postById(p.id)); toast('Excerpt saved and selected for the next review.');
  } catch (e) { toast(e.message); }
}
async function excerptFromFile(p, fileId) {
  const f = S.files.find((x) => x.id === fileId);
  if (f.ai.kind === 'text') {
    try { const t = await api('GET', bpath(`/files/${encodeURIComponent(fileId)}/text`, p.brandId)); return addExcerpt(p, { label: f.name, body: t.text.slice(0, S.caps.limits.maxExcerptChars), sourceFileId: fileId, intro: `Trim this to the part you want read. ${t.truncated ? 'Only the first 100 KB of the file is shown. ' : ''}Up to ${S.caps.limits.maxExcerptChars.toLocaleString()} characters.` }); } catch (e) { return toast(e.message); }
  }
  addExcerpt(p, { label: f.name, sourceFileId: fileId, intro: 'This format can’t be read by AI directly. Open the file, copy the passage you want checked, and paste it here.' });
}

// ---------- image step ----------
function renderImage(p, box) {
  const g = p.graphic; const imgs = imagesFor(p); const pal = (s) => palette(S.brand, s);
  box.innerHTML = `<h3>Give the words a place.</h3><p class="muted small">A graphic made from the line you choose, in ${esc(S.brand.name)}’s colors, fonts and logo.</p>
  ${p.imageReady && p.needs.styleReview ? `<div class="note warn"><strong>Brand style changed since you approved this image.</strong> The image is unchanged. Look at the preview, then confirm or adjust.<div class="actions"><button class="btn small" type="button" id="reconfirmImg">Still good — keep it approved</button></div></div>` : ''}
  ${(S.caps.aesthetics || []).find((a) => a.key === S.brand.profile.aesthetic) ? `<p class="small muted">${esc(S.brand.name)}’s aesthetic direction, ${esc((S.caps.aesthetics || []).find((a) => a.key === S.brand.profile.aesthetic).label)}: ${esc((S.caps.aesthetics || []).find((a) => a.key === S.brand.profile.aesthetic).tip)}</p>` : ''}
  <label for="headline">Main line on the image</label><textarea id="headline" rows="3" maxlength="200">${esc(g.line)}</textarea>
  <label>Style</label><div class="seg" role="group" aria-label="Graphic style">${[['dark', 'Dark'], ['primary', 'Brand color'], ['light', 'Light']].map(([s, n]) => `<button type="button" data-style="${s}" aria-pressed="${g.style === s}"><span aria-hidden="true" style="display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;vertical-align:-1px;background:${pal(s).bg};border:1px solid #888"></span>${n}</button>`).join('')}</div>
  <label>Photo or screenshot</label>
  <div class="checkrow"><input type="radio" name="imgsel" id="img_none" value="" ${!g.imageFileId ? 'checked' : ''}><label for="img_none">Words only</label></div>
  ${imgs.map((f) => `<div class="checkrow"><input type="radio" name="imgsel" id="img_${f.id}" value="${f.id}" ${g.imageFileId === f.id ? 'checked' : ''}><label for="img_${f.id}"><img src="${fileUrl(f)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:8px">${esc(f.name)}<small>${f.postId ? 'This post' : 'Brand file'}</small></label></div>`).join('')}
  ${imgs.length ? '' : '<p class="small muted">Upload a photo or screenshot under “Files for this post” to use it here.</p>'}
  <h3 style="margin-top:22px">Carousel slides <span class="small muted">(optional)</span></h3>
  <p class="small muted">Add more slides to turn this into a carousel. Slide 1 is the headline above. Up to 10 slides in total.</p>
  ${(g.slides || []).map((sl, i) => `<div class="card" style="box-shadow:none;margin-top:12px"><div class="row between"><strong>Slide ${i + 2}</strong><button class="btn link danger" type="button" data-rmslide="${i}">Remove</button></div>
    <label for="sl_line_${i}">Headline</label><textarea id="sl_line_${i}" rows="2" maxlength="200" data-slideline="${i}">${esc(sl.line)}</textarea>
    <label for="sl_img_${i}">Photo or screenshot</label><select id="sl_img_${i}" data-slideimg="${i}"><option value="">Words only</option>${imgs.map((f) => `<option value="${f.id}" ${sl.imageFileId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>`).join('')}
  <div class="actions" style="margin-top:12px"><button class="btn" id="addslide" type="button" ${(g.slides || []).length >= 9 ? 'disabled' : ''}>Add a slide</button></div>
  <label for="footer">Small line at the bottom</label><input type="text" id="footer" maxlength="80" value="${esc(g.footer)}" placeholder="${esc(S.brand.profile.tagline || 'Optional')}">
  <div class="checkrow"><input type="checkbox" id="showLogo" ${g.showLogo ? 'checked' : ''}><label for="showLogo">Show logo and name</label></div>
  <div class="actions"><button class="btn primary" id="ready" type="button" ${p.imageReady ? 'disabled' : ''}>${p.imageReady ? 'Image approved ✓' : 'Approve image'}</button><button class="btn" id="backcaption" type="button">Back to caption</button></div>`;
  const upd = (ch) => { editPost(p.id, { graphic: ch }); refreshChrome(); const b = $('#ready'); if (b) { b.disabled = false; b.textContent = 'Approve image'; } drawPreview(); };
  $('#headline').oninput = (e) => upd({ line: e.target.value });
  $('#footer').oninput = (e) => upd({ footer: e.target.value });
  $('#showLogo').onchange = (e) => upd({ showLogo: e.target.checked });
  const setSlides = (slides) => { upd({ slides }); renderStepBody(); };
  $('#addslide').onclick = () => setSlides([...(p.graphic.slides || []), { line: '', imageFileId: null }]);
  $$('[data-rmslide]').forEach((b) => (b.onclick = () => setSlides(p.graphic.slides.filter((_, i) => i !== +b.dataset.rmslide))));
  $$('[data-slideline]').forEach((t) => (t.oninput = () => upd({ slides: p.graphic.slides.map((sl, i) => (i === +t.dataset.slideline ? { ...sl, line: t.value } : sl)) })));
  $$('[data-slideimg]').forEach((sel) => (sel.onchange = () => upd({ slides: p.graphic.slides.map((sl, i) => (i === +sel.dataset.slideimg ? { ...sl, imageFileId: sel.value || null } : sl)) })));
  $$('[data-style]').forEach((b) => (b.onclick = () => { upd({ style: b.dataset.style }); $$('[data-style]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  $$('[name=imgsel]').forEach((r) => (r.onchange = () => upd({ imageFileId: r.value || null })));
  $('#ready').onclick = async () => { if (!p.graphic.line.trim()) return toast('Add a line for the image first.'); if (await postAction(p.id, 'approve-image')) { S.step = 3; savePlace(S.brandId, { lastStep: 3 }); ctl.rerender(); } };
  $('#backcaption').onclick = () => { S.step = 1; renderStepBody(); refreshChrome(); };
  if ($('#reconfirmImg')) $('#reconfirmImg').onclick = async () => { if (await postAction(p.id, 'acknowledge')) { ctl.rerender(); toast('Kept as approved.'); } };
}

// ---------- posting checklist ----------
function renderPost(p, box) {
  const k = S.platform;
  box.innerHTML = `<h3>Ready when you are.</h3><p class="muted small">Copy your caption, download the image, then post in each app yourself. Nothing is published automatically.</p>
  ${p.approved && p.needs.voiceReview ? '<div class="note warn">Voice guidance changed since approval. Your approved words are unchanged.</div>' : ''}
  <div class="row between">${platformTabs()}</div><div class="actions"><button class="btn primary" id="copy" type="button">Copy ${platformName(k)} caption</button></div>
  <label for="format">Image format</label><select id="format">${Object.entries(FORMATS).map(([v, f]) => `<option value="${v}">${f[2]}</option>`).join('')}</select>
  <div class="actions"><button class="btn" id="download" type="button">${slideCount(p) > 1 ? 'Download slide 1 (PNG)' : 'Download image (PNG)'}</button>${slideCount(p) > 1 ? '<button class="btn" id="dlzip" type="button">All slides (ZIP of PNGs, for Instagram)</button><button class="btn" id="dlpdf" type="button">All slides (PDF, for LinkedIn)</button>' : ''}</div><p class="small muted" id="exportNote">The PNG uses ${esc(S.brand.name)}’s logo, colors and fonts.</p>
  <h3 style="margin-top:22px">Posting checklist</h3>
  ${['linkedin', 'instagram'].map((pk) => { const at = p[pk === 'linkedin' ? 'postedLinkedinAt' : 'postedInstagramAt']; return `<div class="checkrow"><input type="checkbox" id="posted_${pk}" ${at ? 'checked' : ''}><label for="posted_${pk}">Posted on ${platformName(pk)}<small>${at ? 'Marked ' + new Date(at).toLocaleDateString() : 'Check after you publish there. Tracked separately.'}</small></label></div>`; }).join('')}
  ${isDone(p) ? '<div class="note"><strong>That’s out in the world.</strong> Your progress is saved. You can leave it here.</div>' : ''}
  <button class="btn link" id="editimage" type="button">Adjust image</button>`;
  bindPlatform();
  $('#copy').onclick = () => copyCaption(p);
  $('#download').onclick = () => downloadImage(p);
  if ($('#dlzip')) { $('#dlzip').onclick = () => downloadCarousel(p, 'zip'); $('#dlpdf').onclick = () => downloadCarousel(p, 'pdf'); }
  $('#editimage').onclick = () => { S.step = 2; renderStepBody(); refreshChrome(); };
  for (const pk of ['linkedin', 'instagram']) $('#posted_' + pk).onchange = async (e) => { const r = await postAction(p.id, 'posted', { platform: pk, posted: e.target.checked }); ctl.rerender(); if (!r) toast('Could not update.'); };
}
export async function downloadImage(p) {
  const btn = $('#download'); const format = $('#format').value; btn.disabled = true; btn.textContent = 'Preparing image…';
  try {
    const { blob, meta } = await exportPng({ post: p, brand: S.brand, files: S.files, format });
    window.__lastExport = meta;
    const slug = S.brand.name.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'brand';
    const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = `${slug}-${p.date || 'draft'}-${format}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 3000);
    const warn = [!meta.headingFontLoaded && `the headline font “${meta.headingFont}”`, !meta.bodyFontLoaded && `the body font “${meta.bodyFont}”`, meta.logoError && 'the logo', meta.imageError && 'the selected image'].filter(Boolean);
    toast(warn.length ? `Image downloaded, but ${warn.join(' and ')} could not be loaded, so a fallback was used. Check Brand → fonts.` : 'Image downloaded.');
  } catch { toast('Could not export the image. Please try again.'); }
  finally { btn.disabled = false; btn.textContent = 'Download image (PNG)'; }
}

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
function saveBlob(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 3000); }
export async function downloadCarousel(p, kind) {
  const btn = $(kind === 'zip' ? '#dlzip' : '#dlpdf'), label = btn.textContent; const format = $('#format').value; btn.disabled = true; btn.textContent = 'Preparing slides…';
  try {
    const slug = S.brand.name.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'brand', base = `${slug}-${p.date || 'draft'}-${format}`;
    const slides = await exportSlides({ post: p, brand: S.brand, files: S.files, format }, kind === 'zip' ? 'image/png' : 'image/jpeg');
    window.__lastExport = { ...slides[0].meta, slides: slides.length, kind };
    if (kind === 'zip') saveBlob(new Blob([buildZip(await Promise.all(slides.map(async (s, i) => ({ name: `${base}-slide-${String(i + 1).padStart(2, '0')}.png`, bytes: await bytesOf(s.blob) }))))], { type: 'application/zip' }), `${base}-carousel.zip`);
    else saveBlob(new Blob([buildPdf(await Promise.all(slides.map(async (s) => ({ jpeg: await bytesOf(s.blob), width: s.width, height: s.height }))))], { type: 'application/pdf' }), `${base}-carousel.pdf`);
    toast(`${slides.length} slides downloaded.`);
  } catch { toast('Could not export the slides. Please try again.'); }
  finally { btn.disabled = false; btn.textContent = label; }
}

// ---------- preview ----------
export function drawPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const p = current(); const box = $('#prevBox'); if (!p || !box) return;
    if (!p.approved) { box.innerHTML = `<div class="card" style="text-align:center;padding:40px 16px"><p class="muted" style="margin:0">Approve your caption to create its image.<br>The words come first.</p></div>`; $('#prevLabel').textContent = 'IMAGE PREVIEW'; return; }
    $('#prevLabel').textContent = p.imageReady ? 'YOUR POST IMAGE' : 'VISUAL DIRECTION';
    let c = box.querySelector('canvas'); if (!c) { box.innerHTML = '<canvas aria-label="Image preview" role="img"></canvas>'; c = box.querySelector('canvas'); }
    const id = p.id; const { meta } = await renderGraphic({ post: p, brand: S.brand, files: S.files, canvas: c });
    if (current()?.id === id) c.dataset.style = meta.background;
    let th = $('#prevThumbs'); if (!th) { box.insertAdjacentHTML('beforeend', '<div id="prevThumbs" class="row" style="margin-top:10px;gap:8px"></div>'); th = $('#prevThumbs'); }
    const n = slideCount(p); th.innerHTML = '';
    for (let i = 1; i < n && current()?.id === id; i++) { const tc = document.createElement('canvas'); tc.setAttribute('role', 'img'); tc.setAttribute('aria-label', `Slide ${i + 1} preview`); tc.style.cssText = 'width:30%;height:auto;border-radius:6px'; th.append(tc); await renderGraphic({ post: p, brand: S.brand, files: S.files, canvas: tc, slideIndex: i }); }
  }, 120);
}

// ---------- attachments ----------
export function renderAttachments() {
  const p = current(); const el = $('#attachments'); if (!el || !p) return;
  const mine = S.files.filter((f) => f.postId === p.id);
  el.innerHTML = `<div class="row between"><h3>Files for this post</h3><span class="pill">${mine.length} attached</span></div>
  <p class="small muted">Photos, screenshots, research and references stay with this post and stay downloadable. Up to ${Math.round(S.caps.maxUploadBytes / 1048576)} MB each. Uploading does not publish or send anything to AI.</p>
  <label class="uploadzone"><strong>${S.uploadBusy ? 'Uploading…' : 'Choose files or drop them here'}</strong><input type="file" id="postfiles" multiple ${S.uploadBusy || !S.caps.uploads ? 'disabled' : ''} aria-label="Add files to this post"></label>
  ${S.caps.uploads ? '' : '<p class="small muted">File storage is not connected on this deployment yet.</p>'}
  <div class="files">${mine.map((f) => `<div class="fileitem">${isImg(f) ? `<img src="${fileUrl(f)}" alt="${esc(f.name)}">` : '<div class="fileicon" aria-hidden="true">FILE</div>'}<div class="meta"><strong>${esc(f.name)}</strong><div class="small muted">${sizeText(f.size)} · ${(p.aiSources || []).some((s) => s.id === f.id) ? '<span class="pill ok">Included in AI review</span>' : '<span class="pill">Stored attachment</span>'}${f.ai.supported ? '' : ` · <span class="small">${esc(f.ai.reason)}</span>`}</div>
    <div class="row" style="gap:4px"><a class="btn link" href="${fileUrl(f, true)}" download>Download</a>${isImg(f) ? `<button type="button" class="btn link" data-usefile="${f.id}">${p.graphic.imageFileId === f.id ? 'Selected for image' : 'Use for image'}</button>` : ''}<button type="button" class="btn link danger" data-removefile="${f.id}">Remove</button></div></div></div>`).join('')}</div>`;
  $('#postfiles').onchange = (e) => uploadFiles([...e.target.files], p);
  const z = $('.uploadzone', el); z.ondragover = (e) => e.preventDefault(); z.ondrop = (e) => { e.preventDefault(); if (S.caps.uploads && !S.uploadBusy) uploadFiles([...e.dataTransfer.files], p); };
  $$('[data-usefile]', el).forEach((b) => (b.onclick = () => { editPost(p.id, { graphic: { imageFileId: b.dataset.usefile } }); if (S.step === 2) renderStepBody(); renderAttachments(); refreshChrome(); drawPreview(); toast(p.approved ? 'Image selected. Approve the image again.' : 'Image selected. It will appear after you approve the caption.'); }));
  $$('[data-removefile]', el).forEach((b) => (b.onclick = async () => {
    const f = S.files.find((x) => x.id === b.dataset.removefile);
    if (!(await ask({ title: 'Remove this file?', body: `<p>“${esc(f.name)}” will be deleted from this post and from storage. This can’t be undone.</p>`, buttons: [{ label: 'Remove file', value: true, primary: true }] }))) return;
    try { await flush(p.id); await api('DELETE', bpath(`/files/${encodeURIComponent(f.id)}`, p.brandId)); await ctl.reloadPosts(); await ctl.reloadFiles(); ctl.rerender(); toast('File removed.'); } catch (e) { toast(e.message); }
  }));
}
export async function uploadFiles(files, p, { role, brandLevel } = {}) {
  if (S.uploadBusy) return; S.uploadBusy = true; const errors = []; const brandId = S.brandId;
  (brandLevel ? ctl.rerender : renderAttachments)();
  try {
    for (const file of files) {
      if (file.size > S.caps.maxUploadBytes) { errors.push(`${file.name}: larger than ${Math.round(S.caps.maxUploadBytes / 1048576)} MB.`); continue; }
      try { await api('POST', bpath('/files', brandId), file, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), ...(p ? { 'X-Post-Id': p.id } : {}), ...(role ? { 'X-File-Role': role } : {}) }); } catch (e) { errors.push(`${file.name}: ${e.message}`); }
    }
  } finally {
    S.uploadBusy = false; if (S.brandId === brandId) { await ctl.reloadFiles(); ctl.rerender(); }
    toast(errors.length ? errors.join(' ') : 'Files attached and saved.');
  }
}
