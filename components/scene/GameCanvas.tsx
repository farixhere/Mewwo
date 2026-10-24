'use client';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useGame } from '@/lib/client/store';
import { LOCATIONS, OBJECT_DEFS } from '@/lib/world/catalog';
import { validatePlacement } from '@/lib/world/nav';
import type { WorldObject } from '@/lib/sim/types';
import { Cat } from './CatModel';
import { FootprintGhost, Prop } from './Props';
import { GardenArea, HomeRoom, Lighting } from './Room';
import { audio } from '@/lib/client/audio';

const CAM_DIST = 12;
const POLAR = 0.95; // fixed tilt: a three-quarter overhead view

/** Fits the whole room on screen in portrait or landscape until the player zooms themselves. */
function AutoFrame({ location }: { location: string }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const b = LOCATIONS[location]!.bounds;
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    const span = (w + d) * 0.72; // iso footprint width
    const spanY = (w + d) * 0.42 + 2.8;
    const z = Math.min(size.width / span, size.height / spanY);
    (camera as THREE.OrthographicCamera).zoom = Math.max(24, Math.min(110, z));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, location]);
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
  const [shadows, setShadows] = useState(true);
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
  const { daylight, hour } = view.household;

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
      <PerformanceMonitor onDecline={() => setShadows(false)} onIncline={() => setShadows(true)} />
      <Lighting daylight={daylight} hour={hour} shadows={shadows} />
      <AutoFrame location={viewLocation} />
      {viewLocation === 'home' ? <HomeRoom daylight={daylight} hour={hour} /> : <GardenArea daylight={daylight} />}
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

function CameraRig() {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(0, 0.6, 0), []);
  useEffect(() => {
    const a = Math.PI / 4;
    camera.position.set(Math.sin(a) * CAM_DIST * Math.sin(POLAR), Math.cos(POLAR) * CAM_DIST + 0.6, Math.cos(a) * CAM_DIST * Math.sin(POLAR));
    camera.lookAt(target);
  }, [camera, target]);
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

/** Keeps rendering paused while the tab is hidden, and drops resolution on weak devices. */
export function GameCanvas() {
  const [visible, setVisible] = useState(true);
  const [dpr, setDpr] = useState(1.5);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return (
    <Canvas
      orthographic
      camera={{ position: [8, 9, 8], zoom: 50, near: 0.1, far: 80 }}
      dpr={dpr}
      shadows="soft"
      frameloop={visible ? 'always' : 'never'}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ touchAction: 'none' }}
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} flipflops={3} onFallback={() => setDpr(0.85)} />
      <Scene />
    </Canvas>
  );
}

