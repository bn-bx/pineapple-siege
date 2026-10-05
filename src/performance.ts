export interface StageStats {
  count: number;
  meanMS: number;
  p95MS: number;
  p99MS: number;
  maxMS: number;
}
export interface PerformanceStats {
  stages: Record<string, StageStats>;
  queues: Record<string, number>;
  missedFrames: number;
  starvation: number;
}
/** Fixed storage, no per-frame sorting or growing telemetry arrays. Read on demand. */
export class PerformanceMonitor {
  constructor(private capacity = 1200) {}
  reset() {
    this.stages.clear();
    this.missedFrames = this.starvation = 0;
  }
  private stages = new Map<
    string,
    { data: Float32Array; count: number; cursor: number }
  >();
  readonly queues: Record<string, number> = {};
  missedFrames = 0;
  starvation = 0;
  record(name: string, ms: number) {
    if (!Number.isFinite(ms)) return;
    let stage = this.stages.get(name);
    if (!stage)
      this.stages.set(
        name,
        (stage = {
          data: new Float32Array(this.capacity),
          count: 0,
          cursor: 0,
        }),
      );
    stage.data[stage.cursor] = ms;
    stage.cursor = (stage.cursor + 1) % stage.data.length;
    stage.count = Math.min(stage.count + 1, stage.data.length);
    if (name === "frame" && ms > 33.3) this.missedFrames++;
  }
  get stats(): PerformanceStats {
    const stages: Record<string, StageStats> = {};
    for (const [name, stage] of this.stages) {
      const sorted = stage.data.slice(0, stage.count).sort();
      stages[name] = {
        count: stage.count,
        meanMS: sorted.reduce((a, b) => a + b, 0) / (stage.count || 1),
        p95MS:
          sorted[Math.min(stage.count - 1, Math.floor(stage.count * 0.95))] ||
          0,
        p99MS:
          sorted[Math.min(stage.count - 1, Math.floor(stage.count * 0.99))] ||
          0,
        maxMS: sorted.at(-1) || 0,
      };
    }
    return {
      stages,
      queues: { ...this.queues },
      missedFrames: this.missedFrames,
      starvation: this.starvation,
    };
  }
}
/** Asynchronous GPU queries. Never wait for completion or call finish/readPixels. */
export class GPUTimer {
  private extension: {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  private pending: { query: WebGLQuery; name: string }[] = [];
  private current?: { query: WebGLQuery; name: string };
  lastMS = 0;
  constructor(
    private gl: WebGL2RenderingContext,
    private monitor: PerformanceMonitor,
  ) {
    this.extension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }
  begin(name: string) {
    if (!this.extension || this.current || this.pending.length >= 8) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.current = { query, name };
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
  }
  end() {
    if (!this.current || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.current);
    this.current = undefined;
  }
  poll() {
    if (!this.extension || !this.pending.length) return;
    const disjoint = this.gl.getParameter(this.extension.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const first = this.pending[0];
      if (
        !this.gl.getQueryParameter(first.query, this.gl.QUERY_RESULT_AVAILABLE)
      )
        break;
      if (!disjoint) {
        const ms =
          this.gl.getQueryParameter(first.query, this.gl.QUERY_RESULT) / 1e6;
        this.lastMS = ms;
        this.monitor.record(first.name, ms);
      }
      this.gl.deleteQuery(first.query);
      this.pending.shift();
    }
    if (disjoint) {
      for (const { query } of this.pending) this.gl.deleteQuery(query);
      this.pending.length = 0;
    }
  }
  dispose() {
    this.end();
    for (const { query } of this.pending) this.gl.deleteQuery(query);
    this.pending.length = 0;
  }
  /** Lost-context queries cannot be ended, polled or deleted in the new context. */
  contextLost() {
    this.pending.length = 0;
    this.current = undefined;
    this.extension = null;
    this.lastMS = 0;
  }
  contextRestored() {
    this.contextLost();
    this.extension = this.gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }
}
