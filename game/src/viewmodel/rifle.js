// Ak 4C (Swedish H&K G3 derivative, 7.62x51) geometry with an Aimpoint red dot on the Picatinny rail.
// Gun space: origin = centre of the red-dot tube, barrel toward -Z, +X right, +Y up. Real scale:
// ~0.92 m overall (stock closed, flash hider tip at z -0.585, butt pad at z +0.335).
import * as THREE from 'three';
import { box, rcyl } from '../geo.js';
import { xform } from '../geo.js';
import { merge, V, profileLathe } from './parts.js';

export const DIM = {
  rail: -0.047,            // top of the Picatinny rail
  bore: -0.068,            // barrel axis
  recvTop: -0.056,
  recvMid: -0.080,         // stamped receiver centre
  lowMid: -0.122,          // trigger housing centre
  grip: new THREE.Vector3(0, -0.176, 0.07), // pistol grip centre
  gripTilt: -0.3,          // rotation about X: bottom of grip leans back toward the shooter
  magWell: new THREE.Vector3(0, -0.118, -0.068), // top of the seated magazine (group origin)
  hgZ0: -0.12, hgZ1: -0.40,
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
  const hgMid = (hgZ0 + hgZ1) / 2;

  // ---------- metal: stamped receiver, rail, barrel, hider (matte phosphate, bare metal on edges) ----------
  const metal = [
    // stamped receiver (G3 profile: tall rounded-rectangle tube, closed rear cap, slightly stepped front)
    [box(0.034, 0.046, 0.25, 0.009), xform(0, recvMid, -0.005)],
    [box(0.030, 0.014, 0.236, 0.005), xform(0, recvTop - 0.003, -0.005)],
    [box(0.036, 0.040, 0.012, 0.004), xform(0, recvMid - 0.002, 0.121)],          // rear cap
    [box(0.0355, 0.034, 0.010, 0.004), xform(0, recvMid - 0.003, -0.13)],           // front collar where the handguard meets it
    // top Picatinny rail with cross slots
    [box(0.024, 0.0075, 0.24, 0.001), xform(0, rail - 0.0035, 0.0)],
    ...Array.from({ length: 16 }, (_, i) => [sb(0.0245, 0.0032, 0.0055), xform(0, rail - 0.0004, 0.108 - i * 0.0145)]),
    // pressed side beads (the stamped-sheet look) + ejection-port deflector hump (right)
    [sb(0.0016, 0.004, 0.17), xform(0.0172, recvMid - 0.014, -0.02)],
    [sb(0.0016, 0.004, 0.17), xform(-0.0172, recvMid - 0.014, -0.02)],
    [box(0.004, 0.016, 0.03, 0.002), xform(0.0185, recvMid + 0.008, 0.062, -0.2)],
    // magazine well: flat-sided steel block under the receiver
    [box(0.036, 0.06, 0.07, 0.005), xform(0, -0.1295, -0.066)],
    [box(0.039, 0.007, 0.074, 0.003), xform(0, -0.1575, -0.066)],                    // flared lip at the mouth
    // trigger guard bow
    [box(0.0125, 0.0042, 0.074, 0.0015), xform(0, -0.1535, 0.012)],
    [box(0.0125, 0.026, 0.0045, 0.0015), xform(0, -0.1415, -0.0245)],
    [box(0.0125, 0.024, 0.0045, 0.0015), xform(0, -0.1425, 0.0485)],
    [box(0.006, 0.026, 0.008, 0.002), xform(0, -0.138, 0.002, 0, 0.22)],             // trigger blade
    // paddle magazine release: flat tab behind the well, wrapping round the housing sides
    [box(0.038, 0.0035, 0.026, 0.001), xform(0, -0.1535, -0.0245 + 0.0, 0, 0.0)],
    [box(0.0035, 0.016, 0.024, 0.001), xform(0.0185, -0.147, -0.0245)],
    [box(0.0035, 0.016, 0.024, 0.001), xform(-0.0185, -0.147, -0.0245)],
    // push-pins: right-side heads + left-side retaining clips (trigger group + stock)
    [rcyl(0.0058, 0.006, 0.0015, 14), xform(0.0185, lowMid + 0.012, 0.102, 0, 0, A)],
    [rcyl(0.0058, 0.006, 0.0015, 14), xform(0.0185, lowMid + 0.012, -0.03, 0, 0, A)],
    [box(0.003, 0.006, 0.014, 0.001), xform(-0.0185, lowMid + 0.012, 0.102)],
    [box(0.003, 0.006, 0.014, 0.001), xform(-0.0185, lowMid + 0.012, -0.03)],
    // fire selector (left): disc + lever
    [rcyl(0.0075, 0.004, 0.0015, 16), xform(-0.0185, lowMid + 0.006, 0.042, 0, 0, A)],
    [box(0.003, 0.006, 0.028, 0.001), xform(-0.0215, lowMid + 0.006, 0.054)],
    // cocking-lever tube (left, above the barrel) with the folding cocking handle
    [rcyl(0.0066, 0.272, 0.0012, 14), xform(-0.0205, bore + 0.0155, hgZ0 - 0.136 + 0.01, 0, A)],
    [rcyl(0.0074, 0.012, 0.002, 14), xform(-0.0205, bore + 0.0155, hgZ1 - 0.004, 0, A)],         // tube end cap
    [rcyl(0.0052, 0.0075, 0.0012, 12), xform(-0.0285, bore + 0.0155, -0.205, 0, 0, A)],          // handle pivot boss
    [box(0.004, 0.006, 0.036, 0.0015), xform(-0.0325, bore + 0.0155, -0.222)],                    // folded handle (lies along the tube)
    [box(0.0045, 0.0085, 0.008, 0.002), xform(-0.0325, bore + 0.0155, -0.242)],                   // handle knob
    // barrel stub, front sight block with hood and post
    [rcyl(0.0095, 0.09, 0.001, 20), xform(0, bore, -0.445, 0, A)],
    [box(0.021, 0.021, 0.03, 0.004), xform(0, bore + 0.0075, -0.472)],
    [box(0.0035, 0.024, 0.026, 0.001), xform(-0.0085, bore + 0.024, -0.472)],       // hood sides
    [box(0.0035, 0.024, 0.026, 0.001), xform(0.0085, bore + 0.024, -0.472)],
    [box(0.021, 0.0032, 0.026, 0.001), xform(0, bore + 0.0365, -0.472)],            // hood top
    [sb(0.0016, 0.024, 0.0016), xform(0, bore + 0.0235, -0.4695)],                  // front sight post
    // G3-style flash hider: base collar, slotted cage, front ring
    [rcyl(0.0128, 0.012, 0.002, 20), xform(0, bore, -0.499, 0, A)],
    [rcyl(0.0142, 0.066, 0.0025, 24), xform(0, bore, -0.5415, 0, A)],
    [rcyl(0.0147, 0.007, 0.0015, 24), xform(0, bore, -0.5805, 0, A)],
    // front sling swivel: lug + ring under the handguard end
    [box(0.01, 0.01, 0.012, 0.002), xform(0, bore - 0.0245, hgZ1 + 0.02)],
    [new THREE.TorusGeometry(0.0075, 0.0016, 5, 12), xform(0, bore - 0.0385, hgZ1 + 0.02, A)],
    // side rails on the handguard (short Picatinny stubs) and the retaining ring at its front
    ...[-1, 1].flatMap(s => Array.from({ length: 5 }, (_, i) => [sb(0.0034, 0.011, 0.0065), xform(s * 0.0245, bore - 0.004, hgZ0 - 0.095 - i * 0.0158)])),
    [box(0.043, 0.043, 0.01, 0.004), xform(0, bore, hgZ1 + 0.006)],
    // rear sling attachment on the stock plate
    [box(0.01, 0.016, 0.03, 0.003), xform(0, lowMid - 0.002, 0.15)],
  ];
  const body = add(metal, m.steel, 1);

  // handguard: slim ventilated polymer tube; slots rendered as dark through-cuts
  add([
    [box(0.043, 0.042, 0.28, 0.012), xform(0, bore, hgMid)],
    [box(0.04, 0.012, 0.03, 0.004), xform(0, bore - 0.003, hgZ0 + 0.015)],
  ], m.poly, 0.12);
  add([
    ...[-1, 1].flatMap(s => Array.from({ length: 9 }, (_, i) => [sb(0.0016, 0.0085, 0.0155), xform(s * 0.0218, bore + 0.002, hgZ0 - 0.05 - i * 0.0245)])),
    ...Array.from({ length: 6 }, (_, i) => [sb(0.0105, 0.0016, 0.012), xform(0, bore - 0.0215, hgZ0 - 0.07 - i * 0.03)]),
    // ejection port, muzzle bore, magazine-well shadow, hider slots, optic-mount shadow, pressed grooves
    [sb(0.0016, 0.019, 0.06), xform(0.0176, recvMid + 0.008, 0.02)],
    [rcyl(0.0066, 0.002, 0, 14), xform(0, bore, -0.5845, 0, A)],
    ...Array.from({ length: 3 }, (_, i) => [sb(0.0042, 0.0305, 0.048), xform(0, bore, -0.5415, 0, 0, i * Math.PI / 3)]),
    [sb(0.0168, 0.0016, 0.05), xform(0, -0.1595, -0.066)],
  ], m.dark);
  // trigger housing + lower body (polymer)
  const gripProfile = [[0.0001, -0.056], [0.0105, -0.054], [0.0135, -0.044], [0.0145, -0.02], [0.0142, 0.0], [0.0155, 0.02], [0.0165, 0.04], [0.0165, 0.05], [0.0001, 0.052]];
  const gripG = profileLathe(gripProfile, 1.0, 1.4, 20);
  const gm = new THREE.Matrix4().compose(grip, new THREE.Quaternion().setFromEuler(new THREE.Euler(gripTilt, 0, 0)), V(1, 1, 1));
  add([
    [box(0.033, 0.046, 0.176, 0.009), xform(0, lowMid + 0.001, 0.03)],
    [gripG, gm],
    [box(0.034, 0.012, 0.04, 0.004), new THREE.Matrix4().multiplyMatrices(gm, xform(0, -0.058, 0))],
    // Ak 4C stock: adjustable steel tube, sliding polymer body, cheek riser, butt
    [box(0.030, 0.044, 0.08, 0.008), xform(0, recvMid - 0.004, 0.17)],
    [box(0.036, 0.074, 0.11, 0.012), xform(0, recvMid - 0.006, 0.245, 0, -0.05)],
    [box(0.022, 0.016, 0.105, 0.006), xform(0, recvMid + 0.033, 0.245, 0, -0.05)],        // cheek riser
    [box(0.04, 0.114, 0.024, 0.01), xform(0, recvMid - 0.012, 0.318, 0, 0.1)],
  ], m.poly, 0.1);
  add([[box(0.044, 0.118, 0.012, 0.005), xform(0, recvMid - 0.012, 0.333, 0, 0.1)]], m.rubber);   // butt pad
  add([
    [rcyl(0.0132, 0.07, 0.002, 18), xform(0, recvMid - 0.001, 0.145, 0, A)],                   // sliding stock tube
    [box(0.039, 0.006, 0.012, 0.002), xform(0, recvMid - 0.045, 0.19)],                        // length-adjust latch
  ], m.steel, 1);

  // ---------- magazine: STRAIGHT stamped-steel 20-round 7.62 (separate for the reload) ----------
  const mag = new THREE.Group();
  const H = 0.17;                                                                // length below the origin
  mag.add(new THREE.Mesh(merge([
    [box(0.0235, H, 0.052, 0.003), xform(0, -H / 2, 0)],
    [box(0.0262, 0.012, 0.056, 0.003), xform(0, -H - 0.003, 0)],                // floorplate
    [box(0.0215, 0.004, 0.058, 0.001), xform(0, -0.001, 0.0)],                   // feed-lip crown
    // stiffening beads (proud ribs) down the sides and front
    ...[-1, 1].flatMap(s => [-0.014, 0.014].map(z => [sb(0.0008, H - 0.016, 0.0035), xform(s * 0.01185, -H / 2 - 0.003, z)])),
    [sb(0.0045, H - 0.02, 0.0012), xform(0, -H / 2 - 0.003, -0.0262)],
  ], 0.9), m.steel));
  mag.add(new THREE.Mesh(merge([
    ...[0.03, 0.055, 0.08, 0.105].map(y => [rcyl(0.0022, 0.0012, 0, 8), xform(-0.01205, -y, 0.002, 0, 0, A)]),   // round-count holes
    ...[0.02, 0.038, 0.056].map(y => [sb(0.0236, 0.0012, 0.0016), xform(0, -H + y * 0.5, -0.0268)]),
  ]), m.dark));
  mag.position.copy(DIM.magWell);
  gun.add(mag);

  // ---------- sling: khaki webbing from the front swivel to the rear, hanging down ----------
  const sl = [[0, bore - 0.0385, hgZ1 + 0.02], [-0.02, -0.14, -0.33], [-0.055, -0.24, -0.22], [-0.07, -0.33, -0.05], [-0.05, -0.38, 0.1]];
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
