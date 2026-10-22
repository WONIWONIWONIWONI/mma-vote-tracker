const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../dist");
const history = JSON.parse(
  fs.readFileSync(path.join(root, "data/history.json")),
);
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
      assert.equal(await page.locator("[data-share-panel]").count(), 8);
      const shares = await page.locator(".share-value").allTextContents();
      assert.ok(
        shares.every((v) => /^\d+\.\d{2}%$/.test(v)),
        "main share has exactly two decimals",
      );
      const display = await page.locator(".share-value").first().textContent();
      const first = history.snapshots.at(-1);
      assert.equal(
        display,
        ((100 * first.top4[0].votes) / first.totalVotes).toFixed(2) + "%",
        "derive share from votes, not rounded reportedShare",
      );
      fs.mkdirSync("qa-output", { recursive: true });
      for (const type of ["leaders", "trend", "hourly"]) {
        const model = await page.evaluate(
          (type) => window.MMAShareModels[type](),
          type,
        );
        if (type !== "hourly") {
          for (const team of model.leaders) {
            assert.match(team.share, /^\d+\.\d{2}%$/);
            assert.match(team.gap, /표 차이/);
          }
        }
        const waiting = page.waitForEvent("download");
        await page.locator(`[data-image="${type}"]`).click();
        const file = await waiting;
        await file.saveAs(
          `qa-output/export-${type}-${mobile ? "mobile" : "desktop"}.png`,
        );
      }
      const candleWaiting = page.waitForEvent("download");
      await page.locator("#cd-image").click();
      const candleFile = await candleWaiting;
      await candleFile.saveAs(
        `qa-output/export-candles-${mobile ? "mobile" : "desktop"}.png`,
      );
      await page.selectOption("#daily-date", "2026-10-15");
      assert.match(await page.locator(".daily-winner").textContent(), /임영웅/);
      assert.match(await page.locator(".daily-winner").textContent(), /86,056/);
      for (const key of [
        "leaders",
        "overview",
        "trend",
        "candles",
        "forecast",
        "daily",
        "hourly",
        "history",
      ]) {
        if (key === "history")
          await page
            .locator("#history-details")
            .evaluate((el) => (el.open = true));
        await page.locator(`[data-share-panel="${key}"]`).click();
        const html = await page.locator(".share-dialog textarea").inputValue();
        assert.ok(html.length > 500);
        assert.ok(
          !/<(?:script|iframe|svg|canvas|img|style|button|select)\b|\bon\w+=|\bclass=|\bid=|var\(--/.test(
            html,
          ),
        );
        assert.ok(html.includes("https://share.test/"));
        if (key === "leaders") {
          assert.match(html, /표 차이/);
          const last = history.snapshots.at(-1);
          assert.ok(
            html.includes(
              ((100 * last.top4[0].votes) / last.totalVotes).toFixed(2),
            ),
          );
          assert.ok(
            html.includes(
              Math.abs(last.top4[0].votes - last.top4[1].votes).toLocaleString(
                "ko-KR",
              ),
            ),
          );
        }
        if (key === "daily") {
          assert.ok(html.includes("86,056"));
          assert.ok(html.includes("2026.10.15"));
          assert.ok(html.includes("height:7px"));
        }
        if (key === "trend") assert.ok(html.includes("변화량"));
        if (key === "candles") {
          assert.ok(html.includes("최고 표차"));
          assert.ok(!html.includes("NaN"));
        }
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
        if (key === "daily") {
          fs.mkdirSync("qa-output", { recursive: true });
          await page.screenshot({
            path: `qa-output/share-${mobile ? "mobile" : "desktop"}.png`,
          });
        }
        if (
          ["leaders", "trend", "hourly", "candles", "forecast"].includes(key)
        ) {
          await page
            .locator(".share-preview")
            .screenshot({
              path: `qa-output/html-${key}-${mobile ? "mobile" : "desktop"}.png`,
            });
        }
        await page.locator("[data-close-share]").click();
      }
      // Input is data, not markup; malicious artist names remain plain text.
      await page.evaluate(
        () =>
          (window.MMA_DATA.snapshots.at(-1).top4[0].name =
            "<img src=x onerror=alert(1)>"),
      );
      await page.locator('[data-share-panel="leaders"]').click();
      assert.equal(await page.locator(".share-preview img").count(), 0);
      assert.match(
        await page.locator(".share-dialog textarea").inputValue(),
        /&lt;img/,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(
    "Native forum cards: desktop/mobile, all panels, day one, escaping and clipboard fallback passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
