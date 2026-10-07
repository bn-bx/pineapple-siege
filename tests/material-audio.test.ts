import { expect, it, vi } from "vitest";
import { GameAudio } from "../src/audio";
import type { Material } from "../src/types";
it("uses one shared impact cue and suppresses settling embellishments", () => {
  const audio = new GameAudio() as any;
  audio.noise = vi.fn();
  audio.recording = vi.fn();
  for (const material of [
    "earth",
    "stone",
    "wood",
    "window",
    "foliage",
  ] as Material[])
    audio.contact({ p: [0, 0, 0], material, energy: 1, action: "impact" });
  expect(audio.noise).toHaveBeenCalledTimes(5);
  expect(
    audio.noise.mock.calls.every(
      (call: unknown[]) =>
        JSON.stringify(call) === JSON.stringify(audio.noise.mock.calls[0]),
    ),
  ).toBe(true);
  audio.contact({
    p: [0, 0, 0],
    material: "stone",
    energy: 1,
    action: "settle",
  });
  expect(audio.noise).toHaveBeenCalledTimes(5);
  expect(audio.recording).not.toHaveBeenCalled();
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
