'use client';
import { useState } from 'react';
import { useGame } from '@/lib/client/store';
import type { GameView } from '@/lib/server/game';
import { audio } from '@/lib/client/audio';
import { LOCATIONS, OBJECT_DEFS } from '@/lib/world/catalog';

type V = GameView;

const fullness = (a: number) => (a > 0.8 ? 'Nicely full' : a > 0.4 ? 'About half full' : a > 0.05 ? 'Nearly empty' : 'Empty');

function ageText(days: number) {
  if (days < 1) return 'just arrived';
  if (days < 14) return `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} old`;
  if (days < 70) return `${Math.floor(days / 7)} weeks old`;
  return `${Math.floor(days / 30)} months old`;
}

function bondText(f: number) {
  if (f < 0.2) return 'Still getting to know you';
  if (f < 0.5) return 'Warming up to you';
  if (f < 0.8) return 'Comfortable with you';
  return 'Completely at ease with you';
}
const likes: Record<string, string> = { pet: 'cuddles', play: 'playtime', feed: 'mealtimes', treat: 'treats', call: 'following you around', water: 'fresh water' };

export function Sheets() {
  const sel = useGame((s) => s.selection);
  const panel = useGame((s) => s.panel);
  const move = useGame((s) => s.move);
  if (move) return <MoveBar />;
  if (sel?.kind === 'cat') return <CatSheet />;
  if (sel?.kind === 'object') return <ObjectSheet id={sel.id} />;
  if (panel === 'inventory') return <InventorySheet />;
  if (panel === 'memories') return <MemoriesSheet />;
  if (panel === 'map') return <MapSheet />;
  if (panel === 'settings') return <SettingsSheet />;
  return null;
}

function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <section className="sheet" role="dialog" aria-label={title}>
      <button className="close" onClick={onClose} aria-label="Close">×</button>
      <h2>{title}</h2>
      {sub && <div className="muted">{sub}</div>}
      {children}
    </section>
  );
}

function CatSheet() {
  const v = useGame((s) => s.view)!;
  const act = useGame((s) => s.act);
  const select = useGame((s) => s.select);
  const busy = useGame((s) => s.busy);
  const c = v.cat;
  const toys = v.objects.filter((o) => o.location === c.location && OBJECT_DEFS[o.type]?.tags.includes('toy'));
  const favToy = toys.slice().sort((a, b) => (c.favourites[`toy:${b.id}`] ?? 0) - (c.favourites[`toy:${a.id}`] ?? 0))[0];
  const me = v.relationships.find((r) => r.userId === v.me.id);
  return (
    <Sheet title={c.name} sub={`${c.stageLabel} · ${ageText(c.ageDays)}`} onClose={() => select(null)}>
      <div className="tags">
        {c.traits.map((t) => <span className="tag" key={t}>{t}</span>)}
        <span className="tag">{c.asleep ? '💤 ' : ''}{c.activityLabel}</span>
        <span className="tag">feeling {c.mood}</span>
      </div>
      {c.hints.length > 0 && <p className="muted" style={{ marginTop: 10 }}>{c.hints.map((h) => h.text).join(' · ')}</p>}
      {me && <p className="muted" style={{ marginTop: 6 }}>{bondText(me.familiarity)}{me.favourite && likes[me.favourite] ? ` · enjoys ${likes[me.favourite]} with you` : ''}.</p>}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => { audio.unlock(); void act({ type: 'pet' }); select(null); }}>🤚 Pet</button>
        <button className="btn" disabled={busy || (v.inventory.treat ?? 0) < 1} onClick={() => { audio.unlock(); void act({ type: 'treat' }, (x) => ({ ...x, inventory: { ...x.inventory, treat: Math.max(0, (x.inventory.treat ?? 0) - 1) } })); select(null); }}>
          🐟 Treat ({v.inventory.treat ?? 0})
        </button>
        <button className="btn" disabled={busy || !favToy} onClick={() => { audio.unlock(); if (favToy) void act({ type: 'play', toyId: favToy.id }); select(null); }}>🧶 Play</button>
      </div>
      <p className="muted" style={{ marginTop: 12 }}>Tip: tap the floor to call her over. She&apos;ll decide whether she fancies it.</p>
    </Sheet>
  );
}

function ObjectSheet({ id }: { id: string }) {
  const v = useGame((s) => s.view)!;
  const act = useGame((s) => s.act);
  const select = useGame((s) => s.select);
  const beginMove = useGame((s) => s.beginMove);
  const setViewLocation = useGame((s) => s.setViewLocation);
  const busy = useGame((s) => s.busy);
  const o = v.objects.find((x) => x.id === id);
  if (!o) return null;
  const def = OBJECT_DEFS[o.type]!;
  const amount = Number(o.state.amount ?? 0);
  const fav = Math.max(v.cat.favourites[`toy:${o.id}`] ?? 0, v.cat.favourites[`spot:${o.id}`] ?? 0);
  const setBowl = (a: number) => (x: V): V => ({ ...x, objects: x.objects.map((b) => (b.id === o.id ? { ...b, state: { ...b.state, amount: a } } : b)) });

  return (
    <Sheet title={def.label} sub={def.blurb} onClose={() => select(null)}>
      <div className="tags">
        {o.type === 'food_bowl' || o.type === 'water_bowl' ? <span className="tag">{fullness(amount)}</span> : null}
        {fav >= 0.6 ? <span className="tag">❤️ a favourite</span> : fav >= 0.45 ? <span className="tag">she likes this</span> : null}
        {!def.movable ? <span className="tag">fixed</span> : null}
      </div>
      <div className="row">
        {o.type === 'food_bowl' && (
          <button className="btn primary" disabled={busy || amount >= 0.9 || (v.inventory.kibble ?? 0) < 1}
            onClick={() => { audio.unlock(); void act({ type: 'feed', bowlId: o.id }, (x) => ({ ...setBowl(Math.min(1, amount + 0.6))(x), inventory: { ...x.inventory, kibble: Math.max(0, (x.inventory.kibble ?? 0) - 1) } })); select(null); }}>
            🍽️ Add food ({v.inventory.kibble ?? 0} left)
          </button>
        )}
        {o.type === 'water_bowl' && (
          <button className="btn primary" disabled={busy || amount >= 0.9} onClick={() => { audio.unlock(); void act({ type: 'water', bowlId: o.id }, setBowl(1)); select(null); }}>💧 Fresh water</button>
        )}
        {def.tags.includes('toy') && (
          <button className="btn primary" disabled={busy} onClick={() => { audio.unlock(); void act({ type: 'play', toyId: o.id }); select(null); }}>🧶 Play with it</button>
        )}
        {def.leadsTo && v.locations.includes(def.leadsTo) && (
          <button className="btn primary" onClick={() => { setViewLocation(def.leadsTo!); select(null); }}>🚪 Look {def.leadsTo === 'garden' ? 'outside' : 'inside'}</button>
        )}
        {def.movable && <button className="btn" onClick={() => beginMove(o.id)}>↔️ Move</button>}
      </div>
      {(o.type === 'food_bowl' || o.type === 'water_bowl') && amount >= 0.9 && <p className="muted" style={{ marginTop: 10 }}>Already topped up.</p>}
    </Sheet>
  );
}

function MoveBar() {
  const v = useGame((s) => s.view)!;
  const move = useGame((s) => s.move)!;
  const check = useGame((s) => s.moveCheck);
  const act = useGame((s) => s.act);
  const update = useGame((s) => s.updateMove);
  const cancel = useGame((s) => s.cancelMove);
  const busy = useGame((s) => s.busy);
  const o = v.objects.find((x) => x.id === move.id);
  if (!o) return null;
  const def = OBJECT_DEFS[o.type]!;
  return (
    <div className="move-bar" role="dialog" aria-label="Move furniture">
      <b>Moving: {def.label}</b>
      <div className="muted" style={{ color: check && !check.ok ? 'var(--warn)' : undefined }}>
        {check ? (check.ok ? 'Tap where it should go.' : check.reason) : 'Tap where it should go.'}
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy || !check?.ok} onClick={async () => {
          const ok = await act({ type: 'move', objectId: o.id, x: move.x, z: move.z, rotation: move.rotation, expectedVersion: o.version },
            (x) => ({ ...x, objects: x.objects.map((b) => (b.id === o.id ? { ...b, x: move.x, z: move.z, rotation: move.rotation } : b)) }));
          if (ok) cancel();
        }}>Place here</button>
        <button className="btn" onClick={() => update({ rotation: move.rotation + Math.PI / 2 })}>⟳ Rotate</button>
        <button className="btn ghost" onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}

function InventorySheet() {
  const v = useGame((s) => s.view)!;
  const openPanel = useGame((s) => s.openPanel);
  const beginMove = useGame((s) => s.beginMove);
  const loc = useGame((s) => s.viewLocation);
  const movable = v.objects.filter((o) => o.location === loc && OBJECT_DEFS[o.type]?.movable);
  return (
    <Sheet title="Bag" sub="Shared by both of you. More turns up every few hours, so nobody is ever stuck." onClose={() => openPanel(null)}>
      <div className="tags">
        <span className="tag">🍽️ Kibble × {v.inventory.kibble ?? 0}</span>
        <span className="tag">🐟 Treats × {v.inventory.treat ?? 0}</span>
      </div>
      <h3 style={{ marginTop: 16, fontSize: 16 }}>Rearrange {LOCATIONS[loc]?.label.toLowerCase()}</h3>
      <div className="row">
        {movable.map((o) => (
          <button className="btn" key={o.id} onClick={() => { openPanel(null); beginMove(o.id); }}>{OBJECT_DEFS[o.type]!.label}</button>
        ))}
        {movable.length === 0 && <span className="muted">Nothing movable here.</span>}
      </div>
    </Sheet>
  );
}

function MemoriesSheet() {
  const v = useGame((s) => s.view)!;
  const openPanel = useGame((s) => s.openPanel);
  return (
    <Sheet title={`${v.cat.name}'s scrapbook`} sub="The moments worth keeping." onClose={() => openPanel(null)}>
      <div className="scrap">
        {v.memories.map((m, i) => (
          <article className="card" key={m.id} style={{ ['--r' as string]: `${((i * 37) % 7 - 3) * 0.5}deg` }}>
            <h3>{m.title}</h3>
            {m.body && <p>{m.body}</p>}
            <div className="date">{new Date(m.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}{m.by ? ` · ${m.by}` : ''}</div>
          </article>
        ))}
        {v.memories.length === 0 && <p className="muted">Nothing yet. Give it a day.</p>}
      </div>
    </Sheet>
  );
}

function MapSheet() {
  const v = useGame((s) => s.view)!;
  const loc = useGame((s) => s.viewLocation);
  const setLoc = useGame((s) => s.setViewLocation);
  const openPanel = useGame((s) => s.openPanel);
  const items = [
    { id: 'home', label: 'Home', note: 'Her favourite place.' },
    { id: 'garden', label: 'Garden', note: 'Opens once she\'s a growing kitten.' },
    { id: 'neighbourhood', label: 'Neighbourhood', note: 'Coming later.' },
    { id: 'park', label: 'Park', note: 'Coming later.' },
  ];
  return (
    <Sheet title="Map" onClose={() => openPanel(null)}>
      <div className="locs">
        {items.map((l) => {
          const open = v.locations.includes(l.id);
          return (
            <button key={l.id} className={`loc ${loc === l.id ? 'on' : ''} ${open ? '' : 'locked'}`} disabled={!open} onClick={() => setLoc(l.id)}>
              <b>{open ? '' : '🔒 '}{l.label}</b>{v.cat.location === l.id ? <span className="tag" style={{ marginLeft: 8 }}>{v.cat.name} is here</span> : null}
              <div className="muted">{open ? (loc === l.id ? 'Viewing now' : 'Tap to look') : l.note}</div>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

function SettingsSheet() {
  const v = useGame((s) => s.view)!;
  const sound = useGame((s) => s.sound);
  const setSound = useGame((s) => s.setSound);
  const openPanel = useGame((s) => s.openPanel);
  const [invite, setInvite] = useState<{ code: string; link: string } | null>(null);
  const [err, setErr] = useState('');
  const toast = useGame((s) => s.toast);

  async function makeInvite() {
    setErr('');
    const res = await fetch('/api/household/invite', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data.error ?? 'Could not create a code.'); return; }
    setInvite({ code: data.code, link: `${window.location.origin}/?join=${encodeURIComponent(data.code)}` });
  }
  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  }
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('Couldn\'t copy. Select and copy it manually.', 'warn'); }
  };
  const partner = v.household.members.find((m) => m.id !== v.me.id);
  return (
    <Sheet title="More" sub={`${v.household.name} · ${v.household.timeZone}`} onClose={() => openPanel(null)}>
      <label className="sw">Sound<input type="checkbox" checked={sound.master} onChange={(e) => { audio.unlock(); setSound({ master: e.target.checked }); }} /></label>
      <label className="sw">Cat sounds & effects<input type="checkbox" checked={sound.effects} onChange={(e) => setSound({ effects: e.target.checked })} /></label>
      <label className="sw">Ambient (room tone, birds)<input type="checkbox" checked={sound.ambient} onChange={(e) => setSound({ ambient: e.target.checked })} /></label>
      <h3 style={{ marginTop: 16, fontSize: 16 }}>Household</h3>
      <p className="muted">{v.household.members.map((m) => m.name).join(' & ')}{partner ? '' : ' · waiting for your partner'}</p>
      {v.household.canInvite && !invite && <div className="row"><button className="btn primary" onClick={makeInvite}>Invite your partner</button></div>}
      {invite && (
        <div style={{ marginTop: 10 }}>
          <div className="tags"><span className="tag" style={{ fontSize: 18 }}>{invite.code}</span></div>
          <div className="row">
            <button className="btn" onClick={() => copy(invite.code)}>Copy code</button>
            <button className="btn" onClick={() => copy(invite.link)}>Copy link</button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>Valid for 7 days. It works once.</p>
        </div>
      )}
      {err && <div className="err">{err}</div>}
      <div className="row"><button className="btn ghost" onClick={signOut}>Sign out</button></div>
    </Sheet>
  );
}
