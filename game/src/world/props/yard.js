// Yard set dressing at real-world scale. Builders emit parts through
// put(materialKey, geometry, localMatrix, opts); origin on the ground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cyl, rcyl, tube, beam, plane, xform, catenary } from '../../geo.js';

const T = xform;
const HALF_PI = Math.PI / 2;

function mergeList(list) {
  return mergeGeometries(list.map(([g, m]) => {
    const x = g.index ? g.toNonIndexed() : g.clone();
    if (m) x.applyMatrix4(m);
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
    return x;
  }), false);
}

// EUR pallet 1200 x 800 x 144 mm (boards, blocks, stringers); one merged geometry.
let _pallet = null;
export function palletGeometry() {
  if (_pallet) return _pallet;
  const L = [];
  for (const z of [-0.35, 0, 0.35]) L.push([box(1.2, 0.022, z ? 0.1 : 0.145, 0), T(0, 0.011, z)]);
  for (const x of [-0.5275, 0, 0.5275]) for (const z of [-0.35, 0, 0.35]) L.push([box(0.145, 0.078, z ? 0.1 : 0.145, 0), T(x, 0.061, z)]);
  for (const x of [-0.5275, 0, 0.5275]) L.push([box(0.145, 0.022, 0.8, 0), T(x, 0.111, 0)]);
  for (const z of [-0.3275, -0.165, 0, 0.165, 0.3275]) L.push([box(1.2, 0.022, Math.abs(z) > 0.3 ? 0.145 : 0.1, 0), T(0, 0.133, z)]);
  _pallet = mergeList(L);
  return _pallet;
}
export const PALLET_H = 0.144;

/** Stack of n empty pallets with slight random misalignment. */
export function emptyPallets(put, n, r) {
  const g = palletGeometry();
  for (let i = 0; i < n; i++) put('wood', g, T((r() - 0.5) * 0.04, i * PALLET_H, (r() - 0.5) * 0.04, (r() - 0.5) * 0.03));
}

/** Pallet of cartons, shrink-wrapped. layers of 3x2 cartons (0.4 x 0.38 x 0.3). */
export function wrappedGoods(put, layers, r, cartonKey = 'cardboard') {
  put('wood', palletGeometry(), null);
  const y0 = PALLET_H;
  for (let l = 0; l < layers; l++) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    put(cartonKey, box(0.395, 0.295, 0.395, 0.008), T(-0.4 + i * 0.4 + (r() - 0.5) * 0.01, y0 + 0.15 + l * 0.3, -0.2 + j * 0.4 + (r() - 0.5) * 0.01, (r() - 0.5) * 0.02));
  }
  const h = layers * 0.3;
  // stretch film: slightly bulged translucent skin, top sheet, strap bands
  put('wrap', box(1.225, h * 0.92, 0.825, 0.04), T(0, y0 + h * 0.48, 0));
  put('wrap', box(1.215, 0.01, 0.815, 0), T(0, y0 + h + 0.006, 0));
  for (const x of [-0.35, 0.35]) put('strap', box(0.016, h + 0.02, 0.83, 0), T(x, y0 + h / 2, 0));
  for (const x of [-0.35, 0.35]) put('strap', box(0.016, 0.004, 0.83, 0), T(x, y0 + h + 0.012, 0));
}

/** 1000 l IBC tank: HDPE bottle in a galvanised tubular cage on a steel pallet. 1.2 x 1.0 x 1.16 m */
export function ibc(put, fill = 0.6) {
  put('steel', box(1.2, 0.14, 1.0, 0.01), T(0, 0.07, 0));
  for (const x of [-0.5, 0, 0.5]) put('steel', box(0.1, 0.1, 1.0, 0), T(x, 0.03, 0));
  put('hdpe', box(1.12, 0.94, 0.94, 0.07), T(0, 0.62, 0));
  put('hdpeDark', box(1.125, 0.94 * fill, 0.945, 0.07), T(0, 0.15 + 0.47 * fill, 0)); // liquid seen through the bottle
  put('hdpe', rcyl(0.075, 0.06, 0.01), T(0, 1.12, 0));                              // filler cap
  put('polymer', box(0.12, 0.1, 0.1, 0.01), T(0, 0.27, 0.52));                        // outlet valve
  put('polymer', cyl(0.035, 0.035, 0.12, 12), T(0, 0.24, 0.6, 0, HALF_PI));
  // cage: vertical and horizontal tubes on each face
  const cr = 0.011, H = 1.16, Y0 = 0.14;
  for (const s of [-1, 1]) {
    for (let x = -0.55; x <= 0.56; x += 0.183) put('galv', tube([x, Y0, s * 0.5], [x, H, s * 0.5], cr, 6));
    for (let z = -0.45; z <= 0.46; z += 0.18) put('galv', tube([s * 0.6, Y0, z], [s * 0.6, H, z], cr, 6));
    for (let y = Y0 + 0.2; y <= H + 0.01; y += 0.255) { put('galv', tube([-0.6, y, s * 0.5], [0.6, y, s * 0.5], cr, 6)); put('galv', tube([s * 0.6, y, -0.5], [s * 0.6, y, 0.5], cr, 6)); }
  }
  for (let x = -0.45; x <= 0.46; x += 0.3) put('galv', tube([x, H, -0.5], [x, H, 0.5], cr, 6));
  for (const x of [-0.6, 0.6]) for (const z of [-0.5, 0.5]) put('galv', box(0.04, H - Y0, 0.04, 0), T(x, (H + Y0) / 2, z));
}

/** Pole-mounted LED street lamp, arm toward +Z. Returns local head position. */
export function lampPost(put, h = 10, arm = 1.6) {
  put('concrete', box(0.6, 0.35, 0.6, 0.03), T(0, 0.175, 0));
  put('galv', box(0.36, 0.02, 0.36, 0), T(0, 0.36, 0));
  for (const x of [-0.13, 0.13]) for (const z of [-0.13, 0.13]) put('galv', cyl(0.018, 0.018, 0.08, 8), T(x, 0.4, z));
  put('galv', cyl(0.06, 0.1, h, 18), T(0, 0.35 + h / 2, 0));
  put('galv', box(0.14, 0.4, 0.06, 0.01), T(0, 1.2, 0.1));            // access door
  put('galv', tube([0, h + 0.15, 0], [0, h + 0.5, arm * 0.5], 0.045, 10));
  put('galv', tube([0, h + 0.5, arm * 0.5], [0, h + 0.55, arm], 0.045, 10));
  put('steel', box(0.34, 0.1, 0.72, 0.03), T(0, h + 0.55, arm + 0.25, 0, 0.06));
  put('glassLit', plane(0.26, 0.55), T(0, h + 0.495, arm + 0.25, 0, HALF_PI + 0.06), { shadow: false });
  return new THREE.Vector3(0, h + 0.45, arm + 0.25);
}

/** Bullet CCTV camera on a wall/pole bracket, looking toward +Z, tilted down. */
export function cctv(put) {
  put('galv', box(0.12, 0.18, 0.02, 0), T(0, 0, 0));
  put('galv', tube([0, 0, 0.01], [0, 0.03, 0.32], 0.02, 8));
  put('white', box(0.13, 0.13, 0.36, 0.03), T(0, 0.02, 0.45, 0, 0.35));
  put('white', box(0.17, 0.015, 0.42, 0), T(0, 0.1, 0.47, 0, 0.35));
  put('glassDark', cyl(0.045, 0.045, 0.01, 16), T(0, -0.04, 0.63, 0, HALF_PI + 0.35));
}

/** Reefer power distribution post: cabinet with 4 CEE sockets. Faces +Z. */
export function plugPost(put) {
  put('concrete', box(0.9, 0.2, 0.7, 0.03), T(0, 0.1, 0));
  put('galv', box(0.7, 1.5, 0.4, 0.02), T(0, 0.95, 0));
  put('galv', box(0.76, 0.06, 0.48, 0.01), T(0, 1.73, 0));
  for (let i = 0; i < 4; i++) {
    const x = -0.24 + (i % 2) * 0.48 * 0.5 + (i > 1 ? 0.24 : 0), y = 1.15 - (i > 1 ? 0.35 : 0);
    put('yellow', box(0.14, 0.18, 0.08, 0.02), T(x - 0.06, y, 0.22));
    put('steel', cyl(0.045, 0.045, 0.04, 14), T(x - 0.06, y - 0.03, 0.27, 0, HALF_PI));
  }
  put('tail', box(0.03, 0.03, 0.01, 0), T(0.25, 1.55, 0.205));
  put('display', box(0.03, 0.03, 0.01, 0), T(0.18, 1.55, 0.205));
}

/**
 * Reefer machinery end (Carrier/Thermo King style) in container-local space:
 * the container's front end wall is at z = -L/2, facing -Z.
 */
export function reeferUnit(put, L, W, H) {
  const zf = -L / 2;
  // recessed aluminium frame panel
  put('alu', box(W - 0.3, H - 0.27, 0.08, 0.01), T(0, H / 2, zf + 0.09));
  // upper: evaporator access panels with hinges and latches
  for (const s of [-1, 1]) {
    put('alu', box(0.98, 0.8, 0.035, 0.01), T(s * 0.52, H - 0.62, zf + 0.035));
    for (const y of [H - 0.92, H - 0.32]) put('galv', box(0.05, 0.08, 0.03, 0), T(s * 0.52 + s * 0.45, y, zf + 0.01));
    put('steel', box(0.12, 0.03, 0.03, 0), T(s * 0.15, H - 0.62, zf + 0.012));
  }
  // lower left: condenser fan with grille
  put('steel', box(0.95, 0.95, 0.06, 0.01), T(-0.5, 0.82, zf + 0.06));
  put('steel', cyl(0.36, 0.36, 0.02, 40), T(-0.5, 0.82, zf + 0.025, 0, HALF_PI));
  for (const rr of [0.12, 0.22, 0.32]) {
    const ring = new THREE.TorusGeometry(rr, 0.006, 4, 40);
    put('galv', ring, T(-0.5, 0.82, zf + 0.01));
  }
  for (const a of [0, Math.PI / 2]) put('galv', box(0.72, 0.012, 0.012, 0), T(-0.5, 0.82, zf + 0.008, 0, 0, a));
  // lower right: compressor bay (dark recess), control box with display
  put('steel', box(0.9, 0.55, 0.1, 0.01), T(0.52, 0.62, zf + 0.12));
  put('steel', rcyl(0.11, 0.3, 0.02), T(0.38, 0.62, zf + 0.04));
  put('alu', box(0.5, 0.42, 0.14, 0.02), T(0.55, 1.2, zf + 0.0));
  put('display', box(0.14, 0.06, 0.01, 0), T(0.5, 1.28, zf - 0.072));
  put('tail', box(0.025, 0.025, 0.01, 0), T(0.68, 1.28, zf - 0.072));
  put('polymer', box(0.36, 0.08, 0.01, 0), T(0.55, 1.1, zf - 0.072));
  // power cable stowed in its bracket (coil) + plug
  for (let k = 0; k < 3; k++) put('rubber', new THREE.TorusGeometry(0.17, 0.022, 6, 24), T(0.62, 1.7 + k * 0.012, zf - 0.03 - k * 0.04));
  put('yellow', box(0.1, 0.14, 0.12, 0.02), T(0.84, 1.62, zf - 0.08));
  // data plate + vent slots
  put('galv', box(0.3, 0.18, 0.005, 0), T(-0.85, 1.52, zf + 0.012));
  for (let i = 0; i < 6; i++) put('steel', box(0.25, 0.015, 0.01, 0), T(0.0, 0.45 + i * 0.04, zf + 0.02));
}

/** Life-ring station on a post (facing +Z). */
export function lifeRing(put) {
  put('galv', cyl(0.04, 0.04, 1.6, 10), T(0, 0.8, 0));
  put('red', box(0.82, 0.85, 0.08, 0.02), T(0, 1.15, 0.05));
  put('orange', new THREE.TorusGeometry(0.3, 0.06, 10, 28), T(0, 1.15, 0.15));
}

/** Coil of mooring rope lying flat (several stacked torus loops). */
export function ropeCoil(put, r) {
  for (let k = 0; k < 5; k++) put('rope', new THREE.TorusGeometry(0.42 - k * 0.025 + r() * 0.01, 0.024, 6, 30), T((r() - 0.5) * 0.04, 0.025 + k * 0.03, (r() - 0.5) * 0.04, 0, HALF_PI + (r() - 0.5) * 0.08));
  put('rope', catenary([0.4, 0.15, 0], [1.3, 0.025, 0.5], -0.02, 0.024, 10, 6));
}

/** Loose dunnage timber (lying flat). */
export function dunnage(put, len = 2.4) { put('wood', box(0.1, 0.1, len, 0.008), T(0, 0.05, 0)); }

/** Crumpled plastic sheet lying on the ground (w x d). */
export function plasticSheet(put, w, d, r) {
  const g = new THREE.PlaneGeometry(w, d, 10, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const edge = Math.min(1, (w / 2 - Math.abs(x)) * 3, (d / 2 - Math.abs(y)) * 3);
    p.setZ(i, 0.012 + Math.max(0, Math.sin(x * 5.3 + r() * 2) * Math.cos(y * 4.1) * 0.05 + r() * 0.03) * edge);
  }
  g.computeVertexNormals();
  put('sheet', g, T(0, 0, 0, 0, -HALF_PI), { shadow: false });
}

/** Sign on a post: face toward +Z at height y (sign mesh supplied by the caller). */
export function signPost(put, y, w, h, twoPosts = false) {
  const posts = twoPosts ? [-w * 0.35, w * 0.35] : [0];
  for (const x of posts) put('galv', cyl(0.035, 0.035, y + h / 2, 10), T(x, (y + h / 2) / 2, -0.03));
  put('galv', box(w + 0.02, h + 0.02, 0.02, 0), T(0, y, -0.012));
  for (const x of posts) for (const dy of [-h * 0.3, h * 0.3]) put('galv', box(0.08, 0.03, 0.03, 0), T(x, y + dy, -0.05));
}

/**
 * Chain-link fence run along +X from x0 to x1 at local z = 0 (height 2.4 m +
 * barbed-wire outrigger). Mesh panels use key 'mesh' (alpha-tested).
 */
export function fenceRun(put, x0, x1, gate = null) {
  const H = 2.4, step = 3.0;
  const n = Math.max(1, Math.round((x1 - x0) / step)), p = (x1 - x0) / n;
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * p;
    put('galv', cyl(0.035, 0.035, H + 0.1, 12), T(x, (H + 0.1) / 2, 0));
    put('galv', cyl(0.04, 0.04, 0.03, 12), T(x, H + 0.11, 0));
    put('galv', tube([x, H, 0], [x, H + 0.42, 0.28], 0.012, 6));                 // barbed-wire arm
    put('concrete', cyl(0.13, 0.13, 0.1, 14), T(x, 0.05, 0));
  }
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * p, xb = xa + p, xm = (xa + xb) / 2;
    if (gate && xm > gate[0] && xm < gate[1]) continue;
    put('mesh', plane(p - 0.06, H - 0.08, 0.06, 0.06), T(xm, H / 2 + 0.02, 0), { shadow: false });
  }
  put('galv', tube([x0, H - 0.02, 0], [x1, H - 0.02, 0], 0.021, 10));             // top rail
  put('galv', tube([x0, 0.08, 0], [x1, 0.08, 0], 0.005, 6));                       // tension wire
  for (const k of [1, 2, 3]) put('galv', tube([x0, H + k * 0.13, k * 0.087], [x1, H + k * 0.13, k * 0.087], 0.003, 4), null, { shadow: false });
  if (gate) {
    // sliding gate leaf: framed mesh, diagonal brace, wheels, latch post
    const [g0, g1] = gate, gm = (g0 + g1) / 2, gw = g1 - g0;
    put('mesh', plane(gw - 0.1, H - 0.2, 0.06, 0.06), T(gm, H / 2 + 0.06, 0.12), { shadow: false });
    for (const y of [0.12, H - 0.02]) put('galv', tube([g0, y, 0.12], [g1, y, 0.12], 0.03, 10));
    for (const x of [g0, gm, g1]) put('galv', tube([x, 0.12, 0.12], [x, H - 0.02, 0.12], 0.025, 10));
    put('galv', tube([g0, 0.12, 0.12], [gm, H - 0.02, 0.12], 0.018, 8));
    put('galv', tube([gm, 0.12, 0.12], [g1, H - 0.02, 0.12], 0.018, 8));
    for (const x of [g0 + 0.3, g1 - 0.3]) put('rubber', cyl(0.1, 0.1, 0.05, 16), T(x, 0.1, 0.12, 0, HALF_PI));
  }
}

/** Water-filled-free concrete jersey barrier (2 m). */
export function jersey(put) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.3, 0); shape.lineTo(0.3, 0); shape.lineTo(0.3, 0.08); shape.lineTo(0.2, 0.33); shape.lineTo(0.09, 0.81); shape.lineTo(-0.09, 0.81); shape.lineTo(-0.2, 0.33); shape.lineTo(-0.3, 0.08); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 2.0, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 1 });
  g.translate(0, 0, -1.0);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i));
  put('concrete', g, null);
}
