import { api, ApiClientError } from '../api/client.js';

export type OfflineResult={client_request_id:string;state:'queued'|'saved'|'duplicate-blocked'|'error';message:string;created_at:number};
type QueueItem=OfflineResult & {payload:Record<string,unknown>};
const databaseName='lurambi-field-platform';const storeName='offline_entries';

function openDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(databaseName,1);request.onupgradeneeded=()=>request.result.createObjectStore(storeName,{keyPath:'client_request_id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function transact<T>(operation:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(storeName,'readwrite');const request=operation(tx.objectStore(storeName));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.oncomplete=()=>db.close();tx.onerror=()=>{db.close();reject(tx.error);};});}

export function offlineSafePayload(payload:Record<string,unknown>):Record<string,unknown>{
  if(String(payload.national_id||'').trim())throw new Error('For privacy, entries with an ID must be saved while online.');
  const safePayload={...payload};delete safePayload.national_id;return safePayload;
}

export async function queueOfflineEntry(payload:Record<string,unknown>):Promise<void>{
  const safePayload=offlineSafePayload(payload);
  await transact((store)=>store.put({client_request_id:String(payload.client_request_id),state:'queued',message:'Waiting for a connection',created_at:Date.now(),payload:safePayload} satisfies QueueItem));
}

export async function listOfflineResults():Promise<OfflineResult[]>{
  const items=await transact((store)=>store.getAll());
  return (items as QueueItem[]).map(({client_request_id,state,message,created_at})=>({client_request_id,state,message,created_at})).sort((a,b)=>b.created_at-a.created_at);
}

export async function syncOfflineEntries():Promise<void>{
  if(!navigator.onLine)return;
  const items=await transact((store)=>store.getAll()) as QueueItem[];
  for(const item of items.filter((entry)=>entry.state==='queued'||entry.state==='error')){
    try{await api('/api/entries',{method:'POST',body:item.payload});await transact((store)=>store.put({...item,state:'saved',message:'Saved to the server'}));}
    catch(error){if(error instanceof ApiClientError&&error.status===409&&(error.data as {duplicate?:boolean}).duplicate){await transact((store)=>store.put({...item,state:'duplicate-blocked',message:'Server confirmed a duplicate'}));}
      else await transact((store)=>store.put({...item,state:'error',message:'Could not sync. This item is retained.'}));}
  }
}
