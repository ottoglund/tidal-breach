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

// ---------------------------------------------------------------------------
// Outfitting added in the detail pass. World-space put (W0) unless stated.
// ---------------------------------------------------------------------------
const HP = Math.PI / 2;
function rail(put, a, b, h = 1.0, posts = 0, key = 'galv') {
  put(key, tube([a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], 0.022, 6));
  put(key, tube([a[0], a[1] + h * 0.5, a[2]], [b[0], b[1] + h * 0.5, b[2]], 0.016, 6));
  for (let i = 0; i <= posts; i++) { const t = i / posts; put(key, cyl(0.02, 0.02, h, 5), T(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + h / 2, a[2] + (b[2] - a[2]) * t)); }
}

/** Stockless anchor stowed against the hull plating. Local: outward (away from hull) = +Z, up = +Y, hawse centre at the origin. */
export function anchor(put) {
  put('steel', new THREE.TorusGeometry(0.46, 0.09, 8, 28), T(0, 0, 0.02));          // hawse pipe flange ring
  put('rubber', new THREE.CircleGeometry(0.4, 24), T(0, 0, 0.015));                   // dark opening
  put('steel', cyl(0.4, 0.4, 0.5, 20, true), T(0, 0, -0.2, 0, HP));
  put('steel', box(0.2, 2.2, 0.2, 0.03), T(0, -1.2, 0.18));                           // shank
  put('galv', new THREE.TorusGeometry(0.15, 0.04, 6, 14), T(0, -0.05, 0.2));         // shackle
  put('steel', box(0.5, 0.45, 0.3, 0.06), T(0, -2.3, 0.2));                           // crown
  for (const s of [-1, 1]) {
    put('steel', box(0.8, 0.12, 0.65, 0.03), T(s * 0.5, -2.55, 0.2, 0, 0, s * -0.45));  // flukes lying flat on the plating
    put('steel', box(0.18, 0.7, 0.14, 0.02), T(s * 0.12, -0.8, 0.15));                 // stabilising ribs
  }
  put('rubber', box(0.04, 2.1, 0.04, 0), T(0.0, -1.2, 0.3));                          // grime stripe
  put('steel', box(0.6, 0.12, 0.12, 0.02), T(0, -0.35, 0.3));                         // stock/boss
}

/** Pedestal slewing deck crane (stowed, jib pointing along +Z). Local origin: deck, pedestal centre. */
export function deckCrane(put) {
  put('white', rcyl(0.9, 1.3, 0.05, 20), T(0, 0.65, 0));
  put('steel', cyl(1.25, 1.35, 0.15, 24), T(0, 0.08, 0));
  put('white', box(2.6, 2.5, 3.4, 0.2), T(0, 2.55, -0.5));                            // machinery house
  put('glassDark', box(0.02, 0.9, 1.4, 0), T(1.31, 3.0, -1.0));
  put('glassDark', box(1.4, 0.9, 0.02, 0), T(0.2, 3.0, 1.21));
  put('steel', box(1.0, 0.04, 2.2, 0), T(0, 3.82, -0.5));
  put('steel', cyl(0.1, 0.1, 0.8, 8), T(-0.7, 4.2, -1.6));
  put('galv', rcyl(0.1, 0.4, 0.01), T(0.8, 3.95, -1.4));
  // boom (box girder, slightly raised) with boom rest cradle and hook on a rope
  const L = 17;
  for (const s of [-1, 1]) put('white', box(0.18, 1.0, L, 0.02), T(s * 0.35, 3.6 + 0.9, L / 2 - 1.5, 0, -0.06));
  put('white', box(0.9, 0.12, L, 0.01), T(0, 4.3, L / 2 - 1.5, 0, -0.06));
  put('white', box(0.9, 0.12, L, 0.01), T(0, 3.55, L / 2 - 1.5, 0, -0.06));
  for (let k = 0; k < 8; k++) put('white', box(0.7, 0.07, 0.07, 0), T(0, 3.95 - k * 0.0, 1.5 + k * 2.1, 0, 0.06));
  put('steel', box(0.6, 0.7, 0.4, 0.04), T(0, 3.6, L - 1.2, 0, -0.06));              // boom head
  put('galv', tube([0, 3.3, L - 1.2], [0, 1.6, L - 1.4], 0.015, 5));
  put('steel', box(0.25, 0.4, 0.2, 0.04), T(0, 1.4, L - 1.4));
  // boom rest + hazard stripes
  put('red', box(0.2, 1.2, 0.3, 0.02), T(0, 11.3, 0));
  put('red', box(0.2, 5.0, 0.2, 0.02), T(0, 2.9, L - 1.6));
  put('steel', box(0.9, 0.12, 0.5, 0.02), T(0, 5.5, L - 1.6));
  // ladder + guard rail on the pedestal, anti-collision beacon
  for (const y of [0.5, 1.0, 1.5, 2.0, 2.5]) put('galv', box(0.4, 0.03, 0.03, 0), T(-0.65, y + 0.15, 1.35));
  rail(put, [-1.3, 3.8, -2.2], [1.3, 3.8, -2.2], 1.0, 4);
  put('amber', rcyl(0.07, 0.12, 0.02), T(0.7, 4.3, 0.9));
}

/** Anchor windlass + chain stopper + mooring bitts on the foredeck. Local origin: deck centre line. */
export function windlass(put) {
  put('red', box(4.6, 0.9, 1.9, 0.12), T(0, 0.5, 0));
  for (const s of [-1, 1]) { put('steel', cyl(0.62, 0.62, 0.7, 20), T(s * 1.35, 1.2, 0, 0, 0, HP)); put('steel', cyl(0.8, 0.8, 0.1, 20), T(s * 1.35, 1.2, 0.0, 0, 0, HP)); }
  put('steel', box(0.9, 0.7, 0.9, 0.1), T(0, 1.2, 0));
  put('galv', box(0.4, 0.2, 0.2, 0.03), T(0, 1.65, 0));
  put('steel', cyl(0.55, 0.55, 0.14, 18), T(0, 1.14, 1.35, HP));
  put('steel', box(0.3, 0.3, 0.3, 0.05), T(-1.4, 0.12, -1.4)); put('steel', box(0.3, 0.3, 0.3, 0.05), T(1.4, 0.12, -1.4));
  // chain over the deck to the hawse
  put('steel', catenary([1.7, 1.0, 0.4], [4.2, 0.22, 0.2], 0.06, 0.045, 14, 6));
  put('steel', catenary([-1.7, 1.0, 0.4], [-4.2, 0.22, 0.2], 0.06, 0.045, 14, 6));
  // mooring bitts
  for (const x of [-2.4, 2.4]) for (const z of [-3, 3.5]) { put('steel', cyl(0.18, 0.2, 0.7, 10), T(x - Math.sign(x) * 0.0, 0.35, z - 0.2)); put('steel', cyl(0.18, 0.2, 0.7, 10), T(x + Math.sign(x) * 0.0, 0.35, z + 0.45)); put('steel', box(0.3, 0.07, 0.8, 0.01), T(x, 0.72, z + 0.12)); }
}

/** Funnel: streamlined, with company bands, rain cap, exhaust gooseneck and ladder. Local origin: funnel base centre on the deck. */
export function funnel(put) {
  put('red', box(3.0, 5.0, 4.0, 0.65), T(0, 2.5, 0));
  put('white', box(3.04, 1.3, 4.04, 0.65), T(0, 3.55, 0));
  put('blue', box(3.06, 0.4, 4.06, 0.65), T(0, 3.55, 0));
  put('steel', box(3.1, 0.25, 4.1, 0.1), T(0, 5.05, 0));
  put('rubber', box(2.5, 0.06, 3.4, 0.05), T(0, 5.2, 0));
  for (const x of [-0.7, 0.7]) put('steel', cyl(0.4, 0.42, 1.5, 16), T(x, 5.8, 0.4));
  for (const x of [-0.7, 0.7]) put('rubber', cyl(0.32, 0.32, 0.04, 16), T(x, 6.56, 0.4));
  put('galv', cyl(0.12, 0.12, 2.0, 8), T(0, 6.0, -1.3));
  put('steel', tube([-1.52, 0.4, 1.2], [-1.52, 4.6, 1.2], 0.025, 5));
  for (let y = 0.6; y < 4.6; y += 0.35) put('galv', box(0.04, 0.03, 0.4, 0), T(-1.52, y, 1.2));
  put('steel', box(1.2, 0.8, 0.06, 0.01), T(1.52, 1.6, 0.0, HP));                     // access door
}

/** Bridge superstructure details + masts. Origin world; given deckY & accommodation position. */
export function bridgeDetail(put, ax, az, deckY) {
  const by = deckY + 14, top = by + 2.6;
  // window frames: head/sill strips and mullions across the front, sun visor above
  for (const y of [by + 0.95, by + 2.05]) put('steel', box(17.0, 0.08, 0.06, 0), T(ax, y, az - 4.51));
  for (let wi = -8; wi <= 9; wi++) put('steel', box(0.06, 1.1, 0.05, 0), T(ax + (wi - 0.5) * 0.95, by + 1.5, az - 4.51));
  put('white', box(17.2, 0.08, 0.9, 0.02), T(ax, by + 2.45, az - 4.9, 0, -0.18));
  // bridge wings overhanging the hull, with rails, nav lights and a wing console
  for (const s of [-1, 1]) {
    put('white', box(1.6, 0.18, 3.4, 0.03), T(ax + s * 9.3, by + 0.1, az - 1.2));
    put('steel', box(1.6, 0.06, 3.4, 0.01), T(ax + s * 9.3, by + 0.22, az - 1.2));
    rail(put, [ax + s * 10.1, by + 0.2, az - 2.9], [ax + s * 10.1, by + 0.2, az + 0.5], 1.1, 5);
    rail(put, [ax + s * 10.1, by + 0.2, az - 2.9], [ax + s * 8.5, by + 0.2, az - 2.9], 1.1, 2);
    rail(put, [ax + s * 10.1, by + 0.2, az + 0.5], [ax + s * 8.5, by + 0.2, az + 0.5], 1.1, 2);
    put('white', box(0.5, 0.95, 0.9, 0.04), T(ax + s * 9.6, by + 0.7, az - 1.5));
    put(s < 0 ? 'tail' : 'greenLit', box(0.28, 0.25, 0.28, 0.04), T(ax + s * 10.15, by + 1.3, az - 2.3));
    put('steel', box(0.4, 0.06, 0.4, 0.01), T(ax + s * 10.15, by + 1.12, az - 2.3));
  }
  // roof: railing, radar platform, domes
  rail(put, [ax - 8.3, top, az - 4.4], [ax + 8.3, top, az - 4.4], 1.0, 14);
  rail(put, [ax - 8.3, top, az + 2.4], [ax + 8.3, top, az + 2.4], 1.0, 14);
  rail(put, [ax - 8.3, top, az - 4.4], [ax - 8.3, top, az + 2.4], 1.0, 4);
  rail(put, [ax + 8.3, top, az - 4.4], [ax + 8.3, top, az + 2.4], 1.0, 4);
  // main mast (replaces the plain pole): tapered pole, yardarm, platform
  put('galv', cyl(0.1, 0.18, 7.0, 10), T(ax, top + 3.5, az - 1.0));
  put('steel', box(1.6, 0.06, 1.6, 0.01), T(ax, top + 3.0, az - 1.0));
  rail(put, [ax - 0.8, top + 3.0, az - 1.8], [ax + 0.8, top + 3.0, az - 1.8], 0.9, 3);
  put('galv', tube([ax - 2.4, top + 5.2, az - 1.0], [ax + 2.4, top + 5.2, az - 1.0], 0.05, 6));
  put('bulk', box(0.2, 0.12, 0.2, 0.02), T(ax, top + 7.15, az - 1.0));                  // masthead light
  put('tail', box(0.14, 0.14, 0.14, 0.02), T(ax - 2.4, top + 5.2, az - 1.0));
  put('greenLit', box(0.14, 0.14, 0.14, 0.02), T(ax + 2.4, top + 5.2, az - 1.0));
  // radar: S-band + X-band scanners on pedestals
  for (const [dx, len] of [[-4.5, 3.8], [3.5, 2.4]]) {
    put('white', box(0.5, 1.0, 0.5, 0.06), T(ax + dx, top + 0.6, az - 2.5));
    put('steel', box(len, 0.22, 0.14, 0.03), T(ax + dx, top + 1.3, az - 2.5, 0.5));
    put('steel', box(0.4, 0.12, 0.4, 0.04), T(ax + dx, top + 1.14, az - 2.5));
  }
  // satcom domes, GPS puck, whip antennas, VHF masts
  const dome = new THREE.SphereGeometry(0.7, 18, 12);
  put('white', dome, T(ax + 6.4, top + 1.1, az + 0.6));
  put('steel', cyl(0.3, 0.3, 0.4, 10), T(ax + 6.4, top + 0.2, az + 0.6));
  put('white', new THREE.SphereGeometry(0.4, 14, 10), T(ax - 6.4, top + 0.75, az + 0.6));
  put('steel', cyl(0.2, 0.2, 0.3, 10), T(ax - 6.4, top + 0.15, az + 0.6));
  for (const [dx, h] of [[-7.4, 4.5], [-2.2, 3.2], [2.2, 3.8], [7.4, 4.0], [5.0, 2.6]]) put('galv', cyl(0.012, 0.025, h, 6), T(ax + dx, top + h / 2, az + 1.2));
  put('galv', tube([ax - 7.4, top + 4.5, az + 1.2], [ax - 1.5, top + 6.7, az - 1.0], 0.008, 4));
  put('galv', tube([ax + 7.4, top + 4.0, az + 1.2], [ax + 1.5, top + 6.7, az - 1.0], 0.008, 4));
  // life-raft canisters on the accommodation sides and external stairs aft
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) put('orange', rcyl(0.3, 1.3, 0.04), T(ax + s * 7.15, deckY + 3.4, az - 4.0 + k * 1.4, 0, HP, 0));
  // funnel-side exhaust ventilators on the accommodation roof deck below the bridge
  for (const s of [-1, 1]) put('steel', cyl(0.3, 0.45, 0.8, 12), T(ax + s * 5.8, deckY + 14.4, az + 2.9));
}
