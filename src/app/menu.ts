/** Menu navigation stays independent of gameplay and persisted preferences. */
export function bindMenu() {
  const element = (id: string) => document.getElementById(id)!;
  const overlay = element("overlay");
  const views = {
    home: element("menuHome"),
    settings: element("menuSettings"),
    controls: element("menuControls"),
  };
  let current: keyof typeof views = "home";
  const categories = ["flight", "graphics", "audio", "world"];
  function category(selected: string, focus = false) {
    for (const name of categories) {
      const tab = element(`tab-${name}`);
      const active = name === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      element(`panel-${name}`).hidden = !active;
      if (active && focus) tab.focus();
    }
  }
  function show(next: keyof typeof views, focus = true) {
    const previous = current;
    current = next;
    for (const [name, view] of Object.entries(views))
      view.hidden = name !== next;
    overlay.dataset.view = next;
    overlay.scrollTop = 0;
    if (next === "settings") category("flight");
    if (focus) {
      const target =
        next === "settings"
          ? "settingsTitle"
          : next === "controls"
            ? "controlsTitle"
            : previous === "settings"
              ? "openSettings"
              : previous === "controls"
                ? "openControls"
                : "enter";
      const button = element(target) as HTMLButtonElement;
      (button.disabled ? element("openSettings") : button).focus();
    }
  }
  element("openSettings").onclick = () => show("settings");
  element("openControls").onclick = () => show("controls");
  element("backFromSettings").onclick = () => show("home");
  element("backFromControls").onclick = () => show("home");
  for (const [index, name] of categories.entries()) {
    const tab = element(`tab-${name}`);
    tab.onclick = () => category(name);
    tab.onkeydown = (event) => {
      const forward = ["ArrowRight", "ArrowDown"].includes(event.key);
      const backward = ["ArrowLeft", "ArrowUp"].includes(event.key);
      if (!forward && !backward && !["Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? categories.length - 1
            : (index + (forward ? 1 : -1) + categories.length) %
              categories.length;
      category(categories[next], true);
    };
  }
  const mobile = matchMedia("(max-width: 650px)");
  const orientation = () =>
    element("tab-flight").parentElement!.setAttribute(
      "aria-orientation",
      mobile.matches ? "horizontal" : "vertical",
    );
  mobile.addEventListener("change", orientation);
  orientation();
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.code !== "Escape" || overlay.hidden) return;
      // Native dialogs own Escape while open, including destructive confirmations.
      if (document.querySelector("dialog[open]")) {
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (current !== "home") show("home");
    },
    true,
  );
  show("home", false);
  return { home: () => show("home") };
}
