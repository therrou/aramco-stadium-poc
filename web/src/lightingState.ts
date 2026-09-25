import type { V3 } from "./coords";
import { STATES, type State } from "./loader";

export const STATE_NIGHT: Record<State, number> = { day: 0, golden: 0.6, night: 1 };
export const TRANSITION_S = 1.0;
const QUEUED_S = 0.25;
const smooth = (t: number) => t * t * (3 - 2 * t);

export class LightingTransition {
  from: State; to: State; blend = 1;
  private pending: State | null = null;
  constructor(initial: State) { this.from = this.to = initial; }
  request(s: State) {
    if (this.blend >= 1) { if (s !== this.to) { this.from = this.to; this.to = s; this.blend = 0; } return; }
    if (s === this.from) { [this.from, this.to] = [this.to, this.from]; this.blend = 1 - this.blend; this.pending = null; return; }
    this.pending = s === this.to ? null : s;
  }
  update(dt: number) {
    if (this.blend >= 1) return;
    this.blend = Math.min(1, this.blend + dt / (this.pending ? QUEUED_S : TRANSITION_S));
    if (this.blend < 1) return;
    if (this.pending) { this.from = this.to; this.to = this.pending; this.pending = null; this.blend = 0; }
    else this.from = this.to;   // settle (final review 1b): Lighting then rebinds A = B, so no sampler keeps the old state
  }
  get eased() { return smooth(this.blend); }
  get night() { return STATE_NIGHT[this.from] + (STATE_NIGHT[this.to] - STATE_NIGHT[this.from]) * this.eased; }
}

/** lighting._render_settings: exposure = 0.25 + 0.5 n + camera["exposure"] (stops). */
export const exposure = (n: number, e: number) => 2 ** (0.25 + 0.5 * n + e);
export const emissionStrength = (d: number, nightS: number, n: number) => d + n * (nightS - d);

const T = (n: number) => Math.min(n / 0.6, 1);
/** Direction toward the sun (Blender), from lighting.SUN_ELEV_EXPR / SUN_AZ_EXPR / _sun_rotation. */
export function sunToward(n: number): V3 {
  const e = ((24 - 22 * T(n)) * Math.PI) / 180, a = ((235 + 55 * T(n)) * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
}
export const sunStrength = (n: number) => 3 * Math.max(0, 1 - (n / 0.85) ** 2);
export const sunColor = (n: number): V3 => [1, 0.93 - 0.33 * T(n), 0.82 - 0.52 * T(n)];

/**
 * The single "lightmaps present" check (fix round 1): every state must have a lightmap for every group,
 * where the groups are those the glb references plus any the manifest lists. Returns "state/group" for
 * each gap; an empty list means the lightmap path can be used.
 */
export function missingLightmaps(lightmaps: Record<State, Record<string, unknown>>, glbGroups: Iterable<string>): string[] {
  const groups = new Set(glbGroups);
  for (const s of STATES) for (const g of Object.keys(lightmaps[s])) groups.add(g);
  if (groups.size === 0) return ["(no lightmap groups)"];
  const out: string[] = [];
  for (const s of STATES) for (const g of groups) if (!lightmaps[s][g]) out.push(`${s}/${g}`);
  return out;
}

/** uEnvB is sampled with the "from" PMREM's CUBEUV defines, so all env HDRs must share one size. */
export function envSizeMismatch(sizes: { width: number; height: number }[]): string | null {
  const k = sizes.map((d) => `${d.width}x${d.height}`);
  return new Set(k).size > 1 ? `env HDR sizes differ (${k.join(", ")})` : null;
}
