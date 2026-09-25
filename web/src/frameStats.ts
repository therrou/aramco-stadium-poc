/**
 * Frame metrics for the v2 visual check, same definition as scripts/webexport/framestats.py: 8-bit sRGB
 * pixels, mean Rec.709 luma (0..255), and the share of pixels whose largest channel is >= CLIP.
 */
export interface Box { x0: number; y0: number; x1: number; y1: number }   // fractions, top-left origin
export const CLIP = 250;
const FULL: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };

export function imageStats(px: ArrayLike<number>, w: number, h: number, box: Box = FULL, bottomUp = false) {
  const X0 = Math.floor(box.x0 * w), X1 = Math.ceil(box.x1 * w), Y0 = Math.floor(box.y0 * h), Y1 = Math.ceil(box.y1 * h);
  let sum = 0, clipped = 0, n = 0;
  for (let y = Y0; y < Y1; y++) {
    const row = bottomUp ? h - 1 - y : y;
    for (let x = X0; x < X1; x++, n++) {
      const o = (row * w + x) * 4, r = px[o], g = px[o + 1], b = px[o + 2];
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (Math.max(r, g, b) >= CLIP) clipped++;
    }
  }
  return { mean: n ? sum / n : 0, clipped: n ? clipped / n : 0 };
}
