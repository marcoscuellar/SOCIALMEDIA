# Launch Room

A private place to plan, write, review, design and prepare social posts for any of your brands. Nothing is ever posted automatically.

TLDR: add brands in the app (no code edits), each with its own voice, look, posts, files, calendar, return note and posting history. Your personal founder voice is separate and reusable. AI is optional, only runs when you ask, and has hard limits enforced on the server.

## What's in it
- **Brands:** switcher plus Add/Edit Brand: description, audience, positioning, logo, colors, headline/body fonts (system, Google Fonts, or an uploaded font file), voice guidelines, preferred phrases, language to avoid, writing examples, confirmed facts, links, and claims that need verification. Brands can be archived, never silently deleted.
- **My voice:** your founder voice, shared across brands. Each post chooses the brand voice, your voice, or both.
- **Post workflow:** caption → (optional AI review) → your approval → image → posting checklist. Separate LinkedIn and Instagram captions and posted status.
- **Safety rules:** AI suggestions never overwrite your words. Editing a caption clears its approval and image approval. Changing a brand's voice or look only flags affected posts "needs another look".
- **Plan:** a month calendar plus a draft queue. Create posts for any date, move them, or leave them unscheduled. No overdue or streak language.
- **Files:** per brand and per post. Stored files are clearly separate from what AI reads; you tick sources for each review. Unsupported formats and limits are shown plainly.
- **Graphics:** PNG export (portrait, square, story) using the selected brand's logo, colors and fonts. Inter is used only for the workspace itself.
- **AI cost controls:** 10 new reviews per day and $5 per month across the workspace (adjustable by environment variable), checked and reserved on the server before any request, identical reviews reused, no automatic retries, fails closed. Usage totals and per-brand usage live under Brand → AI usage.
- **Look and feel:** light and dark, readable contrast, visible keyboard focus, reduced-motion support, large touch targets and bottom navigation on phones.

## Docs
- `docs/SETUP-VERCEL.md`: deploy to Vercel with Neon and Blob.
- `docs/MIGRATION.md`: move your existing NÈNÈMI data in safely; backup and restore.
- `docs/TEST-REPORT.md`: what was tested for real, what only with mocks, what is untested.

## Develop
```bash
npm install
npm run dev            # local app, no password, on-disk Postgres (PGlite)
npm test               # API, AI cost, migration tests (in-memory Postgres)
TEST_PG_URL=postgres://... node --test tests/concurrency.test.mjs   # real multi-connection Postgres
npm run test:e2e       # headless Chromium, two brands (needs Chromium; set CHROME_PATH if needed)
```

## Layout
`api/index.js` (Vercel function) → `lib/` (server: routes, brands/posts store, AI engine, cost, files) → `db/migrations/` · `web/` (UI) · `scripts/` (migrate, legacy migration, backup, restore, dev server) · `seed/` (NÈNÈMI starter content) · `tests/`.

## Privacy
Everything is behind one password. Credentials are environment variables only. Files are stored privately. AI receives only the selected caption, the voice and confirmed facts, and the sources you tick for that review.
