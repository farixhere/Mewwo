'use client';
import { useEffect, useState } from 'react';

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data;
}

export function HouseholdSetup({ name, onDone, onSignOut }: { name: string; onDone: () => void; onSignOut: () => void }) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [home, setHome] = useState('Our Home');
  const [cat, setCat] = useState('');
  const [tz, setTz] = useState('UTC');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); } catch { /* keep UTC */ }
    const q = new URLSearchParams(window.location.search).get('join');
    if (q) { setCode(q); setMode('join'); }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'create') await post('/api/household', { name: home, catName: cat, timeZone: tz });
      else await post('/api/household/join', { code });
      onDone();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <main className="screen">
      <form className="card" onSubmit={submit}>
        <h1>Hi {name} 👋</h1>
        <p className="muted">Start a home for your kitten, or join your partner&apos;s.</p>
        <div className="tabs">
          <button type="button" className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>Start a home</button>
          <button type="button" className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')}>I have a code</button>
        </div>
        {mode === 'create' ? (
          <>
            <label className="field">Name your home
              <input value={home} onChange={(e) => setHome(e.target.value)} maxLength={60} required />
            </label>
            <label className="field">Name your kitten
              <input value={cat} onChange={(e) => setCat(e.target.value)} maxLength={30} placeholder="Biscuit, Mochi, Luna…" required />
            </label>
            <label className="field">Time zone <span className="muted">(for her day and night)</span>
              <input value={tz} onChange={(e) => setTz(e.target.value)} required />
            </label>
          </>
        ) : (
          <label className="field">Invitation code
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-2345" autoCapitalize="characters" required />
          </label>
        )}
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row">
          <button className="btn primary" style={{ flex: 1 }} disabled={busy}>{busy ? 'One moment…' : mode === 'create' ? 'Bring her home' : 'Join'}</button>
          <button type="button" className="btn ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </form>
    </main>
  );
}
