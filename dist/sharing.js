/* Share exactly the six requested panels as local, immutable PNG snapshots. */
(() => {
  "use strict";
  const panels = [
    ["leaders", "#leaders", "상위 6팀 득표 현황"],
    ["trend", ".chart-panel", "시간에 따른 변화"],
    ["candles", "#candle-panel", "표차 캔들차트"],
    ["forecast", ".gap-future", "12시간 표차 예측"],
    ["daily", ".daily-panel", "하루 누적 득표 증가량"],
    ["hourly", ".hourly-panel", "시간대별 득표 증가량"],
  ];
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const exclude =
    ".panel-share-controls,.panel-image-button,.cd-nav,.gf-method,.daily-history,#daily-note,.trend-help,#tooltip,#cd-tip,#gf-hover";
  let sequence = 0,
    current = null,
    busy = false;
  const dialog = document.createElement("dialog");
  dialog.className = "share-dialog";
  dialog.innerHTML =
    '<h2>HTML 공유하기</h2><p>차트·선택 날짜·색상을 복사 순간의 정적 이미지로 담습니다. 게시글 안에서는 차트를 조작하거나 자동 갱신할 수 없습니다.</p><div class="share-preview" aria-label="공유 이미지 미리보기"></div><p class="share-status" role="status"></p><p>내장 PNG를 지원하는 곳은 HTML을 그대로 붙여넣을 수 있습니다. 디시 등 게시판이 내장 이미지를 제거하면 아래에서 PNG를 저장해 사진으로 첨부하세요. 첨부한 이미지의 공개 URL을 알면 아래에 넣어 이미지 주소 방식의 HTML도 복사할 수 있습니다.</p><label>첨부 이미지의 공개 HTTPS 주소 (선택)<input class="share-image-url" type="url" placeholder="https://…" /></label><textarea aria-label="공유 HTML 소스" readonly></textarea><div class="share-actions"><button class="quiet-button" data-copy-share disabled>HTML 복사</button><button class="quiet-button" data-download-share disabled>PNG 저장</button><button class="quiet-button" data-file-share disabled>HTML 파일 저장</button><button class="quiet-button" data-close-share>닫기</button></div>';
  document.body.append(dialog);
  const $ = (s) => dialog.querySelector(s);
  const status = (s) => ($(".share-status").textContent = s);
  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function imageURL() {
    const value = $(".share-image-url").value.trim();
    if (!value) return current.png;
    const url = new URL(value);
    if (url.protocol !== "https:")
      throw new Error("첨부 이미지 주소는 HTTPS 공개 주소여야 합니다.");
    return url.href;
  }
  function markup() {
    return `<div style="max-width:100%;margin:0 auto;overflow-x:auto;"><img src="${esc(imageURL())}" alt="${esc(current.title + " · " + current.stamp)}" width="${current.width}" style="display:block;max-width:100%;height:auto;border:0;" /><p style="font-size:12px;color:#777;">${esc(current.stamp)} · 복사 시점의 기록 · <a href="${esc(current.link)}">원본 트래커와 조작 가능한 차트</a></p></div>`;
  }
  function updateHTML() {
    if (!current) return;
    try {
      $("textarea").value = markup();
      $("[data-copy-share]").disabled = false;
      $("[data-file-share]").disabled = false;
    } catch (e) {
      $("textarea").value = "";
      $("[data-copy-share]").disabled = true;
      $("[data-file-share]").disabled = true;
      status(e.message);
    }
  }
  $(".share-image-url").addEventListener("input", updateHTML);
  $("[data-close-share]").onclick = () => dialog.close();
  $("[data-copy-share]").onclick = async () => {
    try {
      await navigator.clipboard.writeText(markup());
      status(
        "HTML을 복사했습니다. 내장 이미지를 차단하는 게시판에서는 PNG를 첨부해 주세요.",
      );
    } catch {
      $("textarea").focus();
      $("textarea").select();
      status("소스를 선택했습니다. Ctrl+C 또는 길게 눌러 복사하세요.");
    }
  };
  $("[data-download-share]").onclick = async () => {
    const response = await fetch(current.png);
    download(await response.blob(), current.name + ".png");
  };
  $("[data-file-share]").onclick = () =>
    download(
      new Blob(
        [
          '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
            esc(current.title) +
            '</title><body style="margin:0;background:#100e19;">' +
            markup() +
            "</body></html>",
        ],
        { type: "text/html;charset=utf-8" },
      ),
      current.name + ".html",
    );

  // Inline computed styles before removing context, including SVG chart styles.
  // This freezes the actual plotted paths, zoom window and selected controls.
  function freeze(source) {
    const clone = source.cloneNode(false);
    if (source.nodeType !== Node.ELEMENT_NODE) return clone;
    const style = getComputedStyle(source);
    for (const name of style)
      clone.style.setProperty(name, style.getPropertyValue(name));
    clone.style.animation = "none";
    clone.style.transition = "none";
    if (source instanceof HTMLSelectElement) {
      for (const child of source.childNodes) clone.append(freeze(child));
      [...clone.options].forEach((o, i) => {
        o.selected = i === source.selectedIndex;
        if (o.selected) o.setAttribute("selected", "");
        else o.removeAttribute("selected");
      });
      return clone;
    }
    if (source instanceof HTMLInputElement) {
      clone.setAttribute("value", source.value);
      if (source.checked) clone.setAttribute("checked", "");
    }
    for (const child of source.childNodes) {
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        (child.matches(exclude) || child.hidden)
      )
        continue;
      clone.append(freeze(child));
    }
    return clone;
  }
  function stagePanel(key, panel) {
    const stage = document.createElement("div"),
      width = Math.ceil(panel.getBoundingClientRect().width);
    stage.style.cssText = `position:fixed;left:-30000px;top:0;width:${width + 40}px;padding:20px;background:${key === "leaders" ? "#100e19" : "#191725"};color:#f5f0f6;box-sizing:border-box;pointer-events:none;z-index:-100;`;
    stage.dataset.snapshotStage = key;
    const append = (node) => {
      const c = freeze(node);
      c.style.margin = "0";
      c.style.maxWidth = "100%";
      stage.append(c);
      return c;
    };
    if (key === "leaders") {
      // Show all six in the capture without changing the user's collapsed page.
      const grid = append(panel);
      grid.style.gridAutoRows = "auto";
      grid.style.gridTemplateRows = "none";
      grid.style.height = "auto";
      for (const node of panel.querySelectorAll(".leader[hidden]")) {
        const c = freeze(node);
        c.removeAttribute("hidden");
        c.style.removeProperty("display");
        // Hidden cards still have their actual stylesheet layout in the DOM.
        c.style.display = getComputedStyle(
          panel.querySelector(".leader:not([hidden])"),
        ).display;
        grid.append(c);
      }
    } else if (key === "candles") {
      for (const selector of [".cd-controls", ".cd-wrap"])
        append(panel.querySelector(selector));
    } else if (key === "daily") {
      for (const selector of [
        ".daily-heading",
        "#daily-summary",
        "#daily-teams",
      ])
        append(panel.querySelector(selector));
    } else append(panel);
    // Avoid duplicate SVG clipping IDs, and keep references local to this capture.
    const ids = new Map();
    stage.querySelectorAll("[id]").forEach((n) => {
      const old = n.id;
      n.id = `capture-${sequence}-${old}`;
      ids.set(old, n.id);
    });
    for (const node of stage.querySelectorAll("*"))
      for (const attr of [...node.attributes]) {
        if (attr.name.startsWith("on")) node.removeAttribute(attr.name);
        else if (attr.value.includes("url(")) {
          let value = attr.value;
          for (const [old, id] of ids)
            value = value.replace(
              new RegExp("url\\([^)]*#" + old + "[\"\\']?\\)", "g"),
              `url(#${id})`,
            );
          node.setAttribute(attr.name, value);
        }
      }
    document.body.append(stage);
    return stage;
  }
  async function capture(key, panel) {
    if (key === "hourly") {
      const model = window.MMAShareModels.hourly();
      await document.fonts.ready;
      const canvas = window.MMAImages.render(model);
      const png = canvas.toDataURL("image/png");
      canvas.width = 1;
      canvas.height = 1;
      return { png, width: 1000 };
    }
    const stage = stagePanel(key, panel);
    try {
      await document.fonts.ready;
      const width = stage.offsetWidth,
        height = stage.scrollHeight;
      const png = await htmlToImage.toPng(stage, {
        width,
        height,
        pixelRatio: Math.min(
          2,
          4096 / height,
          Math.sqrt(8000000 / (width * height)),
        ),
        preferredFontFormat: "woff2",
        style: {
          position: "static",
          left: "auto",
          top: "auto",
          zIndex: "auto",
        },
      });
      return { png, width };
    } finally {
      stage.remove();
    }
  }
  for (const [key, selector, title] of panels) {
    const panel = document.querySelector(selector);
    if (!panel) continue;
    if (!panel.id) panel.id = "share-" + key;
    const controls = document.createElement("div");
    controls.className = "panel-share-controls";
    const button = document.createElement("button");
    button.className = "quiet-button";
    button.type = "button";
    button.textContent = "HTML 공유하기";
    button.dataset.sharePanel = key;
    button.setAttribute("aria-label", title + " HTML 공유하기");
    controls.append(button);
    if (key === "leaders") panel.after(controls);
    else if (key === "candles") panel.querySelector(".cd-wrap").after(controls);
    else panel.append(controls);
    button.onclick = async () => {
      if (busy) return;
      busy = true;
      sequence++;
      current = null;
      $("textarea").value = "";
      $(".share-image-url").value = "";
      $(".share-preview").replaceChildren();
      for (const b of dialog.querySelectorAll(
        ".share-actions button:not([data-close-share])",
      ))
        b.disabled = true;
      status("선택한 패널과 차트를 이미지로 준비하고 있습니다…");
      dialog.showModal();
      const stamp =
        new Intl.DateTimeFormat("sv-SE", {
          timeZone: "Asia/Seoul",
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(window.MMA_DATA.snapshots.at(-1).sourceAt)) + " KST";
      const link = new URL("#" + panel.id, location.href).href;
      try {
        const result = await capture(key, panel);
        current = {
          ...result,
          title,
          stamp,
          link,
          name: `${TrackerConfig.id}-${key}-${Date.now()}`,
        };
        const img = document.createElement("img");
        img.src = result.png;
        img.alt = title;
        img.style.cssText = "display:block;max-width:100%;height:auto;";
        $(".share-preview").append(img);
        updateHTML();
        $("[data-download-share]").disabled = false;
        $("[data-file-share]").disabled = false;
        status(
          "복사 시점의 차트와 디자인을 담았습니다. HTML 복사 또는 PNG 저장을 선택하세요.",
        );
      } catch (e) {
        status("이미지를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
        console.error("Panel snapshot failed", e);
      } finally {
        busy = false;
      }
    };
  }
})();
