"""Frame metrics, twin of web/src/frameStats.ts: 8-bit sRGB, mean Rec.709 luma, clipped = max channel >= CLIP.

    python -m webexport.framestats stats a.png b.png [--box x0,y0,x1,y1]
    python -m webexport.framestats pair ref.png web.png out.jpg          # side by side, ref left
    python -m webexport.framestats pop a.png b.png [--box x0,y0,x1,y1]   # camera-nudge popping
"""
import json
import math
import sys

import numpy as np
from PIL import Image

CLIP = 250
POP_LUMA = 160
POP_SHIFT = 3
LUMA = np.array([0.2126, 0.7152, 0.0722])


def _crop(rgb, box):
    h, w = rgb.shape[:2]
    x0, y0, x1, y1 = box
    return rgb[math.floor(y0 * h):math.ceil(y1 * h), math.floor(x0 * w):math.ceil(x1 * w), :3].astype(np.float64)


def image_stats(rgb, box=(0, 0, 1, 1)):
    a = _crop(rgb, box)
    return {"mean": float((a @ LUMA).mean()), "clipped": float((a.max(axis=2) >= CLIP).mean())}


def _dilate(m, r=POP_SHIFT):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


POP_SEARCH = 40


def _shift_cost(la, lb, dy, dx, m):
    """Mean |la - lb shifted by (dy, dx)| over the interior (margin m)."""
    h, w = la.shape
    return np.abs(la[m:h - m, m:w - m] - lb[m + dy:h - m + dy, m + dx:w - m + dx]).mean()


def _align(la, lb, search=POP_SEARCH):
    """Integer (dy, dx) such that lb[y + dy, x + dx] best matches la[y, x]: coarse at 1/4 scale, then refined."""
    k = 4
    h, w = (la.shape[0] // k) * k, (la.shape[1] // k) * k
    small = [x[:h, :w].reshape(h // k, k, w // k, k).mean(axis=(1, 3)) for x in (la, lb)]
    s = search // k
    cy, cx = min(((dy, dx) for dy in range(-s, s + 1) for dx in range(-s, s + 1)),
                 key=lambda d: _shift_cost(small[0], small[1], d[0], d[1], s))
    return min(((cy * k + dy, cx * k + dx) for dy in range(-k, k + 1) for dx in range(-k, k + 1)),
               key=lambda d: _shift_cost(la, lb, d[0], d[1], search + k))


def popping(a, b, box=(0, 0, 1, 1)):
    """Camera-nudge test: frame b is aligned to a (best global integer shift: the nudge's parallax), then
    popping = share of bright pixels (luma > POP_LUMA) with no bright pixel within POP_SHIFT px in the other
    frame, over the interior. A halo that appears or vanishes (an LED hit or missed) counts; residual
    parallax of a pixel or two does not. 0 = stable, 1 = every light popped."""
    ya, yb = (_crop(x, box) @ LUMA for x in (a, b))
    dy, dx = _align(ya, yb)
    m = POP_SEARCH + 4
    h, w = ya.shape
    la = ya[m:h - m, m:w - m] > POP_LUMA
    lb = yb[m + dy:h - m + dy, m + dx:w - m + dx] > POP_LUMA
    union = (la | lb).sum()
    popped = (la & ~_dilate(lb)).sum() + (lb & ~_dilate(la)).sum()
    return float(popped / union) if union else 0.0


def load(path):
    return np.asarray(Image.open(path).convert("RGB"))


def pair(ref, web, out, height=540):
    ims = [Image.open(p).convert("RGB") for p in (ref, web)]
    ims = [im.resize((round(im.width * height / im.height), height)) for im in ims]
    canvas = Image.new("RGB", (sum(im.width for im in ims), height))
    canvas.paste(ims[0], (0, 0))
    canvas.paste(ims[1], (ims[0].width, 0))
    canvas.save(out, quality=88)


def main(argv):
    if argv[0] == "pair":
        return pair(*argv[1:4])
    box = (0, 0, 1, 1)
    if "--box" in argv:
        i = argv.index("--box")
        box = tuple(float(v) for v in argv[i + 1].split(","))
        argv = argv[:i] + argv[i + 2:]
    if argv[0] == "pop":
        return print(json.dumps({"popping": popping(load(argv[1]), load(argv[2]), box)}))
    for p in argv[1:]:
        print(json.dumps({"file": p, **image_stats(load(p), box)}))


if __name__ == "__main__":
    main(sys.argv[1:])
