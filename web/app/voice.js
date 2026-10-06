import { $, S, esc, api, toast } from './core.js';

export function renderVoice() {
  const f = S.founder || { name: 'My voice', guidelines: '', preferred: '', avoid: '', examples: '', revision: 0, version: 0 };
  $('#content').innerHTML = `<div class="eyebrow">Shared across every brand</div><h1>Sounds like you.</h1>
  <p class="muted">Your personal founder voice lives here, separate from any brand. For each post you choose the brand voice, this voice, or both. AI suggestions never overwrite your words; you decide what changes.</p>
  <section class="card"><label for="v_name">Name</label><input id="v_name" type="text" maxlength="100" value="${esc(f.name)}">
  <label for="v_g">Voice guidelines</label><textarea id="v_g" rows="9" maxlength="8000">${esc(f.guidelines)}</textarea>
  <label for="v_p">Preferred phrases</label><textarea id="v_p" rows="4" maxlength="3000">${esc(f.preferred)}</textarea>
  <label for="v_a">Language and habits to avoid</label><textarea id="v_a" rows="4" maxlength="3000">${esc(f.avoid)}</textarea>
  <label for="v_e">Writing examples</label><textarea id="v_e" rows="5" maxlength="8000">${esc(f.examples)}</textarea>
  <div class="actions"><button class="btn primary" id="v_save" type="button">Save my voice</button><span class="small muted">Version ${f.version}. Changing this marks reviews and approvals that used it as “needs another look”; it never edits approved work.</span></div></section>`;
  $('#v_save').onclick = async () => {
    try {
      const d = await api('PUT', '/api/voice/founder', { name: $('#v_name').value, guidelines: $('#v_g').value, preferred: $('#v_p').value, avoid: $('#v_a').value, examples: $('#v_e').value, revision: f.revision });
      S.founder = d.founder; toast('Saved. Posts that use your voice may be marked for another look.'); renderVoice();
    } catch (e) { toast(e.message); }
  };
}
