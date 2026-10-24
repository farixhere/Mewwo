'use client';
import { useState } from 'react';

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data;
}

export function AuthScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'register') await post('/api/auth/register', { email, password, displayName: name });
      else await post('/api/auth/login', { email, password });
      onDone();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <main className="screen">
      <form className="card" onSubmit={submit}>
        <div style={{ fontSize: 40 }} aria-hidden>🐾</div>
        <h1>Mewwo</h1>
        <p className="muted">Two hearts, one little life. Raise a kitten together.</p>
        <div className="tabs" role="tablist">
          <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Create account</button>
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button>
        </div>
        {mode === 'register' && (
          <label className="field">Your name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={40} required />
          </label>
        )}
        <label className="field">Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label className="field">Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={8} required />
        </label>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row"><button className="btn primary" style={{ flex: 1 }} disabled={busy}>{busy ? 'One moment…' : mode === 'register' ? 'Create account' : 'Sign in'}</button></div>
      </form>
    </main>
  );
}
