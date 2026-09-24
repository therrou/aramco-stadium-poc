export function missingCapabilities(env: { webgl2: boolean; wasm: boolean }): string[] {
  const out: string[] = [];
  if (!env.webgl2) out.push("WebGL2");
  if (!env.wasm) out.push("WebAssembly (needed for KTX2 textures)");
  return out;
}

export function probe() {
  const c = document.createElement("canvas");
  return { webgl2: !!c.getContext("webgl2"), wasm: typeof WebAssembly === "object" };
}
