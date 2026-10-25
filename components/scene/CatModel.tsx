'use client';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGame } from '@/lib/client/store';
import { planMotion, placeAt, type MotionInput } from '@/lib/client/motion';
import { NEUTRAL, blend, poseFor, type Pose } from '@/lib/client/pose';
import { birdsAbout } from '@/lib/sim/brain';
import { COATS, blobTexture, mat } from './materials';
import { audio } from '@/lib/client/audio';
import { angleDiff, turnToward } from '@/lib/world/kinematics';

const TAIL_SEGMENTS = 5;
const UP = 0.12;   // upper leg (shoulder/hip to elbow/knee)
const LOW = 0.12;  // lower leg (to the paw)
const PAW_R = 0.048;
const STANCE = 0.6; // fraction of a stride a foot spends on the ground
const OFFSETS_WALK = [0, 0.5, -0.25, 0.25]; // FL, FR, HL, HR: lateral-sequence walk
const OFFSETS_TROT = [0, 0.5, 0.5, 0];      // diagonal pairs
const smooth01 = (u: number) => u * u * (3 - 2 * u);
const frac = (x: number) => x - Math.floor(x);

/**
 * A procedural cat. The asset interface is `<Cat />`: replace the body of this component with a rigged GLTF
 * and keep `poseFor` as the driver, and nothing else in the game changes.
 */
export function Cat() {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const earL = useRef<THREE.Group>(null);
  const earR = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Mesh>(null);
  const eyeR = useRef<THREE.Mesh>(null);
  const tail = useRef<(THREE.Group | null)[]>([]);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const knees = useRef<(THREE.Group | null)[]>([]);
  const shadow = useRef<THREE.Mesh>(null);

  const pose = useRef<Pose>({ ...NEUTRAL });
  const pos = useRef({ x: 0, z: 0, y: 0, h: 0, init: false, speed: 0, pitch: 0, roll: 0, trot: 0, lastSteps: 0 });
  const phase = useRef(0);
  const idleSeed = useRef(Math.random() * 100);
  const flick = useRef({ next: 3, t: -1, side: 0 });
  const blink = useRef({ next: 2, t: -1 });
  const lastAct = useRef<string>('');

  const view = useGame((s) => s.view);
  const viewLocation = useGame((s) => s.viewLocation);
  const select = useGame((s) => s.select);

  const coat = COATS[((view?.cat.coatSeed ?? 1) - 1) % COATS.length]!;
  const bodyMat = mat(coat.base);
  const accentMat = mat(coat.accent);
  const darkMat = mat(coat.dark);

  const input: MotionInput | null = view ? {
    location: view.cat.location, activity: view.cat.activity as MotionInput['activity'], targetId: view.cat.targetId,
    x: view.cat.x, z: view.cat.z, destX: view.cat.destX, destZ: view.cat.destZ,
    activitySince: view.cat.activitySince, activityUntil: view.cat.activityUntil,
  } : null;

  const key = input ? `${input.location}|${input.activity}|${input.targetId}|${input.x}|${input.z}|${input.destX}|${input.destZ}|${input.activitySince}|${input.activityUntil}|` +
    view!.objects.filter((o) => o.location === input.location).map((o) => `${o.id}:${o.x}:${o.z}:${o.rotation}`).join(',') : '';
  const plan = useMemo(() => {
    if (!input || !view) return null;
    const walk = 0.85 * view.cat.proportions.speed;
    return planMotion(input, view.objects, walk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useFrame((state, dtRaw) => {
    const g = root.current;
    const v = useGame.getState().view;
    if (!g || !v || !plan || !input) return;
    const dt = Math.min(0.05, dtRaw);
    const visible = useGame.getState().viewLocation === v.cat.location;
    g.visible = visible;
    if (!visible) return;

    const nowMs = useGame.getState().now();
    const pl = placeAt(plan, input, nowMs);
    const P = pos.current;
    if (!P.init) { P.x = pl.x; P.z = pl.z; P.y = pl.y; P.h = pl.heading; P.init = true; }
    // Follow the analytic placement closely; a big gap (first frame, tab restored) snaps instead of sliding.
    const prevX = P.x, prevZ = P.z;
    const gap = Math.hypot(pl.x - P.x, pl.z - P.z);
    if (gap > 1.5) { P.x = pl.x; P.z = pl.z; } else {
      const k = 1 - Math.exp(-18 * dt);
      P.x += (pl.x - P.x) * k; P.z += (pl.z - P.z) * k;
    }
    P.y += (pl.y - P.y) * (1 - Math.exp(-9 * dt));
    const disp = Math.hypot(P.x - prevX, P.z - prevZ);
    const realSpeed = dt > 0 ? disp / dt : 0;
    // Turn at a limited, eased rate: quicker when walking, lazy when settling in.
    const prevH = P.h;
    P.h = turnToward(P.h, pl.heading, dt, pl.moving ? 10 : 5, pl.moving ? 5.5 : 3);
    const turnRate = dt > 0 ? angleDiff(prevH, P.h) / dt : 0;
    g.position.set(P.x, P.y, P.z);
    g.rotation.y = P.h;

    const prop = v.cat.proportions;
    g.scale.setScalar(prop.scale);

    const t = Math.max(0, (nowMs - input.activitySince) / 1000);
    const hour = v.household.hour;
    const birds = birdsAbout(Math.floor(nowMs), hour, v.cat.id);
    const target = poseFor({
      activity: input.activity, t, moving: pl.moving, trot: pl.trot,
      stress: 1 - v.cat.needs.calm, energy: v.cat.needs.energy, birds, trust: 0.6,
    });
    pose.current = blend(pose.current, target, 1 - Math.exp(-(pl.moving ? 9 : 5) * dt));
    const p = pose.current;
    const time = state.clock.elapsedTime;
    const clumsy = prop.clumsiness;

    // ---- gait: the stride phase is locked to ground distance actually covered, so feet never slide
    const speedNorm = Math.min(1, realSpeed / 2);
    P.trot += ((pl.trot ? 1 : 0) - P.trot) * (1 - Math.exp(-4 * dt));
    const amp = (0.3 + 0.16 * speedNorm) * (0.6 + 0.4 * Math.min(1, p.walk)) * (1 + clumsy * 0.12);
    const legScale = prop.legs * (1 - 0.1 * Math.max(p.lie, p.curl));
    const R = (UP + LOW) * legScale;
    const strideLen = Math.max(0.12, (2 * R * Math.sin(amp)) / STANCE);
    if (disp > 1e-5 && p.walk > 0.15) phase.current += disp / strideLen;
    const steps = Math.floor(phase.current * 2);
    if (steps !== P.lastSteps) {
      if (pl.moving && p.walk > 0.5) audio.step();
      P.lastSteps = steps;
    }

    const sit = p.sit, lie = Math.max(p.lie, p.curl);
    const legAng = [0, 0, 0, 0], kneeAng = [0, 0, 0, 0];
    const wk = Math.min(1, p.walk);
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const off = OFFSETS_WALK[i]! * (1 - P.trot) + OFFSETS_TROT[i]! * P.trot;
      const s01 = frac(phase.current + off);
      const A = amp * (front ? 1 : 0.9) * wk;
      let h: number, k: number;
      if (s01 < STANCE) {
        const u = s01 / STANCE;
        h = -A + 2 * A * u;                       // foot sweeps back at ground speed
        k = (front ? 0.08 : 0.3) + 0.12 * u;
      } else {
        const u = (s01 - STANCE) / (1 - STANCE);
        h = A - 2 * A * smooth01(u);              // swing forward
        k = (front ? 0.08 : 0.3) + (front ? 1.0 : 1.15) * Math.sin(Math.PI * u) * wk;
      }
      const kneadSwing = (i < 2 ? (i === 0 ? 1 : -1) : 0) * Math.sin(time * 5) * 0.4 * p.bob * (input.activity === 'scratch' ? 1 : 0);
      legAng[i] = h * wk + kneadSwing;
      kneeAng[i] = k * wk + (front ? 0.08 : 0.3) * (1 - wk);
    }
    // Posture overrides (sitting, lying, rearing, stretching), blended in by the pose channels.
    const pitch = -0.85 * sit - 1.05 * p.raise + 0.38 * p.stretchF + 0.05 * p.crouch;
    const frontPose = -1.9 * p.raise - 0.9 * p.stretchF - pitch * 0.9 + 0.3 * lie;
    const hindPose = -1.25 * sit - 1.1 * lie + 0.15 * p.stretchF - pitch * 0.2;
    const fold = 1.5 * sit + 1.3 * lie + 0.5 * p.crouch;
    for (let i = 0; i < 4; i++) {
      const lg = legs.current[i], kn = knees.current[i];
      if (!lg || !kn) continue;
      lg.rotation.x = legAng[i]! + (i < 2 ? frontPose : hindPose);
      kn.rotation.x = kneeAng[i]! + (i < 2 ? fold * 0.3 : fold);
      lg.scale.setScalar(legScale);
    }

    // ---- body height: the lowest planted foot decides it while walking, posture decides it otherwise
    let reach = 0;
    for (let i = 0; i < 4; i++) {
      const fy = (UP * Math.cos(legAng[i]!) + LOW * Math.cos(legAng[i]! + kneeAng[i]!) + PAW_R) * legScale;
      if (fy > reach) reach = fy;
    }
    const standY = (UP + LOW + PAW_R) * legScale + 0.05;
    const walkY = reach + 0.05;
    const postureY = standY * (1 - 0.5 * sit - 0.68 * lie) - p.crouch * R * 0.5 + p.raise * 0.1 - p.stretchF * 0.06;
    let bodyY = postureY + (walkY - standY) * wk;
    bodyY += p.bob * 0.01 * Math.sin(time * 14);

    // Accelerating tips the nose down, braking rocks the weight back, turning leans into the corner.
    const acc = dt > 0 ? (realSpeed - P.speed) / dt : 0;
    P.speed += (realSpeed - P.speed) * (1 - Math.exp(-12 * dt));
    P.pitch += (Math.max(-0.12, Math.min(0.12, -acc * 0.025)) * wk - P.pitch) * (1 - Math.exp(-8 * dt));
    P.roll += (Math.max(-0.2, Math.min(0.2, -turnRate * 0.05 * Math.min(1.5, realSpeed))) - P.roll) * (1 - Math.exp(-8 * dt));

    const b = body.current!;
    b.position.y = Math.max(0.07, bodyY);
    b.rotation.x = pitch - P.pitch;
    b.rotation.z = p.lean * 0.35 + P.roll;
    b.rotation.y = Math.sin(phase.current * Math.PI * 2) * 0.05 * wk;
    const breathRate = input.activity === 'sleep' ? 1.3 : 2.4;
    const breathe = 1 + 0.03 * Math.sin(time * breathRate);
    torso.current!.scale.set(1 + p.puff * 0.2, breathe * (1 + p.puff * 0.15) * (1 - 0.15 * p.curl), 1 - 0.28 * p.curl);

    // ---- head and face
    const h = head.current!;
    h.position.set(0, 0.1 * prop.body, 0.4 * prop.body);
    // Idle life: slow independent head drift while awake and still, and the head leads into turns.
    const awakeStill = (1 - wk) * (p.eyeOpen > 0.4 ? 1 : 0) * (1 - Math.max(p.lie, p.curl));
    const seed = idleSeed.current;
    const drift = awakeStill * (0.22 * Math.sin(time * 0.43 + seed) + 0.12 * Math.sin(time * 1.1 + seed * 2));
    const lead = Math.max(-0.5, Math.min(0.5, -turnRate * 0.12)) * wk;
    h.rotation.x = p.headPitch - pitch * 0.75 + 0.05 * awakeStill * Math.sin(time * 0.31 + seed) - (P.pitch * 0.6);
    h.rotation.y = p.headYaw + drift + lead;
    h.rotation.z = p.headRoll;
    h.scale.setScalar(prop.head);
    // An occasional ear flick, on one side at a time.
    const fl = flick.current;
    if (time > fl.next && fl.t < 0 && p.eyeOpen > 0.3) { fl.t = 0; fl.side = Math.sin(time * 91.7) > 0 ? 1 : -1; fl.next = time + 4 + (frac(Math.sin(time * 7.13) * 4375.85) * 7); }
    let flickAmt = 0;
    if (fl.t >= 0) { fl.t += dt; flickAmt = Math.sin(Math.min(1, fl.t / 0.22) * Math.PI) * 0.45; if (fl.t > 0.22) fl.t = -1; }
    for (const [ref, sgn] of [[earL, 1], [earR, -1]] as const) {
      const e = ref.current;
      if (!e) continue;
      e.rotation.z = sgn * (p.earBack * 0.9 + p.earSwivel * sgn * 0.4) + (fl.side === sgn ? sgn * flickAmt : 0);
      e.rotation.x = -0.1 + p.earBack * 0.7;
      e.scale.setScalar(prop.ears);
    }
    // Blinks: a slow blink every few seconds, never while asleep.
    const bl = blink.current;
    if (time > bl.next && bl.t < 0 && p.eyeOpen > 0.3) { bl.t = 0; bl.next = time + 2.5 + ((Math.sin(time * 12.9898) * 43758.5453) % 1 + 1) % 1 * 4; }
    let lid = 1;
    if (bl.t >= 0) { bl.t += dt; lid = Math.abs(bl.t - 0.07) / 0.07; if (bl.t > 0.14) bl.t = -1; lid = Math.min(1, lid); }
    for (const ref of [eyeL, eyeR]) {
      const e = ref.current;
      if (!e) continue;
      e.scale.set(prop.eyes, Math.max(0.04, p.eyeOpen * lid) * prop.eyes, prop.eyes * 0.6);
    }

    // ---- tail
    const segs = tail.current;
    const per = (Math.max(-0.3, p.tailLift)) / TAIL_SEGMENTS;
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const sg = segs[i];
      if (!sg) continue;
      const wave = Math.sin(time * (2.2 + p.tailSway * 4) - i * 0.7) * p.tailSway * (0.15 + i * 0.12);
      sg.rotation.x = per * (i === 0 ? 1.4 : 1) - (i > 2 ? 0.1 : 0);
      sg.rotation.y = wave + p.tailCurl * 0.55;
      sg.rotation.z = 0;
    }
    if (shadow.current) {
      shadow.current.scale.setScalar(1 + p.lie * 0.2);
      shadow.current.position.y = 0.012 - P.y / prop.scale;
    }

    // ---- sound cues tied to what the cat is actually doing
    if (lastAct.current !== input.activity + input.activitySince) {
      lastAct.current = input.activity + input.activitySince;
      audio.onActivity(input.activity, v.cat.mood);
    }
  });

  return (
    <group ref={root} onClick={(e) => { if (e.delta > 6) return; e.stopPropagation(); select({ kind: 'cat' }); }}>
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} renderOrder={1}>
        <planeGeometry args={[0.9, 1.3]} />
        <meshBasicMaterial map={blobTexture()} transparent depthWrite={false} />
      </mesh>
      {/* generous invisible tap target for small fingers */}
      <mesh position={[0, 0.25, 0]} visible={false}>
        <sphereGeometry args={[0.55, 8, 8]} />
      </mesh>
      <group ref={body} position={[0, 0.34, 0]}>
        {/* the wrapper is scaled for breathing; the capsule inside is turned to lie along the body (+z) */}
        <group ref={torso}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={bodyMat} castShadow>
            <capsuleGeometry args={[0.15, 0.34, 6, 12]} />
          </mesh>
        </group>
        {/* belly / chest patch */}
        <mesh position={[0, -0.06, 0.12]} scale={[0.9, 0.7, 1.1]} material={accentMat}>
          <sphereGeometry args={[0.12, 10, 8]} />
        </mesh>
        {/* head */}
        <group ref={head} position={[0, 0.1, 0.4]}>
          <mesh material={bodyMat} castShadow><sphereGeometry args={[0.15, 14, 12]} /></mesh>
          <mesh position={[0, -0.04, 0.12]} material={accentMat} scale={[1, 0.8, 1]}><sphereGeometry args={[0.075, 10, 8]} /></mesh>
          <mesh position={[0, -0.015, 0.19]} material={mat('#e8a0a8')}><sphereGeometry args={[0.02, 8, 6]} /></mesh>
          <group ref={earL} position={[0.085, 0.11, -0.02]}>
            <mesh position={[0, 0.05, 0]} material={bodyMat}><coneGeometry args={[0.065, 0.13, 4]} /></mesh>
            <mesh position={[0, 0.04, 0.012]} material={mat('#e9aaa6')}><coneGeometry args={[0.035, 0.08, 4]} /></mesh>
          </group>
          <group ref={earR} position={[-0.085, 0.11, -0.02]}>
            <mesh position={[0, 0.05, 0]} material={bodyMat}><coneGeometry args={[0.065, 0.13, 4]} /></mesh>
            <mesh position={[0, 0.04, 0.012]} material={mat('#e9aaa6')}><coneGeometry args={[0.035, 0.08, 4]} /></mesh>
          </group>
          <mesh ref={eyeL} position={[0.065, 0.03, 0.125]} material={mat('#22301f', { rough: 0.3 })}><sphereGeometry args={[0.03, 10, 8]} /></mesh>
          <mesh ref={eyeR} position={[-0.065, 0.03, 0.125]} material={mat('#22301f', { rough: 0.3 })}><sphereGeometry args={[0.03, 10, 8]} /></mesh>
        </group>
        {/* legs: [x, z] hips; each has an upper segment, a knee, and a lower segment ending in a paw */}
        {([[0.09, 0.2], [-0.09, 0.2], [0.09, -0.2], [-0.09, -0.2]] as const).map(([x, z], i) => (
          <group key={i} position={[x, -0.05, z]} ref={(el) => { legs.current[i] = el; }}>
            <mesh position={[0, -UP / 2, 0]} material={i < 2 ? bodyMat : darkMat} castShadow>
              <capsuleGeometry args={[0.046, UP - 0.05, 4, 8]} />
            </mesh>
            <group position={[0, -UP, 0]} ref={(el) => { knees.current[i] = el; }}>
              <mesh position={[0, -LOW / 2, 0]} material={i < 2 ? bodyMat : darkMat} castShadow>
                <capsuleGeometry args={[0.036, LOW - 0.04, 4, 8]} />
              </mesh>
              <mesh position={[0, -LOW, 0.02]} scale={[1, 0.8, 1.25]} material={accentMat}><sphereGeometry args={[PAW_R, 8, 6]} /></mesh>
            </group>
          </group>
        ))}
        {/* tail */}
        <group position={[0, 0.03, -0.38]}>
          <TailChain refs={tail} mat={darkMat} tipMat={accentMat} />
        </group>
      </group>
    </group>
  );
}

function TailChain({ refs, mat: m, tipMat }: { refs: React.MutableRefObject<(THREE.Group | null)[]>; mat: THREE.Material; tipMat: THREE.Material }) {
  const seg = (i: number): React.ReactNode => (
    <group ref={(el) => { refs.current[i] = el; }} position={[0, 0, i === 0 ? 0 : -0.1]}>
      <mesh position={[0, 0, -0.05]} rotation={[Math.PI / 2, 0, 0]} material={i === TAIL_SEGMENTS - 1 ? tipMat : m}>
        <capsuleGeometry args={[0.032 - i * 0.003, 0.09, 3, 6]} />
      </mesh>
      {i < TAIL_SEGMENTS - 1 ? seg(i + 1) : null}
    </group>
  );
  return <>{seg(0)}</>;
}
