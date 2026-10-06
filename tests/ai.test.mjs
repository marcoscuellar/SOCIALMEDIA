import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, PNG, fakeReview } from './helpers.mjs';

async function fixture(opts = {}) {
  const t = await setup(opts);
  await t.call('PUT', '/api/voice/founder', { name: 'Marcos', guidelines: 'FOUNDER-STYLE warm candid', avoid: 'corporate polish' });
  const mk = async (name, voice, facts) => (await t.call('POST', '/api/brands', { name, profile: { voice: { guidelines: voice }, facts: { confirmed: facts, verify: ['UNVERIFIED-' + name] } } })).json.brand;
  const a = await mk('Alpha', 'ALPHA-VOICE', ['Alpha fact one']); const b = await mk('Beta', 'BETA-VOICE', ['Beta fact one']);
  const post = async (brand, o = {}) => (await t.call('POST', `/api/brands/${brand.id}/posts`, { title: 'T', linkedin: 'Caption ' + Math.random(), instagram: 'IG', ...o })).json.post;
  const review = (brand, p, body = {}) => t.call('POST', `/api/brands/${brand.id}/posts/${p.id}/review`, { platform: 'linkedin', question: 'Check', sources: [], ...body });
  return { t, a, b, post, review };
}
const sentText = (call) => JSON.stringify(call);

test('voice choice controls which voice and facts reach the AI request', async () => {
  const { t, a, post, review } = await fixture();
  for (const [mode, hasBrand, hasFounder] of [['brand', true, false], ['founder', false, true], ['both', true, true]]) {
    const p = await post(a, { voiceMode: mode }); t.calls.length = 0;
    assert.equal((await review(a, p)).status, 200);
    const body = sentText(t.calls[0]);
    assert.equal(body.includes('ALPHA-VOICE'), hasBrand, mode); assert.equal(body.includes('FOUNDER-STYLE'), hasFounder, mode);
    assert.ok(body.includes('Alpha fact one'), 'confirmed facts are sent'); assert.ok(!body.includes('BETA-VOICE') && !body.includes('Beta fact one'), 'other brand never leaks');
    assert.ok(body.includes('UNVERIFIED-Alpha'));
    assert.equal(t.calls[0].model, 'gpt-4o-mini-2024-07-18'); assert.equal(t.calls[0].store, false); assert.equal(t.calls[0].max_output_tokens, 2000);
  }
});

test('review is only sent on request, and nothing but selected sources is included', async () => {
  const { t, a, post, review } = await fixture(); const p = await post(a);
  const sel = (await t.call('POST', `/api/brands/${a.id}/files`, Buffer.from('SELECTED-NOTES alpha research'), { 'x-file-name': 'selected.txt', 'x-file-role': 'reference' })).json.file;
  await t.call('POST', `/api/brands/${a.id}/files`, Buffer.from('SECRET-UNSELECTED text'), { 'x-file-name': 'other.txt', 'x-file-role': 'reference' });
  await t.call('POST', `/api/brands/${a.id}/files`, PNG, { 'x-file-name': 'unselected.png', 'x-file-role': 'reference' });
  await t.call('POST', `/api/brands/${a.id}/excerpts`, { label: 'x', body: 'EXCERPT-UNSELECTED' });
  assert.equal(t.calls.length, 0, 'uploading and saving never calls AI');
  await review(a, p); assert.ok(!sentText(t.calls[0]).includes('SECRET-UNSELECTED') && !sentText(t.calls[0]).includes('EXCERPT-UNSELECTED') && !sentText(t.calls[0]).includes('data:image'));
  await review(a, p, { sources: [{ type: 'file', id: sel.id }] });
  const s2 = sentText(t.calls[1]); assert.ok(s2.includes('SELECTED-NOTES')); assert.ok(!s2.includes('SECRET-UNSELECTED'));
});

test('sources: unsupported formats, other brands, oversize and image handling', async () => {
  const { t, a, b, post, review } = await fixture(); const p = await post(a);
  const up = async (brand, name, body, role = 'reference') => (await t.call('POST', `/api/brands/${brand.id}/files`, body, { 'x-file-name': name, 'x-file-role': role })).json.file;
  const pdf = await up(a, 'paper.pdf', Buffer.from('%PDF-1.4 x')), big = await up(a, 'big.txt', Buffer.from('x'.repeat(50000))), img = await up(a, 'shot.png', PNG), foreign = await up(b, 'beta.txt', Buffer.from('beta only'));
  for (const f of [pdf, big]) { const r = await review(a, p, { sources: [{ type: 'file', id: f.id }] }); assert.equal(r.status, 400, f.name); assert.match(r.json.error, /excerpt/i); }
  assert.equal((await review(a, p, { sources: [{ type: 'file', id: foreign.id }] })).status, 400);
  assert.equal(t.calls.length, 0, 'rejected sources never reach the provider');
  const ok = await review(a, p, { sources: [{ type: 'file', id: img.id }] }); assert.equal(ok.status, 200);
  const part = t.calls[0].input[0].content; assert.equal(part[1].type, 'input_image'); assert.equal(part[1].detail, 'low'); assert.match(part[1].image_url, /^data:image\/png;base64,/);
  // too many images
  const imgs = [img]; for (let i = 0; i < 3; i++) imgs.push(await up(a, `i${i}.png`, Buffer.concat([PNG, Buffer.from([i])])));
  assert.equal((await review(a, p, { sources: imgs.map((f) => ({ type: 'file', id: f.id })) })).status, 400);
  // tampered storage is detected
  const row = (await t.db.query(`SELECT blob_key FROM files WHERE id=$1`, [img.id]))[0]; t.blobs.map.set(row.blob_key, Buffer.concat([PNG, Buffer.from('tamper')]));
  const tam = await review(a, p, { sources: [{ type: 'file', id: img.id }], question: 'again' }); assert.equal(tam.status, 400); assert.match(tam.json.error, /no longer matches/);
  // oversize combined text
  const ex = []; for (let i = 0; i < 6; i++) ex.push((await t.call('POST', `/api/brands/${a.id}/excerpts`, { label: 'e' + i, body: 'z'.repeat(11000) })).json.excerpt);
  const r = await review(a, p, { sources: ex.map((e) => ({ type: 'excerpt', id: e.id })) }); assert.equal(r.status, 400); assert.match(r.json.error, /limit/);
});

test('the AI returns claim support, and citations the server cannot verify are downgraded', async () => {
  const { t, a, post, review } = await fixture(); const p = await post(a);
  const f = (await t.call('POST', `/api/brands/${a.id}/files`, Buffer.from('Study: 4 of 5 improved.'), { 'x-file-name': 'study.txt', 'x-file-role': 'reference' })).json.file;
  const r = await review(a, p, { sources: [{ type: 'file', id: f.id }] });
  const claims = r.json.review.claims;
  assert.equal(claims[0].status, 'supported'); assert.deepEqual(claims[0].sources, ['File: study.txt']);
  assert.equal(claims[1].status, 'unsupported');
  const t2 = await fixture({ fetcher: async (u, o) => Response.json(fakeReview(o, { claims: [{ claim: 'Invented', status: 'supported', sources: ['Imaginary report.pdf'], note: '' }] })) });
  const p2 = await t2.post(t2.a); const r2 = await t2.review(t2.a, p2);
  assert.equal(r2.json.review.claims[0].status, 'unsupported', 'a citation to a source that was not supplied does not count'); assert.deepEqual(r2.json.review.claims[0].sources, []);
});

test('cache: identical requests are reused; brand, voice version, caption, question and source versions change the key', async () => {
  const { t, a, b, post, review } = await fixture(); const p = await post(a, { voiceMode: 'both' });
  const first = await review(a, p); assert.equal(first.json.cached, false);
  const again = await review(a, p); assert.equal(again.json.cached, true); assert.equal(t.calls.length, 1);
  assert.equal((await t.call('GET', '/api/ai-usage')).json.usage.usedToday, 1, 'a cache hit uses no slot');
  await review(a, p, { question: 'different' }); assert.equal(t.calls.length, 2);
  const ex = (await t.call('POST', `/api/brands/${a.id}/excerpts`, { label: 'e', body: 'v1' })).json.excerpt;
  await review(a, p, { sources: [{ type: 'excerpt', id: ex.id }] }); assert.equal(t.calls.length, 3);
  await review(a, p, { sources: [{ type: 'excerpt', id: ex.id }] }); assert.equal(t.calls.length, 3, 'same source version reuses');
  const ex2 = (await t.call('POST', `/api/brands/${a.id}/excerpts`, { label: 'e', body: 'v2 changed' })).json.excerpt;
  await review(a, p, { sources: [{ type: 'excerpt', id: ex2.id }] }); assert.equal(t.calls.length, 4, 'new source version');
  // caption change
  const cur = (await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post;
  await t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: cur.revision, changes: { linkedin: cur.linkedin + ' edit' } }); await review(a, p); assert.equal(t.calls.length, 5);
  // brand voice version bump
  const br = (await t.call('GET', `/api/brands/${a.id}`)).json.brand;
  await t.call('PATCH', `/api/brands/${a.id}`, { revision: br.revision, profile: { ...br.profile, voice: { ...br.profile.voice, guidelines: 'CHANGED' } } }); await review(a, p); assert.equal(t.calls.length, 6);
  // founder voice version bump affects 'both' but not 'brand' posts
  const pb = await post(a, { voiceMode: 'brand' }); await review(a, pb); const n = t.calls.length;
  const f = (await t.call('GET', '/api/voice/founder')).json.founder; await t.call('PUT', '/api/voice/founder', { ...f, guidelines: 'NEW FOUNDER', revision: f.revision });
  await review(a, pb); assert.equal(t.calls.length, n, 'brand-voice review unaffected by founder voice'); await review(a, p); assert.equal(t.calls.length, n + 1);
  // same words in another brand never reuse
  const pbeta = await post(b, { linkedin: cur.linkedin + ' edit' }); await review(b, pbeta); assert.equal(t.calls.length, n + 2);
  // stale flags
  const final = (await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post; assert.equal(final.reviews.linkedin.stale, null);
});

test('daily limit: 10 reviews, enforced before any request, including under concurrency', async () => {
  const { t, a, post, review } = await fixture(); const posts = []; for (let i = 0; i < 20; i++) posts.push(await post(a));
  const rs = await Promise.all(posts.map((p) => review(a, p)));
  assert.equal(t.calls.length, 10); assert.equal(rs.filter((r) => r.status === 200).length, 10); assert.equal(rs.filter((r) => r.status === 429).length, 10);
  assert.match(rs.find((r) => r.status === 429).json.error, /10 AI reviews are used/);
  const usage = (await t.call('GET', '/api/ai-usage')).json.usage; assert.equal(usage.usedToday, 10); assert.equal(usage.remainingToday, 0);
  // saved feedback is still readable, and cached repeats still work at the limit
  assert.equal((await review(a, posts.find((_, i) => rs[i].status === 200))).json.cached, true);
  assert.equal(t.calls.length, 10);
});

test('concurrent identical requests make one upstream call', async () => {
  const { t, a, post, review } = await fixture(); const p = await post(a);
  const rs = await Promise.all(Array.from({ length: 6 }, () => review(a, p)));
  assert.equal(t.calls.length, 1); assert.equal(rs.filter((r) => r.status === 200).length >= 1, true); assert.ok(rs.every((r) => [200, 409].includes(r.status)));
  assert.equal((await t.call('GET', '/api/ai-usage')).json.usage.usedToday, 1);
});

test('monthly allowance uses the pre-send estimate, which includes images', async () => {
  const { t, a, post, review } = await fixture(); const p = await post(a);
  const img = (await t.call('POST', `/api/brands/${a.id}/files`, PNG, { 'x-file-name': 's.png', 'x-file-role': 'reference' })).json.file;
  const textEst = (await t.call('POST', `/api/brands/${a.id}/posts/${p.id}/review-preview`, { platform: 'linkedin', sources: [] })).json.estimatedMaxDollars;
  const imgEst = (await t.call('POST', `/api/brands/${a.id}/posts/${p.id}/review-preview`, { platform: 'linkedin', sources: [{ type: 'file', id: img.id }] })).json;
  assert.ok(imgEst.estimatedMaxDollars > textEst + 0.0005, 'images raise the reservation'); assert.equal(imgEst.sends.sources[0].kind, 'image'); assert.equal(t.calls.length, 0, 'preview never calls AI');
  // leave room for a text review but not an image review
  const room = Math.round((textEst + imgEst.estimatedMaxDollars) / 2 * 1e6);
  await t.db.query(`UPDATE ai_budget SET month='2026-10', month_micros=$1 WHERE id=1`, [5000000 - room]);
  const rImg = await review(a, p, { sources: [{ type: 'file', id: img.id }] }); assert.equal(rImg.status, 429); assert.match(rImg.json.error, /monthly/); assert.equal(t.calls.length, 0);
  const rTxt = await review(a, p); assert.equal(rTxt.status, 200); assert.equal(t.calls.length, 1);
  await t.db.query(`UPDATE ai_budget SET month_micros=5000000 WHERE id=1`);
  const p2 = await post(a); assert.equal((await review(a, p2)).status, 429); assert.equal(t.calls.length, 1);
});

test('spend is recorded from reported usage, replacing the reservation; unknown usage keeps it', async () => {
  const { t, a, post, review } = await fixture(); const p = await post(a); const before = Number((await t.db.query(`SELECT month_micros FROM ai_budget`))[0].month_micros);
  await review(a, p); const run = (await t.db.query(`SELECT * FROM ai_runs WHERE status='done'`))[0];
  assert.equal(run.cost_micros, Math.ceil(1200 * 0.15 + 300 * 0.6)); assert.equal(run.reserved_micros, run.cost_micros);
  assert.equal(Number((await t.db.query(`SELECT month_micros FROM ai_budget`))[0].month_micros), before + run.cost_micros);
  const t2 = await fixture({ fetcher: async (u, o) => { const r = fakeReview(o); delete r.usage; return Response.json(r); } });
  const p2 = await t2.post(t2.a); await t2.review(t2.a, p2); const r2 = (await t2.t.db.query(`SELECT * FROM ai_runs`))[0];
  assert.equal(r2.status, 'done'); assert.equal(r2.cost_micros, 0); assert.ok(r2.reserved_micros > 1000, 'full reservation retained');
  // measured usage above the reservation is still recorded (never undercounted)
  const t3 = await fixture({ fetcher: async (u, o) => { const r = fakeReview(o); r.usage = { input_tokens: 500000, output_tokens: 2000 }; return Response.json(r); } });
  const p3 = await t3.post(t3.a); await t3.review(t3.a, p3); const r3 = (await t3.t.db.query(`SELECT * FROM ai_runs`))[0]; assert.ok(r3.reserved_micros > 70000);
});

test('failures: no automatic retries; definite provider rejections are refunded; uncertain outcomes keep the reservation', async () => {
  const cases = [
    ['network error', async () => { throw new Error('timeout'); }, 502, 'uncertain', true],
    ['provider 500', async () => new Response('x', { status: 500 }), 502, 'failed', true],
    ['provider 429', async () => new Response('x', { status: 429 }), 502, 'rejected', false],
    ['provider 401', async () => new Response('x', { status: 401 }), 502, 'rejected', false],
    ['garbage body', async () => Response.json({ usage: { input_tokens: 10, output_tokens: 5 }, output: [{ content: [{ type: 'output_text', text: 'not json' }] }] }), 502, 'failed', true],
  ];
  for (const [name, impl, status, runStatus, counts] of cases) {
    let calls = 0; const { t, a, post, review } = await fixture({ fetcher: async (...x) => { calls++; return impl(...x); } });
    const p = await post(a); const r = await review(a, p);
    assert.equal(r.status, status, name); assert.equal(calls, 1, name + ': exactly one upstream attempt, no retry');
    assert.equal((await t.db.query(`SELECT status FROM ai_runs`))[0].status, runStatus, name);
    const u = (await t.call('GET', '/api/ai-usage')).json.usage; assert.equal(u.usedToday, counts ? 1 : 0, name);
    if (!counts) assert.equal(u.monthDollars, 0, name);
    assert.equal((await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post.linkedin, p.linkedin, 'caption untouched');
  }
});

test('fails closed: unreadable usage, invalid settings, missing key', async () => {
  const { t, a, post, review } = await fixture(); const p = await post(a);
  const real = t.db.query; t.app.ctx.db.query = async (text, params) => { if (/ai_budget|ai_runs/.test(text)) throw new Error('db down'); return real(text, params); };
  const r = await review(a, p); assert.ok(r.status >= 500); assert.equal(t.calls.length, 0, 'no provider request when the ledger cannot be checked');
  t.app.ctx.db.query = real;
  const bad = await fixture({ env: { AI_DAILY_LIMIT: 'lots' } }); const pb = await bad.post(bad.a); const rb = await bad.review(bad.a, pb);
  assert.equal(rb.status, 503); assert.match(rb.json.error, /invalid/); assert.equal(bad.t.calls.length, 0);
  const nokey = await fixture({ env: { OPENAI_API_KEY: '' } }); const pn = await nokey.post(nokey.a); const rn = await nokey.review(nokey.a, pn);
  assert.equal(rn.status, 503); assert.match(rn.json.error, /not connected/); assert.equal(nokey.t.calls.length, 0);
  assert.equal((await nokey.t.call('GET', '/api/bootstrap')).json.capabilities.ai, false);
});

test('rollover: midnight in the workspace timezone resets the daily count; a new month resets the allowance', async () => {
  const { t, a, post, review } = await fixture({ clock: { t: new Date('2026-10-06T04:30:00Z') } }); // 23:30 Oct 5 in Chicago
  for (let i = 0; i < 10; i++) assert.equal((await review(a, await post(a))).status, 200);
  assert.equal((await review(a, await post(a))).status, 429); assert.equal(t.calls.length, 10);
  assert.equal((await t.call('GET', '/api/ai-usage')).json.usage.day, '2026-10-05');
  t.now.t = new Date('2026-10-06T05:30:00Z'); // 00:30 Oct 6
  const u = (await t.call('GET', '/api/ai-usage')).json.usage; assert.equal(u.day, '2026-10-06'); assert.equal(u.usedToday, 0); assert.ok(u.monthDollars > 0, 'month still counts');
  assert.equal((await review(a, await post(a))).status, 200);
  assert.equal((await t.call('GET', '/api/ai-usage')).json.usage.usedToday, 1);
  // month rollover
  await t.db.query(`UPDATE ai_budget SET month_micros=4999000`);
  assert.equal((await review(a, await post(a))).status, 429, 'monthly limit reached in October');
  t.now.t = new Date('2026-11-01T06:30:00Z');
  const u2 = (await t.call('GET', '/api/ai-usage')).json.usage; assert.equal(u2.month, '2026-11'); assert.equal(u2.monthDollars, 0);
  assert.equal((await review(a, await post(a))).status, 200);
});

test('a stuck pending request is not blocked forever, and the slot stays counted', async () => {
  const { t, a, post, review } = await fixture(); const p = await post(a);
  let release; const gate = new Promise((r) => (release = r));
  t.app.ctx.fetcher = async (u, o) => { await gate; return Response.json(fakeReview(o)); };
  const first = review(a, p); await new Promise((r) => setTimeout(r, 300));
  assert.equal((await review(a, p)).status, 409, 'in-flight duplicate is refused');
  t.now.t = new Date(t.now.t.getTime() + 120000); // function died; 2 minutes later
  t.app.ctx.fetcher = async (u, o) => Response.json(fakeReview(o));
  const retry = await review(a, p); assert.equal(retry.status, 200);
  const runs = await t.db.query(`SELECT status FROM ai_runs ORDER BY started_at`); assert.ok(runs.some((r) => r.status === 'uncertain'));
  release(); await first;
  assert.equal((await t.call('GET', '/api/ai-usage')).json.usage.usedToday, 2, 'both attempts consumed a slot');
});

test('usage is reported in total and by brand', async () => {
  const { t, a, b, post, review } = await fixture();
  for (let i = 0; i < 3; i++) await review(a, await post(a)); await review(b, await post(b));
  const u = (await t.call('GET', '/api/ai-usage')).json.usage;
  assert.equal(u.usedToday, 4); assert.equal(u.byBrand.find((x) => x.brandId === a.id).usedToday, 3); assert.equal(u.byBrand.find((x) => x.brandId === b.id).usedToday, 1);
  assert.ok(Math.abs(u.byBrand.reduce((n, x) => n + x.monthDollars, 0) - u.monthDollars) < 1e-9);
});

test('review results save to the post, scoped to its brand, and never overwrite the caption', async () => {
  const { t, a, b, post, review } = await fixture(); const p = await post(a, { linkedin: 'My exact words' });
  const r = await review(a, p); assert.equal(r.status, 200); assert.ok(r.json.review.suggestedCaption.includes('tightened'));
  const saved = (await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post; assert.equal(saved.linkedin, 'My exact words'); assert.equal(saved.reviews.linkedin.stale, null);
  assert.equal((await review(b, p)).status, 404);
  const cur = saved; const edited = (await t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: cur.revision, changes: { linkedin: 'My exact words!' } })).json.post;
  assert.equal(edited.reviews.linkedin.stale, 'caption'); assert.ok(!edited.approved);
});

test('a brand aesthetic direction is sent only for that brand and changes the cache key', async () => {
  const { t, a, b, post, review } = await fixture(); const p = await post(a); await review(a, p); assert.ok(!sentText(t.calls[0]).includes('AESTHETIC DIRECTION'));
  const br = (await t.call('GET', `/api/brands/${a.id}`)).json.brand;
  assert.equal((await t.call('PATCH', `/api/brands/${a.id}`, { revision: br.revision, profile: { ...br.profile, aesthetic: 'warm-editorial' } })).status, 200);
  assert.equal((await t.call('PATCH', `/api/brands/${a.id}`, { revision: br.revision + 1, profile: { ...br.profile, aesthetic: 'nope' } })).status, 400);
  await review(a, p); assert.equal(t.calls.length, 2, 'new direction means a new review'); assert.match(sentText(t.calls[1]), /AESTHETIC DIRECTION: Warm editorial/);
  const pb = await post(b); await review(b, pb); assert.ok(!sentText(t.calls[2]).includes('AESTHETIC DIRECTION'), 'other brands are unaffected');
});
