/* Preserve PNG sharing and offer independent, immutable HTML/CSS snapshots. */
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
    ".panel-share-controls,.panel-image-button,.cd-nav,.gf-method,.gf-accuracy,#gf-content > details,.daily-history,#daily-note,.trend-help,#tooltip,#cd-tip,#gf-hover";
  let sequence = 0,
    current = null,
    busy = false;
  const cache = new Map(), htmlLimit = 65535;
  const dialog = document.createElement("dialog");
  dialog.className = "share-dialog";
  dialog.innerHTML =
    '<h2>이미지·HTML 공유하기</h2><p>선택한 차트와 날짜를 이미지로 담습니다. 이미지 복사 후 게시판 편집기에 붙여넣거나, PNG를 저장해 사진으로 첨부하세요.</p><div class="share-preview" aria-label="공유 이미지 미리보기"></div><p class="share-status" role="status"></p><p>디시는 본문이 65,535자로 제한됩니다. 이미지 전체를 넣는 HTML은 제공하지 않습니다. 이미지 주소 방식의 HTML이 필요하면 먼저 사진을 첨부하고 그 이미지의 공개 HTTPS 주소를 아래에 넣으세요.</p><label>첨부 이미지의 공개 HTTPS 주소<input class="share-image-url" type="url" placeholder="https://…" /></label><textarea class="share-url-source" aria-label="이미지 주소 HTML 소스" readonly placeholder="이미지 주소를 넣으면 짧은 HTML이 만들어집니다."></textarea><div class="share-actions"><button class="quiet-button" data-copy-image disabled>이미지 복사</button><button class="quiet-button" data-download-share disabled>PNG 저장</button><button class="quiet-button" data-copy-share disabled>주소 HTML 복사</button><button class="quiet-button" data-file-share disabled>HTML 파일 저장</button><button class="quiet-button" data-close-share>닫기</button></div>';
  const nativeSection = document.createElement("section");
  nativeSection.innerHTML = '<h3>이미지 없는 HTML 공유</h3><p>화면의 색상·배치·숫자·그래프를 HTML/CSS로 구성합니다. 이미지·외부 업로드 없이 복사할 수 있습니다.</p><button class="quiet-button" data-copy-native disabled>HTML 복사</button><p class="share-native-status" role="status"></p><details><summary>HTML 미리보기와 소스</summary><div class="share-native-preview" style="overflow:auto;max-height:45vh;"></div><textarea class="share-native-source" aria-label="이미지 없는 공유 HTML 소스" readonly></textarea></details><hr>';
  dialog.querySelector(".share-preview").before(nativeSection);
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
    if (!value) throw new Error("이미지 복사 또는 PNG 저장을 이용하세요. HTML 복사에는 첨부 이미지의 공개 HTTPS 주소가 필요합니다.");
    const url = new URL(value);
    if (url.protocol !== "https:")
      throw new Error("첨부 이미지 주소는 HTTPS 공개 주소여야 합니다.");
    return url.href;
  }
  function markup(src = imageURL()) {
    return `<div style="max-width:100%;margin:0 auto;overflow-x:auto;"><img src="${esc(src)}" alt="${esc(current.title + " · " + current.stamp)}" width="${current.width}" style="display:block;max-width:100%;height:auto;border:0;" /><p style="font-size:12px;color:#777;">${esc(current.stamp)} · 복사 시점의 기록 · <a href="${esc(current.link)}">원본 트래커와 조작 가능한 차트</a></p></div>`;
  }
  function updateHTML() {
    if (!current) return;
    try {
      const html = markup();
      if (html.length > htmlLimit) throw new Error("HTML이 65,535자를 넘습니다. 더 짧은 이미지 주소를 사용하세요.");
      $(".share-url-source").value = html;
      $("[data-copy-share]").disabled = false;
      $("[data-file-share]").disabled = false;
    } catch (e) {
      $(".share-url-source").value = "";
      $("[data-copy-share]").disabled = true;
      $("[data-file-share]").disabled = false;
      status(e.message);
    }
  }
  $("[data-copy-native]").onclick = async () => {
    const html = $(".share-native-source").value;
    if (!html || html.length > htmlLimit) return;
    try {
      await navigator.clipboard.writeText(html);
      $(".share-native-status").textContent = "HTML을 복사했습니다. 게시판의 HTML 편집 모드에 붙여넣으세요. 게시판의 스타일 필터에 따라 표시가 달라질 수 있습니다.";
    } catch {
      nativeSection.querySelector("details").open = true;
      $(".share-native-source").focus();
      $(".share-native-source").select();
      $(".share-native-status").textContent = "HTML을 선택했습니다. Ctrl+C 또는 길게 눌러 복사하세요.";
    }
  };
  function prepareNative(key, panel, link) {
    const started=performance.now();
    let html;
    if(key === "hourly") html=MMANativeHTML.hourly(window.MMAShareModels.hourly(), TrackerConfig.edition);
    else {
      const stage=stagePanel(key,panel);
      try {html=MMANativeHTML.panel(stage);} finally {stage.remove();}
    }
    html+=`<p style="font:12px/1.5 system-ui,sans-serif;color:#777;">복사 시점의 정적 기록 · <a href="${esc(link)}">원본 트래커</a></p>`;
    if(html.length>htmlLimit) throw new Error(`HTML이 ${html.length.toLocaleString()}자로 제한을 넘습니다. 표시 구간을 좁혀 다시 공유하세요.`);
    $(".share-native-source").value=html;
    $(".share-native-preview").innerHTML=html;
    $("[data-copy-native]").disabled=false;
    $(".share-native-status").textContent=`이미지 없는 HTML 준비 · ${html.length.toLocaleString()}자 / 65,535자 · ${Math.round(performance.now()-started)}ms`;
  }
  $(".share-image-url").addEventListener("input", updateHTML);
  $("[data-close-share]").onclick = () => dialog.close();
  $("[data-copy-share]").onclick = async () => {
    try {
      await navigator.clipboard.writeText(markup());
      status(
        "이미지 주소 HTML을 복사했습니다. 게시판의 HTML 편집 모드에 붙여넣으세요.",
      );
    } catch {
      $(".share-url-source").focus();
      $(".share-url-source").select();
      status("소스를 선택했습니다. Ctrl+C 또는 길게 눌러 복사하세요.");
    }
  };
  $("[data-copy-image]").onclick = async () => {
    const snapshot = current;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
        throw new Error("Image clipboard unavailable");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": snapshot.blob })]);
      status("이미지를 복사했습니다. 게시판 편집기에 붙여넣으세요. 지원하지 않으면 PNG 저장 후 사진 첨부를 이용하세요.");
    } catch {
      status("이 브라우저에서 이미지 복사를 사용할 수 없습니다. PNG 저장 후 게시판에 사진으로 첨부하세요.");
    }
  };
  $("[data-download-share]").onclick = () => download(current.blob, current.name + ".png");
  $("[data-file-share]").onclick = () =>
    download(
      new Blob(
        [
          '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
            esc(current.title) +
            '</title><body style="margin:0;background:#100e19;">' +
            markup(current.png) +
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
    if (source.matches(".gap-future,#gf-content,.chart-panel"))
      clone.style.height = "auto";
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
      if (node === panel) c.style.margin = "0";
      c.style.maxWidth = "100%";
      stage.append(c);
      return c;
    };
    if (key === "leaders") {
      // Show all six in the capture without changing the user's collapsed page.
      // Compute hidden cards only after expanding an isolated DOM copy. Styles
      // measured while display:none contain zero heights and would clip values.
      const grid = panel.cloneNode(true);
      grid.style.width = "100%";
      grid.style.height = "auto";
      grid.style.gridTemplateRows = "none";
      grid.style.gridAutoRows = "auto";
      for (const card of grid.querySelectorAll(".leader")) {
        card.removeAttribute("hidden");
        card.style.animation = "none";
        card.style.transition = "none";
        card.style.opacity = "1";
        card.style.transform = "none";
      }
      stage.append(grid);
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
    // Use installed fonts in the isolated capture; the live page is unchanged.
    for (const node of [stage, ...stage.querySelectorAll("*")])
      node.style.fontFamily = 'system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    document.body.append(stage);
    if (
      key === "leaders" &&
      [...stage.querySelectorAll(".leader")].some(
        (card) => card.getBoundingClientRect().height < 100,
      )
    ) {
      stage.remove();
      throw new Error("Rank capture has clipped cards");
    }
    return stage;
  }
  async function capture(key, panel) {
    if (key === "hourly") {
      const model = window.MMAShareModels.hourly();
      const canvas = window.MMAImages.render(model);
      const png = canvas.toDataURL("image/png");
      canvas.width = 1;
      canvas.height = 1;
      return { png, width: 1000 };
    }
    const stage = stagePanel(key, panel);
    try {
      const width = stage.offsetWidth,
        height = stage.scrollHeight;
      const png = await htmlToImage.toPng(stage, {
        width,
        height,
        pixelRatio: Math.min(
          1.5,
          4096 / height,
          Math.sqrt(8000000 / (width * height)),
        ),
        // System fonts avoid fetching/embedding hundreds of Korean font subsets.
        skipFonts: true,
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
    button.textContent = "이미지 공유하기";
    button.dataset.sharePanel = key;
    button.setAttribute("aria-label", title + " 이미지 공유하기");
    controls.append(button);
    if (key === "leaders") panel.after(controls);
    else if (key === "candles") panel.querySelector(".cd-wrap").after(controls);
    else panel.append(controls);
    button.onclick = async () => {
      if (busy) return;
      busy = true;
      sequence++;
      current = null;
      $("[data-copy-native]").disabled = true;
      $(".share-native-source").value = "";
      $(".share-native-preview").replaceChildren();
      $(".share-native-status").textContent = "HTML을 준비하고 있습니다…";
      $(".share-url-source").value = "";
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
      try {prepareNative(key,panel,link);} catch(e) {$(".share-native-status").textContent=e.message;console.error("HTML snapshot failed",e);}
      // Paint the independent HTML action before starting the existing PNG work.
      await new Promise(resolve=>setTimeout(resolve,0));
      try {
        const started = performance.now();
        // Serialize selected control state as well as plotted DOM to invalidate
        // captures when zoom, day, data, metric or team visibility changes.
        const fingerprint = JSON.stringify([
          panel.outerHTML,
          [...panel.querySelectorAll("input,select")].map(n => [n.value, n.checked]),
          key === "hourly" ? window.MMAShareModels.hourly() : null,
        ]);
        const previous = cache.get(key);
        const reused = previous?.fingerprint === fingerprint;
        const result = reused ? previous.result : await capture(key, panel);
        if (!reused) {
          result.blob = await (await fetch(result.png)).blob();
          cache.set(key, { fingerprint, result });
        }
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
        $("[data-copy-image]").disabled = false;
        $("[data-download-share]").disabled = false;
        $("[data-file-share]").disabled = false;
        status(
          `${reused ? "저장된 이미지 재사용" : "이미지 준비"} · ${((performance.now() - started) / 1000).toFixed(1)}초 · 이미지 복사 또는 PNG 저장을 선택하세요.`,
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

