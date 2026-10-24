import type { Activity, WorldObject } from '../sim/types.ts';
import { OBJECT_DEFS } from './catalog.ts';
import { buildGrid, cellCenter, nearestFreeCell, reachable, standPoint, type Grid, type Pt } from './nav.ts';

const PERCH: Activity[] = ['rest', 'sleep', 'watch_bird', 'hide'];

/** Where the cat ends up when it uses `o` for `activity`. Elevated furniture is climbed onto; solid things are used from beside. */
export function useSpot(g: Grid, o: WorldObject, activity: Activity, from: Pt): { x: number; z: number; y: number } {
  const def = OBJECT_DEFS[o.type];
  if (def?.elevated && PERCH.includes(activity)) return { x: o.x, z: o.z, y: def.elevated };
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
