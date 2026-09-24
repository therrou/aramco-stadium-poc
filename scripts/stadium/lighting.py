"""Day / night lighting driven by one scene property: scene["night"] (0..1).

Day: physical sky + sun (late afternoon, Gulf haze).
Night: dark sky, moonlight, floodlights on the compression ring, emissive
facade LEDs / concourse glazing (those are in the materials, same property).
Toggle from Python with `set_night(True/False)` or the N-panel slider.
"""
import math

import bpy

from . import common as C
from . import params as P

SUN_ELEVATION = math.radians(24.0)
SUN_AZIMUTH = math.radians(235.0)   # from +Y, clockwise (south-west sun)
DUSK_ELEVATION = math.radians(0.8)
DUSK_AZIMUTH = math.radians(290.0)  # sunset in the west-north-west


def _sun_rotation():
    # Blender sun points down -Z; aim it along the incoming direction
    return (math.pi / 2 - SUN_ELEVATION, 0.0, math.pi - SUN_AZIMUTH)


def _world():
    world = bpy.data.worlds.get("W_Stadium") or bpy.data.worlds.new("W_Stadium")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_elevation = SUN_ELEVATION
    sky.sun_rotation = SUN_AZIMUTH
    sky.altitude = 50.0
    sky.air_density = 1.4
    sky.aerosol_density = 2.2       # hazy Gulf air
    sky.sun_disc = False            # the Sun lamp provides the direct light
    bg_day = nt.nodes.new("ShaderNodeBackground")
    bg_day.inputs["Strength"].default_value = 0.4
    nt.links.new(sky.outputs["Color"], bg_day.inputs["Color"])
    # night = dusk / blue hour (Aramco Stadium key visuals): sun just below the
    # horizon in the west, orange band on the horizon, deep blue overhead
    dusk = nt.nodes.new("ShaderNodeTexSky")
    dusk.sky_type = "MULTIPLE_SCATTERING"
    dusk.sun_elevation = DUSK_ELEVATION
    dusk.sun_rotation = DUSK_AZIMUTH
    dusk.altitude = 50.0
    dusk.air_density = 1.2
    dusk.aerosol_density = 3.0
    dusk.sun_disc = False
    bg_night = nt.nodes.new("ShaderNodeBackground")
    bg_night.inputs["Strength"].default_value = 0.09
    nt.links.new(dusk.outputs["Color"], bg_night.inputs["Color"])
    mix = nt.nodes.new("ShaderNodeMixShader")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_type = "VIEW_LAYER"
    attr.attribute_name = P.NIGHT_PROP
    nt.links.new(attr.outputs["Fac"], mix.inputs["Fac"])
    nt.links.new(bg_day.outputs[0], mix.inputs[1])
    nt.links.new(bg_night.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return world


def _light(name, kind, coll, energy_expr, color=(1, 1, 1), **kw):
    data = bpy.data.lights.get(name)
    if data:
        bpy.data.lights.remove(data)
    data = bpy.data.lights.new(name, kind)
    data.color = color
    for k, v in kw.items():
        setattr(data, k, v)
    obj = bpy.data.objects.new(name, data)
    coll.objects.link(obj)
    C.drive(data, "energy", energy_expr)
    return obj


def _render_settings():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    cyc = scene.cycles
    cyc.samples = 256
    cyc.use_denoising = True
    cyc.preview_samples = 32
    cyc.max_bounces = 8
    cyc.light_sampling_threshold = 0.01
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        cyc.device = "GPU"
    except Exception:  # no Metal/GPU: CPU is fine, just slower
        cyc.device = "CPU"
    scene.render.resolution_x, scene.render.resolution_y = 2560, 1440
    scene.render.film_transparent = False
    # exposure lift at night so floodlit pitch reads like broadcast footage
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    fc = C.drive(scene, "view_settings.exposure", "0.25 + 0.5 * n + e")
    # per-camera offset: cameras carry an "exposure" property (aerials darker, bowl brighter)
    var = fc.driver.variables.new()
    var.name = "e"
    var.type = "SINGLE_PROP"
    var.targets[0].id_type = "SCENE"
    var.targets[0].id = scene
    var.targets[0].data_path = 'camera["exposure"]'
    fc.driver.expression = "0.25 + 0.5 * n + e"


def build(root):
    coll = C.collection("Lighting", root)
    _world()
    sun = _light("Sun", "SUN", coll, "2.8 * (1 - n)", color=(1.0, 0.93, 0.82), angle=math.radians(0.6))
    sun.rotation_euler = _sun_rotation()
    moon = _light("Moon", "SUN", coll, "0.06 * n", color=(0.6, 0.7, 1.0), angle=math.radians(1.0))
    moon.rotation_euler = (math.radians(40), 0, math.radians(30))
    spots = bpy.context.scene.get("_flood_spots", [])
    for i, s in enumerate(spots):
        x, y, z, dx, dy, dz = s
        lamp = _light(f"Flood_{i:02d}", "SPOT", coll, "1500 * n", color=(0.95, 0.97, 1.0),
                      spot_size=math.radians(55), spot_blend=0.5, shadow_soft_size=0.6)
        lamp.location = (x, y, z)
        import mathutils
        lamp.rotation_euler = mathutils.Vector((dx, dy, dz)).to_track_quat("-Z", "Y").to_euler()
    # warm undercroft / podium wash so the base reads at night
    for i in range(12):
        a = 2 * math.pi * i / 12
        x, y = C.superellipse(P.SHELL_A + 6, P.SHELL_B + 6, P.SHELL_N, a)
        lamp = _light(f"Podium_{i:02d}", "POINT", coll, "60 * n", color=(1.0, 0.75, 0.5),
                      shadow_soft_size=4.0)
        lamp.location = (x, y, P.PODIUM_Z - 2.5)
    _haze(coll)
    _render_settings()
    set_night(False)
    return {"spots": len(spots)}


def set_night(on=True):
    scene = bpy.context.scene
    scene[P.NIGHT_PROP] = 1.0 if on else 0.0
    scene.update_tag()
    for area in bpy.context.screen.areas if bpy.context.screen else []:
        area.tag_redraw()


def _haze(coll):
    """Night only: light haze over the bowl, lit from below, gives the glowing
    plume above the oculus seen in the key visuals."""
    import bmesh
    from mathutils import Matrix
    name = "Haze_Volume"
    me = bpy.data.meshes.get(name)
    if me:
        bpy.data.meshes.remove(me)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=P.OCULUS_A * 0.95,
                          radius2=P.OCULUS_A * 1.5, depth=90,
                          # starts above the rim: the bowl itself stays clear for seat views
                          matrix=Matrix.Translation((0, 0, P.SHELL_Z_TOP - 2 + 45)) @ Matrix.Diagonal((1, P.OCULUS_B / P.OCULUS_A, 1, 1)))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    mat = bpy.data.materials.get("M_Haze") or bpy.data.materials.new("M_Haze")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (1.0, 0.95, 0.88, 1)
    vol.inputs["Anisotropy"].default_value = 0.35
    # density fades with height and follows the night switch
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    fall = C.math_node(nt, "SUBTRACT", 1.0, C.math_node(nt, "DIVIDE", sep.outputs["Z"], 130.0), clamp=True)
    # soft radial edge so the plume has no visible cylinder wall
    rx = C.math_node(nt, "DIVIDE", sep.outputs["X"], P.OCULUS_A * 1.4)
    ry = C.math_node(nt, "DIVIDE", sep.outputs["Y"], P.OCULUS_B * 1.4)
    r2 = C.math_node(nt, "ADD", C.math_node(nt, "MULTIPLY", rx, rx), C.math_node(nt, "MULTIPLY", ry, ry))
    edge = C.math_node(nt, "SUBTRACT", 1.0, r2, clamp=True)
    fall = C.math_node(nt, "MULTIPLY", C.math_node(nt, "MULTIPLY", fall, fall), edge)
    dens = C.math_node(nt, "MULTIPLY", C.math_node(nt, "MULTIPLY", fall, 0.0055), C.night_node(nt))
    nt.links.new(dens, vol.inputs["Density"])
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    obj.visible_shadow = False
    # up-lights on the compression ring light the plume
    for i in range(8):
        a = 2 * math.pi * i / 8
        x, y = C.superellipse(P.OCULUS_A - 4, P.OCULUS_B - 4, P.OCULUS_N, a)
        lamp = _light(f"Plume_{i}", "AREA", coll, "45000 * n", color=(1.0, 0.93, 0.82),
                      size=18.0)
        lamp.location = (x, y, P.SHELL_Z_TOP - 6)
        lamp.rotation_euler = (math.pi, 0, 0)   # emit upward
