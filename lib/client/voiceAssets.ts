import type { Vocal } from '@/lib/sim/voice';

/**
 * Recorded cat sounds, per category. Empty by default: the synthesised voice is used until licensed recordings
 * are added. See public/audio/cat/README.md. Paths are served from /public.
 */
export const VOICE_ASSETS: Record<Vocal, string[]> = {
  none: [],
  meow: [],
  meow_soft: [],
  meow_plea: [],
  chirp: [],
  trill: [],
  chatter: [],
  purr: [],
  hiss: [],
};

/** Minimum seconds between two sounds of the same kind, so nothing becomes a loop. */
export const VOICE_GAP_S: Record<Vocal, number> = {
  none: 0, meow: 5, meow_soft: 6, meow_plea: 12, chirp: 3, trill: 4, chatter: 10, purr: 10, hiss: 12,
};
