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
| Shell | 18 overlapping sails twisting 55° clockwise (from `refs/sdb_09.jpg`); a quarter-ellipse dome, 276 × 242 m, rim at 56 m; silver panelled skin with scattered LED points; translucent cream undersides that glow at night |
| Roof structure | Compression ring, 36 radial trusses following the twist, purlins and bracing, 120 floodlight heads |
| Bowl | Lower tier 24 rows, club tier 3 rows with glazed suites, upper tier 22–29 rows (wavy top edge); aisles with half-steps, lower-tier vomitories, LED fascia, louvre band, 4 corner screens |
| Seats | **46,074** instanced seats (StadiumDB lists 46,096), each with section/row/seat attributes |
| Pitch | Mowing stripes, FIFA markings, goals and nets, LED boards, glazed dugouts |
| Site | Elevated scalloped podium walkway on columns, 3 snaking bridges, a palm-lined entrance plaza, a park with about 2,200 trees, King Fahad Rd with night street lighting, parking with about 2,200 cars, city blocks |
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
