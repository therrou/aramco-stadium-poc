import { defineConfig, type Plugin } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * v2 Task 1 (dev server only): POST /__save?name=<file> writes the body to renders/web_v2/<file>.png, so
 * the visual check captures frames without browser downloads (__viewer.save in main.ts).
 */
const saveFrames = (): Plugin => ({
  name: "save-frames",
  configureServer(server) {
    server.middlewares.use("/__save", (req, res) => {
      const name = new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "";
      if (req.method !== "POST" || !/^[\w.-]+$/.test(name)) { res.statusCode = 400; res.end(); return; }
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const dir = new URL("../renders/web_v2/", import.meta.url);
        mkdirSync(dir, { recursive: true });
        writeFileSync(new URL(`${name}.png`, dir), Buffer.concat(chunks));
        res.end("ok");
      });
    });
  },
});

export default defineConfig({ plugins: [saveFrames()], test: { environment: "node" } } as any);
