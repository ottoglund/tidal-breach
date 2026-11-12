// First-person Ak 5C-style carbine with an Aimpoint-style tube red-dot,
// green gloves and M90-camouflage sleeves. Real-scale (~0.84 m overall).
// Animation: aim-down-sights, sway, bob, recoil spring, sprint pose, magazine change.
import * as THREE from 'three';
import { box, cyl, rcyl, tube, xform } from './geo.js';
import { mat } from './materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function M(list) {
  return mergeGeometries(list.map(([g, m]) => { const x = g.index ? g.toNonIndexed() : g.clone(); if (m) x.applyMatrix4(m); for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; }));
}
const ALONG_Z = Math.PI / 2; // rotate Y-axis primitives to lie along Z

// Smooth tapered limb along +Z from a to b (forearm with wrist taper).
function limbGeo(a, b, r0, r1) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const pts = [];
  for (let i = 0; i <= 5; i++) { const t = -Math.PI / 2 + i / 5 * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(t) * r0, Math.sin(t) * r0)); }
  pts.push(new THREE.Vector2(r0 * 1.06, len * 0.35));
  pts.push(new THREE.Vector2(r1 * 1.0, len * 0.9));
  pts.push(new THREE.Vector2(r1 * 0.95, len));
  const g = new THREE.LatheGeometry(pts, 20);
  g.scale(1, 1, 0.82);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

export class Weapon {
  constructor(scene) {
    this.scene = scene;
    const steel = mat('gunmetal', { wet: 'none' });
    const poly = mat('polymer', { wet: 'none' });
    const glove = mat('glove_green', { wet: 'none', tile: 0.12 });
    const sleeve = mat('camo_m90', { wet: 'none', tile: 0.45 });
    const webbing = mat('khaki_webbing', { wet: 'none', tile: 0.15 });
    this.root = new THREE.Group();
    this.gun = new THREE.Group();
    this.root.add(this.gun);
    scene.add(this.root);
    const add = (list, m) => { const o = new THREE.Mesh(M(list), m); this.gun.add(o); return o; };

    // Origin = sight line (centre of the red-dot tube). Barrel toward -Z.
    const rail = -0.047;          // top of the receiver rail
    const bore = -0.068;          // barrel axis
    const rx = -0.083;            // receiver centre
    add([
      // upper receiver + top rail with cross slots
      [box(0.036, 0.042, 0.26, 0.005), xform(0, rx + 0.004, -0.02)],
      [box(0.022, 0.008, 0.25, 0.002), xform(0, rail - 0.004, -0.02)],
      ...Array.from({ length: 16 }, (_, i) => [box(0.0225, 0.0035, 0.006, 0), xform(0, rail - 0.0005, 0.1 - i * 0.0155)]),
      // lower receiver, magazine well, trigger guard
      [box(0.032, 0.04, 0.2, 0.006), xform(0, rx - 0.036, 0.0)],
      [box(0.034, 0.046, 0.07, 0.006), xform(0, rx - 0.055, -0.06)],
      [box(0.012, 0.004, 0.065, 0.0015), xform(0, rx - 0.08, 0.02)],
      [box(0.006, 0.022, 0.006, 0.002), xform(0, rx - 0.07, 0.05)],
      // FNC-style charging handle on the right side + ejection port
      [box(0.018, 0.012, 0.022, 0.004), xform(0.027, rx + 0.006, -0.02)],
      [box(0.0025, 0.016, 0.07, 0.001), xform(0.0185, rx + 0.0, 0.03)],
      // fire selector
      [rcyl(0.007, 0.004, 0.0015, 16), xform(-0.017, rx - 0.03, 0.06, 0, 0, Math.PI / 2)],
      // barrel, gas block, front sight post, flash hider
      [rcyl(0.0095, 0.36, 0.002, 20), xform(0, bore, -0.33, 0, ALONG_Z)],
      [box(0.03, 0.03, 0.035, 0.005), xform(0, bore + 0.008, -0.36)],
      [box(0.004, 0.035, 0.004, 0.001), xform(0, bore + 0.035, -0.36)],
      [rcyl(0.0125, 0.06, 0.003, 20), xform(0, bore, -0.535, 0, ALONG_Z)],
      ...Array.from({ length: 4 }, (_, i) => [box(0.003, 0.026, 0.035, 0), xform(0, bore, -0.55, 0, 0, i * Math.PI / 4)]),
      // rail handguard (quad rail with heat shield look)
      [box(0.046, 0.046, 0.25, 0.008), xform(0, bore - 0.004, -0.205)],
      ...Array.from({ length: 13 }, (_, i) => [box(0.05, 0.006, 0.008, 0.001), xform(0, bore + 0.02, -0.095 - i * 0.018)]),
      ...Array.from({ length: 13 }, (_, i) => [box(0.006, 0.05, 0.008, 0.001), xform(0.024, bore - 0.004, -0.095 - i * 0.018)]),
      ...Array.from({ length: 13 }, (_, i) => [box(0.006, 0.05, 0.008, 0.001), xform(-0.024, bore - 0.004, -0.095 - i * 0.018)]),
      // telescopic stock tube + latch
      [rcyl(0.014, 0.14, 0.003, 20), xform(0, rx - 0.008, 0.17, 0, ALONG_Z)],
      [box(0.012, 0.016, 0.03, 0.003), xform(0, rx - 0.028, 0.12)],
      // Aimpoint-style red dot: 30 mm tube, objective/ocular bells, turrets, flip caps, QR mount

      [rcyl(0.009, 0.014, 0.002, 20), xform(0, 0.02, -0.035)],
      [rcyl(0.009, 0.014, 0.002, 20), xform(0.02, 0, -0.035, 0, 0, Math.PI / 2)],
      [rcyl(0.007, 0.012, 0.002, 16), xform(-0.019, 0, -0.035, 0, 0, Math.PI / 2)],
      [box(0.03, 0.03, 0.05, 0.005), xform(0, -0.026, -0.03)],
      [box(0.038, 0.01, 0.05, 0.003), xform(0, rail + 0.004, -0.03)],
      [rcyl(0.0045, 0.024, 0.0015, 12), xform(0.024, rail + 0.0055, -0.03, 0, 0, Math.PI / 2)],
    ], steel);
    // see-through optic tube: hollow lathe (outer wall + inner wall + rounded rims)
    const tubeProfile = [];
    const R = 0.0165, Rin = 0.0135, Rb = 0.0195, z0 = -0.09, z1 = 0.03;
    for (const [r, z] of [[Rin, z0], [Rb - 0.0015, z0 - 0.001], [Rb, z0 + 0.003], [Rb, z0 + 0.018], [R, z0 + 0.026], [R, z1 - 0.026], [Rb, z1 - 0.018], [Rb, z1 - 0.003], [Rb - 0.0015, z1 + 0.001], [Rin, z1]]) tubeProfile.push(new THREE.Vector2(r, z));
    const tubeG = new THREE.LatheGeometry(tubeProfile, 48);
    tubeG.rotateX(Math.PI / 2); // lathe axis Y -> Z (profile y = z)
    const tubeIn = new THREE.LatheGeometry([new THREE.Vector2(Rin, z1), new THREE.Vector2(Rin, z0)], 48); tubeIn.rotateX(Math.PI / 2);
    const optic = new THREE.Mesh(M([[tubeG, null], [tubeIn, null]]), steel.clone());
    optic.material.side = THREE.DoubleSide;
    this.gun.add(optic);
    add([
      // pistol grip with finger grooves (approximated with two bevelled blocks)
      [box(0.03, 0.1, 0.045, 0.01), xform(0, rx - 0.09, 0.045, 0, 0.3)],
      [box(0.031, 0.03, 0.04, 0.009), xform(0, rx - 0.15, 0.072, 0, 0.3)],
      // collapsible buttstock
      [box(0.04, 0.075, 0.12, 0.012), xform(0, rx - 0.018, 0.25)],
      [box(0.044, 0.11, 0.025, 0.01), xform(0, rx - 0.03, 0.31)],
      [box(0.02, 0.04, 0.09, 0.008), xform(0, rx + 0.025, 0.25)],
    ], poly);
    // sling swivel + short run of khaki webbing at the front sling point
    add([[box(0.006, 0.026, 0.06, 0.002), xform(-0.027, bore - 0.03, -0.15)]], webbing);
    // red-dot lens and reticle
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 32), new THREE.MeshPhysicalMaterial({ color: 0x3a4a52, roughness: 0.02, metalness: 0.0, transparent: true, opacity: 0.22, envMapIntensity: 2 }));
    lens.position.set(0, 0, -0.07); this.gun.add(lens);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.00075, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 0.3, 0.2), toneMapped: false }));
    dot.position.set(0, 0, -0.069); this.gun.add(dot);
    this.dot = dot;

    // STANAG magazine (separate for the reload) – slight curve
    this.mag = new THREE.Group();
    this.mag.add(new THREE.Mesh(M([
      [box(0.022, 0.07, 0.062, 0.004), xform(0, -0.035, 0)],
      [box(0.022, 0.07, 0.06, 0.004), xform(0, -0.1, -0.008, 0, 0.14)],
      [box(0.026, 0.012, 0.066, 0.004), xform(0, -0.138, -0.016, 0, 0.18)],
    ]), steel));
    this.mag.position.set(0, rx - 0.07, -0.062);
    this.magHome = this.mag.position.clone();
    this.gun.add(this.mag);

    // ---- right hand on the pistol grip, forearm back to the elbow ----
    const right = new THREE.Group();
    const g = [0.0, rx - 0.1, 0.05];
    right.add(new THREE.Mesh(M([
      [box(0.052, 0.06, 0.085, 0.022), xform(g[0] + 0.026, g[1] + 0.005, g[2] + 0.012, 0, 0.3)],              // back of hand
      ...[0, 1, 2, 3].map(i => [box(0.024, 0.02, 0.05, 0.009), xform(g[0] - 0.004, g[1] + 0.03 - i * 0.021, g[2] - 0.028 + i * 0.006, 0.0, 0.3)]), // fingers wrapped round the grip
      [box(0.022, 0.024, 0.06, 0.01), xform(g[0] - 0.012, g[1] + 0.05, g[2] + 0.01, 0.35, 0.1)],                 // thumb
      [box(0.02, 0.018, 0.04, 0.008), xform(g[0] - 0.006, g[1] + 0.045, g[2] - 0.035, 0, 0.1)],                 // trigger finger along the receiver
    ]), glove));
    right.add(new THREE.Mesh(limbGeo([g[0] + 0.03, g[1] - 0.005, g[2] + 0.05], [0.16, g[1] - 0.17, 0.42], 0.034, 0.048), sleeve));
    right.add(new THREE.Mesh(limbGeo([0.035, g[1] - 0.012, g[2] + 0.075], [0.04, g[1] - 0.02, g[2] + 0.11], 0.033, 0.036), glove)); // glove cuff
    this.gun.add(right);
    // ---- left hand: C-clamp on the handguard, thumb over the top ----
    const left = new THREE.Group();
    const h = [0.0, bore - 0.004, -0.27];
    left.add(new THREE.Mesh(M([
      [box(0.03, 0.062, 0.09, 0.012), xform(h[0] - 0.035, h[1] - 0.006, h[2], 0, 0, 0.22)],                  // palm, left side
      ...[0, 1, 2, 3].map(i => [box(0.05, 0.02, 0.022, 0.009), xform(h[0] + 0.002, h[1] - 0.035, h[2] - 0.03 + i * 0.021, 0, 0, -0.15)]), // fingers under
      ...[0, 1, 2, 3].map(i => [box(0.016, 0.03, 0.02, 0.007), xform(h[0] + 0.03, h[1] - 0.016, h[2] - 0.03 + i * 0.021)]),           // fingertips right side
      [box(0.024, 0.02, 0.06, 0.009), xform(h[0] - 0.012, h[1] + 0.03, h[2] - 0.035, 0.15)],                        // thumb on top
    ]), glove));
    left.add(new THREE.Mesh(limbGeo([h[0] - 0.045, h[1] - 0.03, h[2] + 0.04], [-0.2, h[1] - 0.21, 0.06], 0.033, 0.047), sleeve));
    this.leftHand = left; this.leftHome = left.position.clone();
    this.gun.add(left);
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

    // viewmodel lighting follows the light conditions where the player stands
    this.hemi = new THREE.HemisphereLight(0x3d4a56, 0x0c0b0a, 0.5); scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffc28a, 1.0); this.key.position.set(0.5, 1, 0.4); scene.add(this.key);
    this.rim = new THREE.DirectionalLight(0x9fb8d6, 0.35); this.rim.position.set(-0.8, 0.4, -0.6); scene.add(this.rim);

    this.ads = 0; this.recoil = 0; this.recoilV = 0; this.kickRot = 0; this.swayX = 0; this.swayY = 0; this.flashT = 0; this.sprint = 0;
    // hip: low right; ADS: red-dot centred on the camera axis, tube ~9 cm in front of the eye
    this.hip = new THREE.Vector3(0.125, -0.125, -0.25);
    this.aim = new THREE.Vector3(0, 0, -0.2);
  }

  fire() {
    this.recoilV += 0.9;
    this.kickRot += 0.045 + Math.random() * 0.02;
    this.flashT = 0.04;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.75 + Math.random() * 0.5);
  }

  update(dt, s) {
    this.ads += ((s.ads ? 1 : 0) - this.ads) * Math.min(1, dt * 12);
    this.sprint += ((s.sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    this.recoilV += (-this.recoil * 380 - this.recoilV * 24) * dt;
    this.recoil += this.recoilV * dt;
    this.kickRot *= Math.exp(-dt * 14);
    this.swayX += (-s.lookDX * 0.0005 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (s.lookDY * 0.0005 - this.swayY) * Math.min(1, dt * 9);
    const a = this.ads, steady = 1 - a * 0.85;
    const bobX = Math.sin(s.bob) * 0.011 * (s.moving ? 1 : 0.15) * steady;
    const bobY = Math.abs(Math.cos(s.bob)) * 0.009 * (s.moving ? 1 : 0.15) * steady;
    const breathe = Math.sin(s.time * 1.3) * 0.0012 * steady;
    const p = this.hip.clone().lerp(this.aim, a);
    this.gun.position.set(p.x + bobX + this.swayX * steady, p.y - bobY + breathe + this.swayY * steady, p.z + this.recoil * 0.03);
    this.gun.rotation.set(this.kickRot * (1 - a * 0.6) + this.swayY * 3 * steady - this.sprint * 0.5, this.swayX * 3 * steady + this.sprint * 0.55 + (1 - a) * 0.04, -bobX * 2 - this.sprint * 0.3 - (1 - a) * 0.05);
    this.gun.position.x -= this.sprint * 0.02; this.gun.position.y -= this.sprint * 0.035;
    const r = s.reloading;
    if (r >= 0) {
      const tilt = Math.sin(Math.min(1, r * 1.15) * Math.PI);
      this.gun.rotation.z += tilt * 0.5; this.gun.rotation.x += tilt * 0.15; this.gun.position.y -= tilt * 0.03;
      let my = 0, mz = 0;
      if (r < 0.3) my = -(r / 0.3) * 0.35;
      else if (r < 0.55) { my = -0.35 + ((r - 0.3) / 0.25) * 0.33; mz = 0.02; }
      else if (r < 0.65) my = -0.02 + ((r - 0.55) / 0.1) * 0.02;
      this.mag.position.set(this.magHome.x, this.magHome.y + my, this.magHome.z + mz);
      this.mag.visible = !(r > 0.27 && r < 0.33);
      const reach = r > 0.2 && r < 0.68;
      this.leftHand.position.set(this.leftHome.x, this.leftHome.y + (reach ? Math.max(my, -0.3) - 0.02 : 0), this.leftHome.z + (reach ? 0.21 : 0));
    } else {
      this.mag.position.copy(this.magHome); this.mag.visible = true; this.leftHand.position.copy(this.leftHome);
    }
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.flashLight.intensity = this.flashT > 0 ? 4 : 0;
    this.key.intensity = 0.25 + Math.min(1.2, s.lightLevel) * 1.4;
    this.key.color.copy(s.lightColor);
    this.dot.visible = a > 0.3;
  }
}
