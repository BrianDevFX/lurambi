import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { pool, withActor } from '../db.js';
import { hashPassword, requireRoles } from '../auth.js';
import { ApiError, json, readJson } from '../http.js';

const homeWardSchema = z.object({ home_ward_id: z.string().uuid() });

export async function updateOwnHomeWard(user, request, response) {
  requireRoles(user, ['mobilizer']);
  const parsed = homeWardSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, 'Choose a valid home ward.');
  const { rows } = await pool.query(
    `UPDATE public.users AS u
        SET home_ward_id=w.id, home_polling_station_id=NULL, updated_at=now()
       FROM public.wards AS w
      WHERE u.id=$1 AND w.id=$2 AND u.role='mobilizer'
      RETURNING u.home_ward_id`,
    [user.id, parsed.data.home_ward_id],
  );
  if (!rows[0]) throw new ApiError(400, 'Choose a valid home ward.');
  return json(response, 200, { user: { id: user.id, home_ward_id: rows[0].home_ward_id } });
}

const passwordSchema = z.object({ password: z.string().min(12).max(128) });
const referralAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function newReferralCode() {
  return Array.from({ length: 6 }, () => referralAlphabet[randomInt(referralAlphabet.length)]).join('');
}

export async function pendingUsers(user, _request, response) {
  if (!['admin', 'ward_coordinator'].includes(user.role)) throw new ApiError(403, 'Role is not permitted.');
  const params = [];
  let scope = '';
  if (user.role === 'ward_coordinator') {
    if (!user.home_ward_id) throw new ApiError(403, 'Coordinator ward is not assigned.');
    params.push(user.home_ward_id);
    scope = ' AND u.home_ward_id = $1';
  }
  const { rows } = await pool.query(
    `SELECT u.id,u.full_name,u.phone,u.national_id_masked,u.role,u.status,u.home_ward_id,w.name AS home_ward_name,u.created_at
       FROM public.users u LEFT JOIN public.wards w ON w.id=u.home_ward_id
      WHERE u.role='mobilizer' AND u.status='pending'${scope} ORDER BY u.created_at`,
    params,
  );
  return json(response, 200, { users: rows });
}

export async function listUsers(user, url, response) {
  if (!['admin', 'ward_coordinator'].includes(user.role)) throw new ApiError(403, 'Role is not permitted.');
  const requestedStatus = url.searchParams.get('status');
  if (requestedStatus && !['pending','approved','suspended'].includes(requestedStatus)) throw new ApiError(400, 'Invalid status filter.');
  const conditions = ["u.role='mobilizer'"];
  const params = [];
  if (requestedStatus) { params.push(requestedStatus); conditions.push(`u.status=$${params.length}`); }
  if (user.role === 'ward_coordinator') {
    if (!user.home_ward_id) throw new ApiError(403, 'Coordinator ward is not assigned.');
    params.push(user.home_ward_id); conditions.push(`u.home_ward_id=$${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT u.id,u.full_name,u.phone,u.national_id_masked,u.role,u.status,u.home_ward_id,w.name AS home_ward_name,u.referral_code,u.created_at
       FROM public.users u LEFT JOIN public.wards w ON w.id=u.home_ward_id
      WHERE ${conditions.join(' AND ')} ORDER BY u.created_at DESC LIMIT 300`,
    params,
  );
  return json(response, 200, { users: rows });
}

export async function approveUser(user, targetId, _request, response) {
  if (!['admin', 'ward_coordinator'].includes(user.role)) throw new ApiError(403, 'Role is not permitted.');
  if (!z.string().uuid().safeParse(targetId).success) throw new ApiError(400, 'Invalid user ID.');
  let result;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = newReferralCode();
    try {
      result = await withActor(user.id, (client) => client.query(
        'SELECT app.approve_mobilizer($1::uuid,$2::char(6)) AS user', [targetId, code],
      ));
      break;
    } catch (error) {
      if (error.code !== '23505' || attempt === 3) throw error;
    }
  }
  return json(response, 200, { user: result.rows[0].user });
}

export async function suspendUser(user, targetId, _request, response) {
  if (!['admin', 'ward_coordinator'].includes(user.role)) throw new ApiError(403, 'Role is not permitted.');
  if (!z.string().uuid().safeParse(targetId).success) throw new ApiError(400, 'Invalid user ID.');
  const result = await withActor(user.id, (client) => client.query(
    'SELECT app.suspend_mobilizer($1::uuid) AS user', [targetId],
  ));
  return json(response, 200, { user: result.rows[0].user });
}

export async function resetPassword(user, targetId, request, response) {
  if (user.role !== 'admin') throw new ApiError(403, 'Admin role required.');
  if (!z.string().uuid().safeParse(targetId).success) throw new ApiError(400, 'Invalid user ID.');
  const parsed = passwordSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, 'Password must be at least 12 characters.');
  const passwordHash = await hashPassword(parsed.data.password);
  const { rowCount } = await pool.query(
    "UPDATE public.users SET password_hash=$1,updated_at=now() WHERE id=$2 AND role='mobilizer'",
    [passwordHash, targetId],
  );
  if (!rowCount) throw new ApiError(404, 'Mobilizer was not found.');
  return json(response, 200, { ok: true });
}
