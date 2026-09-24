"""Entry point, run inside Blender:

    import sys; sys.path.insert(0, "<repo>/scripts")
    from stadium import build; build.run()            # everything
    build.run(stages=("pitch", "bowl"))               # partial rebuild
"""
import importlib
import json
import os

import bpy

from . import params, common, pitch, bowl

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(REPO, "data")


def _reload():
    for m in (params, common, pitch, bowl):
        importlib.reload(m)
    for name in ("assets", "landscape", "nightlights", "shell", "site", "lighting", "cameras"):
        try:
            mod = importlib.import_module(f"stadium.{name}")
            importlib.reload(mod)
        except ModuleNotFoundError:
            pass


def _root():
    root = bpy.data.collections.get("AramcoStadium")
    if not root:
        root = bpy.data.collections.new("AramcoStadium")
        bpy.context.scene.collection.children.link(root)
    return root


def write_bowl_data(info):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, "sections.json"), "w") as f:
        json.dump({"seats_total": info["seats_total"],
                   "numbering": "invented (no public seating plan); swap for official",
                   "sections": info["sections"]}, f, indent=1)
    with open(os.path.join(DATA_DIR, "seats.csv"), "w") as f:
        f.write("section,row,seat,x,y,z,yaw\n")
        for s, r, n, x, y, z, yaw in info["seats"]:
            f.write(f"{s},{r},{n},{x:.3f},{y:.3f},{z:.3f},{yaw:.4f}\n")


def run(stages=("pitch", "bowl", "shell", "site", "lighting", "cameras")):
    _reload()
    common.ensure_night_property()
    root = _root()
    report = {}
    if "pitch" in stages:
        pitch.build(root)
    if "bowl" in stages:
        _, info = bowl.build(root)
        write_bowl_data(info)
        report["seats_total"] = info["seats_total"]
        report["sections"] = len(info["sections"])
    for name in ("shell", "site", "lighting", "cameras"):
        if name in stages:
            mod = importlib.import_module(f"stadium.{name}")
            report[name] = mod.build(root)
    return report
