"""Frame metrics, twin of web/src/frameStats.ts: 8-bit sRGB, mean Rec.709 luma, clipped = max channel >= CLIP.

    python -m webexport.framestats stats a.png b.png [--box x0,y0,x1,y1]
    python -m webexport.framestats pair ref.png web.png out.jpg      # side by side, ref left
    python -m webexport.framestats pop a.png b.png [--box x0,y0,x1,y1]   # camera-nudge popping
"""
import json
import math
import sys

import numpy as np
from PIL import Image

CLIP = 250


POP_LUMA = 160


def _crop(rgb, box):
    h, w = rgb.shape[:2]
    x0, y0, x1, y1 = box
    return rgb[math.floor(y0 * h):math.ceil(y1 * h), math.floor(x0 * w):math.ceil(x1 * w), :3].astype(np.float64)


def image_stats(rgb, box=(0, 0, 1, 1)):
    a = _crop(rgb, box)
    luma = a @ np.array([0.2126, 0.7152, 0.0722])
    return {"mean": float(luma.mean()), "clipped": float((a.max(axis=2) >= CLIP).mean())}


def popping(a, b, box=(0, 0, 1, 1)):
    """Camera-nudge test: share of bright pixels (luma > POP_LUMA) that are bright in only one frame.
    A 1.8 m nudge seen from hundreds of metres moves geometry a few pixels at most, so a halo that
    appears or vanishes (an LED hit or missed) dominates this; 0 = stable, 1 = every light popped."""
    wts = np.array([0.2126, 0.7152, 0.0722])
    la, lb = (_crop(x, box) @ wts > POP_LUMA for x in (a, b))
    union = (la | lb).sum()
    return float((la ^ lb).sum() / union) if union else 0.0


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
