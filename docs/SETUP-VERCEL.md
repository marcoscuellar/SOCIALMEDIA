# Set up Launch Room on Vercel

TLDR: import the repo into Vercel, add a Neon database and a private Blob store, set three secrets, run one database command, and open the site.

Nothing here puts credentials in the code or in chat. Every secret lives in Vercel's environment variables.

## What you need
- A Vercel account and a Neon Postgres database (Vercel Marketplace → Neon, or neon.tech).
- A **private** Vercel Blob store (Vercel dashboard → Storage → Blob → Private).
- Node 22 or later on your computer (for the one-time database command).
- Optional, for AI review: an OpenAI API key with billing enabled.

## 1. Import the project
1. Push this repo to your own Git host and import it in Vercel.
2. Framework preset: **Other**. `vercel.json` already sets the build and routes.
3. Every page is served by one password-protected function. The `public/` folder is intentionally empty so nothing can be reached without signing in.

## 2. Set environment variables (Project → Settings → Environment Variables)
| Name | Required | What it is |
|---|---|---|
| `LAUNCH_ROOM_PASSWORD` | yes | A long, unique password. The browser asks for a username (anything) and this password. |
| `DATABASE_URL` | yes | Your Neon connection string. |
| `BLOB_READ_WRITE_TOKEN` | for uploads | Added automatically when you connect a Blob store. Without it, the app works but file upload is off and says so. |
| `OPENAI_API_KEY` | for AI review | Server-only. Without it, AI review is off and says so. Editing and approving still work. |
| `AI_DAILY_LIMIT` | no | Default 10 new reviews per day. |
| `AI_MONTHLY_BUDGET_USD` | no | Default 5. |
| `LAUNCH_ROOM_TIMEZONE` | no | Default `America/Chicago`. Decides when "midnight" is. |

An invalid value for a limit or timezone turns AI off (fail closed) instead of silently using a default.

## 3. Create the tables (once)
On your computer, in the project folder:

```bash
npm install
vercel env pull .env.local        # or copy DATABASE_URL yourself
set -a; source .env.local; set +a
npm run db:migrate
```

This only creates new tables (`brands`, `posts`, and so on). It is safe to run again. It never touches the old `launch_workspace` table. You can also paste `db/migrations/001_init.sql` into the Neon SQL editor, one statement at a time (statements are separated by `-- @@` lines).

## 4. Deploy and open it
1. Redeploy after setting variables.
2. Open the site, sign in with your password.
3. You will see "Add your first brand".
   - **Fresh start:** add a brand, or use "Load the NÈNÈMI starter" (21 drafts + your founder voice). The starter button only shows when no existing Launch Room data is found.
   - **You already use the old Launch Room:** do **not** use the starter. Follow `docs/MIGRATION.md` first.

## 5. First checks (five minutes)
- Add a brand, save it, reload. Is it still there?
- Create a post, type a caption, reload. Still there?
- Upload a small image, download it, remove it.
- Approve a caption, approve an image, download the PNG. Open it and check the logo and colors.

## AI review: before the first paid test
- The model is `gpt-4o-mini-2024-07-18` at $0.15 / $0.60 per million input/output tokens (`lib/config.js`). I could only confirm these rates from secondary sources, not OpenAI's own pricing page, so please check https://developers.openai.com/api/docs/pricing before your first real review. If the price has changed, update `MODELS` in `lib/config.js`.
- The first real review is a paid test. Use one short caption with no files, then one with a small text file.
- If images are selected, the server reserves cost for them before sending. Images are sent with `detail: "low"`.

## Limits worth knowing
- Uploads are capped at 4 MB per file (Vercel's request size limit). Larger files need a client-upload flow, which is not built.
- Daily and monthly limits cover the whole workspace, shared by all brands.
- There is one password for one owner. Replace it with real sign-in before adding other people.
- Access is checked on every request, including pages and file downloads.

## Local trial without any accounts
```bash
npm install
npm run dev     # http://127.0.0.1:3000, no password, local data in .local-data/
```
Uses an on-disk Postgres (PGlite) and local files. Set `OPENAI_API_KEY` to try AI review (this spends real money).
