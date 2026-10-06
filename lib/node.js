// Adapts the runtime-agnostic app to Node's (req, res), used by Vercel and the local server.
const MAX_BODY = LIMIT();
function LIMIT() { return 4 * 1024 * 1024 + 4096; }

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return Buffer.alloc(0);
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object' && !req.readable) return Buffer.from(JSON.stringify(req.body));
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) { const e = new Error('too large'); e.tooLarge = true; throw e; } chunks.push(c); }
  return Buffer.concat(chunks);
}

export function toNodeHandler(getApp) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      let p = url.pathname;
      if (url.searchParams.has('path')) { // Vercel rewrite: /api/index?path=<original path>
        p = '/' + url.searchParams.getAll('path').join('/').replace(/^\/+/, ''); url.searchParams.delete('path');
      }
      const query = Object.fromEntries(url.searchParams);
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : v]));
      let body; try { body = await readBody(req); } catch (e) { if (e.tooLarge) { res.statusCode = 413; return res.end('Request too large'); } throw e; }
      const app = await getApp();
      const out = await app.handle({ method: req.method, path: p, query, headers, body });
      res.statusCode = out.status;
      for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
      res.end(req.method === 'HEAD' ? undefined : out.body);
    } catch (e) {
      console.error('Launch Room startup/request failure', e?.name, e?.message);
      res.statusCode = 503; res.setHeader('Cache-Control', 'private, no-store');
      res.end('Your room is temporarily unavailable. Please try again.');
    }
  };
}
