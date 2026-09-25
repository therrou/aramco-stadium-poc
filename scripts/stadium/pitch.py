"""Pitch: grass with mowing stripes, FIFA markings, goals, LED boards, dugouts."""
import math

import bpy

from . import common as C
from . import params as P
from . import signage

LINE_W = 0.12
LINE_Z = 0.012


def _grass_material():
    mat = C.new_material("M_Grass")
    nt = mat.node_tree
    b = C.bsdf_of(mat)
    b.inputs["Roughness"].default_value = 0.85
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    # 20 stripes over the field length -> 5.25 m bands
    band = C.math_node(nt, "DIVIDE", sep.outputs["X"], P.FIELD_L / 20, x=-800, y=0)
    band = C.math_node(nt, "FLOOR", band, x=-650, y=0)
    band = C.math_node(nt, "MODULO", band, 2.0, x=-500, y=0)
    band = C.math_node(nt, "ABSOLUTE", band, x=-350, y=0)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.35
    noise.inputs["Detail"].default_value = 8
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeMix")
    ramp.data_type = "RGBA"
    ramp.inputs["A"].default_value = (0.045, 0.16, 0.035, 1)
    ramp.inputs["B"].default_value = (0.07, 0.23, 0.05, 1)
    nt.links.new(band, ramp.inputs["Factor"])
    mix2 = nt.nodes.new("ShaderNodeMix")
    mix2.data_type = "RGBA"
    mix2.blend_type = "MULTIPLY"
    mix2.inputs["Factor"].default_value = 0.35
    nt.links.new(ramp.outputs["Result"], mix2.inputs["A"])
    nt.links.new(noise.outputs["Color"], mix2.inputs["B"])
    nt.links.new(mix2.outputs["Result"], b.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    fine = nt.nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 400
    nt.links.new(tc.outputs["Object"], fine.inputs["Vector"])
    nt.links.new(fine.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    mat.diffuse_color = (0.06, 0.2, 0.045, 1)
    return mat


def _strip(points, w):
    """Quad strip of width w along an open polyline of (x, y)."""
    verts, faces = [], []
    for i, (x, y) in enumerate(points):
        a = points[max(i - 1, 0)]
        b = points[min(i + 1, len(points) - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(tx, ty) or 1
        nx, ny = -ty / ln * w / 2, tx / ln * w / 2
        verts += [(x + nx, y + ny, LINE_Z), (x - nx, y - ny, LINE_Z)]
    for i in range(len(points) - 1):
        k = 2 * i
        faces.append((k, k + 1, k + 3, k + 2))
    return verts, faces


def _arc(cx, cy, r, a0, a1, n=48):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n),
             cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def _rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]


def _markings():
    L, W = P.FIELD_L / 2, P.FIELD_W / 2
    polys = [_rect(-L, -W, L, W), [(0, -W), (0, W)], _arc(0, 0, 9.15, 0, 2 * math.pi, 96)]
    for s in (-1, 1):
        x = s * L
        polys.append([(x, -20.16), (x - s * 16.5, -20.16), (x - s * 16.5, 20.16), (x, 20.16)])
        polys.append([(x, -9.16), (x - s * 5.5, -9.16), (x - s * 5.5, 9.16), (x, 9.16)])
        spot = x - s * 11
        a = math.acos(5.5 / 9.15)
        base = math.pi if s > 0 else 0.0
        polys.append(_arc(spot, 0, 9.15, base - a, base + a, 24))
        polys.append(_arc(spot, 0, 0.11, 0, 2 * math.pi, 12))
        for sy in (-1, 1):
            mid = math.atan2(-sy, -s)  # quarter arc facing into the field
            polys.append(_arc(x, sy * W, 1.0, mid - math.pi / 4, mid + math.pi / 4, 12))
    polys.append(_arc(0, 0, 0.15, 0, 2 * math.pi, 12))
    verts, faces = [], []
    for p in polys:
        v, f = _strip(p, LINE_W)
        off = len(verts)
        verts += v
        faces += [tuple(i + off for i in q) for q in f]
    return verts, faces


def _goal(coll, mats, s):
    """Goal frame (tube posts via GN-free boxes) and a net surface."""
    import bmesh
    import bpy
    x = s * P.FIELD_L / 2
    bm = bmesh.new()
    r = 0.06
    for y in (-3.66, 3.66):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=r, radius2=r,
                              depth=2.44 + r, matrix=_mat(x, y, 1.22))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=r, radius2=r,
                          depth=7.32 + 2 * r, matrix=_mat(x, 0, 2.44, rot_x=True))
    me = bpy.data.meshes.new(f"Goal_{s}")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mats["white"])
    obj = bpy.data.objects.new(f"Goal_{'E' if s > 0 else 'W'}", me)
    coll.objects.link(obj)
    # net: back 2 m deep, sloping top
    d = 2.0
    xb = x + s * d
    v = [(x, -3.66, 2.44), (x, 3.66, 2.44), (x + s * 0.8, 3.66, 2.44), (x + s * 0.8, -3.66, 2.44),
         (xb, -3.66, 0), (xb, 3.66, 0), (x, -3.66, 0), (x, 3.66, 0)]
    f = [(0, 1, 2, 3), (3, 2, 5, 4), (0, 3, 4, 6), (1, 7, 5, 2)]
    net = C.mesh_object(f"Net_{'E' if s > 0 else 'W'}", v, f, coll, [mats["net"]])
    return obj, net


def _mat(x, y, z, rot_x=False):
    from mathutils import Matrix
    m = Matrix.Translation((x, y, z))
    if rot_x:
        m = m @ Matrix.Rotation(math.pi / 2, 4, "X")
    return m



DUGOUT_L, DUGOUT_D = 14.0, 2.8      # shelter length along the touchline, depth (m)


def _box(verts, faces, cx, cy, cz, sx, sy, sz):
    k = len(verts)
    for dx, dy, dz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                       (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
        verts.append((cx + dx * sx / 2, cy + dy * sy / 2, cz + dz * sz / 2))
    faces += [(k, k + 3, k + 2, k + 1), (k + 4, k + 5, k + 6, k + 7), (k, k + 1, k + 5, k + 4),
              (k + 1, k + 2, k + 6, k + 5), (k + 2, k + 3, k + 7, k + 6), (k + 3, k, k + 4, k + 7)]


def _bucket_seat(verts, faces, x, y, z):
    """Padded stadium bucket seat facing -Y (the pitch): pan, tall back, headrest, bolsters."""
    _box(verts, faces, x, y, z + 0.45, 0.52, 0.5, 0.12)               # pan
    _box(verts, faces, x, y + 0.26, z + 0.85, 0.52, 0.12, 0.72)       # back
    _box(verts, faces, x, y + 0.27, z + 1.3, 0.3, 0.12, 0.2)          # headrest
    for sx in (-0.29, 0.29):
        _box(verts, faces, x + sx, y + 0.05, z + 0.62, 0.07, 0.55, 0.3)   # side bolsters
    _box(verts, faces, x, y + 0.05, z + 0.2, 0.08, 0.08, 0.4)         # pedestal


def _dugouts(coll, bw, dark, white):
    """Team shelters: curved tinted canopy on white ribs over two tiers of padded
    bucket seats, dark back wall and floor, technical-area line on the grass."""
    canopy = C.principled("M_DugoutGlass", (0.55, 0.62, 0.66), rough=0.05, transmission=1.0)
    frame = bpy.data.materials.get("M_ColumnWhite") or C.principled("M_ColumnWhite", (0.86, 0.86, 0.84), rough=0.4)
    pad = C.principled("M_DugoutSeat", (0.03, 0.2, 0.11), rough=0.5)       # team green upholstery
    floor = C.principled("M_DugoutFloor", (0.05, 0.05, 0.055), rough=0.85)
    y_back = bw - 0.4
    y_front = y_back - DUGOUT_D
    arc = [(t, math.sin(t * math.pi / 2)) for t in [i / 10 for i in range(11)]]   # back -> front

    def prof(t, e):                   # canopy section: 2.4 m at the back, 1.45 m at the lip
        return y_back - DUGOUT_D * t, 1.45 + 0.95 * (1 - e ** 1.6)

    for sx in (-12.0, 12.0):
        tag = "E" if sx > 0 else "W"
        x0, x1 = sx - DUGOUT_L / 2, sx + DUGOUT_L / 2
        # canopy shell (single curved sheet) + end caps
        v, f = [], []
        for t, e in arc:
            y, z = prof(t, e)
            v += [(x0, y, z), (x1, y, z)]
        for i in range(len(arc) - 1):
            f.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
        for x, side in ((x0, 0), (x1, 1)):
            k = len(v)
            v += [(x, y_back, 0.0)] + [(x, *prof(t, e)) for t, e in arc] + [(x, y_front, 0.0)]
            f.append(tuple(range(k, len(v))))
        C.mesh_object(f"Dugout_{tag}_Canopy", v, f, coll, [canopy])
        # white ribs along the canopy every ~2.3 m, plus the front lip beam
        rv, re = [], []
        n_ribs = 7
        for r in range(n_ribs):
            x = x0 + (x1 - x0) * r / (n_ribs - 1)
            base = len(rv)
            rv += [(x, *prof(t, e)) for t, e in arc]
            re += [(base + i, base + i + 1) for i in range(len(arc) - 1)]
            rv += [(x, y_back, 0.0), (x, y_back, prof(0, 0)[1])]
            re.append((len(rv) - 2, len(rv) - 1))
        rv += [(x0, *prof(1, 1)), (x1, *prof(1, 1))]
        re.append((len(rv) - 2, len(rv) - 1))
        ribs = C.mesh_object(f"Dugout_{tag}_Frame", rv, [], coll, edges=re)
        C.tube_modifier(ribs, 0.045, frame, 6)
        # back wall, floor platform with a raised rear tier
        sv, sf = [], []
        _box(sv, sf, sx, y_back + 0.05, 1.2, DUGOUT_L, 0.1, 2.4)
        _box(sv, sf, sx, (y_back + y_front) / 2, 0.04, DUGOUT_L, DUGOUT_D, 0.08)
        _box(sv, sf, sx, y_back - 0.6, 0.25, DUGOUT_L - 0.2, 1.1, 0.4)
        C.mesh_object(f"Dugout_{tag}_Base", sv, sf, coll, [floor])
        # two tiers of bucket seats (front on the floor, rear on the riser)
        pv, pf = [], []
        for row, (yy, zz, count) in enumerate(((y_back - 1.75, 0.08, 18), (y_back - 0.75, 0.45, 18))):
            for i in range(count):
                x = x0 + 0.7 + (DUGOUT_L - 1.4) * i / (count - 1)
                _bucket_seat(pv, pf, x, yy, zz)
        C.mesh_object(f"Dugout_{tag}_Seats", pv, pf, coll, [pad])
        # technical area: dashed white line 1 m off the shelter, 1 m wider each side
        lv, lf = [], []
        ty = y_front - 1.0
        for xa, xb, ya, yb in ((x0 - 1, x1 + 1, ty - 0.06, ty + 0.06),
                               (x0 - 1.06, x0 - 0.94, ty, y_front + 0.2),
                               (x1 + 0.94, x1 + 1.06, ty, y_front + 0.2)):
            seg = 1.0 if xb - xa > 1 else yb - ya
            if xb - xa > 1:
                x = xa
                while x < xb:
                    k = len(lv)
                    lv += [(x, ya, 0.012), (min(x + 0.6, xb), ya, 0.012), (min(x + 0.6, xb), yb, 0.012), (x, yb, 0.012)]
                    lf.append((k, k + 1, k + 2, k + 3))
                    x += 1.0
            else:
                k = len(lv)
                lv += [(xa, ya, 0.012), (xb, ya, 0.012), (xb, yb, 0.012), (xa, yb, 0.012)]
                lf.append((k, k + 1, k + 2, k + 3))
        C.mesh_object(f"Dugout_{tag}_TechArea", lv, lf, coll, [white])

def build(root):
    coll = C.collection("Pitch", root)
    grass = _grass_material()
    surround = C.principled("M_PitchSurround", (0.035, 0.11, 0.03), rough=0.9)
    white = C.principled("M_LineWhite", (0.85, 0.85, 0.82), rough=0.8)
    net = C.principled("M_Net", (0.95, 0.95, 0.95), rough=0.7, alpha=0.35)
    board = signage.board_material()
    board_back = C.principled("M_BoardBack", (0.02, 0.02, 0.025), rough=0.6)

    L, W = P.PITCH_AREA_L / 2, P.PITCH_AREA_W / 2
    C.mesh_object("Pitch_Grass", [(-L, -W, 0), (L, -W, 0), (L, W, 0), (-L, W, 0)],
                  [(0, 1, 2, 3)], coll, [grass])
    # dark surround strip out to the bowl front wall
    pts, nrm = C.plan_loop(P.BOWL_A, P.BOWL_B, P.BOWL_N, 360)
    rect = []
    for (x, y) in pts:
        rect.append((max(-L, min(L, x)), max(-W, min(W, y)), -0.005))
    verts = rect + [(x, y, -0.005) for x, y in pts]
    n = len(pts)
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    C.mesh_object("Pitch_Surround", verts, faces, coll, [surround])

    v, f = _markings()
    C.mesh_object("Pitch_Lines", v, f, coll, [white])
    mats = {"white": white, "net": net}
    for s in (-1, 1):
        _goal(coll, mats, s)

    # LED advertising boards: 1 m tall, 5 m off the lines, open at the tunnel
    boards_v, boards_f, mids, uvs = [], [], [], []
    bl, bw = P.FIELD_L / 2 + 5.0, P.FIELD_W / 2 + 5.0
    segs = [((-bl, -bw), (bl, -bw)), ((bl, -bw), (bl, bw)),
            ((bl, bw), (4, bw)), ((-4, bw), (-bl, bw)), ((-bl, bw), (-bl, -bw))]
    for (x0, y0), (x1, y1) in segs:
        k = len(boards_v)
        boards_v += [(x0, y0, 0), (x1, y1, 0), (x1, y1, 0.95), (x0, y0, 0.95)]
        boards_f.append((k, k + 1, k + 2, k + 3))
        mids.append(0)
        u = math.hypot(x1 - x0, y1 - y0) / signage.BOARD_PANEL_M
        uvs += [(0, 0), (u, 0), (u, 1), (0, 1)]
    C.mesh_object("Pitch_LEDBoards", boards_v, boards_f, coll, [board, board_back],
                  mat_indices=mids, uvs=uvs)

    # dugouts on the north touchline (main stand is south, section 101)
    _dugouts(coll, bw, board_back, white)
    return coll
