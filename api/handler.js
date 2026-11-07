import { route } from '../server/router.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  try {
    await route(request, response);
  } catch {
    response.status(500).json({ error: 'Request failed.' });
  }
}
