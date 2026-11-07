import { pool, databaseHealth } from './db.js';
import { getSessionUser, requireApproved, requireRoles } from './auth.js';
import { ApiError, json } from './http.js';
import { login, logout, me, signup, signupLocations } from './routes/auth.js';
import { captureEntry, consentPolicy, listEntries, listMyEntries, searchEntries } from './routes/entries.js';
import { createCentre, createStation, listCentres, listStations, listWards, renameCentre, renameStation } from './routes/places.js';
import { approveUser, listUsers, pendingUsers, resetPassword, suspendUser } from './routes/users.js';
import { auditLog, bulkVerification, contacts, flags, resolveFlag, setVerification, settings, updateContact, updateEntry, updateSetting, verificationQueue } from './routes/admin.js';
import { createImport, dryRunImport, importBatch, importHistory, placeAliases, saveAlias } from './routes/imports.js';
import { exportEntries, exportVerification } from './routes/exports.js';
import { exportDashboard, getDashboard } from './routes/dashboard.js';
import { listDsr, publicDsr, publicJoin, updateDsr } from './routes/public.js';

const key = (method, path) => `${method.toUpperCase()} ${path}`;
const staticRoutes = new Map([
  [key('GET','/api/health'), async (_request, _user, _url, response) => {
    const db = await databaseHealth();
    return json(response, 200, { ok: true, db });
  }],
  [key('GET','/api/signup/places'), signupLocations],
  [key('POST','/api/signup'), (_request, _user, _url, response, req) => signup(req, response)],
  [key('POST','/api/login'), (_request, _user, _url, response, req) => login(req, response)],
  [key('POST','/api/logout'), (_request, _user, _url, response) => logout(_request, response)],
  [key('GET','/api/me'), async (request, _user, _url, response) => me(request, response)],
  [key('GET','/api/places/wards'), async (request, user, _url, response) => { requireApproved(user); return listWards(user, request, response); }],
  [key('GET','/api/places/centres'), async (_request, user, url, response) => { requireApproved(user); return listCentres(user, url, response); }],
  [key('GET','/api/places/stations'), async (_request, user, url, response) => { requireApproved(user); return listStations(user, url, response); }],
  [key('GET','/api/consent-policy'), async (_request, user, url, response) => { requireApproved(user); return consentPolicy(user, url, response); }],
  [key('GET','/api/entries'), async (_request, user, url, response) => { requireRoles(user, ['admin','ward_coordinator','mobilizer']); return listEntries(user, url, response); }],
  [key('GET','/api/entries/mine'), async (_request, user, url, response) => { requireRoles(user, ['mobilizer']); return listMyEntries(user, url, response); }],
  [key('GET','/api/entries/search'), async (_request, user, url, response) => { requireRoles(user, ['mobilizer']); return searchEntries(user, url, response); }],
  [key('POST','/api/entries'), async (request, user, _url, response) => { requireRoles(user, ['mobilizer']); return captureEntry(user, request, response); }],
  [key('GET','/api/users/pending'), async (request, user, _url, response) => { requireRoles(user, ['admin','ward_coordinator']); return pendingUsers(user, request, response); }],
  [key('GET','/api/users'), async (_request, user, url, response) => { requireRoles(user, ['admin','ward_coordinator']); return listUsers(user, url, response); }],
]);

async function currentUser(request) {
  const user = await getSessionUser(request, pool);
  if (!user) throw new ApiError(401, 'Sign in required.');
  return user;
}

export async function route(request,response) {
  try {
    const url = new URL(request.url || '/', `https://${request.headers.host || 'localhost'}`);
    const forwardedPath = url.searchParams.get('__route');
    const pathname = forwardedPath ? `/api/${forwardedPath.replace(/^\/+/, '')}` : url.pathname;
    const method = request.method || 'GET';
    if (pathname === '/api/health' && method === 'GET') return await staticRoutes.get(key(method,pathname))(request,null,url,response);
    if (pathname === '/api/signup/places' && method === 'GET') return await signupLocations(request,response);
    if (pathname === '/api/signup' && method === 'POST') return await signup(request,response);
    if (pathname === '/api/login' && method === 'POST') return await login(request,response);
    if (pathname === '/api/logout' && method === 'POST') return await logout(request,response);
    if (pathname === '/api/me' && method === 'GET') return await me(request,response);
    if (pathname === '/api/public/dsr' && method === 'POST') return await publicDsr(request,request,response);
    const joinMatch=pathname.match(/^\/api\/public\/join\/([A-Z2-9]{6})$/i);
    if(joinMatch && method==='POST')return await publicJoin(request,request,response,joinMatch[1]);

    const user = await currentUser(request);
    const handler = staticRoutes.get(key(method,pathname));
    if (handler) return await handler(request,user,url,response);
    const actionMatch = pathname.match(/^\/api\/users\/([0-9a-f-]{36})\/(approve|suspend|password)$/i);
    if (actionMatch && method === 'POST' && actionMatch[2] === 'approve') return await approveUser(user,actionMatch[1],request,response);
    if (actionMatch && method === 'POST' && actionMatch[2] === 'suspend') return await suspendUser(user,actionMatch[1],request,response);
    if (actionMatch && method === 'POST' && actionMatch[2] === 'password') return await resetPassword(user,actionMatch[1],request,response);
    if (pathname === '/api/flags' && method === 'GET') { requireRoles(user,['admin']); return await flags(user,url,response); }
    const flagMatch=pathname.match(/^\/api\/flags\/([0-9a-f-]{36})\/resolve$/i);
    if(flagMatch && method==='POST'){requireRoles(user,['admin']);return await resolveFlag(user,flagMatch[1],request,response);}
    const entryEdit=pathname.match(/^\/api\/entries\/([0-9a-f-]{36})$/i);
    if(entryEdit && method==='PATCH'){requireRoles(user,['admin']);return await updateEntry(user,entryEdit[1],request,response);}
    if(pathname==='/api/verification' && method==='GET'){requireRoles(user,['admin']);return await verificationQueue(user,url,response);}
    const verifyMatch=pathname.match(/^\/api\/verification\/([0-9a-f-]{36})$/i);
    if(verifyMatch && method==='POST'){requireRoles(user,['admin']);return await setVerification(user,verifyMatch[1],request,response);}
    if(pathname==='/api/verification/bulk' && method==='POST'){requireRoles(user,['admin']);return await bulkVerification(user,request,response);}
    if(pathname==='/api/audit-log' && method==='GET'){requireRoles(user,['admin']);return await auditLog(user,url,response);}
    if(pathname==='/api/settings' && method==='GET'){requireRoles(user,['admin']);return await settings(user,url,response);}
    const settingMatch=pathname.match(/^\/api\/settings\/([a-z_]+)$/);
    if(settingMatch && method==='PUT'){requireRoles(user,['admin']);return await updateSetting(user,settingMatch[1],request,response);}
    if(pathname==='/api/imports' && method==='GET'){requireRoles(user,['admin']);return await importHistory(user,url,response);}
    if(pathname==='/api/imports' && method==='POST'){requireRoles(user,['admin']);return await createImport(user,request,response);}
    if(pathname==='/api/imports/dry-run' && method==='POST'){requireRoles(user,['admin']);return await dryRunImport(user,request,response);}
    const importMatch=pathname.match(/^\/api\/imports\/([0-9a-f-]{36})\/batch$/i);
    if(importMatch && method==='POST'){requireRoles(user,['admin']);return await importBatch(user,importMatch[1],request,response);}
    if(pathname==='/api/places/aliases' && method==='GET'){requireRoles(user,['admin']);return await placeAliases(user,url,response);}
    if(pathname==='/api/places/aliases' && method==='POST'){requireRoles(user,['admin']);return await saveAlias(user,request,response);}
    if(pathname==='/api/places/centres' && method==='POST'){requireRoles(user,['admin']);return await createCentre(user,request,response);}
    if(pathname==='/api/places/stations' && method==='POST'){requireRoles(user,['admin']);return await createStation(user,request,response);}
    const centreMatch=pathname.match(/^\/api\/places\/centres\/([0-9a-f-]{36})$/i);
    if(centreMatch&&method==='PATCH'){requireRoles(user,['admin']);return await renameCentre(user,centreMatch[1],request,response);}
    const stationMatch=pathname.match(/^\/api\/places\/stations\/([0-9a-f-]{36})$/i);
    if(stationMatch&&method==='PATCH'){requireRoles(user,['admin']);return await renameStation(user,stationMatch[1],request,response);}
    if(pathname==='/api/exports/entries' && method==='GET'){requireRoles(user,['admin','ward_coordinator','mobilizer']);return await exportEntries(user,url,response);}
    if(pathname==='/api/exports/verification' && method==='GET'){requireRoles(user,['admin']);return await exportVerification(user,url,response);}
    if(pathname==='/api/dashboard' && method==='GET'){requireRoles(user,['admin','ward_coordinator','mobilizer']);return await getDashboard(user,url,response);}
    if(pathname==='/api/exports/dashboard' && method==='GET'){requireRoles(user,['admin','ward_coordinator','mobilizer']);return await exportDashboard(user,url,response);}
    if(pathname==='/api/dsr' && method==='GET'){requireRoles(user,['admin']);return await listDsr(user,url,response);}
    const dsrMatch=pathname.match(/^\/api\/dsr\/([0-9a-f-]{36})$/i);
    if(dsrMatch && method==='PATCH'){requireRoles(user,['admin']);return await updateDsr(user,dsrMatch[1],request,response);}
    if(pathname==='/api/network-contacts' && method==='GET'){requireRoles(user,['admin']);return await contacts(user,url,response);}
    const contactMatch=pathname.match(/^\/api\/network-contacts\/([0-9a-f-]{36})$/i);
    if(contactMatch && method==='PATCH'){requireRoles(user,['admin']);return await updateContact(user,contactMatch[1],request,response);}
    return json(response,404,{ error:'Not found.' });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status
      : error?.code === '42501' ? 403
      : error?.code === '23505' ? 409
      : error?.code === '23514' ? 400
      : 500;
    const message = status < 500 ? error.message : 'Request failed.';
    return json(response,status,{ error:message, ...(error?.code && status < 500 ? { code:error.code } : {}) });
  }
}
