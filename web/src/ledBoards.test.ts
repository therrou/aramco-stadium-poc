import { describe, expect, it } from "vitest";
import { BOARDS, boardU, panelAt, LED_GLSL_BOARDS, isLedBoard } from "./ledBoards";

describe("pitch LED ad boards", () => {
  it("runs one continuous coordinate round the board loop (metres), starting at the south-west corner", () => {
    const { bl, bw } = BOARDS;
    expect(boardU(-bl, -bw)).toBeCloseTo(0, 6);
    expect(boardU(bl, -bw)).toBeCloseTo(2 * bl, 6);                  // along the south touchline
    expect(boardU(bl, bw)).toBeCloseTo(2 * bl + 2 * bw, 6);          // up the east end
    expect(boardU(-bl, bw)).toBeCloseTo(4 * bl + 2 * bw, 6);         // back along the north touchline
    expect(boardU(-bl, 0)).toBeCloseTo(4 * bl + 3 * bw, 6);          // half way down the west end
  });
  it("alternates aramco and AKQA panels, and the whole set steps one panel on each swap", () => {
    expect(panelAt(0, 0)).toBe("aramco");
    expect(panelAt(BOARDS.panel + 0.1, 0)).toBe("akqa");
    expect(panelAt(2 * BOARDS.panel + 0.1, 0)).toBe("aramco");
    expect(panelAt(0, 1)).toBe("akqa");                               // after one swap
  });
  it("front (pitch side) shows the ad, the back (seat side) is black and empty", () => {
    expect(LED_GLSL_BOARDS).toContain("bool facesPitch");
    expect(LED_GLSL_BOARDS).toContain("dot( cameraB - pB, -outward )");
    expect(isLedBoard("M_LEDBoard.web")).toBe(true);
    expect(isLedBoard("M_BoardBack.web")).toBe(false);
  });
});
