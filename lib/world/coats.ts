/** Coat colours, shared by the 3D cat and the 2D portrait in the HUD (no three.js here). */
export const COATS = [
  { base: '#e3a15c', accent: '#fbefd9', dark: '#bf7a3a' }, // orange tabby
  { base: '#a3a7b0', accent: '#eeeef2', dark: '#7d818b' }, // grey
  { base: '#3a3940', accent: '#585662', dark: '#25242a' }, // black
  { base: '#ecdbb8', accent: '#fff8ea', dark: '#d2b98f' }, // cream
  { base: '#a06c48', accent: '#efdfc6', dark: '#76492c' }, // brown tabby
  { base: '#f2eee6', accent: '#ffffff', dark: '#d6d0c3' }, // white
] as const;

export const coatFor = (seed: number) => COATS[(((seed ?? 1) - 1) % COATS.length + COATS.length) % COATS.length]!;
