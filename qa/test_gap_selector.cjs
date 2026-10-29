const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  M = require("../dist/gap-model"),
  S = require("../dist/gap-selector"),
  F = require("../collector/forecast.cjs");
const config = require("../dist/config.js");
const data = JSON.parse(fs.readFileSync("dist/data/history.json"));
// Exercise successive issues while voting is open, independently of archive age.
data.snapshots = data.snapshots.filter(
  (row) =>
    Date.parse(row.sourceAt) <
    Date.parse(config.votingEndsAt || config.endsAt) - 12 * 3600000,
);
const HOUR = 3600000,
  cutoff = M.scheduledCutoff(Date.parse(data.snapshots.at(-1).sourceAt));
const selected = S.select(data.snapshots, cutoff);
assert.ok(selected);
assert.equal(selected.horizonHours, 12);
assert.equal(selected.selection.horizonHours, 12);
assert.ok(selected.selection.validationCount >= 6);
assert.ok(
  selected.selection.validationCutoffs.every((t) => t + 12 * HOUR <= cutoff),
);
assert.equal(selected.path.length, 145);
assert.equal(selected.origin, cutoff);
assert.equal(selected.path.at(-1).t, cutoff + 12 * HOUR);
const future = {
  ...data.snapshots.at(-1),
  sourceAt: new Date(cutoff + 43200000).toISOString(),
  top4: data.snapshots.at(-1).top4.map((t) => ({ ...t, votes: t.votes + 1e6 })),
};
assert.deepEqual(
  S.select([...data.snapshots, future], cutoff),
  selected,
  "future actuals cannot affect candidate validation or selection",
);
function scores(n = 6) {
  return [
    { id: "base", n, score: 100, mae: 100, endpointMAE: 100, winRate: 0 },
    { id: "no-drift", n, score: 80, mae: 80, endpointMAE: 90, winRate: 0.8 },
  ];
}
assert.equal(S.decide(scores(5), "base", 6).switched, false);
assert.equal(S.decide(scores(), "base", 5).switched, false);
assert.equal(S.decide(scores(), "base", 6).chosen, "no-drift");
let weak = scores();
weak[1].score = 95;
assert.equal(S.decide(weak, "base", 6).switched, false);
let endBad = scores();
endBad[1].endpointMAE = 110;
assert.equal(S.decide(endBad, "base", 6).switched, false);
let sporadic = scores();
sporadic[1].winRate = 0.4;
assert.equal(S.decide(sporadic, "base", 6).switched, false);
let old = {
    ...selected,
    issuedAt: "original",
    inputHash: "original",
    recordKind: "issued",
  },
  ledger = { schemaVersion: 1, records: [old] };
assert.deepEqual(
  F.update(data, ledger, cutoff + 10000000),
  ledger,
  "an issued path and metadata never change",
);
const last = data.snapshots.at(-1),
  tail = [];
for (
  let t = Date.parse(last.sourceAt) + 300000;
  t <= cutoff + 43200000 + 300000;
  t += 300000
)
  tail.push({
    ...last,
    sourceAt: new Date(t).toISOString(),
    top4: last.top4.map((team) => ({
      ...team,
      votes:
        team.votes + Math.floor((t - Date.parse(last.sourceAt)) / 60000) * 10,
    })),
  });
const newData = { ...data, snapshots: [...data.snapshots, ...tail] },
  next = F.update(newData, ledger, cutoff + 43200000 + 300000);
assert.equal(next.records.length, 2);
assert.deepEqual(next.records[0], old);
assert.equal(next.records[1].cutoff, cutoff + 43200000);
assert.ok(next.records[1].inputHash);
assert.ok(next.records[1].selection);
assert.equal(next.records[1].path.length, 145);
assert.equal(next.records[1].path.at(-1).t, next.records[1].cutoff + 12 * HOUR);
assert.deepEqual(
  F.update(newData, next, cutoff + 43200000 + 400000),
  next,
  "same cutoff is issued once",
);
assert.deepEqual(
  F.update(newData, next, Date.parse(config.votingEndsAt || config.endsAt)),
  next,
  "voting closure never issues a forecast for a new voting period",
);
assert.deepEqual(
  F.update(newData, next, Date.parse(config.endsAt) + 86400000),
  next,
  "archival invocation preserves the issued ledger without new forecasts",
);
console.log(
  "Adaptive selection passed: strict guards, no future leakage, 12h horizon, legacy ledger preserved, immutable ledger and twice-daily issuance.",
);
