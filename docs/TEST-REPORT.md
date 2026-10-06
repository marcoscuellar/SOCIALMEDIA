# Test report

Date: 2026-10-06. Short version: the app, data separation, limits, migration tooling and browser behavior were tested for real against real Postgres and a real browser. Everything that talks to a service I couldn't reach (OpenAI, Vercel, Neon's hosted driver, Vercel Blob) was not tested live.

## Passed with real components
| Area | How | Result |
|---|---|---|
| Brand create / edit / archive, revision conflicts | API tests on in-memory Postgres (PGlite) and on a real Postgres 16 server | pass (both) |
| **Data separation**: every cross-brand read, write, action, delete, review, file, excerpt, note and logo assignment is refused server-side | same | pass |
| Approvals enforced server-side; caption edit clears approval and image approval; clients can't self-approve | same | pass |
| Voice / branding change flags posts "needs another look", reviews stale, nothing approved is changed | same + browser | pass |
| Posting status per platform; history | same + browser (survives reload) | pass |
| Files: content sniffing, roles, size limit, download headers, removal deletes bytes and detaches references | same + browser | pass |
| Auth, origin check, missing-database message | API tests | pass |
| **Concurrency** (true parallel connections, real Postgres): 40 simultaneous reviews → exactly 10 reach the provider; 15 identical → 1; monthly allowance never exceeded; 20 parallel edits at one revision → 1 wins | `tests/concurrency.test.mjs` | pass |
| Migration of legacy data: dry run writes nothing; apply preserves drafts, live edits, approvals, posted statuses, attachments (same blob keys, hashed), note, old reviews (marked stale), usage; legacy rows byte-identical afterward; re-run adds nothing | library tests + the actual CLI scripts on a throwaway local Postgres | pass |
| Backup → restore into an empty database (every table identical); restore refuses a non-empty one | library tests + CLI | pass |
| **Browser, two very different brands** (headless Chromium): create/edit/switch; separation; captions survive reload; exported PNG pixels (background, logo, accent) and font faces differ per brand; story/square sizes; upload, preview, download, use for graphic, remove; selected-source handling; concurrent edits from two tabs (conflict offered, nothing lost); limit message; calendar, queue, unschedule; keyboard (skip link, tab order, focus ring, Escape); dark mode persistence; reduced motion; 390 px phone layout (no sideways scroll, bottom nav, touch targets ≥ 40 px) | `tests/e2e.mjs` | 17/17 pass |

Totals at the end: 42 tests (in-memory Postgres), 25 of those re-run on real Postgres, 5 concurrency, 17 browser steps. All pass.

## Passed only with mocks
- **AI calls.** A recording stand-in for OpenAI. Verified what is sent (voice by mode, facts, only ticked sources, images as `detail: low`), claim/source validation, caching keys (brand, voice versions, caption, question, source versions), limits, rollover at midnight and month end (clock injected), failures with no retry, refunds for definite rejections, fail-closed on unreadable usage. **No real model output was seen**, so quality of reviews and how well the model follows the voice rules is unknown.
- **Cost numbers.** Rates ($0.15 / $0.60 per million tokens, `gpt-4o-mini-2024-07-18`) were confirmed only from secondary sources; OpenAI's own pages were blocked here. The image reserve (4,000 tokens per image, `detail: low`) is a conservative estimate, not a measurement. Measured usage replaces it after each call.

## Not tested at all
- Deployment on Vercel; the Neon HTTP driver (tests use PGlite and plain TCP Postgres); the live Vercel Blob API (private blobs `put`/`get`/`del`).
- Real OpenAI requests, billing, or rate-limit behavior.
- Migration of your actual database and Blob files.
- Real Google Fonts in exported graphics (the sandbox is offline; brand fonts were tested via uploaded font files; Google font loading and its fallback warning are coded but unverified).
- Safari, Firefox, and real phones (only Chromium, emulated 390 px).
- Screen reader behavior; automated checks cover labels, focus and targets, not a human audit. Color contrast was designed for AA but not measured with a tool.
- Large data (hundreds of posts), files over 4 MB (blocked by design), PDFs/Word read by AI (not supported by design).

## Bugs found by this testing and fixed
- Reviews stayed marked current in the page after a caption edit until reload.
- After a save, open panels held a stale copy of the post, so un-ticking an AI source didn't stick.
- A limit hit didn't refresh the usage notice.
- A server-time bug: pending AI runs used the real clock instead of the injected one (only visible in tests).
- Migration's usage import used the wrong "today" in tests.
- Plan page copy contained the word "overdue".

## Known limitations
- One owner, one shared password (HTTP Basic). Needs real sign-in before sharing.
- Uploads capped at 4 MB.
- The return note is last-write-wins (no conflict prompt); posts and brands are conflict-checked.
- Failed or timed-out AI calls keep their cost reservation (and a daily slot) by design; definite provider rejections (400/401/403/404/422/429) are refunded.
- Migrated "posted" checkmarks carry the migration date, not the original posting date.
- Removing a file deletes its bytes permanently; there is no trash.
