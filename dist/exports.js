/* Draw standalone panel images locally, without screenshots or remote services. */
((root) => {
  "use strict";
  const bg = "#100e19",
    panel = "#191725",
    muted = "#aaa3b8",
    ink = "#f5f0f6",
    lime = "#ff7594";
  const font = '"DM Sans", "Noto Sans KR", sans-serif';
  function surface(model, height) {
    const width = 1000;
    // Keep long daily images inside conservative mobile canvas limits.
    const scale = Math.min(
      2,
      4096 / height,
      Math.sqrt(8000000 / (width * height)),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    const c = canvas.getContext("2d");
    if (!c) throw new Error("Canvas is unavailable.");
    c.scale(scale, scale);
    c.fillStyle = bg;
    c.fillRect(0, 0, width, height);
    const text = (
      value,
      x,
      y,
      size = 16,
      color = ink,
      weight = 400,
      align = "left",
      maxWidth = 900,
    ) => {
      value = String(value);
      c.fillStyle = color;
      c.textAlign = align;
      do {
        c.font = `${weight} ${size}px ${font}`;
        if (c.measureText(value).width <= maxWidth || size <= 10) break;
        size--;
      } while (true);
      c.fillText(value, x, y);
    };
    const line = (x1, y1, x2, y2, color = "#41374f") => {
      c.beginPath();
      c.strokeStyle = color;
      c.lineWidth = 1;
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
    };
    const rect = (x, y, w, h, color = panel) => {
      c.fillStyle = color;
      c.fillRect(x, y, w, h);
    };
    text("VOTE/TRACK · " + TrackerConfig.edition, 48, 40, 14, lime, 600);
    text(
      "최신 관측 " + model.sourceAt + " KST",
      952,
      40,
      9,
      muted,
      400,
      "right",
      590,
    );
    text(model.title, 48, 91, 22, ink, 600);
    text(model.subtitle, 48, 122, 10, muted);
    line(48, 143, 952, 143);
    line(48, height - 54, 952, height - 54);
    text("데이터 출처 Melon · 비공식 팬 대시보드", 48, height - 27, 9, muted);
    text(
      "모든 시각은 한국 시간 (KST)",
      952,
      height - 27,
      9,
      muted,
      400,
      "right",
    );
    return { canvas, c, text, line, rect };
  }
  function trend(model) {
    const { canvas, c, text, line, rect } = surface(model, 1470);
    text("현재 득표 현황", 48, 177, 14, ink, 500);
    model.leaders.forEach((team, i) => {
      const top = 196 + i * 112;
      rect(48, top, 904, 100);
      rect(48, top, 4, 100, team.color);
      text(
        team.rank + "위 · " + team.name,
        68,
        top + 25,
        18,
        team.color,
        600,
        "left",
        625,
      );
      text(
        "전체 투표 대비 점유율",
        932,
        top + 25,
        10,
        muted,
        400,
        "right",
        230,
      );
      text(team.votes, 68, top + 67, 30, ink, 600, "left", 590);
      text(team.share, 932, top + 67, 23, team.color, 500, "right", 240);
      text(team.gap, 68, top + 89, 9, muted, 500);
    });
    text(model.chartTitle, 48, 877, 17, ink, 600);
    const left = 108,
      right = 950,
      top = 935,
      bottom = 1285;
    const x = (time) =>
      left + ((time - model.xmin) / (model.xmax - model.xmin)) * (right - left);
    const y = (value) =>
      bottom -
      ((value - model.ymin) / (model.ymax - model.ymin)) * (bottom - top);
    model.series.forEach((series, i) =>
      text(
        "● " + series.name,
        48 + (i % 3) * 300,
        903 + Math.floor(i / 3) * 16,
        10,
        series.color,
        500,
        "left",
        370,
      ),
    );
    for (const tick of model.ticks) {
      line(left, y(tick.value), right, y(tick.value));
      text(
        tick.label,
        left - 14,
        y(tick.value) + 4,
        10,
        muted,
        400,
        "right",
        90,
      );
    }
    c.save();
    c.beginPath();
    c.rect(left, top, right - left, bottom - top);
    c.clip();
    for (const series of model.series) {
      c.beginPath();
      c.strokeStyle = series.color;
      c.lineWidth = 1.6;
      let active = false;
      for (const point of series.points) {
        if (point.value == null) continue;
        if (active) c.lineTo(x(point.time), y(point.value));
        else c.moveTo(x(point.time), y(point.value));
        active = true;
      }
      c.stroke();
      series.points.forEach((point, i) => {
        if (
          point.value == null ||
          (series.points.length > 100 && i !== series.points.length - 1)
        )
          return;
        c.beginPath();
        c.fillStyle = series.color;
        c.arc(
          x(point.time),
          y(point.value),
          series.points.length === 1 ? 5 : 3,
          0,
          Math.PI * 2,
        );
        c.fill();
      });
    }
    if (model.forecasts?.length) {
      c.setLineDash([5, 5]);
      for (const f of model.forecasts) {
        c.beginPath();
        c.strokeStyle = f.color;
        c.lineWidth = 1.6;
        f.points.forEach((p, i) => {
          if (i) c.lineTo(x(p.time), y(p.value));
          else c.moveTo(x(p.time), y(p.value));
        });
        c.stroke();
      }
      c.strokeStyle = muted;
      c.beginPath();
      c.moveTo(x(model.lastTime), top);
      c.lineTo(x(model.lastTime), bottom);
      c.stroke();
      c.setLineDash([]);
    }
    c.restore();
    text(model.firstLabel, left, 1313, 10, muted);
    if (model.lastLabel !== model.firstLabel)
      text(model.lastLabel, right, 1313, 12, muted, 400, "right");
    text(model.rangeNote, 48, 1345, 10, lime);
    text(model.note, 48, 1374, 10, muted);
    return canvas;
  }
  function hourly(model) {
    const height = 260 + model.rows.length * 94;
    const { canvas, text, rect, line } = surface(model, height);
    const teams = model.rows[0]?.values || [],
      col = 118;
    text("시간 / 관측 최다", 48, 175, 11, muted);
    teams.forEach((t, i) =>
      text(t.name, 260 + i * col, 175, 10, t.color, 500, "left", 110),
    );
    model.rows.forEach((row, i) => {
      const y = 200 + i * 94,
        valid = row.values.filter((v) => v.delta != null),
        same = new Set(valid.map((v) => v.from + ":" + v.to)).size === 1,
        max = Math.max(0, ...valid.map((v) => v.delta)),
        winners = same && max > 0 ? valid.filter((v) => v.delta === max) : [];
      rect(48, y - 10, 904, 84);
      text(row.label, 58, y + 10, 12, ink, 600, "left", 190);
      text(
        winners.length
          ? winners.map((v) => v.name).join(" · ")
          : "구간 다름 / 기록 대기",
        58,
        y + 30,
        10,
        lime,
        500,
        "left",
        190,
      );
      text(row.status, 58, y + 48, 9, muted);
      row.values.forEach((v, j) => {
        const win = winners.includes(v),
          x = 260 + j * col;
        text(
          v.label,
          x,
          y + 15,
          13,
          win ? lime : ink,
          win ? 700 : 400,
          "left",
          110,
        );
        rect(
          x,
          y + 27,
          (Math.abs(v.delta ?? 0) /
            Math.max(1, ...valid.map((v) => Math.abs(v.delta)))) *
            100,
          4,
          v.color,
        );
        if (v.coverage) text(v.coverage, x, y + 48, 8, muted, 400, "left", 108);
      });
    });
    return canvas;
  }
  const painters = { trend, hourly };
  root.MMAImages = {
    render(model) {
      const painter = painters[model.type];
      if (!painter) throw new Error("Unknown image panel.");
      return painter(model);
    },
  };
})(globalThis);
