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
import ground
import paint as paint_mod
import textiles

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
# Ground sets live in ground.py (physically scaled asphalt/concrete + yard mask).
# ---------------------------------------------------------------------------
def save_lossless(name, img):
    """Lossless RGB mask (no 4:2:0 chroma subsampling, channels stay independent)."""
    arr = np.clip(img, 0, 1)
    im = Image.fromarray((arr * 255 + 0.5).astype(np.uint8))
    p = os.path.join(OUT, f'{name}_albedo.webp')
    im.save(p, 'WEBP', lossless=True, quality=100, method=6)
    print('  wrote', os.path.relpath(p), f'{os.path.getsize(p) // 1024} KB')


def asphalt():
    ground.asphalt(save)


def concrete():
    ground.concrete(save)


def yardmask():
    ground.yardmask(save_lossless)


# ---------------------------------------------------------------------------
# Painted / coated steel lives in paint.py.
# ---------------------------------------------------------------------------
def container(name, paint, n=1024, seed=31, fade=0.0):
    paint_mod.container(save, name, paint, n, seed, fade)


def painted_steel(name, paint, n=1024, seed=41, wear=0.5, rust_amt=0.5, tile=2.0, primer='#7a3b26'):
    paint_mod.painted_steel(save, name, paint, n, seed, wear, rust_amt, tile, primer)


def hull():
    paint_mod.hull(save)


def cladding():
    paint_mod.cladding(save)


def galvanized():
    paint_mod.galvanized(save)


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
    weather = smoothstep(-1, 1.5, fbm(n, r, 2.5, lo=1, hi=10))
    grime = smoothstep(0.5, 2.0, fbm(n, r, 2.4, lo=2, hi=30))
    alb = lerp(alb, alb * 0.55, grime * 0.5)
    rough = 0.72 + 0.12 * weather + 0.05 * fibre * 0.3 + 0.06 * grime - 0.1 * knots
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
    polish = smoothstep(0.0, 1.8, fbm(n, r, 2.2, lo=2, hi=20))          # rubbed by the hull: smoother, darker
    alb = lerp(alb, alb * 0.75, polish * 0.6)
    green = smoothstep(1.4, 2.6, fbm(n, r, 2.6, lo=2, hi=30))           # marine growth / algae film
    alb = lerp(alb, col(n, '#2d3322'), green * 0.5)
    h = fine * 0.08 + mid * 0.1 - scuffs * 0.3
    rough = 0.82 + 0.08 * scuffs + 0.08 * salt - 0.25 * polish - 0.1 * green + 0.03 * fine * 0.3
    save('rubber', alb, normal_from_height(h, 3), np.stack([ao_from_height(h, 2, 2), np.clip(rough, 0, 1), np.zeros_like(h)], -1))


def castiron():
    painted_steel('castiron', '#1c1d1e', 512, 91, wear=0.45, rust_amt=0.8, tile=1.0, primer='#55534e')


def rope(n=512, seed=101):
    r = Rng(seed)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    strands = np.sin((xs / n * 6 + ys / n * 2) * 2 * np.pi)       # 3-strand lay, helical
    fibres = np.sin((xs / n * 60 + ys / n * 160) * 2 * np.pi) * 0.3
    fuzz = fbm(n, r, 1.0, lo=40)
    h = np.abs(strands) * 0.7 + fibres * 0.15 + fuzz * 0.05
    alb = lerp(col(n, '#2c3b40'), col(n, '#6d7a72'), norm01(h))
    alb = alb * (0.85 + 0.15 * fuzz[..., None] * 0.3)
    dirt = smoothstep(0.3, 2.0, fbm(n, r, 2.4, lo=1, hi=12))
    alb = lerp(alb, alb * 0.6 + col(n, '#3b3528') * 0.2, dirt * 0.6)
    rough = 0.8 + 0.1 * (1 - norm01(h)) - 0.08 * dirt
    save('rope', alb, normal_from_height(h * 6, 2), np.stack([ao_from_height(h, 3, 3), np.clip(rough, 0, 1), np.zeros_like(h)], -1))


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
def camo_m90():
    textiles.camo_m90(save)


def camo_emr():
    textiles.camo_emr(save)


def plain_fabric(name, hexcol, n=512, seed=201, dirt=0.2, tile=0.3, structure='ripstop', sheen=0.0, rough_base=0.88):
    textiles.plain(save, name, hexcol, n, seed, dirt, tile, structure, sheen, rough_base)


# ---------------------------------------------------------------------------
# Rifle furniture: AK wood (laminated birch, reddish lacquer) and plum polymer.
# ---------------------------------------------------------------------------
def ak_wood(n=512, seed=211):
    """Laminated birch furniture, dark reddish-brown stain, low saturation, satin lacquer."""
    r = Rng(seed)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    grain = fbm(n, r, 1.8, lo=3, hi=300, aniso=(0.05, 1.0))
    lam = np.sin((ys / n * 14 + grain * 0.5) * np.pi)  # laminate layers (glue lines every ~2 cm)
    ring = np.sin((xs / n * 9 + 0.5 * fbm(n, r, 1.5, lo=2, hi=12)) * np.pi * 2) * 0.5 + 0.5
    alb = lerp(col(n, '#3a2419'), col(n, '#573a2b'), np.clip(lam * 0.35 + 0.5 + 0.18 * ring - 0.1, 0, 1)) * (0.92 + 0.14 * grain[..., None])
    seam = np.clip(1 - np.abs(np.sin(ys / n * 14 * np.pi * 0.5 + 0.3)) * 14, 0, 1)  # thin darker glue lines
    alb = alb * (1 - 0.25 * seam[..., None])
    dings = lines_mask(n, r, 90, 10, 0.5)
    alb = lerp(alb, col(n, '#7a5a44'), dings * 0.3)
    h = grain * 0.05 - dings * 0.3 - seam * 0.1
    save('ak_wood', alb, normal_from_height(h, 2), np.stack([np.ones_like(h) * (1 - 0.15 * seam), np.clip(0.5 + 0.2 * dings + 0.05 * grain, 0, 1), np.zeros_like(h)], -1))


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
    'gunmetal': gunmetal, 'polymer': polymer, 'marking': marking, 'puddles': puddles, 'yardmask': yardmask,
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
    'olive_knit': lambda: plain_fabric('olive_knit', '#4d4a33', seed=202, tile=0.2, structure='knit', rough_base=0.92),      # balaclava (player side)
    'glove_green': lambda: plain_fabric('glove_green', '#46502f', seed=203, tile=0.12, structure='cordura', rough_base=0.8),     # gloves (player side)
    'khaki_webbing': lambda: plain_fabric('khaki_webbing', '#8a7c58', seed=204, tile=0.15, structure='webbing', sheen=0.08), # sling / belt
    'ratnik_green': lambda: textiles.plain(textiles.cool_grade(save, 0.85, (1.0, 1.0, 0.97)), 'ratnik_green', '#474f37', 512, 205, 0.2, 0.35, 'cordura', 0.1),   # OPFOR vest / helmet cover
    'boot_leather': lambda: plain_fabric('boot_leather', '#4a3b2a', seed=206, dirt=0.5, tile=0.3, structure='leather', rough_base=0.62),
    'ak_wood': ak_wood, 'plum_polymer': plum_polymer,
}

if __name__ == '__main__':
    names = sys.argv[1:] or list(SETS)
    for nm in names:
        print(nm)
        SETS[nm]()
