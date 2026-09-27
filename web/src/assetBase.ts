/**
 * Where the heavy, non-git files live (baked assets, brand logos, the licensed font). Locally they are served
 * from web/public (base ""). In production VITE_ASSET_BASE points at the versioned Vercel Blob folder written by
 * scripts/upload_assets.sh, e.g. https://<store>.public.blob.vercel-storage.com/v4-a6c3953/ ; each export gets
 * its own folder, so the 30-day CDN cache never serves a stale lightmap.
 */
export function assetBaseFrom(raw: string | undefined) {
  const b = (raw ?? "").trim();
  return b === "" ? "" : b.endsWith("/") ? b : b + "/";
}
export const ASSET_BASE = assetBaseFrom(import.meta.env.VITE_ASSET_BASE as string | undefined);
/** `path` is relative to web/public, e.g. "assets/manifest.json", "brand/aramco_logo.png". */
export const assetUrl = (path: string) => ASSET_BASE + path.replace(/^\//, "");
/** Cross-origin images must be loaded with CORS to be drawn into canvases that become textures. */
export const isRemote = () => ASSET_BASE !== "";

/** The licensed display font (theme.css used a same-origin @font-face; it now follows the asset base). */
export function loadDisplayFont() {
  if (typeof FontFace === "undefined") return;
  const f = new FontFace("Aktiv Grotesk", `url("${assetUrl("fonts/AktivGrotesk_Blk.woff2")}") format("woff2")`, { weight: "900", display: "swap" });
  f.load().then((ff) => (document.fonts as unknown as { add(f: FontFace): void }).add(ff), () => {});
}
