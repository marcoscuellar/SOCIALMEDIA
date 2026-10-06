import { createPgliteDb, createPgDb, migrate } from '../lib/db.js';
import { createMemoryBlobs } from '../lib/blobs.js';
import { createApp } from '../lib/app.js';

export async function setup({ env = {}, fetcher, clock, pgUrl } = {}) {
  pgUrl = pgUrl ?? process.env.TEST_PG_ALL_URL; const db = pgUrl ? await createPgDb(pgUrl) : await createPgliteDb();
  if (pgUrl) for (const t of ['ai_runs','post_events','excerpts','files','post_reviews','posts','brands','voice_profiles','ai_budget']) await db.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  await migrate(db);
  const blobs = createMemoryBlobs();
  const calls = [];
  const fake = fetcher || (async (url, opts) => { calls.push(JSON.parse(opts.body)); return Response.json(fakeReview(opts)); });
  const now = { t: clock?.t ?? new Date('2026-10-06T15:00:00Z') };
  const app = createApp({ db, blobs, env: { LAUNCH_ROOM_ALLOW_NO_PASSWORD: '1', OPENAI_API_KEY: 'test-key', ...env }, fetcher: fake, clock: () => now.t });
  const call = async (method, path, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    const [p, qs] = path.split('?');
    const r = await app.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), headers: { origin: 'http://x.test', host: 'x.test', ...(isBuf ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: isBuf ? body : Buffer.from(body !== undefined ? JSON.stringify(body) : '') });
    const type = r.headers['Content-Type'] || '';
    return { status: r.status, headers: r.headers, raw: r.body, json: type.includes('json') ? JSON.parse(Buffer.from(r.body).toString()) : null };
  };
  return { db, blobs, app, call, calls, now, close: () => db.close() };
}
export function fakeReview(opts, over = {}) {
  const body = JSON.parse(opts.body);
  const input = JSON.parse(body.input[0].content[0].text);
  const label = input.sources.at(-1)?.label;
  return { usage: { input_tokens: 1200, output_tokens: 300 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ready: true, summary: 'Reads well.', works: ['Warm'], tips: ['Tighten ending'], suggestedCaption: input.caption + ' (tightened)', claims: [{ claim: 'First claim', status: 'supported', sources: label ? [label] : ['Nonexistent source'], note: '' }, { claim: 'Second claim', status: 'unsupported', sources: [], note: 'No source' }], ...over }) }] }] };
}
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
export const ttf = (await import('node:fs')).readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
