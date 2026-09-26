"""Site: elevated podium walkway, snaking bridges, park, roads, parking, city.

Layout follows the masterplan render (refs/pop_masterplan.jpg): highway on the
south-west edge, park and fan zone to the south/east, parking and training
pitches to the north-east, dense low-rise city beyond.
"""
import math
import random

import bpy

from . import common as C
from . import params as P
from . import assets
from . import bowl


def _noise_material(name, c1, c2, scale, rough=0.9, bump=0.1):
    mat = C.new_material(name)
    nt, b = mat.node_tree, C.bsdf_of(mat)
    b.inputs["Roughness"].default_value = rough
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 10
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (*c1, 1)
    mix.inputs["B"].default_value = (*c2, 1)
    nt.links.new(noise.outputs["Fac"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    bm = nt.nodes.new("ShaderNodeBump")
    bm.inputs["Strength"].default_value = bump
    nt.links.new(noise.outputs["Fac"], bm.inputs["Height"])
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    mat.diffuse_color = (*c1, 1)
    return mat


def stone_paving(name, tone=1.0):
    """Large-format granite slabs in running bond, each slab its own grey tone
    (refs/v4/plaza_ground.jpg). A generated tileable texture set, so the web export
    keeps the slabs sharp (tiled material, not a 1 texel/m procedural bake)."""
    asset = assets.granite_images()
    return assets.pbr_material(name, asset, assets.GRANITE_TILE_M,
                               ((0.34 * tone, 0.32 * tone, 0.3 * tone), (0.4 * tone, 0.38 * tone, 0.35 * tone), 1.5),
                               macro=0.12, tint=(tone, tone, tone), bump=0.6)


# Broad, smooth arms of the level-2 deck (refs/v4/announcement.jpg): (azimuth deg,
# extra width m, spread deg). Bridges leave from the arm tips; the sign arm is widest.
DECK_ARMS = [(38.0, 12.0, 13.0), (-50.0, 12.0, 13.0), (140.0, 12.0, 13.0),
             (212.0, 12.0, 12.0), (236.0, 20.0, 17.0)]


def _podium_edge(phi):
    """Outer edge of the level-2 deck: one smooth curve around the shell that
    swells into a few broad arms (no per-sail scallops)."""
    x, y = C.superellipse(P.SHELL_A, P.SHELL_B, P.SHELL_N, phi)
    r = math.hypot(x, y)
    deg = math.degrees(phi)
    w = P.PODIUM_WIDTH * 0.75
    for a, extra, spread in DECK_ARMS:
        d = (deg - a + 180.0) % 360.0 - 180.0
        w += extra * math.exp(-0.5 * (d / spread) ** 2)
    k = (r + w) / r
    return x * k, y * k


# Lightwells cut through the deck down to the shopping level, flanking the sign
# (refs/v4/announcement.jpg): triangles in (azimuth deg, fraction wall -> edge), rounded in plan.
VOIDS = [((225.0, 0.30), (230.5, 0.80), (211.0, 0.74)),
         ((247.0, 0.30), (241.5, 0.80), (261.0, 0.74))]
VOID_CORNER_R = 3.0      # plan radius of the lightwells' rounded corners (m)
DECK_RINGS = 24


def _proud(a, b_, off=0.03):
    """Segment a-b pushed `off` m to its right (outside of a CCW deck edge / lightwell rim)."""
    dx, dy = b_[0] - a[0], b_[1] - a[1]
    ln = math.hypot(dx, dy) or 1.0
    nx, ny = dy / ln * off, -dx / ln * off
    return (a[0] + nx, a[1] + ny), (b_[0] + nx, b_[1] + ny)


def rounded_polygon(corners, radius, seg=8):
    """Convex polygon with its corners filleted (radius m), counter-clockwise, as a list of (x, y)."""
    c = [tuple(p) for p in corners]
    area = sum(c[i][0] * c[(i + 1) % len(c)][1] - c[(i + 1) % len(c)][0] * c[i][1] for i in range(len(c)))
    if area < 0:
        c.reverse()
    out = []
    for i in range(len(c)):
        p0, p1, p2 = c[i - 1], c[i], c[(i + 1) % len(c)]
        ax, ay = p0[0] - p1[0], p0[1] - p1[1]
        bx, by = p2[0] - p1[0], p2[1] - p1[1]
        la, lb = math.hypot(ax, ay), math.hypot(bx, by)
        ax, ay, bx, by = ax / la, ay / la, bx / lb, by / lb
        ang = math.acos(max(-1.0, min(1.0, ax * bx + ay * by)))
        d = min(radius / math.tan(ang / 2), 0.45 * la, 0.45 * lb)
        r = d * math.tan(ang / 2)
        t0 = (p1[0] + ax * d, p1[1] + ay * d)
        t1 = (p1[0] + bx * d, p1[1] + by * d)
        hx, hy = ax + bx, ay + by
        hl = math.hypot(hx, hy) or 1.0
        k = r / math.sin(ang / 2)
        cx, cy = p1[0] + hx / hl * k, p1[1] + hy / hl * k
        a0, a1 = math.atan2(t0[1] - cy, t0[0] - cx), math.atan2(t1[1] - cy, t1[0] - cx)
        while a1 < a0:
            a1 += 2 * math.pi
        if a1 - a0 > math.pi:
            a1 -= 2 * math.pi
        for j in range(seg + 1):
            a = a0 + (a1 - a0) * j / seg
            out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out


def in_polygon(p, poly):
    c, j = False, len(poly) - 1
    for i in range(len(poly)):
        (xi, yi), (xj, yj) = poly[i], poly[j]
        if (yi > p[1]) != (yj > p[1]) and p[0] < (xj - xi) * (p[1] - yi) / (yj - yi + 1e-12) + xi:
            c = not c
        j = i
    return c


def _deck_frame(n, R):
    """(pt, edge, ins, inner, step): exact plan points on the deck grid; pt(i, r) takes float i and r."""
    lay = bowl.layout()
    plan = bowl.Plan()
    up = lay["Upper"]
    d_wall = up[-1][0] + up[-1][2] + 1.2 + 7.0
    inner = C.offset_loop(plan.pts, plan.nrm, d_wall)
    step = len(inner) / n
    edge = [_podium_edge(2 * math.pi * i / n) for i in range(n)]
    ins = [inner[int(i * step)] for i in range(n)]

    def pt(i, r):
        i0 = math.floor(i)
        t = i - i0
        a, b_ = i0 % n, (i0 + 1) % n
        ix, iy = ins[a][0] + (ins[b_][0] - ins[a][0]) * t, ins[a][1] + (ins[b_][1] - ins[a][1]) * t
        ex, ey = edge[a][0] + (edge[b_][0] - edge[a][0]) * t, edge[a][1] + (edge[b_][1] - edge[a][1]) * t
        f = r / R
        return (ix + (ex - ix) * f, iy + (ey - iy) * f)
    return pt, edge, inner, step


def void_polygons(pt, n, R):
    """The lightwells in plan: rounded triangles, corners from VOIDS (deg, f)."""
    return [rounded_polygon([pt(d / 360 * n, f * R) for d, f in tri], VOID_CORNER_R) for tri in VOIDS]


def _cut_voids(bm, polys, margin=3.0):
    """Split the deck exactly along each lightwell outline (bisect by each edge's vertical plane, only
    near that edge), then delete the faces inside: smooth rims instead of grid steps."""
    import bmesh
    from mathutils import Vector
    for poly in polys:
        for i in range(len(poly)):
            (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
            lo_x, hi_x = min(x0, x1) - margin, max(x0, x1) + margin
            lo_y, hi_y = min(y0, y1) - margin, max(y0, y1) + margin
            faces = [f for f in bm.faces if any(lo_x <= v.co.x <= hi_x and lo_y <= v.co.y <= hi_y for v in f.verts)]
            if not faces:
                continue
            edges = list({e for f in faces for e in f.edges})
            verts = list({v for f in faces for v in f.verts})
            dx, dy = x1 - x0, y1 - y0
            bmesh.ops.bisect_plane(bm, geom=faces + edges + verts, dist=1e-4,
                                   plane_co=Vector((x0, y0, 0.0)), plane_no=Vector((dy, -dx, 0.0)).normalized())
    dead = [f for f in bm.faces if any(in_polygon(tuple(f.calc_center_median())[:2], poly) for poly in polys)]
    bmesh.ops.delete(bm, geom=dead, context="FACES")


def _podium(coll, paving, under, glass, steel):
    """Level 2: the wide elevated plaza the shell lands on, with two smooth lightwells cut
    through it; level 1 (shops, columns) sits underneath."""
    import bmesh
    n, R = 720, DECK_RINGS
    pt, edge, inner, step = _deck_frame(n, R)
    top, bot = P.PODIUM_Z, P.PODIUM_Z - 1.4
    polys = void_polygons(pt, n, R)
    verts, faces, mids = [], [], []
    gv, gf = [], []
    lv, lf = [], []

    def glow(a, b_):
        """Thin lit band just proud of a fascia, near its top."""
        k = len(lv)
        lv.extend([(*a, top - 0.38), (*b_, top - 0.38), (*b_, top - 0.18), (*a, top - 0.18)])
        lf.append((k, k + 1, k + 2, k + 3))

    def quad(a, b_, z0, z1, m):
        k = len(verts)
        verts.extend([(*a, z0), (*b_, z0), (*b_, z1), (*a, z1)])
        faces.append((k, k + 1, k + 2, k + 3))
        mids.append(m)

    def rail(a, b_, lit=True):
        if lit:
            glow(*_proud(a, b_))
        k = len(gv)
        gv.extend([(*a, top), (*b_, top), (*b_, top + 1.15), (*a, top + 1.15)])
        gf.append((k, k + 1, k + 2, k + 3))

    # the full grid, top (paving) and soffit, then the lightwells cut out exactly
    grid = [[pt(i, r) for r in range(R + 1)] for i in range(n)]
    for i in range(n):
        for r in range(R):
            p00, p10, p11, p01 = grid[i][r], grid[(i + 1) % n][r], grid[(i + 1) % n][r + 1], grid[i][r + 1]
            k = len(verts)
            verts.extend([(*p00, top), (*p10, top), (*p11, top), (*p01, top)])
            faces.append((k, k + 1, k + 2, k + 3))
            mids.append(0)
            k = len(verts)
            verts.extend([(*p00, bot), (*p01, bot), (*p11, bot), (*p10, bot)])
            faces.append((k, k + 1, k + 2, k + 3))
            mids.append(1)
    for i in range(n):
        quad(grid[i][R], grid[(i + 1) % n][R], bot, top, 1)    # outer fascia
        quad(grid[(i + 1) % n][0], grid[i][0], bot, top, 1)    # against the concourse
    deck = C.mesh_object("Podium_Deck", verts, faces, coll, [paving, under], mat_indices=mids)
    bm = bmesh.new()
    bm.from_mesh(deck.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    _cut_voids(bm, polys)
    bm.to_mesh(deck.data)
    bm.free()
    # lightwell rims: wall, glass balustrade and lit line along the smooth outline (CCW: void on the left)
    wv, wf = [], []
    for poly in polys:
        for i in range(len(poly)):
            a, b_ = poly[i], poly[(i + 1) % len(poly)]
            k = len(wv)
            wv.extend([(*a, bot), (*b_, bot), (*b_, top), (*a, top)])
            wf.append((k, k + 1, k + 2, k + 3))
            rail(b_, a)                                   # right-hand side (the glow) faces the void
    C.mesh_object("Podium_WellWalls", wv, wf, coll, [under])
    # glass balustrade + lit line on the outer edge
    for i in range(n):
        rail(edge[i], edge[(i + 1) % n])
    C.mesh_object("Podium_Balustrade", gv, gf, coll, [glass])
    strip = C.principled("M_PodiumStrip", (0.9, 0.85, 0.75), rough=0.3)
    C.night_emission(strip, (1.0, 0.8, 0.55), 1.0, 6.0)
    C.mesh_object("Podium_EdgeGlow", lv, lf, coll, [strip])
    _void_stairs(coll, paving, under, pt, n, R, top)
    # level 1 columns: three rings, none inside a lightwell
    cv, ce = [], []
    for f in (0.36, 0.64, 0.9):
        for i in range(0, n, 10):
            x, y = pt(i, f * R)
            if any(in_polygon((x, y), poly) for poly in polys):
                continue
            cv += [(x, y, 0.0), (x, y, bot)]
            ce.append((len(cv) - 2, len(cv) - 1))
    cols = C.mesh_object("Podium_Columns", cv, [], coll, edges=ce)
    white = bpy.data.materials.get("M_ColumnWhite") or C.principled("M_ColumnWhite", (0.86, 0.86, 0.84), rough=0.4)
    C.tube_modifier(cols, 0.55, white, 12)
    _shopfronts(coll, inner, step, n, bot)
    # soffit strip lights along the edge (emissive, night)
    lv, lf = [], []
    for i in range(n):
        ox, oy = _podium_edge(2 * math.pi * i / n)
        r = math.hypot(ox, oy)
        kx, ky = ox / r, oy / r
        lv += [(ox - kx * 1.2, oy - ky * 1.2, bot - 0.02), (ox - kx * 0.6, oy - ky * 0.6, bot - 0.02)]
    for i in range(n):
        a, b = 2 * i, 2 * ((i + 1) % n)
        lf.append((a, a + 1, b + 1, b))
    C.mesh_object("Podium_LightStrip", lv, lf, coll, [bpy.data.materials["M_PodiumStrip"]])


def _void_stairs(coll, paving, under, pt, n, R, top):
    """A straight flight in each lightwell, from the deck down to the shopping level."""
    verts, faces, mids = [], [], []
    width, riser = 5.0, 0.18
    steps = int(round(top / riser))
    for tri in VOIDS:
        (d0, f0), (d1, f1), (d2, f2) = tri
        # from the middle of the outer side (ground) toward the inner tip (deck level)
        lo = pt((d1 + d2) / 2 / 360 * n, (f1 + f2) / 2 * R - 1.2)
        hi = pt(d0 / 360 * n, f0 * R + 2.0)
        dx, dy = hi[0] - lo[0], hi[1] - lo[1]
        ln = math.hypot(dx, dy)
        ux, uy = dx / ln, dy / ln
        sx, sy = -uy * width / 2, ux * width / 2
        run = ln / steps
        for k in range(steps):
            a0, a1 = k * run, (k + 1) * run
            z = (k + 1) * riser
            c = [(lo[0] + ux * a0 + sx, lo[1] + uy * a0 + sy), (lo[0] + ux * a1 + sx, lo[1] + uy * a1 + sy),
                 (lo[0] + ux * a1 - sx, lo[1] + uy * a1 - sy), (lo[0] + ux * a0 - sx, lo[1] + uy * a0 - sy)]
            b = len(verts)
            verts += [(x, y, z) for x, y in c] + [(x, y, z - riser) for x, y in c]
            faces += [(b, b + 3, b + 2, b + 1), (b + 4, b + 7, b + 3, b), (b + 1, b + 2, b + 6, b + 5)]
            mids += [0, 1, 1]
            # stringer faces (sides) down to the ground
            faces += [(b + 3, b + 7, b + 6, b + 2), (b, b + 1, b + 5, b + 4)]
            mids += [1, 1]
    C.mesh_object("Podium_Stairs", verts, faces, coll, [paving, under], mat_indices=mids)


SHOP_RING = 0.22      # fraction from the concourse wall to the walkway edge
SHOP_BLOCK, SHOP_GAP = 34, 6   # samples per retail unit run / open passage (1 sample ~1.3 m)


def _shopfronts(coll, inner, step, n, bot):
    """Glazed retail units under the walkway (refs/v4/plaza_ground.jpg): white
    mullions, an opaque signage band, warm lit interiors, passages between runs."""
    glass = C.new_material("M_ShopGlass")
    nt, b = glass.node_tree, C.bsdf_of(glass)
    b.inputs["Base Color"].default_value = (0.1, 0.12, 0.13, 1)
    b.inputs["Roughness"].default_value = 0.04
    b.inputs["Metallic"].default_value = 0.5
    b.inputs["Emission Color"].default_value = (1.0, 0.83, 0.62, 1)
    # shop interiors: each unit a different brightness (Voronoi cell per ~9 m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 0.11
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(vor.outputs["Color"], sep.inputs[0])
    unit = C.math_node(nt, "ADD", C.math_node(nt, "MULTIPLY", sep.outputs[0], 0.7), 0.3)
    level = C.math_node(nt, "ADD", C.math_node(nt, "MULTIPLY", C.night_node(nt), 0.9), 0.04)
    nt.links.new(C.math_node(nt, "MULTIPLY", unit, level), b.inputs["Emission Strength"])
    glass.diffuse_color = (0.1, 0.12, 0.13, 1)
    frame = bpy.data.materials.get("M_ColumnWhite") or C.principled("M_ColumnWhite", (0.86, 0.86, 0.84), rough=0.4)
    band = C.principled("M_ShopBand", (0.92, 0.92, 0.9), rough=0.35)
    C.night_emission(band, (1.0, 0.95, 0.88), 0.0, 1.2)

    z_band0, z_band1, z_top = 3.6, 4.5, bot - 0.25
    pts = []
    for i in range(n):
        ix, iy = inner[int(i * step)]
        ox, oy = _podium_edge(2 * math.pi * i / n)
        pts.append((ix + (ox - ix) * SHOP_RING, iy + (oy - iy) * SHOP_RING))
    verts, faces, mids = [], [], []
    mv, me = [], []

    def quad(a, b_, z0, z1, m):
        k = len(verts)
        verts.extend([(a[0], a[1], z0), (b_[0], b_[1], z0), (b_[0], b_[1], z1), (a[0], a[1], z1)])
        faces.append((k, k + 1, k + 2, k + 3))
        mids.append(m)

    period = SHOP_BLOCK + SHOP_GAP
    for i in range(n):
        if i % period >= SHOP_BLOCK:
            continue
        a, b_ = pts[i], pts[(i + 1) % n]
        quad(a, b_, 0.0, z_band0, 0)
        quad(a, b_, z_band0, z_band1, 1)
        quad(a, b_, z_band1, z_top, 0)
        if i % 2 == 0 or i % period == SHOP_BLOCK - 1:
            p = a if i % 2 == 0 else b_
            mv += [(p[0], p[1], 0.0), (p[0], p[1], z_top)]
            me.append((len(mv) - 2, len(mv) - 1))
        for z in (0.05, z_band0, z_band1, z_top):
            mv += [(a[0], a[1], z), (b_[0], b_[1], z)]
            me.append((len(mv) - 2, len(mv) - 1))
    C.mesh_object("Shop_Glazing", verts, faces, coll, [glass, band], mat_indices=mids)
    mul = C.mesh_object("Shop_Mullions", mv, [], coll, edges=me)
    C.tube_modifier(mul, 0.07, frame, 4)

def _bezier(pts, samples):
    """Catmull-Rom through pts [(x, y, z)]."""
    out = []
    ext = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for s in range(samples):
            t = s / samples
            out.append(tuple(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t
                                    + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t
                                    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t ** 3)
                             for k in range(3)))
    out.append(pts[-1])
    return out


def _bridge(name, path, width, coll, paving, under, glass, steel):
    verts, faces, mids = [], [], []
    gv, gf = [], []
    cv, ce = [], []
    for i, (x, y, z) in enumerate(path):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, len(path) - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(tx, ty) or 1
        nx, ny = -ty / ln * width / 2, tx / ln * width / 2
        verts += [(x + nx, y + ny, z), (x - nx, y - ny, z),
                  (x - nx, y - ny, z - 1.1), (x + nx, y + ny, z - 1.1)]
        gv += [(x + nx, y + ny, z), (x + nx, y + ny, z + 1.1),
               (x - nx, y - ny, z), (x - nx, y - ny, z + 1.1)]
        if i % 6 == 0 and z > 2.5:
            cv += [(x, y, 0.0), (x, y, z - 1.1)]
            ce.append((len(cv) - 2, len(cv) - 1))
    for i in range(len(path) - 1):
        a, b = 4 * i, 4 * (i + 1)
        faces += [(a, a + 1, b + 1, b), (a + 1, a + 2, b + 2, b + 1),
                  (a + 2, a + 3, b + 3, b + 2), (a + 3, a, b, b + 3)]
        mids += [0, 1, 1, 1]
        g, h = 4 * i, 4 * (i + 1)
        gf += [(g, h, h + 1, g + 1), (g + 2, g + 3, h + 3, h + 2)]
    C.mesh_object(name, verts, faces, coll, [paving, under], mat_indices=mids)
    C.mesh_object(name + "_Glass", gv, gf, coll, [glass])
    lv, lf = [], []
    for i, (x, y, z) in enumerate(path):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, len(path) - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(tx, ty) or 1
        nx, ny = -ty / ln, tx / ln
        for side in (-1, 1):
            o = side * (width / 2 - 0.3)
            lv += [(x + nx * o, y + ny * o, z - 1.12), (x + nx * (o - side * 0.6), y + ny * (o - side * 0.6), z - 1.12)]
    for i in range(len(path) - 1):
        for side in (0, 1):
            a, b = 4 * i + 2 * side, 4 * (i + 1) + 2 * side
            lf.append((a, b, b + 1, a + 1))
    strip = bpy.data.materials.get("M_PodiumStrip")
    C.mesh_object(name + "_Lights", lv, lf, coll, [strip or _street_glow()])
    cols = C.mesh_object(name + "_Piers", cv, [], coll, edges=ce)
    C.tube_modifier(cols, 0.5, steel, 10)


def _ground(coll):
    sand = assets.pbr_material("M_Sand", "aerial_beach_03", 20.0,
                               ((0.42, 0.31, 0.2), (0.55, 0.42, 0.29), 0.02), macro=0.25,
                               tint=(1.45, 1.1, 0.72))
    lawn = assets.pbr_material("M_Lawn", "leafy_grass", 2.0,
                               ((0.08, 0.17, 0.05), (0.16, 0.24, 0.08), 0.06), macro=0.45,
                               tint=(0.8, 1.0, 0.75))
    asphalt = assets.pbr_material("M_Asphalt", "asphalt_02", 3.0,
                                  ((0.05, 0.05, 0.055), (0.09, 0.09, 0.095), 0.5), macro=0.2,
                                  tint=(0.55, 0.55, 0.55))
    plaza = stone_paving("M_Plaza", tone=0.72)
    h = P.GROUND_SIZE / 2
    C.mesh_object("Ground", [(-h, -h, -0.05), (h, -h, -0.05), (h, h, -0.05), (-h, h, -0.05)],
                  [(0, 1, 2, 3)], coll, [sand])
    # park: blob around the stadium, open to the fan zone in the south-east
    n = 180
    rng = random.Random(7)
    wob = [rng.uniform(-1, 1) for _ in range(8)]
    park, plz = [], []
    for i in range(n):
        a = 2 * math.pi * i / n
        r = 400 + 40 * math.sin(3 * a + wob[0]) + 25 * math.sin(5 * a + wob[1])
        r += 90 * max(0.0, math.cos(a - math.radians(-40))) ** 3
        park.append((r * math.cos(a) * 1.05, r * math.sin(a), -0.02))
        plz.append((C.superellipse(P.SHELL_A + P.PODIUM_WIDTH + 18, P.SHELL_B + P.PODIUM_WIDTH + 18, 2.2, a) + (-0.01,)))
    verts = park + plz
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    C.mesh_object("Park_Lawn", verts, faces, coll, [lawn])
    # plaza under the podium
    cverts = [(0, 0, -0.01)] + plz
    cfaces = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
    C.mesh_object("Plaza", cverts, cfaces, coll, [plaza])
    return asphalt, lawn


# (start, end, width): King Fahad Rd (SW), King Saud bin Abdulaziz Rd (W), local (NE)
ROADS = [((-1300, -600), (1300, -30), 64), ((-640, -1300), (-300, 1300), 50),
         ((1300, 380), (-300, 1300), 30)]


def road_distance(x, y):
    """Distance from (x, y) to the nearest road edge (negative = on the road)."""
    best = 1e9
    for (x0, y0), (x1, y1), w in ROADS:
        tx, ty = x1 - x0, y1 - y0
        ln2 = tx * tx + ty * ty
        u = max(0.0, min(1.0, ((x - x0) * tx + (y - y0) * ty) / ln2))
        best = min(best, math.hypot(x - x0 - u * tx, y - y0 - u * ty) - w / 2)
    return best


def _roads(coll, asphalt):
    """King Fahad Rd (SW, 8 lanes) and King Saud bin Abdulaziz Rd (NW)."""
    line = C.principled("M_RoadLine", (0.8, 0.78, 0.7), rough=0.6)
    for k, ((x0, y0), (x1, y1), w) in enumerate(ROADS):
        tx, ty = x1 - x0, y1 - y0
        ln = math.hypot(tx, ty)
        nx, ny = -ty / ln * w / 2, tx / ln * w / 2
        C.mesh_object(f"Road_{k}", [(x0 + nx, y0 + ny, 0.0), (x1 + nx, y1 + ny, 0.0),
                                    (x1 - nx, y1 - ny, 0.0), (x0 - nx, y0 - ny, 0.0)],
                      [(0, 1, 2, 3)], coll, [asphalt])
        # dashed lane lines
        lanes = int(w // 8)
        verts, faces = [], []
        for L in range(1, lanes):
            off = -w / 2 + L * w / lanes
            ox, oy = -ty / ln * off, tx / ln * off
            for s in range(0, int(ln), 12):
                ax, ay = x0 + tx / ln * s + ox, y0 + ty / ln * s + oy
                bx, by = ax + tx / ln * 5, ay + ty / ln * 5
                px, py = -ty / ln * 0.08, tx / ln * 0.08
                q = len(verts)
                verts += [(ax + px, ay + py, 0.02), (bx + px, by + py, 0.02),
                          (bx - px, by - py, 0.02), (ax - px, ay - py, 0.02)]
                faces.append((q, q + 1, q + 2, q + 3))
        C.mesh_object(f"Road_{k}_Lines", verts, faces, coll, [line])
        # street lighting: warm glow strips along both kerbs and the median (night only)
        sv, sf = [], []
        for off in (-w / 2 + 1.5, 0.0, w / 2 - 1.5):
            ox, oy = -ty / ln * off, tx / ln * off
            px, py = -ty / ln * 1.2, tx / ln * 1.2
            q = len(sv)
            sv += [(x0 + ox - px, y0 + oy - py, 0.03), (x1 + ox - px, y1 + oy - py, 0.03),
                   (x1 + ox + px, y1 + oy + py, 0.03), (x0 + ox + px, y0 + oy + py, 0.03)]
            sf.append((q, q + 1, q + 2, q + 3))
        C.mesh_object(f"Road_{k}_Glow", sv, sf, coll, [_street_glow()])


def _street_glow():
    mat = bpy.data.materials.get("M_StreetGlow")
    if mat is None:
        mat = C.principled("M_StreetGlow", (0.08, 0.08, 0.08), rough=0.8)
        C.night_emission(mat, (1.0, 0.62, 0.3), 0.0, 3.0)
    return mat


def _box_mesh(name, boxes, coll, mats, mat_of_box=None, uvs=False):
    """Many axis-aligned (rotated about Z) boxes in one mesh."""
    verts, faces, mids = [], [], []
    for bi, (cx, cy, w, d, h, rot) in enumerate(boxes):
        c, s = math.cos(rot), math.sin(rot)
        q = len(verts)
        for z in (0.0, h):
            for ax, ay in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
                verts.append((cx + ax * c - ay * s, cy + ax * s + ay * c, z))
        faces += [(q + 4, q + 5, q + 6, q + 7), (q, q + 1, q + 5, q + 4), (q + 1, q + 2, q + 6, q + 5),
                  (q + 2, q + 3, q + 7, q + 6), (q + 3, q, q + 4, q + 7)]
        m = mat_of_box(bi) if mat_of_box else 0
        mids += [m] * 5
    return C.mesh_object(name, verts, faces, coll, mats, mat_indices=mids)


def _city(coll):
    rng = random.Random(11)
    walls = [C.principled(f"M_Building{i}", col, rough=0.8) for i, col in enumerate(
        [(0.42, 0.36, 0.28), (0.52, 0.46, 0.38), (0.36, 0.31, 0.25)])]
    boxes = []
    for _ in range(2600):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(560, 1250)
        x, y = r * math.cos(a) * 1.05, r * math.sin(a)
        if road_distance(x, y) < 30:
            continue
        h = rng.choice([7, 10, 10, 13, 16, 20]) * (3.0 if rng.random() < 0.03 else 1.0)
        boxes.append((x, y, rng.uniform(14, 40), rng.uniform(14, 36), h, rng.choice([0.3, 0.3, 1.87])))
    # two towers south-west of the stadium (as in the aerial renders)
    boxes += [(-230, -420, 34, 34, 150, 0.3), (-180, -405, 34, 34, 150, 0.3)]
    for m in walls:
        _lit_windows(m)
    _box_mesh("City", boxes, coll, walls, mat_of_box=lambda i: rng.randrange(len(walls)))
    return len(boxes)


def _lit_windows(mat):
    """Night: scattered warm window light on facades (noise cells on object coords)."""
    nt, b = mat.node_tree, C.bsdf_of(mat)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 0.9       # roughly one cell per window bay
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(vor.outputs["Color"], sep.inputs[0])
    lit = C.math_node(nt, "GREATER_THAN", sep.outputs[0], 0.93)
    s = C.math_node(nt, "MULTIPLY", lit, C.math_node(nt, "MULTIPLY", C.night_node(nt), 0.3))
    b.inputs["Emission Color"].default_value = (1.0, 0.72, 0.42, 1)
    nt.links.new(s, b.inputs["Emission Strength"])


# Palm-lined entrance plaza (bearing, length, width). These lived only in the Blender session's module
# globals and were never committed; recovered from the saved Entrance_Plaza mesh (v4).
ENTRANCE_DEG, ENTRANCE_LEN, ENTRANCE_W = 262.0, 115.0, 56.0


def _entrance_frame():
    a = math.radians(ENTRANCE_DEG)
    ox, oy = _podium_edge(a)
    ux, uy = math.cos(a), math.sin(a)          # outward axis
    return ox, oy, ux, uy, -uy, ux             # origin, axis, side


def _entrance_palm_rows():
    ox, oy, ux, uy, sx, sy = _entrance_frame()
    pts = []
    for k in range(1, 15):
        t = k * ENTRANCE_LEN / 15
        for side in (-1, 1):
            off = side * (ENTRANCE_W / 2 - 3)
            pts.append((ox + ux * t + sx * off, oy + uy * t + sy * off))
    return pts


def _entrance_plaza(coll, paving):
    ox, oy, ux, uy, sx, sy = _entrance_frame()
    hw = ENTRANCE_W / 2
    v = []
    for t, w in ((-25, hw + 25), (ENTRANCE_LEN * 0.35, hw), (ENTRANCE_LEN + 10, hw)):
        v += [(ox + ux * t - sx * w, oy + uy * t - sy * w, 0.01),
              (ox + ux * t + sx * w, oy + uy * t + sy * w, 0.01)]
    f = [(0, 1, 3, 2), (2, 3, 5, 4)]
    C.mesh_object("Entrance_Plaza", v, f, coll, [paving])


def _scatter_group(model):
    name = f"GN_Scatter_{model.name}"
    ng = bpy.data.node_groups.get(name)
    if ng:
        bpy.data.node_groups.remove(ng)
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nd, ln = ng.nodes, ng.links
    gi, go = nd.new("NodeGroupInput"), nd.new("NodeGroupOutput")
    oi = nd.new("GeometryNodeObjectInfo")
    oi.inputs["Object"].default_value = model
    oi.inputs["As Instance"].default_value = True
    oi.transform_space = "ORIGINAL"
    inst = nd.new("GeometryNodeInstanceOnPoints")
    rot = nd.new("FunctionNodeRandomValue")
    rot.data_type = "FLOAT_VECTOR"
    rot.inputs["Max"].default_value = (0, 0, 6.283)
    sc = nd.new("GeometryNodeInputNamedAttribute")
    sc.data_type = "FLOAT"
    sc.inputs["Name"].default_value = "scale_f"
    # Object Info drops the model's own scale: multiply it back in
    mul = nd.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = model.scale[0]
    ln.new(sc.outputs["Attribute"], mul.inputs[0])
    ln.new(gi.outputs[0], inst.inputs["Points"])
    ln.new(oi.outputs["Geometry"], inst.inputs["Instance"])
    ln.new(rot.outputs["Value"], inst.inputs["Rotation"])
    ln.new(mul.outputs[0], inst.inputs["Scale"])
    ln.new(inst.outputs[0], go.inputs[0])
    return ng


FAN_ZONE = (215, -150, 62)       # paved plaza under the SE canopies (cx, cy, radius)


def _fan_zone(coll, paving):
    cx, cy, r = FAN_ZONE
    n = 72
    v = [(cx, cy, 0.012)]
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = r * (1 + 0.15 * math.sin(3 * a + 0.5))
        v.append((cx + rr * math.cos(a) * 1.2, cy + rr * math.sin(a), 0.012))
    f = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
    C.mesh_object("FanZone_Plaza", v, f, coll, [paving])


def build(root):
    from . import landscape as L
    coll = C.collection("Site", root)
    paving = stone_paving("M_Paving", tone=0.8)
    under = C.principled("M_DeckUnder", (0.88, 0.87, 0.85), rough=0.6)   # white soffit (plaza ref)
    glass = C.principled("M_Balustrade", (0.8, 0.9, 0.9), rough=0.05, transmission=1.0)
    steel = bpy.data.materials.get("M_Steel") or C.principled("M_Steel", (0.82, 0.83, 0.84), rough=0.35, metal=0.8)
    _podium(coll, paving, under, glass, steel)
    # bridges snake out of the walkway over the ring road to the car parks and plazas
    z = P.PODIUM_Z
    bridges = {
        "Bridge_NE": [(*_podium_edge(math.radians(38)), z), (215, 150, z), (250, 250, z - 1),
                      (230, 380, z - 3), (300, 460, 3.0), (380, 500, 0.3)],
        "Bridge_SE": [(*_podium_edge(math.radians(-50)), z), (150, -190, z), (205, -215, z - 2),
                      (250, -190, 3.5), (285, -160, 0.3)],
        "Bridge_SW": [(*_podium_edge(math.radians(215)), z), (-215, -150, z), (-245, -250, z),
                      (-200, -340, z), (-150, -430, z), (-140, -520, 0.3)],
        "Bridge_NW": [(*_podium_edge(math.radians(140)), z), (-205, 150, z), (-250, 190, z - 2),
                      (-300, 170, 3.0), (-340, 130, 0.3)],
    }
    paths = {}
    for name, pts in bridges.items():
        paths[name] = _bezier(pts, 24)
        _bridge(name, paths[name], 11.0, coll, paving, under, glass, steel)
    asphalt, lawn = _ground(coll)
    _roads(coll, asphalt)
    L.ring_road(coll, asphalt)
    ncars, island_trees = L.car_parks(coll, asphalt, lawn)
    nbld = _city(coll)
    _entrance_plaza(coll, paving)
    _fan_zone(coll, paving)
    L.canopies(coll, steel, paths.values())

    ex, ey, ux, uy, sx, sy = _entrance_frame()
    fx, fy, fr = FAN_ZONE

    def blocked(x, y):
        e = (x / (P.SHELL_A + P.PODIUM_WIDTH + 6)) ** 2 + (y / (P.SHELL_B + P.PODIUM_WIDTH + 6)) ** 2
        if e < 1.0 or L.ring_distance(x, y) < L.RING_W / 2 + 3:
            return True
        if L.in_lot(x, y, 2.0) or road_distance(x, y) < 6:
            return True
        if math.hypot((x - fx) / 1.2, y - fy) < fr:
            return True
        t, w = (x - ex) * ux + (y - ey) * uy, (x - ex) * sx + (y - ey) * sy
        if -30 < t < ENTRANCE_LEN + 12 and abs(w) < ENTRANCE_W / 2 + 4:
            return True
        ang = math.degrees(math.atan2(y, x)) % 360       # keep the sign's sightline open
        if 226 < ang < 246 and e < 2.4:
            return True
        for path in paths.values():
            for px, py, pz in path[::3]:
                if pz < 4 and math.hypot(x - px, y - py) < 9:
                    return True
        return False

    park = bpy.data.objects["Park_Lawn"].data
    poly = [(v.co.x, v.co.y) for v in park.vertices[:len(park.vertices) // 2]]
    ntrees = L.scatter_trees(coll, poly, blocked, island_trees, _entrance_palm_rows())

    rng = random.Random(21)

    def on_podium(r):
        a = r.uniform(0, 2 * math.pi)
        if abs(math.degrees(a) - 236) < 26:       # keep the strip behind the sign clear
            return None
        bx, by = C.superellipse(P.SHELL_A + 1.5, P.SHELL_B + 1.5, P.SHELL_N, a)
        ox, oy = _podium_edge(a)
        f = r.uniform(0.0, 1.0)
        return (bx + (ox - bx) * f * 0.92, by + (oy - by) * f * 0.92, P.PODIUM_Z)

    def on_bridge(r):
        path = paths[r.choice(list(paths))]
        i = r.randrange(len(path) - 1)
        (x0, y0, z0), (x1, y1, _) = path[i], path[i + 1]
        tx, ty = x1 - x0, y1 - y0
        ln = math.hypot(tx, ty) or 1
        w = r.uniform(-4.5, 4.5)
        return (x0 - ty / ln * w, y0 + tx / ln * w, z0)

    def on_entrance(r):
        t, w = r.uniform(-10, ENTRANCE_LEN), r.uniform(-ENTRANCE_W / 2 + 2, ENTRANCE_W / 2 - 2)
        return (ex + ux * t + sx * w, ey + uy * t + sy * w, 0.0)

    def on_fanzone(r):
        a, d = r.uniform(0, 2 * math.pi), fr * math.sqrt(r.random())
        return (fx + d * math.cos(a) * 1.2, fy + d * math.sin(a), 0.0)

    # no crowd on the entrance plaza: the approach camera sees it up close (simple figures)
    npeople = L.crowds(coll, [on_podium] * 5 + [on_bridge] * 2 + [on_fanzone],
                       4200, rng)
    sign = L.sign(coll, _podium_edge)
    from . import nightlights
    lamps = nightlights.build(C.collection("NightLights", coll), _podium_edge, ROADS,
                              (L.RING_A, L.RING_B), blocked)
    return {"cars": ncars, "buildings": nbld, "trees": ntrees, "people": npeople, "sign": sign, "lamps": lamps}
