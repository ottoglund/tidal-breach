// Procedurally modelled harbour props at real-world scale (metres).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cyl, rcyl, beam, tube, corrugated, plane, xform, catenary } from '../geo.js';
import { mat, plainMat } from '../materials.js';

function merged(list) {
  return mergeGeometries(list.map(([g, m]) => {
    let x = g.index ? g.toNonIndexed() : g.clone();
    if (m) x.applyMatrix4(m);
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
    return x;
  }), false);
}

export function lathe(profile, seg = 20) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, seg);
  let len = 0; for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
  const rMax = Math.max(...profile.map(p => p[0]));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * rMax, uv.getY(i) * len);
  return g;
}

// ---------------------------------------------------------------------------
// ISO 40 ft dry container: 12.192 x 2.438 x 2.591 m. Origin at floor centre, length along Z, doors at +Z.
// ---------------------------------------------------------------------------
export const CONTAINER = { L: 12.192, W: 2.438, H: 2.591 };
const containerGeo = {};
export function containerGeometry(lod = 0) {
  if (containerGeo[lod]) return containerGeo[lod];
  const { L, W, H } = CONTAINER;
  const paint = [], galv = [];
  const post = 0.16, rail = 0.13;
  const innerL = L - 2 * post, innerH = H - 2 * rail;
  // side walls, corrugation across the length
  const side = corrugated(innerL, innerH, 0.278, 0.036, 3, innerH);
  paint.push([side, xform(W / 2 - 0.03, H / 2, 0, Math.PI / 2)]);
  paint.push([side, xform(-W / 2 + 0.03, H / 2, 0, -Math.PI / 2)]);
  // front end wall (-Z), horizontal-ish corrugation
  const end = corrugated(W - 2 * post, innerH, 0.24, 0.03, 3, innerH);
  paint.push([end, xform(0, H / 2, -L / 2 + 0.04, Math.PI)]);
  // roof (dimpled roof sheet approximated with a shallow corrugation across the width)
  const roof = corrugated(innerL, W - 0.12, 0.6, 0.012, 3, W);
  paint.push([roof, xform(0, H - 0.07, 0, Math.PI / 2, -Math.PI / 2)]);
  // floor underside
  paint.push([box(W, 0.06, L), xform(0, 0.08, 0)]);
  // frame: corner posts, rails, castings
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    paint.push([box(post, H, post), xform(sx * (W / 2 - post / 2), H / 2, sz * (L / 2 - post / 2))]);
    for (const y of [0.059, H - 0.059]) paint.push([box(0.18, 0.118, 0.162), xform(sx * (W / 2 - 0.09), y, sz * (L / 2 - 0.081))]);
  }
  for (const sx of [-1, 1]) {
    paint.push([box(0.1, rail, innerL), xform(sx * (W / 2 - 0.05), H - rail / 2, 0)]);
    paint.push([box(0.16, 0.16, innerL), xform(sx * (W / 2 - 0.08), 0.08, 0)]);
  }
  for (const sz of [-1, 1]) {
    paint.push([box(W - 2 * post, rail, 0.12), xform(0, H - rail / 2, sz * (L / 2 - 0.06))]);
    paint.push([box(W - 2 * post, 0.2, 0.12), xform(0, 0.1, sz * (L / 2 - 0.06))]);
  }
  if (lod) {
    // distant/background boxes: doors as one corrugated panel, no locking gear
    paint.push([corrugated(W - 2 * post, innerH, 0.3, 0.02, 3, innerH), xform(0, H / 2, L / 2 - 0.035)]);
    containerGeo[lod] = { paint: merged(paint), galv: merged([[cyl(0.016, 0.016, H - 0.1, 6), xform(0.3, H / 2, L / 2 + 0.01)]]) };
    return containerGeo[lod];
  }
  // doors (+Z): two leaves with vertical corrugation and locking gear
  const leafW = (W - 2 * post) / 2 - 0.01;
  const leaf = corrugated(leafW, innerH - 0.06, 0.3, 0.02, 3, innerH);
  for (const s of [-1, 1]) {
    paint.push([leaf, xform(s * (leafW / 2 + 0.005), H / 2, L / 2 - 0.035)]);
    // 2 locking bars per leaf
    for (const bx of [0.18, leafW - 0.22]) {
      const x = s * (bx + 0.005);
      galv.push([cyl(0.016, 0.016, H - 0.1, 8), xform(x, H / 2, L / 2 + 0.01)]);
      for (const y of [0.32, H - 0.32]) galv.push([box(0.06, 0.08, 0.05), xform(x, y, L / 2 + 0.0)]);
      galv.push([box(0.03, 0.03, 0.22), xform(x + s * 0.05, 1.25, L / 2 + 0.06, 0, 0, 0)]);
      galv.push([box(0.12, 0.05, 0.04), xform(x + s * 0.07, 1.25, L / 2 + 0.03)]);
    }
    for (const y of [0.45, 1.3, H - 0.45, 1.95]) galv.push([box(0.07, 0.09, 0.05), xform(s * (W / 2 - post - 0.02), y, L / 2 + 0.02)]);
  }
  containerGeo[lod] = { paint: merged(paint), galv: merged(galv) };
  return containerGeo[lod];
}

export const CONTAINER_COLORS = ['container_rust', 'container_blue', 'container_green', 'container_grey', 'container_orange', 'container_white'];

/** Places all containers as instanced meshes. list: [{x,y,z,ry,color}] */
export function buildContainers(parent, list, lod = 0) {
  const geo = containerGeometry(lod);
  const byColor = new Map();
  for (const c of list) {
    const k = CONTAINER_COLORS[c.color % CONTAINER_COLORS.length];
    if (!byColor.has(k)) byColor.set(k, []);
    byColor.get(k).push(c);
  }
  const meshes = [];
  for (const [k, items] of byColor) {
    const m = new THREE.InstancedMesh(geo.paint, mat(k, { wet: 'surface' }), items.length);
    items.forEach((c, i) => m.setMatrixAt(i, xform(c.x, c.y, c.z, c.ry || 0)));
    m.castShadow = m.receiveShadow = true;
    m.computeBoundingSphere();
    parent.add(m); meshes.push(m);
  }
  // stencilled ID codes on doors and sides (instanced decals, atlas cell per container)
  const atlas = codeAtlas();
  const decalGeo = new THREE.PlaneGeometry(1.0, 0.5);
  const cells = new Float32Array(list.length * 3);
  const dmat = new THREE.MeshStandardMaterial({ map: atlas, transparent: true, alphaTest: 0.25, depthWrite: false, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 });
  dmat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCell;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (vMapUv + vec2(mod(aCell, 4.0), floor(aCell / 4.0))) * vec2(0.25, 0.25);\n#endif');
  };
  const decals = new THREE.InstancedMesh(decalGeo, dmat, list.length * 3);
  const { L, W, H } = CONTAINER;
  const lightPaint = new Set(['container_white', 'container_grey']);
  let di = 0;
  for (const c of list) {
    const cell = Math.floor(Math.abs(Math.sin(c.x * 12.9 + c.z * 78.2 + c.y * 3.1)) * 16) % 16;
    const base = xform(c.x, c.y, c.z, c.ry || 0);
    const col = lightPaint.has(CONTAINER_COLORS[c.color % CONTAINER_COLORS.length]) ? new THREE.Color(0.05, 0.05, 0.05) : new THREE.Color(0.85, 0.85, 0.82);
    for (const t of [xform(-0.55, H - 0.5, L / 2 + 0.03, 0, 0, 0, 0.9, 0.9, 1), xform(W / 2 + 0.008, H - 0.48, L / 2 - 1.3, Math.PI / 2, 0, 0, 1.3, 1.3, 1), xform(-W / 2 - 0.008, H - 0.48, -L / 2 + 1.3, -Math.PI / 2, 0, 0, 1.3, 1.3, 1)]) {
      decals.setMatrixAt(di, base.clone().multiply(t));
      decals.setColorAt(di, col);
      cells[di] = cell; di++;
    }
  }
  decals.geometry = decalGeo.clone();
  decals.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1));
  decals.computeBoundingSphere();
  parent.add(decals); meshes.push(decals);
  const g = new THREE.InstancedMesh(geo.galv, mat('galvanized'), list.length);
  list.forEach((c, i) => g.setMatrixAt(i, xform(c.x, c.y, c.z, c.ry || 0)));
  g.castShadow = true; g.receiveShadow = true; g.computeBoundingSphere();
  parent.add(g); meshes.push(g);
  return meshes;
}

// Fictional owner codes (ISO 6346 style) rendered as worn stencils.
let _atlas = null;
function codeAtlas() {
  if (_atlas) return _atlas;
  const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
  const g = c.getContext('2d');
  const owners = ['NSTU', 'HRBU', 'PLXU', 'TDLU', 'KVLU', 'BRSU', 'MRKU', 'OSLU'];
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 16; i++) {
    const x0 = (i % 4) * 512, y0 = Math.floor(i / 4) * 256;
    g.fillStyle = '#fff'; g.textBaseline = 'top';
    g.font = 'bold 74px Arial, Helvetica, sans-serif';
    g.fillText(`${owners[i % 8]} ${String(Math.floor(r() * 900000 + 100000))}`, x0 + 22, y0 + 26);
    g.font = 'bold 74px Arial, Helvetica, sans-serif';
    g.fillText(String(Math.floor(r() * 10)), x0 + 450, y0 + 26);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(x0 + 444, y0 + 22, 50, 82);
    g.font = 'bold 54px Arial, Helvetica, sans-serif';
    g.fillText(r() < 0.5 ? '45G1' : '42G1', x0 + 22, y0 + 128);
    g.font = '26px Arial, Helvetica, sans-serif';
    g.fillText('MAX.GROSS 32,500 KG', x0 + 200, y0 + 136);
    g.fillText('TARE 3,750 KG', x0 + 200, y0 + 172);
  }
  // wear: knock out speckles so the stencils look painted and weathered
  const img = g.getImageData(0, 0, 2048, 1024);
  for (let i = 0; i < img.data.length; i += 4) if (Math.random() < 0.22) img.data[i + 3] *= Math.random() * 0.6;
  g.putImageData(img, 0, 0);
  _atlas = new THREE.CanvasTexture(c);
  _atlas.colorSpace = THREE.SRGBColorSpace;
  _atlas.anisotropy = 8;
  return _atlas;
}

// ---------------------------------------------------------------------------
// Mooring bollard (tee-head cast iron) and fender.
// ---------------------------------------------------------------------------
export function bollardGeometry() {
  return merged([
    [lathe([[0, 0], [0.42, 0], [0.42, 0.05], [0.24, 0.08], [0.2, 0.18], [0.17, 0.55], [0.19, 0.6], [0.3, 0.64], [0.32, 0.7], [0.28, 0.76], [0, 0.78]], 22)],
    [box(0.75, 0.12, 0.2), xform(0, 0.62, 0)],
  ]);
}

// ---------------------------------------------------------------------------
// High-mast floodlight: 24 m galvanised pole, head ring with floodlights.
// Returns {geos:{galv,dark,glass}, heads:[{pos, dir}]}
// ---------------------------------------------------------------------------
export function lightMast(x, z, facings, height = 22) {
  const galv = [], dark = [], glass = [];
  galv.push([cyl(0.16, 0.34, height, 14), xform(x, height / 2, z)]);
  galv.push([cyl(0.55, 0.55, 0.05, 16), xform(x, 0.025, z)]);
  dark.push([box(1.0, 0.4, 1.0), xform(x, 0.2, z)]); // foundation collar
  galv.push([cyl(1.05, 1.05, 0.12, 20, true), xform(x, height, z)]);
  galv.push([cyl(0.25, 0.25, 0.5, 10), xform(x, height + 0.1, z)]);
  // service ladder rungs
  for (let y = 2.5; y < height - 1; y += 0.32) galv.push([box(0.4, 0.025, 0.025), xform(x + 0.32, y, z)]);
  galv.push([box(0.025, height - 3.5, 0.025), xform(x + 0.32 + 0.2, (height + 1.5) / 2, z)]);
  galv.push([box(0.025, height - 3.5, 0.025), xform(x + 0.32 - 0.2, (height + 1.5) / 2, z)]);
  const heads = [];
  for (const ang of facings) {
    const dx = Math.sin(ang), dz = Math.cos(ang);
    const hx = x + dx * 1.05, hz = z + dz * 1.05, hy = height - 0.2;
    const m = xform(hx, hy, hz, ang, 0.55);
    dark.push([box(0.62, 0.42, 0.18), m]);
    dark.push([box(0.66, 0.06, 0.24), m.clone().multiply(xform(0, 0.23, 0.02))]);
    glass.push([plane(0.54, 0.34), m.clone().multiply(xform(0, 0, 0.095))]);
    // aim: tilt down ~55 deg
    const dir = new THREE.Vector3(dx, -1.3, dz).normalize();
    heads.push({ pos: new THREE.Vector3(hx + dx * 0.15, hy - 0.15, hz + dz * 0.15), dir });
  }
  return { galv, dark, glass, heads };
}

// ---------------------------------------------------------------------------
// Rubber-tyred gantry crane spanning container lanes. Legs at x0..x1, at z.
// ---------------------------------------------------------------------------
export function rtgCrane(x0, x1, z, height = 19) {
  const y = [], dark = [], rubber = [], glass = [];
  const legW = 0.9, half = 3.2;
  for (const x of [x0, x1]) {
    for (const s of [-1, 1]) {
      y.push([box(legW, height, legW * 1.1), xform(x, height / 2 + 1.2, z + s * half)]);
      // bogie wheels
      for (const w of [-0.55, 0.55]) rubber.push([rcyl(0.55, 0.45, 0.09, 40), xform(x, 0.55, z + s * half + w, 0, 0, Math.PI / 2)]);
      dark.push([box(0.7, 0.5, 2.0), xform(x, 1.2, z + s * half)]);
    }
    y.push([box(1.1, 1.2, half * 2 + 1.2), xform(x, height + 1.2, z)]); // top sill
    y.push([box(0.7, 0.7, half * 2), xform(x, 2.2, z)]);               // lower sill
    y.push([beam([x, 2.4, z - half], [x, height, z + half], 0.28)]);
    y.push([beam([x, 2.4, z + half], [x, height, z - half], 0.28)]);
  }
  for (const s of [-1, 1]) y.push([box(Math.abs(x1 - x0) + 2, 1.5, 0.8), xform((x0 + x1) / 2, height + 2.2, z + s * half)]);
  // trolley + cabin + spreader on ropes
  const tx = x0 + (x1 - x0) * 0.62;
  y.push([box(3.2, 1.6, half * 2 + 0.6), xform(tx, height + 3.6, z)]);
  dark.push([box(1.8, 2.0, 2.0), xform(tx - 2.4, height + 0.5, z - half + 1.4)]);
  glass.push([plane(1.6, 1.0), xform(tx - 2.4, height + 0.7, z - half + 2.41)]);
  const spY = 9.5;
  for (const a of [-1, 1]) for (const b of [-1, 1]) dark.push([cyl(0.02, 0.02, height + 2.8 - spY, 4), xform(tx + a * 1.0, (height + 2.8 + spY) / 2, z + b * 1.0)]);
  y.push([box(2.5, 0.35, 6.2), xform(tx, spY, z)]);
  // machinery house
  dark.push([box(3.5, 2.4, 2.4), xform(x0 + 2.5, height + 3.3, z)]);
  return { yellow: y, dark, rubber, glass };
}

// ---------------------------------------------------------------------------
// Feeder container ship hull, lofted from sections. Bow toward -Z.
// ---------------------------------------------------------------------------
export function shipHull(cx, cz, length = 96, beamW = 17, depth = 10, draft = 5.5, waterY = -2.2) {
  // Lofted hull: each station is a section with vertical topsides, a round bilge
  // and a flat bottom. Fine entrance at the bow (-Z), transom stern at +Z.
  const stations = 64, z0 = cz + length / 2, z1 = cz - length / 2;
  const keelY = waterY - draft, deckY = keelY + depth;
  const section = (t) => {
    // t: 0 stern -> 1 bow
    let half = beamW / 2;
    if (t > 0.62) half *= Math.pow(Math.max(0, 1 - Math.pow((t - 0.62) / 0.38, 2.2)), 0.55);
    if (t < 0.06) half *= 0.86 + 0.14 * (t / 0.06);
    half = Math.max(half, 0.12);
    let bottom = keelY;
    if (t > 0.86) bottom += Math.pow((t - 0.86) / 0.14, 1.6) * depth * 0.55; // forefoot rises
    if (t < 0.08) bottom += Math.pow((0.08 - t) / 0.08, 1.4) * depth * 0.45; // stern overhang
    const sheer = deckY + Math.pow(Math.max(0, t - 0.75) / 0.25, 2) * 2.2 + Math.pow(Math.max(0, 0.12 - t) / 0.12, 2) * 0.8;
    const bilgeR = Math.min(1.8, half * 0.6, (sheer - bottom) * 0.4);
    const pts = []; // from port deck edge around to starboard deck edge
    pts.push([-half, sheer]);
    pts.push([-half, bottom + bilgeR]);
    for (let k = 1; k < 6; k++) { const a = Math.PI + (k / 6) * Math.PI / 2; pts.push([-half + bilgeR + Math.cos(a) * bilgeR, bottom + bilgeR + Math.sin(a) * bilgeR]); }
    pts.push([-half + bilgeR, bottom]); pts.push([0, bottom]); pts.push([half - bilgeR, bottom]);
    for (let k = 1; k < 6; k++) { const a = 1.5 * Math.PI + (k / 6) * Math.PI / 2; pts.push([half - bilgeR + Math.cos(a) * bilgeR, bottom + bilgeR + Math.sin(a) * bilgeR]); }
    pts.push([half, bottom + bilgeR]); pts.push([half, sheer]);
    return pts;
  };
  const pos = [], uv = [], idx = [];
  const nAround = section(0.5).length;
  for (let i = 0; i <= stations; i++) {
    const t = i / stations, z = z0 + (z1 - z0) * t;
    const sec = section(t);
    let arc = 0;
    for (let j = 0; j < sec.length; j++) {
      if (j) arc += Math.hypot(sec[j][0] - sec[j - 1][0], sec[j][1] - sec[j - 1][1]);
      pos.push(cx + sec[j][0], sec[j][1], z);
      uv.push(z0 - z, arc);
    }
  }
  for (let i = 0; i < stations; i++) for (let j = 0; j < nAround - 1; j++) {
    const a = i * nAround + j, b = a + nAround;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // transom (flat stern plate)
  const s0 = section(0), base = pos.length / 3;
  for (const [x, y] of s0) { pos.push(cx + x, y, z0); uv.push(x, y); }
  pos.push(cx, deckY, z0); uv.push(0, deckY);
  for (let j = 0; j < s0.length - 1; j++) idx.push(base + j, base + s0.length, base + j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, deckY, z0, z1 };
}

export { box, cyl, beam, tube, corrugated, plane, xform, catenary, merged, plainMat };
