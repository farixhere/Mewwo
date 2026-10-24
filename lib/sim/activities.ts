import type { Activity, Needs } from './types.ts';

export interface ActivityDef {
  /** Duration range in minutes. */
  min: number;
  max: number;
  /** Total need change if the session runs to completion (scaled proportionally if cut short). */
  gains: Partial<Needs>;
  /** Extra change per minute (used for rest/sleep so longer naps restore more). */
  perMinute?: Partial<Needs>;
  awake: boolean;
  label: string;
}

export const ACTIVITY_DEFS: Record<Activity, ActivityDef> = {
  idle:            { min: 1,   max: 3,   gains: {}, awake: true, label: 'Sitting quietly' },
  wander:          { min: 2,   max: 6,   gains: { curiosity: 0.1, energy: -0.02 }, awake: true, label: 'Wandering' },
  look_around:     { min: 1,   max: 3,   gains: { curiosity: 0.06 }, awake: true, label: 'Looking around' },
  sniff:           { min: 1,   max: 3,   gains: { curiosity: 0.12 }, awake: true, label: 'Sniffing' },
  investigate:     { min: 3,   max: 8,   gains: { curiosity: 0.4, stress: 0.02 }, awake: true, label: 'Investigating' },
  eat:             { min: 2,   max: 5,   gains: { satiety: 0.5, comfort: 0.05 }, awake: true, label: 'Eating' },
  drink:           { min: 1,   max: 2,   gains: { hydration: 0.5 }, awake: true, label: 'Drinking' },
  groom:           { min: 4,   max: 12,  gains: { grooming: 0.6, stress: -0.05, comfort: 0.05 }, awake: true, label: 'Grooming' },
  scratch:         { min: 1,   max: 3,   gains: { comfort: 0.05, stress: -0.03 }, awake: true, label: 'Scratching' },
  stretch:         { min: 0.5, max: 1.5, gains: { comfort: 0.08 }, awake: true, label: 'Stretching' },
  rest:            { min: 8,   max: 30,  gains: { stress: -0.1 }, perMinute: { energy: 0.006, comfort: 0.006 }, awake: true, label: 'Resting' },
  sleep:           { min: 25,  max: 120, gains: { stress: -0.2 }, perMinute: { energy: 0.011, comfort: 0.002 }, awake: false, label: 'Sleeping' },
  play:            { min: 3,   max: 10,  gains: { play: 0.55, energy: -0.12, curiosity: 0.05, stress: -0.05 }, awake: true, label: 'Playing' },
  watch_bird:      { min: 3,   max: 12,  gains: { curiosity: 0.2, stress: -0.03 }, awake: true, label: 'Watching the birds' },
  hide:            { min: 10,  max: 35,  gains: { stress: -0.35, comfort: 0.05 }, awake: true, label: 'Hiding' },
  approach_person: { min: 1,   max: 2,   gains: { social: 0.1 }, awake: true, label: 'Coming to say hello' },
  rub:             { min: 1,   max: 3,   gains: { social: 0.3, stress: -0.05 }, awake: true, label: 'Rubbing against you' },
  seek_attention:  { min: 2,   max: 5,   gains: { social: 0.05 }, awake: true, label: 'Asking for attention' },
  retreat:         { min: 5,   max: 15,  gains: { stress: -0.25 }, awake: true, label: 'Taking a break' },
  litter:          { min: 1,   max: 2,   gains: { elimination: 1 }, awake: true, label: 'Using the litter tray' },
  explore:         { min: 0.5, max: 1,   gains: { curiosity: 0.05 }, awake: true, label: 'Heading outside' },
  return_home:     { min: 0.5, max: 1,   gains: {}, awake: true, label: 'Heading back in' },
};

/** Food / water one full session takes out of a bowl (bowl.amount is 0..1). */
export const BOWL_USE = { eat: 0.35, drink: 0.25 } as const;

/** Never-punitive floors: a cat left alone gets hungry and a bit wistful, never in danger. */
export const FLOORS = { satiety: 0.15, hydration: 0.2, energy: 0.1, comfort: 0.2, stressMax: 0.7 } as const;
