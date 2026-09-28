import { STATES, type State } from "./loader";
import type { SeatRef } from "./seatsData";

/** `extra`: a companion seat next to `seat`, bought together (ticketing, user request 2026-09-27). */
export type View = { kind: "overview" } | { kind: "seat"; seat: SeatRef; extra?: SeatRef };
/** `inside`: the camera is in the bowl (under the roof), where auto orbit is off (user request 2026-09-27). */
export interface AppState { view: View; lighting: State; autoOrbit: boolean; inside: boolean }
export type Action =
  | { type: "seat"; seat: SeatRef; extra?: SeatRef }
  | { type: "extra"; seat: SeatRef | null }
  | { type: "back" }
  | { type: "lighting"; lighting: State }
  | { type: "camera"; camera: string }      // a hero view or a mode-bar camera
  | { type: "autoOrbit"; on: boolean }
  | { type: "inside"; on: boolean }
  | { type: "none" };

// user request 2026-09-28: open at night (was golden hour); ?state= still overrides
export const initialState: AppState = { view: { kind: "overview" }, lighting: "night", autoOrbit: false, inside: false };
export const sameSeat = (a: SeatRef, b: SeatRef) => a.section === b.section && a.row === b.row && a.seat === b.seat;

const sameOpt = (a?: SeatRef, b?: SeatRef) => (a && b ? sameSeat(a, b) : a === b);

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "seat":
      if (s.view.kind === "seat" && sameSeat(s.view.seat, a.seat) && sameOpt(s.view.extra, a.extra)) return s;
      return { ...s, view: a.extra ? { kind: "seat", seat: a.seat, extra: a.extra } : { kind: "seat", seat: a.seat }, autoOrbit: false };
    case "extra":
      if (s.view.kind !== "seat" || sameOpt(s.view.extra, a.seat ?? undefined)) return s;
      return { ...s, view: a.seat ? { ...s.view, extra: a.seat } : { kind: "seat", seat: s.view.seat } };
    case "back":
      return s.view.kind === "overview" ? s : { ...s, view: { kind: "overview" } };
    case "lighting":
      return s.lighting === a.lighting ? s : { ...s, lighting: a.lighting };
    case "camera":
      return { ...s, view: { kind: "overview" }, autoOrbit: false };
    case "autoOrbit":
      if (a.on === s.autoOrbit || (a.on && (s.view.kind === "seat" || s.inside))) return s;
      return { ...s, autoOrbit: a.on };
    case "inside":
      return a.on === s.inside ? s : { ...s, inside: a.on, autoOrbit: s.autoOrbit && !a.on };
    default:
      return s;
  }
}

/** `?state=` URL param: only golden/night are accepted (old ?state=day links open at night). */
export const parseLighting = (v: string | null): State =>
  STATES.includes(v as State) ? (v as State) : initialState.lighting;
