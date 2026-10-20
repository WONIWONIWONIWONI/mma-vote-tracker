const assert = require("node:assert/strict");
const H = require("../dist/http.js");
global.TrackerConfig = require("../dist/config.js");
(async () => {
  const original = global.fetch,
    requests = [];
  try {
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? { ok: true, json: async () => ({ invalid: true }) }
        : { ok: true, json: async () => ({ records: [] }) };
    };
    const result = await H.record("gap-forecasts.json", (value) => {
      if (!value.records) throw new Error("Invalid response");
      return value;
    });
    assert.deepEqual(result, { records: [] });
    assert.equal(requests.length, 2, "invalid API payload falls back to raw");
    assert.ok(
      requests[0].url.includes(
        "/contents/dist/data/gap-forecasts.json?ref=main",
      ),
    );
    assert.ok(
      requests.every(
        (request) =>
          request.options.credentials === "omit" &&
          request.options.cache === "no-store",
      ),
    );
    global.fetch = async (_, options) =>
      new Promise((resolve, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        ),
      );
    await assert.rejects(
      H.json("https://example.test", { timeout: 5 }),
      /aborted/,
    );
  } finally {
    global.fetch = original;
    delete global.TrackerConfig;
  }
  console.log(
    "Shared HTTP validation fallback, no credentials, timeout: passed",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
