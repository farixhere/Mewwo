'use client';
import { VOICE_ASSETS, VOICE_GAP_S } from './voiceAssets';
import type { Vocal } from '@/lib/sim/voice';
/**
 * Tiny synthesized audio: no downloads, nothing autoplays. The AudioContext is created only after a user gesture,
 * everything is quiet by default, and effects are rate-limited so nothing becomes repetitive.
 */
type Settings = { master: boolean; effects: boolean; ambient: boolean; voice?: number; captions?: boolean };

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fx: GainNode | null = null;
  private amb: GainNode | null = null;
  private ambStarted = false;
  private noise: AudioBuffer | null = null;
  private settings: Settings = { master: true, effects: true, ambient: true };
  private last: Record<string, number> = {};
  private birdTimer: ReturnType<typeof setTimeout> | null = null;
  private daylight = 0.5;
  private voiceBus: GainNode | null = null;
  private voiceState: { until: number; priority: number; cut: () => void } | null = null;
  private lastVocal: Partial<Record<Vocal, number>> = {};
  private buffers = new Map<string, AudioBuffer | null>();

  /** Call from a real user gesture (tap). Safe to call repeatedly. */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.fx = c.createGain();
    this.amb = c.createGain();
    this.voiceBus = c.createGain();
    this.voiceBus.connect(this.master);
    this.fx.connect(this.master);
    this.amb.connect(this.master);
    this.master.connect(c.destination);
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = (b + (Math.random() * 2 - 1) * 0.02) / 1.02; d[i] = b * 3.5; } // brown-ish noise
    this.apply();
    this.startAmbient();
  }

  configure(s: Settings, daylight: number) {
    this.settings = s;
    this.daylight = daylight;
    this.apply();
  }

  private apply() {
    if (!this.ctx || !this.master || !this.fx || !this.amb) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.master ? 0.8 : 0, t, 0.05);
    this.fx.gain.setTargetAtTime(this.settings.effects ? 0.5 : 0, t, 0.05);
    this.amb.gain.setTargetAtTime(this.settings.ambient ? 0.22 : 0, t, 0.4);
    // The cat's voice has its own volume, so it can be turned down without losing footsteps and room tone.
    if (this.voiceBus) this.voiceBus.gain.setTargetAtTime(this.settings.effects ? Math.max(0, Math.min(1, this.settings.voice ?? 0.8)) * 0.9 : 0, t, 0.05);
  }

  private startAmbient() {
    if (!this.ctx || !this.amb || !this.noise || this.ambStarted) return;
    this.ambStarted = true;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320;
    const g = this.ctx.createGain(); g.gain.value = 0.35;
    src.connect(lp).connect(g).connect(this.amb);
    src.start();
    const chirpLoop = () => {
      this.birdTimer = setTimeout(() => {
        if (this.settings.ambient && this.settings.master && this.daylight > 0.4 && Math.random() < 0.6) this.chirp();
        chirpLoop();
      }, 9000 + Math.random() * 16000);
    };
    chirpLoop();
  }

  private ok(key: string, gapMs: number) {
    const now = performance.now();
    if (now - (this.last[key] ?? 0) < gapMs) return false;
    this.last[key] = now;
    return !!this.ctx && this.settings.master && this.settings.effects;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, glideTo?: number, when = 0) {
    const c = this.ctx!;
    const o = c.createOscillator(); const g = c.createGain();
    const t = c.currentTime + when;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, q: number, vol: number, when = 0) {
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.noise!;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); const t = c.currentTime + when;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.fx!);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  step() { if (this.ok('step', 180)) this.burst(0.05, 900 + Math.random() * 300, 1.2, 0.05); }
  scratch() { if (this.ok('scratch', 2500)) for (let i = 0; i < 4; i++) this.burst(0.12, 2600, 2, 0.12, i * 0.2); }
  toy() { if (this.ok('toy', 900)) { this.tone(1800, 0.09, 'triangle', 0.1, this.fx!, 2400); this.tone(2300, 0.08, 'triangle', 0.07, this.fx!, 1900, 0.07); } }
  meow(small = false) {
    if (!this.ok('meow', 6000)) return;
    const base = small ? 760 : 560;
    const c = this.ctx!;
    const o = c.createOscillator(); const g = c.createGain(); const f = c.createBiquadFilter();
    const t = c.currentTime;
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 1.35, t + 0.18); o.frequency.linearRampToValueAtTime(base * 0.8, t + 0.45);
    f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(1700, t + 0.2); f.frequency.linearRampToValueAtTime(1000, t + 0.45);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(f).connect(g).connect(this.fx!); o.start(t); o.stop(t + 0.55);
  }
  purr(seconds = 3) {
    if (!this.ok('purr', 12000)) return;
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.noise!; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = c.createGain(); const t = c.currentTime;
    const lfo = c.createOscillator(); const lg = c.createGain();
    lfo.frequency.value = 25; lg.gain.value = 0.06; lfo.connect(lg).connect(g.gain);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1, t + 0.5); g.gain.setValueAtTime(0.1, t + seconds - 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    s.connect(f).connect(g).connect(this.fx!);
    s.start(t); lfo.start(t); s.stop(t + seconds + 0.1); lfo.stop(t + seconds + 0.1);
  }
  chirp() {
    if (!this.ctx || !this.amb) return;
    const t = 0;
    for (let i = 0; i < 3; i++) this.tone(3200 + Math.random() * 800, 0.07, 'sine', 0.05, this.amb, 4200, t + i * 0.11);
  }
  crunch() { if (this.ok('crunch', 800)) for (let i = 0; i < 3; i++) this.burst(0.05, 1800, 1, 0.1, i * 0.12); }
  lap() { if (this.ok('lap', 700)) for (let i = 0; i < 3; i++) this.tone(420, 0.05, 'sine', 0.05, this.fx!, 300, i * 0.15); }


  // ---------------------------------------------------------------- the cat's voice
  // Called by the communication controller (components/scene/CatVoice.tsx) for real events only.
  // Rules: quiet sounds never cut across louder ones, the same sound has a minimum gap, one voice at a time.

  /** Returns true if a sound was started. `pitch` ~1 for an adult, higher for a kitten. */
  vocalize(sound: Vocal, o: { intensity: number; priority: number; pitch: number; seed: number }): boolean {
    if (sound === 'none' || !this.ctx || !this.voiceBus || !this.settings.master || !this.settings.effects) return false;
    const c = this.ctx;
    const now = c.currentTime;
    const gap = VOICE_GAP_S[sound];
    if (now - (this.lastVocal[sound] ?? -999) < gap && o.priority < 5) return false;
    const cur = this.voiceState;
    if (cur && now < cur.until) {
      if (o.priority <= cur.priority) return false;
      cur.cut();
    }
    this.lastVocal[sound] = now;
    // Small, seeded variation so repeats do not sound identical.
    const jit = (k: number) => { const x = Math.sin(o.seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    const pitch = o.pitch * (0.94 + jit(1) * 0.12);
    const vol = Math.max(0.1, Math.min(1, o.intensity)) * (0.85 + jit(2) * 0.15);
    const vg = c.createGain();
    vg.gain.value = 1;
    vg.connect(this.voiceBus);
    const cut = () => { vg.gain.cancelScheduledValues(c.currentTime); vg.gain.setTargetAtTime(0, c.currentTime, 0.03); };
    const files = VOICE_ASSETS[sound];
    let dur = 0.5;
    const rec = files.length ? files[Math.floor(jit(3) * files.length)]! : null;
    if (rec) {
      void this.playRecording(rec, vg, vol, pitch, sound);
      dur = sound === 'purr' ? 4 : 1.2;
    } else {
      dur = this.synth(sound, vg, vol, pitch, jit);
    }
    this.voiceState = { until: now + dur, priority: o.priority, cut };
    setTimeout(() => { try { vg.disconnect(); } catch { /* already gone */ } }, (dur + 0.6) * 1000);
    return true;
  }

  private async playRecording(url: string, dest: AudioNode, vol: number, pitch: number, sound: Vocal) {
    const c = this.ctx!;
    try {
      let buf = this.buffers.get(url);
      if (buf === undefined) {
        const res = await fetch(url);
        if (!res.ok) throw new Error('missing');
        buf = await c.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(url, buf);
      }
      if (!buf) throw new Error('bad');
      const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = pitch;
      const g = c.createGain(); g.gain.value = vol;
      src.connect(g).connect(dest); src.start();
    } catch {
      this.buffers.set(url, null);
      this.synth(sound, dest, vol, pitch, () => 0.5); // fall back to the synthesised voice
    }
  }

  private env(g: GainNode, t: number, peak: number, attack: number, hold: number, release: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  /** A formant-filtered, gliding voice: the common core of every meow-like sound. */
  private voicePart(dest: AudioNode, t: number, f0: number, f1: number, f2: number, dur: number, peak: number, formant: [number, number, number], wave: OscillatorType = 'sawtooth') {
    const c = this.ctx!;
    const o = c.createOscillator(); const f = c.createBiquadFilter(); const g = c.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + dur * 0.4);
    o.frequency.linearRampToValueAtTime(f2, t + dur);
    f.type = 'bandpass'; f.Q.value = 3.2;
    f.frequency.setValueAtTime(formant[0], t);
    f.frequency.linearRampToValueAtTime(formant[1], t + dur * 0.4);
    f.frequency.linearRampToValueAtTime(formant[2], t + dur);
    this.env(g, t, peak, Math.min(0.06, dur * 0.2), dur * 0.35, dur * 0.45);
    o.connect(f).connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.1);
  }

  private synth(sound: Vocal, dest: AudioNode, vol: number, pitch: number, jit: (k: number) => number): number {
    const c = this.ctx!;
    const t = c.currentTime + 0.01;
    switch (sound) {
      case 'meow': {
        const d = 0.55 + jit(4) * 0.2;
        this.voicePart(dest, t, 520 * pitch, 700 * pitch, 450 * pitch, d, 0.2 * vol, [850, 1750, 1000]);
        return d;
      }
      case 'meow_soft': {
        const d = 0.4 + jit(4) * 0.15;
        this.voicePart(dest, t, 620 * pitch, 720 * pitch, 520 * pitch, d, 0.1 * vol, [800, 1400, 900]);
        return d;
      }
      case 'meow_plea': {
        const d = 0.95 + jit(4) * 0.25;
        this.voicePart(dest, t, 560 * pitch, 880 * pitch, 520 * pitch, d, 0.24 * vol, [900, 1900, 1100]);
        this.voicePart(dest, t + d * 0.62, 620 * pitch, 760 * pitch, 480 * pitch, d * 0.55, 0.14 * vol, [850, 1600, 950]);
        return d * 1.2;
      }
      case 'chirp': {
        const n = 1 + (jit(5) > 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) this.voicePart(dest, t + i * 0.13, 800 * pitch, 1350 * pitch, 1500 * pitch, 0.1, 0.16 * vol, [1500, 2300, 2400], 'triangle');
        return 0.15 * n + 0.1;
      }
      case 'trill': {
        const d = 0.4 + jit(4) * 0.12;
        const o = c.createOscillator(); const lfo = c.createOscillator(); const lg = c.createGain();
        const f = c.createBiquadFilter(); const g = c.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(640 * pitch, t); o.frequency.linearRampToValueAtTime(980 * pitch, t + d);
        lfo.frequency.value = 24; lg.gain.value = 70 * pitch; lfo.connect(lg).connect(o.frequency);
        f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.6;
        this.env(g, t, 0.17 * vol, 0.04, d * 0.4, d * 0.5);
        o.connect(f).connect(g).connect(dest);
        o.start(t); lfo.start(t); o.stop(t + d + 0.1); lfo.stop(t + d + 0.1);
        return d;
      }
      case 'chatter': {
        const n = 5 + Math.floor(jit(5) * 4);
        let at = t;
        for (let i = 0; i < n; i++) {
          this.voicePart(dest, at, 1900 * pitch, 2300 * pitch, 2000 * pitch, 0.04, 0.09 * vol, [2300, 2800, 2400], 'square');
          at += 0.06 + jit(6 + i) * 0.05;
        }
        return at - t + 0.1;
      }
      case 'purr': {
        const secs = 3 + jit(4) * 2;
        const s = c.createBufferSource(); s.buffer = this.noise!; s.loop = true;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 230;
        const g = c.createGain();
        const lfo = c.createOscillator(); const lg = c.createGain();
        lfo.frequency.value = 24 + jit(7) * 4; lg.gain.value = 0.45 * 0.2 * vol; lfo.connect(lg).connect(g.gain);
        this.env(g, t, 0.28 * vol, 0.7, secs - 1.6, 0.9);
        s.connect(f).connect(g).connect(dest);
        s.start(t); lfo.start(t); s.stop(t + secs + 0.1); lfo.stop(t + secs + 0.1);
        return secs;
      }
      case 'hiss': {
        const s = c.createBufferSource(); s.buffer = this.noise!;
        const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3200;
        const g = c.createGain();
        this.env(g, t, 0.2 * vol, 0.04, 0.25, 0.25);
        s.connect(f).connect(g).connect(dest);
        s.start(t, jit(4) * 1.2, 0.7);
        return 0.6;
      }
      default:
        return 0;
    }
  }

  /** Called when the cat starts something new. Sounds follow real events, not a timer. */
  onActivity(activity: string, mood: string) {
    if (!this.ctx) return;
    switch (activity) {
      case 'scratch': this.scratch(); break;
      case 'play': this.toy(); break;
      case 'eat': this.crunch(); break;
      case 'drink': this.lap(); break;
      default: break;
    }
  }
}

export const audio = new Audio();
