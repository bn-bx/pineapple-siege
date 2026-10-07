export type SessionMode =
  | "loading"
  | "menu"
  | "playing"
  | "photo-entering"
  | "photo"
  | "island-preview"
  | "recovery";

/** One presentation mode; worker readiness is a separate lifecycle capability. */
export class SessionState {
  mode: SessionMode = "loading";
  private initialized = false;
  get ready() {
    return this.initialized && this.mode !== "recovery";
  }
  get active() {
    return this.mode === "playing";
  }
  get photoPending() {
    return this.mode === "photo-entering";
  }
  get photoMode() {
    return this.mode === "photo";
  }
  get contextLost() {
    return this.mode === "recovery";
  }
  loading() {
    this.initialized = false;
    this.mode = "loading";
  }
  loaded() {
    this.initialized = true;
    if (this.mode === "loading") this.mode = "menu";
  }
  play() {
    if (this.ready) this.mode = "playing";
  }
  pause() {
    if (this.mode !== "loading" && this.mode !== "recovery") this.mode = "menu";
  }
  requestPhoto() {
    if (this.active) this.mode = "photo-entering";
  }
  photoReady() {
    if (this.photoPending) this.mode = "photo";
  }
  preview() {
    this.mode = "island-preview";
  }
  recover() {
    this.mode = "recovery";
  }
  restored() {
    this.mode = this.initialized ? "menu" : "loading";
  }
}
