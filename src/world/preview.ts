import {
  parseIslandCode,
  generationRequest,
  seedCode,
  type IslandBaseline,
} from "./generator.mjs";
import { Color, SRGBColorSpace } from "three";
import { terrainSurfaceColor } from "../render/terrain-colors";
import { fieldSample } from "./landscape.mjs";
import type { GenerationRequest, WorldData } from "../types";
const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** Render the actual candidate, never a separate approximate generation. */
export function drawIslandPreview(
  canvas: HTMLCanvasElement,
  baseline: IslandBaseline,
  compact = false,
) {
  drawMap(
    canvas,
    baseline.world,
    baseline.heights,
    baseline.world.grid,
    baseline.world.step,
    768,
    compact,
  );
}
type MapWorld = Pick<
  WorldData,
  "size" | "paths" | "sites" | "rivers" | "lakes" | "regions" | "spawn"
> & { entities?: WorldData["entities"] };
export function drawLayoutPreview(
  canvas: HTMLCanvasElement,
  preview: MapWorld & { heights: Float32Array; grid: number; step: number },
) {
  drawMap(
    canvas,
    preview,
    preview.heights,
    preview.grid,
    preview.step,
    256,
    true,
  );
}
function drawMap(
  canvas: HTMLCanvasElement,
  world: MapWorld,
  heights: Float32Array,
  grid: number,
  step: number,
  resolution: number,
  compact = false,
) {
  const colorSample = new Color(),
    rgb = { r: 0, g: 0, b: 0 },
    sample = (x: number, z: number) => fieldSample(heights, grid, step, x, z);
  const ctx = canvas.getContext("2d")!;
  canvas.width = canvas.height = resolution;
  const image = ctx.createImageData(resolution, resolution),
    scale = world.size / resolution;
  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const wx = x * scale,
        wz = z * scale,
        h = sample(wx, wz),
        slope = (sample(wx - 8, wz - 8) - sample(wx + 8, wz + 8)) / 40;
      const light = Math.max(0.5, Math.min(1.18, 0.93 + slope)),
        i = (z * resolution + x) * 4;
      const color =
        h < 0
          ? [
              22 + Math.max(0, 1 + h / 30) * 26,
              54 + Math.max(0, 1 + h / 30) * 55,
              65 + Math.max(0, 1 + h / 30) * 51,
            ]
          : h < 6
            ? [181, 170, 133]
            : h > 550
              ? [128, 132, 123]
              : h > 250
                ? [107, 115, 88]
                : [89, 118, 74];
      if (world.regions && h >= 0) {
        const terrainSlope =
          Math.hypot(
            sample(wx - 8, wz) - sample(wx + 8, wz),
            sample(wx, wz - 8) - sample(wx, wz + 8),
          ) / 16;
        terrainSurfaceColor(
          colorSample,
          wx,
          wz,
          h,
          terrainSlope,
          world.regions,
          false,
        );
        colorSample.getRGB(rgb, SRGBColorSpace);
        color[0] = rgb.r * 255;
        color[1] = rgb.g * 255;
        color[2] = rgb.b * 255;
      }
      image.data[i] = color[0] * (h < 0 ? 1 : light);
      image.data[i + 1] = color[1] * (h < 0 ? 1 : light);
      image.data[i + 2] = color[2] * (h < 0 ? 1 : light);
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  ctx.save();
  ctx.scale(1 / scale, 1 / scale);
  ctx.fillStyle = "rgba(27,76,48,.32)";
  for (const e of world.entities ?? [])
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
  ctx.strokeStyle = "#4d929b";
  ctx.lineCap = "round";
  for (const river of world.rivers ?? [])
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1],
        b = river.points[i];
      ctx.lineWidth =
        (river.widths?.[i - 1] ?? river.width) +
        (river.widths?.[i] ?? river.width);
      ctx.beginPath();
      ctx.moveTo(a[0], a[2]);
      ctx.lineTo(b[0], b[2]);
      ctx.stroke();
    }
  ctx.fillStyle = "#4d929b";
  for (const lake of world.lakes ?? []) {
    ctx.beginPath();
    lake.outline.forEach(([x, z], i) =>
      i ? ctx.lineTo(x, z) : ctx.moveTo(x, z),
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  for (const s of world.sites) {
    if (
      compact &&
      s.kind !== "pineapple-god" &&
      !s.kind.includes("castle") &&
      s.kind !== "harbor"
    )
      continue;
    const x = s.p[0] / scale,
      z = s.p[2] / scale;
    ctx.fillStyle =
      s.kind === "pineapple-god"
        ? "#ffd65b"
        : s.kind.includes("castle")
          ? "#f4d680"
          : s.kind === "harbor"
            ? "#91e1e1"
            : "#ece5d0";
    ctx.strokeStyle = "#263d36";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (s.kind === "pineapple-god") {
      ctx.moveTo(x, z - 9);
      ctx.lineTo(x + 7, z);
      ctx.lineTo(x, z + 9);
      ctx.lineTo(x - 7, z);
      ctx.closePath();
    } else if (s.kind.includes("castle")) ctx.rect(x - 5, z - 5, 10, 10);
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
    get("rerollIsland").onclick = () =>
      this.generate(generationRequest(randomSeed()));
    get("previewSeedForm").onsubmit = (event) => {
      event.preventDefault();
      try {
        this.generate(
          parseIslandCode(get<HTMLInputElement>("previewSeed").value),
        );
      } catch (error) {
        this.status((error as Error).message);
        get("previewSeed").setAttribute("aria-invalid", "true");
      }
    };
    get("keepIsland").onclick = () => {
      if (!this.candidate) return;
      if (this.replacing) {
        get("islandReplacePrompt").hidden = false;
        get<HTMLButtonElement>("confirmIsland").focus();
      } else this.finish(this.candidate);
    };
    get("confirmIsland").onclick = () => {
      if (this.candidate) this.finish(this.candidate);
    };
    get("backToIsland").onclick = () => {
      get("islandReplacePrompt").hidden = true;
      get<HTMLButtonElement>("keepIsland").focus();
    };
    get("cancelIsland").onclick = () => this.finish(undefined);
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (this.current) this.finish(undefined);
    });
  }
  choose(
    seed: number | GenerationRequest | undefined,
    current: boolean,
    replacing = current,
    notice = "",
  ) {
    get("islandSeedNotice").textContent = notice;
    this.replacing = replacing;
    this.current = current;
    get<HTMLButtonElement>("cancelIsland").hidden = !current;
    get("keepIsland").textContent = replacing
      ? "Use this island"
      : "Start flying";
    get("islandReplacePrompt").hidden = true;
    get<HTMLDetailsElement>("islandSeedDetails").open = false;
    this.dialog.showModal();
    const promise = new Promise<IslandBaseline | undefined>(
      (resolve) => (this.resolve = resolve),
    );
    this.generate(generationRequest(seed ?? randomSeed()));
    return promise;
  }
  private status(message: string) {
    get("islandPreviewStatus").textContent = message;
  }
  private invalidate() {
    ++this.generation;
    this.worker?.terminate();
    this.worker = undefined;
    this.candidate = undefined;
    get("islandReplacePrompt").hidden = true;
    get<HTMLButtonElement>("keepIsland").disabled = true;
    get<HTMLInputElement>("previewSeed").removeAttribute("aria-invalid");
    get<HTMLProgressElement>("islandProgress").value = 0;
  }
  private generate(request: GenerationRequest) {
    this.invalidate();
    get("islandMap").hidden = true;
    this.dialog.setAttribute("aria-busy", "true");
    get<HTMLInputElement>("previewSeed").value = seedCode(request);
    this.status("Making your island…");
    const generation = this.generation,
      worker = (this.worker = new Worker(
        new URL("./generation-worker.ts", import.meta.url),
        { type: "module" },
      ));
    const failed = (message: string) => {
      this.dialog.setAttribute("aria-busy", "false");
      this.status(`${message} Try New island. Your saved island is safe.`);
      get<HTMLButtonElement>("keepIsland").disabled = true;
    };
    worker.onmessage = (event) => {
      if (generation !== this.generation) return;
      const message = event.data;
      if (message.type === "progress") {
        get<HTMLProgressElement>("islandProgress").value = message.progress;
      } else if (message.type === "generated") {
        this.candidate = { world: message.world, heights: message.heights };
        drawIslandPreview(get("islandMap"), this.candidate, true);
        get("islandMap").hidden = false;
        this.dialog.setAttribute("aria-busy", "false");
        this.status("Ready to explore. Or make another island.");
        get<HTMLButtonElement>("keepIsland").disabled = false;
        get<HTMLProgressElement>("islandProgress").value = 1;
        worker.terminate();
        this.worker = undefined;
      } else if (message.type === "error") failed(message.message);
    };
    worker.onerror = () => {
      if (generation === this.generation) failed("Generation was interrupted.");
    };
    worker.postMessage({ type: "generate", request });
  }
  private finish(baseline: IslandBaseline | undefined) {
    this.invalidate();
    this.dialog.close();
    this.resolve?.(baseline);
    this.resolve = undefined;
  }
}
