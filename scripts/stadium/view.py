"""Dev helpers for inspecting the model from the Blender UI."""
import bpy
import mathutils


def set_view(loc, target, lens=35, shading="MATERIAL"):
    """Point every 3D viewport from `loc` at `target`."""
    loc, target = mathutils.Vector(loc), mathutils.Vector(target)
    d = target - loc
    for area in bpy.context.screen.areas:
        if area.type != "VIEW_3D":
            continue
        sp = area.spaces.active
        r3 = sp.region_3d
        r3.view_perspective = "PERSP"
        sp.lens = lens
        sp.clip_start, sp.clip_end = 0.3, 20000
        sp.shading.type = shading
        sp.overlay.show_overlays = False
        r3.view_rotation = d.to_track_quat("-Z", "Y")
        r3.view_location = target
        r3.view_distance = d.length


def render(camera, path, res=(960, 540), samples=48, night=None):
    """Quick Cycles still from a named camera."""
    scene = bpy.context.scene
    if night is not None:
        scene["night"] = 1.0 if night else 0.0
        scene.update_tag()
    scene.camera = bpy.data.objects[camera]
    scene.render.engine = "CYCLES"
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def boot():
    import importlib
    import sys
    p = "/Users/Tomas.Herrou/aramco-stadium-3d/scripts"
    if p not in sys.path:
        sys.path.insert(0, p)
    from stadium import build
    importlib.reload(build)
    return build
