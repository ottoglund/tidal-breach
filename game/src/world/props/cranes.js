// Ship-to-shore (STS) container crane, Post-Panamax class, at real scale.
// Local frame: waterside rail at x = 0, landside rail at x = -gauge, legs at
// z = +-legSpan/2, boom along +X (over the water). Sharp-edged boxes: these are
// distant silhouettes, bevel segments would only cost triangles.
import * as THREE from 'three';
import { box, xform } from '../../geo.js';

const T = xform;
function sbeam(a, b, w, h = w) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = box(w, h, A.distanceTo(B), 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/**
 * put(key, geo, matrix, opts) with keys: white, red, steel, glassLit, beacon.
 * boomAngle: 0 = working (horizontal), ~1.35 = raised/parked. Returns beacon positions (local).
 */
export function stsCrane(put, { gauge = 30.5, legSpan = 17, portalY = 44, boomAngle = 0, outreach = 52, backreach = 22 } = {}) {
  const ns = { shadow: false };
  const beacons = [];
  const Z = legSpan / 2;
  for (const x of [0, -gauge]) for (const s of [-1, 1]) {
    // leg (tapered: two sections), gantry bogie with wheels
    put('white', box(1.8, portalY * 0.55, 1.8, 0), T(x, portalY * 0.275 + 2.2, s * Z), ns);
    put('white', box(1.5, portalY * 0.47, 1.5, 0), T(x, portalY * 0.55 + 2.2 + portalY * 0.22, s * Z), ns);
    put('steel', box(1.6, 1.4, 6.0, 0), T(x, 1.5, s * Z), ns);
    for (let w = -2.4; w <= 2.41; w += 1.2) put('steel', box(0.6, 0.8, 0.8, 0), T(x, 0.4, s * Z + w), ns);
  }
  // sill beams (along z) and portal beams (along x)
  for (const x of [0, -gauge]) {
    put('white', box(1.6, 2.2, legSpan + 1.8, 0), T(x, 13, 0), ns);
    put('white', box(1.6, 2.6, legSpan + 1.8, 0), T(x, portalY + 1.3, 0), ns);
  }
  for (const s of [-1, 1]) {
    put('white', box(gauge + 2, 2.6, 1.6, 0), T(-gauge / 2, portalY + 1.3, s * Z), ns);
    // knee braces under the portal beam
    put('white', sbeam([0, portalY - 9, s * Z], [-8, portalY, s * Z], 0.9), null, ns);
    put('white', sbeam([-gauge, portalY - 9, s * Z], [-gauge + 8, portalY, s * Z], 0.9), null, ns);
  }
  // upper cross bracing between the landside legs
  put('white', sbeam([-gauge, 14, -Z], [-gauge, portalY, Z], 0.7), null, ns);
  put('white', sbeam([-gauge, 14, Z], [-gauge, portalY, -Z], 0.7), null, ns);
  // A-frame (apex above the waterside rail, slightly landward)
  const apex = [-4, portalY + 30, 0];
  for (const s of [-1, 1]) {
    put('red', sbeam([2, portalY + 2.6, s * 4.5], [apex[0], apex[1], s * 1.2], 1.3), null, ns);
    put('red', sbeam([-gauge + 4, portalY + 2.6, s * 4.5], [apex[0], apex[1] - 1, s * 1.2], 1.2), null, ns);
  }
  put('red', box(2.0, 1.6, 4.0, 0), T(apex[0], apex[1] + 0.6, 0), ns);
  beacons.push(new THREE.Vector3(apex[0], apex[1] + 1.8, 0));
  // machinery house on the backreach
  put('white', box(12, 5.5, 9.5, 0), T(-gauge + 2, portalY + 5.4, 0), ns);
  put('steel', box(12.4, 0.4, 9.9, 0), T(-gauge + 2, portalY + 8.3, 0), ns);
  beacons.push(new THREE.Vector3(-gauge - 3.8, portalY + 8.7, 4.6), new THREE.Vector3(-gauge - 3.8, portalY + 8.7, -4.6));
  // boom: backreach girders (fixed) + outreach girders hinged at x=3
  const by = portalY + 3.8, hinge = new THREE.Vector3(3, by, 0);
  for (const s of [-1, 1]) put('red', box(backreach + 3, 2.8, 1.3, 0), T(3 - (backreach + 3) / 2, by, s * 2.4), ns);
  const dir = new THREE.Vector3(Math.cos(boomAngle), Math.sin(boomAngle), 0);
  const tip = hinge.clone().addScaledVector(dir, outreach);
  for (const s of [-1, 1]) put('red', sbeam([hinge.x, hinge.y, s * 2.4], [tip.x, tip.y, s * 2.4], 1.3, 2.6), null, ns);
  for (let k = 4; k < outreach; k += 6) { const p = hinge.clone().addScaledVector(dir, k); put('red', box(0.6, 0.6, 5.4, 0), T(p.x, p.y - 1.2, 0), ns); }
  beacons.push(tip.clone().add(new THREE.Vector3(0, 1.8, 0)));
  // forestays from the apex to the outreach, backstays to the backreach end
  for (const s of [-1, 1]) {
    for (const f of [0.45, 0.85]) { const p = hinge.clone().addScaledVector(dir, outreach * f); put('steel', sbeam([apex[0], apex[1], s * 1.2], [p.x, p.y + 1.2, s * 2.4], 0.35), null, ns); }
    put('steel', sbeam([apex[0], apex[1], s * 1.2], [3 - backreach, by + 1.2, s * 2.4], 0.4), null, ns);
  }
  // trolley + operator cab (parked at the waterside end of the backreach)
  const tx = boomAngle > 0.2 ? -6 : 18;
  const ty = boomAngle > 0.2 ? by : by + Math.sin(boomAngle) * (tx - 3);
  put('steel', box(5.5, 2.4, 6.0, 0), T(tx, ty - 1.2, 0), ns);
  put('white', box(3.0, 2.8, 3.2, 0), T(tx + 1, ty - 4.2, -3.2), ns);
  put('glassLit', box(3.02, 1.0, 3.22, 0), T(tx + 1, ty - 4.0, -3.2), ns);
  // flood lights under the girders
  for (let k = -16; k < 8; k += 8) put('glassLit', box(0.6, 0.15, 0.6, 0), T(k, by - 1.6, 0), ns);
  // stairs tower on a landside leg (zig-zag flights)
  for (let y = 4; y < portalY - 2; y += 3.2) put('steel', sbeam([-gauge - 1.4, y, -Z - 1.6], [-gauge - 1.4, y + 3.2, -Z + 1.4], 0.9, 0.12), null, ns);
  return beacons;
}
