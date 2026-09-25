"""Spec v3 D4: denoise the existing lightmap bakes with OIDN (Blender's compositor), no re-render.

The 256 spp bakes carry 2-6 % per-texel noise, which showed as blotches on the pitch, the stairs and the
site. Each RGBM PNG in build/web_raw/lightmaps/<state>/ is decoded to float irradiance, its gutters
(alpha 0) are dilated from the charts so the denoiser and the bicubic sampling see no black borders,
denoised by the compositor's Denoise node (HDR, accurate prefilter), and re-encoded to RGBM.

Run inside the open Blender session (never headless), via the MCP:

    import sys; sys.path.insert(0, "<repo>/scripts")
    from webexport import denoise_lm; denoise_lm.run("<repo>/build/web_raw", rgbm_range=16)

It reads the original bakes from build/web_raw/lightmaps_noisy/ (a copy of lightmaps/ made before the first
run) and writes lightmaps/, so it can be rerun and the originals are never overwritten.
"""
import os

import numpy as np


def rgbm_decode(px, rng):
    """RGBA (0..1) -> linear RGB, as stadium.ts rgbmDecode."""
    return px[..., :3] * px[..., 3:4] * rng


def rgbm_encode(rgb, rng):
    """Linear RGB -> RGBA (0..1) with alpha quantised to 8 bits (ceil), so rgb / (a * rng) stays <= 1."""
    m = np.clip(rgb.max(axis=-1, keepdims=True) / rng, 0.0, 1.0)
    a = np.ceil(m * 255.0) / 255.0
    safe = np.where(a > 0, a, 1.0)
    out_rgb = np.where(a > 0, np.clip(rgb / (safe * rng), 0.0, 1.0), 0.0)
    return np.concatenate([out_rgb, a], axis=-1)


def dilate(rgb, valid, passes=8):
    """Fills invalid texels with the mean of their valid 8-neighbours, `passes` rings outward."""
    rgb, valid = rgb.copy(), valid.copy()
    for _ in range(passes):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(valid.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                v = np.roll(np.roll(valid, dy, 0), dx, 1)
                acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * v[..., None]
                cnt += v
        grow = ~valid & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        valid = valid | grow
    return rgb


def _denoise_float(rgb):  # pragma: no cover - runs in Blender
    """OIDN through a temporary compositor scene; returns the denoised float RGB."""
    import bpy
    h, w = rgb.shape[:2]
    src = bpy.data.images.new("_dn_in", w, h, float_buffer=True, alpha=False)
    src.colorspace_settings.name = "Non-Color"
    src.pixels.foreach_set(np.concatenate([rgb, np.ones((h, w, 1))], axis=-1).astype(np.float32).ravel())
    scene = bpy.data.scenes.new("_Denoise")
    try:
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = w, h, 100
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
        scene.view_settings.exposure, scene.view_settings.gamma = 0.0, 1.0
        cam = bpy.data.objects.new("_dn_cam", bpy.data.cameras.new("_dn_cam"))
        scene.collection.objects.link(cam)
        scene.camera = cam
        ng = bpy.data.node_groups.new("_dn", "CompositorNodeTree")
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        n_img, n_dn, n_out = ng.nodes.new("CompositorNodeImage"), ng.nodes.new("CompositorNodeDenoise"), ng.nodes.new("NodeGroupOutput")
        n_img.image = src
        n_dn.inputs["HDR"].default_value = True
        ng.links.new(n_img.outputs["Image"], n_dn.inputs["Image"])
        ng.links.new(n_dn.outputs["Image"], n_out.inputs[0])
        scene.compositing_node_group = ng
        scene.render.use_compositing = True
        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_depth = "32"
        bpy.ops.render.render(scene=scene.name)
        tmp = os.path.join(bpy.app.tempdir, "_dn_out.exr")
        bpy.data.images["Render Result"].save_render(tmp, scene=scene)
        out = bpy.data.images.load(tmp, check_existing=False)
        out.colorspace_settings.name = "Non-Color"
        px = np.empty(w * h * 4, np.float32)
        out.pixels.foreach_get(px)
        bpy.data.images.remove(out)
        return px.reshape(h, w, 4)[..., :3].astype(np.float64)
    finally:
        for ng_ in [g for g in bpy.data.node_groups if g.name.startswith("_dn")]:
            bpy.data.node_groups.remove(ng_)
        cam_data = scene.camera.data if scene.camera else None
        for o in list(scene.collection.objects):
            bpy.data.objects.remove(o)
        if cam_data:
            bpy.data.cameras.remove(cam_data)
        bpy.data.scenes.remove(scene)
        bpy.data.images.remove(src)


def denoise_png(path, rgbm_range, out_path=None):  # pragma: no cover - runs in Blender
    import bpy
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    px = px.reshape(h, w, 4).astype(np.float64)
    valid = px[..., 3] > 0
    rgb = dilate(rgbm_decode(px, rgbm_range), valid)
    dn = np.maximum(_denoise_float(rgb), 0.0)
    enc = rgbm_encode(dn, rgbm_range)
    res = bpy.data.images.new("_dn_png", w, h, alpha=True)
    res.colorspace_settings.name = "Non-Color"
    res.alpha_mode = "STRAIGHT"
    res.pixels.foreach_set(enc.astype(np.float32).ravel())
    res.filepath_raw = out_path or path
    res.file_format = "PNG"
    res.save()
    bpy.data.images.remove(res)
    before = rgbm_decode(px, rgbm_range)[valid]
    return float(np.abs(dn[valid] - before).mean() / max(before.mean(), 1e-6))


def run(raw, rgbm_range=16, states=("day", "golden", "night"), groups=None):  # pragma: no cover - runs in Blender
    report = {}
    for s in states:
        src, dst = os.path.join(raw, "lightmaps_noisy", s), os.path.join(raw, "lightmaps", s)
        for f in sorted(os.listdir(src)):
            if f.endswith(".png") and (groups is None or f[:-4] in groups):
                report[f"{s}/{f}"] = round(denoise_png(os.path.join(src, f), rgbm_range, os.path.join(dst, f)), 4)
    return report
