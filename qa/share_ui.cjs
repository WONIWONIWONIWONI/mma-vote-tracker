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
          () => !document.querySelector("[data-copy-image]").disabled,
          null,
          { timeout: 30000 },
        );
        assert.ok(await page.locator("[data-copy-native]").isEnabled(), "HTML is independent of the image URL");
        const native = await page.locator(".share-native-source").inputValue();
        assert.ok(native.length > 500 && native.length <= 65535, `${key}: ${native.length} chars`);
        assert.ok(!/<(?:img|svg|canvas|script|iframe|style|link|object|embed)\b|data:|url\(|\bon\w+=/i.test(native));
        assert.ok(native.includes("https://share.test/"));
        await page.locator(".share-native-preview").evaluate(e => { e.closest("details").open = true; });
        if (["trend", "forecast"].includes(key))
          assert.ok(await page.locator('.share-native-preview [style*="clip-path:polygon"]').count() > 0, `${key} contains CSS chart paths`);
        if (key === "hourly") {
          assert.equal(await page.locator(".share-native-preview tbody tr").count(), (await page.evaluate(() => MMAShareModels.hourly())).rows.length);
        }
        const artboardWidth = Number(/position:relative;width:([\d.]+)px/.exec(native)?.[1] || 1000);
        const review = await browser.newPage({viewport:{width:Math.ceil(artboardWidth),height:960}});
        await review.setContent('<body style="margin:0;background:#10121b;">' + native + '</body>');
        await review.screenshot({path:`qa-output/native-${key}-${mobile ? "mobile" : "desktop"}.png`,fullPage:true});
        await review.close();
        console.log(`Native HTML ${mobile ? "mobile" : "desktop"} ${key}: ${native.length} characters`);
        const html = await page.locator(".share-url-source").inputValue();
        assert.equal(html, "", "never offer oversized inline HTML for a board");
        assert.ok(await page.locator("[data-copy-share]").isDisabled());
        const captured = await page.locator(".share-preview img").getAttribute("src");
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
        ).saveAs(`qa-output/share-${key}-${mobile ? "mobile" : "desktop"}.png`);
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
          assert.equal(await page.locator(".share-native-source").inputValue(), native);
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
          Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
            write: async items => {
              window.copiedImage = await (await items[0].getType("image/png")).arrayBuffer().then(b => [...new Uint8Array(b).slice(0, 8)]);
            },
            writeText: async text => { window.copiedHTML = text; },
          }});
        });
        await page.locator("[data-copy-native]").click();
        assert.equal(await page.evaluate(() => window.copiedHTML), native);
        await page.locator("[data-copy-image]").click();
        await page.waitForFunction(() => window.copiedImage);
        assert.deepEqual(await page.evaluate(() => window.copiedImage), [137,80,78,71,13,10,26,10]);
        // Optional hosted URL: short HTML, unsafe protocols and size rejected.
        await page
          .locator(".share-image-url")
          .fill("https://example.test/attached.png");
        assert.ok(
          (await page.locator(".share-url-source").inputValue()).includes(
            'src="https://example.test/attached.png"',
          ),
        );
        const boardHTML = await page.locator(".share-url-source").inputValue();
        assert.ok(boardHTML.length < 65535);
        assert.ok(!boardHTML.includes("data:"));
        assert.ok(!/<(?:script|iframe|svg|canvas)\b|\bon\w+=/.test(boardHTML));
        await page.locator("[data-copy-share]").click();
        assert.equal(await page.evaluate(() => window.copiedHTML), boardHTML);
        await page.locator(".share-image-url").fill("https://example.test/" + "x".repeat(66000));
        assert.ok(await page.locator("[data-copy-share]").isDisabled());
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
        () => !document.querySelector("[data-copy-image]").disabled,
      );
      assert.ok((await page.locator(".share-preview img").getAttribute("src")).startsWith("data:image/png"));
      const refreshed = await page.locator(".share-preview img").getAttribute("src");
      await page.locator("[data-close-share]").click();
      await page.locator('[data-share-panel="trend"]').click();
      await page.waitForFunction(() => !document.querySelector("[data-copy-image]").disabled);
      assert.match(await page.locator(".share-status").textContent(), /재사용/);
      assert.equal(await page.locator(".share-preview img").getAttribute("src"), refreshed);
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
    "Six exact panel snapshots: desktop/mobile, charts, two decimals, gaps, downloads, immutable copy, short HTML limits, PNG clipboard, native HTML/CSS for six panels and cache passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

