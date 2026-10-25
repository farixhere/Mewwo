'use client';
import { create } from 'zustand';
import type { GameView } from '@/lib/server/game';
import { PollingTransport, type Transport } from './realtime';
import type { Body, Gaze } from '@/lib/sim/voice';
import { NEXT_HIGHER, NEXT_LOWER, detectQuality, type Quality, type QualityChoice } from './quality';

export type Selection =
  | { kind: 'cat' }
  | { kind: 'object'; id: string }
  | null;

export interface Toast { id: number; text: string; tone?: 'info' | 'warn' }

export interface MoveDraft { id: string; x: number; z: number; rotation: number }

interface Store {
  view: GameView | null;
  /** serverNow - clientNow at the last fetch, so every browser agrees on "now". */
  clockOffset: number;
  status: 'online' | 'reconnecting';
  authLost: boolean;
  selection: Selection;
  viewLocation: string;
  lastCatLocation: string | null;
  panel: null | 'inventory' | 'memories' | 'map' | 'settings' | 'cat' | 'build' | 'decor';
  move: MoveDraft | null;
  moveCheck: { ok: boolean; reason?: string } | null;
  toasts: Toast[];
  busy: boolean;
  sound: { master: boolean; effects: boolean; ambient: boolean; voice: number; captions: boolean };
  /** A short cat-sound caption such as "Mrrp!", or null. Never more than one, never a history. */
  caption: { id: number; text: string } | null;
  /** The posture and glance of the cat's current reaction (read by the 3D cat every frame). */
  voiceFx: { id: number; body: Body; gaze: Gaze; x: number; z: number; startedAt: number; dur: number; intensity: number } | null;
  /** Active render tier and what the player chose ('auto' lets the device and frame rate decide). */
  quality: Quality;
  qualityChoice: QualityChoice;
  /** Bumped to ask the camera to glide back to its default framing. */
  cameraNonce: number;

  start(): void;
  stop(): void;
  setView(v: GameView): void;
  select(s: Selection): void;
  openPanel(p: Store['panel']): void;
  setViewLocation(id: string): void;
  beginMove(id: string): void;
  updateMove(patch: Partial<MoveDraft>): void;
  setMoveCheck(c: { ok: boolean; reason?: string } | null): void;
  cancelMove(): void;
  act(action: Record<string, unknown>, optimistic?: (v: GameView) => GameView): Promise<boolean>;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
  setSound(p: Partial<Store['sound']>): void;
  showCaption(text: string): void;
  setVoiceFx(fx: Store['voiceFx']): void;
  setQualityChoice(c: QualityChoice): void;
  degradeQuality(): void;
  upgradeQuality(): void;
  recenter(): void;
  now(): number;
}

let transport: Transport | null = null;
let toastId = 1;

function loadSound(): Store['sound'] {
  try {
    const raw = localStorage.getItem('mewwo.sound');
    if (raw) return { master: true, effects: true, ambient: true, voice: 0.8, captions: true, ...JSON.parse(raw) };
  } catch { /* storage may be unavailable */ }
  return { master: true, effects: true, ambient: true, voice: 0.8, captions: true };
}

export const useGame = create<Store>((set, get) => ({
  view: null,
  clockOffset: 0,
  status: 'online',
  authLost: false,
  selection: null,
  viewLocation: 'home',
  lastCatLocation: null,
  panel: null,
  move: null,
  moveCheck: null,
  toasts: [],
  busy: false,
  sound: { master: true, effects: true, ambient: true, voice: 0.8, captions: true },
  caption: null,
  voiceFx: null,
  quality: 'medium',
  qualityChoice: 'auto',
  cameraNonce: 0,

  start() {
    if (transport) return;
    let choice: QualityChoice = 'auto';
    try {
      const raw = localStorage.getItem('mewwo.quality');
      if (raw === 'high' || raw === 'medium' || raw === 'low' || raw === 'auto') choice = raw;
    } catch { /* storage may be unavailable */ }
    set({ sound: loadSound(), qualityChoice: choice, quality: choice === 'auto' ? detectQuality() : choice });
    transport = new PollingTransport();
    transport.start({
      onState: (v) => get().setView(v),
      onStatus: (status) => set({ status }),
      onAuthLost: () => set({ authLost: true }),
    });
  },

  stop() {
    transport?.stop();
    transport = null;
  },

  setView(v) {
    const prev = get();
    const catLoc = v.cat.location;
    const patch: Partial<Store> = { view: v, clockOffset: v.now - Date.now() };
    if (prev.lastCatLocation !== catLoc) {
      patch.lastCatLocation = catLoc;
      patch.viewLocation = catLoc;
      if (prev.lastCatLocation) {
        patch.toasts = [...prev.toasts, { id: toastId++, text: catLoc === 'garden' ? `${v.cat.name} slipped out to the garden.` : `${v.cat.name} came back inside.` }];
      }
    }
    // A partner moved the thing I'm moving: drop my draft rather than fight over it.
    if (prev.move && prev.view) {
      const mine = prev.view.objects.find((o) => o.id === prev.move!.id);
      const theirs = v.objects.find((o) => o.id === prev.move!.id);
      if (mine && theirs && mine.version !== theirs.version) {
        patch.move = null;
        patch.toasts = [...(patch.toasts ?? prev.toasts), { id: toastId++, text: 'Your partner just moved that item.', tone: 'warn' }];
      }
    }
    set(patch as Store);
    transport?.refreshAt(v.cat.activityUntil - (v.now - Date.now()) + 300);
  },

  select: (selection) => set({ selection, panel: selection?.kind === 'cat' ? null : get().panel }),
  openPanel: (panel) => set({ panel, selection: panel ? null : get().selection }),
  setViewLocation: (viewLocation) => set({ viewLocation, panel: null }),

  beginMove(id) {
    const o = get().view?.objects.find((x) => x.id === id);
    if (!o) return;
    set({ move: { id, x: o.x, z: o.z, rotation: o.rotation }, selection: null });
  },
  updateMove: (patch) => set((s) => (s.move ? { move: { ...s.move, ...patch } } : {})),
  setMoveCheck: (moveCheck) => set({ moveCheck }),
  cancelMove: () => set({ move: null, moveCheck: null }),

  async act(action, optimistic) {
    const before = get().view;
    if (optimistic && before) set({ view: optimistic(before) });
    set({ busy: true });
    try {
      const res = await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { set({ authLost: true }); return false; }
      if (!res.ok) {
        get().toast(data.error ?? 'That didn\'t work.', 'warn');
        await transport?.refresh();            // reconcile any optimistic guess with the truth
        return false;
      }
      if (data.state) get().setView(data.state);
      if (data.message) get().toast(data.message);
      return true;
    } catch {
      get().toast('Connection hiccup. Trying again shortly.', 'warn');
      await transport?.refresh();
      return false;
    } finally {
      set({ busy: false });
    }
  },

  toast(text, tone) {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
    setTimeout(() => get().dismissToast(id), 4200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setSound(p) {
    const next = { ...get().sound, ...p };
    set({ sound: next });
    try { localStorage.setItem('mewwo.sound', JSON.stringify(next)); } catch { /* ignore */ }
  },

  showCaption(text) {
    const id = toastId++;
    set({ caption: { id, text } });
    setTimeout(() => { if (get().caption?.id === id) set({ caption: null }); }, 2400);
  },
  setVoiceFx: (voiceFx) => set({ voiceFx }),

  setQualityChoice(choice) {
    set({ qualityChoice: choice, quality: choice === 'auto' ? detectQuality() : choice });
    try { localStorage.setItem('mewwo.quality', choice); } catch { /* ignore */ }
  },
  // Frame-rate driven changes only apply while the player has left quality on auto.
  degradeQuality: () => { if (get().qualityChoice === 'auto') set({ quality: NEXT_LOWER[get().quality] }); },
  // Never climbs past what the device was judged capable of at start-up.
  upgradeQuality: () => {
    if (get().qualityChoice !== 'auto') return;
    const next = NEXT_HIGHER[get().quality];
    const rank = { low: 0, medium: 1, high: 2 } as const;
    if (rank[next] <= rank[detectQuality()]) set({ quality: next });
  },
  recenter: () => set((s) => ({ cameraNonce: s.cameraNonce + 1 })),

  now: () => Date.now() + get().clockOffset,
}));
