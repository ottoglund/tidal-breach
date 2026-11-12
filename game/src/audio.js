// Procedural sound design (Web Audio, no sample files): rain ambience, harbour
// beds, layered gunshots with outdoor reverb, 3D-positioned enemy fire, foley.
export class Audio {
  constructor() { this.ctx = null; this.ready = false; }

  start() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this.ready) return;
      this.ready = true;
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = 0.9;
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
      this.master.connect(comp).connect(c.destination);
      this.reverb = c.createConvolver(); this.reverb.buffer = this.impulse(2.6, 2.4);
      this.reverbIn = c.createGain(); this.reverbIn.gain.value = 0.5;
      this.reverbIn.connect(this.reverb).connect(this.master);
      this.noise = this.noiseBuffer(3);
      this.ambience();
    } catch (_) { this.ready = false; }
  }

  impulse(sec, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections from containers / warehouse wall, then diffuse tail
        const early = (i % Math.floor(c.sampleRate * (0.031 + ch * 0.007)) < 30) ? 0.6 * (1 - t * 4) : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + Math.max(0, early)) * 0.5;
      }
    }
    return b;
  }

  noiseBuffer(sec) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.6 + last * 3.0; }
    return b;
  }

  loopNoise(type, freq, q, gain, dest = this.master) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.loop = true; s.loopStart = Math.random();
    f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = gain;
    s.connect(f).connect(g).connect(dest); s.start();
    return { s, f, g };
  }

  ambience() {
    const c = this.ctx;
    // rain: hiss on hard surfaces + heavier patter band + low rumble of the sea
    this.loopNoise('highpass', 2500, 0.5, 0.05);
    this.loopNoise('bandpass', 900, 0.7, 0.05);
    const sea = this.loopNoise('lowpass', 180, 0.7, 0.12);
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 0.08; lg.gain.value = 0.06; lfo.connect(lg).connect(sea.g.gain); lfo.start();
    // distant machinery hum (reefer units / ship generator)
    for (const [f, v] of [[49.5, 0.012], [99, 0.006], [148.7, 0.003]]) {
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.value = v; o.connect(g).connect(this.master); o.start();
    }
    // drips on metal + occasional distant ship horn
    const drip = () => {
      if (!this.ctx) return;
      this.blip(1800 + Math.random() * 2500, 0.025, 0.012 + Math.random() * 0.02, (Math.random() - 0.5) * 1.6);
      setTimeout(drip, 80 + Math.random() * 420);
    };
    drip();
    const horn = () => { this.horn(); setTimeout(horn, 45000 + Math.random() * 60000); };
    setTimeout(horn, 12000 + Math.random() * 10000);
  }

  pan(p) { const n = this.ctx.createStereoPanner(); n.pan.value = Math.max(-1, Math.min(1, p)); return n; }

  blip(freq, dur, vol, p = 0) {
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 9;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.pan(p)).connect(this.master);
    s.start(t, Math.random() * 2, dur + 0.02);
  }

  horn() {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime, g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 420;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.6); g.gain.setValueAtTime(0.05, t + 3.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
    for (const fr of [73.4, 110, 146.8]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + 5.1); }
    f.connect(g); g.connect(this.reverbIn); g.connect(this.pan(0.6)).connect(this.master);
  }

  burst(t, { freq = 1000, type = 'lowpass', q = 0.7, dur = 0.1, vol = 0.3, attack = 0.001, dest, sweep = 0 }) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g); g.connect(dest || this.master);
    s.start(t, Math.random() * 2, dur + 0.05);
    return g;
  }

  tone(t, { f0, f1 = f0, dur, vol, type = 'sine', dest }) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  gunshot() {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime, k = 0.94 + Math.random() * 0.12;
    const send = c.createGain(); send.gain.value = 0.9; send.connect(this.reverbIn);
    const bus = c.createGain(); bus.gain.value = 1; bus.connect(this.master); bus.connect(send);
    this.burst(t, { freq: 7000 * k, type: 'highpass', dur: 0.03, vol: 0.5, dest: bus });                 // crack
    this.burst(t, { freq: 2600 * k, type: 'lowpass', dur: 0.16, vol: 0.85, sweep: 400, dest: bus });     // blast body
    this.tone(t, { f0: 95 * k, f1: 38, dur: 0.22, vol: 0.7, dest: bus });                                // chest thump
    this.burst(t + 0.045, { freq: 3200, type: 'bandpass', q: 6, dur: 0.035, vol: 0.06 });                // bolt carrier
    // tail slap echo off the warehouse
    this.burst(t + 0.11, { freq: 1100, type: 'lowpass', dur: 0.35, vol: 0.12, dest: this.reverbIn });
  }

  dryFire() { if (!this.ready) return; this.burst(this.ctx.currentTime, { freq: 3000, type: 'bandpass', q: 8, dur: 0.04, vol: 0.15 }); }

  /** Distant/enemy shot with distance attenuation, delay and panning. */
  remoteShot(distance, panv) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + Math.min(0.3, distance / 343);
    const v = Math.min(0.6, 9 / (distance + 4));
    const bus = c.createGain(); bus.gain.value = 1;
    bus.connect(this.pan(panv)).connect(this.master); bus.connect(this.reverbIn);
    this.burst(t, { freq: Math.max(500, 4000 - distance * 60), type: 'lowpass', dur: 0.2, vol: v, sweep: 300, dest: bus });
    this.tone(t, { f0: 80, f1: 35, dur: 0.25, vol: v * 0.6, dest: bus });
  }

  bulletCrack(panv) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const p = this.pan(panv); p.connect(this.master);
    this.burst(t, { freq: 5000, type: 'highpass', dur: 0.025, vol: 0.25, dest: p });
    this.tone(t, { f0: 2400, f1: 900, dur: 0.08, vol: 0.04, type: 'triangle', dest: p });
  }

  impact(kind = 'metal', dist = 5, panv = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, v = Math.min(0.25, 2.5 / (dist + 2));
    const p = this.pan(panv); p.connect(this.master);
    if (kind === 'metal') { this.tone(t, { f0: 2400 + Math.random() * 1600, f1: 1200, dur: 0.12, vol: v * 0.4, type: 'triangle', dest: p }); this.burst(t, { freq: 4000, type: 'bandpass', q: 3, dur: 0.05, vol: v, dest: p }); }
    else if (kind === 'flesh') { this.burst(t, { freq: 500, type: 'lowpass', dur: 0.08, vol: v * 1.4, dest: p }); }
    else this.burst(t, { freq: 1600, type: 'bandpass', q: 1.2, dur: 0.07, vol: v, dest: p });
  }

  hitTick(kill = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.tone(t, { f0: kill ? 1300 : 1800, f1: kill ? 700 : 1600, dur: kill ? 0.16 : 0.05, vol: 0.06, type: 'triangle' });
  }

  footstep(run, wet = true) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, v = run ? 0.09 : 0.05;
    this.burst(t, { freq: 700 + Math.random() * 300, type: 'bandpass', q: 1.4, dur: 0.07, vol: v });
    if (wet) this.burst(t + 0.01, { freq: 3500 + Math.random() * 1500, type: 'bandpass', q: 2, dur: 0.09, vol: v * 0.6 });
  }

  reload(phase) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (phase === 'out') { this.burst(t, { freq: 2500, type: 'bandpass', q: 5, dur: 0.05, vol: 0.12 }); this.burst(t + 0.06, { freq: 900, type: 'bandpass', q: 3, dur: 0.08, vol: 0.08 }); }
    if (phase === 'in') { this.burst(t, { freq: 1400, type: 'bandpass', q: 4, dur: 0.06, vol: 0.18 }); this.tone(t, { f0: 180, f1: 120, dur: 0.05, vol: 0.08 }); }
    if (phase === 'bolt') { this.burst(t, { freq: 3800, type: 'bandpass', q: 6, dur: 0.04, vol: 0.16 }); this.burst(t + 0.05, { freq: 2200, type: 'bandpass', q: 5, dur: 0.05, vol: 0.12 }); }
  }

  hurt() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.tone(t, { f0: 70, f1: 30, dur: 0.3, vol: 0.25 });
    this.burst(t, { freq: 400, type: 'lowpass', dur: 0.15, vol: 0.2 });
  }

  sabotage() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) this.burst(t + i * 0.05 + Math.random() * 0.03, { freq: 2000 + Math.random() * 3000, type: 'bandpass', q: 4, dur: 0.04, vol: 0.15 });
    this.tone(t + 0.1, { f0: 420, f1: 40, dur: 1.2, vol: 0.12, type: 'sawtooth' });
    this.tone(t, { f0: 1200, f1: 300, dur: 0.4, vol: 0.05, type: 'square' });
  }

  ui(win) { if (!this.ready) return; const t = this.ctx.currentTime; this.tone(t, { f0: win ? 520 : 110, f1: win ? 780 : 50, dur: 0.6, vol: 0.12, type: 'sine' }); }
}
