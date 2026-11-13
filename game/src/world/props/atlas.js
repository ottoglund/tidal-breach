// Procedural texture atlases for set dressing (all drawn at runtime on canvas,
// no external images): vertical signage, painted floor markings / stencils,
// ground grime (oil, tyre marks) and chain-link mesh.
import * as THREE from 'three';

// deterministic PRNG so the atlases are identical every run (comparable renders)
function prng(s) { return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; }; }

/** Plane (XY, facing +Z) whose UVs map to a pixel rect of an atlas canvas. */
export function atlasPlane(w, h, rect, size) {
  const [px, py, pw, ph] = rect, [CW, CH] = size;
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const u0 = px / CW, u1 = (px + pw) / CW, v1 = 1 - py / CH, v0 = 1 - (py + ph) / CH;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

function tex(c, srgb = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function weather(g, x, y, w, h, r, amount = 0.25, dark = '20,20,20') {
  for (let i = 0; i < w * h / 260; i++) {
    g.fillStyle = `rgba(${dark},${r() * amount})`;
    g.fillRect(x + r() * w, y + r() * h, 1 + r() * 3, 2 + r() * 14 * (r() < 0.3 ? 3 : 1));
  }
  // rain streaks / runs from the top edge
  for (let i = 0; i < w / 18; i++) {
    const sx = x + r() * w;
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, `rgba(${dark},${0.35 * r()})`); grd.addColorStop(1, `rgba(${dark},0)`);
    g.fillStyle = grd; g.fillRect(sx, y, 1 + r() * 2, h * (0.3 + r() * 0.7));
  }
}

// ---------------------------------------------------------------------------
// Vertical signs (retro-reflective road signs, safety signs, plates).
// ---------------------------------------------------------------------------
let _signs = null;
export function signAtlas() {
  if (_signs) return _signs;
  const CW = 2048, CH = 1024, c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const g = c.getContext('2d'); const r = prng(99);
  g.fillStyle = '#2a2d2f'; g.fillRect(0, 0, CW, CH);
  const rects = {};
  const font = (px, w = 900) => `${w} ${px}px Arial, Helvetica, sans-serif`;
  const center = (t, x, y, px, col, w) => { g.font = font(px, w); g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y); };
  // speed limit 10 (round, red ring) 256x256 at 0,0
  { const x = 0, y = 0; g.fillStyle = '#e9e9e4'; g.beginPath(); g.arc(x + 128, y + 128, 122, 0, 7); g.fill();
    g.fillStyle = '#c4161c'; g.beginPath(); g.arc(x + 128, y + 128, 122, 0, 7); g.arc(x + 128, y + 128, 92, 0, 7, true); g.fill();
    center('10', x + 128, y + 136, 120, '#111'); weather(g, x, y, 256, 256, r, 0.18); rects.speed10 = [x + 4, y + 4, 248, 248]; }
  // NO ACCESS – authorised personnel only (512x256)
  { const x = 256, y = 0; g.fillStyle = '#ecebe6'; g.fillRect(x, y, 512, 256);
    g.fillStyle = '#c4161c'; g.fillRect(x, y, 512, 92); center('OBEHÖRIGA', x + 256, y + 50, 70, '#fff');
    center('ÄGA EJ', x + 256, y + 138, 56, '#111'); center('TILLTRÄDE', x + 256, y + 204, 56, '#111');
    g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, 506, 250); weather(g, x, y, 512, 256, r); rects.noAccess = [x, y, 512, 256]; }
  // DANGER quay edge (512x256)
  { const x = 768, y = 0; g.fillStyle = '#f2c500'; g.fillRect(x, y, 512, 256);
    g.fillStyle = '#c4161c'; g.beginPath(); g.moveTo(x + 90, y + 30); g.lineTo(x + 160, y + 150); g.lineTo(x + 20, y + 150); g.closePath(); g.fill();
    g.fillStyle = '#f2c500'; g.beginPath(); g.moveTo(x + 90, y + 52); g.lineTo(x + 142, y + 140); g.lineTo(x + 38, y + 140); g.closePath(); g.fill();
    center('!', x + 90, y + 108, 70, '#111');
    center('VARNING', x + 340, y + 70, 76, '#111'); center('KAJKANT', x + 340, y + 140, 62, '#111');
    center('FALLRISK – HÅLL AVSTÅND', x + 256, y + 212, 34, '#111', 700); weather(g, x, y, 512, 256, r); rects.quayEdge = [x, y, 512, 256]; }
  // REEFER POWER 440V (512x128)
  { const x = 1280, y = 0; g.fillStyle = '#f2c500'; g.fillRect(x, y, 512, 128);
    center('KYLCONTAINER – 400 V', x + 256, y + 46, 44, '#111'); center('BRYT STRÖMMEN FÖRE URKOPPLING', x + 256, y + 100, 27, '#111', 700);
    weather(g, x, y, 512, 128, r); rects.reefer = [x, y, 512, 128]; }
  // CCTV in operation (512x128) – blue
  { const x = 1280, y = 128; g.fillStyle = '#e8e8e2'; g.fillRect(x, y, 512, 128);
    g.fillStyle = '#1f4f8f'; g.fillRect(x, y, 140, 128); center('REC', x + 70, y + 64, 48, '#fff');
    center('KAMERAÖVERVAKNING', x + 326, y + 46, 31, '#111'); center('BILDER SPARAS', x + 326, y + 94, 36, '#111');
    weather(g, x, y, 512, 128, r); rects.cctv = [x, y, 512, 128]; }
  // PPE mandatory (512x256) – blue mandatory sign
  { const x = 0, y = 256; g.fillStyle = '#ecebe6'; g.fillRect(x, y, 512, 256);
    g.fillStyle = '#1f5fae'; g.beginPath(); g.arc(x + 110, y + 128, 90, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 110, y + 132, 48, Math.PI, 0); g.fill(); g.fillRect(x + 50, y + 128, 120, 14);
    center('SKYDDSHJÄLM OCH', x + 345, y + 92, 31, '#111'); center('VARSELKLÄDER', x + 345, y + 140, 34, '#111'); center('OBLIGATORISKT', x + 345, y + 188, 34, '#111');
    weather(g, x, y, 512, 256, r); rects.ppe = [x, y, 512, 256]; }
  // BERTH 04 / max speed (512x256) – terminal blue
  { const x = 512, y = 256; g.fillStyle = '#123044'; g.fillRect(x, y, 512, 256);
    center('KAJ', x + 256, y + 70, 64, '#e8edf0', 700); center('4', x + 256, y + 160, 130, '#f2c500');
    weather(g, x, y, 512, 256, r, 0.3, '0,0,0'); rects.berth = [x, y, 512, 256]; }
  // door numbers (256x256 each, white plate black number)
  ['1', '2', '3'].forEach((n, i) => { const x = 1024 + i * 256, y = 256; g.fillStyle = '#e4e3dc'; g.fillRect(x, y, 256, 256);
    g.fillStyle = '#111'; g.fillRect(x, y, 256, 40); center('PORT', x + 128, y + 21, 30, '#e4e3dc'); center(n, x + 128, y + 150, 170, '#111');
    weather(g, x, y, 256, 256, r); rects['door' + n] = [x, y, 256, 256]; });
  // green fire exit (256x128)
  { const x = 1792, y = 256; g.fillStyle = '#108a3c'; g.fillRect(x, y, 256, 128); center('NÖDUT-', x + 150, y + 44, 38, '#fff'); center('GÅNG', x + 150, y + 90, 38, '#fff');
    g.fillStyle = '#fff'; g.fillRect(x + 22, y + 34, 44, 60); g.fillStyle = '#108a3c'; g.fillRect(x + 30, y + 42, 28, 52); rects.exit = [x, y, 256, 128]; }
  // fire hose / extinguisher (256x128) red
  { const x = 1792, y = 384; g.fillStyle = '#b4141a'; g.fillRect(x, y, 256, 128); center('BRANDPOST', x + 128, y + 44, 44, '#fff'); center('BRANDSLANG', x + 128, y + 96, 36, '#fff', 700); rects.fire = [x, y, 256, 128]; }
  // container stack row plates (256x128): A..H style row markers
  ['RAD 01', 'RAD 02', 'RAD 03', 'RAD 04'].forEach((t, i) => { const x = 1024 + i * 256, y = 512; g.fillStyle = '#f2c500'; g.fillRect(x, y, 256, 128);
    center(t, x + 128, y + 66, 64, '#111'); weather(g, x, y, 256, 128, r); rects['row' + (i + 1)] = [x, y, 256, 128]; });
  // electrical cabinet warning plate (256x128)
  { const x = 0, y = 512; g.fillStyle = '#f2c500'; g.fillRect(x, y, 256, 128); center('HÖGSPÄNNING', x + 128, y + 40, 34, '#111'); center('LIVSFARA', x + 128, y + 92, 48, '#111'); rects.volt = [x, y, 256, 128]; }
  _signs = { texture: tex(c), rects, size: [CW, CH] };
  return _signs;
}

// ---------------------------------------------------------------------------
// Painted markings (RGBA paint on transparent): bay codes, arrows, STOP, hatching.
// ---------------------------------------------------------------------------
let _paint = null;
export function paintAtlas() {
  if (_paint) return _paint;
  const CW = 2048, CH = 1024, c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const g = c.getContext('2d'); const r = prng(7);
  const rects = {};
  const W = '#d9d9d2', Y = '#d8a928';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // bay codes: 16 cells of 256x128 (4 rows x 4 cols) at top-left area
  const codes = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'C01', 'C02', 'C03', 'C04'];
  codes.forEach((t, i) => { const x = (i % 4) * 256, y = Math.floor(i / 4) * 128;
    g.fillStyle = i < 6 || i >= 12 ? W : Y; g.font = '900 96px Arial, Helvetica, sans-serif'; g.fillText(t, x + 128, y + 66); rects[t] = [x + 4, y + 4, 248, 120]; });
  // straight arrow (256x512) at x=1024
  { const x = 1024, y = 0; g.fillStyle = W; g.fillRect(x + 104, y + 180, 48, 310);
    g.beginPath(); g.moveTo(x + 128, y + 20); g.lineTo(x + 220, y + 200); g.lineTo(x + 36, y + 200); g.closePath(); g.fill(); rects.arrow = [x, y, 256, 512]; }
  // STOP (512x256)
  { const x = 1280, y = 0; g.fillStyle = W; g.font = '900 200px Arial Narrow, Arial, sans-serif'; g.fillText('STOPP', x + 256, y + 136); rects.stop = [x, y, 512, 256]; }
  // SLOW 10 (512x256)
  { const x = 1280, y = 256; g.fillStyle = W; g.font = '900 150px Arial Narrow, Arial, sans-serif'; g.fillText('10', x + 256, y + 92); g.font = '900 80px Arial, sans-serif'; g.fillText('km/h', x + 256, y + 205); rects.slow = [x, y, 512, 256]; }
  // yellow keep-clear hatching (512x512) at 0,512
  { const x = 0, y = 512; g.save(); g.beginPath(); g.rect(x, y, 512, 512); g.clip();
    g.strokeStyle = Y; g.lineWidth = 20; g.strokeRect(x + 10, y + 10, 492, 492);
    g.lineWidth = 34; for (let k = -512; k < 512; k += 96) { g.beginPath(); g.moveTo(x + k, y + 512); g.lineTo(x + k + 512, y); g.stroke(); }
    g.restore(); rects.hatch = [x, y, 512, 512]; }
  // big stencilled door numbers on cladding (256x256)
  ['01', '02', '03'].forEach((t, i) => { const x = 512 + i * 256, y = 512; g.fillStyle = W; g.font = '900 190px Arial Narrow, Arial, sans-serif'; g.fillText(t, x + 128, y + 136); rects['D' + t] = [x, y, 256, 256]; });
  // wear: knock speckles out of the paint and erode it along tyre paths
  const img = g.getImageData(0, 0, CW, CH);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    const px = (i / 4) % CW, py = Math.floor(i / 4 / CW);
    const n = Math.sin(px * 0.05 + Math.sin(py * 0.031) * 3) * Math.sin(py * 0.043 + px * 0.011);
    const keep = r() < 0.18 ? r() * 0.4 : 1;
    img.data[i + 3] *= Math.max(0, Math.min(1, 0.85 + n * 0.35)) * keep;
  }
  g.putImageData(img, 0, 0);
  _paint = { texture: tex(c), rects, size: [CW, CH] };
  return _paint;
}

// ---------------------------------------------------------------------------
// Ground grime (alpha map, white = stain): oil, tyre marks, rust bleed.
// 4x2 cells of 256x256.
// ---------------------------------------------------------------------------
let _grime = null;
export function grimeAtlas() {
  if (_grime) return _grime;
  const CW = 1024, CH = 512, c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const g = c.getContext('2d'); const r = prng(4242);
  g.fillStyle = '#000'; g.fillRect(0, 0, CW, CH);
  const rects = [];
  const blob = (cx, cy, rad, a) => { const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad); grd.addColorStop(0, `rgba(255,255,255,${a})`); grd.addColorStop(0.6, `rgba(255,255,255,${a * 0.6})`); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.fill(); };
  for (let i = 0; i < 8; i++) {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 256;
    g.save(); g.beginPath(); g.rect(x + 2, y + 2, 252, 252); g.clip();
    if (i < 4) {
      // oil / hydraulic fluid stain: drip core + splash satellites + runs
      for (let k = 0; k < 30; k++) { const a = r() * 6.28, d = Math.pow(r(), 1.8) * 70; blob(x + 128 + Math.cos(a) * d, y + 128 + Math.sin(a) * d * 0.8, 14 + r() * 40, 0.12 + r() * 0.25); }
      for (let k = 0; k < 40; k++) { const a = r() * 6.28, d = 60 + r() * 50; blob(x + 128 + Math.cos(a) * d, y + 128 + Math.sin(a) * d, 2 + r() * 6, 0.4 * r()); }
    } else if (i < 6) {
      // tyre marks: two parallel tread bands curving across the cell
      const k0 = r() * 0.6 - 0.3;
      for (const off of [-52, 52]) for (let t = 0; t < 260; t += 2) {
        const yy = y + t, xx = x + 128 + off + Math.sin(t / 260 * 3.0 + k0) * 40 * k0 * 3;
        g.fillStyle = `rgba(255,255,255,${(0.18 + 0.2 * r()) * (0.5 + 0.5 * Math.sin(t * 0.7) ** 2)})`;
        g.fillRect(xx - 16, yy, 32, 2);
      }
    } else {
      // rust bleed / wet grime patch with streaks
      for (let k = 0; k < 18; k++) blob(x + 40 + r() * 176, y + 40 + r() * 176, 20 + r() * 60, 0.08 + r() * 0.15);
      for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(255,255,255,${0.15 * r()})`; g.fillRect(x + r() * 256, y + r() * 256, 1 + r() * 2, 20 + r() * 60); }
    }
    g.restore();
    rects.push([x + 2, y + 2, 252, 252]);
  }
  _grime = { texture: tex(c, false, 4), rects, size: [CW, CH] };
  return _grime;
}

// Chain-link mesh (alpha), tiles every 6 cm diamond; RepeatWrapping.
let _mesh = null;
export function chainLinkTexture() {
  if (_mesh) return _mesh;
  const n = 64, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
  g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(0, n / 2); g.lineTo(n / 2, 0); g.lineTo(n, n / 2); g.lineTo(n / 2, n); g.closePath(); g.stroke();
  _mesh = new THREE.CanvasTexture(c);
  _mesh.wrapS = _mesh.wrapT = THREE.RepeatWrapping;
  _mesh.anisotropy = 4;
  return _mesh;
}
