import math

from webexport import hemioct


def test_unit_and_upper_hemisphere():
    for i in range(hemioct.N):
        for j in range(hemioct.N):
            x, y, z = hemioct.cell_dir(i, j)
            assert abs(math.sqrt(x * x + y * y + z * z) - 1) < 1e-9
            assert z >= -1e-9


def test_centre_cell_region_looks_down():
    # the middle of the grid maps to the zenith
    x, y, z = hemioct.cell_dir(hemioct.N // 2, hemioct.N // 2)
    assert z > 0.8
