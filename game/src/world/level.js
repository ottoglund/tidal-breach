// Level layout for Pier 04. Gameplay-relevant coordinates (spawn, nodes,
// extraction, container lanes, bounds) are kept from the v0.1 game so the
// mission plays the same; everything visual is rebuilt at real-world scale.
import * as THREE from 'three';
import { Batch, box, cyl, rcyl, beam, tube, corrugated, plane, xform, catenary } from '../geo.js';
import { mat, plainMat, textures } from '../materials.js';
import { buildContainers, CONTAINER, bollardGeometry, lightMast, rtgCrane, shipHull, lathe, merged } from './props.js';
import { lightCone, lampGlow } from './atmosphere.js';

export const BOUNDS = { x1: -34.7, x2: 34.5, z1: -85, z2: 32.0 };
export const SPAWN = { x: 0, z: 24, yaw: 0 };
export const NODES = [
  { x: 1, z: -14, label: 'NOD A / FÖRSTA RELÄET' },
  { x: -2, z: -46, label: 'NOD B / HUVUDLÄNK' },
  { x: 9, z: -63, label: 'NOD C / SÄNDARMAST' },
];
export const EXTRACT = { x: 2, z: 25 };
export const ENEMY_SPAWNS = [[-17, -18, 5], [15, -9, 5], [-16, -35, 6], [19, -36, 5], [-4, -55, 5], [15, -70, 4], [-20, -65, 6]];

const QUAY_E = 37.2, QUAY_S = 36.4, WATER_Y = -2.2;

// deterministic PRNG so prop layout is identical every run
let seed = 1358961;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
const rr = (a, b) => a + (b - a) * rand();

export function buildLevel(scene, quality) {
  let this_ao = null;
  const root = new THREE.Group();
  scene.add(root);
  const B = new Batch();
  const G = new Batch(); // ground (layer 1: excluded from the planar reflection)
  const blockers = [];
  const block = (x, z, sx, sz, h = 3) => blockers.push({ x1: x - sx / 2, z1: z - sz / 2, x2: x + sx / 2, z2: z + sz / 2, h });
  const lamps = [];      // {pos, color} for water glints & rain lighting
  const spots = [];
  const points = [];

  const M = {
    asphalt: mat('asphalt', { wet: 'ground', normalScale: 0.55 }),
    concrete: mat('concrete', { wet: 'ground' }),
    concreteWall: mat('concrete', { wet: 'surface', tile: 2.5 }),
    steel: mat('steel_dark'), red: mat('steel_red'), yellow: mat('crane_yellow'),
    galv: mat('galvanized'), iron: mat('castiron'), rubber: mat('rubber'), wood: mat('wood'),
    clad: mat('cladding'), hull: mat('hull', { wet: 'surface' }), rope: mat('rope'),
    glassLit: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1.0, 0.86, 0.66), emissiveIntensity: 60, roughness: 0.2 }),
    windowLit: new THREE.MeshStandardMaterial({ color: 0x0b0d0f, emissive: new THREE.Color(1.0, 0.78, 0.5), emissiveIntensity: 3, roughness: 0.1 }),
    windowDark: new THREE.MeshStandardMaterial({ color: 0x07090b, roughness: 0.05, metalness: 0.2 }),
    paintYellow: plainMat(0xb08a2a, 0.55, 0, { wet: 'surface' }),
  };

  // -------------------------------------------------------------- ground
  // Yard asphalt (tiled in 30 m slabs so culling works) + concrete aprons
  for (let z = 32; z > -88; z -= 30) {
    const len = Math.min(30, z + 88);
    G.add(M.asphalt, plane(64.4, len, 1, 1), xform(0, 0, z - len / 2, 0, -Math.PI / 2));
  }
  G.add(M.concrete, plane(QUAY_E - 32.2, 120, 1, 1), xform((32.2 + QUAY_E) / 2, 0, -28, 0, -Math.PI / 2));     // east apron
  G.add(M.concrete, plane(QUAY_E + 36.3, QUAY_S - 32, 1, 1), xform((QUAY_E - 36.3) / 2, 0, (QUAY_S + 32) / 2, 0, -Math.PI / 2)); // pier head
  G.add(M.concrete, plane(4.1, 120, 1, 1), xform(-34.25, 0, -28, 0, -Math.PI / 2)); // warehouse apron
  // asphalt edge strip so the slabs meet the aprons cleanly
  // quay walls down to below the water line + capping beam with worn yellow edge paint
  B.add(M.concreteWall, box(1.2, 9, 124.4), xform(QUAY_E - 0.6, -4.5, -26));
  B.add(M.concreteWall, box(QUAY_E + 36.3, 9, 1.2), xform((QUAY_E - 36.3) / 2, -4.5, QUAY_S - 0.6));
  B.add(M.paintYellow, box(0.25, 0.22, 124.4), xform(QUAY_E - 0.12, 0.11, -26));
  B.add(M.paintYellow, box(QUAY_E + 36.3, 0.22, 0.25), xform((QUAY_E - 36.3) / 2, 0.11, QUAY_S - 0.12));
  // fenders (cone fenders with steel panels) on the east berth face, cylindrical on the pier head
  for (let z = 30; z > -86; z -= 12) {
    B.add(M.rubber, cyl(0.55, 0.8, 1.0, 18), xform(QUAY_E + 0.5, -1.2, z, 0, 0, Math.PI / 2));
    B.add(M.steel, box(0.3, 2.4, 2.2), xform(QUAY_E + 1.05, -1.2, z));
  }
  for (let x = -30; x < 36; x += 9) B.add(M.rubber, cyl(0.4, 0.4, 2.6, 16), xform(x, -0.8, QUAY_S + 0.4, 0, 0, Math.PI / 2));
  // quay ladders
  for (const z of [22, -18, -58]) for (let y = -4; y < 0; y += 0.35) B.add(M.galv, box(0.03, 0.03, 0.5), xform(QUAY_E + 0.12, y, z));
  // bollards
  const bollard = bollardGeometry();
  const bollards = [];
  for (let z = 30; z > -86; z -= 10) bollards.push([QUAY_E - 0.75, z]);
  for (let x = -28; x < 34; x += 12) bollards.push([x, QUAY_S - 0.75]);
  for (const [x, z] of bollards) B.add(M.iron, bollard, xform(x, 0, z));

  // crane rails / RTG runways embedded in the yard
  for (const x of [-6.4, -5.3, 6.1, 7.2]) {
    G.add(M.concrete, plane(0.7, 116, 1, 1), xform(x, 0.004, -28, 0, -Math.PI / 2));
    B.add(M.galv, box(0.075, 0.02, 116), xform(x, 0.01, -28), { shadow: false });
  }
  // drainage channels with grates (galvanised), manholes
  for (const x of [-20, 20]) for (let z = 28; z > -84; z -= 2) B.add(M.galv, box(0.4, 0.015, 1.9), xform(x, 0.006, z), { shadow: false });
  for (const [x, z] of [[-9, 18], [9.5, 12], [-1, -28], [21, -55], [-21, 2]]) B.add(M.iron, cyl(0.42, 0.42, 0.02, 24), xform(x, 0.009, z), { shadow: false });

  // ------------------------------------------------------- road markings
  const markMat = new THREE.MeshStandardMaterial({ color: 0xc9a43a, roughness: 0.55, alphaMap: textures.marking_albedo, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const markWhite = markMat.clone(); markWhite.color.set(0xb9bbb6);
  const MK = new Batch();
  for (const x of [-19.4, 19.4]) MK.add(markMat, plane(0.15, 112, 1, 4), xform(x, 0.006, -27, 0, -Math.PI / 2));
  for (let z = 28; z > -84; z -= 6) MK.add(markWhite, plane(0.12, 3.0, 1, 1), xform(0, 0.006, z, 0, -Math.PI / 2));
  // pedestrian crossing at the pier head
  for (let x = -3; x <= 7; x += 1.2) MK.add(markWhite, plane(0.6, 3.4, 1, 1), xform(x, 0.006, 30.4, 0, -Math.PI / 2));
  // container slot outlines under the stacks
  for (const sx of [-26, 26]) for (let z = 18; z > -84; z -= 13) {
    MK.add(markWhite, plane(3.0, 0.1, 1, 1), xform(sx, 0.006, z, 0, -Math.PI / 2));
  }
  const markMeshes = MK.build(root);
  markMeshes.forEach(m => { m.castShadow = false; m.layers.set(1); m.renderOrder = 1; });

  // -------------------------------------------------------- containers
  const H = CONTAINER.H;
  const placements = [[-26, 16, 0, 1], [-26, -1, 0, 0], [-26, -19, 0, 2], [-27, -40, 0, 3], [-26, -62, 0, 4], [-26, -76, 0, 2],
    [26, 15, 0, 3], [26, -4, 0, 1], [26, -23, 0, 4], [26, -42, 0, 0], [26, -62, 0, 2], [26, -77, 0, 1],
    [-12, -7, 0, 2], [-12, -27, 0, 0], [13, -18, 0, 0], [13, -51, 0, 1], [-12, -49, 0, 4], [-12, -76, 0, 3],
    [12, -75, 0, 0], [26, -4, 1, 3], [-26, -19, 1, 1], [26, -42, 1, 2], [-26, -62, 1, 5], [13, -51, 1, 3]];
  const boxes = [];
  for (const [x, z, tier, c] of placements) {
    boxes.push({ x, z, y: tier * H, ry: rand() < 0.5 ? 0 : Math.PI, color: c });
    if (!tier) block(x, z, CONTAINER.W, CONTAINER.L, H);
  }
  for (const [x, z, c] of [[-1, -38, 3], [10, 7, 1], [-1, -82, 2]]) {
    boxes.push({ x, z, y: 0, ry: Math.PI / 2, color: c });
    block(x, z, CONTAINER.L, CONTAINER.W, H);
  }
  // perimeter stacks closing the north end and the outer lanes (visual, behind bounds)
  for (let x = -30; x <= 30; x += 2.6) for (let t = 0; t < 3; t++) if (rand() < 0.9 - t * 0.25) boxes.push({ x, z: -93, y: t * H, ry: rand() < .5 ? 0 : Math.PI, color: Math.floor(rand() * 6), bg: true });
  for (let z = 26; z > -84; z -= 12.6) for (let t = 0; t < 4; t++) if (rand() < 0.95 - t * 0.2) boxes.push({ x: -31.5, z, y: t * H, ry: 0, color: Math.floor(rand() * 6), bg: t > 0 });
  // gameplay-lane containers get full detail; the background perimeter stacks use the light LOD
  const near = boxes.filter(c => !c.bg), far = boxes.filter(c => c.bg);
  buildContainers(root, near);
  buildContainers(root, far, 1).forEach(m => { m.castShadow = false; });
  // contact shadows: soft ambient occlusion where heavy objects meet the wet ground
  const aoMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: contactTexture(), transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  const AO = new Batch();
  for (const c of boxes) if (c.y === 0 && Math.abs(c.x) < 34 && c.z > -88) {
    const rot = Math.abs(Math.sin(c.ry || 0)) > 0.5;
    AO.add(aoMat, plane(rot ? CONTAINER.L + 1.4 : CONTAINER.W + 1.4, rot ? CONTAINER.W + 1.4 : CONTAINER.L + 1.4, 1, 1), xform(c.x, 0.009, c.z, 0, -Math.PI / 2));
  }
  this_ao = AO;

  // ------------------------------------------------- pallets, drums, barriers
  function palletStack(x, z, n = 3) {
    for (let i = 0; i < n; i++) {
      const px = x + (i % 2) * 1.3, pz = z + Math.floor(i / 2) * 1.35, w = 1.2, d = 1.0;
      const hh = rr(0.7, 1.1);
      // pallet: 3 runners + top boards
      for (const o of [-0.5, 0, 0.5]) B.add(M.wood, box(0.1, 0.1, d), xform(px + o, 0.05, pz));
      for (let k = 0; k < 7; k++) B.add(M.wood, box(w, 0.022, 0.1), xform(px, 0.111, pz - 0.45 + k * 0.15));
      // crated goods with straps
      B.add(M.wood, box(w - 0.06, hh, d - 0.06), xform(px, 0.122 + hh / 2, pz, rr(-0.03, 0.03)));
      for (const o of [-0.3, 0.3]) B.add(M.steel, box(w - 0.04, 0.02, 0.025), xform(px, 0.122 + hh - 0.01, pz + o));
      block(px, pz, w, d, hh);
      this_ao.add(aoMat, plane(w + 0.7, d + 0.7, 1, 1), xform(px, 0.009, pz, 0, -Math.PI / 2));
    }
  }
  palletStack(-16, 15, 3); palletStack(17, 3, 4); palletStack(-17, -40, 2); palletStack(17, -65, 3); palletStack(-3, -4, 2);
  // oil drums: clusters away from nodes, spawn and extraction
  const drum = merged([[rcyl(0.286, 0.88, 0.02)], [rcyl(0.296, 0.035, 0.015), xform(0, 0.29, 0)], [rcyl(0.296, 0.035, 0.015), xform(0, -0.29, 0)], [rcyl(0.29, 0.02, 0.008), xform(0, 0.441, 0)]]);
  const clear = (x, z) => NODES.every(n => Math.hypot(n.x - x, n.z - z) > 4.5) && Math.hypot(EXTRACT.x - x, EXTRACT.z - z) > 6 && Math.hypot(SPAWN.x - x, SPAWN.z - z) > 5 && !blockers.some(b => x > b.x1 - 1 && x < b.x2 + 1 && z > b.z1 - 1 && z < b.z2 + 1) && Math.abs(x) > 2 && !(Math.abs(Math.abs(x) - 6.2) < 1.2);
  let placed = 0;
  for (let i = 0; i < 400 && placed < 22; i++) {
    const x = rr(-30, 30), z = rr(-80, 26);
    if (!clear(x, z)) continue;
    const n = 1 + Math.floor(rand() * 4);
    const dm = rand() < 0.6 ? M.red : M.steel;
    for (let k = 0; k < n; k++) {
      const dx = x + (k % 2) * 0.62 + rr(-0.04, 0.04), dz = z + Math.floor(k / 2) * 0.62;
      B.add(dm, drum, xform(dx, 0.44, dz, rr(0, 6)));
      this_ao.add(aoMat, plane(1.0, 1.0, 1, 1), xform(dx, 0.009, dz, 0, -Math.PI / 2));
    }
    block(x + 0.3, z + 0.3 * (n > 2), n > 1 ? 1.25 : 0.62, n > 2 ? 1.25 : 0.62, 0.9);
    placed++;
  }
  // water-filled safety barriers along the pier head & east edge (visual reason for the bounds)
  const barrier = merged([[box(1.9, 0.75, 0.46, 0.12), xform(0, 0.375, 0)], [box(1.6, 0.24, 0.3, 0.1), xform(0, 0.84, 0)], [box(0.5, 0.08, 0.06, 0.03), xform(-0.5, 0.97, 0)]]);
  const barrierMat = plainMat(0x8c2a18, 0.5, 0, { wet: 'surface' });
  const barrierWhite = plainMat(0x8e8d86, 0.5, 0, { wet: 'surface' });
  let flip = 0;
  for (let x = -33; x < 34; x += 2.0) { if (Math.abs(x - EXTRACT.x) < 0.1) continue; B.add(flip++ % 2 ? barrierMat : barrierWhite, barrier, xform(x, 0, 33.0)); }
  for (let z = 30; z > -84; z -= 2.0) B.add(flip++ % 2 ? barrierMat : barrierWhite, barrier, xform(35.4, 0, z, Math.PI / 2));
  // traffic cones
  const cone = merged([[rcyl(0.17, 0.7, 0.01, 32, 0.025), xform(0, 0.38, 0)], [box(0.38, 0.035, 0.38, 0.015), xform(0, 0.018, 0)]]);
  const coneMat = plainMat(0xd5521d, 0.5, 0, { wet: 'surface' });
  for (const [x, z] of [[4.5, 21], [5.5, 18], [-3.5, 13], [9, -10.5], [-6, -43], [12, -60]]) B.add(coneMat, cone, xform(x, 0, z));
  // reefer power tower + cable reel near the slice
  B.add(M.steel, box(0.8, 2.4, 0.6), xform(22, 1.2, 25.5));
  B.add(M.yellow, box(0.85, 0.12, 0.65), xform(22, 2.45, 25.5));
  block(22, 25.5, 0.8, 0.6, 2.4);
  B.add(M.rubber, catenary([22, 0.6, 25.2], [25.5, 0.03, 21.5], 0.2, 0.03, 18, 6), null);

  // --------------------------------------------------------------- warehouse (west)
  const WX = -36.3, WH = 13;
  // plinth + cladding facade (vertical ridges)
  B.add(M.concreteWall, box(0.5, 1.2, 124), xform(WX - 0.25, 0.6, -26));
  const clad = corrugated(10, WH - 1.2, 0.2, 0.04, 4, WH - 1.2, 0.3);
  for (let z = 31; z > -87; z -= 10) {
    if ([1, 4, 8].some(k => Math.abs(z - (31 - k * 10)) < 0.1)) continue; // door bays
    B.add(M.clad, clad, xform(WX - 0.1, 1.2 + (WH - 1.2) / 2, z - 5, Math.PI / 2));
  }
  for (const k of [1, 4, 8]) {
    const zc = 31 - k * 10 - 5;
    const door = corrugated(5.6, 0.9, 0.9, 0.06, 4, 1, 0.3);
    for (let y = 0; y < 5.4; y += 0.9) B.add(M.steel, door, xform(WX - 0.2, 0.45 + y, zc, Math.PI / 2, 0, 0, 1, 1, 1).multiply(xform(0, 0, 0, 0, 0, 0)));
    B.add(M.clad, clad, xform(WX - 0.1, 1.2 + (WH - 1.2) / 2, zc, Math.PI / 2, 0, 0, 1, 1, 1).multiply(new THREE.Matrix4().makeScale(1, 1, 1)));
    B.add(M.yellow, box(0.3, 5.8, 0.25), xform(WX + 0.05, 2.9, zc - 2.95));
    B.add(M.yellow, box(0.3, 5.8, 0.25), xform(WX + 0.05, 2.9, zc + 2.95));
    for (const o of [-1.9, 1.9]) B.add(M.rubber, box(0.25, 0.5, 0.35), xform(WX + 0.15, 1.0, zc + o));
  }
  B.add(M.steel, box(1.2, 0.35, 124), xform(WX + 0.2, WH + 0.1, -26));  // gutter/eave
  B.add(M.clad, box(16, 0.3, 124), xform(WX - 8, WH + 1.2, -26, 0, 0, 0.12)); // roof
  for (let z = 26; z > -86; z -= 20) B.add(M.galv, cyl(0.06, 0.06, WH, 10), xform(WX + 0.14, WH / 2, z)); // downpipes
  // sign (canvas texture)
  const sign = makeSign('NORTH SEA TERMINAL 04', '#d9dcdc', '#1d2a33', 2048, 256);
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(22, 2.75), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.5, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.25 }));
  sm.position.set(WX + 0.06, 10.4, -12); sm.rotation.y = Math.PI / 2; root.add(sm);
  // wall-pack lights (sodium)
  for (let z = 24; z > -86; z -= 18) {
    B.add(M.steel, box(0.35, 0.3, 0.45), xform(WX + 0.2, 7.2, z));
    B.add(M.glassLit, plane(0.35, 0.3), xform(WX + 0.2, 7.04, z, 0, Math.PI / 2), { shadow: false });
    points.push({ pos: new THREE.Vector3(WX + 0.9, 6.8, z), color: new THREE.Color(1.0, 0.55, 0.22), intensity: 900, distance: 26 });
    root.add(lampGlow(new THREE.Vector3(WX + 0.3, 7.0, z), 0xffa25a, 1.6, 3));
  }

  // --------------------------------------------------------------- light masts
  const MASTS = [
    { x: 31, z: 18, color: new THREE.Color(1.0, 0.6, 0.28), face: [-2.4, -1.6, -0.6, -3.4] },  // sodium, slice
    { x: -31, z: 7, color: new THREE.Color(1.0, 0.88, 0.74), face: [0.8, 1.6, 2.4, 0.0] },     // LED 4000K
    { x: 31, z: -37, color: new THREE.Color(0.86, 0.93, 1.0), face: [-2.4, -1.6, -0.6, -3.4] },  // LED cool
    { x: -31, z: -60, color: new THREE.Color(1.0, 0.62, 0.3), face: [0.8, 1.6, 2.4, 0.0] },    // sodium
  ];
  for (const m of MASTS) {
    const lm = lightMast(m.x, m.z, m.face);
    lm.galv.forEach(([g, t]) => B.add(M.galv, g, t));
    lm.dark.forEach(([g, t]) => B.add(M.steel, g, t));
    lm.glass.forEach(([g, t]) => B.add(M.glassLit, g, t, { shadow: false }));
    block(m.x, m.z, 1.0, 1.0, 3);
    const center = new THREE.Vector3(m.x, 21.6, m.z);
    lamps.push({ pos: center, color: m.color.clone() });
    // one physically-based spot per mast models the combined heads
    const toward = new THREE.Vector3(Math.sign(-m.x) * 10, 0, 0);
    spots.push({ pos: center.clone(), target: new THREE.Vector3(m.x + toward.x, 0, m.z), color: m.color, intensity: 12000, angle: 1.05, penumbra: 0.75 });
    for (const h of lm.heads) {
      root.add(lampGlow(h.pos, m.color, 2.2, 4));
      root.add(lightCone(h.pos, h.dir, 24, 0.38, m.color, 0.016));
    }
  }

  // --------------------------------------------------------------- RTG crane
  const crane = rtgCrane(-11, 15, -75);
  crane.yellow.forEach(([g, t]) => B.add(M.yellow, g, t));
  crane.dark.forEach(([g, t]) => B.add(M.steel, g, t));
  crane.rubber.forEach(([g, t]) => B.add(M.rubber, g, t));
  crane.glass.forEach(([g, t]) => B.add(M.windowLit, g, t, { shadow: false }));
  for (const x of [-11, 15]) for (const s of [-1, 1]) block(x, -75 + s * 3.2, 1.2, 2.2, 3);
  points.push({ pos: new THREE.Vector3(2, 18, -75), color: new THREE.Color(0.9, 0.95, 1.0), intensity: 1800, distance: 30 });

  // --------------------------------------------------------------- ship
  const ship = shipHull(47.1, -22, 104, 17, 11.5, 6.0, WATER_Y);
  // hull paint: dark topsides, white boot-top line and red antifouling at the waterline
  const hullMat = mat('hull', { wet: 'surface', tile: 8.01 });
  const prevHull = hullMat.onBeforeCompile;
  hullMat.onBeforeCompile = (sh) => {
    prevHull(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float wl = ${WATER_Y.toFixed(2)};
      float bootTop = smoothstep(wl + 0.95, wl + 0.9, vWetPos.y);
      float whiteLine = smoothstep(wl + 1.12, wl + 1.08, vWetPos.y) * (1.0 - bootTop);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(3.6, 0.85, 0.7) + vec3(0.06, 0.0, 0.0), bootTop);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.55, 0.52), whiteLine);
    `);
  };
  hullMat.customProgramCacheKey = () => 'hull-paint';
  hullMat.side = THREE.DoubleSide;
  const hullMesh = new THREE.Mesh(ship.geo, hullMat);
  // ship name on the bow and stern
  const nameTex = makeSign('NORDIC TERN', '#e8e8e2', 'rgba(0,0,0,0)', 1024, 160);
  for (const [z, sc, hx] of [[-44, 1, 8.31], [16, 0.8, 8.52]]) {
    const nm = new THREE.Mesh(new THREE.PlaneGeometry(8 * sc, 1.25 * sc), new THREE.MeshStandardMaterial({ map: nameTex, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    nm.position.set(47.1 - hx, ship.deckY - 1.6, z); nm.rotation.y = -Math.PI / 2; root.add(nm);
  }
  hullMesh.castShadow = hullMesh.receiveShadow = true;
  root.add(hullMesh);
  const deckY = ship.deckY;
  B.add(M.steel, box(16.6, 0.3, 92), xform(47.1, deckY - 0.1, -22));
  // bulwark + railing
  for (const s of [-1, 1]) {
    B.add(M.hull, box(0.15, 1.1, 92), xform(47.1 + s * 8.3, deckY + 0.5, -22));
    for (let z = 23; z > -66; z -= 2) B.add(M.galv, cyl(0.025, 0.025, 1.0, 6), xform(47.1 + s * 8.3, deckY + 1.5, z));
    B.add(M.galv, box(0.05, 0.05, 92), xform(47.1 + s * 8.3, deckY + 2.0, -22));
  }
  // accommodation block aft (toward +z), with lit windows
  const ax = 47.1, az = 18;
  for (let lvl = 0; lvl < 5; lvl++) {
    const y = deckY + lvl * 2.8;
    const w = 14 - lvl * 0.4;
    B.add(mat('container_white', { tile: 1 }), box(w, 2.8, 9), xform(ax, y + 1.4, az));
    for (let wi = -5; wi <= 5; wi++) {
      const lit = rand() < 0.4;
      B.add(lit ? M.windowLit : M.windowDark, plane(0.8, 0.9), xform(ax - w / 2 - 0.01, y + 1.6, az + wi * 0.8, -Math.PI / 2), { shadow: false });
    }
    for (let wi = -6; wi <= 6; wi++) {
      const lit = rand() < 0.35;
      B.add(lit ? M.windowLit : M.windowDark, plane(0.8, 0.9), xform(ax + wi * 1.0, y + 1.6, az - 4.51, Math.PI), { shadow: false });
    }
  }
  const bridgeY = deckY + 14;
  B.add(mat('container_white', { tile: 1 }), box(17, 2.6, 7), xform(ax, bridgeY + 1.3, az - 1));
  for (let wi = -8; wi <= 8; wi++) B.add(M.windowLit, plane(0.9, 1.0), xform(ax + wi * 0.95, bridgeY + 1.5, az - 4.51, Math.PI), { shadow: false });
  B.add(M.red, box(3, 5, 4), xform(ax + 2.5, bridgeY + 4.5, az + 2.5)); // funnel
  B.add(M.steel, cyl(0.12, 0.12, 6, 8), xform(ax, bridgeY + 5.5, az - 1)); // mast
  points.push({ pos: new THREE.Vector3(ax - 8, deckY + 5, az - 6), color: new THREE.Color(1.0, 0.82, 0.6), intensity: 1500, distance: 30 });
  lamps.push({ pos: new THREE.Vector3(ax - 7, deckY + 6, az - 5), color: new THREE.Color(1.0, 0.82, 0.6) });
  // deck cargo
  const deckBoxes = [];
  for (let bay = 0; bay < 6; bay++) for (let row = -2; row <= 2; row++) for (let t = 0; t < 4; t++) {
    if (rand() < 0.12 + t * 0.15) continue;
    deckBoxes.push({ x: ax + row * 2.55, z: 5 - bay * 12.6, y: deckY + 0.1 + t * H, ry: 0, color: Math.floor(rand() * 6) });
  }
  buildContainers(root, deckBoxes, 1);
  // mooring lines: ship fairleads to quay bollards
  const fair = [[38.9, deckY + 0.6, 20], [38.9, deckY + 0.6, 14], [38.9, deckY + 0.3, -58], [38.9, deckY + 0.3, -62]];
  const tie = [[QUAY_E - 0.75, 0.68, 30], [QUAY_E - 0.75, 0.68, 0], [QUAY_E - 0.75, 0.68, -50], [QUAY_E - 0.75, 0.68, -80]];
  fair.forEach((f, i) => B.add(M.rope, catenary(f, tie[i], 0.5, 0.04, 30, 7), null, { shadow: true }));

  // --------------------------------------------------------------- far shore lights (south, across the basin)
  const shore = new THREE.Group();
  for (let i = 0; i < 70; i++) {
    const c = rand() < 0.6 ? 0xffa050 : 0xd8e6ff;
    shore.add(lampGlow(new THREE.Vector3(rr(-260, 260), rr(1, 9), rr(260, 340)), c, rr(2, 5), 2.5));
  }
  root.add(shore);

  // --------------------------------------------------------------- nodes (jammer units)
  const nodeObjs = NODES.map(n => buildNode(root, B, M, n));
  for (const n of NODES) block(n.x, n.z, 1.55, 1.0, 2.6);

  // --------------------------------------------------------------- extraction
  const EX = new Batch();
  EX.add(markMat, plane(5, 0.25), xform(EXTRACT.x, 0.007, EXTRACT.z - 2.5, 0, -Math.PI / 2));
  EX.add(markMat, plane(5, 0.25), xform(EXTRACT.x, 0.007, EXTRACT.z + 2.5, 0, -Math.PI / 2));
  EX.add(markMat, plane(0.25, 5), xform(EXTRACT.x - 2.5, 0.007, EXTRACT.z, 0, -Math.PI / 2));
  EX.add(markMat, plane(0.25, 5), xform(EXTRACT.x + 2.5, 0.007, EXTRACT.z, 0, -Math.PI / 2));
  EX.build(root).forEach(m => { m.castShadow = false; m.layers.set(1); });
  const exSign = makeSign('EVAC / PIER 04', '#9ff0e3', '#0f2026', 1024, 160);
  const es = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.7), new THREE.MeshStandardMaterial({ map: exSign, emissive: 0xffffff, emissiveMap: exSign, emissiveIntensity: 0.6, roughness: 0.6 }));
  es.position.set(EXTRACT.x, 1.6, 33.25); es.rotation.y = Math.PI; root.add(es);
  B.add(M.galv, cyl(0.04, 0.04, 1.7, 8), xform(EXTRACT.x - 2, 0.85, 33.3));
  B.add(M.galv, cyl(0.04, 0.04, 1.7, 8), xform(EXTRACT.x + 2, 0.85, 33.3));

  this_ao.build(root).forEach(m => { m.castShadow = false; m.receiveShadow = false; m.layers.set(1); m.renderOrder = 2; });
  const meshes = B.build(root);
  const groundMeshes = G.build(root);
  groundMeshes.forEach(m => { m.layers.set(1); m.castShadow = false; });
  return { root, blockers, lamps, spots, points, nodeObjs, meshes, groundMeshes };
}

function makeSign(text, fg, bg, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${Math.round(h * 0.62)}px Arial, Helvetica, sans-serif`;
  g.fillText(text, w / 2, h / 2 + 4);
  // weathering: speckle + streaks
  for (let i = 0; i < w * h / 180; i++) { g.fillStyle = `rgba(20,20,20,${Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2 + Math.random() * 10); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Signal jammer: rugged equipment case on a skid, telescopic antenna, cable, red status LED.
function buildNode(root, B, M, n) {
  const g = new THREE.Group();
  g.position.set(n.x, 0, n.z);
  const T = (x, y, z, ry = 0, rx = 0, rz = 0) => xform(n.x + x, y, n.z + z, ry, rx, rz);
  B.add(M.steel, box(1.7, 0.12, 1.1), T(0, 0.06, 0));
  B.add(mat('polymer', { tile: 0.6 }), box(1.4, 1.1, 0.8), T(0, 0.7, 0));
  B.add(mat('polymer', { tile: 0.6 }), box(1.46, 0.1, 0.86), T(0, 1.28, 0));
  for (const x of [-0.5, 0.5]) B.add(M.galv, box(0.12, 0.08, 0.06), T(x, 1.0, 0.43));
  B.add(M.galv, cyl(0.03, 0.045, 3.2, 8), T(0.45, 2.9, -0.2));
  for (const a of [0, 2.1, 4.2]) B.add(M.galv, cyl(0.012, 0.012, 1.2, 6), T(0.45 + Math.sin(a) * 0.25, 3.6, -0.2 + Math.cos(a) * 0.25, 0, Math.cos(a) * 0.35, -Math.sin(a) * 0.35));
  B.add(M.steel, box(0.5, 0.35, 0.25), T(-0.35, 1.5, 0.1));
  B.add(M.rubber, catenary([n.x - 0.6, 0.4, n.z + 0.4], [n.x - 2.8, 0.03, n.z + 1.8], 0.25, 0.025, 14, 6), null);
  // status panel (emissive, updated by game state)
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: new THREE.Color(1, 0.12, 0.05), emissiveIntensity: 8, roughness: 0.3 });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.3), panelMat);
  panel.position.set(0, 0.85, 0.405); g.add(panel);
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: new THREE.Color(1, 0.05, 0.02), emissiveIntensity: 40 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), ledMat);
  led.position.set(0.45, 4.55, -0.2); g.add(led);
  const light = new THREE.PointLight(0xff2a10, 25, 6, 2);
  light.position.set(0, 1.2, 0.8); g.add(light);
  root.add(g);
  return { group: g, panelMat, ledMat, light, node: n };
}

// Soft rectangular falloff used for contact shadows (alpha map, white = dark).
let _contact = null;
function contactTexture() {
  if (_contact) return _contact;
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = Math.max(0, Math.abs(x - n / 2 + 0.5) / (n / 2) - 0.55) / 0.45, dy = Math.max(0, Math.abs(y - n / 2 + 0.5) / (n / 2) - 0.55) / 0.45;
    const d = Math.min(1, Math.hypot(dx, dy));
    const v = Math.pow(1 - d, 2.2) * 255;
    const i = (y * n + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _contact = new THREE.CanvasTexture(c);
  return _contact;
}
