import * as THREE from "three";

/** Click (not drag) -> normalised device coordinates. */
export function onClick(dom: HTMLElement, cb: (ndc: THREE.Vector2) => void) {
  let down: [number, number] | null = null;
  dom.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  dom.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = dom.getBoundingClientRect();
    cb(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1));
  });
}
