"""Atlas resolution from surface area and a target texel density."""
import math


def atlas_size(area_m2, texels_per_m, lo=256, hi=4096, fill=0.72):
    """Power-of-two edge so `area_m2` gets ~texels_per_m, given `fill` packing efficiency."""
    edge = math.sqrt(max(area_m2, 1e-6) / fill) * texels_per_m
    p = 2 ** round(math.log2(max(edge, 1)))
    return int(min(max(p, lo), hi))
