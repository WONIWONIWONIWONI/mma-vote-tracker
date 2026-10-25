const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "../dist");
const history = JSON.parse(
  fs.readFileSync(path.join(root, "data/history.json")),
);
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mobile of [false, true])
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({
          viewport: { width: mobile ? 390 : 1280, height: 960 },
          isMobile: mobile,
          hasTouch: mobile,
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.addInitScript(
          (theme) => localStorage.setItem("vote-track-theme", theme),
          theme,
        );
        await page.clock.install({
          time: new Date(history.snapshots.at(-1).sourceAt),
        });
        let requests = 0;
        await page.route("**/*", (route) => {
          const u = new URL(route.request().url()),
            name = u.pathname.split("/").at(-1);
          if (u.hostname !== "panels.test") {
            requests++;
            if (
              ["history.json", "latest.json", "gap-forecasts.json"].includes(
                name,
              )
            )
              return route.fulfill({
                path: path.join(root, "data", name),
                headers: { "Access-Control-Allow-Origin": "*" },
              });
            return route.abort();
          }
          return route.fulfill({
            path: path.join(
              root,
              u.pathname === "/" ? "index.html" : u.pathname,
            ),
          });
        });
        await page.goto("https://panels.test/");
        await page.waitForFunction(
          (n) => window.MMA_DATA?.snapshots.length >= n,
          history.snapshots.length,
        );
        await page.waitForFunction(
          () => !document.getElementById("refresh-button").disabled,
        );
        if (mobile) {
          const names = await page
            .locator(".leader:not([hidden]) .artist")
            .evaluateAll((elements) =>
              elements.map((element) => {
                const span = element.querySelector(".artist-name"),
                  range = document.createRange();
                range.selectNodeContents(span);
                const text = range.getBoundingClientRect(),
                  box = element.getBoundingClientRect();
                return {
                  name: span.textContent,
                  top: text.top - box.top,
                  bottom: box.bottom - text.bottom,
                  height: box.height,
                };
              }),
            );
          assert.ok(
            names.length === 2 &&
              names.every(
                (name) =>
                  name.height >= 24 && name.top >= -1 && name.bottom >= -1,
              ),
            "mobile artist names have full glyph height: " +
              JSON.stringify(names),
          );
        }
        const before = requests;
        assert.equal(await page.locator(".dashboard-view:visible").count(), 7);
        const alignment = await page
          .locator(".header-actions button")
          .evaluateAll((es) =>
            es.map((e) => {
              const r = e.getBoundingClientRect();
              return {
                top: r.top,
                bottom: r.bottom,
                height: r.height,
                left: r.left,
                right: r.right,
              };
            }),
          );
        assert.equal(alignment.length, 2);
        assert.ok(
          Math.abs(alignment[0].top - alignment[1].top) <= 1 &&
            Math.abs(alignment[0].height - alignment[1].height) <= 1 &&
            alignment[1].left >= alignment[0].right,
          "refresh and copy share one aligned row",
        );
        const ids = [
          "overview-panel",
          "trend-panel",
          "candle-panel",
          "gap-future",
          "daily-panel",
          "hourly-panel",
          "history-details",
        ];
        for (const id of ids) {
          await page.locator(`.dashboard-nav a[href="#${id}"]`).click();
          assert.equal(
            await page.locator(".dashboard-view:visible").count(),
            7,
            "section links leave every panel visible",
          );
          assert.ok(await page.locator(`#${id}`).isVisible());
          assert.equal(
            await page.locator("html").getAttribute("data-panel"),
            id,
          );
          const geometry = await page.locator(`#${id}`).boundingBox();
          const header = await page.locator(".dashboard-sidebar").boundingBox();
          if (id === "overview-panel")
            assert.equal(await page.evaluate(() => scrollY), 0);
          else
            assert.ok(
              geometry.y >= (mobile ? header.height : 0) - 1 &&
                geometry.y < 860,
              "target section is visible below the fixed menu",
            );
          if (id === "daily-panel") {
            const layout = await page.evaluate(() => {
              const box = (e) => {
                const r = e.getBoundingClientRect();
                return { x: r.x, y: r.y, right: r.right, width: r.width };
              };
              return {
                teams: box(document.getElementById("daily-teams")),
                summary: box(document.getElementById("daily-summary")),
                rows: [...document.querySelectorAll(".daily-team")].map(box),
                bars: [...document.querySelectorAll(".daily-bar")].map(box),
              };
            });
            assert.equal(layout.rows.length, 6);
            if (mobile) {
              assert.ok(
                Math.abs(layout.rows[0].y - layout.rows[1].y) < 1 &&
                  layout.rows[2].y > layout.rows[0].y,
                "mobile keeps the two-column cards",
              );
              assert.ok(
                layout.summary.y < layout.teams.y,
                "mobile summary remains above the cards",
              );
            } else {
              assert.ok(
                layout.rows.every(
                  (row, index) =>
                    index === 0 || row.y > layout.rows[index - 1].y,
                ),
                "desktop candidates use aligned horizontal rows",
              );
              assert.ok(
                layout.bars.every(
                  (bar) => Math.abs(bar.width - layout.bars[0].width) < 1,
                ),
                "bars share the same comparison width",
              );
              assert.ok(
                layout.summary.x >= layout.teams.right,
                "desktop totals use the right column",
              );
            }
            await page.locator("#daily-panel").screenshot({
              path: `qa-output/panel-daily-${mobile ? "mobile" : "desktop"}-${theme}.png`,
            });
          }
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
        }
        await page.locator('.dashboard-nav a[href="#trend-panel"]').click();
        await page.locator('[data-range="6"]').click();
        await page.locator('[data-metric="share"]').click();
        const windowText = await page.locator("#chart-window").textContent();
        await page.locator('.dashboard-nav a[href="#gap-future"]').click();
        await page.waitForFunction(
          () =>
            document.querySelectorAll("#gf-chart .gf-predicted-path").length >
            0,
        );
        const strokes = await page
          .locator("#gf-chart .gf-predicted-path,#gf-chart .gf-actual-path")
          .evaluateAll((es) => es.map((e) => getComputedStyle(e).strokeWidth));
        assert.ok(
          strokes.length > 1 &&
            strokes.every((value) => parseFloat(value) === 1.2),
          "actual and predicted paths remain legible",
        );
        await page.screenshot({
          path: `qa-output/panel-forecast-${mobile ? "mobile" : "desktop"}-${theme}.png`,
          fullPage: true,
        });
        await page.goBack();
        assert.equal(
          await page.locator("html").getAttribute("data-panel"),
          "trend-panel",
        );
        assert.equal(
          await page
            .locator("[data-range].selected")
            .getAttribute("data-range"),
          "6",
        );
        assert.equal(
          await page
            .locator("[data-metric].selected")
            .getAttribute("data-metric"),
          "share",
        );
        assert.equal(
          await page.locator("#chart-window").textContent(),
          windowText,
        );
        await page.reload();
        assert.equal(
          await page.locator("html").getAttribute("data-panel"),
          "trend-panel",
          "direct refresh reaches the linked section",
        );
        await page.waitForFunction(
          (n) => window.MMA_DATA?.snapshots.length >= n,
          history.snapshots.length,
        );
        await page.locator('.dashboard-nav a[href="#hourly-panel"]').click();
        if (mobile) {
          if (await page.locator("#hourly-more").isVisible())
            await page.locator("#hourly-more").click();
          await page.evaluate(() => window.scrollTo(0, 500));
          const bar = await page.locator(".dashboard-sidebar").boundingBox();
          assert.ok(
            Math.abs(bar.y) < 1,
            "mobile tabs stay at the top after scrolling",
          );
          await page.screenshot({
            path: `qa-output/panel-sticky-mobile-${theme}.png`,
            fullPage: true,
          });
          await page.locator('.dashboard-nav a[href="#daily-panel"]').click();
          assert.equal(
            await page.locator("html").getAttribute("data-panel"),
            "daily-panel",
          );
        }
        // Keyboard users can move between section links.
        await page.locator('.dashboard-nav a[href="#daily-panel"]').click();
        await page
          .locator('.dashboard-nav a[href="#daily-panel"]')
          .press("ArrowRight");
        assert.equal(
          await page.locator("html").getAttribute("data-panel"),
          "hourly-panel",
        );
        // Reloads above legitimately fetch data; a plain tab switch must not.
        const calls = requests;
        await page.locator('.dashboard-nav a[href="#overview-panel"]').click();
        assert.equal(requests, calls);
        assert.ok(before > 0);
        await page.screenshot({
          path: `qa-output/panel-overview-${mobile ? "mobile" : "desktop"}-${theme}.png`,
          fullPage: true,
        });
        assert.deepEqual(errors, []);
        await page.close();
      }
  } finally {
    await browser.close();
  }
  console.log(
    "Continuous-page section links, header alignment, sticky mobile navigation, keyboard/back/direct links, preserved chart choices, forecast stroke widths and no navigation polling passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
