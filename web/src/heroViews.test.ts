import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { HERO_VIEWS, MODE_CAMERAS, heroesIn } from "./heroViews";

// cameras.json is a build product (gitignored), so this check runs where the assets are built
const url = new URL("../public/assets/cameras.json", import.meta.url);
it.skipIf(!existsSync(url))("every CAM_Seat_* camera has a labelled hero view, and every listed camera exists", () => {
  const cams = JSON.parse(readFileSync(url, "utf8"));
  const seatCams = Object.keys(cams).filter((k) => k.startsWith("CAM_Seat_")).sort();
  expect(HERO_VIEWS.map((h) => h.cam).sort()).toEqual(seatCams);
  for (const m of MODE_CAMERAS) expect(cams[m.cam]).toBeDefined();
});
it("hero list keeps only cameras the assets have", () => {
  expect(heroesIn({ CAM_Seat_201: {} }).map((h) => h.cam)).toEqual(["CAM_Seat_201"]);
});
it("Exterior is the key-visual camera (HD key visual framing, v5)", () => {
  expect(MODE_CAMERAS.find((m) => m.label === "Exterior")?.cam).toBe("CAM_KeyVisual");
});
