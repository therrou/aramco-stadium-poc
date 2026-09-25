import { expect, it } from "vitest";
import * as THREE from "three";
import { affineFrom3, chartUv, chartsFromTriangles, chartsOfMesh, pitchLinesGlsl } from "./pitchLines";
import { pitchLinesChunk, patchLightsChunk } from "./stadium";

// the shipped pitch__M_Grass: four quadrant charts (three x, z -> Blender x = x, y = -z), seams at x = 0 and y = 0
const quad = (pts: [number, number, number, number][]) => {
  const t = (i: number[]) => ({ p: i.map((k) => [pts[k][0], pts[k][1]] as [number, number]), uv: i.map((k) => [pts[k][2], pts[k][3]] as [number, number]) });
  return [t([0, 1, 2]), t([0, 2, 3])];
};
const GRASS = [
  ...quad([[0, 0, 0.1809, 0.9922], [62.5, 0, 0.1809, 0.7375], [62.5, 42.5, 0.0078, 0.7375], [0, 42.5, 0.0078, 0.9922]]),
  ...quad([[-62.5, 0, 0.3697, 0.9922], [0, 0, 0.3697, 0.7375], [0, 42.5, 0.1966, 0.7375], [-62.5, 42.5, 0.1966, 0.9922]]),
  ...quad([[0, -42.5, 0.5585, 0.9922], [62.5, -42.5, 0.5585, 0.7375], [62.5, 0, 0.3854, 0.7375], [0, 0, 0.3854, 0.9922]]),
  ...quad([[-62.5, -42.5, 0.7472, 0.9922], [0, -42.5, 0.7472, 0.7375], [0, 0, 0.5741, 0.7375], [-62.5, 0, 0.5741, 0.9922]]),
];

it("affine map through three points reproduces them; degenerate -> null", () => {
  const f = affineFrom3([[0, 0], [2, 0], [0, 4]], [[0.1, 0.2], [0.3, 0.2], [0.1, 0.6]])!;
  expect(f.u[0] * 2 + f.u[1] * 0 + f.u[2]).toBeCloseTo(0.3, 12);
  expect(f.v[0] * 0 + f.v[1] * 4 + f.v[2]).toBeCloseTo(0.6, 12);
  expect(affineFrom3([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 1], [2, 2]])).toBeNull();
});

it("the grass's 8 triangles merge into 4 quadrant charts", () => {
  const c = chartsFromTriangles(GRASS);
  expect(c.length).toBe(4);
  expect(c.map((x) => x.box).sort()).toEqual([[-62.5, -42.5, 0, 0], [-62.5, 0, 0, 42.5], [0, -42.5, 62.5, 0], [0, 0, 62.5, 42.5]].sort());
});

it("a point on either side of the halfway seam maps into its own quadrant's chart", () => {
  const c = chartsFromTriangles(GRASS);
  const [ul] = chartUv(c, -0.03, 10)!, [ur] = chartUv(c, 0.03, 10)!;
  expect(ul).toBeGreaterThan(0.1966 - 1e-6); expect(ul).toBeLessThan(0.3697 + 1e-6);
  expect(ur).toBeGreaterThan(0.0078 - 1e-6); expect(ur).toBeLessThan(0.1809 + 1e-6);
  expect(chartUv(c, 30, 20)).toEqual([expect.closeTo(0.1809 - (0.1809 - 0.0078) * 20 / 42.5, 6), expect.closeTo(0.9922 - (0.9922 - 0.7375) * 30 / 62.5, 6)]);
  expect(chartUv(c, 70, 0)).toBeNull();
});

it("charts of a mesh read uv1 in Blender XY (three x, -z)", () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 10, 0, 0, 10, 0, -5], 3));
  g.setAttribute("uv1", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1], 2));
  const c = chartsOfMesh(new THREE.Mesh(g));
  expect(c.length).toBe(1);
  expect(chartUv(c, 10, 5)![1]).toBeCloseTo(1, 9);
});

it("the lines' chunk routes every lightmap lookup through pitchLmUv", () => {
  const out = pitchLinesChunk(patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps));
  expect(out.match(/pitchLmUv\( vWorldPosB, vLightMapUv \)/g)?.length).toBe(2);
  expect(out.replaceAll("pitchLmUv( vWorldPosB, vLightMapUv )", "")).not.toContain("vLightMapUv");
  expect(pitchLinesGlsl(4)).toContain("uniform vec4 uChartBox[4]");
});
it("v3: goal posts take the grass lighting at their footprint (their own baked texels are black)", () => {
  const g = pitchLinesGlsl(4);
  expect(g).not.toContain("pB.z >");
  expect(g).toContain("return own;");                 // off the grass charts they still fall back
});
