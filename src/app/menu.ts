import type { Vec3 } from "../types";
import type { IslandBaseline } from "../world/generator.mjs";
import { drawIslandPreview } from "../world/preview";

/** Menu state and its reference map never alter gameplay or saved preferences. */
export function bindMenu(position: () => Vec3 | undefined) {
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
  const baseMap = document.createElement("canvas");
  function renderMap() {
    if (!mapSize) return;
    const canvas = element("pauseMap") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseMap, 0, 0);
    const p = position() ?? spawn!;
    const x = (p[0] / mapSize) * canvas.width;
    const y = (p[2] / mapSize) * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#edc777";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#14242c";
    ctx.stroke();
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
  show("home", false);
  return {
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
      mapSize = baseline.world.size;
      spawn = baseline.world.spawn;
      (element("openMap") as HTMLButtonElement).disabled = false;
    },
  };
}
