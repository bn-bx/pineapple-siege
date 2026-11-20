import * as THREE from "three";
import type { ItemSlot } from "../economy/pricing";
import { setBlastTheme } from "./explosion-palette";
import { setCloudTheme } from "./nuke-cloud";

/** How each bought cosmetic looks; ids match the shop catalog. */
const JET_PAINT: Record<string, { color: string; metalness?: number; roughness?: number }> = {
  "jet-gold": { color: "#e9b949", metalness: 0.8, roughness: 0.22 },
  "jet-midnight": { color: "#24324f" },
  "jet-pink": { color: "#ff5fa2" },
  "jet-chrome": { color: "#f4f6f8", metalness: 1, roughness: 0.08 },
  "jet-diamond": { color: "#a8f0ff", metalness: 1, roughness: 0.02 },
};
const TRUCK_PAINT: Record<string, string> = {
  "truck-red": "#d23b2a",
  "truck-army": "#5a6b34",
  "truck-pearl": "#ece8df",
};
const FLAME: Record<string, string> = {
  "trail-plasma": "#4fb8ff",
  "trail-toxic": "#7dff4f",
  "trail-royal": "#b06bff",
};
export const BLAST_THEMES: Record<string, { particles: string[]; flash: string }> = {
  "blast-ice": { particles: ["#e6f8ff", "#9fd8ff", "#4fa3e0", "#8aa3b8"], flash: "#bfe9ff" },
  "blast-toxic": { particles: ["#eaffb0", "#9dff4f", "#4fbf2a", "#7c8f5c"], flash: "#c8ff8a" },
  "blast-inferno": { particles: ["#ffd0a0", "#ff5a2a", "#b3121f", "#5c2a2a"], flash: "#ff7a4a" },
};
export const CLOUD_THEMES: Record<string, { body: string; band: string; leaf: string }> = {
  "cloud-watermelon": { body: "#e85a6b", band: "#2f7a3a", leaf: "#2d6b33" },
  "cloud-blueberry": { body: "#5266c9", band: "#2e3a7a", leaf: "#4a8a5a" },
  "cloud-golden": { body: "#ffd34a", band: "#c59a1a", leaf: "#f3e7a0" },
  "cloud-rainbow": { body: "#ff6ad5", band: "#6ad1ff", leaf: "#b4ff6a" },
};

/** Recolors every material in `root` whose original color is `base`. */
function paint(
  root: THREE.Object3D | undefined,
  base: string,
  look?: { color: string; metalness?: number; roughness?: number },
) {
  // Compare through the same color conversion the materials went through.
  base = `#${new THREE.Color(base).getHexString()}`;
  root?.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      const original = (m.userData.paint ??= {
        color: `#${m.color.getHexString()}`,
        metalness: m.metalness,
        roughness: m.roughness,
      }) as { color: string; metalness: number; roughness: number };
      if (original.color !== base) continue;
      m.color.set(look?.color ?? original.color);
      m.metalness = look?.metalness ?? original.metalness;
      m.roughness = look?.roughness ?? original.roughness;
    }
  });
}

/** Tints the jet's engine flames (meshes named "flame"). */
function flame(root: THREE.Object3D, color?: string) {
  for (const child of root.children) {
    if (child.name !== "flame") continue;
    const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const original = (m.userData.flame ??= `#${m.color.getHexString()}`) as string;
    m.color.set(color ?? original);
  }
}

export interface CosmeticTargets {
  jet: THREE.Object3D;
  truck?: THREE.Object3D;
}

export function applyCosmetics(
  targets: CosmeticTargets,
  equipped: Partial<Record<ItemSlot, string>>,
) {
  paint(targets.jet, "#d4e0d9", JET_PAINT[equipped.jetPaint ?? ""]);
  const truck = TRUCK_PAINT[equipped.truckPaint ?? ""];
  paint(targets.truck, "#f2b705", truck ? { color: truck } : undefined);
  flame(targets.jet, FLAME[equipped.trail ?? ""]);
  setBlastTheme(BLAST_THEMES[equipped.blast ?? ""]);
  setCloudTheme(CLOUD_THEMES[equipped.cloud ?? ""]);
  if (typeof document !== "undefined")
    document.body.dataset.hudTheme = equipped.hud?.replace("hud-", "") ?? "";
}
