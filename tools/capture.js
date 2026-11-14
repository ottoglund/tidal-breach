// Capture actual running-game renders from fixed reference cameras.
// Usage: [VIEWPORT=1600x900] [DSF=1] node tools/capture.js <url-with-?qa=1> <outdir> [desktop|mobile] [waitMs]
// VIEWPORT (CSS px) / DSF override the defaults (desktop 1280x720 @1x; mobile = Playwright 'iPhone 13 landscape' @2x).
// v0.3 renders: desktop `VIEWPORT=1600x900 ... q=high`, mobile `VIEWPORT=844x390 DSF=1 ... q=low`.
// Requires the repo served over HTTP (e.g. python3 -m http.server).
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const cams = JSON.parse(fs.readFileSync(path.join(__dirname, 'cameras.json'), 'utf8'));
(async () => {
  const [url, out, kind = 'desktop', waitMs = '6000'] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const vp = (process.env.VIEWPORT || '').match(/^(\d+)x(\d+)$/), dsf = process.env.DSF ? +process.env.DSF : null;
  const ctxOpts = kind === 'mobile'
    ? { ...devices['iPhone 13 landscape'], deviceScaleFactor: dsf ?? 2, ...(vp ? { viewport: { width: +vp[1], height: +vp[2] }, screen: { width: +vp[1], height: +vp[2] } } : {}) }
    : { viewport: vp ? { width: +vp[1], height: +vp[2] } : { width: 1280, height: 720 }, deviceScaleFactor: dsf ?? 1, hasTouch: true };
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction('window.__TIDAL_QA__ !== undefined', null, { timeout: 600000 });
  await page.waitForFunction('!document.getElementById("startBtn").disabled', null, { timeout: 600000 });
  const manual = await page.evaluate('typeof window.__TIDAL_QA__.hold === "function"');
  if (manual) await page.evaluate(() => window.__TIDAL_QA__.hold(true)); // render frames on demand (slow software GPUs)
  page.setDefaultTimeout(900000);
  await page.click('#startBtn');
  await page.waitForFunction('window.__TIDAL_QA__.state().mode === "play"', null, { timeout: 60000 });
  for (const [name, c] of Object.entries(cams)) {
    if (name.startsWith('_')) continue;
    if (manual) {
      await page.evaluate(c => { const Q = window.__TIDAL_QA__; Q.freeze(true); Q.view(c.x, c.z, c.yaw, c.pitch); Q.renderFrame(12); Q.renderFrame(12.016); }, c);
    } else {
      await page.evaluate(c => { window.__TIDAL_QA__.view(c.x, c.z, c.yaw, c.pitch); if (window.__TIDAL_QA__.freeze) window.__TIDAL_QA__.freeze(true); }, c);
      await page.waitForTimeout(+waitMs);
      await page.evaluate(c => window.__TIDAL_QA__.view(c.x, c.z, c.yaw, c.pitch), c);
      await page.waitForTimeout(1500);
    }
    const file = path.join(out, `${kind}_${name}.png`);
    await page.screenshot({ path: file });
    console.log('saved', file);
  }
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
})();
