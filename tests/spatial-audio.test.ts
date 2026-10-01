import { expect, it, vi } from "vitest";
import { setAudioPosition, setListenerOrientation } from "../src/spatial-audio";

it("updates Firefox's legacy listener without requiring AudioParam properties", () => {
  const listener = { setPosition: vi.fn(), setOrientation: vi.fn() };
  const target = listener as unknown as AudioListener;
  expect(() => {
    setAudioPosition(target, [12, 34, 56]);
    setListenerOrientation(target, [0.6, 0, -0.8]);
  }).not.toThrow();
  expect(listener.setPosition).toHaveBeenCalledWith(12, 34, 56);
  expect(listener.setOrientation).toHaveBeenCalledWith(0.6, 0, -0.8, 0, 1, 0);
});

it("uses current listener params and restores the full upright orientation", () => {
  const listener = {
    positionX: { value: 0 },
    positionY: { value: 0 },
    positionZ: { value: 0 },
    forwardX: { value: 0 },
    forwardY: { value: 0 },
    forwardZ: { value: 0 },
    upX: { value: 9 },
    upY: { value: 9 },
    upZ: { value: 9 },
    setPosition: vi.fn(),
    setOrientation: vi.fn(),
  };
  const target = listener as unknown as AudioListener;
  setAudioPosition(target, [12, 34, 56]);
  setListenerOrientation(target, [0.6, 0, -0.8]);
  expect([
    listener.positionX.value,
    listener.positionY.value,
    listener.positionZ.value,
  ]).toEqual([12, 34, 56]);
  expect([
    listener.forwardX.value,
    listener.forwardY.value,
    listener.forwardZ.value,
  ]).toEqual([0.6, 0, -0.8]);
  expect([listener.upX.value, listener.upY.value, listener.upZ.value]).toEqual([
    0, 1, 0,
  ]);
  expect(listener.setPosition).not.toHaveBeenCalled();
  expect(listener.setOrientation).not.toHaveBeenCalled();
});

it("positions explosion and laser panners through either supported interface", () => {
  const modern = {
    positionX: { value: 0 },
    positionY: { value: 0 },
    positionZ: { value: 0 },
    setPosition: vi.fn(),
  };
  const legacy = { setPosition: vi.fn() };
  setAudioPosition(modern as unknown as PannerNode, [50, 60, 70]);
  setAudioPosition(legacy as unknown as PannerNode, [50, 60, 70]);
  expect([
    modern.positionX.value,
    modern.positionY.value,
    modern.positionZ.value,
  ]).toEqual([50, 60, 70]);
  expect(modern.setPosition).not.toHaveBeenCalled();
  expect(legacy.setPosition).toHaveBeenCalledWith(50, 60, 70);
});
