// First-person arms built offline from the MakeHuman CC0 base mesh (tools/mh/build_arms.py ->
// game/assets/models/viewmodel_arms.bin; provenance and licence in docs/ASSETS.md).
//
// The file is a 'TBMH' container (characters/body.js) with one static mesh per arm ('right', 'left'), already posed
// in gun space (viewmodel/rifle.js): right hand closed on the pistol grip, left hand under the handguard. Groups:
// 'glove' (cordura glove), 'sleeve' (M90 sleeve with cuff and inner lip). Per vertex 'aux' (u8 x 4, normalised):
//   glove : x = cavity / contact occlusion, y = signed seam field (0.5 = on the finger side seams), z = signed
//           knuckle-strip field (< 0.5 inside the padded strip, 0.5 = its stitched outline), w = palm (suede) mask
//   sleeve: x = occlusion, y = signed stitch field (0.5 = on the cuff hem stitching / tab outline), z = tab mask
// If the file is missing, weapon.js keeps the procedural hands (viewmodel/hands.js).
import * as THREE from 'three';
import { parseTBMH } from '../characters/body.js';

const URL_ARMS = 'assets/models/viewmodel_arms.bin';
let ARMS = null;

/** Load the arms asset (boot sequence). Resolves to true / false; never rejects. */
export function loadViewmodelArms() {
  return new Promise((resolve) => {
    const loader = new THREE.FileLoader();
    loader.setResponseType('arraybuffer');
    loader.load(URL_ARMS, (buf) => {
      try { ARMS = parseTBMH(buf); resolve(true); } catch (e) { console.warn('viewmodel arms: parse failed, procedural hands', e); resolve(false); }
    }, undefined, () => { console.warn('viewmodel arms: not loaded, procedural hands'); resolve(false); });
  });
}

/** Use an already loaded file (offline tools / tests). */
export function setViewmodelArms(buf) { ARMS = parseTBMH(buf); }
export const viewmodelArms = () => ARMS;

// small bump-mapping helper (same maths as three's perturbNormalArb, own copy so no bump map is needed)
const BUMP = /* glsl */`
vec3 armBump(vec3 p, vec3 n, float h, float fd) {
  vec3 dx = dFdx(p), dy = dFdy(p);
  vec3 r1 = cross(dy, n), r2 = cross(n, dx);
  float det = dot(dx, r1) * fd;
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - g);
}
float armLine(float s, float halfW) {          // anti-aliased line on the zero crossing of a linear field s
  float w = max(fwidth(s), 1e-5);
  return 1.0 - smoothstep(halfW, halfW + 1.5 * w, abs(s));
}`;

/**
 * Glove / sleeve shading on top of a MeshStandardMaterial with the cordura / camo texture set:
 * occlusion from the baked cavity term, stitched seams (sharp lines with a small groove and dashed thread), the padded
 * knuckle strip (raised, slightly darker, outlined), the suede palm (darker, smoother) and the sleeve tab.
 */
export function armShading(m, kind) {
  const glove = kind === 'glove';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aux;\nvarying vec4 vAux;\nvarying vec2 vArmUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAux = aux; vArmUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vAux;\nvarying vec2 vArmUv;\nfloat armH = 0.0, armSeam = 0.0, armPad = 0.0;\n${BUMP}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float ao = vAux.x;
        ${glove ? `
        float s1 = (vAux.y - 0.5) / 30.0;                         // metres from the finger side seam
        float s2 = (vAux.z - 0.5) / 30.0;                         // metres from the knuckle-strip outline (< 0 inside)
        float l1 = armLine(s1, 0.0006), l2 = armLine(s2, 0.0005);
        armPad = smoothstep(0.0004, -0.0006, s2);
        armSeam = max(l1, l2);
        float dash = step(0.45, fract((vArmUv.x * 0.7 + vArmUv.y) * 380.0));
        float palm = vAux.w;
        // suede palm: darker, browner; padded strip: denser, darker coating; seams: shadowed groove with lighter thread
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.6, 0.52), palm);
        diffuseColor.rgb *= mix(1.0, 0.72, armPad);
        diffuseColor.rgb *= 1.0 - 0.55 * armSeam * (1.0 - 0.5 * dash);
        // wear: polished, lighter fabric on the knuckle strip and along the seams; grime in the hollows
        float wn = fract(sin(dot(floor(vArmUv * 260.0), vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb *= mix(1.0, 0.9 + 0.2 * wn, 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.1, 1.0) + 0.012, armPad * 0.35 * (1.0 - palm));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.035), (1.0 - ao) * 0.35);
        armH = -0.00045 * l1 + 0.0007 * smoothstep(0.0, -0.0015, s2) - 0.0003 * l2;
        ` : `
        float s1 = (vAux.y - 0.5) / 30.0;                         // metres from the hem stitching / tab outline
        float l1 = armLine(s1, 0.0005);
        float dash = step(0.4, fract(vArmUv.x * 300.0 + vArmUv.y * 40.0));
        armSeam = l1;
        diffuseColor.rgb *= mix(1.0, 0.8, vAux.z);                // hook-and-loop tab
        diffuseColor.rgb *= 1.0 - 0.45 * l1 * (1.0 - 0.7 * dash);
        armH = -0.0003 * l1;
        `}
        diffuseColor.rgb *= 0.35 + 0.65 * ao;
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = armBump(-vViewPosition, normal, armH, faceDirection);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor * (1.0 - 0.15 * armPad${glove ? ' - 0.12 * vAux.w' : ''}), 0.3, 1.0);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      reflectedLight.indirectDiffuse *= 0.55 + 0.45 * vAux.x;
      reflectedLight.indirectSpecular *= 0.5 + 0.5 * vAux.x;`);
  };
  m.customProgramCacheKey = () => 'arm1' + kind;
  return m;
}

/** Build the two arms (THREE.Group each, gun space) from the loaded asset. mats: { glove, sleeve } (armShading applied). */
export function buildArms(mats) {
  const A = ARMS;
  if (!A) return null;
  const make = (L) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(L.attrs)) g.setAttribute(name, attr);
    g.setIndex(L.index);
    L.groups.forEach((gr) => g.addGroup(gr.start, gr.count, gr.name === 'glove' ? 0 : 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, [mats.glove, mats.sleeve]);
    const grp = new THREE.Group();
    grp.add(mesh);
    return grp;
  };
  return { right: make(A.lods.right), left: make(A.lods.left), info: A.info, triangles: A.triangles };
}
