"""Web export, run inside the open Blender session (never headless on this machine):

    import sys; sys.path.insert(0, "/Users/Tomas.Herrou/aramco-stadium-3d/scripts")
    import export_web, importlib; importlib.reload(export_web)
    export_web.run(stages=("data",))

Reads the render scene "Scene" and never modifies or saves it.
"""
import importlib
import json
import math
import os
import shutil

import bpy
import mathutils

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data")
RAW = os.path.join(REPO, "build", "web_raw")
SOURCE_SCENE = "Scene"


def _reload():
    import webexport
    for name in ("seatbin", "texel", "rgbm", "budget", "groups", "manifest", "hemioct",
                 "matinfo", "webscene", "gltfout", "uvpack", "bake", "trees"):
        try:
            importlib.reload(importlib.import_module(f"webexport.{name}"))
        except ModuleNotFoundError:
            pass
    return webexport


def _cameras():
    out = {}
    for obj in bpy.data.scenes[SOURCE_SCENE].objects:
        if obj.type != "CAMERA":
            continue
        m = obj.matrix_world
        fwd = (m.to_3x3() @ mathutils.Vector((0, 0, -1))).normalized()
        eye = m.translation
        out[obj.name] = {"eye": [round(v, 4) for v in eye],
                         "target": [round(v, 4) for v in eye + fwd * 100.0],
                         "hfov": round(math.degrees(obj.data.angle), 4),
                         "exposure": float(obj.get("exposure", 0.0))}
    return out


def stage_data(report):
    from webexport import manifest, seatbin
    os.makedirs(RAW, exist_ok=True)
    rows = seatbin.sort_by_section(seatbin.read_csv(os.path.join(DATA, "seats.csv")))
    blob = seatbin.pack(rows)
    with open(os.path.join(RAW, "seats.bin"), "wb") as f:
        f.write(blob)
    assert len(seatbin.unpack(blob)) == 46074, "seat count"
    with open(os.path.join(DATA, "sections.json")) as f:
        sections = json.load(f)["sections"]
    assert len(sections) == 132, "section count"
    shutil.copy(os.path.join(DATA, "sections.json"), os.path.join(RAW, "sections.json"))
    with open(os.path.join(RAW, "cameras.json"), "w") as f:
        json.dump(_cameras(), f, indent=1)
    manifest.merge(os.path.join(RAW, "manifest.json"), manifest.new())
    report.update(seats=len(rows), sections=len(sections), seats_bin_bytes=len(blob))


def _check_materials(objs):
    missing = [o.name for o in objs if not o.data.materials or o.data.materials[0] is None]
    if missing:
        raise RuntimeError(f"objects without a material: {missing}")


def relink_materials(report=None):
    """Re-attach each WebExport object's '.web' material (fix for the site/site_near split) and
    re-export stadium.glb, keeping the baked LightmapUVs."""
    from webexport import gltfout, webscene
    objs = [o for o in bpy.data.scenes[webscene.WEB].objects if o.get("webexport")]
    fixed = []
    for o in objs:
        m = o.data.materials[0] if o.data.materials else None
        if m is None:
            o.data.materials[0] = bpy.data.materials[o["srcMat"] + ".web"]
            fixed.append(o.name)
    _check_materials(objs)
    gltfout.export_glb(objs, os.path.join(RAW, "stadium.glb"))
    return fixed


def stage_geometry(report, quality):
    from webexport import budget, gltfout, manifest, matinfo, webscene
    objs = webscene.build()
    mats = {}
    for o in objs:
        info = matinfo.classify(bpy.data.materials[o["srcMat"]])
        if info["kind"] == "tiled" and info["tile"]:
            webscene.planar_uv(o, info["tile"])
        # one '.web' material per source material: web_material() replaces an existing one, so a
        # second call for site_near__X deleted the material of site__X (glb: default white material)
        if o["srcMat"] not in mats:
            mats[o["srcMat"]] = gltfout.web_material(info, {})
        o.data.materials[0] = mats[o["srcMat"]]
    _check_materials(objs)
    tris = webscene.triangles(objs)
    path = os.path.join(RAW, "stadium.glb")
    gltfout.export_glb(objs, path)
    report.update(objects=len(objs), static_triangles=tris, ground=dict(webscene.STATS),
                  stadium_glb_mb=round(os.path.getsize(path) / 2**20, 2))
    fails = budget.check({"triangles": tris + budget.TREE_TRI_BUDGET + budget.SEAT_TRI_BUDGET})
    report["budget_failures"] = fails
    manifest.merge(os.path.join(RAW, "manifest.json"), {"stadium": "stadium.glb"})
    assert not fails, fails


def stage_bake(report, quality, only_states=None, only_groups=None, samples=None):
    """UVs once, then (group x state) lightmaps, then env maps; re-exports stadium.glb with UVs.
    `samples` overrides QUALITY[quality]["samples"] (e.g. quality="draft", samples=256 for a
    full-quality bake that reuses the draft UV layout/atlas size; see bake.resolve_samples)."""
    from webexport import bake, gltfout, manifest, rgbm, webscene
    q = bake.QUALITY[quality]
    samples = bake.resolve_samples(quality, samples)
    web = bpy.data.scenes[webscene.WEB]
    objs = [o for o in web.objects if o.get("webexport")]
    by = {}
    for o in objs:
        by.setdefault(o["lightmap"], []).append(o)
    night0 = bpy.data.scenes[SOURCE_SCENE].get("night", 0.0)
    try:
        # UVs persist on the scene: every MCP call is a fresh namespace, and all states must share one UV layout
        if web.get("lm_quality") != quality:
            web["lm_atlas"] = json.dumps(bake.lightmap_uvs(by, q["scale"]))
            web["lm_quality"] = quality
            gltfout.export_glb(objs, os.path.join(RAW, "stadium.glb"))    # now with real LightmapUVs
        report["atlas"] = json.loads(web["lm_atlas"])
        report["uv"] = {g: v for g, v in bake.CHART_STATS.items() if g != "flipped"}
        report["bake_samples"] = samples
        patch = {"states": {}, "rgbmRange": rgbm.RANGE}          # the encoding these PNGs use
        for state, n in manifest.STATES.items():
            if only_states and state not in only_states:
                continue
            lm = {}
            for g, gobjs in by.items():
                if only_groups and g not in only_groups:
                    continue
                p = bake.bake_lightmap(g, gobjs, report["atlas"][g], state, n, samples)
                lm[g] = os.path.relpath(p, RAW)
            env = bake.bake_env(state, n)
            report.setdefault("sun_error_deg", {})[state] = round(bake.sun_check(env, n), 1) if n < 1 else None
            patch["states"][state] = {"lightmaps": lm, "env": os.path.relpath(env, RAW)}
            report.setdefault("clip_pct", {})[state] = dict(bake.CLIP.get(state, {}))
        manifest.merge(os.path.join(RAW, "manifest.json"), patch)
    finally:
        webscene.set_state(night0)                  # the render scene ends as it started


def stage_surfaces(report, quality):
    """Procedural base colour / baked night emission -> UV0 textures on the '.web' materials.
    Runs before "bake": it only writes UV0 ("UVMap"), never the shared LightmapUV."""
    from webexport import bake, gltfout, matinfo, webscene
    q = bake.QUALITY[quality]
    objs = [o for o in bpy.data.scenes[webscene.WEB].objects if o.get("webexport")]
    night0 = bpy.data.scenes[SOURCE_SCENE].get("night", 0.0)
    done = []
    try:
        for o in objs:
            info = matinfo.classify(bpy.data.materials[o["srcMat"]])
            if info["kind"] != "procedural" and not (info["emission"] and info["emission"]["baked"]):
                continue
            baked = bake.bake_surface(o, info, q["scale"], q["samples"])
            o.data.materials[0] = gltfout.web_material(info, baked)
            for other in objs:                      # objects sharing the source material keep it
                if other is not o and other["srcMat"] == o["srcMat"]:
                    other.data.materials[0] = o.data.materials[0]
            done.append((o.name, sorted(k for k in baked if k != "emNight"), baked.get("emNight")))
    finally:
        webscene.set_state(night0)                  # the render scene ends as it started
    gltfout.export_glb(objs, os.path.join(RAW, "stadium.glb"))
    report["surfaces"] = done
    report["surface_uv"] = dict(bake.SURFACE_STATS)


def stage_trees(report, quality):
    from webexport import manifest, trees
    sc, protos = trees.build(report)
    trees.export(sc)
    imp = {}
    for sp, proto in protos.items():
        if sp not in imp:
            imp[sp] = trees.impostor_atlas(sp, proto)
    manifest.merge(os.path.join(RAW, "manifest.json"), {"trees": {"glb": "trees.glb", "impostors": imp}})


STAGES = {"data": stage_data, "geometry": stage_geometry, "surfaces": stage_surfaces, "bake": stage_bake,
          "trees": stage_trees}


def run(stages=("data", "geometry", "surfaces", "bake", "trees"), quality="draft"):
    _reload()
    report = {"quality": quality}
    for s in stages:
        STAGES[s](report) if s == "data" else STAGES[s](report, quality)
    with open(os.path.join(RAW, "report.json"), "w") as f:
        json.dump(report, f, indent=1)
    return report
