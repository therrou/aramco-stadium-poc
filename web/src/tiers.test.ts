import { expect, it } from "vitest";
import * as THREE from "three";
import { tierAlbedo, TIER_HEX, TIERS } from "./tiers";

const Y = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
it("A6: seat albedo has the tier hue at the Cycles seat's luminance (bowl.py M_Seat / M_SeatClub)", () => {
  expect(Y(tierAlbedo("Lower"))).toBeCloseTo(0.2126 * 0.03 + 0.7152 * 0.22 + 0.0722 * 0.12, 6);
  expect(Y(tierAlbedo("Upper"))).toBeCloseTo(0.2126 * 0.03 + 0.7152 * 0.22 + 0.0722 * 0.12, 6);
  expect(Y(tierAlbedo("Club"))).toBeCloseTo(0.2126 * 0.72 + 0.7152 * 0.66 + 0.0722 * 0.55, 6);
  for (const t of TIERS) {   // same hue as the UI swatch
    const a = tierAlbedo(t).getHSL({ h: 0, s: 0, l: 0 }), b = new THREE.Color(TIER_HEX[t]).getHSL({ h: 0, s: 0, l: 0 });
    expect(a.h).toBeCloseTo(b.h, 3);
  }
});
