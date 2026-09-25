import type { V3 } from "./coords";
import type { CameraDef } from "./loader";

export interface Pose { eye: V3; target: V3; hfov: number }

/** Seat view (spec part 2): eye 1.2 m above the tread, looking at the pitch centre, hfov 70. */
export const SEAT_EYE_M = 1.2, SEAT_HFOV = 70;
/**
 * OrbitControls target distance in seat view. The spec's 1 m makes a drag swing the eye up to 2 m around
 * the seat; 0.1 m keeps look-around a head turn (the camera orbits a point just ahead of the eye).
 */
export const SEAT_LOOK_M = 0.1;
/** Camera exposure (stops) in seat view: the CAM_Seat_* cameras' value. */
export const SEAT_EXP = 0.1;
export function seatViewPose([x, y, z]: V3): Pose {
  const eye: V3 = [x, y, z + SEAT_EYE_M], n = Math.hypot(...eye);
  return { eye, target: eye.map((v) => v - (v / n) * SEAT_LOOK_M) as V3, hfov: SEAT_HFOV };
}

export const cameraPose = (c: CameraDef): Pose => ({ eye: c.eye, target: c.target, hfov: c.hfov });

/** Blender sensor_fit AUTO: the fov applies to the larger image side. Returns Three's vertical fov. */
export function verticalFov(hfovLarger: number, aspect: number) {
  if (aspect <= 1) return hfovLarger;
  const h = (hfovLarger * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
