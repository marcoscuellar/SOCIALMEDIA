import { LIMITS, MODELS, PROMPT_VERSION } from './config.js';
import { HttpError, bad, canonical, newId, nowIso, sha256, zonedDay } from './util.js';
import { getBrand, getFounder, getPost } from './store.js';
import { aiSupport, isImage, isText } from './files.js';
import { buildInstructions, buildInput, REVIEW_SCHEMA } from './prompt.js';
import { estimate, actualMicros } from './cost.js';

const j = JSON.stringify;
const ts = (ctx) => nowIso(ctx.clock());
const dayOf = (ctx) => zonedDay(ctx.clock(), ctx.config.timeZone);
const REFUNDABLE = new Set([400, 401, 403, 404, 422, 429]);

export function aiAvailable(ctx) {
  if (ctx.config.aiConfigProblems.length) return { ok: false, reason: 'AI settings are invalid (' + ctx.config.aiConfigProblems.join('; ') + '). Reviews are paused.' };
  if (!ctx.env.OPENAI_API_KEY) return { ok: false, reason: 'AI review is not connected yet. You can keep editing and approve manually.' };
  return { ok: true };
}

// Resolve exactly the sources the person selected for this request; nothing else is ever read.
async function resolveSources(ctx, brandId, postId, selected) {
  if (!Array.isArray(selected)) throw bad('Selected sources must be a list.');
  if (selected.length > 12) throw bad('Select fewer sources.');
  const seen = new Set(); const text = [], images = [];
  for (const s of selected) {
    if (!s || !['file', 'excerpt'].includes(s.type) || typeof s.id !== 'string') throw bad('A selected source is not valid.');
    const key = s.type + ':' + s.id; if (seen.has(key)) continue; seen.add(key);
    if (s.type === 'excerpt') {
      const r = (await ctx.db.query(`SELECT * FROM excerpts WHERE id=$1 AND brand_id=$2 AND (post_id IS NULL OR post_id=$3)`, [s.id, brandId, postId]))[0];
      if (!r) throw bad('A selected excerpt is not available for this post.');
      text.push({ type: 'excerpt', id: r.id, label: `Excerpt: ${r.label}`, text: r.body, hash: r.body_hash, bytes: Buffer.byteLength(r.body) });
      continue;
    }
    const f = (await ctx.db.query(`SELECT * FROM files WHERE id=$1 AND brand_id=$2 AND (post_id IS NULL OR post_id=$3)`, [s.id, brandId, postId]))[0];
    if (!f) throw bad('A selected file is not available for this post.');
    const support = aiSupport(f);
    if (!support.supported) throw bad(`${f.name}: ${support.reason}`);
    const bytes = await ctx.blobs.get(f.blob_key);
    if (!bytes) throw bad(`${f.name}: the stored file could not be read.`);
    if (sha256(bytes) !== f.sha256) throw bad(`${f.name}: the stored file no longer matches its recorded version.`);
    if (isImage(f.type)) images.push({ type: 'file', id: f.id, label: `Image: ${f.name}`, hash: f.sha256, mime: f.type, b64: bytes.toString('base64'), bytes: bytes.length });
    else if (isText(f.type)) { const t = new TextDecoder().decode(bytes); text.push({ type: 'file', id: f.id, label: `File: ${f.name}`, text: t, hash: f.sha256, bytes: Buffer.byteLength(t) }); }
  }
  if (text.length > LIMITS.maxTextSources) throw bad(`Select at most ${LIMITS.maxTextSources} text sources.`);
  if (text.reduce((n, t) => n + t.bytes, 0) > LIMITS.maxTextBytes) throw bad(`Selected text is over the ${Math.round(LIMITS.maxTextBytes / 1000)} KB limit for one review. Select fewer sources or shorter excerpts.`);
  if (images.length > LIMITS.maxImages) throw bad(`Select at most ${LIMITS.maxImages} images.`);
  return { text, images };
}

// Everything needed to send or preview a request. No cost is incurred here.
async function plan(ctx, brandId, postId, data) {
  const brand = await getBrand(ctx.db, brandId);
  if (brand.status === 'archived') throw bad('This brand is archived.');
  const post = await getPost(ctx.db, brandId, postId);
  const founder = await getFounder(ctx.db);
  const platform = data.platform;
  if (!['linkedin', 'instagram'].includes(platform)) throw bad('Choose LinkedIn or Instagram.');
  const caption = post[platform];
  if (!caption.trim()) throw bad('Add your caption first.');
  if (caption.length > LIMITS.caption) throw bad(`Keep the caption under ${LIMITS.caption} characters.`);
  const question = typeof data.question === 'string' && data.question.trim() ? data.question : 'Review this honestly. Tell me what works and what to change.';
  if (question.length > LIMITS.question) throw bad(`Keep your question under ${LIMITS.question} characters.`);
  if (post.voiceMode !== 'brand' && !founder) throw bad('Set up your personal voice first, or choose the brand voice for this post.');
  const sources = await resolveSources(ctx, brandId, postId, data.sources ?? []);
  const instructions = buildInstructions({ brand, founder, voiceMode: post.voiceMode, platform });
  const input = buildInput({ brand, platform, caption, question, textSources: sources.text, imageSources: sources.images });
  const content = [{ type: 'input_text', text: input }, ...sources.images.map((i) => ({ type: 'input_image', image_url: `data:${i.mime};base64,${i.b64}`, detail: 'low' }))];
  const body = { model: ctx.config.model, store: false, instructions, input: [{ role: 'user', content }], max_output_tokens: LIMITS.maxOutputTokens, text: { format: { type: 'json_schema', name: 'caption_review', strict: true, schema: REVIEW_SCHEMA } } };
  // Count everything except image bytes as text; images get their own fixed reserve.
  const textBytes = Buffer.byteLength(j({ ...body, input: [{ role: 'user', content: [content[0]] }] }));
  const est = estimate({ model: ctx.config.model, textBytes, imageCount: sources.images.length });
  if (est.micros > LIMITS.maxRequestMicros) throw new HttpError(413, 'This review would include too much material. Select fewer or shorter sources.');
  const sentSources = [...sources.text, ...sources.images].map((s) => ({ type: s.type, id: s.id, label: s.label, hash: s.hash, kind: s.mime ? 'image' : 'text' }));
  const cacheKey = sha256(canonical({
    v: PROMPT_VERSION, model: ctx.config.model, brand: brandId, voiceMode: post.voiceMode,
    brandVoice: post.voiceMode === 'founder' ? null : brand.voiceVersion, founderVoice: post.voiceMode === 'brand' ? null : founder?.version,
    platform, caption, question, sources: sentSources.map((s) => ({ t: s.type, i: s.id, h: s.hash })).sort((a, b) => (a.t + a.i).localeCompare(b.t + b.i)),
  }));
  const labels = [...brand.profile.facts.confirmed.map((_, i) => `Confirmed brand fact ${i + 1}`), ...sentSources.map((s) => s.label)];
  return { brand, post, founder, platform, caption, question, body, est, sentSources, cacheKey, labels };
}

export async function previewReview(ctx, brandId, postId, data) {
  const p = await plan(ctx, brandId, postId, data);
  const cached = (await ctx.db.query(`SELECT id FROM ai_runs WHERE cache_key=$1 AND status='done'`, [p.cacheKey]))[0];
  return {
    cached: !!cached, estimatedMaxDollars: p.est.micros / 1e6,
    sends: {
      voice: p.post.voiceMode, caption: p.platform, question: p.question, brandFacts: p.brand.profile.facts.confirmed.length,
      unverifiedClaims: p.brand.profile.facts.verify.length, sources: p.sentSources.map(({ label, kind }) => ({ label, kind })),
    },
  };
}

async function budgetSnapshot(ctx) {
  const row = (await ctx.db.query(`SELECT * FROM ai_budget WHERE id=1`))[0];
  if (!row) throw new Error('Budget row missing');
  const day = dayOf(ctx), month = day.slice(0, 7);
  return { day, month, usedToday: row.day === day ? row.day_count : 0, monthMicros: row.month === month ? row.month_micros : 0 };
}

export async function usageSummary(ctx) {
  const snap = await budgetSnapshot(ctx);
  const brands = await ctx.db.query(`SELECT id, name FROM brands ORDER BY created_at`);
  const rows = await ctx.db.query(`SELECT brand_id, day, month, status, reserved_micros FROM ai_runs WHERE month=$1 AND status <> 'rejected'`, [snap.month]);
  const byBrand = brands.map((b) => {
    const mine = rows.filter((r) => r.brand_id === b.id);
    return { brandId: b.id, name: b.name, usedToday: mine.filter((r) => r.day === snap.day).length, reviewsThisMonth: mine.length, monthDollars: mine.reduce((n, r) => n + r.reserved_micros, 0) / 1e6 };
  });
  const uncertain = rows.filter((r) => ['uncertain', 'pending', 'reserved'].includes(r.status)).reduce((n, r) => n + r.reserved_micros, 0) / 1e6;
  return {
    day: snap.day, month: snap.month, timezone: ctx.config.timeZone, model: ctx.config.model,
    dailyLimit: ctx.config.dailyLimit, monthlyLimitDollars: ctx.config.monthlyMicros / 1e6,
    usedToday: snap.usedToday, monthDollars: snap.monthMicros / 1e6, uncertainDollars: uncertain,
    remainingToday: Math.max(0, ctx.config.dailyLimit - snap.usedToday), byBrand,
    note: 'Estimates from reported token usage, not a provider invoice. Excludes hosting and other apps.',
  };
}

async function reserve(ctx, runId, micros, day) {
  const month = day.slice(0, 7);
  const rows = await ctx.db.query(`WITH b AS (
    UPDATE ai_budget SET
      day_count = CASE WHEN day=$1 THEN day_count+1 ELSE 1 END,
      month_micros = (CASE WHEN month=$2 THEN month_micros ELSE 0 END) + $3,
      day=$1, month=$2
    WHERE id=1 AND (CASE WHEN day=$1 THEN day_count ELSE 0 END) < $4
      AND (CASE WHEN month=$2 THEN month_micros ELSE 0 END) + $3 <= $5
    RETURNING day_count
  ) UPDATE ai_runs SET status='reserved', reserved_micros=$3 FROM b WHERE ai_runs.id=$6 RETURNING ai_runs.id`,
  [day, month, micros, ctx.config.dailyLimit, ctx.config.monthlyMicros, runId]);
  return rows.length > 0;
}
async function settle(ctx, run, { status, cost, reservedAfter, inTok, outTok, result, error, refund }) {
  const delta = reservedAfter - run.reserved;
  await ctx.db.query(`UPDATE ai_budget SET month_micros=GREATEST(0, month_micros + $1), day_count = CASE WHEN day=$3 THEN GREATEST(0, day_count - $4) ELSE day_count END WHERE id=1 AND month=$2`, [delta, run.day.slice(0, 7), run.day, refund ? 1 : 0]);
  await ctx.db.query(`UPDATE ai_runs SET status=$1, cost_micros=$2, reserved_micros=$3, input_tokens=$4, output_tokens=$5, result=$6::jsonb, error=$7, finished_at=$8 WHERE id=$9`, [status, cost, reservedAfter, inTok ?? null, outTok ?? null, result ? j(result) : null, error ?? null, ts(ctx), run.id]);
}

async function saveReview(ctx, p, run, result) {
  await ctx.db.query(`INSERT INTO post_reviews (post_id,platform,brand_id,caption,voice_mode,brand_voice_version,founder_voice_version,run_id,result,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
    ON CONFLICT (post_id,platform) DO UPDATE SET brand_id=EXCLUDED.brand_id, caption=EXCLUDED.caption, voice_mode=EXCLUDED.voice_mode, brand_voice_version=EXCLUDED.brand_voice_version, founder_voice_version=EXCLUDED.founder_voice_version, run_id=EXCLUDED.run_id, result=EXCLUDED.result, created_at=EXCLUDED.created_at`,
  [p.post.id, p.platform, p.brand.id, p.caption, p.post.voiceMode, p.brand.voiceVersion, p.founder?.version ?? null, run, j(result), ts(ctx)]);
}

function cleanReview(raw, p) {
  const ok = raw && typeof raw.ready === 'boolean' && typeof raw.summary === 'string' && typeof raw.suggestedCaption === 'string'
    && Array.isArray(raw.works) && raw.works.every((x) => typeof x === 'string') && Array.isArray(raw.tips) && raw.tips.every((x) => typeof x === 'string') && Array.isArray(raw.claims);
  if (!ok) return null;
  const valid = new Set(p.labels);
  const claims = raw.claims.slice(0, 12).filter((c) => c && typeof c.claim === 'string').map((c) => {
    const cited = Array.isArray(c.sources) ? c.sources.filter((s) => valid.has(s)) : [];
    const supported = c.status === 'supported' && cited.length > 0;
    return { claim: c.claim, status: supported ? 'supported' : 'unsupported', sources: supported ? cited : [], note: typeof c.note === 'string' ? c.note : '' };
  });
  return { ready: raw.ready, summary: raw.summary, works: raw.works.slice(0, 3), tips: raw.tips.slice(0, 3), suggestedCaption: raw.suggestedCaption, claims,
    sourcesSent: p.sentSources.map(({ label, kind }) => ({ label, kind })), voiceMode: p.post.voiceMode, model: p.body.model };
}

export async function runReview(ctx, brandId, postId, data) {
  const avail = aiAvailable(ctx);
  if (!avail.ok) throw new HttpError(503, avail.reason);
  const p = await plan(ctx, brandId, postId, data);
  const day = dayOf(ctx);
  // Reuse an identical finished review: no new request, no slot, no cost.
  const hit = (await ctx.db.query(`SELECT id, result FROM ai_runs WHERE cache_key=$1 AND status='done'`, [p.cacheKey]))[0];
  if (hit) { await saveReview(ctx, p, hit.id, hit.result); return { review: await currentReview(ctx, brandId, postId, p.platform), cached: true }; }

  const run = { id: newId('run_'), reserved: 0, day };
  const insert = () => ctx.db.query(`INSERT INTO ai_runs (id,brand_id,post_id,platform,cache_key,status,day,month,model,sources,started_at) VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9::jsonb,$10) ON CONFLICT DO NOTHING RETURNING id`,
    [run.id, brandId, postId, p.platform, p.cacheKey, day, day.slice(0, 7), ctx.config.model, j(p.sentSources), ts(ctx)]);
  let ins = await insert();
  if (!ins.length) {
    const live = (await ctx.db.query(`SELECT id, status, started_at, result FROM ai_runs WHERE cache_key=$1 AND status IN ('pending','reserved','done')`, [p.cacheKey]))[0];
    if (live?.status === 'done') { await saveReview(ctx, p, live.id, live.result); return { review: await currentReview(ctx, brandId, postId, p.platform), cached: true }; }
    if (live && ctx.clock().getTime() - Date.parse(live.started_at) < LIMITS.pendingStaleMs) throw new HttpError(409, 'This review is already running. Wait a moment, then try again.');
    if (live) { await ctx.db.query(`UPDATE ai_runs SET status='uncertain', error='Timed out without a result; reservation kept.' WHERE id=$1 AND status IN ('pending','reserved')`, [live.id]); ins = await insert(); }
    if (!ins.length) throw new HttpError(409, 'This review is already running. Wait a moment, then try again.');
  }
  if (!(await reserve(ctx, run.id, p.est.micros, day))) {
    await ctx.db.query(`UPDATE ai_runs SET status='rejected', error='Over limit', finished_at=$1 WHERE id=$2`, [ts(ctx), run.id]);
    const snap = await budgetSnapshot(ctx);
    const dailyHit = snap.usedToday >= ctx.config.dailyLimit;
    throw new HttpError(429, dailyHit
      ? `Today’s ${ctx.config.dailyLimit} AI reviews are used. You can still edit, approve manually and read saved feedback. New reviews reset at midnight (${ctx.config.timeZone}).`
      : `The $${(ctx.config.monthlyMicros / 1e6).toFixed(2)} monthly AI allowance is reached. New reviews resume next month; manual editing remains available.`);
  }
  run.reserved = p.est.micros;

  let response;
  try {
    response = await ctx.fetcher('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: 'Bearer ' + ctx.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: j(p.body), signal: AbortSignal.timeout(LIMITS.upstreamTimeoutMs),
    });
  } catch {
    await settle(ctx, run, { status: 'uncertain', cost: 0, reservedAfter: run.reserved, error: 'No response; reservation kept.' }).catch(() => {});
    throw new HttpError(502, 'AI review did not respond. Its cost reservation is kept for safety. No automatic retry was made.');
  }
  if (!response.ok) {
    if (REFUNDABLE.has(response.status)) {
      await settle(ctx, run, { status: 'rejected', cost: 0, reservedAfter: 0, error: 'Provider rejected: ' + response.status, refund: true }).catch(() => {});
      throw new HttpError(502, response.status === 429 ? 'OpenAI’s usage or billing limit was reached. Nothing was charged to your allowance, and no retry was made.' : 'AI review could not be completed. Nothing was charged to your allowance, and no retry was made.');
    }
    await settle(ctx, run, { status: 'failed', cost: 0, reservedAfter: run.reserved, error: 'Provider error ' + response.status }).catch(() => {});
    throw new HttpError(502, 'AI review hit a provider error. Its cost reservation is kept for safety. No automatic retry was made.');
  }
  let result; try { result = await response.json(); } catch { result = null; }
  const measured = actualMicros(ctx.config.model, result?.usage);
  const finalReserved = measured === null ? run.reserved : measured; // unknown usage keeps the reservation; measured usage replaces it, even when higher
  const text = (result?.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
  let review = null; try { review = cleanReview(JSON.parse(text), p); } catch { /* handled below */ }
  const tok = { inTok: result?.usage?.input_tokens, outTok: result?.usage?.output_tokens };
  if (!review) {
    await settle(ctx, run, { status: 'failed', cost: measured ?? 0, reservedAfter: finalReserved, error: 'Unreadable response', ...tok }).catch(() => {});
    throw new HttpError(502, 'The AI response could not be read. Your caption is unchanged. No automatic retry was made.');
  }
  await settle(ctx, run, { status: 'done', cost: measured ?? 0, reservedAfter: finalReserved, result: review, ...tok });
  await saveReview(ctx, p, run.id, review);
  return { review: await currentReview(ctx, brandId, postId, p.platform), cached: false };
}

async function currentReview(ctx, brandId, postId, platform) {
  return (await getPost(ctx.db, brandId, postId)).reviews[platform];
}
export { MODELS };
