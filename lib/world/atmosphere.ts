/**
 * Day/night atmosphere as a pure function of the household's local hour (0..24, fractional).
 * The renderer eases toward these values every frame, so dawn, noon, dusk and night blend continuously
 * and stay in step with the same clock the simulation uses.
 */

export type RGB = [number, number, number]; // sRGB, 0..1

export interface Atmosphere {
  skyTop: RGB;
  skyHorizon: RGB;
  sunColor: RGB;
  sunIntensity: number;
  /** Hemisphere (sky fill) colour and strength. */
  fillSky: RGB;
  fillGround: RGB;
  fillIntensity: number;
  /** Image-based light strength (soft bounce from the room environment). */
  envIntensity: number;
  exposure: number;
  /** 0..1: how much the indoor lamps are on. */
  lamp: number;
  /** 0..1: how strongly the window glows. */
  windowGlow: number;
}

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];

interface Key {
  h: number;
  top: string; hor: string; sun: string; sunI: number;
  fillSky: string; fillGround: string; fillI: number;
  env: number; exp: number; lamp: number; glow: number;
}

// Pastel throughout: even midnight is a dusky periwinkle rather than black.
const KEYS: Key[] = [
  { h: 0,    top: '#2b3560', hor: '#46548a', sun: '#aebcff', sunI: 0.22, fillSky: '#6f7fc0', fillGround: '#4a4466', fillI: 0.55, env: 0.22, exp: 0.95, lamp: 1,    glow: 0.15 },
  { h: 5,    top: '#323d6a', hor: '#5a5f94', sun: '#b3b8ff', sunI: 0.2,  fillSky: '#7585c4', fillGround: '#4f4a6c', fillI: 0.55, env: 0.24, exp: 0.95, lamp: 1,    glow: 0.15 },
  { h: 6.3,  top: '#9db6e6', hor: '#ffbfa3', sun: '#ffb98a', sunI: 0.9,  fillSky: '#c4d3f0', fillGround: '#e0b8a0', fillI: 0.7,  env: 0.55, exp: 1.0,  lamp: 0.55, glow: 0.8 },
  { h: 8.5,  top: '#b3d8f2', hor: '#fff0dc', sun: '#ffeed6', sunI: 1.6,  fillSky: '#d7ecfb', fillGround: '#f2dcc2', fillI: 0.85, env: 0.85, exp: 1.02, lamp: 0,    glow: 1 },
  { h: 12.5, top: '#b8ddf4', hor: '#fff7ef', sun: '#fffaf0', sunI: 1.95, fillSky: '#dff1ff', fillGround: '#f6e6d0', fillI: 0.95, env: 1.0,  exp: 1.05, lamp: 0,    glow: 1 },
  { h: 16.5, top: '#b5d3ee', hor: '#ffe7c9', sun: '#ffe0b8', sunI: 1.6,  fillSky: '#d4e6f8', fillGround: '#f0d6b8', fillI: 0.85, env: 0.85, exp: 1.02, lamp: 0.1,  glow: 1 },
  { h: 18.4, top: '#c9a9d8', hor: '#ffb08f', sun: '#ff9f78', sunI: 0.85, fillSky: '#d8b8d8', fillGround: '#e8a890', fillI: 0.7,  env: 0.55, exp: 1.0,  lamp: 0.55, glow: 0.8 },
  { h: 19.8, top: '#5a5a98', hor: '#d98ba3', sun: '#9aa4ff', sunI: 0.3,  fillSky: '#8a8fd0', fillGround: '#8a6a86', fillI: 0.6,  env: 0.32, exp: 0.97, lamp: 0.95, glow: 0.3 },
  { h: 21.5, top: '#2f3966', hor: '#4d5a90', sun: '#aebcff', sunI: 0.22, fillSky: '#6f7fc0', fillGround: '#4a4466', fillI: 0.55, env: 0.22, exp: 0.95, lamp: 1,    glow: 0.15 },
  { h: 24,   top: '#2b3560', hor: '#46548a', sun: '#aebcff', sunI: 0.22, fillSky: '#6f7fc0', fillGround: '#4a4466', fillI: 0.55, env: 0.22, exp: 0.95, lamp: 1,    glow: 0.15 },
];

const PARSED = KEYS.map((k) => ({
  h: k.h, top: hex(k.top), hor: hex(k.hor), sun: hex(k.sun), sunI: k.sunI,
  fillSky: hex(k.fillSky), fillGround: hex(k.fillGround), fillI: k.fillI,
  env: k.env, exp: k.exp, lamp: k.lamp, glow: k.glow,
}));

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const ease = (t: number) => t * t * (3 - 2 * t);

export const wrapHour = (h: number) => ((h % 24) + 24) % 24;

export function atmosphereAt(hourIn: number): Atmosphere {
  const hour = wrapHour(hourIn);
  let i = 0;
  while (i < PARSED.length - 2 && PARSED[i + 1]!.h <= hour) i++;
  const a = PARSED[i]!, b = PARSED[i + 1]!;
  const t = ease(Math.min(1, Math.max(0, (hour - a.h) / (b.h - a.h))));
  return {
    skyTop: mixRGB(a.top, b.top, t),
    skyHorizon: mixRGB(a.hor, b.hor, t),
    sunColor: mixRGB(a.sun, b.sun, t),
    sunIntensity: mix(a.sunI, b.sunI, t),
    fillSky: mixRGB(a.fillSky, b.fillSky, t),
    fillGround: mixRGB(a.fillGround, b.fillGround, t),
    fillIntensity: mix(a.fillI, b.fillI, t),
    envIntensity: mix(a.env, b.env, t),
    exposure: mix(a.exp, b.exp, t),
    lamp: mix(a.lamp, b.lamp, t),
    windowGlow: mix(a.glow, b.glow, t),
  };
}

/** Where the key light sits: the sun by day, a dim moon the rest of the time. Returns [x, y, z]. */
export function keyLightPosition(hourIn: number): [number, number, number] {
  const hour = wrapHour(hourIn);
  const dayT = ease(Math.min(1, Math.max(0, (hour - 5.8) / 1.4))) * (1 - ease(Math.min(1, Math.max(0, (hour - 18.2) / 1.4))));
  const a = Math.min(1, Math.max(0, (hour - 6) / 12));
  const sun: [number, number, number] = [Math.cos(Math.PI * (1 - a)) * 9, 4 + Math.sin(Math.PI * a) * 8, 5];
  const moon: [number, number, number] = [-5, 9, 4];
  return [mix(moon[0], sun[0], dayT), mix(moon[1], sun[1], dayT), mix(moon[2], sun[2], dayT)];
}

/** Shortest signed difference between two hours on the 24h circle. */
export function hourDiff(from: number, to: number): number {
  let d = wrapHour(to) - wrapHour(from);
  if (d > 12) d -= 24;
  if (d < -12) d += 24;
  return d;
}
