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

const TAIL_SEGMENTS = 5;
const LEG = 0.22;

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
  const legMesh = useRef<(THREE.Mesh | null)[]>([]);
  const shadow = useRef<THREE.Mesh>(null);

  const pose = useRef<Pose>({ ...NEUTRAL });
  const pos = useRef({ x: 0, z: 0, y: 0, h: 0, init: false });
  const phase = useRef(0);
  const blink = useRef({ next: 2, t: -1 });
  const lastAct = useRef<string>('');
  const lastStep = useRef(0);

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
    // Ease toward the computed place so corrections after a refresh never pop.
    const k = 1 - Math.exp(-10 * dt);
    P.x += (pl.x - P.x) * k; P.z += (pl.z - P.z) * k; P.y += (pl.y - P.y) * (1 - Math.exp(-8 * dt));
    let dh = pl.heading - P.h;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    P.h += dh * (1 - Math.exp(-(pl.moving ? 9 : 4) * dt));
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

    // ---- body
    const legLen = LEG * prop.legs;
    const standY = legLen + 0.12 * prop.body;
    const sit = p.sit, lie = Math.max(p.lie, p.curl);
    let bodyY = standY * (1 - 0.52 * sit - 0.7 * lie) - p.crouch * legLen * 0.5 + p.raise * 0.1 - p.stretchF * 0.06;
    bodyY += Math.abs(Math.sin(phase.current)) * 0.018 * p.walk * (1 + clumsy * 0.6);
    bodyY += p.bob * 0.01 * Math.sin(time * 14);
    const b = body.current!;
    b.position.y = Math.max(0.07, bodyY);
    const pitch = -0.85 * sit - 1.05 * p.raise + 0.38 * p.stretchF + 0.05 * p.crouch;
    b.rotation.x = pitch;
    b.rotation.z = p.lean * 0.35;
    b.rotation.y = Math.sin(phase.current) * 0.05 * p.walk;
    const breathRate = input.activity === 'sleep' ? 1.3 : 2.4;
    const breathe = 1 + 0.03 * Math.sin(time * breathRate);
    torso.current!.scale.set(1 + p.puff * 0.2, breathe * (1 + p.puff * 0.15) * (1 - 0.15 * p.curl), 1 - 0.28 * p.curl);

    // ---- legs
    if (pl.moving) phase.current += dt * plan.speed * 7.5;
    const swing = Math.sin(phase.current) * 0.7 * p.walk;
    const kneadSwing = Math.sin(time * 5) * 0.4 * p.bob * (input.activity === 'scratch' ? 1 : 0);
    const legPoses = [
      // front-left, front-right, hind-left, hind-right
      { rx: swing - 1.9 * p.raise - 0.9 * p.stretchF + kneadSwing - pitch * 0.9 + 0.3 * lie * 1 },
      { rx: -swing - 1.9 * p.raise - 0.9 * p.stretchF - kneadSwing - pitch * 0.9 + 0.3 * lie * 1 },
      { rx: -swing - 1.25 * sit - 1.1 * lie + 0.15 * p.stretchF - pitch * 0.2 },
      { rx: swing - 1.25 * sit - 1.1 * lie + 0.15 * p.stretchF - pitch * 0.2 },
    ];
    for (let i = 0; i < 4; i++) {
      const lg = legs.current[i];
      if (!lg) continue;
      lg.rotation.x = legPoses[i]!.rx;
      const m = legMesh.current[i];
      if (m) m.scale.y = Math.max(0.3, (1 - 0.35 * lie - 0.18 * p.crouch) * prop.legs);
    }

    // ---- head and face
    const h = head.current!;
    h.position.set(0, 0.1 * prop.body, 0.4 * prop.body);
    h.rotation.x = p.headPitch - pitch * 0.75;
    h.rotation.y = p.headYaw;
    h.rotation.z = p.headRoll;
    h.scale.setScalar(prop.head);
    for (const [ref, sgn] of [[earL, 1], [earR, -1]] as const) {
      const e = ref.current;
      if (!e) continue;
      e.rotation.z = sgn * (p.earBack * 0.9 + p.earSwivel * sgn * 0.4);
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
    if (pl.moving && time - lastStep.current > (pl.trot ? 0.22 : 0.36)) {
      lastStep.current = time;
      audio.step();
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
        {/* legs: [x, z] hips */}
        {([[0.09, 0.2], [-0.09, 0.2], [0.09, -0.2], [-0.09, -0.2]] as const).map(([x, z], i) => (
          <group key={i} position={[x, -0.05, z]} ref={(el) => { legs.current[i] = el; }}>
            <mesh ref={(el) => { legMesh.current[i] = el; }} position={[0, -LEG / 2, 0]} material={i < 2 ? bodyMat : darkMat} castShadow>
              <capsuleGeometry args={[0.04, LEG - 0.06, 4, 8]} />
            </mesh>
            <mesh position={[0, -LEG, 0.02]} material={accentMat}><sphereGeometry args={[0.048, 8, 6]} /></mesh>
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
