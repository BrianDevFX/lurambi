import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { normalizeKenyanPhone, normalizeNationalId } from '../normalisation.js';
import { ApiError, json, readJson } from '../http.js';

const createSchema=z.object({file_name:z.string().trim().min(1).max(180),import_type:z.enum(['entries','network_contacts','places'])});
const rowSchema=z.object({row_hash:z.string().min(8).max(128),name:z.string().trim().min(2).max(160).optional(),phone:z.string().max(40).optional().nullable(),national_id:z.string().max(40).optional().nullable(),ward_id:z.string().uuid().optional().nullable(),ward_name:z.string().max(160).optional().nullable(),polling_centre_id:z.string().uuid().optional().nullable(),centre_name:z.string().max(180).optional().nullable(),polling_station_id:z.string().uuid().optional().nullable(),station_name:z.string().max(180).optional().nullable(),station_number:z.coerce.number().int().positive().optional(),code:z.string().max(40).optional().nullable(),support_level:z.enum(['strong_supporter','leaning','undecided','opposed','not_reached','not_assessed']).optional(),issues:z.array(z.string()).optional(),needs_transport:z.boolean().optional(),has_pvc:z.boolean().optional(),notes:z.string().max(2000).optional().nullable(),captured_on:z.string().optional(),legacy_mobilizer_label:z.string().max(160).optional().nullable(),type:z.enum(['pastor','chp','other','ward','polling_centre','polling_station']).optional(),denomination:z.string().max(120).optional().nullable(),community_unit:z.string().max(160).optional().nullable()});

export async function createImport(user,request,response) {
  const parsed=createSchema.safeParse(await readJson(request));
  if(!parsed.success) throw new ApiError(400,'Select a valid import type and file.');
  const {rows}=await pool.query('INSERT INTO public.imports(file_name,import_type,created_by) VALUES($1,$2,$3) RETURNING id,file_name,import_type,created_at',[parsed.data.file_name,parsed.data.import_type,user.id]);
  return json(response,201,{import:rows[0]});
}

async function validateRows(raw) {
  if(!Array.isArray(raw)||raw.length<1||raw.length>500) throw new ApiError(400,'Send 1 to 500 rows per batch.');
  const rows=[]; const rejected=[];
  raw.forEach((item,index)=>{const result=rowSchema.safeParse(item);if(result.success) rows.push({row:result.data,index});else rejected.push({index,reason:'Invalid row fields'});});
  return {rows,rejected};
}

export async function importBatch(user,id,request,response) {
  const parsed=z.object({rows:z.array(z.unknown()).min(1).max(500),dry_run:z.boolean().default(false)}).safeParse(await readJson(request));
  if(!parsed.success) throw new ApiError(400,'Send a valid batch of up to 500 rows.');
  const batch=await pool.query('SELECT id,import_type FROM public.imports WHERE id=$1',[id]);
  if(!batch.rowCount) throw new ApiError(404,'Import batch not found.');
  const {rows,rejected}=await validateRows(parsed.data.rows);
  if(batch.rows[0].import_type==='entries') return importEntries(user,id,rows,rejected,parsed.data.dry_run,response);
  if(batch.rows[0].import_type==='network_contacts') return importContacts(id,rows,rejected,parsed.data.dry_run,response);
  return importPlaces(id,rows,rejected,parsed.data.dry_run,response);
}

export async function dryRunImport(_user,request,response){
  const parsed=z.object({import_type:z.enum(['entries','network_contacts','places']),rows:z.array(z.unknown()).min(1).max(500)}).safeParse(await readJson(request));
  if(!parsed.success)throw new ApiError(400,'Send 1 to 500 rows for the dry run.');
  const {rows,rejected}=await validateRows(parsed.data.rows);
  const fakeId='00000000-0000-4000-8000-000000000000';
  if(parsed.data.import_type==='entries')return importEntries(null,fakeId,rows,rejected,true,response);
  if(parsed.data.import_type==='network_contacts')return importContacts(fakeId,rows,rejected,true,response);
  return importPlaces(fakeId,rows,rejected,true,response);
}

async function importEntries(user,importId,items,rejected,dryRun,response) {
  const normalized=[]; let unmapped=0; let invalid=0;
  for(const {row,index} of items){
    if(!row.name){rejected.push({index,reason:'Name is missing'});continue;}
    if(!row.ward_id&&row.ward_name){const ward=await pool.query(`SELECT w.id FROM public.wards w WHERE lower(w.name)=lower($1) UNION SELECT a.target_ward_id FROM public.place_aliases a WHERE a.canonical_type='ward' AND lower(a.raw_alias)=lower($1) AND a.target_ward_id IS NOT NULL LIMIT 1`,[row.ward_name.trim()]);row.ward_id=ward.rows[0]?.id||null;}
    if(!row.ward_id){unmapped++;rejected.push({index,reason:'Ward needs mapping'});continue;}
    if(!row.polling_centre_id&&row.centre_name){const centre=await pool.query(`SELECT c.id FROM public.polling_centres c WHERE c.ward_id=$1 AND lower(c.name)=lower($2) UNION SELECT a.target_polling_centre_id FROM public.place_aliases a WHERE a.canonical_type='polling_centre' AND lower(a.raw_alias)=lower($2) AND a.target_polling_centre_id IS NOT NULL LIMIT 1`,[row.ward_id,row.centre_name.trim()]);row.polling_centre_id=centre.rows[0]?.id||null;}
    if(!row.polling_station_id&&row.station_name&&row.polling_centre_id){const station=await pool.query(`SELECT s.id FROM public.polling_stations s WHERE s.polling_centre_id=$1 AND lower(s.station_name)=lower($2) UNION SELECT a.target_polling_station_id FROM public.place_aliases a WHERE a.canonical_type='polling_station' AND lower(a.raw_alias)=lower($2) AND a.target_polling_station_id IS NOT NULL LIMIT 1`,[row.polling_centre_id,row.station_name.trim()]);row.polling_station_id=station.rows[0]?.id||null;}
    if(row.polling_centre_id){const centre=await pool.query('SELECT 1 FROM public.polling_centres WHERE id=$1 AND ward_id=$2',[row.polling_centre_id,row.ward_id]);if(!centre.rowCount){unmapped++;rejected.push({index,reason:'Polling centre does not belong to the mapped ward'});continue;}}
    if(row.polling_station_id){const station=await pool.query('SELECT 1 FROM public.polling_stations WHERE id=$1 AND ward_id=$2 AND polling_centre_id=$3',[row.polling_station_id,row.ward_id,row.polling_centre_id]);if(!station.rowCount){unmapped++;rejected.push({index,reason:'Polling station does not belong to the mapped centre and ward'});continue;}}
    const id=normalizeNationalId(row.national_id||'');
    const phone=normalizeKenyanPhone(row.phone||'');
    const flags=[];
    if(!id){flags.push(row.national_id?'INVALID_ID':'MISSING_ID'); if(row.national_id) invalid++;}
    if(row.phone&&!phone) flags.push('INVALID_PHONE');
    normalized.push({row,index,id,phone,flags});
  }
  if(dryRun) return json(response,200,{dry_run:true,total:items.length+rejected.length,imported:normalized.length,merged:0,rejected:rejected.length,flagged:normalized.filter((item)=>item.flags.length).length,unmapped,errors:rejected});
  const counts=await withTransaction(async(client)=>{
    let imported=0,merged=0,flagged=0,actualUnmapped=unmapped;
    for(const item of normalized){
      const {row}=item; const rowHash=row.row_hash;
      const result=await client.query(`INSERT INTO public.entries(client_request_id,mobilizer_id,ward_filed_id,polling_centre_id,polling_station_id,name,phone_e164,national_id,national_id_masked,support_level,issues,needs_transport,has_pvc,notes,consent_at,consent_text_version,consent_status,source,verification_status,legacy_mobilizer_label,captured_on,import_batch_id,row_hash,flags)
       VALUES($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,NULL,'legacy_unconfirmed','legacy',$14,$15,coalesce($16::timestamptz,now()),$17,$18,$19) ON CONFLICT DO NOTHING RETURNING id`,
       [randomUUID(),row.ward_id,row.polling_centre_id||null,row.polling_station_id||null,row.name,item.phone||null,item.id?.value||null,item.id?.masked||null,row.support_level||'not_assessed',row.issues||[],row.needs_transport||false,row.has_pvc||false,row.notes||null,item.id?'unverified':'pending_id',row.legacy_mobilizer_label||null,row.captured_on||null,importId,rowHash,item.flags]);
      if(result.rowCount){imported++; if(item.flags.length) flagged++; if(item.flags.length) for(const flag of item.flags) await client.query('INSERT INTO public.flag_events(entry_id,flag_code,severity) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[result.rows[0].id,flag,flag==='SHARED_PHONE'?'info':'warning']);}
      else merged++;
    }
    await client.query(`UPDATE public.imports SET total_rows=total_rows+$1,imported_rows=imported_rows+$2,duplicate_rows=duplicate_rows+$3,rejected_rows=rejected_rows+$4,flagged_rows=flagged_rows+$5,unmapped_rows=unmapped_rows+$6,summary_report=summary_report || $7::jsonb WHERE id=$8`,[items.length+rejected.length,imported,merged,rejected.length,flagged,actualUnmapped,JSON.stringify({last_errors:rejected.slice(0,100)}),importId]);
    return {imported,merged,flagged,unmapped:actualUnmapped};
  });
  return json(response,200,{...counts,rejected:rejected.length,errors:rejected});
}

async function importContacts(importId,items,rejected,dryRun,response) {
  if(dryRun) return json(response,200,{dry_run:true,total:items.length+rejected.length,imported:items.length,rejected:rejected.length,unmapped:items.filter(({row})=>!row.ward_id).length,errors:rejected});
  const result=await withTransaction(async(client)=>{let imported=0,merged=0;for(const {row} of items){if(!row.name||!['pastor','chp','other'].includes(row.type))continue;const phone=normalizeKenyanPhone(row.phone||'');const out=await client.query(`INSERT INTO public.network_contacts(type,name,phone_e164,national_id,national_id_masked,denomination,community_unit,ward_id,reach_status,notes,exclude_from_campaign_exports,import_batch_id,row_hash)
      VALUES($1,$2,$3,NULL,NULL,$4,$5,$6,'not_contacted',NULL,$7,$8,$9) ON CONFLICT(row_hash) DO NOTHING RETURNING id`,[row.type,row.name,phone||null,row.denomination||null,row.community_unit||null,row.ward_id||null,row.type==='chp',importId,row.row_hash]);if(out.rowCount)imported++;else merged++;}await client.query('UPDATE public.imports SET total_rows=total_rows+$1,imported_rows=imported_rows+$2,duplicate_rows=duplicate_rows+$3,rejected_rows=rejected_rows+$4,unmapped_rows=unmapped_rows+$5 WHERE id=$6',[items.length+rejected.length,imported,merged,rejected.length,items.filter(({row})=>!row.ward_id).length,importId]);return{imported,merged};});
  return json(response,200,{...result,rejected:rejected.length,errors:rejected});
}

async function importPlaces(importId,items,rejected,dryRun,response) {
  const valid=items.filter(({row})=>['ward','polling_centre','polling_station'].includes(row.type)&&row.name);
  const invalid=items.filter(({row})=>!['ward','polling_centre','polling_station'].includes(row.type)||!row.name).map(({index})=>({index,reason:'Place type and name are required.'}));
  if(dryRun) return json(response,200,{dry_run:true,total:items.length+rejected.length,imported:valid.length,rejected:rejected.length+invalid.length,unmapped:valid.filter(({row})=>row.type!=='ward'&&!row.ward_id&&!row.ward_name).length,errors:[...rejected,...invalid]});
  const result=await withTransaction(async(client)=>{let imported=0,unmapped=0;for(const {row,index} of valid){
    if(row.type==='ward'){await client.query('INSERT INTO public.wards(name,code) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET code=coalesce(excluded.code,wards.code),updated_at=now()',[row.name,row.code||null]);imported++;continue;}
    let wardId=row.ward_id||null;if(!wardId&&row.ward_name){const ward=await client.query('SELECT id FROM public.wards WHERE lower(name)=lower($1)',[row.ward_name.trim()]);wardId=ward.rows[0]?.id||null;}if(!wardId){unmapped++;rejected.push({index,reason:'Ward needs mapping.'});continue;}
    if(row.type==='polling_centre'){await client.query('INSERT INTO public.polling_centres(ward_id,name,code,synthetic) VALUES($1,$2,$3,false) ON CONFLICT(ward_id,name) DO UPDATE SET code=coalesce(excluded.code,polling_centres.code),synthetic=false,updated_at=now()',[wardId,row.name,row.code||null]);imported++;continue;}
    let centreId=row.polling_centre_id||null;if(!centreId&&row.centre_name){const centre=await client.query('SELECT id FROM public.polling_centres WHERE ward_id=$1 AND lower(name)=lower($2)',[wardId,row.centre_name.trim()]);centreId=centre.rows[0]?.id||null;}if(!centreId){unmapped++;rejected.push({index,reason:'Polling centre needs mapping.'});continue;}
    await client.query('INSERT INTO public.polling_stations(polling_centre_id,ward_id,station_name,station_number,synthetic) VALUES($1,$2,$3,$4,false) ON CONFLICT(polling_centre_id,station_name) DO UPDATE SET station_number=excluded.station_number,synthetic=false,updated_at=now()',[centreId,wardId,row.station_name||row.name,row.station_number||1]);imported++;
  }
    await client.query('UPDATE public.imports SET total_rows=total_rows+$1,imported_rows=imported_rows+$2,rejected_rows=rejected_rows+$3,unmapped_rows=unmapped_rows+$4,summary_report=summary_report || $5::jsonb WHERE id=$6',[items.length+rejected.length,imported,rejected.length,unmapped,JSON.stringify({last_errors:rejected.slice(0,100)}),importId]);return{imported,unmapped};});
  return json(response,200,{...result,rejected:rejected.length,errors:rejected});
}

export async function importHistory(_user,_url,response){const {rows}=await pool.query('SELECT id,file_name,import_type,total_rows,imported_rows,duplicate_rows,rejected_rows,flagged_rows,unmapped_rows,summary_report,created_at FROM public.imports ORDER BY created_at DESC LIMIT 100');return json(response,200,{imports:rows});}

export async function placeAliases(_user,_url,response){const {rows}=await pool.query(`SELECT a.id,a.raw_alias,a.canonical_type,a.target_ward_id,a.target_polling_centre_id,a.target_polling_station_id,a.confidence,w.name AS ward_name,c.name AS centre_name,s.station_name FROM public.place_aliases a LEFT JOIN public.wards w ON w.id=a.target_ward_id LEFT JOIN public.polling_centres c ON c.id=a.target_polling_centre_id LEFT JOIN public.polling_stations s ON s.id=a.target_polling_station_id ORDER BY a.created_at DESC LIMIT 500`);return json(response,200,{aliases:rows});}

export async function saveAlias(user,request,response){
  const parsed=z.object({raw_alias:z.string().trim().min(1).max(180),canonical_type:z.enum(['ward','polling_centre','polling_station']),target_id:z.string().uuid(),confidence:z.number().min(0).max(1).default(1),reason:z.string().trim().min(3).max(500)}).safeParse(await readJson(request));
  if(!parsed.success)throw new ApiError(400,'Check the place mapping and give a reason.');
  const targetColumn={ward:'target_ward_id',polling_centre:'target_polling_centre_id',polling_station:'target_polling_station_id'}[parsed.data.canonical_type];
  const table={ward:'wards',polling_centre:'polling_centres',polling_station:'polling_stations'}[parsed.data.canonical_type];
  const result=await withTransaction(async(client)=>{
    const exists=await client.query('SELECT id FROM public.'+table+' WHERE id=$1',[parsed.data.target_id]);
    if(!exists.rowCount)throw new ApiError(400,'Canonical place was not found.');
    const previous=await client.query('SELECT id,raw_alias,canonical_type,'+targetColumn+' AS target_id,confidence FROM public.place_aliases WHERE raw_alias=$1 AND canonical_type=$2 FOR UPDATE',[parsed.data.raw_alias,parsed.data.canonical_type]);
    const {rows}=await client.query('INSERT INTO public.place_aliases(raw_alias,canonical_type,'+targetColumn+',confidence) VALUES($1,$2,$3,$4) ON CONFLICT(raw_alias,canonical_type) DO UPDATE SET '+targetColumn+'=excluded.'+targetColumn+',confidence=excluded.confidence RETURNING id,raw_alias,canonical_type,'+targetColumn+' AS target_id,confidence',[parsed.data.raw_alias,parsed.data.canonical_type,parsed.data.target_id,parsed.data.confidence]);
    await client.query('INSERT INTO public.audit_log(user_id,user_role,action,entity_type,entity_id,old_values,new_values,reason) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)',[user.id,user.role,previous.rowCount?'update':'create','place_alias',rows[0].id,previous.rowCount?JSON.stringify(previous.rows[0]):null,JSON.stringify(rows[0]),parsed.data.reason]);
    return rows[0];
  });
  return json(response,200,{alias:result});
}
