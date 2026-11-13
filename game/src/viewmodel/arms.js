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
 * occlusion from the baked cavity term (also used as a bump so folds and creases read), stitched seams (sharp lines
 * with a small groove and lighter dashed thread), the padded knuckle strip (raised, slightly darker, outlined), a
 * band-limited cordura basket weave, the pebbled synthetic-leather palm (darker, satin), a grazing-angle fabric sheen,
 * and the sleeve tab.
 */
export function armShading(m, kind) {
  const glove = kind === 'glove';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aux;\nvarying vec4 vAux;\nvarying vec2 vArmUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAux = aux; vArmUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vAux;\nvarying vec2 vArmUv;\nfloat armH = 0.0, armSeam = 0.0, armPad = 0.0, armWeave = 0.5, armPalm = 0.0;\n${BUMP}`)
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
        // macro wear: faded, dusty patches (5 cm) and darker oily grime (2 cm) so the cordura is not a uniform colour
        vec2 q = vArmUv * 20.0;
        vec2 iq = floor(q), fq = fract(q); fq = fq * fq * (3.0 - 2.0 * fq);
        float h00 = fract(sin(dot(iq, vec2(127.1, 311.7))) * 43758.5453), h10 = fract(sin(dot(iq + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
        float h01 = fract(sin(dot(iq + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453), h11 = fract(sin(dot(iq + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
        float mac = mix(mix(h00, h10, fq.x), mix(h01, h11, fq.x), fq.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.12, 1.05) + vec3(0.02, 0.018, 0.012), smoothstep(0.6, 0.95, mac) * 0.5);
        diffuseColor.rgb *= 1.0 - 0.25 * smoothstep(0.55, 0.0, mac) * (1.0 - palm);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))), 0.18);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.1, 1.0) + 0.012, armPad * 0.35 * (1.0 - palm));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.035), (1.0 - ao) * 0.35);
        // stitches: lighter thread dashes riding in the seam groove
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.7 + 0.015, armSeam * dash * 0.45);
        // 1000D cordura basket weave (0.9 mm pitch) on the shell, pebbled synthetic leather on the palm; both
        // band-limited (fade out once a period shrinks to ~a pixel so they never shimmer)
        vec2 wq = vArmUv / 0.0009;
        float wfw = max(fwidth(wq.x), fwidth(wq.y));
        float wv = sin(wq.x * 6.2832) * sin(wq.y * 6.2832);
        float weave = (0.5 + 0.5 * sign(wv) * pow(abs(wv), 0.6)) * (1.0 - smoothstep(0.25, 0.6, wfw));
        vec2 lq = vArmUv / 0.0012, li = floor(lq), lf = fract(lq);
        float peb = 1.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 c = vec2(float(i), float(j));
          vec2 o = vec2(fract(sin(dot(li + c, vec2(127.1, 311.7))) * 43758.5453), fract(sin(dot(li + c, vec2(269.5, 183.3))) * 43758.5453));
          peb = min(peb, length(c + o - lf));
        }
        float pebble = smoothstep(0.0, 0.7, peb) * (1.0 - smoothstep(0.25, 0.6, max(fwidth(lq.x), fwidth(lq.y))));
        armWeave = weave; armPalm = palm;
        diffuseColor.rgb *= 1.0 - 0.12 * (weave - 0.5) * (1.0 - palm) - 0.15 * pebble * palm;
        armH = -0.00045 * l1 + 0.0007 * smoothstep(0.0, -0.0015, s2) - 0.0003 * l2
             + 0.00005 * weave * (1.0 - palm) - 0.00006 * pebble * palm   // weave / grain relief
             - 0.0012 * (1.0 - ao);                                       // fabric pulled into the folds and creases
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
      roughnessFactor = clamp(roughnessFactor * (1.0 - 0.15 * armPad${glove ? ' - 0.1 * (armWeave - 0.5)' : ''}), 0.3, 1.0);
      ${glove ? 'roughnessFactor = mix(roughnessFactor, 0.5, armPalm * 0.8);          // leather palm: satin' : ''}`)
      .replace('#include <opaque_fragment>', `
      {
        // fabric / leather sheen: grazing-angle lift scaled by the light already reaching the surface, so the glove
        // reads as cloth in the dark viewmodel lighting instead of a flat matte shape
        float nv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        float rim = pow(1.0 - nv, 3.0);
        float lum = dot(outgoingLight, vec3(0.3, 0.55, 0.15));
        outgoingLight += mix(diffuseColor.rgb, vec3(0.5), 0.4) * rim * ${glove ? '(0.25 + 0.25 * armPalm)' : '0.15'} * (0.4 + 2.5 * lum);
      }
      #include <opaque_fragment>`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      reflectedLight.indirectDiffuse *= 0.55 + 0.45 * vAux.x;
      reflectedLight.indirectSpecular *= 0.5 + 0.5 * vAux.x;`);
  };
  m.customProgramCacheKey = () => 'arm2' + kind;
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
