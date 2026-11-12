// Guard: one continuous skinned body (see characters/soldier.js) with rigid gear,
// a detailed Kalashnikov and a procedural animation layer:
//  - foot-planted walk/run (stride derived from speed and phase rate, so feet do not skate)
//  - pelvis bob/sway/twist with counter-rotating chest, idle breathing and weight shift
//  - rifle carried at patrol low-ready, raised to a shouldered aim with cheek weld
//  - two-bone IK keeps the right hand on the pistol grip and the left on the handguard
//  - head stabilises its gaze, scans while patrolling, looks down the sights when aiming
//  - hit flinch, recoil, and a keyed death (knees buckle, torso twists, fall, settle)
import * as THREE from 'three';
import { box, rcyl, cyl, xform } from './geo.js';
import { mat, plainMat } from './materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSoldierMesh, BONE_DEFS, BI, LEN } from './characters/soldier.js';

function M(list) {
  return mergeGeometries(list.map(([g, m]) => { const x = g.index ? g.toNonIndexed() : g.clone(); if (m) x.applyMatrix4(m); for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; }));
}

let shared = null;
function materials() {
  if (shared) return shared;
  shared = {
    uniform: mat('camo_emr', { tile: 0.42, color: 0x9a9a92 }),
    vest: mat('ratnik_green', { tile: 0.35 }),
    knit: mat('olive_knit', { tile: 0.12 }), // olive balaclava
    glove: mat('fabric_glove', { tile: 0.15, color: 0x5a5a5a }),
    boot: mat('boot_leather', { tile: 0.25, color: 0x4a4440 }),
    gun: mat('gunmetal'),
    wood: mat('ak_wood', { tile: 0.3 }),
    poly: mat('polymer', { tile: 0.25 }),
    plum: mat('plum_polymer', { tile: 0.2 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.06, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03 }), // tinted lenses
  };
  return shared;
}

// Kalashnikov family at real scale. Barrel toward -Z, origin near the magazine well.
// variant 'ak74': AK-74M (black polymer, plum magazine, AK-74 muzzle brake)
// variant 'akm' : AKM pattern (laminated wood furniture, slant brake, steel magazine)
function kalashnikov(S, variant) {
  const g = new THREE.Group();
  const akm = variant === 'akm';
  const furn = akm ? S.wood : S.poly;
  const magM = akm ? S.gun : S.plum;
  const add = (list, m) => { const o = new THREE.Mesh(M(list), m); o.castShadow = true; g.add(o); return o; };
  const Z = Math.PI / 2;
  add([
    [box(0.046, 0.058, 0.25, 0.004), xform(0, 0, 0.02)],                 // stamped receiver
    [box(0.042, 0.024, 0.235, 0.011), xform(0, 0.038, 0.03)],           // ribbed dust cover
    ...[0, 1, 2].map(i => [box(0.044, 0.004, 0.006), xform(0, 0.051, 0.13 - i * 0.012)]),
    [box(0.05, 0.03, 0.03), xform(0, 0.005, -0.115)],            // front trunnion
    [box(0.03, 0.02, 0.06), xform(0, 0.042, -0.125)],            // rear sight block
    [box(0.026, 0.006, 0.08), xform(0, 0.056, -0.11)],           // sight leaf
    [box(0.008, 0.012, 0.018), xform(0.03, 0.03, 0.02)],         // charging handle
    [cyl(0.0085, 0.0085, 0.3, 12), xform(0, 0.0, -0.4, 0, Z)],         // barrel
    [cyl(0.011, 0.011, 0.2, 12), xform(0, 0.034, -0.27, 0, Z)],       // gas tube
    [box(0.022, 0.05, 0.035), xform(0, 0.022, -0.52)],           // front sight block / gas block
    [box(0.016, 0.03, 0.01), xform(0, 0.055, -0.525)],           // front sight ears
    [box(0.006, 0.02, 0.06), xform(0.026, 0.005, 0.05)],         // selector lever
    [box(0.01, 0.006, 0.07), xform(0, -0.038, 0.075)],           // trigger guard bottom
    [box(0.006, 0.02, 0.008), xform(0, -0.032, 0.06, 0, -0.3)], // trigger
    [box(0.024, 0.008, 0.012), xform(0, -0.012, -0.505)],        // bayonet lug
    ...(akm
      ? [[rcyl(0.012, 0.045, 0.003, 14), xform(0, 0.0, -0.565, 0, Z)]]
      : [[rcyl(0.0135, 0.085, 0.004, 16), xform(0, 0.0, -0.585, 0, Z)], [box(0.03, 0.006, 0.012), xform(0, 0.0, -0.57)]]),
  ], S.gun);
  add([
    // lower handguard: rounded, slightly wider at the front with finger grooves
    [rcyl(0.026, 0.2, 0.008, 16), xform(0, -0.006, -0.27, 0, Z, 0, 1.05, 1, 1.0)],
    [rcyl(0.019, 0.17, 0.006, 14), xform(0, 0.036, -0.26, 0, Z, 0, 1.05, 1, 0.8)],    // upper handguard over the gas tube
    [box(0.032, 0.1, 0.044, 0.012), xform(0, -0.082, 0.112, 0, -0.32)],               // pistol grip (raked back)
    ...(akm
      ? [[box(0.042, 0.065, 0.25, 0.014), xform(0, -0.022, 0.27, 0, 0.1)], [box(0.046, 0.13, 0.03, 0.012), xform(0, -0.05, 0.395, 0, 0.1)]]
      : [[box(0.04, 0.03, 0.25, 0.01), xform(0, -0.005, 0.27, 0, 0.1)], [box(0.036, 0.024, 0.2, 0.008), xform(0, -0.06, 0.29, 0, 0.18)],
        [box(0.044, 0.135, 0.03, 0.012), xform(0, -0.05, 0.395, 0, 0.1)], [box(0.036, 0.012, 0.03), xform(0, -0.03, 0.19, 0, 0.6)]]),
  ], furn);
  // curved 30-round magazine: segments rotated progressively, with a floor plate
  const segs = [];
  for (let i = 0; i < 5; i++) segs.push([box(0.028, 0.046, 0.072 - i * 0.002, 0.006), xform(0, -0.05 - i * 0.04, -0.07 - i * i * 0.007, 0, 0.12 + i * 0.12)]);
  segs.push([box(0.032, 0.012, 0.068, 0.004), xform(0, -0.235, -0.18, 0, 0.66)]);
  add(segs, magM);
  return g;
}

export function createGuard(variant = 'ak74') {
  const S = materials();
  const root = new THREE.Group();
  const { mesh, bones, rest } = createSoldierMesh({ camo: S.uniform, knit: S.knit, black: S.glove, boot: S.boot, web: S.vest, lens: S.visor });
  root.add(mesh);
  const rifle = kalashnikov(S, variant);
  root.add(rifle);
  // muzzle flash
  const flash = new THREE.PointLight(0xffa040, 0, 7, 2); flash.position.set(0, 0.0, -0.66); rifle.add(flash);
  const fl = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.5, 1.5) }));
  fl.position.set(0, 0.0, -0.66); fl.visible = false; rifle.add(fl);
  root.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  const seed = Math.random() * 100;
  const g = {
    root, rifle, flash, flashMesh: fl, mesh, bones, rest,
    s: { t: 0, time: seed, ph: null, rate: 0, seed, hitSide: 1, lastHit: 0, death: null, mm: bones.map(() => new THREE.Matrix4()), mq: bones.map(() => new THREE.Quaternion()) },
  };
  poseGuard(g, { walk: 0, speed: 0, aim: 0, flash: 0, hit: 0, dead: 0, fallDir: 1 });
  return g;
}

// ------------------------------------------------------------------ math helpers
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const PARENT = BONE_DEFS.map(d => d[1]);
const _qf = new THREE.Quaternion(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const UNIT = new THREE.Vector3(1, 1, 1);
const _pLow = new THREE.Vector3(), _pAim = new THREE.Vector3(), _qLow = new THREE.Quaternion(), _qAim = new THREE.Quaternion();
const qE = (x, y, z, q = new THREE.Quaternion()) => q.setFromEuler(_e.set(x, y, z, 'YXZ'));

/** Model-space (root-local) forward kinematics for bone i (parents must be current). */
function fk(g, i) {
  const s = g.s, b = g.bones[i], p = PARENT[i];
  b.updateMatrix();
  if (p < 0) { s.mm[i].copy(b.matrix); s.mq[i].copy(b.quaternion); }
  else { s.mm[i].multiplyMatrices(s.mm[p], b.matrix); s.mq[i].multiplyQuaternions(s.mq[p], b.quaternion); }
}
function fkFrom(g, i0) { for (let i = i0; i < g.bones.length; i++) fk(g, i); }
const bonePos = (g, i, v) => v.setFromMatrixPosition(g.s.mm[i]);
/** Set bone i so that its model-space orientation equals q. */
function setModelRot(g, i, q) {
  const p = PARENT[i];
  g.bones[i].quaternion.copy(_q3.copy(g.s.mq[p]).invert().multiply(q));
  fk(g, i);
}

/**
 * Analytic two-bone IK in model space. Limbs point along local -Y.
 * sign +1 (arm): local +Z faces the joint pole, lower bone flexes toward local -Z.
 * sign -1 (leg): local -Z faces the joint pole (knee forward), shin flexes toward +Z.
 */
function twoBone(g, iu, il, L1, L2, target, pole, sign) {
  bonePos(g, iu, _S);
  _u.subVectors(target, _S);
  let d = _u.length();
  d = clamp(d, 0.05, (L1 + L2) * 0.9995);
  _u.normalize();
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _w.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_w.lengthSq() < 1e-8) _w.set(0, 0, sign); _w.normalize();
  _E.copy(_S).addScaledVector(_u, L1 * cosA).addScaledVector(_w, L1 * sinA);
  _T.copy(_S).addScaledVector(_u, d);
  _a.subVectors(_E, _S).normalize();           // upper direction
  _b.subVectors(_T, _E).normalize();           // lower direction
  _y.copy(_a).negate();
  _z.copy(_w).addScaledVector(_a, -_w.dot(_a)).normalize().multiplyScalar(sign);
  _x.crossVectors(_y, _z).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  _q.setFromRotationMatrix(_m);
  setModelRot(g, iu, _q);
  const ang = Math.acos(clamp(_a.dot(_b), -1, 1));
  g.bones[il].quaternion.setFromAxisAngle(_x.set(1, 0, 0), sign * ang);
  fk(g, il);
}

// hand frames relative to the rifle (see soldier.js hand(): palm faces -X*side, grip centre at (palm*0.03, -0.097, 0))
const GRIP_R = new THREE.Vector3(0, -0.062, 0.1);
const GRIP_L = new THREE.Vector3(-0.004, -0.012, -0.21);
const HAND_R_Q = (() => {
  const X = new THREE.Vector3(1, 0, 0), Zd = new THREE.Vector3(0, -0.95, 0.31).normalize();
  const Y = new THREE.Vector3().crossVectors(Zd, X).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Zd));
})();
const HAND_L_Q = (() => {
  const al = 0.55, Y = new THREE.Vector3(-Math.cos(al), -Math.sin(al), 0), Zd = new THREE.Vector3(0, 0, 1);
  const X = new THREE.Vector3().crossVectors(Y, Zd).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Zd));
})();
const GRIP_IN_HAND_R = new THREE.Vector3(-0.03, -0.097, 0.004);
const GRIP_IN_HAND_L = new THREE.Vector3(0.03, -0.097, 0.0);
const EYE = new THREE.Vector3(0.034, 0.128, -0.078);

// ------------------------------------------------------------------ alive pose
function poseAlive(g, st, dt) {
  const s = g.s, B = g.bones, t = s.time;
  for (let i = 0; i < B.length; i++) { B[i].quaternion.identity(); B[i].position.copy(g.rest[i]); }
  const aimRaw = clamp(st.aim, 0, 1), A = sstep(0, 1, aimRaw);
  const sp = clamp(st.speed, 0, 1);
  const m = sstep(0.04, 0.3, sp) * sstep(0.3, 1.2, s.rate);
  const run = sstep(0.6, 0.95, sp);
  const ph = st.walk;
  const duty = lerp(0.6, 0.42, run);
  const rate = Math.max(s.rate, 1.5);
  const v = sp * 2.3;
  const D = clamp(v * duty * Math.PI * 2 / rate, 0, 0.95) * m;
  const breath = Math.sin(t * 1.65 + s.seed);
  const shift = Math.sin(t * 0.33 + s.seed * 1.7);
  const hit = clamp(st.hit, 0, 1);
  if (hit > s.lastHit + 0.3) s.hitSide = Math.random() < 0.5 ? -1 : 1;
  s.lastHit = hit;
  const kick = st.flash > 0 ? clamp(st.flash / 0.13, 0, 1) : 0;
  const midR = Math.PI * duty;

  // ---- pelvis
  const bobW = Math.cos(2 * (ph - midR));
  const hy = 0.97 - 0.022 - 0.045 * A - 0.06 * run * m + m * (0.022 * (1 - run) * bobW - 0.025 * run * bobW) + 0.004 * (1 - m) * breath * 0.3;
  const hx = m * 0.022 * (1 - 0.5 * run) * Math.cos(ph - midR) + (1 - m) * 0.022 * shift;
  const hz = 0.02 * A;
  const swingR = Math.PI * 2 * (duty + (1 - duty) / 2);
  const twist = m * (0.1 + 0.06 * run) * Math.cos(ph - swingR);
  const blade = -0.38 * A * (1 - 0.6 * m);
  B[BI.hips].position.set(hx, hy, hz);
  qE(-(0.03 + 0.12 * run * m + 0.04 * A) + hit * 0.12, twist + blade, m * 0.035 * (1 - run) * Math.cos(ph - midR) + (1 - m) * 0.03 * shift, B[BI.hips].quaternion);
  // ---- spine / chest (counter-rotate the gait twist; square the shoulders when aiming)
  qE(-0.02 - 0.05 * A + hit * 0.12, -twist * 0.45 - blade * 0.2 + hit * 0.15 * s.hitSide, -0.02 * shift * (1 - m), B[BI.spine].quaternion);
  qE(0.01 * breath * (1 - 0.5 * A) - 0.03 * A - 0.04 * run * m + hit * 0.18 + kick * 0.04, -twist * 0.5 - blade * 0.2 + hit * 0.2 * s.hitSide, 0, B[BI.chest].quaternion);
  B[BI.chest].position.y += 0.0025 * breath;
  // clavicles: slight shrug/protraction when shouldering
  qE(0, 0.06 * A, 0.14 * A + 0.01 * breath, B[BI.clavR].quaternion);
  qE(0, -0.12 - 0.3 * A, -0.04 * A - 0.01 * breath, B[BI.clavL].quaternion);
  // neck flexes forward into the cheek weld
  qE(-0.04 - 0.62 * A + hit * 0.25, 0, -0.14 * A, B[BI.neck].quaternion);
  fkFrom(g, 0);

  // ---- head: gaze-stabilised in model space
  const scan = (1 - A) * (0.45 * Math.sin(t * 0.27 + s.seed) + 0.15 * Math.sin(t * 0.71 + s.seed * 3));
  const lookPitch = lerp(-0.1 + 0.03 * Math.sin(t * 0.4), -0.2, A) + hit * 0.35;
  setModelRot(g, BI.head, qE(lookPitch, scan + A * 0.04, -0.2 * A, _q2));
  fkFrom(g, BI.head + 1);

  // ---- legs: foot-planted gait blended with an idle / bladed stance
  for (const side of [1, -1]) {
    const R = side > 0;
    const phi = ph + (R ? 0 : Math.PI);
    const u = ((phi / (Math.PI * 2)) % 1 + 1) % 1;
    let fz, fy = 0, pitch = 0;
    if (u < duty) {
      const k = u / duty;
      fz = -D / 2 + D * k;
      if (k < 0.15) pitch = 0.28 * (1 - k / 0.15) ** 2;
      else if (k > 0.7) pitch = -0.55 * ((k - 0.7) / 0.3) ** 2;
    } else {
      const k = (u - duty) / (1 - duty), e = k * k * (3 - 2 * k);
      fz = D / 2 - D * e;
      fy = (0.08 + 0.08 * run) * Math.sin(Math.PI * Math.min(1, k * 1.15)) * m;
      pitch = lerp(-0.55, 0.28, sstep(0.1, 0.95, k)) * m;
    }
    pitch *= m;
    const ix = side * (0.12 + 0.03 * A), iz = (R ? 0.02 + 0.1 * A : -0.03 - 0.12 * A) + (R ? 0.01 : -0.01) * shift;
    const x = lerp(ix, side * 0.1, m), z = lerp(iz, fz, m) + hz;
    const yaw = -side * 0.12 + (R ? -0.55 : -0.3) * A * (1 - m);
    // ankle from ground contact with heel / ball pivot
    const fq = _qf.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
    const piv = pitch >= 0 ? _a.set(0, -0.085, 0.04) : _a.set(0, -0.085, -0.15);
    _c.set(0, 0, 0).add(piv); _c.applyAxisAngle(_d.set(0, 1, 0), yaw);       // flat pivot offset
    _T.set(x, fy + 0.085, z).add(_c);                                          // pivot position
    _b.copy(piv).applyQuaternion(fq);
    _T.sub(_b);                                                                // ankle position
    _d.set(side * 0.12, 0, -1).applyAxisAngle(_c.set(0, 1, 0), yaw * 0.7 + twist * 0.5);
    twoBone(g, R ? BI.thighR : BI.thighL, R ? BI.shinR : BI.shinL, LEN.thigh, LEN.shin, _T, _d, -1);
    setModelRot(g, R ? BI.footR : BI.footL, fq);
  }

  // ---- rifle: patrol low-ready (anchored to the chest) -> shouldered (anchored to the eye)
  const ch = s.mm[BI.chest];
  _m.compose(_a.set(0.0, -0.1, -0.21), qE(-0.62, 0.5, 0.3, _q), UNIT);
  _m2.multiplyMatrices(ch, _m);
  const pLow = _pLow.setFromMatrixPosition(_m2), qLow = _qLow.setFromRotationMatrix(_m2);
  const qAim = qE(0.012 * breath + kick * 0.06 + hit * 0.25, 0.01 * Math.sin(t * 0.9 + s.seed), 0, _qAim);
  const pAim = _pAim.copy(EYE).applyMatrix4(s.mm[BI.head]).sub(_b.set(0, 0.066, 0.2 - kick * 0.03).applyQuaternion(qAim));
  const rq = g.rifle.quaternion.slerpQuaternions(qLow, qAim, A);
  g.rifle.position.lerpVectors(pLow, pAim, A);
  g.rifle.updateMatrix();

  // ---- arms: IK onto the rifle
  for (const side of [1, -1]) {
    const R = side > 0;
    const hq = _q2.multiplyQuaternions(rq, R ? HAND_R_Q : HAND_L_Q);
    const grip = _a.copy(R ? GRIP_R : GRIP_L).applyMatrix4(g.rifle.matrix);
    const wrist = grip.sub(_b.copy(R ? GRIP_IN_HAND_R : GRIP_IN_HAND_L).applyQuaternion(hq));
    const pole = R ? _d.set(0.55 + 0.4 * A, -1 + 0.55 * A, 0.35) : _d.set(-0.35 - 0.2 * A, -1, 0.1);
    twoBone(g, R ? BI.uarmR : BI.uarmL, R ? BI.farmR : BI.farmL, LEN.upper, LEN.fore, wrist, pole, 1);
    setModelRot(g, R ? BI.handR : BI.handL, hq);
  }
}

// ------------------------------------------------------------------ death
function keyPose(g, spec) {
  const q = g.bones.map(() => new THREE.Quaternion()), p = g.rest.map(r => r.clone());
  for (const [name, e] of Object.entries(spec)) {
    if (name === 'pos') { p[0].set(...e); continue; }
    qE(e[0] || 0, e[1] || 0, e[2] || 0, q[BI[name]]);
  }
  return { q, p };
}
function deathKeys(g, dir, side) {
  const slump = keyPose(g, {
    pos: [0.02 * side, 0.74, 0.05 * dir],
    hips: [0.1 * dir, 0.15 * side, 0.05 * side], spine: [-0.25, 0.1 * side, 0], chest: [-0.2, 0.15 * side, 0.05 * side], neck: [-0.3], head: [-0.25, 0.2 * side],
    thighR: [0.75, 0, 0.05], shinR: [-1.5], footR: [0.6], thighL: [0.8, 0, -0.05], shinL: [-1.55], footL: [0.65],
    uarmR: [0.35, 0, 0.25], farmR: [0.6], uarmL: [0.3, 0, -0.2], farmL: [0.5], handR: [0.2], handL: [0.2],
  });
  const lie = dir > 0 ? keyPose(g, {
    // on the back, legs splayed, one knee raised, head rolled to one side
    pos: [0.08 * side, 0.2, 0.8], hips: [1.5, 0.2 * side, 0.1 * side],
    spine: [-0.06, 0.12 * side, 0], chest: [-0.04, 0.18 * side, 0.05 * side], neck: [0.05], head: [0.12, 0.85 * side, 0.15 * side],
    thighR: side > 0 ? [0.55, 0, 0.12] : [0.05, 0, 0.18], shinR: side > 0 ? [-0.95] : [-0.15], footR: [0.3, 0, 0.3],
    thighL: side < 0 ? [0.55, 0, -0.12] : [0.05, 0, -0.18], shinL: side < 0 ? [-0.95] : [-0.15], footL: [0.3, 0, -0.3],
    clavR: [0, 0, 0.1], clavL: [0, 0, -0.1],
    uarmR: [0.15, 0, 1.0], farmR: [0.7], handR: [0.3], uarmL: [0.4, 0, -0.7], farmL: [1.0], handL: [0.3],
  }) : keyPose(g, {
    // face down, head turned, arms tucked
    pos: [0.08 * side, 0.2, -0.8], hips: [-1.52, 0.2 * side, -0.08 * side],
    spine: [0.05, 0.1 * side, 0], chest: [0.06, 0.15 * side, 0], neck: [0.25], head: [0.25, 1.1 * side, 0.1 * side],
    thighR: [-0.05, 0, 0.12], shinR: [-0.12], footR: [1.1], thighL: [-0.1, 0, -0.1], shinL: [-0.05], footL: [1.0],
    uarmR: [-0.1, 0, 0.3], farmR: [0.1], handR: [0, 0.8], uarmL: [-0.2, 0, -0.45], farmL: [0.15], handL: [0, -0.8],
  });
  return { slump, lie };
}

const GROUND_PROBES = [
  [BI.hips, 0, 0, 0, 0.12], [BI.spine, 0, 0.08, 0, 0.12], [BI.chest, 0, 0.12, 0, 0.13], [BI.head, 0, 0.13, -0.01, 0.1],
  [BI.shinR, 0, 0, 0, 0.06], [BI.shinL, 0, 0, 0, 0.06], [BI.farmR, 0, 0, 0, 0.05], [BI.farmL, 0, 0, 0, 0.05],
  [BI.handR, 0, -0.08, 0, 0.025], [BI.handL, 0, -0.08, 0, 0.025],
  [BI.footR, 0, -0.085, 0.05, 0], [BI.footR, 0, -0.06, -0.2, 0], [BI.footL, 0, -0.085, 0.05, 0], [BI.footL, 0, -0.06, -0.2, 0],
];
function poseDeath(g, st) {
  const s = g.s, B = g.bones, D = s.death;
  const T = st.dead * 0.9; // seconds since death
  const w1 = sstep(0, 0.42, T);
  const pf = clamp((T - 0.3) / 0.62, 0, 1), w2 = pf * pf;        // accelerating topple
  const settle = T > 0.92 ? Math.sin(clamp((T - 0.92) / 0.35, 0, 1) * Math.PI) * Math.exp(-(T - 0.92) * 3) : 0;
  for (let i = 0; i < B.length; i++) {
    _q.slerpQuaternions(D.k0.q[i], D.slump.q[i], w1);
    B[i].quaternion.slerpQuaternions(_q, D.lie.q[i], w2);
    _a.lerpVectors(D.k0.p[i], D.slump.p[i], w1);
    B[i].position.lerpVectors(_a, D.lie.p[i], w2);
  }
  // fall arc: the pelvis travels in an arc rather than a straight line
  B[0].position.y += Math.sin(w2 * Math.PI) * 0.08 + settle * 0.03;
  B[BI.chest].quaternion.multiply(qE(-settle * 0.08 * D.dir, 0, 0, _q));
  fkFrom(g, 0);
  // keep the body out of the ground: lift the pelvis by the deepest penetration
  let lift = 0;
  for (const [i, x, y, z, r] of GROUND_PROBES) { _a.set(x, y, z).applyMatrix4(s.mm[i]); lift = Math.max(lift, r - _a.y); }
  if (lift > 0) { B[0].position.y += lift; fkFrom(g, 0); }
  // rifle: released, drops and clatters onto its side next to the body
  const r = clamp((T - 0.1) / 0.5, 0, 1), rf = r * r;
  const bounce = T > 0.6 ? Math.abs(Math.sin((T - 0.6) * 9)) * Math.exp(-(T - 0.6) * 7) * 0.05 : 0;
  g.rifle.position.lerpVectors(D.r0p, D.r1p, rf); g.rifle.position.y += bounce;
  g.rifle.quaternion.slerpQuaternions(D.r0q, D.r1q, sstep(0, 1, r));
}

// ------------------------------------------------------------------ public
/** Pose a guard. st: {walk, speed(0..1), aim(0..1), flash, hit, dead (0 alive, then s/0.9), fallDir} */
export function poseGuard(g, st) {
  const s = g.s;
  const DBG = globalThis.__GUARD_DEBUG__; // TEMP QA hook
  if (DBG) { st = { ...st, ...DBG }; if (DBG.rate !== undefined) s.rateOverride = DBG.rate; if (DBG.facing !== undefined) g.root.rotation.y = DBG.facing; }
  const now = performance.now() / 1000;
  const dt = s.t ? clamp(now - s.t, 0, 0.1) : 0.016;
  s.t = now; s.time += dt;
  if (s.ph === null) s.ph = st.walk;
  if (dt > 1e-4) s.rate += (clamp((st.walk - s.ph) / dt, 0, 14) - s.rate) * Math.min(1, dt * 8);
  s.ph = st.walk;
  if (DBG && DBG.rate !== undefined) s.rate = DBG.rate;
  if (DBG && DBG.time !== undefined) s.time = DBG.time;

  g.flash.intensity = st.flash > 0 ? 18 : 0;
  g.flashMesh.visible = st.flash > 0;
  g.flashMesh.rotation.z = Math.random() * 6.28;
  g.flashMesh.scale.setScalar(0.8 + Math.random() * 0.6);

  if (!(st.dead > 0)) {
    s.death = null;
    poseAlive(g, st, dt);
  } else {
    if (!s.death) {
      const side = Math.random() < 0.5 ? -1 : 1, dir = st.fallDir >= 0 ? 1 : -1;
      const k0 = { q: g.bones.map(b => b.quaternion.clone()), p: g.bones.map(b => b.position.clone()) };
      const keys = deathKeys(g, dir, side);
      const r1q = qE(0, side * 0.9 + 0.4 * dir, Math.PI / 2 * side);
      s.death = {
        dir, side, k0, ...keys,
        r0p: g.rifle.position.clone(), r0q: g.rifle.quaternion.clone(),
        r1p: new THREE.Vector3(0.42 * side, 0.026, -0.15 * dir), r1q,
      };
    }
    poseDeath(g, st);
    g.flash.intensity = 0; g.flashMesh.visible = false;
  }
  g.root.rotation.x = 0; g.root.rotation.z = 0;
  g.rifle.visible = true;
}
