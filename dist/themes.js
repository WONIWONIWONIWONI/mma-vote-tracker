/* Restore the selected appearance before first paint; storage is optional. */
(() => {
  const root = document.documentElement;
  const key = "vote-track-theme";
  let theme = "light";
  try {
    if (localStorage.getItem(key) === "dark") theme = "dark";
  } catch {}
  root.dataset.theme = theme;
  const darkColors = {
    "#f7f8fc": "#100e19",
    "#fff": "#191725",
    "#ffffff": "#191725",
    "#f3f2ff": "#252237",
    "#f1f0ff": "#252237",
    "#efedff": "#41223c",
    "#f0efff": "#41223c",
    "#20213b": "#f5f0f6",
    "#71738b": "#aaa3b8",
    "#53566f": "#d4c7d2",
    "#e8eaf1": "#3b374d",
    "#ddd9ff": "#624354",
    "#dddfea": "#53404b",
    "#e5e0ff": "#443448",
    "#c9c4ff": "#8b536a",
    "#6055f5": "#ff7594",
    "#cf3c61": "#ff789a",
    "#d63b50": "#ff4757",
    "#227da8": "#4fc8e0",
    "#b8bacb": "#877b95",
    "#617d00": "#e6ff54",
    "#a96a00": "#ffc06c",
    "#177c60": "#83d9b5",
    "#6754ce": "#9cbcff",
    "#ab469e": "#ed94df",
    "#20213b55": "#000000aa",
    "#fffffff5": "#211823f2",
    "#6055f510": "#ff789a12",
    "#6055f50b": "#b997ff0b",
    "#fafaff": "#211b30",
    "#fff3e6": "#311c2a",
    "#fff5eb": "#2a1b20",
    "#94600e": "#ffc176",
    "#f0dfc5": "#72503b",
    "#f0f8f4": "#241925",
    "#d9e9e2": "#53404b",
  };
  function color(value) {
    if (root.dataset.theme !== "dark" || typeof value !== "string")
      return value;
    const team = window.TrackerConfig?.teams.find(
      (t) => t.color.toLowerCase() === value.toLowerCase(),
    );
    return team?.colorDark || darkColors[value.toLowerCase()] || value;
  }
  function updateButtons() {
    for (const button of document.querySelectorAll("[data-theme-choice]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.themeChoice === root.dataset.theme),
      );
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta)
      meta.content = root.dataset.theme === "dark" ? "#100e19" : "#f7f8fc";
  }
  function set(value, save = true) {
    if (!["light", "dark"].includes(value)) return;
    const changed = root.dataset.theme !== value;
    root.dataset.theme = value;
    if (save) {
      try {
        localStorage.setItem(key, value);
      } catch {}
    }
    updateButtons();
    if (changed)
      window.dispatchEvent(new CustomEvent("tracker:theme", { detail: value }));
  }
  window.TrackerTheme = {
    color,
    get current() {
      return root.dataset.theme;
    },
    set,
  };
  document.addEventListener("DOMContentLoaded", () => {
    updateButtons();
    for (const button of document.querySelectorAll("[data-theme-choice]"))
      button.addEventListener("click", () => set(button.dataset.themeChoice));
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key)
      set(event.newValue === "dark" ? "dark" : "light", false);
  });
})();
