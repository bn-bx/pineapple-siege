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

it.each([8, 9, CONFIG.version + 1])(
  "leaves non-sectioned version %i records for recovery without rewriting them",
  async (version) => {
    const historical = { version, marker: "protected", terrain: [[1, 22]] };
    const request = (result: unknown) => {
      const r = { result, onsuccess: undefined as (() => void) | undefined };
      queueMicrotask(() => r.onsuccess?.());
      return r;
    };
    const store = new SaveStore();
    const transaction = vi.fn(() => ({
      objectStore: () => ({
        get: () => request(historical),
        getAll: () => request([]),
      }),
    }));
    (store as any).db = { transaction };
    const write = vi.spyOn(store, "write");
    const baseline = vi.spyOn(store, "baseline");
    vi.stubGlobal("IDBKeyRange", { bound: () => ({}) });
    try {
      expect(await store.load()).toBe(historical);
      expect(historical).toEqual({
        version,
        marker: "protected",
        terrain: [[1, 22]],
      });
      expect(write).not.toHaveBeenCalled();
      expect(baseline).not.toHaveBeenCalled();
      expect(transaction).toHaveBeenCalledExactlyOnceWith("worlds");
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  },
);
