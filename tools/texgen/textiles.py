"""Textiles and leather at physical scale.

Each function knows its tile size (metres, matching SETS in materials.js), so
weave, ripstop grid, knit stitches and camouflage elements have real sizes:
  ripstop grid ~6-7 mm, twill ~0.5 mm (sub-texel: rendered as a soft diagonal
  bias, not a visible lattice), M90 splinters 3-20 cm, EMR pixels ~3 mm in
  clusters of 2-10 cm, knit stitch ~3.5 mm, webbing ribs ~1 mm.
Normals are computed from height in metres.
"""
import numpy as np

from noise import (Rng, fbm, blur, warp, smoothstep, scatter, blobs, normal_from_height_m, lines_mask)


def _srgb(c):
    return np.array([int(c[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255.0


def _lerp(a, b, t):
    if np.ndim(t) == 2 and (np.ndim(a) in (1, 3) or np.ndim(b) in (1, 3)):
        t = t[..., None]
    return a + (b - a) * t


def finish(save, name, base, n, r, tile, dirt=0.25, structure='ripstop', sheen=0.0, rough_base=0.88):
    """Weave/knit micro-structure + wear and grime on top of a printed base colour."""
    mm = 1e-3
    px = tile / n
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    fuzz = fbm(n, r, 0.8, lo=n / 6)
    if structure == 'ripstop':
        cells = max(int(round(tile / 0.0065)), 1)
        per = n / cells
        gx = np.abs(((xs + per / 2) % per) - per / 2)
        gy = np.abs(((ys + per / 2) % per) - per / 2)
        grid = np.maximum(smoothstep(1.3, 0.3, gx), smoothstep(1.3, 0.3, gy))
        twill = np.sin((xs + ys) * 2 * np.pi / 2.7) * 0.5
        h = grid * 0.09 * mm + twill * 0.015 * mm + fuzz * 0.02 * mm
        tone = 1 + 0.035 * grid - 0.01 * twill
    elif structure == 'knit':
        P = max(int(round(0.0035 / px)), 4)          # stitch width
        Q = P * 0.8                                  # course height
        xl = (xs % P) / P - 0.5                      # -0.5..0.5 within a wale
        yl = (ys % Q) / Q
        leg = np.exp(-((np.abs(xl) - 0.22 - (yl - 0.5) * 0.25) / 0.13) ** 2)
        loop_row = 0.6 + 0.4 * np.cos(yl * 2 * np.pi)
        h = leg * loop_row * 0.35 * mm - (np.abs(xl) < 0.06) * 0.1 * mm + fuzz * 0.05 * mm
        tone = 0.86 + 0.18 * leg
    elif structure == 'webbing':
        P = max(0.0011 / px, 2.5)
        rib = np.sin(ys * 2 * np.pi / P + np.sin(xs * 2 * np.pi / (P * 2)) * 0.8) * 0.5 + 0.5
        h = rib * 0.12 * mm + fuzz * 0.01 * mm
        tone = 0.9 + 0.12 * rib
    elif structure == 'cordura':
        P = max(0.0009 / px, 2.2)
        bw = np.sign(np.sin(xs * 2 * np.pi / P)) * np.sign(np.sin(ys * 2 * np.pi / P))
        bw = blur(bw.astype(np.float32), 0.7)
        h = bw * 0.03 * mm + fuzz * 0.02 * mm + fbm(n, r, 1.2, lo=n / 20) * 0.02 * mm
        tone = 1 + 0.03 * bw
    else:  # leather
        d, idx = scatter(n, max(int(tile / 0.0012), 8), r, rad=(0.5, 0.75), pnorm=(1.8, 2.4), aniso=(0.7, 1.0))
        pebble = np.sqrt(np.clip(1 - np.clip(d, 0, 1) ** 2, 0, 1))
        crease = lines_mask(n, r, 60, 40, 0.5, wobble=1.5)
        h = pebble * 0.05 * mm - crease * 0.15 * mm + fbm(n, r, 2.0, lo=2, hi=40) * 0.1 * mm
        tone = 0.92 + 0.1 * pebble - 0.2 * crease
    alb = base * tone[..., None] * (1 + 0.03 * fuzz[..., None])
    # wear: abraded/sun-faded areas (lighter, greyer, fuzzier), pilling
    mid = fbm(n, r, 2.4, lo=2, hi=30)
    wear = smoothstep(0.5, 2.0, fbm(n, r, 2.2, lo=2, hi=60))
    faded = alb * 0.75 + _srgb('#7b776a') * 0.25
    alb = _lerp(alb, faded, wear * 0.55)
    alb = alb * (1 + 0.04 * mid[..., None])
    # grime: dust (light, dry) and mud (dark) patches + tiny splashes
    mud = smoothstep(1.0, 2.4, fbm(n, r, 2.6, lo=2, hi=40)) * dirt
    splash = blobs(n, r, int(80 * dirt) + 1, n / 300, n / 90, 0.4, fbm(n, r, 1.5, lo=10, hi=200)) * dirt
    dust = smoothstep(0.8, 2.2, fbm(n, r, 2.4, lo=2, hi=30)) * dirt * 0.6
    alb = _lerp(alb, alb * 0.6 + _srgb('#a09a88') * 0.4, dust)
    alb = _lerp(alb, _srgb('#3b3226'), np.clip(mud + splash * 0.7, 0, 1))
    rough = rough_base + 0.04 * wear - 0.1 * mud - sheen + 0.03 * fuzz
    cav = h - blur(h, 2)
    ao = np.clip(1 + cav / (0.1 * mm) * 0.12, 0.55, 1)
    save(name, alb, normal_from_height_m(h + mud * 0.05 * mm, px), np.stack([ao, np.clip(rough, 0, 1), np.zeros_like(h)], -1))


def _fill_poly(out, poly, color, n):
    """Fill a convex polygon (pixel coords, may cross the tile edge) into out, tileable."""
    px, py = poly[:, 0], poly[:, 1]
    k = len(poly)
    for ox in (-n, 0, n):
        for oy in (-n, 0, n):
            qx, qy = px + ox, py + oy
            x0, x1 = int(max(np.floor(qx.min()), 0)), int(min(np.ceil(qx.max()) + 1, n))
            y0, y1 = int(max(np.floor(qy.min()), 0)), int(min(np.ceil(qy.max()) + 1, n))
            if x0 >= x1 or y0 >= y1:
                continue
            yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
            inside = np.ones(yy.shape, bool)
            for i in range(k):
                ax, ay, bx, by = qx[i], qy[i], qx[(i + 1) % k], qy[(i + 1) % k]
                inside &= ((bx - ax) * (yy - ay) - (by - ay) * (xx - ax)) >= 0
            sub = out[y0:y1, x0:x1]
            sub[inside] = color


def camo_m90(save, n=1024, seed=181, tile=0.45):
    """Swedish M90-style splinter: light green ground; mid green, dark green and black
    angular shards, long axis mostly diagonal, sizes 3-20 cm (procedural, no image copied)."""
    r = Rng(seed)
    P = n / tile                                         # pixels per metre
    colors = [_srgb('#7f8a5c'), _srgb('#56693c'), _srgb('#34432a'), _srgb('#1d1f1a')]
    out = np.broadcast_to(colors[0], (n, n, 3)).copy()
    main_ang = np.deg2rad(-32)
    for layer, (count, lmin, lmax) in enumerate([(55, 0.05, 0.20), (60, 0.04, 0.16), (45, 0.03, 0.12)]):
        c = colors[layer + 1]
        for _ in range(count):
            cx, cy = r.random() * n, r.random() * n
            L = r.uniform(lmin, lmax) * P
            W = L * r.uniform(0.18, 0.45)
            ang = main_ang + r.normal(0, 0.25) + (np.pi / 2 if r.random() < 0.12 else 0)
            ca, sa = np.cos(ang), np.sin(ang)
            # splinter: a skewed triangle or quad with one very sharp tip; sometimes a
            # second shard attached at an angle (gives the jagged, notched outline)
            for part in range(1 + (r.random() < 0.55)):
                if part:
                    cx += ca * L * r.uniform(0.2, 0.45); cy += sa * L * r.uniform(0.2, 0.45)
                    ang2 = ang + r.choice([-1, 1]) * r.uniform(0.4, 0.9)
                    ca, sa = np.cos(ang2), np.sin(ang2)
                    L *= r.uniform(0.5, 0.8); W *= r.uniform(0.6, 1.0)
                if r.random() < 0.5:
                    loc = np.array([[-L / 2, -W * r.uniform(0.2, 0.6)], [L / 2, 0], [-L * r.uniform(0.1, 0.4), W * r.uniform(0.3, 0.6)]])
                else:
                    loc = np.array([[-L / 2, -W / 2 * r.uniform(0.3, 1)], [L * r.uniform(0.1, 0.4), -W / 2],
                                    [L / 2, W * r.uniform(-0.1, 0.2)], [-L * r.uniform(0.2, 0.45), W / 2]])
                poly = np.stack([cx + loc[:, 0] * ca - loc[:, 1] * sa, cy + loc[:, 0] * sa + loc[:, 1] * ca], -1)
                # ensure counter-clockwise order for the half-plane test
                area = np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1])
                if area < 0:
                    poly = poly[::-1]
                _fill_poly(out, poly, c, n)
    # print: slight ink spread and registration softness, faded dye
    out = blur(out, 0.6)
    out = out * 0.92 + 0.08 * out.mean(-1, keepdims=True)
    finish(save, 'camo_m90', out, n, r, tile, dirt=0.3, structure='ripstop')


def cool_grade(save, sat=0.88, tint=(0.95, 1.0, 1.03), gain=1.0):
    """Wrap a save() so the albedo is desaturated and cooled (kills the warm khaki cast that the
    shared dust/mud colours in finish() add). Applied to the saved albedo only."""
    def g(name, alb, nrm, orm):
        lum = (alb * np.array([0.3, 0.55, 0.15], np.float32)).sum(-1, keepdims=True)
        out = (lum + (alb - lum) * sat) * np.array(tint, np.float32) * gain
        save(name, np.clip(out, 0, 1), nrm, orm)
    return g


def camo_emr(save, n=1024, seed=191, tile=0.4):
    """Russian digital-flora style: cool grey-green ground, olive-green, dark olive, desaturated
    brown and near-black pixel clusters (~3 mm pixels), organic branching cluster shapes with
    ragged pixel edges. Overall mean is a cool olive-grey, not khaki."""
    r = Rng(seed)
    colors = [_srgb('#7c8873'), _srgb('#62775a'), _srgb('#46563a'), _srgb('#4d4038'), _srgb('#1a1d19')]
    px = 8
    m = n // px
    base = np.broadcast_to(colors[0], (n, n, 3)).copy()
    for layer, (thr, lo, hi, warp_s) in enumerate([(0.3, 1.5, m / 3, 6), (0.7, 2, m / 3, 5), (0.95, 2, m / 2.5, 4), (1.25, 3, m / 2, 3)]):
        f = fbm(m, r, 2.3, lo=lo, hi=hi, aniso=(1.0, 0.75))
        f = warp(f, fbm(m, r, 2.0, lo=2, hi=m / 4), fbm(m, r, 2.0, lo=2, hi=m / 4), warp_s)
        f = f + r.standard_normal((m, m)) * 0.28           # ragged, dithered pixel edges
        mask = np.kron((f > thr).astype(np.float32), np.ones((px, px)))[:n, :n] > 0.5
        base[mask] = colors[layer + 1]
    base = blur(base, 0.5)
    base = base * 0.95 + 0.05 * base.mean(-1, keepdims=True)
    finish(cool_grade(save, 0.85, (0.99, 1.0, 0.99)), 'camo_emr', base, n, r, tile, dirt=0.3, structure='ripstop')


def plain(save, name, hexcol, n=512, seed=201, dirt=0.2, tile=0.3, structure='ripstop', sheen=0.0, rough_base=0.88):
    r = Rng(seed)
    base = np.broadcast_to(_srgb(hexcol), (n, n, 3)).copy()
    base = base * (1 + 0.04 * fbm(n, r, 2.4, lo=1, hi=12))[..., None]   # dye-lot / fade variation
    finish(save, name, base, n, r, tile, dirt=dirt, structure=structure, sheen=sheen, rough_base=rough_base)
