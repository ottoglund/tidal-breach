// Articulated guard model (~1.8 m) with procedural walk, aim, hit-flinch and death.
import * as THREE from 'three';
import { box, cyl, rcyl, xform } from './geo.js';
import { mat, plainMat } from './materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function M(list) {
  return mergeGeometries(list.map(([g, m]) => { const x = g.index ? g.toNonIndexed() : g.clone(); if (m) x.applyMatrix4(m); for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; }));
}

let shared = null;
function materials() {
  if (shared) return shared;
  shared = {
    uniform: mat('camo_emr', { tile: 0.42, color: 0x9a9a92 }),
    vest: mat('ratnik_green', { tile: 0.35 }),
    glove: plainMat(0x161616, 0.75),
    boot: plainMat(0x121211, 0.5),
    helmet: mat('ratnik_green', { tile: 0.3 }),
    skin: mat('olive_knit', { tile: 0.2 }), // olive balaclava
    gun: mat('gunmetal'),
    wood: mat('ak_wood', { tile: 0.3 }),
    poly: mat('polymer', { tile: 0.25 }),
    plum: mat('plum_polymer', { tile: 0.2 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x050607, roughness: 0.05, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03 }), // tinted lenses
  };
  return shared;
}

// Kalashnikov family at real scale. Barrel toward -Z, origin near the magazine well.
// variant 'ak74': AK-74M (black polymer, plum magazine, AK-74 muzzle brake)
// variant 'akm' : AKM/AK-47 pattern (laminated wood furniture, slant brake, steel magazine)
function kalashnikov(S, variant) {
  const g = new THREE.Group();
  const furn = variant === 'akm' ? S.wood : S.poly;
  const magM = variant === 'akm' ? S.gun : S.plum;
  const add = (list, m) => { const o = new THREE.Mesh(M(list), m); o.castShadow = true; g.add(o); };
  const Z = Math.PI / 2;
  add([
    [box(0.046, 0.06, 0.25, 0.004), xform(0, 0, 0.02)],                 // stamped receiver
    [box(0.042, 0.022, 0.23, 0.009), xform(0, 0.038, 0.03)],            // dust cover
    ...[0, 1, 2].map(i => [box(0.044, 0.004, 0.006, 0.001), xform(0, 0.05, 0.13 - i * 0.012)]),
    [box(0.03, 0.02, 0.06, 0.004), xform(0, 0.042, -0.12)],             // rear sight block
    [box(0.026, 0.006, 0.08, 0.002), xform(0, 0.054, -0.11)],           // sight leaf
    [rcyl(0.009, 0.27, 0.002, 16), xform(0, 0.0, -0.4, 0, Z)],         // barrel
    [rcyl(0.011, 0.2, 0.002, 16), xform(0, 0.034, -0.27, 0, Z)],       // gas tube
    [box(0.022, 0.06, 0.03, 0.004), xform(0, 0.02, -0.52)],             // front sight block
    [box(0.004, 0.03, 0.004, 0.001), xform(0, 0.06, -0.52)],
    [box(0.006, 0.02, 0.06, 0.002), xform(0.026, 0.005, 0.05)],         // selector lever
    [box(0.012, 0.03, 0.06, 0.003), xform(0, -0.045, 0.06)],            // trigger guard
    ...(variant === 'akm'
      ? [[rcyl(0.011, 0.04, 0.003, 16), xform(0, 0.0, -0.555, 0, Z)]]    // slant brake
      : [[rcyl(0.0135, 0.085, 0.004, 20), xform(0, 0.0, -0.575, 0, Z)], [box(0.03, 0.006, 0.012, 0.002), xform(0, 0.0, -0.56)]]),
  ], S.gun);
  add([
    [box(0.056, 0.05, 0.2, 0.012), xform(0, -0.006, -0.27)],            // lower handguard
    [box(0.04, 0.028, 0.17, 0.01), xform(0, 0.036, -0.26)],             // upper handguard over the gas tube
    [box(0.032, 0.095, 0.042, 0.01), xform(0, -0.075, 0.1, 0, 0.32)],   // pistol grip
    [box(0.042, 0.06, 0.24, 0.012), xform(0, -0.02, 0.27, 0, -0.08)],   // stock
    [box(0.046, 0.13, 0.03, 0.012), xform(0, -0.05, 0.39, 0, -0.08)],   // butt
  ], furn);
  // curved 30-round magazine: segments rotated progressively
  const segs = [];
  for (let i = 0; i < 5; i++) segs.push([box(0.028, 0.045, 0.07 - i * 0.002, 0.005), xform(0, -0.05 - i * 0.04, -0.07 - i * i * 0.007, 0, 0.12 + i * 0.12)]);
  add(segs, magM);
  return g;
}

// Tapered capsule along -Y from the joint (smooth, organic limb shape).
function taper(len, r0, r1, seg = 20) {
  const pts = [];
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r1, -len + r1 + Math.sin(a) * r1)); }
  // slight muscle bulge in the upper third
  pts.push(new THREE.Vector2((r0 + r1) * 0.5 * 1.08, -len * 0.55));
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r0, -r0 * 0.3 + Math.sin(a) * r0)); }
  return new THREE.LatheGeometry(pts, seg);
}
function torsoGeo() {
  // chest-to-hip profile, flattened front-to-back
  const prof = [[0.0, -0.02], [0.15, 0.0], [0.16, 0.08], [0.15, 0.2], [0.175, 0.36], [0.19, 0.46], [0.16, 0.53], [0.08, 0.58], [0.0, 0.6]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 24);
  g.scale(1, 1, 0.62);
  return g;
}

function limb(len, r0, r1, material) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(taper(len, r0, r1), material);
  m.castShadow = true;
  g.add(m);
  return g;
}

export function createGuard(variant = 'ak74') {
  const S = materials();
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body); // pelvis pivot
  body.position.y = 0.98;
  const torso = new THREE.Group(); body.add(torso);
  const add = (parent, geo, material, shadow = true) => { const m = new THREE.Mesh(geo, material); m.castShadow = shadow; parent.add(m); return m; };
  // torso + plate carrier with pouches
  add(torso, M([[torsoGeo(), null]]), S.uniform);
  // chest rig after the reference: shoulder harness, admin panel, belt line with AK mag pouches
  add(torso, M([
    ...[-1, 1].map(sx => [box(0.05, 0.42, 0.014, 0.006), xform(sx * 0.1, 0.33, -0.128, 0, 0.12, sx * 0.08)]),  // front harness straps
    ...[-1, 1].map(sx => [box(0.05, 0.42, 0.014, 0.006), xform(sx * 0.1, 0.33, 0.125, 0, -0.12, -sx * 0.08)]), // back straps
    ...[-1, 1].map(sx => [box(0.06, 0.03, 0.27, 0.01), xform(sx * 0.11, 0.56, 0, 0, 0, 0)]),                  // over the shoulders
    [box(0.23, 0.2, 0.045, 0.012), xform(0, 0.31, -0.15)],                                                // admin / map panel
    [box(0.21, 0.035, 0.05, 0.01), xform(0, 0.4, -0.16)],                                                 // panel flap
    [box(0.07, 0.11, 0.045, 0.012), xform(0.135, 0.38, -0.135, 0, 0, 0.1)],                               // radio pouch
    [box(0.44, 0.055, 0.3, 0.02), xform(0, 0.04, 0)],                                                     // belt
    ...[-0.088, 0, 0.088].map(x => [box(0.078, 0.15, 0.065, 0.014), xform(x, 0.07, -0.18)]),               // triple AK mag pouches
    ...[-1, 1].map(sx => [box(0.08, 0.14, 0.16, 0.035), xform(sx * 0.225, 0.02, -0.02)]),                  // side utility / dump pouches
    [box(0.12, 0.12, 0.08, 0.03), xform(-0.12, 0.03, 0.16)],                                              // canteen
  ]), S.vest);
  // magazine tops protruding from the pouches
  add(torso, M([-0.088, 0, 0.088].map(x => [box(0.03, 0.05, 0.05, 0.006), xform(x, 0.165, -0.185, 0, 0.15)])), S.plum);
  // jacket collar
  add(torso, M([[box(0.2, 0.06, 0.16, 0.03), xform(0, 0.58, 0)]]), S.uniform);
  // head
  const head = new THREE.Group(); head.position.y = 0.62; torso.add(head);
  // olive balaclava over the head and neck
  add(head, M([[cyl(0.062, 0.068, 0.1, 16), xform(0, 0.03, 0)], [new THREE.SphereGeometry(0.108, 28, 20), xform(0, 0.155, -0.005, 0, 0, 0, 0.95, 1.14, 1.05)],
    [box(0.09, 0.06, 0.05, 0.02), xform(0, 0.09, -0.085)]]), S.skin);  // chin / jaw
  // electronic hearing protection: two cups and a headband over the top
  const band = new THREE.TorusGeometry(0.118, 0.012, 8, 32, Math.PI);
  add(head, M([
    [rcyl(0.047, 0.04, 0.012, 32), xform(0.112, 0.15, 0.0, 0, 0, Math.PI / 2)],
    [rcyl(0.047, 0.04, 0.012, 32), xform(-0.112, 0.15, 0.0, 0, 0, Math.PI / 2)],
    [band, xform(0, 0.16, 0.0, 0, 0, 0)],
  ]), S.vest);
  // wrap-around dark shooting glasses
  add(head, M([[box(0.075, 0.042, 0.012, 0.01), xform(0.037, 0.175, -0.104, -0.18)], [box(0.075, 0.042, 0.012, 0.01), xform(-0.037, 0.175, -0.104, 0.18)],
    [box(0.006, 0.006, 0.1, 0.002), xform(0.1, 0.185, -0.05)], [box(0.006, 0.006, 0.1, 0.002), xform(-0.1, 0.185, -0.05)]]), S.visor, false);
  // arms
  const arm = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.23, 0.5, 0); torso.add(sh);
    const up = limb(0.3, 0.068, 0.058, S.uniform); sh.add(up);
    const el = new THREE.Group(); el.position.y = -0.3; up.add(el);
    const fo = limb(0.27, 0.058, 0.046, S.uniform); el.add(fo);
    const hand = new THREE.Mesh(box(0.07, 0.1, 0.05, 0.022), S.glove); hand.position.y = -0.31; hand.castShadow = true; fo.add(hand);
    return { sh, el, base: sh.position.clone(), side };
  };
  const armR = arm(1), armL = arm(-1);
  // clothing volume: jacket hem, belt with pouches, shoulder straps, radio
  add(torso, M([[box(0.4, 0.1, 0.27, 0.04), xform(0, -0.02, 0)]]), S.uniform);
  add(torso, M([[box(0.41, 0.05, 0.28, 0.015), xform(0, 0.07, 0)], [box(0.08, 0.1, 0.06, 0.015), xform(0.16, 0.04, 0.12)], [box(0.08, 0.1, 0.06, 0.015), xform(-0.16, 0.04, 0.12)], [box(0.06, 0.16, 0.05, 0.012), xform(-0.12, 0.42, 0.2)]]), S.vest);
  // legs
  const leg = (side) => {
    const hip = new THREE.Group(); hip.position.set(side * 0.1, 0, 0); body.add(hip);
    const th = limb(0.45, 0.1, 0.078, S.uniform); hip.add(th);
    const knee = new THREE.Group(); knee.position.y = -0.45; th.add(knee);
    const sh = limb(0.44, 0.078, 0.06, S.uniform); knee.add(sh);
    // cargo pocket and knee pad
    const pocket = new THREE.Mesh(box(0.05, 0.16, 0.13, 0.02), S.uniform); pocket.position.set(side * 0.085, -0.25, 0); pocket.castShadow = true; th.add(pocket);
    const pad = new THREE.Mesh(box(0.11, 0.12, 0.05, 0.02), S.vest); pad.position.set(0, -0.03, -0.065); pad.castShadow = true; sh.add(pad);
    const boot = new THREE.Mesh(M([[box(0.115, 0.11, 0.29, 0.045), xform(0, -0.48, -0.05)], [box(0.12, 0.03, 0.3, 0.012), xform(0, -0.53, -0.05)]]), S.boot); boot.castShadow = true; sh.add(boot);
    return { hip, knee };
  };
  const legR = leg(1), legL = leg(-1);
  // rifle held across the body
  const rifle = kalashnikov(S, variant);
  rifle.position.set(0.08, 0.32, -0.28);
  torso.add(rifle);
  // muzzle flash
  const flash = new THREE.PointLight(0xffa040, 0, 7, 2); flash.position.set(0, 0.0, -0.66); rifle.add(flash);
  const fl = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.5, 1.5) }));
  fl.position.set(0, 0.0, -0.66); fl.visible = false; rifle.add(fl);
  root.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  return { root, body, torso, head, armR, armL, legR, legL, rifle, flash, flashMesh: fl };
}

/** Pose a guard. st: {walk, speed(0..1), aim(0..1), flash, hit, dead(0..1 progress), time} */
export function poseGuard(g, st) {
  const ph = st.walk, sp = st.speed;
  const swing = Math.sin(ph) * 0.55 * sp;
  g.legR.hip.rotation.x = swing; g.legL.hip.rotation.x = -swing;
  g.legR.knee.rotation.x = Math.max(0, -Math.cos(ph)) * 0.9 * sp + 0.05;
  g.legL.knee.rotation.x = Math.max(0, Math.cos(ph)) * 0.9 * sp + 0.05;
  g.body.position.y = 0.98 - Math.abs(Math.sin(ph)) * 0.035 * sp - st.aim * 0.05;
  g.torso.rotation.y = Math.sin(ph) * 0.08 * sp;
  g.torso.rotation.x = -0.05 - st.aim * 0.08 + st.hit * 0.35;
  // arms hold the rifle: patrol low-ready vs aiming
  const a = st.aim;
  g.rifle.position.set(0.07 - a * 0.02, 0.27 + a * 0.2, -0.2 - a * 0.06);
  g.rifle.rotation.set(0.45 * (1 - a) + st.hit * 0.3, 0.3 * (1 - a), 0);
  g.rifle.updateMatrix();
  // two-bone IK: right hand on the pistol grip, left hand on the handguard
  reach(g.armR, _v1.set(0, -0.07, 0.1).applyMatrix4(g.rifle.matrix), _pR);
  reach(g.armL, _v2.set(0, -0.01, -0.27).applyMatrix4(g.rifle.matrix), _pL);
  g.head.rotation.x = a * 0.12;
  g.flash.intensity = st.flash > 0 ? 18 : 0;
  g.flashMesh.visible = st.flash > 0;
  // death: knees buckle, then fall backward/sideways
  if (st.dead > 0) {
    const d = Math.min(1, st.dead);
    const e = d * d * (3 - 2 * d);
    g.legR.knee.rotation.x = g.legL.knee.rotation.x = 1.2 * Math.min(1, d * 2);
    g.body.position.y = 0.98 - e * 0.8;
    g.root.rotation.x = e * 1.45 * st.fallDir;
    g.root.rotation.z = e * 0.2;
    g.torso.rotation.x = -e * 0.3;
      g.rifle.visible = d < 0.6;
  } else { g.root.rotation.x = 0; g.root.rotation.z = 0; g.rifle.visible = true; }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _pR = new THREE.Vector3(0.7, -1, 0.35), _pL = new THREE.Vector3(-0.8, -1, 0.1);
const DOWN = new THREE.Vector3(0, -1, 0);
const UPPER = 0.3, FORE = 0.29;
const _u = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
/** Analytic two-bone IK in torso space; limbs point along -Y in their local frames. */
function reach(arm, target, pole) {
  const S = arm.base;
  _u.copy(target).sub(S);
  let d = _u.length();
  d = Math.min(Math.max(d, 0.08), UPPER + FORE - 0.002);
  _u.normalize();
  const cosA = (UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _w.copy(pole).addScaledVector(_u, -pole.dot(_u)).normalize();
  _e.copy(S).addScaledVector(_u, UPPER * cosA).addScaledVector(_w, UPPER * sinA);
  arm.sh.quaternion.setFromUnitVectors(DOWN, _d.copy(_e).sub(S).normalize());
  _q.copy(arm.sh.quaternion).invert();
  _d.copy(target).sub(_e).normalize().applyQuaternion(_q);
  arm.el.quaternion.setFromUnitVectors(DOWN, _d);
}
