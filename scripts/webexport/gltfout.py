"""glTF-friendly '.web' copies of materials, and glb export of the WebExport scene."""
import bpy

from . import webscene


def web_material(info, baked):
    """baked: {"base": image name?, "emission": image name?, "emNight": float?}"""
    name = info["name"] + ".web"
    old = bpy.data.materials.get(name)
    if old is not None:
        bpy.data.materials.remove(old)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"

    def image(img_name, sock, non_color=False):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images[img_name]
        if non_color:
            t.image.colorspace_settings.name = "Non-Color"
        nt.links.new(uv.outputs["UV"], t.inputs["Vector"])
        nt.links.new(t.outputs["Color"], sock)
        return t

    b.inputs["Base Color"].default_value = (*info["base"], 1.0)
    if baked.get("base"):
        image(baked["base"], b.inputs["Base Color"])
    elif info["kind"] == "tiled":
        image(info["images"]["base"], b.inputs["Base Color"])
        if "normal" in info["images"]:
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.uv_map = "UVMap"
            image(info["images"]["normal"], nm.inputs["Color"], non_color=True)
            nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = info["rough"]
    b.inputs["Metallic"].default_value = info["metal"]
    b.inputs["Alpha"].default_value = info["alpha"]
    if info["alpha"] < 1.0:
        mat.surface_render_method = "BLENDED"
    em = info["emission"]
    mat["emDay"], mat["emNight"], mat["special"] = 0.0, 0.0, info["special"] or ""
    if em:
        b.inputs["Emission Color"].default_value = (*em["color"], 1.0)
        b.inputs["Emission Strength"].default_value = 1.0
        if baked.get("emission"):
            image(baked["emission"], b.inputs["Emission Color"])
        mat["emDay"] = em["day"]
        mat["emNight"] = baked.get("emNight", em["night"])
    return mat


def export_glb(objs, path):
    webscene.enter()
    try:
        for o in bpy.context.scene.objects:
            o.select_set(False)
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_selection=True, use_active_scene=True,
            export_extras=True,
            export_yup=True, export_apply=True, export_texcoords=True, export_normals=True,
            export_materials="EXPORT", export_image_format="AUTO", export_cameras=False,
            export_lights=False, export_animations=False)
    finally:
        webscene.leave()
