// Geometry helpers. All UVs are in metres so textures keep a consistent
// texel density; materials convert with repeat = 1 / tile size.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function xform(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// Edge detail: real objects never have perfectly sharp 90° edges. Every box is
// built with a small rounded bevel so edges catch highlights instead of
// reading as blocky voxels. Segments are raised on high quality.
let BEVEL_SEGMENTS = 1;
export function setGeoDetail(segments) { BEVEL_SEGMENTS = segments; }
const boxCache = new Map();

/** Box-projected metric UVs (dominant normal axis), used for bevelled boxes. */
function boxProjectUV(g) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) uv.setXY(i, p.getZ(i) * -Math.sign(n.getX(i)), p.getY(i));
    else if (ay >= az) uv.setXY(i, p.getX(i), p.getZ(i) * -Math.sign(n.getY(i)));
    else uv.setXY(i, p.getX(i) * Math.sign(n.getZ(i)), p.getY(i));
  }
}

/**
 * Box with rounded/bevelled edges and metric UVs; origin at centre.
 * bevel: radius in metres (default scales with the smallest dimension, max 3 cm).
 */
export function box(w, h, d, bevel) {
  const mn = Math.min(w, h, d);
  const r = Math.min(bevel ?? Math.min(0.03, mn * 0.16), mn * 0.49);
  // adaptive detail: tiny parts stay sharp (a bevel would be sub-pixel), mid-size get 1 segment
  const segs = mn < 0.035 && bevel === undefined ? 0 : (mn < 0.25 ? 1 : BEVEL_SEGMENTS);
  const key = `${w.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)},${r.toFixed(4)},${segs}`;
  if (boxCache.has(key)) return boxCache.get(key).clone();
  let g;
  if (r < 0.0008 || segs === 0) g = new THREE.BoxGeometry(w, h, d);
  else g = new RoundedBoxGeometry(w, h, d, segs, r);
  boxProjectUV(g);
  boxCache.set(key, g);
  return g.clone();
}

/** Hard-edged box for surfaces that really are sharp (paint lines, slabs). */
export function sharpBox(w, h, d) { return box(w, h, d, 0); }

export function cyl(rTop, rBot, h, seg = 16, open = false) {
  // never let round things look polygonal: at least ~1 segment per 4 cm of circumference, min 12
  seg = Math.max(seg, 12, Math.min(64, Math.ceil(Math.PI * 2 * Math.max(rTop, rBot) / 0.04)));
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  const uv = g.attributes.uv;
  const circ = Math.PI * 2 * Math.max(rTop, rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  return g;
}

/** Cylinder with filleted (rounded) rims, Y axis; origin at centre. Metric UVs. */
export function rcyl(r, h, fillet = Math.min(0.015, r * 0.2, h * 0.2), seg = 32, rTop = r) {
  const f = fillet, pts = [];
  pts.push(new THREE.Vector2(0, -h / 2));
  const arc = (cx, cy, a0, a1, rr) => { for (let i = 0; i <= 4; i++) { const a = a0 + (a1 - a0) * i / 4; pts.push(new THREE.Vector2(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)); } };
  arc(r - f, -h / 2 + f, -Math.PI / 2, 0, f);
  arc(rTop - f, h / 2 - f, 0, Math.PI / 2, f);
  pts.push(new THREE.Vector2(0, h / 2));
  seg = Math.max(seg, Math.min(64, Math.ceil(Math.PI * 2 * r / 0.035)));
  const g = new THREE.LatheGeometry(pts, seg);
  const uv = g.attributes.uv; const circ = Math.PI * 2 * r;
  let len = 0; for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * len);
  return g;
}

/** Beam between two points with square section. */
export function beam(a, b, w, h = w) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = box(w, h, len);
  const dir = B.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Round tube between two points. */
export function tube(a, b, r, seg = 10) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = cyl(r, r, len, seg, true);
  const dir = B.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Catenary rope (mooring line, cable) as a tube. */
export function catenary(a, b, sag, r, segs = 24, radial = 6) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push(new THREE.Vector3(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t),
      a[2] + (b[2] - a[2]) * t));
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, r, radial, false);
  const uv = g.attributes.uv;
  const len = pts.reduce((s, p, i) => i ? s + p.distanceTo(pts[i - 1]) : 0, 0);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * 2 * Math.PI * r);
  return g;
}

/**
 * Trapezoidal corrugated sheet in the XY plane, facing +Z. Corrugation runs along X.
 * length (x), height (y), pitch, depth. UV: u = x / uScale, v = y / vScale.
 */
export function corrugated(length, height, pitch = 0.278, depth = 0.036, uScale = 3, vScale = height, flatFrac = 0.28) {
  const xs = [], zs = [];
  const n = Math.max(1, Math.round(length / pitch));
  const p = length / n;
  for (let i = 0; i < n; i++) {
    const x0 = i * p;
    const f = flatFrac * p, s = (0.5 - flatFrac) * p;
    xs.push(x0, x0 + f, x0 + f + s, x0 + 2 * f + s);
    zs.push(0, 0, depth, depth);
  }
  xs.push(length); zs.push(0);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < xs.length; i++) {
    for (const y of [0, height]) {
      pos.push(xs[i] - length / 2, y - height / 2, zs[i] - depth / 2);
      uv.push(xs[i] / uScale, y / vScale);
    }
  }
  for (let i = 0; i < xs.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed(); // hard edges on the trapezoid folds
}

export function plane(w, h, uScale = 1, vScale = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / uScale, uv.getY(i) * h / vScale);
  return g;
}

/** Collects geometry per material, then merges into few draw calls. */
export class Batch {
  constructor() { this.groups = new Map(); }
  add(material, geometry, matrix, opts = {}) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const key = material.uuid + (opts.shadow === false ? ':ns' : '');
    if (!this.groups.has(key)) this.groups.set(key, { material, geos: [], shadow: opts.shadow !== false, layer: opts.layer || 0 });
    this.groups.get(key).geos.push(g);
  }
  build(parent) {
    const meshes = [];
    for (const { material, geos, shadow, layer } of this.groups.values()) {
      // split in chunks so frustum culling still helps on big levels
      const merged = mergeGeometries(geos, false);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      if (layer) mesh.layers.set(layer);
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.groups.clear();
    return meshes;
  }
}
