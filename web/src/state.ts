import { STATES, type State } from "./loader";
import type { SeatRef } from "./seatsData";

export type View = { kind: "overview" } | { kind: "seat"; seat: SeatRef };
export interface AppState { view: View; lighting: State; autoOrbit: boolean }
export type Action =
  | { type: "seat"; seat: SeatRef }
  | { type: "back" }
  | { type: "lighting"; lighting: State }
  | { type: "camera"; camera: string }      // a hero view or a mode-bar camera
  | { type: "autoOrbit"; on: boolean }
  | { type: "none" };

export const initialState: AppState = { view: { kind: "overview" }, lighting: "golden", autoOrbit: false };
export const sameSeat = (a: SeatRef, b: SeatRef) => a.section === b.section && a.row === b.row && a.seat === b.seat;

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "seat":
      if (s.view.kind === "seat" && sameSeat(s.view.seat, a.seat)) return s;
      return { ...s, view: { kind: "seat", seat: a.seat }, autoOrbit: false };
    case "back":
      return s.view.kind === "overview" ? s : { ...s, view: { kind: "overview" } };
    case "lighting":
      return s.lighting === a.lighting ? s : { ...s, lighting: a.lighting };
    case "camera":
      return { ...s, view: { kind: "overview" }, autoOrbit: false };
    case "autoOrbit":
      if (a.on === s.autoOrbit || (a.on && s.view.kind === "seat")) return s;
      return { ...s, autoOrbit: a.on };
    default:
      return s;
  }
}

/** `?state=` URL param: only day/golden/night are accepted. */
export const parseLighting = (v: string | null): State =>
  STATES.includes(v as State) ? (v as State) : initialState.lighting;
