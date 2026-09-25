"""Lightmap UV charts and packing (pure numpy, no bpy): host-testable.

Deviation from the brief (smart_project + pack_islands): on Blender 5.2 pack_islands overflowed or
collapsed the 50k+ island packs, and smart-project splits every stepped tier into sub-texel
tread/riser strips and turns treads, slabs and pitch lines into closed rings whose boxes span the
whole bowl (1 % atlas use). Charts are built here instead:

1. faces are cut on a world XY grid and grouped into connected pieces (vertices welded by
   position, across a group's objects) that are height fields along their mean normal;
2. each chart is projected on its plane and all charts are shelf-packed at one texel density;
3. the packed atlas is rasterized (texel centres strictly inside a UV triangle); any chart that
   writes a texel twice (folds, tubes, merged stacks) is split at its median depth along its
   projection normal, and the pack is redone, until nothing overlaps (last resort: one chart per
   face).

Face arrays (one row per polygon, loops of a polygon contiguous and in order):
  n (F,3) unit normals, area (F,), cen (F,3) centres, tot (F,) loops per face, co (L,3) loop positions.
"""
import math

import numpy as np

MARGIN_PX = 4.0          # gutter between charts, in atlas texels (2 px of bake-margin padding per chart side)
SMALL_TEXELS = 16.0      # charts under this many texels are merged per (cell, axis)
OVERLAP_EPS = 1e-3       # texel units: centres this close to an edge are "on" it (float32 UVs)


def components(a, b, cls):
    """Connected components over face pairs (a, b), never joining faces of different `cls`."""
    keep = cls[a] == cls[b]
    a, b = a[keep], b[keep]
    lab = np.arange(len(cls))
    while True:
        m = np.minimum(lab[a], lab[b])
        new = lab.copy()
        np.minimum.at(new, a, m)
        np.minimum.at(new, b, m)
        new = new[new]
        if (new == lab).all():
            return np.unique(lab, return_inverse=True)[1].ravel()
        lab = new


def mean_normal(lab, n, area):
    N = np.zeros((lab.max() + 1, 3))
    np.add.at(N, lab, n * area[:, None])
    ln = np.linalg.norm(N, axis=1)
    N[ln < 1e-9] = (0, 0, 1)
    ln[ln < 1e-9] = 1.0
    return N / ln[:, None]


def face_pairs(co, tot):
    """Pairs of faces sharing a vertex position (1 mm weld) and the face index of every loop."""
    F = len(tot)
    fol = np.repeat(np.arange(F), tot)
    key = np.unique(np.round(co * 1000).astype(np.int64), axis=0, return_inverse=True)[1].ravel()
    order = np.argsort(key, kind="stable")
    ks, fs = key[order], fol[order]
    head = np.r_[True, ks[1:] != ks[:-1]]
    a, b = fs, fs[head][np.cumsum(head) - 1]
    if not (a != b).any():
        return np.zeros(0, int), np.zeros(0, int), fol
    pair = np.unique(np.stack([a[a != b], b[a != b]], 1), axis=0)
    return pair[:, 0], pair[:, 1], fol


FLAT_NZ = 0.9            # faces with normal.z above this are "flat" (planar top-down charts)
GROUND_Z = 0.3           # ground layers (sand -0.05 .. glow strips 0.035): nothing but the ground is below them


def ground_down(n, cen, zmax=GROUND_Z, nz=-FLAT_NZ):
    """Faces of a ground layer whose normal points down into the ground (Task 13b).

    Site roads/parking (M_Asphalt: 371k of 450k m2), road lines, pitch surround and part of the paving
    were modelled face-down. A diffuse bake shades the side the normal points to, so these baked the
    unlit gap above the sand (dark triangles), and their mixed up/down neighbours broke into per-face
    charts. Near the ground nothing legitimately faces down, so these are flipped before charting."""
    return (n[:, 2] < nz) & (cen[:, 2] < zmax)


def charts(n, area, cen, tot, co, cell, min_area=0.0, flat_cell=None):
    """Chart id per face (height-field pieces per grid cell) and the face of every loop.

    flat_cell: grid cell (m) for flat faces (normal.z > FLAT_NZ), which are cut apart from the rest.
    Large flat charts are planar top-down projections: no seams inside a road, lawn or plaza."""
    F = len(n)
    a, b, fol = face_pairs(co, tot)
    flat = n[:, 2] > FLAT_NZ if flat_cell else np.zeros(F, bool)
    size = np.where(flat, flat_cell or cell, cell)[:, None]
    key = np.concatenate([np.floor(cen[:, :2] / size), flat[:, None]], 1)
    cell_id = np.unique(key, axis=0, return_inverse=True)[1].ravel()
    cls = cell_id * 2 + (n[:, 2] < -0.05)
    chart = np.full(F, -1)
    todo = np.ones(F, bool)
    for level in range(4):
        if level == 3:                                                 # leftovers: split by dominant axis
            ax = np.abs(n).argmax(1)
            cls = cls * 6 + ax * 2 + (n[np.arange(F), ax] < 0)
        lab = components(a, b, np.where(todo, cls, -1 - np.arange(F)))
        N = mean_normal(lab, n, area)
        ok = (n * N[lab]).sum(1) > 0.15
        bad = np.zeros(lab.max() + 1, bool)
        np.logical_or.at(bad, lab, ~ok & todo)
        done = todo & (~bad[lab] | (level == 3))
        base = chart.max() + 1
        chart[done] = base + np.unique(lab[done], return_inverse=True)[1].ravel()
        todo &= ~done
        cls = lab * 2 + ok                                             # split bad pieces into fits / rest
        if not todo.any():
            break
    # sub-texel charts cost a full gutter each: merge them per (cell, axis); stacks that overlap
    # are split again by chart_uvs
    small = np.bincount(chart, area)[chart] < min_area
    if small.any():
        ax = np.abs(n).argmax(1)
        key = np.stack([cell_id, ax * 2 + (n[np.arange(F), ax] < 0)], 1)[small]
        chart[small] = chart.max() + 1 + np.unique(key, axis=0, return_inverse=True)[1].ravel()
    return np.unique(chart, return_inverse=True)[1].ravel(), fol


def fan(tot):
    """Loop-index triangles (T,3) of a fan triangulation of every face, and each triangle's face."""
    F = len(tot)
    start = np.r_[0, np.cumsum(tot)[:-1]]
    nt = np.maximum(tot - 2, 0)
    face = np.repeat(np.arange(F), nt)
    k = np.arange(nt.sum()) - np.repeat(np.cumsum(nt) - nt, nt)
    s = start[face]
    return np.stack([s, s + k + 1, s + k + 2], 1), face


def shelf(w, h, S):
    """Shelf-pack rects (sorted by height, desc) into an S-wide strip; returns x, y and the used height."""
    order = np.argsort(-h, kind="stable")
    x, y = np.empty(len(w)), np.empty(len(w))
    cx = cy = sh = 0.0
    for i in order:
        if cx + w[i] > S:
            cx, cy, sh = 0.0, cy + sh, 0.0
        x[i], y[i] = cx, cy
        cx += w[i]
        sh = max(sh, h[i])
    return x, y, cy + sh


def layout(chart, n, area, co, fol, size, texels_per_m, margin=MARGIN_PX):
    """Project each chart on its mean-normal plane, box it tightly and shelf-pack all charts."""
    C = chart.max() + 1
    N = mean_normal(chart, n, area)
    up = np.where(np.abs(N[:, 2:3]) < 0.9, [[0, 0, 1]], [[1, 0, 0]])
    t = np.cross(up, N)
    t /= np.linalg.norm(t, axis=1)[:, None]
    bt = np.cross(N, t)
    cl = chart[fol]
    p = np.stack([(co * t[cl]).sum(1), (co * bt[cl]).sum(1)], 1)     # metres in the chart plane
    cnt = np.maximum(np.bincount(cl, minlength=C), 1).astype(float)
    mean = np.stack([np.bincount(cl, p[:, 0], C), np.bincount(cl, p[:, 1], C)], 1) / cnt[:, None]
    q = p - mean[cl]
    sxx, syy, sxy = (np.bincount(cl, q[:, 0] ** 2, C), np.bincount(cl, q[:, 1] ** 2, C),
                     np.bincount(cl, q[:, 0] * q[:, 1], C))
    ang = 0.5 * np.arctan2(2 * sxy, sxx - syy)[cl]
    qr = np.stack([q[:, 0] * np.cos(ang) + q[:, 1] * np.sin(ang), -q[:, 0] * np.sin(ang) + q[:, 1] * np.cos(ang)], 1)

    def box(v):
        lo = np.full((C, 2), np.inf)
        hi = np.full((C, 2), -np.inf)
        np.minimum.at(lo, cl, v)
        np.maximum.at(hi, cl, v)
        return lo, hi

    (lo0, hi0), (lo1, hi1) = box(q), box(qr)
    pca = np.prod(hi1 - lo1, 1) < np.prod(hi0 - lo0, 1)                # square charts: PCA axis is arbitrary
    q = np.where(pca[cl, None], qr, q)
    lo, hi = np.where(pca[:, None], lo1, lo0), np.where(pca[:, None], hi1, hi0)
    q -= lo[cl]
    ext = hi - lo
    lo_s, hi_s = 1e-4, 64.0                                            # bisect the density scale k
    for _ in range(34):
        k = math.sqrt(lo_s * hi_s)
        w = ext[:, 0] * texels_per_m * k + margin
        h = ext[:, 1] * texels_per_m * k + margin
        if w.max() <= size and shelf(w, h, size)[2] <= size:
            lo_s = k
        else:
            hi_s = k
    k = lo_s
    w = ext[:, 0] * texels_per_m * k + margin
    h = ext[:, 1] * texels_per_m * k + margin
    x, y, used = shelf(w, h, size)
    if w.max() > size or used > size:
        raise RuntimeError(f"{C} charts do not fit a {size} atlas even at density scale {k:.2g}")
    uv = (q * texels_per_m * k + np.stack([x, y], 1)[cl] + margin / 2) / size
    return uv, N, {"charts": int(C), "density_scale": round(k, 3),
                   "fill": round(float((ext[:, 0] * ext[:, 1]).sum() * (texels_per_m * k) ** 2 / size ** 2), 3)}


def rasterize(uv, tri, size, eps=OVERLAP_EPS, chunk=4_000_000):
    """(texel index, triangle index) for every texel centre strictly inside a UV triangle."""
    p = uv[tri] * size                                                 # (T,3,2) texel units
    e1, e2 = p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]
    a2 = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
    keep = np.abs(a2) > 1e-12
    p, tid_all, a2 = p[keep], np.nonzero(keep)[0], a2[keep]
    p = np.where((a2 < 0)[:, None, None], p[:, [0, 2, 1]], p)          # counter-clockwise
    i0 = np.ceil(p[..., 0].min(1) - 0.5).astype(np.int64)
    i1 = np.floor(p[..., 0].max(1) - 0.5).astype(np.int64)
    j0 = np.ceil(p[..., 1].min(1) - 0.5).astype(np.int64)
    j1 = np.floor(p[..., 1].max(1) - 0.5).astype(np.int64)
    nx, ny = np.maximum(i1 - i0 + 1, 0), np.maximum(j1 - j0 + 1, 0)
    cnt = nx * ny
    texels, tris = [], []
    T = len(cnt)
    s = 0
    while s < T:                                                       # chunks bound the candidate count
        c = np.cumsum(cnt[s:])
        e = s + max(1, int(np.searchsorted(c, chunk)))
        idx = np.arange(s, e)
        m = np.repeat(idx, cnt[s:e])
        k = np.arange(len(m)) - np.repeat(np.cumsum(cnt[s:e]) - cnt[s:e], cnt[s:e])
        ix = i0[m] + k % nx[m]
        iy = j0[m] + k // nx[m]
        cx, cy = ix + 0.5, iy + 0.5
        inside = np.ones(len(m), bool)
        for a_, b_ in ((0, 1), (1, 2), (2, 0)):
            pa, pb = p[m, a_], p[m, b_]
            ex, ey = pb[:, 0] - pa[:, 0], pb[:, 1] - pa[:, 1]
            d = (ex * (cy - pa[:, 1]) - ey * (cx - pa[:, 0])) / np.maximum(np.hypot(ex, ey), 1e-12)
            inside &= d > eps
        inside &= (ix >= 0) & (ix < size) & (iy >= 0) & (iy < size)
        texels.append(iy[inside] * size + ix[inside])
        tris.append(tid_all[m[inside]])
        s = e
    return np.concatenate(texels) if texels else np.zeros(0, np.int64), np.concatenate(tris) if tris else np.zeros(0, np.int64)


def overlap(uv, tri, size, eps=OVERLAP_EPS):
    """(texels written by >= 2 triangles, covered texels, triangle indices involved in overlaps)."""
    tex, t = rasterize(uv, tri, size, eps)
    if len(tex) == 0:
        return 0, 0, np.zeros(0, np.int64)
    cnt = np.bincount(tex, minlength=size * size)
    bad = cnt[tex] >= 2
    return int((cnt >= 2).sum()), int((cnt >= 1).sum()), np.unique(t[bad])


def _split_by_depth(chart, bad, cen, N):
    """Split every chart in `bad` at the median depth of its faces along the chart's normal."""
    f = np.nonzero(np.isin(chart, bad))[0]
    d = (cen[f] * N[chart[f]]).sum(1)
    order = np.lexsort((d, chart[f]))
    f, c = f[order], chart[f][order]
    start = np.r_[True, c[1:] != c[:-1]]
    first = np.nonzero(start)[0]
    size = np.diff(np.r_[first, len(c)])
    rank = np.arange(len(c)) - np.repeat(first, size)
    upper = rank >= np.repeat(size, size) // 2
    upper &= np.repeat(size, size) > 1
    new = chart.copy()
    new[f[upper]] = chart.max() + 1 + np.unique(c[upper], return_inverse=True)[1].ravel()
    return np.unique(new, return_inverse=True)[1].ravel()


def chart_uvs(n, area, cen, tot, co, size, texels_per_m, cell, margin=MARGIN_PX,
              small=SMALL_TEXELS, rounds=24, tris=None, check=3, flat_cell=None):
    """Loop UVs (L,2) in [0, 1] for one shared atlas, with no chart self-overlap; and stats.

    tris: (loop triangles (T,3), face of each triangle); defaults to a fan (convex faces only;
    pass the real triangulation for concave n-gons). Each layout is checked on a grid `check` times
    finer than the atlas: the atlas' texel centres are a subset of that grid (check odd), so a
    clean check means a clean atlas, and slivers are caught before a repack moves the grid."""
    chart, fol = charts(n, area, cen, tot, co, cell, small / texels_per_m ** 2, flat_cell)
    tri, tface = tris if tris is not None else fan(tot)
    history = []
    for r in range(rounds + 2):
        uv, N, stats = layout(chart, n, area, co, fol, size, texels_per_m, margin)
        over, _, bad_t = overlap(uv, tri, size * check)
        history.append(over)
        if over == 0:
            break
        bad = np.unique(chart[tface[bad_t]])
        if r < rounds:
            chart = _split_by_depth(chart, bad, cen, N)
        else:                                                          # last resort: one chart per face
            f = np.nonzero(np.isin(chart, bad))[0]
            chart = chart.copy()
            chart[f] = chart.max() + 1 + np.arange(len(f))
            chart = np.unique(chart, return_inverse=True)[1].ravel()
    over, covered, _ = overlap(uv, tri, size)
    stats.update(overlap_texels=over, covered_texels=covered, overlap_rounds=history)
    return uv, stats


def coverage(uv, tri, size):
    """Bool (size, size) mask of texels whose centre lies inside a UV triangle (row = v, column = u)."""
    tex, _ = rasterize(uv, tri, size)
    m = np.zeros(size * size, bool)
    m[tex] = True
    return m.reshape(size, size)


def dilate(img, mask, steps):
    """Fill empty texels from their filled 8-neighbours (mean), `steps` rings out; returns (img, mask).

    Task 13b: Blender applies the bake margin per object, so when several objects share one atlas a
    later object's EXTEND margin overwrote an earlier object's texels within the margin (the dark
    staircase "chips" on the sails: 60 % of skin texels within 8 px of a SailUnder chart were dark,
    4.5 % elsewhere). The bake now runs with margin 0 and the whole atlas is dilated once here."""
    img = np.array(img, np.float32, copy=True)
    m = np.array(mask, bool, copy=True)
    H, W = m.shape
    for _ in range(steps):
        pi = np.pad(img * m[..., None], ((1, 1), (1, 1), (0, 0)))
        pm = np.pad(m, 1).astype(np.float32)
        acc = np.zeros_like(img)
        cnt = np.zeros((H, W), np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy or dx:
                    acc += pi[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
                    cnt += pm[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
        new = ~m & (cnt > 0)
        if not new.any():
            break
        img[new] = acc[new] / cnt[new][:, None]
        m |= new
    return img, m
