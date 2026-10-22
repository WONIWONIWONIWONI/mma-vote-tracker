/* 표차 캔들차트 — dist/candles.js
 * 리센느를 기준으로 TOP6 다섯 팀과의 표차를 캔들(5분봉·1시간봉·4시간봉·일봉)로 보여줍니다.
 * app.js가 검증한 동일한 기록을 받아 모든 패널의 관측 시각을 맞춥니다. */
(function () {
  "use strict";

  /* ===== 설정 (색·주소는 여기서만 바꾸면 돼요) ===== */
  var UP_COLOR = "#ff4757"; // 부호 표차 상승 (빨강)
  var DOWN_COLOR = "#4fc8e0"; // 부호 표차 하락 (파랑)
  var FLAT_COLOR = "#a58e9c"; // 변화 없음
  var FRAMES = {
    5: { min: 5, label: "5분봉", show: 144 },
    60: { min: 60, label: "1시간봉", show: 96 },
    240: { min: 240, label: "4시간봉", show: 56 },
    1440: { min: 1440, label: "일봉", show: 30 },
  };
  var FONT =
    "DM Sans,Noto Sans KR,Apple SD Gothic Neo,Malgun Gothic,sans-serif";

  var state = {
    touch: false,
    tf: "5",
    paceMin: 60,
    offset: 0,
    zoom: { 5: 144, 60: 96, 240: 56, 1440: 30 },
    map: {},
    points: [],
    candles: [],
    view: null,
    hover: -1,
  };
  var root,
    el = {},
    snapshots = {};

  /* ===== 작은 도구들 ===== */
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function kst(t) {
    var d = new Date(t + 9 * 3600000);
    return {
      Y: d.getUTCFullYear(),
      M: d.getUTCMonth() + 1,
      D: d.getUTCDate(),
      h: d.getUTCHours(),
      m: d.getUTCMinutes(),
    };
  }
  function hm(t) {
    var k = kst(t);
    return pad(k.h) + ":" + pad(k.m);
  }
  function md(t) {
    var k = kst(t);
    return pad(k.M) + "/" + pad(k.D);
  }
  function num(v) {
    return Math.round(v).toLocaleString("ko-KR");
  }
  function signed(v) {
    return (
      (v > 0 ? "+" : v < 0 ? "−" : "±") +
      Math.abs(Math.round(v)).toLocaleString("ko-KR")
    );
  }
  function f1(n) {
    return Math.round(n * 10) / 10;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function isFocusTeam(team) {
    return String(team.id) === TrackerConfig.forecast.pair[0];
  }
  function latestSnapshot() {
    var rows = Object.values(snapshots);
    if (!rows.length)
      rows = (window.MMA_SEED && window.MMA_SEED.snapshots) || [];
    return (
      rows
        .slice()
        .sort(function (a, b) {
          return Date.parse(a.sourceAt) - Date.parse(b.sourceAt);
        })
        .pop() || null
    );
  }
  function syncGapOptions() {
    var select = document.getElementById("gap-pair");
    if (!select) return false;
    var last = latestSnapshot();
    var ranked =
      last && last.top4
        ? last.top4.slice().sort(function (a, b) {
            return a.rank - b.rank;
          })
        : [];
    var rescene = ranked.find(isFocusTeam);
    var rivals = rescene
      ? ranked.filter(function (team) {
          return !isFocusTeam(team);
        })
      : [];
    var previous = select.value;
    var next = rivals.some(function (team) {
      return String(team.id) === previous;
    })
      ? previous
      : String((rivals[0] && rivals[0].id) || "");
    var signature = rivals
      .map(function (team) {
        return String(team.id) + ":" + team.name + ":" + team.rank;
      })
      .join("|");
    if (select.dataset.pairOptions !== signature) {
      select.innerHTML =
        rivals
          .map(function (team, i) {
            return (
              '<option value="' +
              esc(String(team.id)) +
              '">' +
              (team.rank || i + 1) +
              "위 · 리센느 − " +
              esc(team.name) +
              "</option>"
            );
          })
          .join("") || '<option value="">상대 팀 기록 대기</option>';
      select.dataset.pairOptions = signature;
    }
    if (next) select.value = next;
    select.disabled = !rivals.length;
    return previous !== next;
  }
  /* 표차는 항상 리센느 득표수 − 선택한 상대 팀 득표수입니다. */
  function toPoint(s) {
    if (!s || !Array.isArray(s.top4) || s.top4.length < 2) return null;
    var t = Date.parse(s.sourceAt);
    if (!isFinite(t)) return null;
    var tp = s.top4.slice().sort(function (x, y) {
      return x.rank - y.rank;
    });
    var rescene = tp.find(isFocusTeam);
    var opponentId = document.getElementById("gap-pair")?.value;
    var opponent = tp.find(function (team) {
      return String(team.id) === opponentId;
    });
    if (!rescene || !opponent) return null;
    return {
      t: t,
      a: rescene.votes,
      b: opponent.votes,
      an: rescene.name,
      bn: opponent.name,
    };
  }

  /* ===== 점들 → 캔들 (시가=직전 관측 표차, 종가=구간 마지막, 고가·저가=구간 최대·최소) ===== */
  function buildCandles(points, minutes) {
    var size = minutes * 60000,
      out = [],
      prev = null,
      cur = null;
    points.forEach(function (p) {
      var g = p.a - p.b,
        start = Math.floor((p.t + 9 * 3600000) / size) * size - 9 * 3600000;
      if (!cur || cur.t !== start) {
        var gapMin = prev ? Math.round((p.t - prev.lastT) / 60000) : 0;
        cur = {
          t: start,
          o: prev ? prev.c : g,
          h: 0,
          l: 0,
          c: g,
          n: 0,
          lastT: p.t,
          gapMin: gapMin,
          gapped: gapMin > 5,
          lead: p.an,
          second: p.bn,
          a: p.a,
          b: p.b,
        };
        cur.h = cur.o;
        cur.l = cur.o;
        out.push(cur);
      }
      if (g > cur.h) cur.h = g;
      if (g < cur.l) cur.l = g;
      cur.c = g;
      cur.n++;
      cur.lastT = p.t;
      cur.lead = p.an;
      cur.second = p.bn;
      cur.a = p.a;
      cur.b = p.b;
      prev = cur;
    });
    return out;
  }

  /* ===== 눈금 ===== */
  function niceTicks(lo, hi, count) {
    var raw = (hi - lo) / count;
    if (!(raw > 0)) raw = 1;
    var pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)),
      f = raw / pow;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
    step = Math.max(1, Math.round(step));
    var ticks = [];
    for (var t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step)
      ticks.push(Math.round(t));
    return ticks;
  }

  /* ===== 화면에 보일 범위 계산 ===== */
  function margins(W) {
    return { l: W < 520 ? 44 : 62, r: 8, t: 14, b: 40 };
  }
  function zoomLimits(W) {
    var max = Math.max(1, state.candles.length);
    var min = Math.min(max, W < 520 ? 8 : 12);
    return { min: min, max: max };
  }
  function computeView(W) {
    var m = margins(W),
      plotW = W - m.l - m.r,
      lim = zoomLimits(W);
    var wanted = state.zoom[state.tf] || FRAMES[state.tf].show;
    wanted = Math.max(lim.min, Math.min(lim.max, wanted));
    var n = Math.min(wanted, state.candles.length || wanted);
    var all = state.candles,
      maxOff = Math.max(0, all.length - n);
    if (state.offset > maxOff) state.offset = maxOff;
    if (state.offset < 0) state.offset = 0;
    var end = all.length - state.offset,
      start = Math.max(0, end - n);
    return {
      m: m,
      plotW: plotW,
      n: n,
      start: start,
      end: end,
      vis: all.slice(start, end),
      maxOff: maxOff,
    };
  }
  function setZoom(nextN, anchorRatio, reference) {
    if (!state.view || !state.candles.length) return;
    var W =
      state.view.W || Math.max(300, Math.floor(el.wrap.clientWidth) || 600);
    var lim = zoomLimits(W),
      base = reference || state.view,
      oldN = base.n || base.vis.length || 1;
    nextN = Math.round(Math.max(lim.min, Math.min(lim.max, nextN)));
    anchorRatio = Math.max(
      0,
      Math.min(1, anchorRatio == null ? 0.5 : anchorRatio),
    );
    var anchorIndex = base.start + anchorRatio * oldN;
    var newStart = Math.round(anchorIndex - anchorRatio * nextN);
    newStart = Math.max(
      0,
      Math.min(Math.max(0, state.candles.length - nextN), newStart),
    );
    state.zoom[state.tf] = nextN;
    state.offset = Math.max(0, state.candles.length - (newStart + nextN));
    state.hover = -1;
    el.tip.hidden = true;
    render();
  }
  function plotRatio(clientX) {
    var r = el.svg.getBoundingClientRect(),
      v = state.view;
    return Math.max(
      0,
      Math.min(
        1,
        (((clientX - r.left) * v.W) / r.width - v.firstX) /
          Math.max(1, v.plotW - 2 * v.edgePad),
      ),
    );
  }
  function panCandles(delta) {
    if (!state.view || !delta) return;
    var old = state.offset;
    state.offset = Math.max(
      0,
      Math.min(state.view.maxOff, state.offset + delta),
    );
    if (state.offset !== old) {
      state.hover = -1;
      el.tip.hidden = true;
      render();
    }
  }

  /* ===== 현재 득표 페이스 ===== */
  function regressionSlope(rows, key) {
    if (!rows || rows.length < 3) return NaN;
    var t0 = rows[0].t,
      sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0,
      n = rows.length;
    rows.forEach(function (p) {
      var x = (p.t - t0) / 60000,
        y = key === "gap" ? p.a - p.b : p[key];
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
    });
    var den = n * sxx - sx * sx;
    return den ? (n * sxy - sx * sy) / den : NaN;
  }
  function paceData(minutes) {
    var pts = state.points;
    if (pts.length < 2) return null;
    var last = pts[pts.length - 1],
      cutoff = last.t - minutes * 60000;
    var rows = pts.filter(function (p) {
      return p.t >= cutoff;
    });
    if (rows.length < 2) return null;
    var first = rows[0],
      elapsed = (last.t - first.t) / 60000;
    if (!(elapsed > 0)) return null;
    var aRate = (last.a - first.a) / elapsed,
      bRate = (last.b - first.b) / elapsed;
    var gap0 = first.a - first.b,
      gap = last.a - last.b,
      gapChange = gap - gap0;
    var gapRate = gapChange / elapsed;
    var model = MMAAnalytics.fit(
      rows.map(function (p) {
        return { t: p.t, v: p.a - p.b };
      }),
      minutes,
    );
    var corrected = rows.some(function (p, i) {
      return i && (p.a < rows[i - 1].a || p.b < rows[i - 1].b);
    });
    if (corrected) model = null;
    var trend = model ? model.slope : NaN,
      crossing = MMAAnalytics.crossing(gap, model);
    return {
      last: last,
      first: first,
      rows: rows,
      elapsed: elapsed,
      aRate: aRate,
      bRate: bRate,
      gap: gap,
      gapChange: gapChange,
      gapRate: gapRate,
      trend: trend,
      eta: crossing.minutes,
      model: model,
      crossing: crossing,
      distance: MMAAnalytics.distanceChange(gap0, gap),
    };
  }
  function paceLabels(d) {
    var c = d.crossing,
      label =
        c.kind === "tied"
          ? "현재 동률"
          : c.kind === "uncertain"
            ? "자료 부족·추세 불안정"
            : c.kind === "flat"
              ? "격차 보합"
              : c.kind === "away"
                ? "현재 추세상 역전 없음"
                : c.kind === "distant"
                  ? "먼 미래 · 추정 보류"
                  : etaText(c.minutes) +
                    " 후 " +
                    (c.kind === "overtake"
                      ? "리센느 역전 예상"
                      : "상대 팀 역전 예상");
    var trendLabel = !isFinite(d.trend)
      ? "회귀 보류"
      : Math.abs(d.trend) < 0.01
        ? "격차 보합"
        : d.gap === 0
          ? "동률 이후 분기"
          : d.gap * d.trend < 0
            ? "격차 축소 추세"
            : "격차 확대 추세";
    return { eta: label, trendLabel: trendLabel };
  }
  function distanceLabel(before, after) {
    var d = MMAAnalytics.distanceChange(before, after);
    return d.kind === "crossed"
      ? after > 0
        ? "리센느가 역전"
        : "상대 팀이 역전"
      : d.kind === "closing"
        ? "격차 축소"
        : d.kind === "widening"
          ? "격차 확대"
          : "격차 보합";
  }
  function gapColor(before, after) {
    return after > before ? UP_COLOR : after < before ? DOWN_COLOR : FLAT_COLOR;
  }

  function rateText(v) {
    if (!isFinite(v)) return "—";
    var sign = v > 0 ? "+" : v < 0 ? "−" : "±";
    return sign + Math.abs(v).toFixed(1) + "표/분";
  }
  function etaText(m) {
    if (!isFinite(m) || m <= 0) return "현재 추세상 역전 없음";
    if (m > 7 * 24 * 60) return "7일 이상";
    var h = Math.floor(m / 60),
      mm = Math.round(m % 60);
    if (h >= 24) {
      var d = Math.floor(h / 24);
      h %= 24;
      return "약 " + d + "일 " + h + "시간";
    }
    if (h) return "약 " + h + "시간 " + mm + "분";
    return "약 " + Math.max(1, mm) + "분";
  }
  function renderPace() {
    if (!el.pace) return;
    var d = paceData(state.paceMin),
      btns = el.paceTf.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var on = Number(btns[i].getAttribute("data-min")) === state.paceMin;
      btns[i].className = on ? "selected" : "";
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (!d) {
      el.paceBody.innerHTML =
        '<div class="pc-empty">계산할 기록이 아직 부족해요.</div>';
      return;
    }
    var labels = paceLabels(d),
      trendLabel = labels.trendLabel,
      eta = labels.eta;
    el.paceBody.innerHTML =
      '<div class="pc-team"><span>' +
      esc(d.last.an) +
      "</span><strong>" +
      rateText(d.aRate) +
      "</strong><small>최근 " +
      Math.round(d.elapsed) +
      "분 평균</small></div>" +
      '<div class="pc-team"><span>' +
      esc(d.last.bn) +
      "</span><strong>" +
      rateText(d.bRate) +
      "</strong><small>최근 " +
      Math.round(d.elapsed) +
      "분 평균</small></div>" +
      '<div class="pc-metric"><span>' +
      distanceLabel(d.first.a - d.first.b, d.gap) +
      ' · 부호 표차 변화</span><strong class="' +
      (d.gapChange < 0 ? "down" : d.gapChange > 0 ? "up" : "") +
      '">' +
      signed(d.gapChange) +
      "표</strong><small>" +
      rateText(d.gapRate) +
      "</small></div>" +
      '<div class="pc-metric pc-eta"><span>현재 추세가 지속된다면</span><strong>' +
      eta +
      "</strong><small>" +
      trendLabel +
      " · 회귀 " +
      rateText(d.trend) +
      "</small></div>";
  }

  /* ===== 그래프 그리기 (SVG 조각 문자열) ===== */
  function chartInner(W, H, v, hover) {
    var m = v.m,
      ph = H - m.t - m.b,
      vis = v.vis,
      s = [];
    var edgePad = Math.min(7, v.plotW / 2),
      firstX = m.l + (vis.length > 1 ? edgePad : v.plotW / 2);
    var slot =
      vis.length > 1 ? (v.plotW - 2 * edgePad) / (vis.length - 1) : v.plotW;
    v.firstX = firstX;
    v.edgePad = edgePad;
    var lo = Infinity,
      hi = -Infinity;
    vis.forEach(function (c) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    });
    if (!vis.length) {
      lo = 0;
      hi = 10;
    }
    var padv = Math.max((hi - lo) * 0.1, 5);
    lo -= padv;
    hi += padv;
    function Y(val) {
      return m.t + ((hi - val) / (hi - lo)) * ph;
    }

    niceTicks(lo, hi, H < 300 ? 4 : 5).forEach(function (t) {
      var y = f1(Y(t));
      s.push(
        '<line x1="' +
          m.l +
          '" x2="' +
          (W - m.r) +
          '" y1="' +
          y +
          '" y2="' +
          y +
          '" stroke="#3b374d" stroke-dasharray="2 4" stroke-width="1"/>',
      );
      s.push(
        '<text x="' +
          (m.l - 8) +
          '" y="' +
          (y + 4) +
          '" text-anchor="end" font-size="10" fill="#aaa3b8" font-family=\'' +
          FONT +
          "'>" +
          num(t) +
          "</text>",
      );
    });

    var size = FRAMES[state.tf].min * 60000;
    var steps =
        state.tf === "5"
          ? [3, 6, 12, 24]
          : state.tf === "60"
            ? [1, 2, 3, 4, 6, 12]
            : [1, 2, 3, 4],
      want = Math.ceil(42 / slot),
      k = steps[steps.length - 1];
    for (var q = 0; q < steps.length; q++) {
      if (steps[q] >= want) {
        k = steps[q];
        break;
      }
    }
    var lastDay = -1;
    vis.forEach(function (c, i) {
      var cx = firstX + slot * i;
      if (i === hover && !state.touch)
        s.push(
          '<rect x="' +
            f1(cx - slot / 2) +
            '" y="' +
            m.t +
            '" width="' +
            f1(slot) +
            '" height="' +
            ph +
            '" fill="#ffffff0f"/>',
        );
      if (Math.round(c.t / size) % k === 0) {
        var day = kst(c.t).D;
        s.push(
          '<text x="' +
            f1(cx) +
            '" y="' +
            (H - m.b + 16) +
            '" text-anchor="middle" font-size="10" fill="#aaa3b8" font-family=\'' +
            FONT +
            "'>" +
            hm(c.t) +
            "</text>",
        );
        if (day !== lastDay) {
          s.push(
            '<text x="' +
              f1(cx) +
              '" y="' +
              (H - m.b + 30) +
              '" text-anchor="middle" font-size="9" fill="#79816f" font-family=\'' +
              FONT +
              "'>" +
              md(c.t) +
              "</text>",
          );
          lastDay = day;
        }
      }
    });

    vis.forEach(function (c, i) {
      var cx = firstX + slot * i;
      var bw = Math.min(10, Math.max(0.6, slot * 0.38));
      var col = gapColor(c.o, c.c),
        op = c.gapped ? 0.5 : 1;
      var yo = Y(c.o),
        yc = Y(c.c);
      s.push(
        '<line x1="' +
          f1(cx) +
          '" x2="' +
          f1(cx) +
          '" y1="' +
          f1(Y(c.h)) +
          '" y2="' +
          f1(Y(c.l)) +
          '" stroke="' +
          col +
          '" stroke-width="' +
          (slot < 7 ? 0.65 : slot < 12 ? 0.85 : 1) +
          '" opacity="' +
          op +
          '"/>',
      );
      s.push(
        '<rect x="' +
          f1(cx - bw / 2) +
          '" y="' +
          f1(Math.min(yo, yc)) +
          '" width="' +
          f1(bw) +
          '" height="' +
          f1(Math.max(1.5, Math.abs(yo - yc))) +
          '" fill="' +
          col +
          '" opacity="' +
          op +
          '"/>',
      );
    });

    if (vis.length && v.end === state.candles.length) {
      var lc = vis[vis.length - 1],
        ly = f1(Y(lc.c));
      s.push(
        '<line x1="' +
          m.l +
          '" x2="' +
          (W - m.r) +
          '" y1="' +
          ly +
          '" y2="' +
          ly +
          '" stroke="#ff7594" stroke-opacity="0.5" stroke-dasharray="3 4"/>',
      );
      s.push(
        '<text x="' +
          (m.l + 4) +
          '" y="' +
          (ly - 5) +
          '" text-anchor="start" font-size="10" fill="#ff7594" font-family=\'' +
          FONT +
          "'>현재 " +
          num(lc.c) +
          "</text>",
      );
    }
    v.slot = slot;
    return s.join("");
  }

  /* ===== 화면 그리기 ===== */
  function render() {
    if (!el.svg) return;
    var W = Math.max(300, Math.floor(el.wrap.clientWidth) || 600),
      H = W < 520 ? 290 : 340;
    var v = computeView(W);
    state.view = v;
    v.W = W;
    v.H = H;
    el.svg.dataset.start = v.start;
    el.svg.dataset.count = v.n;
    el.svg.dataset.total = state.candles.length;
    el.svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    el.svg.setAttribute("width", W);
    el.svg.setAttribute("height", H);
    el.svg.innerHTML = chartInner(W, H, v, state.hover);

    var vis = v.vis;
    if (vis.length) {
      var a = vis[0],
        b = vis[vis.length - 1],
        size = FRAMES[state.tf].min * 60000;
      el.range.textContent =
        md(a.t) +
        " " +
        hm(a.t) +
        " ~ " +
        md(b.t) +
        " " +
        hm(state.tf === "5" ? b.t : b.t + size) +
        " · " +
        vis.length +
        "봉 / 전체 " +
        state.candles.length +
        "봉";
    } else {
      el.range.textContent = "기록 없음";
    }
    el.prev.disabled = state.offset >= v.maxOff;
    el.next.disabled = state.offset <= 0;
    el.latest.disabled = state.offset <= 0;
    var limits = zoomLimits(W);
    root.querySelector("#cd-zoom-in").disabled = v.n <= limits.min;
    root.querySelector("#cd-zoom-out").disabled = v.n >= limits.max;
    var btns = el.tf.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-tf") === state.tf;
      btns[i].className = on ? "selected" : "";
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    el.unit.textContent =
      "리센느 − 선택 팀 표차 (표) · " + FRAMES[state.tf].label;
    renderPace();
  }

  function showTip(i, clientX) {
    var v = state.view,
      c = v && v.vis[i];
    if (!c) {
      el.tip.hidden = true;
      return;
    }
    var size = FRAMES[state.tf].min * 60000,
      last = state.candles[state.candles.length - 1] === c;
    var title =
      state.tf === "5"
        ? md(c.t) + " " + hm(c.t) + " 집계"
        : md(c.t) +
          " " +
          hm(c.t) +
          "–" +
          hm(c.t + size) +
          " · " +
          FRAMES[state.tf].label;
    var d = c.c - c.o,
      col = gapColor(c.o, c.c);
    function row(l, val) {
      return "<p><span>" + l + "</span><b>" + val + "</b></p>";
    }
    function row2(l1, v1, l2, v2) {
      return (
        "<p><span>" +
        l1 +
        " <b>" +
        v1 +
        "</b></span><span>" +
        l2 +
        " <b>" +
        v2 +
        "</b></span></p>"
      );
    }
    var narrow = el.wrap.clientWidth < 520;
    var h =
      "<strong>" +
      esc(title) +
      "</strong>" +
      (narrow
        ? row2("시가", num(c.o), "종가", num(c.c)) +
          row2("고가", num(c.h), "저가", num(c.l))
        : row("시가", num(c.o)) +
          row("고가", num(c.h)) +
          row("저가", num(c.l)) +
          row("종가", num(c.c))) +
      "<p><span>" +
      distanceLabel(c.o, c.c) +
      ' · 부호 변화</span><b style="color:' +
      col +
      '">' +
      signed(d) +
      "</b></p>" +
      "<p><span>" +
      esc(c.lead) +
      "</span><b>" +
      num(c.a) +
      "</b></p><p><span>" +
      esc(c.second) +
      "</span><b>" +
      num(c.b) +
      "</b></p>" +
      '<div class="cd-dim">관측 ' +
      c.n +
      "회";
    if (c.gapped) h += " · 직전 관측과 " + c.gapMin + "분 간격";
    if (last && state.tf !== "5" && c.t + size - c.lastT > 5 * 60000)
      h += " · 집계 중";
    h += "</div>";
    el.tip.innerHTML = h;
    el.tip.hidden = false;
    var cx =
      (v.firstX + v.slot * i) * (el.svg.getBoundingClientRect().width / v.W);
    var tw = el.tip.offsetWidth,
      W = el.wrap.clientWidth;
    el.tip.style.left = Math.max(0, Math.min(W - tw, cx - tw / 2)) + "px";
    el.tip.style.top = "30px";
  }

  function onPointer(e) {
    var v = state.view;
    state.touch = e.pointerType === "touch";
    if (!v || !v.vis.length) return;
    var r = el.svg.getBoundingClientRect(),
      x = (e.clientX - r.left) * (v.W / r.width);
    var i = Math.round((x - v.firstX) / v.slot);
    if (i < 0 || i >= v.vis.length) {
      hideTip();
      return;
    }
    if (i !== state.hover) {
      state.hover = i;
      render();
    }
    showTip(i, e.clientX);
  }
  function hideTip() {
    el.tip.hidden = true;
    if (state.hover !== -1) {
      state.hover = -1;
      render();
    }
  }

  /* ===== 이미지(PNG) 저장 ===== */
  window.MMACandleShare = function () {
    return (state.view?.vis || []).map(function (c) {
      return { ...c };
    });
  };
  function exportPng() {
    var v0 = state.view;
    if (!v0 || !v0.vis.length) return;
    var pd = paceData(state.paceMin);
    var W = 1000,
      H = 380,
      HDR = 238,
      FTR = 32;
    var v = computeView(W);
    v.vis = v0.vis;
    v.plotW = W - v.m.l - v.m.r;
    v.end = v0.end;
    var last = state.points[state.points.length - 1],
      lc = state.candles[state.candles.length - 1];
    var font = " font-family='" + FONT + "'";
    var a = v.vis[0],
      b = v.vis[v.vis.length - 1];
    var totalH = H + HDR + FTR;
    var paceLabel =
      state.paceMin === 1440
        ? "24시간"
        : state.paceMin === 240
          ? "4시간"
          : "1시간";
    var cards = "";
    if (pd) {
      var labels = paceLabels(pd),
        eta = labels.eta,
        trendLabel = labels.trendLabel;
      var items = [
        [
          pd.last.an,
          rateText(pd.aRate),
          "최근 " + Math.round(pd.elapsed) + "분 평균",
          "#f2f4ee",
        ],
        [
          pd.last.bn,
          rateText(pd.bRate),
          "최근 " + Math.round(pd.elapsed) + "분 평균",
          "#f2f4ee",
        ],
        [
          "표차 변화",
          signed(pd.gapChange) + "표",
          rateText(pd.gapRate),
          gapColor(pd.first.a - pd.first.b, pd.gap),
        ],
        [
          "현재 추세가 지속된다면",
          eta,
          trendLabel + " · 회귀 " + rateText(pd.trend),
          "#f2f4ee",
        ],
      ];
      items.forEach(function (it, i) {
        var x = 28 + i * 238,
          y = 92,
          cw = 226,
          ch = 92;
        cards +=
          '<rect x="' +
          x +
          '" y="' +
          y +
          '" width="' +
          cw +
          '" height="' +
          ch +
          '" rx="7" fill="#151321" stroke="#41374f"/>' +
          '<text x="' +
          (x + 13) +
          '" y="' +
          (y + 22) +
          '" font-size="10" fill="#929a8c"' +
          font +
          ">" +
          esc(it[0]) +
          "</text>" +
          '<text x="' +
          (x + 13) +
          '" y="' +
          (y + 50) +
          '" font-size="15" font-weight="650" fill="' +
          it[3] +
          '"' +
          font +
          ">" +
          esc(it[1]) +
          "</text>" +
          '<text x="' +
          (x + 13) +
          '" y="' +
          (y + 72) +
          '" font-size="9" fill="#7d8478"' +
          font +
          ">" +
          esc(it[2]) +
          "</text>";
      });
    }
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      W +
      '" height="' +
      totalH +
      '" viewBox="0 0 ' +
      W +
      " " +
      totalH +
      '">' +
      '<rect width="100%" height="100%" fill="#100e19"/>' +
      '<text x="28" y="32" font-size="19" font-weight="700" fill="#f2f4ee"' +
      font +
      ">MMA · 리센느 기준 표차 흐름 분석</text>" +
      '<text x="28" y="55" font-size="11" fill="#9aa093"' +
      font +
      ">현재 득표 페이스 · " +
      paceLabel +
      " 기준  |  캔들 " +
      FRAMES[state.tf].label +
      "</text>" +
      '<text x="28" y="75" font-size="10" fill="#7d8478"' +
      font +
      ">최신 표차 " +
      signed(lc.c) +
      "표 · 리센느 " +
      num(last.a) +
      " − " +
      esc(last.bn) +
      " " +
      num(last.b) +
      "</text>" +
      cards +
      '<text x="28" y="207" font-size="10" fill="#9aa093"' +
      font +
      ">표차 캔들 · " +
      md(a.t) +
      " " +
      hm(a.t) +
      " ~ " +
      md(b.t) +
      " " +
      hm(b.t) +
      "</text>" +
      '<g transform="translate(0,' +
      HDR +
      ')">' +
      chartInner(W, H, v, -1) +
      "</g>" +
      '<text x="28" y="' +
      (H + HDR + 21) +
      '" font-size="9" fill="#7d8478"' +
      font +
      '><tspan fill="' +
      UP_COLOR +
      '">■</tspan> 표차 상승  <tspan fill="' +
      DOWN_COLOR +
      '">■</tspan> 표차 하락  · 표차 = 리센느 − 선택한 상대 팀 · 데이터 출처 Melon</text>' +
      "</svg>";
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement("canvas");
      cv.width = W * 2;
      cv.height = totalH * 2;
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(function (blob) {
        if (!blob) return;
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "mma-gap-analysis-" + FRAMES[state.tf].label + ".png";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () {
          URL.revokeObjectURL(link.href);
        }, 2000);
      }, "image/png");
    };
    img.onerror = function () {
      alert("이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  /* ===== 기록 읽기 · 갱신 ===== */
  function addSnaps(list) {
    list.forEach(function (s) {
      var minute = Math.floor(Date.parse(s.sourceAt) / 60000);
      var old = snapshots[minute];
      if (old) delete state.map[Date.parse(old.sourceAt)];
      snapshots[minute] = s;
    });
    var selectionChanged = syncGapOptions();
    if (selectionChanged) {
      state.map = {};
      state.offset = 0;
    }
    var rows = selectionChanged ? Object.values(snapshots) : list;
    var added = 0;
    rows.forEach(function (s) {
      var p = toPoint(s);
      if (!p) return;
      var q = state.map[p.t];
      if (q === undefined || q.a !== p.a || q.b !== p.b) {
        state.map[p.t] = p;
        added++;
      }
    });
    return added;
  }
  function rebuild() {
    var before = state.candles.length;
    state.points = Object.keys(state.map)
      .map(function (k) {
        return state.map[k];
      })
      .sort(function (x, y) {
        return x.t - y.t;
      });
    state.candles = buildCandles(state.points, FRAMES[state.tf].min);
    if (state.offset > 0 && before)
      state.offset += state.candles.length - before;
  }
  /* ===== 화면 뼈대 만들기 ===== */
  function build() {
    root = document.getElementById("candle-panel");
    if (!root) {
      var anchor = document.querySelector(".chart-panel");
      if (!anchor || !anchor.parentNode) return false;
      root = document.createElement("section");
      root.id = "candle-panel";
      root.className = "panel has-image-button cd-panel";
      anchor.parentNode.insertBefore(root, anchor.nextSibling);
    }
    if (root.className.indexOf("cd-panel") < 0) root.className += " cd-panel";
    root.innerHTML =
      '<button type="button" class="quiet-button panel-image-button" id="cd-image" aria-label="표차 캔들차트 PNG 저장" title="표차 캔들차트 PNG 저장"><span aria-hidden="true">↓</span> 이미지</button>' +
      '<div class="panel-heading"><div><div class="section-kicker">GAP ANALYSIS</div><h2 id="cd-title">표차 흐름 분석</h2></div>' +
      '<label class="cd-pair-control" for="gap-pair"><span>상대 팀 (순위순)</span><select id="gap-pair" class="control-select"><option value="">상대 팀 기록 대기</option></select></label></div>' +
      '<div class="pc-summary" id="pc-summary"><div class="pc-summary-head"><span>현재 득표 페이스 · 선택 구간 평균</span><div class="pc-tf" id="pc-tf" role="group" aria-label="분석 기간"><button data-min="60" class="selected" aria-pressed="true">1시간</button><button data-min="240">4시간</button><button data-min="1440">24시간</button></div></div><div class="pc-body" id="pc-body"></div><p class="pc-note">리센느−상대 팀의 부호 표차를 가중 선형회귀합니다. 음수에서 상승하면 리센느의 추격, 양수에서 하락하면 상대 팀의 추격입니다. 6개·15분 미만, 긴 공백·득표 정정·낮은 적합도는 보류하며, 먼 미래(최대 6시간)는 수치로 단정하지 않습니다.</p></div>' +
      '<div class="cd-controls"><div class="pc-summary-head"><span>표차 캔들 · 시간 흐름</span><div class="cd-tf" role="group" aria-label="봉 간격" id="cd-tf"><button data-tf="5" class="selected" aria-pressed="true">5분</button><button data-tf="60">1시간</button><button data-tf="240">4시간</button><button data-tf="1440">일봉</button></div></div><div class="cd-legend"><span><i style="background:' +
      UP_COLOR +
      '"></i>표차 상승</span><span><i style="background:' +
      DOWN_COLOR +
      '"></i>표차 하락</span><span><i style="background:' +
      FLAT_COLOR +
      ';opacity:.5"></i>관측 공백 뒤</span></div></div>' +
      '<div class="cd-wrap" id="cd-wrap"><span class="cd-unit" id="cd-unit"></span><svg id="cd-svg" role="img" aria-label="리센느와 선택한 상대 팀의 표차 캔들차트"></svg><div class="cd-tip" id="cd-tip" role="status" hidden></div></div>' +
      '<div class="cd-nav"><button class="quiet-button" id="cd-prev" type="button">◀ 이전</button><button class="quiet-button" id="cd-next" type="button">다음 ▶</button><button class="quiet-button" id="cd-latest" type="button">최신</button><button class="quiet-button" id="cd-zoom-in" type="button">＋ 확대</button><button class="quiet-button" id="cd-zoom-out" type="button">− 축소</button><button class="quiet-button" id="cd-reset" type="button">전체 보기</button></div>' +
      '<div class="cd-bottom"><p>※ 표차는 리센느 득표수 − 선택한 상대 팀 득표수예요. 상대 팀은 현재 TOP6에서 리센느를 제외한 다섯 팀이며, 선택지는 상대 순위순입니다. 양수는 리센느가 앞서고, 음수는 상대 팀이 앞섭니다. 색상은 표차 방향 기준: 빨강=상승, 파랑=하락입니다. 확대·축소 문구는 절대 격차 기준입니다. 음수에서 0에 가까워지면 격차 축소·빨강, 양수에서 멀어지면 격차 확대·빨강입니다. 4시간봉은 한국 시간 00·04·08·12·16·20시, 일봉은 00시 기준입니다. 캔들 몸통은 직전 관측부터 구간 마지막까지의 변화, 위·아래 선은 구간 중 최고·최저예요. 관측 공백은 채우지 않아요. PC: 마우스 드래그·휠로 좌우 이동, Ctrl+휠로 커서 주변 확대. 버튼으로도 확대·축소·전체 보기 가능. 모바일: 좌우 드래그·두 손가락 핀치로 조절할 수 있어요.</p><span id="cd-range"></span></div>';
    syncGapOptions();
    document.getElementById("gap-pair").addEventListener("change", function () {
      state.map = {};
      addSnaps(Object.values(snapshots));
      state.offset = 0;
      rebuild();
      render();
    });
    el.pace = root.querySelector("#pc-summary");
    el.paceTf = root.querySelector("#pc-tf");
    el.paceBody = root.querySelector("#pc-body");
    el.wrap = root.querySelector("#cd-wrap");
    el.svg = root.querySelector("#cd-svg");
    el.tip = root.querySelector("#cd-tip");
    el.unit = root.querySelector("#cd-unit");
    el.range = root.querySelector("#cd-range");
    el.tf = root.querySelector("#cd-tf");
    el.prev = root.querySelector("#cd-prev");
    el.next = root.querySelector("#cd-next");
    el.latest = root.querySelector("#cd-latest");
    return true;
  }
  function bind() {
    el.paceTf.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-min]");
      if (!b) return;
      state.paceMin = Number(b.getAttribute("data-min")) || 60;
      renderPace();
    });
    el.tf.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-tf]");
      if (!b) return;
      state.tf = b.getAttribute("data-tf");
      state.offset = 0;
      state.hover = -1;
      el.tip.hidden = true;
      rebuild();
      render();
    });
    function page(dir) {
      var n = (state.view && state.view.vis.length) || 20;
      state.offset += dir * Math.max(1, Math.floor(n / 2));
      state.hover = -1;
      el.tip.hidden = true;
      render();
    }
    el.prev.addEventListener("click", function () {
      page(1);
    });
    el.next.addEventListener("click", function () {
      page(-1);
    });
    el.latest.addEventListener("click", function () {
      state.offset = 0;
      render();
    });
    root.querySelector("#cd-zoom-in").addEventListener("click", function () {
      setZoom(state.view.n / 1.5, 0.5);
    });
    root.querySelector("#cd-zoom-out").addEventListener("click", function () {
      setZoom(state.view.n * 1.5, 0.5);
    });
    root.querySelector("#cd-reset").addEventListener("click", function () {
      state.zoom[state.tf] = state.candles.length;
      state.offset = 0;
      hideTip();
      render();
    });

    // Capture on the stable SVG, so replacing its paths cannot cancel the drag.
    var mouseDrag = null;
    el.svg.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "touch" || e.button !== 0 || !state.view) return;
      mouseDrag = {
        id: e.pointerId,
        x: e.clientX,
        offset: state.offset,
        slot:
          (state.view.slot * el.svg.getBoundingClientRect().width) /
          state.view.W,
      };
      el.svg.setPointerCapture(e.pointerId);
      el.svg.style.cursor = "grabbing";
      hideTip();
      e.preventDefault();
    });
    el.svg.addEventListener("pointermove", function (e) {
      if (!mouseDrag || e.pointerId !== mouseDrag.id) return;
      state.offset = Math.max(
        0,
        Math.min(
          state.view.maxOff,
          mouseDrag.offset +
            Math.round((e.clientX - mouseDrag.x) / mouseDrag.slot),
        ),
      );
      state.hover = -1;
      el.tip.hidden = true;
      render();
    });
    function endMouseDrag(e) {
      if (mouseDrag && mouseDrag.id === e.pointerId) {
        mouseDrag = null;
        el.svg.style.cursor = "grab";
      }
    }
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(
      function (name) {
        el.svg.addEventListener(name, endMouseDrag);
      },
    );

    // PC: 휠=시간축 이동, Ctrl+휠=X축 시간 밀도 압축/확장.
    var wheelCarry = 0;
    el.wrap.addEventListener(
      "wheel",
      function (e) {
        if (!state.view || !state.view.vis.length) return;
        var anchor = plotRatio(e.clientX);

        if (e.ctrlKey) {
          e.preventDefault();
          var factor = e.deltaY > 0 ? 1.32 : 0.76;
          setZoom(state.view.n * factor, anchor);
          return;
        }
        if (state.view.maxOff <= 0) return;
        e.preventDefault();
        var raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!raw) return;
        var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1;
        wheelCarry += raw * unit;
        var steps = Math.trunc(wheelCarry / 30);
        if (!steps) return;
        wheelCarry -= steps * 30;
        panCandles(Math.max(-10, Math.min(10, steps)));
      },
      { passive: false },
    );

    // 모바일은 native Touch Events 하나로만 처리합니다.
    // iOS Safari에서 페이지 핀치가 시작되기 전에 cd-wrap 단계에서 preventDefault합니다.
    var tMode = null,
      tStartX = 0,
      tStartY = 0,
      tLastX = 0,
      tLastY = 0,
      tCarry = 0;
    var tPinchDist = 0,
      tPinchN = 0,
      tPinchAnchor = 0.5,
      tPinchView = null;
    function tDist(a, b) {
      var dx = a.clientX - b.clientX,
        dy = a.clientY - b.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    el.wrap.addEventListener(
      "touchstart",
      function (e) {
        state.touch = true;
        if (e.touches.length >= 2) {
          e.preventDefault();
          tMode = "pinch";
          tPinchDist = tDist(e.touches[0], e.touches[1]);
          tPinchN = state.view
            ? state.view.n
            : state.zoom[state.tf] || FRAMES[state.tf].show;
          tPinchView = state.view;
          var mid = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          tPinchAnchor = plotRatio(mid);
          hideTip();
          return;
        }
        if (e.touches.length === 1) {
          var t = e.touches[0];
          tMode = null;
          tStartX = tLastX = t.clientX;
          tStartY = tLastY = t.clientY;
          tCarry = 0;
        }
      },
      { passive: false, capture: true },
    );

    el.wrap.addEventListener(
      "touchmove",
      function (e) {
        if (e.touches.length >= 2) {
          e.preventDefault();
          e.stopPropagation();
          if (tMode !== "pinch") {
            tMode = "pinch";
            tPinchDist = tDist(e.touches[0], e.touches[1]);
            tPinchN = state.view
              ? state.view.n
              : state.zoom[state.tf] || FRAMES[state.tf].show;
            tPinchView = state.view;
            tPinchAnchor = plotRatio(
              (e.touches[0].clientX + e.touches[1].clientX) / 2,
            );
          }
          var d = tDist(e.touches[0], e.touches[1]);
          if (tPinchDist > 0 && tPinchN > 0)
            setZoom(
              tPinchN * (tPinchDist / Math.max(16, d)),
              tPinchAnchor,
              tPinchView,
            );
          return;
        }
        if (e.touches.length !== 1 || !state.view) return;
        var t = e.touches[0],
          totalX = t.clientX - tStartX,
          totalY = t.clientY - tStartY;
        var dx = t.clientX - tLastX,
          dy = t.clientY - tLastY;
        if (!tMode && (Math.abs(totalX) > 7 || Math.abs(totalY) > 7)) {
          tMode = Math.abs(totalX) > Math.abs(totalY) * 1.15 ? "pan" : "scroll";
        }
        if (tMode === "pan") {
          e.preventDefault();
          e.stopPropagation();
          tCarry += dx;
          var px = Math.max(1.2, state.view.slot || 4);
          var move = Math.trunc(tCarry / px);
          if (move) {
            tCarry -= move * px;
            panCandles(move);
          }
        }
        // scroll 모드는 preventDefault하지 않아 브라우저의 자연스러운 세로 스크롤을 그대로 둡니다.
        tLastX = t.clientX;
        tLastY = t.clientY;
      },
      { passive: false, capture: true },
    );

    el.wrap.addEventListener(
      "touchend",
      function (e) {
        if (e.touches.length < 2) {
          tPinchDist = 0;
          tPinchN = 0;
        }
        if (!e.touches.length) {
          tMode = null;
          tCarry = 0;
        } else if (e.touches.length === 1) {
          var t = e.touches[0];
          tMode = null;
          tStartX = tLastX = t.clientX;
          tStartY = tLastY = t.clientY;
          tCarry = 0;
        }
      },
      { passive: false, capture: true },
    );
    el.wrap.addEventListener(
      "touchcancel",
      function () {
        tMode = null;
        tCarry = 0;
        tPinchDist = 0;
        tPinchN = 0;
      },
      { passive: false, capture: true },
    );

    // Safari 전용 gesture 이벤트도 wrapper에서 차단합니다.
    ["gesturestart", "gesturechange", "gestureend"].forEach(function (name) {
      el.wrap.addEventListener(
        name,
        function (e) {
          e.preventDefault();
          e.stopPropagation();
        },
        { passive: false, capture: true },
      );
    });
    el.wrap.addEventListener("selectstart", function (e) {
      e.preventDefault();
    });
    el.wrap.addEventListener("contextmenu", function (e) {
      if (state.touch) e.preventDefault();
    });

    // 마우스 hover/tooltip은 기존 Pointer Events 유지.
    el.svg.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "touch" && !mouseDrag) onPointer(e);
    });
    el.svg.addEventListener("pointerleave", function (e) {
      if (e.pointerType !== "touch") hideTip();
    });
    document.addEventListener("pointerdown", function (e) {
      if (!el.svg.contains(e.target) && !el.tip.hidden) hideTip();
    });
    root.querySelector("#cd-image").addEventListener("click", exportPng);
    var timer;
    window.addEventListener("resize", function () {
      clearTimeout(timer);
      timer = setTimeout(render, 120);
    });
  }

  function start() {
    if (!build()) return;
    bind();
    render();
    function receive(data) {
      snapshots = {};
      state.map = {};
      addSnaps(data.snapshots);
      rebuild();
      render();
    }
    receive(window.MMA_DATA || window.MMA_SEED);
    window.addEventListener("mma:data", function (event) {
      receive(event.detail);
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();
