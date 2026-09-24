# Aramco Stadium web viewer: design (PoC)

Date: 2026-09-24
Status: approved in chat, pending review of this document

## Goal

A browser proof of concept that shows the Aramco Stadium model as close as possible to the
final Cycles renders, with a three-way time-of-day toggle: **Day**, **Golden hour** and **Night**
(lights on/off). The user picks a section, then
a seat, and the camera flies to that seat's point of view.

It demonstrates what a 3D ticketing experience could look like. No real ticketing.

## Scope

In scope:
- An export pipeline from `blender/aramco_stadium.blend` to web assets.
- A standalone web app (Vite + Three.js) that loads the assets and renders the scene.
- A Day / Golden / Night toggle with a cross-fade between states.
- Section and seat picking with camera fly-to.
- Mock seat availability (available / taken / selected colours).

Out of scope for this PoC:
- Real ticketing, accounts, payments, a backend.
- 360° photoreal seat panoramas. This is a possible later addition on top of fly-to.
- Phone tuning and streaming by area. Phones should load, but the target is desktop.
- An official seating plan. Numbering stays the invented one in `data/`.

## Targets

| Item | Target |
|---|---|
| Browsers | Desktop Chrome and Safari (WebGL2) |
| First load | ≤ 35 MB compressed (three lightmap sets) |
| Frame rate | ≥ 50 fps at 1080p on an M1-class laptop |
| Triangles on screen | ≤ 2M |
| Draw calls | ≤ 250 |
| Visual match | Same camera as a Blender render → same composition, lighting mood and colours (checked side by side, day and night) |

## Architecture

```
blender/aramco_stadium.blend
        │  scripts/export_web.py  (run inside Blender)
        ▼
build/web_raw/         glb + png/exr (uncompressed)
        │  scripts/optimize_web.sh  (gltf-transform: meshopt, KTX2, prune, dedup)
        ▼
web/public/assets/     stadium.glb, lightmaps (day/night), env maps,
                       (day/golden/night), trees.glb, seats.bin, sections.json
        ▼
web/  (Vite + Three.js app)
```

### 1. Export (`scripts/export_web.py`)

It runs inside Blender, using the existing `scripts/stadium/` modules and the open scene.

1. **Web copy of the scene.** Work on a duplicated temporary scene, so the render scene is
   never modified.
2. **Merge.** Static geometry is joined per material, grouped by collection:
   - Pitch
   - Bowl (the tiers, without seats)
   - Shell (sails, structure, louvres, screens)
   - Site (podium, bridges, ground, roads, lots, cars, city, canopies, sign)

   Instanced seats, trees, people and lamps are excluded.
3. **Bake albedo.** Procedural materials (sail panels and LEDs, grass stripes, noise
   materials) are baked to base-colour, roughness and emission textures.
4. **Bake lightmaps.**
   - A second UV channel, `LightmapUV`, via smart UV project plus packing, per merged object.
   - A Cycles bake of the combined diffuse lighting (direct + indirect, no albedo), done
     three times, once per lighting state:

     | State | `scene["night"]` | What it looks like |
     |---|---|---|
     | Day | 0.0 | High sun, no stadium lights |
     | Golden | 0.6 | Low warm sun, stadium lights coming on (Dezeen hero look) |
     | Night | 1.0 | After sunset, all lights on |
   - Output is HDR (EXR, then KTX2 via the optimize step, or RGBM PNG as a fallback).
   - Resolution per object is set by its surface area, aiming at about 4 texels/m on the
     stadium and about 1 texel/m on the site.
5. **Emission.**
   - Glowing surfaces: LEDs, floodlight lenses, screens, glazing, road and podium strips.
   - Exported as the `emissive` channel, scaled by the same `scene["night"]` value as in
     Blender (0, 0.6 or 1), with a per-material `nightEmission` factor in `extras`.
6. **Trees.**
   - Near the stadium, within about 250 m: Poly Haven LOD2–LOD3 meshes, fetched through the
     MCP add-on, as instanced nodes (`EXT_mesh_gpu_instancing`).
   - Everything else: octahedral impostors baked from the same trees, with one atlas per
     species plus the date palm. Instance transforms go into `trees.glb`.
7. **Seats.** Seats are not exported as geometry. `seats.bin` is written with these fields
   per seat:

   | Field | Type |
   |---|---|
   | section | u16 |
   | row | u8 |
   | seat | u16 |
   | x | f32 |
   | y | f32 |
   | z | f32 |
   | yaw | f16 |

   That is about 46k × 17 B ≈ 0.8 MB before compression. A single low-poly seat model
   (`seat.glb`) goes alongside it.
8. **Environment.** The world is baked to equirect HDRs for day, golden hour and night,
   used for the background and for reflections (PMREM in Three.js).
9. **Coordinates.** Blender Z-up is converted to glTF Y-up by the exporter. The section
   cameras in `sections.json` are converted the same way at load time.
10. **Budget check.** After export, the script prints triangle counts and file sizes, and
    fails if the targets above are exceeded.

### 2. Optimize (`scripts/optimize_web.sh`)

It runs `gltf-transform` (npm) with:
- `dedup`, `prune`, `weld`
- `meshopt` compression
- `ktx2` conversion (`uastc` for normals and lightmaps, `etc1s` for albedo)
- `resize` caps of 2048 px for albedo and 4096 px for lightmaps

### 3. Web app (`web/`)

Vite + TypeScript + Three.js. Modules:

| Module | Responsibility |
|---|---|
| `loader.ts` | Loads the assets with a progress bar (GLTFLoader + Meshopt + KTX2). |
| `lighting.ts` | Time-of-day state (day / golden / night), lightmap blend, env/background swap, emission fade, tone mapping. |
| `stadium.ts` | Stadium material setup: base colour × lightmap (blended between the current and next state by a uniform), plus emission. |
| `seats.ts` | InstancedMesh from `seats.bin`, per-instance colour, availability mock, LOD. |
| `picking.ts` | Section hover/click, then seat click. |
| `camera.ts` | Orbit controls, animated fly-to (eased position and target, about 1.5 s), return to overview. |
| `ui.ts` | Side panel with the Day / Golden / Night toggle, selected section/row/seat, "Back to overview", and a legend. |

**Lighting model.**
- Three lighting states, each a bundle of: a lightmap set, an environment map, an emission
  level (0 / 0.6 / 1) and an exposure.
- Switching states cross-fades over about 1 s: the shader samples the outgoing and incoming
  lightmaps and blends them by `uBlend`.
- Only two lightmap sets are bound at a time. The third is kept in memory, already on the
  GPU, so switching is instant.
- Emission: `emission × uEmission × nightEmission`, where `uEmission` is animated between the
  states' levels.
- Background and reflections: the environment switches with the same cross-fade.
- Post-processing: `EffectComposer` with a bloom pass, AgX tone mapping (Three.js
  `AgXToneMapping`), and exposure matched to the Blender camera `exposure` values.

**Seats.**
- A single `InstancedMesh` holds all 46,074 seats, drawing the low-poly model (≤ 60 tris).
- Far away, whole sections become flat coloured section patches, drawn instead of the seats.
- Seat colours:

  | State | Colour |
  |---|---|
  | Available | Green |
  | Taken | Grey |
  | Selected | White + highlight |
  | Club tier | Cream |

**Picking.**
- Section picking uses invisible per-section hit meshes, derived from each section's bounding
  area of seats.
- Seat picking is a raycast against the InstancedMesh, limited to the selected section.

**Fly-to.**
- Section: the `view.eye` / `view.target` / `view.fov` from `sections.json`.
- Seat: eye position = seat position + `EYE_H` (1.15 m) + 0.15 m forward along yaw, looking
  at the pitch at 22 % of the seat's plan position. This is the same formula as the Blender
  `CAM_Seat_*` cameras.

### 4. Data

- `data/sections.json` is reused as-is: ids, tier, rows, seat counts, centroid, view.
- `data/seats.csv` becomes `seats.bin` in the export.
- Availability is a seeded mock: about 35 % of seats taken, clustered by section.

## Error handling

- Asset load failure: a visible error panel naming the file, with a retry button.
- WebGL2 or KTX2 unsupported: a message that names the missing capability.
- Picking outside a section: nothing happens. No camera move.

## Testing

- **Export:** the budget check (above), and the counts must match: 132 sections and
  46,074 seats in `seats.bin`.
- **Web unit tests (Vitest):**
  - `seats.bin` parsing
  - section and seat lookup
  - the fly-to camera formula against the Blender seat cameras (positions agree within 1 cm
    after axis conversion)
- **Visual check:**
  - Open the viewer at the `CAM_Aerial_Dusk`, `CAM_Approach` and `CAM_Seat_212` framings, in
    all three states.
  - Screenshot them and compare side by side with `renders/`.
  - Findings are written down; exact pixel match is not expected.
- **Performance:** the fps counter (stats.js) at 1080p meets the targets above.

## Risks

| Risk | Mitigation |
|---|---|
| Bake time: about 30–60 min per lightmap set, so 1.5–3 h for all three | Bake at half resolution while iterating (about 10–15 min per state); run the full bake once, unattended. |
| Lightmap seams on the curved sails | Add margin/padding; give the sails their own higher-res atlas. |
| Poly Haven LOD meshes not packed in the .blend | Download them via the MCP add-on during export setup. |
| Bloom and AgX tone mapping differ between Three.js and Blender | Tune the exposure and bloom threshold against the reference renders. |
| The club-seat colour bug in Blender | Irrelevant for the web; colours are set per instance in `seats.ts`. |
