# Aramco Stadium Web Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A desktop-browser PoC that renders the Blender stadium close to the Cycles stills, with a Day / Golden / Night toggle and a camera that zooms to a clicked section (area), with 46,074 seats coloured by mock availability.

**Architecture:** A Blender-side exporter (`scripts/export_web.py` + `scripts/webexport/`) reads the open scene without modifying it. It builds a temporary `WebExport` scene of merged copies, bakes lightmaps, albedo and environment maps for the three lighting states, and writes raw assets plus a `manifest.json` to `build/web_raw/`. `scripts/optimize_web.sh` compresses them into `web/public/assets/` (meshopt, KTX2). A Vite + TypeScript + Three.js app in `web/` loads the manifest and patches the stock `MeshStandardMaterial` to blend two RGBM lightmaps and two PMREM environments. Seats are drawn as one `InstancedMesh` plus a section-patch mesh that also serves for picking.

**Tech Stack:** Blender 5.2 (Cycles, Metal GPU, bundled numpy) driven through the Blender MCP; Python 3.14 + pytest for the bpy-free export code; `@gltf-transform/cli` 4.5 and KTX-Software ≥ 4.3 (`ktx`); Node 23, Vite 8, TypeScript 5, Three.js 0.186, Vitest 5, stats.js.

**Spec:** `docs/superpowers/specs/2026-09-24-web-viewer-design.md`

## Global Constraints

- Browsers: desktop Chrome and Safari, WebGL2. Phones should load; they are not tuned.
- First load ≤ 35 MB compressed, including all three lightmap sets.
- ≥ 50 fps at 1080p on an M1-class laptop.
- ≤ 2M triangles on screen; ≤ 250 draw calls.
- Visual match: the same camera as a Blender render gives the same composition, lighting mood and colours, in all three states. Pixel match is not expected.
- Lighting states: Day `scene["night"] = 0.0`, Golden `0.6`, Night `1.0`.
- Counts: 132 sections, 46,074 seats.
- Fly-to: **section (area) only**, ≈ 1.5 s eased. No seat-level fly-to and no seat selection in this PoC (scope change from the user, 2026-09-24).
- Seat colours: available green, taken grey, club tier cream.
- Mock availability: seeded, ≈ 35 % taken, clustered by section.
- The render scene in `blender/aramco_stadium.blend` is never modified. The exporter works on a temporary scene and never saves the .blend.
- Headless Blender hangs on this machine: run all Blender steps through the MCP `execute_blender_code` tool in the open session. Each call has a fresh namespace. Calls longer than 120 s may report "No data received" while still succeeding, so always verify the output on disk (see memory note `blender-mcp-gotchas`).
- The `WebExport`, `WebTrees`, `WebEnv` and `WebImpostor` scenes exist only in the running Blender session (the .blend is never saved). After a Blender restart, rerun the stages from `geometry` on. Lightmap UVs are kept on the `WebExport` scene (`lm_quality`, `lm_atlas`), so baking one state per MCP call reuses the same UVs.
- Seat/section numbering is invented and stays in `data/`. No real ticketing, no backend.
- Commit after every task. Work on branch `web-viewer`. Do not commit `build/`, `web/public/assets/`, `renders/` or `.venv/`.

## Decisions this plan makes on top of the spec (please confirm at review)

| # | Spec says | Plan does | Why |
|---|---|---|---|
| D1 | seats.bin ≈ 17 B/seat | **19 B/seat** (2+1+2+4+4+4+2) plus a 16-byte header; 46,074 × 19 ≈ 0.88 MB | The spec's per-field sizes add up to 19. The header gives a magic number, version and count check. |
| D2 | Exporter converts Z-up → Y-up | Only the `.glb` files are Y-up (glTF exporter). `seats.bin`, `sections.json` and `cameras.json` stay in Blender Z-up metres; the web converts all three through one function, `toThree([x,y,z]) = [x, z, -y]` | One conversion point, tested once. seats.bin can be checked byte-for-byte against `seats.csv`. |
| D3 | Section fly-to uses `view.eye/target/fov` | Clicking a section **zooms to the area**: `sectionFraming()` puts the camera over the pitch, looking at the section | `view.*` is a view from a seat inside the section. The user scoped the PoC to area zoom |
| D11 | Section → seat pick, seat fly-to, selected colour | **Dropped** (user, 2026-09-24): no seat picking, no seat camera, no "selected" state. Seats are still drawn and coloured when zoomed in | PoC scope |
| D4 | Emission = `emission × uEmission × nightEmission` | Emission strength = `emDay + n × (emNight − emDay)`, from per-material `extras.emDay/emNight` | This is the exact Blender formula (`common.night_emission`). Some materials glow in daylight, e.g. LED boards at 0.3. |
| D5 | LightmapUV per merged object | One lightmap **atlas per group**: `pitch`, `bowl`, `sails`, `structure`, `site` (5 atlases × 3 states) | Avoids about 180 small textures. The sails get their own atlas, as the spec's risk table suggests. |
| D6 | `seat.glb` low-poly ≤ 60 tris | The seat is built in code (`seatGeometry()`, 24 tris). Seats are shown only for sections within `SEAT_LOD_DIST` of the camera, with patches elsewhere | 46,074 × 60 = 2.76M tris would break the 2M budget alone. A test pins the worst case at ≤ 25k visible seats. |
| D7 | Bake procedural emission | The **sail LED points** are recreated in the web shader (world-space hash, same cell size, dot size and height fade). Other procedural emission is baked | The LED dots are about 5 cm across. Baking them would need about 20 texels/m over roughly 60,000 m² of sail. |
| D8 | EXR → KTX2, or RGBM PNG fallback | **RGBM PNG → KTX2 UASTC** for lightmaps. Environment maps stay `.hdr` (RGBE) at 2048×1024 | UASTC is an LDR format, so RGBM is the dependable path. |
| D9 | Near trees within ≈ 250 m | The near radius shrinks until near-tree triangles fit `TREE_TRI_BUDGET` = 450k (computed, ≤ 250 m). Poly Haven LODs are fetched where available, otherwise decimated | There are 1,051 trees within 250 m, and a jacaranda LOD0 has 122k tris. |
| D10 | Env switches with the cross-fade | Diffuse IBL is turned off (the lightmap already contains the sky light). Specular IBL blends two PMREMs by `uEnvBlend` | Otherwise the sky light would be counted twice. |

## Review Focus

1. **Toggling state mid-transition** (Day → Night, then Golden after 0.3 s): no visible jump. A reversal plays back from the current point; a third state is queued and runs right after. Pinned in Task 9 (`lightingState.test.ts`).
2. **Clicking during a flight** (another section, or Back mid-flight): the new flight starts from the current in-between pose, not from the old start or end. Pinned in Task 7 (`camera.test.ts`).
3. **Window aspect changes** (resize, portrait): Blender's `sensor_fit = AUTO` puts the 62° on the *larger* dimension, so the vertical fov must be recomputed on every resize. Pinned in Task 7 (`flyto.test.ts`).
4. **An optional asset is missing or fails** (no lightmaps before the bake, trees.glb 404): the viewer still runs, with fallback lights. A required asset failure shows the file name and retries only what failed. Pinned in Task 5 (`loader.test.ts`).
5. **Clicking empty space, the same section again, or another section while zoomed**: empty space and the same section do nothing; another section flies there from the current pose. Pinned in Task 8 (`state.test.ts`).

---

## File Structure

```
.gitignore                              + .venv/
requirements-dev.txt                    pytest, numpy (host-side tests)
scripts/export_web.py                   Blender entry point: run(stages, quality)
scripts/optimize_web.sh                 gltf-transform + ktx → web/public/assets
scripts/webexport/__init__.py
scripts/webexport/seatbin.py            pure: pack/unpack seats.bin
scripts/webexport/texel.py              pure: atlas size from area and texel density
scripts/webexport/rgbm.py               numpy: RGBM encode/decode
scripts/webexport/budget.py             pure: triangle/size/tree budgets
scripts/webexport/groups.py             pure: object → atlas group, exclusion rules
scripts/webexport/manifest.py           pure: manifest.json build/merge
scripts/webexport/hemioct.py            pure: hemi-octahedral impostor directions
scripts/webexport/matinfo.py            bpy: classify materials (constant/tiled/procedural, emission)
scripts/webexport/webscene.py           bpy: temp WebExport scene, merge, set_state
scripts/webexport/gltfout.py            bpy: web materials, glb export
scripts/webexport/bake.py               bpy: lightmap UVs, lightmap/albedo/emission/env bakes
scripts/webexport/trees.py              bpy: near-tree LOD instances + impostor atlases
scripts/webexport/refs.py               bpy: reference renders for the visual check
tests/webexport/test_*.py               pytest for the pure modules
web/package.json, tsconfig.json, vite.config.ts, index.html
web/scripts/copy-basis.mjs              copies the Basis transcoder to public/basis
web/src/main.ts                         boot: capabilities → load → build scene → loop
web/src/coords.ts                       Blender ↔ Three conversion, equirect mapping
web/src/capabilities.ts                 WebGL2 / WebAssembly check
web/src/loader.ts                       manifest + asset jobs, progress, retry
web/src/seatsData.ts                    seats.bin parse, section index
web/src/availability.ts                 seeded clustered mock
web/src/seats.ts                        InstancedMesh, colours, seat LOD
web/src/sectionPatches.ts               patch/hit mesh per section, visibility texture
web/src/flyto.ts                        pure camera maths (section framing, fov, path)
web/src/camera.ts                       OrbitControls + flight tween
web/src/picking.ts                      click-vs-drag detection for section picking
web/src/state.ts                        app state reducer
web/src/ui.ts                           side panel, toggle, legend, error/progress panels
web/src/lightingState.ts                pure: states, transitions, sun, exposure
web/src/lighting.ts                     applies the transition to materials/env/renderer
web/src/stadium.ts                      stadium material patch (RGBM lightmap blend, env blend, LEDs)
web/src/background.ts                   two-texture equirect sky sphere
web/src/trees.ts, treeLight.ts          near trees + impostors
web/src/perf.ts                         fps/tri/draw-call counters, window.__viewer hooks
web/src/style.css
web/test/fixtures/seats_sample.bin      written by Python, read by TS (contract)
web/test/fixtures/hemioct_dirs.json     written by Python, read by TS (contract)
docs/superpowers/reports/2026-09-xx-visual-check.md
```

---

### Task 0: Branch and host tooling

**Files:**
- Modify: `.gitignore`
- Create: `requirements-dev.txt`, `scripts/webexport/__init__.py`, `tests/webexport/__init__.py`, `tests/conftest.py`

**Interfaces:**
- Produces: `.venv/bin/python -m pytest tests/` works; `import webexport` resolves from `scripts/`.

- [ ] **Step 1: Branch**

```bash
cd /Users/Tomas.Herrou/aramco-stadium-3d
git checkout -b web-viewer
```

- [ ] **Step 2: Dev requirements and venv**

`requirements-dev.txt`:
```
pytest>=8
numpy>=2.1
```

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
printf '.venv/\n' >> .gitignore
```

- [ ] **Step 3: Package skeletons**

`scripts/webexport/__init__.py`:
```python
"""Web export for the Aramco Stadium viewer.

Pure modules (seatbin, texel, rgbm, budget, groups, manifest, hemioct) run anywhere;
bpy modules (matinfo, webscene, gltfout, bake, trees, refs) run inside Blender only.
"""
```

`tests/webexport/__init__.py`: empty file.

`tests/conftest.py`:
```python
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
```

- [ ] **Step 4: Smoke run**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: `no tests ran` (exit code 5), with no import errors.

- [ ] **Step 5: Commit**

```bash
git add .gitignore requirements-dev.txt scripts/webexport/__init__.py tests/
git commit -m "Web export: package skeleton and pytest harness"
```

---

### Task 1: Pure export core (seats.bin, texel sizing, RGBM, budgets, groups, manifest, hemi-oct)

**Files:**
- Create: `scripts/webexport/{seatbin,texel,rgbm,budget,groups,manifest,hemioct}.py`
- Test: `tests/webexport/test_{seatbin,texel,rgbm,budget,groups,manifest,hemioct}.py`
- Create: `web/test/fixtures/seats_sample.bin`, `web/test/fixtures/hemioct_dirs.json` (generated in Step 9)

**Interfaces:**
- Produces:
  - `seatbin.MAGIC = b"SEAT"`, `seatbin.VERSION = 1`, `seatbin.HEADER = 16`, `seatbin.RECORD = 19`
  - `seatbin.read_csv(path) -> list[tuple[int,int,int,float,float,float,float]]` (section, row, seat, x, y, z, yaw)
  - `seatbin.pack(rows) -> bytes`, `seatbin.unpack(data: bytes) -> list[tuple]`
  - Layout (little-endian): header `4s magic, u32 version, u32 count, u32 reserved`; record `u16 section, u8 row, u16 seat, f32 x, f32 y, f32 z, f16 yaw`, packed with no padding (`struct` format `<HBHfffe`).
  - `texel.atlas_size(area_m2: float, texels_per_m: float, lo=256, hi=4096, fill=0.72) -> int` (power of two)
  - `rgbm.RANGE = 8.0`, `rgbm.encode(rgb: np.ndarray[h,w,3] float) -> np.ndarray[h,w,4] uint8`, `rgbm.decode(rgba uint8) -> float32 [h,w,3]`
  - `budget.TARGETS = {"triangles": 2_000_000, "first_load_mb": 35.0, "draw_calls": 250}`, `budget.check(report: dict) -> list[str]` (the failures), `budget.near_radius(trees: list[tuple[str, float]], tris: dict[str,int], budget: int, r_max=250.0) -> float`
  - `groups.GROUP_OF_COLLECTION`, `groups.SAIL_MATERIALS`, `groups.group_of(collection: str, material: str) -> str`, `groups.is_excluded(name: str) -> bool`, `groups.TEXELS_PER_M: dict[str, float]`
  - `manifest.STATES = {"day": 0.0, "golden": 0.6, "night": 1.0}`, `manifest.EXPOSURE = {"day": 0.25, "golden": 0.55, "night": 0.75}`, `manifest.new() -> dict`, `manifest.merge(path, patch: dict) -> dict` (deep-merge into file, write, return)
  - `hemioct.N = 8`, `hemioct.cell_dir(i, j, n=N) -> tuple[float,float,float]` (Blender Z-up unit vector, z ≥ 0)

- [ ] **Step 1: Write the failing tests**

`tests/webexport/test_seatbin.py`:
```python
import os
import struct

import pytest

from webexport import seatbin

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSV = os.path.join(REPO, "data", "seats.csv")

ROWS = [(101, 1, 1, -3.25, -45.696, 1.2, 1.5707),
        (344, 28, 50, 105.646, 90.446, 31.871, -2.3562)]


def test_record_is_19_bytes_and_header_16():
    data = seatbin.pack(ROWS)
    assert len(data) == 16 + 19 * len(ROWS)
    magic, ver, count, _ = struct.unpack_from("<4sIII", data, 0)
    assert (magic, ver, count) == (b"SEAT", 1, 2)


def test_roundtrip_quantisation():
    out = seatbin.unpack(seatbin.pack(ROWS))
    for a, b in zip(ROWS, out):
        assert a[:3] == b[:3]
        for u, v in zip(a[3:6], b[3:6]):
            assert abs(u - v) < 1e-4
        assert abs(a[6] - b[6]) < 2e-3          # f16 yaw: ~0.1 degree


def test_bad_magic_rejected():
    data = bytearray(seatbin.pack(ROWS))
    data[0:4] = b"NOPE"
    with pytest.raises(ValueError, match="magic"):
        seatbin.unpack(bytes(data))


def test_truncated_rejected():
    with pytest.raises(ValueError, match="length"):
        seatbin.unpack(seatbin.pack(ROWS)[:-1])


def test_real_csv_counts():
    rows = seatbin.read_csv(CSV)
    assert len(rows) == 46074
    assert len({r[0] for r in rows}) == 132
    assert max(r[1] for r in rows) < 256 and max(r[2] for r in rows) < 65536
```

`tests/webexport/test_texel.py`:
```python
from webexport import texel


def test_power_of_two_and_clamped():
    assert texel.atlas_size(1.0, 4) == 256
    assert texel.atlas_size(1e9, 4) == 4096
    s = texel.atlas_size(150_000, 4)            # bowl-ish: sqrt(150k/0.72)*4 = 1826
    assert s == 2048 and s & (s - 1) == 0


def test_rounds_to_nearest_power():
    assert texel.atlas_size(10_000, 4) == 512   # 471 -> 512
    assert texel.atlas_size(40_000, 4) == 1024  # 943 -> 1024
```

`tests/webexport/test_rgbm.py`:
```python
import numpy as np

from webexport import rgbm


def test_roundtrip_relative_error():
    v = np.array([0.01, 0.1, 0.5, 1.0, 3.0, 7.9], np.float32)
    img = np.stack([v, v * 0.5, v * 0.25], -1)[None]         # 1 x 6 x 3
    back = rgbm.decode(rgbm.encode(img))
    rel = np.abs(back - img) / np.maximum(img, 1e-3)
    assert rel[..., 0].max() < 0.02


def test_black_and_clamp():
    img = np.array([[[0, 0, 0], [100, 100, 100]]], np.float32)
    enc = rgbm.encode(img)
    assert enc.dtype == np.uint8 and enc.shape == (1, 2, 4)
    back = rgbm.decode(enc)
    assert back[0, 0].max() < 1e-3
    assert abs(back[0, 1, 0] - rgbm.RANGE) < 0.05
```

`tests/webexport/test_budget.py`:
```python
from webexport import budget


def test_check_passes_and_fails():
    ok = {"triangles": 1_500_000, "first_load_mb": 30.0}
    assert budget.check(ok) == []
    bad = {"triangles": 2_100_000, "first_load_mb": 36.0}
    msgs = budget.check(bad)
    assert len(msgs) == 2 and "triangles" in msgs[0]


def test_near_radius_shrinks_to_fit():
    trees = [("a", float(d)) for d in range(1, 301)]          # one tree per metre
    r = budget.near_radius(trees, {"a": 1000}, budget=100_000)
    assert 99 <= r < 101                                        # 100 trees fit
    assert budget.near_radius(trees, {"a": 1}, budget=10**9) == 250.0
```

`tests/webexport/test_groups.py`:
```python
from webexport import groups


def test_groups():
    assert groups.group_of("Shell", "M_SailSkin") == "sails"
    assert groups.group_of("Shell", "M_Steel") == "structure"
    assert groups.group_of("Bowl", "M_Concrete") == "bowl"
    assert groups.group_of("Site", "M_Paving") == "site"
    assert groups.group_of("Pitch", "M_Grass") == "pitch"


def test_exclusions():
    for n in ("Seats_Upper", "SeatModel", "SeatModelClub", "Trees_Palm_0", "Crowd_Person_Dark",
              "Haze_Volume", "Sign_Path"):
        assert groups.is_excluded(n)
    for n in ("Podium_Deck", "Cars", "Sign_AramcoStadium", "Bridge_NE_Glass"):
        assert not groups.is_excluded(n)
```

`tests/webexport/test_manifest.py`:
```python
import json

from webexport import manifest


def test_new_has_three_states():
    m = manifest.new()
    assert list(m["states"]) == ["day", "golden", "night"]
    assert m["states"]["golden"]["night"] == 0.6
    assert m["states"]["night"]["exposure"] == 0.75
    assert m["rgbmRange"] == 8.0


def test_merge_is_deep_and_persistent(tmp_path):
    p = tmp_path / "manifest.json"
    manifest.merge(p, manifest.new())
    manifest.merge(p, {"states": {"day": {"lightmaps": {"bowl": "lightmaps/day/bowl.png"}}}})
    m = json.loads(p.read_text())
    assert m["states"]["day"]["night"] == 0.0
    assert m["states"]["day"]["lightmaps"]["bowl"].endswith("bowl.png")
```

`tests/webexport/test_hemioct.py`:
```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/webexport -q`
Expected: FAIL, `ImportError: cannot import name 'seatbin'` (and the same for the other modules).

- [ ] **Step 3: Implement the modules**

`scripts/webexport/seatbin.py`:
```python
"""seats.bin: every seat in Blender Z-up metres (see plan decision D1).

header  <4sIII  magic "SEAT", version, count, reserved
record  <HBHfffe section, row, seat, x, y, z, yaw   (19 bytes, no padding)
"""
import csv
import struct

MAGIC, VERSION = b"SEAT", 1
HEADER_FMT, RECORD_FMT = "<4sIII", "<HBHfffe"
HEADER, RECORD = struct.calcsize(HEADER_FMT), struct.calcsize(RECORD_FMT)
assert (HEADER, RECORD) == (16, 19)


def read_csv(path):
    with open(path) as f:
        return [(int(r["section"]), int(r["row"]), int(r["seat"]), float(r["x"]), float(r["y"]),
                 float(r["z"]), float(r["yaw"])) for r in csv.DictReader(f)]


def pack(rows):
    out = bytearray(struct.pack(HEADER_FMT, MAGIC, VERSION, len(rows), 0))
    for r in rows:
        out += struct.pack(RECORD_FMT, *r)
    return bytes(out)


def unpack(data):
    magic, version, count, _ = struct.unpack_from(HEADER_FMT, data, 0)
    if magic != MAGIC:
        raise ValueError(f"bad magic {magic!r}")
    if version != VERSION:
        raise ValueError(f"unsupported version {version}")
    if len(data) != HEADER + count * RECORD:
        raise ValueError(f"length {len(data)} != {HEADER + count * RECORD}")
    return [struct.unpack_from(RECORD_FMT, data, HEADER + i * RECORD) for i in range(count)]
```

`scripts/webexport/texel.py`:
```python
"""Atlas resolution from surface area and a target texel density."""
import math


def atlas_size(area_m2, texels_per_m, lo=256, hi=4096, fill=0.72):
    """Power-of-two edge so `area_m2` gets ~texels_per_m, given `fill` packing efficiency."""
    edge = math.sqrt(max(area_m2, 1e-6) / fill) * texels_per_m
    p = 2 ** round(math.log2(max(edge, 1)))
    return int(min(max(p, lo), hi))
```

`scripts/webexport/rgbm.py`:
```python
"""RGBM: HDR lightmaps in 8-bit RGBA (linear, not sRGB). rgb = c.rgb * c.a * RANGE."""
import numpy as np

RANGE = 8.0


def encode(rgb):
    rgb = np.clip(np.asarray(rgb, np.float32) / RANGE, 0.0, 1.0)
    m = np.clip(rgb.max(-1, keepdims=True), 1e-6, 1.0)
    m = np.ceil(m * 255.0) / 255.0
    c = np.clip(rgb / m, 0.0, 1.0)
    return np.round(np.concatenate([c, m], -1) * 255.0).astype(np.uint8)


def decode(rgba):
    f = np.asarray(rgba, np.float32) / 255.0
    return f[..., :3] * f[..., 3:4] * RANGE
```

`scripts/webexport/budget.py`:
```python
"""Export budgets from the spec's Targets table."""
import math

TARGETS = {"triangles": 2_000_000, "first_load_mb": 35.0, "draw_calls": 250}
TREE_TRI_BUDGET = 450_000          # decision D9
SEAT_TRI_BUDGET = 25_000 * 24      # decision D6: <= 25k visible seats x 24 tris


def check(report):
    fails = []
    for key, limit in TARGETS.items():
        if key in report and report[key] > limit:
            fails.append(f"{key}: {report[key]:,} > {limit:,}")
    return fails


def near_radius(trees, tris, budget, r_max=250.0):
    """Largest radius <= r_max whose trees (species, distance) fit `budget` triangles."""
    total = 0
    for species, d in sorted(trees, key=lambda t: t[1]):
        if d > r_max:
            return r_max
        total += tris[species]
        if total > budget:
            return math.nextafter(d, 0.0)
    return r_max
```

`scripts/webexport/groups.py`:
```python
"""Which lightmap atlas a merged object belongs to, and what is not exported as geometry."""
GROUP_OF_COLLECTION = {"Pitch": "pitch", "Bowl": "bowl", "Shell": "structure", "Site": "site"}
SAIL_MATERIALS = {"M_SailSkin", "M_SailUnder"}
EXCLUDE_PREFIXES = ("Seats_", "SeatModel", "Trees_", "Crowd_", "Haze_", "Sign_Path")
# lightmap texels per metre (spec: ~4 on the stadium, ~1 on the site)
TEXELS_PER_M = {"pitch": 4.0, "bowl": 4.0, "sails": 4.0, "structure": 4.0, "site": 1.0}
# albedo/emission bake density for procedural materials
ALBEDO_TEXELS_PER_M = {"pitch": 16.0, "bowl": 4.0, "sails": 2.0, "structure": 4.0, "site": 1.0}


def group_of(collection, material):
    if material in SAIL_MATERIALS:
        return "sails"
    return GROUP_OF_COLLECTION[collection]


def is_excluded(name):
    return name.startswith(EXCLUDE_PREFIXES)
```

`scripts/webexport/manifest.py`:
```python
"""build/web_raw/manifest.json: the one file the viewer reads first."""
import json
import os

STATES = {"day": 0.0, "golden": 0.6, "night": 1.0}
EXPOSURE = {"day": 0.25, "golden": 0.55, "night": 0.75}   # lighting._render_settings: 0.25 + 0.5 n


def new():
    return {
        "version": 1,
        "rgbmRange": 8.0,
        "stadium": "stadium.glb",
        "trees": None,
        "seats": "seats.bin",
        "sections": "sections.json",
        "cameras": "cameras.json",
        "states": {k: {"night": n, "exposure": EXPOSURE[k], "env": None, "lightmaps": {}}
                   for k, n in STATES.items()},
    }


def _deep(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            _deep(a[k], v)
        else:
            a[k] = v
    return a


def merge(path, patch):
    path = os.fspath(path)
    cur = {}
    if os.path.exists(path):
        with open(path) as f:
            cur = json.load(f)
    doc = _deep(cur, patch)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(doc, f, indent=1)
    return doc
```

`scripts/webexport/hemioct.py`:
```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/webexport -q`
Expected: all pass.

- [ ] **Step 5: Write the cross-language fixtures**

```bash
mkdir -p web/test/fixtures
.venv/bin/python - <<'EOF'
import json, sys
sys.path.insert(0, "scripts")
from webexport import seatbin, hemioct
rows = [(101, 1, 1, -3.25, -45.696, 1.2, 1.5707), (212, 2, 17, 12.5, -70.25, 14.9, 1.5707),
        (344, 28, 50, 105.646, 90.446, 31.871, -2.3562)]
open("web/test/fixtures/seats_sample.bin", "wb").write(seatbin.pack(rows))
dirs = [[i, j, list(hemioct.cell_dir(i, j))] for i in range(hemioct.N) for j in range(hemioct.N)]
json.dump({"n": hemioct.N, "cells": dirs}, open("web/test/fixtures/hemioct_dirs.json", "w"))
EOF
ls -l web/test/fixtures
```
Expected: `seats_sample.bin` is 73 bytes (16 + 3 × 19); the json holds 64 cells.

- [ ] **Step 6: Commit**

```bash
git add scripts/webexport tests/webexport web/test/fixtures
git commit -m "Web export: pure core (seats.bin, texel sizing, RGBM, budgets, groups, manifest, hemi-oct)"
```

---

### Task 2: Export stage `data` (seats.bin, sections.json, cameras.json, manifest)

**Files:**
- Create: `scripts/export_web.py`

**Interfaces:**
- Consumes: `seatbin.read_csv/pack/unpack`, `manifest.new/merge`.
- Produces:
  - `export_web.run(stages=("data", "geometry", "bake", "trees"), quality="draft"|"full") -> dict` (report)
  - `export_web.RAW = <repo>/build/web_raw`
  - `build/web_raw/seats.bin`, `build/web_raw/sections.json` (copy of `data/sections.json`), `build/web_raw/manifest.json`
  - `build/web_raw/cameras.json`: `{"<name>": {"eye": [x,y,z], "target": [x,y,z], "hfov": deg, "exposure": float}}` in Blender coordinates; `target` = eye + 100 m along the camera's forward vector (−Z local). `hfov` is the angle Blender applies to the **larger** image dimension (sensor_fit AUTO).

- [ ] **Step 1: Write the entry point with the `data` stage**

`scripts/export_web.py`:
```python
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
                 "matinfo", "webscene", "gltfout", "bake", "trees"):
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
    rows = seatbin.read_csv(os.path.join(DATA, "seats.csv"))
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


STAGES = {"data": stage_data}


def run(stages=("data", "geometry", "bake", "trees"), quality="draft"):
    _reload()
    report = {"quality": quality}
    for s in stages:
        STAGES[s](report) if s == "data" else STAGES[s](report, quality)
    with open(os.path.join(RAW, "report.json"), "w") as f:
        json.dump(report, f, indent=1)
    return report
```

- [ ] **Step 2: Run it in Blender (MCP `execute_blender_code`)**

```python
import sys, importlib
sys.path.insert(0, "/Users/Tomas.Herrou/aramco-stadium-3d/scripts")
import export_web; importlib.reload(export_web)
print(export_web.run(stages=("data",)))
```
Expected: `{'quality': 'draft', 'seats': 46074, 'sections': 132, 'seats_bin_bytes': 875422}` (16 + 46,074 × 19 = 875,422).

- [ ] **Step 3: Verify the outputs from the shell**

```bash
ls -l build/web_raw
.venv/bin/python - <<'EOF'
import json, sys
sys.path.insert(0, "scripts")
from webexport import seatbin
rows = seatbin.unpack(open("build/web_raw/seats.bin", "rb").read())
csv = seatbin.read_csv("data/seats.csv")
assert all(a[:3] == b[:3] and abs(a[3] - b[3]) < 1e-4 for a, b in zip(csv, rows))
cams = json.load(open("build/web_raw/cameras.json"))
assert {"CAM_Aerial_Dusk", "CAM_Approach", "CAM_Seat_212", "CAM_Aerial_SW"} <= set(cams)
v = json.load(open("data/sections.json"))["sections"]
s212 = next(s for s in v if s["id"] == "212")["view"]["eye"]
assert max(abs(a - b) for a, b in zip(s212, cams["CAM_Seat_212"]["eye"])) < 0.01
print("ok", len(rows), sorted(cams))
EOF
```
Expected: `ok 46074 [...18 camera names...]`.

- [ ] **Step 4: Commit**

```bash
git add scripts/export_web.py
git commit -m "Web export: data stage (seats.bin, sections, cameras, manifest)"
```

---

### Task 3: Export stage `geometry` (merged web scene, web materials, stadium.glb)

**Files:**
- Create: `scripts/webexport/matinfo.py`, `scripts/webexport/webscene.py`, `scripts/webexport/gltfout.py`
- Modify: `scripts/export_web.py` (add `stage_geometry`)

**Interfaces:**
- Consumes: `groups.*`, `budget.check`, `manifest.merge`.
- Produces:
  - `matinfo.classify(mat) -> dict` with keys `name, kind ("constant"|"tiled"|"procedural"), base (r,g,b), rough, metal, alpha, tile (m or None), images {"base","normal"}, emission None | {"color": (r,g,b), "day": f, "night": f, "baked": bool}, special None|"sailLeds"`
  - `webscene.WEB = "WebExport"`, `webscene.build() -> list[bpy.types.Object]` (merged objects, each with exactly one material slot, UV layers `UVMap` then `LightmapUV`, custom props `lightmap=<group>`, `srcMat=<material name>`)
  - `webscene.set_state(n: float)` (sets `["night"]` on both scenes and refreshes)
  - `webscene.enter()` / `webscene.leave()` (switch `window.scene`)
  - `gltfout.web_material(info, baked: dict) -> bpy.types.Material` (named `<src>.web`; custom props `emDay`, `emNight`, `special`)
  - `gltfout.export_glb(objs, path)`
  - Material extras in the glb: `{"emDay": f, "emNight": f, "special": "sailLeds"|""}`; node extras `{"lightmap": group, "srcMat": name}`.

- [ ] **Step 1: `matinfo.py`**

```python
"""Classify the stadium's Blender materials into glTF-friendly kinds.

constant   : principled inputs are plain values -> glTF factors
tiled      : Poly Haven image textures on object-space metres (assets.pbr_material)
procedural : node-driven base colour -> baked in Task 11
Emission follows common.night_emission (day + n * (night - day)) where it can be parsed.
"""
import bpy


def _bsdf(mat):
    return next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def _upstream(sock, types, depth=6):
    """First node of one of `types` feeding `sock` (breadth-first, a few hops)."""
    frontier = [l.from_node for l in sock.links]
    for _ in range(depth):
        nxt = []
        for n in frontier:
            if n.type in types:
                return n
            for i in n.inputs:
                nxt += [l.from_node for l in i.links]
        frontier = nxt
    return None


def _night_emission(b):
    """(day, night) if Emission Strength = ADD(MULTIPLY(attr, night-day), day), else None."""
    s = b.inputs["Emission Strength"]
    if not s.links:
        v = s.default_value
        return (v, v) if v > 0 else None
    add = s.links[0].from_node
    if add.type != "MATH" or add.operation != "ADD" or not add.inputs[0].links:
        return None
    mul = add.inputs[0].links[0].from_node
    if mul.type != "MATH" or mul.operation != "MULTIPLY" or not mul.inputs[0].links:
        return None
    if mul.inputs[0].links[0].from_node.type != "ATTRIBUTE":
        return None
    day = add.inputs[1].default_value
    return (day, day + mul.inputs[1].default_value)


def classify(mat):
    b = _bsdf(mat)
    info = {"name": mat.name, "kind": "constant", "base": tuple(mat.diffuse_color[:3]),
            "rough": 0.5, "metal": 0.0, "alpha": 1.0, "tile": None, "images": {},
            "emission": None, "special": None}
    if b is None:
        return info
    bc = b.inputs["Base Color"]
    if not bc.links:
        info["base"] = tuple(bc.default_value[:3])
    info["rough"] = b.inputs["Roughness"].default_value if not b.inputs["Roughness"].links else 0.5
    rn = _upstream(b.inputs["Roughness"], {"MAP_RANGE"})
    if rn is not None:
        info["rough"] = 0.5 * (rn.inputs["To Min"].default_value + rn.inputs["To Max"].default_value)
    info["metal"] = b.inputs["Metallic"].default_value
    info["alpha"] = b.inputs["Alpha"].default_value
    if b.inputs["Transmission Weight"].default_value > 0.5:
        info["alpha"] = min(info["alpha"], 0.35)              # glass: plain alpha blend on the web
    if bc.links:
        img = _upstream(bc, {"TEX_IMAGE"})
        mp = _upstream(bc, {"MAPPING"}, depth=8)
        if img is not None and img.image is not None:
            info["kind"] = "tiled"
            info["images"]["base"] = img.image.name
            if mp is not None:
                info["tile"] = 1.0 / mp.inputs["Scale"].default_value[0]
            nm = next((n for n in mat.node_tree.nodes if n.type == "NORMAL_MAP"), None)
            if nm is not None:
                ni = _upstream(nm.inputs["Color"], {"TEX_IMAGE"})
                if ni is not None and ni.image is not None:
                    info["images"]["normal"] = ni.image.name
        else:
            info["kind"] = "procedural"
    col = tuple(b.inputs["Emission Color"].default_value[:3])
    ne = _night_emission(b)
    if mat.name == "M_SailSkin":
        info["special"] = "sailLeds"                             # decision D7
        info["emission"] = {"color": col, "day": 0.0, "night": 40.0, "baked": False}
    elif ne is not None:
        info["emission"] = {"color": col, "day": ne[0], "night": ne[1], "baked": False}
    elif b.inputs["Emission Strength"].links:
        info["emission"] = {"color": col, "day": 0.0, "night": 1.0, "baked": True}   # night set by the bake
    return info
```

- [ ] **Step 2: Check the classifier against known materials in Blender**

MCP `execute_blender_code`:
```python
import sys, importlib
sys.path.insert(0, "/Users/Tomas.Herrou/aramco-stadium-3d/scripts")
from webexport import matinfo; importlib.reload(matinfo)
M = bpy.data.materials
c = {n: matinfo.classify(M[n]) for n in ("M_Grass", "M_Concrete", "M_FasciaLED", "M_LEDBoard",
                                          "M_SailSkin", "M_SailUnder", "M_Building0", "M_SuiteGlass")}
assert c["M_Grass"]["kind"] == "procedural", c["M_Grass"]
assert c["M_Concrete"]["kind"] in ("constant", "tiled")
assert c["M_FasciaLED"]["emission"]["day"] == 0.15 and abs(c["M_FasciaLED"]["emission"]["night"] - 4.0) < 1e-6
assert c["M_LEDBoard"]["emission"]["day"] == 0.3
assert c["M_SailSkin"]["special"] == "sailLeds"
assert c["M_SailUnder"]["emission"]["baked"] and c["M_Building0"]["emission"]["baked"]
assert c["M_SuiteGlass"]["alpha"] <= 0.35
tiled = [m.name for m in M if m.users and matinfo.classify(m)["kind"] == "tiled"]
print("OK tiled:", tiled)
```
Expected: `OK tiled: [...]` listing the Poly Haven ground materials (sand, lawn, paving, asphalt). If an assert fails, print that material's node types and fix the parser before going on.

- [ ] **Step 3: `webscene.py`**

```python
"""Temporary export scene "WebExport": merged, lightmap-ready copies.

The render scene is only read: evaluated meshes are copied, and its lights and
instancers (seats, trees, crowd) are *linked* into WebExport as bake occluders.
"""
import bmesh
import bpy

from . import groups

SRC, WEB = "Scene", "WebExport"
_prev = {}


def src():
    return bpy.data.scenes[SRC]


def enter():
    _prev["scene"] = bpy.context.window.scene
    bpy.context.window.scene = bpy.data.scenes[WEB]


def leave():
    bpy.context.window.scene = _prev.get("scene") or src()


def set_state(n):
    """Drivers read Scene["night"]; world/material attribute nodes read the rendering scene."""
    for name in (SRC, WEB):
        sc = bpy.data.scenes.get(name)
        if sc is not None:
            sc["night"] = float(n)
            sc.update_tag()
    bpy.context.view_layer.update()


def _fresh_scene():
    old = bpy.data.scenes.get(WEB)
    if old is not None:
        for o in list(old.collection.objects):
            if o.get("webexport"):
                bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.scenes.remove(old)
    web = bpy.data.scenes.new(WEB)
    s = src()
    web.world = s.world
    web.render.engine = "CYCLES"
    web.cycles.device = s.cycles.device
    web["night"] = s.get("night", 0.0)
    for cname in ("Lighting", "NightLights"):
        web.collection.children.link(bpy.data.collections[cname])
    for o in s.objects:
        if o.name.startswith(("Seats_", "Trees_", "Crowd_")):
            web.collection.objects.link(o)                     # occluders only; not exported
    return web


def _sources():
    for cname in groups.GROUP_OF_COLLECTION:
        for o in bpy.data.collections[cname].objects:
            if o.type in {"MESH", "FONT", "CURVE"} and not o.hide_render and not groups.is_excluded(o.name):
                yield cname, o


def build():
    web = _fresh_scene()
    dg = bpy.context.evaluated_depsgraph_get()
    acc = {}                                                   # (group, mat) -> bmesh
    for cname, o in _sources():
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
        me.transform(o.matrix_world)
        for idx, mat in enumerate(me.materials):
            if mat is None:
                continue
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != idx], context="FACES")
            if not bm.faces:
                bm.free()
                continue
            tmp = bpy.data.meshes.new("_tmp")
            bm.to_mesh(tmp)
            bm.free()
            key = (groups.group_of(cname, mat.name), mat.name)
            acc.setdefault(key, bmesh.new()).from_mesh(tmp)    # from_mesh appends
            bpy.data.meshes.remove(tmp)
        bpy.data.meshes.remove(me)
    out = []
    for (grp, mname), bm in sorted(acc.items()):
        me = bpy.data.meshes.new(f"{grp}__{mname}")
        for f in bm.faces:
            f.material_index = 0
        bm.to_mesh(me)
        bm.free()
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        me.uv_layers.new(name="UVMap")                          # TEXCOORD_0
        me.uv_layers.new(name="LightmapUV")                     # TEXCOORD_1
        me.materials.append(bpy.data.materials[mname])          # swapped for the .web copy later
        obj = bpy.data.objects.new(me.name, me)
        obj["webexport"], obj["lightmap"], obj["srcMat"] = True, grp, mname
        web.collection.objects.link(obj)
        out.append(obj)
    return out


def planar_uv(obj, tile):
    """UV0 = world XY / tile (tiled Poly Haven materials use object-space metres)."""
    me = obj.data
    uv = me.uv_layers["UVMap"].data
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uv[loop.index].uv = (co.x / tile, co.y / tile)


def triangles(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
```

- [ ] **Step 4: `gltfout.py`**

```python
"""glTF-friendly '.web' copies of materials, and glb export of the WebExport scene."""
import bpy

from . import webscene


def web_material(info, baked):
    """baked: {"base": image name?, "emission": image name?, "emNight": float?}"""
    name = info["name"] + ".web"
    old = bpy.data.materials.get(name)
    if old is not None:
        bpy.data.materials.remove(old)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"

    def image(img_name, sock, non_color=False):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images[img_name]
        if non_color:
            t.image.colorspace_settings.name = "Non-Color"
        nt.links.new(uv.outputs["UV"], t.inputs["Vector"])
        nt.links.new(t.outputs["Color"], sock)
        return t

    b.inputs["Base Color"].default_value = (*info["base"], 1.0)
    if baked.get("base"):
        image(baked["base"], b.inputs["Base Color"])
    elif info["kind"] == "tiled":
        image(info["images"]["base"], b.inputs["Base Color"])
        if "normal" in info["images"]:
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.uv_map = "UVMap"
            image(info["images"]["normal"], nm.inputs["Color"], non_color=True)
            nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = info["rough"]
    b.inputs["Metallic"].default_value = info["metal"]
    b.inputs["Alpha"].default_value = info["alpha"]
    if info["alpha"] < 1.0:
        mat.surface_render_method = "BLENDED"
    em = info["emission"]
    mat["emDay"], mat["emNight"], mat["special"] = 0.0, 0.0, info["special"] or ""
    if em:
        b.inputs["Emission Color"].default_value = (*em["color"], 1.0)
        b.inputs["Emission Strength"].default_value = 1.0
        if baked.get("emission"):
            image(baked["emission"], b.inputs["Emission Color"])
        mat["emDay"] = em["day"]
        mat["emNight"] = baked.get("emNight", em["night"])
    return mat


def export_glb(objs, path):
    webscene.enter()
    try:
        for o in bpy.context.scene.objects:
            o.select_set(False)
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_selection=True, export_extras=True,
            export_yup=True, export_apply=True, export_texcoords=True, export_normals=True,
            export_materials="EXPORT", export_image_format="AUTO", export_cameras=False,
            export_lights=False, export_animations=False)
    finally:
        webscene.leave()
```

- [ ] **Step 5: `stage_geometry` in `export_web.py`**

Add below `stage_data`:
```python
def stage_geometry(report, quality):
    from webexport import budget, gltfout, manifest, matinfo, webscene
    objs = webscene.build()
    mats = {}
    for o in objs:
        info = matinfo.classify(bpy.data.materials[o["srcMat"]])
        if info["kind"] == "tiled" and info["tile"]:
            webscene.planar_uv(o, info["tile"])
        mats[o.name] = gltfout.web_material(info, {})
        o.data.materials[0] = mats[o.name]
    tris = webscene.triangles(objs)
    path = os.path.join(RAW, "stadium.glb")
    gltfout.export_glb(objs, path)
    report.update(objects=len(objs), static_triangles=tris,
                  stadium_glb_mb=round(os.path.getsize(path) / 2**20, 2))
    fails = budget.check({"triangles": tris + budget.TREE_TRI_BUDGET + budget.SEAT_TRI_BUDGET})
    report["budget_failures"] = fails
    manifest.merge(os.path.join(RAW, "manifest.json"), {"stadium": "stadium.glb"})
    assert not fails, fails
```
And register it: `STAGES = {"data": stage_data, "geometry": stage_geometry}`.

- [ ] **Step 6: Run the stage in Blender**

MCP `execute_blender_code`:
```python
import sys, importlib
sys.path.insert(0, "/Users/Tomas.Herrou/aramco-stadium-3d/scripts")
import export_web; importlib.reload(export_web)
print(export_web.run(stages=("geometry",)))
print(bpy.context.window.scene.name, "night=", bpy.data.scenes["Scene"]["night"])
```
Expected: `objects` about 60–80, `static_triangles` ≈ 870,000 (Bowl 354k + Shell 306k + Site 208k + Pitch 1.5k, minus excluded instancers), `budget_failures: []`. The window scene is back to `Scene`. If the call reports "No data received", wait and check `ls -l build/web_raw/stadium.glb build/web_raw/report.json`.

- [ ] **Step 7: Check that the glb has two UV sets and the extras**

```bash
cd web 2>/dev/null || mkdir -p web
npx --yes @gltf-transform/cli@4.5.0 inspect ../build/web_raw/stadium.glb --format md | head -60
cd ..
node -e '
const fs=require("fs");const b=fs.readFileSync("build/web_raw/stadium.glb");
const len=b.readUInt32LE(12);const j=JSON.parse(b.slice(20,20+len));
const prims=j.meshes.flatMap(m=>m.primitives);
const tc1=prims.filter(p=>"TEXCOORD_1" in p.attributes).length;
console.log("prims",prims.length,"with TEXCOORD_1",tc1);
console.log("node extras",j.nodes.slice(0,2).map(n=>n.extras));
console.log("mat extras",j.materials.filter(m=>m.extras&&m.extras.emNight>0).map(m=>[m.name,m.extras]));'
```
Expected: every primitive has `TEXCOORD_1`; nodes carry `{lightmap, srcMat, webexport}`; emissive materials show `emDay/emNight`.
If `TEXCOORD_1` is missing (the exporter dropped the unused UV map): in `gltfout.web_material`, add a 1×1 black image node on `LightmapUV` wired into a `glTF Material Output` group's `Occlusion` input, so the exporter keeps the layer. Then rerun Steps 6–7.

- [ ] **Step 8: Commit**

```bash
git add scripts/export_web.py scripts/webexport/matinfo.py scripts/webexport/webscene.py scripts/webexport/gltfout.py
git commit -m "Web export: geometry stage (merged WebExport scene, web materials, stadium.glb)"
```

---

### Task 4: Optimize pipeline (gltf-transform, KTX2, size budget)

**Files:**
- Create: `scripts/optimize_web.sh`, `scripts/webexport/sizecheck.py`
- Test: `tests/webexport/test_sizecheck.py`

**Interfaces:**
- Consumes: `build/web_raw/{manifest.json, *.glb, seats.bin, sections.json, cameras.json, lightmaps/<state>/<group>.png, env/<state>.hdr, impostors/*.png}` (lightmaps/env/impostors only exist after Tasks 10/12).
- Produces: `web/public/assets/` with the same layout, `.png` lightmaps and impostors replaced by `.ktx2`, and `manifest.json` rewritten to point at the `.ktx2` files. `python -m webexport.sizecheck web/public/assets` exits non-zero above 35 MB.

- [ ] **Step 1: Install KTX-Software**

```bash
gh release download -R KhronosGroup/KTX-Software --pattern '*Darwin-arm64.pkg' -D /private/tmp/ktx --clobber
ls /private/tmp/ktx
```
Then ask the user to run the installer, since it needs sudo: `! sudo installer -pkg /private/tmp/ktx/<file>.pkg -target /`
Verify: `ktx --version` → 4.3 or newer.

- [ ] **Step 2: Failing test for the size check**

`tests/webexport/test_sizecheck.py`:
```python
from webexport import sizecheck


def test_total_and_limit(tmp_path):
    (tmp_path / "a.bin").write_bytes(b"x" * 1024 * 1024)
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "b.bin").write_bytes(b"x" * 512 * 1024)
    total, rows = sizecheck.total_mb(tmp_path)
    assert abs(total - 1.5) < 1e-6 and len(rows) == 2
    assert sizecheck.main([str(tmp_path), "--limit", "1.0"]) == 1
    assert sizecheck.main([str(tmp_path), "--limit", "2.0"]) == 0
```

Run: `.venv/bin/python -m pytest tests/webexport/test_sizecheck.py -q` → FAIL (`ImportError`).

- [ ] **Step 3: `sizecheck.py`**

```python
"""Total size of the shipped assets vs the 35 MB first-load target."""
import argparse
import os
import sys


def total_mb(root):
    rows = []
    for d, _, files in os.walk(root):
        for f in files:
            p = os.path.join(d, f)
            rows.append((os.path.relpath(p, root), os.path.getsize(p)))
    rows.sort(key=lambda r: -r[1])
    return sum(s for _, s in rows) / 2**20, rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--limit", type=float, default=35.0)
    a = ap.parse_args(argv)
    total, rows = total_mb(a.root)
    for name, size in rows[:15]:
        print(f"{size / 2**20:8.2f} MB  {name}")
    print(f"{total:8.2f} MB  TOTAL (limit {a.limit} MB)")
    return 0 if total <= a.limit else 1


if __name__ == "__main__":
    sys.exit(main())
```

Run the test again → PASS.

- [ ] **Step 4: `optimize_web.sh`**

```bash
#!/usr/bin/env bash
# build/web_raw -> web/public/assets  (spec §2). Needs node and KTX-Software `ktx` >= 4.3.
set -euo pipefail
cd "$(dirname "$0")/.."
RAW=build/web_raw
OUT=web/public/assets
GT="npx --yes @gltf-transform/cli@4.5.0"
rm -rf "$OUT" && mkdir -p "$OUT"

opt_glb () {   # $1 in, $2 out
  local tmp; tmp=$(mktemp -d)
  $GT dedup "$1" "$tmp/a.glb"
  $GT instance "$tmp/a.glb" "$tmp/b.glb" --min 5        # trees: repeated nodes -> EXT_mesh_gpu_instancing
  $GT prune "$tmp/b.glb" "$tmp/c.glb"
  $GT weld "$tmp/c.glb" "$tmp/d.glb"
  $GT resize "$tmp/d.glb" "$tmp/e.glb" --width 2048 --height 2048
  $GT etc1s "$tmp/e.glb" "$tmp/f.glb" --slots "{baseColorTexture,emissiveTexture}"
  $GT uastc "$tmp/f.glb" "$tmp/g.glb" --slots "normalTexture" --level 2 --zstd 18
  $GT meshopt "$tmp/g.glb" "$2"
  rm -rf "$tmp"
}

opt_glb "$RAW/stadium.glb" "$OUT/stadium.glb"
[ -f "$RAW/trees.glb" ] && opt_glb "$RAW/trees.glb" "$OUT/trees.glb"
cp "$RAW/seats.bin" "$RAW/sections.json" "$RAW/cameras.json" "$OUT/"

# lightmaps and impostor atlases: PNG -> KTX2. Lightmaps are RGBM (linear), capped at 4096.
find "$RAW" \( -path "*/lightmaps/*.png" -o -path "*/impostors/*.png" \) | while read -r png; do
  rel=${png#"$RAW/"}; dst="$OUT/${rel%.png}.ktx2"; mkdir -p "$(dirname "$dst")"
  case "$rel" in
    lightmaps/*) ktx create --format R8G8B8A8_UNORM --assign-tf linear --encode uastc --uastc-quality 2 --zstd 18 "$png" "$dst" ;;
    impostors/*) ktx create --format R8G8B8A8_SRGB --encode uastc --uastc-quality 2 --zstd 18 --generate-mipmap "$png" "$dst" ;;
  esac
done
if [ -d "$RAW/env" ]; then mkdir -p "$OUT/env" && cp "$RAW"/env/*.hdr "$OUT/env/"; fi

# manifest: point lightmaps/impostors at .ktx2
node -e '
const fs=require("fs");const m=JSON.parse(fs.readFileSync(process.argv[1]));
const k=p=>p&&p.replace(/\.png$/,".ktx2");
for(const s of Object.values(m.states)) for(const g in s.lightmaps) s.lightmaps[g]=k(s.lightmaps[g]);
if(m.trees&&m.trees.impostors) for(const i of Object.values(m.trees.impostors)) i.atlas=k(i.atlas);
fs.writeFileSync(process.argv[2],JSON.stringify(m,null,1));' "$RAW/manifest.json" "$OUT/manifest.json"

PYTHONPATH=scripts .venv/bin/python -m webexport.sizecheck "$OUT" --limit 35
```

```bash
chmod +x scripts/optimize_web.sh && scripts/optimize_web.sh
```
Expected: the script ends with a TOTAL line under 35 MB and exit code 0. With only the geometry exported, the total is about 5–10 MB. If `ktx create` rejects a flag, run `ktx create --help` and adjust the flag names. The encodings stay the same: UASTC + zstd, and linear for lightmaps.

- [ ] **Step 5: Commit**

```bash
git add scripts/optimize_web.sh scripts/webexport/sizecheck.py tests/webexport/test_sizecheck.py
git commit -m "Web export: optimize pipeline (gltf-transform, KTX2) with 35 MB size check"
```

---

### Task 5: Web scaffold: Vite + Three, capabilities, loader with progress/retry, coords, perf

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/scripts/copy-basis.mjs`, `web/src/{main,coords,capabilities,loader,perf,ui}.ts`, `web/src/style.css`
- Test: `web/src/coords.test.ts`, `web/src/capabilities.test.ts`, `web/src/loader.test.ts`

**Interfaces:**
- Consumes: `web/public/assets/manifest.json` (Task 4).
- Produces:
  - `coords.ts`: `type V3 = [number, number, number]`; `toThree(b: V3): THREE.Vector3`; `toBlender(v: THREE.Vector3): V3`; `blenderEquirectUV(dB: V3): [number, number]`; `ENV_ROTATION_Y = Math.PI`
  - `capabilities.ts`: `missingCapabilities(env: {webgl2: boolean; wasm: boolean}): string[]`; `probe(): {webgl2; wasm}`
  - `loader.ts`: `type Manifest` (mirrors `manifest.new()`); `class AssetError extends Error { file: string }`; `runJobs<T>(jobs: Job<T>[], onProgress: (f: number) => void, done?: Map<string, T>): Promise<Map<string, T>>`, where `Job<T> = { file: string; optional?: boolean; run: (p: (f: number) => void) => Promise<T> }`; an optional job that fails resolves to `null` and never throws; `loadAssets(manifest, renderer, onProgress) -> Promise<Assets>`
  - `Assets = { stadium: GLTF; trees: GLTF | null; seatsBin: ArrayBuffer; sections: SectionsDoc; cameras: Record<string, CameraDef>; lightmaps: Record<State, Record<string, THREE.Texture>>; env: Record<State, THREE.DataTexture | null> }`
  - `perf.ts`: `class Perf { begin(): void; end(): void; readonly fps: number }`; `exposeViewerHooks(hooks: object)` sets `window.__viewer`
  - `ui.ts` (partial, extended in Task 8): `showProgress(f)`, `showError(file, onRetry)`, `showFatal(message)`

- [ ] **Step 1: Scaffold**

`web/package.json`:
```json
{
  "name": "aramco-stadium-web",
  "private": true,
  "type": "module",
  "scripts": {
    "postinstall": "node scripts/copy-basis.mjs",
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run"
  },
  "dependencies": { "three": "0.186.0", "stats.js": "^0.17.0" },
  "devDependencies": {
    "@types/three": "0.186.0",
    "@types/stats.js": "^0.17.3",
    "typescript": "^5.6.0",
    "vite": "^8.3.0",
    "vitest": "^5.0.1"
  }
}
```

`web/scripts/copy-basis.mjs`:
```js
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/basis", { recursive: true });
cpSync("node_modules/three/examples/jsm/libs/basis", "public/basis", { recursive: true });
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noEmit": true, "lib": ["ES2022", "DOM"], "types": ["vite/client"],
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
export default defineConfig({ test: { environment: "node" } } as any);
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Aramco Stadium 3D</title>
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <canvas id="view"></canvas>
  <aside id="panel"></aside>
  <div id="overlay"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

```bash
cd web && npm install && ls public/basis && cd ..
printf 'web/public/basis/\n' >> .gitignore
```
Expected: `basis_transcoder.js basis_transcoder.wasm README.md`.

- [ ] **Step 2: Failing tests**

`web/src/coords.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { toThree, toBlender, blenderEquirectUV, ENV_ROTATION_Y } from "./coords";

describe("coords", () => {
  it("maps Blender Z-up to Three Y-up", () => {
    expect(toThree([1, 2, 3]).toArray()).toEqual([1, 3, -2]);
    expect(toBlender(new THREE.Vector3(1, 3, -2))).toEqual([1, 2, 3]);
  });
  it("Three equirect of a rotated dir equals Blender equirect", () => {
    // three's equirectUv(dir) = (atan(dir.z, dir.x) / 2π + 0.5, asin(dir.y) / π + 0.5)
    for (const dB of [[1, 0, 0], [0, 1, 0], [-0.6, -0.8, 0], [0.3, -0.4, 0.866]] as const) {
      const d = toThree([...dB]).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -ENV_ROTATION_Y);
      const u = Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5;
      const v = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI + 0.5;
      const [ub, vb] = blenderEquirectUV([...dB]);
      expect(((u - ub + 1.5) % 1) - 0.5).toBeCloseTo(0, 6);
      expect(v).toBeCloseTo(vb, 6);
    }
  });
});
```

`web/src/capabilities.test.ts`:
```ts
import { expect, it } from "vitest";
import { missingCapabilities } from "./capabilities";

it("names each missing capability", () => {
  expect(missingCapabilities({ webgl2: true, wasm: true })).toEqual([]);
  expect(missingCapabilities({ webgl2: false, wasm: true })).toEqual(["WebGL2"]);
  expect(missingCapabilities({ webgl2: true, wasm: false })).toEqual(["WebAssembly (needed for KTX2 textures)"]);
});
```

`web/src/loader.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { runJobs, AssetError } from "./loader";

const ok = (v: string) => async (p: (f: number) => void) => { p(0.5); p(1); return v; };
const fail = async () => { throw new Error("404"); };

describe("runJobs", () => {
  it("reports monotonic progress ending at 1", async () => {
    const seen: number[] = [];
    const out = await runJobs([{ file: "a", run: ok("A") }, { file: "b", run: ok("B") }], (f) => seen.push(f));
    expect(out.get("a")).toBe("A");
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((f, i) => i === 0 || f >= seen[i - 1])).toBe(true);
  });
  it("optional failures resolve to null", async () => {
    const out = await runJobs([{ file: "t", optional: true, run: fail }], () => {});
    expect(out.get("t")).toBeNull();
  });
  it("required failure names the file; retry re-runs only failed jobs", async () => {
    let calls = 0;
    const flaky = async () => { calls++; if (calls === 1) throw new Error("net"); return "S"; };
    const jobs = [{ file: "a", run: ok("A") }, { file: "stadium.glb", run: flaky }];
    const done = new Map<string, unknown>();
    await expect(runJobs(jobs, () => {}, done)).rejects.toMatchObject({ file: "stadium.glb" });
    expect(done.get("a")).toBe("A");
    let aRuns = 0;
    jobs[0].run = async () => { aRuns++; return "A2"; };
    const out = await runJobs(jobs, () => {}, done);
    expect(out.get("stadium.glb")).toBe("S");
    expect(aRuns).toBe(0);
    expect(new AssetError("x", new Error("y")).file).toBe("x");
  });
});
```

Run: `cd web && npx vitest run` → FAIL (modules missing).

- [ ] **Step 3: Implement coords, capabilities, loader, perf**

`web/src/coords.ts`:
```ts
import * as THREE from "three";

export type V3 = [number, number, number];

/** Blender Z-up metres -> Three Y-up (same as the glTF exporter). Decision D2. */
export const toThree = ([x, y, z]: V3) => new THREE.Vector3(x, z, -y);
export const toBlender = (v: THREE.Vector3): V3 => [v.x, -v.z, v.y];

/** Blender equirect lookup: u = atan2(dir.y, -dir.x) / 2π + 0.5, v = atan2(dir.z, |dir.xy|) / π + 0.5. */
export function blenderEquirectUV([x, y, z]: V3): [number, number] {
  return [Math.atan2(y, -x) / (2 * Math.PI) + 0.5, Math.atan2(z, Math.hypot(x, y)) / Math.PI + 0.5];
}

/** Rotate Three's equirect/PMREM lookups by this about +Y so they match Blender's world. */
export const ENV_ROTATION_Y = Math.PI;
```
If the test shows a 0.5 offset in u with the opposite sign, set `ENV_ROTATION_Y = -Math.PI / 2`, or whatever value the test pins. The test is the source of truth, and `background.ts` and `lighting.ts` both read this constant.

`web/src/capabilities.ts`:
```ts
export function missingCapabilities(env: { webgl2: boolean; wasm: boolean }): string[] {
  const out: string[] = [];
  if (!env.webgl2) out.push("WebGL2");
  if (!env.wasm) out.push("WebAssembly (needed for KTX2 textures)");
  return out;
}

export function probe() {
  const c = document.createElement("canvas");
  return { webgl2: !!c.getContext("webgl2"), wasm: typeof WebAssembly === "object" };
}
```

`web/src/loader.ts`:
```ts
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { V3 } from "./coords";

export type State = "day" | "golden" | "night";
export const STATES: State[] = ["day", "golden", "night"];

export interface Manifest {
  version: number;
  rgbmRange: number;
  stadium: string;
  trees: null | { glb: string; impostors: Record<string, { atlas: string; frames: number; size: number; centerZ: number }> };
  seats: string;
  sections: string;
  cameras: string;
  states: Record<State, { night: number; exposure: number; env: string | null; lightmaps: Record<string, string> }>;
}
export interface CameraDef { eye: V3; target: V3; hfov: number; exposure: number }
export interface SectionView { eye: V3; target: V3; fov: number; seat: string }
export interface Section { id: string; tier: "Lower" | "Club" | "Upper"; level: number; rows: number; seats: number; centroid: V3; angle_deg: number; view: SectionView }
export interface SectionsDoc { seats_total: number; sections: Section[] }
export interface Assets {
  manifest: Manifest;
  stadium: GLTF;
  trees: GLTF | null;
  seatsBin: ArrayBuffer;
  sections: SectionsDoc;
  cameras: Record<string, CameraDef>;
  lightmaps: Record<State, Record<string, THREE.Texture>>;
  env: Record<State, THREE.DataTexture | null>;
}

export class AssetError extends Error {
  constructor(public file: string, cause: unknown) {
    super(`Could not load ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export interface Job<T> { file: string; optional?: boolean; run: (p: (f: number) => void) => Promise<T> }

/** Runs jobs in parallel. `done` carries finished results across retries. */
export async function runJobs<T>(jobs: Job<T>[], onProgress: (f: number) => void, done = new Map<string, T | null>()) {
  const frac = new Map<string, number>(jobs.map((j) => [j.file, done.has(j.file) ? 1 : 0]));
  let last = 0;
  const report = () => {
    const f = [...frac.values()].reduce((a, b) => a + b, 0) / Math.max(jobs.length, 1);
    last = Math.max(last, f);
    onProgress(last);
  };
  let firstError: AssetError | null = null;
  await Promise.all(jobs.filter((j) => !done.has(j.file)).map(async (j) => {
    try {
      done.set(j.file, await j.run((f) => { frac.set(j.file, f); report(); }));
    } catch (e) {
      if (j.optional) done.set(j.file, null);
      else firstError ??= new AssetError(j.file, e);
    }
    frac.set(j.file, 1);
    report();
  }));
  if (firstError) throw firstError;
  return done as Map<string, T | null>;
}

const BASE = "assets/";
const pct = (p: (f: number) => void) => (e: ProgressEvent) => e.total && p(e.loaded / e.total);

export function makeLoaders(renderer: THREE.WebGLRenderer) {
  const ktx2 = new KTX2Loader().setTranscoderPath("basis/").detectSupport(renderer);
  const gltf = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  return { ktx2, gltf, hdr: new HDRLoader(), file: new THREE.FileLoader() };
}

export async function fetchManifest(): Promise<Manifest> {
  const r = await fetch(BASE + "manifest.json");
  if (!r.ok) throw new AssetError("manifest.json", new Error(`HTTP ${r.status}`));
  return r.json();
}

export function assetJobs(m: Manifest, L: ReturnType<typeof makeLoaders>): Job<unknown>[] {
  const jobs: Job<unknown>[] = [
    { file: m.stadium, run: (p) => L.gltf.loadAsync(BASE + m.stadium, pct(p)) },
    { file: m.seats, run: (p) => { L.file.setResponseType("arraybuffer"); return L.file.loadAsync(BASE + m.seats, pct(p)); } },
    { file: m.sections, run: async () => (await fetch(BASE + m.sections)).json() },
    { file: m.cameras, run: async () => (await fetch(BASE + m.cameras)).json() },
  ];
  if (m.trees) jobs.push({ file: m.trees.glb, optional: true, run: (p) => L.gltf.loadAsync(BASE + m.trees!.glb, pct(p)) });
  for (const s of STATES) {
    const st = m.states[s];
    for (const [g, f] of Object.entries(st.lightmaps)) jobs.push({ file: f, run: () => L.ktx2.loadAsync(BASE + f) });
    if (st.env) jobs.push({ file: st.env, run: () => L.hdr.loadAsync(BASE + st.env!) });
  }
  return jobs;
}

export function collect(m: Manifest, out: Map<string, unknown>): Assets {
  const lightmaps = {} as Assets["lightmaps"];
  const env = {} as Assets["env"];
  for (const s of STATES) {
    lightmaps[s] = {};
    for (const [g, f] of Object.entries(m.states[s].lightmaps)) {
      const t = out.get(f) as THREE.Texture;
      t.colorSpace = THREE.NoColorSpace;
      t.channel = 1;                                  // TEXCOORD_1 = LightmapUV
      lightmaps[s][g] = t;
    }
    env[s] = m.states[s].env ? (out.get(m.states[s].env!) as THREE.DataTexture) : null;
    if (env[s]) env[s]!.mapping = THREE.EquirectangularReflectionMapping;
  }
  return {
    manifest: m,
    stadium: out.get(m.stadium) as GLTF,
    trees: m.trees ? ((out.get(m.trees.glb) as GLTF) ?? null) : null,
    seatsBin: out.get(m.seats) as ArrayBuffer,
    sections: out.get(m.sections) as SectionsDoc,
    cameras: out.get(m.cameras) as Record<string, CameraDef>,
    lightmaps, env,
  };
}
```

`web/src/perf.ts`:
```ts
import Stats from "stats.js";

export class Perf {
  private frames: number[] = [];
  private t0 = 0;
  stats: Stats | null = null;
  constructor(show: boolean) {
    if (show) { this.stats = new Stats(); document.body.appendChild(this.stats.dom); }
  }
  begin() { this.t0 = performance.now(); this.stats?.begin(); }
  end() {
    this.stats?.end();
    const now = performance.now();
    this.frames.push(now);
    while (this.frames.length && now - this.frames[0] > 5000) this.frames.shift();
  }
  /** Mean fps over the last 5 s. */
  get fps() { const f = this.frames; return f.length > 1 ? ((f.length - 1) * 1000) / (f[f.length - 1] - f[0]) : 0; }
}

export function exposeViewerHooks(hooks: object) { (window as any).__viewer = hooks; }
```

Run: `cd web && npx vitest run` → PASS (coords, capabilities, loader).

- [ ] **Step 4: Minimal `ui.ts` (progress, error, fatal) and `style.css`**

`web/src/ui.ts`:
```ts
const overlay = () => document.getElementById("overlay")!;

export function showProgress(f: number) {
  overlay().innerHTML = `<div class="progress"><div style="width:${(f * 100).toFixed(1)}%"></div></div>
    <p class="muted">Loading stadium… ${(f * 100).toFixed(0)}%</p>`;
  overlay().hidden = false;
}
export function hideOverlay() { overlay().hidden = true; }
export function showError(file: string, message: string, onRetry: () => void) {
  overlay().innerHTML = `<div class="card"><h2>Couldn't load <code>${file}</code></h2><p class="muted">${message}</p>
    <button id="retry">Retry</button></div>`;
  overlay().hidden = false;
  document.getElementById("retry")!.onclick = onRetry;
}
export function showFatal(message: string) {
  overlay().innerHTML = `<div class="card"><h2>This browser can't show the stadium</h2><p>${message}</p></div>`;
  overlay().hidden = false;
}
```

`web/src/style.css`:
```css
:root { --bg: #0d1117; --panel: rgba(16, 20, 28, 0.86); --fg: #eef2f6; --muted: #9aa4b2;
        --accent: #2fbf71; --taken: #6b6f76; --club: #efe3c8; font: 14px/1.4 system-ui, sans-serif; color: var(--fg); }
html, body { margin: 0; height: 100%; background: var(--bg); overflow: hidden; }
#view { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
#panel { position: fixed; top: 16px; right: 16px; width: 300px; max-width: calc(100vw - 32px);
         background: var(--panel); border-radius: 12px; padding: 16px; backdrop-filter: blur(8px); }
#panel:empty { display: none; }
#overlay { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(13, 17, 23, 0.7); }
#overlay[hidden] { display: none; }
.card { background: var(--panel); padding: 24px; border-radius: 12px; max-width: 420px; }
.progress { width: 320px; height: 6px; background: #273040; border-radius: 3px; overflow: hidden; }
.progress div { height: 100%; background: var(--accent); transition: width 0.2s; }
.muted { color: var(--muted); }
button { font: inherit; color: var(--fg); background: #273040; border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
button[aria-pressed="true"] { background: var(--accent); color: #07140d; }
.seg { display: flex; gap: 4px; margin-bottom: 12px; }
.seg button { flex: 1; }
.legend { display: grid; grid-template-columns: 14px 1fr; gap: 6px 8px; align-items: center; margin-top: 12px; }
.sw { width: 14px; height: 14px; border-radius: 3px; }
```

- [ ] **Step 5: `main.ts`, first version (static stadium, orbit, fallback lights)**

```ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { missingCapabilities, probe } from "./capabilities";
import { AssetError, assetJobs, collect, fetchManifest, makeLoaders, runJobs, type Assets } from "./loader";
import { Perf, exposeViewerHooks } from "./perf";
import { hideOverlay, showError, showFatal, showProgress } from "./ui";
import { toThree } from "./coords";

const params = new URLSearchParams(location.search);

async function boot() {
  const missing = missingCapabilities(probe());
  if (missing.length) return showFatal(`Missing: ${missing.join(", ")}.`);
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const L = makeLoaders(renderer);
  const done = new Map<string, unknown>();
  const attempt = async (): Promise<Assets> => {
    try {
      const m = await fetchManifest();
      showProgress(0);
      return collect(m, await runJobs(assetJobs(m, L), showProgress, done));
    } catch (e) {
      const file = e instanceof AssetError ? e.file : "assets";
      return new Promise((res) => showError(file, String((e as Error).message), () => res(attempt())));
    }
  };
  const assets = await attempt();
  hideOverlay();
  start(renderer, assets);
}

function start(renderer: THREE.WebGLRenderer, a: Assets) {
  const scene = new THREE.Scene();
  scene.add(a.stadium.scene);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 8000);
  const cam = a.cameras["CAM_Aerial_SW"];
  camera.position.copy(toThree(cam.eye));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(toThree(cam.target));
  controls.enableDamping = true;
  // fallback lighting until lightmaps exist (Review Focus 4); lighting.ts replaces this in Task 9
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6b5a40, 1.2));
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.5);
  sun.position.set(-300, 250, 200);
  scene.add(sun);
  const perf = new Perf(params.has("stats"));
  const resize = () => {
    const [w, h] = (params.get("size") ?? `${innerWidth}x${innerHeight}`).split("x").map(Number);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  addEventListener("resize", resize);
  resize();
  renderer.info.autoReset = false;
  exposeViewerHooks({ get fps() { return perf.fps; }, info: renderer.info });
  renderer.setAnimationLoop(() => {
    perf.begin();
    renderer.info.reset();
    controls.update();
    renderer.render(scene, camera);
    perf.end();
  });
}

boot();
```

- [ ] **Step 6: Check it in the browser**

```bash
cd web && npx vite --port 5173
```
(Run in the background.) Use Chrome (claude-in-chrome) to open `http://localhost:5173/?stats=1`.
Expected: a progress bar, then the grey-lit stadium from the SW aerial. Orbit works. The console shows no errors.
Then rename `web/public/assets/stadium.glb` temporarily and reload. Expected: an error card naming `stadium.glb` with Retry. Restore the file, click Retry, and the stadium loads.

- [ ] **Step 7: Commit**

```bash
git add .gitignore web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts web/index.html web/scripts web/src
git commit -m "Web viewer: Vite/Three scaffold, capability check, loader with progress and retry"
```

---

### Task 6: Seats: seats.bin parsing, availability mock, InstancedMesh, section patches, seat LOD

**Files:**
- Create: `web/src/seatsData.ts`, `web/src/availability.ts`, `web/src/seats.ts`, `web/src/sectionPatches.ts`
- Test: `web/src/seatsData.test.ts`, `web/src/availability.test.ts`, `web/src/seats.test.ts`
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: `seats_sample.bin` fixture (Task 1), `Assets.seatsBin`, `Assets.sections` (Task 5), `toThree`.
- Produces:
  - `seatsData.ts`: `interface SeatTable { count; section: Uint16Array; row: Uint8Array; seat: Uint16Array; pos: Float32Array /* Blender xyz, 3 per seat */; yaw: Float32Array }`; `parseSeats(buf: ArrayBuffer): SeatTable` (throws `Error("seats.bin: bad magic")` / `"...: length"`); `indexSections(t: SeatTable): Map<number, { start: number; end: number }>`
  - `availability.ts`: `type Avail = 0 | 1` (0 available, 1 taken); `mockAvailability(t: SeatTable, idx, seed = 2026): Uint8Array`
  - `seats.ts`: `SEAT_COLORS = { available: 0x2fbf71, taken: 0x6b6f76, club: 0xefe3c8 }`; `seatGeometry(): THREE.BufferGeometry` (24 tris, front = +X); `seatColor(tier: string, avail: Avail): number`; `class SeatField { mesh: THREE.InstancedMesh; setVisibleSections(ids: Set<number>): void }`; `visibleSections(camB: V3, sections: Section[], dist: number, always?: number): Set<number>`; `SEAT_LOD_DIST = 90`
  - `sectionPatches.ts`: `class SectionPatches { mesh: THREE.Mesh; sectionOfFace(faceIndex: number): number; setHidden(ids: Set<number>): void }`; `stripVertices(t, idx, sectionId): V3[]` (Blender coords, 2 per row)

- [ ] **Step 1: Failing tests**

`web/src/seatsData.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseSeats, indexSections } from "./seatsData";

const buf = () => { const b = readFileSync(new URL("../test/fixtures/seats_sample.bin", import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

describe("seats.bin (contract with scripts/webexport/seatbin.py)", () => {
  it("parses the Python fixture", () => {
    const t = parseSeats(buf());
    expect(t.count).toBe(3);
    expect([t.section[1], t.row[1], t.seat[1]]).toEqual([212, 2, 17]);
    expect(t.pos[3]).toBeCloseTo(12.5, 4);
    expect(t.pos[5]).toBeCloseTo(14.9, 4);
    expect(t.yaw[2]).toBeCloseTo(-2.3562, 2);
  });
  it("rejects bad magic and truncation", () => {
    const b = new Uint8Array(buf()); b[0] = 0;
    expect(() => parseSeats(b.buffer)).toThrow(/magic/);
    expect(() => parseSeats(buf().slice(0, 72))).toThrow(/length/);
  });
  it("indexes sections", () => {
    const t = parseSeats(buf());
    const idx = indexSections(t);
    expect(idx.get(212)).toEqual({ start: 1, end: 2 });
    expect(idx.get(101)).toEqual({ start: 0, end: 1 });
  });
});
```

`web/src/availability.test.ts`:
```ts
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mockAvailability } from "./availability";
import type { SeatTable } from "./seatsData";
import { indexSections } from "./seatsData";

function realTable(): SeatTable {                        // from data/seats.csv (committed)
  const rows = readFileSync(new URL("../../data/seats.csv", import.meta.url), "utf8").trim().split("\n").slice(1);
  const n = rows.length, t: SeatTable = { count: n, section: new Uint16Array(n), row: new Uint8Array(n), seat: new Uint16Array(n), pos: new Float32Array(n * 3), yaw: new Float32Array(n) };
  rows.forEach((r, i) => { const [s, ro, se, x, y, z, yaw] = r.split(",").map(Number); t.section[i] = s; t.row[i] = ro; t.seat[i] = se; t.pos.set([x, y, z], i * 3); t.yaw[i] = yaw; });
  return t;
}

it("is seeded, ~35% taken, and clustered", () => {
  const t = realTable(), idx = indexSections(t);
  const a = mockAvailability(t, idx, 7), b = mockAvailability(t, idx, 7);
  expect(a).toEqual(b);
  const taken = a.reduce((s, v) => s + v, 0) / a.length;
  expect(taken).toBeGreaterThan(0.3);
  expect(taken).toBeLessThan(0.4);
  let changes = 0;                                         // runs, not salt-and-pepper
  for (let i = 1; i < a.length; i++) if (a[i] !== a[i - 1]) changes++;
  expect(changes / a.length).toBeLessThan(0.2);
  const rates = [...idx.values()].map(({ start, end }) => a.slice(start, end).reduce((s, v) => s + v, 0) / (end - start));
  expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(0.3); // sections differ
});
```

`web/src/seats.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { seatGeometry, seatColor, SEAT_COLORS, visibleSections, SEAT_LOD_DIST } from "./seats";
import type { SectionsDoc } from "./loader";

const doc: SectionsDoc = JSON.parse(readFileSync(new URL("../../data/sections.json", import.meta.url), "utf8"));

describe("seats", () => {
  it("seat model is at most 24 triangles (decision D6)", () => {
    const g = seatGeometry();
    expect((g.index ? g.index.count : g.attributes.position.count) / 3).toBeLessThanOrEqual(24);
  });
  it("colours by tier and availability", () => {
    expect(seatColor("Lower", 0)).toBe(SEAT_COLORS.available);
    expect(seatColor("Club", 0)).toBe(SEAT_COLORS.club);
    expect(seatColor("Club", 1)).toBe(SEAT_COLORS.taken);
    expect(seatColor("Upper", 1)).toBe(SEAT_COLORS.taken);
  });
  it("overview camera shows no individual seats", () => {
    expect(visibleSections([-330, -470, 230], doc.sections, SEAT_LOD_DIST).size).toBe(0);
  });
});
```

Run: `cd web && npx vitest run src/seatsData.test.ts src/availability.test.ts src/seats.test.ts` → FAIL.

- [ ] **Step 2: `seatsData.ts`**

```ts
export interface SeatTable { count: number; section: Uint16Array; row: Uint8Array; seat: Uint16Array; pos: Float32Array; yaw: Float32Array }
const HEADER = 16, RECORD = 19;

function f16(h: number) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + m / 1024);
}

/** seats.bin, see scripts/webexport/seatbin.py (Blender Z-up metres). */
export function parseSeats(buf: ArrayBuffer): SeatTable {
  const dv = new DataView(buf);
  if (buf.byteLength < HEADER || String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== "SEAT") throw new Error("seats.bin: bad magic");
  const count = dv.getUint32(8, true);
  if (buf.byteLength !== HEADER + count * RECORD) throw new Error(`seats.bin: length ${buf.byteLength}`);
  const t: SeatTable = { count, section: new Uint16Array(count), row: new Uint8Array(count), seat: new Uint16Array(count), pos: new Float32Array(count * 3), yaw: new Float32Array(count) };
  for (let i = 0, o = HEADER; i < count; i++, o += RECORD) {
    t.section[i] = dv.getUint16(o, true);
    t.row[i] = dv.getUint8(o + 2);
    t.seat[i] = dv.getUint16(o + 3, true);
    t.pos[i * 3] = dv.getFloat32(o + 5, true);
    t.pos[i * 3 + 1] = dv.getFloat32(o + 9, true);
    t.pos[i * 3 + 2] = dv.getFloat32(o + 13, true);
    t.yaw[i] = f16(dv.getUint16(o + 17, true));
  }
  return t;
}

/** Seats are contiguous per section in seats.csv order. */
export function indexSections(t: SeatTable) {
  const idx = new Map<number, { start: number; end: number }>();
  for (let i = 0; i < t.count; i++) {
    const r = idx.get(t.section[i]);
    if (r) r.end = i + 1; else idx.set(t.section[i], { start: i, end: i + 1 });
  }
  return idx;
}
```

- [ ] **Step 3: `availability.ts`**

```ts
import type { SeatTable } from "./seatsData";
export type Avail = 0 | 1;

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Seeded mock: each section gets its own fill rate around 35 %, and taken seats come in runs
 *  (a two-state Markov chain whose stationary share equals the section rate, mean run ≈ RUN seats). */
export function mockAvailability(t: SeatTable, idx: Map<number, { start: number; end: number }>, seed = 2026): Uint8Array {
  const rnd = mulberry32(seed), out = new Uint8Array(t.count), RUN = 8;
  for (const { start, end } of idx.values()) {
    const rate = Math.min(0.85, Math.max(0.05, 0.35 + (rnd() - 0.5) * 0.6));
    const pTake = rate / RUN, pFree = (1 - rate) / RUN;
    let s = rnd() < rate ? 1 : 0;
    for (let i = start; i < end; i++) {
      out[i] = s;
      if (rnd() < (s ? pFree : pTake)) s ^= 1;
    }
  }
  return out;
}
```

- [ ] **Step 4: `seats.ts`**

```ts
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toThree, type V3 } from "./coords";
import type { Section } from "./loader";
import type { SeatTable } from "./seatsData";
import type { Avail } from "./availability";

export const SEAT_COLORS = { available: 0x2fbf71, taken: 0x6b6f76, club: 0xefe3c8 } as const;
export const SEAT_LOD_DIST = 90;   // m from camera to section centroid; the worst case is pinned in flyto.test.ts (Task 7)
const CLUB_WIDTH = 0.58 / 0.5;     // params.CLUB.seat_w / LOWER.seat_w

/** Low-poly seat, two boxes (pan + back), 24 tris. Front faces +X; origin at the tread. */
export function seatGeometry() {
  const pan = new THREE.BoxGeometry(0.42, 0.06, 0.46).translate(0.02, 0.44, 0);
  const back = new THREE.BoxGeometry(0.06, 0.46, 0.46).translate(-0.2, 0.7, 0);
  const g = mergeGeometries([pan.toNonIndexed(), back.toNonIndexed()])!;
  g.computeVertexNormals();
  return g;
}

export function seatColor(tier: string, avail: Avail) {
  if (avail === 1) return SEAT_COLORS.taken;
  return tier === "Club" ? SEAT_COLORS.club : SEAT_COLORS.available;
}

/** Sections whose centroid is within `dist` of the camera (Blender coords). `always` stays visible. */
export function visibleSections(camB: V3, sections: Section[], dist: number, always = -1) {
  const out = new Set<number>();
  for (const s of sections) {
    const [x, y, z] = s.centroid;
    if (Math.hypot(x - camB[0], y - camB[1], z - camB[2]) < dist || Number(s.id) === always) out.add(Number(s.id));
  }
  return out;
}

export class SeatField {
  mesh: THREE.InstancedMesh;
  private matrices: Float32Array;
  private visible = new Set<number>();
  private tierOf = new Map<number, string>();
  constructor(private t: SeatTable, private idx: Map<number, { start: number; end: number }>, sections: Section[], public avail: Uint8Array) {
    for (const s of sections) this.tierOf.set(Number(s.id), s.tier);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(seatGeometry(), mat, t.count);
    this.mesh.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    this.matrices = new Float32Array(t.count * 16);
    for (let i = 0; i < t.count; i++) {
      const p = toThree([t.pos[i * 3], t.pos[i * 3 + 1], t.pos[i * 3 + 2]]);
      q.setFromAxisAngle(up, t.yaw[i]);               // local +X -> Blender (cos yaw, sin yaw)
      const w = this.tierOf.get(t.section[i]) === "Club" ? CLUB_WIDTH : 1;
      m.compose(p, q, new THREE.Vector3(1, 1, w));
      m.toArray(this.matrices, i * 16);
      this.mesh.setColorAt(i, c.setHex(seatColor(this.tierOf.get(t.section[i])!, avail[i] as Avail)));
    }
    this.setVisibleSections(new Set());
  }
  /** Hidden seats get a zero matrix (degenerate triangles are culled before raster). */
  setVisibleSections(ids: Set<number>) {
    if (ids.size === this.visible.size && [...ids].every((i) => this.visible.has(i))) return;
    this.visible = ids;
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    arr.fill(0);
    for (const id of ids) {
      const r = this.idx.get(id);
      if (r) arr.set(this.matrices.subarray(r.start * 16, r.end * 16), r.start * 16);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
```
Check the orientation in the browser in Step 7: seat backs face away from the pitch. If they face the pitch, use `q.setFromAxisAngle(up, t.yaw[i] + Math.PI)` and note why in a comment.

- [ ] **Step 5: `sectionPatches.ts`**

```ts
import * as THREE from "three";
import { toThree, type V3 } from "./coords";
import type { SeatTable } from "./seatsData";
import type { Avail } from "./availability";

/** Per row: first and last seat of the row, lifted 0.5 m (Blender coords). */
export function stripVertices(t: SeatTable, idx: Map<number, { start: number; end: number }>, section: number): V3[] {
  const r = idx.get(section)!, rows = new Map<number, number[]>();
  for (let i = r.start; i < r.end; i++) (rows.get(t.row[i]) ?? rows.set(t.row[i], []).get(t.row[i])!).push(i);
  const out: V3[] = [];
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const ids = rows.get(row)!.sort((a, b) => t.seat[a] - t.seat[b]);
    for (const i of [ids[0], ids[ids.length - 1]]) out.push([t.pos[i * 3], t.pos[i * 3 + 1], t.pos[i * 3 + 2] + 0.5]);
  }
  return out;
}

/** One mesh for all section patches: drawn when seats are hidden, and always used for picking. */
export class SectionPatches {
  mesh: THREE.Mesh;
  private faceSection: number[] = [];
  private hidden: THREE.DataTexture;
  private slot = new Map<number, number>();
  constructor(t: SeatTable, idx: Map<number, { start: number; end: number }>, avail: Uint8Array) {
    const pos: number[] = [], col: number[] = [], sec: number[] = [];
    const green = new THREE.Color(0x2fbf71), grey = new THREE.Color(0x6b6f76), c = new THREE.Color();
    [...idx.keys()].forEach((id, k) => {
      this.slot.set(id, k);
      const { start, end } = idx.get(id)!;
      let taken = 0; for (let i = start; i < end; i++) taken += avail[i] as Avail;
      c.copy(green).lerp(grey, taken / (end - start));
      const v = stripVertices(t, idx, id).map((p) => toThree(p));
      for (let r = 0; r + 3 < v.length; r += 2) {
        for (const q of [v[r], v[r + 1], v[r + 2], v[r + 1], v[r + 3], v[r + 2]]) { pos.push(q.x, q.y, q.z); col.push(c.r, c.g, c.b); sec.push(k); }
        this.faceSection.push(id, id);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aSlot", new THREE.Float32BufferAttribute(sec, 1));
    g.computeVertexNormals();
    this.hidden = new THREE.DataTexture(new Uint8Array(256), 256, 1, THREE.RedFormat);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    mat.onBeforeCompile = (s) => {
      s.uniforms.uHidden = { value: this.hidden };
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aSlot;\nuniform sampler2D uHidden;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nif (texelFetch(uHidden, ivec2(int(aSlot), 0), 0).r > 0.5) gl_Position = vec4(0.0);");
    };
    this.mesh = new THREE.Mesh(g, mat);
  }
  sectionOfFace(face: number) { return this.faceSection[face] ?? -1; }
  setHidden(ids: Set<number>) {
    const d = this.hidden.image.data as Uint8Array;
    d.fill(0);
    for (const id of ids) d[this.slot.get(id)!] = 255;
    this.hidden.needsUpdate = true;
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `cd web && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Wire into `main.ts` and check visually**

In `start()`, after `scene.add(a.stadium.scene)`:
```ts
  const table = parseSeats(a.seatsBin), idx = indexSections(table);
  const avail = mockAvailability(table, idx);
  const seats = new SeatField(table, idx, a.sections.sections, avail);
  const patches = new SectionPatches(table, idx, avail);
  scene.add(seats.mesh, patches.mesh);
```
and in the loop, before rendering:
```ts
    const vis = visibleSections(toBlender(camera.position), a.sections.sections, SEAT_LOD_DIST);
    seats.setVisibleSections(vis);
    patches.setHidden(vis);
```
(with the matching imports). In Chrome: the overview shows coloured section patches. Orbit close to the lower bowl and seats appear in the nearby sections, with backs away from the pitch. Club seats are cream. Check `window.__viewer.info.render.triangles` in the console, close up: it should stay ≤ 2,000,000.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "Web viewer: seats.bin parsing, clustered availability mock, instanced seats with section LOD patches"
```

---

### Task 7: Camera maths and fly-to (section zoom)

**Files:**
- Create: `web/src/flyto.ts`, `web/src/camera.ts`
- Test: `web/src/flyto.test.ts`, `web/src/camera.test.ts`

**Interfaces:**
- Consumes: `Section`, `CameraDef` (Task 5), `toThree/toBlender`, `visibleSections`, `SEAT_LOD_DIST` (Task 6).
- Produces:
  - `flyto.ts`: `interface Pose { eye: V3; target: V3; hfov: number }` (Blender coords, hfov on the larger image side); `sectionFraming(s: Section): Pose`; `cameraPose(c: CameraDef): Pose`; `verticalFov(hfovLarger: number, aspect: number): number` (degrees); `easeInOutCubic(t)`; `pathPoint(from: V3, to: V3, t: number): V3` (a quadratic Bézier over the oculus when the flight crosses the shell)
  - `camera.ts`: `FLIGHT_S = 1.5`; `class CameraRig { camera; controls; pose(): Pose; flyTo(p: Pose): Promise<void>; jump(p: Pose): void; update(dt: number): void; resize(w, h): void; readonly flying: boolean }`; `poseAt(from: Pose, to: Pose, t: number): Pose` (pure, eased)

- [ ] **Step 1: Failing tests**

`web/src/flyto.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sectionFraming, verticalFov, pathPoint } from "./flyto";
import { visibleSections, SEAT_LOD_DIST } from "./seats";
import type { SectionsDoc } from "./loader";

const doc: SectionsDoc = JSON.parse(readFileSync(new URL("../../data/sections.json", import.meta.url), "utf8"));

describe("fov (Review Focus 3)", () => {
  it("Blender AUTO fit: hfov applies to the larger side", () => {
    expect(verticalFov(62, 16 / 9)).toBeCloseTo(37.36, 2);
    expect(verticalFov(62, 9 / 16)).toBeCloseTo(62, 6);     // portrait: the larger side is vertical
    expect(verticalFov(62, 1)).toBeCloseTo(62, 6);
  });
});

describe("section framing (decision D3: zoom to the area)", () => {
  it("looks at the section from inside the bowl, above it", () => {
    for (const s of doc.sections) {
      const f = sectionFraming(s);
      expect(Math.hypot(f.eye[0], f.eye[1])).toBeLessThan(Math.hypot(s.centroid[0], s.centroid[1]));
      expect(f.eye[2]).toBeGreaterThan(s.centroid[2]);
      expect(f.target).toEqual(s.centroid);
    }
  });
  it("worst-case visible seats from any section framing stays <= 25k (decision D6)", () => {
    let worst = 0;
    for (const s of doc.sections) {
      const ids = visibleSections(sectionFraming(s).eye, doc.sections, SEAT_LOD_DIST, Number(s.id));
      worst = Math.max(worst, doc.sections.filter((x) => ids.has(Number(x.id))).reduce((a, x) => a + x.seats, 0));
    }
    expect(worst).toBeLessThanOrEqual(25_000);
  });
});

describe("flight path", () => {
  it("aerial -> inside the bowl dives through the oculus, not the roof", () => {
    const from: [number, number, number] = [-330, -470, 230], to: [number, number, number] = [0, -20, 35];
    for (let i = 0; i <= 50; i++) {
      const [x, y, z] = pathPoint(from, to, i / 50);
      if (z < 58) expect(Math.hypot(x / 76, y / 63)).toBeLessThan(1.0);  // below the rim => inside the oculus
    }
  });
  it("inside -> inside is a straight line", () => {
    expect(pathPoint([0, -20, 35], [10, -50, 8], 0.5)).toEqual([5, -35, 21.5]);
  });
});
```

`web/src/camera.test.ts`:
```ts
import { expect, it } from "vitest";
import { poseAt } from "./camera";
import type { Pose } from "./flyto";

const A: Pose = { eye: [0, -20, 35], target: [0, 0, 0], hfov: 50 };
const B: Pose = { eye: [10, -50, 8], target: [2, -11, 0], hfov: 55 };
const C: Pose = { eye: [-40, 20, 30], target: [0, 0, 0], hfov: 50 };

it("poseAt hits both ends and eases", () => {
  expect(poseAt(A, B, 0)).toEqual(A);
  expect(poseAt(A, B, 1)).toEqual(B);
  expect(poseAt(A, B, 0.1).eye[0]).toBeLessThan(1);          // slow start
});

it("re-targeting mid-flight starts from the current in-between pose (Review Focus 2)", () => {
  const mid = poseAt(A, B, 0.4);
  expect(poseAt(mid, C, 0)).toEqual(mid);
  expect(poseAt(mid, C, 0.01).eye[0]).toBeCloseTo(mid.eye[0], 0);
});
```

Run: `cd web && npx vitest run src/flyto.test.ts src/camera.test.ts` → FAIL.

- [ ] **Step 2: `flyto.ts`**

```ts
import type { V3 } from "./coords";
import type { CameraDef, Section } from "./loader";

export interface Pose { eye: V3; target: V3; hfov: number }

/** Decision D3: zoom to the area. From over the pitch, 60 m in front of the section and 25 m above it. */
export function sectionFraming(s: Section): Pose {
  const [cx, cy, cz] = s.centroid, r = Math.hypot(cx, cy);
  const k = Math.max(0, (r - 60) / r);
  return { eye: [cx * k, cy * k, cz + 25], target: [cx, cy, cz], hfov: 55 };
}

export const cameraPose = (c: CameraDef): Pose => ({ eye: c.eye, target: c.target, hfov: c.hfov });

/** Blender sensor_fit AUTO: the fov applies to the larger image side. Returns Three's vertical fov. */
export function verticalFov(hfovLarger: number, aspect: number) {
  if (aspect <= 1) return hfovLarger;
  const h = (hfovLarger * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const inside = ([x, y, z]: V3) => Math.hypot(x / 76, y / 63) < 1 && z < 60;   // params.OCULUS_A/B, rim ~56 m

/** Crossing the shell goes through a control point high over the oculus; otherwise a straight line. */
export function pathPoint(from: V3, to: V3, t: number): V3 {
  if (inside(from) === inside(to)) return [0, 1, 2].map((k) => from[k] + (to[k] - from[k]) * t) as V3;
  const c: V3 = [0, 0, Math.max(from[2], to[2], 180)];
  const u = 1 - t;
  return [0, 1, 2].map((k) => u * u * from[k] + 2 * u * t * c[k] + t * t * to[k]) as V3;
}
```
If the worst-case seat test fails, lower `SEAT_LOD_DIST` in `seats.ts` in steps of 10 until it passes, and note the value in the commit message.

- [ ] **Step 3: `camera.ts`**

```ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { toBlender, toThree, type V3 } from "./coords";
import { easeInOutCubic, pathPoint, verticalFov, type Pose } from "./flyto";

export const FLIGHT_S = 1.5;
const lerp3 = (a: V3, b: V3, t: number) => a.map((v, k) => v + (b[k] - v) * t) as V3;

export function poseAt(from: Pose, to: Pose, t: number): Pose {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const e = easeInOutCubic(t);
  return { eye: pathPoint(from.eye, to.eye, e), target: lerp3(from.target, to.target, e), hfov: from.hfov + (to.hfov - from.hfov) * e };
}

export class CameraRig {
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 8000);
  controls: OrbitControls;
  private hfov = 40;
  private flight: { from: Pose; to: Pose; t: number; done: () => void } | null = null;
  constructor(dom: HTMLElement) {
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.maxDistance = 2500;
  }
  get flying() { return this.flight !== null; }
  pose(): Pose { return { eye: toBlender(this.camera.position), target: toBlender(this.controls.target), hfov: this.hfov }; }
  private apply(p: Pose) {
    this.camera.position.copy(toThree(p.eye));
    this.controls.target.copy(toThree(p.target));
    this.hfov = p.hfov;
    this.camera.fov = verticalFov(p.hfov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.controls.target);
  }
  /** Starts from the current pose, so a click mid-flight re-targets smoothly (Review Focus 2). */
  flyTo(to: Pose) {
    this.flight?.done();
    return new Promise<void>((done) => { this.flight = { from: this.pose(), to, t: 0, done }; this.controls.enabled = false; });
  }
  jump(p: Pose) { this.apply(p); }
  update(dt: number) {
    const f = this.flight;
    if (f) {
      f.t = Math.min(1, f.t + dt / FLIGHT_S);
      this.apply(poseAt(f.from, f.to, f.t));
      if (f.t >= 1) { this.flight = null; this.controls.enabled = true; f.done(); }
    }
    this.controls.update();
  }
  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = verticalFov(this.hfov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Use `CameraRig` in `main.ts`**

Replace the `PerspectiveCamera` + `OrbitControls` setup in `start()` with:
```ts
  const rig = new CameraRig(renderer.domElement);
  const overview = cameraPose(a.cameras["CAM_Aerial_SW"]);
  const camParam = params.get("cam");
  rig.jump(camParam && a.cameras[camParam] ? cameraPose(a.cameras[camParam]) : overview);
  const camera = rig.camera;
```
Change `resize` to call `rig.resize(w, h)`. In the loop, call `rig.update(clock.getDelta())`, with `const clock = new THREE.Clock()` added. Extend the hooks: `exposeViewerHooks({ ..., flyTo: (p: Pose) => rig.flyTo(p) })`.
In Chrome, run `__viewer.flyTo({eye:[0,-20,35],target:[0,-55,5],hfov:55})` from the console. Expected: a smooth 1.5 s flight that dives through the oculus and does not cut through the roof.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "Web viewer: fly-to maths (section framing, AUTO-fit fov, oculus path) and camera rig"
```

---

### Task 8: Section picking, app state, side panel

**Files:**
- Create: `web/src/state.ts`, `web/src/picking.ts`
- Modify: `web/src/ui.ts`, `web/src/main.ts`
- Test: `web/src/state.test.ts`

**Interfaces:**
- Consumes: `SectionPatches.sectionOfFace`, `SeatTable`, `indexSections`, availability `Uint8Array`, `CameraRig`, `sectionFraming`, `cameraPose`.
- Produces:
  - `state.ts`: `type View = { kind: "overview" } | { kind: "section"; section: number }`; `interface AppState { view: View; lighting: State }`; `type Action = { type: "section"; section: number } | { type: "back" } | { type: "lighting"; lighting: State } | { type: "none" }`; `reduce(s: AppState, a: Action): AppState` (returns the same object when nothing changes); `initialState: AppState`
  - `picking.ts`: `onClick(dom: HTMLElement, cb: (ndc: THREE.Vector2) => void)`; a pointer move of more than 5 px between down and up is a drag, not a click
  - `ui.ts`: `interface PanelInfo { sectionLabel?: string; tier?: string; available?: number; total?: number }`; `renderPanel(s: AppState, info: PanelInfo, on: { lighting(l: State): void; back(): void })`

- [ ] **Step 1: Failing tests**

`web/src/state.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { reduce, initialState } from "./state";

describe("app state", () => {
  it("overview -> section -> back to overview", () => {
    let s = reduce(initialState, { type: "section", section: 212 });
    expect(s.view).toEqual({ kind: "section", section: 212 });
    s = reduce(s, { type: "back" });
    expect(s.view).toEqual({ kind: "overview" });
  });
  it("another section while zoomed re-targets; the same section again is a no-op (Review Focus 5)", () => {
    const s = reduce(initialState, { type: "section", section: 101 });
    expect(reduce(s, { type: "section", section: 102 }).view).toEqual({ kind: "section", section: 102 });
    expect(reduce(s, { type: "section", section: 101 })).toBe(s);
  });
  it("empty-space click and back from overview change nothing", () => {
    expect(reduce(initialState, { type: "none" })).toBe(initialState);
    expect(reduce(initialState, { type: "back" })).toBe(initialState);
  });
  it("lighting is independent of view", () => {
    const s = reduce(reduce(initialState, { type: "section", section: 7 }), { type: "lighting", lighting: "night" });
    expect(s.lighting).toBe("night");
    expect(s.view.kind).toBe("section");
  });
});
```

Run: `cd web && npx vitest run src/state.test.ts` → FAIL.

- [ ] **Step 2: `state.ts`**

```ts
import type { State } from "./loader";

export type View = { kind: "overview" } | { kind: "section"; section: number };
export interface AppState { view: View; lighting: State }
export type Action =
  | { type: "section"; section: number }
  | { type: "back" }
  | { type: "lighting"; lighting: State }
  | { type: "none" };

export const initialState: AppState = { view: { kind: "overview" }, lighting: "golden" };

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "section":
      if (s.view.kind === "section" && s.view.section === a.section) return s;
      return { ...s, view: { kind: "section", section: a.section } };
    case "back":
      return s.view.kind === "overview" ? s : { ...s, view: { kind: "overview" } };
    case "lighting":
      return s.lighting === a.lighting ? s : { ...s, lighting: a.lighting };
    default:
      return s;
  }
}
```

- [ ] **Step 3: `picking.ts`**

```ts
import * as THREE from "three";

/** Click (not drag) -> normalised device coordinates. */
export function onClick(dom: HTMLElement, cb: (ndc: THREE.Vector2) => void) {
  let down: [number, number] | null = null;
  dom.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  dom.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = dom.getBoundingClientRect();
    cb(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1));
  });
}
```

- [ ] **Step 4: Panel in `ui.ts`**

Append:
```ts
import type { AppState } from "./state";
import type { State } from "./loader";

export interface PanelInfo { sectionLabel?: string; tier?: string; available?: number; total?: number }
const LABEL: Record<State, string> = { day: "Day", golden: "Golden hour", night: "Night" };

export function renderPanel(s: AppState, info: PanelInfo, on: { lighting(l: State): void; back(): void }) {
  const p = document.getElementById("panel")!;
  const seg = (["day", "golden", "night"] as State[])
    .map((l) => `<button data-l="${l}" aria-pressed="${s.lighting === l}">${LABEL[l]}</button>`).join("");
  const body = s.view.kind === "overview"
    ? `<p class="muted">Click a section to zoom to it.</p>`
    : `<h3>Section ${info.sectionLabel} <span class="muted">· ${info.tier}</span></h3>
       <p>${info.available} of ${info.total} seats available</p>
       <p><button id="back">Back to overview</button></p>`;
  p.innerHTML = `<div class="seg" role="group" aria-label="Time of day">${seg}</div>${body}
    <div class="legend"><span class="sw" style="background:var(--accent)"></span>Available
    <span class="sw" style="background:var(--taken)"></span>Taken
    <span class="sw" style="background:var(--club)"></span>Club tier</div>`;
  p.querySelectorAll<HTMLButtonElement>("[data-l]").forEach((b) => (b.onclick = () => on.lighting(b.dataset.l as State)));
  p.querySelector<HTMLButtonElement>("#back")?.addEventListener("click", on.back);
}
```

- [ ] **Step 5: Wire it together in `main.ts`**

In `start()`, after seats and rig exist:
```ts
  let app = initialState;
  let lightingChanged: ((l: State) => void) | undefined;   // set in Task 9
  const secById = new Map(a.sections.sections.map((s) => [Number(s.id), s]));
  const ray = new THREE.Raycaster();
  const dispatch = (act: Action) => {
    const prev = app;
    app = reduce(app, act);
    if (app === prev) return;
    if (act.type === "section" && app.view.kind === "section") rig.flyTo(sectionFraming(secById.get(app.view.section)!));
    if (act.type === "back") rig.flyTo(overview);
    if (act.type === "lighting") lightingChanged?.(app.lighting);
    draw();
  };
  const draw = () => {
    const v = app.view, sec = v.kind === "section" ? secById.get(v.section) : undefined;
    let available = 0, total = 0;
    if (v.kind === "section") {
      const { start, end } = idx.get(v.section)!;
      total = end - start;
      for (let i = start; i < end; i++) available += avail[i] === 0 ? 1 : 0;
    }
    renderPanel(app, { sectionLabel: sec?.id, tier: sec?.tier, available, total }, {
      lighting: (l) => dispatch({ type: "lighting", lighting: l }),
      back: () => dispatch({ type: "back" }),
    });
  };
  onClick(renderer.domElement, (ndc) => {
    ray.setFromCamera(ndc, rig.camera);
    const hit = ray.intersectObject(patches.mesh, false)[0];
    dispatch(hit ? { type: "section", section: patches.sectionOfFace(hit.faceIndex!) } : { type: "none" });
  });
  addEventListener("keydown", (e) => e.key === "Escape" && dispatch({ type: "back" }));
  draw();
```
Also make `visibleSections(...)` in the loop keep the current section's seats visible:
`visibleSections(toBlender(rig.camera.position), a.sections.sections, SEAT_LOD_DIST, app.view.kind === "section" ? app.view.section : -1)`.

- [ ] **Step 6: Tests and browser check**

Run: `cd web && npx vitest run` → PASS.
In Chrome, check each of these:
1. Click a section patch: a 1.5 s flight zooms to the area, the individual seats appear with their colours, and the panel shows "Section N · Tier" plus "X of Y seats available".
2. Click a different section while zoomed: the camera flies there from wherever it is, including mid-flight.
3. "Back to overview" and Esc both work, including mid-flight.
4. Clicking the sky does nothing. Dragging to orbit does not count as a click.

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "Web viewer: section picking, app state, side panel with legend"
```

---

### Task 9: Lighting in the viewer (states, transitions, material patch, sky, bloom, AgX)

**Files:**
- Create: `web/src/lightingState.ts`, `web/src/lighting.ts`, `web/src/stadium.ts`, `web/src/background.ts`
- Modify: `web/src/main.ts`
- Test: `web/src/lightingState.test.ts`, `web/src/stadium.test.ts`

**Interfaces:**
- Consumes: `Assets.lightmaps/env/manifest`, glb material extras `emDay/emNight/special`, node extras `lightmap`, `ENV_ROTATION_Y`, `blenderEquirectUV` mapping.
- Produces:
  - `lightingState.ts`: `STATE_NIGHT: Record<State, number>`; `TRANSITION_S = 1.0`; `class LightingTransition { from: State; to: State; blend: number; request(s: State): void; update(dt: number): void; readonly eased: number; readonly night: number }`; `exposure(night: number, cameraExposure: number): number` (returns `2 ** (0.25 + 0.5 n + e)`); `emissionStrength(emDay, emNight, n)`; `sunToward(n): V3` (Blender); `sunStrength(n)`; `sunColor(n): V3`
  - `stadium.ts`: `patchLightsChunk(chunk: string): string` (throws if three's chunk changed); `interface LightingUniforms { uLmB: {value: Texture|null}; uLmBlend: {value: number}; uEnvB: {value: Texture|null}; uEnvBlend: {value: number}; uRgbmRange: {value: number}; uNight: {value: number} }`; `setupStadiumMaterials(root: Object3D, shared: SharedUniforms, useLightmaps: boolean): Map<string /*group*/, MeshStandardMaterial[]>`; `LED_GLSL` (sail LEDs)
  - `background.ts`: `class Sky { mesh; setTextures(a, b); setBlend(t) }`
  - `lighting.ts`: `class Lighting { constructor(renderer, scene, assets, materials); request(s: State); update(dt, cameraExposure: number) }`, `makeComposer(renderer, scene, camera): EffectComposer`

- [ ] **Step 1: Failing tests**

`web/src/lightingState.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { LightingTransition, exposure, emissionStrength, sunToward, sunStrength } from "./lightingState";

describe("transitions (Review Focus 1)", () => {
  it("reaches the target in ~1 s", () => {
    const t = new LightingTransition("day");
    t.request("night");
    for (let i = 0; i < 60; i++) t.update(1 / 60);
    expect(t.night).toBeCloseTo(1, 6);
  });
  it("reversal mid-way continues from the current value (no jump)", () => {
    const t = new LightingTransition("day");
    t.request("night");
    for (let i = 0; i < 18; i++) t.update(1 / 60);
    const before = t.night;
    t.request("day");
    expect(t.night).toBeCloseTo(before, 6);
    for (let i = 0; i < 120; i++) t.update(1 / 60);
    expect(t.night).toBeCloseTo(0, 6);
  });
  it("third state is queued; values stay continuous and end at golden", () => {
    const t = new LightingTransition("day");
    t.request("night");
    let prev = t.night, maxStep = 0;
    for (let i = 0; i < 240; i++) {
      if (i === 18) t.request("golden");
      t.update(1 / 60);
      maxStep = Math.max(maxStep, Math.abs(t.night - prev));
      prev = t.night;
    }
    expect(t.to).toBe("golden");
    expect(t.night).toBeCloseTo(0.6, 6);
    expect(maxStep).toBeLessThan(0.12);
  });
});

describe("Blender formulas", () => {
  it("exposure = 2^(0.25 + 0.5 n + e)", () => {
    expect(exposure(0, 0)).toBeCloseTo(2 ** 0.25);
    expect(exposure(1, -0.4)).toBeCloseTo(2 ** 0.35);
  });
  it("emission day + n (night - day)", () => {
    expect(emissionStrength(0.3, 5, 0)).toBe(0.3);
    expect(emissionStrength(0.3, 5, 0.6)).toBeCloseTo(3.12);
  });
  it("sun: SW at day, WNW and 2 deg high at golden, off at night", () => {
    const d = sunToward(0);
    expect(d[0]).toBeLessThan(0); expect(d[1]).toBeLessThan(0);
    expect(Math.asin(d[2]) * 180 / Math.PI).toBeCloseTo(24, 4);
    const g = sunToward(0.6);
    expect(Math.asin(g[2]) * 180 / Math.PI).toBeCloseTo(2, 4);
    expect(g[0]).toBeLessThan(0); expect(g[1]).toBeGreaterThan(0);
    expect(sunStrength(1)).toBe(0);
  });
});
```

`web/src/stadium.test.ts`:
```ts
import { expect, it } from "vitest";
import * as THREE from "three";
import { patchLightsChunk } from "./stadium";

it("patches three r186 lights_fragment_maps (lightmap blend, no diffuse IBL, env blend)", () => {
  const out = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
  expect(out).toContain("rgbmDecode");
  expect(out).toContain("uLmBlend");
  expect(out).not.toContain("getIBLIrradiance");
  expect(out).toContain("getIBLRadianceB");
});
it("throws when three's chunk no longer matches", () => {
  expect(() => patchLightsChunk("void main(){}")).toThrow(/three.js/);
});
```

Run: `cd web && npx vitest run src/lightingState.test.ts src/stadium.test.ts` → FAIL.

- [ ] **Step 2: `lightingState.ts`**

```ts
import type { V3 } from "./coords";
import type { State } from "./loader";

export const STATE_NIGHT: Record<State, number> = { day: 0, golden: 0.6, night: 1 };
export const TRANSITION_S = 1.0;
const QUEUED_S = 0.25;
const smooth = (t: number) => t * t * (3 - 2 * t);

export class LightingTransition {
  from: State; to: State; blend = 1;
  private pending: State | null = null;
  constructor(initial: State) { this.from = this.to = initial; }
  request(s: State) {
    if (this.blend >= 1) { if (s !== this.to) { this.from = this.to; this.to = s; this.blend = 0; } return; }
    if (s === this.from) { [this.from, this.to] = [this.to, this.from]; this.blend = 1 - this.blend; this.pending = null; return; }
    this.pending = s === this.to ? null : s;
  }
  update(dt: number) {
    if (this.blend >= 1) return;
    this.blend = Math.min(1, this.blend + dt / (this.pending ? QUEUED_S : TRANSITION_S));
    if (this.blend >= 1 && this.pending) { this.from = this.to; this.to = this.pending; this.pending = null; this.blend = 0; }
  }
  get eased() { return smooth(this.blend); }
  get night() { return STATE_NIGHT[this.from] + (STATE_NIGHT[this.to] - STATE_NIGHT[this.from]) * this.eased; }
}
```
The reversal case needs the eased value continuous under `blend → 1 − blend` with from/to swapped. `smooth` is symmetric: `smooth(1−b) = 1 − smooth(b)`, so the swap is exact.

Append the Blender formulas:
```ts
/** lighting._render_settings: exposure = 0.25 + 0.5 n + camera["exposure"] (stops). */
export const exposure = (n: number, e: number) => 2 ** (0.25 + 0.5 * n + e);
export const emissionStrength = (d: number, nightS: number, n: number) => d + n * (nightS - d);

const T = (n: number) => Math.min(n / 0.6, 1);
/** Direction toward the sun (Blender), from lighting.SUN_ELEV_EXPR / SUN_AZ_EXPR / _sun_rotation. */
export function sunToward(n: number): V3 {
  const e = ((24 - 22 * T(n)) * Math.PI) / 180, a = ((235 + 55 * T(n)) * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
}
export const sunStrength = (n: number) => 3 * Math.max(0, 1 - (n / 0.85) ** 2);
export const sunColor = (n: number): V3 => [1, 0.93 - 0.33 * T(n), 0.82 - 0.52 * T(n)];
```

- [ ] **Step 3: `stadium.ts`**

```ts
import * as THREE from "three";

const LM_RE = /vec4 lightMapTexel = texture2D\( lightMap, vLightMapUv \);\s*vec3 lightMapIrradiance = lightMapTexel\.rgb \* lightMapIntensity;/;
const IBL_IRR_RE = /iblIrradiance \+= getIBLIrradiance\( geometryNormal \);/;
const IBL_RAD_RE = /vec3 iblRadiance = getIBLRadiance\( geometryViewDir, geometryNormal, material\.roughness \);/;

/** Decisions D8/D10: blend two RGBM lightmaps, drop diffuse IBL, blend two PMREMs for specular. */
export function patchLightsChunk(chunk: string) {
  for (const re of [LM_RE, IBL_IRR_RE, IBL_RAD_RE]) if (!re.test(chunk)) throw new Error(`three.js lights_fragment_maps changed: ${re}`);
  return chunk
    .replace(LM_RE, `vec3 lightMapIrradiance = mix( rgbmDecode( texture2D( lightMap, vLightMapUv ) ), rgbmDecode( texture2D( uLmB, vLightMapUv ) ), uLmBlend ) * lightMapIntensity;`)
    .replace(IBL_IRR_RE, "")
    .replace(IBL_RAD_RE, `vec3 iblRadiance = mix( getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ), getIBLRadianceB( geometryViewDir, geometryNormal, material.roughness ), uEnvBlend );`);
}

const PARS = /* glsl */ `
uniform sampler2D uLmB; uniform float uLmBlend; uniform float uRgbmRange;
uniform sampler2D uEnvB; uniform float uEnvBlend; uniform float uNight;
varying vec3 vWorldPosB;
vec3 rgbmDecode( vec4 c ) { return c.rgb * c.a * uRgbmRange; }
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
vec3 getIBLRadianceB( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
  vec3 r = normalize( mix( reflect( - viewDir, normal ), normal, pow4( roughness ) ) );
  r = transformDirectionByInverseViewMatrix( r, viewMatrix );
  return textureCubeUV( uEnvB, envMapRotation * r, roughness ).rgb * envMapIntensity;
}
#else
vec3 getIBLRadianceB( const in vec3 v, const in vec3 n, const in float r ) { return vec3( 0.0 ); }
#endif
`;

/** Decision D7: sail LED points (shell._skin_material): 1.1 m cells, r = 0.055 m, fade 36..50 m, 40 * n. */
export const LED_GLSL = /* glsl */ `
vec3 h33( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.xxy + p.yxx ) * p.zyx ); }
float sailLeds( vec3 pB ) {
  vec3 c = floor( pB / 1.1 ), h = h33( c ), q = ( c + h ) * 1.1;
  float dot_ = step( length( pB - q ), 0.055 );
  float fade = mix( 0.55, 1.01, clamp( ( pB.z - 36.0 ) / 14.0, 0.0, 1.0 ) );
  return dot_ * step( fade, h.x ) * ( h.y * 1.5 + 0.3 );
}
`;

export interface SharedUniforms { uLmBlend: { value: number }; uEnvB: { value: THREE.Texture | null }; uEnvBlend: { value: number }; uRgbmRange: { value: number }; uNight: { value: number } }

export function setupStadiumMaterials(root: THREE.Object3D, shared: SharedUniforms, useLightmaps: boolean) {
  const byGroup = new Map<string, THREE.MeshStandardMaterial[]>();
  const chunk = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const group = (o.userData.lightmap ?? o.parent?.userData.lightmap) as string | undefined;
    const ex = mat.userData as { emDay?: number; emNight?: number; special?: string };
    mat.userData.lmB = { value: null as THREE.Texture | null };
    mat.lightMapIntensity = Math.PI;        // Cycles diffuse bake is E/π; three multiplies by albedo/π
    if (group) (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(mat);
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, shared, { uLmB: mat.userData.lmB });
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPosB;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvec4 wpB = modelMatrix * vec4( transformed, 1.0 ); vWorldPosB = vec3( wpB.x, -wpB.z, wpB.y );");
      s.fragmentShader = s.fragmentShader
        .replace("#include <envmap_physical_pars_fragment>", "#include <envmap_physical_pars_fragment>\n" + PARS + (ex.special === "sailLeds" ? LED_GLSL : ""))
        .replace("#include <lights_fragment_maps>", useLightmaps ? chunk : THREE.ShaderChunk.lights_fragment_maps);
      if (ex.special === "sailLeds")
        s.fragmentShader = s.fragmentShader.replace("#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= sailLeds( vWorldPosB );");
    };
    mat.customProgramCacheKey = () => `stadium-${useLightmaps}-${ex.special ?? ""}`;
    mat.needsUpdate = true;
  });
  return byGroup;
}
```
GLTFLoader copies glTF material `extras` into `material.userData`, and node `extras` into `object.userData`; the code reads both. Transparent `.web` glass materials keep `transparent = true` from the glb.

- [ ] **Step 4: `background.ts`**

```ts
import * as THREE from "three";

/** Sky sphere that cross-fades two equirect HDRs, using Blender's equirect mapping (coords.ts). */
export class Sky {
  mesh: THREE.Mesh;
  private u = { uA: { value: null as THREE.Texture | null }, uB: { value: null as THREE.Texture | null }, uBlend: { value: 0 } };
  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, depthWrite: false, depthTest: false, side: THREE.BackSide,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
      fragmentShader: `uniform sampler2D uA, uB; uniform float uBlend; varying vec3 vDir;
        vec2 uvB(vec3 d){ vec3 b = normalize(vec3(d.x, -d.z, d.y)); return vec2(atan(b.y, -b.x) / 6.2831853 + 0.5, atan(b.z, length(b.xy)) / 3.1415927 + 0.5); }
        void main(){ vec2 uv = uvB(vDir); gl_FragColor = vec4(mix(texture2D(uA, uv).rgb, texture2D(uB, uv).rgb, uBlend), 1.); }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = (_r, _s, cam) => this.mesh.position.copy(cam.position);
  }
  setTextures(a: THREE.Texture, b: THREE.Texture) { this.u.uA.value = a; this.u.uB.value = b; }
  setBlend(t: number) { this.u.uBlend.value = t; }
}
```

- [ ] **Step 5: `lighting.ts`**

```ts
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ENV_ROTATION_Y, toThree } from "./coords";
import { LightingTransition, emissionStrength, exposure, sunColor, sunStrength, sunToward } from "./lightingState";
import { STATES, type Assets, type State } from "./loader";
import { Sky } from "./background";
import type { SharedUniforms } from "./stadium";

export const BLOOM = { strength: 0.6, radius: 0.4, threshold: 1.0 };   // tuned in Task 14

export function makeComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  renderer.toneMapping = THREE.AgXToneMapping;
  const c = new EffectComposer(renderer);
  c.addPass(new RenderPass(scene, camera));
  c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
  c.addPass(new OutputPass());
  return c;
}

export class Lighting {
  t: LightingTransition;
  private pmrem: Partial<Record<State, THREE.Texture>> = {};
  private sky = new Sky();
  private fallbackSun?: THREE.DirectionalLight;
  private fallbackHemi?: THREE.HemisphereLight;
  private shown = "";
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private a: Assets,
              private groups: Map<string, THREE.MeshStandardMaterial[]>, private emissive: THREE.MeshStandardMaterial[], initial: State,
              public shared: SharedUniforms) {
    this.t = new LightingTransition(initial);
    this.shared.uRgbmRange.value = a.manifest.rgbmRange;
    const gen = new THREE.PMREMGenerator(renderer);
    for (const s of STATES) if (a.env[s]) this.pmrem[s] = gen.fromEquirectangular(a.env[s]!).texture;
    gen.dispose();
    if (this.hasEnv) scene.add(this.sky.mesh);
    if (!this.hasLightmaps) {                            // Review Focus 4: viewer still works before the bake
      this.fallbackHemi = new THREE.HemisphereLight(0xdfe8ff, 0x6b5a40, 1.0);
      this.fallbackSun = new THREE.DirectionalLight(0xffffff, 2.5);
      scene.add(this.fallbackHemi, this.fallbackSun);
    }
    this.update(0, 0);   // bind lightMap/envMap before the first compile, so USE_LIGHTMAP/USE_ENVMAP are set
  }
  get hasLightmaps() { return STATES.every((s) => Object.keys(this.a.lightmaps[s]).length > 0); }
  get hasEnv() { return STATES.every((s) => this.a.env[s]); }
  request(s: State) { this.t.request(s); }
  update(dt: number, cameraExposure: number) {
    this.t.update(dt);
    const { from, to } = this.t, e = this.t.eased, n = this.t.night;
    const key = `${from}>${to}`;
    if (key !== this.shown) {                           // rebind the pair only when it changes
      this.shown = key;
      if (this.hasLightmaps) for (const [g, mats] of this.groups) for (const m of mats) {
        m.lightMap = this.a.lightmaps[from][g] ?? null;
        (m.userData.lmB as { value: THREE.Texture | null }).value = this.a.lightmaps[to][g] ?? null;
      }
      if (this.hasEnv) {
        for (const mats of this.groups.values()) for (const m of mats) { m.envMap = this.pmrem[from]!; m.envMapRotation.set(0, ENV_ROTATION_Y, 0); }
        this.shared.uEnvB.value = this.pmrem[to]!;
        this.sky.setTextures(this.a.env[from]!, this.a.env[to]!);
      }
    }
    this.shared.uLmBlend.value = e;
    this.shared.uEnvBlend.value = e;
    this.shared.uNight.value = n;
    this.sky.setBlend(e);
    for (const m of this.emissive) m.emissiveIntensity = emissionStrength(m.userData.emDay ?? 0, m.userData.emNight ?? 0, n);
    this.renderer.toneMappingExposure = exposure(n, cameraExposure);
    if (this.fallbackSun) {
      this.fallbackSun.position.copy(toThree(sunToward(n))).multiplyScalar(500);
      this.fallbackSun.intensity = sunStrength(n) * 0.9;
      this.fallbackSun.color.setRGB(...sunColor(n));
      this.fallbackHemi!.intensity = 1.0 - 0.8 * n;
      this.scene.background = new THREE.Color().setHSL(0.6, 0.4, 0.5 - 0.42 * n);
    }
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `cd web && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Wire into `main.ts`**

- Remove the Task 5 fallback lights from `start()`; `Lighting` owns them now.
- After adding the stadium:
```ts
  const shared: SharedUniforms = { uLmBlend: { value: 0 }, uEnvB: { value: null }, uEnvBlend: { value: 0 }, uRgbmRange: { value: a.manifest.rgbmRange }, uNight: { value: 0 } };
  const groups = setupStadiumMaterials(a.stadium.scene, shared, Object.keys(a.lightmaps.day).length > 0);
  const emissive: THREE.MeshStandardMaterial[] = [];
  a.stadium.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.userData?.emNight > 0) emissive.push(m); });
  const startState = (params.get("state") as State | null) ?? initialState.lighting;
  const lighting = new Lighting(renderer, scene, a, groups, emissive, startState, shared);
  const composer = makeComposer(renderer, scene, rig.camera);
```
- After creating `lighting`: `lightingChanged = (l) => lighting.request(l); app = { ...app, lighting: startState };`.
- In the loop: replace `renderer.render(...)` with:
```ts
    const camExp = app.view.kind === "overview" ? (params.get("cam") ? a.cameras[params.get("cam")!]?.exposure ?? -0.4 : -0.4) : 0.1;
    lighting.update(dt, camExp);
    composer.render(dt);
```
- In `resize`: `composer.setSize(w, h)`.
- Hooks: `setState: (s: State) => dispatch({ type: "lighting", lighting: s })`.

- [ ] **Step 8: Browser check (before the bake)**

In Chrome: toggling Day, Golden and Night fades the fallback sun, exposure and emission over about 1 s. LED boards and fascia glow at night; the sails show LED dots only on the lower body at night. Clicking Night then Golden quickly shows no jump. The console has no shader compile errors.

- [ ] **Step 9: Commit**

```bash
git add web/src
git commit -m "Web viewer: lighting states with cross-fade, RGBM lightmap/env blend patch, sky, bloom, AgX"
```

---

### Task 10: Bake stage: lightmap atlases (3 states) and environment HDRs

**Files:**
- Create: `scripts/webexport/bake.py`
- Modify: `scripts/export_web.py` (add `stage_bake`)

**Interfaces:**
- Consumes: `webscene.build/set_state/enter/leave`, `texel.atlas_size`, `rgbm.encode`, `groups.TEXELS_PER_M`, `manifest.merge`, `gltfout.export_glb`.
- Produces:
  - `bake.lightmap_uvs(objs_by_group: dict[str, list[Object]]) -> dict[str, int]` (atlas sizes)
  - `bake.bake_lightmap(group, objs, size, state, n, samples) -> str` (writes `build/web_raw/lightmaps/<state>/<group>.png`, RGBM)
  - `bake.bake_env(state, n, w=2048) -> str` (writes `build/web_raw/env/<state>.hdr`)
  - `bake.sun_check(path, n) -> float` (degrees between the brightest env pixel and the expected sun azimuth)
  - The manifest's `states.<s>.lightmaps.<group>` and `states.<s>.env` are filled in.
  - `QUALITY = {"draft": {"scale": 0.5, "samples": 64}, "full": {"scale": 1.0, "samples": 256}}`

- [ ] **Step 1: `bake.py`: UVs and lightmaps**

```python
"""Cycles bakes for the web (spec §1.4, §1.8). One MCP call per (group, state):
calls longer than 120 s may report "No data received"; check the PNG on disk."""
import math
import os

import bpy
import numpy as np

from . import groups, rgbm, texel, webscene

RAW = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "build", "web_raw")
QUALITY = {"draft": {"scale": 0.5, "samples": 64}, "full": {"scale": 1.0, "samples": 256}}


def _area(objs):
    return sum(p.area for o in objs for p in o.data.polygons)


def lightmap_uvs(objs_by_group, scale=1.0):
    """Smart-project + pack all objects of a group into one shared LightmapUV atlas."""
    sizes = {}
    webscene.enter()
    try:
        for g, objs in objs_by_group.items():
            for o in bpy.context.scene.objects:
                o.select_set(False)
            for o in objs:
                o.data.uv_layers.active = o.data.uv_layers["LightmapUV"]
                o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            size = texel.atlas_size(_area(objs), groups.TEXELS_PER_M[g] * scale)
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0)
            bpy.ops.uv.average_islands_scale()
            bpy.ops.uv.pack_islands(shape_method="AABB", rotate=True, margin=4.0 / size)
            bpy.ops.object.mode_set(mode="OBJECT")
            sizes[g] = size
    finally:
        webscene.leave()
    return sizes


def _bake_material(src_mat, n):
    """Diffuse stand-in for the lightmap bake: flat albedo + the state's emission (metals bake too)."""
    from . import matinfo
    info = matinfo.classify(src_mat)
    m = bpy.data.materials.new(f"_bake_{src_mat.name}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    dif.inputs["Color"].default_value = (*info["base"], 1)
    add = nt.nodes.new("ShaderNodeAddShader")
    em = nt.nodes.new("ShaderNodeEmission")
    e = info["emission"]
    if e:
        em.inputs["Color"].default_value = (*e["color"], 1)
        em.inputs["Strength"].default_value = e["day"] + n * (e["night"] - e["day"]) if not e["baked"] else 0.0
    else:
        em.inputs["Strength"].default_value = 0.0
    nt.links.new(dif.outputs[0], add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    return m


def bake_lightmap(group, objs, size, state, n, samples):
    webscene.set_state(n)
    img = bpy.data.images.get(f"_lm_{group}") or bpy.data.images.new(f"_lm_{group}", size, size, float_buffer=True, alpha=False)
    img.scale(size, size)
    keep = {}
    for o in objs:
        keep[o.name] = o.data.materials[0]
        bm = _bake_material(bpy.data.materials[o["srcMat"]], n)
        node = bm.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = img
        bm.node_tree.nodes.active = node
        o.data.materials[0] = bm
        o.data.uv_layers.active = o.data.uv_layers["LightmapUV"]
    webscene.enter()
    try:
        sc = bpy.context.scene
        sc.cycles.samples = samples
        sc.render.bake.margin = 8
        sc.render.bake.margin_type = "EXTEND"
        for o in sc.objects:
            o.select_set(False)
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, use_clear=True)
    finally:
        webscene.leave()
        for o in objs:
            tmp = o.data.materials[0]
            o.data.materials[0] = keep[o.name]
            o.data.uv_layers.active = o.data.uv_layers["UVMap"]
            bpy.data.materials.remove(tmp)
    buf = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(buf)
    enc = rgbm.encode(buf.reshape(size, size, 4)[..., :3])
    return _save_png(enc, os.path.join(RAW, "lightmaps", state, f"{group}.png"), non_color=True)


def _save_png(rgba_u8, path, non_color):
    h, w = rgba_u8.shape[:2]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = bpy.data.images.new("_out", w, h, alpha=True)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    img.pixels.foreach_set((rgba_u8.astype(np.float32) / 255.0).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return path
```

- [ ] **Step 2: Environment bake and sun check (add to `bake.py`)**

```python
ENV_SCENE = "WebEnv"


def bake_env(state, n, w=2048):
    """World only, equirect camera at 30 m, rendered as Radiance HDR."""
    sc = bpy.data.scenes.get(ENV_SCENE) or bpy.data.scenes.new(ENV_SCENE)
    sc.world = webscene.src().world
    sc.render.engine = "CYCLES"
    sc.cycles.device = webscene.src().cycles.device
    sc.cycles.samples = 32
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, w // 2, 100
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.exposure = 0.0
    cam = bpy.data.objects.get("_EnvCam") or bpy.data.objects.new("_EnvCam", bpy.data.cameras.new("_EnvCam"))
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    cam.data.type = "PANO"
    cam.data.panorama_type = "EQUIRECTANGULAR"
    cam.location = (0, 0, 30)
    # image centre looks along -X with +Y to the right: the same layout as Blender's world equirect
    # mapping (u = atan2(y, -x) / 2pi + 0.5). sun_check verifies this.
    cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
    sc.camera = cam
    sc["night"] = float(n)
    webscene.set_state(n)
    path = os.path.join(RAW, "env", f"{state}.hdr")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.image_settings.file_format = "HDR"
    sc.render.filepath = path
    prev = bpy.context.window.scene
    bpy.context.window.scene = sc
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        bpy.context.window.scene = prev
    return path


def sun_check(path, n):
    """Angle between the brightest env pixel and the expected sun direction, mapped with
    Blender's equirect formula (web/src/coords.ts blenderEquirectUV)."""
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    lum = px.reshape(h, w, 4)[..., :3].sum(-1)
    y, x = np.unravel_index(np.argmax(lum), lum.shape)
    u, v = (x + 0.5) / w, (y + 0.5) / h
    az = (u - 0.5) * 2 * math.pi
    el = (v - 0.5) * math.pi
    d = (-math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))    # inverse of blenderEquirectUV
    t = min(n / 0.6, 1.0)
    e, a = math.radians(24 - 22 * t), math.radians(235 + 55 * t)
    s = (math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e))
    return math.degrees(math.acos(max(-1, min(1, sum(p * q for p, q in zip(d, s))))))
```

- [ ] **Step 3: `stage_bake` in `export_web.py`**

```python
def stage_bake(report, quality, only_states=None, only_groups=None):
    """UVs once, then (group x state) lightmaps, then env maps; re-exports stadium.glb with UVs."""
    from webexport import bake, gltfout, manifest, webscene
    q = bake.QUALITY[quality]
    web = bpy.data.scenes[webscene.WEB]
    objs = [o for o in web.objects if o.get("webexport")]
    by = {}
    for o in objs:
        by.setdefault(o["lightmap"], []).append(o)
    # UVs persist on the scene: every MCP call is a fresh namespace, and all states must share one UV layout
    if web.get("lm_quality") != quality:
        web["lm_atlas"] = json.dumps(bake.lightmap_uvs(by, q["scale"]))
        web["lm_quality"] = quality
        gltfout.export_glb(objs, os.path.join(RAW, "stadium.glb"))    # now with real LightmapUVs
    report["atlas"] = json.loads(web["lm_atlas"])
    patch = {"states": {}}
    for state, n in manifest.STATES.items():
        if only_states and state not in only_states:
            continue
        lm = {}
        for g, gobjs in by.items():
            if only_groups and g not in only_groups:
                continue
            p = bake.bake_lightmap(g, gobjs, report["atlas"][g], state, n, q["samples"])
            lm[g] = os.path.relpath(p, RAW)
        env = bake.bake_env(state, n)
        report.setdefault("sun_error_deg", {})[state] = round(bake.sun_check(env, n), 1) if n < 1 else None
        patch["states"][state] = {"lightmaps": lm, "env": os.path.relpath(env, RAW)}
    manifest.merge(os.path.join(RAW, "manifest.json"), patch)
```
Register `"bake": stage_bake` in `STAGES`. `run()` passes `(report, quality)`. For a partial bake, call `stage_bake` directly (Step 5).

- [ ] **Step 4: UVs + one draft lightmap (fast feedback)**

MCP (the geometry stage must have run in this Blender session, so that `WebExport` exists):
```python
import sys, importlib, json
sys.path.insert(0, "/Users/Tomas.Herrou/aramco-stadium-3d/scripts")
import export_web; importlib.reload(export_web); export_web._reload()
rep = {"quality": "draft"}
export_web.stage_bake(rep, "draft", only_states=["golden"], only_groups=["pitch"])
print(json.dumps(rep))
```
Expected: the atlas sizes are printed, and `build/web_raw/lightmaps/golden/pitch.png` exists. `sun_error_deg.golden` < 5°. If it isn't, the camera axis is off: an error near 180° means the view is mirrored (try `(math.pi / 2, 0, -math.pi / 2)`), and near 90° means rotated. Fix `_EnvCam.rotation_euler` and rerun until it is < 5°.
Open the PNG in Blender's image editor or with `Read`. It should show pitch lighting with stadium shadow, and no black islands. Black islands mean missing UVs, so check the pack step.

- [ ] **Step 5: Full draft bake, one call per state**

For each `state` in `["day", "golden", "night"]`, run a separate MCP call:
```python
export_web.stage_bake(rep, "draft", only_states=["<state>"])
```
After each call, verify from the shell (it may report "No data received" and keep running):
```bash
ls -l build/web_raw/lightmaps/*/ build/web_raw/env/
```
Expected in the end: 15 PNGs (5 groups × 3 states) and 3 `.hdr`.

- [ ] **Step 6: Optimize and look at it**

```bash
scripts/optimize_web.sh
```
Expected: TOTAL ≤ 35 MB. If it goes over, lower `groups.TEXELS_PER_M["site"]` to 0.6, or cap the site atlas at 2048 in `texel.atlas_size(..., hi=2048)`, then rebake the site only.
Reload the viewer. The fallback lights are gone (lightmaps are present), and shadows and bounce light are visible. Day, Golden and Night cross-fade the lightmaps and sky. The golden sun sits in the WNW, as in `renders/aerial_dusk_golden.png`.

- [ ] **Step 7: Full-quality bake (unattended)**

Repeat Step 5 with `"full"` in place of `"draft"`. The quality change re-projects the UVs once, on the first call, and re-exports `stadium.glb`, so **all three states must be rebaked** at full quality. Expect about 30–60 min per state. Verify the files on disk after each state, then rerun `scripts/optimize_web.sh`.

- [ ] **Step 8: Commit**

```bash
git add scripts/webexport/bake.py scripts/export_web.py
git commit -m "Web export: lightmap atlases (RGBM, 3 states) and environment HDR bakes"
```

---

### Task 11: Bake stage: procedural albedo and emission textures

**Files:**
- Modify: `scripts/webexport/bake.py` (add `bake_surface`), `scripts/export_web.py` (add `stage_surfaces`)

**Interfaces:**
- Consumes: `matinfo.classify` (`kind == "procedural"` or `emission.baked`), `groups.ALBEDO_TEXELS_PER_M`, `gltfout.web_material(info, baked)`.
- Produces: `bake.bake_surface(obj, info, scale, samples) -> dict` → `{"base": image name?, "emission": image name?, "emNight": float?}`. It writes `build/web_raw/surfaces/<obj>_{base,emission}.png` and packs the images into `stadium.glb` through the `.web` material.

- [ ] **Step 1: UV0 for procedural objects, and the bake**

Add to `bake.py`:
```python
def _uv0_project(obj):
    webscene.enter()
    try:
        for o in bpy.context.scene.objects:
            o.select_set(False)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        obj.data.uv_layers.active = obj.data.uv_layers["UVMap"]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002)
        bpy.ops.object.mode_set(mode="OBJECT")
    finally:
        webscene.leave()


def _to_srgb(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def bake_surface(obj, info, scale, samples):
    """Base colour (DIFFUSE/COLOR) and night emission (EMIT at n=1) for node-driven materials."""
    out = {}
    size = texel.atlas_size(_area([obj]), groups.ALBEDO_TEXELS_PER_M[obj["lightmap"]] * scale, hi=2048)
    _uv0_project(obj)
    src = bpy.data.materials[obj["srcMat"]].copy()               # never bake through the shared original
    keep = obj.data.materials[0]
    obj.data.materials[0] = src
    jobs = []
    if info["kind"] == "procedural":
        jobs.append(("base", "DIFFUSE", {"COLOR"}, 0.0))
    if info["emission"] and info["emission"]["baked"]:
        jobs.append(("emission", "EMIT", set(), 1.0))
    webscene.enter()
    try:
        for kind, btype, passes, n in jobs:
            webscene.set_state(n)
            img = bpy.data.images.new(f"{obj.name}_{kind}", size, size, float_buffer=(kind == "emission"))
            node = src.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = img
            src.node_tree.nodes.active = node
            sc = bpy.context.scene
            sc.cycles.samples = max(16, samples // 4)
            for o in sc.objects:
                o.select_set(False)
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.bake(type=btype, pass_filter=passes, use_clear=True, margin=4)
            src.node_tree.nodes.remove(node)
            buf = np.empty(size * size * 4, np.float32)
            img.pixels.foreach_get(buf)
            px = buf.reshape(size, size, 4)
            if kind == "emission":                                   # HDR -> LDR map x strength
                peak = float(px[..., :3].max()) or 1.0
                out["emNight"] = peak
                px[..., :3] = _to_srgb(px[..., :3] / peak)          # byte sRGB image stores encoded values
                px[..., 3] = 1.0
                img2 = bpy.data.images.new(f"{obj.name}_emission_ldr", size, size)
                img2.pixels.foreach_set(px.ravel())
                bpy.data.images.remove(img)
                img = img2
            img.name = f"{obj.name}_{kind}"
            img.filepath_raw = os.path.join(RAW, "surfaces", f"{img.name}.png")
            os.makedirs(os.path.dirname(img.filepath_raw), exist_ok=True)
            img.file_format = "PNG"
            img.save()
            out[kind] = img.name
    finally:
        webscene.leave()
        obj.data.materials[0] = keep
        bpy.data.materials.remove(src)
    return out
```

- [ ] **Step 2: `stage_surfaces` in `export_web.py`**

```python
def stage_surfaces(report, quality):
    from webexport import bake, gltfout, matinfo, webscene
    q = bake.QUALITY[quality]
    objs = [o for o in bpy.data.scenes[webscene.WEB].objects if o.get("webexport")]
    done = []
    for o in objs:
        info = matinfo.classify(bpy.data.materials[o["srcMat"]])
        if info["kind"] != "procedural" and not (info["emission"] and info["emission"]["baked"]):
            continue
        baked = bake.bake_surface(o, info, q["scale"], q["samples"])
        o.data.materials[0] = gltfout.web_material(info, baked)
        done.append((o.name, sorted(baked)))
    gltfout.export_glb(objs, os.path.join(RAW, "stadium.glb"))
    report["surfaces"] = done
```
Register `"surfaces": stage_surfaces` in `STAGES`. The default `run()` stage order becomes `("data", "geometry", "surfaces", "bake", "trees")`. Bake the surfaces before the lightmaps, because smart-projecting UV0 does not touch LightmapUV.

- [ ] **Step 3: Run it**

MCP: `print(export_web.run(stages=("surfaces",), quality="draft"))`
Expected: `surfaces` lists the pitch grass (`base`), the sail undersides (`emission`), the city buildings (`emission`) and the site noise materials (`base`). Then:
```bash
ls -l build/web_raw/surfaces && scripts/optimize_web.sh
```
Expected: the size check passes. In the viewer, the pitch shows mowing stripes; at night the sail undersides glow warm, strongest near the base, and city windows are lit.

- [ ] **Step 4: Commit**

```bash
git add scripts/webexport/bake.py scripts/export_web.py
git commit -m "Web export: bake procedural albedo and emission to textures"
```

---

### Task 12: Trees export: near LOD instances and impostor atlases

**Files:**
- Create: `scripts/webexport/trees.py`
- Modify: `scripts/export_web.py` (add `stage_trees`)

**Interfaces:**
- Consumes: `budget.near_radius`, `budget.TREE_TRI_BUDGET`, `hemioct.cell_dir/N`, `webscene.src()`, `manifest.merge`.
- Produces:
  - `build/web_raw/trees.glb`. It holds one linked-duplicate node per near tree, sharing a mesh per species (`gltf-transform instance` turns these into `EXT_mesh_gpu_instancing`). It also holds nodes `Impostor_<species>` that share a unit quad mesh; their transforms carry the position, yaw and scale of the far trees.
  - `build/web_raw/impostors/<species>.png`: N×N frames, RGBA, 1024².
  - `manifest.trees = {"glb": "trees.glb", "impostors": {"<species>": {"atlas": "impostors/<species>.png", "frames": 8, "size": <m>, "centerZ": <m>}}}`
  - `report.trees = {"near_radius": r, "near": count, "far": count, "near_tris": t}`
  - Species keys: `jacaranda_tree`, `island_tree_01`, `tree_small_02`, `palm` (Palm_0 and Palm_1 share one impostor).

- [ ] **Step 1: Try to fetch the Poly Haven LODs**

For each of `jacaranda_tree`, `island_tree_01`, `tree_small_02`, call MCP `download_polyhaven_asset(asset_id=<id>, asset_type="models", resolution="1k", file_format="gltf")`. Then list what arrived:
```python
print(sorted((o.name, len(o.data.polygons)) for o in bpy.data.objects if o.type == "MESH" and "LOD" in o.name))
```
Note which `<species>_LOD1..3` objects now exist. The importer links them into the current scene; move them out of it without touching anything else:
```python
for o in [o for o in bpy.data.objects if "_LOD" in o.name and not o.name.endswith("LOD0")]:
    for c in list(o.users_collection): c.objects.unlink(o)
```
(They stay in `bpy.data` for the export, and the .blend is never saved.)

- [ ] **Step 2: `trees.py`**

```python
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


def instances():
    """[(proto object, species, matrix_world)] for every tree instance in the render scene."""
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for i in dg.object_instances:
        if i.is_instance and i.object.name in SPECIES:
            out.append((i.object.original, SPECIES[i.object.name], i.matrix_world.copy()))
    return out


def _tris(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def lod_mesh(proto, target):
    """Lowest Poly Haven LOD with >= MIN_TRIS, else a decimated copy of the proto."""
    base = proto.name.replace("_LOD0", "")
    cands = sorted((o for o in bpy.data.objects if o.name.startswith(base + "_LOD") and o.type == "MESH"),
                   key=lambda o: _tris(o.data))
    for o in cands:
        if _tris(o.data) <= target:
            return o.data
    me = proto.data.copy()
    tmp = bpy.data.objects.new("_dec", me)
    bpy.data.scenes[TREES_SCENE].collection.objects.link(tmp)
    mod = tmp.modifiers.new("dec", "DECIMATE")
    mod.ratio = max(0.01, target / max(_tris(me), 1))
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg), depsgraph=dg)
    bpy.data.objects.remove(tmp)
    return out
```

Then the near/far split, the glb, and the impostor atlases (same file):
```python
def build(report):
    sc = bpy.data.scenes.get(TREES_SCENE) or bpy.data.scenes.new(TREES_SCENE)
    for o in list(sc.collection.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    inst = instances()
    protos = {sp: p for p, sp, _ in inst}
    dist = [(sp, math.hypot(m.translation.x, m.translation.y)) for _, sp, m in inst]
    count_near = lambda r: sum(1 for _, d in dist if d <= r)
    # per-tree target so that ~250 m of trees fits the budget, but never below MIN_TRIS
    target = max(MIN_TRIS, budget.TREE_TRI_BUDGET // max(count_near(250.0), 1))
    meshes = {sp: lod_mesh(p, target) for sp, p in protos.items()}
    tris = {sp: _tris(me) for sp, me in meshes.items()}
    r = budget.near_radius(dist, tris, budget.TREE_TRI_BUDGET)
    quads = {}
    for sp in protos:     # one quad mesh + material per species, so `gltf-transform instance` batches per species
        q = bpy.data.meshes.new(f"ImpostorQuad_{sp}")
        q.from_pydata([(-0.5, 0, 0), (0.5, 0, 0), (0.5, 0, 1), (-0.5, 0, 1)], [], [(0, 1, 2, 3)])
        q.materials.append(bpy.data.materials.get(f"Impostor_{sp}") or bpy.data.materials.new(f"Impostor_{sp}"))
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
                       "per_tree_tris": tris}
    return sc, protos


def export(sc):
    prev = bpy.context.window.scene
    bpy.context.window.scene = sc
    try:
        bpy.ops.export_scene.gltf(filepath=os.path.join(RAW, "trees.glb"), export_format="GLB",
                                  use_selection=False, export_yup=True, export_apply=True,
                                  export_materials="EXPORT", export_image_format="AUTO",
                                  export_cameras=False, export_lights=False, export_animations=False)
    finally:
        bpy.context.window.scene = prev


def impostor_atlas(species, proto):
    """Render N x N hemi-oct frames of `proto` (flat white world, Standard view) into one atlas."""
    sc = bpy.data.scenes.get(IMP_SCENE) or bpy.data.scenes.new(IMP_SCENE)
    for o in list(sc.collection.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    w = bpy.data.worlds.get("_ImpWorld") or bpy.data.worlds.new("_ImpWorld")
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = 1.0
    sc.world = w
    sc.render.engine = "CYCLES"
    sc.cycles.device = webscene.src().cycles.device
    sc.cycles.samples = 16
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.render.resolution_x = sc.render.resolution_y = FRAME_PX
    tree = bpy.data.objects.new("_ImpTree", proto.data)
    sc.collection.objects.link(tree)
    bb = [tree.matrix_world @ mathutils.Vector(c) for c in proto.bound_box]
    size = max(max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb),
               max(v.z for v in bb) - min(v.z for v in bb))
    cz = 0.5 * (max(v.z for v in bb) + min(v.z for v in bb))
    cam = bpy.data.objects.new("_ImpCam", bpy.data.cameras.new("_ImpCam"))
    cam.data.type, cam.data.ortho_scale = "ORTHO", size * 1.05
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
                cam.rotation_euler = (-d).to_track_quat("-Z", "Z" if abs(d.z) < 0.99 else "Y").to_euler()
                sc.render.filepath = tmp
                bpy.ops.render.render(write_still=True)
                img = bpy.data.images.load(tmp, check_existing=False)
                px = np.empty(FRAME_PX * FRAME_PX * 4, np.float32)
                img.pixels.foreach_get(px)
                bpy.data.images.remove(img)
                atlas[j * FRAME_PX:(j + 1) * FRAME_PX, i * FRAME_PX:(i + 1) * FRAME_PX] = px.reshape(FRAME_PX, FRAME_PX, 4)
    finally:
        bpy.context.window.scene = prev
    out = bpy.data.images.new(f"_imp_{species}", n * FRAME_PX, n * FRAME_PX, alpha=True)
    out.pixels.foreach_set(atlas.ravel())
    out.filepath_raw = os.path.join(RAW, "impostors", f"{species}.png")
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    os.remove(tmp)
    return {"atlas": f"impostors/{species}.png", "frames": n, "size": size * 1.05, "centerZ": cz}
```
Blender stores pixel rows bottom-up, but the PNG file (and therefore the KTX2, loaded with `flipY = false`) puts the top row at `uv.y = 0`. So frame `(i, j)`, with tree height `v` running 0 → 1 upward, is sampled at `uv = ((i + u) / N, 1 − (j + v) / N)`. `trees.ts` uses exactly this, and the orientation check in Task 13, Step 5 confirms it. Palm_0 and Palm_1 share the `palm` mesh and impostor (the last prototype seen); this is acceptable for the PoC.

- [ ] **Step 3: `stage_trees`**

```python
def stage_trees(report, quality):
    from webexport import manifest, trees
    sc, protos = trees.build(report)
    trees.export(sc)
    imp = {}
    for sp, proto in protos.items():
        if sp not in imp:
            imp[sp] = trees.impostor_atlas(sp, proto)
    manifest.merge(os.path.join(RAW, "manifest.json"), {"trees": {"glb": "trees.glb", "impostors": imp}})
```
Register it in `STAGES`.

- [ ] **Step 4: Run it and check**

MCP: `print(export_web.run(stages=("trees",)))`. Impostor renders run about 64 × 4 frames; if the call times out, check the files on disk.
Expected: `trees.near_tris ≤ 450000`, `near_radius` ≤ 250, and `near + far` = 4,272 (1,031 + 999 + 983 + 660 + 599). Check the files:
```bash
ls -l build/web_raw/trees.glb build/web_raw/impostors/
scripts/optimize_web.sh
npx --yes @gltf-transform/cli@4.5.0 inspect web/public/assets/trees.glb | grep -i -A3 instancing
```
Expected: `EXT_mesh_gpu_instancing` listed, and TOTAL ≤ 35 MB. Open one atlas PNG: 8×8 views of the tree, with the top-down view near the centre.

- [ ] **Step 5: Commit**

```bash
git add scripts/webexport/trees.py scripts/export_web.py
git commit -m "Web export: near-tree LOD instances and hemi-octahedral impostor atlases"
```

---

### Task 13: Trees in the viewer

**Files:**
- Create: `web/src/treeLight.ts`, `web/src/trees.ts`
- Modify: `web/src/main.ts`, `web/src/lighting.ts` (drive the tree uniforms)
- Test: `web/src/trees.test.ts`

**Interfaces:**
- Consumes: `Assets.trees` (GLTF with `InstancedMesh` from `EXT_mesh_gpu_instancing`), `manifest.trees.impostors`, the `hemioct_dirs.json` fixture, `sunToward/sunStrength/sunColor`.
- Produces:
  - `trees.ts`: `hemiOctCell(dirB: V3, n: number): [number, number]` (inverse of `hemioct.cell_dir`); `setupTrees(gltf, impostors: Record<string, {atlas: Texture; frames; size; centerZ}>, u: TreeUniforms): void`
  - `treeLight.ts`: `interface TreeUniforms { uSunDirView: {value: Vector3}; uSun: {value: Color}; uAmbient: {value: Color} }`; `TREE_AMBIENT: Record<State, number>` = `{ day: 0.9, golden: 0.55, night: 0.12 }`; `patchTreeMaterial(m: MeshStandardMaterial, u)`; `updateTreeUniforms(u, n, camera)`

- [ ] **Step 1: Failing test (contract with the Python hemi-oct)**

`web/src/trees.test.ts`:
```ts
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hemiOctCell } from "./trees";

const fx = JSON.parse(readFileSync(new URL("../test/fixtures/hemioct_dirs.json", import.meta.url), "utf8"));

it("encodes every Python cell direction back to its cell", () => {
  for (const [i, j, d] of fx.cells) expect(hemiOctCell(d, fx.n)).toEqual([i, j]);
});
it("clamps below-horizon views to the rim", () => {
  const [i, j] = hemiOctCell([1, 0, -0.5], 8);
  expect(i).toBeGreaterThanOrEqual(0); expect(j).toBeLessThan(8);
});
```
Run: `cd web && npx vitest run src/trees.test.ts` → FAIL.

- [ ] **Step 2: `treeLight.ts`**

```ts
import * as THREE from "three";
import { toThree } from "./coords";
import { sunColor, sunStrength, sunToward, STATE_NIGHT } from "./lightingState";

export interface TreeUniforms { uSunDirView: { value: THREE.Vector3 }; uSun: { value: THREE.Color }; uAmbient: { value: THREE.Color } }
export const TREE_AMBIENT = { day: 0.9, golden: 0.55, night: 0.12 };
export const makeTreeUniforms = (): TreeUniforms => ({ uSunDirView: { value: new THREE.Vector3() }, uSun: { value: new THREE.Color() }, uAmbient: { value: new THREE.Color() } });

/** Trees aren't lightmapped: Blender's sun (same formulas) + a per-state ambient. */
export function updateTreeUniforms(u: TreeUniforms, n: number, camera: THREE.Camera) {
  u.uSunDirView.value.copy(toThree(sunToward(n))).transformDirection(camera.matrixWorldInverse);
  u.uSun.value.setRGB(...sunColor(n)).multiplyScalar(sunStrength(n));
  const amb = n <= STATE_NIGHT.golden ? THREE.MathUtils.lerp(TREE_AMBIENT.day, TREE_AMBIENT.golden, n / 0.6)
                                       : THREE.MathUtils.lerp(TREE_AMBIENT.golden, TREE_AMBIENT.night, (n - 0.6) / 0.4);
  u.uAmbient.value.setRGB(amb * 0.8, amb * 0.87, amb);
}

export function patchTreeMaterial(m: THREE.MeshStandardMaterial, u: TreeUniforms) {
  m.alphaTest = 0.5;
  m.transparent = false;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uSunDirView; uniform vec3 uSun; uniform vec3 uAmbient;")
      .replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\nirradiance += PI * ( uAmbient + uSun * max( dot( geometryNormal, uSunDirView ), 0.0 ) );");
  };
  m.customProgramCacheKey = () => "tree";
}
```

- [ ] **Step 3: `trees.ts` (encode + impostor shader + setup)**

```ts
import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { V3 } from "./coords";
import { patchTreeMaterial, type TreeUniforms } from "./treeLight";

/** Inverse of scripts/webexport/hemioct.py cell_dir (Blender Z-up). */
export function hemiOctCell([x, y, z]: V3, n: number): [number, number] {
  z = Math.max(z, 0);
  const s = Math.abs(x) + Math.abs(y) + z || 1;
  const px = x / s, py = y / s;
  const u = px + py, v = px - py;                                   // back to [-1, 1]^2
  const cell = (c: number) => Math.min(n - 1, Math.max(0, Math.floor(((c + 1) / 2) * n)));
  return [cell(u), cell(v)];
}

const IMPOSTOR_VS = /* glsl */ `
uniform float uSize; uniform float uCenterZ; uniform float uFrames;
varying vec2 vUv; varying vec2 vCell;
vec2 cellOf(vec3 d) {
  d.z = max(d.z, 0.0); d /= (abs(d.x) + abs(d.y) + d.z);
  vec2 uv = vec2(d.x + d.y, d.x - d.y);
  return clamp(floor((uv + 1.0) * 0.5 * uFrames), 0.0, uFrames - 1.0);
}
void main() {
  vec4 c = instanceMatrix * vec4(0.0, uCenterZ, 0.0, 1.0);          // Three space, tree centre
  vec3 camL = (inverse(mat3(instanceMatrix)) * (cameraPosition - c.xyz));
  vec3 dB = normalize(vec3(camL.x, -camL.z, camL.y));                // to Blender local
  vCell = cellOf(dB);
  float scale = length(instanceMatrix[0].xyz);
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 up = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  vec3 p = c.xyz + (right * position.x + up * (position.y - 0.5)) * uSize * scale;   // Blender quad z -> glTF y
  vUv = vec2(position.x + 0.5, position.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const IMPOSTOR_FS = /* glsl */ `
uniform sampler2D uAtlas; uniform float uFrames; uniform vec3 uSun; uniform vec3 uAmbient;
varying vec2 vUv; varying vec2 vCell;
void main() {
  vec4 c = texture2D(uAtlas, vec2((vCell.x + vUv.x) / uFrames, 1.0 - (vCell.y + vUv.y) / uFrames));  // see Task 12 note
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb * (uAmbient + 0.6 * uSun), 1.0);
}`;

export function setupTrees(gltf: GLTF, impostors: Record<string, { atlas: THREE.Texture; frames: number; size: number; centerZ: number }>, u: TreeUniforms) {
  gltf.scene.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isMesh) return;
    const sp = /^Impostor_(.+?)(\.\d+)?$/.exec((m.material as THREE.Material).name)?.[1];   // material per species (Task 12)
    if (sp && impostors[sp]) {
      const im = impostors[sp];
      m.material = new THREE.ShaderMaterial({
        uniforms: { uAtlas: { value: im.atlas }, uFrames: { value: im.frames }, uSize: { value: im.size }, uCenterZ: { value: im.centerZ }, uSun: u.uSun, uAmbient: u.uAmbient },
        vertexShader: IMPOSTOR_VS, fragmentShader: IMPOSTOR_FS,
      });
      m.frustumCulled = false;
    } else {
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) patchTreeMaterial(mat as THREE.MeshStandardMaterial, u);
    }
  });
}
```
Leaf alpha comes from the glTF base-colour alpha; `patchTreeMaterial` sets `alphaTest`, which also keeps it out of the transparent sort. The instance scale is uniform: the Blender tree instances scale uniformly (`assets.PH_TREES`).

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run` → PASS.

- [ ] **Step 5: Wire in and check**

In `loader.ts`, add `impostors: Record<string, { atlas: THREE.Texture; frames: number; size: number; centerZ: number }>` to `Assets`. At the end of `assetJobs`:
```ts
  if (m.trees) for (const im of Object.values(m.trees.impostors))
    jobs.push({ file: im.atlas, optional: true, run: () => L.ktx2.loadAsync(BASE + im.atlas) });
```
and in `collect`:
```ts
  const impostors: Assets["impostors"] = {};
  if (m.trees) for (const [sp, im] of Object.entries(m.trees.impostors)) {
    const t = out.get(im.atlas) as THREE.Texture | null;
    if (t) { t.colorSpace = THREE.SRGBColorSpace; impostors[sp] = { ...im, atlas: t }; }
  }
```
(and return `impostors` from `collect`). In `main.ts`:
```ts
  const treeU = makeTreeUniforms();
  if (a.trees) { setupTrees(a.trees, a.impostors, treeU); scene.add(a.trees.scene); }
```
Loop: `updateTreeUniforms(treeU, lighting.t.night, rig.camera)`.
In Chrome: the park and palm avenue show trees at the CAM_Approach framing (`?cam=CAM_Approach`). Distant trees are impostors that turn with the view. Trees that look upside-down or mirrored mean the atlas row order is wrong (see the note in Task 12, Step 2): flip `vUv.y`, or `vCell.y`, in `IMPOSTOR_FS`. Check `__viewer.info.render.triangles` ≤ 2M and `calls` ≤ 250 at `CAM_Aerial_SW`.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "Web viewer: near trees with state-driven sun light, hemi-oct impostors for far trees"
```

---

### Task 14: Reference renders, visual check, performance, README

**Files:**
- Create: `scripts/webexport/refs.py`, `docs/superpowers/reports/2026-09-xx-visual-check.md` (use the actual date)
- Modify: `README.md`, `web/src/lighting.ts` (`BLOOM` tuning), `web/src/lightingState.ts` (tuning constants only)

**Interfaces:**
- Consumes: the whole viewer; hooks `window.__viewer.{fps, info, setState}`; URL params `cam`, `state`, `size`, `stats`.
- Produces: `renders/ref_web/<CAM>_<state>.png` (9 files, not in git) and the findings report.

- [ ] **Step 1: `refs.py`**

```python
"""Reference stills for the visual check: 3 framings x 3 states at 1920x1080."""
import os

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CAMS = ("CAM_Aerial_Dusk", "CAM_Approach", "CAM_Seat_212")
STATES = {"day": 0.0, "golden": 0.6, "night": 1.0}


def render_one(cam, state, samples=128):
    sc = bpy.data.scenes["Scene"]
    prev = (sc.camera, sc.get("night", 0.0), sc.render.filepath, sc.cycles.samples,
            sc.render.resolution_x, sc.render.resolution_y)
    sc.camera = bpy.data.objects[cam]
    sc["night"] = STATES[state]
    sc.update_tag()
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.cycles.samples = samples
    path = os.path.join(REPO, "renders", "ref_web", f"{cam}_{state}.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.filepath = path
    try:
        bpy.ops.render.render(write_still=True)
    finally:   # leave the render scene exactly as it was
        (sc.camera, sc["night"], sc.render.filepath, sc.cycles.samples,
         sc.render.resolution_x, sc.render.resolution_y) = prev
    return path
```

- [ ] **Step 2: Render the 9 references (one MCP call each, about 90 s)**

```python
import sys, importlib; sys.path.insert(0, "/Users/Tomas.Herrou/aramco-stadium-3d/scripts")
from webexport import refs; importlib.reload(refs)
print(refs.render_one("CAM_Aerial_Dusk", "golden"))
```
Repeat for all 3 × 3 combinations. Verify: `ls renders/ref_web | wc -l` → 9.

- [ ] **Step 3: Capture the viewer at the same framings**

With `npx vite` running, for each camera and state, open
`http://localhost:5173/?cam=<CAM>&state=<state>&size=1920x1080` in Chrome, wait for loading and a 2 s settle, and take a screenshot. Compare each with `renders/ref_web/<CAM>_<state>.png` side by side, using `Read` on both.

- [ ] **Step 4: Tune (constants only) and write down the findings**

Tune only these, in this order, and re-shoot after each change:
1. Per-state `EXPOSURE` offsets (`manifest.EXPOSURE`), mirrored in `lightingState.exposure`. Keep one offset per state, so camera exposure stays as in Blender.
2. `BLOOM.threshold/strength`.
3. `TREE_AMBIENT`.
4. `uRgbmRange` must stay 8; never "fix" brightness there.

Write `docs/superpowers/reports/<date>-visual-check.md` with a table: camera × state → composition ✓/✗, lighting mood, colour, notes (expected gaps: no crowd, sun specular on sails, AgX look difference). Also record the tuned values.

- [ ] **Step 5: Performance**

At `?cam=CAM_Aerial_SW&state=night&size=1920x1080&stats=1`, then at `?cam=CAM_Seat_212&...`, wait 10 s. In the console:
```js
({ fps: __viewer.fps, tris: __viewer.info.render.triangles, calls: __viewer.info.render.calls })
```
Expected: fps ≥ 50, tris ≤ 2,000,000, calls ≤ 250. Record the numbers in the report.
If fps < 50, apply the first fix that works:
1. `renderer.setPixelRatio(1)` at 1080p.
2. Bloom at half resolution.
3. Lower `SEAT_LOD_DIST`, which the test still pins.

- [ ] **Step 6: Full-quality final pass**

Make sure the Task 10, Step 7 full bake has been done, then run `scripts/optimize_web.sh` → TOTAL ≤ 35 MB, and `cd web && npx vitest run && npm run build` → all green.

- [ ] **Step 7: README**

Add a "Web viewer" section to `README.md`:
```markdown
## Web viewer (phase 2)

Export (inside the open Blender session, via the MCP; never headless here):

    import sys; sys.path.insert(0, "<repo>/scripts")
    import export_web; export_web.run(quality="draft")     # or "full" (~2-3 h of bakes)

Then:

    scripts/optimize_web.sh            # build/web_raw -> web/public/assets, fails above 35 MB
    cd web && npm install && npm run dev

URL parameters: `state=day|golden|night`, `cam=<Blender camera name>`, `size=1920x1080`, `stats=1`.
Seat availability is a seeded mock. Numbering is the invented one in `data/`.
```

- [ ] **Step 8: Commit**

```bash
git add scripts/webexport/refs.py docs/superpowers/reports README.md web/src
git commit -m "Web viewer: visual check vs Cycles references, performance numbers, README"
```

---

## Self-review notes (for the reviewer)

- **Spec coverage:**
  - Export steps 1–10 → Tasks 2, 3, 10, 11, 12.
  - Optimize → Task 4.
  - Web modules: `loader` (Task 5), `seats` (Task 6), `camera` (Task 7), `picking`/`ui` (Task 8; section only, D11), `lighting`/`stadium` (Task 9), trees (Task 13).
  - Error handling → Tasks 5 and 8.
  - Testing: counts in Tasks 1/2, seats.bin parsing in Task 6, lookup in Task 6, section framing and seat budget in Task 7, visual and performance checks in Task 14.
  - Risks: half-resolution iteration (draft quality), sails atlas (D5), Poly Haven LODs (Task 12, Step 1), bloom/AgX tuning (Task 14).
- **Not covered by automated tests on purpose:** the Cycles bakes and glTF export. Each has an on-disk verification step, because headless Blender cannot run in CI on this machine.
- **Draft-first order:** Tasks 5–9 run on the un-baked export (fallback lights), so the viewer can be reviewed before any multi-hour bake.
