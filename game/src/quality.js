// Graphics quality presets. Chosen automatically (touch devices -> low/medium),
// overridable with ?q=low|medium|high or the menu buttons (remembered locally).
export const PRESETS = {
  low: {
    name: 'low', pixelRatio: 1.0, msaa: 0, shadows: false, shadowSize: 512, shadowLights: 0,
    reflections: false, reflScale: 0, bloom: true, ao: false, rain: 1400, volumetric: true,
    anisotropy: 2, pointLights: 4, splashes: 60,
  },
  medium: {
    name: 'medium', pixelRatio: 1.25, msaa: 2, shadows: true, shadowSize: 1024, shadowLights: 2,
    reflections: true, reflScale: 0.35, bloom: true, ao: false, rain: 3500, volumetric: true,
    anisotropy: 4, pointLights: 8, splashes: 140,
  },
  high: {
    name: 'high', pixelRatio: 1.75, msaa: 4, shadows: true, shadowSize: 2048, shadowLights: 4,
    reflections: true, reflScale: 0.5, bloom: true, ao: true, rain: 7000, volumetric: true,
    anisotropy: 8, pointLights: 12, splashes: 260,
  },
};

export function pickQuality(isTouch) {
  const q = new URLSearchParams(location.search).get('q');
  if (q && PRESETS[q]) return PRESETS[q];
  try {
    const saved = localStorage.getItem('tidal.quality');
    if (saved && PRESETS[saved]) return PRESETS[saved];
  } catch (_) { /* storage blocked */ }
  return isTouch ? PRESETS.low : PRESETS.high;
}

export function saveQuality(name) {
  try { localStorage.setItem('tidal.quality', name); } catch (_) { /* ignore */ }
}
