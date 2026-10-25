import type { Activity, WorldObject } from '../sim/types.ts';
import { OBJECT_DEFS } from './catalog.ts';
import { buildGrid, cellCenter, isFreePoint, nearestFreeCell, reachable, standPoint, type Grid, type Pt } from './nav.ts';

const PERCH: Activity[] = ['rest', 'sleep', 'watch_bird', 'hide'];
/** Things the cat stands beside and faces (a bowl, a toy) rather than standing on. */
const FACE: Activity[] = ['eat', 'drink', 'play', 'sniff', 'investigate'];
const STAND_OFF = 0.36;

export interface Spot { x: number; z: number; y: number; /** Heading to end on, when the cat should face the object. */ heading?: number }

/** Where the cat ends up when it uses `o` for `activity`. Elevated furniture is climbed onto; solid things are used from beside. */
export function useSpot(g: Grid, o: WorldObject, activity: Activity, from: Pt): Spot {
  const def = OBJECT_DEFS[o.type];
  if (def?.elevated && PERCH.includes(activity)) return { x: o.x, z: o.z, y: def.elevated };
  if (def && !def.blocks && FACE.includes(activity)) {
    // Approach from the side the cat is coming from and stop short, head over the bowl, not standing in it.
    let dx = from.x - o.x, dz = from.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) { dx = Math.sin(o.rotation); dz = Math.cos(o.rotation); } else { dx /= d; dz /= d; }
    const candidates = [
      { x: o.x + dx * STAND_OFF, z: o.z + dz * STAND_OFF },
      { x: o.x - dz * STAND_OFF, z: o.z + dx * STAND_OFF },
      { x: o.x + dz * STAND_OFF, z: o.z - dx * STAND_OFF },
    ];
    for (const c of candidates) {
      if (isFreePoint(g, c)) return { x: c.x, z: c.z, y: 0, heading: Math.atan2(o.x - c.x, o.z - c.z) };
    }
  }
  const p = standPoint(g, o, from);
  return { x: p.x, z: p.z, y: 0 };
}

/** Deterministic random free, reachable spot near `from`. */
export function pickDestination(g: Grid, from: Pt, rng: () => number, radius = 4): Pt {
  const reach = reachable(g, from);
  const cells: Pt[] = [];
  for (const i of reach) {
    const p = cellCenter(g, i % g.cols, Math.floor(i / g.cols));
    const d = Math.hypot(p.x - from.x, p.z - from.z);
    if (d >= 1 && d <= radius) cells.push(p);
  }
  if (!cells.length) {
    const c = nearestFreeCell(g, from);
    return c ? cellCenter(g, c.c, c.r) : from;
  }
  return cells[Math.floor(rng() * cells.length)]!;
}

export { buildGrid };
