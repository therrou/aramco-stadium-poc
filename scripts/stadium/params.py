"""Dimensions for the Aramco Stadium replica (metres, Z up, pitch long axis on X).

Public data: 47,000 seats, field of play 105 x 68, pitch area 125 x 85.
Everything else is estimated from Populous / StadiumDB renders (refs/),
mostly the top-down night render refs/sdb_09.jpg.
"""
import math

# --- pitch ---------------------------------------------------------------
FIELD_L, FIELD_W = 105.0, 68.0
PITCH_AREA_L, PITCH_AREA_W = 125.0, 85.0

# --- seating bowl --------------------------------------------------------
# Base plan curve: superellipse just outside the pitch area; every row is an
# offset of it along its outward normal ("d" = offset distance).
BOWL_A, BOWL_B, BOWL_N = PITCH_AREA_L / 2 + 1.5, PITCH_AREA_W / 2 + 1.5, 4.0
PLAN_SAMPLES = 1440          # dense sampling of the base curve
SECTIONS = 44                # radial sections per tier (aisles line up)
AISLE_W = 1.2

LOWER = dict(name="Lower", level=1, d0=1.2, rows=24, depth=0.80, z0=1.2,
             riser0=0.30, riser_k=0.0055, seat_w=0.50)
CLUB = dict(name="Club", level=2, gap=2.6, rows=3, depth=0.95,
            riser0=0.34, riser_k=0.0, seat_w=0.58, suite_h=5.2, suite_d=7.0)
UPPER = dict(name="Upper", level=3, overhang=1.5, rows_min=22, rows_max=29,
             depth=0.80, riser0=0.46, riser_k=0.0045, seat_w=0.50)

# vomitories in the lower tier: every second section, rows 9..15
VOM_ROWS = (9, 15)
VOM_W = 3.4

# --- roof / sail shell ---------------------------------------------------
OCULUS_A, OCULUS_B, OCULUS_N = 76.0, 63.0, 2.35
SHELL_A, SHELL_B, SHELL_N = 138.0, 121.0, 2.25
SHELL_Z_TOP = 56.0           # compression ring / oculus rim height
PODIUM_Z = 9.0               # elevated walkway level; shell lands here
SHELL_THETA_MAX = math.radians(97.0)
SAIL_COUNT = 16                # broad lobes (refs/v4/announcement.jpg)
SAIL_TWIST = math.radians(55.0)   # CCW (seen from above) from oculus to base (user-confirmed vs key visuals)
SAIL_TWIST_EXP = 0.5              # < 1: the twist happens near the oculus, seams run radial at the base
SAIL_LIFT_TRAILING = True         # each sail covers its clockwise neighbour (user: layers overlap CW)
SAIL_OVERLAP = 0.16               # fraction of pitch each sail overlaps next
SAIL_GAP_MAX = 7.0                # vent opening at the base (m)
SAIL_THICK = 0.45

# --- site ----------------------------------------------------------------
PODIUM_WIDTH = 30.0           # level-2 plaza around the shell (refs/v4/announcement.jpg)
GROUND_SIZE = 2600.0

NIGHT_PROP = "night"          # scene custom property 0 = day, 1 = night
