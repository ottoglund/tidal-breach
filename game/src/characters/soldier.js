// Procedural skinned soldier: ONE THREE.SkinnedMesh per guard.
//
// The body is lofted from elliptical / super-elliptical cross-sections along a
// 19-bone skeleton (rest pose: standing, arms hanging, facing -Z, feet on y=0).
// Skin weights blend across knees, elbows, hips, spine and neck so joints bend
// without seams. Gear (chest rig, pouches, earmuffs, glasses, gloves, boots) is
// appended to the same geometry, rigidly weighted to one bone each, so a guard
// is a single skinned draw per material group (7 groups).
//
// Body: when the MakeHuman-based asset (characters/body.js, game/assets/models/soldier_body.bin, CC0 source mesh,
// see docs/ASSETS.md) is loaded, the lofted body below is replaced by that clothed human body and the skeleton takes
// its proportions (setupBody); the procedural body stays as the fallback if the asset cannot be loaded. Gear is
// procedural in both cases and is refitted to the MakeHuman proportions (fitTorso / fitHead / bodyGear).
import * as THREE from 'three';
import { box as boxGeo, rcyl, cyl } from '../geo.js';
import { soldierBody } from './body.js';
// tiny parts (zipper pulls, tabs, stitched edges) stay plain 12-triangle boxes: a bevel would be sub-pixel
const box = (w, h, d, r) => (Math.min(w, h, d) < 0.016 ? boxGeo(w, h, d, 0) : boxGeo(w, h, d, r));

// name, parent, rest position in model space (metres)
export const BONE_DEFS = [
  ['hips', -1, [0, 0.97, 0]],
  ['spine', 0, [0, 1.07, 0.005]],
  ['chest', 1, [0, 1.25, 0.01]],
  ['neck', 2, [0, 1.5, 0.0]],
  ['head', 3, [0, 1.6, -0.005]],
  ['clavR', 2, [0.03, 1.44, 0.0]],
  ['uarmR', 5, [0.19, 1.44, 0.0]],
  ['farmR', 6, [0.19, 1.14, 0.0]],
  ['handR', 7, [0.19, 0.875, 0.0]],
  ['clavL', 2, [-0.03, 1.44, 0.0]],
  ['uarmL', 9, [-0.19, 1.44, 0.0]],
  ['farmL', 10, [-0.19, 1.14, 0.0]],
  ['handL', 11, [-0.19, 0.875, 0.0]],
  ['thighR', 0, [0.095, 0.93, 0]],
  ['shinR', 13, [0.095, 0.49, 0]],
  ['footR', 14, [0.095, 0.085, 0]],
  ['thighL', 0, [-0.095, 0.93, 0]],
  ['shinL', 16, [-0.095, 0.49, 0]],
  ['footL', 17, [-0.095, 0.085, 0]],
];
export const BI = Object.fromEntries(BONE_DEFS.map(([n], i) => [n, i]));
export const LEN = { upper: 0.30, fore: 0.265, thigh: 0.44, shin: 0.405 };
// pose constants that depend on the body (procedural defaults; replaced by setupBody() for the MakeHuman body)
//  hipY: standing pelvis pivot height, ankle: ankle height over the sole, eye: aiming (right) eye in head-bone space,
//  gripR / gripL: grip axis centre in hand space, chest: chest bone rest position
export const RIG = { hipY: 0.97, ankle: 0.085, eye: [0.034, 0.128, -0.078], gripR: [-0.03, -0.097, 0.004], gripL: [0.03, -0.097, 0.0], chest: [0, 1.25, 0.01], mh: false };

// material group order of the skinned mesh
export const GROUPS = ['camo', 'knit', 'black', 'boot', 'web', 'lens', 'glove', 'patch', 'skin', 'metal'];

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const AX = V(1, 0, 0), NZ = V(0, 0, -1), PY = V(0, 1, 0), PZ = V(0, 0, 1);

class SkinBuilder {
  constructor() { this.g = new Map(GROUPS.map(k => [k, { pos: [], nor: [], uv: [], si: [], sw: [], idx: [] }])); }

  /**
   * Loft a closed tube through rings. ring: {c, ax, az, rx, rf, rb, p, w:[[bone,weight],..]}
   * cross-section point(a) = c + ax*rx*cos(a) + az*(sin(a)>0 ? rf : rb)*sin(a)  (super-ellipse exponent p)
   */
  tube(key, rings, N, wfn, shape, skip) {
    const G = this.g.get(key), base = G.pos.length / 3;
    const P = [];
    const tmp = new THREE.Vector3();
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i], row = [];
      const e = 2 / (r.p || 2);
      for (let j = 0; j < N; j++) {
        const a = (j / N) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        const pc = Math.sign(c) * Math.pow(Math.abs(c), e), ps = Math.sign(s) * Math.pow(Math.abs(s), e);
        tmp.copy(r.c).addScaledVector(r.ax, pc * r.rx).addScaledVector(r.az, ps * (s > 0 ? r.rf : r.rb));
        if (shape) shape(tmp, i, a, r);
        row.push(tmp.clone());
      }
      P.push(row);
    }
    // smooth normals from finite differences (seamless across the u wrap). The facing is decided ONCE per
    // tube from the winding (not per vertex against the ring centre), so concave folds such as collar
    // lips and cuff turn-ups keep correct, non-inverted shading.
    const Nn = [];
    const du = new THREE.Vector3(), dv = new THREE.Vector3(), n = new THREE.Vector3();
    const nAt = (i, j) => {
      const ip = Math.min(i + 1, rings.length - 1), im = Math.max(i - 1, 0);
      du.subVectors(P[i][(j + 1) % N], P[i][(j + N - 1) % N]);
      dv.subVectors(P[ip][j], P[im][j]);
      return n.crossVectors(du, dv);
    };
    const mi0 = Math.floor(rings.length / 2) - 1, mj0 = Math.floor(N / 4);
    const sgn = nAt(mi0, mj0).dot(tmp.subVectors(P[mi0][mj0], rings[mi0].c)) < 0 ? -1 : 1;
    for (let i = 0; i < rings.length; i++) {
      const row = [];
      for (let j = 0; j < N; j++) {
        nAt(i, j);
        const out = tmp.subVectors(P[i][j], rings[i].c);
        if (n.lengthSq() < 1e-12 || rings[i].rx < 0.006) {
          // pole ring: point along the tube end
          n.subVectors(rings[i].c, rings[i === 0 ? 1 : rings.length - 2].c).normalize();
          n.lerp(out.normalize(), rings[i].rx < 0.006 ? 0.0 : 0.5).normalize();
        } else {
          n.normalize().multiplyScalar(sgn);
        }
        row.push(n.clone());
      }
      Nn.push(row);
    }
    // metric UVs: u = arc length around ring, v = distance along tube
    let vacc = 0;
    for (let i = 0; i < rings.length; i++) {
      if (i > 0) vacc += rings[i].c.distanceTo(rings[i - 1].c) + Math.abs(rings[i].rx - rings[i - 1].rx) * 0.5;
      const circ = Math.PI * (rings[i].rx + (rings[i].rf + rings[i].rb) / 2);
      const w = wfn ? null : norm4(rings[i].w);
      for (let j = 0; j <= N; j++) {
        const jj = j % N;
        const p = P[i][jj], nn = Nn[i][jj];
        G.pos.push(p.x, p.y, p.z); G.nor.push(nn.x, nn.y, nn.z);
        G.uv.push((j / N) * Math.max(circ, 0.05), vacc);
        const ww = w || norm4(wfn(i, (jj / N) * Math.PI * 2, p, rings[i]));
        G.si.push(ww[0][0], ww[1][0], ww[2][0], ww[3][0]);
        G.sw.push(ww[0][1], ww[1][1], ww[2][1], ww[3][1]);
      }
    }
    // indices, oriented so faces point outward
    const R = N + 1;
    const idx = [];
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < N; j++) {
      if (skip && skip(i, j, rings)) continue;            // cut-out (e.g. the balaclava eye slot)
      const a = base + i * R + j, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // orientation test on a mid quad
    const mi = Math.floor(rings.length / 2) - 1, mj = Math.floor(N / 4);
    const A = P[mi][mj], B = P[mi][(mj + 1) % N], C = P[mi + 1][mj];
    const fn = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(C, A), new THREE.Vector3().subVectors(B, A));
    if (fn.dot(Nn[mi][mj]) < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    G.idx.push(...idx);
  }

  /** Append a rigid piece (BufferGeometry in model rest space after `m`) bound 100% to one bone. */
  rigid(key, geo, m, bone) {
    const G = this.g.get(key), base = G.pos.length / 3;
    const g = geo.clone();
    if (m) g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (this.fit) this.fit(g, bone);                        // MakeHuman body: refit gear authored for the procedural body
    if (this.xf && this.xf[bone]) g.applyMatrix4(this.xf[bone]); // identity-rest space -> A-pose bind space
    const p = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      G.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      G.nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      G.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      G.si.push(bone, 0, 0, 0); G.sw.push(1, 0, 0, 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) G.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) G.idx.push(base + i);
  }

  build() {
    const pos = [], nor = [], uv = [], si = [], sw = [], idx = [];
    const geo = new THREE.BufferGeometry();
    const names = [];
    GROUPS.forEach((k) => {
      const G = this.g.get(k);
      if (!G.idx.length) return;               // unused material group (e.g. patches on OPFOR): no draw call
      const mi = names.length; names.push(k);
      const off = pos.length / 3, start = idx.length;
      pos.push(...G.pos); nor.push(...G.nor); uv.push(...G.uv); si.push(...G.si); sw.push(...G.sw);
      for (const i of G.idx) idx.push(i + off);
      geo.addGroup(start, idx.length - start, mi);
    });
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(idx);
    geo.userData.names = names;
    return geo;
  }
}

function norm4(w) {
  const a = (w || [[0, 1]]).filter(x => x[1] > 1e-4).sort((p, q) => q[1] - p[1]).slice(0, 4);
  const s = a.reduce((t, x) => t + x[1], 0) || 1;
  const r = a.map(([b, x]) => [b, x / s]);
  while (r.length < 4) r.push([0, 0]);
  return r;
}
const ring = (c, rx, rf, rb, w, p = 2, ax = AX, az = NZ) => ({ c, rx, rf, rb, w, p, ax, az });
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const xf = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V(sx, sy, sz));


// ---- ring refinement (Catmull-Rom) + fabric folds ------------------------------------------
const cr = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
const mergeW = (wa, wb, t) => {
  const m = new Map();
  for (const [b, x] of wa) m.set(b, (m.get(b) || 0) + x * (1 - t));
  for (const [b, x] of wb) m.set(b, (m.get(b) || 0) + x * t);
  return [...m.entries()];
};
/** Insert interpolated rings: split(ringA, ringB) = number of segments the span is divided into. */
function refine(rings, split) {
  const out = [];
  const n = rings.length;
  for (let i = 0; i < n - 1; i++) {
    const a = rings[i], b = rings[i + 1], p0 = rings[Math.max(i - 1, 0)], p3 = rings[Math.min(i + 2, n - 1)];
    out.push(a);
    const k = Math.max(1, split(a, b) | 0);
    for (let q = 1; q < k; q++) {
      const t = q / k;
      const c = V(cr(p0.c.x, a.c.x, b.c.x, p3.c.x, t), cr(p0.c.y, a.c.y, b.c.y, p3.c.y, t), cr(p0.c.z, a.c.z, b.c.z, p3.c.z, t));
      const f = key => Math.max(0.004, cr(p0[key], a[key], b[key], p3[key], t));
      out.push({ c, rx: f('rx'), rf: f('rf'), rb: f('rb'), p: a.p + (b.p - a.p) * t, ax: a.ax, az: a.az, w: mergeW(a.w, b.w, t) });
    }
  }
  out.push(rings[n - 1]);
  return out;
}
const zoneSplit = (lo, hi, step, maxK = 4) => (a, b) => {
  const y0 = Math.min(a.c.y, b.c.y), y1 = Math.max(a.c.y, b.c.y);
  if (y1 < lo || y0 > hi) return 1;
  return Math.min(maxK, Math.ceil((y1 - y0) / step));
};
/**
 * Fabric fold: radial ripples with creased (cusped) valleys and rounded ridges, concentrated around y0.
 * o = {y0, h (envelope half height), f (folds per metre), amp, a0, aw (angular focus exponent, 0 = all round), tilt (integer slant)}
 */
function fold(pt, r, a, o) {
  const dy = pt.y - o.y0;
  const env = Math.exp(-(dy * dy) / (o.h * o.h));
  if (env < 0.02) return;
  const mask = o.aw ? Math.pow(0.5 + 0.5 * Math.cos(a - o.a0), o.aw) : 1;
  if (mask < 0.02) return;
  const th = Math.PI * 2 * o.f * dy + (o.tilt || 0) * a + (o.ph || 0);
  const wave = Math.pow(Math.abs(Math.sin(th)), 0.7) - 0.45;
  const mod = 0.7 + 0.3 * Math.sin(a * 5 + dy * 31 + (o.ph || 0));
  const ox = pt.x - r.c.x, oz = pt.z - r.c.z, l = Math.hypot(ox, oz) || 1;
  const d = o.amp * env * mask * wave * mod;
  pt.x += (ox / l) * d; pt.z += (oz / l) * d;
}

/** Raised seam / piping: a thin ridge along ring angle a0 (radial push, narrow angular width). */
function seam(pt, r, a, a0, amp, w = 0.16) {
  const d = Math.abs(((a - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const k = Math.exp(-(d * d) / (w * w));
  if (k < 0.02) return;
  const ox = pt.x - r.c.x, oz = pt.z - r.c.z, l = Math.hypot(ox, oz) || 1;
  pt.x += (ox / l) * amp * k; pt.z += (oz / l) * amp * k;
}

// ---------------------------------------------------------------- body parts
const TORSO_T = (({ hips, spine, chest, neck }) => [
    [0.795, 0.004, 0.004, 0.004, 0.0, 2, [[hips, 1]]],
    [0.81, 0.07, 0.05, 0.06, 0.0, 2, [[hips, 1]]],
    [0.84, 0.13, 0.085, 0.1, 0.0, 2.3, [[hips, 1]]],
    [0.89, 0.165, 0.105, 0.125, 0.0, 2.5, [[hips, 1]]],
    [0.95, 0.178, 0.112, 0.128, 0.0, 2.6, [[hips, 0.85], [spine, 0.15]]],
    // jacket hem flare over the trouser seat
    [0.985, 0.186, 0.12, 0.13, 0.0, 2.6, [[hips, 0.7], [spine, 0.3]]],
    [1.0, 0.178, 0.116, 0.122, 0.0, 2.6, [[hips, 0.55], [spine, 0.45]]],
    [1.05, 0.158, 0.106, 0.106, 0.0, 2.5, [[hips, 0.3], [spine, 0.7]]],    // cinched waist under the belt
    [1.1, 0.157, 0.106, 0.102, 0.003, 2.5, [[spine, 0.92], [hips, 0.08]]],
    [1.16, 0.168, 0.114, 0.106, 0.005, 2.6, [[spine, 0.75], [chest, 0.25]]],
    [1.23, 0.186, 0.126, 0.114, 0.008, 2.6, [[spine, 0.4], [chest, 0.6]]],
    [1.3, 0.2, 0.134, 0.12, 0.01, 2.6, [[chest, 0.9], [spine, 0.1]]],
    [1.37, 0.214, 0.134, 0.126, 0.012, 2.7, [[chest, 1]]],
    [1.42, 0.224, 0.12, 0.122, 0.014, 2.9, [[chest, 1]]],                  // padded jacket shoulders
    [1.46, 0.198, 0.1, 0.11, 0.016, 2.7, [[chest, 1]]],
    [1.49, 0.145, 0.08, 0.092, 0.016, 2.3, [[chest, 0.9], [neck, 0.1]]],
    [1.515, 0.098, 0.07, 0.078, 0.014, 2.1, [[chest, 0.75], [neck, 0.25]]],
    // stand-up collar of the jacket
    [1.555, 0.082, 0.066, 0.074, 0.012, 2, [[chest, 0.45], [neck, 0.55]]],
    [1.565, 0.078, 0.062, 0.07, 0.012, 2, [[chest, 0.4], [neck, 0.6]]],
    [1.555, 0.066, 0.052, 0.058, 0.012, 2, [[chest, 0.4], [neck, 0.6]]],
    [1.54, 0.004, 0.004, 0.004, 0.012, 2, [[neck, 1]]],
])(BI);

function torso(B) {
  const { hips, spine, chest, neck, clavR, clavL } = BI;
  // y, half-width, front depth, back depth, centre z, superellipse p, weights
  const T = TORSO_T;
  const rings = refine(T.map(([y, rx, rf, rb, cz, p, w]) => ring(V(0, y, cz), rx, rf, rb, w, p)), (a, b) => Math.max(zoneSplit(0.93, 1.17, 0.021, 3)(a, b), zoneSplit(1.34, 1.5, 0.03, 2)(a, b)));
  B.tube('camo', rings, 24, (i, a, pt, r) => {
    // shoulders follow the clavicles a little; trouser seat follows the thighs a little
    const w = r.w.map(x => x.slice());
    const side = Math.cos(a);
    if (pt.y > 1.36 && pt.y < 1.5 && Math.abs(side) > 0.55) {
      const k = sstep(0.55, 0.95, Math.abs(side)) * 0.6 * (1 - sstep(1.46, 1.5, pt.y));
      w.forEach(x => (x[1] *= 1 - k)); w.push([side > 0 ? clavR : clavL, k]);
    }
    if (pt.y < 0.93) {
      const k = 0.35 * sstep(0.2, 0.9, Math.abs(side)) * (1 - sstep(0.84, 0.93, pt.y)) + 0.25 * (1 - sstep(0.8, 0.88, pt.y));
      w.forEach(x => (x[1] *= 1 - k)); w.push([side > 0 ? BI.thighR : BI.thighL, k]);
    }
    return w;
  }, (pt, i, a, r) => {
    // chest/back shaping: slight pectoral fullness, flatter sides, spine groove behind
    const s = Math.sin(a);
    if (pt.y > 1.2 && pt.y < 1.44 && s < 0) pt.z -= 0.008 * Math.pow(Math.abs(Math.cos(a * 2)), 3) * -s;
    // jacket bunching above the belt and a gathered hem below it
    fold(pt, r, a, { y0: 1.125, h: 0.034, f: 15, amp: 0.011, tilt: 2 });
    fold(pt, r, a, { y0: 1.09, h: 0.07, f: 7, amp: 0.004, tilt: -2, ph: 0.6 });
    fold(pt, r, a, { y0: 0.965, h: 0.03, f: 14, amp: 0.011, tilt: -3, ph: 1.3 });
    seam(pt, r, a, 0, 0.0028); seam(pt, r, a, Math.PI, 0.0028);                          // side seams
    seam(pt, r, a, -Math.PI / 2, 0.0022, 0.1);                                           // centre-back seam (az faces -Z; this is the back)
    // armpit creases where the sleeve meets the body
    fold(pt, r, a, { y0: 1.37, h: 0.04, f: 16, amp: 0.003, a0: 0, aw: 6, tilt: 1 });
    fold(pt, r, a, { y0: 1.37, h: 0.04, f: 16, amp: 0.003, a0: Math.PI, aw: 6, tilt: 1 });
  });
  // turned and stitched jacket hem: a thick rolled band over the trouser seat, with a drawcord toggle
  const hemR = [[0.936, 0.0, 0.0], [0.943, 0.0075, 0.0], [0.958, 0.0095, 0.0], [0.974, 0.0085, 0.0], [0.982, 0.004, 0.0]].map(([y, d]) => {
    const t = y - 0.95;
    return ring(V(0, y, 0), 0.178 + t * 0.23 + d, 0.112 + t * 0.22 + d, 0.128 + t * 0.06 + d, [[hips, 0.82], [spine, 0.18]], 2.6);
  });
  B.tube('camo', hemR, 32, null, (pt, i, a, r) => {
    fold(pt, r, a, { y0: 0.958, h: 0.02, f: 38, amp: 0.0022, tilt: 4 });
    pt.y -= 0.004 * Math.max(0, Math.sin(a)) * Math.sin(a * 3);
  });
  B.rigid('black', box(0.012, 0.022, 0.012, 0.004), xf(0.1, 0.935, -0.12, 0.7), hips);
  B.rigid('black', box(0.012, 0.022, 0.012, 0.004), xf(-0.1, 0.935, -0.12, -0.7), hips);
}

// ---- head: knit balaclava over a skin head. Front of the face is +sin(a) (toward -Z).
const HEAD_H = [
  [1.47, 0.052, 0.05, 0.05, 0.012, [[BI.neck, 0.5], [BI.chest, 0.5]]],
  [1.52, 0.053, 0.051, 0.052, 0.01, [[BI.neck, 1]]],
  [1.568, 0.054, 0.054, 0.054, 0.006, [[BI.neck, 0.7], [BI.head, 0.3]]],
  [1.6, 0.06, 0.074, 0.062, 0.0, [[BI.neck, 0.3], [BI.head, 0.7]]],
  [1.622, 0.066, 0.079, 0.066, 0.0, [[BI.neck, 0.2], [BI.head, 0.8]]],
  [1.64, 0.068, 0.094, 0.075, 0.0, [[BI.head, 1]]],
  [1.665, 0.071, 0.1, 0.088, 0.0, [[BI.head, 1]]],
  [1.695, 0.075, 0.104, 0.096, 0.0, [[BI.head, 1]]],
  [1.725, 0.078, 0.101, 0.1, 0.0, [[BI.head, 1]]],
  [1.755, 0.079, 0.099, 0.1, 0.0, [[BI.head, 1]]],
  [1.785, 0.075, 0.09, 0.095, 0.0, [[BI.head, 1]]],
  [1.81, 0.063, 0.074, 0.08, 0.0, [[BI.head, 1]]],
  [1.83, 0.042, 0.048, 0.054, 0.0, [[BI.head, 1]]],
  [1.84, 0.004, 0.004, 0.004, 0.0, [[BI.head, 1]]],
];
// single eye slot: ellipse centre / half-height / half-width (as cos of the ring angle)
const SLOT = { y: 1.7235, hy: 0.0255, hc: 0.74 };
/** Facial relief: nose ridge, brow, cheekbones, chin, slight occipital bulge. */
function headShape(pt, a) {
  const s = Math.sin(a), c = Math.cos(a);
  if (s <= 0) { if (pt.y > 1.68 && pt.y < 1.78) pt.z += 0.004 * Math.pow(-s, 2); return; }
  const f2 = s * s, f6 = Math.pow(s, 8);
  if (pt.y > 1.665 && pt.y < 1.738) pt.z -= 0.017 * f6 * Math.sin((pt.y - 1.665) / 0.073 * Math.PI);   // nose
  if (pt.y > 1.735 && pt.y < 1.775) pt.z -= 0.007 * f2 * sstep(1.735, 1.752, pt.y) * (1 - sstep(1.762, 1.775, pt.y)); // brow ridge
  if (pt.y > 1.64 && pt.y < 1.71 && Math.abs(c) > 0.35 && Math.abs(c) < 0.85) pt.z -= 0.005 * Math.sin((Math.abs(c) - 0.35) / 0.5 * Math.PI) * Math.sin((pt.y - 1.64) / 0.07 * Math.PI); // cheekbones
  if (pt.y > 1.605 && pt.y < 1.66) pt.z -= 0.009 * f6 * Math.sin((pt.y - 1.605) / 0.055 * Math.PI);    // chin
  if (pt.y > 1.705 && pt.y < 1.742 && Math.abs(c) > 0.16 && Math.abs(c) < 0.62) pt.z += 0.004;     // eye sockets
}
const slotIn = (y, c, k) => { const u = c / (SLOT.hc * k), v = (y - SLOT.y) / (SLOT.hy * k); return u * u + v * v < 1; };

function head(B) {
  const hd = BI.head;
  const base = HEAD_H.map(([y, rx, rf, rb, cz, w]) => ring(V(0, y, cz), rx, rf, rb, w, 2));
  const rings = refine(base, zoneSplit(1.65, 1.79, 0.0165, 3));
  const N = 40;
  // knit shell with the eye slot cut out
  B.tube('knit', rings, N, null, (pt, i, a) => headShape(pt, a), (i, j, rr) => {
    const a = (j + 0.5) / N * Math.PI * 2;
    return Math.sin(a) > 0 && slotIn((rr[i].c.y + rr[i + 1].c.y) / 2, Math.cos(a), 0.86);
  });
  // skin head 7 mm inside (only visible through the slot and under the glasses)
  const inner = rings.filter(r => r.c.y > 1.655 && r.c.y < 1.79).map(r => ({ ...r, rx: r.rx - 0.007, rf: r.rf - 0.007, rb: r.rb - 0.007 }));
  inner.unshift({ ...inner[0], c: inner[0].c.clone().setY(1.65), rx: 0.004, rf: 0.004, rb: 0.004 });
  inner.push({ ...inner[inner.length - 1], c: inner[inner.length - 1].c.clone().setY(1.797), rx: 0.004, rf: 0.004, rb: 0.004 });
  B.tube('skin', inner, N, null, (pt, i, a) => headShape(pt, a));
  // rolled knit edge around the slot (a thick rope of yarn) + a darker inner shadow lip
  const surf = (y, c, grow) => {
    const k = base.findIndex(r => r.c.y >= y) - 1, A = base[k], Bq = base[k + 1], t = (y - A.c.y) / (Bq.c.y - A.c.y);
    const rx = A.rx + (Bq.rx - A.rx) * t, rf = A.rf + (Bq.rf - A.rf) * t, cz = A.c.z + (Bq.c.z - A.c.z) * t;
    const sn = Math.sqrt(Math.max(0, 1 - c * c)), pt = V((rx + grow) * c, y, cz - (rf + grow) * sn);
    headShape(pt, Math.atan2(sn, c));
    return pt;
  };
  const pts = [];
  for (let k = 0; k < 28; k++) { const t = k / 28 * Math.PI * 2; pts.push(surf(SLOT.y + SLOT.hy * Math.sin(t), SLOT.hc * Math.cos(t), 0.0035)); }
  B.rigid('knit', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 56, 0.0085, 7, true), null, hd);
}

function arm(B, side) {
  const sfx = side > 0 ? 'R' : 'L';
  const cl = BI['clav' + sfx], ua = BI['uarm' + sfx], fa = BI['farm' + sfx], hb = BI['hand' + sfx];
  const x0 = 0.19 * side, y0 = 1.44;
  // dy from shoulder joint, radius side, front, back, weights
  const A = [
    [0.07, 0.004, 0.004, 0.004, [[cl, 0.6], [ua, 0.4]]],
    [0.06, 0.04, 0.045, 0.045, [[cl, 0.55], [ua, 0.45]]],
    [0.035, 0.068, 0.07, 0.07, [[cl, 0.35], [ua, 0.65]]],
    [0.0, 0.078, 0.078, 0.076, [[ua, 0.85], [cl, 0.15]]],
    [-0.06, 0.074, 0.074, 0.072, [[ua, 1]]],
    [-0.14, 0.068, 0.068, 0.067, [[ua, 1]]],
    [-0.21, 0.064, 0.064, 0.064, [[ua, 0.95], [fa, 0.05]]],
    [-0.26, 0.06, 0.06, 0.064, [[ua, 0.75], [fa, 0.25]]],
    [-0.3, 0.058, 0.056, 0.068, [[ua, 0.5], [fa, 0.5]]],
    [-0.34, 0.057, 0.057, 0.062, [[ua, 0.2], [fa, 0.8]]],
    [-0.4, 0.055, 0.055, 0.056, [[fa, 1]]],
    [-0.48, 0.05, 0.05, 0.05, [[fa, 1]]],
    [-0.53, 0.046, 0.046, 0.046, [[fa, 1]]],
    [-0.548, 0.05, 0.05, 0.05, [[fa, 1]]], // cuff
    [-0.556, 0.047, 0.047, 0.047, [[fa, 1]]],
    [-0.552, 0.03, 0.03, 0.03, [[fa, 0.8], [hb, 0.2]]],
    [-0.54, 0.004, 0.004, 0.004, [[fa, 1]]],
  ];
  const base = A.map(([dy, rx, rf, rb, w]) => ring(V(x0, y0 + dy, 0), rx, rf, rb, w, 2));
  // deltoid dome sits slightly outboard
  base.slice(0, 3).forEach(r => (r.c.x += side * 0.01));
  const rings = refine(base, zoneSplit(y0 - 0.42, y0 - 0.19, 0.018, 3));
  B.tube('camo', rings, 16, null, (pt, i, a, r) => {
    // elbow: creases bunch on the inside of the bend, a few slack pleats all round, cuff gather
    fold(pt, r, a, { y0: y0 - 0.3, h: 0.065, f: 13, amp: 0.015, a0: Math.PI / 2, aw: 2, tilt: 1 });
    fold(pt, r, a, { y0: y0 - 0.3, h: 0.05, f: 19, amp: 0.004, a0: -Math.PI / 2, aw: 2, tilt: -1, ph: 2 });
    seam(pt, r, a, side > 0 ? Math.PI : 0, 0.0022, 0.2);                               // sleeve seam (inner)
    fold(pt, r, a, { y0: y0 - 0.3, h: 0.09, f: 9, amp: 0.004, tilt: 3, ph: 1 });
    fold(pt, r, a, { y0: y0 - 0.5, h: 0.03, f: 22, amp: 0.0035, tilt: -2 });
    // shoulder pocket bulge on the upper sleeve (outer side)
    const c = Math.cos(a) * side;
    if (pt.y < y0 - 0.06 && pt.y > y0 - 0.2 && c > 0.4) pt.x += side * 0.008 * sstep(0.4, 0.8, c);
  });
  // sleeve pocket flap + velcro patch, rigid on the upper arm
  B.rigid('camo', box(0.012, 0.13, 0.1, 0.004), xf(x0 + side * 0.078, y0 - 0.13, -0.004, 0, 0, side * -0.02), ua);
  B.rigid('web', box(0.006, 0.05, 0.07), xf(x0 + side * 0.086, y0 - 0.1, -0.004), ua);
}

function hand(B, side) {
  const hb = BI[side > 0 ? 'handR' : 'handL'];
  const o = V(0.19 * side, 0.875, 0);
  const tmp = new SkinBuilder(), tb = new SkinBuilder();
  // in hand space: length along -Y, width along Z (thumb side -Z), palm faces -X*side
  const palmDir = V(-side, 0, 0);
  const P = [
    [0.035, 0.03, 0.026, 0.026], [0.0, 0.031, 0.022, 0.024], [-0.035, 0.042, 0.02, 0.022],
    [-0.07, 0.047, 0.018, 0.02], [-0.092, 0.046, 0.017, 0.018], [-0.104, 0.034, 0.012, 0.012], [-0.108, 0.004, 0.004, 0.004],
  ];
  // ring: ax = Z (width), az = palm direction (front = palm)
  const rings = P.map(([y, w, pf, pb]) => ring(V(0, y, 0), w, pf, pb, [[hb, 1]], 2.4, PZ, palmDir));
  tmp.tube('glove', rings, 16);
  // curled fingers wrapping a ~2 cm grip: arcs around (palmDir*0.03, -0.097)
  // widths: gaps of ~2 mm between fingers so the silhouette reads as separate digits; each finger swells
  // at the knuckle and is creased at the two inner joints (the glove's phalanx segmentation)
  const fingers = [[-0.0325, 0.0092, 0.9], [-0.0108, 0.01, 1], [0.0108, 0.0097, 0.97], [0.0318, 0.0086, 0.84]];
  for (const [z, r, len] of fingers) {
    const rr = [];
    const n = 11;
    for (let k = 0; k <= n; k++) {
      const t = k / n, th = -t * Math.PI * 1.25 * len;
      const c = V(palmDir.x * 0.03 * (1 - Math.cos(th)), -0.097 + Math.sin(th) * 0.03, z);
      const sw = 1 + 0.16 * Math.exp(-Math.pow(t / 0.12, 2)) - 0.17 * Math.exp(-Math.pow((t - 0.36) / 0.055, 2)) - 0.17 * Math.exp(-Math.pow((t - 0.68) / 0.055, 2));
      const rad = k === n ? 0.002 : (k === n - 1 ? r * 0.7 : r * sw);
      rr.push(ring(c, rad, rad, rad, [[hb, 1]], 2));
    }
    // ring planes perpendicular to the path: ax = Z (across), az = path normal
    for (let k = 0; k < rr.length; k++) {
      const a = rr[Math.max(0, k - 1)].c, b = rr[Math.min(rr.length - 1, k + 1)].c;
      const tng = new THREE.Vector3().subVectors(b, a).normalize();
      rr[k].ax = PZ.clone(); rr[k].az = new THREE.Vector3().crossVectors(tng, PZ).normalize();
    }
    tmp.tube('glove', rr, 8);
    // hard-shell knuckle cap on the back of each finger base
    tb.rigid('black', box(0.008, 0.016, 0.014), xf(-palmDir.x * 0.0185, -0.083, z), hb);
  }
  // thumb: from the palm base around the far side of the grip
  const tp = [V(-side * 0.012, -0.02, -0.03), V(-side * 0.03, -0.05, -0.04), V(-side * 0.05, -0.078, -0.038), V(-side * 0.064, -0.096, -0.026), V(-side * 0.068, -0.104, -0.012)];
  const tr = tp.map((c, k) => ring(c, k === tp.length - 1 ? 0.002 : 0.011 - k * 0.0006, 0, 0, [[hb, 1]], 2));
  for (let k = 0; k < tr.length; k++) {
    const a = tp[Math.max(0, k - 1)], b = tp[Math.min(tp.length - 1, k + 1)];
    const tng = new THREE.Vector3().subVectors(b, a).normalize();
    const ax = new THREE.Vector3().crossVectors(tng, PY).normalize();
    tr[k].ax = ax; tr[k].az = new THREE.Vector3().crossVectors(tng, ax).normalize(); tr[k].rf = tr[k].rb = tr[k].rx;
  }
  tmp.tube('glove', tr, 8);
  // wrist cuff + back-of-hand shell plate
  tb.rigid('black', box(0.007, 0.03, 0.06), xf(side * 0.0195, -0.062, 0), hb);
  tmp.rigid('glove', box(0.062, 0.02, 0.07), xf(0, 0.043, 0), hb);
  const mt = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z);
  B.rigidSkinned('glove', tmp.build(), mt);
  B.rigidSkinned('black', tb.build(), mt);
}

SkinBuilder.prototype.rigidSkinned = function (key, geo, m) {
  // append a geometry that already carries skin attributes
  const G = this.g.get(key), base = G.pos.length / 3;
  const g = geo.clone(); g.applyMatrix4(m);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  for (let i = 0; i < p.count; i++) {
    G.pos.push(p.getX(i), p.getY(i), p.getZ(i)); G.nor.push(n.getX(i), n.getY(i), n.getZ(i)); G.uv.push(uv.getX(i), uv.getY(i));
    G.si.push(si.getX(i), si.getY(i), si.getZ(i), si.getW(i)); G.sw.push(sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i));
  }
  for (let i = 0; i < g.index.count; i++) G.idx.push(base + g.index.getX(i));
};

function leg(B, side) {
  const sfx = side > 0 ? 'R' : 'L';
  const th = BI['thigh' + sfx], sh = BI['shin' + sfx], ft = BI['foot' + sfx], hips = BI.hips;
  const x0 = 0.095 * side, y0 = 0.93;
  // baggy trousers: dy, rx, rf, rb, cx shift (outward), weights
  const L = [
    [0.06, 0.004, 0.004, 0.004, 0, [[hips, 0.9], [th, 0.1]]],
    [0.05, 0.06, 0.06, 0.07, 0, [[hips, 0.85], [th, 0.15]]],
    [0.0, 0.097, 0.095, 0.11, 0.004, [[hips, 0.6], [th, 0.4]]],
    [-0.07, 0.098, 0.096, 0.104, 0.006, [[th, 0.75], [hips, 0.25]]],
    [-0.16, 0.093, 0.092, 0.094, 0.006, [[th, 1]]],
    [-0.26, 0.085, 0.086, 0.084, 0.005, [[th, 1]]],
    [-0.35, 0.077, 0.08, 0.075, 0.004, [[th, 0.95], [sh, 0.05]]],
    [-0.4, 0.07, 0.074, 0.067, 0.003, [[th, 0.75], [sh, 0.25]]],
    [-0.44, 0.066, 0.07, 0.063, 0.002, [[th, 0.5], [sh, 0.5]]],
    [-0.48, 0.064, 0.065, 0.064, 0.002, [[th, 0.2], [sh, 0.8]]],
    [-0.56, 0.066, 0.062, 0.074, 0.002, [[sh, 1]]],
    [-0.65, 0.06, 0.057, 0.065, 0.002, [[sh, 1]]],
    [-0.69, 0.059, 0.057, 0.061, 0.002, [[sh, 1]]],
    // bloused over the boot top (hem ends ~21 cm above the ground so the boot ankle stays visible)
    [-0.715, 0.071, 0.07, 0.074, 0.002, [[sh, 1]]],
    [-0.738, 0.07, 0.071, 0.073, 0.002, [[sh, 1]]],
    [-0.752, 0.052, 0.054, 0.056, 0.002, [[sh, 1]]],
    [-0.748, 0.004, 0.004, 0.004, 0.002, [[sh, 1]]],
  ];
  const base = L.map(([dy, rx, rf, rb, cx, w]) => ring(V(x0 + cx * side, y0 + dy, 0), rx, rf, rb, w, 2.1));
  const rings = refine(base, (a, b) => Math.max(zoneSplit(y0 - 0.58, y0 - 0.34, 0.019, 3)(a, b), zoneSplit(y0 - 0.17, y0 + 0.02, 0.02, 3)(a, b), zoneSplit(y0 - 0.76, y0 - 0.7, 0.012, 2)(a, b)));
  B.tube('camo', rings, 16, null, (pt, i, a, r) => {
    // knee: slack trouser pleats across the front of the knee, creases behind it
    fold(pt, r, a, { y0: y0 - 0.45, h: 0.075, f: 12, amp: 0.015, a0: Math.PI / 2, aw: 2, tilt: 1 });
    fold(pt, r, a, { y0: y0 - 0.46, h: 0.06, f: 13, amp: 0.013, a0: -Math.PI / 2, aw: 2, tilt: -1, ph: 0.8 });
    fold(pt, r, a, { y0: y0 - 0.45, h: 0.12, f: 7, amp: 0.004, tilt: 3, ph: 2 });
    fold(pt, r, a, { y0: y0 - 0.2, h: 0.12, f: 4, amp: 0.004, tilt: 2, ph: 0.4 });         // slack trouser drape on the thigh
    seam(pt, r, a, side > 0 ? 0 : Math.PI, 0.003, 0.2);                                   // outer seam
    seam(pt, r, a, side > 0 ? Math.PI : 0, 0.002, 0.2);                                   // inseam
    // groin / hip creases fanning from the crotch
    fold(pt, r, a, { y0: y0 - 0.06, h: 0.07, f: 13, amp: 0.0075, a0: Math.PI / 2 + (side > 0 ? 0.7 : -0.7), aw: 2, tilt: side });
    // gathered blouse at the hem
    fold(pt, r, a, { y0: y0 - 0.715, h: 0.03, f: 24, amp: 0.0065, tilt: 5 });
    fold(pt, r, a, { y0: y0 - 0.66, h: 0.05, f: 14, amp: 0.004, tilt: -3, ph: 1.1 });        // bloused fabric sagging over the boot
    // inner-thigh flattening so the legs don't interpenetrate at the crotch
    const c = Math.cos(a) * side;
    if (c < -0.5 && pt.y > 0.72) pt.x += side * 0.012 * sstep(0.5, 1, -c) * sstep(0.72, 0.9, pt.y);
  });
  // cargo pocket on the outer thigh + flap
  B.rigid('camo', box(0.026, 0.17, 0.13, 0.012), xf(x0 + side * 0.093, y0 - 0.25, -0.005, 0, 0, side * 0.03), th);
  B.rigid('camo', box(0.03, 0.035, 0.135, 0.008), xf(x0 + side * 0.098, y0 - 0.16, -0.005, 0, 0, side * 0.03), th);
  B.rigid('metal', new THREE.CylinderGeometry(0.006, 0.006, 0.004, 10), xf(x0 + side * 0.1, y0 - 0.17, -0.07, 0, Math.PI / 2 + 0.0, 0), th);
  // knee pad (on the shin bone so it rides the kneecap)
  const pad = new THREE.SphereGeometry(0.075, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.42);
  B.rigid('black', pad, xf(x0, 0.485, -0.012, 0, -Math.PI / 2, 0, 1.0, 1.25, 1.0), sh);

  // boot: shaft (shin->foot blend) and lofted foot
  const S = [
    [0.27, 0.05, 0.052, 0.056, [[sh, 1]]],
    [0.262, 0.057, 0.058, 0.062, [[sh, 1]]],      // padded collar
    [0.215, 0.056, 0.057, 0.062, [[sh, 1]]],
    [0.17, 0.052, 0.054, 0.06, [[sh, 0.95], [ft, 0.05]]],
    [0.13, 0.047, 0.05, 0.058, [[sh, 0.6], [ft, 0.4]]],        // ankle: narrowest point, heel counter bulges behind
    [0.1, 0.049, 0.056, 0.064, [[sh, 0.25], [ft, 0.75]]],
    [0.072, 0.053, 0.062, 0.066, [[ft, 1]]],
    [0.05, 0.03, 0.03, 0.03, [[ft, 1]]],
  ];
  B.tube('boot', S.map(([y, rx, rf, rb, w]) => ring(V(x0, y, 0.006), rx, rf, rb, w, 2.2)), 18);
  // foot along -Z: ax = X (width), az = +Y (top = rf, sole = rb)
  const F = [
    [0.082, 0.004, 0.004, 0.004, 0.048],
    [0.075, 0.04, 0.035, 0.03, 0.05],
    [0.055, 0.047, 0.06, 0.035, 0.052],
    [0.02, 0.05, 0.068, 0.038, 0.052],
    [-0.03, 0.052, 0.052, 0.04, 0.05],
    [-0.08, 0.054, 0.038, 0.04, 0.048],
    [-0.13, 0.052, 0.03, 0.038, 0.046],
    [-0.17, 0.046, 0.026, 0.035, 0.045],
    [-0.195, 0.034, 0.02, 0.032, 0.046],
    [-0.21, 0.004, 0.004, 0.004, 0.044],
  ];
  B.tube('boot', F.map(([z, rx, top, bot, cy]) => ring(V(x0, cy, z - 0.035), rx, top, bot, [[ft, 1]], 2.6, AX, PY)), 18);
  // sole with heel block (black rubber) and lace strip
  B.rigid('black', box(0.112, 0.022, 0.3, 0.008), xf(x0, 0.011, -0.065), ft);
  B.rigid('black', box(0.09, 0.012, 0.085), xf(x0, 0.026, 0.02), ft);
  B.rigid('black', box(0.034, 0.008, 0.11), xf(x0, 0.1, -0.035, 0, 0.75), ft); // lacing
  // lace rungs and a gusset tongue
  for (let k = 0; k < 5; k++) B.rigid('black', box(0.05, 0.004, 0.006), xf(x0, 0.1 - k * 0.0, -0.01 - k * 0.0, 0, 0.75).multiply(xf(0, 0.012 * k - 0.02, -0.022 * k + 0.02, 0, 0)), ft);
  for (let k = 0; k < 5; k++) for (const e of [-1, 1]) B.rigid('metal', new THREE.CylinderGeometry(0.0034, 0.0034, 0.004, 8), xf(x0 + e * 0.019, 0.1, -0.01, 0, 0.75).multiply(xf(0, 0.012 * k - 0.02 + 0.005, -0.022 * k + 0.02, 0, 0)), ft);
  // sole lugs: tread blocks along both edges and a heel breast
  for (let k = 0; k < 7; k++) for (const e of [-1, 1]) B.rigid('black', box(0.016, 0.01, 0.026, 0.002), xf(x0 + e * 0.052, 0.004, -0.17 + k * 0.043), ft);
  B.rigid('black', box(0.09, 0.012, 0.008), xf(x0, 0.006, 0.0), ft);
}

function rig(B, { helmet = false, glasses = true } = {}) {
  const { chest, spine, hips, head: hd } = BI;
  // padded shoulder harness straps (front / back / over the shoulder) with sewn edges, D-rings and metal adjusters
  for (const s of [-1, 1]) {
    B.rigid('web', box(0.052, 0.33, 0.018, 0.007), xf(s * 0.1, 1.3, -0.142, 0, 0.12, s * 0.06), chest);
    B.rigid('web', box(0.052, 0.36, 0.018, 0.007), xf(s * 0.095, 1.28, 0.139, 0, -0.08, -s * 0.08), chest);
    B.rigid('web', box(0.056, 0.02, 0.27, 0.008), xf(s * 0.115, 1.478, 0.0, 0, 0, -s * 0.38), chest);
    B.rigid('black', box(0.036, 0.1, 0.006, 0.002), xf(s * 0.102, 1.355, -0.153, 0, 0.12, s * 0.06), chest);      // sewn webbing tail
    B.rigid('metal', box(0.044, 0.008, 0.008, 0.002), xf(s * 0.103, 1.405, -0.153, 0, 0.12, s * 0.06), chest);    // strap adjuster slide
    B.rigid('metal', box(0.044, 0.006, 0.008, 0.002), xf(s * 0.103, 1.3, -0.153, 0, 0.12, s * 0.06), chest);
    B.rigid('metal', new THREE.TorusGeometry(0.012, 0.0028, 6, 14), xf(s * 0.1, 1.435, -0.134, 0, 0.12, s * 0.06), chest); // D-ring
  }
  // flat admin / map panel: padded pocket body, overlapping zipped flap, velcro field, pen slots, grab loop
  B.rigid('web', box(0.24, 0.2, 0.04, 0.016), xf(0, 1.255, -0.158, 0, 0.06), chest);
  B.rigid('web', box(0.226, 0.07, 0.024, 0.01), xf(0, 1.31, -0.18, 0, 0.1), chest);                          // top flap lip
  B.rigid('black', box(0.2, 0.0055, 0.004, 0.0015), xf(0, 1.272, -0.18, 0, 0.06), chest);                    // zipper tape
  B.rigid('metal', box(0.012, 0.022, 0.006, 0.002), xf(0.085, 1.262, -0.182, 0, 0.06), chest);                // zipper pull
  B.rigid('black', box(0.1, 0.07, 0.004, 0.0015), xf(0, 1.215, -0.18, 0, 0.06), chest);                      // loop-velcro field
  for (let k = 0; k < 3; k++) B.rigid('black', box(0.012, 0.045, 0.006, 0.002), xf(-0.085 + k * 0.014, 1.205, -0.181, 0, 0.06), chest);   // pen slots
  B.rigid('web', box(0.07, 0.012, 0.014, 0.005), xf(0, 1.36, -0.173, 0, 0.12), chest);                        // grab handle
  B.rigid('metal', new THREE.CylinderGeometry(0.0048, 0.0048, 0.004, 10), xf(-0.1, 1.302, -0.194, 0, Math.PI / 2 + 0.1), chest); // snaps
  B.rigid('metal', new THREE.CylinderGeometry(0.0048, 0.0048, 0.004, 10), xf(0.1, 1.302, -0.194, 0, Math.PI / 2 + 0.1), chest);
  // padded belt as a skinned band around the waist (follows lumbar/hip blend)
  const band = [[1.025, 0.0], [1.029, 0.012], [1.036, 0.017], [1.078, 0.017], [1.085, 0.012], [1.089, 0.0]].map(([y, d]) => {
    const rx = 0.163 + (y - 1.05) * -0.05, w = y < 1.05 ? [[hips, 0.3], [spine, 0.7]] : [[spine, 0.92], [hips, 0.08]];
    return FIT ? beltRing(y, d, w) : ring(V(0, y, 0), rx + d, 0.112 + d, 0.112 + d, w, 2.6);
  });
  B.tube('web', band, 32);
  B.rigid('metal', box(0.05, 0.034, 0.008, 0.003), xf(0.162, 1.057, -0.095, -0.9, 0.04), spine);                // belt buckle (cobra)
  B.rigid('black', box(0.046, 0.012, 0.006, 0.002), xf(0.17, 1.057, -0.108, -0.9, 0.04), spine);
  // three AK magazine pouches: body, overlapping flap with stitched edge, plastic buckle, shock-cord loop, mag top
  for (const x of [-0.09, 0, 0.09]) {
    B.rigid('web', box(0.084, 0.17, 0.07, 0.02), xf(x, 1.05, -0.158, 0, 0.04), spine);
    B.rigid('web', box(0.09, 0.062, 0.078, 0.016), xf(x, 1.135, -0.16, 0, 0.18), spine);
    B.rigid('web', box(0.088, 0.008, 0.01, 0.003), xf(x, 1.105, -0.2, 0, 0.18), spine);                        // flap stitched edge
    B.rigid('black', box(0.03, 0.024, 0.007, 0.0025), xf(x, 1.1, -0.2, 0, 0.18), spine);                        // fastex buckle (plastic)
    B.rigid('metal', new THREE.CylinderGeometry(0.0042, 0.0042, 0.003, 10), xf(x, 1.138, -0.201, 0, Math.PI / 2 + 0.18), spine); // snap
    B.rigid('black', box(0.034, 0.03, 0.058, 0.006), xf(x, 1.178, -0.151, 0, 0.1), spine);                      // magazine top peeking out
    B.rigid('black', box(0.004, 0.09, 0.004, 0.0015), xf(x + 0.04, 1.09, -0.197, 0, 0.1), spine);               // shock-cord
    B.rigid('web', box(0.012, 0.1, 0.007, 0.003), xf(x + 0.032, 1.1, -0.194, 0, 0.1), spine);                   // retention tab
    B.rigid('metal', new THREE.CylinderGeometry(0.003, 0.003, 0.004, 8), xf(x, 0.965, -0.19, 0, Math.PI / 2), spine); // drain eyelet
  }
  // bulky side utility pouches
  for (const s of [-1, 1]) {
    B.rigid('web', box(0.075, 0.16, 0.17, 0.032), xf(s * 0.215, 1.045, -0.015, s * 0.05), spine);
    B.rigid('web', box(0.08, 0.05, 0.175, 0.016), xf(s * 0.218, 1.12, -0.015, s * 0.05), spine);
  }
  // canteen pouch (back left) and small dump/radio pouch (back right)
  B.rigid('web', box(0.13, 0.17, 0.075, 0.035), xf(-0.11, 1.03, 0.155, 0, -0.04), spine);
  B.rigid('metal', cyl(0.018, 0.018, 0.02, 12), xf(-0.11, 1.125, 0.155), spine);
  B.rigid('web', box(0.1, 0.13, 0.06, 0.025), xf(0.11, 1.05, 0.145, 0, -0.04), spine);

  if (!helmet) {
    // electronic hearing protection: oval cups, cushions, headband over the crown
    for (const s of [-1, 1]) {
      B.rigid('web', rcyl(0.043, 0.032, 0.012, 12), xf(s * 0.103, 1.715, 0.0, 0, 0, Math.PI / 2, 1, 1, 1.18), hd);
      B.rigid('black', new THREE.CylinderGeometry(0.04, 0.04, 0.016, 16, 1), xf(s * 0.083, 1.715, 0.0, 0, 0, Math.PI / 2, 1, 1, 1.15), hd);
      B.rigid('black', box(0.012, 0.016, 0.02), xf(s * 0.12, 1.705, -0.02), hd); // volume knob
      // yoke from cup to band
      B.rigid('web', box(0.012, 0.05, 0.016), xf(s * 0.103, 1.765, 0.0), hd);
    }
    const bandPts = [];
    for (let k = 0; k <= 16; k++) { const t = Math.PI * k / 16; bandPts.push(V(Math.cos(t) * 0.1, 1.775 + Math.sin(t) * 0.078, 0.0)); }
    const curve = new THREE.CatmullRomCurve3(bandPts);
    const bandGeo = new THREE.TubeGeometry(curve, 20, 0.009, 6, false);
    bandGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -1.775, 0).premultiply(new THREE.Matrix4().makeScale(1, 1, 1.9)).premultiply(new THREE.Matrix4().makeTranslation(0, 1.775, 0)));
    B.rigid('web', bandGeo, null, hd);
  } else helmetShell(B);

  if (!glasses) return;
  // wrap-around shooting glasses: curved lens band + temples
  const lens = new THREE.BufferGeometry();
  const lp = [], li = [], ln = [], lu = [];
  const NA = 16, NY = 3;
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NA; i++) {
    const a = -Math.PI / 2 + (i / NA - 0.5) * 2.4, y = 1.712 + (j / NY) * 0.046;
    const bulge = 1 + 0.03 * Math.sin((j / NY) * Math.PI);
    const x = Math.cos(a) * 0.09 * bulge, z = Math.sin(a) * 0.111 * bulge + 0.003;
    // nose cut-out: lower centre edge rises
    const yy = j === 0 ? y + 0.012 * Math.max(0, 1 - Math.abs(i / NA - 0.5) * 8) : y;
    lp.push(x, yy, z); lu.push(i / NA, j / NY);
    const nn = V(Math.cos(a) / 0.09, 0, Math.sin(a) / 0.111).normalize(); ln.push(nn.x, nn.y, nn.z);
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1; li.push(a, c, b, b, c, d); }
  lens.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lens.setAttribute('normal', new THREE.Float32BufferAttribute(ln, 3));
  lens.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2));
  lens.setIndex(li);
  B.rigid('lens', lens, null, hd);
  for (const s of [-1, 1]) B.rigid('black', box(0.006, 0.008, 0.1, 0.002), xf(s * 0.084, 1.748, 0.02, s * 0.05), hd);
  // frame: heavier brow bar, thin bottom rim, nose bridge and pads (matte nylon)
  const edge = (j, rad) => {
    const pp = [];
    for (let i = 0; i <= NA; i++) {
      const a = -Math.PI / 2 + (i / NA - 0.5) * 2.4, y = 1.712 + (j / NY) * 0.046;
      const bulge = 1 + 0.03 * Math.sin((j / NY) * Math.PI);
      const yy = j === 0 ? y + 0.012 * Math.max(0, 1 - Math.abs(i / NA - 0.5) * 8) : y;
      pp.push(V(Math.cos(a) * 0.0905 * bulge, yy, Math.sin(a) * 0.1115 * bulge + 0.003));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pp), 32, rad, 5, false);
  };
  B.rigid('black', edge(NY, 0.0034), null, hd);
  B.rigid('black', edge(0, 0.0018), null, hd);
  B.rigid('black', box(0.026, 0.008, 0.008, 0.003), xf(0, 1.735, -0.1125), hd);
  for (const s of [-1, 1]) B.rigid('black', box(0.004, 0.014, 0.01, 0.0015), xf(s * 0.011, 1.718, -0.106, 0, 0.3), hd);
}

// ---------------------------------------------------------------- MakeHuman body (see characters/body.js)
let FIT = null;          // null: not decided yet, false: procedural body, object: MakeHuman body in use
const lerp = (a, b, t) => a + (b - a) * t;
/** piecewise-linear lookup in rows [[y, ...values]] (sorted by y) -> values at y */
function rowsAt(rows, y) {
  if (y <= rows[0][0]) return rows[0].slice(1);
  for (let i = 1; i < rows.length; i++) if (y <= rows[i][0]) {
    const a = rows[i - 1], b = rows[i], t = (y - a[0]) / (b[0] - a[0]);
    return a.slice(1).map((v, k) => lerp(v, b[k + 1], t));
  }
  return rows[rows.length - 1].slice(1);
}
// procedural body measurements (front z, back z, half width) from the lofted torso table, for the gear refit
const OLD_TORSO = TORSO_T.filter(r => r[1] > 0.05 && r[0] <= 1.52).map(([y, rx, rf, rb, cz]) => [y, cz - rf, cz + rb, rx]);
// procedural head: eye-slot centre, half width, front / back depth, crown height
const OLD_HEAD = { c: [0, 1.7235, -0.0015], hw: 0.078, depth: 0.2005, crown: 1.84 };

/**
 * Switch the skeleton to the MakeHuman body once its asset is loaded: bone rest positions, limb lengths and pose
 * constants (RIG) come from the asset; FIT holds the bind transforms and the gear refit data. Idempotent.
 */
function setupBody() {
  if (FIT !== null) return FIT || null;
  const A = soldierBody();
  if (!A || A.bones.length !== BONE_DEFS.length || A.bones.some((b, i) => b.name !== BONE_DEFS[i][0])) { FIT = false; return null; }
  A.bones.forEach((b, i) => { BONE_DEFS[i][2] = b.rest.slice(); });
  const P = n => V(...BONE_DEFS[BI[n]][2]);
  LEN.upper = P('uarmR').distanceTo(P('farmR')); LEN.fore = P('farmR').distanceTo(P('handR'));
  LEN.thigh = P('thighR').distanceTo(P('shinR')); LEN.shin = P('shinR').distanceTo(P('footR'));
  RIG.hipY = P('hips').y; RIG.ankle = P('footR').y;
  RIG.eye = [A.eyeR[0] - P('head').x, A.eyeR[1] - P('head').y, A.eyeR[2] - P('head').z];
  RIG.gripR = [A.grip.R[0], A.grip.R[1], 0.004]; RIG.gripL = [A.grip.L[0], A.grip.L[1], 0.0];
  RIG.chest = P('chest').toArray(); RIG.mh = true;
  // rest (identity, arms hanging) -> bind (A pose) per bone
  const xf = A.bones.map((b) => {
    const bind = new THREE.Matrix4().compose(V(...b.bindPos), new THREE.Quaternion(...b.bindQuat), V(1, 1, 1));
    const m = bind.multiply(new THREE.Matrix4().makeTranslation(-b.rest[0], -b.rest[1], -b.rest[2]));
    return m.equals(new THREE.Matrix4()) ? null : m;
  });
  const L = A.landmarks, H = L.head;
  const hc = [0, H.eyeY, (H.browFront + H.back) / 2];
  const headM = new THREE.Matrix4().makeTranslation(hc[0], hc[1], hc[2])
    .multiply(new THREE.Matrix4().makeScale(H.halfWidth / OLD_HEAD.hw, (H.top - H.eyeY) / (OLD_HEAD.crown - OLD_HEAD.c[1]), (H.back - H.browFront) / OLD_HEAD.depth))
    .multiply(new THREE.Matrix4().makeTranslation(-OLD_HEAD.c[0], -OLD_HEAD.c[1], -OLD_HEAD.c[2]));
  FIT = { A, xf, headM, torso: L.torso, limb: L.limb, head: H };
  return FIT;
}

/** Refit a gear piece authored for the procedural body (identity-rest space) onto the MakeHuman body. */
function fitGear(g, bone) {
  if (bone === BI.head || bone === BI.neck) { g.applyMatrix4(FIT.headM); return; }
  if (bone !== BI.hips && bone !== BI.spine && bone !== BI.chest) return;
  // torso gear: rigid shift so the piece keeps its stand-off from the jacket surface (front / back / side)
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  const [oF, oB, oW] = rowsAt(OLD_TORSO, c.y), [nF, nB, nW] = rowsAt(FIT.torso, c.y);
  const oc = (oF + oB) / 2, t = Math.min(1, Math.max(-1, (c.z - oc) / ((oB - oF) / 2)));
  const dz = lerp(nF - oF, nB - oB, (t + 1) / 2);
  const dx = Math.sign(c.x) * (nW - oW) * Math.min(1, Math.abs(c.x) / oW);
  g.translate(dx, 0, dz);
}

/**
 * Append one LOD of the body asset; groups are mapped to builder material keys (all to `only` if given). The close LOD
 * holds two heads: 'knit' + 'skin' (balaclava with an eye opening, OPFOR) and 'face' + 'hair' (bare head with short
 * hair, Swedish Home Guard); `kind` picks one. 'gaiter' (the knit below the jaw) is worn by both. Face, hair and the
 * eyeballs all use the skin material (one draw call; the shader tells them apart by their UVs, see characters/skin.js).
 */
function addBody(B, lod, only, kind = 'opfor') {
  const { position, normal, uv, skinIndex, skinWeight } = lod.attrs;
  const ix = lod.index.array;
  const map = { camo: 'camo', knit: 'knit', gaiter: 'knit', boot: 'boot', lens: 'skin', eye: 'skin', glove: 'glove', skin: 'skin', sole: 'black', face: 'skin', hair: 'skin' };
  const skip = kind === 'opfor' ? ['face', 'hair'] : ['knit', 'skin'];
  for (const gr of lod.groups) {
    if (!only && skip.includes(gr.name)) continue;
    const G = B.g.get(only || map[gr.name] || 'camo');
    const remap = new Map();
    for (let k = gr.start; k < gr.start + gr.count; k++) {
      const i = ix[k];
      let j = remap.get(i);
      if (j === undefined) {
        j = G.pos.length / 3; remap.set(i, j);
        G.pos.push(position.getX(i), position.getY(i), position.getZ(i));
        G.nor.push(normal.getX(i), normal.getY(i), normal.getZ(i));
        G.uv.push(uv.getX(i), uv.getY(i));
        G.si.push(skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i));
        G.sw.push(skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i));
      }
      G.idx.push(j);
    }
  }
}

/** Belt band ring for the MakeHuman torso (replaces the procedural ellipse) */
function beltRing(y, d, w) {
  const [nF, nB, nW] = rowsAt(FIT.torso, y);
  return ring(V(0, y, (nF + nB) / 2), nW + 0.004 + d, (nB - nF) / 2 + 0.006 + d, (nB - nF) / 2 + 0.006 + d, w, 2.6);
}

/** Limb gear on the MakeHuman body, authored directly in its identity-rest space. */
function bodyGear(B) {
  const Lm = FIT.limb;
  for (const side of [1, -1]) {
    const sfx = side > 0 ? 'R' : 'L';
    const ua = BI['uarm' + sfx], th = BI['thigh' + sfx], sh = BI['shin' + sfx], ft = BI['foot' + sfx];
    const [ux, uy, uz] = BONE_DEFS[ua][2], [tx, ty, tz] = BONE_DEFS[th][2], [sx, sy, sz] = BONE_DEFS[sh][2], [fx, , fz] = BONE_DEFS[ft][2];
    // sleeve pocket flap + velcro field on the outer upper arm
    B.rigid('camo', box(0.012, 0.12, 0.09, 0.004), xf(ux + side * (Lm.uarmOut - 0.002), uy - 0.135, uz + 0.004, 0, 0, side * -0.04), ua);
    B.rigid('web', box(0.006, 0.05, 0.065), xf(ux + side * (Lm.uarmOut + 0.004), uy - 0.105, uz + 0.004, 0, 0, side * -0.04), ua);
    // cargo pocket on the outer thigh + flap + snap
    B.rigid('camo', box(0.024, 0.17, 0.13, 0.011), xf(tx + side * (Lm.thighOut + 0.006), ty - 0.27, tz - 0.012, 0, 0, side * 0.035), th);
    B.rigid('camo', box(0.028, 0.035, 0.136, 0.008), xf(tx + side * (Lm.thighOut + 0.009), ty - 0.18, tz - 0.012, 0, 0, side * 0.035), th);
    B.rigid('metal', new THREE.CylinderGeometry(0.006, 0.006, 0.004, 10), xf(tx + side * (Lm.thighOut + 0.024), ty - 0.19, tz - 0.075, 0, Math.PI / 2, 0), th);
    // knee pad (shin bone so it rides the kneecap)
    const pad = new THREE.SphereGeometry(0.072, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.42);
    B.rigid('black', pad, xf(sx, sy - 0.02, sz + Lm.kneeFront + 0.055, 0, -Math.PI / 2, 0, 1.0, 1.25, 0.9), sh);
    // boot lacing along the instep: tongue strip, lace rungs, eyelets
    const [i0, i1] = Lm.instep;           // [z, y] at the toe end / ankle end, relative to the ankle
    const ax = Math.atan2(i1[1] - i0[1], i1[0] - i0[0]), len = Math.hypot(i1[1] - i0[1], i1[0] - i0[0]);
    const mid = [(i0[0] + i1[0]) / 2, (i0[1] + i1[1]) / 2];
    B.rigid('black', box(0.03, 0.006, len), xf(fx, RIG.ankle + mid[1] + 0.004, fz + mid[0], 0, -ax), ft);
    for (let k = 0; k < 5; k++) {
      const t = 0.1 + k * 0.2, z = lerp(i0[0], i1[0], t), y = RIG.ankle + lerp(i0[1], i1[1], t) + 0.007;
      B.rigid('black', box(0.046, 0.004, 0.006), xf(fx, y, fz + z, 0, -ax), ft);
      for (const e of [-1, 1]) B.rigid('metal', new THREE.CylinderGeometry(0.0034, 0.0034, 0.004, 8), xf(fx + e * 0.02, y - 0.002, fz + z, 0, -ax), ft);
    }
  }
}

/** Far LOD (> 42 m, puddle reflection, shadows of distant soldiers): decimated body + a few boxes, ONE group. */
function farGeometry(kind) {
  const B = new SkinBuilder();
  B.fit = fitGear; B.xf = FIT.xf;
  addBody(B, FIT.A.lods.far, 'camo');
  const { chest, spine, head: hd } = BI;
  B.rigid('camo', box(0.26, 0.24, 0.05), xf(0, 1.27, -0.155), chest);              // chest rig
  B.rigid('camo', box(0.3, 0.17, 0.07), xf(0, 1.05, -0.158), spine);               // magazine pouches
  for (const s of [-1, 1]) B.rigid('camo', box(0.075, 0.16, 0.17), xf(s * 0.215, 1.045, -0.015), spine);
  B.rigid('camo', box(0.26, 0.17, 0.07), xf(0, 1.035, 0.15), spine);               // back pouches
  if (kind === 'hv_helmet') B.rigid('camo', new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), xf(0, 1.69, 0.004, 0, 0, 0, 0.88, 1.35, 1), hd);
  else for (const s of [-1, 1]) B.rigid('camo', box(0.03, 0.08, 0.07), xf(s * 0.1, 1.715, 0), hd);  // earmuffs
  const g = B.build();
  g.computeBoundingSphere();
  return g;
}

const geoCache = {};
/**
 * kind: 'opfor' (earmuffs + glasses), 'hv' (Swedish Home Guard, earmuffs), 'hv_helmet' (helmet with M90 cover).
 * Rest pose and skeleton are identical for all kinds.
 */
export function soldierGeometry(kind = 'opfor') {
  if (geoCache[kind]) return geoCache[kind];
  const B = new SkinBuilder();
  const helmet = kind === 'hv_helmet';
  if (setupBody()) {
    addBody(B, FIT.A.lods.close, null, kind);
    B.fit = fitGear; B.xf = FIT.xf;
    bodyGear(B);
  } else {
    torso(B); head(B);
    arm(B, 1); arm(B, -1); hand(B, 1); hand(B, -1);
    leg(B, 1); leg(B, -1);
  }
  // OPFOR wear tinted shooting glasses over the balaclava; the bare-headed Home Guard soldiers do not (the glasses
  // are fitted to the balaclava head)
  rig(B, { helmet, glasses: kind === 'opfor' });
  if (kind !== 'opfor') hvInsignia(B, helmet);
  const g = geoCache[kind] = B.build();
  g.computeBoundingSphere();
  if (FIT) g.userData.far = farGeometry(kind);
  return g;
}

/** Sleeve patches (Swedish flag on the left sleeve, generic HV shield on the right) + helmet gear. */
function hvInsignia(B, helmet) {
  const { uarmL, uarmR, head: hd } = BI;
  const quad = (u0, u1, w, h) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + (u1 - u0) * uv.getX(i));
    return g;
  };
  // flag: atlas u 0..0.5 ; shield: u 0.5..1.  Patches sit on the outer face of the upper sleeve (x = +-(0.19+0.092))
  // MakeHuman body: on the outer sleeve just below the shoulder seam, above the pocket flap
  const [ux, uy, uz] = BONE_DEFS[uarmR][2];
  const X = FIT ? ux + FIT.limb.uarmOut + 0.0125 : 0.19 + 0.0865, Y = FIT ? uy - 0.06 : 1.4, Z = FIT ? uz - 0.002 : -0.004;
  B.rigid('patch', quad(0, 0.5, 0.052, 0.034), xf(-X, Y, Z, -Math.PI / 2), uarmL);
  B.rigid('patch', quad(0.5, 1, 0.042, 0.048), xf(X, Y, Z, Math.PI / 2), uarmR);
  // hook-and-loop backing field behind each patch
  B.rigid('black', box(0.012, 0.042, 0.058, 0.003), xf(-X + 0.008, Y, Z), uarmL);
  B.rigid('black', box(0.012, 0.056, 0.05, 0.003), xf(X - 0.008, Y, Z), uarmR);
}

/** New skeleton + SkinnedMesh sharing the cached geometry. */
export function createSoldierMesh(materials, kind = 'opfor') {
  const geo = soldierGeometry(kind);
  const bones = BONE_DEFS.map(([name]) => { const b = new THREE.Bone(); b.name = name; return b; });
  BONE_DEFS.forEach(([, parent, p], i) => {
    const pp = parent >= 0 ? BONE_DEFS[parent][2] : [0, 0, 0];
    bones[i].position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    if (parent >= 0) bones[parent].add(bones[i]);
  });
  const mesh = new THREE.SkinnedMesh(geo, geo.userData.names.map(k => materials[k]));
  mesh.add(bones[0]);
  if (FIT) {
    // bind in the MakeHuman A pose (bone orientations from the asset), then return to the identity rest pose
    const q = FIT.A.bones.map(b => new THREE.Quaternion(...b.bindQuat));
    BONE_DEFS.forEach(([, parent], i) => bones[i].quaternion.copy(parent >= 0 ? q[parent].clone().invert().multiply(q[i]) : q[i]));
  }
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  if (FIT) { bones.forEach(b => b.quaternion.identity()); mesh.updateMatrixWorld(true); }
  mesh.castShadow = true; mesh.receiveShadow = true;
  // generous fixed bounds (covers lying poses) so culling never uses stale skinned bounds
  mesh.boundingSphere = new THREE.Sphere(V(0, 0.8, 0), 2.0);
  const rest = bones.map(b => b.position.clone());
  return { mesh, bones, rest };
}

/** Swedish-style combat helmet (hjälm 18 type): low-cut shell with M90 cover, ear cut-outs, rail shroud, chin strap. */
function helmetShell(B) {
  const hd = BI.head;
  const H = [
    [1.66, 0.098, 0.112, 0.118],
    [1.69, 0.103, 0.119, 0.124],
    [1.73, 0.104, 0.121, 0.124],
    [1.77, 0.1, 0.116, 0.119],
    [1.805, 0.088, 0.1, 0.104],
    [1.835, 0.066, 0.076, 0.08],
    [1.855, 0.034, 0.04, 0.042],
    [1.862, 0.004, 0.004, 0.004],
  ];
  const rings = H.map(([y, rx, rf, rb]) => ring(V(0, y, 0.004), rx, rf, rb, [[hd, 1]], 2.5));
  B.tube('camo', rings, 24, null, (pt, i, a) => {
    // front brim sweeps down, back lip kicks out, sides cut high above the ears
    const s = Math.sin(a), c = Math.cos(a);
    if (i === 0) { pt.y += (s < 0 ? 0.0 : -0.008) - Math.pow(Math.abs(c), 4) * 0.045; if (s < 0) pt.y -= 0.004; }
    if (i === 1) pt.y -= Math.pow(Math.abs(c), 4) * 0.02;
  });
  // rim edge roll, front rail shroud and strap
  B.rigid('black', box(0.05, 0.012, 0.02, 0.004), xf(0, 1.752, -0.128, 0, -0.12), hd);
  B.rigid('black', box(0.012, 0.05, 0.012), xf(0.075, 1.65, -0.07, 0, 0, 0.1), hd);
  B.rigid('black', box(0.012, 0.05, 0.012), xf(-0.075, 1.65, -0.07, 0, 0, -0.1), hd);
  B.rigid('web', box(0.012, 0.06, 0.012), xf(0.08, 1.60, 0.0), hd);
  B.rigid('web', box(0.012, 0.06, 0.012), xf(-0.08, 1.60, 0.0), hd);
  B.rigid('black', box(0.05, 0.03, 0.02, 0.008), xf(0, 1.56, -0.04), hd);       // chin cup
  // rear counterweight / net pouch
  B.rigid('black', box(0.1, 0.03, 0.025, 0.008), xf(0, 1.69, 0.125), hd);
}
