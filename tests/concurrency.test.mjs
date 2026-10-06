// Real multi-connection concurrency against a real Postgres server.
// Run with: TEST_PG_URL=postgres://postgres@127.0.0.1:54329/lr node --test tests/concurrency.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, fakeReview } from './helpers.mjs';

const url = process.env.TEST_PG_URL;
const skip = url ? false : 'set TEST_PG_URL to run against a real Postgres server';

async function fx(opts = {}) {
  const t = await setup({ pgUrl: url, ...opts });
  const a = (await t.call('POST', '/api/brands', { name: 'Alpha' })).json.brand;
  const post = async (o = {}) => (await t.call('POST', `/api/brands/${a.id}/posts`, { title: 'T', linkedin: 'Cap ' + Math.random(), instagram: 'IG', ...o })).json.post;
  const review = (p, body = {}) => t.call('POST', `/api/brands/${a.id}/posts/${p.id}/review`, { platform: 'linkedin', question: 'q', sources: [], ...body });
  return { t, a, post, review };
}
const slowFetcher = (calls) => async (u, o) => { calls.n++; await new Promise((r) => setTimeout(r, 25)); return Response.json(fakeReview(o)); };

test('40 simultaneous distinct reviews on 20 connections: exactly 10 reach the provider', { skip }, async () => {
  const calls = { n: 0 }; const { t, post, review } = await fx({ fetcher: slowFetcher(calls) });
  const posts = await Promise.all(Array.from({ length: 40 }, () => post()));
  const rs = await Promise.all(posts.map((p) => review(p)));
  assert.equal(calls.n, 10); assert.equal(rs.filter((r) => r.status === 200).length, 10); assert.equal(rs.filter((r) => r.status === 429).length, 30);
  assert.equal((await t.call('GET', '/api/ai-usage')).json.usage.usedToday, 10);
  await t.close();
});

test('simultaneous identical reviews: one provider call', { skip }, async () => {
  const calls = { n: 0 }; const { t, post, review } = await fx({ fetcher: slowFetcher(calls) }); const p = await post();
  const rs = await Promise.all(Array.from({ length: 15 }, () => review(p)));
  assert.equal(calls.n, 1); assert.ok(rs.every((r) => [200, 409].includes(r.status))); assert.equal(rs.filter((r) => r.status === 200).length >= 1, true);
  await t.close();
});

test('monthly allowance cannot be exceeded by parallel reservations', { skip }, async () => {
  const calls = { n: 0 }; const { t, post, review } = await fx({ fetcher: slowFetcher(calls), env: { AI_DAILY_LIMIT: '100' } }); const p0 = await post();
  const est = (await t.call('POST', `/api/brands/${p0.brandId}/posts/${p0.id}/review-preview`, { platform: 'linkedin', sources: [] })).json.estimatedMaxDollars;
  const allowed = 4; await t.db.query(`UPDATE ai_budget SET month='2026-10', month_micros=$1 WHERE id=1`, [5000000 - Math.round(est * 1e6 * (allowed + 0.5))]);
  const posts = await Promise.all(Array.from({ length: 25 }, () => post()));
  const rs = await Promise.all(posts.map((p) => review(p)));
  assert.equal(calls.n, allowed); assert.equal(rs.filter((r) => r.status === 200).length, allowed);
  const m = Number((await t.db.query(`SELECT month_micros FROM ai_budget`))[0].month_micros); assert.ok(m <= 5000000, 'ledger never exceeds the allowance');
  await t.close();
});

test('parallel edits to one post at one revision: exactly one wins', { skip }, async () => {
  const { t, a, post } = await fx(); const p = await post();
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => t.call('PATCH', `/api/brands/${a.id}/posts/${p.id}`, { revision: p.revision, changes: { linkedin: 'w' + i } })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1); assert.equal(rs.filter((r) => r.status === 409).length, 19);
  const g = (await t.call('GET', `/api/brands/${a.id}/posts/${p.id}`)).json.post; assert.equal(g.revision, p.revision + 1);
  await t.close();
});

test('parallel brand edits: one winner; parallel posts across brands stay separate', { skip }, async () => {
  const { t, a } = await fx(); const b = (await t.call('POST', '/api/brands', { name: 'Beta' })).json.brand;
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => t.call('PATCH', `/api/brands/${a.id}`, { revision: a.revision, name: 'N' + i })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  await Promise.all(Array.from({ length: 30 }, (_, i) => t.call('POST', `/api/brands/${i % 2 ? a.id : b.id}/posts`, { title: (i % 2 ? 'A' : 'B') + i })));
  const pa = (await t.call('GET', `/api/brands/${a.id}/posts`)).json.posts, pb = (await t.call('GET', `/api/brands/${b.id}/posts`)).json.posts;
  assert.equal(pa.length, 15); assert.equal(pb.length, 15); assert.ok(pa.every((p) => p.title.startsWith('A') && p.brandId === a.id)); assert.ok(pb.every((p) => p.title.startsWith('B')));
  await t.close();
});
