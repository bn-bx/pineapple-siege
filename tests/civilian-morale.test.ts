import { expect, it } from "vitest";
import { civilianPopulation } from "../src/civilian-morale";
import type { CivilianState } from "../src/types";
const resident = (
  mood: CivilianState["mood"],
  alive = true,
): CivilianState => ({ id: 0, p: [0, 0, 0], yaw: 0, alive, mood, phase: 0 });
it("includes casualties in happiness, while preserving total population and losses", () => {
  expect(
    civilianPopulation([
      resident("cheer"),
      resident("sad"),
      resident("flee"),
      resident("walk"),
      resident("cheer", false),
    ]),
  ).toEqual({
    total: 5,
    alive: 4,
    lost: 1,
    cheering: 1,
    sad: 1,
    frightened: 1,
    happiness: 39,
  });
  expect(civilianPopulation([resident("sad", false)])).toMatchObject({
    alive: 0,
    lost: 1,
    happiness: 0,
  });
  expect(civilianPopulation([])).toMatchObject({ total: 0, happiness: 0 });
});
it("reflects celebration, fear, and mourning on the happiness scale", () => {
  expect(civilianPopulation([resident("walk")]).happiness).toBe(65);
  expect(civilianPopulation([resident("cheer")]).happiness).toBe(100);
  expect(civilianPopulation([resident("sad")]).happiness).toBe(10);
  expect(civilianPopulation([resident("flee")]).happiness).toBe(25);
});

it("permanently reduces happiness for every casualty, including an already sad resident", () => {
  const people = Array.from({ length: 600 }, () => resident("walk"));
  const before = civilianPopulation(people).happiness;
  people[0].alive = false;
  expect(civilianPopulation(people).happiness).toBe(before - 1);
  for (let i = 1; i < 10; i++) people[i].alive = false;
  expect(civilianPopulation(people).happiness).toBeLessThan(before - 9);
  const mixed = [resident("sad"), resident("cheer")];
  const calm = civilianPopulation(mixed).happiness;
  mixed[0].alive = false;
  expect(civilianPopulation(mixed).happiness).toBeLessThan(calm);
});
