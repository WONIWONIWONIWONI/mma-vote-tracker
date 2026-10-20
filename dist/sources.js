/* Public-source adapters. No credentials, votes, or guessed private endpoints. */
(function (root) {
  "use strict";
  function at(value, path) {
    return String(path)
      .split(".")
      .reduce((item, key) => item?.[key], value);
  }
  function validate(rows, stamp, sourceAt = null) {
    if (
      !Array.isArray(rows) ||
      !rows.length ||
      !Number.isFinite(Date.parse(stamp))
    )
      throw new Error("Invalid source response");
    const ids = new Set();
    const candidates = rows.map((row) => {
      const id = String(row.id ?? "");
      if (
        !id ||
        typeof row.name !== "string" ||
        !row.name.trim() ||
        ids.has(id) ||
        !Number.isSafeInteger(row.votes) ||
        row.votes < 0
      )
        throw new Error("Invalid or duplicate nominee");
      if (
        row.reportedShare != null &&
        (!Number.isFinite(row.reportedShare) ||
          row.reportedShare < 0 ||
          row.reportedShare > 100)
      )
        throw new Error("Invalid percentage");
      ids.add(id);
      return { ...row, id };
    });
    const totalVotes = candidates.reduce((sum, row) => sum + row.votes, 0);
    if (!Number.isSafeInteger(totalVotes)) throw new Error("Unsafe total");
    if (
      candidates.some(
        (row) =>
          row.reportedShare != null &&
          Math.abs(
            row.reportedShare -
              (totalVotes ? (100 * row.votes) / totalVotes : 0),
          ) > 0.501,
      )
    )
      throw new Error("Inconsistent percentage");
    if (sourceAt != null && !Number.isFinite(Date.parse(sourceAt)))
      throw new Error("Invalid source timestamp");
    candidates.sort((a, b) => b.votes - a.votes);
    return {
      observedAt: stamp,
      sourceAt,
      totalVotes,
      candidates: candidates.map((row, i) => ({ ...row, rank: i + 1 })),
    };
  }
  function melon(payload, stamp) {
    if (payload?.response?.status !== "ok")
      throw new Error("Melon returned a non-ok status");
    const rows = payload.response.nominees;
    if (!Array.isArray(rows)) throw new Error("Missing nominees");
    if (rows.some((row) => !Number.isFinite(row.votePercent)))
      throw new Error("Missing Melon percentage");
    return validate(
      rows.map((row) => ({
        id: row.content?.id,
        name: row.content?.name,
        votes: row.voteCount,
        reportedShare: row.votePercent,
      })),
      stamp,
    );
  }
  function parse(source, payload, stamp) {
    let snapshot;
    if (source.adapter === "melon-top10") snapshot = melon(payload, stamp);
    else if (source.adapter === "mapped-json") {
      // Configure only after checking a real full-roster public response.
      const fields = source.fields;
      if (!fields || source.fullRoster !== true)
        throw new Error("Unverified source mapping");
      if (fields.status && at(payload, fields.status) !== fields.ok)
        throw new Error("Source returned an unsuccessful status");
      const rows = at(payload, fields.rows);
      if (!Array.isArray(rows)) throw new Error("Missing nominee rows");
      snapshot = validate(
        rows.map((row) => ({
          id: at(row, fields.id),
          name: at(row, fields.name),
          votes: at(row, fields.votes),
          reportedShare: fields.share ? at(row, fields.share) : undefined,
        })),
        stamp,
        fields.sourceAt ? at(payload, fields.sourceAt) : null,
      );
      if (fields.total && at(payload, fields.total) !== snapshot.totalVotes)
        throw new Error("Incomplete roster or inconsistent total");
    } else throw new Error("Source adapter is not configured");
    return { ...snapshot, sourceId: source.id };
  }
  const api = { parse, melon, validate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrackerSources = api;
})(globalThis);
