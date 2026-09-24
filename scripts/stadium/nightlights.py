"""Night-time landscape and facade lighting, after the Aramco Stadium key visuals
(refs/dezeen_hero.jpg and the aramcostadium.com renders):

* warm wash lights on the walkway aiming up at the sails, so the shell glows
  from below and the gaps between sails read bright,
* street lamps along the highways and the ring road,
* low warm lights scattered through the park, pools of light under the trees.

All lamps are driven by scene["night"], like the rest of the scene.
"""
import math
import random

import bpy
import mathutils

from . import common as C
from . import params as P


def _lamp(coll, name, kind, energy, color, **kw):
    data = bpy.data.lights.get(name)
    if data:
        bpy.data.lights.remove(data)
    data = bpy.data.lights.new(name, kind)
    data.color = color
    for k, v in kw.items():
        setattr(data, k, v)
    obj = bpy.data.objects.new(name, data)
    coll.objects.link(obj)
    C.drive(data, "energy", f"{energy} * n")
    return obj


def _aim(obj, target):
    d = mathutils.Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def facade_wash(coll, edge_fn, count=36):
    """Area lights on the walkway, just outside the sail bases, tilted up at the shell."""
    for i in range(count):
        a = 2 * math.pi * (i + 0.5) / count
        ex, ey = edge_fn(a)
        bx, by = C.superellipse(P.SHELL_A, P.SHELL_B, P.SHELL_N, a)
        # halfway between the sail base and the walkway edge
        x, y = bx + (ex - bx) * 0.55, by + (ey - by) * 0.55
        lamp = _lamp(coll, f"Wash_{i:02d}", "AREA", 5200, (1.0, 0.82, 0.6), size=6.0)
        lamp.location = (x, y, P.PODIUM_Z + 0.4)
        _aim(lamp, (bx * 0.82, by * 0.82, P.PODIUM_Z + 26))


def street_lamps(coll, roads, ring, spacing=55.0):
    """Point lamps along each road centreline and the ring road (warm sodium-LED)."""
    k = 0
    for (x0, y0), (x1, y1), w in roads:
        ln = math.hypot(x1 - x0, y1 - y0)
        steps = int(ln // spacing)
        for s in range(steps + 1):
            t = s / steps
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            if math.hypot(x, y) > 1150:
                continue
            lamp = _lamp(coll, f"Street_{k:03d}", "POINT", 2600, (1.0, 0.72, 0.42),
                         shadow_soft_size=1.5)
            lamp.location = (x, y, 11.0)
            k += 1
    a_, b_ = ring
    n = 40
    for i in range(n):
        a = 2 * math.pi * i / n
        x, y = C.superellipse(a_, b_, 2.2, a)
        lamp = _lamp(coll, f"Street_{k:03d}", "POINT", 1600, (1.0, 0.75, 0.48), shadow_soft_size=1.0)
        lamp.location = (x, y, 8.0)
        k += 1
    return k


def park_lights(coll, blocked, count=110, seed=9):
    """Warm up-lights under the trees and along park paths."""
    rng = random.Random(seed)
    placed = 0
    tries = 0
    while placed < count and tries < 20000:
        tries += 1
        x, y = rng.uniform(-430, 430), rng.uniform(-430, 430)
        e = (x / (P.SHELL_A + 60)) ** 2 + (y / (P.SHELL_B + 60)) ** 2
        if e < 1.0 or e > 7.5 or blocked(x, y):
            continue
        lamp = _lamp(coll, f"Park_{placed:03d}", "POINT", 900, (1.0, 0.78, 0.5), shadow_soft_size=2.0)
        lamp.location = (x, y, 2.5)
        placed += 1
    return placed


def build(coll, edge_fn, roads, ring, blocked):
    facade_wash(coll, edge_fn)
    n_street = street_lamps(coll, roads, ring)
    n_park = park_lights(coll, blocked)
    return {"wash": 36, "street": n_street, "park": n_park}
