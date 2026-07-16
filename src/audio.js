// Tiny synthesized sound engine — every SFX is generated live with the Web
// Audio API, so there are no audio files to ship. The AudioContext must be
// resumed from a user gesture (handled in main.js on START / first tap).

export class SFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._last = {}; // per-name throttle for ambient sounds
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.32 : 0;
    this.master.connect(this.ctx.destination);
  }

  resume() { this._ensure(); if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }
  setEnabled(on) { this.enabled = on; this._ensure(); if (this.master) this.master.gain.value = on ? 0.32 : 0; }

  // A pitched blip: an oscillator with an optional glide + quick attack/decay.
  _tone(type, f0, f1, dur, vol, t0) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // A filtered noise burst (shots, explosions, swishes, hisses).
  _noise(dur, vol, t0, filtType, freq, q, sweep) {
    const ctx = this.ctx;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = filtType || "lowpass";
    filt.frequency.setValueAtTime(freq, t0);
    if (sweep != null) filt.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t0 + dur);
    filt.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  play(name) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Throttle ambient/voice/repeated sounds so they don't blare.
    const throttle = { groan: 0.2, hiss: 0.2, step: 0.2, shell: 0.05 };
    if (throttle[name] && this._last[name] && t - this._last[name] < throttle[name]) return;
    this._last[name] = t;
    switch (name) {
      // --- gunshots (weapon.sound strings) ---
      case "pop":    this._noise(0.08, 0.4, t, "bandpass", 1400, 1.4, 600); this._tone("square", 220, 80, 0.06, 0.14, t); break;
      case "boom":   this._noise(0.26, 0.6, t, "lowpass", 1300, 1, 130);   this._tone("sine", 120, 40, 0.22, 0.3, t); break;
      case "crack":  this._noise(0.12, 0.5, t, "highpass", 2400, 1, null); this._tone("square", 400, 120, 0.08, 0.16, t); break;
      case "rattle": this._noise(0.05, 0.32, t, "bandpass", 1800, 1.2, 900); break; // per-round
      case "launch": this._noise(0.4, 0.5, t, "lowpass", 900, 1, 200);     this._tone("sawtooth", 180, 60, 0.35, 0.22, t); break;
      // --- melee ---
      case "swipe":  this._noise(0.12, 0.24, t, "bandpass", 1200, 0.8, 2600); break;
      // --- world / feedback ---
      case "explode": this._noise(0.6, 0.8, t, "lowpass", 1600, 1, 60); this._tone("sine", 90, 30, 0.5, 0.4, t); break;
      case "hurt":   this._tone("sawtooth", 300, 110, 0.18, 0.28, t); this._noise(0.1, 0.14, t, "lowpass", 800, 1, null); break;
      case "pickup": this._tone("square", 600, 1000, 0.12, 0.22, t); break;
      case "heal":   this._tone("sine", 520, 900, 0.2, 0.22, t); break;
      case "reload": this._tone("square", 200, null, 0.03, 0.18, t); this._noise(0.05, 0.14, t + 0.07, "bandpass", 2000, 2, null); break;
      case "click":  this._noise(0.03, 0.14, t, "highpass", 3000, 1, null); break;
      case "shell":  this._tone("triangle", 2400 + Math.random() * 900, 1500, 0.045, 0.06, t); this._noise(0.03, 0.05, t, "highpass", 5200, 1, null); break; // brass tink
      case "ui":     this._tone("square", 440, 660, 0.08, 0.2, t); break;
      case "wave":   this._tone("sawtooth", 160, 320, 0.5, 0.16, t); this._tone("sine", 320, 480, 0.5, 0.12, t + 0.05); break;
      case "clear":  this._tone("square", 523, 784, 0.14, 0.2, t); this._tone("square", 784, 1046, 0.2, 0.2, t + 0.12); break;
      // --- zombie voices ---
      case "groan":  this._tone("sawtooth", 105 + Math.random() * 40, 70, 0.5, 0.16, t); this._noise(0.4, 0.07, t, "lowpass", 500, 1, null); break;
      case "hiss":   this._noise(0.35, 0.18, t, "highpass", 1500, 1, null); break; // spit
      case "splat":  this._noise(0.14, 0.3, t, "lowpass", 700, 1, 200); break;     // acid hit
    }
  }
}

export const sfx = new SFX();
