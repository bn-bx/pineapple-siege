import "./statue-review.css";
import { compareLandmarks, maskOverlap } from "./measurements";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CRTPass } from "../render/crt-pass";
import { createSculpt, type SculptAsset, type SurfaceMode } from "./sculpt";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const asset = (await fetch("/review/pineapple-god/sculpt.json").then((r) =>
  r.json(),
)) as SculptAsset;
const acceptance = await fetch(
  "/review/pineapple-god/visual-acceptance.json",
).then((r) => r.json());
const bodyAccepted =
  acceptance.body === "visually accepted by user" &&
  acceptance.bodyMeshRevision === asset.meshRevision;
interface Annotations {
  landmarks: Record<string, number[]>;
  headCrop: number[];
  headWidth: number;
  size: number[];
  maskProvenance: string;
}
const annotations = (await fetch("/review/pineapple-god/annotations.json").then(
  (r) => r.json(),
)) as Annotations;
const { width, height } = asset.camera;
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = asset.lighting.exposure;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#96becb");
const camera = new THREE.PerspectiveCamera(
  asset.camera.fov,
  width / height,
  asset.camera.near,
  asset.camera.far,
);
const referenceTexture = asset.surfaceProjection
  ? await new THREE.TextureLoader().loadAsync(
      "/review/pineapple-god/" + asset.surfaceProjection.texture,
    )
  : undefined;
if (referenceTexture) {
  referenceTexture.colorSpace = THREE.SRGBColorSpace;
  referenceTexture.anisotropy = Math.min(
    8,
    renderer.capabilities.getMaxAnisotropy(),
  );
}
const bodyTexture = asset.bodyProjection
  ? await new THREE.TextureLoader().loadAsync(
      "/review/pineapple-god/" + asset.bodyProjection.texture,
    )
  : undefined;
if (bodyTexture) {
  bodyTexture.colorSpace = THREE.SRGBColorSpace;
  bodyTexture.anisotropy = Math.min(
    8,
    renderer.capabilities.getMaxAnisotropy(),
  );
}
const clothTexture = asset.clothProjection
  ? await new THREE.TextureLoader().loadAsync(
      "/review/pineapple-god/" + asset.clothProjection.texture,
    )
  : undefined;
if (clothTexture) {
  clothTexture.colorSpace = THREE.SRGBColorSpace;
  clothTexture.anisotropy = Math.min(
    8,
    renderer.capabilities.getMaxAnisotropy(),
  );
}
const {
  group,
  materials,
  setSurfaceMode,
  dispose: disposeSculpt,
} = createSculpt(asset, referenceTexture, bodyTexture, clothTexture);
let surfaceMode: SurfaceMode = "photo";
scene.add(group);
scene.add(
  new THREE.HemisphereLight("#e5f2fb", "#919580", asset.lighting.ambient),
);
const sun = new THREE.DirectionalLight("#fff2d1", asset.lighting.sunIntensity);
sun.position.fromArray(asset.lighting.sunPosition);
scene.add(sun);
const fill = new THREE.DirectionalLight("#e3edf5", 0.4);
fill.position.set(0, 200, 1800);
scene.add(fill);
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType }),
);
composer.setPixelRatio(1);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());
const crt = new CRTPass();
crt.setMode("off");
composer.addPass(crt);
composer.setSize(width, height);
$("candidateWindow").append(renderer.domElement);
const marks = document.createElement("canvas");
marks.width = width;
marks.height = height;
marks.className = "observation-layer";
marks.style.pointerEvents = "none";
$("candidateWindow").append(marks);
let view = "body",
  display = "split";
const observationKey =
  "statue-review:" + asset.meshRevision + ":" + surfaceMode;
let observations: Record<string, number[]> = {};
try {
  observations = JSON.parse(localStorage.getItem(observationKey) ?? "{}");
} catch {
  /* A corrupt local review must not prevent inspection. */
}
interface ObservationRecord {
  meshRevision: string;
  method: string;
  uncertaintyPixels: number;
  observedOnImageSHA256: string;
  points: Record<string, number[]>;
}
const recorded = (await fetch("/review/pineapple-god/observed-landmarks.json")
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)) as ObservationRecord | null;
const observationRecord =
  recorded?.meshRevision === asset.meshRevision && !asset.surfaceProjection
    ? recorded
    : null;
if (Object.keys(observations).length === 0 && observationRecord)
  observations = observationRecord.points;
const faceNames = Object.keys(annotations.landmarks).slice(0, 16);
for (const name of faceNames) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  $("landmark").append(option);
}
function setCamera() {
  camera.position.fromArray(asset.camera.position);
  camera.lookAt(new THREE.Vector3().fromArray(asset.camera.target));
  if (view === "three") {
    camera.position.set(1100, 600, 1400);
    camera.lookAt(0, 520, 80);
  }
  if (view === "side") {
    camera.position.set(1700, 550, 150);
    camera.lookAt(0, 520, 80);
  }
  if (view === "head-three" || view === "head-side") {
    camera.position.fromArray(
      view === "head-three" ? [490, 840, 680] : [820, 820, 45],
    );
    camera.lookAt(10, 780, 35);
  }
  camera.updateMatrixWorld();
}
function draw() {
  setCamera();
  composer.render(0);
  drawMarks();
}
function drawMarks() {
  const ctx = marks.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);
  if (
    view === "side" ||
    view === "three" ||
    view === "head-three" ||
    view === "head-side"
  )
    return;
  for (const [name, p] of Object.entries(observations)) {
    const r = annotations.landmarks[name];
    if (!r) continue;
    const error = Math.hypot(p[0] - r[0], p[1] - r[1]) / annotations.headWidth;
    ctx.strokeStyle = error > 0.02 ? "#ff7055" : "#94f0c1";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r[0], r[1]);
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
    ctx.stroke();
  }
}
function layout() {
  $("panels").className =
    "panels" +
    (display === "overlay"
      ? " overlay"
      : display === "candidate"
        ? " only-candidate"
        : display === "reference"
          ? " only-reference"
          : "");
  const full = view !== "head" && view !== "body";
  for (const id of ["referenceWindow", "candidateWindow"]) {
    $(id).classList.toggle("whole", full);
    $(id).classList.toggle("body", view === "body");
  }
  renderer.domElement.style.opacity =
    display === "overlay" ? ($("opacity").getAttribute("value") ?? ".5") : "1";
  $("caption").textContent =
    view === "side" ||
    view === "three" ||
    view === "head-three" ||
    view === "head-side"
      ? "Unseen surfaces are inferred. Measurements only apply to the locked reference view."
      : surfaceMode === "photo"
        ? "Reference-derived surfaces on connected 3D anatomy. Baked photographic shadows remain. Use clay to judge geometry."
        : "Geometry inspection: reference texture disabled. Hidden surfaces are reconstructed from one source view.";
}
async function imagePixels(path: string) {
  const image = new Image();
  image.src = path;
  await image.decode();
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const context = c.getContext("2d")!;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}
const [refHead, refBody, valid] = await Promise.all(
  ["reference-head-mask.png", "reference-body-mask.png", "valid-mask.png"].map(
    (p) => imagePixels("/review/pineapple-god/" + p),
  ),
);
function renderMask(region?: string) {
  const target = new THREE.WebGLRenderTarget(width, height);
  const background = scene.background,
    override = scene.overrideMaterial;
  const material = new THREE.MeshBasicMaterial({
    color: "white",
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  scene.background = new THREE.Color("black");
  scene.overrideMaterial = material;
  const visible = group.children.map((o) => o.visible);
  group.children.forEach(
    (o) =>
      (o.visible = region
        ? o.userData.region === region
        : o.userData.region !== "throne"),
  );
  const oldTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const bytes = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes);
  renderer.setRenderTarget(oldTarget);
  scene.background = background;
  scene.overrideMaterial = override;
  group.children.forEach((o, i) => (o.visible = visible[i]));
  target.dispose();
  material.dispose();
  const result = new Uint8ClampedArray(bytes.length);
  for (let y = 0; y < height; y++)
    result.set(
      bytes.subarray((height - 1 - y) * width * 4, (height - y) * width * 4),
      y * width * 4,
    );
  if (region === "head") {
    result.fill(0, 0, 190 * width * 4);
    result.fill(0, 415 * width * 4);
  }
  return result;
}
let headIoU = 0,
  bodyIoU = 0;
function faceErrors() {
  return compareLandmarks(
    annotations.landmarks,
    observations,
    faceNames,
    annotations.headWidth,
  );
}
function report() {
  return {
    status: bodyAccepted
      ? "head-and-body-visually-accepted"
      : "body-awaiting-visual-acceptance",
    visualAcceptance: acceptance,
    headReview: asset.headApprovalPreserved
      ? "visually accepted; geometry and texture unchanged"
      : "not confirmed",
    liveGameModified: acceptance.inGame.startsWith("integrated"),
    reference: "reference.png",
    meshRevision: asset.meshRevision,
    scope:
      "Head ROI and figure-only silhouette; throne and architecture require visual review",
    camera: asset.camera,
    facialObservationMethod:
      observationRecord?.method ??
      "Visual picks on rendered candidate; never projected source fitting vertices",
    observationUncertaintyPixels: observationRecord?.uncertaintyPixels ?? null,
    observedOnImageSHA256: observationRecord?.observedOnImageSHA256 ?? null,
    lighting: {
      ...asset.lighting,
      sunPosition: sun.position.toArray(),
      crt: crt.enabled ? "subtle" : "off",
    },
    activeView: view,
    actualCameraPosition: camera.position.toArray(),
    surfaceMode,
    referenceSurface: asset.surfaceProjection,
    bodySurface: asset.bodyProjection,
    clothSurface: asset.clothProjection,
    renderBudget: {
      triangles: asset.parts.reduce((n, p) => n + p.triangles.length, 0),
      meshes: group.children.length,
    },
    geometryEvidence:
      "Inspect clay captures. Photo-surface facial landmarks are source-driven and cannot independently verify geometry.",
    headIoU,
    bodyIoU,
    face: {
      ...faceErrors(),
      nominalPass: faceErrors().pass,
      pass: surfaceMode !== "photo" && faceErrors().pass,
      certified: false,
      geometryGateEligible: surfaceMode !== "photo",
    },
    observationsSurface: surfaceMode,
    observations,
    thresholds: { headIoU: 0.97, bodyIoU: 0.95, meanFace: 0.01, maxFace: 0.02 },
    maskProvenance:
      annotations.maskProvenance +
      " Body cage fitting uses this trace; the figure score measures constraint satisfaction, not independent likeness.",
    limitations: [
      "Silhouette annotations are estimates; accessory contours are shared authoring constraints.",
      "Fitting scores do not certify likeness. Facial observations are approximate with roughly two-pixel uncertainty.",
      "Depth and unseen surfaces are unverified.",
      "Head and body use photo-derived UV detail with residual baked illumination. Appearance is not independent geometry evidence.",
      "Aircraft-occluded fabric uses a separate reconstructed cloth atlas; hidden fabric is unverified.",
      "Head outline is measured in the original y=190..414 ROI; the connected neck is outside that diagnostic.",
      "No game integration before explicit visual acceptance.",
    ],
  };
}
function metrics() {
  const f = faceErrors();
  $("metrics").innerHTML =
    `<div class="metric"><span>Accepted head</span><b class="pass">PRESERVED</b></div><div class="metric"><span>Head outline · ≥97%</span><b class="${headIoU >= 0.97 ? "pass" : "flag"}">${(headIoU * 100).toFixed(1)}% ${headIoU >= 0.97 ? "PASS" : "FLAG"}</b></div><div class="metric"><span>Figure outline · ≥95%</span><b class="${bodyIoU >= 0.95 ? "pass" : "flag"}">${(bodyIoU * 100).toFixed(1)}% ${bodyIoU >= 0.95 ? "PASS" : "FLAG"}</b></div><div class="metric"><span>Optional facial observations</span><b class="pending-text">${f.observed}/${f.required}</b></div><div class="metric"><span>${surfaceMode === "photo" ? "Photo anchors · not geometry proof" : "Mean / max face error"}</span><b class="${surfaceMode === "photo" ? "pending-text" : f.complete ? (f.pass ? "pass" : "flag") : "pending-text"}">${f.mean === null ? "NOT VERIFIED" : `${(f.mean * 100).toFixed(2)}% / ${(f.max! * 100).toFixed(2)}%`}</b></div><div class="metric"><span>Body visual review</span><b class="${bodyAccepted ? "pass" : "pending-text"}">${bodyAccepted ? "ACCEPTED" : "PENDING"}</b></div>`;
}
$("view").addEventListener("change", (e) => {
  view = (e.target as HTMLSelectElement).value;
  layout();
  draw();
});
$("display").addEventListener("change", (e) => {
  display = (e.target as HTMLSelectElement).value;
  layout();
  draw();
});
$("opacity").addEventListener("input", (e) => {
  const value = (e.target as HTMLInputElement).value;
  $("opacity").setAttribute("value", value);
  renderer.domElement.style.opacity = display === "overlay" ? value : "1";
});
$("annotations").addEventListener(
  "change",
  (e) =>
    ($("annotationImage").hidden = !(e.target as HTMLInputElement).checked),
);
$("wireframe").addEventListener("change", (e) => {
  for (const m of materials.values())
    m.wireframe = (e.target as HTMLInputElement).checked;
  draw();
});
function updateSurfaceMode(mode: SurfaceMode) {
  surfaceMode = mode;
  try {
    observations = JSON.parse(
      localStorage.getItem(
        "statue-review:" + asset.meshRevision + ":" + mode,
      ) ?? "{}",
    );
  } catch {
    observations = {};
  }
  setSurfaceMode(mode);
  metrics();
  $<HTMLSelectElement>("surface").value = mode;
  layout();
  draw();
}
$("surface").addEventListener("change", (e) =>
  updateSurfaceMode((e.target as HTMLSelectElement).value as SurfaceMode),
);
$("relight").addEventListener("change", (e) => {
  const alternate = (e.target as HTMLInputElement).checked;
  sun.position.fromArray(
    alternate ? [-850, 500, 1000] : asset.lighting.sunPosition,
  );
  draw();
});
$("crt").addEventListener("change", (e) => {
  crt.setMode((e.target as HTMLInputElement).checked ? "subtle" : "off");
  draw();
});
renderer.domElement.addEventListener("click", (e) => {
  if (display !== "candidate" || (view !== "head" && view !== "whole")) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * width,
    y = ((e.clientY - rect.top) / rect.height) * height;
  const name = $<HTMLSelectElement>("landmark").value;
  observations[name] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  localStorage.setItem(
    "statue-review:" + asset.meshRevision + ":" + surfaceMode,
    JSON.stringify(observations),
  );
  metrics();
  drawMarks();
  const select = $<HTMLSelectElement>("landmark");
  select.selectedIndex = Math.min(
    select.options.length - 1,
    select.selectedIndex + 1,
  );
});
$("clear").addEventListener("click", () => {
  observations = {};
  localStorage.removeItem(
    "statue-review:" + asset.meshRevision + ":" + surfaceMode,
  );
  metrics();
  drawMarks();
});
$("export").addEventListener("click", () => {
  const a = document.createElement("a");
  a.download = "pineapple-god-review.json";
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(report(), null, 2)], { type: "application/json" }),
  );
  a.click();
  URL.revokeObjectURL(a.href);
});
setCamera();
headIoU = maskOverlap(renderMask("head"), refHead, valid);
bodyIoU = maskOverlap(renderMask(), refBody, valid);
$<HTMLSelectElement>("view").value = view;
layout();
draw();
metrics();
// Expose deterministic captures to the local verification script, never to the game.
(window as unknown as { statueReview: unknown }).statueReview = {
  ready: true,
  report,
  draw,
  asset,
  setSurfaceMode: updateSurfaceMode,
  setCrt: (enabled: boolean) => {
    crt.setMode(enabled ? "subtle" : "off");
    draw();
  },
  setObservations: (value: Record<string, number[]>) => {
    observations = value;
    metrics();
  },
  setView: (value: string) => {
    view = value;
    $<HTMLSelectElement>("view").value = value;
    layout();
    draw();
  },
  capture: () => renderer.domElement.toDataURL("image/png"),
  mask: (region?: string) => {
    const data = renderMask(region);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas
      .getContext("2d")!
      .putImageData(new ImageData(data, width, height), 0, 0);
    draw();
    return canvas.toDataURL("image/png");
  },
};

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  disposeSculpt();
  for (const pass of composer.passes) pass.dispose();
  composer.dispose();
  renderer.dispose();
});
