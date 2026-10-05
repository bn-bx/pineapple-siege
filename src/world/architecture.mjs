// Existing castle and village modules adapted to seed-selected sites.
export function createArchitecture(layout, sample, hash) {
  const { sites, castles } = layout;
  const entities = [];
  function add(
    kind,
    x,
    y,
    z,
    sx,
    sy,
    sz,
    material,
    assembly = "",
    foundation = false,
  ) {
    const e = {
      id: entities.length,
      kind,
      p: [x, y, z],
      s: [sx, sy, sz],
      material,
      assembly,
      foundation,
      supports: [],
      variant: hash(Math.round(x * 7), Math.round(z * 9)),
    };
    entities.push(e);
    return e;
  }
  const banners = [],
    lights = [],
    homes = [];
  function buildCastle(c) {
    const begin = entities.length,
      bannerStart = banners.length,
      lightStart = lights.length;
    const grand = c.grand,
      fx = 0,
      fz = 0,
      floor = 0,
      towers = [];
    const HALF_X = c.halfX,
      HALF_Z = c.halfZ,
      SCALE_X = c.scaleX,
      SCALE_Z = c.scaleZ,
      SCALE_Y = c.scaleY;
    const CASTLE_X = HALF_X * SCALE_X,
      CASTLE_Z = HALF_Z * SCALE_Z;
    function wall(
      name,
      cx,
      cz,
      length,
      axis,
      height = 24,
      gate = false,
      base = floor,
    ) {
      const n = Math.ceil(length / 8),
        span = length / n,
        layers = Math.ceil(height / 5),
        dy = height / layers;
      for (let l = 0; l < layers; l++)
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) * span - length / 2;
          const cy = (l + 0.5) * dy;
          const opening = cy < 10 ? 8 : cy < 13 ? 5 : cy < 16 ? 2 : 0;
          if (gate && Math.abs(t) < opening) continue;
          add(
            "block",
            cx + (axis === 0 ? t : 0),
            base + (l + 0.5) * dy,
            cz + (axis === 1 ? t : 0),
            axis === 0 ? span / 2 : 2.4,
            dy / 2,
            axis === 1 ? span / 2 : 2.4,
            "sandstone",
            name,
            l === 0 && base === floor,
          );
        }
      for (let i = 0; i < n; i += 2) {
        const t = (i + 0.5) * span - length / 2;
        add(
          "block",
          cx + (axis === 0 ? t : 0),
          base + height + 1.4,
          cz + (axis === 1 ? t : 0),
          axis === 0 ? 1.65 : 2.6,
          1.4,
          axis === 1 ? 1.65 : 2.6,
          "sandstone",
          name,
        );
      }
      // Buttresses strengthen the silhouette without individual-brick physics.
      for (let i = 0; i < n; i += 4) {
        const t = (i + 0.5) * span - length / 2;
        if (gate && Math.abs(t) < 12) continue;
        for (let l = 0; l < 3; l++)
          add(
            "block",
            cx + (axis === 0 ? t : 3.1),
            floor + 3 + l * 6,
            cz + (axis === 1 ? t : 3.1),
            axis === 0 ? 1.7 : 3.8 - l * 0.45,
            3,
            axis === 1 ? 1.7 : 3.8 - l * 0.45,
            "sandstone",
            name,
            l === 0,
          );
      }
    }
    function tower(
      name,
      cx,
      cz,
      height = 50,
      width = 18,
      roof = false,
      landmark = true,
    ) {
      height +=
        Math.floor(
          hash(
            [...name].reduce((n, c) => n + c.charCodeAt(0), 0),
            707,
          ) * 4,
        ) * 5;
      if (landmark) towers.push([cx, floor, cz]);
      const cell = width / 3;
      for (let l = 0; l < Math.ceil(height / 5); l++)
        for (let x = 0; x < 3; x++)
          for (let z = 0; z < 3; z++) {
            if (x === 1 && z === 1) continue;
            if (l % 4 === 2 && x === 1 && z === 0) continue;
            add(
              "block",
              cx + (x - 1) * cell,
              floor + (l + 0.5) * 5,
              cz + (z - 1) * cell,
              cell / 2,
              2.5,
              cell / 2,
              "sandstone",
              name,
              l === 0,
            );
          }
      for (let y = 17; y < height - 7; y += 17) {
        for (const side of [-1, 1]) {
          add(
            "block",
            cx,
            floor + y,
            cz + side * (width / 2 - 0.15),
            1.25,
            3.3,
            0.45,
            "window",
            name,
          );
          add(
            "block",
            cx + side * (width / 2 - 0.15),
            floor + y,
            cz,
            0.45,
            3.3,
            1.25,
            "window",
            name,
          );
        }
      }
      let owner;
      for (let i = -1; i <= 1; i++)
        for (const side of [-1, 1]) {
          owner = add(
            "block",
            cx + i * cell,
            floor + Math.ceil(height / 5) * 5 + 1.5,
            cz + side * width * 0.43,
            cell * 0.32,
            1.5,
            2,
            "sandstone",
            name,
          );
          add(
            "block",
            cx + side * width * 0.43,
            floor + Math.ceil(height / 5) * 5 + 1.5,
            cz + i * cell,
            2,
            1.5,
            cell * 0.32,
            "sandstone",
            name,
          );
        }
      if (roof)
        add(
          "block",
          cx,
          floor + Math.ceil(height / 5) * 5 + 17,
          cz,
          width * 0.62,
          17,
          width * 0.62,
          "slate",
          name,
        );
      banners.push({
        owner: owner.id,
        p: [cx, floor + height - 8, cz - width / 2 - 0.25],
        s: [4, 10, 1],
      });
      return owner.id;
    }
    wall("front", fx, fz - HALF_Z, HALF_X * 2, 0, 24, true);
    wall("rear", fx, fz + HALF_Z, HALF_X * 2, 0);
    wall("west", fx - HALF_X, fz, HALF_Z * 2, 1);
    wall("east", fx + HALF_X, fz, HALF_Z * 2, 1);
    for (const a of [-1, 1])
      for (const b of [-1, 1])
        tower(
          `tower-${a}-${b}`,
          fx + a * HALF_X,
          fz + b * HALF_Z,
          b === 1 ? 65 : 60,
          20,
          b === 1,
        );
    for (const a of [-1, 1])
      tower(`gate-${a}`, fx + a * 20, fz - HALF_Z - 3, 65, 24, true);
    // Four flank towers and two rear towers complete the twelve-tower perimeter.
    if (grand)
      for (const side of [-1, 1]) {
        for (const along of [-1, 1])
          tower(
            `flank-${side}-${along}`,
            fx + side * HALF_X,
            fz + along * 45,
            58,
            18,
            true,
          );
        tower(`rear-${side}`, fx + side * 40, fz + HALF_Z, 70, 22, true);
      }
    if (grand) wall("middle-front", fx, fz - 78, 224, 0, 20, true);
    wall("inner-west", fx - 46, fz + 13, 104, 1, 18);
    wall("inner-east", fx + 46, fz + 13, 104, 1, 18);
    wall("inner-front", fx, fz - 39, 92, 0, 18, true);
    // Broad keep foundation and terrace; all levels connect to grounded supports.
    const keepZ = fz + 14 + hash(c.turn + Math.round(c.p[0]), 708) * 22;
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++)
        add(
          "block",
          fx + x * 10,
          floor + 3,
          keepZ + z * 10,
          5,
          3,
          5,
          "sandstone",
          "keep",
          true,
        );
    for (let l = 0; l < 18; l++)
      for (let x = 0; x < 7; x++)
        for (let z = 0; z < 6; z++) {
          if (x !== 0 && x !== 6 && z !== 0 && z !== 5) continue;
          if (
            l > 2 &&
            l % 4 === 2 &&
            (x === 2 || x === 4) &&
            (z === 0 || z === 5)
          )
            continue;
          add(
            "block",
            fx + (x - 3) * 6,
            floor + 8 + l * 4,
            keepZ + (z - 2.5) * 6,
            3,
            2,
            3,
            "sandstone",
            "keep",
          );
        }
    for (let y = 20; y < 77; y += 13)
      for (const x of [-13, 0, 13])
        add(
          "block",
          fx + x,
          floor + y,
          keepZ - 17.8,
          2,
          4,
          0.55,
          "window",
          "keep",
        );
    for (let i = -3; i <= 3; i++)
      for (const side of [-1, 1])
        add(
          "block",
          fx + i * 6,
          floor + 79,
          keepZ + side * 17,
          1.8,
          1.5,
          2.4,
          "sandstone",
          "keep",
        );
    add("block", fx, floor + 96, keepZ, 22, 17, 19, "slate", "keep");
    // Uneven palace towers and long slate silhouettes echo the reference castle.
    if (grand) tower("great-spire", fx - 34, keepZ + 36, 126, 20, true, false);
    if (grand) tower("chapel-spire", fx + 70, fz + 77, 101, 17, true, false);
    if (grand) tower("west-spire", fx - 83, fz + 70, 91, 16, true, false);
    if (grand) tower("east-spire", fx + 88, fz - 9, 82, 15, true, false);
    for (let i = 0; i < 6; i++)
      add(
        "block",
        fx,
        floor + 0.5 + i * 0.5,
        fz - 9 + i * 2,
        10,
        0.5 + i * 0.5,
        1,
        "sandstone",
        "keep",
        true,
      );
    for (const x of [-1, 1])
      for (const z of grand ? [-1, 1] : [1]) {
        if (grand && z === -1 && hash(x + 5, 709) < 0.32) continue;
        const cx = fx + x * (56 + hash(c.turn, 710) * 12),
          cz = fz + z * 37,
          name = `hall-${x}-${z}`;
        wall(name, cx, cz - 12, 20, 0, 12);
        wall(name, cx, cz + 12, 20, 0, 12);
        wall(name, cx - 10, cz, 24, 1, 12);
        wall(name, cx + 10, cz, 24, 1, 12);
        add("block", cx, floor + 21, cz, 12, 10, 15, "slate", name);
      }
    // A broad rear palace closes the upper court; roofs are independently breakable.
    if (grand)
      for (const side of [-1, 1]) {
        const name = `palace-${side}`,
          cx = fx + side * 48,
          cz = fz + 102;
        wall(name, cx, cz - 15, 62, 0, 26);
        wall(name, cx, cz + 15, 62, 0, 26);
        wall(name, cx - 31, cz, 30, 1, 26);
        wall(name, cx + 31, cz, 30, 1, 26);
        for (let part = -1; part <= 1; part++)
          add(
            "block",
            cx + part * 21,
            floor + 37,
            cz,
            11,
            11,
            18,
            "slate",
            name,
          );
      }
    for (const p of [
      [fx - 10, 14, fz - HALF_Z - 4],
      [fx + 10, 14, fz - HALF_Z - 4],
      [fx - 25, 16, fz + 5],
      [fx + 25, 16, fz + 5],
    ]) {
      const owner = entities
        .filter((e) => e.material === "sandstone")
        .reduce((a, b) =>
          Math.hypot(...a.p.map((v, k) => v - p[k])) <
          Math.hypot(...b.p.map((v, k) => v - p[k]))
            ? a
            : b,
        );
      lights.push({ owner: owner.id, p });
    }
    // Scale the authored castle modules before adjacency generation. More grandeur
    // comes from broader modules and added architecture, rather than tiny brick bodies.
    const transformCastle = (p) => [
      fx + (p[0] - fx) * SCALE_X,
      floor + (p[1] - floor) * SCALE_Y,
      fz + (p[2] - fz) * SCALE_Z,
    ];
    for (const e of entities.slice(begin)) {
      e.p = transformCastle(e.p);
      e.s = [e.s[0] * SCALE_X, e.s[1] * SCALE_Y, e.s[2] * SCALE_Z];
    }
    for (const b of banners.slice(bannerStart)) {
      b.p = transformCastle(b.p);
      b.s = [b.s[0] * SCALE_X, b.s[1] * SCALE_Y, b.s[2]];
    }
    for (const l of lights.slice(lightStart)) l.p = transformCastle(l.p);

    const turn = c.turn,
      mirror = hash(Math.round(c.p[0]), 711) > 0.5 ? -1 : 1;
    const rotate = ([x, y, z]) =>
      turn === 0
        ? [x, y, z]
        : turn === 1
          ? [-z, y, x]
          : turn === 2
            ? [-x, y, -z]
            : [z, y, -x];
    const place = (p) => {
      const q = rotate([p[0] * mirror, p[1], p[2]]);
      return [c.p[0] + q[0], c.p[1] + q[1], c.p[2] + q[2]];
    };
    for (const e of entities.slice(begin)) {
      e.p = place(e.p);
      if (turn % 2) [e.s[0], e.s[2]] = [e.s[2], e.s[0]];
      e.assembly = `${c.id}:${e.assembly}`;
    }
    for (const b of banners.slice(bannerStart)) {
      b.p = place(b.p);
      b.yaw = (turn * Math.PI) / 2;
    }
    for (const l of lights.slice(lightStart)) l.p = place(l.p);
    c.assemblies = [...new Set(entities.slice(begin).map((e) => e.assembly))];
    c.landmarks = {
      gate: place([0, 0, -CASTLE_Z]),
      keep: place(transformCastle([0, 0, keepZ])),
      towers: towers.map((p) => place(transformCastle(p))),
    };
  }
  for (const c of castles) buildCastle(c);
  const castleCount = entities.length;
  function bridge(s) {
    const [x, , z] = s.p,
      axis = s.axis ?? 0,
      w = s.span ?? 80;
    let deck = s.deck ?? s.waterLevel + 3;
    if (s.deck === undefined)
      for (let t = -w / 2; t <= w / 2; t += 4)
        deck = Math.max(
          deck,
          sample(x + (axis === 0 ? t : 0), z + (axis === 1 ? t : 0)) + 1.5,
        );
    const n = Math.ceil(w / 6),
      step = w / n;
    for (let i = 0; i <= n; i++) {
      const t = -w / 2 + i * step,
        px = x + (axis === 0 ? t : 0),
        pz = z + (axis === 1 ? t : 0);
      add(
        "block",
        px,
        deck,
        pz,
        axis === 0 ? step / 2 + 0.1 : 5,
        1,
        axis === 1 ? step / 2 + 0.1 : 5,
        "wood",
        s.id,
      );
      for (const side of [-1, 1]) {
        const qx = px + (axis === 1 ? side * 4.5 : 0),
          qz = pz + (axis === 0 ? side * 4.5 : 0);
        add(
          "block",
          qx,
          deck + 2,
          qz,
          axis === 0 ? step / 2 + 0.1 : 0.4,
          1,
          axis === 1 ? step / 2 + 0.1 : 0.4,
          "wood",
          s.id,
        );
        if (i % 3 === 0 || i === n) {
          const bed = sample(qx, qz);
          add(
            "block",
            qx,
            (deck + bed) / 2,
            qz,
            1,
            Math.max(0.5, (deck - bed) / 2),
            1,
            "stone",
            s.id,
            true,
          );
        }
      }
    }
    s.deck = deck;
  }
  function building(name, x, z, w = 14, d = 18, h = 13, material = "plaster") {
    if (name.includes("-house")) homes.push({ assembly: name, x, z, w, d });
    const y = sample(x, z);
    // Interlocking wall courses with a clear doorway; independently breakable roof sections.
    for (let level = 0; level < 3; level++) {
      const sy = h / 6,
        cy = y + ((level + 0.5) * h) / 3;
      for (const side of [-1, 1]) {
        add(
          "block",
          x + (side * w) / 2,
          cy,
          z,
          1,
          sy,
          d / 2,
          "wood",
          name,
          level === 0,
        );
        for (const sign of [-1, 1])
          add(
            "block",
            x + sign * w * 0.31,
            cy,
            z + (side * d) / 2,
            w * 0.19,
            sy,
            1,
            material,
            name,
            level === 0,
          );
        if (level > 0 || side === 1)
          add(
            "block",
            x,
            cy,
            z + (side * d) / 2,
            w * 0.12,
            sy,
            1,
            material,
            name,
            level === 0,
          );
      }
    }
    for (const side of [-1, 1])
      add(
        "block",
        x,
        y + h + 3,
        z + side * d * 0.25,
        w * 0.65,
        4,
        d * 0.25 + 1,
        "roof",
        name,
      );
    for (const side of [-1, 1])
      add(
        "block",
        x + side * w * 0.4,
        y + h * 0.5,
        z,
        w * 0.025,
        h * 0.5,
        d * 0.52,
        "wood",
        name,
        true,
      );
  }
  function post(name, x, z, h = 25, w = 8) {
    const y = sample(x, z);
    for (let l = 0; l < 5; l++)
      add(
        "block",
        x,
        y + ((l + 0.5) * h) / 5,
        z,
        w / 2,
        h / 10,
        w / 2,
        "stone",
        name,
        l === 0,
      );
    add("block", x, y + h + 3, z, w * 0.8, 4, w * 0.8, "roof", name);
    return y;
  }
  for (const s of sites) {
    const [x, y, z] = s.p,
      begin = entities.length;
    if (s.kind === "hamlet")
      for (let i = 0; i < 5; i++)
        building(
          `${s.id}-house-${i}`,
          x + ((i % 3) - 1) * 33,
          z + (Math.floor(i / 3) - 0.5) * 40,
          14 + (i % 2) * 4,
          20,
          12 + (i % 3) * 3,
        );
    if (s.kind === "farm") {
      building(`${s.id}-barn`, x - 18, z, 23, 32, 16, "wood");
      building(`${s.id}-house`, x + 24, z + 12, 13, 17, 11);
      for (let i = -3; i <= 3; i++)
        for (const side of [-1, 1]) {
          const px = x + i * 12,
            pz = z + side * 40,
            py = sample(px, pz);
          add(
            "block",
            px,
            py + 1.4,
            pz,
            0.3,
            1.4,
            0.3,
            "wood",
            `${s.id}-fence-${side}`,
            true,
          );
          if (i < 3)
            add(
              "block",
              px + 6,
              py + 1.8,
              pz,
              6,
              0.2,
              0.25,
              "wood",
              `${s.id}-fence-${side}`,
            );
        }
      for (let i = 0; i < 3; i++) {
        const px = x + i * 7 - 8,
          pz = z - 27,
          py = sample(px, pz),
          name = `${s.id}-cart-${i}`;
        add("block", px, py + 1, pz, 2.4, 1, 1.6, "wood", name, true);
        add("block", px, py + 3, pz, 2.7, 1.1, 1.8, "earth", name);
      }
    }
    if (s.kind === "windmill") {
      const py = post(s.id, x, z, 30, 10);
      add("block", x, py + 23, z - 6, 1.8, 2, 2, "wood", s.id);
      for (const a of [-1, 1]) {
        add("block", x + a * 9, py + 23, z - 7, 8, 1.6, 0.5, "wood", s.id);
        add("block", x, py + 23 + a * 9, z - 7, 1.6, 8, 0.5, "wood", s.id);
      }
    }
    if (s.kind === "watchtower") {
      post(s.id, x, z, 42, 12);
      for (const a of [-1, 1])
        add("block", x + a * 7, y + 36, z, 1, 4, 7, "wood", s.id);
    }
    if (s.kind === "watermill") {
      building(`${s.id}-mill`, x, z, 18, 22, 20, "stone");
      building(`${s.id}-warehouse`, x + 27, z + 8, 17, 26, 13, "wood");
      const wheel = `${s.id}-mill`;
      // Segmented wheel joined to the wall by its axle; every paddle is destructible.
      add("block", x - 12, y + 8, z, 4, 1, 1, "wood", wheel);
      add("block", x - 15, y + 8, z, 1, 7, 0.6, "wood", wheel);
      add("block", x - 15, y + 8, z, 1, 0.6, 7, "wood", wheel);
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8;
        add(
          "block",
          x - 15,
          y + 8 + Math.sin(a) * 7,
          z + Math.cos(a) * 7,
          1.6,
          1.6,
          1.6,
          "wood",
          wheel,
        );
      }
      for (let i = 0; i < 7; i++) {
        const px = x - 17 - i * 3;
        add(
          "block",
          px,
          y + 1,
          z + 18,
          1.6,
          0.6,
          4,
          "wood",
          `${s.id}-dock`,
          i === 0,
        );
        add("block", px, y + 3, z + 21, 0.2, 2, 0.2, "wood", `${s.id}-dock`);
      }
    }
    if (s.kind === "crossing" || s.kind === "bridge") bridge(s);
    if (s.kind === "logging") {
      building(`${s.id}-shed`, x + 15, z, 15, 18, 10, "wood");
      for (let row = 0; row < 3; row++)
        for (let l = 0; l < 3; l++)
          add(
            "block",
            x - 15,
            y + 1 + l * 2,
            z - 15 + row * 7,
            12,
            1,
            1,
            "wood",
            `${s.id}-stack-${row}`,
            l === 0,
          );
    }
    if (s.kind === "quarry") {
      for (let i = 0; i < 24; i++) {
        const px = x - 32 + (i % 6) * 12,
          pz = z - 25 + Math.floor(i / 6) * 14,
          py = sample(px, pz);
        add(
          "rock",
          px,
          py + 4 + (i % 3) * 2,
          pz,
          5,
          4 + (i % 3) * 2,
          5,
          "rock",
          `${s.id}-rock-${i}`,
          true,
        );
      }
      building(`${s.id}-shed`, x + 28, z + 30, 15, 12, 10, "wood");
      for (let i = 0; i < 5; i++) {
        add(
          "block",
          x - 28 + i * 12,
          y + 10,
          z + 40,
          0.6,
          10,
          0.6,
          "wood",
          `${s.id}-scaffold`,
          true,
        );
        add(
          "block",
          x - 22 + i * 12,
          y + 19,
          z + 40,
          6.5,
          1,
          3,
          "wood",
          `${s.id}-scaffold`,
        );
      }
    }
    if (s.kind === "harbor") {
      building(`${s.id}-warehouse`, x, z - 12, 25, 24, 15, "wood");
      building(`${s.id}-house-1`, x - 30, z - 12, 14, 18, 12);
      building(`${s.id}-house-2`, x + 30, z - 12, 14, 18, 12);
      const axis = s.dockAxis ?? 1,
        sign = s.dockSign ?? 1;
      for (let i = 0; i < 28; i++) {
        const px = x + (axis === 0 ? sign * i * 4 : 0),
          pz = z + (axis === 1 ? sign * i * 4 : 0),
          deck = y + 1;
        add(
          "block",
          px,
          deck,
          pz,
          axis === 0 ? 2.1 : 5,
          0.6,
          axis === 1 ? 2.1 : 5,
          "wood",
          `${s.id}-dock`,
          i === 0,
        );
        for (const side of [-1, 1]) {
          const qx = px + (axis === 1 ? side * 4 : 0),
            qz = pz + (axis === 0 ? side * 4 : 0),
            bed = sample(qx, qz);
          add(
            "block",
            qx,
            (deck + bed) / 2,
            qz,
            0.5,
            Math.max(0.5, (deck - bed) / 2),
            0.5,
            "wood",
            `${s.id}-dock`,
            true,
          );
        }
      }
    }
    if (s.kind === "lighthouse") {
      post(s.id, x, z, 48, 12);
      const owner = add("block", x, y + 50, z, 4, 2, 4, "window", s.id);
      lights.push({ owner: owner.id, p: [x, y + 52, z] });
    }
    if (s.kind === "coastal-ruin") {
      for (let side of [-1, 1])
        for (let layer = 0; layer < 3; layer++)
          add(
            "block",
            x + side * 8,
            y + 3 + layer * 6,
            z,
            3,
            3,
            10,
            "stone",
            s.id,
            layer === 0,
          );
      for (let i = 0; i < 5; i++)
        add(
          "block",
          x - 8 + i * 4,
          y + 3 + (i % 2) * 6,
          z + 8,
          2,
          3,
          3,
          "stone",
          s.id,
          i % 2 === 0,
        );
    }
    if (s.kind === "watermill" && s.turn) {
      for (const e of entities.slice(begin)) {
        const dx = e.p[0] - x,
          dz = e.p[2] - z;
        e.p[0] = x + (s.turn === 1 ? -dz : s.turn === 2 ? -dx : dz);
        e.p[2] = z + (s.turn === 1 ? dx : s.turn === 2 ? -dz : -dx);
        if (s.turn % 2) [e.s[0], e.s[2]] = [e.s[2], e.s[0]];
      }
    }
    s.assemblies = [...new Set(entities.slice(begin).map((e) => e.assembly))];
  }

  if (entities.length > 16000)
    throw Error(`Structure budget exceeded: ${entities.length}`);
  const groups = new Map();
  for (const e of entities) {
    let g = groups.get(e.assembly);
    if (!g) groups.set(e.assembly, (g = []));
    g.push(e);
  }
  for (const group of groups.values())
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i],
          b = group[j];
        if (
          a.p.every((v, k) => Math.abs(v - b.p[k]) - a.s[k] - b.s[k] < 0.16)
        ) {
          a.supports.push(b.id);
          b.supports.push(a.id);
        }
      }
  return {
    entities,
    banners,
    lights,
    homes,
    castleCount,
    structureCount: entities.length,
  };
}
