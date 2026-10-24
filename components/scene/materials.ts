import * as THREE from 'three';

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Materials are shared across the whole scene to keep draw calls and memory low on phones. */
export function mat(color: string, opts: { rough?: number; metal?: number; emissive?: string; emissiveIntensity?: number; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.rough ?? 0.85}|${opts.metal ?? 0}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? 0}|${opts.opacity ?? 1}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : undefined,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1,
    });
    cache.set(key, m);
  }
  return m;
}

export const COATS = [
  { base: '#d98c3f', accent: '#f3e1c4', dark: '#a86222' }, // orange tabby
  { base: '#8f929a', accent: '#e6e6ea', dark: '#6b6e76' }, // grey
  { base: '#2e2d33', accent: '#4a4850', dark: '#1b1a1f' }, // black
  { base: '#e6d2ae', accent: '#fbf3e3', dark: '#c9b088' }, // cream
  { base: '#8b5b3b', accent: '#e9d7bd', dark: '#5f3a22' }, // brown tabby
  { base: '#eeeae2', accent: '#ffffff', dark: '#cfc9bd' }, // white
];

let woodTex: THREE.CanvasTexture | null = null;
/** Procedural plank floor: no image download, tiny memory. */
export function woodTexture(): THREE.CanvasTexture {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  const tones = ['#c79a68', '#bf9160', '#cfa473', '#b98a5a'];
  for (let i = 0; i < 4; i++) {
    g.fillStyle = tones[i]!;
    g.fillRect(0, i * 64, 256, 64);
    g.fillStyle = 'rgba(80,50,25,0.35)';
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
