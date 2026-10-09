import { AltitudeWarning } from "../altitude-warning";
import { GameAudio } from "../audio";
import { DEFAULT_MONSTER_COUNT } from "../config";
import { COSMETIC_LIMITS, DEFAULT_DESTRUCTION } from "../destruction-settings";
import { bindTouchControls } from "../input";
import { normalizePreferences } from "../preferences";
import { GameRenderer } from "../render/renderer";
import { SaveCaptureCoordinator } from "../save-capture";
import { SaveWriter } from "../save-writer";
import { SessionState } from "../session-state";
import { unpackBodies } from "../sim/body-buffer";
import { SaveStore } from "../storage";
import "../style.css";
import type {
  GameCommand,
  NukeYield,
  Preferences,
  SaveSnapshot,
  SimulationSnapshot,
  Vec3,
  WorkerMessage,
  WorldData,
} from "../types";
import { type IslandBaseline } from "../world/generator.mjs";
import { IslandPreview } from "../world/preview";
import { updateHUD } from "./hud";
import * as input_controller from "./input-controller";
import * as island_coordinator from "./island-coordinator";
import * as save_coordinator from "./save-coordinator";
import * as settings from "./settings";
import { bindMenu } from "./menu";
const menu = bindMenu();
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("world"),
  enterButton = $<HTMLButtonElement>("enter");
const debug =
  location.hash.includes("debug") ||
  new URLSearchParams(location.search).has("debug");
let worker: Worker,
  view: GameRenderer,
  world: WorldData,
  snapshot: SimulationSnapshot | undefined,
  everEntered = false,
  saveEnabled = true,
  hasSave = false,
  savedRevision = -1,
  lastSaveAt = 0,
  lastSavedHour = -1;
const audio = new GameAudio(),
  saveWriter = new SaveWriter("lantern-vale"),
  store = new SaveStore("lantern-vale", saveWriter),
  keys = new Set<string>();
saveWriter.onPreparation = (ms) => view?.performance.record("saveDispatch", ms);
let steerX = 0,
  steerY = 0,
  fireUntil = 0,
  dragging = false,
  pointerFallback = false,
  sensitivity = 1,
  inverted = false,
  reversedX = false,
  nukeYield: NukeYield = "valley",
  monsterCount = DEFAULT_MONSTER_COUNT,
  destruction = { ...DEFAULT_DESTRUCTION },
  lastShots = 0,
  lastTime = 0,
  lastHUD = 0,
  lastDraw = 0,
  avgFrame = 16.7;
const frameTimes: number[] = [];
let extras = normalizePreferences();
const session = new SessionState();
let saveNoticeTimer = 0;
let perfSummary = "",
  lastPerfSummary = 0;
let queuedReset = false,
  saveEpoch = 0;
const altitudeWarning = new AltitudeWarning();
let islandChanging = false;
let islandLinkError = "";
const islandPreview = new IslandPreview();
function resetFrameStats() {
  frameTimes.length = 0;
  perfSummary = "";
  lastPerfSummary = lastTime = lastDraw = 0;
  avgFrame = 16.7;
}
let debugInput: import("../types").InputState | undefined;
const saveCaptures = new SaveCaptureCoordinator();
const stepWaiters: ((value: unknown) => void)[] = [];
const pendingReady: (() => void)[] = [];
const touchControls = $("touchControls");
const touchDevice = matchMedia("(any-pointer: coarse)");
const touch = bindTouchControls(
  touchControls,
  () => session.active,
  preferences,
);
const held = (key: string) => keys.has(key) || touch.keys.has(key);
function preferences(): Preferences {
  return settings.preferences(context);
}
function savePreferences(): void {
  return settings.savePreferences(context);
}
function applyPreferences(p: Preferences): void {
  return settings.applyPreferences(context, p);
}
function updateMonsterCountUI(): void {
  return settings.updateMonsterCountUI(context);
}
function updateRenderDistanceUI(): void {
  return settings.updateRenderDistanceUI(context);
}
function updateDestructionUI(): void {
  return settings.updateDestructionUI(context);
}
function applyDestruction(): void {
  return settings.applyDestruction(context);
}
function send(message: GameCommand, transfer: Transferable[] = []) {
  worker?.postMessage(message, transfer);
}
function fatal(message: string, detail = "") {
  session.loading();
  saveEpoch++;
  saveCaptures.retire();
  saveWriter.close();
  pause();
  enterButton.disabled = true;
  $("fatalMessage").textContent = message;
  $("fatalDetails").textContent = detail;
  $("fatal").hidden = false;
}
function clearInput(): void {
  return input_controller.clearInput(context);
}
function pause() {
  touchControls.hidden = true;
  session.pause();
  view?.setChase();
  document.body.classList.remove("cinematic", "photo");
  $("photoToolbar").hidden = true;
  $("ceilingWarning").hidden = true;
  clearInput();
  send({ type: "pause", paused: true });
  audio.pause();
  if (everEntered) {
    const openingMenu = $("overlay").hidden;
    $("overlay").hidden = false;
    $("flightHUD").hidden = true;
    $("pauseButton").hidden = true;
    $("title").textContent = "Paused";
    $("intro").textContent = saveEnabled
      ? "World changes are saved in this browser."
      : "World changes are not being saved.";
    $("enterLabel").textContent = "Resume";
    if (openingMenu) menu.home();
    $("newWorld").hidden = false;
    $<HTMLInputElement>("time").value = String(snapshot?.hour || 15.5);
    saveNow();
  }
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  $("hint").hidden = true;
  $("warning").hidden = true;
}
let guideSeen = false;
try {
  guideSeen = localStorage.getItem("siege-control-guide-v1") === "1";
} catch {}
async function enter(event?: Event) {
  if (!session.ready || session.contextLost) return;
  resetFrameStats();
  view.resumeSnapshots();
  everEntered = true;
  session.play();
  clearInput();
  send({ type: "pause", paused: false });
  $("overlay").hidden = true;
  $("flightHUD").hidden = false;
  $("pauseButton").hidden = false;
  touchControls.hidden = false;
  $("hint").hidden = guideSeen;
  $("hint").style.opacity = "1";
  if (!guideSeen) {
    guideSeen = true;
    try {
      localStorage.setItem("siege-control-guide-v1", "1");
    } catch {}
  }
  setTimeout(() => ($("hint").style.opacity = "0"), 9000);
  audio.start().catch(() => {
    $("status").textContent = "Sound is unavailable; flight is still ready.";
  });
  try {
    if (
      event instanceof PointerEvent
        ? event.pointerType === "touch"
        : touchDevice.matches
    ) {
      pointerFallback = true;
      $("hint").textContent =
        "Left pad steers · hold Fire or Boost · +/− throttle";
      return;
    }
    await canvas.requestPointerLock();
    pointerFallback = false;
  } catch {
    pointerFallback = true;
    $("hint").hidden = false;
    $("hint").textContent =
      "Hold and drag to steer · A/D also steers · SPACE fires";
    $("status").textContent =
      "Mouse capture is unavailable. Hold and drag to steer.";
  }
}
function input(): void {
  return input_controller.input(context);
}
function requestSave(): Promise<SaveSnapshot> {
  return save_coordinator.requestSave(context);
}
function saveNow(force = false): Promise<void> {
  return save_coordinator.saveNow(context, force);
}
function askReset(): void {
  return save_coordinator.askReset(context);
}
function resetWorld(): Promise<void> {
  return save_coordinator.resetWorld(context);
}
async function handle(message: WorkerMessage) {
  const received =
    message.type === "snapshot"
      ? message
      : message.type === "paused"
        ? message.snapshot
        : undefined;
  if (received?.packedBodies && !received.packedMotion) {
    received.bodies = unpackBodies(received.packedBodies);
    delete received.packedBodies;
  }
  switch (message.type) {
    case "paused":
      snapshot = message.snapshot;
      view.receive(message.snapshot);
      if (session.photoPending) {
        session.photoReady();
        snapshot = message.snapshot;
        view.rig.photo(view.camera);
        document.body.classList.add("photo");
        $("photoToolbar").hidden = false;
        $<HTMLInputElement>("photoFov").value = String(view.rig.fov);
        $("photoStatus").textContent = "";
      }
      break;
    case "contactSound":
      audio.contact(message);
      break;
    case "settlementEvent":
      audio.settlement(message.p, message.kind);
      break;
    case "monsterEvent":
      audio.monster(message.p, message.kind);
      if (message.kind === "defeat")
        view.fragment({
          type: "fragments",
          p: message.p,
          origin: message.p,
          material: "foliage",
          seed: Math.floor(performance.now()),
          count: 100,
          speed: 40,
          spread: 12,
        });
      break;
    case "ready":
      audio.reset();
      resetFrameStats();
      view.reset(
        new Float32Array(message.heights),
        message.removed,
        message.ruins,
        message.flood,
        message.waterMask,
      );
      const warmingView = view;
      await view.prewarm();
      if (warmingView !== view) return;
      session.loaded();
      send({ type: "nukeYield", value: nukeYield });
      send({ type: "holdTime", hold: !!extras.holdTime });
      send({ type: "monsterCount", value: monsterCount });
      view.effects.fragments.setLimit(COSMETIC_LIMITS[destruction.cosmetics]);
      enterButton.disabled = false;
      $<HTMLButtonElement>("defaultSettings").disabled = false;
      $("enterLabel").textContent = everEntered || hasSave ? "Resume" : "Play";
      $("status").textContent = islandLinkError
        ? `Island link could not open: ${islandLinkError}`
        : "Ready";
      $("intro").textContent = saveEnabled
        ? "World changes are saved in this browser."
        : "World changes are not being saved.";
      $("newWorld").hidden = !hasSave;
      while (pendingReady.length) pendingReady.shift()!();
      break;
    case "snapshot":
      snapshot = message;
      view.receive(message);
      if (message.stats.shots > lastShots) {
        audio.launch(message.plane.p, message.weapon);
      }
      lastShots = message.stats.shots;
      break;
    case "vaporize":
      view.effects.vaporize(message.p, message.radius);
      break;
    case "delta":
      view.delta(message);
      break;
    case "fragments":
      view.fragment(message);
      break;
    case "explosion":
      view.explosion(message);
      audio.explosion(message);
      break;
    case "saved":
      saveCaptures.deliver(message.request, message.save);
      break;
    case "error":
      fatal(
        "The flight simulation was interrupted. Reload to restore your last saved world.",
        message.message,
      );
      break;
    case "resetDone":
      queuedReset = false;
      saveNow(true);
      enter();
      break;
    case "debugResult":
      stepWaiters.shift()?.(message.state);
      break;
  }
}
function consumeIslandLink(): void {
  return island_coordinator.consumeIslandLink(context);
}
function initializeWorld(baseline: IslandBaseline, save?: SaveSnapshot): void {
  return island_coordinator.initializeWorld(context, baseline, save);
}
function replaceIsland(
  baseline: IslandBaseline,
  reload: boolean,
): Promise<void> {
  return island_coordinator.replaceIsland(context, baseline, reload);
}
function newIsland(seed?: number): Promise<void> {
  return island_coordinator.newIsland(context, seed);
}
function copyIsland(kind: "seed" | "link"): Promise<void> {
  return island_coordinator.copyIsland(context, kind);
}
function load(): Promise<void> {
  return island_coordinator.load(context);
}
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 1 / 60,
    raw = lastTime ? now - lastTime : 16.67;
  lastTime = now;
  if (!view || !session.ready || session.contextLost || document.hidden) return;
  if (!session.active && !session.photoMode && now - lastDraw < 100) return;
  if (session.photoMode) view.rig.move(keys, dt);
  const renderDT = lastDraw ? Math.min((now - lastDraw) / 1000, 0.1) : dt;
  lastDraw = now;
  avgFrame = avgFrame * 0.96 + raw * 0.04;
  if (session.active) {
    input();
    if (debug || extras.showPerf) {
      frameTimes.push(raw);
      if (frameTimes.length > 36000) frameTimes.shift();
    }
    if (now - lastSaveAt > 1000) saveNow();
  }
  try {
    view.render(renderDT, session.active, now);
  } catch (e) {
    fatal("The graphics renderer was interrupted.", String(e));
    return;
  }
  if (!snapshot) return;
  const p = snapshot.plane;
  audio.update(
    p.speed,
    view.camera.position.toArray() as Vec3,
    view.cameraDirection(),
    held("ShiftLeft") || held("ShiftRight"),
  );
  if (p.crashed > 0 && view.rig.mode === "cinematic") {
    view.setChase();
    document.body.classList.remove("cinematic");
  }
  audio.syncLasers(snapshot.lasers, view.camera.position.toArray() as Vec3);
  updateHUD(context, now);
}
$("enter").onclick = enter;
$("pauseButton").onclick = pause;
document.querySelector(".brand")!.addEventListener("click", (e) => {
  e.preventDefault();
  pause();
  menu.home();
});
$("newWorld").onclick = () => void newIsland();
$("createIsland").onclick = () => void newIsland();
$("copySeed").onclick = () => void copyIsland("seed");
$("copyIslandLink").onclick = () => void copyIsland("link");
$("reset").onclick = askReset;
$("cancelReset").onclick = () => $<HTMLDialogElement>("confirm").close();
$("confirmReset").onclick = resetWorld;
$("reload").onclick = () => location.reload();
$("perf").hidden = !debug;
function cinematic(): void {
  return input_controller.cinematic(context);
}
function togglePhoto(): void {
  return input_controller.togglePhoto(context);
}
function respawn(): void {
  return input_controller.respawn(context);
}
window.addEventListener("pagehide", () => {
  saveNow(true);
});
window.addEventListener("resize", () => view?.resize());
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  session.recover();
  view?.releaseLostGeometry();
  pause();
  enterButton.disabled = true;
  $("status").textContent = "Graphics interrupted. Waiting for recovery…";
});
canvas.addEventListener("webglcontextrestored", () => {
  // Wait for Three's later event listener to rebuild its context caches.
  setTimeout(async () => {
    const recoveringView = view;
    try {
      await recoveringView.recoverGraphics();
      if (view !== recoveringView) return;
      session.restored();
      enterButton.disabled = false;
      $("status").textContent = "Graphics restored. Your world is preserved.";
    } catch (error) {
      if (view === recoveringView)
        fatal("The graphics renderer could not recover.", String(error));
    }
  });
});
function installDebug() {
  (window as any).lanternVale = {
    get state() {
      return {
        ready: session.ready,
        active: session.active,
        audio: audio.stats,
        cameraMode: view.rig.mode,
        photoPending: session.photoPending,
        saveEnabled,
        snapshot: snapshot?.packedBodies
          ? { ...snapshot, bodies: unpackBodies(snapshot.packedBodies) }
          : snapshot,
        performance: view.performance.stats,
        render: view.stats,
        savedRevision,
      };
    },
    get world() {
      return world;
    },
    get view() {
      return view;
    },
    inspect: (p: number[], target: number[]) => view.inspectCamera(p, target),
    clearInspect: () => view.clearInspect(),
    get samples() {
      return frameTimes.slice();
    },
    get renderer() {
      return view.renderer;
    },
    pause,
    enter,
    cinematic,
    photo: togglePhoto,
    get camera() {
      return {
        position: view.camera.position.toArray(),
        quaternion: view.camera.quaternion.toArray(),
        fov: view.camera.fov,
      };
    },
    send,
    controls: (value: import("../types").InputState) => (debugInput = value),
    laser: (p: Vec3) => send({ type: "debugLaser", p }),
    blast: (p: Vec3, strength?: NukeYield) =>
      send({ type: "debugBlast", p, yield: strength }),
    setPlane: (p: Vec3, yaw = 0, pitch = 0) =>
      send({ type: "debugPlane", p, yaw, pitch }),
    step: (steps: number) =>
      new Promise((resolve) => {
        stepWaiters.push(resolve);
        send({ type: "debugStep", steps });
      }),
    save: async () => {
      await saveNow(true);
      return requestSave();
    },
    snapshot: requestSave,
    terrain: (x: number, z: number) => view.terrain.sample(x, z),
    reset: () =>
      new Promise<void>((resolve) => {
        pendingReady.push(resolve);
        send({ type: "reset" });
      }),
    setQuality: (q: string) => view.setQuality(q),
    loseContext: () =>
      view.renderer.getContext().getExtension("WEBGL_lose_context"),
  };
}
const context = {
  get extras() {
    return extras;
  },
  set extras(value) {
    extras = value;
  },
  get reversedX() {
    return reversedX;
  },
  set reversedX(value) {
    reversedX = value;
  },
  get inverted() {
    return inverted;
  },
  set inverted(value) {
    inverted = value;
  },
  get store() {
    return store;
  },
  get preferences() {
    return preferences;
  },
  get $() {
    return $;
  },
  get sensitivity() {
    return sensitivity;
  },
  set sensitivity(value) {
    sensitivity = value;
  },
  get nukeYield() {
    return nukeYield;
  },
  set nukeYield(value) {
    nukeYield = value;
  },
  get monsterCount() {
    return monsterCount;
  },
  set monsterCount(value) {
    monsterCount = value;
  },
  get view() {
    return view;
  },
  set view(value) {
    view = value;
  },
  get updateRenderDistanceUI() {
    return updateRenderDistanceUI;
  },
  get destruction() {
    return destruction;
  },
  set destruction(value) {
    destruction = value;
  },
  get updateDestructionUI() {
    return updateDestructionUI;
  },
  get updateMonsterCountUI() {
    return updateMonsterCountUI;
  },
  get debug() {
    return debug;
  },
  get send() {
    return send;
  },
  get savePreferences() {
    return savePreferences;
  },
  get applyDestruction() {
    return applyDestruction;
  },
  get resetFrameStats() {
    return resetFrameStats;
  },
  get applyPreferences() {
    return applyPreferences;
  },
  get audio() {
    return audio;
  },
  get saveNow() {
    return saveNow;
  },
  get touch() {
    return touch;
  },
  get debugInput() {
    return debugInput;
  },
  set debugInput(value) {
    debugInput = value;
  },
  get keys() {
    return keys;
  },
  get steerX() {
    return steerX;
  },
  set steerX(value) {
    steerX = value;
  },
  get steerY() {
    return steerY;
  },
  set steerY(value) {
    steerY = value;
  },
  get fireUntil() {
    return fireUntil;
  },
  set fireUntil(value) {
    fireUntil = value;
  },
  get dragging() {
    return dragging;
  },
  set dragging(value) {
    dragging = value;
  },
  get held() {
    return held;
  },
  get session() {
    return session;
  },
  get clearInput() {
    return clearInput;
  },
  get touchControls() {
    return touchControls;
  },
  get pointerFallback() {
    return pointerFallback;
  },
  set pointerFallback(value) {
    pointerFallback = value;
  },
  get canvas() {
    return canvas;
  },
  get togglePhoto() {
    return togglePhoto;
  },
  get respawn() {
    return respawn;
  },
  get pause() {
    return pause;
  },
  get cinematic() {
    return cinematic;
  },
  get altitudeWarning() {
    return altitudeWarning;
  },
  get saveEpoch() {
    return saveEpoch;
  },
  set saveEpoch(value) {
    saveEpoch = value;
  },
  get saveCaptures() {
    return saveCaptures;
  },
  get worker() {
    return worker;
  },
  set worker(value) {
    worker = value;
  },
  get world() {
    return world;
  },
  set world(value) {
    world = value;
  },
  get snapshot() {
    return snapshot;
  },
  set snapshot(value) {
    snapshot = value;
  },
  get everEntered() {
    return everEntered;
  },
  set everEntered(value) {
    everEntered = value;
  },
  get savedRevision() {
    return savedRevision;
  },
  set savedRevision(value) {
    savedRevision = value;
  },
  get lastSavedHour() {
    return lastSavedHour;
  },
  set lastSavedHour(value) {
    lastSavedHour = value;
  },
  get enterButton() {
    return enterButton;
  },
  get handle() {
    return handle;
  },
  get fatal() {
    return fatal;
  },
  get installDebug() {
    return installDebug;
  },
  get islandChanging() {
    return islandChanging;
  },
  set islandChanging(value) {
    islandChanging = value;
  },
  get saveEnabled() {
    return saveEnabled;
  },
  set saveEnabled(value) {
    saveEnabled = value;
  },
  get consumeIslandLink() {
    return consumeIslandLink;
  },
  get hasSave() {
    return hasSave;
  },
  set hasSave(value) {
    hasSave = value;
  },
  get initializeWorld() {
    return initializeWorld;
  },
  get islandPreview() {
    return islandPreview;
  },
  get replaceIsland() {
    return replaceIsland;
  },
  get islandLinkError() {
    return islandLinkError;
  },
  set islandLinkError(value) {
    islandLinkError = value;
  },
  get frame() {
    return frame;
  },
  get newIsland() {
    return newIsland;
  },
  get queuedReset() {
    return queuedReset;
  },
  set queuedReset(value) {
    queuedReset = value;
  },
  get lastSaveAt() {
    return lastSaveAt;
  },
  set lastSaveAt(value) {
    lastSaveAt = value;
  },
  get saveNoticeTimer() {
    return saveNoticeTimer;
  },
  set saveNoticeTimer(value) {
    saveNoticeTimer = value;
  },
  get saveWriter() {
    return saveWriter;
  },
  get lastHUD() {
    return lastHUD;
  },
  set lastHUD(value) {
    lastHUD = value;
  },
  get lastPerfSummary() {
    return lastPerfSummary;
  },
  set lastPerfSummary(value) {
    lastPerfSummary = value;
  },
  get frameTimes() {
    return frameTimes;
  },
  get perfSummary() {
    return perfSummary;
  },
  set perfSummary(value) {
    perfSummary = value;
  },
  get avgFrame() {
    return avgFrame;
  },
  set avgFrame(value) {
    avgFrame = value;
  },
};
updateDestructionUI();
settings.bind(context);
input_controller.bind(context);
void load();
