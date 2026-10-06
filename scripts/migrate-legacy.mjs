// Migrates the previous single-workspace NÈNÈMI Launch Room into the first brand profile.
// SAFE BY DEFAULT: dry run unless --apply --confirm. Never modifies or deletes legacy rows or blobs.
//   DATABASE_URL=... [BLOB_READ_WRITE_TOKEN=...] node scripts/migrate-legacy.mjs [--source=db|file|seed] [--file=backup.json] [--apply --confirm]
import fs from 'node:fs';
import { createDb, migrate, schemaReady } from '../lib/db.js';
import { createBlobsFromEnv } from '../lib/blobs.js';
import { readLegacyState, planMigration, applyMigration } from '../lib/legacy.js';
import { readSeedPosts } from '../lib/seed.js';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const has = (n) => process.argv.includes(`--${n}`);
const source = arg('source') || 'db';
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL.'); process.exit(1); }
const db = await createDb(process.env.DATABASE_URL);
const apply = has('apply') && has('confirm');
if (has('apply') && !has('confirm')) { console.error('--apply needs --confirm. Nothing was changed.'); process.exit(1); }

let state, ledger = null;
if (source === 'db') { const r = await readLegacyState(db); state = r.state; ledger = r.ledger; if (!state) { console.error('No legacy workspace row (id=marcos) found in launch_workspace.'); process.exit(1); } console.log(`Read legacy workspace (revision ${r.revision}).`); }
else if (source === 'file') { state = JSON.parse(fs.readFileSync(arg('file'), 'utf8')); console.log(`Read ${arg('file')}.`); }
else if (source === 'seed') { state = readSeedPosts(); console.log('Using the bundled original seed drafts (no live data).'); }
else { console.error('Unknown --source'); process.exit(1); }

let existing = new Set();
if (await schemaReady(db)) existing = new Set((await db.query(`SELECT legacy_id FROM posts WHERE legacy_id IS NOT NULL`)).map((r) => r.legacy_id));
const plan = planMigration(state, existing);
console.log('Plan:', plan);
if (plan.problems.length) { console.error('Problems:', plan.problems); process.exit(1); }
if (!apply) { console.log('\nDRY RUN: nothing was written. Review the plan, take a backup (npm run backup), then re-run with --apply --confirm.'); process.exit(0); }
await migrate(db); // creates the new tables only
const blobs = await createBlobsFromEnv();
if (!blobs) { console.error('BLOB_READ_WRITE_TOKEN is required to upload the NÈNÈMI logo and verify attachments.'); process.exit(1); }
const result = await applyMigration(db, blobs, state, { ledger: source === 'db' ? ledger : null, log: console.log, timeZone: process.env.LAUNCH_ROOM_TIMEZONE || 'America/Chicago' });
console.log('Migrated:', result);
const after = (await db.query(`SELECT count(*)::int AS n FROM posts WHERE brand_id='brand_nenemi'`))[0].n;
console.log(`Verification: ${after} posts now in the NÈNÈMI brand (legacy had ${plan.posts}).`);
if (result.filesUnverified.length) console.log('Attachments whose bytes could not be read to verify (kept, flagged):', result.filesUnverified);
