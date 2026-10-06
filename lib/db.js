import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(here, '..', 'db', 'migrations');

// A db is { query(text, params) -> rows[], close() }.
export async function createNeonDb(url) {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  return { kind: 'neon', query: async (text, params = []) => sql.query(text, params), close: async () => {} };
}

export async function createPgliteDb(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  return {
    kind: 'pglite',
    query: async (text, params = []) => (await pg.query(text, params)).rows,
    close: async () => pg.close(),
  };
}

export function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}
export const splitStatements = (sql) => sql.split(/^-- @@\s*$/m).map((s) => s.trim()).filter(Boolean);

export async function migrate(db) {
  const applied = [];
  for (const file of migrationFiles()) {
    for (const stmt of splitStatements(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))) await db.query(stmt);
    applied.push(file);
  }
  return applied;
}

export async function schemaReady(db) {
  try {
    const rows = await db.query(`SELECT version FROM schema_migrations`);
    const have = new Set(rows.map((r) => r.version));
    return migrationFiles().every((f) => have.has(f.replace(/\.sql$/, '')));
  } catch { return false; }
}

// Plain Postgres over TCP (node-postgres). Used by tests and local tooling to exercise real multi-connection concurrency.
export async function createPgDb(url, { max = 20 } = {}) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max });
  return { kind: 'pg', query: async (text, params = []) => (await pool.query(text, params)).rows, close: async () => pool.end() };
}

// CLI scripts: Neon over HTTP for Neon hosts; plain TCP Postgres (needs the optional "pg" package) for anything else, e.g. a local rehearsal database.
export async function createDb(url) {
  if (/\.neon\.tech|neon\.build/.test(url)) return createNeonDb(url);
  try { return await createPgDb(url, { max: 4 }); } catch { return createNeonDb(url); }
}
