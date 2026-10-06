import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setup, PNG } from './helpers.mjs';
import { readSeedPosts, installStarter, NENEMI_ID } from '../lib/seed.js';
import { planMigration, applyMigration, readLegacyState, validateLegacyState } from '../lib/legacy.js';
import { dumpAll, restoreAll, buildBackup } from '../lib/backup.js';
import { createPgliteDb, migrate } from '../lib/db.js';

// A realistic "live" legacy workspace: some approvals, an approved image, posted statuses, attachments, reviews, a note.
function legacyState() {
  const s = readSeedPosts(); const P = s.posts;
  Object.assign(P[0], { approved: true, imageReady: true, postedLinkedin: true, postedInstagram: false, linkedin: P[0].linkedin + '\n\nEDITED LIVE', note: 'remember the email' });
  Object.assign(P[1], { approved: true, imageReady: false });
  Object.assign(P[2], { paused: true });
  Object.assign(P[3], { approved: true, imageReady: true, postedLinkedin: true, postedInstagram: true, asset: 'upload', imageFileId: 'aaaaaaaa-0000-0000-0000-000000000001', attachments: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'team photo.png', size: PNG.length, type: 'image/png', url: '/api/files/aaaaaaaa-0000-0000-0000-000000000001' }, { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'research.pdf', size: 11, type: 'application/octet-stream', url: '/api/files/x' }] });
  P[4].reviews = { linkedin: { caption: P[4].linkedin, voiceVersion: 'marcos-2026-10-05-v1', ready: true, summary: 'Old review', works: ['a'], tips: ['b'], suggestedCaption: 'sug', reviewedAt: '2026-10-05T10:00:00Z' } };
  P[4].reviewQuestions = { linkedin: 'Does this sound like me?' }; P[4].captionHistory = { linkedin: 'PRE-SUGGESTION WORDING' };
  s.note = 'Left off at post 3'; s.selected = '3'; return s;
}
async function legacyDb(state, ledger) {
  const t = await setup(); // new schema already migrated; add the legacy table beside it
  await t.db.query(`CREATE TABLE launch_workspace (id text PRIMARY KEY, payload text NOT NULL, revision integer NOT NULL DEFAULT 1)`);
  await t.db.query(`INSERT INTO launch_workspace VALUES ('marcos', $1, 7)`, [JSON.stringify(state)]);
  if (ledger) await t.db.query(`INSERT INTO launch_workspace VALUES ('ai-cost-v1', $1, 3)`, [JSON.stringify(ledger)]);
  // legacy blobs live under post-files/<id>
  await t.blobs.put('post-files/aaaaaaaa-0000-0000-0000-000000000001', PNG); await t.blobs.put('post-files/aaaaaaaa-0000-0000-0000-000000000002', Buffer.from('%PDF-1.4 hi'));
  return t;
}
const legacyChecksum = async (db) => createHash('sha256').update(JSON.stringify(await db.query(`SELECT * FROM launch_workspace ORDER BY id`))).digest('hex');

test('dry run describes the migration and writes nothing', async () => {
  const state = legacyState(); const t = await legacyDb(state);
  const { state: read } = await readLegacyState(t.db); const plan = planMigration(read);
  assert.deepEqual({ posts: plan.posts, approved: plan.approved, imageApproved: plan.imageApproved, li: plan.postedLinkedin, ig: plan.postedInstagram, files: plan.attachments, note: plan.returnNote }, { posts: 21, approved: 3, imageApproved: 2, li: 2, ig: 1, files: 2, note: true });
  assert.deepEqual(plan.problems, []);
  assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM brands`))[0].n, 0);
});

test('apply preserves drafts, approvals, statuses, attachments and notes; the legacy rows are untouched', async () => {
  const state = legacyState(); const ledger = { entries: [{ id: 'x', day: '2026-10-06', cost: 2500, status: 'done' }] };
  const t = await legacyDb(state, ledger); const before = await legacyChecksum(t.db);
  const r = await applyMigration(t.db, t.blobs, state, { ledger, now: t.now.t });
  assert.equal(r.imported, 21); assert.equal(r.files, 2); assert.deepEqual(r.filesUnverified, []); assert.equal(r.usageImported, true);
  assert.equal(await legacyChecksum(t.db), before, 'legacy data was not modified');
  const posts = (await t.call('GET', `/api/brands/${NENEMI_ID}/posts`)).json.posts; assert.equal(posts.length, 21);
  const by = Object.fromEntries(posts.map((p) => [p.id.replace('post_nenemi_', ''), p]));
  assert.ok(by['0'].linkedin.endsWith('EDITED LIVE'), 'live edits win over seed text');
  assert.ok(by['0'].approved && by['0'].imageReady && by['0'].postedLinkedinAt && !by['0'].postedInstagramAt);
  assert.ok(by['1'].approved && !by['1'].imageReady); assert.ok(by['2'].paused);
  assert.ok(by['3'].postedLinkedinAt && by['3'].postedInstagramAt); assert.ok(!by['5'].approved && !by['5'].postedLinkedinAt);
  assert.ok(posts.every((p) => !p.needs.voiceReview && !p.needs.styleReview), 'migration itself does not flag approved work');
  assert.equal(by['0'].graphic.imageFileId, 'file_nenemi_approval_email'); assert.equal(by['0'].graphic.footer, 'APPROVED FOR DISTRIBUTION'); assert.equal(by['0'].graphic.style, 'dark');
  assert.equal(by['1'].graphic.style, 'primary'); assert.equal(by['2'].graphic.style, 'light'); assert.equal(by['0'].date, '2026-10-04'); assert.equal(by['0'].voiceMode, 'both');
  assert.equal(by['3'].graphic.imageFileId, 'file_legacy_aaaaaaaa-0000-0000-0000-000000000001');
  assert.match(by['0'].notes, /remember the email/); assert.match(by['4'].notes, /PRE-SUGGESTION WORDING/);
  assert.equal(by['4'].reviewQuestions.linkedin, 'Does this sound like me?'); assert.equal(by['4'].reviews.linkedin.stale, 'voice', 'old reviews show as needing refresh'); assert.equal(by['4'].reviews.linkedin.summary, 'Old review');
  // attachments: same blob keys, bytes verified, downloadable through the new scoped route
  const files = (await t.call('GET', `/api/brands/${NENEMI_ID}/files?postId=post_nenemi_3`)).json.files.filter((f) => f.postId);
  assert.equal(files.length, 2); const img = files.find((f) => f.name === 'team photo.png');
  assert.equal((await t.db.query(`SELECT blob_key FROM files WHERE id=$1`, [img.id]))[0].blob_key, 'post-files/aaaaaaaa-0000-0000-0000-000000000001');
  assert.deepEqual(Buffer.from((await t.call('GET', `/api/brands/${NENEMI_ID}/files/${img.id}?download=1`)).raw), PNG);
  assert.equal(files.find((f) => f.name === 'research.pdf').ai.supported, false);
  const brand = (await t.call('GET', `/api/brands/${NENEMI_ID}`)).json.brand;
  assert.equal(brand.note, 'Left off at post 3'); assert.equal(brand.lastPostId, 'post_nenemi_3'); assert.equal(brand.profile.colors.primary, '#3c8692'); assert.equal(brand.profile.fonts.heading.family, 'Archivo Black');
  assert.ok(brand.profile.logo.fileId); assert.ok((await t.call('GET', `/api/brands/${NENEMI_ID}/files/${brand.profile.logo.fileId}`)).status === 200);
  const f = (await t.call('GET', '/api/voice/founder')).json.founder; assert.match(f.guidelines, /intentional profanity/); assert.ok(!/NÈNÈMI/.test(f.guidelines.replace(/NENEMI GOT APPROVED/, '')), 'founder voice is separate from the brand');
  const usage = (await t.call('GET', '/api/ai-usage')).json.usage; assert.equal(usage.usedToday, 1); assert.ok(Math.abs(usage.monthDollars - 0.0025) < 1e-9); assert.equal(usage.byBrand[0].brandId, NENEMI_ID);
  assert.equal((await t.call('GET', `/api/brands/${NENEMI_ID}/history`)).json.history.filter((h) => h.type === 'posted').length, 3);
});

test('migration is idempotent: re-running adds nothing', async () => {
  const state = legacyState(); const ledger = { entries: [{ id: 'x', day: '2026-10-01', cost: 100 }] }; const t = await legacyDb(state, ledger);
  await applyMigration(t.db, t.blobs, state, { ledger }); const counts = async () => JSON.stringify(await Promise.all(['posts', 'files', 'post_reviews', 'post_events', 'ai_runs', 'brands', 'excerpts'].map(async (x) => (await t.db.query(`SELECT count(*)::int AS n FROM ${x}`))[0].n)));
  const c1 = await counts(); const budget = JSON.stringify(await t.db.query(`SELECT * FROM ai_budget`));
  const r2 = await applyMigration(t.db, t.blobs, state, { ledger }); assert.equal(r2.imported, 0); assert.equal(r2.skipped, 21);
  assert.equal(await counts(), c1); assert.equal(JSON.stringify(await t.db.query(`SELECT * FROM ai_budget`)), budget);
  // a post edited after migration is not overwritten by a re-run
  const p = (await t.call('GET', `/api/brands/${NENEMI_ID}/posts/post_nenemi_5`)).json.post; await t.call('PATCH', `/api/brands/${NENEMI_ID}/posts/post_nenemi_5`, { revision: p.revision, changes: { linkedin: 'edited after migration' } });
  await applyMigration(t.db, t.blobs, state); assert.equal((await t.call('GET', `/api/brands/${NENEMI_ID}/posts/post_nenemi_5`)).json.post.linkedin, 'edited after migration');
});

test('invalid legacy data is refused before anything is written; missing blobs are flagged, not fatal', async () => {
  const bad = legacyState(); bad.posts[1].date = 'tomorrow'; bad.posts.push({ ...bad.posts[0] });
  assert.ok(validateLegacyState(bad).length >= 2); const t = await legacyDb(bad);
  await assert.rejects(applyMigration(t.db, t.blobs, bad), /Refusing to migrate/); assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM brands`))[0].n, 0);
  const ok = legacyState(); const t2 = await legacyDb(ok); t2.blobs.map.delete('post-files/aaaaaaaa-0000-0000-0000-000000000002');
  const r = await applyMigration(t2.db, t2.blobs, ok); assert.deepEqual(r.filesUnverified, ['research.pdf']); assert.equal((await t2.db.query(`SELECT sha256 FROM files WHERE name='research.pdf'`))[0].sha256, 'unverified');
});

test('starter content installs once, and is refused when legacy data exists', async () => {
  const t = await setup(); assert.equal((await t.call('GET', '/api/bootstrap')).json.starterAvailable, true);
  const r1 = await t.call('POST', '/api/setup/nenemi-starter', {}); assert.equal(r1.json.postsAdded, 21);
  const r2 = await t.call('POST', '/api/setup/nenemi-starter', {}); assert.equal(r2.json.postsAdded, 0);
  assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM posts`))[0].n, 21);
  const L = await legacyDb(legacyState()); assert.equal((await L.call('GET', '/api/bootstrap')).json.starterAvailable, false);
  assert.equal((await L.call('POST', '/api/setup/nenemi-starter', {})).status, 409);
});

test('backup and restore round-trip into an empty database; restore refuses a non-empty one', async () => {
  const state = legacyState(); const t = await legacyDb(state, { entries: [{ id: 'x', day: '2026-10-01', cost: 100 }] }); await applyMigration(t.db, t.blobs, state);
  const b = (await t.call('POST', '/api/brands', { name: 'Second brand', profile: { voice: { guidelines: 'two' } } })).json.brand; await t.call('POST', `/api/brands/${b.id}/posts`, { title: 'Second post', date: null });
  const backup = JSON.parse(JSON.stringify(await buildBackup(t.db)));
  const fresh = await createPgliteDb(); await migrate(fresh); const counts = await restoreAll(fresh, backup);
  assert.equal(counts.posts, 22); assert.equal(counts.brands, 2);
  const norm = async (db) => JSON.stringify(await dumpAll(db), (k, v) => (typeof v === 'bigint' ? Number(v) : v));
  assert.equal(await norm(fresh), await norm(t.db), 'every table is identical after restore');
  await assert.rejects(restoreAll(fresh, backup), /already has brands/);
  await assert.rejects(restoreAll(fresh, { format: 'nope' }), /not a Launch Room/);
  // sequence continues after restore
  const app = (await import('../lib/app.js')).createApp({ db: fresh, blobs: t.blobs, env: { LAUNCH_ROOM_ALLOW_NO_PASSWORD: '1' } });
  const p = (await app.handle({ method: 'GET', path: `/api/brands/${NENEMI_ID}/posts/post_nenemi_0`, query: {}, headers: {}, body: Buffer.alloc(0) })); const post = JSON.parse(p.body).post;
  const act = await app.handle({ method: 'POST', path: `/api/brands/${NENEMI_ID}/posts/post_nenemi_0/actions/posted`, query: {}, headers: { origin: 'http://h', host: 'h', 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ revision: post.revision, platform: 'instagram', posted: true })) });
  assert.equal(act.status, 200);
});
