// Articulated guard model (~1.8 m) with procedural walk, aim, hit-flinch and death.
import * as THREE from 'three';
import { box, cyl, xform } from './geo.js';
import { mat, plainMat } from './materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function M(list) {
  return mergeGeometries(list.map(([g, m]) => { const x = g.index ? g.toNonIndexed() : g.clone(); if (m) x.applyMatrix4(m); for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; }));
}

let shared = null;
function materials() {
  if (shared) return shared;
  shared = {
    uniform: mat('fabric_uniform', { tile: 0.4 }),
    vest: mat('fabric_vest', { tile: 0.35 }),
    glove: mat('fabric_glove', { tile: 0.2 }),
    boot: plainMat(0x141312, 0.55),
    helmet: plainMat(0x2b302c, 0.6),
    skin: plainMat(0x1d1f1e, 0.85), // balaclava
    gun: mat('gunmetal'),
    visor: new THREE.MeshStandardMaterial({ color: 0x050505, emissive: new THREE.Color(0.9, 0.25, 0.1), emissiveIntensity: 1.5, roughness: 0.2 }),
  };
  return shared;
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

export function createGuard() {
  const S = materials();
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body); // pelvis pivot
  body.position.y = 0.98;
  const torso = new THREE.Group(); body.add(torso);
  const add = (parent, geo, material, shadow = true) => { const m = new THREE.Mesh(geo, material); m.castShadow = shadow; parent.add(m); return m; };
  // torso + plate carrier with pouches
  add(torso, M([[torsoGeo(), null]]), S.uniform);
  add(torso, M([
    [box(0.4, 0.4, 0.26, 0.05), xform(0, 0.31, 0)],
    [box(0.09, 0.13, 0.06), xform(-0.11, 0.2, -0.16)], [box(0.09, 0.13, 0.06), xform(0, 0.2, -0.16)], [box(0.09, 0.13, 0.06), xform(0.11, 0.2, -0.16)],
    [box(0.14, 0.1, 0.06), xform(0.09, 0.38, -0.16)], [box(0.3, 0.3, 0.08), xform(0, 0.3, 0.16)],
    [cyl(0.03, 0.03, 0.25, 8), xform(-0.12, 0.38, 0.22)],
  ]), S.vest);
  // head
  const head = new THREE.Group(); head.position.y = 0.62; torso.add(head);
  add(head, M([[cyl(0.06, 0.065, 0.1, 10), xform(0, 0.03, 0)], [new THREE.SphereGeometry(0.11, 24, 18), xform(0, 0.15, 0, 0, 0, 0, 1, 1.12, 1.05)]]), S.skin);
  add(head, M([[new THREE.SphereGeometry(0.135, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), xform(0, 0.19, 0.01)], [box(0.27, 0.025, 0.2), xform(0, 0.15, 0.02)]]), S.helmet);
  add(head, M([[box(0.16, 0.035, 0.04), xform(0, 0.16, -0.105)]]), S.visor, false); // NVG/visor glint
  // arms
  const arm = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.23, 0.5, 0); torso.add(sh);
    const up = limb(0.3, 0.06, 0.05, S.uniform); sh.add(up);
    const el = new THREE.Group(); el.position.y = -0.3; up.add(el);
    const fo = limb(0.27, 0.05, 0.042, S.uniform); el.add(fo);
    const hand = new THREE.Mesh(box(0.07, 0.1, 0.05, 0.022), S.glove); hand.position.y = -0.31; hand.castShadow = true; fo.add(hand);
    return { sh, el };
  };
  const armR = arm(1), armL = arm(-1);
  // legs
  const leg = (side) => {
    const hip = new THREE.Group(); hip.position.set(side * 0.1, 0, 0); body.add(hip);
    const th = limb(0.45, 0.085, 0.065, S.uniform); hip.add(th);
    const knee = new THREE.Group(); knee.position.y = -0.45; th.add(knee);
    const sh = limb(0.44, 0.065, 0.05, S.uniform); knee.add(sh);
    const boot = new THREE.Mesh(M([[box(0.115, 0.11, 0.29, 0.045), xform(0, -0.48, -0.05)], [box(0.12, 0.03, 0.3, 0.012), xform(0, -0.53, -0.05)]]), S.boot); boot.castShadow = true; sh.add(boot);
    return { hip, knee };
  };
  const legR = leg(1), legL = leg(-1);
  // rifle held across the body
  const rifle = new THREE.Group();
  add(rifle, M([[box(0.05, 0.08, 0.5), xform(0, 0, 0)], [cyl(0.012, 0.012, 0.3, 8), xform(0, 0.01, -0.4, 0, Math.PI / 2)], [box(0.04, 0.12, 0.05), xform(0, -0.09, -0.06, 0, 0.2)], [box(0.045, 0.08, 0.2), xform(0, -0.02, 0.32)], [box(0.035, 0.05, 0.035), xform(0, -0.09, 0.08, 0, 0.3)]]), S.gun);
  rifle.position.set(0.08, 0.32, -0.28);
  torso.add(rifle);
  // muzzle flash
  const flash = new THREE.PointLight(0xffa040, 0, 7, 2); flash.position.set(0, 0.02, -0.6); rifle.add(flash);
  const fl = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.5, 1.5) }));
  fl.position.set(0, 0.02, -0.6); fl.visible = false; rifle.add(fl);
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
  g.armR.sh.rotation.set(-0.5 - a * 0.9, -0.1 - a * 0.25, -0.25);
  g.armR.el.rotation.set(-1.1 + a * 0.6, 0, 0);
  g.armL.sh.rotation.set(-0.9 - a * 0.65, 0.5 + a * 0.15, 0.3);
  g.armL.el.rotation.set(-0.9 + a * 0.4, 0, 0);
  g.rifle.position.set(0.06, 0.3 + a * 0.13, -0.3 - a * 0.05);
  g.rifle.rotation.set(0.35 * (1 - a) + st.hit * 0.3, 0.25 * (1 - a), 0);
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
    g.armR.sh.rotation.x = g.armL.sh.rotation.x = -0.4 - e * 1.6;
    g.rifle.visible = d < 0.6;
  } else { g.root.rotation.x = 0; g.root.rotation.z = 0; g.rifle.visible = true; }
}
