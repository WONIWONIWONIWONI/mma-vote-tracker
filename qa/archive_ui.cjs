const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const config = require("../dist/config.js");
const root = path.resolve(__dirname, "../dist");
const cutoff = Date.parse(config.endsAt);
const history = JSON.parse(
  fs.readFileSync(path.join(root, "data/history.json")),
);
// Old collector metadata must not extend the newly configured deadline.
history.operation = { endsAt: "2026-10-29T15:10:00Z" };
history.snapshots.push({
  ...history.snapshots.at(-1),
  sourceAt: "2026-10-29T15:00:00.900Z",
  collectedAt: "2026-10-29T15:00:00.900Z",
});
history.historyCount = history.snapshots.length;
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: mobile ? 390 : 1280, height: 960 },
        isMobile: mobile,
        hasTouch: mobile,
      });
      const requests = [];
      await page.clock.install({ time: new Date(cutoff + 1000) });
      await page.route("**/*", (route) => {
        const u = new URL(route.request().url()),
          name = u.pathname.split("/").at(-1);
        if (u.hostname.includes("melon.com")) {
          requests.push(u.href);
          return route.abort();
        }
        if (["history.json", "latest.json"].includes(name))
          return route.fulfill({
            json: history,
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        if (name === "gap-forecasts.json")
          return route.fulfill({
            path: path.join(root, "data", name),
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        if (u.hostname !== "archive.test") return route.abort();
        return route.fulfill({
          path: path.join(root, u.pathname === "/" ? "index.html" : u.pathname),
        });
      });
      await page.goto("https://archive.test/");
      await page.waitForFunction(
        (n) => window.MMA_DATA?.snapshots.length >= n,
        history.snapshots.length,
      );
      assert.equal(
        await page.locator("#status-label").textContent(),
        "수집 종료",
      );
      assert.equal(
        await page.locator("#collected-time").textContent(),
        "기록 보관용",
      );
      assert.ok(
        (await page.locator("#source-time").textContent()).endsWith(":00 KST"),
      );
      assert.equal(
        await page.locator("#daily-date").inputValue(),
        "2026-10-29",
      );
      assert.equal(
        await page.locator("#hourly-date").inputValue(),
        "2026-10-29",
      );
      assert.equal(
        await page.locator('#daily-date option[value="2026-10-30"]').count(),
        0,
      );
      assert.equal(
        await page.locator('#hourly-date option[value="2026-10-30"]').count(),
        0,
      );
      assert.ok(
        (await page.locator("#daily-summary").textContent()).includes("마감"),
      );
      const votes = await page.locator(".vote-value").allTextContents();
      await page.locator("#refresh-button").click();
      await page.waitForFunction(
        () => !document.getElementById("refresh-button").disabled,
      );
      await page.clock.fastForward(13 * 3600 * 1000);
      await page.locator('[data-theme-choice="light"]').click();
      await page.locator('.dashboard-nav a[href="#daily-panel"]').click();
      assert.deepEqual(
        await page.locator(".vote-value").allTextContents(),
        votes,
      );
      assert.equal(
        requests.length,
        0,
        "no live requests after the exact deadline, even with old archive metadata",
      );
      await page.screenshot({
        path: `qa-output/archive-${mobile ? "mobile" : "desktop"}.png`,
        fullPage: true,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(
    "Archive deadline, stale metadata, final-day closure, stable votes and no post-deadline live requests passed.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
