/* Persistent section navigation on one continuous page, without data requests. */
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
  let active = null,
    frame;
  for (const item of items) {
    item.panel.hidden = false;
    item.panel.removeAttribute("role");
    item.panel.removeAttribute("tabindex");
    item.link.removeAttribute("role");
    item.link.removeAttribute("aria-selected");
    item.link.tabIndex = 0;
  }
  nav.removeAttribute("role");
  nav.removeAttribute("aria-orientation");
  for (const help of document.querySelectorAll("[data-panel-for]"))
    help.hidden = false;
  function mark(item) {
    if (active === item) return;
    active = item;
    document.documentElement.dataset.panel = item.id;
    for (const entry of items) {
      if (entry === item) entry.link.setAttribute("aria-current", "location");
      else entry.link.removeAttribute("aria-current");
    }
  }
  function inset() {
    return matchMedia("(max-width:760px)").matches
      ? document.querySelector(".dashboard-sidebar").getBoundingClientRect()
          .height + 16
      : 24;
  }
  function go(value, { write = false, scroll = true } = {}) {
    const item =
      items.find((entry) => entry.id === (aliases[value] || value)) || items[0];
    if (item.panel instanceof HTMLDetailsElement) item.panel.open = true;
    mark(item);
    if (write && location.hash !== "#" + item.id)
      history.pushState(null, "", "#" + item.id);
    window.dispatchEvent(new CustomEvent("tracker:panel", { detail: item.id }));
    if (scroll) {
      const top =
        item === items[0]
          ? 0
          : Math.max(
              0,
              item.panel.getBoundingClientRect().top + window.scrollY - inset(),
            );
      window.scrollTo({ top, left: 0, behavior: "auto" });
      // Scroll the horizontal menu without moving the page away from its panel.
      const tab = item.link.getBoundingClientRect(),
        rail = nav.getBoundingClientRect();
      if (tab.left < rail.left) nav.scrollLeft -= rail.left - tab.left;
      else if (tab.right > rail.right) nav.scrollLeft += tab.right - rail.right;
    }
  }
  for (const [index, item] of items.entries()) {
    item.link.addEventListener("click", (event) => {
      event.preventDefault();
      go(item.id, { write: true });
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
      go(items[next].id, { write: true });
      items[next].link.focus({ preventScroll: true });
    });
  }
  function track() {
    frame = null;
    if (
      window.scrollY + innerHeight >=
      document.documentElement.scrollHeight - 2
    ) {
      mark(items.at(-1));
      return;
    }
    const line = inset() + 48;
    let item = items[0];
    for (const entry of items)
      if (entry.panel.getBoundingClientRect().top <= line) item = entry;
    mark(item);
  }
  addEventListener(
    "scroll",
    () => {
      if (!frame) frame = requestAnimationFrame(track);
    },
    { passive: true },
  );
  addEventListener("popstate", () => go(location.hash.slice(1)));
  addEventListener("hashchange", () => go(location.hash.slice(1)));
  mark(items[0]);
  if (location.hash) {
    const value = aliases[location.hash.slice(1)] || location.hash.slice(1);
    mark(items.find((item) => item.id === value) || items[0]);
    requestAnimationFrame(() => go(location.hash.slice(1)));
  }
})();
