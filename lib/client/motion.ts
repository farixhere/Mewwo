import { ACTIVITY_DEFS } from '@/lib/sim/activities';
import type { Activity, WorldObject } from '@/lib/sim/types';
import { OBJECT_DEFS } from '@/lib/world/catalog';
import { buildGrid, findPath, pathLength, type Pt } from '@/lib/world/nav';
import { useSpot } from '@/lib/world/place';

export interface MotionInput {
  location: string;
  activity: Activity;
  targetId: string | null;
  x: number; z: number;
  destX: number | null; destZ: number | null;
  activitySince: number;
  activityUntil: number;
}

export interface MotionPlan {
  path: Pt[];
  length: number;
  speed: number;
  /** Seconds after activitySince that the cat arrives. */
  arriveAfter: number;
  /** Final standing height (jumping onto furniture). */
  endY: number;
  endHeading: number;
}

/**
 * Both players compute the same plan from the same saved state, so they see the cat in the same place
 * without the server having to stream positions.
 */
export function planMotion(m: MotionInput, objects: WorldObject[], walkSpeed: number): MotionPlan {
  const here = objects.filter((o) => o.location === m.location);
  const target = m.targetId ? here.find((o) => o.id === m.targetId) : undefined;
  const grid = buildGrid(m.location, here);
  const from = { x: m.x, z: m.z };
  let to: Pt = from;
  let endY = 0;
  if (m.activity === 'explore' || m.activity === 'return_home') {
    if (target) to = { x: target.x, z: target.z };
  } else if (target) {
    const spot = useSpot(grid, target, m.activity, from);
    to = { x: spot.x, z: spot.z };
    endY = spot.y;
  } else if (m.destX !== null && m.destZ !== null) {
    to = { x: m.destX, z: m.destZ };
  }
  const path = findPath(grid, from, to) ?? [from, to];
  const length = pathLength(path);
  const duration = Math.max(1, (m.activityUntil - m.activitySince) / 1000);
  // Hurry (a trot) only if the walk would otherwise eat most of the activity.
  const speed = Math.min(2.6, Math.max(walkSpeed, length / (duration * 0.7)));
  const last = path[path.length - 1]!;
  const prev = path[path.length - 2] ?? from;
  const endHeading = target && !OBJECT_DEFS[target.type]?.blocks
    ? target.rotation
    : Math.atan2(last.x - prev.x, last.z - prev.z);
  return { path, length, speed, arriveAfter: length / speed, endY, endHeading };
}

export interface Placement { x: number; z: number; y: number; heading: number; moving: boolean; trot: boolean; settled: boolean }

export function placeAt(plan: MotionPlan, m: MotionInput, nowMs: number): Placement {
  const t = Math.max(0, (nowMs - m.activitySince) / 1000);
  const { path } = plan;
  if (plan.length < 0.05 || t >= plan.arriveAfter) {
    const last = path[path.length - 1]!;
    return { x: last.x, z: last.z, y: plan.endY, heading: plan.endHeading, moving: false, trot: false, settled: true };
  }
  let d = t * plan.speed;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= seg || i === path.length - 1) {
      const k = seg > 0 ? Math.min(1, d / seg) : 1;
      // Hop up at the very end of a climb.
      const climb = plan.endY > 0 && plan.length - t * plan.speed < 0.6 ? Math.min(1, 1 - (plan.length - t * plan.speed) / 0.6) : 0;
      return {
        x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, y: plan.endY * climb,
        heading: Math.atan2(b.x - a.x, b.z - a.z), moving: true, trot: plan.speed > 1.5, settled: false,
      };
    }
    d -= seg;
  }
  const last = path[path.length - 1]!;
  return { x: last.x, z: last.z, y: plan.endY, heading: plan.endHeading, moving: false, trot: false, settled: true };
}

export const isAwake = (a: Activity) => ACTIVITY_DEFS[a].awake;
