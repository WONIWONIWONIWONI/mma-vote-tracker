const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../dist"),
  history = JSON.parse(fs.readFileSync(path.join(root, "data/history.json")));
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: mobile ? 390 : 1280, height: 960 },
        isMobile: mobile,
        hasTouch: mobile,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.clock.install({
        time: new Date(history.snapshots.at(-1).sourceAt),
      });
      await page.route("**/*", (route) => {
        const u = new URL(route.request().url()),
          name = u.pathname.split("/").at(-1);
        if (u.hostname !== "share.test") {
          if (
            ["history.json", "latest.json", "gap-forecasts.json"].includes(name)
          )
            return route.fulfill({
              path: path.join(root, "data", name),
              headers: { "Access-Control-Allow-Origin": "*" },
            });
          return route.abort();
        }
        return route.fulfill({
          path: path.join(root, u.pathname === "/" ? "index.html" : u.pathname),
        });
      });
      await page.goto("https://share.test/");
      await page.waitForFunction(
        (n) => window.MMA_DATA?.snapshots.length >= n,
        history.snapshots.length,
      );
      assert.equal(await page.locator("[data-share-panel]").count(), 6);
      assert.deepEqual(
        await page
          .locator("[data-share-panel]")
          .evaluateAll((es) => es.map((e) => e.dataset.sharePanel)),
        ["leaders", "trend", "candles", "forecast", "daily", "hourly"],
      );
      assert.ok(
        (await page.locator("[data-share-panel]").allTextContents()).every(
          (v) => v === "HTML 공유하기",
        ),
      );
      assert.ok(
        (await page.locator(".share-value").allTextContents()).every((v) =>
          /^\d+\.\d{2}%$/.test(v),
        ),
      );
      const first = history.snapshots.at(-1);
      assert.equal(
        await page.locator(".share-value").first().textContent(),
        ((100 * first.top4[0].votes) / first.totalVotes).toFixed(2) + "%",
      );
      fs.mkdirSync("qa-output", { recursive: true });
      for (const type of ["leaders", "trend", "hourly"]) {
        const model = await page.evaluate(
          (type) => window.MMAShareModels[type](),
          type,
        );
        if (type !== "hourly")
          for (const team of model.leaders) {
            assert.match(team.share, /^\d+\.\d{2}%$/);
            assert.match(team.gap, /표 차이/);
          }
        const waiting = page.waitForEvent("download");
        await page.locator(`[data-image="${type}"]`).click();
        await (
          await waiting
        ).saveAs(
          `qa-output/export-${type}-${mobile ? "mobile" : "desktop"}.png`,
        );
      }
      const candleWaiting = page.waitForEvent("download");
      await page.locator("#cd-image").click();
      await (
        await candleWaiting
      ).saveAs(`qa-output/export-candles-${mobile ? "mobile" : "desktop"}.png`);
      await page.selectOption("#daily-date", "2026-10-15");
      assert.match(await page.locator(".daily-winner").textContent(), /86,056/);
      for (const key of [
        "leaders",
        "trend",
        "candles",
        "forecast",
        "daily",
        "hourly",
      ]) {
        await page.locator(`[data-share-panel="${key}"]`).click();
        await page.waitForFunction(
          () => !document.querySelector("[data-copy-share]").disabled,
          { timeout: 30000 },
        );
        const html = await page.locator(".share-dialog textarea").inputValue();
        assert.ok(
          html.includes('<img src="data:image/png;base64,'),
          "static charts must be included as actual imagery",
        );
        assert.ok(!/<(?:script|iframe|svg|canvas)\b|\bon\w+=/.test(html));
        assert.ok(html.includes("https://share.test/"));
        await page
          .locator(".share-preview img")
          .evaluate((img) => img.decode());
        const dimensions = await page
          .locator(".share-preview img")
          .evaluate((img) => [img.naturalWidth, img.naturalHeight]);
        assert.ok(dimensions[0] > 300 && dimensions[1] > 100);
        const pngWaiting = page.waitForEvent("download");
        await page.locator("[data-download-share]").click();
        await (
          await pngWaiting
        ).saveAs(`qa-output/share-${key}-${mobile ? "mobile" : "desktop"}.png`);
        await page.locator("[data-copy-share]").click();
        assert.match(
          await page.locator(".share-status").textContent(),
          /복사|선택/,
        );
        assert.ok(
          await page
            .locator(".share-dialog")
            .evaluate((e) => e.getBoundingClientRect().right <= innerWidth),
        );
        if (key === "trend") {
          // The shared image is immutable after the underlying view changes.
          await page.evaluate(() =>
            document.querySelector('[data-range="1"]').click(),
          );
          assert.equal(
            await page.locator(".share-dialog textarea").inputValue(),
            html,
          );
        }
        if (key === "leaders")
          assert.equal(
            await page.locator(".leader:visible").count(),
            2,
            "capture must preserve collapsed source page",
          );
        // Optional hosted URL: no upload, and unsafe protocols cannot be copied.
        await page
          .locator(".share-image-url")
          .fill("https://example.test/attached.png");
        assert.ok(
          (await page.locator(".share-dialog textarea").inputValue()).includes(
            'src="https://example.test/attached.png"',
          ),
        );
        await page.locator(".share-image-url").fill("javascript:alert(1)");
        assert.equal(
          await page.locator("[data-copy-share]").isDisabled(),
          true,
        );
        await page.locator(".share-image-url").fill("");
        await page.locator("[data-close-share]").click();
      }
      // New copies reflect the user's changed chart window and selected day.
      await page.locator('[data-share-panel="trend"]').click();
      await page.waitForFunction(
        () => !document.querySelector("[data-copy-share]").disabled,
      );
      assert.ok(
        (await page.locator(".share-dialog textarea").inputValue()).includes(
          "data:image/png",
        ),
      );
      await page.locator("[data-close-share]").click();
      assert.equal(
        await page.locator("[data-snapshot-stage]").count(),
        0,
        "no staging leaks",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(
    "Six exact panel snapshots: desktop/mobile, charts, two decimals, gaps, downloads, immutable copy, URL fallback passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
