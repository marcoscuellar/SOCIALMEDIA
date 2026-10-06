// Full backup: every table as JSON plus the bytes of every stored file. Read-only.
//   DATABASE_URL=... [BLOB_READ_WRITE_TOKEN=...] node scripts/backup.mjs [--out=backups/<name>]
// Also saves the previous-version workspace rows (launch_workspace) and its attachments if present.
import fs from 'node:fs';
import path from 'node:path';
import { createDb } from '../lib/db.js';
import { createBlobsFromEnv } from '../lib/blobs.js';
import { dumpAll } from '../lib/backup.js';
import { sha256 } from '../lib/util.js';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL.'); process.exit(1); }
const out = arg('out') || path.join('backups', 'launch-room-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(path.join(out, 'files'), { recursive: true });
const db = await createDb(process.env.DATABASE_URL);
const blobs = await createBlobsFromEnv();
const manifest = { files: [], missing: [] };
let tables = {};
try { tables = await dumpAll(db); } catch { console.log('No new-schema tables yet (nothing to dump there).'); }
fs.writeFileSync(path.join(out, 'db.json'), JSON.stringify({ format: 'launch-room-backup', version: 2, exportedAt: new Date().toISOString(), tables }, null, 2));
let legacy = [];
try { legacy = await db.query('SELECT id, payload, revision FROM launch_workspace'); fs.writeFileSync(path.join(out, 'legacy-launch_workspace.json'), JSON.stringify(legacy, null, 2)); } catch { /* no legacy table */ }
const keys = new Set((tables.files || []).map((f) => f.blob_key));
for (const r of legacy) if (r.id === 'marcos') for (const p of JSON.parse(r.payload).posts || []) for (const f of p.attachments || []) keys.add('post-files/' + f.id);
if (!blobs && keys.size) console.log(`BLOB_READ_WRITE_TOKEN not set: ${keys.size} file(s) not downloaded.`);
for (const key of blobs ? keys : []) {
  const bytes = await blobs.get(key);
  if (!bytes) { manifest.missing.push(key); continue; }
  const dest = path.join(out, 'files', encodeURIComponent(key)); fs.writeFileSync(dest, bytes);
  manifest.files.push({ key, size: bytes.length, sha256: sha256(bytes) });
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Backup written to ${out}: ${Object.values(tables).reduce((n, r) => n + r.length, 0)} rows, ${manifest.files.length} files, ${manifest.missing.length} missing, ${legacy.length} legacy rows.`);
if (manifest.missing.length) console.log('Missing blobs:', manifest.missing.join(', '));
