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

/** v3: runs `act` and saves a frame every `every` ticks until the flight lands (plus the landing frame). */
export async function flightFrames(prefix, act, every = 12) {
  const v = window.__viewer, dt = 1 / 60;
  v.dispatch(act);
  let n = 0, i = 0;
  while (v.rig.flying && i < 60 * 6) {
    if (i % every === 0) await v.save(`${prefix}_${String(n++).padStart(2, "0")}`);
    v.tick(dt); i++;
  }
  await v.save(`${prefix}_${String(n++).padStart(2, "0")}`);
  return `${n} frames over ${(i / 60).toFixed(2)} s`;
}

/** v3: jumps to a named Blender camera (orbit pivot as in the app) in a state and saves the frame. */
export async function shot(name, cam, state, nudge) {
  const v = window.__viewer, c = v.assets.cameras[cam];
  v.rig.jump({ eye: c.eye, target: c.target, hfov: c.hfov }, c.exposure);
  if (nudge) v.rig.jump(nudge(v.rig.pose()), c.exposure);
  v.setState(state);
  for (let k = 0; k < 10; k++) v.tick(0.5);
  await new Promise((r) => setTimeout(r, 200));
  return v.save(name);
}
