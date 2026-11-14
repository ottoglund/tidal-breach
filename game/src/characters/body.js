// Clothed soldier body built offline from the MakeHuman CC0 base mesh (tools/mh/build_soldier.py ->
// game/assets/models/soldier_body.bin; provenance and licence in docs/ASSETS.md).
//
// File layout (little endian): 'TBMH', u32 version, u32 json byte length, JSON header, binary blob.
// The header lists the 19 game bones (identity-rest position, bind position + bind orientation), measurements used
// to refit the procedural gear, and two LODs ('close', 'far'), each with typed attribute arrays at blob offsets:
// position f32x3, normal i16x3 (normalised), uv f32x2 (metres), skinIndex u8x4, skinWeight u8x4 (normalised),
// index u16, plus material groups (camo, knit, gaiter, boot, sole, eye, glove, skin, and the bare-head variant face,
// hair; soldier.js picks one head per soldier kind).
//
// The mesh is stored in MakeHuman's A pose (= bind pose). Every bone also has an identity-rest position (arms
// hanging, legs straight), which is what the pose / IK code in enemies.js works in; soldier.js binds the skeleton in
// the A pose and then resets the bones to identity, so the existing animation code is unchanged.
import * as THREE from 'three';

const URL_BODY = 'assets/models/soldier_body.bin';
let BODY = null;

const TYPES = { f32: Float32Array, i16: Int16Array, u16: Uint16Array, u8: Uint8Array };

/** Parse a 'TBMH' container (also used by the first-person arms, viewmodel/arms.js). */
export function parseTBMH(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'TBMH') throw new Error('TBMH: bad magic');
  const jl = dv.getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jl)));
  const base = 12 + jl;
  const lods = {};
  for (const L of head.lods) {
    const attrs = {};
    for (const [name, a] of Object.entries(L.attributes)) {
      const T = TYPES[a.type];
      attrs[name] = new THREE.BufferAttribute(new T(buf, base + a.offset, L.vertexCount * a.itemSize), a.itemSize, a.normalized);
    }
    const index = new THREE.BufferAttribute(new Uint16Array(buf, base + L.index.offset, L.indexCount), 1);
    lods[L.name] = { attrs, index, groups: L.groups };
  }
  return { ...head, lods };
}

/** Load the body asset (called once from the boot sequence before the level is built). Resolves to true / false. */
export function loadSoldierBody() {
  return new Promise((resolve) => {
    const loader = new THREE.FileLoader();
    loader.setResponseType('arraybuffer');
    loader.load(URL_BODY, (buf) => {
      try { BODY = parseTBMH(buf); resolve(true); } catch (e) { console.warn('soldier body: parse failed, procedural fallback', e); resolve(false); }
    }, undefined, () => { console.warn('soldier body: not loaded, procedural fallback'); resolve(false); });
  });
}

/** Use an already loaded file (offline tools / tests). */
export function setSoldierBody(buf) { BODY = parseTBMH(buf); }

/** The parsed body (null until loaded or when loading failed -> soldier.js falls back to the procedural body). */
export const soldierBody = () => BODY;
