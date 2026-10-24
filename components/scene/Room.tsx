'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { LOCATIONS } from '@/lib/world/catalog';
import { mat, woodTexture } from './materials';

const WALL_H = 2.6;
const LOW_H = 0.35;

type Side = 'north' | 'south' | 'west' | 'east';

/**
 * Cutaway walls: whichever walls face the camera shrink to a low plinth so the cat is never hidden,
 * and the far walls stay tall. Updated live, so rotating the camera just works.
 */
function CutawayWall({ side, length, pos, rot, color, children }: { side: Side; length: number; pos: [number, number, number]; rot: number; color: string; children?: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const cur = useRef(1);
  const { camera } = useThree();
  // outward normal of each wall
  const n = useMemo(() => ({ north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[side]), [side]);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const facing = camera.position.x * n[0]! + camera.position.z * n[1]! > 0;
    const target = facing ? LOW_H / WALL_H : 1;
    cur.current += (target - cur.current) * (1 - Math.exp(-9 * dt));
    g.scale.y = cur.current;
  });
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <group ref={ref}>
        <mesh position={[0, WALL_H / 2, 0]} material={mat(color, { rough: 1 })} receiveShadow castShadow>
          <boxGeometry args={[length, WALL_H, 0.16]} />
        </mesh>
        {children}
      </group>
      {/* skirting board stays put even when the wall drops */}
      <mesh position={[0, 0.07, 0.09]} material={mat('#efe6d6')}>
        <boxGeometry args={[length, 0.14, 0.03]} />
      </mesh>
    </group>
  );
}

export function SkyWindow({ x, daylight, hour }: { x: number; daylight: number; hour: number }) {
  const sky = useMemo(() => {
    const night = new THREE.Color('#1d2742');
    const dawn = new THREE.Color('#f2b78a');
    const day = new THREE.Color('#a9d8f5');
    const c = night.clone();
    const warm = Math.max(0, 1 - Math.abs(hour - 6.5) / 1.5, 1 - Math.abs(hour - 18.5) / 1.5);
    c.lerp(day, daylight);
    c.lerp(dawn, warm * 0.7);
    return c;
  }, [daylight, hour]);
  return (
    <group position={[x, 1.5, 0.09]}>
      <mesh><planeGeometry args={[1.7, 1.3]} /><meshBasicMaterial color={sky} /></mesh>
      <mesh position={[0, 0, 0.01]}><boxGeometry args={[1.8, 0.07, 0.05]} /><meshStandardMaterial color="#f4ecdd" /></mesh>
      <mesh position={[0, 0.66, 0.01]}><boxGeometry args={[1.8, 0.07, 0.05]} /><meshStandardMaterial color="#f4ecdd" /></mesh>
      <mesh position={[0, -0.66, 0.01]}><boxGeometry args={[1.8, 0.07, 0.05]} /><meshStandardMaterial color="#f4ecdd" /></mesh>
      <mesh position={[0.88, 0, 0.01]}><boxGeometry args={[0.07, 1.4, 0.05]} /><meshStandardMaterial color="#f4ecdd" /></mesh>
      <mesh position={[-0.88, 0, 0.01]}><boxGeometry args={[0.07, 1.4, 0.05]} /><meshStandardMaterial color="#f4ecdd" /></mesh>
      <mesh position={[0, 0, 0.012]}><boxGeometry args={[0.05, 1.3, 0.04]} /><meshStandardMaterial color="#f4ecdd" /></mesh>
    </group>
  );
}

export function HomeRoom({ daylight, hour }: { daylight: number; hour: number }) {
  const b = LOCATIONS.home!.bounds;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const tex = useMemo(() => woodTexture(), []);
  const wall = LOCATIONS.home!.walls[0]!;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      {/* rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.3, 0.012, -0.2]} receiveShadow>
        <planeGeometry args={[4.4, 3.2]} />
        <meshStandardMaterial color="#c98f7a" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.3, 0.014, -0.2]}>
        <planeGeometry args={[3.9, 2.7]} />
        <meshStandardMaterial color="#e6c7a8" roughness={1} />
      </mesh>
      <CutawayWall side="north" length={w + 0.3} pos={[cx, 0, b.minZ - 0.08]} rot={0} color="#e9dcc6">
        <SkyWindow x={-1.7 - cx} daylight={daylight} hour={hour} />
      </CutawayWall>
      <CutawayWall side="south" length={w + 0.3} pos={[cx, 0, b.maxZ + 0.08]} rot={Math.PI} color="#e9dcc6" />
      <CutawayWall side="west" length={d + 0.3} pos={[b.minX - 0.08, 0, cz]} rot={Math.PI / 2} color="#e2d2b9" />
      <CutawayWall side="east" length={d + 0.3} pos={[b.maxX + 0.08, 0, cz]} rot={-Math.PI / 2} color="#e2d2b9" />
      {/* the half-wall that makes a quiet litter nook */}
      <mesh position={[(wall.minX + wall.maxX) / 2, 0.55, (wall.minZ + wall.maxZ) / 2]} material={mat('#d9c9ae', { rough: 1 })} castShadow receiveShadow>
        <boxGeometry args={[wall.maxX - wall.minX, 1.1, wall.maxZ - wall.minZ]} />
      </mesh>
    </group>
  );
}

export function GardenArea({ daylight }: { daylight: number }) {
  const b = LOCATIONS.garden!.bounds;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const grass = useMemo(() => new THREE.Color('#79b45a').multiplyScalar(0.35 + 0.65 * daylight), [daylight]);
  const flowers = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    x: ((i * 37) % 70) / 10 - 3.5, z: ((i * 53) % 46) / 10 - 2.3, c: ['#f4c2d7', '#fff1a8', '#d9c3f5', '#ffffff'][i % 4]!,
  })), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[w + 6, d + 6]} />
        <meshStandardMaterial color={grass} roughness={1} />
      </mesh>
      {/* stepping stones from the door */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0.1 * (i % 2), 0.015, 2.0 - i * 0.7]}>
          <circleGeometry args={[0.3, 10]} />
          <meshStandardMaterial color="#b9b2a6" roughness={1} />
        </mesh>
      ))}
      {flowers.map((f, i) => (
        <mesh key={i} position={[f.x, 0.08, f.z]} material={mat(f.c)}>
          <sphereGeometry args={[0.05, 6, 6]} />
        </mesh>
      ))}
      {/* fence */}
      {[-1, 1].map((s) => (
        <mesh key={`fz${s}`} position={[0, 0.45, s * (d / 2 + 0.1)]} material={mat('#b58a5a')} castShadow>
          <boxGeometry args={[w + 0.4, 0.9, 0.1]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`fx${s}`} position={[s * (w / 2 + 0.1), 0.45, 0]} material={mat('#b58a5a')} castShadow>
          <boxGeometry args={[0.1, 0.9, d + 0.4]} />
        </mesh>
      ))}
      {/* trees beyond the fence */}
      {[[-4.8, -3.6], [5, -3.2], [-5, 3.6]].map(([x, z], i) => (
        <group key={i} position={[x!, 0, z!]}>
          <mesh position={[0, 0.9, 0]} material={mat('#7a5738')} castShadow><cylinderGeometry args={[0.18, 0.26, 1.8, 8]} /></mesh>
          <mesh position={[0, 2.4, 0]} material={mat('#5f9a58')} castShadow><sphereGeometry args={[1.0, 10, 8]} /></mesh>
          <mesh position={[0.5, 2.0, 0.3]} material={mat('#6aa862')} castShadow><sphereGeometry args={[0.7, 10, 8]} /></mesh>
        </group>
      ))}
    </group>
  );
}

export function Lighting({ daylight, hour, shadows }: { daylight: number; hour: number; shadows: boolean }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();
  const warm = Math.max(0, 1 - Math.abs(hour - 7) / 2, 1 - Math.abs(hour - 18) / 2);
  const sunColor = useMemo(() => new THREE.Color('#fff4dd').lerp(new THREE.Color('#ffb877'), warm * 0.8), [warm]);
  const skyTop = useMemo(() => new THREE.Color('#1f2a4a').lerp(new THREE.Color('#bfe3ff'), daylight), [daylight]);
  const ground = useMemo(() => new THREE.Color('#2a2530').lerp(new THREE.Color('#d9c6a5'), daylight), [daylight]);
  useEffect(() => {
    scene.background = new THREE.Color('#1a1f33').lerp(new THREE.Color('#f3eadb'), 0.25 + 0.75 * daylight);
  }, [scene, daylight]);
  // The sun swings across the sky over the day.
  const a = Math.max(0, Math.min(1, (hour - 6) / 12));
  const sx = Math.cos(Math.PI * (1 - a)) * 9;
  const sy = 4 + Math.sin(Math.PI * a) * 8;
  return (
    <>
      <hemisphereLight args={[skyTop, ground, 0.35 + 0.65 * daylight]} />
      <directionalLight
        ref={sun} color={sunColor} intensity={0.12 + 1.5 * daylight} position={[sx, sy, 5]}
        castShadow={shadows} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004}
        shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9} shadow-camera-near={1} shadow-camera-far={40}
      />
      {/* a warm lamp keeps the room cosy after dark */}
      <pointLight position={[-2.5, 1.8, -1]} color="#ffcf8a" intensity={(1 - daylight) * 9} distance={11} decay={1.6} />
      <pointLight position={[2.2, 1.6, 1.5]} color="#ffd9a8" intensity={(1 - daylight) * 4} distance={9} decay={1.6} />
    </>
  );
}
