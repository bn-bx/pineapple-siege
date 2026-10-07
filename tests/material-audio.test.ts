import { expect, it, vi } from "vitest";
import { GameAudio } from "../src/audio";
import type { Material } from "../src/types";
it("distinguishes loose material and glass from heavy recorded impacts", () => {
  const audio = new GameAudio() as any;
  audio.noise = vi.fn();
  audio.recording = vi.fn(() => true);
  for (const material of ["earth", "foliage", "window"] as Material[])
    audio.contact({ p: [0, 0, 0], material, energy: 1, action: "impact" });
  expect(audio.recording).not.toHaveBeenCalled();
  const cutoffs = audio.noise.mock.calls.map((call: unknown[]) => call[3]);
  expect(cutoffs[0]).toBeLessThan(cutoffs[1]);
  expect(cutoffs[1]).toBeLessThan(cutoffs[2]);
});
it("keeps roof chips lighter and shorter than masonry and suppresses rejected recordings", () => {
  const audio = new GameAudio() as any;
  audio.noise = vi.fn();
  audio.recording = vi.fn(() => true);
  for (const material of ["stone", "roof", "wood"] as Material[])
    audio.contact({ p: [10, 0, 0], material, energy: 1, action: "fracture" });
  const [stone, roof, wood] = audio.recording.mock.calls;
  expect(roof[2]).toBeLessThan(stone[2]);
  expect(roof[3]).toBeLessThan(stone[3]);
  expect(roof[4]).toBeGreaterThan(stone[4]);
  expect(wood[0]).toBe("wood");
  expect(audio.noise).not.toHaveBeenCalled();
});

it("uses a bounded splash cue instead of a river ambience excerpt for water strikes", () => {
  const audio = new GameAudio() as any;
  audio.noise = vi.fn();
  audio.recording = vi.fn(() => true);
  audio.explosion({
    type: "explosion",
    p: [10, 4, 20],
    water: true,
    power: 1,
    seed: 3,
    kind: "impact",
  });
  expect(audio.recording).not.toHaveBeenCalled();
  expect(audio.noise).toHaveBeenCalledTimes(2);
  expect(audio.noise.mock.calls[0][3]).toBeLessThan(
    audio.noise.mock.calls[1][3],
  );
  expect(audio.noise.mock.calls[1][0]).toEqual([10, 5.2, 20]);
});
