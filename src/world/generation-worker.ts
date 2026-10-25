import { generateIsland } from "./generator.mjs";
import type { GenerationRequest } from "../types";
type Request = {
  seed?: number;
  type?: "generate";
  request?: GenerationRequest;
};
// The picker owns one cancellable worker and one complete island at a time.
self.onmessage = (event: MessageEvent<Request>) => {
  const report = (label: string, progress: number) =>
    postMessage({ type: "progress", label, progress });
  try {
    const baseline = generateIsland(
      event.data.request ?? event.data.seed!,
      report,
    );
    postMessage({ type: "generated", ...baseline }, [baseline.heights.buffer]);
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
