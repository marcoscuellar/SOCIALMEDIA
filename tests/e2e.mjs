// Browser tests (headless Chromium) against the real app, real Postgres engine (PGlite) and file blobs.
// The AI provider is a recording mock; nothing here makes a paid call.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { startServer } from '../scripts/dev-server.mjs';
import { fakeReview } from './helpers.mjs';

const CHROME = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome'].find((p) => fs.existsSync(p));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-e2e-'));

function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function png(w, h, [r, g, b]) {
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b, 255]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const files = {
  logoA: path.join(tmp, 'alpha-logo.png'), logoB: path.join(tmp, 'beta-logo.png'), photo: path.join(tmp, 'photo.png'),
  fontA: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', fontB: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  notes: path.join(tmp, 'research.txt'), pdf: path.join(tmp, 'paper.pdf'),
};
fs.writeFileSync(files.logoA, png(120, 120, [220, 20, 20])); fs.writeFileSync(files.logoB, png(120, 120, [20, 60, 230])); fs.writeFileSync(files.photo, png(300, 200, [20, 180, 60]));
fs.writeFileSync(files.notes, 'Interview notes: 4 of 5 participants said the checklist helped.'); fs.writeFileSync(files.pdf, '%PDF-1.4 fake');

const providerCalls = [];
const fetcher = async (u, o) => { providerCalls.push(JSON.parse(o.body)); return Response.json(fakeReview(o)); };
const server = await startServer({ port: 0, memory: true, dataDir: tmp, env: { LAUNCH_ROOM_ALLOW_NO_PASSWORD: '1', OPENAI_API_KEY: 'test-key' }, fetcher });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()); // offline sandbox: Inter falls back to system-ui
context.setDefaultTimeout(9000);
const page = await context.newPage();
const consoleErrors = []; page.on('pageerror', (e) => consoleErrors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.|net::ERR_FAILED/.test(m.text())) consoleErrors.push(m.text()); });

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('  ok  ', name); }
  catch (e) { results.push({ name, ok: false, error: e.message.split('\n').slice(0, 6).join(' | ') }); console.log('  FAIL', name, '\n      ', e.message.split('\n').slice(0, 6).join('\n       ')); await page.screenshot({ path: `test-results/fail-${results.length}.png` }).catch(() => {}); }
}
const settle = async (p = page) => { await p.waitForFunction(() => /^(Saved|Not loaded)$/.test(document.getElementById('saveStatus').textContent), null, { timeout: 8000 }); };
const toastText = (p = page) => p.locator('#toast').textContent();
const api = (p, method, url, body) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [method, url, body]);
const switchTo = async (name) => { await page.selectOption('#brandSwitch', { label: name }); await page.waitForFunction((n) => document.querySelector('#brandSwitch').selectedOptions[0]?.textContent === n && document.getElementById('saveStatus').textContent === 'Saved', name); };
async function decodePixels(buffer, points) {
  return page.evaluate(async ([b64, pts]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, px: pts.map(([px, py]) => Array.from(x.getImageData(px, py, 1, 1).data)) };
  }, [buffer.toString('base64'), points]);
}
async function download(trigger) { const [d] = await Promise.all([page.waitForEvent('download'), trigger()]); const p = await d.path(); return { name: d.suggestedFilename(), bytes: fs.readFileSync(p) }; }
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

console.log('Launch Room browser tests at', base);
await page.goto(base + '/');

await step('first run: empty workspace invites adding a brand (no starter when none requested)', async () => {
  await page.waitForSelector('#addFirst'); assert.match(await page.textContent('#content'), /Add your first brand/);
  assert.equal(await page.locator('#themeBtn').isVisible(), true);
});

await step('create brand A through the interface, then edit voice, facts, colors, uploaded font and logo', async () => {
  await page.click('#addFirst'); await page.fill('#nb_name', 'Alpha Foods'); await page.fill('#nb_desc', 'Loud street food.'); await page.click('#nb_ok');
  await page.waitForSelector('#b_name'); assert.equal(await page.inputValue('#b_name'), 'Alpha Foods');
  await page.fill('#b_aud', 'Hungry commuters'); await page.fill('#b_pos', 'Fast and fiery');
  await page.fill('#b_vg', 'ALPHA-VOICE: loud, playful, exclamation marks.'); await page.fill('#b_va', 'bland, corporate');
  await page.fill('#b_fc', 'Open since 2019\nFree delivery over $20'); await page.fill('#b_fv', 'Best in the city');
  await page.fill('#b_fl', 'Menu | https://alpha.example/menu');
  await page.fill('#ct_dark', '#101010'); await page.fill('#ct_light', '#fafafa'); await page.fill('#ct_primary', '#cc2200'); await page.fill('#ct_accent', '#ffcc00');
  await page.selectOption('#fs_heading', 'upload'); await page.setInputFiles('#fup_heading', files.fontA); await page.waitForSelector('text=Using: DejaVuSansMono-Bold');
  await page.setInputFiles('#lg', files.logoA); await page.waitForSelector('img[alt="Current logo"]');
  await page.selectOption('#lt', 'original'); await page.fill('#b_tag', 'ALPHA FOREVER');
  await page.click('#saveBrand'); await page.waitForFunction(() => /Brand saved|marked for another look/.test(document.getElementById('toast').textContent));
  await page.reload(); await page.waitForSelector('#caption, .empty'); await page.click('[data-view=brand]');
  assert.equal(await page.inputValue('#b_vg'), 'ALPHA-VOICE: loud, playful, exclamation marks.'); assert.equal(await page.inputValue('#ct_primary'), '#cc2200');
  assert.equal(await page.inputValue('#fs_heading'), 'upload'); assert.match(await page.inputValue('#b_fl'), /alpha\.example/);
});

await step('create brand B (very different) from the switcher; both appear in the switcher', async () => {
  await page.selectOption('#brandSwitch', '__new'); await page.fill('#nb_name', 'Beta Labs'); await page.fill('#nb_desc', 'Quiet research.'); await page.click('#nb_ok');
  await page.waitForFunction(() => document.querySelector('#content h1')?.textContent === 'Beta Labs'); assert.equal(await page.inputValue('#b_name'), 'Beta Labs');
  assert.equal(await page.inputValue('#b_vg'), '', 'a new brand starts blank, not with Alpha content');
  await page.fill('#b_vg', 'BETA-VOICE: calm, precise, no exclamation marks.'); await page.fill('#b_fc', 'Peer reviewed in 2024');
  await page.fill('#ct_dark', '#001a33'); await page.fill('#ct_light', '#eef6ff'); await page.fill('#ct_primary', '#0066aa'); await page.fill('#ct_accent', '#33ddaa');
  await page.selectOption('#fs_heading', 'upload'); await page.setInputFiles('#fup_heading', files.fontB); await page.waitForSelector('text=Using: DejaVuSans-Bold');
  await page.setInputFiles('#lg', files.logoB); await page.waitForSelector('img[alt="Current logo"]'); await page.selectOption('#lt', 'original');
  await page.click('#saveBrand'); await page.waitForFunction(() => /Brand saved|marked/.test(document.getElementById('toast').textContent));
  const names = await page.$$eval('#brandSwitch option', (o) => o.map((x) => x.textContent)); assert.deepEqual(names.slice(0, 2), ['Alpha Foods', 'Beta Labs']);
});

const alpha = async () => (await api(page, 'GET', '/api/brands')).json.brands.find((b) => b.name === 'Alpha Foods');
const beta = async () => (await api(page, 'GET', '/api/brands')).json.brands.find((b) => b.name === 'Beta Labs');

await step('new posts: dated in A via the calendar, unscheduled in B; captions survive reload', async () => {
  await switchTo('Alpha Foods'); await page.click('[data-view=plan]');
  await page.click('[data-newday]:not([data-newday=""]) >> nth=14'); await page.fill('#np_title', 'Alpha launch'); await page.click('#np_ok');
  await page.waitForSelector('#caption'); await page.fill('#caption', 'Alpha caption for LinkedIn! Open since 2019.'); await settle();
  await page.click('[data-platform=instagram]'); await page.fill('#caption', 'Alpha IG caption!!'); await settle();
  await page.reload(); await page.waitForSelector('#caption'); assert.equal(await page.inputValue('#ptitle'), 'Alpha launch');
  assert.equal(await page.inputValue('#caption'), 'Alpha caption for LinkedIn! Open since 2019.');
  await page.click('[data-platform=instagram]'); assert.equal(await page.inputValue('#caption'), 'Alpha IG caption!!');
  await switchTo('Beta Labs'); await page.click('[data-view=plan]'); await page.click('#newpost'); await page.fill('#np_title', 'Beta teaser'); await page.click('#np_ok');
  await page.waitForSelector('#caption'); assert.equal(await page.inputValue('#pdate'), '', 'unscheduled'); await page.fill('#caption', 'Beta LinkedIn text. Peer reviewed in 2024.'); await settle();
  await page.click('[data-platform=instagram]'); await page.fill('#caption', 'Beta IG text.'); await settle();
});

await step('data separation: switching brands never changes a post, each brand has its own list, note and files', async () => {
  const a = await alpha(), b = await beta();
  const pa = (await api(page, 'GET', `/api/brands/${a.id}/posts`)).json.posts, pb = (await api(page, 'GET', `/api/brands/${b.id}/posts`)).json.posts;
  assert.deepEqual(pa.map((p) => p.title), ['Alpha launch']); assert.deepEqual(pb.map((p) => p.title), ['Beta teaser']);
  assert.equal((await api(page, 'GET', `/api/brands/${b.id}/posts/${pa[0].id}`)).status, 404);
  assert.equal((await api(page, 'PATCH', `/api/brands/${b.id}/posts/${pa[0].id}`, { revision: pa[0].revision, changes: { linkedin: 'x' } })).status, 404);
  for (let i = 0; i < 3; i++) { await switchTo('Alpha Foods'); await switchTo('Beta Labs'); }
  await page.click('[data-view=today]'); await page.fill('#returnnote', 'BETA NOTE'); await page.waitForFunction(() => document.getElementById('noteStatus').textContent.startsWith('Saved'));
  await switchTo('Alpha Foods'); await page.click('[data-view=today]'); assert.equal(await page.inputValue('#returnnote'), '', 'note is per brand');
  assert.equal(await page.inputValue('#ptitle'), 'Alpha launch'); assert.match(await page.inputValue('#caption'), /Alpha caption/);
  const after = (await api(page, 'GET', `/api/brands/${a.id}/posts`)).json.posts[0]; assert.equal(after.revision, pa[0].revision, 'switching did not write anything to the post');
  assert.equal((await api(page, 'GET', `/api/brands/${a.id}/files`)).json.files.every((f) => f.brandId === a.id), true);
  await switchTo('Beta Labs'); await page.click('[data-view=today]'); assert.equal(await page.inputValue('#returnnote'), 'BETA NOTE');
});

await step('approval flow: caption → image → posting checklist, and graphics use the right brand colors, logo and font', async () => {
  await switchTo('Alpha Foods'); await page.click('[data-view=today]'); await page.click('[data-platform=linkedin]');
  await page.click('#approve'); await page.waitForSelector('#headline'); assert.match(await toastText(), /approved/i);
  await page.fill('#headline', 'Fire up\nyour lunch'); await page.click('#ready'); await page.waitForSelector('#format');
  const dl = await download(() => page.click('#download')); assert.match(dl.name, /^alpha-foods-.*portrait\.png$/);
  const meta = await page.evaluate(() => window.__lastExport);
  assert.equal(meta.brandId, (await alpha()).id); assert.equal(meta.background, '#101010'); assert.equal(meta.foreground, '#fafafa'); assert.equal(meta.accent, '#ffcc00');
  assert.equal(meta.headingFontLoaded, true); assert.equal(meta.logo, true); assert.match(meta.headingCss, /lr-.*-heading-/);
  const px = await decodePixels(dl.bytes, [[5, 5], [78 + 40, 80 + 40], [1075, 1345], [96 + 10, 80 + 82 + 30 + 4]]);
  assert.deepEqual([px.w, px.h], [1080, 1350]); assert.equal(hex(px.px[0]), '#101010', 'brand dark background'); assert.equal(hex(px.px[1]), '#dc1414', 'brand logo pixel (red)'); assert.equal(hex(px.px[3]), '#ffcc00', 'accent rule');
  await page.selectOption('#format', 'story'); const st = await download(() => page.click('#download')); assert.equal((await decodePixels(st.bytes, [[5, 5]])).h, 1920);
  await page.selectOption('#format', 'square'); const sq = await download(() => page.click('#download')); assert.equal((await decodePixels(sq.bytes, [[5, 5]])).h, 1080);
  // brand B: different colors, logo and font
  await switchTo('Beta Labs'); await page.click('[data-view=today]'); await page.click('#approve'); await page.waitForSelector('#headline');
  await page.fill('#headline', 'Quiet\nresults'); await page.click('[data-style=primary]'); await page.click('#ready'); await page.waitForSelector('#format');
  const db_ = await download(() => page.click('#download')); const mb = await page.evaluate(() => window.__lastExport);
  assert.equal(mb.brandId, (await beta()).id); assert.equal(mb.background, '#0066aa'); assert.notEqual(mb.headingCss, meta.headingCss); assert.equal(mb.headingFontLoaded, true);
  const pb = await decodePixels(db_.bytes, [[5, 5], [78 + 40, 80 + 40]]); assert.equal(hex(pb.px[0]), '#0066aa'); assert.equal(hex(pb.px[1]), '#143ce6', 'Beta blue logo');
  // fonts really differ: the two loaded faces measure the same text differently
  const widths = await page.evaluate(([a, b]) => { const c = document.createElement('canvas').getContext('2d'); const m = (css) => { c.font = '60px ' + css; return c.measureText('iiiiiiiiiiiiiiii WWWWWWWW lllll').width; }; return [m(a), m(b), m('sans-serif')]; }, [meta.headingCss, mb.headingCss]);
  assert.ok(Math.abs(widths[0] - widths[1]) > 10 && widths[0] !== widths[2], `fonts differ ${widths}`);
  // posting statuses are separate per platform and survive reload
  await page.click('#posted_linkedin'); await settle(); await page.reload(); await page.waitForSelector('#posted_linkedin');
  assert.equal(await page.isChecked('#posted_linkedin'), true); assert.equal(await page.isChecked('#posted_instagram'), false);
  await page.click('#posted_instagram'); await page.reload(); await page.waitForSelector('#posted_instagram'); assert.equal(await page.isChecked('#posted_instagram'), true);
  assert.match(await page.textContent('.note'), /out in the world/);
});

await step('caption edit after approval clears approval and image approval; the stale review is labelled', async () => {
  await switchTo('Alpha Foods'); await page.click('[data-view=today]'); await page.click('[data-step="1"]');
  assert.match(await page.textContent('#pstatus'), /Ready to post/);
  await page.click('#askreview'); await page.waitForFunction(() => document.getElementById('reviewresult')?.textContent.includes('Reads well'));
  assert.equal(providerCalls.length, 1); assert.match(await page.textContent('#reviewBadge'), /AI: ready/);
  await page.fill('#caption', (await page.inputValue('#caption')) + ' New ending.'); await settle();
  assert.match(await page.textContent('#pstatus'), /Draft/); assert.equal(await page.isDisabled('[data-step="2"]'), true); assert.equal(await page.isDisabled('[data-step="3"]'), true);
  assert.match(await page.textContent('#reviewBadge'), /Caption changed/); assert.equal(await page.isDisabled('#useSuggestion'), true);
  const a = await alpha(); const p = (await api(page, 'GET', `/api/brands/${a.id}/posts`)).json.posts[0]; assert.equal(p.approved, false); assert.equal(p.imageReady, false); assert.equal(p.reviews.linkedin.stale, 'caption'); assert.ok(p.postedLinkedinAt === null);
  await page.click('#approve'); await page.waitForSelector('#headline'); assert.equal((await page.inputValue('#headline')), 'Fire up\nyour lunch', 'headline kept');
  await page.click('#ready'); await page.waitForSelector('#format');
});

await step('AI sources: stored vs included, explicit selection, honest unsupported formats, claims vs sources', async () => {
  await switchTo('Alpha Foods'); await page.click('[data-view=today]'); await page.click('[data-step="1"]'); providerCalls.length = 0;
  await page.setInputFiles('#postfiles', [files.notes, files.pdf, files.photo]); await page.waitForFunction(() => document.querySelectorAll('#attachments .fileitem').length === 3);
  assert.match(await page.textContent('#attachments'), /Stored attachment/); assert.equal(await page.locator('#attachments img').count() >= 1, true, 'image preview');
  assert.equal(providerCalls.length, 0, 'uploading never calls AI');
  const pdfRow = page.locator('.srcitem', { hasText: 'paper.pdf' }); assert.equal(await pdfRow.locator('input').isDisabled(), true); assert.match(await pdfRow.textContent(), /not read by AI/);
  assert.match(await pdfRow.textContent(), /Paste an excerpt/);
  const notesRow = page.locator('.srcitem', { hasText: 'research.txt' }); assert.match(await notesRow.textContent(), /Stored attachment only/);
  await notesRow.locator('input').check(); await settle(); assert.match(await notesRow.textContent(), /Included in AI review/);
  await page.fill('#caption', 'Alpha says 4 of 5 participants liked it. Free delivery over $20.'); await settle();
  await page.click('#askreview'); await page.waitForSelector('#dlg[open]'); const dlg = await page.textContent('#dlg'); assert.match(dlg, /File: research\.txt/); assert.doesNotMatch(dlg, /paper\.pdf|photo\.png/);
  await page.click('#dlg [data-i="0"]'); await page.waitForFunction(() => document.getElementById('reviewresult')?.textContent.includes('Reads well'));
  assert.equal(providerCalls.length, 1); const sent = JSON.stringify(providerCalls[0]);
  assert.match(sent, /Interview notes: 4 of 5/); assert.doesNotMatch(sent, /fake|image_url|photo/); assert.match(sent, /ALPHA-VOICE/); assert.doesNotMatch(sent, /BETA-VOICE|Peer reviewed/);
  assert.match(await page.textContent('#reviewresult'), /Supported/); assert.match(await page.textContent('#reviewresult'), /No supplied source supports this/); assert.match(await page.textContent('#reviewresult'), /File: research\.txt/);
  assert.match(await page.textContent('#reviewresult'), /Sent to AI: File: research\.txt/);
  // pasted excerpt for the unsupported PDF
  await pdfRow.locator('[data-excerpt-file]').click(); await page.fill('#f_body', 'Paper: delivery under 30 minutes in 90% of cases.'); await page.click('#dlg [data-i="0"]');
  await page.waitForSelector('.srcitem:has-text("Excerpt: paper.pdf")'); assert.match(await page.textContent('.srcitem:has-text("Excerpt: paper.pdf")'), /Included in AI review/);
  // an identical request reuses the saved review: no new provider call
  await page.locator('.srcitem:has-text("Excerpt: paper.pdf") input').uncheck(); await settle();
  await page.click('#askreview'); await page.waitForSelector('#dlg[open]'); assert.match(await page.textContent('#dlg'), /identical review is saved|saved review/i); await page.click('#dlg [data-i="0"]');
  await page.waitForFunction(() => /Saved review reused/.test(document.getElementById('toast').textContent)); assert.equal(providerCalls.length, 1);
  // applying a suggestion is explicit and reversible
  const before = await page.inputValue('#caption'); await page.click('#reviewresult summary'); await page.click('#useSuggestion'); await settle(); await page.waitForSelector('#restore');
  assert.match(await page.inputValue('#caption'), /\(tightened\)/); await page.click('#restore'); await settle(); await page.waitForSelector('#caption'); assert.equal(await page.inputValue('#caption'), before);
});

await step('upload, preview, download, use for graphic, and removal of a post file', async () => {
  const a = await alpha(); const post = (await api(page, 'GET', `/api/brands/${a.id}/posts`)).json.posts[0];
  const f = (await api(page, 'GET', `/api/brands/${a.id}/files?postId=${post.id}`)).json.files.find((x) => x.name === 'photo.png');
  const dl = await download(() => page.locator('.fileitem', { hasText: 'photo.png' }).locator('a:has-text("Download")').click()); assert.equal(dl.name, 'photo.png'); assert.deepEqual(dl.bytes, fs.readFileSync(files.photo));
  const bytesBefore = fs.readdirSync(path.join(tmp, 'blobs')).length;
  await page.click('[data-step="1"]'); await page.click('#approve'); await page.waitForSelector('#headline'); // the earlier caption edit cleared approval
  await page.locator('.fileitem', { hasText: 'photo.png' }).locator('[data-usefile]').click(); await settle(); await page.waitForSelector(`#img_${f.id}:checked`);
  await page.click('#ready'); await page.waitForSelector('#format'); const g = await download(() => page.click('#download')); const m = await page.evaluate(() => window.__lastExport); assert.equal(m.image, true);
  const px = await decodePixels(g.bytes, [[540, 330 + 20 + 100]]); assert.ok(px.px[0][1] > 150 && px.px[0][0] < 80, 'green photo drawn in the graphic: ' + px.px[0]);
  page.once('dialog', () => {}); await page.locator('.fileitem', { hasText: 'photo.png' }).locator('[data-removefile]').click(); await page.click('#dlg [data-i="0"]');
  await page.waitForFunction(() => !document.querySelector('#attachments')?.textContent.includes('photo.png'));
  assert.equal((await api(page, 'GET', `/api/brands/${a.id}/files/${f.id}`)).status, 404); assert.equal(fs.readdirSync(path.join(tmp, 'blobs')).length, bytesBefore - 1, 'bytes deleted from storage');
  const p2 = (await api(page, 'GET', `/api/brands/${a.id}/posts/${post.id}`)).json.post; assert.equal(p2.graphic.imageFileId, null); assert.equal(p2.imageReady, false); assert.equal(p2.approved, true);
  assert.match(await page.textContent('#pstatus'), /Caption approved/);
});

await step('brand voice change marks approved work "needs another look" without changing it; Still good clears the flag', async () => {
  const a = await alpha(); await page.click('[data-step="2"]'); await page.click('#ready'); await page.waitForSelector('#format');
  const before = (await api(page, 'GET', `/api/brands/${a.id}/posts`)).json.posts[0];
  await page.click('[data-view=brand]'); await page.fill('#b_vg', 'ALPHA-VOICE v2: even louder.'); await page.click('#saveBrand'); await page.waitForFunction(() => /marked for another look/.test(document.getElementById('toast').textContent));
  const after = (await api(page, 'GET', `/api/brands/${a.id}/posts`)).json.posts[0];
  assert.equal(after.approved, true); assert.equal(after.imageReady, true); assert.equal(after.linkedin, before.linkedin); assert.equal(after.needs.voiceReview, true); assert.equal(after.needs.styleReview, false);
  await page.click('[data-view=today]'); await page.click('[data-step="1"]'); assert.match(await page.textContent('#voiceNote'), /Voice guidance changed/); assert.match(await page.textContent('#reviewBadge'), /Voice changed/);
  // branding change flags the approved image
  await page.click('[data-view=brand]'); await page.fill('#ct_primary', '#aa1100'); await page.click('#saveBrand'); await page.waitForFunction(() => /marked/.test(document.getElementById('toast').textContent));
  await page.click('[data-view=today]'); await page.click('[data-step="2"]'); assert.match(await page.textContent('.note.warn'), /Brand style changed/);
  await page.click('#reconfirmImg'); await settle(); await page.click('[data-step="1"]'); assert.equal(await page.locator('#voiceNote').count(), 0);
  const fin = (await api(page, 'GET', `/api/brands/${a.id}/posts`)).json.posts[0]; assert.ok(!fin.needs.voiceReview && !fin.needs.styleReview && fin.approved && fin.imageReady);
});

await step('concurrent edits from two tabs: nothing is silently overwritten', async () => {
  await switchTo('Beta Labs'); await page.click('[data-view=today]'); const tab2 = await context.newPage(); await tab2.goto(base + '/'); await tab2.waitForSelector('#ptitle');
  const brandName = await tab2.evaluate(() => document.querySelector('#brandSwitch').selectedOptions[0].textContent); if (brandName !== 'Beta Labs') await tab2.selectOption('#brandSwitch', { label: 'Beta Labs' });
  await tab2.waitForFunction(() => document.getElementById('saveStatus').textContent === 'Saved' && document.getElementById('ptitle')?.value === 'Beta teaser');
  await page.click('[data-step="1"]'); await tab2.click('[data-step="1"]');
  await page.click('[data-platform=linkedin]'); await tab2.click('[data-platform=linkedin]');
  await page.fill('#caption', 'Beta caption from TAB ONE'); await settle(page);
  await tab2.fill('#caption', 'Beta caption from TAB TWO'); await tab2.waitForSelector('#keepMine', { timeout: 8000 });
  assert.match(await tab2.textContent('#conflict'), /changed somewhere else/); assert.match(await tab2.textContent('#conflict'), /TAB ONE/);
  const b = await beta(); assert.equal((await api(page, 'GET', `/api/brands/${b.id}/posts`)).json.posts[0].linkedin, 'Beta caption from TAB ONE', 'server still holds tab one');
  await tab2.click('#keepMine'); await settle(tab2); assert.equal((await api(page, 'GET', `/api/brands/${b.id}/posts`)).json.posts[0].linkedin, 'Beta caption from TAB TWO');
  // other direction: choosing the other version drops local edits
  await page.reload(); await page.waitForSelector('#caption'); await tab2.fill('#caption', 'TAB TWO again'); await settle(tab2);
  await page.fill('#caption', 'TAB ONE stale edit'); await page.waitForSelector('#useTheirs'); await page.click('#useTheirs'); await page.waitForSelector('#caption');
  assert.equal(await page.inputValue('#caption'), 'TAB TWO again'); await tab2.close();
});

await step('AI limits: when today’s reviews are used the UI says so and the provider is not called', async () => {
  const before = providerCalls.length; await server.db.query(`UPDATE ai_budget SET day=$1, day_count=10 WHERE id=1`, [(await api(page, 'GET', '/api/ai-usage')).json.usage.day]);
  await switchTo('Beta Labs'); await page.click('[data-view=today]'); await page.click('[data-step="1"]'); await page.fill('#caption', 'A brand new Beta caption that is not cached'); await settle();
  await page.click('#askreview'); await page.waitForFunction(() => /10 AI reviews are used/.test(document.getElementById('toast').textContent));
  assert.equal(providerCalls.length, before); assert.match(await page.textContent('#reviewbody'), /Today’s AI reviews are used/); assert.equal(await page.isEnabled('#approve'), true, 'approval still works');
  await page.click('[data-view=brand]'); await page.click('#usageBox summary'); await page.waitForSelector('#usageBody table'); const usage = await page.textContent('#usageBody');
  assert.match(usage, /Alpha Foods/); assert.match(usage, /Beta Labs/); assert.match(usage, /of 10 new reviews used today/);
});

await step('calendar and queue: reschedule, unschedule, create for any date; posting history', async () => {
  await switchTo('Alpha Foods'); await page.click('[data-view=plan]'); const input = page.locator('[data-date]').first();
  await input.fill('2027-01-15'); await page.waitForFunction(() => /Date updated/.test(document.getElementById('toast').textContent));
  const a = await alpha(); assert.equal((await api(page, 'GET', `/api/brands/${a.id}/posts`)).json.posts[0].date, '2027-01-15');
  await page.locator('[data-clear]').first().click(); await page.waitForFunction(() => /unscheduled/.test(document.getElementById('toast').textContent)); assert.equal((await api(page, 'GET', `/api/brands/${a.id}/posts`)).json.posts[0].date, null);
  await page.click('#newpost'); await page.fill('#np_title', 'Dated far away'); await page.fill('#np_date', '2027-03-09'); await page.click('#np_ok'); await page.waitForSelector('#caption'); assert.equal(await page.inputValue('#pdate'), '2027-03-09');
  await switchTo('Beta Labs'); await page.click('[data-view=plan]'); assert.match(await page.textContent('[aria-label="Posting history"]'), /Beta teaser/); assert.doesNotMatch(await page.textContent('#content'), /Alpha launch|Dated far away/);
  assert.doesNotMatch(await page.textContent('#content'), /overdue|streak|behind/i);
});

await step('keyboard: skip link, tab order, visible focus, escape closes dialogs, nav reachable', async () => {
  await page.goto(base + '/'); await page.waitForSelector('#content *'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
  const seen = new Set(); for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); seen.add(await page.evaluate(() => document.activeElement.id || document.activeElement.dataset.view || document.activeElement.tagName)); }
  await page.goto(base + '/'); await page.waitForSelector('#content *'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => location.hash), '#main');
  assert.ok(seen.has('brandSwitch') && seen.has('themeBtn')); assert.ok([...seen].some((s) => ['today', 'plan', 'files', 'brand', 'voice'].includes(s)), 'nav reachable by keyboard');
  const outline = await page.evaluate(() => { document.querySelector('#themeBtn').focus(); const s = getComputedStyle(document.querySelector('#themeBtn')); return [s.outlineStyle, parseFloat(s.outlineWidth)]; });
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); const o2 = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, parseFloat(s.outlineWidth)]; }); assert.ok(o2[0] !== 'none' && o2[1] >= 2, 'focus ring visible: ' + o2);
  void outline;
  await page.click('[data-view=plan]'); await page.click('#newpost'); await page.waitForSelector('#dlg[open]'); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.getElementById('dlg').open), false);
  await page.click('[data-view=today]'); await page.keyboard.press('Tab'); await page.focus('[data-step="2"]').catch(() => {});
});

await step('theme and motion preferences: dark mode persists; reduced motion removes transitions', async () => {
  await page.click('#themeBtn'); const dark = await page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]); await page.reload(); await page.waitForSelector('#content *');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), dark[0]); assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), dark[1]);
  const ctx2 = await browser.newContext({ reducedMotion: 'reduce' }); const p2 = await ctx2.newPage(); await ctx2.route(/fonts\./, (r) => r.abort()); await p2.goto(base + '/'); await p2.waitForSelector('#content *');
  assert.equal(await p2.evaluate(() => getComputedStyle(document.querySelector('.btn')).transitionDuration), '0s'); await ctx2.close();
  await page.click('#themeBtn');
});

await step('mobile layout: no sideways scrolling, bottom navigation, generous touch targets', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await m.route(/fonts\./, (r) => r.abort()); const mp = await m.newPage(); await mp.goto(base + '/'); await mp.waitForSelector('#caption');
  for (const view of ['today', 'plan', 'files', 'brand', 'voice']) {
    await mp.click(`[data-view=${view}]`); await mp.waitForTimeout(250);
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(over <= 1, `${view}: horizontal overflow ${over}px`);
  }
  await mp.click('[data-view=today]'); await mp.waitForSelector('#caption');
  const small = await mp.evaluate(() => [...document.querySelectorAll('.btn:not(.link), .nav button, .steps button, .seg button, select, input[type=text], input[type=date]')].filter((e) => e.offsetParent).map((e) => ({ t: (e.textContent || e.id).trim().slice(0, 20), h: e.getBoundingClientRect().height })).filter((x) => x.h < 40));
  assert.deepEqual(small, [], 'controls under 40px tall'); const nav = await mp.evaluate(() => { const r = document.getElementById('nav').getBoundingClientRect(); return [r.bottom, window.innerHeight, getComputedStyle(document.getElementById('nav')).position]; });
  assert.equal(nav[2], 'fixed'); assert.ok(Math.abs(nav[0] - nav[1]) < 2, 'nav docked at the bottom');
  await mp.click('[data-view=plan]'); assert.ok(await mp.locator('.agenda').isVisible()); assert.equal(await mp.locator('.cal').isVisible(), false); await mp.screenshot({ path: 'test-results/mobile-plan.png' }); await m.close();
});

await step('no unexpected browser console errors during the whole run', async () => { assert.deepEqual(consoleErrors.filter((e) => !/Failed to load resource/.test(e)), []); });

await browser.close(); await server.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync('test-results/e2e.json', JSON.stringify({ ranAt: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} browser steps passed`);
process.exit(failed.length ? 1 : 0);
