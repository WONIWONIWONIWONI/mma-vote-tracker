/* Appearance must not reset chart choices or trigger a vote request. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../dist");
const history = JSON.parse(
  fs.readFileSync(path.join(root, "data/history.json")),
);
async function checkDailyHistoryContrast(page, theme) {
  await page.locator(".daily-history").evaluate((element) => {
    element.open = true;
  });
  const mobile = page.viewportSize().width <= 760;
  if (mobile) {
    await page
      .locator(".daily-record")
      .first()
      .evaluate((element) => {
        element.open = true;
      });
    const values = await page
      .locator(".daily-record")
      .first()
      .locator("dd")
      .allTextContents();
    assert.deepEqual(
      values,
      await page
        .locator("#daily-body tr")
        .first()
        .locator("td")
        .allTextContents()
        .then((cells) => cells.slice(1)),
    );
    assert.equal(
      await page.locator(".daily-history > .table-scroll").isVisible(),
      false,
    );
    assert.ok(
      await page
        .locator("#daily-history-mobile")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    );
  }
  const ratios = await page
    .locator("td.daily-best, .daily-best dd")
    .evaluateAll((cells) => {
      const luminance = (color) => {
        const [r, g, b] = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map((value) => {
            const channel = Number(value) / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return cells.map((cell) => {
        const style = getComputedStyle(cell);
        const a = luminance(style.color);
        const b = luminance(style.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
    });
  assert.ok(
    ratios.length > 0 && ratios.every((ratio) => ratio >= 7),
    `${theme} daily history winners stay readable: ${ratios.join(",")}`,
  );
  assert.ok(await page.locator(".daily-best:visible").first().isVisible());
}
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
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.install({
        time: new Date(history.snapshots.at(-1).sourceAt),
      });
      let requests = 0;
      await page.route("**/*", (route) => {
        const u = new URL(route.request().url()),
          name = u.pathname.split("/").at(-1);
        if (u.hostname !== "theme.test") {
          requests++;
          if (
            ["history.json", "latest.json", "gap-forecasts.json"].includes(name)
          )
            return route.fulfill({
              path: path.join(root, "data", name),
              headers: { "Access-Control-Allow-Origin": "*" },
            });
          return route.abort();
        }
        // Reproduce a returning visitor receiving the previous cached stylesheet.
        if (
          name === "style.css" &&
          u.searchParams.get("v") === "20261025-scroll-page1"
        ) {
          return route.fulfill({
            contentType: "text/css",
            body:
              fs.readFileSync(path.join(root, "style.css"), "utf8") +
              "\n.daily-history .daily-best { color: var(--tone-ffffff); background: var(--tone-f7f8fc); }",
          });
        }
        return route.fulfill({
          path: path.join(root, u.pathname === "/" ? "index.html" : u.pathname),
        });
      });
      await page.goto("https://theme.test/");
      await page.waitForFunction(
        (n) => MMA_DATA?.snapshots.length >= n,
        history.snapshots.length,
      );
      await page.waitForFunction(() =>
        document.querySelector("#refresh-button:not(:disabled)"),
      );
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "dark",
        "first visit defaults to dark mode",
      );
      await page.locator('[data-theme-choice="light"]').click();
      await page.locator('.dashboard-nav a[href="#trend-panel"]').click();
      await page.locator('[data-range="6"]').click();
      await page.locator('[data-metric="share"]').click();
      await page.locator('.dashboard-nav a[href="#overview-panel"]').click();
      await page.locator("#leaders-toggle").click();
      const values = await page.locator(".vote-value").allTextContents();
      const range = await page.locator("#chart-window").textContent();
      const selectedDate = await page.locator("#daily-date").inputValue();
      const before = requests;
      await page.locator('[data-theme-choice="dark"]').click();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "dark",
      );
      assert.equal(
        await page
          .locator("body")
          .evaluate((e) => getComputedStyle(e).backgroundColor),
        "rgb(16, 14, 25)",
      );
      assert.equal(
        await page
          .locator(".leader")
          .first()
          .evaluate((e) => getComputedStyle(e).color),
        "rgb(245, 240, 246)",
      );
      assert.ok(
        (await page.locator(".leader").first().getAttribute("style")).includes(
          "#e6ff54",
        ) ||
          (
            await page.locator(".leader").first().getAttribute("style")
          ).includes("#ff789a"),
      );
      const contrast = await page
        .locator(".daily-winner strong, .rank-badge b")
        .evaluateAll((elements) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d");
          const luminance = (color) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            const channels = [...context.getImageData(0, 0, 1, 1).data]
              .slice(0, 3)
              .map((v) => {
                v /= 255;
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              });
            return (
              0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
            );
          };
          return elements.map((element) => {
            let parent = element,
              background;
            while (parent) {
              background = getComputedStyle(parent).backgroundColor;
              if (background !== "rgba(0, 0, 0, 0)") break;
              parent = parent.parentElement;
            }
            const a = luminance(getComputedStyle(element).color),
              b = luminance(background);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          });
        });
      assert.ok(
        contrast.length >= 6 && contrast.every((value) => value >= 4.5),
        "dark highlight text stays readable: " + contrast.join(","),
      );
      await checkDailyHistoryContrast(page, "dark");
      assert.equal(
        await page.locator("[data-range].selected").getAttribute("data-range"),
        "6",
      );
      assert.equal(
        await page
          .locator("[data-metric].selected")
          .getAttribute("data-metric"),
        "share",
      );
      assert.equal(await page.locator("#chart-window").textContent(), range);
      assert.equal(
        await page.locator("#daily-date").inputValue(),
        selectedDate,
      );
      assert.equal(await page.locator(".leader:visible").count(), 6);
      assert.deepEqual(
        await page.locator(".vote-value").allTextContents(),
        values,
      );
      assert.equal(requests, before, "switch does not request votes");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      fs.mkdirSync("qa-output", { recursive: true });
      await page.screenshot({
        path: `qa-output/theme-${mobile ? "mobile" : "desktop"}-dark.png`,
        fullPage: true,
      });
      await page.reload();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "dark",
        "selection restored on reload",
      );
      await page.waitForFunction(
        (n) => MMA_DATA?.snapshots.length >= n,
        history.snapshots.length,
      );
      await page.locator('[data-theme-choice="light"]').click();
      assert.equal(
        await page
          .locator("body")
          .evaluate((e) => getComputedStyle(e).backgroundColor),
        "rgb(247, 248, 252)",
      );
      assert.equal(
        await page
          .locator(".leader")
          .first()
          .evaluate((e) => getComputedStyle(e).backgroundColor),
        "rgb(255, 255, 255)",
      );
      await checkDailyHistoryContrast(page, "light");
      await page.screenshot({
        path: `qa-output/theme-${mobile ? "mobile" : "desktop"}-light.png`,
        fullPage: true,
      });
      await page.reload();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "light",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(
    "Light/dark appearance, original palette, persistence, unchanged chart state, no extra vote requests and mobile bounds passed.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
