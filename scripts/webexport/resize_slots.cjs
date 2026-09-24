#!/usr/bin/env node
// Resize textures by material texture slot (glTF-Transform's CLI `resize`
// command only supports matching by texture name/URI via --pattern, not by
// the material slot that uses it). This uses the `textureCompress` function
// from @gltf-transform/functions directly, with `slots` (a regex matched
// against slot names like "baseColorTexture" / "normalTexture") and `resize`
// set, and `targetFormat` left unset so only pixel dimensions change --
// image format/encoding is decided later by the etc1s/uastc steps.
//
// Usage: node resize_slots.cjs <in.glb> <out.glb> <slotName>=<maxPx> [...]
'use strict';
const path = require('path');

function loadPkg(name) {
  // When invoked via `npx -p @gltf-transform/core@X -p @gltf-transform/functions@X -- node ...`,
  // npx puts the temp install's .bin on PATH[0]; resolve node_modules from there
  // so `require(name)` finds the pinned version even though this script lives
  // outside that install. Falls back to normal resolution otherwise.
  try {
    const binDir = process.env.PATH.split(path.delimiter)[0];
    const modDir = path.dirname(binDir);
    return require(path.join(modDir, name));
  } catch (e) {
    return require(name);
  }
}

async function main() {
  const [inFile, outFile, ...rest] = process.argv.slice(2);
  if (!inFile || !outFile || rest.length === 0) {
    console.error('usage: resize_slots.cjs <in.glb> <out.glb> <slotName>=<maxPx> [...]');
    process.exit(2);
  }
  const { NodeIO } = loadPkg('@gltf-transform/core');
  const { textureCompress } = loadPkg('@gltf-transform/functions');

  const io = new NodeIO();
  const document = await io.read(inFile);

  for (const spec of rest) {
    const [slot, maxPxStr] = spec.split('=');
    const maxPx = Number(maxPxStr);
    if (!slot || !Number.isFinite(maxPx)) {
      console.error(`bad slot spec: ${spec}`);
      process.exit(2);
    }
    await document.transform(
      textureCompress({ slots: new RegExp(`^${slot}$`), resize: [maxPx, maxPx] }),
    );
  }

  await io.write(outFile, document);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
