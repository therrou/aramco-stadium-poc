import { expect, it } from "vitest";
import { missingCapabilities } from "./capabilities";

it("names each missing capability", () => {
  expect(missingCapabilities({ webgl2: true, wasm: true })).toEqual([]);
  expect(missingCapabilities({ webgl2: false, wasm: true })).toEqual(["WebGL2"]);
  expect(missingCapabilities({ webgl2: true, wasm: false })).toEqual(["WebAssembly (needed for KTX2 textures)"]);
});
