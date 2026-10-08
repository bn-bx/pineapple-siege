import { expect, it, vi } from "vitest";
import { Flies } from "../src/sim/flies";
import {
  WeaponDriver,
  type WeaponDriverContext,
} from "../src/sim/weapon-driver";
import type { Monsters } from "../src/sim/monsters";
import type { Terrain } from "../src/sim/terrain";
import type { Vec3, WorldData } from "../src/types";

it("resolves the nearest world, fly, or ground monster hit before detonating weapons", () => {
  const terrain = {
    sample: () => 0,
    surfaceHeight: () => undefined,
  } as unknown as Terrain;
  const flies = new Flies(
    {
      seed: 3,
      size: 6144,
      spawn: [3000, 100, 3000],
      entities: [],
    } as unknown as WorldData,
    terrain,
    new Set(),
  );
  for (const f of flies.states.slice(1)) f.defeated = true;
  Object.assign(flies.states[0], { p: [1000, 100, 1080], yaw: 0, pitch: 0 });
  let wall: Vec3 | null = [1000, 100, 1020],
    monster: Vec3 | null = [1000, 100, 1100];
  const explode = vi.fn(),
    detonateNuke = vi.fn();
  const host = {
    projectiles: [],
    flies,
    sweep: () => wall,
    monsters: {
      intersect: () => (monster ? { p: monster } : null),
    } as unknown as Monsters,
    explode,
    detonateNuke,
  } as unknown as WeaponDriverContext;
  const driver = new WeaponDriver(host);
  const fire = (weapon: "cannon" | "nuke" = "cannon") => {
    host.projectiles.push({
      id: 1,
      p: [1000, 100, 1000],
      v: [0, 0, 1000],
      age: 0,
      weapon,
      yield: "local",
    });
    driver.update(0.2);
    expect(host.projectiles).toHaveLength(0);
  };
  fire();
  expect(explode).toHaveBeenLastCalledWith(wall);
  wall = null;
  fire();
  expect(explode.mock.lastCall![0][2]).toBeCloseTo(1057.4);
  monster = [1000, 100, 1030];
  fire();
  expect(explode).toHaveBeenLastCalledWith(monster);
  monster = null;
  fire("nuke");
  expect(detonateNuke.mock.lastCall![0][2]).toBeCloseTo(1054.2);
  expect(flies.states[0].health).toBe(3);
});
