import { LIMITS } from './config.js';
import { bad, notFound, newId, nowIso, sha256, str } from './util.js';
import { sniffType, aiSupport, isImage, isText, cleanFilename, FONT_TYPES, IMAGE_TYPES } from './files.js';
import { getBrand, deleteBlobIfUnused } from './store.js';

export const fileRow = (r) => ({
  id: r.id, brandId: r.brand_id, postId: r.post_id, role: r.role, name: r.name, size: r.size, type: r.type, sha256: r.sha256,
  createdAt: r.created_at, ai: aiSupport(r),
});
export const excerptRow = (r) => ({ id: r.id, brandId: r.brand_id, postId: r.post_id, label: r.label, body: r.body, hash: r.body_hash, sourceFileId: r.source_file_id, createdAt: r.created_at });

export async function listFiles(db, brandId, postId) {
  const rows = postId === undefined
    ? await db.query(`SELECT * FROM files WHERE brand_id=$1 ORDER BY created_at, id`, [brandId])
    : await db.query(`SELECT * FROM files WHERE brand_id=$1 AND (post_id IS NULL OR post_id=$2) ORDER BY created_at, id`, [brandId, postId]);
  return rows.map(fileRow);
}

export async function uploadFile(db, blobs, brandId, { bytes, name, postId, role }) {
  await getBrand(db, brandId);
  if (!bytes.length) throw bad('This file is empty.');
  if (bytes.length > LIMITS.upload) throw new (await import('./util.js')).HttpError(413, `Choose a file smaller than ${Math.round(LIMITS.upload / 1024 / 1024)} MB.`);
  const filename = cleanFilename(name); if (!filename) throw bad('Invalid filename.');
  role = role || (postId ? 'attachment' : 'reference');
  if (!['attachment', 'reference', 'logo', 'logo_dark', 'font'].includes(role)) throw bad('Unknown file role.');
  if (role === 'attachment' && !postId) throw bad('Attachments belong to a post.');
  if (role !== 'attachment' && postId) throw bad('Only attachments belong to a single post.');
  if (postId) {
    const p = await db.query(`SELECT id FROM posts WHERE id=$1 AND brand_id=$2`, [postId, brandId]);
    if (!p.length) throw notFound('Post not found in this brand');
    const n = (await db.query(`SELECT count(*)::int AS n FROM files WHERE post_id=$1`, [postId]))[0].n;
    if (n >= LIMITS.filesPerPost) throw bad(`This post has reached ${LIMITS.filesPerPost} files.`);
  } else {
    const n = (await db.query(`SELECT count(*)::int AS n FROM files WHERE brand_id=$1 AND post_id IS NULL`, [brandId]))[0].n;
    if (n >= LIMITS.filesPerBrand) throw bad(`This brand has reached ${LIMITS.filesPerBrand} files.`);
  }
  const type = sniffType(bytes, filename);
  if ((role === 'logo' || role === 'logo_dark') && !isImage(type)) throw bad('A logo must be a PNG, JPEG, WebP or GIF image.');
  if (role === 'font' && !(type in FONT_TYPES)) throw bad('Fonts must be .ttf, .otf, .woff or .woff2 files.');
  const id = newId('file_');
  const key = `brands/${brandId}/files/${id}`;
  await blobs.put(key, bytes, type);
  try {
    await db.query(`INSERT INTO files (id,brand_id,post_id,role,name,size,type,sha256,blob_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, brandId, postId || null, role, filename, bytes.length, type, sha256(bytes), key, nowIso()]);
  } catch (e) { await blobs.del(key).catch(() => {}); throw e; }
  return fileRow((await db.query(`SELECT * FROM files WHERE id=$1`, [id]))[0]);
}

export async function readFile(db, blobs, brandId, fileId) {
  const rows = await db.query(`SELECT * FROM files WHERE id=$1 AND brand_id=$2`, [fileId, brandId]);
  if (!rows.length) throw notFound('File not found in this brand');
  const bytes = await blobs.get(rows[0].blob_key);
  if (!bytes) throw notFound('The stored file bytes could not be found.');
  return { row: rows[0], bytes };
}
export function fileResponse(row, bytes, download) {
  const inline = !download && (IMAGE_TYPES.includes(row.type) || row.type in FONT_TYPES);
  return {
    status: 200, body: bytes,
    headers: {
      'Content-Type': row.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name).replace(/'/g, '%27')}`,
    },
  };
}
export async function readText(db, blobs, brandId, fileId) {
  const { row, bytes } = await readFile(db, blobs, brandId, fileId);
  if (!isText(row.type)) throw bad('Only plain-text files can be excerpted. For other formats, paste the passage you want read.');
  const text = new TextDecoder().decode(bytes.subarray(0, 100000));
  return { name: row.name, text, truncated: bytes.length > 100000 };
}

// Remove references to a file everywhere in this brand, without silently approving anything.
async function detach(db, brandId, fileId) {
  const posts = await db.query(`SELECT id, graphic, ai_sources FROM posts WHERE brand_id=$1`, [brandId]);
  for (const p of posts) {
    const usesImage = p.graphic?.imageFileId === fileId;
    const usesSource = (p.ai_sources || []).some((s) => s.type === 'file' && s.id === fileId);
    if (usesImage) await db.query(`UPDATE posts SET graphic=$1::jsonb, image_ready=false, image_ready_at=NULL, image_style_version=NULL, ai_sources=$2::jsonb, revision=revision+1, updated_at=$3 WHERE id=$4`, [JSON.stringify({ ...p.graphic, imageFileId: null }), JSON.stringify((p.ai_sources || []).filter((s) => !(s.type === 'file' && s.id === fileId))), nowIso(), p.id]);
    else if (usesSource) await db.query(`UPDATE posts SET ai_sources=$1::jsonb WHERE id=$2`, [JSON.stringify(p.ai_sources.filter((s) => !(s.type === 'file' && s.id === fileId))), p.id]);
  }
  const brand = await getBrand(db, brandId);
  const prof = JSON.parse(JSON.stringify(brand.profile)); let changed = false;
  if (prof.logo.fileId === fileId) { prof.logo.fileId = null; changed = true; }
  if (prof.logo.darkFileId === fileId) { prof.logo.darkFileId = null; changed = true; }
  for (const k of ['heading', 'body']) if (prof.fonts[k].fileId === fileId) { prof.fonts[k] = { source: 'system', family: k === 'heading' ? 'Arial Black' : 'Arial' }; changed = true; }
  if (changed) await db.query(`UPDATE brands SET profile=$1::jsonb, style_version=style_version+1, style_hash=$2, revision=revision+1, updated_at=$3 WHERE id=$4`, [JSON.stringify(prof), 'detached:' + fileId, nowIso(), brandId]);
}

export async function removeFile(db, blobs, brandId, fileId) {
  const rows = await db.query(`SELECT * FROM files WHERE id=$1 AND brand_id=$2`, [fileId, brandId]);
  if (!rows.length) throw notFound('File not found in this brand');
  await detach(db, brandId, fileId);
  await db.query(`DELETE FROM excerpts WHERE brand_id=$1 AND source_file_id=$2`, [brandId, fileId]);
  await db.query(`DELETE FROM files WHERE id=$1 AND brand_id=$2`, [fileId, brandId]);
  await deleteBlobIfUnused(db, blobs, rows[0].blob_key);
}

export async function listExcerpts(db, brandId, postId) {
  const rows = postId === undefined
    ? await db.query(`SELECT * FROM excerpts WHERE brand_id=$1 ORDER BY created_at`, [brandId])
    : await db.query(`SELECT * FROM excerpts WHERE brand_id=$1 AND (post_id IS NULL OR post_id=$2) ORDER BY created_at`, [brandId, postId]);
  return rows.map(excerptRow);
}
export async function createExcerpt(db, brandId, { label, body, postId, sourceFileId }) {
  await getBrand(db, brandId);
  body = str(body, { max: LIMITS.excerpt, name: 'Excerpt', required: true });
  label = str(label, { max: 120, name: 'Excerpt label' }).trim() || 'Excerpt';
  if (postId) { const p = await db.query(`SELECT id FROM posts WHERE id=$1 AND brand_id=$2`, [postId, brandId]); if (!p.length) throw notFound('Post not found in this brand'); }
  if (sourceFileId) { const f = await db.query(`SELECT id FROM files WHERE id=$1 AND brand_id=$2`, [sourceFileId, brandId]); if (!f.length) throw bad('Source file not found in this brand.'); }
  const id = newId('exc_');
  await db.query(`INSERT INTO excerpts (id,brand_id,post_id,label,body,body_hash,source_file_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, brandId, postId || null, label, body, sha256(body), sourceFileId || null, nowIso()]);
  return excerptRow((await db.query(`SELECT * FROM excerpts WHERE id=$1`, [id]))[0]);
}
export async function removeExcerpt(db, brandId, id) {
  const rows = await db.query(`DELETE FROM excerpts WHERE id=$1 AND brand_id=$2 RETURNING id`, [id, brandId]);
  if (!rows.length) throw notFound('Excerpt not found in this brand');
  const posts = await db.query(`SELECT id, ai_sources FROM posts WHERE brand_id=$1`, [brandId]);
  for (const p of posts) if ((p.ai_sources || []).some((s) => s.type === 'excerpt' && s.id === id))
    await db.query(`UPDATE posts SET ai_sources=$1::jsonb WHERE id=$2`, [JSON.stringify(p.ai_sources.filter((s) => !(s.type === 'excerpt' && s.id === id))), p.id]);
}
