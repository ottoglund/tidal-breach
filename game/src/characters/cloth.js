// Fabric / leather shading layered on top of the shared wet-surface material (materials.js addWet):
//  - dirt: mud/dust gradient from the ground up (rest-pose height, so it stays on the legs while the soldier
//    moves), broken by hash noise plus splash flecks; wet mud is glossier than dry cloth
//  - rain: darkening + a little more gloss when WET.uWetness is high (cloth soaks up); `wetTop` adds a darker,
//    glossier band on up-facing surfaces (shoulders, hood, rig top) that the rain hits first
//  - roughness variation: low-frequency noise so cloth is not uniformly matte (worn/polished patches)
//  - fabric sheen: grazing-angle lift (velvet-like rim) so cloth reads soft, not plastic
//  - fold micro-detail: a tiling cross-hatch of tiny wrinkles perturbs the shading normal
// All noise is evaluated in rest-pose model space (vFabP), so patterns do not swim when the skeleton moves.
import * as THREE from 'three';
import { WET } from '../materials.js';

export function fabricShading(m, o = {}) {
  const dirt = o.dirt ?? 0.5, sheen = o.sheen ?? 0.12, soak = o.soak ?? 0.35, wrinkle = o.wrinkle ?? 0.5;
  const rough = o.rough ?? 0.25, wetTop = o.wetTop ?? 0.3, mudGloss = o.mudGloss ?? 0.45;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uWetness = shader.uniforms.uWetness || WET.uWetness;
    shader.defines = { ...(shader.defines || {}), FAB: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFabP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFabP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFabP;
float fabMud = 0.0, fabWet = 0.0;
float fabH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fabN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fabH(i), fabH(i + vec2(1.0, 0.0)), f.x), mix(fabH(i + vec2(0.0, 1.0)), fabH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float gy = vFabP.y;
        vec2 pq = vec2(vFabP.x + vFabP.z * 0.7, vFabP.z - vFabP.x * 0.5);
        float nz = fabN(pq * 7.0 + vFabP.y * 3.0) * 0.6 + fabN(pq * 23.0 + 5.0) * 0.4;
        // splashed mud: a heavy dark band from the boots up to the knee, flecks and streaks higher up
        float mud = smoothstep(${(0.5 * (0.6 + dirt)).toFixed(3)} + nz * 0.28, 0.0, gy - 0.05) * ${dirt.toFixed(3)};
        float fleck = step(0.7, fabN(pq * 90.0 + vFabP.y * 61.0)) * smoothstep(1.0, 0.15, gy) * ${dirt.toFixed(3)} * (0.4 + nz);
        float drip = smoothstep(0.62, 0.9, fabN(vec2(pq.x * 31.0 + pq.y * 17.0, vFabP.y * 3.5))) * smoothstep(0.95, 0.3, gy) * ${(dirt * 0.5).toFixed(3)};
        fabMud = clamp(mud + fleck * 0.7 + drip, 0.0, 0.9);
        vec3 mudCol = mix(vec3(0.085, 0.07, 0.052), vec3(0.13, 0.105, 0.075), fabN(pq * 41.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, mudCol, fabMud);
        // rain soak: darker, slightly more saturated cloth, strongest on upper surfaces
        float up = clamp(vWetN.y * 0.5 + 0.5, 0.0, 1.0);
        float top = pow(clamp(vWetN.y, 0.0, 1.0), 2.2);
        diffuseColor.rgb *= 1.0 - ${soak.toFixed(3)} * uWetness * (0.45 + 0.55 * up) * (0.6 + 0.4 * nz);
        // shoulders / crown / rig top are visibly wetter: darker and saturated, with a few run-off streaks
        fabWet = top * (0.55 + 0.45 * nz) * ${wetTop.toFixed(3)} * (0.4 + 0.6 * uWetness) * 2.0;
        diffuseColor.rgb *= 1.0 - 0.42 * clamp(fabWet, 0.0, 1.0);
      }`)
      .replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
      {
        // tiny crease detail in rest space (cross-hatched, ~1.2 cm), strongest on large flat cloth
        vec2 wp = vFabP.xz * 53.0 + vFabP.y * 41.0;
        float c1 = abs(fabN(wp * vec2(1.0, 0.35)) - 0.5), c2 = abs(fabN(wp.yx * vec2(0.8, 0.3) + 9.0) - 0.5);
        vec3 pert = vec3(c1 - 0.25, c2 - 0.25, 0.0) * ${wrinkle.toFixed(3)} * 0.18;
        normal = normalize(normal + (viewMatrix * vec4(pert.x, 0.0, pert.y, 0.0)).xyz);
        // roughness: patchy wear, wet mud and soaked cloth are glossier (not mirror-like)
        float rv = fabN(vFabP.xy * 17.0 + vFabP.z * 9.0) * 0.6 + fabN(vFabP.zy * 61.0) * 0.4 - 0.5;
        roughnessFactor = clamp(roughnessFactor * (1.0 + ${rough.toFixed(3)} * 2.0 * rv) * (1.0 - ${mudGloss.toFixed(3)} * fabMud) * (1.0 - 0.3 * clamp(fabWet, 0.0, 1.0)), 0.18, 1.0);
      }`)
      .replace('#include <opaque_fragment>', `
      {
        float nv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        float rim = pow(1.0 - nv, 3.0);
        vec3 sh = mix(diffuseColor.rgb, vec3(0.6), 0.35) * rim * ${sheen.toFixed(3)};
        // lit by the sky / scene light: scale by luminance of what already reached the surface
        float lum = dot(outgoingLight, vec3(0.3, 0.55, 0.15));
        outgoingLight += sh * (0.5 + 3.0 * lum);
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'fab2' + dirt + sheen + soak + wrinkle + rough + wetTop + mudGloss;
  return m;
}
