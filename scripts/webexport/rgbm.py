"""RGBM: HDR lightmaps in 8-bit RGBA (linear, not sRGB). rgb = c.rgb * c.a * RANGE."""
import numpy as np

RANGE = 16.0                     # R10: 8 clipped ~10 % of the sails' texels


def encode(rgb):
    rgb = np.clip(np.asarray(rgb, np.float32) / RANGE, 0.0, 1.0)
    m = np.clip(rgb.max(-1, keepdims=True), 1e-6, 1.0)
    m = np.ceil(m * 255.0) / 255.0
    c = np.clip(rgb / m, 0.0, 1.0)
    return np.round(np.concatenate([c, m], -1) * 255.0).astype(np.uint8)


def decode(rgba):
    f = np.asarray(rgba, np.float32) / 255.0
    return f[..., :3] * f[..., 3:4] * RANGE


# v4 (user: "pixelated" light pools and lawn): UASTC compresses in 4x4-texel blocks and handles RGBM's per-texel
# alpha multiplier badly (55 % of texels > 5 % off, 2 m squares at 0.5 m/texel). The shipped lightmaps are
# re-encoded as gamma RGB with alpha 1 (texels > 10 % off: ~50 % -> 2.6 %, files ~12 % smaller). The bake PNGs
# stay RGBM; web/src/stadium.ts decodes pow(rgb, GAMMA) * RANGE when the manifest carries lmGamma.
GAMMA = 3.0


def rgbm_to_gamma(rgba, gamma=GAMMA):
    """RGBM (uint8 RGBA) -> gamma-encoded RGB with alpha kept as coverage (0 in gutters, else 255)."""
    e = np.clip(decode(rgba) / RANGE, 0.0, 1.0) ** (1.0 / gamma)
    a = np.where(np.asarray(rgba)[..., 3:4] > 0, 1.0, 0.0)
    return np.round(np.concatenate([e, a], -1) * 255.0).astype(np.uint8)


def gamma_decode(rgba, gamma=GAMMA):
    f = np.asarray(rgba, np.float32) / 255.0
    return (f[..., :3] ** gamma) * RANGE


def main(argv):  # pragma: no cover - CLI for optimize_web.sh: python -m webexport.rgbm in.png out.png
    from PIL import Image
    src, dst = argv
    Image.fromarray(rgbm_to_gamma(np.asarray(Image.open(src).convert("RGBA")))).save(dst)


if __name__ == "__main__":  # pragma: no cover
    import sys
    main(sys.argv[1:])
