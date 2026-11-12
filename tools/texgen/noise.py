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
