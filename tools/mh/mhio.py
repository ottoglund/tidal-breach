"""Readers for the MakeHuman CC0 asset formats used by build_soldier.py (own code, written from the file formats).

  base.obj      hm08 base mesh (Wavefront OBJ, groups 'body', 'helper-*', 'joint-*'), units: decimetres, +Z forward
  *.target      text: '<vertex index> <dx> <dy> <dz>' per line (decimetres), '#' comments
  *.mhskel      JSON: bones {name: {head, tail, parent}}, joints {joint name: [vertex indices]} (joint = mean position)
  *.mhw         JSON: weights {bone name: [[vertex index, weight], ...]}
"""
import json
import numpy as np


def load_obj(path):
    vs, vts, faces, fuv, fgrp = [], [], [], [], []
    groups = []
    gi = -1
    with open(path) as f:
        for line in f:
            if line.startswith('v '):
                vs.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('vt '):
                vts.append([float(x) for x in line.split()[1:3]])
            elif line.startswith('g '):
                groups.append(line.split()[1])
                gi = len(groups) - 1
            elif line.startswith('f '):
                a = [c.split('/') for c in line.split()[1:]]
                faces.append([int(c[0]) - 1 for c in a])
                fuv.append([int(c[1]) - 1 if len(c) > 1 and c[1] else -1 for c in a])
                fgrp.append(gi)
    return {
        'v': np.array(vs, dtype=np.float64), 'vt': np.array(vts, dtype=np.float64),
        'f': faces, 'fuv': fuv, 'fgrp': np.array(fgrp), 'groups': groups,
    }


def load_target(path):
    idx, d = [], []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            p = line.split()
            idx.append(int(p[0]))
            d.append([float(x) for x in p[1:4]])
    return np.array(idx, dtype=np.int64), np.array(d, dtype=np.float64)


def load_skeleton(path):
    d = json.load(open(path))
    return d['bones'], {k: np.array(v, dtype=np.int64) for k, v in d['joints'].items()}


def load_weights(path):
    d = json.load(open(path))
    return {b: (np.array([int(x[0]) for x in w]), np.array([float(x[1]) for x in w])) for b, w in d['weights'].items()}
