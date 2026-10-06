import { $, esc } from './core.js';

// Simple accessible dialog: resolves with the button value, or null if dismissed.
export function ask({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], cancel = true }) {
  const d = $('#dlg');
  d.innerHTML = `<h2 id="dlgTitle">${esc(title)}</h2><div>${body}</div><div class="actions">${buttons.map((b, i) => `<button type="button" class="btn ${b.primary ? 'primary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}${cancel ? '<button type="button" class="btn link" data-cancel>Cancel</button>' : ''}</div>`;
  d.setAttribute('aria-labelledby', 'dlgTitle');
  return new Promise((resolve) => {
    const done = (v) => { d.close(); d.onclose = null; resolve(v); };
    d.onclose = () => resolve(null);
    d.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => done(buttons[+b.dataset.i].value)));
    const c = d.querySelector('[data-cancel]'); if (c) c.onclick = () => done(null);
    d.showModal(); (d.querySelector('input,textarea,select') || d.querySelector('[data-i]'))?.focus();
  });
}
export function form({ title, intro = '', fields, submit = 'Save' }) {
  const body = (intro ? `<p class="muted">${intro}</p>` : '') + fields.map((f) => `<label for="f_${f.name}">${esc(f.label)}</label>${f.type === 'textarea' ? `<textarea id="f_${f.name}" rows="${f.rows || 4}" ${f.max ? `maxlength="${f.max}"` : ''}>${esc(f.value || '')}</textarea>` : `<input id="f_${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" ${f.max ? `maxlength="${f.max}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`}`).join('');
  return ask({ title, body, buttons: [{ label: submit, value: 'ok', primary: true }] }).then((v) => v === 'ok' ? Object.fromEntries(fields.map((f) => [f.name, $(`#f_${f.name}`).value])) : null);
}
export const sizeText = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
export function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
