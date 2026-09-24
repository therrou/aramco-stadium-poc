"""RGBM: HDR lightmaps in 8-bit RGBA (linear, not sRGB). rgb = c.rgb * c.a * RANGE."""
import numpy as np

RANGE = 16.0                     # R10: 8 clipped ~10 % of the sails' texels


def encode(rgb):
    rgb = np.clip(np.asarray(rgb, np.float32) / RANGE, 0.0, 1.0)
    m = np.clip(rgb.max(-1, keepdims=True), 1e-6, 1.0)
    m = np.ceil(m * 255.0) / 255.0
    c = np.clip(rgb / m, 0.0, 1.0)
    return np.round(np.concatenate([c, m], -1) * 255.0).astype(np.uint8)


def decode(rgba):
    f = np.asarray(rgba, np.float32) / 255.0
    return f[..., :3] * f[..., 3:4] * RANGE
