// NÈNÈMI as the first brand profile, Marcos's voice as a reusable founder profile, and the mapping
// from the previous single-workspace data shape. Used by the starter button and the legacy migration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertFounder, getFounder, createBrand, getBrand, updateBrand, createPost, voiceKey } from './store.js';
import { sha256, nowIso, newId } from './util.js';
import { sniffType } from './files.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed');
export const NENEMI_ID = 'brand_nenemi';
export const NENEMI_LOGO_FILE = 'file_nenemi_logo';
export const NENEMI_EMAIL_FILE = 'file_nenemi_approval_email';

export const FOUNDER_VOICE = {
  name: 'Marcos (founder voice)',
  guidelines: [
    'Conversational, warm, candid, direct, curious, human. Speak to one person. Use everyday words, contractions, short paragraphs and natural rhythm. Tighten a dictated thought without erasing its personality.',
    'Emotion is allowed: excitement, exhaustion, vulnerability, pride and humor can coexist. Keep agency and dignity; do not make him sound desperate, helpless, self-pitying or like he is asking for reassurance.',
    'Preserve intentional emphasis and intentional profanity when he uses it (for example "NENEMI GOT APPROVED!!" and "Really fucking proud."). Profanity is optional emphasis, never mandatory: do not add it to a quiet draft, and do not sanitize it just to sound professional. Do not sprinkle emojis or capitals into every line.',
    'Lead with a concrete moment, observation or person; connect it to why it matters. Make the invitation simple and low-pressure. Human experience, and making room for people who get overlooked, comes before technology claims.',
    'Values: Work Hard. Be Kind. Stay Curious. Let them show through the story; do not append them as a slogan unless asked.',
    'Do not rewrite more than needed. Preserve his meaning, his chosen emotional intensity and his factual limits.',
  ].join('\n\n'),
  preferred: 'Plain, everyday words\nContractions\nShort paragraphs\n"If you want to try it out, and can\'t afford it, please reach out!"',
  avoid: 'Corporate polish and hype\nForced inspiration or generic motivation\nTherapy-speak\nInvented hero narratives or invented facts\nWords like leverage, revolutionize, unlock your potential, game-changing\nTurning every post into choppy one-line fragments or a dramatic contrast',
  examples: 'Still tired. Very happy. Really fucking proud.\n\nIf you want to try it out, and can\'t afford it, please reach out!\n\nTreat these as rhythm and tone anchors, not copy to reuse.',
};

export const NENEMI_PROFILE = {
  description: 'NÈNÈMI is a calmer workspace for ADHD and non-linear minds: return without shame, plain words, one small next move.',
  audience: 'People with ADHD and non-linear minds, the people who care about them, and the professionals who work with them.',
  positioning: 'A calm place to come back to. It helps you find your place again without a lecture about where you have been.',
  tagline: 'COME BACK ANYTIME.',
  colors: { dark: '#111312', light: '#faf8f3', primary: '#3c8692', accent: '#e9be55' },
  fonts: { heading: { source: 'google', family: 'Archivo Black' }, body: { source: 'system', family: 'Arial' } },
  logo: { fileId: null, darkFileId: null, treatment: 'tint' },
  voice: {
    guidelines: 'Warm. Plain. Human. One idea at a time. Write like you are talking to a person.\nThe product voice is calmer and quieter than the founder\'s personal voice; do not flatten a founder announcement into soothing app microcopy.\nNo guilt, urgency, shame, productivity promises, broken-streak language, diagnosis assumptions, or promises to cure or treat ADHD.',
    preferred: 'Welcome back. You left off here.\nToo big? Make it smaller.\nWhatever\'s in your head, put it here.\nOne small next move.',
    avoid: 'Urgency, shame, overdue or streak language\nProductivity promises\nClaims to cure, treat or diagnose ADHD\n"Affordable for all" or guaranteed free access\nFeatures, prices, testimonials or health outcomes that are not confirmed',
    examples: '"Welcome back. You left off here."\n"Too big? Make it smaller."\n"Whatever\'s in your head, put it here."',
  },
  facts: {
    confirmed: [
      'Marcos states that almost four years of research, interviews and meetings with health professionals and people living with ADHD, plus his own lived experience, informed NÈNÈMI. Say "almost four years", never "four years". These conversations are not clinical validation, a medical endorsement or a clinical trial.',
      'NÈNÈMI was approved for distribution on the App Store (see the attached App Store approval email). Approval does not establish that the app is currently downloadable.',
      'Marcos built NÈNÈMI with Claude Code.',
      'A voluntary invitation to contact Marcos about cost is supported ("if you can\'t afford it, please reach out").',
    ],
    verify: [
      'The exact date the approval email arrived (not reliably established).',
      'That the app is live and downloadable on the App Store (check the live listing first).',
      'Any current prices, product features, testimonials or measurable health outcomes.',
      'Any claim of "affordable for all" or a guaranteed free-access program.',
    ],
    links: [],
  },
};

export async function ensureFounder(db) {
  return (await getFounder(db)) || upsertFounder(db, FOUNDER_VOICE);
}

async function putAsset(db, blobs, { id, brandId, file, name, role, type }) {
  const exists = (await db.query(`SELECT id FROM files WHERE id=$1`, [id]))[0];
  if (exists) return id;
  const bytes = fs.readFileSync(path.join(root, 'assets', file));
  const key = `brands/${brandId}/files/${id}`;
  await blobs.put(key, bytes, type);
  await db.query(`INSERT INTO files (id,brand_id,role,name,size,type,sha256,blob_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, brandId, role, name, bytes.length, sniffType(bytes, name), sha256(bytes), key, nowIso()]);
  return id;
}

// Creates the NÈNÈMI brand (once) with its logo and approval-email image attached.
export async function ensureNenemiBrand(db, blobs) {
  let created = false;
  if (!(await db.query(`SELECT id FROM brands WHERE id=$1`, [NENEMI_ID])).length) { await createBrand(db, { id: NENEMI_ID, name: 'NÈNÈMI', profile: NENEMI_PROFILE }); created = true; }
  await putAsset(db, blobs, { id: NENEMI_LOGO_FILE, brandId: NENEMI_ID, file: 'nenemi-logo.png', name: 'NENEMI-mark.png', role: 'logo' });
  await putAsset(db, blobs, { id: NENEMI_EMAIL_FILE, brandId: NENEMI_ID, file: 'nenemi-approval-email.jpeg', name: 'App Store approval email.jpeg', role: 'reference' });
  const brand = await getBrand(db, NENEMI_ID);
  if (created) await updateBrand(db, NENEMI_ID, { revision: brand.revision, profile: { ...brand.profile, logo: { ...brand.profile.logo, fileId: NENEMI_LOGO_FILE } } });
  return { brand: await getBrand(db, NENEMI_ID), created };
}

export const STYLE_FROM_COLOR = { ink: 'dark', teal: 'primary', paper: 'light' };
const postId = (legacyId) => `post_nenemi_${legacyId}`;

// Maps one previous-version post (the shape stored in launch_workspace) onto the new schema.
export function mapLegacyPost(p, { fileIds = {}, migratedAt = nowIso() } = {}) {
  const emailArt = p.asset === 'email';
  const upload = p.asset === 'upload' && p.imageFileId && fileIds[p.imageFileId];
  const history = Object.entries(p.captionHistory || {}).map(([k, v]) => `Previous ${k} wording (from before an AI suggestion was applied):\n${v}`);
  return {
    id: postId(p.id), legacyId: String(p.id), title: p.title, kind: p.kind, date: p.date, voiceMode: 'both',
    linkedin: p.linkedin, instagram: p.instagram,
    graphic: { line: p.line, style: STYLE_FROM_COLOR[p.color] || 'dark', imageFileId: emailArt ? NENEMI_EMAIL_FILE : upload || null, footer: String(p.id) === '0' ? 'APPROVED FOR DISTRIBUTION' : '', showLogo: true },
    notes: [p.note, ...history].filter(Boolean).join('\n\n'),
    _legacy: { approved: !!p.approved, imageReady: !!p.imageReady, postedLinkedin: !!p.postedLinkedin, postedInstagram: !!p.postedInstagram, paused: !!p.paused, reviews: p.reviews || {}, reviewQuestions: p.reviewQuestions || {}, migratedAt },
  };
}

// Inserts a mapped legacy post, preserving approvals and posting statuses. Idempotent by legacy id.
export async function importMappedPost(db, brand, founder, m) {
  const exists = (await db.query(`SELECT id FROM posts WHERE brand_id=$1 AND legacy_id=$2`, [brand.id, m.legacyId]))[0];
  if (exists) return { id: exists.id, skipped: true };
  const l = m._legacy;
  await createPost(db, brand.id, m);
  const key = voiceKey({ voice_mode: 'both' }, brand, founder);
  await db.query(`UPDATE posts SET approved=$1, approved_at=$2, approved_voice_key=$3, image_ready=$4, image_ready_at=$5, image_style_version=$6, posted_linkedin_at=$7, posted_instagram_at=$8, paused=$9, review_questions=$10::jsonb WHERE id=$11 AND brand_id=$12`,
    [l.approved, l.approved ? l.migratedAt : null, l.approved ? key : null, l.approved && l.imageReady, l.approved && l.imageReady ? l.migratedAt : null, l.approved && l.imageReady ? brand.styleVersion : null,
      l.postedLinkedin ? l.migratedAt : null, l.postedInstagram ? l.migratedAt : null, l.paused, JSON.stringify({ linkedin: l.reviewQuestions.linkedin || '', instagram: l.reviewQuestions.instagram || '' }), m.id, brand.id]);
  for (const platform of ['linkedin', 'instagram']) {
    const r = l.reviews[platform]; if (!r || typeof r.caption !== 'string') continue;
    // Brand/founder versions are left null so a migrated review shows as "needs refresh" instead of current.
    await db.query(`INSERT INTO post_reviews (post_id,platform,brand_id,caption,voice_mode,brand_voice_version,founder_voice_version,run_id,result,created_at) VALUES ($1,$2,$3,$4,'both',NULL,NULL,NULL,$5::jsonb,$6) ON CONFLICT DO NOTHING`,
      [m.id, platform, brand.id, r.caption, JSON.stringify({ ready: !!r.ready, summary: String(r.summary || ''), works: r.works || [], tips: r.tips || [], suggestedCaption: String(r.suggestedCaption || ''), claims: [], sourcesSent: [], voiceMode: 'both', model: 'migrated' }), r.reviewedAt || l.migratedAt]);
  }
  if (l.postedLinkedin) await db.query(`INSERT INTO post_events (brand_id,post_id,type,detail,at) VALUES ($1,$2,'posted',$3::jsonb,$4)`, [brand.id, m.id, JSON.stringify({ platform: 'linkedin', migrated: true }), l.migratedAt]);
  if (l.postedInstagram) await db.query(`INSERT INTO post_events (brand_id,post_id,type,detail,at) VALUES ($1,$2,'posted',$3::jsonb,$4)`, [brand.id, m.id, JSON.stringify({ platform: 'instagram', migrated: true }), l.migratedAt]);
  return { id: m.id, skipped: false };
}

export const readSeedPosts = () => JSON.parse(fs.readFileSync(path.join(root, 'nenemi-posts.json'), 'utf8'));

export async function installStarter(db, blobs) {
  await ensureFounder(db);
  const { brand, created } = await ensureNenemiBrand(db, blobs);
  const founder = await getFounder(db);
  const seed = readSeedPosts(); let added = 0;
  for (const p of seed.posts) { const r = await importMappedPost(db, brand, founder, mapLegacyPost(p)); if (!r.skipped) added++; }
  return { brandId: NENEMI_ID, created, postsAdded: added };
}
export { newId };
