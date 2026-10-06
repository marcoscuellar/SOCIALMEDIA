import { bad, str, strList, HEX, canonical, sha256 } from './util.js';
import { AESTHETIC_KEYS } from './aesthetics.js';

export const FONT_SOURCES = ['system', 'google', 'upload'];
export const DEFAULT_PROFILE = () => ({
  description: '', audience: '', positioning: '', tagline: '', aesthetic: '',
  colors: { dark: '#111111', light: '#ffffff', primary: '#3355aa', accent: '#e0a030' },
  fonts: { heading: { source: 'system', family: 'Arial Black' }, body: { source: 'system', family: 'Arial' } },
  logo: { fileId: null, darkFileId: null, treatment: 'original' },
  voice: { guidelines: '', preferred: '', avoid: '', examples: '' },
  facts: { confirmed: [], verify: [], links: [] },
});

const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 \-]{0,59}$/;
function font(input, which) {
  const f = input || {};
  const source = f.source ?? 'system';
  if (!FONT_SOURCES.includes(source)) throw bad(`${which} font source is not valid.`);
  const family = str(f.family, { max: 60, name: `${which} font name` }).trim();
  if (source !== 'upload' && !FAMILY.test(family)) throw bad(`${which} font name can use letters, numbers, spaces and hyphens.`);
  if (source === 'upload' && !(typeof f.fileId === 'string' && f.fileId)) throw bad(`Choose an uploaded font file for the ${which.toLowerCase()} font.`);
  return source === 'upload' ? { source, family: family || 'Brand font', fileId: f.fileId } : { source, family };
}
const aesthetic = (v) => { if (v === undefined || v === null || v === '') return ''; if (!AESTHETIC_KEYS.includes(v)) throw bad('Choose an aesthetic direction from the list, or leave it empty.'); return v; };
const color = (v, name) => { if (!HEX.test(v || '')) throw bad(`${name} must be a color like #1a2b3c.`); return v.toLowerCase(); };
function url(u) {
  const value = str(u, { max: 500, name: 'Link' }).trim();
  try { const p = new URL(value); if (!['http:', 'https:'].includes(p.protocol)) throw 0; return p.toString(); } catch { throw bad(`"${value.slice(0, 60)}" is not a valid http(s) link.`); }
}

export function normalizeProfile(input) {
  const p = input || {};
  const d = DEFAULT_PROFILE();
  const colors = p.colors || {};
  const voice = p.voice || {};
  const facts = p.facts || {};
  const logo = p.logo || {};
  if (!['original', 'tint'].includes(logo.treatment ?? 'original')) throw bad('Logo treatment is not valid.');
  return {
    description: str(p.description, { max: 2000, name: 'Description' }),
    audience: str(p.audience, { max: 2000, name: 'Audience' }),
    positioning: str(p.positioning, { max: 2000, name: 'Positioning' }),
    tagline: str(p.tagline, { max: 80, name: 'Graphic footer line' }),
    aesthetic: aesthetic(p.aesthetic),
    colors: {
      dark: color(colors.dark ?? d.colors.dark, 'Dark color'), light: color(colors.light ?? d.colors.light, 'Light color'),
      primary: color(colors.primary ?? d.colors.primary, 'Primary color'), accent: color(colors.accent ?? d.colors.accent, 'Accent color'),
    },
    fonts: { heading: font(p.fonts?.heading ?? d.fonts.heading, 'Headline'), body: font(p.fonts?.body ?? d.fonts.body, 'Body') },
    logo: { fileId: logo.fileId || null, darkFileId: logo.darkFileId || null, treatment: logo.treatment ?? 'original' },
    voice: {
      guidelines: str(voice.guidelines, { max: 8000, name: 'Voice guidelines' }),
      preferred: str(voice.preferred, { max: 3000, name: 'Preferred phrases' }),
      avoid: str(voice.avoid, { max: 3000, name: 'Language to avoid' }),
      examples: str(voice.examples, { max: 8000, name: 'Writing examples' }),
    },
    facts: {
      confirmed: strList(facts.confirmed, { name: 'Confirmed facts' }),
      verify: strList(facts.verify, { name: 'Claims to verify' }),
      links: (Array.isArray(facts.links) ? facts.links : []).slice(0, 30).map((l) => ({ label: str(l.label, { max: 100, name: 'Link label' }).trim(), url: url(l.url) })),
    },
  };
}

// What counts as "voice": changes here mark reviews and approvals as needing another look.
export const voiceFingerprint = (name, p) => sha256(canonical({ name, d: p.description, a: p.audience, pos: p.positioning, v: p.voice, f: p.facts }));
// What counts as "style": changes here mark approved graphics as needing another look.
export const styleFingerprint = (p, files = {}) => sha256(canonical({ c: p.colors, f: p.fonts, l: p.logo, t: p.tagline, files }));

export const normalizeFounder = (input) => ({
  name: str(input.name, { max: 100, name: 'Name', required: true }).trim(),
  guidelines: str(input.guidelines, { max: 8000, name: 'Voice guidelines' }),
  preferred: str(input.preferred, { max: 3000, name: 'Preferred phrases' }),
  avoid: str(input.avoid, { max: 3000, name: 'Language to avoid' }),
  examples: str(input.examples, { max: 8000, name: 'Writing examples' }),
});
export const founderFingerprint = (f) => sha256(canonical({ g: f.guidelines, p: f.preferred, a: f.avoid, e: f.examples }));
