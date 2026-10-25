import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const cache = new Map<string, THREE.MeshStandardMaterial>();
const CREAM = new THREE.Color('#FFF7EF');

/** One gentle pastel grade for every prop colour, so the whole room sits in the same soft palette. */
export function pastel(color: string, amount = 0.2): THREE.Color {
  return new THREE.Color(color).lerp(CREAM, amount);
}

const boxCache = new Map<string, RoundedBoxGeometry>();
/** Softly bevelled box, shared by size so a whole room costs only a handful of geometries. */
export function roundedBox(w: number, h: number, d: number): RoundedBoxGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  let g = boxCache.get(key);
  if (!g) {
    const r = Math.min(0.045, Math.min(w, h, d) * 0.3);
    g = new RoundedBoxGeometry(w, h, d, 2, r);
    boxCache.set(key, g);
  }
  return g;
}

/** Materials are shared across the whole scene to keep draw calls and memory low on phones. */
export function mat(color: string, opts: { rough?: number; metal?: number; emissive?: string; emissiveIntensity?: number; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.rough ?? 0.85}|${opts.metal ?? 0}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? 0}|${opts.opacity ?? 1}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: pastel(color), roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : undefined,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1,
    });
    cache.set(key, m);
  }
  return m;
}

export { COATS } from '@/lib/world/coats';

let woodTex: THREE.CanvasTexture | null = null;
/** Procedural plank floor: no image download, tiny memory. */
export function woodTexture(): THREE.CanvasTexture {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  const tones = ['#e3bf94', '#dcb68a', '#e8c79f', '#d7ae82'];
  for (let i = 0; i < 4; i++) {
    g.fillStyle = tones[i]!;
    g.fillRect(0, i * 64, 256, 64);
    g.fillStyle = 'rgba(107,81,72,0.22)';
    g.fillRect(0, i * 64, 256, 2);
    for (let k = 0; k < 9; k++) {
      g.fillStyle = `rgba(90,58,30,${0.04 + (k % 3) * 0.02})`;
      g.fillRect(((k * 53 + i * 31) % 240), i * 64 + 6 + ((k * 7) % 50), 18 + (k % 4) * 10, 1.5);
    }
    g.fillStyle = 'rgba(80,50,25,0.3)';
    g.fillRect((i * 97) % 256, i * 64, 2, 64);
  }
  woodTex = new THREE.CanvasTexture(c);
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.repeat.set(5, 4);
  woodTex.colorSpace = THREE.SRGBColorSpace;
  woodTex.anisotropy = 2;
  return woodTex;
}

let blob: THREE.CanvasTexture | null = null;
/** Soft contact shadow, used instead of real shadows on low-end devices. */
export function blobTexture(): THREE.CanvasTexture {
  if (blob) return blob;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  blob = new THREE.CanvasTexture(c);
  return blob;
}

let rugTex: THREE.CanvasTexture | null = null;
/** A soft woven rug with a scalloped border, drawn once. */
export function rugTexture(): THREE.CanvasTexture {
  if (rugTex) return rugTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = '#FF9994'; g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#FFD9D0'; g.fillRect(10, 10, 236, 172);
  g.fillStyle = '#FFF7EF'; g.fillRect(22, 22, 212, 148);
  g.strokeStyle = 'rgba(255,153,148,0.55)'; g.lineWidth = 3;
  for (let x = 40; x < 230; x += 26) { g.beginPath(); g.arc(x, 96, 11, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = 'rgba(184,210,174,0.8)';
  for (let x = 27; x < 230; x += 26) { g.beginPath(); g.arc(x, 40, 4, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x, 152, 4, 0, Math.PI * 2); g.fill(); }
  rugTex = new THREE.CanvasTexture(c);
  rugTex.colorSpace = THREE.SRGBColorSpace;
  rugTex.anisotropy = 2;
  return rugTex;
}

let wallTex: THREE.CanvasTexture | null = null;
/** Faint plaster mottling so large walls are not flat colour. */
export function plasterTexture(): THREE.CanvasTexture {
  if (wallTex) return wallTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(107,81,72,${0.012 + rnd() * 0.022})`;
    g.beginPath(); g.arc(rnd() * 128, rnd() * 128, 2 + rnd() * 7, 0, Math.PI * 2); g.fill();
  }
  wallTex = new THREE.CanvasTexture(c);
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(3, 2);
  wallTex.colorSpace = THREE.SRGBColorSpace;
  return wallTex;
}
