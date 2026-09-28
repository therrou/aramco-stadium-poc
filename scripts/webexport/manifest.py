"""build/web_raw/manifest.json: the one file the viewer reads first."""
import json
import os

from . import rgbm

# Day (n 0) is not baked or shipped any more (2026-09-28): the frontend only shows golden hour and night.
STATES = {"golden": 0.6, "night": 1.0}
EXPOSURE = {"golden": 0.55, "night": 0.75}   # lighting._render_settings: 0.25 + 0.5 n


def new():
    return {
        "version": 1,
        "rgbmRange": rgbm.RANGE,
        "stadium": "stadium.glb",
        "trees": None,
        "seats": "seats.bin",
        "sections": "sections.json",
        "cameras": "cameras.json",
        "states": {k: {"night": n, "exposure": EXPOSURE[k], "env": None, "lightmaps": {}}
                   for k, n in STATES.items()},
    }


def _deep(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            _deep(a[k], v)
        else:
            a[k] = v
    return a


def merge(path, patch):
    path = os.fspath(path)
    cur = {}
    if os.path.exists(path):
        with open(path) as f:
            cur = json.load(f)
    doc = _deep(cur, patch)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(doc, f, indent=1)
    return doc
