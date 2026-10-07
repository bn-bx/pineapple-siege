type SaveButton = Pick<HTMLButtonElement, "disabled">;
type SaveStatus = Pick<HTMLElement, "textContent">;

/** Keep expensive canvas captures single-flight and expose their progress to assistive tech. */
export function createPhotoSaveAction(
  button: SaveButton,
  status: SaveStatus,
  capture: () => Promise<Blob>,
  download: (blob: Blob) => void | Promise<void>,
) {
  let saving = false;
  return async () => {
    if (saving || button.disabled) return;
    saving = true;
    button.disabled = true;
    status.textContent = "Preparing PNG…";
    try {
      await download(await capture());
      status.textContent = "Photo saved";
    } catch {
      status.textContent = "Could not save photo. Try again.";
    } finally {
      saving = false;
      button.disabled = false;
    }
  };
}
