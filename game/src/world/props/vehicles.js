// Port vehicles at real-world scale (metres). Each builder emits parts through
// put(materialKey, geometry, localMatrix, opts) in a local frame: origin on the
// ground at the vehicle centre, forward = +Z, up = +Y.
// Material keys: steel, red, yellow, white, galv, rubber, lens, tail, amber, glassDark, polymer
import * as THREE from 'three';
import { box as gbox, cyl, rcyl, tube, beam, plane, xform, catenary } from '../../geo.js';

// parts thinner than 10 cm get hard edges: a bevel there is sub-pixel at play distance but costs 9x the triangles
const box = (w, h, d, bevel) => gbox(w, h, d, Math.min(w, h, d) < 0.1 ? 0 : bevel);

const T = xform;
const HALF_PI = Math.PI / 2;

// Tyre: lathe with a rounded shoulder, a sidewall bulge and a grooved tread
// crown (44 segments keep the silhouette round at street distance).
const tyreCache = new Map();
function tyre(r, w) {
  const k = r.toFixed(3) + ',' + w.toFixed(3);
  if (!tyreCache.has(k)) {
    const h = w / 2, f = Math.min(r * 0.2, w * 0.33), gd = Math.min(0.02, r * 0.04);
    // profile (radius, axial): bead -> sidewall bulge -> shoulder -> 3 tread ribs separated by grooves
    const pts = [[r * 0.6, -h * 0.92], [r * 0.82, -h], [r - f, -h * 0.97], [r - f * 0.35, -h + f * 0.3], [r - gd * 0.4, -h + f],
      [r - gd * 0.4, -h * 0.22], [r - gd, -h * 0.14], [r - gd, h * 0.14], [r - gd * 0.4, h * 0.22],
      [r - gd * 0.4, h - f], [r - f * 0.35, h - f * 0.3], [r - f, h * 0.97], [r * 0.82, h], [r * 0.6, h * 0.92]]
      .map(([a, b]) => new THREE.Vector2(a, b));
    const g = new THREE.LatheGeometry(pts, 32);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * w * 1.5);
    tyreCache.set(k, g);
  }
  return tyreCache.get(k);
}

/** Tyre + dished rim with lip, hub, 8 wheel nuts; axle along X. side = +1 / -1 (which way the rim face points). */
export function wheel(put, x, y, z, r, w, side = 1, rimKey = 'steel') {
  put('rubber', tyre(r, w), T(x, y, z, 0, 0, HALF_PI));
  put(rimKey, cyl(r * 0.64, r * 0.62, w * 0.92, 20), T(x, y, z, 0, 0, HALF_PI));
  // outer rim lip (a flange ring) + recessed centre disc + hub
  put(rimKey, cyl(r * 0.46, r * 0.5, 0.04, 20), T(x + side * (w / 2 - 0.03), y, z, 0, 0, HALF_PI));
  put('steel', cyl(r * 0.2, r * 0.24, 0.07, 14), T(x + side * (w / 2 + 0.025), y, z, 0, 0, HALF_PI));
  put('galv', cyl(r * 0.09, r * 0.09, 0.09, 8), T(x + side * (w / 2 + 0.05), y, z, 0, 0, HALF_PI));
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; put('galv', box(0.032, 0.032, 0.028, 0), T(x + side * (w / 2 + 0.015), y + Math.sin(a) * r * 0.32, z + Math.cos(a) * r * 0.32)); }
}

// ---- small shared detail parts -------------------------------------------
const _shear = new Map();
/** Parallelogram stripe (plane facing +Z, sheared along X) for hazard stripes. */
function stripeGeo(w, h, slant) {
  const k = [w, h, slant].join();
  if (!_shear.has(k)) {
    const g = plane(w, h, 1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + p.getY(i) * slant);
    _shear.set(k, g);
  }
  return _shear.get(k);
}
/** Black/yellow hazard strip on a face; (cx,cy,cz) centre, face normal = local +Z rotated by ry. */
function hazard(put, cx, cy, cz, len, hgt, ry = 0, yKey = 'yellow') {
  put('rubber', plane(len, hgt, 1, 1), T(cx, cy, cz, ry));
  const pitch = hgt * 1.1, sw = pitch * 0.5, slant = hgt * 0.8;
  for (let x = -len / 2 + sw; x < len / 2 - sw - slant / 2; x += pitch) put(yKey, stripeGeo(sw, hgt, slant), T(cx, cy, cz, ry).multiply(T(x + slant / 2, 0, 0.003)));
}
/** Chevron pair (retro-reflective) pointing down on a +Z-facing (rotated by ry) face. */
function chevron(put, key, cx, cy, cz, w, h, ry = 0) {
  const a = Math.atan2(h, w / 2);
  const L = Math.hypot(w / 2, h);
  for (const s of [-1, 1]) put(key, box(L, 0.05, 0.012, 0), T(cx, cy, cz, ry).multiply(T(s * w / 4, 0, 0, 0, 0, -s * a)));
}
/** Lamp: dark housing + lens. facing +Z rotated by ry. */
function lamp(put, key, x, y, z, w, h, ry = 0) {
  put('steel', box(w + 0.05, h + 0.05, 0.06, 0.015), T(x, y, z, ry));
  put(key, box(w, h, 0.03, 0.008), T(x, y, z, ry).multiply(T(0, 0, 0.032)));
}
/** Wing mirror on an arm: bracket, housing, glass. dir = -1 left, +1 right. */
function mirror(put, ax, ay, az, dir, reach = 0.2, h = 0.36) {
  const mx = ax + dir * reach;
  put('steel', tube([ax, ay, az], [mx, ay + 0.12, az + 0.1], 0.014, 6));
  put('steel', tube([ax, ay - h * 0.4, az], [mx, ay - h * 0.2, az + 0.1], 0.012, 6));
  put('steel', box(0.07, h, 0.22, 0.03), T(mx, ay + 0.1, az + 0.12));
  put('glassDark', box(0.012, h * 0.88, 0.19, 0), T(mx - dir * 0.04, ay + 0.1, az + 0.12));
}
/** Window with rubber gasket and a steel frame. Facing +Z rotated by ry; (cx,cy,cz) centre of the glass. */
function glazed(put, cx, cy, cz, w, h, ry = 0, ft = 0.05) {
  const M = T(cx, cy, cz, ry);
  put('glassDark', box(w, h, 0.02, 0), M);
  put('rubber', box(w + 0.03, 0.03, 0.03, 0), M.clone().multiply(T(0, h / 2 + 0.01, 0.006)));
  put('rubber', box(w + 0.03, 0.03, 0.03, 0), M.clone().multiply(T(0, -h / 2 - 0.01, 0.006)));
  put('rubber', box(0.03, h, 0.03, 0), M.clone().multiply(T(w / 2 + 0.01, 0, 0.006)));
  put('rubber', box(0.03, h, 0.03, 0), M.clone().multiply(T(-w / 2 - 0.01, 0, 0.006)));
  put('steel', box(w + 0.1, ft, 0.035, 0.01), M.clone().multiply(T(0, h / 2 + ft / 2 + 0.02, 0.004)));
  put('steel', box(w + 0.1, ft, 0.035, 0.01), M.clone().multiply(T(0, -h / 2 - ft / 2 - 0.02, 0.004)));
  for (const s of [-1, 1]) put('steel', box(ft, h + 0.14, 0.035, 0.01), M.clone().multiply(T(s * (w / 2 + ft / 2 + 0.02), 0, 0.004)));
}
/** Diamond-plate step with side hangers. Tread centre (x,y,z). */
function step(put, x, y, z, w = 0.4, d = 0.3) {
  put('galv', box(w, 0.035, d, 0.008), T(x, y, z));
  for (let k = -1; k <= 1; k++) put('steel', box(w - 0.04, 0.008, 0.02, 0), T(x, y + 0.02, z + k * d * 0.3));
  for (const s of [-1, 1]) put('steel', box(0.02, 0.2, d, 0.004), T(x + s * (w / 2 - 0.01), y - 0.1, z));
}
/** Mud flap hanging from (x, y, z) facing +Z. */
function mudflap(put, x, y, z, w = 0.55, h = 0.42) {
  put('rubber', box(w, h, 0.016, 0.004), T(x, y - h / 2, z));
  put('steel', box(w + 0.04, 0.03, 0.03, 0.006), T(x, y, z));
  put('white', box(w * 0.5, 0.05, 0.004, 0), T(x, y - h * 0.5, z + 0.01));
}
/** Dirt band wrapped around the bottom of a part: slightly oversize low box. */
function grimeBand(put, x, y, z, w, h, d, bevel = 0.03) { put('dirt', box(w, h, d, bevel), T(x, y, z)); }

// ---------------------------------------------------------------------------
// Terminal tractor (yard truck): offset single-seat cab, short wheelbase,
// hydraulic lifting fifth wheel. ~6.1 x 2.55 x 3.3 m.
// ---------------------------------------------------------------------------
export function terminalTractor(put) {
  const W = 2.55;
  // chassis rails + cross members
  for (const x of [-0.46, 0.46]) put('steel', box(0.18, 0.32, 5.7, 0.02), T(x, 0.78, -0.05));
  for (const z of [-2.4, -1.2, 0.4, 1.8]) put('steel', box(0.9, 0.12, 0.14, 0), T(0, 0.74, z));
  // wheels: front single at z=+1.95, rear twins at z=-1.45
  for (const s of [-1, 1]) {
    wheel(put, s * 1.0, 0.55, 1.95, 0.55, 0.42, s);
    wheel(put, s * 0.82, 0.55, -1.45, 0.55, 0.32, s);
    wheel(put, s * 1.16, 0.55, -1.45, 0.55, 0.32, s);
  }
  // axles, differential housing, steering link
  put('steel', cyl(0.08, 0.08, 2.2, 12), T(0, 0.55, 1.95, 0, 0, HALF_PI));
  put('steel', box(1.9, 0.26, 0.34, 0.05), T(0, 0.55, -1.45));
  put('steel', rcyl(0.2, 0.34, 0.05), T(0, 0.55, -1.45, 0, HALF_PI));
  put('steel', tube([-0.7, 0.45, 2.2], [0.7, 0.45, 2.2], 0.025, 8));
  // front bumper: heavy, hazard-striped, with step and tow pin
  put('steel', box(W, 0.36, 0.26, 0.05), T(0, 0.62, 3.0));
  hazard(put, 0, 0.62, 3.135, 2.3, 0.24, 0);
  put('steel', box(0.5, 0.12, 0.2, 0.02), T(0, 0.5, 3.18));
  put('galv', cyl(0.035, 0.035, 0.18, 10), T(0, 0.6, 3.22, 0, HALF_PI));
  // engine hood (right) - rounded, with latch, vents, grille frame
  put('yellow', box(1.2, 1.15, 1.9, 0.12), T(0.62, 1.55, 2.0));
  put('yellow', box(1.1, 0.04, 1.2, 0.015), T(0.62, 2.14, 1.95));                     // raised top panel
  put('steel', box(1.06, 0.76, 0.05, 0.02), T(0.62, 1.5, 2.965));                      // grille frame
  put('rubber', box(0.96, 0.66, 0.03, 0), T(0.62, 1.5, 2.985));                        // radiator (dark)
  for (let y = 1.2; y < 1.82; y += 0.075) put('galv', box(0.94, 0.02, 0.02, 0), T(0.62, y, 2.995));
  put('galv', box(0.04, 0.1, 0.03, 0.005), T(0.62, 2.0, 2.99));                        // latch
  for (let z = 1.45; z < 2.3; z += 0.1) put('steel', box(0.02, 0.3, 0.035, 0), T(1.225, 1.8, z));   // side louvres
  put('galv', box(0.025, 0.16, 0.5, 0), T(1.225, 1.3, 1.9));                           // hood access handle
  grimeBand(put, 0.62, 1.1, 2.0, 1.215, 0.34, 1.915, 0.1);
  put('yellow', box(1.28, 0.2, 1.85, 0.04), T(-0.58, 1.12, 1.98));                     // cab floor box
  // cab: offset, left
  const cabY = 1.22, cabH = 1.95, cz = 1.95;
  put('yellow', box(1.32, cabH, 1.7, 0.1), T(-0.6, cabY + cabH / 2, cz));
  grimeBand(put, -0.6, cabY + 0.16, cz, 1.345, 0.32, 1.725, 0.1);
  put('yellow', box(1.44, 0.1, 1.84, 0.045), T(-0.6, cabY + cabH + 0.05, cz));          // roof cap
  put('yellow', box(1.3, 0.05, 0.28, 0.02), T(-0.6, cabY + cabH - 0.02, cz + 0.97));    // sun visor over windscreen
  put('rubber', box(1.28, 0.03, 0.18, 0), T(-0.6, cabY + cabH + 0.11, cz + 0.2));       // roof vent
  // glazing with gaskets and frames: windscreen, rear, doors
  glazed(put, -0.6, cabY + 1.32, cz + 0.856, 1.06, 0.92, 0);
  glazed(put, -0.6, cabY + 1.36, cz - 0.856, 1.06, 0.82, Math.PI);
  glazed(put, -0.666 - 0.004, cabY + 1.32, cz + 0.1, 1.12, 0.92, -HALF_PI);   // left door window (faces -X)
  // wipers on the windscreen
  put('steel', tube([-0.82, cabY + 0.9, cz + 0.88], [-0.35, cabY + 1.05, cz + 0.88], 0.012, 6));
  put('rubber', tube([-0.55, cabY + 0.7, cz + 0.875], [-0.3, cabY + 1.2, cz + 0.875], 0.01, 6));
  // door seams, handle, locks, reflective stripe on the lower cab
  for (const z of [cz - 0.45, cz + 0.65]) put('rubber', box(0.012, 1.6, 0.012, 0), T(-1.264, cabY + 0.85, z));
  put('galv', box(0.04, 0.03, 0.2, 0.006), T(-1.29, cabY + 0.95, cz + 0.42));
  put('steel', box(0.03, 0.04, 0.05, 0), T(-1.275, cabY + 0.9, cz + 0.55));
  hazard(put, -1.268, cabY + 0.38, cz, 1.55, 0.12, -HALF_PI);
  // steps (diamond plate) + grab rails at the door
  for (const y of [0.36, 0.78]) step(put, -1.2, y, cz + 0.05, 0.4, 0.5);
  put('steel', box(0.04, 0.5, 0.04, 0), T(-1.4, 0.58, cz + 0.28));
  put('galv', tube([-1.36, 1.15, cz + 0.62], [-1.36, 2.55, cz + 0.62], 0.02, 8));
  put('galv', tube([-1.36, 1.2, cz - 0.55], [-1.36, 2.4, cz - 0.55], 0.02, 8));
  for (const y of [1.3, 2.4]) { put('steel', tube([-1.28, y, cz + 0.62], [-1.36, y, cz + 0.62], 0.016, 6)); put('steel', tube([-1.28, y, cz - 0.55], [-1.36, y, cz - 0.55], 0.016, 6)); }
  // mirrors on arms (left large, right large)
  mirror(put, -1.26, 2.55, cz + 0.75, -1, 0.2, 0.4);
  mirror(put, 0.06, 2.55, cz + 0.75, 1, 1.15, 0.34);
  // exhaust stack with heat shield + rain cap, air intake pipe, snorkel hose to the hood
  put('galv', cyl(0.065, 0.065, 1.9, 14), T(0.05, 2.75, 1.0));
  put('steel', cyl(0.095, 0.095, 0.5, 14), T(0.05, 2.1, 1.0));
  put('steel', cyl(0.075, 0.075, 0.18, 14), T(0.05, 3.75, 1.0));
  put('galv', cyl(0.095, 0.0, 0.07, 14), T(0.05, 3.88, 1.0));
  put('steel', cyl(0.12, 0.12, 0.9, 16), T(0.9, 2.55, 1.1));
  put('galv', cyl(0.15, 0.1, 0.1, 16), T(0.9, 3.05, 1.1));
  put('rubber', catenary([0.9, 2.1, 1.1], [0.9, 2.12, 1.6], 0.12, 0.05, 8, 8));
  // fuel + hydraulic tanks with filler caps and sight glass
  put('galv', rcyl(0.27, 0.9, 0.04), T(1.0, 0.95, 0.35, 0, HALF_PI));
  put('steel', cyl(0.05, 0.05, 0.06, 8), T(1.0, 1.24, 0.1));
  put('steel', box(0.5, 0.5, 0.7, 0.04), T(-1.0, 1.0, 0.3));
  put('amber', box(0.01, 0.18, 0.03, 0), T(-1.255, 1.05, 0.55));
  // fenders with curved edge
  for (const s of [-1, 1]) {
    put('steel', box(0.52, 0.06, 1.3, 0.025), T(s * 1.0, 1.18, 1.95));
    put('steel', box(0.06, 0.26, 1.2, 0.02), T(s * 1.25, 1.06, 1.95));
  }
  put('steel', box(2.5, 0.06, 0.9, 0.025), T(0, 1.18, -1.45));
  // mud flaps behind every wheel set
  for (const s of [-1, 1]) { mudflap(put, s * 1.0, 0.95, 2.62, 0.5, 0.42); mudflap(put, s * 0.99, 0.95, -2.02, 0.62, 0.45); }
  // rear deck, fifth wheel on its lifting frame, hydraulic rams and hoses
  put('steel', box(2.2, 0.1, 2.3, 0.02), T(0, 1.15, -1.2));
  for (const x of [-1.02, 1.02]) put('galv', box(0.05, 0.03, 2.1, 0), T(x, 1.21, -1.2));
  put('steel', box(1.6, 0.18, 1.6, 0.05), T(0, 1.3, -1.45));
  put('rubber', rcyl(0.55, 0.06, 0.02), T(0, 1.42, -1.45));
  put('steel', box(0.34, 0.03, 0.7, 0.005), T(0, 1.455, -1.8));                         // throat slot
  put('galv', cyl(0.04, 0.04, 0.12, 10), T(0, 1.48, -1.4));                             // kingpin lock handle
  for (const s of [-1, 1]) {
    put('galv', tube([s * 0.55, 1.2, -0.4], [s * 0.4, 1.38, -1.0], 0.05, 10));
    put('steel', tube([s * 0.55, 1.2, -0.4], [s * 0.48, 1.28, -0.7], 0.07, 10));
    put('rubber', catenary([s * 0.58, 1.18, -0.38], [s * 0.7, 0.95, 0.35], 0.25, 0.016, 10, 6));
  }
  // rear cross beam, hazard stripe, lamp cluster, reflectors
  put('steel', box(2.3, 0.22, 0.14, 0.02), T(0, 0.98, -2.95));
  hazard(put, 0, 0.98, -3.025, 1.3, 0.16, Math.PI);
  for (const s of [-1, 1]) { lamp(put, 'tail', s * 0.9, 0.98, -3.045, 0.22, 0.1, Math.PI); lamp(put, 'amber', s * 0.68, 0.98, -3.045, 0.1, 0.1, Math.PI); put('white', box(0.08, 0.08, 0.01, 0), T(s * 1.1, 0.98, -3.03)); }
  grimeBand(put, 0, 0.65, -2.95, 2.32, 0.18, 0.15, 0.02);
  // headlamps + indicators + front reflectors
  for (const x of [-1.05, 1.05]) { lamp(put, 'lens', x, 0.92, 3.145, 0.22, 0.14, 0); lamp(put, 'amber', x + Math.sign(x) * 0.12, 1.06, 3.145, 0.09, 0.07, 0); }
  // roof beacon, work lights, light bar
  put('steel', box(0.18, 0.06, 0.18, 0.01), T(-0.6, 3.28, 2.2));
  put('amber', rcyl(0.07, 0.12, 0.02), T(-0.6, 3.37, 2.2));
  lamp(put, 'lens', -0.9, 3.26, 2.76, 0.2, 0.12, 0);
  lamp(put, 'lens', -0.3, 3.26, 2.76, 0.2, 0.12, 0);
  lamp(put, 'lens', -0.6, 3.28, 1.07, 0.22, 0.13, Math.PI);
  // air and electric lines coiled from the back of the cab to the fifth wheel (gladhands)
  put('red', catenary([-0.3, 2.2, 1.05], [-0.25, 1.5, -0.6], 0.35, 0.014, 14, 5));
  put('blue', catenary([-0.15, 2.2, 1.05], [-0.1, 1.5, -0.6], 0.42, 0.014, 14, 5));
  put('rubber', catenary([0.0, 2.15, 1.05], [0.05, 1.5, -0.6], 0.5, 0.012, 14, 5));
  put('red', cyl(0.035, 0.035, 0.07, 8), T(-0.3, 1.46, -0.6));
  put('blue', cyl(0.035, 0.035, 0.07, 8), T(-0.1, 1.46, -0.6));
  // ladder rungs / catwalk behind the cab, with a grab handle
  put('galv', box(1.2, 0.03, 0.4, 0.005), T(-0.3, 2.2, 0.98));
  // chassis grime between the wheels
  grimeBand(put, 0, 0.62, 0.6, 1.0, 0.26, 3.0, 0.03);
}

// ---------------------------------------------------------------------------
// 40 ft skeletal container chassis (trailer). Origin on the ground under the
// chassis centre; kingpin end toward +Z. Deck (twistlock) height 1.45 m.
// ---------------------------------------------------------------------------
export const TRAILER = { L: 12.3, deck: 1.45 };
export function trailer40(put, legsDown = true) {
  const L = TRAILER.L, y = 1.25;
  for (const x of [-0.5, 0.5]) put('steel', box(0.14, 0.42, L - 0.3), T(x, y, 0)); // main I-beams
  put('steel', box(0.15, 0.12, 2.0), T(0, y - 0.24, L / 2 - 1.4));                   // gooseneck plate
  for (let z = -L / 2 + 0.3; z <= L / 2 - 0.2; z += 1.37) put('steel', box(2.44, 0.12, 0.12, 0), T(0, y + 0.13, z));
  for (const s of [-1, 1]) put('steel', box(0.12, 0.18, L), T(s * 1.16, y + 0.1, 0));   // side rails
  for (const s of [-1, 1]) for (const e of [-1, 1]) { put('galv', box(0.18, 0.12, 0.2, 0.01), T(s * 1.1, y + 0.24, e * (L / 2 - 0.12))); put('galv', box(0.06, 0.06, 0.06, 0), T(s * 1.1, y + 0.33, e * (L / 2 - 0.12))); }
  // tandem rear axle with dual tyres, suspension hangers
  for (const z of [-4.25, -5.55]) {
    put('steel', cyl(0.07, 0.07, 2.0, 12), T(0, 0.52, z, 0, 0, HALF_PI));
    for (const s of [-1, 1]) {
      wheel(put, s * 0.74, 0.52, z, 0.52, 0.28, s);
      wheel(put, s * 1.04, 0.52, z, 0.52, 0.28, s);
      put('steel', box(0.12, 0.45, 0.16), T(s * 0.5, 0.88, z));
    }
  }
  for (const s of [-1, 1]) put('steel', box(0.06, 0.06, 2.9, 0), T(s * 0.5, 0.74, -4.9));
  // mudguards / spray suppression
  for (const s of [-1, 1]) put('polymer', box(0.62, 0.04, 2.7, 0.015), T(s * 0.92, 1.12, -4.9));
  // landing legs (crank) with sand shoes
  for (const s of [-1, 1]) {
    put('steel', box(0.12, legsDown ? 0.95 : 0.6, 0.12), T(s * 0.48, legsDown ? 0.6 : 0.8, 3.2));
    put('steel', box(0.26, 0.05, 0.3, 0.01), T(s * 0.48, legsDown ? 0.03 : 0.48, 3.2));
  }
  put('steel', tube([-0.48, 0.75, 3.2], [0.48, 0.75, 3.2], 0.025, 8));
  put('galv', box(0.04, 0.04, 0.32, 0), T(0.62, 0.95, 3.2));
  // rear under-run bar + lamp cluster + reflectors + number plate
  put('steel', box(2.2, 0.12, 0.12), T(0, 0.56, -L / 2 + 0.05));
  for (const s of [-1, 1]) put('steel', box(0.08, 0.6, 0.08, 0), T(s * 0.8, 0.82, -L / 2 + 0.05));
  for (const s of [-1, 1]) { put('tail', box(0.3, 0.12, 0.03, 0), T(s * 0.95, 1.02, -L / 2 - 0.01)); put('amber', box(0.08, 0.1, 0.02, 0), T(s * 0.72, 1.02, -L / 2 - 0.01)); }
  put('white', box(0.52, 0.12, 0.01, 0), T(0, 0.82, -L / 2 + 0.11));
  // side marker lamps
  for (const s of [-1, 1]) for (let z = -4; z <= 4; z += 4) put('amber', box(0.02, 0.05, 0.08, 0), T(s * 1.23, 1.22, z));
  // I-beam flanges (web + lower flange read as a section, not a box)
  for (const x of [-0.5, 0.5]) { put('steel', box(0.24, 0.035, L - 0.35, 0.005), T(x, y - 0.22, 0)); put('steel', box(0.22, 0.035, L - 0.35, 0.005), T(x, y + 0.22, 0)); }
  // conspicuity tape along the side rails (alternating red / white, reflective)
  for (const s of [-1, 1]) for (let z = -L / 2 + 0.4; z < L / 2 - 0.5; z += 0.6) put(((z / 0.6) | 0) % 2 ? 'tail' : 'white', box(0.012, 0.05, 0.3, 0), T(s * 1.225, y + 0.1, z));
  // mud flaps + spray guards behind the tandem, brake chambers, ABS box
  for (const s of [-1, 1]) { mudflap(put, s * 0.92, 0.9, -6.35, 0.6, 0.45); put('steel', cyl(0.1, 0.1, 0.16, 12), T(s * 0.5, 0.76, -4.9, 0, 0, HALF_PI)); put('steel', box(0.05, 0.24, 0.05, 0), T(s * 0.5, 0.66, -4.7)); }
  put('steel', box(0.3, 0.2, 0.14, 0.02), T(0.2, 1.0, -4.4));
  put('red', catenary([-0.4, 1.02, 3.6], [-0.35, 1.03, -4.0], -0.02, 0.012, 12, 5));
  put('blue', catenary([-0.3, 1.02, 3.6], [-0.25, 1.03, -4.0], -0.02, 0.012, 12, 5));
  // front kingpin plate + hazard end beam, pivot bracket and landing leg crank
  hazard(put, 0, 0.56, -L / 2 - 0.015, 1.8, 0.1, Math.PI);
  for (const s of [-1, 1]) put('steel', box(0.04, 0.04, 0.3, 0), T(s * 0.55, 1.0, 3.2));
  put('steel', rcyl(0.02, 0.28, 0.004), T(0.7, 0.95, 3.2, 0, 0, HALF_PI));
}

// ---------------------------------------------------------------------------
// Straddle carrier (1-over-2 class): two wheeled sill beams, four legs, top
// frame with engine house and front-mounted cab. Overall ~9.6 x 4.9 x 14.6 m.
// Spreader height given by spreaderY (container top + 0.12).
// ---------------------------------------------------------------------------
export function straddleCarrier(put, spreaderY = 8, spreaderLen = 12.19) {
  const X = 2.2, Z = 3.65, topY = 12.6;
  for (const s of [-1, 1]) {
    const x = s * X;
    // sill with 4 wheels in bogies
    put('red', box(0.72, 0.72, 9.4, 0.04), T(x, 1.62, 0));
    for (const z of [-3.95, -1.35, 1.35, 3.95]) {
      wheel(put, x, 0.62, z, 0.62, 0.42, s);
      put('steel', box(0.62, 0.5, 0.9, 0.02), T(x, 1.12, z));
    }
    put('steel', box(0.3, 0.06, 9.2, 0), T(x + s * 0.38, 1.22, 0));        // mudguard rail
    // legs (slightly tapered by stacking two boxes) + diagonal brace
    for (const e of [-1, 1]) {
      put('white', box(0.62, 6.0, 0.85, 0.04), T(x, 4.98, e * Z));
      put('white', box(0.56, 4.7, 0.78, 0.04), T(x, 10.3, e * Z));
    }
    put('white', beam([x, 2.2, -Z + 0.5], [x, 7.6, Z - 0.5], 0.32));
    put('white', box(0.5, 0.5, 2 * Z), T(x, 7.9, 0));
    // longitudinal top beam
    put('white', box(0.66, 0.95, 9.6, 0.04), T(x, topY + 0.1, 0));
    // access ladder on the rear-left leg
    if (s < 0) for (let yy = 2.3; yy < topY - 0.4; yy += 0.3) put('galv', box(0.03, 0.025, 0.42, 0), T(x - 0.42, yy, -Z));
    if (s < 0) for (const d of [-0.2, 0.2]) put('galv', box(0.03, topY - 2.2, 0.03, 0), T(x - 0.42, (topY + 2.2) / 2, -Z + d));
  }
  for (const e of [-1, 1]) put('white', box(2 * X + 0.6, 0.9, 0.9, 0.04), T(0, topY + 0.1, e * Z));
  // engine house + radiator grilles + exhaust
  put('white', box(3.4, 1.7, 2.6, 0.05), T(0, topY + 1.4, -1.7));
  for (let y = topY + 0.8; y < topY + 2.1; y += 0.12) put('steel', box(0.02, 0.05, 1.8, 0), T(1.71, y, -1.7));
  put('galv', cyl(0.09, 0.09, 1.4, 14), T(1.2, topY + 2.8, -2.6));
  put('red', box(3.6, 0.15, 2.8, 0.03), T(0, topY + 2.3, -1.7));
  // hydraulic tank / control cabinet
  put('steel', box(1.6, 1.1, 1.2), T(0.9, topY + 1.1, 1.6));
  // cab: front, offset left, overhanging, glazed on 4 sides (floor window)
  const cx = -1.1, cy = topY + 0.35, cz = Z + 1.2;
  put('white', box(1.75, 0.25, 1.9, 0.04), T(cx, cy - 1.1, cz));
  put('white', box(1.75, 0.2, 1.9, 0.04), T(cx, cy + 1.15, cz));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put('white', box(0.08, 2.1, 0.08, 0), T(cx + sx * 0.83, cy, cz + sz * 0.91));
  put('glassDark', box(1.6, 2.0, 1.78, 0), T(cx, cy, cz));
  put('red', box(1.9, 0.12, 2.0, 0.03), T(cx, cy + 1.3, cz));
  put('steel', box(1.0, 0.6, 0.8), T(cx, cy - 1.5, cz - 0.6));       // cab support
  // walkway railings on top
  for (const e of [-1, 1]) put('galv', box(2 * X, 0.04, 0.04, 0), T(0, topY + 1.65, e * (Z + 0.45)));
  for (let x = -X; x <= X + 0.01; x += X / 2) for (const e of [-1, 1]) put('galv', box(0.035, 1.05, 0.035, 0), T(x, topY + 1.12, e * (Z + 0.45)));
  // spreader frame hung on four hydraulic/chain lifts
  put('steel', box(2.3, 0.28, spreaderLen, 0.03), T(0, spreaderY + 0.14, 0));
  put('yellow', box(2.44, 0.18, 0.4, 0.02), T(0, spreaderY + 0.09, spreaderLen / 2 - 0.2));
  put('yellow', box(2.44, 0.18, 0.4, 0.02), T(0, spreaderY + 0.09, -spreaderLen / 2 + 0.2));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    put('galv', cyl(0.05, 0.05, topY - spreaderY - 0.35, 10), T(sx * 1.3, (topY + spreaderY) / 2 + 0.05, sz * 3.2));
    put('steel', cyl(0.11, 0.11, 1.4, 14), T(sx * 1.3, topY - 0.95, sz * 3.2));
  }
  // beacons + work floods + mirrors
  for (const e of [-1, 1]) { put('amber', rcyl(0.08, 0.14, 0.02), T(e * 1.3, topY + 2.45, -0.5)); }
  for (const e of [-1, 1]) put('lens', box(0.3, 0.2, 0.1, 0.01), T(e * 1.9, topY - 0.45, Z + 0.45, 0, 0.4));
  for (const s of [-1, 1]) put('tail', box(0.04, 0.12, 0.25, 0), T(s * (X + 0.37), 1.75, -4.75));
  for (const s of [-1, 1]) put('lens', box(0.04, 0.12, 0.25, 0), T(s * (X + 0.37), 1.75, 4.75));
  // --- detail pass: hazard-striped sill ends, steering bogies, hoses, cab frames, spreader gear
  for (const s of [-1, 1]) for (const e of [-1, 1]) {
    hazard(put, s * X, 1.62, e * 4.71, 0.7, 0.2, e > 0 ? 0 : Math.PI);
    for (const z of [e * 1.35, e * 3.95]) {
      put('steel', box(0.1, 0.34, 0.5, 0.02), T(s * (X + 0.38), 0.92, z));                  // fork / bogie bracket
      put('steel', cyl(0.07, 0.07, 0.8, 10), T(s * X, 1.0, z, 0, 0, HALF_PI));            // axle stub
      put('steel', box(0.02, 0.3, 0.7, 0), T(s * (X - 0.37), 0.85, z));
    }
    put('rubber', catenary([s * (X + 0.33), 7.9, 2.6], [s * (X + 0.4), 2.0, 3.45], 0.7, 0.022, 14, 6));
    put('rubber', catenary([s * (X + 0.33), 7.9, -2.6], [s * (X + 0.4), 2.0, -3.45], 0.7, 0.022, 14, 6));
    for (const e2 of [-1, 1]) put('steel', box(0.64, 0.06, 0.88, 0.01), T(s * X, 12.6 + 0.62, e2 * Z));    // leg caps
  }
  // cab: frame bars around the glass, wipers, sun visors, access ladder from the top frame
  for (const dx of [-0.8, 0, 0.8]) put('steel', box(0.05, 2.0, 0.05, 0), T(cx + dx, cy, cz + 0.9));
  for (const y of [-0.5, 0.5]) put('steel', box(1.7, 0.05, 0.05, 0), T(cx, cy + y, cz + 0.9));
  put('white', box(1.8, 0.07, 0.36, 0.02), T(cx, cy + 1.04, cz + 1.05));
  put('galv', tube([cx - 0.7, cy - 1.0, cz - 0.9], [cx - 0.7, topY - 1.6, Z + 0.4], 0.02, 8));
  // work lights + beacons housings
  for (const e of [-1, 1]) { put('steel', box(0.36, 0.26, 0.14, 0.02), T(e * 1.9, topY - 0.45, Z + 0.45, 0, 0.4)); put('galv', cyl(0.025, 0.025, 0.3, 6), T(e * 1.3, topY + 2.3, -0.5)); }
  // spreader: twistlock housings, flippers, hoist block and signal strips
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    put('steel', box(0.4, 0.18, 0.35, 0.03), T(sx * 1.0, spreaderY - 0.05, sz * (spreaderLen / 2 - 0.3)));
    put('galv', cyl(0.045, 0.045, 0.22, 8), T(sx * 1.0, spreaderY - 0.2, sz * (spreaderLen / 2 - 0.3)));
    put('steel', box(0.04, 0.55, 0.3, 0.005), T(sx * 1.15, spreaderY - 0.3, sz * (spreaderLen / 2 + 0.1)));
  }
  hazard(put, 0, spreaderY + 0.14, spreaderLen / 2 + 0.02, 2.2, 0.14, 0);
  hazard(put, 0, spreaderY + 0.14, -spreaderLen / 2 - 0.02, 2.2, 0.14, Math.PI);
}

// ---------------------------------------------------------------------------
// 3 t counterbalance diesel forklift, forks lowered to the ground.
// ---------------------------------------------------------------------------
export function forklift(put) {
  // body / chassis in light signal yellow, black counterweight with reflective chevrons
  put('fork', box(1.16, 0.62, 1.7, 0.12), T(0, 0.62, -0.1));
  put('fork', box(1.1, 0.35, 1.0, 0.1), T(0, 1.1, -0.55));            // engine hood
  put('steel', box(1.04, 0.05, 0.94, 0.012), T(0, 1.285, -0.55));     // hood top mat
  put('rubber', box(1.22, 0.76, 0.54, 0.14), T(0, 0.74, -1.04));      // counterweight (dark cast iron)
  put('steel', box(1.24, 0.06, 0.5, 0.015), T(0, 1.1, -1.04));        // counterweight cap
  chevron(put, 'refl', -0.3, 0.8, -1.325, 0.34, 0.2, Math.PI);
  chevron(put, 'refl', 0.3, 0.8, -1.325, 0.34, 0.2, Math.PI);
  put('refl', box(1.0, 0.04, 0.012, 0), T(0, 0.42, -1.325));
  put('refl', box(1.0, 0.04, 0.012, 0), T(0, 1.02, -1.325));
  put('steel', box(0.25, 0.12, 0.05, 0.01), T(0, 0.55, -1.35));          // tow coupling
  put('galv', cyl(0.02, 0.02, 0.1, 8), T(0, 0.56, -1.4, 0, HALF_PI));
  // hazard stripe along the lower body sides + front scuffs
  hazard(put, 0.585, 0.4, 0.1, 1.3, 0.1, HALF_PI, 'fork');
  hazard(put, -0.585, 0.4, 0.1, 1.3, 0.1, -HALF_PI, 'fork');
  put('dirt', box(1.18, 0.16, 1.72, 0.06), T(0, 0.38, -0.1));
  // seat, backrest, armrest, steering column + wheel, pedals, dash
  put('polymer', box(0.5, 0.12, 0.45, 0.05), T(0, 1.34, -0.25));
  put('polymer', box(0.5, 0.5, 0.1, 0.05), T(0, 1.6, -0.48));
  put('polymer', box(0.08, 0.06, 0.3, 0.02), T(0.3, 1.5, -0.2));
  put('steel', box(0.06, 0.55, 0.06, 0.01), T(0, 1.15, 0.45, 0, -0.35));
  put('polymer', rcyl(0.17, 0.035, 0.01), T(0, 1.42, 0.38, 0, -0.9));
  put('steel', box(0.5, 0.2, 0.14, 0.03), T(0, 1.1, 0.5));               // dash
  put('display', box(0.12, 0.06, 0.01, 0), T(0.05, 1.19, 0.428, 0, -0.25));
  for (const x of [-0.12, 0, 0.12]) put('rubber', box(0.07, 0.01, 0.1, 0), T(x, 1.0, 0.36, 0, -0.5));
  for (const s of [-1, 1]) step(put, s * 0.38, 0.95, 0.5, 0.2, 0.55);   // footboards
  put('galv', tube([0.46, 1.0, 0.56], [0.46, 1.7, 0.56], 0.02, 8));      // grab handle
  // overhead guard: tubular posts, grid roof, reflective tape on the front posts
  for (const s of [-1, 1]) {
    put('fork', box(0.07, 1.25, 0.07, 0.015), T(s * 0.5, 1.6, 0.48, 0, -0.08));
    put('fork', box(0.07, 1.0, 0.07, 0.015), T(s * 0.5, 1.6, -0.75));
    put('refl', box(0.075, 0.3, 0.012, 0), T(s * 0.5, 1.5, 0.5 + 0.043, 0, -0.08));
  }
  for (let x = -0.45; x <= 0.46; x += 0.15) put('steel', box(0.04, 0.03, 1.35, 0), T(x, 2.18, -0.12));
  for (const z of [-0.75, 0.5]) put('fork', box(1.06, 0.07, 0.07, 0.015), T(0, 2.17, z));
  for (let z = -0.6; z <= 0.4; z += 0.2) put('steel', box(1.0, 0.02, 0.02, 0), T(0, 2.18, z));
  // mast: nested channels, chains, lift cylinder, hydraulic hoses, carriage + forks on the ground
  for (const s of [-1, 1]) { put('steel', box(0.1, 2.3, 0.14, 0.01), T(s * 0.36, 1.35, 0.95)); put('steel', box(0.08, 2.2, 0.1, 0), T(s * 0.27, 1.4, 1.02)); put('refl', box(0.03, 0.4, 0.01, 0), T(s * 0.36, 0.7, 0.882)); }
  for (const y of [0.4, 2.3]) put('steel', box(0.82, 0.1, 0.12, 0), T(0, y, 0.98));
  put('galv', cyl(0.05, 0.05, 1.9, 12), T(0, 1.3, 0.9));
  put('steel', box(0.14, 0.18, 0.12, 0.02), T(0, 0.35, 0.9));
  for (const s of [-1, 1]) put('galv', box(0.03, 1.7, 0.02, 0), T(s * 0.12, 1.3, 1.06));
  for (const s of [-1, 1]) put('rubber', catenary([s * 0.12, 2.0, 0.78], [s * 0.2, 1.1, 0.5], 0.5, 0.014, 12, 6));
  put('steel', box(1.0, 0.42, 0.06, 0.015), T(0, 0.3, 1.12));
  for (let x = -0.4; x <= 0.41; x += 0.2) put('steel', box(0.03, 0.62, 0.03, 0), T(x, 0.72, 1.13));
  for (const s of [-1, 1]) { put('steel', box(0.12, 0.45, 0.05, 0.01), T(s * 0.32, 0.26, 1.17)); put('steel', box(0.12, 0.045, 1.15, 0.01), T(s * 0.32, 0.025, 1.72)); put('rubber', box(0.1, 0.02, 0.3, 0), T(s * 0.32, 0.054, 2.05)); }
  hazard(put, 0, 0.12, 1.155, 0.9, 0.08, 0, 'fork');
  // wheels, with front wing fenders
  for (const s of [-1, 1]) {
    wheel(put, s * 0.47, 0.33, 0.6, 0.33, 0.26, s, 'steel'); wheel(put, s * 0.45, 0.28, -0.8, 0.28, 0.2, s, 'steel');
    put('fork', box(0.3, 0.04, 0.78, 0.015), T(s * 0.49, 0.74, 0.6));
    put('fork', box(0.03, 0.22, 0.7, 0.01), T(s * 0.62, 0.66, 0.6));
  }
  // working / driving lamps on the guard and on the cowl
  for (const s of [-1, 1]) lamp(put, 'lens', s * 0.5, 2.05, 0.64, 0.12, 0.1, 0);
  for (const s of [-1, 1]) lamp(put, 'lens', s * 0.45, 0.78, 0.9, 0.1, 0.06, 0);
  lamp(put, 'lens', 0.0, 2.1, -0.82, 0.2, 0.08, Math.PI);
  // tall warning beacon on the overhead guard (strongly emissive) + blue floor spot
  put('steel', box(0.14, 0.05, 0.14, 0.01), T(0, 2.23, -0.6));
  put('beaconLit', rcyl(0.075, 0.13, 0.02), T(0, 2.32, -0.6));
  put('steel', cyl(0.025, 0.025, 0.25, 8), T(0, 2.44, -0.6));
  put('beaconLit', box(0.1, 0.05, 0.05, 0), T(0, 2.52, -0.6));
  for (const s of [-1, 1]) lamp(put, 'tail', s * 0.45, 0.95, -1.34, 0.12, 0.06, Math.PI);
  lamp(put, 'blueLit', 0, 0.88, 1.3, 0.1, 0.07, 0);
  lamp(put, 'blueLit', 0, 0.82, -1.31, 0.1, 0.07, Math.PI);
  mirror(put, 0.5, 1.9, 0.3, 1, 0.12, 0.2);
  // LPG cylinder at the rear in its cradle, with hose
  put('galv', rcyl(0.15, 0.75, 0.03), T(0, 1.55, -1.05, 0, 0, HALF_PI));
  put('steel', box(0.04, 0.14, 0.3, 0), T(0.0, 1.38, -1.05));
  put('steel', box(0.04, 0.14, 0.3, 0), T(0.0, 1.38, -0.9));
  put('rubber', catenary([0.0, 1.5, -0.9], [0.0, 1.25, -0.5], 0.1, 0.012, 8, 5));
  // data plate and capacity decal
  put('white', box(0.18, 0.1, 0.006, 0), T(0.585, 0.85, 0.35, HALF_PI));
}
