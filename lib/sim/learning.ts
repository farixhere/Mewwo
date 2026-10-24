import { clamp01 } from './rng.ts';

/** Nudge a learned preference toward 1 with diminishing returns. */
export function reinforce(prefs: Record<string, number>, key: string, amount = 0.06): number {
  const cur = prefs[key] ?? 0.3;
  const next = clamp01(cur + (1 - cur) * amount);
  prefs[key] = next;
  return next;
}

/** Slowly fade a preference (used when something stops being fun). */
export function fade(prefs: Record<string, number>, key: string, amount = 0.02): void {
  if (prefs[key] === undefined) return;
  prefs[key] = clamp01(prefs[key]! - amount);
}

/** Familiarity grows quickly at first; a thoroughly investigated object stops being interesting. */
export function familiarize(fam: Record<string, number>, id: string, amount = 0.25): number {
  const cur = fam[id] ?? 0;
  const next = clamp01(cur + (1 - cur) * amount);
  fam[id] = next;
  return next;
}
