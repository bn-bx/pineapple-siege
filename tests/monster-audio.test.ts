import { expect, it, vi } from "vitest";
import { GameAudio } from "../src/audio";

it("gives monster attacks distinct tones while keeping the swipe airy", () => {
  const audio = new GameAudio() as any;
  audio.noise = vi.fn();
  const p = [10, 20, 30] as [number, number, number];

  for (const kind of ["hit", "swipe", "throw", "defeat"] as const)
    audio.monster(p, kind);

  const calls = audio.noise.mock.calls;
  expect(calls).toHaveLength(4);
  expect(calls.map((call: unknown[]) => call[3])).toEqual([
    1300, 2600, 760, 420,
  ]);
  expect(calls[0][5]).toMatchObject({ startHz: 92, endHz: 46 });
  expect(calls[1][5]).toBeUndefined();
  expect(calls[2][5]).toMatchObject({ startHz: 130, endHz: 42 });
  expect(calls[3][5]).toMatchObject({ startHz: 96, endHz: 28 });
  expect(calls[3][4]).toBeGreaterThan(calls[0][4]);
  expect(calls.every((call: unknown[]) => call[0] === p)).toBe(true);
});
