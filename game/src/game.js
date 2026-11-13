// Mission rules, player controller, guards AI, combat, HUD and QA hooks.
// Rules and numbers are ported 1:1 from the v0.1 game (index.html) so the
// mission plays identically; presentation and feel are new.
import * as THREE from 'three';
import { BOUNDS, SPAWN, NODES, EXTRACT, ENEMY_SPAWNS } from './world/level.js';
import { createGuard, poseGuard } from './enemies.js';
import { createSoldier, poseSoldier } from './characters/squad.js';
import { Squad } from './friendlies.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function lerpAngle(a, b, t) { const d = (b - a + Math.PI * 3) % (Math.PI * 2) - Math.PI; return a + d * t; }
let seed = 1358961;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
const rr = (a, b) => lerp(a, b, rand());
// Ak 4C (7.62×51 mm): 20-round magazines, six spare on the vest
export const MAG = 20, RESERVE = 120;

export class Game {
  constructor({ pipeline, level, weapon, audio, isTouch, lights }) {
    Object.assign(this, { pipeline, level, weapon, audio, isTouch, lights });
    this.scene = pipeline.scene;
    this.camera = pipeline.camera;
    this.blockers = level.blockers;
    this.nodes = NODES.map((n, i) => ({ ...n, done: false, obj: level.nodeObjs[i] }));
    this.extract = EXTRACT;
    this.enemies = [];
    this.guardPool = [];
    this.keys = {};
    this.touch = { firing: false, aim: false, sprint: false, joyX: 0, joyY: 0, lookId: null, lookX: 0, lookY: 0 };
    this.mode = 'menu';
    this.frozen = false;
    this.fx = new Effects(this.scene, audio);
    this.lookDX = 0; this.lookDY = 0;
    this.hitFlash = 0;
    this.reset();
    // Hemvärnet comrades (Grön 2 with balaclava/earmuffs, Grön 3 with helmet)
    this.squad = new Squad(this, i => createSoldier({ side: 'hv', weapon: 'ak4c', helmet: i === 1 }), poseSoldier);
    this.bindInput();
  }

  // ------------------------------------------------------------------ state
  reset() {
    this.player = { x: SPAWN.x, y: 1.7, z: SPAWN.z, yaw: SPAWN.yaw, pitch: 0, hp: 100, armor: 75, ammo: MAG, reserve: RESERVE, reloading: 0, ads: 0, crouch: 0, run: 0, kills: 0, shots: 0, hits: 0, steps: 0, started: performance.now() / 1000 };
    for (const e of this.enemies) e.model.root.visible = false;
    this.enemies.length = 0;
    ENEMY_SPAWNS.forEach(e => this.spawnEnemy(...e));
    this.squad?.reset();
    this.nodes.forEach(n => { n.done = false; this.nodeVisual(n); });
    this.recoil = 0; this.bob = 0; this.round = 0; this.lastFire = 0; this.toastUntil = 0; this.killUntil = 0; this.markerUntil = 0;
    $('uplinkState').textContent = 'JAMMED';
  }

  spawnEnemy(x, z, patrolR = 7) {
    let model = this.guardPool.find(g => !g.root.visible && !this.enemies.some(e => e.model === g));
    if (!model) { model = createGuard(this.guardPool.length % 3 === 1 ? 'akm' : 'ak74'); model.root.rotation.order = 'YXZ'; this.scene.add(model.root); this.guardPool.push(model); }
    model.root.visible = true;
    this.enemies.push({ x, z, baseX: x, baseZ: z, angle: rr(-3.14, 3.14), alive: true, health: 100, alert: 0, cooldown: rr(0.8, 2.2), phase: rr(0, 10), walk: rr(0, 6), r: patrolR, flash: 0, deathAt: 0, hit: 0, speed: 0, aim: 0, fallDir: 1, model });
  }

  nodeVisual(n) {
    const o = n.obj; if (!o) return;
    o.panelMat.emissive.setRGB(n.done ? 0.05 : 1, n.done ? 0.3 : 0.12, n.done ? 0.2 : 0.05);
    o.panelMat.emissiveIntensity = n.done ? 1.5 : 8;
    o.ledMat.emissiveIntensity = n.done ? 0 : 40;
    o.light.intensity = n.done ? 0 : 25;
  }

  // ------------------------------------------------------------------ flow
  start() {
    this.reset(); this.mode = 'play';
    $('menu').classList.add('off'); $('end').classList.add('off'); $('pause').classList.remove('show'); $('hud').classList.add('visible');
    if (this.isTouch) $('mobile').classList.add('on');
    this.audio.start();
    if (!this.isTouch) this.pipeline.renderer.domElement.requestPointerLock?.();
    this.toast('UPPLINK OFFLINE — SABOTERA 3 NODER', 3.2);
  }
  pause() { if (this.mode !== 'play') return; this.mode = 'pause'; this.audio.halt(); /* audio: silence barks/breathing */ $('pause').classList.add('show'); this.touch.firing = false; this.keys.mouse = false; if (document.pointerLockElement) document.exitPointerLock(); }
  resume() { if (this.mode !== 'pause') return; this.mode = 'play'; $('pause').classList.remove('show'); if (!this.isTouch) this.pipeline.renderer.domElement.requestPointerLock?.(); }
  finish(win) {
    if (this.mode !== 'play') return;
    this.mode = 'end';
    $('hud').classList.remove('visible'); $('mobile').classList.remove('on'); $('end').classList.remove('off');
    if (document.pointerLockElement) document.exitPointerLock();
    const p = this.player, t = Math.round(performance.now() / 1000 - p.started);
    $('endKicker').textContent = win ? 'OPERATION BLACKTIDE // COMPLETE' : 'OPERATIVE LOST // MISSION FAILED';
    $('endTitle').innerHTML = win ? 'SIGNAL<br><span>CLEAR.</span>' : 'MISSION<br><span>FAILED.</span>';
    $('endMessage').textContent = win ? 'De tre störsändarna är nere. Hamnens signaltrafik är återställd och evakueringen genomförd. Bra genomfört, operatör.' : 'Operatören är utslagen. Sambandscentralen håller fortfarande hamnen mörklagd. Du får en ny chans.';
    $('endStats').textContent = `TID ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}  //  FIENDER ${p.kills}  //  TRÄFFAR ${p.hits}/${p.shots}  //  NODER ${this.nodes.filter(n => n.done).length}/3`;
    this.audio.ui(win);
  }
  toast(msg, sec = 2.2) { this.toastUntil = performance.now() / 1000 + sec; $('toast').textContent = msg; $('toast').style.opacity = '1'; }
  showKill(msg) { this.killUntil = performance.now() / 1000 + 1.2; $('killfeedback').textContent = '◆ ' + msg; $('killfeedback').style.opacity = '1'; }
  hitMarker(kill) { const h = $('hitmarker'); h.classList.toggle('kill', kill); h.style.opacity = '1'; this.markerUntil = performance.now() / 1000 + 0.12; }

  // ------------------------------------------------------------------ collision (2D AABB, same as v0.1)
  blocked(x, z, r = 0.42) {
    if (x - r < BOUNDS.x1 || x + r > BOUNDS.x2 || z - r < BOUNDS.z1 || z + r > BOUNDS.z2) return true;
    for (const b of this.blockers) { const px = clamp(x, b.x1, b.x2), pz = clamp(z, b.z1, b.z2); if ((px - x) ** 2 + (pz - z) ** 2 < r * r) return true; }
    return false;
  }
  wallHit(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    let best = null;
    for (const b of this.blockers) {
      let low = 0, hi = 1;
      for (const [p, d, l, h] of [[ax, dx, b.x1, b.x2], [az, dz, b.z1, b.z2]]) {
        if (Math.abs(d) < 0.00001) { if (p < l || p > h) { low = 2; break; } }
        else { const t1 = (l - p) / d, t2 = (h - p) / d; low = Math.max(low, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); }
      }
      if (low <= hi && hi >= 0 && low <= 1) { const t = Math.max(low, 0); if (best === null || t < best) best = t; }
    }
    return best;
  }
  /** 3D ray vs blocker boxes (with heights) and ground; returns {t, point, normal, kind}. */
  rayWorld(o, d, maxT) {
    let best = { t: maxT, normal: null, kind: 'none' };
    for (const b of this.blockers) {
      let tmin = 0, tmax = best.t, nAxis = -1, nSign = 0;
      const mins = [b.x1, 0, b.z1], maxs = [b.x2, b.h, b.z2], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
      let ok = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(dd[a]) < 1e-8) { if (oo[a] < mins[a] || oo[a] > maxs[a]) { ok = false; break; } continue; }
        let t1 = (mins[a] - oo[a]) / dd[a], t2 = (maxs[a] - oo[a]) / dd[a], s = -1;
        if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
        if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
      if (ok && tmin > 0 && tmin < best.t) { const n = [0, 0, 0]; n[nAxis] = nSign; best = { t: tmin, normal: new THREE.Vector3(...n), kind: 'metal' }; }
    }
    if (d.y < -1e-4) { const tg = -o.y / d.y; if (tg > 0 && tg < best.t) best = { t: tg, normal: new THREE.Vector3(0, 1, 0), kind: 'ground' }; }
    if (best.normal) best.point = o.clone().addScaledVector(d, best.t);
    return best;
  }

  // ------------------------------------------------------------------ actions
  reload() {
    const p = this.player;
    if (this.mode !== 'play' || p.reloading > 0 || p.ammo === MAG || p.reserve <= 0) return;
    p.reloading = 1.65; $('magStatus').textContent = 'RELOADING';
    this.audio.reload('out');
    this.reloadSfx = [[1.65 - 0.95, 'in'], [1.65 - 1.35, 'bolt']];
  }

  shoot() {
    const p = this.player, now = performance.now() / 1000;
    if (this.mode !== 'play' || p.reloading > 0 || now - this.lastFire < 0.105) return;
    this.lastFire = now;
    if (!p.ammo) { this.audio.dryFire(); this.reload(); return; }
    p.ammo--; p.shots++;
    const ads = p.ads > 0.5;
    this.recoil += ads ? 0.058 : 0.085; // full-power 7.62 kicks harder than 5.56
    // audio (presentation only): distances to the nearest walls front/right/back/left for slap-back echoes
    const walls = [0, 1, 2, 3].map(i => { const a = p.yaw + i * Math.PI / 2, t = this.wallHit(p.x, p.z, p.x + Math.sin(a) * 60, p.z - Math.cos(a) * 60); return t === null ? 0 : t * 60; });
    this.audio.gunshot({ walls });
    this.weapon.fire();
    this.camKick = (this.camKick || 0) + (ads ? 0.006 : 0.01);
    if (navigator.vibrate && this.isTouch) navigator.vibrate(12);
    const spread = (1 - p.ads) * 0.016 + p.run * 0.026 + 0.002;
    const yaw = p.yaw + rr(-spread, spread), pitch = p.pitch + rr(-spread, spread) - this.recoil * 0.11;
    const dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = -Math.cos(yaw) * Math.cos(pitch);
    let best = null, bestT = 120, head = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const ox = e.x - p.x, oy = 1.2 - p.y, oz = e.z - p.z, t = ox * dx + oy * dy + oz * dz;
      if (t < 0 || t > 100) continue;
      const err = Math.hypot(ox - dx * t, oy - dy * t, oz - dz * t);
      if (err < 0.62 && t < bestT) {
        const wall = this.wallHit(p.x, p.z, e.x, e.z);
        if (wall !== null && wall < 0.9) continue;
        best = e; bestT = t;
        const hy = 1.72 - p.y, herr = Math.hypot(ox - dx * t, hy - dy * t, oz - dz * t);
        head = herr < 0.14;
      }
    }
    for (const n of this.nodes) {
      if (n.done) continue;
      const ox = n.x - p.x, oy = 1.5 - p.y, oz = n.z - p.z, t = ox * dx + oy * dy + oz * dz;
      if (t < 0 || t > 75) continue;
      const err = Math.hypot(ox - dx * t, oy - dy * t, oz - dz * t);
      if (err < 0.79 && t < bestT) { best = n; bestT = t; head = false; }
    }
    const origin = new THREE.Vector3(p.x, p.y - 0.06, p.z), dir = new THREE.Vector3(dx, dy, dz);
    const muzzle = origin.clone().add(new THREE.Vector3(Math.cos(p.yaw) * 0.12, -0.1, Math.sin(p.yaw) * 0.12)).addScaledVector(dir, 0.7);
    if (best) {
      p.hits++;
      const hitPoint = origin.clone().addScaledVector(dir, bestT);
      if ('health' in best) {
        best.health -= head ? 100 : (ads ? 54 : 42);
        best.hit = 1;
        const killed = best.health <= 0;
        this.showKill(killed ? (head ? 'HEADSHOT — TARGET NEUTRALIZED' : 'TARGET NEUTRALIZED') : 'TARGET HIT');
        if (killed) { best.alive = false; best.deathAt = performance.now() / 1000; best.fallDir = Math.random() < 0.5 ? 1 : -1; p.kills++; } else best.alert = 7;
        this.hitMarker(killed); this.audio.hitTick(killed);
        this.audio.voice(killed ? 'death' : 'hit', { guardId: this.guardPool.indexOf(best.model), distance: bestT, x: best.x, z: best.z }); // audio: guard cry
        this.fx.blood(hitPoint, dir);
        this.audio.impact('flesh', bestT);
      } else { this.sabotage(best); this.fx.sparks(hitPoint, dir.clone().negate(), 14); }
      this.fx.tracer(muzzle, hitPoint);
    } else {
      const hit = this.rayWorld(origin, dir, 120);
      const end = hit.point || origin.clone().addScaledVector(dir, 120);
      this.fx.tracer(muzzle, end);
      if (hit.point) {
        if (hit.kind === 'ground') this.fx.dust(hit.point); else this.fx.sparks(hit.point, hit.normal, 8);
        this.fx.decal(hit.point, hit.normal);
        this.audio.impact(hit.kind === 'ground' ? 'ground' : 'metal', hit.t, 0);
      }
    }
    for (const e of this.enemies) if (e.alive && Math.hypot(p.x - e.x, p.z - e.z) < 28) e.alert = 6;
    if (p.ammo === 0 && p.reserve > 0) this.reload();
  }

  sabotage(n) {
    if (n.done) return;
    n.done = true;
    this.nodeVisual(n);
    this.audio.sabotage({ x: n.x, z: n.z, distance: dist(this.player, n) }); // audio: positional power-down
    this.fx.sparks(new THREE.Vector3(n.x, 1.2, n.z + 0.4), new THREE.Vector3(0, 1, 0.4), 30);
    const count = this.nodes.filter(m => m.done).length;
    this.toast(`◈ NOD ${count} AV 3 FÖRSTÖRD`, 2.8);
    if (count === 3) { $('uplinkState').textContent = 'ONLINE'; this.toast('ALLA NODER NERE — NÅ EVAKUERINGEN!', 5); this.spawnEnemy(-16, 9, 3); this.spawnEnemy(17, 14, 3); }
    // audio (presentation only): nearest living guard calls the reinforcements in
    if (count === 3) { const pl = this.player, g = this.enemies.filter(e => e.alive).sort((a, b) => dist(a, pl) - dist(b, pl))[0]; if (g) this.audio.voice('reinforce', { guardId: this.guardPool.indexOf(g.model), distance: dist(g, pl), x: g.x, z: g.z }); }
  }

  interact() {
    if (this.mode !== 'play') return;
    const p = this.player;
    for (const n of this.nodes) if (!n.done && dist(p, n) < 3.15) { this.sabotage(n); return; }
    if (this.nodes.every(n => n.done) && dist(p, this.extract) < 4.4) { this.finish(true); return; }
  }

  damage(amount) {
    if (this.mode !== 'play') return;
    const p = this.player, shield = Math.min(p.armor, amount * 0.72);
    p.armor -= shield; p.hp -= amount - shield;
    this.hitFlash = 1;
    $('hitflash').style.opacity = '.5'; setTimeout(() => $('hitflash').style.opacity = '0', 135);
    this.audio.hurt();
    this.camShake = 0.4;
    if (p.hp <= 0) { p.hp = 0; this.finish(false); }
  }

  // ------------------------------------------------------------------ simulation
  update(dt, time) {
    this.fx.update(dt);
    if (this.mode !== 'play' || this.frozen) return;
    const p = this.player, k = this.keys, T = this.touch;
    this.round += dt;
    // audio (presentation only): listener pose for 3D sound, heartbeat, low-health breathing level
    this.audio.listener(p.x, p.y, p.z, p.yaw); this.audio.lowHealth(clamp(1 - p.hp / 40, 0, 1));
    let mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + T.joyX, my = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) - T.joyY;
    const mag = Math.hypot(mx, my); if (mag > 1) { mx /= mag; my /= mag; }
    const moving = mag > 0.08, sprint = (k.ShiftLeft || k.ShiftRight || T.sprint) && my > 0.05, crouching = k.KeyC, aiming = k.aim || T.aim;
    p.ads = lerp(p.ads, aiming && !sprint ? 1 : 0, Math.min(1, dt * 11));
    p.run = lerp(p.run, sprint ? 1 : 0, Math.min(1, dt * 7));
    p.crouch = lerp(p.crouch, crouching ? 1 : 0, Math.min(1, dt * 8));
    const speed = (sprint ? 7.0 : crouching ? 2.1 : 4.45) * (p.ads > 0.5 ? 0.73 : 1);
    // smoothed velocity gives weight to the movement (accelerate ~0.12 s)
    const tvx = (Math.sin(p.yaw) * my + Math.cos(p.yaw) * mx) * speed, tvz = (-Math.cos(p.yaw) * my + Math.sin(p.yaw) * mx) * speed;
    this.vx = lerp(this.vx || 0, tvx, Math.min(1, dt * 10)); this.vz = lerp(this.vz || 0, tvz, Math.min(1, dt * 10));
    const dx = this.vx * dt, dz = this.vz * dt;
    if (!this.blocked(p.x + dx, p.z)) p.x += dx; else this.vx = 0;
    if (!this.blocked(p.x, p.z + dz)) p.z += dz; else this.vz = 0;
    p.y = lerp(p.y, 1.7 - p.crouch * 0.55, Math.min(1, dt * 12));
    const vel = Math.hypot(this.vx, this.vz);
    if (vel > 0.3) {
      const oldStep = Math.floor(p.steps / 1.55);
      p.steps += dt * vel;
      this.bob += dt * (sprint ? 13 : 9.5) * Math.min(1, vel / 4);
      if (Math.floor(p.steps / 1.55) !== oldStep) this.audio.footstep(sprint, { crouch: crouching });
    } else this.bob += dt * 0.7;
    this.moving = vel > 0.3; this.sprinting = sprint && vel > 3;
    if (p.reloading > 0) {
      p.reloading -= dt;
      if (this.reloadSfx) for (const s of this.reloadSfx) if (!s.done && p.reloading <= s[0]) { s.done = true; this.audio.reload(s[1]); }
      if (p.reloading <= 0) { const a = Math.min(MAG - p.ammo, p.reserve); p.ammo += a; p.reserve -= a; p.reloading = 0; $('magStatus').textContent = 'READY'; }
    }
    if ((k.mouse || T.firing) && !sprint) this.shoot();
    this.recoil = Math.max(0, this.recoil - dt * 0.45);
    this.camKick = (this.camKick || 0) * Math.exp(-dt * 12);
    this.camShake = Math.max(0, (this.camShake || 0) - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5);

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(p, e), canSee = this.wallHit(e.x, e.z, p.x, p.z) === null;
      let targetX = e.baseX + Math.cos(time * 0.46 + e.phase) * e.r * 0.65, targetZ = e.baseZ + Math.sin(time * 0.46 + e.phase) * e.r * 0.65;
      if ((d < 23 && canSee) || e.alert > 0) { e.alert = Math.max(e.alert, 4); if (d > 5.5) { targetX = p.x; targetZ = p.z; } }
      e.alert -= dt;
      // audio (presentation only): bark on first contact / re-engage, and when the guard loses the player
      const gid = this.guardPool.indexOf(e.model), va = e.alert > 0;
      if (va !== !!e._va) { this.audio.voice(va ? (e._seen ? 'engage' : 'contact') : 'search', { guardId: gid, distance: d, x: e.x, z: e.z }); if (va) e._seen = true; e._va = va; }
      const ex = targetX - e.x, ez = targetZ - e.z, nd = Math.hypot(ex, ez), step = Math.min(nd, dt * (e.alert > 0 ? 2.5 : 1.1));
      let moved = 0;
      if (nd > 0.15) {
        const sx = ex / nd * step, sz = ez / nd * step;
        if (!this.blocked(e.x + sx, e.z, 0.35)) { e.x += sx; moved += Math.abs(sx); }
        if (!this.blocked(e.x, e.z + sz, 0.35)) { e.z += sz; moved += Math.abs(sz); }
        e.walk += dt * (e.alert > 0 ? 7.5 : 4.2);
      }
      // face movement when patrolling, face the player when engaging
      const engage = e.alert > 0 && canSee && d < 27;
      const face = engage ? Math.atan2(p.x - e.x, p.z - e.z) : Math.atan2(ex, ez);
      e.angle = lerpAngle(e.angle, face, Math.min(1, dt * 6));
      e.speed = lerp(e.speed, clamp(moved / Math.max(dt, 1e-4) / 2.5, 0, 1), Math.min(1, dt * 6));
      e.aim = lerp(e.aim, engage ? 1 : 0, Math.min(1, dt * 5));
      // audio (presentation only): guard footfalls on the wet quay (one per half gait cycle)
      const ws = Math.floor(e.walk / Math.PI); if (ws !== e._ws) { e._ws = ws; if (e.speed > 0.2) this.audio.guardStep({ x: e.x, z: e.z, distance: d, run: e.alert > 0 }); }
      e.cooldown -= dt;
      if (d < 27 && canSee && e.alert > 0 && e.cooldown <= 0) {
        e.cooldown = rr(1.25, 2.8); e.flash = 0.13;
        const chance = clamp(0.85 - d * 0.02 - (p.run * 0.2), 0.27, 0.72);
        const from = new THREE.Vector3(e.x + Math.sin(e.angle) * 0.6, 1.45, e.z + Math.cos(e.angle) * 0.6);
        const rel = Math.atan2(e.x - p.x, -(e.z - p.z)) - p.yaw, panv = Math.sin(rel);
        this.audio.remoteShot(d, panv, { x: from.x, y: from.y, z: from.z, guardId: gid }); // audio: 3D placement
        this.audio.voice('engage', { guardId: gid, distance: d, x: e.x, z: e.z }); // audio: occasional fire bark (throttled)
        if (rand() < chance) { this.damage(rr(5, 13)); }
        else {
          this.audio.bulletCrack(panv, d);
          const miss = new THREE.Vector3(p.x + rr(-1.2, 1.2), p.y + rr(-0.8, 0.6), p.z + rr(-1.2, 1.2));
          this.fx.tracer(from, miss.clone().sub(from).multiplyScalar(1.6).add(from), true);
        }
      }
      e.flash = Math.max(0, e.flash - dt);
      e.hit = Math.max(0, e.hit - dt * 5);
    }
    this.squad.update(dt, time);
    this.updateHud(time);
  }

  // ------------------------------------------------------------------ presentation
  syncVisuals(time, dt) {
    this.squad.sync();
    const p = this.player, cam = this.camera;
    const bobY = this.mode === 'play' ? Math.sin(this.bob * 2) * 0.025 * (this.moving ? 1 : 0.1) * (1 - p.ads * 0.7) : 0;
    const shake = (this.camShake || 0) * 0.02;
    cam.position.set(p.x, p.y + bobY, p.z);
    cam.rotation.set(p.pitch + (this.camKick || 0) + rr(-shake, shake), -p.yaw + rr(-shake, shake), Math.sin(this.bob) * 0.004 * (this.moving ? 1 : 0));
    const fov = 74 - 22 * p.ads + 4 * p.run;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    for (const e of this.enemies) {
      const m = e.model;
      const deadFor = e.alive ? 0 : (performance.now() / 1000 - e.deathAt);
      m.root.visible = e.alive || deadFor < 25;
      m.root.position.set(e.x, 0, e.z);
      m.root.rotation.y = e.angle + Math.PI;
      poseGuard(m, { walk: e.walk, speed: e.speed, aim: e.aim, flash: e.flash, hit: e.hit, dead: e.alive ? 0 : deadFor / 0.9, fallDir: e.fallDir });
    }
    // node LED blink
    for (const n of this.nodes) if (!n.done && n.obj) n.obj.ledMat.emissiveIntensity = (Math.sin(time * 6 + n.x) > 0.2) ? 40 : 2;
    // light level at the player for the viewmodel
    let lvl = 0; const col = new THREE.Color(0, 0, 0);
    for (const l of this.lights) {
      const d2 = (l.position.x - p.x) ** 2 + (l.position.y - p.y) ** 2 + (l.position.z - p.z) ** 2;
      const v = l.intensity / (d2 + 1) / (l.isSpotLight ? 300 : 120);
      lvl += v; col.r += l.color.r * v; col.g += l.color.g * v; col.b += l.color.b * v;
    }
    if (lvl > 0) col.multiplyScalar(1 / lvl);
    this.lightLevel = lvl; // used for eye adaptation (auto exposure)
    this.weapon.update(dt, { ads: p.ads > 0.5 && this.mode === 'play', bob: this.bob, moving: this.moving && this.mode === 'play', sprinting: this.sprinting, lookDX: this.lookDX, lookDY: this.lookDY, reloading: p.reloading > 0 ? 1 - p.reloading / 1.65 : -1, time, lightLevel: Math.min(1.5, lvl), lightColor: col });
    this.weapon.root.visible = this.mode === 'play' || this.mode === 'pause';
    // aiming through the red dot: no HUD crosshair at all, only the illuminated dot in the optic
    const aiming = this.weapon.ads > 0.15;
    if (aiming !== this._crossHidden) { this._crossHidden = aiming; $('cross').style.visibility = aiming ? 'hidden' : 'visible'; }
    this.lookDX = 0; this.lookDY = 0;
    if (this.mode === 'play') { this.drawMini(); this.drawMarkers(); }
    if (time > this.markerUntil) $('hitmarker').style.opacity = '0';
  }

  updateHud(time) {
    const p = this.player;
    $('hp').textContent = Math.ceil(p.hp); $('armor').textContent = Math.ceil(p.armor);
    $('healthBar').style.width = clamp(p.hp, 0, 100) + '%'; $('armorBar').style.width = clamp(p.armor, 0, 100) + '%';
    $('clip').textContent = String(p.ammo).padStart(2, '0'); $('reserve').textContent = p.reserve;
    const count = this.nodes.filter(n => n.done).length;
    $('objectiveTitle').textContent = count < 3 ? 'Slå ut störsändarna' : 'Ta dig till evakueringspunkten';
    $('objectiveSub').textContent = count < 3 ? `${count} / 3 noder avaktiverade` : 'Kaj 04 · Exfiltrera via markerad zon';
    $('clock').textContent = `23:${String(47 + Math.floor(this.round / 60) % 13).padStart(2, '0')}:${String(Math.floor(this.round) % 60).padStart(2, '0')}`;
    const near = this.nodes.find(n => !n.done && dist(p, n) < 3.15), atExit = count === 3 && dist(p, this.extract) < 4.4;
    $('interact').style.display = near || atExit ? 'block' : 'none';
    $('interact').textContent = near ? '[ E / USE ]  SABOTERA SIGNALNOD' : '[ E / USE ]  EVAKUERA';
    const now = performance.now() / 1000;
    if (now > this.toastUntil) $('toast').style.opacity = '0';
    if (now > this.killUntil) $('killfeedback').style.opacity = '0';
  }

  drawMini() {
    const c = $('minimap').getContext('2d'), p = this.player, W = 180, H = 180, k = 2.1;
    c.clearRect(0, 0, W, H); c.fillStyle = 'rgba(9,23,31,.89)'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#44717a44'; c.lineWidth = 0.6;
    for (let i = 0; i <= 180; i += 30) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 180); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(180, i); c.stroke(); }
    const toX = x => 90 + (x - p.x) * k, toY = z => 90 + (z - p.z) * k;
    for (const b of this.blockers) { c.fillStyle = '#65778168'; c.fillRect(toX(b.x1), toY(b.z1), Math.max(1, (b.x2 - b.x1) * k), Math.max(1, (b.z2 - b.z1) * k)); }
    for (const e of this.enemies) { if (!e.alive || dist(e, p) > 23) continue; c.fillStyle = '#f38b70'; c.beginPath(); c.arc(toX(e.x), toY(e.z), 3.1, 0, Math.PI * 2); c.fill(); }
    for (const f of this.squad.minimapDots()) { c.fillStyle = '#8fe08a'; c.beginPath(); c.arc(toX(f.x), toY(f.z), 3.1, 0, Math.PI * 2); c.fill(); }
    for (const n of this.nodes) { if (n.done) continue; c.fillStyle = '#ffc17d'; c.save(); c.translate(toX(n.x), toY(n.z)); c.rotate(Math.PI / 4); c.fillRect(-3.3, -3.3, 6.6, 6.6); c.restore(); }
    if (this.nodes.every(n => n.done)) { c.fillStyle = '#91ead8'; c.fillRect(toX(this.extract.x) - 5, toY(this.extract.z) - 5, 10, 10); }
    c.translate(90, 90); c.rotate(p.yaw); c.fillStyle = '#e8f9f7'; c.beginPath(); c.moveTo(0, -9); c.lineTo(-5, 6); c.lineTo(0, 3); c.lineTo(5, 6); c.closePath(); c.fill(); c.setTransform(1, 0, 0, 1, 0, 0);
    c.strokeStyle = '#8fe5df88'; c.strokeRect(0.5, 0.5, 179, 179);
  }

  drawMarkers() {
    const el = $('markers'), p = this.player;
    const items = this.nodes.filter(n => !n.done).map(n => ({ x: n.x, z: n.z, tag: 'SIGNALNOD', y: 3.3 }));
    if (this.nodes.every(n => n.done)) items.push({ x: this.extract.x, z: this.extract.z, tag: 'EVAKUERING', y: 2 });
    let html = '';
    const v = new THREE.Vector3();
    for (const t of items) {
      v.set(t.x, t.y, t.z).project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) continue;
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      html += `<div class="marker" style="left:${sx}px;top:${sy}px"><div class="diamond">◇</div>${t.tag}<small>${Math.round(Math.hypot(t.x - p.x, t.z - p.z))} M</small></div>`;
    }
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------ input (same bindings as v0.1)
  bindInput() {
    const canvas = this.pipeline.renderer.domElement;
    const keyEvent = (e, down) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys[e.code] = down;
      if (!down) return;
      if (e.code === 'KeyR') this.reload();
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'Escape') this.mode === 'play' ? this.pause() : this.mode === 'pause' ? this.resume() : null;
      if (e.code === 'KeyM' && this.mode === 'play') $('map').style.display = $('map').style.display === 'none' ? 'block' : 'none';
    };
    addEventListener('keydown', e => keyEvent(e, true)); addEventListener('keyup', e => keyEvent(e, false));
    canvas.addEventListener('click', () => { if (this.mode === 'play' && !this.isTouch && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) this.keys.mouse = true; if (e.button === 2) this.keys.aim = true; });
    addEventListener('mouseup', e => { if (e.button === 0) this.keys.mouse = false; if (e.button === 2) this.keys.aim = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('mousemove', e => {
      if (this.mode !== 'play' || document.pointerLockElement !== canvas) return;
      const sens = 0.0022 * (1 - this.player.ads * 0.4);
      this.player.yaw += e.movementX * sens; this.player.pitch = clamp(this.player.pitch - e.movementY * sens * 0.82, -1.25, 1.25);
      this.lookDX += e.movementX; this.lookDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => { if (!this.isTouch && this.mode === 'play' && document.pointerLockElement !== canvas) this.pause(); });
    addEventListener('blur', () => { if (this.mode === 'play' && !this.qaMode) this.pause(); });
    const bindHold = (id, down, up) => { const el = $(id); el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); down(); }); el.addEventListener('pointerup', e => { e.preventDefault(); e.stopPropagation(); up?.(); }); el.addEventListener('pointercancel', () => up?.()); };
    const T = this.touch;
    bindHold('fireBtn', () => T.firing = true, () => T.firing = false);
    bindHold('aimBtn', () => T.aim = !T.aim);
    bindHold('sprintBtn', () => T.sprint = true, () => T.sprint = false);
    bindHold('reloadBtn', () => this.reload());
    bindHold('useBtn', () => this.interact());
    bindHold('pauseBtn', () => this.mode === 'play' ? this.pause() : this.resume());
    const stick = $('stickArea'), knob = $('stickKnob'); let stickId = null;
    const stickMove = e => { const r = stick.getBoundingClientRect(), x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2), d = Math.hypot(x, y), limit = 48, kk = Math.min(1, limit / (d || 1)); T.joyX = x * kk / limit; T.joyY = y * kk / limit; knob.style.transform = `translate(${T.joyX * 48}px,${T.joyY * 48}px)`; };
    stick.addEventListener('pointerdown', e => { e.preventDefault(); stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); });
    stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
    for (const ev of ['pointerup', 'pointercancel']) stick.addEventListener(ev, e => { if (e.pointerId === stickId) { stickId = null; T.joyX = T.joyY = 0; knob.style.transform = 'translate(0,0)'; } });
    canvas.addEventListener('pointerdown', e => { if (!this.isTouch || this.mode !== 'play') return; if (e.clientX < innerWidth * 0.32 && e.clientY > innerHeight * 0.52) return; T.lookId = e.pointerId; T.lookX = e.clientX; T.lookY = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => { if (e.pointerId !== T.lookId || this.mode !== 'play') return; const dx = e.clientX - T.lookX, dy = e.clientY - T.lookY; this.player.yaw += dx * 0.0045; this.player.pitch = clamp(this.player.pitch - dy * 0.0036, -1.25, 1.25); T.lookX = e.clientX; T.lookY = e.clientY; this.lookDX += dx; this.lookDY += dy; });
    canvas.addEventListener('pointerup', e => { if (e.pointerId === T.lookId) T.lookId = null; });
    $('startBtn').onclick = () => this.start(); $('resumeBtn').onclick = () => this.resume(); $('restartBtn').onclick = () => this.start(); $('restartPause').onclick = () => this.start();
  }
}

// ---------------------------------------------------------------------- effects
class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.enemyTracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 2.5, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 5, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.dustMat = new THREE.MeshBasicMaterial({ color: 0x8a8a86, transparent: true, opacity: 0.35, depthWrite: false });
    this.bloodMat = new THREE.MeshBasicMaterial({ color: 0x3a0505, transparent: true, opacity: 0.8, depthWrite: false });
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.35, 'rgba(10,10,10,0.9)'); gr.addColorStop(0.5, 'rgba(60,60,60,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.decalMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 });
    this.decals = [];
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.sparkGeo = new THREE.BoxGeometry(0.012, 0.012, 0.09);
    this.puff = new THREE.SphereGeometry(0.12, 6, 5);
    this.light = new THREE.PointLight(0xffa040, 0, 6, 2); scene.add(this.light);
  }
  add(mesh, life, vel, grav = 0, fade = true) { this.scene.add(mesh); this.items.push({ mesh, life, max: life, vel, grav, fade }); }
  tracer(a, b, enemy = false) {
    const len = a.distanceTo(b); if (len < 0.5) return;
    const m = new THREE.Mesh(this.box, enemy ? this.enemyTracerMat : this.tracerMat);
    const seg = Math.min(len, 6);
    m.scale.set(0.012, 0.012, seg);
    const dir = b.clone().sub(a).normalize();
    m.position.copy(a).addScaledVector(dir, seg / 2 + 0.5);
    m.lookAt(b);
    m.layers.set(3);
    this.add(m, 0.06, dir.clone().multiplyScalar(len / 0.06), 0, false);
  }
  sparks(p, n, count) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      const v = n.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(4));
      m.position.copy(p); m.lookAt(p.clone().add(v));
      this.add(m, 0.15 + Math.random() * 0.25, v, -9);
    }
    this.light.position.copy(p).addScaledVector(n, 0.3); this.light.intensity = 8; this.flashT = 0.05;
  }
  dust(p) {
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(this.puff, this.dustMat.clone());
      m.position.copy(p);
      this.add(m, 0.5 + Math.random() * 0.4, new THREE.Vector3(Math.random() - 0.5, 0.6 + Math.random(), Math.random() - 0.5), 0);
    }
  }
  blood(p, dir) {
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this.puff, this.bloodMat.clone());
      m.scale.setScalar(0.4 + Math.random() * 0.5);
      m.position.copy(p);
      this.add(m, 0.35, dir.clone().multiplyScalar(1.5 + Math.random() * 2).add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.5, Math.random() - 0.5)), -4);
    }
  }
  decal(p, n) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), this.decalMat);
    m.position.copy(p).addScaledVector(n, 0.005);
    m.lookAt(p.clone().add(n));
    m.rotation.z = Math.random() * 6;
    this.scene.add(m); this.decals.push(m);
    if (this.decals.length > 60) { const o = this.decals.shift(); this.scene.remove(o); o.geometry.dispose(); }
  }
  update(dt) {
    for (const it of this.items) {
      it.life -= dt;
      it.vel.y += it.grav * dt;
      it.mesh.position.addScaledVector(it.vel, dt);
      if (it.fade && it.mesh.material.opacity !== undefined && it.mesh.material !== this.sparkMat) {
        it.mesh.material.opacity = Math.max(0, it.life / it.max) * 0.5;
        it.mesh.scale.multiplyScalar(1 + dt * 2.2);
      }
    }
    for (const it of this.items.filter(i => i.life <= 0)) { this.scene.remove(it.mesh); if (it.mesh.material !== this.sparkMat && it.mesh.material !== this.tracerMat && it.mesh.material !== this.enemyTracerMat) it.mesh.material.dispose?.(); }
    this.items = this.items.filter(i => i.life > 0);
    this.flashT = (this.flashT || 0) - dt;
    if (this.flashT <= 0) this.light.intensity = 0;
  }
}
