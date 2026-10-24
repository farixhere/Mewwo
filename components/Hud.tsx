'use client';
import { useEffect, useState } from 'react';
import { useGame } from '@/lib/client/store';
import { audio } from '@/lib/client/audio';
import { Sheets } from './Sheets';

const fmtClock = (hour: number) => {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`;
};
const phase = (h: number) => (h < 5 ? 'Night' : h < 9 ? 'Morning' : h < 17 ? 'Daytime' : h < 20 ? 'Evening' : 'Night');

export function Hud() {
  const view = useGame((s) => s.view)!;
  const panel = useGame((s) => s.panel);
  const openPanel = useGame((s) => s.openPanel);
  const select = useGame((s) => s.select);
  const sound = useGame((s) => s.sound);
  const move = useGame((s) => s.move);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(i); }, []);
  useEffect(() => { audio.configure(sound, view.household.daylight); }, [sound, view.household.daylight]);

  const c = view.cat;
  const partner = view.household.members.find((m) => m.id !== view.me.id);
  // Local clock advances between polls so it never looks frozen.
  const hour = (view.household.hour + (Date.now() - (view.now - useGame.getState().clockOffset)) / 3_600_000) % 24;
  const asleep = c.asleep;

  return (
    <>
      <div className="hud">
        <div className="top">
          <button className="chip" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => select({ kind: 'cat' })} aria-label={`About ${c.name}`}>
            <div className="name">{c.name} <span className="muted" style={{ fontWeight: 600 }}>· {c.stageLabel.toLowerCase()}</span></div>
            <div className="sub">{asleep ? '💤 ' : ''}{c.activityLabel} · feeling {c.mood}</div>
            {c.hints.length > 0 && (
              <div className="hints">{c.hints.map((h) => <span key={h.key}>• {h.text}</span>)}</div>
            )}
          </button>
          <div className="chip clock">
            <b>{fmtClock(hour)}</b>
            {phase(hour)}{partner ? <div>{partner.online ? `${partner.name} is here` : ''}</div> : null}
          </div>
        </div>
        {!move && (
          <nav className="dock" aria-label="Game menu">
            <button className={panel === 'inventory' ? 'on' : ''} onClick={() => { audio.unlock(); openPanel(panel === 'inventory' ? null : 'inventory'); }}><span className="ic">🎒</span>Bag</button>
            <button className={panel === 'memories' ? 'on' : ''} onClick={() => { audio.unlock(); openPanel(panel === 'memories' ? null : 'memories'); }}><span className="ic">📖</span>Memories</button>
            <button className={panel === 'map' ? 'on' : ''} onClick={() => { audio.unlock(); openPanel(panel === 'map' ? null : 'map'); }}><span className="ic">🗺️</span>Map</button>
            <button className={panel === 'settings' ? 'on' : ''} onClick={() => { audio.unlock(); openPanel(panel === 'settings' ? null : 'settings'); }}><span className="ic">⚙️</span>More</button>
          </nav>
        )}
      </div>
      <Sheets />
    </>
  );
}
