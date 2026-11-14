// Per-soldier light probe: light that reaches a soldier from the lit, wet quay under and around him.
//
// The baked environment (world/atmosphere.js bakeEnvironment) is the night sky over a black ground plane: lamps are
// deliberately not in it (an infinitely distant IBL would put their reflections in the wrong place). For the people that
// left out their main fill light: in a lit port at night the ground under the masts is at ~5-25 lx, and wet asphalt
// (diffuse albedo ~0.07) sends 0.1-0.6 cd/m^2 back up, brighter than the overcast sky. A soldier in the open is lit from
// below by that bounce, and the wet surface also mirrors the lamps (Fresnel-weighted), which puts a warm light on the
// underside of helmets, chins, sleeves and rifles - typical of night photographs in rain.
//
// computeProbe() estimates both on the CPU from the scene's actual lights (same inverse-square, cut-off and spot-cone
// terms as three.js) at a few ground points round the soldier, with visibility tested against the level's collision
// boxes (containers, walls, machinery: a soldier in a lane shadowed from the mast gets little bounce). The result is
// written into three spare texels of the soldier's bone texture (soldier.js PROBE_TEXELS), so every soldier carries
// his own values with no per-draw uniform and no extra draw call; probeShading() adds them to the soldier materials:
//   texel 0: rgb = rho * E_ground (irradiance the ground sends up; on a surface: * (1 - n.y) / 2), a = 1 when valid
//   texel 1: xyz = world direction toward the lamps' mirror image in the wet ground (pointing down)
//   texel 2: rgb = irradiance from that mirror image (a directional light through the normal BRDF, incl. specular)
// The lite tier (low preset) keeps only the diffuse bounce (one texel fetch).
import * as THREE from 'three';
import { SHADER } from '../quality.js';
import { BONE_DEFS, FACE_N, SLING_BONES, PROBE_TEXELS } from './soldier.js';

export const GROUND_RHO = 0.07;        // wet asphalt / concrete, diffuse albedo
const MIRROR_K = 0.55;                 // share of the quay that is wet enough to mirror (film + puddles)
const SAMPLES = [[0, 0], [0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]];

const _l = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3();

/** Segment (a -> b) against axis-aligned boxes {x1, z1, x2, z2, h} standing on y = 0. true = blocked. */
function occluded(ax, ay, az, bx, by, bz, boxes) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (let i = 0; i < boxes.length; i++) {
    const B = boxes[i];
    let t0 = 0.001, t1 = 0.999;
    // x slab
    if (Math.abs(dx) < 1e-9) { if (ax < B.x1 || ax > B.x2) continue; } else {
      let u = (B.x1 - ax) / dx, v = (B.x2 - ax) / dx; if (u > v) { const w = u; u = v; v = w; }
      if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (az < B.z1 || az > B.z2) continue; } else {
      let u = (B.z1 - az) / dz, v = (B.z2 - az) / dz; if (u > v) { const w = u; u = v; v = w; }
      if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-9) { if (ay < 0 || ay > B.h) continue; } else {
      let u = (0 - ay) / dy, v = (B.h - ay) / dy; if (u > v) { const w = u; u = v; v = w; }
      if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

/** three.js punctual light attenuation at distance d (decay 2) and spot cone factor for the direction light -> point. */
function lightAt(L, px, py, pz) {
  _d.set(px - L.position.x, py - L.position.y, pz - L.position.z);
  const d2 = Math.max(_d.lengthSq(), 1e-4), d = Math.sqrt(d2);
  let a = 1 / Math.max(d2, 0.01);
  if (L.distance > 0) { const r = d / L.distance; a *= Math.pow(Math.max(0, 1 - r * r * r * r), 2); }
  if (L.isSpotLight) {
    _t.subVectors(L.target.position, L.position).normalize();
    const c = _t.dot(_d) / d, co = Math.cos(L.angle), cp = Math.cos(L.angle * (1 - L.penumbra));
    const x = Math.min(1, Math.max(0, (c - co) / (cp - co)));
    a *= x * x * (3 - 2 * x);
  }
  return a * L.intensity;
}

/**
 * Probe for a soldier standing at (x, z) (world). lights: three.js Point / Spot lights; boxes: collision boxes
 * {x1, z1, x2, z2, h}; out: Float32Array(PROBE_TEXELS * 4), written in place (see the file comment).
 */
export function computeProbe(out, x, z, lights, boxes) {
  let er = 0, eg = 0, eb = 0;
  let mr = 0, mg = 0, mb = 0, mx = 0, my = 0, mz = 0;
  const sy = 1.0;                                   // reference point on the body for the mirror image (hip height)
  for (const L of lights) {
    if (!L.visible || L.intensity <= 0) continue;
    const lx = L.position.x, ly = L.position.y, lz = L.position.z;
    if (ly <= 0.05) continue;
    // diffuse bounce: irradiance on the ground at a few points round the feet (lamp -> ground, occluded by boxes)
    let e = 0;
    for (const [ox, oz] of SAMPLES) {
      const gx = x + ox, gz = z + oz;
      const a = lightAt(L, gx, 0, gz);
      if (a <= 1e-5) continue;
      const cos = ly / Math.hypot(lx - gx, ly, lz - gz);
      if (occluded(gx, 0.02, gz, lx, ly, lz, boxes)) continue;
      e += a * cos;
    }
    e /= SAMPLES.length;
    er += L.color.r * e; eg += L.color.g * e; eb += L.color.b * e;
    // mirror image of the lamp in the wet ground, seen from the reference point
    const t = sy / (sy + ly), rx = x + (lx - x) * t, rz = z + (lz - z) * t;      // reflection point
    const ix = lx - x, iy = -ly - sy, iz = lz - z, il = Math.hypot(ix, iy, iz);
    const a = lightAt(L, rx, 0, rz);
    if (a <= 1e-5) continue;
    if (occluded(rx, 0.02, rz, lx, ly, lz, boxes) || occluded(x, sy, z, rx, 0.02, rz, boxes)) continue;
    const ci = ly / Math.hypot(lx - rx, ly, lz - rz);                            // incidence cosine at the ground
    const F = 0.02 + 0.98 * Math.pow(1 - ci, 5);                                  // water film (n ~ 1.33)
    // irradiance of the image source at the reference point: I / (total path)^2, with the lamp's cone toward R
    const lr = Math.hypot(lx - rx, ly, lz - rz), dl = lr / il;                     // a uses the lamp -> R distance
    const m = a * dl * dl * F * MIRROR_K;
    mr += L.color.r * m; mg += L.color.g * m; mb += L.color.b * m;
    const w = m * (L.color.r + L.color.g + L.color.b);
    mx += ix / il * w; my += iy / il * w; mz += iz / il * w;
  }
  out[0] = GROUND_RHO * er; out[1] = GROUND_RHO * eg; out[2] = GROUND_RHO * eb; out[3] = 1;
  const ml = Math.hypot(mx, my, mz);
  if (ml > 1e-9) { out[4] = mx / ml; out[5] = my / ml; out[6] = mz / ml; } else { out[4] = 0; out[5] = -1; out[6] = 0; }
  out[7] = 0;
  out[8] = mr; out[9] = mg; out[10] = mb; out[11] = 0;
  return out;
}

/** Ease a soldier's probe toward a new estimate (no popping when he walks from shadow into light). */
export function blendProbe(cur, next, k) {
  if (cur[3] < 0.5) { cur.set(next); return; }
  for (let i = 0; i < cur.length; i++) cur[i] += (next[i] - cur[i]) * k;
  // keep the direction a unit vector
  const l = Math.hypot(cur[4], cur[5], cur[6]) || 1; cur[4] /= l; cur[5] /= l; cur[6] /= l;
}

/** First texel of the probe in the bone texture (identical for every soldier: same skeleton). */
const probeBase = () => (BONE_DEFS.length + FACE_N + SLING_BONES) * 4;

/**
 * Add the probe to a soldier material (chains the previous onBeforeCompile). Skinned meshes only (USE_SKINNING):
 * the probe lives in the bone texture, which the fragment shader reads with texelFetch.
 */
export function probeShading(m) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    const lite = SHADER.lite;
    shader.defines = { ...(shader.defines || {}), SP_BASE: probeBase() };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
#ifdef USE_SKINNING
uniform highp sampler2D boneTexture;
vec4 spTexel(int j) { int sz = textureSize(boneTexture, 0).x; return texelFetch(boneTexture, ivec2(j % sz, j / sz), 0); }
#endif`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
#ifdef USE_SKINNING
      vec4 spG = spTexel(SP_BASE);
      if (spG.a > 0.5) {
        // ground bounce: a uniform diffuse plane below (view factor (1 - n.y) / 2 in world space)
        vec3 spN = inverseTransformDirection(geometryNormal, viewMatrix);
        irradiance += spG.rgb * (0.5 - 0.5 * spN.y);
        ${lite ? '' : `// the lamps mirrored in the wet ground: one extra directional light through the material's own BRDF
        vec4 spD = spTexel(SP_BASE + 1), spC = spTexel(SP_BASE + 2);
        if (spC.r + spC.g + spC.b > 1e-5) {
          IncidentLight spL;
          spL.direction = normalize((viewMatrix * vec4(spD.xyz, 0.0)).xyz);   // toward the image (below)
          spL.color = spC.rgb; spL.visible = true;
          RE_Direct(spL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
        }`}
      }
#endif`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined(USE_SKINNING) && defined(RE_IndirectSpecular)
      // specular: the lit ground seen in the reflection direction (wet film, skin, helmet)
      if (spG.a > 0.5) {
        vec3 spR = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
        radiance += spG.rgb * RECIPROCAL_PI * smoothstep(0.0, -0.35, spR.y);
      }
#endif`);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|probe1' + (SHADER.lite ? 'L' : '');
  return m;
}
