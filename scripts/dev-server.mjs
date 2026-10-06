// Local server. Uses DATABASE_URL (Neon/Postgres over HTTP) if set; otherwise an on-disk PGlite database
// in .local-data/ and file blobs, so you can try everything without any accounts.
import http from 'node:http';
import path from 'node:path';
import { createApp } from '../lib/app.js';
import { createNeonDb, createPgliteDb, migrate } from '../lib/db.js';
import { createFsBlobs, createVercelBlobs } from '../lib/blobs.js';
import { toNodeHandler } from '../lib/node.js';

export async function startServer({ port = 3000, dataDir, env = process.env, fetcher, clock, memory = false } = {}) {
  const db = env.DATABASE_URL && !memory ? await createNeonDb(env.DATABASE_URL) : await createPgliteDb(memory ? undefined : path.join(dataDir || '.local-data', 'pg'));
  if (db.kind === 'pglite') await migrate(db);
  const blobs = env.BLOB_READ_WRITE_TOKEN && !memory ? await createVercelBlobs(env.BLOB_READ_WRITE_TOKEN) : createFsBlobs(path.join(dataDir || '.local-data', 'blobs'));
  const app = createApp({ db, blobs, env, fetcher, clock });
  const server = http.createServer(toNodeHandler(async () => app));
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, app, db, blobs, port: server.address().port, close: async () => { await new Promise((r) => server.close(r)); await db.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = { LAUNCH_ROOM_ALLOW_NO_PASSWORD: '1', ...process.env };
  const s = await startServer({ port: Number(process.env.PORT || 3000), env });
  console.log(`Launch Room (local, no password) at http://127.0.0.1:${s.port}`);
}
