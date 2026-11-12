// Geometry helpers for the first-person viewmodel (no materials, no DOM: node-testable).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export { V };

/** Merge [geometry, matrix?] pairs. wear: bake edge/scuff brightness into vertex colours. */
export function merge(list, wear = 0) {
  const gs = list.map(([g, m]) => {
    const x = g.index ? g.toNonIndexed() : g.clone();
    if (m) x.applyMatrix4(m);
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
    return x;
  });
  const out = mergeGeometries(gs);
  if (wear > 0) {
    const p = out.attributes.position, n = out.attributes.normal, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      // bevel vertices have normals between axes: bare metal shows through there
      const edge = 1 - Math.max(Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i)));
      const h = Math.sin(p.getX(i) * 311.7 + p.getY(i) * 183.3 + p.getZ(i) * 521.9) * 43758.5453;
      const scuff = h - Math.floor(h);
      const k = 0.78 + Math.min(1, edge * 6) * wear * 1.5 + (scuff > 0.93 ? 0.35 * wear : 0) + (scuff < 0.2 ? -0.1 : 0);
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k;
    }
    out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return out;
}

function scaleUV(g, a, b) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * a, uv.getY(i) * b); }

/** Tapered capsule between points a and b (round caps), optionally flattened in local XZ. */
export function seg(a, b, r0, r1, flat = 1, radial = 10) {
  const A = new THREE.Vector3().copy(a), B = new THREE.Vector3().copy(b), len = Math.max(1e-4, A.distanceTo(B));
  const pts = [];
  for (let i = 0; i <= 3; i++) { const t = -Math.PI / 2 + i / 3 * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(t) * r0, Math.sin(t) * r0)); }
  for (let i = 1; i <= 3; i++) { const t = i / 3 * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(t) * r1, len + Math.sin(t) * r1)); }
  const g = new THREE.LatheGeometry(pts, radial);
  scaleUV(g, Math.PI * 2 * Math.max(r0, r1), len + r0 + r1);
  g.scale(1, 1, flat);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A, q, V(1, 1, 1)));
  return g;
}

/** Ellipsoid with radii (rx, ry, rz) at p, Euler rotation e. */
export function ell(p, r, e = [0, 0, 0], w = 12, h = 8) {
  const g = new THREE.SphereGeometry(1, w, h);
  scaleUV(g, 0.15, 0.1);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2], 'YXZ'));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().copy(p), q, V(r[0], r[1], r[2])));
  return g;
}

/** Three-phalanx finger: curls rotate the direction about `axis`. Returns geometry list + tip position/direction. */
export function finger(out, p, d, axis, curls, lens, radii, flat = 0.92) {
  let P = p.clone(), D = d.clone().normalize();
  for (let i = 0; i < curls.length; i++) {
    D.applyAxisAngle(axis, curls[i]);
    const Q = P.clone().addScaledVector(D, lens[i]);
    out.push([seg(P, Q, radii[i], radii[i + 1], flat, 9), null]);
    P = Q;
  }
  return { tip: P, dir: D };
}

/** Baggy sleeve: lathe along +Y from 0..len with folds, flaring at the cuff end (y=0). */
export function sleeve(a, b, rCuff, rElbow, len = null) {
  const A = new THREE.Vector3().copy(a), B = new THREE.Vector3().copy(b), L = len ?? A.distanceTo(B);
  const pts = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let r = rCuff + (rElbow - rCuff) * Math.pow(t, 0.8);
    r += Math.sin(t * 17) * 0.0022 * (1 - t * 0.5);            // fabric wrinkles
    if (t < 0.12) r += (0.12 - t) * 0.045;                       // bunching/flare at the cuff
    pts.push(new THREE.Vector2(r, t * L));
  }
  pts.unshift(new THREE.Vector2(rCuff * 0.7, -0.004)); // inside lip of the cuff
  const g = new THREE.LatheGeometry(pts, 20);
  scaleUV(g, Math.PI * 2 * rElbow, 1);
  g.scale(1, 1, 0.84);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A, q, V(1, 1, 1)));
  return g;
}

/** Elliptical-section grip/handle lathe along +Y centred on 0, with radial profile. */
export function profileLathe(profile, sx = 1, sz = 1, seg = 18) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  scaleUV(g, 0.12, 1);
  g.scale(sx, 1, sz);
  return g;
}

export function countTris(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }
