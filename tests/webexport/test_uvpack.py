import numpy as np
import pytest

from webexport import uvpack


def mesh(verts, faces):
    """Face arrays in the uvpack layout from vertices and polygons (Newell normals)."""
    verts = np.asarray(verts, float)
    n, area, cen, tot, co = [], [], [], [], []
    for f in faces:
        p = verts[list(f)]
        q = np.roll(p, -1, 0)
        nw = np.array([((p[:, 1] - q[:, 1]) * (p[:, 2] + q[:, 2])).sum(),
                       ((p[:, 2] - q[:, 2]) * (p[:, 0] + q[:, 0])).sum(),
                       ((p[:, 0] - q[:, 0]) * (p[:, 1] + q[:, 1])).sum()])
        ln = np.linalg.norm(nw)
        n.append(nw / ln)
        area.append(ln / 2)
        cen.append(p.mean(0))
        tot.append(len(f))
        co.append(p)
    return np.array(n), np.array(area), np.array(cen), np.array(tot), np.concatenate(co)


def join(*ms):
    out = []
    for arrs in zip(*ms):
        out.append(np.concatenate(arrs))
    return tuple(out)


def box(lo, hi):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return mesh(v, f)


def tube(r=0.3, length=10.0, seg=16, rings=10):
    v, f = [], []
    for i in range(rings + 1):
        for j in range(seg):
            a = 2 * np.pi * j / seg
            v.append((length * i / rings, r * np.cos(a), 1.0 + r * np.sin(a)))
    for i in range(rings):
        for j in range(seg):
            a, b = i * seg + j, i * seg + (j + 1) % seg
            f.append((a, b, b + seg, a + seg))
    return mesh(v, f)


def folded_strip(folds=6, width=2.0, step=0.5, gap=0.2):
    """A strip folded back over itself (Z-folds): every layer is stacked over the previous one."""
    v, f = [], []
    for k in range(folds + 1):
        z = k * gap
        v += [(0, 0, z), (0, width, z), (step * 8, width, z), (step * 8, 0, z)]
    for k in range(folds):
        a = 4 * k
        f.append((a, a + 3, a + 2, a + 1) if k % 2 == 0 else (a, a + 1, a + 2, a + 3))
        if k % 2 == 0:                                                # fold edge at x = max
            f.append((a + 3, a + 7, a + 6, a + 2))
        else:                                                         # fold edge at x = 0
            f.append((a, a + 1, a + 5, a + 4))
    return mesh(v, f)


def spiral_ramp(turns=2.0, r0=3.0, r1=6.0, rise=1.0, seg=48):
    """One connected, upward-facing ramp that passes over itself: a height field it is not."""
    v, f = [], []
    steps = int(seg * turns)
    for i in range(steps + 1):
        a = 2 * np.pi * i / seg
        z = rise * i / seg
        v += [(8 + r0 * np.cos(a), 8 + r0 * np.sin(a), z), (8 + r1 * np.cos(a), 8 + r1 * np.sin(a), z)]
    for i in range(steps):
        a = 2 * i
        f.append((a, a + 1, a + 3, a + 2))
    return mesh(v, f)


def truss(members=40, length=12.0, t=0.08):
    """Thin, disconnected parallel and crossing members stacked in one grid cell."""
    parts = []
    for i in range(members):
        z = 0.15 * i
        if i % 2:
            parts.append(box((0, 0, z), (length, t, z + t)))
        else:
            parts.append(box((0, 0, z), (t, length, z + t)))
    return join(*parts)


def check(m, size=256, tpm=4.0, cell=16.0):
    n, area, cen, tot, co = m
    uv, stats = uvpack.chart_uvs(n, area, cen, tot, co, size, tpm, cell)
    assert np.isfinite(uv).all() and uv.min() >= 0.0 and uv.max() <= 1.0
    tri, _ = uvpack.fan(tot)
    over, covered, _ = uvpack.overlap(uv, tri, size)
    assert over == 0 and stats["overlap_texels"] == 0
    assert covered > 0
    return stats


@pytest.mark.parametrize("name,m", [
    ("folded strip", folded_strip()),
    ("tube", tube()),
    ("box", box((0, 0, 0), (3, 2, 1))),
    ("thin truss", truss()),
    ("spiral ramp", spiral_ramp()),
    ("all together", join(folded_strip(), tube(), box((5, 5, 0), (7, 6, 2)), truss())),
])
def test_packs_without_overlap(name, m):
    check(m)


def test_merged_small_charts_would_overlap_without_the_split():
    """The truss's sub-texel members are merged per (cell, axis): the first pack overlaps."""
    stats = check(truss(), size=128)
    assert stats["overlap_rounds"][0] > 0 and stats["overlap_rounds"][-1] == 0


def test_connected_overlapping_chart_is_split_by_depth():
    stats = check(spiral_ramp())
    assert stats["overlap_rounds"][0] > 0 and stats["overlap_rounds"][-1] == 0


def test_rasterize_counts_real_overlap_but_not_shared_edges():
    uv = np.array([[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]])
    shared = np.array([[0, 1, 2], [0, 2, 3]])                          # a quad: one shared diagonal
    assert uvpack.overlap(uv, shared, 64)[0] == 0
    same = np.array([[0, 1, 2], [0, 1, 2]])
    over, covered, bad = uvpack.overlap(uv, same, 64)
    assert over == covered > 0 and set(bad) == {0, 1}


def test_shelf_rects_are_disjoint_and_inside():
    rng = np.random.default_rng(1)
    w, h = rng.uniform(1, 30, 200), rng.uniform(1, 30, 200)
    x, y, used = uvpack.shelf(w, h, 256)
    assert (x >= 0).all() and (x + w <= 256 + 1e-9).all() and used == (y + h).max()
    for i in range(len(w)):
        sep = (x[i] + w[i] <= x + 1e-9) | (x + w <= x[i] + 1e-9) | (y[i] + h[i] <= y + 1e-9) | (y + h <= y[i] + 1e-9)
        sep[i] = True
        assert sep.all()


def test_fan_triangulates_mixed_polygons():
    tri, face = uvpack.fan(np.array([3, 4, 5]))
    assert tri.tolist() == [[0, 1, 2], [3, 4, 5], [3, 5, 6], [7, 8, 9], [7, 9, 10], [7, 10, 11]]
    assert face.tolist() == [0, 1, 1, 2, 2, 2]


def test_ground_down_only_flips_low_downward_faces():
    n = np.array([[0, 0, -1.0], [0, 0, -1.0], [0, 0, 1.0], [1.0, 0, 0]])
    cen = np.array([[0, 0, 0.02], [0, 0, 8.9], [0, 0, 0.0], [0, 0, 0.1]])
    assert list(uvpack.ground_down(n, cen)) == [True, False, False, False]    # a deck underside at 8.9 m stays


def grid_plane(nx, ny, step=4.0, z=0.0):
    v = [(i * step, j * step, z) for j in range(ny + 1) for i in range(nx + 1)]
    f = [(j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i)
         for j in range(ny) for i in range(nx)]
    return mesh(v, f)


def test_flat_cell_makes_one_planar_chart_per_cell():
    n, area, cen, tot, co = grid_plane(32, 8)                          # 128 x 32 m of flat faces
    per_cell, _ = uvpack.charts(n, area, cen, tot, co, cell=16.0)
    flat, _ = uvpack.charts(n, area, cen, tot, co, cell=16.0, flat_cell=64.0)
    assert per_cell.max() + 1 == 8 * 2                                 # 16 m cells
    assert flat.max() + 1 == 2                                         # two 64 m cells
    uv, st = uvpack.chart_uvs(n, area, cen, tot, co, 256, 1.0, 16.0, flat_cell=64.0)
    assert st["overlap_texels"] == 0 and st["charts"] == 2
    assert uv.min() >= 0.0 and uv.max() <= 1.0
    # planar: every chart is an isometric top-down map (uniform scale, no distortion)
    fol = np.repeat(np.arange(len(tot)), tot)
    for c in range(2):
        loops = np.nonzero(flat[fol] == c)[0]
        d_uv = np.linalg.norm(uv[loops] - uv[loops[0]], axis=1)
        d_xy = np.linalg.norm(co[loops, :2] - co[loops[0], :2], axis=1)
        k = d_uv[d_xy > 0] / d_xy[d_xy > 0]
        assert np.allclose(k, k[0], rtol=1e-6)


def test_flat_and_sloped_faces_never_share_a_chart():
    a = grid_plane(4, 4)
    n, area, cen, tot, co = a
    tilt = np.array([[1, 0, 0], [0, 0.6, -0.8], [0, 0.8, 0.6]])        # 53 degree slope, same cell
    b = mesh(np.array([[x, y, z] for x, y, z in co.reshape(-1, 3)[:4]]) @ tilt.T + [0, 0, 5], [(0, 1, 2, 3)])
    n, area, cen, tot, co = join(a, b)
    ch, _ = uvpack.charts(n, area, cen, tot, co, cell=64.0, flat_cell=64.0)
    assert ch[-1] not in set(ch[:-1])


def test_coverage_matches_rasterize():
    uv = np.array([[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]])
    m = uvpack.coverage(uv, np.array([[0, 1, 2]]), 16)
    assert m.shape == (16, 16) and m[2, 2] and not m[15, 15]
    assert m.sum() == len(uvpack.rasterize(uv, np.array([[0, 1, 2]]), 16)[0])


def test_dilate_fills_gutters_from_own_neighbours_only():
    img = np.zeros((8, 8, 3), np.float32)
    mask = np.zeros((8, 8), bool)
    img[:, :3] = 1.0; mask[:, :3] = True                               # chart A (bright), columns 0-2
    img[:, 6:] = 0.1; mask[:, 6:] = True                               # chart B (dark), columns 6-7
    out, m = uvpack.dilate(img, mask, 1)
    assert m[:, 3].all() and m[:, 5].all() and not m[:, 4].any()
    assert np.allclose(out[:, 3], 1.0) and np.allclose(out[:, 5], 0.1)  # each side extends its own chart
    assert np.allclose(out[:, :3], 1.0) and np.allclose(out[:, 6:], 0.1)  # covered texels never change
    out2, m2 = uvpack.dilate(img, mask, 8)
    assert m2.all()
