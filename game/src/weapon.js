// First-person Ak 5C carbine with an Aimpoint-style tube red-dot, olive gloves and M90-camouflage sleeves.
// Geometry lives in ./viewmodel/ (rifle.js, hands.js, parts.js). Real-scale (~0.85 m overall).
// Animation: aim-down-sights, sway, bob, recoil spring, sprint pose, magazine change with a hand that
// drops to the vest, grabs a fresh magazine and seats it.
import * as THREE from 'three';
import { box } from './geo.js';
import { xform } from './geo.js';
import { mat } from './materials.js';
import { merge, V } from './viewmodel/parts.js';
import { buildRifle, DIM } from './viewmodel/rifle.js';
import { buildRightHand, buildLeftHand, LEFT_ANCHOR } from './viewmodel/hands.js';

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _c = new THREE.Color(), _warm = new THREE.Color(0xffd0a0);

/** Viewmodel material: a private clone of a world material, brightened for the HDR weapon pass. */
function vm(set, opts, tint, extra = {}) {
  const m = mat(set, { wet: 'none', ...opts }).clone();
  if (tint !== undefined) m.color.setScalar(tint);
  Object.assign(m, extra);
  return m;
}

export class Weapon {
  constructor(scene) {
    this.scene = scene;
    const mats = {
      steel: vm('gunmetal', { roughness: 0.62 }, 1.0, { vertexColors: true, envMapIntensity: 1.25 }),      // black anodised, bare metal on edges
      poly: vm('polymer', { roughness: 0.92 }, 1.25, { vertexColors: true, envMapIntensity: 0.8 }),         // matte polymer
      glove: vm('glove_green', { tile: 0.12, roughness: 1 }, 1.35, { envMapIntensity: 0.6 }),
      sleeve: vm('camo_m90', { tile: 0.45, roughness: 1 }, 1.25, { envMapIntensity: 0.5 }),
      webbing: vm('khaki_webbing', { tile: 0.15 }, 1.3, { envMapIntensity: 0.5 }),
      sleeveHem: vm('camo_m90', { tile: 0.2, roughness: 1 }, 0.8, { envMapIntensity: 0.4 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.8, metalness: 0.0 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x141413, roughness: 0.95, metalness: 0.0 }),
    };
    this.mats = mats;
    const steel = mats.steel;
    this.root = new THREE.Group();
    this.gun = new THREE.Group();
    this.root.add(this.gun);
    scene.add(this.root);
    const { bore, rail } = DIM;

    const built = buildRifle(this.gun, mats);
    this.mag = built.mag;
    this.magHome = this.mag.position.clone();

    // ---- see-through optic tube: hollow lathe (outer wall + inner wall + rounded rims) ----
    const tubeProfile = [];
    const R = 0.0165, Rin = 0.0135, Rb = 0.0195, z0 = -0.09, z1 = 0.03;
    for (const [r, z] of [[Rin, z0], [Rb - 0.0015, z0 - 0.001], [Rb, z0 + 0.003], [Rb, z0 + 0.018], [R, z0 + 0.026], [R, z1 - 0.026], [Rb, z1 - 0.018], [Rb, z1 - 0.003], [Rb - 0.0015, z1 + 0.001], [Rin, z1]]) tubeProfile.push(new THREE.Vector2(r, z));
    const tubeG = new THREE.LatheGeometry(tubeProfile, 48);
    tubeG.rotateX(Math.PI / 2);
    const tubeIn = new THREE.LatheGeometry([new THREE.Vector2(Rin, z1), new THREE.Vector2(Rin, z0)], 48); tubeIn.rotateX(Math.PI / 2);
    const optic = new THREE.Mesh(merge([[tubeG, null], [tubeIn, null]], 0), steel.clone());
    optic.material.vertexColors = false; optic.material.side = THREE.DoubleSide;
    this.gun.add(optic);

    // ---- red-dot lens and reticle ----
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 32), new THREE.MeshPhysicalMaterial({ color: 0x3a4a52, roughness: 0.02, metalness: 0.0, transparent: true, opacity: 0.22, envMapIntensity: 2 }));
    lens.position.set(0, 0, -0.07); this.gun.add(lens);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.00075, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 0.3, 0.2), toneMapped: false }));
    dot.position.set(0, 0, -0.069); this.gun.add(dot);
    const gc = document.createElement('canvas'); gc.width = gc.height = 64;
    const gx = gc.getContext('2d'), gg = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gg.addColorStop(0, 'rgba(255,60,40,0.9)'); gg.addColorStop(0.15, 'rgba(255,40,30,0.35)'); gg.addColorStop(1, 'rgba(255,0,0,0)');
    gx.fillStyle = gg; gx.fillRect(0, 0, 64, 64);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.006), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), color: new THREE.Color(3, 1, 1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    dot.add(halo); halo.position.set(0, 0, 0.0005);
    this.dot = dot;

    // ---- hands ----
    this.gun.add(buildRightHand(mats));
    // left hand sits in a pivot at the C-clamp centre so it can swing/rotate while holding the new magazine
    this.leftPivot = new THREE.Group();
    const left = buildLeftHand(mats);
    left.position.copy(LEFT_ANCHOR).negate();
    this.leftPivot.add(left);
    this.leftPivot.position.copy(LEFT_ANCHOR);
    this.gun.add(this.leftPivot);
    this.leftHome = LEFT_ANCHOR.clone();
    this.leftHand = this.leftPivot;

    // fresh magazine held in the left hand during the reload (same shape as the seated one)
    this.THETA = 0.7;
    this.mag2 = new THREE.Group();
    for (const c of this.mag.children) this.mag2.add(new THREE.Mesh(c.geometry, c.material));
    this.mag2.rotation.x = -this.THETA;
    this.mag2.position.set(0, 0, -0.05);
    this.mag2.visible = false;
    this.leftPivot.add(this.mag2);

    // chest rig with spare magazines: slides into view only while reloading
    this.vest = new THREE.Group();
    const pouch = [], tops = [];
    for (let i = 0; i < 3; i++) {
      pouch.push([box(0.058, 0.07, 0.03, 0.006), xform(-0.07 + i * 0.07, 0, 0.012)]);
      pouch.push([box(0.052, 0.018, 0.034, 0.004), xform(-0.07 + i * 0.07, 0.03, 0.013)]);
    }
    pouch.push([box(0.23, 0.12, 0.016, 0.008), xform(0, -0.012, -0.004)]);
    this.vest.add(new THREE.Mesh(merge(pouch), mats.webbing));
    for (const x of [-0.07, 0, 0.07]) { const t = new THREE.Mesh(merge([[box(0.0215, 0.05, 0.058, 0.003), xform(0, 0.045, 0.012)]], 0.1), mats.poly); t.position.x = x; this.vest.add(t); }
    this.vestHome = new THREE.Vector3(-0.255, -0.085, -0.1);
    this.vest.position.copy(this.vestHome).add(V(0, -0.2, 0));
    this.vest.rotation.set(-0.25, 0.5, 0.15);
    this.vest.visible = false;
    this.gun.add(this.vest);

    this.gun.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });

    // ---- muzzle flash (cross + star sprites, randomised per shot) ----
    const fc = document.createElement('canvas'); fc.width = fc.height = 128;
    const c2 = fc.getContext('2d');
    const gr = c2.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.2, 'rgba(255,200,110,0.85)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
    c2.fillStyle = gr;
    for (let i = 0; i < 4; i++) { c2.save(); c2.translate(64, 64); c2.rotate(i * Math.PI / 2 + 0.3); c2.beginPath(); c2.ellipse(0, -26, 7, 30, 0, 0, Math.PI * 2); c2.fill(); c2.restore(); }
    c2.beginPath(); c2.arc(64, 64, 20, 0, Math.PI * 2); c2.fill();
    const flashMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fc), color: new THREE.Color(5, 3.6, 2.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: true });
    this.flash = new THREE.Group();
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), flashMat); this.flash.add(f1);
    const f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.2), flashMat); f2.rotation.y = Math.PI / 2; f2.position.z = -0.07; this.flash.add(f2);
    const f3 = f2.clone(); f3.rotation.set(0, Math.PI / 2, Math.PI / 2); this.flash.add(f3);
    this.flash.position.set(0, bore, -0.58);
    this.flash.visible = false;
    this.gun.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 3, 2);
    this.flashLight.position.set(0, bore, -0.6); this.gun.add(this.flashLight);

    // ---- viewmodel lighting: hemisphere + warm key (follows the lamps near the player) + cool rim + wet-quay bounce ----
    this.hemi = new THREE.HemisphereLight(0x6a7888, 0x241f1a, 1.0); scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x303640, 0.3); scene.add(this.ambient);
    this.key = new THREE.DirectionalLight(0xffc890, 1.0); this.key.position.set(0.55, 1, 0.45); scene.add(this.key);
    this.rim = new THREE.DirectionalLight(0x9fb8d6, 1.1); this.rim.position.set(-0.8, 0.35, -0.7); scene.add(this.rim);
    this.bounce = new THREE.DirectionalLight(0x8c7a66, 0.35); this.bounce.position.set(0.1, -1, 0.3); scene.add(this.bounce);

    this.ads = 0; this.recoil = 0; this.recoilV = 0; this.kickRot = 0; this.swayX = 0; this.swayY = 0; this.flashT = 0; this.sprint = 0;
    // hip: low right; ADS: red-dot centred on the camera axis, tube ~9 cm in front of the eye
    this.hip = new THREE.Vector3(0.125, -0.125, -0.25);
    this.aim = new THREE.Vector3(0, 0, -0.2);
    this._p = new THREE.Vector3(); this._q = new THREE.Vector3(); this._m = new THREE.Matrix4();
  }

  fire() {
    this.recoilV += 0.9;
    this.kickRot += 0.045 + Math.random() * 0.02;
    this.kickYaw = (this.kickYaw || 0) + (Math.random() - 0.45) * 0.03;   // slight right-bias horizontal jump
    this.kickRoll = (this.kickRoll || 0) + (Math.random() - 0.5) * 0.04;
    this.flashT = 0.04;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.75 + Math.random() * 0.5);
  }

  /** Pivot position that puts the held magazine's top at `top` for a given hand rotation. */
  _pivotFor(top, theta, out) {
    return out.copy(this.mag2.position).applyAxisAngle(V(1, 0, 0), theta).negate().add(top);
  }

  _reload(r, tilt) {
    const H = this.leftHome, T = this.THETA, mh = this.magHome;
    const lp = this.leftPivot;
    // vest slides in from below for the middle of the reload
    const vin = sstep(0.04, 0.2, r) * (1 - sstep(0.7, 0.88, r));
    this.vest.visible = vin > 0.01;
    this.vest.position.copy(this.vestHome).y -= (1 - vin) * 0.22;
    // grab point in gun space: top of the right-most spare magazine
    const grab = V(0, 0, 0).copy(this.vestHome).add(V(0.07, 0.085, 0.02).applyEuler(this.vest.rotation));
    const wellLow = V(mh.x, mh.y - 0.06, mh.z + 0.004), seat = V(mh.x, mh.y, mh.z);
    const P = this._p, tmp = V(0, 0, 0);
    let theta = 0, showSpare = false;
    if (r < 0.1) {
      const k = sstep(0, 0.1, r);
      P.copy(H).add(V(-0.02 * k, -0.04 * k, 0.015 * k));
    } else if (r < 0.3) {
      const k = sstep(0.1, 0.3, r);
      const from = V(H.x - 0.02, H.y - 0.04, H.z + 0.015), to = this._pivotFor(grab, 0, tmp);
      P.lerpVectors(from, to, k); P.y += Math.sin(k * Math.PI) * 0.02;
    } else if (r < 0.66) {
      showSpare = true;
      theta = T * sstep(0.36, 0.6, r);
      const top = V(0, 0, 0);
      if (r < 0.38) top.copy(grab).y += sstep(0.3, 0.38, r) * 0.04;
      else if (r < 0.58) top.lerpVectors(V(grab.x, grab.y + 0.04, grab.z), wellLow, sstep(0.38, 0.58, r));
      else { theta = T; top.lerpVectors(wellLow, seat, sstep(0.58, 0.66, r)); }
      this._pivotFor(top, theta, P);
    } else if (r < 0.7) {
      theta = T; this._pivotFor(seat, T, P);          // magazine seated; spare model hidden, hand still at the well
    } else {
      const k = sstep(0.7, 0.9, r);
      theta = T * (1 - sstep(0.7, 0.82, r));
      P.lerpVectors(this._pivotFor(seat, T, tmp), H, k);
    }
    lp.position.copy(P); lp.rotation.set(theta, 0, 0);
    this.mag2.visible = showSpare;
    // old magazine drops free
    const m = this.mag;
    if (r < 0.06) { m.position.copy(mh); m.rotation.set(0, 0, 0); m.visible = true; }
    else if (r < 0.3) {
      const t = (r - 0.06) * 1.65;
      m.position.set(mh.x, mh.y - 4.9 * t * t - 0.01, mh.z); m.rotation.set(t * 1.2, 0, t * 0.8);
      m.visible = m.position.y > mh.y - 0.6;
    } else if (r < 0.66) m.visible = false;
    else { m.visible = true; m.rotation.set(0, 0, 0); m.position.copy(mh); }
    // rifle cants so the magazine well opens toward the reaching hand; small slap when the magazine seats
    const slap = Math.exp(-Math.pow((r - 0.67) * 28, 2));
    this.gun.rotation.z -= tilt * 0.38; this.gun.rotation.x += tilt * 0.14 + slap * 0.05; this.gun.position.y -= tilt * 0.015 + slap * 0.008;
    this.gun.position.z += slap * 0.01;
  }

  update(dt, s) {
    this.ads += ((s.ads ? 1 : 0) - this.ads) * Math.min(1, dt * 12);
    this.sprint += ((s.sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    this.recoilV += (-this.recoil * 380 - this.recoilV * 24) * dt;
    this.recoil += this.recoilV * dt;
    this.kickRot *= Math.exp(-dt * 14);
    this.swayX += (-s.lookDX * 0.0005 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (s.lookDY * 0.0005 - this.swayY) * Math.min(1, dt * 9);
    const a = this.ads, steady = 1 - a * 0.85, sp = this.sprint;
    const bobAmp = (s.moving ? 1 : 0.15) * steady * (1 + sp * 1.6);
    const bobX = Math.sin(s.bob) * 0.011 * bobAmp;
    const bobY = Math.abs(Math.cos(s.bob)) * 0.009 * bobAmp;
    const breathe = Math.sin(s.time * 1.3) * 0.0012 * steady;
    this.kickYaw = (this.kickYaw || 0) * Math.exp(-dt * 10);
    this.kickRoll = (this.kickRoll || 0) * Math.exp(-dt * 9);
    // holding a sight picture: slow figure-eight from breathing and muscle tremor
    const hold = a * (Math.sin(s.time * 0.9) * 0.0007 + Math.sin(s.time * 7.3) * 0.00012);
    const holdY = a * (Math.sin(s.time * 1.8) * 0.0005 + Math.sin(s.time * 6.1 + 1.0) * 0.0001);
    // bring the rifle up on an arc (dips below the line, then settles into the shoulder)
    const arc = Math.sin(Math.PI * a) * 0.02;
    const p = this.hip.clone().lerp(this.aim, a);
    p.x += hold; p.y += holdY - arc;
    this.gun.position.set(p.x + bobX + this.swayX * steady, p.y - bobY + breathe + this.swayY * steady, p.z + this.recoil * 0.03);
    // sprint: rifle across the chest, muzzle low and to the left, canted
    this.gun.rotation.set(this.kickRot * (1 - a * 0.6) + this.swayY * 3 * steady - sp * 0.5, this.swayX * 3 * steady + sp * 0.6 + (1 - a) * 0.04, -bobX * 2 - sp * 0.32 - (1 - a) * 0.05);
    this.gun.position.x -= sp * 0.03; this.gun.position.y -= sp * 0.045; this.gun.position.z += sp * 0.03;
    this.gun.rotation.y += this.kickYaw; this.gun.rotation.z += this.kickRoll * (1 - a * 0.5);
    const r = s.reloading;
    this.leftPivot.position.copy(this.leftHome); this.leftPivot.rotation.set(0, 0, 0);
    this.leftPivot.position.z += sp * 0.03;
    if (r >= 0) {
      this.gun.updateMatrix();
      this._reload(r, Math.sin(Math.min(1, r * 1.15) * Math.PI));
    } else {
      this.mag.position.copy(this.magHome); this.mag.rotation.set(0, 0, 0); this.mag.visible = true;
      this.mag2.visible = false; this.vest.visible = false;
    }
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.flashLight.intensity = this.flashT > 0 ? 4 : 0;

    // lighting: key colour/strength follow the lamps near the player; rim + hemisphere keep a readable form
    const lvl = Math.min(1.5, Math.max(0, s.lightLevel));
    this.key.intensity = 0.55 + lvl * 1.5;
    const lc = s.lightColor, mx = Math.max(lc.r, lc.g, lc.b, 1e-3);
    _c.setRGB(lc.r / mx, lc.g / mx, lc.b / mx).lerp(_warm, 0.45);
    this.key.color.copy(_c);
    this.hemi.intensity = 0.8 + lvl * 0.35;
    this.rim.intensity = 0.9 + lvl * 0.3;
    this.scene.environmentIntensity = 0.75 + lvl * 0.35;
    this.dot.visible = a > 0.3;
  }
}
