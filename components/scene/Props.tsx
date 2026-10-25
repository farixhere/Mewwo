'use client';
import { OBJECT_DEFS } from '@/lib/world/catalog';
import type { GameView } from '@/lib/server/game';
import type { ThreeEvent } from '@react-three/fiber';
import { useGame } from '@/lib/client/store';
import { QUALITY } from '@/lib/client/quality';
import { blobTexture, mat, roundedBox } from './materials';

export type ViewObject = GameView['objects'][number];

const wood = '#a8754a';
const woodDark = '#7e5636';
const fabric = '#7f9e8f';
const cream = '#efe3cf';

const Box = ({ s, p = [0, 0, 0], c, r = 0.8 }: { s: [number, number, number]; p?: [number, number, number]; c: string; r?: number }) => (
  <mesh position={p} material={mat(c, { rough: r })} castShadow receiveShadow>
    <primitive object={roundedBox(s[0], s[1], s[2])} attach="geometry" />
  </mesh>
);
const Cyl = ({ r, h, p = [0, 0, 0], c, seg = 16, r2 }: { r: number; h: number; p?: [number, number, number]; c: string; seg?: number; r2?: number }) => (
  <mesh position={p} material={mat(c)} castShadow receiveShadow>
    <cylinderGeometry args={[r2 ?? r, r, h, seg]} />
  </mesh>
);

/** Renders any placed object. New object types plug in here and in world/catalog.ts. */
export function Prop({ o, onTap, highlight }: { o: ViewObject; onTap?: (id: string) => void; highlight?: boolean }) {
  const handler = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    onTap?.(o.id);
  };
  const amount = Number(o.state.amount ?? 0);
  const contact = QUALITY[useGame((s) => s.quality)].contactShadows;
  const def = OBJECT_DEFS[o.type]!;
  // Furniture that sits on the floor gets a soft contact shadow: a cheap stand-in for ambient occlusion.
  const grounded = !['garden_door', 'home_door', 'grass_patch', 'window_perch'].includes(o.type);
  return (
    <group position={[o.x, 0, o.z]} rotation={[0, o.rotation, 0]} onClick={handler}>
      {contact && grounded && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 0]} renderOrder={1}>
          <planeGeometry args={[def.w * 1.45 + 0.2, def.d * 1.45 + 0.2]} />
          <meshBasicMaterial map={blobTexture()} transparent opacity={def.blocks ? 0.55 : 0.4} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {highlight && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[Math.max(OBJECT_DEFS[o.type]!.w, OBJECT_DEFS[o.type]!.d) * 0.62, Math.max(OBJECT_DEFS[o.type]!.w, OBJECT_DEFS[o.type]!.d) * 0.7, 32]} />
          <meshBasicMaterial color="#ffd89a" transparent opacity={0.9} />
        </mesh>
      )}
      {body(o.type, amount)}
    </group>
  );
}

function body(type: string, amount: number) {
  switch (type) {
    case 'food_bowl':
      return (
        <group>
          <Cyl r={0.2} r2={0.15} h={0.1} p={[0, 0.05, 0]} c="#d86d55" />
          <Cyl r={0.17} h={0.02} p={[0, 0.04 + 0.07 * Math.min(1, amount), 0]} c="#9a6a3c" seg={10} />
          <Cyl r={0.2} h={0.012} p={[0, 0.006, 0]} c="#c9b9a2" />
        </group>
      );
    case 'water_bowl':
      return (
        <group>
          <Cyl r={0.2} r2={0.15} h={0.1} p={[0, 0.05, 0]} c="#6f9cb8" />
          <mesh position={[0, 0.03 + 0.065 * Math.min(1, amount), 0]} rotation={[-Math.PI / 2, 0, 0]} material={mat('#9fd1ee', { rough: 0.1, opacity: 0.85 })}>
            <circleGeometry args={[0.165, 20]} />
          </mesh>
        </group>
      );
    case 'cat_bed':
      return (
        <group>
          <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat('#b97a6a')} castShadow>
            <torusGeometry args={[0.36, 0.11, 10, 24]} />
          </mesh>
          <Cyl r={0.36} h={0.09} p={[0, 0.06, 0]} c="#e8cdb8" seg={24} />
        </group>
      );
    case 'cushion':
      return <Box s={[0.62, 0.12, 0.62]} p={[0, 0.06, 0]} c="#e0b25f" r={0.95} />;
    case 'litter_tray':
      return (
        <group>
          <Box s={[0.76, 0.16, 0.56]} p={[0, 0.08, 0]} c="#8fa3b5" />
          <Box s={[0.68, 0.02, 0.48]} p={[0, 0.15, 0]} c="#e7dcc1" r={1} />
        </group>
      );
    case 'scratching_post':
      return (
        <group>
          <Box s={[0.5, 0.05, 0.5]} p={[0, 0.025, 0]} c={woodDark} />
          <Cyl r={0.09} h={0.9} p={[0, 0.5, 0]} c="#c9a36b" seg={10} />
          <Cyl r={0.15} h={0.04} p={[0, 0.96, 0]} c={woodDark} seg={12} />
        </group>
      );
    case 'cat_tree':
      return (
        <group>
          <Box s={[0.9, 0.08, 0.9]} p={[0, 0.04, 0]} c={woodDark} />
          <Cyl r={0.08} h={0.6} p={[0, 0.38, 0]} c="#c9a36b" seg={10} />
          <Box s={[0.7, 0.08, 0.7]} p={[0, 0.7, 0]} c="#e8d4b4" />
          <Cyl r={0.08} h={0.6} p={[0.1, 1.05, 0.05]} c="#c9a36b" seg={10} />
          <Box s={[0.55, 0.08, 0.55]} p={[0.1, 1.38, 0.05]} c="#e8d4b4" />
          <mesh position={[-0.18, 0.28, 0.1]} material={mat('#7a6a5a')}><boxGeometry args={[0.32, 0.4, 0.32]} /></mesh>
        </group>
      );
    case 'window_perch':
      return (
        <group>
          <Box s={[0.9, 0.06, 0.5]} p={[0, 0.72, 0]} c={wood} />
          <Box s={[0.84, 0.05, 0.44]} p={[0, 0.77, 0]} c="#c47a6a" r={1} />
          <Box s={[0.06, 0.7, 0.4]} p={[-0.4, 0.35, 0]} c={woodDark} />
          <Box s={[0.06, 0.7, 0.4]} p={[0.4, 0.35, 0]} c={woodDark} />
        </group>
      );
    case 'sofa':
      return (
        <group>
          <Box s={[3.0, 0.4, 1.2]} p={[0, 0.2, 0]} c={fabric} r={0.95} />
          <Box s={[3.0, 0.55, 0.3]} p={[0, 0.65, -0.45]} c="#6e8c7d" r={0.95} />
          <Box s={[0.3, 0.3, 1.2]} p={[-1.35, 0.5, 0]} c="#6e8c7d" r={0.95} />
          <Box s={[0.3, 0.3, 1.2]} p={[1.35, 0.5, 0]} c="#6e8c7d" r={0.95} />
          <Box s={[0.5, 0.4, 0.15]} p={[-0.8, 0.6, -0.1]} c="#e3b37a" r={1} />
        </group>
      );
    case 'coffee_table':
      return (
        <group>
          <Box s={[1.5, 0.08, 0.9]} p={[0, 0.4, 0]} c={wood} />
          {([[-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35]] as const).map(([x, z], i) => <Box key={i} s={[0.07, 0.36, 0.07]} p={[x, 0.18, z]} c={woodDark} />)}
          <Cyl r={0.09} h={0.1} p={[0.3, 0.49, 0.1]} c="#f2f0ea" seg={12} />
        </group>
      );
    case 'cardboard_box':
      return (
        <group>
          <Box s={[0.8, 0.04, 0.8]} p={[0, 0.02, 0]} c="#b58a5a" />
          <Box s={[0.8, 0.4, 0.04]} p={[0, 0.2, 0.38]} c="#c49a68" />
          <Box s={[0.8, 0.4, 0.04]} p={[0, 0.2, -0.38]} c="#c49a68" />
          <Box s={[0.04, 0.4, 0.8]} p={[0.38, 0.2, 0]} c="#bb9160" />
          <Box s={[0.04, 0.4, 0.8]} p={[-0.38, 0.2, 0]} c="#bb9160" />
        </group>
      );
    case 'plant':
      return (
        <group>
          <Cyl r={0.2} r2={0.14} h={0.3} p={[0, 0.15, 0]} c="#c9785a" />
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} position={[Math.sin(i * 1.3) * 0.12, 0.5 + (i % 3) * 0.1, Math.cos(i * 1.3) * 0.12]} rotation={[0.3 * Math.cos(i), i, 0.4 * Math.sin(i)]} material={mat(i % 2 ? '#5f9a5c' : '#6fae68')} castShadow>
              <sphereGeometry args={[0.16, 8, 6]} />
            </mesh>
          ))}
        </group>
      );
    case 'toy_mouse':
      return (
        <group>
          <mesh position={[0, 0.07, 0]} scale={[1, 0.8, 1.5]} material={mat('#b8aeb5')}><sphereGeometry args={[0.07, 10, 8]} /></mesh>
          <mesh position={[0.045, 0.1, 0.07]} material={mat('#e8a0a8')}><sphereGeometry args={[0.025, 6, 6]} /></mesh>
          <mesh position={[0, 0.04, -0.15]} rotation={[Math.PI / 2, 0, 0.4]} material={mat('#e8a0a8')}><cylinderGeometry args={[0.008, 0.008, 0.16, 5]} /></mesh>
        </group>
      );
    case 'toy_ball':
      return (
        <mesh position={[0, 0.09, 0]} material={mat('#d4513f', { rough: 0.5 })} castShadow>
          <sphereGeometry args={[0.09, 12, 10]} />
        </mesh>
      );
    case 'garden_door':
      return (
        <group>
          <Box s={[0.1, 1.9, 1.1]} p={[0, 0.95, 0]} c="#6b4a35" />
          <Box s={[0.04, 1.7, 0.9]} p={[0.04, 0.95, 0]} c="#a6c7d8" r={0.2} />
          <Box s={[0.1, 0.35, 0.5]} p={[0.05, 0.05, 0]} c="#7e5636" />
        </group>
      );
    case 'home_door':
      return (
        <group>
          <Box s={[1.1, 1.9, 0.1]} p={[0, 0.95, 0.35]} c="#8a5a3c" />
          <Box s={[0.9, 1.7, 0.04]} p={[0, 0.95, 0.3]} c="#a6c7d8" r={0.2} />
        </group>
      );
    case 'bush':
      return (
        <group>
          {[[0, 0, 0, 0.6], [0.5, 0, 0.1, 0.45], [-0.5, 0, -0.1, 0.5], [0.1, 0.25, 0, 0.45]].map(([x, y, z, r], i) => (
            <mesh key={i} position={[x!, 0.4 + y!, z!]} material={mat(i % 2 ? '#4f8a4d' : '#5c9b58')} castShadow>
              <sphereGeometry args={[r!, 10, 8]} />
            </mesh>
          ))}
        </group>
      );
    case 'bird_feeder':
      return (
        <group>
          <Cyl r={0.03} h={1.2} p={[0, 0.6, 0]} c={woodDark} seg={6} />
          <Box s={[0.5, 0.06, 0.4]} p={[0, 1.2, 0]} c={wood} />
          <mesh position={[0, 1.4, 0]} material={mat('#b86b4b')}><coneGeometry args={[0.38, 0.25, 4]} /></mesh>
        </group>
      );
    case 'grass_patch':
      return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} material={mat('#9ccc72', { rough: 1 })}>
          <circleGeometry args={[0.85, 20]} />
        </mesh>
      );
    default:
      return <Box s={[0.4, 0.4, 0.4]} p={[0, 0.2, 0]} c={cream} />;
  }
}

export function FootprintGhost({ w, d, ok, x, z, rotation }: { w: number; d: number; ok: boolean; x: number; z: number; rotation: number }) {
  return (
    <group position={[x, 0.03, z]} rotation={[0, rotation, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={ok ? '#7fd69a' : '#e57a6b'} transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[w * 0.98, 0.5, d * 0.98]} />
        <meshBasicMaterial color={ok ? '#7fd69a' : '#e57a6b'} transparent opacity={0.22} depthWrite={false} />
      </mesh>
    </group>
  );
}

