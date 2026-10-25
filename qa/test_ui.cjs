/* Exercise public UI through actual browser input; no production votes are written. */
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../dist");
const ids = ["994944", "3709231", "3574243", "3207401", "672375", "3478478"];
const names = [
  "임영웅",
  "RESCENE (리센느)",
  "NCT WISH",
  "PLAVE",
  "방탄소년단",
  "RIIZE",
];
const bases = [100000, 72000, 65000, 62000, 38000, 36000],
  rates = [20, 50, 10, 9, 5, 4];
const time = Date.parse("2026-10-15T12:40:00Z");
function snapshot(i) {
  const teams = ids.map((id, k) => ({
    id,
    name: names[k],
    votes: bases[k] + rates[k] * i,
  }));
  const totalVotes = teams.reduce((s, t) => s + t.votes, 0);
  teams.forEach((t, k) => {
    t.rank = k + 1;
    t.reportedShare = Math.round((t.votes / totalVotes) * 100);
  });
  return {
    sourceAt: new Date(time + (i - 720) * 60000).toISOString(),
    origin: "melon_public_api",
    totalVotes,
    top4: teams,
  };
}
const history = {
  schemaVersion: 2,
  snapshots: Array.from({ length: 720 }, (_, i) => snapshot(i)),
  historyCount: 720,
};
const seed = { ...history, snapshots: history.snapshots.slice(-3) };
async function setup(browser, mobile = false) {
  const context = await browser.newContext(
    mobile
      ? {
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        }
      : { viewport: { width: 1280, height: 960 } },
  );
  const page = await context.newPage();
  await page.clock.install({ time: new Date(time) });
  let liveCalls = 0,
    archiveCalls = 0,
    rawCalls = 0,
    failLive = false,
    failAPI = false,
    releaseArchive;
  const gate = new Promise((resolve) => (releaseArchive = resolve)),
    errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Browser error:", error.message);
  });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/gap-forecasts.json"))
      return route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json: JSON.parse(
          fs.readFileSync(path.join(root, "data/gap-forecasts.json")),
        ),
      });
    if (u.hostname === "local.test") {
      if (u.pathname === "/data/seed.js")
        return route.fulfill({
          body: "window.MMA_SEED=" + JSON.stringify(seed),
          contentType: "text/javascript",
        });
      return route.fulfill({
        path: path.join(root, u.pathname === "/" ? "index.html" : u.pathname),
      });
    }
    if (u.hostname === "m2.melon.com") {
      liveCalls++;
      if (failLive)
        return route.fulfill({ status: 503, body: "temporary error" });
      const s = snapshot(720 + liveCalls);
      const nominees = s.top4.map((t) => ({
        content: { id: t.id, name: t.name },
        voteCount: t.votes,
        votePercent: t.reportedShare,
      }));
      return route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json: { response: { status: "ok", nominees } },
      });
    }
    if (
      u.hostname === "api.github.com" ||
      u.hostname === "raw.githubusercontent.com"
    ) {
      if (u.hostname === "api.github.com") {
        archiveCalls++;
        if (failAPI)
          return route.fulfill({ status: 403, body: "rate limited" });
      } else rawCalls++;
      await gate;
      return route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json: u.pathname.endsWith("latest.json") ? seed : history,
      });
    }
    return route.abort();
  });
  await page.goto("https://local.test/");
  await page.waitForFunction(
    () => window.MMA_DATA?.snapshots.at(-1).origin === "melon_browser_api",
  );
  await page.waitForFunction(
    () => !document.getElementById("refresh-button").disabled,
  );
  assert.equal(archiveCalls, 1);
  assert.equal(liveCalls, 1);
  // A second live request is possible even while the first archival sync is blocked.
  await page.locator("#refresh-button").click();
  await page.waitForFunction(
    () => !document.getElementById("refresh-button").disabled,
  );
  assert.equal(liveCalls, 2);
  assert.equal(
    archiveCalls,
    1,
    "do not duplicate an archive request in flight",
  );
  releaseArchive();
  await page.waitForFunction(() => window.MMA_DATA.snapshots.length > 700);
  const liveBefore = liveCalls,
    archivesBefore = archiveCalls;
  await page.clock.fastForward(65000);
  assert.equal(liveCalls, liveBefore, "no automatic Melon polling");
  assert.equal(archiveCalls, archivesBefore, "no automatic archive polling");
  assert.equal(await page.locator(".leader:visible").count(), 2);
  assert.equal(
    await page.locator("#leaders-toggle").getAttribute("aria-expanded"),
    "false",
  );
  await page.locator("#leaders-toggle").click();
  assert.equal(await page.locator(".leader:visible").count(), 6);
  assert.equal(
    await page.locator("#leaders-toggle").getAttribute("aria-expanded"),
    "true",
  );
  const cardBoxes = await page
    .locator(".leader")
    .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().top));
  assert.ok(
    cardBoxes[2] > cardBoxes[1],
    "lower ranks expand below the lead pair",
  );
  await page.locator("#refresh-button").click();
  await page.waitForFunction(
    () => !document.getElementById("refresh-button").disabled,
  );
  assert.equal(
    await page.locator(".leader:visible").count(),
    6,
    "refresh preserves expansion",
  );
  await page.locator("#leaders-toggle").click();
  assert.equal(await page.locator(".leader:visible").count(), 2);
  const typography = await page
    .locator("main,header,footer")
    .evaluateAll((roots) => {
      const sizes = new Set();
      for (const root of roots)
        for (const e of root.querySelectorAll("*")) {
          if (
            e.getClientRects().length &&
            [...e.childNodes].some(
              (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
            )
          )
            sizes.add(getComputedStyle(e).fontSize);
        }
      return [...sizes];
    });
  assert.ok(
    typography.every((size) => ["12px", "16px", "32px"].includes(size)),
    "visible UI uses three readable sizes: " + typography.join(","),
  );
  assert.ok(
    !(await page.locator("body").innerText()).includes("·"),
    "UI copy has no middle-dot separators",
  );
  const colors = await page
    .locator(".leader")
    .evaluateAll((rows) =>
      rows.map((e) => e.style.getPropertyValue("--color")),
    );
  assert.equal(new Set(colors).size, 6, "all six teams have distinct colors");
  assert.equal(colors[1], "#bde56c");
  assert.equal(
    await page.locator("[data-range].selected").getAttribute("data-range"),
    "24",
  );
  assert.equal(
    await page.locator('#chart-legend [aria-pressed="true"]').count(),
    2,
    "two lead teams visible by default",
  );
  assert.equal(
    await page.locator('[data-team="3574243"]').getAttribute("aria-pressed"),
    "false",
  );
  await page.locator('[data-team="3574243"]').click();
  assert.equal(
    await page.locator('[data-team="3574243"]').getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('[data-team="3574243"]').click();
  await page.locator('[data-range="1"]').click();
  await page.locator("#trend-forecast").uncheck();
  await page.locator("#trend-chart").scrollIntoViewIfNeeded();
  const bounds = () =>
    page.locator("#trend-chart").evaluate((e) => ({
      xmin: +e.dataset.xmin,
      xmax: +e.dataset.xmax,
      ymin: +e.dataset.ymin,
      ymax: +e.dataset.ymax,
      zoomX: +e.dataset.zoomX,
      zoomY: +e.dataset.zoomY,
    }));
  async function drag(dx, dy) {
    await page.locator("#trend-chart").scrollIntoViewIfNeeded();
    const b = await page.locator("#trend-chart").boundingBox(),
      x = b.x + b.width * 0.55,
      y = b.y + b.height * 0.5;
    if (mobile) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + dx, y: y + dy }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 8 });
      await page.mouse.up();
    }
  }
  const original = await bounds();
  await drag(60, 20);
  const panned = await bounds();
  assert.ok(panned.xmin < original.xmin, "horizontal hand pan works at 1x");
  assert.notEqual(panned.ymin, original.ymin, "vertical hand pan works at 1x");
  await drag(-40, 0);
  assert.ok(
    (await bounds()).xmin > panned.xmin,
    "hand pan moves back toward later data",
  );
  if (!mobile) {
    await page.locator("#trend-chart").scrollIntoViewIfNeeded();
    const b = await page.locator("#trend-chart").boundingBox();
    await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.5);
    const plain = await bounds();
    await page.mouse.wheel(0, 80);
    await page.waitForTimeout(100);
    assert.deepEqual(
      await bounds(),
      plain,
      "unmodified wheel scrolls the page without zooming",
    );
    await page.locator("#trend-chart").scrollIntoViewIfNeeded();
    const r = await page.locator("#trend-chart").boundingBox();
    await page.mouse.move(r.x + r.width * 0.55, r.y + r.height * 0.5);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await page.waitForFunction(
      () => +document.getElementById("trend-chart").dataset.zoomX > 1,
    );
    const zoomed = await bounds();
    assert.ok(zoomed.xmax - zoomed.xmin < plain.xmax - plain.xmin);
    assert.ok(zoomed.ymax - zoomed.ymin < plain.ymax - plain.ymin);
  } else {
    await page.locator("#trend-chart").scrollIntoViewIfNeeded();
    const r = await page.locator("#trend-chart").boundingBox(),
      x = r.x + r.width * 0.55,
      y = r.y + r.height * 0.5,
      cdp = await context.newCDPSession(page),
      old = await bounds();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: x - 35, y },
        { x: x + 35, y },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 50, y },
        { x: x + 50, y },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 60, y },
        { x: x + 60, y },
      ],
    });
    const pinched = await bounds();
    assert.ok(pinched.xmax - pinched.xmin < old.xmax - old.xmin);
    assert.ok(pinched.ymax - pinched.ymin < old.ymax - old.ymin);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 35, y },
        { x: x + 35, y },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.ok(
      Math.abs(
        (await bounds()).xmax - (await bounds()).xmin - (old.xmax - old.xmin),
      ) < 10,
      "pinch reverses without drift",
    );
  }
  const zoomed = await bounds();
  await drag(50, 20);
  const moved = await bounds();
  assert.ok(moved.xmin < zoomed.xmin);
  assert.notEqual(moved.ymin, zoomed.ymin);
  await page.locator('[data-metric="share"]').click();
  await page.locator('[data-range="0.25"]').click();
  await page.locator("#trend-forecast").check();
  await page.locator("#trend-forecast-minutes").selectOption("180");
  await page.waitForFunction(() =>
    document.getElementById("chart-note").textContent.includes("180분"),
  );
  const forecastEnd = await page
      .locator("#trend-chart")
      .getAttribute("data-xmax"),
    lastObserved = await page.evaluate(() =>
      Date.parse(window.MMA_DATA.snapshots.at(-1).sourceAt),
    );
  assert.ok(Math.abs(+forecastEnd - lastObserved - 180 * 60000) < 1000);
  assert.ok(
    (await page.locator("#trend-chart path[stroke-dasharray]").count()) > 0,
  );
  if (mobile) {
    await page.locator(".hourly-cards").scrollIntoViewIfNeeded();
    assert.equal(await page.locator(".hourly-cards .hour-card").count(), 3);
    assert.equal(
      await page
        .locator(".hour-card")
        .first()
        .locator(".hour-card-team")
        .count(),
      6,
    );
    const geometry = await page
      .locator(".hourly-scroll")
      .evaluate((e) => ({ width: e.clientWidth, content: e.scrollWidth }));
    assert.ok(
      geometry.content <= geometry.width + 1,
      "mobile hourly comparison needs no horizontal scroll",
    );
    assert.equal(await page.locator(".hourly-desktop").isVisible(), false);
    await page.locator("#hourly-more").click();
    assert.ok(
      (await page.locator(".hour-card").count()) > 3,
      "mobile can expand to the full selected day",
    );
  }
  await page.locator("#cd-zoom-in").click();
  await page.locator("#cd-zoom-in").click();
  await page.locator("#cd-svg").scrollIntoViewIfNeeded();
  const view = () =>
    page.locator("#cd-svg").evaluate((e) => ({
      start: +e.dataset.start,
      n: +e.dataset.count,
      total: +e.dataset.total,
      W: e.viewBox.baseVal.width,
    }));
  const before = await view();
  assert.ok(before.n < before.total);
  async function noRightBlank() {
    const gap = await page.locator("#cd-svg").evaluate((e) => {
      const bars = [...e.querySelectorAll("rect")].filter((r) =>
        ["#e5484d", "#4ccce6", "#b0b4ba"].includes(r.getAttribute("fill")),
      );
      const last = bars.at(-1);
      return (
        e.viewBox.baseVal.width -
        (+last.getAttribute("x") + +last.getAttribute("width"))
      );
    });
    assert.ok(gap >= 0 && gap < 22, `bounded right margin: ${gap}`);
  }
  await noRightBlank();
  if (!mobile) {
    const r = await page.locator("#cd-svg").boundingBox();
    const left = 62,
      ratio = 0.72,
      x = r.x + ((left + (before.W - left - 8) * ratio) * r.width) / before.W,
      y = r.y + r.height * 0.5;
    await page.mouse.move(x, y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await page.waitForFunction(
      (n) => +document.querySelector("#cd-svg").dataset.count < n,
      before.n,
    );
    const zoomed = await view();
    await noRightBlank();
    assert.ok(
      Math.abs(
        before.start + ratio * before.n - (zoomed.start + ratio * zoomed.n),
      ) < 1.1,
      "wheel keeps the candle under the cursor",
    );
    const box = await page.locator("#cd-svg").boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width * 0.5 + 100,
      box.y + box.height * 0.5,
      { steps: 10 },
    );
    await page.mouse.up();
    assert.ok(
      (await view()).start < zoomed.start,
      "mouse drag moves toward older candles",
    );
  } else {
    const cdp = await context.newCDPSession(page),
      r = await page.locator("#cd-svg").boundingBox(),
      x = r.x + r.width * 0.55,
      y = r.y + r.height * 0.5;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: x - 35, y },
        { x: x + 35, y },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 50, y },
        { x: x + 50, y },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 60, y },
        { x: x + 60, y },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const zoomed = await view();
    await noRightBlank();
    assert.ok(zoomed.n < before.n, "pinch zooms");
    const ratio = (x - r.x - 44) / (r.width - 44 - 8);
    assert.ok(
      Math.abs(
        before.start + ratio * before.n - zoomed.start - ratio * zoomed.n,
      ) < 1.5,
      "pinch keeps its original anchor across multiple moves",
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 70, y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.ok(
      (await view()).start < zoomed.start,
      "touch drag moves toward older candles",
    );
  }
  await page.locator("#cd-reset").click();
  await noRightBlank();
  const full = await view();
  assert.equal(full.n, full.total);
  assert.equal(full.start, 0);
  // A GitHub API limit falls back to raw; a failed live fetch preserves the last observation.
  failLive = true;
  failAPI = true;
  const stamp = await page.evaluate(
    () => window.MMA_DATA.snapshots.at(-1).sourceAt,
  );
  const rawResponse = page.waitForResponse(
    (r) => new URL(r.url()).hostname === "raw.githubusercontent.com",
  );
  await page.locator("#refresh-button").click();
  await rawResponse;
  await page.waitForFunction(
    () =>
      document.getElementById("status-label").textContent === "직접 조회 실패",
  );
  await page.waitForFunction(
    () => !document.getElementById("refresh-button").disabled,
  );
  assert.equal(
    await page.evaluate(() => window.MMA_DATA.snapshots.at(-1).sourceAt),
    stamp,
  );
  await page.waitForFunction(() =>
    document
      .getElementById("notice-text")
      .textContent.includes("최신 조회에 실패"),
  );
  assert.ok(rawCalls > 0, "rate limited API falls back to raw");
  if (!mobile) {
    await page.locator("#gap-pair").selectOption(ids[0]);
    for (const [first, last, label, color] of [
      [-100, -50, "격차 축소", "#e5484d"],
      [100, 150, "격차 확대", "#e5484d"],
      [-100, -150, "격차 확대", "#4ccce6"],
      [100, 50, "격차 축소", "#4ccce6"],
    ]) {
      const rows = Array.from({ length: 7 }, (_, i) => {
        const s = snapshot(714 + i),
          gap = first + ((last - first) * i) / 6;
        s.top4[1].votes = 100000 + i * 10;
        s.top4[0].votes = s.top4[1].votes - gap;
        s.top4.sort((a, b) => b.votes - a.votes);
        s.totalVotes = s.top4.reduce((n, t) => n + t.votes, 0);
        s.top4.forEach((t, i) => {
          t.rank = i + 1;
          t.reportedShare = Math.round((t.votes / s.totalVotes) * 100);
        });
        return s;
      });
      await page.evaluate(
        (data) =>
          window.dispatchEvent(new CustomEvent("mma:data", { detail: data })),
        { ...history, snapshots: rows },
      );
      const metric = page.locator(".pc-metric").first();
      assert.ok((await metric.textContent()).includes(label));
      assert.equal(
        await metric
          .locator("strong")
          .evaluate((e) => getComputedStyle(e).color),
        color === "#e5484d" ? "rgb(229, 72, 77)" : "rgb(76, 204, 230)",
      );
    }
  }
  const actual = JSON.parse(
    fs.readFileSync(path.join(root, "data/history.json"), "utf8"),
  );
  const final = actual.snapshots.at(-1),
    source = actual.snapshots.filter(
      (r) => Date.parse(r.sourceAt) >= Date.parse(final.sourceAt) - 3600000,
    ),
    team = final.top4[0];
  const forecast = await page.evaluate(
    ({ source, id }) =>
      MMAAnalytics.forecast(
        source.map((r) => ({
          t: Date.parse(r.sourceAt),
          v: r.top4.find((t) => t.id === id)?.votes,
        })),
        60,
        30,
      ),
    { source, id: team.id },
  );
  assert.ok(forecast, "real archived gap does not suppress all projections");
  await page.clock.setFixedTime(new Date(actual.snapshots.at(-1).sourceAt));
  await page.evaluate(
    (data) =>
      window.dispatchEvent(new CustomEvent("mma:data", { detail: data })),
    actual,
  );
  await page
    .locator("#gf-chart path[stroke-dasharray]")
    .waitFor({ state: "attached" });
  assert.ok(
    (await page.locator("#gf-chart path[stroke-dasharray]").count()) > 0,
    "12h pair projection renders",
  );
  assert.ok(
    (await page.locator(".gf-model").textContent()).includes("사용 모델"),
    "model selection is visible",
  );
  await page.locator(".gf-now").waitFor();
  const now = await page
    .locator(".gf-now-values>div")
    .evaluateAll((nodes) => nodes.map((n) => +n.dataset.value));
  assert.equal(
    now[2],
    now[0] - now[1],
    "current delta compares the same observation time",
  );
  assert.equal(
    await page.locator(".gf-now-markers circle").count(),
    2,
    "actual and predicted current points are always marked",
  );
  const gapBounds = await page
    .locator("#gf-chart")
    .evaluate((el) => [+el.dataset.start, +el.dataset.end]);
  assert.equal(
    gapBounds[1] - gapBounds[0],
    43200000,
    "chart spans exactly 12 scheduled hours",
  );
  assert.equal(
    (gapBounds[0] + 9 * 3600000) % 43200000,
    0,
    "chart starts at KST midnight/noon",
  );
  assert.ok(
    (await page.locator(".gf-axis-start").textContent()).includes("시작"),
  );
  assert.ok((await page.locator(".gf-axis-end").textContent()).includes("끝"));
  assert.equal(
    await page.locator(".gf-current-time line[stroke-dasharray]").count(),
    1,
    "current clock time has a vertical dotted guide",
  );
  const ticks = await page.locator(".gf-y-tick text").allTextContents();
  assert.ok(
    ticks.length >= 4 && ticks.every((t) => t.trim()),
    "every horizontal grid line has a left numeric label",
  );

  const expectedNow = await page.evaluate(
    (snapshots) => MMAGapModel.points(snapshots).at(-1).g,
    actual.snapshots,
  );
  assert.equal(now[0], expectedNow, "current actual is the latest observation");
  assert.deepEqual(
    await page
      .locator("#gf-origin option")
      .evaluateAll((opts) => opts.map((o) => o.textContent)),
    ["현재 12시간 예측", "과거 예측"],
  );
  assert.equal(
    await page.locator(".gf-now-markers text,.gf-now-markers rect").count(),
    0,
    "live numbers no longer cover the plotted paths",
  );
  assert.equal(
    await page.locator(".gf-current-time text").getAttribute("font-size"),
    "12",
    "clock label matches axis text size",
  );
  await page.locator("#gf-detail summary").click();
  await page.locator("#gf-fine tbody tr").last().waitFor({ state: "attached" });
  assert.equal(await page.locator("#gf-fine tbody tr").count(), 144);
  await page.locator("#gf-origin").selectOption("history");
  assert.equal(
    await page.locator(".gf-now,.gf-now-markers,.gf-current-time").count(),
    0,
    "history has no live-only annotations",
  );
  assert.ok(
    (await page.locator(".gf-accuracy").textContent()).includes(
      "평균 절대 오차",
    ),
  );
  await page.locator("#gf-history-detail summary").click();
  const historicalCount = await page
    .locator("#gf-history-detail tbody tr")
    .count();
  assert.ok(historicalCount >= 1);
  const historyBounds = () =>
    page
      .locator("#gf-chart")
      .evaluate((el) => [+el.dataset.start, +el.dataset.end]);
  const whole = await historyBounds();
  assert.ok(whole[1] <= +gapBounds[0], "current unfinished issue is excluded");
  await page.locator("#gf-zoom-in").click();
  const zoomedHistory = await historyBounds();
  assert.ok(zoomedHistory[1] - zoomedHistory[0] < whole[1] - whole[0]);
  await page.locator("#gf-chart").scrollIntoViewIfNeeded();
  const hb = await page.locator("#gf-chart").boundingBox(),
    hx = hb.x + hb.width * 0.55,
    hy = hb.y + hb.height * 0.5;
  if (!mobile) {
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 45, hy, { steps: 5 });
    await page.mouse.up();
    assert.ok(
      (await historyBounds())[0] < zoomedHistory[0],
      "history supports mouse dragging",
    );
    const old = await historyBounds();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await page.waitForFunction((span) => {
      const e = document.getElementById("gf-chart");
      return +e.dataset.end - +e.dataset.start < span;
    }, old[1] - old[0]);
  } else {
    const cdp = await context.newCDPSession(page),
      old = await historyBounds();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: hx - 25, y: hy },
        { x: hx + 25, y: hy },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: hx - 45, y: hy },
        { x: hx + 45, y: hy },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const pinched = await historyBounds();
    assert.ok(
      pinched[1] - pinched[0] < old[1] - old[0],
      "history supports mobile pinch",
    );
  }
  await page.locator("#gf-reset").click();
  assert.deepEqual(await historyBounds(), whole);
  // The completed current issue is appended at the next 00/12 boundary.
  await page.clock.setFixedTime(new Date(gapBounds[1]));
  await page.evaluate(
    (data) =>
      window.dispatchEvent(new CustomEvent("mma:data", { detail: data })),
    actual,
  );
  assert.equal(
    await page.locator("#gf-origin").inputValue(),
    "history",
    "rollover preserves history selection",
  );
  assert.equal(
    await page.locator("#gf-history-detail tbody tr").count(),
    historicalCount + 1,
    "completed live issue joins public history",
  );
  assert.equal((await historyBounds())[1], gapBounds[1]);
  assert.ok(
    await page
      .locator(".gap-future")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    "forecast panel fits mobile/desktop",
  );
  assert.deepEqual(errors, []);
  fs.mkdirSync("qa-output", { recursive: true });
  await page.screenshot({
    path: `qa-output/${mobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
  console.log(
    `${mobile ? "Mobile" : "Desktop"}: direct refresh, slow archive, no polling, colors, Ctrl-only desktop zoom, mobile hourly cards, hand drag, pinch anchor, fallback and signed gap colors passed.`,
  );
  await context.close();
}
async function focusedBounds(page) {
  return page
    .locator("#trend-chart")
    .evaluate((e) => [+e.dataset.ymin, +e.dataset.ymax]);
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await setup(browser);
    await setup(browser, true);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
