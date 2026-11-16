import { GameAudio } from "../audio";
import { clamp, TRUCK } from "../config";
import { pointerSteering } from "../input";
import { createPhotoSaveAction } from "../photo-save";
import { GameRenderer } from "../render/renderer";
import { SessionState } from "../session-state";
import type {
  GameCommand,
  Preferences,
  SimulationSnapshot,
  Vec3,
} from "../types";
export interface InputControllerContext {
  snapshot?: SimulationSnapshot;
  touch: {
    keys: Set<string>;
    steering: { x: number; y: number };
    reset(): void;
  };
  debugInput: import("../types").InputState | undefined;
  keys: Set<string>;
  steerX: number;
  steerY: number;
  /** Truck turret aim from the mouse (radians right of heading, and up). */
  aimYaw: number;
  aimPitch: number;
  fireUntil: number;
  dragging: boolean;
  send: (message: GameCommand, transfer?: Transferable[]) => void;
  debug: boolean;
  held: (key: string) => boolean;
  session: SessionState;
  view: GameRenderer;
  $: <T extends HTMLElement = HTMLElement>(id: string) => T;
  clearInput: () => void;
  resetFrameStats: () => void;
  audio: GameAudio;
  touchControls: HTMLElement;
  pointerFallback: boolean;
  canvas: HTMLCanvasElement;
  togglePhoto: () => void;
  respawn: () => void;
  toggleVehicle: () => void;
  pause: () => void;
  cinematic: () => void;
  preferences: () => Preferences;
}
const deathControls = new WeakMap<
  InputControllerContext,
  { shown: boolean; pending: boolean }
>();
/** When the truck's aim last moved, for easing the view back behind it. */
const aimActivity = new WeakMap<
  InputControllerContext,
  { moved: number; frame: number }
>();
const aimState = (ctx: InputControllerContext) => {
  let state = aimActivity.get(ctx);
  if (!state) {
    const now = performance.now();
    aimActivity.set(ctx, (state = { moved: now, frame: now }));
  }
  return state;
};
const dead = (ctx: InputControllerContext) =>
  (ctx.snapshot?.plane.crashed ?? 0) > 0;
const deathState = (ctx: InputControllerContext) => {
  let state = deathControls.get(ctx);
  if (!state)
    deathControls.set(ctx, (state = { shown: false, pending: false }));
  return state;
};
export function resetDeathControls(ctx: InputControllerContext) {
  deathControls.delete(ctx);
  ctx.$("deathOverlay").hidden = true;
  ctx.$<HTMLButtonElement>("deathRespawn").disabled = false;
}
export function syncDeathControls(ctx: InputControllerContext) {
  const state = deathState(ctx),
    crashed = dead(ctx);
  if (crashed && !state.shown) {
    state.shown = true;
    ctx.clearInput();
    document.body.classList.remove("cinematic");
    ctx.$("hint").hidden = true;
    if (document.pointerLockElement === ctx.canvas) document.exitPointerLock();
  } else if (!crashed) {
    state.shown = state.pending = false;
  }
  ctx.$("deathOverlay").hidden =
    !ctx.session.active || !crashed || !!ctx.snapshot?.plane.falling;
  ctx.$<HTMLButtonElement>("deathRespawn").disabled = state.pending;
  if (ctx.session.active) {
    ctx.$("flightHUD").hidden = crashed;
    ctx.touchControls.hidden = crashed;
  }
}
export function clearInput(ctx: InputControllerContext): void {
  ctx.touch.reset();
  ctx.debugInput = undefined;
  ctx.keys.clear();
  ctx.steerX = ctx.steerY = 0;
  ctx.aimYaw = ctx.aimPitch = 0;
  ctx.fireUntil = 0;
  ctx.dragging = false;
  ctx.send({
    type: "input",
    input: { x: 0, y: 0, throttle: 0, bank: 0, boost: false, fire: false },
  });
}
export function input(ctx: InputControllerContext): void {
  if (dead(ctx)) {
    ctx.send({
      type: "input",
      input: { x: 0, y: 0, throttle: 0, bank: 0, boost: false, fire: false },
    });
    return;
  }
  if (ctx.debug && ctx.debugInput) {
    ctx.send({ type: "input", input: ctx.debugInput });
    return;
  }
  // In the truck the mouse aims the turret; only keys and the stick steer.
  const driving = ctx.snapshot?.plane.mode === "ground";
  const firing =
    ctx.keys.has("Mouse0") ||
    ctx.held("Space") ||
    performance.now() < ctx.fireUntil;
  if (driving) {
    // Leave the mouse alone (and stop firing) and the view eases back
    // behind the truck.
    const now = performance.now(),
      state = aimState(ctx),
      dt = Math.min(0.1, (now - state.frame) / 1000);
    state.frame = now;
    if (firing) state.moved = now;
    if (now - state.moved > TRUCK.aimReturnDelay * 1000) {
      const k = 1 - Math.exp(-dt * 2.5);
      ctx.aimYaw -= ctx.aimYaw * k;
      ctx.aimPitch -= ctx.aimPitch * k;
    }
  }
  ctx.send({
    type: "input",
    input: {
      x: driving
        ? clamp(ctx.touch.steering.x, -1, 1)
        : clamp(ctx.steerX + ctx.touch.steering.x, -1, 1),
      y: driving ? 0 : clamp(ctx.steerY + ctx.touch.steering.y, -1, 1),
      aimYaw: ctx.aimYaw,
      aimPitch: ctx.aimPitch,
      // The crosshair is the chase camera's view ray; the sim casts it.
      ...(driving && ctx.view.rig.mode === "chase"
        ? {
            aimFrom: ctx.view.camera.position.toArray() as Vec3,
            aimDir: ctx.view.cameraDirection(),
          }
        : {}),
      throttle: (ctx.held("KeyW") ? 1 : 0) - (ctx.held("KeyS") ? 1 : 0),
      bank: (ctx.keys.has("KeyD") ? 1 : 0) - (ctx.keys.has("KeyA") ? 1 : 0),
      boost: ctx.held("ShiftLeft") || ctx.held("ShiftRight"),
      fire: firing,
    },
  });
}
export function cinematic(ctx: InputControllerContext): void {
  if (!ctx.session.active || dead(ctx)) return;
  ctx.view.toggleCinematic();
  document.body.classList.toggle(
    "cinematic",
    ctx.view.rig.mode === "cinematic",
  );
  ctx.$("hint").textContent =
    ctx.view.rig.mode === "cinematic"
      ? "C: Chase view"
      : "C: Cinematic view · P: Photo mode";
  ctx.$("hint").hidden = false;
  ctx.$("hint").style.opacity = "1";
  setTimeout(() => (ctx.$("hint").style.opacity = "0"), 2500);
}
export function togglePhoto(ctx: InputControllerContext): void {
  if (dead(ctx)) return;
  if (ctx.session.photoPending) return;
  if (ctx.session.photoMode) {
    ctx.session.pause();
    ctx.view.rig.exitPhoto();
    ctx.view.setPhotoExposure(1.15);
    ctx.view.setPhotoFocus(0);
    ctx.$<HTMLInputElement>("photoExposure").value = "1.15";
    ctx.$<HTMLInputElement>("photoFocus").value = "0";
    document.body.classList.remove("photo");
    ctx.$("photoToolbar").hidden = true;
    ctx.clearInput();
    if (ctx.session.ready) {
      ctx.resetFrameStats();
      ctx.view.resumeSnapshots();
      ctx.session.play();
      ctx.send({ type: "pause", paused: false });
      ctx.audio.start().catch(() => {});
    }
    document.body.classList.toggle(
      "cinematic",
      ctx.view.rig.mode === "cinematic",
    );
    ctx.touchControls.hidden = !ctx.session.active;
    if (!ctx.pointerFallback && document.pointerLockElement !== ctx.canvas)
      ctx.canvas.requestPointerLock().catch(() => {
        ctx.pointerFallback = true;
      });
    return;
  }
  if (!ctx.session.active) return;
  ctx.session.requestPhoto();
  ctx.touchControls.hidden = true;
  ctx.$("ceilingWarning").hidden = true;
  ctx.clearInput();
  ctx.send({ type: "pause", paused: true });
  ctx.audio.pause();
  ctx.$("hint").hidden = true;
  if (document.pointerLockElement === ctx.canvas) document.exitPointerLock();
}
export function respawn(ctx: InputControllerContext): void {
  if (!ctx.session.active) return;
  const state = deathState(ctx);
  if (state.pending) return;
  state.pending = dead(ctx);
  ctx.clearInput();
  if (!dead(ctx)) ctx.view.setChase();
  ctx.$<HTMLButtonElement>("deathRespawn").disabled = state.pending;
  ctx.$("deathRespawn").blur();
  document.body.classList.remove("cinematic");
  ctx.send({ type: "respawn" });
  captureMouse(ctx);
}

/**
 * Capture the mouse for steering and aiming. Browsers refuse the lock when
 * the request isn't tied to a fresh click (after an await) or comes within
 * a second of pressing Esc; rather than dropping to drag-to-steer for good,
 * ask for a click and capture again from that click.
 */
export function captureMouse(ctx: InputControllerContext): void {
  if (ctx.pointerFallback || document.pointerLockElement === ctx.canvas) return;
  const request = (() => {
    try {
      return ctx.canvas.requestPointerLock() as Promise<void> | undefined;
    } catch {
      return undefined;
    }
  })();
  if (request && typeof request.catch === "function")
    request.then(
      () => hideCapturePrompt(ctx),
      () => showCapturePrompt(ctx),
    );
}
function showCapturePrompt(ctx: InputControllerContext) {
  if (!ctx.session.active || document.pointerLockElement === ctx.canvas) return;
  const hint = ctx.$("hint");
  if (!hint?.dataset) return;
  hint.textContent = "Click to capture the mouse";
  hint.dataset.capture = "1";
  hint.hidden = false;
  hint.style.opacity = "1";
}
function hideCapturePrompt(ctx: InputControllerContext) {
  const hint = ctx.$("hint");
  if (!hint?.dataset) return;
  if (hint.dataset.capture !== "1") return;
  delete hint.dataset.capture;
  hint.style.opacity = "0";
}

/** Swap between the aircraft and the monster truck hearse. */
export function toggleVehicle(ctx: InputControllerContext): void {
  if (!ctx.session.active || dead(ctx) || !ctx.snapshot) return;
  const mode = ctx.snapshot.plane.mode === "ground" ? "air" : "ground";
  ctx.aimYaw = ctx.aimPitch = 0;
  ctx.steerX = ctx.steerY = 0;
  ctx.send({ type: "vehicleMode", mode });
  ctx.$("hint").textContent =
    mode === "ground"
      ? "A/D steer · W/S drive · Mouse aims the turret · F pour concrete · V take off"
      : "Mouse steers · W/S throttle · V drive";
  ctx.$("hint").hidden = false;
  ctx.$("hint").style.opacity = "1";
  setTimeout(() => (ctx.$("hint").style.opacity = "0"), 6000);
}

export function bind(ctx: InputControllerContext): void {
  ctx.$("exitPhoto").onclick = ctx.togglePhoto;
  ctx.$("hidePhoto").onclick = () => (ctx.$("photoToolbar").hidden = true);
  ctx.$<HTMLInputElement>("photoFov").oninput = (e) =>
    (ctx.view.rig.fov = +(e.target as HTMLInputElement).value);
  ctx.$<HTMLInputElement>("photoExposure").oninput = (e) =>
    ctx.view?.setPhotoExposure(Number((e.target as HTMLInputElement).value));
  ctx.$<HTMLInputElement>("photoFocus").oninput = (e) =>
    ctx.view?.setPhotoFocus(Number((e.target as HTMLInputElement).value));
  ctx.$("savePhoto").onclick = createPhotoSaveAction(
    ctx.$<HTMLButtonElement>("savePhoto"),
    ctx.$("photoStatus"),
    () => ctx.view.capture(),
    (blob) => {
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = "pineapple-siege.png";
        a.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    },
  );
  for (const weapon of ["cannon", "nuke", "laser", "gravityBomb"] as const)
    ctx.$("select-" + weapon).onclick = () => {
      if (ctx.session.active) ctx.send({ type: "weapon", weapon });
    };
  ctx.$("touchRespawn").onclick = ctx.respawn;
  ctx.$("touchVehicle").onclick = ctx.toggleVehicle;
  ctx.$("deathRespawn").onclick = ctx.respawn;
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      ctx.pause();
      return;
    }
    if (dead(ctx) && ctx.session.active) {
      e.preventDefault();
      if (!e.repeat && ["Enter", "Space", "KeyR"].includes(e.code))
        ctx.respawn();
      return;
    }
    if (
      e.repeat &&
      ["Enter", "Space", "KeyR"].includes(e.code) &&
      !ctx.keys.has(e.code)
    ) {
      e.preventDefault();
      return;
    }
    if (e.repeat && ["KeyP", "KeyC", "KeyH", "KeyV"].includes(e.code)) return;
    if (e.code === "KeyP" && (ctx.session.active || ctx.session.photoMode)) {
      e.preventDefault();
      ctx.togglePhoto();
      return;
    }
    if (ctx.session.photoMode) {
      if (e.code === "KeyH")
        ctx.$("photoToolbar").hidden = !ctx.$("photoToolbar").hidden;
      if (!["INPUT", "BUTTON"].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        ctx.keys.add(e.code);
      }
      return;
    }
    if (!ctx.session.active) return;
    if (e.code === "KeyC") {
      e.preventDefault();
      ctx.cinematic();
      return;
    }
    if (e.code === "KeyV") {
      e.preventDefault();
      ctx.toggleVehicle();
      return;
    }
    if (
      e.code === "Digit1" ||
      e.code === "Digit2" ||
      e.code === "Digit3" ||
      e.code === "Digit4"
    ) {
      e.preventDefault();
      ctx.send({
        type: "weapon",
        weapon:
          e.code === "Digit1"
            ? "cannon"
            : e.code === "Digit2"
              ? "nuke"
              : e.code === "Digit3"
                ? "laser"
                : "gravityBomb",
      });
      return;
    }
    if (
      [
        "KeyW",
        "KeyS",
        "KeyA",
        "KeyD",
        "KeyF",
        "ShiftLeft",
        "ShiftRight",
        "Space",
        "KeyR",
      ].includes(e.code)
    ) {
      e.preventDefault();
      ctx.keys.add(e.code);
      if (e.code === "Space") ctx.fireUntil = performance.now() + 100;
      if (e.code === "KeyR" && !e.repeat) ctx.respawn();
    }
  });
  window.addEventListener("keyup", (e) => ctx.keys.delete(e.code));
  ctx.canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    if (ctx.session.photoMode) {
      ctx.dragging = true;
      ctx.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (!ctx.session.active || dead(ctx)) return;
    // Lost the mouse? This click captures it again rather than firing.
    if (!ctx.pointerFallback && document.pointerLockElement !== ctx.canvas) {
      captureMouse(ctx);
      return;
    }
    ctx.dragging = true;
    if (document.pointerLockElement !== ctx.canvas)
      ctx.canvas.setPointerCapture(e.pointerId);
    if (!ctx.pointerFallback && e.button === 0) {
      ctx.keys.add("Mouse0");
      ctx.fireUntil = performance.now() + 100;
    }
  });
  window.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") return;
    ctx.dragging = false;
    ctx.keys.delete("Mouse0");
  });
  window.addEventListener("mousemove", (e) => {
    if (ctx.session.photoMode) {
      if (ctx.dragging || document.pointerLockElement === ctx.canvas)
        ctx.view.rig.look(e.movementX, e.movementY);
      return;
    }
    if (
      !ctx.session.active ||
      dead(ctx) ||
      (document.pointerLockElement !== ctx.canvas && !ctx.dragging)
    )
      return;
    if (ctx.snapshot?.plane.mode === "ground") {
      aimState(ctx).moved = performance.now();
      const prefs = ctx.preferences(),
        k = 0.0025 * prefs.sensitivity;
      ctx.aimYaw = Math.atan2(
        Math.sin(ctx.aimYaw + e.movementX * k * (prefs.reverseX ? -1 : 1)),
        Math.cos(ctx.aimYaw + e.movementX * k * (prefs.reverseX ? -1 : 1)),
      );
      ctx.aimPitch = clamp(
        ctx.aimPitch - e.movementY * k * (prefs.reverseY ? -1 : 1),
        TRUCK.aimPitchMin,
        TRUCK.aimPitchMax,
      );
      return;
    }
    const steering = pointerSteering(
      ctx.steerX,
      ctx.steerY,
      e.movementX,
      e.movementY,
      ctx.preferences(),
    );
    ctx.steerX = steering.x;
    ctx.steerY = steering.y;
  });
  ctx.canvas.addEventListener("dblclick", () => {
    ctx.steerX = ctx.steerY = 0;
    ctx.aimYaw = ctx.aimPitch = 0;
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === ctx.canvas) hideCapturePrompt(ctx);
    if (
      document.pointerLockElement !== ctx.canvas &&
      ctx.session.active &&
      !dead(ctx) &&
      !ctx.pointerFallback
    )
      ctx.pause();
  });
  document.addEventListener("pointerlockerror", () => showCapturePrompt(ctx));
  window.addEventListener("blur", ctx.pause);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) ctx.pause();
  });
}
