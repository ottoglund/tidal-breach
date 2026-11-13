// Hemvärnet squadmates: two comrades who move with the player in a loose
// formation and engage guards they can see. They do not change mission rules
// (only the player sabotages nodes and extracts); guards keep targeting the
// player. Comrades are deliberately moderate shots so the player stays central.
import * as THREE from 'three';
import { gaitRate } from './characters/anim.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) { const d = (b - a + Math.PI * 3) % (Math.PI * 2) - Math.PI; return a + d * t; }

// formation slots relative to the player's facing: (right, back) in metres
const SLOTS = [[-2.2, 2.6], [2.4, 3.4]];
const CALLSIGNS = ['Grön 2', 'Grön 3'];
const SV_BARKS = {
  contact: ['Kontakt framåt!', 'Fiende!', 'Där borta!'],
  reload: ['Laddar om!', 'Byter magasin!'],
  down: ['Han ligger!', 'Träff!'],
};

export class Squad {
  /**
   * factory: () => model compatible with poseGuard ({ root, rifle, flash, flashMesh, ... })
   * pose: (model, state) => void
   */
  constructor(game, factory, pose) {
    this.game = game; this.pose = pose; this.enabled = true;
    this.members = SLOTS.map((slot, i) => {
      const model = factory(i);
      model.root.rotation.order = 'YXZ';
      game.scene.add(model.root);
      return { i, slot, model, x: 0, z: 0, vx: 0, vz: 0, moving: false, faceA: 0, angle: 0, walk: 0, speed: 0, aim: 0, flash: 0, hit: 0, cooldown: 1, mag: 20, reloadT: 0, target: null, callsign: CALLSIGNS[i], lastBark: -99 };
    });
    this.reset();
  }

  reset() {
    const p = this.game.player;
    for (const m of this.members) {
      const [rx, bz] = m.slot;
      m.x = p.x + rx; m.z = p.z + bz; m.vx = m.vz = 0; m.moving = false; m.angle = m.faceA = Math.PI; m.target = null; m.mag = 20; m.reloadT = 0; m.cooldown = 1 + m.i;
    }
  }

  setEnabled(on) { this.enabled = !!on; for (const m of this.members) m.model.root.visible = this.enabled; }

  update(dt, time) {
    if (!this.enabled) return;
    const g = this.game, p = g.player;
    const fx = Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = Math.sin(p.yaw);
    for (const m of this.members) {
      // --- pick a target: nearest living guard in sight within 32 m
      let best = null, bd = 32;
      for (const e of g.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - m.x, e.z - m.z);
        if (d < bd && g.wallHit(m.x, m.z, e.x, e.z) === null) { best = e; bd = d; }
      }
      if (best && !m.target) this.bark(m, 'contact', time);
      m.target = best;
      // --- movement: hold formation slot, stop to shoot when engaging. Arrival steering with limited acceleration
      // and a start / stop hysteresis, so a comrade does not stutter at the edge of its slot while the player walks
      const sx = p.x + rx * m.slot[0] - fx * m.slot[1], sz = p.z + rz * m.slot[0] - fz * m.slot[1];
      const ex = sx - m.x, ez = sz - m.z, nd = Math.hypot(ex, ez);
      const engaging = !!m.target;
      const maxSpeed = engaging ? 1.6 : (nd > 6 ? 5.5 : 3.6);
      if (nd > 0.7) m.moving = true; else if (nd < 0.3) m.moving = false;
      let tvx = 0, tvz = 0;
      if (m.moving && nd > 1e-3) { const want = Math.min(maxSpeed, (nd - 0.25) * 2.2 + 0.4); tvx = ex / nd * want; tvz = ez / nd * want; }
      // keep out of the player's way (soft push in the velocity, hard push only when very close)
      const pdx = m.x - p.x, pdz = m.z - p.z, pd = Math.hypot(pdx, pdz);
      if (pd < 1.4 && pd > 1e-3) { const k = (1.4 - pd) * 2.5 / pd; tvx += pdx * k; tvz += pdz * k; }
      const acc = (tvx * m.vx + tvz * m.vz < 0 || Math.hypot(tvx, tvz) < Math.hypot(m.vx, m.vz)) ? 9 : 6, dvx = tvx - m.vx, dvz = tvz - m.vz, dv = Math.hypot(dvx, dvz), lim = acc * dt;
      if (dv > lim) { m.vx += dvx / dv * lim; m.vz += dvz / dv * lim; } else { m.vx = tvx; m.vz = tvz; }
      const x0 = m.x, z0 = m.z;
      let ux = m.vx * dt, uz = m.vz * dt;
      if (Math.hypot(ux, uz) > 1e-5) {
        if (!g.blocked(m.x + ux, m.z, 0.35)) m.x += ux; else m.vx = 0;
        if (!g.blocked(m.x, m.z + uz, 0.35)) m.z += uz; else m.vz = 0;
        if (m.x === x0 && m.z === z0 && nd > 3) { // stuck behind cover: teleport-free catch-up by stepping along the player's trail
          const tx = m.x + (p.x - m.x) * 0.02, tz = m.z + (p.z - m.z) * 0.02;
          if (!g.blocked(tx, tz, 0.35)) { m.x = tx; m.z = tz; }
        }
      }
      if (pd < 0.7 && pd > 1e-3) { const k = (0.7 - pd) / pd; const nx = m.x + pdx * k, nz = m.z + pdz * k; if (!g.blocked(nx, nz, 0.35)) { m.x = nx; m.z = nz; } }
      const vel = Math.hypot(m.x - x0, m.z - z0) / Math.max(dt, 1e-4);
      m.walk += dt * gaitRate(vel);                 // gait phase from the actual ground speed (no skating)
      m.speed = lerp(m.speed, clamp(vel / 2.5, 0, 1), Math.min(1, dt * 6));
      // facing: target when engaging, travel direction while clearly moving, else the player's heading (hysteresis)
      const face = engaging ? Math.atan2(m.target.x - m.x, m.target.z - m.z) : (vel > 0.9 || (vel > 0.4 && m.moving) ? Math.atan2(m.vx, m.vz) : Math.atan2(fx, fz));
      m.faceA = lerpAngle(m.faceA, face, Math.min(1, dt * 6));
      m.angle = lerpAngle(m.angle, m.faceA, Math.min(1, dt * 7));
      m.aim = lerp(m.aim, engaging ? 1 : 0, Math.min(1, dt * 4));
      // --- shooting: short aimed bursts, magazine of 20, moderate accuracy
      m.flash = Math.max(0, m.flash - dt); m.hit = Math.max(0, m.hit - dt * 5);
      if (m.reloadT > 0) { m.reloadT -= dt; if (m.reloadT <= 0) m.mag = 20; continue; }
      m.cooldown -= dt;
      if (engaging && m.aim > 0.8 && m.cooldown <= 0) {
        const e = m.target, d = Math.hypot(e.x - m.x, e.z - m.z);
        m.cooldown = 0.55 + Math.random() * 0.9; m.flash = 0.06; m.mag--;
        const from = new THREE.Vector3(m.x + Math.sin(m.angle) * 0.7, 1.45, m.z + Math.cos(m.angle) * 0.7);
        const chance = clamp(0.45 - d * 0.008, 0.18, 0.4);
        const hit = Math.random() < chance;
        const to = new THREE.Vector3(e.x + (hit ? 0 : (Math.random() - 0.5) * 1.6), hit ? 1.25 : 0.8 + Math.random() * 1.4, e.z + (hit ? 0 : (Math.random() - 0.5) * 1.6));
        g.fx.tracer(from, to);
        const rel = Math.atan2(m.x - p.x, -(m.z - p.z)) - p.yaw;
        g.audio.remoteShot?.(Math.hypot(m.x - p.x, m.z - p.z), Math.sin(rel), { x: m.x, y: 1.45, z: m.z, guardId: 100 + m.i, friendly: true });
        e.alert = Math.max(e.alert, 6);
        if (hit) {
          e.health -= 34; e.hit = 1; e.hitX = m.x; e.hitZ = m.z;
          g.fx.blood?.(to, to.clone().sub(from).normalize());
          if (e.health <= 0 && e.alive) { e.alive = false; e.deathAt = performance.now() / 1000; e.fallDir = Math.random() < 0.5 ? 1 : -1; this.bark(m, 'down', time); }
        }
        if (m.mag <= 0) { m.reloadT = 2.4; this.bark(m, 'reload', time); }
      }
    }
  }

  sync() {
    for (const m of this.members) {
      const r = m.model.root;
      r.visible = this.enabled;
      r.position.set(m.x, 0, m.z);
      r.rotation.y = m.angle + Math.PI;
      this.pose(m.model, { walk: m.walk, speed: m.speed, aim: m.aim, flash: m.flash, hit: m.hit, dead: 0, fallDir: 1, reload: m.reloadT > 0 ? clamp(1 - m.reloadT / 2.4, 0.001, 1) : 0 });
    }
  }

  /** Swedish radio-style barks via on-device speech only (never network voices). */
  bark(m, kind, time) {
    if (time - m.lastBark < 4 || this.game.mode !== 'play') return;
    m.lastBark = time;
    try {
      const synth = window.speechSynthesis; if (!synth) return;
      const voice = synth.getVoices().find(v => v.localService && /^sv/i.test(v.lang));
      if (!voice || synth.speaking) return;
      const lines = SV_BARKS[kind]; const text = lines[Math.floor(Math.random() * lines.length)];
      const u = new SpeechSynthesisUtterance(text);
      // Heard over the group radio, not directly: brisk clipped delivery at a fixed radio level.
      // speechSynthesis cannot be routed through Web Audio, so the radio character comes from the
      // squelch/static bed wrapped around the utterance (audio.radioStart/radioEnd).
      u.voice = voice; u.lang = voice.lang; u.rate = 1.55; u.pitch = 0.9 + m.i * 0.12; u.volume = 0.75;
      const a = this.game.audio, est = 0.25 + text.length * 0.055;
      u.onend = u.onerror = () => { try { a?.radioEnd?.(); } catch (_) {} };
      a?.radioStart?.(est);
      setTimeout(() => { try { synth.speak(u); } catch (_) {} }, 90);
    } catch (_) { /* speech unavailable */ }
  }

  minimapDots() { return this.enabled ? this.members.map(m => ({ x: m.x, z: m.z })) : []; }
}
