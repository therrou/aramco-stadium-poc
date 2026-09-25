import { describe, expect, it } from "vitest";
import { BOARDS, boardU, panelAt, LED_EMISSIVE_GLSL, LED_GLSL_BOARDS, isLedBoard, whiteFromDark, fitLogo } from "./ledBoards";

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
  it("v4: both faces show the ad (as in Cycles), read unmirrored from behind", () => {
    expect(LED_GLSL_BOARDS).toContain("bool facesPitch");
    expect(LED_GLSL_BOARDS).toContain("dot( cameraB - pB, -outward )");
    expect(LED_GLSL_BOARDS).toContain("if ( !facesPitch ) s = -s;");
    expect(LED_EMISSIVE_GLSL).not.toContain("vec3( 0.0 )");
    expect(isLedBoard("M_LEDBoard.web")).toBe(true);
    expect(isLedBoard("M_BoardBack.web")).toBe(false);
  });
});

describe("v4 ad logos (user-supplied aramco / AKQA)", () => {
  it("turns the black-on-white aramco wordmark into a white mark with the darkness as alpha", () => {
    const px = whiteFromDark(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]));
    expect([...px.slice(0, 4)]).toEqual([255, 255, 255, 255]);   // black glyph: opaque white
    expect(px[7]).toBe(0);                                        // white background: transparent
  });
  it("fits a logo inside its box, centred, keeping the aspect ratio", () => {
    const [x, y, w, h] = fitLogo(1200, 587, 0, 0, 2048, 115);
    expect(h).toBeCloseTo(115); expect(w / h).toBeCloseTo(1200 / 587);
    expect(x + w / 2).toBeCloseTo(1024); expect(y).toBeCloseTo(0);
  });
});
