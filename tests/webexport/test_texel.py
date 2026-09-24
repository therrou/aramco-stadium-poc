from webexport import texel


def test_power_of_two_and_clamped():
    assert texel.atlas_size(1.0, 4) == 256
    assert texel.atlas_size(1e9, 4) == 4096
    s = texel.atlas_size(150_000, 4)            # bowl-ish: sqrt(150k/0.72)*4 = 1826
    assert s == 2048 and s & (s - 1) == 0


def test_rounds_to_nearest_power():
    assert texel.atlas_size(10_000, 4) == 512   # 471 -> 512
    assert texel.atlas_size(40_000, 4) == 1024  # 943 -> 1024
