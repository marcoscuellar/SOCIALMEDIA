import { createHash, randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (m, extra) => new HttpError(400, m, extra);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m, extra) => new HttpError(409, m, extra);

export const newId = (prefix = '') => prefix + randomUUID();
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const nowIso = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

// Stable JSON for hashing: object keys sorted recursively.
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

export function str(value, { max = 2000, name = 'Value', required = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw bad(`${name} must be text.`);
  if (value.length > max) throw bad(`${name} is too long (limit ${max} characters).`);
  if (required && !value.trim()) throw bad(`${name} is required.`);
  return value;
}
export const strList = (value, { max = 50, itemMax = 600, name = 'List' } = {}) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw bad(`${name} must be a list.`);
  if (value.length > max) throw bad(`${name} can have at most ${max} items.`);
  return value.map((v) => str(v, { max: itemMax, name: `${name} item` }).trim()).filter(Boolean);
};
export const HEX = /^#[0-9a-fA-F]{6}$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function validDate(s) {
  if (!DATE.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const jsonResponse = (status, value, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  body: Buffer.from(JSON.stringify(value)),
});

// Calendar day / month in the workspace timezone (default America/Chicago).
export function zonedDay(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
