"""Trees for the web: near = real low-poly meshes (instanced), far = hemi-octahedral impostors."""
import math
import os

import bpy
import mathutils
import numpy as np

from . import budget, hemioct, webscene

RAW = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "build", "web_raw")
TREES_SCENE, IMP_SCENE = "WebTrees", "WebImpostor"
SPECIES = {"jacaranda_tree_LOD0": "jacaranda_tree", "island_tree_01_LOD0": "island_tree_01",
           "tree_small_02_LOD0": "tree_small_02", "Palm_0": "palm", "Palm_1": "palm"}
MIN_TRIS = 1500
FRAME_PX = 128


def _depsgraph(sc):
    """Evaluated depsgraph of `sc` (a non-window scene's view layer has none, so switch briefly)."""
    prev = bpy.context.window.scene
    bpy.context.window.scene = sc
    try:
        return bpy.context.evaluated_depsgraph_get()
    finally:
        bpy.context.window.scene = prev


def instances():
    """[(proto object, species, matrix_world)] for every tree instance in the render scene."""
    dg = _depsgraph(webscene.src())
    out = []
    for i in dg.object_instances:
        if i.is_instance and i.object.name in SPECIES:
            out.append((i.object.original, SPECIES[i.object.name], i.matrix_world.copy()))
    return out


def _tris(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def _drop_mesh(name):
    me = bpy.data.meshes.get(name)
    if me is not None and me.users == 0:
        bpy.data.meshes.remove(me)                 # else reruns name meshes "*.001"


LEAF_WORDS = ("leaf", "leaves", "frond", "dry")
WOOD_SHARE = 0.3          # of the per-tree target; the rest are leaf cards (2 tris each)
LEAF_SCALE_MAX = 6.0      # kept leaf cards grow to cover for the dropped ones, up to this factor


def lod_mesh(proto, target, species):
    """Finest Poly Haven LOD with <= target tris, else a simplified copy of the proto (see `simplify`)."""
    base = proto.name.replace("_LOD0", "")
    cands = sorted((o for o in bpy.data.objects if o.name.startswith(base + "_LOD") and o.type == "MESH"
                    and not o.name.startswith(base + "_LOD0")),
                   key=lambda o: _tris(o.data))
    for o in reversed(cands):
        if _tris(o.data) <= target:
            return o.data, f"polyhaven:{o.name}"
    return simplify(proto, target, f"TreeLOD_{species}"), "decimated"


def _islands(nv, edges):
    """Connected-component label per vertex (label propagation with pointer jumping)."""
    lab = np.arange(nv)
    while True:
        m = np.minimum(lab[edges[:, 0]], lab[edges[:, 1]])
        new = lab.copy()
        np.minimum.at(new, edges[:, 0], m)
        np.minimum.at(new, edges[:, 1], m)
        new = new[new]
        if np.array_equal(new, lab):
            return lab
        lab = new


def _read(me):
    P, L = len(me.polygons), len(me.loops)
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", co)
    ed = np.empty(len(me.edges) * 2, np.int64); me.edges.foreach_get("vertices", ed)
    st = np.empty(P, np.int64); me.polygons.foreach_get("loop_start", st)
    tot = np.empty(P, np.int64); me.polygons.foreach_get("loop_total", tot)
    mi = np.empty(P, np.int64); me.polygons.foreach_get("material_index", mi)
    lv = np.empty(L, np.int64); me.loops.foreach_get("vertex_index", lv)
    uv = np.zeros(L * 2, np.float32)
    if me.uv_layers.active is not None:
        me.uv_layers.active.data.foreach_get("uv", uv)
    return co.reshape(-1, 3), ed.reshape(-1, 2), st, tot, mi, lv, uv.reshape(-1, 2)


def _build(name, co, tot, lv, uv, mi, materials, uv_names=("UVMap",)):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(co)); me.vertices.foreach_set("co", np.asarray(co, np.float32).ravel())
    me.loops.add(len(lv)); me.loops.foreach_set("vertex_index", np.asarray(lv, np.int32))
    me.polygons.add(len(tot))
    me.polygons.foreach_set("loop_start", np.concatenate(([0], np.cumsum(tot)[:-1])).astype(np.int32))
    me.polygons.foreach_set("material_index", np.asarray(mi, np.int32))
    for n in uv_names:   # materials reference UV maps by name; extra maps get a copy of the active one
        me.uv_layers.new(name=n).data.foreach_set("uv", np.asarray(uv, np.float32).ravel())
    for m in materials:
        me.materials.append(m)
    me.update(calc_edges=True)
    me.validate()
    return me


def _subset(co, st, tot, lv, uv, mi, faces):
    """Faces `faces` of a read mesh -> compact (co, tot, lv, uv, mi)."""
    loops = np.concatenate([np.arange(st[f], st[f] + tot[f]) for f in faces]) if len(faces) else np.zeros(0, np.int64)
    used, inv = np.unique(lv[loops], return_inverse=True)
    return co[used], tot[faces], inv, uv[loops], mi[faces]


def _decimate(me, ratio):
    sc = bpy.data.scenes[TREES_SCENE]
    tmp = bpy.data.objects.new("_dec", me)
    sc.collection.objects.link(tmp)
    prev = bpy.context.window.scene
    bpy.context.window.scene = sc
    try:
        mod = tmp.modifiers.new("dec", "DECIMATE")
        mod.ratio = max(0.0001, min(1.0, ratio))
        dg = bpy.context.evaluated_depsgraph_get()
        return bpy.data.meshes.new_from_object(tmp.evaluated_get(dg), depsgraph=dg)
    finally:
        bpy.context.window.scene = prev
        bpy.data.objects.remove(tmp, do_unlink=True)


def simplify(proto, target, name, seed=7):
    """~target-tri stand-in for a Poly Haven tree whose leaves are thousands of separate islands.

    Plain collapse decimation can't merge disconnected leaves (it stalls at 50-120k tris and eats the
    trunk), so: wood = the largest wood islands, collapse-decimated to WOOD_SHARE of the target;
    leaves = a seeded random subset of leaf islands, each replaced by one best-fit quad (PCA plane,
    UVs from an affine fit to the island's own UVs), scaled up to keep the crown's coverage.
    """
    me = proto.data
    co, ed, st, tot, mi, lv, uv = _read(me)
    face_isl = _islands(len(co), ed)[lv[st]]
    leafmat = np.array([any(w in (m.name.lower() if m else "") for w in LEAF_WORDS) for m in me.materials] or [False])
    is_leaf = leafmat[mi]
    ftris = tot - 2
    act = me.uv_layers.active
    uv_names = [act.name] + [l.name for l in me.uv_layers if l.name != act.name] if act else ["UVMap"]
    # wood: the biggest islands (trunk, main limbs), collapse-decimated. Twig-laden branch islands stall
    # collapse far above budget (thousands of open tube tips), so drop the smallest kept island until it fits.
    parts = []
    wood_budget = int(target * WOOD_SHARE)
    wf = np.nonzero(~is_leaf)[0]
    wood_tris = 0
    if len(wf):
        isl, inv = np.unique(face_isl[wf], return_inverse=True)
        order = np.argsort(-np.bincount(inv, weights=ftris[wf]))
        for k in range(min(len(order), max(1, wood_budget // 60)), 0, -1):
            raw = _build("_wood", *_subset(co, st, tot, lv, uv, mi, wf[np.isin(inv, order[:k])]), me.materials, uv_names)
            wood = _decimate(raw, wood_budget / max(_tris(raw), 1))
            bpy.data.meshes.remove(raw)
            wood_tris = _tris(wood)
            if wood_tris <= 1.2 * wood_budget or k == 1:
                break
            bpy.data.meshes.remove(wood)
        parts.append(_read(wood))
        bpy.data.meshes.remove(wood)
    # leaves: one quad per kept island
    lf = np.nonzero(is_leaf)[0]
    if len(lf):
        isl_all = np.unique(face_isl[lf])
        n_keep = max(1, min(len(isl_all), (target - wood_tris) // 2))
        rng = np.random.default_rng(seed)
        keep = np.sort(rng.choice(isl_all, n_keep, replace=False))
        scale = min(LEAF_SCALE_MAX, math.sqrt(len(isl_all) / n_keep))
        lf = lf[np.isin(face_isl[lf], keep)]
        lf = lf[np.argsort(face_isl[lf], kind="stable")]
        loops = np.concatenate([np.arange(st[f], st[f] + tot[f]) for f in lf])
        loop_isl = np.repeat(face_isl[lf], tot[lf])
        face_of_loop = np.repeat(np.arange(len(lf)), tot[lf])
        bounds = np.searchsorted(loop_isl, keep)
        qco, quv, qmi = [], [], []
        for a, b in zip(bounds, list(bounds[1:]) + [len(loops)]):
            L = loops[a:b]
            p, t = co[lv[L]].astype(np.float64), uv[L].astype(np.float64)
            c = p.mean(0)
            _, _, vt = np.linalg.svd(p - c, full_matrices=False)
            e1, e2 = vt[0], vt[1]
            x, y = (p - c) @ e1, (p - c) @ e2
            A = np.stack([x, y, np.ones_like(x)], 1)
            fit, *_ = np.linalg.lstsq(A, t, rcond=None)
            corners = [(x.min(), y.min()), (x.max(), y.min()), (x.max(), y.max()), (x.min(), y.max())]
            for cx, cy in corners:
                qco.append(c + scale * (cx * e1 + cy * e2))
                quv.append(np.array([cx, cy, 1.0]) @ fit)
            qmi.append(mi[lf[face_of_loop[a]]])
        nq = len(qmi)
        parts.append((np.array(qco, np.float32), None, None, np.full(nq, 4), np.array(qmi), np.arange(nq * 4),
                      np.array(quv, np.float32)))
    # merge wood + leaf quads
    cos, tots, lvs, uvs, mis, off = [], [], [], [], [], 0
    for pco, _, _, ptot, pmi, plv, puv in parts:
        cos.append(pco); tots.append(ptot); lvs.append(plv + off); uvs.append(puv); mis.append(pmi)
        off += len(pco)
    _drop_mesh(name)
    out = _build(name, np.concatenate(cos), np.concatenate(tots), np.concatenate(lvs), np.concatenate(uvs),
                 np.concatenate(mis), me.materials, uv_names)
    out.shade_smooth()
    return out


def _clear(sc):
    for o in list(sc.collection.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def build(report):
    sc = bpy.data.scenes.get(TREES_SCENE) or bpy.data.scenes.new(TREES_SCENE)
    _clear(sc)
    inst = instances()
    protos = {sp: p for p, sp, _ in inst}
    dist = [(sp, math.hypot(m.translation.x, m.translation.y)) for _, sp, m in inst]
    count_near = lambda r: sum(1 for _, d in dist if d <= r)
    # per-tree target so that ~250 m of trees fits the budget, but never below MIN_TRIS
    target = max(MIN_TRIS, budget.TREE_TRI_BUDGET // max(count_near(250.0), 1))
    lods = {sp: lod_mesh(p, target, sp) for sp, p in protos.items()}
    meshes = {sp: me for sp, (me, _) in lods.items()}
    tris = {sp: _tris(me) for sp, me in meshes.items()}
    r = budget.near_radius(dist, tris, budget.TREE_TRI_BUDGET)
    quads = {}
    for sp in protos:     # one quad mesh + material per species, so `gltf-transform instance` batches per species
        _drop_mesh(f"ImpostorQuad_{sp}")
        q = bpy.data.meshes.new(f"ImpostorQuad_{sp}")
        q.from_pydata([(-0.5, 0, 0), (0.5, 0, 0), (0.5, 0, 1), (-0.5, 0, 1)], [], [(0, 1, 2, 3)])
        mat = bpy.data.materials.get(f"Impostor_{sp}") or bpy.data.materials.new(f"Impostor_{sp}")
        mat["impostor"] = sp   # glTF extras: keeps `gltf-transform dedup` from merging the identical materials
        q.materials.append(mat)
        quads[sp] = q
    near = far = near_tris = 0
    for (proto, sp, m), (_, d) in zip(inst, dist):
        if d <= r:
            o = bpy.data.objects.new(f"Tree_{sp}", meshes[sp])
            near += 1
            near_tris += tris[sp]
        else:
            o = bpy.data.objects.new(f"Impostor_{sp}", quads[sp])
            far += 1
        o.matrix_world = m
        sc.collection.objects.link(o)
    report["trees"] = {"near_radius": round(r, 1), "near": near, "far": far, "near_tris": near_tris,
                       "per_tree_tris": tris, "lod_source": {sp: src for sp, (_, src) in lods.items()},
                       "target_tris": target}
    return sc, protos


def export(sc):
    prev = bpy.context.window.scene
    bpy.context.window.scene = sc
    try:
        bpy.ops.export_scene.gltf(filepath=os.path.join(RAW, "trees.glb"), export_format="GLB",
                                  use_selection=False, use_active_scene=True, export_extras=True,
                                  export_yup=True, export_apply=True,
                                  export_materials="EXPORT", export_image_format="AUTO",
                                  export_cameras=False, export_lights=False, export_animations=False)
    finally:
        bpy.context.window.scene = prev


def impostor_atlas(species, proto):
    """Render N x N hemi-oct frames of `proto` (flat white world, Standard view) into one atlas."""
    sc = bpy.data.scenes.get(IMP_SCENE) or bpy.data.scenes.new(IMP_SCENE)
    _clear(sc)
    w = bpy.data.worlds.get("_ImpWorld") or bpy.data.worlds.new("_ImpWorld")
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = 1.0
    sc.world = w
    sc.render.engine = "CYCLES"
    sc.cycles.device = webscene.src().cycles.device
    sc.cycles.samples = 16
    sc.render.use_persistent_data = True           # static tree, only the camera moves: keep the BVH
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.render.resolution_x = sc.render.resolution_y = FRAME_PX
    sc.render.resolution_percentage = 100
    tree = bpy.data.objects.new("_ImpTree", proto.data)
    sc.collection.objects.link(tree)
    bb = [tree.matrix_world @ mathutils.Vector(c) for c in proto.bound_box]
    size = max(max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb),
               max(v.z for v in bb) - min(v.z for v in bb))
    cz = 0.5 * (max(v.z for v in bb) + min(v.z for v in bb))
    cam_data = bpy.data.cameras.get("_ImpCam") or bpy.data.cameras.new("_ImpCam")
    cam = bpy.data.objects.new("_ImpCam", cam_data)
    cam.data.type, cam.data.ortho_scale = "ORTHO", size * 1.05
    cam.data.clip_end = size * 10
    sc.collection.objects.link(cam)
    sc.camera = cam
    n = hemioct.N
    atlas = np.zeros((n * FRAME_PX, n * FRAME_PX, 4), np.float32)
    tmp = os.path.join(RAW, "impostors", "_frame.png")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    prev = bpy.context.window.scene
    bpy.context.window.scene = sc
    try:
        Vector = mathutils.Vector
        for i in range(n):
            for j in range(n):
                d = Vector(hemioct.cell_dir(i, j))
                cam.location = Vector((0, 0, cz)) + d * size * 3
                # camera local Y -> world up, so every frame is upright (no cell is exactly vertical:
                # max d.z ~ 0.99). Tracking -Z with up "Z" left the roll arbitrary (upside-down edge frames).
                cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
                sc.render.filepath = tmp
                bpy.ops.render.render(write_still=True)
                img = bpy.data.images.load(tmp, check_existing=False)
                px = np.empty(FRAME_PX * FRAME_PX * 4, np.float32)
                img.pixels.foreach_get(px)
                bpy.data.images.remove(img)
                atlas[j * FRAME_PX:(j + 1) * FRAME_PX, i * FRAME_PX:(i + 1) * FRAME_PX] = px.reshape(FRAME_PX, FRAME_PX, 4)
    finally:
        bpy.context.window.scene = prev
        _clear(sc)
    out = bpy.data.images.new(f"_imp_{species}", n * FRAME_PX, n * FRAME_PX, alpha=True)
    out.pixels.foreach_set(atlas.ravel())
    out.filepath_raw = os.path.join(RAW, "impostors", f"{species}.png")
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    os.remove(tmp)
    return {"atlas": f"impostors/{species}.png", "frames": n, "size": size * 1.05, "centerZ": cz}
