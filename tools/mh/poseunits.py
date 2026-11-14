#!/usr/bin/env python3
"""Print the face-rig rotation sizes the game uses, from MakeHuman's CC0 face pose units.

Usage:  python3 tools/mh/poseunits.py

Reads tools/mh/sources/poseunits/face-poseunits.bvh (+ .json frame names; CC0 1.0, see tools/mh/sources/SOURCES.md) with
own code and prints, for the pose units behind the soldiers' face animation (game/src/enemies.js updateFace), the Euler
rotation of each MakeHuman face bone relative to the rest frame (degrees). The game's face bones (tools/mh/build_soldier.py
FACE_BONES) are the sums of these bones, so the sizes carry over: upper lid closed 33.2, upper lid open 17.6, lower lid up
16.3, eye up / down ~20 with the lids following, jaw drop 20.2.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'sources', 'poseunits')
UNITS = ('LeftUpperLidClosed', 'LeftUpperLidOpen', 'LeftLowerLidUp', 'LeftEyeDown', 'LeftEyeUp', 'LeftEyeturnLeft',
         'JawDrop', 'LeftInnerBrowUp', 'LeftOuterBrowUp', 'LeftBrowDown')
BONES = ('orbicularis03.L', 'orbicularis04.L', 'eye.L', 'jaw', 'oculi01.L', 'oculi02.L')


def main():
    names = json.load(open(os.path.join(SRC, 'face-poseunits.json')))['framemapping']
    lines = open(os.path.join(SRC, 'face-poseunits.bvh')).read().split('\n')
    joints, cols = [], []
    for ln in lines:
        p = ln.split()
        if not p:
            continue
        if p[0] in ('ROOT', 'JOINT'):
            joints.append(p[1])
        elif p[0] == 'CHANNELS':
            cols += [(joints[-1], c) for c in p[2:]]
        elif p[0] == 'MOTION':
            break
    m = lines.index('MOTION')
    frames = [[float(x) for x in ln.split()] for ln in lines[m + 3:] if ln.strip()]
    rest = frames[0]
    for u in UNITS:
        f = frames[names.index(u)]
        out = [f'{j}.{c[0]}={f[k] - rest[k]:+.1f}' for k, (j, c) in enumerate(cols)
               if j in BONES and 'rotation' in c and abs(f[k] - rest[k]) > 0.05]
        print(f'{u:20s}', ' '.join(out))


if __name__ == '__main__':
    main()
