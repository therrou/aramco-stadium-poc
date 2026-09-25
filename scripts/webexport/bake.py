"""Cycles bakes for the web (spec §1.4, §1.8). One MCP call per (group, state):
calls longer than 120 s may report "No data received"; check the PNG on disk."""
import math
import os

import bpy
import numpy as np

from . import groups, rgbm, texel, uvpack, webscene

RAW = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "build", "web_raw")
# Ruling R9: "full" keeps the draft UV layout and atlas sizes (scale 0.5); only samples rise. Full-res
# atlases (scale 1.0) would add ~40 MB and break the 35 MB budget. The shipped assets were baked with
# quality="draft", samples=256 (surfaces at draft samples); see README "Web viewer (phase 2)".
QUALITY = {"draft": {"scale": 0.5, "samples": 64}, "full": {"scale": 0.5, "samples": 256}}
# texel.atlas_size upper bound per group (size-budget knob 3; None = texel.atlas_size default)
ATLAS_HI = {}


def resolve_samples(quality, samples=None):
    """Sample count for a bake: `samples` overrides QUALITY[quality]["samples"] without touching
    scale, so a full-quality bake can reuse an existing (e.g. "draft") UV layout/atlas size and just
    raise sample count (pure, host-tested: no bpy)."""
    return QUALITY[quality]["samples"] if samples is None else samples


def _area(objs):
    return sum(p.area for o in objs for p in o.data.polygons)


# UV charts and packing live in uvpack.py (pure numpy, host-tested); see its docstring.
CELL_M = {"site": 64.0}          # grid cell per group (default 16 m)
# Task 13b: flat faces of the ground groups get planar top-down charts on this (coarser) grid; webscene
# cut their faces on the same grid, so a road, lawn or plaza is one chart per cell, not one per face
FLAT_CELL = {"site": groups.FLAT_CELL_M, "site_near": groups.FLAT_CELL_M, "pitch": groups.FLAT_CELL_M}
OVERLAP_TOLERANCE = 0.001        # max fraction of covered texels written twice (float32 edge rounding)


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


def _loop_triangles(objs):
    """Blender's own triangulation (concave n-gons), as global loop indices + face indices."""
    tris, faces = [], []
    loff = foff = 0
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        T = len(me.loop_triangles)
        t = np.empty(T * 3, np.int64)
        me.loop_triangles.foreach_get("loops", t)
        f = np.empty(T, np.int64)
        me.loop_triangles.foreach_get("polygon_index", f)
        tris.append(t.reshape(T, 3) + loff)
        faces.append(f + foff)
        loff += len(me.loops)
        foff += len(me.polygons)
    return np.concatenate(tris), np.concatenate(faces)


def _chart_uvs(objs, size, texels_per_m, cell, layer="LightmapUV", flat_cell=None):
    n, area, cen, tot, co = _group_mesh(objs)
    tris = _loop_triangles(objs)
    uv, stats = uvpack.chart_uvs(n, area, cen, tot, co, size, texels_per_m, cell, tris=tris, flat_cell=flat_cell)
    off = 0
    for o in objs:
        L = len(o.data.loops)
        o.data.uv_layers[layer].data.foreach_set("uv", uv[off:off + L].astype(np.float32).ravel())
        off += L
    # post-pack check on what the mesh (and so the glb) actually holds: float32 UVs
    stored = []
    for o in objs:
        d = o.data.uv_layers[layer].data
        a = np.empty(len(d) * 2, np.float32)
        d.foreach_get("uv", a)
        stored.append(a.reshape(-1, 2))
    over, covered, _ = uvpack.overlap(np.concatenate(stored).astype(np.float64), tris[0], size)
    stats.update(stored_overlap_texels=over, covered_texels=covered)
    return stats


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
        if me.get("lm_oriented"):                                      # once per WebExport build:
            continue                                                   # ambiguous faces would toggle
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
        me["lm_oriented"] = True
    return flipped


ORIENT_GROUPS = ("bowl", "structure")


CHART_STATS = {}
CLIP = {}                        # state -> group -> % of lit texels above rgbm.RANGE


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
        st = CHART_STATS[g] = _chart_uvs(objs, size, tpm, CELL_M.get(g, 16.0), flat_cell=FLAT_CELL.get(g))
        print(f"lightmap_uvs {g}: {size}px, {st['charts']} charts, overlap texels "
              f"{st['stored_overlap_texels']}/{st['covered_texels']} (rounds {st['overlap_rounds']})")
        if st["stored_overlap_texels"] > OVERLAP_TOLERANCE * st["covered_texels"]:
            raise RuntimeError(f"lightmap UVs of {g} overlap: {st['stored_overlap_texels']} texels")
        sizes[g] = size
    return sizes


# Area-weighted LED coverage of M_SailSkin (web LED_GLSL / shell._skin_material): dot area
# pi 0.055^2 / 1.1^2 = 0.79 %, lit cells mean(1 - fade(z)) = 0.164 over the skin, brightness 1.05.
# A uniform strength of 40 n (the first draft) lit the sails ~740x too bright (7-10 % RGBM clip).
SAIL_LED_COVERAGE = 0.00135


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
        strength = e["day"] + n * (e["night"] - e["day"]) if not e["baked"] else 0.0
        if info["special"] == "sailLeds":
            strength *= SAIL_LED_COVERAGE          # the LEDs are sparse dots, not a glowing skin
        em.inputs["Strength"].default_value = strength
    else:
        em.inputs["Strength"].default_value = 0.0
    nt.links.new(dif.outputs[0], add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    return m


DILATE_PX = 8                   # >= the 4-px chart gutter (uvpack.MARGIN_PX), like the old EXTEND margin


def _coverage(objs, size):
    """Texels the bake wrote: centres inside a LightmapUV triangle of any object of the group."""
    uv, tris, base = [], [], 0
    for o in objs:
        d = o.data.uv_layers["LightmapUV"].data
        a = np.empty(len(d) * 2, np.float32)
        d.foreach_get("uv", a)
        uv.append(a.reshape(-1, 2))
        tris.append(_loop_triangles([o])[0] + base)
        base += len(d)
    return uvpack.coverage(np.concatenate(uv).astype(np.float64), np.concatenate(tris), size)


def bake_lightmap(group, objs, size, state, n, samples):
    webscene.set_state(n)
    img = bpy.data.images.get(f"_lm_{group}") or bpy.data.images.new(f"_lm_{group}", size, size, float_buffer=True, alpha=False)
    img.scale(size, size)
    # every exported object gets the stand-in (the .web copies emit at a fixed strength 1 in any
    # state); only the baked group carries the target image node
    targets = {o.name for o in objs}
    everyone = [o for o in bpy.data.scenes[webscene.WEB].objects if o.get("webexport")]
    keep = {}
    for o in everyone:                                                 # originals first, never a stand-in
        m = o.data.materials[0]
        if m is None or m.name.startswith("_bake_"):
            m = bpy.data.materials.get(o["srcMat"] + ".web")
            if m is None:
                raise RuntimeError(f"{o.name}: no .web material to restore")
        keep[o.name] = m
    try:
        for o in everyone:
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
            sc.render.bake.margin = 0             # Blender's margin is per object: it overwrote the
            # texels of objects baked earlier into the same atlas; the atlas is dilated below instead
            for o in sc.objects:
                o.select_set(False)
            for o in objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, use_clear=True)
        finally:
            webscene.leave()
    finally:
        for o in everyone:
            tmp = o.data.materials[0]
            o.data.materials[0] = keep[o.name]
            o.data.uv_layers.active = o.data.uv_layers["UVMap"]
            if tmp is not None and tmp.name.startswith("_bake_"):
                bpy.data.materials.remove(tmp)
    buf = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(buf)
    rgb, _ = uvpack.dilate(buf.reshape(size, size, 4)[..., :3], _coverage(objs, size), DILATE_PX)
    lit = rgb.max(-1) > 1e-4
    CLIP.setdefault(state, {})[group] = round(float((rgb.max(-1) > rgbm.RANGE)[lit].mean()) * 100, 2) if lit.any() else 0.0
    enc = rgbm.encode(rgb)
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


# ---------------------------------------------------------------------------------------------
# Procedural base colour and night emission -> textures on UV0 ("UVMap"), Task 11.
# UV0 never touches "LightmapUV" (shared by the three baked lightmap states).

SURFACE_HI = 2048                # albedo/emission atlas cap (size-budget knob)
SURFACE_LO = 512                 # floor: at 256 the 4-px chart gutters eat most of the atlas
SURFACE_CELL_M = 16.0
# Materials whose detail is far finer than any unique atlas can hold: the city window pattern
# (3D Voronoi cells of ~1.1 m on 4.8 km2 of facade) would be sub-texel at 2048 and bake to a
# uniform glow. They get a box-projected, repeating UV0 (world metres / tile) and one baked tile
# of the same material instead: prefix -> (tile edge in metres, tile pixels).
SURFACE_TILE = {"M_Building": (64.0, 1024)}
SURFACE_STATS = {}               # obj name -> UV0 / bake stats


def _tile_of(mat_name):
    return next((v for k, v in SURFACE_TILE.items() if mat_name.startswith(k)), None)


def _uv0_charts(obj, size, texels_per_m):
    """Unique, overlap-checked UV0 atlas from uvpack (smart_project packing is unusable on 5.2)."""
    st = _chart_uvs([obj], size, texels_per_m, SURFACE_CELL_M, layer="UVMap")
    if st["stored_overlap_texels"] > OVERLAP_TOLERANCE * max(st["covered_texels"], 1):
        raise RuntimeError(f"UV0 of {obj.name} overlaps: {st['stored_overlap_texels']} texels")
    return st


def _uv0_box(obj, tile):
    """UV0 = world metres / tile on the face's dominant axis plane (repeat-wrapped in glTF)."""
    n, _, _, tot, co = _group_mesh([obj])
    ax = np.repeat(np.abs(n).argmax(1), tot)                      # dominant axis per loop
    u = np.where(ax == 0, co[:, 1], co[:, 0])
    v = np.where(ax == 2, co[:, 1], co[:, 2])
    uv = np.stack([u, v], 1) / tile
    obj.data.uv_layers["UVMap"].data.foreach_set("uv", uv.astype(np.float32).ravel())
    return {"mode": "box", "tile_m": tile}


def _to_srgb(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def _tile_plane(tile, key):
    """Temporary T x T quad (object coords = metres) with UV0 over [0, 1]. Its position in the
    procedural's object space depends on `key`, so materials sharing a pattern get different tiles."""
    import zlib
    x0 = 257.0 * (zlib.crc32(key.encode()) % 31)       # <= 8 km: float32 noise precision stays fine
    me = bpy.data.meshes.new("_surf_tile")
    me.from_pydata([(x0, 0, 0), (x0 + tile, 0, 0), (x0 + tile, tile, 0), (x0, tile, 0)], [], [(0, 1, 2, 3)])
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", [0, 0, 1, 0, 1, 1, 0, 1])
    ob = bpy.data.objects.new("_surf_tile", me)
    bpy.data.scenes[webscene.WEB].collection.objects.link(ob)
    return ob


def bake_surface(obj, info, scale, samples):
    """Base colour (DIFFUSE/COLOR) and night emission (EMIT at n=1) for node-driven materials.

    Bakes through a copy of the source material (never the shared original) and restores the
    object's '.web' material whatever happens. Writes build/web_raw/surfaces/<obj>_{base,emission}.png;
    returns {"base"?: image name, "emission"?: image name, "emNight"?: peak linear emission}."""
    out = {}
    tile = _tile_of(obj["srcMat"])
    if tile:
        size = tile[1]
        SURFACE_STATS[obj.name] = _uv0_box(obj, tile[0])
    else:
        tpm = groups.ALBEDO_TEXELS_PER_M[obj["lightmap"]] * scale
        size = texel.atlas_size(_area([obj]), tpm, lo=SURFACE_LO, hi=SURFACE_HI)
        SURFACE_STATS[obj.name] = dict(_uv0_charts(obj, size, tpm), mode="atlas")
    SURFACE_STATS[obj.name]["size"] = size
    jobs = []
    if info["kind"] == "procedural":
        jobs.append(("base", "DIFFUSE", {"COLOR"}, 0.0))
    if info["emission"] and info["emission"]["baked"]:
        jobs.append(("emission", "EMIT", set(), 1.0))
    keep = obj.data.materials[0]                                   # original first, never a stand-in
    if keep is None or keep.name.startswith(("_bake_", "_surf_")):
        keep = bpy.data.materials.get(obj["srcMat"] + ".web")
        if keep is None:
            raise RuntimeError(f"{obj.name}: no .web material to restore")
    src = plane = None
    entered = False
    try:
        src = bpy.data.materials[obj["srcMat"]].copy()              # never bake the shared original
        src.name = "_surf_" + obj["srcMat"]
        target = obj
        if tile:
            plane = target = _tile_plane(tile[0], obj["srcMat"])
            plane.data.materials.append(src)
        else:
            obj.data.materials[0] = src
        target.data.uv_layers.active = target.data.uv_layers["UVMap"]
        webscene.enter()
        entered = True
        sc = bpy.context.scene
        sc.cycles.samples = max(16, samples // 4)
        sc.render.bake.margin = 4
        sc.render.bake.margin_type = "EXTEND"
        for kind, btype, passes, n in jobs:
            webscene.set_state(n)
            name = f"{obj.name}_{kind}"
            for nm in (name, name + "_hdr"):
                if bpy.data.images.get(nm) is not None:
                    bpy.data.images.remove(bpy.data.images[nm])
            img = bpy.data.images.new(name + ("_hdr" if kind == "emission" else ""), size, size,
                                      float_buffer=(kind == "emission"))
            node = src.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = img
            src.node_tree.nodes.active = node
            for o in sc.objects:
                o.select_set(False)
            target.select_set(True)
            bpy.context.view_layer.objects.active = target
            bpy.ops.object.bake(type=btype, pass_filter=passes, use_clear=True)
            src.node_tree.nodes.remove(node)
            if kind == "emission":                                   # HDR -> LDR map x strength
                buf = np.empty(size * size * 4, np.float32)
                img.pixels.foreach_get(buf)
                px = buf.reshape(size, size, 4)
                peak = float(px[..., :3].max()) or 1.0
                out["emNight"] = round(peak, 4)
                SURFACE_STATS[obj.name]["emission_lit_pct"] = round(float((px[..., :3].max(-1) > 0.02 * peak).mean()) * 100, 2)
                px[..., :3] = _to_srgb(px[..., :3] / peak)          # byte sRGB image stores encoded values
                px[..., 3] = 1.0
                ldr = bpy.data.images.new(name, size, size)
                ldr.pixels.foreach_set(px.ravel())
                bpy.data.images.remove(img)
                img = ldr
            img.filepath_raw = os.path.join(RAW, "surfaces", f"{name}.png")
            os.makedirs(os.path.dirname(img.filepath_raw), exist_ok=True)
            img.file_format = "PNG"
            img.save()
            out[kind] = img.name
    finally:
        if entered:
            webscene.leave()
        obj.data.materials[0] = keep
        obj.data.uv_layers.active = obj.data.uv_layers["UVMap"]
        if plane is not None:
            me = plane.data
            bpy.data.objects.remove(plane, do_unlink=True)
            bpy.data.meshes.remove(me)
        if src is not None:
            bpy.data.materials.remove(src)
    return out
