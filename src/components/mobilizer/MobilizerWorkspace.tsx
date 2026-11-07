import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../../lib/api/client.js';
import { listOfflineResults, queueOfflineEntry, syncOfflineEntries, type OfflineResult } from '../../lib/offline/queue';

type User = { id: string; full_name: string; phone: string; role: string; status: string; home_ward_id?: string; referral_code?: string; national_id_masked?: string };
type Place = { id: string; name: string; ward_id?: string; polling_centre_id?: string; station_number?: number };
type Entry = { id: string; name: string; phone_e164: string | null; national_id_masked: string | null; ward_name: string; polling_centre_name: string; station_name: string; flags: string[]; verification_status: string; captured_on: string };
type Props = { user: User; onSignOut: () => void };
const tabs = ['Search/Add','My List','My Link','Profile'] as const;

export function MobilizerWorkspace({ user, onSignOut }: Props) {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Search/Add');
  return <main className="workspace">
    <header className="topbar"><div><strong>Lurambi Field Platform</strong><small>{user.full_name} · Mobilizer</small></div><button className="quiet-button" onClick={onSignOut}>Sign out</button></header>
    <section className="content">
      {tab === 'Search/Add' && <Capture user={user}/>}
      {tab === 'My List' && <MyList/>}
      {tab === 'My Link' && <MyLink user={user}/>}
      {tab === 'Profile' && <Profile user={user}/>}
    </section>
    <nav className="bottom-tabs" aria-label="Mobilizer navigation">{tabs.map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</nav>
  </main>;
}

function Capture({ user }: { user: User }) {
  const [places, setPlaces] = useState<{ wards: Place[]; centres: Place[]; stations: Place[] }>({ wards: [], centres: [], stations: [] });
  const [consent, setConsent] = useState<{ version: string; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Entry[]>([]);
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<Entry | null>(null);
  const [offlineResults,setOfflineResults]=useState<OfflineResult[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const [form, setForm] = useState({ name: '', phone: '', national_id: '', ward_filed_id: user.home_ward_id || '', polling_centre_id: '', polling_station_id: '', support_level: 'not_assessed', issues: [] as string[], needs_transport: false, has_pvc: false, notes: '', consent: false, not_found_in_register: false });

  useEffect(() => {
    Promise.all([api('/api/signup/places'), api('/api/consent-policy')])
      .then(([placeResult, policy]) => { setPlaces(placeResult); setConsent(policy); })
      .catch((cause) => setError(cause.message));
  }, []);

  useEffect(()=>{let active=true;const refresh=async()=>{await syncOfflineEntries();const items=await listOfflineResults();if(active)setOfflineResults(items);};void refresh();window.addEventListener('online',refresh);return()=>{active=false;window.removeEventListener('online',refresh);};},[]);

  const centres = useMemo(() => places.centres.filter((item) => item.ward_id === form.ward_filed_id), [places.centres, form.ward_filed_id]);
  const stations = useMemo(() => places.stations.filter((item) => item.polling_centre_id === form.polling_centre_id), [places.stations, form.polling_centre_id]);

  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setResult(null);
    try {
      const data = await api(`/api/entries/search?q=${encodeURIComponent(query)}`);
      setMatches(data.entries); setSearched(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Search failed.'); setSearched(false); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setResult(null);
    try {
      const payload={ ...form, issues: form.issues, client_request_id: requestId.current };
      if(!navigator.onLine){await queueOfflineEntry(payload);setError('');setSearched(false);requestId.current=crypto.randomUUID();setOfflineResults(await listOfflineResults());return;}
      const data = await api('/api/entries', { method: 'POST', body: payload });
      setResult(data.entry); setForm({ ...form, name: '', phone: '', national_id: '', notes: '', consent: false, issues: [], not_found_in_register: false });
      requestId.current = crypto.randomUUID();
    } catch (cause: any) {
      if(cause instanceof TypeError&&!form.national_id.trim()){
        try{await queueOfflineEntry({...form,issues:form.issues,client_request_id:requestId.current});setError('');setSearched(false);requestId.current=crypto.randomUUID();setOfflineResults(await listOfflineResults());return;}catch(queueError){setError((queueError as Error).message);}
      }
      if (cause?.status === 409 && cause?.data?.duplicate) setError(`Duplicate blocked. Match: ${cause.data.existing.masked_name || 'name masked'} · ID ${cause.data.existing.national_id_masked || 'not available'}.`);
      else setError(cause instanceof Error ? cause.message : 'Could not save entry.');
    } finally { setBusy(false); }
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) { setForm((current) => ({ ...current, [key]: value })); }

  return <div className="stack wide">
    <div><h1>Search and add</h1><p className="muted">Search your list before adding an entry.</p></div>
    <form className="search-row" onSubmit={search}><input aria-label="Search your entries" minLength={3} placeholder="Name, phone or full ID" value={query} onChange={(e) => setQuery(e.target.value)}/><button disabled={busy}>Search</button></form>
    {searched && <section className="panel"><h2>Your matching entries</h2>{matches.length ? <ul className="entry-list">{matches.map((entry) => <EntryRow key={entry.id} entry={entry}/>)}</ul> : <p className="muted">No matches in your list.</p>}</section>}
    {searched && <form className="panel stack" onSubmit={submit}>
      <h2>New entry</h2>
      <label>Name<input required minLength={2} maxLength={160} value={form.name} onChange={(e) => update('name',e.target.value)}/></label>
      <div className="form-grid"><label>Phone<input inputMode="tel" placeholder="07… or +254…" value={form.phone} onChange={(e) => update('phone',e.target.value)}/></label><label>National ID<input inputMode="numeric" maxLength={8} value={form.national_id} onChange={(e) => update('national_id',e.target.value.replace(/\D/g,''))}/><small>Leave blank if unavailable.</small></label></div>
      <div className="form-grid"><label>Ward<select required value={form.ward_filed_id} onChange={(e) => setForm((current) => ({ ...current, ward_filed_id:e.target.value, polling_centre_id:'', polling_station_id:'' }))}><option value="">Select ward</option>{places.wards.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Polling centre<select required value={form.polling_centre_id} onChange={(e) => setForm((current) => ({ ...current, polling_centre_id:e.target.value, polling_station_id:'' }))}><option value="">Select centre</option>{centres.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Polling station<select required value={form.polling_station_id} onChange={(e) => update('polling_station_id',e.target.value)}><option value="">Select station</option>{stations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Support level<select value={form.support_level} onChange={(e) => update('support_level',e.target.value)}><option value="not_assessed">Not assessed</option><option value="strong_supporter">Strong supporter</option><option value="leaning">Leaning</option><option value="undecided">Undecided</option><option value="opposed">Opposed</option><option value="not_reached">Not reached</option></select></label></div>
      <fieldset><legend>Issues</legend><div className="check-grid">{['Transport','Healthcare','Education','Water','Roads','Jobs'].map((issue) => <label className="check" key={issue}><input type="checkbox" checked={form.issues.includes(issue)} onChange={(e) => update('issues',e.target.checked ? [...form.issues,issue] : form.issues.filter((item) => item!==issue))}/>{issue}</label>)}</div></fieldset>
      <div className="check-grid"><label className="check"><input type="checkbox" checked={form.needs_transport} onChange={(e) => update('needs_transport',e.target.checked)}/>Needs transport</label><label className="check"><input type="checkbox" checked={form.has_pvc} onChange={(e) => update('has_pvc',e.target.checked)}/>Has PVC</label><label className="check"><input type="checkbox" checked={form.not_found_in_register} onChange={(e) => update('not_found_in_register',e.target.checked)}/>Not found in register</label></div>
      <label>Notes<textarea rows={3} maxLength={2000} value={form.notes} onChange={(e) => update('notes',e.target.value)}/></label>
      {consent && <label className="consent"><input required type="checkbox" checked={form.consent} onChange={(e) => update('consent',e.target.checked)}/><span>{consent.text} <a href="/privacy" target="_blank" rel="noreferrer">Privacy Notice</a></span></label>}
      {error && <p role="alert" className="error">{error}</p>}
      {result && <p role="status" className="success">Saved. {result.flags?.length ? `Flags: ${result.flags.join(', ')}` : 'No flags.'}</p>}
      {offlineResults.filter(item=>item.state!=='saved').map(item=><p key={item.client_request_id} role="status" className={item.state==='error'?'error':'muted'}>{item.state}: {item.message}</p>)}
      <button disabled={busy || !consent || !form.consent}>{busy ? 'Saving…' : 'Save entry'}</button>
    </form>}
    {error && !searched && <p role="alert" className="error">{error}</p>}
  </div>;
}

function EntryRow({ entry }: { entry: Entry }) {
  return <li><strong>{entry.name}</strong><span>{entry.phone_e164 || 'No phone'} · ID {entry.national_id_masked || 'Pending'}</span><small>{entry.ward_name} · {entry.polling_centre_name} · {entry.station_name}</small><span className="badges">{entry.flags?.map((flag) => <em key={flag}>{flag.replaceAll('_',' ')}</em>)}</span></li>;
}

function MyList() {
  const [entries,setEntries] = useState<Entry[]>([]); const [error,setError] = useState('');
  useEffect(() => { api('/api/entries/mine').then((data) => setEntries(data.entries)).catch((cause) => setError(cause.message)); }, []);
  return <div className="stack wide"><div><h1>My list</h1><p className="muted">Your saved entries.</p></div>{error && <p role="alert" className="error">{error}</p>}<ul className="entry-list panel">{entries.map((entry) => <EntryRow key={entry.id} entry={entry}/>)}</ul></div>;
}

function MyLink({ user }: { user: User }) {
  const [qr,setQr] = useState(''); const [error,setError] = useState('');
  const link = user.referral_code ? `${window.location.origin}/join/${user.referral_code}` : '';
  useEffect(() => { if (link) QRCode.toDataURL(link,{width:220,margin:1}).then(setQr).catch(() => setError('Could not generate QR code.')); },[link]);
  return <div className="stack panel link-panel"><div><h1>My link</h1><p className="muted">Share this link to invite supporters.</p></div>{link ? <><code>{link}</code>{qr && <img className="qr" src={qr} alt="Referral QR code"/>}<div className="action-row"><button onClick={() => navigator.clipboard.writeText(link)}>Copy link</button><a className="button-link" href={`https://wa.me/?text=${encodeURIComponent(`Join our supporter list: ${link}`)}`} target="_blank" rel="noreferrer">Share</a></div></> : <p className="muted">Your link will appear after approval.</p>}{error && <p className="error">{error}</p>}</div>;
}

function Profile({ user }: { user: User }) {
  const [stats,setStats]=useState<any>(null);useEffect(()=>{api('/api/dashboard').then(setStats).catch(()=>undefined);},[]);
  return <section className="panel stack"><h1>Profile</h1><p><strong>{user.full_name}</strong></p><p>{user.phone}</p><p>ID {user.national_id_masked || 'Not available'}</p><p>Status: {user.status}</p>{stats&&<section><h2>My activity</h2><p>Entries: {stats.data_completeness?.total||0} · ID recorded: {stats.data_completeness?.id_present||0} · Phone recorded: {stats.data_completeness?.phone_present||0}</p></section>}</section>;
}
