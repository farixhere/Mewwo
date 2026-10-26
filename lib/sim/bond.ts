import type { Personality } from './types.ts';
import { clamp01, hashString } from './rng.ts';

/**
 * Personality, owner bonds and spontaneous-initiative rules. Pure and deterministic.
 *
 * Nothing here needs new database columns: the two extra traits are derived from the stored personality plus a
 * stable per-cat quirk (so an existing cat's identity never changes), and per-owner history lives in the
 * existing `cat_relationships.interaction_counts` JSON. Short-lived cat-side flags live under reserved `~` keys in
 * the cat's existing `familiarity` JSON.
 */

// ---------------------------------------------------------------- the six traits

export interface Traits {
  sociability: number;
  playfulness: number;
  curiosity: number;
  independence: number;
  /** How readily she seeks physical closeness (rubbing, leaning, sitting near). */
  affection: number;
  /** How often she communicates through natural cat sounds. */
  vocal: number;
}

const quirk = (catId: string, salt: string) => (hashString(`${salt}:${catId}`) % 1000) / 1000;

export function vocalOf(p: Personality, catId: string): number {
  return clamp01(0.2 + 0.7 * quirk(catId, 'voice') + 0.1 * (p.sociability - 0.5));
}

export function traitsOf(p: Personality, catId: string): Traits {
  const affection = clamp01(0.15 + 0.4 * quirk(catId, 'affection') + 0.3 * (p.sociability - 0.5) - 0.2 * (p.independence - 0.5) - 0.1 * (p.cautiousness - 0.5) + 0.2);
  return {
    sociability: p.sociability, playfulness: p.playfulness, curiosity: p.curiosity, independence: p.independence,
    affection, vocal: vocalOf(p, catId),
  };
}

/** Recognisable one-word descriptions, strongest first. Used for the small tags on the cat's card. */
export function describeTraits(t: Traits, shy: number): string[] {
  const out: [string, number][] = [];
  const hi = (name: string, v: number) => { if (v > 0.65) out.push([name, v - 0.65]); };
  const lo = (name: string, v: number) => { if (v < 0.35) out.push([name, 0.35 - v]); };
  hi('cuddly', Math.max(t.affection, t.sociability)); lo('aloof', t.sociability);
  hi('playful', t.playfulness); hi('curious', t.curiosity); lo('settled', t.curiosity);
  hi('independent', t.independence); hi('chatty', t.vocal); lo('quiet', t.vocal);
  hi('shy', shy);
  return out.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n);
}

// ---------------------------------------------------------------- owners and bonds

/** What the cat knows about one owner right now. */
export interface OwnerBond {
  id: string;
  /** Short stable key for this owner, used in saved flags. */
  key: number;
  here: boolean;
  /** 0..1 how comfortable she is with them. */
  bond: number;
  /** 0..1 how much their time together is play. */
  play: number;
  /** 0..1 how much it is quiet closeness. */
  quiet: number;
}

export const ownerKey = (userId: string) => hashString(userId) % 1_000_000;

export type Style = 'playmate' | 'cuddler' | 'caretaker' | 'new';

/** Counts that describe how someone spends time with the cat. Keys beginning `~` and `together` are bookkeeping. */
export const COUNT_KEYS = ['pet', 'play', 'feed', 'water', 'treat', 'call'] as const;

export function ownerProfile(counts: Record<string, number>, familiarity: number, recentPositive: number): { bond: number; play: number; quiet: number; style: Style } {
  const play = (counts.play ?? 0) + 0.5 * (counts.treat ?? 0);
  const quiet = counts.pet ?? 0;
  const care = (counts.feed ?? 0) + (counts.water ?? 0);
  const total = play + quiet + care;
  const bond = clamp01(0.75 * familiarity + 0.25 * recentPositive);
  if (total < 6) return { bond, play: 0.5, quiet: 0.5, style: 'new' };
  const p = play / (play + quiet + 0.001);
  // A style needs a clear lean; otherwise this person simply does a bit of everything.
  const style: Style = play > quiet * 1.6 && play > care ? 'playmate' : quiet > play * 1.6 && quiet > care ? 'cuddler' : care > play + quiet ? 'caretaker' : 'new';
  return { bond, play: clamp01(p), quiet: clamp01(1 - p), style };
}

/**
 * How much one interaction deepens a bond. Diminishing as the bond grows, and repeated taps of the same
 * kind within a few seconds count for nothing, so mashing a button never buys affection.
 */
export function bondGain(familiarity: number, sinceLastSameKindMs: number): number {
  if (sinceLastSameKindMs < 8000) return 0;
  const cooldown = Math.min(1, sinceLastSameKindMs / 60_000);
  return 0.012 * (1.1 - familiarity) * (0.4 + 0.6 * cooldown);
}

/** Who she turns toward when several people are around. Everyone has a real chance; bond tilts it. */
export function pickFocusOwner(owners: OwnerBond[], rng: () => number): OwnerBond | null {
  const here = owners.filter((o) => o.here);
  if (!here.length) return null;
  const w = here.map((o) => 0.35 + o.bond);
  let roll = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < here.length; i++) { roll -= w[i]!; if (roll <= 0) return here[i]!; }
  return here[here.length - 1]!;
}

// ---------------------------------------------------------------- spontaneity

export const FLAG = {
  initAt: '~init_at', inviteAt: '~invite_at', focus: '~focus', greetFor: '~greet_for', greetAt: '~greet_at',
} as const;

/** She does not pester: after reaching out she leaves it a good while. 0 right after, back to 1 after ~20 minutes. */
export function initiativeFactor(lastInitAt: number | undefined, now: number): number {
  if (!lastInitAt) return 1;
  const mins = (now - lastInitAt) / 60_000;
  if (mins < 6) return 0;
  return clamp01((mins - 6) / 14);
}

export const GREET_WINDOW_MS = 15 * 60_000;
export const AWAY_MS = 20 * 60_000;

/** An owner has just come back after a while: how strongly she wants to go and say hello (0..1). */
export function greetPull(fam: Record<string, number>, ownerKeyHere: number | null, now: number): number {
  const at = fam[FLAG.greetAt];
  if (!at || fam[FLAG.greetFor] !== ownerKeyHere) return 0;
  const age = now - at;
  return age < 0 || age > GREET_WINDOW_MS ? 0 : 1 - age / GREET_WINDOW_MS * 0.5;
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';
export function dayPart(hour: number): DayPart {
  return hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'night';
}
export const habitKey = (activity: string, hour: number) => `habit:${activity}:${dayPart(hour)}`;
