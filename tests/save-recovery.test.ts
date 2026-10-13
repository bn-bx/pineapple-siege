import { expect, it, vi } from "vitest";
import { SaveStore } from "../src/storage";
import { CONFIG } from "../src/config";
import type { SaveSnapshot } from "../src/types";

it("returns older sectioned saves untouched without decoding moving rubble on the new grid", async () => {
  const old = {
    version: CONFIG.version - 1,
    sectioned: true,
    moving: { count: 1, buffer: new ArrayBuffer(50) },
  } as SaveSnapshot;
  const request = (result: unknown) => {
    const r = { result, onsuccess: undefined as (() => void) | undefined };
    queueMicrotask(() => r.onsuccess?.());
    return r;
  };
  const objects = {
    get: vi.fn(() => request(old)),
    getAll: vi.fn(() => request([{ obsolete: true }])),
  };
  const transaction = vi.fn(() => ({ objectStore: () => objects }));
  const store = new SaveStore();
  (store as any).db = { transaction };
  const baseline = vi
    .spyOn(store, "baseline")
    .mockRejectedValue(Error("Old grid"));
  vi.stubGlobal("IDBKeyRange", { bound: vi.fn(() => ({})) });
  try {
    expect(await store.load()).toBe(old);
    expect(baseline).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledExactlyOnceWith("worlds");
    expect(old.moving?.count).toBe(1);
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
