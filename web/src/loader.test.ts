import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { runJobs, AssetError, fetchJson, collect, assetJobs, stateJobs, treeJobs, type Manifest, type makeLoaders } from "./loader";

const ok = (v: string) => async (p: (f: number) => void) => { p(0.5); p(1); return v; };
const fail = async () => { throw new Error("404"); };

describe("runJobs", () => {
  it("reports monotonic progress ending at 1", async () => {
    const seen: number[] = [];
    const out = await runJobs([{ file: "a", run: ok("A") }, { file: "b", run: ok("B") }], (f) => seen.push(f));
    expect(out.get("a")).toBe("A");
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((f, i) => i === 0 || f >= seen[i - 1])).toBe(true);
  });
  it("optional failures resolve to null", async () => {
    const out = await runJobs([{ file: "t", optional: true, run: fail }], () => {});
    expect(out.get("t")).toBeNull();
  });
  it("required failure names the file; retry re-runs only failed jobs", async () => {
    let calls = 0;
    const flaky = async () => { calls++; if (calls === 1) throw new Error("net"); return "S"; };
    const jobs = [{ file: "a", run: ok("A") }, { file: "stadium.glb", run: flaky }];
    const done = new Map<string, unknown>();
    await expect(runJobs(jobs, () => {}, done)).rejects.toMatchObject({ file: "stadium.glb" });
    expect(done.get("a")).toBe("A");
    let aRuns = 0;
    jobs[0].run = async () => { aRuns++; return "A2"; };
    const out = await runJobs(jobs, () => {}, done);
    expect(out.get("stadium.glb")).toBe("S");
    expect(aRuns).toBe(0);
    expect(new AssetError("x", new Error("y")).file).toBe("x");
  });
});

describe("fetchJson (final review 8)", () => {
  const res = (status: number, body: unknown) => (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch;
  it("returns the parsed body on 200", async () => {
    expect(await fetchJson("/a/cameras.json", "cameras.json", res(200, { a: 1 }))).toEqual({ a: 1 });
  });
  it("throws an HTTP error naming the file otherwise", async () => {
    await expect(fetchJson("/a/sections.json", "sections.json", res(404, null))).rejects.toThrow("HTTP 404 for sections.json");
  });
});

it("A7: lightmaps with mips are sampled trilinear; single-level ones stay linear", () => {
  const withMips = new THREE.Texture(), flat = new THREE.Texture();
  withMips.mipmaps = [{}, {}, {}] as any;
  flat.mipmaps = [{}] as any;
  const m = { stadium: "s.glb", seats: "b", sections: "x", cameras: "c", trees: null, rgbmRange: 16, version: 1,
    states: { golden: { night: 0.6, exposure: 0, env: null, lightmaps: { bowl: "a.ktx2", site: "b.ktx2" } },
              night: { night: 1, exposure: 0, env: null, lightmaps: {} } } } as Manifest;
  const a = collect(m, new Map<string, unknown>([["a.ktx2", withMips], ["b.ktx2", flat]]));
  expect(a.lightmaps.golden!.bowl.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  expect(a.lightmaps.golden!.site.minFilter).toBe(THREE.LinearFilter);
  expect(a.lightmaps.golden!.bowl.generateMipmaps).toBe(false);
});

it("lighter first load: only the start state's lightmaps are fetched up front; trees are separate", () => {
  const m = { stadium: "s.glb", seats: "b", sections: "x", cameras: "c", rgbmRange: 16, version: 1,
    trees: { glb: "t.glb", impostors: { palm: { atlas: "p.ktx2", frames: 8, size: 1, centerZ: 0 } } },
    states: { day: { night: 0, exposure: 0, env: "d.hdr", lightmaps: { bowl: "d.ktx2" } },
              golden: { night: 0.6, exposure: 0, env: "g.hdr", lightmaps: { bowl: "g.ktx2" } },
              night: { night: 1, exposure: 0, env: "n.hdr", lightmaps: { bowl: "n.ktx2" } } } } as unknown as Manifest;
  const L = {} as ReturnType<typeof makeLoaders>;
  const files = (j: { file: string }[]) => j.map((x) => x.file);
  expect(files(assetJobs(m, L, ["night"]))).toEqual(["s.glb", "b", "x", "c", "n.ktx2", "n.hdr"]);
  expect(files(stateJobs(m, L, "golden"))).toEqual(["g.ktx2", "g.hdr"]);
  expect(files(treeJobs(m, L))).toEqual(["t.glb", "p.ktx2"]);
  expect(treeJobs(m, L).every((j) => j.optional)).toBe(true);
  expect(files(assetJobs(m, L))).not.toContain("d.ktx2");   // an old manifest's day state is ignored
});
