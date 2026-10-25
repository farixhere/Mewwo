'use client';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useGame } from '@/lib/client/store';
import { LOCATIONS, OBJECT_DEFS } from '@/lib/world/catalog';
import { validatePlacement } from '@/lib/world/nav';
import type { WorldObject } from '@/lib/sim/types';
import { Cat } from './CatModel';
import { FootprintGhost, Prop } from './Props';
import { GardenArea, HomeRoom } from './Room';
import { Atmosphere } from './Atmosphere';
import { QUALITY } from '@/lib/client/quality';
import { centreShift, fitZoom, freeRect, uiInsets } from '@/lib/client/layout';
import { audio } from '@/lib/client/audio';

const CAM_DIST = 12;
const POLAR = 0.95; // fixed tilt: a three-quarter overhead view

/**
 * Frames the room in the part of the screen the HUD leaves free, and glides there when the layout changes
 * (a sheet opens, the phone rotates, the player taps Home). Uses the camera's view offset to slide the picture
 * without touching the orbit target, so rotating and tapping stay exact.
 */
function AutoFrame({ location }: { location: string }) {
  const { camera, size } = useThree();
  const sheet = useGame((s) => !!s.selection || (!!s.panel && s.panel !== 'cat'));
  const moving = useGame((s) => !!s.move);
  const nonce = useGame((s) => s.cameraNonce);
  const goal = useRef({ zoom: 50, x: 0, y: 0 });
  const cur = useRef<{ zoom: number; x: number; y: number } | null>(null);
  useEffect(() => {
    const b = LOCATIONS[location]!.bounds;
    const ins = uiInsets({ width: size.width, height: size.height, sheet, moving });
    const shift = centreShift(ins);
    goal.current = { zoom: fitZoom(b.maxX - b.minX, b.maxZ - b.minZ, freeRect(size.width, size.height, ins)), x: shift.x, y: shift.y };
    if (!cur.current) cur.current = { ...goal.current };
    else cur.current.zoom = (camera as THREE.OrthographicCamera).zoom; // glide from wherever the player left it
  }, [size.width, size.height, location, sheet, moving, nonce]);
  useFrame((_, dt) => {
    const c = cur.current;
    if (!c) return;
    const k = 1 - Math.exp(-6 * Math.min(dt, 0.1));
    const dz = (goal.current.zoom - c.zoom) * k;
    c.zoom += dz;
    c.x += (goal.current.x - c.x) * k;
    c.y += (goal.current.y - c.y) * k;
    const cam = camera as THREE.OrthographicCamera;
    // Zoom moves by the same step, so a pinch from the player is never snapped back.
    if (Math.abs(dz) > 1e-4) { cam.zoom += dz; cam.updateProjectionMatrix(); }
    // Shifting the view window by (-x, -y) moves the picture by (+x, +y) pixels.
    cam.setViewOffset(size.width, size.height, -c.x, -c.y, size.width, size.height);
  });
  return null;
}

function Scene() {
  const view = useGame((s) => s.view);
  const viewLocation = useGame((s) => s.viewLocation);
  const selection = useGame((s) => s.selection);
  const move = useGame((s) => s.move);
  const select = useGame((s) => s.select);
  const updateMove = useGame((s) => s.updateMove);
  const act = useGame((s) => s.act);
  const lastCall = useRef(0);

  const objects = useMemo(() => (view ? view.objects.filter((o) => o.location === viewLocation) : []), [view, viewLocation]);

  const ghost = useMemo(() => {
    if (!move || !view) return null;
    const o = view.objects.find((x) => x.id === move.id);
    if (!o) return null;
    const cand: WorldObject = { id: o.id, type: o.type, location: o.location, x: move.x, z: move.z, rotation: move.rotation, movable: o.movable, state: o.state };
    const all: WorldObject[] = view.objects.map((x) => ({ id: x.id, type: x.type, location: x.location, x: x.x, z: x.z, rotation: x.rotation, movable: x.movable, state: x.state }));
    const check = validatePlacement(cand, all, { x: view.cat.x, z: view.cat.z });
    const def = OBJECT_DEFS[o.type]!;
    const quarter = Math.abs(Math.round(move.rotation / (Math.PI / 2))) % 2 === 1;
    return { check, w: quarter ? def.d : def.w, d: quarter ? def.w : def.d };
  }, [move, view]);

  useEffect(() => { useGame.getState().setMoveCheck(ghost?.check ?? null); }, [ghost]);

  if (!view) return null;
  const { hour } = view.household;

  const onFloor = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    audio.unlock();
    const p = e.point;
    if (move) {
      updateMove({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 });
      return;
    }
    if (selection) { select(null); return; }
    // Tap the floor to call her over. She'll decide whether she fancies it.
    const now = Date.now();
    if (now - lastCall.current < 2500) return;
    lastCall.current = now;
    void act({ type: 'call', x: p.x, z: p.z });
  };

  const b = LOCATIONS[viewLocation]!.bounds;
  return (
    <>
      <Atmosphere />
      <AutoFrame location={viewLocation} />
      {viewLocation === 'home' ? <HomeRoom hour={hour} /> : <GardenArea daylight={view.household.daylight} />}
      {/* invisible floor catches taps */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(b.minX + b.maxX) / 2, 0.005, (b.minZ + b.maxZ) / 2]} onClick={onFloor} visible={false}>
        <planeGeometry args={[b.maxX - b.minX + 8, b.maxZ - b.minZ + 8]} />
      </mesh>
      {objects.map((o) => (
        <Prop
          key={o.id}
          o={o}
          highlight={selection?.kind === 'object' && selection.id === o.id}
          onTap={(id) => {
            audio.unlock();
            if (move) { updateMove({ x: o.x, z: o.z }); return; }
            select({ kind: 'object', id });
          }}
        />
      ))}
      {ghost && move && <FootprintGhost w={ghost.w} d={ghost.d} ok={ghost.check.ok} x={move.x} z={move.z} rotation={move.rotation} />}
      <Cat />
      <CameraRig />
    </>
  );
}

function placeCamera(camera: THREE.Camera, target: THREE.Vector3) {
  const a = Math.PI / 4;
  camera.position.set(Math.sin(a) * CAM_DIST * Math.sin(POLAR), Math.cos(POLAR) * CAM_DIST + 0.6, Math.cos(a) * CAM_DIST * Math.sin(POLAR));
  camera.lookAt(target);
}

function CameraRig() {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as { update?: () => void } | null;
  const nonce = useGame((s) => s.cameraNonce);
  const target = useMemo(() => new THREE.Vector3(0, 0.6, 0), []);
  useEffect(() => {
    placeCamera(camera, target);
    controls?.update?.();
  }, [camera, target, controls, nonce]);
  return (
    <OrbitControls
      makeDefault enablePan={false} enableDamping dampingFactor={0.12}
      minPolarAngle={POLAR} maxPolarAngle={POLAR}
      minAzimuthAngle={Math.PI / 4 - 0.75} maxAzimuthAngle={Math.PI / 4 + 0.75}
      minZoom={22} maxZoom={150} zoomSpeed={0.8} rotateSpeed={0.6}
      target={target}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }}
    />
  );
}

/** Pauses rendering while the tab is hidden, and steps quality down (never below what is needed) if frames drop. */
export function GameCanvas() {
  const [visible, setVisible] = useState(true);
  const quality = useGame((s) => s.quality);
  const degrade = useGame((s) => s.degradeQuality);
  const upgrade = useGame((s) => s.upgradeQuality);
  const q = QUALITY[quality];
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return (
    <Canvas
      orthographic
      camera={{ position: [8, 9, 8], zoom: 50, near: 0.1, far: 80 }}
      dpr={Math.min(q.dpr, typeof window === 'undefined' ? 2 : window.devicePixelRatio || 1)}
      shadows={q.shadows ? 'soft' : false}
      frameloop={visible ? 'always' : 'never'}
      gl={{ antialias: q.antialias, powerPreference: 'high-performance' }}
      style={{ touchAction: 'none' }}
    >
      <PerformanceMonitor onDecline={degrade} onIncline={upgrade} flipflops={3} onFallback={() => useGame.getState().degradeQuality()} />
      <Scene />
    </Canvas>
  );
}
