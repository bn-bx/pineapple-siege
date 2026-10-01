import { expect, it } from "vitest";
import { bindTouchControls } from "../src/input";

it("keeps simultaneous touch inputs independent and clears cancelled or paused holds", () => {
  class Control extends EventTarget {
    dataset: { key?: string } = {};
    style = { setProperty() {} };
    classList = { add() {}, remove() {} };
    setPointerCapture() {}
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 };
    }
    pointer(type: string, pointerId: number, clientX = 50, clientY = 50) {
      this.dispatchEvent(
        Object.assign(new Event(type), {
          pointerId,
          clientX,
          clientY,
          button: 0,
        }),
      );
    }
  }
  const stick = new Control(),
    fire = new Control(),
    boost = new Control();
  fire.dataset.key = "Space";
  boost.dataset.key = "ShiftLeft";
  const root = {
    querySelector: () => stick,
    querySelectorAll: () => [fire, boost],
  } as unknown as HTMLElement;
  let active = true;
  const preferences = {
    reverseX: false,
    reverseY: false,
    sensitivity: 1,
    nukeYield: "local" as const,
  };
  const touch = bindTouchControls(
    root,
    () => active,
    () => preferences,
  );
  stick.pointer("pointerdown", 1, 100, 0);
  fire.pointer("pointerdown", 2);
  boost.pointer("pointerdown", 3);
  expect(touch.steering).toEqual({ x: 1, y: 1 });
  expect([...touch.keys]).toEqual(["Space", "ShiftLeft"]);
  fire.pointer("pointerup", 2);
  expect([...touch.keys]).toEqual(["ShiftLeft"]);
  expect(touch.steering.x).toBe(1);
  stick.pointer("pointercancel", 1);
  expect(touch.steering).toEqual({ x: 0, y: 0 });
  preferences.reverseX = preferences.reverseY = true;
  stick.pointer("pointerdown", 4, 100, 0);
  expect(touch.steering).toEqual({ x: -1, y: -1 });
  touch.reset();
  expect(touch.keys.size).toBe(0);
  expect(touch.steering).toEqual({ x: 0, y: 0 });
  active = false;
  fire.pointer("pointerdown", 5);
  expect(touch.keys.size).toBe(0);
});
