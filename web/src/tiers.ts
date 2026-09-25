import * as THREE from "three";

export type Tier = "Lower" | "Club" | "Upper";
export const TIERS: Tier[] = ["Lower", "Club", "Upper"];
/** UI swatches, aramcostadium.com tokens (spec part 2). */
export const TIER_HEX: Record<Tier, string> = { Lower: "#00D246", Club: "#EFE3C8", Upper: "#1480DB" };

/**
 * v4 (user request: as close to the Blender render as possible): the seats take the Cycles albedo itself
 * (scripts/stadium/bowl.py: M_Seat green on Lower and Upper, M_SeatClub on Club). The v2 (A6) swatch hues made
 * the upper tier blue, which Blender never shows; TIER_HEX stays for the UI only.
 */
export const SEAT_ALBEDO: Record<Tier, [number, number, number]> = {
  Lower: [0.03, 0.22, 0.12], Club: [0.72, 0.66, 0.55], Upper: [0.03, 0.22, 0.12],
};

export function tierAlbedo(t: Tier, out = new THREE.Color()) {
  const [r, g, b] = SEAT_ALBEDO[t];
  return out.setRGB(r, g, b);          // linear working space, as the Blender values
}
