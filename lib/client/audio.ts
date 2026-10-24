'use client';
/**
 * Tiny synthesized audio: no downloads, nothing autoplays. The AudioContext is created only after a user gesture,
 * everything is quiet by default, and effects are rate-limited so nothing becomes repetitive.
 */
type Settings = { master: boolean; effects: boolean; ambient: boolean };

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

  /** Called when the cat starts something new. Sounds follow real events, not a timer. */
  onActivity(activity: string, mood: string) {
    if (!this.ctx) return;
    switch (activity) {
      case 'scratch': this.scratch(); break;
      case 'play': this.toy(); break;
      case 'eat': this.crunch(); break;
      case 'drink': this.lap(); break;
      case 'seek_attention': this.meow(); break;
      case 'approach_person': if (Math.random() < 0.5) this.meow(true); break;
      case 'rub': this.purr(4); break;
      case 'rest': if (mood === 'content') this.purr(3); break;
      default: break;
    }
  }
}

export const audio = new Audio();
