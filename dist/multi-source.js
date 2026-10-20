/* Source-independent arithmetic: stable identity, exact counts, honest coverage. */
(function (root) {
  "use strict";
  function validateConfig(config) {
    if (
      config.schemaVersion !== 1 ||
      !config.id ||
      !config.title ||
      !Array.isArray(config.sources) ||
      !config.sources.length ||
      !Array.isArray(config.candidates) ||
      !config.candidates.length
    )
      throw new Error("Missing tracker configuration");
    if (config.aggregation?.mode !== "sum-votes")
      throw new Error("Only explicitly verified raw-vote sums are supported");
    for (const key of ["maxSkewSeconds", "staleAfterSeconds"])
      if (
        !Number.isFinite(config.aggregation[key]) ||
        config.aggregation[key] <= 0
      )
        throw new Error("Invalid freshness limit");
    const sources = new Set(),
      candidates = new Set();
    for (const candidate of config.candidates) {
      if (!candidate.id || !candidate.name || candidates.has(candidate.id))
        throw new Error("Duplicate or missing canonical candidate");
      if (candidate.color && !/^#[0-9a-f]{6}$/i.test(candidate.color))
        throw new Error("Use a six-digit candidate color");
      candidates.add(candidate.id);
    }
    for (const source of config.sources) {
      if (
        !/^[a-z][a-z0-9-]*$/.test(source.id) ||
        sources.has(source.id) ||
        ["total", "constructor", "prototype"].includes(source.id)
      )
        throw new Error("Invalid source ID");
      if (source.color && !/^#[0-9a-f]{6}$/i.test(source.color))
        throw new Error("Use a six-digit source color");
      sources.add(source.id);
      for (const address of [source.url, source.endpoint].filter(Boolean))
        if (new URL(address).protocol !== "https:")
          throw new Error("Use HTTPS public sources");
      const ids = config.candidates.map(
        (candidate) => source.candidateIds?.[candidate.id],
      );
      if (
        ids.some((id) => typeof id !== "string" || !id) ||
        new Set(ids).size !== ids.length
      )
        throw new Error(
          "Every source needs an explicit, unique candidate ID mapping",
        );
    }
    return config;
  }
  function inspect(config, source, snapshot, now) {
    if (!snapshot || snapshot.sourceId !== source.id)
      return { sourceId: source.id, state: "missing", snapshot: null };
    const time = Date.parse(snapshot.observedAt),
      sourceTime =
        snapshot.sourceAt == null ? time : Date.parse(snapshot.sourceAt);
    const freshness = config.aggregation.staleAfterSeconds * 1000;
    const malformed =
      !Number.isFinite(time) ||
      !Number.isFinite(sourceTime) ||
      time > now ||
      sourceTime > now + 60000 ||
      !Number.isSafeInteger(snapshot.totalVotes) ||
      snapshot.totalVotes < 0 ||
      !Array.isArray(snapshot.candidates);
    if (malformed)
      return { sourceId: source.id, state: "invalid", snapshot: null };
    if (
      snapshot.candidates.some(
        (row) => !row || !Number.isSafeInteger(row.votes) || row.votes < 0,
      ) ||
      new Set(snapshot.candidates.map((row) => String(row.id))).size !==
        snapshot.candidates.length ||
      snapshot.candidates.reduce((sum, row) => sum + row.votes, 0) !==
        snapshot.totalVotes
    )
      return { sourceId: source.id, state: "invalid", snapshot: null };
    const byId = new Map(
      snapshot.candidates.map((row) => [String(row.id), row]),
    );
    const rows = config.candidates.map((candidate) => {
      const observed = byId.get(source.candidateIds[candidate.id]);
      return { ...candidate, votes: observed?.votes ?? null };
    });
    if (
      rows.some(
        (row) =>
          !Number.isSafeInteger(row.votes) ||
          row.votes < 0 ||
          row.votes > snapshot.totalVotes,
      )
    )
      return { sourceId: source.id, state: "incomplete", snapshot, rows };
    return {
      sourceId: source.id,
      effectiveTime: sourceTime,
      state: now - Math.min(time, sourceTime) > freshness ? "stale" : "ok",
      time,
      snapshot,
      rows,
    };
  }
  function aggregate(config, latest, now = Date.now()) {
    const sources = config.sources.map((source) =>
      inspect(config, source, latest[source.id], now),
    );
    const times = sources
      .filter((s) => s.state === "ok")
      .map((s) => s.effectiveTime);
    const skew = times.length ? Math.max(...times) - Math.min(...times) : null;
    const complete =
      sources.every((s) => s.state === "ok") &&
      skew <= config.aggregation.maxSkewSeconds * 1000;
    const totalVotes = complete
      ? sources.reduce((sum, s) => sum + s.snapshot.totalVotes, 0)
      : null;
    if (complete && !Number.isSafeInteger(totalVotes))
      throw new Error("Unsafe combined total");
    const rows = config.candidates
      .map((candidate) => {
        const contributions = Object.fromEntries(
          sources.map((source) => [
            source.sourceId,
            source.rows?.find((row) => row.id === candidate.id)?.votes ?? null,
          ]),
        );
        const votes = complete
          ? Object.values(contributions).reduce((a, b) => a + b, 0)
          : null;
        return {
          ...candidate,
          contributions,
          votes,
          share:
            complete && totalVotes
              ? (votes / totalVotes) * 100
              : complete
                ? 0
                : null,
        };
      })
      .sort((a, b) => (b.votes ?? -1) - (a.votes ?? -1));
    return {
      complete,
      reason: complete
        ? "ok"
        : sources.some((s) => s.state !== "ok")
          ? "source-unavailable"
          : "time-skew",
      sources,
      skew,
      totalVotes,
      rows: rows.map((row, i) => ({ ...row, rank: complete ? i + 1 : null })),
      from: complete ? Math.min(...times) : null,
      to: complete ? Math.max(...times) : null,
    };
  }
  function mergeRecords(...lists) {
    const records = new Map();
    for (const row of lists.flat()) {
      const time = Date.parse(row.observedAt);
      if (!row.sourceId || !Number.isFinite(time))
        throw new Error("Invalid observation");
      const key = row.sourceId + ":" + Math.floor(time / 60000),
        prior = records.get(key);
      if (!prior || time >= Date.parse(prior.observedAt)) records.set(key, row);
    }
    return [...records.values()].sort(
      (a, b) =>
        Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
        a.sourceId.localeCompare(b.sourceId),
    );
  }
  function timeline(config, records) {
    // Single chronological pass; later responses can never leak into earlier totals.
    const ordered = mergeRecords(records),
      latest = {},
      result = [];
    for (let i = 0; i < ordered.length; ) {
      const time = Date.parse(ordered[i].observedAt);
      do {
        const row = ordered[i++];
        latest[row.sourceId] = row;
      } while (
        i < ordered.length &&
        Date.parse(ordered[i].observedAt) === time
      );
      const value = aggregate(config, latest, time);
      result.push({ time, ...value });
    }
    return result;
  }
  function legacySnapshot(view, sourceId = "total") {
    const selected = view.sources.find(
      (source) => source.sourceId === sourceId,
    );
    const rows = sourceId === "total" ? view.rows : selected?.rows;
    if (sourceId === "total" ? !view.complete : selected?.state !== "ok")
      return null;
    const totalVotes =
      sourceId === "total" ? view.totalVotes : selected.snapshot.totalVotes;
    return {
      sourceAt: new Date(
        sourceId === "total" ? view.to : selected.time,
      ).toISOString(),
      totalVotes,
      top4: rows
        .slice()
        .sort((a, b) => b.votes - a.votes)
        .map((row, i) => ({ ...row, rank: i + 1 })),
    };
  }
  const api = {
    validateConfig,
    aggregate,
    mergeRecords,
    timeline,
    legacySnapshot,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrackerMulti = api;
})(globalThis);
