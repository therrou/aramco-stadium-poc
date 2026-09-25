import numpy as np
from webexport.denoise_lm import rgbm_decode, rgbm_encode, dilate


def test_rgbm_round_trip_within_8bit_precision():
    rng = 16.0
    rgb = np.array([[[0.0, 0.0, 0.0], [0.5, 1.0, 2.0]], [[15.9, 3.0, 0.1], [0.02, 0.02, 0.02]]])
    back = rgbm_decode(rgbm_encode(rgb, rng), rng)
    assert np.allclose(back, rgb, rtol=0.02, atol=0.002)


def test_dilate_fills_gutters_from_valid_neighbours_and_keeps_valid_texels():
    rgb = np.zeros((5, 5, 3))
    valid = np.zeros((5, 5), bool)
    rgb[2, 2] = [1, 2, 3]
    valid[2, 2] = True
    out = dilate(rgb, valid, passes=2)
    assert np.allclose(out[2, 2], [1, 2, 3])
    assert np.allclose(out[0, 0], [1, 2, 3])        # two passes reach the corner (8-neighbourhood)
    assert np.allclose(out[2, 4], [1, 2, 3])
