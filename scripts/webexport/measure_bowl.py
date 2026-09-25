"""A6 (v2): outdoor-light factor inside the bowl, from the bowl lightmaps (same method as treeLight.FLOOD).

Up-facing tier treads of bowl__M_Concrete (raw glb, Y-up) are sampled in lightmaps/<state>/bowl.png (RGBM,
decoded x rgbmRange x PI as stadium.ts applies it), split into open (inside the oculus) and roofed for
information. The seats' model (treeLight.ts) is E = (PI * ambient + sun * N.L) * bowl; this prints
bowl = (mean tread E - flood) / model E per state. Night is left at 1: FLOOD was calibrated against the full ambient.

    PYTHONPATH=scripts .venv/bin/python -m webexport.measure_bowl build/web_raw
"""
import json
import math
import struct
import sys

import numpy as np
from PIL import Image

OCULUS = (76.0, 63.0, 2.35)                             # params.OCULUS_A/B/N
LUMA = np.array([0.2126, 0.7152, 0.0722])
# lightingState.sunStrength / sunToward elevation / sunColor, treeLight TREE_AMBIENT (x (0.8, 0.87, 1) tint)
# and the flood term the web adds on top (treeLight FLOOD.irradiance x n, not scaled by bowl)
MODEL = {"day": dict(sun=3.0, elev=24.0, color=(1.0, 0.93, 0.82), amb=0.9, flood=0.0),
         "golden": dict(sun=3.0 * (1 - (0.6 / 0.85) ** 2), elev=2.0, color=(1.0, 0.60, 0.30), amb=0.55, flood=0.8 * 0.6)}


def glb(path):
    b = open(path, "rb").read()
    n = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20:20 + n]), b[20 + n + 8:]


def accessor(doc, binary, i):
    a = doc["accessors"][i]
    v = doc["bufferViews"][a["bufferView"]]
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a["componentType"]]
    off = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(binary, dt, a["count"] * comps, off).reshape(a["count"], comps)


def treads(raw, state):
    doc, binary = glb(f"{raw}/stadium.glb")
    rng = json.load(open(f"{raw}/manifest.json"))["rgbmRange"]
    lm = np.asarray(Image.open(f"{raw}/lightmaps/{state}/bowl.png").convert("RGBA")).astype(np.float64) / 255
    H, W = lm.shape[:2]
    es, rs = [], []
    for node in doc["nodes"]:
        if node.get("name") != "bowl__M_Concrete":
            continue
        for prim in doc["meshes"][node["mesh"]]["primitives"]:
            at = prim["attributes"]
            P, N, UV = (accessor(doc, binary, at[k]) for k in ("POSITION", "NORMAL", "TEXCOORD_1"))
            up = (N[:, 1] > 0.95) & (P[:, 1] > 1.5)      # glTF Y-up: up-facing treads above 1.5 m
            px = lm[np.clip((UV[up, 1] * H).astype(int), 0, H - 1), np.clip((UV[up, 0] * W).astype(int), 0, W - 1)]
            es.append((px[:, :3] * px[:, 3:4] * rng * math.pi) @ LUMA)
            x, y = P[up, 0], -P[up, 2]                   # Blender plan
            rs.append((np.abs(x / OCULUS[0]) ** OCULUS[2] + np.abs(y / OCULUS[1]) ** OCULUS[2]) ** (1 / OCULUS[2]))
    return np.concatenate(es), np.concatenate(rs)


def main(raw):
    for state, m in MODEL.items():
        e, r = treads(raw, state)
        model = math.pi * m["amb"] * float(LUMA @ [0.8, 0.87, 1.0]) + m["sun"] * float(LUMA @ m["color"]) * math.sin(math.radians(m["elev"]))
        print(f"{state}: open n={int((r < 0.95).sum())} mean={e[r < 0.95].mean():.3f}, roofed n={int((r > 1.05).sum())} "
              f"mean={e[r > 1.05].mean():.3f}, all mean={e.mean():.3f} median={np.median(e):.3f}; model {model:.3f}; "
              f"+ flood {m['flood']:.2f}; bowl = {(e.mean() - m['flood']) / model:.3f}")


if __name__ == "__main__":
    main(sys.argv[1])
