import { expect, it } from "vitest";
import { imageStats, CLIP } from "./frameStats";

// 2x2 RGBA, top-left origin: white, black / red, (CLIP,0,0)
const px = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, CLIP, 0, 0, 255]);
it("mean Rec.709 luma and clipped share over the frame", () => {
  const s = imageStats(px, 2, 2);
  expect(s.mean).toBeCloseTo((255 + 0 + 0.2126 * 255 + 0.2126 * CLIP) / 4, 6);
  expect(s.clipped).toBe(0.75);
});
it("a box selects a region; bottom-up buffers (readPixels) are flipped", () => {
  const box = { x0: 0, y0: 0, x1: 0.5, y1: 0.5 };
  const flipped = new Uint8Array([...px.slice(8), ...px.slice(0, 8)]);
  for (const s of [imageStats(px, 2, 2, box), imageStats(flipped, 2, 2, box, true)]) {
    expect(s.mean).toBeCloseTo(255, 9);
    expect(s.clipped).toBe(1);
  }
});
