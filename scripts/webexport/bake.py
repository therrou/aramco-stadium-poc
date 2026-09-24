"""Cycles bakes for the web (spec §1.4, §1.8). One MCP call per (group, state):
calls longer than 120 s may report "No data received"; check the PNG on disk."""
import math
import os

import bpy
import numpy as np

from . import groups, rgbm, texel, webscene

RAW = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "build", "web_raw")
QUALITY = {"draft": {"scale": 0.5, "samples": 64}, "full": {"scale": 1.0, "samples": 256}}
# texel.atlas_size upper bound per group (size-budget knob 3; None = texel.atlas_size default)
ATLAS_HI = {}


def _area(objs):
    return sum(p.area for o in objs for p in o.data.polygons)


# Deviation from the brief (smart_project + pack_islands): smart-project splits every stepped tier
# into sub-texel tread/riser strips and turns treads, slabs and pitch lines into closed rings whose
# boxes span the whole bowl; the bowl atlas came out 1 % used. Charts are built here instead:
# faces are cut on a world XY grid, grouped into connected pieces (vertices welded by position,
# across the group's objects) that are height fields along their mean normal, projected on that
# plane and shelf-packed at one shared texel density.
CELL_M = {"site": 64.0}          # grid cell per group (default 16 m)
MARGIN_PX = 4.0                  # gutter between charts, in atlas texels
SMALL_TEXELS = 16.0              # charts under this many texels are merged per (cell, axis)


def _group_mesh(objs):
    """Concatenated face/loop arrays of a group (objects are world-space: identity transforms)."""
    n, area, cen, tot, co = [], [], [], [], []
    for o in objs:
        me = o.data
        P, L, V = len(me.polygons), len(me.loops), len(me.vertices)
        st = np.empty(P, np.int32)
        me.polygons.foreach_get("loop_start", st)
        assert P == 0 or (st[0] == 0 and (np.diff(st) > 0).all()), o.name     # loops contiguous, in order
        for name, dim, lst in (("normal", 3, n), ("area", 1, area), ("center", 3, cen)):
            a = np.empty(P * dim, np.float64)
            me.polygons.foreach_get(name, a)
            lst.append(a.reshape(P, dim) if dim > 1 else a)
        t = np.empty(P, np.int32)
        me.polygons.foreach_get("loop_total", t)
        tot.append(t)
        v = np.empty(V * 3, np.float64)
        me.vertices.foreach_get("co", v)
        vi = np.empty(L, np.int32)
        me.loops.foreach_get("vertex_index", vi)
        co.append(v.reshape(V, 3)[vi])
    return (np.concatenate(n), np.concatenate(area), np.concatenate(cen),
            np.concatenate(tot), np.concatenate(co))


def _components(a, b, cls):
    """Connected components over face pairs (a, b), never joining faces of different `cls`."""
    keep = cls[a] == cls[b]
    a, b = a[keep], b[keep]
    lab = np.arange(len(cls))
    while True:
        m = np.minimum(lab[a], lab[b])
        new = lab.copy()
        np.minimum.at(new, a, m)
        np.minimum.at(new, b, m)
        new = new[new]
        if (new == lab).all():
            return np.unique(lab, return_inverse=True)[1]
        lab = new


def _mean_normal(lab, n, area):
    N = np.zeros((lab.max() + 1, 3))
    np.add.at(N, lab, n * area[:, None])
    ln = np.linalg.norm(N, axis=1)
    N[ln < 1e-9] = (0, 0, 1)
    ln[ln < 1e-9] = 1.0
    return N / ln[:, None]


def _charts(n, area, cen, tot, co, cell, min_area=0.0):
    """Chart id per face and the projection normal per chart."""
    F = len(n)
    fol = np.repeat(np.arange(F), tot)                                 # face of loop
    key = np.unique(np.round(co * 1000).astype(np.int64), axis=0, return_inverse=True)[1].ravel()
    order = np.argsort(key, kind="stable")
    ks, fs = key[order], fol[order]
    head = np.r_[True, ks[1:] != ks[:-1]]
    a, b = fs, fs[head][np.cumsum(head) - 1]
    pair = np.unique(np.stack([a[a != b], b[a != b]], 1), axis=0)
    a, b = pair[:, 0], pair[:, 1]
    cell_id = np.unique(np.floor(cen[:, :2] / cell), axis=0, return_inverse=True)[1].ravel()
    cls = cell_id * 2 + (n[:, 2] < -0.05)
    chart = np.full(F, -1)
    todo = np.ones(F, bool)
    for level in range(4):
        if level == 3:                                                 # leftovers: split by dominant axis
            ax = np.abs(n).argmax(1)
            cls = cls * 6 + ax * 2 + (n[np.arange(F), ax] < 0)
        lab = _components(a, b, np.where(todo, cls, -1 - np.arange(F)))
        N = _mean_normal(lab, n, area)
        ok = (n * N[lab]).sum(1) > 0.15
        bad = np.zeros(lab.max() + 1, bool)
        np.logical_or.at(bad, lab, ~ok & todo)
        done = todo & (~bad[lab] | (level == 3))
        base = chart.max() + 1
        chart[done] = base + np.unique(lab[done], return_inverse=True)[1].ravel()
        todo &= ~done
        cls = lab * 2 + ok                                             # split bad pieces into fits / rest
        if not todo.any():
            break
    # sub-texel charts cost a full gutter each: merge them per (cell, axis), overlaps are invisible there
    small = np.bincount(chart, area)[chart] < min_area
    if small.any():
        ax = np.abs(n).argmax(1)
        key = np.stack([cell_id, ax * 2 + (n[np.arange(F), ax] < 0)], 1)[small]
        chart[small] = chart.max() + 1 + np.unique(key, axis=0, return_inverse=True)[1].ravel()
        chart = np.unique(chart, return_inverse=True)[1].ravel()
    return chart, _mean_normal(chart, n, area), fol


def _shelf(w, h, S):
    """Shelf-pack rects (sorted by height, desc) into an S-wide strip; returns x, y and the used height."""
    order = np.argsort(-h, kind="stable")
    x, y = np.empty(len(w)), np.empty(len(w))
    cx = cy = sh = 0.0
    for i in order:
        if cx + w[i] > S:
            cx, cy, sh = 0.0, cy + sh, 0.0
        x[i], y[i] = cx, cy
        cx += w[i]
        sh = max(sh, h[i])
    return x, y, cy + sh


def _chart_uvs(objs, size, texels_per_m, cell):
    n, area, cen, tot, co = _group_mesh(objs)
    chart, N, fol = _charts(n, area, cen, tot, co, cell, SMALL_TEXELS / texels_per_m ** 2)
    C = len(N)
    up = np.where(np.abs(N[:, 2:3]) < 0.9, [[0, 0, 1]], [[1, 0, 0]])
    t = np.cross(up, N)
    t /= np.linalg.norm(t, axis=1)[:, None]
    bt = np.cross(N, t)
    cl = chart[fol]
    p = np.stack([(co * t[cl]).sum(1), (co * bt[cl]).sum(1)], 1)     # metres in the chart plane
    # principal axis -> x, so that the box is tight
    cnt = np.bincount(cl, minlength=C).astype(float)
    mean = np.stack([np.bincount(cl, p[:, 0], C), np.bincount(cl, p[:, 1], C)], 1) / cnt[:, None]
    q = p - mean[cl]
    sxx, syy, sxy = (np.bincount(cl, q[:, 0] ** 2, C), np.bincount(cl, q[:, 1] ** 2, C),
                     np.bincount(cl, q[:, 0] * q[:, 1], C))
    ang = 0.5 * np.arctan2(2 * sxy, sxx - syy)[cl]
    qr = np.stack([q[:, 0] * np.cos(ang) + q[:, 1] * np.sin(ang), -q[:, 0] * np.sin(ang) + q[:, 1] * np.cos(ang)], 1)

    def box(v):
        lo = np.full((C, 2), np.inf)
        hi = np.full((C, 2), -np.inf)
        np.minimum.at(lo, cl, v)
        np.maximum.at(hi, cl, v)
        return lo, hi

    (lo0, hi0), (lo1, hi1) = box(q), box(qr)
    pca = np.prod(hi1 - lo1, 1) < np.prod(hi0 - lo0, 1)                # square charts: PCA axis is arbitrary
    q = np.where(pca[cl, None], qr, q)
    lo, hi = np.where(pca[:, None], lo1, lo0), np.where(pca[:, None], hi1, hi0)
    q -= lo[cl]
    ext = hi - lo
    lo_s, hi_s = 1e-3, 64.0                                            # bisect the density scale k
    for _ in range(30):
        k = math.sqrt(lo_s * hi_s)
        w = ext[:, 0] * texels_per_m * k + MARGIN_PX
        h = ext[:, 1] * texels_per_m * k + MARGIN_PX
        if w.max() <= size and _shelf(w, h, size)[2] <= size:
            lo_s = k
        else:
            hi_s = k
    k = lo_s
    w = ext[:, 0] * texels_per_m * k + MARGIN_PX
    h = ext[:, 1] * texels_per_m * k + MARGIN_PX
    x, y, _ = _shelf(w, h, size)
    uv = (q * texels_per_m * k + np.stack([x, y], 1)[cl] + MARGIN_PX / 2) / size
    off = 0
    for o in objs:
        L = len(o.data.loops)
        o.data.uv_layers["LightmapUV"].data.foreach_set("uv", uv[off:off + L].astype(np.float32).ravel())
        off += L
    return {"charts": int(C), "density_scale": round(k, 3),
            "fill": round(float((ext[:, 0] * ext[:, 1]).sum() * (texels_per_m * k) ** 2 / size ** 2), 3)}


def _sphere_dirs(k):
    i = np.arange(k) + 0.5
    z = 1 - i / k                                                      # upper hemisphere, even in z
    phi = i * math.pi * (3 - math.sqrt(5))
    r = np.sqrt(1 - z * z)
    return np.stack([r * np.cos(phi), r * np.sin(phi), z], 1)


def orient_faces(objs, everyone, rays=8, reach=200.0):
    """Flip faces whose back side is much more open (mean ray distance) than their front side.

    The stadium's tier treads are single-sided faces with inverted winding (fine for two-sided
    Cycles renders). A bake shades the side the normal points to, so those treads would bake the
    dark void under the tier. Returns the number of faces flipped."""
    import bmesh
    from mathutils import Matrix, Vector
    from mathutils.bvhtree import BVHTree
    verts, polys = [], []
    for o in everyone:
        base = len(verts)
        verts += [v.co.copy() for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    tree = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
    hemi = _sphere_dirs(rays)
    flipped = 0
    for o in objs:
        me = o.data
        flip = []
        for p in me.polygons:
            n = p.normal
            rot = n.to_track_quat("Z", "Y").to_matrix()
            front = back = 0.0
            for d in hemi:
                dv = rot @ Vector(d)
                h = tree.ray_cast(p.center + dv * 0.01, dv, reach)[3]
                front += reach if h is None else h
                h = tree.ray_cast(p.center - dv * 0.01, -dv, reach)[3]
                back += reach if h is None else h
            if back > 1.5 * front:
                flip.append(p.index)
        if flip:
            bm = bmesh.new()
            bm.from_mesh(me)
            bm.faces.ensure_lookup_table()
            bmesh.ops.reverse_faces(bm, faces=[bm.faces[i] for i in flip])
            bm.to_mesh(me)
            bm.free()
            flipped += len(flip)
    return flipped


ORIENT_GROUPS = ("bowl", "structure")


CHART_STATS = {}


def lightmap_uvs(objs_by_group, scale=1.0):
    """Chart + pack all objects of a group into one shared LightmapUV atlas; returns atlas sizes."""
    sizes = {}
    everyone = [o for objs in objs_by_group.values() for o in objs]
    for g, objs in objs_by_group.items():
        if g in ORIENT_GROUPS:
            CHART_STATS.setdefault("flipped", {})[g] = orient_faces(objs, everyone)
        kw = {"hi": ATLAS_HI[g]} if g in ATLAS_HI else {}
        tpm = groups.TEXELS_PER_M[g] * scale
        size = texel.atlas_size(_area(objs), tpm, **kw)
        CHART_STATS[g] = _chart_uvs(objs, size, tpm, CELL_M.get(g, 16.0))
        sizes[g] = size
    return sizes


def _bake_material(src_mat, n):
    """Diffuse stand-in for the lightmap bake: flat albedo + the state's emission (metals bake too)."""
    from . import matinfo
    info = matinfo.classify(src_mat)
    m = bpy.data.materials.new(f"_bake_{src_mat.name}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    dif.inputs["Color"].default_value = (*info["base"], 1)
    add = nt.nodes.new("ShaderNodeAddShader")
    em = nt.nodes.new("ShaderNodeEmission")
    e = info["emission"]
    if e:
        em.inputs["Color"].default_value = (*e["color"], 1)
        em.inputs["Strength"].default_value = e["day"] + n * (e["night"] - e["day"]) if not e["baked"] else 0.0
    else:
        em.inputs["Strength"].default_value = 0.0
    nt.links.new(dif.outputs[0], add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    return m


def bake_lightmap(group, objs, size, state, n, samples):
    webscene.set_state(n)
    img = bpy.data.images.get(f"_lm_{group}") or bpy.data.images.new(f"_lm_{group}", size, size, float_buffer=True, alpha=False)
    img.scale(size, size)
    # every exported object gets the stand-in (the .web copies emit at a fixed strength 1 in any
    # state); only the baked group carries the target image node
    targets = {o.name for o in objs}
    everyone = [o for o in bpy.data.scenes[webscene.WEB].objects if o.get("webexport")]
    keep = {}
    for o in everyone:
        keep[o.name] = o.data.materials[0]
        bm = _bake_material(bpy.data.materials[o["srcMat"]], n)
        if o.name in targets:
            node = bm.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = img
            bm.node_tree.nodes.active = node
            o.data.uv_layers.active = o.data.uv_layers["LightmapUV"]
        o.data.materials[0] = bm
    webscene.enter()
    try:
        sc = bpy.context.scene
        sc.cycles.samples = samples
        sc.render.bake.margin = 8
        sc.render.bake.margin_type = "EXTEND"
        for o in sc.objects:
            o.select_set(False)
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, use_clear=True)
    finally:
        webscene.leave()
        for o in everyone:
            tmp = o.data.materials[0]
            o.data.materials[0] = keep[o.name]
            o.data.uv_layers.active = o.data.uv_layers["UVMap"]
            bpy.data.materials.remove(tmp)
    buf = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(buf)
    enc = rgbm.encode(buf.reshape(size, size, 4)[..., :3])
    return _save_png(enc, os.path.join(RAW, "lightmaps", state, f"{group}.png"), non_color=True)


def _save_png(rgba_u8, path, non_color):
    h, w = rgba_u8.shape[:2]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = bpy.data.images.new("_out", w, h, alpha=True)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    img.pixels.foreach_set((rgba_u8.astype(np.float32) / 255.0).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return path


ENV_SCENE = "WebEnv"


def bake_env(state, n, w=1024):             # 1024x512: size-budget knob (Task 10), brief had 2048
    """World only, equirect camera at 30 m, rendered as Radiance HDR."""
    sc = bpy.data.scenes.get(ENV_SCENE) or bpy.data.scenes.new(ENV_SCENE)
    sc.world = webscene.src().world
    sc.render.engine = "CYCLES"
    sc.cycles.device = webscene.src().cycles.device
    sc.cycles.samples = 32
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, w // 2, 100
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.exposure = 0.0
    cam = bpy.data.objects.get("_EnvCam") or bpy.data.objects.new("_EnvCam", bpy.data.cameras.new("_EnvCam"))
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    cam.data.type = "PANO"
    cam.data.panorama_type = "EQUIRECTANGULAR"
    cam.location = (0, 0, 30)
    # image centre looks along -X with +Y to the right: the same layout as Blender's world equirect
    # mapping (u = atan2(y, -x) / 2pi + 0.5). sun_check verifies this.
    cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
    sc.camera = cam
    sc["night"] = float(n)
    webscene.set_state(n)
    path = os.path.join(RAW, "env", f"{state}.hdr")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.image_settings.file_format = "HDR"
    sc.render.filepath = path
    prev = bpy.context.window.scene
    bpy.context.window.scene = sc
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        bpy.context.window.scene = prev
    return path


def sun_check(path, n):
    """Angle between the brightest env pixel and the expected sun direction, mapped with
    Blender's equirect formula (web/src/coords.ts blenderEquirectUV)."""
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    lum = px.reshape(h, w, 4)[..., :3].sum(-1)
    y, x = np.unravel_index(np.argmax(lum), lum.shape)
    u, v = (x + 0.5) / w, (y + 0.5) / h
    az = (u - 0.5) * 2 * math.pi
    el = (v - 0.5) * math.pi
    d = (-math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))    # inverse of blenderEquirectUV
    t = min(n / 0.6, 1.0)
    e, a = math.radians(24 - 22 * t), math.radians(235 + 55 * t)
    s = (math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e))
    return math.degrees(math.acos(max(-1, min(1, sum(p * q for p, q in zip(d, s))))))
