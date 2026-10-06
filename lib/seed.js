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
  description: 'NÈNÈMI (Nahuatl for "to return, to come back") is a calm home for ADHD brains: somewhere to set things down and pick them back up, without ever losing your place. The mark is a place, not a task: a stepped N you climb, leave, and return to.',
  audience: 'Neurodivergent minds, especially people with ADHD, and the people who care about them. People who have heard "you\'re not trying hard enough" their whole lives and are tired of apps that make them feel behind.',
  positioning: 'Come back. Your place is kept. The opposite of streaks you break, tasks that turn red and quiet nagging. Success is "oh, I know exactly where I was", measured by whether someone came back, not by whether they finished everything. Built by a neurodivergent founder, for neurodivergent minds.',
  tagline: 'COME BACK ANYTIME.',
  colors: { dark: '#111312', light: '#faf8f3', primary: '#3c8692', accent: '#e9be55' },
  fonts: { heading: { source: 'google', family: 'Archivo Black' }, body: { source: 'system', family: 'Helvetica Neue' } },
  logo: { fileId: null, darkFileId: null, treatment: 'tint' },
  voice: {
    guidelines: [
      'Warm, plain, human. NÈNÈMI never shames, never nags, never optimizes. Relentlessly on your side, then get out of the way.',
      'Plain over clever. Reassuring over motivating. Present, not pushy. One idea per post.',
      'A pause is never a lapse: "You didn\'t fall behind. You stepped away." Walking away is not failing; it is Tuesday.',
      'Teal means tended (here, now, your place is kept). Maíz means warmth and a small win, used rarely, and it celebrates returning, never completing.',
      'Social: it has to feel like a person, not a productivity brand. Quotes over slogans, first names over titles. Real photos of real people, one quiet mark in the corner, big plain words. If a post would make an ADHD brain feel behind, it does not go out. If it counts down or scolds, cut it.',
      'Founder posts in Marcos\'s own voice can be louder and more emotional than the calm product voice. Do not flatten them into soothing app microcopy.',
      'Only claim what is true: no invented statistics, no borrowed authority. Real reading, real conversations, real experience.',
    ].join('\n\n'),
    preferred: 'You didn\'t fall behind. You stepped away.\nWelcome back. You left off here.\nWhatever\'s in your head, put it here.\nPick up exactly where you left off.\nToo big? Make it smaller.\nCome back anytime.\nYou never have to start over.\nYour place is kept.',
    avoid: '"You\'re behind." / streak broken / "3 tasks overdue!"\n"Boost your productivity." / "Crush your to-do list" / "5 hacks to finally focus"\n"Don\'t forget!" (urgency, alarm); anything that counts down or scolds\nClinical or "ADHD tool" framing; before/after productivity flexes\nPromises to cure, treat or diagnose ADHD; "affordable for all" or guaranteed free access\nFeatures, prices, testimonials or health outcomes that are not confirmed',
    examples: 'Built by someone who kept losing his place. That\'s the whole story.\nYou don\'t have to explain the gap. Just come back.\nOne small move today. That\'s enough.\nIf your brain works like ours — hi. You\'re not behind.\n\nFeed post types: affirmation (text-first), return moment (teal), product (one screen, one idea), warm win (maíz, rare). Formats: 1:1 feed, 4:5 for founder and quote posts, 9:16 stories with the line low.',
  },
  facts: {
    confirmed: [
      'Source of these facts: the NÈNÈMI Brand Book v3.0 supplied by Marcos, plus his own statements.',
      '"Nenemi" is Nahuatl for "to return, to come back" (per the brand book). The mark\'s terraced steps nod to the Aztec xicalcoliuhqui, the stepped fret seen at Teotihuacan and Templo Mayor.',
      'Marcos states that almost four years of research, interviews and meetings with health professionals and people living with ADHD, plus his own lived experience, informed NÈNÈMI. Say "almost four years", never "four years". These conversations are not clinical validation, a medical endorsement or a clinical trial.',
      'NÈNÈMI was approved for distribution on the App Store (see the attached App Store approval email). Approval does not establish that the app is currently downloadable.',
      'Marcos built NÈNÈMI with Claude Code, and is a neurodivergent founder.',
      'The product keeps your place: it shows "where you left off" and "what\'s next", offers a "Too big? Make it smaller" move and an always-available "I\'m stuck" button, and uses warm wins like "You came back" (per the brand book; confirm any specific feature is live before announcing it).',
      'A voluntary invitation to contact Marcos about cost is supported ("if you can\'t afford it, please reach out").',
    ],
    verify: [
      'The exact date the approval email arrived (not reliably established).',
      'That the app is live and downloadable on the App Store (check the live listing first).',
      'Any current prices, product features, testimonials or measurable health outcomes.',
      'Any claim of "affordable for all" or a guaranteed free-access program.',
      'Any research, statistic, or clinician endorsement beyond "almost four years of conversations and reading".',
    ],
    links: [{ label: 'Website', url: 'https://mynenemi.com' }],
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
