// People-in-the-port survey: readability by scene light at 5-25 m (lit and dark lanes), lamp-facing wet shots, sling
// poses and face close-ups (blink / speaking / gaze sequences). QA-only __TIDAL_QA__ hooks; one frame at a time
// (SwiftShader is slow). The real guards and comrades are hidden for the soldier sets; `spawn` renders the plain game
// view and prints perf().
// Usage: [W=1280 H=720] [SETS=spawn,lit,dark,wet,sling,face] [DISTS=5,10,15,25] NODE_PATH=... \
//          node tools/life_shots.js "http://127.0.0.1:8765/game/?qa=1&q=medium" /path/prefix
// Writes <prefix>_<set>_<name>.png and prints one JSON line per frame. Builds without the face / vapour options
// (blink, jaw, brow, gaze, puff) simply ignore them, so the same script renders before / after.
const { chromium } = require('playwright');
(async () => {
  const [url, out] = process.argv.slice(2);
  const dists = (process.env.DISTS || '5,10,15,25').split(',').map(Number);
  const sets = (process.env.SETS || 'spawn,lit,dark,wet,sling,face').split(',');
  const b = await chromium.launch({ args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) } });
  p.setDefaultTimeout(1800000);
  p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 300)); });
  await p.goto(url);
  await p.waitForFunction('!document.getElementById("startBtn").disabled', null, { timeout: 900000 });
  await p.evaluate(() => window.__TIDAL_QA__.hold(true));
  await p.click('#startBtn');
  const shot = async (name, list, cam, opts = {}) => {
    const info = await p.evaluate(({ list, cam, opts }) => {
      const Q = window.__TIDAL_QA__;
      Q.freeze(true);
      Q.soldier({ clear: true });
      const tris = list.map((o, i) => Q.soldier({ ...o, add: i > 0 }));
      Q.view(...cam);
      Q.renderFrame(opts.t ?? 10);
      const ms = Q.renderFrame((opts.t ?? 10) + 0.02);
      const pf = Q.perf();
      return { tris, ms: Math.round(ms), calls: pf.calls, triangles: pf.triangles, exposure: pf.exposure, probes: Q.probes ? Q.probes() : null };
    }, { list, cam, opts });
    const file = `${out}_${name}.png`;
    await p.screenshot({ path: file });
    console.log(file, JSON.stringify(info));
  };
  if (sets.includes('spawn')) {
    // the game's own spawn view (guards / squad as the game placed them), for perf()
    const info = await p.evaluate(() => { const Q = window.__TIDAL_QA__; Q.freeze(true); Q.view(0, 24, 0, -0.04); Q.renderFrame(10); const ms = Q.renderFrame(10.02); return { ms: Math.round(ms), perf: Q.perf() }; });
    await p.screenshot({ path: `${out}_spawn.png` });
    console.log(`${out}_spawn.png`, JSON.stringify(info));
  }
  await p.evaluate(() => { const Q = window.__TIDAL_QA__; Q.squad(false); Q.guards(false); Q.weapon(false); });
  await p.addStyleTag({ content: 'body > *:not(#viewport), #cross, #cross * { visibility: hidden !important; }' });
  // soldier facing a world point (x, z): the model faces -Z, root.rotation.y = yaw
  const face = (sx, sz, tx, tz) => Math.atan2(-(tx - sx), -(tz - sz));
  // camera yaw looking from (cx, cz) toward (tx, tz): forward = (sin yaw, -cos yaw)
  const look = (cx, cz, tx, tz) => Math.atan2(tx - cx, -(tz - cz));
  const range = (cx, cz, d) => {
    const z = cz - d, k = d / 10;
    return [
      { side: 'opfor', weapon: 'ak74', x: cx - 2.2 * k, z, yaw: Math.PI / 2 + 0.3, walk: 2.1, speed: 0.45, seed: 1.3, time: 7 },
      { side: 'opfor', weapon: 'ak74', x: cx + 0.1 * k, z, yaw: Math.PI - 0.12, aim: 1, seed: 3.1, time: 5 },
      { side: 'hv', weapon: 'ak4c', helmet: false, x: cx + 2.3 * k, z: z - 0.4, yaw: Math.PI - 0.5, aim: 0.3, look: 1, seed: 5.7, time: 11 },
    ];
  };
  // lit lane: the spawn, looking down the quay between the sodium (31, 18) and LED (-31, 7) masts
  if (sets.includes('lit')) for (const d of dists) await shot(`lit_${String(d).padStart(2, '0')}m`, range(0, 24, d), [0, 24, 0, d <= 5 ? -0.1 : -0.04]);
  // dark lane: between the container rows west of the warehouse building (x -24.8 .. -13.2), no lamp in line of sight
  if (sets.includes('dark')) for (const d of dists) await shot(`dark_${String(d).padStart(2, '0')}m`, range(-17, 4, d), [-17, 4, 0, d <= 5 ? -0.1 : -0.04]);
  if (sets.includes('wet')) {
    // lamp-facing: camera looking toward a mast with the soldier between (lamps behind and above him: rim / sheen),
    // pitched up so the mast head is in frame; LED mast (-31, 7) and sodium mast (31, 18)
    const L1 = [-10, 20], M1 = [-31, 7], L2 = [14, 26], M2 = [31, 18];
    for (const [n, C, M, dd] of [['led_3m', L1, M1, 3], ['led_8m', L1, M1, 8], ['sodium_4m', L2, M2, 4], ['sodium_10m', L2, M2, 10]]) {
      const dx = M[0] - C[0], dz = M[1] - C[1], l = Math.hypot(dx, dz);
      const sx = C[0] + dx / l * dd, sz = C[1] + dz / l * dd;
      await shot(`wet_${n}`, [
        { side: 'hv', weapon: 'ak4c', helmet: true, x: sx, z: sz, yaw: face(sx, sz, C[0], C[1]) + 0.35, aim: 0.2, look: 3, seed: 2.2, time: 6 },
        { side: 'opfor', weapon: 'ak74', x: sx - dz / l * 1.2, z: sz + dx / l * 1.2, yaw: face(sx, sz, C[0], C[1]) - 0.6, walk: 1.0, speed: 0.3, seed: 4.1, time: 8 },
      ], [C[0], C[1], look(C[0], C[1], M[0], M[1]), dd <= 4 ? 0.12 : 0.2]);
    }
  }
  if (sets.includes('sling')) {
    // left side of a soldier facing +Z (his left = world +X), chest height, 2.3 m; and a front three-quarter view
    const S = { side: 'opfor', weapon: 'ak74', x: 0, z: 20, yaw: Math.PI, seed: 3.1, time: 5 };
    const side = [2.3, 20.4, look(2.3, 20.4, 0, 20), -0.18], tq = [1.6, 22.0, look(1.6, 22.0, 0, 20), -0.15], back = [-1.2, 18.0, look(-1.2, 18.0, 0, 20), -0.15];
    await shot('sling_lowready_side', [S], side);
    await shot('sling_lowready_34', [S], tq);
    await shot('sling_lowready_back', [S], back);
    await shot('sling_aim_side', [{ ...S, aim: 1 }], side);
    await shot('sling_aim_34', [{ ...S, aim: 1 }], tq);
    await shot('sling_walk_side', [{ ...S, walk: 3.3, speed: 0.4 }], side);
    await shot('sling_hv_aim_34', [{ ...S, side: 'hv', weapon: 'ak4c', helmet: true, aim: 1, look: 1 }], tq);
    await shot('sling_dead_side', [{ ...S, dead: 6, hitX: 0, hitZ: 26 }], [2.6, 19.2, look(2.6, 19.2, 0, 19.4), -0.45]);
    await shot('sling_dead_top', [{ ...S, dead: 6, hitX: 3, hitZ: 22, seed: 4.6 }], [0.4, 21.6, look(0.4, 21.6, 0, 19.6), -0.6]);
  }
  if (sets.includes('face')) {
    // bare-headed Home Guard soldier, ~0.9 m, a sodium wall-pack-like QA light up and to the left (as in earlier surveys)
    const F = { side: 'hv', weapon: 'ak4c', helmet: false, x: 0, z: 22, yaw: Math.PI, look: 1, seed: 2.0, time: 5, light: 30, lightColor: 0xffb070, lx: -1.2, ly: 2.4, lz: 1.6 };
    const cam = [0, 22.95, 0, -0.02];
    await shot('face_neutral', [F], cam);
    for (const k of [0.35, 0.7, 1.0]) await shot(`face_blink_${k.toFixed(2)}`, [{ ...F, blink: k }], cam);
    for (const [n, gx] of [['left', -2], ['right', 2]]) await shot(`face_gaze_${n}`, [{ ...F, gaze: [gx, 1.6, 26] }], cam);
    for (const k of [0.3, 0.6, 1.0]) await shot(`face_speak_${k.toFixed(1)}`, [{ ...F, jaw: k, brow: k * 0.8 }], cam);
    for (const a of [0.25, 0.7]) await shot(`face_breath_${a.toFixed(2)}`, [{ ...F, puff: a }], cam);
    // breath in profile against the dark quay (camera on the soldier's left)
    for (const a of [0, 0.35]) await shot(`face_breath_side_${a.toFixed(2)}`, [{ ...F, puff: a > 0 ? a : undefined, light: 0 }], [-0.85, 22.5, look(-0.85, 22.5, 0, 22.25), -0.03]);
    await shot('face_look0_wet', [{ ...F, look: 0, light: 0 }], cam);
    await shot('face_opfor_speak', [{ ...F, side: 'opfor', weapon: 'ak74', jaw: 0.9, brow: 0.6 }], cam);
    await shot('face_helmet', [{ ...F, helmet: true, look: 3 }], cam);
  }
  await b.close();
})();
