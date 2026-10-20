/* Join immutable, completed public issues without refitting their paths. */
(function (root) {
  "use strict";
  const M =
    typeof module !== "undefined" && module.exports
      ? require("./gap-model.js")
      : root.MMAGapModel;
  function build(records, now = Date.now()) {
    const unique = new Map();
    for (const r of records)
      if (r.cutoff + M.HORIZON <= now && !unique.has(r.cutoff))
        unique.set(r.cutoff, r);
    const models = [...unique.values()]
        .sort((a, b) => a.cutoff - b.cutoff)
        .map(M.window12)
        .filter(Boolean),
      segments = [];
    for (const m of models) {
      const prior = segments.at(-1);
      if (prior && prior.at(-1).t === m.origin) prior.push(...m.path);
      else segments.push(m.path.slice());
    }
    return {
      history: true,
      models,
      segments,
      start: models[0]?.origin,
      end: models.at(-1)?.path.at(-1).t,
    };
  }
  function compare(history, snapshots) {
    const observations = M.points(snapshots),
      rows = history.models.map((model) => ({
        model,
        ...M.comparePoints(model, observations),
      })),
      samples = rows.flatMap((r) => r.samples);
    return {
      rows,
      samples,
      mae: samples.length
        ? samples.reduce((s, p) => s + Math.abs(p.error), 0) / samples.length
        : null,
    };
  }
  function clamp(view, start, end) {
    const span = Math.min(
        end - start,
        Math.max(Math.min(3600000, end - start), view[1] - view[0]),
      ),
      left = Math.max(start, Math.min(end - span, view[0]));
    return [left, left + span];
  }
  const api = { build, compare, clamp };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MMAGapHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
