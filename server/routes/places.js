import { pool, withTransaction } from '../db.js';
import { z } from 'zod';
import { ApiError, json, readJson } from '../http.js';

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

const centreSchema = z.object({ ward_id: z.string().uuid(), name: z.string().trim().min(2).max(180), code: z.string().trim().max(40).optional().nullable(), reason: z.string().trim().min(3).max(500) });
const stationSchema = z.object({ polling_centre_id: z.string().uuid(), station_name: z.string().trim().min(2).max(180), station_number: z.coerce.number().int().positive(), reason: z.string().trim().min(3).max(500) });

async function writePlaceAudit(client, user, action, type, id, values, reason, oldValues = null) {
  await client.query(
    'INSERT INTO public.audit_log(user_id,user_role,action,entity_type,entity_id,old_values,new_values,reason) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)',
    [user.id,user.role,action,type,id,oldValues===null?null:JSON.stringify(oldValues),JSON.stringify(values),reason],
  );
}

export async function createCentre(user, request, response) {
  const parsed = centreSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, 'Choose a ward, enter a valid polling centre name and give a reason.');
  const result = await withTransaction(async(client) => {
    const {rows}=await client.query('INSERT INTO public.polling_centres(ward_id,name,code,synthetic) VALUES($1,$2,$3,false) RETURNING id,ward_id,name,code',[parsed.data.ward_id,parsed.data.name,parsed.data.code||null]);
    await writePlaceAudit(client,user,'create','polling_centre',rows[0].id,rows[0],parsed.data.reason);
    return rows[0];
  });
  return json(response, 201, { centre: result });
}

export async function renameCentre(user, id, request, response) {
  const parsed = z.object({ name: z.string().trim().min(2).max(180), reason: z.string().trim().min(3).max(500) }).safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, 'Enter a valid centre name and give a reason.');
  const result = await withTransaction(async(client) => {
    const previous=await client.query('SELECT id,ward_id,name,code FROM public.polling_centres WHERE id=$1 FOR UPDATE',[id]);
    if(!previous.rowCount)throw new ApiError(404,'Polling centre not found.');
    const {rows}=await client.query('UPDATE public.polling_centres SET name=$1,synthetic=false,updated_at=now() WHERE id=$2 RETURNING id,ward_id,name,code',[parsed.data.name,id]);
    await writePlaceAudit(client,user,'update','polling_centre',id,rows[0],parsed.data.reason,previous.rows[0]);
    return rows[0];
  });
  return json(response, 200, { centre: result });
}

export async function createStation(user, request, response) {
  const parsed = stationSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, 'Choose a centre, enter a valid station name and number, and give a reason.');
  const result = await withTransaction(async(client) => {
    const {rows}=await client.query('INSERT INTO public.polling_stations(polling_centre_id,ward_id,station_name,station_number,synthetic) SELECT c.id,c.ward_id,$2,$3,false FROM public.polling_centres c WHERE c.id=$1 RETURNING id,ward_id,polling_centre_id,station_name,station_number',[parsed.data.polling_centre_id,parsed.data.station_name,parsed.data.station_number]);
    if(!rows.length)throw new ApiError(404,'Polling centre not found.');
    await writePlaceAudit(client,user,'create','polling_station',rows[0].id,rows[0],parsed.data.reason);
    return rows[0];
  });
  return json(response, 201, { station: result });
}

export async function renameStation(user, id, request, response) {
  const parsed = z.object({ station_name: z.string().trim().min(2).max(180), station_number: z.coerce.number().int().positive(), reason: z.string().trim().min(3).max(500) }).safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, 'Enter a valid station name and number and give a reason.');
  const result = await withTransaction(async(client) => {
    const previous=await client.query('SELECT id,ward_id,polling_centre_id,station_name,station_number FROM public.polling_stations WHERE id=$1 FOR UPDATE',[id]);
    if(!previous.rowCount)throw new ApiError(404,'Polling station not found.');
    const {rows}=await client.query('UPDATE public.polling_stations SET station_name=$1,station_number=$2,synthetic=false,updated_at=now() WHERE id=$3 RETURNING id,ward_id,polling_centre_id,station_name,station_number',[parsed.data.station_name,parsed.data.station_number,id]);
    await writePlaceAudit(client,user,'update','polling_station',id,rows[0],parsed.data.reason,previous.rows[0]);
    return rows[0];
  });
  return json(response, 200, { station: result });
}
