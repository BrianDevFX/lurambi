import { z } from 'zod';
import { pool } from '../db.js';
import { normalizeKenyanPhone } from '../normalisation.js';
import { ApiError, json, readJson } from '../http.js';

const joinSchema=z.object({name:z.string().trim().min(2).max(160),phone:z.string().trim().min(8).max(40),national_id:z.string().trim().max(12).optional().nullable(),ward_id:z.string().uuid(),polling_centre_id:z.string().uuid(),polling_station_id:z.string().uuid(),issues:z.array(z.string().trim().min(1).max(100)).max(20).optional(),not_found_in_register:z.boolean().optional(),pledge:z.literal(true),consent:z.literal(true),website:z.string().max(200).optional()});
const dsrSchema=z.object({request_type:z.enum(['access','correction','deletion']),requester_name:z.string().trim().min(2).max(160),phone:z.string().trim().min(8).max(40),national_id:z.string().trim().max(12).optional().nullable(),details:z.string().max(1000).optional(),website:z.string().max(200).optional()});

export async function publicJoin(_request,request,response,code){
  const parsed=joinSchema.safeParse(await readJson(request));
  if(!parsed.success)throw new ApiError(400,'Check the details and consent box.');
  if(parsed.data.website) return json(response,200,{ok:true,message:'Thank you. Your response was received.'});
  const phone=normalizeKenyanPhone(parsed.data.phone);
  if(!phone)throw new ApiError(400,'Enter a valid Kenyan phone number.');
  const rawId=parsed.data.national_id||'';
  if(rawId&&!/^\d{7,8}$/.test(rawId))throw new ApiError(400,'National ID must have 7 or 8 digits.');
  try {
    await pool.query('SELECT app.public_join($1,$2::jsonb)',[code,JSON.stringify({...parsed.data,phone,national_id:rawId})]);
  } catch(error) {
    if(error.code==='23514')throw new ApiError(400,'Check the details and consent box.');
    throw error;
  }
  return json(response,200,{ok:true,message:'Thank you. Your response was received.'});
}

export async function publicDsr(_request,request,response){
  const parsed=dsrSchema.safeParse(await readJson(request));
  if(!parsed.success)throw new ApiError(400,'Check the request details.');
  if(parsed.data.website)return json(response,200,{ok:true,message:'Thank you. Your request was received.'});
  const phone=normalizeKenyanPhone(parsed.data.phone);
  if(!phone)throw new ApiError(400,'Enter a valid Kenyan phone number.');
  const nationalId=parsed.data.national_id||null;
  if(nationalId&&!/^\d{7,8}$/.test(nationalId))throw new ApiError(400,'National ID must have 7 or 8 digits.');
  await pool.query(`INSERT INTO public.data_subject_requests(request_type,requester_name,phone_e164,national_id,notes)
    VALUES($1,$2,$3,$4,$5)`,[parsed.data.request_type,parsed.data.requester_name,phone,nationalId,parsed.data.details||null]);
  return json(response,200,{ok:true,message:'Thank you. Your request was received.'});
}

export async function listDsr(_user,_url,response){
  const {rows}=await pool.query('SELECT id,request_type,requester_name,phone_e164,status,notes,created_at FROM public.data_subject_requests ORDER BY created_at DESC LIMIT 300');
  return json(response,200,{requests:rows});
}

export async function updateDsr(user,id,request,response){
  const parsed=z.object({status:z.enum(['in_progress','completed','rejected']),notes:z.string().trim().min(3).max(1000)}).safeParse(await readJson(request));
  if(!parsed.success)throw new ApiError(400,'Choose a status and enter a note.');
  const {rows}=await pool.query(`UPDATE public.data_subject_requests SET status=$1,notes=$2,resolved_by=CASE WHEN $1 IN ('completed','rejected') THEN $3 ELSE resolved_by END,resolved_at=CASE WHEN $1 IN ('completed','rejected') THEN now() ELSE NULL END WHERE id=$4 RETURNING id,status,notes`,[parsed.data.status,parsed.data.notes,user.id,id]);
  if(!rows.length)throw new ApiError(404,'Request not found.');
  await pool.query(`INSERT INTO public.audit_log(user_id,user_role,action,entity_type,entity_id,new_values,reason) VALUES($1,$2,'update','data_subject_request',$3,$4::jsonb,$5)`,[user.id,user.role,id,JSON.stringify(rows[0]),parsed.data.notes]);
  return json(response,200,{request:rows[0]});
}
