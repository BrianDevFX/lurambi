import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api/client.js';

type Place = { id: string; name: string; ward_id?: string; polling_centre_id?: string; station_number?: number };
type Places = { wards: Place[]; centres: Place[]; stations: Place[] };
type Props = { onAuthenticated: (user: any) => void };

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login'|'signup'>('login');
  const [places, setPlaces] = useState<Places>({ wards: [], centres: [], stations: [] });
  const [values, setValues] = useState({ full_name: '', phone: '', password: '', national_id: '', home_ward_id: '', home_polling_station_id: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'signup') return;
    api('/api/signup/places').then(setPlaces).catch((cause) => setError(cause.message));
  }, [mode]);

  const filteredStations = places.stations.filter((station) => !values.home_ward_id || station.ward_id === values.home_ward_id);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = mode === 'login'
        ? await api('/api/login', { method: 'POST', body: { phone: values.phone, password: values.password } })
        : await api('/api/signup', { method: 'POST', body: {
            full_name: values.full_name, phone: values.phone, password: values.password,
            national_id: values.national_id, home_ward_id: values.home_ward_id,
            home_polling_station_id: values.home_polling_station_id || null,
          } });
      onAuthenticated(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.');
    } finally { setBusy(false); }
  }

  return <main className="auth-shell"><section className="panel auth-panel">
    <h1>Lurambi Field Platform</h1>
    <p className="muted">{mode === 'login' ? 'Sign in with your phone and password.' : 'Register as a mobilizer.'}</p>
    <form onSubmit={submit} className="stack">
      {mode === 'signup' && <>
        <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={values.full_name} onChange={(e) => setValues({ ...values, full_name: e.target.value })}/></label>
        <label>National ID<input required inputMode="numeric" maxLength={8} autoComplete="off" value={values.national_id} onChange={(e) => setValues({ ...values, national_id: e.target.value.replace(/\D/g, '') })}/><small>7 or 8 digits</small></label>
        <label>Home ward (required)<select required value={values.home_ward_id} onChange={(e) => setValues({ ...values, home_ward_id: e.target.value, home_polling_station_id: '' })}><option value="">Select your home ward</option>{places.wards.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select><small>Choose your assigned ward. Captures filed under another ward are flagged. You can update this later in Profile.</small></label>
        <label>Home polling station <span className="muted">(optional)</span><select value={values.home_polling_station_id} onChange={(e) => setValues({ ...values, home_polling_station_id: e.target.value })}><option value="">None</option>{filteredStations.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label>
      </>}
      <label>Phone<input required inputMode="tel" autoComplete="tel" placeholder="07… or +254…" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })}/></label>
      <label>Password<input required type="password" minLength={mode === 'signup' ? 12 : 1} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })}/>{mode === 'signup' && <small>At least 12 characters</small>}</label>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
    </form>
    <button className="text-button" onClick={() => { setError(''); setMode(mode === 'login' ? 'signup' : 'login'); }}>
      {mode === 'login' ? 'Register as a mobilizer' : 'Back to sign in'}
    </button>
  </section></main>;
}
