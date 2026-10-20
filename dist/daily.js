/* KST calendar-day totals from actual endpoints. No midnight interpolation. */
((root) => {
  "use strict";
  const config =
    typeof module !== "undefined" && module.exports
      ? require("./config.js")
      : root.TrackerConfig;
  const DAY = 86400000,
    OFFSET = 9 * 3600000;
  const startOf = (t) => Math.floor((t + OFFSET) / DAY) * DAY - OFFSET;
  const dayKey = (t) => new Date(t + OFFSET).toISOString().slice(0, 10);
  function build(snapshots, teams, now = Date.now()) {
    const rows = snapshots
      .filter(
        (s) =>
          Number.isFinite(Date.parse(s.sourceAt)) &&
          Date.parse(s.sourceAt) <= now,
      )
      .slice()
      .sort((a, b) => Date.parse(a.sourceAt) - Date.parse(b.sourceAt));
    if (!rows.length) return [];
    const out = [],
      buckets = new Map(),
      exact = new Map();
    for (const row of rows) {
      const t = Date.parse(row.sourceAt),
        key = startOf(t);
      const bucket = buckets.get(key);
      if (bucket) bucket.last = row;
      else buckets.set(key, { first: row, last: row });
      if (t === key) exact.set(t, row);
    }
    for (
      let start = startOf(Date.parse(rows[0].sourceAt));
      start <= startOf(now);
      start += DAY
    ) {
      const end = start + DAY,
        bucket = buckets.get(start);
      const a = bucket?.first,
        boundary = exact.get(end);
      const b = boundary || bucket?.last,
        ongoing = now < end;
      const from = a ? Date.parse(a.sourceAt) : null,
        to = b ? Date.parse(b.sourceAt) : null;
      const valid = a && b && to >= from,
        complete = valid && from === start && to === end;
      const values = teams.map((team) => {
        const av = a?.top4.find((t) => String(t.id) === String(team.id)),
          bv = b?.top4.find((t) => String(t.id) === String(team.id));
        return {
          id: team.id,
          name: team.name,
          delta: valid && av && bv ? bv.votes - av.votes : null,
        };
      });
      out.push({
        start,
        end,
        date: dayKey(start),
        ongoing,
        from,
        to,
        complete,
        partial: !valid || from !== start || (!ongoing && to !== end),
        total: valid ? b.totalVotes - a.totalVotes : null,
        values,
      });
    }
    // Reconstruct the configured first campaign day. Reconstruct only if every subsequent day is covered.
    const first = out[0],
      last = rows.at(-1),
      lastTime = Date.parse(last.sourceAt),
      later = out.slice(1).filter((d) => d.start <= lastTime);
    if (
      first.date === config.startsOn &&
      later.length &&
      later.every(
        (d, i) =>
          d.from === d.start &&
          (d.to === d.end || (i === later.length - 1 && d.to === lastTime)),
      ) &&
      later.at(-1).to === Date.parse(last.sourceAt)
    ) {
      first.total =
        last.totalVotes - later.reduce((sum, d) => sum + d.total, 0);
      first.values = teams.map((team) => {
        const current = last.top4.find((t) => String(t.id) === String(team.id)),
          parts = later.map(
            (d) => d.values.find((v) => v.id === team.id)?.delta,
          );
        return {
          id: team.id,
          name: team.name,
          delta:
            current && parts.every(Number.isFinite)
              ? current.votes - parts.reduce((a, b) => a + b, 0)
              : null,
        };
      });
      first.from = first.start;
      first.to = first.end;
      first.partial = false;
      first.complete = true;
      first.reconstructed = true;
    }
    return out.reverse();
  }
  const api = { build, startOf, dayKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MMADaily = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
