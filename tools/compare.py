"""Side-by-side before/after sheets from fixed-camera renders.

    python3 tools/compare.py docs/renders/baseline-v0.1 docs/renders/v0.2 docs/renders/compare
"""
import os
import sys
from PIL import Image, ImageDraw

before, after, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
for name in sorted(os.listdir(after)):
    if not name.endswith('.png') or not os.path.exists(os.path.join(before, name)):
        continue
    a = Image.open(os.path.join(before, name)).convert('RGB')
    b = Image.open(os.path.join(after, name)).convert('RGB')
    w = 960
    a = a.resize((w, round(a.height * w / a.width)))
    b = b.resize((w, round(b.height * w / b.width)))
    sheet = Image.new('RGB', (w * 2 + 8, max(a.height, b.height) + 30), (12, 12, 12))
    sheet.paste(a, (0, 30)); sheet.paste(b, (w + 8, 30))
    d = ImageDraw.Draw(sheet)
    d.text((8, 8), f'BEFORE  v0.1  {name}', fill=(220, 220, 220))
    d.text((w + 16, 8), f'AFTER  v0.2  {name}', fill=(255, 190, 110))
    sheet.save(os.path.join(out, name.replace('.png', '.jpg')), quality=88)
    print('wrote', name)
