import { ACTIVITY_DEFS, BOWL_USE } from './activities.ts';
import { stageBehaviour } from './growth.ts';
import { chronotypeShift } from './personality.ts';
import { clamp01 } from './rng.ts';
import type { Activity, CatSim, WorldObject } from './types.ts';
import { OBJECT_DEFS, hasTag } from '../world/catalog.ts';

export interface BrainContext {
  cat: CatSim;
  /** All world objects (any location). */
  objects: WorldObject[];
  now: number;
  hour: number;
  anyoneHere: boolean;
  rng: () => number;
  daylight: number;
}

export interface Decision {
  activity: Activity;
  targetId: string | null;
  durationMs: number;
}

interface Candidate { activity: Activity; targetId: string | null; utility: number }

const dist = (c: CatSim, o: WorldObject) => Math.hypot(o.x - c.x, o.z - c.z);

/** Deterministic "are birds out?" so every browser and the server agree. */
export function birdsAbout(now: number, hour: number, catId: string): boolean {
  if (hour < 6.5 || hour > 19) return false;
  const slot = Math.floor(now / (10 * 60_000));
  let h = 2166136261 ^ slot;
  for (let i = 0; i < catId.length; i += 4) h = Math.imul(h ^ catId.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100) < 38;
}

/** Sleepiness by hour. Cats are crepuscular: more active near dawn and dusk, drowsy midday and deep night. */
export function sleepiness(hour: number, catId: string): number {
  const h = hour - chronotypeShift(catId);
  const wrap = (x: number) => ((((x + 12) % 24) + 24) % 24) - 12;
  const g = (c: number, w: number) => Math.exp(-(wrap(h - c) ** 2) / (2 * w * w));
  const active = 0.9 * g(6.5, 2) + 0.9 * g(19.5, 2.5);
  return clamp01(0.62 - 0.5 * active + 0.12 * g(14, 3));
}

export function chooseActivity(ctx: BrainContext): Decision {
  const { cat, rng } = ctx;
  const n = cat.needs;
  const p = cat.personality;
  const sb = stageBehaviour(cat.stage);
  const here = ctx.objects.filter((o) => o.location === cat.location);
  const byTag = (t: Parameters<typeof hasTag>[1]) => here.filter((o) => hasTag(o, t));
  const prefOf = (key: string) => cat.preferences[key] ?? 0.3;
  const famOf = (o: WorldObject) => cat.familiarity[o.id] ?? 0;
  const cands: Candidate[] = [];
  const add = (activity: Activity, targetId: string | null, utility: number) => {
    if (utility > 0.001) cands.push({ activity, targetId, utility });
  };
  const nearest = (list: WorldObject[]) => list.slice().sort((a, b) => dist(cat, a) - dist(cat, b))[0];
  const inGarden = cat.location === 'garden';

  // --- Food and water: only when the bowl actually has something.
  const food = byTag('food').filter((o) => Number(o.state.amount ?? 0) > 0.04);
  if (food.length) {
    const hungry = (1 - n.satiety) ** 1.4 * 1.7;
    add('eat', nearest(food)!.id, hungry + (n.satiety < 0.45 ? 0.15 : 0));
  } else if (!inGarden && n.satiety < 0.45 && ctx.anyoneHere) {
    const bowl = nearest(byTag('food'));
    add('seek_attention', bowl?.id ?? null, (1 - n.satiety) * 0.9);
  }
  const water = byTag('water').filter((o) => Number(o.state.amount ?? 0) > 0.04);
  if (water.length) add('drink', nearest(water)!.id, (1 - n.hydration) ** 1.4 * 1.5);

  // --- Litter.
  const litter = byTag('litter');
  if (litter.length) add('litter', litter[0]!.id, (1 - n.elimination) ** 2 * 2.4);

  // --- Sleep and rest.
  const sleepy = sleepiness(ctx.hour, cat.id);
  const awakeLongEnough = cat.prevActivity !== 'sleep';
  const restSpots = byTag('rest');
  if (restSpots.length && !inGarden) {
    const scored = restSpots.map((o) => {
      const def = OBJECT_DEFS[o.type]!;
      const stressPref = hasTag(o, 'hide') ? 0.25 * n.stress : 0;
      const s = (def.restQuality ?? 0.5) * 0.6 + prefOf(`spot:${o.id}`) * 0.7 + stressPref - dist(cat, o) * 0.04 + (rng() - 0.5) * 0.08
        + (def.elevated && p.cautiousness < 0.5 ? 0.06 : 0);
      return { o, s };
    }).sort((a, b) => b.s - a.s);
    const best = scored[0]!.o;
    const tired = (1 - n.energy) ** 2 * 1.6;
    add('sleep', best.id, (tired + sleepy * 0.55 + sb.sleepBias) * (awakeLongEnough ? 1 : 0.2) * (1 - n.stress * 0.5));
    add('rest', best.id, ((1 - n.comfort) * 0.8 + (1 - n.energy) * 0.4 + 0.1) * (0.6 + sleepy * 0.6));
  } else if (inGarden) {
    const grass = byTag('rest');
    if (grass.length) add('rest', grass[0]!.id, ((1 - n.comfort) * 0.6 + 0.15) * ctx.daylight);
  }

  // --- Play.
  const toys = byTag('toy');
  if (toys.length && n.energy > 0.3) {
    const weighted = toys.map((t) => ({ t, w: prefOf(`toy:${t.id}`) + (1 - famOf(t)) * 0.2 + rng() * 0.15 })).sort((a, b) => b.w - a.w);
    add('play', weighted[0]!.t.id, (1 - n.play) ** 1.3 * (0.55 + p.playfulness) + sb.playBias * 0.3);
  }

  // --- Grooming and stretching sequencing.
  add('groom', null, (1 - n.grooming) * 0.9 + (cat.prevActivity === 'eat' || cat.prevActivity === 'drink' ? 0.35 : 0));
  add('stretch', null, cat.prevActivity === 'sleep' || cat.prevActivity === 'rest' ? 1.1 : 0.04);
  const scratch = byTag('scratch');
  if (scratch.length) add('scratch', scratch[0]!.id, 0.16 + (cat.prevActivity === 'stretch' ? 0.4 : 0) + (1 - n.comfort) * 0.1);

  // --- Curiosity: unfamiliar things first, then familiar ones.
  const curios = here.filter((o) => hasTag(o, 'curio') || hasTag(o, 'rest') || hasTag(o, 'hide'));
  const unfamiliar = curios.filter((o) => famOf(o) < 0.55).sort((a, b) => famOf(a) - famOf(b));
  if (unfamiliar.length) {
    add('investigate', unfamiliar[0]!.id, p.curiosity * (1 - n.curiosity + 0.15) * (1.1 - famOf(unfamiliar[0]!)) * (1.1 - p.cautiousness * 0.5));
  }
  const familiar = curios.filter((o) => famOf(o) >= 0.55);
  if (familiar.length) add('sniff', familiar[Math.floor(rng() * familiar.length)]!.id, 0.12 + (1 - n.curiosity) * 0.2);
  add('wander', null, 0.2 + 0.2 * p.activity + (1 - n.curiosity) * 0.15);
  add('look_around', null, 0.16 + 0.05 * p.curiosity);
  add('idle', null, 0.1);

  // --- Birds at the window (home) or feeder (garden).
  const birdSpots = byTag('bird');
  if (birdSpots.length) {
    const active = birdsAbout(ctx.now, ctx.hour, cat.id);
    add('watch_bird', nearest(birdSpots)!.id, active ? 0.35 + 0.8 * p.curiosity * (1 - n.curiosity + 0.2) : 0.04);
  }

  // --- Stress responses.
  const hides = byTag('hide');
  if (hides.length && n.stress > 0.2) {
    const h = hides.slice().sort((a, b) => prefOf(`spot:${b.id}`) - prefOf(`spot:${a.id}`))[0]!;
    add('hide', h.id, n.stress * 1.7 * (0.35 + p.cautiousness));
  }
  if (n.stress > 0.45 && ctx.anyoneHere) {
    const quiet = hides[0] ?? restSpots[0];
    add('retreat', quiet?.id ?? null, n.stress * 1.1);
  }

  // --- Company.
  if (ctx.anyoneHere && !inGarden) {
    const rel = (1 - n.social) * (0.25 + p.sociability) * sb.attention;
    add('approach_person', null, rel * 0.95);
    add('seek_attention', null, rel * 0.6);
    if (cat.prevActivity === 'approach_person') add('rub', null, 1.6);
  }

  // --- Garden trips: curious, rested, young-but-not-tiny cats, in daylight only.
  const gardenDoor = byTag('door').find((o) => OBJECT_DEFS[o.type]?.leadsTo === 'garden');
  const gardenExists = ctx.objects.some((o) => o.location === 'garden');
  if (!inGarden && gardenDoor && gardenExists && sb.explore > 0 && ctx.daylight > 0.45 && n.energy > 0.45 && n.stress < 0.35) {
    add('explore', gardenDoor.id, 0.18 * sb.explore + 0.3 * p.curiosity * (1 - n.curiosity));
  }
  if (inGarden) {
    const door = byTag('door').find((o) => OBJECT_DEFS[o.type]?.leadsTo === 'home');
    if (door) {
      const wantsIn = 0.45 + (ctx.daylight < 0.25 ? 3 : 0) + (n.stress > 0.4 ? 1.5 : 0) + (n.satiety < 0.35 ? 1 : 0) + (n.energy < 0.3 ? 1 : 0);
      add('return_home', door.id, wantsIn);
    }
  }

  // --- Choose. Urgent needs win outright; otherwise weighted random with a nudge against repeating.
  for (const c of cands) if (c.activity === cat.prevActivity && c.activity !== 'sleep') c.utility *= 0.7;
  const urgent = cands.filter((c) => (c.activity === 'eat' && n.satiety < 0.2) || (c.activity === 'drink' && n.hydration < 0.2) || (c.activity === 'litter' && n.elimination < 0.12));
  let chosen: Candidate;
  if (urgent.length) {
    chosen = urgent.sort((a, b) => b.utility - a.utility)[0]!;
  } else {
    const T = 0.28;
    const weights = cands.map((c) => Math.exp(c.utility / T));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng() * total;
    chosen = cands[cands.length - 1]!;
    for (let i = 0; i < cands.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) { chosen = cands[i]!; break; }
    }
  }
  const def = ACTIVITY_DEFS[chosen.activity];
  const spread = def.min + rng() * (def.max - def.min);
  const stageScale = cat.stage === 'young_kitten' ? 0.75 : 1;
  const minutes = Math.max(0.4, spread * (chosen.activity === 'sleep' ? 1 : stageScale) * (0.85 + 0.3 * (chosen.activity === 'play' ? p.playfulness : 0.5)));
  return { activity: chosen.activity, targetId: chosen.targetId, durationMs: Math.round(minutes * 60_000) };
}

export { BOWL_USE };
