// TIDAL BREACH – procedural sound design (Web Audio API only).
//
// No sample files and no network: every sound is synthesised from noise,
// pressure pulses (Friedlander waves), N-waves, bubbles and small modal
// resonators into AudioBuffers once at start-up. At runtime each event is a
// handful of cheap BufferSource -> Gain (-> Panner) nodes that disconnect
// themselves when finished. Ambience is a set of long, cross-faded loops of
// different lengths plus randomised one-shots, so there is no audible loop.
//
// Enemy voices use the browser's speechSynthesis with on-device Russian voices
// only (voice.localService === true). Network voices are never used. Without a
// local Russian voice a muffled, unintelligible synthesised shout is played
// through Web Audio instead (3D-positioned like every other enemy sound).

const TAU = Math.PI * 2;
const rnd = Math.random;
const rr = (a, b) => a + (b - a) * rnd();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const pick = a => (a && a.length ? a[(rnd() * a.length) | 0] : null);
const wall = () => performance.now() / 1000;
const MOBILE = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
const LOW = 22050; // sample rate for dark / low-frequency material (halves generation cost)

// ============================================================ offline DSP kit
const white = n => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = rnd() * 2 - 1; return a; };
function pink(n) {
  const a = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  return a;
}
function brown(n) { const a = new Float32Array(n); let l = 0; for (let i = 0; i < n; i++) { l = (l + 0.02 * (rnd() * 2 - 1)) / 1.02; a[i] = l * 3.5; } return a; }
/** one-pole low-pass, in place; fc may be a function of the sample index */
function lp1(a, fc, sr, passes = 1) {
  const fn = typeof fc === 'function';
  for (let p = 0; p < passes; p++) {
    let y = 0, k = fn ? 0 : 1 - Math.exp(-TAU * Math.min(fc, sr * 0.45) / sr);
    for (let i = 0; i < a.length; i++) {
      if (fn && (i & 15) === 0) k = 1 - Math.exp(-TAU * Math.min(fc(i), sr * 0.45) / sr);
      y += k * (a[i] - y); a[i] = y;
    }
  }
  return a;
}
function hp1(a, fc, sr) { let y = 0; const k = 1 - Math.exp(-TAU * fc / sr); for (let i = 0; i < a.length; i++) { y += k * (a[i] - y); a[i] -= y; } return a; }
/** RBJ biquad (lp / hp / bp with 0 dB peak), in place */
function biquad(a, type, f, q, sr) {
  const w = TAU * Math.min(f, sr * 0.45) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al, a1 = -2 * cw / a0, a2 = (1 - al) / a0; b0 /= a0; b1 /= a0; b2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; a[i] = y; }
  return a;
}
/** two-pole resonator with time-varying centre (array or function of index); returns a new array */
function resTV(x, f, bw, sr) {
  const out = new Float32Array(x.length), arr = typeof f !== 'number', fn = typeof f === 'function';
  const r = Math.exp(-Math.PI * bw / sr), a2 = r * r, g = 1 - r;
  let a1 = -2 * r * Math.cos(TAU * (arr ? 0 : f) / sr), y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    if (arr && (i & 7) === 0) a1 = -2 * r * Math.cos(TAU * Math.min(fn ? f(i) : f[i], sr * 0.45) / sr);
    const y = g * x[i] - a1 * y1 - a2 * y2; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}
function peakOf(chs) { let m = 1e-9; for (const a of chs) for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; }
function norm(a, peak = 0.9) { const k = peak / peakOf([a]); for (let i = 0; i < a.length; i++) a[i] *= k; return a; }
function normAll(chs, peak = 0.9) { const k = peak / peakOf(chs); for (const a of chs) for (let i = 0; i < a.length; i++) a[i] *= k; return chs; }
function mix(out, src, at = 0, gain = 1) { for (let i = Math.max(0, -at); i < src.length && at + i < out.length; i++) out[at + i] += src[i] * gain; return out; }
/** struck mode: exponentially decaying sinusoid */
function mode(out, at, f, tau, amp, sr) {
  if (at < 0 || at >= out.length || f >= sr * 0.45) return;
  const n = Math.min(out.length - at, Math.ceil(tau * sr * 7)), w = TAU * f / sr, d = Math.exp(-1 / (tau * sr));
  let e = amp; const ph = rnd() * TAU;
  for (let i = 0; i < n; i++) { out[at + i] += e * Math.sin(ph + w * i); e *= d; }
}
/** Friedlander blast wave: instant rise, positive phase of length T, negative suction phase */
function fried(out, at, A, T, b, sr) {
  const n = Math.min(out.length - at, Math.ceil(T * sr * 9));
  for (let i = 0; i < n; i++) { const t = i / sr; out[at + i] += A * (1 - t / T) * Math.exp(-b * t / T); }
}
/** supersonic N-wave (bullet shock) */
function nwave(out, at, dur, amp, sr) { const n = Math.max(3, Math.round(dur * sr)); for (let i = 0; i < n && at + i < out.length; i++) out[at + i] += amp * (1 - 2 * i / (n - 1)); }
/** shaped noise burst; filt(arr) may filter it before mixing */
function burst(out, at, att, dec, amp, sr, filt) {
  const n = Math.min(out.length - at, Math.ceil((att + dec * 7) * sr)); if (n <= 0) return;
  const s = white(n);
  for (let i = 0; i < n; i++) { const t = i / sr; s[i] *= amp * (t < att ? t / att : Math.exp(-(t - att) / dec)); }
  if (filt) filt(s);
  mix(out, s, at);
}
/** Minnaert bubble – a short rising chirp; the signature of splashing water */
function bubble(out, at, f0, tau, amp, sr) {
  const n = Math.min(out.length - at, Math.ceil(tau * sr * 6)); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / sr, f = f0 * (1 + 0.035 * f0 * t); if (f > sr * 0.45) break; ph += TAU * f / sr; out[at + i] += amp * Math.exp(-t / tau) * Math.sin(ph); }
}
/** metallic click: a few inharmonic modes plus a tiny noise transient */
function clink(out, at, freqs, tau, amp, sr) {
  for (const f of freqs) mode(out, at, f * rr(0.94, 1.06), tau * rr(0.6, 1.3), amp * rr(0.3, 1), sr);
  burst(out, at, 0.0001, 0.0005, amp * 0.6, sr);
}
/** equal-power cross-fade of the tail into the head: seamless loop */
function loopify(a, xf) {
  const n = a.length - xf, o = a.slice(0, n);
  for (let i = 0; i < xf; i++) { const u = i / xf * Math.PI / 2; o[i] = a[i] * Math.sin(u) + a[n + i] * Math.cos(u); }
  return o;
}
/** slowly varying random signal in [-1, 1] (for modulation) */
function drift(n, sr, hz) { const a = white(n); lp1(a, hz, sr, 2); return norm(a, 1); }
/** one-pole smoothing with time constant tau (seconds) */
function smooth(a, tau, sr) { const k = 1 - Math.exp(-1 / (tau * sr)); let y = a[0]; for (let i = 0; i < a.length; i++) { y += k * (a[i] - y); a[i] = y; } return a; }

// ============================================================ generators
/** 5.56 / 7.62 rifle report at the shooter. heavy: more low end; mech: bolt-carrier noise. */
function genRifle(sr, o = {}) {
  const { len = 0.55, heavy = 0, mech = 1, crack = 1, refl = 0.35 } = o;
  const n = Math.floor(sr * len), out = new Float32Array(n), k = rr(0.93, 1.07);
  if (crack) nwave(out, 0, 0.00028 * k, 0.8 * crack, sr);                       // supersonic crack
  fried(out, 2, 1.0, 0.0009 * k * (1 + heavy * 0.3), 1.6, sr);                    // sharp muzzle blast
  fried(out, 2, 0.5 * (1 + heavy * 0.5), 0.0045 * (1 + heavy * 0.6), 1.2, sr);    // broad pressure pulse (punch)
  // turbulent propellant gas: fast + slow decays, darkening as it expands
  const g = white(n);
  for (let i = 0; i < n; i++) { const t = i / sr; g[i] *= (t < 0.0003 ? t / 0.0003 : 1) * (0.55 * Math.exp(-t / 0.005) + 0.22 * Math.exp(-t / 0.03) + 0.06 * Math.exp(-t / (0.12 + heavy * 0.05))); }
  lp1(g, i => 900 + 11000 * Math.exp(-(i / sr) / (0.012 + heavy * 0.004)), sr, 2);
  mix(out, g, 0, 1.6);
  const b = brown(n);                                                            // low body
  for (let i = 0; i < n; i++) { const t = i / sr; b[i] *= (t < 0.002 ? t / 0.002 : 1) * Math.exp(-t / (0.05 + heavy * 0.03)); }
  biquad(b, 'lp', 200 - heavy * 40, 0.7, sr);
  mix(out, b, 0, 0.6 + heavy * 0.4);
  if (mech) {                                                                    // bolt carrier back, then forward and lock
    clink(out, Math.round(0.031 * k * sr), [1850, 2950, 4400, 6150, 8300], 0.007, 0.05 * mech, sr);
    clink(out, Math.round(0.072 * k * sr), [1450, 2600, 3900, 5800], 0.009, 0.045 * mech, sr);
    burst(out, Math.round(0.07 * k * sr), 0.0005, 0.006, 0.03 * mech, sr, s => biquad(s, 'bp', 900, 1, sr));
  }
  if (refl) { const r = out.slice(); lp1(r, 2600, sr); mix(out, r, Math.round(0.0065 * sr), refl); } // wet concrete ground bounce
  hp1(out, 28, sr);
  norm(out, 1); for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 1.7) / Math.tanh(1.7);
  return norm(out, 0.95);
}
/** what a nearby wall sends back: blast only, smeared by corrugated steel, darker */
function genEcho(sr, fc) {
  const dry = genRifle(sr, { len: 0.4, crack: 0, mech: 0, refl: 0 }), out = new Float32Array(dry.length);
  for (let k = 0; k < 6; k++) mix(out, dry, Math.round(rr(0, 0.014) * sr), rr(0.3, 1) / (1 + k * 0.4));
  lp1(out, fc, sr, 2); hp1(out, 60, sr);
  return norm(out, 0.9);
}
/** long rolling echo off container stacks, the warehouse and the far side of the basin (stereo) */
function genRoll(sr, sec = 3.2) {
  const n = Math.floor(sr * sec), L = new Float32Array(n), R = new Float32Array(n);
  const taps = 95;
  for (let k = 0; k < taps; k++) {
    const t = 0.05 + (sec - 0.4) * Math.pow(rnd(), 1.5), strong = rnd() < 0.13;
    const w = strong ? rr(0.004, 0.012) : 0.006 + t * rr(0.03, 0.07), a = Math.exp(-t / 0.75) * rr(0.2, 1) * (strong ? 2.2 : 1);
    const p = rr(-1, 1), gl = Math.sqrt((1 - p) / 2), gr = Math.sqrt((1 + p) / 2), i0 = Math.round(t * sr), W = Math.round(w * sr);
    for (let j = 0; j < W && i0 + j < n; j++) { const v = (rnd() * 2 - 1) * Math.pow(Math.sin(Math.PI * j / W), 2) * a; L[i0 + j] += v * gl; R[i0 + j] += v * gr; }
  }
  for (const C of [L, R]) {                                                      // diffuse thunder-like bed
    for (let i = 0; i < n; i++) { const t = i / sr; C[i] += (rnd() * 2 - 1) * 0.12 * Math.min(1, t / 0.12) * Math.exp(-t / 0.9); }
    lp1(C, i => 320 + 3600 * Math.exp(-(i / sr) / 0.45), sr, 2); hp1(C, 45, sr);
    for (let i = n - 2000; i < n; i++) C[i] *= (n - i) / 2000;
  }
  return normAll([L, R], 0.9);
}
/** outdoor impulse response: sparse early reflections then a dark diffuse tail (stereo) */
function genIR(sr, sec = 1.8) {
  const n = Math.floor(sr * sec), chs = [new Float32Array(n), new Float32Array(n)];
  for (const C of chs) {
    for (let k = 0; k < 16; k++) { const t = rr(0.008, 0.09), i = Math.round(t * sr); C[i] += (rnd() < 0.5 ? -1 : 1) * rr(0.3, 0.9) * (1 - t / 0.12); }
    for (let i = Math.round(0.015 * sr); i < n; i++) { const t = i / sr; C[i] += (rnd() * 2 - 1) * 0.35 * Math.min(1, (t - 0.015) / 0.05) * Math.exp(-t * 6.9 / 1.5); }
    lp1(C, i => 600 + 7000 * Math.exp(-(i / sr) / 0.35), sr, 2);
  }
  return normAll(chs, 0.9);
}
/** brass case bouncing on wet concrete */
function genCasing(sr) {
  const out = new Float32Array(Math.floor(sr * 0.6)); let t = 0, a = 1, gap = rr(0.07, 0.12);
  const base = [4100, 6650, 9300, 11900].map(f => f * rr(0.95, 1.05));
  for (let b = 0, nb = 3 + (rnd() * 3 | 0); b < nb; b++) {
    const i = Math.round(t * sr);
    for (const f of base) mode(out, i, f * rr(0.99, 1.01), rr(0.012, 0.035), a * rr(0.2, 1), sr);
    burst(out, i, 0.0001, 0.0006, a * 0.5, sr, s => hp1(s, 3000, sr));
    if (b === 0) burst(out, i, 0.001, 0.01, 0.15, sr, s => biquad(s, 'hp', 3000, 0.7, sr)); // tiny splash
    t += gap; gap *= rr(0.5, 0.7); a *= rr(0.4, 0.7);
  }
  lp1(out, 12000, sr);
  return norm(out, 0.8);
}
/** bullet passing close: N-wave, ground reflection, short zip */
function genSnap(sr) {
  const out = new Float32Array(Math.floor(sr * 0.25));
  nwave(out, 0, rr(0.0003, 0.00045), 1, sr);
  const r = new Float32Array(out.length); nwave(r, 0, 0.0004, 0.45, sr); lp1(r, 5000, sr); mix(out, r, Math.round(rr(0.002, 0.004) * sr));
  const z = white(out.length);
  for (let i = 0; i < z.length; i++) { const t = i / sr; z[i] *= (t < 0.004 ? t / 0.004 : Math.exp(-(t - 0.004) / 0.03)) * 0.25; }
  biquad(z, 'bp', rr(2800, 4200), 1.2, sr); mix(out, z);
  burst(out, 0, 0.001, 0.05, 0.05, sr, s => hp1(s, 1500, sr));
  return norm(out, 0.95);
}
/** boot on wet asphalt: heel, sole slap, splash and bubbles */
function genStep(sr) {
  const out = new Float32Array(Math.floor(sr * 0.4)), t1 = rr(0.035, 0.07);
  burst(out, 0, 0.002, 0.022, 1, sr, s => biquad(s, 'bp', rr(200, 320), 0.9, sr));
  burst(out, 0, 0.001, 0.015, 0.8, sr, s => lp1(s, 150, sr, 2));
  burst(out, Math.round(t1 * sr), 0.001, 0.016, 0.5, sr, s => biquad(s, 'bp', rr(900, 1400), 0.7, sr));
  burst(out, Math.round(0.004 * sr), 0.004, rr(0.04, 0.08), 0.32, sr, s => biquad(s, 'hp', 2200, 0.7, sr));
  burst(out, Math.round((t1 + 0.004) * sr), 0.003, rr(0.03, 0.05), 0.18, sr, s => biquad(s, 'hp', 2800, 0.7, sr));
  for (let k = 0, nb = 6 + (rnd() * 9 | 0); k < nb; k++) bubble(out, Math.round(Math.pow(rnd(), 1.6) * 0.17 * sr), rr(900, 3800), rr(0.002, 0.007), rr(0.05, 0.22), sr);
  for (let k = 0; k < 2; k++) bubble(out, Math.round(rr(0.18, 0.3) * sr), rr(1200, 3000), 0.004, 0.04, sr);
  burst(out, Math.round(rr(0.02, 0.08) * sr), 0.01, 0.03, 0.05, sr, s => biquad(s, 'bp', 5000, 0.8, sr)); // grit scuff
  hp1(out, 60, sr);
  return norm(out, 0.9);
}
/** sling swivel / magazine pouch rattle and cloth */
function genGear(sr) {
  const out = new Float32Array(Math.floor(sr * 0.25)), s = rr(0.8, 1.25);
  for (let k = 0, nk = 2 + (rnd() * 3 | 0); k < nk; k++) clink(out, Math.round(rr(0, 0.08) * sr), [1350 * s, 2280 * s, 3550 * s, 5100 * s], rr(0.008, 0.025), rr(0.3, 1), sr);
  burst(out, 0, 0.02, 0.05, 0.25, sr, x => biquad(x, 'bp', rr(2200, 3500), 0.6, sr));
  return norm(out, 0.7);
}
function genReload(sr, kind) {
  const out = new Float32Array(Math.floor(sr * 0.5));
  if (kind === 'release') { clink(out, 0, [2600, 4100, 6900], 0.006, 1, sr); clink(out, Math.round(0.008 * sr), [6500, 9100], 0.003, 0.4, sr); }
  if (kind === 'out') {                                                           // magazine sliding out of the well
    const s = white(Math.round(0.11 * sr));
    for (let i = 0; i < s.length; i++) { const t = i / sr; s[i] *= Math.sin(Math.PI * t / 0.11) * (0.6 + 0.4 * Math.abs(Math.sin(TAU * 90 * t))); }
    biquad(s, 'bp', 1800, 1.5, sr); mix(out, s, 0, 0.6);
    clink(out, Math.round(0.1 * sr), [700, 1300, 2400], 0.012, 0.5, sr);
    burst(out, Math.round(0.12 * sr), 0.01, 0.04, 0.2, sr, x => biquad(x, 'bp', 2600, 0.6, sr)); // hand / glove
  }
  if (kind === 'pouch') {                                                         // new magazine out of the pouch
    const s = white(Math.round(0.28 * sr));
    for (let i = 0; i < s.length; i++) { const t = i / sr; s[i] *= Math.sin(Math.PI * t / 0.28) * (rnd() < 0.08 ? 1.6 : 0.5); }
    biquad(s, 'bp', 2500, 0.7, sr); mix(out, s, 0, 0.5);
    clink(out, Math.round(0.22 * sr), [1100, 2100, 3300], 0.01, 0.35, sr);
  }
  if (kind === 'in') {                                                            // seat the magazine
    const s = white(Math.round(0.045 * sr)); for (let i = 0; i < s.length; i++) s[i] *= i / s.length; biquad(s, 'bp', 2000, 1.2, sr); mix(out, s, 0, 0.4);
    const c = Math.round(0.045 * sr);
    clink(out, c, [900, 1600, 2700, 4300], 0.018, 1, sr);
    burst(out, c, 0.0005, 0.012, 0.8, sr, x => biquad(x, 'bp', 300, 0.8, sr));
    clink(out, c + Math.round(0.022 * sr), [3200, 5400], 0.006, 0.5, sr);           // catch engages
  }
  if (kind === 'bolt') {                                                          // bolt release: spring drives carrier home
    burst(out, 0, 0.001, 0.008, 0.25, sr, x => biquad(x, 'bp', 4500, 2, sr));
    const c = Math.round(0.03 * sr);
    clink(out, c, [700, 1450, 2350, 3900, 5600], 0.03, 1, sr);
    burst(out, c, 0.0005, 0.015, 1, sr, x => lp1(x, 400, sr, 2));
  }
  if (kind === 'dry') { clink(out, 0, [2100, 3500, 5200], 0.007, 1, sr); clink(out, Math.round(0.012 * sr), [6500], 0.003, 0.3, sr); }
  hp1(out, 50, sr);
  return norm(out, 0.9);
}
function genImpact(sr, kind) {
  const out = new Float32Array(Math.floor(sr * (kind === 'metal' ? 0.6 : 0.35)));
  if (kind === 'metal') {                                                         // round into container steel
    nwave(out, 0, 0.0002, 0.7, sr);
    const fs = [rr(300, 420), rr(560, 700), rr(900, 1150), rr(1500, 1800), rr(2400, 2900), rr(3600, 4300), rr(5200, 6000)], ts = [0.15, 0.12, 0.09, 0.07, 0.05, 0.035, 0.025];
    fs.forEach((f, i) => mode(out, 1, f, ts[i] * rr(0.6, 1.2), rr(0.15, 0.5), sr));
    burst(out, 0, 0.0002, 0.004, 0.8, sr, s => hp1(s, 2500, sr));
  } else if (kind === 'flesh') {
    fried(out, 0, 0.8, 0.004, 1.5, sr);
    burst(out, 0, 0.001, 0.02, 0.8, sr, s => lp1(s, 400, sr, 2));
    burst(out, Math.round(0.003 * sr), 0.001, 0.015, 0.35, sr, s => biquad(s, 'bp', 900, 1, sr));
  } else {                                                                        // wet concrete / asphalt
    nwave(out, 0, 0.0002, 0.6, sr);
    fried(out, 0, 0.4, 0.002, 1.5, sr);
    for (let k = 0; k < 7; k++) mode(out, Math.round(rr(0, 0.08) * sr), rr(3000, 7000), 0.002, rr(0.05, 0.2), sr);
    burst(out, 0, 0.002, 0.05, 0.4, sr, s => biquad(s, 'hp', 2000, 0.7, sr));
    for (let k = 0; k < 6; k++) bubble(out, Math.round(rr(0, 0.12) * sr), rr(1000, 3500), 0.004, 0.12, sr);
  }
  hp1(out, 50, sr);
  return norm(out, 0.9);
}
function genRicochet(sr) {
  const n = Math.floor(sr * 0.5), s = white(n), f0 = rr(2600, 3800);
  for (let i = 0; i < n; i++) { const t = i / sr; s[i] *= (t < 0.01 ? t / 0.01 : Math.exp(-(t - 0.01) / 0.12)); }
  const out = resTV(s, i => f0 * Math.exp(-(i / sr) / 0.35) + 700, 140, sr);
  return norm(out, 0.7);
}
function genTick(sr, kill) {
  const out = new Float32Array(Math.floor(sr * 0.12));
  mode(out, 0, kill ? 1500 : 2400, kill ? 0.012 : 0.004, 0.6, sr);
  burst(out, 0, 0.0001, 0.0006, 0.6, sr, s => hp1(s, 2000, sr));
  if (kill) fried(out, 0, 0.5, 0.003, 1.5, sr);
  return norm(out, 0.8);
}
function genThud(sr) {                                                            // round into plate carrier / body
  const out = new Float32Array(Math.floor(sr * 0.4));
  fried(out, 0, 1, 0.006, 1.4, sr);
  burst(out, 0, 0.002, 0.05, 0.8, sr, s => lp1(s, 200, sr, 2));
  mode(out, 0, rr(800, 1000), 0.02, 0.25, sr);
  clink(out, Math.round(rr(0.02, 0.05) * sr), [1350, 2280, 3550], 0.012, 0.12, sr);
  return norm(out, 0.9);
}
function genHeart(sr) {
  const out = new Float32Array(Math.floor(sr * 0.25));
  fried(out, 0, 1, 0.02, 1.5, sr); burst(out, 0, 0.004, 0.03, 0.4, sr, s => lp1(s, 60, sr, 2));
  lp1(out, 90, sr, 2);
  return norm(out, 0.9);
}

// ---- voice source: Rosenberg glottal pulses through three formant resonators
const VOW = { 'а': [750, 1250, 2600], 'я': [720, 1400, 2600], 'о': [520, 880, 2500], 'ё': [520, 1050, 2500], 'у': [330, 760, 2300], 'ю': [330, 1050, 2300], 'ы': [330, 1500, 2400], 'и': [290, 2200, 2950], 'е': [480, 1850, 2550], 'э': [500, 1700, 2500] };
const SIB = { 'с': 5500, 'з': 5000, 'ц': 5200, 'ш': 2900, 'щ': 3400, 'ж': 2700, 'ч': 3600, 'ф': 1800, 'х': 1600 };
const PLO = { 'п': 900, 'б': 900, 'т': 4200, 'д': 3800, 'к': 2100, 'г': 2000 };
const SON = 'мнлрвй';
function synthVoice(sr, n, f0fn, F, AV, AN, NF, breath = 0.04) {
  const src = new Float32Array(n), fr = white(n);
  let ph = 0, gp = 0, jit = 0;
  for (let i = 0; i < n; i++) {
    jit += (rnd() - 0.5) * 0.004 - jit * 0.02;
    ph += f0fn(i) * (1 + jit) / sr; if (ph >= 1) ph -= 1;
    const g = ph < 0.4 ? 0.5 - 0.5 * Math.cos(Math.PI * ph / 0.4) : ph < 0.56 ? Math.cos(Math.PI * (ph - 0.4) / 0.32) : 0;
    src[i] = ((g - gp) * 6 + (rnd() * 2 - 1) * breath) * AV[i]; gp = g;
    fr[i] *= AN[i];
  }
  const out = resTV(src, F[0], 90, sr), f2 = resTV(src, F[1], 110, sr), f3 = resTV(src, F[2], 170, sr), fz = resTV(fr, NF, 1400, sr);
  const v = norm(out.map((x, i) => x + 0.55 * f2[i] + 0.3 * f3[i]), 1);
  norm(fz, 0.35);
  for (let i = 0; i < n; i++) v[i] += fz[i];
  return v;
}
/** unintelligible shouted phrase that follows the rhythm and vowels of the Russian text */
function genVocal(sr, text, o = {}) {
  const segs = [];
  for (const ch of text.toLowerCase()) {
    if (VOW[ch]) segs.push({ k: 'v', ch, d: rr(0.075, 0.11) });
    else if (SIB[ch]) segs.push({ k: 's', ch, d: rr(0.05, 0.075) });
    else if (PLO[ch]) segs.push({ k: 'p', ch, d: rr(0.045, 0.065) });
    else if (SON.includes(ch)) segs.push({ k: 'n', ch, d: rr(0.04, 0.06) });
    else if (ch === ' ' || ch === '-') segs.push({ k: 'g', d: ch === '-' ? 0.015 : 0.03 });
  }
  let vs = segs.filter(x => x.k === 'v');
  if (!vs.length) { segs.push({ k: 'v', ch: 'а', d: 0.15 }); vs = segs.filter(x => x.k === 'v'); }
  if (o.cry) vs.forEach(v => { v.d *= 2.2; });
  vs[vs.length - 1].d *= o.cry ? 1.8 : 1.7;
  const total = segs.reduce((a, x) => a + x.d, 0) + 0.1, n = Math.ceil(total * sr);
  const F = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], AV = new Float32Array(n), AN = new Float32Array(n), NF = new Float32Array(n).fill(3000);
  let i = 0, last = VOW['а'];
  for (const sg of segs) {
    const m = Math.round(sg.d * sr);
    for (let j = 0; j < m && i < n; j++, i++) {
      let fm = last, av = 0, an = 0, nf = 3000;
      if (sg.k === 'v') { fm = VOW[sg.ch]; av = 1; an = 0.03; }
      else if (sg.k === 's') { av = 'зж'.includes(sg.ch) ? 0.35 : 0; an = 0.5; nf = SIB[sg.ch]; }
      else if (sg.k === 'p') { const rel = j / m > 0.7; av = 'бдг'.includes(sg.ch) && !rel ? 0.15 : 0; an = rel ? 0.8 : 0; nf = PLO[sg.ch]; }
      else if (sg.k === 'n') { fm = [300, 'мн'.includes(sg.ch) ? 1200 : 1000, 2400]; av = 0.6 * (sg.ch === 'р' ? 0.6 + 0.4 * Math.sin(TAU * 26 * j / sr) : 1); }
      F[0][i] = fm[0] * (o.cry ? 1.1 : 1.15); F[1][i] = fm[1]; F[2][i] = fm[2]; AV[i] = av; AN[i] = an; NF[i] = nf;
    }
    if (sg.k === 'v') last = VOW[sg.ch];
  }
  for (; i < n; i++) { F[0][i] = last[0]; F[1][i] = last[1]; F[2][i] = last[2]; }
  F.forEach(a => smooth(a, 0.012, sr)); smooth(AV, 0.008, sr); smooth(AN, 0.004, sr); smooth(NF, 0.004, sr);
  const f0 = o.f0 || 130, q = /\?/.test(text);
  const contour = i => {
    const u = i / n;
    if (o.death) return f0 * (1.2 - 0.6 * u);
    if (o.cry) return f0 * (u < 0.2 ? 1.1 + 0.35 * u / 0.2 : 1.45 - 0.6 * (u - 0.2));
    return f0 * (1.25 + 0.12 * Math.sin(Math.PI * Math.min(1, u * 1.3)) + (q ? 0.35 * u * u * u : -0.25 * u * u));
  };
  const out = synthVoice(sr, n, contour, F, AV, AN, NF, o.death ? 0.15 : 0.05);
  lp1(out, o.lp || 3400, sr, 2); hp1(out, 90, sr);
  for (let k = 0; k < 200 && k < n; k++) { out[k] *= k / 200; out[n - 1 - k] *= k / 200; }
  return norm(out, 0.9);
}
function genGrunt(sr) {
  const n = Math.floor(sr * rr(0.16, 0.24)), F = [new Float32Array(n).fill(rr(520, 600)), new Float32Array(n).fill(rr(1350, 1550)), new Float32Array(n).fill(2500)];
  const AV = new Float32Array(n), AN = new Float32Array(n), NF = new Float32Array(n).fill(1500);
  for (let i = 0; i < n; i++) { const t = i / n; AV[i] = Math.min(1, t * 12) * Math.pow(1 - t, 1.5); AN[i] = AV[i] * 0.3; }
  const f0 = rr(105, 125), out = synthVoice(sr, n, i => f0 * (1.1 - 0.25 * i / n), F, AV, AN, NF, 0.25);
  lp1(out, 2500, sr, 2);
  return norm(out, 0.9);
}
function genBreath(sr, inhale, effort) {
  const dur = inhale ? rr(0.45, 0.65) : rr(0.4, 0.6), n = Math.floor(sr * dur), src = white(n);
  for (let i = 0; i < n; i++) { const t = i / n; src[i] *= inhale ? Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 1.5) : Math.min(1, t / 0.08) * Math.pow(1 - t, 1.3); }
  const fm = inhale ? [500, 1700, 2600] : [650, 1200, 2500];
  const a = resTV(src, fm[0], 200, sr), b = resTV(src, fm[1], 250, sr), c = resTV(src, fm[2], 300, sr), h = hp1(src.slice(), 2500, sr);
  const out = a.map((x, i) => x + 0.6 * b[i] + 0.35 * c[i] + 0.06 * h[i]);
  if (!inhale && effort) {
    const F = fm.map(f => new Float32Array(n).fill(f)), AV = new Float32Array(n), AN = new Float32Array(n), NF = new Float32Array(n).fill(1500);
    for (let i = 0; i < n; i++) { const t = i / n; AV[i] = Math.min(1, t / 0.08) * Math.pow(1 - t, 2); }
    const v = synthVoice(sr, n, () => 100, F, AV, AN, NF, 0.1);
    norm(out, 1); mix(out, v, 0, effort * 0.3);
  }
  lp1(out, 4000, sr);
  return norm(out, 0.8);
}

// ---- ambience
function genRoar(sr, sec) {                                                       // distant rain roar on the whole port (stereo)
  const xf = Math.round(0.3 * sr), n = Math.floor(sec * sr) + xf;
  return normAll([0, 1].map(() => {
    const a = pink(n), b = brown(n), m = drift(n, sr, 0.3);
    for (let i = 0; i < n; i++) a[i] = (a[i] + b[i] * 0.4) * (1 + 0.15 * m[i]);
    biquad(a, 'lp', 1100, 0.6, sr); hp1(a, 40, sr);
    return loopify(a, xf);
  }), 0.9);
}
function genHiss(sr, sec) {                                                       // mid-field rain: noise + dense droplet clicks (stereo)
  const xf = Math.round(0.25 * sr), n = Math.floor(sec * sr) + xf;
  return normAll([0, 1].map(() => {
    const a = white(n); for (let i = 0; i < n; i++) a[i] *= 0.3;
    const cl = new Float32Array(n);
    for (let k = 0, nc = Math.floor(sec * 1600); k < nc; k++) {
      const i0 = (rnd() * (n - 400)) | 0, dec = rr(0.0003, 0.0015) * sr, m = Math.exp(-1 / dec);
      for (let j = 0, e = rnd() * rnd() * rnd(); j < dec * 5; j++, e *= m) cl[i0 + j] += (rnd() * 2 - 1) * e;
    }
    mix(a, cl, 0, 0.9);
    biquad(a, 'hp', 1300, 0.7, sr); biquad(a, 'lp', 9500, 0.7, sr);
    const m = drift(n, sr, 0.8); for (let i = 0; i < n; i++) a[i] *= 1 + 0.12 * m[i];
    return loopify(a, xf);
  }), 0.9);
}
function genDrops(sr, sec) {                                                      // close drops on steel containers, tarps and puddles (stereo)
  const xf = Math.round(0.2 * sr), n = Math.floor(sec * sr) + xf, L = new Float32Array(n), R = new Float32Array(n);
  for (let k = 0, nd = Math.floor(sec * 75); k < nd; k++) {
    const ev = new Float32Array(Math.floor(sr * 0.09)), ty = rnd(), amp = Math.pow(rnd(), 2.5);
    if (ty < 0.45) { const f = rr(1400, 5200); mode(ev, 0, f, rr(0.006, 0.03), 0.5, sr); mode(ev, 0, f * rr(2.3, 2.9), rr(0.004, 0.015), 0.25, sr); burst(ev, 0, 0.0001, 0.0004, 0.3, sr); }
    else if (ty < 0.75) { burst(ev, 0, 0.0002, 0.0015, 0.6, sr, s => lp1(s, rr(1500, 3500), sr)); mode(ev, 0, rr(500, 1100), 0.004, 0.3, sr); }
    else bubble(ev, 0, rr(900, 3200), rr(0.002, 0.006), 0.5, sr);
    const p = rr(-1, 1), at = (rnd() * (n - ev.length)) | 0;
    mix(L, ev, at, amp * Math.sqrt((1 - p) / 2)); mix(R, ev, at, amp * Math.sqrt((1 + p) / 2));
  }
  return normAll([loopify(L, xf), loopify(R, xf)], 0.9);
}
function genLapping(sr, sec) {                                                    // water slapping against the quay wall (stereo)
  const xf = Math.round(0.4 * sr), n = Math.floor(sec * sr) + xf;
  return normAll([0, 1].map(() => {
    const out = brown(n); lp1(out, 300, sr, 2); for (let i = 0; i < n; i++) out[i] *= 0.25;
    for (let t = rr(0, 1.5); t < sec + 0.3; t += rr(1.6, 4.2)) {
      const rise = rr(0.25, 0.45), fall = rr(0.8, 1.6), m = Math.floor((rise + fall * 3) * sr), i0 = Math.round(t * sr);
      const s = pink(m), h = white(m);
      for (let i = 0; i < m; i++) { const u = i / sr, e = u < rise ? Math.sin(Math.PI / 2 * u / rise) : Math.exp(-(u - rise) / fall); s[i] *= e; h[i] *= e * e * 0.12; }
      lp1(s, rr(400, 700), sr, 2); biquad(h, 'bp', 1200, 0.8, sr);
      const a = rr(0.4, 1); mix(out, s, i0, a); mix(out, h, i0, a);
      const pk = i0 + Math.round(rise * sr);
      bubble(out, pk, rr(140, 380), rr(0.01, 0.03), a * 0.5, sr);
      for (let k = 0, nb = 3 + (rnd() * 6 | 0); k < nb; k++) bubble(out, pk + Math.round(rr(0, 0.45) * sr), rr(300, 1100), rr(0.004, 0.012), a * rr(0.05, 0.2), sr);
    }
    hp1(out, 30, sr);
    return loopify(out, xf);
  }), 0.9);
}
function genEngine(sr) {                                                          // moored ship's diesel generator, ~600 rpm, plus 50 Hz hum (mono)
  const per = sr / 30, cyc = 243, n = Math.round(per * cyc), xf = Math.round(per * 3), out = new Float32Array(n);
  const pulse = new Float32Array(Math.round(0.03 * sr));
  for (let k = 0; k < cyc; k++) {
    pulse.fill(0); burst(pulse, 0, 0.0005, 0.004, rr(0.7, 1), sr); fried(pulse, 0, 0.6 * rr(0.8, 1.1), 0.006, 1.4, sr);
    if (k % 6 === 3) for (let i = 0; i < pulse.length; i++) pulse[i] *= 0.8;          // slightly weak cylinder
    mix(out, pulse, Math.round(k * per));
  }
  biquad(out, 'lp', 220, 0.7, sr); biquad(out, 'lp', 260, 0.7, sr);
  norm(out, 1);
  for (let i = 0; i < n; i++) { const t = i / sr; out[i] += 0.12 * Math.sin(TAU * 50 * t) + 0.08 * Math.sin(TAU * 100 * t + 1) + 0.03 * Math.sin(TAU * 150 * t + 2); }
  return norm(loopify(out, xf), 0.9);
}
function genCreak(sr) {                                                           // crane / lashing-bar stick-slip groan
  const dur = rr(1.6, 2.8), n = Math.floor(dur * sr), src = new Float32Array(n), ph = rnd() * TAU, sp = rr(0.3, 0.8);
  for (let t = rr(0, 0.05); t < dur - 0.05;) {
    const e = Math.sin(Math.PI * t / dur), rate = 15 + 70 * (0.5 + 0.5 * Math.sin(TAU * sp * t + ph)) * rr(0.8, 1.2);
    src[Math.round(t * sr)] += e * rr(0.5, 1) * (rnd() < 0.5 ? 1 : -1); t += 1 / rate;
  }
  const out = new Float32Array(n);
  for (const [f, g] of [[rr(280, 420), 1], [rr(650, 900), 0.7], [rr(1300, 1700), 0.4], [rr(2200, 2600), 0.2]]) mix(out, biquad(src.slice(), 'bp', f, f / rr(20, 40), sr), 0, g);
  lp1(out, 2500, sr);
  return norm(out, 0.9);
}
function genClang(sr) {                                                           // distant container corner casting struck
  const out = new Float32Array(Math.floor(sr * 3));
  [[rr(95, 120), 1.2], [rr(230, 260), 0.9], [rr(430, 470), 0.7], [rr(640, 700), 0.5], [rr(980, 1050), 0.35], [rr(1400, 1500), 0.25], [rr(2050, 2200), 0.15]]
    .forEach(([f, tau]) => mode(out, 10, f, tau * rr(0.7, 1.1), rr(0.3, 1), sr));
  fried(out, 0, 1.2, 0.004, 1.5, sr);
  lp1(out, 2200, sr);
  return norm(out, 0.8);
}
function genDrip(sr) {
  const out = new Float32Array(Math.floor(sr * 0.1));
  if (rnd() < 0.6) { const f = rr(2000, 6000); mode(out, 0, f, rr(0.01, 0.04), 0.6, sr); mode(out, 0, f * rr(2.2, 2.8), 0.008, 0.2, sr); }
  else bubble(out, 0, rr(1200, 3500), rr(0.003, 0.008), 0.6, sr);
  return norm(out, 0.8);
}
function genPowerDown(sr) {                                                       // jammer node: arcing, relay, hum collapse, fan spin-down
  const dur = 2.6, n = Math.floor(sr * dur), out = new Float32Array(n);
  clink(out, 0, [650, 1400, 2600], 0.025, 0.7, sr); fried(out, 0, 0.5, 0.003, 1.5, sr);
  for (let k = 0; k < 70; k++) {
    const at = 0.02 + 0.8 * Math.pow(rnd(), 1.7), len = rr(0.002, 0.03), m = Math.round(len * sr), i0 = Math.round(at * sr), s = white(m), amp = Math.pow(rnd(), 1.5);
    for (let i = 0; i < m; i++) { const t = (i0 + i) / sr; s[i] *= amp * (0.3 + 0.7 * Math.pow(Math.abs(Math.sin(TAU * 100 * t)), 8)) * Math.exp(-i / (m * 0.5)); }
    biquad(s, 'hp', 1200, 0.7, sr); mix(out, s, i0);
  }
  const fan = white(n);
  for (let i = 0; i < n; i++) fan[i] *= 0.6 * Math.exp(-(i / sr) / 1.2);
  mix(out, resTV(fan, i => 520 * Math.exp(-(i / sr) / 0.7) + 15, 60, sr), 0, 4);
  for (let i = 0; i < n; i++) {
    const t = i / sr, e = (t < 0.15 ? 1 : Math.exp(-(t - 0.15) / 0.35)) * 0.12;
    out[i] += e * (Math.sin(TAU * 100 * t) + 0.55 * Math.sin(TAU * 200 * t) + 0.3 * Math.sin(TAU * 300 * t) + 0.18 * Math.sin(TAU * 400 * t));
  }
  mode(out, Math.round(rr(1.9, 2.2) * sr), 3200, 0.005, 0.15, sr);
  hp1(out, 40, sr);
  return norm(out, 0.9);
}
function genBoat(sr) {                                                            // extraction RIB: outboard approaches, throttles down, bumps the fender
  const dur = 7, n = Math.floor(dur * sr), src = new Float32Array(n);
  const fq = t => t < 4.2 ? lerp(70, 88, t / 4.2) : t < 5 ? lerp(88, 28, (t - 4.2) / 0.8) : 28;
  const amp = t => t < 4.2 ? lerp(0.08, 1, Math.pow(t / 4.2, 1.6)) : t < 5 ? lerp(1, 0.5, (t - 4.2) / 0.8) : 0.5 * Math.max(0, 1 - (t - 6.3) / 0.7);
  for (let t = 0; t < dur;) { const i = Math.round(t * sr); burst(src, i, 0.0003, 0.003, amp(t) * rr(0.8, 1), sr); t += 1 / fq(t); }
  lp1(src, i => 350 + 2400 * amp(i / sr), sr, 2);
  const w = pink(n);
  for (let i = 0; i < n; i++) { const t = i / sr; w[i] *= 0.35 * (t < 5 ? amp(t) : Math.max(0, 0.3 - (t - 5) * 0.12)); }
  biquad(w, 'bp', 900, 0.6, sr); mix(src, w);
  for (let t = 1; t < 4.8; t += rr(0.25, 0.7)) fried(src, Math.round(t * sr), 0.3 * amp(t), 0.01, 1.4, sr);
  burst(src, Math.round(5.8 * sr), 0.01, 0.06, 0.8, sr, s => lp1(s, 150, sr, 2));
  hp1(src, 30, sr);
  return norm(src, 0.9);
}
function genRadio(sr) {                                                           // radio squelch burst
  const out = new Float32Array(Math.floor(sr * 0.9));
  clink(out, 0, [1800, 3100], 0.004, 0.5, sr);
  const s = white(Math.round(0.45 * sr));
  for (let i = 0; i < s.length; i++) { const t = i / sr; s[i] *= (t < 0.01 ? t / 0.01 : 1) * (1 - t / 0.45) * (0.6 + 0.4 * Math.sin(TAU * 7 * t)); }
  biquad(s, 'bp', 1800, 1.4, sr); mix(out, s, Math.round(0.02 * sr), 0.8);
  clink(out, Math.round(0.5 * sr), [1800, 3100], 0.004, 0.5, sr);
  return norm(out, 0.6);
}
function genRing(sr) {
  const n = Math.floor(sr * 4), out = new Float32Array(n), f = rr(3900, 4400);
  for (let i = 0; i < n; i++) { const t = i / sr; out[i] = Math.sin(TAU * f * t) * Math.min(1, t / 0.3) * Math.exp(-t / 1.4); }
  return norm(out, 0.6);
}

// ============================================================ voice lines
const LINES = {
  contact: ['Контакт!', 'Вижу его!', 'Он там!'],
  engage: ['Огонь!', 'Прикрой!', 'Обходи слева!'],
  reload: ['Перезаряжаю!'],
  hit: ['А-а!', 'Я ранен!'],
  death: ['А-а…'],
  search: ['Где он?', 'Тихо...'],
  reinforce: ['Все сюда!'],
};
// p: chance to bark when asked; cd: per-kind cooldown (s); urgent: ignores the global/per-guard gaps
const KINDS = {
  contact: { p: 0.9, cd: 2.5 }, engage: { p: 0.3, cd: 4.5 }, reload: { p: 0.8, cd: 4 }, search: { p: 0.8, cd: 6 },
  hit: { p: 0.85, cd: 0, urgent: true }, death: { p: 0.75, cd: 0, urgent: true }, reinforce: { p: 1, cd: 0, urgent: true },
};
const MAX_VOICE_DIST = 35;

// ============================================================ engine
export class Audio {
  constructor() {
    this.ctx = null; this.ready = false; this.B = null; this.ambOn = false;
    this.lis = null; this.beat = -99; this.lh = 0; this.env = null;
    this.guards = new Map(); this.kindLast = {}; this.lastBark = -99; this.speaking = false;
    this.ru = [];
    try { this.speech = (typeof window !== 'undefined' && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') ? window.speechSynthesis : null; } catch (_) { this.speech = null; }
    if (this.speech) {
      const upd = () => this.refreshVoices(); upd();
      try { this.speech.addEventListener('voiceschanged', upd); } catch (_) { this.speech.onvoiceschanged = upd; }
    }
  }

  /** Only on-device Russian voices. Network voices (localService false/undefined) are never used. */
  refreshVoices() {
    try { this.ru = this.speech.getVoices().filter(v => v && v.localService === true && /^ru([-_]|$)/i.test(v.lang || '')); } catch (_) { this.ru = []; }
    for (const st of this.guards.values()) st.voice = null;
  }

  /** Must be called from a user gesture (start button) – creates / resumes the AudioContext (iOS). */
  start(opts = {}) {
    try {
      if (!this.ctx) this.ctx = opts.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const c = this.ctx;
      if (!opts.ctx && c.state !== 'running' && c.resume) { const p = c.resume(); if (p && p.catch) p.catch(() => {}); }
      this.halt(); this.guards.clear(); this.kindLast = {}; this.lastBark = -99; this.endLP = 0;
      this.unlockSpeech();
      if (this.ready) { this.tone.frequency.setTargetAtTime(20000, c.currentTime, 0.2); this._fc = 20000; this.amb.gain.setTargetAtTime(1, c.currentTime, 0.5); return; }
      this.out = c.createDynamicsCompressor();
      this.out.threshold.value = -10; this.out.knee.value = 8; this.out.ratio.value = 6; this.out.attack.value = 0.002; this.out.release.value = 0.25;
      this.tone = c.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 20000; this.tone.Q.value = 0.5; this._fc = 20000;
      this.master = c.createGain(); this.master.gain.value = 0.85;
      this.master.connect(this.tone); this.tone.connect(this.out); this.out.connect(c.destination);
      this.amb = c.createGain(); this.amb.connect(this.master);
      this.verbIn = c.createGain(); this.verb = c.createConvolver(); this.verbOut = c.createGain(); this.verbOut.gain.value = 0.5;
      this.verbIn.connect(this.verb); this.verb.connect(this.verbOut); this.verbOut.connect(this.master);
      this.buildCore();
      this.dirPan = [0, 0.75, 0, -0.75].map(p => { const n = this.panNode(p); n.connect(this.master); return n; });
      this.ready = true;
      this.wantAmb = opts.ambience !== false;
      if (opts.ctx) this.buildDeferred(true); else setTimeout(() => this.buildDeferred(false), 40);
      if (opts.timers !== false) {
        this.timer = setInterval(() => this.tick(), 100);
        document.addEventListener('visibilitychange', () => {
          if (!this.ctx || !this.ctx.suspend) return;
          if (document.hidden) { this.ctx.suspend(); this.halt(); } else { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
        });
        // iOS can put the context into 'interrupted' (calls, Siri): resume on the next touch
        addEventListener('pointerdown', () => { if (this.ctx && this.ctx.state !== 'running' && !document.hidden) { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } }, { passive: true });
      }
    } catch (e) { console.warn('[audio] disabled:', e); this.ready = false; }
  }

  ok() { return this.ready && this.B; }

  buildCore() {
    const sr = this.ctx.sampleRate, b = (a, rate = sr) => this.buf([a], rate), b2 = (chs, rate = sr) => this.buf(chs, rate);
    const n = (k, f) => Array.from({ length: k }, f);
    // only what the first seconds of play need; everything else follows in buildDeferred()
    this.B = {
      rifle: n(3, () => b(genRifle(sr))),
      casing: n(6, () => b(genCasing(sr))),
      snap: n(3, () => b(genSnap(sr))),
      step: n(8, () => b(genStep(sr))),
      gear: n(5, () => b(genGear(sr))),
      release: b(genReload(sr, 'release')), magOut: b(genReload(sr, 'out')), pouch: b(genReload(sr, 'pouch')),
      magIn: b(genReload(sr, 'in')), bolt: b(genReload(sr, 'bolt')), dry: b(genReload(sr, 'dry')),
      tick: [b(genTick(sr, false)), b(genTick(sr, true))],
    };
    void b2;
  }

  /** Remaining buffers, generated in small steps after start so the start-button handler stays short. */
  buildDeferred(sync) {
    const c = this.ctx, sr = c.sampleRate, B = this.B, n = (k, f) => Array.from({ length: k }, f);
    const b = a => this.buf([a], sr);
    const steps = [
      () => { B.echoNear = b(genEcho(sr, 3500)); B.echoFar = b(genEcho(sr, 1100)); this.verb.buffer = this.buf(genIR(sr), sr); },
      () => { B.roll = n(2, () => this.buf(genRoll(sr), sr)); },
      () => { B.ak74 = n(3, () => b(genRifle(sr, { len: 0.45, heavy: 0.25, mech: 0, crack: 0.3 }))); B.akm = n(3, () => b(genRifle(sr, { len: 0.45, heavy: 0.6, mech: 0, crack: 0.3 }))); },
      () => { B.hitMetal = n(3, () => b(genImpact(sr, 'metal'))); B.hitGround = n(3, () => b(genImpact(sr, 'ground'))); B.hitFlesh = n(2, () => b(genImpact(sr, 'flesh'))); B.rico = n(2, () => b(genRicochet(sr))); B.thud = n(3, () => b(genThud(sr))); B.rifle.push(b(genRifle(sr))); },
      () => { B.grunt = n(4, () => this.buf([genGrunt(LOW)], LOW)); B.heart = this.buf([genHeart(LOW)], LOW); },
      () => { B.inhale = n(3, () => this.buf([genBreath(LOW, true, 0)], LOW)); B.exhale = n(3, () => this.buf([genBreath(LOW, false, 0.6)], LOW)); },
      () => { B.power = this.buf([genPowerDown(LOW)], LOW); },
      () => { B.roarBuf = this.buf(genRoar(LOW, 10), LOW); },
      () => { B.hissBuf = this.buf(genHiss(sr, 9.3), sr); },
      () => { B.dropBuf = this.buf(genDrops(sr, 11.7), sr); },
      () => { B.lapBuf = this.buf(genLapping(LOW, 13.1), LOW); },
      () => { B.engBuf = this.buf([genEngine(LOW)], LOW); B.creak = [0, 1, 2].map(() => this.buf([genCreak(LOW)], LOW)); },
      () => { B.clang = [0, 1].map(() => this.buf([genClang(LOW)], LOW)); B.drip = [0, 1, 2, 3, 4, 5].map(() => this.buf([genDrip(sr)], sr)); },
      () => { B.boat = this.buf([genBoat(LOW)], LOW); B.radio = this.buf([genRadio(LOW)], LOW); B.ring = this.buf([genRing(sr)], sr); },
    ];
    const run = i => {
      if (i < steps.length) { try { steps[i](); } catch (e) { console.warn('[audio] step', i, e); } if (sync) run(i + 1); else setTimeout(() => run(i + 1), i < 4 ? 10 : 60); }
      else if (this.wantAmb) this.buildAmbience();
    };
    run(0);
  }

  buildAmbience() {
    if (this.ambOn || !this.ready || !this.B.drip) return;
    try {
      const c = this.ctx, B = this.B;
      const loop = (buf, gain, rate = 1, filt) => {
        const s = c.createBufferSource(), g = c.createGain(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; g.gain.value = gain;
        let n = s; if (filt) { s.connect(filt); n = filt; } n.connect(g); g.connect(this.amb);
        s.start(c.currentTime + 0.05, rnd() * buf.duration * 0.9); return g;
      };
      const bq = (type, f, q) => { const x = c.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
      this.aRoar = loop(B.roarBuf, 0.16);
      this.aCity = loop(B.roarBuf, 0.05, 0.71, bq('lowpass', 180, 0.5));            // far city / traffic rumble
      this.aHiss = loop(B.hissBuf, 0.05);
      this.aDrop = loop(B.dropBuf, 0.1);
      this.aLap = loop(B.lapBuf, 0.12);
      this.windF = bq('bandpass', 400, 0.7);
      this.aWind = loop(B.roarBuf, 0.01, 1.37, this.windF);
      const eng = loop(B.engBuf, 0.05);
      try { eng.disconnect(); const p = this.panNode(-0.45); eng.connect(p); p.connect(this.amb); const s = c.createGain(); s.gain.value = 0.3; eng.connect(s); s.connect(this.verbIn); } catch (_) {}
      const tt = wall();
      this.nx = { gust: tt, creak: tt + rr(8, 25), clang: tt + rr(20, 50), horn: tt + rr(15, 35), car: tt + rr(5, 15) };
      this.ambOn = true;
    } catch (e) { console.warn('[audio] ambience disabled:', e); }
  }

  buf(chs, rate) { const b = this.ctx.createBuffer(chs.length, chs[0].length, rate); chs.forEach((d, i) => b.getChannelData(i).set(d)); return b; }

  panNode(p) {
    const c = this.ctx;
    if (c.createStereoPanner) { const n = c.createStereoPanner(); n.pan.value = clamp(p || 0, -1, 1); return n; }
    return c.createGain(); // very old WebKit: no stereo panner – mono is an acceptable fallback
  }

  /** 3D source in world coordinates (same axes as the game: x right, y up, -z forward at yaw 0) */
  posNode(pos) {
    const c = this.ctx, p = c.createPanner();
    p.panningModel = MOBILE ? 'equalpower' : 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1; p.rolloffFactor = 0; // level is handled explicitly
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1.5; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y ?? 1.5, pos.z);
    return p;
  }

  /** Called every simulation frame: listener pose (3D audio) and a heartbeat (stale = paused/ended). */
  listener(x, y, z, yaw) {
    this.beat = wall(); this.lis = { x, y, z, yaw };
    if (!this.ready) return;
    try {
      const L = this.ctx.listener, fx = Math.sin(yaw), fz = -Math.cos(yaw);
      if (L.positionX) { L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z; L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      else { L.setPosition(x, y, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
    } catch (_) {}
  }

  relPan(x, z) { const l = this.lis; if (!l) return 0; return Math.sin(Math.atan2(x - l.x, -(z - l.z)) - l.yaw); }

  play(buffer, o = {}) {
    const c = this.ctx; if (!buffer) return null;
    const s = c.createBufferSource(); s.buffer = buffer;
    if (o.rate && o.rate !== 1) s.playbackRate.value = o.rate;
    const nodes = [s]; let n = s;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.6; n.connect(f); n = f; nodes.push(f); }
    const g = c.createGain(); g.gain.value = o.gain ?? 1; n.connect(g); n = g; nodes.push(g);
    if (o.pos && this.lis) { const p = this.posNode(o.pos); n.connect(p); n = p; nodes.push(p); }
    else if (o.pan || (o.pos && !this.lis)) { const p = this.panNode(o.pan ?? 0); n.connect(p); n = p; nodes.push(p); }
    n.connect(o.dest || this.master);
    if (o.send) { const sg = c.createGain(); sg.gain.value = o.send; n.connect(sg); sg.connect(this.verbIn); nodes.push(sg); }
    s.onended = () => { for (const x of nodes) { try { x.disconnect(); } catch (_) {} } };
    s.start(Math.max(c.currentTime, o.at ?? 0), o.offset || 0);
    return s;
  }

  // ---------------------------------------------------------------- player weapon
  /** Ak 5C report. o.walls = distances (m) to the nearest wall [front, right, back, left]; 0 = open. */
  gunshot(o = {}) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime + 0.003, B = this.B;
    if (o.walls) this.env = o.walls;
    this.play(pick(B.rifle), { at: t, gain: 0.85, rate: rr(0.985, 1.015), send: 0.3 });
    this.echoes(t, this.env || [28, 11, 40, 16], 1, false);
    this.play(pick(B.roll), { at: t + 0.02, gain: 0.4, rate: rr(0.96, 1.04) });
    this.casings(t + rr(0.42, 0.6));
  }

  /** discrete slap-back echoes off the surrounding walls + flutter between parallel container rows */
  echoes(t, w, level, dark) {
    const B = this.B;
    w.forEach((d, i) => {
      if (!(d > 1.2 && d < 70)) return;
      const g = level * 0.75 * 5 / (5 + 2 * d) * (i === 2 ? 0.8 : 1);
      this.play(d < 14 && !dark ? B.echoNear : B.echoFar, { at: t + 2 * d / 343, gain: g, dest: this.dirPan[i], rate: rr(0.97, 1.03) });
    });
    const l = w[3], r = w[1];
    if (l > 1.2 && r > 1.2 && l + r < 40) {
      for (let k = 1; k <= 3; k++) this.play(B.echoFar, { at: t + (2 * (l + r) * k + 2 * Math.min(l, r)) / 343, gain: level * 0.5 * Math.pow(0.55, k) * 5 / (5 + l + r), dest: this.dirPan[k % 2 ? 1 : 3] });
    }
  }

  /** brass case(s) landing on wet concrete to the right; called automatically by gunshot() */
  casings(at) {
    if (!this.ok()) return;
    const tt = wall(); if (tt - (this._cas || 0) < 0.07) return; this._cas = tt;
    this.play(pick(this.B.casing), { at: at ?? this.ctx.currentTime + 0.5, gain: rr(0.05, 0.09), pan: rr(0.2, 0.55), rate: rr(0.94, 1.06) });
  }

  dryFire() { if (this.ok()) this.play(this.B.dry, { gain: 0.25, pan: 0.05 }); }

  reload(phase) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime, B = this.B;
    if (phase === 'out') {
      this.play(B.release, { at: t, gain: 0.22, pan: 0.1 });
      this.play(B.magOut, { at: t + 0.09, gain: 0.3, pan: 0.05 });
      this.play(B.pouch, { at: t + 0.38, gain: 0.2, pan: -0.25 });
    }
    if (phase === 'in') this.play(B.magIn, { at: t, gain: 0.4, pan: 0.05 });
    if (phase === 'bolt') this.play(B.bolt, { at: t, gain: 0.42, pan: 0.15, send: 0.05 });
  }

  // ---------------------------------------------------------------- enemy fire
  /** distance (m), panv (-1..1 fallback), o = {x, y, z, guardId} for 3D placement */
  remoteShot(distance, panv = 0, o = {}) {
    if (!this.ok()) return;
    const B = this.B, d = Math.max(1, distance), t = this.ctx.currentTime + d / 343;
    const akm = ((o.guardId ?? 0) % 3) === 1;
    const g = 0.8 * Math.pow(3 / (3 + d), 0.85), lp = clamp(16000 * Math.exp(-d / 45), 1800, 16000);
    const pos = o.x != null ? { x: o.x, y: o.y ?? 1.45, z: o.z } : null;
    this.play(pick(akm ? B.akm : B.ak74), { at: t, gain: g, lp, pos, pan: panv, send: 0.28, rate: rr(0.97, 1.03) });
    this.play(pick(B.roll), { at: t + 0.03, gain: 0.3 * Math.sqrt(6 / (6 + d)), rate: rr(0.9, 1.05) });
    if (this.env) this.echoes(t, this.env, g * 0.6, true);
    // cosmetic magazine count: every 6-10 shots the guard shouts that he is reloading
    if (o.guardId != null && o.guardId >= 0) {
      const st = this.guard(o.guardId);
      if (++st.shots >= st.mag) {
        st.shots = 0; st.mag = 6 + (rnd() * 5 | 0);
        setTimeout(() => {
          if (!this.live()) return;
          this.voice('reload', { guardId: o.guardId, distance: d, x: o.x, z: o.z });
          if (pos) this.play(B.magIn, { at: this.ctx.currentTime + 0.9, gain: 0.25 * g, lp: lp * 0.5, pos });
        }, 400);
      }
    }
  }

  /** supersonic crack of a round passing close – arrives before the muzzle report */
  bulletCrack(panv = 0, distance = 15) {
    if (!this.ok()) return;
    this.play(pick(this.B.snap), { at: this.ctx.currentTime + Math.max(0, distance) / 750, gain: 0.5, pan: clamp(panv * 0.7 + rr(-0.3, 0.3), -1, 1), send: 0.2 });
  }

  impact(kind = 'metal', dist = 5, panv = 0) {
    if (!this.ok()) return;
    const B = this.B, d = Math.max(0.5, dist), t = this.ctx.currentTime + d / 343, g = Math.min(0.5, 3 / (d + 3)), lp = clamp(18000 * Math.exp(-d / 40), 2500, 18000);
    const buf = kind === 'metal' ? pick(B.hitMetal) : kind === 'flesh' ? pick(B.hitFlesh) : pick(B.hitGround);
    this.play(buf, { at: t, gain: g, lp, pan: panv, send: 0.25 });
    if (kind === 'metal' && rnd() < 0.18) this.play(pick(B.rico), { at: t + 0.01, gain: g * 0.45, lp, pan: clamp(panv + rr(-0.5, 0.5), -1, 1), send: 0.3 });
  }

  hitTick(kill = false) { if (this.ok()) this.play(this.B.tick[kill ? 1 : 0], { gain: kill ? 0.12 : 0.07 }); }

  // ---------------------------------------------------------------- movement
  /** player footstep; o = {crouch} (a boolean second argument from older callers is ignored) */
  footstep(run, o = {}) {
    if (!this.ok()) return;
    if (typeof o !== 'object' || !o) o = {};
    const B = this.B, t = this.ctx.currentTime, side = (this._side = -(this._side || 1));
    let i; do i = (rnd() * B.step.length) | 0; while (i === this._lastStep); this._lastStep = i;
    const g = (run ? 0.32 : o.crouch ? 0.1 : 0.2) * rr(0.8, 1.1);
    this.play(B.step[i], { at: t, gain: g, rate: rr(0.92, 1.08) * (run ? 1.05 : 1), pan: side * 0.12, lp: o.crouch ? 3500 : 0 });
    if (rnd() < (run ? 0.75 : o.crouch ? 0.1 : 0.3)) this.play(pick(B.gear), { at: t + rr(0.01, 0.06), gain: (run ? 0.13 : 0.07) * rr(0.6, 1), pan: rr(-0.3, 0.3) });
  }

  /** guard footfall: o = {x, z, distance, run} */
  guardStep(o = {}) {
    if (!this.ok() || !this.lis) return;
    const tt = wall(), d = Math.max(1, o.distance ?? 10);
    if (d > 24 || tt - (this._gs || 0) < 0.06) return; this._gs = tt;
    const B = this.B, t = this.ctx.currentTime + d / 343, lp = clamp(9000 * Math.exp(-d / 18), 1200, 9000), pos = { x: o.x, y: 0.1, z: o.z };
    this.play(pick(B.step), { at: t, gain: (o.run ? 0.3 : 0.18) * 2.5 / (2.5 + d), lp, pos, rate: rr(0.86, 1.0) });
    if (o.run && rnd() < 0.5) this.play(pick(B.gear), { at: t + 0.02, gain: 0.1 * 2.5 / (2.5 + d), lp, pos: { x: o.x, y: 1.1, z: o.z } });
  }

  // ---------------------------------------------------------------- player body
  hurt() {
    if (!this.ok()) return;
    const B = this.B, t = this.ctx.currentTime;
    this.play(pick(B.thud), { at: t, gain: 0.45 });
    if (rnd() < 0.6) this.play(pick(B.grunt), { at: t + rr(0.03, 0.08), gain: 0.16, rate: rr(0.95, 1.05) });
    else this.play(pick(B.exhale), { at: t + 0.05, gain: 0.12 });
  }

  /** level 0..1 (0 = healthy). Call every frame; breathing / heartbeat / muffling follow it. */
  lowHealth(level) { this.lh = clamp(level || 0, 0, 1); this.lhAt = wall(); }

  // ---------------------------------------------------------------- objectives
  /** jammer node destroyed: o = {x, z, distance} */
  sabotage(o = {}) {
    if (!this.ok()) return;
    const d = o.distance ?? 2;
    this.play(this.B.power, { gain: 0.7 * Math.min(1, 6 / (4 + d)), pos: o.x != null ? { x: o.x, y: 1.2, z: o.z } : null, lp: clamp(16000 * Math.exp(-d / 30), 2500, 16000), send: 0.3 });
  }

  /** end of mission: extraction (win) or failure */
  ui(win) {
    if (!this.ready) return;
    this.halt();
    const c = this.ctx, t = c.currentTime, B = this.B;
    if (win) {
      if (B.radio) this.play(B.radio, { at: t + 0.15, gain: 0.25, pan: -0.1 });
      if (B.boat) this.play(B.boat, { at: t + 0.4, gain: 0.55, pan: 0.45, send: 0.25 });
      this.amb.gain.setTargetAtTime(0.75, t, 2);
    } else {
      this.endLP = 900;
      this.tone.frequency.setTargetAtTime(900, t, 0.25); this._fc = 900;
      if (B.ring) this.play(B.ring, { at: t, gain: 0.04 });
      for (let k = 0; k < 3; k++) { this.play(B.heart, { at: t + 0.2 + k * 1.1, gain: 0.35 - k * 0.08 }); this.play(B.heart, { at: t + 0.48 + k * 1.1, gain: 0.25 - k * 0.06 }); }
      this.amb.gain.setTargetAtTime(0.5, t, 0.8);
    }
  }

  horn() {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + 0.05, dur = rr(3.5, 5.5), g = c.createGain(), f = c.createBiquadFilter(), p = this.panNode(rr(0.3, 0.8)), s = c.createGain();
    f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 0.5; s.gain.value = 1.2;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.025, t + 0.6); g.gain.setValueAtTime(0.025, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.9);
    const base = rr(66, 74), oscs = [base, base * 1.004, base * 2.003].map((fr, i) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; const og = c.createGain(); og.gain.value = i === 2 ? 0.4 : 1; o.connect(og); og.connect(f); o.start(t); o.stop(t + dur + 1); return [o, og]; });
    f.connect(g); g.connect(p); p.connect(this.amb); g.connect(s); s.connect(this.verbIn);
    oscs[0][0].onended = () => { for (const [o, og] of oscs) { try { o.disconnect(); og.disconnect(); } catch (_) {} } for (const x of [f, g, p, s]) try { x.disconnect(); } catch (_) {} };
  }

  carPass() {
    const c = this.ctx, B = this.B, t = c.currentTime + 0.05, dur = rr(6, 10), p0 = rnd() < 0.5 ? -0.9 : 0.9;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), p = this.panNode(p0);
    s.buffer = B.hissBuf; s.loop = true; f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(rr(1300, 1900), t + dur * 0.5); f.frequency.linearRampToValueAtTime(500, t + dur);
    const peak = rr(0.012, 0.03);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (p.pan) p.pan.linearRampToValueAtTime(-p0 * 0.8, t + dur);
    s.connect(f); f.connect(g); g.connect(p); p.connect(this.amb);
    s.start(t, rnd() * 5); s.stop(t + dur + 0.1);
    s.onended = () => { for (const x of [s, f, g, p]) try { x.disconnect(); } catch (_) {} };
  }

  // ---------------------------------------------------------------- scheduler (10 Hz)
  live() { return wall() - this.beat < 0.35; }

  tick() {
    if (!this.ready || this.ctx.state !== 'running') return;
    const c = this.ctx, tt = wall(), live = this.live(), B = this.B, ct = c.currentTime;
    if (!live && this.speaking) this.halt();
    // low health: muffling, breathing, heartbeat (only while the game is running)
    const lv = live && tt - (this.lhAt || 0) < 0.35 ? this.lh : 0;
    const fc = lv > 0.02 ? lerp(16000, 3200, Math.pow(lv, 1.4)) : (this.endLP || 20000);
    if (Math.abs(fc - this._fc) > 50) { this.tone.frequency.setTargetAtTime(fc, ct, 0.3); this._fc = fc; }
    if (lv > 0.05 && B.inhale && tt >= (this._nb || 0)) {
      const inh = pick(B.inhale);
      this.play(inh, { at: ct, gain: lerp(0.04, 0.13, lv) });
      this.play(pick(B.exhale), { at: ct + inh.duration + rr(0.03, 0.1), gain: lerp(0.05, 0.15, lv) });
      this._nb = tt + lerp(2.6, 1.2, lv) * rr(0.9, 1.1);
    }
    if (lv > 0.45 && B.heart && tt >= (this._nh || 0)) {
      const hg = 0.3 * (lv - 0.3);
      this.play(B.heart, { at: ct, gain: hg }); this.play(B.heart, { at: ct + 0.27, gain: hg * 0.7 });
      this._nh = tt + lerp(0.9, 0.55, lv);
    }
    if (!this.ambOn) return;
    const nx = this.nx;
    // wind gusts modulate the rain layers
    if (tt >= nx.gust) {
      const g = Math.pow(rnd(), 1.6), tc = rr(0.6, 1.8);
      nx.gust = tt + rr(1.5, 6);
      this.aWind.gain.setTargetAtTime(0.004 + 0.05 * g, ct, tc);
      this.windF.frequency.setTargetAtTime(280 + 600 * g, ct, tc);
      this.aHiss.gain.setTargetAtTime(0.05 * (0.8 + 0.5 * g), ct, tc);
      this.aDrop.gain.setTargetAtTime(0.1 * (0.85 + 0.4 * g), ct, tc);
      this.aRoar.gain.setTargetAtTime(0.16 * (0.9 + 0.25 * g), ct, tc);
    }
    // random one-shots break any loop pattern
    if (rnd() < 0.3) this.play(pick(B.drip), { at: ct + rnd() * 0.1, gain: rr(0.01, 0.05), pan: rr(-0.9, 0.9), dest: this.amb });
    if (tt >= nx.creak) { nx.creak = tt + rr(25, 70); this.play(pick(B.creak), { gain: rr(0.03, 0.07), pan: rr(-0.8, 0.8), lp: 1800, send: 0.6, dest: this.amb, rate: rr(0.85, 1.1) }); }
    if (tt >= nx.clang) { nx.clang = tt + rr(35, 90); this.play(pick(B.clang), { gain: rr(0.02, 0.05), pan: rr(-0.9, 0.9), lp: 1500, send: 0.8, dest: this.amb, rate: rr(0.9, 1.1) }); }
    if (tt >= nx.horn) { nx.horn = tt + rr(80, 160); this.horn(); }
    if (tt >= nx.car) { nx.car = tt + rr(14, 40); this.carPass(); }
  }

  // ---------------------------------------------------------------- enemy voices
  guard(id) {
    let st = this.guards.get(id);
    if (!st) {
      const h = k => { const x = Math.sin((id + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
      st = { id, pitch: 0.7 + 0.35 * h(1), rate: 1.05 + 0.25 * h(2), f0: 100 + 45 * h(3), last: -99, shots: 0, mag: 6 + (h(4) * 5 | 0), voice: null };
      this.guards.set(id, st);
    }
    return st;
  }

  /**
   * Tactical bark. kind: contact | engage | reload | hit | death | search | reinforce.
   * o = {guardId, distance, x, z, force}. Returns true if something was voiced.
   * Silent when the game is paused/ended (no listener heartbeat) or the guard is > 35 m away.
   */
  voice(kind, o = {}) {
    if (!this.ok() || !this.live()) return false;
    const cfg = KINDS[kind]; if (!cfg) return false;
    const d = Math.max(1, o.distance ?? 10); if (d > MAX_VOICE_DIST) return false;
    const tt = wall(), st = this.guard(o.guardId ?? 0);
    if (!o.force) {
      if (rnd() > cfg.p) return false;
      if (tt - (this.kindLast[kind] ?? -99) < cfg.cd) return false;
      if (!cfg.urgent && (tt - this.lastBark < 1.8 || tt - st.last < 3.5)) return false;
    }
    this.kindLast[kind] = tt; this.lastBark = tt; st.last = tt;
    const text = pick(LINES[kind]);
    const cry = kind === 'death' || /^А-а/.test(text);
    if (!cry && this.ru.length && this.speech && !this.speechBusy()) return this.say(text, st, d);
    return this.murmur(text, st, o, d, kind);
  }

  speechBusy() { return this.speaking && wall() - (this._spokeAt || 0) < 4; }

  say(text, st, d) {
    try {
      if (!st.voice || !this.ru.includes(st.voice)) st.voice = this.ru[st.id % this.ru.length];
      const u = new SpeechSynthesisUtterance(text);
      u.voice = st.voice; u.lang = st.voice.lang || 'ru-RU';
      u.pitch = st.pitch; u.rate = st.rate; u.volume = clamp(1.1 - d / 32, 0.1, 1); // speech cannot be routed through Web Audio: level by distance only
      u.onend = u.onerror = () => { if (this.utt === u) { this.speaking = false; this.utt = null; } };
      this.utt = u; this.speaking = true; this._spokeAt = wall();
      this.speech.speak(u);
      return true;
    } catch (_) { this.speaking = false; return false; }
  }

  /** fallback (and cries): synthesised, muffled, unintelligible shout, positioned in 3D */
  murmur(text, st, o, d, kind) {
    const buf = this.buf([genVocal(LOW, text, { f0: st.f0, cry: kind === 'hit' || kind === 'death', death: kind === 'death', lp: 2600 })], LOW);
    const pos = o.x != null ? { x: o.x, y: 1.65, z: o.z } : null;
    this.play(buf, { at: this.ctx.currentTime + d / 343, gain: 0.45 * Math.pow(4 / (4 + d), 0.8), lp: clamp(4200 * Math.exp(-d / 30), 900, 4200), pos, pan: pos ? 0 : (o.pan || 0), send: 0.35, rate: rr(0.97, 1.03) });
    return true;
  }

  /** iOS only lets speech start from a user gesture: prime it with a silent local utterance */
  unlockSpeech() {
    if (this._unlocked || !this.speech || !this.ru.length) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.voice = this.ru[0]; u.lang = this.ru[0].lang; this.speech.speak(u); this._unlocked = true; } catch (_) {}
  }

  /** stop barks / breathing immediately (pause, end, restart, tab hidden) */
  halt() {
    this.lh = 0;
    if (this.speech && (this.speaking || this.utt)) { try { this.speech.cancel(); } catch (_) {} }
    this.speaking = false; this.utt = null;
  }
}
