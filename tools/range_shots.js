// Gameplay-range soldier survey (QA-only __TIDAL_QA__.soldier hook, several soldiers per frame).
// Usage: [W=1280 H=720] [DISTS=5,10,15,25] [SETS=opfor,hv,dead,obst] NODE_PATH=... node tools/range_shots.js "http://127.0.0.1:8765/game/?qa=1&q=medium" /path/prefix
// Camera at the spawn (0, 1.7, 24) looking down the quay (-Z); soldiers d metres in front of it. Sets:
//  opfor: a guard patrolling across the view, a guard aiming at the camera and firing (muzzle flash), an AKM guard aiming
//  hv:    two comrades in formation facing away and firing / aiming, a helmeted comrade walking toward the camera
//  obst:  three guards killed right next to a container (one frame, camera ~6 m away)
//  dead:  three guards killed from the camera (front), one from the side and one from behind, settled on the ground
// Writes <prefix>_<set>_<d>m.png and prints perf() for each frame. The real guards and comrades are hidden.
const { chromium } = require('playwright');
(async () => {
  const [url, out] = process.argv.slice(2);
  const dists = (process.env.DISTS || '5,10,15,25').split(',').map(Number);
  const sets = (process.env.SETS || 'opfor,hv,dead,obst').split(',');
  const b = await chromium.launch({ args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) } });
  p.setDefaultTimeout(1800000);
  p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await p.goto(url);
  await p.waitForFunction('!document.getElementById("startBtn").disabled', null, { timeout: 900000 });
  await p.evaluate(() => window.__TIDAL_QA__.hold(true));
  await p.click('#startBtn');
  await p.evaluate(() => { const Q = window.__TIDAL_QA__; Q.freeze(true); Q.squad(false); Q.guards(false); Q.weapon(false); });
  // the soldiers are the subject: no HUD / objective markers / first-person rifle over them
  await p.addStyleTag({ content: 'body > *:not(#viewport) { visibility: hidden !important; }' });
  const CZ = 24;
  const scene = (set, d) => {
    const z = CZ - d, k = d / 10;   // lateral spacing grows with distance (same angular layout at every range)
    if (set === 'opfor') return [
      { side: 'opfor', weapon: 'ak74', x: -2.2 * k, z, yaw: Math.PI / 2 + 0.3, walk: 2.1, speed: 0.45, seed: 1.3, time: 7 },
      { side: 'opfor', weapon: 'ak74', x: 0.1 * k, z, yaw: Math.PI - 0.12, aim: 1, flash: 0.12, seed: 3.1, time: 5 },
      { side: 'opfor', weapon: 'akm', x: 2.3 * k, z: z - 0.4, yaw: Math.PI + 0.5, aim: 1, seed: 5.7, time: 11 },
    ];
    if (set === 'hv') return [
      { side: 'hv', weapon: 'ak4c', helmet: false, x: -1.1 * k, z, yaw: 0.15, aim: 1, flash: 0.12, look: 1, seed: 2.2, time: 6 },
      { side: 'hv', weapon: 'ak4c', helmet: true, x: 1.2 * k, z: z - 0.8, yaw: -0.2, aim: 1, look: 3, seed: 4.4, time: 9 },
      { side: 'hv', weapon: 'ak4c', helmet: true, x: 3.0 * k, z: z + 1.5, yaw: Math.PI - 0.25, walk: 4.2, speed: 0.35, look: 5, seed: 6.6, time: 13 },
    ];
    if (set === 'obst') return [   // killed with a container (x 3.9..16.1, z 5.78..8.22) right behind / beside them
      { side: 'opfor', weapon: 'ak74', x: 6.2, z: 8.85, yaw: Math.PI, dead: 6, hitX: 6.2, hitZ: 15, seed: 1.1 },
      { side: 'opfor', weapon: 'akm', x: 9.2, z: 9.0, yaw: Math.PI / 2, dead: 6, hitX: 14, hitZ: 9.0, seed: 2.9 },
      { side: 'opfor', weapon: 'ak74', x: 12.4, z: 9.1, yaw: Math.PI - 0.6, dead: 6, hitX: 10, hitZ: 14, seed: 4.6 },
    ];
    // dead: shooter at the camera (front shot), from the right, from behind the body
    return [
      { side: 'opfor', weapon: 'ak74', x: -2.0 * k, z, yaw: Math.PI, dead: 6, hitX: 0, hitZ: CZ, seed: 1.1 },
      { side: 'opfor', weapon: 'akm', x: 0.3 * k, z: z - 0.6, yaw: Math.PI / 2, dead: 6, hitX: 6, hitZ: z - 0.6, seed: 2.9 },
      { side: 'opfor', weapon: 'ak74', x: 2.4 * k, z, yaw: 0, dead: 6, hitX: 2.4 * k, hitZ: z + 6, seed: 4.6 },
    ];
  };
  for (const set of sets) for (const d of (set === 'obst' ? [6] : dists)) {
    const list = scene(set, d);
    const cam = set === 'obst' ? [9.2, 15.2, 0, -0.3] : [0, 24, 0, d <= 5 ? -0.12 : -0.04];
    const info = await p.evaluate(({ list, cam }) => {
      const Q = window.__TIDAL_QA__;
      Q.soldier({ clear: true });
      const tris = list.map((o, i) => Q.soldier({ ...o, add: i > 0 }));
      Q.view(...cam);
      Q.renderFrame(10);
      const ms = Q.renderFrame(10.02);
      return { tris, ms, perf: Q.perf() };
    }, { list, cam });
    const file = `${out}_${set}_${String(d).padStart(2, '0')}m.png`;
    await p.screenshot({ path: file });
    console.log(file, JSON.stringify(info));
  }
  await b.close();
})();
