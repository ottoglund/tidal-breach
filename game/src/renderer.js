// Render pipeline: HDR scene -> (GTAO) -> weapon overlay -> bloom -> tone map -> film finish.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { WET } from './materials.js';

export const LAYER = { WORLD: 0, GROUND: 1, WEAPON: 2, FX: 3, RAIN: 4, SHAFTS: 5, DETAIL: 6 }; // DETAIL: small static props, main view only (not mirrored in the puddle reflection; see world/props/lod.js)

const FinalShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHit: { value: 0 }, uGrain: { value: 0.045 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
  uniform sampler2D tDiffuse; uniform float uTime; uniform float uHit; uniform float uGrain; uniform vec2 uRes; varying vec2 vUv;
  float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main(){
    vec2 c = vUv - 0.5;
    float r2 = dot(c, c);
    // subtle lateral chromatic aberration toward the edges (lens)
    vec2 off = c * r2 * 0.012;
    vec3 col;
    col.r = texture2D(tDiffuse, vUv + off).r;
    col.g = texture2D(tDiffuse, vUv).g;
    col.b = texture2D(tDiffuse, vUv - off).b;
    // vignette
    col *= mix(1.0, 0.55, smoothstep(0.08, 0.5, r2));
    // damage: desaturate + red edge
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(l), uHit * 0.5);
    col += vec3(0.35, 0.0, 0.0) * uHit * smoothstep(0.05, 0.4, r2);
    // film grain, stronger in the shadows
    float g = hash(vUv * uRes + fract(uTime * 13.7) * 300.0) - 0.5;
    col += g * uGrain * (1.0 - l * 0.7);
    gl_FragColor = vec4(col, 1.0);
  }`,
};

export class Pipeline {
  constructor(container, quality) {
    this.q = quality;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    r.setSize(innerWidth, innerHeight);
    // ?tm=agx|aces lets us compare tone mapping on real displays
    r.toneMapping = new URLSearchParams(location.search).get('tm') === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = quality.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 900);
    this.camera.rotation.order = 'YXZ';
    this.camera.layers.enable(LAYER.GROUND); this.camera.layers.enable(LAYER.FX); this.camera.layers.enable(LAYER.RAIN); this.camera.layers.enable(LAYER.SHAFTS); this.camera.layers.enable(LAYER.DETAIL);
    this.weaponScene = new THREE.Scene();
    this.weaponCamera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.01, 10);

    // planar reflection of the yard (y = 0) for wet ground & puddles
    this.reflCamera = new THREE.PerspectiveCamera();
    this.reflCamera.layers.set(LAYER.WORLD); this.reflCamera.layers.enable(LAYER.FX);
    if (quality.reflections) {
      this.reflRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
      WET.tRefl.value = this.reflRT.texture;
      WET.uReflOn.value = 1;
    }

    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality.msaa });
    const composer = this.composer = new EffectComposer(r, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (quality.ao) {
      const ao = this.ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.75;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 12 });
      composer.addPass(ao);
    }
    const wp = new RenderPass(this.weaponScene, this.weaponCamera);
    wp.clear = false; wp.clearDepth = true;
    composer.addPass(wp);
    if (quality.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.42, 0.6, 1.25);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
    this.final = new ShaderPass(FinalShader);
    composer.addPass(this.final);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.camera.aspect = this.weaponCamera.aspect = w / h;
    this.camera.updateProjectionMatrix(); this.weaponCamera.updateProjectionMatrix();
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.final.uniforms.uRes.value.set(s.x, s.y);
    if (this.reflRT) this.reflRT.setSize(Math.max(64, Math.round(s.x * this.q.reflScale)), Math.max(64, Math.round(s.y * this.q.reflScale)));
  }

  renderReflection() {
    if (!this.reflRT) return;
    const cam = this.camera, rc = this.reflCamera;
    cam.updateMatrixWorld();
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    if (camPos.y <= 0.01) return;
    const normal = new THREE.Vector3(0, 1, 0);
    // mirror camera position and look target across y = 0
    const rot = new THREE.Matrix4().extractRotation(cam.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    rc.position.set(camPos.x, -camPos.y, camPos.z);
    rc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    rc.lookAt(look.x, -look.y, look.z);
    rc.far = cam.far; rc.near = cam.near;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(cam.projectionMatrix);
    // texture matrix
    const tm = WET.uReflMatrix.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    // oblique near plane = reflection plane (clip everything below y=0)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3());
    plane.applyMatrix4(rc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = rc.projectionMatrix.elements;
    const q = new THREE.Vector4((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1 - 0.003; p[14] = clip.w;
    const r = this.renderer;
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.reflRT);
    r.clear();
    r.render(this.scene, rc);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = prevShadow;
  }

  render(time, hit = 0) {
    this.final.uniforms.uTime.value = time;
    this.final.uniforms.uHit.value = hit;
    this.renderReflection();
    this.composer.render();
  }
}
