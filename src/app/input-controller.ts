import { GameAudio } from "../audio";
import { clamp } from "../config";
import { pointerSteering } from "../input";
import { createPhotoSaveAction } from "../photo-save";
import { GameRenderer } from "../render/renderer";
import { SessionState } from "../session-state";
import type { GameCommand, Preferences } from "../types";
export interface InputControllerContext {
  touch: {
    keys: Set<string>;
    steering: { x: number; y: number };
    reset(): void;
  };
  debugInput: import("../types").InputState | undefined;
  keys: Set<string>;
  steerX: number;
  steerY: number;
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
  pause: () => void;
  cinematic: () => void;
  preferences: () => Preferences;
}
export function clearInput(ctx: InputControllerContext): void {
  ctx.touch.reset();
  ctx.debugInput = undefined;
  ctx.keys.clear();
  ctx.steerX = ctx.steerY = 0;
  ctx.fireUntil = 0;
  ctx.dragging = false;
  ctx.send({
    type: "input",
    input: { x: 0, y: 0, throttle: 0, bank: 0, boost: false, fire: false },
  });
}
export function input(ctx: InputControllerContext): void {
  if (ctx.debug && ctx.debugInput) {
    ctx.send({ type: "input", input: ctx.debugInput });
    return;
  }
  ctx.send({
    type: "input",
    input: {
      x: clamp(ctx.steerX + ctx.touch.steering.x, -1, 1),
      y: clamp(ctx.steerY + ctx.touch.steering.y, -1, 1),
      throttle: (ctx.held("KeyW") ? 1 : 0) - (ctx.held("KeyS") ? 1 : 0),
      bank: (ctx.keys.has("KeyD") ? 1 : 0) - (ctx.keys.has("KeyA") ? 1 : 0),
      boost: ctx.held("ShiftLeft") || ctx.held("ShiftRight"),
      fire:
        ctx.keys.has("Mouse0") ||
        ctx.held("Space") ||
        performance.now() < ctx.fireUntil,
    },
  });
}
export function cinematic(ctx: InputControllerContext): void {
  if (!ctx.session.active) return;
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
  ctx.clearInput();
  ctx.view.setChase();
  document.body.classList.remove("cinematic");
  ctx.send({ type: "respawn" });
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
  for (const weapon of ["cannon", "nuke", "laser"] as const)
    ctx.$("select-" + weapon).onclick = () => {
      if (ctx.session.active) ctx.send({ type: "weapon", weapon });
    };
  ctx.$("touchRespawn").onclick = ctx.respawn;
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      ctx.pause();
      return;
    }
    if (e.repeat && ["KeyP", "KeyC", "KeyH"].includes(e.code)) return;
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
    if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") {
      e.preventDefault();
      ctx.send({
        type: "weapon",
        weapon:
          e.code === "Digit1"
            ? "cannon"
            : e.code === "Digit2"
              ? "nuke"
              : "laser",
      });
      return;
    }
    if (
      [
        "KeyW",
        "KeyS",
        "KeyA",
        "KeyD",
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
    if (!ctx.session.active) return;
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
      (document.pointerLockElement !== ctx.canvas && !ctx.dragging)
    )
      return;
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
  });
  document.addEventListener("pointerlockchange", () => {
    if (
      document.pointerLockElement !== ctx.canvas &&
      ctx.session.active &&
      !ctx.pointerFallback
    )
      ctx.pause();
  });
  document.addEventListener("pointerlockerror", () => {
    ctx.pointerFallback = true;
    ctx.$("status").textContent = "Hold and drag to steer; Space fires.";
  });
  window.addEventListener("blur", ctx.pause);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) ctx.pause();
  });
}
