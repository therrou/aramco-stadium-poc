"""LED content for the bowl: pitch-side advertising boards, tier-front ribbons and
the big screens (refs/v4/coliseum_interior.jpg). Images are generated here
(brand-neutral panels, a broadcast frame) and packed into the .blend.
"""
import math

import bpy
import numpy as np

from . import common as C

BOARD_PANEL_M = 40.0     # one board image repeat along the touchline (4 panels of 10 m)
RIBBON_PANEL_M = 48.0    # one ribbon image repeat along the tier front

GREEN = (0.0, 0.34, 0.15)
DEEP = (0.0, 0.18, 0.1)
BLUE = (0.0, 0.33, 0.62)
WHITE = (0.95, 0.97, 0.96)
NAVY = (0.02, 0.05, 0.12)


def _canvas(w, h, col):
    img = np.zeros((h, w, 4), np.float32)
    img[..., :3] = col
    img[..., 3] = 1
    return img


def _rect(img, x0, y0, x1, y1, col):
    """Fill [x0, x1) x [y0, y1) in fractions of the image (y up)."""
    h, w = img.shape[:2]
    img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w), :3] = col


def _disc(img, cx, cy, r, col):
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    m = (xx - cx * w) ** 2 + (yy - cy * h) ** 2 < (r * h) ** 2
    img[m, :3] = col


def _wordmark(img, x0, x1, col, y0=0.3, y1=0.7):
    """A row of letter-like blocks: reads as a sponsor name at stadium distance."""
    rng = np.random.default_rng(int(x0 * 1000))
    x = x0
    while x < x1:
        lw = rng.uniform(0.35, 0.9) * (y1 - y0) * img.shape[0] / img.shape[1]
        top = y1 if rng.random() > 0.25 else y1 - (y1 - y0) * 0.25
        _rect(img, x, y0, min(x + lw, x1), top, col)
        x += lw * 1.35


def _board_image():
    """4 panels x 10 m, 1 m tall (1024 px per panel, 96 px tall)."""
    img = _canvas(4096, 96, DEEP)
    # 1: green, white wordmark + emblem
    _rect(img, 0.0, 0, 0.25, 1, GREEN)
    _disc(img, 0.035 * 4 / 4, 0.5, 0.32, WHITE)
    _wordmark(img, 0.06, 0.22, WHITE)
    # 2: white, green wordmark, blue underline
    _rect(img, 0.25, 0, 0.5, 1, WHITE)
    _wordmark(img, 0.29, 0.46, GREEN, 0.35, 0.75)
    _rect(img, 0.29, 0.18, 0.46, 0.26, BLUE)
    # 3: blue, white wordmark
    _rect(img, 0.5, 0, 0.75, 1, BLUE)
    _wordmark(img, 0.53, 0.72, WHITE)
    # 4: deep green with chevrons + short wordmark
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w // 4]
    chev = ((xx + np.abs(yy - h / 2) * 1.2) // 40) % 2 == 0
    seg = img[:, 3 * w // 4:, :3]
    seg[chev & (xx < w // 8)] = GREEN
    _wordmark(img, 0.885, 0.98, WHITE)
    return img


def _ribbon_image():
    """Tier-front ribbon: green field, white wordmarks every 12 m, thin edge lines."""
    img = _canvas(4096, 64, GREEN)
    _rect(img, 0, 0, 1, 0.1, DEEP)
    _rect(img, 0, 0.9, 1, 1, DEEP)
    for k in range(4):
        x = k / 4
        _wordmark(img, x + 0.04, x + 0.19, WHITE, 0.25, 0.75)
    return img


def _broadcast_image():
    """Big-screen frame: live match on the right, scoreboard panel on the left."""
    w, h = 1024, 420
    img = _canvas(w, h, NAVY)
    # pitch in perspective: stripes that converge upward
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    x0 = w * 0.3
    u = (xx - x0) / (w - x0)
    v = yy / h
    persp = (u - 0.5) / (0.55 + 0.45 * (1 - v)) + 0.5
    field = xx > x0
    stripe = (np.floor(persp * 9) % 2 == 0)
    g = np.where(stripe, 0.36, 0.28)
    img[field, 0] = 0.05
    img[field, 1] = g[field]
    img[field, 2] = 0.07
    line = field & (np.abs(persp - 0.5) < 0.004)
    img[line, :3] = WHITE
    img[field & (np.abs(v - 0.62) < 0.006), :3] = WHITE
    rng = np.random.default_rng(4)
    for k in range(14):
        cx, cy = rng.uniform(0.36, 0.97), rng.uniform(0.15, 0.85)
        col = (0.85, 0.08, 0.06) if k % 2 else WHITE
        _rect(img, cx, cy, cx + 0.008, cy + 0.07, col)
        _disc(img, cx + 0.004, cy + 0.085, 0.016, (0.8, 0.62, 0.48))
    # scoreboard panel
    _rect(img, 0.02, 0.08, 0.28, 0.92, (0.03, 0.09, 0.2))
    _rect(img, 0.02, 0.8, 0.28, 0.92, GREEN)
    _wordmark(img, 0.04, 0.2, WHITE, 0.83, 0.89)
    for k, y in enumerate((0.55, 0.3)):
        _wordmark(img, 0.04, 0.17, WHITE, y, y + 0.12)
        _rect(img, 0.21, y - 0.02, 0.26, y + 0.16, WHITE if k == 0 else GREEN)
    return img


def _image(name, pixels):
    img = bpy.data.images.get(name)
    h, w = pixels.shape[:2]
    if img is not None and (img.size[0], img.size[1]) != (w, h):
        bpy.data.images.remove(img)
        img = None
    if img is None:
        img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels.foreach_set(pixels.ravel())
    img.pack()
    return img


def _emissive(name, image, vector_socket_fn, day, night):
    """LED surface: dark glossy base, image drives emission; strength day..night."""
    # rebuilt in place: meshes already using `name` keep their slots
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    b.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1)
    b.inputs["Roughness"].default_value = 0.25
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Linear"
    vec = vector_socket_fn(nt)
    if vec is not None:
        nt.links.new(vec, tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
    s = C.math_node(nt, "ADD", C.math_node(nt, "MULTIPLY", C.night_node(nt), night - day), day)
    nt.links.new(s, b.inputs["Emission Strength"])
    mat.diffuse_color = (0.0, 0.4, 0.2, 1)
    return mat


def board_material():
    img = _image("IMG_AdBoards", _board_image())
    return _emissive("M_LEDBoard", img, lambda nt: None, 1.6, 2.6)


def screen_material():
    img = _image("IMG_Broadcast", _broadcast_image())
    return _emissive("M_Screen", img, lambda nt: None, 4.0, 5.0)


def ribbon_material():
    """Tier-front ribbon, UV-mapped by ribbon() (u along the tier, v up)."""
    img = _image("IMG_Ribbon", _ribbon_image())
    return _emissive("M_FasciaLED", img, lambda nt: None, 0.7, 1.2)


def ribbon(coll, pts, nrm, d, z0, z1, name, mat):
    """LED band swept around a plan loop at offset d, facing the pitch. UV u runs
    a whole number of image repeats around the loop (no seam), mirrored so the
    wordmarks read left-to-right from the pitch."""
    ring = [(x + nx * d, y + ny * d) for (x, y), (nx, ny) in zip(pts, nrm)]
    n = len(ring)
    cum = [0.0]
    for i in range(1, n + 1):
        cum.append(cum[-1] + math.dist(ring[i - 1], ring[i % n]))
    reps = max(1, round(cum[-1] / RIBBON_PANEL_M))
    verts, faces, uvs = [], [], []
    for x, y in ring:
        verts += [(x, y, z0), (x, y, z1)]
    for i in range(n):
        a, b = 2 * i, 2 * ((i + 1) % n)
        faces.append((a, a + 1, b + 1, b))          # normal toward the pitch
        u0, u1 = -cum[i] / cum[-1] * reps, -cum[i + 1] / cum[-1] * reps
        uvs += [(u0, 0), (u0, 1), (u1, 1), (u1, 0)]
    return C.mesh_object(name, verts, faces, coll, [mat], uvs=uvs)
