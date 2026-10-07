import { GameAudio } from "./audio";
import { discoActive } from "./disco";
import { checkStorage } from "./storage-checks";
import { CONFIG, LASER } from "./config";
import { pathIndex } from "./world/generator.mjs";
import { GameRenderer } from "./render/renderer";
import { loadTerrain } from "./world-loader";
import { SaveStore, compatible } from "./storage";
import { SaveWriter } from "./save-writer";
import { frameStats } from "./frame-stats";
import { DEFAULT_DESTRUCTION } from "./destruction-settings";
import {
  harborDockReviewCamera,
  loggingCampReviewCamera,
  quarryHoistOwner,
  quarryHoistReviewCamera,
  warehouseCargoReviewCamera,
  warehouseStagingSpot,
  watchtowerBeaconReviewCamera,
  waterwheelRotors,
  windmillRotors,
} from "./render/landmark-geometry";
import { riverBendReviewCamera } from "./render/river-view";
import type {
  GameCommand,
  Vec3,
  Explosion,
  LaserStrike,
  WorkerMessage,
  SimulationSnapshot,
  WorldData,
} from "./types";
const canvas = document.querySelector<HTMLCanvasElement>("#world")!,
  status = document.querySelector("#status")!,
  report = document.querySelector<HTMLElement>("#report")!;
async function baseline() {
  const code = new URL(location.href).searchParams.get("seed");
  if (code === null) {
    const world: WorldData = await (await fetch("./world.json")).json();
    return { world, heights: await loadTerrain(world, "./") };
  }
  const seed = Number(code);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Error("Invalid test seed");
  return new Promise<{ world: WorldData; heights: ArrayBuffer }>(
    (resolve, reject) => {
      const generator = new Worker(
        new URL("./world/generation-worker.ts", import.meta.url),
        { type: "module" },
      );
      generator.onmessage = (event) => {
        const m = event.data;
        if (m.type === "progress") status.textContent = m.label;
        if (m.type === "generated") {
          generator.terminate();
          resolve({ world: m.world, heights: m.heights.buffer });
        }
        if (m.type === "error") {
          generator.terminate();
          reject(Error(m.message));
        }
      };
      generator.onerror = (error) => {
        generator.terminate();
        reject(error);
      };
      generator.postMessage({ seed });
    },
  );
}
const { world, heights } = await baseline();
(document.querySelector("#seed") as HTMLInputElement).value = String(
  world.seed,
);
const viewpoints = document.querySelector<HTMLSelectElement>("#viewpoint")!;
const residentPose = document.querySelector<HTMLSelectElement>("#resident-pose")!;
const monsterPose = document.querySelector<HTMLSelectElement>("#monster-pose")!;
for (const kind of new Set(world.sites.map((s) => s.kind)))
  if (!Array.from(viewpoints.options).some((o) => o.value === kind)) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind.replaceAll("-", " ");
    viewpoints.add(option);
  }
const saveWriter = new SaveWriter("siege-performance-test"),
  store = new SaveStore("siege-performance-test", saveWriter);
await store.open();
await store.replaceBaseline({
  world,
  heights: new Float32Array(heights.slice(0)),
});
const audio = new GameAudio();
const worker = new Worker(new URL("./sim/worker.ts", import.meta.url), {
  type: "module",
});
const send = (m: GameCommand, transfer: Transferable[] = []) =>
  worker.postMessage(m, transfer);
const view = new GameRenderer(
  canvas,
  world,
  new Float32Array(heights.slice(0)),
  (s) => {
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
  },
);
let snapshot: SimulationSnapshot,
  reviewedResidentId: number | undefined,
  reviewedResidentYaw: number | undefined,
  reviewedMonsterId: number | undefined,
  residentCameraPending = false,
  ready = false,
  active = false,
  last = 0,
  started = 0,
  nextStrike = 0,
  lastSave = 0,
  saving = false,
  caseIndex = -1,
  benchmarkRunning = false,
  soak = false,
  normalSoak = false;
const cases = [120, 400].flatMap((count) =>
  ["flight", "nuke", "laser"].map((kind) => ({ count, kind, duration: 30 })),
);
cases.push(
  { count: 120, kind: "single-nuke", duration: 20 },
  { count: 120, kind: "single-nuke-no-save", duration: 20 },
);
cases.push(
  ...[120, 400].flatMap((count) =>
    ["cannon-projectiles", "nuke-projectiles", "flight-3000"].map((kind) => ({
      count,
      kind,
      duration: 45,
    })),
  ),
);
const caseSelector = document.querySelector<HTMLSelectElement>("#case")!;
for (const [index, c] of cases.entries())
  if (index >= 8) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${c.kind} · ${c.count}`;
    caseSelector.add(option);
  }
const routes = [
  world.castle,
  ...world.sites.map((s) => s.p),
  ...(world.rivers ?? []).map((r) => r.points[Math.floor(r.points.length / 2)]),
];
const normalRoutes = [routes[0]],
  remainingRoutes = routes.slice(1);
while (remainingRoutes.length) {
  const lastRoute = normalRoutes.at(-1)!;
  let nearest = 0;
  for (let i = 1; i < remainingRoutes.length; i++)
    if (
      Math.hypot(
        remainingRoutes[i][0] - lastRoute[0],
        remainingRoutes[i][2] - lastRoute[2],
      ) <
      Math.hypot(
        remainingRoutes[nearest][0] - lastRoute[0],
        remainingRoutes[nearest][2] - lastRoute[2],
      )
    )
      nearest = i;
  normalRoutes.push(remainingRoutes.splice(nearest, 1)[0]);
}
let routeIndex = -1,
  weaponIndex = -1,
  recovering = false;
let recoveryBoundary = { frames: 0, cpu: 0, ticks: 0, captures: 0 };
let loadStarted = 0,
  preparationMS = 0,
  startupMS = 0;
let initialPreparationStages: Record<string, number> = {};
const results: unknown[] = [];
const frames: number[] = [];
const callbackFrames: number[] = [];
let lastCallback = 0;
let foregroundFrames = 0;
const cpu: number[] = [];
const ticks: number[] = [];
const saveSlices: number[] = [];
const captures: number[] = [];
const delivery: number[] = [];
let lastStatus = 0,
  handlerWork = 0;
saveWriter.onPreparation = (ms) => {
  if (active) {
    handlerWork += ms;
    view.performance.record("saveDispatch", ms);
  }
};
let touring = false;
const resources: unknown[] = [];
let lastResource = 0,
  lastSimulationTime = 0;
function applyResidentReviewPose(state: SimulationSnapshot) {
  if (viewpoints.value !== "resident" || reviewedResidentId === undefined)
    return;
  const resident = state.civilians.find((candidate) => candidate.id === reviewedResidentId);
  if (resident) {
    view.civilians.setReviewDefeat(
      resident.id,
      residentPose.value === "defeat",
      state.time,
    );
    resident.mood =
      residentPose.value === "defeat"
        ? "walk"
        : (residentPose.value as typeof resident.mood);
    // Keep the sampled heading stable while the worker acknowledges pause.
    if (reviewedResidentYaw !== undefined)
      resident.yaw = reviewedResidentYaw;
  }
}
function applyMonsterReviewPose(state: SimulationSnapshot) {
  if (
    active ||
    benchmarkRunning ||
    viewpoints.value !== "monster" ||
    reviewedMonsterId === undefined
  )
    return;
  const monster = state.monsters.find(
    (candidate) => candidate.id === reviewedMonsterId,
  );
  if (!monster) return;
  monster.windup = monsterPose.value === "attack" ? 0.75 : 0;
  monster.stagger = monsterPose.value === "stagger" ? 0.45 : 0;
}
function frameReviewedResident(state: SimulationSnapshot) {
  if (viewpoints.value !== "resident" || reviewedResidentId === undefined)
    return;
  const resident = state.civilians.find(
    (candidate) => candidate.id === reviewedResidentId && candidate.alive,
  );
  if (!resident) return;
  const [x, y, z] = resident.p,
    facing = resident.yaw,
    distance = 3.8;
  inspectionTarget = [x, y, z];
  view.inspectCamera(
    [x + Math.sin(facing) * distance, y + 2.85, z + Math.cos(facing) * distance],
    [x, y + 1.9, z],
  );
  status.textContent = `Resident close-up · ${resident.id} · ${residentPose.selectedOptions[0].textContent}`;
  last = 0;
}
let readyResolve: () => void = () => {};
worker.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const m = e.data,
    handling = performance.now();
  if (m.type === "error") {
    status.textContent = "ERROR " + m.message;
    active = false;
    return;
  }
  if (m.type === "snapshot") {
    snapshot = m;
    applyResidentReviewPose(m);
    applyMonsterReviewPose(m);
    view.receive(m);
    if (active)
      ticks.push(
        ...(m.stats.stepSamples ?? [m.stats.stepMS ?? m.stats.physicsMS]),
      );
  }
  if (m.type === "delta") view.delta(m);
  if (m.type === "explosion") {
    view.explosion(m);
    audio.explosion(m);
  }
  if (m.type === "contactSound") audio.contact(m);
  if (m.type === "settlementEvent") audio.settlement(m.p, m.kind);
  if (m.type === "monsterEvent") audio.monster(m.p, m.kind);
  if (m.type === "fragments") view.fragment(m);
  if (m.type === "vaporize") {
    view.effects.vaporize(m.p, m.radius);
  }
  if (m.type === "ready") {
    view.reset(
      new Float32Array(m.heights),
      m.removed,
      m.ruins,
      m.flood,
      m.waterMask,
    );
    const preparing = performance.now();
    await view.prewarm();
    preparationMS = performance.now() - preparing;
    // Finish initial terrain while deliberately paused; first combat shaders remain prewarmed.
    for (let i = 0; i < 240; i++) {
      view.terrain.update(view.camera.position.set(...world.spawn));
      if (i > 10 && !view.terrain.queueDepth) break;
      await new Promise((r) => setTimeout(r, 16));
    }
    if (!startupMS) {
      startupMS = performance.now() - loadStarted;
      initialPreparationStages = { ...view.warmupStages };
    }
    ready = true;
    readyResolve();
    if (caseIndex < 0 && !benchmarkRunning)
      document
        .querySelectorAll<HTMLButtonElement>("#run,#soak,#normal-soak")
        .forEach((b) => (b.disabled = false));
    status.textContent = "Ready";
  }
  if (m.type === "paused") {
    snapshot = m.snapshot;
    applyResidentReviewPose(m.snapshot);
    applyMonsterReviewPose(m.snapshot);
    view.receive(m.snapshot);
    if (residentCameraPending) {
      residentCameraPending = false;
      frameReviewedResident(m.snapshot);
    }
  }
  if (m.type === "saved") {
    if (active) captures.push(...(m.slices ?? []));
    const t = performance.now();
    try {
      const transaction = store.write(m.save);
      if (active) handlerWork += performance.now() - handling;
      await transaction;
      send({ type: "saveAck", capture: m.save.capture! });
      saveSlices.push(performance.now() - t);
    } catch (e) {
      status.textContent = "Save error " + String(e);
      active = false;
    } finally {
      saving = false;
    }
    return;
  }
  if (active) handlerWork += performance.now() - handling;
};
send(
  {
    type: "init",
    world,
    heights,
    debug: true,
    monsterCount: 120,
    destruction: { ...DEFAULT_DESTRUCTION, noCooldown: true },
  },
  [heights],
);
const summarize = (a: number[]) => {
  const sorted = a.slice().sort((a, b) => a - b);
  return {
    count: a.length,
    meanMS: a.reduce((s, n) => s + n, 0) / (a.length || 1),
    p95MS: sorted[Math.floor(a.length * 0.95)] || 0,
    p99MS: sorted[Math.floor(a.length * 0.99)] || 0,
    maxMS: sorted.at(-1) || 0,
  };
};
let caseLimit = cases.length;
function projectilePass(pass: number, kind: string) {
  const angle = ((pass % 4) * Math.PI) / 2;
  const target: Vec3 = [world.castle[0], world.castle[1] + 35, world.castle[2]];
  const p: Vec3 = [
    target[0] - Math.sin(angle) * 300,
    0,
    target[2] - Math.cos(angle) * 300,
  ];
  p[1] = Math.max(world.castle[1] + 130, view.terrain.sample(p[0], p[2]) + 130);
  send({
    type: "debugPlane",
    p,
    yaw: Math.atan2(target[0] - p[0], target[2] - p[2]),
    pitch: kind.startsWith("cannon") ? Math.atan2(target[1] - p[1], 300) : 0,
  });
}
async function beginCase(index: number) {
  view.rig.chase();
  view.setPhotoExposure(1.15);
  view.setPhotoFocus(0);
  (document.querySelector("#inspect-photo") as HTMLInputElement).checked =
    false;
  (document.querySelector("#inspect-quality") as HTMLSelectElement).value =
    "auto";
  foregroundFrames = 0;
  active = false;
  touring = false;
  send({ type: "pause", paused: true });
  // Every case starts from independent damage storage. Finish the previous
  // island's capture/commit before resetting packet and capture identities.
  while (saving) await new Promise((resolve) => setTimeout(resolve, 5));
  await store.clear();
  audio.pause();
  audio.reset();
  status.textContent = "Preparing case";
  view.setRenderDistance(1200);
  view.setGooglyEyes(false);
  ready = false;
  const wait = new Promise<void>((r) => (readyResolve = r));
  send({ type: "reset" });
  await wait;
  const c = soak
    ? {
        count: normalSoak ? 120 : 400,
        kind: normalSoak ? "normal" : "mixed",
        duration: 900,
      }
    : cases[index];
  send({ type: "monsterCount", value: c.count });
  send({
    type: "debugPlane",
    p: [world.castle[0] - 180, 280, world.castle[2] - 300],
    yaw: 0,
    pitch: 0,
  });
  send({
    type: "input",
    input: { x: 0, y: 0, bank: 0, throttle: 0, boost: false, fire: false },
  });
  routeIndex = weaponIndex = -1;
  recovering = false;
  view.resetAutoQuality();
  view.setQuality("auto");
  view.setRenderDistance(
    c.kind === "flight-3000" || (soak && !normalSoak) ? 3000 : 1200,
  );
  send({
    type: "destructionSettings",
    value: { ...DEFAULT_DESTRUCTION, noCooldown: !normalSoak },
  });
  if (c.kind.endsWith("projectiles")) {
    projectilePass(0, c.kind);
    routeIndex = 0;
    send({
      type: "weapon",
      weapon: c.kind.startsWith("cannon") ? "cannon" : "nuke",
    });
    if (c.kind.startsWith("nuke")) send({ type: "nukeYield", value: "castle" });
    send({
      type: "input",
      input: { x: 0, y: 0, bank: 0, throttle: 0, boost: false, fire: true },
    });
  }
  if (
    c.kind === "flight" ||
    c.kind === "flight-3000" ||
    c.kind === "normal" ||
    soak ||
    c.kind.endsWith("projectiles")
  ) {
    view.clearInspect();
    view.setChase();
  } else
    view.inspectCamera(
      [world.castle[0] - 180, 300, world.castle[2] - 250],
      [world.castle[0], 80, world.castle[2]],
    );
  frames.length =
    callbackFrames.length =
    cpu.length =
    ticks.length =
    saveSlices.length =
    captures.length =
    delivery.length =
      0;
  handlerWork = 0;
  lastStatus = 0;
  view.performance.reset();
  view.performance.queues.shadowShaderProgramsCreated = 0;
  await audio.start();
  resources.length = 0;
  lastResource = 0;
  caseIndex = index;
  started = performance.now();
  last = 0;
  lastCallback = 0;
  nextStrike = started + (c.kind.startsWith("single-nuke") ? 3000 : 0);
  lastSave = started;
  lastResource = started;
  lastSimulationTime = snapshot?.time ?? 0;
  active = true;
  send({ type: "pause", paused: false });
}
function frame(now: number) {
  const arrival = performance.now();
  requestAnimationFrame(frame);
  if (!ready || !snapshot) return;
  if (!active && !touring && now - last < 100) return;
  const raw = last ? now - last : 1000 / 60;
  last = now;
  const c = soak
    ? {
        count: normalSoak ? 120 : 400,
        kind: normalSoak ? "normal" : "mixed",
        duration: 900,
      }
    : cases[caseIndex];
  if (active) {
    if (document.hidden) {
      status.textContent = "Paused: foreground required";
      send({ type: "pause", paused: true });
      active = false;
      return;
    }
    frames.push(raw);
    callbackFrames.push(lastCallback ? arrival - lastCallback : 1000 / 60);
    lastCallback = arrival;
    if (document.visibilityState === "visible" && document.hasFocus())
      foregroundFrames++;
    if (!recovering && c.kind.endsWith("projectiles")) {
      const pass = Math.floor((now - started) / 3000);
      if (pass !== routeIndex) {
        routeIndex = pass;
        projectilePass(pass, c.kind);
      }
    }
    if (soak && !recovering) {
      const elapsed = (now - started) / 1000,
        route = Math.floor(elapsed / 45) % routes.length;
      if (!normalSoak && route !== routeIndex) {
        routeIndex = route;
        const p = routes[route],
          ground = view.terrain.sample(p[0], p[2]);
        send({
          type: "debugPlane",
          p: [p[0] - 120, ground + 140, p[2] - 180],
          yaw: 0.4,
          pitch: -0.08,
        });
      }
      const weapon = Math.floor(elapsed / 20) % 3;
      if (weapon !== weaponIndex) {
        weaponIndex = weapon;
        send({
          type: "weapon",
          weapon: (["cannon", "nuke", "laser"] as const)[weapon],
        });
      }
      let steering = Math.sin(elapsed * 0.08) * 0.15,
        climb = 0;
      if (normalSoak) {
        routeIndex = Math.max(0, routeIndex);
        let target = normalRoutes[routeIndex],
          plane = snapshot.plane;
        if (Math.hypot(target[0] - plane.p[0], target[2] - plane.p[2]) < 200) {
          routeIndex = (routeIndex + 1) % normalRoutes.length;
          target = normalRoutes[routeIndex];
        }
        const dx = target[0] - plane.p[0],
          dz = target[2] - plane.p[2],
          distance = Math.hypot(dx, dz),
          yaw = Math.atan2(dx, dz);
        const ahead = view.terrain.sample(
          plane.p[0] + Math.sin(plane.yaw) * 400,
          plane.p[2] + Math.cos(plane.yaw) * 400,
        );
        const altitude = Math.max(
          view.terrain.sample(plane.p[0], plane.p[2]) + 180,
          ahead + 180,
          view.terrain.sample(target[0], target[2]) + 180,
        );
        const pitch = Math.max(
          -0.2,
          Math.min(
            0.3,
            Math.atan2(
              altitude - plane.p[1],
              Math.min(500, Math.max(100, distance)),
            ),
          ),
        );
        steering = Math.max(
          -0.6,
          Math.min(
            0.6,
            Math.atan2(Math.sin(yaw - plane.yaw), Math.cos(yaw - plane.yaw)) *
              -0.7,
          ),
        );
        climb = Math.max(-0.5, Math.min(0.5, (pitch - plane.pitch) * 1.5));
      }
      send({
        type: "input",
        input: {
          x: steering,
          y: climb,
          bank: 0,
          throttle: 0,
          boost: false,
          fire: elapsed % 20 < 12,
        },
      });
    }
    if (
      !recovering &&
      c.kind !== "flight" &&
      c.kind !== "flight-3000" &&
      c.kind !== "normal" &&
      !c.kind.endsWith("projectiles") &&
      now >= nextStrike
    ) {
      const n = Math.floor((now - started) / 100),
        radius = soak ? 350 : 80;
      const p: [number, number, number] = [
        world.castle[0] +
          (c.kind.startsWith("single-nuke") ? 0 : Math.sin(n * 0.3) * radius),
        world.castle[1],
        world.castle[2] +
          (c.kind.startsWith("single-nuke") ? 0 : Math.cos(n * 0.3) * radius),
      ];
      audio.launch(
        p,
        c.kind === "laser" || (c.kind === "mixed" && n % 2) ? "laser" : "nuke",
      );
      send(
        c.kind === "laser" || (c.kind === "mixed" && n % 2)
          ? { type: "debugLaser", p }
          : { type: "debugBlast", p, yield: "valley" },
      );
      nextStrike = c.kind.startsWith("single-nuke")
        ? Infinity
        : nextStrike + 100;
      // Each request remains authoritative. A slow browser never queues a burst of catch-up inputs.
      if (nextStrike < now - 100) nextStrike = now + 100;
    }
    if (c.kind !== "single-nuke-no-save" && now - lastSave >= 1000 && !saving) {
      lastSave = now;
      saving = true;
      void saveWriter
        .capture((port) => send({ type: "save", request: 1, port }, [port]))
        .then((commit) => {
          if (active) captures.push(...commit.slices);
          if (commit.capture !== undefined)
            send({ type: "saveAck", capture: commit.capture });
          saveSlices.push(commit.storageMS);
        })
        .catch((error) => {
          status.textContent = "Save error " + String(error);
          active = false;
        })
        .finally(() => {
          saving = false;
        });
    }
    const elapsed = (now - started) / 1000;
    if (now - lastStatus >= 250) {
      lastStatus = now;
      status.textContent = `${c.kind} / ${c.count} monsters · ${elapsed.toFixed(0)} / ${c.duration + (recovering ? 60 : 0)}s · ${recovering ? "recovery · " : ""}${view.stats.quality}p`;
    }
    if (
      now - lastResource >=
      (c.kind.startsWith("single-nuke") ? 1000 : 10000)
    ) {
      const simulationRatio =
        (snapshot.time - lastSimulationTime) / ((now - lastResource) / 1000);
      lastSimulationTime = snapshot.time;
      lastResource = now;
      resources.push({
        elapsed,
        simulationRatio,
        worker: snapshot.stats,
        stages: view.performance.stats.stages,
        heapBytes: (performance as any).memory?.usedJSHeapSize ?? null,
        queues: { ...view.performance.queues },
        render: view.stats,
      });
    }
    const needsRecovery =
      soak || (c.kind !== "flight" && c.kind !== "flight-3000");
    if (needsRecovery && !recovering && elapsed >= c.duration) {
      recovering = true;
      recoveryBoundary = {
        frames: frames.length,
        cpu: cpu.length,
        ticks: ticks.length,
        captures: captures.length,
      };
      send({
        type: "input",
        input: { x: 0, y: 0, bank: 0, throttle: 0, boost: false, fire: false },
      });
      // Hold the presentation view after firing. Continued camera flight would
      // create fresh terrain requests and conceal whether existing work drained.
      if (c.kind.endsWith("projectiles") || soak) {
        const p = view.camera.position.clone();
        const target = p
          .clone()
          .addScaledVector(view.camera.getWorldDirection(p.clone()), 100);
        view.inspectCamera(p.toArray(), target.toArray());
      }
    }
    if (elapsed >= c.duration + (needsRecovery ? 60 : 0)) {
      active = false;
      audio.pause();
      send({
        type: "input",
        input: { x: 0, y: 0, bank: 0, throttle: 0, boost: false, fire: false },
      });
      send({ type: "pause", paused: true });
      const workloadFrames = needsRecovery
        ? frames.slice(0, recoveryBoundary.frames)
        : frames;
      const stats = frameStats(workloadFrames, Infinity),
        fps =
          (workloadFrames.length * 1000) /
          workloadFrames.reduce((a, b) => a + b, 0);
      const main = summarize(
          needsRecovery ? cpu.slice(0, recoveryBoundary.cpu) : cpu,
        ),
        simulation = summarize(
          needsRecovery ? ticks.slice(0, recoveryBoundary.ticks) : ticks,
        ),
        saveCapture = summarize(
          needsRecovery
            ? captures.slice(0, recoveryBoundary.captures)
            : captures,
        );
      results.push({
        case: c,
        frames: { ...stats, fps, total: workloadFrames.length },
        callbackDelivery: frameStats(
          needsRecovery
            ? callbackFrames.slice(0, recoveryBoundary.frames)
            : callbackFrames,
          Infinity,
        ),
        environment: {
          userAgent: navigator.userAgent,
          viewport: [innerWidth, innerHeight],
          seed: world.seed,
          route: soak
            ? normalSoak
              ? "continuous flight, nearest landmark route"
              : "teleport streaming pressure"
            : c.kind.endsWith("projectiles")
              ? "repeated three-second cardinal castle attack passes"
              : "single route",
          distance: view.stats.renderDistance,
          foregroundFraction: foregroundFrames / frames.length,
        },
        main,
        saveCapture,
        simulation,
        storage: summarize(saveSlices),
        render: view.stats,
        resources: resources.slice(),
        audio: audio.stats,
        assets: view.assetStatus,
        loading: {
          shaderAndAssetsMS: preparationMS,
          totalStartupMS: startupMS,
          initialPreparationStages,
          casePreparationStages: { ...view.warmupStages },
          assetStages: { ...view.assetLoadingStages },
          downloads: performance
            .getEntriesByType("resource")
            .filter((r: any) => r.name.includes("/assets/"))
            .map((r: any) => ({
              name: r.name,
              durationMS: r.duration,
              transferBytes: r.transferSize,
            })),
        },
        recovery: needsRecovery
          ? {
              duration: 60,
              frames: frameStats(
                frames.slice(recoveryBoundary.frames),
                Infinity,
              ),
              callbackDelivery: frameStats(
                callbackFrames.slice(recoveryBoundary.frames),
                Infinity,
              ),
              main: summarize(cpu.slice(recoveryBoundary.cpu)),
              simulation: summarize(ticks.slice(recoveryBoundary.ticks)),
              queues: { ...view.performance.queues },
              worker: snapshot.stats,
              queueCompleted:
                snapshot.stats.pendingJobs === 0 &&
                snapshot.stats.bodies === 0 &&
                snapshot.stats.ballistic === 0 &&
                view.performance.queues.terrain === 0 &&
                view.performance.queues.textureUploads === 0 &&
                (view.performance.queues.renderRuins ?? 0) === 0,
              remainingTerrain: view.performance.queues.terrain,
            }
          : null,
        performance: view.performance.stats,
        gatesPassed:
          foregroundFrames / frames.length >= 0.99 &&
          fps >= 59 &&
          (stats.lowFPS || 0) >= 55 &&
          stats.p99MS <= 20 &&
          stats.missedFraction < 0.001 &&
          main.p95MS <= 4 &&
          main.p99MS <= 6 &&
          simulation.p95MS <= 5 &&
          simulation.p99MS <= 8 &&
          saveCapture.maxMS <= 2 &&
          resources.every(
            (r: any) =>
              r.elapsed < 10 ||
              (r.simulationRatio >= 0.98 && r.simulationRatio <= 1.02),
          ) &&
          (view.performance.queues.residentTextureBytes ?? 0) <=
            192 * 1048576 &&
          (view.performance.queues.renderTargetBytes ?? 0) <= 64 * 1048576,
      });
      report.style.display = "block";
      report.textContent = JSON.stringify(results, null, 2);
      document.querySelector("#summary")!.textContent = results
        .map(
          (r: any) =>
            `${r.case.kind}/${r.case.count}: ${r.frames.fps.toFixed(1)} FPS · 1% ${r.frames.lowFPS.toFixed(1)} · p99 ${r.frames.p99MS.toFixed(1)} ms · ${r.gatesPassed ? "PASS" : "FAIL"}`,
        )
        .join(" | ");
      if (!soak && caseIndex + 1 < caseLimit) void beginCase(caseIndex + 1);
      else {
        benchmarkRunning = false;
        status.textContent = "Complete";
        document
          .querySelectorAll<HTMLButtonElement>("#run,#soak,#normal-soak")
          .forEach((b) => (b.disabled = false));
      }
    }
  }
  const t = performance.now();
  view.render(Math.min(raw / 1000, 0.1), active || touring, now);
  if (active || touring) {
    const p = view.camera.position.toArray() as [number, number, number];
    audio.update(
      snapshot.plane.speed,
      p,
      view.cameraDirection(),
      false,
      view.ambience(),
    );
    audio.syncLasers(snapshot.lasers, p);
    audio.syncDisco(discoActive(snapshot.lasers), snapshot.time);
  }
  if (active) {
    cpu.push(performance.now() - t + handlerWork);
    handlerWork = 0;
  }
}
requestAnimationFrame(frame);
function foregroundBenchmark() {
  if (!document.hidden && document.hasFocus()) return true;
  status.textContent =
    "Select this browser tab in the foreground before measuring";
  return false;
}
document.querySelector("#run")!.addEventListener("click", () => {
  if (benchmarkRunning || !foregroundBenchmark()) return;
  benchmarkRunning = true;
  void audio.start().catch(() => {});
  soak = false;
  normalSoak = false;
  results.length = 0;
  document
    .querySelectorAll<HTMLButtonElement>("#run,#soak,#normal-soak")
    .forEach((b) => (b.disabled = true));
  const selected = Number(
    (document.querySelector("#case") as HTMLSelectElement).value,
  );
  caseLimit = selected < 0 ? cases.length : selected + 1;
  void beginCase(selected === -2 ? 8 : Math.max(0, selected));
});
document.querySelector("#soak")!.addEventListener("click", () => {
  if (benchmarkRunning || !foregroundBenchmark()) return;
  benchmarkRunning = true;
  void audio.start().catch(() => {});
  soak = true;
  normalSoak = false;
  results.length = 0;
  document
    .querySelectorAll<HTMLButtonElement>("#run,#soak,#normal-soak")
    .forEach((b) => (b.disabled = true));
  void beginCase(0);
});
document.querySelector("#normal-soak")!.addEventListener("click", () => {
  if (benchmarkRunning || !foregroundBenchmark()) return;
  benchmarkRunning = true;
  soak = true;
  normalSoak = true;
  results.length = 0;
  document
    .querySelectorAll<HTMLButtonElement>("#run,#soak,#normal-soak")
    .forEach((b) => (b.disabled = true));
  void beginCase(0);
});
document.querySelector("#download")!.addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(results, null, 2)], { type: "application/json" }),
  );
  a.download = "siege-performance.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
window.addEventListener("resize", () => view.resize());
let checkingContext = false;
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  active = touring = ready = false;
  send({ type: "pause", paused: true });
  view.releaseLostGeometry();
  status.textContent = "Graphics interrupted; recovering…";
});
canvas.addEventListener("webglcontextrestored", () => {
  queueMicrotask(async () => {
    try {
      await view.recoverGraphics();
      ready = true;
      status.textContent = "Context recovery passed · island preserved";
    } catch (error) {
      status.textContent = "Context recovery failed: " + String(error);
    } finally {
      checkingContext = false;
    }
  });
});
document.querySelector("#context")!.addEventListener("click", () => {
  if (active || benchmarkRunning || !ready || checkingContext) return;
  checkingContext = true;
  view.renderer.forceContextLoss();
  setTimeout(() => view.renderer.forceContextRestore(), 1000);
});

document.querySelector("#scene")!.addEventListener("click", async () => {
  if (active || !ready) return;
  try {
    const blob = await view.capture();
    const image = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const response = await fetch("./__benchmark-scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    if (!response.ok)
      throw Error("Scene image export requires the local Vite server");
    status.textContent = "Saved " + (await response.json()).path;
  } catch (error) {
    status.textContent = String(error);
  }
});

document.querySelector("#storage")!.addEventListener("click", async () => {
  if (active) return;
  status.textContent = "Checking storage…";
  try {
    const checks = await checkStorage({
      world,
      heights: new Float32Array(view.terrain.base),
    });
    report.style.display = "block";
    report.textContent = JSON.stringify({ storageChecks: checks }, null, 2);
    status.textContent = "Storage checks passed";
  } catch (error) {
    report.style.display = "block";
    report.textContent = String(error);
    status.textContent = "Storage checks failed";
  }
});

document.querySelector("#export")!.addEventListener("click", async () => {
  if (active) return;
  try {
    const response = await fetch("./__benchmark-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(results),
    });
    if (!response.ok)
      throw Error("Local report export requires the Vite preview server");
    const result = await response.json();
    status.textContent = "Saved " + result.path;
  } catch (error) {
    status.textContent = String(error);
  }
});

let inspectionTarget: Vec3 = [0, 0, 0];
function inspect() {
  if (active || !ready) return;
  const kind = (document.querySelector("#viewpoint") as HTMLSelectElement)
    .value;
  if (kind === "windmill") {
    const site = world.sites.find((entry) => entry.kind === "windmill"),
      rotor = windmillRotors(world).find(
        (entry) => entry.center[0] === site?.p[0],
      );
    if (site && rotor) {
      const closeView =
          Number(
            (document.querySelector("#altitude") as HTMLSelectElement).value,
          ) === 12,
        [x, y, z] = rotor.center,
        distance = closeView ? 38 : 62;
      inspectionTarget = rotor.center.slice() as Vec3;
      view.inspectCamera(
        [x + distance * 0.5, y + distance * 0.2, z - distance],
        [x, y, z],
      );
      status.textContent = "Windmill rotor and hub review";
      last = 0;
      return;
    }
  }
  if (kind === "watermill") {
    const site = world.sites.find((entry) => entry.kind === "watermill"),
      rotor = waterwheelRotors(world).find(
        (entry) => entry.siteId === site?.id,
      );
    if (site && rotor) {
      const closeView =
          Number(
            (document.querySelector("#altitude") as HTMLSelectElement).value,
          ) === 12,
        [x, y, z] = rotor.center,
        distance = closeView ? 30 : 48,
        [sideX, , sideZ] = rotor.axis;
      inspectionTarget = rotor.center.slice() as Vec3;
      view.inspectCamera(
        [x + sideX * distance, y + distance * 0.16, z + sideZ * distance],
        [x, y, z],
      );
      status.textContent = "Waterwheel, paddles, and axle review";
      last = 0;
      return;
    }
  }
  if (kind === "lighthouse") {
    const site = world.sites.find((entry) => entry.kind === "lighthouse"),
      lantern = world.entities.find(
        (entity) =>
          entity.assembly === site?.id &&
          entity.kind === "block" &&
          entity.material === "window" &&
          entity.s[0] >= 3.5 &&
          entity.s[2] >= 3.5 &&
          entity.s[0] > entity.s[1] &&
          entity.s[2] > entity.s[1],
      );
    if (site && lantern) {
      const closeView =
          Number(
            (document.querySelector("#altitude") as HTMLSelectElement).value,
          ) === 12,
        [x, y, z] = lantern.p,
        offsetX = x - CONFIG.worldSize * 0.5,
        offsetZ = z - CONFIG.worldSize * 0.5,
        offsetLength = Math.hypot(offsetX, offsetZ) || 1,
        distance = closeView ? 17 : 30;
      inspectionTarget = [x, y, z];
      view.inspectCamera(
        [
          x + (offsetX / offsetLength) * distance,
          y + (closeView ? -8 : distance * 0.08),
          z + (offsetZ / offsetLength) * distance,
        ],
        [x, y, z],
      );
      status.textContent = "Lighthouse Fresnel lens review";
      last = 0;
      return;
    }
  }
  if (kind === "river-bend") {
    const closeView =
        Number(
          (document.querySelector("#altitude") as HTMLSelectElement).value,
        ) === 12,
      distance = closeView ? 18 : 32,
      camera = (world.rivers ?? [])
        .map((river) => riverBendReviewCamera(river.points, distance))
        .filter((candidate) => candidate !== undefined)
        .sort((a, b) => b.curvature - a.curvature)[0];
    if (camera) {
      inspectionTarget = camera.target;
      view.inspectCamera(camera.eye, camera.target);
      status.textContent = "Mitered river-bend join review";
      last = 0;
      return;
    }
  }
  if (kind === "quarry") {
    const site = world.sites.find((entry) => entry.kind === "quarry"),
      owner = site
        ? quarryHoistOwner(
            world.entities.filter(
              (entity) => entity.assembly === `${site.id}-scaffold`,
            ),
          )
        : undefined;
    if (owner) {
      const closeView =
          Number(
            (document.querySelector("#altitude") as HTMLSelectElement).value,
          ) === 12,
        camera = quarryHoistReviewCamera(owner, closeView ? 8 : 16);
      inspectionTarget = camera.target;
      view.inspectCamera(camera.eye, camera.target);
      status.textContent = "Quarry winch, cable, and ore-load review";
      last = 0;
      return;
    }
  }
  if (kind === "logging") {
    const site = world.sites.find((entry) => entry.kind === "logging"),
      stack = site
        ? world.entities
            .filter((entity) =>
              entity.assembly.startsWith(`${site.id}-stack-`),
            )
            .sort((a, b) => a.p[1] - b.p[1])[0]
        : undefined;
    if (stack) {
      const closeView =
          Number(
            (document.querySelector("#altitude") as HTMLSelectElement).value,
          ) === 12,
        camera = loggingCampReviewCamera(stack, closeView ? 24 : 38);
      inspectionTarget = camera.target;
      view.inspectCamera(camera.eye, camera.target);
      status.textContent = "Logging-camp log stack and chock review";
      last = 0;
      return;
    }
  }
  if (kind === "bridge" || kind === "crossing") {
    const site = world.sites.find((entry) => entry.kind === kind),
      candidate = world.entities.find(
        (entity) =>
          entity.assembly === site?.id &&
          entity.kind === "block" &&
          entity.material === "wood" &&
          Math.abs(entity.s[1] - 1) < 0.05 &&
          entity.s[0] > 2.5 &&
          entity.s[2] > 2.5,
      );
    if (site && candidate) {
      const closeView =
          Number(
            (document.querySelector("#altitude") as HTMLSelectElement).value,
          ) === 12,
        runsAlongX = candidate.s[0] < candidate.s[2],
        decks = world.entities
          .filter(
            (entity) =>
              entity.assembly === site.id &&
              entity.kind === "block" &&
              entity.material === "wood" &&
              Math.abs(entity.s[1] - 1) < 0.05 &&
              entity.s[0] > 2.5 &&
              entity.s[2] > 2.5,
          )
          .sort((a, b) =>
            runsAlongX ? a.p[0] - b.p[0] : a.p[2] - b.p[2],
          ),
        deck = decks[Math.floor(decks.length / 2)] ?? candidate,
        [x, y, z] = deck.p,
        transverse = closeView ? 18 : 34,
        waterLevel =
          (site as (typeof site) & { waterLevel?: number }).waterLevel ??
          y - 4,
        sideEyes: Vec3[] = runsAlongX
          ? [
              [x, y, z - transverse],
              [x, y, z + transverse],
            ]
          : [
              [x - transverse, y, z],
              [x + transverse, y, z],
            ],
        eye = sideEyes.reduce((lower, point) =>
          view.terrain.sample(point[0], point[2]) <
          view.terrain.sample(lower[0], lower[2])
            ? point
            : lower,
        ),
        eyeY = Math.max(
          y + 0.15,
          waterLevel + 3.2,
          view.terrain.sample(eye[0], eye[2]) + 1.5,
        );
      inspectionTarget = [x, y, z];
      view.inspectCamera(
        [eye[0], eyeY, eye[2]],
        [x, y - 0.9, z],
      );
      status.textContent = "Bridge girders and river-support review";
      last = 0;
      return;
    }
  }
  if (kind === "house-door") {
    const firstWall = world.entities.find(
      (entity) =>
        entity.kind === "block" &&
        entity.assembly.includes("-house") &&
        entity.material === "plaster" &&
        entity.foundation &&
        entity.s[2] <= 1.05 &&
        entity.s[0] > 1.2,
    );
    const walls = world.entities
      .filter(
        (entity) =>
          entity.kind === "block" &&
          entity.assembly === firstWall?.assembly &&
          entity.foundation &&
          entity.s[2] <= 1.05 &&
          entity.s[0] > 1.2 &&
          entity.material !== "window",
      )
      .sort((a, b) => a.p[0] - b.p[0]);
    const front = Math.min(...walls.map((wall) => wall.p[2]));
    const pair = walls
      .filter((wall) => Math.abs(wall.p[2] - front) < 0.05)
      .sort((a, b) => a.p[0] - b.p[0]);
    if (pair.length === 2) {
      const [left, right] = pair,
        hinge = left.p[0] + left.s[0],
        end = right.p[0] - right.s[0],
        halfWidth = (end - hinge) / 2,
        base = Math.max(left.p[1] - left.s[1], right.p[1] - right.s[1]),
        halfHeight = Math.min(left.s[1], right.s[1]),
        face = front - Math.max(left.s[2], right.s[2]) - 0.14,
        angle = Math.PI * 0.59,
        target: Vec3 = [
          hinge + Math.cos(angle) * halfWidth,
          base + halfHeight,
          face - Math.sin(angle) * halfWidth,
        ];
      inspectionTarget = target;
      view.inspectCamera(
        [target[0] + 6, target[1] + 1.4, target[2] - 4],
        target,
      );
      status.textContent = "House entrance joinery review";
      last = 0;
      return;
    }
  }
  if (kind === "house-window") {
    const houseWalls = world.entities.filter(
      (entity) =>
        entity.assembly.includes("-house") && entity.material === "plaster",
    );
    const assembly = houseWalls[0]?.assembly;
    const candidates = houseWalls.filter(
      (entity) =>
        entity.assembly === assembly &&
        !entity.foundation &&
        entity.s[2] <= 1.1 &&
        entity.s[0] > 1.5,
    );
    const groundCourse = Math.min(...candidates.map((wall) => wall.p[1])),
      front = Math.min(...candidates.map((wall) => wall.p[2])),
      back = Math.max(...candidates.map((wall) => wall.p[2])),
      wall = candidates.find(
        (candidate) =>
          candidate.p[1] === groundCourse && candidate.p[2] === front,
      ) ??
      candidates.find(
        (candidate) =>
          candidate.p[1] === groundCourse && candidate.p[2] === back,
      );
    const side = wall?.p[2] === front ? -1 : 1;
    if (wall) {
      const target = wall.p.slice() as Vec3,
        eye = wall.p.slice() as Vec3;
      target[2] += side * (wall.s[2] + 0.08);
      target[1] += 0.1;
      eye[2] = target[2] + side * 5;
      eye[1] += 1.5;
      inspectionTarget = target;
      view.inspectCamera(eye, target);
      last = 0;
      return;
    }
  }
  if (kind === "farm") {
    const closeView =
        Number(
          (document.querySelector("#altitude") as HTMLSelectElement).value,
        ) === 12,
      barn = world.entities.find(
        (entity) =>
          entity.kind === "block" &&
          /(?:^|-)farm-\d+-barn$/.test(entity.assembly),
      );
    if (barn && closeView) {
      const [x, , barnZ] = barn.p,
        z = barnZ - 37,
        y = view.terrain.sample(x, z),
        across = Math.max(8, Math.min(15, barn.s[0] * 0.58));
      inspectionTarget = [x, y, z];
      view.inspectCamera(
        [x + across * 0.6 + 7, y + 14, z - 23],
        [x, y + 1.2, z],
      );
      last = 0;
      return;
    }
  }
  if (kind === "watchtower-beacon") {
    const site = world.sites.find((entry) => entry.kind === "watchtower"),
      roof = site
        ? world.entities
            .filter(
              (entity) =>
                entity.assembly === site.id && entity.material === "roof",
            )
            .sort((a, b) => b.p[1] - a.p[1])[0]
        : undefined;
    if (roof) {
      const closeView =
          Number(
            (document.querySelector("#altitude") as HTMLSelectElement).value,
          ) === 12,
        camera = watchtowerBeaconReviewCamera(roof, closeView ? 5.5 : 12);
      inspectionTarget = camera.target;
      view.inspectCamera(camera.eye, camera.target);
      status.textContent = "Watchtower signal beacon review";
      last = 0;
      return;
    }
  }
  if (kind === "watchtower") {
    const site = world.sites.find((entry) => entry.kind === "watchtower");
    if (site) {
      const [x, y, z] = site.p,
        parts = world.entities.filter((entity) => entity.assembly === site.id),
        topY = Math.max(
          y,
          ...parts.map((entity) => entity.p[1] + entity.s[1]),
        ),
        topOffset = topY - y,
        closeView =
          Number(
            (document.querySelector("#altitude") as HTMLSelectElement).value,
          ) === 12,
        distance = closeView ? 42 : 72;
      inspectionTarget = [x, topY - 6, z];
      view.inspectCamera(
        [x + distance, y + topOffset + 8, z + distance],
        [x, y + topOffset - 6, z],
      );
      last = 0;
      return;
    }
  }
  if (kind === "castle-gate" && world.castles?.[0]) {
    const castle = world.castles[0],
      [x, y, z] = castle.landmarks.gate,
      dx = x - castle.p[0],
      dz = z - castle.p[2],
      length = Math.hypot(dx, dz) || 1;
    inspectionTarget = [x, y, z];
    view.inspectCamera(
      [x + (dx / length) * 36, y + 14, z + (dz / length) * 36],
      [x, y + 8, z],
    );
    last = 0;
    return;
  }
  if (kind === "castle-tower" && world.castles?.[0]?.landmarks.towers.length) {
    const castle = world.castles[0],
      [x, y, z] = castle.landmarks.towers[0],
      towerParts = world.entities.filter((entity) =>
        /:tower-/.test(entity.assembly),
      ),
      towerAssembly = towerParts
        .reduce(
          (best, entity) => {
            const distance =
              (entity.p[0] - x) ** 2 + (entity.p[2] - z) ** 2;
            return distance < best.distance
              ? { assembly: entity.assembly, distance }
              : best;
          },
          { assembly: "", distance: Infinity },
        ).assembly,
      topY = Math.max(
        y,
        ...towerParts
          .filter((entity) => entity.assembly === towerAssembly)
          .map((entity) => entity.p[1] + entity.s[1]),
      ),
      topOffset = topY - y,
      dx = x - castle.p[0],
      dz = z - castle.p[2],
      length = Math.hypot(dx, dz) || 1,
      closeView =
        Number(
          (document.querySelector("#altitude") as HTMLSelectElement).value,
        ) === 12,
      distance = closeView ? 44 : 88,
      eyeHeight = closeView ? topOffset + 12 : 62,
      aimHeight = closeView ? Math.max(12, topOffset - 2) : 35;
    inspectionTarget = [x, y, z];
    view.inspectCamera(
      [
        x + (dx / length) * distance,
        y + eyeHeight,
        z + (dz / length) * distance,
      ],
      [x, y + aimHeight, z],
    );
    last = 0;
    return;
  }
  if (kind === "aircraft-controls" && snapshot) {
    const p = snapshot.plane.p,
      yaw = snapshot.plane.yaw,
      closeView =
        Number(
          (document.querySelector("#altitude") as HTMLSelectElement).value,
        ) === 12,
      distance = closeView ? 16 : 28,
      eye: Vec3 = [
        p[0] - Math.sin(yaw) * distance + Math.cos(yaw) * 3.2,
        p[1] + 3.5,
        p[2] - Math.cos(yaw) * distance - Math.sin(yaw) * 3.2,
      ],
      target: Vec3 = [
        p[0] - Math.sin(yaw) * 4.5,
        p[1] + 1.1,
        p[2] - Math.cos(yaw) * 4.5,
      ];
    inspectionTarget = target;
    view.inspectCamera(eye, target);
    status.textContent = "Aircraft tail-control review";
    last = 0;
    return;
  }
  if (kind === "aircraft" && snapshot) {
    const p = snapshot.plane.p;
    inspectionTarget = [p[0], p[1], p[2]];
    // The ground preset approaches from the nose quarter and aims into the
    // canopy so cockpit detail is inspectable. Overview stays aft for the
    // twin-nozzle exhaust and full island context.
    const yaw = snapshot.plane.yaw,
      closeView =
        Number(
          (document.querySelector("#altitude") as HTMLSelectElement).value,
        ) === 12,
      distance = closeView ? 10 : 22;
    const side = closeView ? 3.2 : 0,
      front = closeView ? 1 : -1,
      eye: Vec3 = [
        p[0] + front * Math.sin(yaw) * distance + Math.cos(yaw) * side,
        p[1] + (closeView ? 3.8 : 7),
        p[2] + front * Math.cos(yaw) * distance - Math.sin(yaw) * side,
      ],
      target: Vec3 = [
        p[0],
        p[1] + (closeView ? 0.95 : 0),
        p[2] + (closeView ? 2 : 0),
      ];
    view.inspectCamera(eye, target);
    status.textContent = closeView
      ? "Aircraft cockpit review"
      : "Aircraft exhaust review";
    last = 0;
    return;
  }
  if (kind === "resident") {
    const livingResidents = snapshot?.civilians.filter(
      (civilian) => civilian.alive,
    ) ?? [];
    let scarvedResident: (typeof livingResidents)[number] | undefined,
      bestReviewScore = -Infinity;
    // Prefer a scarved, uncovered resident with a clear silhouette so both
    // the hairstyle and neckerchief read without another actor crowding them.
    for (const candidate of livingResidents) {
      if (candidate.id % 3 !== 0) continue;
      let separation = Infinity;
      for (const other of livingResidents)
        if (other.id !== candidate.id)
          separation = Math.min(
            separation,
            Math.hypot(candidate.p[0] - other.p[0], candidate.p[2] - other.p[2]),
          );
      const score = separation + (candidate.id % 4 >= 2 ? 1000 : 0);
      if (score > bestReviewScore) {
        scarvedResident = candidate;
        bestReviewScore = score;
      }
    }
    const resident =
      scarvedResident ??
      livingResidents.find(() => true) ??
      world.civilians?.find((civilian) => civilian.id % 3 === 0) ??
      world.civilians?.[0];
    if (resident) {
      // Hold the sampled pose still so a walking resident cannot leave the
      // close-up between choosing the preset and capturing its evidence.
      touring = false;
      reviewedResidentId = resident.id;
      reviewedResidentYaw =
        "yaw" in resident ? resident.yaw : resident.id * 2.399963;
      if (snapshot) applyResidentReviewPose(snapshot);
      residentCameraPending = true;
      send({ type: "pause", paused: true });
      if (snapshot) frameReviewedResident(snapshot);
      return;
    }
  }
  let p = world.castle.slice();
  if (kind === "monster" && snapshot.monsters.length) {
    const monster = snapshot.monsters[0];
    touring = false;
    reviewedMonsterId = monster.id;
    applyMonsterReviewPose(snapshot);
    send({ type: "pause", paused: true });
    const position = monster.p;
    p = [position[0], position[1], position[2]];
    inspectionTarget = p as Vec3;
    const yaw = snapshot.monsters[0].yaw + 0.3;
    view.inspectCamera(
      [p[0] + Math.sin(yaw) * 120, p[1] + 45, p[2] + Math.cos(yaw) * 120],
      [p[0], p[1] + 32, p[2]],
    );
    status.textContent = `Monster close-up · ${monster.id} · ${monsterPose.selectedOptions[0].textContent}`;
    last = 0;
    return;
  }
  if (kind === "warehouse") {
    const site = world.sites.find(
        (entry) =>
          (entry.kind === "harbor" || entry.kind === "watermill") &&
          world.entities.some(
            (entity) => entity.assembly === `${entry.id}-warehouse`,
          ),
      ),
      parts = site
        ? world.entities.filter(
            (entity) => entity.assembly === `${site.id}-warehouse`,
          )
        : [],
      roofs = parts.filter(
        (entity) => entity.material === "roof" || entity.material === "slate",
      );
    if (site && roofs.length) {
      const closeView =
          Number(
            (document.querySelector("#altitude") as HTMLSelectElement).value,
          ) === 12,
        maxX = Math.max(...parts.map((part) => part.p[0] + part.s[0])),
        minX = Math.min(...parts.map((part) => part.p[0] - part.s[0])),
        x = maxX + 2.5,
        z = roofs.reduce((sum, part) => sum + part.p[2], 0) / roofs.length,
        staging = warehouseStagingSpot(
          [x, 0, z],
          `${site.id}-warehouse`,
          world.entities,
          (px, pz) => view.terrain.sample(px, pz),
          (px, pz) => {
            const gx = Math.round(px / CONFIG.spacing),
              gz = Math.round(pz / CONFIG.spacing);
            return (
              gx >= 0 &&
              gz >= 0 &&
              gx < CONFIG.grid &&
              gz < CONFIG.grid &&
              !!view.terrain.flood[gz * CONFIG.grid + gx]
            );
          },
          pathIndex(world.paths),
        );
      if (staging) {
        const camera = warehouseCargoReviewCamera(
          [staging[0] + 0.35, staging[1] + 0.9, staging[2]],
          [(minX + maxX) / 2, 0, z],
          closeView ? 9 : 17,
        );
        inspectionTarget = camera.target;
        view.inspectCamera(camera.eye, camera.target);
        status.textContent = "Warehouse freight staging and owner review";
        last = 0;
        return;
      }
    }
  }
  const selectedSite = world.sites.find(
    (site) => site.kind === kind || (kind === "bridge" && site.kind === "crossing"),
  );
  if (selectedSite) p = selectedSite.p.slice();
  if (kind === "castle-walls" && world.castles?.[0]) {
    const castle = world.castles[0],
      wall = world.entities.filter(
        (entity) =>
          entity.assembly === `${castle.id}:front` &&
          entity.kind === "block" &&
          entity.material === "sandstone" &&
          !entity.foundation &&
          entity.s[1] >= 1.6 &&
          entity.s[1] <= 4.1 &&
          Math.max(entity.s[0], entity.s[2]) >=
            Math.min(entity.s[0], entity.s[2]) * 1.35,
      );
    if (wall.length >= 8) {
      const xExtent = Math.max(...wall.map((part) => part.p[0])) -
          Math.min(...wall.map((part) => part.p[0])),
        zExtent = Math.max(...wall.map((part) => part.p[2])) -
          Math.min(...wall.map((part) => part.p[2])),
        alongAxis = xExtent >= zExtent ? 0 : 2,
        normalAxis = alongAxis === 0 ? 2 : 0,
        courses = wall.filter(
          (part) =>
            part.s[alongAxis] >= 3.5 && part.s[normalAxis] >= 1.5,
        ),
        levels = [
          ...new Set(courses.map((part) => Math.round(part.p[1] * 100))),
        ].sort((a, b) => a - b),
        row = courses
          .filter(
            (part) =>
              Math.round(part.p[1] * 100) ===
              levels[Math.floor(levels.length / 2)],
          )
          .sort((a, b) => a.p[alongAxis] - b.p[alongAxis]),
        middle = Math.floor(row.length / 4),
        slitIndex = Math.min(
          row.length - 2,
          1 + Math.floor((middle - 1) / 3) * 3,
        ),
        owner = row[slitIndex];
      if (owner) {
        const target = owner.p.slice() as Vec3,
          outward = Math.sign(owner.p[normalAxis] - castle.p[normalAxis]) || 1,
          eye = target.slice() as Vec3;
        target[normalAxis] += outward * (owner.s[normalAxis] + 0.06);
        eye[normalAxis] = target[normalAxis] + outward * 13;
        eye[1] += 1.4;
        inspectionTarget = target;
        view.inspectCamera(eye, target);
        status.textContent = "Castle curtain-wall arrow-slit review";
        last = 0;
        return;
      }
    }
  }
  if (kind === "road" && world.paths.length) {
    const route = world.paths.find((path) => path.length >= 12) ?? world.paths[0],
      middle = Math.floor(route.length / 2);
    let point = route[middle],
      height = view.terrain.sample(point[0], point[1]);
    for (let offset = 1; height < 8 && offset < route.length / 2; offset++) {
      const candidate = route[middle + (offset % 2 ? 1 : -1) * Math.ceil(offset / 2)];
      if (!candidate) continue;
      const candidateHeight = view.terrain.sample(candidate[0], candidate[1]);
      if (candidateHeight > height) {
        point = candidate;
        height = candidateHeight;
      }
    }
    const before = route[Math.max(0, route.indexOf(point) - 1)],
      after = route[Math.min(route.length - 1, route.indexOf(point) + 1)],
      tangentLength = Math.hypot(after[0] - before[0], after[1] - before[1]) || 1,
      tangentX = (after[0] - before[0]) / tangentLength,
      tangentZ = (after[1] - before[1]) / tangentLength,
      eye: Vec3 = [
        point[0] - tangentX * 18 - tangentZ * 18,
        height + 22,
        point[1] - tangentZ * 18 + tangentX * 18,
      ],
      target: Vec3 = [point[0], height + 1, point[1]];
    inspectionTarget = target;
    view.inspectCamera(eye, target);
    status.textContent = "Packed-earth road and feathered verge review";
    last = 0;
    return;
  }
  if (kind === "castle-gate") {
    p = (world.castles?.[0]?.landmarks.gate ?? world.landmarks.gate).slice();
  } else if (kind === "castle-keep") {
    const castle = world.castles?.[0];
    const keepWalls = castle
      ? world.entities.filter(
          (entity) =>
            entity.assembly === `${castle.id}:keep` &&
            entity.kind === "block" &&
            entity.material === "sandstone" &&
            !entity.foundation &&
            entity.s[0] >= 4 &&
            entity.s[2] >= 4 &&
            entity.s[1] >= 2.8 &&
            entity.s[1] <= 3.4,
        )
      : [];
    if (keepWalls.length >= 8) {
      const minX = Math.min(...keepWalls.map((part) => part.p[0] - part.s[0])),
        minZ = Math.min(...keepWalls.map((part) => part.p[2] - part.s[2])),
        baseY = Math.min(...keepWalls.map((part) => part.p[1] - part.s[1])),
        corner: Vec3 = [minX - 0.25, baseY + 20, minZ - 0.25];
      inspectionTarget = corner;
      view.inspectCamera(
        [corner[0] - 18, corner[1] + 1.5, corner[2] - 16],
        corner,
      );
      status.textContent = "Castle keep corner-buttress review";
      last = 0;
      return;
    }
    p = (castle?.landmarks.keep ?? world.landmarks.keep).slice();
  } else if (kind === "harbor" && selectedSite) {
    const decks = world.entities.filter(
      (entity) =>
        entity.kind === "block" &&
        entity.material === "wood" &&
        entity.assembly === `${selectedSite.id}-dock` &&
        entity.s[1] <= 0.8 &&
        Math.min(entity.s[0], entity.s[2]) >= 1.8 &&
        Math.max(entity.s[0], entity.s[2]) >= 4.5,
    );
    const camera = harborDockReviewCamera(decks);
    if (camera) {
      inspectionTarget = camera.target;
      view.inspectCamera(camera.eye, camera.target);
      status.textContent = "Harbor dock support review";
      last = 0;
      return;
    }
  } else if (kind === "coast")
    p = (
      world.sites.find((s) => s.kind === "harbor")?.p ?? world.castle
    ).slice();
  else if (kind === "river") {
    const river =
      world.rivers?.find((r) => r.points.length > 8) ?? world.rivers?.[0];
    if (river) p = river.points[Math.floor(river.points.length / 2)].slice();
  } else if (kind === "village")
    p = (
      world.sites.find((s) => /hamlet|village|town|settlement/.test(s.kind))
        ?.p ??
      world.lights[0]?.p ??
      world.castle
    ).slice();
  else if (["pine", "broadleaf", "riverside"].includes(kind))
    p = (
      world.entities.find(
        (e) => e.kind === "tree" && (e.treeSpecies ?? "pine") === kind,
      )?.p ?? world.castle
    ).slice();
  else if (kind === "mountain") {
    let best = -Infinity;
    for (let z = 0; z < world.grid; z += 32)
      for (let x = 0; x < world.grid; x += 32) {
        const h = view.terrain.heights[z * world.grid + x];
        if (h > best) {
          best = h;
          p = [x * 2, h, z * 2];
        }
      }
  }
  inspectionTarget = p as Vec3;
  const altitude = Number(
    (document.querySelector("#altitude") as HTMLSelectElement).value,
  );
  // Detail views need to be close enough to inspect owner-bound artwork.
  const offset = altitude === 12 ? 32 : altitude === 1200 ? 1200 : 180;
  const hour = Number(
    (document.querySelector("#hour") as HTMLSelectElement).value,
  );
  const side = hour >= 16 && hour <= 20 ? 1 : -1;
  const x = p[0] + side * offset * 0.55,
    z = p[2] + side * offset;
  view.inspectCamera(
    [x, Math.max(p[1] + altitude, view.terrain.sample(x, z) + 6), z],
    [p[0], p[1] + 5, p[2]],
  );
  last = 0;
}
document
  .querySelector("#inspect-quality")!
  .addEventListener("change", (event) => {
    if (!active) view.setQuality((event.target as HTMLSelectElement).value);
  });
document
  .querySelector("#inspect-photo")!
  .addEventListener("change", (event) => {
    if (active || !ready) return;
    if ((event.target as HTMLInputElement).checked) {
      touring = false;
      send({ type: "pause", paused: true });
      view.rig.photo(view.camera);
      view.setPhotoFocus(
        Number(
          (document.querySelector("#inspect-focus") as HTMLInputElement).value,
        ),
      );
    } else {
      view.rig.exitPhoto();
      view.setPhotoFocus(0);
      inspect();
    }
  });
document.querySelector("#inspect-focus")!.addEventListener("input", (event) => {
  if (!active)
    view.setPhotoFocus(Number((event.target as HTMLInputElement).value));
});
document
  .querySelector("#inspect-exposure")!
  .addEventListener("input", (event) => {
    if (!active)
      view.setPhotoExposure(Number((event.target as HTMLInputElement).value));
  });
document.querySelector("#inspect-impact")!.addEventListener("click", () => {
  if (active || !ready) return;
  const materials = [
    "stone",
    "wood",
    "earth",
    "foliage",
    "roof",
    "slate",
  ] as const;
  for (const [i, material] of materials.entries()) {
    const p: Vec3 = [
      inspectionTarget[0] + (i - 2.5) * 8,
      inspectionTarget[1] + 5,
      inspectionTarget[2],
    ];
    view.effects.fragment({
      type: "fragments",
      material,
      p,
      origin: p,
      seed: 31 + i,
      count: 32,
      speed: 20,
      spread: 4,
    });
  }
  touring = true;
  send({ type: "pause", paused: false });
  status.textContent = "Material impact inspection running";
});
function inspectExplosion(kind: "crash" | "collapse") {
  if (active || !ready) return;
  const p: Vec3 = [
    inspectionTarget[0],
    view.effects.ground(inspectionTarget[0], inspectionTarget[2]) + 5,
    inspectionTarget[2],
  ];
  view.effects.explosion({
    type: "explosion",
    p,
    water: false,
    power: kind === "crash" ? 0.65 : 0.8,
    seed: kind === "crash" ? 0xc2a5 : 0xc011,
    kind,
  });
  touring = true;
  send({ type: "pause", paused: false });
  status.textContent =
    kind === "crash"
      ? "Crash plume inspection running"
      : "Collapse dust inspection running";
}
document
  .querySelector("#inspect-crash")!
  .addEventListener("click", () => inspectExplosion("crash"));
document
  .querySelector("#inspect-collapse")!
  .addEventListener("click", () => inspectExplosion("collapse"));
document.querySelector("#inspect-water")!.addEventListener("click", () => {
  if (active || !ready) return;
  let point: Vec3 =
    world.sites.find((site) => site.kind === "harbor")?.p ??
    world.rivers?.[0]?.points[0] ??
    world.castle;
  let closest = Infinity;
  for (const river of world.rivers ?? [])
    for (const candidate of river.points) {
      const distance =
        (candidate[0] - inspectionTarget[0]) ** 2 +
        (candidate[2] - inspectionTarget[2]) ** 2;
      if (distance < closest) {
        closest = distance;
        point = candidate;
      }
    }
  const splash: Explosion = {
    type: "explosion",
    p: [point[0], point[1], point[2]],
    water: true,
    power: 1,
    seed: 0x7aa,
    kind: "impact",
  };
  view.effects.dust.emit(splash, false, view.effects.ground);
  touring = true;
  send({ type: "pause", paused: false });
  status.textContent = "Water splash inspection running";
});
document.querySelector("#inspect-water-laser")!.addEventListener("click", () => {
  if (active || !ready || !snapshot) return;
  let point: Vec3 | undefined,
    closest = Infinity;
  for (const river of world.rivers ?? [])
    for (const candidate of river.points) {
      const distance =
        (candidate[0] - inspectionTarget[0]) ** 2 +
        (candidate[2] - inspectionTarget[2]) ** 2;
      if (distance < closest) {
        closest = distance;
        point = candidate;
      }
    }
  if (!point) {
    status.textContent = "No river reaches are available for the laser review";
    return;
  }
  touring = false;
  send({ type: "pause", paused: true });
  inspectionTarget = point.slice() as Vec3;
  const strike: LaserStrike = {
    id: -1,
    p: inspectionTarget.slice() as Vec3,
    age: LASER.charge + 0.35,
    phase: "burning",
  };
  snapshot = { ...snapshot, lasers: [strike] };
  view.receive(snapshot);
  view.inspectCamera(
    [point[0] + 65, point[1] + 45, point[2] + 65],
    [point[0], point[1] + 80, point[2]],
  );
  status.textContent = "River laser waterline review";
  last = 0;
});
document.querySelector("#inspect-nuke")!.addEventListener("click", () => {
  if (active || !ready) return;
  view.rig.exitPhoto();
  touring = true;
  send({ type: "pause", paused: false });
  send({
    type: "debugBlast",
    p: inspectionTarget.slice() as Vec3,
    yield: "castle",
  });
  status.textContent = "Nuke inspection running";
});
document.querySelector("#restore-view")!.addEventListener("click", async () => {
  if (active || benchmarkRunning || checkingContext || !ready) return;
  touring = false;
  send({ type: "pause", paused: true });
  status.textContent = "Restoring isolated test world…";
  try {
    await store.clear();
    send({ type: "reset" });
    status.textContent = "Test world restored";
  } catch (error) {
    status.textContent = "Restore failed: " + String(error);
  }
});
document.querySelector("#viewpoint")!.addEventListener("change", inspect);
residentPose.addEventListener("change", () => {
  if (active || viewpoints.value !== "resident" || !snapshot) return;
  applyResidentReviewPose(snapshot);
  status.textContent = `Resident close-up · ${reviewedResidentId} · ${residentPose.selectedOptions[0].textContent}`;
  last = 0;
});
monsterPose.addEventListener("change", () => {
  if (active || viewpoints.value !== "monster" || !snapshot) return;
  applyMonsterReviewPose(snapshot);
  status.textContent = `Monster close-up · ${reviewedMonsterId} · ${monsterPose.selectedOptions[0].textContent}`;
  last = 0;
});
document.querySelector("#altitude")!.addEventListener("change", inspect);
document.querySelector("#distance")!.addEventListener("change", (event) => {
  if (!active)
    view.setRenderDistance(Number((event.target as HTMLSelectElement).value));
});
document.querySelector("#eyes")!.addEventListener("change", (event) => {
  if (!active) view.setGooglyEyes((event.target as HTMLInputElement).checked);
});
document.querySelector("#hour")!.addEventListener("change", (event) => {
  if (!active)
    send({
      type: "hour",
      hour: Number((event.target as HTMLSelectElement).value),
    });
  inspect();
});
document.querySelector("#tour")!.addEventListener("click", () => {
  if (active || !ready) return;
  inspect();
  touring = true;
  send({ type: "pause", paused: false });
  status.textContent = "Inspection running";
});
document.querySelector("#pause-tour")!.addEventListener("click", () => {
  if (active) return;
  touring = false;
  send({ type: "pause", paused: true });
  status.textContent = "Inspection paused";
});
document.querySelector("#load-seed")!.addEventListener("click", () => {
  if (active) return;
  const seed = Number(
    (document.querySelector("#seed") as HTMLInputElement).value,
  );
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    status.textContent = "Invalid test seed";
    return;
  }
  const url = new URL(location.href);
  url.searchParams.set("seed", String(seed));
  location.assign(url);
});
