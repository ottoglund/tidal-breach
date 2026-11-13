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
import { createSoldierMesh, BONE_DEFS, BI, LEN, RIG } from './characters/soldier.js';
import { fabricShading } from './characters/cloth.js';
import { skinShading, LOOKS } from './characters/skin.js';
import { soldierBody } from './characters/body.js';
import { locomote, locoState, spring, sp } from './characters/anim.js';

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


/**
 * Lens reflections: on top of the baked environment (scene.environment, dark at night), add a stylised view-dependent
 * reflection: a sky/horizon gradient plus two lamp-like highlights (a mast lamp and a window-lit warehouse direction),
 * weighted by Fresnel. The lenses are curved, so the highlights streak and slide across them as the head turns or the
 * camera moves. This is NOT a captured reflection of the actual scene; it is a deliberate stylised stand-in.
 */
function lensShading(m) {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      {
        vec3 Rv = reflect(-normalize(vViewPosition), normalize(normal));
        vec3 Rw = normalize((vec4(Rv, 0.0) * viewMatrix).xyz);
        float nv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        float fr = 0.05 + 0.95 * pow(1.0 - nv, 4.0);
        vec3 sky = vec3(0.05, 0.065, 0.085) * (0.35 + 0.9 * smoothstep(-0.25, 0.9, Rw.y)) + vec3(0.12, 0.09, 0.06) * exp(-abs(Rw.y) * 14.0);
        float lamp1 = pow(max(dot(Rw, normalize(vec3(-0.35, 0.5, 0.8))), 0.0), 140.0);
        float lamp2 = pow(max(dot(Rw, normalize(vec3(0.7, 0.2, -0.65))), 0.0), 90.0);
        outgoingLight += (sky * (0.5 + 3.5 * fr) + (lamp1 * 9.0 + lamp2 * 4.0) * vec3(1.0, 0.82, 0.6)) * (0.35 + 0.65 * fr) * 0.6;
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'lens1';
  return m;
}

function materials() {
  if (shared) return shared;
  const body = soldierBody() || {};
  const eyes = { eyeR: body.eyeR, eyeL: body.eyeL, headC: body.headC };
  shared = {
    uniform: fabricShading(mat('camo_emr', { tile: 0.42, color: 0x8c9694 }), { dirt: 0.6, sheen: 0.12, soak: 0.35, rough: 0.3, wetTop: 0.4 }),
    uniformHV: fabricShading(mat('camo_m90', { tile: 0.45, color: 0x9aa397 }), { dirt: 0.6, sheen: 0.12, soak: 0.35, rough: 0.3, wetTop: 0.4 }),
    vest: fabricShading(mat('ratnik_green', { tile: 0.35, color: 0x8f9a88 }), { dirt: 0.45, sheen: 0.08, soak: 0.3, wrinkle: 0.3, rough: 0.2, wetTop: 0.5 }),
    // knit: fine rib (7 cm tile) with a strong normal map and a fuzzy sheen so the balaclava reads as wool over the
    // MakeHuman face shape, not as skin
    knit: fabricShading(mat('olive_knit', { tile: 0.07, color: 0xb2b8a2, normalScale: 1.8 }), { dirt: 0.2, sheen: 0.32, soak: 0.25, wrinkle: 0.35, rough: 0.15, wetTop: 0.55, mudGloss: 0.2, rib: 0.0032 }),
    // satin nylon / polymer hardware (buckles, soles, glove shells, strap tails): smoother than cloth, scuffed at the bottom
    glove: fabricShading(mat('polymer', { tile: 0.25, color: 0x4a4c50, roughness: 0.85 }), { dirt: 0.7, sheen: 0.0, soak: 0.2, wrinkle: 0.0, rough: 0.35, wetTop: 0.3, mudGloss: 0.5 }),
    metal: mat('gunmetal', { tile: 0.25, color: 0xc4c4c0, roughness: 0.75 }),   // buckles, snaps, D-rings, slides, eyelets
    // skin (+ short hair and eyeballs, same draw call), one material per look (skin tone, hair and iris colour; same
    // shader program): characters/skin.js
    skins: LOOKS.map(l => skinShading(plainMat(l.skin, 0.5), { ...eyes, hair: l.hair, iris: l.iris })),
    gloveFab: fabricShading(mat('glove_green', { tile: 0.12, color: 0xaeb4a2 }), { dirt: 0.5, sheen: 0.05, soak: 0.3, wrinkle: 0.2 }),
    boot: fabricShading(mat('boot_leather', { tile: 0.25, color: 0x433d38, roughness: 1.2 }), { dirt: 0.4, sheen: 0.0, soak: 0.25, wrinkle: 0.2, rough: 0.2, wetTop: 0.25, mudGloss: 0.3 }),
    gun: mat('gunmetal'),
    wood: mat('ak_wood', { tile: 0.3, color: 0xa39c96 }),
    poly: mat('polymer', { tile: 0.25 }),
    plum: mat('plum_polymer', { tile: 0.2 }),
    patch: new THREE.MeshStandardMaterial({ map: patchTexture(), roughness: 0.9, metalness: 0 }),
    // tinted, semi-mirrored lenses; see-through enough to show the eyes behind them
    visor: lensShading(new THREE.MeshPhysicalMaterial({ color: 0x0d0e10, roughness: 0.04, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 3.0, transparent: true, opacity: 0.78, depthWrite: false })),
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
  g.userData.mag = add(segs, magM);
  g.userData.magGrip = new THREE.Vector3(-0.02, -0.112, -0.092);   // left-hand grip point on the magazine (rifle space)
  g.userData.charge = null;                                       // AK charging handle is on the right: not racked by the left hand
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
  g.userData.mag = g.children[g.children.length - 1];
  g.userData.magGrip = new THREE.Vector3(-0.022, -0.1, -0.035);
  g.userData.charge = new THREE.Vector3(-0.024, 0.039, -0.19);    // cocking handle (left, above the handguard)
  return g;
}

function buildRifle(S, weapon) { return weapon === 'ak4c' ? ak4c(S) : kalashnikov(S, weapon === 'akm' ? 'akm' : 'ak74'); }

/**
 * createSoldier({ side: 'opfor' | 'hv', weapon: 'ak74' | 'akm' | 'ak4c', helmet?: boolean, look?: number })
 *  side 'opfor': EMR camo, earmuffs + glasses.  side 'hv': Swedish Home Guard, M90 camo, sleeve patches (flag left,
 *  generic HV shield right); helmet defaults to ~40 % random (true = M90-covered helmet, false = earmuffs, bare head).
 *  look: index into characters/skin.js LOOKS (skin tone, hair, eyes) for the bare-headed soldiers; random by default.
 * Returns the same object as createGuard (root, rifle, flash, flashMesh, mesh, bones, rest, s); pose it with
 * poseGuard / poseSoldier using the identical state object.
 */
export function createSoldier({ side = 'opfor', weapon, helmet, look } = {}) {
  const S = materials();
  const hv = side === 'hv';
  weapon = weapon || (hv ? 'ak4c' : 'ak74');
  const kind = !hv ? 'opfor' : ((helmet ?? Math.random() < 0.4) ? 'hv_helmet' : 'hv');
  const root = new THREE.Group();
  const { mesh, bones, rest } = createSoldierMesh({ camo: hv ? S.uniformHV : S.uniform, knit: S.knit, black: S.glove, boot: S.boot, web: S.vest, lens: S.visor, glove: S.gloveFab, patch: S.patch, skin: S.skins[hv ? (look ?? Math.floor(Math.random() * S.skins.length)) % S.skins.length : 0], metal: S.metal }, kind);
  root.add(mesh);
  const rifle = buildRifle(S, weapon);
  root.add(rifle);
  const mz = weapon === 'ak4c' ? -0.64 : -0.66;
  const flash = new THREE.PointLight(0xffa040, 0, 7, 2); flash.position.set(0, 0.0, mz); rifle.add(flash);
  const fl = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.5, 1.5) }));
  fl.position.set(0, 0.0, mz); fl.visible = false; rifle.add(fl);
  root.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  root.userData.tbSoldier = { body: mesh, rifle, flashMesh: fl, mats: mesh.material, single: mesh.material[mesh.geometry.userData.names.indexOf('camo')], geo: mesh.geometry, far: mesh.geometry.userData.far || null }; // distance policies for shadow / reflection passes: world/props/lod.js
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
// body-dependent (soldier.js RIG; the MakeHuman body sets them when its asset is loaded): grip axis in hand space,
// aiming eye in head space, sling-carry butt position (kept at the same model-space spot when the chest bone moves)
const GRIP_IN_HAND_R = new THREE.Vector3(), GRIP_IN_HAND_L = new THREE.Vector3(), EYE = new THREE.Vector3(), BUTT_LOW = new THREE.Vector3();
const BUTT = new THREE.Vector3(0, -0.05, 0.41);       // buttpad centre in rifle space
let rigFor = null;
function syncRig() {
  if (rigFor === RIG.mh) return;
  rigFor = RIG.mh;
  GRIP_IN_HAND_R.fromArray(RIG.gripR); GRIP_IN_HAND_L.fromArray(RIG.gripL); EYE.fromArray(RIG.eye);
  // sling carry: butt position in chest space (procedural chest at (0, 1.25, 0.01)); the MakeHuman torso is deeper
  BUTT_LOW.set(0.18, -0.07 + 1.25 - RIG.chest[1], -0.13 + 0.01 - RIG.chest[2] + (RIG.mh ? -0.05 : 0));
}

// ------------------------------------------------------------------ alive pose (layered)
// Layers, bottom to top: locomotion (characters/anim.js: planted feet, leg frame, pelvis sway / twist) -> pelvis
// height, lean and reach correction -> spine / chest counter-rotation, aim blade, breathing -> reactions (hit spring
// with stagger, recoil spring per shot, turn lead) -> head gaze -> rifle placement (low ready / aim / reload) -> arm IK.
const _off = { x: 0, z: 0 };
const _pRl = new THREE.Vector3(), _qRl = new THREE.Quaternion(), _qMag = new THREE.Quaternion(), _mInv = new THREE.Matrix4();
const _wp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const HAND_MAG_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2).multiply(HAND_L_Q);
const POUCH = new THREE.Vector3(-0.07, -0.2, -0.17);   // left magazine pouch on the rig front (chest space)
const RL_POS = new THREE.Vector3(0.0, -0.13, -0.3);    // rifle origin (magazine well) during a reload (chest space)
const RL_Q = qE(0.32, 0.42, -0.5);                     // muzzle up and left, canted so the well faces the support hand
// support-hand timeline of a magazine change (progress 0..1): handguard -> magazine -> out -> pouch -> back -> seat -> (rack) -> handguard
const RL_KEYS = [0, 0.14, 0.27, 0.46, 0.55, 0.74, 0.85, 1];

function reactions(g, st, dt, root) {
  const s = g.s, X = s.x;
  // fire event (rising edge of the muzzle-flash timer) -> recoil impulse; also counts shots for a guard's reload
  if (st.flash > s.lastFlash + 1e-4) {
    X.rec.v += 62; X.recSide = (Math.random() - 0.5) * 2;
    if (!('reload' in st)) {
      s.shots++;
      if (s.shots >= s.nextRl) { s.shots = 0; s.nextRl = 4 + Math.floor(Math.random() * 4); s.rlT = 0; }
    }
  }
  s.lastFlash = st.flash;
  spring(X.rec, 0, 30, 0.42, dt);
  // hit (rising edge): directional impulse from the shooter's position when known, else from the front
  const hit = clamp(st.hit, 0, 1);
  if (hit > s.lastHit + 0.3) {
    let lx = (Math.random() - 0.5) * 0.5, lz = 1;
    if (st.hitX !== undefined) {
      const dx = root.position.x - st.hitX, dz = root.position.z - st.hitZ, n = Math.hypot(dx, dz) || 1;
      const c = Math.cos(root.rotation.y), sn = Math.sin(root.rotation.y);
      lx = (dx * c - dz * sn) / n; lz = (dx * sn + dz * c) / n;    // travel direction of the bullet, body space
    }
    s.hitDir.set(lx, 0, lz); s.hitAt = s.time;
    X.hx.v += lx * 1.9; X.hz.v += lz * 1.9; X.htw.v += (Math.random() < 0.5 ? -1 : 1) * 2.2;
  }
  s.lastHit = hit;
  spring(X.hx, 0, 10, 0.4, dt); spring(X.hz, 0, 10, 0.4, dt); spring(X.htw, 0, 12, 0.5, dt);
}

function poseAlive(g, st, dt) {
  syncRig();
  const s = g.s, B = g.bones, t = s.time, X = s.x, L = s.L;
  for (let i = 0; i < B.length; i++) { B[i].quaternion.identity(); B[i].position.copy(g.rest[i]); }
  // reload progress: comrades pass st.reload (0 = none); guards play a short cosmetic change every few shots,
  // timed to finish inside their minimum 1.25 s between shots
  let rl = -1;
  if ('reload' in st) rl = st.reload > 0 ? clamp(st.reload, 0, 1) : -1;
  else if (s.rlT >= 0) { s.rlT += dt; rl = (s.rlT - 0.12) / 1.0; if (rl >= 1) { s.rlT = -1; rl = -1; } else if (rl < 0) rl = -1; }
  const wr = rl >= 0 ? sstep(0, 0.14, rl) * (1 - sstep(0.86, 1, rl)) : 0;
  const Araw = clamp(spring(X.aim, clamp(st.aim, 0, 1), 13, 1, dt), 0, 1);  // eased raise / lower (no snap at the start)
  const A = Araw * (1 - wr);
  // hit springs (body space, metres) and stagger offset of the stance spots
  const hx = X.hx.x, hz = X.hz.x, hmag = Math.min(1, Math.hypot(hx, hz) / 0.12);
  _off.x = hx * 1.5; _off.z = hz * 1.5;
  locomote(L, g.root, st, dt, A, _off);
  const m = L.m, run = L.run * m, yr = clamp(L.yawRate.x, -4, 4), duty = L.duty;
  // breathing ~15/min with drift and a lopsided inhale / exhale; weight shift from two incommensurate slow sines
  const bp = t * 1.65 + s.seed + 0.5 * Math.sin(t * 0.23 + s.seed * 2.0);
  const breath = Math.sin(bp) * 0.85 + 0.22 * Math.sin(2 * bp + 0.7);
  const shift = Math.sin(t * 0.33 + s.seed * 1.7) * 0.8 + 0.3 * Math.sin(t * 0.87 + s.seed * 0.6);
  const sway = Math.sin(t * 0.21 + s.seed * 3.3);
  const kick = X.rec.x;                                   // ~1 at the peak of a shot's recoil
  const lean = clamp(L.accel.x, -1, 1);                   // forward acceleration (lean into a start, back on a stop)

  // ---- pelvis: bob (high at mid-stance when walking, low when jogging), sway onto the support foot, twist toward
  // the forward leg, hips turned into the leg frame, crouched jog, bladed aiming stance, hit stagger
  const bobW = Math.cos(4 * Math.PI * (L.uR - duty / 2));
  const bob = m * (0.02 * (1 - run) - 0.024 * run) * bobW;
  const hy = RIG.hipY - 0.018 - 0.045 * A * (1 - 0.5 * m) - 0.075 * run + bob + 0.0012 * (1 - m) * breath - 0.05 * hmag;
  const hxP = L.sway.x + (1 - m) * 0.02 * shift + hx * 0.55;
  const hzP = 0.02 * A * (1 - m) + (1 - m) * 0.007 * sway + hz * 0.55;
  const LY = L.legYaw.x, twist = L.twist;
  const blade = -0.38 * A * (1 - 0.6 * m);
  const pYaw = LY * 0.85 + twist + blade;
  B[BI.hips].position.set(hxP, hy, hzP);
  const pPitch = -(0.03 + 0.1 * run + 0.035 * A + 0.04 * m * (1 - run)) - 0.07 * lean * m + hz * 0.9;
  const pRoll = -L.sway.x * 1.4 + clamp(yr * L.v * 0.035, -0.14, 0.14) + (1 - m) * 0.03 * shift;
  qE(pPitch, pYaw, pRoll, B[BI.hips].quaternion);
  // ---- spine / chest: shoulders counter-rotate the pelvis twist and the leg frame (the upper body keeps facing the
  // root heading), keep part of the blade, lean into speed, lead a turn; hit lean / twist, recoil rock, breathing
  const back = -(pYaw) - 0.45 * twist + 0.6 * blade + clamp(yr * 0.06, -0.15, 0.15) + X.htw.x * 0.12;
  const hitP = hz * 2.6, hitR = -hx * 2.6;
  qE(-0.02 - 0.05 * A - 0.03 * run + hitP * 0.45 + 0.02 * kick, back * 0.45, -0.02 * shift * (1 - m) + hitR * 0.45 - pRoll * 0.5, B[BI.spine].quaternion);
  qE(0.01 * breath * (1 - 0.5 * A) - 0.03 * A - 0.05 * run - 0.03 * lean * m + hitP * 0.55 + kick * 0.05, back * 0.55, hitR * 0.55 - pRoll * 0.3, B[BI.chest].quaternion);
  B[BI.chest].position.y += 0.0045 * breath;
  B[BI.chest].position.z += -0.003 * breath * (1 - 0.5 * A);
  qE(0, 0.06 * A - 0.05 * kick, 0.3 * A + 0.022 * breath, B[BI.clavR].quaternion);     // recoil pushes the right shoulder back
  qE(0, -0.12 - 0.3 * A + 0.1 * wr, -0.04 * A - 0.022 * breath, B[BI.clavL].quaternion);
  qE(-0.04 - 0.72 * A - 0.2 * wr + hitP * 0.3 - 0.06 * run, 0, -0.14 * A, B[BI.neck].quaternion);
  fkFrom(g, 0);

  // ---- legs: reach correction (drop the pelvis rather than let a planted foot slide or float), then IK
  const ank = s.ank;
  let drop = 0;
  for (let k = 0; k < 2; k++) {
    const R = k === 0, o = L.feet[k].out;
    const fq = (R ? s.fqR : s.fqL).setFromEuler(_e.set(o.pitch, o.yaw, 0, 'YXZ'));
    const piv = o.pitch >= 0 ? _a.set(0, -RIG.ankle, 0.04) : _a.set(0, -RIG.ankle, -0.15);
    _c.copy(piv).applyAxisAngle(_d.set(0, 1, 0), o.yaw);
    const T = ank[k].set(o.x, o.y + RIG.ankle, o.z).add(_c);   // heel / ball pivot on the ground (y = lift)
    T.sub(_b.copy(piv).applyQuaternion(fq));                    // -> ankle
    bonePos(g, R ? BI.thighR : BI.thighL, _S);
    const h = Math.hypot(T.x - _S.x, T.z - _S.z), dy = _S.y - T.y, Lm = (LEN.thigh + LEN.shin) * 0.985;
    if (h * h + dy * dy > Lm * Lm) drop = Math.max(drop, dy - Math.sqrt(Math.max(0, Lm * Lm - h * h)));
  }
  if (drop > 0) { B[BI.hips].position.y -= Math.min(drop, 0.16); fkFrom(g, 0); }
  for (let k = 0; k < 2; k++) {
    const R = k === 0, side = R ? 1 : -1, o = L.feet[k].out;
    _d.set(side * 0.12, 0, -1).applyAxisAngle(_c.set(0, 1, 0), o.yaw * 0.6 + pYaw * 0.4);
    twoBone(g, R ? BI.thighR : BI.thighL, R ? BI.shinR : BI.shinL, LEN.thigh, LEN.shin, ank[k], _d, -1);
    setModelRot(g, R ? BI.footR : BI.footL, R ? s.fqR : s.fqL);
  }

  // ---- head: gaze-stabilised in model space; scans while patrolling, leads a turn, looks down the sights,
  // snaps with a hit, glances at the magazine during a reload
  const gk = t / 3.7 + s.seed, gi = Math.floor(gk), gf = sstep(0.82, 1.0, gk - gi);
  const gh = k => Math.sin(k * 127.1 + s.seed * 311.7) * 43758.5453, gr = k => (gh(k) - Math.floor(gh(k))) * 2 - 1;
  const glanceY = lerp(gr(gi), gr(gi + 1), gf) * 0.32, glanceP = lerp(gr(gi + 17), gr(gi + 18), gf) * 0.08;
  const scan = (1 - A) * (1 - wr) * (0.3 * Math.sin(t * 0.27 + s.seed) + 0.1 * Math.sin(t * 0.71 + s.seed * 3) + glanceY * (1 - m)) * (1 - 0.6 * m);
  const lookPitch = lerp(-0.1 + 0.03 * Math.sin(t * 0.4) + glanceP * (1 - m) + 0.008 * breath - 0.06 * run, -0.2, A) + hitP * 0.5 - 0.35 * wr;
  setModelRot(g, BI.head, qE(lookPitch + A * 0.006 * Math.sin(t * 1.9), scan + clamp(yr * 0.2, -0.5, 0.5) * (1 - A) + 0.25 * wr + A * (0.04 + 0.01 * Math.sin(t * 0.7 + s.seed)) + X.htw.x * 0.1, -0.2 * A + (1 - A) * 0.025 * Math.sin(t * 0.27 + s.seed) - hitR * 0.3, _q2));
  fkFrom(g, BI.head + 1);

  // ---- rifle: low ready (chest-anchored, with a lagging bounce) -> shouldered (eye-anchored) -> reload pose
  const ch = s.mm[BI.chest];
  const chY = _a.setFromMatrixPosition(ch).y;
  const lag = spring(X.lag, chY, 16, 0.5, dt) - chY;
  qE(-0.25 + lag * 2.5 - 0.08 * run, 1.2, 0.0, _q);
  _m.compose(_a.copy(BUTT_LOW).sub(_b.copy(BUTT).applyQuaternion(_q)), _q, UNIT);
  _a.y += lag * 0.6;
  _m.setPosition(_a);
  _m2.multiplyMatrices(ch, _m);
  const pLow = _pLow.setFromMatrixPosition(_m2), qLow = _qLow.setFromRotationMatrix(_m2);
  const qAim = qE(0.012 * breath + 0.004 * Math.sin(t * 1.7 + 1.0) + 0.003 * Math.sin(t * 0.37 + s.seed) + kick * 0.07 + hitP * 0.6,
    0.006 * Math.sin(t * 0.9 + s.seed) + 0.004 * Math.sin(t * 2.3 + s.seed * 2) + 0.004 * Math.sin(t * 0.29) + kick * 0.012 * X.recSide, 0, _qAim);
  const pAim = _pAim.copy(EYE).applyMatrix4(s.mm[BI.head]).sub(_b.set(0, 0.104, 0.2 - kick * 0.035).applyQuaternion(qAim));
  const As = sstep(0, 1, A);
  const rq = g.rifle.quaternion.slerpQuaternions(qLow, qAim, As);
  g.rifle.position.lerpVectors(pLow, pAim, As);
  if (wr > 0) {
    _m.compose(RL_POS, RL_Q, UNIT); _m2.multiplyMatrices(ch, _m);
    _pRl.setFromMatrixPosition(_m2); _qRl.setFromRotationMatrix(_m2);
    g.rifle.position.lerp(_pRl, wr); rq.slerp(_qRl, wr);
  }
  g.rifle.updateMatrix();

  // ---- arms: IK onto the rifle (support hand follows the reload timeline)
  const ud = g.rifle.userData, mag = ud.mag;
  let magOn = false;
  for (const side of [1, -1]) {
    const R = side > 0;
    let hq = _q2.multiplyQuaternions(rq, R ? HAND_R_Q : HAND_L_Q);
    let grip = _a.copy(R ? GRIP_R : GRIP_L).applyMatrix4(g.rifle.matrix);
    if (!R && rl >= 0 && mag) {
      // waypoints in rifle space: handguard, magazine, magazine pulled, pouch, (charging handle)
      _wp[0].copy(GRIP_L); _wp[1].copy(ud.magGrip); _wp[2].copy(ud.magGrip).add(_d.set(0.0, -0.14, 0.05));
      _mInv.copy(g.rifle.matrix).invert();
      _wp[3].copy(POUCH).applyMatrix4(ch).applyMatrix4(_mInv);
      const K = RL_KEYS;
      let p0, p1, f, q0 = HAND_L_Q, q1 = HAND_MAG_Q;
      if (rl < K[1]) { p0 = 0; p1 = 1; f = rl / K[1]; }
      else if (rl < K[2]) { p0 = 1; p1 = 2; f = (rl - K[1]) / (K[2] - K[1]); q0 = HAND_MAG_Q; }
      else if (rl < K[3]) { p0 = 2; p1 = 3; f = (rl - K[2]) / (K[3] - K[2]); q0 = HAND_MAG_Q; }
      else if (rl < K[4]) { p0 = 3; p1 = 3; f = 0; q0 = HAND_MAG_Q; }
      else if (rl < K[5]) { p0 = 3; p1 = 2; f = (rl - K[4]) / (K[5] - K[4]); q0 = HAND_MAG_Q; }
      else if (rl < K[6]) { p0 = 2; p1 = 1; f = (rl - K[5]) / (K[6] - K[5]); q0 = HAND_MAG_Q; }
      else if (ud.charge && rl < 0.93) { _wp[4].copy(ud.charge); p0 = 1; p1 = 4; f = (rl - K[6]) / (0.93 - K[6]); q0 = HAND_MAG_Q; q1 = HAND_L_Q; }
      else if (ud.charge) { _wp[4].copy(ud.charge); p0 = 4; p1 = 0; f = (rl - 0.93) / 0.07; q0 = HAND_L_Q; q1 = HAND_L_Q; }
      else { p0 = 1; p1 = 0; f = (rl - K[6]) / (1 - K[6]); q0 = HAND_MAG_Q; q1 = HAND_L_Q; }
      const e = sstep(0, 1, f);
      _w.lerpVectors(_wp[p0], _wp[p1], e);
      // the pouch leg arcs out in front of the rig instead of cutting through it
      if ((p0 === 2 && p1 === 3) || (p0 === 3 && p1 === 2)) _w.x -= 0.06 * Math.sin(Math.PI * e);
      magOn = rl > K[1] && rl < K[6];
      if (magOn) {
        mag.position.copy(_w).sub(ud.magGrip);
        const away = Math.min(1, mag.position.length() / 0.12);
        mag.quaternion.copy(_qMag.setFromAxisAngle(_d.set(1, 0, 0), 0.35 * away));
      }
      grip.copy(_w).applyMatrix4(g.rifle.matrix);
      hq = _q2.multiplyQuaternions(rq, _q3.copy(q0).slerp(q1, e));
    }
    const wrist = grip.sub(_b.copy(R ? GRIP_IN_HAND_R : GRIP_IN_HAND_L).applyQuaternion(hq));
    const pole = R ? _d.set(0.55 + 0.3 * A, -1 + 0.3 * A, 0.3) : _d.set(-0.35 - 0.2 * A - 0.3 * wr, -1, 0.1 + 0.4 * wr);
    _qf.copy(hq);
    twoBone(g, R ? BI.uarmR : BI.uarmL, R ? BI.farmR : BI.farmL, LEN.upper, LEN.fore, wrist, pole, 1);
    setModelRot(g, R ? BI.handR : BI.handL, _qf);
  }
  if (mag && !magOn && (mag.position.lengthSq() > 0 || mag.quaternion.w < 1)) { mag.position.set(0, 0, 0); mag.quaternion.identity(); }
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
/**
 * Death keys. dir +1: falls backward (shot from the front): knees buckle, the seat drops to the ground, the torso
 * rolls back onto the ground. dir -1: falls forward (shot from behind): drops to the knees, topples face down.
 * side: which way the head / limbs fall.
 */
function deathKeys(g, dir, side) {
  const snap = dir > 0 ? keyPose(g, {
    pos: [0.02 * side, RIG.hipY - 0.07, 0.07],
    hips: [0.12, 0.08 * side, 0.04 * side], spine: [0.14, 0.05 * side], chest: [0.16, 0.1 * side, 0.04 * side], neck: [0.28], head: [0.15, 0.15 * side],
    thighR: [0.22, 0, 0.04], shinR: [-0.45], footR: [0.15], thighL: [0.28, 0, -0.04], shinL: [-0.55], footL: [0.2],
    uarmR: [0.5, 0, 0.35], farmR: [0.7], uarmL: [0.6, 0, -0.35], farmL: [0.8], handR: [0.2], handL: [0.2],
  }) : keyPose(g, {
    pos: [0.02 * side, RIG.hipY - 0.06, -0.08],
    hips: [0.08, 0.08 * side, 0.04 * side], spine: [0.12, 0.05 * side], chest: [0.14, 0.1 * side], neck: [0.25], head: [0.2, 0.1 * side],
    thighR: [0.1, 0, 0.04], shinR: [-0.5], footR: [0.25], thighL: [0.05, 0, -0.04], shinL: [-0.45], footL: [0.2],
    uarmR: [0.2, 0, 0.45], farmR: [0.5], uarmL: [0.3, 0, -0.45], farmL: [0.6], handR: [0.2], handL: [0.2],
  });
  const mid = dir > 0 ? keyPose(g, {
    // seat on the ground behind the heels, knees up, torso still falling back, arms thrown forward
    // (leg angles solved for the seat 0.55 m behind the planted feet: thigh 2.19 rad, shin 0.49 rad from vertical)
    pos: [0.03 * side, 0.17, 0.55], hips: [0.75, 0.12 * side, 0.06 * side],
    spine: [-0.05, 0.08 * side], chest: [-0.1, 0.15 * side, 0.05 * side], neck: [-0.3], head: [-0.15, 0.25 * side],
    thighR: [1.44, 0, 0.16], shinR: [-1.7], footR: [-0.45], thighL: [1.36, 0, -0.2], shinL: [-1.6], footL: [-0.4],
    clavR: [0, 0, 0.1], clavL: [0, 0, -0.1],
    uarmR: [0.9, 0, 0.35], farmR: [0.5], uarmL: [1.0, 0, -0.3], farmL: [0.6], handR: [0.2], handL: [0.2],
  }) : keyPose(g, {
    // on the knees, torso pitching forward, arms hanging forward
    pos: [0.02 * side, 0.52, -0.3], hips: [-0.3, 0.1 * side, 0.05 * side],
    spine: [-0.15, 0.05 * side], chest: [-0.15, 0.1 * side], neck: [-0.15], head: [-0.1, 0.3 * side],
    thighR: [0.28, 0, 0.06], shinR: [-1.75], footR: [0.75], thighL: [0.22, 0, -0.06], shinL: [-1.7], footL: [0.75],
    uarmR: [0.6, 0, 0.2], farmR: [0.3], uarmL: [0.7, 0, -0.2], farmL: [0.35], handR: [0.1], handL: [0.1],
  });
  const lie = dir > 0 ? keyPose(g, {
    // on the back, legs splayed, one knee raised, head rolled to one side
    pos: [0.08 * side, 0.12, 0.85], hips: [1.55, 0.2 * side, 0.08 * side],
    spine: [-0.02, 0.1 * side, 0], chest: [0.0, 0.16 * side, 0.05 * side], neck: [0.32], head: [0.14, 0.85 * side, 0.15 * side],
    thighR: side > 0 ? [0.45, 0, 0.12] : [-0.09, 0, 0.18], shinR: side > 0 ? [-0.98] : [-0.06], footR: side > 0 ? [-0.6] : [0.35, 0, 0.3],
    thighL: side < 0 ? [0.45, 0, -0.12] : [-0.09, 0, -0.18], shinL: side < 0 ? [-0.98] : [-0.06], footL: side < 0 ? [-0.6] : [0.35, 0, -0.3],
    clavR: [0, 0, 0.1], clavL: [0, 0, -0.1],
    uarmR: [0.15, 0, 1.0], farmR: [0.7], handR: [0.3], uarmL: [0.4, 0, -0.7], farmL: [1.0], handL: [0.3],
  }) : keyPose(g, {
    // face down, head turned, arms tucked
    pos: [0.08 * side, 0.12, -0.75], hips: [-1.55, 0.2 * side, -0.08 * side],
    spine: [-0.03, 0.1 * side, 0], chest: [-0.03, 0.15 * side, 0], neck: [0.05], head: [0.1, 1.1 * side, 0.1 * side],
    thighR: [-0.05, 0, 0.12], shinR: [-0.15], footR: [1.1], thighL: [-0.1, 0, -0.1], shinL: [-0.08], footL: [1.0],
    uarmR: [-0.1, 0, 0.3], farmR: [0.1], handR: [0, 0.8], uarmL: [-0.2, 0, -0.45], farmL: [0.15], handL: [0, -0.8],
  });
  return { snap, mid, lie };
}

const GROUND_PROBES = [
  [BI.hips, 0, 0, 0, 0.12], [BI.spine, 0, 0.08, 0, 0.12], [BI.chest, 0, 0.12, 0, 0.13], [BI.head, 0, 0.13, -0.01, 0.1],
  [BI.shinR, 0, 0, 0, 0.06], [BI.shinL, 0, 0, 0, 0.06], [BI.farmR, 0, 0, 0, 0.05], [BI.farmL, 0, 0, 0, 0.05],
  [BI.handR, 0, -0.08, 0, 0.025], [BI.handL, 0, -0.08, 0, 0.025],
  [BI.footR, 0, null, 0.05, 0], [BI.footR, 0, -0.06, -0.2, 0], [BI.footL, 0, null, 0.05, 0], [BI.footL, 0, -0.06, -0.2, 0], // null: sole (ankle height)
];
const _qy = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0), _ankT = new THREE.Vector3();
function poseDeath(g, st) {
  const s = g.s, B = g.bones, D = s.death;
  const T = st.dead * 0.9; // seconds since death
  // timing: hit snap (ease-out), collapse under gravity (ease-in), topple to the ground (ease-in), impact + settle
  const w1 = 1 - (1 - sstep(0, 0.16, T)) ** 2;
  const c2 = clamp((T - 0.1) / 0.42, 0, 1), w2 = c2 * c2 * (1.4 - 0.4 * c2);
  const c3 = clamp((T - 0.42) / 0.5, 0, 1), w3 = c3 * c3;
  const tI = T - 0.92, settle = tI > 0 ? Math.sin(Math.min(1, tI / 0.3) * Math.PI) * Math.exp(-tI * 4) : 0;
  for (let i = 0; i < B.length; i++) {
    _q.slerpQuaternions(D.k0.q[i], D.snap.q[i], w1);
    _q.slerp(D.mid.q[i], w2);
    B[i].quaternion.slerpQuaternions(_q, D.lie.q[i], w3);
    _a.lerpVectors(D.k0.p[i], D.snap.p[i], w1);
    _a.lerp(D.mid.p[i], w2);
    B[i].position.lerpVectors(_a, D.lie.p[i], w3);
  }
  // the fall turns toward the bullet's direction (momentum), progressively through the collapse
  const yaw = D.yaw * sstep(0.05, 0.8, T);
  _qy.setFromAxisAngle(_Y, yaw);
  B[0].quaternion.premultiply(_qy);
  B[0].position.applyAxisAngle(_Y, yaw);
  // impact: the torso and head rebound slightly, then still
  B[BI.chest].quaternion.multiply(qE(-settle * 0.07 * D.dir, 0, 0, _q));
  B[BI.neck].quaternion.multiply(qE(-settle * 0.12 * D.dir, 0, 0, _q));
  fkFrom(g, 0);
  // ground contact: never below the ground; once down, also never floating above it
  let lift = -1;
  const wIK = 1 - sstep(0.95, 1.2, T);
  for (const [i, x, y, z, r] of GROUND_PROBES) {
    if (wIK > 0.6 && (i === BI.footR || i === BI.footL)) continue;      // planted by the IK below
    _a.set(x, y ?? -RIG.ankle, z).applyMatrix4(s.mm[i]); lift = Math.max(lift, r - _a.y);
  }
  const rest = sstep(0.85, 1.05, T);
  const dy = lift > 0 ? lift : lift * rest;
  if (dy !== 0) { B[0].position.y += dy; fkFrom(g, 0); }
  // while the knees buckle the feet stay where they stood (IK onto the planted ankles), released as the body goes down
  if (wIK > 0) {
    for (let k = 0; k < 2; k++) {
      const R = k === 0, it = R ? BI.thighR : BI.thighL, is = R ? BI.shinR : BI.shinL, ifo = R ? BI.footR : BI.footL;
      _qLow.copy(B[it].quaternion); _qAim.copy(B[is].quaternion); _q2.copy(B[ifo].quaternion);
      _d.set((R ? 1 : -1) * 0.2, 0.25, -1).applyAxisAngle(_Y, yaw);
      _ankT.lerpVectors(D.ank[k], D.ank1[k], w3).applyAxisAngle(_Y, yaw * w3);   // heels slide as the legs go out
      twoBone(g, it, is, LEN.thigh, LEN.shin, _ankT, _d, -1);
      setModelRot(g, ifo, _qy.copy(D.footQ[k]).slerp(D.footQ1[k], w3));
      _qy.setFromAxisAngle(_Y, yaw);
      // (slerp from the keyed pose toward the IK result; the IK result is in the bones, so slerp FK -> IK in place)
      B[it].quaternion.copy(_qLow.slerp(B[it].quaternion, wIK));
      B[is].quaternion.copy(_qAim.slerp(B[is].quaternion, wIK));
      B[ifo].quaternion.copy(_q2.slerp(B[ifo].quaternion, wIK));
      fkFrom(g, it);
    }
  }
  // rifle: released, drops and clatters onto its side next to the body
  const r = clamp((T - 0.1) / 0.5, 0, 1), rf = r * r;
  const bounce = T > 0.6 ? Math.abs(Math.sin((T - 0.6) * 9)) * Math.exp(-(T - 0.6) * 7) * 0.05 : 0;
  g.rifle.position.lerpVectors(D.r0p, D.r1p, rf); g.rifle.position.y += bounce;
  g.rifle.quaternion.slerpQuaternions(D.r0q, D.r1q, sstep(0, 1, r));
  const mag = g.rifle.userData.mag; if (mag) { mag.position.set(0, 0, 0); mag.quaternion.identity(); }
}

// ------------------------------------------------------------------ public
/**
 * Pose a guard / soldier. st: {walk, speed(0..1), aim(0..1), flash, hit, dead (0 alive, then s/0.9), fallDir}
 * Optional (presentation only): hitX / hitZ = world position of the last shooter (directional hit reaction and fall),
 * reload = magazine-change progress 0..1 (0 = none; when the key is absent a guard plays a short cosmetic change
 * every few shots inside its fire cooldown).
 */
export const poseSoldier = (g, st) => poseGuard(g, st);
export function poseGuard(g, st) {
  const s = g.s;
  if (!s.L) {
    s.L = locoState();
    s.x = { aim: sp(st.aim || 0), rec: sp(), hx: sp(), hz: sp(), htw: sp(), lag: sp(), recSide: 0 };
    s.hitDir = new THREE.Vector3(0, 0, 1); s.hitAt = -99; s.lastFlash = 0; s.shots = 0; s.nextRl = 4 + Math.floor(Math.random() * 4); s.rlT = -1;
    s.ank = [new THREE.Vector3(), new THREE.Vector3()]; s.fqR = new THREE.Quaternion(); s.fqL = new THREE.Quaternion();
  }
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

  reactions(g, st, dt, g.root);
  if (!(st.dead > 0)) {
    s.death = null;
    poseAlive(g, st, dt);
  } else {
    if (!s.death) {
      // fall away from the shooter when the killing shot's direction is known, else the game's fallDir
      const recent = s.time - s.hitAt < 0.6, h = s.hitDir;
      const dir = recent ? (h.z >= 0 ? 1 : -1) : (st.fallDir >= 0 ? 1 : -1);
      let yaw = 0;
      if (recent) yaw = dir > 0 ? Math.atan2(h.x, h.z) : Math.atan2(-h.x, -h.z);
      yaw = clamp(yaw, -0.9, 0.9);
      const side = Math.abs(yaw) > 0.15 ? Math.sign(yaw) * dir : (Math.random() < 0.5 ? -1 : 1);
      const k0 = { q: g.bones.map(b => b.quaternion.clone()), p: g.bones.map(b => b.position.clone()) };
      // planted ankles / foot orientations of the last living pose (model space), for the knee buckle
      // (feet set flat on the ground with their heading kept, also when the shot caught a foot mid-step)
      const ank = [BI.footR, BI.footL].map(i => { const v = bonePos(g, i, new THREE.Vector3()); v.y = RIG.ankle; return v; });
      const footQ = [BI.footR, BI.footL].map(i => { const f = _d.set(0, 0, -1).applyQuaternion(g.s.mq[i]); return new THREE.Quaternion().setFromAxisAngle(_Y, Math.atan2(-f.x, -f.z)); });
      const keys = deathKeys(g, dir, side);
      // ankles / feet of the final lying pose (model space, before the fall's yaw): the IK targets slide there
      for (let i = 0; i < g.bones.length; i++) { g.bones[i].quaternion.copy(keys.lie.q[i]); g.bones[i].position.copy(keys.lie.p[i]); }
      fkFrom(g, 0);
      const ank1 = [BI.footR, BI.footL].map(i => { const v = bonePos(g, i, new THREE.Vector3()); v.y = Math.max(RIG.ankle, v.y - keys.lie.p[0].y + 0.17); return v; });
      const footQ1 = [BI.footR, BI.footL].map(i => g.s.mq[i].clone());
      for (let i = 0; i < g.bones.length; i++) { g.bones[i].quaternion.copy(k0.q[i]); g.bones[i].position.copy(k0.p[i]); }
      fkFrom(g, 0);
      const r1q = qE(0, side * 0.9 + 0.4 * dir + yaw, Math.PI / 2 * side);
      s.death = {
        dir, side, yaw, k0, ank, footQ, ank1, footQ1, ...keys,
        r0p: g.rifle.position.clone(), r0q: g.rifle.quaternion.clone(),
        r1p: new THREE.Vector3(0.42 * side, 0.026, -0.15 * dir).applyAxisAngle(_Y, yaw), r1q,
      };
      s.L.init = false;                                      // re-plant the feet if this soldier is reused
    }
    poseDeath(g, st);
    g.flash.intensity = 0; g.flashMesh.visible = false;
  }
  g.root.rotation.x = 0; g.root.rotation.z = 0;
  g.rifle.visible = true;
}
