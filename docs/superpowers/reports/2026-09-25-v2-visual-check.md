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
