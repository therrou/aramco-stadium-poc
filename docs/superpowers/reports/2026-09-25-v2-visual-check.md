# Web viewer v2 visual check vs Cycles references

Branch `web-viewer-v2`. Plan: `docs/superpowers/plans/2026-09-25-web-viewer-v2.md`. Spec: `docs/superpowers/specs/2026-09-25-web-viewer-v2-design.md`.

## Method

- Cycles references: `renders/ref_web/<CAM>_<state>.png` (1920×1080, 128 spp, from v1 Task 14; gitignored).
- Web capture: `npx vite --port 5173` in a visible Chrome tab at `?size=1920x1080` (drawing buffer 3840×2160 at DPR 2).
  In the page, for each camera the pose and exposure are applied with `__viewer.rig.jump`, the state with
  `__viewer.setState`, the transition is finished with `__viewer.tick(0.5)` ×10, then `__viewer.stats()`
  (mean Rec.709 luma 0..255 of the 8-bit output, and clipped share = max channel ≥ 250) and
  `__viewer.save(name)` (dev-server endpoint → `renders/web_v2/<name>.png`, gitignored).
- Reference metrics and side-by-sides: `PYTHONPATH=scripts .venv/bin/python -m webexport.framestats stats|pair|pop`
  (same definitions as `web/src/frameStats.ts`, pinned by `tests/webexport/test_framestats.py`).
- Camera-nudge test: `CAM_Aerial_Dusk`, night; frame A, `__viewer.nudge(1.8)` (1.8 m to camera right), frame B.
  Popping (`framestats.popping`): frame B is aligned to A by the best global integer shift (the nudge moves
  the stadium ~15 px at 3840 px), then it is the share of bright pixels (luma > 160) with no bright pixel within
  3 px in the other frame, in the stadium box (0.3, 0.3)–(0.8, 0.65). Halos that appear or vanish count, and
  residual parallax does not.

## v1 baseline (before any Stage A change)

| Camera | State | Cycles mean | web mean | ratio | Cycles clipped | web clipped |
|---|---|---:|---:|---:|---:|---:|
| CAM_Aerial_Dusk | day | 151.1 | 154.6 | 1.02 | 1.55 % | 2.56 % |
| CAM_Aerial_Dusk | golden | 104.0 | 103.9 | 1.00 | 8.51 % | 9.60 % |
| CAM_Aerial_Dusk | night | 61.2 | 54.5 | 0.89 | 2.10 % | 2.81 % |
| CAM_Approach | day | 181.9 | 192.9 | 1.06 | 1.25 % | 2.53 % |
| CAM_Approach | golden | 156.5 | 137.4 | 0.88 | 0.43 % | 0.76 % |
| CAM_Approach | night | 121.5 | 83.9 | 0.69 | 2.10 % | 1.57 % |
| CAM_Seat_212 | day | 105.6 | 155.4 | 1.47 | 0.00 % | 0.86 % |
| CAM_Seat_212 | golden | 140.4 | 152.5 | 1.09 | 0.20 % | 0.90 % |
| CAM_Seat_212 | night | 171.9 | 150.0 | 0.87 | 8.12 % | 4.16 % |

Nudge popping (v1): **0.0115**.

Visual notes (v1 side-by-sides): whole-frame means are close from far away, but the web frames look milky and
low in contrast. The sails and the podium read as uniform bright chrome (Approach day), and the pitch and seats
are hazy and desaturated (Seat_212 day, 1.47× Cycles). At night the sails are silver with a few large blooming
LEDs where Cycles shows dark skin with a dense stipple. The mock "taken" seats show grey.

## After A1 (specular occlusion, K day 2.0 / golden 1.0 / night 1.2, min 0.1)

Means: Aerial_Dusk 151.9 / 100.7 / 50.5, Approach 187.2 / 133.0 / 76.3, Seat_212 151.4 / 152.1 / 150.0 (day / golden / night).
No shader errors. Podium glass under the canopy is darker (occluded). The sunlit sails are unchanged, since their
irradiance is above K; they still read as chrome where Cycles shows pearl white (A2/A5 and Task 8).

## After A2/A5 and A3 (LED coverage)

Nudge popping at `CAM_Aerial_Dusk` night: **0.0016** (v1 0.0115, 7× lower). In the crops, the v1 frames show large
bloom halos at different places in A and B. After A3 the sails carry a dense, fine stipple that is the same in both
frames, much like the Cycles night reference. Night means: Aerial_Dusk 49.6 (Cycles 61.2), Approach 71.9 (121.5).

## After A4 (flood lens cap 30, front side only)

The lenses are still visible from inside the bowl (`CAM_Bowl` night), so FrontSide faces the pitch. Clipped share at
`CAM_Aerial_Dusk` night went from 2.81 % to 2.49 % (Cycles 2.10 %). Roof-glow box tuning is in Task 8.

## After A7 (lightmap mips)

Mips on every lightmap group came to 37.21 MB (budget 35 MB). zstd 22 gave 37.19 and UASTC RDO λ 0.5–1 saved 4–7 %
per file, so neither was enough. Only the far `site` lightmaps (all 3 states, 11 levels, trilinear) carry mips:
**34.53 MB** total. The other groups are single-level, as before.

## After A6 (tier colours, bowl factor)

`scripts/webexport/measure_bowl.py` (the FLOOD method on the up-facing treads of `bowl__M_Concrete`):

| State | open treads mean | roofed treads mean | all mean | web model (ambient + sun) | bowl factor |
|---|---:|---:|---:|---:|---:|
| day | 0.70 | 0.84 | 0.80 | 3.59 | **0.223** |
| golden | 0.84 | 0.91 | 0.89 (flood 0.48 subtracted) | 1.53 | **0.269** |

The plan expected only the roof to shade the sun. The bake shows the whole bowl gets ~¼ of the open-sky
light (the roof, sails and stands block most of the sky and the low sun), and open and roofed treads barely differ.
So the seats' ambient + sun is scaled by one per-state factor inside the shell plan. Night stays 1, because FLOOD
was calibrated against the full ambient. `CAM_Seat_212`: day mean **100.3** (Cycles 105.6, v1 155.4), golden 120.3
(140.4), night 137.2 (171.9). The seats now sit at the treads' brightness. Tier hues are the aramcostadium.com
swatches (Lower green, Club sand, Upper blue) at the Cycles seat luminance, so they are more saturated than
Cycles' teal green by design.

## Stage A result (Task 8 tuning; captures `renders/web_v2/v2a_*`, side-by-sides `pair_v2a_*.jpg`)

| Camera | State | Cycles mean | web mean | ratio | Cycles clipped | web clipped | v1 ratio |
|---|---|---:|---:|---:|---:|---:|---:|
| CAM_Aerial_Dusk | day | 151.1 | 151.5 | **1.00** | 1.55 % | 2.55 % | 1.02 |
| CAM_Aerial_Dusk | golden | 104.0 | 99.3 | 0.96 | 8.51 % | 9.47 % | 1.00 |
| CAM_Aerial_Dusk | night | 61.2 | 48.3 | 0.79 | 2.10 % | 2.47 % | 0.89 |
| CAM_Approach | day | 181.9 | 182.8 | **1.00** | 1.25 % | 2.47 % | 1.06 |
| CAM_Approach | golden | 156.5 | 132.7 | 0.85 | 0.43 % | 0.64 % | 0.88 |
| CAM_Approach | night | 121.5 | 72.3 | 0.60 | 2.10 % | 0.88 % | 0.69 |
| CAM_Seat_212 | day | 105.6 | 100.3 | **0.95** | 0.00 % | 0.86 % | 1.47 |
| CAM_Seat_212 | golden | 140.4 | 120.3 | 0.86 | 0.20 % | 0.90 % | 1.09 |
| CAM_Seat_212 | night | 171.9 | 137.2 | 0.80 | 8.12 % | 4.16 % | 0.87 |

**Acceptance**
- Day frame means within ±15 % of Cycles: **met** (1.00 / 1.00 / 0.95).
- Roof-glow clipped share, box (0.35, 0.32)–(0.59, 0.45) of `CAM_Aerial_Dusk` night: Cycles **3.44 %**, v1 14.4 %,
  v2 **3.70 %** (target ±2 points): **met**.
- Camera nudge (1.8 m, `CAM_Aerial_Dusk` night, aligned): popping **0.0056** against v1 0.0115, with 15× more LED dots
  (below). The v1 halos that appeared and vanished are gone. What remains is 1–2 px dots flickering around the
  metric's luma threshold, and the pattern stays the same between frames in the crops.
- Performance, `CAM_Bowl` night, 3840×2160 drawing buffer (1920×1080 at DPR 2), measured synchronously
  (tick + 1 px readPixels, since rAF is throttled in the background window): **10.1 ms/frame (~99 fps)**,
  **1.56 M triangles**, **89 draw calls**. This machine may be faster than the M1 target.
- Assets: **34.53 MB** (budget 35 MB).

**Final constants**
- `SPEC_OCC` K day 2.0 / golden 1.0 / night **0.5**, floor 0.1, sail skin floor **0.5**. The night K was lowered from
  1.2 because the lit sails and podium lost all reflection at 1.2 (Approach night went black).
- `ENV_INTENSITY`: ground 0.3, concourse/suite glass 0.3, grass 0.2, steel 0.5 (plan values met the day target).
- `SAIL_NIGHT_ENV` **1.0**, so A5's fade is off. With A1 and the sail floor, the night sails match Cycles' lit grey skin,
  and 0.5 made the Approach night sails black.
- `FLOOD_LENS_MAX` 30. `BLOOM` threshold **16** (was 12): the `M_SignWhite` sign letters (night emission 14)
  bloomed into a large blob at `CAM_Approach` night. Strength 0.35 and radius 0.15 are unchanged.
- LEDs: the v1 3D lattice (1.1 m cells, r 0.055 m) put 0.052 % coverage on the skin, where Cycles draws 2D UV
  Voronoi dots at 0.785 % (15× denser). The lattice is now cell **0.5463 m**, r **0.0674 m**, which matches Cycles'
  dots per m² and coverage. The dot footprint is at least 1 px, and `LED_MAX` is **15** (below the bloom threshold).
- `BOWL` day 0.223 / golden 0.269 / night 1 (measured, see A6).

**Remaining gaps → Stage B candidates**
- Night plaza and paving are dark where Cycles' glossy paving reflects the lit facade (`CAM_Approach` night 0.60).
  The web reflects only the sky, and the `site_near` night lightmap is coarse. Bigger or denoised site lightmaps
  (B2/B3) would help the lamp pools. Facade reflections would need screen-space or planar reflections, which is outside both stages.
- Night sails show faint texel blocks from the 1024 px night sail lightmap, and the pitch is blotchy in golden and night
  (2–6 % bake noise). B2 (denoise) and B3 (larger atlases) address both.
- The podium columns, canopy columns and bridge piers are still missing (B1). The podium still reads as a flat
  wall at `CAM_Approach`.
- The upper-tier seats are blue (spec tier colours), where Cycles has uniform green seats. This is a product choice, not a fidelity bug.

Stage B (rebake, 2–5 h) awaits the user's decision.

## Seat finder UI check (Task 15, visible Chrome tab; flights driven with `__viewer.tick` where rAF was throttled)

| # | Check | Result |
|---|---|---|
| 1 | Hover a seat (Stadium view): tooltip with section · row · seat, tier, click hint; it hides on pointer leave, drag and flight | ✓ (e.g. "Section 306 · Row 22 · Seat 4, Upper tier") |
| 2 | Seats behind the roof or sails from `CAM_Aerial_SW` (Review Focus 4): a 456-point NDC grid over the stadium gave 20 accepted picks, all inside the oculus (NDC x −0.2…0.2, y 0.10…0.25) | ✓ |
| 3 | Click a seat: pulsing highlight, flight to seat view, seat card, `?seat=` in the URL; the drag direction follows the pointer | ✓ after a fix: v1 look mode was inverted, so `rotateSpeed` is now −0.35 (test added) |
| 4 | Zoom and Reset in seat view keep the eye (Review Focus 2): the eye is unchanged, hfov 70 → 49 → Reset 70; overview zoom dollies 100 → 70 m | ✓ |
| 5 | Back / Esc / Overview control: view is overview, orbit mode, `seat` removed from the URL | ✓ |
| 6 | Finder lists only real values; See the view flies there; the finder syncs to a clicked seat | ✓ |
| 7 | All 10 hero views land on their camera; Stadium / Exterior / Top view land and show pressed; Auto orbit moves (9.9 m in 2 s at Exterior) and stops on user input | ✓ |
| 8 | Lighting change in seat view keeps the seat; Auto orbit is disabled and ignored in seat view (Review Focus 3) | ✓ |
| 9 | Fonts: "Aktiv Grotesk" 900 loaded and used by headings; body Archivo 400 | ✓ |
| 10 | Deep links: `?seat=212-2-3` opens seat view; `?seat=212-10-4` (not a real seat) opens the overview and drops the param | ✓ |
| 11 | Narrow (390×844 same-origin iframe; the window itself could not be resized): bottom sheet collapsed to its title bar, expands on tap; canvas = stage 390×792 CSS px (Review Focus 5); mode bar fits | ✓ after a fix: the mode bar overflowed with a scrollbar and was tightened |

Not verified live: "Copy link" writing to the clipboard (the background window has no clipboard focus); the
"Link copied" state is wired to the promise. The interaction GIF was not exported, because it would be a browser
download.
