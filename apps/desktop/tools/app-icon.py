"""Builds per-size PNGs, one ICO and a small-size preview from the "SNAP <size> => <png path>" lines of a Figma plugin run's output.

Usage: python -I -X utf8 tools/app-icon.py <plugin output> <target folder> <name>
Give a new <name> when the icon changes: Windows caches icons by file path.
"""
import io, os, re, struct, sys
from PIL import Image

ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256]


def read_snaps(path):
    snaps = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        m = re.search(r"SNAP (\d+) => (.+\.png)\s*$", line)
        if m:
            snaps[int(m.group(1))] = m.group(2).strip()
    if not snaps:
        sys.exit("no SNAP line in the output")
    return snaps


def write_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    out_txt, target, name = sys.argv[1:]
    os.makedirs(target, exist_ok=True)
    images = {}
    for size, path in sorted(read_snaps(out_txt).items()):
        im = Image.open(path).convert("RGBA")
        assert im.size == (size, size), f"{size}: image is {im.size}"
        corner, center = im.getpixel((0, 0))[3], im.getpixel((size // 2, size // 2))[3]
        assert corner == 0 and center == 255, f"{size}: corner alpha {corner}, center alpha {center}"
        b = io.BytesIO(); im.save(b, "PNG", optimize=True)
        write_atomic(os.path.join(target, f"{name}-{size}.png"), b.getvalue())
        images[size] = im
        print(f"{size:5d} px  corner alpha {corner}  center alpha {center}  colors {len(im.getcolors(maxcolors=size * size))}")

    missing = [s for s in ICO_SIZES if s not in images]
    assert not missing, f"sizes missing for the ICO: {missing}"
    # Written by hand so every size keeps its own drawing instead of a downscaled one.
    blobs = []
    for s in ICO_SIZES:
        b = io.BytesIO(); images[s].save(b, "PNG", optimize=True); blobs.append(b.getvalue())
    head = struct.pack("<HHH", 0, 1, len(ICO_SIZES)); offset = 6 + 16 * len(ICO_SIZES); entries = b""
    for s, blob in zip(ICO_SIZES, blobs):
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(blob), offset); offset += len(blob)
    ico_path = os.path.join(target, f"{name}.ico")
    write_atomic(ico_path, head + entries + b"".join(blobs))

    raw = open(ico_path, "rb").read(); _, kind, count = struct.unpack_from("<HHH", raw, 0)
    assert kind == 1 and count == len(ICO_SIZES)
    for i, s in enumerate(ICO_SIZES):
        _, _, _, _, _, _, length, off = struct.unpack_from("<BBBBHHII", raw, 6 + 16 * i)
        back = Image.open(io.BytesIO(raw[off:off + length])).convert("RGBA")
        assert back.size == (s, s) and back.tobytes() == images[s].tobytes(), f"ICO entry {s} differs from its source"
    print(f"ICO: {count} entries {ICO_SIZES}, {len(raw)} bytes, every entry matches its source")

    small = [s for s in [16, 20, 24, 32, 40, 48, 64] if s in images]
    W = 40 + sum(s * 4 + 24 for s in small); H = 2 * (64 * 4 + 64 + 72)
    sheet = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    for row, bg in enumerate([(25, 25, 25, 255), (243, 243, 243, 255)]):
        y0 = row * (H // 2); sheet.paste(Image.new("RGBA", (W, H // 2), bg), (0, y0)); x = 20
        for s in small:
            sheet.alpha_composite(images[s].resize((s * 4, s * 4), Image.NEAREST), (x, y0 + 20 + (256 - s * 4)))
            sheet.alpha_composite(images[s], (x, y0 + 20 + 256 + 24 + (64 - s)))
            x += s * 4 + 24
    b = io.BytesIO(); sheet.convert("RGB").save(b, "PNG")
    write_atomic(os.path.join(target, f"{name}-onizleme-kucuk-olculer.png"), b.getvalue())
    print("written:", target)


if __name__ == "__main__":
    main()
