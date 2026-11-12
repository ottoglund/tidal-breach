"""Generate the original PBR texture sets for TIDAL BREACH.

All maps are synthesised from code in this repository (no photographs or
third-party images), so the output is original work under the project's
own licence. Run from the repo root:

    python3 tools/texgen/make_textures.py [names...]

Output: game/assets/textures/<set>_{albedo,normal,orm}.webp
  albedo : sRGB base colour
  normal : OpenGL (+Y) tangent-space normal
  orm    : R = ambient occlusion, G = roughness, B = metalness  (metal sets)
           R = ambient occlusion, G = roughness, B = height     (ground sets)
"""
import os
import sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from noise import (Rng, fbm, blur, blur_dir, voronoi, warp, smoothstep,
                   normal_from_height, ao_from_height, lines_mask, norm01)

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'game', 'assets', 'textures')
os.makedirs(OUT, exist_ok=True)


def srgb(c):
    """Hex or tuple (0..255) -> linear-ish working colour 0..1 (we work in sRGB space for albedo)."""
    if isinstance(c, str):
        c = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
    return np.array(c, np.float32) / 255.0


def lerp(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 and np.ndim(a) == 3 or (np.ndim(t) == 2 and np.ndim(b) == 3) else t
    return a + (b - a) * t


def col(n, c):
    return np.broadcast_to(srgb(c), (n, n, 3)).astype(np.float32)


def save(name, albedo=None, normal=None, orm=None, q=88):
    def w(arr, suffix, quality):
        arr = np.clip(arr, 0, 1)
        img = Image.fromarray((arr * 255 + 0.5).astype(np.uint8))
        p = os.path.join(OUT, f'{name}_{suffix}.webp')
        img.save(p, 'WEBP', quality=quality, method=6)
        print('  wrote', os.path.relpath(p), f'{os.path.getsize(p) // 1024} KB')
    if albedo is not None:
        w(albedo, 'albedo', q)
    if normal is not None:
        w(normal * 0.5 + 0.5, 'normal', 92)
    if orm is not None:
        w(orm, 'orm', 90)


# ---------------------------------------------------------------------------
# Ground: wet harbour asphalt. Tile = 4 m.
# ---------------------------------------------------------------------------
def asphalt(n=2048, seed=11):
    r = Rng(seed)
    # aggregate: dense small stones in bitumen
    f1, f2, cid = voronoi(n, 420, r, 1.0)
    stones = smoothstep(0.62, 0.32, f1)              # stone body
    stone_top = (f2 - f1)                              # flat tops
    fine = fbm(n, r, 1.2, lo=200)
    mid = fbm(n, r, 2.2, lo=6, hi=120)
    macro = fbm(n, r, 2.8, lo=1, hi=12)
    # cracks: warped voronoi edges at large scale
    cf1, cf2, _ = voronoi(n, 5, r, 0.9)
    wx, wy = fbm(n, r, 2.4, lo=3, hi=60), fbm(n, r, 2.4, lo=3, hi=60)
    edge = warp(cf2 - cf1, wx, wy, 26)
    crack_sel = smoothstep(0.42, 0.8, warp(norm01(fbm(n, r, 2.6, lo=1, hi=8)), wx, wy, 10))
    crack = smoothstep(0.022, 0.0, edge) * crack_sel
    seal = smoothstep(0.08, 0.0, edge) * crack_sel * 0.9   # bitumen crack sealant band
    # height
    h = stones * (0.55 + 0.45 * cid) * 0.6 + stones * stone_top * 0.25 + fine * 0.05 + mid * 0.05
    h -= crack * 0.8
    h += macro * 0.12
    # wear: binder worn away in wheel paths -> more exposed aggregate (macro scale)
    wear = smoothstep(-0.4, 1.4, macro)
    # albedo
    binder = col(n, '#1d1f21')
    aggregate_light = col(n, '#6f6c66')
    aggregate_dark = col(n, '#3d3c3a')
    ag = lerp(aggregate_dark, aggregate_light, (cid ** 1.5))
    ag *= (0.85 + 0.25 * np.clip(fine[..., None] * 0.5 + 0.5, 0, 1))
    alb = lerp(binder, ag, np.clip(stones * (0.35 + 0.55 * wear), 0, 1))
    alb *= (0.82 + 0.18 * np.clip(mid * 0.4 + 0.5, 0, 1))[..., None]
    # oil / tyre stains
    stain = smoothstep(0.9, 2.4, fbm(n, r, 3.0, lo=1, hi=16))
    alb = lerp(alb, alb * 0.55, stain * 0.8)
    alb = lerp(alb, col(n, '#121314'), seal)
    alb = lerp(alb, col(n, '#0b0b0b'), crack)
    # roughness: bitumen ~0.75, stones 0.65, seal and stains glossier
    rough = 0.82 - 0.14 * stones * wear + 0.06 * fine * 0.3 - 0.25 * seal - 0.18 * stain
    ao = ao_from_height(h, 2.5, 3.5) * (1 - crack * 0.6)
    height = norm01(blur(h, 1.0))
    nrm = normal_from_height(h, 5.0)
    save('asphalt', alb, nrm, np.stack([ao, np.clip(rough, 0.3, 1), height], -1))


# ---------------------------------------------------------------------------
# Quay concrete: cast-in-place slabs with broom finish. Tile = 3 m.
# ---------------------------------------------------------------------------
def concrete(n=1024, seed=21):
    r = Rng(seed)
    f1, f2, cid = voronoi(n, 160, r, 1.0)
    pores = smoothstep(0.12, 0.02, f1) * (r.random((n, n)) > 0.0)
    pores *= smoothstep(0.6, 1.0, cid)
    fine = fbm(n, r, 1.4, lo=120)
    mid = fbm(n, r, 2.3, lo=4, hi=80)
    macro = fbm(n, r, 3.0, lo=1, hi=10)
    broom = fbm(n, r, 1.0, lo=40, aniso=(0.08, 1.0)) * 0.6   # transverse broom marks
    # joint at tile border (both axes)
    ys, xs = np.mgrid[0:n, 0:n]
    dj = np.minimum(np.minimum(xs, n - 1 - xs), np.minimum(ys, n - 1 - ys)).astype(np.float32)
    joint = smoothstep(5, 1.5, dj)
    chip = smoothstep(0.6, 1.6, fbm(n, r, 2.0, lo=8, hi=90)) * smoothstep(16, 4, dj)
    h = fine * 0.08 + mid * 0.1 + broom * 0.12 - pores * 0.6 - joint * 1.2 - chip * 0.5
    base = col(n, '#8d8a83')
    alb = base * (0.86 + 0.1 * mid[..., None] * 0.5 + 0.06 * fine[..., None] * 0.4)
    # efflorescence / grime blotches
    blot = smoothstep(0.3, 1.8, macro)
    alb = lerp(alb, alb * np.array([0.72, 0.72, 0.70]), blot)
    lime = smoothstep(1.2, 2.4, fbm(n, r, 2.6, lo=2, hi=40))
    alb = lerp(alb, col(n, '#a9a79f'), lime * 0.5)
    rust_drip = smoothstep(1.6, 2.6, fbm(n, r, 2.4, lo=3, hi=40)) * 0.7
    alb = lerp(alb, col(n, '#6b4a33'), rust_drip * 0.5)
    alb = lerp(alb, col(n, '#2a2826'), np.maximum(joint, pores * 0.7))
    rough = 0.9 - 0.08 * blot - 0.1 * joint
    ao = ao_from_height(h, 2, 3) * (1 - joint * 0.5)
    save('concrete', alb, normal_from_height(h, 3.5), np.stack([ao, rough, norm01(blur(h, 1))], -1))


# ---------------------------------------------------------------------------
# Container paint. UV: u across 3 m of panel width, v = 0 bottom .. 1 top (2.6 m).
# Corrugation is real geometry; this is paint, rust and grime.
# ---------------------------------------------------------------------------
def container_masks(n, seed):
    r = Rng(seed)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    vtop = 1 - ys / n          # 1 at top of image (top of container)
    fine = fbm(n, r, 1.3, lo=150)
    mid = fbm(n, r, 2.2, lo=3, hi=90)
    macro = fbm(n, r, 2.8, lo=1, hi=8)
    # rust spots seeded near the top rail and bottom rail + random chips
    seeds = smoothstep(1.6, 2.8, fbm(n, r, 1.8, lo=6, hi=200))
    seeds = np.maximum(seeds, smoothstep(0.92, 1.0, vtop) * smoothstep(0.4, 1.6, fbm(n, r, 1.6, lo=6, hi=200)))
    bottom = smoothstep(0.12, 0.0, vtop) * smoothstep(-0.5, 1.2, fbm(n, r, 1.8, lo=4, hi=200))
    seeds = np.maximum(seeds, bottom)
    # rust runs downwards (image +y is down)
    runs = blur_dir(seeds * smoothstep(0.0, 1.0, fbm(n, r, 1.0, lo=20, aniso=(1.0, 0.05)) + 0.6), 140, axis=0)
    runs = np.clip(runs * 7.0, 0, 1) ** 1.3 * smoothstep(-1.5, 1.0, fbm(n, r, 1.0, lo=30, aniso=(1.0, 0.04)))
    scratches = lines_mask(n, r, 260, 16, 0.5) * 0.8
    dents = fbm(n, r, 2.6, lo=2, hi=30)
    grime = smoothstep(0.55, 0.0, vtop) * (0.5 + 0.5 * np.clip(mid, -1, 1)) + 0.15 * smoothstep(0.5, 2.0, macro)
    streak = np.clip(blur_dir(np.clip(fbm(n, r, 1.0, lo=24, aniso=(1, 0.02)), 0, None) * 0.5, 90, axis=0) * smoothstep(-0.2, 1.0, vtop) , 0, 1)
    # repaint patches: rectangular touch-ups of slightly different tone
    patch = np.zeros((n, n), np.float32)
    for _ in range(5):
        x0, y0 = int(r.random() * n), int(r.random() * n); w, h = int(60 + r.random() * 260), int(40 + r.random() * 200)
        patch[np.ix_(np.arange(y0, y0 + h) % n, np.arange(x0, x0 + w) % n)] = 0.5 + r.random() * 0.5
    patch = blur(patch, 1.2) * smoothstep(-1.0, 0.5, fbm(n, r, 1.5, lo=20))
    return dict(patch=patch, fine=fine, mid=mid, macro=macro, rust=np.clip(seeds, 0, 1), runs=runs,
                scratches=scratches, dents=dents, grime=np.clip(grime, 0, 1), streak=streak)


def container(name, paint, n=1024, seed=31, fade=0.0):
    m = container_masks(n, seed)
    p = col(n, paint)
    # sun-faded and chalky paint variation
    p = p * (0.9 + 0.07 * m['mid'][..., None] * 0.5 + 0.03 * m['fine'][..., None] * 0.4)
    p = lerp(p, p * 0.6 + 0.4 * np.array([0.62, 0.62, 0.6]), np.clip(fade + 0.15 * m['macro'], 0, 1))
    rust_core = col(n, '#5a2e17') * (0.8 + 0.3 * np.clip(m['fine'] * 0.5 + 0.5, 0, 1))[..., None]
    rust_stain = col(n, '#7a4a2a')
    alb = lerp(p, p * np.array([0.9, 0.93, 0.97]) + 0.03, m['patch'] * 0.6)
    alb = lerp(alb, rust_stain, np.clip(m['runs'] * 0.65, 0, 1))
    alb = lerp(alb, p * 0.55 + col(n, '#3a3530') * 0.45, m['grime'] * 0.55)
    alb = lerp(alb, alb * 0.62 + 0.03, np.clip(m["streak"] * 2.0, 0, 1))
    alb = lerp(alb, rust_core, smoothstep(0.35, 0.8, m['rust']))
    alb = lerp(alb, col(n, '#6c6c68'), m['scratches'] * 0.8)  # bare primer/steel in scratches
    rough = 0.58 - 0.08 * m['patch'] + 0.12 * m['grime'] + 0.1 * m['streak'] + 0.25 * smoothstep(0.35, 0.8, m['rust']) + 0.05 * m['fine'] * 0.3 - 0.2 * m['scratches']
    metal = m['scratches'] * 0.7
    h = m['dents'] * 0.15 - m['scratches'] * 0.3 + smoothstep(0.35, 0.9, m['rust']) * (0.4 + 0.3 * m['fine'])
    ao = ao_from_height(h, 3, 2)
    save(name, alb, normal_from_height(h, 2.5), np.stack([ao, np.clip(rough, 0.25, 1), metal], -1))


# ---------------------------------------------------------------------------
# Generic painted steel (crane, bollards, railings) with edge wear.
# ---------------------------------------------------------------------------
def painted_steel(name, paint, n=1024, seed=41, wear=0.5, rust_amt=0.5):
    r = Rng(seed)
    fine = fbm(n, r, 1.3, lo=150)
    mid = fbm(n, r, 2.3, lo=3, hi=80)
    chips = smoothstep(2.1 - wear, 2.6 - wear, fbm(n, r, 1.6, lo=10, hi=300))
    rust = smoothstep(2.0 - rust_amt, 2.8 - rust_amt, fbm(n, r, 2.0, lo=3, hi=150))
    runs = np.clip(blur_dir(rust, 80, axis=0) * 0.5, 0, 1)
    p = col(n, paint) * (0.92 + 0.08 * mid[..., None] * 0.5)
    alb = lerp(p, col(n, '#6e4a30'), runs * 0.6)
    alb = lerp(alb, alb * 0.75 + 0.25 * np.array([0.25, 0.24, 0.22]), smoothstep(0.0, 2.0, mid) * 0.6)
    alb = lerp(alb, col(n, '#4f2a16'), rust)
    alb = lerp(alb, col(n, '#7b7d7d'), chips * (1 - rust))
    rough = 0.5 + 0.08 * mid * 0.3 + 0.35 * rust - 0.15 * chips
    metal = chips * (1 - rust) * 0.9
    h = fine * 0.04 + rust * 0.5 * (0.5 + 0.5 * fine) - chips * 0.25
    save(name, alb, normal_from_height(h, 3), np.stack([ao_from_height(h, 3, 2), np.clip(rough, .2, 1), metal], -1))


# ---------------------------------------------------------------------------
# Ship hull: dark paint, weld seams, rust runs from scuppers. Tile 8 m.
# ---------------------------------------------------------------------------
def hull(n=1024, seed=51):
    r = Rng(seed)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    fine = fbm(n, r, 1.3, lo=150)
    mid = fbm(n, r, 2.3, lo=3, hi=80)
    plates_v = smoothstep(2.0, 0.0, np.abs(((xs + 0.5) % (n / 4)) - 0.5))
    plates_h = smoothstep(2.0, 0.0, np.abs(((ys + 0.5) % (n / 2)) - 0.5))
    seam = np.maximum(plates_v, plates_h)
    src = smoothstep(2.0, 2.8, fbm(n, r, 1.5, lo=6, hi=200)) + seam * smoothstep(1.2, 2.2, fbm(n, r, 1.5, lo=6, hi=200))
    runs = np.clip(blur_dir(np.clip(src, 0, 1), 260, axis=0) * 1.2, 0, 1)
    runs *= smoothstep(-1.2, 1.0, fbm(n, r, 1.0, lo=30, aniso=(1, .04)))
    oilcan = fbm(n, r, 2.8, lo=2, hi=20)  # distorted plating ("hungry horse")
    p = col(n, '#1d2a35') * (0.9 + 0.1 * mid[..., None] * 0.5)
    alb = lerp(p, col(n, '#5b3a25'), runs * 0.7)
    alb = lerp(alb, col(n, '#3e2414'), np.clip(src, 0, 1) * 0.8)
    alb = lerp(alb, alb * 1.25, smoothstep(0.5, 2.0, mid) * 0.3)  # salt bloom
    rough = 0.55 + 0.2 * runs + 0.1 * mid * 0.3
    h = oilcan * 0.3 + seam * 0.4 + np.clip(src, 0, 1) * 0.3 + fine * 0.03
    save('hull', alb, normal_from_height(h, 2.5), np.stack([ao_from_height(h, 4, 2), np.clip(rough, .2, 1), np.zeros_like(h)], -1))


# ---------------------------------------------------------------------------
# Corrugated cladding (warehouse) - galvanised, painted, streaked. Tile 4 m wide.
# ---------------------------------------------------------------------------
def cladding(n=1024, seed=61):
    r = Rng(seed)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    fine = fbm(n, r, 1.3, lo=150)
    mid = fbm(n, r, 2.3, lo=3, hi=80)
    streak = np.clip(blur_dir(np.clip(fbm(n, r, 1.0, lo=30, aniso=(1, .03)), 0, None), 200, axis=0) * 0.45, 0, 1)
    vtop = 1 - ys / n
    dirt = smoothstep(0.3, 0.0, vtop)
    p = col(n, '#5d6a6c') * (0.92 + 0.08 * mid[..., None] * 0.5)
    alb = lerp(p, p * 0.6, streak)
    alb = lerp(alb, col(n, '#2f2d29'), dirt * 0.5)
    rust = smoothstep(2.2, 2.9, fbm(n, r, 1.8, lo=6, hi=200))
    alb = lerp(alb, col(n, '#5b3420'), np.clip(blur_dir(rust, 100, 0) * 0.5, 0, 1))
    rough = 0.55 + 0.25 * streak + 0.15 * dirt
    h = fine * 0.04 + mid * 0.05
    save('cladding', alb, normal_from_height(h, 2), np.stack([ao_from_height(h, 3, 2), np.clip(rough, .2, 1), np.full_like(h, 0.15)], -1))


# ---------------------------------------------------------------------------
# Weathered pallet / dunnage wood. Grain runs along U. Tile 1.2 m.
# ---------------------------------------------------------------------------
def wood(n=1024, seed=71):
    r = Rng(seed)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    grain = fbm(n, r, 1.6, lo=4, hi=400, aniso=(0.04, 1.0))
    rings = np.sin((ys / n * 70 + warp(fbm(n, r, 2.5, lo=1, hi=8), fbm(n, r, 2, lo=2, hi=10), fbm(n, r, 2, lo=2, hi=10), 10) * 3) * np.pi)
    fibre = fbm(n, r, 1.0, lo=60, aniso=(0.02, 1.0))
    knots_f1, _, _ = voronoi(n, 4, r, 0.8)
    knots = smoothstep(0.08, 0.0, knots_f1)
    plank = (ys // (n / 6)).astype(int)
    tone = r.random(7)[plank % 7]
    gap = smoothstep(3, 0, np.abs((ys % (n / 6)) - 1))
    base = lerp(col(n, '#7d6a52'), col(n, '#5d5142'), tone)
    alb = base * (0.82 + 0.12 * rings[..., None] * 0.5 + 0.08 * grain[..., None] * 0.4 + 0.05 * fibre[..., None] * 0.3)
    grey = np.array([0.42, 0.41, 0.39])
    alb = lerp(alb, grey * (0.9 + 0.1 * fibre[..., None] * 0.3), 0.45 * smoothstep(-1, 1.5, fbm(n, r, 2.5, lo=1, hi=10)))  # silvered by weather
    alb = lerp(alb, col(n, '#2e241b'), knots * 0.8)
    alb = lerp(alb, col(n, '#141210'), gap)
    h = fibre * 0.1 + grain * 0.15 + rings * 0.05 - gap * 1.0 - knots * 0.2
    rough = 0.8 + 0.1 * fibre * 0.3
    save('wood', alb, normal_from_height(h, 3), np.stack([ao_from_height(h, 2, 3), np.clip(rough, .3, 1), np.zeros_like(h)], -1))


# ---------------------------------------------------------------------------
# Rubber (fenders, tyres), cast iron (bollards), rope.
# ---------------------------------------------------------------------------
def rubber(n=512, seed=81):
    r = Rng(seed)
    fine = fbm(n, r, 1.2, lo=60)
    mid = fbm(n, r, 2.4, lo=2, hi=40)
    scuffs = lines_mask(n, r, 200, 12, 1.2) * 0.7
    alb = col(n, '#1a1a1a') * (0.9 + 0.1 * mid[..., None] * 0.5)
    alb = lerp(alb, col(n, '#4a4741'), scuffs * 0.6)
    salt = smoothstep(1.2, 2.4, mid)
    alb = lerp(alb, col(n, '#6a6862'), salt * 0.3)
    h = fine * 0.08 + mid * 0.1 - scuffs * 0.3
    save('rubber', alb, normal_from_height(h, 3), np.stack([ao_from_height(h, 2, 2), np.clip(0.78 + 0.1 * scuffs, 0, 1), np.zeros_like(h)], -1))


def castiron(n=512, seed=91):
    painted_steel('castiron', '#1c1d1e', n, seed, wear=0.35, rust_amt=0.7)


def rope(n=512, seed=101):
    r = Rng(seed)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    strands = np.sin((xs / n * 6 + ys / n * 2) * 2 * np.pi)       # 3-strand lay, helical
    fibres = np.sin((xs / n * 60 + ys / n * 160) * 2 * np.pi) * 0.3
    fuzz = fbm(n, r, 1.0, lo=40)
    h = np.abs(strands) * 0.7 + fibres * 0.15 + fuzz * 0.05
    alb = lerp(col(n, '#2c3b40'), col(n, '#6d7a72'), norm01(h))
    alb = alb * (0.85 + 0.15 * fuzz[..., None] * 0.3)
    save('rope', alb, normal_from_height(h * 6, 2), np.stack([ao_from_height(h, 3, 3), np.full_like(h, 0.85), np.zeros_like(h)], -1))


def galvanized(n=512, seed=111):
    r = Rng(seed)
    f1, f2, cid = voronoi(n, 40, r, 1.0)  # spangle
    fine = fbm(n, r, 1.3, lo=60)
    mid = fbm(n, r, 2.3, lo=2, hi=40)
    alb = lerp(col(n, '#7d8384'), col(n, '#a3a8a8'), cid * 0.6 + 0.2) * (0.92 + 0.08 * mid[..., None] * 0.5)
    whiteRust = smoothstep(1.2, 2.4, mid)
    alb = lerp(alb, col(n, '#b6b6ae'), whiteRust * 0.5)
    rough = 0.35 + 0.25 * cid + 0.3 * whiteRust
    metal = 0.85 - 0.5 * whiteRust
    h = fine * 0.03 + (f2 - f1) * 0.05
    save('galvanized', alb, normal_from_height(h, 2), np.stack([np.ones_like(h), np.clip(rough, 0, 1), metal], -1))


# ---------------------------------------------------------------------------
# Water normal map (tileable wind ripples). Tile 12 m.
# ---------------------------------------------------------------------------
def water(n=1024, seed=121):
    r = Rng(seed)
    h = fbm(n, r, 3.2, lo=3, hi=180, aniso=(1.0, 0.6)) * 0.8 + fbm(n, r, 2.0, lo=30, hi=400) * 0.2
    save('water', None, normal_from_height(h, 4.0), None)


# ---------------------------------------------------------------------------
# Weapon finishes: cerakote / anodised aluminium with edge wear; polymer.
# Applied with box/triplanar-ish UVs at ~0.3 m per tile.
# ---------------------------------------------------------------------------
def gunmetal(n=512, seed=131):
    r = Rng(seed)
    fine = fbm(n, r, 1.1, lo=100)
    mid = fbm(n, r, 2.2, lo=2, hi=40)
    scratches = lines_mask(n, r, 300, 8, 0.5) * 0.7
    alb = col(n, '#2a2c2d') * (0.92 + 0.08 * mid[..., None] * 0.5)
    alb = lerp(alb, col(n, '#8a8c8c'), scratches * 0.6)
    rough = 0.42 + 0.06 * fine * 0.3 + 0.08 * mid * 0.3 - 0.15 * scratches
    metal = 0.35 + 0.6 * scratches
    h = fine * 0.03 - scratches * 0.2
    save('gunmetal', alb, normal_from_height(h, 3), np.stack([np.ones_like(h), np.clip(rough, 0, 1), np.clip(metal, 0, 1)], -1))


def polymer(n=512, seed=141):
    r = Rng(seed)
    stipple = fbm(n, r, 0.6, lo=90)
    mid = fbm(n, r, 2.2, lo=2, hi=40)
    alb = col(n, '#232423') * (0.93 + 0.07 * mid[..., None] * 0.5)
    h = stipple * 0.25
    save('polymer', alb, normal_from_height(h, 2), np.stack([np.ones_like(h), np.full_like(h, 0.7), np.zeros_like(h)], -1))


def fabric(name, c1, n=512, seed=151):
    """Woven textile (uniform, gloves, vest cordura)."""
    r = Rng(seed)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    k = 2 * np.pi * 64 / n
    weave = np.sin(xs * k) * np.sign(np.sin(ys * k / 2)) * 0.5 + np.sin(ys * k) * np.sign(np.sin(xs * k / 2)) * 0.5
    fuzz = fbm(n, r, 1.0, lo=60)
    mid = fbm(n, r, 2.4, lo=2, hi=30)
    camo = smoothstep(-0.2, 0.4, fbm(n, r, 2.8, lo=2, hi=20))
    base = col(n, c1)
    alb = lerp(base, base * 0.85, camo * 0.3) * (0.88 + 0.06 * weave[..., None] + 0.06 * mid[..., None] * 0.4)
    h = weave * 0.3 + fuzz * 0.05
    save(name, alb, normal_from_height(h, 1.5), np.stack([ao_from_height(h, 2, 1), np.full_like(h, 0.9), np.zeros_like(h)], -1))


# ---------------------------------------------------------------------------
# Camouflage textiles. Colour references: Swedish M90 splinter pattern (player
# side) and a Russian digital-flora style pattern (opposing force). Patterns are
# generated procedurally; no reference images are copied.
# ---------------------------------------------------------------------------
def weave_and_wear(n, r, base, weave_k=72, dirt=0.25, name='fabric', tile_note=''):
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    k = 2 * np.pi * weave_k / n
    rip = (np.abs(((xs % (n / 24)) - 1)) < 1.2) | (np.abs(((ys % (n / 24)) - 1)) < 1.2)   # ripstop grid
    weave = np.sin(xs * k) * np.sign(np.sin(ys * k / 2)) * 0.5 + np.sin(ys * k) * np.sign(np.sin(xs * k / 2)) * 0.5
    fuzz = fbm(n, r, 1.0, lo=60)
    mid = fbm(n, r, 2.4, lo=2, hi=30)
    wear = smoothstep(0.8, 2.2, fbm(n, r, 2.2, lo=2, hi=60))   # faded / abraded areas
    mud = smoothstep(1.0, 2.4, fbm(n, r, 2.6, lo=2, hi=40)) * dirt
    alb = base * (0.9 + 0.05 * weave[..., None] + 0.05 * mid[..., None] * 0.4 + 0.03 * fuzz[..., None] * 0.3)
    alb = alb * (1 - 0.02 * rip[..., None])
    alb = lerp(alb, alb * 0.8 + 0.2 * np.array([0.42, 0.40, 0.33]), wear * 0.5)
    alb = lerp(alb, col(n, '#3b3226'), mud)
    h = weave * 0.3 + fuzz * 0.05 + rip * 0.08
    rough = 0.88 - 0.1 * mud
    save(name, alb, normal_from_height(h, 1.6), np.stack([ao_from_height(h, 2, 1), np.clip(rough, 0, 1), np.zeros_like(h)], -1))


def camo_m90(n=1024, seed=181):
    """Angular 'splinter' pattern: light olive ground with mid green, dark green and black shards."""
    r = Rng(seed)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    colors = [srgb('#7b7a55'), srgb('#56653a'), srgb('#36432a'), srgb('#1f211b')]
    out = np.broadcast_to(colors[0], (n, n, 3)).copy()
    # random convex polygons with straight edges and sharp angles, wrapped for tiling
    for layer, (count, size) in enumerate([(26, 190), (22, 160), (20, 120)]):
        c = colors[layer + 1]
        for _ in range(count):
            cx, cy = r.random() * n, r.random() * n
            k = r.integers(4, 6)
            ang = np.sort(r.random(k) * 2 * np.pi)
            rad = size * (0.75 + r.random(k) * 0.4)
            stretch = 0.6 + r.random() * 0.9
            rot = r.random() * np.pi
            px = cx + np.cos(ang + rot) * rad * stretch
            py = cy + np.sin(ang + rot) * rad / stretch
            for ox in (-n, 0, n):
                for oy in (-n, 0, n):
                    qx, qy = px + ox, py + oy
                    if qx.max() < 0 or qx.min() > n or qy.max() < 0 or qy.min() > n:
                        continue
                    inside = np.ones((n, n), bool)
                    for i in range(k):
                        x0, y0, x1, y1 = qx[i], qy[i], qx[(i + 1) % k], qy[(i + 1) % k]
                        inside &= ((x1 - x0) * (ys - y0) - (y1 - y0) * (xs - x0)) >= 0
                    out[inside] = c
    weave_and_wear(n, r, out, name='camo_m90', dirt=0.3)


def camo_emr(n=1024, seed=191):
    """Digital (pixelated) flora pattern: light grey-green ground, olive, brown and black pixel clusters."""
    r = Rng(seed)
    colors = [srgb('#878b6a'), srgb('#5c6542'), srgb('#57483a'), srgb('#25261f')]
    px = 8  # pixel size in texels (~6 mm at 0.4 m tile); must divide n for tiling
    m = n // px
    base = np.broadcast_to(colors[0], (n, n, 3)).copy()
    for layer, (thr, beta) in enumerate([(0.2, 2.4), (0.95, 2.6), (1.35, 2.8)]):
        f = fbm(m, r, beta, lo=1.5, hi=m / 2.5)
        mask = np.kron((f > thr).astype(np.float32), np.ones((px, px)))[:n, :n] > 0.5
        base[mask] = colors[layer + 1]
    weave_and_wear(n, r, base, name='camo_emr', dirt=0.35)


def plain_fabric(name, hexcol, n=512, seed=201, dirt=0.2):
    r = Rng(seed)
    weave_and_wear(n, r, np.broadcast_to(srgb(hexcol), (n, n, 3)).copy(), name=name, dirt=dirt)


# ---------------------------------------------------------------------------
# Rifle furniture: AK wood (laminated birch, reddish lacquer) and plum polymer.
# ---------------------------------------------------------------------------
def ak_wood(n=512, seed=211):
    r = Rng(seed)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    grain = fbm(n, r, 1.8, lo=3, hi=300, aniso=(0.05, 1.0))
    lam = np.sin((ys / n * 40 + grain * 0.6) * np.pi)  # laminate layers
    alb = lerp(col(n, '#6b2f17'), col(n, '#8a4422'), np.clip(lam * 0.5 + 0.5, 0, 1)) * (0.9 + 0.1 * grain[..., None] * 0.3)
    dings = lines_mask(n, r, 160, 10, 0.5)
    alb = lerp(alb, col(n, '#c08a5a'), dings * 0.6)
    h = grain * 0.05 - dings * 0.3
    save('ak_wood', alb, normal_from_height(h, 2), np.stack([np.ones_like(h), np.clip(0.38 + 0.3 * dings, 0, 1), np.zeros_like(h)], -1))


def plum_polymer(n=256, seed=221):
    r = Rng(seed)
    st = fbm(n, r, 0.8, lo=40)
    alb = col(n, '#3a2622') * (0.92 + 0.08 * fbm(n, r, 2, lo=2, hi=20)[..., None] * 0.4)
    save('plum_polymer', alb, normal_from_height(st * 0.2, 1.5), np.stack([np.ones_like(st), np.full_like(st, 0.6), np.zeros_like(st)], -1))


# ---------------------------------------------------------------------------
# Worn painted road marking (alpha in albedo luminance used as mask).
# ---------------------------------------------------------------------------
def marking(n=512, seed=161):
    r = Rng(seed)
    wear = smoothstep(-0.6, 0.6, fbm(n, r, 1.6, lo=3, hi=200)) * smoothstep(-1.2, 0.2, fbm(n, r, 1.0, lo=80))
    img = np.stack([wear] * 3, -1)
    save('marking', img, None, None)


# ---------------------------------------------------------------------------
# Puddle / wetness mask at world scale (tile 48 m). Single channel stored in albedo.
# ---------------------------------------------------------------------------
def puddles(n=512, seed=171):
    r = Rng(seed)
    p = fbm(n, r, 3.0, lo=1.5, hi=40)
    p = warp(p, fbm(n, r, 2, lo=2, hi=20), fbm(n, r, 2, lo=2, hi=20), 12)
    p = norm01(p)
    save('puddles', np.stack([p] * 3, -1), None, None)


SETS = {
    'asphalt': asphalt, 'concrete': concrete, 'hull': hull, 'cladding': cladding, 'wood': wood,
    'rubber': rubber, 'castiron': castiron, 'rope': rope, 'galvanized': galvanized, 'water': water,
    'gunmetal': gunmetal, 'polymer': polymer, 'marking': marking, 'puddles': puddles,
    'container_rust': lambda: container('container_rust', '#7c3420', seed=31, fade=0.1),
    'container_blue': lambda: container('container_blue', '#1f4d6b', seed=32, fade=0.15),
    'container_green': lambda: container('container_green', '#3c5a45', seed=33, fade=0.1),
    'container_grey': lambda: container('container_grey', '#8a8d8b', seed=34, fade=0.0),
    'container_orange': lambda: container('container_orange', '#b4561f', seed=35, fade=0.2),
    'container_white': lambda: container('container_white', '#c4c5be', seed=36, fade=0.0),
    'crane_yellow': lambda: painted_steel('crane_yellow', '#c18f22', seed=42, wear=0.6, rust_amt=0.6),
    'steel_dark': lambda: painted_steel('steel_dark', '#3b4246', seed=43, wear=0.5, rust_amt=0.6),
    'steel_red': lambda: painted_steel('steel_red', '#7a2420', seed=44, wear=0.4, rust_amt=0.4),
    'fabric_uniform': lambda: fabric('fabric_uniform', '#3d4540', seed=151),
    'fabric_vest': lambda: fabric('fabric_vest', '#2a2f2c', seed=152),
    'fabric_glove': lambda: fabric('fabric_glove', '#3a3632', seed=153),
    'camo_m90': camo_m90, 'camo_emr': camo_emr,
    'olive_knit': lambda: plain_fabric('olive_knit', '#4d4a33', seed=202),      # balaclava (player side)
    'glove_green': lambda: plain_fabric('glove_green', '#46502f', seed=203),     # gloves (player side)
    'khaki_webbing': lambda: plain_fabric('khaki_webbing', '#8a7c58', seed=204), # sling / belt
    'ratnik_green': lambda: plain_fabric('ratnik_green', '#4c5236', seed=205),   # OPFOR vest / helmet cover
    'boot_leather': lambda: plain_fabric('boot_leather', '#4a3b2a', seed=206, dirt=0.5),
    'ak_wood': ak_wood, 'plum_polymer': plum_polymer,
}

if __name__ == '__main__':
    names = sys.argv[1:] or list(SETS)
    for nm in names:
        print(nm)
        SETS[nm]()
