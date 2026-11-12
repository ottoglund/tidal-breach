// Participating-media fog with analytic in-scattering from point lights.
//
// For each view ray (camera -> shaded point) we integrate the light scattered
// toward the eye by a homogeneous medium around up to 8 point lamps:
//   ∫ ds / (h² + (s - s0)²) = (atan((L - s0)/h) - atan(-s0/h)) / h
// (h = distance of the lamp from the ray, s0 = projection of the lamp on the ray).
// This gives every lamp a physically shaped glow in the rain haze, also in front
// of geometry, at the cost of one atan pair per lamp per pixel.
import * as THREE from 'three';

export const FOG = {
  uFogLampPos: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
  uFogLampCol: { value: Array.from({ length: 8 }, () => new THREE.Color(0, 0, 0)) },
  uFogLampN: { value: 0 },
  uFogScatter: { value: 1 },
};

export const SCATTER_GLSL = /* glsl */`
uniform vec3 uFogLampPos[8];
uniform vec3 uFogLampCol[8];
uniform int uFogLampN;
uniform float uFogScatter;
vec3 fogInscatter(vec3 dir, float len) {
  vec3 scat = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uFogLampN) break;
    vec3 rel = uFogLampPos[i] - cameraPosition;
    float s0 = dot(rel, dir);
    float h = max(length(rel - dir * s0), 0.25);
    float a = (atan((len - s0) / h) - atan(-s0 / h)) / h;
    scat += uFogLampCol[i] * a;
  }
  return scat * uFogScatter;
}
`;

let installed = false;
export function installFog() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogView;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogView = mvPosition.xyz;
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${SCATTER_GLSL}
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogW = ( vec4( vFogView, 0.0 ) * viewMatrix ).xyz;
  float fogL = length( fogW );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor ) + fogInscatter( fogW / max( fogL, 1e-4 ), fogL );
#endif`;
}

/** Give every material in the scene the shared lamp uniforms (chains existing onBeforeCompile). */
export function attachFogUniforms(root) {
  const seen = new Set();
  root.traverse(o => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (seen.has(m) || !m.fog) continue;
      seen.add(m);
      if (m.isShaderMaterial) { Object.assign(m.uniforms, FOG); continue; }
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, r) => { prev?.call(m, shader, r); Object.assign(shader.uniforms, FOG); };
    }
  });
}

/** Pick the lamps that matter most for this camera position. lamps: [{pos, color, power}] */
export function updateFogLamps(lamps, camPos) {
  const ranked = lamps.map(l => ({ l, s: l.power / (l.pos.distanceToSquared(camPos) + 400) }))
    .sort((a, b) => b.s - a.s).slice(0, 8);
  ranked.forEach(({ l }, i) => {
    FOG.uFogLampPos.value[i].copy(l.pos);
    FOG.uFogLampCol.value[i].copy(l.color).multiplyScalar(l.power);
  });
  FOG.uFogLampN.value = ranked.length;
}
