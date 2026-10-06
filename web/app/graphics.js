// One renderer for preview and export, so what you see is what downloads. It uses only the
// selected brand's colors, logo and fonts (Inter is for the workspace interface, never the artwork).
import { api, fileUrl, isImg } from './core.js';

export const FORMATS = { portrait: [1080, 1350, 'Portrait · 1080 × 1350'], square: [1080, 1080, 'Square · 1080 × 1080'], story: [1080, 1920, 'Story · 1080 × 1920'] };
const FALLBACK = { heading: '"Arial Black", "Helvetica Neue", Arial, sans-serif', body: 'Arial, "Helvetica Neue", sans-serif' };

const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
export function palette(brand, style) {
  const c = brand.profile.colors;
  const bg = style === 'light' ? c.light : style === 'primary' ? c.primary : c.dark;
  const fg = style === 'light' ? c.dark : style === 'dark' ? c.light : (contrast(c.primary, c.light) >= contrast(c.primary, c.dark) ? c.light : c.dark);
  return { bg, fg, accent: c.accent, dark: style !== 'light' && lum(bg) < 0.4 };
}

const blobCache = new Map();
async function loadImage(url) {
  if (!blobCache.has(url)) {
    blobCache.set(url, (async () => {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('Could not load ' + url);
      const blob = await r.blob(); const obj = URL.createObjectURL(blob);
      const img = new Image(); img.src = obj; await img.decode(); return img;
    })());
    blobCache.get(url).catch(() => blobCache.delete(url));
  }
  return blobCache.get(url);
}

const fontState = new Map();
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('timeout'), ms))]);
// Resolves to { css, loaded, requested } for one brand font. Never throws; reports honestly instead.
export async function ensureFont(brand, which) {
  const f = brand.profile.fonts[which], fb = FALLBACK[which];
  const key = `${brand.id}|${which}|${f.source}|${f.family}|${f.fileId || ''}`;
  if (fontState.has(key)) return fontState.get(key);
  const job = (async () => {
    try {
      if (f.source === 'system') return { css: `${/[ ]/.test(f.family) ? `"${f.family}"` : f.family}, ${fb}`, loaded: true, requested: f.family, family: f.family };
      if (f.source === 'google') {
        const id = 'gf-' + f.family.replace(/\W/g, '');
        let link = document.getElementById(id);
        if (!link) {
          link = document.createElement('link'); link.id = id; link.rel = 'stylesheet';
          link.href = 'https://fonts.googleapis.com/css?family=' + encodeURIComponent(f.family).replace(/%20/g, '+') + '&display=swap';
          link._ready = new Promise((res) => { link.onload = () => res(true); link.onerror = () => res(false); });
          document.head.append(link);
        }
        const sheet = await withTimeout(link._ready, 5000);
        const r = sheet === true ? await withTimeout(document.fonts.load(`40px "${f.family}"`), 5000) : 'timeout';
        const ok = r !== 'timeout' && r.length > 0 && document.fonts.check(`40px "${f.family}"`);
        return { css: `"${f.family}", ${fb}`, loaded: ok, requested: f.family, family: f.family };
      }
      const alias = `lr-${brand.id}-${which}-${f.fileId}`;
      const buf = await (await fetch(fileUrl({ id: f.fileId }, false, brand.id), { credentials: 'same-origin' })).arrayBuffer();
      const face = new FontFace(alias, buf); await face.load(); document.fonts.add(face);
      return { css: `"${alias}", ${fb}`, loaded: true, requested: f.family, family: alias };
    } catch { return { css: fb, loaded: false, requested: f.family, family: null }; }
  })();
  fontState.set(key, job); return job;
}

function wrap(x, text, size, fontCss, maxW) {
  x.font = `${size}px ${fontCss}`; const lines = [];
  for (const para of text.split('\n')) { let line = ''; for (const word of para.split(' ')) { const t = line ? line + ' ' + word : word; if (x.measureText(t).width > maxW && line) { lines.push(line); line = word; } else line = t; } lines.push(line); }
  return lines;
}

// Slide 0 is the post's main graphic; later slides take their headline and image from graphic.slides.
export const slideCount = (post) => 1 + (post.graphic.slides?.length || 0);
export async function renderGraphic({ post, brand, files, format = 'portrait', canvas, slideIndex = 0 }) {
  const [w, h] = FORMATS[format];
  const c = canvas || document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); const base = post.graphic, total = slideCount(post);
  const g = slideIndex === 0 ? base : { ...base, line: base.slides[slideIndex - 1].line, imageFileId: base.slides[slideIndex - 1].imageFileId || null, footer: '' };
  const pal = palette(brand, g.style);
  const [hf, bf] = await Promise.all([ensureFont(brand, 'heading'), ensureFont(brand, 'body')]);
  const meta = { brandId: brand.id, background: pal.bg, foreground: pal.fg, accent: pal.accent, headingFont: hf.requested, headingFontLoaded: hf.loaded, headingCss: hf.css, bodyFont: bf.requested, bodyFontLoaded: bf.loaded, logo: false, image: false, format };
  x.fillStyle = pal.bg; x.fillRect(0, 0, w, h);
  const pad = 78, topY = format === 'story' ? 170 : 80; let y = topY;
  // Logo (tinted to the foreground when the brand marks it as a one-color mark) + wordmark
  const profile = brand.profile; const logoId = (pal.dark && profile.logo.darkFileId) || profile.logo.fileId;
  let textX = pad;
  if (g.showLogo && logoId) {
    try {
      const logo = await loadImage(fileUrl({ id: logoId }, false, brand.id)); const s = 82, ratio = logo.width / logo.height; const lw = ratio >= 1 ? s * ratio : s, lh = ratio >= 1 ? s : s / ratio;
      const lc = document.createElement('canvas'); lc.width = Math.round(lw); lc.height = Math.round(lh); const lx = lc.getContext('2d'); lx.drawImage(logo, 0, 0, lc.width, lc.height);
      if (profile.logo.treatment === 'tint' && !(pal.dark && profile.logo.darkFileId)) { lx.globalCompositeOperation = 'source-in'; lx.fillStyle = pal.fg; lx.fillRect(0, 0, lc.width, lc.height); }
      x.drawImage(lc, pad, y, lc.width, lc.height); textX = pad + lc.width + 22; meta.logo = true; meta.logoFileId = logoId;
    } catch { meta.logoError = true; }
  }
  if (g.showLogo) { x.fillStyle = pal.fg; x.font = `bold 30px ${bf.css}`; x.textBaseline = 'middle'; x.fillText(brand.name.toUpperCase().split('').join(' ').slice(0, 40), textX, y + 41); x.textBaseline = 'alphabetic'; }
  y += 82 + 30;
  x.fillStyle = pal.accent; x.fillRect(pad, y, 96, 8); y += 8 + 40; // accent rule
  // Optional photo or screenshot, contained (never cropped) in a soft frame
  let end = y;
  const img = g.imageFileId && files.find((f) => f.id === g.imageFileId && isImg(f));
  if (img) {
    try {
      const photo = await loadImage(fileUrl(img, false, brand.id));
      const boxH = format === 'square' ? 400 : format === 'story' ? 780 : 520, boxW = w - pad * 2;
      x.save(); x.beginPath(); x.roundRect(pad, y, boxW, boxH, 22); x.fillStyle = pal.dark ? '#ffffff14' : '#00000010'; x.fill(); x.clip();
      const sc = Math.min(boxW / photo.width, boxH / photo.height), pw = photo.width * sc, ph = photo.height * sc; x.drawImage(photo, pad + (boxW - pw) / 2, y + (boxH - ph) / 2, pw, ph); x.restore();
      end = y + boxH; meta.image = true; meta.imageFileId = img.id;
    } catch { meta.imageError = true; }
  }
  // Headline in the brand's heading font
  const footerH = format === 'story' ? 245 : 150, maxW = w - pad * 2; let size = 96, lines;
  const room = () => h - end - footerH - 60;
  for (;;) { lines = wrap(x, g.line || '', size, hf.css, maxW); if ((lines.length * size * 1.12 <= room() && lines.every((l) => x.measureText(l).width <= maxW)) || size <= 28) break; size -= 3; }
  x.fillStyle = pal.fg; x.font = `${size}px ${hf.css}`;
  const blockH = lines.length * size * 1.12, bottom = h - footerH, top = Math.max(end + 50, bottom - blockH);
  lines.forEach((l, i) => x.fillText(l, pad, top + size * 0.95 + i * size * 1.12)); meta.headlineSize = size;
  const footer = (g.footer || profile.tagline || '').trim();
  if (footer) { x.globalAlpha = 0.7; x.font = `22px ${bf.css}`; x.fillText(footer.toUpperCase(), pad, h - (format === 'story' ? 155 : 65)); x.globalAlpha = 1; }
  if (total > 1) { x.globalAlpha = 0.7; x.font = `22px ${bf.css}`; x.textAlign = 'right'; x.fillStyle = pal.fg; x.fillText(`${slideIndex + 1} / ${total}`, w - pad, h - (format === 'story' ? 155 : 65)); x.textAlign = 'left'; x.globalAlpha = 1; }
  meta.slide = slideIndex + 1; meta.slides = total;
  c.__meta = meta; return { canvas: c, meta };
}

// Renders every slide of a post, one after another, as PNG (and JPEG for PDF) blobs.
export async function exportSlides(args, type = 'image/png') {
  const out = [];
  for (let i = 0; i < slideCount(args.post); i++) {
    const { canvas, meta } = await renderGraphic({ ...args, slideIndex: i, canvas: undefined });
    out.push({ blob: await new Promise((r) => canvas.toBlob(r, type, 0.92)), meta, width: canvas.width, height: canvas.height });
  }
  return out;
}
export async function exportPng(args) {
  const { canvas, meta } = await renderGraphic(args);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return { blob, meta };
}
