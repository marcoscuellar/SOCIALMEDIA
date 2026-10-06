import { $, $$, S, esc, api, bpath, fileUrl, toast } from './core.js';
import { ask } from './ui.js';
import { renderGraphic } from './graphics.js';

let ctl; export const bindBrand = (c) => { ctl = c; };
let draft, draftName, dirty = false;

const lines = (a) => (a || []).join('\n');
const fromLines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const linkLines = (a) => (a || []).map((l) => `${l.label} | ${l.url}`).join('\n');
const fromLinks = (s) => fromLines(s).map((l) => { const [label, ...u] = l.split('|'); return u.length ? { label: label.trim(), url: u.join('|').trim() } : { label: '', url: label.trim() }; });

export function renderBrand() {
  const b = S.brand;
  if (!draft || draft.__id !== b.id || draft.__rev !== b.revision) { draft = JSON.parse(JSON.stringify(b.profile)); draft.__id = b.id; draft.__rev = b.revision; draftName = b.name; dirty = false; }
  const d = draft; const logo = S.files.find((f) => f.id === d.logo.fileId), logoDark = S.files.find((f) => f.id === d.logo.darkFileId);
  const fontRow = (which, label) => { const f = d.fonts[which]; return `<div class="card" style="box-shadow:none"><h3>${label}</h3>
    <label for="fs_${which}">Source</label><select id="fs_${which}"><option value="system" ${f.source === 'system' ? 'selected' : ''}>System font (no download)</option><option value="google" ${f.source === 'google' ? 'selected' : ''}>Google Fonts family</option><option value="upload" ${f.source === 'upload' ? 'selected' : ''}>Upload a font file</option></select>
    <div id="ff_${which}" ${f.source === 'upload' ? 'hidden' : ''}><label for="fn_${which}">Font name</label><input type="text" id="fn_${which}" value="${esc(f.family)}" maxlength="60"></div>
    <div id="fu_${which}" ${f.source === 'upload' ? '' : 'hidden'}><label for="fup_${which}">Font file (.ttf, .otf, .woff, .woff2)</label><input type="file" id="fup_${which}" accept=".ttf,.otf,.woff,.woff2"><p class="small muted">${f.source === 'upload' && f.fileId ? 'Using: ' + esc(f.family) : 'No font file chosen yet.'}</p></div></div>`; };
  const colorRow = (k, label) => `<div><label for="c_${k}">${label}</label><div class="row"><input type="color" id="c_${k}" value="${esc(d.colors[k])}"><input type="text" id="ct_${k}" value="${esc(d.colors[k])}" maxlength="7" style="width:110px" aria-label="${label} hex"></div></div>`;
  $('#content').innerHTML = `
  <div class="row between"><div><div class="eyebrow">Brand profile</div><h1>${esc(b.name)}</h1></div>${b.status === 'archived' ? '<span class="pill warn">Archived</span>' : ''}</div>
  <p class="muted">Everything the writing and the graphics need to feel like this brand. Changing voice or facts marks reviews and approvals for another look; changing the look marks approved images. Nothing approved is edited for you.</p>
  <section class="card"><h2>The basics</h2><label for="b_name">Brand name</label><input id="b_name" type="text" maxlength="100" value="${esc(draftName)}">
  <label for="b_desc">Description</label><textarea id="b_desc" rows="3" maxlength="2000">${esc(d.description)}</textarea>
  <label for="b_aud">Audience</label><textarea id="b_aud" rows="3" maxlength="2000">${esc(d.audience)}</textarea>
  <label for="b_pos">Positioning</label><textarea id="b_pos" rows="3" maxlength="2000">${esc(d.positioning)}</textarea></section>
  <section class="card"><h2>Brand voice</h2><label for="b_vg">Voice guidelines</label><textarea id="b_vg" rows="6" maxlength="8000">${esc(d.voice.guidelines)}</textarea>
  <label for="b_vp">Preferred phrases (one per line)</label><textarea id="b_vp" rows="4" maxlength="3000">${esc(d.voice.preferred)}</textarea>
  <label for="b_va">Language to avoid</label><textarea id="b_va" rows="4" maxlength="3000">${esc(d.voice.avoid)}</textarea>
  <label for="b_ve">Writing examples</label><textarea id="b_ve" rows="4" maxlength="8000">${esc(d.voice.examples)}</textarea></section>
  <section class="card"><h2>Facts and claims</h2><label for="b_fc">Confirmed product facts (one per line)</label><textarea id="b_fc" rows="5">${esc(lines(d.facts.confirmed))}</textarea><p class="small muted">AI treats these as supported sources when checking claims.</p>
  <label for="b_fv">Claims that need verification (one per line)</label><textarea id="b_fv" rows="4">${esc(lines(d.facts.verify))}</textarea>
  <label for="b_fl">Links (one per line: Label | https://…)</label><textarea id="b_fl" rows="3">${esc(linkLines(d.facts.links))}</textarea></section>
  <section class="card"><h2>Look: logo, colors and fonts</h2><p class="muted small">Used for exported graphics. The workspace itself always uses Inter.</p>
  <div class="cols">${colorRow('dark', 'Dark')}${colorRow('light', 'Light')}${colorRow('primary', 'Primary')}${colorRow('accent', 'Accent')}</div>
  <div class="cols" style="margin-top:16px">${fontRow('heading', 'Headline font')}${fontRow('body', 'Body font')}</div>
  <h3 style="margin-top:20px">Logo</h3><div class="cols"><div><label for="lg">Logo (PNG, JPEG, WebP or GIF)</label><input type="file" id="lg" accept="image/png,image/jpeg,image/webp,image/gif">${logo ? `<p class="small muted">Current: <img src="${fileUrl(logo)}" alt="Current logo" style="height:40px;vertical-align:middle;background:#8884;border-radius:4px;padding:2px"> ${esc(logo.name)}</p>` : '<p class="small muted">No logo yet.</p>'}</div>
  <div><label for="lgd">Optional logo for dark backgrounds</label><input type="file" id="lgd" accept="image/png,image/jpeg,image/webp,image/gif">${logoDark ? `<p class="small muted">Current: ${esc(logoDark.name)} <button class="btn link" type="button" id="rmDarkLogo">Remove</button></p>` : ''}</div>
  <div><label for="lt">Logo treatment</label><select id="lt"><option value="original" ${d.logo.treatment === 'original' ? 'selected' : ''}>Use the logo as supplied</option><option value="tint" ${d.logo.treatment === 'tint' ? 'selected' : ''}>One-color mark: tint to match the background</option></select></div></div>
  <label for="b_tag">Footer line on graphics (optional)</label><input type="text" id="b_tag" maxlength="80" value="${esc(d.tagline)}">
  <div class="actions"><button class="btn" id="previewLook" type="button">Preview a sample graphic</button></div><div class="preview" id="lookPreview" hidden style="max-width:360px"></div></section>
  <section class="card"><div class="actions" style="margin:0"><button class="btn primary" id="saveBrand" type="button">Save brand</button><span class="small muted" id="saveNote">${dirty ? 'Unsaved changes' : 'Saved'}</span></div>
  <div class="actions"><button class="btn" id="archive" type="button">${b.status === 'archived' ? 'Restore this brand' : 'Archive this brand'}</button><span class="small muted">Archiving hides it from the switcher; nothing is deleted.</span></div></section>
  <details class="box" id="usageBox"><summary>AI usage (optional)</summary><div id="usageBody" class="small muted">Open to load.</div></details>`;
  bind();
}

function collect() {
  const v = (id) => $('#' + id).value;
  draftName = v('b_name'); Object.assign(draft, { description: v('b_desc'), audience: v('b_aud'), positioning: v('b_pos'), tagline: v('b_tag') });
  draft.voice = { guidelines: v('b_vg'), preferred: v('b_vp'), avoid: v('b_va'), examples: v('b_ve') };
  draft.facts = { confirmed: fromLines(v('b_fc')), verify: fromLines(v('b_fv')), links: fromLinks(v('b_fl')) };
  for (const k of ['dark', 'light', 'primary', 'accent']) draft.colors[k] = v('ct_' + k).trim();
  for (const w of ['heading', 'body']) { const src = v('fs_' + w); const cur = draft.fonts[w]; draft.fonts[w] = src === 'upload' ? { source: 'upload', family: cur.family || 'Brand font', fileId: cur.fileId } : { source: src, family: v('fn_' + w).trim() }; }
  draft.logo.treatment = v('lt');
  const { __id, __rev, ...profile } = draft; return profile;
}

function bind() {
  const mark = () => { dirty = true; $('#saveNote').textContent = 'Unsaved changes'; };
  $$('#content input,#content textarea,#content select').forEach((e) => { if (e.type !== 'file') e.addEventListener('input', mark); });
  for (const k of ['dark', 'light', 'primary', 'accent']) {
    $('#c_' + k).oninput = (e) => { $('#ct_' + k).value = e.target.value; };
    $('#ct_' + k).oninput = (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('#c_' + k).value = e.target.value; };
  }
  for (const w of ['heading', 'body']) {
    $('#fs_' + w).onchange = (e) => { $('#ff_' + w).hidden = e.target.value === 'upload'; $('#fu_' + w).hidden = e.target.value !== 'upload'; };
    $('#fup_' + w).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const file = await upload(f, 'font'); if (file) { collect(); draft.fonts[w] = { source: 'upload', family: file.name.replace(/\.[^.]+$/, ''), fileId: file.id }; mark(); toast('Font uploaded. Save the brand to use it.'); const keepName = draftName; renderBrand(); draftName = keepName; } };
  }
  $('#lg').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const file = await upload(f, 'logo'); if (file) { collect(); draft.logo.fileId = file.id; mark(); toast('Logo uploaded. Save the brand to use it.'); renderBrand(); } };
  $('#lgd').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const file = await upload(f, 'logo_dark'); if (file) { collect(); draft.logo.darkFileId = file.id; mark(); toast('Dark-background logo uploaded. Save the brand to use it.'); renderBrand(); } };
  if ($('#rmDarkLogo')) $('#rmDarkLogo').onclick = () => { collect(); draft.logo.darkFileId = null; mark(); renderBrand(); };
  $('#previewLook').onclick = async () => {
    const box = $('#lookPreview'); box.hidden = false; box.innerHTML = '<canvas></canvas>';
    const profile = collect();
    const files = S.files; const { meta } = await renderGraphic({ post: { graphic: { line: 'A sample\nheadline.', style: 'dark', imageFileId: null, footer: '', showLogo: true } }, brand: { id: S.brand.id, name: draftName, profile }, files, canvas: box.querySelector('canvas') });
    if (!meta.headingFontLoaded) toast(`The headline font “${meta.headingFont}” didn’t load, so a fallback is shown.`);
  };
  $('#saveBrand').onclick = async () => {
    try {
      const profile = collect();
      const d = await api('PATCH', bpath(), { revision: S.brand.revision, name: draftName, profile });
      S.brand = d.brand; S.brands[S.brands.findIndex((x) => x.id === d.brand.id)] = d.brand; dirty = false; draft = null;
      await ctl.reloadPosts(); const n = S.posts.filter((p) => p.needs.voiceReview || p.needs.styleReview).length;
      ctl.refreshSwitcher(); renderBrand(); toast(n ? `Saved. ${n} post${n === 1 ? ' is' : 's are'} marked for another look. Nothing approved was changed.` : 'Brand saved.');
    } catch (e) { toast(e.message); if (e.status === 409) $('#saveNote').textContent = 'Changed elsewhere. Reload this page to see the latest, then reapply your edits.'; }
  };
  $('#archive').onclick = async () => {
    const archiving = S.brand.status !== 'archived';
    if (archiving && !(await ask({ title: 'Archive this brand?', body: '<p>It will be hidden from the switcher. Posts, files and history are kept, and you can restore it anytime.</p>', buttons: [{ label: 'Archive', value: true, primary: true }] }))) return;
    try { const d = await api('PATCH', bpath(), { revision: S.brand.revision, status: archiving ? 'archived' : 'active' }); S.brand = d.brand; S.brands[S.brands.findIndex((x) => x.id === d.brand.id)] = d.brand; draft = null; ctl.refreshSwitcher(); renderBrand(); toast(archiving ? 'Archived.' : 'Restored.'); } catch (e) { toast(e.message); }
  };
  $('#usageBox').ontoggle = async (e) => { if (!e.target.open) return; try { const { usage: u } = await api('GET', '/api/ai-usage'); S.usage = u;
    $('#usageBody').innerHTML = `<p>${u.usedToday} of ${u.dailyLimit} new reviews used today · about $${u.monthDollars.toFixed(4)} of $${u.monthlyLimitDollars.toFixed(2)} this month (${esc(u.timezone)}).${u.uncertainDollars > 0 ? ` Includes $${u.uncertainDollars.toFixed(4)} held for in-progress or uncertain calls.` : ''}</p>
    <table class="t"><thead><tr><th>Brand</th><th>Today</th><th>This month</th><th>Est. cost</th></tr></thead><tbody>${u.byBrand.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.usedToday}</td><td>${r.reviewsThisMonth}</td><td>$${r.monthDollars.toFixed(4)}</td></tr>`).join('')}</tbody></table>
    <p>${esc(u.note)} Limits are enforced on the server for the whole workspace; identical reviews are reused at no cost.</p>`; } catch { $('#usageBody').textContent = 'Usage could not be loaded. New AI reviews pause if usage cannot be checked.'; } };
}

async function upload(file, role) {
  if (file.size > S.caps.maxUploadBytes) { toast('Choose a file smaller than 4 MB.'); return null; }
  try { const d = await api('POST', bpath('/files'), file, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-File-Role': role }); await ctl.reloadFiles(); return d.file; } catch (e) { toast(e.message); return null; }
}
export const discardDraft = () => { draft = null; };
