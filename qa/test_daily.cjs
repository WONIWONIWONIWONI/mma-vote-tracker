const assert = require("node:assert/strict"),
  D = require("../dist/daily.js");
const teams = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
];
const time = (s) => Date.parse(s + "+09:00");
const row = (s, a, b) => ({
  sourceAt: new Date(time(s)).toISOString(),
  totalVotes: a + b + 50,
  top4: [
    { id: "a", votes: a },
    { id: "b", votes: b },
  ].sort((a, b) => b.votes - a.votes),
});
let rows = [
  row("2026-10-15T10:00:00", 100, 80),
  row("2026-10-16T00:00:00", 200, 150),
  row("2026-10-17T00:00:00", 250, 300),
  row("2026-10-17T12:00:00", 270, 360),
];
let d = D.build(rows, teams, time("2026-10-17T12:01:00"));
assert.deepEqual(
  d[0].values.map((v) => v.delta),
  [20, 60],
);
assert.equal(d[0].total, 80);
assert.equal(d[0].ongoing, true);
assert.equal(d[0].partial, false);
assert.deepEqual(
  d[1].values.map((v) => v.delta),
  [50, 150],
);
assert.equal(d[1].complete, true);
assert.equal(d[1].ongoing, false);
assert.equal(d[2].partial, false);
assert.equal(d[2].reconstructed, true);
assert.deepEqual(
  d[2].values.map((v) => v.delta),
  [200, 150],
);
assert.equal(d[2].total, 400);
let midnight = D.build(rows, teams, time("2026-10-17T00:00:00"));
assert.equal(midnight[0].total, 0);
assert.equal(midnight[1].total, 200);
let waiting = D.build(rows, teams, time("2026-10-18T00:00:00"));
assert.equal(waiting[0].total, null);
assert.equal(waiting[0].date, "2026-10-18");
assert.equal(waiting[1].partial, true);
let missing = D.build(
  [
    rows[0],
    row("2026-10-16T00:05:00", 200, 150),
    row("2026-10-16T23:55:00", 240, 200),
  ],
  teams,
  time("2026-10-17T00:01:00"),
);
assert.equal(missing[1].partial, true);
assert.equal(missing[1].total, 90);
assert.equal(
  missing.at(-1).reconstructed,
  undefined,
  "never put missing later votes into day one",
);
const absent = structuredClone(rows);
absent[1].top4 = absent[1].top4.filter((t) => t.id !== "b");
assert.equal(
  D.build(absent, teams, time("2026-10-17T12:01:00"))[1].values[1].delta,
  null,
);
const corrected = [
  row("2026-10-17T00:00:00", 200, 150),
  row("2026-10-17T12:00:00", 190, 160),
];
assert.equal(
  D.build(corrected, teams, time("2026-10-17T12:01:00"))[0].values[0].delta,
  -10,
);
console.log(
  "Daily totals passed: KST midnight, closure, rank changes, partial first day, missing boundaries, rollover, corrections.",
);
const fs = require("node:fs"),
  data = JSON.parse(fs.readFileSync("dist/data/history.json"));
console.log(
  D.build(data.snapshots, data.snapshots.at(-1).top4).map((r) => ({
    date: r.date,
    total: r.total,
    partial: r.partial,
    ongoing: r.ongoing,
  })),
);
