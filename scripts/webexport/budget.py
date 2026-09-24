"""Export budgets from the spec's Targets table."""
import math

TARGETS = {"triangles": 2_000_000, "first_load_mb": 35.0, "draw_calls": 250}
TREE_TRI_BUDGET = 350_000          # decision D9, lowered from 450k by ruling R14 (~2.0M tris in close views)
SEAT_TRI_BUDGET = 25_000 * 24      # decision D6: <= 25k visible seats x 24 tris


def check(report):
    fails = []
    for key, limit in TARGETS.items():
        if key in report and report[key] > limit:
            fails.append(f"{key}: {report[key]:,} > {limit:,}")
    return fails


def near_radius(trees, tris, budget, r_max=250.0):
    """Largest radius <= r_max whose trees (species, distance) fit `budget` triangles."""
    total = 0
    for species, d in sorted(trees, key=lambda t: t[1]):
        if d > r_max:
            return r_max
        total += tris[species]
        if total > budget:
            return math.nextafter(d, 0.0)
    return r_max
