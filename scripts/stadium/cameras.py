"""Hero cameras + a view-from-seat camera for every section.

Per-section views are written into data/sections.json ("view": eye/target/fov)
so the web viewer can fly to exactly the framing rendered here.
"""
import csv
import json
import math
import os

import bpy
import mathutils

from . import common as C
from . import site

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
EYE_H = 1.15          # seated eye height above the tread
SEAT_FOV = 62.0       # degrees, horizontal
SAMPLE_SECTIONS = ("101", "112", "123", "134", "201", "212", "301", "306", "312", "323")


# CAM_KeyVisual framing along the sign axis: eye distance / sideways offset / height, aim point, lens (mm)
KV_DIST, KV_SIDE, KV_Z, KV_AIM, KV_LENS = 300.0, -20.0, 150.0, 10.0, 33.0

EXPOSURE = {"Sign": -0.2, "Aerial": -0.4, "Top": -0.4, "Approach": -0.25, "Pitch": 0.1, "Bowl": 0.05, "Seat": 0.1}


def _camera(name, coll, loc, target, lens=35.0, fov=None):
    data = bpy.data.cameras.get(name)
    if data:
        bpy.data.cameras.remove(data)
    data = bpy.data.cameras.new(name)
    data.clip_start, data.clip_end = 0.1, 6000
    if fov:
        data.lens_unit = "FOV"
        data.angle = math.radians(fov)
    else:
        data.lens = lens
    obj = bpy.data.objects.new(name, data)
    coll.objects.link(obj)
    obj.location = loc
    d = mathutils.Vector(target) - mathutils.Vector(loc)
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    obj["exposure"] = next((v for k, v in EXPOSURE.items() if k in name), 0.0)
    return obj


def _back_row_eye(section):
    with open(os.path.join(DATA, "seats.csv")) as f:
        rows = [r for r in csv.DictReader(f) if r["section"] == section]
    top = max(int(r["row"]) for r in rows)
    back = sorted((r for r in rows if int(r["row"]) == top), key=lambda r: int(r["seat"]))
    s = back[len(back) // 2]
    return float(s["x"]), float(s["y"]), float(s["z"]) + EYE_H


def _section_views():
    seats = {}
    with open(os.path.join(DATA, "seats.csv")) as f:
        for r in csv.DictReader(f):
            seats.setdefault(r["section"], []).append(r)
    views = {}
    for sec, rows in seats.items():
        max_row = max(int(r["row"]) for r in rows)
        # ~2/3 up the section: above the lower-tier vomitories, a typical "good seat"
        mid_row = [r for r in rows if int(r["row"]) == max(1, round(max_row * 0.66))]
        mid_row.sort(key=lambda r: int(r["seat"]))
        s = mid_row[int(len(mid_row) * 0.2)]   # off-centre: clear of vomitory mouths
        x, y, z, yaw = float(s["x"]), float(s["y"]), float(s["z"]), float(s["yaw"])
        # eye slightly forward of the seat back, looking at the near half of the field
        eye = (x + math.cos(yaw) * 0.15, y + math.sin(yaw) * 0.15, z + EYE_H)
        target = (x * 0.22, y * 0.22, 0.0)
        views[sec] = {"eye": [round(v, 3) for v in eye], "target": [round(v, 3) for v in target],
                      "fov": SEAT_FOV, "seat": f'{sec}-{s["row"]}-{s["seat"]}'}
    return views


def build(root):
    coll = C.collection("Cameras", root)
    scene = bpy.context.scene
    hero = [
        ("CAM_Aerial_SW", (-330, -470, 230), (0, 10, 18), 42),
        ("CAM_Aerial_E", (520, 120, 260), (0, 0, 15), 45),
        ("CAM_Aerial_Dusk", (430, -250, 150), (-10, 25, 10), 30),   # key-visual framing into the sunset
        ("CAM_Top", (0, 0.01, 820), (0, 0, 0), 50),
        ("CAM_Approach", (*site._gpt(18.0, -8.0), 1.7), (0, 0, 24), 24),   # from the garden, under the sign
        ("CAM_Pitch", (0, -30, 1.7), (0, 60, 22), 18),
    ]
    # sign on the south-west walkway, with the sails behind it
    sa = math.radians(236)
    sx, sy = site._podium_edge(sa)
    hero.append(("CAM_Sign", (sx + math.cos(sa) * 90, sy + math.sin(sa) * 90, 24),
                 (sx * 0.9, sy * 0.9, 20), 30))
    # the HD key visual (refs/HD-aramcostadiumannouncementpr.webp): high over the sign, looking down the axis
    hero.append(("CAM_KeyVisual", (math.cos(sa) * KV_DIST + math.cos(sa + math.pi / 2) * KV_SIDE,
                                   math.sin(sa) * KV_DIST + math.sin(sa + math.pi / 2) * KV_SIDE, KV_Z),
                 (math.cos(sa) * KV_AIM, math.sin(sa) * KV_AIM, 0.0), KV_LENS))
    for name, loc, target, lens in hero:
        _camera(name, coll, loc, target, lens)
    scene.camera = bpy.data.objects["CAM_Aerial_SW"]

    views = _section_views()
    # bowl overview from the back row of an upper corner section
    eye = _back_row_eye("306")
    _camera("CAM_Bowl", coll, (eye[0], eye[1], eye[2] + 1.0), (-15, -10, 6), 16)
    hero.append(("CAM_Bowl",))
    for sec in SAMPLE_SECTIONS:
        if sec in views:
            v = views[sec]
            _camera(f"CAM_Seat_{sec}", coll, v["eye"], v["target"], fov=v["fov"])
    path = os.path.join(DATA, "sections.json")
    with open(path) as f:
        doc = json.load(f)
    for s in doc["sections"]:
        s["view"] = views.get(s["id"])
    doc["hero_cameras"] = {n: {"eye": list(bpy.data.objects[n].location),
                               "lens_mm": bpy.data.objects[n].data.lens} for n, *_ in hero}
    with open(path, "w") as f:
        json.dump(doc, f, indent=1)
    return {"hero": len(hero), "section_views": len(views)}
