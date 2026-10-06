import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError, bad, jsonResponse, notFound } from './util.js';
import { readConfig, LIMITS } from './config.js';
import { schemaReady, migrate } from './db.js';
import * as store from './store.js';
import * as filesApi from './filesApi.js';
import * as ai from './ai.js';
import { installStarter, NENEMI_ID } from './seed.js';
import { buildBackup } from './backup.js';

const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data: blob:; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'private, no-cache', 'X-Frame-Options': 'DENY' };

// ctx: { db, blobs, env, fetcher, clock, config }. req: { method, path, query, headers, body: Buffer }.
export function createApp({ db, blobs, env = process.env, fetcher = fetch, clock = () => new Date() }) {
  const ctx = { db, blobs, env, fetcher, clock, config: readConfig(env) };
  const password = env.LAUNCH_ROOM_PASSWORD;
  const open = env.LAUNCH_ROOM_ALLOW_NO_PASSWORD === '1';

  function authorized(headers) {
    if (open) return true;
    const auth = headers.authorization || '';
    if (!password || !auth.startsWith('Basic ')) return false;
    let supplied = ''; try { const t = Buffer.from(auth.slice(6), 'base64').toString(); supplied = t.slice(t.indexOf(':') + 1); } catch { return false; }
    const a = Buffer.from(supplied), b = Buffer.from(password);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  function sameOrigin(headers) {
    const origin = headers.origin, host = headers['x-forwarded-host'] || headers.host;
    if (origin) { try { return new URL(origin).host === host; } catch { return false; } }
    return headers['sec-fetch-site'] === 'same-origin';
  }
  const parseJson = (req) => {
    if (req.body.length > 800000) throw new HttpError(413, 'That request is too large.');
    if (!(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'JSON required.');
    try { const v = JSON.parse(req.body.toString('utf8')); if (!v || typeof v !== 'object') throw 0; return v; } catch { throw bad('Invalid JSON.'); }
  };
  const capabilities = () => {
    const a = ai.aiAvailable(ctx);
    return { ai: a.ok, aiReason: a.ok ? null : a.reason, uploads: !!blobs, maxUploadBytes: LIMITS.upload, model: ctx.config.model, limits: { dailyLimit: ctx.config.dailyLimit, monthlyDollars: ctx.config.monthlyMicros / 1e6, maxImages: LIMITS.maxImages, maxExcerptChars: LIMITS.excerpt, textFileAiBytes: LIMITS.textFileAi, perPostFiles: LIMITS.filesPerPost } };
  };

  const routes = [];
  const on = (method, re, fn) => routes.push([method, new RegExp('^' + re + '$'), fn]);
  const B = '/api/brands/([^/]+)';
  on('GET', '/api/bootstrap', async () => {
    const [brands, founder] = await Promise.all([store.listBrands(db), store.getFounder(db)]);
    let usage = null; try { usage = await ai.usageSummary(ctx); } catch { /* shown as unavailable */ }
    let legacy = false; try { legacy = (await db.query(`SELECT 1 FROM launch_workspace LIMIT 1`)).length > 0; } catch { /* no legacy table */ }
    return { capabilities: capabilities(), brands, founder, usage, starterAvailable: !brands.some((b) => b.id === NENEMI_ID) && !legacy, legacyDataPresent: legacy };
  });
  on('GET', '/api/ai-usage', async () => ({ usage: await ai.usageSummary(ctx) }));
  on('GET', '/api/backup', async () => buildBackup(db));
  on('POST', '/api/setup/nenemi-starter', async () => {
    if (!blobs) throw new HttpError(503, 'Connect file storage first; the starter includes the NÈNÈMI logo.');
    let legacy = false; try { legacy = (await db.query(`SELECT 1 FROM launch_workspace LIMIT 1`)).length > 0; } catch { /* none */ }
    if (legacy) throw new HttpError(409, 'Existing Launch Room data was found. Use the migration guide instead of the starter so nothing is duplicated.');
    return installStarter(db, blobs);
  });
  on('GET', '/api/voice/founder', async () => ({ founder: await store.getFounder(db) }));
  on('PUT', '/api/voice/founder', async (req) => { const d = parseJson(req); return { founder: await store.upsertFounder(db, d, d.revision) }; });

  on('GET', '/api/brands', async () => ({ brands: await store.listBrands(db) }));
  on('POST', '/api/brands', async (req) => ({ brand: await store.createBrand(db, parseJson(req)) }));
  on('GET', B, async (req, [id]) => ({ brand: await store.getBrand(db, id) }));
  on('PATCH', B, async (req, [id]) => ({ brand: await store.updateBrand(db, id, parseJson(req)) }));
  on('PUT', `${B}/place`, async (req, [id]) => { const d = parseJson(req); return { brand: await store.savePlace(db, id, d) }; });
  on('GET', `${B}/history`, async (req, [id]) => { await store.getBrand(db, id); return { history: await store.history(db, id) }; });

  on('GET', `${B}/posts`, async (req, [id]) => ({ posts: await store.listPosts(db, id) }));
  on('POST', `${B}/posts`, async (req, [id]) => ({ post: await store.createPost(db, id, parseJson(req)) }));
  on('GET', `${B}/posts/([^/]+)`, async (req, [b, p]) => ({ post: await store.getPost(db, b, p) }));
  on('PATCH', `${B}/posts/([^/]+)`, async (req, [b, p]) => ({ post: await store.updatePost(db, b, p, parseJson(req)) }));
  on('DELETE', `${B}/posts/([^/]+)`, async (req, [b, p]) => { await store.deletePost(db, b, p, blobs); return { ok: true }; });
  on('POST', `${B}/posts/([^/]+)/actions/([a-z-]+)`, async (req, [b, p, a]) => ({ post: await store.postAction(db, b, p, a, parseJson(req)) }));
  on('POST', `${B}/posts/([^/]+)/review-preview`, async (req, [b, p]) => ai.previewReview(ctx, b, p, parseJson(req)));
  on('POST', `${B}/posts/([^/]+)/review`, async (req, [b, p]) => {
    const out = await ai.runReview(ctx, b, p, parseJson(req));
    let usage = null; try { usage = await ai.usageSummary(ctx); } catch { /* optional */ }
    return { ...out, usage };
  });

  on('GET', `${B}/files`, async (req, [b]) => { await store.getBrand(db, b); return { files: await filesApi.listFiles(db, b, req.query.postId || undefined), excerpts: await filesApi.listExcerpts(db, b, req.query.postId || undefined) }; });
  on('POST', `${B}/files`, async (req, [b]) => {
    if (!blobs) throw new HttpError(503, 'File storage is not connected on this deployment yet.');
    return { file: await filesApi.uploadFile(db, blobs, b, { bytes: req.body, name: req.headers['x-file-name'], postId: req.headers['x-post-id'] || null, role: req.headers['x-file-role'] || null }), status: 201 };
  });
  on('GET', `${B}/files/([^/]+)`, async (req, [b, f]) => { if (!blobs) throw new HttpError(503, 'File storage is not connected.'); const { row, bytes } = await filesApi.readFile(db, blobs, b, f); return filesApi.fileResponse(row, bytes, req.query.download === '1'); });
  on('GET', `${B}/files/([^/]+)/text`, async (req, [b, f]) => filesApi.readText(db, blobs, b, f));
  on('DELETE', `${B}/files/([^/]+)`, async (req, [b, f]) => { await filesApi.removeFile(db, blobs, b, f); return { ok: true }; });
  on('POST', `${B}/excerpts`, async (req, [b]) => ({ excerpt: await filesApi.createExcerpt(db, b, parseJson(req)), status: 201 }));
  on('DELETE', `${B}/excerpts/([^/]+)`, async (req, [b, e]) => { await filesApi.removeExcerpt(db, b, e); return { ok: true }; });

  async function handle(req) {
    try {
      if (!open && !password) return { status: 503, headers: { ...SEC }, body: Buffer.from('Launch Room needs LAUNCH_ROOM_PASSWORD before it can open.') };
      if (!authorized(req.headers)) return { status: 401, headers: { ...SEC, 'WWW-Authenticate': 'Basic realm="Launch Room", charset="UTF-8"' }, body: Buffer.from('Sign in to your private Launch Room.') };
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req.headers)) return jsonResponse(403, { error: 'Request origin did not match.' });
      const p = req.path;
      if (method === 'GET' && STATIC[p]) { const [f, type] = STATIC[p]; return { status: 200, headers: { ...SEC, 'Content-Type': type, 'Content-Security-Policy': CSP }, body: fs.readFileSync(path.join(webDir, f)) }; }
      const m = p.match(/^\/app\/([a-z0-9-]+\.js)$/);
      if (method === 'GET' && m) return { status: 200, headers: { ...SEC, 'Content-Type': 'text/javascript; charset=utf-8' }, body: fs.readFileSync(path.join(webDir, 'app', m[1])) };
      if (!p.startsWith('/api/')) return { status: 404, headers: { ...SEC }, body: Buffer.from('Not found') };
      // One-click first-time setup: creates empty tables only (idempotent, never touches existing data). Needs sign-in and same-origin like any write.
      if (method === 'POST' && p === '/api/setup/database') { await migrate(db); return jsonResponse(200, { ok: true }); }
      if (!(await schemaReady(db))) return jsonResponse(503, { error: 'The database is not set up yet. Use the Set up database button, or run npm run db:migrate.' });
      for (const [rm, re, fn] of routes) {
        if (rm !== method) continue;
        const mm = p.match(re); if (!mm) continue;
        const out = await fn(req, mm.slice(1).map(decodeURIComponent));
        if (out && out.headers && out.body instanceof Uint8Array) return out;
        const status = out?.status || 200; if (out?.status) delete out.status;
        return jsonResponse(status, out);
      }
      return jsonResponse(404, { error: 'Not found' });
    } catch (e) {
      if (e instanceof HttpError) return jsonResponse(e.status, { error: e.message, ...e.extra });
      console.error('Launch Room error', e?.name, e?.message);
      return jsonResponse(503, { error: 'Something went wrong saving or loading. Your last saved work is safe. Please try again.' });
    }
  }
  return { handle, ctx };
}
