// Soldier close-ups (QA-only __TIDAL_QA__.soldier hook) for comparing shader tiers or builds.
// Usage: [W=844 H=390] NODE_PATH=... node tools/soldier_shots.js "http://127.0.0.1:8765/game/?qa=1&q=low" /path/prefix
// Writes <prefix>_hv.png (Home Guard soldier, 3 m), <prefix>_opfor.png (opposing force, 2 m), <prefix>_face.png (helmeted, 1 m).
const { chromium } = require('playwright');
(async () => {
  const [url, out] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +(process.env.W || 844), height: +(process.env.H || 390) } });
  p.setDefaultTimeout(1800000);
  p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await p.goto(url);
  await p.waitForFunction('!document.getElementById("startBtn").disabled', null, { timeout: 900000 });
  await p.evaluate(() => window.__TIDAL_QA__.hold(true));
  await p.click('#startBtn');
  const shots = [
    { n: 'hv', cam: [0, 25, 0, -0.1], sol: { side: 'hv', x: 0.1, z: 22, yaw: Math.PI, aim: 0.5 } },
    { n: 'opfor', cam: [0, 24, 0, -0.05], sol: { side: 'opfor', x: 0, z: 22, yaw: Math.PI, aim: 1, look: 2 } },
    { n: 'face', cam: [0, 23.1, 0, 0.05], sol: { side: 'hv', helmet: true, x: 0, z: 22, yaw: Math.PI, look: 1 } },
  ];
  for (const s of shots) {
    await p.evaluate(s => { const Q = window.__TIDAL_QA__; Q.freeze(true); Q.soldier(s.sol); Q.view(...s.cam); Q.renderFrame(10); Q.renderFrame(10.02); }, s);
    await p.screenshot({ path: `${out}_${s.n}.png` });
  }
  await b.close();
})();
