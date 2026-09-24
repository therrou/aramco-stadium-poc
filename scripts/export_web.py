"""Web export, run inside the open Blender session (never headless on this machine):

    import sys; sys.path.insert(0, "/Users/Tomas.Herrou/aramco-stadium-3d/scripts")
    import export_web, importlib; importlib.reload(export_web)
    export_web.run(stages=("data",))

Reads the render scene "Scene" and never modifies or saves it.
"""
import importlib
import json
import math
import os
import shutil

import bpy
import mathutils

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data")
RAW = os.path.join(REPO, "build", "web_raw")
SOURCE_SCENE = "Scene"


def _reload():
    import webexport
    for name in ("seatbin", "texel", "rgbm", "budget", "groups", "manifest", "hemioct",
                 "matinfo", "webscene", "gltfout", "bake", "trees"):
        try:
            importlib.reload(importlib.import_module(f"webexport.{name}"))
        except ModuleNotFoundError:
            pass
    return webexport


def _cameras():
    out = {}
    for obj in bpy.data.scenes[SOURCE_SCENE].objects:
        if obj.type != "CAMERA":
            continue
        m = obj.matrix_world
        fwd = (m.to_3x3() @ mathutils.Vector((0, 0, -1))).normalized()
        eye = m.translation
        out[obj.name] = {"eye": [round(v, 4) for v in eye],
                         "target": [round(v, 4) for v in eye + fwd * 100.0],
                         "hfov": round(math.degrees(obj.data.angle), 4),
                         "exposure": float(obj.get("exposure", 0.0))}
    return out


def stage_data(report):
    from webexport import manifest, seatbin
    os.makedirs(RAW, exist_ok=True)
    rows = seatbin.read_csv(os.path.join(DATA, "seats.csv"))
    blob = seatbin.pack(rows)
    with open(os.path.join(RAW, "seats.bin"), "wb") as f:
        f.write(blob)
    assert len(seatbin.unpack(blob)) == 46074, "seat count"
    with open(os.path.join(DATA, "sections.json")) as f:
        sections = json.load(f)["sections"]
    assert len(sections) == 132, "section count"
    shutil.copy(os.path.join(DATA, "sections.json"), os.path.join(RAW, "sections.json"))
    with open(os.path.join(RAW, "cameras.json"), "w") as f:
        json.dump(_cameras(), f, indent=1)
    manifest.merge(os.path.join(RAW, "manifest.json"), manifest.new())
    report.update(seats=len(rows), sections=len(sections), seats_bin_bytes=len(blob))


STAGES = {"data": stage_data}


def run(stages=("data", "geometry", "bake", "trees"), quality="draft"):
    _reload()
    report = {"quality": quality}
    for s in stages:
        STAGES[s](report) if s == "data" else STAGES[s](report, quality)
    with open(os.path.join(RAW, "report.json"), "w") as f:
        json.dump(report, f, indent=1)
    return report
