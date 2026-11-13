// Procedural soldier motion layer (used by enemies.js poseAlive / poseDeath; no bones are touched here).
//  - gait timing: stride frequency and duty factor as functions of ground speed (walk -> tactical jog -> run), also
//    used by game.js / friendlies.js to advance the walk phase, so footstep audio lands on the visual foot plants
//  - world-locked foot planting: a stance foot keeps its spot on the ground; a swing foot flies to the landing point
//    predicted from the body's measured velocity and turn rate (Raibert-style), so feet do not skate at any speed, in
//    any direction, or while the body turns; the legs turn toward the direction of travel (hip turn when strafing,
//    backpedal when retreating) while the upper body stays on its facing
//  - idle stepper: when standing, a foot that is left too far from its stance spot (turning in place, stopping,
//    squaring into the bladed aiming stance, a stagger after a hit) takes a short shuffle step
//  - stable second-order springs (implicit Euler, safe at any frame time) for the layered upper-body reactions
// State lives in g.s.L (one small object per soldier); all maths is allocation-free per frame.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
export const wrapPi = a => a - TAU * Math.floor((a + Math.PI) / TAU);

/** Running weight 0 (walk) .. 1 (jog / run) for ground speed v (m/s). */
export const runWeight = v => sstep(1.6, 2.3, v);
/** Gait phase rate (rad/s, one 2*pi cycle = two steps) for ground speed v (m/s): ~0.9 Hz at a 1.1 m/s patrol walk
 *  (0.6 m steps), ~1.35 Hz at a 2.5 m/s tactical jog (0.93 m steps), ~1.55 Hz at 5.5 m/s. */
export function gaitRate(v) {
  if (!(v > 0.02)) return 0;
  const fw = 0.55 + 0.32 * Math.min(v, 2.4), fr = 1.18 + 0.065 * Math.min(v, 7);
  return TAU * lerp(fw, fr, runWeight(v));
}
/** Fraction of a cycle a foot is on the ground: 0.6 walking, 0.4 jogging (flight phase), 0.33 running fast. */
export const dutyFactor = v => lerp(0.62 - 0.03 * sstep(0.8, 1.6, v), 0.4 - 0.07 * sstep(2.5, 4.5, v), runWeight(v));

/** Damped spring step, implicit Euler (unconditionally stable). s = {x, v}; returns s.x. */
export function spring(s, target, w, z, dt) {
  s.v = (s.v - dt * w * w * (s.x - target)) / (1 + dt * 2 * z * w + dt * dt * w * w);
  s.x += dt * s.v;
  return s.x;
}
export const sp = (x = 0) => ({ x, v: 0 });

// idle stance (body space, forward = -Z): ground point under each ankle and toe-out yaw, square (A=0) and bladed (A=1)
function idleFoot(side, A, out) {
  const R = side > 0;
  out.x = side * (0.125 + 0.035 * A);
  out.z = R ? 0.03 + 0.11 * A : -0.03 - 0.11 * A;
  out.yaw = -side * 0.12 + (R ? -0.55 : -0.28) * A;
  return out;
}
const _id = { x: 0, z: 0, yaw: 0 };

function newFoot(side) {
  return { side, x: 0, z: 0, yaw: 0, air: false, mode: 0, k: 0, t: 0, dur: 0, lx: 0, lz: 0, lyaw: 0, tx: 0, tz: 0, tyaw: 0, cyc: -1e9, uLift: 0, land: -9, pitch: 0,
    out: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 } };
}

export function locoState() {
  return {
    init: false, px: 0, pz: 0, yaw: 0, vx: 0, vz: 0, yawRate: sp(), speed: 0, prevWalk: 0, phase: 0, rate: 0, lastRate: 6,
    legYaw: sp(), gait: sp(), sway: sp(), drop: sp(), accel: sp(), vfs: 0, clock: 0,
    feet: [newFoot(1), newFoot(-1)],
  };
}

// local <-> world (root yaw Y, rotation about +Y: x' = x cos + z sin, z' = -x sin + z cos)
function toWorld(L, lx, lz, Y, o) { const c = Math.cos(Y), s = Math.sin(Y); o.x = L.px + lx * c + lz * s; o.z = L.pz - lx * s + lz * c; return o; }
const _w = { x: 0, z: 0 };

function plantIdle(L, Y, A) {
  for (const f of L.feet) {
    idleFoot(f.side, A, _id); toWorld(L, _id.x, _id.z, Y, _w);
    f.x = _w.x; f.z = _w.z; f.yaw = Y + _id.yaw; f.air = false; f.pitch = 0;
  }
}

/**
 * Advance the gait. root: THREE object (position.x/z, rotation.y are the body's ground placement); st: pose state
 * (walk phase, speed); A: aim weight; off: {x, z} extra body-space offset of the stance spots (hit stagger).
 * Fills each foot's .out with the body-space ground point under the ankle (y = lift), yaw and pitch (heel/toe roll),
 * and L.{v, run, duty, m, legYaw, twist, support} for the upper layers.
 */
export function locomote(L, root, st, dt, A, off) {
  const P = root.position, Y = root.rotation.y;
  L.clock += dt;
  if (!L.init || Math.hypot(P.x - L.px, P.z - L.pz) > 1.5) {         // first pose or teleport (spawn, restart, QA)
    L.init = true; L.px = P.x; L.pz = P.z; L.yaw = Y; L.vx = L.vz = 0; L.speed = 0; L.prevWalk = st.walk; L.phase = st.walk;
    L.yawRate.x = L.yawRate.v = 0; L.legYaw.x = L.legYaw.v = 0; L.gait.x = L.gait.v = 0;
    plantIdle(L, Y, A);
  }
  const idt = dt > 1e-4 ? 1 / dt : 0;
  // ---- measured ground velocity (or a virtual treadmill when the root is held still but the state says "moving")
  let rvx = (P.x - L.px) * idt, rvz = (P.z - L.pz) * idt;
  const c = Math.cos(Y), s = Math.sin(Y);
  if (Math.hypot(rvx, rvz) < 0.03 && st.speed > 0.06 && st.walk !== L.prevWalk) {
    const vv = st.speed * 2.5;                                         // body-forward is local -Z
    rvx = -s * vv; rvz = -c * vv;
    for (const f of L.feet) if (!f.air) { f.x -= rvx * dt; f.z -= rvz * dt; } else { f.lx -= rvx * dt; f.lz -= rvz * dt; }
  }
  const kv = Math.min(1, dt * 14);
  L.vx += (rvx - L.vx) * kv; L.vz += (rvz - L.vz) * kv;
  const dY = wrapPi(Y - L.yaw);
  spring(L.yawRate, dt > 1e-4 ? clamp(dY * idt, -8, 8) : L.yawRate.x, 18, 1, dt);
  L.px = P.x; L.pz = P.z; L.yaw = Y;
  const v = Math.hypot(L.vx, L.vz);
  L.speed = v;
  // body-space velocity (forward = -Z)
  const lvx = L.vx * c - L.vz * s, lvz = L.vx * s + L.vz * c;
  // forward acceleration (for lean): spring-smoothed forward speed vs. raw
  const vf = -lvz; spring(L.accel, (vf - L.vfs) * idt * 0.1, 10, 1, dt); L.vfs = vf;

  const run = runWeight(v), duty = dutyFactor(v);
  L.run = run; L.duty = duty;

  // ---- leg frame: hips turn toward the travel direction (strafing), or the soldier backpedals
  let legT = 0;
  if (v > 0.25) {
    const a = Math.atan2(-lvx, -lvz);                                  // travel angle from body-forward (+ = left)
    legT = Math.abs(a) < 1.95 ? clamp(a, -1.15, 1.15) : clamp(wrapPi(a - Math.PI), -0.9, 0.9);
    legT *= sstep(0.25, 0.7, v);
  }
  spring(L.legYaw, legT, 9, 1, dt);
  const LY = L.legYaw.x;

  // ---- phase
  const dW = st.walk - L.prevWalk; L.prevWalk = st.walk;
  const anyAir = L.feet[0].air && L.feet[0].mode === 0 || L.feet[1].air && L.feet[1].mode === 0;
  let adv = false;
  if (dW > 0 && dW < 2) {
    L.phase += dW; adv = true;
    L.rate += (dW * idt - L.rate) * Math.min(1, dt * 10); L.lastRate = Math.max(4, L.rate);
  } else {
    L.rate *= Math.max(0, 1 - dt * 6);
    if (anyAir) { L.phase += L.lastRate * dt; adv = true; }           // finish a step in progress after stopping
  }
  const rate = Math.max(adv ? Math.max(L.rate, L.lastRate * 0.7) : L.lastRate, 3);
  const gaitOn = dW > 0 && dW < 2 && v > 0.08;
  spring(L.gait, gaitOn ? 1 : 0, 7, 1, dt);
  L.m = clamp(L.gait.x, 0, 1);
  const yr = L.yawRate.x;

  // ---- feet
  const w = lerp(0.105, 0.075, run);                                   // stance half-width while walking / running
  const Tst = duty * TAU / rate;
  for (const f of L.feet) {
    const phi = L.phase + (f.side > 0 ? 0 : Math.PI);
    const cyc = Math.floor(phi / TAU), u = phi / TAU - cyc;
    if (f.air && f.mode === 0 && cyc !== f.cyc) {                     // gait swing ends: touchdown
      f.air = false; f.x = f.tx; f.z = f.tz; f.yaw = f.tyaw; f.land = L.clock;
    }
    if (!f.air && adv && gaitOn && u >= duty && u < 0.97 && cyc !== f.cyc) {   // toe-off
      f.air = true; f.mode = 0; f.cyc = cyc; f.uLift = u; f.lx = f.x; f.lz = f.z; f.lyaw = f.yaw;
    }
    if (f.air && f.mode === 0) {
      // landing target: body position at touchdown + half a stance ahead, at the foot's lateral slot in the leg frame
      const Tl = Math.max(0, 1 - u) * TAU / rate;
      const Yl = Y + clamp(yr * Tl, -0.8, 0.8) + LY;
      const cs = Math.cos(Yl), sn = Math.sin(Yl);
      const ax = f.side * w + off.x * 0.6, az = off.z * 0.6;
      f.tx = P.x + L.vx * (Tl + 0.5 * Tst) + ax * cs + az * sn;
      f.tz = P.z + L.vz * (Tl + 0.5 * Tst) - ax * sn + az * cs;
      f.tyaw = Yl - f.side * 0.07;
      f.k = clamp((u - f.uLift) / Math.max(0.05, 1 - f.uLift), 0, 1);
    }
  }
  // idle stepper: only when no gait swing is in progress
  if (!L.feet[0].air && !L.feet[1].air || L.feet[0].mode === 1 || L.feet[1].mode === 1) {
    for (const f of L.feet) if (f.air && f.mode === 1) {
      f.k = clamp(f.k + dt / f.dur, 0, 1);
      if (f.k >= 1) { f.air = false; f.x = f.tx; f.z = f.tz; f.yaw = f.tyaw; f.land = L.clock; }
    }
    if (!L.feet[0].air && !L.feet[1].air && L.m < 0.35) {
      const lead = clamp(yr * 0.3, -0.7, 0.7);                         // anticipate a turn in progress
      let best = null, bestE = 0;
      for (const f of L.feet) {
        idleFoot(f.side, A, _id);
        toWorld(L, _id.x + off.x, _id.z + off.z, Y + lead, _w);
        const e = Math.hypot(f.x - _w.x, f.z - _w.z) + 0.3 * Math.abs(wrapPi(f.yaw - (Y + lead + _id.yaw)));
        const other = L.feet[f.side > 0 ? 1 : 0];
        const thr = (L.clock - other.land < 0.6) ? 0.05 : 0.13;        // second step of a shuffle squares up
        if (e > thr && e - thr > bestE && L.clock - f.land > 0.12) { best = f; bestE = e - thr; f.tx = _w.x; f.tz = _w.z; f.tyaw = Y + lead + _id.yaw; }
      }
      if (best) {
        const f = best; f.air = true; f.mode = 1; f.k = 0; f.lx = f.x; f.lz = f.z; f.lyaw = f.yaw;
        f.dur = clamp(0.22 + 0.25 * Math.hypot(f.tx - f.x, f.tz - f.z), 0.22, 0.38);
        f.lift = clamp(0.03 + 0.12 * Math.hypot(f.tx - f.x, f.tz - f.z), 0.03, 0.08);
      }
    }
  }

  // ---- outputs (body space)
  const m = L.m;
  for (const f of L.feet) {
    const o = f.out;
    let wx, wz, yaw, y = 0, pitch = 0;
    const phi = L.phase + (f.side > 0 ? 0 : Math.PI), u = phi / TAU - Math.floor(phi / TAU);
    if (!f.air) {
      wx = f.x; wz = f.z; yaw = f.yaw;
      // heel strike -> foot flat -> heel rise -> toe-off, from the stance progress (gait only)
      const sg = clamp(u / duty, 0, 1);
      if (sg < 0.16) pitch = lerp(0.3, 0.12, run) * (1 - sg / 0.16) ** 2;
      else if (sg > 0.55) pitch = -lerp(0.62, 0.85, run) * ((sg - 0.55) / 0.45) ** 2;
      pitch *= m;
    } else {
      const k = f.k;
      if (f.mode === 0) {
        // swing: quick early heel recovery (higher when running), forward reach, heel-first touchdown
        const e = sstep(0.0, 1.0, k * 1.05 - 0.02);
        wx = lerp(f.lx, f.tx, e); wz = lerp(f.lz, f.tz, e); yaw = f.lyaw + wrapPi(f.tyaw - f.lyaw) * e;
        const H = lerp(0.1, 0.26, run);
        y = H * Math.sin(Math.PI * Math.pow(k, lerp(0.85, 0.6, run)));
        pitch = k < 0.35 ? lerp(-lerp(0.62, 0.85, run), lerp(0.2, -0.1, run), k / 0.35) : lerp(lerp(0.2, -0.1, run), lerp(0.3, 0.12, run), (k - 0.35) / 0.65);
      } else {
        const e = sstep(0, 1, k);
        wx = lerp(f.lx, f.tx, e); wz = lerp(f.lz, f.tz, e); yaw = f.lyaw + wrapPi(f.tyaw - f.lyaw) * e;
        y = f.lift * Math.sin(Math.PI * k); pitch = 0.12 * Math.sin(Math.PI * k) * (k < 0.5 ? -1 : 1);
      }
    }
    const dx = wx - P.x, dz = wz - P.z;
    o.x = dx * c - dz * s; o.z = dx * s + dz * c; o.y = y; o.yaw = wrapPi(yaw - Y); o.pitch = pitch;
  }
  // pelvis twist toward the forward leg (in the leg frame), support-side weight shift
  const cl = Math.cos(LY), sl = Math.sin(LY);
  const fR = L.feet[0].out, fL = L.feet[1].out;
  const zRl = fR.x * sl + fR.z * cl, zLl = fL.x * sl + fL.z * cl;
  L.twist = clamp((zLl - zRl) * 0.13, -0.14, 0.14) * (0.4 + 0.6 * m);
  const sup = (L.feet[0].air ? 0 : 1) - (L.feet[1].air ? 0 : 1);       // +1: right foot supports
  spring(L.sway, sup * lerp(0.032, 0.012, run) * (0.5 + 0.5 * Math.max(m, L.feet[0].mode === 1 || L.feet[1].mode === 1 ? 1 : 0)), 13, 0.9, dt);
  L.v = v; L.lvx = lvx; L.lvz = lvz;
  L.uR = (L.phase / TAU) - Math.floor(L.phase / TAU);
  return L;
}
