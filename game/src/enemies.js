// Guard: one continuous skinned body (see characters/soldier.js) with rigid gear,
// a detailed Kalashnikov and a procedural animation layer:
//  - foot-planted walk/run (stride derived from speed and phase rate, so feet do not skate)
//  - pelvis bob/sway/twist with counter-rotating chest, idle breathing and weight shift
//  - rifle carried at patrol low-ready, raised to a shouldered aim with cheek weld
//  - two-bone IK keeps the right hand on the pistol grip and the left on the handguard
//  - head stabilises its gaze, scans while patrolling, looks down the sights when aiming
//  - hit flinch, recoil, and a keyed death (knees buckle, torso twists, fall, settle)
import * as THREE from 'three';
import { box, rcyl, cyl, xform } from './geo.js';
import { mat, plainMat } from './materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSoldierMesh, BONE_DEFS, BI, LEN } from './characters/soldier.js';
import { fabricShading } from './characters/cloth.js';

function M(list) {
  return mergeGeometries(list.map(([g, m]) => { const x = g.index ? g.toNonIndexed() : g.clone(); if (m) x.applyMatrix4(m); for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; }));
}

let shared = null;
/** Insignia atlas: left half = Swedish flag, right half = generic Home Guard shield ("HV"); drawn here, no external art. */
function patchTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  // flag 0..128: blue field, yellow Nordic cross (vertical bar offset to the hoist side)
  x.fillStyle = '#0b5c9a'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#e2b92b'; x.fillRect(128 * 5 / 16, 0, 128 * 2 / 16, 128); x.fillRect(0, 128 * 0.4, 128, 128 * 0.2);
  x.strokeStyle = 'rgba(20,24,18,0.9)'; x.lineWidth = 6; x.strokeRect(3, 3, 122, 122);
  x.strokeStyle = 'rgba(210,210,190,0.25)'; x.setLineDash([4, 4]); x.lineWidth = 1.5; x.strokeRect(8, 8, 112, 112);
  x.setLineDash([]);
  // shield 128..256: dark field, pale rim, "HV"
  x.fillStyle = '#26291f'; x.fillRect(128, 0, 128, 128);
  x.beginPath(); x.moveTo(146, 16); x.lineTo(238, 16); x.lineTo(238, 70); x.quadraticCurveTo(238, 108, 192, 120); x.quadraticCurveTo(146, 108, 146, 70); x.closePath();
  x.fillStyle = '#14160f'; x.fill(); x.lineWidth = 6; x.strokeStyle = '#b8b38d'; x.stroke();
  x.fillStyle = '#c9c49b'; x.font = 'bold 50px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('HV', 192, 62);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function materials() {
  if (shared) return shared;
  shared = {
    uniform: fabricShading(mat('camo_emr', { tile: 0.42, color: 0x8c9694 }), { dirt: 0.55, sheen: 0.1, soak: 0.35 }),
    uniformHV: fabricShading(mat('camo_m90', { tile: 0.45, color: 0x9aa397 }), { dirt: 0.55, sheen: 0.1, soak: 0.35 }),
    vest: fabricShading(mat('ratnik_green', { tile: 0.35, color: 0x8f9a88 }), { dirt: 0.4, sheen: 0.06, soak: 0.3, wrinkle: 0.3 }),
    knit: fabricShading(mat('olive_knit', { tile: 0.12, color: 0xa5a898 }), { dirt: 0.2, sheen: 0.18, soak: 0.25, wrinkle: 0.1 }),
    glove: mat('fabric_glove', { tile: 0.15, color: 0x5a5a5a }),   // black rubber / hard shell parts
    gloveFab: fabricShading(mat('glove_green', { tile: 0.12, color: 0xaeb4a2 }), { dirt: 0.5, sheen: 0.05, soak: 0.3, wrinkle: 0.2 }),
    boot: fabricShading(mat('boot_leather', { tile: 0.25, color: 0x5a524c }), { dirt: 1.0, sheen: 0.0, soak: 0.25, wrinkle: 0.2 }),
    gun: mat('gunmetal'),
    wood: mat('ak_wood', { tile: 0.3, color: 0xa39c96 }),
    poly: mat('polymer', { tile: 0.25 }),
    plum: mat('plum_polymer', { tile: 0.2 }),
    patch: new THREE.MeshStandardMaterial({ map: patchTexture(), roughness: 0.9, metalness: 0 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.06, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 }), // tinted lenses
  };
  return shared;
}


/**
 * Lofted handguard along -Z. secs: [{z, hw, ht, hb, cy}] half width, half height above/below centre cy.
 * Cross-section is a super-ellipse (p) so it reads as a rounded rectangle, not a tube. groove(z, side)
 * returns an inward offset for the underside (finger grooves) ; flutes = longitudinal rib count (0 = none).
 */
function loft(secs, N, p = 3.2, groove = null, flutes = 0, fluteAmp = 0.0011) {
  const pos = [], uv = [], idx = [];
  const e = 2 / p;
  secs.forEach((q, i) => {
    let acc = 0;
    for (let j = 0; j <= N; j++) {
      const a = (j % N) / N * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      let x = q.hw * Math.sign(c) * Math.pow(Math.abs(c), e), y = q.cy + (sn > 0 ? q.ht : q.hb) * Math.sign(sn) * Math.pow(Math.abs(sn), e);
      if (groove && sn < -0.25) y += groove(q.z) * Math.min(1, (-sn - 0.25) * 3);
      if (flutes) { const f = fluteAmp * Math.cos(a * flutes); x += Math.cos(a) * f; y += Math.sin(a) * f; }
      pos.push(x, y, q.z);
      uv.push((j / N) * 2 * (q.hw + (q.ht + q.hb) / 2) * 1.6, -q.z);
    }
  });
  const R = N + 1;
  for (let i = 0; i < secs.length - 1; i++) for (let j = 0; j < N; j++) { const a = i * R + j, b = a + 1, c = a + R, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orientation check: normals must point away from the axis
  const n = g.attributes.normal, P = g.attributes.position, k = Math.floor(secs.length / 2) * R;
  if (n.getX(k) * (P.getX(k) - 0) + (n.getY(k)) * (P.getY(k) - secs[Math.floor(secs.length / 2)].cy) < 0) {
    const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

// Kalashnikov family at real scale. Barrel toward -Z, origin near the magazine well.
// variant 'ak74': AK-74M (black polymer, plum magazine, AK-74 muzzle brake)
// variant 'akm' : AKM pattern (laminated wood furniture, slant brake, steel magazine)
function kalashnikov(S, variant) {
  const g = new THREE.Group();
  const akm = variant === 'akm';
  const furn = akm ? S.wood : S.poly;
  const magM = akm ? S.gun : S.plum;
  const add = (list, m) => { const o = new THREE.Mesh(M(list), m); o.castShadow = true; g.add(o); return o; };
  const Z = Math.PI / 2;
  add([
    [box(0.046, 0.058, 0.25, 0.004), xform(0, 0, 0.02)],                 // stamped receiver
    [box(0.042, 0.024, 0.235, 0.011), xform(0, 0.038, 0.03)],           // ribbed dust cover
    ...[0, 1, 2].map(i => [box(0.044, 0.004, 0.006), xform(0, 0.051, 0.13 - i * 0.012)]),
    [box(0.05, 0.03, 0.03), xform(0, 0.005, -0.115)],            // front trunnion
    [box(0.03, 0.02, 0.06), xform(0, 0.042, -0.125)],            // rear sight block
    [box(0.026, 0.006, 0.08), xform(0, 0.056, -0.11)],           // sight leaf
    [box(0.008, 0.012, 0.018), xform(0.03, 0.03, 0.02)],         // charging handle
    [cyl(0.0085, 0.0085, 0.3, 12), xform(0, 0.0, -0.4, 0, Z)],         // barrel
    [cyl(0.011, 0.011, 0.2, 12), xform(0, 0.034, -0.27, 0, Z)],       // gas tube
    [box(0.022, 0.05, 0.035), xform(0, 0.022, -0.52)],           // front sight block / gas block
    [box(0.016, 0.03, 0.01), xform(0, 0.055, -0.525)],           // front sight ears
    [box(0.006, 0.02, 0.06), xform(0.026, 0.005, 0.05)],         // selector lever
    [box(0.01, 0.006, 0.07), xform(0, -0.038, 0.075)],           // trigger guard bottom
    [box(0.006, 0.02, 0.008), xform(0, -0.032, 0.06, 0, -0.3)], // trigger
    [box(0.024, 0.008, 0.012), xform(0, -0.012, -0.505)],        // bayonet lug
    ...(akm
      ? [[rcyl(0.012, 0.045, 0.003, 14), xform(0, 0.0, -0.565, 0, Z)]]
      : [[rcyl(0.0135, 0.085, 0.004, 16), xform(0, 0.0, -0.585, 0, Z)], [box(0.03, 0.006, 0.012), xform(0, 0.0, -0.57)]]),
  ], S.gun);
  // handguards: lofted rounded-rectangle sections (not tubes). Lower: wide, flat-sided, wraps the barrel from below
  // with finger grooves on the underside; upper: shallow shell over the gas tube with a rounded crown.
  const lower = loft([
    { z: -0.152, hw: 0.0215, ht: 0.0, hb: 0.0, cy: -0.012 },
    { z: -0.156, hw: 0.0225, ht: 0.018, hb: 0.021, cy: -0.012 },
    { z: -0.17, hw: 0.0235, ht: 0.026, hb: 0.024, cy: -0.011 },
    ...Array.from({ length: 14 }, (_, i) => { const z = -0.19 - i * 0.0125; return { z, hw: 0.0235 - i * 0.0002, ht: 0.026 - i * 0.0003, hb: 0.0235 - i * 0.0002, cy: -0.011 }; }),
    { z: -0.368, hw: 0.0215, ht: 0.0245, hb: 0.021, cy: -0.011 },
    { z: -0.374, hw: 0.019, ht: 0.02, hb: 0.017, cy: -0.011 },
    { z: -0.376, hw: 0.0, ht: 0.0, hb: 0.0, cy: -0.011 },
  ], akm ? 14 : 18, akm ? 3.4 : 3.0, akm ? (z => 0.0034 * Math.pow(0.5 + 0.5 * Math.cos((z + 0.2) / 0.0235 * Math.PI * 2), 1.6) * (z < -0.19 && z > -0.34 ? 1 : 0)) : null, akm ? 0 : 14);
  const upper = loft([
    { z: -0.168, hw: 0.0, ht: 0.0, hb: 0.0, cy: 0.04 },
    { z: -0.172, hw: 0.0175, ht: 0.016, hb: 0.014, cy: 0.04 },
    { z: -0.19, hw: 0.0185, ht: 0.0175, hb: 0.016, cy: 0.04 },
    { z: -0.28, hw: 0.0185, ht: 0.0175, hb: 0.016, cy: 0.04 },
    { z: -0.38, hw: 0.0175, ht: 0.0165, hb: 0.0155, cy: 0.039 },
    { z: -0.402, hw: 0.0155, ht: 0.0145, hb: 0.014, cy: 0.039 },
    { z: -0.405, hw: 0.0, ht: 0.0, hb: 0.0, cy: 0.039 },
  ], 12, 2.6, null, akm ? 0 : 12, 0.0009);
  add([
    [lower, null],
    [upper, null],
    [box(0.032, 0.1, 0.044, 0.012), xform(0, -0.082, 0.112, 0, -0.32)],               // pistol grip (raked back)
    ...(akm
      ? [[box(0.042, 0.065, 0.25, 0.014), xform(0, -0.022, 0.27, 0, 0.1)], [box(0.046, 0.13, 0.03, 0.012), xform(0, -0.05, 0.395, 0, 0.1)]]
      : [[box(0.04, 0.03, 0.25, 0.01), xform(0, -0.005, 0.27, 0, 0.1)], [box(0.036, 0.024, 0.2, 0.008), xform(0, -0.06, 0.29, 0, 0.18)],
        [box(0.044, 0.135, 0.03, 0.012), xform(0, -0.05, 0.395, 0, 0.1)], [box(0.036, 0.012, 0.03), xform(0, -0.03, 0.19, 0, 0.6)]]),
  ], furn);
  // curved 30-round magazine: segments rotated progressively, with a floor plate
  const segs = [];
  for (let i = 0; i < 5; i++) segs.push([box(0.028, 0.046, 0.072 - i * 0.002, 0.006), xform(0, -0.05 - i * 0.04, -0.07 - i * i * 0.007, 0, 0.12 + i * 0.12)]);
  segs.push([box(0.032, 0.012, 0.068, 0.004), xform(0, -0.235, -0.18, 0, 0.66)]);
  add(segs, magM);
  return g;
}

/**
 * Swedish Ak 4C (G3 lineage, 7.62x51): stamped receiver, cocking tube above the barrel, slim ventilated handguard,
 * straight 20-round magazine, collapsible stock, top rail with a red-dot tube. Matte black. Same frame as the AK.
 */
function ak4c(S) {
  const g = new THREE.Group();
  const add = (list, m) => { const o = new THREE.Mesh(M(list), m); o.castShadow = true; g.add(o); return o; };
  const Z = Math.PI / 2;
  add([
    [box(0.046, 0.064, 0.4, 0.008), xform(0, 0.0, 0.065)],                // receiver
    [box(0.05, 0.034, 0.1, 0.004), xform(0, 0.0, -0.14)],                  // barrel trunnion / handguard retainer
    [cyl(0.0095, 0.0095, 0.42, 14), xform(0, 0.004, -0.37, 0, Z)],         // barrel
    [cyl(0.0125, 0.0125, 0.065, 14), xform(0, 0.004, -0.6, 0, Z)],        // flash hider body
    ...[0, 1, 2, 3].map(i => [box(0.026, 0.0035, 0.008), xform(0, 0.004, -0.578 - i * 0.014)]),
    [cyl(0.0085, 0.0085, 0.3, 12), xform(-0.004, 0.039, -0.03, 0, Z)],     // cocking tube
    [box(0.014, 0.014, 0.02, 0.003), xform(-0.004, 0.039, -0.19)],         // cocking handle knob
    [box(0.026, 0.008, 0.34, 0.002), xform(0, 0.036, 0.07)],               // top rail
    ...Array.from({ length: 12 }, (_, i) => [box(0.028, 0.003, 0.004), xform(0, 0.0405, -0.07 + i * 0.026)]), // rail slots
    [box(0.02, 0.05, 0.02), xform(0, 0.025, -0.51)],                       // front sight hood
    [box(0.004, 0.026, 0.004), xform(0, 0.056, -0.51)],                    // front post
    [box(0.007, 0.022, 0.07), xform(0.027, 0.006, 0.05)],                  // selector
    [box(0.01, 0.006, 0.07), xform(0, -0.04, 0.095)],                      // trigger guard
    [box(0.006, 0.02, 0.008), xform(0, -0.032, 0.07, 0, -0.3)],             // trigger
    [box(0.014, 0.012, 0.012), xform(0.027, 0.005, -0.1)],                 // sling swivel
  ], S.gun);
  // red-dot sight: tube, objective hood, ocular, riser mount
  add([
    [cyl(0.0165, 0.0165, 0.1, 18), xform(0, 0.093, -0.045, 0, Z)],
    [cyl(0.0195, 0.0165, 0.03, 18), xform(0, 0.093, -0.105, 0, Z)],
    [cyl(0.0185, 0.0185, 0.014, 18), xform(0, 0.093, 0.012, 0, Z)],
    [box(0.026, 0.044, 0.07, 0.004), xform(0, 0.056, -0.045)],
    [box(0.01, 0.01, 0.014), xform(0.0, 0.113, -0.045)],             // elevation cap
    [box(0.014, 0.012, 0.006), xform(0.019, 0.093, -0.045)],          // windage cap
  ], S.poly);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0155, 16), S.visor);
  lens.position.set(0, 0.093, -0.121); lens.rotation.y = Math.PI; lens.scale.set(1, 1, 1); g.add(lens);
  // slim ventilated handguard with side slots and a rounded underside
  const hg = loft([
    { z: -0.11, hw: 0.0, ht: 0.0, hb: 0.0, cy: -0.004 },
    { z: -0.114, hw: 0.025, ht: 0.027, hb: 0.024, cy: -0.004 },
    { z: -0.2, hw: 0.027, ht: 0.028, hb: 0.026, cy: -0.004 },
    { z: -0.33, hw: 0.025, ht: 0.026, hb: 0.024, cy: -0.004 },
    { z: -0.385, hw: 0.023, ht: 0.024, hb: 0.022, cy: -0.004 },
    { z: -0.388, hw: 0.0, ht: 0.0, hb: 0.0, cy: -0.004 },
  ], 14, 2.8, null, 0);
  const slots = [];
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) slots.push([box(0.004, 0.02, 0.026, 0.001), xform(sx * 0.0268, 0.0, -0.15 - i * 0.034)]);
  add([[hg, null], ...slots,
    [box(0.032, 0.1, 0.044, 0.012), xform(0, -0.08, 0.125, 0, -0.32)],      // pistol grip
    [box(0.04, 0.06, 0.1, 0.01), xform(0, -0.03, 0.27, 0, 0.0)],             // stock slider
    [cyl(0.0065, 0.0065, 0.17, 8), xform(0.014, 0.016, 0.34, 0, Z * 0, 0).multiply(new THREE.Matrix4().makeRotationX(Z))],
    [cyl(0.0065, 0.0065, 0.17, 8), xform(-0.014, 0.016, 0.34, 0, Z * 0, 0).multiply(new THREE.Matrix4().makeRotationX(Z))],
    [box(0.044, 0.125, 0.03, 0.012), xform(0, -0.02, 0.41, 0, 0.1)],         // butt
  ], S.poly);
  // straight 20-round magazine (ribbed steel) with floor plate
  add([
    [box(0.027, 0.15, 0.058, 0.004), xform(0, -0.1, -0.035)],
    ...[0, 1, 2, 3, 4].map(i => [box(0.029, 0.004, 0.06), xform(0, -0.05 - i * 0.025, -0.035)]),
    [box(0.031, 0.01, 0.063, 0.003), xform(0, -0.178, -0.035)],
  ], S.gun);
  return g;
}

function buildRifle(S, weapon) { return weapon === 'ak4c' ? ak4c(S) : kalashnikov(S, weapon === 'akm' ? 'akm' : 'ak74'); }

/**
 * createSoldier({ side: 'opfor' | 'hv', weapon: 'ak74' | 'akm' | 'ak4c', helmet?: boolean })
 *  side 'opfor': EMR camo, earmuffs + glasses.  side 'hv': Swedish Home Guard, M90 camo, sleeve patches (flag left,
 *  generic HV shield right); helmet defaults to ~40 % random (true = M90-covered helmet, false = earmuffs + balaclava).
 * Returns the same object as createGuard (root, rifle, flash, flashMesh, mesh, bones, rest, s); pose it with
 * poseGuard / poseSoldier using the identical state object.
 */
export function createSoldier({ side = 'opfor', weapon, helmet } = {}) {
  const S = materials();
  const hv = side === 'hv';
  weapon = weapon || (hv ? 'ak4c' : 'ak74');
  const kind = !hv ? 'opfor' : ((helmet ?? Math.random() < 0.4) ? 'hv_helmet' : 'hv');
  const root = new THREE.Group();
  const { mesh, bones, rest } = createSoldierMesh({ camo: hv ? S.uniformHV : S.uniform, knit: S.knit, black: S.glove, boot: S.boot, web: S.vest, lens: S.visor, glove: S.gloveFab, patch: S.patch }, kind);
  root.add(mesh);
  const rifle = buildRifle(S, weapon);
  root.add(rifle);
  const mz = weapon === 'ak4c' ? -0.64 : -0.66;
  const flash = new THREE.PointLight(0xffa040, 0, 7, 2); flash.position.set(0, 0.0, mz); rifle.add(flash);
  const fl = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.5, 1.5) }));
  fl.position.set(0, 0.0, mz); fl.visible = false; rifle.add(fl);
  root.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  root.userData.tbSoldier = { body: mesh, rifle, flashMesh: fl, mats: mesh.material, single: mesh.material[mesh.geometry.userData.names.indexOf('camo')] }; // distance policies for shadow / reflection passes: world/props/lod.js
  const seed = Math.random() * 100;
  const g = {
    root, rifle, flash, flashMesh: fl, mesh, bones, rest, side, weapon, kind,
    s: { t: 0, time: seed, ph: null, rate: 0, seed, hitSide: 1, lastHit: 0, death: null, mm: bones.map(() => new THREE.Matrix4()), mq: bones.map(() => new THREE.Quaternion()) },
  };
  poseGuard(g, { walk: 0, speed: 0, aim: 0, flash: 0, hit: 0, dead: 0, fallDir: 1 });
  return g;
}

/** OPFOR guard (API used by game.js): variant 'ak74' | 'akm'. */
export function createGuard(variant = 'ak74') {
  return createSoldier({ side: 'opfor', weapon: variant }); }

// ------------------------------------------------------------------ math helpers
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const PARENT = BONE_DEFS.map(d => d[1]);
const _qf = new THREE.Quaternion(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const UNIT = new THREE.Vector3(1, 1, 1);
const _pLow = new THREE.Vector3(), _pAim = new THREE.Vector3(), _qLow = new THREE.Quaternion(), _qAim = new THREE.Quaternion();
const qE = (x, y, z, q = new THREE.Quaternion()) => q.setFromEuler(_e.set(x, y, z, 'YXZ'));

/** Model-space (root-local) forward kinematics for bone i (parents must be current). */
function fk(g, i) {
  const s = g.s, b = g.bones[i], p = PARENT[i];
  b.updateMatrix();
  if (p < 0) { s.mm[i].copy(b.matrix); s.mq[i].copy(b.quaternion); }
  else { s.mm[i].multiplyMatrices(s.mm[p], b.matrix); s.mq[i].multiplyQuaternions(s.mq[p], b.quaternion); }
}
function fkFrom(g, i0) { for (let i = i0; i < g.bones.length; i++) fk(g, i); }
const bonePos = (g, i, v) => v.setFromMatrixPosition(g.s.mm[i]);
/** Set bone i so that its model-space orientation equals q. */
function setModelRot(g, i, q) {
  const p = PARENT[i];
  g.bones[i].quaternion.copy(_q3.copy(g.s.mq[p]).invert().multiply(q));
  fk(g, i);
}

/**
 * Analytic two-bone IK in model space. Limbs point along local -Y.
 * sign +1 (arm): local +Z faces the joint pole, lower bone flexes toward local -Z.
 * sign -1 (leg): local -Z faces the joint pole (knee forward), shin flexes toward +Z.
 */
function twoBone(g, iu, il, L1, L2, target, pole, sign) {
  bonePos(g, iu, _S);
  _u.subVectors(target, _S);
  let d = _u.length();
  d = clamp(d, 0.05, (L1 + L2) * 0.9995);
  _u.normalize();
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _w.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_w.lengthSq() < 1e-8) _w.set(0, 0, sign); _w.normalize();
  _E.copy(_S).addScaledVector(_u, L1 * cosA).addScaledVector(_w, L1 * sinA);
  _T.copy(_S).addScaledVector(_u, d);
  _a.subVectors(_E, _S).normalize();           // upper direction
  _b.subVectors(_T, _E).normalize();           // lower direction
  _y.copy(_a).negate();
  _z.copy(_w).addScaledVector(_a, -_w.dot(_a)).normalize().multiplyScalar(sign);
  _x.crossVectors(_y, _z).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  _q.setFromRotationMatrix(_m);
  setModelRot(g, iu, _q);
  const ang = Math.acos(clamp(_a.dot(_b), -1, 1));
  g.bones[il].quaternion.setFromAxisAngle(_x.set(1, 0, 0), sign * ang);
  fk(g, il);
}

// hand frames relative to the rifle (see soldier.js hand(): palm faces -X*side, grip centre at (palm*0.03, -0.097, 0))
const GRIP_R = new THREE.Vector3(0, -0.062, 0.1);
const GRIP_L = new THREE.Vector3(-0.004, -0.012, -0.21);
const HAND_R_Q = (() => {
  const X = new THREE.Vector3(1, 0, 0), Zd = new THREE.Vector3(0, -0.95, 0.31).normalize();
  const Y = new THREE.Vector3().crossVectors(Zd, X).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Zd));
})();
const HAND_L_Q = (() => {
  const al = 0.55, Y = new THREE.Vector3(-Math.cos(al), -Math.sin(al), 0), Zd = new THREE.Vector3(0, 0, 1);
  const X = new THREE.Vector3().crossVectors(Y, Zd).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Zd));
})();
const GRIP_IN_HAND_R = new THREE.Vector3(-0.03, -0.097, 0.004);
const GRIP_IN_HAND_L = new THREE.Vector3(0.03, -0.097, 0.0);
const BUTT = new THREE.Vector3(0, -0.05, 0.41);       // buttpad centre in rifle space
const BUTT_LOW = new THREE.Vector3(0.18, -0.07, -0.13); // sling carry: butt position in chest space
const EYE = new THREE.Vector3(0.034, 0.128, -0.078);

// ------------------------------------------------------------------ alive pose
function poseAlive(g, st, dt) {
  const s = g.s, B = g.bones, t = s.time;
  for (let i = 0; i < B.length; i++) { B[i].quaternion.identity(); B[i].position.copy(g.rest[i]); }
  const aimRaw = clamp(st.aim, 0, 1), A = sstep(0, 1, aimRaw);
  const sp = clamp(st.speed, 0, 1);
  const m = sstep(0.04, 0.3, sp) * sstep(0.3, 1.2, s.rate);
  const run = sstep(0.6, 0.95, sp);
  const ph = st.walk;
  const duty = lerp(0.6, 0.42, run);
  const rate = Math.max(s.rate, 1.5);
  const v = sp * 2.3;
  const D = clamp(v * duty * Math.PI * 2 / rate, 0, 0.95) * m;
  const breath = Math.sin(t * 1.65 + s.seed);
  const shift = Math.sin(t * 0.33 + s.seed * 1.7);
  const hit = clamp(st.hit, 0, 1);
  if (hit > s.lastHit + 0.3) s.hitSide = Math.random() < 0.5 ? -1 : 1;
  s.lastHit = hit;
  const kick = st.flash > 0 ? clamp(st.flash / 0.13, 0, 1) : 0;
  const midR = Math.PI * duty;

  // ---- pelvis
  const bobW = Math.cos(2 * (ph - midR));
  const hy = 0.97 - 0.022 - 0.045 * A - 0.06 * run * m + m * (0.022 * (1 - run) * bobW - 0.025 * run * bobW) + 0.004 * (1 - m) * breath * 0.3;
  const hx = m * 0.022 * (1 - 0.5 * run) * Math.cos(ph - midR) + (1 - m) * 0.022 * shift;
  const hz = 0.02 * A;
  const swingR = Math.PI * 2 * (duty + (1 - duty) / 2);
  const twist = m * (0.1 + 0.06 * run) * Math.cos(ph - swingR);
  const blade = -0.38 * A * (1 - 0.6 * m);
  B[BI.hips].position.set(hx, hy, hz);
  qE(-(0.03 + 0.12 * run * m + 0.04 * A) + hit * 0.12, twist + blade, m * 0.035 * (1 - run) * Math.cos(ph - midR) + (1 - m) * 0.03 * shift, B[BI.hips].quaternion);
  // ---- spine / chest (counter-rotate the gait twist; square the shoulders when aiming)
  qE(-0.02 - 0.05 * A + hit * 0.12, -twist * 0.45 - blade * 0.2 + hit * 0.15 * s.hitSide, -0.02 * shift * (1 - m), B[BI.spine].quaternion);
  qE(0.01 * breath * (1 - 0.5 * A) - 0.03 * A - 0.04 * run * m + hit * 0.18 + kick * 0.04, -twist * 0.5 - blade * 0.2 + hit * 0.2 * s.hitSide, 0, B[BI.chest].quaternion);
  B[BI.chest].position.y += 0.0025 * breath;
  // clavicles: slight shrug/protraction when shouldering
  qE(0, 0.06 * A, 0.3 * A + 0.01 * breath, B[BI.clavR].quaternion);
  qE(0, -0.12 - 0.3 * A, -0.04 * A - 0.01 * breath, B[BI.clavL].quaternion);
  // neck flexes forward into the cheek weld
  qE(-0.04 - 0.72 * A + hit * 0.25, 0, -0.14 * A, B[BI.neck].quaternion);
  fkFrom(g, 0);

  // ---- head: gaze-stabilised in model space
  const scan = (1 - A) * (0.45 * Math.sin(t * 0.27 + s.seed) + 0.15 * Math.sin(t * 0.71 + s.seed * 3));
  const lookPitch = lerp(-0.1 + 0.03 * Math.sin(t * 0.4), -0.2, A) + hit * 0.35;
  setModelRot(g, BI.head, qE(lookPitch, scan + A * 0.04, -0.2 * A, _q2));
  fkFrom(g, BI.head + 1);

  // ---- legs: foot-planted gait blended with an idle / bladed stance
  for (const side of [1, -1]) {
    const R = side > 0;
    const phi = ph + (R ? 0 : Math.PI);
    const u = ((phi / (Math.PI * 2)) % 1 + 1) % 1;
    let fz, fy = 0, pitch = 0;
    if (u < duty) {
      const k = u / duty;
      fz = -D / 2 + D * k;
      if (k < 0.15) pitch = 0.28 * (1 - k / 0.15) ** 2;
      else if (k > 0.7) pitch = -0.55 * ((k - 0.7) / 0.3) ** 2;
    } else {
      const k = (u - duty) / (1 - duty), e = k * k * (3 - 2 * k);
      fz = D / 2 - D * e;
      fy = (0.08 + 0.08 * run) * Math.sin(Math.PI * Math.min(1, k * 1.15)) * m;
      pitch = lerp(-0.55, 0.28, sstep(0.1, 0.95, k)) * m;
    }
    pitch *= m;
    const ix = side * (0.12 + 0.03 * A), iz = (R ? 0.02 + 0.1 * A : -0.03 - 0.12 * A) + (R ? 0.01 : -0.01) * shift;
    const x = lerp(ix, side * 0.1, m), z = lerp(iz, fz, m) + hz;
    const yaw = -side * 0.12 + (R ? -0.55 : -0.3) * A * (1 - m);
    // ankle from ground contact with heel / ball pivot
    const fq = _qf.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
    const piv = pitch >= 0 ? _a.set(0, -0.085, 0.04) : _a.set(0, -0.085, -0.15);
    _c.set(0, 0, 0).add(piv); _c.applyAxisAngle(_d.set(0, 1, 0), yaw);       // flat pivot offset
    _T.set(x, fy + 0.085, z).add(_c);                                          // pivot position
    _b.copy(piv).applyQuaternion(fq);
    _T.sub(_b);                                                                // ankle position
    _d.set(side * 0.12, 0, -1).applyAxisAngle(_c.set(0, 1, 0), yaw * 0.7 + twist * 0.5);
    twoBone(g, R ? BI.thighR : BI.thighL, R ? BI.shinR : BI.shinL, LEN.thigh, LEN.shin, _T, _d, -1);
    setModelRot(g, R ? BI.footR : BI.footL, fq);
  }

  // ---- rifle: patrol low-ready (anchored to the chest) -> shouldered (anchored to the eye)
  const ch = s.mm[BI.chest];
  // sling carry: butt tucked against the right ribs under the arm, muzzle down-left across the body
  qE(-0.25, 1.2, 0.0, _q);
  _m.compose(_a.copy(BUTT_LOW).sub(_b.copy(BUTT).applyQuaternion(_q)), _q, UNIT);
  _m2.multiplyMatrices(ch, _m);
  const pLow = _pLow.setFromMatrixPosition(_m2), qLow = _qLow.setFromRotationMatrix(_m2);
  const qAim = qE(0.012 * breath + kick * 0.06 + hit * 0.25, 0.01 * Math.sin(t * 0.9 + s.seed), 0, _qAim);
  const pAim = _pAim.copy(EYE).applyMatrix4(s.mm[BI.head]).sub(_b.set(0, 0.104, 0.2 - kick * 0.03).applyQuaternion(qAim));
  const rq = g.rifle.quaternion.slerpQuaternions(qLow, qAim, A);
  g.rifle.position.lerpVectors(pLow, pAim, A);
  g.rifle.updateMatrix();

  // ---- arms: IK onto the rifle
  for (const side of [1, -1]) {
    const R = side > 0;
    const hq = _q2.multiplyQuaternions(rq, R ? HAND_R_Q : HAND_L_Q);
    const grip = _a.copy(R ? GRIP_R : GRIP_L).applyMatrix4(g.rifle.matrix);
    const wrist = grip.sub(_b.copy(R ? GRIP_IN_HAND_R : GRIP_IN_HAND_L).applyQuaternion(hq));
    const pole = R ? _d.set(0.55 + 0.3 * A, -1 + 0.3 * A, 0.3) : _d.set(-0.35 - 0.2 * A, -1, 0.1);
    twoBone(g, R ? BI.uarmR : BI.uarmL, R ? BI.farmR : BI.farmL, LEN.upper, LEN.fore, wrist, pole, 1);
    setModelRot(g, R ? BI.handR : BI.handL, hq);
  }
}

// ------------------------------------------------------------------ death
function keyPose(g, spec) {
  const q = g.bones.map(() => new THREE.Quaternion()), p = g.rest.map(r => r.clone());
  for (const [name, e] of Object.entries(spec)) {
    if (name === 'pos') { p[0].set(...e); continue; }
    qE(e[0] || 0, e[1] || 0, e[2] || 0, q[BI[name]]);
  }
  return { q, p };
}
function deathKeys(g, dir, side) {
  const slump = keyPose(g, {
    pos: [0.02 * side, 0.74, 0.05 * dir],
    hips: [0.1 * dir, 0.15 * side, 0.05 * side], spine: [-0.25, 0.1 * side, 0], chest: [-0.2, 0.15 * side, 0.05 * side], neck: [-0.3], head: [-0.25, 0.2 * side],
    thighR: [0.75, 0, 0.05], shinR: [-1.5], footR: [0.6], thighL: [0.8, 0, -0.05], shinL: [-1.55], footL: [0.65],
    uarmR: [0.35, 0, 0.25], farmR: [0.6], uarmL: [0.3, 0, -0.2], farmL: [0.5], handR: [0.2], handL: [0.2],
  });
  const lie = dir > 0 ? keyPose(g, {
    // on the back, legs splayed, one knee raised, head rolled to one side
    pos: [0.08 * side, 0.2, 0.8], hips: [1.5, 0.2 * side, 0.1 * side],
    spine: [-0.06, 0.12 * side, 0], chest: [-0.04, 0.18 * side, 0.05 * side], neck: [0.05], head: [0.12, 0.85 * side, 0.15 * side],
    thighR: side > 0 ? [0.55, 0, 0.12] : [0.05, 0, 0.18], shinR: side > 0 ? [-0.95] : [-0.15], footR: [0.3, 0, 0.3],
    thighL: side < 0 ? [0.55, 0, -0.12] : [0.05, 0, -0.18], shinL: side < 0 ? [-0.95] : [-0.15], footL: [0.3, 0, -0.3],
    clavR: [0, 0, 0.1], clavL: [0, 0, -0.1],
    uarmR: [0.15, 0, 1.0], farmR: [0.7], handR: [0.3], uarmL: [0.4, 0, -0.7], farmL: [1.0], handL: [0.3],
  }) : keyPose(g, {
    // face down, head turned, arms tucked
    pos: [0.08 * side, 0.2, -0.8], hips: [-1.52, 0.2 * side, -0.08 * side],
    spine: [0.05, 0.1 * side, 0], chest: [0.06, 0.15 * side, 0], neck: [0.25], head: [0.25, 1.1 * side, 0.1 * side],
    thighR: [-0.05, 0, 0.12], shinR: [-0.12], footR: [1.1], thighL: [-0.1, 0, -0.1], shinL: [-0.05], footL: [1.0],
    uarmR: [-0.1, 0, 0.3], farmR: [0.1], handR: [0, 0.8], uarmL: [-0.2, 0, -0.45], farmL: [0.15], handL: [0, -0.8],
  });
  return { slump, lie };
}

const GROUND_PROBES = [
  [BI.hips, 0, 0, 0, 0.12], [BI.spine, 0, 0.08, 0, 0.12], [BI.chest, 0, 0.12, 0, 0.13], [BI.head, 0, 0.13, -0.01, 0.1],
  [BI.shinR, 0, 0, 0, 0.06], [BI.shinL, 0, 0, 0, 0.06], [BI.farmR, 0, 0, 0, 0.05], [BI.farmL, 0, 0, 0, 0.05],
  [BI.handR, 0, -0.08, 0, 0.025], [BI.handL, 0, -0.08, 0, 0.025],
  [BI.footR, 0, -0.085, 0.05, 0], [BI.footR, 0, -0.06, -0.2, 0], [BI.footL, 0, -0.085, 0.05, 0], [BI.footL, 0, -0.06, -0.2, 0],
];
function poseDeath(g, st) {
  const s = g.s, B = g.bones, D = s.death;
  const T = st.dead * 0.9; // seconds since death
  const w1 = sstep(0, 0.42, T);
  const pf = clamp((T - 0.3) / 0.62, 0, 1), w2 = pf * pf;        // accelerating topple
  const settle = T > 0.92 ? Math.sin(clamp((T - 0.92) / 0.35, 0, 1) * Math.PI) * Math.exp(-(T - 0.92) * 3) : 0;
  for (let i = 0; i < B.length; i++) {
    _q.slerpQuaternions(D.k0.q[i], D.slump.q[i], w1);
    B[i].quaternion.slerpQuaternions(_q, D.lie.q[i], w2);
    _a.lerpVectors(D.k0.p[i], D.slump.p[i], w1);
    B[i].position.lerpVectors(_a, D.lie.p[i], w2);
  }
  // fall arc: the pelvis travels in an arc rather than a straight line
  B[0].position.y += Math.sin(w2 * Math.PI) * 0.08 + settle * 0.03;
  B[BI.chest].quaternion.multiply(qE(-settle * 0.08 * D.dir, 0, 0, _q));
  fkFrom(g, 0);
  // keep the body out of the ground: lift the pelvis by the deepest penetration
  let lift = 0;
  for (const [i, x, y, z, r] of GROUND_PROBES) { _a.set(x, y, z).applyMatrix4(s.mm[i]); lift = Math.max(lift, r - _a.y); }
  if (lift > 0) { B[0].position.y += lift; fkFrom(g, 0); }
  // rifle: released, drops and clatters onto its side next to the body
  const r = clamp((T - 0.1) / 0.5, 0, 1), rf = r * r;
  const bounce = T > 0.6 ? Math.abs(Math.sin((T - 0.6) * 9)) * Math.exp(-(T - 0.6) * 7) * 0.05 : 0;
  g.rifle.position.lerpVectors(D.r0p, D.r1p, rf); g.rifle.position.y += bounce;
  g.rifle.quaternion.slerpQuaternions(D.r0q, D.r1q, sstep(0, 1, r));
}

// ------------------------------------------------------------------ public
/** Pose a guard. st: {walk, speed(0..1), aim(0..1), flash, hit, dead (0 alive, then s/0.9), fallDir} */
export const poseSoldier = (g, st) => poseGuard(g, st);
export function poseGuard(g, st) {
  const s = g.s;
  const now = performance.now() / 1000;
  const dt = s.t ? clamp(now - s.t, 0, 0.1) : 0.016;
  s.t = now; s.time += dt;
  if (s.ph === null) s.ph = st.walk;
  if (dt > 1e-4) s.rate += (clamp((st.walk - s.ph) / dt, 0, 14) - s.rate) * Math.min(1, dt * 8);
  s.ph = st.walk;

  g.flash.intensity = st.flash > 0 ? 18 : 0;
  g.flashMesh.visible = st.flash > 0;
  g.flashMesh.rotation.z = Math.random() * 6.28;
  g.flashMesh.scale.setScalar(0.8 + Math.random() * 0.6);

  if (!(st.dead > 0)) {
    s.death = null;
    poseAlive(g, st, dt);
  } else {
    if (!s.death) {
      const side = Math.random() < 0.5 ? -1 : 1, dir = st.fallDir >= 0 ? 1 : -1;
      const k0 = { q: g.bones.map(b => b.quaternion.clone()), p: g.bones.map(b => b.position.clone()) };
      const keys = deathKeys(g, dir, side);
      const r1q = qE(0, side * 0.9 + 0.4 * dir, Math.PI / 2 * side);
      s.death = {
        dir, side, k0, ...keys,
        r0p: g.rifle.position.clone(), r0q: g.rifle.quaternion.clone(),
        r1p: new THREE.Vector3(0.42 * side, 0.026, -0.15 * dir), r1q,
      };
    }
    poseDeath(g, st);
    g.flash.intensity = 0; g.flashMesh.visible = false;
  }
  g.root.rotation.x = 0; g.root.rotation.z = 0;
  g.rifle.visible = true;
}
