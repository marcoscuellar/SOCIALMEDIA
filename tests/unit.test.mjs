import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffType, aiSupport, cleanFilename } from '../lib/files.js';
import { estimate, actualMicros } from '../lib/cost.js';
import { canonical, validDate, zonedDay } from '../lib/util.js';
import { normalizeProfile, voiceFingerprint, styleFingerprint, DEFAULT_PROFILE } from '../lib/profile.js';
import { readConfig, LIMITS } from '../lib/config.js';
import { buildInstructions } from '../lib/prompt.js';
import { PNG, ttf } from './helpers.mjs';

test('file type is sniffed from content, not the filename', () => {
  assert.equal(sniffType(PNG, 'evil.txt'), 'image/png');
  assert.equal(sniffType(ttf, 'x.png'), 'font/ttf');
  assert.equal(sniffType(Buffer.from('%PDF-1.7 ...'), 'a.pdf'), 'application/pdf');
  assert.equal(sniffType(Buffer.from('hello'), 'notes.md'), 'text/markdown');
  assert.equal(sniffType(Buffer.from('hello'), 'notes.exe'), 'application/octet-stream');
  assert.equal(sniffType(Buffer.from([0xff, 0xfe, 0, 0, 1, 2]), 'x.txt'), 'application/octet-stream');
});
test('AI support is stated honestly per format', () => {
  assert.equal(aiSupport({ type: 'image/png', size: 1000 }).supported, true);
  assert.equal(aiSupport({ type: 'image/png', size: 5e6 }).supported, false);
  assert.equal(aiSupport({ type: 'text/plain', size: 1000 }).supported, true);
  const big = aiSupport({ type: 'text/plain', size: 90000 }); assert.equal(big.supported, false); assert.equal(big.excerptOnly, true);
  assert.match(aiSupport({ type: 'application/pdf', size: 100 }).reason, /not read by AI/);
  assert.equal(aiSupport({ type: 'application/zip', size: 100 }).supported, false);
});
test('filenames are cleaned', () => { assert.equal(cleanFilename(encodeURIComponent('a/b\\c.png')), 'a_b_c.png'); assert.equal(cleanFilename('%E0%A4%A'), null); });
test('cost estimate grows with images and text and is an upper bound', () => {
  const m = 'gpt-4o-mini-2024-07-18';
  const t = estimate({ model: m, textBytes: 10000, imageCount: 0 }), i = estimate({ model: m, textBytes: 10000, imageCount: 2 });
  assert.ok(i.micros > t.micros);
  assert.ok(i.micros - t.micros >= Math.ceil(2 * LIMITS.imageReserveTokens * 0.15));
  // 40 KB of text at 1 token/byte + full output must be below the old one-cent reservation guard only because the new one scales
  assert.ok(estimate({ model: m, textBytes: 40000, imageCount: 0 }).micros < LIMITS.maxRequestMicros);
  assert.equal(actualMicros(m, { input_tokens: 1000, output_tokens: 500 }), Math.ceil(1000 * 0.15 + 500 * 0.6));
  assert.equal(actualMicros(m, {}), null); assert.equal(actualMicros(m, { input_tokens: -1, output_tokens: 1 }), null);
});
test('canonical JSON is key-order independent', () => { assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 })); });
test('dates are validated', () => { assert.ok(validDate('2026-02-28')); assert.ok(!validDate('2026-02-30')); assert.ok(!validDate('26-1-1')); });
test('midnight is computed in the workspace timezone', () => {
  assert.equal(zonedDay(new Date('2026-10-06T04:59:00Z'), 'America/Chicago'), '2026-10-05');
  assert.equal(zonedDay(new Date('2026-10-06T05:01:00Z'), 'America/Chicago'), '2026-10-06');
});
test('profile validation rejects bad colors, fonts and links', () => {
  assert.throws(() => normalizeProfile({ colors: { dark: 'red' } }), /color/);
  assert.throws(() => normalizeProfile({ fonts: { heading: { source: 'google', family: 'x;}</style>' } } }), /font name/);
  assert.throws(() => normalizeProfile({ facts: { links: [{ label: 'x', url: 'javascript:alert(1)' }] } }), /not a valid/);
  assert.equal(normalizeProfile({}).colors.dark, DEFAULT_PROFILE().colors.dark);
});
test('voice and style fingerprints track only what they should', () => {
  const p = normalizeProfile({ voice: { guidelines: 'a' } });
  const same = normalizeProfile({ voice: { guidelines: 'a' }, colors: { primary: '#000000' } });
  assert.equal(voiceFingerprint('X', p), voiceFingerprint('X', same));
  assert.notEqual(styleFingerprint(p), styleFingerprint(same));
  assert.notEqual(voiceFingerprint('X', p), voiceFingerprint('Y', p));
});
test('invalid AI config makes AI unavailable instead of defaulting silently', () => {
  assert.ok(readConfig({ AI_DAILY_LIMIT: 'abc' }).aiConfigProblems.length);
  assert.ok(readConfig({ OPENAI_REVIEW_MODEL: 'gpt-unpriced' }).aiConfigProblems.length);
  assert.equal(readConfig({}).dailyLimit, 10); assert.equal(readConfig({}).monthlyMicros, 5e6);
});
test('platform guidance reaches the prompt as advisory notes', () => {
  const brand = { name: 'A', profile: DEFAULT_PROFILE() };
  const li = buildInstructions({ brand, founder: null, voiceMode: 'brand', platform: 'linkedin' }), ig = buildInstructions({ brand, founder: null, voiceMode: 'brand', platform: 'instagram' });
  assert.match(li, /PLATFORM NOTES \(linkedin/); assert.match(li, /document-like/); assert.doesNotMatch(li, /carousels \(about 5/);
  assert.match(ig, /PLATFORM NOTES \(instagram/); assert.match(ig, /5 to 10 slides/); assert.match(ig, /advisory only/); assert.doesNotMatch(ig, /\d+\.\d+%/, 'no statistics are injected');
});
test('prompt includes the right voice by mode', () => {
  const brand = { name: 'Acme', profile: { ...DEFAULT_PROFILE(), voice: { guidelines: 'BRANDVOICE', preferred: '', avoid: '', examples: '' }, facts: { confirmed: ['FACT1'], verify: ['VERIFYME'], links: [] } } };
  const founder = { name: 'Fo', guidelines: 'FOUNDERVOICE', preferred: '', avoid: '', examples: '' };
  const b = buildInstructions({ brand, founder, voiceMode: 'brand' }), f = buildInstructions({ brand, founder, voiceMode: 'founder' }), both = buildInstructions({ brand, founder, voiceMode: 'both' });
  assert.ok(b.includes('BRANDVOICE') && !b.includes('FOUNDERVOICE'));
  assert.ok(f.includes('FOUNDERVOICE') && !f.includes('BRANDVOICE'));
  assert.ok(both.includes('BRANDVOICE') && both.includes('FOUNDERVOICE') && both.includes('VERIFYME'));
});
