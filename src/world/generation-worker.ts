import { generateIsland } from "./generator.mjs";
self.onmessage = (event: MessageEvent<{ seed: number }>) => {
  try {
    const baseline = generateIsland(event.data.seed, (label, progress) =>
      postMessage({ type: "progress", label, progress }),
    );
    postMessage({ type: "generated", ...baseline }, [baseline.heights.buffer]);
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
