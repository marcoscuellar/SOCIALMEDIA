import { LIMITS } from './config.js';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const FONT_TYPES = { 'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff': 'woff', 'font/woff2': 'woff2' };
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'json']);

const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));

// Detect type from content, never from the filename the browser supplied.
export function sniffType(bytes, name = '') {
  const b = new Uint8Array(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + Math.min(bytes.length, 16)) : bytes);
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(b, 0, 4) === 'wOF2') return 'font/woff2';
  if (ascii(b, 0, 4) === 'wOFF') return 'font/woff';
  if (ascii(b, 0, 4) === 'OTTO') return 'font/otf';
  if (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) return 'font/ttf';
  if (ascii(b, 0, 4) === 'true') return 'font/ttf';
  if (ascii(b, 0, 4) === '%PDF') return 'application/pdf';
  if (ascii(b, 0, 2) === 'PK') return 'application/zip';
  const ext = name.toLowerCase().split('.').pop();
  if (TEXT_EXT.has(ext) && isUtf8Text(bytes)) return ext === 'csv' ? 'text/csv' : ext === 'json' ? 'application/json' : ext === 'md' || ext === 'markdown' ? 'text/markdown' : 'text/plain';
  return 'application/octet-stream';
}

export function isUtf8Text(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return !text.includes('\u0000');
  } catch { return false; }
}

export const isImage = (type) => IMAGE_TYPES.includes(type);
export const isText = (type) => ['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(type);

// Honest statement of what the AI reviewer can read for a stored file.
export function aiSupport({ type, size }) {
  if (isImage(type)) {
    if (size > LIMITS.maxImageBytes) return { supported: false, kind: 'image', reason: 'Image is larger than 4 MB, so it cannot be sent to AI.' };
    return { supported: true, kind: 'image', note: `Read as an image (counts as ~${LIMITS.imageReserveTokens} tokens of cost reserve).` };
  }
  if (isText(type)) {
    if (size > LIMITS.textFileAi) return { supported: false, kind: 'text', excerptOnly: true, reason: `Text is over ${Math.round(LIMITS.textFileAi / 1000)} KB. Select an excerpt of the part you want read.` };
    return { supported: true, kind: 'text', note: 'Read as plain text.' };
  }
  if (type === 'application/pdf') return { supported: false, kind: 'pdf', reason: 'PDFs are stored and downloadable but not read by AI yet. Paste the relevant passage as an excerpt instead.' };
  if (type === 'application/zip') return { supported: false, kind: 'other', reason: 'Word, Excel and other zipped Office formats are not read by AI. Paste the relevant passage as an excerpt instead.' };
  if (type in FONT_TYPES) return { supported: false, kind: 'font', reason: 'Font files are used for graphics, not read by AI.' };
  return { supported: false, kind: 'other', reason: 'This format is stored and downloadable but cannot be read by AI. Paste the relevant passage as an excerpt instead.' };
}

export function cleanFilename(raw) {
  let name = 'attachment';
  try { name = decodeURIComponent(raw || 'attachment'); } catch { return null; }
  name = name.replace(/[\x00-\x1f\x7f/\\]/g, '_').trim().slice(0, 200);
  return name || 'attachment';
}
