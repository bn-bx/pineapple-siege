import { afterEach, expect, it, vi } from "vitest";
import {
  bind,
  clearInput,
  input,
  respawn,
  resetDeathControls,
  syncDeathControls,
} from "../src/app/input-controller";
import type { InputControllerContext } from "../src/app/input-controller";
import { SessionState } from "../src/session-state";
import { CameraRig } from "../src/render/camera-rig";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture() {
  class Element extends EventTarget {
    hidden = false;
    disabled = false;
    style = {};
    tagName = "BUTTON";
    blur = vi.fn();
    setPointerCapture() {}
    requestPointerLock = vi.fn(async () => {});
  }
  const elements = new Map<string, Element>(),
    $ = (id: string) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id)!;
    };
  const window = new EventTarget(),
    document = Object.assign(new EventTarget(), {
      body: { classList: { remove: vi.fn(), toggle: vi.fn() } },
      pointerLockElement: $("canvas") as Element | null,
      exitPointerLock: vi.fn(() => {
        document.pointerLockElement = null;
        document.dispatchEvent(new Event("pointerlockchange"));
      }),
    });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  const session = new SessionState();
  session.loaded();
  session.play();
  const rig = new CameraRig();
  rig.mode = "death";
  const ctx = {
    snapshot: { plane: { crashed: 2 } },
    session,
    touch: { keys: new Set(), steering: { x: 0, y: 0 }, reset: vi.fn() },
    keys: new Set(),
    steerX: 0,
    steerY: 0,
    fireUntil: 0,
    dragging: false,
    send: vi.fn(),
    debug: false,
    view: { rig, setChase: vi.fn(() => rig.chase()), toggleCinematic: vi.fn() },
    $,
    canvas: $("canvas"),
    touchControls: $("touchControls"),
    pointerFallback: false,
    clearInput: () => clearInput(ctx),
    respawn: () => respawn(ctx),
    pause: vi.fn(() => session.pause()),
    togglePhoto: vi.fn(),
    cinematic: vi.fn(),
    preferences: () => ({}),
    resetFrameStats: vi.fn(),
    audio: {},
    held: (key: string) => ctx.keys.has(key),
  } as unknown as InputControllerContext;
  bind(ctx);
  const key = (code: string, repeat = false) =>
    window.dispatchEvent(
      Object.assign(new Event("keydown", { cancelable: true }), {
        code,
        repeat,
      }),
    );
  return { ctx, $, document, window, key };
}
it("keeps the crash visible during descent and reveals respawn controls on impact", () => {
  const { ctx, $ } = fixture();
  ctx.snapshot!.plane.falling = true;
  syncDeathControls(ctx);
  expect($("deathOverlay").hidden).toBe(true);
  expect($("flightHUD").hidden).toBe(true);
  ctx.snapshot!.plane.falling = false;
  syncDeathControls(ctx);
  expect($("deathOverlay").hidden).toBe(false);
});
it("unlocks mouse capture without pausing, hides controls and suppresses dead aircraft input", () => {
  const { ctx, $, document, key } = fixture();
  ctx.keys.add("Space");
  ctx.keys.add("Mouse0");
  syncDeathControls(ctx);
  expect(ctx.keys.size).toBe(0);
  expect(document.exitPointerLock).toHaveBeenCalledOnce();
  expect(ctx.pause).not.toHaveBeenCalled();
  expect(ctx.session.active).toBe(true);
  expect($("deathOverlay").hidden).toBe(false);
  expect($("flightHUD").hidden).toBe(true);
  expect(ctx.touchControls.hidden).toBe(true);
  input(ctx);
  expect(ctx.send).toHaveBeenLastCalledWith({
    type: "input",
    input: { x: 0, y: 0, throttle: 0, bank: 0, boost: false, fire: false },
  });
  key("KeyC");
  key("KeyP");
  expect(ctx.cinematic).not.toHaveBeenCalled();
  expect(ctx.togglePhoto).not.toHaveBeenCalled();
  key("Escape");
  expect(ctx.pause).toHaveBeenCalledOnce();
  syncDeathControls(ctx);
  expect($("deathOverlay").hidden).toBe(true);
});
it.each(["Enter", "Space", "KeyR"])(
  "requires a fresh %s press and waits for the respawn snapshot",
  (code) => {
    const { ctx, $, key } = fixture();
    syncDeathControls(ctx);
    key(code, true);
    expect(ctx.send).not.toHaveBeenCalledWith({ type: "respawn" });
    key(code);
    expect(ctx.send).toHaveBeenCalledWith({ type: "respawn" });
    expect($("deathRespawn").disabled).toBe(true);
    expect(ctx.view.rig.mode).toBe("death");
    key(code);
    expect(
      vi
        .mocked(ctx.send)
        .mock.calls.filter(([command]) => command.type === "respawn"),
    ).toHaveLength(1);
    ctx.snapshot!.plane.crashed = 0;
    syncDeathControls(ctx);
    expect($("deathOverlay").hidden).toBe(true);
    expect($("flightHUD").hidden).toBe(false);
    key("Space", true);
    expect(ctx.keys.has("Space")).toBe(false);
    input(ctx);
    expect((vi.mocked(ctx.send).mock.lastCall![0] as any).input.fire).toBe(
      false,
    );
    key("Space");
    expect(ctx.keys.has("Space")).toBe(true);
  },
);
it("supports the visible respawn button and resets overlay ownership for a new island", () => {
  const { ctx, $ } = fixture();
  syncDeathControls(ctx);
  ($("deathRespawn") as any).onclick();
  expect(ctx.send).toHaveBeenCalledWith({ type: "respawn" });
  expect(ctx.canvas.requestPointerLock).toHaveBeenCalledOnce();
  resetDeathControls(ctx);
  expect($("deathOverlay").hidden).toBe(true);
  expect($("deathRespawn").disabled).toBe(false);
});
