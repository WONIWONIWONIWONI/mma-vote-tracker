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

// A missing midnight several days later must not undo day-one reconstruction.
const gapped = [...rows, row("2026-10-18T00:00:01", 300, 400)];
const firstDay = D.build(gapped, teams, time("2026-10-18T12:00:00")).at(-1);
assert.equal(firstDay.reconstructed, true);
assert.deepEqual(
  firstDay.values.map((v) => v.delta),
  [200, 150],
);
assert.equal(firstDay.total, 400);
const absentFirst = D.build(absent, teams, time("2026-10-17T12:01:00")).at(-1);
assert.equal(absentFirst.values[1].delta, null);
const actualFirst = D.build(data.snapshots, data.snapshots.at(-1).top4).find(
  (d) => d.date === "2026-10-15",
);
assert.equal(
  actualFirst.values.find((v) => String(v.id) === "994944").delta,
  86056,
);
assert.equal(actualFirst.total, 540879);

// Adjacent days must share a real, slightly late midnight observation.
const late = [
  row("2026-10-18T00:00:00", 100, 100),
  row("2026-10-18T23:55:01", 150, 170),
  row("2026-10-19T00:00:01", 160, 180),
  row("2026-10-20T00:00:00", 220, 230),
];
const lateDays = D.build(late, teams, time("2026-10-20T00:00:00"));
assert.equal(lateDays[2].to, lateDays[1].from);
assert.equal(lateDays[2].boundaryLate, true);
assert.equal(lateDays[2].partial, true);
assert.equal(lateDays[1].partial, true);
assert.equal(lateDays[2].total + lateDays[1].total, 250);
const tooLate = structuredClone(late);
tooLate[2].sourceAt = new Date(time("2026-10-19T00:05:00")).toISOString();
assert.equal(
  D.build(tooLate, teams, time("2026-10-20T00:00:00"))[2].to,
  Date.parse(late[1].sourceAt),
);

// Audit every real day: independently sum consecutive observed increments in each
// reported interval, and reconcile the whole campaign with final cumulative votes.
const auditedRows = data.snapshots.filter(
  (s) => Date.parse(s.sourceAt) <= Date.parse("2026-10-22T13:45:00Z"),
);
const actual = D.build(
  auditedRows,
  auditedRows.at(-1).top4,
  Date.parse(auditedRows.at(-1).sourceAt),
).reverse();
for (let i = 1; i < actual.length; i++) {
  const day = actual[i],
    points = auditedRows.filter(
      (s) =>
        Date.parse(s.sourceAt) >= day.from && Date.parse(s.sourceAt) <= day.to,
    );
  assert.equal(
    actual[i - 1].to,
    day.from,
    "no unassigned boundary interval on " + day.date,
  );
  assert.equal(
    day.total,
    points
      .slice(1)
      .reduce((sum, s, j) => sum + s.totalVotes - points[j].totalVotes, 0),
  );
  for (const value of day.values) {
    const parts = points.map(
      (s) => s.top4.find((t) => String(t.id) === String(value.id))?.votes,
    );
    if (parts.every(Number.isFinite))
      assert.equal(
        value.delta,
        parts.slice(1).reduce((sum, n, j) => sum + n - parts[j], 0),
      );
  }
}
const last = auditedRows.at(-1);
assert.equal(
  actual.reduce((sum, d) => sum + d.total, 0),
  last.totalVotes,
);
for (const team of last.top4)
  assert.equal(
    actual.reduce(
      (sum, d) =>
        sum + d.values.find((v) => String(v.id) === String(team.id)).delta,
      0,
    ),
    team.votes,
  );
console.log(
  "All recorded daily intervals reconcile with cumulative totals for every team.",
);
