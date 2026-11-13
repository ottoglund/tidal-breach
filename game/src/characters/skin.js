// Soldier skin, eye and hair shading (no textures: everything is evaluated from the bind-pose position, which is
// stable while the skeleton moves). Used by the MakeHuman body (characters/soldier.js, materials in enemies.js).
//  skin : wrap diffuse lighting with a red-shifted terminator (cheap stand-in for subsurface scattering), mottled
//         albedo with redder cheeks / nose / ears / lips, darker eyelid creases and eye sockets, pinker inner eye
//         corners, a shaved-stubble shadow on the jaw and upper lip, oilier (glossier) forehead and nose
//  eye  : sclera, limbal ring, iris with radial fibres and pupil (eyeball vertices, same material)
//  hair : short-cut hair shell: strand noise, stochastic cut-out at the hairline (hair vertices, same material)
import * as THREE from 'three';

const NOISE = /* glsl */`
float skH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float skN(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(skH(i), skH(i + vec3(1, 0, 0)), f.x), mix(skH(i + vec3(0, 1, 0)), skH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(skH(i + vec3(0, 0, 1)), skH(i + vec3(1, 0, 1)), f.x), mix(skH(i + vec3(0, 1, 1)), skH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

const eyeU = (o) => ({ uEyeR: { value: new THREE.Vector3(...(o.eyeR || [0.03, 1.68, -0.137])) }, uEyeL: { value: new THREE.Vector3(...(o.eyeL || [-0.03, 1.68, -0.137])) } });

/**
 * Skin material of the soldiers' faces, also drawing the short-hair shell and the eyeballs (one draw call): the body
 * asset marks hair vertices with uv.y >= 1000 (uv.x = hair density, 0 at the hairline) and eyeball vertices with
 * uv.y >= 2000. o = { eyeR, eyeL } (bind-pose eye centres from the body asset), hair / iris colours optional.
 * Chains any previous onBeforeCompile (wetness).
 */
export function skinShading(m, o = {}) {
  const prev = m.onBeforeCompile;
  const U = { ...eyeU(o), uIris: { value: new THREE.Color(o.iris ?? 0x4f6068) }, uHair: { value: new THREE.Color(o.hair ?? 0x3b2d22) },
    uHeadC: { value: new THREE.Vector3(...(o.headC || [0, 1.73, -0.03])) } };
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkP;\nvarying vec2 vSkUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkP = position; vSkUv = uv;');
    // wrap lighting: light reaches past the terminator, red travels furthest (skin scatters red light deepest)
    const lp = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      `{
        float ndl = dot( geometryNormal, directLight.direction );
        vec3 w = vec3( 0.42, 0.22, 0.16 ) * skWrap;
        vec3 wrapD = clamp( ( vec3( ndl ) + w ) / ( 1.0 + w ), 0.0, 1.0 );
        reflectedLight.directDiffuse += wrapD * directLight.color * BRDF_Lambert( material.diffuseColor );
      }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSkP;
varying vec2 vSkUv;
uniform vec3 uEyeR, uEyeL, uIris, uHair, uHeadC;
float skOil = 0.0, skStub = 0.0, skWrap = 1.0, skRough = -1.0;
${NOISE}`)
      .replace('#include <lights_physical_pars_fragment>', lp)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 p = vSkP;
        vec3 ec = p.x > 0.0 ? uEyeR : uEyeL;              // nearer eye
        vec3 e = p - ec;
        float sx = p.x > 0.0 ? 1.0 : -1.0;
        float eyeY = 0.5 * (uEyeR.y + uEyeL.y), frontZ = uEyeR.z;
        float n1 = skN(p * 420.0), n2 = skN(p * 90.0 + 3.1), n3 = skN(p * 23.0 + 7.7);
        vec3 col = diffuseColor.rgb * (0.9 + 0.12 * n2 + 0.06 * n1);
        if (vSkUv.y > 1500.0) {
          // eyeball: sclera, limbal ring, iris with radial fibres, pupil (angle from the eye's forward axis, -Z)
          vec3 d = normalize(e);
          float rr = acos(clamp(-d.z, -1.0, 1.0)) / 0.5;      // iris edge at ~29 degrees
          float az = atan(d.y, d.x);
          vec3 sclera = vec3(0.62, 0.58, 0.55) * (0.92 + 0.08 * skN(p * 900.0));
          sclera = mix(sclera, vec3(0.6, 0.38, 0.36), smoothstep(0.9, 1.9, rr) * 0.45);
          float fib = 0.75 + 0.25 * skN(vec3(az * 14.0, rr * 6.0, 0.0)) + 0.15 * skN(vec3(az * 40.0, rr * 3.0, 2.0));
          vec3 irisC = uIris * fib * mix(1.25, 0.7, rr);
          irisC = mix(irisC, vec3(0.25, 0.17, 0.08), smoothstep(0.55, 0.3, rr) * 0.5);
          col = mix(irisC, sclera, smoothstep(0.96, 1.04, rr));
          col *= 1.0 - 0.55 * exp(-pow((rr - 0.98) / 0.06, 2.0));
          col = mix(vec3(0.012), col, smoothstep(0.3, 0.36, rr));
          skWrap = 0.0; skRough = 0.12;
        } else if (vSkUv.y > 500.0) {
          // short hair: strands run back over the crown and down the sides; the sparse hairline is cut out
          // stochastically (alpha test), so the shell blends into the scalp without blending / sorting
          vec3 dir = normalize(vec3(p.x * 0.6, -0.35, 1.0));
          vec3 t = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
          float a = dot(p, t) * 2600.0, b = dot(p, dir) * 260.0;
          float strands = skN(vec3(a, b, p.y * 900.0)) * 0.6 + skN(vec3(a * 2.3, b * 1.7, 4.0)) * 0.4;
          // hairline (same table as tools/mh/build_soldier.py HAIR_TH / HAIR_HL), evaluated per pixel
          float th = vSkUv.x, hy = vSkUv.y - 1000.0;
          float hl = th < 0.45 ? mix(0.058, 0.056, th / 0.45) : th < 0.8 ? mix(0.056, 0.045, (th - 0.45) / 0.35)
            : th < 1.05 ? mix(0.045, 0.036, (th - 0.8) / 0.25) : th < 1.2 ? mix(0.036, -0.012, (th - 1.05) / 0.15)
            : th < 1.38 ? -0.012 : th < 1.62 ? mix(-0.012, 0.012, (th - 1.38) / 0.24) : th < 1.95 ? mix(0.012, 0.0, (th - 1.62) / 0.33)
            : th < 2.3 ? mix(0.0, -0.05, (th - 1.95) / 0.35) : mix(-0.05, -0.078, (th - 2.3) / 0.8416);
          float dens = smoothstep(-0.002, 0.016, hy - hl + 0.004 * (skN(p * 300.0) - 0.5));
          vec3 ecE = vec3(sx * 0.074, eyeY - 0.014, uHeadC.z + 0.012);
          dens *= smoothstep(0.024, 0.034, length((p - ecE) * vec3(0.55, 1.0, 1.15)));
          if (dens * (0.75 + 0.5 * strands) < 0.2 + 0.6 * skH(floor(p * 3000.0))) discard;
          col = uHair * (0.55 + 0.9 * strands) * (0.85 + 0.15 * n2);
          skWrap = 0.3; skRough = 0.85 - 0.15 * strands;
        } else {
          // redness: cheeks, nose, ears, lips
          float cheek = exp(-pow(length((p.xy - vec2(sx * 0.042, eyeY - 0.035)) / vec2(0.022, 0.02)), 2.0));
          float nose = exp(-pow(length((p - vec3(0.0, eyeY - 0.038, frontZ - 0.03)) / vec3(0.012, 0.022, 0.02)), 2.0));
          float ear = smoothstep(0.062, 0.075, abs(p.x));
          float lipsD = length((p.xy - vec2(0.0, eyeY - 0.084)) / vec2(0.024, 0.0075));
          float lips = (1.0 - smoothstep(0.75, 1.15, lipsD)) * step(p.z, frontZ);
          float red = clamp(0.5 * cheek + 0.45 * nose + 0.35 * ear + 0.25 * n3, 0.0, 1.0);
          col = mix(col, col * vec3(1.08, 0.92, 0.9), red * 0.5);
          col = mix(col, vec3(0.4, 0.22, 0.2) * (0.85 + 0.2 * n2), lips * 0.6);
          // eye region: darker, slightly purple sockets, a dark upper-lid crease, lash line, pink inner corners
          float sock = exp(-dot(e.xy / vec2(0.024, 0.017), e.xy / vec2(0.024, 0.017)));
          col *= 1.0 - 0.22 * sock;
          col = mix(col, col * vec3(0.92, 0.84, 0.9), 0.5 * sock);
          float cx = e.x / 0.015;
          float crease = exp(-cx * cx - pow((e.y - 0.0095 - 0.0025 * (1.0 - cx * cx)) / 0.0026, 2.0));
          col *= 1.0 - 0.5 * crease;
          float lidLine = exp(-pow(e.x / 0.013, 2.0) - pow((e.y + 0.0072) / 0.0018, 2.0));
          col *= 1.0 - 0.25 * lidLine;
          float canthus = exp(-pow((abs(p.x) - 0.016) / 0.004, 2.0) - pow(e.y / 0.004, 2.0));
          col = mix(col, vec3(0.48, 0.25, 0.25), 0.45 * canthus);
          // shaved stubble: jaw, chin and upper lip (not on the lips), bluish-grey with a speckle
          float jaw = smoothstep(eyeY - 0.05, eyeY - 0.075, p.y) * smoothstep(0.072, 0.05, abs(p.x)) * step(p.z, frontZ + 0.07);
          float lip = exp(-pow(p.x / 0.024, 2.0) - pow((p.y - (eyeY - 0.068)) / 0.006, 2.0));
          skStub = clamp(max(jaw, lip * 0.9) * (1.0 - lips) * smoothstep(eyeY - 0.16, eyeY - 0.12, p.y), 0.0, 1.0);
          col = mix(col, col * vec3(0.72, 0.74, 0.8) * (0.85 + 0.3 * step(0.55, n1)), skStub * 0.5);
          // eyebrows: arched band above each eye, fuller toward the nose, broken into short hairs
          float bx = sx * e.x;                                   // + toward the temple
          float byc = 0.0175 + 0.005 * (1.0 - pow(clamp(bx / 0.024, -1.0, 1.0), 2.0)) - 0.002 * smoothstep(0.0, 0.025, bx);
          float bth = mix(0.0034, 0.0016, smoothstep(-0.018, 0.026, bx));
          float brow = (1.0 - smoothstep(bth * 0.6, bth + 0.0028, abs(e.y - byc))) * (1.0 - smoothstep(0.016, 0.03, abs(bx - 0.004)))
                     * step(p.z, frontZ + 0.03);
          float bh = skN(vec3(bx * 2200.0, (e.y - byc) * 500.0 + bx * 300.0, 1.0));
          col = mix(col, uHair * (0.7 + 0.6 * bh), clamp(brow * (0.25 + 0.5 * bh), 0.0, 0.6));
          // forehead / nose oil sheen
          skOil = clamp(nose + smoothstep(eyeY + 0.02, eyeY + 0.045, p.y) * smoothstep(0.05, 0.02, abs(p.x)) * 0.7, 0.0, 1.0);
        }
        diffuseColor.rgb = col;
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = skRough >= 0.0 ? skRough : clamp(roughnessFactor * (1.0 - 0.18 * skOil + 0.2 * skStub), 0.35, 1.0);`);
  };
  m.customProgramCacheKey = () => 'skin2';
  return m;
}
