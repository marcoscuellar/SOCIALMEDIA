// Restore a backup made by scripts/backup.mjs into an EMPTY database (e.g. a new Neon branch).
//   DATABASE_URL=... [BLOB_READ_WRITE_TOKEN=...] node scripts/restore.mjs --from=backups/<name> --confirm
// Refuses to run if the target already has brands. Re-uploads file bytes under their original keys.
import fs from 'node:fs';
import path from 'node:path';
import { createDb, migrate } from '../lib/db.js';
import { createBlobsFromEnv } from '../lib/blobs.js';
import { restoreAll } from '../lib/backup.js';
import { sha256 } from '../lib/util.js';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const from = arg('from');
if (!from || !process.env.DATABASE_URL) { console.error('Usage: DATABASE_URL=... node scripts/restore.mjs --from=<backup dir> --confirm'); process.exit(1); }
const backup = JSON.parse(fs.readFileSync(path.join(from, 'db.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(from, 'manifest.json'), 'utf8'));
if (!process.argv.includes('--confirm')) {
  console.log(`DRY RUN. Would restore ${Object.entries(backup.tables).map(([t, r]) => `${t}:${r.length}`).join(' ')} and ${manifest.files.length} file(s). Re-run with --confirm.`); process.exit(0);
}
const db = await createDb(process.env.DATABASE_URL);
await migrate(db);
const counts = await restoreAll(db, backup);
console.log('Rows restored:', counts);
const blobs = await createBlobsFromEnv();
if (blobs) {
  for (const f of manifest.files) {
    const bytes = fs.readFileSync(path.join(from, 'files', encodeURIComponent(f.key)));
    if (sha256(bytes) !== f.sha256) throw new Error('Backup file is corrupted: ' + f.key);
    await blobs.put(f.key, bytes);
  }
  console.log(`Restored ${manifest.files.length} file(s).`);
} else if (manifest.files.length) console.log('BLOB_READ_WRITE_TOKEN not set: file bytes were not restored.');
