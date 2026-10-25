'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useGame } from '@/lib/client/store';
import { Hud } from './Hud';
import { CatVoice } from './CatVoice';

// Three.js is browser-only and large: load it after the shell so the first paint is fast.
const GameCanvas = dynamic(() => import('./scene/GameCanvas').then((m) => m.GameCanvas), {
  ssr: false,
  loading: () => <Loading text="Setting up the living room…" />,
});

function Loading({ text }: { text: string }) {
  return (
    <div className="loading" role="status">
      <div><div className="paw" aria-hidden>🐾</div><p>{text}</p></div>
    </div>
  );
}

const VISIT_KEY = 'mewwo.lastVisit';

export function GameShell({ onAuthLost }: { onAuthLost: () => void }) {
  const start = useGame((s) => s.start);
  const stop = useGame((s) => s.stop);
  const view = useGame((s) => s.view);
  const status = useGame((s) => s.status);
  const authLost = useGame((s) => s.authLost);
  const toasts = useGame((s) => s.toasts);
  const [away, setAway] = useState<{ lines: string[] } | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => { start(); return () => stop(); }, [start, stop]);
  useEffect(() => { if (authLost) onAuthLost(); }, [authLost, onAuthLost]);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 9000); return () => clearTimeout(t); }, []);

  // "While you were away": reconstructed from what actually happened since the last visit on this device.
  const first = !!view;
  useEffect(() => {
    if (!first) return;
    const v = useGame.getState().view!;
    let last = 0;
    try { last = Number(localStorage.getItem(VISIT_KEY) ?? 0); } catch { /* storage unavailable */ }
    if (last && Date.now() - last > 20 * 60_000) {
      const fresh = v.memories.filter((m) => m.at > last).map((m) => m.title);
      const lines = [`${v.cat.name} is ${v.cat.asleep ? 'fast asleep' : v.cat.activityLabel.toLowerCase()}.`, ...fresh.slice(0, 3)];
      setAway({ lines });
    }
    const mark = () => { try { localStorage.setItem(VISIT_KEY, String(Date.now())); } catch { /* ignore */ } };
    mark();
    const i = setInterval(mark, 60_000);
    window.addEventListener('pagehide', mark);
    return () => { clearInterval(i); window.removeEventListener('pagehide', mark); };
  }, [first]);

  if (!view) {
    return (
      <Loading text={status === 'reconnecting' || slow ? 'Having trouble reaching the house. Still trying…' : 'Waking the kitten…'} />
    );
  }

  return (
    <>
      {status === 'reconnecting' && <div className="banner" role="status">Reconnecting… your changes are safe on the server.</div>}
      <main className="stage" aria-label="3D home"><GameCanvas /></main>
      <Hud />
      <CatVoice />
      {away && (
        <section className="sheet" role="dialog" aria-label="While you were away">
          <button className="close" onClick={() => setAway(null)} aria-label="Close">×</button>
          <h2>Welcome back</h2>
          <p className="muted">While you were away:</p>
          <ul style={{ paddingLeft: 18, margin: '8px 0 0' }}>{away.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <div className="row"><button className="btn primary" onClick={() => setAway(null)}>Say hello</button></div>
        </section>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone ?? ''}`}>{t.text}</div>)}
      </div>
    </>
  );
}
