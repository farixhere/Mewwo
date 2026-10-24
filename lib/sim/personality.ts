import type { Personality } from './types.ts';
import { clamp01, hashString, mulberry32 } from './rng.ts';

/** Create a persistent temperament for a new cat. Saved once; never re-rolled. */
export function rollPersonality(seed: string): Personality {
  const r = mulberry32(hashString(`personality:${seed}`));
  const trait = () => clamp01(0.15 + r() * 0.7 + (r() - 0.5) * 0.1);
  const p: Personality = {
    curiosity: trait(),
    playfulness: trait(),
    sociability: trait(),
    cautiousness: trait(),
    independence: trait(),
    activity: trait(),
  };
  // Mild coherence: a very cautious cat is a bit less curious.
  p.curiosity = clamp01(p.curiosity - (p.cautiousness - 0.5) * 0.2);
  return p;
}

/** Per-cat shift of the daily rhythm, so no two cats keep an identical schedule. */
export function chronotypeShift(catId: string): number {
  return (hashString(`chrono:${catId}`) % 500) / 100 - 2.5; // -2.5h .. +2.5h
}

export function describePersonality(p: Personality): string[] {
  const out: string[] = [];
  if (p.curiosity > 0.65) out.push('curious');
  if (p.curiosity < 0.35) out.push('settled');
  if (p.playfulness > 0.65) out.push('playful');
  if (p.sociability > 0.65) out.push('cuddly');
  if (p.sociability < 0.35) out.push('aloof');
  if (p.cautiousness > 0.65) out.push('shy');
  if (p.independence > 0.65) out.push('independent');
  if (p.activity > 0.65) out.push('energetic');
  if (p.activity < 0.35) out.push('laid-back');
  return out.slice(0, 3);
}
