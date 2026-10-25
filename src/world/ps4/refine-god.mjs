import { statueShape, rotateStatuePoint } from "./statue-shapes.mjs";

const ANATOMY_REVISION = 3;

/** Upgrade cached PS4 baselines in place without adding or renumbering owners. */
export function refineGod(site, parts) {
  if (
    parts.some(
      (e) => e.visual?.shape === "hero-head" && e.visual.anatomyRevision === ANATOMY_REVISION,
    )
  )
    return false;
  const yaw = site.yaw ?? 0;
  let neckPart = 0;
  for (const e of parts) {
    const v = e.visual;
    if (!v) continue;
    let origin = e.p.map((p, k) => p + v.offset[k]);
    const local = rotateStatuePoint(
      origin.map((p, k) => p - site.p[k]),
      [0, -yaw, 0],
    );
    const [x, y, z] = v.size;
    let changed = true;
    if ((v.shape === "pineapple" || v.shape === "hero-head") && x === 120) {
      v.shape = "hero-head";
      v.anatomyRevision = ANATOMY_REVISION;
    } else if (
      (v.shape === "sector" || v.shape === "hero-torso") &&
      x === 200 &&
      y === 250
    )
      v.shape = "hero-torso";
    else if (v.shape === "ellipsoid" && x === 55 && y === 52 && z === 58) {
      const side = Math.sign(local[0]),
        i =
          side < 0
            ? Math.round((-local[0] - 175) / 25)
            : Math.round((local[0] - 175) / 12);
      v.size =
        i === 2 || i === 5
          ? [1, 1, 1]
          : i === 3
            ? [55, 56, 60]
            : i >= 6
              ? [45, 46, 50]
              : [74, 82, 73];
    } else if (v.shape === "ellipsoid" && x === 85 && y === 70 && z === 70)
      v.size = [88, 82, 76];
    else if (
      v.role === "eye" ||
      (v.shape === "box" &&
        Math.abs(local[1] - 795) < 0.01 &&
        Math.abs(local[2] - 104) < 0.01)
    ) {
      v.role = "eye";
      local[2] = 82;
      v.size = [20, 4, 2];
      origin = rotateStatuePoint(local, [0, yaw, 0]).map(
        (p, k) => p + site.p[k],
      );
    } else if (
      (v.shape === "box" && x === 34 && y === 4 && z === 5) ||
      v.shape === "hero-mouth"
    ) {
      v.shape = "ellipsoid";
      v.size = [0.1, 0.1, 0.1];
      origin = [...site.p];
      origin[1] += 780;
    } else if (
      v.shape === "hero-neck" ||
      (v.shape === "ellipsoid" &&
        ((x === 31 && y === 8 && z === 9) ||
          (x === 28 && y === 24 && z === 5) ||
          (x === 12 && y === 30 && z === 12) ||
          (x === 40 && y === 18 && z === 9) ||
          (x === 0.1 && y === 0.1 && z === 0.1 && v.color === "#cf9e38")))
    ) {
      // Reuse the six obsolete appliques for an exposed golden neck/trapezius.
      v.shape = "hero-neck";
      v.band = 0;
      v.azimuth = (neckPart++ * Math.PI) / 3;
      v.size = [100, 40, 75];
      origin = [...site.p];
      origin[1] += 657;
    } else changed = false;
    if (!changed) continue;
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    const vertices = statueShape(v.shape, v.band, v.azimuth);
    for (let i = 0; i < vertices.length; i += 3) {
      const p = rotateStatuePoint(
        rotateStatuePoint(vertices.slice(i, i + 3), [0, v.azimuth, 0]).map(
          (n, k) => n * v.size[k],
        ),
        v.rotation,
      );
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
    const center = min.map((n, k) => (n + max[k]) / 2);
    e.p = origin.map((n, k) => n + center[k]);
    e.s = min.map((n, k) => Math.max(0.01, (max[k] - n) / 2));
    v.offset = center.map((n) => (n === 0 ? 0 : -n));
  }
  return true;
}
export function reconnectGod(parts) {
  for (const e of parts) e.supports = [];
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i],
        b = parts[j];
      if (a.p.every((p, k) => Math.abs(p - b.p[k]) <= a.s[k] + b.s[k] + 0.2)) {
        a.supports.push(b.id);
        b.supports.push(a.id);
      }
    }
}
