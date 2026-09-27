import { expect, it } from "vitest";
import { assetBaseFrom } from "./assetBase";

it("asset base: empty stays relative (dev), a URL gets exactly one trailing slash", () => {
  expect(assetBaseFrom(undefined)).toBe("");
  expect(assetBaseFrom("  ")).toBe("");
  expect(assetBaseFrom("https://x.blob.vercel-storage.com/v4-abc")).toBe("https://x.blob.vercel-storage.com/v4-abc/");
  expect(assetBaseFrom("https://x.blob.vercel-storage.com/v4-abc/")).toBe("https://x.blob.vercel-storage.com/v4-abc/");
});
