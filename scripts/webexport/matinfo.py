"""Classify the stadium's Blender materials into glTF-friendly kinds.

constant   : principled inputs are plain values -> glTF factors
tiled      : Poly Haven image textures on object-space metres (assets.pbr_material)
procedural : node-driven base colour -> baked in Task 11
Emission follows common.night_emission (day + n * (night - day)) where it can be parsed.
"""
import bpy


def _bsdf(mat):
    return next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def _upstream(sock, types, depth=6):
    """First node of one of `types` feeding `sock` (breadth-first, a few hops)."""
    frontier = [l.from_node for l in sock.links]
    for _ in range(depth):
        nxt = []
        for n in frontier:
            if n.type in types:
                return n
            for i in n.inputs:
                nxt += [l.from_node for l in i.links]
        frontier = nxt
    return None


def _night_emission(b):
    """(day, night) if Emission Strength = ADD(MULTIPLY(attr, night-day), day), else None."""
    s = b.inputs["Emission Strength"]
    if not s.links:
        v = round(s.default_value, 6)
        return (v, v) if v > 0 else None
    add = s.links[0].from_node
    if add.type != "MATH" or add.operation != "ADD" or not add.inputs[0].links:
        return None
    mul = add.inputs[0].links[0].from_node
    if mul.type != "MATH" or mul.operation != "MULTIPLY" or not mul.inputs[0].links:
        return None
    if mul.inputs[0].links[0].from_node.type != "ATTRIBUTE":
        return None
    day = add.inputs[1].default_value
    # sockets are float32: round so 0.15 reads back as 0.15, not 0.15000000596
    return (round(day, 6), round(day + mul.inputs[1].default_value, 6))


def _scalar(sock, depth=4):
    """Constant value of a float socket through MULTIPLY/ADD math; a Map Range gives its mid-range
    (its input here is a 0..1 noise with mean ~0.5). None if not reducible."""
    if not sock.links:
        v = sock.default_value
        return float(v) if isinstance(v, float) else None
    n = sock.links[0].from_node
    if depth == 0:
        return None
    if n.type == "MAP_RANGE":
        return 0.5 * (n.inputs["To Min"].default_value + n.inputs["To Max"].default_value)
    if n.type == "MATH" and n.operation in {"MULTIPLY", "ADD"}:
        a, b = _scalar(n.inputs[0], depth - 1), _scalar(n.inputs[1], depth - 1)
        if a is None or b is None:
            return None
        return a * b if n.operation == "MULTIPLY" else a + b
    return None


def _tint(bc):
    """Mean colour multiplier on an image base colour: Mix(MULTIPLY, image, CombineColor(...)) (Task 13b:
    the Poly Haven site materials tint the image, e.g. lawn x (0.71, 0.89, 0.67); the export dropped it)."""
    if not bc.links:
        return None
    mix = bc.links[0].from_node
    if mix.type != "MIX" or getattr(mix, "blend_type", "") != "MULTIPLY":
        return None
    ins = [i for i in mix.inputs if i.enabled and i.type == "RGBA"]
    for side in ins:
        if side.links and side.links[0].from_node.type == "COMBINE_COLOR":
            cc = side.links[0].from_node
            t = [_scalar(i) for i in cc.inputs[:3]]
            if None not in t:
                return tuple(round(x, 4) for x in t)
    return None


def _image_mean(img, srgb):
    """Mean linear value of an image (byte pixels are stored encoded: decoded here when sRGB)."""
    import numpy as np
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    rgb = a.reshape(-1, 4)[::7, :3].astype(np.float64)
    if srgb and not img.is_float:
        rgb = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    return rgb.mean(0)


def classify(mat):
    b = _bsdf(mat)
    info = {"name": mat.name, "kind": "constant", "base": tuple(mat.diffuse_color[:3]),
            "rough": 0.5, "metal": 0.0, "alpha": 1.0, "tile": None, "images": {},
            "emission": None, "special": None, "tint": None}
    if b is None:
        return info
    bc = b.inputs["Base Color"]
    if not bc.links:
        info["base"] = tuple(bc.default_value[:3])
    info["rough"] = b.inputs["Roughness"].default_value if not b.inputs["Roughness"].links else 0.5
    rn = _upstream(b.inputs["Roughness"], {"MAP_RANGE"})
    if rn is not None:
        info["rough"] = 0.5 * (rn.inputs["To Min"].default_value + rn.inputs["To Max"].default_value)
    info["metal"] = b.inputs["Metallic"].default_value
    info["alpha"] = b.inputs["Alpha"].default_value
    if b.inputs["Transmission Weight"].default_value > 0.5:
        info["alpha"] = min(info["alpha"], 0.35)              # glass: plain alpha blend on the web
    if bc.links:
        img = _upstream(bc, {"TEX_IMAGE"})
        mp = _upstream(bc, {"MAPPING"}, depth=8)
        if img is not None and img.image is not None:
            info["kind"] = "tiled"
            info["images"]["base"] = img.image.name
            if mp is not None:
                info["tile"] = 1.0 / mp.inputs["Scale"].default_value[0]
            info["tint"] = _tint(bc)
            mean = _image_mean(img.image, img.image.colorspace_settings.name != "Non-Color")
            # bake stand-in albedo: the textured material's mean colour, not the viewport colour
            info["base"] = tuple(round(float(m * t), 4) for m, t in zip(mean, info["tint"] or (1, 1, 1)))
            ri = _upstream(b.inputs["Roughness"], {"TEX_IMAGE"}, depth=2)
            if ri is not None and ri.image is not None:
                info["rough"] = round(float(_image_mean(ri.image, False).mean()), 3)   # was a flat 0.5
            nm = next((n for n in mat.node_tree.nodes if n.type == "NORMAL_MAP"), None)
            if nm is not None:
                ni = _upstream(nm.inputs["Color"], {"TEX_IMAGE"})
                if ni is not None and ni.image is not None:
                    info["images"]["normal"] = ni.image.name
        else:
            info["kind"] = "procedural"
    col = tuple(b.inputs["Emission Color"].default_value[:3])
    ei = _upstream(b.inputs["Emission Color"], {"TEX_IMAGE"}, depth=2)
    if ei is not None and ei.image is not None:
        info["images"]["emission"] = ei.image.name            # UV-mapped LED content (signage.py)
        col = (1.0, 1.0, 1.0)
    ne = _night_emission(b)
    if mat.name == "M_SailSkin":
        info["special"] = "sailLeds"                             # decision D7
        info["emission"] = {"color": col, "day": 0.0, "night": 40.0, "baked": False}
    elif ne is not None:
        info["emission"] = {"color": col, "day": ne[0], "night": ne[1], "baked": False}
    elif b.inputs["Emission Strength"].links:
        info["emission"] = {"color": col, "day": 0.0, "night": 1.0, "baked": True}   # night set by the bake
    return info
