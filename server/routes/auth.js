import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { clearSession, getSessionUser, hashPassword, verifyPassword, writeSession } from '../auth.js';
import { normalizeKenyanPhone, normalizeNationalId } from '../normalisation.js';
import { ApiError, json, readJson } from '../http.js';

const signupSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(32),
  password: z.string().min(12).max(128),
  national_id: z.string().trim().regex(/^\d{7,8}$/),
  home_ward_id: z.string().uuid(),
  home_polling_station_id: z.string().uuid().optional().nullable(),
});
const loginSchema = z.object({ phone: z.string().trim().min(8).max(80), password: z.string().min(1).max(128) });

function userView(user) {
  return {
    id: user.id,
    phone: user.phone,
    full_name: user.full_name,
    national_id_masked: user.national_id_masked,
    role: user.role,
    status: user.status,
    home_ward_id: user.home_ward_id,
    home_polling_station_id: user.home_polling_station_id,
    referral_code: user.referral_code,
  };
}

export async function signupLocations(_request, response) {
  const [wards, centres, stations] = await Promise.all([
    pool.query('SELECT id,name,code FROM public.wards ORDER BY name'),
    pool.query('SELECT id,ward_id,name FROM public.polling_centres ORDER BY name'),
    pool.query('SELECT id,ward_id,polling_centre_id,station_name,station_number FROM public.polling_stations ORDER BY station_name'),
  ]);
  return json(response, 200, { wards: wards.rows, centres: centres.rows, stations: stations.rows });
}

export async function signup(request, response) {
  const body = await readJson(request);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'Check the registration details.');
  const input = parsed.data;
  const phone = normalizeKenyanPhone(input.phone);
  if (!phone) throw new ApiError(400, 'Enter a valid Kenyan mobile number.');
  const nationalId = normalizeNationalId(input.national_id);
  if (!nationalId) throw new ApiError(400, 'National ID must have 7 or 8 digits.');
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await withTransaction(async (client) => {
      if (input.home_polling_station_id) {
        const station = await client.query(
          'SELECT 1 FROM public.polling_stations WHERE id=$1 AND ward_id=$2',
          [input.home_polling_station_id, input.home_ward_id],
        );
        if (!station.rowCount) throw new ApiError(400, 'Choose a station in the selected ward.');
      }
      const result = await client.query(
        `INSERT INTO public.users(phone,password_hash,full_name,national_id,national_id_masked,role,status,home_ward_id,home_polling_station_id)
         VALUES ($1,$2,$3,$4,$5,'mobilizer','pending',$6,$7)
         RETURNING id,phone,full_name,national_id_masked,role,status,home_ward_id,home_polling_station_id,referral_code`,
        [phone, passwordHash, input.full_name, nationalId.value, nationalId.masked, input.home_ward_id, input.home_polling_station_id || null],
      );
      return result.rows[0];
    });
    await writeSession(response, user);
    return json(response, 201, { user: userView(user) });
  } catch (error) {
    if (error.code === '23505') throw new ApiError(409, 'An account already uses that phone or ID.');
    throw error;
  }
}

export async function login(request, response) {
  const body = await readJson(request);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'Enter your phone number and password.');
  const normalized = normalizeKenyanPhone(parsed.data.phone);
  if (!normalized) throw new ApiError(401, 'Phone number or password is incorrect.');
  const { rows } = await pool.query(
    `SELECT id,phone,password_hash,full_name,national_id_masked,role,status,home_ward_id,home_polling_station_id,referral_code
       FROM public.users WHERE phone=$1`,
    [normalized],
  );
  const user = rows[0];
  if (!user?.password_hash || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    throw new ApiError(401, 'Phone number or password is incorrect.');
  }
  await writeSession(response, user);
  return json(response, 200, { user: userView(user) });
}

export async function logout(_request, response) {
  clearSession(response);
  return json(response, 200, { ok: true });
}

export async function me(request, response) {
  const user = await getSessionUser(request, pool);
  if (!user) throw new ApiError(401, 'Sign in required.');
  return json(response, 200, { user: userView(user) });
}
