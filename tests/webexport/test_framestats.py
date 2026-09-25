import numpy as np
from webexport.framestats import image_stats, CLIP


def test_matches_the_ts_definition():
    rgb = np.array([[[255, 255, 255], [0, 0, 0]], [[255, 0, 0], [CLIP, 0, 0]]], dtype=np.uint8)
    s = image_stats(rgb)
    assert abs(s["mean"] - (255 + 0.2126 * 255 + 0.2126 * CLIP) / 4) < 1e-9
    assert s["clipped"] == 0.75
    top_left = image_stats(rgb, (0, 0, 0.5, 0.5))
    assert abs(top_left["mean"] - 255) < 1e-9 and top_left["clipped"] == 1.0



def _frame(seed=1, shape=(200, 240)):
    rng = np.random.default_rng(seed)
    a = (rng.random((*shape, 3)) * 120).astype(np.uint8)
    a[90:94, 60:160] = 255                # a bright rim
    return a


def test_popping_counts_bright_pixels_present_in_only_one_frame():
    from webexport.framestats import popping
    a = _frame()
    b = a.copy()
    a[140, 120] = 255                     # halo only in a
    assert abs(popping(a, b) - 1 / 401) < 1e-9
    assert popping(a, a) == 0.0
    assert popping(np.zeros_like(a), np.zeros_like(a)) == 0.0


def test_popping_tolerates_a_pixel_or_two_of_residual_shift():
    from webexport.framestats import popping
    a = _frame()
    a[140, 120] = 255
    b = a.copy()
    b[140, 120] = 0
    b[141, 122] = 255                     # same light, 2 px off on its own
    assert popping(a, b) == 0.0


def test_popping_aligns_frames_before_comparing():
    from webexport.framestats import popping
    a = _frame()
    a[140, 120] = 255                     # an LED hit only in a
    b = np.roll(a, 12, axis=1)            # the nudge's parallax
    b[140, 132] = 0
    assert abs(popping(a, b) - 1 / 401) < 1e-9
