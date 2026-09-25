import { describe, expect, it } from "vitest";
import { runJobs, AssetError, fetchJson } from "./loader";

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
