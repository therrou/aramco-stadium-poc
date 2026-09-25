"""Realistic ground materials and vegetation.

Uses Poly Haven assets (CC0) when they are present in the .blend; they are
downloaded through the Blender MCP add-on and packed into the file:
  textures: aerial_beach_03, leafy_grass, square_tiles_03, asphalt_02
  models:   jacaranda_tree, island_tree_01, tree_small_02  (objects "<id>_LOD0")
Everything falls back to procedural stand-ins when an asset is missing, so the
build still runs on a fresh file.
Date palms are procedural (Poly Haven has none).
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import common as C

# Poly Haven model id -> scale so the tree lands at a plausible Gulf-park size
PH_TREES = {"jacaranda_tree": 0.6, "island_tree_01": 2.3, "tree_small_02": 2.4}


# --- textures --------------------------------------------------------------
def _img(asset, kind):
    return bpy.data.images.get(f"{asset}_{kind}")


def pbr_material(name, asset, size_m, fallback, macro=0.35, tint=(1, 1, 1), bump=0.3):
    """Tiled Poly Haven texture in object-space metres, with large-scale colour
    variation so the repeat is not visible from the air."""
    diff = _img(asset, "Diffuse")
    if diff is None:
        c1, c2, scale = fallback
        return _noise(name, c1, c2, scale)
    mat = C.new_material(name)
    nt, b = mat.node_tree, C.bsdf_of(mat)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / size_m, 1 / size_m, 1 / size_m)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])

    def tex(image, non_color):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image
        t.interpolation = "Cubic"
        if non_color:
            image.colorspace_settings.name = "Non-Color"
        nt.links.new(mp.outputs[0], t.inputs["Vector"])
        return t

    d = tex(diff, False)
    # macro variation: two octaves of noise multiply the albedo
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.012
    noise.inputs["Detail"].default_value = 4
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["To Min"].default_value = 1 - macro
    ramp.inputs["To Max"].default_value = 1 + macro * 0.5
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(d.outputs["Color"], mul.inputs["A"])
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3):
        nt.links.new(C.math_node(nt, "MULTIPLY", ramp.outputs[0], tint[i]), comb.inputs[i])
    nt.links.new(comb.outputs[0], mul.inputs["B"])
    nt.links.new(mul.outputs["Result"], b.inputs["Base Color"])
    r = _img(asset, "Rough")
    if r:
        nt.links.new(tex(r, True).outputs["Color"], b.inputs["Roughness"])
    n = _img(asset, "nor_gl")
    if n:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = bump
        nt.links.new(tex(n, True).outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    mat.diffuse_color = (0.4, 0.35, 0.3, 1)
    return mat


def _noise(name, c1, c2, scale):
    mat = C.new_material(name)
    nt, b = mat.node_tree, C.bsdf_of(mat)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (*c1, 1)
    mix.inputs["B"].default_value = (*c2, 1)
    nt.links.new(noise.outputs["Fac"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.85
    return mat


# --- date palm -------------------------------------------------------------
def _palm_materials():
    bark = bpy.data.materials.get("M_PalmBark")
    if bark is None:
        bark = C.principled("M_PalmBark", (0.23, 0.17, 0.11), rough=0.9)
        nt, b = bark.node_tree, C.bsdf_of(bark)
        tc = nt.nodes.new("ShaderNodeTexCoord")
        wave = nt.nodes.new("ShaderNodeTexWave")
        wave.wave_type = "BANDS"
        wave.bands_direction = "Z"
        wave.inputs["Scale"].default_value = 6.0
        wave.inputs["Distortion"].default_value = 3.0
        nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
        bm_ = nt.nodes.new("ShaderNodeBump")
        bm_.inputs["Strength"].default_value = 0.6
        nt.links.new(wave.outputs["Fac"], bm_.inputs["Height"])
        nt.links.new(bm_.outputs["Normal"], b.inputs["Normal"])
    leaf = bpy.data.materials.get("M_PalmFrond")
    if leaf is None:
        leaf = C.principled("M_PalmFrond", (0.16, 0.22, 0.1), rough=0.55)
        C.bsdf_of(leaf).inputs["Subsurface Weight"].default_value = 0.0
        _translucent(leaf, 0.25)
    dry = bpy.data.materials.get("M_PalmDry") or C.principled("M_PalmDry", (0.36, 0.27, 0.15), rough=0.8)
    return bark, leaf, dry


def _translucent(mat, fac):
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
    tr.inputs["Color"].default_value = (0.3, 0.45, 0.12, 1)
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = fac
    nt.links.new(C.bsdf_of(mat).outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])


def date_palm(name, coll, height=9.0, fronds=24, seed=1):
    """Phoenix dactylifera: ringed trunk, crown of arching pinnate fronds."""
    rng = random.Random(seed)
    bark, leaf, dry = _palm_materials()
    me = bpy.data.meshes.get(name)
    if me:
        bpy.data.meshes.remove(me)
    bm = bmesh.new()
    # trunk: tapered, slightly leaning, with a knobbly crown base
    lean = Vector((rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), 0))
    segs, rings = 10, 14
    prev = None
    for k in range(rings + 1):
        t = k / rings
        c = lean * t * t + Vector((0, 0, height * t))
        r = 0.42 - 0.12 * t + (0.08 if k == rings else 0)
        ring = [bm.verts.new(c + Vector((r * math.cos(2 * math.pi * i / segs),
                                         r * math.sin(2 * math.pi * i / segs), 0)))
                for i in range(segs)]
        if prev:
            for i in range(segs):
                f = bm.faces.new((prev[i], prev[(i + 1) % segs], ring[(i + 1) % segs], ring[i]))
                f.material_index = 0
        prev = ring
    top = lean + Vector((0, 0, height))
    # fronds
    for fi in range(fronds):
        az = 2 * math.pi * fi / fronds + rng.uniform(-0.1, 0.1)
        tier = fi % 3
        elev = math.radians([55, 25, -5][tier] + rng.uniform(-8, 8))
        dead = tier == 2 and rng.random() < 0.3
        length = rng.uniform(3.6, 4.6)
        d = Vector((math.cos(az) * math.cos(elev), math.sin(az) * math.cos(elev), math.sin(elev)))
        side = Vector((-math.sin(az), math.cos(az), 0))
        n_pts = 16
        spine = []
        for j in range(n_pts + 1):
            s = j / n_pts
            p = top + d * length * s + Vector((0, 0, -1.6 * s * s))   # droop
            spine.append(p)
        # rachis as thin strip
        for j in range(n_pts):
            a, b_ = spine[j], spine[j + 1]
            w = 0.05 * (1 - j / n_pts) + 0.01
            v = [bm.verts.new(a - side * w), bm.verts.new(a + side * w),
                 bm.verts.new(b_ + side * w), bm.verts.new(b_ - side * w)]
            bm.faces.new(v).material_index = 2 if dead else 1
        # leaflets: V-shaped pairs along the outer 80 % of the rachis
        for j in range(3, n_pts):
            s = j / n_pts
            base = spine[j]
            tang = (spine[min(j + 1, n_pts)] - spine[j - 1]).normalized()
            ll = 0.75 * math.sin(math.pi * min(1.0, 0.15 + s)) + 0.15
            for sgn in (-1, 1):
                for sub in (0.0, 0.5):
                    p0 = base + tang * sub * length / n_pts
                    out = (side * sgn * 0.85 + Vector((0, 0, 0.45)) + tang * 0.35).normalized()
                    p1 = p0 + out * ll
                    wv = tang * 0.035
                    v = [bm.verts.new(p0 - wv), bm.verts.new(p0 + wv),
                         bm.verts.new(p1 + wv * 0.3), bm.verts.new(p1 - wv * 0.3)]
                    bm.faces.new(v).material_index = 2 if dead else 1
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in (bark, leaf, dry):
        me.materials.append(m)
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    return obj


# --- tree library ------------------------------------------------------------
def tree_library():
    """Collection of instanceable tree models (not linked to the scene)."""
    lib = bpy.data.collections.get("TreeModels") or bpy.data.collections.new("TreeModels")
    for o in list(lib.objects):
        lib.objects.unlink(o)
        if o.name.startswith("Palm_") and not o.users_collection:
            bpy.data.objects.remove(o)
    models = []
    for pid, scale in PH_TREES.items():
        obj = bpy.data.objects.get(f"{pid}_LOD0")
        if obj is None:
            continue
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
            if c.name == f"{pid}_LOD0" and not c.objects and c.name in bpy.context.scene.collection.children:
                bpy.context.scene.collection.children.unlink(c)
        lib.objects.link(obj)
        obj.location = (0, 0, 0)
        obj.scale = (scale, scale, scale)
        # millions of tris: viewport-only decimated proxy, full mesh in renders
        dec = obj.modifiers.get("ViewportProxy") or obj.modifiers.new("ViewportProxy", "DECIMATE")
        dec.ratio = 0.01
        dec.show_render = False
        dec.show_viewport = True
        obj.display_type = "TEXTURED"
        models.append(obj.name)
    for i, (h, f) in enumerate(((9.5, 26), (7.0, 22))):
        p = date_palm(f"Palm_{i}", lib, height=h, fronds=f, seed=7 + i)
        p.display_type = "TEXTURED"
        models.append(p.name)
    return lib, models


GRANITE_TILE_M = 4.8     # one texture tile: 4 x 8 slabs of 1.2 x 0.6 m in running bond


def granite_images(px=1024, seed=7):
    """Generate (once) a tileable granite-slab set named like the Poly Haven ones, so
    pbr_material() and the web exporter treat it as a tiled texture (refs/v4/plaza_ground.jpg)."""
    import numpy as np
    if bpy.data.images.get("granite_slabs_Diffuse"):
        return "granite_slabs"
    rng = np.random.default_rng(seed)
    m = GRANITE_TILE_M
    yy, xx = np.mgrid[0:px, 0:px].astype(np.float32) * (m / px)
    row = np.floor(yy / 0.6).astype(int)                       # 8 rows
    xs = xx + (row % 2) * 0.6                                  # running bond
    col = np.floor(xs / 1.2).astype(int) % 4
    tone = rng.uniform(0.78, 1.18, (8, 4))[row, col]           # each slab its own tone
    fx, fy = (xs % 1.2) / 1.2, (yy % 0.6) / 0.6
    ex = np.minimum(fx, 1 - fx) * 1.2
    ey = np.minimum(fy, 1 - fy) * 0.6
    joint = np.clip(np.minimum(ex, ey) / 0.008, 0, 1)          # 0 in the 16 mm joints
    grain = rng.normal(1.0, 0.06, (px, px)).astype(np.float32)
    base = np.array([0.36, 0.34, 0.31], np.float32)            # warm grey granite (linear)
    alb = base[None, None, :] * (tone * grain)[..., None]
    alb = alb * joint[..., None] + np.array([0.16, 0.155, 0.15])[None, None, :] * (1 - joint[..., None])
    rough = 0.45 + 0.4 * (1 - joint) + rng.normal(0, 0.03, (px, px))
    h = joint
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    n = np.stack([-gx * 2.0, -gy * 2.0, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)

    def put(kind, rgb, srgb):
        img = bpy.data.images.new(f"granite_slabs_{kind}", px, px, alpha=False)
        if srgb:
            rgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(np.clip(rgb, 0, 1), 1 / 2.4) - 0.055)
        else:
            img.colorspace_settings.name = "Non-Color"
        a = np.concatenate([np.clip(rgb, 0, 1), np.ones((px, px, 1), np.float32)], -1)
        img.pixels.foreach_set(a.astype(np.float32).ravel())
        img.pack()
    put("Diffuse", alb, True)
    put("Rough", np.repeat(rough[..., None], 3, -1), False)
    put("nor_gl", n * 0.5 + 0.5, False)
    return "granite_slabs"
