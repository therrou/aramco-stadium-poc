# Web viewer v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web stadium look as close to the Cycles renders as possible without a rebake (Stage A), and turn the viewer into an aramcostadium.com-styled "take your seat" finder.

**Architecture:** Rendering fixes are shader-chunk patches and per-material constants in `stadium.ts` / `treeLight.ts` / `lighting.ts`, plus a lightmap re-encode with mips; each constant starts at a reasoned value and is tuned once in Task 8 against the 9 Cycles references with a shared frame-metric tool (`frameStats.ts` in the browser, `framestats.py` for the PNGs). The seat finder replaces the section-zoom view with `overview | seat` state, a seat directory built from `seats.bin`, ray-to-seat picking on the existing section strips, a look-around camera mode, and plain-DOM UI modules under `web/src/ui/`.

**Tech Stack:** TypeScript, three.js 0.186 (pinned), Vite 8, Vitest 5, KTX-Software `ktx` 4.4.2, Python 3 (.venv, numpy, Pillow) for image metrics.

**Spec:** `docs/superpowers/specs/2026-09-25-web-viewer-v2-design.md`

## Global Constraints

- three.js stays pinned at `0.186.0`; `patchLightsChunk` must keep throwing if the chunk changes.
- Asset budget: `web/public/assets` ≤ 35 MB (`webexport.sizecheck --limit 35`; 32.09 MiB before this plan).
- Performance (v1 spec): ≥ 50 fps at 1080p on M1, ≤ 2M triangles, ≤ 250 draw calls.
- No rebake in Stage A. Stage B only on the user's go-ahead. Blender is driven through the open MCP session, never headless.
- Visual checks happen in a real, visible Chrome tab (lesson from v1), not headless.
- Style tokens: `--navy #010532`, `--white #FFFFFF`, `--muted #5F6369` / white 60 %, `--green #00D246`, `--blue #1480DB` / `#3860BE`, `--sand #EFE3C8`.
- Headings: `font-family: "Aktiv Grotesk", "Archivo", sans-serif`, weight 900, UPPERCASE, line-height ≈ 1.1. Body: same stack at 400.
- Font change from spec (user supplied `AktivGrotesk_Blk.woff2`, 2026-09-25): it is served from `web/public/fonts/` as `@font-face "Aktiv Grotesk"` weight 900, and is **gitignored** (licensed font, not redistributed); Archivo from Google Fonts stays the fallback and the body face.
- No Aramco logo file: the wordmark is text.
- No prices, cart, checkout, backend, accounts. Seat numbering stays invented.
- Seat link format: `?seat=<section>-<row>-<seat>` (same as `sections.json` `view.seat`).

## Deviations from the spec (decided while planning)

- **Font:** the real Aktiv Grotesk Black is used (user supplied the woff2), gitignored; Archivo stays fallback and body face.
- **Hover/click picking:** one method at all distances: raycast the section strips (always raycastable, even where seats are drawn), then take the seat of that section nearest the ray. A CPU raycast of up to 25k seat instances (600k triangles) at 20 Hz is too slow, and a per-face row index is not needed.
- **Seat view target:** 0.1 m ahead of the eye, not 1 m, so a drag turns the head instead of swinging the eye up to 2 m (`SEAT_LOOK_M`).
- **Zoom in seat view** changes the field of view (25–90°), since dolly is disabled there.
- **Capture mode** `?chrome=0` hides the UI so the 1920×1080 reference captures stay full-frame.

## Review Focus

1. A malformed or non-existent `?seat=` (e.g. `?seat=999-1-1`, `?seat=212-10`, `?seat=abc`) must open the normal overview, not throw or land nowhere. Pinned in Task 9 (parse + find) and Task 14 (boot path).
2. Zoom and Reset inside seat view must not dolly the camera out of the seat: zoom changes the field of view, Reset returns to the seat pose. Pinned in Task 12 (`zoomedPose`).
3. Auto orbit toggled while in seat view, or a lighting change in seat view, must keep the seat view. Pinned in Task 10 (reducer).
4. A seat seen through the roof, sails or concourse must not be hoverable or clickable. The existing `acceptPatchHit` test covers the rule; Task 14 applies it to hover as well as click, checked in Task 15.
5. On a phone-width window or when the sidebar collapses, the canvas must size to its stage, not to `innerWidth`, or picking NDCs drift. Task 14 sizes from the stage element; checked in Task 15.

---

## File map

| File | Change |
|---|---|
| `web/src/frameStats.ts` (+test) | new: frame mean / clipped share, shared definition with Python |
| `scripts/webexport/framestats.py` (+ `tests/webexport/test_framestats.py`) | new: same metrics for PNGs, side-by-side composer |
| `scripts/webexport/measure_roof.py` | new: roof sun factor from the day bowl lightmap |
| `web/src/stadium.ts` (+test) | specular occlusion, ENV_INTENSITY, LED AA, flood lens cap, sail night env |
| `web/src/lighting.ts` (+test) | uSoK + sail env per frame, BLOOM retune |
| `web/src/treeLight.ts` (+test) | roof shade on the sun term |
| `web/src/tiers.ts` (+test) | new: tier colours at Cycles brightness |
| `web/src/seats.ts`, `sectionPatches.ts` (+tests) | tier colours, no availability, seat highlight |
| `web/src/availability.ts` (+test) | deleted |
| `web/src/loader.ts` (+test) | lightmap mip filtering |
| `scripts/optimize_web.sh` | lightmap mips |
| `web/src/seatsData.ts` (+test) | SeatRef, `?seat=` parse/format, SeatDirectory, sectionsOfTier |
| `web/src/state.ts` (+test) | overview/seat reducer |
| `web/src/flyto.ts` (+test) | `seatViewPose`, drop `sectionFraming` |
| `web/src/seatPick.ts` (+test) | new: ray → nearest seat |
| `web/src/camera.ts` (+test) | look mode, zoom, auto orbit, flight duration |
| `web/src/heroViews.ts` (+test) | new: "Views worth exploring" + mode bar data |
| `web/src/ui/theme.css`, `header.ts`, `sidebar.ts`, `controls.ts`, `tooltip.ts` | new UI |
| `web/src/ui.ts` | keep overlay/progress only |
| `web/src/style.css` | deleted (moved into `ui/theme.css`) |
| `web/index.html`, `web/src/main.ts` | new layout and wiring |
| `docs/superpowers/reports/2026-09-25-v2-visual-check.md` | Stage A + UI report |

---

### Task 1: Frame metrics and the v1 baseline

**Files:**
- Create: `web/src/frameStats.ts`, `web/src/frameStats.test.ts`
- Create: `scripts/webexport/framestats.py`, `tests/webexport/test_framestats.py`
- Modify: `requirements-dev.txt` (add `pillow`), `web/src/main.ts` (viewer hooks `stats`, `save`, `nudge`)
- Create: `docs/superpowers/reports/2026-09-25-v2-visual-check.md` (baseline section)

**Interfaces:**
- Produces: `imageStats(px, w, h, box?, bottomUp?) → { mean: number; clipped: number }`, `type Box = { x0; y0; x1; y1 }` (fractions, top-left origin), `CLIP = 250`. Python `image_stats(rgb, box=(0,0,1,1)) → {"mean","clipped"}`, CLI `python -m webexport.framestats stats <png>... [--box x0,y0,x1,y1]` and `... pair <ref> <web> <out.jpg>`. Viewer hooks `__viewer.stats(box?)`, `__viewer.save(name)`, `__viewer.nudge(metres)`.

- [ ] **Step 1: Write the failing TS test** — `web/src/frameStats.test.ts`

```ts
import { expect, it } from "vitest";
import { imageStats, CLIP } from "./frameStats";

// 2x2 RGBA, top-left origin: white, black / red, (CLIP,0,0)
const px = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, CLIP, 0, 0, 255]);
it("mean Rec.709 luma and clipped share over the frame", () => {
  const s = imageStats(px, 2, 2);
  expect(s.mean).toBeCloseTo((255 + 0 + 0.2126 * 255 + 0.2126 * CLIP) / 4, 6);
  expect(s.clipped).toBe(0.75);
});
it("a box selects a region; bottom-up buffers (readPixels) are flipped", () => {
  expect(imageStats(px, 2, 2, { x0: 0, y0: 0, x1: 0.5, y1: 0.5 })).toEqual({ mean: 255, clipped: 1 });
  const flipped = new Uint8Array([...px.slice(8), ...px.slice(0, 8)]);
  expect(imageStats(flipped, 2, 2, { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, true)).toEqual({ mean: 255, clipped: 1 });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `cd web && npx vitest run src/frameStats.test.ts` → "Failed to resolve import ./frameStats".

- [ ] **Step 3: Implement** — `web/src/frameStats.ts`

```ts
/**
 * Frame metrics for the v2 visual check, same definition as scripts/webexport/framestats.py: 8-bit sRGB
 * pixels, mean Rec.709 luma (0..255), and the share of pixels whose largest channel is >= CLIP.
 */
export interface Box { x0: number; y0: number; x1: number; y1: number }   // fractions, top-left origin
export const CLIP = 250;
const FULL: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };

export function imageStats(px: ArrayLike<number>, w: number, h: number, box: Box = FULL, bottomUp = false) {
  const X0 = Math.floor(box.x0 * w), X1 = Math.ceil(box.x1 * w), Y0 = Math.floor(box.y0 * h), Y1 = Math.ceil(box.y1 * h);
  let sum = 0, clipped = 0, n = 0;
  for (let y = Y0; y < Y1; y++) {
    const row = bottomUp ? h - 1 - y : y;
    for (let x = X0; x < X1; x++, n++) {
      const o = (row * w + x) * 4, r = px[o], g = px[o + 1], b = px[o + 2];
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (Math.max(r, g, b) >= CLIP) clipped++;
    }
  }
  return { mean: n ? sum / n : 0, clipped: n ? clipped / n : 0 };
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Python twin, failing test first** — add `pillow` to `requirements-dev.txt`, run `.venv/bin/python -m pip install -r requirements-dev.txt`. Then `tests/webexport/test_framestats.py`:

```python
import numpy as np
from webexport.framestats import image_stats, CLIP


def test_matches_the_ts_definition():
    rgb = np.array([[[255, 255, 255], [0, 0, 0]], [[255, 0, 0], [CLIP, 0, 0]]], dtype=np.uint8)
    s = image_stats(rgb)
    assert abs(s["mean"] - (255 + 0.2126 * 255 + 0.2126 * CLIP) / 4) < 1e-9
    assert s["clipped"] == 0.75
    assert image_stats(rgb, (0, 0, 0.5, 0.5)) == {"mean": 255.0, "clipped": 1.0}
```

Run `.venv/bin/python -m pytest tests/webexport/test_framestats.py -q` → FAIL (module missing).

- [ ] **Step 6: Implement** — `scripts/webexport/framestats.py`

```python
"""Frame metrics, twin of web/src/frameStats.ts: 8-bit sRGB, mean Rec.709 luma, clipped = max channel >= CLIP.

    python -m webexport.framestats stats a.png b.png [--box x0,y0,x1,y1]
    python -m webexport.framestats pair ref.png web.png out.jpg      # side by side, ref left
"""
import json
import math
import sys

import numpy as np
from PIL import Image

CLIP = 250


def image_stats(rgb, box=(0, 0, 1, 1)):
    h, w = rgb.shape[:2]
    x0, y0, x1, y1 = box
    a = rgb[math.floor(y0 * h):math.ceil(y1 * h), math.floor(x0 * w):math.ceil(x1 * w), :3].astype(np.float64)
    luma = a @ np.array([0.2126, 0.7152, 0.0722])
    return {"mean": float(luma.mean()), "clipped": float((a.max(axis=2) >= CLIP).mean())}


def load(path):
    return np.asarray(Image.open(path).convert("RGB"))


def pair(ref, web, out, height=540):
    ims = [Image.open(p).convert("RGB") for p in (ref, web)]
    ims = [im.resize((round(im.width * height / im.height), height)) for im in ims]
    canvas = Image.new("RGB", (sum(im.width for im in ims), height))
    canvas.paste(ims[0], (0, 0))
    canvas.paste(ims[1], (ims[0].width, 0))
    canvas.save(out, quality=88)


def main(argv):
    if argv[0] == "pair":
        return pair(*argv[1:4])
    box = (0, 0, 1, 1)
    if "--box" in argv:
        i = argv.index("--box")
        box = tuple(float(v) for v in argv[i + 1].split(","))
        argv = argv[:i] + argv[i + 2:]
    for p in argv[1:]:
        print(json.dumps({"file": p, **image_stats(load(p), box)}))


if __name__ == "__main__":
    main(sys.argv[1:])
```

Run the pytest again → PASS.

- [ ] **Step 7: Viewer hooks** — in `web/src/main.ts`, import `imageStats, type Box` from `./frameStats` and `toThree` from `./coords`, and extend the `exposeViewerHooks({...})` object:

```ts
    /** Task 1: metrics of the next rendered frame (drawing buffer is read in the same task as the render). */
    stats: (box?: Box) => {
      frame(0);
      renderer.setRenderTarget(null);
      const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return imageStats(px, w, h, box, true);
    },
    /** Downloads the next frame as <name>.png (toBlob snapshots the bitmap at call time). */
    save: (name: string) => {
      frame(0);
      renderer.domElement.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b!); a.download = `${name}.png`; a.click(); });
    },
    /** Camera-nudge test: moves eye and target sideways (camera right) by `m` metres. */
    nudge: (m: number) => {
      const p = rig.pose(), right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(m);
      const off = toBlender(right);
      rig.jump({ eye: p.eye.map((v, k) => v + off[k]) as V3, target: p.target.map((v, k) => v + off[k]) as V3, hfov: p.hfov });
    },
```

(`import type { V3 } from "./coords"`.) Run `cd web && npm run build` → passes.

- [ ] **Step 8: Record the v1 baseline.** Start `cd web && npx vite --port 5173 --strictPort` (background). In a visible Chrome tab, for each `CAM ∈ {CAM_Aerial_Dusk, CAM_Approach, CAM_Seat_212}` × `state ∈ {day, golden, night}` open `http://localhost:5173/?cam=<CAM>&state=<state>&size=1920x1080`, wait for the overlay to hide plus ~3 s, then run in the page `JSON.stringify(__viewer.stats())` and `__viewer.save("v1_<CAM>_<state>")`. Move the downloads to `renders/web_v2/` (gitignored). Refs: `.venv/bin/python -m webexport.framestats stats renders/ref_web/*.png` (with `PYTHONPATH=scripts`). Nudge test at `CAM_Aerial_Dusk&state=night`: `__viewer.stats()` → `__viewer.nudge(1.8)` → `__viewer.stats()`; save both frames (`v1_nudge_a`, `v1_nudge_b`). Record the clipped share of each frame; the popping metric is `|clippedA − clippedB| / max(clippedA, clippedB)`.

- [ ] **Step 9: Report skeleton** — create `docs/superpowers/reports/2026-09-25-v2-visual-check.md` with a "Method" section (the commands above), and a "v1 baseline" table: `Camera | State | Cycles mean | web mean | ratio | Cycles clipped | web clipped`, plus the nudge row.

- [ ] **Step 10: Commit**

```bash
git add web/src/frameStats.ts web/src/frameStats.test.ts web/src/main.ts scripts/webexport/framestats.py tests/webexport/test_framestats.py requirements-dev.txt docs/superpowers/reports/2026-09-25-v2-visual-check.md
git commit -m "Web viewer v2: frame metrics (TS + Python twin), capture hooks, v1 baseline"
```

---

### Task 2: A1 lightmap-occluded reflections

**Files:**
- Modify: `web/src/stadium.ts` (`PARS`, `patchLightsChunk`, `SharedUniforms`, new `SPEC_OCC`, `specOccK`)
- Modify: `web/src/lighting.ts` (`Lighting.update` sets `uSoK`), `web/src/main.ts` (shared uniform init)
- Test: `web/src/stadium.test.ts`

**Interfaces:**
- Produces: `SPEC_OCC = { k: { day, golden, night }, min }`, `specOccK(n: number): number`, `SharedUniforms.uSoK: { value: number }`.

- [ ] **Step 1: Failing tests** — append to `web/src/stadium.test.ts` (and add `SPEC_OCC, specOccK` to the import):

```ts
it("A1: sky and clear-coat reflections are scaled by the lightmap specular occlusion", () => {
  const out = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
  expect(out).toContain("float lmSo = lmSpecOcc( lightMapIrradiance );");
  expect(out).toMatch(/vec3 iblRadiance = mix\([^;]*uEnvBlend \) \* lmSo;/);
  expect(out).toMatch(/clearcoatRadiance \+= mix\([^;]*uEnvBlend \) \* lmSo;/);
  // lmSo exists even without a lightmap (fallback path compiles)
  expect(out).toMatch(/#else\s*float lmSo = 1\.0;/);
});
it("A1: the occlusion scale K follows the lighting state", () => {
  expect(specOccK(0)).toBe(SPEC_OCC.k.day);
  expect(specOccK(0.6)).toBeCloseTo(SPEC_OCC.k.golden, 9);
  expect(specOccK(1)).toBe(SPEC_OCC.k.night);
  expect(specOccK(0.3)).toBeCloseTo((SPEC_OCC.k.day + SPEC_OCC.k.golden) / 2, 9);
  expect(SPEC_OCC.min).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run** `cd web && npx vitest run src/stadium.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `web/src/stadium.ts`:

```ts
import { STATE_NIGHT } from "./lightingState";

/**
 * A1 (v2): specular occlusion from the baked light. The PMREM sky reaches every surface, so the sail skin
 * (metal 0.9 + coat), concourse glass and grass mirrored a bright sky even in shade: the main cause of
 * the washed-out day look. so = clamp( luminance( lightmap irradiance ) / K, min, 1 ). Irradiance is in
 * the bake's units (W/m^2, decoded RGBM x PI): day sunlit ground ~3, golden ~1.5, night floods ~1.1 in
 * the bowl. K is the irradiance at which a surface gets its full reflection. Tuned in Task 8.
 */
export const SPEC_OCC = { k: { day: 2.0, golden: 1.0, night: 1.2 }, min: 0.1 };
export function specOccK(n: number) {
  const g = STATE_NIGHT.golden;
  return n <= g ? SPEC_OCC.k.day + (SPEC_OCC.k.golden - SPEC_OCC.k.day) * (n / g)
                : SPEC_OCC.k.golden + (SPEC_OCC.k.night - SPEC_OCC.k.golden) * ((n - g) / (1 - g));
}
```

In `patchLightsChunk` change the two radiance replacements to:

```ts
    .replace(IBL_RAD_RE, `#ifdef USE_LIGHTMAP
		float lmSo = lmSpecOcc( lightMapIrradiance );
	#else
		float lmSo = 1.0;
	#endif
	vec3 iblRadiance = mix( getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ), getIBLRadianceB( geometryViewDir, geometryNormal, material.roughness ), uEnvBlend ) * lmSo;`)
    .replace(COAT_RAD_RE, `clearcoatRadiance += mix( getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ), getIBLRadianceB( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ), uEnvBlend ) * lmSo;`);
```

(`lightMapIrradiance` is declared at function scope inside `#ifdef USE_LIGHTMAP` in three r186's chunk, so it is visible in the specular block.) Add to `PARS`, after `rgbmDecode`:

```ts
uniform float uSoK;
float lmSpecOcc( vec3 e ) { return clamp( dot( e, vec3( 0.2126, 0.7152, 0.0722 ) ) / uSoK, ${SPEC_OCC.min.toFixed(3)}, 1.0 ); }
```

(`PARS` becomes a template literal that references `SPEC_OCC`; declare `SPEC_OCC` above it.) Add `uSoK: { value: number }` to `SharedUniforms`.

- [ ] **Step 4: Wire** — `web/src/main.ts` shared init gets `uSoK: { value: specOccK(0) }` (import `specOccK`); `web/src/lighting.ts` `update()` after `this.shared.uNight.value = n;` adds `this.shared.uSoK.value = specOccK(n);`. Fix any other `SharedUniforms` literal (`grep -rn "uRgbmRange: {" web/src`).

- [ ] **Step 5: Run** `cd web && npx vitest run && npm run build` → all PASS.

- [ ] **Step 6: Smoke check** — reload `?cam=CAM_Approach&state=day&size=1920x1080` in the visible tab; no shader errors in the console (`read_console_messages`, pattern `THREE|error`), sails visibly less silver. Record `__viewer.stats()` in the report as "after A1".

- [ ] **Step 7: Commit** — `git commit -am "Web viewer v2 A1: lightmap specular occlusion on sky and clear-coat reflections"` (add the new/changed files explicitly if `-a` misses any).

---

### Task 3: A2 reflection strength per material, A5 night sails

**Files:**
- Modify: `web/src/stadium.ts` (`ENV_INTENSITY`, `envIntensityOf`, `SAIL_RE`, `SAIL_NIGHT_ENV`, `sailEnvIntensity`; `setupStadiumMaterials` uses the table)
- Modify: `web/src/lighting.ts` (sail env per frame)
- Test: `web/src/stadium.test.ts`

**Interfaces:**
- Produces: `envIntensityOf(name: string): number | undefined`, `sailEnvIntensity(n: number): number`, `SAIL_RE = /^M_SailSkin\b/`.

- [ ] **Step 1: Check real material names** — `cd web && npx --yes @gltf-transform/cli@4.5.0 inspect public/assets/stadium.glb 2>/dev/null | grep -oE "M_(Steel|Grass|ConcourseGlass|SuiteGlass|FloodLens|SailSkin)[A-Za-z0-9_.]*" | sort -u`. The regexes below must match these names (they carry a `.web` suffix, e.g. `M_Grass.web`); adjust the regexes if the output differs.

- [ ] **Step 2: Failing tests** — in `web/src/stadium.test.ts`, replace the "ground materials by name" test with:

```ts
it("A2: reflection strength by material name; unlisted materials keep 1", () => {
  for (const m of ["M_Sand.web", "M_Lawn.web", "M_Asphalt.web", "M_Paving.web", "M_Plaza.web"]) expect(envIntensityOf(m)).toBe(GROUND_ENV);
  expect(envIntensityOf("M_ConcourseGlass.web")).toBe(0.3);
  expect(envIntensityOf("M_SuiteGlass.web")).toBe(0.3);
  expect(envIntensityOf("M_Grass.web")).toBe(0.2);
  expect(envIntensityOf("M_Steel.web")).toBe(0.5);
  expect(envIntensityOf("M_SailSkin.web")).toBeUndefined();
  expect(envIntensityOf("M_GrassX.web")).toBeUndefined();
});
it("A5: sail reflections fade toward SAIL_NIGHT_ENV at night", () => {
  expect(sailEnvIntensity(0)).toBe(1);
  expect(sailEnvIntensity(1)).toBeCloseTo(SAIL_NIGHT_ENV, 9);
  expect(SAIL_RE.test("M_SailSkin.web")).toBe(true);
});
```

Import `envIntensityOf, GROUND_ENV, sailEnvIntensity, SAIL_NIGHT_ENV, SAIL_RE` (drop `GROUND_RE` from the import if unused). Run → FAIL.

- [ ] **Step 3: Implement** in `web/src/stadium.ts` (below `GROUND_ENV`):

```ts
/**
 * A2 (v2): sky reflection strength per material, first match wins (envMapIntensity scales the PMREM
 * sample and the clear coat alike). Glass mirrored the ~3.6 horizon (podium mean 202 web vs 97 Cycles),
 * grass had full sky sheen. Tuned in Task 8.
 */
export const ENV_INTENSITY: [RegExp, number][] = [
  [GROUND_RE, GROUND_ENV],
  [/^M_(ConcourseGlass|SuiteGlass)\b/, 0.3],
  [/^M_Grass\b/, 0.2],
  [/^M_Steel\b/, 0.5],
];
export const envIntensityOf = (name: string) => ENV_INTENSITY.find(([re]) => re.test(name))?.[1];

export const SAIL_RE = /^M_SailSkin\b/;
/** A5 (v2): sail skin reflection at night (Cycles shows dark skin with LEDs, the web mirrored the dusk sky). Tuned in Task 8. */
export const SAIL_NIGHT_ENV = 0.5;
export const sailEnvIntensity = (n: number) => 1 + (SAIL_NIGHT_ENV - 1) * n;
```

In `setupStadiumMaterials` replace `if (GROUND_RE.test(mat.name)) mat.envMapIntensity = GROUND_ENV;` with:

```ts
    const env = envIntensityOf(mat.name);
    if (env !== undefined) mat.envMapIntensity = env;
```

and in the first traverse use `SAIL_RE.test(m.name)` instead of `m.name.startsWith("M_SailSkin")`.

- [ ] **Step 4: Lighting** — in `web/src/lighting.ts` import `SAIL_RE, sailEnvIntensity` (value import from `./stadium`; `stadium.ts` imports nothing from `lighting.ts`, so no cycle). Add a field `private sails: THREE.MeshStandardMaterial[]` set in the constructor: `this.sails = [...groups.values()].flat().filter((m) => SAIL_RE.test(m.name));` and in `update()` after `uSoK`: `for (const m of this.sails) m.envMapIntensity = sailEnvIntensity(n);`.

- [ ] **Step 5: Run** `cd web && npx vitest run && npm run build` → PASS.

- [ ] **Step 6: Commit** — `git commit -am "Web viewer v2 A2/A5: per-material reflection strength, night sail reflections"`

---

### Task 4: A3 anti-aliased sail LEDs

**Files:**
- Modify: `web/src/stadium.ts` (`LED_GLSL`, `LED_COVER`, `LED_MAX`, emissive patch)
- Test: `web/src/stadium.test.ts`

**Interfaces:**
- Produces: `LED_COVER` (mean dot coverage of a surface), `LED_MAX` (radiance clamp, < `BLOOM.threshold`).

- [ ] **Step 1: Failing tests** — append (import `LED_GLSL, LED_COVER, LED_MAX` from `./stadium`, `BLOOM` from `./lighting`):

```ts
it("A3: LED dots are pixel-footprint aware, never a hard step", () => {
  expect(LED_GLSL).toContain("fwidth( pB )");
  expect(LED_GLSL).not.toMatch(/step\( length\(/);
  expect(LED_GLSL).toContain(LED_COVER.toExponential(4));
});
it("A3: a plane crosses r=0.055 m dots in 1.1 m cells over (4/3) pi r^3 / 1.1^3 of its area", () => {
  expect(LED_COVER).toBeCloseTo((4 / 3) * Math.PI * 0.055 ** 3 / 1.1 ** 3, 12);
});
it("A3: LED radiance stays below the bloom threshold, so single LEDs never bloom", () => {
  expect(LED_MAX).toBeLessThan(BLOOM.threshold);
});
```

(The coverage value was checked by Monte Carlo over random planes against the shader's hash while writing this plan: 5.26e-4 horizontal, 5.05e-4 vertical, 5.24e-4 analytic.) Run → FAIL.

- [ ] **Step 2: Implement** — replace `LED_GLSL` in `web/src/stadium.ts`:

```ts
/** A3 (v2): mean share of a surface covered by the LED dots (sphere r in a cell s: (4/3) pi r^3 / s^3). */
export const LED_COVER = (4 / 3) * Math.PI * 0.055 ** 3 / 1.1 ** 3;
/** A3 (v2): LED radiance clamp, below BLOOM.threshold (lighting.ts), so no LED blooms on its own. */
export const LED_MAX = 10.0;

/**
 * Decision D7: sail LED points (shell._skin_material): 1.1 m cells, r = 0.055 m, fade 36..50 m, 40 * n.
 * A3 (v2): the 5.5 cm dots are far below a pixel from most views, so a hard step hit or missed each dot
 * per frame and each hit bloomed ("lights re-render" when the camera moved). The dot now grows to the
 * pixel footprint with its radiance scaled to keep its energy ((r0/r)^3, the plane's mean cut through a
 * sphere), edges are smoothstepped over one pixel, and once a pixel spans about a cell it fades to the
 * cells' mean radiance: LED_COVER x lit share (1 - fade) x mean brightness 1.05.
 */
export const LED_GLSL = /* glsl */ `
vec3 h33( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.xxy + p.yxx ) * p.zyx ); }
float sailLeds( vec3 pB ) {
  vec3 c = floor( pB / 1.1 ), h = h33( c ), q = ( c + h ) * 1.1;
  float fade = mix( 0.55, 1.01, clamp( ( pB.z - 36.0 ) / 14.0, 0.0, 1.0 ) );
  float lit = step( fade, h.x ) * ( h.y * 1.5 + 0.3 );
  float px = max( length( fwidth( pB ) ), 1e-5 );
  float r = max( 0.055, 0.5 * px );
  float k = 0.055 / r;
  float dot_ = ( 1.0 - smoothstep( r - 0.5 * px, r + 0.5 * px, length( pB - q ) ) ) * k * k * k;
  float avg = ${LED_COVER.toExponential(4)} * max( 1.0 - fade, 0.0 ) * 1.05;
  return mix( dot_ * lit, avg, smoothstep( 0.3, 0.9, px / 1.1 ) );
}
`;
```

and change the emissive replacement in `setupStadiumMaterials` to:

```ts
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance = min( totalEmissiveRadiance * sailLeds( vWorldPosB ), vec3( " + LED_MAX.toFixed(2) + " ) );");
```

- [ ] **Step 3: Run** `cd web && npx vitest run && npm run build` → PASS.

- [ ] **Step 4: Nudge check** — in the visible tab at `?cam=CAM_Aerial_Dusk&state=night&size=1920x1080` repeat the Task 1 nudge test; the popping metric must drop well below the v1 value (target: under a fifth of it). Save `v2a3_nudge_a/b`, compare both frames with `Read` for LED speckle that appears/disappears. Record in the report.

- [ ] **Step 5: Commit** — `git commit -am "Web viewer v2 A3: footprint-aware sail LEDs, radiance clamped below bloom"`

---

### Task 5: A4 flood lens cap

**Files:**
- Modify: `web/src/stadium.ts` (`FLOOD_LENS_RE`, `FLOOD_LENS_MAX`, setup)
- Test: `web/src/stadium.test.ts`

**Interfaces:**
- Produces: `FLOOD_LENS_MAX`. Consumes `setupStadiumMaterials(root, shared, useLightmaps)` (existing).

- [ ] **Step 1: Failing test** — append (import `setupStadiumMaterials, FLOOD_LENS_MAX, specOccK`):

```ts
it("A4: flood lens night emission is capped and the lens is single-sided", () => {
  const root = new THREE.Group();
  const lens = new THREE.MeshStandardMaterial({ name: "M_FloodLens.web", side: THREE.DoubleSide });
  lens.userData = { emDay: 0, emNight: 120 };
  const other = new THREE.MeshStandardMaterial({ name: "M_Glow.web" });
  other.userData = { emDay: 0, emNight: 120 };
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), lens), new THREE.Mesh(new THREE.BufferGeometry(), other));
  const shared = { uLmBlend: { value: 0 }, uEnvB: { value: null }, uEnvBlend: { value: 0 }, uRgbmRange: { value: 16 }, uNight: { value: 0 }, uSoK: { value: specOccK(0) } };
  setupStadiumMaterials(root, shared, false);
  expect(lens.userData.emNight).toBe(FLOOD_LENS_MAX);
  expect(lens.side).toBe(THREE.FrontSide);
  expect(other.userData.emNight).toBe(120);
});
```

Run → FAIL.

- [ ] **Step 2: Implement** — in `web/src/stadium.ts`:

```ts
/**
 * A4 (v2): M_FloodLens emits 120 at night (glb emNight) against a bloom threshold of 12, and double-sided
 * lenses showed their backs too: a ring of halos (9 % of the roof-glow area clipped vs 3 % in Cycles).
 * The viewer caps the lens and draws its front only. Tuned in Task 8.
 */
export const FLOOD_LENS_RE = /^M_FloodLens\b/;
export const FLOOD_LENS_MAX = 30;
```

In `setupStadiumMaterials`, after the `tint` line:

```ts
    if (FLOOD_LENS_RE.test(mat.name)) {
      if (typeof ex.emNight === "number") ex.emNight = Math.min(ex.emNight, FLOOD_LENS_MAX);
      mat.side = THREE.FrontSide;
    }
```

(`main.ts` builds its emissive list after `setupStadiumMaterials`, and `Lighting` reads `userData.emNight` every frame, so the cap takes effect.)

- [ ] **Step 3: Run** `cd web && npx vitest run && npm run build` → PASS.

- [ ] **Step 4: Winding check** — at `?cam=CAM_Aerial_Dusk&state=night` and `?cam=CAM_Bowl&state=night` the lenses must still be visible from the pitch side. If they vanish, the lens faces point away from the pitch: use `THREE.BackSide` instead and change the test's expectation to match, with a comment saying why.

- [ ] **Step 5: Commit** — `git commit -am "Web viewer v2 A4: cap flood lens emission, single-sided lenses"`

---

### Task 6: A7 lightmap mipmaps

**Files:**
- Modify: `scripts/optimize_web.sh:614` (lightmaps line), `web/src/loader.ts` (`collect`)
- Test: `web/src/loader.test.ts`

**Interfaces:**
- Produces: lightmap textures with `minFilter = LinearMipmapLinearFilter` when the KTX2 file has mips.

- [ ] **Step 1: Failing test** — append to `web/src/loader.test.ts` (reuse its existing imports; add `* as THREE` and `collect`, `type Manifest` if missing):

```ts
it("A7: lightmaps with mips are sampled trilinear; single-level ones stay linear", () => {
  const withMips = new THREE.Texture(), flat = new THREE.Texture();
  withMips.mipmaps = [{}, {}, {}] as any;
  flat.mipmaps = [{}] as any;
  const m = { stadium: "s.glb", seats: "b", sections: "x", cameras: "c", trees: null, rgbmRange: 16, version: 1,
    states: { day: { night: 0, exposure: 0, env: null, lightmaps: { bowl: "a.ktx2", site: "b.ktx2" } },
              golden: { night: 0.6, exposure: 0, env: null, lightmaps: {} }, night: { night: 1, exposure: 0, env: null, lightmaps: {} } } } as Manifest;
  const a = collect(m, new Map<string, unknown>([["a.ktx2", withMips], ["b.ktx2", flat]]));
  expect(a.lightmaps.day.bowl.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  expect(a.lightmaps.day.site.minFilter).toBe(THREE.LinearFilter);
  expect(a.lightmaps.day.bowl.generateMipmaps).toBe(false);
});
```

Run → FAIL.

- [ ] **Step 2: Implement** — in `collect` after `t.channel = 1;`:

```ts
      // A7 (v2): the KTX2 lightmaps carry mips (optimize_web.sh); without them distant charts shimmered
      t.minFilter = (t.mipmaps?.length ?? 0) > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      t.generateMipmaps = false;
```

Run → PASS.

- [ ] **Step 3: Encode with mips** — `scripts/optimize_web.sh`, lightmaps case becomes:

```bash
    lightmaps/*) ktx create --format R8G8B8A8_UNORM --assign-tf linear --encode uastc --uastc-quality 2 --zstd 18 --generate-mipmap "$png" "$dst" ;;   # A7 (v2): mips; RGBM filters approximately across levels
```

- [ ] **Step 4: Rebuild assets** — `bash scripts/optimize_web.sh` (re-encodes from `build/web_raw`, no rebake; ends with the 35 MB size check). If the check fails: first raise the lightmaps' `--zstd 18` to `--zstd 22` and rerun; if still over, restrict `--generate-mipmap` to the far groups (`*/site.png`, `*/site_near.png`, `*/structure.png`) with a second case pattern above the generic one, and note it in the report.

- [ ] **Step 5: Check** — `du -sh web/public/assets`, record the size in the report. In the visible tab at `?cam=CAM_Aerial_SW&state=day`, orbit slowly: far site charts must not shimmer.

- [ ] **Step 6: Commit** — `git add scripts/optimize_web.sh web/src/loader.ts web/src/loader.test.ts && git commit -m "Web viewer v2 A7: mipmapped KTX2 lightmaps, trilinear sampling"` (assets are gitignored).

---

### Task 7: A6 tier colours at Cycles brightness, roof shade on seats

**Files:**
- Create: `web/src/tiers.ts`, `web/src/tiers.test.ts`, `scripts/webexport/measure_roof.py`
- Modify: `web/src/treeLight.ts` (`ROOF`, `oculusRadius`, `roofShade`, GLSL twin, `OUTDOOR_IRRADIANCE`), `web/src/treeLight.test.ts`
- Modify: `web/src/seats.ts`, `web/src/seats.test.ts`, `web/src/sectionPatches.ts`, `web/src/sectionPatches.test.ts`, `web/src/main.ts` (constructor calls)
- Delete: `web/src/availability.ts`, `web/src/availability.test.ts`

**Interfaces:**
- Produces: `type Tier = "Lower" | "Club" | "Upper"`, `TIERS`, `TIER_HEX: Record<Tier,string>`, `tierAlbedo(t: Tier, out?) → THREE.Color` (linear), `roofShade(x, y) → number` (Blender plan coords). `new SeatField(t, idx, sections, outdoor?)`, `new SectionPatches(t, idx, outdoor?, tierOf)`.

- [ ] **Step 1: Failing tier test** — `web/src/tiers.test.ts`:

```ts
import { expect, it } from "vitest";
import * as THREE from "three";
import { tierAlbedo, TIER_HEX, TIERS } from "./tiers";

const Y = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
it("A6: seat albedo has the tier hue at the Cycles seat's luminance (bowl.py M_Seat / M_SeatClub)", () => {
  expect(Y(tierAlbedo("Lower"))).toBeCloseTo(0.2126 * 0.03 + 0.7152 * 0.22 + 0.0722 * 0.12, 6);
  expect(Y(tierAlbedo("Upper"))).toBeCloseTo(0.2126 * 0.03 + 0.7152 * 0.22 + 0.0722 * 0.12, 6);
  expect(Y(tierAlbedo("Club"))).toBeCloseTo(0.2126 * 0.72 + 0.7152 * 0.66 + 0.0722 * 0.55, 6);
  for (const t of TIERS) {   // same hue as the UI swatch
    const a = tierAlbedo(t).getHSL({ h: 0, s: 0, l: 0 }), b = new THREE.Color(TIER_HEX[t]).getHSL({ h: 0, s: 0, l: 0 });
    expect(a.h).toBeCloseTo(b.h, 3);
  }
});
```

Run → FAIL.

- [ ] **Step 2: Implement** — `web/src/tiers.ts`:

```ts
import * as THREE from "three";

export type Tier = "Lower" | "Club" | "Upper";
export const TIERS: Tier[] = ["Lower", "Club", "Upper"];
/** UI swatches, aramcostadium.com tokens (spec part 2). */
export const TIER_HEX: Record<Tier, string> = { Lower: "#00D246", Club: "#EFE3C8", Upper: "#1480DB" };

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Linear albedo luminance of the Cycles seats (scripts/stadium/bowl.py): M_Seat (Lower, Upper), M_SeatClub. */
const TIER_LUMA: Record<Tier, number> = { Lower: luma(0.03, 0.22, 0.12), Club: luma(0.72, 0.66, 0.55), Upper: luma(0.03, 0.22, 0.12) };

/** A6 (v2): the tier's swatch hue at the Cycles seat brightness, in the linear working space. */
export function tierAlbedo(t: Tier, out = new THREE.Color()) {
  out.set(TIER_HEX[t]);
  return out.multiplyScalar(TIER_LUMA[t] / luma(out.r, out.g, out.b));
}
```

Run → PASS.

- [ ] **Step 3: Failing roof-shade test** — append to `web/src/treeLight.test.ts` (import `roofShade, ROOF, OUTDOOR_IRRADIANCE, ROOF_GLSL`):

```ts
it("A6: sun on seats is scaled under the roof only", () => {
  expect(roofShade(0, 0)).toBeCloseTo(1, 6);          // pitch centre, under the oculus
  expect(roofShade(0, -90)).toBeCloseTo(ROOF.sun, 6); // upper tier, south, under the roof (oculus b = 63 m)
  expect(roofShade(0, -300)).toBeCloseTo(1, 6);       // outside the shell (trees)
  expect(OUTDOOR_IRRADIANCE).toContain("roofShade( vFloodPos )");
  expect(ROOF_GLSL).toContain(ROOF.a.toFixed(1));
});
```

Run → FAIL.

- [ ] **Step 4: Implement** in `web/src/treeLight.ts`:

```ts
/**
 * A6 (v2): seats and section patches are not lightmapped, so they took the full sun under the roof too
 * (bright near seats in the day frames). Under the roof, i.e. inside the shell plan (floodMask) and outside
 * the oculus superellipse (scripts/stadium/params.py OCULUS_A/B/N), the sun term is scaled by `sun`,
 * measured from the day bowl lightmap by scripts/webexport/measure_roof.py (Step 5).
 */
export const ROOF = { sun: 0.25, a: 76.0, b: 63.0, n: 2.35 };
export const oculusRadius = (x: number, y: number) => (Math.abs(x / ROOF.a) ** ROOF.n + Math.abs(y / ROOF.b) ** ROOF.n) ** (1 / ROOF.n);
export function roofShade(x: number, y: number) {
  const open = 1 - THREE.MathUtils.smoothstep(oculusRadius(x, y), 0.97, 1.03);
  return THREE.MathUtils.lerp(1, THREE.MathUtils.lerp(ROOF.sun, 1, open), floodMask(x, y));
}
/** GLSL twin of roofShade (three world position: plan is x, -z; abs() makes the sign moot). Needs FLOOD_GLSL. */
export const ROOF_GLSL = /* glsl */ `
float roofShade( vec3 w ) {
  float r = pow( pow( abs( w.x / ${ROOF.a.toFixed(1)} ), ${ROOF.n.toFixed(2)} ) + pow( abs( w.z / ${ROOF.b.toFixed(1)} ), ${ROOF.n.toFixed(2)} ), ${(1 / ROOF.n).toFixed(6)} );
  float open = 1.0 - smoothstep( 0.97, 1.03, r );
  return mix( 1.0, mix( ${ROOF.sun.toFixed(4)}, 1.0, open ), floodMask( w ) );
}`;
```

Change `OUTDOOR_IRRADIANCE`'s first line to `"irradiance += PI * uAmbient + uSun * max( dot( geometryNormal, uSunDirView ), 0.0 ) * roofShade( vFloodPos );\n"` and in `patchOutdoorLight` append `ROOF_GLSL` after `FLOOD_GLSL` in the fragment `#include <common>` replacement. Run → PASS.

- [ ] **Step 5: Measure ROOF.sun** — `scripts/webexport/measure_roof.py`:

```python
"""A6 (v2): sun factor under the roof, from the day bowl lightmap (same method as treeLight.FLOOD).

Up-facing tier treads of bowl__M_Concrete* (raw glb, Y-up) are sampled in lightmaps/day/bowl.png (RGBM,
decoded x rgbmRange x PI as stadium.ts applies it) and split into open (inside the oculus) and roofed.
Model (treeLight.ts): E = PI * ambient + sun * N.L * shade. Prints shade for the roofed treads.

    PYTHONPATH=scripts .venv/bin/python -m webexport.measure_roof build/web_raw
"""
import json
import math
import struct
import sys

import numpy as np
from PIL import Image

OCULUS = (76.0, 63.0, 2.35)
SUN_DAY = 3.0                                           # lightingState.sunStrength(0)
SUN_ELEV = math.radians(24.0)                           # lightingState.sunToward(0)
AMB_DAY = math.pi * 0.9 * (0.2126 * 0.8 + 0.7152 * 0.87 + 0.0722)   # treeLight TREE_AMBIENT.day, luma


def glb(path):
    b = open(path, "rb").read()
    n = struct.unpack_from("<I", b, 12)[0]
    doc = json.loads(b[20:20 + n])
    return doc, b[20 + n + 8:]


def accessor(doc, binary, i):
    a = doc["accessors"][i]
    v = doc["bufferViews"][a["bufferView"]]
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a["componentType"]]
    off = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(binary, dt, a["count"] * comps, off).reshape(a["count"], comps)


def main(raw):
    doc, binary = glb(f"{raw}/stadium.glb")
    rng = json.load(open(f"{raw}/manifest.json"))["rgbmRange"]
    lm = np.asarray(Image.open(f"{raw}/lightmaps/day/bowl.png").convert("RGBA")).astype(np.float64) / 255
    H, W = lm.shape[:2]
    open_e, roof_e = [], []
    for node in doc["nodes"]:
        if "mesh" not in node or not node.get("name", "").startswith("bowl__M_Concrete"):
            continue
        for prim in doc["meshes"][node["mesh"]]["primitives"]:
            at = prim["attributes"]
            if "TEXCOORD_1" not in at:
                continue
            P, N, UV = (accessor(doc, binary, at[k]) for k in ("POSITION", "NORMAL", "TEXCOORD_1"))
            t = P + np.array(node.get("translation", [0, 0, 0]))
            up = (N[:, 1] > 0.95) & (t[:, 1] > 1.5)    # glTF Y-up: up-facing treads above 1.5 m
            px = lm[np.clip((UV[up, 1] * H).astype(int), 0, H - 1), np.clip((UV[up, 0] * W).astype(int), 0, W - 1)]
            e = (px[:, :3] * px[:, 3:4] * rng * math.pi) @ np.array([0.2126, 0.7152, 0.0722])
            x, y = t[up, 0], -t[up, 2]                 # Blender plan
            r = (np.abs(x / OCULUS[0]) ** OCULUS[2] + np.abs(y / OCULUS[1]) ** OCULUS[2]) ** (1 / OCULUS[2])
            open_e += list(e[r < 0.95])
            roof_e += list(e[r > 1.05])
    sun_h = SUN_DAY * math.sin(SUN_ELEV)
    for name, e in (("open", open_e), ("roof", roof_e)):
        print(f"{name}: n={len(e)} median={np.median(e):.3f} mean={np.mean(e):.3f}")
    print(f"model open E = {AMB_DAY + sun_h:.3f}; shade = {(np.median(roof_e) - AMB_DAY) / sun_h:.3f}")


if __name__ == "__main__":
    main(sys.argv[1])
```

Run it. If the node names differ (no hits), list them with `python -c` over `doc["nodes"]` and fix the prefix. If the computed shade is below 0 (the roof also cuts the sky ambient), clamp `ROOF.sun` to 0.1 and note that the ambient under the roof is also too high; record the numbers in the report either way. Set `ROOF.sun` to the printed shade (clamped to [0.1, 1]) with the measured medians in the comment. Rerun `npx vitest run src/treeLight.test.ts`.

- [ ] **Step 6: Tier colours in seats and patches** — in `web/src/seats.ts` delete `SEAT_COLORS`, `seatColor` and the `Avail` import; the constructor becomes `constructor(private t: SeatTable, private idx: Map<number, { start: number; end: number }>, sections: Section[], outdoor?: OutdoorUniforms)`, and the colour line `this.mesh.setColorAt(i, tierAlbedo(this.tierOf.get(t.section[i]) as Tier, c));` (import `tierAlbedo, type Tier` from `./tiers`; type `tierOf` as `Map<number, Tier>`). In `web/src/sectionPatches.ts` delete `GREEN/GREY/CREAM`, `patchColor` and the `Avail` import; the constructor becomes `constructor(t, idx, outdoor?: OutdoorUniforms, tierOf: (id: number) => Tier | undefined = () => undefined)` and colours with `tierAlbedo(tierOf(id) ?? "Lower", c)`. Delete `availability.ts` and its test. In `main.ts` drop `mockAvailability` and pass the new arguments: `new SeatField(table, idx, a.sections.sections, lighting.outdoor)` and `new SectionPatches(table, idx, lighting.outdoor, (id) => tierOf.get(id))` with `tierOf: Map<number, Tier>`.

- [ ] **Step 7: Update tests** — `web/src/seats.test.ts`: remove the "colours by tier and availability" test and `seatColor, SEAT_COLORS` from the import. Replace `web/src/sectionPatches.test.ts` with:

```ts
import { expect, it } from "vitest";
import { SectionPatches } from "./sectionPatches";
import { tierAlbedo } from "./tiers";
import type { SeatTable } from "./seatsData";

/** Two rows x two seats in one section, 1 m apart. */
export function smallTable(section = 212): SeatTable {
  const pos = new Float32Array([0, -50, 5, 1, -50, 5, 0, -51, 5.4, 1, -51, 5.4]);
  return { count: 4, section: new Uint16Array(4).fill(section), row: new Uint8Array([1, 1, 2, 2]), seat: new Uint16Array([1, 2, 1, 2]), pos, yaw: new Float32Array(4) };
}
it("A6: patches take the tier albedo; faces map to their section", () => {
  const t = smallTable(), p = new SectionPatches(t, new Map([[212, { start: 0, end: 4 }]]), undefined, () => "Club");
  const col = p.mesh.geometry.getAttribute("color"), c = tierAlbedo("Club");
  expect([col.getX(0), col.getY(0), col.getZ(0)].map((v) => v.toFixed(5))).toEqual([c.r, c.g, c.b].map((v) => v.toFixed(5)));
  expect(p.sectionOfFace(0)).toBe(212);
  expect(p.sectionOfFace(1)).toBe(212);
  expect(p.sectionOfFace(2)).toBe(-1);
});
```

- [ ] **Step 8: Run** `cd web && npx vitest run && npm run build` → PASS (the old `ui.ts` legend still references CSS vars only, fine).

- [ ] **Step 9: Commit** — `git add -A web/src scripts/webexport/measure_roof.py && git commit -m "Web viewer v2 A6: tier seat colours at Cycles brightness, roof shade, drop mock availability"`

---

### Task 8: Stage A tuning and report

**Files:**
- Modify: constants in `web/src/stadium.ts` (`SPEC_OCC`, `ENV_INTENSITY`, `SAIL_NIGHT_ENV`, `FLOOD_LENS_MAX`), `web/src/lighting.ts` (`BLOOM`), `web/src/treeLight.ts` (`ROOF.sun` only if the frames demand it)
- Modify: `docs/superpowers/reports/2026-09-25-v2-visual-check.md`

**Interfaces:** none new. The tests pin relations (e.g. `LED_MAX < BLOOM.threshold`), not values, except where the spec gives a value (update the test when a tuned value moves).

- [ ] **Step 1: Capture all 9 pairs** — as in Task 1 Step 8, save `v2_<CAM>_<state>` and record `__viewer.stats()`. Build side-by-sides: `PYTHONPATH=scripts .venv/bin/python -m webexport.framestats pair renders/ref_web/<CAM>_<state>.png renders/web_v2/v2_<CAM>_<state>.png renders/web_v2/pair_<CAM>_<state>.jpg`. `Read` every pair.

- [ ] **Step 2: Day brightness** — target: web mean within ±15 % of Cycles on the 3 day frames. Tune in this order, one constant per iteration, recapturing the affected frame each time: `SPEC_OCC.k.day` (higher = darker reflections), then the glass/grass/steel values in `ENV_INTENSITY`. Stop at the first setting that meets the target without making shaded surfaces black in the pairs.

- [ ] **Step 3: Golden and night** — tune `SPEC_OCC.k.golden` / `.night` so the golden/night frames' means move toward Cycles (report the ratio; the ±15 % target is only for day). At `CAM_Aerial_Dusk_night`, if the sails still read silver next to the Cycles dark skin, lower `SAIL_NIGHT_ENV` (0.5 → 0.25 → 0.1).

- [ ] **Step 4: Bloom and lenses** — find the roof-glow box on `renders/ref_web/CAM_Aerial_Dusk_night.png` (the lit ring and floods; write the fractions in the report) and measure `clipped` in it for Cycles (`stats --box`) and web (`__viewer.stats({x0,y0,x1,y1})`). Target: web within ±2 points of Cycles (spec: Cycles ≈ 3 %). Tune `FLOOD_LENS_MAX` first, then `BLOOM.threshold` / `BLOOM.strength`; confirm on `CAM_Approach_night`. Keep `LED_MAX < BLOOM.threshold` (test).

- [ ] **Step 5: Seats** — at `CAM_Seat_212` day/golden, compare seat brightness next to the treads with the reference; adjust `ROOF.sun` only if the seats clearly stand out (note the change against the measured value).

- [ ] **Step 6: Nudge + performance** — nudge test at `CAM_Aerial_Dusk_night` and `CAM_Approach_night` (metric and visual). Performance: `?stats&cam=CAM_Bowl&state=night` at 1080p, record fps (`__viewer.fps`), `__viewer.info.render.triangles` and `.calls`; must meet ≥ 50 fps, ≤ 2M tris, ≤ 250 calls.

- [ ] **Step 7: Report** — fill the v2 table (same columns as the baseline, plus `pair` image path), the roof-glow numbers, nudge before/after, perf, asset size, the final constant values, and a "Remaining gaps → Stage B candidates" list (dropped columns/piers, lightmap noise/coarseness seams). End with: "Stage B (rebake, 2–5 h) awaits the user's decision."

- [ ] **Step 8: Run** `cd web && npx vitest run && npm run build` → PASS.

- [ ] **Step 9: Commit** — `git add -A web/src docs/superpowers/reports/2026-09-25-v2-visual-check.md && git commit -m "Web viewer v2: Stage A tuning against the Cycles references, report"`

---

### Task 9: Seat directory and `?seat=` links

**Files:**
- Modify: `web/src/seatsData.ts`, `web/src/seatsData.test.ts`

**Interfaces:**
- Produces: `interface SeatRef { section: number; row: number; seat: number }`, `formatSeat(r) → "212-10-4"`, `parseSeatParam(v: string | null) → SeatRef | null`, `class SeatDirectory { constructor(t, idx); rows(section): number[]; seats(section, row): number[]; find(r: SeatRef): number /* seat index or -1 */; ref(i): SeatRef; position(i): V3 }`, `sectionsOfTier(sections: Section[], tier: Tier) → number[]`.

- [ ] **Step 1: Failing tests** — append to `web/src/seatsData.test.ts`:

```ts
import { SeatDirectory, formatSeat, parseSeatParam, sectionsOfTier } from "./seatsData";
import type { Section } from "./loader";

const table = (): SeatTable => ({
  count: 5,
  section: new Uint16Array([101, 101, 101, 212, 212]),
  row: new Uint8Array([2, 1, 1, 10, 10]),
  seat: new Uint16Array([1, 7, 3, 4, 5]),
  pos: new Float32Array([0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  yaw: new Float32Array(5),
});
describe("seat directory (spec part 2: only real rows and seats are offered)", () => {
  const t = table(), dir = new SeatDirectory(t, indexSections(t));
  it("rows and seats are sorted numerically", () => {
    expect(dir.rows(101)).toEqual([1, 2]);
    expect(dir.seats(101, 1)).toEqual([3, 7]);
    expect(dir.seats(212, 10)).toEqual([4, 5]);
  });
  it("unknown section/row gives empty lists", () => {
    expect(dir.rows(999)).toEqual([]);
    expect(dir.seats(101, 9)).toEqual([]);
  });
  it("finds a seat index and back", () => {
    expect(dir.find({ section: 101, row: 1, seat: 3 })).toBe(2);
    expect(dir.ref(2)).toEqual({ section: 101, row: 1, seat: 3 });
    expect(dir.position(2)).toEqual([4, 5, 6]);
    expect(dir.find({ section: 101, row: 1, seat: 4 })).toBe(-1);
    expect(dir.find({ section: 999, row: 1, seat: 1 })).toBe(-1);
  });
});
describe("?seat= links (Review Focus 1)", () => {
  it("round trips", () => {
    const r = { section: 212, row: 10, seat: 4 };
    expect(formatSeat(r)).toBe("212-10-4");
    expect(parseSeatParam(formatSeat(r))).toEqual(r);
  });
  it("rejects malformed values", () => {
    for (const v of [null, "", "212-10", "212-10-4-1", "abc", "212-x-4", "-1-2-3", "212-10-4 "]) expect(parseSeatParam(v)).toBeNull();
  });
});
it("sections of a tier, numeric order", () => {
  const s = [{ id: "112", tier: "Lower" }, { id: "201", tier: "Club" }, { id: "101", tier: "Lower" }] as Section[];
  expect(sectionsOfTier(s, "Lower")).toEqual([101, 112]);
});
```

Run → FAIL.

- [ ] **Step 2: Implement** — append to `web/src/seatsData.ts`:

```ts
import type { V3 } from "./coords";
import type { Section } from "./loader";
import type { Tier } from "./tiers";

export interface SeatRef { section: number; row: number; seat: number }
/** `?seat=` and sections.json `view.seat` format: section-row-seat. */
export const formatSeat = (r: SeatRef) => `${r.section}-${r.row}-${r.seat}`;
export function parseSeatParam(v: string | null): SeatRef | null {
  const m = /^(\d{1,5})-(\d{1,3})-(\d{1,5})$/.exec(v ?? "");
  return m ? { section: Number(m[1]), row: Number(m[2]), seat: Number(m[3]) } : null;
}

export const sectionsOfTier = (sections: Section[], tier: Tier) =>
  sections.filter((s) => s.tier === tier).map((s) => Number(s.id)).sort((a, b) => a - b);

/** Section -> row -> seat lookups over seats.bin (seat finder option lists, links, picking). */
export class SeatDirectory {
  /** section -> row -> seat indices sorted by seat number; rows in numeric order. */
  private bySection = new Map<number, Map<number, number[]>>();
  constructor(readonly t: SeatTable, idx: Map<number, { start: number; end: number }>) {
    for (const [sec, { start, end }] of idx) {
      const rows = new Map<number, number[]>();
      for (let i = start; i < end; i++) (rows.get(t.row[i]) ?? rows.set(t.row[i], []).get(t.row[i])!).push(i);
      for (const ids of rows.values()) ids.sort((a, b) => t.seat[a] - t.seat[b]);
      this.bySection.set(sec, new Map([...rows].sort((a, b) => a[0] - b[0])));
    }
  }
  rows(section: number) { return [...(this.bySection.get(section)?.keys() ?? [])]; }
  seats(section: number, row: number) { return (this.bySection.get(section)?.get(row) ?? []).map((i) => this.t.seat[i]); }
  find(r: SeatRef) { return this.bySection.get(r.section)?.get(r.row)?.find((i) => this.t.seat[i] === r.seat) ?? -1; }
  ref(i: number): SeatRef { return { section: this.t.section[i], row: this.t.row[i], seat: this.t.seat[i] }; }
  position(i: number): V3 { return [this.t.pos[i * 3], this.t.pos[i * 3 + 1], this.t.pos[i * 3 + 2]]; }
}
```

(Move the new imports to the top of the file.) Run → PASS.

- [ ] **Step 3: Commit** — `git commit -am "Web viewer v2: seat directory and ?seat= link format"`

---

### Task 10: Overview / seat state

**Files:**
- Modify: `web/src/state.ts`, `web/src/state.test.ts`

**Interfaces:**
- Consumes: `SeatRef` (Task 9).
- Produces: `type View = { kind: "overview" } | { kind: "seat"; seat: SeatRef }`, `interface AppState { view; lighting: State; autoOrbit: boolean }`, `type Action = { type: "seat"; seat } | { type: "back" } | { type: "lighting"; lighting } | { type: "camera"; camera: string } | { type: "autoOrbit"; on: boolean } | { type: "none" }`, `sameSeat(a, b)`.

- [ ] **Step 1: Failing tests** — replace the first `describe("app state", ...)` block of `web/src/state.test.ts` with:

```ts
const A = { section: 212, row: 10, seat: 4 }, B = { section: 212, row: 10, seat: 5 };
describe("app state (v2: overview | seat)", () => {
  it("overview -> seat -> back", () => {
    let s = reduce(initialState, { type: "seat", seat: A });
    expect(s.view).toEqual({ kind: "seat", seat: A });
    s = reduce(s, { type: "back" });
    expect(s.view).toEqual({ kind: "overview" });
  });
  it("another seat re-targets; the same seat again is a no-op", () => {
    const s = reduce(initialState, { type: "seat", seat: A });
    expect(reduce(s, { type: "seat", seat: B }).view).toEqual({ kind: "seat", seat: B });
    expect(reduce(s, { type: "seat", seat: { ...A } })).toBe(s);
  });
  it("empty-space click and back from overview change nothing", () => {
    expect(reduce(initialState, { type: "none" })).toBe(initialState);
    expect(reduce(initialState, { type: "back" })).toBe(initialState);
  });
  it("lighting keeps the seat view (Review Focus 3)", () => {
    const s = reduce(reduce(initialState, { type: "seat", seat: A }), { type: "lighting", lighting: "night" });
    expect(s.lighting).toBe("night");
    expect(s.view.kind).toBe("seat");
  });
  it("a named camera goes to overview, stops auto orbit, and re-flies even if repeated", () => {
    const s = reduce(reduce(initialState, { type: "autoOrbit", on: true }), { type: "camera", camera: "CAM_Top" });
    expect(s.view.kind).toBe("overview");
    expect(s.autoOrbit).toBe(false);
    expect(reduce(s, { type: "camera", camera: "CAM_Top" })).not.toBe(s);
  });
  it("auto orbit only in overview (Review Focus 3); choosing a seat stops it", () => {
    const seat = reduce(initialState, { type: "seat", seat: A });
    expect(reduce(seat, { type: "autoOrbit", on: true })).toBe(seat);
    const orbit = reduce(initialState, { type: "autoOrbit", on: true });
    expect(orbit.autoOrbit).toBe(true);
    expect(reduce(orbit, { type: "autoOrbit", on: true })).toBe(orbit);
    expect(reduce(orbit, { type: "seat", seat: A }).autoOrbit).toBe(false);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement** — `web/src/state.ts`:

```ts
import { STATES, type State } from "./loader";
import type { SeatRef } from "./seatsData";

export type View = { kind: "overview" } | { kind: "seat"; seat: SeatRef };
export interface AppState { view: View; lighting: State; autoOrbit: boolean }
export type Action =
  | { type: "seat"; seat: SeatRef }
  | { type: "back" }
  | { type: "lighting"; lighting: State }
  | { type: "camera"; camera: string }      // a hero view or a mode-bar camera
  | { type: "autoOrbit"; on: boolean }
  | { type: "none" };

export const initialState: AppState = { view: { kind: "overview" }, lighting: "golden", autoOrbit: false };
export const sameSeat = (a: SeatRef, b: SeatRef) => a.section === b.section && a.row === b.row && a.seat === b.seat;

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "seat":
      if (s.view.kind === "seat" && sameSeat(s.view.seat, a.seat)) return s;
      return { ...s, view: { kind: "seat", seat: a.seat }, autoOrbit: false };
    case "back":
      return s.view.kind === "overview" ? s : { ...s, view: { kind: "overview" } };
    case "lighting":
      return s.lighting === a.lighting ? s : { ...s, lighting: a.lighting };
    case "camera":
      return { ...s, view: { kind: "overview" }, autoOrbit: false };
    case "autoOrbit":
      if (a.on === s.autoOrbit || (a.on && s.view.kind === "seat")) return s;
      return { ...s, autoOrbit: a.on };
    default:
      return s;
  }
}

/** `?state=` URL param: only day/golden/night are accepted. */
export const parseLighting = (v: string | null): State =>
  STATES.includes(v as State) ? (v as State) : initialState.lighting;
```

Run → PASS (`main.ts` breaks until Task 14; `npm run build` is expected to fail on `main.ts` only — check with `npx tsc --noEmit 2>&1 | grep -v "src/main.ts"` that nothing else errors).

- [ ] **Step 3: Commit** — `git commit -am "Web viewer v2: overview/seat app state"`

---

### Task 11: Seat view pose and ray-to-seat picking

**Files:**
- Modify: `web/src/flyto.ts`, `web/src/flyto.test.ts`
- Create: `web/src/seatPick.ts`, `web/src/seatPick.test.ts`

**Interfaces:**
- Produces: `SEAT_EYE_M = 1.2`, `SEAT_HFOV = 70`, `SEAT_LOOK_M`, `SEAT_EXP = 0.1`, `seatViewPose(p: V3): Pose`; `SEAT_CENTRE_M = 0.6`, `nearestSeatToRay(t: SeatTable, r: { start; end }, o: V3, d: V3): number` (−1 if none ahead of the ray).

- [ ] **Step 1: Failing tests** — in `web/src/flyto.test.ts` replace the `section framing` describe and the `sectionFraming` import with:

```ts
import { seatViewPose, SEAT_EYE_M, SEAT_HFOV, SEAT_LOOK_M } from "./flyto";

describe("seat view pose (spec part 2)", () => {
  it("eye 1.2 m above the seat, looking at the pitch centre, target just ahead", () => {
    const p = seatViewPose([0, -60, 8]);
    expect(p.eye).toEqual([0, -60, 8 + SEAT_EYE_M]);
    expect(p.hfov).toBe(SEAT_HFOV);
    const d = p.target.map((v, k) => v - p.eye[k]);
    expect(Math.hypot(...d)).toBeCloseTo(SEAT_LOOK_M, 9);
    const toCentre = p.eye.map((v) => -v), n = Math.hypot(...toCentre);
    d.forEach((v, k) => expect(v / SEAT_LOOK_M).toBeCloseTo(toCentre[k] / n, 9));
  });
  it("worst-case visible seats from any section's seat view stays <= 25k (decision D6)", () => {
    let worst = 0;
    for (const s of doc.sections) {
      const ids = visibleSections(s.view.eye, doc.sections, SEAT_LOD_DIST, Number(s.id));
      worst = Math.max(worst, doc.sections.filter((x) => ids.has(Number(x.id))).reduce((a, x) => a + x.seats, 0));
    }
    expect(worst).toBeLessThanOrEqual(25_000);
  });
});
```

`web/src/seatPick.test.ts`:

```ts
import { expect, it } from "vitest";
import { nearestSeatToRay, SEAT_CENTRE_M } from "./seatPick";
import type { SeatTable } from "./seatsData";

const t: SeatTable = { count: 3, section: new Uint16Array(3).fill(101), row: new Uint8Array([1, 1, 2]), seat: new Uint16Array([1, 2, 1]),
  pos: new Float32Array([0, -50, 5, 0.5, -50, 5, 0, -51, 5.4]), yaw: new Float32Array(3) };
it("picks the seat whose centre is nearest the ray", () => {
  // ray from above the pitch toward seat 2's centre
  const target = [0.5, -50, 5 + SEAT_CENTRE_M], o: [number, number, number] = [0.5, 0, 30];
  const d = target.map((v, k) => v - o[k]), n = Math.hypot(...d);
  expect(nearestSeatToRay(t, { start: 0, end: 3 }, o, d.map((v) => v / n) as [number, number, number])).toBe(1);
});
it("ignores seats behind the ray origin", () => {
  expect(nearestSeatToRay(t, { start: 0, end: 3 }, [0, -40, 5], [0, 1, 0])).toBe(-1);
});
```

Run both → FAIL.

- [ ] **Step 2: Implement** — in `web/src/flyto.ts` delete `sectionFraming` (and the `Section` import if unused) and add:

```ts
/** Seat view (spec part 2): eye 1.2 m above the tread, looking at the pitch centre, hfov 70. */
export const SEAT_EYE_M = 1.2, SEAT_HFOV = 70;
/**
 * OrbitControls target distance in seat view. The spec's 1 m makes a drag swing the eye up to 2 m around
 * the seat; 0.1 m keeps look-around a head turn (the camera orbits a point just ahead of the eye).
 */
export const SEAT_LOOK_M = 0.1;
/** Camera exposure (stops) in seat view: the CAM_Seat_* cameras' value. */
export const SEAT_EXP = 0.1;
export function seatViewPose([x, y, z]: V3): Pose {
  const eye: V3 = [x, y, z + SEAT_EYE_M], n = Math.hypot(...eye);
  return { eye, target: eye.map((v) => v - (v / n) * SEAT_LOOK_M) as V3, hfov: SEAT_HFOV };
}
```

`web/src/seatPick.ts`:

```ts
import type { V3 } from "./coords";
import type { SeatTable } from "./seatsData";

/** Height of a seat's visual centre above its tread origin (seat back top ~0.93 m, pan 0.44 m). */
export const SEAT_CENTRE_M = 0.6;

/**
 * Seat of one section (index range r) whose centre is closest to the ray o + s d (Blender coords, d unit,
 * s > 0). The section comes from the section-strip raycast, so this runs over <= ~600 seats per pick.
 */
export function nearestSeatToRay(t: SeatTable, r: { start: number; end: number }, o: V3, d: V3) {
  let best = -1, bestD = Infinity;
  for (let i = r.start; i < r.end; i++) {
    const vx = t.pos[i * 3] - o[0], vy = t.pos[i * 3 + 1] - o[1], vz = t.pos[i * 3 + 2] + SEAT_CENTRE_M - o[2];
    const s = vx * d[0] + vy * d[1] + vz * d[2];
    if (s <= 0) continue;
    const d2 = vx * vx + vy * vy + vz * vz - s * s;
    if (d2 < bestD) { bestD = d2; best = i; }
  }
  return best;
}
```

Run → PASS.

- [ ] **Step 3: Commit** — `git add web/src/flyto.ts web/src/flyto.test.ts web/src/seatPick.ts web/src/seatPick.test.ts && git commit -m "Web viewer v2: seat view pose, ray-to-seat picking"`

---

### Task 12: Camera rig look mode, zoom, auto orbit

**Files:**
- Modify: `web/src/camera.ts`, `web/src/camera.test.ts`

**Interfaces:**
- Produces: `type RigMode = "orbit" | "look"`, `zoomedPose(p: Pose, f: number, mode: RigMode): Pose`, `CameraRig.setMode(m)`, `CameraRig.mode`, `CameraRig.zoom(f)`, `CameraRig.setAutoOrbit(on)`, `CameraRig.onUserInput(cb)`, `flyTo(to, exposure?, seconds = FLIGHT_S)`. Constants `LOOK_HFOV = [25, 90]`, `ZOOM_S = 0.35`, `AUTO_ORBIT_SPEED = 0.6`.

- [ ] **Step 1: Failing tests** — append to `web/src/camera.test.ts` (import `zoomedPose, LOOK_HFOV, MIN_DISTANCE_M`):

```ts
describe("zoom (Review Focus 2)", () => {
  const p = { eye: [0, -100, 50] as [number, number, number], target: [0, 0, 0] as [number, number, number], hfov: 60 };
  it("orbit mode dollies along the view line, clamped to MIN_DISTANCE_M", () => {
    const z = zoomedPose(p, 0.5, "orbit");
    expect(z.target).toEqual(p.target);
    expect(Math.hypot(...z.eye)).toBeCloseTo(Math.hypot(...p.eye) * 0.5, 6);
    expect(Math.hypot(...zoomedPose(p, 1e-6, "orbit").eye)).toBeCloseTo(MIN_DISTANCE_M, 6);
  });
  it("look mode (seat view) narrows the fov and never moves the eye", () => {
    const z = zoomedPose(p, 0.5, "look");
    expect(z.eye).toEqual(p.eye);
    expect(z.hfov).toBe(30);
    expect(zoomedPose(p, 0.01, "look").hfov).toBe(LOOK_HFOV[0]);
    expect(zoomedPose(p, 10, "look").hfov).toBe(LOOK_HFOV[1]);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement** in `web/src/camera.ts`:

```ts
export type RigMode = "orbit" | "look";
/** Seat view zoom range (hfov, deg). */
export const LOOK_HFOV = [25, 90] as const;
export const ZOOM_S = 0.35, AUTO_ORBIT_SPEED = 0.6, MAX_DISTANCE_M = 2500;
/** Zoom buttons: orbit dollies toward the target; look (seat view) changes the fov so the eye stays in the seat. */
export function zoomedPose(p: Pose, f: number, mode: RigMode): Pose {
  if (mode === "look") return { ...p, hfov: Math.min(LOOK_HFOV[1], Math.max(LOOK_HFOV[0], p.hfov * f)) };
  const d = p.eye.map((v, k) => v - p.target[k]), r = Math.hypot(...d);
  const k = Math.min(MAX_DISTANCE_M, Math.max(MIN_DISTANCE_M, r * f)) / r;
  return { ...p, eye: p.target.map((v, i) => v + d[i] * k) as V3 };
}
```

In `CameraRig`: use `MAX_DISTANCE_M` for `controls.maxDistance`; add `mode: RigMode = "orbit";` and:

```ts
  /** Look mode (seat view): drag turns the head around a target SEAT_LOOK_M ahead; no pan, no dolly. */
  setMode(m: RigMode) {
    this.mode = m;
    const c = this.controls;
    c.enablePan = c.enableZoom = m === "orbit";
    c.minDistance = m === "orbit" ? MIN_DISTANCE_M : 0;
    c.rotateSpeed = m === "orbit" ? 1 : 0.35;
    if (m === "look") this.setAutoOrbit(false);
  }
  setAutoOrbit(on: boolean) { this.controls.autoRotate = on; this.controls.autoRotateSpeed = AUTO_ORBIT_SPEED; }
  /** Any drag or wheel on the canvas (OrbitControls "start"). */
  onUserInput(cb: () => void) { this.controls.addEventListener("start", cb); }
  zoom(f: number) { return this.flyTo(zoomedPose(this.pose(), f, this.mode), this.exposure, ZOOM_S); }
```

Change `flyTo(to: Pose, exposure = this.exposure)` to `flyTo(to: Pose, exposure = this.exposure, seconds = FLIGHT_S)`, store `seconds` in the flight object, and in `update` use `f.t = Math.min(1, f.t + dt / f.seconds);`. (`import type { V3 }` is already there.)

- [ ] **Step 3: Run** `cd web && npx vitest run src/camera.test.ts` → PASS.

- [ ] **Step 4: Commit** — `git commit -am "Web viewer v2: camera look mode, zoom, auto orbit"`

---

### Task 13: UI shell (theme, header, sidebar, controls, tooltip)

**Files:**
- Create: `web/src/heroViews.ts`, `web/src/heroViews.test.ts`, `web/src/ui/theme.css`, `web/src/ui/header.ts`, `web/src/ui/sidebar.ts`, `web/src/ui/controls.ts`, `web/src/ui/tooltip.ts`
- Modify: `web/index.html`, `web/src/ui.ts` (drop `renderPanel`), `.gitignore` (font)
- Delete: `web/src/style.css`
- Move: `AktivGrotesk_Blk.woff2` → `web/public/fonts/AktivGrotesk_Blk.woff2`

**Interfaces:**
- Consumes: `AppState`, `SeatRef`, `SeatDirectory`, `sectionsOfTier`, `Tier`, `TIERS`, `TIER_HEX`, `State`.
- Produces:
  - `HERO_VIEWS: { cam: string; title: string; tier: Tier }[]`, `MODE_CAMERAS: { cam: string; label: string }[]`, `heroesIn(cameras: Record<string, unknown>)` (only those present).
  - `renderHeader(root: HTMLElement, seatsTotal: number): void`
  - `class Sidebar { constructor(root, dir: SeatDirectory, sections: Section[], on: SidebarHandlers); render(s: AppState): void; }` with `SidebarHandlers { seeView(r: SeatRef): void; hero(cam: string): void; back(): void; copyLink(): void }`
  - `class Controls { constructor(root, on: ControlHandlers); render(s: AppState): void }` with `ControlHandlers { lighting(l: State): void; zoom(f: number): void; reset(): void; fullscreen(): void; camera(cam: string): void; autoOrbit(on: boolean): void }`
  - `class Tooltip { constructor(root); show(x: number, y: number, r: SeatRef, tier: Tier): void; hide(): void }`
  - DOM ids in `index.html`: `#header`, `#sidebar`, `#stage` (contains `#view`, `#controls`, `#tooltip`), `#overlay`.

- [ ] **Step 1: Failing hero test** — `web/src/heroViews.test.ts`:

```ts
import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { HERO_VIEWS, MODE_CAMERAS, heroesIn } from "./heroViews";

// cameras.json is a build product (gitignored), so this check runs where the assets are built
const url = new URL("../public/assets/cameras.json", import.meta.url);
it.skipIf(!existsSync(url))("every CAM_Seat_* camera has a labelled hero view, and every listed camera exists", () => {
  const cams = JSON.parse(readFileSync(url, "utf8"));
  const seatCams = Object.keys(cams).filter((k) => k.startsWith("CAM_Seat_")).sort();
  expect(HERO_VIEWS.map((h) => h.cam).sort()).toEqual(seatCams);
  for (const m of MODE_CAMERAS) expect(cams[m.cam]).toBeDefined();
  expect(heroesIn({ CAM_Seat_201: {} }).map((h) => h.cam)).toEqual(["CAM_Seat_201"]);
});
```

Run → FAIL.

- [ ] **Step 2: Implement** — `web/src/heroViews.ts`:

```ts
import type { Tier } from "./tiers";

/** "Views worth exploring" (spec part 2): the CAM_Seat_* hero cameras, labelled by position and tier. */
export const HERO_VIEWS: { cam: string; title: string; tier: Tier }[] = [
  { cam: "CAM_Seat_201", title: "The centre-line classic", tier: "Club" },
  { cam: "CAM_Seat_101", title: "Pitchside on halfway", tier: "Lower" },
  { cam: "CAM_Seat_123", title: "Far touchline, front rows", tier: "Lower" },
  { cam: "CAM_Seat_112", title: "Behind the east goal", tier: "Lower" },
  { cam: "CAM_Seat_134", title: "Behind the west goal", tier: "Lower" },
  { cam: "CAM_Seat_212", title: "Club end view", tier: "Club" },
  { cam: "CAM_Seat_301", title: "High above halfway", tier: "Upper" },
  { cam: "CAM_Seat_306", title: "The corner angle", tier: "Upper" },
  { cam: "CAM_Seat_312", title: "Top of the east end", tier: "Upper" },
  { cam: "CAM_Seat_323", title: "Far side, upper tier", tier: "Upper" },
];
/** Bottom mode bar cameras (auto orbit is a separate toggle). */
export const MODE_CAMERAS = [
  { cam: "CAM_Bowl", label: "Stadium" },
  { cam: "CAM_Aerial_SW", label: "Exterior" },
  { cam: "CAM_Top", label: "Top view" },
];
export const heroesIn = (cameras: Record<string, unknown>) => HERO_VIEWS.filter((h) => h.cam in cameras);
```

Run → PASS.

- [ ] **Step 3: Font** — `mkdir -p web/public/fonts && git mv -k AktivGrotesk_Blk.woff2 web/public/fonts/ 2>/dev/null || mv AktivGrotesk_Blk.woff2 web/public/fonts/`; append to `.gitignore`: `web/public/fonts/AktivGrotesk_*   # licensed font: local only, Archivo is the fallback`.

- [ ] **Step 4: index.html**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Aramco Stadium · Take your seat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;900&display=swap" />
  <link rel="stylesheet" href="/src/ui/theme.css" />
</head>
<body>
  <header id="header"></header>
  <div id="app">
    <aside id="sidebar"></aside>
    <main id="stage">
      <canvas id="view"></canvas>
      <div id="controls"></div>
      <div id="tooltip" hidden></div>
    </main>
  </div>
  <div id="overlay"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 5: theme.css** — `web/src/ui/theme.css` (moves the overlay/progress rules from `style.css`, then delete `style.css`):

```css
@font-face { font-family: "Aktiv Grotesk"; src: url("/fonts/AktivGrotesk_Blk.woff2") format("woff2"); font-weight: 900; font-display: swap; }
:root {
  --navy: #010532; --navy-2: #0a0f45; --white: #ffffff; --muted: rgba(255, 255, 255, 0.6); --muted-solid: #5f6369;
  --green: #00d246; --blue: #1480db; --blue-2: #3860be; --sand: #efe3c8; --line: rgba(255, 255, 255, 0.14);
  --font: "Aktiv Grotesk", "Archivo", system-ui, sans-serif; --sidebar: 380px; --header: 64px;
  font: 400 14px/1.45 var(--font); color: var(--white); color-scheme: dark;
}
html, body { margin: 0; height: 100%; background: var(--navy); overflow: hidden; }
h1, h2, h3, .eyebrow, .pill, .wordmark { font-family: var(--font); font-weight: 900; text-transform: uppercase; line-height: 1.1; margin: 0; }
h1 { font-size: 40px; letter-spacing: -0.01em; }
h2 { font-size: 15px; letter-spacing: 0.02em; }
.eyebrow { color: var(--green); font-size: 11px; letter-spacing: 0.12em; }
.muted { color: var(--muted); }
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, select:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }

/* header */
#header { height: var(--header); display: flex; align-items: center; gap: 16px; padding: 0 20px; border-bottom: 1px solid var(--line); box-sizing: border-box; }
.wordmark { font-size: 18px; letter-spacing: 0.04em; }
#header .eyebrow { flex: 1; }

/* pills and icon buttons */
.pill { display: inline-flex; align-items: center; gap: 8px; background: var(--white); color: var(--navy); border: 0; border-radius: 999px; padding: 11px 20px; font-size: 12px; letter-spacing: 0.06em; }
.pill:disabled { opacity: 0.4; cursor: default; }
.pill.ghost { background: transparent; color: var(--white); box-shadow: inset 0 0 0 1px var(--line); }
.pill::after { content: "›"; font-size: 16px; line-height: 0; }
.pill.plain::after { content: none; }
.icon { width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.5); background: rgba(1, 5, 50, 0.72); color: var(--white); display: grid; place-items: center; font-size: 18px; backdrop-filter: blur(6px); }
.icon:hover, .pill.ghost:hover { border-color: var(--white); }

/* layout */
#app { position: fixed; top: var(--header); inset-inline: 0; bottom: 0; display: grid; grid-template-columns: var(--sidebar) 1fr; }
#sidebar { overflow-y: auto; padding: 28px 24px 32px; border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 22px; }
#stage { position: relative; overflow: hidden; }
#view { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }

/* sidebar */
.intro p { margin: 10px 0 0; color: var(--muted); }
.seg { display: grid; grid-template-columns: 1fr 1fr; background: var(--navy-2); border-radius: 999px; padding: 4px; }
.seg button { border: 0; background: transparent; border-radius: 999px; padding: 9px 0; font-weight: 900; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.seg button[aria-pressed="true"] { background: var(--white); color: var(--navy); }
.seg button:disabled { opacity: 0.35; cursor: default; }
.finder { display: grid; gap: 10px; }
.finder label { display: grid; gap: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
.finder select { font: inherit; color: var(--white); background: var(--navy-2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.finder .grid2 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.hint { font-size: 12px; color: var(--muted); }
.card { background: var(--navy-2); border-radius: 16px; padding: 18px; display: grid; gap: 12px; }
.seatcard dl { display: grid; grid-template-columns: repeat(3, 1fr); margin: 0; }
.seatcard dt { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.seatcard dd { margin: 2px 0 0; font-weight: 900; font-size: 26px; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: 0; }
.heroes { list-style: none; margin: 0; padding: 0; display: grid; }
.heroes button { width: 100%; text-align: left; background: none; border: 0; border-top: 1px solid var(--line); padding: 12px 0; display: flex; justify-content: space-between; gap: 12px; }
.heroes button:hover .t { color: var(--green); }
.heroes .t { font-weight: 900; text-transform: uppercase; font-size: 13px; }
.heroes .k { font-size: 12px; color: var(--muted); white-space: nowrap; }
.sheet-toggle { display: none; }

/* viewport overlays */
.ov { position: absolute; z-index: 2; }
.ov-title { top: 20px; left: 24px; pointer-events: none; text-shadow: 0 1px 12px rgba(1, 5, 50, 0.6); }
.ov-title h2 { font-size: 26px; }
.ov-light { top: 20px; right: 20px; }
.ov-light select { font: 900 11px var(--font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--navy); background: var(--white); border: 0; border-radius: 999px; padding: 10px 16px; }
.ov-zoom { right: 20px; top: 50%; transform: translateY(-50%); display: grid; gap: 8px; }
.ov-bar { bottom: 18px; left: 50%; transform: translateX(-50%); display: grid; justify-items: center; gap: 8px; }
.bar { display: flex; gap: 4px; background: rgba(1, 5, 50, 0.78); border: 1px solid var(--line); border-radius: 999px; padding: 4px; backdrop-filter: blur(6px); }
.bar button { border: 0; background: transparent; color: var(--white); border-radius: 999px; padding: 9px 16px; font-weight: 900; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
.bar button[aria-pressed="true"] { background: var(--white); color: var(--navy); }
.hints { font-size: 11px; color: var(--muted); text-shadow: 0 1px 8px var(--navy); }
#tooltip { position: absolute; z-index: 3; pointer-events: none; background: var(--white); color: var(--navy); border-radius: 12px; padding: 10px 14px; transform: translate(14px, -50%); box-shadow: 0 8px 28px rgba(1, 5, 50, 0.4); white-space: nowrap; }
#tooltip[hidden] { display: none; }
#tooltip strong { display: block; font-weight: 900; text-transform: uppercase; font-size: 12px; letter-spacing: 0.04em; }
#tooltip span { font-size: 12px; color: var(--muted-solid); }
#tooltip em { display: block; font-style: normal; font-size: 11px; color: var(--blue-2); margin-top: 2px; }

/* about card, loading overlay */
.modal { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; background: rgba(1, 5, 50, 0.7); }
.modal[hidden] { display: none; }
.modal .card { max-width: 420px; margin: 16px; }
#overlay { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; background: rgba(1, 5, 50, 0.82); }
#overlay[hidden] { display: none; }
#overlay .card { max-width: 420px; }
.progress { width: 320px; max-width: 80vw; height: 4px; background: var(--navy-2); border-radius: 2px; overflow: hidden; }
.progress div { height: 100%; background: var(--green); transition: width 0.2s; }

/* capture mode (?chrome=0): the canvas alone fills the window */
body.bare #header, body.bare #sidebar, body.bare #controls { display: none; }
body.bare #app { top: 0; grid-template-columns: 1fr; }

/* narrow screens: sidebar becomes a bottom sheet collapsed to its title bar */
@media (max-width: 899px) {
  #app { grid-template-columns: 1fr; }
  #header { height: 52px; padding: 0 16px; }
  :root { --header: 52px; }
  #header .eyebrow { display: none; }
  #sidebar { position: absolute; z-index: 4; left: 0; right: 0; bottom: 0; max-height: 72%; background: var(--navy); border: 0; border-top: 1px solid var(--line); border-radius: 18px 18px 0 0; padding: 0 16px 24px; transition: transform 0.25s ease; }
  #sidebar.collapsed { transform: translateY(calc(100% - 56px)); overflow: hidden; }
  .sheet-toggle { display: flex; position: sticky; top: 0; background: var(--navy); border: 0; width: 100%; padding: 18px 0 12px; justify-content: space-between; align-items: center; font-weight: 900; text-transform: uppercase; font-size: 13px; letter-spacing: 0.06em; }
  h1 { font-size: 30px; }
  .ov-title { top: 14px; left: 16px; } .ov-title h2 { font-size: 18px; } .ov-title .eyebrow { display: none; }
  .ov-light { top: 12px; right: 12px; }
  .ov-zoom { right: 12px; top: 64px; transform: none; } .icon { width: 34px; height: 34px; font-size: 15px; }
  .ov-bar { bottom: 68px; } .bar button { padding: 8px 10px; font-size: 10px; } .hints { display: none; }
}
@media (prefers-reduced-motion: reduce) { #sidebar { transition: none; } }
```

- [ ] **Step 6: header.ts** — `web/src/ui/header.ts`:

```ts
/** Navy header: wordmark (text, no logo file), location eyebrow, and the "About the stadium" card. */
export function renderHeader(root: HTMLElement, seatsTotal: number) {
  root.innerHTML = `<span class="wordmark">Aramco Stadium</span>
    <span class="eyebrow">Al Khobar · Saudi Arabia</span>
    <button class="pill ghost" id="about-open">About the stadium</button>
    <div class="modal" id="about" hidden role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div class="card">
        <span class="eyebrow">Al Khobar · Saudi Arabia</span>
        <h2 id="about-title">Aramco Stadium</h2>
        <p class="muted">A bowl wrapped in a shell of sails, designed by Populous. This model seats
          ${seatsTotal.toLocaleString("en")} fans across Lower, Club and Upper tiers.
          Section and seat numbers are illustrative.</p>
        <button class="pill plain" id="about-close">Close</button>
      </div>
    </div>`;
  const modal = root.querySelector<HTMLElement>("#about")!;
  root.querySelector<HTMLButtonElement>("#about-open")!.onclick = () => { modal.hidden = false; root.querySelector<HTMLButtonElement>("#about-close")!.focus(); };
  const close = () => (modal.hidden = true);
  root.querySelector<HTMLButtonElement>("#about-close")!.onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) { e.stopImmediatePropagation(); close(); } }, { capture: true });
}
```

- [ ] **Step 7: sidebar.ts** — `web/src/ui/sidebar.ts`:

```ts
import type { AppState } from "../state";
import type { Section } from "../loader";
import { formatSeat, sectionsOfTier, type SeatDirectory, type SeatRef } from "../seatsData";
import { TIERS, TIER_HEX, type Tier } from "../tiers";
import { HERO_VIEWS } from "../heroViews";

export interface SidebarHandlers { seeView(r: SeatRef): void; hero(cam: string): void; back(): void; copyLink(): void }
const opts = (vals: (number | string)[], sel: number | string) => vals.map((v) => `<option value="${v}"${v === sel ? " selected" : ""}>${v}</option>`).join("");

/** Left sidebar: intro, Overview / Seat view, Find your seat, the seat card, Views worth exploring. */
export class Sidebar {
  private tier: Tier = "Lower";
  private pick: SeatRef | null = null;          // the finder's current choice
  private shown: string | null = null;          // seat view last adopted into the finder
  private tierOf = new Map<number, Tier>();
  private heroes: typeof HERO_VIEWS;
  constructor(private root: HTMLElement, private dir: SeatDirectory, private sections: Section[], private on: SidebarHandlers, heroes = HERO_VIEWS) {
    for (const s of sections) this.tierOf.set(Number(s.id), s.tier);
    this.heroes = heroes;
    this.choose(this.tier);
    root.classList.add("collapsed");
  }
  /** First section / row / seat of a tier, or of the given section. */
  private choose(tier: Tier, section?: number, row?: number) {
    const secs = sectionsOfTier(this.sections, tier);
    const sec = section !== undefined && secs.includes(section) ? section : secs[0];
    const rows = this.dir.rows(sec), r = row !== undefined && rows.includes(row) ? row : rows[0];
    this.tier = tier;
    this.pick = sec !== undefined && r !== undefined ? { section: sec, row: r, seat: this.dir.seats(sec, r)[0] } : null;
  }
  render(s: AppState) {
    // adopt the shown seat into the finder only when it changes, so browsing the finder in seat view is kept
    const key = s.view.kind === "seat" ? formatSeat(s.view.seat) : null;
    if (s.view.kind === "seat" && key !== this.shown) { this.tier = this.tierOf.get(s.view.seat.section) ?? this.tier; this.pick = s.view.seat; }
    this.shown = key;
    const seat = s.view.kind === "seat" ? s.view.seat : null, p = this.pick;
    const finder = p ? `
      <label>Tier<select data-f="tier">${TIERS.map((t) => `<option value="${t}"${t === this.tier ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <div class="grid2">
        <label>Section<select data-f="section">${opts(sectionsOfTier(this.sections, this.tier), p.section)}</select></label>
        <label>Row<select data-f="row">${opts(this.dir.rows(p.section), p.row)}</select></label>
        <label>Seat<select data-f="seat">${opts(this.dir.seats(p.section, p.row), p.seat)}</select></label>
      </div>` : `<p class="muted">No seats loaded.</p>`;
    const card = seat ? `
      <section class="card seatcard" aria-live="polite">
        <span class="eyebrow">Your seat · <span class="swatch" style="background:${TIER_HEX[this.tierOf.get(seat.section) ?? "Lower"]}"></span>${this.tierOf.get(seat.section) ?? ""}</span>
        <dl><div><dt>Section</dt><dd>${seat.section}</dd></div><div><dt>Row</dt><dd>${seat.row}</dd></div><div><dt>Seat</dt><dd>${seat.seat}</dd></div></dl>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="pill" data-a="back">Back to overview</button><button class="pill ghost plain" data-a="copy">Copy link</button></div>
      </section>` : "";
    this.root.innerHTML = `
      <button class="sheet-toggle" data-a="sheet" aria-expanded="${!this.root.classList.contains("collapsed")}">Take your seat <span aria-hidden="true">▴</span></button>
      <div class="intro"><span class="eyebrow">A place in the stands</span><h1>Take your seat.</h1>
        <p>Pick a seat and see the pitch from it, or explore the stadium around you.</p></div>
      <div class="seg" role="group" aria-label="View">
        <button data-a="overview" aria-pressed="${!seat}">Overview</button>
        <button data-a="seatview" aria-pressed="${!!seat}" ${seat || p ? "" : "disabled"}>Seat view</button>
      </div>
      ${card}
      <section class="finder"><h2>Find your seat</h2>${finder}
        <button class="pill" data-a="see" ${p ? "" : "disabled"}>See the view</button>
        <span class="hint">Or click any seat in the stadium</span></section>
      <section><h2>Views worth exploring</h2><ul class="heroes">${this.heroes.map((h) =>
        `<li><button data-hero="${h.cam}"><span class="t">${h.title}</span><span class="k"><span class="swatch" style="background:${TIER_HEX[h.tier]}"></span>${h.tier}</span></button></li>`).join("")}</ul></section>`;
    this.wire(s);
  }
  private wire(s: AppState) {
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel);
    const val = (f: string) => q<HTMLSelectElement>(`[data-f="${f}"]`)!.value;
    this.root.querySelectorAll<HTMLSelectElement>("[data-f]").forEach((el) => (el.onchange = () => {
      const f = el.dataset.f!;
      if (f === "tier") this.choose(val("tier") as Tier);
      else if (f === "section") this.choose(this.tier, Number(val("section")));
      else if (f === "row") this.choose(this.tier, Number(val("section")), Number(val("row")));
      else this.pick = { section: Number(val("section")), row: Number(val("row")), seat: Number(val("seat")) };
      this.render(s);                                         // new option lists; the 3D view only changes on "See the view"
    }));
    const see = () => this.pick && this.on.seeView(this.pick);
    q<HTMLButtonElement>('[data-a="see"]')?.addEventListener("click", see);
    q<HTMLButtonElement>('[data-a="seatview"]')?.addEventListener("click", () => s.view.kind !== "seat" && see());
    q<HTMLButtonElement>('[data-a="overview"]')?.addEventListener("click", () => s.view.kind === "seat" && this.on.back());
    q<HTMLButtonElement>('[data-a="back"]')?.addEventListener("click", this.on.back);
    q<HTMLButtonElement>('[data-a="copy"]')?.addEventListener("click", this.on.copyLink);
    q<HTMLButtonElement>('[data-a="sheet"]')?.addEventListener("click", () => { this.root.classList.toggle("collapsed"); this.render(s); });
    this.root.querySelectorAll<HTMLButtonElement>("[data-hero]").forEach((b) => (b.onclick = () => this.on.hero(b.dataset.hero!)));
  }
  /** Current finder choice as a link-ready string (for tests / debugging). */
  get choice() { return this.pick ? formatSeat(this.pick) : null; }
}
```

- [ ] **Step 8: controls.ts** — `web/src/ui/controls.ts`:

```ts
import type { AppState } from "../state";
import type { State } from "../loader";
import { MODE_CAMERAS } from "../heroViews";

export interface ControlHandlers { lighting(l: State): void; zoom(f: number): void; reset(): void; fullscreen(): void; camera(cam: string): void; autoOrbit(on: boolean): void }
const LABEL: Record<State, string> = { day: "Day", golden: "Golden hour", night: "Night" };
export const ZOOM_STEP = 0.7;

/** Viewport overlays: title, lighting dropdown, zoom/reset/fullscreen, mode bar and hints. */
export class Controls {
  private lastCam: string | null = null;
  constructor(private root: HTMLElement, private on: ControlHandlers) {}
  render(s: AppState) {
    const seat = s.view.kind === "seat";
    this.root.innerHTML = `
      <div class="ov ov-title"><h2>Aramco Stadium.</h2><span class="eyebrow">Al Khobar · Saudi Arabia</span></div>
      <label class="ov ov-light"><span hidden>Lighting</span><select aria-label="Lighting">${(Object.keys(LABEL) as State[]).map((l) =>
        `<option value="${l}"${l === s.lighting ? " selected" : ""}>${LABEL[l]}</option>`).join("")}</select></label>
      <div class="ov ov-zoom">
        <button class="icon" data-z="in" aria-label="Zoom in">+</button>
        <button class="icon" data-z="out" aria-label="Zoom out">−</button>
        <button class="icon" data-z="reset" aria-label="Reset view">⟲</button>
        <button class="icon" data-z="full" aria-label="Fullscreen">⛶</button>
      </div>
      <div class="ov ov-bar">
        <div class="bar" role="group" aria-label="Camera">${MODE_CAMERAS.map((m) =>
          `<button data-cam="${m.cam}" aria-pressed="${!seat && !s.autoOrbit && this.lastCam === m.cam}">${m.label}</button>`).join("")}
          <button data-orbit aria-pressed="${s.autoOrbit}" ${seat ? "disabled" : ""}>Auto orbit</button></div>
        <div class="hints">Drag to ${seat ? "look around" : "orbit"} · Scroll to zoom · Click a seat</div>
      </div>`;
    const q = (sel: string) => this.root.querySelector<HTMLElement>(sel)!;
    (q("select") as HTMLSelectElement).onchange = (e) => this.on.lighting((e.target as HTMLSelectElement).value as State);
    q('[data-z="in"]').onclick = () => this.on.zoom(ZOOM_STEP);
    q('[data-z="out"]').onclick = () => this.on.zoom(1 / ZOOM_STEP);
    q('[data-z="reset"]').onclick = () => this.on.reset();
    q('[data-z="full"]').onclick = () => this.on.fullscreen();
    this.root.querySelectorAll<HTMLButtonElement>("[data-cam]").forEach((b) => (b.onclick = () => { this.lastCam = b.dataset.cam!; this.on.camera(b.dataset.cam!); }));
    q("[data-orbit]").onclick = () => this.on.autoOrbit(!s.autoOrbit);
  }
}
```

- [ ] **Step 9: tooltip.ts** — `web/src/ui/tooltip.ts`:

```ts
import type { SeatRef } from "../seatsData";
import { TIER_HEX, type Tier } from "../tiers";

/** Hover card: "SECTION 212 · ROW 10 · SEAT 4", the tier, and the click hint. Positioned in stage pixels. */
export class Tooltip {
  private key = "";
  constructor(private el: HTMLElement) {}
  show(x: number, y: number, r: SeatRef, tier: Tier) {
    const key = `${r.section}-${r.row}-${r.seat}`;
    if (key !== this.key) {
      this.key = key;
      this.el.innerHTML = `<strong>Section ${r.section} · Row ${r.row} · Seat ${r.seat}</strong>
        <span><span class="swatch" style="background:${TIER_HEX[tier]}"></span>${tier} tier</span><em>Click to take this seat ↗</em>`;
    }
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.hidden = false;
  }
  hide() { this.el.hidden = true; this.key = ""; }
}
```

- [ ] **Step 10: ui.ts** — delete `PanelInfo`, `LABEL` and `renderPanel` (and the now unused imports); keep `showProgress`, `hideOverlay`, `showError`, `showFatal`. Change `showError`/`showFatal` markup to use `class="pill plain"` for the Retry button.

- [ ] **Step 11: Run** `cd web && npx vitest run` → PASS; `npx tsc --noEmit 2>&1 | grep -v "src/main.ts"` → no errors outside `main.ts`.

- [ ] **Step 12: Commit** — `git add -A web/index.html web/src .gitignore && git commit -m "Web viewer v2: seat finder UI shell (theme, header, sidebar, controls, tooltip)"` (the font is gitignored; check `git status` shows it untracked-ignored, not staged).

---

### Task 14: main.ts wiring

**Files:**
- Modify: `web/src/main.ts` (rewrite of `start`), `web/src/seats.ts` (`SeatField.matrixOf`, `SeatHighlight`)
- Test: `web/src/seats.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `SeatField.matrixOf(i: number, out: THREE.Matrix4): THREE.Matrix4`, `class SeatHighlight { mesh; set(m: THREE.Matrix4 | null); update(t: number) }`, `pulse(t: number): number` in [0.35, 0.9].

- [ ] **Step 1: Failing test** — append to `web/src/seats.test.ts`:

```ts
import { pulse, SeatHighlight } from "./seats";
import * as THREE from "three";
it("selected seat highlight pulses between 0.35 and 0.9 and hides with no seat", () => {
  for (let t = 0; t < 3; t += 0.1) { expect(pulse(t)).toBeGreaterThanOrEqual(0.35); expect(pulse(t)).toBeLessThanOrEqual(0.9); }
  const h = new SeatHighlight();
  h.set(null);
  expect(h.mesh.visible).toBe(false);
  h.set(new THREE.Matrix4());
  expect(h.mesh.visible).toBe(true);
});
```

Run → FAIL.

- [ ] **Step 2: Implement** in `web/src/seats.ts`:

```ts
/** Selected-seat highlight opacity, 1.2 s period. */
export const pulse = (t: number) => 0.625 + 0.275 * Math.sin((t * 2 * Math.PI) / 1.2);

/** A slightly larger white seat drawn over the selected one, pulsing (spec part 2). */
export class SeatHighlight {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  constructor() {
    this.mesh = new THREE.Mesh(seatGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
  }
  set(m: THREE.Matrix4 | null) {
    this.mesh.visible = m !== null;
    if (m) this.mesh.matrix.copy(m).multiply(new THREE.Matrix4().makeScale(1.08, 1.08, 1.08));
  }
  update(t: number) { this.mesh.material.opacity = pulse(t); }
}
```

and in `SeatField`: `matrixOf(i: number, out = new THREE.Matrix4()) { return out.fromArray(this.matrices, i * 16); }`. Run → PASS.

- [ ] **Step 3: Rewrite `start` in `web/src/main.ts`** — keep `boot()` as is. Replace the imports of `renderPanel`, `sectionFraming`, `mockAvailability`, and the `SECTION_EXP` constant. New `start`:

```ts
function start(renderer: THREE.WebGLRenderer, a: Assets) {
  if (params.get("chrome") === "0") document.body.classList.add("bare");
  const scene = new THREE.Scene();
  scene.add(a.stadium.scene);
  const table = parseSeats(a.seatsBin), idx = indexSections(table), dir = new SeatDirectory(table, idx);
  const stage = document.getElementById("stage")!;
  const rig = new CameraRig(renderer.domElement);
  const overview = cameraPose(a.cameras["CAM_Aerial_SW"]);
  const overviewExp = a.cameras["CAM_Aerial_SW"].exposure ?? -0.4;
  const camParam = params.get("cam");
  const camDef = camParam ? a.cameras[camParam] : undefined;
  rig.jump(camDef ? cameraPose(camDef) : overview, camDef?.exposure ?? overviewExp);
  const camera = rig.camera;
  const shared: SharedUniforms = { uLmBlend: { value: 0 }, uEnvB: { value: null }, uEnvBlend: { value: 0 }, uRgbmRange: { value: a.manifest.rgbmRange }, uNight: { value: 0 }, uSoK: { value: specOccK(0) } };
  const glbGroups = new Set<string>();
  a.stadium.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && typeof o.userData.lightmap === "string") glbGroups.add(o.userData.lightmap); });
  const missing = missingLightmaps(a.lightmaps, glbGroups);
  const useLightmaps = missing.length === 0;
  if (!useLightmaps && STATES.some((s) => Object.keys(a.lightmaps[s]).length > 0))
    console.warn(`Lighting: incomplete lightmap bake, using fallback lights. Missing: ${missing.join(", ")}`);
  const groups = setupStadiumMaterials(a.stadium.scene, shared, useLightmaps, renderer.capabilities.reversedDepthBuffer);
  const emissive = new Set<THREE.MeshStandardMaterial>();
  a.stadium.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
    if (m?.userData && (m.userData.emDay > 0 || m.userData.emNight > 0)) emissive.add(m);
  });
  const startState = parseLighting(params.get("state"));
  const lighting = new Lighting(renderer, scene, a, groups, [...emissive], startState, shared, useLightmaps);
  const seats = new SeatField(table, idx, a.sections.sections, lighting.outdoor);
  const tierOf = new Map(a.sections.sections.map((s) => [Number(s.id), s.tier as Tier]));
  const patches = new SectionPatches(table, idx, lighting.outdoor, (id) => tierOf.get(id));
  const highlight = new SeatHighlight();
  scene.add(seats.mesh, patches.mesh, highlight.mesh);
  if (a.trees) { setupTrees(a.trees, a.impostors, lighting.outdoor); scene.add(a.trees.scene); }
  const composer = makeComposer(renderer, scene, camera);
  const perf = new Perf(params.has("stats"));
  // Review Focus 5: size to the stage (the sidebar/sheet takes the rest), not to the window
  const resize = () => {
    const [w, h] = (params.get("size") ?? `${stage.clientWidth}x${stage.clientHeight}`).split("x").map(Number);
    renderer.setSize(w, h, false);
    rig.resize(w, h);
    composer.setSize(w, h);
  };
  new ResizeObserver(resize).observe(stage);
  resize();
  renderer.info.autoReset = false;

  let app: AppState = { ...initialState, lighting: startState };
  const seatPose = (r: SeatRef) => seatViewPose(dir.position(dir.find(r)));
  const syncUrl = () => {
    const u = new URL(location.href);
    if (app.view.kind === "seat") u.searchParams.set("seat", formatSeat(app.view.seat)); else u.searchParams.delete("seat");
    history.replaceState(null, "", u);
  };
  const dispatch = (act: Action) => {
    const prev = app;
    app = reduce(app, act);
    if (app === prev) return;
    if (act.type === "seat" && app.view.kind === "seat") {
      rig.setMode("look");
      rig.flyTo(seatPose(app.view.seat), SEAT_EXP);
      highlight.set(seats.matrixOf(dir.find(app.view.seat)));
    }
    if (act.type === "back" || act.type === "camera") {
      rig.setMode("orbit");
      highlight.set(null);
      const c = act.type === "camera" ? a.cameras[act.camera] : undefined;
      rig.flyTo(c ? cameraPose(c) : overview, c?.exposure ?? overviewExp);
    }
    if (act.type === "lighting") lighting.request(app.lighting);
    rig.setAutoOrbit(app.autoOrbit);
    syncUrl();
    draw();
  };

  renderHeader(document.getElementById("header")!, a.sections.seats_total);
  const sidebar = new Sidebar(document.getElementById("sidebar")!, dir, a.sections.sections, {
    seeView: (r) => dispatch({ type: "seat", seat: r }),
    hero: (cam) => dispatch({ type: "camera", camera: cam }),
    back: () => dispatch({ type: "back" }),
    copyLink: () => navigator.clipboard?.writeText(location.href),
  }, heroesIn(a.cameras));
  const controls = new Controls(document.getElementById("controls")!, {
    lighting: (l) => dispatch({ type: "lighting", lighting: l }),
    zoom: (f) => rig.zoom(f),
    reset: () => (app.view.kind === "seat" ? rig.flyTo(seatPose(app.view.seat), SEAT_EXP, ZOOM_S * 2) : rig.flyTo(overview, overviewExp)),
    fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
    camera: (cam) => dispatch({ type: "camera", camera: cam }),
    autoOrbit: (on) => dispatch({ type: "autoOrbit", on }),
  });
  const draw = () => { sidebar.render(app); controls.render(app); };
  rig.onUserInput(() => app.autoOrbit && dispatch({ type: "autoOrbit", on: false }));

  // picking: section strips (always raycastable, even where seats are drawn), wall check, nearest seat to the ray
  const ray = new THREE.Raycaster(), probe = new DepthProbe(renderer);
  const pickSeat = (ndc: THREE.Vector2): number => {
    ray.setFromCamera(ndc, rig.camera);
    const hit = ray.intersectObject(patches.mesh, false)[0];
    if (!hit) return -1;
    if (!acceptPatchHit(hit.distance, probe.distance(a.stadium.scene, rig.camera, ndc))) return -1;   // final review 6
    const r = idx.get(patches.sectionOfFace(hit.faceIndex!));
    return r ? nearestSeatToRay(table, r, toBlender(ray.ray.origin), toBlender(ray.ray.direction)) : -1;
  };
  const tooltip = new Tooltip(document.getElementById("tooltip")!);
  const toNdc = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    return { ndc: new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), x: e.clientX - r.left, y: e.clientY - r.top };
  };
  let hover: ReturnType<typeof toNdc> | null = null, lastHover = 0, dragging = false;
  const dom = renderer.domElement;
  dom.addEventListener("pointermove", (e) => { hover = e.pointerType === "mouse" ? toNdc(e) : null; });
  dom.addEventListener("pointerdown", () => { dragging = true; tooltip.hide(); });
  addEventListener("pointerup", () => (dragging = false));
  dom.addEventListener("pointerleave", () => { hover = null; tooltip.hide(); });
  onClick(dom, (ndc) => {
    const i = pickSeat(ndc);
    if (i >= 0) dispatch({ type: "seat", seat: dir.ref(i) });
  });
  addEventListener("keydown", (e) => e.key === "Escape" && dispatch({ type: "back" }));

  // deep link (Review Focus 1): only a real seat opens seat view; anything else is the overview
  const linked = parseSeatParam(params.get("seat"));
  if (linked && dir.find(linked) >= 0) {
    app = reduce(app, { type: "seat", seat: linked });
    rig.setMode("look");
    rig.jump(seatPose(linked), SEAT_EXP);
    highlight.set(seats.matrixOf(dir.find(linked)));
  } else if (params.has("seat")) syncUrl();
  draw();

  exposeViewerHooks({ get fps() { return perf.fps; }, info: renderer.info, scene, flyTo: (p: Pose) => rig.flyTo(p),
    setState: (s: State) => dispatch({ type: "lighting", lighting: s }),
    get night() { return lighting.t.night; }, tick: (dt = 1 / 60) => frame(dt),
    renderer, composer, camera, rig, lighting, stadium: a.stadium.scene, assets: a,
    /* Task 1 hooks: stats, save, nudge (unchanged) */ });

  const clock = new THREE.Clock();
  const frame = (dt: number) => {
    rig.update(dt);
    const now = performance.now();
    if (hover && !dragging && !rig.flying && now - lastHover >= 50) {      // ~20 Hz hover picking
      lastHover = now;
      const h = hover, i = pickSeat(h.ndc);
      if (i >= 0) tooltip.show(h.x, h.y, dir.ref(i), tierOf.get(table.section[i]) ?? "Lower"); else tooltip.hide();
      hover = null;                                                          // re-pick only after the pointer moves again
    }
    if (rig.flying) tooltip.hide();
    const focus = app.view.kind === "seat" ? app.view.seat.section : -1;
    const vis = visibleSections(toBlender(camera.position), a.sections.sections, SEAT_LOD_DIST, focus);
    seats.setVisibleSections(vis);
    patches.setHidden(vis);
    highlight.update(now / 1000);
    lighting.update(dt, rig.exposure, camera);
    composer.render(dt);
  };
  renderer.setAnimationLoop(() => {
    perf.begin();
    renderer.info.reset();
    frame(clock.getDelta());
    perf.end();
  });
}
```

Copy the three Task 1 hooks (`stats`, `save`, `nudge`) into the `exposeViewerHooks` object verbatim in place of the comment. Imports to add: `SeatDirectory, parseSeatParam, formatSeat, type SeatRef` (seatsData), `SeatHighlight` (seats), `seatViewPose, SEAT_EXP` (flyto), `nearestSeatToRay` (seatPick), `ZOOM_S` (camera), `type AppState` (state), `type Tier` (tiers), `heroesIn` (heroViews), `renderHeader`, `Sidebar`, `Controls`, `Tooltip` (ui/*), `specOccK` (stadium). Remove `SECTION_EXP`, `secById`, the old `draw`/`renderPanel`.

- [ ] **Step 4: Run** `cd web && npx vitest run && npm run build` → PASS with no type errors.

- [ ] **Step 5: Smoke in the visible tab** — `http://localhost:5173/`: loads, header/sidebar render, no console errors. `?seat=212-10-4` opens in seat view (if that seat does not exist, pick one from the finder and use it); `?seat=999-1-1` and `?seat=abc` open the overview and the URL loses `seat`.

- [ ] **Step 6: Commit** — `git commit -am "Web viewer v2: seat finder wiring (hover, select, seat view, deep links, mode bar)"`

---

### Task 15: UI visual check, performance, docs

**Files:**
- Modify: `docs/superpowers/reports/2026-09-25-v2-visual-check.md` (UI section), `README.md` (viewer section: new URL params `?seat=`, `?chrome=0`, font note)

- [ ] **Step 1: Interaction pass in a visible Chrome tab** (record a GIF with `gif_creator`, name `v2_seat_finder.gif`). Check and note pass/fail for each:
  1. Hover a seat far away (overview) and near (CAM_Bowl): tooltip shows section/row/seat/tier, follows the pointer, hides on leave, during drag and during flight.
  2. Hover/click a seat hidden behind the roof or sails from `CAM_Aerial_SW`: no tooltip, no selection (Review Focus 4).
  3. Click a seat → pulsing highlight, flight into seat view, drag turns the head (if the drag direction feels inverted, set `rotateSpeed` negative in `setMode("look")` and note it), seat card shows, URL has `?seat=`.
  4. Zoom +/− and Reset in seat view keep the eye in the seat (Review Focus 2); in overview they dolly / return to the exterior.
  5. Back to overview, Esc, the Overview/Seat view control, Copy link (paste into a new tab → same seat).
  6. Finder: Tier → Section → Row → Seat lists only real values; See the view flies there.
  7. Views worth exploring (all 10), mode bar Stadium / Exterior / Top view, Auto orbit (starts, stops on drag or wheel; disabled in seat view).
  8. Lighting dropdown in overview and in seat view (seat view stays, Review Focus 3).
  9. Headings render in Aktiv Grotesk Black (DevTools computed font or visual), Archivo when the font file is renamed away (check once, then restore).
- [ ] **Step 2: Narrow screen** — `resize_window` to 390×844: bottom sheet collapsed to its title bar, expands on tap, overlays shrink, canvas fills the stage, picking lands on the seat under the pointer (Review Focus 5).
- [ ] **Step 3: Performance** — `?stats` at 1920×1080 on `CAM_Bowl` night and in a seat view with the hover tooltip active: record fps, triangles and calls (≥ 50 fps, ≤ 2M, ≤ 250). If hover picking costs visible frames, raise the throttle from 50 ms to 100 ms and note it.
- [ ] **Step 4: Report + README** — add the UI checklist results, GIF path and perf numbers to the report; in `README.md` document `?seat=<section>-<row>-<seat>`, `?chrome=0` (capture mode), and that `web/public/fonts/AktivGrotesk_Blk.woff2` is local-only (licensed) with Archivo as fallback.
- [ ] **Step 5: Final run** — `cd web && npx vitest run && npm run build` and `PYTHONPATH=scripts .venv/bin/python -m pytest tests -q` → all PASS.
- [ ] **Step 6: Commit** — `git add docs/superpowers/reports/2026-09-25-v2-visual-check.md README.md && git commit -m "Web viewer v2: UI visual check, performance, README"`
- [ ] **Step 7: Hand back** — summarise Stage A results against the targets and ask the user whether to run Stage B (rebake).
