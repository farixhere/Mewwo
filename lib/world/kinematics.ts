import type { Pt } from './nav.ts';

/**
 * Pure motion maths shared by the client renderer and the tests. No three.js, no DOM.
 *
 * Distance along a path follows a trapezoidal velocity profile (ease in, cruise, ease out), so the cat
 * never starts or stops at full speed. Everything is a function of elapsed time, so two players watching
 * the same saved state see the same cat in the same place.
 */

export interface Profile {
  length: number;
  vmax: number;
  accel: number;
  decel: number;
  /** Seconds to reach cruise, seconds cruising, seconds braking. */
  tAcc: number;
  tCruise: number;
  tDec: number;
  /** Total travel time. */
  duration: number;
}

export function makeProfile(length: number, vmax: number, accel = 3.2, decel = 4.2): Profile {
  const L = Math.max(0, length);
  let v = Math.max(0.05, vmax);
  // Short hops never reach cruise speed: peak speed is whatever fits.
  const dAcc = (v * v) / (2 * accel);
  const dDec = (v * v) / (2 * decel);
  if (dAcc + dDec > L) v = Math.sqrt((2 * L) / (1 / accel + 1 / decel));
  const tAcc = v / accel;
  const tDec = v / decel;
  const cruise = Math.max(0, L - (v * v) / (2 * accel) - (v * v) / (2 * decel));
  const tCruise = v > 0 ? cruise / v : 0;
  return { length: L, vmax: v, accel, decel, tAcc, tCruise, tDec, duration: tAcc + tCruise + tDec };
}

/** Distance travelled after `t` seconds. */
export function distanceAt(p: Profile, t: number): number {
  if (t <= 0) return 0;
  if (t >= p.duration) return p.length;
  if (t < p.tAcc) return 0.5 * p.accel * t * t;
  const dAcc = 0.5 * p.accel * p.tAcc * p.tAcc;
  if (t < p.tAcc + p.tCruise) return dAcc + p.vmax * (t - p.tAcc);
  const td = t - p.tAcc - p.tCruise;
  return dAcc + p.vmax * p.tCruise + p.vmax * td - 0.5 * p.decel * td * td;
}

/** Speed after `t` seconds. */
export function speedAt(p: Profile, t: number): number {
  if (t <= 0 || t >= p.duration) return 0;
  if (t < p.tAcc) return p.accel * t;
  if (t < p.tAcc + p.tCruise) return p.vmax;
  return Math.max(0, p.vmax - p.decel * (t - p.tAcc - p.tCruise));
}

export interface Track {
  pts: Pt[];
  /** cum[i] = distance from pts[0] to pts[i]. */
  cum: number[];
  length: number;
}

export function makeTrack(pts: Pt[]): Track {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  }
  return { pts, cum, length: cum[cum.length - 1] ?? 0 };
}

export interface Sample { x: number; z: number; heading: number }

/** Position and travel direction at distance `d` along the track. */
export function sampleTrack(tr: Track, d: number, fallbackHeading = 0): Sample {
  const { pts, cum } = tr;
  if (pts.length === 0) return { x: 0, z: 0, heading: fallbackHeading };
  if (pts.length === 1 || tr.length < 1e-6) return { x: pts[0]!.x, z: pts[0]!.z, heading: fallbackHeading };
  const dd = Math.min(tr.length, Math.max(0, d));
  // Binary search for the segment.
  let lo = 1, hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! < dd) lo = mid + 1; else hi = mid;
  }
  const a = pts[lo - 1]!, b = pts[lo]!;
  const seg = cum[lo]! - cum[lo - 1]!;
  const k = seg > 1e-9 ? (dd - cum[lo - 1]!) / seg : 1;
  return {
    x: a.x + (b.x - a.x) * k,
    z: a.z + (b.z - a.z) * k,
    heading: seg > 1e-9 ? Math.atan2(b.x - a.x, b.z - a.z) : fallbackHeading,
  };
}

/** Shortest signed angle from a to b, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Turn `current` toward `target` with a speed limit and smooth ease, never overshooting.
 * Returns the new angle.
 */
export function turnToward(current: number, target: number, dt: number, rate: number, maxSpeed: number): number {
  const d = angleDiff(current, target);
  const want = d * (1 - Math.exp(-rate * dt));
  const cap = maxSpeed * dt;
  const step = Math.max(-cap, Math.min(cap, want));
  return current + step;
}

/**
 * Chaikin corner-cutting turns a string-pulled polyline into a rounded path. `clear` vets every
 * resulting segment against the nav grid; if rounding would clip furniture, the sharper path is kept.
 */
export function curvePath(path: Pt[], clear: (a: Pt, b: Pt) => boolean, iterations = 2): Pt[] {
  if (path.length < 3) return path;
  let cur = path;
  for (let it = 0; it < iterations; it++) {
    const next: Pt[] = [cur[0]!];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i]!, b = cur[i + 1]!;
      const q = { x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 };
      const r = { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 };
      if (i > 0) next.push(q);
      if (i < cur.length - 2) next.push(r);
    }
    next.push(cur[cur.length - 1]!);
    let ok = true;
    for (let i = 1; i < next.length; i++) {
      if (!clear(next[i - 1]!, next[i]!)) { ok = false; break; }
    }
    if (!ok) return cur;
    cur = next;
  }
  return cur;
}
