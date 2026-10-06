import fs from 'node:fs';
import path from 'node:path';

// Blob stores share one interface: put(key, bytes, contentType), get(key) -> Buffer|null, del(key).
export function createMemoryBlobs() {
  const map = new Map();
  return { kind: 'memory', map,
    put: async (key, bytes) => { map.set(key, Buffer.from(bytes)); },
    get: async (key) => map.get(key) ?? null,
    del: async (key) => { map.delete(key); },
  };
}

export function createFsBlobs(dir) {
  const file = (key) => path.join(dir, encodeURIComponent(key));
  fs.mkdirSync(dir, { recursive: true });
  return { kind: 'fs',
    put: async (key, bytes) => { fs.writeFileSync(file(key), bytes); },
    get: async (key) => (fs.existsSync(file(key)) ? fs.readFileSync(file(key)) : null),
    del: async (key) => { fs.rmSync(file(key), { force: true }); },
  };
}

// Private Vercel Blob. Not exercised against the live service in the build sandbox.
export async function createVercelBlobs(token) {
  const { put, get, del } = await import('@vercel/blob');
  return { kind: 'vercel-blob',
    put: async (key, bytes, contentType = 'application/octet-stream') => {
      await put(key, Buffer.from(bytes), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType, token });
    },
    get: async (key) => {
      const r = await get(key, { access: 'private', token });
      if (!r || r.statusCode === 404 || !r.stream) return null;
      return Buffer.from(await new Response(r.stream).arrayBuffer());
    },
    del: async (key) => { await del(key, { token }); },
  };
}

// Scripts: BLOB_READ_WRITE_TOKEN -> Vercel Blob; LAUNCH_ROOM_LOCAL_BLOBS=<dir> -> a local folder (rehearsals only); else null.
export async function createBlobsFromEnv(env = process.env) {
  if (env.BLOB_READ_WRITE_TOKEN) return createVercelBlobs(env.BLOB_READ_WRITE_TOKEN);
  if (env.LAUNCH_ROOM_LOCAL_BLOBS) return createFsBlobs(env.LAUNCH_ROOM_LOCAL_BLOBS);
  return null;
}
