import numpy as np
from webexport.framestats import image_stats, CLIP


def test_matches_the_ts_definition():
    rgb = np.array([[[255, 255, 255], [0, 0, 0]], [[255, 0, 0], [CLIP, 0, 0]]], dtype=np.uint8)
    s = image_stats(rgb)
    assert abs(s["mean"] - (255 + 0.2126 * 255 + 0.2126 * CLIP) / 4) < 1e-9
    assert s["clipped"] == 0.75
    top_left = image_stats(rgb, (0, 0, 0.5, 0.5))
    assert abs(top_left["mean"] - 255) < 1e-9 and top_left["clipped"] == 1.0


def test_popping_counts_bright_pixels_present_in_only_one_frame():
    from webexport.framestats import popping
    a = np.zeros((4, 4, 3), np.uint8)
    b = a.copy()
    a[0, 0] = 255              # halo only in a
    a[3, 3] = b[3, 3] = 255    # steady light
    assert popping(a, b) == 0.5
    assert popping(a, a) == 0.0
    assert popping(np.zeros_like(a), np.zeros_like(a)) == 0.0
