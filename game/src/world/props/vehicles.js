// Port vehicles at real-world scale (metres). Each builder emits parts through
// put(materialKey, geometry, localMatrix, opts) in a local frame: origin on the
// ground at the vehicle centre, forward = +Z, up = +Y.
// Material keys: steel, red, yellow, white, galv, rubber, lens, tail, amber, glassDark, polymer
import * as THREE from 'three';
import { box, cyl, rcyl, tube, beam, xform, catenary } from '../../geo.js';

const T = xform;
const HALF_PI = Math.PI / 2;

/** Tyre + rim, axle along X. side = +1 / -1 (which way the rim face points). */
export function wheel(put, x, y, z, r, w, side = 1, rimKey = 'steel') {
  put('rubber', rcyl(r, w, Math.min(r * 0.22, w * 0.35), 40), T(x, y, z, 0, 0, HALF_PI));
  put(rimKey, cyl(r * 0.62, r * 0.62, w + 0.012, 24), T(x, y, z, 0, 0, HALF_PI));
  put('steel', cyl(r * 0.2, r * 0.24, 0.06, 12), T(x + side * (w / 2 + 0.03), y, z, 0, 0, HALF_PI));
  // wheel nuts
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; put('galv', box(0.03, 0.03, 0.03, 0), T(x + side * (w / 2 + 0.01), y + Math.sin(a) * r * 0.32, z + Math.cos(a) * r * 0.32)); }
}

// ---------------------------------------------------------------------------
// Terminal tractor (yard truck): offset single-seat cab, short wheelbase,
// hydraulic lifting fifth wheel. ~6.1 x 2.55 x 3.3 m.
// ---------------------------------------------------------------------------
export function terminalTractor(put) {
  const W = 2.55;
  // chassis rails + cross members
  for (const x of [-0.46, 0.46]) put('steel', box(0.18, 0.32, 5.7), T(x, 0.78, -0.05));
  for (const z of [-2.4, -1.2, 0.4, 1.8]) put('steel', box(0.9, 0.12, 0.14, 0), T(0, 0.74, z));
  // wheels: front single at z=+1.95, rear twins at z=-1.45
  for (const s of [-1, 1]) {
    wheel(put, s * 1.0, 0.55, 1.95, 0.55, 0.42, s);
    wheel(put, s * 0.82, 0.55, -1.45, 0.55, 0.32, s);
    wheel(put, s * 1.16, 0.55, -1.45, 0.55, 0.32, s);
  }
  // axles
  put('steel', cyl(0.08, 0.08, 2.2, 12), T(0, 0.55, 1.95, 0, 0, HALF_PI));
  put('steel', box(1.9, 0.26, 0.34), T(0, 0.55, -1.45));
  // front bumper with step, towing pin
  put('yellow', box(W, 0.36, 0.26), T(0, 0.62, 3.0));
  put('steel', box(0.5, 0.12, 0.2, 0), T(0, 0.5, 3.18));
  // engine hood (right) and offset cab (left)
  put('yellow', box(1.2, 1.15, 1.9), T(0.62, 1.55, 2.0));
  put('steel', box(1.0, 0.7, 0.04, 0), T(0.62, 1.55, 2.96));              // radiator grille
  for (let y = 1.28; y < 1.86; y += 0.08) put('galv', box(0.96, 0.015, 0.02, 0), T(0.62, y, 2.985));
  put('yellow', box(1.28, 0.2, 1.85), T(-0.58, 1.12, 1.98));              // cab floor box
  const cabY = 1.22, cabH = 1.95, cz = 1.95;
  put('yellow', box(1.32, cabH, 1.7, 0.05), T(-0.6, cabY + cabH / 2, cz));
  put('yellow', box(1.42, 0.08, 1.82, 0.03), T(-0.6, cabY + cabH + 0.04, cz)); // roof cap
  // glazing (dark, slightly proud of the cab skin)
  put('glassDark', box(1.12, 1.0, 0.02, 0), T(-0.6, cabY + 1.32, cz + 0.856));
  put('glassDark', box(1.12, 0.9, 0.02, 0), T(-0.6, cabY + 1.36, cz - 0.856));
  for (const s of [-1, 1]) put('glassDark', box(0.02, 1.0, 1.36, 0), T(-0.6 + s * 0.666, cabY + 1.32, cz));
  // window frames / pillars
  for (const s of [-1, 1]) put('steel', box(0.07, 1.05, 0.06, 0), T(-0.6 + s * 0.62, cabY + 1.32, cz + 0.86));
  // door handle, steps, grab rail
  put('galv', box(0.03, 0.03, 0.16, 0), T(-1.28, cabY + 0.95, cz + 0.3));
  for (const y of [0.42, 0.82]) put('steel', box(0.36, 0.04, 0.5, 0), T(-1.18, y, cz + 0.2));
  put('galv', tube([-1.3, 1.3, cz - 0.55], [-1.3, 2.6, cz - 0.55], 0.018, 8));
  // mirrors on arms
  for (const s of [-1, 1]) {
    const mx = s < 0 ? -1.45 : 1.38;
    put('steel', tube([s < 0 ? -1.26 : 1.22, 2.6, cz + 0.7], [mx, 2.75, cz + 0.85], 0.015, 6));
    put('steel', box(0.06, 0.38, 0.2, 0.01), T(mx, 2.6, cz + 0.85));
  }
  // exhaust stack behind cab + air intake
  put('galv', cyl(0.065, 0.065, 1.9, 14), T(0.05, 2.75, 1.0));
  put('steel', cyl(0.075, 0.075, 0.18, 14), T(0.05, 3.75, 1.0));
  put('steel', cyl(0.12, 0.12, 0.9, 16), T(0.9, 2.55, 1.1));
  // fuel + hydraulic tanks
  put('galv', rcyl(0.27, 0.9, 0.04), T(1.0, 0.95, 0.35, 0, HALF_PI));
  put('steel', box(0.5, 0.5, 0.7), T(-1.0, 1.0, 0.3));
  // fenders
  for (const s of [-1, 1]) put('steel', box(0.5, 0.06, 1.3, 0.02), T(s * 1.0, 1.18, 1.95));
  put('steel', box(2.5, 0.06, 0.9, 0.02), T(0, 1.18, -1.45));
  // rear deck, fifth wheel on its lifting frame, rear light bar
  put('steel', box(2.2, 0.1, 2.3, 0.02), T(0, 1.15, -1.2));
  put('steel', box(1.6, 0.18, 1.6, 0.03), T(0, 1.3, -1.45));
  put('rubber', rcyl(0.55, 0.06, 0.02), T(0, 1.42, -1.45));
  for (const s of [-1, 1]) put('galv', tube([s * 0.55, 1.2, -0.4], [s * 0.4, 1.38, -1.0], 0.05, 10));
  put('steel', box(2.3, 0.22, 0.14), T(0, 0.98, -2.95));
  for (const s of [-1, 1]) { put('tail', box(0.22, 0.1, 0.02, 0), T(s * 0.9, 0.98, -3.03)); put('amber', box(0.1, 0.1, 0.02, 0), T(s * 0.68, 0.98, -3.03)); }
  // headlamps + indicators
  for (const x of [-1.05, 1.05]) { put('lens', box(0.22, 0.14, 0.03, 0.01), T(x, 0.92, 3.14)); put('amber', box(0.09, 0.07, 0.02, 0), T(x + Math.sign(x) * 0.09, 1.06, 3.14)); }
  // roof beacon + work lights
  put('steel', box(0.18, 0.06, 0.18, 0), T(-0.6, 3.28, 2.2));
  put('amber', rcyl(0.07, 0.12, 0.02), T(-0.6, 3.37, 2.2));
  put('lens', box(0.2, 0.13, 0.08, 0.01), T(-0.6, 3.28, 1.15));
  // air and electric lines coiled from the back of the cab
  put('red', catenary([-0.3, 2.2, 1.05], [-0.25, 1.5, -0.6], 0.35, 0.014, 14, 5));
  put('blue', catenary([-0.15, 2.2, 1.05], [-0.1, 1.5, -0.6], 0.42, 0.014, 14, 5));
  put('rubber', catenary([0.0, 2.15, 1.05], [0.05, 1.5, -0.6], 0.5, 0.012, 14, 5));
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
}

// ---------------------------------------------------------------------------
// 3 t counterbalance diesel forklift, forks lowered to the ground.
// ---------------------------------------------------------------------------
export function forklift(put) {
  // body / chassis
  put('red', box(1.16, 0.62, 1.7, 0.06), T(0, 0.62, -0.1));
  put('steel', box(1.2, 0.72, 0.5, 0.1), T(0, 0.72, -1.05));         // counterweight
  put('red', box(1.1, 0.35, 1.0, 0.05), T(0, 1.1, -0.55));            // engine hood
  put('polymer', box(0.5, 0.12, 0.45, 0.04), T(0, 1.34, -0.25));      // seat
  put('polymer', box(0.5, 0.5, 0.1, 0.04), T(0, 1.6, -0.48));         // backrest
  put('steel', box(0.06, 0.55, 0.06, 0), T(0, 1.15, 0.45, 0, -0.35)); // steering column
  put('polymer', rcyl(0.17, 0.035, 0.01), T(0, 1.42, 0.38, 0, -0.9));
  for (const s of [-1, 1]) put('steel', box(0.2, 0.05, 0.6, 0), T(s * 0.38, 0.95, 0.5));   // footboard
  // overhead guard
  for (const s of [-1, 1]) {
    put('steel', box(0.06, 1.25, 0.06, 0), T(s * 0.5, 1.6, 0.48, 0, -0.08));
    put('steel', box(0.06, 1.0, 0.06, 0), T(s * 0.5, 1.6, -0.75));
  }
  for (let x = -0.45; x <= 0.46; x += 0.15) put('steel', box(0.04, 0.03, 1.35, 0), T(x, 2.18, -0.12));
  for (const z of [-0.75, 0.5]) put('steel', box(1.06, 0.06, 0.06, 0), T(0, 2.17, z));
  // mast: two nested channel pairs, chains, lift cylinder, carriage + forks on the ground
  for (const s of [-1, 1]) { put('steel', box(0.1, 2.3, 0.14, 0.01), T(s * 0.36, 1.35, 0.95)); put('steel', box(0.08, 2.2, 0.1, 0), T(s * 0.27, 1.4, 1.02)); }
  for (const y of [0.4, 2.3]) put('steel', box(0.82, 0.1, 0.12, 0), T(0, y, 0.98));
  put('galv', cyl(0.05, 0.05, 1.9, 12), T(0, 1.3, 0.9));
  for (const s of [-1, 1]) put('steel', box(0.03, 1.7, 0.02, 0), T(s * 0.12, 1.3, 1.06));
  put('steel', box(1.0, 0.42, 0.06, 0.01), T(0, 0.3, 1.12));
  for (let x = -0.4; x <= 0.41; x += 0.2) put('steel', box(0.03, 0.62, 0.03, 0), T(x, 0.72, 1.13));
  for (const s of [-1, 1]) { put('steel', box(0.12, 0.45, 0.05, 0), T(s * 0.32, 0.26, 1.17)); put('steel', box(0.12, 0.045, 1.15, 0), T(s * 0.32, 0.025, 1.72)); }
  // wheels: front drive pair, rear steer pair
  for (const s of [-1, 1]) { wheel(put, s * 0.47, 0.33, 0.6, 0.33, 0.26, s, 'steel'); wheel(put, s * 0.45, 0.28, -0.8, 0.28, 0.2, s, 'steel'); }
  // lamps, beacon, mirrors
  for (const s of [-1, 1]) put('lens', box(0.12, 0.1, 0.08, 0.01), T(s * 0.5, 2.05, 0.55));
  put('amber', rcyl(0.06, 0.1, 0.015), T(0, 2.27, -0.6));
  for (const s of [-1, 1]) put('tail', box(0.1, 0.06, 0.02, 0), T(s * 0.45, 0.95, -1.31));
  put('galv', cyl(0.03, 0.03, 0.4, 8), T(0.42, 1.6, -0.9));
  // LPG cylinder at the rear
  put('galv', rcyl(0.15, 0.75, 0.03), T(0, 1.55, -1.05, 0, 0, HALF_PI));
}
