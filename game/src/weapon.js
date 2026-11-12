// First-person carbine + gloved hands, modelled at real scale (overall ~0.78 m).
// Animation: aim-down-sights, sway, bob, recoil spring, sprint pose, magazine-change reload.
import * as THREE from 'three';
import { box, cyl, tube, xform } from './geo.js';
import { mat } from './materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function M(list) {
  return mergeGeometries(list.map(([g, m]) => { const x = g.index ? g.toNonIndexed() : g.clone(); if (m) x.applyMatrix4(m); for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; }));
}
function mesh(list, material) { const m = new THREE.Mesh(M(list), material); m.layers.set(0); return m; }

export class Weapon {
  constructor(scene) {
    this.scene = scene;
    const metal = mat('gunmetal', { wet: 'none' });
    const poly = mat('polymer', { wet: 'none' });
    const glove = mat('fabric_glove', { wet: 'none', tile: 0.12 });
    const sleeve = mat('fabric_uniform', { wet: 'none', tile: 0.25 });
    this.root = new THREE.Group();      // follows camera
    this.gun = new THREE.Group();       // animated weapon pivot (at grip)
    this.root.add(this.gun);
    scene.add(this.root);

    // ---- weapon body; origin = sight line, barrel toward -Z ----
    const rx = 0, ry = -0.062; // receiver centre below sight line
    const parts = [
      [box(0.034, 0.05, 0.25), xform(rx, ry, -0.02)],            // upper receiver
      [box(0.022, 0.012, 0.36), xform(rx, ry + 0.031, -0.12)],   // top rail
      [box(0.03, 0.045, 0.19), xform(rx, ry - 0.045, 0.0)],      // lower receiver
      [box(0.036, 0.05, 0.05), xform(rx, ry - 0.05, -0.065)],    // mag well
      [box(0.012, 0.012, 0.03), xform(rx + 0.019, ry + 0.005, 0.02)], // forward assist
      [box(0.002, 0.03, 0.07), xform(rx + 0.018, ry, -0.02)],    // ejection port cover
      [box(0.03, 0.012, 0.05), xform(rx, ry + 0.022, 0.115)],    // charging handle
      [cyl(0.009, 0.009, 0.32, 12), xform(rx, ry + 0.005, -0.41, 0, Math.PI / 2)], // barrel
      [cyl(0.012, 0.012, 0.055, 12), xform(rx, ry + 0.005, -0.585, 0, Math.PI / 2)], // flash hider
      [box(0.014, 0.004, 0.008), xform(rx, ry + 0.035, -0.29)],  // front sight base
      [cyl(0.014, 0.014, 0.04, 14), xform(rx, ry - 0.015, 0.18, 0, Math.PI / 2)], // buffer tube
      [box(0.012, 0.03, 0.02), xform(rx, ry - 0.06, 0.01)],      // trigger guard
      [box(0.006, 0.006, 0.12), xform(rx + 0.03, ry, -0.24)],    // flashlight mount
      [cyl(0.014, 0.014, 0.11, 14), xform(rx + 0.036, ry - 0.004, -0.27, 0, Math.PI / 2)], // flashlight
    ];
    // octagonal free-float handguard with slots
    const hg = cyl(0.026, 0.026, 0.27, 8);
    parts.push([hg, xform(rx, ry - 0.002, -0.27, Math.PI / 8, Math.PI / 2)]);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) parts.push([box(0.004, 0.012, 0.025), xform(rx + s * 0.025, ry - 0.004, -0.17 - i * 0.04)]);
    // red-dot sight on a riser
    parts.push([box(0.024, 0.02, 0.04), xform(0, ry + 0.045, -0.05)]);
    parts.push([cyl(0.019, 0.019, 0.06, 18, true), xform(0, ry + 0.072, -0.05, 0, Math.PI / 2)]);
    parts.push([cyl(0.006, 0.006, 0.012, 10), xform(0.022, ry + 0.072, -0.05, 0, 0, Math.PI / 2)]);
    this.gun.add(mesh(parts, metal));
    const polyParts = [
      [box(0.028, 0.09, 0.045), xform(rx, ry - 0.095, 0.045, 0, 0.32)],  // pistol grip
      [box(0.04, 0.07, 0.17), xform(rx, ry - 0.03, 0.25)],              // stock
      [box(0.036, 0.03, 0.06), xform(rx, ry - 0.06, 0.31, 0, -0.15)],   // stock lower
      [box(0.045, 0.072, 0.02), xform(rx, ry - 0.026, 0.335)],          // butt pad
      [box(0.022, 0.07, 0.03), xform(rx, ry - 0.06, -0.33, 0, -0.1)],   // angled foregrip
    ];
    this.gun.add(mesh(polyParts, poly));
    // red dot lens + emissive dot (visible in ADS)
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0175, 24), new THREE.MeshPhysicalMaterial({ color: 0x223322, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.18 }));
    lens.position.set(0, ry + 0.072, -0.03); this.gun.add(lens);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.4, 0.3) }));
    dot.position.set(0, ry + 0.072, -0.079); this.gun.add(dot);
    this.dot = dot;
    // magazine (separate so the reload can animate it)
    this.mag = new THREE.Group();
    this.mag.add(mesh([
      [box(0.026, 0.09, 0.062), xform(0, -0.045, 0, 0, 0.0)],
      [box(0.026, 0.07, 0.06), xform(0, -0.11, -0.01, 0, 0.22)],
      [box(0.03, 0.012, 0.07), xform(0, -0.148, -0.022, 0, 0.22)],
    ], poly));
    this.mag.position.set(rx, ry - 0.07, -0.068);
    this.magHome = this.mag.position.clone();
    this.gun.add(this.mag);

    // ---- hands & forearms (gun space) ----
    const fingers = (x, y, z, curl, side) => {
      const g = [];
      for (let i = 0; i < 4; i++) g.push([box(0.017, 0.019, 0.05), xform(x + side * 0.004, y - 0.012 - i * 0.019, z, 0, 0, 0).multiply(xform(0, 0, 0, side * curl))]);
      return g;
    };
    // right hand wraps the pistol grip, forearm runs back/down/right to the elbow off-screen
    const gripP = [0.004, ry - 0.09, 0.05];
    const right = new THREE.Group();
    right.add(mesh([
      [box(0.05, 0.085, 0.07), xform(gripP[0] + 0.022, gripP[1], gripP[2] + 0.005, 0, 0.32)],   // palm around grip
      ...fingers(gripP[0] - 0.012, gripP[1] + 0.03, gripP[2] - 0.035, 0.3, -1),
      [box(0.02, 0.022, 0.055), xform(gripP[0] - 0.02, gripP[1] + 0.045, gripP[2] - 0.0, 0.4)],     // thumb over the selector
    ], glove));
    right.add(mesh([[tube([gripP[0] + 0.035, gripP[1] - 0.02, gripP[2] + 0.04], [0.15, gripP[1] - 0.2, 0.36], 0.038, 12)]], sleeve));
    right.add(mesh([[tube([0.15, gripP[1] - 0.2, 0.36], [0.2, gripP[1] - 0.26, 0.55], 0.05, 12)]], sleeve));
    this.gun.add(right);
    // left hand under the handguard (C-clamp), forearm angles down-left
    const hgP = [0.0, ry - 0.035, -0.31];
    const left = new THREE.Group();
    left.add(mesh([
      [box(0.03, 0.07, 0.085), xform(hgP[0] - 0.03, hgP[1] - 0.005, hgP[2], 0, 0, 0.25)],          // palm on the left side
      [box(0.07, 0.022, 0.08), xform(hgP[0] - 0.005, hgP[1] - 0.04, hgP[2])],                    // fingers under
      [box(0.022, 0.05, 0.075), xform(hgP[0] + 0.03, hgP[1] - 0.012, hgP[2], 0, 0, -0.2)],         // fingertips right side
      [box(0.02, 0.02, 0.06), xform(hgP[0] - 0.015, hgP[1] + 0.03, hgP[2] - 0.03, 0.3)],          // thumb on top
    ], glove));
    left.add(mesh([[tube([hgP[0] - 0.04, hgP[1] - 0.04, hgP[2] + 0.03], [-0.17, hgP[1] - 0.24, -0.05], 0.036, 12)]], sleeve));
    left.add(mesh([[tube([-0.17, hgP[1] - 0.24, -0.05], [-0.24, hgP[1] - 0.36, 0.25], 0.05, 12)]], sleeve));
    this.leftHand = left; this.leftHome = left.position.clone();
    this.gun.add(left);
    this.gun.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

    // ---- muzzle flash ----
    const fc = document.createElement('canvas'); fc.width = fc.height = 128;
    const g = fc.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,190,90,0.8)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = gr;
    for (let i = 0; i < 5; i++) { g.save(); g.translate(64, 64); g.rotate(i * Math.PI * 2 / 5); g.beginPath(); g.ellipse(0, -22, 9, 30, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
    g.beginPath(); g.arc(64, 64, 26, 0, Math.PI * 2); g.fill();
    const ft = new THREE.CanvasTexture(fc);
    const flashMat = new THREE.MeshBasicMaterial({ map: ft, color: new THREE.Color(4, 3, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flash = new THREE.Group();
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat); this.flash.add(f1);
    const f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.24), flashMat); f2.rotation.y = Math.PI / 2; f2.position.z = -0.08; this.flash.add(f2);
    const f3 = f2.clone(); f3.rotation.set(0, Math.PI / 2, Math.PI / 2); this.flash.add(f3);
    this.flash.position.set(rx, ry + 0.005, -0.64);
    this.flash.visible = false;
    this.gun.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 4, 2);
    this.flashLight.position.set(0, ry, -0.65); this.gun.add(this.flashLight);

    // weapon-scene lighting (follows world light conditions)
    this.hemi = new THREE.HemisphereLight(0x4a5866, 0x0c0b0a, 0.6); scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffc28a, 1.5); this.key.position.set(0.6, 1, 0.2); scene.add(this.key);
    this.rim = new THREE.DirectionalLight(0x9fb8d6, 0.6); this.rim.position.set(-0.8, 0.4, -0.6); scene.add(this.rim);

    // animation state
    this.ads = 0; this.recoil = 0; this.recoilV = 0; this.kickRot = 0; this.swayX = 0; this.swayY = 0; this.flashT = 0; this.sprint = 0;
    this.hip = new THREE.Vector3(0.105, -0.108, -0.2);
    this.aim = new THREE.Vector3(0, -0.008, -0.13);
  }

  fire() {
    this.recoilV += 0.9;
    this.kickRot += 0.05 + Math.random() * 0.02;
    this.flashT = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
  }

  update(dt, s) {
    // s: {ads, bob, run, moving, lookDX, lookDY, reloading (0..1 progress or -1), time, lightLevel, lightColor}
    this.ads += ((s.ads ? 1 : 0) - this.ads) * Math.min(1, dt * 12);
    this.sprint += ((s.sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    // recoil spring-damper
    this.recoilV += (-this.recoil * 380 - this.recoilV * 24) * dt;
    this.recoil += this.recoilV * dt;
    this.kickRot *= Math.exp(-dt * 14);
    // sway lags behind look input
    this.swayX += (-s.lookDX * 0.0006 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (s.lookDY * 0.0006 - this.swayY) * Math.min(1, dt * 9);
    const a = this.ads, steady = 1 - a * 0.85;
    const bobX = Math.sin(s.bob) * 0.012 * (s.moving ? 1 : 0.15) * steady;
    const bobY = Math.abs(Math.cos(s.bob)) * 0.01 * (s.moving ? 1 : 0.15) * steady;
    const breathe = Math.sin(s.time * 1.3) * 0.0016 * steady;
    const p = this.hip.clone().lerp(this.aim, a);
    this.gun.position.set(p.x + bobX + this.swayX, p.y - bobY + breathe + this.swayY, p.z + this.recoil * 0.035);
    this.gun.rotation.set(this.kickRot * (1 - a * 0.5) + this.swayY * 4 - this.sprint * 0.55, this.swayX * 3 + this.sprint * 0.6, -bobX * 2 - this.sprint * 0.35);
    this.gun.position.x += this.sprint * -0.02; this.gun.position.y -= this.sprint * 0.04;
    // reload: tilt the gun, drop the mag, bring a fresh one in with the support hand
    const r = s.reloading;
    if (r >= 0) {
      const tilt = Math.sin(Math.min(1, r * 1.15) * Math.PI);
      this.gun.rotation.z += tilt * 0.55; this.gun.rotation.x += tilt * 0.18; this.gun.position.y -= tilt * 0.03;
      let my = 0, mz = 0;
      if (r < 0.3) { my = -(r / 0.3) * 0.35; }
      else if (r < 0.55) { my = -0.35 + ((r - 0.3) / 0.25) * 0.33; mz = 0.02; }
      else if (r < 0.65) { my = -0.02 + ((r - 0.55) / 0.1) * 0.02; }
      this.mag.position.set(this.magHome.x, this.magHome.y + my, this.magHome.z + mz);
      this.mag.visible = !(r > 0.27 && r < 0.33);
      this.leftHand.position.set(this.leftHome.x, this.leftHome.y + (r > 0.2 && r < 0.68 ? Math.max(my, -0.3) - 0.02 : 0), this.leftHome.z + (r > 0.2 && r < 0.68 ? 0.24 : 0));
    } else {
      this.mag.position.copy(this.magHome); this.mag.visible = true; this.leftHand.position.copy(this.leftHome);
    }
    // flash
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.flashLight.intensity = this.flashT > 0 ? 6 : 0;
    // light the weapon like the world around the player
    this.key.intensity = 0.35 + s.lightLevel * 2.2;
    this.key.color.copy(s.lightColor);
    this.dot.visible = a > 0.3;
  }
}
