import { CONFIG, BLAST_DEBRIS_LIMIT, BLAST_COSMETIC_LIMIT } from "./config";
import { AltitudeWarning } from "./altitude-warning";
import { SaveCaptureCoordinator } from "./save-capture";
import { SaveWriter } from "./save-writer";
import { unpackBodies } from "./sim/body-buffer";
import { IslandPreview } from "./world/preview";
import {
  seedCode,
  parseSeedCode,
  islandLink,
  type IslandBaseline,
} from "./world/generator.mjs";
import { normalizePreferences } from "./preferences";
import { discoActive } from "./disco";
import {
  DEFAULT_DESTRUCTION,
  fixedDestruction,
  COSMETIC_LIMITS,
} from "./destruction-settings";
import "./style.css";
import { bindTouchControls, pointerSteering } from "./input";
import { frameStats } from "./frame-stats";
import { GameRenderer } from "./render/renderer";
import { GameAudio } from "./audio";
import { createPhotoSaveAction } from "./photo-save";
import { SaveStore, compatible } from "./storage";
import {
  clamp,
  DEFAULT_MONSTER_COUNT,
  LASER,
  normalizeMonsterCount,
  normalizeRenderDistance,
  WEAPONS,
  RAPID_FIRE_INTERVAL,
} from "./config";
import type {
  WorldData,
  SaveSnapshot,
  GameCommand,
  WorkerMessage,
  SimulationSnapshot,
  Vec3,
  Preferences,
  NukeYield,
} from "./types";
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
  active = false,
  ready = false,
  everEntered = false,
  contextLost = false,
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
let photoPending = false,
  photoMode = false,
  photoReturn = false;
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
let debugInput: import("./types").InputState | undefined;
const saveCaptures = new SaveCaptureCoordinator();
const stepWaiters: ((value: unknown) => void)[] = [];
const pendingReady: (() => void)[] = [];
const touchControls = $("touchControls");
const touchDevice = matchMedia("(any-pointer: coarse)");
const touch = bindTouchControls(touchControls, () => active, preferences);
const held = (key: string) => keys.has(key) || touch.keys.has(key);
function preferences(): Preferences {
  return {
    ...extras,
    reverseX: reversedX,
    reverseY: inverted,
    sensitivity,
    nukeYield,
    monsterCount,
    destruction,
  };
}
function savePreferences() {
  store.writePreferences(preferences()).catch(() => {
    $("status").textContent =
      "Settings apply for this session; storage is unavailable.";
  });
}
function applyPreferences(p: Preferences) {
  extras = normalizePreferences(p);
  reversedX = p.reverseX;
  inverted = p.reverseY;
  sensitivity = p.sensitivity;
  nukeYield = p.nukeYield;
  monsterCount = extras.monsterCount ?? DEFAULT_MONSTER_COUNT;
  view?.setRenderDistance(extras.renderDistance!);
  updateRenderDistanceUI();
  view?.setGooglyEyes(extras.googlyEyes === true);
  destruction = fixedDestruction(p.destruction);
  updateDestructionUI();
  $<HTMLInputElement>("reverseX").checked = reversedX;
  $<HTMLInputElement>("invert").checked = inverted;
  $<HTMLInputElement>("sensitivity").value = String(sensitivity);
  updateMonsterCountUI();
  for (const id of [
    "reduceEffects",
    "googlyEyes",
    "reduceShake",
    "mute",
    "showPerf",
    "holdTime",
  ] as const)
    $<HTMLInputElement>(id).checked = !!extras[id];
  $<HTMLInputElement>("volume").value = String(extras.volume);
  $<HTMLSelectElement>("quality").value = extras.quality!;
  $("perf").hidden = !(extras.showPerf || debug);
}
function updateMonsterCountUI() {
  $<HTMLInputElement>("monsterCount").value = String(monsterCount);
  $("monsterCountValue").textContent =
    monsterCount === 0 ? "Off" : String(monsterCount);
}
function updateRenderDistanceUI() {
  const input = $<HTMLInputElement>("renderDistance");
  input.value = String(extras.renderDistance);
  input.setAttribute(
    "aria-valuetext",
    `${extras.renderDistance!.toLocaleString()} meters`,
  );
  $("renderDistanceValue").textContent =
    `${extras.renderDistance!.toLocaleString()} m`;
}
function updateDestructionUI() {
  $<HTMLInputElement>("noCooldown").checked = destruction.noCooldown;
}
function applyDestruction() {
  destruction = fixedDestruction(destruction);
  updateDestructionUI();
  view?.effects.fragments.setLimit(COSMETIC_LIMITS[destruction.cosmetics]);
  send({ type: "destructionSettings", value: destruction });
  savePreferences();
}
function send(message: GameCommand, transfer: Transferable[] = []) {
  worker?.postMessage(message, transfer);
}
function fatal(message: string, detail = "") {
  ready = false;
  saveEpoch++;
  saveCaptures.retire();
  saveWriter.close();
  pause();
  enterButton.disabled = true;
  $("fatalMessage").textContent = message;
  $("fatalDetails").textContent = detail;
  $("fatal").hidden = false;
}
function clearInput() {
  touch.reset();
  debugInput = undefined;
  keys.clear();
  steerX = steerY = 0;
  fireUntil = 0;
  dragging = false;
  send({
    type: "input",
    input: { x: 0, y: 0, throttle: 0, bank: 0, boost: false, fire: false },
  });
}
function pause() {
  touchControls.hidden = true;
  photoPending = photoMode = false;
  view?.setChase();
  document.body.classList.remove("cinematic", "photo");
  $("photoToolbar").hidden = true;
  active = false;
  $("ceilingWarning").hidden = true;
  clearInput();
  send({ type: "pause", paused: true });
  audio.pause();
  if (everEntered) {
    $("overlay").hidden = false;
    $("flightHUD").hidden = true;
    $("pauseButton").hidden = true;
    $("title").textContent = "Paused";
    $("intro").textContent = saveEnabled
      ? "World changes are saved in this browser."
      : "World changes are not being saved.";
    $("enterLabel").textContent = "Resume";
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
  if (!ready || contextLost) return;
  resetFrameStats();
  view.resumeSnapshots();
  everEntered = active = true;
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
function input() {
  if (debug && debugInput) {
    send({ type: "input", input: debugInput });
    return;
  }
  send({
    type: "input",
    input: {
      x: clamp(steerX + touch.steering.x, -1, 1),
      y: clamp(steerY + touch.steering.y, -1, 1),
      throttle: (held("KeyW") ? 1 : 0) - (held("KeyS") ? 1 : 0),
      bank: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
      boost: held("ShiftLeft") || held("ShiftRight"),
      fire:
        keys.has("Mouse0") || held("Space") || performance.now() < fireUntil,
    },
  });
}
function requestSave() {
  return saveCaptures.request((request) => send({ type: "save", request }));
}
async function saveNow(force = false) {
  if (
    !ready ||
    !saveEnabled ||
    saveCaptures.saving ||
    !snapshot ||
    queuedReset ||
    islandChanging
  )
    return;
  if (
    !force &&
    snapshot.stats.revision === savedRevision &&
    Math.abs(snapshot.hour - lastSavedHour) < 0.05
  )
    return;
  const epoch = saveEpoch;
  const owner = saveCaptures.begin();
  lastSaveAt = performance.now();
  clearTimeout(saveNoticeTimer);
  $("saveStatus").style.opacity = "1";
  $("saveStatus").textContent = "Saving world…";
  try {
    const save = await saveWriter.capture((port) =>
      worker.postMessage(
        { type: "save", request: 0, port } satisfies GameCommand,
        [port],
      ),
    );
    if (epoch !== saveEpoch) return;
    if (save.capture !== undefined)
      send({ type: "saveAck", capture: save.capture });
    savedRevision = save.revision;
    lastSavedHour = save.hour;
    hasSave = true;
    $("saveStatus").textContent = "World saved";
    saveNoticeTimer = window.setTimeout(() => {
      $("saveStatus").style.opacity = "0";
    }, 2000);
  } catch (e) {
    if (epoch !== saveEpoch) return;
    saveEnabled = false;
    $("saveStatus").classList.add("save-error");
    $("saveStatus").textContent = "Not saving · browser storage is unavailable";
    $("status").textContent =
      "Flight is available, but your changes cannot be saved. " + String(e);
  } finally {
    saveCaptures.finish(owner);
  }
}
function askReset() {
  pause();
  $<HTMLDialogElement>("confirm").showModal();
}
async function resetWorld() {
  queuedReset = true;
  saveEpoch++;
  saveCaptures.retire();
  enterButton.disabled = true;
  $("enterLabel").textContent = "Resetting world…";
  $<HTMLDialogElement>("confirm").close();
  savedRevision = -1;
  lastSavedHour = -1;
  try {
    if (saveEnabled) await store.clear();
  } catch {
    saveEnabled = false;
  }
  send({ type: "reset" });
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
      if (photoPending) {
        photoPending = false;
        photoMode = true;
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
      ready = true;
      $("assetNotice").hidden = !view.assetStatus.failures.length;
      $("assetNotice").textContent = view.assetStatus.failures.length
        ? `Some visual assets could not load (${view.assetStatus.failures.join(", ")}). Reload to retry; your island is preserved.`
        : "";
      send({ type: "nukeYield", value: nukeYield });
      send({ type: "holdTime", hold: !!extras.holdTime });
      send({ type: "monsterCount", value: monsterCount });
      view.effects.fragments.setLimit(COSMETIC_LIMITS[destruction.cosmetics]);
      enterButton.disabled = false;
      $<HTMLButtonElement>("defaultSettings").disabled = false;
      $("enterLabel").textContent = everEntered
        ? "Resume"
        : hasSave
          ? "Continue"
          : "Start";
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
function consumeIslandLink() {
  const url = new URL(location.href);
  url.searchParams.delete("island");
  history.replaceState(null, "", url);
}
function initializeWorld(baseline: IslandBaseline, save?: SaveSnapshot) {
  altitudeWarning.reset();
  saveEpoch++;
  saveCaptures.retire();
  worker?.terminate();
  view?.dispose();
  audio.reset();
  world = baseline.world;
  snapshot = undefined;
  ready = false;
  active = false;
  everEntered = false;
  contextLost = false;
  savedRevision = -1;
  lastSavedHour = -1;
  enterButton.disabled = true;
  $("enterLabel").textContent = "Loading island…";
  $("currentSeed").setAttribute(
    "value",
    seedCode(world.seed, world.generatorVersion),
  );
  $<HTMLInputElement>("currentSeed").value = seedCode(
    world.seed,
    world.generatorVersion,
  );
  view = new GameRenderer(canvas, world, baseline.heights.slice(), (s) => {
    if (
      s.epoch !== undefined &&
      s.slot !== undefined &&
      s.packedBodies &&
      s.packedMotion
    )
      send(
        {
          type: "recycleMotion",
          epoch: s.epoch,
          slot: s.slot,
          bodies: s.packedBodies.buffer,
          actors: s.packedMotion.buffer,
        },
        [s.packedBodies.buffer, s.packedMotion.buffer],
      );
  });
  view.setQuality(extras.quality!);
  view.setRenderDistance(extras.renderDistance!);
  view.setReducedEffects(!!extras.reduceEffects);
  view.setGooglyEyes(extras.googlyEyes === true);
  view.setShake(!extras.reduceShake);
  audio.setVolume(extras.volume!);
  audio.setMute(!!extras.mute);
  worker = new Worker(new URL("./sim/worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => handle(event.data);
  worker.onerror = (e) =>
    fatal("The simulation worker could not start.", e.message);
  const terrainBytes = baseline.heights.slice().buffer;
  send(
    {
      type: "init",
      world,
      heights: terrainBytes,
      save,
      debug,
      destruction,
      monsterCount,
    },
    [terrainBytes],
  );
  if (debug) installDebug();
}
async function replaceIsland(baseline: IslandBaseline, reload: boolean) {
  islandChanging = true;
  try {
    const deadline = performance.now() + 5000;
    while (saveCaptures.saving) {
      if (performance.now() > deadline)
        throw Error("A save is still in progress. Try New island again.");
      await new Promise((r) => setTimeout(r, 20));
    }
    saveEpoch++;
    if (saveEnabled) await store.replaceBaseline(baseline);
    consumeIslandLink();
    hasSave = false;
    if (saveEnabled && reload) {
      location.reload();
      return;
    }
    initializeWorld(baseline);
  } finally {
    if (!reload || !saveEnabled) islandChanging = false;
  }
}
async function newIsland(seed?: number) {
  if (islandPreview.dialog.open || islandChanging) return;
  pause();
  const candidate = await islandPreview.choose(seed, !!view, true);
  if (!candidate) {
    consumeIslandLink();
    return;
  }
  try {
    await replaceIsland(candidate, true);
  } catch (error) {
    islandChanging = false;
    $("status").textContent = `Island was not replaced: ${String(error)}`;
  }
}
async function copyIsland(kind: "seed" | "link") {
  if (!world) return;
  const code = seedCode(world.seed, world.generatorVersion),
    text = kind === "seed" ? code : islandLink(code, location.href);
  try {
    await navigator.clipboard.writeText(text);
    $("shareFallback").hidden = true;
    $("islandShareStatus").textContent =
      kind === "seed"
        ? "Seed copied."
        : "Island link copied. Damage and progress stay private.";
  } catch {
    const field = $<HTMLInputElement>("shareFallback");
    field.hidden = false;
    field.value = text;
    field.focus();
    field.select();
    $("islandShareStatus").textContent = "Select and copy the text below.";
  }
}
async function load() {
  try {
    let stored: SaveSnapshot | undefined,
      baseline: IslandBaseline | undefined,
      baselineIssue = false;
    try {
      await store.open();
      applyPreferences((await store.preferences()) || normalizePreferences());
      await store.writePreferences(preferences()).catch(() => {
        $("status").textContent =
          "Settings apply for this session; preference storage is unavailable.";
      });
      stored = await store.load();
      try {
        baseline = await store.baseline();
      } catch (error) {
        baselineIssue = true;
        $("status").textContent = String(error);
      }
    } catch (error) {
      saveEnabled = false;
      $("saveStatus").textContent = "Local saving unavailable · session only";
      console.warn("Local save unavailable", error);
    }
    let linkedSeed: number | undefined,
      linkError = "";
    const code = new URLSearchParams(location.search).get("island");
    if (code !== null) {
      try {
        linkedSeed = parseSeedCode(code);
      } catch (error) {
        linkError = (error as Error).message;
        islandLinkError = linkError;
        consumeIslandLink();
      }
    }
    let save: SaveSnapshot | undefined;
    if (
      baseline &&
      (!stored ||
        compatible(
          stored,
          baseline.world.version,
          baseline.world.seed,
          baseline.world.generatorVersion,
        ))
    ) {
      save = stored;
      hasSave = !!save;
    } else {
      if (stored || baselineIssue) {
        const action = await new Promise<"temporary" | "replace">((resolve) => {
          $<HTMLDialogElement>("recovery").oncancel = (e) => e.preventDefault();
          $<HTMLDialogElement>("recovery").showModal();
          $("temporary").onclick = () => resolve("temporary");
          $("replaceSave").onclick = () => resolve("replace");
        });
        $<HTMLDialogElement>("recovery").close();
        if (action === "temporary") {
          saveEnabled = false;
          $("saveStatus").textContent =
            "Temporary island · existing save untouched";
        }
      }
      baseline = (await islandPreview.choose(
        linkedSeed,
        false,
        saveEnabled && (!!stored || baselineIssue),
        linkError,
      )) as IslandBaseline;
      if (saveEnabled) {
        try {
          await store.replaceBaseline(baseline);
        } catch (error) {
          if (stored || baselineIssue) throw error;
          saveEnabled = false;
          $("saveStatus").textContent =
            "Island could not be saved · temporary play";
        }
      }
      consumeIslandLink();
      linkedSeed = undefined;
    }
    initializeWorld(baseline, save);
    requestAnimationFrame(frame);
    if (linkError) $("islandShareStatus").textContent = linkError;
    if (linkedSeed !== undefined) await newIsland(linkedSeed);
  } catch (error) {
    islandChanging = false;
    fatal(
      "The island could not load. Your previous save has been preserved.",
      String(error),
    );
  }
}
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 1 / 60,
    raw = lastTime ? now - lastTime : 16.67;
  lastTime = now;
  if (!view || !ready || contextLost || document.hidden) return;
  if (!active && !photoMode && now - lastDraw < 100) return;
  if (photoMode) view.rig.move(keys, dt);
  const renderDT = lastDraw ? Math.min((now - lastDraw) / 1000, 0.1) : dt;
  lastDraw = now;
  avgFrame = avgFrame * 0.96 + raw * 0.04;
  if (active) {
    input();
    if (debug || extras.showPerf) {
      frameTimes.push(raw);
      if (frameTimes.length > 36000) frameTimes.shift();
    }
    if (now - lastSaveAt > 1000) saveNow();
  }
  try {
    view.render(renderDT, active, now);
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
    view.ambience(),
  );
  if (p.crashed > 0 && view.rig.mode === "cinematic") {
    view.setChase();
    document.body.classList.remove("cinematic");
  }
  audio.syncLasers(snapshot.lasers, view.camera.position.toArray() as Vec3);
  audio.syncDisco(active && discoActive(snapshot.lasers), snapshot.time);
  if (now - lastHUD > 160) {
    $("speed").textContent = Math.round(p.speed).toString();
    $("altitude").textContent = Math.max(
      0,
      Math.round(p.p[1] - view.terrain.sample(p.p[0], p.p[2])),
    ).toString();
    if (p.crashed > 0) altitudeWarning.reset();
    const ceilingMessage = altitudeWarning.update(p.p[1]);
    $("ceilingWarning").hidden = !active || p.crashed > 0 || !ceilingMessage;
    $("ceilingWarning").textContent = ceilingMessage
      ? `${ceilingMessage} · ${Math.round(p.p[1])} M ABOVE SEA LEVEL · LIMIT ${CONFIG.ceiling} M`
      : "";
    $("throttleFill").style.height =
      clamp(((p.speed - 35) / 85) * 100, 5, 100) + "%";
    $("clock").textContent =
      `${String(Math.floor(snapshot.hour)).padStart(2, "0")}:${String(Math.floor((snapshot.hour % 1) * 60)).padStart(2, "0")}`;
    const label = {
      local: "Local",
      castle: "Castle-leveling",
      valley: "Valley-scale",
    }[snapshot.nukeYield];
    $("weaponName").textContent =
      snapshot.weapon === "nuke"
        ? `PINEAPPLE NUKE · ${label} · ${destruction.nukeScale}×`
        : snapshot.weapon === "laser"
          ? "SPACE LASER · ORBITAL EXCAVATION"
          : "PINEAPPLE CANNON";
    const cooldown = snapshot.cooldowns[snapshot.weapon];
    const strike =
      snapshot.weapon === "laser"
        ? (snapshot.lasers.find((l) => l.phase === "burning") ??
          snapshot.lasers.find((l) => l.phase === "charging") ??
          snapshot.lasers[0])
        : undefined;
    $("weaponStatus").textContent = strike
      ? (strike.phase === "charging"
          ? `CHARGING · ${Math.max(0, LASER.charge - strike.age).toFixed(1)} S`
          : strike.phase === "burning"
            ? `FIRING · ${Math.max(0, LASER.charge + LASER.beam - strike.age).toFixed(1)} S`
            : "EXCAVATING") +
        (snapshot.lasers.length > 1
          ? ` · ${snapshot.lasers.length} STRIKES`
          : "")
      : snapshot.weapon === "laser" && !snapshot.aim && cooldown <= 0.01
        ? "NO TARGET · AIM AT A SURFACE"
        : cooldown > 0.01
          ? `READY IN ${cooldown.toFixed(1)} S`
          : !destruction.noCooldown &&
              snapshot.weapon === "nuke" &&
              snapshot.stats.pendingJobs +
                snapshot.projectiles.filter((p) => p.weapon === "nuke")
                  .length >=
                8
            ? "PROCESSING DAMAGE"
            : destruction.noCooldown
              ? "READY · 0.1 S"
              : "READY";
    $("cooldownFill").style.width =
      `${100 * Math.max(0, 1 - cooldown / (destruction.noCooldown ? RAPID_FIRE_INTERVAL : WEAPONS[snapshot.weapon].cooldown))}%`;
    for (const weapon of ["cannon", "nuke", "laser"]) {
      const button = $("select-" + weapon);
      button.classList.toggle("selected", snapshot.weapon === weapon);
      button.setAttribute("aria-pressed", String(snapshot.weapon === weapon));
    }
    const castle = world.castles?.find(
      (c) =>
        p.p[0] >= c.bounds.min[0] &&
        p.p[0] <= c.bounds.max[0] &&
        p.p[2] >= c.bounds.min[1] &&
        p.p[2] <= c.bounds.max[1],
    );
    $("region").textContent = castle
      ? castle.grand
        ? "GRAND CASTLE"
        : "CASTLE"
      : p.p[1] > 240
        ? "HIGH ALTITUDE"
        : "ISLAND";
    $("damage").textContent = snapshot.stats.removed
      ? `Objects destroyed: ${snapshot.stats.removed}`
      : "Objects destroyed: 0";
    $("monstersRemaining").textContent =
      `Monsters: ${snapshot.monsters.filter((m) => !m.defeated).length}/${snapshot.monsterCount}`;
    const population = snapshot.population;
    $("populationTotal").textContent = String(population.alive);
    $("happinessValue").textContent = `${population.happiness} / 100`;
    $("warning").hidden = !active || (!p.boundary && p.crashed <= 0);
    $("warning").textContent =
      p.crashed > 0
        ? "CRASHED · RESPAWNING"
        : p.boundary
          ? "MAP BOUNDARY · TURNING BACK"
          : "";
    if (
      (debug || extras.showPerf) &&
      now - lastPerfSummary > 1000 &&
      frameTimes.length
    ) {
      const stats = frameStats(frameTimes);
      const low =
        stats.lowFPS === undefined
          ? "warming up"
          : `${stats.lowFPS.toFixed(1)} FPS`;
      perfSummary = `\nFrame median ${stats.medianMS.toFixed(1)} ms · p95 ${stats.p95MS.toFixed(1)} ms\n1% low ${low} · worst ${stats.worstMS.toFixed(1)} ms`;
      lastPerfSummary = now;
    }
    const r = view.stats;
    $("perf").textContent =
      `${Math.round(1000 / avgFrame)} FPS · ${r.width} × ${r.height}\n${snapshot.packedBodies?.count ?? snapshot.bodies.length}/${BLAST_DEBRIS_LIMIT} wreckage · ${snapshot.stats.ballistic} flying pieces\n${r.fragments}/${BLAST_COSMETIC_LIMIT} cosmetic chunks\nPhysics ${snapshot.stats.physicsMS.toFixed(1)} ms · ${r.drawCalls} draws\n${Math.round(r.triangles / 1000)}k triangles · revision ${snapshot.stats.revision}\nDestruction ${snapshot.stats.destructionMS.toFixed(1)} ms · ${snapshot.stats.pendingJobs} jobs${perfSummary}\nQuality ${view.visualProfile.name} · simulation ${view.performance.queues.simulationRatio?.toFixed(3) ?? "—"}×\nTextures ${((view.performance.queues.residentTextureBytes ?? 0) / 1048576).toFixed(1)} MiB · targets ${((view.performance.queues.renderTargetBytes ?? 0) / 1048576).toFixed(1)} MiB`;
    lastHUD = now;
  }
}
updateDestructionUI();
$<HTMLInputElement>("noCooldown").onchange = (e) => {
  destruction.noCooldown = (e.target as HTMLInputElement).checked;
  applyDestruction();
};
$("defaultSettings").onclick = () => {
  resetFrameStats();
  applyPreferences(normalizePreferences());
  view?.setQuality(extras.quality!);
  view?.setReducedEffects(!!extras.reduceEffects);
  view?.setShake(!extras.reduceShake);
  audio.setVolume(extras.volume!);
  audio.setMute(!!extras.mute);
  $("perf").hidden = !extras.showPerf;
  send({ type: "nukeYield", value: nukeYield });
  send({ type: "holdTime", hold: !!extras.holdTime });
  send({ type: "monsterCount", value: monsterCount });
  $<HTMLInputElement>("time").value = "15.5";
  send({ type: "hour", hour: 15.5 });
  $("status").textContent =
    "Settings reset to defaults. World damage preserved.";
  applyDestruction();
  void saveNow(true);
};
$<HTMLInputElement>("monsterCount").oninput = (event) => {
  monsterCount = normalizeMonsterCount(
    Number((event.target as HTMLInputElement).value),
  );
  extras.monsterCount = monsterCount;
  updateMonsterCountUI();
  send({ type: "monsterCount", value: monsterCount });
  savePreferences();
};
$("enter").onclick = enter;
$("pauseButton").onclick = pause;
document.querySelector(".brand")!.addEventListener("click", (e) => {
  e.preventDefault();
  pause();
});
$("newWorld").onclick = () => void newIsland();
$("createIsland").onclick = () => void newIsland();
$("copySeed").onclick = () => void copyIsland("seed");
$("copyIslandLink").onclick = () => void copyIsland("link");
$("reset").onclick = askReset;
$("cancelReset").onclick = () => $<HTMLDialogElement>("confirm").close();
$("confirmReset").onclick = resetWorld;
$("reload").onclick = () => location.reload();
$<HTMLSelectElement>("quality").onchange = (e) => {
  resetFrameStats();
  extras.quality = (e.target as HTMLSelectElement).value;
  view?.setQuality(extras.quality);
  savePreferences();
};
$<HTMLInputElement>("renderDistance").oninput = (e) => {
  extras.renderDistance = normalizeRenderDistance(
    Number((e.target as HTMLInputElement).value),
  );
  view?.setRenderDistance(extras.renderDistance);
  updateRenderDistanceUI();
  resetFrameStats();
  savePreferences();
};
$<HTMLInputElement>("sensitivity").oninput = (e) => {
  sensitivity = +(e.target as HTMLInputElement).value;
  savePreferences();
};
$<HTMLInputElement>("invert").onchange = (e) => {
  inverted = (e.target as HTMLInputElement).checked;
  savePreferences();
};
$<HTMLInputElement>("reverseX").onchange = (e) => {
  reversedX = (e.target as HTMLInputElement).checked;
  savePreferences();
};
for (const id of [
  "reduceEffects",
  "googlyEyes",
  "reduceShake",
  "mute",
  "showPerf",
  "holdTime",
] as const) {
  $<HTMLInputElement>(id).onchange = (e) => {
    if (id === "showPerf") resetFrameStats();
    extras[id] = (e.target as HTMLInputElement).checked;
    view?.setReducedEffects(!!extras.reduceEffects);
    view?.setGooglyEyes(extras.googlyEyes === true);
    view?.setShake(!extras.reduceShake);
    audio.setMute(!!extras.mute);
    $("perf").hidden = !extras.showPerf;
    send({ type: "holdTime", hold: !!extras.holdTime });
    savePreferences();
  };
}
$<HTMLInputElement>("time").oninput = (e) =>
  send({ type: "hour", hour: +(e.target as HTMLInputElement).value });
$<HTMLInputElement>("volume").oninput = (e) => {
  extras.volume = +(e.target as HTMLInputElement).value;
  audio.setVolume(extras.volume);
  savePreferences();
};
$("perf").hidden = !debug;
function cinematic() {
  if (!active) return;
  view.toggleCinematic();
  document.body.classList.toggle("cinematic", view.rig.mode === "cinematic");
  $("hint").textContent =
    view.rig.mode === "cinematic"
      ? "C: Chase view"
      : "C: Cinematic view · P: Photo mode";
  $("hint").hidden = false;
  $("hint").style.opacity = "1";
  setTimeout(() => ($("hint").style.opacity = "0"), 2500);
}
function togglePhoto() {
  if (photoPending) return;
  if (photoMode) {
    photoMode = false;
    view.rig.exitPhoto();
    view.setPhotoExposure(1.15);
    view.setPhotoFocus(0);
    $<HTMLInputElement>("photoExposure").value = "1.15";
    $<HTMLInputElement>("photoFocus").value = "0";
    document.body.classList.remove("photo");
    $("photoToolbar").hidden = true;
    clearInput();
    if (photoReturn) {
      resetFrameStats();
      view.resumeSnapshots();
      active = true;
      send({ type: "pause", paused: false });
      audio.start().catch(() => {});
    }
    document.body.classList.toggle("cinematic", view.rig.mode === "cinematic");
    touchControls.hidden = !active;
    if (!pointerFallback && document.pointerLockElement !== canvas)
      canvas.requestPointerLock().catch(() => {
        pointerFallback = true;
      });
    return;
  }
  if (!active) return;
  photoReturn = active;
  photoPending = true;
  touchControls.hidden = true;
  active = false;
  $("ceilingWarning").hidden = true;
  clearInput();
  send({ type: "pause", paused: true });
  audio.pause();
  $("hint").hidden = true;
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}
$("exitPhoto").onclick = togglePhoto;
$("hidePhoto").onclick = () => ($("photoToolbar").hidden = true);
$<HTMLInputElement>("photoFov").oninput = (e) =>
  (view.rig.fov = +(e.target as HTMLInputElement).value);
$<HTMLInputElement>("photoExposure").oninput = (e) =>
  view?.setPhotoExposure(Number((e.target as HTMLInputElement).value));
$<HTMLInputElement>("photoFocus").oninput = (e) =>
  view?.setPhotoFocus(Number((e.target as HTMLInputElement).value));
$("savePhoto").onclick = createPhotoSaveAction(
  $<HTMLButtonElement>("savePhoto"),
  $("photoStatus"),
  () => view.capture(),
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
  $("select-" + weapon).onclick = () => {
    if (active) send({ type: "weapon", weapon });
  };
function respawn() {
  if (!active) return;
  clearInput();
  view.setChase();
  document.body.classList.remove("cinematic");
  send({ type: "respawn" });
}
$("touchRespawn").onclick = respawn;
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    pause();
    return;
  }
  if (e.repeat && ["KeyP", "KeyC", "KeyH"].includes(e.code)) return;
  if (e.code === "KeyP" && (active || photoMode)) {
    e.preventDefault();
    togglePhoto();
    return;
  }
  if (photoMode) {
    if (e.code === "KeyH") $("photoToolbar").hidden = !$("photoToolbar").hidden;
    if (!["INPUT", "BUTTON"].includes((e.target as HTMLElement).tagName)) {
      e.preventDefault();
      keys.add(e.code);
    }
    return;
  }
  if (!active) return;
  if (e.code === "KeyC") {
    e.preventDefault();
    cinematic();
    return;
  }
  if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") {
    e.preventDefault();
    send({
      type: "weapon",
      weapon:
        e.code === "Digit1" ? "cannon" : e.code === "Digit2" ? "nuke" : "laser",
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
    keys.add(e.code);
    if (e.code === "Space") fireUntil = performance.now() + 100;
    if (e.code === "KeyR" && !e.repeat) respawn();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") return;
  if (photoMode) {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (!active) return;
  dragging = true;
  if (document.pointerLockElement !== canvas)
    canvas.setPointerCapture(e.pointerId);
  if (!pointerFallback && e.button === 0) {
    keys.add("Mouse0");
    fireUntil = performance.now() + 100;
  }
});
window.addEventListener("pointerup", (e) => {
  if (e.pointerType === "touch") return;
  dragging = false;
  keys.delete("Mouse0");
});
window.addEventListener("mousemove", (e) => {
  if (photoMode) {
    if (dragging || document.pointerLockElement === canvas)
      view.rig.look(e.movementX, e.movementY);
    return;
  }
  if (!active || (document.pointerLockElement !== canvas && !dragging)) return;
  const steering = pointerSteering(
    steerX,
    steerY,
    e.movementX,
    e.movementY,
    preferences(),
  );
  steerX = steering.x;
  steerY = steering.y;
});
canvas.addEventListener("dblclick", () => {
  steerX = steerY = 0;
});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== canvas && active && !pointerFallback)
    pause();
});
document.addEventListener("pointerlockerror", () => {
  pointerFallback = true;
  $("status").textContent = "Hold and drag to steer; Space fires.";
});
window.addEventListener("blur", pause);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
window.addEventListener("pagehide", () => {
  saveNow(true);
});
window.addEventListener("resize", () => view?.resize());
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  contextLost = true;
  view?.releaseLostGeometry();
  pause();
  enterButton.disabled = true;
  $("status").textContent = "Graphics interrupted. Waiting for recovery…";
});
canvas.addEventListener("webglcontextrestored", () => {
  queueMicrotask(async () => {
    const recoveringView = view;
    try {
      await recoveringView.recoverGraphics();
      if (view !== recoveringView) return;
      contextLost = false;
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
        ready,
        active,
        audio: audio.stats,
        cameraMode: view.rig.mode,
        photoPending,
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
    controls: (value: import("./types").InputState) => (debugInput = value),
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
load();
