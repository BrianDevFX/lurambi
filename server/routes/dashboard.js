import { pool, withActor } from '../db.js';
import { safeCell } from './exports.js';
import { ApiError, json } from '../http.js';

function filterSql(user,url){
  const conditions=[];const values=[];const add=(sql,value)=>{values.push(value);conditions.push(sql.replace('?',`$${values.length}`));};
  if(user.role==='mobilizer')add('e.mobilizer_id=?',user.id);
  if(user.role==='ward_coordinator'){if(!user.home_ward_id)throw new ApiError(403,'Coordinator ward is not assigned.');add('e.ward_filed_id=?',user.home_ward_id);}
  for(const [key,column] of [['ward_id','e.ward_filed_id'],['polling_centre_id','e.polling_centre_id'],['polling_station_id','e.polling_station_id'],['support_level','e.support_level'],['verification_status','e.verification_status'],['source','e.source']]){
    const value=url.searchParams.get(key);if(value&&user.role==='admin')add(`${column}=?`,value);
    else if(value&&['polling_centre_id','polling_station_id','support_level','verification_status','source'].includes(key))add(`${column}=?`,value);
  }
  const mobilizer=url.searchParams.get('mobilizer_id');if(mobilizer&&user.role==='admin')add('e.mobilizer_id=?',mobilizer);
  for(const [param,op] of [['date_from','>='],['date_to','<=']]){const value=url.searchParams.get(param);if(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new ApiError(400,'Invalid date filter.');add(`e.captured_on::date ${op} ?::date`,value);}}
  return {where:conditions.length?`WHERE ${conditions.join(' AND ')}`:'',values};
}

export async function dashboardData(user,url){
  const filter=filterSql(user,url);const query=(sql)=>pool.query(sql,filter.values);
  const [wards,stations,support,verification,completeness,priority,quality,issues,timeline,influencers]=await Promise.all([
    query(`SELECT w.id,w.name,count(e.id)::int AS entries,coalesce(max(w.registered_voters_target),0)::int AS registered_target FROM public.entries e JOIN public.wards w ON w.id=e.ward_filed_id ${filter.where} GROUP BY w.id,w.name ORDER BY w.name`),
    query(`SELECT s.id,w.name AS ward_name,c.name AS centre_name,s.station_name,count(e.id)::int AS entries,count(*) FILTER(WHERE e.support_level='undecided')::int AS undecided FROM public.entries e JOIN public.polling_stations s ON s.id=e.polling_station_id JOIN public.wards w ON w.id=e.ward_filed_id LEFT JOIN public.polling_centres c ON c.id=e.polling_centre_id ${filter.where} GROUP BY s.id,w.name,c.name,s.station_name ORDER BY entries DESC LIMIT 100`),
    query(`SELECT support_level,count(*)::int AS entries FROM public.entries e ${filter.where} GROUP BY support_level ORDER BY support_level`),
    query(`SELECT verification_status,count(*)::int AS entries FROM public.entries e ${filter.where} GROUP BY verification_status ORDER BY verification_status`),
    query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE e.national_id IS NOT NULL)::int AS id_present,count(*) FILTER(WHERE e.phone_e164 IS NOT NULL)::int AS phone_present,count(*) FILTER(WHERE e.polling_centre_id IS NOT NULL AND e.polling_station_id IS NOT NULL)::int AS mapped_places FROM public.entries e ${filter.where}`),
    query(`SELECT w.name AS ward_name,c.name AS centre_name,s.station_name,count(e.id)::int AS entries,count(*) FILTER(WHERE cardinality(e.flags)>0)::int AS flagged FROM public.entries e JOIN public.polling_stations s ON s.id=e.polling_station_id JOIN public.wards w ON w.id=e.ward_filed_id LEFT JOIN public.polling_centres c ON c.id=e.polling_centre_id ${filter.where} GROUP BY w.name,c.name,s.station_name ORDER BY flagged DESC,entries DESC LIMIT 25`),
    query(`SELECT u.id,u.full_name,count(DISTINCT e.id)::int AS entries,count(DISTINCT e.id) FILTER(WHERE cardinality(e.flags)>0)::int AS flagged,count(DISTINCT e.id) FILTER(WHERE e.national_id IS NOT NULL)::int AS id_present,count(DISTINCT d.id)::int AS duplicate_attempts FROM public.entries e JOIN public.users u ON u.id=e.mobilizer_id LEFT JOIN public.duplicate_attempts d ON d.mobilizer_id=u.id ${filter.where}${filter.where?' AND':'WHERE'} e.source<>'legacy' GROUP BY u.id,u.full_name ORDER BY entries DESC LIMIT 100`),
    query(`SELECT w.name AS ward_name,issue,count(*)::int AS entries FROM public.entries e JOIN public.wards w ON w.id=e.ward_filed_id CROSS JOIN LATERAL unnest(e.issues) AS issue ${filter.where} GROUP BY w.name,issue ORDER BY entries DESC LIMIT 30`),
    query(`SELECT e.captured_on::date AS day,count(*)::int AS entries FROM public.entries e ${filter.where} GROUP BY day ORDER BY day`),
    user.role==='mobilizer'?Promise.resolve({rows:[]}):pool.query(`SELECT w.name AS ward_name,n.type,count(*)::int AS contacts FROM public.network_contacts n JOIN public.wards w ON w.id=n.ward_id ${user.role==='ward_coordinator'?'WHERE n.ward_id=$1':''} GROUP BY w.name,n.type ORDER BY w.name,n.type`,user.role==='ward_coordinator'?[user.home_ward_id]:[]),
  ]);
  return {totals_by_ward:wards.rows,totals_by_station:stations.rows,support_breakdown:support.rows,verification_funnel:verification.rows,data_completeness:completeness.rows[0],priority_stations:priority.rows,mobilizer_quality:quality.rows,top_issues:issues.rows,capture_timeline:timeline.rows,influencers_by_ward:influencers.rows};
}

export async function getDashboard(user,url,response){return json(response,200,await dashboardData(user,url));}

export async function exportDashboard(user,url,response){
  const panel=url.searchParams.get('panel')||'totals_by_ward';const data=await dashboardData(user,url);if(!Object.hasOwn(data,panel))throw new ApiError(400,'Unknown dashboard panel.');
  const XLSX=await import('xlsx');const values=data[panel];const rows=Array.isArray(values)?values: [values||{}];const keys=rows.length?Object.keys(rows[0]):[];const sheet=XLSX.utils.aoa_to_sheet([keys,...rows.map(row=>keys.map(key=>safeCell(row[key])))]);const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,'Dashboard');const fileName=`dashboard-${panel}.xlsx`;
  await withActor(user.id,(client)=>client.query('SELECT app.log_export($1,$2,$3::jsonb,$4,$5)',['dashboard','xlsx',JSON.stringify({panel}),rows.length,fileName]));
  response.status(200);response.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');response.setHeader('Content-Disposition',`attachment; filename="${fileName}"`);response.end(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
}
