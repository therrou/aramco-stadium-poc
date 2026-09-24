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
