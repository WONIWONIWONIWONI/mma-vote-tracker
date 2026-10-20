/* Public live response validation and timestamp-aware session/archive merging. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MMAData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const config =
    typeof module === "object" && module.exports
      ? require("./config.js")
      : globalThis.TrackerConfig;
  const normalizedId = (team) =>
    String(team.id || team.name)
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  function normalize(data) {
    if (
      !data ||
      ![1, 2].includes(data.schemaVersion) ||
      !Array.isArray(data.snapshots) ||
      !data.snapshots.length
    )
      throw new Error("기록 형식이 올바르지 않습니다.");
    const seen = new Set();
    const snapshots = data.snapshots
      .map((original) => {
        const s = { ...original };
        if (
          !Number.isFinite(Date.parse(s.sourceAt)) ||
          seen.has(s.sourceAt) ||
          !Number.isSafeInteger(s.totalVotes) ||
          s.totalVotes <= 0 ||
          !Array.isArray(s.top4) ||
          s.top4.length < 4 ||
          s.top4.length > config.topN
        )
          throw new Error("유효하지 않은 집계 기록입니다.");
        seen.add(s.sourceAt);
        let sum = 0;
        const ids = new Set();
        const top4 = s.top4.map((t, i) => {
          if (
            !t.name ||
            !Number.isSafeInteger(t.votes) ||
            t.votes < 0 ||
            t.votes > s.totalVotes
          )
            throw new Error("득표수 형식이 올바르지 않습니다.");
          const id = normalizedId(t);
          if (ids.has(id)) throw new Error("중복된 아티스트입니다.");
          ids.add(id);
          sum += t.votes;
          if (i && s.top4[i - 1].votes < t.votes)
            throw new Error("순위와 표수가 일치하지 않습니다.");
          if (
            t.reportedShare != null &&
            (!Number.isFinite(t.reportedShare) ||
              Math.abs(t.reportedShare - (100 * t.votes) / s.totalVotes) >
                0.501)
          )
            throw new Error("점유율과 표수가 일치하지 않습니다.");
          return { ...t, id, rank: i + 1 };
        });
        if (sum > s.totalVotes)
          throw new Error("총투표수보다 상위 득표수의 합이 큽니다.");
        return { ...s, top4 };
      })
      .sort((a, b) => Date.parse(a.sourceAt) - Date.parse(b.sourceAt));
    return { ...data, schemaVersion: 2, snapshots };
  }
  function parse(payload, stamp) {
    const Sources =
      typeof module === "object" && module.exports
        ? require("./sources.js")
        : globalThis.TrackerSources;
    const snapshot = Sources.melon(payload, stamp);
    if (snapshot.candidates.length < config.topN || snapshot.totalVotes <= 0)
      throw new Error("Incomplete Melon response");
    return {
      sourceAt: stamp,
      collectedAt: stamp,
      origin: "melon_browser_api",
      totalVotes: snapshot.totalVotes,
      top4: snapshot.candidates.slice(0, config.topN),
    };
  }

  function merge(...lists) {
    const rows = new Map();
    lists.flat().forEach((s) => {
      const t = Date.parse(s.sourceAt),
        key = Math.floor(t / 60000),
        old = rows.get(key);
      if (!old || t >= Date.parse(old.sourceAt)) rows.set(key, s);
    });
    return [...rows.values()].sort(
      (a, b) => Date.parse(a.sourceAt) - Date.parse(b.sourceAt),
    );
  }
  function combine(archive, observations) {
    return { ...archive, snapshots: merge(archive.snapshots, observations) };
  }
  return { parse, normalize, merge, combine };
});
