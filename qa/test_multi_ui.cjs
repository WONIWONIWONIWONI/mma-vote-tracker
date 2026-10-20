/* Generated two-source site: real browser input, mocked public responses only. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { chromium } = require("playwright"),
  { create } = require("../scripts/new-tracker.cjs");
const C = require("./fixtures/multi-config.json"),
  now = Date.parse("2026-10-20T03:00:00Z");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vote-ui-")),
  root = path.join(create(C, path.join(tmp, "site")), "dist");
function row(sourceId, i) {
  const a = sourceId === "melon" ? 8000 + i * 2 : 1000 + i,
    b = sourceId === "melon" ? 2000 + i : 9000 + i * 3;
  return {
    sourceId,
    observedAt: new Date(now - (288 - i) * 300000).toISOString(),
    sourceAt: null,
    totalVotes: a + b,
    candidates: [
      { id: sourceId === "melon" ? "101" : "201", name: "A", votes: a },
      { id: sourceId === "melon" ? "102" : "202", name: "B", votes: b },
    ],
  };
}
const records = Array.from({ length: 289 }, (_, i) => [
  row("melon", i),
  row("berriz", i),
]).flat();
async function check(browser, mobile) {
  const context = await browser.newContext(
      mobile
        ? {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
          }
        : { viewport: { width: 1280, height: 960 } },
    ),
    page = await context.newPage(),
    errors = [];
  await page.clock.install({ time: new Date(now) });
  page.on("pageerror", (error) => errors.push(error.message));
  let reads = 0,
    failB = false;
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("multi-history.json"))
      return route.fulfill({ json: { schemaVersion: 1, records } });
    if (u.hostname === "local.test")
      return route.fulfill({
        path: path.join(root, u.pathname === "/" ? "index.html" : u.pathname),
      });
    if (["melon.example", "berriz.example"].includes(u.hostname)) {
      reads++;
      if (failB && u.hostname === "berriz.example")
        return route.fulfill({ status: 503, body: "down" });
      const sample = row(
        u.hostname === "melon.example" ? "melon" : "berriz",
        288,
      );
      return route.fulfill({
        headers: { "Access-Control-Allow-Origin": "*" },
        json:
          u.hostname === "melon.example"
            ? {
                response: {
                  status: "ok",
                  nominees: sample.candidates.map((t) => ({
                    content: { id: t.id, name: t.name },
                    voteCount: t.votes,
                    votePercent: Math.round(
                      (t.votes / sample.totalVotes) * 100,
                    ),
                  })),
                },
              }
            : { total: sample.totalVotes, results: sample.candidates },
      });
    }
    return route.abort();
  });
  await page.goto("https://local.test/");
  await page.waitForFunction(
    () =>
      !document.getElementById("refresh").disabled &&
      document.querySelectorAll("#ranking tbody tr").length === 2,
  );
  assert.equal(reads, 2);
  assert.equal(await page.locator("#tabs button").count(), 3);
  assert.ok(
    (await page.locator("#ranking tbody tr").first().innerText()).includes(
      "팀 B",
    ),
  );
  assert.ok((await page.locator("#total").innerText()).includes("22,016"));
  await page.locator('[data-view="melon"]').click();
  assert.ok(
    (await page.locator("#ranking tbody tr").first().innerText()).includes(
      "팀 A",
    ),
  );
  await page.locator('[data-view="total"]').click();
  const start = Number(await page.locator("#trend").getAttribute("data-start"));
  await page.locator("#zoom-in").click();
  assert.ok(
    Number(await page.locator("#trend").getAttribute("data-start")) > start,
  );
  const box = await page.locator("#trend").boundingBox();
  if (!mobile) {
    await page.mouse.move(box.x + box.width * 0.6, box.y + 100);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
  }
  await page.locator("#reset").click();
  assert.equal(
    Number(await page.locator("#trend").getAttribute("data-start")),
    start,
  );
  await page.locator('[data-team="a"]').click();
  assert.equal(
    await page.locator('[data-team="a"]').getAttribute("aria-pressed"),
    "false",
  );
  assert.ok(await page.locator("#daily .best").count());
  // Cross the 15-minute freshness limit and the next one-minute display tick.
  await page.clock.runFor(961000);
  assert.equal(reads, 2, "no hidden automatic source polling");
  assert.ok(
    (await page.locator("#sources").innerText()).includes("오래된 관측"),
    "freshness ages without polling",
  );
  failB = true;
  await page.locator("#refresh").click();
  await page.waitForFunction(
    () => !document.getElementById("refresh").disabled,
  );
  assert.equal(reads, 4);
  assert.ok(
    (await page.locator("#sources").innerText()).includes("최신 조회 실패"),
  );
  assert.ok(
    (
      await page
        .locator("#ranking tbody tr")
        .first()
        .locator("td")
        .last()
        .innerText()
    ).includes("—"),
    "stale failed source cannot create a valid total",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  fs.mkdirSync("qa-output", { recursive: true });
  await page.screenshot({
    path: `qa-output/multi-${mobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
  await context.close();
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await check(browser, false);
    await check(browser, true);
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(
    "Generated multi-source desktop/mobile tabs, totals, zoom, daily, errors and no polling passed",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
