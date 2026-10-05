import {
  parseSeedCode,
  seedCode,
  sampleHeight,
  type IslandBaseline,
} from "./generator.mjs";
const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** Render the actual candidate, never a separate approximate generation. */
export function drawIslandPreview(
  canvas: HTMLCanvasElement,
  baseline: IslandBaseline,
) {
  const { world, heights } = baseline,
    ctx = canvas.getContext("2d")!;
  canvas.width = canvas.height = 768;
  const image = ctx.createImageData(768, 768),
    scale = world.size / 768;
  for (let z = 0; z < 768; z++)
    for (let x = 0; x < 768; x++) {
      const wx = x * scale,
        wz = z * scale,
        h = sampleHeight(heights, wx, wz),
        slope =
          (sampleHeight(heights, wx - 8, wz - 8) -
            sampleHeight(heights, wx + 8, wz + 8)) /
          40;
      const light = Math.max(0.5, Math.min(1.35, 0.93 + slope)),
        i = (z * 768 + x) * 4;
      const color =
        h < 0
          ? [
              29 + Math.max(0, 22 + h),
              76 + Math.max(0, 35 + h),
              95 + Math.max(0, 35 + h),
            ]
          : h < 6
            ? [192, 183, 132]
            : h > 550
              ? [139, 150, 141]
              : h > 250
                ? [110, 128, 87]
                : [92, 134, 75];
      image.data[i] = color[0] * (h < 0 ? 1 : light);
      image.data[i + 1] = color[1] * (h < 0 ? 1 : light);
      image.data[i + 2] = color[2] * (h < 0 ? 1 : light);
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  ctx.save();
  ctx.scale(1 / scale, 1 / scale);
  ctx.fillStyle = "rgba(27,76,48,.32)";
  for (const e of world.entities)
    if (e.kind === "tree") {
      ctx.beginPath();
      ctx.arc(
        e.p[0],
        e.p[2],
        e.treeSpecies === "broadleaf" ? 17 : 12,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  ctx.strokeStyle = "#cbbc90";
  ctx.lineWidth = 8;
  ctx.lineJoin = "round";
  for (const path of world.paths) {
    ctx.beginPath();
    path.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.stroke();
  }
  ctx.strokeStyle = "#73c1c8";
  ctx.lineCap = "round";
  for (const river of world.rivers ?? []) {
    ctx.lineWidth = river.width * 2;
    ctx.beginPath();
    river.points.forEach(([x, , z], i) =>
      i ? ctx.lineTo(x, z) : ctx.moveTo(x, z),
    );
    ctx.stroke();
  }
  ctx.restore();
  for (const s of world.sites) {
    const x = s.p[0] / scale,
      z = s.p[2] / scale;
    ctx.fillStyle = s.kind.includes("castle")
      ? "#f4d680"
      : s.kind === "harbor"
        ? "#91e1e1"
        : "#ece5d0";
    ctx.strokeStyle = "#263d36";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (s.kind.includes("castle")) ctx.rect(x - 5, z - 5, 10, 10);
    else ctx.arc(x, z, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  const x = world.spawn[0] / scale,
    z = world.spawn[2] / scale;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(x, z - 7);
  ctx.lineTo(x - 5, z + 5);
  ctx.lineTo(x + 5, z + 5);
  ctx.closePath();
  ctx.fill();
}
export class IslandPreview {
  private worker?: Worker;
  private candidate?: IslandBaseline;
  private resolve?: (baseline: IslandBaseline | undefined) => void;
  private current = false;
  private replacing = false;
  private generation = 0;
  readonly dialog = get<HTMLDialogElement>("islandPreview");
  constructor() {
    get("rerollIsland").onclick = () => this.generate(randomSeed());
    get("previewSeedForm").onsubmit = (e) => {
      e.preventDefault();
      try {
        this.generate(
          parseSeedCode(get<HTMLInputElement>("previewSeed").value),
        );
      } catch (error) {
        this.status(String((error as Error).message));
        get<HTMLButtonElement>("keepIsland").disabled = true;
        get<HTMLInputElement>("previewSeed").setAttribute(
          "aria-invalid",
          "true",
        );
      }
    };
    get("keepIsland").onclick = () => {
      if (!this.candidate) return;
      if (this.replacing) {
        get("islandReplacePrompt").hidden = false;
        get<HTMLButtonElement>("confirmIsland").focus();
      } else this.finish(this.candidate);
    };
    get("confirmIsland").onclick = () => this.finish(this.candidate);
    get("backToIsland").onclick = () => {
      get("islandReplacePrompt").hidden = true;
      get<HTMLButtonElement>("keepIsland").focus();
    };
    get("cancelIsland").onclick = () => this.finish(undefined);
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (this.current) this.finish(undefined);
    });
  }
  choose(
    seed: number | undefined,
    current: boolean,
    replacing = current,
    notice = "",
  ) {
    get("islandSeedNotice").textContent = notice;
    this.replacing = replacing;
    this.current = current;
    get<HTMLButtonElement>("cancelIsland").disabled = !current;
    get("islandReplacePrompt").hidden = true;
    this.dialog.showModal();
    const result = new Promise<IslandBaseline | undefined>(
      (resolve) => (this.resolve = resolve),
    );
    this.generate(seed ?? randomSeed());
    return result;
  }
  private status(message: string) {
    get("islandPreviewStatus").textContent = message;
  }
  private generate(seed: number) {
    const generation = ++this.generation;
    this.worker?.terminate();
    this.candidate = undefined;
    get("islandReplacePrompt").hidden = true;
    get<HTMLButtonElement>("keepIsland").disabled = true;
    get<HTMLCanvasElement>("islandMap").hidden = true;
    get<HTMLInputElement>("previewSeed").value = seedCode(seed);
    get<HTMLInputElement>("previewSeed").removeAttribute("aria-invalid");
    this.status("Generating your island…");
    get<HTMLProgressElement>("islandProgress").value = 0;
    this.worker = new Worker(
      new URL("./generation-worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = (event) => {
      if (generation !== this.generation) return;
      const message = event.data;
      if (message.type === "progress") {
        this.status(message.label);
        get<HTMLProgressElement>("islandProgress").value = message.progress;
      }
      if (message.type === "error") {
        this.status(message.message);
        this.worker?.terminate();
      }
      if (message.type === "generated") {
        this.candidate = { world: message.world, heights: message.heights };
        drawIslandPreview(get("islandMap"), this.candidate);
        get("islandMap").hidden = false;
        let peak = 0;
        for (const height of this.candidate.heights)
          peak = Math.max(peak, height);
        get("islandLandmarks").textContent =
          `3 castles · 2 harbors · 2 lighthouses · ${message.world.rivers.length} rivers · 664 residents · Highest peak ${Math.round(peak)} m`;
        this.status(
          `Your island is ready. Highest peak: ${Math.round(peak)} m. Reroll, enter another seed, or keep this one.`,
        );
        get<HTMLButtonElement>("keepIsland").disabled = false;
        get<HTMLProgressElement>("islandProgress").value = 1;
        this.worker?.terminate();
        this.worker = undefined;
      }
    };
    this.worker.onerror = () => {
      if (generation !== this.generation) return;
      this.status("Island generation was interrupted. Try Reroll.");
      this.worker?.terminate();
    };
    this.worker.postMessage({ seed });
  }
  private finish(baseline: IslandBaseline | undefined) {
    ++this.generation;
    this.worker?.terminate();
    this.worker = undefined;
    this.candidate = undefined;
    this.dialog.close();
    this.resolve?.(baseline);
    this.resolve = undefined;
  }
}
