"""Which lightmap atlas a merged object belongs to, and what is not exported as geometry."""
GROUP_OF_COLLECTION = {"Pitch": "pitch", "Bowl": "bowl", "Shell": "structure", "Site": "site"}
SAIL_MATERIALS = {"M_SailSkin", "M_SailUnder"}
EXCLUDE_PREFIXES = ("Seats_", "SeatModel", "Trees_", "Crowd_", "Haze_", "Sign_Path")
# lightmap texels per metre (spec: ~4 on the stadium, ~1 on the site)
TEXELS_PER_M = {"pitch": 4.0, "bowl": 4.0, "sails": 4.0, "structure": 4.0, "site": 0.6}   # site 0.6: size-budget knob (Task 10)
# albedo/emission bake density for procedural materials
ALBEDO_TEXELS_PER_M = {"pitch": 16.0, "bowl": 4.0, "sails": 2.0, "structure": 4.0, "site": 1.0}


def group_of(collection, material):
    if material in SAIL_MATERIALS:
        return "sails"
    return GROUP_OF_COLLECTION[collection]


def is_excluded(name):
    return name.startswith(EXCLUDE_PREFIXES)
