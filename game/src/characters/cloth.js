// Fabric / leather shading layered on top of the shared wet-surface material (materials.js addWet):
//  - dirt: mud/dust gradient from the ground up (rest-pose height, so it stays on the legs while the soldier
//    moves), broken by hash noise plus splash flecks; wet mud is glossier than dry cloth
//  - rain: wet cloth darkens and saturates (water fills the gaps between the fibres, less light is scattered back
//    out of the weave) and gets a little glossier; `wetTop` adds a darker, glossier band on up-facing surfaces
//    (shoulders, hood, rig top) that the rain hits first
//  - roughness variation: low-frequency noise so cloth is not uniformly matte (worn/polished patches)
//  - fabric sheen: a Charlie sheen lobe per light (fibre retro / grazing scattering: the soft rim of cloth against a
//    lamp behind it) plus the same lobe under the ambient / bounce light; no fixed rim term
//  - rain film: thin everywhere exposed, continuous on tops, running streaks; beads on water-repellent gear (`beads`)
//  - drape: a soft ~5 cm rumple bump (replaces the old 1.2 cm cross-hatch, which read as a printed pattern)
// Optional layers (all procedural, no extra textures, no extra draw calls):
//  - weave: { cells, tile } analytic yarn relief that sharpens the ripstop grid of the texture set (same grid:
//    `cells` lines per texture tile) into two reinforcement yarns per line, plus a 2/1 twill wale (0.62 mm). Both
//    fade out once they shrink below a pixel, so distant cloth falls back to the mip-mapped texture (no shimmer).
//  - body: MakeHuman uniform only (needs the skinned body asset). Per vertex, the nearest elbow / knee / hip joint
//    and its bend angle are computed in the vertex shader from the skeleton's own bone matrices (child limb axis
//    relative to the parent, so every soldier gets its own creases with one shared material and no per-soldier
//    uniforms); the fragment shader adds compression folds on the inner side of the joint that deepen as it bends,
//    with occlusion in the valleys. The same pass finds the nearest two body segments (torso, upper/lower arms,
//    thighs/shins) to place sewn seams (trouser side seams and inseams, sleeve underseams, jacket side / shoulder
//    seams, armholes, jacket hem), slight dye-lot colour shifts between the panels they join, and abrasion on high
//    points (knee fronts, elbow points, seat, seam ridges): faded, greyer cloth with pilling.
//  - gear: cordura / webbing edge wear from screen-space curvature (rounded box edges of pouches, flaps, straps:
//    abraded lighter fibres, rougher) and a stronger nylon sheen.
//  - boot: leather creases across the vamp at the ball-of-foot flex line and scuffed, abraded toe caps.
// All noise is evaluated in rest-pose model space (vFabP), so patterns do not swim when the skeleton moves.
import * as THREE from 'three';
import { SHADER } from '../quality.js';
import { shareMapUv, uvShareKey } from '../materials.js';
import { WET } from '../materials.js';
import { soldierBody } from './body.js';

// ---- skeleton data for the `body` layer (bind = A pose of characters/body.js), built once from the asset header
let RIG = null;
function fabRig() {
  if (RIG !== null) return RIG || null;
  const A = soldierBody();
  const want = ['hips', 'neck', 'uarmR', 'farmR', 'handR', 'uarmL', 'farmL', 'handL', 'thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL'];
  if (!A || !A.bones || want.some(n => !A.bones.find(b => b.name === n))) { RIG = false; return null; }
  const idx = n => A.bones.findIndex(b => b.name === n);
  const P = n => new THREE.Vector3(...A.bones[idx(n)].bindPos);
  const dir = (a, b) => b.clone().sub(a).normalize();
  const perp = (v, ax) => v.clone().addScaledVector(ax, -v.dot(ax)).normalize();
  const J = [], U = [], F = [], B = [], I = [], W = [], R = [];
  const joint = (parent, child, end, j, u, inner, wear, rad) => {
    const f = dir(P(child), P(end));
    J.push(j); U.push(u); F.push(f); B.push(new THREE.Vector2(idx(parent), idx(child)));
    I.push(perp(inner, f)); W.push(perp(wear, f)); R.push(rad);
  };
  for (const s of ['R', 'L']) {
    // elbow: inner side = the way the forearm is bent in the A pose (the bind mesh already shows that elbow)
    const u = dir(P('uarm' + s), P('farm' + s)), f = dir(P('farm' + s), P('hand' + s));
    joint('uarm' + s, 'farm' + s, 'hand' + s, P('farm' + s), u, perp(f, u), perp(f, u).negate(), 0.065);
  }
  for (const s of ['R', 'L']) {   // knee: creases behind the knee, wear on the kneecap
    joint('thigh' + s, 'shin' + s, 'foot' + s, P('shin' + s), dir(P('thigh' + s), P('shin' + s)), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), 0.075);
  }
  for (const s of ['R', 'L']) {   // hip: groin folds when the thigh lifts, seat wear behind
    joint('hips', 'thigh' + s, 'shin' + s, P('thigh' + s), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.3, 1), 0.07);
  }
  // body segments: [start, end, seam reference direction, kind 0 torso / 1 sleeve (underseam only) / 2 trouser leg]
  const down = new THREE.Vector3(0, -1, 0);
  const segs = [
    [P('hips'), P('neck'), new THREE.Vector3(1, 0, 0), 0],
    [P('uarmR'), P('farmR'), down, 1], [P('farmR'), P('handR'), down, 1],
    [P('uarmL'), P('farmL'), down, 1], [P('farmL'), P('handL'), down, 1],
    [P('thighR'), P('shinR'), new THREE.Vector3(1, 0, 0), 2], [P('shinR'), P('footR'), new THREE.Vector3(1, 0, 0), 2],
    [P('thighL'), P('shinL'), new THREE.Vector3(-1, 0, 0), 2], [P('shinL'), P('footL'), new THREE.Vector3(-1, 0, 0), 2],
  ];
  RIG = {
    uFJP: { value: J }, uFJU: { value: U }, uFJF: { value: F }, uFJB: { value: B }, uFJI: { value: I }, uFJW: { value: W }, uFJR: { value: R },
    uFSA: { value: segs.map(s => s[0]) }, uFSB: { value: segs.map(s => s[1]) },
    uFSR: { value: segs.map(s => new THREE.Vector4(s[2].x, s[2].y, s[2].z, s[3])) },
  };
  return RIG;
}

const BODY_VS_DECL = /* glsl */`
uniform vec3 uFJP[6]; uniform vec3 uFJU[6]; uniform vec3 uFJF[6]; uniform vec2 uFJB[6];
uniform vec3 uFSA[9]; uniform vec3 uFSB[9]; uniform vec4 uFSR[9];
varying vec4 vFabJ;   // xyz: position - nearest joint (bind space), w: that joint's current bend angle (rad)
varying vec4 vFabS;   // x: signed distance to the segment's seam line (m), y: seam present, z: distance to the
                      //    armhole / jacket-hem boundary (m), w: 1 where that boundary is sewn
varying vec4 vFabT;   // rgb: panel dye-lot tint, w: nearest joint index
`;
const BODY_VS = /* glsl */`
{
  vec3 p = position;
  int jk = 0; float jd = 1e9;
  for (int i = 0; i < 6; i++) { float d = distance(p, uFJP[i]); if (d < jd) { jd = d; jk = i; } }
  float ang = 0.0;
  #ifdef USE_SKINNING
  if (jd < 0.3) {
    // child limb axis carried into the parent bone's bind frame: R_parent^T * R_child (same skin matrices the
    // mesh is deformed with), so the angle is this soldier's actual elbow / knee / hip flexion
    vec3 f = transpose(mat3(getBoneMatrix(uFJB[jk].x))) * (mat3(getBoneMatrix(uFJB[jk].y)) * uFJF[jk]);
    ang = acos(clamp(dot(uFJU[jk], normalize(f)), -1.0, 1.0));
  }
  #endif
  vFabJ = vec4(p - uFJP[jk], ang);
  float d1 = 1e9, d2 = 1e9; int k1 = 0, k2 = 0;
  for (int i = 0; i < 9; i++) {
    vec3 ab = uFSB[i] - uFSA[i];
    float t = clamp(dot(p - uFSA[i], ab) / dot(ab, ab), 0.0, 1.0);
    float d = distance(p, uFSA[i] + ab * t);
    if (d < d1) { d2 = d1; k2 = k1; d1 = d; k1 = i; } else if (d < d2) { d2 = d; k2 = i; }
  }
  vec3 ab = uFSB[k1] - uFSA[k1], ax = normalize(ab);
  vec3 r = p - (uFSA[k1] + ab * clamp(dot(p - uFSA[k1], ab) / dot(ab, ab), 0.0, 1.0));
  vec3 ref = normalize(uFSR[k1].xyz - ax * dot(uFSR[k1].xyz, ax));
  float sd = dot(r, cross(ax, ref)), sg = dot(r, ref), kind = uFSR[k1].w;
  float on = (kind > 0.5 && kind < 1.5 ? step(0.0, sg) : 1.0) * step(p.y, 1.53);
  int other = k1 + k2;
  float bnd = ((k1 == 0 || k2 == 0) && (other == 1 || other == 3 || other == 5 || other == 7)) ? 1.0 : 0.0;
  vFabS = vec4(sd, on, d2 - d1, bnd * step(p.y, 1.53));
  // panels: jacket front / back, left / right sleeve, each trouser leg front / back
  float pid = k1 == 0 ? (sd > 0.0 ? 1.0 : 2.0) : k1 <= 2 ? 3.0 : k1 <= 4 ? 4.0 : k1 <= 6 ? (sd > 0.0 ? 5.0 : 6.0) : (sd > 0.0 ? 7.0 : 8.0);
  float h1 = fract(sin(pid * 12.9898) * 43758.5453), h2 = fract(sin(pid * 78.233) * 43758.5453);
  vFabT = vec4(vec3(1.0 + 0.09 * (h1 - 0.5)) * vec3(1.0 + 0.05 * (h2 - 0.5), 1.0, 1.0 - 0.05 * (h2 - 0.5)), float(jk));
}`;

const BODY_FS_DECL = /* glsl */`
uniform vec3 uFJF[6]; uniform vec3 uFJI[6]; uniform vec3 uFJW[6]; uniform float uFJR[6];
varying vec4 vFabJ; varying vec4 vFabS; varying vec4 vFabT;
`;

export function fabricShading(m, o = {}) {
  const dirt = o.dirt ?? 0.5, sheen = o.sheen ?? 0.12, soak = o.soak ?? 0.35, wrinkle = o.wrinkle ?? 0.5;
  const rough = o.rough ?? 0.25, wetTop = o.wetTop ?? 0.3, mudGloss = o.mudGloss ?? 0.45;
  // beads: water drops standing on water-repellent surfaces (cordura rig, waxed leather, wool knit, the helmet cover):
  // density (0..1) and the bind-space height above which they appear (helmet cover on the uniform material)
  const beads = o.beads ?? 0, beadsAbove = o.beadsAbove ?? -1;
  // rib: knitted rib relief (balaclava / gaiter): vertical wales of this period (m) around the head, with stitch loops
  const ribFull = o.rib ?? 0;
  const weaveFull = o.weave || null, gearFull = !!o.gear, bootFull = !!o.boot;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    // quality tier: on the low preset (mobile GPUs) the micro relief (yarn weave, knit rib, drape), joint folds, seams,
    // wear, edge wear and boot creases are skipped; mud, wet soak, roughness variation and sheen stay (FAB_LITE)
    const lite = SHADER.lite;
    const rib = lite ? 0 : ribFull, weave = lite ? null : weaveFull, gear = lite ? false : gearFull, boot = lite ? false : bootFull;
    shader.uniforms.uWetness = shader.uniforms.uWetness || WET.uWetness;
    const body = o.body && !lite ? fabRig() : null;
    const defs = { ...(shader.defines || {}), FAB: '' };
    if (lite) defs.FAB_LITE = '';
    if (body) { defs.FAB_BODY = ''; Object.assign(shader.uniforms, body); }
    if (weave) defs.FAB_WEAVE = '';
    if (gear) defs.FAB_GEAR = '';
    if (boot) defs.FAB_BOOT = '';
    shader.defines = defs;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFabP;\n#ifdef FAB_BODY\n' + BODY_VS_DECL + '#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFabP = position;\n#ifdef FAB_BODY\n' + BODY_VS + '\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFabP;
#ifdef FAB_BODY
${BODY_FS_DECL}
#endif
float fabMud = 0.0, fabWet = 0.0, fabFilm = 0.0, fabRib = 0.0, fabHgt = 0.0, fabRoughK = 1.0, fabSheenK = 1.0, fabBead = 0.0, fabFilmR = 1.0;
vec3 fabBeadO = vec3(0.0);
// rain bead normal: spherical cap, offset carried from rest-pose space to view space through the pixel derivatives
vec3 fabBeadNormal(vec3 n, vec3 ob, float w, vec3 pb) {
  vec3 bx = dFdx(pb), by = dFdy(pb), vx = dFdx(-vViewPosition), vy = dFdy(-vViewPosition);
  float a = dot(bx, bx), c = dot(bx, by), d = dot(by, by), det = a * d - c * c;
  if (abs(det) < 1e-24) return n;
  vec2 k = vec2(d * dot(ob, bx) - c * dot(ob, by), a * dot(ob, by) - c * dot(ob, bx)) / det;
  vec3 o = vx * k.x + vy * k.y;
  o -= n * dot(o, n);
  float q = min(length(o), 1.0) * 0.87;
  vec3 t = length(o) > 1e-6 ? normalize(o) : n;
  return normalize(mix(n, normalize(n * sqrt(1.0 - q * q) + t * q), w));
}
vec3 fabSheenC = vec3(0.0);
// Charlie sheen (Estevez & Kulla 2017) with Neubelt's visibility: the retro / grazing scattering of fibres; with a lamp
// behind the soldier it gives the soft rim of cloth seen against the light (no fixed rim term)
float fabDCharlie(float a, float NoH) { float ia = 1.0 / a; float s2 = max(1.0 - NoH * NoH, 0.0078125); return (2.0 + ia) * pow(s2, ia * 0.5) / 6.2831853; }
float fabVNeubelt(float NoV, float NoL) { return clamp(1.0 / (4.0 * (NoL + NoV - NoL * NoV)), 0.0, 1.0); }
float fabH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fabN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fabH(i), fabH(i + vec2(1.0, 0.0)), f.x), mix(fabH(i + vec2(0.0, 1.0)), fabH(i + vec2(1.0, 1.0)), f.x), f.y); }
// band-limited noise: fades to its mean once a cell shrinks toward a pixel
float fabNb(vec2 p, float fw){ return mix(fabN(p), 0.5, smoothstep(0.3, 0.8, fw)); }
// abraded / sun-faded cloth: lighter, greyer, a little warmer (exposed fibre ends, bleached dye)
vec3 fabFade(vec3 c, float k){ float l = dot(c, vec3(0.3, 0.55, 0.15)); return mix(c, vec3(l) * vec3(1.32, 1.3, 1.18) + 0.012, k); }
#ifdef FAB_WEAVE
${weaveGLSL(weave)}
#endif`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float gy = vFabP.y;
        vec2 pq = vec2(vFabP.x + vFabP.z * 0.7, vFabP.z - vFabP.x * 0.5);
        float fwP = length(fwidth(vFabP));                 // pixel footprint (m)
        #ifdef FAB_LITE
        float nz = fabN(pq * 7.0 + vFabP.y * 3.0);
        #else
        float nz = fabN(pq * 7.0 + vFabP.y * 3.0) * 0.6 + fabN(pq * 23.0 + 5.0) * 0.4;
        #endif
        // splashed mud: a heavy dark band from the boots up to the knee, flecks and streaks higher up
        float mud = smoothstep(${(0.5 * (0.6 + dirt)).toFixed(3)} + nz * 0.28, 0.0, gy - 0.05) * ${dirt.toFixed(3)};
        #ifdef FAB_LITE
        fabMud = clamp(mud, 0.0, 0.9);
        #else
        float fleck = step(0.7, fabN(pq * 90.0 + vFabP.y * 61.0)) * smoothstep(1.0, 0.15, gy) * ${dirt.toFixed(3)} * (0.4 + nz);
        float drip = smoothstep(0.62, 0.9, fabN(vec2(pq.x * 31.0 + pq.y * 17.0, vFabP.y * 3.5))) * smoothstep(0.95, 0.3, gy) * ${(dirt * 0.5).toFixed(3)};
        fabMud = clamp(mud + fleck * 0.7 + drip, 0.0, 0.9);
        // drape: soft rumples (~5 cm) on top of the modelled folds
        fabHgt += ${(wrinkle * 0.0012).toFixed(5)} * (fabN(pq * 19.0 + vFabP.y * 13.0) - 0.5);
        #endif
        ${rib ? `
        // knitted rib: wales run vertically; arc length around the head (bind pose, head axis near x = 0, z = -0.04)
        float arc = atan(vFabP.x, -(vFabP.z + 0.04)) * 0.09;
        float wale = arc / ${rib.toFixed(4)};
        float loopP = vFabP.y / ${(rib * 0.8).toFixed(4)} + 0.5 * step(0.5, fract(wale * 0.5));
        fabRib = 0.62 * (0.5 + 0.5 * sin(wale * 6.2832)) + 0.38 * (0.5 + 0.5 * sin(loopP * 6.2832)) * (0.5 + 0.5 * sin(wale * 6.2832));
        fabRib = mix(0.5, fabRib, 1.0 - smoothstep(0.2, 0.55, max(fwidth(wale), fwidth(loopP))));   // fade out before it aliases
        diffuseColor.rgb *= 0.8 + 0.3 * fabRib;
        fabHgt += fabRib * ${(rib * 0.25).toFixed(5)};` : ''}
        #ifdef FAB_BODY
        {
          // ---- panels: dye-lot shift between the sewn pieces
          diffuseColor.rgb *= vFabT.rgb;
          // ---- joint folds: compression folds on the inner side of the elbow / knee / hip, deepening with the bend
          int ji = int(vFabT.w + 0.5);
          vec3 ax = uFJF[ji], inn = uFJI[ji];
          vec3 q = vFabJ.xyz;
          float s = dot(q, ax);
          vec3 rr = q - s * ax;
          float rl = max(length(rr), 1e-4);
          vec3 rn = rr / rl;
          float ci = dot(rn, inn), cs = dot(rn, cross(ax, inn));
          float arcJ = atan(cs, ci) * rl;                   // arc length round the limb from the inner line (m)
          float env = exp(-s * s / (uFJR[ji] * uFJR[ji]));
          float bend = smoothstep(0.3, 1.7, vFabJ.w);
          float side = smoothstep(-0.5, 0.7, ci);
          // folds fan out from the inner line: ~2.6 cm apart, curving away from the joint round the limb
          float ph = (s + 0.5 * abs(arcJ)) / 0.026 + 0.7 * fabN(vec2(arcJ * 26.0, float(ji) * 7.3)) + float(ji) * 0.37;
          float ridge = 0.5 + 0.5 * cos(ph * 6.2832);
          float fk = env * bend * side * (1.0 - smoothstep(0.25, 0.6, fwidth(ph)));
          fabHgt += 0.0045 * fk * (pow(ridge, 0.7) - 0.45);
          diffuseColor.rgb *= 1.0 - 0.38 * fk * pow(1.0 - ridge, 2.0);
          // ---- seams: felled seams (9 mm band, two stitch rows) along trouser legs, sleeves and jacket sides; the
          // armholes and the jacket hem are boundaries between body segments
          float along = dot(vFabP, vec3(0.31, 0.93, 0.19));
          float sdx = abs(vFabS.x), pw = max(fwidth(vFabS.x), 1e-5);
          float band = (1.0 - smoothstep(0.0042, 0.0042 + 1.5 * pw, sdx)) * vFabS.y;
          float bx = vFabS.z * 0.5, bw = max(fwidth(bx), 1e-5);
          float band2 = (1.0 - smoothstep(0.0045, 0.0045 + 1.5 * bw, bx)) * step(0.5, vFabS.w);
          float stitchK = 1.0 - smoothstep(0.0006, 0.0016, pw);
          float rows = (exp(-pow((sdx - 0.003) / 0.00045, 2.0)) * band + exp(-pow((bx - 0.003) / 0.00045, 2.0)) * band2) * stitchK;
          float dash = step(0.35, fract(along / 0.0032));
          float seam = max(band, band2);
          // ridge of the folded-over seam allowance + small pucker beside it
          fabHgt += 0.0008 * seam * cos(clamp(max(sdx * band, bx * band2) / 0.0045, 0.0, 1.0) * 1.57)
                  - 0.00025 * rows + 0.0005 * sin(along * 520.0) * exp(-pow(min(sdx, 1.0) / 0.011, 2.0)) * vFabS.y;
          diffuseColor.rgb *= 1.0 - 0.2 * rows * (1.0 - dash);
          // ---- wear on high points: kneecaps, elbow points, seat, seam ridges; pilling where abraded
          float hp = exp(-s * s / 0.0025) * smoothstep(0.15, 0.85, dot(rn, uFJW[ji]));
          float wn = fabN(vFabP.xy * 61.0 + vFabP.z * 37.0) * 0.6 + fabN(vFabP.zy * 180.0) * 0.4;
          float wear = clamp(hp * (0.55 + 0.6 * wn) + seam * (0.3 + 0.4 * wn), 0.0, 1.0);
          float pill = step(0.8, fabNb(vFabP.xy * 900.0 + vFabP.z * 640.0, fwP * 900.0)) * wear;
          diffuseColor.rgb = fabFade(diffuseColor.rgb, 0.32 * wear + 0.12 * pill);
          fabRoughK *= 1.0 + 0.1 * wear;
          fabSheenK += 0.8 * wear;
        }
        #endif
        #ifdef FAB_GEAR
        {
          // edge wear on pouches, flaps and straps: curvature from screen-space derivatives of the smooth normal
          vec3 nn = normalize(vNormal);
          float curv = length(fwidth(nn)) / max(length(fwidth(vViewPosition)), 1e-6);
          float en = fabN(vFabP.xy * 140.0 + vFabP.z * 90.0) * 0.6 + fabN(vFabP.zy * 400.0) * 0.4;
          float edge = smoothstep(35.0, 120.0, curv) * smoothstep(0.25, 0.65, en);
          diffuseColor.rgb = fabFade(diffuseColor.rgb, 0.45 * edge);
          fabRoughK *= 1.0 + 0.18 * edge;
          fabSheenK += 1.5 * edge;
        }
        #endif
        #ifdef FAB_BOOT
        {
          // foot frame (bind pose): x across the foot from its centre line, y up from the sole, z toward the toe (< 0)
          vec3 f = vec3(abs(vFabP.x) - 0.2, vFabP.y, vFabP.z);
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
          // flex creases across the vamp at the ball of the foot: a few sharp, irregular, slightly smiling lines
          float vamp = exp(-pow((f.z + 0.152) / 0.026, 2.0)) * smoothstep(0.05, 0.08, f.y);
          float cc = (f.z + 0.152) / 0.0085 + 55.0 * f.x * f.x + 0.9 * fabN(vec2(f.x * 38.0, 1.7));
          float cr = exp(-pow((fract(cc) - 0.5) / 0.11, 2.0)) * (0.45 + 0.55 * fabN(vec2(floor(cc) * 3.1, f.x * 70.0)));
          cr *= vamp * (1.0 - smoothstep(0.35, 0.7, fwidth(cc)));
          fabHgt -= 0.0006 * cr;
          diffuseColor.rgb *= 1.0 - 0.35 * cr;
          // scuffed toe cap: abraded grain (lighter, greyer, matte) with horizontal scratches, worst at the front
          float toe = smoothstep(-0.19, -0.238, f.z) * smoothstep(0.095, 0.035, f.y);
          float scr = fabNb(vec2(f.x * 30.0 + f.z * 10.0, f.y * 1400.0), fwP * 1400.0);
          float scuff = toe * clamp(0.55 * fabN(f.xy * vec2(90.0, 160.0) + f.z * 40.0) + 0.6 * smoothstep(0.55, 0.85, scr), 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(1.9, 1.75, 1.55) + vec3(0.02, 0.016, 0.012), 0.55 * scuff);
          fabRoughK *= 1.0 + 0.35 * scuff - 0.15 * cr;
          fabHgt -= 0.00015 * scuff;
        }
        #endif
        #ifdef FAB_LITE
        vec3 mudCol = vec3(0.105, 0.087, 0.063);
        #else
        vec3 mudCol = mix(vec3(0.085, 0.07, 0.052), vec3(0.13, 0.105, 0.075), fabN(pq * 41.0));
        #endif
        diffuseColor.rgb = mix(diffuseColor.rgb, mudCol, fabMud);
        // rain soak: water fills the yarn gaps, so the cloth scatters less light back out: darker and more saturated
        // (a soaked cotton / poly ripstop drops to ~55-65 % of its dry reflectance). Exposed surfaces (facing up or out,
        // world normal) soak first; the rest is damp
        float up = clamp(vWetN.y * 0.5 + 0.5, 0.0, 1.0);
        float top = pow(clamp(vWetN.y, 0.0, 1.0), 2.2);
        float wk = clamp(${soak.toFixed(3)} * uWetness * (0.5 + 0.5 * up) * (0.65 + 0.35 * nz), 0.0, 1.0);
        float wl = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
        diffuseColor.rgb = max(mix(vec3(wl), diffuseColor.rgb, 1.0 + 0.9 * wk), 0.0) * (1.0 - 0.95 * wk);
        // shoulders / crown / rig top are visibly wetter: darker and saturated, with a few run-off streaks
        fabWet = top * (0.55 + 0.45 * nz) * ${wetTop.toFixed(3)} * (0.4 + 0.6 * uWetness) * 2.0;
        diffuseColor.rgb *= 1.0 - 0.35 * clamp(fabWet, 0.0, 1.0);
        // water film over the soaked weave: everywhere exposed a thin film (the weave's micro-roughness is filled in),
        // a continuous film on the shoulders / crown / rig top, and running water in streaks down the sides (rest-pose
        // space, so they stay on the cloth). It is what makes wet cloth catch the lamps: broad specular sheets on the
        // tops, bright streaks on the sides, Fresnel-bright edges when the lamp is behind
        float streak = smoothstep(0.5, 0.85, fabN(vec2((vFabP.x + vFabP.z) * 46.0, vFabP.y * 2.4 + nz)));
        fabFilm = clamp(uWetness * (0.35 * (0.6 + 0.4 * up) + 0.65 * clamp(fabWet, 0.0, 1.0) + 0.55 * streak * (1.0 - top) * (0.45 + 0.55 * nz)), 0.0, 1.0);
        fabFilmR = mix(0.5, 0.2, smoothstep(0.3, 0.9, fabFilm));      // film roughness: thin film -> sheet of water
        diffuseColor.rgb *= 1.0 - 0.14 * streak * uWetness * (1.0 - top);
        ${beads > 0 ? `
        #ifndef FAB_LITE
        // beads on water-repellent surfaces: 1-2.5 mm drops on a ~6 mm grid, more on surfaces facing up; each is a
        // smooth dome (bump) with a near-mirror surface, faded out once smaller than ~a pixel
        if (vFabP.y > ${beadsAbove.toFixed(3)}) {
          vec3 dq = floor(vFabP * 165.0);
          vec3 dctr = (dq + 0.25 + 0.5 * vec3(fabH(dq.xy + dq.z * 7.1), fabH(dq.yz + 3.3), fabH(dq.zx + 9.7))) / 165.0;
          float rad = 0.0006 + 0.0008 * fabH(dq.xy * 1.7 + dq.z);
          float dd = length(vFabP - dctr) / rad;
          float has = step(fabH(dq.xz * 0.37 + dq.y * 1.3), ${beads.toFixed(3)} * uWetness * (0.35 + 0.65 * up));
          float vis = 1.0 - smoothstep(0.5, 1.2, fwP / rad);
          fabBead = has * vis * (1.0 - smoothstep(0.85, 1.0, dd));
          fabBeadO = (vFabP - dctr) / rad;
        }
        #endif` : ''}
        // fibre sheen colour: dye-tinted, stronger where the fibres are abraded / fuzzy
        fabSheenC = mix(diffuseColor.rgb * 2.2, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15)) * 2.2), 0.4) * ${sheen.toFixed(3)} * fabSheenK;
      }`)
      .replace('normal = normalize( tbn * mapN );', `
      #ifdef FAB_WEAVE
        mapN.xy -= fabWeave(vNormalMapUv);
      #endif
      normal = normalize( tbn * mapN );`)
      .replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
      {
        #ifndef FAB_LITE
        // macro relief (drape, joint folds, seams, knit rib, boot creases) as a bump from screen-space derivatives
        vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
        vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
        float det = dot(dpx, r1) * faceDirection;
        vec3 g = sign(det) * (dFdx(fabHgt) * r1 + dFdy(fabHgt) * r2);
        normal = normalize(abs(det) * normal - g);
        if (fabBead > 0.001) normal = fabBeadNormal(normal, fabBeadO, fabBead, vFabP);
        // roughness: patchy wear, wet mud and soaked cloth are glossier (not mirror-like)
        float rv = fabN(vFabP.xy * 17.0 + vFabP.z * 9.0) * 0.6 + fabN(vFabP.zy * 61.0) * 0.4 - 0.5;
        #else
        float rv = fabN(vFabP.xy * 17.0 + vFabP.z * 9.0) - 0.5;
        #endif
        roughnessFactor = clamp(roughnessFactor * fabRoughK * (1.0 + ${rough.toFixed(3)} * 2.0 * rv) * (1.0 - ${mudGloss.toFixed(3)} * fabMud), 0.18, 1.0);
        // water film over the soaked weave: smoother where it collects; beads are near-mirror domes
        roughnessFactor = mix(roughnessFactor, min(roughnessFactor, fabFilmR), clamp(fabFilm * 1.4, 0.0, 0.92));
        roughnessFactor = mix(roughnessFactor, 0.05, fabBead);
      }`)
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );',
        `reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
        #ifndef FAB_LITE
        {
          vec3 shH = normalize( directLight.direction + geometryViewDir );
          float shNoL = saturate( dot( geometryNormal, directLight.direction ) ), shNoV = saturate( dot( geometryNormal, geometryViewDir ) );
          reflectedLight.directSpecular += irradiance * fabSheenC * fabDCharlie( 0.36, saturate( dot( geometryNormal, shH ) ) ) * fabVNeubelt( shNoV, shNoL );
        }
        #endif`))
      .replace('#include <opaque_fragment>', `
      {
        // ambient sheen: the same lobe under the sky / bounce light (its directional albedo grows toward grazing)
        float nv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        vec3 ambL = reflectedLight.indirectDiffuse / max(diffuseColor.rgb, vec3(0.02));
        outgoingLight += fabSheenC * ambL * (0.12 + 0.45 * pow(1.0 - nv, 3.0));
      }
      #include <opaque_fragment>`);
    shareMapUv(shader, m);
  };
  m.customProgramCacheKey = () => 'fab5' + (SHADER.lite ? 'L' : '') + 'b' + beads + '/' + beadsAbove + uvShareKey(m) + dirt + sheen + soak + wrinkle + rough + wetTop + mudGloss + ribFull + (weaveFull ? weaveFull.cells + '/' + weaveFull.tile : '') + (o.body ? 'B' : '') + (gearFull ? 'G' : '') + (bootFull ? 'T' : '');
  return m;
}

/** GLSL of fabWeave(tuv) for a weave setting (also used by the first-person sleeves, viewmodel/arms.js). */
export const weaveGLSL = (w) => `// analytic yarn relief in the texture's UVs: returns the height slope (dh / dmetre) for the tangent-space normal
vec2 fabWeave(vec2 tuv) {
  const float CELLS = ${w ? w.cells.toFixed(1) : '1.0'}, TILE = ${w ? w.tile.toFixed(4) : '1.0'};
  const float PITCH = TILE / CELLS;
  vec2 fw = fwidth(tuv) * TILE;
  float px = max(fw.x, fw.y);                           // metres per pixel
  // ripstop: two reinforcement yarns 0.28 mm either side of each grid line, 0.05 mm proud of the plain weave
  vec2 x = (fract(tuv * CELLS + 0.5) - 0.5) * PITCH;
  vec2 e = (abs(x) - 0.00028) / 0.0002;
  vec2 dp = exp(-e * e) * (-2.0 * e / 0.0002) * sign(x);
  vec2 slope = dp * 0.00005 * (1.0 - smoothstep(0.00025, 0.0007, px));
  // 2/1 twill wale at ~63 degrees, 0.62 mm period, 0.012 mm deep
  vec2 m = tuv * TILE, dir = vec2(0.454, 0.891);
  float ph = dot(m, dir) * (6.2832 / 0.00062);
  slope += dir * cos(ph) * (6.2832 / 0.00062) * 0.000012 * (1.0 - smoothstep(0.00018, 0.0004, px));
  return slope;
}`;

/** Ripstop weave settings for a camo texture set used at material tile `tile` (texture generated at `texTile`). */
export const ripstop = (texTile, tile) => ({ cells: Math.max(1, Math.round(texTile / 0.0055)), tile });
