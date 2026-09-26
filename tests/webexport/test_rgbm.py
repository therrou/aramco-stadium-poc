import numpy as np

from webexport import rgbm


def test_roundtrip_relative_error():
    v = np.array([0.01, 0.1, 0.5, 1.0, 3.0, 7.9, 15.9], np.float32)
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
    assert rgbm.RANGE == 16.0
    assert abs(back[0, 1, 0] - 16.0) < 0.1


def test_gamma_reencode_roundtrip():
    rgb = np.array([[[0.0, 0.0, 0.0], [0.02, 0.05, 0.1], [1.0, 2.0, 3.0], [12.0, 15.0, 16.0]]], np.float32)
    back = rgbm.gamma_decode(rgbm.rgbm_to_gamma(rgbm.encode(rgb)))
    rel = np.abs(back - rgb) / np.maximum(rgb, 0.05)
    assert rel.max() < 0.05                                    # 8-bit gamma-3 keeps HDR within a few %
    rgba = rgbm.encode(rgb); rgba[0, 0, 3] = 0
    assert rgbm.rgbm_to_gamma(rgba)[0, 0, 3] == 0              # gutters stay alpha 0
