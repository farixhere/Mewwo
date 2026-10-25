'use client';
import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/lib/client/store';
import { audio } from '@/lib/client/audio';
import { liveHour } from '@/lib/client/clock';
import { LOCATIONS, OBJECT_DEFS } from '@/lib/world/catalog';
import { CatFace } from './CatFace';
import { Minimap } from './Minimap';
import { Sheets } from './Sheets';

const fmtClock = (hour: number) => {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const phase = (h: number) => (h < 5 ? ['Night', '🌙'] : h < 9 ? ['Morning', '🌅'] : h < 17 ? ['Daytime', '☀️'] : h < 20 ? ['Evening', '🌇'] : ['Night', '🌙']) as [string, string];

const ACTIVITY_ICON: Record<string, string> = {
  sleep: '💤', rest: '😌', eat: '🍽️', drink: '💧', play: '🧶', groom: '🧼', scratch: '🪵', stretch: '🙆', watch_bird: '🐦',
  hide: '📦', litter: '🧺', explore: '🌿', return_home: '🏠', rub: '💞', approach_person: '👋', seek_attention: '😽', sniff: '👃', investigate: '🔎', wander: '🐾', look_around: '👀', idle: '🐱', retreat: '🛋️',
};

function Bar({ label, value, tone }: { label: string; value: number; tone: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span>{label}</span>
      <i><b style={{ width: `${pct}%`, background: tone }} /></i>
    </div>
  );
}

function ActivityCard() {
  const view = useGame((s) => s.view)!;
  const now = useGame((s) => s.now);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 2000); return () => clearInterval(i); }, []);
  const c = view.cat;
  const span = Math.max(1, c.activityUntil - c.activitySince);
  const pct = Math.max(0, Math.min(1, (now() - c.activitySince) / span));
  return (
    <div className="activity" aria-live="polite">
      <span className="aic" aria-hidden>{ACTIVITY_ICON[c.activity] ?? '🐾'}</span>
      <div>
        <small>Current activity</small>
        <b>{c.activityLabel}</b>
        <i className="prog"><b style={{ width: `${Math.round(pct * 100)}%` }} /></i>
      </div>
    </div>
  );
}

export function Hud() {
  const view = useGame((s) => s.view)!;
  const panel = useGame((s) => s.panel);
  const selection = useGame((s) => s.selection);
  const openPanel = useGame((s) => s.openPanel);
  const select = useGame((s) => s.select);
  const act = useGame((s) => s.act);
  const toast = useGame((s) => s.toast);
  const recenter = useGame((s) => s.recenter);
  const setViewLocation = useGame((s) => s.setViewLocation);
  const sound = useGame((s) => s.sound);
  const move = useGame((s) => s.move);
  const clockOffset = useGame((s) => s.clockOffset);
  const caption = useGame((s) => s.caption);
  const lastCall = useRef(0);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(i); }, []);
  useEffect(() => { audio.configure(sound, view.household.daylight); }, [sound, view.household.daylight]);

  const c = view.cat;
  const partner = view.household.members.find((m) => m.id !== view.me.id);
  const hour = liveHour(view, clockOffset);
  const [phaseName, phaseIcon] = phase(hour);
  const happiness = (c.needs.comfort + c.needs.play + c.needs.social + c.needs.calm) / 4;

  const here = view.objects.filter((o) => o.location === c.location);
  const bowls = (type: string) => here.filter((o) => o.type === type).sort((a, b) => Number(a.state.amount ?? 0) - Number(b.state.amount ?? 0));
  const toys = here.filter((o) => OBJECT_DEFS[o.type]?.tags.includes('toy'));
  const favToy = toys.slice().sort((a, b) => (c.favourites[`toy:${b.id}`] ?? 0) - (c.favourites[`toy:${a.id}`] ?? 0))[0];

  const unlock = () => audio.unlock();
  // Call her from the front of the room. (Tapping the floor calls her to that spot instead.)
  const call = () => {
    unlock();
    const now = Date.now();
    if (now - lastCall.current < 2500) return;
    lastCall.current = now;
    ack();
    const b = LOCATIONS[c.location]!.bounds;
    void act({ type: 'call', x: (b.minX + b.maxX) / 2, z: b.maxZ - 1 });
  };
  // Instant acknowledgement: she perks up the moment you tap, before the server has answered.
  const ack = () => useGame.getState().setVoiceFx({ id: Date.now(), body: 'perk', gaze: 'player', x: 0, z: 0, startedAt: useGame.getState().now(), dur: 1.2, intensity: 0.4 });
  const pet = () => { unlock(); ack(); void act({ type: 'pet' }); };
  const play = () => {
    unlock();
    if (!favToy) { toast(`There's no toy in the ${c.location === 'garden' ? 'garden' : 'house'} to play with.`, 'warn'); return; }
    void act({ type: 'play', toyId: favToy.id });
  };
  const feed = () => {
    unlock();
    const bowl = bowls('food_bowl')[0];
    if (!bowl) { toast('There is no food bowl out here.', 'warn'); return; }
    const amount = Number(bowl.state.amount ?? 0);
    if (amount >= 0.9) { toast('The bowl is already full.'); return; }
    if ((view.inventory.kibble ?? 0) < 1) { toast('No kibble left right now. More turns up every few hours.', 'warn'); return; }
    void act({ type: 'feed', bowlId: bowl.id }, (x) => ({
      ...x,
      objects: x.objects.map((b) => (b.id === bowl.id ? { ...b, state: { ...b.state, amount: Math.min(1, amount + 0.6) } } : b)),
      inventory: { ...x.inventory, kibble: Math.max(0, (x.inventory.kibble ?? 0) - 1) },
    }));
  };
  const water = () => {
    unlock();
    const bowl = bowls('water_bowl')[0];
    if (!bowl) { toast('There is no water bowl out here.', 'warn'); return; }
    if (Number(bowl.state.amount ?? 0) >= 0.9) { toast('The water is already fresh.'); return; }
    void act({ type: 'water', bowlId: bowl.id }, (x) => ({ ...x, objects: x.objects.map((b) => (b.id === bowl.id ? { ...b, state: { ...b.state, amount: 1 } } : b)) }));
  };
  const toggle = (p: NonNullable<typeof panel>) => { unlock(); openPanel(panel === p ? null : p); };
  const home = () => {
    unlock();
    openPanel(null); select(null);
    setViewLocation(c.location);
    recenter();
  };

  const railItems: { id: string; icon: string; label: string; on: boolean; go: () => void }[] = [
    { id: 'home', icon: '🏠', label: 'Home', on: !panel && !selection, go: home },
    { id: 'map', icon: '🗺️', label: 'Map', on: panel === 'map', go: () => toggle('map') },
    { id: 'memories', icon: '📖', label: 'Memories', on: panel === 'memories', go: () => toggle('memories') },
    { id: 'inventory', icon: '🎒', label: 'Inventory', on: panel === 'inventory', go: () => toggle('inventory') },
    { id: 'settings', icon: '⚙️', label: 'Settings', on: panel === 'settings', go: () => toggle('settings') },
  ];
  const dock: { id: NonNullable<typeof panel>; icon: string; label: string }[] = [
    { id: 'inventory', icon: '🎒', label: 'Inventory' },
    { id: 'build', icon: '🔨', label: 'Build' },
    { id: 'decor', icon: '🪴', label: 'Decor' },
    { id: 'map', icon: '🗺️', label: 'Map' },
  ];

  return (
    <>
      <div className="hud">
        <div className="top">
          <div className="left-col">
            <button className="pill cat-pill" onClick={() => select({ kind: 'cat' })} aria-label={`About ${c.name}`}>
              <CatFace seed={c.coatSeed} asleep={c.asleep} />
              <div className="cp-body">
                <div className="name">{c.name} <span>· {c.stageLabel.toLowerCase()}</span></div>
                <div className="bars">
                  <Bar label="Hunger" value={c.needs.food} tone="#FF9994" />
                  <Bar label="Thirst" value={c.needs.water} tone="#8CCBF0" />
                  <Bar label="Energy" value={c.needs.energy} tone="#F4C86A" />
                  <Bar label="Happiness" value={happiness} tone="#B8D2AE" />
                </div>
              </div>
            </button>
            <ActivityCard />
            {caption && <div className="caption" key={caption.id} role="status" aria-label="Cat sound">{caption.text}</div>}
          </div>
          <div className="pill time-pill">
            <span aria-hidden>{phaseIcon}</span>
            <div><b>{fmtClock(hour)}</b><small>{phaseName}{partner?.online ? ` · ${partner.name} is here` : ''}</small></div>
          </div>
        </div>

        {!move && (
          <nav className="rail" aria-label="Main menu">
            {railItems.map((r) => (
              <button key={r.id} className={r.on ? 'on' : ''} onClick={r.go} aria-label={r.label} title={r.label}>
                <span aria-hidden>{r.icon}</span><small>{r.label}</small>
              </button>
            ))}
          </nav>
        )}

        {!move && (
          <div className="bottom">
            <div className="bottom-main">
              <div className="actions" role="group" aria-label="Care actions">
                <button className="act call" onClick={call}><span aria-hidden>📣</span>Call</button>
                <button className="act pet" onClick={pet}><span aria-hidden>🤚</span>Pet</button>
                <button className="act play" onClick={play}><span aria-hidden>🧶</span>Play</button>
                <button className="act feed" onClick={feed}><span aria-hidden>🍽️</span>Feed</button>
                <button className="act water" onClick={water}><span aria-hidden>💧</span>Water</button>
              </div>
              <nav className="dock" aria-label="Game menu">
                {dock.map((d) => (
                  <button key={d.id} className={panel === d.id ? 'on' : ''} onClick={() => toggle(d.id)}><span className="ic" aria-hidden>{d.icon}</span>{d.label}</button>
                ))}
              </nav>
            </div>
            <Minimap />
          </div>
        )}
      </div>
      <Sheets />
    </>
  );
}
