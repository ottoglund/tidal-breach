// Soldier skin, eye and hair shading (no textures: everything is evaluated from the bind-pose position, which is
// stable while the skeleton moves). Used by the MakeHuman body (characters/soldier.js, materials in enemies.js).
//  skin : wrap diffuse lighting with a red-shifted terminator (cheap stand-in for subsurface scattering), mottled
//         albedo with redder cheeks / nose / ears / lips, darker eyelid creases and eye sockets, pinker inner eye
//         corners, a shaved-stubble shadow on the jaw and upper lip, oilier (glossier) forehead and nose
//  eye  : sclera, limbal ring, iris with radial fibres and pupil from the angle to the eyeball's forward axis
//  hair : short-cut hair shell: strand noise, sparse hairline that lets the skin show through (uv.x = density)
import * as THREE from 'three';

const NOISE = /* glsl */`
float skH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float skN(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(skH(i), skH(i + vec3(1, 0, 0)), f.x), mix(skH(i + vec3(0, 1, 0)), skH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(skH(i + vec3(0, 0, 1)), skH(i + vec3(1, 0, 1)), f.x), mix(skH(i + vec3(0, 1, 1)), skH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

const eyeU = (o) => ({ uEyeR: { value: new THREE.Vector3(...(o.eyeR || [0.03, 1.68, -0.137])) }, uEyeL: { value: new THREE.Vector3(...(o.eyeL || [-0.03, 1.68, -0.137])) } });

/** Skin: o = { eyeR, eyeL } (bind-pose eye centres from the body asset). Chains any previous onBeforeCompile (wetness). */
export function skinShading(m, o = {}) {
  const prev = m.onBeforeCompile;
  const U = eyeU(o);
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkP = position;');
    // wrap lighting: light reaches past the terminator, red travels furthest (skin scatters red light deepest)
    const lp = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      `{
        float ndl = dot( geometryNormal, directLight.direction );
        vec3 w = vec3( 0.42, 0.22, 0.16 );
        vec3 wrapD = clamp( ( vec3( ndl ) + w ) / ( 1.0 + w ), 0.0, 1.0 );
        wrapD *= mix( vec3( 1.0 ), vec3( 1.0, 0.86, 0.82 ), 1.0 - clamp( ndl * 3.0, 0.0, 1.0 ) );
        reflectedLight.directDiffuse += wrapD * directLight.color * BRDF_Lambert( material.diffuseColor );
      }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSkP;\nuniform vec3 uEyeR, uEyeL;\nfloat skOil = 0.0, skStub = 0.0;\n${NOISE}`)
      .replace('#include <lights_physical_pars_fragment>', lp)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 p = vSkP;
        vec3 ec = p.x > 0.0 ? uEyeR : uEyeL;              // nearer eye
        vec3 e = p - ec;
        float sx = p.x > 0.0 ? 1.0 : -1.0;
        float eyeY = 0.5 * (uEyeR.y + uEyeL.y), frontZ = uEyeR.z;
        // mottling at two scales (freckle / capillary level and patchy blotches)
        float n1 = skN(p * 420.0), n2 = skN(p * 90.0 + 3.1), n3 = skN(p * 23.0 + 7.7);
        vec3 col = diffuseColor.rgb * (0.9 + 0.12 * n2 + 0.06 * n1);
        // redness: cheeks, nose, ears, lips; slightly yellower forehead
        float cheek = exp(-pow(length((p.xy - vec2(sx * 0.042, eyeY - 0.035)) / vec2(0.022, 0.02)), 2.0));
        float nose = exp(-pow(length((p - vec3(0.0, eyeY - 0.038, frontZ - 0.03)) / vec3(0.012, 0.022, 0.02)), 2.0));
        float ear = smoothstep(0.062, 0.075, abs(p.x));
        float lipsD = length((p.xy - vec2(0.0, eyeY - 0.084)) / vec2(0.024, 0.0075));
        float lips = (1.0 - smoothstep(0.75, 1.15, lipsD)) * step(p.z, frontZ + 0.0);
        float red = clamp(0.55 * cheek + 0.5 * nose + 0.4 * ear + 0.3 * n3, 0.0, 1.0);
        col = mix(col, col * vec3(1.13, 0.88, 0.86), red * 0.6);
        col = mix(col, vec3(0.42, 0.2, 0.18) * (0.85 + 0.2 * n2), lips * 0.65);
        // eye region: darker, slightly purple sockets, a dark upper-lid crease, pink inner corners
        float sock = exp(-dot(e.xy / vec2(0.024, 0.017), e.xy / vec2(0.024, 0.017)));
        col *= 1.0 - 0.22 * sock;
        col = mix(col, col * vec3(0.92, 0.82, 0.9), 0.5 * sock);
        float crease = exp(-pow(e.x / 0.015, 2.0) - pow((e.y - 0.0095 - 0.0025 * (1.0 - pow(e.x / 0.015, 2.0))) / 0.0026, 2.0));
        col *= 1.0 - 0.5 * crease;
        float lidLine = exp(-pow(e.x / 0.013, 2.0) - pow((e.y + 0.0072) / 0.0018, 2.0));
        col *= 1.0 - 0.25 * lidLine;
        float canthus = exp(-pow((abs(p.x) - 0.016) / 0.004, 2.0) - pow(e.y / 0.004, 2.0));
        col = mix(col, vec3(0.5, 0.24, 0.24), 0.5 * canthus);
        // shaved stubble: jaw, chin and upper lip (not on the lips), bluish-grey with a speckle
        float jaw = smoothstep(eyeY - 0.05, eyeY - 0.075, p.y) * smoothstep(0.072, 0.05, abs(p.x)) * step(p.z, frontZ + 0.07);
        float lip = exp(-pow(p.x / 0.024, 2.0) - pow((p.y - (eyeY - 0.068)) / 0.006, 2.0));
        skStub = clamp(max(jaw, lip * 0.9) * (1.0 - lips) * smoothstep(eyeY - 0.16, eyeY - 0.12, p.y), 0.0, 1.0);
        col = mix(col, col * vec3(0.72, 0.74, 0.8) * (0.85 + 0.3 * step(0.55, n1)), skStub * 0.55);
        // forehead / nose oil sheen
        skOil = clamp(nose + smoothstep(eyeY + 0.02, eyeY + 0.045, p.y) * smoothstep(0.05, 0.02, abs(p.x)) * 0.7, 0.0, 1.0);
        diffuseColor.rgb = col;
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor * (1.0 - 0.3 * skOil + 0.25 * skStub), 0.25, 1.0);`);
  };
  m.customProgramCacheKey = () => 'skin1';
  return m;
}

/** Eyeball: o = { eyeR, eyeL, iris } */
export function eyeShading(m, o = {}) {
  const U = eyeU(o);
  const iris = new THREE.Color(o.iris ?? 0x4a5a60);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, { uIris: { value: iris } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEyP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vEyP;\nuniform vec3 uEyeR, uEyeL, uIris;\n${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 ec = vEyP.x > 0.0 ? uEyeR : uEyeL;
        vec3 d = normalize(vEyP - ec);
        float c = -d.z;                                        // 1 = looking straight ahead (-Z)
        float ang = acos(clamp(c, -1.0, 1.0));
        float rr = ang / 0.5;                                  // iris edge at ~29 degrees
        float az = atan(d.y, d.x);
        vec3 sclera = vec3(0.74, 0.7, 0.66) * (0.92 + 0.08 * skN(vEyP * 900.0));
        sclera = mix(sclera, vec3(0.7, 0.45, 0.42), smoothstep(0.9, 1.9, rr) * 0.45);     // redder toward the corners
        float fib = 0.75 + 0.25 * skN(vec3(az * 14.0, rr * 6.0, 0.0)) + 0.15 * skN(vec3(az * 40.0, rr * 3.0, 2.0));
        vec3 irisC = uIris * fib * mix(1.25, 0.7, rr);
        irisC = mix(irisC, vec3(0.25, 0.17, 0.08), smoothstep(0.55, 0.3, rr) * 0.5);       // warm collarette
        vec3 col = mix(irisC, sclera, smoothstep(0.96, 1.04, rr));
        col *= 1.0 - 0.55 * exp(-pow((rr - 0.98) / 0.06, 2.0));                             // limbal ring
        col = mix(vec3(0.012), col, smoothstep(0.3, 0.36, rr));                               // pupil
        diffuseColor.rgb = col;
      }`);
  };
  m.customProgramCacheKey = () => 'eye1';
  return m;
}

/** Short hair over the scalp (uv.x = density: 0 at the hairline, 1 inside); skinColor = colour of the scalp below. */
export function hairShading(m, skinColor) {
  const prev = m.onBeforeCompile;
  const sk = new THREE.Color(skinColor);
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uScalp = { value: sk };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHrP;\nvarying vec2 vHrUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHrP = position; vHrUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vHrP;\nvarying vec2 vHrUv;\nuniform vec3 uScalp;\nfloat hrS = 0.0;\n${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        // strands run back over the crown and down the sides: stretch the noise along that direction
        vec3 p = vHrP;
        vec3 dir = normalize(vec3(p.x * 0.6, -0.35, 1.0));
        vec3 t = normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + 1e-4);
        float a = dot(p, t) * 2600.0, b = dot(p, dir) * 260.0;
        float strands = skN(vec3(a, b, p.y * 900.0)) * 0.6 + skN(vec3(a * 2.3, b * 1.7, 4.0)) * 0.4;
        float dens = clamp(vHrUv.x, 0.0, 1.0);
        float cover = smoothstep(0.0, 0.85, dens) * (0.55 + 0.45 * smoothstep(0.35, 0.65, strands));
        vec3 hc = diffuseColor.rgb * (0.6 + 0.8 * strands);
        diffuseColor.rgb = mix(uScalp * 0.85, hc, cover);
        hrS = cover;
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(0.6, roughnessFactor, hrS);`);
  };
  m.customProgramCacheKey = () => 'hair1';
  return m;
}
