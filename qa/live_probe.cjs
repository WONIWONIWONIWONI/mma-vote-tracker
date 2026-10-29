const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 960 },
    });
    const liveRequests = [];
    page.on("request", (request) => {
      if (request.url().includes("m2.melon.com"))
        liveRequests.push(request.url());
    });
    const url =
      process.env.SITE_URL ||
      "https://woniwoniwoniwoni.github.io/mma-vote-tracker/";
    let ready = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto(
        url +
          "?verify=" +
          encodeURIComponent(process.env.GITHUB_SHA || Date.now()) +
          "&attempt=" +
          attempt,
        { waitUntil: "domcontentloaded" },
      );
      try {
        await page
          .locator(".hourly-cards")
          .waitFor({ state: "attached", timeout: 8000 });
        ready = true;
        break;
      } catch {}
    }
    assert.ok(ready, "new chart controls are present on the deployed site");
    const archived = await page.evaluate(
      () => Date.now() >= Date.parse(TrackerConfig.endsAt),
    );
    await page.waitForFunction(
      (archived) =>
        archived
          ? window.MMA_DATA?.snapshots.length >= window.MMA_SEED.historyCount
          : window.MMA_DATA?.snapshots.at(-1).origin === "melon_browser_api",
      archived,
      { timeout: 20000 },
    );
    const data = await page.evaluate(() => {
      const last = window.MMA_DATA.snapshots.at(-1);
      return {
        at: last.sourceAt,
        origin: last.origin,
        teams: last.top4.map((t) => ({ name: t.name, votes: t.votes })),
        colors: [...document.querySelectorAll(".leader")].map((e) =>
          e.style.getPropertyValue("--color"),
        ),
      };
    });
    if (archived) {
      const endsAt = await page.evaluate(() => TrackerConfig.endsAt);
      assert.ok(Date.parse(data.at) <= Date.parse(endsAt));
      assert.equal(liveRequests.length, 0, "archive never requests live votes");
    } else assert.ok(Math.abs(Date.now() - Date.parse(data.at)) < 90000);
    assert.equal(data.teams.length, 6);
    assert.equal(new Set(data.colors).size, 6);
    await page.waitForFunction(
      () => !document.getElementById("refresh-button").disabled,
    );
    await page.locator("#refresh-button").click();
    await page.waitForFunction(
      () => !document.getElementById("refresh-button").disabled,
    );
    assert.equal(
      await page.locator("#status-label").textContent(),
      archived ? "수집 종료" : "멜론 직접 조회",
    );
    assert.equal(
      await page.locator("[data-range].selected").getAttribute("data-range"),
      "24",
    );
    await page.locator('.dashboard-nav a[href="#trend-panel"]').click();
    await page.locator('[data-range="1"]').click();
    await page.locator("#trend-chart").scrollIntoViewIfNeeded();
    const r = await page.locator("#trend-chart").boundingBox();
    await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.5);
    const scale = await page
      .locator("#trend-chart")
      .getAttribute("data-zoom-x");
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator("#trend-chart").getAttribute("data-zoom-x"),
      scale,
    );
    await page.locator("#trend-chart").scrollIntoViewIfNeeded();
    const b = await page.locator("#trend-chart").boundingBox();
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await page.waitForFunction(
      () => +document.getElementById("trend-chart").dataset.zoomX > 1,
    );
    const before = await page
      .locator("#trend-chart")
      .evaluate((e) => ({ x: e.dataset.xmin, y: e.dataset.ymin }));
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.6 + 60, b.y + b.height * 0.5 + 35, {
      steps: 8,
    });
    await page.mouse.up();
    const after = await page
      .locator("#trend-chart")
      .evaluate((e) => ({ x: e.dataset.xmin, y: e.dataset.ymin }));
    assert.notEqual(after.x, before.x);
    assert.notEqual(after.y, before.y);
    await page.locator("#trend-forecast-minutes").selectOption("180");
    await page.waitForFunction(() =>
      document.getElementById("chart-note").textContent.includes("180분"),
    );
    assert.ok(
      (await page.locator("#trend-chart path[stroke-dasharray]").count()) > 0,
      "actual site projections remain visible after the collection gap",
    );
    fs.mkdirSync("qa-output", { recursive: true });
    await page.screenshot({
      path: "qa-output/live-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await page.locator('.dashboard-nav a[href="#hourly-panel"]').click();
    assert.ok(await page.locator(".hourly-cards").isVisible());
    assert.equal(
      await page
        .locator(".hour-card")
        .first()
        .locator(".hour-card-team")
        .count(),
      6,
    );
    await page.screenshot({
      path: "qa-output/live-mobile.png",
      fullPage: true,
    });
    console.log("Live site verified:", JSON.stringify(data));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
