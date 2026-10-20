const assert = require("node:assert/strict"),
  D = require("../dist/data.js");
const p = {
  response: {
    status: "ok",
    nominees: Array.from({ length: 6 }, (_, i) => ({
      content: { id: i, name: "team" + i },
      voteCount: 100,
      votePercent: 17,
    })),
  },
};
const live = D.parse(p, "2026-10-15T12:30:40Z");
assert.equal(live.top4.length, 6);
assert.equal(live.totalVotes, 600);
assert.throws(() => D.parse({ response: { status: "error" } }, live.sourceAt));
const bad = structuredClone(p);
bad.response.nominees[1].content.id = 0;
assert.throws(() => D.parse(bad, live.sourceAt));
const row = (stamp, votes) => ({ ...live, sourceAt: stamp, totalVotes: votes });
const archive = {
  snapshots: [
    row("2026-10-15T12:29:00Z", 500),
    row("2026-10-15T12:30:00Z", 550),
  ],
};
assert.equal(D.combine(archive, [live]).snapshots.at(-1).totalVotes, 600);
assert.equal(
  D.merge([live], archive.snapshots).at(-1).totalVotes,
  600,
  "late archive must not overwrite newer live sample",
);
assert.equal(
  D.merge([live], [row("2026-10-15T12:30:50Z", 590)]).at(-1).totalVotes,
  590,
  "official correction is valid",
);
assert.equal(
  D.combine(archive, [live]).snapshots.length,
  2,
  "one latest point per minute",
);
console.log(
  "Data parser, stale archive races, corrections, minute merge: passed",
);
