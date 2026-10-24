'use client';
import { create } from 'zustand';
import type { GameView } from '@/lib/server/game';
import { PollingTransport, type Transport } from './realtime';

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
  panel: null | 'inventory' | 'memories' | 'map' | 'settings' | 'cat';
  move: MoveDraft | null;
  moveCheck: { ok: boolean; reason?: string } | null;
  toasts: Toast[];
  busy: boolean;
  sound: { master: boolean; effects: boolean; ambient: boolean };

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
  now(): number;
}

let transport: Transport | null = null;
let toastId = 1;

function loadSound(): Store['sound'] {
  try {
    const raw = localStorage.getItem('mewwo.sound');
    if (raw) return { master: true, effects: true, ambient: true, ...JSON.parse(raw) };
  } catch { /* storage may be unavailable */ }
  return { master: true, effects: true, ambient: true };
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
  sound: { master: true, effects: true, ambient: true },

  start() {
    if (transport) return;
    set({ sound: loadSound() });
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

  now: () => Date.now() + get().clockOffset,
}));
