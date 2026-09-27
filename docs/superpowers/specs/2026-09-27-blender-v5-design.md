# Aramco Stadium Blender model v5: design

Date: 2026-09-27
Status: approved in chat (sections 1-3), 2026-09-27. The user will verify the result afterwards.
Reference: `refs/HD-aramcostadiumannouncementpr.webp` (the HD key visual)

## Goal

The .blend is the source of truth. The web viewer follows in a later phase.
Success: from a new `CAM_KeyVisual` camera, matched to the reference's angle and lens, a side-by-side
render reads as the same building. Other angles stay consistent with the same language.
The back of the stadium reuses the petal, deck and LED language but gets no garden and no sign.

## Approach

Extend the existing parametric generators (`shell.py`, `site.py`, `landscape.py`, `cameras.py`).
Everything stays rebuildable with `build.run()`. There is no hand modelling or sculpting.

## 1. Petals (shell.py)

- **Pointed foot:** each sail's angular width tapers to a point about 1.5 m wide where it lands on the
  deck at z = 9. The foot is on the covered side, so it tucks under the neighbour.
- **Arch:** between two feet the lower edge rises in a smooth arch, about 7-8 m high, replacing the
  overhanging lobe.
- **Twist:** little in the lower half, strong near the oculus (`SAIL_TWIST_EXP` about 2).
- **Dome:** a taller shoulder and a smaller oculus, tuned against `CAM_KeyVisual`.
- **Seam:** a green-lit fascia on the lifted edge's underside, widest near the top.
- **Concourse:** the lower storey is lit glass with vertical fins, and V-columns stand at the feet.
- **Material:** matte white translucent fabric (no chrome), with LED dots kept.
- **Kept:** 16 sails, the CCW twist, and each sail covering its clockwise neighbour.

## 2. Deck, lightwells, garden, sign (site.py, landscape.py)

- **Deck outline:** a closed spline through control points. The ring is about 18-22 m, with arms at the
  bridges and a front lobe at the sign (236°). Lawns show between the arms.
- **Deck finish:** a warm LED strip on the parapet top and a glow under the edge. Warm stone paving on
  a 1.2 m tile grid.
- **Lightwells:** curved triangles with concave sides and rounded corners. Each has a 12 m grand stair,
  a tree planter in one corner, and glass rails with a lit handrail.
- **Garden:** at ground level in front of the sign, on the 236° axis, replacing the 262° palm avenue.
  It has trees, palms, lawn beds, a 40 × 20 m five-a-side pitch with a lit fence, and 4-6 kiosks.
- **Kiosks:** rounded white pods about 4 × 2.5 × 3 m.
- **Sign:** letters about 5 m tall, emissive white, in AktivGrotesk. The TTF is converted locally from
  the user's licensed woff2 and never committed.
- **Shop fronts:** a continuous lit glazed front on level 1 under the sign's deck edge.

## 3. Landscape, surroundings, verification

- **Planting and crowd:** denser trees and crowd, with about 15% of people carrying green flags.
- **Towers:** a cluster of 6-10 towers, 60-120 m tall, back-left as seen from the key-visual camera.
- **Highway:** an elevated interchange behind the stadium.
- **Verification loop:** rebuild, screenshot from `CAM_KeyVisual`, compare side by side in `renders/v5/`.
  Then one golden-hour render.
- **Regression check:** the other cameras still render without clashes against the new `roof_z_at`.
- **Web impact:** keep object names where possible (`Sail_XX`, `Sign_AramcoStadium`, `Podium_*`).
  The assets must stay under 46 MB later.
- **Workflow:** branch `blender-v5`, backup at `blender/aramco_stadium.pre_v5_backup.blend`, one commit
  per step.
