"""Seating bowl: stepped tiers, club suites, seats (GN instances), section data.

Three tiers share one plan: offsets of a superellipse around the pitch.
Section numbering (invented, public data has none):
  Lower 101-144, Club 201-244, Upper 301-344, counter-clockwise,
  section x01 centred on the south (main) stand.
"""
import bisect
import math

import bmesh
import bpy

from . import common as C
from . import params as P
from . import signage


# --- tier layout ---------------------------------------------------------
def _rows(d0, z0, depth, riser0, riser_k, count):
    rows, z = [], z0
    for j in range(count):
        rows.append((d0 + j * depth, z, depth))
        z += riser0 + riser_k * j
    return rows


def layout():
    """Return dict tier_name -> list of (d_front, z_tread, depth) rows."""
    L, K, U = P.LOWER, P.CLUB, P.UPPER
    lower = _rows(L["d0"], L["z0"], L["depth"], L["riser0"], L["riser_k"], L["rows"])
    l_end = lower[-1][0] + lower[-1][2]
    l_top = lower[-1][1]
    club = _rows(l_end + K["gap"], l_top + 0.9, K["depth"], K["riser0"], 0, K["rows"])
    c_back = club[-1][0] + club[-1][2]
    c_top = club[-1][1]
    u_d0 = c_back - U["overhang"]
    u_z0 = c_top + K["suite_h"] + 1.6
    upper = _rows(u_d0, u_z0, U["depth"], U["riser0"], U["riser_k"], U["rows_max"])
    return {"Lower": lower, "Club": club, "Upper": upper,
            "_l_end": l_end, "_l_top": l_top, "_c_back": c_back, "_c_top": c_top}


def upper_rows_at(t):
    """Wavy upper edge: more rows along the long sides (t = plan angle)."""
    U = P.UPPER
    w = abs(math.sin(t)) ** 1.6
    return U["rows_min"] + (U["rows_max"] - U["rows_min"]) * w


# --- plan helpers --------------------------------------------------------
class Plan:
    def __init__(self):
        self.pts, self.nrm = C.plan_loop(P.BOWL_A, P.BOWL_B, P.BOWL_N, P.PLAN_SAMPLES)
        self.n = len(self.pts)
        self.cum = C.cumulative_length(self.pts)
        self.perimeter = self.cum[-1]
        # section boundaries as fractional sample indices, x01 centred south
        start_idx = 0.75 * self.n
        s_start = self._arc_at(start_idx) - self.perimeter / (2 * P.SECTIONS)
        self.bounds = [self._idx_at((s_start + k * self.perimeter / P.SECTIONS)
                                    % self.perimeter) for k in range(P.SECTIONS + 1)]

    def _arc_at(self, fi):
        i = int(fi) % self.n
        f = fi - int(fi)
        return self.cum[i] + f * (self.cum[i + 1] - self.cum[i])

    def _idx_at(self, s):
        i = bisect.bisect_right(self.cum, s) - 1
        i = min(max(i, 0), self.n - 1)
        seg = self.cum[i + 1] - self.cum[i]
        return i + ((s - self.cum[i]) / seg if seg else 0)

    def angle(self, fi):
        return 2 * math.pi * fi / self.n

    def row_curve(self, d):
        loop = C.offset_loop(self.pts, self.nrm, d)
        return loop, C.cumulative_length(loop)


def _point_on(loop, cum, s, nrm):
    n = len(loop)
    s %= cum[-1]
    i = bisect.bisect_right(cum, s) - 1
    i = min(max(i, 0), n - 1)
    seg = cum[i + 1] - cum[i]
    f = (s - cum[i]) / seg if seg else 0
    (x0, y0), (x1, y1) = loop[i], loop[(i + 1) % n]
    (nx0, ny0), (nx1, ny1) = nrm[i], nrm[(i + 1) % n]
    nx, ny = nx0 + (nx1 - nx0) * f, ny0 + (ny1 - ny0) * f
    return x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, nx, ny


def _arc_of_idx(cum, fi, n):
    i = int(fi) % n
    f = fi - int(fi)
    return cum[i] + f * (cum[i + 1] - cum[i])


# --- geometry ------------------------------------------------------------
def _sweep_var(plan, profile_fn, name, coll, mats, mat_of_seg):
    """Like common.sweep but the (d, z) profile may vary per plan sample."""
    verts, faces, mids = [], [], []
    m = None
    for i in range(plan.n):
        prof = profile_fn(i)
        m = m or len(prof)
        (x, y), (nx, ny) = plan.pts[i], plan.nrm[i]
        for d, z in prof:
            verts.append((x + nx * d, y + ny * d, z))
    for i in range(plan.n):
        i2 = (i + 1) % plan.n
        for j in range(m - 1):
            faces.append((i * m + j, i2 * m + j, i2 * m + j + 1, i * m + j + 1))
            mids.append(mat_of_seg(j))
    return C.mesh_object(name, verts, faces, coll, mats, mat_indices=mids)


def _stepped(rows, front_drop, back_rise):
    """Profile (d, z) for a tier: front fascia, tread/riser steps, back wall."""
    d0, z0, _ = rows[0]
    prof = [(d0, z0 - front_drop), (d0, z0)]
    for j, (d, z, dep) in enumerate(rows):
        prof.append((d + dep, z))
        if j + 1 < len(rows):
            prof.append((d + dep, rows[j + 1][1]))
    d, z, dep = rows[-1]
    prof.append((d + dep, z + back_rise))
    return prof


def _collapse(prof, keep):
    """Keep the first `keep` profile points, collapse the rest onto the last kept."""
    last = prof[keep - 1]
    return prof[:keep] + [last] * (len(prof) - keep)


def _seat_mesh():
    """Stadium bucket seat, forward = +X, origin on the tread."""
    me = bpy.data.meshes.get("SeatModel")
    if me:
        bpy.data.meshes.remove(me)
    bm = bmesh.new()

    def box(cx, cy, cz, sx, sy, sz, tilt=0.0):
        from mathutils import Matrix
        m = (Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(tilt, 4, "Y")
             @ Matrix.Diagonal((sx, sy, sz, 1)))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)

    box(0.02, 0, 0.43, 0.42, 0.44, 0.05, math.radians(-4))     # pan
    box(-0.20, 0, 0.70, 0.05, 0.44, 0.46, math.radians(-12))   # back
    box(-0.05, 0, 0.20, 0.10, 0.08, 0.40)                      # pedestal
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.012, segments=2, affect="EDGES")
    me = bpy.data.meshes.new("SeatModel")
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    return me


def _instancer_group(seat_obj, name):
    ng = bpy.data.node_groups.get(name)
    if ng:
        bpy.data.node_groups.remove(ng)
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nodes, links = ng.nodes, ng.links
    gi = nodes.new("NodeGroupInput")
    go = nodes.new("NodeGroupOutput")
    inst = nodes.new("GeometryNodeInstanceOnPoints")
    objinfo = nodes.new("GeometryNodeObjectInfo")
    objinfo.inputs["As Instance"].default_value = True
    objinfo.inputs["Object"].default_value = seat_obj
    yaw = nodes.new("GeometryNodeInputNamedAttribute")
    yaw.data_type = "FLOAT"
    yaw.inputs["Name"].default_value = "yaw"
    comb = nodes.new("ShaderNodeCombineXYZ")
    links.new(yaw.outputs["Attribute"], comb.inputs["Z"])
    links.new(gi.outputs[0], inst.inputs["Points"])
    links.new(objinfo.outputs["Geometry"], inst.inputs["Instance"])
    links.new(comb.outputs[0], inst.inputs["Rotation"])
    links.new(inst.outputs["Instances"], go.inputs[0])
    return ng


def _plan_at(plan, fi):
    """Base point and normal at a fractional sample index."""
    i = int(fi) % plan.n
    f = fi - int(fi)
    (x0, y0), (x1, y1) = plan.pts[i], plan.pts[(i + 1) % plan.n]
    (a0, b0), (a1, b1) = plan.nrm[i], plan.nrm[(i + 1) % plan.n]
    nx, ny = a0 + (a1 - a0) * f, b0 + (b1 - b0) * f
    ln = math.hypot(nx, ny)
    return x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, nx / ln, ny / ln


def _aisle_steps(plan, tiers, coll, concrete):
    """Half-height intermediate steps in every radial aisle (two steps per row)."""
    nosing = C.principled("M_StepNosing", (0.75, 0.62, 0.12), rough=0.6)
    verts, faces, mids = [], [], []
    hw = P.AISLE_W / 2
    for tname, rows in tiers.items():
        for k in range(P.SECTIONS):
            x, y, nx, ny = _plan_at(plan, plan.bounds[k] % plan.n)
            tx, ty = -ny, nx
            limit = len(rows) - 1
            if tname == "Upper":
                limit = int(upper_rows_at(plan.angle(plan.bounds[k] % plan.n))) - 1
            for j in range(limit):
                d, z, dep = rows[j]
                zh = z + (rows[j + 1][1] - z) / 2
                q = len(verts)
                for (dd, zz) in ((d, z), (d + dep / 2, z), (d + dep / 2, zh), (d, zh)):
                    for w in (-hw, hw):
                        verts.append((x + nx * dd + tx * w, y + ny * dd + ty * w, zz))
                # verts: 0/1 front-bottom, 2/3 back-bottom, 4/5 back-top, 6/7 front-top
                faces += [(q + 6, q + 7, q + 5, q + 4), (q, q + 1, q + 7, q + 6)]
                mids += [0, 1]
    C.mesh_object("Aisle_Steps", verts, faces, coll, [concrete, nosing], mat_indices=mids)


def _vomitories(plan, rows, coll, concrete):
    """Tunnel mouths in the lower tier: dark opening + parapets (every 2nd section)."""
    dark = C.principled("M_VomDark", (0.015, 0.015, 0.017), rough=0.9)
    j0, j1 = P.VOM_ROWS[0] - 1, P.VOM_ROWS[1] - 1
    d0 = rows[j0][0]
    d1 = rows[j1][0] + rows[j1][2]
    z0 = rows[j0][1]
    z1 = rows[j1][1] + (rows[j1][1] - rows[j1 - 1][1])
    verts, faces, mids = [], [], []
    hw = P.VOM_W / 2
    for k in range(0, P.SECTIONS, 2):
        a, b = plan.bounds[k], plan.bounds[k + 1]
        if b < a:
            b += plan.n
        x, y, nx, ny = _plan_at(plan, ((a + b) / 2) % plan.n)
        tx, ty = -ny, nx

        def p(d, w, z):
            return (x + nx * d + tx * w, y + ny * d + ty * w, z)

        q = len(verts)
        e = 0.06
        verts += [p(d0, -hw, z0 + e), p(d0, hw, z0 + e), p(d1, hw, z1 + e), p(d1, -hw, z1 + e)]
        faces.append((q, q + 1, q + 2, q + 3))
        mids.append(1)
        for w in (-hw - 0.15, hw + 0.15):     # side parapets
            q = len(verts)
            verts += [p(d0, w, z0), p(d1, w, z1), p(d1, w, z1 + 0.85), p(d0, w, z0 + 0.85)]
            faces.append((q, q + 1, q + 2, q + 3))
            mids.append(0)
        q = len(verts)                          # front parapet
        verts += [p(d0, -hw - 0.15, z0), p(d0, hw + 0.15, z0),
                  p(d0, hw + 0.15, z0 + 1.1), p(d0, -hw - 0.15, z0 + 1.1)]
        faces.append((q, q + 1, q + 2, q + 3))
        mids.append(0)
    C.mesh_object("Vomitories", verts, faces, coll, [concrete, dark], mat_indices=mids)


# --- build ---------------------------------------------------------------
def build(root):
    coll = C.collection("Bowl", root)
    lay = layout()
    plan = Plan()

    concrete = C.principled("M_Concrete", (0.52, 0.51, 0.49), rough=0.85)
    riser = C.principled("M_ConcreteRiser", (0.36, 0.36, 0.35), rough=0.85)
    soffit = C.principled("M_Soffit", (0.78, 0.78, 0.76), rough=0.7)
    fascia = C.principled("M_Fascia", (0.02, 0.03, 0.025), rough=0.4)   # behind the LED ribbon
    ribbon_mat = signage.ribbon_material()
    glass = C.principled("M_SuiteGlass", (0.6, 0.7, 0.72), rough=0.05, transmission=1.0)
    C.night_emission(glass, (1.0, 0.8, 0.55), 0.0, 1.2)
    seat_mat = C.principled("M_Seat", (0.03, 0.22, 0.12), rough=0.45)
    club_seat = C.principled("M_SeatClub", (0.72, 0.66, 0.55), rough=0.55)

    def tier_mat(j):  # profile segment -> material index
        return 0 if j % 2 == 0 else 1

    # Lower tier (+ cross-aisle walkway to the club step)
    lower = lay["Lower"]
    prof_l = _stepped(lower, 1.2, 0.0)
    prof_l[0] = (lower[0][0], 0.0)
    prof_l += [(lay["_l_end"] + P.CLUB["gap"], lay["_l_top"]),
               (lay["_l_end"] + P.CLUB["gap"], lay["Club"][0][1])]
    C.sweep(plan.pts, plan.nrm, prof_l, "Tier_Lower", coll, [concrete, riser],
            mat_of_seg=lambda j: 1 if j in (0,) else tier_mat(j - 1))

    # Club rows + suites glazing + LED fascia on the upper tier front
    club = lay["Club"]
    prof_c = _stepped(club, 0.0, 0.0)[1:]
    cb, ct = lay["_c_back"], lay["_c_top"]
    prof_c += [(cb, ct + P.CLUB["suite_h"])]
    nseg = len(prof_c) - 1
    C.sweep(plan.pts, plan.nrm, prof_c, "Tier_Club", coll, [concrete, riser, glass],
            mat_of_seg=lambda j: 2 if j == nseg - 1 else tier_mat(j))

    # Upper tier, closed profile incl. soffit; rows fade on the ends (wavy top)
    upper = lay["Upper"]
    base_u = _stepped(upper, 1.4, 1.1)
    per_row = 2

    def prof_u(i):
        rows_here = upper_rows_at(plan.angle(i))
        keep = 2 + int(rows_here) * per_row
        keep = min(keep, len(base_u) - 1)
        p = _collapse(base_u[:-1], keep)
        top_d, top_z = p[-1]
        back = [(top_d, top_z + 1.1), (top_d, top_z - 3.0),
                (upper[0][0] + 2.0, upper[0][1] - 1.4), (upper[0][0], upper[0][1] - 1.4)]
        return p + back

    nprof = len(prof_u(0))

    def mat_u(j):
        if j == 0:
            return 2                     # LED fascia
        if j >= nprof - 4:
            return 3                     # back wall + soffit
        return tier_mat(j - 1)

    _sweep_var(plan, prof_u, "Tier_Upper", coll, [concrete, riser, fascia, soffit], mat_u)

    # LED ribbons (interior ref): upper-tier front, club front, pitch-side wall of the lower tier
    u0d, u0z = upper[0][0], upper[0][1]
    signage.ribbon(coll, plan.pts, plan.nrm, u0d - 0.03, u0z - 1.3, u0z - 0.1, "Ribbon_Upper", ribbon_mat)
    cd = lay["_l_end"] + P.CLUB["gap"] - 0.03
    signage.ribbon(coll, plan.pts, plan.nrm, cd, lay["_l_top"] + 0.05, lay["_l_top"] + 0.85,
                   "Ribbon_Club", ribbon_mat)
    signage.ribbon(coll, plan.pts, plan.nrm, lower[0][0] - 0.03, 0.15, 1.1, "Ribbon_Lower", ribbon_mat)

    _vomitories(plan, lower, coll, concrete)
    _aisle_steps(plan, {"Lower": lower, "Upper": upper}, coll, concrete)

    # Seats ----------------------------------------------------------------
    seat_me = _seat_mesh()
    seat_obj = bpy.data.objects.new("SeatModel", seat_me)
    coll.objects.link(seat_obj)
    # instanced sources must stay visible or the GN instances vanish; park them underground
    seat_obj.location = (0, 0, -200)
    seat_obj.data.materials.append(seat_mat)
    club_obj = bpy.data.objects.new("SeatModelClub", seat_me.copy())
    club_obj.data.materials.clear()
    club_obj.data.materials.append(club_seat)
    coll.objects.link(club_obj)
    club_obj.location = (0, 0, -200)

    sections, seats_total = [], 0
    tiers = [("Lower", P.LOWER, lower, 100, seat_obj),
             ("Club", P.CLUB, club, 200, club_obj),
             ("Upper", P.UPPER, upper, 300, seat_obj)]
    seat_rows = []   # for CSV export
    groups = {}
    for tname, spec, rows, base_no, model in tiers:
        pverts, attrs = [], {"yaw": [], "section": [], "row": [], "seat": []}
        sec_stats = {k: {"rows": 0, "seats": 0, "sx": 0, "sy": 0, "sz": 0}
                     for k in range(P.SECTIONS)}
        for j, (d, z, dep) in enumerate(rows):
            loop, cum = plan.row_curve(d + dep * 0.62)
            for k in range(P.SECTIONS):
                a, b = plan.bounds[k], plan.bounds[k + 1]
                if b < a:
                    b += plan.n
                mid_angle = plan.angle((a + b) / 2 % plan.n)
                if tname == "Upper" and j >= int(min(upper_rows_at(plan.angle(a % plan.n)),
                                                     upper_rows_at(plan.angle(b % plan.n)))):
                    continue
                s0 = _arc_of_idx(cum, a % plan.n, plan.n)
                s1 = _arc_of_idx(cum, b % plan.n, plan.n)
                if s1 < s0:
                    s1 += cum[-1]
                s0 += P.AISLE_W / 2
                s1 -= P.AISLE_W / 2
                count = int((s1 - s0) / spec["seat_w"])
                pad = ((s1 - s0) - count * spec["seat_w"]) / 2
                sc = (s0 + s1) / 2
                vom = (tname == "Lower" and k % 2 == 0
                       and P.VOM_ROWS[0] <= j + 1 <= P.VOM_ROWS[1])
                row_seats = 0
                for q in range(count):
                    s = s0 + pad + (q + 0.5) * spec["seat_w"]
                    if vom and abs(s - sc) < P.VOM_W / 2 + 0.2:
                        continue
                    x, y, nx, ny = _point_on(loop, cum, s, plan.nrm)
                    row_seats += 1
                    pverts.append((x, y, z))
                    attrs["yaw"].append(math.atan2(-ny, -nx))
                    attrs["section"].append(base_no + k + 1)
                    attrs["row"].append(j + 1)
                    attrs["seat"].append(row_seats)
                    seat_rows.append((base_no + k + 1, j + 1, row_seats, x, y, z,
                                      math.atan2(-ny, -nx)))
                    st = sec_stats[k]
                    st["sx"] += x
                    st["sy"] += y
                    st["sz"] += z
                if row_seats:
                    sec_stats[k]["rows"] = j + 1
                    sec_stats[k]["seats"] += row_seats
                    sec_stats[k]["angle"] = mid_angle
        me = bpy.data.meshes.new(f"SeatPoints_{tname}")
        me.from_pydata(pverts, [], [])
        for key, vals in attrs.items():
            kind = "FLOAT" if key == "yaw" else "INT"
            at = me.attributes.new(key, kind, "POINT")
            at.data.foreach_set("value", vals)
        obj = bpy.data.objects.new(f"Seats_{tname}", me)
        coll.objects.link(obj)
        mod = obj.modifiers.new("Seats", "NODES")
        if model.name not in groups:
            groups[model.name] = _instancer_group(model, f"GN_Seats_{model.name}")
        mod.node_group = groups[model.name]
        for k, st in sec_stats.items():
            if not st["seats"]:
                continue
            nseats = st["seats"]
            sections.append({
                "id": str(base_no + k + 1), "tier": tname, "level": spec["level"],
                "rows": st["rows"], "seats": nseats,
                "centroid": [round(st["sx"] / nseats, 2), round(st["sy"] / nseats, 2),
                             round(st["sz"] / nseats, 2)],
                "angle_deg": round(math.degrees(st.get("angle", 0)), 1),
            })
            seats_total += nseats
    return coll, {"sections": sections, "seats_total": seats_total, "seats": seat_rows,
                  "layout": {k: v for k, v in lay.items() if k.startswith("_")}}

