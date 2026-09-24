# Day / Night toggle for the Aramco Stadium scene.
# Lives in the .blend as a text block (registered on load when auto-run is allowed)
# and in the 3D Viewport sidebar under the "Stadium" tab.
import traceback

import bpy


def set_night(context, value):
    context.scene["night"] = float(value)
    context.scene.update_tag()
    use_scene_lighting(context)


def use_scene_lighting(context):
    """Make every 3D viewport show the scene's own sky and lamps.

    Solid shading and Material Preview's default studio HDRI ignore the scene
    lighting, so the day/night switch looks like it does nothing there."""
    for window in context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != "VIEW_3D":
                continue
            sh = area.spaces.active.shading
            if sh.type in {"SOLID", "WIREFRAME"}:
                sh.type = "MATERIAL"
            sh.use_scene_lights = sh.use_scene_world = True
            sh.use_scene_lights_render = sh.use_scene_world_render = True
            area.tag_redraw()


class STADIUM_OT_day(bpy.types.Operator):
    bl_idname = "stadium.day"
    bl_label = "Day"
    bl_description = "Switch the scene to daylight"

    def execute(self, context):
        set_night(context, 0.0)
        return {"FINISHED"}


class STADIUM_OT_golden(bpy.types.Operator):
    bl_idname = "stadium.golden"
    bl_label = "Golden hour"
    bl_description = "Low warm sun with the stadium lights coming on (Dezeen hero look)"

    def execute(self, context):
        set_night(context, 0.6)
        return {"FINISHED"}


class STADIUM_OT_night(bpy.types.Operator):
    bl_idname = "stadium.night"
    bl_label = "Night"
    bl_description = "Switch the scene to dusk / night lighting"

    def execute(self, context):
        set_night(context, 1.0)
        return {"FINISHED"}


class STADIUM_OT_use_camera(bpy.types.Operator):
    bl_idname = "stadium.use_camera"
    bl_label = "Look through camera"
    name: bpy.props.StringProperty()

    def execute(self, context):
        cam = bpy.data.objects.get(self.name)
        if cam:
            context.scene.camera = cam
            for area in context.screen.areas:
                if area.type == "VIEW_3D":
                    area.spaces.active.region_3d.view_perspective = "CAMERA"
        return {"FINISHED"}


def _icon(name):
    """Icon names change between Blender versions (no LIGHT_MOON in 5.x): fall back to none."""
    items = bpy.types.UILayout.bl_rna.functions["prop"].parameters["icon"].enum_items
    return name if name in items else "NONE"


class STADIUM_PT_panel(bpy.types.Panel):
    bl_label = "Aramco Stadium"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Stadium"

    def draw(self, context):
        layout = self.layout
        try:
            night = context.scene.get("night", 0.0)
            row = layout.row(align=True)
            row.scale_y = 1.4
            row.operator("stadium.day", text="Day", icon=_icon("LIGHT_SUN"), depress=night < 0.3)
            row.operator("stadium.golden", text="Golden", icon=_icon("LIGHT_AREA"),
                         depress=0.3 <= night < 0.8)
            row.operator("stadium.night", text="Night", icon=_icon("LIGHT_POINT"), depress=night >= 0.8)
            if "night" in context.scene:
                layout.prop(context.scene, '["night"]', text="Time of day", slider=True)
            box = layout.box()
            box.label(text="Viewport: Material Preview (fast)", icon=_icon("INFO"))
            box.label(text="or Rendered (Cycles, final)")
            layout.label(text="Cameras:")
            col = layout.column(align=True)
            for obj in sorted((o for o in context.scene.objects if o.type == "CAMERA"),
                              key=lambda o: o.name):
                col.operator("stadium.use_camera", text=obj.name.replace("CAM_", "")).name = obj.name
        except Exception as exc:   # show the problem instead of a half-drawn panel
            layout.label(text=f"Panel error: {exc}", icon="ERROR")
            traceback.print_exc()


CLASSES = (STADIUM_OT_day, STADIUM_OT_golden, STADIUM_OT_night, STADIUM_OT_use_camera, STADIUM_PT_panel)
OLD = ("STADIUM_OT_set_time",)


def register():
    for name in OLD:
        cls = getattr(bpy.types, name, None)
        if cls:
            bpy.utils.unregister_class(cls)
    for c in CLASSES:
        old = getattr(bpy.types, c.__name__, None)
        if old:
            bpy.utils.unregister_class(old)
        bpy.utils.register_class(c)


if __name__ == "__main__":
    register()
