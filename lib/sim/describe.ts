import { ACTIVITY_DEFS } from './activities.ts';
import type { Activity, Needs } from './types.ts';

export interface Hint { key: string; text: string; level: 1 | 2 | 3 }

/** Natural-language care notes instead of progress bars. Most important first, at most three. */
export function careHints(n: Needs): Hint[] {
  const h: Hint[] = [];
  if (n.satiety < 0.45) h.push({ key: 'food', text: n.satiety < 0.25 ? 'Really hoping for a meal' : 'Looking for something to eat', level: n.satiety < 0.25 ? 3 : 2 });
  if (n.hydration < 0.45) h.push({ key: 'water', text: n.hydration < 0.3 ? 'Thirsty' : 'A little thirsty', level: n.hydration < 0.3 ? 3 : 2 });
  if (n.elimination < 0.25) h.push({ key: 'litter', text: 'Needs the litter tray soon', level: 2 });
  if (n.stress > 0.4) h.push({ key: 'stress', text: n.stress > 0.55 ? 'Wants a quiet moment' : 'A little uneasy', level: n.stress > 0.55 ? 3 : 2 });
  if (n.energy < 0.35) h.push({ key: 'sleep', text: 'Getting sleepy', level: 1 });
  if (n.play < 0.3) h.push({ key: 'play', text: 'Bored — would love to play', level: 1 });
  if (n.social < 0.3) h.push({ key: 'social', text: 'Wants some company', level: 1 });
  return h.sort((a, b) => b.level - a.level).slice(0, 3);
}

export function activityLabel(a: Activity): string {
  return ACTIVITY_DEFS[a]?.label ?? 'Being a cat';
}

/** One soft word for the overall feeling. Deliberately imprecise: body language is context, not a gauge. */
export function moodWord(n: Needs, a: Activity): string {
  if (a === 'sleep') return 'asleep';
  if (n.stress > 0.5) return 'uneasy';
  if (a === 'play') return 'playful';
  if (a === 'rub' || a === 'approach_person') return 'affectionate';
  if (n.energy < 0.3) return 'drowsy';
  if (n.stress < 0.15 && n.comfort > 0.55) return 'content';
  return 'calm';
}
