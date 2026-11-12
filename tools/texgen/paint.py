"""Painted steel: ISO container sides, crane/machinery steel, cast iron, hull,
warehouse cladding and galvanised steel.

Wear is built in layers the way it happens on real steel work:
topcoat -> (repaint patches) -> primer -> bare steel -> rust, with rust
blooming *under* the paint around damage, rust and grime running downwards,
and dirt rising from the ground. Heights are in metres and normals are
physically scaled (normal_from_height_m).
"""
import numpy as np

from noise import (Rng, fbm, blur, blur_dir, warp, smoothstep, scatter, random_walk,
                   polyline_dist, box_sdf, blobs, normal_from_height_m, lines_mask, norm01)


def _srgb(c):
    return np.array([int(c[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255.0


def _lerp(a, b, t):
    if np.ndim(t) == 2 and (np.ndim(a) in (1, 3) or np.ndim(b) in (1, 3)):
        t = t[..., None]
    return a + (b - a) * t


def _lum(c):
    return (c[..., 0] * 0.3 + c[..., 1] * 0.59 + c[..., 2] * 0.11)[..., None]


def _drips(n, r, count, top_band, len_range, width_range, start_jitter=0.02):
    """Vertical runs starting near the top (image y=0), fading with length,
    occasionally with a drip head. Returns 0..1 mask (wraps horizontally)."""
    m = np.zeros((n, n), np.float32)
    for _ in range(count):
        x0 = r.random() * n
        y0 = (top_band + r.random() * start_jitter) * n
        L = int((len_range[0] + (len_range[1] - len_range[0]) * r.random() ** 2) * n)
        w = r.uniform(*width_range)
        amp = r.uniform(0.15, 1.0) ** 1.6
        ys = np.arange(int(y0), min(int(y0) + L, n))
        if len(ys) < 4:
            continue
        t = (ys - y0) / max(L, 1)
        # meander slightly, thin out and break up along the run
        xs = x0 + np.cumsum(r.normal(0, 0.08, len(ys)))
        inten = amp * (1 - t) ** r.uniform(0.6, 2.0)
        inten *= np.clip(1.2 + np.cumsum(r.normal(0, 0.06, len(ys))), 0.2, 1.4)
        wid = w * (1 - 0.6 * t) + 0.4
        x_lo = int(np.floor(xs.min() - w * 2 - 2)); x_hi = int(np.ceil(xs.max() + w * 2 + 3))
        xx = np.arange(x_lo, x_hi)
        d = np.abs(xx[None, :] - xs[:, None]) / wid[:, None]
        prof = np.clip(1 - d, 0, 1) ** 0.7 * inten[:, None]
        cols = xx % n
        sub = m[ys][:, cols]
        m[np.ix_(ys, cols)] = np.maximum(sub, prof)
        if r.random() < 0.35:   # drip head
            yh = ys[-1]; xh = xs[-1]
            yy, xxh = np.mgrid[max(yh - 6, 0):min(yh + 6, n), int(xh) - 6:int(xh) + 7]
            dd = np.sqrt(((xxh - xh) / (w * 0.9 + 0.8)) ** 2 + ((yy - yh) / (w * 1.4 + 1.0)) ** 2)
            m[np.ix_(np.arange(max(yh - 6, 0), min(yh + 6, n)), np.arange(int(xh) - 6, int(xh) + 7) % n)] = np.maximum(
                m[np.ix_(np.arange(max(yh - 6, 0), min(yh + 6, n)), np.arange(int(xh) - 6, int(xh) + 7) % n)],
                np.clip(1 - dd, 0, 1) * amp * 0.8)
    return m


def _hscratches(n, r, count, y_range, length_range, ang_sd=0.04, maxd=4):
    """Long, roughly horizontal scrape marks (forklift tines, spreader, twistlocks)."""
    polys = []
    for _ in range(count):
        y = r.uniform(*y_range) * n
        x = r.random() * n
        L = r.uniform(*length_range) * n
        steps = max(int(L / 12), 2)
        polys.append(random_walk(r, x, y, r.normal(0, ang_sd) + (np.pi if r.random() < 0.5 else 0), steps, 12, 0.01, n))
    return polyline_dist(n, polys, maxd)


# ---------------------------------------------------------------------------
# ISO container side. UV u = 3 m across, v = 2.6 m (0 bottom .. 1 top).
# Image row 0 = top of the container.
# ---------------------------------------------------------------------------
def container(save, name, paint, n=1024, seed=31, fade=0.0):
    r = Rng(seed)
    mm = 1e-3
    px = 2.8e-3
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    vtop = 1 - ys / n                       # 1 at the top rail
    hgt_m = vtop * 2.6                      # height above the bottom rail (m)
    macro = fbm(n, r, 2.8, lo=1, hi=8)
    mid = fbm(n, r, 2.2, lo=3, hi=90)
    fine = fbm(n, r, 1.2, lo=200)
    wn = (fbm(n, r, 2.0, lo=6, hi=200), fbm(n, r, 2.0, lo=6, hi=200))
    p = _srgb(paint)
    base = np.broadcast_to(p, (n, n, 3)).astype(np.float32)
    base = base * (0.95 + 0.05 * mid[..., None] * 0.6)
    # chalking: UV-degraded binder -> lighter, desaturated, rougher. Stronger towards the top
    # (more sun) and patchy where the rain washes it.
    chalk = np.clip(fade + 0.18 * smoothstep(-1.5, 1.5, macro) + 0.18 * vtop ** 1.5 * smoothstep(-1.2, 1.2, mid), 0, 1)
    chalk_col = _lum(base) * 0.55 + base * 0.45 + 0.07
    alb = _lerp(base, chalk_col, chalk)

    # repaint patches: rectangles with sharp roller edges, slightly different batch colour,
    # fresher (less chalky) and glossier; some cover old rust (no rust under them)
    patch = np.zeros((n, n), np.float32)
    ptone = np.zeros((n, n, 3), np.float32)
    psd_min = np.full((n, n), 1e9, np.float32)
    for _ in range(int(r.integers(2, 5))):
        cx, cy = r.random() * n, r.uniform(0.15, 0.85) * n
        hw, hh = r.uniform(30, 200), r.uniform(25, 160)
        sd = box_sdf(n, cx, cy, hw, hh, r.normal(0, 0.01))
        sd = sd + wn[0] * 1.5                                   # brush-edge wobble
        m = smoothstep(0.8, -0.8, sd)
        shift = np.array([r.normal(0, 0.025), r.normal(0, 0.025), r.normal(0, 0.025)], np.float32)
        col = np.clip(p * (1 + shift) * r.uniform(0.86, 1.0), 0, 1)
        ptone = np.where((m > 0)[..., None], col, ptone)
        patch = np.maximum(patch, m)
        psd_min = np.minimum(psd_min, sd)
    roller = fbm(n, r, 1.2, lo=20, hi=300) * 0.015
    alb = _lerp(alb, ptone * (1 + roller[..., None]) + _lum(ptone) * 0.0, patch)
    alb = _lerp(alb, _lum(alb) * 0.55 + alb * 0.45 + 0.07, patch * chalk * 0.5)   # patches age too, just less

    # damage: scattered scratches, horizontal scrapes low (forklift) and high (spreader),
    # gouges near the corners (twistlocks)
    scr = lines_mask(n, r, 90, 14, 0.5, wobble=0.6) * 0.7
    low = _hscratches(n, r, 12, (0.88, 0.985), (0.04, 0.22))
    high = _hscratches(n, r, 6, (0.0, 0.07), (0.03, 0.12))
    mid_s = _hscratches(n, r, 4, (0.3, 0.75), (0.03, 0.15), ang_sd=0.15)
    hs = np.minimum(np.minimum(low, high), mid_s)
    scrape = smoothstep(1.4, 0.3, hs) * smoothstep(0.0, 1.2, fbm(n, r, 1.5, lo=10, hi=400))
    scrape_halo = smoothstep(4.0, 1.0, hs) * 0.6
    damage = np.clip(np.maximum(scr, scrape), 0, 1)
    # dents (large, soft) with creased centres that lost paint
    dents = np.zeros((n, n), np.float32)
    dent_core = np.zeros((n, n), np.float32)
    for _ in range(int(r.integers(2, 6))):
        cx, cy = r.random() * n, r.uniform(0.2, 0.97) * n
        rad = r.uniform(25, 120)
        dd = np.sqrt(((xs - cx + n / 2) % n - n / 2) ** 2 / r.uniform(0.6, 1.6) + (ys - cy) ** 2) / rad
        dents += np.exp(-dd * dd * 2.5) * r.uniform(0.5, 1.0)
        dent_core = np.maximum(dent_core, smoothstep(0.35, 0.05, dd + wn[1] * 0.15) * (r.random() < 0.7))
    damage = np.maximum(damage, dent_core * smoothstep(0.0, 1.2, fbm(n, r, 1.2, lo=30, hi=500)))

    # rust: blooms under the paint around damage, rail rust at top & bottom, then runs down
    bloom_src = blur(damage, 3.0) * 3.0
    blister = np.clip(bloom_src * (0.6 + 0.6 * smoothstep(-0.5, 1.5, fbm(n, r, 1.4, lo=30, hi=400))), 0, 1)
    rail_top = smoothstep(0.035, 0.0, 1 - vtop) * smoothstep(0.2, 1.4, fbm(n, r, 1.6, lo=8, hi=300))
    rail_bot = smoothstep(0.06, 0.0, vtop) * smoothstep(-0.6, 1.0, fbm(n, r, 1.6, lo=8, hi=300))
    spots = smoothstep(2.0, 2.8, fbm(n, r, 1.6, lo=6, hi=300)) * smoothstep(0.1, 0.5, vtop)
    rust = np.clip(np.maximum.reduce([damage * smoothstep(-0.8, 0.6, fbm(n, r, 1.2, lo=20, hi=500)),
                                      rail_top, rail_bot, spots]), 0, 1)
    rust = rust * (1 - patch * 0.9)
    blister = blister * (1 - patch * 0.8)
    # runs: from top rail and from rust spots, with drips of grime/rust-water
    top_runs = _drips(n, r, 140, 0.0, (0.02, 0.7), (0.8, 7.0), 0.05)
    top_runs = blur(top_runs, 0.8)
    rust_runs = np.clip(blur_dir(np.maximum(rust, blister * 0.4), 90, axis=0) * 0.9, 0, 1)
    rust_runs *= smoothstep(-1.2, 1.0, fbm(n, r, 1.0, lo=30, aniso=(1.0, 0.04)))
    grime_runs = np.clip(blur_dir(np.clip(fbm(n, r, 1.0, lo=24, aniso=(1, 0.02)), 0, None), 120, axis=0) * 0.35, 0, 1)
    grime_runs *= smoothstep(0.0, 0.6, vtop)

    # bottom dirt: road spray rising from the ground, speckled, thinning upwards
    spray = smoothstep(0.9, 0.0, hgt_m) ** 1.2 * (0.55 + 0.45 * smoothstep(-1, 1, fbm(n, r, 1.6, lo=20, hi=300)))
    speck = blobs(n, r, 900, 1.0, 3.5, 0.3, fbm(n, r, 1.0, lo=60)) * smoothstep(0.9, 0.05, hgt_m)
    dirt = np.clip(spray * 0.75 + speck * 0.6, 0, 1)

    rust_core = _srgb('#4a2614') * (0.8 + 0.35 * smoothstep(-1, 1, fine))[..., None]
    rust_orange = _srgb('#8a4a24') * (0.85 + 0.3 * smoothstep(-1, 1, fbm(n, r, 1.5, lo=20, hi=300)))[..., None]
    stain = _srgb('#6e4428')
    alb = _lerp(alb, alb * 0.8 + stain * 0.2, blister * 0.5)                  # rust bleeding through paint
    alb = _lerp(alb, stain, np.clip(rust_runs * 0.55 + top_runs * 0.45, 0, 0.8))
    alb = _lerp(alb, alb * 0.62, np.clip(grime_runs + top_runs * 0.4, 0, 0.7))
    alb = _lerp(alb, _srgb('#3b342b') * 0.7 + alb * 0.3, dirt * 0.85)
    rust_mix = _lerp(rust_orange, rust_core, smoothstep(0.4, 0.9, rust))
    alb = _lerp(alb, rust_mix, smoothstep(0.15, 0.5, rust))
    # scrapes: grey zinc primer halo, bare bright steel in the fresh core
    alb = _lerp(alb, _srgb('#77766f'), np.clip(scrape_halo * 0.35 + scr * 0.4, 0, 1) * (1 - smoothstep(0.3, 0.7, rust)))
    bare = np.clip(scrape * (1 - smoothstep(0.4, 0.8, rust)), 0, 1)
    alb = _lerp(alb, _srgb('#6f706f'), bare * 0.8)

    rough = (0.5 + 0.22 * chalk + 0.04 * fine * 0.4 - 0.12 * patch + 0.15 * dirt + 0.06 * grime_runs
             + 0.32 * smoothstep(0.15, 0.6, rust) + 0.1 * blister - 0.18 * bare)
    metal = bare * 0.85
    h = (dents * -7.0 * mm + blister * 0.25 * mm + smoothstep(0.2, 0.9, rust) * (0.2 + 0.25 * smoothstep(-1, 1, fine)) * mm
         - damage * 0.12 * mm + smoothstep(1.0, -1.0, psd_min) * 0.05 * mm + fine * 0.006 * mm + speck * 0.05 * mm)
    cav = h - blur(h, 3)
    ao = np.clip(1 + cav / (0.3 * mm) * 0.25, 0.5, 1)
    save(name, alb, normal_from_height_m(h, px), np.stack([ao, np.clip(rough, 0.25, 1), np.clip(metal, 0, 1)], -1))


# ---------------------------------------------------------------------------
# Generic painted structural steel (crane, machinery, drums, bollards).
# No curvature map is available, so wear is clustered at two scales: large
# "damage zones" (where loads, ropes and boots hit) and fine chips inside them.
# ---------------------------------------------------------------------------
def painted_steel(save, name, paint, n=1024, seed=41, wear=0.5, rust_amt=0.5, tile=2.0, primer='#7a3b26'):
    r = Rng(seed)
    mm = 1e-3
    px = tile / n
    wn = (fbm(n, r, 2.0, lo=4, hi=200), fbm(n, r, 2.0, lo=4, hi=200))
    macro = fbm(n, r, 2.6, lo=1, hi=10)
    mid = fbm(n, r, 2.3, lo=3, hi=80)
    fine = fbm(n, r, 1.2, lo=200)
    zones = smoothstep(1.7 - wear * 0.8, 2.6 - wear * 0.8, fbm(n, r, 2.2, lo=2, hi=40)) * smoothstep(-0.5, 1.0, fbm(n, r, 1.8, lo=8, hi=120))
    # chips: sized scatter, appear where zone strength beats a per-chip threshold
    dC, iC = scatter(n, 150, r, rad=(0.15, 0.55), pnorm=(1.3, 2.2), aniso=(0.5, 1.0), jitter=1.0,
                     warp_amp=0.35, warp_noise=wn)
    thr = r.random(150 * 150)[iC]
    chip_on = (thr < zones * 0.8 + 0.015 * wear)
    chip = np.where(chip_on, smoothstep(1.0, 0.85, dC), 0)
    chip_inner = np.where(chip_on, smoothstep(0.6, 0.45, dC), 0) * (r.random(150 * 150)[iC] < 0.6)
    # fine scratches through the topcoat
    scr = lines_mask(n, r, int(120 * wear + 40), 14, 0.5, wobble=0.8) * smoothstep(-0.5, 1.0, zones + mid * 0.3)
    # rust: through inner chips and in spots; runs downwards
    spots = smoothstep(2.0 - rust_amt, 2.8 - rust_amt, fbm(n, r, 2.0, lo=3, hi=150))
    rust = np.clip(np.maximum(chip_inner * smoothstep(-0.8, 0.8, fbm(n, r, 1.5, lo=10, hi=300) + rust_amt), spots), 0, 1)
    bloom = np.clip(blur(rust, 2.5) * 2.0, 0, 1) * (1 - rust)
    runs = np.clip(blur_dir(rust, 110, axis=0) * 0.7, 0, 1) * smoothstep(-1.2, 1.0, fbm(n, r, 1.0, lo=30, aniso=(1, 0.04)))
    grime = smoothstep(-0.2, 1.8, macro) * 0.5 + np.clip(blur_dir(np.clip(fbm(n, r, 1.0, lo=24, aniso=(1, 0.03)), 0, None), 100, 0) * 0.25, 0, 0.5)
    p = _srgb(paint) * (0.95 + 0.05 * mid[..., None] * 0.6)
    chalk = np.clip(0.12 + 0.2 * smoothstep(-1.5, 1.5, macro), 0, 1)
    alb = _lerp(p, _lum(p) * 0.5 + p * 0.5 + 0.06, chalk)
    alb = _lerp(alb, _srgb('#6e4a30'), runs * 0.55)
    alb = _lerp(alb, alb * 0.6 + _srgb('#2e2a25') * 0.25, grime)
    alb = _lerp(alb, alb * 0.7 + _srgb('#6b3d22') * 0.3, bloom * 0.6)
    alb = _lerp(alb, _srgb(primer) * (0.9 + 0.1 * fine[..., None] * 0.4), chip)            # primer ring
    alb = _lerp(alb, _srgb('#85878a'), np.clip(scr * 0.8, 0, 1))                              # bright steel scratches
    alb = _lerp(alb, _srgb('#5f6062'), chip_inner * (1 - rust))                             # bare steel, dulled
    rcol = _lerp(_srgb('#7a3e1c'), _srgb('#3e2112'), smoothstep(-1, 1, fine))
    alb = _lerp(alb, rcol, smoothstep(0.2, 0.7, rust))
    rough = (0.45 + 0.18 * chalk + 0.06 * mid * 0.4 + 0.2 * grime + 0.1 * chip
             + 0.38 * smoothstep(0.2, 0.7, rust) - 0.15 * scr)
    metal = np.clip((chip_inner * (1 - rust)) * 0.9 + scr * 0.8, 0, 1)
    h = (-chip * 0.12 * mm - chip_inner * 0.1 * mm + smoothstep(0.2, 0.8, rust) * (0.25 + 0.2 * fine) * mm
         + bloom * 0.08 * mm + fine * 0.006 * mm + mid * 0.05 * mm - scr * 0.05 * mm)
    cav = h - blur(h, 3)
    ao = np.clip(1 + cav / (0.2 * mm) * 0.2, 0.5, 1)
    save(name, alb, normal_from_height_m(h, px), np.stack([ao, np.clip(rough, .2, 1), metal], -1))


# ---------------------------------------------------------------------------
# Ship hull, 8 m tile: dark blue-grey topside paint, butt/seam welds, rust
# runs from seams and scuppers, horizontal fender/tug scrapes, touch-up
# patches in a slightly different shade, salt bloom.
# ---------------------------------------------------------------------------
def hull(save, n=1024, seed=51):
    r = Rng(seed)
    mm = 1e-3
    px = 8.0 / n
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    fine = fbm(n, r, 1.2, lo=150)
    mid = fbm(n, r, 2.3, lo=3, hi=80)
    macro = fbm(n, r, 2.6, lo=1, hi=8)
    # plates 2 m x 4 m: weld beads (raised ~2 mm, 1.5 cm wide)
    dv = np.abs(((xs + n / 8) % (n / 4)) - n / 8)
    dh = np.abs(((ys + n / 4) % (n / 2)) - n / 4)
    seam = np.maximum(smoothstep(n / 8, n / 8 - 1.5, dv), smoothstep(n / 4, n / 4 - 1.5, dh))
    weld = np.maximum(smoothstep(1.8, 0.0, n / 8 - dv), smoothstep(1.8, 0.0, n / 4 - dh))
    # hungry-horse plate distortion between frames (frames every ~0.7 m)
    frames = np.cos(xs / n * 2 * np.pi * 11) * 0.5 + 0.5
    oilcan = frames * 2.5 * mm + macro * 2.0 * mm
    src = np.clip(weld * smoothstep(0.6, 1.8, fbm(n, r, 1.5, lo=6, hi=200)) + smoothstep(2.2, 2.9, fbm(n, r, 1.5, lo=6, hi=200)), 0, 1)
    runs = np.clip(blur_dir(src, 300, axis=0) * 1.1, 0, 1) * smoothstep(-1.2, 1.0, fbm(n, r, 1.0, lo=30, aniso=(1, .04)))
    scr = smoothstep(1.4, 0.3, _hscratches(n, r, 30, (0.0, 1.0), (0.05, 0.5), ang_sd=0.03))
    scr *= smoothstep(-0.5, 1.0, fbm(n, r, 1.2, lo=10, hi=300))
    touch = np.zeros((n, n), np.float32)
    for _ in range(6):
        sd = box_sdf(n, r.random() * n, r.random() * n, r.uniform(15, 80), r.uniform(10, 50), r.normal(0, 0.05))
        touch = np.maximum(touch, smoothstep(0.8, -0.8, sd + fine * 1.5))
    p = _srgb('#1d2a35') * (0.92 + 0.08 * mid[..., None] * 0.6)
    alb = _lerp(p, p * 0.75 + 0.03, touch * 0.8)
    alb = _lerp(alb, _srgb('#5b3a25'), runs * 0.65)
    alb = _lerp(alb, _srgb('#3e2414'), src * 0.85)
    alb = _lerp(alb, _srgb('#4a4945'), scr * 0.5)
    salt = smoothstep(0.5, 2.0, mid) * 0.3 + smoothstep(0.03, 0.0, ys / n) * 0.0
    alb = _lerp(alb, alb * 0.6 + 0.12, salt)
    rough = 0.5 + 0.22 * runs + 0.15 * salt + 0.25 * src - 0.1 * touch + 0.05 * fine * 0.4
    h = oilcan + weld * 1.5 * mm + src * 0.4 * mm + fine * 0.02 * mm - scr * 0.1 * mm
    ao = np.clip(1 + (h - blur(h, 4)) / (1 * mm) * 0.2, 0.5, 1)
    save('hull', alb, normal_from_height_m(h, px), np.stack([ao, np.clip(rough, .2, 1), np.zeros_like(h)], -1))


# ---------------------------------------------------------------------------
# Painted corrugated cladding (warehouse), 4 m tile. Corrugation is geometry.
# Chalky polyester coat, streaks below fixings/laps, dirt splash at the base,
# cut-edge corrosion at sheet laps.
# ---------------------------------------------------------------------------
def cladding(save, n=1024, seed=61):
    r = Rng(seed)
    mm = 1e-3
    px = 4.0 / n
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    vtop = 1 - ys / n
    fine = fbm(n, r, 1.2, lo=150)
    mid = fbm(n, r, 2.3, lo=3, hi=80)
    macro = fbm(n, r, 2.6, lo=1, hi=8)
    # fixings every ~0.3 m along two purlin lines; each sheds a streak
    fix = np.zeros((n, n), np.float32)
    for yrow in (0.12, 0.62):
        for k in range(14):
            fx = (k + 0.5) / 14 * n + r.normal(0, 2)
            fy = yrow * n + r.normal(0, 1.5)
            d = np.sqrt((xs - fx) ** 2 + (ys - fy) ** 2)
            fix = np.maximum(fix, smoothstep(3.5, 1.5, d))
    fstreak = np.clip(blur_dir(blur(fix, 1.5) * (r.random() + 0.5), 220, axis=0) * 1.4, 0, 1)
    fstreak *= smoothstep(-1.0, 1.0, fbm(n, r, 1.0, lo=30, aniso=(1, .03)))
    streak = np.clip(blur_dir(np.clip(fbm(n, r, 1.0, lo=30, aniso=(1, .03)), 0, None), 200, axis=0) * 0.4, 0, 1)
    dirt = smoothstep(0.28, 0.0, vtop) * (0.6 + 0.4 * smoothstep(-1, 1, fbm(n, r, 1.5, lo=20, hi=300)))
    cut = smoothstep(0.03, 0.0, 1 - vtop) * smoothstep(0.0, 1.2, fbm(n, r, 1.5, lo=10, hi=300))
    p = _srgb('#5d6a6c') * (0.94 + 0.06 * mid[..., None] * 0.6)
    chalk = 0.25 + 0.2 * smoothstep(-1.5, 1.5, macro)
    alb = _lerp(p, _lum(p) * 0.5 + p * 0.5 + 0.06, chalk)
    alb = _lerp(alb, alb * 0.62, streak)
    alb = _lerp(alb, _srgb('#6e4a30'), fstreak * 0.5)
    alb = _lerp(alb, _srgb('#2f2d29'), dirt * 0.6)
    alb = _lerp(alb, _srgb('#3a3a38'), fix)
    rust = np.clip(cut + smoothstep(2.3, 2.9, fbm(n, r, 1.8, lo=6, hi=200)), 0, 1)
    alb = _lerp(alb, _srgb('#5b3420'), np.clip(np.maximum(rust, blur_dir(rust, 100, 0) * 0.5), 0, 1))
    rough = 0.48 + 0.2 * chalk + 0.2 * streak + 0.15 * dirt + 0.25 * rust
    h = fine * 0.01 * mm + mid * 0.05 * mm + fix * 1.5 * mm + rust * 0.2 * mm
    ao = np.clip(1 + (h - blur(h, 3)) / (0.5 * mm) * 0.2, 0.5, 1)
    save('cladding', alb, normal_from_height_m(h, px), np.stack([ao, np.clip(rough, .2, 1), np.full_like(h, 0.0)], -1))


# ---------------------------------------------------------------------------
# Hot-dip galvanised steel, 1.5 m tile: spangle crystals, dull grey zinc patina,
# white rust in streaks, grime.
# ---------------------------------------------------------------------------
def galvanized(save, n=512, seed=111):
    r = Rng(seed)
    mm = 1e-3
    px = 1.5 / n
    from noise import voronoi
    f1, f2, cid = voronoi(n, 28, r, 1.0)
    fine = fbm(n, r, 1.2, lo=60)
    mid = fbm(n, r, 2.3, lo=2, hi=40)
    macro = fbm(n, r, 2.6, lo=1, hi=6)
    patina = smoothstep(-1.2, 1.2, macro * 0.7 + mid * 0.5)        # aged matte grey zinc
    spangle_col = _lerp(_srgb('#7d8384'), _srgb('#a7acac'), cid * 0.7 + 0.15)
    alb = _lerp(spangle_col, _srgb('#8a8d8b'), patina * 0.8) * (0.95 + 0.05 * fine[..., None] * 0.4)
    white = np.clip(blur_dir(smoothstep(1.4, 2.4, mid), 60, 0) * 0.6, 0, 1)
    alb = _lerp(alb, _srgb('#bdbdb5'), white * 0.55)
    grime = smoothstep(0.6, 2.2, fbm(n, r, 1.9, lo=3, hi=60)) * 0.3
    alb = _lerp(alb, alb * 0.6, grime)
    rust = smoothstep(2.4, 3.0, fbm(n, r, 1.8, lo=4, hi=100))
    alb = _lerp(alb, _srgb('#6b3e22'), np.clip(np.maximum(rust, blur_dir(rust, 40, 0) * 0.4), 0, 1))
    rough = 0.3 + 0.12 * cid + 0.3 * patina + 0.3 * white + 0.15 * grime + 0.4 * rust
    metal = np.clip(0.95 - 0.55 * white - 0.25 * patina - 0.9 * rust - 0.3 * grime, 0, 1)
    h = fine * 0.004 * mm + (f2 - f1) * 0.01 * mm + white * 0.05 * mm + rust * 0.15 * mm
    save('galvanized', alb, normal_from_height_m(h, px),
         np.stack([np.clip(1 - grime * 0.3, 0, 1), np.clip(rough, 0, 1), metal], -1))
