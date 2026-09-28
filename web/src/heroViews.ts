import type { Tier } from "./tiers";

/** "Views worth exploring" (spec part 2): the CAM_Seat_* hero cameras, labelled by position and tier. */
export const HERO_VIEWS: { cam: string; title: string; tier: Tier }[] = [
  { cam: "CAM_Seat_201", title: "The centre-line classic", tier: "Club" },
  { cam: "CAM_Seat_101", title: "Pitchside on halfway", tier: "Lower" },
  { cam: "CAM_Seat_123", title: "Far touchline, front rows", tier: "Lower" },
  { cam: "CAM_Seat_112", title: "Behind the east goal", tier: "Lower" },
  { cam: "CAM_Seat_134", title: "Behind the west goal", tier: "Lower" },
  { cam: "CAM_Seat_212", title: "Club end view", tier: "Club" },
  { cam: "CAM_Seat_301", title: "High above halfway", tier: "Upper" },
  { cam: "CAM_Seat_306", title: "The corner angle", tier: "Upper" },
  { cam: "CAM_Seat_312", title: "Top of the east end", tier: "Upper" },
  { cam: "CAM_Seat_323", title: "Far side, upper tier", tier: "Upper" },
];
/** Bottom mode bar cameras (auto orbit is a separate toggle). */
export const MODE_CAMERAS = [
  { cam: "CAM_Bowl", label: "Stadium" },
  { cam: "CAM_KeyVisual", label: "Exterior" },   // v5: the HD key visual's view
  { cam: "CAM_Top", label: "Top view" },
];
export const heroesIn = (cameras: Record<string, unknown>) => HERO_VIEWS.filter((h) => h.cam in cameras);
