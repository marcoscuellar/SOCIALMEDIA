# Moving your existing NÈNÈMI Launch Room into the multi-brand version

TLDR: the migration **copies** your old data into a new NÈNÈMI brand. It never edits or deletes the old data. You back up first, rehearse on a copy, then run it once. Nothing in this package runs it for you.

## What "your data" is
The old app kept everything in one database row (`launch_workspace`, id `marcos`): your drafts, approvals, posting checkmarks, return note and attachment references. Attachment files sit in your private Vercel Blob store under `post-files/<id>`. It also kept AI usage in a second row (`ai-cost-v1`).

The ZIP you gave me only has the starter content, not this live data. I have not seen or touched your live database.

## What the migration does
- Creates the **NÈNÈMI** brand with its colors, fonts, logo, voice, facts and claims-to-verify.
- Creates your **Marcos founder voice** as a separate, reusable profile.
- Copies each post: caption text (including your live edits), date, title, approvals, image approval, LinkedIn/Instagram posted status (separately), paused state, and notes.
- Posts keep working as before; the old "Both voices" behavior becomes "Both" on each post.
- Attachments: the new database points at the **same** blob files. Bytes are not copied, moved or deleted. Each file's hash is recorded so tampering is detectable.
- Old AI reviews are kept but show **"needs refresh"** because the voice rules changed. Old "previous wording" text is saved into the post's notes so nothing is lost.
- Posted checkmarks get the migration time as their date (the old app didn't record when).
- This month's AI usage carries over so the $5 / 10-per-day limits aren't reset by migrating mid-month.
- It is **idempotent**: running it again adds nothing and never overwrites a post you edited afterward.

What it does not do: copy the old app's `Export backup` JSON into attachments (that file holds references only), or import Cloudflare/D1 data.

## Safe path
1. **Back up.** Neon: create a *branch* of your production database (Neon console → Branches → Create branch). Also run the app backup:
   ```bash
   export DATABASE_URL=...  BLOB_READ_WRITE_TOKEN=...      # from vercel env pull
   npm run backup -- --out=backups/before-migration
   ```
   This writes every table as JSON plus every attachment's bytes, and a manifest of hashes. Keep this folder.
2. **Also download the old app's own backup**: old app → October plan → Export backup. (Belt and braces.)
3. **Create the new tables** on the *branch* first: `DATABASE_URL=<branch url> npm run db:migrate`.
4. **Dry run on the branch** (prints counts, writes nothing):
   ```bash
   DATABASE_URL=<branch url> npm run legacy:migrate
   ```
   Check: post count (should be 21 plus any you added), approved, posted and attachment counts match what you expect.
5. **Rehearse for real on the branch**:
   ```bash
   DATABASE_URL=<branch url> BLOB_READ_WRITE_TOKEN=... npm run legacy:migrate -- --apply --confirm
   ```
   Deploy a Vercel preview pointed at the branch and look: NÈNÈMI brand, your drafts, approvals, attachments open and download.
6. **Repeat steps 3 and 5 on production** only when the rehearsal looks right. `--apply` without `--confirm` refuses to run.
7. Keep the old deployment and old table for a few weeks. Rolling back is "stop using the new site"; nothing old was changed.

If you can't reach the database from your computer, export the old app's backup JSON and use:
`npm run legacy:migrate -- --source=file --file=NENEMI-launch-room-backup.json` (attachments are then only linked if their blobs are in the same store).

## Verify afterward
- NÈNÈMI shows the expected number of posts; spot-check three you edited.
- Posted/approved states match.
- Open an attachment and download it.
- "My voice" shows your founder voice; Brand shows NÈNÈMI's profile; Files lists the logo and the App Store email.

## Backup and restore (ongoing)
- **Quick copy:** Plan → Export backup downloads all brands as JSON (no file bytes).
- **Full backup:** `npm run backup` as above (database + file bytes). Run it before any big change.
- **Restore** into a new, empty database or Neon branch only:
  ```bash
  DATABASE_URL=<empty db> BLOB_READ_WRITE_TOKEN=... npm run restore -- --from=backups/<folder>            # dry run
  DATABASE_URL=<empty db> BLOB_READ_WRITE_TOKEN=... npm run restore -- --from=backups/<folder> --confirm
  ```
  It refuses to run if the target already has brands, and checks each file's hash before uploading it.
- Neon also keeps point-in-time history on paid plans and lets you branch from a past moment: the best "undo" for a bad day.

## What was and wasn't rehearsed
Tested here: the whole sequence (backup → dry run → apply → apply again → backup → restore into an empty database) on a throwaway local Postgres 16 server built from the seed drafts plus invented statuses and attachments. **Not** tested: your real database, the live Neon driver, the live Vercel Blob store.
