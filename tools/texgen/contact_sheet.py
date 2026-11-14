"""Render a contact sheet of generated texture sets for visual review."""
import os, sys
from PIL import Image, ImageDraw
D = os.path.join(os.path.dirname(__file__), '..', '..', 'game', 'assets', 'textures')
out = sys.argv[1]
names = sys.argv[2:] or sorted({f.rsplit('_', 1)[0] for f in os.listdir(D)})
S = 384
rows = []
for n in names:
    row = Image.new('RGB', (S * 3, S + 18), (20, 20, 20))
    for i, k in enumerate(['albedo', 'normal', 'orm']):
        p = os.path.join(D, f'{n}_{k}.webp')
        if os.path.exists(p):
            im = Image.open(p).convert('RGB')
            # show a 1:1 crop of top-left quarter to judge texel detail + a downscale
            crop = im.crop((0, 0, im.width // 2, im.height // 2)).resize((S, S))
            row.paste(crop, (i * S, 18))
    ImageDraw.Draw(row).text((4, 3), n, fill=(255, 255, 255))
    rows.append(row)
sheet = Image.new('RGB', (S * 3, sum(r.height for r in rows)))
y = 0
for r in rows:
    sheet.paste(r, (0, y)); y += r.height
sheet.save(out)
