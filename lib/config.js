// All tunables live here. Environment overrides are parsed strictly; an invalid
// value makes AI unavailable (fail closed) rather than silently using a default.

// Prices in micro-dollars per token ($0.15 / 1M input = 0.15 µ$ per token).
// Source: OpenAI model page for gpt-4o-mini, as recorded 2026-10-05 in the previous build and
// cross-checked 2026-10-06 against secondary sources only (official docs were unreachable from
// the build sandbox). Re-verify at https://developers.openai.com/api/docs/pricing before first use.
export const MODELS = {
  'gpt-4o-mini-2024-07-18': { inputMicrosPerToken: 0.15, outputMicrosPerToken: 0.60, vision: true, imageTokensLow: 2833 },
};
export const DEFAULT_MODEL = 'gpt-4o-mini-2024-07-18';
export const PROMPT_VERSION = 'review-v2';

export const LIMITS = {
  caption: 5000,
  question: 1000,
  excerpt: 12000,          // characters per excerpt
  textFileAi: 40000,       // bytes: largest whole text file selectable for AI
  maxTextSources: 6,
  maxTextBytes: 60000,     // all text sources combined
  maxImages: 3,
  maxImageBytes: 4 * 1024 * 1024,
  maxOutputTokens: 2000,
  imageReserveTokens: 4000, // per image; detail forced to "low" (2,833 tokens on this model) + margin
  maxRequestMicros: 60000,  // refuse to even reserve more than $0.06 for one review
  upload: 4 * 1024 * 1024,  // Vercel functions accept ~4.5 MB request bodies
  filesPerPost: 30,
  filesPerBrand: 100,
  upstreamTimeoutMs: 45000,
  pendingStaleMs: 90000,
};

export function readConfig(env = process.env) {
  const problems = [];
  const int = (name, dflt, min, max) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return dflt;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) { problems.push(`${name} is invalid`); return dflt; }
    return n;
  };
  const timeZone = env.LAUNCH_ROOM_TIMEZONE || 'America/Chicago';
  try { new Intl.DateTimeFormat('en-CA', { timeZone }); } catch { problems.push('LAUNCH_ROOM_TIMEZONE is invalid'); }
  const model = env.OPENAI_REVIEW_MODEL || DEFAULT_MODEL;
  if (!MODELS[model]) problems.push(`Model ${model} has no verified price in lib/config.js`);
  return {
    dailyLimit: int('AI_DAILY_LIMIT', 10, 0, 1000),
    monthlyMicros: Math.round(int('AI_MONTHLY_BUDGET_USD', 5, 0, 1000) * 1e6),
    timeZone,
    model,
    aiConfigProblems: problems,
  };
}
