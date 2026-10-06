import { createApp } from '../lib/app.js';
import { createNeonDb } from '../lib/db.js';
import { createVercelBlobs } from '../lib/blobs.js';
import { toNodeHandler } from '../lib/node.js';

let appPromise;
async function getApp() {
  appPromise ||= (async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    const db = await createNeonDb(process.env.DATABASE_URL);
    const blobs = process.env.BLOB_READ_WRITE_TOKEN ? await createVercelBlobs(process.env.BLOB_READ_WRITE_TOKEN) : null;
    return createApp({ db, blobs, env: process.env });
  })().catch((e) => { appPromise = undefined; throw e; });
  return appPromise;
}
export default toNodeHandler(getApp);
