import { clamp } from "./config";
import type { Preferences } from "./types";
export function pointerSteering(
  x: number,
  y: number,
  dx: number,
  dy: number,
  p: Preferences,
) {
  return {
    x: clamp(x + dx * 0.002 * p.sensitivity * (p.reverseX ? -1 : 1), -1, 1),
    y: clamp(y - dy * 0.002 * p.sensitivity * (p.reverseY ? -1 : 1), -1, 1),
  };
}

export function bindTouchControls(
  root: HTMLElement,
  isActive: () => boolean,
  preferences: () => Preferences,
) {
  const held = new Map<number, string>();
  const keys = new Set<string>();
  const steering = { x: 0, y: 0 };
  const stick = root.querySelector<HTMLElement>("[data-stick]")!;
  let stickPointer: number | undefined;
  function center() {
    stickPointer = undefined;
    steering.x = steering.y = 0;
    stick.style.setProperty("--stick-x", "0px");
    stick.style.setProperty("--stick-y", "0px");
  }
  function move(e: PointerEvent) {
    if (e.pointerId !== stickPointer) return;
    const rect = stick.getBoundingClientRect();
    const radius = rect.width / 2;
    const x = clamp((e.clientX - rect.left - radius) / radius, -1, 1);
    const y = clamp((e.clientY - rect.top - rect.height / 2) / radius, -1, 1);
    Object.assign(
      steering,
      pointerSteering(0, 0, x / 0.002, y / 0.002, preferences()),
    );
    stick.style.setProperty("--stick-x", `${x * 32}px`);
    stick.style.setProperty("--stick-y", `${y * 32}px`);
  }
  stick.addEventListener("pointerdown", (e) => {
    if (!isActive() || stickPointer !== undefined || e.button !== 0) return;
    e.preventDefault();
    stickPointer = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    move(e);
  });
  stick.addEventListener("pointermove", move);
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    stick.addEventListener(event, (e) => {
      if ((e as PointerEvent).pointerId === stickPointer) center();
    });
  for (const button of Array.from(
    root.querySelectorAll<HTMLElement>("[data-key]"),
  )) {
    button.addEventListener("pointerdown", (e) => {
      if (!isActive() || e.button !== 0) return;
      e.preventDefault();
      held.set(e.pointerId, button.dataset.key!);
      keys.add(button.dataset.key!);
      button.classList.add("held");
      button.setPointerCapture(e.pointerId);
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(event, (e) => {
        held.delete((e as PointerEvent).pointerId);
        if (![...held.values()].includes(button.dataset.key!)) {
          keys.delete(button.dataset.key!);
          button.classList.remove("held");
        }
      });
  }
  return {
    keys,
    steering,
    reset() {
      held.clear();
      keys.clear();
      center();
      for (const button of Array.from(root.querySelectorAll(".held")))
        button.classList.remove("held");
    },
  };
}
