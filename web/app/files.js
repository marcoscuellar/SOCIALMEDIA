import { $, $$, S, esc, api, bpath, fileUrl, isImg, toast } from './core.js';
import { ask, form, sizeText } from './ui.js';
import { uploadFiles } from './today.js';

let ctl; export const bindFiles = (c) => { ctl = c; };

export function renderFiles() {
  const brandFiles = S.files.filter((f) => !f.postId && f.role !== 'font' && !f.role.startsWith('logo'));
  const brandAssets = S.files.filter((f) => !f.postId && (f.role === 'font' || f.role.startsWith('logo')));
  const postFiles = S.files.filter((f) => f.postId);
  const row = (f) => `<div class="fileitem">${isImg(f) ? `<img src="${fileUrl(f)}" alt="${esc(f.name)}">` : '<div class="fileicon" aria-hidden="true">FILE</div>'}<div class="meta"><strong>${esc(f.name)}</strong><div class="small muted">${sizeText(f.size)} · ${f.role === 'font' ? 'Font' : f.role.startsWith('logo') ? 'Logo' : f.postId ? 'Post attachment' : 'Reference'} · ${f.ai.supported ? 'Can be read by AI when you tick it' : esc(f.ai.reason)}</div>
    <div class="row" style="gap:4px"><a class="btn link" href="${fileUrl(f, true)}" download>Download</a>${!f.ai.supported && f.ai.kind !== 'font' && !f.postId ? `<button class="btn link" type="button" data-exc="${f.id}">${f.ai.excerptOnly ? 'Select an excerpt…' : 'Paste an excerpt…'}</button>` : ''}${f.ai.supported && f.ai.kind === 'text' && !f.postId ? `<button class="btn link" type="button" data-exc="${f.id}">Select an excerpt…</button>` : ''}<button class="btn link danger" type="button" data-del="${f.id}">Delete</button></div></div></div>`;
  $('#content').innerHTML = `
  <div class="eyebrow">${esc(S.brand.name)} · brand documents</div><h1>Files and research.</h1>
  <p class="muted">Everything here is stored privately for ${esc(S.brand.name)} and stays downloadable. <strong>Stored</strong> is not the same as <strong>read by AI</strong>: nothing is sent to AI unless you tick it for a specific review on a post. Supported for AI: images (PNG, JPEG, WebP, GIF up to 4 MB) and plain text (.txt, .md, .csv, .json up to ${Math.round(S.caps.limits.textFileAiBytes / 1000)} KB, or an excerpt). PDFs, Word and other formats are stored but not read; paste the passage as an excerpt.</p>
  <section class="card"><h2>Brand documents and reference files</h2>
  <label class="uploadzone"><strong>${S.uploadBusy ? 'Uploading…' : 'Choose files or drop them here'}</strong><input type="file" id="brandfiles" multiple ${S.uploadBusy || !S.caps.uploads ? 'disabled' : ''} aria-label="Add brand files"></label>
  ${S.caps.uploads ? '' : '<p class="small muted">File storage is not connected on this deployment yet.</p>'}
  <div class="files">${brandFiles.map(row).join('') || '<p class="muted" style="margin-top:14px">No brand files yet.</p>'}</div></section>
  <section class="card"><div class="row between"><h2 style="margin:0">Excerpts</h2><button class="btn small" id="addexc" type="button">Add excerpt</button></div><p class="muted small">Short passages you chose for AI to be able to read. Each is tied to this brand.</p>
  ${S.excerpts.filter((e) => !e.postId).map((e) => `<div class="qitem"><div class="t"><strong>${esc(e.label)}</strong><div class="small muted">${e.body.length} characters${e.sourceFileId ? ' · from a file' : ''}</div><div class="small muted">${esc(e.body.slice(0, 160))}${e.body.length > 160 ? '…' : ''}</div></div><button class="btn small danger" data-delexc="${e.id}" type="button">Delete</button></div>`).join('') || '<p class="muted">No excerpts yet.</p>'}</section>
  <section class="card"><h2>Logo and fonts</h2><p class="muted small">Used for exported graphics. Change them under Brand.</p><div class="files">${brandAssets.map(row).join('') || '<p class="muted">None uploaded.</p>'}</div></section>
  <section class="card"><h2>Files attached to individual posts</h2>${postFiles.length ? '<div class="files">' + postFiles.map((f) => { const p = S.posts.find((x) => x.id === f.postId); return row(f).replace('<strong>', `<strong>${esc(p?.title || 'Post')} · `); }).join('') + '</div>' : '<p class="muted">None.</p>'}</section>`;
  $('#brandfiles').onchange = (e) => uploadFiles([...e.target.files], null, { brandLevel: true });
  const z = $('.uploadzone'); z.ondragover = (e) => e.preventDefault(); z.ondrop = (e) => { e.preventDefault(); if (S.caps.uploads && !S.uploadBusy) uploadFiles([...e.dataTransfer.files], null, { brandLevel: true }); };
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    const f = S.files.find((x) => x.id === b.dataset.del);
    if (!(await ask({ title: 'Delete this file?', body: `<p>“${esc(f.name)}” will be deleted from storage. Posts or brand settings that use it will be updated and marked for another look. This can’t be undone.</p>`, buttons: [{ label: 'Delete file', value: true, primary: true }] }))) return;
    try { await api('DELETE', bpath(`/files/${encodeURIComponent(f.id)}`)); await ctl.reloadBrand(); ctl.rerender(); toast('File deleted.'); } catch (e) { toast(e.message); }
  }));
  $$('[data-exc]').forEach((b) => (b.onclick = () => brandExcerpt(b.dataset.exc)));
  $('#addexc').onclick = () => brandExcerpt(null);
  $$('[data-delexc]').forEach((b) => (b.onclick = async () => { try { await api('DELETE', bpath(`/excerpts/${encodeURIComponent(b.dataset.delexc)}`)); await ctl.reloadFiles(); ctl.rerender(); } catch (e) { toast(e.message); } }));
}

async function brandExcerpt(fileId) {
  let label = '', body = '', intro = `Paste only the passage you want AI to be able to read (up to ${S.caps.limits.maxExcerptChars.toLocaleString()} characters).`;
  const f = fileId && S.files.find((x) => x.id === fileId);
  if (f) { label = f.name; if (f.ai.kind === 'text') { try { const t = await api('GET', bpath(`/files/${encodeURIComponent(fileId)}/text`)); body = t.text.slice(0, S.caps.limits.maxExcerptChars); intro = 'Trim this to the part you want read.'; } catch (e) { return toast(e.message); } } else intro = 'AI can’t read this format directly. Copy the passage you want and paste it here.'; }
  const v = await form({ title: 'Excerpt for AI', intro, fields: [{ name: 'label', label: 'Label', value: label, max: 120 }, { name: 'body', label: 'Text', type: 'textarea', rows: 10, value: body, max: S.caps.limits.maxExcerptChars }], submit: 'Save excerpt' });
  if (!v) return;
  try { await api('POST', bpath('/excerpts'), { label: v.label, body: v.body, sourceFileId: fileId }); await ctl.reloadFiles(); ctl.rerender(); toast('Excerpt saved.'); } catch (e) { toast(e.message); }
}
