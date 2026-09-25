# Aramco Stadium web viewer v2: design

Date: 2026-09-25
Status: approved in chat, pending review of this document
Builds on: `2026-09-24-web-viewer-design.md` (phase 2, merged at `ce50ee1`)

## Goal

**Primary goal (user, 2026-09-25): the whole web scene must look as close as possible to the Blender/Cycles
version.** Secondary: turn the viewer into a Camp Nou-style "find your seat" experience styled like
aramcostadium.com.

Two sub-projects, one plan:

1. **Rendering fidelity**, Stage A (shader and constant fixes, no rebake). Stage B (rebake) only if A does not get
   close enough to the Cycles references (user decision).
2. **Seat finder UI**: seat finder only. No prices, cart or checkout (user decision).

## Findings driving the rendering work

From a read-only comparison of the web viewer against `renders/ref_web/*` (3 cams x 3 states), with
screenshots in the session scratchpad:

| Complaint | Root cause |
|---|---|
| Day too bright / washed out | `M_SailSkin` is metallic 0.9 + clear coat: ~90 % of its look is sky reflection (PMREM) that the lightmap never occludes (`stadium.ts` `patchLightsChunk` only scales diffuse). `M_ConcourseGlass` (metallic 0.6, rough 0.08) mirrors the ~3.6 horizon: podium mean 202 on the web vs 97 in Cycles. `M_Grass` has full sky reflection. Near seats use bright availability green with no shadowing. Exposure formulas match Blender, so exposure is not the cause. |
| Night lights too bright | `M_FloodLens` emits 120 (glb `emNight`) against a bloom threshold of 12, and all materials are double-sided: a ring of halos. 9 % of the roof-glow area is clipped on the web vs 3 % in Cycles. The sails mirror the sunset sky at night, where Cycles shows dark skin with dense LEDs. |
| "Lights re-render" when the camera moves | Sail LEDs (`LED_GLSL`) are hard 0.055 m dots, far smaller than a pixel: each one is hit or missed per frame, and at 40 x n emission each hit blooms. A 1.8 m camera nudge makes glows pop. Lightmaps without mips shimmer at distance (secondary). |
| Triangles in different colours | Lightmaps are too coarse (structure 0.72 texels/m, bowl 1.26, sails 1.75, far site ~6.5 m/texel) and not denoised (2-6 % per-texel noise at 256 spp). Thin members fall between texels, so each triangle samples an arbitrary texel. Sail charts are cut on a 16 m grid, so seams show. |
| Detail / "terminations" | `Podium_Columns`, `Canopy_Columns` and `Bridge_*_Piers` evaluate to material `None` and `webscene.py` skips them. Transmissive glass becomes flat alpha 0.35. The crowd is excluded by design. |

## Part 1: rendering fidelity

### Stage A (no rebake)

A1. **Lightmap-occluded reflections.** In the patched `lights_fragment_maps`, scale `iblRadiance` and
`clearcoatRadiance` by a specular occlusion derived from the blended lightmap irradiance:
`so = clamp( luminance( lightMapIrradiance ) / K, SO_MIN, 1.0 )`. K is per lighting state, because irradiance
scales with the state (day sun vs night floods); SO_MIN is about 0.1. Constants live in `stadium.ts`, with tests
on the chunk patch.

A2. **Reflection strength per material.** Extend the `GROUND_RE` idea to a table `ENV_INTENSITY` keyed by
material-name regex: ground 0.3 (unchanged), `M_ConcourseGlass` / `M_SuiteGlass` about 0.3, `M_Grass` about
0.2, `M_Steel` about 0.5. Values are tuned against the references.

A3. **Anti-aliased sail LEDs.** Replace the `step` dot with a pixel-footprint-aware coverage
(`fwidth(pB)`): a smoothstep edge near the camera, and a fade to the dot's average radiance (coverage x
intensity) once a dot is smaller than about 1 px. That removes popping. LED radiance is clamped below
the bloom threshold, so LEDs never bloom individually.

A4. **Bloom and flood lenses.** Cap `M_FloodLens` night emission at about 30 in the viewer (userData override
in `stadium.ts`) and make it single-sided. Retune `BLOOM` (threshold/strength) against
`CAM_Aerial_Dusk_night` and `CAM_Approach_night`. Target: clipped roof-glow share within ±2 points of
Cycles (3 %).

A5. **Night sails.** With A1 the sunset reflection on the sails drops with the (dark) night lightmap. If
the sails still read silver at `CAM_Aerial_Dusk_night`, lower the sails' env intensity by `uNight`.

A6. **Seats.** Tier colours (Part 2) at albedo values that match the Cycles seat material's brightness,
plus a roof-shadow factor in `treeLight.ts`'s outdoor light: seats inside the shell plan and under the
roof get the sun term scaled by a constant measured from the bowl lightmap (the same method as `FLOOD`).

A7. **Lightmap mips.** In `optimize_web.sh`, encode KTX2 lightmaps with mipmaps and sample them with
`LinearMipmapLinear`. RGBM does not filter exactly across mips, but the error is small next to the aliasing.
Re-encoding only, no rebake. Check the 35 MB budget (currently 32.09 MiB).

**Stage A acceptance:** for each of the 9 cam/state pairs, a web screenshot beside the Cycles reference in a
report (`docs/superpowers/reports/2026-09-25-v2-visual-check.md`), plus the camera-nudge test (no
LED/bloom popping between two frames 1.8 m apart). Frame mean within about 15 % of Cycles on the three
day frames. Performance targets from the v1 spec still hold (≥ 50 fps at 1080p on M1, ≤ 2M tris, ≤ 250 draw
calls). The user decides whether to go to Stage B.

### Stage B (fallback, only on user go-ahead)

B1. Export the dropped meshes (`Podium_Columns`, `Canopy_Columns`, `Bridge_*_Piers`) with a default
material in `webscene.build`.
B2. Denoise each bake (OIDN on the float image) before RGBM encoding.
B3. Bowl and structure atlases to 2048. Re-check the 35 MB budget.
Rebake of all three states through the open Blender session (MCP, never headless): about 2-5 h. The
rebake gets its own short plan when triggered.

## Part 2: seat finder UI

### Style (from aramcostadium.com, read via Chrome 2026-09-25)

| Token | Value |
|---|---|
| `--navy` | `#010532` (base background) |
| `--white` | `#FFFFFF` (text, pill buttons) |
| `--muted` | `#5F6369` / white at 60 % on navy |
| `--green` | `#00D246` (eyebrows, dates, Lower tier) |
| `--blue` | `#1480DB`, `#3860BE` (strokes, links, Upper tier) |
| `--sand` | `#EFE3C8` (Club tier) |
| Headings | Aktiv Grotesk Black is licensed, so `font-family: "Aktiv Grotesk", "Archivo", sans-serif` at weight 900, UPPERCASE, line-height about 1.1. Archivo is loaded from Google Fonts. |
| Body | `"Aktiv Grotesk", "Archivo", sans-serif` at 400 |
| Buttons | White pill, navy uppercase 900 text 11-13px, chevron ›. Round outlined icon buttons. |

No Aramco logo file: the wordmark is set as text.

### Layout

- **Header** (navy): "ARAMCO STADIUM" wordmark, green eyebrow "AL KHOBAR · SAUDI ARABIA", and an "About the
  stadium" button that opens a short info card.
- **Left sidebar** (about 380px):
  - Green eyebrow "A PLACE IN THE STANDS", h1 "TAKE YOUR SEAT.", and a short intro line.
  - An Overview / Seat view segmented control. Seat view is disabled until a seat is chosen.
  - **Find your seat**: Tier → Section (filtered by tier) → Row → Seat. Options come from `seats.bin`, so only
    real rows and seats are offered.
  - "SEE THE VIEW ›" white pill button, and the hint "Or click any seat in the stadium".
  - **Views worth exploring**: the `CAM_Seat_*` hero cameras, each labelled by tier and position (e.g. "The
    centre-line classic · Club").
- **Viewport overlays**:
  - Top left: title "ARAMCO STADIUM." with the location.
  - Top right: lighting dropdown (Day / Golden hour / Night).
  - Right: zoom +, zoom −, reset view, fullscreen.
  - Bottom centre: a pill bar with Stadium (`CAM_Bowl`), Exterior (`CAM_Aerial_SW`), Top view (`CAM_Top`) and
    Auto orbit (toggle), plus a hint row (drag to orbit · scroll to zoom · click a seat).
- **Narrow screens (< 900px)**: the sidebar becomes a bottom sheet (collapsed to its title bar), and the overlays
  shrink.

### Seats and interaction

- **Seat colours by tier**: Lower green, Club sand, Upper blue, at albedo values set per A6. Mock
  availability (`availability.ts`, legend, taken grey) is removed.
- **Hover** (pointer move, throttled to about 20 Hz, suspended while dragging or flying) shows a tooltip:
  "SECTION 212 · ROW 10 · SEAT 4", the tier, and "Click to take this seat ↗".
  - Far away: raycast the section strips (`SectionPatches`, which get a per-face row index), then snap to the
    nearest seat of that row from `seats.bin`.
  - Near: raycast the visible seat instances.
  - Either way the hit must pass the existing `DepthProbe` / `acceptPatchHit` wall check.
- **Select** (click or "See the view"): the seat gets a pulsing highlight. The camera flies (existing
  `CameraRig.flyTo`, with an exposure flight) to the seat's eye: seat position + 1.2 m up, looking at the pitch
  centre (0, 0, 0) with an hfov of about 70.
- **Seat view**: look-around only. OrbitControls target is placed 1 m in front of the eye, with pan and dolly
  disabled, so dragging turns the head. The sidebar shows a seat card (section, row, seat, tier), "Back to
  overview", and "Copy link". Esc goes back.
- **Deep link**: `?seat=<section>-<row>-<seat>` opens in seat view. Invalid values are ignored.
- **Views worth exploring and mode bar**: fly to the named camera pose with its exposure. Auto orbit sets
  `controls.autoRotate` and stops on any user input.

### Code structure

- `state.ts`: `View = overview | seat{section,row,seat}`. Actions are `seat`, `back`, `lighting`, `camera`
  (hero or mode), and `autoOrbit`. The section-zoom view is removed.
- `seatsData.ts`: tier → sections → rows → seats option lists, seat lookup by (section,row,seat), and
  `?seat=` parse/format.
- `sectionPatches.ts`: tier colours and a per-face (section,row) mapping.
- `seatPick.ts`: strip hit → nearest seat (pure, tested).
- `flyto.ts`: `seatViewPose(seat)`.
- `ui/`: `header.ts`, `sidebar.ts`, `tooltip.ts`, `controls.ts` (zoom, mode bar, lighting dropdown), and
  `theme.css` (tokens). `ui.ts` keeps the overlay and progress functions.
- `main.ts`: wiring only.

### Testing

- Vitest: reducer, option lists, seat lookup and `?seat=` round trip, strip hit → seat, seat-view pose,
  the specular-occlusion chunk patch, the LED coverage GLSL string, and the ENV_INTENSITY table.
- Visual: a real, visible Chrome tab (lesson from v1). Hover tooltip, select → seat view, back, hero views,
  mode bar, lighting dropdown, and narrow-screen layout.
- `npm run build` and `npm test` pass. Performance targets from the v1 spec hold.

## Out of scope

Prices, cart, checkout, backend, accounts. An official seating plan (numbering stays invented). Arabic
UI (LoewNext font). Crowd geometry.
