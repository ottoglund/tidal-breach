// Ship outfitting: free-fall lifeboat on its launch ramp, accommodation
// ladder (gangway) to the quay, lashing rods. put(key, geo, matrix, opts).
import * as THREE from 'three';
import { box, cyl, rcyl, tube, xform, catenary } from '../../geo.js';
import { lathe } from '../props.js';

const T = xform;

/** Enclosed free-fall lifeboat, ~8.6 m. Local: bow toward -Z, keel at y=0. */
export function freefallLifeboat(put) {
  // body of revolution squashed into a hull: lathe around Y, then laid along Z
  const g = lathe([[0, -4.3], [0.55, -4.15], [1.05, -3.6], [1.38, -2.4], [1.5, -0.6], [1.5, 1.6], [1.42, 3.2], [1.25, 4.1], [0, 4.3]], 28);
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));   // axis along Z (bow at -Z)
  g.applyMatrix4(new THREE.Matrix4().makeScale(1.0, 0.95, 1.0));
  put('orange', g, T(0, 1.45, 0));
  put('white', box(2.4, 0.06, 7.4, 0.02), T(0, 1.42, 0.2));          // rubbing strake line
  put('orange', box(1.5, 0.7, 2.6, 0.25), T(0, 2.85, 1.6));          // helmsman's cupola
  for (let k = -3; k <= 3; k++) for (const s of [-1, 1]) put('glassDark', box(0.02, 0.22, 0.4, 0), T(s * 1.47, 2.0, k * 0.85 + 0.3));
  put('glassDark', box(1.2, 0.35, 0.02, 0), T(0, 3.0, 0.29));
  put('glassDark', box(0.02, 0.32, 1.8, 0), T(0.76, 3.0, 1.6));
  put('glassDark', box(0.02, 0.32, 1.8, 0), T(-0.76, 3.0, 1.6));
  put('steel', box(0.2, 0.6, 0.6, 0.02), T(0, 0.3, 4.0));            // skeg / rudder
  put('white', box(0.04, 0.5, 0.04, 0), T(0, 3.45, 1.6));            // mast + light
  put('amber', rcyl(0.04, 0.06, 0.01), T(0, 3.73, 1.6));
}

/** Launch ramp under the boat (two rails, frame, stern platform). Local: ramp falls toward -Z. */
export function lifeboatRamp(put, len = 9.5) {
  for (const s of [-1, 1]) {
    put('white', box(0.3, 0.45, len, 0.02), T(s * 0.95, -0.2, 0));
  }
  for (let z = -len / 2 + 0.6; z < len / 2; z += 2.2) put('white', box(2.6, 0.25, 0.25, 0), T(0, -0.35, z));
  put('steel', box(0.3, 0.3, 0.6, 0.02), T(0, 0.15, len / 2 - 0.3));  // release hook
}

/**
 * Accommodation ladder from the ship's bulwark (top) to the quay (bottom),
 * both world points; treads stay level. Returns nothing.
 */
export function gangway(put, top, bottom, width = 0.75) {
  const A = new THREE.Vector3(...top), Bp = new THREE.Vector3(...bottom);
  const d = Bp.clone().sub(A), len = d.length();
  const yaw = Math.atan2(d.x, d.z), pitch = Math.asin(-d.y / len);
  // frame with stringers: build in a local frame aligned with the ladder
  const base = new THREE.Matrix4().compose(A.clone().add(Bp).multiplyScalar(0.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
  const L = (m) => base.clone().multiply(m);
  for (const s of [-1, 1]) put('galv', box(0.05, 0.28, len, 0.01), L(T(s * width / 2, 0, 0)));
  // treads (kept horizontal by counter-rotating)
  const n = Math.floor(len / 0.32);
  for (let i = 1; i < n; i++) {
    const t = i / n - 0.5;
    put('galv', box(width - 0.06, 0.03, 0.24, 0), L(T(0, 0.02, t * len, 0, -pitch)));
  }
  // stanchions + handrail ropes
  const posts = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5 - 0.5;
    for (const s of [-1, 1]) {
      const p = new THREE.Vector3(s * (width / 2 + 0.02), 0, t * len).applyMatrix4(base);
      put('galv', cyl(0.018, 0.018, 1.0, 8), T(p.x, p.y + 0.5, p.z));
      posts.push([s, i, p]);
    }
  }
  for (const s of [-1, 1]) {
    const pts = posts.filter(q => q[0] === s).map(q => q[2]);
    for (let i = 0; i < pts.length - 1; i++) {
      put('rope', catenary([pts[i].x, pts[i].y + 1.0, pts[i].z], [pts[i + 1].x, pts[i + 1].y + 1.0, pts[i + 1].z], 0.06, 0.012, 6, 5));
      put('rope', catenary([pts[i].x, pts[i].y + 0.55, pts[i].z], [pts[i + 1].x, pts[i + 1].y + 0.55, pts[i + 1].z], 0.05, 0.01, 6, 5));
    }
  }
  // bottom roller + top turntable platform
  put('rubber', rcyl(0.14, width, 0.02), T(Bp.x, Bp.y + 0.14, Bp.z, yaw, 0, Math.PI / 2));
  put('galv', box(1.1, 0.08, 1.1, 0.01), T(A.x, A.y - 0.04, A.z, yaw));
  // safety net slung under the ladder
  put('rope', catenary([A.x, A.y - 0.3, A.z], [Bp.x, Bp.y + 0.1, Bp.z], 0.5, 0.008, 12, 4));
}
