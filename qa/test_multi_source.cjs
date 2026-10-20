const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const M = require("../dist/multi-source.js"),
  S = require("../dist/sources.js"),
  N = require("../scripts/new-tracker.cjs");
const C = require("./fixtures/multi-config.json"),
  now = Date.parse("2026-10-20T03:00:00Z");
const row = (sourceId, a, b, time = now) => ({
  sourceId,
  observedAt: new Date(time).toISOString(),
  sourceAt: null,
  totalVotes: a + b,
  candidates: [
    { id: sourceId === "melon" ? "101" : "201", name: "A", votes: a },
    { id: sourceId === "melon" ? "102" : "202", name: "B", votes: b },
  ],
});
const a = row("melon", 80, 20),
  b = row("berriz", 10, 90),
  latest = { melon: a, berriz: b };
M.validateConfig(C);
const sum = M.aggregate(C, latest, now);
assert.equal(sum.complete, true);
assert.equal(sum.totalVotes, 200);
assert.deepEqual(
  sum.rows.map((row) => [row.id, row.votes, Number(row.share.toFixed(8))]),
  [
    ["b", 110, 55],
    ["a", 90, 45],
  ],
);
assert.deepEqual(sum.rows[1].contributions, { melon: 80, berriz: 10 });
assert.equal(
  M.aggregate(C, { melon: a }, now).rows[0].votes,
  null,
  "missing is never zero",
);
assert.equal(
  M.aggregate(C, { melon: a, berriz: row("berriz", 10, 90, now - 121000) }, now)
    .reason,
  "time-skew",
);
assert.equal(
  M.aggregate(C, latest, now + 901000).complete,
  false,
  "stale total is withheld",
);
assert.equal(
  M.aggregate(C, { ...latest, berriz: row("berriz", 10, 90, now + 1) }, now)
    .complete,
  false,
  "future observation is rejected",
);
assert.equal(
  M.aggregate(
    C,
    { ...latest, berriz: { ...b, candidates: [b.candidates[0]] } },
    now,
  ).complete,
  false,
  "partial roster cannot invent zero votes",
);
assert.equal(
  M.aggregate(
    C,
    {
      ...latest,
      berriz: { ...b, candidates: [b.candidates[0], b.candidates[0]] },
    },
    now,
  ).complete,
  false,
);
const corrected = row("melon", 70, 20, now + 20000);
assert.equal(
  M.mergeRecords([a, b], [corrected], [a]).length,
  2,
  "one source-minute, independent sources",
);
assert.equal(
  M.mergeRecords([a, b], [corrected], [a]).find(
    (row) => row.sourceId === "melon",
  ).totalVotes,
  90,
  "newer correction wins over late archive",
);
assert.equal(
  M.aggregate(
    C,
    { melon: row("melon", 0, 0), berriz: row("berriz", 0, 0) },
    now,
  ).totalVotes,
  0,
  "verified zero is valid",
);
const futureB = row("berriz", 20, 100, now + 60000),
  history = M.timeline(C, [a, futureB]);
assert.equal(history[0].complete, false);
assert.equal(history[1].complete, true);
assert.equal(history[1].rows.find((row) => row.id === "a").votes, 100);
assert.equal(M.legacySnapshot(sum).top4[0].id, "b");
assert.equal(M.legacySnapshot(sum, "melon").top4[0].id, "a");
const badConfig = structuredClone(C);
badConfig.sources[1].candidateIds.b = "201";
assert.throws(() => M.validateConfig(badConfig));
const melon = {
  response: {
    status: "ok",
    nominees: [
      { content: { id: "101", name: "A" }, voteCount: 80, votePercent: 80 },
      { content: { id: "102", name: "B" }, voteCount: 20, votePercent: 20 },
    ],
  },
};
assert.equal(S.parse(C.sources[0], melon, a.observedAt).totalVotes, 100);
assert.throws(() =>
  S.parse(
    C.sources[0],
    {
      response: {
        ...melon.response,
        nominees: [{ content: { id: 1, name: "A" }, voteCount: 80 }],
      },
    },
    a.observedAt,
  ),
);
const payload = {
  total: 100,
  results: [
    { id: "201", name: "A", votes: 10 },
    { id: "202", name: "B", votes: 90 },
  ],
};
assert.equal(S.parse(C.sources[1], payload, b.observedAt).totalVotes, 100);
assert.throws(() =>
  S.parse({ ...C.sources[1], fullRoster: false }, payload, b.observedAt),
);
assert.throws(() =>
  S.parse(C.sources[1], { ...payload, total: 101 }, b.observedAt),
);
assert.throws(() =>
  S.parse(
    C.sources[1],
    { ...payload, results: [{ id: 1, name: "A", votes: "100" }] },
    b.observedAt,
  ),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vote-template-"));
(async () => {
  try {
    const dest = N.create(C, path.join(tmp, "new"));
    const files = fs.readdirSync(path.join(dest, "dist/data"));
    assert.deepEqual(files, ["multi-history.json"]);
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(dest, "dist/data/multi-history.json")),
      ),
      { schemaVersion: 1, records: [] },
    );
    assert.throws(
      () => N.create(C, dest),
      "never overwrite an existing campaign",
    );
    const collector = require(path.join(dest, "collector/collect.cjs"));
    const collected = await collector.collect(
      C,
      undefined,
      async (url) => (url.includes("melon") ? melon : payload),
      now,
    );
    assert.equal(collected.records.length, 2);
    assert.equal(collected.collector.state, "ok");
    const partial = await collector.collect(
      C,
      collected,
      async (url) => {
        if (url.includes("berriz")) throw new Error("source down");
        return melon;
      },
      now + 300000,
    );
    assert.equal(partial.collector.state, "partial");
    assert.equal(
      partial.records.length,
      3,
      "failed source retains old observation, successful source continues",
    );
    const stopped = await collector.collect(
      C,
      collected,
      () => {
        throw new Error("must not request after deadline");
      },
      Date.parse(C.endsAt),
    );
    assert.equal(stopped.collector.state, "stopped");
    console.log(
      "Multi-source sums, mapping, freshness, correction/races, no future leakage, independent failures, clean generation: passed",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
