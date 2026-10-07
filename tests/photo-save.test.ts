import { expect, it, vi } from "vitest";
import { createPhotoSaveAction } from "../src/photo-save";

it("keeps photo captures single-flight and reports progress", async () => {
  let finish!: (blob: Blob) => void;
  const button = { disabled: false };
  const status = { textContent: "" };
  const capture = vi.fn(
    () => new Promise<Blob>((resolve) => (finish = resolve)),
  );
  const download = vi.fn();
  const save = createPhotoSaveAction(button, status, capture, download);

  const first = save();
  expect(button.disabled).toBe(true);
  expect(status.textContent).toBe("Preparing PNG…");
  await save();
  expect(capture).toHaveBeenCalledTimes(1);

  const image = new Blob(["scene"]);
  finish(image);
  await first;
  expect(download).toHaveBeenCalledWith(image);
  expect(status.textContent).toBe("Photo saved");
  expect(button.disabled).toBe(false);
});

it("restores the save control and reports capture failures", async () => {
  const button = { disabled: false };
  const status = { textContent: "" };
  const save = createPhotoSaveAction(
    button,
    status,
    async () => {
      throw Error("canvas unavailable");
    },
    vi.fn(),
  );

  await save();
  expect(button.disabled).toBe(false);
  expect(status.textContent).toBe("Could not save photo. Try again.");
});
