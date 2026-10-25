/* Section links follow the visible dashboard panel without polling. */
(() => {
  const links = [...document.querySelectorAll(".dashboard-nav a")];
  const sections = links
    .map((link) => ({
      link,
      section: document.getElementById(link.hash.slice(1)),
    }))
    .filter((item) => item.section);
  function mark(link) {
    for (const item of links) {
      if (item === link) item.setAttribute("aria-current", "location");
      else item.removeAttribute("aria-current");
    }
  }
  for (const { link, section } of sections)
    link.addEventListener("click", () => {
      if (section instanceof HTMLDetailsElement) section.open = true;
      mark(link);
    });
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries
        .filter((item) => item.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (entry)
        mark(sections.find((item) => item.section === entry.target).link);
    },
    { rootMargin: "0px 0px -65% 0px", threshold: 0 },
  );
  for (const { section } of sections) observer.observe(section);
})();
