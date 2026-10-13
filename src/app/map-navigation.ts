import type { Vec3, WorldData } from "../types";
export interface MapLandmark {
  id: string;
  name: string;
  p: Vec3;
}
export class MapNavigation {
  zoom = 1;
  center: [number, number] = [0.5, 0.5];
  waypoint?: MapLandmark;
  landmarks: MapLandmark[] = [];
  size = 1;
  setIsland(world: WorldData) {
    this.size = world.size;
    this.landmarks = world.sites.map((s) => ({
      id: s.id,
      p: s.p,
      name: `${s.town ? "Town" : s.kind.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase())} ${s.id === "castle" ? "1" : s.id.split("-").at(-1)}`,
    }));
    this.waypoint = undefined;
    this.reset();
  }
  reset() {
    this.zoom = 1;
    this.center = [0.5, 0.5];
  }
  setZoom(value: number) {
    this.zoom = Math.max(1, Math.min(6, value));
    this.constrain();
  }
  pan(dx: number, dz: number) {
    this.center[0] -= dx / this.zoom;
    this.center[1] -= dz / this.zoom;
    this.constrain();
  }
  private constrain() {
    const margin = 0.5 / this.zoom;
    this.center = this.center.map((v) =>
      Math.max(margin, Math.min(1 - margin, v)),
    ) as [number, number];
  }
  screen(p: Vec3): [number, number] {
    return [
      (p[0] / this.size - this.center[0]) * this.zoom + 0.5,
      (p[2] / this.size - this.center[1]) * this.zoom + 0.5,
    ];
  }
  selectAt(x: number, z: number, tolerance: number) {
    let best: MapLandmark | undefined,
      distance = tolerance;
    for (const landmark of this.landmarks) {
      const point = this.screen(landmark.p),
        d = Math.hypot(point[0] - x, point[1] - z);
      if (d < distance) {
        best = landmark;
        distance = d;
      }
    }
    if (best) this.waypoint = best;
    return best;
  }
  guidance(p: Vec3) {
    if (!this.waypoint) return "";
    const dx = this.waypoint.p[0] - p[0],
      dz = this.waypoint.p[2] - p[2];
    const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    return `${this.waypoint.name} · ${(Math.hypot(dx, dz) / 1000).toFixed(1)} km · ${Math.round(bearing) % 360}°`;
  }
}
