const assert = require("node:assert/strict");
const A = require("../dist/analytics.js");
const points = (start, rate, n = 61) =>
  Array.from({ length: n }, (_, i) => ({
    t: Date.UTC(2026, 9, 15, 0, i),
    v: start + rate * i,
  }));
const up = A.fit(points(-1000, 10)),
  down = A.fit(points(1000, -10));
assert.ok(Math.abs(up.slope - 10) < 1e-8);
assert.ok(Math.abs(down.slope + 10) < 1e-8);
assert.equal(A.crossing(-400, up).kind, "overtake");
assert.ok(Math.abs(A.crossing(-400, up).minutes - 40) < 1e-8);
assert.equal(A.crossing(400, down).kind, "overtaken");
assert.equal(A.crossing(-400, down).kind, "away");
assert.equal(A.crossing(400, up).kind, "away");
assert.equal(A.crossing(0, null).kind, "tied");
assert.equal(A.crossing(400, null).kind, "uncertain");
assert.equal(A.crossing(-10000, up).kind, "distant");
assert.equal(A.distanceChange(-100, -50).kind, "closing");
assert.equal(A.distanceChange(-50, -100).kind, "widening");
assert.equal(A.distanceChange(100, 50).kind, "closing");
assert.equal(A.distanceChange(-10, 10).kind, "crossed");
assert.equal(A.fit(points(0, 1, 5)), null);
assert.equal(A.fit(points(0, 1).filter((p, i) => i < 20 || i > 40)), null);
assert.equal(A.forecast(points(100, 2)).horizon, 30);
assert.ok(
  Math.abs(A.forecast(points(100, 2)).points.at(-1).value - 280) < 1e-8,
);
console.log(
  "Regression / both overtaking directions / signed distance / insufficient data / gaps passed",
);
const fs = require("fs"),
  data = JSON.parse(
    fs.readFileSync("dist/data/history.json", "utf8"),
  ).snapshots,
  last = data.at(-1),
  now = Date.parse(last.sourceAt);
console.log("Latest team projection checks:");
for (const t of last.top4) {
  const p = data
    .filter((r) => Date.parse(r.sourceAt) >= now - 3600000)
    .map((r) => ({
      t: Date.parse(r.sourceAt),
      v: r.top4.find((x) => x.id === t.id)?.votes,
    }));
  const f = A.forecast(p);
  console.log(
    t.name,
    f
      ? {
          rate: f.slope.toFixed(2),
          r2: f.r2.toFixed(3),
          span: f.span.toFixed(1),
        }
      : "withheld",
  );
}

const longSource = Array.from({ length: 13 }, (_, i) => ({
  t: Date.UTC(2026, 9, 15, 12, i * 5),
  v: 1000 + i * 50,
}));
const extended = require("../dist/analytics.js").forecast(longSource, 60, 180);
assert.equal(extended.horizon, 180);
assert.equal(extended.points.at(-1).time - extended.time, 180 * 60000);
assert.equal(
  extended.points.at(-1).value,
  extended.last + extended.slope * 180,
);
console.log(
  "User-selected forecast horizon extends the same fitted trend to three hours.",
);

const gap = points(100, 2).filter((p, i) => i < 25 || i > 35);
assert.equal(A.fit(gap), null, "strict ETA model still withholds long gaps");
const recovered = A.forecast(gap, 60, 180);
assert.ok(
  recovered && recovered.hasGaps,
  "projection uses actual unequal timestamps and labels the gap",
);
assert.ok(Math.abs(recovered.slope - 2) < 1e-8);
assert.equal(recovered.maxGap, 12);
assert.equal(
  A.forecast(points(100, 2).filter((p, i) => i < 10 || i > 45)),
  null,
  "very long gaps remain withheld",
);
console.log(
  "Gap-aware projection passes, while strict ETA and very long gaps remain conservative.",
);
