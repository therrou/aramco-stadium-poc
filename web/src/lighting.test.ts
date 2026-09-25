import { expect, it } from "vitest";
import * as THREE from "three";
import { BLOOM, agxLookChunk } from "./lighting";

it("builds CustomToneMapping as AgX plus a log-space contrast look", () => {
  const out = agxLookChunk(THREE.ShaderChunk.tonemapping_pars_fragment, { contrast: 1.2, pivot: 0.606 });
  const custom = /vec3 CustomToneMapping\( vec3 color \) \{[\s\S]*?\n\}/.exec(out)![0];
  expect(custom).toContain("( color - 0.6060 ) * 1.2000 + 0.6060");
  expect(custom.indexOf("1.2000")).toBeLessThan(custom.indexOf("agxDefaultContrastApprox"));
  expect(out).toContain("vec3 AgXToneMapping(");               // the stock AgX is untouched
});
it("throws when three's tone mapping chunk no longer matches", () => {
  expect(() => agxLookChunk("void main(){}")).toThrow(/three.js/);
});
it("blooms only above the brightest non-emissive radiance (Task 13b measurement: 11.5)", () => {
  expect(BLOOM.threshold).toBeGreaterThan(11.5);
});
