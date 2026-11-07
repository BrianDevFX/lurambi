import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from './lib/api/client.js';
const AuthScreen=lazy(()=>import('./components/auth/AuthScreen').then(module=>({default:module.AuthScreen})));
const AdminWorkspace=lazy(()=>import('./components/admin/AdminWorkspace').then(module=>({default:module.AdminWorkspace})));
const MobilizerWorkspace=lazy(()=>import('./components/mobilizer/MobilizerWorkspace').then(module=>({default:module.MobilizerWorkspace})));
const PublicJoin=lazy(()=>import('./components/public/PublicPages').then(module=>({default:module.PublicJoin})));
const DsrForm=lazy(()=>import('./components/public/PublicPages').then(module=>({default:module.DsrForm})));

type User = { id: string; full_name: string; role: 'admin'|'ward_coordinator'|'mobilizer'; status: 'pending'|'approved'|'suspended'; phone: string; home_ward_id?: string; referral_code?: string; national_id_masked?: string };

export default function App() {
  const [user,setUser] = useState<User | null>(null);
  const [loading,setLoading] = useState(true);
  const [serviceError,setServiceError] = useState('');
  const path=window.location.pathname;
  const isPrivacy = path === '/privacy' || path === '/privacy-notice';
  const joinCode=path.match(/^\/join\/([A-Z2-9]{6})$/i)?.[1];
  const isDsr=path==='/dsr';
  const isPublic=isPrivacy||Boolean(joinCode)||isDsr;

  useEffect(() => {
    if (isPublic) { setLoading(false); return; }
    api('/api/me').then((data) => setUser(data.user)).catch((error) => {
      if (error.status === 401) setUser(null);
      else setServiceError(error.message || 'Service unavailable.');
    }).finally(() => setLoading(false));
  },[isPublic]);

  async function signOut() {
    try { await api('/api/logout',{method:'POST'}); } finally { setUser(null); }
  }

  if (isPrivacy) return <PrivacyNotice/>;
  if (joinCode) return <Suspense fallback={<main className="auth-shell"><p>Loading…</p></main>}><PublicJoin code={joinCode}/></Suspense>;
  if (isDsr) return <Suspense fallback={<main className="auth-shell"><p>Loading…</p></main>}><DsrForm/></Suspense>;
  if (loading) return <main className="auth-shell"><p>Loading…</p></main>;
  if (serviceError) return <main className="auth-shell"><section className="panel"><h1>Service unavailable</h1><p role="alert" className="error">{serviceError}</p><button onClick={() => window.location.reload()}>Try again</button></section></main>;
  if (!user) return <Suspense fallback={<main className="auth-shell"><p>Loading…</p></main>}><AuthScreen onAuthenticated={setUser}/></Suspense>;
  if (user.status === 'pending' || user.status === 'suspended') return <main className="auth-shell"><section className="panel"><h1>{user.status === 'pending' ? 'Approval pending' : 'Account suspended'}</h1><p>{user.status === 'pending' ? 'A campaign administrator or your ward coordinator must approve your account before you can capture entries.' : 'Contact your campaign administrator for help.'}</p><button onClick={() => void signOut()}>Sign out</button></section></main>;
  if (user.role === 'mobilizer') return <Suspense fallback={<main className="auth-shell"><p>Loading…</p></main>}><MobilizerWorkspace user={user} onSignOut={() => void signOut()}/></Suspense>;
  return <Suspense fallback={<main className="auth-shell"><p>Loading…</p></main>}><AdminWorkspace user={user} onSignOut={() => void signOut()}/></Suspense>;
}

function PrivacyNotice() {
  return <main className="auth-shell"><article className="panel privacy"><a href="/">← Back</a><h1>Privacy Notice</h1>
    <p>The Lurambi Campaign Field Platform collects supporter names, phone numbers, National ID numbers, ward and polling-place details, support information, notes and consent records.</p>
    <p>The campaign uses these details to record and organize supporter engagement and follow up where consent has been given. Access is limited by account role. National ID values are stored by the campaign database and masked in the app.</p>
    <p>For a request to access, correct or delete your information, use the <a href="/dsr">data request form</a>. Do not submit another person’s information without their permission.</p>
  </article></main>;
}
