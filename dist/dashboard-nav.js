/* Accessible single-panel navigation. Switching views never requests data. */
(() => {
  const nav = document.querySelector(".dashboard-nav");
  const links = [...nav.querySelectorAll("a")];
  const items = links
    .map((link) => ({
      link,
      id: link.hash.slice(1),
      panel: document.getElementById(link.hash.slice(1)),
    }))
    .filter((item) => item.panel);
  const aliases = {
    overview: "overview-panel",
    leaders: "overview-panel",
    "share-leaders": "overview-panel",
    "share-trend": "trend-panel",
    "share-candles": "candle-panel",
    "share-forecast": "gap-future",
    "share-daily": "daily-panel",
    "share-hourly": "hourly-panel",
  };
  nav.setAttribute("role", "tablist");
  for (const item of items) {
    item.link.id = "tab-" + item.id;
    item.link.setAttribute("role", "tab");
    item.link.setAttribute("aria-controls", item.id);
    item.panel.setAttribute("role", "tabpanel");
    item.panel.setAttribute("aria-labelledby", item.link.id);
    item.panel.tabIndex = 0;
  }
  function select(value, { write = false, scroll = false } = {}) {
    const requested = aliases[value] || value;
    const current = items.find((item) => item.id === requested) || items[0];
    for (const item of items) {
      const selected = item === current;
      item.panel.hidden = !selected;
      item.link.setAttribute("aria-selected", String(selected));
      item.link.tabIndex = selected ? 0 : -1;
      if (selected) item.link.setAttribute("aria-current", "page");
      else item.link.removeAttribute("aria-current");
    }
    for (const help of document.querySelectorAll("[data-panel-for]"))
      help.hidden = !help.dataset.panelFor.split(" ").includes(current.id);
    if (current.panel instanceof HTMLDetailsElement) current.panel.open = true;
    document.documentElement.dataset.panel = current.id;
    if (write && location.hash !== "#" + current.id)
      history.pushState(null, "", "#" + current.id);
    window.dispatchEvent(
      new CustomEvent("tracker:panel", { detail: current.id }),
    );
    if (scroll) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      current.link.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "auto",
      });
    }
  }
  for (const [index, item] of items.entries()) {
    item.link.addEventListener("click", (event) => {
      event.preventDefault();
      select(item.id, { write: true, scroll: true });
    });
    item.link.addEventListener("keydown", (event) => {
      let next;
      if (["ArrowRight", "ArrowDown"].includes(event.key))
        next = (index + 1) % items.length;
      if (["ArrowLeft", "ArrowUp"].includes(event.key))
        next = (index + items.length - 1) % items.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = items.length - 1;
      if (next == null) return;
      event.preventDefault();
      select(items[next].id, { write: true, scroll: true });
      items[next].link.focus({ preventScroll: true });
    });
  }
  const media = matchMedia("(max-width:760px)");
  const orientation = () =>
    nav.setAttribute(
      "aria-orientation",
      media.matches ? "horizontal" : "vertical",
    );
  orientation();
  media.addEventListener("change", orientation);
  window.addEventListener("popstate", () =>
    select(location.hash.slice(1), { scroll: true }),
  );
  window.addEventListener("hashchange", () =>
    select(location.hash.slice(1), { scroll: true }),
  );
  select(location.hash.slice(1));
})();
