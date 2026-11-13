// Shader limit audit: compiles every program the game builds at a quality preset and reports, per program, the
// varying vectors (vertex outputs, counted after the C-style preprocessor so #ifdef'd varyings are only counted when
// active), the uniform vectors of each stage, samplers and attributes. Compare against the WebGL2 minimums
// (MAX_VARYING_VECTORS 15, MAX_VERTEX_UNIFORM_VECTORS 256, MAX_FRAGMENT_UNIFORM_VECTORS 224, 16 texture units).
// The numbers are a property of the GLSL, not of the GPU, so SwiftShader is fine for this.
//
// Usage: NODE_PATH=/opt/node22/lib/node_modules node tools/shader_audit.js "http://127.0.0.1:8765/game/?qa=1&q=low" [--json out.json] [--all]
// Requires gcc (only for its preprocessor) on PATH.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');

const url = process.argv[2];
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const showAll = process.argv.includes('--all');

const SLOTS = { FLOAT: 1, FLOAT_VEC2: 1, FLOAT_VEC3: 1, FLOAT_VEC4: 1, INT: 1, INT_VEC2: 1, INT_VEC3: 1, INT_VEC4: 1, BOOL: 1, FLOAT_MAT2: 2, FLOAT_MAT3: 3, FLOAT_MAT4: 4 };
const COMP = { float: 1, vec2: 2, vec3: 3, vec4: 4, int: 1, ivec2: 2, ivec3: 3, ivec4: 4, bool: 1, uint: 1, mat2: 4, mat3: 9, mat4: 16 };
const ROWS = { mat2: 2, mat3: 3, mat4: 4 };

function preprocess(src) {
  const body = src.split('\n').filter(l => !/^\s*#\s*(version|extension)\b/.test(l)).join('\n');
  const f = '/tmp/claude-0/audit_' + process.pid + '.c';
  fs.writeFileSync(f, body);
  try { return execFileSync('gcc', ['-E', '-P', '-x', 'c', '-w', f], { encoding: 'utf8', maxBuffer: 1 << 26 }); } finally { fs.unlinkSync(f); }
}
function decls(pp, kw) {
  // `kw type name[N];` possibly with several names; qualifiers (flat, highp, ...) are tolerated
  const out = [];
  const re = new RegExp('(?:^|[;{}\\s])' + kw + '\\s+(?:(?:flat|smooth|highp|mediump|lowp)\\s+)*(\\w+)\\s+([^;]+);', 'g');
  let m;
  while ((m = re.exec(pp))) {
    for (const part of m[2].split(',')) {
      const n = /^\s*(\w+)\s*(?:\[\s*(\d+)\s*\])?/.exec(part);
      if (n) out.push({ type: m[1], name: n[1], n: n[2] ? +n[2] : 1 });
    }
  }
  return out;
}
const vecSlots = d => d.type in ROWS ? ROWS[d.type] * d.n : d.n > 1 ? d.n : Math.ceil((COMP[d.type] || 4) / 4);

(async () => {
  const b = await chromium.launch({ args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 844, height: 390 } });
  p.setDefaultTimeout(1800000);
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await p.addInitScript(() => {
    const P = WebGL2RenderingContext.prototype, orig = P.linkProgram;
    window.__progs = [];
    P.linkProgram = function (prog) {
      orig.call(this, prog);
      const sh = this.getAttachedShaders(prog), gl = this;
      const rec = { ok: gl.getProgramParameter(prog, gl.LINK_STATUS), log: gl.getProgramInfoLog(prog), vs: '', fs: '', uniforms: [], attribs: [] };
      for (const s of sh) { const t = gl.getShaderParameter(s, gl.SHADER_TYPE); (t === gl.VERTEX_SHADER ? (rec.vs = gl.getShaderSource(s)) : (rec.fs = gl.getShaderSource(s))); }
      const nu = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < nu; i++) { const u = gl.getActiveUniform(prog, i); rec.uniforms.push({ name: u.name.replace(/\[0\]$/, ''), size: u.size, type: u.type }); }
      const na = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
      for (let i = 0; i < na; i++) rec.attribs.push(gl.getActiveAttrib(prog, i).name);
      window.__progs.push(rec);
    };
    window.__GLENUM = null;
  });
  await p.goto(url);
  await p.waitForFunction('window.__TIDAL_QA__ !== undefined', null, { timeout: 1800000 });
  await p.waitForFunction('!document.getElementById("startBtn").disabled', null, { timeout: 1800000 });
  await p.evaluate(() => window.__TIDAL_QA__.hold(true));
  await p.click('#startBtn');
  // force the lazily compiled programs: every soldier variant, then frames at the spawn and near a node
  const limits = await p.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const r = {};
    for (const k of ['MAX_VARYING_VECTORS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS', 'MAX_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_ATTRIBS']) r[k] = gl.getParameter(gl[k]);
    return r;
  });
  for (const o of [{ side: 'opfor' }, { side: 'hv' }, { side: 'hv', helmet: true }, { side: 'opfor', weapon: 'akm' }]) {
    await p.evaluate(o => { window.__TIDAL_QA__.soldier({ ...o, x: 0, z: 22 }); window.__TIDAL_QA__.renderFrame(10); }, o);
  }
  await p.evaluate(() => { const Q = window.__TIDAL_QA__; Q.soldier({ clear: true }); Q.view(0, 24, 0, -0.04); Q.renderFrame(10); Q.ads(1); Q.renderFrame(10.02); Q.ads(0); Q.view(3, -6, -0.245, -0.12); Q.renderFrame(10.04); });
  const progs = await p.evaluate(() => window.__progs);
  const quality = await p.evaluate(() => window.__TIDAL_QA__.quality);
  await b.close();

  const rows = [];
  for (const g of progs) {
    const vp = preprocess(g.vs), fp = preprocess(g.fs);
    const vary = decls(vp, 'out').filter(d => d.name !== 'gl_Position');
    const fvary = decls(fp, 'in');
    const fdecl = decls(fp, 'uniform'), vdecl = decls(vp, 'uniform');
    const act = new Map(g.uniforms.map(u => [u.name, u]));
    const slots = (decl) => decl.filter(d => act.has(d.name) && !/SAMPLER/.test(act.get(d.name).type) ).reduce((a, d) => a + vecSlots({ ...d, n: act.get(d.name) ? act.get(d.name).size : d.n }), 0);
    const nSamp = (decl) => decl.filter(d => /^(sampler|isampler|usampler)/.test(d.type) && act.has(d.name)).reduce((a, d) => a + d.n, 0);
    const varyVec = vary.reduce((a, d) => a + vecSlots(d), 0);
    const fvaryVec = fvary.reduce((a, d) => a + vecSlots(d), 0);
    const tag = (/FAB\b/.test(g.fs) ? 'cloth ' : '') + (/vSkP/.test(g.fs) ? 'skin ' : '') + (/vAux/.test(g.fs) ? 'arms ' : '') + (/uFogLampPos/.test(g.fs) ? 'fog ' : '') + (/uWetness/.test(g.fs) ? 'wet ' : '') + (/USE_SKINNING|getBoneMatrix/.test(g.vs) && /boneTexture/.test(g.vs) ? 'skinned ' : '');
    // three r170 bakes the light counts into the source, so count them from the active light uniform arrays
    const cnt = re => new Set(g.uniforms.map(u => re.exec(u.name)).filter(Boolean).map(m => m[1])).size;
    const dir = cnt(/^directionalLights\[(\d+)\]\.direction/), spot = cnt(/^spotLights\[(\d+)\]\.position/), pt = cnt(/^pointLights\[(\d+)\]\.position/);
    const spotShadow = cnt(/^spotLightMatrix\[(\d+)\]/) || Math.max(0, ...vary.filter(d => d.name === 'vSpotLightCoord').map(d => d.n));
    const hasHp = /precision highp float/.test(g.fs), hasMp = /precision mediump float/.test(g.fs);
    rows.push({ varyNames: vary.map(d => d.name + (d.n > 1 ? '[' + d.n + ']' : '') + ':' + d.type).join(' '), ok: g.ok, log: g.log, tag: tag.trim() || 'other', varyVec, fvaryVec, vVarNames: vary.length, fragUniformVec: slots(fdecl), vertUniformVec: slots(vdecl), fragSamplers: nSamp(fdecl), vertSamplers: nSamp(vdecl), lights: `d${dir}/s${spot}/p${pt}/sh${spotShadow}`, fragPrecision: hasHp ? 'highp' : hasMp ? 'mediump' : '?', attribs: g.attribs.length, fsLen: g.fs.length });
  }
  const worst = k => Math.max(...rows.map(r => r[k]));
  console.log(JSON.stringify({ quality, limitsOfThisGPU: limits, programs: rows.length, linkFailures: rows.filter(r => !r.ok).length, worst: { varyingVectors: worst('varyVec'), fragUniformVectors: worst('fragUniformVec'), vertUniformVectors: worst('vertUniformVec'), fragSamplers: worst('fragSamplers'), vertSamplers: worst('vertSamplers'), attribs: worst('attribs') }, consoleErrors: errors }, null, 1));
  const sorted = [...rows].sort((a, c) => c.varyVec - a.varyVec || c.fragUniformVec - a.fragUniformVec);
  console.log('varyings frag-uniforms vert-uniforms samplers(f/v) lights  precision  tags');
  for (const r of (showAll ? sorted : sorted.slice(0, 14))) console.log(String(r.varyVec).padStart(4), String(r.fragUniformVec).padStart(6), String(r.vertUniformVec).padStart(6), `${r.fragSamplers}/${r.vertSamplers}`.padStart(6), r.lights.padEnd(14), r.fragPrecision.padEnd(8), r.tag, r.ok ? '' : 'LINK FAILED ' + r.log);
  console.log('varyings of the heaviest program:', sorted[0].varyNames);
  const byTag = {};
  for (const r of rows) { const t = byTag[r.tag] = byTag[r.tag] || { n: 0, vary: 0, fu: 0, vu: 0, fs: 0 }; t.n++; t.vary = Math.max(t.vary, r.varyVec); t.fu = Math.max(t.fu, r.fragUniformVec); t.vu = Math.max(t.vu, r.vertUniformVec); t.fs = Math.max(t.fs, r.fsLen); }
  console.log('by tag (max):', JSON.stringify(byTag));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
})();
