import type { WorldObject } from '../sim/types.ts';
import { LOCATIONS, OBJECT_DEFS, type Rect } from './catalog.ts';

export const CELL = 0.4;

export interface Grid {
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
}

export interface Pt { x: number; z: number }

function rectOf(o: WorldObject, pad = 0): Rect | null {
  const def = OBJECT_DEFS[o.type];
  if (!def) return null;
  // Rotate the footprint by quarter turns only (placement snaps rotation to 90 degrees for blockers).
  const quarter = Math.abs(Math.round(o.rotation / (Math.PI / 2))) % 2 === 1;
  const w = quarter ? def.d : def.w;
  const d = quarter ? def.w : def.d;
  return { minX: o.x - w / 2 - pad, maxX: o.x + w / 2 + pad, minZ: o.z - d / 2 - pad, maxZ: o.z + d / 2 + pad };
}

export function footprint(o: WorldObject): Rect | null {
  return rectOf(o);
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

export function buildGrid(location: string, objects: WorldObject[], ignoreId?: string): Grid {
  const loc = LOCATIONS[location];
  if (!loc) throw new Error(`Unknown location: ${location}`);
  const { bounds } = loc;
  const cols = Math.ceil((bounds.maxX - bounds.minX) / CELL);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / CELL);
  const blocked = new Uint8Array(cols * rows);
  const rects: Rect[] = [...loc.walls];
  for (const o of objects) {
    if (o.location !== location || o.id === ignoreId) continue;
    const def = OBJECT_DEFS[o.type];
    if (!def?.blocks) continue;
    const r = rectOf(o, 0.08);
    if (r) rects.push(r);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = bounds.minX + (c + 0.5) * CELL;
      const cz = bounds.minZ + (r + 0.5) * CELL;
      const cell: Rect = { minX: cx - CELL / 2 + 0.02, maxX: cx + CELL / 2 - 0.02, minZ: cz - CELL / 2 + 0.02, maxZ: cz + CELL / 2 - 0.02 };
      for (const rect of rects) {
        if (rectsOverlap(cell, rect)) { blocked[r * cols + c] = 1; break; }
      }
    }
  }
  return { minX: bounds.minX, minZ: bounds.minZ, cols, rows, blocked };
}

export function toCell(g: Grid, p: Pt): { c: number; r: number } {
  return {
    c: Math.min(g.cols - 1, Math.max(0, Math.floor((p.x - g.minX) / CELL))),
    r: Math.min(g.rows - 1, Math.max(0, Math.floor((p.z - g.minZ) / CELL))),
  };
}

export function cellCenter(g: Grid, c: number, r: number): Pt {
  return { x: g.minX + (c + 0.5) * CELL, z: g.minZ + (r + 0.5) * CELL };
}

const idx = (g: Grid, c: number, r: number) => r * g.cols + c;
const free = (g: Grid, c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && !g.blocked[idx(g, c, r)];

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** Nearest free cell to a point (spiral search). */
export function nearestFreeCell(g: Grid, p: Pt): { c: number; r: number } | null {
  const s = toCell(g, p);
  if (free(g, s.c, s.r)) return s;
  const maxR = Math.max(g.cols, g.rows);
  for (let ring = 1; ring < maxR; ring++) {
    let best: { c: number; r: number; d: number } | null = null;
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        const c = s.c + dc, r = s.r + dr;
        if (!free(g, c, r)) continue;
        const d = dc * dc + dr * dr;
        if (!best || d < best.d) best = { c, r, d };
      }
    }
    if (best) return { c: best.c, r: best.r };
  }
  return null;
}

function lineClear(g: Grid, a: Pt, b: Pt): boolean {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(dist / (CELL / 3)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const c = toCell(g, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    if (!free(g, c.c, c.r)) return false;
  }
  return true;
}

/** A* over the grid, then string-pulling so the cat walks in natural straight lines. */
export function findPath(g: Grid, from: Pt, to: Pt): Pt[] | null {
  const start = nearestFreeCell(g, from);
  const goal = nearestFreeCell(g, to);
  if (!start || !goal) return null;
  const n = g.cols * g.rows;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open: number[] = [];
  const heur = (c: number, r: number) => Math.hypot(c - goal.c, r - goal.r);
  const si = idx(g, start.c, start.r);
  gScore[si] = 0;
  open.push(si);
  const fScore = new Float32Array(n).fill(Infinity);
  fScore[si] = heur(start.c, start.r);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (fScore[open[i]!]! < fScore[open[bi]!]!) bi = i;
    const cur = open.splice(bi, 1)[0]!;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % g.cols, cr = Math.floor(cur / g.cols);
    if (cc === goal.c && cr === goal.r) {
      const cells: Pt[] = [];
      for (let i = cur; i !== -1; i = came[i]!) cells.push(cellCenter(g, i % g.cols, Math.floor(i / g.cols)));
      cells.reverse();
      return smooth(g, [from, ...cells.slice(1, -1), to], cells);
    }
    for (const [dc, dr, cost] of DIRS) {
      const nc = cc + dc, nr = cr + dr;
      if (!free(g, nc, nr)) continue;
      // No cutting corners around blocked cells.
      if (dc !== 0 && dr !== 0 && (!free(g, cc + dc, cr) || !free(g, cc, cr + dr))) continue;
      const ni = idx(g, nc, nr);
      if (closed[ni]) continue;
      const tentative = gScore[cur]! + cost;
      if (tentative < gScore[ni]!) {
        came[ni] = cur;
        gScore[ni] = tentative;
        fScore[ni] = tentative + heur(nc, nr);
        open.push(ni);
      }
    }
  }
  return null;
}

function smooth(g: Grid, _raw: Pt[], cells: Pt[]): Pt[] {
  if (cells.length <= 2) return cells;
  const out: Pt[] = [cells[0]!];
  let anchor = 0;
  for (let i = 2; i < cells.length; i++) {
    if (!lineClear(g, cells[anchor]!, cells[i]!)) {
      out.push(cells[i - 1]!);
      anchor = i - 1;
    }
  }
  out.push(cells[cells.length - 1]!);
  return out;
}

export function pathLength(path: Pt[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
  return len;
}

/** All free cells reachable from a point. */
export function reachable(g: Grid, from: Pt): Set<number> {
  const s = nearestFreeCell(g, from);
  const seen = new Set<number>();
  if (!s) return seen;
  const stack = [idx(g, s.c, s.r)];
  seen.add(stack[0]!);
  while (stack.length) {
    const cur = stack.pop()!;
    const cc = cur % g.cols, cr = Math.floor(cur / g.cols);
    for (const [dc, dr] of DIRS.slice(0, 4)) {
      const nc = cc + dc, nr = cr + dr;
      if (!free(g, nc, nr)) continue;
      const ni = idx(g, nc, nr);
      if (!seen.has(ni)) { seen.add(ni); stack.push(ni); }
    }
  }
  return seen;
}

/**
 * Where the cat stands to use an object: the free cell nearest the object's centre,
 * preferring cells close to where the cat already is.
 */
export function standPoint(g: Grid, o: WorldObject, from: Pt): Pt {
  const def = OBJECT_DEFS[o.type];
  if (def && !def.blocks) {
    // Non-blocking things (bowls, beds, toys): the cat stands right at them.
    return { x: o.x, z: o.z };
  }
  const r = rectOf(o, 0)!;
  const reach = reachable(g, from);
  let best: Pt | null = null;
  let bestScore = Infinity;
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      if (!free(g, col, row) || !reach.has(idx(g, col, row))) continue;
      const p = cellCenter(g, col, row);
      const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX);
      const dz = Math.max(r.minZ - p.z, 0, p.z - r.maxZ);
      const edge = Math.hypot(dx, dz);
      if (edge > 1.1) continue;
      const score = edge * 3 + Math.hypot(p.x - from.x, p.z - from.z) * 0.15;
      if (score < bestScore) { bestScore = score; best = p; }
    }
  }
  return best ?? nearestFreeCellPoint(g, { x: o.x, z: o.z });
}

function nearestFreeCellPoint(g: Grid, p: Pt): Pt {
  const c = nearestFreeCell(g, p);
  return c ? cellCenter(g, c.c, c.r) : p;
}

export interface PlacementCheck { ok: boolean; reason?: string }

/** Validate moving/placing an object without trapping the cat or blocking essentials. */
export function validatePlacement(
  candidate: WorldObject,
  others: WorldObject[],
  catAt: Pt,
): PlacementCheck {
  const loc = LOCATIONS[candidate.location];
  const def = OBJECT_DEFS[candidate.type];
  if (!loc || !def) return { ok: false, reason: 'Unknown object or place.' };
  if (!def.movable) return { ok: false, reason: `${def.label} is fixed in place.` };
  const r = rectOf(candidate)!;
  const b = loc.bounds;
  if (r.minX < b.minX + 0.1 || r.maxX > b.maxX - 0.1 || r.minZ < b.minZ + 0.1 || r.maxZ > b.maxZ - 0.1) {
    return { ok: false, reason: 'That would be outside the room.' };
  }
  for (const w of loc.walls) if (rectsOverlap(r, { minX: w.minX - 0.05, maxX: w.maxX + 0.05, minZ: w.minZ - 0.05, maxZ: w.maxZ + 0.05 })) {
    return { ok: false, reason: 'That would sit inside a wall.' };
  }
  for (const o of others) {
    if (o.id === candidate.id || o.location !== candidate.location) continue;
    const od = OBJECT_DEFS[o.type];
    if (!od) continue;
    const orct = rectOf(o)!;
    // Blockers can't overlap anything solid; flat things may overlap each other only if neither blocks.
    if ((def.blocks || od.blocks) && rectsOverlap(r, orct)) return { ok: false, reason: `That overlaps the ${od.label.toLowerCase()}.` };
    if (!def.blocks && !od.blocks && rectsOverlap(shrink(r, 0.15), shrink(orct, 0.15))) return { ok: false, reason: `That's too close to the ${od.label.toLowerCase()}.` };
  }
  // Litter stays away from food and water, and ideally in the nook.
  if (def.tags.includes('litter')) {
    for (const o of others) {
      if (o.location !== candidate.location) continue;
      const t = OBJECT_DEFS[o.type]?.tags ?? [];
      if ((t.includes('food') || t.includes('water')) && Math.hypot(o.x - candidate.x, o.z - candidate.z) < 2.5) {
        return { ok: false, reason: 'Cats won\'t use a litter tray this close to food or water.' };
      }
    }
  }
  if ((def.tags.includes('food') || def.tags.includes('water'))) {
    for (const o of others) {
      if (o.location !== candidate.location || !OBJECT_DEFS[o.type]?.tags.includes('litter')) continue;
      if (Math.hypot(o.x - candidate.x, o.z - candidate.z) < 2.5) return { ok: false, reason: 'Food and water should be away from the litter tray.' };
    }
  }
  // Reachability: every essential must still be reachable from where the cat is.
  const next = others.filter((o) => o.id !== candidate.id).concat(candidate);
  const g = buildGrid(candidate.location, next);
  const reach = reachable(g, catAt);
  if (reach.size === 0) return { ok: false, reason: 'That would trap the cat.' };
  for (const o of next) {
    if (o.location !== candidate.location) continue;
    const od = OBJECT_DEFS[o.type];
    if (!od?.essential) continue;
    const sp = standPoint(g, o, catAt);
    const sc = toCell(g, sp);
    if (!reach.has(idx(g, sc.c, sc.r))) return { ok: false, reason: `That would cut the cat off from the ${od.label.toLowerCase()}.` };
  }
  return { ok: true };
}

function shrink(r: Rect, by: number): Rect {
  return { minX: r.minX + by, maxX: r.maxX - by, minZ: r.minZ + by, maxZ: r.maxZ - by };
}
