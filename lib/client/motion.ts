import { ACTIVITY_DEFS } from '@/lib/sim/activities';
import type { Activity, WorldObject } from '@/lib/sim/types';
import { OBJECT_DEFS } from '@/lib/world/catalog';
import { buildGrid, findPath, lineClear, type Pt } from '@/lib/world/nav';
import { angleDiff, curvePath, distanceAt, makeProfile, makeTrack, sampleTrack, speedAt, type Profile, type Track } from '@/lib/world/kinematics';
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
  /** Rounded path the cat walks (dense polyline). */
  track: Track;
  profile: Profile;
  /** Peak walking speed in m/s. */
  speed: number;
  /** Seconds after activitySince that the cat arrives. */
  arriveAfter: number;
  /** Final standing height (jumping onto furniture). */
  endY: number;
  endHeading: number;
  startHeading: number;
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
  let faceHeading: number | undefined;
  if (m.activity === 'explore' || m.activity === 'return_home') {
    if (target) to = { x: target.x, z: target.z };
  } else if (target) {
    const spot = useSpot(grid, target, m.activity, from);
    to = { x: spot.x, z: spot.z };
    endY = spot.y;
    faceHeading = spot.heading;
  } else if (m.destX !== null && m.destZ !== null) {
    to = { x: m.destX, z: m.destZ };
  }
  const raw = findPath(grid, from, to) ?? [from, to];
  const rounded = curvePath(raw, (a, b) => lineClear(grid, a, b));
  const track = makeTrack(rounded);
  const duration = Math.max(1, (m.activityUntil - m.activitySince) / 1000);
  // Hurry (a trot) only if the walk would otherwise eat most of the activity.
  const speed = Math.min(2.6, Math.max(walkSpeed, (track.length / (duration * 0.7)) * 1.15));
  const profile = makeProfile(track.length, speed);
  const last = rounded[rounded.length - 1]!;
  const prev = rounded[rounded.length - 2] ?? from;
  const travelHeading = track.length > 0.05 ? Math.atan2(last.x - prev.x, last.z - prev.z) : 0;
  const endHeading = faceHeading ?? (target && !OBJECT_DEFS[target.type]?.blocks ? target.rotation : travelHeading);
  const startHeading = sampleTrack(track, 0.05, travelHeading).heading;
  return { track, profile, speed, arriveAfter: profile.duration, endY, endHeading, startHeading };
}

export interface Placement {
  x: number; z: number; y: number; heading: number;
  moving: boolean; trot: boolean; settled: boolean;
  /** Current speed in m/s, from the velocity profile. */
  speed: number;
}

export function placeAt(plan: MotionPlan, m: MotionInput, nowMs: number): Placement {
  const t = Math.max(0, (nowMs - m.activitySince) / 1000);
  const { track, profile } = plan;
  if (track.length < 0.05 || t >= profile.duration) {
    const last = track.pts[track.pts.length - 1]!;
    return { x: last.x, z: last.z, y: plan.endY, heading: plan.endHeading, moving: false, trot: false, settled: true, speed: 0 };
  }
  const d = distanceAt(profile, t);
  const s = sampleTrack(track, d, plan.startHeading);
  const v = speedAt(profile, t);
  // Hop up at the very end of a climb.
  const left = track.length - d;
  const climb = plan.endY > 0 && left < 0.6 ? Math.min(1, 1 - left / 0.6) : 0;
  // In the last stretch, ease the heading toward the way the cat will face on arrival.
  const settle = left < 0.5 ? 1 - left / 0.5 : 0;
  const heading = settle > 0 ? s.heading + angleDiff(s.heading, plan.endHeading) * settle * settle : s.heading;
  return { x: s.x, z: s.z, y: plan.endY * climb * climb * (3 - 2 * climb), heading, moving: true, trot: v > 1.5, settled: false, speed: v };
}

export const isAwake = (a: Activity) => ACTIVITY_DEFS[a].awake;
