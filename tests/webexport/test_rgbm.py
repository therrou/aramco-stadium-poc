import numpy as np

from webexport import rgbm


def test_roundtrip_relative_error():
    v = np.array([0.01, 0.1, 0.5, 1.0, 3.0, 7.9], np.float32)
    img = np.stack([v, v * 0.5, v * 0.25], -1)[None]         # 1 x 6 x 3
    back = rgbm.decode(rgbm.encode(img))
    rel = np.abs(back - img) / np.maximum(img, 1e-3)
    assert rel[..., 0].max() < 0.02


def test_black_and_clamp():
    img = np.array([[[0, 0, 0], [100, 100, 100]]], np.float32)
    enc = rgbm.encode(img)
    assert enc.dtype == np.uint8 and enc.shape == (1, 2, 4)
    back = rgbm.decode(enc)
    assert back[0, 0].max() < 1e-3
    assert abs(back[0, 1, 0] - rgbm.RANGE) < 0.05
