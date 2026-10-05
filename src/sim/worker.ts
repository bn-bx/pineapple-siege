import { PerformanceMonitor } from "../performance";
import { fixedDestruction } from "../destruction-settings";
import { StepScheduler } from "./step-scheduler";
import { DEFAULT_MONSTER_COUNT } from "../config";
import { Simulation, initializePhysics } from "./simulation";
import type { GameCommand, WorkerMessage, WorldData } from "../types";
let sim: Simulation | undefined,
  world: WorldData,
  base: Float32Array,
  debug = false,
  paused = true;
let epoch = 1;
let slots = Array.from({ length: 8 }, () => ({
  busy: false,
  bodies: undefined as ArrayBuffer | undefined,
  actors: undefined as ArrayBuffer | undefined,
}));
let pendingPublish: boolean | undefined;
let saveSliceMS = 0,
  snapshotMS = 0;
const stepSamples: number[] = [];
function publish(pausedPacket = false) {
  if (!sim) return;
  const slot = slots.findIndex((s) => !s.busy);
  if (slot < 0) {
    pendingPublish = pausedPacket || pendingPublish === true;
    return;
  }
  const pool = slots[slot];
  pool.busy = true;
  const started = performance.now(),
    snapshot = sim.snapshot(true, pool);
  snapshot.epoch = epoch;
  snapshot.slot = slot;
  pool.bodies = pool.actors = undefined;
  snapshotMS = performance.now() - started;
  snapshot.stats.saveSliceMS = saveSliceMS;
  snapshot.stats.snapshotMS = snapshotMS;
  snapshot.stats.packetPoolBusy = slots.reduce((n, s) => n + Number(s.busy), 0);
  snapshot.stats.packetPoolBytes = slots.reduce(
    (n, s) => n + (s.bodies?.byteLength ?? 0) + (s.actors?.byteLength ?? 0),
    snapshot.packedBodies!.buffer.byteLength +
      snapshot.packedMotion!.buffer.byteLength,
  );
  monitor.record("snapshot", snapshotMS);
  if (debug) {
    snapshot.stats.stepSamples = stepSamples.splice(0);
  }
  send(pausedPacket ? { type: "paused", snapshot } : snapshot);
}
const monitor = new PerformanceMonitor();
let saveRunning = false;
let saveToken = 0;
function retireIslandWork() {
  pendingPublish = undefined;
  saveRunning = false;
  saveToken++;
  stepSamples.length = 0;
  saveSliceMS = snapshotMS = 0;
  monitor.reset();
  slots = Array.from({ length: 8 }, () => ({
    busy: false,
    bodies: undefined,
    actors: undefined,
  }));
}
const scheduler = new StepScheduler();
const send = (m: WorkerMessage, port?: MessagePort) => {
  const transfer: Transferable[] = [];
  if (m.type === "delta") {
    if (m.terrain)
      transfer.push(
        m.terrain.indices.buffer as ArrayBuffer,
        m.terrain.values.buffer as ArrayBuffer,
      );
    if (m.flood) transfer.push(m.flood.buffer as ArrayBuffer);
    if (m.dry) transfer.push(m.dry.buffer as ArrayBuffer);
  }
  if (m.type === "ready")
    transfer.push(
      m.heights,
      m.flood.buffer as ArrayBuffer,
      ...(m.waterMask ? [m.waterMask.buffer as ArrayBuffer] : []),
    );
  if (m.type === "saved" && m.save.terrain instanceof Float32Array)
    transfer.push(m.save.terrain.buffer as ArrayBuffer);
  if (m.type === "saved") {
    if (m.save.moving) transfer.push(m.save.moving.buffer);
    transfer.push(m.save.laserDry.buffer as ArrayBuffer);
    for (const s of m.save.sections ?? [])
      transfer.push(
        s.terrain.buffer as ArrayBuffer,
        s.dry.buffer as ArrayBuffer,
      );
  }
  const snapshot =
    m.type === "snapshot" ? m : m.type === "paused" ? m.snapshot : undefined;
  if (snapshot?.packedBodies) transfer.push(snapshot.packedBodies.buffer);
  if (snapshot?.packedMotion) transfer.push(snapshot.packedMotion.buffer);
  if (port) port.postMessage(m, transfer);
  else postMessage(m, transfer);
};
function ready() {
  if (!sim) return;
  const flood = new Uint32Array();
  const waterMask = sim.terrain.waterMask();
  send({
    type: "ready",
    removed: [...sim.removed],
    ruins: [...sim.ruins.values()],
    heights: sim.terrain.heights.slice().buffer,
    flood,
    waterMask,
    hour: sim.hour,
  });
  publish();
}
self.onmessage = async (event: MessageEvent<GameCommand>) => {
  const m = event.data;
  try {
    if (m.type === "init") {
      paused = true;
      retireIslandWork();
      sim?.dispose();
      epoch = m.epoch ?? epoch + 1;
      world = m.world;
      base = new Float32Array(m.heights);
      debug = !!m.debug;
      await initializePhysics();
      sim = new Simulation(world, base, send, m.save, true);
      sim.setMonsterCount(m.monsterCount ?? DEFAULT_MONSTER_COUNT);
      while (
        sim.supportJobs.length ||
        sim.pendingJobs.length ||
        sim.laserWork.size ||
        sim.laserSupport.size
      ) {
        sim.processLaserWork(3);
        sim.processDestruction(3);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      sim.nukeYield = "valley";
      sim.setDestruction(fixedDestruction(m.destruction));
      ready();
      scheduler.reset(performance.now());
      return;
    }
    if (!sim) return;
    switch (m.type) {
      case "recycleMotion": {
        if (m.epoch !== epoch || !slots[m.slot]) break;
        slots[m.slot] = { busy: false, bodies: m.bodies, actors: m.actors };
        if (pendingPublish !== undefined) {
          const pausedPacket = pendingPublish;
          pendingPublish = undefined;
          publish(pausedPacket);
        }
        break;
      }
      case "input":
        sim.input = m.input;
        break;
      case "pause":
        paused = m.paused;
        if (!paused) stepSamples.length = 0;
        scheduler.reset(performance.now());
        if (paused) publish(true);
        break;
      case "weapon":
        sim.weapon = m.weapon;
        publish();
        break;
      case "nukeYield":
        sim.nukeYield = "valley";
        publish();
        break;
      case "destructionSettings":
        sim.setDestruction(fixedDestruction(m.value));
        publish();
        break;
      case "monsterCount":
        sim.setMonsterCount(m.value);
        publish();
        break;
      case "respawn":
        sim.respawn();
        publish();
        break;
      case "hour":
        sim.hour = m.hour;
        publish();
        break;
      case "holdTime":
        sim.holdTime = m.hold;
        break;
      case "save": {
        if (saveRunning) {
          m.port?.postMessage({ error: "A save capture is already running" });
          m.port?.close();
          break;
        }
        saveRunning = true;
        const token = ++saveToken,
          owner = sim,
          generator = sim.captureSave(),
          slices: number[] = [];
        let delivered = false;
        try {
          while (owner === sim) {
            const started = performance.now(),
              result = generator.next();
            saveSliceMS = performance.now() - started;
            monitor.record("saveSlice", saveSliceMS);
            slices.push(saveSliceMS);
            if (result.done) {
              const dispatchStarted = performance.now();
              send(
                {
                  type: "saved",
                  request: m.request,
                  save: result.value,
                  slices,
                },
                m.port,
              );
              const dispatchMS = performance.now() - dispatchStarted;
              saveSliceMS = Math.max(saveSliceMS, dispatchMS);
              monitor.record("saveDispatch", dispatchMS);
              m.port?.postMessage({ type: "saveDispatch", ms: dispatchMS });
              delivered = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } finally {
          if (!delivered)
            m.port?.postMessage({
              error: "Island changed during save capture",
            });
          m.port?.close();
          if (token === saveToken) saveRunning = false;
        }
        break;
      }
      case "saveAck":
        sim.acknowledgeSave(m.capture);
        break;
      case "reset": {
        epoch++;
        retireIslandWork();
        const settings = sim.destruction;
        const count = sim.monsterCount;
        sim.dispose();
        sim = new Simulation(world, base, send, undefined, true);
        sim.nukeYield = "valley";
        sim.setDestruction(settings);
        sim.setMonsterCount(count);
        paused = true;
        ready();
        send({ type: "resetDone" });
        break;
      }
      case "debugBlast":
        if (debug) {
          if (m.yield) sim.detonateNuke(m.p, m.yield);
          else sim.explode(m.p);
          sim.physics.step();
          publish();
        }
        break;
      case "debugLaser":
        if (debug) {
          sim.startLaser(m.p);
          publish();
        }
        break;
      case "debugPlane":
        if (debug) {
          sim.plane.p = m.p;
          sim.plane.yaw = m.yaw;
          sim.plane.pitch = m.pitch;
          sim.plane.crashed = 0;
          publish();
        }
        break;
      case "debugStep":
        if (debug) {
          for (let i = 0; i < m.steps; i++) sim.step();
          publish();
          send({ type: "debugResult", state: sim.snapshot(true).stats });
        }
        break;
    }
  } catch (e) {
    send({
      type: "error",
      message: e instanceof Error ? e.stack || e.message : String(e),
    });
  }
};
setInterval(() => {
  if (!sim || paused) {
    scheduler.reset(performance.now());
    return;
  }
  const steps = scheduler.advance(performance.now(), () => {
    const started = performance.now();
    sim!.step();
    const ms = performance.now() - started;
    monitor.record("tick", ms);
    if (debug && stepSamples.length < 64) stepSamples.push(ms);
  });
  if (steps && scheduler.shouldPublish(performance.now())) publish();
}, 8);
