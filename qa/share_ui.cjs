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
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({
          viewport: { width: mobile ? 390 : 1280, height: 960 },
          isMobile: mobile,
          hasTouch: mobile,
        });
        await page.addInitScript(
          (theme) => localStorage.setItem("vote-track-theme", theme),
          theme,
        );
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
            (v) => v === "이미지 공유하기",
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
        }
        assert.equal(
          await page.locator("[data-image], #cd-image").count(),
          0,
          "downloads are consolidated in sharing",
        );
        await page.selectOption("#daily-date", "2026-10-15");
        await page.selectOption("#hourly-date", "2026-10-22");
        assert.match(
          await page.locator(".daily-winner").textContent(),
          /86,056/,
        );
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
            () => !document.querySelector("[data-copy-image]").disabled,
            null,
            { timeout: 30000 },
          );
          assert.ok(
            await page.locator("[data-copy-native]").isEnabled(),
            "HTML is independent of the image URL",
          );
          const native = await page
            .locator(".share-native-source")
            .inputValue();
          assert.ok(
            native.length > 500 && native.length <= 65535,
            `${key}: ${native.length} chars`,
          );
          assert.ok(
            !/<(?:html|head|body|form|input|button|font|small|h2|th|img|svg|canvas|script|iframe|style|link|object|embed)\b|data:|url\(|\bon\w+=/i.test(
              native,
            ),
          );
          assert.ok(native.includes("https://share.test/"));
          await page.locator(".share-native-preview").evaluate((e) => {
            e.closest("details").open = true;
          });
          assert.ok(
            !/position:|clip-path:|transform:|inset:|z-index:|display:(?:flex|grid)/i.test(
              native,
            ),
          );
          assert.deepEqual(
            await page.locator(".share-actions button").allTextContents(),
            ["이미지 복사", "PNG 다운로드", "HTML 공유"],
          );
          assert.equal(
            await page
              .locator(
                ".share-image-url,[data-file-share],[data-copy-share],[data-image]",
              )
              .count(),
            0,
          );
          if (["trend", "candles", "forecast"].includes(key))
            assert.ok(
              (await page
                .locator(
                  '.share-native-preview table[height] td[style*="background"]',
                )
                .count()) > 10,
              `${key} contains table chart geometry`,
            );
          if (key === "hourly") {
            assert.equal(
              await page.locator(".share-native-preview tbody tr").count(),
              (await page.evaluate(() => MMAShareModels.hourly())).rows.length,
            );
          }
          const review = await browser.newPage({
            viewport: { width: mobile ? 390 : 1000, height: 960 },
          });
          // Hostile board defaults: td metrics and bold text override inheritance.
          await review.setContent(
            '<style>td{color:#333;font-size:14px;line-height:22px;padding:8px}b,strong{color:#333}</style><body style="margin:0;background:#10121b;">' +
              native +
              "</body>",
          );
          const before =
            key === "leaders"
              ? await review.locator("td[width][bgcolor]").evaluateAll((es) =>
                  es.map((e) => {
                    const r = e.getBoundingClientRect();
                    return [r.x, r.y, r.width, r.height];
                  }),
                )
              : null;
          const backgrounds = await review
            .locator("table,td")
            .evaluateAll((es) =>
              es
                .filter((e) => e.style.backgroundColor)
                .map((e) => !!e.getAttribute("bgcolor")),
            );
          assert.ok(
            backgrounds.length > 0 && backgrounds.every(Boolean),
            "filled tables and cells have CSS and bgcolor fallbacks",
          );
          assert.ok(
            !/min-width:/i.test(native),
            "shared layout has no fixed minimum width",
          );
          // Strip legacy presentation attributes as well as advanced layout CSS.
          await review.evaluate(() => {
            for (const e of document.querySelectorAll("[bgcolor],[color]")) {
              if (e.matches("td[width][bgcolor]")) e.dataset.rankCard = "true";
              e.removeAttribute("bgcolor");
              e.removeAttribute("color");
            }
            for (const e of document.querySelectorAll("[style]"))
              for (const p of [
                "position",
                "top",
                "left",
                "right",
                "bottom",
                "inset",
                "z-index",
                "transform",
                "transform-origin",
                "clip-path",
                "mask",
                "display",
                "float",
                "overflow",
                "overflow-x",
                "overflow-y",
              ])
                e.style.removeProperty(p);
          });
          if (key === "leaders") {
            const after = await review
              .locator('td[data-rank-card="true"]')
              .evaluateAll((es) =>
                es.map((e) => {
                  const r = e.getBoundingClientRect();
                  return [r.x, r.y, r.width, r.height];
                }),
              );
            assert.equal(before.length, 6);
            assert.equal(after.length, 6);
            const voteColors = await review
              .locator("b")
              .evaluateAll((es) =>
                es
                  .filter((e) => e.style.fontSize === "30px")
                  .map((e) => getComputedStyle(e).color),
              );
            assert.deepEqual(
              voteColors,
              Array(6).fill(
                theme === "dark" ? "rgb(245, 240, 246)" : "rgb(32, 33, 59)",
              ),
              "rank votes remain readable in both themes",
            );
            assert.ok(
              mobile
                ? before[1][1] > before[0][1]
                : before[1][0] > before[0][0],
              "cards wrap according to the reader width",
            );
            assert.ok(
              after[1][1] > after[0][1],
              "cards stack safely when display CSS is stripped",
            );
            assert.ok(after[2][1] > after[0][1]);
          }
          if (key === "hourly") {
            assert.ok(
              await review.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              "hourly HTML fits the viewport without horizontal scrolling",
            );
            const colors = await review
              .locator("tbody b")
              .evaluateAll((es) => es.map((e) => getComputedStyle(e).color));
            assert.ok(
              colors.length > 10 &&
                colors.every(
                  (c) => c !== "rgb(51, 51, 51)" && c !== "rgb(0, 0, 0)",
                ),
              "all hourly times and votes have explicit readable colors",
            );
          }
          if (["trend", "candles", "forecast"].includes(key)) {
            const runs = await review.locator("td").evaluateAll((es) =>
              es
                .filter((e) => e.style.fontSize === "1px")
                .map((e) => {
                  const c = getComputedStyle(e),
                    r = e.getBoundingClientRect();
                  return {
                    bg: c.backgroundColor,
                    width: r.width,
                    height: r.height,
                    text: e.textContent,
                    expectedHeight: Number(
                      e.closest("tr").getAttribute("height"),
                    ),
                  };
                }),
            );
            const bright = runs.filter((r) => {
              const rgb = r.bg.match(/\d+/g)?.map(Number) || [0, 0, 0];
              return (
                Math.max(...rgb) - Math.min(...rgb) > 45 &&
                Math.max(...rgb) > 150
              );
            });
            assert.ok(
              bright.length > 10,
              `${key}: colored chart survives bgcolor stripping`,
            );
            assert.ok(
              bright.every(
                (r) =>
                  r.width > 0 &&
                  r.height > 0 &&
                  r.expectedHeight > 0 &&
                  r.height <= r.expectedHeight + 0.5 &&
                  r.text.length > 0,
              ),
              `${key}: chart runs keep content, width and small height despite board td rules`,
            );
          }
          await review.screenshot({
            path: `qa-output/native-${key}-${mobile ? "mobile" : "desktop"}-${theme}.png`,
            fullPage: true,
          });
          // Reuse the exact same exported HTML from desktop AND mobile in narrow
          // board bodies, including hostile inherited nowrap and extra td padding.
          for (const width of [320, 390]) {
            await review.setViewportSize({ width, height: 960 });
            await review.setContent(
              '<style>td{padding:8px;white-space:nowrap}b,strong{color:#333}</style><body style="margin:0;padding:0 16px;background:#fff;"><article style="width:100%;overflow:hidden;">' +
                native +
                "</article></body>",
            );
            await review.evaluate(() => {
              for (const e of document.querySelectorAll("[bgcolor],[color]")) {
                e.removeAttribute("bgcolor");
                e.removeAttribute("color");
              }
            });
            async function assertFits(label) {
              const outside = await review
                .locator("article")
                .evaluate((root) => {
                  const bounds = root.getBoundingClientRect();
                  return [...root.querySelectorAll("table,td,div,p,span,b")]
                    .filter((e) => {
                      const r = e.getBoundingClientRect();
                      return (
                        r.width > 0 &&
                        (r.left < bounds.left - 1 || r.right > bounds.right + 1)
                      );
                    })
                    .slice(0, 5)
                    .map((e) => ({
                      tag: e.tagName,
                      text: e.textContent.slice(0, 45),
                      width: e.getBoundingClientRect().width,
                    }));
                });
              assert.deepEqual(
                outside,
                [],
                `${key} copied on ${mobile ? "mobile" : "desktop"}-${theme} fits ${width}px ${label}`,
              );
            }
            await assertFits("board body");
            await review.screenshot({
              path: `qa-output/native-${key}-from-${mobile ? "mobile" : "desktop"}-${theme}-at-${width}.png`,
              fullPage: true,
            });
            await review.evaluate(() => {
              for (const e of document.querySelectorAll("[style]"))
                e.style.removeProperty("display");
            });
            await assertFits("after display stripping");
          }
          await review.close();
          console.log(
            `Native HTML ${mobile ? "mobile" : "desktop"}-${theme} ${key}: ${native.length} characters`,
          );
          const captured = await page
            .locator(".share-preview img")
            .getAttribute("src");
          assert.ok(captured.startsWith("data:image/png;base64,"));
          await page
            .locator(".share-preview img")
            .evaluate((img) => img.decode());
          const dimensions = await page
            .locator(".share-preview img")
            .evaluate((img) => [img.naturalWidth, img.naturalHeight]);
          assert.ok(dimensions[0] > 300 && dimensions[1] > 100);
          if (key === "leaders")
            assert.ok(
              dimensions[1] > 600,
              "all six rank cards must include votes and gaps",
            );
          const pngWaiting = page.waitForEvent("download");
          await page.locator("[data-download-share]").click();
          await (
            await pngWaiting
          ).saveAs(
            `qa-output/share-${key}-${mobile ? "mobile" : "desktop"}-${theme}.png`,
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
              await page.locator(".share-preview img").getAttribute("src"),
              captured,
            );
            assert.equal(
              await page.locator(".share-native-source").inputValue(),
              native,
            );
          }
          if (key === "leaders")
            assert.equal(
              await page.locator(".leader:visible").count(),
              2,
              "capture must preserve collapsed source page",
            );
          // Clipboard contains a PNG blob, never a base64 HTML payload.
          await page.evaluate(() => {
            window.copiedImage = null;
            Object.defineProperty(navigator, "clipboard", {
              configurable: true,
              value: {
                write: async (items) => {
                  window.copiedImage = await (
                    await items[0].getType("image/png")
                  )
                    .arrayBuffer()
                    .then((b) => [...new Uint8Array(b).slice(0, 8)]);
                },
                writeText: async (text) => {
                  window.copiedHTML = text;
                },
              },
            });
          });
          await page.locator("[data-copy-native]").click();
          assert.equal(await page.evaluate(() => window.copiedHTML), native);
          await page.locator("[data-copy-image]").click();
          await page.waitForFunction(() => window.copiedImage);
          assert.deepEqual(
            await page.evaluate(() => window.copiedImage),
            [137, 80, 78, 71, 13, 10, 26, 10],
          );
          await page.locator("[data-close-share]").click();
        }
        // New copies reflect the user's changed chart window and selected day.
        await page.locator('[data-share-panel="trend"]').click();
        await page.waitForFunction(
          () => !document.querySelector("[data-copy-image]").disabled,
        );
        assert.ok(
          (
            await page.locator(".share-preview img").getAttribute("src")
          ).startsWith("data:image/png"),
        );
        const refreshed = await page
          .locator(".share-preview img")
          .getAttribute("src");
        await page.locator("[data-close-share]").click();
        await page.locator('[data-share-panel="trend"]').click();
        await page.waitForFunction(
          () => !document.querySelector("[data-copy-image]").disabled,
        );
        assert.equal(
          await page.locator(".share-status").textContent(),
          "",
          "ready state has no redundant technical status",
        );
        assert.equal(
          await page.locator(".share-preview img").getAttribute("src"),
          refreshed,
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
    }
  } finally {
    await browser.close();
  }
  console.log(
    "Six exact panel snapshots: light/dark, desktop/mobile, charts, two decimals, gaps, downloads, immutable copy, board-filtered table HTML, consolidated controls, PNG clipboard and cache passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
