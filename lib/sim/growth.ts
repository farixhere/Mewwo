import type { GrowthStage } from './types.ts';

const DAY = 86_400_000;

/** Configurable schedule (days since birth). Growth is derived from the clock, never from clicks. */
export const GROWTH_SCHEDULE: { stage: GrowthStage; fromDay: number; label: string }[] = [
  { stage: 'young_kitten', fromDay: 0, label: 'Young kitten' },
  { stage: 'growing_kitten', fromDay: 14, label: 'Growing kitten' },
  { stage: 'adolescent', fromDay: 60, label: 'Adolescent' },
  { stage: 'adult', fromDay: 180, label: 'Adult cat' },
];

export function ageDays(bornAt: number, now: number): number {
  return Math.max(0, (now - bornAt) / DAY);
}

export function stageForAge(days: number): GrowthStage {
  let current: GrowthStage = 'young_kitten';
  for (const s of GROWTH_SCHEDULE) if (days >= s.fromDay) current = s.stage;
  return current;
}

export function stageLabel(stage: GrowthStage): string {
  return GROWTH_SCHEDULE.find((s) => s.stage === stage)?.label ?? stage;
}

/** 0..1 across the whole schedule, eased so early growth is visibly quicker. */
export function growthFraction(days: number): number {
  const full = GROWTH_SCHEDULE[GROWTH_SCHEDULE.length - 1]!.fromDay;
  const t = Math.min(1, days / full);
  return 1 - (1 - t) ** 1.6;
}

export interface Proportions {
  /** Whole-body scale relative to an adult. */
  scale: number;
  /** Kittens have proportionally big heads, ears and eyes. */
  head: number;
  ears: number;
  eyes: number;
  /** Kittens have short legs and rounder bodies. */
  legs: number;
  body: number;
  tail: number;
  /** Movement speed multiplier (units/sec relative to adult walk). */
  speed: number;
  /** How bouncy / clumsy movement feels, 1 = very. */
  clumsiness: number;
}

export function proportionsFor(days: number): Proportions {
  const g = growthFraction(days);
  const lerp = (a: number, b: number) => a + (b - a) * g;
  return {
    scale: lerp(0.38, 1),
    head: lerp(1.38, 1),
    ears: lerp(1.25, 1),
    eyes: lerp(1.45, 1),
    legs: lerp(0.68, 1),
    body: lerp(0.82, 1),
    tail: lerp(0.7, 1),
    speed: lerp(0.8, 1),
    clumsiness: lerp(1, 0.1),
  };
}

/** Behavioural parameters that shift with age. */
export function stageBehaviour(stage: GrowthStage) {
  switch (stage) {
    case 'young_kitten':
      return { sleepBias: 0.35, playBias: 0.25, attention: 0.6, explore: 0.0, needRate: 1.35 };
    case 'growing_kitten':
      return { sleepBias: 0.2, playBias: 0.3, attention: 0.8, explore: 0.8, needRate: 1.2 };
    case 'adolescent':
      return { sleepBias: 0.05, playBias: 0.2, attention: 1.0, explore: 1.2, needRate: 1.05 };
    default:
      return { sleepBias: 0.1, playBias: 0, attention: 1.0, explore: 1.0, needRate: 1.0 };
  }
}
