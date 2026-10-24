'use client';
import { useCallback, useEffect, useState } from 'react';
import { AuthScreen } from '@/components/AuthScreen';
import { GameShell } from '@/components/GameShell';
import { HouseholdSetup } from '@/components/HouseholdSetup';

type Me = { id: string; name: string; email: string; householdId: string | null } | null;

export default function Page() {
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store' });
      const data = await res.json();
      setMe(data.user);
      setError(false);
    } catch { setError(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <main className="screen"><div className="card"><h1>Can&apos;t reach Mewwo</h1><p className="muted">Check your connection and try again.</p>
        <div className="row"><button className="btn primary" onClick={() => void load()}>Retry</button></div></div></main>
    );
  }
  if (me === undefined) return <div className="loading" role="status"><div><div className="paw" aria-hidden>🐾</div><p>Loading…</p></div></div>;
  if (!me) return <AuthScreen onDone={() => void load()} />;
  if (!me.householdId) {
    return <HouseholdSetup name={me.name} onDone={() => void load()} onSignOut={async () => { await fetch('/api/auth/logout', { method: 'POST' }); void load(); }} />;
  }
  return <GameShell onAuthLost={() => { setMe(null); }} />;
}
