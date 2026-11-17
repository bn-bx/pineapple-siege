import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { CONFIG, TRUCK } from "../src/config";
import type { Entity, InputState, WorldData } from "../src/types";

const world = JSON.parse(
  readFileSync("public/world.json", "utf8"),
) as WorldData;
beforeAll(initializePhysics);

const idle: InputState = {
  x: 0,
  y: 0,
  throttle: 0,
  bank: 0,
  boost: false,
  fire: false,
};
const block = (id: number, x: number, z: number, y = 40): Entity => ({
  id,
  kind: "block",
  p: [x, y, z],
  s: [20, 30, 20],
  material: "stone",
  assembly: "",
  foundation: true,
  supports: [],
  variant: 0,
});
const tree = (id: number, x: number, z: number): Entity => ({
  id,
  kind: "tree",
  p: [x, 22, z],
  s: [3, 12, 3],
  material: "wood",
  assembly: "",
  foundation: true,
  supports: [],
  variant: 0,
});
const GROUND = 10;
const REST = GROUND + TRUCK.rideHeight;

/** Ground at 10 m unless `shape` says otherwise. */
function makeSim(
  entities: Entity[] = [],
  shape: (x: number, z: number) => number = () => GROUND,
) {
  const heights = new Float32Array(CONFIG.grid * CONFIG.grid);
  for (let z = 0; z < CONFIG.grid; z++)
    for (let x = 0; x < CONFIG.grid; x++)
      heights[z * CONFIG.grid + x] = shape(
        x * CONFIG.spacing,
        z * CONFIG.spacing,
      );
  const sim = new Simulation(
    { ...world, entities, civilians: [], rivers: [], portal: undefined },
    heights,
    () => {},
    undefined,
    true,
  );
  sim.setMonsterCount(0);
  return sim;
}
const drive = (sim: Simulation, input: Partial<InputState>, steps: number) => {
  sim.input = { ...idle, ...input };
  for (let i = 0; i < steps && sim.plane.crashed <= 0; i++) sim.step();
};
/** Swap to the truck and wait for the parachute to land it. */
function land(sim: Simulation, at: [number, number] = [3000, 3000]) {
  sim.plane.p = [at[0], 300, at[1]];
  expect(sim.setVehicleMode("ground")).toBe(true);
  drive(sim, {}, 900);
  expect(sim.plane.chute).toBe(false);
  // Let the shield lapse so tests see ordinary driving.
  sim.plane.shield = 0;
}

it("parachutes the truck down from the aircraft's altitude", () => {
  const sim = makeSim();
  try {
    sim.plane.p = [3000, 300, 3000];
    expect(sim.setVehicleMode("ground")).toBe(true);
    expect(sim.plane.mode).toBe("ground");
    expect(sim.plane.chute).toBe(true);
    expect(sim.plane.p[1]).toBe(300);
    let steps = 0;
    sim.input = idle;
    while (sim.plane.chute && steps < 900) {
      sim.step();
      steps++;
    }
    expect(sim.plane.crashed).toBe(0);
    expect(sim.plane.chute).toBe(false);
    expect(sim.plane.p[1]).toBeCloseTo(REST, 3);
    expect(steps / 60).toBeGreaterThan(1.5);
    expect(steps / 60).toBeLessThan(10);
  } finally {
    sim.dispose();
  }
});

it("drifts down beside a building rather than onto it", () => {
  const sim = makeSim([block(0, 3000, 3000)]);
  try {
    land(sim);
    const [x, , z] = sim.plane.p;
    expect(Math.abs(x - 3000) > 20 || Math.abs(z - 3000) > 20).toBe(true);
    expect(sim.plane.crashed).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("accelerates to top speed and stays on flat ground", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    drive(sim, { throttle: 1 }, 600);
    expect(sim.plane.crashed).toBe(0);
    expect(sim.plane.speed).toBeCloseTo(TRUCK.maxSpeed, 0);
    expect(sim.plane.p[1]).toBeCloseTo(REST, 1);
    drive(sim, { throttle: 1, boost: true }, 600);
    expect(sim.plane.speed).toBeCloseTo(TRUCK.boostSpeed, 0);
  } finally {
    sim.dispose();
  }
});

it("steers right with D, pivots from a standstill and reverses with S", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    // A pivot needs the pedal: D alone only turns the front wheels.
    drive(sim, { bank: 1 }, 30);
    expect(Math.abs(sim.plane.yaw)).toBeLessThan(0.01);
    const start = [...sim.plane.p];
    drive(sim, { throttle: 1, bank: 1 }, 20);
    expect(sim.plane.yaw).toBeLessThan(-0.1);
    expect(Math.hypot(sim.plane.p[0] - start[0], sim.plane.p[2] - start[2]))
      .toBeLessThan(3);
    drive(sim, { throttle: 1 }, 120);
    const before = sim.plane.yaw;
    drive(sim, { throttle: 1, bank: 1 }, 30);
    // Yaw falls when turning right, as it does in flight.
    expect(sim.plane.yaw).toBeLessThan(before);
    drive(sim, { throttle: -1 }, 600);
    const v = sim.plane.v;
    expect(
      v[0] * Math.sin(sim.plane.yaw) + v[2] * Math.cos(sim.plane.yaw),
    ).toBeLessThan(0);
  } finally {
    sim.dispose();
  }
});

it("bumps off a building at low speed and wrecks at high speed", () => {
  const slow = makeSim([block(0, 3000, 3060)]);
  try {
    land(slow, [3000, 3000]);
    slow.plane.yaw = 0;
    drive(slow, { throttle: 1 }, 240);
    expect(slow.plane.crashed).toBe(0);
    expect(slow.plane.p[2]).toBeLessThan(3060 - 20);
    // Touching the wall never pins it: it can back away.
    const touching = slow.plane.p[2];
    drive(slow, { throttle: -1 }, 120);
    expect(slow.plane.p[2]).toBeLessThan(touching - 5);
  } finally {
    slow.dispose();
  }
  const fast = makeSim([block(0, 3000, 3600)]);
  try {
    land(fast, [3000, 3000]);
    fast.plane.yaw = 0;
    drive(fast, { throttle: 1, boost: true }, 1200);
    expect(fast.plane.crashed).toBeGreaterThan(0);
    expect(fast.plane.falling).toBe(false);
  } finally {
    fast.dispose();
  }
});

it("climbs steep hills and flattens trees", () => {
  // A 30 degree ramp rising north of z = 3100, then a plateau.
  const hill = (_x: number, z: number) =>
    GROUND + Math.min(80, Math.max(0, z - 3100) * Math.tan(Math.PI / 6));
  const sim = makeSim([tree(0, 3000, 3060)], hill);
  try {
    land(sim);
    sim.plane.yaw = 0;
    drive(sim, { throttle: 1 }, 900);
    expect(sim.plane.crashed).toBe(0);
    expect(sim["removed"].has(0)).toBe(true);
    expect(sim.plane.p[2]).toBeGreaterThan(3300);
  } finally {
    sim.dispose();
  }
});

it("hops free when pinned with the throttle held", () => {
  // A sheer 40 m cliff face it cannot climb.
  const cliff = (_x: number, z: number) => (z > 3040 ? GROUND + 40 : GROUND);
  const sim = makeSim([], cliff);
  try {
    land(sim);
    sim.plane.yaw = 0;
    let hopped = false;
    sim.input = { ...idle, throttle: 1 };
    for (let i = 0; i < 600; i++) {
      sim.step();
      if (sim.plane.v[1] > 5) hopped = true;
    }
    expect(hopped).toBe(true);
    expect(sim.plane.crashed).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("floats across deep water instead of wrecking", () => {
  const sim = makeSim([], (x) => (x < 2000 ? -12 : GROUND));
  try {
    land(sim, [2300, 3000]);
    // Face west and drive out to sea.
    sim.plane.yaw = -Math.PI / 2;
    drive(sim, { throttle: 1 }, 1200);
    expect(sim.plane.crashed).toBe(0);
    expect(sim.plane.wading).toBe(true);
    expect(sim.plane.p[0]).toBeLessThan(1900);
    // Riding on the surface, tyres half under.
    expect(sim.plane.p[1]).toBeCloseTo(-TRUCK.draft + TRUCK.rideHeight, 1);
    // Afloat it's held to half speed, but the jets still skim it along.
    expect(sim.plane.speed).toBeCloseTo(TRUCK.maxSpeed * TRUCK.waterSpeed, 0);
    drive(sim, { boost: true }, 300);
    expect(sim.plane.speed).toBeGreaterThan(100);
    expect(sim.plane.crashed).toBe(0);
    // Swapping over the sea parachutes onto the water.
    sim.setVehicleMode("air");
    drive(sim, {}, 120);
    sim.plane.p = [1000, 300, 3000];
    expect(sim.setVehicleMode("ground")).toBe(true);
    drive(sim, {}, 900);
    expect(sim.plane.chute).toBe(false);
    expect(sim.plane.crashed).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("respawns clear of the fire it died in and survives", () => {
  const sim = makeSim();
  try {
    const spawn = sim["world"].spawn;
    land(sim, [spawn[0], spawn[2]]);
    sim.fires.restore({
      patches: [
        {
          id: 1,
          p: [spawn[0], GROUND, spawn[2]],
          radius: 25,
          height: 30,
          age: 0,
          seed: 1,
        },
      ],
      clock: 0,
      creatureClock: 0,
      exposures: [],
    });
    sim["crash"]([...sim.plane.p], false);
    expect(sim.plane.crashed).toBeGreaterThan(0);
    sim.respawn();
    expect(sim.plane.mode).toBe("ground");
    expect(sim.plane.crashed).toBe(0);
    expect(
      Math.hypot(sim.plane.p[0] - spawn[0], sim.plane.p[2] - spawn[2]),
    ).toBeGreaterThan(25);
    drive(sim, {}, 240);
    expect(sim.plane.crashed).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("fires every weapon from the ground", () => {
  const sim = makeSim();
  try {
    land(sim);
    for (const weapon of ["cannon", "nuke"] as const) {
      sim.weapon = weapon;
      sim.cooldowns[weapon] = 0;
      drive(sim, { fire: true }, 1);
      const shot = sim.projectiles.at(-1)!;
      expect(shot.weapon).toBe(weapon);
      // Shots leave above the ground, not beneath the truck.
      expect(shot.p[1]).toBeGreaterThan(REST);
    }
    sim.weapon = "gravityBomb";
    sim.cooldowns.gravityBomb = 0;
    drive(sim, { fire: true }, 1);
    expect(sim.gravityBombs.bombs.length).toBe(1);
    expect(sim.gravityBombs.bombs[0].p[1]).toBeGreaterThan(GROUND);
  } finally {
    sim.dispose();
  }
});

it("rockets back into the air and respawns in the current vehicle", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.respawn();
    expect(sim.plane.mode).toBe("ground");
    expect(sim.plane.p[1]).toBeCloseTo(
      sim["terrain"].sample(sim.plane.p[0], sim.plane.p[2]) +
        TRUCK.rideHeight,
      3,
    );
    expect(sim.setVehicleMode("air")).toBe(true);
    expect(sim.plane.mode).toBe("air");
    expect(sim.plane.launch).toBeGreaterThan(0);
    const start = sim.plane.p[1];
    // Pushing the nose down is ignored during the rocket climb.
    drive(sim, { y: -1 }, 50);
    expect(sim.plane.crashed).toBe(0);
    expect(sim.plane.p[1]).toBeGreaterThan(start + 20);
  } finally {
    sim.dispose();
  }
});

it("aims the turret with the mouse without steering the truck", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    sim.weapon = "cannon";
    sim.cooldowns.cannon = 0;
    // Aim 90 degrees right and a little up while driving straight.
    drive(sim, { throttle: 1, aimYaw: Math.PI / 2, aimPitch: 0.2, fire: true }, 60);
    expect(sim.plane.yaw).toBeCloseTo(0, 6);
    expect(sim.plane.aimYaw).toBeCloseTo(-Math.PI / 2, 6);
    const shot = sim.projectiles.find((s) => s.weapon === "cannon")!;
    // Yaw falls to the right, so a right aim fires toward -X.
    expect(shot.v[0]).toBeLessThan(-Math.abs(shot.v[2]));
    expect(shot.v[1]).toBeGreaterThan(0);
  } finally {
    sim.dispose();
  }
});

it("eases the steering in and turns wider at speed", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    // One tick of D barely turns: the wheel ramps toward full lock.
    drive(sim, { bank: 1, throttle: 1 }, 1);
    const first = -sim.plane.yaw;
    drive(sim, { bank: 1, throttle: 1 }, 30);
    expect(first).toBeLessThan(0.01);
    // At top speed full lock still turns briskly, on a wide, stable arc.
    drive(sim, { throttle: 1 }, 600);
    const before = sim.plane.yaw;
    drive(sim, { throttle: 1, bank: 1 }, 120);
    const yawRate = Math.abs(sim.plane.yaw - before) / 2;
    expect(yawRate).toBeGreaterThan(0.4);
    expect(sim.plane.speed / yawRate).toBeGreaterThan(40);
    expect(sim.plane.crashed).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("lands every weapon on the crosshair point, even while moving", () => {
  const sim = makeSim([block(0, 3200, 3600)]);
  try {
    land(sim);
    sim.plane.yaw = 0;
    drive(sim, { throttle: 1 }, 120);
    expect(sim.plane.speed).toBeGreaterThan(20);
    // A chase camera behind and above, looking at the block's face.
    const camera: [number, number, number] = [
      sim.plane.p[0],
      sim.plane.p[1] + 17,
      sim.plane.p[2] - 36,
    ];
    const face: [number, number, number] = [3200, 40, 3600 - 20];
    const dir = face.map((v, i) => v - camera[i]) as [number, number, number];
    sim.input = { ...idle, throttle: 1, aimFrom: camera, aimDir: dir };
    const target = sim["crosshairTarget"]()!;
    sim["groundTarget"] = target;
    // The camera ray stops on the block's near face.
    expect(target[2]).toBeCloseTo(3580, 0);
    const gravity = {
      cannon: 5,
      nuke: 18,
      gravityBomb: CONFIG.debrisGravity,
    } as const;
    for (const weapon of ["cannon", "nuke", "gravityBomb"] as const) {
      const shot = sim.groundLaunch(weapon);
      let p = [...shot.p],
        v = [...shot.v],
        closest = Infinity;
      for (let t = 0; t < 30; t += 1 / 240) {
        closest = Math.min(
          closest,
          Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]),
        );
        p = p.map((x, i) => x + v[i] / 240);
        v[1] -= gravity[weapon] / 240;
      }
      expect(closest, weapon).toBeLessThan(1.5);
    }
  } finally {
    sim.dispose();
  }
});

it("jet-boosts to super speed with Shift, even from a standstill", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    drive(sim, { boost: true }, 60);
    expect(sim.plane.boosting).toBe(true);
    expect(sim.plane.speed).toBeGreaterThan(40);
    drive(sim, { boost: true }, 240);
    expect(sim.plane.speed).toBeCloseTo(TRUCK.boostSpeed, 0);
    // Letting go fades the speed rather than slamming to a stop.
    drive(sim, { throttle: 1 }, 30);
    expect(sim.plane.boosting).toBe(false);
    expect(sim.plane.speed).toBeGreaterThan(TRUCK.boostSpeed - 15);
    expect(sim.plane.crashed).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("lets the mouse look around even while the crosshair is on something", () => {
  const sim = makeSim([block(0, 3000, 3300)]);
  try {
    land(sim);
    sim.plane.yaw = 0;
    // A camera ray pinned on the block straight ahead...
    const camera: [number, number, number] = [3000, REST + 17, 2964];
    const ahead: [number, number, number] = [0, -0.05, 1];
    for (const look of [0, 0.8, 1.6]) {
      // ...must not override where the mouse is turning the view.
      sim.input = { ...idle, aimYaw: look, aimFrom: camera, aimDir: ahead };
      for (let i = 0; i < 8; i++) sim.step();
      expect(sim.plane.lookYaw).toBeCloseTo(sim.plane.yaw - look, 6);
    }
  } finally {
    sim.dispose();
  }
});

it("steers briskly in mid-air and survives any landing", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    // Launch it 250 m up, falling fast, at full boost speed.
    drive(sim, { boost: true }, 240);
    sim.plane.p[1] = REST + 250;
    sim.plane.v[1] = -20;
    const before = sim.plane.yaw;
    drive(sim, { bank: 1, boost: true }, 30);
    // Half a second of full lock in the air turns a controlled ~0.3 rad,
    // the same at 130 m/s as at a crawl.
    const turned = before - sim.plane.yaw;
    expect(turned).toBeGreaterThan(0.2);
    expect(turned).toBeLessThan(0.5);
    drive(sim, {}, 900);
    expect(sim.plane.crashed).toBe(0);
    expect(sim.plane.p[1]).toBeCloseTo(REST, 1);
  } finally {
    sim.dispose();
  }
});

it("knocks a tree down when only its canopy is brushed, even slowly", () => {
  // Broadleaf crown 10 m wide each side; trunk 12 m to the side of the path.
  const broadleaf: Entity = {
    ...tree(0, 3012, 3030),
    p: [3012, GROUND + 12, 3030],
    s: [10, 12, 10],
  };
  const sim = makeSim([broadleaf]);
  try {
    land(sim);
    sim.plane.yaw = 0;
    drive(sim, { throttle: 1 }, 150);
    expect(sim.plane.speed).toBeLessThan(TRUCK.maxSpeed);
    expect(sim["removed"].has(0)).toBe(true);
    expect(sim.plane.crashed).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("ramps off a rubble pile into the air", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    // A 4 m pile of wreckage straight ahead.
    sim["insertRuin"]({
      id: 900001,
      p: [3000, GROUND + 2, 3260],
      q: [0, 0, 0, 1],
      s: [6, 2, 6],
      material: "stone",
      kind: "chunk",
      source: -1,
      pile: true,
    });
    let peak = 0;
    sim.input = { ...idle, throttle: 1, boost: true };
    for (let i = 0; i < 360 && sim.plane.crashed <= 0; i++) {
      sim.step();
      const clearance =
        sim.plane.p[1] -
        TRUCK.rideHeight -
        sim["terrain"].sample(sim.plane.p[0], sim.plane.p[2]);
      peak = Math.max(peak, clearance);
    }
    expect(sim.plane.crashed).toBe(0);
    // Driving straight through would leave it on the ground; the pile
    // throws it well above its own 4 m height.
    expect(peak).toBeGreaterThan(10);
  } finally {
    sim.dispose();
  }
});

it("stays glued to rolling ground instead of floating over every crest", () => {
  // Gentle 4 m swells every 120 m along the drive path.
  const rolling = (_x: number, z: number) =>
    GROUND + 4 * Math.sin((z - 3000) * ((Math.PI * 2) / 120));
  const sim = makeSim([], rolling);
  try {
    land(sim);
    sim.plane.yaw = 0;
    sim.input = { ...idle, throttle: 1 };
    let worst = 0;
    for (let i = 0; i < 900; i++) {
      sim.step();
      const floor = rolling(sim.plane.p[0], sim.plane.p[2]);
      worst = Math.max(worst, sim.plane.p[1] - TRUCK.rideHeight - floor);
    }
    expect(sim.plane.crashed).toBe(0);
    expect(sim.plane.speed).toBeCloseTo(TRUCK.maxSpeed, 0);
    expect(worst).toBeLessThan(0.5);
  } finally {
    sim.dispose();
  }
});

it("never floats on river water hanging above a dip", () => {
  // The real island's rivers over flat ground far below most of them.
  const sim = new Simulation(
    { ...world, entities: [], civilians: [], portal: undefined },
    new Float32Array(CONFIG.grid * CONFIG.grid).fill(GROUND),
    () => {},
    undefined,
    true,
  );
  try {
    const terrain = sim["terrain"];
    expect(terrain.rivers.riverCells.size).toBeGreaterThan(1000);
    let worst = 0,
      raw = 0;
    for (const [i, level] of terrain.rivers.riverCells) {
      const x = (i % CONFIG.grid) * CONFIG.spacing,
        z = Math.floor(i / CONFIG.grid) * CONFIG.spacing;
      raw = Math.max(raw, level - GROUND);
      const surface = terrain.surfaceHeight(x, z);
      if (surface !== undefined && !terrain.rivers.lakeCells.has(i))
        worst = Math.max(worst, surface - GROUND);
    }
    // Uncapped, the water would hang hundreds of metres up.
    expect(raw).toBeGreaterThan(100);
    expect(worst).toBeLessThanOrEqual(6 + 1e-6);
  } finally {
    sim.dispose();
  }
});

it("air-brakes with S mid-jump without reversing", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    drive(sim, { boost: true }, 180);
    sim.plane.p[1] += 200;
    const before = sim.plane.speed;
    drive(sim, { throttle: -1 }, 60);
    // Still airborne, and a second of S took off ~30 m/s.
    expect(sim.plane.p[1]).toBeGreaterThan(REST + 50);
    expect(sim.plane.speed).toBeLessThan(before - 25);
    drive(sim, { throttle: -1 }, 120);
    const v = sim.plane.v;
    // Never flips into reverse in the air.
    expect(v[0] * Math.sin(sim.plane.yaw) + v[2] * Math.cos(sim.plane.yaw))
      .toBeGreaterThanOrEqual(0);
  } finally {
    sim.dispose();
  }
});

it("aims nearly straight down and straight up", () => {
  const sim = makeSim();
  try {
    land(sim);
    for (const pitch of [-1.4, 1.4]) {
      sim.input = { ...idle, aimPitch: pitch };
      sim.step();
      expect(sim.plane.lookPitch).toBeCloseTo(pitch + TRUCK.aimTilt, 6);
    }
  } finally {
    sim.dispose();
  }
});

/** Angle between the truck's heading and the way it is actually moving. */
const slipAngle = (sim: Simulation) => {
  const { v, yaw } = sim.plane;
  const forward = v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw),
    side = v[0] * Math.cos(yaw) - v[2] * Math.sin(yaw);
  return Math.abs(Math.atan2(side, Math.abs(forward)));
};

it("stays planted turning hard at normal top speed", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    drive(sim, { throttle: 1 }, 600);
    let worst = 0;
    sim.input = { ...idle, throttle: 1, bank: 1 };
    for (let i = 0; i < 120; i++) {
      sim.step();
      worst = Math.max(worst, slipAngle(sim));
    }
    expect(worst).toBeLessThan(0.06);
    expect(sim.plane.crashed).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("steps the tail out turning on the jets, then grips again", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    drive(sim, { boost: true }, 360);
    let worst = 0;
    sim.input = { ...idle, boost: true, bank: 1 };
    for (let i = 0; i < 60; i++) {
      sim.step();
      worst = Math.max(worst, slipAngle(sim));
    }
    expect(worst).toBeGreaterThan(0.1);
    // The drift angle is held in check rather than spinning out.
    expect(worst).toBeLessThan(TRUCK.maxSlip + 0.15);
    drive(sim, { throttle: 1 }, 120);
    expect(slipAngle(sim)).toBeLessThan(0.05);
    expect(sim.plane.crashed).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("keeps its jump trajectory while yawing in the air", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    drive(sim, { throttle: 1 }, 600);
    sim.plane.p[1] += 100;
    sim.step();
    const heading = (v: number[]) => Math.atan2(v[0], v[2]);
    const before = heading(sim.plane.v),
      yaw = sim.plane.yaw;
    drive(sim, { bank: 1 }, 30);
    expect(yaw - sim.plane.yaw).toBeGreaterThan(0.2);
    expect(Math.abs(heading(sim.plane.v) - before)).toBeLessThan(0.01);
  } finally {
    sim.dispose();
  }
});

it("slows climbing, speeds descending and rolls back down steep slopes", () => {
  // A 30 degree hill rising north of z = 3100 to a plateau, then down again.
  const hill = (_x: number, z: number) =>
    GROUND +
    Math.max(
      0,
      Math.min(60, (z - 3100) * Math.tan(Math.PI / 6), (3400 - z) * Math.tan(Math.PI / 6)),
    );
  const sim = makeSim([], hill);
  try {
    land(sim, [3000, 2900]);
    sim.plane.yaw = 0;
    sim.input = { ...idle, throttle: 1 };
    let climbing = Infinity,
      descending = 0;
    for (let i = 0; i < 1200 && sim.plane.p[2] < 3450; i++) {
      sim.step();
      const z = sim.plane.p[2];
      if (z > 3150 && z < 3190) climbing = Math.min(climbing, sim.plane.speed);
      if (z > 3330 && z < 3390) descending = Math.max(descending, sim.plane.speed);
    }
    expect(sim.plane.crashed).toBe(0);
    expect(climbing).toBeLessThan(TRUCK.maxSpeed - 3);
    expect(descending).toBeGreaterThan(TRUCK.maxSpeed + 3);
  } finally {
    sim.dispose();
  }
  for (const [degrees, rolls] of [
    [3, false],
    [35, true],
  ] as const) {
    const slope = (_x: number, z: number) =>
      GROUND + Math.max(0, z - 2800) * Math.tan((degrees * Math.PI) / 180);
    const s = makeSim([], slope);
    try {
      land(s, [3000, 3000]);
      s.plane.yaw = 0;
      s.plane.v = [0, 0, 0];
      const start = s.plane.p[2];
      drive(s, {}, 120);
      const moved = start - s.plane.p[2];
      if (rolls) expect(moved, `${degrees}°`).toBeGreaterThan(2);
      else expect(Math.abs(moved), `${degrees}°`).toBeLessThan(0.5);
    } finally {
      s.dispose();
    }
  }
});

it("pops off a ramp lip a little steeper than the ramp", () => {
  // A 20 degree ramp up to a 25 m plateau.
  const tan = Math.tan((20 * Math.PI) / 180);
  const ramp = (_x: number, z: number) =>
    GROUND + Math.min(25, Math.max(0, z - 3300) * tan);
  const sim = makeSim([], ramp);
  try {
    land(sim);
    sim.plane.yaw = 0;
    sim.input = { ...idle, throttle: 1 };
    let launch: number[] | undefined,
      peak = 0;
    for (let i = 0; i < 900; i++) {
      sim.step();
      const clearance =
        sim.plane.p[1] - TRUCK.rideHeight - ramp(sim.plane.p[0], sim.plane.p[2]);
      // Takeoff is when it climbs fastest: gravity only slows it after.
      if (sim.plane.p[2] > 3300 && (!launch || sim.plane.v[1] > launch[1]))
        launch = [...sim.plane.v];
      peak = Math.max(peak, clearance);
    }
    expect(sim.plane.crashed).toBe(0);
    expect(launch).toBeDefined();
    const [vx, vy, vz] = launch!;
    const angle = Math.atan2(vy, Math.hypot(vx, vz));
    // The springs pop it off a little steeper than the ramp, never wildly.
    expect(angle).toBeGreaterThan((20 * Math.PI) / 180);
    expect(angle).toBeLessThan(Math.atan(tan * TRUCK.launchPop) * 1.1);
    expect(peak).toBeGreaterThan(3.5);
  } finally {
    sim.dispose();
  }
});

it("rides rolling ground across the terrain grid without skipping", () => {
  const bumpy = (x: number, z: number) =>
    GROUND + 3 * Math.sin(x / 25) * Math.sin(z / 25);
  const sim = makeSim([], bumpy);
  try {
    land(sim);
    sim.plane.yaw = Math.PI / 4;
    sim.input = { ...idle, throttle: 1 };
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      sim.step();
      worst = Math.max(
        worst,
        sim.plane.p[1] - TRUCK.rideHeight - bumpy(sim.plane.p[0], sim.plane.p[2]),
      );
    }
    expect(sim.plane.crashed).toBe(0);
    expect(worst).toBeLessThan(0.5);
  } finally {
    sim.dispose();
  }
});

it("flies off a ledge at speed instead of snapping down it", () => {
  const ledge = (_x: number, z: number) => (z < 3300 ? GROUND + 10 : GROUND);
  const sim = makeSim([], ledge);
  try {
    land(sim);
    sim.plane.yaw = 0;
    sim.input = { ...idle, throttle: 1 };
    let air = 0;
    for (let i = 0; i < 600; i++) {
      sim.step();
      if (sim.plane.p[1] - TRUCK.rideHeight - ledge(sim.plane.p[0], sim.plane.p[2]) > 0.5)
        air++;
    }
    expect(air).toBeGreaterThan(10);
    expect(sim.plane.crashed).toBe(0);
    expect(sim.plane.p[1]).toBeCloseTo(REST, 1);
  } finally {
    sim.dispose();
  }
});

it("keeps its speed landing on a downslope and loses it landing into a rise", () => {
  const speedAfterLanding = (sign: number) => {
    const tan = Math.tan((20 * Math.PI) / 180);
    const slope = (_x: number, z: number) => GROUND + 100 + sign * (z - 3000) * tan;
    const sim = makeSim([], slope);
    try {
      land(sim, [3000, 3000]);
      sim.plane.yaw = 0;
      sim.plane.p[1] += 40;
      sim.plane.v = [0, -20, 40];
      sim.input = idle;
      for (let i = 0; i < 300; i++) {
        sim.step();
        const rest = slope(sim.plane.p[0], sim.plane.p[2]) + TRUCK.rideHeight;
        if (sim.plane.p[1] - rest < 0.01) return sim.plane.speed;
      }
      throw new Error("never landed");
    } finally {
      sim.dispose();
    }
  };
  const down = speedAfterLanding(-1),
    up = speedAfterLanding(1);
  expect(down).toBeGreaterThan(40);
  expect(up).toBeLessThan(35);
});

it("squashes the body on landing and springs back", () => {
  const sim = makeSim();
  try {
    land(sim);
    drive(sim, {}, 120);
    sim.plane.p[1] = REST + 30;
    sim.input = idle;
    const heave: number[] = [];
    for (let i = 0; i < 240; i++) {
      sim.step();
      heave.push(sim.plane.heave ?? 0);
    }
    const low = Math.min(...heave);
    expect(low).toBeLessThan(-0.1);
    const after = heave.slice(heave.indexOf(low));
    expect(Math.max(...after)).toBeGreaterThan(0);
    expect(Math.abs(heave[heave.length - 1])).toBeLessThan(0.02);
    expect(sim.plane.crashed).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("pulls hard off the line and tapers into top speed", () => {
  const sim = makeSim();
  try {
    land(sim);
    sim.plane.yaw = 0;
    sim.input = { ...idle, throttle: 1 };
    const speeds = [sim.plane.speed];
    for (let i = 0; i < 900 && sim.plane.speed < TRUCK.maxSpeed - 0.5; i++) {
      sim.step();
      speeds.push(sim.plane.speed);
    }
    expect(sim.plane.speed).toBeGreaterThan(TRUCK.maxSpeed - 0.5);
    const first = speeds[60] - speeds[0],
      last = speeds[speeds.length - 1] - speeds[speeds.length - 61];
    expect(first).toBeGreaterThan(last * 3);
  } finally {
    sim.dispose();
  }
});
