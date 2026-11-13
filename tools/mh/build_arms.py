#!/usr/bin/env python3
"""Offline build: MakeHuman CC0 hands + forearms -> first-person viewmodel arms (game/assets/models/viewmodel_arms.bin).

Usage:  python3 tools/mh/build_arms.py

Uses the same CC0 sources and the same body preparation as build_soldier.py (macro targets, metres, game axes), then
for each arm:
 1. selects the hand and forearm of the MakeHuman base mesh (the glove: fingertips to 8 cm above the wrist; the sleeve:
    4 cm above the wrist to just past the elbow) and subdivides the sleeve once (Catmull-Clark) for smooth folds
 2. places the hand on the rifle (gun space of game/src/viewmodel/rifle.js): right hand on the Ak 4C pistol grip with
    the index finger laid along the receiver, left hand under the handguard with the thumb along its left side
 3. closes the fingers phalanx by phalanx (linear-blend skinning with the MakeHuman finger weights) until each phalanx
    touches the rifle (signed-distance model of the receiver, grip, guard and handguard); the thumb and the index are
    solved toward target points with a collision penalty
 4. turns the forearm about the wrist toward the elbow position of the old viewmodel, with a twist spread along the
    two MakeHuman forearm bones (no pinched wrist)
 5. dresses the arm: cordura glove (2.5 mm over the skin, longer fingertips, padded knuckle strip, gauntlet cuff with
    a hook-and-loop strap), M90 sleeve (baggy, bunched folds behind the cuff, a snug hemmed cuff with a tab, an inner
    lip that shows the cloth thickness)
 6. writes per-vertex shading data (aux, u8 x 4): cavity / contact occlusion, a signed seam field (side seams of the
    glove fingers and the knuckle strip outline, cuff hem stitching; drawn as sharp lines in the shader), pad mask,
    palm mask
The output uses the 'TBMH' container of soldier_body.bin (game/src/characters/body.js), one 'lod' per arm, static
(no skin weights), already in gun space.
"""
import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_soldier as bs  # noqa: E402
import mhio  # noqa: E402

OUT = os.path.join(HERE, '..', '..', 'game', 'assets', 'models', 'viewmodel_arms.bin')
unit, rot_axis, sstep = bs.unit, bs.rot_axis, bs.sstep

# ------------------------------------------------------------------------------------------------ rifle (gun space)
# mirrors game/src/viewmodel/rifle.js DIM (origin = red-dot tube centre, barrel toward -Z, +X right, +Y up)
BORE = -0.068
GRIP_C = np.array([0.0, -0.176, 0.07])
GRIP_TILT = -0.3
GR = rot_axis([1, 0, 0], GRIP_TILT)          # grip local -> gun
GRIP_PROFILE = [(0.0105, -0.054), (0.0135, -0.044), (0.0145, -0.02), (0.0142, 0.0), (0.0155, 0.02), (0.0165, 0.04), (0.0165, 0.05)]
GLOVE_T = 0.0024                             # glove material over the skin
GAP = 0.0004


def sd_rbox(p, c, h, r):
    q = np.abs(p - c) - (np.asarray(h) - r)
    return np.linalg.norm(np.maximum(q, 0), axis=-1) + np.minimum(q.max(-1), 0) - r


def sd_grip(p):
    pl = (p - GRIP_C) @ GR                      # gun -> grip local
    y = pl[..., 1]
    ys = np.array([a[1] for a in GRIP_PROFILE]); rs = np.array([a[0] for a in GRIP_PROFILE])
    r = np.interp(y, ys, rs)
    a, b = r, r * 1.4
    k0 = np.hypot(pl[..., 0] / a, pl[..., 2] / b)
    k1 = np.hypot(pl[..., 0] / a ** 2, pl[..., 2] / b ** 2)
    d2 = k0 * (k0 - 1) / (k1 + 1e-9)
    dy = np.abs(y + 0.003) - 0.055
    return np.maximum(d2, dy)


def rifle_sdf(p):
    p = np.asarray(p, dtype=np.float64)
    d = [
        sd_rbox(p, [0, -0.080, -0.005], [0.017, 0.023, 0.125], 0.009),        # receiver
        sd_rbox(p, [0, -0.121, 0.03], [0.0165, 0.023, 0.088], 0.009),          # trigger housing
        sd_rbox(p, [0, -0.1295, -0.066], [0.018, 0.03, 0.035], 0.005),         # magazine well
        sd_rbox(p, [0, -0.213, -0.068], [0.012, 0.095, 0.026], 0.003),         # magazine
        sd_rbox(p, [0, -0.1535, 0.012], [0.00625, 0.0021, 0.037], 0.0015),     # trigger guard
        sd_rbox(p, [0, BORE, -0.26], [0.0215, 0.021, 0.14], 0.012),            # handguard
        sd_rbox(p, [0.0245, BORE - 0.004, -0.247], [0.0017, 0.0055, 0.04], 0.001),   # side rail stubs
        sd_rbox(p, [-0.0245, BORE - 0.004, -0.247], [0.0017, 0.0055, 0.04], 0.001),
        sd_rbox(p, [-0.0215, BORE + 0.0255, -0.26], [0.0078, 0.0078, 0.14], 0.0078),  # cocking tube
        sd_grip(p),
    ]
    return np.min(np.stack(d, 0), 0)


# ------------------------------------------------------------------------------------------------ mesh utilities
def catmull_clark(V, quads):
    """One Catmull-Clark step on a quad patch with open borders. V: (n, k) per-vertex data (positions + any linear
    attributes, all interpolated with the same weights). Returns (V', quads')."""
    nv = len(V)
    quads = np.asarray(quads)
    nf = len(quads)
    fp = V[quads].mean(1)
    edges = {}
    ef = []
    for fi, q in enumerate(quads):
        for k in range(4):
            a, b = int(q[k]), int(q[(k + 1) % 4])
            e = (min(a, b), max(a, b))
            if e not in edges:
                edges[e] = len(edges)
                ef.append([])
            ef[edges[e]].append(fi)
    ne = len(edges)
    ep = np.zeros((ne, V.shape[1]))
    border = np.zeros(nv, bool)
    for (a, b), ei in edges.items():
        fs = ef[ei]
        if len(fs) == 2:
            ep[ei] = (V[a] + V[b] + fp[fs[0]] + fp[fs[1]]) / 4
        else:
            ep[ei] = (V[a] + V[b]) / 2
            border[a] = border[b] = True
    # vertex points
    vf = [[] for _ in range(nv)]
    for fi, q in enumerate(quads):
        for x in q:
            vf[x].append(fi)
    ve = [[] for _ in range(nv)]
    for (a, b), ei in edges.items():
        ve[a].append((b, ei))
        ve[b].append((a, ei))
    nvp = V.copy()
    for i in range(nv):
        if not vf[i]:
            continue
        if border[i]:
            bn = [o for o, ei in ve[i] if len(ef[ei]) == 1]
            if len(bn) == 2:
                nvp[i] = 0.75 * V[i] + 0.125 * (V[bn[0]] + V[bn[1]])
            continue
        n = len(vf[i])
        F = fp[vf[i]].mean(0)
        Rm = np.mean([(V[i] + V[o]) / 2 for o, _ in ve[i]], 0)
        nvp[i] = (F + 2 * Rm + (n - 3) * V[i]) / n
    out = np.vstack([nvp, ep, fp])
    E0, F0 = nv, nv + ne
    nq = []
    for fi, q in enumerate(quads):
        for k in range(4):
            a, b, c = int(q[k]), int(q[(k + 1) % 4]), int(q[(k + 3) % 4])
            eab = E0 + edges[(min(a, b), max(a, b))]
            eca = E0 + edges[(min(c, a), max(c, a))]
            nq.append([a, eab, F0 + fi, eca])
    return out, np.array(nq)


def compact(V, quads):
    used = np.unique(quads)
    remap = -np.ones(len(V), np.int64)
    remap[used] = np.arange(len(used))
    return used, remap[quads]


def tri(quads):
    q = np.asarray(quads)
    return np.concatenate([q[:, [0, 1, 2]], q[:, [0, 2, 3]]])


def normals(V, F):
    return bs.vertex_normals(V, F)


def nbrs(n, quads):
    return bs.neighbours(n, [list(q) for q in quads])


def smooth(x, nb, it, lam, mask=None, verts=None):
    verts = np.arange(len(x)) if verts is None else verts
    return bs.smooth_field(x, nb, verts, it, lam, mask)


def bake_ao(P, N, occ_tris, h=0.0025, rays=32, reach=0.06):
    """Ambient occlusion per vertex: cosine-weighted rays marched through a voxel grid that holds the rifle (SDF) and
    the given triangle meshes (surface samples). Returns visibility 0..1."""
    allp = np.vstack([P] + [V_[F_].reshape(-1, 3) for V_, F_ in occ_tris])
    lo = allp.min(0) - reach - h
    hi = allp.max(0) + reach + h
    dims = np.ceil((hi - lo) / h).astype(int) + 1
    gx = [lo[k] + h * np.arange(dims[k]) for k in range(3)]
    grid = np.zeros(dims, bool)
    for i0 in range(0, dims[0], 16):
        X, Y, Z = np.meshgrid(gx[0][i0:i0 + 16], gx[1], gx[2], indexing='ij')
        grid[i0:i0 + 16] = rifle_sdf(np.stack([X, Y, Z], -1)) < 0.001
    bary = np.array([[a, b, 1 - a - b] for a in np.linspace(0, 1, 5) for b in np.linspace(0, 1, 5) if a + b <= 1.0001])
    for V_, F_ in occ_tris:
        pts = np.einsum('sk,fkd->fsd', bary, V_[F_]).reshape(-1, 3)
        ix = np.clip(np.round((pts - lo) / h).astype(int), 0, dims - 1)
        grid[ix[:, 0], ix[:, 1], ix[:, 2]] = True
    rng = np.random.RandomState(3)
    u1, u2 = (np.arange(rays) + 0.5) / rays, rng.permutation(rays) / rays
    loc = np.stack([np.sqrt(u1) * np.cos(2 * np.pi * u2), np.sqrt(u1) * np.sin(2 * np.pi * u2), np.sqrt(1 - u1)], 1)
    t1 = np.where(np.abs(N[:, 0:1]) < 0.9, np.array([[1.0, 0, 0]]), np.array([[0, 1.0, 0]]))
    T1 = np.cross(N, t1); T1 /= np.linalg.norm(T1, axis=1, keepdims=True)
    T2 = np.cross(N, T1)
    vis = np.zeros(len(P))
    steps = np.arange(0.0045, reach, h * 0.8)
    for d in loc:
        D = T1 * d[0] + T2 * d[1] + N * d[2]
        hit = np.zeros(len(P), bool)
        for t in steps:
            q = P + D * t
            ix = np.clip(np.round((q - lo) / h).astype(int), 0, dims - 1)
            hit |= grid[ix[:, 0], ix[:, 1], ix[:, 2]]
        vis += ~hit
    return vis / rays


# ------------------------------------------------------------------------------------------------ skinning
def lbs(X, Wsel, xfs):
    """X (n,3) in a common space; Wsel: {bone: (idx, w)} restricted to the arm; xfs: {bone: (A, p, q)} -> x' = A (x-p) + q.
    Bones without a transform stay put. Weights are renormalised over the given bones."""
    out = np.zeros_like(X)
    tot = np.zeros(len(X))
    for b, (idx, w) in Wsel.items():
        if b in xfs:
            A, p, q = xfs[b]
            y = (X[idx] - p) @ A.T + q
        else:
            y = X[idx]
        out[idx] += w[:, None] * y
        tot[idx] += w
    m = tot > 1e-6
    out[m] /= tot[m, None]
    out[~m] = X[~m]
    return out


def chain(heads, rots):
    """FK of a joint chain (rotation r_k about joint k): returns [(A_k, p_k, q_k)]."""
    out = []
    A = np.eye(3)
    for k, (p, r) in enumerate(zip(heads, rots)):
        q = p.copy() if k == 0 else out[-1][0] @ (p - heads[k - 1]) + out[-1][2]
        A = A @ r
        out.append((A.copy(), p, q))
    return out


# ------------------------------------------------------------------------------------------------ one arm
SIDES = {
    # gun-space targets: wrist joint, middle-finger knuckle (MCP3) joint, palm-normal hint, elbow direction; tip targets
    # for the thumb and the right index
    'R': dict(S=1, wrist=np.array([0.042, -0.152, 0.158]), mcp=np.array([0.03, -0.174, 0.05]), palm=np.array([-1.0, 0.0, -0.25]),
              elbow=np.array([0.17, -0.36, 0.52]), twist=0.0,
              thumb=np.array([-0.029, -0.150, 0.050]), index=np.array([0.0215, -0.132, -0.022])),
    'L': dict(S=-1, wrist=np.array([-0.092, -0.118, -0.165]), mcp=np.array([-0.008, -0.103, -0.228]), palm=np.array([0.3, 1.0, 0.0]),
              elbow=np.array([-0.24, -0.40, 0.12]), twist=0.0,
              thumb=np.array([-0.033, BORE + 0.003, -0.300]), index=None),
}


def object_frame(sd):
    """Gun-space frame of the held object: origin, columns (e1, e2, a); hand +Z maps to a."""
    if sd == 'R':
        a = -(GR @ np.array([0, 1.0, 0]))                    # down the grip (hand +Z = toward the little finger)
        e1 = np.array([1.0, 0, 0])
        e2 = np.cross(a, e1)
        return GRIP_C.copy(), np.stack([e1, e2, a], 1)
    a = np.array([0, 0, 1.0])                                # handguard: hand +Z = toward the shooter
    return np.array([0, BORE, -0.222]), np.stack([np.array([1.0, 0, 0]), np.array([0, 1.0, 0]), a], 1)


def build_arm(B, W, Wmh, pos, R, sd):
    cfg = SIDES[sd]
    S = cfg['S']
    v = B['v']
    H, T = B['H'], B['T']
    wr = pos['hand' + sd]
    Rh = R['hand' + sd]
    yax = R['farm' + sd][:, 1]                                # wrist -> elbow
    elbow = pos['farm' + sd]
    flen = np.linalg.norm(elbow - wr)
    gi = bs.GI
    armw = W[:, gi['hand' + sd]] + W[:, gi['farm' + sd]] + W[:, gi['uarm' + sd]]
    t_all = (v - wr) @ yax
    # ---- face selection (MakeHuman quads, body group)
    faces = [np.array(f) for f, k in zip(B['faces'], B['fkind']) if k == 'body']
    fuv = [np.array(t) for t, k in zip(B['fuv'], B['fkind']) if k == 'body']
    T_GLOVE, T_CUFF, T_END = 0.085, 0.042, flen + 0.03
    gl_q, sl_q = [], []
    for f in faces:
        if armw[f].min() < 0.5 or S * v[f, 0].min() < 0.05:
            continue
        tt = t_all[f]
        if tt.max() < T_GLOVE:
            gl_q.append(f)
        if tt.min() > T_CUFF - 0.012 and tt.max() < T_END and tt.mean() > T_CUFF:
            sl_q.append(f)
    gl_q, sl_q = np.array(gl_q), np.array(sl_q)

    # ---- MakeHuman weights restricted to the arm (hand space is the working space)
    hs = lambda p: (np.asarray(p) - wr) @ Rh
    arm_bones = [b for b in Wmh if b.endswith('.' + sd) and (b.startswith('finger') or b.startswith('metacarpal') or
                                                            b.startswith('wrist') or b.startswith('lowerarm') or
                                                            b.startswith('upperarm'))]

    def wsel(index_map):
        """{bone: (local idx, w)} for the global vertex ids in index_map (global -> local, -1 = absent)."""
        out = {}
        for b in arm_bones:
            idx, w = Wmh[b]
            loc = index_map[idx]
            m = loc >= 0
            if m.any():
                out[b] = (loc[m], w[m])
        return out

    # ---- glove: compact, light smoothing of skin detail (nails, creases)
    gidx, gq = compact(v, gl_q)
    gmap = -np.ones(len(v), np.int64); gmap[gidx] = np.arange(len(gidx))
    G = hs(v[gidx])
    nbg = nbrs(len(G), gq)
    for _ in range(4):
        G = smooth(G, nbg, 1, 0.5)
        G = smooth(G, nbg, 1, -0.52)
    Gw = wsel(gmap)
    G_rest = G.copy()

    # ---- sleeve: one Catmull-Clark step (positions + skin weights interpolate linearly)
    sidx, sq = compact(v, sl_q)
    smap = -np.ones(len(v), np.int64); smap[sidx] = np.arange(len(sidx))
    Sw0 = wsel(smap)
    bl = sorted(Sw0)
    Wm = np.zeros((len(sidx), len(bl)))
    for j, b in enumerate(bl):
        Wm[Sw0[b][0], j] = Sw0[b][1]
    data = np.hstack([hs(v[sidx]), Wm])
    data, sq = catmull_clark(data, sq)
    Sx = data[:, :3]
    Sw = {b: (np.arange(len(Sx)), data[:, 3 + j]) for j, b in enumerate(bl)}
    S_rest = Sx.copy()

    # ---- rigid placement of the hand in gun space: the wrist -> middle-knuckle line runs from the wrist target to the
    # knuckle target, the palm faces the palm hint; if the palm then cuts into the rifle the hand backs off along the
    # palm normal until it just touches
    mcp3 = hs(H['finger3-1.' + sd])
    d = unit(cfg['mcp'] - cfg['wrist'])
    n = cfg['palm'] - (cfg['palm'] @ d) * d
    n = unit(n)
    xg = -S * n                                              # hand X (palm faces -X*S)
    yg = unit(-d - (-d @ xg) * xg)                          # hand Y (wrist side), MCP3 lies along -Y (+ small X)
    # MakeHuman's MCP3 is not exactly on the hand -Y axis: rotate so the actual wrist->MCP3 vector maps onto d
    Rg = np.stack([xg, yg, np.cross(xg, yg)], 1)
    m_dir = unit(Rg @ mcp3)
    axr = np.cross(m_dir, d)
    if np.linalg.norm(axr) > 1e-9:
        Rg = rot_axis(axr, np.arctan2(np.linalg.norm(axr), m_dir @ d)) @ Rg
    t0 = cfg['mcp'] - Rg @ mcp3

    def to_gun(X, c):
        X = np.atleast_2d(X)
        return X @ Rg.T + t0 + c

    dom_pal = np.zeros(len(G))
    for b, (idx, w) in Gw.items():
        if b.startswith('metacarpal') or b.startswith('wrist'):
            dom_pal[idx] += w
    palm = (dom_pal > 0.6) & (G[:, 1] < 0.01)
    c = None
    for lam in np.linspace(0.0, -0.06, 241):
        cc = n * lam
        if rifle_sdf(to_gun(G[palm], cc)).min() >= GLOVE_T + GAP:
            c = cc
            break
    assert c is not None, 'palm placement failed'
    if os.environ.get('ARMDBG'):
        print(sd, 'slide', round(float(c @ n), 4), 'knuckles gun', np.round(to_gun(np.array([hs(H[f'finger{f}-1.{sd}']) for f in (2, 3, 4, 5)]), c), 3).tolist(), 'wrist gun', np.round(to_gun(np.zeros(3), c), 3))

    # ---- fingers 2..5: close each phalanx until it touches the rifle (vertex contact)
    xfs = {}
    Zh = np.array([0, 0, 1.0])
    domb = {}
    for b, (idx, w) in Gw.items():
        domb[b] = idx[w > 0.55]
    # wrap search per finger: MCP flexion t1, PIP t2, DIP t2 * k3; every phalanx should touch the rifle (gap -> 0)
    # without cutting into it (a 1 mm squash of the glove is allowed), the fingertip weighs most
    T1 = np.linspace(-0.5, 1.6, 22)
    T2 = np.linspace(0.0, 1.9, 20)
    K3 = (0.55, 0.8, 1.05)
    for f in (2, 3, 4, 5):
        names = [f'finger{f}-{k}.{sd}' for k in (1, 2, 3)]
        heads = [hs(H[b]) for b in names]
        if sd == 'R' and f == 2:
            continue                                         # index solved toward its target below
        axes = []
        for k in range(3):
            # flexion axis: perpendicular to the phalanx and the palm normal (close to hand Z)
            dirk = unit(hs(T[names[k]]) - heads[k])
            ax = unit(np.cross(dirk, np.array([-S, 0, 0.0])))
            axes.append(ax if ax @ Zh > 0 else -ax)
        smp = [G[domb[b][::2]] for b in names]
        # close the A-pose finger spread: turn the finger about the palm normal toward the middle finger (90 %)
        ang_of = lambda dv: np.arctan2(dv[2], -dv[1])
        d_f = hs(T[names[0]]) - heads[0]
        d_m = hs(T[f'finger3-1.{sd}']) - hs(H[f'finger3-1.{sd}'])
        spread = ang_of(d_f) - ang_of(d_m)
        rad = rot_axis([1.0, 0, 0], spread * 0.9)
        if abs(ang_of(rad @ d_f) - ang_of(d_m)) > abs(spread):
            rad = rot_axis([1.0, 0, 0], -spread * 0.9)
        best = None
        for t1 in T1:
            r1 = rad @ rot_axis(axes[0], -t1 * S)
            for t2 in T2:
                r2 = rot_axis(axes[1], -t2 * S)
                for k3 in K3:
                    xf = chain(heads, [r1, r2, rot_axis(axes[2], -t2 * k3 * S)])
                    e = 0.0002 * (t1 + t2)
                    for (A, p, q), P0, wk in zip(xf, smp, (1.0, 1.4, 2.2)):
                        dmin = rifle_sdf(to_gun((P0 - p) @ A.T + q, c)).min() - GLOVE_T - GAP
                        e += 400 * max(0.0, -dmin - 0.001) + wk * max(0.0, dmin)
                    if best is None or e < best[0]:
                        best = (e, xf, (t1, t2, k3))
        if best[0] > 0.012:
            # no wrap found (the finger runs along the rifle): relaxed, slightly curled finger resting on it
            relax = None
            for t1 in np.linspace(-0.8, 0.6, 15):
                xf = chain(heads, [rad @ rot_axis(axes[0], -t1 * S), rot_axis(axes[1], -0.45 * S), rot_axis(axes[2], -0.35 * S)])
                pen = max(GLOVE_T + GAP - rifle_sdf(to_gun((P0 - p) @ A.T + q, c)).min() for (A, p, q), P0 in zip(xf, smp))
                key = (max(pen - 0.001, 0.0), -t1)
                if relax is None or key < relax[0]:
                    relax = (key, xf, (t1, 0.45, 0.78))
            best = (best[0], relax[1], relax[2])
        for b, xf in zip(names, best[1]):
            xfs[b] = xf
        if os.environ.get('ARMDBG'):
            print(sd, 'finger', f, 'angles', np.round(best[2], 2), 'err', round(best[0], 4))

    # ---- thumb (and the right index): target search with a collision penalty on the joints and phalanx vertices
    def solve(f, target, ranges, flex_axis_hint):
        names = [f'finger{f}-{k}.{sd}' for k in (1, 2, 3)]
        heads = [hs(H[b]) for b in names]
        tip = hs(T[names[2]])
        tg = target
        smp = [domb[b][::3] for b in names]
        best = None
        for a0 in ranges[0]:
            for a1 in ranges[1]:
                for fl in ranges[2]:
                    r0 = rot_axis([1, 0, 0], a0) @ rot_axis([0, 1, 0], a1) if f == 1 else \
                        rot_axis(Zh, -a0 * S) @ rot_axis([1, 0, 0], a1)
                    td = heads[2] - heads[1]
                    ax = unit(np.cross(td, flex_axis_hint))
                    rf = rot_axis(ax, fl)
                    rf2 = rot_axis(ax, fl * (0.8 if f == 1 else 0.7))
                    xf = chain(heads, [r0, rf, rf2])
                    A, p, q = xf[-1]
                    e = to_gun(A @ (tip - p) + q, c)[0]
                    err = np.linalg.norm(e - tg)
                    pts = np.vstack([((G[s] - xp) @ Ax.T + xq) for s, (Ax, xp, xq) in zip(smp, xf)])
                    d = rifle_sdf(to_gun(pts, c))
                    err += np.clip(GLOVE_T + GAP - d, 0, None).sum() * 3
                    if best is None or err < best[0]:
                        best = (err, xf)
        for b, xf in zip(names, best[1]):
            xfs[b] = xf
        return best[0]

    e_th = solve(1, cfg['thumb'], (np.linspace(-1.4, 1.4, 22), np.linspace(-1.3, 1.3, 22), np.linspace(-0.4, 0.9, 7)),
                 np.array([-S, 0, 0.0]))
    e_ix = None
    if cfg['index'] is not None:
        e_ix = solve(2, cfg['index'], (np.linspace(-0.3, 1.0, 14), np.linspace(-0.35, 0.35, 8), np.linspace(-0.1, 0.9, 8)),
                     np.array([-S, 0, 0.0]))

    # ---- skin the glove (hand space), then hand space -> gun space
    Gp = lbs(G, Gw, xfs)
    Sp = lbs(Sx, Sw, xfs)
    Gg = to_gun(Gp, c)
    Sg = to_gun(Sp, c)
    wr_g = to_gun(np.zeros(3), c)[0]
    el_g = to_gun(hs(elbow), c)[0]
    # ---- forearm: swing about the wrist toward the target elbow direction, twist spread over the forearm bones
    d0 = unit(el_g - wr_g)
    d1 = unit(cfg['elbow'] - wr_g)
    ax = np.cross(d0, d1)
    ang = np.arctan2(np.linalg.norm(ax), d0 @ d1)
    Rf = rot_axis(ax, ang) if np.linalg.norm(ax) > 1e-9 else np.eye(3)
    fxf = {}
    for b, k in ((f'lowerarm01.{sd}', 1.0), (f'lowerarm02.{sd}', 0.85), (f'upperarm02.{sd}', 1.0), (f'upperarm01.{sd}', 1.0)):
        Rt = rot_axis(d1, cfg['twist'] * k) @ Rf
        fxf[b] = (Rt, wr_g, wr_g)
    # the wrist bone keeps the hand; lowerarm02 (the distal half) takes most of the swing: smooth wrist bend
    Gg = lbs(Gg, Gw, fxf)
    Sg = lbs(Sg, Sw, fxf)
    fore_dir = d1

    # ---------------------------------------------------------------- glove dressing
    Fg = tri(gq)
    nG = normals(Gg, Fg)
    nG = smooth(nG, nbg, 2, 0.5)
    nG /= np.linalg.norm(nG, axis=1, keepdims=True) + 1e-12
    # rest-space fields (hand frame, before posing): dorsal side, palm side, knuckle strip, finger side seams
    hx = G_rest[:, 0] * S                                       # + = back of the hand
    fingerw = np.zeros(len(G))
    for b, (idx, w) in Gw.items():
        if b.startswith('finger') and not b.startswith('finger1'):
            fingerw[idx] += w
    thumbw = np.zeros(len(G))
    for b, (idx, w) in Gw.items():
        if b.startswith('finger1'):
            thumbw[idx] += w
    # finger side seam: signed distance from each phalanx's mid plane (dorsal / palmar halves)
    seam = np.full(len(G), 1.0)
    for f in (2, 3, 4, 5, 1):
        for k in (1, 2, 3):
            b = f'finger{f}-{k}.{sd}'
            if b not in Gw:
                continue
            idx, w = Gw[b]
            m = w > 0.3
            hd = hs(H[b]); tl = hs(T[b])
            ax_ = unit(tl - hd)
            # dorsal direction of the phalanx in rest: hand +X*S made perpendicular to the bone
            dn = np.array([S, 0, 0.0]) if f != 1 else unit(np.array([S * 0.4, 0, -1.0]))
            dn = unit(dn - (dn @ ax_) * ax_)
            mid = (G_rest[idx[m]] - hd) @ dn - 0.0005
            seam[idx[m]] = np.where(np.abs(mid) < np.abs(seam[idx[m]]), mid, seam[idx[m]])
    seam = np.where(fingerw + thumbw > 0.3, seam, 1.0)
    # knuckle strip (padded band over the four MCP joints on the back of the hand)
    mcps = np.array([hs(H[f'finger{f}-1.{sd}']) for f in (2, 3, 4, 5)])
    ky = mcps[:, 1].mean()
    kz0, kz1 = mcps[:, 2].min() - 0.012, mcps[:, 2].max() + 0.01
    pad_d = np.maximum(np.abs(G_rest[:, 1] - (ky + 0.004)) - 0.015, np.maximum(kz0 - G_rest[:, 2], G_rest[:, 2] - kz1))
    pad_d = np.where(hx > 0.0, pad_d, 0.02)                   # signed: < 0 inside the strip
    padm = np.clip(1 - sstep(-0.004, 0.002, pad_d), 0, 1) * sstep(0.0, 0.006, hx)
    # knuckle bumps on the strip
    bump = np.zeros(len(G))
    for mc in mcps:
        dd = np.linalg.norm((G_rest - mc) * [0.6, 1, 1], axis=1)
        bump = np.maximum(bump, np.exp(-(dd / 0.009) ** 2))
    # palm side (synthetic suede reinforcement): palm + finger pads
    palmm = sstep(0.0, -0.006, hx) * (1 - sstep(0.0, 0.02, -G_rest[:, 1]) * 0 )
    # gauntlet: from the wrist crease up the forearm, with a hook-and-loop strap
    gh = (G_rest @ Rh.T) @ yax                                 # rest height above the wrist joint (hand frame -> model axis)
    gaunt = sstep(-0.01, 0.03, gh)
    strap = np.exp(-((gh - 0.045) / 0.011) ** 4)
    # fingertips: glove fingers end a little past the finger
    tipw = np.zeros(len(G))
    for f in (1, 2, 3, 4, 5):
        b = f'finger{f}-3.{sd}'
        if b in Gw:
            idx, w = Gw[b]
            tl = hs(T[b]); hd = hs(H[b])
            along = (G_rest[idx] - hd) @ unit(tl - hd) / (np.linalg.norm(tl - hd) + 1e-9)
            tipw[idx] = np.maximum(tipw[idx], w * sstep(0.55, 1.0, along))
    off = (GLOVE_T + 0.0011 * tipw + 0.0024 * padm + 0.0016 * padm * bump + 0.0006 * palmm * (1 - fingerw)
           + gaunt * 0.0022 + strap * 0.0016 * gaunt)
    # side seams pinch the fabric a little
    off -= 0.0004 * np.exp(-(seam / 0.0012) ** 2) * (fingerw + thumbw > 0.3)
    Gd = Gg + nG * off[:, None]
    # fabric wrinkles across the finger joints (inside of the bends) and over the back of the wrist
    nb_ = nbg
    Gd = smooth(Gd, nb_, 1, 0.3)
    # glove aux: AO from contact with the rifle and cavities, seam field, pad, palm
    contact = np.clip(1 - rifle_sdf(Gd) / 0.012, 0, 1)
    lap = np.array([Gd[n].mean(0) if len(n) else Gd[i] for i, n in enumerate(nb_)]) - Gd
    nG2 = normals(Gd, Fg)
    cav = np.clip(np.sum(lap * nG2, 1) / 0.0015, 0, 1)
    ao_g = np.clip(1 - 0.45 * contact - 0.35 * cav, 0.25, 1)
    seam_f = np.clip(0.5 + seam * 30, 0, 1)
    # strip outline seam rides in the pad channel: pad_d signed distance (0 at the outline)
    pad_f = np.clip(0.5 + pad_d * 30, 0, 1)
    aux_g = np.column_stack([ao_g, seam_f, pad_f, np.clip(palmm, 0, 1)])
    uv_g = np.column_stack([G_rest[:, 2] + 0.4 * G_rest[:, 0], G_rest[:, 1]])

    # ---------------------------------------------------------------- sleeve dressing (rest space fields, gun normals)
    Fs = tri(sq)
    nbs_ = nbrs(len(Sg), sq)
    nS = normals(Sg, Fs)
    nS = smooth(nS, nbs_, 3, 0.5)
    nS /= np.linalg.norm(nS, axis=1, keepdims=True) + 1e-12
    th_ = (S_rest @ Rh.T) @ yax                                # height above the wrist (rest)
    # angle around the forearm (rest): reference = back of the hand
    ref = unit(Rh @ np.array([S, 0, 0.0]) - (Rh @ np.array([S, 0, 0.0]) @ yax) * yax)
    ref2 = np.cross(yax, ref)
    rad = (S_rest @ Rh.T) - np.outer(th_, yax)
    ang = np.arctan2(rad @ ref2, rad @ ref)
    u = th_ - T_CUFF                                          # distance from the sleeve edge
    cuffb = 1 - sstep(0.03, 0.04, u)                          # cuff band (snug, 3.5 cm)
    body = 1 - cuffb
    rng = np.random.RandomState(7 if sd == 'R' else 11)
    folds = np.zeros(len(Sg))
    # bunched rings behind the cuff (sleeve pushed up against the glove), diagonal and irregular
    bunch = sstep(0.03, 0.05, u) * (1 - sstep(0.11, 0.2, u))
    for k in range(5):
        ph, fr, sk = rng.uniform(0, 6.28), rng.uniform(26, 38), rng.uniform(-0.9, 0.9)
        folds += 0.0021 * bunch * np.sin(u * fr * 2 * np.pi / 1.0 * 0.95 + sk * ang + ph) * (0.6 + 0.4 * np.cos(ang * (k % 3 + 1) + ph))
    # long drape folds on the forearm: a few gaussian ridges along the arm at random angles, twisting slightly
    for k in range(6):
        a0, wdt, amp, tw = rng.uniform(-np.pi, np.pi), rng.uniform(0.25, 0.45), rng.uniform(0.0016, 0.0032), rng.uniform(-3, 3)
        da = np.angle(np.exp(1j * (ang - a0 - tw * u)))
        folds += amp * np.exp(-(da / wdt) ** 2) * sstep(0.04, 0.09, u) * (0.6 + 0.4 * np.sin(u * 20 + k))
    # gravity sag: extra slack on the underside
    under = np.clip(-(nS @ np.array([0, 1.0, 0])), 0, 1)
    off_s = body * (0.0125 + 0.004 * sstep(0.04, 0.2, u)) + cuffb * 0.0068 + folds * body + 0.003 * under * body
    # cuff: rolled hem at the edge, stitch line 9 mm in, a tab with hook-and-loop on the outer side
    hem = np.exp(-((u - 0.004) / 0.004) ** 2)
    off_s += 0.0012 * hem
    tab_ang = 1.9 * S
    da_tab = np.angle(np.exp(1j * (ang - tab_ang)))
    tab_d = np.maximum(np.abs(da_tab) * 0.045 - 0.011, u - 0.032)      # tab: 22 mm wide, 32 mm from the edge
    tab = 1 - sstep(-0.002, 0.0015, tab_d)
    off_s += 0.0018 * tab
    Sd = Sg + nS * off_s[:, None]
    Sd = smooth(Sd, nbs_, 2, 0.35)
    # aux: AO (folds' valleys, the cuff gap, contact), stitch field (hem stitch 9 mm from the edge + tab outline)
    lap = np.array([Sd[n].mean(0) if len(n) else Sd[i] for i, n in enumerate(nbs_)]) - Sd
    nS2 = normals(Sd, Fs)
    cav = np.clip(np.sum(lap * nS2, 1) / 0.0012, 0, 1)
    ao_s = np.clip(1 - 0.5 * cav - 0.25 * (1 - sstep(0.0, 0.012, u)) - 0.2 * np.clip(1 - rifle_sdf(Sd) / 0.02, 0, 1), 0.3, 1)
    stitch = np.minimum(np.abs(u - 0.009), np.abs(u - 0.033) * (1 + 0 * u))
    stitch_s = np.where(np.abs(u - 0.009) < np.abs(u - 0.033), u - 0.009, u - 0.033)
    stitch_s = np.where(tab > 0.01, np.minimum(np.abs(stitch_s), np.abs(tab_d + 0.0025)) * np.sign(stitch_s + 1e-9), stitch_s)
    aux_s = np.column_stack([ao_s, np.clip(0.5 + stitch_s * 30, 0, 1), np.clip(tab, 0, 1), np.zeros(len(Sd))])
    circ = 0.055                                               # sleeve circumference / 2 pi (UV metres)
    uv_s = np.column_stack([ang * circ, th_])

    # ---- inner lip at the cuff edge: the hem folded inward (cloth thickness), separate vertices -> crisp edge
    Fs_l = [list(q) for q in sq]
    edgec = {}
    for q in sq:
        for k in range(4):
            a, b = int(q[k]), int(q[(k + 1) % 4])
            e = (min(a, b), max(a, b))
            edgec[e] = edgec.get(e, []) + [(a, b)]
    bnd = [ab[0] for e, ab in edgec.items() if len(ab) == 1]
    bnd = [(a, b) for a, b in bnd if u[a] < 0.01 and u[b] < 0.01]
    lip_v, lip_n, lip_uv, lip_aux, lip_q = [], [], [], [], []
    base = len(Sd)
    vid = {}
    axis_g = fore_dir
    cen = Sd[[a for a, _ in bnd]].mean(0)

    def add(p, n, uv_, ax_):
        lip_v.append(p); lip_n.append(n); lip_uv.append(uv_); lip_aux.append(ax_)
        return base + len(lip_v) - 1
    for a, b in bnd:
        for x in (a, b):
            if x in vid:
                continue
            p = Sd[x]
            radial = p - cen - ((p - cen) @ axis_g) * axis_g
            rn = unit(radial)
            o0 = add(p, unit(-axis_g * 0.6 + rn * 0.4), uv_s[x], [0.6, 1, 0, 0])            # rim (rounded edge)
            o1 = add(p - rn * 0.003 + axis_g * 0.002, -axis_g, uv_s[x] + [0, -0.003], [0.35, 1, 0, 0])   # inside face
            o2 = add(p - rn * 0.0036 + axis_g * 0.014, -rn, uv_s[x] + [0, -0.015], [0.12, 1, 0, 0])      # into the sleeve
            vid[x] = (o0, o1, o2)
        A0, A1, A2 = vid[a]
        B0, B1, B2 = vid[b]
        lip_q += [[A0, B0, B1, A1][::-1], [A1, B1, B2, A2][::-1]]
    Sd_all = np.vstack([Sd, np.array(lip_v)]) if lip_v else Sd
    nS_all = np.vstack([normals(Sd, Fs), np.array(lip_n)]) if lip_v else normals(Sd, Fs)
    uv_all = np.vstack([uv_s, np.array(lip_uv)]) if lip_v else uv_s
    aux_all = np.vstack([aux_s, np.array(lip_aux)]) if lip_v else aux_s
    q_all = np.vstack([sq, np.array(lip_q)]) if lip_q else sq
    # lip winding: make each lip quad face along its stored vertex normals
    Fl = tri(q_all)
    fn = np.cross(Sd_all[Fl[:, 1]] - Sd_all[Fl[:, 0]], Sd_all[Fl[:, 2]] - Sd_all[Fl[:, 0]])
    flip = np.sum(fn * nS_all[Fl].mean(1), 1) < 0
    Fl[flip] = Fl[flip][:, ::-1]

    # ambient occlusion from the arm itself and the rifle (finger gaps, under the hand, the cuff over the glove)
    nGd = normals(Gd, Fg)
    occ = [(Gd, Fg), (Sd, Fs)]
    vis_g = bake_ao(Gd + nGd * 0.0005, nGd, occ)
    vis_s = bake_ao(Sd_all + nS_all * 0.0005, nS_all, occ)
    aux_g[:, 0] = np.clip(aux_g[:, 0] * (0.2 + 0.8 * vis_g ** 1.3), 0.08, 1)
    aux_all[:, 0] = np.clip(aux_all[:, 0] * (0.25 + 0.75 * vis_s ** 1.2), 0.1, 1)

    info = {
        'wrist': np.round(wr_g, 4).tolist(), 'forearm': np.round(fore_dir, 4).tolist(),
        'cuff': np.round(Sd[u < 0.004].mean(0), 4).tolist() if (u < 0.004).any() else None,
        'cuffR': round(float(np.median(np.linalg.norm((Sd[u < 0.004] - Sd[u < 0.004].mean(0)) - np.outer((Sd[u < 0.004] - Sd[u < 0.004].mean(0)) @ fore_dir, fore_dir), axis=1))), 4),
        'dorsal': np.round(unit(Rg @ np.array([S, 0, 0.0]) - (Rg @ np.array([S, 0, 0.0]) @ fore_dir) * fore_dir), 4).tolist(),
        'fit': {'thumb': round(float(e_th), 4), 'index': None if e_ix is None else round(float(e_ix), 4)},
    }
    return {
        'glove': (Gd, normals(Gd, Fg), uv_g, aux_g, Fg),
        'sleeve': (Sd_all, nS_all, uv_all, aux_all, Fl),
        'info': info,
    }


def lod_arrays(name, parts):
    """Concatenate material parts into one mesh with groups (glove, sleeve)."""
    P, N, UV, AX, I, groups = [], [], [], [], [], []
    base = 0
    start = 0
    for g in ('glove', 'sleeve'):
        V_, N_, UV_, AX_, F_ = parts[g]
        P.append(V_); N.append(N_); UV.append(UV_); AX.append(AX_)
        I.append(F_.ravel() + base)
        groups.append({'name': g, 'start': start, 'count': int(F_.size)})
        start += F_.size
        base += len(V_)
    P, N, UV, AX, I = np.vstack(P), np.vstack(N), np.vstack(UV), np.vstack(AX), np.concatenate(I)
    assert len(P) < 65536
    nq = np.clip(np.round(N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12) * 32767), -32767, 32767).astype(np.int16)
    return {
        'name': name, 'vertexCount': len(P), 'indexCount': len(I), 'groups': groups,
        '_arrays': {
            'position': (P.astype(np.float32), 'f32', 3, False),
            'normal': (nq, 'i16', 3, True),
            'uv': (UV.astype(np.float32), 'f32', 2, False),
            'aux': (np.round(np.clip(AX, 0, 1) * 255).astype(np.uint8), 'u8', 4, True),
        },
        '_index': I.astype(np.uint16),
    }


def main():
    B = bs.load_body()
    Wmh = mhio.load_weights(os.path.join(bs.SRC, 'default_weights.mhw'))
    pos, R, rest = bs.game_skeleton(B)
    W = bs.game_weights(len(B['v']), Wmh)
    arms = {sd: build_arm(B, W, Wmh, pos, R, sd) for sd in ('R', 'L')}
    lods = [lod_arrays('right', arms['R']), lod_arrays('left', arms['L'])]
    tris = {L['name']: L['indexCount'] // 3 for L in lods}
    header = {
        'source': 'MakeHuman hm08 base mesh hands / forearms, default skeleton weights and macro targets (CC0 1.0); '
                  'see docs/ASSETS.md',
        'space': 'gun space of game/src/viewmodel/rifle.js (metres)',
        'info': {'right': arms['R']['info'], 'left': arms['L']['info']}, 'triangles': tris,
    }
    data = bs.pack(lods, header)
    open(OUT, 'wb').write(data)
    print('wrote', os.path.relpath(OUT), len(data), 'bytes', tris, 'total', sum(tris.values()))
    print(json.dumps(header['info']))


if __name__ == '__main__':
    main()
