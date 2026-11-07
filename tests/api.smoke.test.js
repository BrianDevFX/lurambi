import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { route } from '../server/router.js';
import { pool } from '../server/db.js';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const enabled = Boolean(databaseUrl);
let server;
let baseUrl;
let client;
let wardA;
let wardB;
let centreA;
let centreB;
let stationA;
let stationB;
let adminCookie;
let coordinatorCookie;
let mobilizerCookie;
let secondMobilizerCookie;
let pendingCookie;
let mobilizerId;
let secondMobilizerId;
let pendingId;
let approvedReferral;
const phones = ['+254700000001','+254700000002','+254700000003','+254700000004','+254700000005','+254700000006'];
const names = ['Synthetic Phase B Admin','Synthetic Phase B Coordinator','Synthetic Phase B Mobilizer A','Synthetic Phase B Mobilizer B','Synthetic Phase B Pending','Synthetic Phase B Signup'];
const passwords = Array.from({ length: 6 }, () => randomBytes(24).toString('base64url'));
let captureId;

function localOnly() {
  if (!databaseUrl) return;
  const host = new URL(databaseUrl).hostname.toLowerCase();
  if (!['localhost','127.0.0.1','::1'].includes(host)) throw new Error('API smoke tests only run against local PostgreSQL.');
}

async function request(path, { method='GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  return { response, result, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function makeUser(index, role, wardId, stationId) {
  const passwordHash = await bcrypt.hash(passwords[index], 4);
  const id = (await client.query(
    `INSERT INTO public.users(phone,password_hash,full_name,national_id,national_id_masked,role,status,home_ward_id,home_polling_station_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [phones[index],passwordHash,names[index],`${String(index+1).repeat(7)}`,`${String(index+1)}**${String(index+1).repeat(3)}`,role,role==='mobilizer' && index===4?'pending':'approved',wardId,stationId],
  )).rows[0].id;
  return id;
}

describe('Phase B API smoke', () => {
  beforeAll(async () => {
    if (!enabled) return;
    localOnly();
    process.env.JWT_SECRET = randomBytes(48).toString('hex');
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query("DELETE FROM public.data_subject_requests WHERE requester_name='Synthetic DSR Requester'");
    await client.query("DELETE FROM public.entries WHERE name='=Synthetic Imported Person'");
    await client.query('DELETE FROM public.exports_log WHERE user_id IN (SELECT id FROM public.users WHERE phone = ANY($1::text[]))',[phones]);
    await client.query('DELETE FROM public.imports WHERE created_by IN (SELECT id FROM public.users WHERE phone = ANY($1::text[]))',[phones]);
    await client.query('DELETE FROM public.audit_log WHERE user_id IN (SELECT id FROM public.users WHERE phone = ANY($1::text[]))',[phones]);
    await client.query('DELETE FROM public.duplicate_attempts WHERE mobilizer_id IN (SELECT id FROM public.users WHERE phone = ANY($1::text[]))',[phones]);
    await client.query('DELETE FROM public.entries WHERE mobilizer_id IN (SELECT id FROM public.users WHERE phone = ANY($1::text[]))',[phones]);
    await client.query('DELETE FROM public.users WHERE phone = ANY($1::text[])',[phones]);
    const wards = await client.query("SELECT id,name FROM public.wards WHERE name IN ('Sheywe','Shirere') ORDER BY name");
    wardA = wards.rows.find((row) => row.name === 'Sheywe')?.id;
    wardB = wards.rows.find((row) => row.name === 'Shirere')?.id;
    if (!wardA || !wardB) throw new Error('The six reference wards migration has not been applied.');
    const centres = await client.query('SELECT id,ward_id FROM public.polling_centres WHERE ward_id=ANY($1::uuid[]) ORDER BY name',[ [wardA,wardB] ]);
    for (const ward of [wardA,wardB]) {
      if (!centres.rows.some((row) => row.ward_id === ward)) {
        const centre = await client.query("INSERT INTO public.polling_centres(ward_id,name,synthetic) VALUES ($1,$2,true) RETURNING id,ward_id",[ward,`Synthetic Test Centre ${ward===wardA?'A':'B'}`]);
        centres.rows.push(centre.rows[0]);
      }
    }
    centreA = centres.rows.find((row) => row.ward_id === wardA).id;
    centreB = centres.rows.find((row) => row.ward_id === wardB).id;
    async function station(centre,ward,label) {
      let result = await client.query('SELECT id FROM public.polling_stations WHERE polling_centre_id=$1 ORDER BY station_number LIMIT 1',[centre]);
      if (!result.rowCount) result = await client.query("INSERT INTO public.polling_stations(polling_centre_id,ward_id,station_name,station_number,synthetic) VALUES ($1,$2,$3,1,true) RETURNING id",[centre,ward,`Synthetic Test Station ${label}`]);
      return result.rows[0].id;
    }
    stationA = await station(centreA,wardA,'A');
    stationB = await station(centreB,wardB,'B');
    await makeUser(0,'admin',wardA,stationA);
    await makeUser(1,'ward_coordinator',wardA,stationA);
    mobilizerId = await makeUser(2,'mobilizer',wardA,stationA);
    secondMobilizerId = await makeUser(3,'mobilizer',wardB,stationB);
    pendingId = await makeUser(4,'mobilizer',wardA,stationA);
    server = createServer(async (req,res) => {
      const response = {
        setHeader: (name,value) => res.setHeader(name,value),
        status(code) { res.statusCode=code; return this; },
        json(value) { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(value)); },
        end(value) { res.end(value); },
      };
      await route(req,response);
    });
    await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  },30_000);

  afterAll(async () => {
    if (!enabled) return;
    await new Promise((resolve) => server?.close(resolve));
    if (client) {
      await client.query("DELETE FROM public.entries WHERE name='=Synthetic Imported Person'");
      await client.query("DELETE FROM public.data_subject_requests WHERE requester_name='Synthetic DSR Requester'");
      await client.query('DELETE FROM public.exports_log WHERE user_id IN (SELECT id FROM public.users WHERE phone = ANY($1::text[]))',[phones]);
      await client.query('DELETE FROM public.imports WHERE created_by IN (SELECT id FROM public.users WHERE phone = ANY($1::text[]))',[phones]);
      await client.query('DELETE FROM public.audit_log WHERE user_id IN (SELECT id FROM public.users WHERE phone = ANY($1::text[]))',[phones]);
      await client.query('DELETE FROM public.duplicate_attempts WHERE mobilizer_id IN (SELECT id FROM public.users WHERE phone = ANY($1::text[]))',[phones]);
      await client.query('DELETE FROM public.entries WHERE mobilizer_id IN (SELECT id FROM public.users WHERE phone = ANY($1::text[]))',[phones]);
      await client.query('DELETE FROM public.users WHERE phone = ANY($1::text[])',[phones]);
      await client.end();
    }
    await pool.end();
  },30_000);

  it.skipIf(!enabled)('signs up, gates pending accounts, approves, captures, blocks duplicates and scopes lists', async () => {
    const adminLogin = await request('/api/login',{method:'POST',body:{phone:phones[0],password:passwords[0]}});
    expect(adminLogin.response.status).toBe(200); adminCookie=adminLogin.cookie;
    const coordinatorLogin = await request('/api/login',{method:'POST',body:{phone:phones[1],password:passwords[1]}});
    coordinatorCookie=coordinatorLogin.cookie;
    const mobLogin = await request('/api/login',{method:'POST',body:{phone:phones[2],password:passwords[2]}});
    mobilizerCookie=mobLogin.cookie;
    const secondLogin = await request('/api/login',{method:'POST',body:{phone:phones[3],password:passwords[3]}});
    secondMobilizerCookie=secondLogin.cookie;
    const pendingLogin = await request('/api/login',{method:'POST',body:{phone:phones[4],password:passwords[4]}});
    pendingCookie=pendingLogin.cookie;

    const signUp = await request('/api/signup',{method:'POST',body:{full_name:names[5],phone:phones[5],password:passwords[5],national_id:'6666666',home_ward_id:wardA,home_polling_station_id:stationA}});
    expect(signUp.response.status).toBe(201); expect(signUp.result.user.status).toBe('pending');
    const pendingCapture = await request('/api/entries',{method:'POST',cookie:signUp.cookie,body:{client_request_id:crypto.randomUUID(),name:'Synthetic Pending Entry',phone:phones[5],national_id:'7654321',ward_filed_id:wardA,polling_centre_id:centreA,polling_station_id:stationA,support_level:'not_assessed',consent:true}});
    expect(pendingCapture.response.status).toBe(403);

    const pendingCaptureViaSeed = await request('/api/entries',{method:'POST',cookie:pendingCookie,body:{client_request_id:crypto.randomUUID(),name:'Synthetic Pending Entry',phone:phones[4],national_id:'7654322',ward_filed_id:wardA,polling_centre_id:centreA,polling_station_id:stationA,support_level:'not_assessed',consent:true}});
    expect(pendingCaptureViaSeed.response.status).toBe(403);
    const approval = await request(`/api/users/${pendingId}/approve`,{method:'POST',cookie:adminCookie});
    expect(approval.response.status).toBe(200); expect(approval.result.user.referral_code).toMatch(/^[A-Z2-9]{6}$/);
    approvedReferral=approval.result.user.referral_code;
    const coordinatorPending = await request('/api/users/pending',{cookie:coordinatorCookie});
    expect(coordinatorPending.response.status).toBe(200);

    const policy = await request('/api/consent-policy',{cookie:mobilizerCookie});
    expect(policy.response.status).toBe(200);
    const entryBody = {client_request_id:crypto.randomUUID(),name:'Synthetic Supporter Alpha',phone:'0700000099',national_id:'1234567',ward_filed_id:wardA,polling_centre_id:centreA,polling_station_id:stationA,support_level:'leaning',issues:[],needs_transport:false,has_pvc:false,consent:true};
    const missingConsent = await request('/api/entries',{method:'POST',cookie:mobilizerCookie,body:{...entryBody,client_request_id:crypto.randomUUID(),consent:false}});
    expect(missingConsent.response.status).toBe(400);
    const capture = await request('/api/entries',{method:'POST',cookie:mobilizerCookie,body:entryBody});
    expect(capture.response.status).toBe(201); expect(capture.result.entry.national_id_masked).toBeTruthy();
    expect(JSON.stringify(capture.result)).not.toContain('1234567'); captureId=capture.result.entry.id;
    const duplicate = await request('/api/entries',{method:'POST',cookie:mobilizerCookie,body:{...entryBody,client_request_id:crypto.randomUUID(),name:'Synthetic Supporter Duplicate'}});
    expect(duplicate.response.status).toBe(409); expect(duplicate.result.duplicate).toBe(true);
    const duplicateCount = await client.query('SELECT count(*)::int AS n FROM public.duplicate_attempts WHERE mobilizer_id=$1',[mobilizerId]);
    expect(duplicateCount.rows[0].n).toBe(1);

    const sharedPhone = await request('/api/entries',{method:'POST',cookie:mobilizerCookie,body:{...entryBody,client_request_id:crypto.randomUUID(),name:'Synthetic Supporter Beta',national_id:'2345678'}});
    expect(sharedPhone.response.status).toBe(201); expect(sharedPhone.result.entry.flags).toContain('SHARED_PHONE');
    const own = await request('/api/entries/mine',{cookie:mobilizerCookie});
    expect(own.result.entries).toHaveLength(2);
    const otherList = await request('/api/entries/mine',{cookie:secondMobilizerCookie});
    expect(otherList.response.status).toBe(200); expect(otherList.result.entries).toHaveLength(0);
    const coordinatorList = await request('/api/entries',{cookie:coordinatorCookie});
    expect(coordinatorList.result.entries.every((entry) => entry.ward_filed_id === wardA)).toBe(true);
    const edit = await request(`/api/entries/${captureId}`,{method:'PATCH',cookie:mobilizerCookie,body:{name:'Changed'}});
    const remove = await request(`/api/entries/${captureId}`,{method:'DELETE',cookie:mobilizerCookie});
    expect(edit.response.status).toBe(403); expect(remove.response.status).toBe(404);
  },60_000);

  it.skipIf(!enabled)('requires a reason for admin edits, writes audit records, records verification, and imports idempotently', async () => {
    const noReason=await request(`/api/entries/${captureId}`,{method:'PATCH',cookie:adminCookie,body:{patch:{name:'Synthetic Edited Supporter'},reason:''}});
    expect(noReason.response.status).toBe(400);
    const changed=await request(`/api/entries/${captureId}`,{method:'PATCH',cookie:adminCookie,body:{patch:{name:'Synthetic Edited Supporter'},reason:'Corrected during synthetic test'}});
    expect(changed.response.status).toBe(200);
    const audit=await request('/api/audit-log',{cookie:adminCookie});
    expect(audit.result.events.some((event)=>event.entity_id===captureId&&event.action==='update')).toBe(true);
    const verification=await request(`/api/verification/${captureId}`,{method:'POST',cookie:adminCookie,body:{status:'verified',note:'Synthetic register check'}});
    expect(verification.response.status).toBe(200);

    const created=await request('/api/imports',{method:'POST',cookie:adminCookie,body:{file_name:'synthetic-phase-c.csv',import_type:'entries'}});
    expect(created.response.status).toBe(201);
    const batch={rows:[{row_hash:'phase-c-synthetic-row-0001',name:'=Synthetic Imported Person',phone:'0700000011',national_id:'3456789',ward_id:wardA,polling_centre_id:centreA,polling_station_id:stationA,support_level:'leaning'}]};
    const beforeDryRun=await client.query("SELECT count(*)::int AS n FROM public.entries WHERE name='=Synthetic Imported Person'");
    const dryRun=await request('/api/imports/dry-run',{method:'POST',cookie:adminCookie,body:{...batch,import_type:'entries'}});
    expect(dryRun.response.status).toBe(200);expect(dryRun.result.dry_run).toBe(true);
    const afterDryRun=await client.query("SELECT count(*)::int AS n FROM public.entries WHERE name='=Synthetic Imported Person'");
    expect(afterDryRun.rows[0].n).toBe(beforeDryRun.rows[0].n);
    const first=await request(`/api/imports/${created.result.import.id}/batch`,{method:'POST',cookie:adminCookie,body:batch});
    const second=await request(`/api/imports/${created.result.import.id}/batch`,{method:'POST',cookie:adminCookie,body:batch});
    expect(first.response.status).toBe(200);expect(first.result).toEqual(expect.objectContaining({imported:1}));
    expect(second.response.status).toBe(200);expect(second.result.merged).toBe(1);
    const exported=await fetch(`${baseUrl}/api/exports/entries?format=csv`,{headers:{cookie:adminCookie}});
    expect(exported.status).toBe(200);expect(await exported.text()).toContain("'=Synthetic Imported Person");
    const logged=await client.query("SELECT count(*)::int AS n FROM public.exports_log WHERE user_id=(SELECT id FROM public.users WHERE phone=$1) AND export_type='entries'",[phones[0]]);
    expect(logged.rows[0].n).toBeGreaterThan(0);
  },60_000);

  it.skipIf(!enabled)('accepts generic public join and DSR responses and scopes dashboard data',async()=>{
    const joinBody={name:'Synthetic Public Join',phone:'0700000098',national_id:'4567890',ward_id:wardA,polling_centre_id:centreA,polling_station_id:stationA,pledge:true,consent:true,website:''};
    const joined=await request(`/api/public/join/${approvedReferral}`,{method:'POST',body:joinBody});
    expect(joined.response.status).toBe(200);expect(joined.result.message).toBeTruthy();
    const stored=await client.query("SELECT source,mobilizer_id,support_level,consent_at,national_id_masked FROM public.entries WHERE national_id='4567890'");
    expect(stored.rows[0].source).toBe('self_registered');expect(stored.rows[0].mobilizer_id).toBe(pendingId);expect(stored.rows[0].support_level).toBe('strong_supporter');expect(stored.rows[0].consent_at).toBeTruthy();expect(stored.rows[0].national_id_masked).not.toBe('4567890');
    const duplicate=await request(`/api/public/join/${approvedReferral}`,{method:'POST',body:joinBody});
    expect(duplicate.response.status).toBe(joined.response.status);expect(duplicate.result.message).toBe(joined.result.message);
    const dsr=await request('/api/public/dsr',{method:'POST',body:{request_type:'access',requester_name:'Synthetic DSR Requester',phone:'0700000019',details:'Synthetic test request',website:''}});
    expect(dsr.response.status).toBe(200);
    const queue=await request('/api/dsr',{cookie:adminCookie});expect(queue.response.status).toBe(200);const requestRow=queue.result.requests.find((row)=>row.requester_name==='Synthetic DSR Requester');expect(requestRow).toBeTruthy();
    const closed=await request(`/api/dsr/${requestRow.id}`,{method:'PATCH',cookie:adminCookie,body:{status:'completed',notes:'Synthetic request reviewed'}});expect(closed.response.status).toBe(200);
    const dashboard=await request('/api/dashboard',{cookie:mobilizerCookie});expect(dashboard.response.status).toBe(200);expect(dashboard.result.data_completeness.total).toBe(2);expect(dashboard.result.totals_by_ward.every((row)=>row.id===wardA)).toBe(true);
  },60_000);
});
