"""Temporary export scene "WebExport": merged, lightmap-ready copies.

The render scene is only read: evaluated meshes are copied, and its lights and
instancers (seats, trees, crowd) are *linked* into WebExport as bake occluders.
"""
import bmesh
import bpy

from . import groups

SRC, WEB = "Scene", "WebExport"
_prev = {}


def src():
    return bpy.data.scenes[SRC]


def enter():
    _prev["scene"] = bpy.context.window.scene
    bpy.context.window.scene = bpy.data.scenes[WEB]


def leave():
    bpy.context.window.scene = _prev.get("scene") or src()


def set_state(n):
    """Drivers read Scene["night"]; world/material attribute nodes read the rendering scene."""
    for name in (SRC, WEB):
        sc = bpy.data.scenes.get(name)
        if sc is not None:
            sc["night"] = float(n)
            sc.update_tag()
    bpy.context.view_layer.update()


def _fresh_scene():
    old = bpy.data.scenes.get(WEB)
    if old is not None:
        for o in list(old.collection.objects):
            if o.get("webexport"):
                me = o.data
                bpy.data.objects.remove(o, do_unlink=True)
                if me is not None and me.users == 0:
                    bpy.data.meshes.remove(me)             # else reruns name meshes "*.001"
        bpy.data.scenes.remove(old)
    web = bpy.data.scenes.new(WEB)
    s = src()
    web.world = s.world
    web.render.engine = "CYCLES"
    web.cycles.device = s.cycles.device
    web["night"] = s.get("night", 0.0)
    for cname in ("Lighting", "NightLights"):
        web.collection.children.link(bpy.data.collections[cname])
    for o in s.objects:
        if o.name.startswith(("Seats_", "Trees_", "Crowd_")):
            web.collection.objects.link(o)                     # occluders only; not exported
    return web


def _sources():
    for cname in groups.GROUP_OF_COLLECTION:
        for o in bpy.data.collections[cname].objects:
            if o.type in {"MESH", "FONT", "CURVE"} and not o.hide_render and not groups.is_excluded(o.name):
                yield cname, o


def build():
    STATS.clear()
    web = _fresh_scene()
    dg = bpy.context.evaluated_depsgraph_get()
    acc = {}                                                   # (group, mat) -> bmesh
    for cname, o in _sources():
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
        me.transform(o.matrix_world)
        for idx, mat in enumerate(me.materials):
            if mat is None:
                continue
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != idx], context="FACES")
            if not bm.faces:
                bm.free()
                continue
            tmp = bpy.data.meshes.new("_tmp")
            bm.to_mesh(tmp)
            bm.free()
            key = (groups.group_of(cname, mat.name), mat.name)
            acc.setdefault(key, bmesh.new()).from_mesh(tmp)    # from_mesh appends
            bpy.data.meshes.remove(tmp)
        bpy.data.meshes.remove(me)
    parts = []
    for (grp, mname), bm in sorted(acc.items()):
        if grp in GROUND_GROUPS:
            _orient_ground(bm)
            _cut_flat(bm, groups.FLAT_CELL_M)
        if grp == "site":
            parts += _split_near(bm, mname)
        else:
            parts.append((grp, mname, bm))
    out = []
    for grp, mname, bm in sorted(parts, key=lambda p: (p[0], p[1])):
        me = bpy.data.meshes.new(f"{grp}__{mname}")
        for f in bm.faces:
            f.material_index = 0
        bm.to_mesh(me)
        bm.free()
        keep = mname in groups.KEEP_UV_MATERIALS and "UVMap" in me.uv_layers
        for layer in list(me.uv_layers):
            if not (keep and layer.name == "UVMap"):
                me.uv_layers.remove(layer)
        if not keep:
            me.uv_layers.new(name="UVMap")                      # TEXCOORD_0
        me.uv_layers.new(name="LightmapUV")                     # TEXCOORD_1
        me.materials.append(bpy.data.materials[mname])          # swapped for the .web copy later
        obj = bpy.data.objects.new(me.name, me)
        obj["webexport"], obj["lightmap"], obj["srcMat"] = True, grp, mname
        web.collection.objects.link(obj)
        out.append(obj)
    return out


GROUND_GROUPS = ("site", "pitch")
STATS = {}


def _face_arrays(bm):
    import numpy as np
    bm.normal_update()
    faces = list(bm.faces)
    n = np.array([f.normal[:] for f in faces]).reshape(-1, 3)
    c = np.array([f.calc_center_median()[:] for f in faces]).reshape(-1, 3)
    return faces, n, c


def _orient_ground(bm):
    """Flip ground-layer faces that point down into the ground (uvpack.ground_down, Task 13b)."""
    from . import uvpack
    faces, n, c = _face_arrays(bm)
    m = uvpack.ground_down(n, c)
    if m.any():
        bmesh.ops.reverse_faces(bm, faces=[f for f, k in zip(faces, m) if k])
    STATS["flipped"] = STATS.get("flipped", 0) + int(m.sum())


def _cut_flat(bm, cell):
    """Cut flat faces on the world grid lines x, y = k * cell, so no flat face straddles a chart cell."""
    import math
    from . import uvpack
    cuts = 0
    for axis in (0, 1):
        faces, n, _ = _face_arrays(bm)
        ks = set()
        for f, fn in zip(faces, n):
            if fn[2] > uvpack.FLAT_NZ:
                vs = [v.co[axis] for v in f.verts]
                ks.update(range(math.floor(min(vs) / cell) + 1, math.ceil(max(vs) / cell)))
        for k in sorted(ks):
            x = k * cell
            hit = [f for f in bm.faces if f.normal.z > uvpack.FLAT_NZ
                   and min(v.co[axis] for v in f.verts) < x - 1e-4 < x + 1e-4 < max(v.co[axis] for v in f.verts)]
            if not hit:
                continue
            geom = list({e for f in hit for e in f.edges}) + list({v for f in hit for v in f.verts}) + hit
            co, no = [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]
            co[axis], no[axis] = x, 1.0
            bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-4, plane_co=co, plane_no=no)
            cuts += 1
    STATS["cuts"] = STATS.get("cuts", 0) + cuts


def _split_near(bm, mname):
    """[(group, material, bmesh)]: flat faces near the stadium go to "site_near" (groups.site_split)."""
    import numpy as np
    from . import uvpack
    faces, n, c = _face_arrays(bm)
    g = groups.site_split("site", mname, n[:, 2] > uvpack.FLAT_NZ, np.hypot(c[:, 0], c[:, 1]))
    near = g == "site_near"
    if not near.any():
        return [("site", mname, bm)]
    if near.all():
        return [("site_near", mname, bm)]
    far = bm.copy()
    far.faces.ensure_lookup_table()
    bmesh.ops.delete(far, geom=[far.faces[i] for i in np.nonzero(near)[0]], context="FACES")
    bmesh.ops.delete(bm, geom=[f for f, k in zip(faces, near) if not k], context="FACES")
    return [("site_near", mname, bm), ("site", mname, far)]


def planar_uv(obj, tile):
    """UV0 = world XY / tile (tiled Poly Haven materials use object-space metres)."""
    me = obj.data
    uv = me.uv_layers["UVMap"].data
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uv[loop.index].uv = (co.x / tile, co.y / tile)


def triangles(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
