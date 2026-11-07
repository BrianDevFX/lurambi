import { pool } from '../db.js';
import { ApiError, json } from '../http.js';

function optionalUuid(value, label) {
  if (value === undefined || value === '') return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, `Invalid ${label}.`);
  }
  return value;
}

export async function listWards(_user, _request, response) {
  const { rows } = await pool.query('SELECT id,name,code FROM public.wards ORDER BY name');
  return json(response, 200, { wards: rows });
}

export async function listCentres(user, url, response) {
  const wardId = optionalUuid(url.searchParams.get('wardId') || '', 'ward ID');
  const params = [];
  let filter = '';
  if (wardId) { params.push(wardId); filter = 'WHERE ward_id=$1'; }
  if (user.role === 'ward_coordinator') {
    if (!user.home_ward_id || (wardId && user.home_ward_id !== wardId)) throw new ApiError(403, 'Role is not permitted.');
    if (!wardId) { params.push(user.home_ward_id); filter = 'WHERE ward_id=$1'; }
  }
  const { rows } = await pool.query(`SELECT id,ward_id,name,code FROM public.polling_centres ${filter} ORDER BY name`, params);
  return json(response, 200, { centres: rows });
}

export async function listStations(user, url, response) {
  const wardId = optionalUuid(url.searchParams.get('wardId') || '', 'ward ID');
  const centreId = optionalUuid(url.searchParams.get('centreId') || '', 'centre ID');
  const conditions = [];
  const params = [];
  if (wardId) { params.push(wardId); conditions.push(`ward_id=$${params.length}`); }
  if (centreId) { params.push(centreId); conditions.push(`polling_centre_id=$${params.length}`); }
  if (user.role === 'ward_coordinator') {
    if (!user.home_ward_id || (wardId && user.home_ward_id !== wardId)) throw new ApiError(403, 'Role is not permitted.');
    if (!wardId) { params.push(user.home_ward_id); conditions.push(`ward_id=$${params.length}`); }
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id,ward_id,polling_centre_id,station_name,station_number FROM public.polling_stations ${where} ORDER BY station_name`,
    params,
  );
  return json(response, 200, { stations: rows });
}
