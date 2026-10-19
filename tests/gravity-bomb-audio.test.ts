import { expect, it, vi } from "vitest";
import { GameAudio } from "../src/audio";
import type { GravityBombState } from "../src/types";
it("reuses gravity voices, releases once, and stops and disconnects all nodes on cleanup", () => {
  const audio = new GameAudio() as any;
  const nodes: any[] = [];
  const node = () => {
    const n: any = {
      gain: { value: 0, setTargetAtTime: vi.fn() },
      frequency: { setTargetAtTime: vi.fn() },
      positionX: {},
      positionY: {},
      positionZ: {},
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      connect: (target: any) => target,
    };
    nodes.push(n);
    return n;
  };
  audio.ctx = {
    currentTime: 0,
    createOscillator: node,
    createGain: node,
    createPanner: node,
    suspend: vi.fn(async () => {}),
  };
  audio.mix = node();
  audio.noise = vi.fn();
  const bomb: GravityBombState = {
    id: 1,
    p: [100, 35, 100],
    age: 0,
    phase: "pulling",
  };
  audio.syncGravityBombs([bomb]);
  expect(audio.stats.gravityVoices).toBe(1);
  const count = nodes.length;
  audio.syncGravityBombs([{ ...bomb, age: 3.5 }]);
  expect(nodes).toHaveLength(count);
  audio.syncGravityBombs([{ ...bomb, phase: "bursting" }]);
  audio.syncGravityBombs([{ ...bomb, phase: "bursting", age: 0.5 }]);
  expect(audio.noise).toHaveBeenCalledTimes(1);
  audio.pause();
  expect(audio.ctx.suspend).toHaveBeenCalledTimes(1);
  audio.syncGravityBombs([]);
  expect(audio.stats.gravityVoices).toBe(0);
  const oscillators = nodes.filter((n) => n.start.mock.calls.length);
  expect(oscillators).toHaveLength(2);
  for (const oscillator of oscillators)
    expect(oscillator.stop).toHaveBeenCalledTimes(1);
  oscillators[1].onended();
  for (const n of nodes.slice(1)) expect(n.disconnect).toHaveBeenCalledTimes(1);
  audio.syncGravityBombs([{ ...bomb, id: 2 }]);
  audio.reset();
  expect(audio.stats.gravityVoices).toBe(0);
  audio.reset();
});
