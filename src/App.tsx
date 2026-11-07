import { useEffect, useState } from 'react';
import { AuthScreen } from './components/auth/AuthScreen';
import { AdminWorkspace } from './components/admin/AdminWorkspace';
import { MobilizerWorkspace } from './components/mobilizer/MobilizerWorkspace';
import { api } from './lib/api/client.js';

type User = { id: string; full_name: string; role: 'admin'|'ward_coordinator'|'mobilizer'; status: 'pending'|'approved'|'suspended'; phone: string; home_ward_id?: string; referral_code?: string; national_id_masked?: string };

export default function App() {
  const [user,setUser] = useState<User | null>(null);
  const [loading,setLoading] = useState(true);
  const [serviceError,setServiceError] = useState('');
  const isPrivacy = window.location.pathname === '/privacy' || window.location.pathname === '/privacy-notice';

  useEffect(() => {
    if (isPrivacy) { setLoading(false); return; }
    api('/api/me').then((data) => setUser(data.user)).catch((error) => {
      if (error.status === 401) setUser(null);
      else setServiceError(error.message || 'Service unavailable.');
    }).finally(() => setLoading(false));
  },[isPrivacy]);

  async function signOut() {
    try { await api('/api/logout',{method:'POST'}); } finally { setUser(null); }
  }

  if (isPrivacy) return <PrivacyNotice/>;
  if (loading) return <main className="auth-shell"><p>Loading…</p></main>;
  if (serviceError) return <main className="auth-shell"><section className="panel"><h1>Service unavailable</h1><p role="alert" className="error">{serviceError}</p><button onClick={() => window.location.reload()}>Try again</button></section></main>;
  if (!user) return <AuthScreen onAuthenticated={setUser}/>;
  if (user.status === 'pending' || user.status === 'suspended') return <main className="auth-shell"><section className="panel"><h1>{user.status === 'pending' ? 'Approval pending' : 'Account suspended'}</h1><p>{user.status === 'pending' ? 'A campaign administrator or your ward coordinator must approve your account before you can capture entries.' : 'Contact your campaign administrator for help.'}</p><button onClick={() => void signOut()}>Sign out</button></section></main>;
  if (user.role === 'mobilizer') return <MobilizerWorkspace user={user} onSignOut={() => void signOut()}/>;
  return <AdminWorkspace user={user} onSignOut={() => void signOut()}/>;
}

function PrivacyNotice() {
  return <main className="auth-shell"><article className="panel privacy"><a href="/">← Back</a><h1>Privacy Notice</h1>
    <p>The Lurambi Campaign Field Platform collects supporter names, phone numbers, National ID numbers, ward and polling-place details, support information, notes and consent records.</p>
    <p>The campaign uses these details to record and organize supporter engagement and follow up where consent has been given. Access is limited by account role. National ID values are stored by the campaign database and masked in the app.</p>
    <p>For a request to access, correct or delete your information, contact the campaign administrator. Do not submit another person’s information without their permission.</p>
  </article></main>;
}
