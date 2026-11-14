// Soft contact shadows under soldiers (ambient occlusion of the ground by the body), ONE instanced draw call for all
// soldiers. Shadow maps only exist near the few shadow-casting masts (and not at all on the low preset), so without
// this a soldier at 10-25 m under a wall pack or in a dark lane had nothing tying the boots / a lying body to the
// quay. Each blob is an ellipse under the body's ground footprint (feet for a standing soldier, the whole body for a
// lying one), sized from the skeleton every frame, multiplied onto whatever is drawn below (wet ground, puddle
// reflections). Main view only (DETAIL layer: not mirrored, not in shadow passes).
import * as THREE from 'three';
import { DETAIL_LAYER } from '../world/props/lod.js';

const MAX = 24;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _h = new THREE.Vector3(), _f = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);

export function createContactShadows(scene) {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: /* glsl */`
      attribute float aDark; varying vec2 vUv; varying float vDark;
      void main() { vUv = uv * 2.0 - 1.0; vDark = aDark; gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying float vDark;
      void main() {
        float r = length(vUv);
        float k = vDark * (1.0 - smoothstep(0.15, 1.0, r)) * (0.75 + 0.25 * (1.0 - r));
        gl_FragColor = vec4(vec3(1.0 - k), 1.0);
      }`,
  });
  const dark = new Float32Array(MAX);
  geo.setAttribute('aDark', new THREE.InstancedBufferAttribute(dark, 1));
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.count = 0; mesh.frustumCulled = false; mesh.layers.set(DETAIL_LAYER); mesh.renderOrder = -1;
  scene.add(mesh);
  return {
    mesh,
    /** cam: camera position; soldiers: scene children with userData.tbSoldier. */
    update(cam) {
      let n = 0;
      for (const o of scene.children) {
        const t = o.userData && o.userData.tbSoldier;
        if (!t || !o.visible || !t.body.visible || n >= MAX) continue;
        if ((o.position.x - cam.x) ** 2 + (o.position.z - cam.z) ** 2 > 45 * 45) continue;
        const B = t.body.skeleton.bones;
        B[15].getWorldPosition(_a); B[18].getWorldPosition(_b); B[4].getWorldPosition(_h); B[0].getWorldPosition(_p);
        _f.addVectors(_a, _b).multiplyScalar(0.5);             // between the feet
        // body axis on the ground: feet -> head (long when lying, short when standing)
        const dx = _h.x - _f.x, dz = _h.z - _f.z, len = Math.hypot(dx, dz);
        const lying = Math.min(1, Math.max(0, (0.9 - _p.y) / 0.6));
        const L = 0.55 + len * 1.0 + 0.25 * lying, W = 0.5 + 0.18 * lying + 0.5 * Math.hypot(_a.x - _b.x, _a.z - _b.z);
        _s.set(W, 1, L);
        _q.setFromAxisAngle(_Y, Math.atan2(dx, dz));
        _p.set((_f.x + _h.x) / 2 * (0.4 + 0.6 * lying) + _f.x * (0.6 - 0.6 * lying), 0.015, (_f.z + _h.z) / 2 * (0.4 + 0.6 * lying) + _f.z * (0.6 - 0.6 * lying));
        mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
        dark[n] = 0.55 + 0.1 * lying;
        n++;
      }
      mesh.count = n; mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true; geo.attributes.aDark.needsUpdate = true;
    },
  };
}
