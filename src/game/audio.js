// Fully synthesised audio (no files): tribal drum loop, drone, and SFX via WebAudio.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = false;
    this.tempo = 112;
    this.coinStreak = 0;
    this.lastCoin = 0;
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0.55;
      this.music.connect(this.master);
      this.noiseBuf = this._makeNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  _makeNoise() {
    const len = this.ctx.sampleRate * 1.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _env(node, t, a, peak, dec) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  _tone(type, f0, f1, t, dur, vol, dest = this.sfx) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this._env(g, t, 0.005, vol, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise(t, dur, vol, type, f0, f1 = f0, q = 1, dest = this.sfx) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, 0.005, vol, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  get ok() {
    return this.ctx && this.ctx.state === 'running';
  }

  coin() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const now = performance.now();
    this.coinStreak = now - this.lastCoin < 400 ? Math.min(this.coinStreak + 1, 12) : 0;
    this.lastCoin = now;
    const base = 1180 * Math.pow(2, (this.coinStreak % 8) / 24);
    this._tone('triangle', base, base, t, 0.08, 0.18);
    this._tone('sine', base * 1.5, base * 1.5, t + 0.05, 0.16, 0.14);
  }

  jump() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.22, 0.25, 'bandpass', 500, 2400, 1.2);
    this._tone('sine', 220, 420, t, 0.15, 0.12);
  }

  slide() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.4, 0.3, 'lowpass', 2400, 400, 0.8);
  }

  lane() {
    if (!this.ok) return;
    this._noise(this.ctx.currentTime, 0.12, 0.12, 'bandpass', 1800, 900, 2);
  }

  step() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 110, 55, t, 0.08, 0.14);
    this._noise(t, 0.05, 0.05, 'highpass', 3000, 3000, 0.7);
  }

  land() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 120, 45, t, 0.18, 0.3);
    this._noise(t, 0.15, 0.15, 'lowpass', 900, 200, 0.7);
  }

  stumble() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._tone('square', 300, 90, t, 0.3, 0.12);
    this._noise(t, 0.25, 0.2, 'lowpass', 1200, 200, 1);
    // monkey screech
    this._tone('sawtooth', 900, 1500, t + 0.1, 0.25, 0.05);
    this._tone('sawtooth', 1300, 700, t + 0.3, 0.25, 0.05);
  }

  crash() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._tone('sawtooth', 180, 40, t, 0.9, 0.2);
    this._noise(t, 0.6, 0.45, 'lowpass', 2000, 80, 0.8);
    this._tone('sine', 70, 30, t, 0.8, 0.5);
  }

  go() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this._tone('triangle', f, f, t + i * 0.07, 0.25, 0.12));
  }

  tick() {
    if (!this.ok) return;
    this._tone('triangle', 660, 660, this.ctx.currentTime, 0.12, 0.12);
  }

  // ---------------------------------------------------------------- music
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step16 = 0;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.music.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.3);

    // Drone: detuned low fifth through a slow-moving lowpass
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    f.Q.value = 3;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 180;
    lfo.connect(lfoG).connect(f.frequency);
    const dg = this.ctx.createGain();
    dg.gain.value = 0.0001;
    dg.gain.exponentialRampToValueAtTime(0.1, this.ctx.currentTime + 2);
    this.drone = [lfo];
    for (const [freq, det] of [
      [55, -6],
      [55, 7],
      [82.4, 0],
    ]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start();
      this.drone.push(o);
    }
    f.connect(dg).connect(this.music);
    lfo.start();
    this.droneGain = dg;

    this.timer = setInterval(() => this._schedule(), 25);
  }

  stopMusic() {
    if (!this.musicOn) return;
    this.musicOn = false;
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.droneGain.gain.setTargetAtTime(0.0001, t, 0.3);
    const drone = this.drone;
    setTimeout(() => drone.forEach((o) => o.stop()), 1500);
  }

  setIntensity(k) {
    // speed up the groove slightly as the run gets faster
    this.tempo = 112 + k * 28;
  }

  _schedule() {
    const spb = 60 / this.tempo / 4; // 16th notes
    while (this.nextNote < this.ctx.currentTime + 0.12) {
      this._drum(this.step16, this.nextNote);
      this.nextNote += spb;
      this.step16 = (this.step16 + 1) % 32;
    }
  }

  _drum(s, t) {
    const d = this.music;
    const i = s % 16;
    // Kick: deep tribal thump
    if (i === 0 || i === 6 || i === 10 || (s === 30)) {
      this._tone('sine', 150, 42, t, 0.28, 0.55, d);
    }
    // Toms
    if (i === 4 || i === 12) this._tone('sine', 210, 120, t, 0.2, 0.3, d);
    if (i === 14 || (s >= 28 && i % 2 === 0)) this._tone('sine', 260, 150, t, 0.14, 0.24, d);
    // Shaker on off-beats
    if (i % 2 === 1) this._noise(t, 0.05, i % 4 === 3 ? 0.1 : 0.05, 'highpass', 6000, 6000, 0.8, d);
    // Rim clicks
    if (i === 3 || i === 11) this._noise(t, 0.03, 0.12, 'bandpass', 2500, 2500, 6, d);
    // Marimba-ish motif every other bar
    if (s >= 16) {
      const notes = { 16: 220, 19: 262, 22: 294, 24: 330, 27: 294 };
      if (notes[s]) this._tone('triangle', notes[s], notes[s], t, 0.25, 0.06, d);
    }
  }
}
