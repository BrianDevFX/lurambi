import { pool, withActor } from '../db.js';
import { ApiError } from '../http.js';

export function safeCell(value) { const text=value===null||value===undefined?'':String(value); return /^[=+\-@\t\r]/.test(text)?`'${text}`:text; }

export async function exportEntries(user,url,response) {
  if(!['admin','ward_coordinator','mobilizer'].includes(user.role)) throw new ApiError(403,'Role is not permitted to export this list.');
  const format=url.searchParams.get('format')||'csv';
  if(!['csv','xlsx','pdf'].includes(format)) throw new ApiError(400,'Choose CSV, Excel or PDF.');
  const wardId=url.searchParams.get('ward_id')||null; const centreId=url.searchParams.get('polling_centre_id')||null; const stationId=url.searchParams.get('polling_station_id')||null;
  const params=[]; const where=[];
  if(user.role==='mobilizer'){params.push(user.id);where.push(`e.mobilizer_id=$${params.length}`);}
  if(user.role==='ward_coordinator'){if(!user.home_ward_id) throw new ApiError(403,'Coordinator ward is not assigned.');params.push(user.home_ward_id);where.push(`e.ward_filed_id=$${params.length}`);}
  if(wardId&&user.role==='admin'){params.push(wardId);where.push(`e.ward_filed_id=$${params.length}`);}
  if(centreId){params.push(centreId);where.push(`e.polling_centre_id=$${params.length}`);}
  if(stationId){params.push(stationId);where.push(`e.polling_station_id=$${params.length}`);}
  const {rows}=await pool.query(`SELECT e.name,e.phone_e164,e.national_id_masked,w.name AS ward,c.name AS polling_centre,s.station_name,e.support_level,e.verification_status,e.flags,e.captured_on FROM public.entries e JOIN public.wards w ON w.id=e.ward_filed_id LEFT JOIN public.polling_centres c ON c.id=e.polling_centre_id LEFT JOIN public.polling_stations s ON s.id=e.polling_station_id ${where.length?`WHERE ${where.join(' AND ')}`:''} ORDER BY e.captured_on DESC LIMIT 10000`,params);
  const columns=['Name','Phone','National ID','Ward','Polling Centre','Polling Station','Support','Verification','Flags','Captured On'];
  const data=rows.map((r)=>[r.name,r.phone_e164,r.national_id_masked,r.ward,r.polling_centre,r.station_name,r.support_level,r.verification_status,(r.flags||[]).join('; '),r.captured_on?.toISOString?.()||r.captured_on].map(safeCell));
  const filters={ward_id:wardId,polling_centre_id:centreId,polling_station_id:stationId,role:user.role}; const fileName=`entries-${new Date().toISOString().slice(0,10)}.${format}`;
  await withActor(user.id,(client)=>client.query('SELECT app.log_export($1,$2,$3::jsonb,$4,$5)', ['entries',format,JSON.stringify(filters),rows.length,fileName]));
  if(format==='csv') { response.status(200);response.setHeader('Content-Type','text/csv; charset=utf-8');response.setHeader('Content-Disposition',`attachment; filename="${fileName}"`);response.end([columns.map(safeCell).join(','),...data.map((row)=>row.map((cell)=>`"${String(cell).replaceAll('"','""')}"`).join(','))].join('\r\n'));return; }
  if(format==='xlsx') { const XLSX=await import('xlsx');const sheet=XLSX.utils.aoa_to_sheet([columns,...data]);const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Entries');const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});response.status(200);response.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');response.setHeader('Content-Disposition',`attachment; filename="${fileName}"`);response.end(bytes);return; }
  const {jsPDF}=await import('jspdf');const {default:autoTable}=await import('jspdf-autotable');const doc=new jsPDF({orientation:'landscape'});doc.text('Lurambi Field Platform — Entries',14,14);autoTable(doc,{head:[columns],body:data,startY:20,styles:{fontSize:7}});const bytes=Buffer.from(doc.output('arraybuffer'));response.status(200);response.setHeader('Content-Type','application/pdf');response.setHeader('Content-Disposition',`attachment; filename="${fileName}"`);response.end(bytes);
}

export async function exportVerification(user,url,response){
  if(user.role!=='admin')throw new ApiError(403,'Admin role required.');
  const {rows}=await pool.query(`SELECT e.name,e.national_id_masked,w.name AS ward,c.name AS polling_centre,s.station_name,e.verification_status
    FROM public.entries e JOIN public.wards w ON w.id=e.ward_filed_id LEFT JOIN public.polling_centres c ON c.id=e.polling_centre_id LEFT JOIN public.polling_stations s ON s.id=e.polling_station_id
    WHERE e.verification_status=coalesce($1,e.verification_status) ORDER BY w.name,c.name,e.name LIMIT 10000`,[url.searchParams.get('status')||'unverified']);
  const fileName=`to-verify-${new Date().toISOString().slice(0,10)}.xlsx`;const columns=['Name','National ID','Ward','Polling Centre','Polling Station','Status'];const data=rows.map(r=>[r.name,r.national_id_masked,r.ward,r.polling_centre,r.station_name,r.verification_status].map(safeCell));
  await withActor(user.id,(client)=>client.query('SELECT app.log_export($1,$2,$3::jsonb,$4,$5)',['verification','xlsx',JSON.stringify({status:url.searchParams.get('status')||'unverified'}),rows.length,fileName]));
  const XLSX=await import('xlsx');const sheet=XLSX.utils.aoa_to_sheet([columns,...data]);const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'To Verify');response.status(200);response.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');response.setHeader('Content-Disposition',`attachment; filename="${fileName}"`);response.end(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
}
