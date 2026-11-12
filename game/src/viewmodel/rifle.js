// Ak 5C (FN FNC-derived) carbine geometry. Gun space: origin = centre of the red-dot tube,
// barrel toward -Z, +X right, +Y up. Real scale (~0.85 m overall).
import * as THREE from 'three';
import { box, rcyl } from '../geo.js';
import { xform } from '../geo.js';
import { merge, V, profileLathe, seg } from './parts.js';

export const DIM = {
  rail: -0.047,            // top of the Picatinny rail
  bore: -0.068,            // barrel axis
  recvTop: -0.056,
  recvMid: -0.078,         // upper receiver centre
  lowMid: -0.118,          // lower receiver centre
  grip: new THREE.Vector3(0, -0.176, 0.07), // pistol grip centre
  gripTilt: -0.3,          // rotation about X: bottom of grip leans back toward the shooter
  magWell: new THREE.Vector3(0, -0.15, -0.062),
  hgZ0: -0.095, hgZ1: -0.345,
};
const A = Math.PI / 2;
const sb = (w, h, d) => box(w, h, d, 0);      // hard-edged box for small slots/details

/** Flat strap (sling) between two points; width along X-ish. */
function ribbon(a, b, w, t) {
  const A_ = V(...a), B_ = V(...b), len = A_.distanceTo(B_);
  const m = new THREE.Matrix4().lookAt(A_, B_, V(1, 0, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return [new THREE.BoxGeometry(t, w, len), new THREE.Matrix4().compose(A_.clone().add(B_).multiplyScalar(0.5), q, V(1, 1, 1))];
}

export function buildRifle(gun, m) {
  const { rail, bore, recvTop, recvMid, lowMid, grip, gripTilt, hgZ0, hgZ1 } = DIM;
  const add = (list, mat, wear = 0) => { const o = new THREE.Mesh(merge(list, wear), mat); gun.add(o); return o; };

  // ---------- metal: receiver, rails, barrel (black anodised, bare metal on edges) ----------
  const metal = [
    // upper receiver: rounded body + sloped shoulders; flat-top rail with cross slots
    [box(0.036, 0.04, 0.27, 0.006), xform(0, recvMid, -0.005)],
    [box(0.028, 0.012, 0.25, 0.004), xform(0, recvTop - 0.004, -0.005)],
    [box(0.024, 0.0075, 0.255, 0.001), xform(0, rail - 0.0035, 0.0)],
    ...Array.from({ length: 17 }, (_, i) => [sb(0.0245, 0.0032, 0.0055), xform(0, rail - 0.0004, 0.115 - i * 0.0155)]),
    // lower receiver with trigger-guard bow
    [box(0.034, 0.044, 0.215, 0.006), xform(0, lowMid, 0.0)],
    [box(0.037, 0.056, 0.078, 0.006), xform(0, lowMid - 0.034, -0.062)],   // magazine well
    [box(0.0125, 0.0042, 0.072, 0.0015), xform(0, -0.1535, 0.012)],         // guard bottom
    [box(0.0125, 0.026, 0.0045, 0.0015), xform(0, -0.1415, -0.0235)],       // guard front
    [box(0.0125, 0.024, 0.0045, 0.0015), xform(0, -0.1425, 0.0485)],        // guard rear
    [box(0.006, 0.026, 0.008, 0.002), xform(0, -0.138, 0.002, 0, 0.22)],     // trigger blade
    // dust-cover frame around the ejection port (right side)
    [sb(0.002, 0.003, 0.072), xform(0.0182, recvMid + 0.016, 0.03)],
    [sb(0.002, 0.003, 0.072), xform(0.0182, recvMid - 0.01, 0.03)],
    // charging handle: slot, rod, knob (right side)
    [sb(0.0025, 0.007, 0.07), xform(0.0182, recvMid + 0.003, -0.065)],
    [rcyl(0.0035, 0.018, 0.001, 10), xform(0.024, recvMid + 0.003, -0.05, 0, 0, A)],
    [rcyl(0.0075, 0.009, 0.002, 14), xform(0.036, recvMid + 0.003, -0.05, 0, 0, A)],
    // fire selector lever (left) + pivot disc
    [rcyl(0.0075, 0.004, 0.0015, 16), xform(-0.0185, lowMid + 0.004, 0.045, 0, 0, A)],
    [box(0.003, 0.006, 0.026, 0.001), xform(-0.0215, lowMid + 0.004, 0.058, 0, 0, 0)],
    // magazine release button (right) and bolt catch
    [rcyl(0.0055, 0.006, 0.0015, 12), xform(0.0205, -0.131, -0.036, 0, 0, A)],
    [box(0.003, 0.012, 0.016, 0.001), xform(-0.0195, -0.128, -0.036)],
    // takedown pin + rear sight base
    [rcyl(0.0045, 0.01, 0.001, 10), xform(0.0185, lowMid + 0.012, 0.09, 0, 0, A)],
    [box(0.014, 0.012, 0.022, 0.003), xform(0, rail - 0.012, 0.125)],
    // barrel: reduced from handguard to muzzle, with gas block + sight base
    [rcyl(0.0092, 0.17, 0.001, 20), xform(0, bore, -0.43, 0, A)],
    [rcyl(0.0105, 0.022, 0.002, 20), xform(0, bore, -0.36, 0, A)],
    [box(0.026, 0.026, 0.036, 0.005), xform(0, bore + 0.007, -0.358)],
    [box(0.004, 0.026, 0.004, 0.001), xform(-0.007, bore + 0.026, -0.358)],  // front sight ears
    [box(0.004, 0.026, 0.004, 0.001), xform(0.007, bore + 0.026, -0.358)],
    [sb(0.0016, 0.022, 0.0016), xform(0, bore + 0.026, -0.358)],              // sight post
    // flash hider: stepped, slotted
    [rcyl(0.0128, 0.056, 0.0025, 20), xform(0, bore, -0.535, 0, A)],
    [rcyl(0.0138, 0.008, 0.002, 20), xform(0, bore, -0.512, 0, A)],
    // front sling swivel: lug + ring
    [box(0.01, 0.01, 0.012, 0.002), xform(0, bore - 0.0165, -0.345)],
    [new THREE.TorusGeometry(0.0075, 0.0016, 5, 12), xform(0, bore - 0.03, -0.345, A)],
    // handguard rail system (Ak 5C: top rail + short side rails with slots)
    ...Array.from({ length: 14 }, (_, i) => [sb(0.0245, 0.0034, 0.0065), xform(0, bore + 0.0275, hgZ0 - 0.01 - i * 0.0158)]),
    ...[-1, 1].flatMap(s => Array.from({ length: 6 }, (_, i) => [sb(0.0034, 0.011, 0.0065), xform(s * 0.0245, bore - 0.002, hgZ0 - 0.07 - i * 0.0158)])),
    ...Array.from({ length: 6 }, (_, i) => [sb(0.011, 0.0034, 0.0065), xform(0, bore - 0.0275, hgZ0 - 0.07 - i * 0.0158)]),
    // handguard retaining ring at the front
    [box(0.043, 0.043, 0.01, 0.004), xform(0, bore, hgZ1 + 0.006)],
  ];
  const body = add(metal, m.steel, 1);

  // handguard: matte polymer-metal tube with heat-shield vents (dark slots)
  add([
    [box(0.043, 0.043, 0.24, 0.011), xform(0, bore, (hgZ0 + hgZ1) / 2 + 0.003)],
    [box(0.04, 0.012, 0.03, 0.004), xform(0, bore - 0.003, hgZ0 - 0.012)],
  ], m.poly, 0.15);
  add([
    ...[-1, 1].flatMap(s => Array.from({ length: 5 }, (_, i) => [sb(0.0016, 0.011, 0.02), xform(s * 0.0218, bore + 0.006, hgZ0 - 0.04 - i * 0.033)])),
  ], m.dark);

  // ejection port opening, mag-well shadow, muzzle bore, optic-mount shadow (matte black)
  add([
    [sb(0.0016, 0.019, 0.062), xform(0.0186, recvMid + 0.003, 0.03)],
    [sb(0.0016, 0.012, 0.026), xform(0.0187, recvMid + 0.003, -0.005)],
    [rcyl(0.0066, 0.002, 0, 14), xform(0, bore, -0.5635, 0, A)],
    ...Array.from({ length: 5 }, (_, i) => [sb(0.0028, 0.0275, 0.024), xform(0, bore, -0.535, 0, 0, i * Math.PI / 5)]),
  ], m.dark);

  // ---------- polymer: pistol grip, collapsible stock, butt pad ----------
  const gripProfile = [[0.0001, -0.056], [0.0105, -0.054], [0.0135, -0.044], [0.0145, -0.02], [0.0142, 0.0], [0.0155, 0.02], [0.0165, 0.04], [0.0165, 0.05], [0.0001, 0.052]];
  const gripG = profileLathe(gripProfile, 1.0, 1.4, 20);
  const gm = new THREE.Matrix4().compose(grip, new THREE.Quaternion().setFromEuler(new THREE.Euler(gripTilt, 0, 0)), V(1, 1, 1));
  const poly = [
    [gripG, gm],
    // base cap of the grip + bevelled top where it meets the lower receiver
    [box(0.034, 0.012, 0.04, 0.004), new THREE.Matrix4().multiplyMatrices(gm, xform(0, -0.058, 0))],
    // stock: buffer tube, sliding body, cheek riser, butt pad
    [rcyl(0.0155, 0.12, 0.003, 20), xform(0, lowMid + 0.02, 0.18, 0, A)],
    [box(0.014, 0.034, 0.05, 0.004), xform(0, lowMid - 0.002, 0.13)],
    [box(0.034, 0.062, 0.115, 0.012), xform(0, lowMid + 0.0, 0.245, 0, -0.04)],
    [box(0.02, 0.018, 0.1, 0.006), xform(0, lowMid + 0.036, 0.245)],
    [box(0.04, 0.108, 0.024, 0.01), xform(0, lowMid - 0.016, 0.31, 0, 0.1)],
  ];
  add(poly, m.poly, 0.1);
  // stock latch, rear sling plate + rubber butt pad
  add([[box(0.044, 0.112, 0.01, 0.005), xform(0, lowMid - 0.018, 0.322, 0, 0.1)]], m.rubber);
  add([[box(0.01, 0.016, 0.03, 0.003), xform(0, lowMid - 0.012, 0.15)]], m.steel, 1);

  // ---------- magazine (STANAG, curved) – separate for reload ----------
  const mag = new THREE.Group();
  const mp = [], mr = [];
  let y = 0, z = 0;
  for (let i = 0; i < 5; i++) {
    const th = i * 0.075, h = 0.027;
    const cy = y - Math.cos(th) * h / 2, cz = z - Math.sin(th) * h / 2;
    mp.push([box(0.0215, h + 0.0016, 0.059, 0.003), xform(0, cy, cz, 0, th)]);
    if (i < 5) mr.push([sb(0.0222, 0.0022, 0.0035), xform(0, cy, cz - 0.0295, 0, th)]);
    y -= Math.cos(th) * h; z -= Math.sin(th) * h;
  }
  mp.push([box(0.0262, 0.01, 0.066, 0.003), xform(0, y - 0.003, z + 0.0, 0, 0.36)]);
  mag.add(new THREE.Mesh(merge(mp, 0.1), m.poly));
  mag.add(new THREE.Mesh(merge(mr), m.dark));
  mag.position.copy(DIM.magWell).add(V(0, 0.0, 0));
  mag.position.y = DIM.magWell.y - 0.004;
  gun.add(mag);

  // ---------- sling: khaki webbing from the front swivel to the rear, hanging down ----------
  const sl = [[0, bore - 0.03, -0.345], [-0.02, -0.14, -0.3], [-0.055, -0.24, -0.2], [-0.07, -0.33, -0.05], [-0.05, -0.38, 0.1]];
  add(sl.slice(0, -1).map((p, i) => ribbon(p, sl[i + 1], 0.024, 0.0035)), m.webbing);
  add([[box(0.026, 0.03, 0.008, 0.002), xform(-0.056, -0.245, -0.2, 0.2)]], m.rubber);

  // ---------- Aimpoint-style optic furniture (the see-through tube itself is built in weapon.js) ----------
  add([
    [rcyl(0.0092, 0.014, 0.002, 20), xform(0, 0.0215, -0.035)],                    // elevation turret cap
    [rcyl(0.0092, 0.014, 0.002, 20), xform(0.0215, 0, -0.035, 0, 0, A)],           // windage turret cap
    [rcyl(0.0072, 0.012, 0.002, 16), xform(-0.0205, 0, -0.035, 0, 0, A)],          // battery / brightness cap
    [box(0.026, 0.024, 0.052, 0.004), xform(0, -0.0345, -0.03)],                    // body below the tube
    [box(0.036, 0.0092, 0.056, 0.003), xform(0, rail - 0.0046, -0.03)],             // QR mount base
    [rcyl(0.0042, 0.024, 0.0015, 12), xform(0.0245, rail - 0.0042, -0.03, 0, 0, A)],// QR lever pivot
    [box(0.006, 0.006, 0.026, 0.002), xform(0.036, rail - 0.0062, -0.03, 0, 0, 0.5)], // QR lever
    [box(0.004, 0.012, 0.02, 0.001), xform(-0.0195, rail - 0.009, -0.03)],          // clamp bolt side
  ], m.steel, 1);
  return { body, mag };
}
