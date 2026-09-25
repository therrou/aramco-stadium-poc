# Aramco Stadium 3D (PoC)

Procedural Blender replica of the Aramco Stadium, Al Khobar (Populous, 47,000 seats), built
as phase 1 of a ticketing demo. Phase 2 is a web viewer where the camera flies to the
selected seat.

**Accuracy.** Built only from public sources: Populous, ArchDaily and StadiumDB renders in
`refs/`, plus the published figures (47k seats, 105 × 68 m field, 125 × 85 m pitch area). There
are no public drawings, so heights, sail geometry and bowl rake are estimates from the renders.
**The section, row and seat numbering is invented.** It lives only in `data/`, so it can be
replaced with the official plan without touching the model.

## What's in the model

| Part | Detail |
|---|---|
| Shell | 16 broad, puffy sails twisting 55° counter-clockwise (twist concentrated near the oculus), each covering its clockwise neighbour (user-confirmed against `refs/v4/`); a quarter-ellipse dome, 276 × 242 m, rim at 56 m; silver skin with scattered LED points; translucent undersides that glow teal-mint at night |
| Roof structure | Compression ring, 36 radial trusses following the twist, purlins and bracing, 120 floodlight heads |
| Bowl | Lower tier 24 rows, club tier 3 rows with glazed suites, upper tier 22–29 rows (wavy top edge); aisles with half-steps, lower-tier vomitories, three LED ad ribbons (pitch wall, club front, upper-tier front), louvre band, 6 big screens with a match frame (`scripts/stadium/signage.py`) |
| Seats | **46,074** instanced seats (StadiumDB lists 46,096), each with section/row/seat attributes |
| Pitch | Mowing stripes, FIFA markings, goals and nets, LED boards, team dugouts (curved canopy on white ribs, two tiers of bucket seats, technical area) |
| Site | Two levels (`refs/v4/announcement.jpg`): a wide level-2 deck with a smooth edge swelling into arms at the bridges and the sign, two lightwells with stairs, the "aramco stadium" sign on the deck parapet; level 1 underneath is a shopping arcade (glazed shopfronts, white columns and soffit). Granite-slab paving, 4 snaking bridges, a palm-lined entrance plaza, a park with trees, King Fahad Rd with night street lighting, parking, city blocks |
| Vegetation | Poly Haven jacaranda, coastal and small broadleaf trees, plus procedural date palms (two variants, pinnate fronds). Palms are denser near the stadium |
| Ground | Poly Haven textures: aerial sand, leafy grass, square paving and asphalt, all tiled at real-world size with large-scale colour variation to hide the repeat |

## Day / night

One scene property drives everything: `scene["night"]` (0 = day, 1 = night). It controls:

- the sky
- the sun and moon
- 40 floodlight spots
- podium lights
- exposure
- all emissive materials: facade LEDs, sail glow, fascia, screens, city windows

To switch it in Blender, open the 3D Viewport sidebar (N) and use **Stadium → Day / Night**, or
the "Dusk blend" slider. The panel needs *Allow auto-run scripts* to load from the .blend.
Otherwise, run the `stadium_ui.py` text block once.

## Files

```
blender/aramco_stadium.blend   built scene (Cycles, Metal GPU)
scripts/stadium/               generator: params, pitch, bowl, shell, site, lighting, cameras
scripts/render_all.py          headless HD renders (day + night per camera)
data/sections.json             132 sections: tier, rows, seats, centroid, view-from-seat camera
data/seats.csv                 every seat: section,row,seat,x,y,z,yaw  (metres, Z up, yaw faces pitch)
renders/                       output stills
refs/                          reference renders (© Populous / StadiumDB, reference only)
```

## Assets (Poly Haven, CC0)

The Poly Haven assets were downloaded through the Blender MCP add-on and are **packed into the .blend**,
which is why the file is about 300 MB:

- models: `jacaranda_tree`, `island_tree_01`, `tree_small_02`
- textures: `aerial_beach_03`, `leafy_grass`, `square_tiles_03`, `asphalt_02`

`scripts/stadium/assets.py` uses them when they are present and falls back to procedural stand-ins
otherwise. In the viewport, the trees are drawn as bounding boxes to keep it responsive. They render
fully in Cycles.

Each camera has an `exposure` property: aerials use -0.4 and seat views use +0.1. It is added to
the day/night exposure through a driver.

## Rebuild / tweak

All dimensions are in `scripts/stadium/params.py`. To rebuild inside Blender:

```python
import sys; sys.path.insert(0, "<repo>/scripts")
from stadium import build; build.run()                      # full rebuild, about 1 s
build.run(stages=("shell", "lighting"))                     # partial
```

A rebuild rewrites `data/`. On an M1 Max GPU, a 1920x1080 still at 128 samples takes about 80–100 s.
The quickest path is rendering from the open Blender session, with `stadium.view.render(camera, path, res, samples, night)`.
Headless rendering (below) hung in this environment before printing anything, probably a macOS
permission prompt. If you see that, run it from Terminal.app directly:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b blender/aramco_stadium.blend \
  --python scripts/render_all.py -- --res 2560x1440 --samples 256 --only CAM_Bowl,CAM_Seat_101
```

## Notes for the web phase

- Coordinates are in metres: pitch centre at the origin, long axis on X, south (main) stand at -Y.
  glTF is Y-up, so the exporter converts.
- Seats are GPU instances. Export them with `EXT_mesh_gpu_instancing`, or rebuild them on the web from
  `seats.csv` as an `InstancedMesh` so each seat can be picked and coloured by availability.
- Each section's `view` (eye, target, fov) matches the `CAM_Seat_*` framing, so web cameras and
  Blender renders agree.
- Procedural shaders (sail panels, LEDs, grass) will need baking to textures for glTF. Day and night
  lightmaps can be baked separately, and the web toggle blends between them.

## Web viewer (phase 2)

Prerequisites:

- Blender 5.2 open with `blender/aramco_stadium.blend` and the Blender MCP add-on connected. The export
  runs inside that session through the MCP (headless `blender -b` hangs on this machine). It reads the
  render scene "Scene" and never modifies or saves it.
- KTX-Software 4.4.2 (`ktx`) extracted into `tools/ktx/bin` and `tools/ktx/lib`, exactly as the header
  comment of `scripts/optimize_web.sh` describes (no installer, no sudo; `tools/` is gitignored).
- A Python venv for the host tests and the size check:
  `python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`.
- Node (tested with 23) and network access: `optimize_web.sh` runs `npx @gltf-transform/cli@4.5.0`
  (and the matching `@gltf-transform/core|functions|extensions@4.5.0`), and `web/` needs `npm install`.

Export exactly as shipped (in the Blender session, via the MCP; the bakes take roughly 2-3 h):

    import sys; sys.path.insert(0, "<repo>/scripts")
    import export_web
    export_web.run(stages=("data", "geometry", "surfaces", "bake", "trees"), quality="draft", samples=256)

`quality="draft"` sets the UV layout and atlas sizes (scale 0.5) and the surface bakes; `samples=256`
raises only the lightmap bake's samples. `quality="full"` uses the same scale (ruling R9) but also
bakes the surface textures at higher samples, so it is close to, not identical with, the shipped assets.
Stages can be run on their own (e.g. `stages=("bake",)`), but the UV layout and the export scenes live
only in the open session: after a Blender restart, rerun every stage from "geometry" on
(`stages=("geometry", "surfaces", "bake", "trees")`); "data" needs no Blender state.

Then:

    scripts/optimize_web.sh            # build/web_raw -> web/public/assets, fails above 35 MB (35e6 bytes)
    cd web && npm install && npm run dev

URL parameters: `state=day|golden|night`, `cam=<Blender camera name>`, `size=1920x1080`, `stats=1`,
`seat=<section>-<row>-<seat>` (opens in seat view; a malformed or unknown seat opens the overview), and
`chrome=0` (hides the UI, for reference captures). Numbering is the invented one in `data/`.

## Web viewer v2: seat finder

Styled after aramcostadium.com. Pick Tier → Section → Row → Seat (only real seats from `seats.bin`) or click
any seat. Hovering shows the seat, a click flies to a first-person view from it (drag looks around, zoom
changes the field of view), and "Copy link" shares it as `?seat=`. The bottom bar has Stadium / Exterior /
Top view / Auto orbit, and "Views worth exploring" lists the `CAM_Seat_*` cameras. Below 900 px wide, the
sidebar becomes a bottom sheet.

Headings use Aktiv Grotesk Black from `web/public/fonts/AktivGrotesk_Blk.woff2`. That is a licensed font, so
the file is gitignored and stays local: copy it there on each machine. Without it, the headings fall back to
Archivo (Google Fonts), which is also the body face.

Rendering v2 (Stage A: shader and constant changes against the Cycles references, no rebake) and the
remaining Stage B candidates are in `docs/superpowers/reports/2026-09-25-v2-visual-check.md`. The visual check
tools: `web/scripts/capture.js` (run in the page on the dev server) and `python -m webexport.framestats`.
The v1 comparison is `docs/superpowers/reports/2026-09-25-visual-check.md`.
