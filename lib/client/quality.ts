/**
 * Render quality tiers. The tier is chosen once from device hints, can be overridden in Settings,
 * and drops a step automatically if the frame rate stays low (see GameCanvas).
 */

export type Quality = 'high' | 'medium' | 'low';
export type QualityChoice = Quality | 'auto';

export interface QualitySettings {
  shadows: boolean;
  shadowMap: number;
  dpr: number;
  /** Image-based lighting from a generated room environment. */
  envMap: boolean;
  /** Soft contact shadows under furniture (cheap ambient-occlusion approximation). */
  contactShadows: boolean;
  /** Dust motes, window light and other small extras. */
  ambience: boolean;
  antialias: boolean;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  high:   { shadows: true,  shadowMap: 2048, dpr: 2,    envMap: true,  contactShadows: true, ambience: true,  antialias: true },
  medium: { shadows: true,  shadowMap: 1024, dpr: 1.5,  envMap: true,  contactShadows: true, ambience: false, antialias: true },
  low:    { shadows: false, shadowMap: 512,  dpr: 1,    envMap: false, contactShadows: true, ambience: false, antialias: false },
};

export const NEXT_LOWER: Record<Quality, Quality> = { high: 'medium', medium: 'low', low: 'low' };
export const NEXT_HIGHER: Record<Quality, Quality> = { high: 'high', medium: 'high', low: 'medium' };

export interface DeviceHints {
  cores?: number;
  memoryGb?: number;
  mobile?: boolean;
  saveData?: boolean;
  width?: number;
}

/** Pure so it can be tested: pick a starting tier from what the browser tells us. */
export function pickQuality(h: DeviceHints): Quality {
  if (h.saveData) return 'low';
  const cores = h.cores ?? 4;
  const mem = h.memoryGb ?? 4;
  if (mem <= 2 || cores <= 2) return 'low';
  if (h.mobile) return mem >= 6 && cores >= 8 ? 'high' : 'medium';
  return cores >= 8 && mem >= 8 ? 'high' : 'medium';
}

export function detectQuality(): Quality {
  if (typeof navigator === 'undefined') return 'medium';
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return pickQuality({
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory,
    mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent),
    saveData: nav.connection?.saveData,
    width: typeof window !== 'undefined' ? window.innerWidth : undefined,
  });
}
