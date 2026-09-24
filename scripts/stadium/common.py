"""Shared helpers: collections, mesh creation, plan curves, material nodes."""
import math

import bpy

from . import params as P


# --- collections ---------------------------------------------------------
def collection(name, parent=None):
    """Return an empty collection `name`, deleting any previous contents."""
    coll = bpy.data.collections.get(name)
    if coll:
        for child in list(coll.children):
            _purge_collection(child)
        for obj in list(coll.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
    else:
        coll = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(coll)
    return coll


def _purge_collection(coll):
    for child in list(coll.children):
        _purge_collection(child)
    for obj in list(coll.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(coll)


def mesh_object(name, verts, faces, coll, mats=(), edges=(), smooth=False,
                mat_indices=None, uvs=None):
    """Create a mesh object. `uvs` is a per-loop list matching faces order."""
    me = bpy.data.meshes.get(name)
    if me:
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, list(edges), faces)
    for m in mats:
        me.materials.append(m)
    if mat_indices is not None:
        me.polygons.foreach_set("material_index", mat_indices)
    if uvs is not None:
        layer = me.uv_layers.new(name="UVMap")
        flat = [c for uv in uvs for c in uv]
        layer.data.foreach_set("uv", flat)
    me.validate()
    if smooth:
        me.shade_smooth()
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    return obj


# --- plan curves ---------------------------------------------------------
def superellipse(a, b, n, t):
    c, s = math.cos(t), math.sin(t)
    return (a * math.copysign(abs(c) ** (2 / n), c),
            b * math.copysign(abs(s) ** (2 / n), s))


def plan_loop(a, b, n, count):
    """Points and outward unit normals of a superellipse, CCW from +X."""
    pts = [superellipse(a, b, n, 2 * math.pi * i / count) for i in range(count)]
    nrm = []
    for i in range(count):
        (x0, y0), (x1, y1) = pts[i - 1], pts[(i + 1) % count]
        tx, ty = x1 - x0, y1 - y0
        ln = math.hypot(tx, ty) or 1.0
        nrm.append((ty / ln, -tx / ln))
    return pts, nrm


def offset_loop(pts, nrm, d):
    return [(x + nx * d, y + ny * d) for (x, y), (nx, ny) in zip(pts, nrm)]


def cumulative_length(loop):
    out, acc = [0.0], 0.0
    for i in range(1, len(loop) + 1):
        (x0, y0), (x1, y1) = loop[i - 1], loop[i % len(loop)]
        acc += math.hypot(x1 - x0, y1 - y0)
        out.append(acc)
    return out  # len = len(loop)+1, last = perimeter


def sweep(loop_pts, loop_nrm, profile, name, coll, mats=(), mat_of_seg=None,
          closed_profile=False, smooth=False):
    """Sweep a (d, z) profile around a closed plan loop.

    Each profile point is placed at base point + normal * d, height z.
    `mat_of_seg(j)` gives the material index for profile segment j.
    """
    n, m = len(loop_pts), len(profile)
    verts = []
    for (x, y), (nx, ny) in zip(loop_pts, loop_nrm):
        for d, z in profile:
            verts.append((x + nx * d, y + ny * d, z))
    faces, mids = [], []
    segs = m if closed_profile else m - 1
    for i in range(n):
        i2 = (i + 1) % n
        for j in range(segs):
            j2 = (j + 1) % m
            faces.append((i * m + j, i2 * m + j, i2 * m + j2, i * m + j2))
            mids.append(mat_of_seg(j) if mat_of_seg else 0)
    return mesh_object(name, verts, faces, coll, mats, mat_indices=mids,
                       smooth=smooth)


def tube_modifier(obj, radius, material, resolution=6, name=None):
    """Turn a mesh made of edges into round tubes (steel members)."""
    gname = name or f"GN_Tube_{obj.name}"
    ng = bpy.data.node_groups.get(gname)
    if ng:
        bpy.data.node_groups.remove(ng)
    ng = bpy.data.node_groups.new(gname, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nd, ln = ng.nodes, ng.links
    gi, go = nd.new("NodeGroupInput"), nd.new("NodeGroupOutput")
    m2c = nd.new("GeometryNodeMeshToCurve")
    circ = nd.new("GeometryNodeCurvePrimitiveCircle")
    circ.inputs["Resolution"].default_value = resolution
    circ.inputs["Radius"].default_value = radius
    c2m = nd.new("GeometryNodeCurveToMesh")
    c2m.inputs["Fill Caps"].default_value = True
    setm = nd.new("GeometryNodeSetMaterial")
    setm.inputs["Material"].default_value = material
    smooth = nd.new("GeometryNodeSetShadeSmooth")
    ln.new(gi.outputs[0], m2c.inputs["Mesh"])
    ln.new(m2c.outputs[0], c2m.inputs["Curve"])
    ln.new(circ.outputs["Curve"], c2m.inputs["Profile Curve"])
    ln.new(c2m.outputs[0], setm.inputs["Geometry"])
    ln.new(setm.outputs[0], smooth.inputs["Geometry"])
    ln.new(smooth.outputs[0], go.inputs[0])
    mod = obj.modifiers.new("Tubes", "NODES")
    mod.node_group = ng
    return mod


# --- materials -----------------------------------------------------------
def new_material(name):
    mat = bpy.data.materials.get(name)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    return mat


def bsdf_of(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def principled(name, color, rough=0.5, metal=0.0, alpha=1.0, transmission=0.0,
               emission=None, emission_strength=0.0):
    mat = new_material(name)
    b = bsdf_of(mat)
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Alpha"].default_value = alpha
    b.inputs["Transmission Weight"].default_value = transmission
    if emission:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = emission_strength
    mat.diffuse_color = (*color, 1.0)
    return mat


def night_node(nt, x=-600, y=300):
    """Attribute node reading the scene 'night' property (0 day .. 1 night)."""
    a = nt.nodes.new("ShaderNodeAttribute")
    a.attribute_type = "VIEW_LAYER"
    a.attribute_name = P.NIGHT_PROP
    a.location = (x, y)
    return a.outputs["Fac"]


def math_node(nt, op, a=None, b=None, x=0, y=0, clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    n.location = (x, y)
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def night_emission(mat, color, day_strength, night_strength):
    """Drive the principled emission by the night property."""
    nt = mat.node_tree
    b = bsdf_of(mat)
    b.inputs["Emission Color"].default_value = (*color, 1.0)
    fac = night_node(nt)
    span = math_node(nt, "MULTIPLY", fac, night_strength - day_strength, x=-400, y=300)
    s = math_node(nt, "ADD", span, day_strength, x=-200, y=300)
    nt.links.new(s, b.inputs["Emission Strength"])


def ensure_night_property(value=0.0):
    scene = bpy.context.scene
    if P.NIGHT_PROP not in scene:
        scene[P.NIGHT_PROP] = value
    ui = scene.id_properties_ui(P.NIGHT_PROP)
    ui.update(min=0.0, max=1.0, soft_min=0.0, soft_max=1.0,
              description="0 = day, 1 = night (drives sky, lights, emission)")


def drive(target, path, expr, var_path=None, index=-1):
    """Driver on target.path using scene night property as variable 'n'."""
    fc = target.driver_add(path, index) if index >= 0 else target.driver_add(path)
    drv = fc.driver
    drv.type = "SCRIPTED"
    for v in list(drv.variables):
        drv.variables.remove(v)
    var = drv.variables.new()
    var.name = "n"
    var.type = "SINGLE_PROP"
    var.targets[0].id_type = "SCENE"
    var.targets[0].id = bpy.context.scene
    var.targets[0].data_path = var_path or f'["{P.NIGHT_PROP}"]'
    drv.expression = expr
    return fc
