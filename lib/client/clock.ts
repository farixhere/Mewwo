import type { GameView } from '@/lib/server/game';

/**
 * The household's local hour right now, advanced between polls so clocks and lighting never look frozen.
 * `clockOffset` is serverNow - clientNow at the last fetch (see the store).
 */
export function liveHour(view: Pick<GameView, 'now' | 'household'>, clockOffset: number, clientNow = Date.now()): number {
  const fetchedAtClient = view.now - clockOffset;
  const h = view.household.hour + Math.max(0, clientNow - fetchedAtClient) / 3_600_000;
  return ((h % 24) + 24) % 24;
}
