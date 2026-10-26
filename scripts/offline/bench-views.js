// Steady-state frame-time benchmark for fixed views, run inside the game page
// (open it with ?island=PS7-0000A301#debug). Load with
//   await import("/bench-views.js")   // when copied next to the preview's index.html
// then call  benchStart()  and poll  window.__benchResult  (null while running).
// Each view: the camera is placed, the sun's shadow focus is pinned to the view,
// the aircraft is parked high, the game warms up for `warm` seconds (terrain and
// scenery streaming cause long frames after a camera jump), then requestAnimationFrame
// intervals are recorded for `secs` seconds. Time of day runs, as in normal play.
export const VIEWS = {
  low: { hour: 17, target: "castle", angle: 0.75, dist: 420, up: 140, look: 40 },
  valley: { hour: 17, target: "castle", angle: 1.75, dist: 2200, up: 350, look: 0 },
  high: { hour: 17, target: "castle", angle: 1.0, dist: 900, up: 600, look: 0 },
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function benchView(name, secs = 10, warm = 16) {
  const view = VIEWS[name], lv = window.lanternVale, w = lv.world, v = lv.view, env = v.environment;
  if (!env.__wrapped) {
    const u = env.update.bind(env);
    env.update = (s, c, p, ...r) => u(s, c, window.__focus ?? p, ...r);
    env.__wrapped = true;
  }
  const statue = w.entities.filter((e) => e.visual && e.visual.shape !== "portal-stone");
  let gx = 0, gz = 0;
  for (const e of statue) { gx += e.p[0]; gz += e.p[2]; }
  const targets = { castle: w.castles?.[0]?.p ?? w.landmarks.keep, god: [gx / statue.length, 0, gz / statue.length] };
  const t = targets[view.target], a = Math.PI * view.angle;
  const x = t[0] + Math.cos(a) * view.dist, z = t[2] + Math.sin(a) * view.dist;
  const ground = Math.max(0, lv.terrain(x, z)), tg = lv.terrain(t[0], t[2]);
  const eye = [x, Math.min(1450, Math.max(ground + view.up, tg + view.up)), z], look = [t[0], tg + view.look, t[2]];
  const dx = look[0] - x, dz = look[2] - z, dl = Math.hypot(dx, dz);
  window.__focus = new v.camera.position.constructor(x + (dx / dl) * 40, eye[1] - 8, z + (dz / dl) * 40);
  lv.send({ type: "holdTime", hold: false });
  lv.send({ type: "hour", hour: view.hour });
  lv.inspect(eye, look);
  lv.setPlane([x, 1400, z], 0, 0);
  await wait(warm * 1000);
  const jobs0 = v.performance.queues.sunMaskJobs ?? 0;
  const d = [];
  let last = performance.now(), stop = false;
  const loop = (tt) => { d.push(tt - last); last = tt; if (!stop) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  await wait(secs * 1000);
  stop = true;
  const total = d.reduce((s, x) => s + x, 0);
  d.sort((p, q) => p - q);
  const q = (p) => +d[Math.floor(p * (d.length - 1))].toFixed(1);
  return {
    name, fps: +((1000 * d.length) / total).toFixed(1), median: q(0.5), p95: q(0.95), p99: q(0.99),
    stalls: d.filter((x) => x > 100).length, draws: v.renderer.info.render.calls, tris: v.renderer.info.render.triangles,
    shadowHalf: env.sun.shadow.camera.right, maskJobs: (v.performance.queues.sunMaskJobs ?? 0) - jobs0,
    maskMS: v.performance.queues.sunMaskComputeMS ?? null,
  };
}
export function benchStart(names = Object.keys(VIEWS), options = {}) {
  window.__benchResult = null;
  (async () => {
    const until = async (f) => { while (!f()) await wait(250); };
    await until(() => window.lanternVale?.state?.ready || (document.getElementById("keepIsland") && !document.getElementById("keepIsland").disabled));
    if (!window.lanternVale?.state?.ready) document.getElementById("keepIsland").click();
    await until(() => window.lanternVale?.state.ready && !document.getElementById("enter").disabled);
    if (!window.lanternVale.state.active) { window.lanternVale.setQuality(options.quality ?? "1440"); window.lanternVale.enter(); }
    if (options.setup) await options.setup(window.lanternVale);
    const out = [];
    for (const n of names) out.push(await benchView(n, options.secs, options.warm));
    window.__benchResult = out;
  })().catch((e) => (window.__benchResult = { error: String(e) }));
  return "started";
}
window.benchStart = benchStart;

// Interleaved A/B on the current view: alternates configurations in rounds so
// heat build-up and background load affect each equally. A configuration sets
// haze on/off and the largest shadow-box half-extent (null = quality default).
// Poll window.__abResult.
export function abStart(configs = { none: { fog: false, reach: 220 }, current: { fog: true, reach: null } }, rounds = 3, settle = 5, secs = 6) {
  window.__abResult = null;
  const v = window.lanternVale.view, env = v.environment;
  const proto = Object.getPrototypeOf(v), desc = Object.getOwnPropertyDescriptor(proto, "visualProfile");
  const fog = v.scene.fog, hazeDensity = env.sky.material.uniforms.hazeDensity?.value;
  let reach = null;
  Object.defineProperty(v, "visualProfile", { configurable: true, get() { const p = desc.get.call(v); return reach ? { ...p, shadowReach: reach } : p; } });
  const measure = async () => {
    const d = []; let last = performance.now(), stop = false;
    const loop = (t) => { d.push(t - last); last = t; if (!stop) requestAnimationFrame(loop); };
    requestAnimationFrame(loop); await wait(secs * 1000); stop = true;
    return (1000 * d.length) / d.reduce((s, x) => s + x, 0);
  };
  (async () => {
    const res = Object.fromEntries(Object.keys(configs).map((k) => [k, []]));
    for (let r = 0; r < rounds; r++)
      for (const [k, c] of Object.entries(configs)) {
        v.scene.fog = c.fog ? fog : null;
        if (env.sky.material.uniforms.hazeDensity) env.sky.material.uniforms.hazeDensity.value = c.fog ? hazeDensity : 0;
        reach = c.reach;
        await wait(settle * 1000);
        res[k].push(+(await measure()).toFixed(1));
      }
    v.scene.fog = fog; reach = null; delete v.visualProfile;
    window.__abResult = Object.fromEntries(Object.entries(res).map(([k, a]) => [k, { mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), runs: a }]));
  })().catch((e) => (window.__abResult = { error: String(e) }));
  return "started";
}

// Flight stutter test: flies a fixed straight route at a fixed quality with the
// chase camera, and records every frame interval plus where main-thread time
// went (render stages) for frames longer than `slowMS`. Poll window.__flightResult.
export function flightStart({ quality = "720", alt = 1100, yaw = 0, secs = 20, warm = 8, slowMS = 33, start, renderDistance, monsters } = {}) {
  window.__flightResult = null;
  (async () => {
    const until = async (f) => { while (!f()) await wait(250); };
    await until(() => window.lanternVale?.state?.ready || (document.getElementById("keepIsland") && !document.getElementById("keepIsland").disabled));
    if (!window.lanternVale?.state?.ready) document.getElementById("keepIsland").click();
    await until(() => window.lanternVale?.state.ready && !document.getElementById("enter").disabled);
    const lv = window.lanternVale, v = lv.view;
    if (!lv.state.active) lv.enter();
    lv.setQuality(quality);
    if (renderDistance) v.setRenderDistance(renderDistance);
    if (monsters) lv.send({ type: "monsterCount", value: monsters });
    lv.clearInspect();
    window.__focus = null;
    lv.send({ type: "holdTime", hold: false });
    lv.send({ type: "hour", hour: 16 });
    const s = start ?? [lv.world.size * 0.35, alt, lv.world.size * 0.35];
    lv.setPlane(s, yaw, 0);
    // Per-frame stage timers (main thread).
    const stages = {};
    const wrap = (obj, key, label) => {
      if (!obj || typeof obj[key] !== "function" || obj[key].__timed) return;
      const f = obj[key].bind(obj);
      const timed = (...a) => { const t = performance.now(); try { return f(...a); } finally { stages[label] = (stages[label] ?? 0) + performance.now() - t; } };
      timed.__timed = true; obj[key] = timed;
    };
    wrap(v, "render", "view.render");
    wrap(v.environment, "update", "environment");
    wrap(v.environment.sunMask, "update", "sunMask");
    wrap(v.terrain, "update", "terrain");
    wrap(v.worldView, "update", "worldBatches");
    wrap(v.renderer.shadowMap, "render", "shadowMap");
    wrap(v.renderer, "render", "three.render");
    await wait(warm * 1000);
    const frames = [];
    let last = performance.now(), stop = false;
    const loop = (t) => {
      const dt = t - last; last = t;
      const snapshot = { ...stages };
      for (const k in stages) stages[k] = 0;
      frames.push({ dt, ...snapshot });
      if (!stop) requestAnimationFrame(loop);
    };
    for (const k in stages) stages[k] = 0;
    requestAnimationFrame(loop);
    await wait(secs * 1000);
    stop = true;
    const dts = frames.map((f) => f.dt).sort((a, b) => a - b);
    const q = (p) => +dts[Math.floor(p * (dts.length - 1))].toFixed(1);
    const slow = frames.filter((f) => f.dt > slowMS);
    const avg = (list, k) => +(list.reduce((s, f) => s + (f[k] ?? 0), 0) / Math.max(1, list.length)).toFixed(2);
    const keys = ["view.render", "environment", "sunMask", "terrain", "worldBatches", "shadowMap", "three.render"];
    window.__flightResult = {
      quality: v.visualProfile.name, canvas: [v.renderer.domElement.width, v.renderer.domElement.height],
      fps: +((1000 * frames.length) / frames.reduce((s, f) => s + f.dt, 0)).toFixed(1),
      median: q(0.5), p95: q(0.95), p99: q(0.99), max: +dts.at(-1).toFixed(0),
      over33: frames.filter((f) => f.dt > 33).length, over50: frames.filter((f) => f.dt > 50).length, over100: frames.filter((f) => f.dt > 100).length,
      frames: frames.length,
      meanStages: Object.fromEntries(keys.map((k) => [k, avg(frames, k)])),
      slowStages: Object.fromEntries(keys.map((k) => [k, avg(slow, k)])),
      worst: frames.sort((a, b) => b.dt - a.dt).slice(0, 5).map((f) => Object.fromEntries(Object.entries(f).map(([k, x]) => [k, +x.toFixed(1)]))),
      shadowHalf: v.environment.sun.shadow.camera.right, sunMaskJobs: v.performance.queues.sunMaskJobs ?? null,
    };
  })().catch((e) => (window.__flightResult = { error: String(e?.stack ?? e) }));
  return "started";
}
