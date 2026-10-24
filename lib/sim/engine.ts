import { ACTIVITY_DEFS, BOWL_USE } from './activities.ts';
import { chooseActivity } from './brain.ts';
import { ageDays, stageForAge, stageLabel } from './growth.ts';
import { familiarize, reinforce } from './learning.ts';
import { applyFloors, applyGains, decay } from './needs.ts';
import { decisionRng } from './rng.ts';
import { daylight, localHour } from './time.ts';
import type { Activity, CatSim, SimEvent, WorldObject } from './types.ts';
import { OBJECT_DEFS, hasTag } from '../world/catalog.ts';
import { buildGrid, type Grid } from '../world/nav.ts';
import { pickDestination, useSpot } from '../world/place.ts';

const MIN = 60_000;
const HOUR = 3_600_000;
/** Longest single step. Smaller than any activity, so decay and gains stay stable. */
export const MAX_STEP_MS = 5 * MIN;
/** Beyond this we don't replay history: needs settle and the cat just carries on. */
export const MAX_REPLAY_MS = 36 * HOUR;
export const MAX_ITERATIONS = 1500;

export interface AdvanceContext {
  timeZone: string;
  anyoneHere: boolean;
}

export interface AdvanceResult {
  cat: CatSim;
  objects: WorldObject[];
  events: SimEvent[];
  steps: number;
  /** Elapsed time that was fast-forwarded without replay. */
  skippedMs: number;
}

function cloneObjects(objs: WorldObject[]): WorldObject[] {
  return objs.map((o) => ({ ...o, state: { ...o.state } }));
}

/**
 * Bring a cat up to `now`. Pure: give it the saved state, get back the new state.
 * The caller persists the result inside a transaction that holds a row lock on the cat,
 * which is what stops two requests from applying the same interval twice.
 */
export function advance(input: CatSim, objectsIn: WorldObject[], now: number, ctx: AdvanceContext): AdvanceResult {
  const cat: CatSim = {
    ...input,
    needs: { ...input.needs },
    preferences: { ...input.preferences },
    familiarity: { ...input.familiarity },
  };
  const objects = cloneObjects(objectsIn);
  const events: SimEvent[] = [];
  let t = cat.lastSimAt;
  let skippedMs = 0;
  const grids = new Map<string, Grid>();
  const gridFor = (loc: string): Grid => {
    let g = grids.get(loc);
    if (!g) { g = buildGrid(loc, objects); grids.set(loc, g); }
    return g;
  };

  if (now <= t) return { cat, objects, events, steps: 0, skippedMs };

  // Growth is derived from the clock, so a long absence can never skip or duplicate a stage.
  const syncStage = (at: number) => {
    const next = stageForAge(ageDays(cat.bornAt, at));
    if (next !== cat.stage) {
      cat.stage = next;
      events.push({ kind: 'growth_stage', dedupeKey: `stage:${next}`, title: `Grew into a ${stageLabel(next).toLowerCase()}`, at });
    }
  };

  if (now - t > MAX_REPLAY_MS) {
    skippedMs = now - t - MAX_REPLAY_MS;
    // Fast-forward through growth milestones in order, then replay only the most recent stretch.
    const skipTo = now - MAX_REPLAY_MS;
    for (const days of [14, 60, 180]) {
      const at = cat.bornAt + days * 86_400_000;
      if (at > t && at <= skipTo) syncStage(at);
    }
    t = skipTo;
    cat.activityUntil = Math.min(cat.activityUntil, t);
    cat.activitySince = Math.min(cat.activitySince, t);
  }

  let steps = 0;
  while (t < now && steps < MAX_ITERATIONS) {
    steps++;
    syncStage(t);

    // Time to choose something new?
    if (t >= cat.activityUntil) {
      finishActivity(cat, objects, t, events, gridFor);
      cat.rngCounter += 1;
      const hour = localHour(t, ctx.timeZone);
      const d = chooseActivity({
        cat, objects, now: t, hour, anyoneHere: ctx.anyoneHere,
        rng: decisionRng(cat.id, cat.rngCounter), daylight: daylight(hour),
      });
      cat.prevActivity = cat.activity;
      cat.activity = d.activity;
      cat.targetId = d.targetId;
      cat.destX = null;
      cat.destZ = null;
      if (!d.targetId && ['wander', 'look_around', 'approach_person', 'seek_attention', 'rub'].includes(d.activity)) {
        const dest = pickDestination(gridFor(cat.location), { x: cat.x, z: cat.z }, decisionRng(cat.id, cat.rngCounter + 7919), d.activity === 'wander' ? 4.5 : 2.5);
        cat.destX = dest.x;
        cat.destZ = dest.z;
      }
      cat.activitySince = t;
      cat.activityUntil = t + d.durationMs;
    }

    const end = Math.min(now, cat.activityUntil, t + MAX_STEP_MS);
    const dt = end - t;
    if (dt <= 0) { t = end; continue; }

    const session = Math.max(1, cat.activityUntil - cat.activitySince);
    const share = dt / session;
    const minutes = dt / MIN;

    // Eating and drinking draw from a real bowl. An empty bowl means no gain.
    let factor = 1;
    if (cat.activity === 'eat' || cat.activity === 'drink') {
      const bowl = objects.find((o) => o.id === cat.targetId);
      const use = BOWL_USE[cat.activity] * share;
      const amount = Number(bowl?.state.amount ?? 0);
      const taken = Math.min(amount, use);
      factor = use > 0 ? taken / use : 0;
      if (bowl) bowl.state.amount = Math.max(0, amount - taken);
    }

    let needs = decay(cat.needs, cat.activity, dt / HOUR, cat.personality, cat.stage);
    needs = applyGains(needs, cat.activity, share, minutes, factor);
    cat.needs = applyFloors(needs);
    t = end;
    cat.lastSimAt = t;
  }

  if (steps >= MAX_ITERATIONS && t < now) {
    // Safety valve: never loop unbounded. Jump to now with the settled state.
    skippedMs += now - t;
    t = now;
  }
  cat.lastSimAt = now;
  syncStage(now);
  return { cat, objects, events, steps, skippedMs };
}

/** Learning, familiarity and milestones when an activity completes. */
function finishActivity(cat: CatSim, objects: WorldObject[], at: number, events: SimEvent[], gridFor: (loc: string) => Grid): void {
  const a: Activity = cat.activity;
  const target = objects.find((o) => o.id === cat.targetId);
  if (a === 'explore') {
    cat.location = 'garden';
    const door = objects.find((o) => o.location === 'garden' && o.type === 'home_door');
    cat.x = door ? door.x : 0;
    cat.z = door ? door.z - 0.8 : 0;
  } else if (a === 'return_home') {
    cat.location = 'home';
    const door = objects.find((o) => o.location === 'home' && o.type === 'garden_door');
    cat.x = door ? door.x + 0.9 : 0;
    cat.z = door ? door.z : 0;
  } else if (target && target.location === cat.location) {
    const spot = useSpot(gridFor(cat.location), target, a, { x: cat.x, z: cat.z });
    cat.x = spot.x;
    cat.z = spot.z;
  } else if (cat.destX !== null && cat.destZ !== null) {
    cat.x = cat.destX;
    cat.z = cat.destZ;
  }
  cat.destX = null;
  cat.destZ = null;
  if (!target) return;

  switch (a) {
    case 'eat':
      if (Number(target.state.amount ?? 0) >= 0 || cat.needs.satiety > 0.3) {
        events.push({ kind: 'first_meal', dedupeKey: 'first_meal', title: 'First meal', body: 'Tucked into a proper meal.', objectId: target.id, at });
      }
      break;
    case 'drink':
      events.push({ kind: 'first_drink', dedupeKey: 'first_drink', title: 'First drink', objectId: target.id, at });
      break;
    case 'play': {
      const v = reinforce(cat.preferences, `toy:${target.id}`, 0.12);
      familiarize(cat.familiarity, target.id, 0.1);
      events.push({ kind: 'first_play', dedupeKey: 'first_play', title: 'First play session', body: `Pounced on the ${OBJECT_DEFS[target.type]?.label.toLowerCase() ?? 'toy'}.`, objectId: target.id, at });
      if (v >= 0.6) events.push({ kind: 'favourite_toy', dedupeKey: 'favourite_toy', title: 'Found a favourite toy', body: `The ${OBJECT_DEFS[target.type]?.label.toLowerCase() ?? 'toy'} is a hit.`, objectId: target.id, at });
      break;
    }
    case 'rest':
    case 'sleep': {
      if (hasTag(target, 'rest')) {
        const v = reinforce(cat.preferences, `spot:${target.id}`, a === 'sleep' ? 0.09 : 0.05);
        familiarize(cat.familiarity, target.id, 0.15);
        if (v >= 0.6 && a === 'sleep') {
          events.push({ kind: 'new_sleep_spot', dedupeKey: `sleep_spot:${target.id}`, title: 'A new favourite sleeping spot', body: `Keeps coming back to the ${OBJECT_DEFS[target.type]?.label.toLowerCase() ?? 'spot'}.`, objectId: target.id, at });
        }
      }
      break;
    }
    case 'investigate':
      familiarize(cat.familiarity, target.id, 0.3);
      break;
    case 'sniff':
    case 'watch_bird':
    case 'hide':
      familiarize(cat.familiarity, target.id, 0.08);
      break;
    default:
      break;
  }
}

/** Mark something as brand new to the cat (e.g. when a new object is placed). */
export function noteNewObject(cat: CatSim, objectId: string): void {
  cat.familiarity = { ...cat.familiarity };
  delete cat.familiarity[objectId];
}

/** A person did something to the cat. Returns what the cat made of it. */
export function reactToPerson(
  cat: CatSim,
  kind: 'pet' | 'play' | 'treat',
  relationFamiliarity: number,
): { accepted: boolean; mood: 'purr' | 'tolerate' | 'wary' | 'asleep' | 'tired'; cat: CatSim } {
  const next: CatSim = { ...cat, needs: { ...cat.needs } };
  const n = next.needs;
  const sleeping = !ACTIVITY_DEFS[cat.activity].awake;
  const shy = cat.personality.cautiousness * (1 - relationFamiliarity) * 0.5;
  if (sleeping && n.energy < 0.6 && kind !== 'treat') {
    // Let sleeping cats lie. A tiny stir, no change.
    return { accepted: false, mood: 'asleep', cat: next };
  }
  if (n.stress > 0.55 && kind !== 'treat') {
    n.stress = Math.min(0.7, n.stress + 0.02);
    return { accepted: false, mood: 'wary', cat: next };
  }
  if (kind === 'pet') {
    if (n.social > 0.9 && cat.personality.independence > 0.6) return { accepted: false, mood: 'tolerate', cat: next };
    n.social = Math.min(1, n.social + 0.22 * (1 - shy));
    n.comfort = Math.min(1, n.comfort + 0.08);
    n.stress = Math.max(0, n.stress - 0.08);
    return { accepted: true, mood: 'purr', cat: next };
  }
  if (kind === 'play') {
    if (n.energy < 0.2) return { accepted: false, mood: 'tired', cat: next };
    n.play = Math.min(1, n.play + 0.25 * (0.5 + cat.personality.playfulness));
    n.energy = Math.max(0.1, n.energy - 0.05);
    n.social = Math.min(1, n.social + 0.1);
    return { accepted: true, mood: 'purr', cat: next };
  }
  n.satiety = Math.min(1, n.satiety + 0.04);
  n.social = Math.min(1, n.social + 0.1);
  return { accepted: true, mood: 'purr', cat: next };
}
