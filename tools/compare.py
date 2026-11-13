"""Side-by-side before/after sheets from fixed-camera renders.

    python3 tools/compare.py docs/renders/baseline-v0.1 docs/renders/v0.2 docs/renders/compare
    python3 tools/compare.py docs/renders/v0.2 docs/renders/v0.3 docs/renders/compare --prefix v0.2_vs_v0.3_

Renders are matched by file stem (png / jpg / webp in either folder); the labels are the folder names
(baseline-v0.1 -> v0.1). Sheets are JPEG quality 88.
"""
import argparse
import os
import re
from PIL import Image, ImageDraw

EXT = ('.png', '.jpg', '.jpeg', '.webp')


def label(folder):
    m = re.search(r'v\d+(?:\.\d+)*', os.path.basename(os.path.normpath(folder)))
    return m.group(0) if m else os.path.basename(os.path.normpath(folder))


def index(folder):
    return {os.path.splitext(f)[0]: os.path.join(folder, f) for f in sorted(os.listdir(folder)) if f.lower().endswith(EXT)}


ap = argparse.ArgumentParser()
ap.add_argument('before')
ap.add_argument('after')
ap.add_argument('out')
ap.add_argument('--prefix', default='', help='prefix of the sheet file names (so sheets of several comparisons can share a folder)')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
B, A = index(a.before), index(a.after)
lb, la = label(a.before), label(a.after)
for name in sorted(A):
    if name not in B:
        continue
    im_a = Image.open(B[name]).convert('RGB')
    im_b = Image.open(A[name]).convert('RGB')
    w = 960
    im_a = im_a.resize((w, round(im_a.height * w / im_a.width)), Image.LANCZOS)
    im_b = im_b.resize((w, round(im_b.height * w / im_b.width)), Image.LANCZOS)
    sheet = Image.new('RGB', (w * 2 + 8, max(im_a.height, im_b.height) + 30), (12, 12, 12))
    sheet.paste(im_a, (0, 30))
    sheet.paste(im_b, (w + 8, 30))
    d = ImageDraw.Draw(sheet)
    d.text((8, 8), f'BEFORE  {lb}  {name}', fill=(220, 220, 220))
    d.text((w + 16, 8), f'AFTER  {la}  {name}', fill=(255, 190, 110))
    sheet.save(os.path.join(a.out, f'{a.prefix}{name}.jpg'), quality=88)
    print('wrote', f'{a.prefix}{name}.jpg')
