import { databaseHealth } from './db.js';

const routes = new Map();
const key = (method, path) => `${method.toUpperCase()} ${path}`;
routes.set(key('GET','/api/health'), async (_request,response) => {
  try {
    const db = await databaseHealth();
    response.status(200).json({ ok: true, db });
  } catch {
    response.status(503).json({ ok: false, db: false });
  }
});

export async function route(request,response) {
  const url = new URL(request.url || '/', `https://${request.headers.host || 'localhost'}`);
  const forwardedPath = url.searchParams.get('__route');
  const pathname = forwardedPath
    ? `/api/${forwardedPath.replace(/^\/+/, '')}`
    : url.pathname;
  const handler = routes.get(key(request.method || 'GET',pathname));
  if (!handler) { response.status(404).json({ error: 'Not found.' }); return; }
  await handler(request,response);
}
