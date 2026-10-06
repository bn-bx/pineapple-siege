import { GameAudio } from "./audio";
import { discoActive } from "./disco";
import { checkStorage } from "./storage-checks";
import { GameRenderer } from "./render/renderer";
import { loadTerrain } from "./world-loader";
import { SaveStore, compatible } from "./storage";
import { SaveWriter } from "./save-writer";
import { frameStats } from "./frame-stats";
import { DEFAULT_DESTRUCTION } from "./destruction-settings";
import type {
  GameCommand,
  Vec3,
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
    view.receive(m.snapshot);
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
  if (kind === "aircraft" && snapshot) {
    const p = snapshot.plane.p;
    inspectionTarget = [p[0], p[1], p[2]];
    view.inspectCamera([p[0] + 18, p[1] + 9, p[2] + 22], p);
    last = 0;
    return;
  }
  let p = world.castle.slice();
  if (kind === "monster" && snapshot.monsters.length) {
    const position = snapshot.monsters[0].p;
    p = [position[0], position[1], position[2]];
    inspectionTarget = p as Vec3;
    const yaw = snapshot.monsters[0].yaw + 0.3;
    view.inspectCamera(
      [p[0] + Math.sin(yaw) * 120, p[1] + 45, p[2] + Math.cos(yaw) * 120],
      [p[0], p[1] + 32, p[2]],
    );
    last = 0;
    return;
  }
  const selectedSite = world.sites.find(
    (site) => site.kind === kind || (kind === "bridge" && site.kind === "crossing"),
  );
  if (selectedSite) p = selectedSite.p.slice();
  if (kind === "coast")
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
  const offset = altitude === 12 ? 90 : altitude === 1200 ? 1200 : 180;
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
