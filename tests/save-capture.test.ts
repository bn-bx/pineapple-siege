import { expect, it } from "vitest";
import { SaveCaptureCoordinator } from "../src/save-capture";
import type { SaveSnapshot } from "../src/types";

it("cancels a reset capture and ignores its late reply and finally during a newer save", async () => {
  const captures = new SaveCaptureCoordinator();
  const old = captures.begin();
  let oldRequest = 0;
  const pending = captures.request((request) => {
    oldRequest = request;
  });
  const rejected = expect(pending).rejects.toThrow("Island changed");
  captures.retire();
  const current = captures.begin();
  captures.finish(old);
  expect(captures.saving).toBe(true);
  const snapshot = { revision: 12 } as SaveSnapshot;
  expect(captures.deliver(oldRequest, snapshot)).toBe(false);
  let request = 0;
  const next = captures.request((id) => {
    request = id;
  });
  expect(request).toBeGreaterThan(oldRequest);
  expect(captures.deliver(request, snapshot)).toBe(true);
  expect(await next).toBe(snapshot);
  await rejected;
  captures.finish(current);
  expect(captures.saving).toBe(false);
  expect(captures.pendingCount).toBe(0);
});
it("does not retain a capture whose worker send fails, and prevents overlapping saves", async () => {
  const captures = new SaveCaptureCoordinator();
  const owner = captures.begin();
  expect(() => captures.begin()).toThrow("already running");
  await expect(
    captures.request(() => {
      throw Error("worker stopped");
    }),
  ).rejects.toThrow("worker stopped");
  expect(captures.pendingCount).toBe(0);
  captures.finish(owner);
  expect(captures.saving).toBe(false);
});
