# Crops an image in virtual screen pixels: crop.py <input> <output> x0 y0 x1 y1 [scale]
import sys
from PIL import Image
src, out, *box = sys.argv[1:]
scale = float(box[4]) if len(box) > 4 else 1
im = Image.open(src).crop(tuple(int(v) for v in box[:4]))
if scale != 1:
    im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
im.save(out)
print(out, im.size)
