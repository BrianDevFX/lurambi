import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api/client.js';
import { AdminTools } from './AdminTools';

type User = { id: string; full_name: string; phone: string; national_id_masked: string | null; status: string; home_ward_name: string | null; referral_code: string | null };
type Entry = { id: string; name: string; phone_e164: string | null; national_id_masked: string | null; ward_name: string; polling_centre_name: string | null; station_name: string | null; flags: string[]; captured_on: string };
type Props = { user: { full_name: string; role: string }; onSignOut: () => void };

export function AdminWorkspace({ user, onSignOut }: Props) {
  const [tab,setTab] = useState('Mobilizers');
  const adminTabs=['Mobilizers','Entries','Flags','Verification','Import/Export','Places','Network','Audit Log','Settings'];
  const tabs=user.role==='admin'?adminTabs:['Mobilizers','Entries'];
  return <main className="workspace">
    <header className="topbar"><div><strong>Lurambi Field Platform</strong><small>{user.full_name} · {user.role === 'admin' ? 'Admin' : 'Ward Coordinator'}</small></div><button className="quiet-button" onClick={onSignOut}>Sign out</button></header>
    <nav className="role-tabs">{tabs.map(item=><button key={item} className={tab===item?'active':''} onClick={() => setTab(item)}>{item}</button>)}</nav>
    <section className="content">{tab === 'Mobilizers' ? <Mobilizers user={user}/> : tab==='Entries' ? <Entries canEdit={user.role==='admin'}/> : <AdminTools tab={tab}/>}</section>
  </main>;
}

function Mobilizers({ user }: { user: Props['user'] }) {
  const [status,setStatus] = useState('pending'); const [rows,setRows] = useState<User[]>([]); const [error,setError] = useState(''); const [message,setMessage] = useState(''); const [passwords,setPasswords] = useState<Record<string,string>>({}); const [busy,setBusy] = useState('');
  const load = useCallback(() => api(`/api/users?status=${status}`).then((data) => { setRows(data.users); setError(''); }).catch((cause) => setError(cause.message)),[status]);
  useEffect(() => { void load(); },[load]);

  async function act(id:string, action:'approve'|'suspend') {
    setBusy(id); setError(''); setMessage('');
    try { const data = await api(`/api/users/${id}/${action}`,{method:'POST'}); setMessage(`${data.user.full_name} ${action === 'approve' ? 'approved' : 'suspended'}.`); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed.'); }
    finally { setBusy(''); }
  }

  async function reset(id:string) {
    const password = passwords[id] || '';
    setBusy(id); setError(''); setMessage('');
    try { await api(`/api/users/${id}/password`,{method:'POST',body:{password}}); setPasswords((current) => ({...current,[id]:''})); setMessage('Password reset. Give the new password to the mobilizer securely.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Password reset failed.'); }
    finally { setBusy(''); }
  }

  return <div className="stack wide"><div><h1>Mobilizers</h1><p className="muted">Approve accounts and manage access.</p></div>
    <div className="filter-row"><label>Account status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="suspended">Suspended</option></select></label></div>
    {error && <p role="alert" className="error">{error}</p>}{message && <p role="status" className="success">{message}</p>}
    {!rows.length && !error && <section className="panel muted">No mobilizers in this status.</section>}
    <div className="cards">{rows.map((row) => <article className="panel user-card" key={row.id}><div className="user-heading"><div><h2>{row.full_name}</h2><p>{row.phone} · {row.home_ward_name || 'No home ward'}</p></div><span className={`status ${row.status}`}>{row.status}</span></div><p className="muted">ID {row.national_id_masked || 'Not available'}</p>
      {row.referral_code && <p className="muted">Referral code: {row.referral_code}</p>}
      {row.status === 'pending' && <div className="action-row"><button disabled={busy===row.id} onClick={() => void act(row.id,'approve')}>Approve</button><button className="danger-button" disabled={busy===row.id} onClick={() => void act(row.id,'suspend')}>Suspend</button></div>}
      {row.status === 'approved' && <button className="danger-button" disabled={busy===row.id} onClick={() => void act(row.id,'suspend')}>Suspend</button>}
      {user.role === 'admin' && row.status !== 'suspended' && <form className="reset-row" onSubmit={(e) => { e.preventDefault(); void reset(row.id); }}><input required minLength={12} type="password" autoComplete="new-password" placeholder="New password (12+ chars)" value={passwords[row.id] || ''} onChange={(e) => setPasswords((current) => ({...current,[row.id]:e.target.value}))}/><button disabled={busy===row.id}>Reset password</button></form>}
    </article>)}</div>
  </div>;
}

function Entries({canEdit}:{canEdit:boolean}) {
  const [rows,setRows] = useState<Entry[]>([]); const [error,setError] = useState('');
  const load=()=>api('/api/entries?limit=200').then((data) => setRows(data.entries)).catch((cause) => setError(cause.message));
  useEffect(() => { void load(); },[]);
  async function edit(entry:Entry){const name=window.prompt('Update name',entry.name);if(!name||name===entry.name)return;const reason=window.prompt('Reason for this edit');if(!reason)return;try{await api(`/api/entries/${entry.id}`,{method:'PATCH',body:{patch:{name},reason}});await load();}catch(cause){setError((cause as Error).message);}}
  return <div className="stack wide"><div><h1>Entries</h1><p className="muted">{canEdit?'Admin changes require a reason.':'Read-only list.'}</p></div>{error && <p role="alert" className="error">{error}</p>}<ul className="entry-list panel">{rows.map((entry) => <li key={entry.id}><strong>{entry.name}</strong><span>{entry.phone_e164 || 'No phone'} · ID {entry.national_id_masked || 'Pending'}</span><small>{entry.ward_name} · {entry.polling_centre_name || 'No centre'} · {entry.station_name || 'No station'}</small>{entry.flags?.length > 0 && <span className="badges">{entry.flags.map((flag) => <em key={flag}>{flag.replaceAll('_',' ')}</em>)}</span>}{canEdit&&<button onClick={()=>void edit(entry)}>Edit name</button>}</li>)}</ul></div>;
}
