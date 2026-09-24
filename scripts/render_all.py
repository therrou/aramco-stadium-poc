"""Headless HD renders of every hero + sample seat camera, day and night.

    /Applications/Blender.app/Contents/MacOS/Blender -b blender/aramco_stadium.blend \
        --python scripts/render_all.py -- [--res 2560x1440] [--samples 256] [--only CAM_Bowl]
"""
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {args[i].lstrip("-"): args[i + 1] for i in range(0, len(args) - 1, 2)}
res = tuple(int(v) for v in opt.get("res", "2560x1440").split("x"))
samples = int(opt.get("samples", 256))
only = opt.get("only")

repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(repo, "renders")
os.makedirs(out, exist_ok=True)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except Exception:
    scene.cycles.device = "CPU"
scene.render.resolution_x, scene.render.resolution_y = res
scene.render.resolution_percentage = 100
scene.cycles.samples = samples
scene.cycles.use_denoising = True

cams = sorted(o.name for o in scene.objects if o.type == "CAMERA")
if only:
    cams = [c for c in cams if c in only.split(",")]
for cam in cams:
    for night in (0.0, 1.0):
        scene["night"] = night
        scene.camera = bpy.data.objects[cam]
        name = f"{cam.replace('CAM_', '').lower()}_{'night' if night else 'day'}.png"
        scene.render.filepath = os.path.join(out, name)
        bpy.ops.render.render(write_still=True)
        print("rendered", name, flush=True)
