// Applies db/migrations/*.sql to DATABASE_URL. Idempotent; creates tables only; never drops or edits legacy data.
import { createDb, migrate } from '../lib/db.js';
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL (e.g. run: vercel env pull .env.local, then export it).'); process.exit(1); }
const db = await createDb(process.env.DATABASE_URL);
const files = await migrate(db);
console.log('Applied (idempotent):', files.join(', '));
