#!/usr/bin/env python3
"""Offline build: MakeHuman CC0 base mesh -> game soldier body (game/assets/models/soldier_body.bin).

Usage:  python3 tools/mh/build_soldier.py [--preview DIR]

Inputs (all CC0 1.0, see tools/mh/sources/SOURCES.md): the hm08 base mesh, the default skeleton + weights and a
handful of macro targets. Nothing from the MakeHuman program source (AGPL) is used; the readers and every processing
step below are own code.

Pipeline
 1. targets: young adult caucasian male, muscle 0.70 / weight 0.40 (bilinear mix of the universal macro targets),
    50 % 'ideal proportions'
 2. helper geometry dropped (tights, skirt, hair, teeth, tongue, lashes, joint cubes); the two eyeball helpers are kept
 3. units: decimetres -> metres, scaled to a 1.79 m stature, turned to face -Z (game convention), soles on y = 0
 4. skeleton: the 19 game bones are placed on MakeHuman joints. The mesh stays in MakeHuman's A pose, which becomes the
    *bind* pose: per bone a bind orientation is exported (limb along local -Y, elbow / knee pole on local +-Z, palm on
    -X*side) and the game's identity rest pose (arms hanging, legs straight) is derived from it, so the existing
    pose / IK code keeps working unchanged
 5. hands: fingers and thumb are curled (offline linear-blend skinning with the MakeHuman finger bones) around the
    rifle grip axis the game's hand frames expect
 6. clothing: per-vertex offsets along smoothed normals - jacket, trousers bloused over the boots, boots (toes
    smoothed away, flat sole), gloves, balaclava over a smoothed head with an eye opening (skin) - plus fabric folds
 7. weights: MakeHuman's 160-bone weights summed onto the 19 game bones, 4 influences
 8. triangulated, decimated (quadric half-edge collapse) to the close-range budget, plus a far LOD
"""
import argparse
import heapq
import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mhio  # noqa: E402

SRC = os.path.join(HERE, 'sources')
OUT = os.path.join(HERE, '..', '..', 'game', 'assets', 'models', 'soldier_body.bin')

STATURE = 1.79
MUSCLE, WEIGHT, PROPORTION = 0.70, 0.40, 0.5

# game skeleton (names / parents identical to game/src/characters/soldier.js BONE_DEFS)
GAME_BONES = [
    ('hips', -1), ('spine', 0), ('chest', 1), ('neck', 2), ('head', 3),
    ('clavR', 2), ('uarmR', 5), ('farmR', 6), ('handR', 7),
    ('clavL', 2), ('uarmL', 9), ('farmL', 10), ('handL', 11),
    ('thighR', 0), ('shinR', 13), ('footR', 14),
    ('thighL', 0), ('shinL', 16), ('footL', 17),
]
GI = {n: i for i, (n, _) in enumerate(GAME_BONES)}


def mh_to_game_bone(b):
    """MakeHuman bone name -> game bone name (weights are summed per game bone)."""
    s = b.split('.')
    side = ('R' if s[1] == 'R' else 'L') if len(s) > 1 else ''
    n = s[0]
    if n in ('root', 'spine05') or n.startswith('pelvis'):
        return 'hips'
    if n in ('spine04', 'spine03'):
        return 'spine'
    if n in ('spine02', 'spine01', 'breast'):
        return 'chest'
    if n.startswith('neck'):
        return 'neck'
    if n in ('clavicle', 'shoulder01'):
        return 'clav' + side
    if n.startswith('upperarm'):
        return 'uarm' + side
    if n.startswith('lowerarm'):
        return 'farm' + side
    if n in ('wrist',) or n.startswith('metacarpal') or n.startswith('finger'):
        return 'hand' + side
    if n.startswith('upperleg'):
        return 'thigh' + side
    if n.startswith('lowerleg'):
        return 'shin' + side
    if n == 'foot' or n.startswith('toe'):
        return 'foot' + side
    return 'head'   # head, jaw, eyes, face muscles, tongue


def unit(v):
    return v / (np.linalg.norm(v) + 1e-12)


def rot_axis(axis, ang):
    a = unit(axis)
    x, y, z = a
    c, s = np.cos(ang), np.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def mat_to_quat(m):
    t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        return [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    i = int(np.argmax([m[0, 0], m[1, 1], m[2, 2]]))
    if i == 0:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        return [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    if i == 1:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        return [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
    return [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]


# ------------------------------------------------------------------------------------------------ 1-3 base body
def load_body():
    o = mhio.load_obj(os.path.join(SRC, 'base.obj'))
    v = o['v'].copy()

    def add(name, w):
        if w <= 0:
            return
        i, d = mhio.load_target(os.path.join(SRC, 'targets', name))
        v[i] += w * d

    add('caucasian-male-young.target', 1.0)
    m = (MUSCLE - 0.5) / 0.5            # 0 = average muscle, 1 = max muscle
    w = (0.5 - WEIGHT) / 0.5            # 0 = average weight, 1 = min weight
    # bilinear corners (average/average is the zero target)
    add('universal-male-young-maxmuscle-averageweight.target', m * (1 - w))
    add('universal-male-young-averagemuscle-minweight.target', (1 - m) * w)
    add('universal-male-young-maxmuscle-minweight.target', m * w)
    for mm, wm, k in (('averagemuscle', 'averageweight', (1 - m) * (1 - w)), ('maxmuscle', 'averageweight', m * (1 - w)),
                      ('averagemuscle', 'minweight', (1 - m) * w), ('maxmuscle', 'minweight', m * w)):
        add(f'male-young-{mm}-{wm}-idealproportions.target', PROPORTION * k)

    groups = o['groups']
    keep = {'body': 'body', 'helper-l-eye': 'eyeL', 'helper-r-eye': 'eyeR'}
    fsel = [i for i, g in enumerate(o['fgrp']) if groups[g] in keep]
    faces = [o['f'][i] for i in fsel]
    fuv = [o['fuv'][i] for i in fsel]
    fkind = [keep[groups[o['fgrp'][i]]] for i in fsel]
    bones, joints = mhio.load_skeleton(os.path.join(SRC, 'default.mhskel'))
    J = {k: v[ix].mean(0) for k, ix in joints.items()}
    bodyv = np.unique(np.concatenate([np.array(f) for f, k in zip(faces, fkind) if k == 'body']))
    top, bot = v[bodyv, 1].max(), v[bodyv, 1].min()
    s = STATURE / (top - bot)

    def tf(p):
        p = np.asarray(p, dtype=np.float64)
        q = p.copy()
        q[..., 0] = -p[..., 0] * s
        q[..., 1] = (p[..., 1] - bot) * s
        q[..., 2] = -p[..., 2] * s
        return q

    v = tf(v)
    J = {k: tf(p) for k, p in J.items()}
    H = {b: J[d['head']] for b, d in bones.items()}
    T = {b: J[d['tail']] for b, d in bones.items()}
    # centre: ankles at z = 0, body on x = 0
    dz = -(H['foot.R'][2] + H['foot.L'][2]) / 2
    v[:, 2] += dz
    for D in (H, T):
        for k in D:
            D[k] = D[k] + [0, 0, dz]
    return {'v': v, 'vt': o['vt'], 'faces': faces, 'fuv': fuv, 'fkind': fkind, 'bones': bones, 'H': H, 'T': T}


# ------------------------------------------------------------------------------------------------ 4 game skeleton
def game_skeleton(B):
    H, T = B['H'], B['T']
    pos = {}       # bind (A pose) joint positions, model space
    R = {}         # bind orientation (columns = local axes in model space)
    I3 = np.eye(3)
    pos['hips'] = np.array([0, H['spine05'][1], H['spine05'][2]])
    pos['spine'] = np.array([0, H['spine03'][1], H['spine03'][2]])
    pos['chest'] = np.array([0, H['spine01'][1], H['spine01'][2]])
    pos['neck'] = np.array([0, H['neck01'][1], H['neck01'][2]])
    pos['head'] = np.array([0, H['head'][1], H['head'][2]])
    for n in ('hips', 'spine', 'chest', 'neck', 'head'):
        R[n] = I3
    for sd, S in (('R', 1), ('L', -1)):
        pos['clav' + sd] = H['clavicle.' + sd]
        R['clav' + sd] = I3
        sh, el, wr = H['upperarm01.' + sd], H['lowerarm01.' + sd], H['wrist.' + sd]
        pos['uarm' + sd], pos['farm' + sd], pos['hand' + sd] = sh, el, wr
        yu = -unit(el - sh)
        fd = unit(wr - el)
        z = -(fd - yu * 0 - (fd @ -yu) * -yu)       # forearm flexes toward local -Z
        z = unit(z - (z @ yu) * yu)
        if np.linalg.norm(fd + yu) < 0.05:          # nearly straight: elbow pole backwards
            z = unit(np.array([0, 0, 1.0]) - yu[2] * yu)
        x = unit(np.cross(yu, z))
        z = np.cross(x, yu)
        R['uarm' + sd] = np.stack([x, yu, z], 1)
        yf = -fd
        zf = unit(z - (z @ yf) * yf)
        xf = unit(np.cross(yf, zf))
        R['farm' + sd] = np.stack([xf, yf, np.cross(xf, yf)], 1)
        # hand: -Y along the hand (wrist -> middle knuckle), palm faces -X*side, thumb side -Z
        mid = H['finger3-1.' + sd]
        yh = -unit(mid - wr)
        a, b = H['finger2-1.' + sd], H['finger5-1.' + sd]   # index / little knuckles
        across = unit(b - a)                               # thumb side -> little finger side = +Z
        zh = unit(across - (across @ yh) * yh)
        xh = unit(np.cross(yh, zh))
        R['hand' + sd] = np.stack([xh, yh, zh], 1)
        # legs
        hp, kn, an = H['upperleg01.' + sd], H['lowerleg01.' + sd], H['foot.' + sd]
        pos['thigh' + sd], pos['shin' + sd], pos['foot' + sd] = hp, kn, an
        yt = -unit(kn - hp)
        fwd = np.array([0, 0, -1.0])
        zt = -unit(fwd - (fwd @ yt) * yt)                 # local -Z = knee forward
        xt = unit(np.cross(yt, zt))
        R['thigh' + sd] = np.stack([xt, yt, np.cross(xt, yt)], 1)
        ys = -unit(an - kn)
        zs = unit(R['thigh' + sd][:, 2] - (R['thigh' + sd][:, 2] @ ys) * ys)
        xs = unit(np.cross(ys, zs))
        R['shin' + sd] = np.stack([xs, ys, np.cross(xs, ys)], 1)
        toes = (H['toe2-1.' + sd] + H['toe3-1.' + sd]) / 2
        f = toes - an
        f[1] = 0
        zf_ = -unit(f)                                     # foot points along local -Z
        yfo = np.array([0, 1.0, 0])
        xfo = unit(np.cross(yfo, zf_))
        R['foot' + sd] = np.stack([xfo, yfo, np.cross(xfo, yfo)], 1)
    # identity rest positions: p_i = p_parent + R_parent^T (J_i - J_parent)
    rest = {}
    for n, p in GAME_BONES:
        if p < 0:
            rest[n] = pos[n].copy()
        else:
            pn = GAME_BONES[p][0]
            rest[n] = rest[pn] + R[pn].T @ (pos[n] - pos[pn])
    return pos, R, rest


# ------------------------------------------------------------------------------------------------ 5 grip
GRIP_R, GRIP_T = 0.019, 0.0095      # grip radius (AK pistol grip ~32 x 44 mm), finger half thickness


def chain_xf(heads, rots):
    """Forward kinematics of a joint chain in rest space: rotation r_k about joint k. Returns [(A_k, p_k, q_k)]:
    a point x bound to bone k moves to A_k (x - p_k) + q_k."""
    out = []
    A = np.eye(3)
    q = None
    for k, (p, r) in enumerate(zip(heads, rots)):
        q = p.copy() if k == 0 else out[-1][0] @ (p - heads[k - 1]) + out[-1][2]
        A = A @ r
        out.append((A.copy(), p, q))
    return out


def curl_hands(B, R, pos, weights):
    """Bake a closed rifle grip: rotate finger / thumb vertices (LBS with the MakeHuman finger weights) so the fingers
    wrap a cylinder along the hand's local Z axis. Returns the grip centre per hand in game hand space."""
    v = B['v']
    H, T = B['H'], B['T']
    out = v.copy()
    grips = {}
    for sd, S in (('R', 1), ('L', -1)):
        Rh, wr = R['hand' + sd], pos['hand' + sd]
        hs = lambda p: (p - wr) @ Rh                       # model -> hand space
        mcp3 = hs(H['finger3-1.' + sd])
        c = np.array([-(0.016 + GRIP_R) * S, mcp3[1] - 0.012, 0.0])
        grips[sd] = c
        D = GRIP_R + GRIP_T
        Z = np.array([0, 0, 1.0])
        moves = []                                          # (bone, A, p, q) in hand space
        for f in (2, 3, 4, 5):
            chain = [f'finger{f}-{k}.{sd}' for k in (1, 2, 3)]
            heads = [hs(H[b]) for b in chain]
            tails = [hs(T[b]) for b in chain]
            rots = []
            for k in range(3):
                best = None
                for th in np.linspace(0, 1.9, 96):
                    r = rot_axis(Z, -th * S)
                    xf = chain_xf(heads[:k + 1], rots + [r])
                    A, p, q = xf[-1]
                    e = A @ (tails[k] - p) + q
                    d = np.hypot(e[0] - c[0], e[1] - c[1])
                    err = d - D * (0.92 if k == 2 else 1.0)
                    if err <= 0:                            # first contact while closing the hand
                        best = (0, r)
                        break
                    if best is None or err < best[0]:
                        best = (err, r)
                rots.append(best[1])
            for b, (A, p, q) in zip(chain, chain_xf(heads, rots)):
                moves.append((b, A, p, q))
        # thumb: CMC swing (about hand X and Y) + MCP / IP flexion, tip wrapped over the index / middle fingers
        chain = [f'finger1-{k}.{sd}' for k in (1, 2, 3)]
        heads = [hs(H[b]) for b in chain]
        tip = hs(T[chain[2]])
        target = np.array([c[0] - (GRIP_R + 0.004) * S, c[1] + 0.004, -0.018])
        best = None
        for ph in np.linspace(-1.4, 1.4, 29):
            for ps in np.linspace(-1.2, 1.2, 25):
                for fl in np.linspace(-0.6, 0.6, 7):
                    r0 = rot_axis([1, 0, 0], ph) @ rot_axis([0, 1, 0], ps)
                    td = heads[2] - heads[1]
                    ax = unit(np.cross(td, [-S, 0, 0]))
                    rf = rot_axis(ax, fl)
                    xf = chain_xf(heads, [r0, rf, rf])
                    A, p, q = xf[-1]
                    e = A @ (tip - p) + q
                    err = np.linalg.norm(e - target)
                    # keep the thumb joints outside the grip
                    for (A2, p2, q2) in xf[1:]:
                        dd = np.hypot(q2[0] - c[0], q2[1] - c[1])
                        if dd < D:
                            err += (D - dd) * 4
                    if best is None or err < best[0]:
                        best = (err, xf)
        for b, (A, p, q) in zip(chain, best[1]):
            moves.append((b, A, p, q))
        # apply (hand space -> model space)
        for b, A, p, q in moves:
            idx, w = weights[b]
            x = (v[idx] - wr) @ Rh
            nx = (A @ (x - p).T).T + q
            out[idx] += w[:, None] * ((nx - x) @ Rh.T)
    B['v'] = out
    return grips


# ------------------------------------------------------------------------------------------------ 6 weights
def game_weights(nv, weights):
    W = np.zeros((nv, len(GAME_BONES)))
    for b, (idx, w) in weights.items():
        W[idx, GI[mh_to_game_bone(b)]] += w
    s = W.sum(1)
    W[s < 1e-6, GI['head']] = 1          # unweighted helper vertices (not used by the body)
    return W / W.sum(1, keepdims=True)


def soften_wrists(B, W, pos, R):
    """Spread the hand / forearm weight transition over ~9 cm around the wrist (MakeHuman's is ~3 cm, which pinches
    the wrist when the hand bends or twists on the 19-bone game skeleton). Only the hand + forearm share is
    redistributed; finger-curl geometry is unaffected (all of it is hand-weighted)."""
    v = B['v']
    W = W.copy()
    for sd in ('R', 'L'):
        ih, if_ = GI['hand' + sd], GI['farm' + sd]
        tot = W[:, ih] + W[:, if_]
        t = (v - pos['hand' + sd]) @ R['farm' + sd][:, 1]          # + toward the elbow
        m = (tot > 0.5) & (t > -0.035) & (t < 0.07)
        hw = 1 - sstep(-0.03, 0.06, t[m])
        hw = np.maximum(hw, np.where(t[m] < -0.012, W[m, ih] / tot[m], 0))   # palm stays on the hand
        W[m, ih], W[m, if_] = tot[m] * hw, tot[m] * (1 - hw)
    return W


# ------------------------------------------------------------------------------------------------ mesh helpers
def tri_faces(faces):
    out = []
    for f in faces:
        out.append((f[0], f[1], f[2]))
        if len(f) == 4:
            out.append((f[0], f[2], f[3]))
    return np.array(out, dtype=np.int64)


def vertex_normals(v, F):
    n = np.zeros_like(v)
    fn = np.cross(v[F[:, 1]] - v[F[:, 0]], v[F[:, 2]] - v[F[:, 0]])
    for k in range(3):
        np.add.at(n, F[:, k], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def neighbours(nv, faces):
    nb = [set() for _ in range(nv)]
    for f in faces:
        m = len(f)
        for k in range(m):
            a, b = f[k], f[(k + 1) % m]
            nb[a].add(b)
            nb[b].add(a)
    return [np.array(sorted(x), dtype=np.int64) for x in nb]


def smooth_field(x, nb, verts, it, lam=0.5, mask=None):
    """Laplacian smoothing of a per-vertex field (positions or normals) on `verts`; mask (0..1) scales the step."""
    x = x.copy()
    for _ in range(it):
        avg = np.array([x[nb[i]].mean(0) if len(nb[i]) else x[i] for i in verts])
        step = lam * (avg - x[verts])
        if mask is not None:
            step *= mask[verts][:, None]
        x[verts] += step
    return x


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------------ 7 clothing
def dress(B, W, pos, R):
    """Offsets the skin into a clothed figure and assigns a material per face. Works in the bind (A) pose."""
    v = B['v']
    v0 = v.copy()                                   # undressed body (bare-head variant of the Swedish soldiers)
    faces, fkind = B['faces'], B['fkind']
    body = [f for f, k in zip(faces, fkind) if k == 'body']
    bv = np.unique(np.concatenate([np.array(f) for f in body]))
    nb = neighbours(len(v), body)
    F = tri_faces(body)
    H = B['H']
    gw = lambda n: W[:, GI[n]]
    side = np.sign(v[:, 0])
    eyeY = (H['eye.R'][1] + H['eye.L'][1]) / 2
    eyeZ = (H['eye.R'][2] + H['eye.L'][2]) / 2
    headC = (H['head'] + B['T']['head']) / 2

    # --- region fields (per vertex)
    hand = gw('handR') + gw('handL')
    foot = gw('footR') + gw('footL')
    headw = gw('head') + gw('neck')
    # height above the wrist along the forearm (glove cuff / sleeve cuff)
    above_wrist = np.full(len(v), 9.0)
    for sd in ('R', 'L'):
        m = (gw('farm' + sd) + gw('hand' + sd)) > 0.05
        yax = R['farm' + sd][:, 1]                        # points from the wrist toward the elbow
        above_wrist[m] = (v[m] - pos['hand' + sd]) @ yax
    collar_y = 1.505 + 0.45 * np.clip(v[:, 2] + 0.07, 0, 0.14)
    is_head = (v[:, 1] > collar_y) & (headw > 0.35) & (np.abs(v[:, 0]) < 0.11)
    ex = v[:, 0] / 0.066
    ey = (v[:, 1] - (eyeY + 0.003)) / 0.0235
    eye_open = (ex ** 2 + ey ** 2 < 1) & (v[:, 2] < eyeZ + 0.03) & is_head
    eye_open &= ~((np.abs(v[:, 0]) < 0.016) & (v[:, 1] < eyeY - 0.004))    # knit stays over the nose bridge
    is_glove = above_wrist < 0.045
    BOOT_TOP = 0.205
    HEM_Y = 0.905
    is_boot = (v[:, 1] < BOOT_TOP) & (foot + gw('shinR') + gw('shinL') > 0.5) & ~is_head

    # face material: majority of corners
    fmat = []
    for f, k in zip(faces, fkind):
        if k != 'body':
            fmat.append('eye')             # eyeballs (seen through the tinted shooting glasses)
            continue
        f = np.array(f)
        if eye_open[f].sum() * 2 > len(f):
            fmat.append('skin')
        elif is_head[f].sum() * 2 > len(f):
            fmat.append('knit')
        elif is_glove[f].sum() * 2 > len(f):
            fmat.append('glove')
        elif is_boot[f].sum() * 2 > len(f):
            fmat.append('boot')
        else:
            fmat.append('camo')
    fmat = np.array(fmat)
    # per-vertex material membership (for offsets: a vertex on a border takes the larger offset of its faces)
    vmat = {k: np.zeros(len(v), bool) for k in ('skin', 'knit', 'glove', 'boot', 'camo')}
    for f, m in zip(faces, fmat):
        if m in vmat:
            vmat[m][np.array(f)] = True

    # --- shape edits before offsetting
    # ears flattened under the knit, lips / nostrils softened, toes merged into a boot toe box
    ear = np.zeros(len(v))
    for sd in ('R', 'L'):
        ec = np.array([0.075 * (1 if sd == 'R' else -1), eyeY - 0.012, headC[2] + 0.012])
        d = np.linalg.norm((v - ec) * [0.6, 1, 1], axis=1)
        ear = np.maximum(ear, 1 - sstep(0.025, 0.05, d))
    ear *= (np.abs(v[:, 0]) > 0.045)
    mouth = (1 - sstep(0.03, 0.055, np.linalg.norm((v - [0, eyeY - 0.088, eyeZ - 0.02]) * [0.6, 1, 1], axis=1))) * (v[:, 2] < eyeZ)
    nose_tip = (1 - sstep(0.012, 0.035, np.linalg.norm(v - [0, eyeY - 0.045, eyeZ - 0.07], axis=1)))
    toe = sstep(0.06, 0.14, -(v[:, 2] - 0.0)) * (v[:, 1] < 0.09) * (foot > 0.5)
    mask = np.clip(ear * 1.0 + mouth * 1.0 + nose_tip * 0.8, 0, 1)
    v = smooth_field(v, nb, bv, 40, 0.5, mask)
    # balaclava shell: knit is ~5 mm thick and stretches over the face instead of following it. Lips, philtrum, nostrils
    # and nose tip are smoothed away (Taubin, no shrinkage), then concave spots are bridged (local hull, 2.5 cm)
    knit_v = is_head & ~eye_open
    lowface = knit_v * (1 - sstep(eyeY - 0.03, eyeY - 0.01, v[:, 1])) * (v[:, 2] < eyeZ + 0.035)
    km = np.clip(mouth * 1.0 + nose_tip * 1.0 + 0.7 * lowface, 0, 1) * knit_v
    kv = bv[km[bv] > 0]
    for _ in range(45):
        v = smooth_field(v, nb, kv, 1, 0.6, km)
        v = smooth_field(v, nb, kv, 1, -0.62, km)
    nn_ = vertex_normals(v, F)
    nn_ = smooth_field(nn_, nb, bv, 4, 0.5)
    nn_ /= np.linalg.norm(nn_, axis=1, keepdims=True) + 1e-12
    hk = np.where(knit_v)[0]
    if len(hk):
        P, Nn = v[hk], nn_[hk]
        lift_k = np.zeros(len(hk))
        for a0 in range(0, len(hk), 512):
            pa, na = P[a0:a0 + 512], Nn[a0:a0 + 512]
            dd = P[None, :, :] - pa[:, None, :]
            dist = np.linalg.norm(dd, axis=2)
            hh = np.einsum('ijk,ik->ij', dd, na)
            hh = np.where(dist < 0.025, hh * (1 - dist / 0.025) * 1.5, 0)
            lift_k[a0:a0 + 512] = np.clip(hh.max(1), 0, 0.006)
        v[hk] += Nn * lift_k[:, None]
    # boot toe box: Taubin smoothing (no shrinkage) of the whole foot below the ankle, strongest over the toes
    fm = np.clip((foot > 0.3) * (1 - sstep(0.07, 0.12, v[:, 1])) * (0.5 + toe), 0, 1)
    fv = bv[fm[bv] > 0]
    tm = np.clip(toe * (foot > 0.3), 0, 1)
    v = smooth_field(v, nb, bv[tm[bv] > 0], 80, 0.6, tm)     # close the gaps between the toes
    for _ in range(120):
        v = smooth_field(v, nb, fv, 1, 0.55, fm)
        v = smooth_field(v, nb, fv, 1, -0.58, fm)
    # boot shell: push every foot vertex out to the foot's supporting plane along its (heavily smoothed) normal, which
    # fills the toe gaps and the arch like a convex hull; then a taller, rounded toe box and a flat, slightly wider sole
    for sd, S_ in (('R', 1), ('L', -1)):
        fw = gw('foot' + sd) + gw('shin' + sd) * (v[:, 1] < 0.14)
        m = (fw > 0.3) & (v[:, 1] < 0.15) & (S_ * v[:, 0] > 0)
        idx = np.where(m)[0]
        if not len(idx):
            continue
        nn = vertex_normals(v, F)
        nn = smooth_field(nn, nb, idx, 25, 0.5)
        nn = nn[idx] / (np.linalg.norm(nn[idx], axis=1, keepdims=True) + 1e-12)
        P = v[idx]
        sup = (nn @ P.T).max(1)                       # support of the whole foot in each vertex's normal direction
        push = np.clip(sup - np.sum(nn * P, 1), 0, 0.03)
        blend = 1 - sstep(0.09, 0.15, P[:, 1])
        v[idx] += nn * (push * blend)[:, None]
        # toe box: lift the top of the forefoot, round the toe
        lf = (v[idx] - pos['foot' + sd]) @ R['foot' + sd]   # foot frame: -Z forward, +Y up
        fwd = sstep(0.05, 0.16, -lf[:, 2])
        top = np.clip(nn[:, 1], 0, 1)
        v[idx, 1] += 0.012 * fwd * top * blend
    v = smooth_field(v, nb, fv, 6, 0.4, fm)

    n = vertex_normals(v, F)
    n = smooth_field(n, nb, bv, 6, 0.5)
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12

    # --- drape: cloth bridges the body's concavities (between / under the pectorals, the abdominal grooves, the spine
    # groove, the small of the back, the crotch). Each clothed vertex moves out to the local hull of its own body part
    # (radius 7 cm) along its normal; parts are kept apart so arms never web onto the torso.
    camo_v = vmat['camo'] & ~vmat['knit']
    domb = np.argmax(W, 1)
    part = np.full(len(v), -1)
    for k, names in enumerate((('hips', 'spine', 'chest', 'clavR', 'clavL', 'neck'), ('uarmR', 'farmR'), ('uarmL', 'farmL'),
                               ('thighR', 'shinR'), ('thighL', 'shinL'))):
        for nm in names:
            part[domb == GI[nm]] = k
    lift = np.zeros(len(v))
    for k in range(5):
        idx = np.where(camo_v & (part == k))[0]
        if not len(idx):
            continue
        P, Nn = v[idx], n[idx]
        for a0 in range(0, len(idx), 512):
            pa, na = P[a0:a0 + 512], Nn[a0:a0 + 512]
            d = P[None, :, :] - pa[:, None, :]                  # (a, all, 3)
            dist = np.linalg.norm(d, axis=2)
            h = np.einsum('ijk,ik->ij', d, na)                   # height of neighbours above the tangent plane
            h = np.where(dist < 0.07, h * (1 - dist / 0.07) * 1.6, 0)
            lift[idx[a0:a0 + 512]] = np.clip(h.max(1), 0, 0.03)
    lift = smooth_field(lift[:, None], nb, bv, 3, 0.5)[:, 0]
    v = v + n * (lift * 0.85)[:, None]
    n = vertex_normals(v, F)
    n = smooth_field(n, nb, bv, 6, 0.5)
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12

    # --- offsets (metres)
    y = v[:, 1]
    off = np.zeros(len(v))
    torso = (gw('hips') + gw('spine') + gw('chest') + gw('clavR') + gw('clavL')) 
    arm = gw('uarmR') + gw('uarmL') + gw('farmR') + gw('farmL')
    leg = gw('thighR') + gw('thighL') + gw('shinR') + gw('shinL')
    cam = np.where(vmat['camo'], 1.0, 0.0)
    upper = gw('uarmR') + gw('uarmL')
    off += cam * (0.019 * torso + 0.016 * upper + 0.014 * (arm - upper) + 0.018 * leg + 0.01 * hand + 0.014 * headw + 0.016 * foot)
    # jacket: hem stands proud of the trousers (the jacket is worn outside), slack over the lower back
    jacket = sstep(HEM_Y - 0.012, HEM_Y + 0.004, y) * (torso + upper > 0.3)
    off += cam * jacket * (0.008 + 0.006 * sstep(HEM_Y, HEM_Y + 0.05, y) * (1 - sstep(HEM_Y + 0.1, HEM_Y + 0.2, y)))
    off += cam * 0.005 * (v[:, 2] > 0.03) * sstep(HEM_Y, 1.05, y) * (1 - sstep(1.15, 1.3, y)) * torso
    cuff = sstep(0.045, 0.055, above_wrist) * (1 - sstep(0.07, 0.095, above_wrist))
    off += cam * cuff * 0.006
    blouse = sstep(BOOT_TOP, BOOT_TOP + 0.02, y) * (1 - sstep(BOOT_TOP + 0.05, BOOT_TOP + 0.11, y)) * leg
    off += cam * blouse * 0.022
    # collar: a raised band at the neck line
    collar = (1 - sstep(0.0, 0.035, collar_y - y)) * (y <= collar_y + 0.002) * (headw + torso > 0.5) * (np.abs(v[:, 0]) < 0.12)
    off += cam * collar * 0.013
    # knit: bridges over the lips / chin, hangs loose around the neck (with a few soft horizontal rings)
    neck_k = (1 - sstep(eyeY - 0.13, eyeY - 0.09, y)) * vmat['knit']
    off += np.where(vmat['knit'], 0.005 + 0.0015 * mouth + 0.009 * neck_k + 0.0025 * neck_k * np.cos((y - eyeY) * 2 * np.pi / 0.03), 0)
    # sewn crown seam (front to back over the top of the head) and soft creases where the knit gathers at the temples
    crown = vmat['knit'] * sstep(eyeY + 0.03, eyeY + 0.06, y)
    off += crown * 0.0016 * np.exp(-(v[:, 0] / 0.005) ** 2)
    temple = vmat['knit'] * np.exp(-((y - eyeY - 0.005) / 0.03) ** 2) * sstep(0.045, 0.07, np.abs(v[:, 0]))
    off += temple * 0.0012 * np.cos((v[:, 2] - eyeZ) * 2 * np.pi / 0.022)
    off += np.where(vmat['glove'] & ~vmat['camo'], 0.0028, 0)
    off += np.where(vmat['boot'] & ~vmat['camo'], 0.009 + 0.01 * toe, 0)
    # rolled knit hem around the eye opening
    if eye_open.any():
        d_open = np.full(len(v), 1.0)
        ring = np.where(vmat['knit'] & vmat['skin'])[0]
        if len(ring):
            P = v[ring]
            for i in np.where(is_head)[0]:
                d_open[i] = np.min(np.linalg.norm(P - v[i], axis=1))
        off += np.where(vmat['knit'], 0.0035 * (1 - sstep(0.0, 0.012, d_open)), 0)
        off = np.where(vmat['skin'] & ~vmat['knit'], 0.0, off)

    # --- fabric folds (normal displacement): elbow and knee creases, waist gathers, blouse ripples
    fold = np.zeros(len(v))
    for sd in ('R', 'L'):
        # elbow: rings around the arm on the inside of the bend
        h = (v - pos['farm' + sd]) @ R['uarm' + sd][:, 1]                       # + toward the shoulder
        zax = R['uarm' + sd][:, 2]                                               # + = back of the elbow
        rad = v - pos['farm' + sd] - np.outer(h, R['uarm' + sd][:, 1])
        inner = -(rad @ zax) / (np.linalg.norm(rad, axis=1) + 1e-9)
        m = arm > 0.3
        env = np.exp(-(h / 0.07) ** 2) * (0.35 + 0.65 * np.clip(inner, 0, 1))
        fold += m * cam * env * 0.0035 * np.cos(h / 0.045 * 2 * np.pi + 1.3 * inner)
        # knee: creases behind and above the knee
        h = (v - pos['shin' + sd]) @ R['thigh' + sd][:, 1]
        m = leg > 0.3
        env = np.exp(-((h - 0.02) / 0.08) ** 2)
        fold += m * cam * env * 0.003 * np.cos(h / 0.05 * 2 * np.pi + 3 * v[:, 0])
    ang = np.arctan2(v[:, 2], v[:, 0] - side * 0.11)
    fold += cam * blouse * 0.006 * np.cos(ang * 7 + y * 40)
    fold += cam * torso * np.exp(-((y - 1.0) / 0.05) ** 2) * 0.0025 * np.cos(np.arctan2(v[:, 2], v[:, 0]) * 9 + y * 30)
    # loose diagonal drape on the trouser legs and the back of the jacket
    fold += cam * leg * 0.0018 * np.sin(y * 55 + ang * 2.0) * sstep(0.3, 0.6, y)
    fold += cam * torso * 0.0015 * np.sin(y * 45 + v[:, 0] * 30) * (v[:, 2] > 0)
    off += fold

    v2 = v + n * off[:, None]
    # boots: flat sole and a protruding welt
    bootv = vmat['boot'] & ~vmat['camo']
    low = bootv & (v2[:, 1] < 0.03)
    hor = n.copy(); hor[:, 1] = 0
    hor /= np.linalg.norm(hor, axis=1, keepdims=True) + 1e-9
    v2[low] += hor[low] * (0.004 * (1 - sstep(0.012, 0.03, v2[low, 1])))[:, None]
    v2[bootv, 1] = np.maximum(v2[bootv, 1], 0.0)
    v2[bootv & (v2[:, 1] < 0.012), 1] = 0.0
    # toe box: a last Taubin pass over the upper boot toe removes the faint toe ridges the offset brings back
    tb = bootv & (v2[:, 1] > 0.014) & (toe > 0.05)
    tw_ = np.clip(toe * 1.2, 0, 1) * tb
    tbv = np.where(tb)[0]
    for _ in range(40):
        v2 = smooth_field(v2, nb, tbv, 1, 0.6, tw_)
        v2 = smooth_field(v2, nb, tbv, 1, -0.63, tw_)
    # rubber sole: boot faces along the bottom edge
    for i, (f, m) in enumerate(zip(faces, fmat)):
        if m == 'boot' and v2[np.array(f), 1].max() < 0.024:
            fmat[i] = 'sole'
    fmat = list(fmat)

    # --- bare-head variant for the Swedish soldiers (no balaclava): the undressed MakeHuman head and neck as 'face'
    # (same skin material), plus a short-hair shell over the scalp as 'hair'. Both are appended as separate vertices;
    # soldier.js uses either knit + skin (OPFOR) or face + hair (Home Guard).
    headf = [i for i, m in enumerate(fmat) if m in ('knit', 'skin')]
    hv_ = np.unique(np.concatenate([np.array(faces[i]) for i in headf]))
    n0 = vertex_normals(v0, F)
    n0 = smooth_field(n0, nb, hv_, 3, 0.5)
    n0 /= np.linalg.norm(n0, axis=1, keepdims=True) + 1e-12
    # hairline (short back and sides): height of the hairline as a function of the angle around the head
    zc = headC[2]
    p_ = v0 - [0, eyeY, zc]
    th = np.abs(np.arctan2(p_[:, 0], -p_[:, 2]))                      # 0 = forehead, pi = nape
    hl = np.interp(th, [0.0, 0.45, 0.8, 1.05, 1.2, 1.38, 1.62, 1.95, 2.3, np.pi],
                   [0.064, 0.06, 0.047, 0.038, -0.012, -0.012, 0.012, 0.0, -0.05, -0.078])
    dens = sstep(0.0, 0.014, p_[:, 1] - hl)
    earm = np.zeros(len(v0))
    for sx in (1, -1):
        ec = np.array([0.074 * sx, eyeY - 0.014, zc + 0.012])
        earm = np.maximum(earm, 1 - sstep(0.026, 0.036, np.linalg.norm((v0 - ec) * [0.55, 1, 1.15], axis=1)))
    dens *= 1 - earm
    top = sstep(eyeY + 0.04, eyeY + 0.1, v0[:, 1])
    thick = 0.0009 + dens * (0.0022 + 0.0045 * top)
    base = len(v2)
    remap = -np.ones(len(v2), np.int64)
    remap[hv_] = base + np.arange(len(hv_))
    new_v = [v0[hv_]]
    hair_f = [i for i in headf if (dens[np.array(faces[i])] > 0.0).all()]
    hvh = np.unique(np.concatenate([np.array(faces[i]) for i in hair_f])) if hair_f else np.zeros(0, np.int64)
    remap_h = -np.ones(len(v2), np.int64)
    remap_h[hvh] = base + len(hv_) + np.arange(len(hvh))
    new_v.append(v0[hvh] + n0[hvh] * thick[hvh, None])
    add_f, add_t, add_m = [], [], []
    for i in headf:
        add_f.append([int(remap[x]) for x in faces[i]]); add_t.append(B['fuv'][i]); add_m.append('face')
    for i in hair_f:
        add_f.append([int(remap_h[x]) for x in faces[i]]); add_t.append(B['fuv'][i]); add_m.append('hair')
    src = np.concatenate([hv_, hvh])
    B['v'] = np.vstack([v2] + new_v)
    B['faces'] = list(faces) + add_f
    B['fuv'] = list(B['fuv']) + add_t
    B['fkind'] = list(fkind) + ['body'] * len(add_f)
    B['fmat'] = fmat + add_m
    B['src'] = np.concatenate([np.arange(len(v2)), src])   # vertex -> original vertex (weights)
    B['hairDensity'] = np.concatenate([np.zeros(len(v2)), np.zeros(len(hv_)), dens[hvh]])
    return {'eyeY': eyeY, 'eyeZ': eyeZ}


# ------------------------------------------------------------------------------------------------ 8 decimation
# decimation importance per material: errors on small / mostly hidden parts are cheaper (gloves are dense in the
# MakeHuman hands, the eye-opening skin is behind the glasses), the clothed silhouette and the balaclava count fully
IMPORTANCE = {'camo': 1.0, 'knit': 1.0, 'glove': 0.12, 'skin': 0.4, 'sole': 0.3, 'boot': 0.5, 'eye': 1.0, 'face': 1.0,
              'hair': 0.6}


def decimate(V, F, Fuv, fmat, W, target, lock_extra=None, wpen=0.02):
    """Quadric-error half-edge collapse on a triangle mesh with per-corner UV indices.
    Locked: UV-seam vertices, material borders, open borders. Collapse u -> v keeps v's attributes."""
    nv = len(V)
    F = [list(f) for f in F]
    Fuv = [list(f) for f in Fuv]
    alive = [True] * len(F)
    vf = [set() for _ in range(nv)]
    for i, f in enumerate(F):
        for x in f:
            vf[x].add(i)
    # locks
    lock = np.zeros(nv, bool)
    uvs = [set() for _ in range(nv)]
    mats = [set() for _ in range(nv)]
    edgec = {}
    for i, (f, t) in enumerate(zip(F, Fuv)):
        for k in range(3):
            uvs[f[k]].add(t[k])
            mats[f[k]].add(fmat[i])
            e = (min(f[k], f[(k + 1) % 3]), max(f[k], f[(k + 1) % 3]))
            edgec[e] = edgec.get(e, 0) + 1
    for x in range(nv):
        if len(uvs[x]) > 1 or len(mats[x]) > 1:
            lock[x] = True
    for (a, b), c in edgec.items():
        if c != 2:
            lock[a] = lock[b] = True
    if lock_extra is not None:
        lock |= lock_extra
    # quadrics
    Q = np.zeros((nv, 4, 4))
    for fi, f in enumerate(F):
        p0, p1, p2 = V[f[0]], V[f[1]], V[f[2]]
        n = np.cross(p1 - p0, p2 - p0)
        ar = np.linalg.norm(n)
        if ar < 1e-14:
            continue
        n /= ar
        pl = np.array([n[0], n[1], n[2], -n @ p0])
        K = np.outer(pl, pl) * ar * IMPORTANCE.get(fmat[fi], 1.0)
        for x in f:
            Q[x] += K

    def cost(u, v):
        p = np.array([V[v][0], V[v][1], V[v][2], 1.0])
        q = p @ (Q[u] + Q[v]) @ p
        dw = W[u] - W[v]
        return q + wpen * (dw @ dw) * np.sum((V[u] - V[v]) ** 2)

    heap = []
    ver = np.zeros(nv, np.int64)
    def push_vertex(u):
        if lock[u]:
            return
        nbs = set()
        for fi in vf[u]:
            nbs.update(F[fi])
        nbs.discard(u)
        for w_ in nbs:
            heapq.heappush(heap, (cost(u, w_), u, w_, ver[u]))
    for u in range(nv):
        if vf[u]:
            push_vertex(u)
    nf = sum(alive)
    while nf > target and heap:
        c, u, v, vu = heapq.heappop(heap)
        if vu != ver[u] or not vf[u] or lock[u]:
            continue
        shared = [fi for fi in vf[u] if v in F[fi]]
        if len(shared) != 2:
            continue
        # link condition
        nu = set(); nvv = set()
        for fi in vf[u]:
            nu.update(F[fi])
        for fi in vf[v]:
            nvv.update(F[fi])
        common = (nu & nvv) - {u, v}
        opp = set()
        for fi in shared:
            opp.update(F[fi])
        if common != opp - {u, v}:
            continue
        # uv of v in u's chart (u is not a seam vertex, so all its corners share one uv)
        fi0 = shared[0]
        tv = Fuv[fi0][F[fi0].index(v)]
        # flip test
        bad = False
        for fi in vf[u]:
            if fi in shared:
                continue
            f = F[fi]
            pts = [V[x] for x in f]
            n0 = np.cross(pts[1] - pts[0], pts[2] - pts[0])
            pts2 = [V[v] if x == u else V[x] for x in f]
            n1 = np.cross(pts2[1] - pts2[0], pts2[2] - pts2[0])
            l0, l1 = np.linalg.norm(n0), np.linalg.norm(n1)
            if l1 < 1e-14 or (n0 @ n1) / (l0 * l1 + 1e-20) < 0.3:
                bad = True
                break
        if bad:
            continue
        for fi in shared:
            alive[fi] = False
            for x in F[fi]:
                vf[x].discard(fi)
        nf -= 2
        for fi in list(vf[u]):
            k = F[fi].index(u)
            F[fi][k] = v
            Fuv[fi][k] = tv
            vf[v].add(fi)
        vf[u] = set()
        Q[v] += Q[u]
        affected = set()
        for fi in vf[v]:
            affected.update(F[fi])
        for x in affected:
            ver[x] += 1
            push_vertex(x)
    keep = [i for i in range(len(F)) if alive[i]]
    return np.array([F[i] for i in keep]), np.array([Fuv[i] for i in keep]), [fmat[i] for i in keep]


# ------------------------------------------------------------------------------------------------ 9 assembly + export
GROUP_ORDER = ['camo', 'knit', 'boot', 'sole', 'eye', 'glove', 'skin', 'face', 'hair']


def assemble(V, N, UV, Wn, F, Fuv, fmat):
    """Split vertices by (position, uv) and order faces by material group."""
    key = {}
    pv, pn, puv, pw = [], [], [], []
    idx = []
    groups = []
    order = sorted(range(len(F)), key=lambda i: GROUP_ORDER.index(fmat[i]))
    cur, start = None, 0
    for j, i in enumerate(order):
        m = fmat[i]
        if m != cur:
            if cur is not None:
                groups.append((cur, start, j * 3 - start))
            cur, start = m, j * 3
        for k in range(3):
            kk = (F[i][k], Fuv[i][k])
            if kk not in key:
                key[kk] = len(pv)
                pv.append(V[kk[0]]); pn.append(N[kk[0]]); puv.append(UV[kk[1]]); pw.append(Wn[kk[0]])
            idx.append(key[kk])
    groups.append((cur, start, len(order) * 3 - start))
    return np.array(pv), np.array(pn), np.array(puv), np.array(pw), np.array(idx), groups


def metric_uvs(V, vt, F, Fuv):
    parent = list(range(len(vt)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for t in Fuv:
        for k in (1, 2):
            ra, rb = find(t[0]), find(t[k])
            if ra != rb:
                parent[ra] = rb
    root = np.array([find(i) for i in range(len(vt))])
    out = vt.copy()
    isl = {}
    for f, t in zip(F, Fuv):
        r = root[t[0]]
        for k in range(3):
            a, b = k, (k + 1) % 3
            d2 = np.linalg.norm(vt[t[a]] - vt[t[b]])
            if d2 > 1e-9:
                isl.setdefault(r, []).append(np.linalg.norm(V[f[a]] - V[f[b]]) / d2)
    for r, ratios in isl.items():
        m = root == r
        out[m] = vt[m] * float(np.median(ratios))
    return out


def quant_weights(Wv):
    """Top-4 influences, uint8 weights summing to 255."""
    n = len(Wv)
    si = np.argsort(-Wv, axis=1)[:, :4]
    sw = np.take_along_axis(Wv, si, 1)
    sw = sw / sw.sum(1, keepdims=True)
    q = np.floor(sw * 255 + 0.5).astype(np.int64)
    q[:, 0] += 255 - q.sum(1)
    si = np.where(q > 0, si, 0)
    return si.astype(np.uint8), q.astype(np.uint8)


def pack(lods, header):
    blob = bytearray()

    def put(arr):
        nonlocal blob
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob += arr.tobytes()
        return off
    for L in lods:
        a = L.pop('_arrays')
        L['attributes'] = {}
        for name, (arr, typ, size, norm) in a.items():
            L['attributes'][name] = {'offset': put(arr), 'type': typ, 'itemSize': size, 'normalized': norm}
        L['index'] = {'offset': put(L.pop('_index')), 'type': 'u16'}
    header['lods'] = lods
    js = json.dumps(header, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    return b'TBMH' + struct.pack('<II', 1, len(js)) + js + bytes(blob)


def build_lod(name, V, Wv, UV, F, Fuv, fmat):
    used_n = vertex_normals(V, F)
    pv, pn, puv, pw, idx, groups = assemble(V, used_n, UV, Wv, F, Fuv, fmat)
    si, sw = quant_weights(pw)
    assert len(pv) < 65536
    nq = np.clip(np.round(pn / (np.linalg.norm(pn, axis=1, keepdims=True) + 1e-12) * 32767), -32767, 32767).astype(np.int16)
    return {
        'name': name, 'vertexCount': len(pv), 'indexCount': len(idx),
        'groups': [{'name': g, 'start': s_, 'count': c} for g, s_, c in groups],
        '_arrays': {
            'position': (pv.astype(np.float32), 'f32', 3, False),
            'normal': (nq, 'i16', 3, True),
            'uv': (puv.astype(np.float32), 'f32', 2, False),
            'skinIndex': (si, 'u8', 4, False),
            'skinWeight': (sw, 'u8', 4, True),
        },
        '_index': idx.astype(np.uint16),
    }


def landmarks(V, F, fmat, W, pos, R, rest, info):
    """Body measurements in the identity-rest pose, used to refit the procedural gear in soldier.js."""
    body = np.unique(F[[m not in ('eye', 'face', 'hair') for m in fmat]].ravel())
    P = V[body]
    Wb = W[body]
    # inverse bind: each vertex to its dominant bone's rest frame (torso / head bones: rest == bind)
    dom = np.argmax(Wb, 1)
    Pr = P.copy()
    for n, _ in GAME_BONES:
        m = dom == GI[n]
        Pr[m] = rest[n] + (P[m] - pos[n]) @ R[n]
    r4 = lambda x: round(float(x), 4)
    tw = Wb[:, [GI['hips'], GI['spine'], GI['chest']]].sum(1) > 0.5
    out = {'torso': []}
    for y in np.arange(0.85, 1.56, 0.025):
        m = (np.abs(P[:, 1] - y) < 0.015) & tw
        c = m & (np.abs(P[:, 0]) < 0.06)
        if c.sum() == 0 or m.sum() == 0:
            continue
        out['torso'].append([r4(y), r4(P[c, 2].min()), r4(P[c, 2].max()), r4(np.abs(P[m, 0]).max())])
    eyeY = info['eyeY']
    hw = (Wb[:, GI['head']] > 0.5) & (P[:, 1] > eyeY - 0.06)
    Hd = P[hw]
    brow = Hd[np.abs(Hd[:, 1] - (eyeY + 0.02)) < 0.008]
    ring = Hd[np.abs(Hd[:, 1] - (eyeY - 0.005)) < 0.008]
    out['head'] = {'top': r4(Hd[:, 1].max()), 'browFront': r4(brow[np.abs(brow[:, 0]) < 0.03, 2].min()),
                   'back': r4(ring[:, 2].max()), 'halfWidth': r4(np.abs(brow[:, 0]).max()),
                   'earX': r4(np.abs(ring[:, 0]).max()), 'eyeY': r4(eyeY), 'eyeFront': r4(info['eyeZ'])}
    # limbs (right side, rest space): sleeve / trouser / boot surfaces
    ua = (dom == GI['uarmR'])
    mid = ua & (np.abs(Pr[:, 1] - (rest['uarmR'][1] - 0.13)) < 0.015)
    th = (dom == GI['thighR'])
    tm = th & (np.abs(Pr[:, 1] - (rest['thighR'][1] - 0.2)) < 0.015)
    lg = (dom == GI['shinR']) | (dom == GI['thighR'])
    kn = lg & (np.abs(Pr[:, 1] - rest['shinR'][1]) < 0.03) & (np.abs(Pr[:, 0] - rest['shinR'][0]) < 0.03)
    # instep profile (top of the boot along the centre line), relative to the ankle
    fr = (dom == GI['footR']) | (dom == GI['shinR'])
    fr &= np.abs(Pr[:, 0] - rest['footR'][0]) < 0.015
    inst = []
    for zz in (-0.1, -0.02):
        m = fr & (np.abs(Pr[:, 2] - rest['footR'][2] - zz) < 0.01) & (Pr[:, 1] < 0.2)
        inst.append([r4(zz), r4(Pr[m, 1].max() - rest['footR'][1])])
    ft = (dom == GI['footR'])
    out['limb'] = {
        'uarmOut': r4(Pr[mid, 0].max() - rest['uarmR'][0]), 'uarmFront': r4(Pr[mid, 2].min() - rest['uarmR'][2]),
        'thighOut': r4(Pr[tm, 0].max() - rest['thighR'][0]), 'thighFront': r4(Pr[tm, 2].min() - rest['thighR'][2]),
        'kneeFront': r4(Pr[kn, 2].min() - rest['shinR'][2]),
        'toe': r4(Pr[ft, 2].min() - rest['footR'][2]), 'heel': r4(Pr[ft, 2].max() - rest['footR'][2]),
        'footHalfW': r4(np.abs(Pr[ft & (Pr[:, 1] < 0.03), 0] - rest['footR'][0]).max()),
        'instep': inst,
    }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--preview', default=None, help='also pickle the intermediate data to this path (debugging)')
    ap.add_argument('--close', type=int, default=23600,
                    help='close LOD triangle budget (both head variants; one soldier uses ~19.5 k of it)')
    ap.add_argument('--far', type=int, default=2600, help='far LOD body triangle budget')
    a = ap.parse_args()
    B = load_body()
    weights = mhio.load_weights(os.path.join(SRC, 'default_weights.mhw'))
    pos, R, rest = game_skeleton(B)
    # re-centre so the identity-rest ankles stand on z = 0 (the gait code plants the feet around the root)
    dz = -rest['footR'][2]
    B['v'][:, 2] += dz
    for D in (B['H'], B['T']):
        for k in D:
            D[k] = D[k] + [0, 0, dz]
    pos, R, rest = game_skeleton(B)
    grips = curl_hands(B, R, pos, weights)
    W = game_weights(len(B['v']), weights)
    W = soften_wrists(B, W, pos, R)
    info = dress(B, W, pos, R)
    W = W[B['src']]                      # appended bare-head / hair vertices inherit their source vertex weights
    V = B['v']
    F, Fuv, fm = [], [], []
    for f, t, m in zip(B['faces'], B['fuv'], B['fmat']):
        F.append((f[0], f[1], f[2])); Fuv.append((t[0], t[1], t[2])); fm.append(m)
        if len(f) == 4:
            F.append((f[0], f[2], f[3])); Fuv.append((t[0], t[2], t[3])); fm.append(m)
    F, Fuv = np.array(F), np.array(Fuv)
    # metric UVs: every UV island of MakeHuman's 0..1 atlas is scaled so one UV unit ~ one metre on the body (the
    # atlas gives the face and hands more texels than the torso; the tiling cloth textures need a uniform scale)
    UVm = metric_uvs(V, B['vt'], F, Fuv)
    # gloves and boots: seam-free projected UVs (the MakeHuman atlas splits every finger / toe, and seam vertices cannot
    # be decimated). Gloves: the hand's palm plane; boots: cylindrical around the leg axis. Both in metres.
    extra = []
    vuv = {}
    for i, m in enumerate(fm):
        if m not in ('glove', 'boot', 'sole', 'hair'):
            continue
        for k in range(3):
            vi = F[i][k]
            if vi not in vuv:
                p_ = V[vi]
                if m == 'hair':
                    uv = (B['hairDensity'][vi], p_[1])      # u: hair density (0 at the hairline), v: height
                elif m == 'glove':
                    sd = 'R' if p_[0] > 0 else 'L'
                    h = (p_ - pos['hand' + sd]) @ R['hand' + sd]
                    uv = (h[2] + 0.4 * h[0], h[1])
                else:
                    sd = 'R' if p_[0] > 0 else 'L'
                    c = pos['foot' + sd]
                    ang_ = np.arctan2(p_[2] - c[2] + 0.06, p_[0] - c[0])
                    uv = (ang_ * 0.07, p_[1] + 0.3 * max(0.0, 0.03 - p_[1]) - 0.5 * (p_[2] - c[2]) * (p_[1] < 0.03))
                vuv[vi] = len(UVm) + len(extra)
                extra.append(uv)
            Fuv[i][k] = vuv[vi]
    UVm = np.vstack([UVm, np.array(extra)])
    print('faces', len(F))
    Fc, Fuvc, fmc = decimate(V, F, Fuv, fm, W, a.close)
    cnt = {m: fmc.count(m) for m in sorted(set(fmc))}
    print('close LOD', len(Fc), cnt, 'balaclava variant', len(Fc) - cnt.get('face', 0) - cnt.get('hair', 0),
          'bare-head variant', len(Fc) - cnt.get('knit', 0) - cnt.get('skin', 0))
    # far LOD: one material (drawn with the single camo material); seams / material borders need no lock
    base_head = [m not in ('face', 'hair') for m in fmc]          # far LOD: balaclava head for everyone
    Fc_b, Fuvc_b = Fc[base_head], Fuvc[base_head]
    Ff, Fuvf, _ = decimate(V, Fc_b, Fuvc_b, ['camo'] * len(Fc_b), W, a.far, wpen=0.0)
    print('far LOD', len(Ff))
    lods = [build_lod('close', V, W, UVm, Fc, Fuvc, fmc), build_lod('far', V, W, UVm, Ff, Fuvf, ['camo'] * len(Ff))]
    bones = []
    for n, p in GAME_BONES:
        bones.append({'name': n, 'parent': p, 'rest': np.round(rest[n], 5).tolist(),
                      'bindPos': np.round(pos[n], 5).tolist(), 'bindQuat': np.round(mat_to_quat(R[n]), 6).tolist()})
    H = B['H']
    eyeR = H['eye.R']
    header = {
        'source': 'MakeHuman hm08 base mesh, default skeleton weights and macro targets (CC0 1.0); see docs/ASSETS.md',
        'stature': STATURE, 'bones': bones,
        'eyeR': np.round(eyeR, 4).tolist(), 'eyeL': np.round(H['eye.L'], 4).tolist(),
        'grip': {k: np.round(g, 4).tolist() for k, g in grips.items()},
        'landmarks': landmarks(V, F, fm, W, pos, R, rest, info),
    }
    data = pack(lods, header)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'wb').write(data)
    print('wrote', os.path.relpath(OUT), len(data), 'bytes')
    print(json.dumps({k: header[k] for k in ('eyeR', 'eyeL', 'grip')}))
    print(json.dumps(header['landmarks']))
    for b in bones:
        print(b['name'], b['rest'], b['bindQuat'])
    if a.preview:   # debug dump for offline preview scripts
        import pickle
        pickle.dump({'B': B, 'pos': pos, 'R': R, 'rest': rest, 'grips': grips, 'Fc': Fc, 'fmc': fmc, 'Ff': Ff, 'W': W}, open(a.preview, 'wb'))


if __name__ == '__main__':
    main()
