// Performance layer for the static level (draw calls / triangles), visually neutral:
//  - ChunkBatch: like geo.js Batch but splits every material into spatial chunks (so frustum culling
//    works), separates shadow casters from small detail, and puts small detail on LAYER.DETAIL so the
//    planar reflection pass (which only sees layers 0 and 3) skips it.
//  - LodManager: one scene.onBeforeRender hook (runs once per render of the scene: reflection, main,
//    GTAO) that applies distance culling to chunks, per-instance culling + LOD to the container field,
//    and cheap policies for soldiers (reflection / shadow distance limits).
// Fog (FogExp2 0.021) leaves <1.5 % of a surface visible beyond ~100 m, which is what the cull
// distances below are derived from.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Batch } from '../../geo.js';
import { lampGlow } from '../atmosphere.js';
import { WET } from '../../materials.js';

export const DETAIL_LAYER = 6;                 // main camera only (never reflected)
// chunk grid: fine cells for big parts (frustum culling matters), coarse for small detail (distance culling does the work)
const FAR_Z = -98, BIG_Z = 90, DET_Z = 100;  // FAR_Z: north berth (STS cranes), kept apart so it can be distance-culled as a whole
const REFL_MIN_TRIS = 3500;                    // big-part chunks smaller than this are not drawn in the reflection pass
const MIN_BAND = 4000;                         // z-bands below this many triangles are merged with a neighbour
const SHADOW_RANGE = 80;                       // a container farther than this (plan distance) from a shadow light is not rendered into its map
const SHADOW_FREEZE = 90;                      // shadow maps of lights farther than this from the camera are not re-rendered
const BIG_DIAG = 1.7;                          // parts smaller than this (bbox diagonal, m) cast no shadow and are not mirrored in the puddle reflection
export const CULL_DETAIL = 100;                // small-detail chunks are hidden when their nearest point is further than this (m)

let MGR = null;
let FLAT = false; // preset without shadows and reflections: no need to split casters / mirrored parts from small detail
export function lodManager() { return MGR; }

export class ChunkBatch extends Batch {
  build(parent) {
    const meshes = [];
    const bb = new THREE.Box3(), c = new THREE.Vector3(), s = new THREE.Vector3();
    for (const { material, geos, shadow, layer } of this.groups.values()) {
      // 1. classify every part
      const items = [];
      for (const g of geos) {
        g.computeBoundingBox(); bb.copy(g.boundingBox); bb.getCenter(c); bb.getSize(s);
        const diag = s.length();
        const refl = FLAT || diag >= BIG_DIAG ? 1 : 0;       // big part: mirrored in puddles and (if its material allows) a shadow caster
        const cast = !FLAT && shadow && refl ? 1 : 0;
        items.push({ g, tris: g.attributes.position.count / 3, x: c.x, z: c.z, zone: c.z < FAR_Z ? 1 : 0, cast, refl });
      }
      // 2. bucket: big parts (< 130 k triangles in total) are ~one mesh per material and zone - calls matter more than
      //    culling there; small detail (~260 k) gets two z-bands so distance / frustum culling saves triangles
      const key0 = it => `${it.zone}|${it.cast}${it.refl}|` + (it.refl ? Math.floor((it.z + 25) / BIG_Z) : Math.floor((it.z + 25) / DET_Z));
      const bk = new Map();
      for (const it of items) { const k = key0(it); let b = bk.get(k); if (!b) bk.set(k, b = []); b.push(it); }
      // a band with fewer than MIN_BAND triangles joins the next band of the same class (no tiny extra draw calls)
      const out = [];
      const tri = b => b.reduce((s, i) => s + i.tris, 0);
      const keys = [...bk.keys()].sort();
      let carry = null;
      for (const k of keys) {
        let b = bk.get(k);
        if (carry && carry.prefix === k.slice(0, k.lastIndexOf('|'))) { b = carry.items.concat(b); carry = null; }
        else if (carry) { out.push(carry.items); carry = null; }
        if (tri(b) < MIN_BAND) carry = { prefix: k.slice(0, k.lastIndexOf('|')), items: b };
        else out.push(b);
      }
      if (carry) { // fold a trailing tiny band into the last bucket of the same class if there is one
        const last = out.findIndex(o => o[0].zone === carry.items[0].zone && o[0].cast === carry.items[0].cast && o[0].refl === carry.items[0].refl);
        if (last >= 0) out[last] = out[last].concat(carry.items); else out.push(carry.items);
      }
      // 3. one mesh per bucket
      for (const its of out) {
        const merged = mergeGeometries(its.map(i => i.g), false);
        merged.computeBoundingSphere();
        const { cast, refl } = its[0];
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = !!cast;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        const tris = its.reduce((t, i) => t + i.tris, 0);
        if (layer) mesh.layers.set(layer);
        else if (!refl || tris < REFL_MIN_TRIS) mesh.layers.set(DETAIL_LAYER); // a handful of triangles are not worth a draw call in the reflection pass
        parent.add(mesh);
        meshes.push(mesh);
        if (MGR) if (!refl) MGR.addChunk(mesh, merged.boundingSphere, CULL_DETAIL); // (big parts, incl. the far STS cranes, are never distance-culled: they read as silhouettes against the sky)
        for (const i of its) i.g.dispose();
      }
    }
    this.groups.clear();
    return meshes;
  }
}

// ---------------------------------------------------------------------------
// Container field: every container as an instance of one of three LOD meshes, chosen per frame.
// ---------------------------------------------------------------------------
export class ContainerField {
  /**
   * items: [{ pos: Vector3 (centre), matrix: Matrix4, color: int, minLod: 0|1|2, decals: [Matrix4 x3], cell: float }]
   * geo: { paint: [lod0, lod1, lod2, lod3 geometry], galv, galvMat }
   */
  constructor(parent, items, geo, materialFor, decalMat, decalGeo, proxyDims, radius = 7.3) {
    this.items = items; this.radius = radius;
    this.groups = new Map(); // color -> { items, paint:[m0,m1,m2], galv }
    for (const it of items) {
      if (!this.groups.has(it.color)) this.groups.set(it.color, { items: [], paint: [], galv: null });
      this.groups.get(it.color).items.push(it);
    }
    const mk = (g, m, n) => {
      const mesh = new THREE.InstancedMesh(g, m, n);
      mesh.castShadow = false; mesh.receiveShadow = true; // shadows come from the proxy box below (corrugation is below shadow-map resolution)
      mesh.frustumCulled = false; // per-instance culling is done in update()
      mesh.count = 0; // stays visible until the first update() so renderer.compile() sees every program
      parent.add(mesh); return mesh;
    };
    this.all = [];
    for (const [color, g] of this.groups) {
      const n = g.items.length, m = materialFor(color);
      g.paint = geo.paint.map(pg => mk(pg, m, n));
      g.galv = mk(geo.galv, geo.galvMat, n);
      this.all.push(...g.paint, g.galv);
    }
    const nd = items.length * 3;
    this.decalCells = new Float32Array(nd);
    this.decals = mk(decalGeo.clone(), decalMat, nd);
    this.decals.castShadow = false;
    this.decals.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(this.decalCells, 1));
    this.decals.setColorAt(0, new THREE.Color(1, 1, 1)); // allocate instanceColor up front (stable shader variant)
    this.all.push(this.decals);
    // Shadow proxy: ONE instanced box (12 triangles) for every container, drawn into the shadow maps only
    // (colour/depth writes off in the main view). Slightly inset so the real walls never self-shadow.
    const { L, W, H } = proxyDims;
    const box = new THREE.BoxGeometry(W - 0.08, H - 0.1, L - 0.08).translate(0, H / 2, 0);
    const proxy = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), items.length);
    items.forEach((it, i) => proxy.setMatrixAt(i, it.matrix));
    proxy.castShadow = true; proxy.receiveShadow = false; proxy.layers.set(DETAIL_LAYER);
    proxy.frustumCulled = false; proxy.count = 0;
    parent.add(proxy);
    this.proxy = proxy; this.proxyMatrices = items.map(it => it.matrix);
    this.frustum = new THREE.Frustum(); this.pv = new THREE.Matrix4(); this.sph = new THREE.Sphere();
    const k = MGR ? MGR.lodScale : 1;
    this.lod0 = 20 * k; this.lod1 = 55 * k; this.lod2 = 88 * k; this.maxD = 200;
  }

  /** Called right before a shadow-casting light renders its depth map: only the proxy boxes in range of that light. */
  shadowBegin(lp) {
    for (const m of this.all) m.visible = false;
    const p = this.proxy; let n = 0;
    for (const it of this.items) { if (Math.hypot(it.pos.x - lp.x, it.pos.z - lp.z) > SHADOW_RANGE) continue; p.setMatrixAt(n++, it.matrix); }
    p.count = n; p.visible = n > 0; p.instanceMatrix.needsUpdate = true;
  }

  update(cam, refl) {
    this.proxy.visible = false;
    this.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const e = cam.matrixWorld.elements, cx = e[12], cz = e[14];
    const lod0 = refl ? 0 : this.lod0, lod1 = refl ? 0 : this.lod1;      // reflection (blurry low-res RT): only the plain box (lod 3) beyond ~15 m, lod 1 nearer
    const maxD = refl ? 80 : this.maxD;
    for (const m of this.all) m.count = 0;
    let nd = 0;
    const cells = this.decalCells;
    for (const it of this.items) {
      const d = Math.hypot(it.pos.x - cx, it.pos.z - cz) - this.radius;
      if (d > maxD) continue;
      this.sph.center.copy(it.pos); this.sph.radius = this.radius + 1;
      if (!this.frustum.intersectsSphere(this.sph)) continue;
      let lod = d < lod0 ? 0 : d < lod1 ? 1 : d < this.lod2 ? 2 : 3;
      if (refl) lod = d < 15 ? 1 : 3;
      if (lod < it.minLod) lod = it.minLod;
      const g = it.group;
      const pm = g.paint[lod];
      pm.setMatrixAt(pm.count++, it.matrix);
      if (lod === 0) { const gm = g.galv; gm.setMatrixAt(gm.count++, it.matrix); }
      if (lod <= 1 && !refl) {
        for (let k = 0; k < 3; k++) { this.decals.setMatrixAt(nd, it.decals[k]); this.decals.setColorAt(nd, it.decalColor); cells[nd] = it.cell; nd++; }
      }
    }
    this.decals.count = nd;
    for (const m of this.all) {
      m.visible = m.count > 0;
      if (m.visible) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
    if (this.decals.visible) this.decals.geometry.attributes.aCell.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
export class LodManager {
  constructor(scene) {
    this.scene = scene; this.chunks = []; this.fields = []; this.shadowLights = [];
    this.lodScale = 1; // < 1 on the low preset: LOD / far-body / rifle distances shrink
    scene.onBeforeRender = (renderer, sc, camera) => this.update(camera);
  }
  addChunk(mesh, sphere, maxD) { this.chunks.push({ mesh, x: sphere.center.x, z: sphere.center.z, r: sphere.radius, maxD }); }
  addField(f) { this.fields.push(f); }

  /**
   * Register a shadow-casting light. Two things:
   *  - its depth pass is wrapped (updateMatrices runs right before the light renders its map, after the main view's
   *    render list is built) so the shadow pass can use cheaper stand-ins than the main view: proxy boxes for
   *    containers and one-call soldiers;
   *  - while the camera is > 90 m away the map is simply not re-rendered (static casters stay valid).
   */
  attachShadowLight(light) {
    const sh = light.shadow, orig = sh.updateMatrices.bind(sh);
    sh.updateMatrices = (l, i) => { this.shadowBegin(light.position); orig(l, i); };
    this.shadowLights.push(light);
  }

  shadowBegin(lp) {
    for (const f of this.fields) if (f.shadowBegin) f.shadowBegin(lp);
    for (const o of this.scene.children) {
      const s = o.userData && o.userData.tbSoldier;
      if (!s) continue;
      s.body.material = s.single; // 1 depth draw instead of 8 material groups
      // MakeHuman body: beyond 12 m the decimated far body also stands in for the shadow (close bodies keep their own
      // silhouette so self-shadowing matches). The geometry captured for the main view's render list is unaffected.
      if (s.far) s.body.geometry = (s.dist ?? 0) > 12 ? s.far : s.geo;
    }
  }

  update(cam) {
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements, cx = e[12], cz = e[14];
    const refl = (cam.layers.mask & 2) === 0; // the planar-reflection camera lacks the GROUND layer
    for (const c of this.chunks) c.mesh.visible = Math.hypot(c.x - cx, c.z - cz) - c.r < c.maxD;
    for (const f of this.fields) f.update(cam, refl);
    if (!refl) for (const l of this.shadowLights) l.shadow.autoUpdate = Math.hypot(l.position.x - cx, l.position.z - cz) < SHADOW_FREEZE;
    // soldiers: skinned bodies and rifles are many draw calls each, so limit where they are drawn twice
    for (const o of this.scene.children) {
      const s = o.userData && o.userData.tbSoldier;
      if (!s) continue;
      const d = Math.hypot(o.position.x - cx, o.position.z - cz);
      s.body.castShadow = d < 36;
      // far (> 42 m) or mirrored in a puddle: one draw call with the camo material instead of 7-8 material groups;
      // with the MakeHuman body also the decimated far body (~3 k instead of ~28 k triangles)
      const far = d > 42 * this.lodScale || refl;
      s.body.material = far ? s.single : s.mats;
      if (s.far) s.body.geometry = far ? s.far : s.geo;
      if (!refl) s.dist = d;
      // mirrored soldiers only where the puddle reflection is large enough to read them
      s.body.layers.mask = refl && d >= 28 ? 0 : 1;
      if (s.rifle) {
        // rifle = 3-4 draw calls: dropped beyond 62 m (main) / 14 m (puddle reflection) / 9 m (shadow); muzzle flash mesh always stays
        const lm = (refl ? d < 14 : d < 62 * this.lodScale) ? 1 : 0, sh = d < 9;
        s.rifle.traverse(m => { if (m.isMesh && m !== s.flashMesh) { m.layers.mask = lm; m.castShadow = sh; } });
      }
    }
  }
}

export function createLod(scene, quality) {
  MGR = new LodManager(scene);
  FLAT = !!quality && !quality.reflections && !quality.shadows;
  if (quality && quality.name === 'low') MGR.lodScale = 0.65;
  return MGR;
}

// ---------------------------------------------------------------------------
// Lamp glows: the ~100 individual additive Sprites (one draw call each, in the main and the reflection pass)
// become ONE instanced billboard mesh with the same texture, size, colour*intensity and fog behaviour.
// list: [{ pos: Vector3, color, size, intensity }] -> Mesh on layer 3 (FX), like the sprites were.
// ---------------------------------------------------------------------------
export function buildGlowField(list) {
  const n = list.length;
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
  const aPos = new Float32Array(n * 3), aCol = new Float32Array(n * 3), aSize = new Float32Array(n);
  const c = new THREE.Color();
  list.forEach((it, i) => {
    aPos.set([it.pos.x, it.pos.y, it.pos.z], i * 3);
    c.set(it.color).multiplyScalar(it.intensity); aCol.set([c.r, c.g, c.b], i * 3);
    aSize[i] = it.size;
  });
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3));
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 1));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
  const tex = lampGlow(new THREE.Vector3(), 0xffffff).material.map; // shared radial glow texture
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), { map: { value: tex } }),
    vertexShader: /* glsl */`
      attribute vec3 aPos; attribute vec3 aCol; attribute float aSize;
      varying vec2 vUv; varying vec3 vCol;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vCol = aCol;
        vec4 mvPosition = viewMatrix * vec4(aPos, 1.0);
        mvPosition.xy += position.xy * aSize;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; varying vec2 vUv; varying vec3 vCol;
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D(map, vUv);
        gl_FragColor = vec4(vCol * t.rgb, t.a);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.layers.set(3);
  return mesh;
}

// ---------------------------------------------------------------------------
// Repeated small props (oil drums): instanced, culled per instance, two LODs, shadow casters like before.
// ---------------------------------------------------------------------------
export class PropField {
  /** items: [{ matrix: Matrix4, material }]; geos: [near, far] */
  constructor(parent, items, geos, { lod1: lod1Dist = 22, maxD = 75, radius = 0.8, center = new THREE.Vector3(0, 0.45, 0) } = {}) {
    this.lod1Dist = lod1Dist; this.maxD = maxD; this.radius = radius;
    this.byMat = new Map();
    for (const it of items) {
      it.pos = center.clone().applyMatrix4(it.matrix);
      if (!this.byMat.has(it.material)) this.byMat.set(it.material, { items: [], meshes: [] });
      this.byMat.get(it.material).items.push(it);
    }
    for (const [material, g] of this.byMat) {
      g.meshes = geos.map(geo => {
        const m = new THREE.InstancedMesh(geo, material, g.items.length);
        m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
        parent.add(m); return m;
      });
    }
    this.frustum = new THREE.Frustum(); this.pv = new THREE.Matrix4(); this.sph = new THREE.Sphere();
    if (MGR) MGR.addField(this);
  }
  get all() { const a = []; for (const g of this.byMat.values()) a.push(...g.meshes); return a; }
  update(cam, refl) {
    this.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const e = cam.matrixWorld.elements, cx = e[12], cz = e[14];
    const maxD = refl ? 28 : this.maxD, lod1 = refl ? 0 : this.lod1Dist; // reflection: only drums close to the camera, lowest LOD
    for (const g of this.byMat.values()) {
      g.meshes[0].count = 0; g.meshes[1].count = 0;
      for (const it of g.items) {
        const d = Math.hypot(it.pos.x - cx, it.pos.z - cz) - this.radius;
        if (d > maxD) continue;
        this.sph.center.copy(it.pos); this.sph.radius = this.radius + 3; // + 3 m: just-off-screen drums still shade the view
        if (!this.frustum.intersectsSphere(this.sph)) continue;
        const m = g.meshes[d < lod1 ? 0 : 1];
        m.setMatrixAt(m.count++, it.matrix);
      }
      for (const m of g.meshes) { m.visible = m.count > 0; if (m.visible) m.instanceMatrix.needsUpdate = true; }
    }
  }
}

// ---------------------------------------------------------------------------
// Light shafts: the 16 separate cone meshes (one draw call + one ShaderMaterial each) become one mesh. Same shader
// as atmosphere.js lightCone(), with the per-cone transform baked into the vertices and the colour as an attribute.
// list: [{ pos, dir, color, length, angle, strength }]
// ---------------------------------------------------------------------------
export function buildConeField(list) {
  const geos = [];
  for (const it of list) {
    const r = Math.tan(it.angle) * it.length;
    const g = new THREE.ConeGeometry(r, it.length, 32, 1, true);
    g.translate(0, -it.length / 2, 0);
    const p = g.attributes.position, aT = new Float32Array(p.count), aColor = new Float32Array(p.count * 3);
    const col = new THREE.Color(it.color);
    for (let i = 0; i < p.count; i++) {
      aT[i] = Math.min(1, Math.max(0, -p.getY(i) / it.length + 0.5));
      aColor.set([col.r, col.g, col.b], i * 3);
    }
    g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    g.deleteAttribute('uv');
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), it.dir.clone().normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(it.pos, q, new THREE.Vector3(1, 1, 1))); // also rotates the normals
    geos.push(g);
  }
  const strength = list.length ? list[0].strength : 0.016;
  const m = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      attribute float aT; attribute vec3 aColor;
      varying vec3 vN; varying vec3 vV; varying float vT; varying float vY; varying float vD; varying vec3 vC;
      void main(){
        vec4 wp = vec4(position, 1.0);
        vY = wp.y; vT = aT; vC = aColor;
        vN = normalize(normal);
        vV = normalize(cameraPosition - wp.xyz);
        vD = length(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uStrength;
      varying vec3 vN; varying vec3 vV; varying float vT; varying float vY; varying float vD; varying vec3 vC;
      float hsh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float axial = (1.0 - vT); axial = axial * axial * 0.85 + 0.15 * (1.0 - vT);
        float ground = smoothstep(0.0, 3.0, vY);
        float flicker = 0.92 + 0.08 * hsh(vec2(floor(uTime * 30.0), vT));
        float nearFade = smoothstep(4.0, 22.0, vD);
        float a = edge * axial * ground * flicker * uStrength * nearFade;
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: WET.uTime, uStrength: { value: strength } },
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), m);
  mesh.frustumCulled = false;
  mesh.layers.set(5); // light shafts: main view only, never mirrored into puddles
  mesh.renderOrder = 5;
  return mesh;
}
