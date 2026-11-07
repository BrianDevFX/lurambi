import { z } from 'zod';
import { pool, withActor } from '../db.js';
import { ApiError, json, readJson } from '../http.js';

const entrySchema = z.object({
  client_request_id: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(40).optional().nullable(),
  national_id: z.string().trim().max(40).optional().nullable(),
  ward_filed_id: z.string().uuid(),
  polling_centre_id: z.string().uuid(),
  polling_station_id: z.string().uuid(),
  support_level: z.enum(['strong_supporter','leaning','undecided','opposed','not_reached','not_assessed']),
  issues: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  needs_transport: z.boolean().default(false),
  has_pvc: z.boolean().default(false),
  notes: z.string().max(2000).optional().nullable(),
  consent: z.boolean(),
  not_found_in_register: z.boolean().default(false),
});

const entrySelect = `e.id,e.name,e.phone_e164,e.national_id_masked,e.ward_filed_id,e.polling_centre_id,e.polling_station_id,
  e.support_level,e.issues,e.needs_transport,e.has_pvc,e.notes,e.consent_at,e.consent_text_version,e.verification_status,
  e.flags,e.captured_on,w.name AS ward_name,c.name AS polling_centre_name,s.station_name`;

export async function captureEntry(user, request, response) {
  if (user.role !== 'mobilizer') throw new ApiError(403, 'Mobilizer role required.');
  const parsed = entrySchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, 'Check the entry details.');
  if (!parsed.data.consent) throw new ApiError(400, 'Consent is required to save an entry.', 'CONSENT_REQUIRED');
  const setting = await pool.query("SELECT value FROM public.settings WHERE key='consent_policy'");
  const policy = setting.rows[0]?.value;
  if (!policy?.enabled || !policy.version || !policy.text) throw new ApiError(503, 'Consent wording is not configured.');
  const payload = { ...parsed.data, home_ward_id: user.home_ward_id, consent_text_version: policy.version };
  try {
    const { rows } = await withActor(user.id, (client) => client.query(
      'SELECT app.submit_entry($1::jsonb) AS result', [JSON.stringify(payload)],
    ));
    const result = rows[0].result;
    if (!result.ok && result.duplicate) return json(response, 409, result);
    return json(response, result.idempotent ? 200 : 201, result);
  } catch (error) {
    if (error.code === '42501') throw new ApiError(403, 'Approved mobilizer access is required.');
    if (error.code === '23505') throw new ApiError(409, 'A matching entry already exists.');
    if (error.code === '23514') throw new ApiError(400, error.message === 'Consent is required' ? 'Consent is required to save an entry.' : 'Check the entry details.');
    throw error;
  }
}

export async function searchEntries(user, url, response) {
  if (user.role !== 'mobilizer') throw new ApiError(403, 'Mobilizer role required.');
  const query = (url.searchParams.get('q') || '').trim();
  const digits = query.replace(/\D/g, '');
  if (query.length < 3 && !/^\d{7,8}$/.test(digits)) throw new ApiError(400, 'Enter at least 3 characters or a full ID.');
  const nationalIdQuery=/^\d{7,8}$/.test(digits)?digits:'';
  const { rows } = await pool.query(
    `SELECT ${entrySelect} FROM public.entries e
      JOIN public.wards w ON w.id=e.ward_filed_id
      LEFT JOIN public.polling_centres c ON c.id=e.polling_centre_id
      LEFT JOIN public.polling_stations s ON s.id=e.polling_station_id
     WHERE e.mobilizer_id=$1
       AND (e.name ILIKE $2 OR coalesce(e.phone_e164,'') ILIKE $2
         OR ($3::text <> '' AND e.national_id=$3))
     ORDER BY e.captured_on DESC LIMIT 10`,
    [user.id, `%${query}%`, nationalIdQuery],
  );
  return json(response, 200, { entries: rows });
}

export async function listEntries(user, url, response) {
  const limitValue = Number(url.searchParams.get('limit') || 100);
  const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 200) : 100;
  const params = [];
  let scope = '';
  if (user.role === 'mobilizer') { params.push(user.id); scope = `WHERE e.mobilizer_id=$${params.length}`; }
  else if (user.role === 'ward_coordinator') {
    if (!user.home_ward_id) throw new ApiError(403, 'Coordinator ward is not assigned.');
    params.push(user.home_ward_id); scope = `WHERE e.ward_filed_id=$${params.length}`;
  }
  params.push(limit);
  const result = await pool.query(
    `SELECT ${entrySelect} FROM public.entries e
      JOIN public.wards w ON w.id=e.ward_filed_id
      LEFT JOIN public.polling_centres c ON c.id=e.polling_centre_id
      LEFT JOIN public.polling_stations s ON s.id=e.polling_station_id
      ${scope} ORDER BY e.captured_on DESC LIMIT $${params.length}`,
    params,
  );
  return json(response, 200, { entries: result.rows });
}

export async function listMyEntries(user, _url, response) {
  if (user.role !== 'mobilizer') throw new ApiError(403, 'Mobilizer role required.');
  const result = await pool.query(
    `SELECT ${entrySelect} FROM public.entries e
      JOIN public.wards w ON w.id=e.ward_filed_id
      LEFT JOIN public.polling_centres c ON c.id=e.polling_centre_id
      LEFT JOIN public.polling_stations s ON s.id=e.polling_station_id
     WHERE e.mobilizer_id=$1 ORDER BY e.captured_on DESC LIMIT 200`,
    [user.id],
  );
  return json(response, 200, { entries: result.rows });
}

export async function consentPolicy(_user, _url, response) {
  const { rows } = await pool.query("SELECT value FROM public.settings WHERE key='consent_policy'");
  const policy = rows[0]?.value;
  if (!policy?.enabled) throw new ApiError(503, 'Consent wording is not configured.');
  return json(response, 200, { version: policy.version, text: policy.text });
}
