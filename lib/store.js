// Data access. Every brand-owned read/write includes brand_id in SQL: scoping is enforced here,
// on the server, not by filtering in the browser.
import { bad, conflict, notFound, newId, nowIso, str, validDate } from './util.js';
import { normalizeProfile, normalizeFounder, voiceFingerprint, styleFingerprint, founderFingerprint, DEFAULT_PROFILE } from './profile.js';
import { LIMITS } from './config.js';

const j = (v) => JSON.stringify(v);

// ---------- founder voice ----------
export const founderRow = (r) => r && ({ id: r.id, name: r.name, guidelines: r.guidelines, preferred: r.preferred, avoid: r.avoid, examples: r.examples, version: r.version, revision: r.revision, updatedAt: r.updated_at });
export async function getFounder(db) {
  const rows = await db.query(`SELECT * FROM voice_profiles WHERE id = 'founder'`);
  return founderRow(rows[0]) || null;
}
export async function upsertFounder(db, input, revision) {
  const f = normalizeFounder(input); const hash = founderFingerprint(f); const now = nowIso();
  const cur = (await db.query(`SELECT * FROM voice_profiles WHERE id = 'founder'`))[0];
  if (!cur) {
    await db.query(`INSERT INTO voice_profiles (id,kind,name,guidelines,preferred,avoid,examples,voice_hash,updated_at) VALUES ('founder','founder',$1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [f.name, f.guidelines, f.preferred, f.avoid, f.examples, hash, now]);
    return getFounder(db);
  }
  if (revision !== cur.revision) throw conflict('Your personal voice changed in another tab. Reload to see the latest.', { current: founderRow(cur) });
  const bump = hash !== cur.voice_hash ? 1 : 0;
  const rows = await db.query(`UPDATE voice_profiles SET name=$1,guidelines=$2,preferred=$3,avoid=$4,examples=$5,voice_hash=$6,version=version+$7,revision=revision+1,updated_at=$8 WHERE id='founder' AND revision=$9 RETURNING *`, [f.name, f.guidelines, f.preferred, f.avoid, f.examples, hash, bump, now, revision]);
  if (!rows.length) throw conflict('Your personal voice changed in another tab. Reload to see the latest.');
  return founderRow(rows[0]);
}

// ---------- brands ----------
export const brandRow = (r) => r && ({
  id: r.id, name: r.name, status: r.status, profile: r.profile, voiceVersion: r.voice_version, styleVersion: r.style_version,
  revision: r.revision, note: r.note, lastPostId: r.last_post_id, lastStep: r.last_step, createdAt: r.created_at, updatedAt: r.updated_at,
});
export async function listBrands(db) {
  return (await db.query(`SELECT * FROM brands ORDER BY status, sort_order, created_at`)).map(brandRow);
}
export async function getBrand(db, id) {
  const rows = await db.query(`SELECT * FROM brands WHERE id = $1`, [id]);
  if (!rows.length) throw notFound('Brand not found');
  return brandRow(rows[0]);
}
async function checkProfileFiles(db, brandId, profile) {
  const ids = [profile.logo.fileId, profile.logo.darkFileId, ...['heading', 'body'].map((k) => profile.fonts[k].fileId)].filter(Boolean);
  for (const id of ids) {
    const rows = await db.query(`SELECT id FROM files WHERE id=$1 AND brand_id=$2`, [id, brandId]);
    if (!rows.length) throw bad('A selected logo or font file does not belong to this brand.');
  }
}
export async function createBrand(db, input) {
  const name = str(input.name, { max: 100, name: 'Brand name', required: true }).trim();
  const id = input.id && /^[a-z0-9_-]{3,60}$/.test(input.id) ? input.id : newId('brand_');
  const profile = normalizeProfile({ ...DEFAULT_PROFILE(), ...(input.profile || {}) });
  if (profile.logo.fileId || profile.logo.darkFileId || profile.fonts.heading.fileId || profile.fonts.body.fileId) throw bad('Save the brand first, then upload its logo and fonts.');
  const now = nowIso();
  const count = (await db.query(`SELECT count(*)::int AS n FROM brands`))[0].n;
  await db.query(`INSERT INTO brands (id,name,profile,voice_hash,style_hash,sort_order,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$7)`, [id, name, j(profile), voiceFingerprint(name, profile), styleFingerprint(profile), count, now]);
  return getBrand(db, id);
}
export async function updateBrand(db, id, input) {
  const cur = await getBrand(db, id);
  if (!Number.isSafeInteger(input.revision)) throw bad('Missing revision.');
  const name = str(input.name ?? cur.name, { max: 100, name: 'Brand name', required: true }).trim();
  const profile = normalizeProfile(input.profile ?? cur.profile);
  await checkProfileFiles(db, id, profile);
  const vh = voiceFingerprint(name, profile), sh = styleFingerprint(profile);
  const rows = await db.query(`SELECT voice_hash, style_hash FROM brands WHERE id=$1`, [id]);
  const voiceBump = vh !== rows[0].voice_hash ? 1 : 0, styleBump = sh !== rows[0].style_hash ? 1 : 0;
  const status = input.status === 'archived' || input.status === 'active' ? input.status : cur.status;
  const upd = await db.query(`UPDATE brands SET name=$1,profile=$2::jsonb,status=$3,voice_hash=$4,style_hash=$5,voice_version=voice_version+$6,style_version=style_version+$7,revision=revision+1,updated_at=$8 WHERE id=$9 AND revision=$10 RETURNING *`, [name, j(profile), status, vh, sh, voiceBump, styleBump, nowIso(), id, input.revision]);
  if (!upd.length) throw conflict('This brand changed in another tab. Reload to see the latest version before editing.', { current: await getBrand(db, id) });
  return brandRow(upd[0]);
}
// Return note and "where I left off" are saved separately (last write wins; no revision needed).
export async function savePlace(db, id, { note, lastPostId, lastStep }) {
  const sets = [], vals = [];
  if (note !== undefined) { vals.push(str(note, { max: 10000, name: 'Return note' })); sets.push(`note=$${vals.length}`); }
  if (lastPostId !== undefined) {
    if (lastPostId !== null) { const r = await db.query(`SELECT id FROM posts WHERE id=$1 AND brand_id=$2`, [lastPostId, id]); if (!r.length) throw bad('That post is not in this brand.'); }
    vals.push(lastPostId); sets.push(`last_post_id=$${vals.length}`);
  }
  if (lastStep !== undefined) { if (![1, 2, 3].includes(lastStep)) throw bad('Step is not valid.'); vals.push(lastStep); sets.push(`last_step=$${vals.length}`); }
  if (!sets.length) return getBrand(db, id);
  vals.push(id);
  const rows = await db.query(`UPDATE brands SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
  if (!rows.length) throw notFound('Brand not found');
  return brandRow(rows[0]);
}

// ---------- posts ----------
export const GRAPHIC_STYLES = ['dark', 'primary', 'light'];
export const MAX_SLIDES = 9; // extra slides after the first, so a carousel has at most 10
export const DEFAULT_GRAPHIC = () => ({ line: '', style: 'dark', imageFileId: null, footer: '', showLogo: true, slides: [] });
export const voiceKey = (post, brand, founder) => `${post.voice_mode}|${post.voice_mode === 'founder' ? 0 : brand.voiceVersion}|${post.voice_mode === 'brand' ? 0 : founder?.version ?? 0}`;

export const postRow = (r, brand, founder, reviews = []) => {
  if (!r) return null;
  const key = voiceKey(r, brand, founder);
  const post = {
    id: r.id, brandId: r.brand_id, title: r.title, kind: r.kind, date: r.scheduled_date, voiceMode: r.voice_mode,
    linkedin: r.linkedin, instagram: r.instagram, graphic: { ...DEFAULT_GRAPHIC(), ...r.graphic },
    approved: r.approved, approvedAt: r.approved_at, imageReady: r.image_ready, imageReadyAt: r.image_ready_at,
    postedLinkedinAt: r.posted_linkedin_at, postedInstagramAt: r.posted_instagram_at, paused: r.paused, notes: r.notes,
    aiSources: r.ai_sources, reviewQuestions: r.review_questions, captionHistory: r.caption_history, revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at,
    needs: { voiceReview: r.approved && r.approved_voice_key !== key, styleReview: r.image_ready && r.image_style_version !== brand.styleVersion },
  };
  post.reviews = {};
  for (const rv of reviews) if (rv.post_id === r.id) {
    const stale = rv.caption !== post[rv.platform] ? 'caption' : (rv.voice_mode !== post.voiceMode || (post.voiceMode !== 'founder' && rv.brand_voice_version !== brand.voiceVersion) || (post.voiceMode !== 'brand' && rv.founder_voice_version !== (founder?.version ?? 0))) ? 'voice' : null;
    post.reviews[rv.platform] = { ...rv.result, caption: rv.caption, reviewedAt: rv.created_at, stale };
  }
  return post;
};
async function reviewsFor(db, brandId, postId) {
  return db.query(postId ? `SELECT * FROM post_reviews WHERE brand_id=$1 AND post_id=$2` : `SELECT * FROM post_reviews WHERE brand_id=$1`, postId ? [brandId, postId] : [brandId]);
}
export async function listPosts(db, brandId) {
  const brand = await getBrand(db, brandId), founder = await getFounder(db);
  const rows = await db.query(`SELECT * FROM posts WHERE brand_id=$1 ORDER BY scheduled_date NULLS LAST, created_at, id`, [brandId]);
  const reviews = await reviewsFor(db, brandId);
  return rows.map((r) => postRow(r, brand, founder, reviews));
}
export async function getPost(db, brandId, postId) {
  const brand = await getBrand(db, brandId), founder = await getFounder(db);
  const rows = await db.query(`SELECT * FROM posts WHERE id=$1 AND brand_id=$2`, [postId, brandId]);
  if (!rows.length) throw notFound('Post not found in this brand');
  return postRow(rows[0], brand, founder, await reviewsFor(db, brandId, postId));
}
async function event(db, brandId, postId, type, detail = {}) {
  await db.query(`INSERT INTO post_events (brand_id,post_id,type,detail,at) VALUES ($1,$2,$3,$4::jsonb,$5)`, [brandId, postId, type, j(detail), nowIso()]);
}
function graphicIn(input, base) {
  const g = { ...base, ...(input || {}) };
  if (!GRAPHIC_STYLES.includes(g.style)) throw bad('Choose dark, primary or light for the graphic.');
  const slides = g.slides ?? [];
  if (!Array.isArray(slides) || slides.length > MAX_SLIDES) throw bad(`A carousel can have up to ${MAX_SLIDES + 1} slides.`);
  return { line: str(g.line, { max: 200, name: 'Image headline' }), style: g.style, imageFileId: g.imageFileId || null, footer: str(g.footer, { max: 80, name: 'Image footer' }), showLogo: g.showLogo !== false,
    slides: slides.map((sl) => ({ line: str(sl?.line, { max: 200, name: 'Slide headline' }), imageFileId: sl?.imageFileId || null })) };
}
export async function createPost(db, brandId, input = {}) {
  const brand = await getBrand(db, brandId);
  if (brand.status === 'archived') throw bad('This brand is archived.');
  const date = input.date ?? null;
  if (date !== null && !validDate(date)) throw bad('Use a real date like 2026-11-04, or leave it unscheduled.');
  const voiceMode = ['brand', 'founder', 'both'].includes(input.voiceMode) ? input.voiceMode : 'brand';
  const id = input.id && /^[a-z0-9_-]{3,80}$/.test(input.id) ? input.id : newId('post_');
  const now = nowIso();
  const graphic = graphicIn(input.graphic, DEFAULT_GRAPHIC());
  await checkGraphicFile(db, brandId, null, graphic);
  await db.query(`INSERT INTO posts (id,brand_id,legacy_id,title,kind,scheduled_date,voice_mode,linkedin,instagram,graphic,notes,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$12)`,
    [id, brandId, input.legacyId || null, str(input.title, { max: 200, name: 'Title' }) || 'Untitled draft', str(input.kind, { max: 80, name: 'Kind' }), date, voiceMode, str(input.linkedin, { max: LIMITS.caption, name: 'LinkedIn caption' }), str(input.instagram, { max: LIMITS.caption, name: 'Instagram caption' }), j(graphic), str(input.notes, { max: 5000, name: 'Notes' }), now]);
  await event(db, brandId, id, 'created');
  return getPost(db, brandId, id);
}
async function checkGraphicFile(db, brandId, postId, graphic) {
  for (const id of [graphic.imageFileId, ...(graphic.slides || []).map((sl) => sl.imageFileId)]) {
    if (!id) continue;
    const rows = await db.query(`SELECT type, post_id FROM files WHERE id=$1 AND brand_id=$2`, [id, brandId]);
    if (!rows.length || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(rows[0].type) || (rows[0].post_id && rows[0].post_id !== postId)) throw bad('Choose an image file from this brand or this post.');
  }
}
async function checkSources(db, brandId, postId, sources) {
  if (!Array.isArray(sources) || sources.length > 12) throw bad('Too many selected sources.');
  const out = [];
  for (const s of sources) {
    if (!s || !['file', 'excerpt'].includes(s.type) || typeof s.id !== 'string') throw bad('A selected source is not valid.');
    const table = s.type === 'file' ? 'files' : 'excerpts';
    const r = await db.query(`SELECT id FROM ${table} WHERE id=$1 AND brand_id=$2 AND (post_id IS NULL OR post_id=$3)`, [s.id, brandId, postId]);
    if (!r.length) throw bad('A selected source does not belong to this brand or post.');
    out.push({ type: s.type, id: s.id });
  }
  return out;
}

// Server-side rules: caption changes clear approval and image approval; clients cannot set approvals by PATCH.
export async function updatePost(db, brandId, postId, input) {
  const brand = await getBrand(db, brandId), founder = await getFounder(db);
  const rows = await db.query(`SELECT * FROM posts WHERE id=$1 AND brand_id=$2`, [postId, brandId]);
  if (!rows.length) throw notFound('Post not found in this brand');
  const cur = rows[0];
  if (!Number.isSafeInteger(input.revision)) throw bad('Missing revision.');
  if (input.revision !== cur.revision) throw conflict('This post changed in another tab.', { current: await getPost(db, brandId, postId) });
  const ch = input.changes || {};
  const next = { ...cur };
  let invalidateApproval = false, invalidateImage = false;
  for (const p of ['linkedin', 'instagram']) if (ch[p] !== undefined) {
    next[p] = str(ch[p], { max: LIMITS.caption, name: `${p} caption` });
    if (next[p] !== cur[p]) invalidateApproval = true;
  }
  if (ch.title !== undefined) next.title = str(ch.title, { max: 200, name: 'Title' });
  if (ch.kind !== undefined) next.kind = str(ch.kind, { max: 80, name: 'Kind' });
  if (ch.notes !== undefined) next.notes = str(ch.notes, { max: 5000, name: 'Notes' });
  if (ch.date !== undefined) { if (ch.date !== null && !validDate(ch.date)) throw bad('Use a real date, or leave it unscheduled.'); next.scheduled_date = ch.date; }
  if (ch.paused !== undefined) next.paused = !!ch.paused;
  if (ch.voiceMode !== undefined) { if (!['brand', 'founder', 'both'].includes(ch.voiceMode)) throw bad('Voice choice is not valid.'); next.voice_mode = ch.voiceMode; }
  if (ch.graphic !== undefined) {
    const g = graphicIn(ch.graphic, cur.graphic); await checkGraphicFile(db, brandId, postId, g);
    if (JSON.stringify(g) !== JSON.stringify({ ...DEFAULT_GRAPHIC(), ...cur.graphic })) invalidateImage = true;
    next.graphic = g;
  }
  if (ch.aiSources !== undefined) next.ai_sources = await checkSources(db, brandId, postId, ch.aiSources);
  if (ch.reviewQuestions !== undefined) {
    const q = ch.reviewQuestions || {};
    next.review_questions = { linkedin: str(q.linkedin, { max: LIMITS.question, name: 'Question' }), instagram: str(q.instagram, { max: LIMITS.question, name: 'Question' }) };
  }
  if (ch.captionHistory !== undefined) {
    const h = ch.captionHistory || {};
    next.caption_history = { linkedin: str(h.linkedin, { max: LIMITS.caption, name: 'Previous wording' }), instagram: str(h.instagram, { max: LIMITS.caption, name: 'Previous wording' }) };
  }
  if (invalidateApproval) { next.approved = false; next.approved_at = null; next.approved_voice_key = null; next.image_ready = false; next.image_ready_at = null; next.image_style_version = null; }
  else if (invalidateImage) { next.image_ready = false; next.image_ready_at = null; next.image_style_version = null; }
  const upd = await db.query(`UPDATE posts SET title=$1,kind=$2,scheduled_date=$3,voice_mode=$4,linkedin=$5,instagram=$6,graphic=$7::jsonb,approved=$8,approved_at=$9,approved_voice_key=$10,image_ready=$11,image_ready_at=$12,image_style_version=$13,paused=$14,notes=$15,ai_sources=$16::jsonb,review_questions=$17::jsonb,caption_history=$18::jsonb,revision=revision+1,updated_at=$19 WHERE id=$20 AND brand_id=$21 AND revision=$22 RETURNING id`,
    [next.title, next.kind, next.scheduled_date, next.voice_mode, next.linkedin, next.instagram, j(next.graphic), next.approved, next.approved_at, next.approved_voice_key, next.image_ready, next.image_ready_at, next.image_style_version, next.paused, next.notes, j(next.ai_sources), j(next.review_questions), j(next.caption_history), nowIso(), postId, brandId, input.revision]);
  if (!upd.length) throw conflict('This post changed in another tab.', { current: await getPost(db, brandId, postId) });
  if (invalidateApproval && cur.approved) await event(db, brandId, postId, 'approval_cleared', { reason: 'caption edited' });
  return getPost(db, brandId, postId);
}

// Explicit human actions.
export async function postAction(db, brandId, postId, action, input) {
  const brand = await getBrand(db, brandId), founder = await getFounder(db);
  const post = await getPost(db, brandId, postId);
  if (!Number.isSafeInteger(input.revision)) throw bad('Missing revision.');
  if (input.revision !== post.revision) throw conflict('This post changed in another tab.', { current: post });
  const now = nowIso();
  let sql, params, ev;
  if (action === 'approve') {
    if (!post.linkedin.trim() || !post.instagram.trim()) throw bad('Add a caption for both platforms before approving.');
    sql = `approved=true,approved_at=$1,approved_voice_key=$2,paused=false`; params = [now, voiceKey({ voice_mode: post.voiceMode }, brand, founder)]; ev = ['approved', { voiceMode: post.voiceMode }];
  } else if (action === 'unapprove') {
    sql = `approved=false,approved_at=NULL,approved_voice_key=NULL,image_ready=false,image_ready_at=NULL,image_style_version=NULL`; params = []; ev = ['approval_cleared', { reason: 'manual' }];
  } else if (action === 'approve-image') {
    if (!post.approved) throw bad('Approve the captions before the image.');
    if (!post.graphic.line.trim()) throw bad('Add a line for the image first.');
    sql = `image_ready=true,image_ready_at=$1,image_style_version=$2`; params = [now, brand.styleVersion]; ev = ['image_approved', { styleVersion: brand.styleVersion }];
  } else if (action === 'unapprove-image') {
    sql = `image_ready=false,image_ready_at=NULL,image_style_version=NULL`; params = []; ev = ['image_cleared', {}];
  } else if (action === 'acknowledge') {
    // "Looks fine, still approved" after voice/branding changed: records the current versions without changing content.
    if (!post.approved) throw bad('Nothing to confirm yet.');
    sql = `approved_voice_key=$1,image_style_version=CASE WHEN image_ready THEN $2 ELSE image_style_version END`; params = [voiceKey({ voice_mode: post.voiceMode }, brand, founder), brand.styleVersion]; ev = ['reconfirmed', {}];
  } else if (action === 'posted') {
    const p = input.platform; if (!['linkedin', 'instagram'].includes(p)) throw bad('Choose LinkedIn or Instagram.');
    const col = p === 'linkedin' ? 'posted_linkedin_at' : 'posted_instagram_at';
    sql = `${col}=$1`; params = [input.posted ? now : null]; ev = [input.posted ? 'posted' : 'unposted', { platform: p }];
  } else throw bad('Unknown action.');
  const n = params.length;
  const rows = await db.query(`UPDATE posts SET ${sql},revision=revision+1,updated_at=$${n + 1} WHERE id=$${n + 2} AND brand_id=$${n + 3} AND revision=$${n + 4} RETURNING id`, [...params, now, postId, brandId, input.revision]);
  if (!rows.length) throw conflict('This post changed in another tab.', { current: await getPost(db, brandId, postId) });
  await event(db, brandId, postId, ev[0], ev[1]);
  return getPost(db, brandId, postId);
}
export async function deletePost(db, brandId, postId, blobs) {
  const rows = await db.query(`SELECT id FROM posts WHERE id=$1 AND brand_id=$2`, [postId, brandId]);
  if (!rows.length) throw notFound('Post not found in this brand');
  const files = await db.query(`SELECT id, blob_key FROM files WHERE post_id=$1 AND brand_id=$2`, [postId, brandId]);
  await db.query(`DELETE FROM posts WHERE id=$1 AND brand_id=$2`, [postId, brandId]);
  for (const f of files) await deleteBlobIfUnused(db, blobs, f.blob_key);
  await event(db, brandId, postId, 'deleted');
}
export async function deleteBlobIfUnused(db, blobs, key) {
  const left = await db.query(`SELECT 1 FROM files WHERE blob_key=$1 LIMIT 1`, [key]);
  if (!left.length) { try { await blobs.del(key); } catch (e) { console.error('Blob delete failed', e?.name); } }
}

// ---------- posting history ----------
export async function history(db, brandId) {
  return (await db.query(`SELECT e.id, e.post_id, e.type, e.detail, e.at, p.title FROM post_events e LEFT JOIN posts p ON p.id=e.post_id WHERE e.brand_id=$1 AND e.type IN ('posted','unposted','approved','image_approved') ORDER BY e.at DESC, e.id DESC LIMIT 200`, [brandId]))
    .map((r) => ({ id: Number(r.id), postId: r.post_id, title: r.title || '(deleted post)', type: r.type, detail: r.detail, at: r.at }));
}
