#!/usr/bin/env bash
# build/web_raw -> web/public/assets  (spec §2). Needs node and KTX-Software `ktx` >= 4.3.
#
# KTX-Software setup (no sudo, per controller ruling R3):
#   gh release download v4.4.2 -R KhronosGroup/KTX-Software \
#     --pattern 'KTX-Software-4.4.2-Darwin-arm64.pkg' -D /private/tmp/ktx --clobber
#   pkgutil --expand-full /private/tmp/ktx/KTX-Software-4.4.2-Darwin-arm64.pkg /private/tmp/ktx/expanded
#   mkdir -p tools/ktx/bin tools/ktx/lib
#   cp -R /private/tmp/ktx/expanded/KTX-Software-4.4.2-Darwin-arm64-tools.pkg/Payload/usr/local/bin/. tools/ktx/bin/
#   cp -R /private/tmp/ktx/expanded/KTX-Software-4.4.2-Darwin-arm64-library.pkg/Payload/usr/local/lib/. tools/ktx/lib/
# The `ktx` binary's LC_RPATH is @executable_path/../lib, so keeping bin/ and lib/
# side by side under tools/ktx/ is enough for it to find libktx without
# DYLD_LIBRARY_PATH. `tools/` is gitignored; this setup is local to each machine.
# Per-slot texture size caps (controller ruling R4): gltf-transform's CLI
# `resize` command only matches textures by name/URI (--pattern), not by the
# material slot that uses them, so per-slot caps go through
# scripts/webexport/resize_slots.cjs, which calls @gltf-transform/functions'
# `textureCompress({slots, resize})` directly (same pinned 4.5.0 version,
# fetched via `npx -p @gltf-transform/core@4.5.0 -p .../functions@4.5.0
# -p .../extensions@4.5.0 -- node ...`). targetFormat is left unset there, so
# only pixel dimensions change; ETC1S/UASTC encoding still happens below.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$(pwd)/tools/ktx/bin:$PATH"
RAW=build/web_raw
OUT=web/public/assets
GT="npx --yes @gltf-transform/cli@4.5.0"
GTJS="npx --yes -p @gltf-transform/core@4.5.0 -p @gltf-transform/functions@4.5.0 -p @gltf-transform/extensions@4.5.0 -- node scripts/webexport/resize_slots.cjs"
rm -rf "$OUT" && mkdir -p "$OUT"

# Track every opt_glb tmp dir so a failure mid-pipeline (set -e) still cleans
# up instead of leaking mktemp dirs.
TMP_DIRS=()
cleanup() {
  local d
  for d in "${TMP_DIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d"
  done
}
trap cleanup EXIT

opt_glb () {   # $1 in, $2 out, [$3 baseColor cap px, default 1024], [$4 extra slot=px caps]
  local tmp; tmp=$(mktemp -d)
  TMP_DIRS+=("$tmp")
  $GT dedup "$1" "$tmp/a.glb"
  $GT instance "$tmp/a.glb" "$tmp/b.glb" --min 5        # trees: repeated nodes -> EXT_mesh_gpu_instancing
  $GT prune "$tmp/b.glb" "$tmp/c.glb" --keep-attributes        # keep TEXCOORD_1 (lightmap UVs, unused until Tasks 10/12)
  $GT weld "$tmp/c.glb" "$tmp/d.glb"
  $GT resize "$tmp/d.glb" "$tmp/e0.glb" --width 2048 --height 2048     # global cap; emissiveTexture (baked later, Task 11) stays here
  $GTJS "$tmp/e0.glb" "$tmp/e.glb" normalTexture=512 baseColorTexture="${3:-1024}" ${4:-}
  $GT etc1s "$tmp/e.glb" "$tmp/f.glb" --slots '@(baseColorTexture|emissiveTexture)'
  $GT uastc "$tmp/f.glb" "$tmp/g.glb" --slots "normalTexture" --level 2 --zstd 18
  $GT meshopt "$tmp/g.glb" "$2"
  rm -rf "$tmp"
}

opt_glb "$RAW/stadium.glb" "$OUT/stadium.glb"
# trees: near LODs are >= ~140 m from the bowl, so small textures are plenty (size budget, Task 12)
[ -f "$RAW/trees.glb" ] && opt_glb "$RAW/trees.glb" "$OUT/trees.glb" 512 metallicRoughnessTexture=256
cp "$RAW/seats.bin" "$RAW/sections.json" "$RAW/cameras.json" "$OUT/"

# lightmaps and impostor atlases: PNG -> KTX2. Lightmaps are RGBM (linear), capped at 4096.
LMTMP=$(mktemp -d); TMP_DIRS+=("$LMTMP")
find "$RAW" \( -path "*/lightmaps/*.png" -o -path "*/impostors/*.png" \) -not -path "*/lightmaps_noisy/*" | while read -r png; do
  rel=${png#"$RAW/"}; dst="$OUT/${rel%.png}.ktx2"; mkdir -p "$(dirname "$dst")"
  case "$rel" in lightmaps/*)            # v4: RGBM -> gamma RGB before UASTC (webexport/rgbm.py GAMMA)
    g="$LMTMP/$(echo "$rel" | tr / _)"; PYTHONPATH=scripts .venv/bin/python -m webexport.rgbm "$png" "$g"; png="$g" ;;
  esac
  case "$rel" in
    # A7 (v2): mips on the far site only (seen at 6.5 m/texel from every aerial, where it shimmered). Mips on
    # every group cost +3.6 MB (37.2 MB > 35 MB budget; zstd 22 and UASTC RDO saved < 0.2 MB). RGBM filters
    # approximately across levels, far less visible than the aliasing without them.
    lightmaps/*/site.png) ktx create --format R8G8B8A8_UNORM --assign-tf linear --encode uastc --uastc-quality 2 --uastc-rdo --uastc-rdo-l 0.5 --zstd 18 --generate-mipmap "$png" "$dst" ;;
    lightmaps/*) ktx create --format R8G8B8A8_UNORM --assign-tf linear --encode uastc --uastc-quality 2 --uastc-rdo --uastc-rdo-l 0.5 --zstd 18 "$png" "$dst" ;;
    impostors/*) ktx create --format R8G8B8A8_SRGB --encode uastc --uastc-quality 2 --uastc-rdo --uastc-rdo-l 0.5 --zstd 18 --generate-mipmap "$png" "$dst" ;;
  esac
done
if [ -d "$RAW/env" ]; then
  mkdir -p "$OUT/env"
  shopt -s nullglob
  hdrs=("$RAW"/env/*.hdr)
  shopt -u nullglob
  if [ ${#hdrs[@]} -gt 0 ]; then cp "${hdrs[@]}" "$OUT/env/"; fi
fi

# manifest: point lightmaps/impostors at .ktx2
node -e '
const fs=require("fs");const m=JSON.parse(fs.readFileSync(process.argv[1]));
const k=p=>p&&p.replace(/\.png$/,".ktx2");
for(const s of Object.values(m.states)) for(const g in s.lightmaps) s.lightmaps[g]=k(s.lightmaps[g]);
m.lmGamma=3;   // v4: lightmaps are gamma RGB (webexport/rgbm.py GAMMA), not RGBM
if(m.trees&&m.trees.impostors) for(const i of Object.values(m.trees.impostors)) i.atlas=k(i.atlas);
fs.writeFileSync(process.argv[2],JSON.stringify(m,null,1));' "$RAW/manifest.json" "$OUT/manifest.json"

PYTHONPATH=scripts .venv/bin/python -m webexport.sizecheck "$OUT" --limit 50
