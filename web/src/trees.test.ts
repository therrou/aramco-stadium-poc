import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hemiOctCell } from "./trees";

const fx = JSON.parse(readFileSync(new URL("../test/fixtures/hemioct_dirs.json", import.meta.url), "utf8"));

it("encodes every Python cell direction back to its cell", () => {
  for (const [i, j, d] of fx.cells) expect(hemiOctCell(d, fx.n)).toEqual([i, j]);
});
it("clamps below-horizon views to the rim", () => {
  const [i, j] = hemiOctCell([1, 0, -0.5], 8);
  expect(i).toBeGreaterThanOrEqual(0); expect(j).toBeLessThan(8);
});
