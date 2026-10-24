import { ACTIVITY_DEFS, FLOORS } from './activities.ts';
import { stageBehaviour } from './growth.ts';
import { clamp01 } from './rng.ts';
import type { Activity, GrowthStage, Needs, Personality } from './types.ts';

export const NEED_KEYS: (keyof Needs)[] = [
  'satiety', 'hydration', 'energy', 'comfort', 'play', 'curiosity', 'social', 'stress', 'grooming', 'elimination',
];

export function defaultNeeds(): Needs {
  return { satiety: 0.8, hydration: 0.8, energy: 0.8, comfort: 0.7, play: 0.5, curiosity: 0.5, social: 0.5, stress: 0.1, grooming: 0.7, elimination: 0.8 };
}

export function applyFloors(n: Needs): Needs {
  return {
    ...n,
    satiety: Math.max(FLOORS.satiety, clamp01(n.satiety)),
    hydration: Math.max(FLOORS.hydration, clamp01(n.hydration)),
    energy: Math.max(FLOORS.energy, clamp01(n.energy)),
    comfort: Math.max(FLOORS.comfort, clamp01(n.comfort)),
    play: clamp01(n.play),
    curiosity: clamp01(n.curiosity),
    social: clamp01(n.social),
    grooming: clamp01(n.grooming),
    elimination: clamp01(n.elimination),
    stress: Math.min(FLOORS.stressMax, clamp01(n.stress)),
  };
}

/** Background change over `dtHours` while doing `activity`. Pure and step-size independent enough for 5-minute steps. */
export function decay(n: Needs, activity: Activity, dtHours: number, p: Personality, stage: GrowthStage): Needs {
  const sb = stageBehaviour(stage);
  const asleep = !ACTIVITY_DEFS[activity].awake;
  const r = sb.needRate * dtHours;
  const metab = asleep ? 0.5 : 1;
  const out: Needs = { ...n };
  out.satiety -= 0.07 * r * metab;
  out.hydration -= 0.065 * r * metab;
  if (!asleep) out.energy -= 0.04 * r;
  out.comfort -= 0.03 * dtHours;
  out.play -= 0.05 * r * (0.5 + p.activity);
  out.curiosity -= 0.05 * r * (0.5 + p.curiosity);
  out.social -= 0.05 * r * (0.4 + p.sociability);
  out.grooming -= 0.04 * dtHours;
  out.elimination -= 0.06 * dtHours;
  // Stress settles toward a personality baseline, and rises a little if basic needs are unmet.
  const baseline = 0.05 + 0.15 * p.cautiousness;
  out.stress += (baseline - out.stress) * Math.min(1, 0.4 * dtHours);
  const unmet = [n.satiety, n.hydration, n.energy].filter((v) => v < 0.25).length;
  out.stress += unmet * 0.05 * dtHours;
  return out;
}

/** Add a fraction (0..1) of an activity's session gains. */
export function applyGains(n: Needs, activity: Activity, share: number, minutes: number, factor = 1): Needs {
  const def = ACTIVITY_DEFS[activity];
  const out: Needs = { ...n };
  for (const [k, v] of Object.entries(def.gains) as [keyof Needs, number][]) {
    out[k] += v * share * (k === 'satiety' || k === 'hydration' ? factor : 1);
  }
  if (def.perMinute) {
    for (const [k, v] of Object.entries(def.perMinute) as [keyof Needs, number][]) out[k] += v * minutes;
  }
  return out;
}

/** How urgent is the single most pressing need, 0..1. */
export function urgency(n: Needs): number {
  return Math.max(1 - n.satiety, 1 - n.hydration, 1 - n.elimination, 1 - n.energy) ;
}
