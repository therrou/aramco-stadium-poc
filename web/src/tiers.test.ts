import { expect, it } from "vitest";
import * as THREE from "three";
import { SEAT_ALBEDO, tierAlbedo, TIER_HEX, TIERS } from "./tiers";

it("v4: seat albedo is the Cycles seat colour (bowl.py M_Seat / M_SeatClub), upper tier green not blue", () => {
  for (const t of TIERS) expect(tierAlbedo(t).toArray()).toEqual(SEAT_ALBEDO[t]);
  expect(tierAlbedo("Upper").equals(tierAlbedo("Lower"))).toBe(true);
  const up = tierAlbedo("Upper");
  expect(up.g).toBeGreaterThan(up.b);                        // green, not the UI's blue swatch
  expect(TIER_HEX.Upper).toBe("#1480DB");                    // the UI swatch is unchanged
});
