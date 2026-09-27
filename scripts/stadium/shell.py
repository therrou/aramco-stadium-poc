"""Roof and facade: the whirlpool of overlapping sails plus the structure under it.

The shell is a surface of revolution over two superellipses (oculus and base):
    S(phi, theta): plan = lerp(oculus(phi), base(phi), sin theta)
                   z    = zb + (z_top - zb) * cos theta
theta runs 0 (oculus rim, flat) .. SHELL_THETA_MAX (just past vertical, so the
skin tucks in slightly where it lands on the podium, as in the renders).
Each sail is a band of phi that twists CCW with theta; its leading edge is
lifted off the surface so it overlaps the next sail and leaves the lit vent gap.
"""
import math

import bpy

from . import bowl
from . import common as C
from . import params as P
from . import signage

SHOULDER = 0.8    # < 1 fills out the dome's shoulder (v5: rounder, onion-like, no flat top)
_CM = -abs(math.cos(P.SHELL_THETA_MAX)) ** SHOULDER
ZB = (P.PODIUM_Z - P.SHELL_Z_TOP * _CM) / (1 - _CM)


def height(theta):
    c = math.cos(theta)
    return ZB + (P.SHELL_Z_TOP - ZB) * math.copysign(abs(c) ** SHOULDER, c)


def surface(phi, theta):
    xi, yi = C.superellipse(P.OCULUS_A, P.OCULUS_B, P.OCULUS_N, phi)
    xo, yo = C.superellipse(P.SHELL_A, P.SHELL_B, P.SHELL_N, phi)
    f = math.sin(theta)
    return (xi + (xo - xi) * f, yi + (yo - yi) * f, height(theta))


def normal(phi, theta, h=1e-4):
    p = surface(phi, theta)
    a = surface(phi + h, theta)
    b = surface(phi, theta + h)
    du = [a[i] - p[i] for i in range(3)]
    dv = [b[i] - p[i] for i in range(3)]
    n = (du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0])
    ln = math.sqrt(sum(c * c for c in n)) or 1
    n = tuple(c / ln for c in n)
    # outward: away from the vertical axis / upward
    if n[0] * p[0] + n[1] * p[1] + n[2] * 50 < 0:
        n = tuple(-c for c in n)
    return n


SAIL_PILLOW = 5.0  # extra cross-width bulge (m): pumpkin-segment lobes with deep seams


def pillow(tv):
    """Bulge profile along a sail (tv 0 oculus .. 1 base): fullest at ~70% down, tucking in toward
    the feet so each lobe curls under onto its pointed foot (HD key visual)."""
    return 0.8 + SAIL_PILLOW * tv ** 0.6 * (1 - 0.55 * max(0.0, (tv - 0.72) / 0.28) ** 2)


def twist(theta):
    t = min(max(theta / P.SHELL_THETA_MAX, 0.0), 1.0)
    return P.SAIL_TWIST * (1 - (1 - t) ** P.SAIL_TWIST_EXP)


def theta_at_z(z):
    """Inverse of height() on [0, SHELL_THETA_MAX] (height falls monotonically with theta)."""
    lo, hi = 0.0, P.SHELL_THETA_MAX
    for _ in range(40):
        mid = (lo + hi) / 2
        if height(mid) > z:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def sail_foot(e):
    """Height (m) of a sail's lower edge across its width, e = 0 at its foot .. 1 at its lifted edge.
    It lands on the deck at the foot, arches one storey over the concourse and comes back down onto
    the neighbour's foot, so every seam ends in a point on the deck (HD key visual)."""
    return P.PODIUM_Z + P.SAIL_ARCH_H * math.sin(math.pi * e) ** 0.55 + 1.0 * e ** 3


def roof_z_at(x, y):
    """Approximate height of the shell above plan point (x, y)."""
    phi = math.atan2(y / P.SHELL_B, x / P.SHELL_A)
    xi, yi = C.superellipse(P.OCULUS_A, P.OCULUS_B, P.OCULUS_N, phi)
    xo, yo = C.superellipse(P.SHELL_A, P.SHELL_B, P.SHELL_N, phi)
    ri, ro, r = math.hypot(xi, yi), math.hypot(xo, yo), math.hypot(x, y)
    f = min(max((r - ri) / (ro - ri), 0.0), 1.0)
    return height(math.asin(f))


# --- materials -----------------------------------------------------------
LED_FULL_Z = 36.0     # LED points at full density below this height (m)
LED_FADE_Z = 50.0     # ... thinning out to none by here, clear of the oculus (key visuals)


def _skin_material():
    """Matte white membrane (v5, HD key visual: soft fabric, no chrome), one uniform finish.
    Night: LED points on the lower two thirds only."""
    mat = C.new_material("M_SailSkin")
    nt, b = mat.node_tree, C.bsdf_of(mat)
    b.inputs["Base Color"].default_value = (0.9, 0.9, 0.9, 1)
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Sheen Weight"].default_value = 0.25       # soft fabric sheen at grazing angles
    b.inputs["Coat Weight"].default_value = 0.0
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    # large, soft roughness variation only (no per-panel tint)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.02
    noise.inputs["Detail"].default_value = 2
    nt.links.new(geo.outputs["Position"], noise.inputs["Vector"])
    rough = nt.nodes.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = 0.5
    rough.inputs["To Max"].default_value = 0.6
    nt.links.new(noise.outputs["Fac"], rough.inputs["Value"])
    nt.links.new(rough.outputs[0], b.inputs["Roughness"])

    # LED points: sparse random Voronoi cells in UV (metres)
    uv = nt.nodes.new("ShaderNodeUVMap")
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.voronoi_dimensions = "2D"
    vor.inputs["Scale"].default_value = 1 / 1.1
    nt.links.new(uv.outputs["UV"], vor.inputs["Vector"])
    dot = C.math_node(nt, "LESS_THAN", vor.outputs["Distance"], 0.05)
    sepc = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(vor.outputs["Color"], sepc.inputs[0])
    # density falls with height: cell survives if its random value beats the fade
    fade = nt.nodes.new("ShaderNodeMapRange")
    fade.inputs["From Min"].default_value = LED_FULL_Z
    fade.inputs["From Max"].default_value = LED_FADE_Z
    fade.inputs["To Min"].default_value = 0.55
    fade.inputs["To Max"].default_value = 1.01
    nt.links.new(sep.outputs["Z"], fade.inputs["Value"])
    pick = C.math_node(nt, "GREATER_THAN", sepc.outputs[0], fade.outputs[0])
    led = C.math_node(nt, "MULTIPLY", dot, pick)
    tw = C.math_node(nt, "ADD", C.math_node(nt, "MULTIPLY", sepc.outputs[1], 1.5), 0.3)
    led = C.math_node(nt, "MULTIPLY", led, tw)
    strength = C.math_node(nt, "MULTIPLY", led, C.math_node(nt, "MULTIPLY", C.night_node(nt), 40.0))
    b.inputs["Emission Color"].default_value = (0.75, 0.92, 1.0, 1)
    nt.links.new(strength, b.inputs["Emission Strength"])
    mat.diffuse_color = (0.9, 0.9, 0.9, 1)
    _add_translucency(mat, 0.35, (0.9, 0.93, 0.95))
    return mat


def _add_translucency(mat, fac, color):
    """Mix a translucent lobe into the material: the sails let diffuse daylight through."""
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    b = C.bsdf_of(mat)
    tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
    tr.inputs["Color"].default_value = (*color, 1)
    mix = nt.nodes.new("ShaderNodeMixShader")
    # daylight passes through; at night the skin stays opaque so the lit
    # undersides show only through the gaps (as in the key visuals)
    day = C.math_node(nt, "SUBTRACT", 1.0, C.night_node(nt), clamp=True)
    nt.links.new(C.math_node(nt, "MULTIPLY", day, fac), mix.inputs["Fac"])
    nt.links.new(b.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])


def _under_material():
    """Underside and rims of each sail: the lit lime-green seams of the HD key visual (lit from golden
    hour on), stronger near the base."""
    mat = C.principled("M_SailUnder", (0.72, 0.85, 0.55), rough=0.55)
    nt, b = mat.node_tree, C.bsdf_of(mat)
    b.inputs["Emission Color"].default_value = (0.62, 1.0, 0.35, 1)   # lime green (HD key visual)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    h = C.math_node(nt, "DIVIDE", C.math_node(nt, "SUBTRACT", sep.outputs["Z"], P.PODIUM_Z), 36.0, clamp=True)
    glow = C.math_node(nt, "POWER", C.math_node(nt, "SUBTRACT", 1.0, h, clamp=True), 1.6)
    glow = C.math_node(nt, "ADD", C.math_node(nt, "MULTIPLY", glow, 3.5), 1.0)   # whole underside lit teal
    s = C.math_node(nt, "MULTIPLY", glow, C.night_node(nt))
    nt.links.new(s, b.inputs["Emission Strength"])
    _add_translucency(mat, 0.6, (0.95, 0.9, 0.8))
    return mat


def _steel_material():
    return C.principled("M_Steel", (0.82, 0.83, 0.84), rough=0.35, metal=0.8)


# --- geometry ------------------------------------------------------------
def _sails(coll, skin, under):
    ns, nt_ = 22, 72
    pitch = 2 * math.pi / P.SAIL_COUNT
    width = pitch * (1 + P.SAIL_OVERLAP)
    objs = []
    for k in range(P.SAIL_COUNT):
        phi0 = k * pitch
        grid, uvs = [], []
        th_low = [theta_at_z(sail_foot(1 - i / ns if P.SAIL_LIFT_TRAILING else i / ns)) for i in range(ns + 1)]
        for j in range(nt_ + 1):
            v = j / nt_
            row = []
            for i in range(ns + 1):
                s = i / ns
                # lifted side stops higher -> arched opening under the lifted edge
                e = 1 - s if P.SAIL_LIFT_TRAILING else s
                th = th_low[i] * v
                phi = phi0 + twist(th) + s * width
                px, py, pz = surface(phi, th)
                nx, ny, nz = normal(phi, th)
                tv = th / P.SHELL_THETA_MAX
                # seam step: closes at the oculus (clean rim), widest mid-way, GAP_BASE at the feet
                g = 0.5 + (P.SAIL_GAP_TOP - 0.5) * math.sin(math.pi * tv) ** 0.7 + P.SAIL_GAP_BASE * tv ** 3
                lift = g * e ** 1.35 + pillow(tv) * math.sin(math.pi * s) ** 0.8
                row.append((px + nx * lift, py + ny * lift, pz + nz * lift))
            grid.append(row)
        # UVs in metres: u across (arc length along s), v along theta
        vcum = [0.0]
        mid = ns // 2
        for j in range(1, nt_ + 1):
            a, b_ = grid[j - 1][mid], grid[j][mid]
            vcum.append(vcum[-1] + math.dist(a, b_))
        ucoord = []
        for j in range(nt_ + 1):
            u = [0.0]
            for i in range(1, ns + 1):
                u.append(u[-1] + math.dist(grid[j][i - 1], grid[j][i]))
            c = u[mid]
            ucoord.append([x - c for x in u])
        verts = [p for row in grid for p in row]
        faces, loops = [], []
        W = ns + 1
        for j in range(nt_):
            for i in range(ns):
                q = (j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i)
                faces.append(q)
                for jj, ii in ((j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i)):
                    loops.append((ucoord[jj][ii], vcum[jj]))
        obj = C.mesh_object(f"Sail_{k + 1:02d}", verts, faces, coll, [skin, under],
                            uvs=loops, smooth=True)
        # make sure face normals point outward (test one face near the middle)
        me = obj.data
        pmid = me.polygons[len(me.polygons) // 2]
        c, n = pmid.center, pmid.normal
        if c.x * n.x + c.y * n.y + n.z * 50 < 0:
            me.flip_normals()
        sol = obj.modifiers.new("Thickness", "SOLIDIFY")
        sol.thickness = P.SAIL_THICK
        sol.offset = -1
        sol.material_offset = 1
        sol.material_offset_rim = 1
        sol.use_even_offset = True
        objs.append(obj)
    return objs


def _structure(coll, steel):
    """Compression ring, radial trusses, purlins and bracing under the sails."""
    verts, edges = [], []
    heavy_v, heavy_e = [], []

    def add(lst_v, lst_e, a, b):
        ia = len(lst_v)
        lst_v += [a, b]
        lst_e.append((ia, ia + 1))

    def inner(phi, th, depth):
        p, n = surface(phi, th), normal(phi, th)
        return tuple(p[i] - n[i] * depth for i in range(3))

    n_ring = 360
    ring = [inner(2 * math.pi * i / n_ring, 0.0, 1.8) for i in range(n_ring)]
    ring_low = [(x, y, z - 4.5) for x, y, z in ring]
    for i in range(n_ring):
        add(heavy_v, heavy_e, ring[i], ring[(i + 1) % n_ring])
        add(heavy_v, heavy_e, ring_low[i], ring_low[(i + 1) % n_ring])
        if i % 4 == 0:
            add(verts, edges, ring[i], ring_low[i])
        if i % 8 == 0:
            add(verts, edges, ring[i], ring_low[(i + 4) % n_ring])

    n_rad = P.SAIL_COUNT * 2
    th_end = math.radians(88)
    steps = 26
    tops = []
    for r in range(n_rad):
        phi0 = 2 * math.pi * r / n_rad
        top, bot = [], []
        for j in range(steps + 1):
            th = th_end * j / steps
            phi = phi0 + twist(th)
            depth = 3.8 - 2.0 * (th / th_end)
            top.append(inner(phi, th, 1.6))
            bot.append(inner(phi, th, 1.6 + depth))
        tops.append(top)
        for j in range(steps):
            add(heavy_v, heavy_e, top[j], top[j + 1])
            add(heavy_v, heavy_e, bot[j], bot[j + 1])
            add(verts, edges, top[j], bot[j + 1] if j % 2 == 0 else bot[j])
            add(verts, edges, bot[j + 1], top[j + 1])
    for j in range(0, steps + 1, 2):
        for r in range(n_rad):
            a, b = tops[r][j], tops[(r + 1) % n_rad][j]
            add(verts, edges, a, b)
            if j + 2 <= steps:
                add(verts, edges, a, tops[(r + 1) % n_rad][j + 2])

    light = C.mesh_object("Roof_Bracing", verts, [], coll, edges=edges)
    C.tube_modifier(light, 0.16, steel, 6)
    heavy = C.mesh_object("Roof_Trusses", heavy_v, [], coll, edges=heavy_e)
    C.tube_modifier(heavy, 0.38, steel, 8)
    return ring_low


def _floodlights(coll, ring_low):
    """Floodlight heads on the lower compression ring (emissive at night)."""
    head = C.principled("M_FloodHead", (0.1, 0.1, 0.1), rough=0.4, metal=0.6)
    lens = C.principled("M_FloodLens", (0.9, 0.9, 0.9), rough=0.1)
    C.night_emission(lens, (0.95, 0.97, 1.0), 0.0, 120.0)
    verts, faces, mids = [], [], []
    n = len(ring_low)
    spots = []
    for i in range(0, n, 3):
        x, y, z = ring_low[i]
        # aim at pitch: unit vector toward a point on the field
        tx, ty, tz = x * 0.25, y * 0.25, 0.0
        dx, dy, dz = tx - x, ty - y, tz - z
        ln = math.sqrt(dx * dx + dy * dy + dz * dz)
        dx, dy, dz = dx / ln, dy / ln, dz / ln
        # local frame: face normal = aim
        ux, uy = -dy, dx
        ul = math.hypot(ux, uy) or 1
        ux, uy = ux / ul, uy / ul
        vx, vy, vz = dy * 0 - dz * uy, dz * ux - dx * 0, dx * uy - dy * ux
        c = (x, y, z - 0.9)
        sw, sh, depth = 0.6, 0.45, 0.4
        k = len(verts)
        for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append((c[0] + ux * a * sw + vx * b * sh, c[1] + uy * a * sw + vy * b * sh,
                          c[2] + vz * b * sh))
        for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append((c[0] + ux * a * sw + vx * b * sh - dx * depth,
                          c[1] + uy * a * sw + vy * b * sh - dy * depth,
                          c[2] + vz * b * sh - dz * depth))
        faces += [(k, k + 1, k + 2, k + 3), (k + 7, k + 6, k + 5, k + 4),
                  (k, k + 4, k + 5, k + 1), (k + 1, k + 5, k + 6, k + 2),
                  (k + 2, k + 6, k + 7, k + 3), (k + 3, k + 7, k + 4, k)]
        mids += [1, 0, 0, 0, 0, 0]
        if (i // 3) % 3 == 0:
            spots.append((c, (dx, dy, dz)))
    C.mesh_object("Floodlights", verts, faces, coll, [head, lens], mat_indices=mids)
    return spots


def _louvres(coll, steel):
    """White horizontal louvre band between the top of the upper tier and the roof."""
    lay = bowl.layout()
    plan = bowl.Plan()
    up = lay["Upper"]
    d_back = up[-1][0] + up[-1][2] + 1.2
    white = C.principled("M_Louvre", (0.85, 0.86, 0.86), rough=0.45, metal=0.2)
    C.night_emission(white, (0.1, 0.9, 0.75), 0.0, 1.4)
    step = 4
    loop = C.offset_loop(plan.pts, plan.nrm, d_back)
    nl = len(loop)
    verts, faces = [], []
    for level in range(14):
        z = 24.0 + level * 1.25
        idx = [i for i in range(0, nl, step)]
        base = len(verts)
        ok = []
        for i in idx:
            x, y = loop[i]
            nx, ny = plan.nrm[i]
            zt = roof_z_at(x, y) - 2.5
            ok.append(z < zt)
            verts += [(x, y, z), (x + nx * 0.7, y + ny * 0.7, z - 0.25)]
        m = len(idx)
        for q in range(m):
            q2 = (q + 1) % m
            if ok[q] and ok[q2]:
                faces.append((base + 2 * q, base + 2 * q2, base + 2 * q2 + 1, base + 2 * q + 1))
    C.mesh_object("Louvres", verts, faces, coll, [white])
    # vertical fins every ~6 m
    fv, fe = [], []
    for i in range(0, nl, 36):
        x, y = loop[i]
        zt = roof_z_at(x, y) - 2.0
        fv += [(x, y, 22.0), (x, y, zt)]
        fe.append((len(fv) - 2, len(fv) - 1))
    fins = C.mesh_object("Louvre_Fins", fv, [], coll, edges=fe)
    C.tube_modifier(fins, 0.22, steel, 6)
    return d_back, loop, plan


SCREEN_W, SCREEN_H = 30.0, 13.0   # m, ~2.3:1 like the key-visual screens
SCREEN_CLEAR = 3.5                # m above the upper tier's back wall to the screen's bottom edge
SCREEN_IN = 5.0                   # m in front of the louvre line (over the back rows), toward the pitch
SCREEN_TILT = math.radians(10.0)  # face tilted down toward the pitch


def _roof_bvh():
    """BVH trees of the evaluated roof trusses and bracing (built before the screens)."""
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for name in ("Roof_Trusses", "Roof_Bracing"):
        o = bpy.data.objects.get(name)
        if o is None:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        vs = [ev.matrix_world @ v.co for v in me.vertices]
        out.append(BVHTree.FromPolygons(vs, [p.vertices[:] for p in me.polygons]))
        ev.to_mesh_clear()
    return out


def _clashes(bvhs, box, margin=0.6):
    """True if the screen box (8 corners, grown by `margin` m) overlaps any of the roof BVHs."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    c = sum((Vector(p) for p in box), Vector()) / len(box)
    grown = [tuple(c + (Vector(p) - c) * (1 + margin / max((Vector(p) - c).length, 1e-6))) for p in box]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    t = BVHTree.FromPolygons(grown, faces)
    return any(t.overlap(b) for b in bvhs)


def _screens(coll, d_back, plan):
    """Big screens hung from the roof in front of the louvre band, over the upper tier's back rows,
    tilted toward the pitch, on hanger rods (refs: interior key visual). v4: they used to sit behind the
    upper tier's back wall (z 23.5-37.5 m), half hidden from the stands."""
    frame = C.principled("M_ScreenFrame", (0.78, 0.8, 0.8), rough=0.35, metal=0.6)   # light frame (interior ref)
    steel = bpy.data.materials.get("M_Steel") or _steel_material()
    scr = signage.screen_material()
    up = bowl.layout()["Upper"]
    loops = {k: C.offset_loop(plan.pts, plan.nrm, d_back - k) for k in (SCREEN_IN, SCREEN_IN + 4, SCREEN_IN + 8)}
    out, rv, re_ = [], [], []
    roof = _roof_bvh()

    def place(deg, inward, clear, w, h):
        t = math.radians(deg)
        i = int(t / (2 * math.pi) * plan.n) % plan.n
        x, y = loops[inward][i]
        nx, ny = plan.nrm[i]
        tx, ty = -ny, nx
        rows = bowl.upper_rows_at(plan.angle(i))
        top_z = up[max(0, min(int(rows), len(up)) - 1)][1] + 1.1          # back wall of the upper tier
        zc = top_z + clear + h / 2 * math.cos(SCREEN_TILT)
        v = []
        for a, bb in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            out_ = bb * h / 2 * math.sin(SCREEN_TILT)                     # top leans back, face looks down
            v.append((x + tx * a * w / 2 + nx * out_, y + ty * a * w / 2 + ny * out_,
                      zc + bb * h / 2 * math.cos(SCREEN_TILT)))
        back = [(px + nx * 0.8, py + ny * 0.8, pz) for px, py, pz in v]
        return v, back, (nx, ny, tx, ty)

    for deg in (0, 40, 140, 180, 220, 320):      # v5: corners 10 deg further out, clear of CAM_Bowl (306)
        # slide along the bowl (up to 12 deg) until the screen box clears the roof trusses and bracing
        # first fit, in order of preference: slide along the bowl (<= 6 deg), hang further in toward the pitch
        # (the roof rises inward), a little lower, then smaller. Corners: trusses ~11 deg apart, screen ~16 deg.
        found = None
        for w, h in ((SCREEN_W, SCREEN_H), (SCREEN_W * 0.85, SCREEN_H * 0.85), (SCREEN_W * 0.7, SCREEN_H * 0.7)):
            for clear in (SCREEN_CLEAR, 2.0):
                for inward in loops:
                    for off in [0] + [s_ * k * 0.5 for k in range(1, 13) for s_ in (1, -1)]:
                        v, back, fr = place(deg + off, inward, clear, w, h)
                        if not _clashes(roof, v + back):
                            found = (v, back, fr, w)
                            break
                    if found: break
                if found: break
            if found: break
        if found is None:
            found = (*place(deg, SCREEN_IN, SCREEN_CLEAR, SCREEN_W, SCREEN_H)[:3], SCREEN_W)
        v, back, (nx, ny, tx, ty), w = found
        verts = v + back
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        uv = [(1, 0), (1, 1), (0, 1), (0, 0)] + [(0, 0)] * 20   # read un-mirrored from the pitch
        obj = C.mesh_object(f"Screen_{deg}", verts, faces, coll, [scr, frame],
                            mat_indices=[0, 1, 1, 1, 1, 1], uvs=uv)
        out.append(obj.name)
        # two hanger rods from the top edge up to the roof structure
        for a in (-0.35, 0.35):
            px, py, pz = back[3] if a < 0 else back[2]
            px, py = px + tx * (-a) * w * 0.2, py + ty * (-a) * w * 0.2
            rv += [(px, py, pz), (px, py, roof_z_at(px, py) - 1.5)]
            re_.append((len(rv) - 2, len(rv) - 1))
    rods = C.mesh_object("Screen_Hangers", rv, [], coll, edges=re_)
    C.tube_modifier(rods, 0.12, steel, 6)
    return out


def _concourse(coll, d_back, plan):
    """Glazed concourse drum behind the louvres, visible through the sail gaps."""
    glass = C.new_material("M_ConcourseGlass")
    nt, b = glass.node_tree, C.bsdf_of(glass)
    b.inputs["Base Color"].default_value = (0.35, 0.42, 0.45, 1)
    b.inputs["Roughness"].default_value = 0.08
    b.inputs["Metallic"].default_value = 0.6
    C.night_emission(glass, (1.0, 0.82, 0.6), 0.0, 2.5)
    slab = C.principled("M_Slab", (0.75, 0.74, 0.72), rough=0.7)
    d_wall = d_back + 7.0
    prof = [(d_wall, 0.0), (d_wall, 28.0), (d_back, 28.0)]
    C.sweep(plan.pts, plan.nrm, prof, "Concourse_Drum", coll, [glass, slab],
            mat_of_seg=lambda j: 0 if j == 0 else 1)
    for z in (P.PODIUM_Z, 15.5, 22.0):
        prof = [(d_back - 2, z), (d_wall + 0.6, z), (d_wall + 0.6, z - 0.6), (d_back - 2, z - 0.6)]
        C.sweep(plan.pts, plan.nrm, prof, f"Concourse_Slab_{int(z)}", coll, [slab],
                closed_profile=True)
    return d_wall


BASE_GLASS_INSET = 3.2   # glazed concourse wall this far inside the sails' footprint (m)


def foot_phi(k):
    """Plan angle of sail k's foot (where its lower edge lands on the deck)."""
    pitch = 2 * math.pi / P.SAIL_COUNT
    s = 1.0 if P.SAIL_LIFT_TRAILING else 0.0
    return k * pitch + twist(P.SHELL_THETA_MAX) + s * pitch * (1 + P.SAIL_OVERLAP)


def _base_glazing(coll, steel):
    """Level-2 concourse glazing right behind the sails' feet, seen through each arch (HD key visual):
    warm-lit glass with vertical fins, a transom, and a V-column under every foot."""
    glass = C.new_material("M_BaseGlass")
    b = C.bsdf_of(glass)
    b.inputs["Base Color"].default_value = (0.55, 0.52, 0.45, 1)
    b.inputs["Roughness"].default_value = 0.12
    b.inputs["Metallic"].default_value = 0.3
    C.night_emission(glass, (1.0, 0.8, 0.55), 0.35, 3.0)     # interior light reads even at golden hour
    n = 720
    pts, nrm = [], []
    for i in range(n):
        phi = 2 * math.pi * i / n
        x, y, _ = surface(phi, P.SHELL_THETA_MAX)
        r = math.hypot(x, y)
        pts.append((x * (r - BASE_GLASS_INSET) / r, y * (r - BASE_GLASS_INSET) / r))
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i - 1], pts[(i + 1) % n]
        ln = math.hypot(x1 - x0, y1 - y0) or 1.0
        nrm.append(((y1 - y0) / ln, -(x1 - x0) / ln))
    top = P.PODIUM_Z + P.SAIL_ARCH_H + 2.5
    C.sweep(pts, nrm, [(0.0, P.PODIUM_Z), (0.0, top)], "Base_Glazing", coll, [glass])
    C.sweep(pts, nrm, [(0.0, top), (0.6, top), (0.6, top + 0.5), (-4.0, top + 0.5)],
            "Base_Soffit", coll, [steel])
    # mullion fins every ~2.4 m and a transom at 3.6 m
    fv, fe = [], []
    step = max(1, round(2.4 / (2 * math.pi * 130 / n)))
    for i in range(0, n, step):
        x, y = pts[i]
        nx, ny = nrm[i]
        fv += [(x + nx * 0.15, y + ny * 0.15, P.PODIUM_Z), (x + nx * 0.15, y + ny * 0.15, top)]
        fe.append((len(fv) - 2, len(fv) - 1))
    fins = C.mesh_object("Base_Fins", fv, [], coll, edges=fe)
    C.tube_modifier(fins, 0.09, steel, 4)
    C.sweep(pts, nrm, [(0.1, P.PODIUM_Z + 3.5), (0.35, P.PODIUM_Z + 3.5), (0.35, P.PODIUM_Z + 3.7),
                       (0.1, P.PODIUM_Z + 3.7)], "Base_Transom", coll, [steel], closed_profile=True)
    # V-columns: two struts from one deck point up to the sail's underside either side of each foot
    cv, ce = [], []
    for k in range(P.SAIL_COUNT):
        phi = foot_phi(k)
        x, y, _ = surface(phi, P.SHELL_THETA_MAX)
        r = math.hypot(x, y)
        bx, by = x * (r - 1.6) / r, y * (r - 1.6) / r
        for dphi in (-0.045, 0.045):
            tx, ty, tz = surface(phi + dphi, theta_at_z(P.PODIUM_Z + P.SAIL_ARCH_H * 0.8))
            cv += [(bx, by, P.PODIUM_Z), (tx * 0.985, ty * 0.985, tz)]
            ce.append((len(cv) - 2, len(cv) - 1))
    cols = C.mesh_object("Base_VColumns", cv, [], coll, edges=ce)
    C.tube_modifier(cols, 0.35, steel, 8)


def build(root):
    coll = C.collection("Shell", root)
    skin, under = _skin_material(), _under_material()
    steel = _steel_material()
    sails = _sails(coll, skin, under)
    ring_low = _structure(coll, steel)
    spots = _floodlights(coll, ring_low)
    d_back, _, plan = _louvres(coll, steel)
    screens = _screens(coll, d_back, plan)
    d_wall = _concourse(coll, d_back, plan)
    _base_glazing(coll, steel)
    # lighting.py reads these to place spot lamps
    import bpy
    bpy.context.scene["_flood_spots"] = [[*c, *d] for c, d in spots]
    return {"sails": len(sails), "flood_spots": len(spots), "screens": screens,
            "concourse_d": round(d_wall, 1)}
