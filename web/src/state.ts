import type { State } from "./loader";

export type View = { kind: "overview" } | { kind: "section"; section: number };
export interface AppState { view: View; lighting: State }
export type Action =
  | { type: "section"; section: number }
  | { type: "back" }
  | { type: "lighting"; lighting: State }
  | { type: "none" };

export const initialState: AppState = { view: { kind: "overview" }, lighting: "golden" };

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "section":
      if (s.view.kind === "section" && s.view.section === a.section) return s;
      return { ...s, view: { kind: "section", section: a.section } };
    case "back":
      return s.view.kind === "overview" ? s : { ...s, view: { kind: "overview" } };
    case "lighting":
      return s.lighting === a.lighting ? s : { ...s, lighting: a.lighting };
    default:
      return s;
  }
}
