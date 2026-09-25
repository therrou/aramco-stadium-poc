import { expect, it, describe } from "vitest";
import * as THREE from "three";
import { BICUBIC_GLSL, GRASS, GRASS_GLSL, NET, NET_GLSL, netCoverage, detailFor, CONCRETE_GLSL, grassBand } from "./detail";
import { patchLightsChunk } from "./stadium";

describe("D3 bicubic lightmaps", () => {
  it("both lightmap samples go through the B-spline filter", () => {
    const out = patchLightsChunk(THREE.ShaderChunk.lights_fragment_maps);
    expect(out).toContain("rgbmDecode( texBicubic( lightMap, vLightMapUv ) )");
    expect(out).toContain("rgbmDecode( texBicubic( uLmB, vLightMapUv ) )");
    expect(out).not.toMatch(/texture2D\( lightMap/);
    expect(BICUBIC_GLSL).toContain("vec4 texBicubic( sampler2D t, vec2 uv )");
  });
});

describe("D1 pitch grass (port of scripts/stadium/pitch.py _grass_material)", () => {
  it("20 mowing bands over the 105 m field, alternating from x = 0", () => {
    expect(GRASS.band).toBeCloseTo(105 / 20, 9);
    expect(grassBand(0.1)).toBe(0);
    expect(grassBand(GRASS.band + 0.1)).toBe(1);
    expect(grassBand(-0.1)).toBe(1);                   // floor(-0.02) = -1 -> |(-1) mod 2| = 1, as Blender's modulo+absolute
  });
  it("uses Blender's two greens and multiplies the noise at 0.35", () => {
    expect(GRASS.dark).toEqual([0.045, 0.16, 0.035]);
    expect(GRASS.light).toEqual([0.07, 0.23, 0.05]);
    expect(GRASS_GLSL).toContain("0.35");
    expect(GRASS_GLSL).toContain("vec3 grassAlbedo( vec3 pB )");
    expect(GRASS_GLSL).toContain("fwidth");            // octaves fade with the pixel footprint (no shimmer)
  });
});

describe("D2 goal net", () => {
  it("cords of NET.cord in NET.cell squares; the far-away average equals the cord area share", () => {
    const share = 1 - (1 - NET.cord / NET.cell) ** 2;
    expect(netCoverage(0, 0, 0)).toBe(1);              // on a knot
    expect(netCoverage(NET.cell / 2, NET.cell / 2, 0)).toBe(0);   // mid-cell
    expect(netCoverage(0.03, 0.05, 10)).toBeCloseTo(share, 9);   // pixel much larger than a cell
    expect(NET_GLSL).toContain("float netCoverage( vec2 p )");
  });
});

describe("material detail routing", () => {
  it("routes materials by name", () => {
    expect(detailFor("M_Grass.web")).toBe("grass");
    expect(detailFor("M_Net.web")).toBe("net");
    for (const m of ["M_Concrete.web", "M_ConcreteRiser.web", "M_StepNosing.web", "M_Soffit.web"]) expect(detailFor(m)).toBe("concrete");
    expect(detailFor("M_SailSkin.web")).toBeUndefined();
    expect(CONCRETE_GLSL).toContain("vec3 concreteDetail( vec3 pB, vec3 nB )");
  });
});
