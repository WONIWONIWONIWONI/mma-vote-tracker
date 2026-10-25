/* Draw standalone panel images locally, without screenshots or remote services. */
((root) => {
  "use strict";
  const bg = "#10121b",
    panel = "#1a1e2b",
    muted = "#a4adbf",
    ink = "#f5f6fa",
    lime = "#f2aac2";
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
      size = Math.max(12, size);
      c.fillStyle = color;
      c.textAlign = align;
      do {
        c.font = `${weight} ${size}px ${font}`;
        if (c.measureText(value).width <= maxWidth || size <= 12) break;
        size--;
      } while (true);
      c.fillText(value, x, y, maxWidth);
    };
    const line = (x1, y1, x2, y2, color = "#41374f") => {
      c.beginPath();
      c.strokeStyle = color;
      c.lineWidth = 0.5;
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
    };
    const rect = (x, y, w, h, color = panel, radius = 12) => {
      c.fillStyle = color;
      c.beginPath();
      c.roundRect(x, y, w, h, Math.min(radius, h / 2));
      c.fill();
    };
    text("VOTE/TRACK / " + TrackerConfig.edition, 48, 44, 12, lime, 700);
    text(
      "최신 관측 " + model.sourceAt + " KST",
      952,
      44,
      11,
      muted,
      400,
      "right",
      590,
    );
    text(model.title, 48, 98, 30, ink, 700);
    text(model.subtitle, 48, 130, 12, muted);
    line(48, 158, 952, 158, "#303648");
    line(48, height - 54, 952, height - 54);
    text("데이터 출처 Melon / 비공식 팬 대시보드", 48, height - 27, 10, muted);
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
  function leaderCards(model, draw, start = 196) {
    const { text, rect, line } = draw;
    model.leaders.forEach((team, i) => {
      const x = 48 + (i % 2) * 464,
        y = start + Math.floor(i / 2) * 152;
      rect(x, y, 440, 136, i < 2 ? "#212536" : panel, 14);

      text(String(team.rank).padStart(2, "0"), x + 24, y + 36, 12, muted, 600);
      text(team.name, x + 66, y + 36, 17, ink, 600, "left", 348);
      text(team.votes, x + 24, y + 77, 30, ink, 600, "left", 285);
      text(team.share, x + 416, y + 77, 21, team.color, 600, "right", 112);
      text(team.gap, x + 24, y + 105, 11, muted, 400, "left", 394);
      rect(x + 24, y + 119, 392, 3, "#33394c");
      rect(
        x + 24,
        y + 119,
        (392 * Math.max(0, Math.min(100, team.shareValue || 0))) / 100,
        3,
        team.color,
      );
    });
  }
  function leaders(model) {
    const draw = surface(model, 760);
    leaderCards(model, draw);
    draw.text(
      "득표율 = 팀 득표수 ÷ 전체 투표수 / 소수점 둘째 자리 반올림",
      48,
      680,
      11,
      muted,
    );
    return draw.canvas;
  }
  function trend(model) {
    const draw = surface(model, 1290);
    const { canvas, c, text, line, rect } = draw;
    leaderCards(model, draw);
    text(model.chartTitle, 48, 679, 19, ink, 600);
    const left = 108,
      right = 950,
      top = 758,
      bottom = 1100;
    const x = (time) =>
      left + ((time - model.xmin) / (model.xmax - model.xmin)) * (right - left);
    const y = (value) =>
      bottom -
      ((value - model.ymin) / (model.ymax - model.ymin)) * (bottom - top);
    model.series.forEach((series, i) =>
      text(
        "● " + series.name,
        48 + (i % 3) * 300,
        710 + Math.floor(i / 3) * 20,
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
      c.lineWidth = 1.2;
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
        c.lineWidth = 1.2;
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
    text(model.firstLabel, left, 1127, 10, muted);
    if (model.lastLabel !== model.firstLabel)
      text(model.lastLabel, right, 1127, 12, muted, 400, "right");
    text(model.rangeNote, 48, 1162, 10, lime);
    text(model.note, 48, 1190, 10, muted);
    return canvas;
  }
  function hourly(model) {
    const height = 290 + model.rows.length * 112;
    const { canvas, text, rect, line } = surface(model, height);
    const teams = model.rows[0]?.values || [],
      col = 118;
    text("시간 / 관측 최다", 48, 190, 12, muted);
    teams.forEach((t, i) =>
      text(t.name, 260 + i * col, 190, 11, t.color, 500, "left", 110),
    );
    model.rows.forEach((row, i) => {
      const y = 224 + i * 112,
        valid = row.values.filter((v) => v.delta != null),
        same = new Set(valid.map((v) => v.from + ":" + v.to)).size === 1,
        max = Math.max(0, ...valid.map((v) => v.delta)),
        winners = same && max > 0 ? valid.filter((v) => v.delta === max) : [];
      rect(48, y - 10, 904, 96);
      text(row.label, 64, y + 12, 14, ink, 600, "left", 190);
      text(
        winners.length
          ? winners.map((v) => v.name).join(" / ")
          : "구간 다름 / 기록 대기",
        64,
        y + 38,
        10,
        lime,
        500,
        "left",
        190,
      );
      text(row.status, 64, y + 62, 11, muted);
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
        if (v.coverage) text(v.coverage, x, y + 64, 9, muted, 400, "left", 108);
      });
    });
    return canvas;
  }
  const painters = { leaders, trend, hourly };
  root.MMAImages = {
    render(model) {
      const painter = painters[model.type];
      if (!painter) throw new Error("Unknown image panel.");
      return painter(model);
    },
  };
})(globalThis);
