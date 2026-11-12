// Procedural skinned soldier: ONE THREE.SkinnedMesh per guard.
//
// The body is lofted from elliptical / super-elliptical cross-sections along a
// 19-bone skeleton (rest pose: standing, arms hanging, facing -Z, feet on y=0).
// Skin weights blend across knees, elbows, hips, spine and neck so joints bend
// without seams. Gear (chest rig, pouches, earmuffs, glasses, gloves, boots) is
// appended to the same geometry, rigidly weighted to one bone each, so a guard
// is a single skinned draw per material group (7 groups).
//
// All geometry is original procedural work (no imported assets).
import * as THREE from 'three';
import { box, rcyl, cyl } from '../geo.js';

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

// material group order of the skinned mesh
export const GROUPS = ['camo', 'knit', 'black', 'boot', 'web', 'lens', 'glove'];

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const AX = V(1, 0, 0), NZ = V(0, 0, -1), PY = V(0, 1, 0), PZ = V(0, 0, 1);

class SkinBuilder {
  constructor() { this.g = new Map(GROUPS.map(k => [k, { pos: [], nor: [], uv: [], si: [], sw: [], idx: [] }])); }

  /**
   * Loft a closed tube through rings. ring: {c, ax, az, rx, rf, rb, p, w:[[bone,weight],..]}
   * cross-section point(a) = c + ax*rx*cos(a) + az*(sin(a)>0 ? rf : rb)*sin(a)  (super-ellipse exponent p)
   */
  tube(key, rings, N, wfn, shape) {
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
    GROUPS.forEach((k, mi) => {
      const G = this.g.get(k), off = pos.length / 3, start = idx.length;
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

// ---------------------------------------------------------------- body parts
function torso(B) {
  const { hips, spine, chest, neck, clavR, clavL } = BI;
  // y, half-width, front depth, back depth, centre z, superellipse p, weights
  const T = [
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
  ];
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
    fold(pt, r, a, { y0: 1.125, h: 0.032, f: 17, amp: 0.0045, tilt: 2 });
    fold(pt, r, a, { y0: 0.965, h: 0.03, f: 16, amp: 0.0045, tilt: -3, ph: 1.3 });
    // armpit creases where the sleeve meets the body
    fold(pt, r, a, { y0: 1.37, h: 0.04, f: 16, amp: 0.003, a0: 0, aw: 6, tilt: 1 });
    fold(pt, r, a, { y0: 1.37, h: 0.04, f: 16, amp: 0.003, a0: Math.PI, aw: 6, tilt: 1 });
  });
}

function head(B) {
  const { neck, head: hd, chest } = BI;
  const H = [
    [1.47, 0.052, 0.05, 0.05, 0.012, [[neck, 0.5], [chest, 0.5]]],
    [1.52, 0.058, 0.055, 0.056, 0.01, [[neck, 1]]],
    [1.575, 0.061, 0.06, 0.058, 0.004, [[neck, 0.7], [hd, 0.3]]],
    [1.615, 0.064, 0.075, 0.062, 0.0, [[neck, 0.25], [hd, 0.75]]],
    [1.64, 0.068, 0.094, 0.075, 0.0, [[hd, 1]]],
    [1.665, 0.071, 0.1, 0.088, 0.0, [[hd, 1]]],
    [1.695, 0.075, 0.104, 0.096, 0.0, [[hd, 1]]],
    [1.725, 0.078, 0.101, 0.1, 0.0, [[hd, 1]]],
    [1.755, 0.079, 0.099, 0.1, 0.0, [[hd, 1]]],
    [1.785, 0.075, 0.09, 0.095, 0.0, [[hd, 1]]],
    [1.81, 0.063, 0.074, 0.08, 0.0, [[hd, 1]]],
    [1.83, 0.042, 0.048, 0.054, 0.0, [[hd, 1]]],
    [1.84, 0.004, 0.004, 0.004, 0.0, [[hd, 1]]],
  ];
  const rings = H.map(([y, rx, rf, rb, cz, w]) => ring(V(0, y, cz), rx, rf, rb, w, 2));
  B.tube('knit', rings, 24, null, (pt, i, a) => {
    const s = Math.sin(a), c = Math.cos(a);
    if (s > 0) return; // back of head
    const front = Math.pow(Math.max(0, -s), 6);
    // nose ridge under the knit, brow, chin; cheeks slightly flatter
    if (pt.y > 1.672 && pt.y < 1.735) pt.z -= 0.014 * front * Math.sin((pt.y - 1.672) / 0.063 * Math.PI);
    if (pt.y > 1.735 && pt.y < 1.775) pt.z -= 0.005 * Math.pow(Math.max(0, -s), 2);
    if (pt.y > 1.7 && pt.y < 1.745 && Math.abs(c) > 0.2 && Math.abs(c) < 0.6) pt.z += 0.006; // eye sockets
    if (pt.y > 1.6 && pt.y < 1.66) pt.z -= 0.006 * front;
  });
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
    fold(pt, r, a, { y0: y0 - 0.3, h: 0.06, f: 15, amp: 0.006, a0: Math.PI / 2, aw: 2, tilt: 1 });
    fold(pt, r, a, { y0: y0 - 0.3, h: 0.08, f: 11, amp: 0.0025, tilt: 3, ph: 1 });
    fold(pt, r, a, { y0: y0 - 0.5, h: 0.03, f: 22, amp: 0.002, tilt: -2 });
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
    [-0.7, 0.057, 0.055, 0.059, 0.002, [[sh, 1]]],
    // bloused over the boot top (hem ends ~21 cm above the ground so the boot ankle stays visible)
    [-0.724, 0.064, 0.063, 0.066, 0.002, [[sh, 1]]],
    [-0.742, 0.063, 0.064, 0.065, 0.002, [[sh, 1]]],
    [-0.752, 0.052, 0.054, 0.056, 0.002, [[sh, 1]]],
    [-0.748, 0.004, 0.004, 0.004, 0.002, [[sh, 1]]],
  ];
  const base = L.map(([dy, rx, rf, rb, cx, w]) => ring(V(x0 + cx * side, y0 + dy, 0), rx, rf, rb, w, 2.1));
  const rings = refine(base, (a, b) => Math.max(zoneSplit(y0 - 0.58, y0 - 0.34, 0.019, 3)(a, b), zoneSplit(y0 - 0.17, y0 + 0.02, 0.02, 3)(a, b), zoneSplit(y0 - 0.76, y0 - 0.7, 0.012, 2)(a, b)));
  B.tube('camo', rings, 16, null, (pt, i, a, r) => {
    // knee: slack trouser pleats across the front of the knee, creases behind it
    fold(pt, r, a, { y0: y0 - 0.45, h: 0.07, f: 13, amp: 0.006, a0: Math.PI / 2, aw: 2, tilt: 1 });
    fold(pt, r, a, { y0: y0 - 0.46, h: 0.06, f: 14, amp: 0.006, a0: -Math.PI / 2, aw: 2, tilt: -1, ph: 0.8 });
    fold(pt, r, a, { y0: y0 - 0.45, h: 0.1, f: 9, amp: 0.0025, tilt: 3, ph: 2 });
    // groin / hip creases fanning from the crotch
    fold(pt, r, a, { y0: y0 - 0.06, h: 0.07, f: 14, amp: 0.005, a0: Math.PI / 2 + (side > 0 ? 0.7 : -0.7), aw: 2, tilt: side });
    // gathered blouse at the hem
    fold(pt, r, a, { y0: y0 - 0.715, h: 0.025, f: 30, amp: 0.0035, tilt: 5 });
    // inner-thigh flattening so the legs don't interpenetrate at the crotch
    const c = Math.cos(a) * side;
    if (c < -0.5 && pt.y > 0.72) pt.x += side * 0.012 * sstep(0.5, 1, -c) * sstep(0.72, 0.9, pt.y);
  });
  // cargo pocket on the outer thigh + flap
  B.rigid('camo', box(0.026, 0.17, 0.13, 0.012), xf(x0 + side * 0.093, y0 - 0.25, -0.005, 0, 0, side * 0.03), th);
  B.rigid('camo', box(0.03, 0.035, 0.135, 0.008), xf(x0 + side * 0.098, y0 - 0.16, -0.005, 0, 0, side * 0.03), th);
  // knee pad (on the shin bone so it rides the kneecap)
  const pad = new THREE.SphereGeometry(0.075, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.42);
  B.rigid('web', pad, xf(x0, 0.485, -0.012, 0, -Math.PI / 2, 0, 1.0, 1.25, 1.0), sh);

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
}

function rig(B) {
  const { chest, spine, hips, head: hd } = BI;
  // shoulder harness straps (front / back / over the shoulder)
  for (const s of [-1, 1]) {
    B.rigid('web', box(0.048, 0.33, 0.012), xf(s * 0.1, 1.3, -0.14, 0, 0.12, s * 0.06), chest);
    B.rigid('web', box(0.048, 0.36, 0.012), xf(s * 0.095, 1.28, 0.137, 0, -0.08, -s * 0.08), chest);
    B.rigid('web', box(0.05, 0.014, 0.27), xf(s * 0.115, 1.476, 0.0, 0, 0, -s * 0.38), chest);
    // strap adjusters
    B.rigid('black', box(0.04, 0.012, 0.008), xf(s * 0.103, 1.4, -0.13, 0, 0.12, s * 0.06), chest);
  }
  // flat admin / map panel with flap, zip seam and pen loops
  B.rigid('web', box(0.24, 0.2, 0.038, 0.012), xf(0, 1.255, -0.158, 0, 0.06), chest);
  B.rigid('web', box(0.236, 0.05, 0.02, 0.008), xf(0, 1.33, -0.18, 0, 0.12), chest);
  B.rigid('black', box(0.21, 0.004, 0.004), xf(0, 1.2, -0.178, 0, 0.06), chest);
  // padded belt as a skinned band around the waist (follows lumbar/hip blend)
  const band = [[1.025, 0.0], [1.03, 0.016], [1.085, 0.016], [1.09, 0.0]].map(([y, d]) => {
    const rx = 0.163 + (y - 1.05) * -0.05, w = y < 1.05 ? [[hips, 0.3], [spine, 0.7]] : [[spine, 0.92], [hips, 0.08]];
    return ring(V(0, y, 0), rx + d, 0.112 + d, 0.112 + d, w, 2.6);
  });
  B.tube('web', band, 32);
  // three AK magazine pouches with flaps
  for (const x of [-0.09, 0, 0.09]) {
    B.rigid('web', box(0.082, 0.17, 0.066, 0.014), xf(x, 1.05, -0.158, 0, 0.04), spine);
    B.rigid('web', box(0.086, 0.06, 0.072, 0.012), xf(x, 1.135, -0.16, 0, 0.18), spine);
    B.rigid('black', box(0.03, 0.025, 0.004), xf(x, 1.1, -0.197, 0, 0.18), spine); // fastex buckle
  }
  // bulky side utility pouches
  for (const s of [-1, 1]) {
    B.rigid('web', box(0.075, 0.16, 0.17, 0.032), xf(s * 0.215, 1.045, -0.015, s * 0.05), spine);
    B.rigid('web', box(0.08, 0.05, 0.175, 0.016), xf(s * 0.218, 1.12, -0.015, s * 0.05), spine);
  }
  // canteen pouch (back left) and small dump/radio pouch (back right)
  B.rigid('web', box(0.13, 0.17, 0.075, 0.035), xf(-0.11, 1.03, 0.155, 0, -0.04), spine);
  B.rigid('black', cyl(0.018, 0.018, 0.02, 12), xf(-0.11, 1.125, 0.155), spine);
  B.rigid('web', box(0.1, 0.13, 0.06, 0.025), xf(0.11, 1.05, 0.145, 0, -0.04), spine);

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

  // wrap-around shooting glasses: curved lens band + temples
  const lens = new THREE.BufferGeometry();
  const lp = [], li = [], ln = [], lu = [];
  const NA = 16, NY = 3;
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NA; i++) {
    const a = -Math.PI / 2 + (i / NA - 0.5) * 2.4, y = 1.712 + (j / NY) * 0.046;
    const bulge = 1 + 0.03 * Math.sin((j / NY) * Math.PI);
    const x = Math.cos(a) * 0.09 * bulge, z = Math.sin(a) * 0.116 * bulge + 0.003;
    // nose cut-out: lower centre edge rises
    const yy = j === 0 ? y + 0.012 * Math.max(0, 1 - Math.abs(i / NA - 0.5) * 8) : y;
    lp.push(x, yy, z); lu.push(i / NA, j / NY);
    const nn = V(Math.cos(a) / 0.09, 0, Math.sin(a) / 0.116).normalize(); ln.push(nn.x, nn.y, nn.z);
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1; li.push(a, c, b, b, c, d); }
  lens.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lens.setAttribute('normal', new THREE.Float32BufferAttribute(ln, 3));
  lens.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2));
  lens.setIndex(li);
  B.rigid('lens', lens, null, hd);
  for (const s of [-1, 1]) B.rigid('black', box(0.006, 0.008, 0.1), xf(s * 0.084, 1.748, 0.02, s * 0.05), hd);
}

let cachedGeo = null;
export function soldierGeometry() {
  if (cachedGeo) return cachedGeo;
  const B = new SkinBuilder();
  torso(B); head(B);
  arm(B, 1); arm(B, -1); hand(B, 1); hand(B, -1);
  leg(B, 1); leg(B, -1);
  rig(B);
  cachedGeo = B.build();
  cachedGeo.computeBoundingSphere();
  return cachedGeo;
}

/** New skeleton + SkinnedMesh sharing the cached geometry. */
export function createSoldierMesh(materials) {
  const geo = soldierGeometry();
  const bones = BONE_DEFS.map(([name]) => { const b = new THREE.Bone(); b.name = name; return b; });
  BONE_DEFS.forEach(([, parent, p], i) => {
    const pp = parent >= 0 ? BONE_DEFS[parent][2] : [0, 0, 0];
    bones[i].position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    if (parent >= 0) bones[parent].add(bones[i]);
  });
  const mesh = new THREE.SkinnedMesh(geo, GROUPS.map(k => materials[k]));
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true; mesh.receiveShadow = true;
  // generous fixed bounds (covers lying poses) so culling never uses stale skinned bounds
  mesh.boundingSphere = new THREE.Sphere(V(0, 0.8, 0), 2.0);
  const rest = bones.map(b => b.position.clone());
  return { mesh, bones, rest };
}
