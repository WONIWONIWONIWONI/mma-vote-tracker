/* Short-horizon descriptive projection, not a probability or a seasonal model. */
(function (root) {
  "use strict";
  function fit(points, minutes = 60, options = {}) {
    const clean = points
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    if (!clean.length) return null;
    const last = clean.at(-1),
      rows = clean.filter((p) => p.t >= last.t - minutes * 60000);
    const span = (last.t - rows[0].t) / 60000;
    if (rows.length < 6 || span < 15) return null;
    const maxGap = Math.max(
      0,
      ...rows.slice(1).map((p, i) => (p.t - rows[i].t) / 60000),
    );
    if (maxGap > (options.allowGaps ? 30 : 10)) return null;
    const halfLife = Math.max(10, minutes / 2);
    let sw = 0,
      sx = 0,
      sy = 0;
    const data = rows.map((p) => {
      const x = (p.t - last.t) / 60000,
        w = 2 ** (x / halfLife);
      sw += w;
      sx += w * x;
      sy += w * p.v;
      return { x, y: p.v, w };
    });
    const mx = sx / sw,
      my = sy / sw;
    let xx = 0,
      xy = 0,
      yy = 0;
    data.forEach((p) => {
      xx += p.w * (p.x - mx) ** 2;
      xy += p.w * (p.x - mx) * (p.y - my);
      yy += p.w * (p.y - my) ** 2;
    });
    if (xx <= 0) return null;
    const slope = xy / xx,
      intercept = my - slope * mx;
    const error = data.reduce(
      (s, p) => s + p.w * (p.y - intercept - slope * p.x) ** 2,
      0,
    );
    const r2 = yy > 1e-9 ? Math.max(0, 1 - error / yy) : 1;
    return {
      slope,
      intercept,
      r2,
      rmse: Math.sqrt(error / sw),
      span,
      n: rows.length,
      last: last.v,
      time: last.t,
      horizon: Math.min(30, span / 2),
      maxGap,
      hasGaps: maxGap > 10,
    };
  }
  function forecast(points, minutes = 60, requestedHorizon = null) {
    const model = fit(points, minutes, { allowGaps: true });
    if (!model || model.r2 < 0.3) return null;
    const horizon =
      Number.isFinite(requestedHorizon) && requestedHorizon > 0
        ? Math.min(1440, requestedHorizon)
        : model.horizon;
    return {
      ...model,
      horizon,
      points: [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const m = (i * horizon) / 6;
        return {
          time: model.time + m * 60000,
          value: model.last + model.slope * m,
        };
      }),
    };
  }
  function crossing(gap, model) {
    if (Math.abs(gap) < 0.5) return { kind: "tied", minutes: 0 };
    if (!model || model.r2 < 0.3) return { kind: "uncertain", minutes: null };
    if (Math.abs(model.slope) < 0.01) return { kind: "flat", minutes: null };
    if (gap * model.slope >= 0) return { kind: "away", minutes: null };
    const minutes = -gap / model.slope,
      limit = Math.min(360, model.span * 3);
    return {
      kind: minutes > limit ? "distant" : gap < 0 ? "overtake" : "overtaken",
      minutes,
      limit,
    };
  }
  function distanceChange(before, after) {
    const delta = Math.abs(after) - Math.abs(before);
    return {
      delta,
      kind:
        before * after < 0
          ? "crossed"
          : delta < -0.5
            ? "closing"
            : delta > 0.5
              ? "widening"
              : "flat",
    };
  }
  const api = { fit, forecast, crossing, distanceChange };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MMAAnalytics = api;
})(globalThis);
