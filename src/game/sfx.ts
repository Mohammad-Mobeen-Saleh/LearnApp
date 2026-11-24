/**
 * Soundeffekte, live mit der Web Audio API erzeugt (keine Audiodateien, offline verfügbar).
 * iOS erlaubt Audio erst nach einer Berührung – unlock() wird beim Spielstart aufgerufen.
 */

export type SoundName = 'laser' | 'explosion' | 'correct' | 'wrong' | 'impact' | 'gameover' | 'win' | 'click';

type AudioCtor = typeof AudioContext;

export class SoundFx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  volume = 0.7;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor: AudioCtor | undefined =
      (globalThis as { AudioContext?: AudioCtor }).AudioContext ?? (globalThis as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const length = Math.floor(this.ctx.sampleRate * 0.6);
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Muss aus einem Klick-/Touch-Ereignis heraus aufgerufen werden (iOS). */
  unlock(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  configure(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = volume;
    if (this.master) this.master.gain.value = volume;
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  close(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
  }

  play(name: SoundName): void {
    if (!this.enabled || this.volume <= 0) return;
    const ctx = this.ensure();
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    switch (name) {
      case 'laser':
        this.tone('sawtooth', 1400, 180, t, 0.14, 0.22);
        this.tone('square', 900, 120, t, 0.1, 0.08);
        break;
      case 'explosion':
        this.burst(t, 0.55, 1800, 80, 0.7);
        this.tone('sine', 120, 40, t, 0.4, 0.4);
        break;
      case 'correct':
        this.tone('triangle', 660, 660, t, 0.12, 0.25);
        this.tone('triangle', 990, 990, t + 0.1, 0.18, 0.25);
        break;
      case 'wrong':
        this.tone('sawtooth', 180, 90, t, 0.35, 0.22);
        break;
      case 'impact':
        this.burst(t, 0.4, 900, 60, 0.6);
        this.tone('sine', 90, 45, t, 0.35, 0.5);
        break;
      case 'gameover':
        [440, 370, 311, 247].forEach((f, i) => this.tone('triangle', f, f * 0.98, t + i * 0.16, 0.22, 0.22));
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.11, 0.18, 0.22));
        break;
      case 'click':
        this.tone('square', 1200, 1000, t, 0.04, 0.06);
        break;
    }
  }

  private tone(type: OscillatorType, from: number, to: number, start: number, duration: number, gain: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g).connect(this.master!);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private burst(start: number, duration: number, fromHz: number, toHz: number, gain: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(fromHz, start);
    filter.frequency.exponentialRampToValueAtTime(toHz, start + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(start);
    src.stop(start + duration);
  }
}
