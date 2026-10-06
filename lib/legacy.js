// Migration from the previous single-workspace Launch Room (table launch_workspace, row 'marcos').
// Read-only against the legacy data: it never updates or deletes legacy rows or blobs.
import { sha256, nowIso, newId } from './util.js';
import { ensureFounder, ensureNenemiBrand, mapLegacyPost, importMappedPost, NENEMI_ID } from './seed.js';
import { getBrand, getFounder } from './store.js';

export function validateLegacyState(s) {
  const problems = [];
  if (!s || typeof s !== 'object' || !Array.isArray(s.posts)) return ['State has no posts array.'];
  const ids = new Set();
  for (const p of s.posts) {
    if (typeof p.id !== 'string') problems.push('A post has no id.');
    else if (ids.has(p.id)) problems.push(`Duplicate post id ${p.id}.`); else ids.add(p.id);
    for (const k of ['date', 'title', 'linkedin', 'instagram', 'line']) if (typeof p[k] !== 'string') problems.push(`Post ${p.id}: ${k} is not text.`);
    if (typeof p.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) problems.push(`Post ${p.id}: bad date ${p.date}.`);
  }
  return problems;
}

export async function readLegacyState(db) {
  const rows = await db.query(`SELECT payload, revision FROM launch_workspace WHERE id = 'marcos'`);
  const ledger = await db.query(`SELECT payload FROM launch_workspace WHERE id = 'ai-cost-v1'`);
  return { state: rows[0] ? JSON.parse(rows[0].payload) : null, revision: rows[0]?.revision ?? null, ledger: ledger[0] ? JSON.parse(ledger[0].payload) : null };
}

export function legacyFileRefs(state) {
  return state.posts.flatMap((p) => (p.attachments || []).map((f) => ({ postId: p.id, ...f })));
}

// Describes what would happen, with no writes.
export function planMigration(state, existingLegacyIds = new Set()) {
  const problems = validateLegacyState(state);
  const posts = state.posts || [];
  const files = legacyFileRefs(state);
  return {
    problems,
    posts: posts.length, newPosts: posts.filter((p) => !existingLegacyIds.has(String(p.id))).length, alreadyImported: posts.filter((p) => existingLegacyIds.has(String(p.id))).length,
    approved: posts.filter((p) => p.approved).length, imageApproved: posts.filter((p) => p.imageReady).length,
    postedLinkedin: posts.filter((p) => p.postedLinkedin).length, postedInstagram: posts.filter((p) => p.postedInstagram).length,
    attachments: files.length, returnNote: !!(state.note || '').trim(),
  };
}

export async function applyMigration(db, blobs, state, { ledger = null, log = () => {}, now = new Date(), timeZone = 'America/Chicago' } = {}) {
  const problems = validateLegacyState(state);
  if (problems.length) throw new Error('Refusing to migrate: ' + problems.join(' '));
  const migratedAt = nowIso();
  await ensureFounder(db);
  const { brand: b0 } = await ensureNenemiBrand(db, blobs);
  const founder = await getFounder(db);
  const result = { imported: 0, skipped: 0, files: 0, filesUnverified: [], note: false, usageImported: false };
  const fileIds = {};
  for (const ref of legacyFileRefs(state)) fileIds[ref.id] = 'file_legacy_' + ref.id;
  const brand = await getBrand(db, NENEMI_ID);
  for (const p of state.posts) {
    // The uploaded-graphic link is set after the file rows exist (files need their post first).
    const m = mapLegacyPost(p, { fileIds: {}, migratedAt });
    const r = await importMappedPost(db, brand, founder, m);
    r.skipped ? result.skipped++ : result.imported++;
    if (r.skipped) continue;
    // Files: register the existing blob under its existing key; bytes are never copied, moved or deleted.
    for (const f of p.attachments || []) {
      const id = fileIds[f.id];
      if ((await db.query(`SELECT id FROM files WHERE id=$1`, [id])).length) continue;
      const key = 'post-files/' + f.id; let hash = 'unverified';
      try { const bytes = await blobs.get(key); if (bytes) hash = sha256(bytes); else result.filesUnverified.push(f.name); } catch { result.filesUnverified.push(f.name); }
      await db.query(`INSERT INTO files (id,brand_id,post_id,role,name,size,type,sha256,blob_key,legacy_id,created_at) VALUES ($1,$2,$3,'attachment',$4,$5,$6,$7,$8,$9,$10)`, [id, NENEMI_ID, r.id, String(f.name || 'attachment').slice(0, 200), Number.isSafeInteger(f.size) ? f.size : 0, f.type || 'application/octet-stream', hash, key, f.id, migratedAt]);
      result.files++;
    }
    if (p.asset === 'upload' && p.imageFileId && fileIds[p.imageFileId]) {
      await db.query(`UPDATE posts SET graphic = jsonb_set(graphic, '{imageFileId}', to_jsonb($1::text)) WHERE id=$2`, [fileIds[p.imageFileId], r.id]);
    }
  }
  if ((state.note || '').trim() && !(await getBrand(db, NENEMI_ID)).note) { await db.query(`UPDATE brands SET note=$1 WHERE id=$2`, [state.note.slice(0, 10000), NENEMI_ID]); result.note = true; }
  if (state.selected) { const sel = await db.query(`SELECT id FROM posts WHERE brand_id=$1 AND legacy_id=$2`, [NENEMI_ID, String(state.selected)]); if (sel[0]) await db.query(`UPDATE brands SET last_post_id=COALESCE(last_post_id,$1) WHERE id=$2`, [sel[0].id, NENEMI_ID]); }
  if (ledger) result.usageImported = await importUsage(db, ledger, log, now, timeZone);
  return result;
}

// Carries the previous allowance usage forward so the new limits are not reset by migrating mid-month.
async function importUsage(db, ledger, log, now, timeZone) {
  if (!Array.isArray(ledger.entries)) return false;
  if ((await db.query(`SELECT 1 FROM ai_runs WHERE status='imported' LIMIT 1`)).length) return false;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now), month = day.slice(0, 7);
  const mine = ledger.entries.filter((e) => typeof e.day === 'string' && e.day.startsWith(month) && Number.isSafeInteger(e.cost) && e.cost >= 0);
  for (const e of mine) await db.query(`INSERT INTO ai_runs (id,brand_id,cache_key,status,reserved_micros,cost_micros,day,month,model,started_at) VALUES ($1,$2,$3,'imported',$4,$4,$5,$6,'legacy',$7)`, [newId('run_'), NENEMI_ID, 'legacy:' + (e.id || newId()), e.cost, e.day, month, nowIso()]);
  const micros = mine.reduce((n, e) => n + e.cost, 0), today = mine.filter((e) => e.day === day).length;
  await db.query(`UPDATE ai_budget SET month=$1, month_micros=month_micros+$2, day=$3, day_count=day_count+$4 WHERE id=1`, [month, micros, day, today]);
  log(`Imported ${mine.length} legacy usage entries ($${(micros / 1e6).toFixed(4)})`); return mine.length > 0;
}
