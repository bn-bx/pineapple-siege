import { CONFIG } from "../config";
import type { Vec3, WorldData } from "../types";

/** A repeatable orbit clears terrain and the large monument without teleporting. */
export function flightBenchmarkRoute(
  world: WorldData,
  sample: (x: number, z: number) => number,
) {
  const radius = CONFIG.maxSpeed / (CONFIG.turnSpeed * 0.5),
    margin = 256;
  const god = world.sites.find((s) => s.kind === "pineapple-god");
  let best: { p: Vec3; yaw: number; pitch: number } | undefined,
    lowest = Infinity;
  for (let turn = 0; turn < 4; turn++) {
    const yaw = (turn * Math.PI) / 2;
    const x = world.castle[0] + Math.sin(yaw) * 900;
    const z = world.castle[2] + Math.cos(yaw) * 900;
    const cx = x + Math.cos(yaw) * radius,
      cz = z - Math.sin(yaw) * radius;
    const extent = radius + margin;
    if (
      cx - extent < 300 ||
      cz - extent < 300 ||
      cx + extent > world.size - 300 ||
      cz + extent > world.size - 300
    )
      continue;
    if (god && Math.hypot(cx - god.p[0], cz - god.p[2]) < extent + 700)
      continue;
    let highest = 0;
    for (let dz = -extent; dz <= extent; dz += 32)
      for (let dx = -extent; dx <= extent; dx += 32)
        highest = Math.max(highest, sample(cx + dx, cz + dz));
    const height = Math.max(900, highest + 200);
    if (height >= CONFIG.ceiling - 100 || highest >= lowest) continue;
    lowest = highest;
    best = { p: [x, height, z], yaw, pitch: 0 };
  }
  if (!best) throw Error("No safe flight benchmark orbit");
  return best;
}
