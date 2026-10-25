import type { GameView } from '@/lib/server/game';

/**
 * Real-time layer abstraction. The server and Neon stay authoritative; a transport only tells the client
 * "something changed, fetch the truth". Swap `PollingTransport` for a managed provider (Ably, Pusher...)
 * by implementing `Transport` and publishing a ping from the server after each committed change.
 */
export interface Transport {
  start(handlers: Handlers): void;
  stop(): void;
  /** Fetch authoritative state right now (after an action, on reconnect, or when an activity ends). */
  refresh(): Promise<void>;
  /** Ask for a refresh at a specific time (e.g. when the cat's current activity is due to end). */
  refreshAt(ms: number): void;
  /** Note the revision of state obtained outside polling (an action reply), so the next poll can be cheap. */
  adopt(rev: number): void;
}

export interface Handlers {
  onState(v: GameView): void;
  onStatus(s: 'online' | 'reconnecting'): void;
  onAuthLost(): void;
}

const FAST = 5_000;
const HIDDEN = 30_000;
const MAX_BACKOFF = 30_000;
const FULL_EVERY = 20_000;

export class PollingTransport implements Transport {
  private h!: Handlers;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wake: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private failures = 0;
  private rev = 0;
  private fullAt = 0;
  private inflight: Promise<void> | null = null;
  private onVis = () => { if (!document.hidden) void this.refresh(); };

  start(h: Handlers) {
    this.h = h;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVis);
    window.addEventListener('online', this.onVis);
    void this.refresh();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.wake) clearTimeout(this.wake);
    document.removeEventListener('visibilitychange', this.onVis);
    window.removeEventListener('online', this.onVis);
  }

  refreshAt(ms: number) {
    if (this.wake) clearTimeout(this.wake);
    const wait = Math.max(1_200, ms - Date.now());
    if (wait > 10 * 60_000) return;
    this.wake = setTimeout(() => void this.refresh(), wait);
  }

  /** Called when the client received fresh state some other way (an action reply). */
  adopt(rev: number) { this.rev = rev; this.fullAt = Date.now(); }

  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchOnce().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async fetchOnce() {
    if (this.timer) clearTimeout(this.timer);
    try {
      // Ask "has anything changed?" first; a full read at least every 20 s keeps needs and presence fresh.
      const cheap = this.rev > 0 && Date.now() - this.fullAt < FULL_EVERY;
      const res = await fetch(cheap ? `/api/state?rev=${this.rev}` : '/api/state', { cache: 'no-store' });
      if (res.status === 401) { this.h.onAuthLost(); return; }
      if (!res.ok) throw new Error(`state ${res.status}`);
      const body = (await res.json()) as GameView | { unchanged: true };
      this.failures = 0;
      this.h.onStatus('online');
      if ('unchanged' in body) { /* nothing new */ } else {
        this.rev = body.rev;
        this.fullAt = Date.now();
        this.h.onState(body);
      }
    } catch {
      this.failures += 1;
      this.h.onStatus('reconnecting');
    }
    if (!this.running) return;
    const base = document.hidden ? HIDDEN : FAST;
    const delay = this.failures ? Math.min(MAX_BACKOFF, base * 2 ** Math.min(this.failures, 4)) : base;
    this.timer = setTimeout(() => void this.refresh(), delay);
  }
}
