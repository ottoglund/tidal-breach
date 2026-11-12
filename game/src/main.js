// TIDAL BREACH v0.2 – boot, lighting rig, main loop, QA hooks and perf overlay.
import * as THREE from 'three';
import { pickQuality, saveQuality } from './quality.js';
import { loadTextures, updateWet, WET } from './materials.js';
import { Pipeline, LAYER } from './renderer.js';
import { buildLevel } from './world/level.js';
import { createSky, bakeEnvironment, createWater, createRain, createSplashes } from './world/atmosphere.js';
import { Weapon } from './weapon.js';
import { Audio } from './audio.js';
import { Game } from './game.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

function hasWebGL2() { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (_) { return false; } }

async function boot() {
  if (!hasWebGL2()) { $('fallback').style.display = 'flex'; return; }
  if (isTouch) {
    document.body.classList.add('touch');
    $('desktopHelp').innerHTML = '<div><b>VÄNSTER</b> Virtuell joystick</div><div><b>HÖGER</b> Svep för att sikta</div><div><b>FIRE</b> Skjut</div><div><b>USE</b> Sabotera / evakuera</div>';
    $('menuNote').textContent = 'LIGGANDE LÄGE REKOMMENDERAS · ANVÄND HÖRLURAR';
  }
  const quality = pickQuality(isTouch);
  document.querySelectorAll('.quality button').forEach(b => {
    b.classList.toggle('on', b.dataset.q === quality.name);
    b.onclick = () => { saveQuality(b.dataset.q); const u = new URL(location.href); u.searchParams.set('q', b.dataset.q); location.href = u.toString(); };
  });

  const pipe = new Pipeline($('viewport'), quality);
  const { renderer, scene } = pipe;
  await loadTextures(renderer, quality.anisotropy, f => { $('loadfill').style.width = Math.round(f * 85) + '%'; });
  $('loadtext').textContent = 'BYGGER HAMNEN…';
  await new Promise(r => setTimeout(r, 0));

  // ---- world
  const level = buildLevel(scene, quality);
  scene.fog = new THREE.FogExp2(0x0b0d10, 0.021);
  scene.add(createSky());
  const lampHeads = level.lamps.map(l => l.pos);
  scene.environment = bakeEnvironment(renderer, lampHeads);
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0x3a4552, 0x0a0908, 0.35));
  const water = createWater(level.lamps);
  scene.add(water);

  // ---- lights: shadowed spots for the masts nearest the slice, unshadowed point lights for wall packs etc.
  const lights = [];
  const spawn = new THREE.Vector3(0, 0, 24);
  level.spots.sort((a, b) => a.pos.distanceTo(spawn) - b.pos.distanceTo(spawn));
  level.spots.forEach((s, i) => {
    const l = new THREE.SpotLight(s.color, s.intensity, 0, s.angle, s.penumbra, 2);
    l.position.copy(s.pos);
    l.target.position.copy(s.target);
    if (quality.shadows && i < quality.shadowLights) {
      l.castShadow = true;
      l.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      l.shadow.camera.near = 6; l.shadow.camera.far = 70;
      l.shadow.bias = -0.0004; l.shadow.normalBias = 0.03; l.shadow.radius = 3;
    }
    scene.add(l, l.target);
    lights.push(l);
  });
  level.points.sort((a, b) => a.pos.distanceTo(spawn) - b.pos.distanceTo(spawn)).slice(0, quality.pointLights).forEach(p => {
    const l = new THREE.PointLight(p.color, p.intensity, p.distance, 2);
    l.position.copy(p.pos);
    scene.add(l); lights.push(l);
  });

  // ---- weather
  const rain = createRain(quality.rain, level.lamps);
  scene.add(rain);
  const splashes = createSplashes(quality.splashes);
  scene.add(splashes);

  // ---- player
  const weapon = new Weapon(pipe.weaponScene);
  pipe.weaponScene.environment = scene.environment;
  pipe.weaponScene.environmentIntensity = 0.4;
  const audio = new Audio();
  const game = new Game({ pipeline: pipe, level, weapon, audio, isTouch, lights });

  // exposure tuned for the night scene (physically based light units)
  renderer.toneMappingExposure = 0.9;

  // warm up shaders before the player starts
  pipe.camera.position.set(0, 1.7, 24);
  renderer.compile(scene, pipe.camera);
  $('loadfill').style.width = '100%';
  $('loading').style.display = 'none';
  $('startBtn').disabled = false;

  // ---- perf overlay (?perf=1 or F9)
  const perf = { on: params.get('perf') === '1', frames: 0, acc: 0, fps: 0, ms: 0, worst: 0 };
  const glInfo = (() => { const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })();
  addEventListener('keydown', e => { if (e.code === 'F9') { perf.on = !perf.on; $('perf').style.display = perf.on ? 'block' : 'none'; } });
  if (perf.on) $('perf').style.display = 'block';

  // ---- loop
  let last = performance.now() / 1000;
  let hold = false;
  function renderAt(now, dt) {
    game.update(dt, now);
    game.syncVisuals(now, dt);
    updateWet(now);
    rain.material.uniforms.uCam.value.copy(pipe.camera.position);
    splashes.material.uniforms.uCam.value.copy(pipe.camera.position);
    pipe.render(now, game.hitFlash);
  }
  function frame(nowMs) {
    if (hold) { requestAnimationFrame(frame); return; }
    const now = nowMs / 1000;
    const rawDt = now - last; last = now;
    const dt = Math.min(0.05, rawDt);
    try {
      renderAt(now, dt);
    } catch (err) {
      console.error(err);
      if (game.mode === 'play') { game.pause(); $('pause').querySelector('h2').textContent = 'GRAFIKFEL'; $('pause').querySelector('.note').textContent = String(err.message || err); }
    }
    perf.frames++; perf.acc += rawDt; perf.worst = Math.max(perf.worst, rawDt);
    if (perf.acc > 0.5) {
      perf.fps = perf.frames / perf.acc; perf.ms = perf.acc / perf.frames * 1000;
      if (perf.on) {
        const info = renderer.info, mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB JS heap' : 'JS heap n/a';
        const s = renderer.getDrawingBufferSize(new THREE.Vector2());
        $('perf').textContent = `${perf.fps.toFixed(1)} FPS  ${perf.ms.toFixed(1)} ms (worst ${(perf.worst * 1000).toFixed(0)} ms)\n${s.x}×${s.y} @ q=${quality.name}\ncalls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  tex ${info.memory.textures}  geo ${info.memory.geometries}\n${mem}\n${glInfo}`;
      }
      perf.frames = 0; perf.acc = 0; perf.worst = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- QA hooks: only on explicit ?qa=1 URLs
  if (params.get('qa') === '1') {
    game.qaMode = true;
    Object.defineProperty(window, '__TIDAL_QA__', {
      value: Object.freeze({
        state: () => ({ mode: game.mode, x: game.player.x, z: game.player.z, hp: game.player.hp, armor: game.player.armor, ammo: game.player.ammo, reserve: game.player.reserve, kills: game.player.kills, shots: game.player.shots, hits: game.player.hits, reloading: game.player.reloading, targets: game.nodes.map(n => ({ done: n.done, x: n.x, z: n.z })), enemies: game.enemies.filter(e => e.alive).length }),
        position: (x, z) => { game.player.x = x; game.player.z = z; },
        view: (x, z, yaw, pitch = 0) => { Object.assign(game.player, { x, z, yaw, pitch }); },
        fire: () => game.shoot(), reload: () => game.reload(), interact: () => game.interact(), damage: n => game.damage(n),
        pause: () => game.pause(), resume: () => game.resume(), restart: () => game.start(),
        // deterministic simulation step (independent of render speed)
        step: (sec) => { const n = Math.ceil(sec / 0.02); for (let i = 0; i < n; i++) game.update(0.02, performance.now() / 1000 + i * 0.02); },
        freeze: (on) => { game.frozen = !!on; },
        peaceful: () => { for (const e of game.enemies) { e.alive = false; e.deathAt = -1e9; } },
        perf: () => ({ fps: perf.fps, ms: perf.ms, quality: quality.name, renderer: glInfo, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
        quality: quality.name,
        // capture mode: stop the realtime loop and render single frames on demand (slow software GPUs)
        hold: (on) => { hold = !!on; },
        renderFrame: (t = 10) => { const t0 = performance.now(); renderAt(t, 0.016); renderer.getContext().finish(); return performance.now() - t0; },
      }), configurable: false,
    });
  }
}

boot().catch(err => { console.error(err); $('menuNote').textContent = 'Kunde inte starta grafiken: ' + (err.message || err); });
