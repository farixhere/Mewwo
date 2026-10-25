import type { Activity } from '../sim/types.ts';

/** Every channel is a number so blending between any two poses is just damping. */
export interface Pose {
  sit: number;        // 0 standing .. 1 seated (hind legs folded, front raised)
  lie: number;        // 0..1 loaf / lying, body low
  curl: number;       // 0..1 curled sleeping ball
  crouch: number;     // 0..1 low hunting / hiding stance
  raise: number;      // 0..1 front body lifted (scratching)
  stretchF: number;   // 0..1 front down, rear up (play-bow / stretch)
  headPitch: number;  // radians, + looks down
  headYaw: number;    // radians
  headRoll: number;
  earBack: number;    // 0 forward .. 1 flat
  earSwivel: number;  // asymmetric ear movement (listening)
  tailLift: number;   // radians from hanging, + raises
  tailSway: number;   // amplitude of side-to-side
  tailCurl: number;   // tail wrapped around body
  eyeOpen: number;    // 0 closed .. 1 wide
  walk: number;       // leg swing amplitude 0..1
  bob: number;        // small repetitive body motion (chewing, kneading)
  lean: number;       // body roll (rubbing)
  puff: number;       // fur fluffing when frightened
}

export const NEUTRAL: Pose = {
  sit: 0, lie: 0, curl: 0, crouch: 0, raise: 0, stretchF: 0, headPitch: 0, headYaw: 0, headRoll: 0,
  earBack: 0.05, earSwivel: 0, tailLift: 0.35, tailSway: 0.15, tailCurl: 0, eyeOpen: 0.9, walk: 0, bob: 0, lean: 0, puff: 0,
};

export interface PoseInput {
  activity: Activity;
  /** Seconds since the activity began. */
  t: number;
  moving: boolean;
  trot: boolean;
  stress: number;      // 0..1
  energy: number;      // 0..1
  /** Bird seen near the window right now. */
  birds: boolean;
  /** 0..1 how much the cat trusts the nearest person: loosens posture around them. */
  trust: number;
}

const s = Math.sin;

/**
 * Body language depends on context, never on one signal alone: a swishing tail means different things while
 * stalking a toy, eating, or being approached by a stranger, so each activity sets its own tail and ear behaviour,
 * and stress only colours the result.
 */
export function poseFor(i: PoseInput): Pose {
  const p: Pose = { ...NEUTRAL };
  const uneasy = Math.max(0, i.stress - 0.25) / 0.45;
  const t = i.t;

  if (i.moving) {
    p.walk = i.trot ? 1 : 0.6;
    p.tailLift = 0.55 + (i.trot ? 0.2 : 0);
    p.tailSway = 0.12;
    p.headPitch = 0.1;
    p.headYaw = s(t * 0.9) * 0.15;
    if (i.activity === 'approach_person' || i.activity === 'seek_attention') { p.tailLift = 1.25; p.tailSway = 0.05; p.earBack = 0; }
    else if (i.activity === 'investigate' || i.activity === 'sniff') { p.crouch = 0.25; p.headPitch = 0.35; p.walk = 0.35; p.tailLift = 0.2; }
    else if (i.activity === 'retreat' || i.activity === 'hide') { p.crouch = 0.4; p.earBack = 0.5; p.tailLift = 0.05; }
    else if (i.activity === 'play') { p.crouch = 0.45; p.walk = 0.5; p.tailSway = 0.6; p.tailLift = 0.4; }
    p.earBack += uneasy * 0.35;
    p.tailLift -= uneasy * 0.35;
    return p;
  }

  switch (i.activity) {
    case 'idle':
      p.sit = 1; p.headYaw = s(t * 0.4) * 0.25; p.tailCurl = 0.7; p.tailSway = 0.05; p.tailLift = 0.1;
      break;
    case 'look_around':
      p.sit = 0.7; p.headYaw = s(t * 0.7) * 0.9; p.headPitch = -0.1; p.earSwivel = s(t * 1.3) * 0.5; p.tailCurl = 0.4;
      break;
    case 'wander':
      p.headYaw = s(t * 0.8) * 0.4; p.walk = 0;
      break;
    case 'sniff':
      p.headPitch = 0.55 + s(t * 6) * 0.06; p.crouch = 0.2; p.tailLift = 0.2; p.earSwivel = 0.2;
      break;
    case 'investigate':
      p.crouch = 0.3 + s(t * 0.5) * 0.05; p.headPitch = 0.4 + s(t * 1.1) * 0.2; p.headYaw = s(t * 0.6) * 0.5;
      p.tailLift = 0.15; p.tailSway = 0.25; p.earSwivel = s(t * 1.7) * 0.4; p.eyeOpen = 1;
      break;
    case 'eat':
      p.crouch = 0.35; p.headPitch = 1.0; p.bob = 0.5 + 0.5 * s(t * 7); p.tailLift = 0.25; p.tailSway = 0.05; p.earBack = 0.1;
      break;
    case 'drink':
      p.crouch = 0.4; p.headPitch = 1.1; p.bob = 0.3 + 0.3 * s(t * 9); p.tailLift = 0.2; p.tailSway = 0.03;
      break;
    case 'groom': {
      const lick = s(t * 4.5);
      p.sit = 1; p.headPitch = 0.9 + lick * 0.12; p.headYaw = 0.6; p.headRoll = 0.3; p.tailCurl = 0.9; p.eyeOpen = 0.35; p.bob = 0.4 + 0.4 * lick;
      p.tailLift = 0.0; p.tailSway = 0.02;
      break;
    }
    case 'scratch':
      p.raise = 1; p.headPitch = -0.25; p.bob = 0.5 + 0.5 * s(t * 5); p.tailLift = 0.6; p.eyeOpen = 0.6;
      break;
    case 'stretch':
      p.stretchF = 0.6 + 0.4 * s(Math.min(t, 1.5) * 2); p.headPitch = 0.3; p.tailLift = 1.1; p.eyeOpen = 0.5;
      break;
    case 'rest':
      p.lie = 1; p.headPitch = -0.05; p.tailCurl = 1; p.eyeOpen = 0.45 + 0.1 * s(t * 0.3); p.tailSway = 0; p.tailLift = 0;
      p.earBack = 0.1; p.earSwivel = s(t * 0.9) * 0.15;
      break;
    case 'sleep':
      p.curl = 1; p.headPitch = 0.6; p.headYaw = 0.5; p.eyeOpen = 0; p.tailCurl = 1; p.tailSway = 0; p.tailLift = 0; p.bob = 0.2 + 0.2 * s(t * 1.1);
      p.earBack = 0.25;
      break;
    case 'play': {
      // Stalk, wiggle, pounce, repeat. A real cat's tail lashes while it hunts; that's excitement, not irritation.
      const c = t % 3.2;
      if (c < 1.4) { p.crouch = 0.85; p.headPitch = 0.25; p.tailSway = 0.9 + s(t * 3) * 0.2; p.tailLift = 0.15; p.eyeOpen = 1; p.bob = 0.4 + 0.4 * s(t * 18); }
      else if (c < 1.9) { p.crouch = 0.2; p.stretchF = 0.7; p.tailLift = 0.9; p.headPitch = 0.5; }
      else { p.sit = 0.4; p.headYaw = s(t * 2) * 0.5; p.tailSway = 0.4; p.tailLift = 0.5; p.eyeOpen = 1; }
      p.earBack = 0.05;
      break;
    }
    case 'watch_bird': {
      p.sit = 1; p.headPitch = -0.5; p.headYaw = s(t * 0.5) * 0.35; p.earSwivel = s(t * 2.1) * 0.5; p.eyeOpen = 1;
      p.tailSway = i.birds ? 0.5 : 0.1; p.tailLift = 0.05; p.tailCurl = 0.3;
      if (i.birds) p.bob = 0.5 + 0.5 * s(t * 22) * 0.2;
      break;
    }
    case 'hide':
      p.crouch = 0.9; p.lie = 0.3; p.earBack = 0.55; p.eyeOpen = 1; p.tailLift = 0; p.tailCurl = 0.8; p.headPitch = 0.1; p.puff = uneasy * 0.3;
      break;
    case 'approach_person':
      p.tailLift = 1.25; p.tailSway = 0.08; p.earBack = 0; p.headPitch = -0.1;
      break;
    case 'rub':
      p.lean = 0.5 * s(t * 2.4); p.tailLift = 1.3; p.tailSway = 0.06; p.eyeOpen = 0.3; p.headYaw = s(t * 2.4) * 0.35; p.walk = 0.12; p.earBack = 0.1;
      break;
    case 'seek_attention':
      p.sit = 0.85; p.headPitch = -0.2 + s(t * 2) * 0.1; p.tailLift = 0.9; p.tailSway = 0.2; p.eyeOpen = 1; p.bob = 0.4 + 0.3 * s(t * 3);
      break;
    case 'retreat':
      p.crouch = 0.45; p.lie = 0.4; p.earBack = 0.45; p.tailLift = 0.0; p.tailCurl = 0.7; p.headPitch = 0.15; p.eyeOpen = 0.8;
      break;
    case 'litter':
      p.crouch = 0.75; p.headPitch = 0.1; p.tailLift = 0.7; p.eyeOpen = 0.7; p.bob = 0.2;
      break;
    default:
      break;
  }

  // Stress colours the result without overriding the activity.
  p.earBack = Math.min(1, p.earBack + uneasy * 0.35);
  p.tailLift -= uneasy * 0.25;
  p.puff = Math.max(p.puff, uneasy * 0.25);
  // Sleepy cats close their eyes a little, trusting cats a bit more.
  if (i.energy < 0.25 && p.eyeOpen > 0.5) p.eyeOpen *= 0.7;
  if (i.trust > 0.6 && i.activity !== 'sleep') p.earBack = Math.max(0, p.earBack - 0.08);
  return p;
}

/** Blend every channel toward `to`. `k` is 1 - exp(-rate * dt). */
export function blend(from: Pose, to: Pose, k: number): Pose {
  const out = { ...from };
  for (const key of Object.keys(to) as (keyof Pose)[]) out[key] = from[key] + (to[key] - from[key]) * k;
  return out;
}

// ---------------------------------------------------------------- reaction overlays

export type ReactionBody = 'none' | 'greet' | 'lean' | 'recoil' | 'alert' | 'settle' | 'perk';

/** 0 -> 1 -> 0 envelope over `dur` seconds: quick to react, slow to relax. */
export function reactionEnvelope(t: number, dur: number): number {
  if (t < 0 || t > dur) return 0;
  const attack = Math.min(1, t / 0.18);
  const release = Math.min(1, (dur - t) / 0.6);
  const e = Math.min(attack, release);
  return e * e * (3 - 2 * e);
}

/**
 * Lays a communicative posture over whatever the cat is already doing, scaled by `env` (0..1). It only nudges
 * channels, so the underlying activity (walking, sitting, sleeping) carries on and blends smoothly in and out.
 */
export function applyReactionBody(p: Pose, body: ReactionBody, env: number, intensity = 0.6): Pose {
  if (body === 'none' || env <= 0) return p;
  const q = { ...p };
  const k = env * (0.5 + 0.5 * intensity);
  switch (body) {
    case 'perk': // ears up and forward, head lifted: "I heard that"
      q.earBack = p.earBack + (-0.25 - p.earBack) * k;
      q.earSwivel = p.earSwivel + 0.5 * k;
      q.headPitch = p.headPitch - 0.12 * k;
      q.eyeOpen = Math.min(1, p.eyeOpen + 0.15 * k);
      break;
    case 'greet': // tail straight up, a little bounce of the head
      q.tailLift = p.tailLift + (1.25 - p.tailLift) * k;
      q.tailSway = p.tailSway * (1 - k) + 0.05 * k;
      q.earBack = p.earBack + (-0.15 - p.earBack) * k;
      q.headPitch = p.headPitch - 0.1 * k;
      break;
    case 'lean': // pressing into a hand: head tilted and pushing, eyes softly narrowed
      q.headRoll = p.headRoll + 0.28 * k;
      q.headPitch = p.headPitch + 0.12 * k;
      q.eyeOpen = p.eyeOpen * (1 - 0.5 * k);
      q.earBack = p.earBack + 0.2 * k;
      q.tailLift = p.tailLift + 0.25 * k;
      q.lean = p.lean + 0.3 * k;
      break;
    case 'recoil': // enough, thanks: ears flat-ish, low, tail down
      q.earBack = p.earBack + (0.8 - p.earBack) * k;
      q.crouch = Math.min(1, p.crouch + 0.3 * k);
      q.tailLift = p.tailLift * (1 - 0.9 * k);
      q.tailSway = p.tailSway + 0.5 * k;
      q.headPitch = p.headPitch + 0.1 * k;
      break;
    case 'alert': // locked on: head up, ears swivelled, tail still
      q.headPitch = p.headPitch - 0.15 * k;
      q.earBack = p.earBack + (-0.2 - p.earBack) * k;
      q.earSwivel = p.earSwivel + 0.6 * k;
      q.tailSway = p.tailSway * (1 - 0.6 * k);
      q.eyeOpen = Math.min(1, p.eyeOpen + 0.2 * k);
      break;
    case 'settle': // sleepy: slow blink, head sinking
      q.eyeOpen = p.eyeOpen * (1 - 0.6 * k);
      q.headPitch = p.headPitch + 0.2 * k;
      q.earBack = p.earBack + 0.15 * k;
      q.tailSway = p.tailSway * (1 - 0.7 * k);
      break;
  }
  return q;
}
