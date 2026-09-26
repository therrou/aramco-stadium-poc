"""Which lightmap atlas a merged object belongs to, and what is not exported as geometry."""
GROUP_OF_COLLECTION = {"Pitch": "pitch", "Bowl": "bowl", "Shell": "structure", "Site": "site"}
SAIL_MATERIALS = {"M_SailSkin", "M_SailUnder"}
# materials whose image content is UV-mapped in the source (LED screens, tier ribbons): the web
# scene keeps their "UVMap" as TEXCOORD_0 and exports the image as emissiveTexture
KEEP_UV_MATERIALS = {"M_Screen", "M_FasciaLED"}
EXCLUDE_PREFIXES = ("Seats_", "SeatModel", "Trees_", "Crowd_", "Haze_", "Sign_Path")
# lightmap texels per metre (spec: ~4 on the stadium, ~1 on the site)
TEXELS_PER_M = {"pitch": 8.0, "bowl": 4.0, "sails": 8.0, "structure": 4.0, "site": 0.6,   # site 0.6: size-budget knob (Task 10)
                "site_near": 4.0,    # Task 13b: flat ground around the stadium
                "site_mid": 4.0}     # v4 option A: ground 300-450 m + raised site structures (bridges, canopies)
# v4 (user: top view showed "big pixels"): at 1024 px the sails, the deck and the pitch were packed at ~0.6, ~1.5
# and ~1.2 m per texel. These groups get larger atlases and double the texel target (x draft scale 0.5):
# sails ~0.25 m, site_near ~0.5 m, pitch ~0.25 m. Costs ~10 MB of download, no frame time (KTX2 on the GPU).
ATLAS_LO = {"sails": 2048, "site_near": 2048, "pitch": 1024, "site_mid": 2048}
# albedo/emission bake density for procedural materials
ALBEDO_TEXELS_PER_M = {"pitch": 16.0, "bowl": 4.0, "sails": 2.0, "structure": 4.0, "site": 1.0, "site_near": 1.0, "site_mid": 1.0}
# Task 13b: flat site faces (normal.z > uvpack.FLAT_NZ) whose centre is within this plan radius of the
# stadium get their own, denser lightmap ("site_near"); the rest of the site keeps the coarse atlas.
SITE_NEAR_R = 300.0              # v4: 400 -> 300 m, so the denser site_near texels land where the views look
# grid (m) that large flat faces are cut on before charting: flat charts never straddle a cell, so no
# chart is wider than a cell (a 1 km lawn face capped the whole site_near density at 0.38 texel/m)
FLAT_CELL_M = 128.0
# v4 option A (user: bridges and canopies showed dark blocks): the far "site" atlas packs ~2.6 km at ~7.5 m per
# texel, so an 11 m bridge got 1-2 texels and bled its chart gutters. "site_mid" takes flat ground out to
# SITE_MID_R and every raised site surface (centre above MID_RAISED_Z: bridges, canopies, plazas' sides) within
# MID_RAISED_R, except city blocks and cars.
SITE_MID_R = 450.0
MID_RAISED_R = 700.0
MID_RAISED_Z = 1.0
MID_EXCLUDE = ("M_Car", "M_Building")


def group_of(collection, material):
    if material in SAIL_MATERIALS:
        return "sails"
    return GROUP_OF_COLLECTION[collection]


NEAR_EXCLUDE = ("M_Car",)       # car roofs: hundreds of tiny charts, each paying a full gutter


def site_split(group, material, flat, radius, z=None):
    """'site_near' for flat site faces within SITE_NEAR_R; 'site_mid' for flat faces within SITE_MID_R and raised
    faces (z > MID_RAISED_Z) within MID_RAISED_R; else the group itself (numpy-friendly)."""
    import numpy as np
    flat, radius = np.asarray(flat), np.asarray(radius)
    z = np.zeros_like(radius) if z is None else np.asarray(z)
    site = group == "site"
    near = (site and not material.startswith(NEAR_EXCLUDE)) & flat & (radius < SITE_NEAR_R)
    mid_ok = site and not material.startswith(MID_EXCLUDE)
    mid = mid_ok & ~near & ((flat & (radius < SITE_MID_R)) | ((z > MID_RAISED_Z) & (radius < MID_RAISED_R)))
    return np.where(near, "site_near", np.where(mid, "site_mid", group))


def is_excluded(name):
    return name.startswith(EXCLUDE_PREFIXES)
