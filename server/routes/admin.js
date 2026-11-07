import { z } from 'zod';
import { pool, withActor } from '../db.js';
import { ApiError, json, readJson } from '../http.js';

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500), patch: z.record(z.string(), z.unknown()) });
const verificationSchema = z.object({ status: z.enum(['unverified','verified','not_found','wrong_constituency','pending_id']), note: z.string().trim().min(2).max(1000) });

export async function flags(_user,url,response) {
  const unresolved = url.searchParams.get('resolved') !== 'true';
  const { rows } = await pool.query(`SELECT f.id,f.entry_id,f.flag_code,f.severity,f.details,f.is_resolved,f.created_at,e.name,e.national_id_masked,e.ward_filed_id,w.name AS ward_name,c.name AS centre_name
    FROM public.flag_events f JOIN public.entries e ON e.id=f.entry_id JOIN public.wards w ON w.id=e.ward_filed_id LEFT JOIN public.polling_centres c ON c.id=e.polling_centre_id
    WHERE f.is_resolved=$1 ORDER BY f.created_at DESC LIMIT 500`,[!unresolved]);
  return json(response,200,{flags:rows});
}

export async function resolveFlag(user,id,request,response) {
  const body = await readJson(request);
  const parsed = z.object({ resolution:z.enum(['resolve','dismiss','merge']), notes:z.string().max(1000).optional() }).safeParse(body);
  if (!parsed.success) throw new ApiError(400,'Choose a valid flag action.');
  await withActor(user.id,(client)=>client.query('SELECT app.resolve_flag($1::uuid,$2,$3)',[id,parsed.data.resolution,parsed.data.notes || '']));
  return json(response,200,{ok:true});
}

export async function updateEntry(user,id,request,response) {
  const parsed = reasonSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400,'A reason and valid entry changes are required.');
  const allowed = ['name','phone_e164','ward_filed_id','polling_centre_id','polling_station_id','support_level','notes'];
  const patch = Object.fromEntries(Object.entries(parsed.data.patch).filter(([key])=>allowed.includes(key)));
  if (!Object.keys(patch).length) throw new ApiError(400,'No editable fields were provided.');
  const { rows } = await withActor(user.id,(client)=>client.query('SELECT app.admin_update_entry($1::uuid,$2::jsonb,$3) AS entry',[id,JSON.stringify(patch),parsed.data.reason]));
  return json(response,200,{entry:rows[0].entry});
}

export async function verificationQueue(_user,url,response) {
  const { rows } = await pool.query(`SELECT e.id,e.name,e.national_id_masked,e.verification_status,e.ward_filed_id,w.name AS ward_name,
    c.id AS polling_centre_id,c.name AS centre_name,s.station_name FROM public.entries e JOIN public.wards w ON w.id=e.ward_filed_id
    LEFT JOIN public.polling_centres c ON c.id=e.polling_centre_id LEFT JOIN public.polling_stations s ON s.id=e.polling_station_id
    WHERE ($1::text IS NULL OR e.verification_status=$1) ORDER BY w.name,c.name,e.name LIMIT 1000`,[url.searchParams.get('status') || null]);
  return json(response,200,{entries:rows});
}

export async function setVerification(user,id,request,response) {
  const parsed=verificationSchema.safeParse(await readJson(request));
  if(!parsed.success) throw new ApiError(400,'Choose a status and include an evidence note.');
  await withActor(user.id,(client)=>client.query('SELECT app.set_entry_verification($1::uuid,$2,$3)',[id,parsed.data.status,parsed.data.note]));
  return json(response,200,{ok:true});
}

export async function bulkVerification(user,request,response){
  const parsed=z.object({items:z.array(z.object({id:z.string().uuid(),status:z.enum(['unverified','verified','not_found','wrong_constituency','pending_id']),note:z.string().trim().min(2).max(1000)})).min(1).max(500)}).safeParse(await readJson(request));
  if(!parsed.success)throw new ApiError(400,'Send up to 500 valid verification updates.');
  await withActor(user.id,async(client)=>{for(const item of parsed.data.items)await client.query('SELECT app.set_entry_verification($1::uuid,$2,$3)',[item.id,item.status,item.note]);});
  return json(response,200,{updated:parsed.data.items.length});
}

export async function contacts(user,url,response){
  const {rows}=await pool.query(`SELECT id,type,name,phone_e164,denomination,community_unit,ward_id,polling_station_id,reach_status,notes,exclude_from_campaign_exports FROM public.network_contacts WHERE ($1::text IS NULL OR type=$1) ORDER BY name LIMIT 1000`,[url.searchParams.get('type')||null]);
  return json(response,200,{contacts:rows});
}

export async function updateContact(user,id,request,response){
  const parsed=z.object({ward_id:z.string().uuid().nullable().optional(),polling_station_id:z.string().uuid().nullable().optional(),reach_status:z.enum(['not_contacted','contacted','meeting_held']).optional(),notes:z.string().max(1000).nullable().optional(),exclude_from_campaign_exports:z.boolean().optional()}).safeParse(await readJson(request));
  if(!parsed.success||!Object.keys(parsed.data||{}).length)throw new ApiError(400,'Invalid contact changes.');
  const {rows}=await pool.query(`UPDATE public.network_contacts SET ward_id=coalesce($1,ward_id),polling_station_id=coalesce($2,polling_station_id),reach_status=coalesce($3,reach_status),notes=coalesce($4,notes),exclude_from_campaign_exports=coalesce($5,exclude_from_campaign_exports),updated_at=now() WHERE id=$6 RETURNING id,type,name,ward_id,reach_status,notes,exclude_from_campaign_exports`,[parsed.data.ward_id??null,parsed.data.polling_station_id??null,parsed.data.reach_status??null,parsed.data.notes??null,parsed.data.exclude_from_campaign_exports??null,id]);
  if(!rows.length)throw new ApiError(404,'Contact not found.');
  await pool.query(`INSERT INTO public.audit_log(user_id,user_role,action,entity_type,entity_id,new_values,reason) VALUES($1,$2,'update','network_contact',$3,$4::jsonb,'Contact assignment or reach status changed')`,[user.id,user.role,id,JSON.stringify(parsed.data)]);
  return json(response,200,{contact:rows[0]});
}

export async function auditLog(_user,url,response) {
  const { rows }=await pool.query(`SELECT id,user_role,action,entity_type,entity_id,old_values,new_values,reason,created_at FROM public.audit_log
    WHERE ($1::text IS NULL OR entity_type=$1) ORDER BY created_at DESC LIMIT 500`,[url.searchParams.get('entity_type') || null]);
  return json(response,200,{events:rows});
}

export async function settings(_user,_url,response) {
  const { rows }=await pool.query("SELECT key,value,description,updated_at FROM public.settings WHERE key IN ('consent_policy','share_message_template','issue_categories','verification_providers','exclude_legacy_unconfirmed_from_outreach') ORDER BY key");
  return json(response,200,{settings:rows});
}

export async function updateSetting(user,key,request,response) {
  if(!['consent_policy','share_message_template','issue_categories','verification_providers','exclude_legacy_unconfirmed_from_outreach'].includes(key)) throw new ApiError(404,'Setting not found.');
  const parsed=z.object({value:z.unknown(),reason:z.string().trim().min(3).max(500)}).safeParse(await readJson(request));
  if(!parsed.success) throw new ApiError(400,'A reason and valid setting value are required.');
  const before=await pool.query('SELECT value FROM public.settings WHERE key=$1',[key]);
  const {rows}=await pool.query('UPDATE public.settings SET value=$1::jsonb,updated_by=$2,updated_at=now() WHERE key=$3 RETURNING key,value',[JSON.stringify(parsed.data.value),user.id,key]);
  if(!rows.length) throw new ApiError(404,'Setting not found.');
  await pool.query(`INSERT INTO public.audit_log(user_id,user_role,action,entity_type,entity_id,old_values,new_values,reason) VALUES($1,$2,'update','setting',$3,$4::jsonb,$5::jsonb,$6)`,[user.id,user.role,key,JSON.stringify(before.rows[0]?.value??null),JSON.stringify(rows[0].value),parsed.data.reason]);
  return json(response,200,{setting:rows[0]});
}
