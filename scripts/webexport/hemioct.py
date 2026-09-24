"""Hemi-octahedral view directions for tree impostor atlases (Blender Z-up).

Cell (i, j) of an N x N grid -> direction the tree is seen FROM. The web shader
(web/src/trees.ts) encodes a view direction back to a cell with the inverse map.
"""
import math

N = 8


def cell_dir(i, j, n=N):
    u, v = (i + 0.5) / n * 2 - 1, (j + 0.5) / n * 2 - 1
    x, y = (u + v) * 0.5, (u - v) * 0.5
    z = 1.0 - abs(x) - abs(y)
    ln = math.sqrt(x * x + y * y + z * z)
    return x / ln, y / ln, max(z, 0.0) / ln
