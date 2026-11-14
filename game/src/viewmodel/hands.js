// Gloved hands + M90-camouflage sleeves, built in gun space (see rifle.js).
// Fingers are jointed capsule chains (proximal/middle/distal) with knuckle pads; the thumb has a thenar mass.
import * as THREE from 'three';
import { DIM } from './rifle.js';
import { merge, V, seg, ell, finger, sleeve } from './parts.js';

const GR = new THREE.Matrix4().makeRotationX(DIM.gripTilt);
const gp = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(GR).add(DIM.grip);   // grip-local -> gun space
const gd = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(GR).normalize();
const AX = { X: V(1, 0, 0), Y: V(0, 1, 0), Z: V(0, 0, 1) };

function cuffAndSleeve(wrist, toElbow, rGlove, rSleeve, rElbow, parts, sleeveParts, strap) {
  const dir = toElbow.clone().normalize();
  const cuffEnd = wrist.clone().addScaledVector(dir, 0.05);
  // glove gauntlet: slightly flared wrist cuff with a velcro tab
  parts.push([seg(wrist, cuffEnd, rGlove, rGlove * 1.1, 0.86, 16), null]);
  const sA = wrist.clone().addScaledVector(dir, 0.04);
  const sB = wrist.clone().addScaledVector(dir, 0.04 + 0.34);
  sleeveParts.push([sleeve(sA, sB, rSleeve, rElbow), null]);
  // sleeve cuff band (sewn hem + velcro tab)
  strap.push([seg(sA.clone().addScaledVector(dir, 0.004), sA.clone().addScaledVector(dir, 0.016), rSleeve * 1.02, rSleeve * 1.02, 0.84, 16), null]);
  return { dir, sA };
}

export function buildRightHand(m) {
  const g = new THREE.Group();
  const glove = [], sl = [], band = [];
  // fingers 2-4 wrap the front of the pistol grip, tips ending on the grip's left side
  const ys = [0.019, -0.004, -0.026];
  ys.forEach((y, i) => {
    const r = [0.0100, 0.0094, 0.0087, 0.0079].map(v => v * (1 - i * 0.03));
    finger(glove, gp(0.030, y, -0.002), gd(-0.32, 0, -0.95), AX.Y.clone().transformDirection(GR), [0.15, 1.2, 0.95], [0.040 - i * 0.002, 0.027 - i * 0.001, 0.022 - i * 0.001], r);
    glove.push([ell(gp(0.039, y, -0.004), [0.0045, 0.0115, 0.0105], [0, 0.3, 0]), null]);   // knuckle pad
  });
  // index finger laid along the receiver toward the trigger
  const i0 = gp(0.030, 0.044, -0.004);
  finger(glove, i0, V(-0.12, 0.06, -1), V(0, 1, 0), [0, 0.14, 0.16], [0.040, 0.028, 0.024], [0.0105, 0.0097, 0.0089, 0.0082]);
  glove.push([ell(gp(0.039, 0.044, -0.004), [0.0045, 0.0115, 0.0105], [0, 0.3, 0]), null]);
  // thumb wrapped across the top-left of the grip / lower receiver
  const t = finger(glove, gp(0.016, 0.047, 0.030), gd(-0.78, 0.02, -0.62), AX.Y.clone().transformDirection(GR), [0.0, 0.3], [0.036, 0.029], [0.0125, 0.0108, 0.0094]);
  // palm, thenar and hypothenar pads, back of the hand
  glove.push([ell(gp(0.030, 0.004, 0.022), [0.0118, 0.047, 0.034], [0, -0.42, 0]), null]);
  glove.push([ell(gp(0.020, 0.037, 0.035), [0.014, 0.017, 0.021], [0.3, -0.5, 0]), null]);
  glove.push([ell(gp(0.030, -0.03, 0.036), [0.012, 0.014, 0.024], [0, -0.5, 0]), null]);
  glove.push([ell(gp(0.041, 0.006, 0.024), [0.0085, 0.044, 0.032], [0, -0.42, 0]), null]);    // back-of-hand padding
  // seams: thin bands across the back of the hand
  const wrist = gp(0.036, -0.004, 0.086);
  const toElbow = V(0.12, -0.33, 0.55).sub(wrist);
  cuffAndSleeve(wrist, toElbow, 0.0305, 0.036, 0.05, glove, sl, band);
  g.add(new THREE.Mesh(merge(glove), m.glove));
  g.add(new THREE.Mesh(merge(sl), m.sleeve));
  g.add(new THREE.Mesh(merge(band), m.sleeveHem));
  return g;
}

export const LEFT_ANCHOR = new THREE.Vector3(0, DIM.bore, -0.2);   // centre of the C-clamp, on the handguard axis

export function buildLeftHand(m) {
  const g = new THREE.Group();
  const glove = [], sl = [], band = [], dark = [], steel = [];
  const b = DIM.bore;
  // four fingers pass under the handguard and curl up its right side
  for (let i = 0; i < 4; i++) {
    const z = -0.249 + i * 0.0225, k = 1 - i * 0.025;
    const r = [0.0100, 0.0094, 0.0087, 0.0079].map(v => v * k);
    finger(glove, V(-0.03, b - 0.032, z), V(1, 0, 0), AX.Z, [0.0, 0.9, 0.85], [0.042 * k, 0.027 * k, 0.022 * k], r);
    glove.push([ell(V(-0.036, b - 0.040, z), [0.0105, 0.0055, 0.0105], [0, 0, 0]), null]);       // knuckle pad (back of fingers, left)
  }
  // thumb lies forward along the left side of the handguard
  finger(glove, V(-0.05, b - 0.021, -0.238), V(0.35, 0.3, -0.88), AX.Y, [0.0, -0.2], [0.038, 0.032], [0.0125, 0.0108, 0.0093]);
  glove.push([ell(V(-0.054, b - 0.02, -0.222), [0.016, 0.014, 0.024], [0.2, 0.1, 0.4]), null]);   // thenar
  // palm + back of the hand + heel
  glove.push([ell(V(-0.048, b - 0.030, -0.205), [0.032, 0.0115, 0.046], [0, 0, 0.28]), null]);
  glove.push([ell(V(-0.054, b - 0.039, -0.203), [0.030, 0.0085, 0.043], [0, 0, 0.28]), null]);
  glove.push([ell(V(-0.07, b - 0.032, -0.18), [0.016, 0.014, 0.03], [0, 0, 0.3]), null]);
  const wrist = V(-0.078, b - 0.04, -0.185);
  const toElbow = V(-0.22, -0.4, 0.15).sub(wrist);
  const { dir, sA } = cuffAndSleeve(wrist, toElbow, 0.0305, 0.036, 0.05, glove, sl, band);
  // wristwatch: dark strap + case on top of the sleeve cuff
  const wp = wrist.clone().addScaledVector(dir, 0.07);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir);
  band.push([new THREE.TorusGeometry(0.0385, 0.0042, 5, 18), new THREE.Matrix4().compose(wp, q, V(1, 1, 0.8))]);
  steel.push([new THREE.CylinderGeometry(0.0125, 0.0125, 0.006, 16), new THREE.Matrix4().compose(wp.clone().add(V(0.004, 0.043, 0)), q, V(1, 1, 1))]);
  dark.push([new THREE.CylinderGeometry(0.0105, 0.0105, 0.0012, 16), new THREE.Matrix4().compose(wp.clone().add(V(0.004, 0.0465, 0)), q, V(1, 1, 1))]);
  g.add(new THREE.Mesh(merge(glove), m.glove));
  g.add(new THREE.Mesh(merge(sl), m.sleeve));
  g.add(new THREE.Mesh(merge(band), m.sleeveHem));
  g.add(new THREE.Mesh(merge(steel, 0.5), m.steel));
  g.add(new THREE.Mesh(merge(dark), m.dark));
  return g;
}
