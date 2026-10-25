import type { Activity, CatSim, Needs, Personality } from './types.ts';
import { clamp01, hashString, mulberry32 } from './rng.ts';

/**
 * The cat's voice: a small, authored, deterministic communication model. There is no text generation here.
 * Every outcome is a choice from fixed tables (a sound, a caption, a glance, a posture), made with a seeded
 * random generator so both owners get the same result, and silence is always a valid result.
 */

export const VOCALS = ['none', 'meow', 'meow_soft', 'meow_plea', 'chirp', 'trill', 'chatter', 'purr', 'hiss'] as const;
export type Vocal = (typeof VOCALS)[number];

/** Short cat-like captions, never sentences. Index 0 is "no caption". */
export const CAPTIONS = ['', 'Mew?', 'Mrrp!', 'Prrrr…', 'Meeeow!', '…', 'Prrp?', 'Mew…', 'Ksss!', 'Ek-ek-ek'] as const;
export const GAZES = ['none', 'player', 'food', 'water', 'away'] as const;
export type Gaze = (typeof GAZES)[number];
export const BODIES = ['none', 'greet', 'lean', 'recoil', 'alert', 'settle', 'perk'] as const;
export type Body = (typeof BODIES)[number];

export const EVENT_KINDS = [
  'call_noticed', 'call_ignored', 'call_unheard', 'call_arrived',
  'pet_ok', 'pet_overstim', 'pet_asleep', 'pet_wary',
  'treat', 'play_go', 'play_wait', 'play_tired',
  'activity',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** 1 (idle chatter) .. 5 (distress). A louder priority may cut across a quieter sound, never the reverse. */
export type Priority = 1 | 2 | 3 | 4 | 5;

export interface Reaction {
  kind: EventKind;
  sound: Vocal;
  /** Index into CAPTIONS. */
  caption: number;
  gaze: Gaze;
  body: Body;
  /** 0..1, how loud and long. */
  intensity: number;
  priority: Priority;
}

export const SILENT: Reaction = { kind: 'activity', sound: 'none', caption: 0, gaze: 'none', body: 'none', intensity: 0, priority: 1 };

// ---------------------------------------------------------------- personality

export interface VoiceTraits {
  /** How chatty this cat is by nature (stable per cat). */
  vocal: number;
  /** How much handling she puts up with before she has had enough. */
  tolerance: number;
}

/**
 * Derived from the traits the cat already has, plus a stable per-cat quirk, so nothing new needs saving
 * and existing cats keep the personality they were born with.
 */
export function voiceTraits(p: Personality, catId: string): VoiceTraits {
  const quirk = (hashString(`voice:${catId}`) % 1000) / 1000;
  const vocal = clamp01(0.2 + 0.7 * quirk + 0.1 * (p.sociability - 0.5));
  const tolerance = clamp01(0.2 + 0.35 * p.sociability + 0.2 * (1 - p.cautiousness) + 0.15 * (1 - p.independence) + 0.1 * quirk);
  return { vocal, tolerance };
}

/** How many pets in a row she accepts before she has had enough. */
export const petLimit = (t: VoiceTraits) => Math.round(3 + 7 * t.tolerance);
/** A streak is "in a row" if each pet comes within this many ms of the last. */
export const PET_STREAK_MS = 25_000;

// ---------------------------------------------------------------- decisions

export interface EventInput {
  kind: EventKind;
  catId: string;
  /** Anything that makes this occurrence unique (a timestamp), so repeats vary but replays match. */
  salt: string | number;
  personality: Personality;
  needs: Needs;
  activity: Activity;
  /** Metres between the cat and where the owner is (call) or touched (pet). */
  distance?: number;
  /** How well she knows the person acting, 0..1. */
  familiarity?: number;
  /** Consecutive pets, including this one. */
  streak?: number;
  /** Who she is heading toward and how she knows them (activity reactions only). */
  social?: { style: 'playmate' | 'cuddler' | 'caretaker' | 'new'; greeting: boolean; invite: boolean };
}

const speaks = (r: () => number, p: number) => r() < clamp01(p);

/** Decide what the cat says and does for one event. Pure and seeded. */
export function decideReaction(i: EventInput): Reaction {
  const r = mulberry32(hashString(`${i.catId}|${i.kind}|${i.salt}`));
  const t = voiceTraits(i.personality, i.catId);
  const asleep = i.activity === 'sleep';
  const n = i.needs;
  const fam = i.familiarity ?? 0.3;
  const d = i.distance ?? 3;
  const base = (over: Partial<Reaction>): Reaction => ({ ...SILENT, kind: i.kind, ...over });
  // Caption is shown only some of the time, so text never turns into narration.
  const cap = (idx: number) => (r() < 0.65 ? idx : 0);

  switch (i.kind) {
    case 'call_unheard':
      return base({ priority: 1 });
    case 'call_noticed': {
      // She is coming over: look, perk up, and sometimes announce herself.
      const near = d < 4;
      if (speaks(r, 0.25 + 0.55 * t.vocal + 0.1 * fam)) {
        const trill = r() < 0.4 + 0.3 * i.personality.sociability;
        return base({ sound: near && !trill ? 'meow' : trill ? 'trill' : 'chirp', caption: cap(trill ? 2 : 1), gaze: 'player', body: 'perk', intensity: 0.5 + 0.3 * t.vocal, priority: 3 });
      }
      return base({ gaze: 'player', body: 'perk', priority: 3 });
    }
    case 'call_ignored': {
      // She heard, and has other plans. Usually just ears and eyes; occasionally a small acknowledgement.
      if (!asleep && speaks(r, 0.08 + 0.3 * t.vocal * (0.5 + fam))) {
        return base({ sound: 'meow_soft', caption: cap(7), gaze: 'player', body: 'perk', intensity: 0.35, priority: 3 });
      }
      return base({ gaze: asleep ? 'none' : 'player', body: asleep ? 'settle' : 'perk', priority: 3 });
    }
    case 'call_arrived': {
      if (speaks(r, 0.45 + 0.45 * i.personality.sociability * (0.6 + 0.4 * fam))) {
        const meow = r() < 0.4;
        return base({ sound: meow ? 'meow' : 'trill', caption: cap(2), gaze: 'player', body: 'greet', intensity: 0.55, priority: 3 });
      }
      return base({ gaze: 'player', body: 'greet', priority: 3 });
    }
    case 'pet_ok': {
      const relaxed = n.stress < 0.35 && n.comfort > 0.4;
      const s = i.streak ?? 1;
      if (relaxed && speaks(r, 0.35 + 0.5 * i.personality.sociability + 0.1 * (s > 1 ? 1 : 0))) {
        return base({ sound: 'purr', caption: r() < 0.3 ? 3 : 0, gaze: 'none', body: 'lean', intensity: 0.4 + 0.4 * n.comfort, priority: 2 });
      }
      // Not every touch is a purr: sometimes a slow, quiet lean, or a little chirp.
      if (speaks(r, 0.12 * t.vocal)) return base({ sound: 'chirp', caption: cap(2), body: 'lean', intensity: 0.3, priority: 2 });
      return base({ body: 'lean', priority: 2 });
    }
    case 'pet_overstim': {
      // Enough now. Turn away; only a clearly stressed, low-tolerance cat gets as far as a warning.
      const warn = t.tolerance < 0.4 && n.stress > 0.35 && (i.streak ?? 0) > petLimit(t) + 2;
      if (warn) return base({ sound: 'hiss', caption: 8, gaze: 'away', body: 'recoil', intensity: 0.45, priority: 5 });
      return base({ gaze: 'away', body: 'recoil', priority: 3 });
    }
    case 'pet_asleep': {
      if (speaks(r, 0.2 + 0.2 * t.vocal)) return base({ sound: 'meow_soft', caption: cap(5), body: 'settle', intensity: 0.2, priority: 2 });
      return base({ body: 'settle', priority: 2 });
    }
    case 'pet_wary':
      return base({ gaze: 'away', body: 'recoil', priority: 3 });
    case 'treat': {
      if (speaks(r, 0.4 + 0.45 * t.vocal)) return base({ sound: r() < 0.5 ? 'chirp' : 'trill', caption: cap(2), gaze: 'player', body: 'perk', intensity: 0.55, priority: 3 });
      return base({ gaze: 'player', body: 'perk', priority: 3 });
    }
    case 'play_go': {
      if (speaks(r, 0.25 + 0.4 * i.personality.playfulness * (0.5 + t.vocal))) return base({ sound: 'chirp', caption: cap(6), body: 'alert', intensity: 0.6, priority: 3 });
      return base({ body: 'alert', priority: 3 });
    }
    case 'play_wait':
      return base({ body: 'alert', priority: 3 });
    case 'play_tired': {
      if (speaks(r, 0.2 + 0.2 * t.vocal)) return base({ sound: 'meow_soft', caption: cap(7), body: 'settle', intensity: 0.25, priority: 2 });
      return base({ body: 'settle', priority: 2 });
    }
    case 'activity':
      return activityReaction(i, r, t);
  }
}

/** What she does with her voice when a new activity begins. Mostly nothing. */
function activityReaction(i: EventInput, r: () => number, t: VoiceTraits): Reaction {
  const n = i.needs;
  const mk = (over: Partial<Reaction>): Reaction => ({ ...SILENT, kind: 'activity', ...over });
  const hungry = n.satiety < 0.3;
  const thirsty = n.hydration < 0.3;
  switch (i.activity) {
    case 'seek_attention': {
      // Inviting play: bright, bouncy sounds, looking at the person. Nothing about food.
      if (i.social?.invite) {
        if (speaks(r, 0.4 + 0.5 * t.vocal)) return mk({ sound: r() < 0.5 ? 'chirp' : 'trill', caption: r() < 0.5 ? 6 : 0, gaze: 'player', body: 'perk', intensity: 0.6, priority: 3 });
        return mk({ gaze: 'player', body: 'perk', priority: 2 });
      }
      if ((hungry || thirsty) && speaks(r, 0.55 + 0.4 * t.vocal)) {
        return mk({ sound: 'meow_plea', caption: r() < 0.7 ? 4 : 0, gaze: hungry ? 'food' : 'water', body: 'perk', intensity: 0.8, priority: 4 });
      }
      if (speaks(r, 0.45 + 0.45 * t.vocal)) return mk({ sound: 'meow', caption: r() < 0.6 ? 4 : 0, gaze: 'player', body: 'perk', intensity: 0.65, priority: 3 });
      return mk({ gaze: 'player', priority: 2 });
    }
    case 'approach_person':
      // Greeting someone back after a while: warmer than a casual stroll over, and it differs by who it is.
      if (i.social?.greeting) {
        if (speaks(r, 0.45 + 0.45 * t.vocal)) {
          const quietFriend = i.social.style === 'cuddler';
          return mk({ sound: quietFriend ? 'purr' : i.social.style === 'playmate' ? 'chirp' : 'trill', caption: r() < 0.6 ? (quietFriend ? 3 : 2) : 0, gaze: 'player', body: 'greet', intensity: 0.6, priority: 3 });
        }
        return mk({ gaze: 'player', body: 'greet', priority: 3 });
      }
      if (speaks(r, 0.2 + 0.5 * i.personality.sociability * t.vocal)) return mk({ sound: 'trill', caption: r() < 0.6 ? 2 : 0, gaze: 'player', body: 'greet', intensity: 0.5, priority: 3 });
      return mk({ gaze: 'player', priority: 2 });
    case 'play':
      if (speaks(r, 0.15 + 0.5 * i.personality.playfulness * t.vocal)) return mk({ sound: 'chirp', caption: r() < 0.5 ? 6 : 0, body: 'alert', intensity: 0.55, priority: 2 });
      return SILENT;
    case 'watch_bird':
      if (speaks(r, 0.3 + 0.5 * t.vocal)) return mk({ sound: 'chatter', caption: r() < 0.25 ? 9 : 0, body: 'alert', intensity: 0.45, priority: 2 });
      return SILENT;
    case 'sniff':
    case 'investigate':
      if (speaks(r, 0.1 + 0.4 * i.personality.curiosity * t.vocal)) return mk({ sound: 'chirp', caption: r() < 0.5 ? 1 : 0, body: 'perk', intensity: 0.4, priority: 2 });
      return SILENT;
    case 'sleep':
      if (speaks(r, 0.1 + 0.2 * t.vocal)) return mk({ sound: 'meow_soft', caption: r() < 0.5 ? 5 : 0, body: 'settle', intensity: 0.2, priority: 1 });
      return SILENT;
    case 'rub':
      if (speaks(r, 0.55 + 0.35 * i.personality.sociability)) return mk({ sound: 'purr', caption: r() < 0.3 ? 3 : 0, body: 'lean', intensity: 0.5, priority: 2 });
      return mk({ body: 'lean', priority: 2 });
    case 'rest':
      if (n.stress < 0.25 && n.comfort > 0.6 && speaks(r, 0.2)) return mk({ sound: 'purr', intensity: 0.3, priority: 1 });
      return SILENT;
    case 'idle':
    case 'wander':
    case 'look_around':
      // Hungry and mooching near the food area: a pleading meow, looking toward the bowl.
      if ((hungry || thirsty) && speaks(r, 0.25 + 0.4 * t.vocal)) {
        return mk({ sound: 'meow_plea', caption: r() < 0.6 ? 4 : 0, gaze: hungry ? 'food' : 'water', intensity: 0.7, priority: 4 });
      }
      return SILENT;
    default:
      return SILENT;
  }
}

// ---------------------------------------------------------------- persistence
// A reaction to something an owner did must reach the other owner too. It is stored as a handful of numbers
// under reserved keys inside the cat's existing `familiarity` JSON (object ids are UUIDs, so they never collide).
// No schema change is needed, and existing data is untouched.

export const RX = {
  at: '~rx_at', kind: '~rx_k', sound: '~rx_s', caption: '~rx_c', gaze: '~rx_g', body: '~rx_b', intensity: '~rx_i', priority: '~rx_p', by: '~rx_by', x: '~rx_x', z: '~rx_z',
  petAt: '~pet_at', petStreak: '~pet_n',
} as const;

export interface StoredReaction extends Reaction { at: number; by: number; x: number; z: number }

export function encodeReaction(fam: Record<string, number>, r: Reaction, at: number, userId: string, x = 0, z = 0): void {
  fam[RX.at] = at;
  fam[RX.kind] = EVENT_KINDS.indexOf(r.kind);
  fam[RX.sound] = VOCALS.indexOf(r.sound);
  fam[RX.caption] = r.caption;
  fam[RX.gaze] = GAZES.indexOf(r.gaze);
  fam[RX.body] = BODIES.indexOf(r.body);
  fam[RX.intensity] = Math.round(r.intensity * 100);
  fam[RX.priority] = r.priority;
  fam[RX.by] = hashString(userId) % 1_000_000;
  fam[RX.x] = Math.round(x * 100) / 100;
  fam[RX.z] = Math.round(z * 100) / 100;
}

export function decodeReaction(fam: Record<string, number> | undefined): StoredReaction | null {
  if (!fam || typeof fam[RX.at] !== 'number') return null;
  const kind = EVENT_KINDS[fam[RX.kind] ?? -1];
  const sound = VOCALS[fam[RX.sound] ?? -1];
  const gaze = GAZES[fam[RX.gaze] ?? -1];
  const body = BODIES[fam[RX.body] ?? -1];
  if (!kind || !sound || !gaze || !body) return null;
  const pr = fam[RX.priority] ?? 1;
  return {
    kind, sound, gaze, body, caption: Math.max(0, Math.min(CAPTIONS.length - 1, fam[RX.caption] ?? 0)),
    intensity: clamp01((fam[RX.intensity] ?? 0) / 100), priority: (pr >= 1 && pr <= 5 ? pr : 1) as Priority,
    at: fam[RX.at]!, by: fam[RX.by] ?? 0, x: fam[RX.x] ?? 0, z: fam[RX.z] ?? 0,
  };
}

// ---------------------------------------------------------------- helpers shared by server and tests

/** Can the cat notice a call from `distance` metres? Light sleepers hear a lot; deep sleepers need you close. */
export function canHearCall(cat: Pick<CatSim, 'activity' | 'needs'>, distance: number): boolean {
  if (cat.activity === 'sleep') return distance < 3.5 + 2 * (1 - cat.needs.energy);
  return distance < 14;
}

/** Update the petting streak and say whether she has had enough. */
export function petStreak(fam: Record<string, number>, now: number, t: VoiceTraits): { streak: number; overstim: boolean } {
  const last = fam[RX.petAt] ?? 0;
  const prev = fam[RX.petStreak] ?? 0;
  const streak = now - last < PET_STREAK_MS ? prev + 1 : 1;
  fam[RX.petAt] = now;
  fam[RX.petStreak] = streak;
  return { streak, overstim: streak > petLimit(t) };
}

/** Client-side voice scheduling: a quiet sound may not interrupt a louder one, and nothing repeats too soon. */
export function mayVocalise(
  last: { until: number; priority: number; sound: Vocal } | null,
  next: { priority: number; sound: Vocal },
  now: number,
): boolean {
  if (!last || now >= last.until) return true;
  if (next.priority > last.priority) return true; // important things can cut in
  return false;
}
