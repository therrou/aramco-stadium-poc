# Web viewer visual check vs Cycles references (Task 14)

Branch `web-viewer`, base commit `fbd48ce`. Full-quality (256 spp) lightmap bake was already done
(Task 10, Step 7 / commit `fbd48ce`); this task adds the Cycles reference stills, a side-by-side
visual check against the live viewer in all three lighting states, performance numbers, and the
README section.

## Reference renders

`scripts/webexport/refs.py` (`render_one(cam, state, samples=128, width=1920, height=1080)`),
driven from the open Blender MCP session (never headless, per `blender-context.md`). It restores
the render scene's camera, `scene["night"]`, `render.filepath`, `cycles.samples` and resolution
after each render — the `.blend` was never saved.

All 9 references rendered at **1920×1080, 128 spp** (no fallback to 1280×720/64 spp was needed;
each render took 105–120 s on the loaded machine). Output: `renders/ref_web/<CAM>_<state>.png`
(9 files, gitignored, not committed):

- `CAM_Aerial_Dusk_{day,golden,night}.png`
- `CAM_Approach_{day,golden,night}.png`
- `CAM_Seat_212_{day,golden,night}.png`

## Viewer capture

`npx vite --port 5173 --strictPort` served `web/public/assets` (already built by
`scripts/optimize_web.sh` from the full-quality bake). Each combination was opened at
`http://localhost:5173/?cam=<CAM>&state=<state>&size=1920x1080`, allowed to finish loading, and
screenshotted after a settle, then compared against the matching Cycles reference with `Read`.

## Comparison table

| Camera | State | Composition | Lighting mood | Colour | Notes |
|---|---|:---:|---|---|---|
| CAM_Aerial_Dusk | day | ✓ | matches | close; web site reads slightly greener/less khaki than the render's warmer sand tone | expected: no crowd figures/tensioned-fence sails at plaza in the web version (not exported); sun specular streak on the sails is stronger/sharper in Cycles (AgX look difference, expected gap) |
| CAM_Aerial_Dusk | golden | ✓ | matches | warm sky gradient reproduced well | roof highlight placement matches; minor AgX-vs-Cycles-AgX contrast difference in shadow density |
| CAM_Aerial_Dusk | night | ✓ | matches | city glow and bowl glow both read correctly | night facade LED speckle is visibly sparser in the web version than Cycles' dense stipple — this is the known Task 13b gap (far-site lightmap / LED density), not re-tuned here |
| CAM_Approach | day | ✓ | matches | matches | **known gap confirmed**: the podium level below the sail canopy reads as a flat white wall in the web viewer, where Cycles shows glazed bays and columns — this is geometry/texture detail lost in the export, out of scope for the constants-only tuning this task allows |
| CAM_Approach | golden | ✓ | matches | matches | same podium-wall gap; sail underside gradient reproduced reasonably |
| CAM_Approach | night | ✓ | matches | web frame has a brighter/more diffused glow at lower-left (podium floodlight bloom) than the equivalent area in Cycles | consistent with the documented "bright canopy underside near floodlights at night" gap from Task 13b; same podium-wall gap as day/golden |
| CAM_Seat_212 | day | ✓ | matches | web pitch/seats read slightly desaturated vs. Cycles' more saturated green | expected AgX-look difference; no crowd (expected gap) |
| CAM_Seat_212 | golden | ✓ | matches | matches | matches well; stripe pattern and goal placement line up |
| CAM_Seat_212 | night | ✓ | matches | matches | day and night are similarly bright at seat level in **both** Cycles and the web viewer — this is correct (floodlights bring night brightness close to day at pitch level), not a bug |

Composition (camera framing, FOV, horizon/pitch alignment) matched the Cycles references in all 9
cases. No cases were flagged ✗.

## Tuning (Step 4)

No constants were changed. The Task 13b pass had already tuned `EXPOSURE` (via
`manifest.EXPOSURE` / `lightingState.exposure`), `BLOOM.threshold/strength`, and `TREE_AMBIENT`;
the 9-way comparison above did not surface a case clearly calling for a further change (no milky
bloom haze, no state reading over/under-exposed relative to its Cycles reference). `uRgbmRange`
was left at 16 (ruling R10; the viewer reads it from `manifest.rgbmRange`), untouched, per the brief. Current tuned values (unchanged from 13b):

- `manifest.EXPOSURE` / `lightingState`: day 0.25, golden 0.55, night 0.75 (stops, mirrors
  `lighting._render_settings: 0.25 + 0.5*night`)
- `BLOOM = { strength: 0.35, radius: 0.15, threshold: 12.0 }` (`web/src/lighting.ts`)
- `TREE_AMBIENT = { day: 0.9, golden: 0.55, night: 0.12 }` (`web/src/treeLight.ts`)

`web/src/lighting.ts` and `web/src/lightingState.ts` are unmodified by this task.

## Performance

Measured via the browser automation tab. The tab's `document.visibilityState` stayed `"hidden"`
intermittently even after the window was clicked/focused (the known automation-tab gotcha from
`browser-context.md`), which made the live `__viewer.fps` (rAF-driven) vary between 22 and 92 fps across repeated reads at
the same URL, with the automation tab's visibility. Where `visibilityState` read `"visible"` the
rAF fps was clean and well above threshold, so those are reported as the primary number. The
forced-tick loop (`renderer.info.reset()` + `__viewer.tick(1/60)` + `gl.getContext().finish()`,
60 frames, bypassing rAF throttling) is a cross-check of one thing only: the CPU time to submit
one frame plus the wait for the GPU to finish it. It is **not** a frame time and its inverse is
**not** an achievable fps: it leaves out compositing, presentation, vsync and the browser's own
work, and Chrome's `finish()` may return before all GPU work has retired.

`?cam=CAM_Aerial_SW&state=night&size=1920x1080&stats=1`:
- triangles: **1,298,521** (≤ 2,000,000 ✓)
- draw calls: **90** (≤ 250 ✓)
- fps (rAF, `visibilityState: "visible"`): **92.6**
- forced-tick cross-check (CPU submit + `finish()`, not frame time): median 0.4 ms, max 0.9 ms over 60 frames

`?cam=CAM_Seat_212&state=night&size=1920x1080&stats=1`:
- triangles: **1,648,369** (≤ 2,000,000 ✓)
- draw calls: **91** (≤ 250 ✓)
- fps (rAF, `visibilityState: "visible"`): **105.1**
- forced-tick cross-check (CPU submit + `finish()`, not frame time): median 0.4 ms, max 9.2 ms (one outlier, likely a GC/shader-cache pause) over 60 frames

Both cameras clear the fps ≥ 50 target by a wide margin; no perf fixes (pixel ratio, half-res
bloom, `SEAT_LOD_DIST`) were needed.

## Build / test / optimize

- `scripts/optimize_web.sh`: **32.09 MiB TOTAL** (= 33.65 MB decimal; limit 35 MB = 35e6 bytes, which `sizecheck.py` now reports in decimal MB) — full pass, rebuilt
  `web/public/assets` from the full-quality `build/web_raw` bake.
- `cd web && npx vitest run`: **14 files / 59 tests passed**.
- `cd web && npm run build` (`tsc --noEmit && vite build`): passed, no type errors; vite build
  emitted the usual >500 kB chunk-size advisory (pre-existing, not a failure).
- Host `pytest` (`.venv/bin/python -m pytest -q`): **41 passed**.

## Remaining gaps (carried from Task 13b, still present)

- Podium façade reads as a flat white wall on the `CAM_Approach` framing (geometry/texture, not a
  lighting constant — confirmed present in all three states this task).
- Night facade LEDs are sparser in the web viewer than the Cycles reference's dense stipple
  (far-site lightmap coarseness, ~6.5 m/texel).
- Bright/diffused canopy underside glow near floodlights at night (`CAM_Approach_night`).
- No crowd geometry and no sun specular streak on sails in the web export (both expected,
  documented gaps — not defects).
- Seats have no shadowing by day in the web viewer (unchanged from 13b).

None of the above were introduced or worsened by this task; none required constants-only tuning
to correct, per the brief's tuning order and scope.

## Addendum (final review): pitch line markings

The "dark halfway line" reported in Task 11 was the line markings themselves (halfway line, goal
lines, penalty/goal-area fronts) reading dark grey. The 6-12 cm wide `M_LineWhite` strips get
lightmap charts well under one texel in the 256 px pitch atlas, so each strip sampled whichever texel
its sliver landed on, often padding. No rebake: flat line fragments now take their lightmap UV from
the grass's four planar quadrant charts at their own position (`web/src/pitchLines.ts`), per fragment,
so the halfway line on the x = 0 chart seam uses the right chart on each side. Goal posts keep their own
UVs. Checked at CAM_Bowl day and night: all markings white.
