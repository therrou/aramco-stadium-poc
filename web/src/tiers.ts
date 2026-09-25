import * as THREE from "three";

export type Tier = "Lower" | "Club" | "Upper";
export const TIERS: Tier[] = ["Lower", "Club", "Upper"];
/** UI swatches, aramcostadium.com tokens (spec part 2). */
export const TIER_HEX: Record<Tier, string> = { Lower: "#00D246", Club: "#EFE3C8", Upper: "#1480DB" };

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Linear albedo luminance of the Cycles seats (scripts/stadium/bowl.py): M_Seat (Lower, Upper), M_SeatClub. */
const TIER_LUMA: Record<Tier, number> = { Lower: luma(0.03, 0.22, 0.12), Club: luma(0.72, 0.66, 0.55), Upper: luma(0.03, 0.22, 0.12) };

/** A6 (v2): the tier's swatch hue at the Cycles seat brightness, in the linear working space. */
export function tierAlbedo(t: Tier, out = new THREE.Color()) {
  out.set(TIER_HEX[t]);
  return out.multiplyScalar(TIER_LUMA[t] / luma(out.r, out.g, out.b));
}
