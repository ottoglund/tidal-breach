// Ship-to-shore (STS) container crane, Post-Panamax class, at real scale.
// Local frame: waterside rail at x = 0, landside rail at x = -gauge, legs at
// z = +-legSpan/2, boom along +X (over the water). Sharp-edged boxes: these are
// distant silhouettes, bevel segments would only cost triangles.
import * as THREE from 'three';
import { box, cyl, tube, catenary, xform } from '../../geo.js';
const HALF_PI = Math.PI / 2;

const T = xform;
function sbeam(a, b, w, h = w) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = box(w, h, A.distanceTo(B), 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Lattice column: four chords, ring frames and X-bracing on every face. base = [x, y0, z]. */
function lattice(put, [bx, y0, bz], h, w, bays, ns, key = 'white') {
  const c = 0.32, hw = w / 2, bh = h / bays;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(key, box(c, h, c, 0), T(bx + sx * hw, y0 + h / 2, bz + sz * hw), ns);
  for (let k = 0; k <= bays; k++) {
    const y = y0 + k * bh;
    for (const sz of [-1, 1]) put(key, box(w, 0.22, 0.22, 0), T(bx, y, bz + sz * hw), ns);
    for (const sx of [-1, 1]) put(key, box(0.22, 0.22, w, 0), T(bx + sx * hw, y, bz), ns);
  }
  for (let k = 0; k < bays; k++) {
    const ya = y0 + k * bh, yb = ya + bh, up = k % 2 ? 1 : -1;
    for (const sz of [-1, 1]) put(key, sbeam([bx - hw * up, ya, bz + sz * hw], [bx + hw * up, yb, bz + sz * hw], 0.18), null, ns);
    for (const sx of [-1, 1]) put(key, sbeam([bx + sx * hw, ya, bz - hw * up], [bx + sx * hw, yb, bz + hw * up], 0.18), null, ns);
  }
}
/** Handrail (two rails + posts) along a sloped line; offset in x for both sides. */
function handrail(put, a, b, ns, posts = 4) {
  put('galv', sbeam([a[0], a[1] + 1.0, a[2]], [b[0], b[1] + 1.0, b[2]], 0.07), null, ns);
  put('galv', sbeam([a[0], a[1] + 0.5, a[2]], [b[0], b[1] + 0.5, b[2]], 0.05), null, ns);
  for (let i = 0; i <= posts; i++) { const t = i / posts; put('galv', box(0.06, 1.0, 0.06, 0), T(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + 0.5, a[2] + (b[2] - a[2]) * t), ns); }
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
    // leg: lattice tower in two tapered sections + gantry bogie with wheels
    lattice(put, [x, 2.2, s * Z], portalY * 0.55, 1.5, 5, ns);
    lattice(put, [x, 2.2 + portalY * 0.55, s * Z], portalY * 0.47, 1.25, 4, ns);
    put('white', box(1.9, 0.5, 1.9, 0), T(x, 2.2 + portalY * 0.55, s * Z), ns);
    put('steel', box(1.6, 1.4, 6.0, 0), T(x, 1.5, s * Z), ns);
    for (let w = -2.4; w <= 2.41; w += 1.2) put('steel', box(0.6, 0.8, 0.8, 0), T(x, 0.4, s * Z + w), ns);
    // wheel-bogie equaliser beams
    put('steel', box(1.2, 0.5, 6.4, 0), T(x, 0.95, s * Z), ns);
  }
  // cage ladders on both waterside legs (rungs + stiles + hoops)
  for (const s of [-1, 1]) {
    const lz = s * Z + s * 1.05;
    for (const d of [-0.25, 0.25]) put('galv', box(0.06, portalY - 2, 0.06, 0), T(0.9, 2.2 + (portalY - 2) / 2, lz + d), ns);
    for (let y = 3; y < portalY - 1; y += 1.0) put('galv', box(0.05, 0.05, 0.5, 0), T(0.9, y, lz), ns);
    for (let y = 6; y < portalY - 1; y += 3.0) { put('galv', box(0.04, 0.04, 0.9, 0), T(1.25, y, lz), ns); for (const d of [-0.45, 0.45]) put('galv', box(0.5, 0.04, 0.04, 0), T(1.05, y, lz + d), ns); }
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
  // intermediate cross struts between the legs (every ~11 m) and sill bracing
  for (const y of [13, 25, 36]) for (const x of [0, -gauge]) put('white', box(0.5, 0.5, legSpan, 0), T(x, y, 0), ns);
  for (const x of [0, -gauge]) for (const k of [0, 1]) put('white', sbeam([x, 14, k ? -Z : Z], [x, 25, k ? Z : -Z], 0.4), null, ns);
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
  // machinery house: louvres, doors, roof rail, fan stacks
  const mx = -gauge + 2, my = portalY + 5.4;
  for (const sz of [-1, 1]) for (let k = -4.5; k <= 4.6; k += 1.1) put('steel', box(0.9, 1.6, 0.08, 0), T(mx + k * 1.0, my + 0.6, sz * 4.78), ns);
  put('steel', box(1.4, 2.4, 0.1, 0), T(mx + 4.5, my - 1.4, -4.8), ns);
  for (const k of [-3.5, 0, 3.5]) { put('steel', cyl(0.8, 0.9, 0.7, 14), T(mx + k, my + 3.0, 0), ns); put('rubber', cyl(0.62, 0.62, 0.05, 14), T(mx + k, my + 3.37, 0), ns); }
  for (const sz of [-1, 1]) handrail(put, [mx - 6.2, my + 2.9, sz * 4.8], [mx + 6.2, my + 2.9, sz * 4.8], ns, 5);
  // walkway with handrails along both boom girders
  for (const s of [-1, 1]) {
    put('galv', sbeam([3 - backreach, by - 1.7, s * 3.8], [tip.x, tip.y - 1.7, s * 3.8], 1.0, 0.08), null, ns);
    handrail(put, [3 - backreach, by - 1.7, s * 4.25], [3, by - 1.7, s * 4.25], ns, 4);
    handrail(put, [hinge.x, hinge.y - 1.7, s * 4.25], [tip.x, tip.y - 1.7, s * 4.25], ns, 7);
  }
  // girder stiffener diagonals on the outer faces (boom + backreach)
  for (const s of [-1, 1]) {
    for (let k = 0; k < outreach - 4; k += 4) {
      const a = hinge.clone().addScaledVector(dir, k), b2 = hinge.clone().addScaledVector(dir, k + 4);
      put('red', sbeam([a.x, a.y - 1.2, s * 3.08], [b2.x, b2.y + 1.2, s * 3.08], 0.22), null, ns);
      put('red', sbeam([b2.x, b2.y - 1.2, s * 3.08], [b2.x, b2.y + 1.2, s * 3.08], 0.22), null, ns);
    }
    for (let k = 3 - backreach; k < 2; k += 4) {
      put('red', sbeam([k, by - 1.2, s * 3.08], [k + 4, by + 1.2, s * 3.08], 0.22), null, ns);
      put('red', sbeam([k + 4, by - 1.2, s * 3.08], [k + 4, by + 1.2, s * 3.08], 0.22), null, ns);
    }
  }
  // trolley: sheaves, rope reeving down to the headblock + spreader, trolley rails, festoon loops
  for (const dx of [-2.2, 0, 2.2]) for (const s of [-1, 1]) put('steel', cyl(0.7, 0.7, 0.3, 14), T(tx + dx, ty - 2.1, s * 1.4, 0, HALF_PI), ns);
  const spY = ty - 9.5;
  for (const dz of [-1.3, 1.3]) for (const dx of [-2.2, 2.2]) put('steel', tube([tx + dx, ty - 2.1, dz], [tx + dx * 0.95, spY + 1.1, dz * 0.9], 0.05, 5), null, ns);
  put('steel', box(1.4, 0.7, 2.6, 0), T(tx, spY + 1.5, 0), ns);
  if (boomAngle <= 0.2) {
    put('steel', box(2.6, 0.5, 12.2, 0), T(tx, spY + 0.4, 0), ns);
    put('yellow', box(2.7, 0.4, 0.5, 0), T(tx, spY + 0.4, 6.1), ns);
    put('yellow', box(2.7, 0.4, 0.5, 0), T(tx, spY + 0.4, -6.1), ns);
  }
  for (let k = 0; k < 6; k++) {
    const k0 = hinge.clone().addScaledVector(dir, 5 + k * 6), k1 = hinge.clone().addScaledVector(dir, 5 + (k + 1) * 6);
    put('rubber', catenary([k0.x, k0.y - 1.9, 1.1], [k1.x, k1.y - 1.9, 1.1], 1.0, 0.06, 6, 5), null, ns);
    put('rubber', catenary([k0.x, k0.y - 1.9, -1.1], [k1.x, k1.y - 1.9, -1.1], 1.3, 0.05, 6, 5), null, ns);
    put('steel', box(0.15, 0.5, 0.15, 0), T(k0.x, k0.y - 1.75, 1.1), ns);
  }
  put('steel', sbeam([3 - backreach, by - 1.6, 1.1], [tip.x, tip.y - 1.6, 1.1], 0.14), null, ns);
  // flood lights under the girders
  for (let k = -16; k < 8; k += 8) put('glassLit', box(0.6, 0.15, 0.6, 0), T(k, by - 1.6, 0), ns);
  // stairs tower on a landside leg (zig-zag flights)
  let flip = 1;
  for (let y = 4; y < portalY - 2; y += 3.2) {
    const a = [-gauge - 1.4, y, -Z - 1.6 * flip], b = [-gauge - 1.4, y + 3.2, -Z + 1.4 * flip];
    put('steel', sbeam(a, b, 0.9, 0.12), null, ns);
    for (const dx of [-0.5, 0.5]) handrail(put, [a[0] + dx, a[1], a[2]], [b[0] + dx, b[1], b[2]], ns, 1);
    put('galv', box(2.2, 0.1, 1.2, 0), T(-gauge - 1.4, y + 3.2, -Z + 1.4 * flip + 0.3 * flip), ns);
    flip = -flip;
  }
  return beacons;
}
