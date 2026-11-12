// Set dressing for Pier 04: vehicles, reefer gear, staged cargo, signage,
// floor paint and grime, fences, lamp posts, warehouse facade detail, ship
// outfitting and the distant STS cranes. Purely visual except for the blockers
// registered through guardBlock (each one is checked against node / spawn /
// extraction clearances and the guards' patrol circles).
import * as THREE from 'three';
import { box, cyl, rcyl, tube, plane, xform, catenary, corrugated } from '../../geo.js';
import { mat, plainMat } from '../../materials.js';
import { lampGlow } from '../atmosphere.js';
import { CONTAINER } from '../props.js';
import { terminalTractor, trailer40, TRAILER, straddleCarrier, forklift } from './vehicles.js';
import { emptyPallets, wrappedGoods, ibc, lampPost, cctv, plugPost, reeferUnit, lifeRing, ropeCoil, dunnage, plasticSheet, signPost, fenceRun } from './yard.js';
import { stsCrane } from './cranes.js';
import { freefallLifeboat, lifeboatRamp, gangway } from './ship.js';
import { atlasPlane, signAtlas, paintAtlas, grimeAtlas, chainLinkTexture } from './atlas.js';

const T = xform;
const HALF_PI = Math.PI / 2;
function prng(s) { return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- vehicle layout
// Yard truck + loaded 40 ft chassis parked along the west stacks (kingpin north),
// straddle carrier parked on the east apron carrying a box at 4.4 m.
export const TRUCK = { x: -22.3, zc: -5.3, tilt: -0.05, lift: 0.245 };
export const STRADDLE = { x: 31, z: -14, loadY: 4.4 };
const trailerBase = () => T(TRUCK.x, TRUCK.lift, TRUCK.zc, 0, TRUCK.tilt);

/** Containers carried by vehicles (merged into the main instanced container meshes). */
export function vehicleLoads() {
  return [
    { x: TRUCK.x, y: 1.6, z: TRUCK.zc, ry: 0, color: 0, m: trailerBase().multiply(T(0, TRAILER.deck, 0)) },
    { x: STRADDLE.x, y: STRADDLE.loadY, z: STRADDLE.z, ry: 0, color: 1 },
  ];
}

export function dressPort(ctx) {
  const { root, B, G, M, block, blockers, lamps, aoAdd, QUAY_E, QUAY_S, WX, WH, deckY, deckBoxes, reefers, NODES, EXTRACT, SPAWN, ENEMY_SPAWNS } = ctx;
  const r = prng(20241112);
  const rr = (a, b) => a + (b - a) * r();
  const { L: CL, W: CW, H: CH } = CONTAINER;

  // ---------------------------------------------------------------- materials
  const emissive = (base, col, k, rough = 0.3) => new THREE.MeshStandardMaterial({ color: base, emissive: new THREE.Color(...col), emissiveIntensity: k, roughness: rough });
  const mesh = new THREE.MeshStandardMaterial({ color: 0x8d9193, metalness: 0.85, roughness: 0.45, alphaMap: chainLinkTexture(), alphaTest: 0.35, side: THREE.DoubleSide });
  const X = {
    ...M,
    concrete: M.concreteWall,
    white: mat('container_white', { tile: 1 }),
    blue: plainMat(0x1c3e6e, 0.45, 0.35),
    polymer: mat('polymer', { tile: 0.6 }),
    glassDark: M.windowDark,
    lens: new THREE.MeshStandardMaterial({ color: 0x5c6266, roughness: 0.06, metalness: 0.7, emissive: new THREE.Color(1, 0.93, 0.82), emissiveIntensity: 0.2 }),
    tail: emissive(0x300000, [1, 0.05, 0.03], 2.2),
    amber: emissive(0x4a2200, [1, 0.42, 0.05], 1.4),
    display: emissive(0x001a08, [0.2, 1, 0.35], 3.0),
    bulk: emissive(0x222222, [1, 0.8, 0.55], 6.0, 0.2),
    cardboard: plainMat(0x77573a, 0.88),
    wrap: new THREE.MeshStandardMaterial({ color: 0xdfe5e8, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.4, depthWrite: false }),
    strap: plainMat(0x284a86, 0.5),
    hdpe: plainMat(0xd6d2c2, 0.3),
    hdpeDark: plainMat(0x6f6a58, 0.28),
    alu: plainMat(0xb4b8b8, 0.42, 0.85),
    orange: plainMat(0xd0521a, 0.45),
    sheet: plainMat(0x3a6884, 0.3, 0, { side: THREE.DoubleSide }),
    mesh,
    beacon: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.08, 0.04).multiplyScalar(6), fog: false }),
  };
  const kit = (base) => (k, g, m, o) => {
    const mt = X[k];
    if (!mt) throw new Error('dress: unknown material key ' + k);
    B.add(mt, g, m ? base.clone().multiply(m) : base.clone(), o);
  };
  const W0 = kit(new THREE.Matrix4()); // world-space put

  // ---------------------------------------------------------------- guarded blockers
  const warnings = [];
  const guardBlock = (name, x, z, sx, sz, h) => {
    const x1 = x - sx / 2, x2 = x + sx / 2, z1 = z - sz / 2, z2 = z + sz / 2;
    const d = (px, pz) => Math.hypot(Math.max(x1 - px, 0, px - x2), Math.max(z1 - pz, 0, pz - z2));
    NODES.forEach((n, i) => { if (d(n.x, n.z) < 4.5) warnings.push(`${name} within 4.5 m of node ${i}`); });
    if (d(SPAWN.x, SPAWN.z) < 6) warnings.push(`${name} within 6 m of spawn`);
    if (d(EXTRACT.x, EXTRACT.z) < 6) warnings.push(`${name} within 6 m of extraction`);
    ENEMY_SPAWNS.forEach(([ex, ez, er]) => { if (d(ex, ez) < 0.65 * er + 0.5) warnings.push(`${name} inside patrol circle of guard at ${ex},${ez}`); });
    for (const b of blockers) if (b.x1 < x2 && b.x2 > x1 && b.z1 < z2 && b.z2 > z1 && !b.dress) warnings.push(`${name} overlaps blocker ${b.x1.toFixed(1)},${b.z1.toFixed(1)}`);
    block(x, z, sx, sz, h);
    blockers[blockers.length - 1].dress = true;
  };

  // ---------------------------------------------------------------- atlases / decal batches
  const SA = signAtlas(), PA = paintAtlas(), GA = grimeAtlas();
  const signMat = new THREE.MeshStandardMaterial({ map: SA.texture, roughness: 0.45, metalness: 0, emissive: 0xffffff, emissiveMap: SA.texture, emissiveIntensity: 0.16 });
  const paintMat = new THREE.MeshStandardMaterial({ map: PA.texture, transparent: true, depthWrite: false, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const grimeMat = new THREE.MeshStandardMaterial({ color: 0x050505, alphaMap: GA.texture, transparent: true, opacity: 0.8, depthWrite: false, roughness: 0.22, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const sign = (key, w, h, m) => B.add(signMat, atlasPlane(w, h, SA.rects[key], SA.size), m, { shadow: false });
  const P = new THREE.Group(); // paint & grime meshes go on layer 1
  const paintBatch = [], grimeBatch = [];
  const paint = (key, w, h, x, z, ry, y = 0.008) => paintBatch.push([atlasPlane(w, h, PA.rects[key], PA.size), T(x, y, z, ry, -HALF_PI)]);
  const paintWall = (key, w, h, m) => paintBatch.push([atlasPlane(w, h, PA.rects[key], PA.size), m]);
  const grime = (cell, w, h, x, z, ry) => grimeBatch.push([atlasPlane(w, h, GA.rects[cell], GA.size), T(x, 0.0075, z, ry, -HALF_PI)]);

  // =====================================================================
  // 1. Vehicles
  // =====================================================================
  // yard truck + chassis (load container is added via vehicleLoads)
  trailer40(kit(trailerBase()), false);
  const tz = TRUCK.zc + TRAILER.L / 2 - 1.0 + 1.45;
  terminalTractor(kit(T(TRUCK.x, 0, tz, 0)));
  guardBlock('yard truck', TRUCK.x, (TRUCK.zc - TRAILER.L / 2 + tz + 3.15) / 2, 2.7, tz + 3.15 - (TRUCK.zc - TRAILER.L / 2) + 0.1, 4.1);
  aoAdd(TRUCK.x, TRUCK.zc, 2.9, TRAILER.L + 0.4, 0);
  aoAdd(TRUCK.x, tz, 2.9, 6.4, 0);
  // straddle carrier: two blockers along its sills, the middle stays walkable
  straddleCarrier(kit(T(STRADDLE.x, 0, STRADDLE.z, 0)), STRADDLE.loadY + CH);
  for (const s of [-1, 1]) { guardBlock('straddle sill', STRADDLE.x + s * 2.2, STRADDLE.z, 0.95, 9.7, 2.0); aoAdd(STRADDLE.x + s * 2.2, STRADDLE.z, 1.6, 10.2, 0); }
  // forklift facing the crate stack at (-16,15), forks lowered
  const fl = { x: -11.75, z: 15.45 };
  forklift(kit(T(fl.x, 0, fl.z, -HALF_PI)));
  guardBlock('forklift', fl.x - 0.5, fl.z, 3.6, 1.35, 2.2);
  aoAdd(fl.x - 0.2, fl.z, 3.0, 1.8, 0);

  // =====================================================================
  // 2. Reefers: machinery ends on the white boxes + power cables + plug posts
  // =====================================================================
  for (const c of reefers) reeferUnit(kit(T(c.x, c.y, c.z, c.ry)), CL, CW, CH);
  // cable from the existing plug tower (22,25.5) to the reefer at (26,15)
  W0('rubber', catenary([25.5, 0.03, 21.5], [25.16, 1.55, 21.2], -0.05, 0.03, 8, 6));
  // second plug post for the upper reefer at (26,-4) tier 1
  plugPost(kit(T(23.8, 0, 3.4, 0)));
  guardBlock('plug post', 23.8, 3.4, 0.95, 0.75, 1.8);
  sign('reefer', 0.6, 0.15, T(23.8, 1.42, 3.604, 0));
  W0('rubber', catenary([25.16, CH + 1.55, 2.2], [24.3, 0.9, 3.25], 0.6, 0.03, 20, 6));
  W0('rubber', catenary([24.0, 0.9, 3.2], [23.85, 1.0, 3.17], 0.02, 0.03, 4, 6));
  sign('reefer', 0.8, 0.2, T(22.0, 1.85, 25.19, Math.PI));
  aoAdd(23.8, 3.4, 1.4, 1.2, 0);

  // =====================================================================
  // 3. Staged cargo: wrapped pallets, IBC totes, empty pallet towers
  // =====================================================================
  for (const [x, z, n] of [[15.4, 19.6, 4], [16.8, 19.65, 3], [15.45, 20.7, 4], [16.85, 20.75, 2]]) {
    wrappedGoods(kit(T(x, 0, z, rr(-0.04, 0.04))), n, r);
  }
  guardBlock('wrapped goods', 16.12, 20.17, 2.75, 1.95, 1.4);
  aoAdd(16.12, 20.17, 3.3, 2.5, 0);
  for (const [x, z, y] of [[14.6, 16.6, 0], [15.85, 16.62, 0], [14.6, 16.6, 1.16]]) ibc(kit(T(x, y, z, rr(-0.03, 0.03))), y ? 0.15 : 0.62);
  guardBlock('IBC totes', 15.22, 16.6, 2.5, 1.1, 2.3);
  aoAdd(15.22, 16.6, 3.0, 1.7, 0);
  for (const [x, z, n, ry] of [[13.0, 21.5, 9, 0.12], [-14.6, 21.8, 11, -0.05], [-13.25, 21.95, 6, 0.08]]) {
    emptyPallets(kit(T(x, 0, z, ry)), n, r);
    guardBlock('pallet tower', x, z, 1.35, 1.0, n * 0.144);
    aoAdd(x, z, 1.8, 1.4, ry);
  }

  // =====================================================================
  // 4. Lamp posts (east apron road) + CCTV
  // =====================================================================
  const ledCol = new THREE.Color(0.95, 0.97, 1.0);
  [[34.0, 6], [34.0, -26], [34.0, -52], [34.0, -72]].forEach(([x, z], i) => {
    const base = T(x, 0, z, -HALF_PI);
    const head = lampPost(kit(base)).applyMatrix4(base);
    guardBlock('lamp post', x, z, 0.6, 0.6, 10);
    root.add(lampGlow(head.clone().add(new THREE.Vector3(0, -0.12, 0)), ledCol, 1.3, 2.5));
    if (i === 0 || i === 2) lamps.push({ pos: head.clone().add(new THREE.Vector3(0, -0.3, 0)), color: ledCol.clone().multiplyScalar(0.6) });
    cctv(kit(T(x - 0.12, 6.0, z, -HALF_PI - 0.5)));
    if (i === 0) sign('cctv', 0.6, 0.15, T(x - 0.11, 2.4, z, -HALF_PI));
  });
  // cameras on the high masts and on the warehouse facade
  for (const [x, z, ry] of [[30.75, 18, -HALF_PI - 0.4], [-30.75, 7, HALF_PI - 0.4], [30.75, -37, -HALF_PI + 0.3]]) cctv(kit(T(x, 7.5, z, ry)));
  for (const z of [26, -4, -40, -70]) cctv(kit(T(WX + 0.05, 8.4, z, HALF_PI + 0.35)));

  // =====================================================================
  // 5. Signage
  // =====================================================================
  signPost(kit(T(-9.8, 0, 20.5, 0)), 2.1, 0.62, 0.62);
  sign('speed10', 0.62, 0.62, T(-9.8, 2.1, 20.502, 0));
  guardBlock('speed sign', -9.8, 20.5, 0.2, 0.2, 2.5);
  // berth sign on the slice mast and PPE sign at the warehouse personnel door
  sign('berth', 1.6, 0.8, T(30.62, 3.2, 18, -HALF_PI));
  W0('galv', box(0.03, 0.84, 1.64, 0), T(30.66, 3.2, 18));
  // quay-edge danger signs on posts outside the barrier line
  for (const z of [24.5, -9, -45, -77]) {
    signPost(kit(T(36.15, 0, z, -HALF_PI)), 1.45, 0.9, 0.45, true);
    sign('quayEdge', 0.9, 0.45, T(36.148, 1.45, z, -HALF_PI));
    lifeRing(kit(T(36.3, 0, z - 3.0, -HALF_PI)));
  }

  // =====================================================================
  // 6. Floor paint: bay codes, arrows, speed, keep-clear hatching
  // =====================================================================
  [16, -1, -19, -40, -62, -76].forEach((z, i) => paint('A0' + (i + 1), 2.6, 1.3, -23.3, z, HALF_PI));
  [15, -4, -23, -42, -62, -77].forEach((z, i) => paint('B0' + (i + 1), 2.6, 1.3, 23.3, z, -HALF_PI));
  [[-12, -7], [-12, -27], [13, -18], [13, -51]].forEach(([x, z], i) => paint('C0' + (i + 1), 2.2, 1.1, x, z + 7.4, 0));
  for (const [x, z, ry] of [[-3.3, 12.5, 0], [3.4, 2.0, Math.PI], [-3.3, -24, 0], [3.4, -31, Math.PI], [-3.3, -58, 0]]) paint('arrow', 1.3, 2.6, x, z, ry);
  paint('slow', 2.2, 1.1, -3.3, 17.0, 0);
  paint('slow', 2.2, 1.1, 3.4, -2.5, Math.PI);
  paint('stop', 2.4, 1.2, -3.2, 28.0, Math.PI);
  paint('hatch', 2.6, 2.6, 23.8, 3.4, 0, 0.0085);
  paint('hatch', 2.6, 2.6, 22.0, 25.5, 0, 0.0085);
  paint('hatch', 3.6, 3.6, 31, -14 + 6.5, 0, 0.0085);

  // =====================================================================
  // 7. Ground grime: oil drips, tyre marks, rust bleed
  // =====================================================================
  const inBlock = (x, z, m) => blockers.some(b => x > b.x1 - m && x < b.x2 + m && z > b.z1 - m && z < b.z2 + m);
  let ng = 0;
  for (let i = 0; i < 400 && ng < 46; i++) {
    const x = rr(-24, 33), z = rr(-84, 31);
    if (inBlock(x, z, 0.3)) continue;
    const cell = r() < 0.55 ? Math.floor(r() * 4) : (r() < 0.6 ? 4 + Math.floor(r() * 2) : 6 + Math.floor(r() * 2));
    const s = cell < 4 ? rr(0.8, 2.2) : cell < 6 ? rr(2.5, 5) : rr(1.5, 3.5);
    grime(cell, s * (cell >= 4 && cell < 6 ? 0.6 : 1), s, x, z, cell >= 4 && cell < 6 ? rr(-0.4, 0.4) + (r() < 0.5 ? 0 : Math.PI) : rr(0, 6.28));
    ng++;
  }
  // deliberate stains where vehicles stand and turn
  grime(0, 1.6, 1.6, TRUCK.x + 0.4, tz + 1.8, 0.4); grime(2, 1.2, 1.2, TRUCK.x, TRUCK.zc - 4.9, 1.1);
  grime(4, 2.4, 5.5, TRUCK.x + 2.6, tz + 5.5, -0.35); grime(5, 2.2, 5.0, -12.5, 18.5, 1.2);
  grime(1, 1.3, 1.3, fl.x + 0.1, fl.z - 0.3, 0.2); grime(3, 1.8, 1.8, STRADDLE.x, STRADDLE.z - 3, 0);
  grime(4, 2.0, 5.0, 4.5, 15.0, 0.25); grime(6, 2.2, 2.2, 25.2, 21.8, 0); grime(7, 2.0, 2.0, 25.0, 2.4, 0.5);

  // =====================================================================
  // 8. Debris: dunnage, rope offcuts, plastic sheeting, gully grates
  // =====================================================================
  for (const [x, z, ry, len] of [[6.6, 14.6, 0.3, 2.4], [7.15, 14.2, 0.42, 1.8], [-19.4, -9.5, 1.2, 2.4], [-7.4, -20.5, 2.6, 1.2], [18.8, -28, 0.9, 2.4], [-6.5, -52, 0.2, 2.0]]) dunnage(kit(T(x, 0, z, ry)), len);
  plasticSheet(kit(T(-9.6, 0, 3.2, 0.4)), 1.7, 1.2, r);
  plasticSheet(kit(T(20.6, 0, -15.5, 1.9)), 1.3, 1.0, r);
  for (const [x, z, ry] of [[33.2, -3.0, 0.4], [-8.2, 9.5, 2.0]]) ropeCoil(kit(T(x, 0, z, ry)), r);
  for (const [x, z] of [[35.9, 27.5], [35.9, -12.5], [35.9, -52.5]]) ropeCoil(kit(T(x, 0, z, rr(0, 6))), r);
  // cast-iron gully grates along the stack edges (slot pattern)
  for (const [x, z] of [[-23.4, 9], [-23.4, -10], [23.4, 8.5], [23.4, -13], [-9.8, 7.5], [10.6, -3], [-23.4, -31], [23.4, -33]]) {
    W0('iron', box(0.62, 0.02, 0.42, 0), T(x, 0.006, z));
    for (let k = -0.22; k <= 0.221; k += 0.055) W0('steel', box(0.025, 0.004, 0.32, 0), T(x + k, 0.017, z));
  }

  // =====================================================================
  // 9. Container stack detail: stacking cones visible in tier gaps, lashing
  // =====================================================================
  // (upper-tier boxes get a small misalignment in level.js)

  // =====================================================================
  // 10. Warehouse facade: clerestory glazing, personnel doors, cable tray
  // =====================================================================
  for (let z = 30; z > -86.5; z -= 2.25) {
    if (z < -0.2 && z > -23.8) continue; // terminal sign
    const wm = T(WX - 0.05, 9.75, z, HALF_PI);
    B.add(M.steel, box(1.75, 1.2, 0.06, 0), wm);
    B.add(r() < 0.32 ? M.windowLit : M.windowDark, plane(1.55, 1.0), wm.clone().multiply(T(0, 0, 0.032)), { shadow: false });
    B.add(M.steel, box(0.05, 1.0, 0.02, 0), wm.clone().multiply(T(0, 0, 0.04)));
  }
  [16, -14, -54].forEach((zc, i) => {
    const dz = zc + 4.4;
    const K = kit(T(WX, 0, dz, HALF_PI));
    K('steel', box(1.24, 2.32, 0.1, 0.01), T(0, 1.16, 0.0));
    K('blue', box(1.0, 2.12, 0.05, 0.01), T(0, 1.08, 0.05));
    K('galv', box(0.16, 0.03, 0.05, 0), T(0.36, 1.05, 0.1));
    K('concrete', box(1.6, 0.16, 0.9, 0.02), T(0, 0.08, 0.45));
    K('steel', box(1.6, 0.06, 0.9, 0.01), T(0, 2.62, 0.45));
    K('bulk', box(0.26, 0.14, 0.1, 0.02), T(0, 2.45, 0.08), { shadow: false });
    root.add(lampGlow(new THREE.Vector3(WX + 0.22, 2.42, dz), 0xffc890, 0.9, 2.2));
    sign('door' + (i + 1), 0.42, 0.42, T(WX + 0.003, 1.7, dz + 0.95, HALF_PI));
    // fire hose cabinet + electrical cabinet with conduit up to the tray
    K('red', box(0.7, 0.9, 0.24, 0.02), T(-1.55, 1.25, 0.12));
    sign('fire', 0.5, 0.25, T(WX + 0.003, 1.95, dz - 1.55, HALF_PI));
    K('galv', box(0.8, 1.2, 0.3, 0.02), T(1.9, 1.35, 0.15));
    sign('volt', 0.3, 0.15, T(WX + 0.305, 1.65, dz + 1.9, HALF_PI));
    K('galv', tube([1.75, 1.95, 0.1], [1.75, 6.3, 0.1], 0.03, 10));
    K('galv', tube([2.05, 1.95, 0.1], [2.05, 6.3, 0.1], 0.02, 10));
    // stencilled door number above the roller door
    paintWall('D0' + (i + 1), 1.7, 1.7, T(WX - 0.045, 6.9, zc, HALF_PI));
  });
  sign('ppe', 1.2, 0.6, T(WX + 0.003, 1.9, 16 + 6.6, HALF_PI));
  // cable ladder tray above the doors
  const trayLen = 118, trayZ = 31 - trayLen / 2;
  B.add(M.galv, box(0.42, 0.02, trayLen, 0), T(WX + 0.42, 6.32, trayZ));
  for (const o of [-0.2, 0.2]) B.add(M.galv, box(0.02, 0.1, trayLen, 0), T(WX + 0.42 + o, 6.37, trayZ));
  for (const o of [-0.1, 0.0, 0.1]) B.add(M.rubber, cyl(0.022, 0.022, trayLen, 8), T(WX + 0.42 + o, 6.36, trayZ, 0, HALF_PI));
  for (let z = 31; z > -87; z -= 3) B.add(M.steel, box(0.62, 0.04, 0.05, 0), T(WX + 0.31, 6.28, z));
  // gable ends so the shed reads as a building from the far end of the yard
  const gable = corrugated(16, WH, 0.2, 0.04, 4, WH, 0.3);
  B.add(M.clad, gable, T(WX - 8, WH / 2, -88.0, 0));
  B.add(M.clad, gable, T(WX - 8, WH / 2, 36.0, Math.PI));

  // =====================================================================
  // 11. Quay edge: ladder stiles + grab hoops
  // =====================================================================
  for (const z of [22, -18, -58]) {
    for (const s of [-1, 1]) {
      W0('galv', box(0.05, 4.4, 0.05, 0), T(QUAY_E + 0.12, -2.0, z + s * 0.27));
      W0('galv', tube([QUAY_E + 0.05, 0.0, z + s * 0.27], [QUAY_E - 0.35, 1.05, z + s * 0.27], 0.022, 8));
    }
    W0('galv', tube([QUAY_E - 0.35, 1.05, z - 0.27], [QUAY_E - 0.35, 1.05, z + 0.27], 0.022, 8));
  }

  // =====================================================================
  // 12. North boundary: chain-link fence with gate, ground beyond the yard
  // =====================================================================
  fenceRun(kit(T(0, 0, -86.4, 0)), -34.6, 34.4, [-4, 4]);
  signPost(kit(T(-5.0, 0, -86.25, 0)), 1.6, 1.0, 0.5, true);
  sign('noAccess', 1.0, 0.5, T(-5.0, 1.6, -86.248, 0));
  G.add(M.asphalt, plane(80.2, 112, 1, 1), T(-3.0, -0.002, -144, 0, -HALF_PI));
  B.add(M.concreteWall, box(1.2, 9, 112), T(QUAY_E - 0.6, -4.5, -144));
  B.add(M.paintYellow, box(0.25, 0.22, 112), T(QUAY_E - 0.12, 0.11, -144));

  // =====================================================================
  // 13. Distant STS cranes (north berth) with aviation warning lights
  // =====================================================================
  const beaconGeo = new THREE.SphereGeometry(0.45, 10, 8);
  for (const [z, ang] of [[-110, 1.32], [-137, 0], [-163, 1.4]]) {
    const base = T(36, 0, z, 0);
    const bs = stsCrane(kit(base), { boomAngle: ang });
    for (const p of bs) B.add(X.beacon, beaconGeo, base.clone().multiply(T(p.x, p.y, p.z)), { shadow: false });
  }

  // =====================================================================
  // 14. Ship outfitting: gangway, lit portholes, lifeboat, lashing rods
  // =====================================================================
  gangway(W0, [38.95, deckY + 1.1, 4.5], [36.25, 0.03, -1.2]);
  for (let k = 0; k < 9; k++) {
    const z = 13.6 + k * 1.05, y = deckY - 1.35;
    const pm = T(38.57, y, z, -HALF_PI);
    B.add(r() < 0.55 ? M.windowLit : M.windowDark, new THREE.CircleGeometry(0.2, 20), pm, { shadow: false });
    B.add(M.galv, new THREE.TorusGeometry(0.22, 0.025, 6, 20), pm);
  }
  {
    // free-fall boat on its stern ramp, sliding aft and down (ramp 22.7 -> 30.5 m)
    const lb = T(47.1, deckY + 7.2, 26.6, Math.PI, -0.6);
    lifeboatRamp(kit(lb));
    freefallLifeboat(kit(lb.clone().multiply(T(0, 0.05, 0))));
    for (const [z, h] of [[24.0, 8.4], [27.5, 6.0]]) for (const s of [-1, 1]) W0('white', box(0.3, h, 0.3, 0), T(47.1 + s * 1.25, deckY + h / 2, z));
    for (const [z, h] of [[24.0, 8.4], [27.5, 6.0]]) W0('white', box(2.8, 0.3, 0.3, 0), T(47.1, deckY + h - 0.15, z));
  }
  const tier0 = deckBoxes.filter(c => Math.abs(c.y - (deckY + 0.1)) < 0.01);
  for (const c of tier0) for (const e of [-1, 1]) {
    const zE = c.z + e * (CL / 2 + 0.06);
    for (const s of [-1, 1]) {
      const a = [c.x - s * 1.05, deckY + 0.12, zE], b = [c.x + s * 1.08, deckY + 0.1 + CH + 0.06, zE];
      W0('galv', tube(a, b, 0.014, 6), null);
      const t = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).multiplyScalar(0.12).add(new THREE.Vector3(...a));
      W0('steel', tube(a, [t.x, t.y, t.z], 0.032, 8), null);
    }
  }

  // ---------------------------------------------------------------- build decals
  const PB = new (B.constructor)();
  for (const [g, m] of paintBatch) PB.add(paintMat, g, m, { shadow: false });
  for (const [g, m] of grimeBatch) PB.add(grimeMat, g, m, { shadow: false });
  PB.build(root).forEach(m => { m.castShadow = false; m.receiveShadow = true; m.layers.set(1); m.renderOrder = m.material === paintMat ? 1 : 0; });

  if (warnings.length) console.warn('[dress] placement warnings:\n' + warnings.join('\n'));
  return { warnings };
}
