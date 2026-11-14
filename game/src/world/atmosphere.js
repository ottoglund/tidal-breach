// Sky, environment lighting, harbour water, light shafts, lamp glows and rain.
import * as THREE from 'three';
import { textures, WET } from '../materials.js';
import { FOG, SCATTER_GLSL } from '../fog.js';

// ---------------------------------------------------------------------------
// Overcast night sky lit from below by sodium city glow.
// ---------------------------------------------------------------------------
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const SKY_FRAG = /* glsl */`
uniform float uTime; uniform float uEnv; uniform float uScat;
${SCATTER_GLSL}
varying vec3 vDir;
float h(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n3(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  // cloud deck projected on a plane
  vec2 cp = d.xz / max(0.08, y + 0.12) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
  float c = fbm(vec3(cp, uTime * 0.01));
  float c2 = fbm(vec3(cp * 2.7 + 3.0, uTime * 0.02));
  float clouds = smoothstep(0.35, 0.8, c * 0.75 + c2 * 0.35);
  // city glow: warm toward the town (west/south-west) + generic horizon glow
  float town = pow(max(0.0, dot(normalize(vec3(-0.7, 0.0, 0.6)), normalize(vec3(d.x, 0.0, d.z)))), 3.0);
  float horizon = exp(-max(y, 0.0) * 6.0);
  vec3 zenith = vec3(0.006, 0.009, 0.014);
  vec3 glow = mix(vec3(0.05, 0.045, 0.045), vec3(0.16, 0.085, 0.04), town);
  vec3 col = mix(zenith, glow, horizon);
  // clouds catch the city glow from below
  vec3 cloudCol = mix(vec3(0.02, 0.022, 0.026), vec3(0.09, 0.055, 0.035), town * 0.8 + horizon * 0.3);
  col = mix(col, cloudCol * (0.7 + 0.6 * c2), clouds * smoothstep(-0.05, 0.12, y));
  // below horizon: dark sea haze
  col = mix(col, vec3(0.012, 0.016, 0.02), smoothstep(0.0, -0.08, y));
  // lamps glowing through the rain haze against the sky
  col += fogInscatter(d, 420.0) * uScat;
  gl_FragColor = vec4(col * uEnv, 1.0);
}`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uEnv: { value: 1 }, uScat: { value: 1 }, ...FOG },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/** Bakes a low-intensity environment map (sky + bright lamp patches) for IBL. */
export function bakeEnvironment(renderer, lamps) {
  const envScene = new THREE.Scene();
  const sky = createSky();
  sky.material.uniforms.uEnv.value = 3.0;
  sky.material.uniforms.uScat = { value: 0 };
  envScene.add(sky);
  // Lamps are deliberately NOT baked into the environment: an infinitely distant IBL
  // would mirror them in puddles at the wrong place (ghost highlights). Real lamp
  // reflections come from the planar reflection pass and analytic light speculars.
  void lamps;
  // dim ground plane so reflections from below are not black
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x07080a }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1;
  envScene.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(envScene, 0.02);
  pm.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------------------
// Water: dark North Sea harbour water with planar-reflection sampling,
// wind ripples, rain rings and specular glints from the lamps.
// ---------------------------------------------------------------------------
const WATER_VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
varying vec3 vPos;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D tNormal; uniform sampler2D tRefl; uniform mat4 uReflMatrix; uniform float uReflOn;
uniform float uTime; uniform vec3 uLampPos[8]; uniform vec3 uLampCol[8]; uniform int uLampN;
uniform vec3 uDeep; uniform vec3 uSkyRefl;
varying vec3 vPos;
void main(){
  vec2 p = vPos.xz;
  vec3 n1 = texture2D(tNormal, p / 13.0 + vec2(uTime * 0.012, uTime * 0.007)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tNormal, p / 5.3 - vec2(uTime * 0.019, -uTime * 0.011)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(tNormal, p / 1.7 + vec2(uTime * 0.05, uTime * 0.03)).xyz * 2.0 - 1.0;
  vec3 nt = normalize(vec3(n1.xy * 0.6 + n2.xy * 0.45 + n3.xy * 0.25, 1.0));
  vec3 N = normalize(vec3(nt.x, nt.z, nt.y));
  vec3 V = normalize(cameraPosition - vPos);
  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 refl = uSkyRefl;
  if (uReflOn > 0.5) {
    vec4 rc = uReflMatrix * vec4(vPos.x, 0.0, vPos.z, 1.0);
    vec2 ruv = rc.xy / rc.w + N.xz * 0.11;
    refl = textureLod(tRefl, ruv, 1.5).rgb + uSkyRefl * 0.4;
  }
  vec3 col = uDeep * (0.6 + 0.4 * NdV);
  col = mix(col, refl, F);
  // specular glints: lamps sparkle on the chop (very low roughness)
  for (int i = 0; i < 8; i++) {
    if (i >= uLampN) break;
    vec3 L = uLampPos[i] - vPos; float d2 = dot(L, L); L = normalize(L);
    vec3 H = normalize(L + V);
    float s = pow(max(dot(N, H), 0.0), 380.0) * 60.0 + pow(max(dot(N, H), 0.0), 40.0) * 0.6;
    col += uLampCol[i] * s * 900.0 / (d2 + 40.0);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

export function createWater(lamps, y = -2.2) {
  const lampPos = [], lampCol = [];
  for (let i = 0; i < 8; i++) {
    const l = lamps[i];
    lampPos.push(l ? l.pos.clone() : new THREE.Vector3());
    lampCol.push(l ? l.color.clone() : new THREE.Color(0, 0, 0));
  }
  const mat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: true,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      tNormal: { value: textures.water_normal }, uTime: WET.uTime, tRefl: WET.tRefl, uReflMatrix: WET.uReflMatrix, uReflOn: WET.uReflOn,
      uLampPos: { value: lampPos }, uLampCol: { value: lampCol }, uLampN: { value: Math.min(8, lamps.length) },
      uDeep: { value: new THREE.Color(0.004, 0.008, 0.009) }, uSkyRefl: { value: new THREE.Color(0.02, 0.018, 0.018) },
    }),
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 900, 1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.layers.set(1); // not rendered into the planar reflection
  return m;
}

// ---------------------------------------------------------------------------
// Light shafts through rain: additive cones with soft edges, fading near the ground.
// ---------------------------------------------------------------------------
const CONE_VERT = /* glsl */`
varying vec3 vN; varying vec3 vV; varying float vT; varying float vY; varying float vD;
uniform float uLen;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  vT = clamp(-position.y / uLen + 0.5, 0.0, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vD = length(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const CONE_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uTime; uniform float uStrength;
varying vec3 vN; varying vec3 vV; varying float vT; varying float vY; varying float vD;
float hsh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
  float axial = (1.0 - vT); axial = axial * axial * 0.85 + 0.15 * (1.0 - vT);
  float ground = smoothstep(0.0, 3.0, vY);
  float flicker = 0.92 + 0.08 * hsh(vec2(floor(uTime * 30.0), vT));
  float nearFade = smoothstep(4.0, 22.0, vD); // no milky wash when the camera stands inside a beam
  float a = edge * axial * ground * flicker * uStrength * nearFade;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export function lightCone(pos, dir, length, angle, color, strength = 0.05) {
  const r = Math.tan(angle) * length;
  const g = new THREE.ConeGeometry(r, length, 32, 1, true);
  g.translate(0, -length / 2, 0); // apex at origin, opening toward -Y
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: WET.uTime, uStrength: { value: strength }, uLen: { value: length } },
  }));
  m.position.copy(pos);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
  m.layers.set(5); // light shafts: main view only, never mirrored into puddles
  m.renderOrder = 5;
  return m;
}

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
export function lampGlow(pos, color, size = 2.5, intensity = 4) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(intensity), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true }));
  s.position.copy(pos);
  s.scale.setScalar(size);
  s.layers.set(3);
  return s;
}

// ---------------------------------------------------------------------------
// Rain: camera-following instanced streaks, lit by nearby lamps.
// ---------------------------------------------------------------------------
const RAIN_VERT = /* glsl */`
attribute vec4 aSeed; // xyz in [0,1), w random
uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uWind;
uniform vec3 uLampPos[8]; uniform vec3 uLampCol[8]; uniform int uLampN;
varying vec3 vCol; varying float vA; varying float vU;
void main(){
  float speed = 9.0 + aSeed.w * 3.0;
  vec3 vel = vec3(uWind.x, -speed, uWind.z);
  vec3 p = aSeed.xyz * uBox;
  p += vel * uTime;
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;  // wrap around camera
  float len = 0.045 * speed; // motion-blur streak length for ~1/200 s exposure
  vec3 a = p, b = p - normalize(vel) * len;
  vec3 axis = normalize(b - a);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(axis, toCam)) * 0.0075;
  vec3 wp = (position.y > 0.5 ? b : a) + side * (position.x * 2.0 - 1.0);
  vU = position.x;
  // lighting from lamps (forward scattering makes streaks glow near lights)
  vec3 c = vec3(0.012, 0.015, 0.02);
  for (int i = 0; i < 8; i++) { if (i >= uLampN) break; vec3 L = uLampPos[i] - p; c += uLampCol[i] * 30.0 / (dot(L, L) + 30.0); }
  vCol = c;
  float dist = length(p - cameraPosition);
  vA = smoothstep(0.4, 1.5, dist) * (1.0 - smoothstep(uBox.x * 0.35, uBox.x * 0.5, dist));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const RAIN_FRAG = /* glsl */`
varying vec3 vCol; varying float vA; varying float vU;
void main(){ float x = 1.0 - abs(vU * 2.0 - 1.0); gl_FragColor = vec4(vCol * vA * x * 0.55, 1.0); }`;

export function createRain(count, lamps) {
  const base = new THREE.InstancedBufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  base.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  base.instanceCount = count;
  const lampPos = [], lampCol = [];
  for (let i = 0; i < 8; i++) { lampPos.push(lamps[i] ? lamps[i].pos.clone() : new THREE.Vector3()); lampCol.push(lamps[i] ? lamps[i].color.clone() : new THREE.Color(0, 0, 0)); }
  const mat = new THREE.ShaderMaterial({
    vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: WET.uTime, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(36, 22, 36) }, uWind: { value: new THREE.Vector3(1.1, 0, 0.5) },
      uLampPos: { value: lampPos }, uLampCol: { value: lampCol }, uLampN: { value: Math.min(8, lamps.length) },
    },
  });
  const m = new THREE.Mesh(base, mat);
  m.frustumCulled = false;
  m.layers.set(3);
  m.renderOrder = 6;
  return m;
}

// Ground splashes: little crowns that pop around the player.
const BODY_SLOTS = 8, BODY_SPLASHES = 7;   // soldiers near the camera that get splashes, splashes per soldier
// Breath vapour: PUFF_SLOTS nearest soldiers (< 14 m), PUFF_BLOBS soft blobs per exhalation. A breath at ~5 C in rain is
// near saturation, so it condenses into a small, short-lived cloud: it leaves the mouth at ~1 m/s, slows, spreads to
// ~15-20 cm and is gone after ~1.5 s. Seen by the light it scatters, coloured like the local lamps (the soldier's probe).
const PUFF_SLOTS = 6, PUFF_BLOBS = 3, PUFF_SCATTER = 0.03;   // ~ optical depth 0.4 (fresh breath) x isotropic phase (1 / 4 pi): L = 0.03 E
const SPLASH_VERT = /* glsl */`
float sstep01(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
attribute vec4 aSeed; attribute float aBody; uniform float uTime; uniform vec3 uCam; uniform vec4 uBody[${BODY_SLOTS}];
uniform vec4 uPuff[${PUFF_SLOTS}]; uniform vec4 uPuffD[${PUFF_SLOTS}]; uniform vec3 uPuffC[${PUFF_SLOTS}];
varying vec2 vUv; varying float vLife; varying vec3 vPuff;
void main(){
  vPuff = vec3(0.0);
  if (aBody >= 100.0) {
    // breath puff: slot = mouth position + age (w < 0: off), D = forward (xyz); blob k drifts a little differently
    int k = int(aBody) - 100;
    vec4 P = uPuff[k / ${PUFF_BLOBS}];
    float b = float(k - (k / ${PUFF_BLOBS}) * ${PUFF_BLOBS});
    float age = P.w;
    if (age < 0.0 || age > 1.6) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
    vec3 fwd = uPuffD[k / ${PUFF_BLOBS}].xyz;
    vec3 side = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)) + 1e-4);
    float travel = 0.22 * (1.0 - exp(-age * 2.6)) * (0.8 + 0.25 * b);       // decelerating jet
    vec3 p = P.xyz + fwd * (0.02 + travel) + vec3(0.0, 0.05 * age, 0.0) + side * (b - 1.0) * 0.025 * (0.3 + age)
           + vec3(0.12, 0.0, 0.06) * age * age;                               // drift with the wind
    float s = 0.025 + 0.085 * sqrt(age) * (0.85 + 0.15 * b);
    float dens = sstep01(0.0, 0.06, age) * pow(1.0 - age / 1.6, 1.6) * (0.9 - 0.2 * b);
    vPuff = uPuffC[k / ${PUFF_BLOBS}] * dens;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vUv = position.xy; vLife = 0.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(p + (right * (position.x - 0.5) + up * (position.y - 0.5)) * s * 2.0, 1.0);
    return;
  }
  float period = 0.55 + aSeed.w * 0.4;
  float t = uTime / period + aSeed.w * 7.0;
  float cycle = floor(t); vLife = fract(t);
  vec2 rnd = fract(sin(vec2(cycle * 12.9898 + aSeed.x * 78.2, cycle * 39.34 + aSeed.y * 11.1)) * 43758.5453);
  vec3 p = vec3(uCam.x + (rnd.x - 0.5) * 18.0, 0.02, uCam.z + (rnd.y - 0.5) * 18.0);
  float s = 0.03 + 0.06 * vLife;
  if (aBody >= 0.0) {
    // drops bursting on a soldier's shoulders / helmet / head: slot = neck position + heading (w = yaw + 10, 0 = off)
    vec4 B = uBody[int(aBody)];
    if (B.w == 0.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
    float yaw = B.w - 10.0;
    vec3 rgt = vec3(cos(yaw), 0.0, -sin(yaw)), fwd = vec3(sin(yaw), 0.0, cos(yaw));
    bool onHead = rnd.x < 0.3;
    float u = (rnd.y - 0.5) * 2.0;
    p = B.xyz + (onHead ? vec3(0.0, 0.25, 0.0) + rgt * u * 0.06 + fwd * (rnd.x - 0.15) * 0.3
                        : vec3(0.0, -0.03, 0.0) + rgt * (sign(u) * 0.06 + u * 0.12) + fwd * (fract(rnd.x * 7.0) - 0.5) * 0.12);
    s = 0.012 + 0.03 * vLife;
  }
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 wp = p + right * (position.x - 0.5) * s * 2.0 + vec3(0.0, 1.0, 0.0) * position.y * s * 1.3;
  vUv = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const SPLASH_FRAG = /* glsl */`
uniform vec3 uColor; varying vec2 vUv; varying float vLife; varying vec3 vPuff;
void main(){
  if (vPuff.r + vPuff.g + vPuff.b > 0.0) {
    vec2 q = vUv * 2.0 - 1.0;
    float r2 = dot(q, q);
    gl_FragColor = vec4(vPuff * exp(-r2 * 3.2) * (1.0 - smoothstep(0.7, 1.0, r2)), 1.0);
    return;
  }
  // thin upward spray: narrow at the base, fading with height and age
  float x = (vUv.x - 0.5) * (5.0 - vUv.y * 2.5);
  float a = exp(-x * x * 4.0) * (1.0 - vUv.y) * (1.0 - vLife) * (1.0 - vLife);
  gl_FragColor = vec4(uColor * a, 1.0);
}`;
/**
 * Rain splashes: `count` on the ground round the camera plus BODY_SPLASHES on each of up to BODY_SLOTS soldiers
 * (shoulders and head; same instanced draw call). Set the soldiers with mesh.userData.setBodies([{ pos, yaw }]).
 */
export function createSplashes(count) {
  const base = new THREE.InstancedBufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  const nb = count + BODY_SLOTS * BODY_SPLASHES, n = nb + PUFF_SLOTS * PUFF_BLOBS;
  const seeds = new Float32Array(n * 4), body = new Float32Array(n).fill(-1);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  for (let i = count; i < nb; i++) body[i] = Math.floor((i - count) / BODY_SPLASHES);
  for (let i = nb; i < n; i++) body[i] = 100 + (i - nb);
  base.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  base.setAttribute('aBody', new THREE.InstancedBufferAttribute(body, 1));
  base.instanceCount = n;
  const uBody = { value: Array.from({ length: BODY_SLOTS }, () => new THREE.Vector4()) };
  const uPuff = { value: Array.from({ length: PUFF_SLOTS }, () => new THREE.Vector4(0, 0, 0, -1)) };
  const uPuffD = { value: Array.from({ length: PUFF_SLOTS }, () => new THREE.Vector4()) };
  const uPuffC = { value: Array.from({ length: PUFF_SLOTS }, () => new THREE.Color(0, 0, 0)) };
  const m = new THREE.Mesh(base, new THREE.ShaderMaterial({
    vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: WET.uTime, uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(0.06, 0.06, 0.055) }, uBody, uPuff, uPuffD, uPuffC },
  }));
  m.userData.setBodies = (list) => {
    for (let i = 0; i < BODY_SLOTS; i++) { const b = list[i]; if (b) uBody.value[i].set(b.pos.x, b.pos.y, b.pos.z, b.yaw + 10); else uBody.value[i].set(0, 0, 0, 0); }
  };
  // list: [{ pos (world), fwd (world, unit), age (s), light: probe Float32Array (rgb = rho * E_ground) }]
  m.userData.setPuffs = (list) => {
    for (let i = 0; i < PUFF_SLOTS; i++) {
      const b = list[i];
      if (!b) { uPuff.value[i].w = -1; continue; }
      uPuff.value[i].set(b.pos.x, b.pos.y, b.pos.z, b.age);
      uPuffD.value[i].set(b.fwd.x, b.fwd.y * 0.3 - 0.15, b.fwd.z, 0).normalize();
      // scattered light ~ local illuminance (E_ground = probe / rho) x a small single-scattering albedo-thickness
      const L = b.light, k = L && L[3] > 0.5 ? PUFF_SCATTER / 0.07 : 0;
      uPuffC.value[i].setRGB(0.002 + (L ? L[0] : 0) * k, 0.002 + (L ? L[1] : 0) * k, 0.002 + (L ? L[2] : 0) * k);
    }
  };
  m.frustumCulled = false;
  m.layers.set(3);
  return m;
}
