"""Landscape around the stadium, laid out after the Populous / Aramco Stadium renders
(refs/dezeen_hero.jpg, refs/pop_aerial*.jpg and the aramcostadium.com key visuals):

* a ground-level ring road just outside the elevated walkway,
* surface car parks tucked between the ring road and the highways, with tree islands,
* dense, clustered planting (broadleaf + date palms) filling everything else,
* white organic shade canopies over the fan-zone plazas,
* crowds on the walkway, bridges and plazas,
* the "aramco stadium" sign standing on the walkway at the south-west entrance.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import assets
from . import common as C
from . import params as P

RING_A, RING_B, RING_W = P.SHELL_A + P.PODIUM_WIDTH + 34, P.SHELL_B + P.PODIUM_WIDTH + 34, 13.0

# (cx, cy, width, depth, rotation) - between the ring road and the arterial roads
LOTS = [
    (40, -262, 250, 62, 0.215),     # south, along King Fahad Rd (dezeen hero foreground)
    (292, 40, 96, 210, 0.0),         # east
    (120, 268, 200, 84, 0.0),        # north
    (-230, 238, 150, 96, -0.35),     # north-west
    (-300, -40, 70, 170, 0.0),       # west
]
BAY = 16.0          # one double row of stalls + aisle
STALL = 2.7


def _local(x, y, lot):
    cx, cy, w, d, rot = lot
    c, s = math.cos(-rot), math.sin(-rot)
    dx, dy = x - cx, y - cy
    return dx * c - dy * s, dx * s + dy * c


def in_lot(x, y, margin=0.0):
    for lot in LOTS:
        lx, ly = _local(x, y, lot)
        if abs(lx) < lot[2] / 2 + margin and abs(ly) < lot[3] / 2 + margin:
            return True
    return False


def ring_distance(x, y):
    """Approximate distance to the ring road centreline (superellipse)."""
    a = math.atan2(y / RING_B, x / RING_A)
    rx, ry = C.superellipse(RING_A, RING_B, 2.2, a)
    return abs(math.hypot(x, y) - math.hypot(rx, ry))


# --- ring road ---------------------------------------------------------------
def ring_road(coll, asphalt):
    n = 360
    pts, nrm = C.plan_loop(RING_A, RING_B, 2.2, n)
    prof = [(-RING_W / 2, 0.02), (RING_W / 2, 0.02)]
    C.sweep(pts, nrm, prof, "Ring_Road", coll, [asphalt])
    glow = bpy.data.materials.get("M_StreetGlow")
    if glow:
        C.sweep(pts, nrm, [(-RING_W / 2 + 0.4, 0.035), (-RING_W / 2 + 1.4, 0.035)],
                "Ring_Road_Glow", coll, [glow])


# --- car parks -----------------------------------------------------------------
def _car_boxes(rng):
    cars, cabins, islands, lots = [], [], [], []
    for lot in LOTS:
        cx, cy, w, d, rot = lot
        lots.append((cx, cy, w, d, 0.03, rot))
        c, s = math.cos(rot), math.sin(rot)

        def world(lx, ly):
            return cx + lx * c - ly * s, cy + lx * s + ly * c

        bays = int(d // BAY)
        for b in range(bays):
            y0 = -d / 2 + b * BAY + 2.5
            if b % 3 == 2:      # every third bay is a planted island
                ix, iy = world(0, y0 + 5)
                islands.append((ix, iy, w - 8, 3.5, 0.18, rot))
                continue
            for row_y in (y0, y0 + 5.2):
                x = -w / 2 + 4
                while x < w / 2 - 4:
                    if rng.random() < 0.72:
                        px, py = world(x, row_y + 2.3)
                        yaw = rot + math.pi / 2 + rng.uniform(-0.04, 0.04)
                        cars.append((px, py, 1.8, 4.5, 0.85, yaw))
                        cabins.append((px, py, 1.6, 2.4, 1.45, yaw))
                    x += STALL
    return cars, cabins, islands, lots


def car_parks(coll, asphalt, lawn):
    rng = random.Random(3)
    cars, cabins, islands, lots = _car_boxes(rng)
    from .site import _box_mesh
    _box_mesh("Parking_Lots", lots, coll, [asphalt])
    _box_mesh("Parking_Islands", islands, coll, [lawn])
    paints = [C.principled(f"M_Car{i}", col, rough=0.22, metal=0.7) for i, col in enumerate(
        [(0.82, 0.82, 0.8), (0.04, 0.04, 0.045), (0.45, 0.46, 0.48), (0.55, 0.05, 0.04),
         (0.1, 0.15, 0.32), (0.75, 0.72, 0.62)])]
    glass = bpy.data.materials.get("M_CarGlass") or C.principled("M_CarGlass", (0.02, 0.025, 0.03), rough=0.05, metal=0.3)
    picks = [rng.randrange(len(paints)) for _ in cars]
    _box_mesh("Cars", cars, coll, paints, mat_of_box=lambda i: picks[i])
    _box_mesh("Car_Cabins", cabins, coll, [glass])
    # island tree positions (returned to the tree scatter)
    trees = []
    for lot in LOTS:
        cx, cy, w, d, rot = lot
        c, s = math.cos(rot), math.sin(rot)
        bays = int(d // BAY)
        for b in range(bays):
            if b % 3 != 2:
                continue
            y0 = -d / 2 + b * BAY + 2.5 + 5
            x = -w / 2 + 8
            while x < w / 2 - 8:
                trees.append((cx + x * c - y0 * s, cy + x * s + y0 * c))
                x += 9.0
    return len(cars), trees


# --- planting ------------------------------------------------------------------
def _density(x, y):
    """Clumpy 0..1 field: groves and clearings like a landscaped park."""
    v = (math.sin(x / 37.0 + 1.3) * math.cos(y / 29.0 - 0.7)
         + 0.6 * math.sin((x + y) / 17.0) * math.cos((x - y) / 23.0 + 2.1)
         + 0.35 * math.sin(x / 9.0 + y / 11.0))
    return 0.5 + v / 3.9


def tree_points(park_poly, blocked, extra, rng):
    """Jittered grid over the park, thinned by the density field."""
    def inside(x, y):
        c, j = False, len(park_poly) - 1
        for i in range(len(park_poly)):
            xi, yi = park_poly[i]
            xj, yj = park_poly[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi:
                c = not c
            j = i
        return c

    pts = []
    step = 6.5
    g = 520
    for gx in range(-g, g, int(step)):
        for gy in range(-g, g, int(step)):
            x, y = gx + rng.uniform(-2.8, 2.8), gy + rng.uniform(-2.8, 2.8)
            if _density(x, y) < 0.52 or not inside(x, y) or blocked(x, y):
                continue
            pts.append((x, y, False))
    pts += [(x, y, True) for x, y in extra]
    return pts


def scatter_trees(coll, park_poly, blocked, extra_island, extra_palm):
    lib, models = assets.tree_library()
    palms = [m for m in models if m.startswith("Palm_")]
    broad = [m for m in models if m not in palms] or palms
    rng = random.Random(5)
    buckets = {m: ([], []) for m in models}
    pts = tree_points(park_poly, blocked, extra_island, rng)
    for x, y, island in pts:
        near = (x / (P.SHELL_A + 70)) ** 2 + (y / (P.SHELL_B + 70)) ** 2 < 1.6
        palm = island and rng.random() < 0.6 or rng.random() < (0.45 if near else 0.22)
        m = rng.choice(palms if palm else broad)
        buckets[m][0].append((x, y, 0.0))
        buckets[m][1].append(rng.uniform(0.8, 1.3))
    for x, y in extra_palm:
        m = palms[len(buckets[palms[0]][0]) % len(palms)]
        buckets[m][0].append((x, y, 0.0))
        buckets[m][1].append(rng.uniform(0.95, 1.1))
    from .site import _scatter_group
    total = 0
    for m, (p, sc) in buckets.items():
        me = bpy.data.meshes.new(f"TreePoints_{m}")
        me.from_pydata(p, [], [])
        at = me.attributes.new("scale_f", "FLOAT", "POINT")
        at.data.foreach_set("value", sc)
        obj = bpy.data.objects.new(f"Trees_{m}", me)
        coll.objects.link(obj)
        obj.modifiers.new("Trees", "NODES").node_group = _scatter_group(bpy.data.objects[m])
        total += len(p)
    return total


# --- shade canopies ----------------------------------------------------------
CANOPIES = [  # (cx, cy, length, width, rotation, height)
    (205, -175, 70, 24, 0.9, 7.5),
    (250, -110, 34, 30, 0.2, 6.5),
    (-205, -150, 56, 22, -0.6, 7.0),
    (-170, 175, 40, 26, 0.4, 6.5),
]


def canopies(coll, steel):
    mat = C.principled("M_Canopy", (0.93, 0.93, 0.9), rough=0.4)
    C.night_emission(mat, (1.0, 0.92, 0.8), 0.0, 0.5)
    b = C.bsdf_of(mat)
    b.inputs["Transmission Weight"].default_value = 0.15
    col_v, col_e = [], []
    for k, (cx, cy, L, W, rot, h) in enumerate(CANOPIES):
        n, rings = 72, 6
        c, s = math.cos(rot), math.sin(rot)
        verts, faces = [], []
        for r in range(rings + 1):
            f = 1 - r / rings                     # 1 = rim, 0 = centre
            for i in range(n):
                a = 2 * math.pi * i / n
                wob = 1 + 0.12 * math.sin(2 * a + k) + 0.08 * math.sin(3 * a)
                # kidney/lens shape: pinch one side
                lx = L / 2 * math.cos(a) * wob * f
                ly = W / 2 * math.sin(a) * wob * f * (1 - 0.35 * math.cos(a) ** 2)
                z = h + 1.6 * (1 - f * f)
                verts.append((cx + lx * c - ly * s, cy + lx * s + ly * c, z))
        for r in range(rings):
            for i in range(n):
                a0, a1 = r * n + i, r * n + (i + 1) % n
                faces.append((a0, a1, a1 + n, a0 + n))
        obj = C.mesh_object(f"Canopy_{k}", verts, faces, coll, [mat], smooth=True)
        sol = obj.modifiers.new("Thick", "SOLIDIFY")
        sol.thickness = 0.25
        for q in range(6):
            a = 2 * math.pi * (q + 0.5) / 6
            lx, ly = L / 3.2 * math.cos(a), W / 3.2 * math.sin(a)
            x, y = cx + lx * c - ly * s, cy + lx * s + ly * c
            col_v += [(x, y, 0), (x, y, h + 0.2)]
            col_e.append((len(col_v) - 2, len(col_v) - 1))
    cols = C.mesh_object("Canopy_Columns", col_v, [], coll, edges=col_e)
    C.tube_modifier(cols, 0.18, steel, 8)


# --- people ------------------------------------------------------------------
def _person_mesh(name, mat):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.26, radius2=0.2,
                          depth=1.45, matrix=Matrix.Translation((0, 0, 0.72)))
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.12,
                              matrix=Matrix.Translation((0, 0, 1.58)))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    me.shade_smooth()
    return me


def crowds(coll, areas, count, rng):
    """areas: list of callables returning a random (x, y, z) or None."""
    looks = [("White", (0.85, 0.84, 0.8)), ("Dark", (0.03, 0.03, 0.035)),
             ("Green", (0.02, 0.35, 0.16)), ("Mixed", (0.35, 0.3, 0.26))]
    weights = [0.38, 0.27, 0.25, 0.10]
    lib = bpy.data.collections.get("PeopleModels") or bpy.data.collections.new("PeopleModels")
    models = []
    for name, col in looks:
        mat = bpy.data.materials.get(f"M_Person{name}") or C.principled(f"M_Person{name}", col, rough=0.8)
        obj = bpy.data.objects.get(f"Person_{name}")
        me = _person_mesh(f"PersonMesh_{name}", mat)
        if obj is None:
            obj = bpy.data.objects.new(f"Person_{name}", me)
        else:
            old = obj.data
            obj.data = me          # swap first; removing a mesh in use deletes its object
            if old is not None and old.users == 0:
                bpy.data.meshes.remove(old)
        if obj.name not in lib.objects:
            lib.objects.link(obj)
        models.append(obj)
    buckets = [[] for _ in models]
    placed = 0
    while placed < count:
        area = rng.choice(areas)
        p = area(rng)
        if p is None:
            continue
        k = rng.choices(range(len(models)), weights)[0]
        buckets[k].append(p)
        placed += 1
    from .site import _scatter_group
    for obj, pts in zip(models, buckets):
        me = bpy.data.meshes.new(f"CrowdPoints_{obj.name}")
        me.from_pydata(pts, [], [])
        at = me.attributes.new("scale_f", "FLOAT", "POINT")
        at.data.foreach_set("value", [rng.uniform(0.9, 1.1) for _ in pts])
        o = bpy.data.objects.new(f"Crowd_{obj.name}", me)
        coll.objects.link(o)
        o.modifiers.new("Crowd", "NODES").node_group = _scatter_group(obj)
    return placed


# --- sign ----------------------------------------------------------------------
SIGN_INSET = 0.25     # metres inside the walkway's outer edge: mounted on the parapet
SIGN_BASE = 1.15      # parapet (glass balustrade) height above the deck


def _edge_path(edge_fn, deg, span, inset, n=240):
    """Points along the scalloped walkway edge, inset toward the stadium, CCW."""
    pts = []
    for i in range(n + 1):
        a = math.radians(deg - span / 2 + span * i / n)
        x, y = edge_fn(a)
        r = math.hypot(x, y)
        pts.append(Vector((x * (r - inset) / r, y * (r - inset) / r, P.PODIUM_Z + SIGN_BASE)))
    return pts


def sign(coll, edge_fn, deg=236.0):
    """White lowercase letters standing on the walkway deck and bent along its
    scalloped edge (Curve modifier), readable from outside."""
    mat = C.principled("M_SignWhite", (0.95, 0.95, 0.95), rough=0.3)
    C.night_emission(mat, (1.0, 1.0, 1.0), 0.4, 14.0)
    for name, kind in (("SignText", "FONT"), ("SignPath", "CURVE")):
        old = bpy.data.curves.get(name)
        if old:
            bpy.data.curves.remove(old)
    text = bpy.data.curves.new("SignText", "FONT")
    text.body = "aramco stadium"
    text.align_x = "LEFT"
    text.size = 6.0
    text.extrude = 0.18
    text.bevel_depth = 0.02
    text.space_character = 0.95
    text.materials.append(mat)
    obj = bpy.data.objects.new("Sign_AramcoStadium", text)
    coll.objects.link(obj)
    # letters stand upright: local text plane XY -> world XZ
    obj.rotation_euler = (math.pi / 2, 0, 0)
    bpy.context.view_layer.update()
    width = obj.dimensions.x

    # path along the walkway edge, long enough for the text plus margin
    pts = _edge_path(edge_fn, deg, 60.0, SIGN_INSET)
    length = sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))
    cdata = bpy.data.curves.new("SignPath", "CURVE")
    cdata.dimensions = "3D"
    cdata.twist_mode = "Z_UP"
    spl = cdata.splines.new("POLY")
    spl.points.add(len(pts) - 1)
    for p, v in zip(spl.points, pts):
        p.co = (v.x, v.y, v.z, 1.0)
    path = bpy.data.objects.new("Sign_Path", cdata)
    coll.objects.link(path)
    path.hide_render = True

    # text starts so it is centred on the path; Curve modifier maps local X to arc length
    obj.location = ((length - width) / 2, 0, 0)
    mod = obj.modifiers.new("FollowWalkway", "CURVE")
    mod.object = path
    mod.deform_axis = "POS_X"
    return obj.name
