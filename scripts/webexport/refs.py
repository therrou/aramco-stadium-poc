"""Reference stills for the visual check: 3 framings x 3 states at 1920x1080."""
import os

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CAMS = ("CAM_Aerial_Dusk", "CAM_Approach", "CAM_Seat_212")
STATES = {"day": 0.0, "golden": 0.6, "night": 1.0}


def render_one(cam, state, samples=128, width=1920, height=1080):
    sc = bpy.data.scenes["Scene"]
    prev = (sc.camera, sc.get("night", 0.0), sc.render.filepath, sc.cycles.samples,
            sc.render.resolution_x, sc.render.resolution_y)
    sc.camera = bpy.data.objects[cam]
    sc["night"] = STATES[state]
    sc.update_tag()
    sc.render.resolution_x, sc.render.resolution_y = width, height
    sc.cycles.samples = samples
    path = os.path.join(REPO, "renders", "ref_web", f"{cam}_{state}.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.filepath = path
    try:
        bpy.ops.render.render(write_still=True)
    finally:   # leave the render scene exactly as it was
        (sc.camera, sc["night"], sc.render.filepath, sc.cycles.samples,
         sc.render.resolution_x, sc.render.resolution_y) = prev
    return path
