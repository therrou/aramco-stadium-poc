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
    out = []
    for (grp, mname), bm in sorted(acc.items()):
        me = bpy.data.meshes.new(f"{grp}__{mname}")
        for f in bm.faces:
            f.material_index = 0
        bm.to_mesh(me)
        bm.free()
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        me.uv_layers.new(name="UVMap")                          # TEXCOORD_0
        me.uv_layers.new(name="LightmapUV")                     # TEXCOORD_1
        me.materials.append(bpy.data.materials[mname])          # swapped for the .web copy later
        obj = bpy.data.objects.new(me.name, me)
        obj["webexport"], obj["lightmap"], obj["srcMat"] = True, grp, mname
        web.collection.objects.link(obj)
        out.append(obj)
    return out


def planar_uv(obj, tile):
    """UV0 = world XY / tile (tiled Poly Haven materials use object-space metres)."""
    me = obj.data
    uv = me.uv_layers["UVMap"].data
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uv[loop.index].uv = (co.x / tile, co.y / tile)


def triangles(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
