"""Ground materials: yard asphalt, quay concrete and the world-scale yard mask.

Physical scale is explicit: every function knows its tile size in metres, so
the aggregate/broom detail has real-world dimensions and the normal maps are
computed from height in metres (normal_from_height_m), not from an arbitrary
"strength" factor.
"""
import numpy as np

from noise import (Rng, fbm, blur, warp, smoothstep, scatter, random_walk,
                   polyline_dist, box_sdf, blobs, normal_from_height_m, norm01)


def _srgb(c):
    return np.array([int(c[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255.0


def _pal(colors, idx, rng, weights=None):
    """Per-feature colour lookup: idx int array -> (n,n,3) colours."""
    pal = np.stack([_srgb(c) for c in colors])
    k = idx.max() + 1
    choice = rng.choice(len(colors), size=k, p=weights)
    tint = rng.uniform(0.85, 1.12, k).astype(np.float32)
    return pal[choice][idx] * tint[idx][..., None]


def _lerp(a, b, t):
    if np.ndim(t) == 2 and (np.ndim(a) in (1, 3) or np.ndim(b) in (1, 3)):
        t = t[..., None]
    return a + (b - a) * t


# ---------------------------------------------------------------------------
# Yard asphalt. Tile = 4 m at 2048 px -> 1.95 mm per texel.
# Dense-graded asphalt concrete, 0-16 mm granite/gneiss aggregate, aged and
# worn: binder film oxidised grey, coarse stones exposed where traffic has
# stripped the binder, a few lost stones (ravelling), hairline cracks, small
# oil drips. Large distinctive features (repairs, sealed cracks, big stains,
# ghost markings) live in the world-scale yard mask instead so they do not
# repeat every 4 m.
# ---------------------------------------------------------------------------
def asphalt(save, n=2048, seed=11):
    r = Rng(seed)
    px = 4.0 / n
    mm = 1e-3
    wn = (fbm(n, r, 2.0, lo=60, hi=500), fbm(n, r, 2.0, lo=60, hi=500))
    # exposure of aggregate (0 binder-rich, 1 stripped/worn), several scales
    expo = 0.25 + 0.6 * smoothstep(-1.8, 1.8, fbm(n, r, 2.3, lo=2, hi=60) * 0.8 + fbm(n, r, 1.8, lo=20, hi=200) * 0.4)
    # aggregate: coarse 8-16 mm, medium 4-8 mm, grit 2-4 mm
    gC, gM, gG = 256, 512, 1024
    dC, iC = scatter(n, gC, r, rad=(0.32, 0.55), pnorm=(1.4, 3.2), aniso=(0.65, 1.0), jitter=0.85,
                     warp_amp=0.12, warp_noise=wn)
    dM, iM = scatter(n, gM, r, rad=(0.30, 0.52), pnorm=(1.5, 3.0), aniso=(0.7, 1.0), jitter=0.9,
                     warp_amp=0.2, warp_noise=wn)
    dG, iG = scatter(n, gG, r, rad=(0.25, 0.55), pnorm=(1.6, 2.6), aniso=(0.75, 1.0), jitter=0.95)
    kC, kM, kG = gC * gC, gM * gM, gG * gG
    ampC = r.uniform(1.4, 2.8, kC)[iC] * mm
    ampM = r.uniform(0.7, 1.5, kM)[iM] * mm
    ampG = r.uniform(0.3, 0.7, kG)[iG] * mm
    presentC = (r.random(kC) < 0.85)[iC]
    presentM = (r.random(kM) < 0.8)[iM]
    presentG = (r.random(kG) < 0.7)[iG]

    def dome(d, a, present, flat):
        h = np.where(d < 1, np.sqrt(np.clip(1 - d * d, 0, 1)), 0) * a
        return np.minimum(h, a * flat) * present
    flat = 1.0 - 0.35 * expo           # traffic planes the tops of exposed stones
    hC = dome(dC, ampC, presentC, flat)
    hM = dome(dM, ampM, presentM, 1.0 - 0.2 * expo)
    hG = dome(dG, ampG, presentG, 1.0)
    # binder level: thick film on fresh areas, eroded in worn areas; fine sand texture
    sand = fbm(n, r, 0.9, lo=300)
    L = (0.95 - 0.7 * expo) * mm + sand * 0.08 * mm + fbm(n, r, 1.6, lo=40, hi=400) * 0.15 * mm
    # ravelling: some coarse stones lost entirely in worn areas -> pits
    lostC = (r.random(kC) < 0.05)[iC] & (expo > 0.45)
    pit = np.where(lostC & (dC < 0.9), np.clip(1 - dC / 0.9, 0, 1) ** 0.5, 0) * 1.6 * mm
    stone = np.maximum(np.maximum(hC, hM), hG)
    micro = np.maximum(stone, L) - pit
    # which stone is visible on top
    visC = (hC > L) & (hC >= hM) & (hC >= hG) & ~lostC
    visM = (hM > L) & (hM > hC) & (hM >= hG)
    visG = (hG > L) & (hG > hC) & (hG > hM)
    # mid/macro undulation (drives puddle shoreline at tile scale), +-3 mm
    und = fbm(n, r, 2.6, lo=1, hi=24)
    und = und / np.abs(und).max()
    h = micro + und * 3.0 * mm

    # --- albedo
    stone_cols = ['#5c5a57', '#77736e', '#8b857e', '#6b5d55', '#4a4846', '#a39e97', '#3a3938', '#7f6f62', '#656a6c']
    weights = np.array([0.17, 0.17, 0.12, 0.12, 0.12, 0.05, 0.1, 0.08, 0.07]); weights /= weights.sum()
    cC = _pal(stone_cols, iC, r, weights)
    cM = _pal(stone_cols, iM, r, weights)
    cG = _pal(stone_cols, iG, r, weights)
    grain = fbm(n, r, 1.0, lo=250)
    binder = _srgb('#2b2b2a') * (0.86 + 0.18 * smoothstep(-1.5, 1.5, fbm(n, r, 2.2, lo=3, hi=120)))[..., None]
    binder = binder * (1 + 0.12 * expo)[..., None]                    # oxidised/greyed where worn
    fines = smoothstep(1.2, 2.4, fbm(n, r, 0.4, lo=400)) * 0.5         # sand grains in the mastic
    binder = _lerp(binder, _srgb('#5a5853'), fines)
    alb = binder.copy()
    for vis, c, d in ((visG, cG, dG), (visM, cM, dM), (visC, cC, dC)):
        coat = np.clip(0.4 - 0.35 * expo + 0.3 * d * d, 0, 0.85)        # binder residue, more at stone edges
        sc = c * (0.9 + 0.1 * grain[..., None])
        sc = _lerp(sc, binder, coat)
        alb = np.where(vis[..., None], sc, alb)
    alb = np.where((pit > 0.2 * mm)[..., None], alb * 0.45, alb)
    # tonal macro variation inside the tile (kept mild; world-scale tone comes from the yard mask)
    alb = alb * (0.93 + 0.1 * smoothstep(-1.5, 1.5, fbm(n, r, 2.6, lo=1, hi=10)))[..., None]

    # hairline cracks (unsealed), 2 per tile, branching
    polys = []
    for _ in range(2):
        pts = random_walk(r, r.random() * n, r.random() * n, r.random() * 2 * np.pi, 70, 9, 0.35, n)
        polys.append(pts)
        for _ in range(2):
            k = r.integers(10, 60)
            x, y = pts[k]
            polys.append(random_walk(r, x, y, r.random() * 2 * np.pi, r.integers(8, 25), 7, 0.45, n))
    cd = polyline_dist(n, polys, 6)
    cd = warp(cd, wn[0], wn[1], 1.5)
    crack = smoothstep(1.3, 0.3, cd)
    crack_edge = smoothstep(4.0, 1.0, cd)
    h -= crack * 2.5 * mm
    alb = _lerp(alb, alb * 0.55, crack_edge * 0.5)
    alb = _lerp(alb, np.array([0.03, 0.03, 0.03]), crack)

    # small oil drips / tyre rubber smudges (few, soft)
    ywn = fbm(n, r, 2.0, lo=8, hi=200)
    oil = blobs(n, r, 6, 12, 40, 0.5, ywn) * smoothstep(-0.5, 1.0, fbm(n, r, 1.5, lo=10, hi=200))
    oil = blur(oil, 2.0)
    alb = _lerp(alb, alb * 0.5, np.clip(oil, 0, 1) * 0.8)

    # --- roughness: oxidised binder 0.86, exposed stone 0.62 (polished tops 0.5), oil 0.4
    vis_any = (visC | visM | visG).astype(np.float32)
    rough = 0.86 - 0.05 * expo + 0.03 * sand
    rough = _lerp(rough, 0.66 - 0.14 * expo, vis_any)
    rough = _lerp(rough, 0.42, np.clip(oil, 0, 1) * 0.8)
    rough = _lerp(rough, 0.95, crack)
    # --- AO: cavities between stones and in pits/cracks
    cav = micro - blur(micro, 3.0)
    ao = np.clip(1 + cav / (1.2 * mm) * 0.35, 0.35, 1) * (1 - 0.5 * crack)
    # --- height channel for puddle shorelines: undulation dominates
    hb = 0.5 + 0.42 * und + (micro - L) / mm * 0.04 - crack * 0.15
    nrm = normal_from_height_m(h, px)
    save('asphalt', alb, nrm, np.stack([ao, np.clip(rough, 0.3, 1), np.clip(hb, 0, 1)], -1))


# ---------------------------------------------------------------------------
# World-scale yard mask, 64 m x 64 m at 2048 px (3.1 cm per texel), lossless.
#   R: signed distance to repair patches (0.5 = patch edge, >0.5 inside), +-12.5 cm
#   G: tone (0.5 neutral). <0.5 darker & glossier (fresh patch, oil, tyre rubber,
#      polished wheel path), >0.5 lighter & rougher (aged patch, ghosted paint)
#   B: signed distance to bitumen crack-seal / patch-edge sealant bands (0.5 = band edge)
# Sampled in materials.js at worldXZ / 64 for the 'asphalt' set only.
# ---------------------------------------------------------------------------
def yardmask(save_raw, n=2048, seed=171):
    r = Rng(seed)
    W = 64.0
    pxm = W / n                      # metres per texel
    P = lambda m: m / pxm            # metres -> pixels
    patch_sdf = np.full((n, n), 1e9, np.float32)
    tone_in = np.full((n, n), 0.5, np.float32)
    sealed_edges = []
    # repair patches: rectangles (axis aligned with the yard grid, sometimes slightly skewed),
    # L-shapes and long utility trenches
    specs = []
    for _ in range(16):
        specs.append(('rect', r.uniform(0.8, 4.5), r.uniform(0.6, 3.0)))
    for _ in range(4):
        specs.append(('trench', r.uniform(0.5, 0.9), r.uniform(6, 22)))
    for _ in range(3):
        specs.append(('L', r.uniform(2, 5), r.uniform(1.5, 3.5)))
    for kind, a, b in specs:
        cx, cy = r.random() * n, r.random() * n
        ang = r.choice([0.0, np.pi / 2]) + r.normal() * 0.02
        if kind == 'trench' and r.random() < 0.5:
            a, b = b, a
        sd = box_sdf(n, cx, cy, P(a) / 2, P(b) / 2, ang)
        if kind == 'L':
            sd2 = box_sdf(n, cx + P(a) * 0.35, cy + P(b) * 0.6, P(a) * 0.3, P(b) * 0.5, ang)
            sd = np.minimum(sd, sd2)
        tone = r.choice([r.uniform(0.22, 0.38), r.uniform(0.56, 0.68), r.uniform(0.42, 0.5)], p=[0.45, 0.35, 0.2])
        closer = sd < patch_sdf
        # tone fills the patch and a small margin outside so bilinear edges stay clean
        tone_in = np.where((sd < P(0.15)) & closer, tone, tone_in)
        patch_sdf = np.minimum(patch_sdf, sd)
        if r.random() < 0.55:
            sealed_edges.append(sd)
    # sealant along patch perimeters (overband ~6-9 cm wide), slightly wobbly
    wob = fbm(n, r, 2.0, lo=20, hi=400)
    seal_d = np.full((n, n), 1e9, np.float32)
    for sd in sealed_edges:
        seal_d = np.minimum(seal_d, np.abs(sd + wob * 0.6) - P(r.uniform(0.03, 0.045)))
    # sealed cracks: meandering longitudinal/transverse and block cracks, overband 5-10 cm
    polys = []
    for _ in range(14):
        ang = r.choice([0, np.pi / 2, np.pi, -np.pi / 2]) + r.normal() * 0.25
        pts = random_walk(r, r.random() * n, r.random() * n, ang, int(r.integers(20, 90)), P(0.25), 0.18, n)
        polys.append(pts)
        if r.random() < 0.6:
            k = int(r.integers(3, len(pts) - 1))
            x, y = pts[k]
            polys.append(random_walk(r, x, y, ang + r.choice([-1, 1]) * np.pi / 2, int(r.integers(6, 30)), P(0.2), 0.3, n))
    cd = polyline_dist(n, polys, P(0.4))
    halfw = P(0.035) + np.clip(fbm(n, r, 1.5, lo=4, hi=80), -1, 1) * P(0.012)
    cd = warp(cd, wob, fbm(n, r, 2.0, lo=20, hi=400), 1.5)
    seal_d = np.minimum(seal_d, cd - halfw)
    # tone outside patches
    out_tone = 0.5 + 0.05 * fbm(n, r, 2.4, lo=1, hi=30)
    # polished / rubber-darkened wheel paths: longitudinal bands along world Z (image v)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    wp = np.zeros((n, n), np.float32)
    for _ in range(5):
        x0 = r.random() * n
        meander = fbm(n, r, 3.0, lo=1, hi=4)[:, 0] * P(0.6)
        for off in (0, P(r.uniform(1.8, 2.1))):
            d = np.abs(((xs - x0 - off - meander[:, None]) + n / 2) % n - n / 2)
            wp = np.maximum(wp, smoothstep(P(0.45), P(0.1), d) * r.uniform(0.4, 1.0))
    wp *= smoothstep(-0.8, 0.8, fbm(n, r, 1.8, lo=1, hi=12))
    out_tone -= wp * 0.06
    # big oil / hydraulic stains under parked machines, with drip satellites
    stn = blobs(n, r, 22, P(0.25), P(1.3), 0.45, fbm(n, r, 2.2, lo=6, hi=200))
    stn = np.maximum(stn, blobs(n, r, 160, P(0.03), P(0.12), 0.5, fbm(n, r, 2.0, lo=30, hi=400)) * 0.8)
    stn *= smoothstep(-1.0, 0.6, fbm(n, r, 1.6, lo=6, hi=300))
    out_tone -= np.clip(stn, 0, 1) * 0.26
    # tyre skid / turning marks: dark arcs 0.25 m wide
    tm = np.full((n, n), 1e9, np.float32)
    for _ in range(10):
        cx, cy = r.random() * n, r.random() * n
        R = P(r.uniform(4, 12)); a0 = r.random() * 2 * np.pi; span = r.uniform(0.3, 0.9)
        th = np.linspace(a0, a0 + span, 40)
        for off in (0, P(r.uniform(1.8, 2.4))):
            pts = [(cx + (R + off) * np.cos(t), cy + (R + off) * np.sin(t)) for t in th]
            tm = np.minimum(tm, polyline_dist(n, [pts], P(0.3)))
    tyre = smoothstep(P(0.14), P(0.05), tm) * smoothstep(-0.8, 1.0, fbm(n, r, 1.4, lo=8, hi=300))
    out_tone -= tyre * 0.12
    # ghosted (ground-off / faded) old markings: lighter, rougher lines and arrows
    ghost = np.full((n, n), 1e9, np.float32)
    for _ in range(6):
        x0, y0 = r.random() * n, r.random() * n
        vert = r.random() < 0.6
        Lm = P(r.uniform(4, 18))
        pts = [(x0, y0), (x0, y0 + Lm)] if vert else [(x0, y0), (x0 + Lm, y0)]
        ghost = np.minimum(ghost, polyline_dist(n, [pts], P(0.3)))
    for _ in range(3):   # old bay grid: short transverse lines at 2.5 m spacing
        x0, y0 = r.random() * n, r.random() * n
        for k in range(6):
            ghost = np.minimum(ghost, polyline_dist(n, [[(x0 + k * P(2.5), y0), (x0 + k * P(2.5), y0 + P(5))]], P(0.3)))
    gl = smoothstep(P(0.08), P(0.05), ghost) * smoothstep(-1.2, 0.6, fbm(n, r, 1.2, lo=10, hi=600))
    out_tone += gl * 0.1
    tone = np.where(patch_sdf < P(0.15), tone_in + (out_tone - 0.5) * 0.4, out_tone)
    tone = blur(tone, 0.7)
    R_ = np.clip(0.5 - patch_sdf / P(0.25), 0, 1)
    B_ = np.clip(0.5 - seal_d / P(0.25), 0, 1)
    img = np.stack([R_, np.clip(tone, 0, 1), B_], -1)
    save_raw('yardmask', img)


# ---------------------------------------------------------------------------
# Quay concrete. Tile = 3 m at 1024 px (2.9 mm/texel). One cast slab per tile
# with tooled/saw-cut joints at the border, transverse broom finish, exposed
# fine aggregate where worn, aggregate pop-outs, hairline shrinkage cracks,
# efflorescence along joints/cracks, rust stains, tyre marks.
# ---------------------------------------------------------------------------
def concrete(save, n=1024, seed=21):
    r = Rng(seed)
    px = 3.0 / n
    mm = 1e-3
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    wn = (fbm(n, r, 2.0, lo=6, hi=200), fbm(n, r, 2.0, lo=6, hi=200))
    wear = smoothstep(-1.2, 1.8, fbm(n, r, 2.4, lo=1.5, hi=40))
    # broom finish: transverse grooves ~3-5 mm pitch, smeared, worn off in traffic areas
    br = fbm(n, r, 1.0, lo=60, hi=420, aniso=(0.03, 1.0))
    br = warp(br, wn[0], wn[1], 6)
    broom = br * (1 - 0.8 * wear) * smoothstep(-1.5, 0.5, fbm(n, r, 1.5, lo=3, hi=40))
    # fine aggregate exposed where paste is worn away
    dA, iA = scatter(n, 340, r, rad=(0.25, 0.5), pnorm=(1.6, 2.8), aniso=(0.7, 1.0), warp_amp=0.15, warp_noise=wn)
    kA = 340 * 340
    agg_present = (r.random(kA) < 0.5)[iA]
    agg = np.where((dA < 1) & agg_present, np.sqrt(np.clip(1 - dA * dA, 0, 1)), 0) * wear
    # pop-outs: conical pits 6-20 mm
    dP, iP = scatter(n, 48, r, rad=(0.05, 0.12), pnorm=(1.8, 2.4), aniso=(0.7, 1.0))
    popk = (r.random(48 * 48) < 0.3)[iP]
    pop = np.where((dP < 1) & popk, 1 - dP, 0) ** 0.7
    # bug holes / pores
    dB, iB = scatter(n, 160, r, rad=(0.05, 0.15), pnorm=(2, 2))
    pores = np.where((dB < 1) & (r.random(160 * 160) < 0.35)[iB], 1 - dB, 0)
    # joints at the tile border (sawcut 5 mm + chipped arris)
    dj = np.minimum(np.minimum(xs, n - 1 - xs), np.minimum(ys, n - 1 - ys)) + 0.5
    jw = 1.8 + 1.5 * smoothstep(0.8, 2.0, fbm(n, r, 1.6, lo=6, hi=120))   # spalled where noisy
    joint = smoothstep(jw + 0.8, jw - 0.4, dj)
    spall = smoothstep(9, 2, dj) * smoothstep(1.2, 2.2, fbm(n, r, 1.8, lo=8, hi=160))
    # hairline shrinkage cracks
    polys = []
    for _ in range(3):
        polys.append(random_walk(r, r.random() * n, r.random() * n, r.random() * 2 * np.pi, 60, 6, 0.3, n))
    cd = polyline_dist(n, polys, 20)
    crack = smoothstep(1.2, 0.2, cd)
    # height (m)
    h = (fbm(n, r, 2.4, lo=1, hi=20) * 1.5 * mm + broom * 0.35 * mm + agg * 0.6 * mm
         - pop * 3 * mm - pores * 1.0 * mm - joint * 6 * mm - spall * 2.5 * mm - crack * 1.2 * mm
         + fbm(n, r, 1.2, lo=200) * 0.06 * mm)
    # albedo
    base = _srgb('#8e8b84')
    tone = fbm(n, r, 2.6, lo=1, hi=16)
    alb = base * (0.9 + 0.08 * tone + 0.03 * fbm(n, r, 1.0, lo=200))[..., None]
    alb = alb * np.array([1.0, 1.0, 1.0]) * (1 + 0.02 * fbm(n, r, 2.0, lo=2, hi=20))[..., None]
    agg_col = _pal(['#9a968e', '#6e6b66', '#b3aea5', '#7d7268', '#55534f'], iA, r)
    alb = _lerp(alb, agg_col, np.clip(agg * 1.4, 0, 1) * 0.4)
    # traffic grime + darker worn paths
    grime = smoothstep(-0.3, 1.8, fbm(n, r, 2.0, lo=3, hi=80)) * 0.25 + wear * 0.08
    alb = _lerp(alb, alb * 0.68, grime)
    # efflorescence: chalky white crust along joints and cracks
    eff_src = np.maximum(smoothstep(30, 3, dj), smoothstep(14, 1, cd))
    eff = eff_src * smoothstep(0.4, 1.8, fbm(n, r, 1.8, lo=6, hi=200))
    alb = _lerp(alb, _srgb('#c9c7c0'), np.clip(eff, 0, 1) * 0.6)
    # rust stains (from steel fittings / scrap): bloom with darker core
    rs = blobs(n, r, 4, 15, 55, 0.6, fbm(n, r, 2.0, lo=10, hi=300))
    rs = blur(rs, 3) * smoothstep(-1.0, 1.0, fbm(n, r, 1.4, lo=10, hi=300))
    alb = _lerp(alb, _srgb('#8a5a3a'), np.clip(rs, 0, 1) * 0.55)
    alb = _lerp(alb, _srgb('#5e3520'), smoothstep(0.55, 0.95, rs) * 0.5)
    # tyre marks: curved dark rubber smears
    tm = np.full((n, n), 1e9, np.float32)
    for _ in range(3):
        cx, cy = r.random() * n, r.random() * n
        R = r.uniform(400, 1400); a0 = r.random() * 2 * np.pi
        th = np.linspace(a0, a0 + r.uniform(0.3, 0.8), 40)
        pts = [(cx + R * np.cos(t), cy + R * np.sin(t)) for t in th]
        tm = np.minimum(tm, polyline_dist(n, [pts], 60))
    tyre = smoothstep(55, 25, tm) * smoothstep(-0.5, 1.2, fbm(n, r, 1.2, lo=8, hi=300)) * smoothstep(-1, 1, br)
    alb = _lerp(alb, alb * 0.55, np.clip(tyre, 0, 1) * 0.45)
    # cavities dark (water-filled dirt)
    alb = _lerp(alb, _srgb('#3a3835'), np.clip(np.maximum(pop, pores * 0.8), 0, 1) * 0.8)
    alb = _lerp(alb, _srgb('#2a2826'), np.maximum(joint, crack * 0.8))
    alb = _lerp(alb, alb * 0.75, spall * 0.6)
    rough = 0.9 - 0.08 * wear - 0.12 * tyre + 0.05 * eff - 0.05 * agg - 0.1 * rs * 0.5
    cav = h - blur(h, 3.0)
    ao = np.clip(1 + cav / (2 * mm) * 0.4, 0.3, 1)
    hb = 0.5 + 0.35 * fbm(n, r, 2.8, lo=1, hi=8) * 0.5 + (h - blur(h, 40)) / mm * 0.03 - joint * 0.3
    save('concrete', alb, normal_from_height_m(h, px), np.stack([ao, np.clip(rough, 0.3, 1), np.clip(hb, 0, 1)], -1))
