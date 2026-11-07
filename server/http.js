export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(response, status, body) {
  return response.status(status).json(body);
}

export async function readJson(request) {
  if (request.body !== undefined) {
    if (typeof request.body === 'object' && request.body !== null && !Buffer.isBuffer(request.body)) return request.body;
    const rawBody = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : String(request.body);
    if (!rawBody.trim()) return {};
    try { return JSON.parse(rawBody); } catch { throw new ApiError(400, 'Invalid JSON body.'); }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new ApiError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'Invalid JSON body.'); }
}

export function queryObject(url) {
  return Object.fromEntries(url.searchParams.entries());
}
