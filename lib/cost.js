import { MODELS, LIMITS } from './config.js';

// Upper-bound reservation computed BEFORE anything is sent.
// Text: UTF-8 bytes bound the token count from above (a token is at least one byte).
// Images: a fixed reserve per image (detail is forced to "low"); actual usage replaces it after the call.
// Output: the full max_output_tokens.
export function estimate({ model, textBytes, imageCount }) {
  const m = MODELS[model];
  const inputTokens = textBytes + imageCount * LIMITS.imageReserveTokens;
  const outputTokens = LIMITS.maxOutputTokens;
  const micros = Math.ceil((inputTokens * m.inputMicrosPerToken + outputTokens * m.outputMicrosPerToken) * 1.1);
  return { inputTokens, outputTokens, micros: Math.max(micros, 100) };
}
export function actualMicros(model, usage) {
  const m = MODELS[model];
  const i = usage?.input_tokens, o = usage?.output_tokens;
  if (!Number.isSafeInteger(i) || !Number.isSafeInteger(o) || i < 0 || o < 0) return null;
  return Math.ceil(i * m.inputMicrosPerToken + o * m.outputMicrosPerToken);
}
