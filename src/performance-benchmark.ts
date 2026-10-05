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
  soak = false;
const cases = [120, 400].flatMap((count) =>
  ["flight", "nuke", "laser"].map((kind) => ({ count, kind, duration: 30 })),
);
const results: unknown[] = [];
const frames: number[] = [];
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
let lastResource = 0;
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
    await view.prewarm();
    // Finish initial terrain while deliberately paused; first combat shaders remain prewarmed.
    for (let i = 0; i < 240; i++) {
      view.terrain.update(view.camera.position.set(...world.spawn));
      if (i > 10 && !view.terrain.queueDepth) break;
      await new Promise((r) => setTimeout(r, 16));
    }
    ready = true;
    readyResolve();
    if (caseIndex < 0 && !benchmarkRunning)
      document
        .querySelectorAll<HTMLButtonElement>("#run,#soak")
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
async function beginCase(index: number) {
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
  const c = soak ? { count: 400, kind: "mixed", duration: 900 } : cases[index];
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
  if (c.kind === "flight") {
    view.clearInspect();
    view.setChase();
  } else
    view.inspectCamera(
      [world.castle[0] - 180, 300, world.castle[2] - 250],
      [world.castle[0], 80, world.castle[2]],
    );
  frames.length =
    cpu.length =
    ticks.length =
    saveSlices.length =
    captures.length =
    delivery.length =
      0;
  handlerWork = 0;
  lastStatus = 0;
  view.performance.reset();
  await audio.start();
  resources.length = 0;
  lastResource = 0;
  caseIndex = index;
  started = performance.now();
  last = 0;
  nextStrike = started;
  lastSave = started;
  active = true;
  send({ type: "pause", paused: false });
}
function frame(now: number) {
  requestAnimationFrame(frame);
  if (!ready || !snapshot) return;
  if (!active && !touring && now - last < 100) return;
  const raw = last ? now - last : 1000 / 60;
  last = now;
  const c = soak
    ? { count: 400, kind: "mixed", duration: 900 }
    : cases[caseIndex];
  if (active) {
    if (document.hidden) {
      status.textContent = "Paused: foreground required";
      send({ type: "pause", paused: true });
      active = false;
      return;
    }
    frames.push(raw);
    if (document.visibilityState === "visible" && document.hasFocus())
      foregroundFrames++;
    if (c.kind !== "flight" && now >= nextStrike) {
      const n = Math.floor((now - started) / 100),
        radius = soak ? 350 : 80;
      const p: [number, number, number] = [
        world.castle[0] + Math.sin(n * 0.3) * radius,
        world.castle[1],
        world.castle[2] + Math.cos(n * 0.3) * radius,
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
      nextStrike += 100;
      // Each request remains authoritative. A slow browser never queues a burst of catch-up inputs.
      if (nextStrike < now - 100) nextStrike = now + 100;
    }
    if (now - lastSave >= 1000 && !saving) {
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
      status.textContent = `${c.kind} / ${c.count} monsters · ${elapsed.toFixed(0)} / ${c.duration}s · ${view.stats.quality}p`;
    }
    if (now - lastResource >= 10000) {
      lastResource = now;
      resources.push({
        elapsed,
        heapBytes: (performance as any).memory?.usedJSHeapSize ?? null,
        queues: { ...view.performance.queues },
        render: view.stats,
      });
    }
    if (elapsed >= c.duration) {
      active = false;
      audio.pause();
      send({ type: "pause", paused: true });
      const stats = frameStats(frames, Infinity),
        fps = (frames.length * 1000) / frames.reduce((a, b) => a + b, 0);
      const main = summarize(cpu),
        simulation = summarize(ticks),
        saveCapture = summarize(captures);
      results.push({
        case: c,
        frames: { ...stats, fps, total: frames.length },
        environment: {
          userAgent: navigator.userAgent,
          viewport: [innerWidth, innerHeight],
          seed: world.seed,
          distance: 1200,
          foregroundFraction: foregroundFrames / frames.length,
        },
        main,
        saveCapture,
        simulation,
        storage: summarize(saveSlices),
        render: view.stats,
        resources: resources.slice(),
        audio: audio.stats,
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
          saveCapture.maxMS <= 2,
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
          .querySelectorAll<HTMLButtonElement>("#run,#soak")
          .forEach((b) => (b.disabled = false));
      }
    }
  }
  const t = performance.now();
  view.render(Math.min(raw / 1000, 0.1), active || touring, now);
  if (active || touring) {
    const p = view.camera.position.toArray() as [number, number, number];
    audio.update(snapshot.plane.speed, p, view.cameraDirection());
    audio.syncLasers(snapshot.lasers, p);
    audio.syncDisco(discoActive(snapshot.lasers), snapshot.time);
  }
  if (active) {
    cpu.push(performance.now() - t + handlerWork);
    handlerWork = 0;
  }
}
requestAnimationFrame(frame);
document.querySelector("#run")!.addEventListener("click", () => {
  if (benchmarkRunning) return;
  benchmarkRunning = true;
  void audio.start().catch(() => {});
  soak = false;
  results.length = 0;
  document
    .querySelectorAll<HTMLButtonElement>("#run,#soak")
    .forEach((b) => (b.disabled = true));
  const selected = Number(
    (document.querySelector("#case") as HTMLSelectElement).value,
  );
  caseLimit = selected < 0 ? cases.length : selected + 1;
  void beginCase(Math.max(0, selected));
});
document.querySelector("#soak")!.addEventListener("click", () => {
  if (benchmarkRunning) return;
  benchmarkRunning = true;
  void audio.start().catch(() => {});
  soak = true;
  results.length = 0;
  document
    .querySelectorAll<HTMLButtonElement>("#run,#soak")
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

function inspect() {
  if (active || !ready) return;
  const kind = (document.querySelector("#viewpoint") as HTMLSelectElement)
    .value;
  let p = world.castle.slice();
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
