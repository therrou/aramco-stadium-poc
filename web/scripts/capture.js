// v2 visual check (dev server only): in the page, `(await import("/scripts/capture.js")).cap("v2")`.
// Captures the 9 reference cam/state pairs and the nudge pair to renders/web_v2/<prefix>_*.png and
// returns the frame metrics. See docs/superpowers/reports/2026-09-25-v2-visual-check.md (Method).
const CAMS = ["CAM_Aerial_Dusk", "CAM_Approach", "CAM_Seat_212"], STATES = ["day", "golden", "night"];
const pose = (c) => ({ eye: c.eye, target: c.target, hfov: c.hfov });

async function show(v, cam, st) {
  const c = v.assets.cameras[cam];
  v.rig.jump(pose(c), c.exposure);
  v.setState(st);
  for (let k = 0; k < 10; k++) v.tick(0.5);
  await new Promise((r) => setTimeout(r, 300));
}

export async function cap(prefix, { cams = CAMS, states = STATES, nudge = true } = {}) {
  const v = window.__viewer, out = [];
  for (const cam of cams) for (const st of states) {
    await show(v, cam, st);
    const s = v.stats();
    await v.save(`${prefix}_${cam}_${st}`);
    out.push(`${cam} ${st} mean ${s.mean.toFixed(1)} clipped ${(s.clipped * 100).toFixed(2)}%`);
  }
  if (nudge) {
    await show(v, "CAM_Aerial_Dusk", "night");
    await v.save(`${prefix}_nudge_a`);
    v.nudge(1.8);
    await v.save(`${prefix}_nudge_b`);
    out.push("nudge frames saved");
  }
  return out.join("\n");
}
