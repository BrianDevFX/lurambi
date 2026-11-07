import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

const cookieName = 'lurambi_session';
const lifetimeSeconds = 12 * 60 * 60;

function jwtKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters.');
  return new TextEncoder().encode(secret);
}

export const hashPassword = (password) => bcrypt.hash(password, 12);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

export async function signSession(user) {
  return new SignJWT({ role: user.role, status: user.status, ward_id: user.home_ward_id || null })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuedAt().setExpirationTime(`${lifetimeSeconds}s`).sign(jwtKey());
}

export async function readSession(request) {
  const cookieHeader = request.headers.cookie || '';
  const token = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(decodeURIComponent(token), jwtKey(), { algorithms: ['HS256'] });
    if (!payload.sub || !['admin','ward_coordinator','mobilizer'].includes(payload.role)) return null;
    return { id: payload.sub, role: payload.role, status: payload.status, home_ward_id: payload.ward_id || null };
  } catch { return null; }
}

export async function writeSession(response, user) {
  const token = await signSession(user);
  response.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${lifetimeSeconds}`);
}

export function clearSession(response) {
  response.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

export async function requireRole(request, roles = []) {
  const user = await readSession(request);
  if (!user) { const error = new Error('Sign in required.'); error.status = 401; throw error; }
  if (user.status !== 'approved') { const error = new Error('Account is not approved.'); error.status = 403; throw error; }
  if (roles.length && !roles.includes(user.role)) { const error = new Error('Role is not permitted.'); error.status = 403; throw error; }
  return user;
}

export { cookieName, lifetimeSeconds };
