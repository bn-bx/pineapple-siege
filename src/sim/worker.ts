import { Simulation, initializePhysics } from "./simulation";
import type { GameCommand, WorkerMessage, WorldData } from "../types";
let sim: Simulation | undefined,
  world: WorldData,
  base: Float32Array,
  debug = false,
  last = 0,
  accumulator = 0,
  paused = true;
const send = (m: WorkerMessage) => {
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
    transfer.push(m.heights, m.flood.buffer as ArrayBuffer);
  if (m.type === "saved" && m.save.terrain instanceof Float32Array)
    transfer.push(m.save.terrain.buffer as ArrayBuffer);
  if (m.type === "saved") transfer.push(m.save.laserDry.buffer as ArrayBuffer);
  const snapshot =
    m.type === "snapshot" ? m : m.type === "paused" ? m.snapshot : undefined;
  if (snapshot?.packedBodies) transfer.push(snapshot.packedBodies.buffer);
  postMessage(m, transfer);
};
function ready() {
  if (!sim) return;
  const flood = new Uint32Array(
    sim.terrain.flooded.reduce((a: number[], v, i) => {
      if (v) a.push(i);
      return a;
    }, []),
  );
  send({
    type: "ready",
    removed: [...sim.removed],
    ruins: [...sim.ruins.values()],
    heights: sim.terrain.heights.slice().buffer,
    flood,
    hour: sim.hour,
  });
  send(sim.snapshot(true));
}
self.onmessage = async (event: MessageEvent<GameCommand>) => {
  const m = event.data;
  try {
    if (m.type === "init") {
      world = m.world;
      base = new Float32Array(m.heights);
      debug = !!m.debug;
      await initializePhysics();
      sim = new Simulation(world, base, send, m.save);
      sim.setMonsterCount(m.monsterCount ?? 20);
      while (
        sim.pendingJobs.length ||
        sim.laserWork.size ||
        sim.laserSupport.size
      ) {
        sim.processLaserWork(3);
        sim.processDestruction(3);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (m.destruction) sim.setDestruction(m.destruction);
      ready();
      last = performance.now();
      return;
    }
    if (!sim) return;
    switch (m.type) {
      case "input":
        sim.input = m.input;
        break;
      case "pause":
        paused = m.paused;
        last = performance.now();
        accumulator = 0;
        if (paused) send({ type: "paused", snapshot: sim.snapshot(true) });
        break;
      case "weapon":
        sim.weapon = m.weapon;
        send(sim.snapshot(true));
        break;
      case "nukeYield":
        sim.nukeYield = m.value;
        send(sim.snapshot(true));
        break;
      case "destructionSettings":
        sim.setDestruction(m.value);
        send(sim.snapshot(true));
        break;
      case "monsterCount":
        sim.setMonsterCount(m.value);
        send(sim.snapshot(true));
        break;
      case "respawn":
        sim.respawn();
        send(sim.snapshot(true));
        break;
      case "hour":
        sim.hour = m.hour;
        send(sim.snapshot(true));
        break;
      case "holdTime":
        sim.holdTime = m.hold;
        break;
      case "save":
        send({ type: "saved", request: m.request, save: sim.save() });
        break;
      case "reset": {
        const settings = sim.destruction;
        const count = sim.monsterCount;
        sim.dispose();
        sim = new Simulation(world, base, send);
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
          send(sim.snapshot(true));
        }
        break;
      case "debugLaser":
        if (debug) {
          sim.startLaser(m.p);
          send(sim.snapshot(true));
        }
        break;
      case "debugPlane":
        if (debug) {
          sim.plane.p = m.p;
          sim.plane.yaw = m.yaw;
          sim.plane.pitch = m.pitch;
          sim.plane.crashed = 0;
          send(sim.snapshot(true));
        }
        break;
      case "debugStep":
        if (debug) {
          for (let i = 0; i < m.steps; i++) sim.step();
          send(sim.snapshot(true));
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
    last = performance.now();
    return;
  }
  const now = performance.now();
  accumulator += Math.min((now - last) / 1000, 0.1);
  last = now;
  let steps = 0;
  while (accumulator >= 1 / 60 && steps < 6) {
    sim.step();
    accumulator -= 1 / 60;
    steps++;
  }
  if (steps) send(sim.snapshot(true));
}, 8);
