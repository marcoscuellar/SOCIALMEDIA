// Aesthetic directions distilled from the supplied "Platform Aesthetic Trends" research. Each brand may pick one (or none).
// Advisory only: descriptions of recognised movements, no statistics.
export const AESTHETICS = {
  'warm-editorial': { label: 'Warm editorial', tip: 'Expressive serif or classic type, generous white space, cream or paper-like backgrounds, a warm earthy palette. Calm, human, thoughtful.' },
  'soft-brutalism': { label: 'Soft brutalism', tip: 'Visible structure, high-contrast borders, flat shadows, neo-grotesque sans, pastel bases against stark black. Friendly and usable, not abrasive.' },
  'techno-futurism': { label: 'Techno-futurism', tip: 'Dark canvas, hairline borders, one radiant accent color, geometric sans with monospace details. Precise and fast, nothing decorative.' },
  'retro-futurism': { label: 'Retro-futurism', tip: 'Dot-matrix or monospace type, monochrome grayscale with one industrial accent, honest "hardware" details. Nostalgic but modern.' },
  'naive-imperfect': { label: 'Imperfect and human', tip: 'Deliberate imperfection: hand-drawn doodles, photocopy grain, plain-text styling. Signals a real person made it.' },
  'minimaximalism': { label: 'Minimaximalism', tip: 'Restrained layout with one hyper-saturated hue against charcoal or paper-white. Instant recall; best for launches, not forever.' },
};
export const AESTHETIC_KEYS = Object.keys(AESTHETICS);
export const aestheticList = () => AESTHETIC_KEYS.map((key) => ({ key, ...AESTHETICS[key] }));
