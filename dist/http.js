/* Shared, bounded public reads. Validation participates in fallback selection. */
(function (root) {
  "use strict";
  async function json(url, { timeout = 6000, headers = {} } = {}) {
    const target = new URL(
      url,
      typeof location === "undefined" ? undefined : location.href,
    );
    target.searchParams.set("v", Date.now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(target, {
        cache: "no-store",
        credentials: "omit",
        headers,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
  async function record(
    file,
    validate = (value) => value,
    localFallback = false,
  ) {
    const config = root.TrackerConfig;
    const prefix =
      "https://api.github.com/repos/" +
      config.repository +
      "/contents/dist/data/";
    const sources = [
      {
        url: prefix + file + "?ref=" + encodeURIComponent(config.branch),
        headers: { Accept: "application/vnd.github.raw+json" },
      },
      {
        url:
          "https://raw.githubusercontent.com/" +
          config.repository +
          "/" +
          config.branch +
          "/dist/data/" +
          file,
      },
    ];
    if (localFallback) sources.push({ url: "./data/" + file });
    let lastError;
    for (const source of sources) {
      try {
        return validate(await json(source.url, { headers: source.headers }));
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
  const api = { json, record };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrackerHTTP = api;
})(globalThis);
