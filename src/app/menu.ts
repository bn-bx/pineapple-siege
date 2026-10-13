import { MapNavigation } from "./map-navigation";
import type { PlaneState, Vec3 } from "../types";
import type { IslandBaseline } from "../world/generator.mjs";
import { drawIslandPreview } from "../world/preview";

/** Menu state and its reference map never alter gameplay or saved preferences. */
export function bindMenu(plane: () => PlaneState | undefined) {
  const element = (id: string) => document.getElementById(id)!;
  const overlay = element("overlay");
  const entries = [
    { name: "home", tab: "openSettings", panel: "menuSettings" },
    { name: "map", tab: "openMap", panel: "menuMap" },
    { name: "controls", tab: "openControls", panel: "menuControls" },
  ] as const;
  type View = (typeof entries)[number]["name"];
  let current: View = "home";
  let mapSize = 0;
  let spawn: Vec3 | undefined;
  const navigation = new MapNavigation();
  const baseMap = document.createElement("canvas");
  function renderMap() {
    if (!mapSize) return;
    const canvas = element("pauseMap") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    const scale = navigation.zoom;
    ctx.translate(
      canvas.width * (0.5 - navigation.center[0] * scale),
      canvas.height * (0.5 - navigation.center[1] * scale),
    );
    ctx.scale(scale, scale);
    ctx.drawImage(baseMap, 0, 0);
    ctx.restore();
    const aircraft = plane();
    const p = aircraft?.p ?? spawn!;
    const point = navigation.screen(p);
    const x = point[0] * canvas.width,
      y = point[1] * canvas.height;
    ctx.beginPath();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI - (aircraft?.yaw ?? 0));
    ctx.moveTo(0, -12);
    ctx.lineTo(8, 10);
    ctx.lineTo(0, 6);
    ctx.lineTo(-8, 10);
    ctx.closePath();
    ctx.fillStyle = "#edc777";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#14242c";
    ctx.stroke();
    ctx.restore();
    ctx.font = "15px sans-serif";
    for (const landmark of navigation.landmarks) {
      const [u, v] = navigation.screen(landmark.p);
      if (u < 0 || v < 0 || u > 1 || v > 1) continue;
      if (navigation.zoom >= 2 || navigation.waypoint?.id === landmark.id) {
        ctx.fillStyle = "#14242c";
        ctx.fillText(
          landmark.name,
          u * canvas.width + 10,
          v * canvas.height - 8,
        );
      }
      if (navigation.waypoint?.id === landmark.id) {
        ctx.beginPath();
        ctx.arc(u * canvas.width, v * canvas.height, 15, 0, Math.PI * 2);
        ctx.strokeStyle = "#ff6846";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    element("mapWaypoint").textContent =
      navigation.guidance(p) || "Select a landmark to set a waypoint.";
    element("mapPosition").textContent =
      `Aircraft: ${Math.round(p[0])} m east · ${Math.round(p[2])} m south`;
    canvas.setAttribute(
      "aria-label",
      `Island terrain, roads, rivers, and landmarks. Aircraft at ${Math.round(p[0])} meters east and ${Math.round(p[2])} meters south.`,
    );
  }
  function show(next: View, focus = true) {
    current = next;
    for (const entry of entries) {
      const selected = entry.name === next;
      element(entry.panel).hidden = !selected;
      element(entry.tab).setAttribute("aria-selected", String(selected));
      element(entry.tab).tabIndex = selected ? 0 : -1;
    }
    overlay.dataset.view = next;
    overlay.scrollTop = 0;
    if (next === "map") renderMap();
    if (focus)
      element(entries.find((entry) => entry.name === next)!.tab).focus();
  }
  for (const [index, entry] of entries.entries()) {
    const tab = element(entry.tab) as HTMLButtonElement;
    tab.onclick = () => show(entry.name);
    tab.onkeydown = (event) => {
      const forward = ["ArrowRight", "ArrowDown"].includes(event.key);
      const backward = ["ArrowLeft", "ArrowUp"].includes(event.key);
      if (!forward && !backward && !["Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? entries.length - 1
            : (index + (forward ? 1 : -1) + entries.length) % entries.length;
      while ((element(entries[next].tab) as HTMLButtonElement).disabled)
        next = (next + (backward ? -1 : 1) + entries.length) % entries.length;
      show(entries[next].name);
    };
  }
  element("backFromControls").onclick = () => show("home");
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.code !== "Escape" || overlay.hidden) return;
      // Native dialogs own Escape, including destructive confirmations.
      if (document.querySelector("dialog[open]")) {
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (current !== "home") show("home");
    },
    true,
  );
  const map = element("pauseMap") as HTMLCanvasElement;
  const landmarkSelect = element("mapLandmark") as HTMLSelectElement;
  const updateWaypoint = () => {
    landmarkSelect.value = navigation.waypoint?.id ?? "";
    renderMap();
    element("navigationStatus").textContent = navigation.guidance(
      plane()?.p ?? spawn!,
    );
  };
  landmarkSelect.onchange = () => {
    navigation.waypoint = navigation.landmarks.find(
      (l) => l.id === landmarkSelect.value,
    );
    updateWaypoint();
  };
  element("clearWaypoint").onclick = () => {
    navigation.waypoint = undefined;
    updateWaypoint();
  };
  element("zoomMapIn").onclick = () => {
    navigation.setZoom(navigation.zoom * 1.5);
    renderMap();
  };
  element("zoomMapOut").onclick = () => {
    navigation.setZoom(navigation.zoom / 1.5);
    renderMap();
  };
  element("resetMap").onclick = () => {
    navigation.reset();
    renderMap();
  };
  map.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      navigation.setZoom(navigation.zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2));
      renderMap();
    },
    { passive: false },
  );
  let drag: { x: number; y: number; moved: boolean } | undefined;
  map.onpointerdown = (event) => {
    drag = { x: event.clientX, y: event.clientY, moved: false };
    map.setPointerCapture(event.pointerId);
  };
  map.onpointermove = (event) => {
    if (!drag) return;
    const rect = map.getBoundingClientRect(),
      dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3 || drag.moved) {
      drag.moved = true;
      navigation.pan(dx / rect.width, dy / rect.height);
      renderMap();
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
  };
  map.onpointerup = (event) => {
    if (drag && !drag.moved) {
      const r = map.getBoundingClientRect();
      navigation.selectAt(
        (event.clientX - r.left) / r.width,
        (event.clientY - r.top) / r.height,
        0.03,
      );
      updateWaypoint();
    }
    drag = undefined;
  };
  map.onpointercancel = () => {
    drag = undefined;
  };
  show("home", false);
  return {
    update() {
      if (!spawn) return;
      const label = element("navigationStatus"),
        guidance = navigation.guidance(plane()?.p ?? spawn);
      if (label.textContent !== guidance) label.textContent = guidance;
    },
    home() {
      show("home", false);
      ((element("enter") as HTMLButtonElement).disabled
        ? element("openSettings")
        : element("enter")
      ).focus();
    },
    setIsland(baseline: IslandBaseline) {
      // Cache only the small raster; do not retain another terrain array or regenerate.
      drawIslandPreview(baseMap, baseline);
      navigation.setIsland(baseline.world);
      landmarkSelect.replaceChildren(
        new Option("Choose a landmark…", ""),
        ...navigation.landmarks.map((l) => new Option(l.name, l.id)),
      );
      element("navigationStatus").textContent = "";
      mapSize = baseline.world.size;
      spawn = baseline.world.spawn;
      (element("openMap") as HTMLButtonElement).disabled = false;
    },
  };
}
