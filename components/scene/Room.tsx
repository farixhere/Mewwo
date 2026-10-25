'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { LOCATIONS } from '@/lib/world/catalog';
import { atmosphereAt } from '@/lib/world/atmosphere';
import { blobTexture, mat, plasterTexture, rugTexture, woodTexture } from './materials';

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
  const plaster = useMemo(() => plasterTexture(), []);
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
        <mesh position={[0, WALL_H / 2, 0]} receiveShadow castShadow>
          <boxGeometry args={[length, WALL_H, 0.16]} />
          <meshStandardMaterial color={color} map={plaster} roughness={1} />
        </mesh>
        {/* soft darkening where the wall meets the floor: cheap ambient occlusion */}
        <mesh position={[0, 0.35, 0.085]}>
          <planeGeometry args={[length, 0.7]} />
          <meshBasicMaterial color="#6B5148" transparent opacity={0.07} depthWrite={false} />
        </mesh>
        {children}
      </group>
      {/* skirting board stays put even when the wall drops */}
      <mesh position={[0, 0.08, 0.1]} material={mat('#FFF7EF', { rough: 0.7 })} receiveShadow>
        <boxGeometry args={[length, 0.16, 0.04]} />
      </mesh>
    </group>
  );
}

export function SkyWindow({ x, hour }: { x: number; hour: number }) {
  const at = useMemo(() => atmosphereAt(hour), [hour]);
  const sky = useMemo(() => {
    const c = new THREE.Color().setRGB(at.skyHorizon[0], at.skyHorizon[1], at.skyHorizon[2], THREE.SRGBColorSpace);
    const top = new THREE.Color().setRGB(at.skyTop[0], at.skyTop[1], at.skyTop[2], THREE.SRGBColorSpace);
    return c.lerp(top, 0.5);
  }, [at]);
  const frame = mat('#FFF7EF', { rough: 0.6 });
  return (
    <group position={[x, 1.5, 0.09]}>
      <mesh><planeGeometry args={[1.7, 1.3]} /><meshBasicMaterial color={sky} toneMapped={false} /></mesh>
      {/* sun / moon disc */}
      <mesh position={[0.35, 0.28, 0.004]}>
        <circleGeometry args={[0.13, 20]} />
        <meshBasicMaterial color={at.sunIntensity > 0.6 ? '#FFF1C8' : '#E8ECFF'} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.01]} material={frame}><boxGeometry args={[1.8, 0.07, 0.06]} /></mesh>
      <mesh position={[0, 0.66, 0.01]} material={frame}><boxGeometry args={[1.8, 0.07, 0.06]} /></mesh>
      <mesh position={[0, -0.66, 0.01]} material={frame}><boxGeometry args={[1.8, 0.07, 0.06]} /></mesh>
      <mesh position={[0.88, 0, 0.01]} material={frame}><boxGeometry args={[0.07, 1.4, 0.06]} /></mesh>
      <mesh position={[-0.88, 0, 0.01]} material={frame}><boxGeometry args={[0.07, 1.4, 0.06]} /></mesh>
      <mesh position={[0, 0, 0.012]} material={frame}><boxGeometry args={[0.05, 1.3, 0.05]} /></mesh>
      {/* a pair of soft curtains */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.98, -0.05, 0.05]} material={mat('#FFD9D0')} castShadow>
          <boxGeometry args={[0.22, 1.55, 0.08]} />
        </mesh>
      ))}
    </group>
  );
}

export function HomeRoom({ hour }: { hour: number }) {
  const b = LOCATIONS.home!.bounds;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const tex = useMemo(() => woodTexture(), []);
  const rug = useMemo(() => rugTexture(), []);
  const blob = useMemo(() => blobTexture(), []);
  const at = useMemo(() => atmosphereAt(hour), [hour]);
  const patch = Math.max(0, Math.min(0.5, (at.sunIntensity - 0.5) * 0.3)) * at.windowGlow;
  const wall = LOCATIONS.home!.walls[0]!;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={tex} roughness={0.78} />
      </mesh>
      {/* rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.3, 0.012, -0.2]} receiveShadow>
        <planeGeometry args={[4.4, 3.3]} />
        <meshStandardMaterial map={rug} roughness={1} />
      </mesh>
      {/* sunlight falling through the window */}
      {patch > 0.01 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1.2, 0.02, b.minZ + 1.9]} scale={[1.7, 2.3, 1]} renderOrder={2}>
          <planeGeometry args={[1.6, 1.6]} />
          <meshBasicMaterial map={blob} color="#FFE9B8" transparent opacity={patch * 1.4} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      <CutawayWall side="north" length={w + 0.3} pos={[cx, 0, b.minZ - 0.08]} rot={0} color="#FBE3D6">
        <SkyWindow x={-1.7 - cx} hour={hour} />
      </CutawayWall>
      <CutawayWall side="south" length={w + 0.3} pos={[cx, 0, b.maxZ + 0.08]} rot={Math.PI} color="#FBE3D6" />
      <CutawayWall side="west" length={d + 0.3} pos={[b.minX - 0.08, 0, cz]} rot={Math.PI / 2} color="#F6D8C9" />
      <CutawayWall side="east" length={d + 0.3} pos={[b.maxX + 0.08, 0, cz]} rot={-Math.PI / 2} color="#F6D8C9" />
      {/* the half-wall that makes a quiet litter nook */}
      <mesh position={[(wall.minX + wall.maxX) / 2, 0.55, (wall.minZ + wall.maxZ) / 2]} material={mat('#F3D9C6', { rough: 1 })} castShadow receiveShadow>
        <boxGeometry args={[wall.maxX - wall.minX, 1.1, wall.maxZ - wall.minZ]} />
      </mesh>
    </group>
  );
}

export function GardenArea({ daylight }: { daylight: number }) {
  const b = LOCATIONS.garden!.bounds;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const grass = useMemo(() => new THREE.Color('#B8D2AE').multiplyScalar(0.55 + 0.45 * daylight), [daylight]);
  const flowers = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    x: ((i * 37) % 70) / 10 - 3.5, z: ((i * 53) % 46) / 10 - 2.3, c: ['#FFB7C5', '#FFF1A8', '#D9C3F5', '#FFFFFF'][i % 4]!,
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
