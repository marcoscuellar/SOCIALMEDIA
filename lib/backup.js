// Full-workspace backup and restore (database rows). File bytes are handled by scripts/backup.mjs and scripts/restore.mjs.
export const BACKUP_TABLES = ['voice_profiles', 'brands', 'posts', 'post_reviews', 'files', 'excerpts', 'post_events', 'ai_budget', 'ai_runs'];
const ORDER = BACKUP_TABLES; // parents before children

export async function dumpAll(db) {
  const tables = {};
  for (const t of BACKUP_TABLES) tables[t] = await db.query(`SELECT * FROM ${t}`);
  return tables;
}
export async function buildBackup(db) {
  return { format: 'launch-room-backup', version: 2, exportedAt: new Date().toISOString(), note: 'File bytes are not included; each files row lists its blob_key and sha256. Use npm run backup to also download file bytes.', tables: await dumpAll(db) };
}

// Restores into an EMPTY workspace only. Refuses if any brand already exists.
export async function restoreAll(db, backup) {
  if (backup?.format !== 'launch-room-backup' || backup.version !== 2 || !backup.tables) throw new Error('This is not a Launch Room v2 backup.');
  const existing = (await db.query(`SELECT count(*)::int AS n FROM brands`))[0].n;
  if (existing > 0) throw new Error('Refusing to restore: this database already has brands. Restore into a new, empty database (or a Neon branch).');
  const counts = {};
  for (const t of ORDER) {
    const rows = backup.tables[t] || []; counts[t] = rows.length;
    for (const row of rows) {
      const cols = Object.keys(row);
      const ph = cols.map((c, i) => (row[c] !== null && typeof row[c] === 'object' ? `$${i + 1}::jsonb` : `$${i + 1}`));
      const vals = cols.map((c) => (row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]));
      const conflict = t === 'ai_budget' ? ` ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c}=EXCLUDED.${c}`).join(',')}` : '';
      await db.query(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${ph.join(',')})${conflict}`, vals);
    }
  }
  await db.query(`SELECT setval(pg_get_serial_sequence('post_events','id'), COALESCE((SELECT max(id) FROM post_events), 1))`);
  return counts;
}
