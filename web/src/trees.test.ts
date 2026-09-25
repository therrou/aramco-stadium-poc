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

import { IMPOSTOR_FS_SRC } from "./trees";
import { patchTreeMaterial as patchTree2, makeTreeUniforms as mk2 } from "./treeLight";
import * as THREE3 from "three";
it("D9: leaves use alpha-to-coverage (anti-aliased edges) and impostors blend neighbouring frames", () => {
  const leaf = new THREE3.MeshStandardMaterial({ transparent: true });
  patchTree2(leaf, mk2());
  expect(leaf.alphaToCoverage).toBe(true);
  expect(leaf.alphaTest).toBeLessThan(0.5);
  expect(IMPOSTOR_FS_SRC).toContain("vCellF");
});
