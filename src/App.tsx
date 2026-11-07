import { useEffect, useState } from 'react';

type Health = { ok: boolean; db: boolean };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/health', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('API unavailable');
        return response.json() as Promise<Health>;
      })
      .then((result) => { if (active) setHealth(result); })
      .catch(() => { if (active) setHealth({ ok: false, db: false }); });
    return () => { active = false; };
  }, []);

  return (
    <main>
      <section>
        <h1>Lurambi Field Platform</h1>
        <p>
          {health === null ? 'Checking service…' : health.ok && health.db ? 'Service is ready.' : 'Service is unavailable.'}
        </p>
      </section>
    </main>
  );
}
