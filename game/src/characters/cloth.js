// Fabric / leather shading layered on top of the shared wet-surface material (materials.js addWet):
//  - dirt: mud/dust gradient from the ground up (world height), broken by a cheap hash noise
//  - rain: extra darkening + a little more gloss when WET.uWetness is high (cloth soaks up)
//  - fabric sheen: grazing-angle lift (velvet-like rim) so cloth reads soft, not plastic
//  - fold micro-detail: a tiling cross-hatch of tiny wrinkles perturbs the shading normal
import * as THREE from 'three';
import { WET } from '../materials.js';

export function fabricShading(m, o = {}) {
  const dirt = o.dirt ?? 0.5, sheen = o.sheen ?? 0.12, soak = o.soak ?? 0.35, wrinkle = o.wrinkle ?? 0.5;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uWetness = shader.uniforms.uWetness || WET.uWetness;
    const u = { dirt, sheen, soak, wrinkle };
    shader.defines = { ...(shader.defines || {}), FAB: '' };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
float fabH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fabN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fabH(i), fabH(i + vec2(1.0, 0.0)), f.x), mix(fabH(i + vec2(0.0, 1.0)), fabH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float gy = vWetPos.y;
        float nz = fabN(vWetPos.xz * 7.0 + vWetPos.y * 3.0) * 0.6 + fabN(vWetPos.xz * 23.0 + 5.0) * 0.4;
        float mud = smoothstep(${(0.55 * (0.6 + dirt)).toFixed(3)} + nz * 0.25, 0.0, gy - 0.05) * ${dirt.toFixed(3)};
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.07, 0.052), clamp(mud, 0.0, 0.85));
        // rain soak: darker, slightly more saturated cloth, strongest on upper surfaces
        float up = clamp(vWetN.y * 0.5 + 0.5, 0.0, 1.0);
        diffuseColor.rgb *= 1.0 - ${soak.toFixed(3)} * uWetness * (0.45 + 0.55 * up) * (0.6 + 0.4 * nz);
      }`)
      .replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
      {
        // tiny crease detail in world space (cross-hatched, ~1.2 cm), strongest on large flat cloth
        vec2 wp = vWetPos.xz * 53.0 + vWetPos.y * 41.0;
        float c1 = abs(fabN(wp * vec2(1.0, 0.35)) - 0.5), c2 = abs(fabN(wp.yx * vec2(0.8, 0.3) + 9.0) - 0.5);
        vec3 pert = vec3(c1 - 0.25, c2 - 0.25, 0.0) * ${wrinkle.toFixed(3)} * 0.18;
        normal = normalize(normal + (viewMatrix * vec4(pert.x, 0.0, pert.y, 0.0)).xyz);
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
  m.customProgramCacheKey = () => 'fab' + dirt + sheen + soak + wrinkle;
  return m;
}
