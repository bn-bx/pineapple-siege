import { statueShape, rotateStatuePoint } from "./statue-shapes.mjs";

/** Carved sections have tight world-space bounds and ordinary structural owners. */
export function buildPineappleGod(site, entities, hash, sample) {
  const start = entities.length,
    yaw = site.yaw;
  let role = "throne";
  const stone = "#777b67",
    gold = "#cf9e38",
    dark = "#4e5143",
    moss = "#626d45";
  const ground = (x, z) => {
    const p = rotateStatuePoint([x, 0, z], [0, yaw, 0]);
    return sample(site.p[0] + p[0], site.p[2] + p[2]) - site.p[1];
  };
  const add = (
    shape,
    p,
    size,
    color = stone,
    rotation = [0, 0, 0],
    band = 0,
    foundation = false,
    azimuth = 0,
  ) => {
    const origin = rotateStatuePoint(p, [0, yaw, 0]).map(
      (v, i) => v + site.p[i],
    );
    // Yaw is applied last, matching Three's YXZ Euler order.
    const turn = [rotation[0], rotation[1] + yaw, 0];
    const vertices = statueShape(shape, band),
      min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertices.length; i += 3) {
      const point = rotateStatuePoint(
        rotateStatuePoint(vertices.slice(i, i + 3), [0, azimuth, 0]).map(
          (v, k) => v * size[k],
        ),
        turn,
      );
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], point[k]);
        max[k] = Math.max(max[k], point[k]);
      }
    }
    const center = min.map((v, i) => (v + max[i]) / 2);
    const e = {
      id: entities.length,
      kind: "block",
      p: origin.map((v, i) => v + center[i]),
      s: min.map((v, i) => Math.max(0.01, (max[i] - v) / 2)),
      material: color === gold ? "sandstone" : "stone",
      assembly: site.id,
      foundation,
      supports: [],
      variant: hash(entities.length, 871),
      visual: {
        shape,
        band,
        azimuth,
        size,
        rotation: turn,
        offset: center.map((v) => (v === 0 ? 0 : -v)),
        color,
        role:
          shape === "box" &&
          Math.abs(Math.abs(p[0]) - 42) < 0.01 &&
          p[1] === 795 &&
          p[2] === 104
            ? "eye"
            : role,
      },
    };
    entities.push(e);
    return e;
  };
  const box = (p, s, color = stone, foundation = false) =>
    add("box", p, s, color, [0, 0, 0], 0, foundation);
  const round = (p, s, color = stone) => add("ellipsoid", p, s, color);
  const sculpt = (p, s, color, shape = "sector") => {
    for (let band = 0; band < 6; band++)
      for (let sector = 0; sector < 12; sector++)
        add(shape, p, s, color, [0, 0, 0], band, false, (sector * Math.PI) / 6);
  };
  // Masonry terrace and throne, deliberately sectioned for localized damage.
  for (let x = -4; x <= 4; x++)
    for (let z = -3; z <= 3; z++)
      box([x * 80, 20, z * 80], [40, 20, 40], stone, true);
  for (let tier = 0; tier < 4; tier++)
    for (let x = -3; x <= 3; x++)
      for (let z = -2; z <= 1; z++)
        box([x * 70, 60 + tier * 40, z * 80], [35, 20, 40]);
  for (let tier = 0; tier < 8; tier++)
    for (let x = -3; x <= 3; x++)
      box([x * 70, 200 + tier * 40, -180], [35, 20, 45]);
  for (const side of [-1, 1]) {
    for (let tier = 0; tier < 8; tier++)
      for (let z = -1; z <= 2; z++)
        box([side * 245, 200 + tier * 25, z * 65], [35, 12.5, 32.5]);
    box([side * 245, 395, 40], [42, 10, 150], gold);
    box([side * 245, 400, 180], [45, 16, 35], gold);
  }
  // Seated legs, layered robe and broad shoulders.
  role = "figure";
  sculpt([0, 440, -10], [200, 250, 150], stone);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++)
      round([side * 95, 230 - i * 20, 100 + i * 35], [85, 70, 70]);
    round([side * 95, 70, 265], [80, 50, 100]);
    for (let i = 0; i < 7; i++) {
      const p =
        side === -1
          ? i <= 3
            ? [-(175 + i * 25), 565 - i * 38, 10 + i * 35]
            : [-(250 + (i - 3) * 13), 451 + (i - 3) * 30, 115 + (i - 3) * 16]
          : [side * (175 + i * 12), 565 - i * 27, 10 + i * 20];
      round(p, [55, 52, 58]);
    }
    round(side === -1 ? [-290, 540, 165] : [247, 393, 155], [52, 30, 48]);
    for (let finger = 0; finger < 4; finger++)
      round(
        [
          side * (side === -1 ? 260 + finger * 19 : 215 + finger * 19),
          side === -1 ? 515 : 370,
          188,
        ],
        [10, 28, 16],
      );
    for (let i = 0; i < 5; i++)
      box([side * (45 + i * 23), 270, 192], [7, 78, 8], i % 2 ? moss : dark);
  }
  // Collar, pendant, pineapple head and carved facial relief.
  for (let i = -4; i <= 4; i++)
    round([i * 40, 652 - Math.abs(i) * 8, 100], [30, 14, 35], gold);
  add("diamond", [0, 605, 154], [34, 43, 12], gold);
  add("diamond", [0, 605, 168], [17, 23, 6], dark);
  box([0, 544, 150], [8, 22, 6], gold);
  sculpt([0, 780, 0], [120, 145, 105], gold, "pineapple");
  for (const side of [-1, 1]) {
    round([side * 42, 810, 100], [31, 8, 9], gold);
    box([side * 42, 795, 104], [23, 5, 5], dark);
    round([side * 65, 751, 94], [28, 24, 5], gold);
  }
  round([0, 780, 108], [12, 30, 12], gold);
  box([0, 728, 101], [34, 4, 5], dark);
  round([0, 707, 92], [40, 18, 9], gold);
  for (let i = 0; i < 11; i++) {
    const a = (i * Math.PI * 2) / 11;
    const height = i % 3 === 0 ? 190 : 135;
    add(
      "leaf",
      [Math.sin(a) * 55, 920 + height / 2 - 20, Math.cos(a) * 45],
      [28, height / 2, 24],
      i % 2 ? gold : moss,
      [0.55, a, 0],
    );
  }
  // Raised scepter: separate shaft sections, gripping hand, miniature pineapple.
  for (let i = 0; i < 18; i++)
    box([-290, 170 + i * 30, 165], [12, 15, 12], gold);
  round([-289, 540, 165], [32, 44, 30]);
  sculpt([-290, 755, 165], [45, 64, 45], gold, "pineapple");
  for (let i = 0; i < 7; i++)
    add("leaf", [-290, 838, 165], [14, 44, 12], gold, [
      0.5,
      (i * Math.PI * 2) / 7,
      0,
    ]);
  // Processional stairs, balustrades and boulders frame the 1.4 km complex.
  role = "stairs";
  for (let step = 0; step < 28; step++) {
    const z = 690 - step * 14,
      top = 6 + step * 6;
    for (let x = -2; x <= 2; x++) {
      const bed = ground(x * 52, z) - 2,
        tread = Math.max(top, bed + 8);
      box(
        [x * 52, (bed + tread) / 2, z],
        [26, (tread - bed) / 2, 7],
        stone,
        true,
      );
    }
    for (const side of [-1, 1])
      box(
        [side * 148, Math.max(top, ground(side * 130, z) + 6) + 10, z],
        [20, 10, 7],
        gold,
      );
  }
  for (let i = 0; i < 14; i++) {
    role = "rock";
    // Leave the stair approach open between the boulders.
    const a = Math.PI * 0.22 + (i * Math.PI * 1.56) / 13;
    const x = Math.sin(a) * 570,
      z = Math.cos(a) * 530;
    const h = 70 + hash(i, 877) * 95;
    add(
      "rock",
      [x, ground(x, z) + h * 0.65, z],
      [100 + hash(i, 878) * 50, h, 100],
      i % 3 ? stone : moss,
      [0, 0, 0],
      0,
      true,
    );
  }
  const parts = entities.slice(start);
  // Use the same contact graph as castles, with face relief supported by its host.
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i],
        b = parts[j];
      if (a.p.every((v, k) => Math.abs(v - b.p[k]) <= a.s[k] + b.s[k] + 0.2)) {
        a.supports.push(b.id);
        b.supports.push(a.id);
      }
    }
  site.assemblies = [site.id];
  return parts;
}
