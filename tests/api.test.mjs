import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, PNG, ttf } from './helpers.mjs';
import { createApp } from '../lib/app.js';
import { createPgliteDb } from '../lib/db.js';
import { createMemoryBlobs } from '../lib/blobs.js';

async function twoBrands(t) {
  const a = (await t.call('POST', '/api/brands', { name: 'Alpha Co', profile: { description: 'Loud', voice: { guidelines: 'ALPHA-VOICE' }, colors: { dark: '#101010', light: '#fafafa', primary: '#cc2200', accent: '#ffcc00' } } })).json.brand;
  const b = (await t.call('POST', '/api/brands', { name: 'Beta Labs', profile: { description: 'Quiet', voice: { guidelines: 'BETA-VOICE' }, colors: { dark: '#001a33', light: '#eef6ff', primary: '#0066aa', accent: '#33ddaa' } } })).json.brand;
  return { a, b };
}
const mkPost = async (t, brand, over = {}) => (await t.call('POST', `/api/brands/${brand.id}/posts`, { title: 'P', linkedin: 'LI text', instagram: 'IG text', ...over })).json.post;

test('brands: create, edit with revision, archive, validation', async () => {
  const t = await setup(); const { a } = await twoBrands(t);
  assert.equal((await t.call('GET', '/api/brands')).json.brands.length, 2);
  const bad = await t.call('POST', '/api/brands', { name: '  ' }); assert.equal(bad.status, 400);
  const e = await t.call('PATCH', `/api/brands/${a.id}`, { revision: a.revision, name: 'Alpha Renamed', profile: { ...a.profile, tagline: 'Hi' } });
  assert.equal(e.status, 200); assert.equal(e.json.brand.name, 'Alpha Renamed'); assert.equal(e.json.brand.revision, a.revision + 1);
  const stale = await t.call('PATCH', `/api/brands/${a.id}`, { revision: a.revision, name: 'Stale' }); assert.equal(stale.status, 409);
  assert.equal((await t.call('PATCH', `/api/brands/${a.id}`, { revision: e.json.brand.revision, profile: { ...a.profile, colors: { ...a.profile.colors, dark: 'nope' } } })).status, 400);
  const arch = await t.call('PATCH', `/api/brands/${a.id}`, { revision: e.json.brand.revision, status: 'archived' });
  assert.equal(arch.json.brand.status, 'archived');
  assert.equal((await t.call('POST', `/api/brands/${a.id}/posts`, { title: 'x' })).status, 400, 'archived brands take no new posts');
});

test('data separation: every read and write is scoped by brand on the server', async () => {
  const t = await setup(); const { a, b } = await twoBrands(t);
  const pa = await mkPost(t, a, { title: 'Alpha post' }); const pb = await mkPost(t, b, { title: 'Beta post' });
  assert.equal(pa.brandId, a.id);
  assert.deepEqual((await t.call('GET', `/api/brands/${a.id}/posts`)).json.posts.map((p) => p.title), ['Alpha post']);
  assert.deepEqual((await t.call('GET', `/api/brands/${b.id}/posts`)).json.posts.map((p) => p.title), ['Beta post']);
  // Cross-brand access by id is a 404, for read, write, actions, delete and review
  for (const [m, path, body] of [
    ['GET', `/api/brands/${b.id}/posts/${pa.id}`], ['PATCH', `/api/brands/${b.id}/posts/${pa.id}`, { revision: 1, changes: { linkedin: 'hijack' } }],
    ['POST', `/api/brands/${b.id}/posts/${pa.id}/actions/approve`, { revision: 1 }], ['DELETE', `/api/brands/${b.id}/posts/${pa.id}`],
    ['POST', `/api/brands/${b.id}/posts/${pa.id}/review`, { platform: 'linkedin', sources: [] }]]) {
    assert.equal((await t.call(m, path, body)).status, 404, `${m} ${path}`);
  }
  assert.equal((await t.call('GET', `/api/brands/${a.id}/posts/${pa.id}`)).json.post.linkedin, 'LI text');
  // brand association is stable: a PATCH cannot move a post
  const moved = await t.call('PATCH', `/api/brands/${a.id}/posts/${pa.id}`, { revision: pa.revision, changes: { brandId: b.id, brand_id: b.id, title: 'Renamed' } });
  assert.equal(moved.json.post.brandId, a.id); assert.equal(moved.json.post.title, 'Renamed');
  // files, excerpts, notes and history are brand-scoped too
  const fa = (await t.call('POST', `/api/brands/${a.id}/files`, PNG, { 'x-file-name': 'a.png', 'x-file-role': 'reference' })).json.file;
  assert.equal((await t.call('GET', `/api/brands/${b.id}/files/${fa.id}`)).status, 404);
  assert.equal((await t.call('DELETE', `/api/brands/${b.id}/files/${fa.id}`)).status, 404);
  assert.equal((await t.call('GET', `/api/brands/${b.id}/files`)).json.files.length, 0);
  const ex = (await t.call('POST', `/api/brands/${a.id}/excerpts`, { label: 'x', body: 'alpha only' })).json.excerpt;
  assert.equal((await t.call('DELETE', `/api/brands/${b.id}/excerpts/${ex.id}`)).status, 404);
  assert.equal((await t.call('PATCH', `/api/brands/${b.id}/posts/${pb.id}`, { revision: pb.revision, changes: { aiSources: [{ type: 'file', id: fa.id }] } })).status, 400);
  assert.equal((await t.call('PATCH', `/api/brands/${b.id}/posts/${pb.id}`, { revision: pb.revision, changes: { graphic: { imageFileId: fa.id } } })).status, 400);
  await t.call('PUT', `/api/brands/${a.id}/place`, { note: 'alpha note' });
  assert.equal((await t.call('GET', `/api/brands/${b.id}`)).json.brand.note, '');
  assert.equal((await t.call('PUT', `/api/brands/${b.id}/place`, { lastPostId: pa.id })).status, 400);
  // a logo from another brand cannot be assigned
  const bb = (await t.call('GET', `/api/brands/${b.id}`)).json.brand;
  assert.equal((await t.call('PATCH', `/api/brands/${b.id}`, { revision: bb.revision, profile: { ...bb.profile, logo: { fileId: fa.id, treatment: 'original' } } })).status, 400);
});

test('post workflow: approvals are server-enforced and caption edits invalidate them', async () => {
  const t = await setup(); const { a } = await twoBrands(t); let p = await mkPost(t, a);
  const act = async (name, extra = {}) => { const r = await t.call('POST', `/api/brands/${a.id}/posts/${p.id}/actions/${name}`, { revision: p.revision, ...extra }); if (r.json.post) p = r.json.post; return r; };
  assert.equal((await act('approve-image')).status, 400, 'image approval needs caption approval');
  assert.equal((await act('approve')).status, 200); assert.ok(p.approved);
  assert.equal((await act('approve-image')).status, 400, 'needs an image headline');
  let r = await t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { graphic: { line: 'Headline' } } }); p = r.json.post;
  assert.equal((await act('approve-image')).status, 200); assert.ok(p.imageReady);
  // clients cannot self-approve through PATCH
  r = await t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { approved: false, imageReady: true } }); p = r.json.post;
  assert.ok(p.approved && p.imageReady);
  // editing the caption clears both approvals
  r = await t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { linkedin: 'LI text changed' } }); p = r.json.post;
  assert.ok(!p.approved && !p.imageReady);
  // changing only the graphic clears just the image approval
  await act('approve'); await act('approve-image');
  r = await t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { graphic: { style: 'light' } } }); p = r.json.post;
  assert.ok(p.approved && !p.imageReady);
  // an empty caption cannot be approved
  r = await t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { instagram: '' } }); p = r.json.post;
  assert.equal((await act('approve')).status, 400);
});

test('posting statuses are separate per platform and recorded in history', async () => {
  const t = await setup(); const { a } = await twoBrands(t); let p = await mkPost(t, a);
  const act = async (extra) => { const r = await t.call('POST', `/api/brands/${a.id}/posts/${p.id}/actions/posted`, { revision: p.revision, ...extra }); if (r.json.post) p = r.json.post; return r; };
  await act({ platform: 'linkedin', posted: true }); assert.ok(p.postedLinkedinAt && !p.postedInstagramAt);
  await act({ platform: 'instagram', posted: true }); assert.ok(p.postedInstagramAt);
  await act({ platform: 'linkedin', posted: false }); assert.ok(!p.postedLinkedinAt && p.postedInstagramAt);
  assert.equal((await act({ platform: 'tiktok', posted: true })).status, 400);
  const h = (await t.call('GET', `/api/brands/${a.id}/history`)).json.history; assert.deepEqual(h.map((x) => x.type).slice(0, 3), ['unposted', 'posted', 'posted']);
  // posting status survives an edit to the caption (approval clears, history of posting does not)
  const r = await t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { instagram: 'new' } }); assert.ok(r.json.post.postedInstagramAt);
});

test('concurrent edits: the second writer gets a conflict, and nothing is lost', async () => {
  const t = await setup(); const { a } = await twoBrands(t); const p = await mkPost(t, a);
  const [r1, r2] = await Promise.all([1, 2].map((n) => t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { linkedin: 'tab ' + n } })));
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  const loser = r1.status === 409 ? r1 : r2; assert.ok(loser.json.current.linkedin.startsWith('tab '));
  const final = (await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post; assert.equal(final.revision, p.revision + 1);
  // many parallel writers at one revision: exactly one wins
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: final.revision, changes: { notes: 'n' + i } })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1); assert.equal(rs.filter((r) => r.status === 409).length, 7);
});

test('voice and branding changes mark reviews and approvals as needing a look without changing them', async () => {
  const t = await setup(); const { a } = await twoBrands(t); let p = await mkPost(t, a, { voiceMode: 'both' });
  await t.call('PUT', '/api/voice/founder', { name: 'Founder', guidelines: 'fv1' });
  const act = async (n) => { const r = await t.call('POST', `/api/brands/${a.id}/posts/${p.id}/actions/${n}`, { revision: p.revision }); p = r.json.post; };
  await t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { graphic: { line: 'L' } } }).then((r) => (p = r.json.post));
  await act('approve'); await act('approve-image');
  const rv = await t.call('POST', `/api/brands/${a.id}/posts/${p.id}/review`, { platform: 'linkedin', sources: [] }); assert.equal(rv.status, 200);
  p = (await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post;
  assert.equal(p.reviews.linkedin.stale, null); assert.ok(!p.needs.voiceReview && !p.needs.styleReview);
  // change brand voice
  let brand = (await t.call('GET', `/api/brands/${a.id}`)).json.brand;
  brand = (await t.call('PATCH', `/api/brands/${a.id}`, { revision: brand.revision, profile: { ...brand.profile, voice: { ...brand.profile.voice, guidelines: 'NEW' } } })).json.brand;
  assert.equal(brand.voiceVersion, 2); assert.equal(brand.styleVersion, 1);
  p = (await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post;
  assert.ok(p.approved && p.imageReady, 'approvals are not silently changed');
  assert.ok(p.needs.voiceReview && !p.needs.styleReview); assert.equal(p.reviews.linkedin.stale, 'voice'); assert.equal(p.linkedin, 'LI text');
  // change branding only
  brand = (await t.call('PATCH', `/api/brands/${a.id}`, { revision: brand.revision, profile: { ...brand.profile, colors: { ...brand.profile.colors, primary: '#123456' } } })).json.brand;
  assert.equal(brand.voiceVersion, 2); assert.equal(brand.styleVersion, 2);
  p = (await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post; assert.ok(p.needs.styleReview);
  // acknowledging records the new versions, still approved
  await act('acknowledge'); assert.ok(!p.needs.voiceReview && !p.needs.styleReview && p.approved && p.imageReady);
  // the founder voice changes affect only posts that use it; a brand-only post is unaffected
  let q = await mkPost(t, a, { voiceMode: 'brand' }); await t.call('POST', `/api/brands/${a.id}/posts/${q.id}/actions/approve`, { revision: q.revision });
  const f = (await t.call('GET', '/api/voice/founder')).json.founder;
  await t.call('PUT', '/api/voice/founder', { name: 'Founder', guidelines: 'fv2', revision: f.revision });
  q = (await t.call('GET', `/api/brands/${a.id}/posts/${q.id}`)).json.post; assert.ok(!q.needs.voiceReview);
  p = (await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post; assert.ok(p.needs.voiceReview);
  // a post's own voice choice change is a voice change too
  await t.call('PATCH', `/api/brands/${a.id}/posts/${q.id}`, { revision: q.revision, changes: { voiceMode: 'founder' } });
  assert.ok((await t.call('GET', `/api/brands/${a.id}/posts/${q.id}`)).json.post.needs.voiceReview);
});

test('files: sniffing, roles, limits, download headers, removal detaches and invalidates', async () => {
  const t = await setup(); const { a, b } = await twoBrands(t); let p = await mkPost(t, a);
  const up = (name, body, h = {}) => t.call('POST', `/api/brands/${a.id}/files`, body, { 'x-file-name': encodeURIComponent(name), ...h });
  const img = await up('photo.txt', PNG, { 'x-post-id': p.id }); assert.equal(img.status, 201); assert.equal(img.json.file.type, 'image/png'); assert.equal(img.json.file.role, 'attachment');
  assert.equal((await up('x.pdf', Buffer.from('%PDF-1.4 hi'), { 'x-post-id': p.id })).json.file.ai.supported, false);
  assert.equal((await up('empty.txt', Buffer.alloc(0))).status, 400);
  assert.equal((await up('huge.bin', Buffer.alloc(4 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await up('notafont.png', PNG, { 'x-file-role': 'font' })).status, 400);
  assert.equal((await up('f.ttf', ttf, { 'x-file-role': 'font' })).json.file.type, 'font/ttf');
  assert.equal((await up('logo.txt', Buffer.from('plain'), { 'x-file-role': 'logo' })).status, 400);
  assert.equal((await up('a.png', PNG, { 'x-post-id': 'nope' })).status, 404);
  const dl = await t.call('GET', `/api/brands/${a.id}/files/${img.json.file.id}?download=1`);
  assert.match(dl.headers['Content-Disposition'], /^attachment/); assert.equal(dl.headers['X-Content-Type-Options'], 'nosniff'); assert.match(dl.headers['Content-Security-Policy'], /sandbox/);
  assert.deepEqual(Buffer.from(dl.raw), PNG);
  assert.match((await t.call('GET', `/api/brands/${a.id}/files/${img.json.file.id}`)).headers['Content-Disposition'], /^inline/);
  const html = await up('page.html', Buffer.from('<script>alert(1)</script>'), { 'x-post-id': p.id });
  assert.equal(html.json.file.type, 'application/octet-stream');
  assert.match((await t.call('GET', `/api/brands/${a.id}/files/${html.json.file.id}`)).headers['Content-Disposition'], /^attachment/);
  // use for graphic, approve, then remove the file
  p = (await t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { graphic: { line: 'L', imageFileId: img.json.file.id }, aiSources: [{ type: 'file', id: img.json.file.id }] } })).json.post;
  for (const n of ['approve', 'approve-image']) p = (await t.call('POST', `/api/brands/${a.id}/posts/${p.id}/actions/${n}`, { revision: p.revision })).json.post;
  assert.ok(p.imageReady);
  assert.equal((await t.call('DELETE', `/api/brands/${a.id}/files/${img.json.file.id}`)).status, 200);
  p = (await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post;
  assert.equal(p.graphic.imageFileId, null); assert.ok(!p.imageReady && p.approved); assert.deepEqual(p.aiSources, []);
  assert.equal([...t.blobs.map.keys()].some((k) => k.endsWith(img.json.file.id)), false, 'bytes are deleted from storage');
  assert.equal((await t.call('GET', `/api/brands/${a.id}/files/${img.json.file.id}`)).status, 404);
  // deleting a post removes its files
  const f2 = (await up('keep.png', PNG, { 'x-post-id': p.id })).json.file;
  await t.call('DELETE', `/api/brands/${a.id}/posts/${p.id}`); assert.equal((await t.call('GET', `/api/brands/${a.id}/files`)).json.files.some((f) => f.id === f2.id), false);
  void b;
});

test('logo and font removal marks brand style as changed', async () => {
  const t = await setup(); const { a } = await twoBrands(t);
  const logo = (await t.call('POST', `/api/brands/${a.id}/files`, PNG, { 'x-file-name': 'l.png', 'x-file-role': 'logo' })).json.file;
  const font = (await t.call('POST', `/api/brands/${a.id}/files`, ttf, { 'x-file-name': 'f.ttf', 'x-file-role': 'font' })).json.file;
  let brand = (await t.call('GET', `/api/brands/${a.id}`)).json.brand;
  brand = (await t.call('PATCH', `/api/brands/${a.id}`, { revision: brand.revision, profile: { ...brand.profile, logo: { fileId: logo.id, treatment: 'tint' }, fonts: { heading: { source: 'upload', family: 'DejaVu', fileId: font.id }, body: brand.profile.fonts.body } } })).json.brand;
  assert.equal(brand.styleVersion, 2);
  await t.call('DELETE', `/api/brands/${a.id}/files/${font.id}`);
  brand = (await t.call('GET', `/api/brands/${a.id}`)).json.brand; assert.equal(brand.profile.fonts.heading.source, 'system'); assert.equal(brand.styleVersion, 3);
});

test('security: auth, origin checks, JSON limits, unmigrated database', async () => {
  const t = await setup({ env: { LAUNCH_ROOM_ALLOW_NO_PASSWORD: '', LAUNCH_ROOM_PASSWORD: 'correct horse' } });
  assert.equal((await t.call('GET', '/api/brands')).status, 401);
  const auth = (pw) => ({ authorization: 'Basic ' + Buffer.from('marcos:' + pw).toString('base64') });
  assert.equal((await t.call('GET', '/api/brands', undefined, auth('wrong'))).status, 401);
  assert.equal((await t.call('GET', '/api/brands', undefined, auth('correct horse'))).status, 200);
  assert.equal((await t.call('POST', '/api/brands', { name: 'x' }, { ...auth('correct horse'), origin: 'https://evil.example' })).status, 403);
  assert.equal((await t.call('POST', '/api/brands', { name: 'x' }, { ...auth('correct horse'), origin: undefined })).status, 403);
  assert.equal((await t.call('POST', '/api/brands', { name: 'x' }, { ...auth('correct horse'), origin: 'http://x.test' })).status, 200);
  const page = await t.call('GET', '/', undefined, auth('correct horse')); assert.match(page.headers['Content-Security-Policy'], /script-src 'self'/);
  const nopw = await setup({ env: { LAUNCH_ROOM_ALLOW_NO_PASSWORD: '' } }); assert.equal((await nopw.call('GET', '/')).status, 503);
  const db = await createPgliteDb(); const app = createApp({ db, blobs: createMemoryBlobs(), env: { LAUNCH_ROOM_ALLOW_NO_PASSWORD: '1' } });
  const r = await app.handle({ method: 'GET', path: '/api/bootstrap', query: {}, headers: {}, body: Buffer.alloc(0) }); assert.equal(r.status, 503);
  assert.match(JSON.parse(r.body).error, /migrate/);
});

test('first-time setup button creates the tables once, behind sign-in and same-origin, and is repeatable', async () => {
  const { createPgliteDb } = await import('../lib/db.js'); const db = await createPgliteDb();
  const app = createApp({ db, blobs: createMemoryBlobs(), env: { LAUNCH_ROOM_PASSWORD: 'pw pw pw' } });
  const auth = { authorization: 'Basic ' + Buffer.from('x:pw pw pw').toString('base64') };
  const call = (method, path, headers = {}) => app.handle({ method, path, query: {}, headers: { host: 'h', ...headers }, body: Buffer.alloc(0) });
  assert.equal((await call('POST', '/api/setup/database', { origin: 'http://h' })).status, 401);
  assert.equal((await call('POST', '/api/setup/database', { ...auth, origin: 'http://evil' })).status, 403);
  assert.equal((await call('GET', '/api/brands', auth)).status, 503);
  assert.equal((await call('POST', '/api/setup/database', { ...auth, origin: 'http://h' })).status, 200);
  assert.equal((await call('POST', '/api/setup/database', { ...auth, origin: 'http://h' })).status, 200);
  assert.equal((await call('GET', '/api/brands', auth)).status, 200);
});

test('carousel slides: validated, brand-scoped, change clears image approval, file removal detaches', async () => {
  const t = await setup(); const { a, b } = await twoBrands(t); let p = await mkPost(t, a);
  const img = (await t.call('POST', `/api/brands/${a.id}/files`, PNG, { 'x-file-name': 's.png', 'x-file-role': 'reference' })).json.file;
  const foreign = (await t.call('POST', `/api/brands/${b.id}/files`, PNG, { 'x-file-name': 'b.png', 'x-file-role': 'reference' })).json.file;
  const patch = (graphic) => t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { graphic } });
  assert.deepEqual(p.graphic.slides, []);
  assert.equal((await patch({ slides: Array.from({ length: 10 }, () => ({ line: 'x' })) })).status, 400, 'at most 10 slides in total');
  assert.equal((await patch({ slides: [{ line: 'x', imageFileId: foreign.id }] })).status, 400, 'other brand image refused');
  assert.equal((await patch({ slides: [{ line: 'y'.repeat(201) }] })).status, 400);
  let r = await patch({ line: 'Slide one' }); p = r.json.post;
  for (const n of ['approve', 'approve-image']) p = (await t.call('POST', `/api/brands/${a.id}/posts/${p.id}/actions/${n}`, { revision: p.revision })).json.post;
  assert.ok(p.imageReady);
  r = await patch({ slides: [{ line: 'Two', imageFileId: img.id }, { line: 'Three' }] }); p = r.json.post;
  assert.equal(p.graphic.slides.length, 2); assert.ok(p.approved && !p.imageReady, 'slides changed: image approval cleared, caption approval kept');
  await t.call('DELETE', `/api/brands/${a.id}/files/${img.id}`);
  p = (await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post; assert.equal(p.graphic.slides[0].imageFileId, null); assert.equal(p.graphic.slides[0].line, 'Two');
});

test('excerpts: validation, selection, and removal cleans selections', async () => {
  const t = await setup(); const { a } = await twoBrands(t); let p = await mkPost(t, a);
  assert.equal((await t.call('POST', `/api/brands/${a.id}/excerpts`, { label: 'x', body: '' })).status, 400);
  assert.equal((await t.call('POST', `/api/brands/${a.id}/excerpts`, { label: 'x', body: 'y'.repeat(12001) })).status, 400);
  const ex = (await t.call('POST', `/api/brands/${a.id}/excerpts`, { label: 'Study', body: 'The study found X.', postId: p.id })).json.excerpt;
  p = (await t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { aiSources: [{ type: 'excerpt', id: ex.id }] } })).json.post; assert.equal(p.aiSources.length, 1);
  await t.call('DELETE', `/api/brands/${a.id}/excerpts/${ex.id}`);
  assert.deepEqual((await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post.aiSources, []);
});
