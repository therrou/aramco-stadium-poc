# Aramco Stadium web viewer v3: design

Date: 2026-09-25
Status: approved in chat ("yes"), 2026-09-25
Builds on: `2026-09-25-web-viewer-v2-design.md` (merged at `3dc8826`)

## Goal

The web scene should look as close as possible to the Cycles renders (reference: the user's night top-view
render of 2026-09-25, plus `renders/ref_web/*`), and the camera should move in a way a visitor finds obvious.

The user's review of v2 (8 screenshots) found:
- low-quality grass and goals;
- confusing flights through the stadium, the seat approach ("over the seat, down, then snaps to the
  field") and the Overview transition from inside;
- two-colour triangles on the sails;
- big pixel chunks on the surroundings, buildings and lawns;
- an unlimited zoom-out.

## Diagnosis (why v2 constants could not fix it)

| Symptom | Cause |
|---|---|
| Seat approach dives and snaps | `poseAt` lerps the look-at target in a straight line, independently of the eye. The seat pose's target is 0.1 m ahead of the eye, so mid-flight the camera looks at the seat from above and only turns to the pitch at the end. |
| Flights through the shell | `pathPoint` is a single quadratic through (0, 0, max(z, 180)) with the same target lerp. It has no notion of approach side or of where to look. |
| Unlimited zoom | `maxDistance` 2500 m. Pan is unclamped, and the eye can go below ground. |
| Blotchy, blurry grass | The pitch lightmap is 256 px (about 0.5 m/texel, not denoised at 256 spp). The grass colour is a 1024 px bake of Blender's procedural shader (about 12 cm/texel). |
| Goals | The posts are thin tubes. The net is flat planes at alpha 0.35, the same as the .blend (pitch.py `_goal`). |
| Sail triangles and blocks | The sail lightmap is 1024 px over the whole shell, charted on a 16 m grid with mismatched chart edges. |
| Pixel chunks on the site, buildings and lawns | The site lightmap is about 6.5 m/texel, bilinear, noisy. The buildings are boxes lit only by it. |

A rebake at 2048 px (v2 Stage B) halves texel size at best, and the 35 MB budget caps it there. So the
approach changes: the lightmaps carry only soft, low-frequency light, and sharpness comes from real-time
shading and procedural or tiling detail.

## Part 1: camera (first)

C1. **Orientation follows the path.** A flight interpolates the view direction with a quaternion slerp and
the look-at distance separately (log-lerp), instead of lerping the target point. The target is derived as
eye + dir × distance. A flight can have an intermediate look keyframe (below).

C2. **Routes.** `route(from, to)` returns waypoints for a smooth path (centripetal Catmull-Rom through
the waypoints, eased by arc length). Each route specifies its look keys:
- **Outside → inside** (overview/exterior → seat/hero/bowl): rise if needed to an apex above the oculus
  (≥ 40 m above the rim), look down at the pitch at the apex, descend through the oculus, then approach the
  destination from the pitch side.
- **Inside → outside** (Back/Overview/Exterior from inside): the reverse. Rise to the pitch centre, then
  vertically out through the oculus while looking down at the pitch, then pull back to the exterior pose,
  turning to its view. The camera never passes through the roof, the sails or the stands.
- **Inside → inside:** an arc over the pitch, lifted by 10-20 % of the chord.
- **Outside → outside:** an arc around the stadium at no less than 1.3 times the shell radius from its
  centre, so a flight never cuts through the shell.

C3. **Seat approach.** The last segment comes in from the pitch side and above the seat (a waypoint 6 m up
and 8 m toward the pitch centre), already looking at the pitch. No dive through rows, no final snap.

C4. **Duration** scales with path length: 1.2 s at the shortest, 3.2 s at the longest, eased in-out by arc
length so the speed is continuous.

C5. **Limits.**
- Orbit distance 15-900 m.
- The orbit target is clamped to a 320 m disc around the stadium and z 0-60 m.
- The eye stays at least 3 m above the ground outside the shell, and inside the shell it stays in the
  bowl's air volume.
- Pan is clamped by the same disc.
- The polar limit is kept (v2).
- Seat view keeps look-around with fov zoom (v2), and the scroll wheel maps to the fov zoom there.

C6. **Tests** (Vitest, pure functions):
- a route never enters the shell volume except through the oculus;
- the look direction is continuous (no step greater than 8° between samples at 60 fps for a 1.5 s flight);
- the seat approach ends looking at the pitch centre;
- the duration stays within its bounds;
- the target and eye clamps hold.

The existing flyto and camera tests are updated.

## Part 2: detail pass (no rebake)

D1. **Pitch shader.** Port Blender's procedural grass (pitch.py `_grass_material`) to GLSL:
- 20 mowing bands along x (5.25 m);
- two base greens (0.045, 0.16, 0.035) and (0.07, 0.23, 0.05);
- the noise at scale 0.35 multiplied at 0.35;
- the fine bump noise at scale 400 as a normal perturbation with a distance fade;
- roughness 0.85.

The pitch lightmap supplies only lighting, sampled bicubic (D3), and not the grass colour. The pitch lines stay.

D2. **Goals.** Keep Blender's goal geometry (posts: tubes r 0.06 m). Give the net a procedural mesh
shader (about 12 cm square cells, 1.5 cm cords, alpha-tested with an anti-aliased coverage fade at distance,
two-sided, white 0.95). Post and net materials are unlit by the lightmap and use the outdoor model from
`treeLight` (sun + ambient + floods), so they read crisp.

D3. **Lightmap filtering.** Bicubic (B-spline, 4 taps using hardware bilinear) sampling for every lightmap,
removing the blocky texel edges.

D4. **Denoise the existing bakes.** Run OIDN through the open Blender session (compositor Denoise node,
driven by the MCP, never headless) on the decoded float lightmaps, chart-aware (dilate before, mask after),
re-encode to RGBM, then run `optimize_web.sh`. No re-render, about 30 min. Budget still 35 MB.

D5. **Detail textures.** Tiling, high-frequency albedo detail (CC0, Poly Haven, 512 px KTX2, about 1-2 MB in
total) for the lawn, sand, paving and plaza, blended with distance. The lightmap stays low-frequency. The
buildings get a procedural facade (window grid by floor, emissive windows at night by hash) instead of lightmap-only boxes.

D6. **Sails without lightmap.** The sail skin is an unoccluded exterior shell:
- light it with the analytic sun + sky IBL and a specular horizon occlusion;
- at night add the floods' spill (a smooth radial term from the bowl) and the LEDs;
- use no lightmap sample, so there are no chart seams or blocks.

The underside (M_SailUnder) keeps its bake.

## Part 3: real-time sun shadows (last, gated by fps)

S1. Use a directional sun with cascaded shadow maps (three `CSM` addon or 2-3 manual cascades) for day and
golden hour. Shadows fall on the pitch, seats, stands and site. The lightmaps then carry only indirect light:
use the bake's ambient share, or scale the lightmap down where the shadow term applies.

S2. Keep it only if the v1 targets still hold (≥ 50 fps at 1080p on M1, ≤ 250 draw calls). Otherwise
drop it, and D1-D6 stand alone.

## Acceptance

- Camera: every flight in the UI (seat ↔ overview, hero ↔ hero, mode bar) is checked in a visible tab with a
  frame strip in the report: no pass through geometry, no snap, speed continuous. Limits are enforced.
- Visual: the 9 cam/state side-by-sides against Cycles, plus close-ups (pitch from a lower seat, goal,
  sails, site from the exterior). The pitch, goals and sails show no visible texel blocks or chart seams at
  1080p. The day means stay within ±15 %.
- Performance and the budget as in v1/v2.

## Out of scope

A Stage B rebake (reconsidered after Part 2), crowd, prices and checkout.
