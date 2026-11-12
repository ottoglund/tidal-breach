"""Tileable noise primitives for offline PBR texture synthesis.

Everything here wraps around the texture edges so the generated maps tile
seamlessly. Only numpy is required.
"""
import numpy as np


class Rng:
    def __init__(self, seed):
        self.r = np.random.default_rng(seed)

    def __getattr__(self, name):
        return getattr(self.r, name)


def _freq(n):
    f = np.fft.fftfreq(n) * n
    fx, fy = np.meshgrid(f, f)
    return np.sqrt(fx * fx + fy * fy)


def norm01(a):
    a = a - a.min()
    m = a.max()
    return a / m if m > 0 else a


def fbm(n, rng, beta=2.0, lo=1.0, hi=None, aniso=(1.0, 1.0)):
    """Spectral-synthesis fractal noise, power spectrum ~ 1/f^beta, band-limited."""
    w = rng.standard_normal((n, n))
    F = np.fft.fft2(w)
    f = np.fft.fftfreq(n) * n
    fx, fy = np.meshgrid(f * aniso[0], f * aniso[1])
    r = np.sqrt(fx * fx + fy * fy)
    r[0, 0] = 1
    amp = 1.0 / r ** (beta / 2)
    amp[r < lo] = 0
    if hi is not None:
        amp *= np.exp(-(r / hi) ** 2)
    amp[0, 0] = 0
    out = np.real(np.fft.ifft2(F * amp))
    out /= (out.std() + 1e-9)
    return out  # zero-mean, unit-std


def blur(a, sigma):
    """Gaussian blur with wrap-around (FFT)."""
    if sigma <= 0:
        return a
    n = a.shape[0]
    f = np.fft.fftfreq(n)
    fx, fy = np.meshgrid(f, np.fft.fftfreq(a.shape[0]))
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    if a.ndim == 3:
        return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., i]) * g)) for i in range(a.shape[2])], -1)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def blur_dir(a, length, axis=0):
    """Box-ish directional smear (wrap) – used for rain streaks / rust runs."""
    out = np.zeros_like(a)
    for i in range(length):
        out += np.roll(a, i, axis=axis) * (1 - i / length)
    return out / (length / 2)


def voronoi(n, cells, rng, jitter=1.0):
    """Tileable Worley noise. Returns (f1, f2, cell_id_random) arrays."""
    g = cells
    pts = (np.arange(g)[:, None, None] * 0 + 0.5 + (rng.random((g, g, 2)) - 0.5) * jitter)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    u = xs / n * g
    v = ys / n * g
    ci = np.floor(u).astype(int)
    cj = np.floor(v).astype(int)
    ids = rng.random((g, g))
    f1 = np.full((n, n), 1e9, np.float32)
    f2 = np.full((n, n), 1e9, np.float32)
    idv = np.zeros((n, n), np.float32)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            cx = ci + di
            cy = cj + dj
            wx = cx % g
            wy = cy % g
            px = cx + pts[wy, wx, 0]
            py = cy + pts[wy, wx, 1]
            d = np.sqrt((u - px) ** 2 + (v - py) ** 2)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            idv = np.where(closer, ids[wy, wx], idv)
            f1 = np.where(closer, d, f1)
    return f1, f2, idv


def warp(a, dx, dy, strength):
    """Domain warp (wrap) using nearest-sample lookup with bilinear interpolation."""
    n = a.shape[0]
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    x = (xs + dx * strength) % n
    y = (ys + dy * strength) % n
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = x - x0
    fy = y - y0
    x1 = (x0 + 1) % n
    y1 = (y0 + 1) % n
    return ((a[y0, x0] * (1 - fx) + a[y0, x1] * fx) * (1 - fy) +
            (a[y1, x0] * (1 - fx) + a[y1, x1] * fx) * fy)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def normal_from_height(h, strength):
    """OpenGL-convention (+Y) tangent-space normal map from a height field."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1)


def ao_from_height(h, radius, strength):
    cav = h - blur(h, radius)
    return np.clip(1 + cav * strength, 0, 1)


def lines_mask(n, rng, count, length, width, wobble=0.3):
    """Random thin scratches (wrap)."""
    m = np.zeros((n, n), np.float32)
    for _ in range(count):
        x, y = rng.random() * n, rng.random() * n
        ang = rng.random() * np.pi
        L = length * (0.3 + rng.random())
        steps = int(L)
        for s in range(steps):
            ang += (rng.random() - 0.5) * wobble * 0.1
            x += np.cos(ang)
            y += np.sin(ang)
            m[int(y) % n, int(x) % n] = max(m[int(y) % n, int(x) % n], 1 - s / steps * 0.5)
    if width > 0.6:
        m = np.clip(blur(m, width * 0.5) * width * 2.5, 0, 1)
    return m


# ---------------------------------------------------------------------------
# v0.3 additions: physically scaled normals, sized scatter (aggregate, chips),
# polyline distance fields (cracks, seal bands, scratches).
# ---------------------------------------------------------------------------
def normal_from_height_m(h, px):
    """Tangent-space normal (+Y, OpenGL) from a height field in METRES.

    px = texel size in metres, so slopes are physically scaled (no arbitrary
    strength factor; the material's normalScale can still attenuate).
    """
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * px)
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * px)
    nx, ny, nz = -dx, dy, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1).astype(np.float32)


def scatter(n, g, rng, rad=(0.3, 0.5), pnorm=(2.0, 2.0), aniso=(1.0, 1.0), jitter=0.8, warp_amp=0.0, warp_noise=None):
    """Tileable sized-feature scatter (one feature per jittered grid cell).

    Each cell gets a random radius (in cell units), superellipse exponent,
    elongation and rotation. Returns (d, idx): d = normalised distance to the
    nearest feature (d < 1 inside a feature), idx = int id of that feature
    (0..g*g-1) for per-feature random attributes.
    """
    pts = 0.5 + (rng.random((g, g, 2)) - 0.5) * jitter
    R = rng.uniform(rad[0], rad[1], (g, g)).astype(np.float32)
    P = rng.uniform(pnorm[0], pnorm[1], (g, g)).astype(np.float32)
    A = rng.uniform(aniso[0], aniso[1], (g, g)).astype(np.float32)
    T = (rng.random((g, g)) * np.pi).astype(np.float32)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    u = xs / n * g
    v = ys / n * g
    if warp_amp and warp_noise is not None:
        u = u + warp_noise[0] * warp_amp
        v = v + warp_noise[1] * warp_amp
    ci = np.floor(u).astype(np.int32)
    cj = np.floor(v).astype(np.int32)
    best = np.full((n, n), 1e9, np.float32)
    idx = np.zeros((n, n), np.int32)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            cx = ci + di
            cy = cj + dj
            wx = cx % g
            wy = cy % g
            ddx = u - (cx + pts[wy, wx, 0])
            ddy = v - (cy + pts[wy, wx, 1])
            t = T[wy, wx]
            c, s = np.cos(t), np.sin(t)
            a = A[wy, wx]
            rx = (ddx * c + ddy * s) / a
            ry = (-ddx * s + ddy * c) * a
            p = P[wy, wx]
            d = (np.abs(rx) ** p + np.abs(ry) ** p) ** (1.0 / p) / R[wy, wx]
            closer = d < best
            best = np.where(closer, d, best)
            idx = np.where(closer, wy * g + wx, idx)
    return best, idx


def random_walk(rng, x, y, ang, steps, step_len, wobble, n):
    pts = [(x, y)]
    for _ in range(steps):
        ang += rng.normal() * wobble
        x += np.cos(ang) * step_len
        y += np.sin(ang) * step_len
        pts.append((x, y))
    return pts


def polyline_dist(n, polys, maxd, out=None, wrap=True):
    """Distance (pixels) to a set of polylines, clamped at maxd, tileable.

    polys: list of point lists in pixel coordinates.
    """
    if out is None:
        out = np.full((n, n), float(maxd), np.float32)
    for pts in polys:
        for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
            offs = [(-n, 0, n)] if wrap else [(0,)]
            for ox in (-n, 0, n) if wrap else (0,):
                for oy in (-n, 0, n) if wrap else (0,):
                    ax, ay, bx, by = x0 + ox, y0 + oy, x1 + ox, y1 + oy
                    lo_x = int(np.floor(min(ax, bx) - maxd)); hi_x = int(np.ceil(max(ax, bx) + maxd)) + 1
                    lo_y = int(np.floor(min(ay, by) - maxd)); hi_y = int(np.ceil(max(ay, by) + maxd)) + 1
                    lo_x, lo_y = max(lo_x, 0), max(lo_y, 0)
                    hi_x, hi_y = min(hi_x, n), min(hi_y, n)
                    if lo_x >= hi_x or lo_y >= hi_y:
                        continue
                    yy, xx = np.mgrid[lo_y:hi_y, lo_x:hi_x].astype(np.float32)
                    vx, vy = bx - ax, by - ay
                    L2 = vx * vx + vy * vy + 1e-9
                    t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / L2, 0, 1)
                    d = np.sqrt((xx - ax - t * vx) ** 2 + (yy - ay - t * vy) ** 2)
                    sub = out[lo_y:hi_y, lo_x:hi_x]
                    np.minimum(sub, d, out=sub)
    return out


def box_sdf(n, cx, cy, hw, hh, ang=0.0, wrap=True):
    """Signed distance (pixels) to a rotated rectangle, tileable (min over wraps)."""
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    best = np.full((n, n), 1e9, np.float32)
    c, s = np.cos(ang), np.sin(ang)
    for ox in (-n, 0, n) if wrap else (0,):
        for oy in (-n, 0, n) if wrap else (0,):
            dx = xs - cx - ox
            dy = ys - cy - oy
            rx = np.abs(dx * c + dy * s) - hw
            ry = np.abs(-dx * s + dy * c) - hh
            out = np.sqrt(np.maximum(rx, 0) ** 2 + np.maximum(ry, 0) ** 2) + np.minimum(np.maximum(rx, ry), 0)
            best = np.minimum(best, out)
    return best


def blobs(n, rng, count, rmin, rmax, wobble=0.35, warp_n=None):
    """Soft irregular blobs (stains, splashes): returns 0..1 mask, tileable."""
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    m = np.zeros((n, n), np.float32)
    for _ in range(count):
        cx, cy = rng.random() * n, rng.random() * n
        rr = rng.uniform(rmin, rmax)
        a = rng.uniform(0.5, 1.0)
        lo_x, hi_x = int(cx - rr * 2), int(cx + rr * 2) + 1
        lo_y, hi_y = int(cy - rr * 2), int(cy + rr * 2) + 1
        xi = np.arange(lo_x, hi_x) % n
        yi = np.arange(lo_y, hi_y) % n
        yy, xx = np.meshgrid(np.arange(lo_y, hi_y), np.arange(lo_x, hi_x), indexing='ij')
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / rr
        if warp_n is not None:
            d = d + warp_n[np.ix_(yi, xi)] * wobble
        v = np.clip(1.2 - d, 0, 1) ** 0.8 * a
        sub = m[np.ix_(yi, xi)]
        m[np.ix_(yi, xi)] = np.maximum(sub, v)
    return m
