# Puts same-named Figma and app PNGs side by side: python -I -X utf8 tools/visual/pairs.py <folder with figma\ and app\>
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(sys.argv[1])
fig, app, out = root / "figma", root / "app", root / "pairs"
out.mkdir(exist_ok=True)
font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 18)
W, H, BAR = 720, 450, 32
pairs = []


def fit(path):
    src = Image.open(path).convert("RGB")
    k = min(W / src.width, H / src.height)
    return src.resize((round(src.width * k), round(src.height * k)), Image.LANCZOS)


for a in sorted(app.glob("*.png")):
    f = fig / a.name
    im = Image.new("RGB", (W * 2 + 8, H + BAR), (16, 16, 16))
    d = ImageDraw.Draw(im)
    if f.exists():
        im.paste(fit(f), (0, BAR))
        d.text((8, 6), "Figma: " + a.stem, font=font, fill=(230, 230, 230))
    else:
        d.text((8, 6), "no Figma match", font=font, fill=(160, 160, 160))
    im.paste(fit(a), (W + 8, BAR))
    d.text((W + 16, 6), "App (fake shell, headless Edge)", font=font, fill=(230, 230, 230))
    im.save(out / a.name)
    pairs.append(im)
tw, th = pairs[0].width // 3, pairs[0].height // 3
cols = 2
sheet = Image.new("RGB", (cols * tw, -(-len(pairs) // cols) * th), (0, 0, 0))
for i, p in enumerate(pairs):
    sheet.paste(p.resize((tw, th), Image.LANCZOS), ((i % cols) * tw, (i // cols) * th))
sheet.save(root / "overview.png")
print(len(pairs), "pairs; without Figma:", [a.stem for a in sorted(app.glob("*.png")) if not (fig / a.name).exists()])
print("Figma frames not captured in the app:", [f.stem for f in sorted(fig.glob("*.png")) if not (app / f.name).exists()])
