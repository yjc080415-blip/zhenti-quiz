const $ = (sel, el = document) => el.querySelector(sel);
const toastEl = $("#toast");
let DATA = null;
let wakeLock = null;
const audioEl = new Audio();
audioEl.preload = "auto";
audioEl.playsInline = true;

function emptyDb() {
  return { answers: {}, results: {}, rate: 1, theme: "", sessions: [] };
}

const store = {
  key: "zhenti-quiz-v1",
  read() {
    try {
      const data = Object.assign(emptyDb(), JSON.parse(localStorage.getItem(this.key)) || {});
      if (!Array.isArray(data.sessions)) data.sessions = [];
      return data;
    } catch {
      return emptyDb();
    }
  },
  write(data) { localStorage.setItem(this.key, JSON.stringify(data)); },
};

function fmtWhen(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function sectionScore(paper, sec, db = store.read()) {
  let right = 0;
  for (const q of sec.questions) {
    if (db.results[qid(paper.id, sec.id, q.n)] === true) right += 1;
  }
  return { right, total: sec.questions.length };
}

function logSession(paper, sec) {
  const db = store.read();
  const { right, total } = sectionScore(paper, sec, db);
  db.sessions.unshift({
    t: Date.now(),
    paperId: paper.id,
    title: paper.title,
    section: sec.title,
    right,
    total,
  });
  if (db.sessions.length > 400) db.sessions.length = 400;
  store.write(db);
}

function qid(paperId, secId, n) { return `${paperId}|${secId}|${n}`; }

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.style.display = "none"; }, 1800);
}

function hashParts() {
  const h = location.hash.replace(/^#/, "") || "/";
  return h.split("/").filter(Boolean);
}

function paperOf(id) { return DATA.papers.find((p) => String(p.id) === String(id)); }

function paperStats(paper) {
  const db = store.read();
  let total = 0, done = 0, right = 0;
  for (const m of paper.modules) for (const s of m.sections) for (const q of s.questions) {
    total += 1;
    const id = qid(paper.id, s.id, q.n);
    if (db.answers[id]) done += 1;
    if (db.results[id] === true) right += 1;
  }
  return { total, done, right, pct: total ? Math.round((done / total) * 100) : 0 };
}

function applyTheme() {
  const theme = store.read().theme;
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
}

function svgBack() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
}

function topbar(title, sub, extra = "") {
  return `<div class="topbar">
    <button class="back" data-go="back" aria-label="返回">${svgBack()}</button>
    <div class="brand"><h1>${title}</h1><p>${sub || ""}</p></div>
    ${extra}
  </div>`;
}

function renderHome() {
  const db = store.read();
  const totals = DATA.papers.reduce((acc, p) => {
    const s = paperStats(p);
    acc.total += s.total; acc.done += s.done; acc.right += s.right;
    return acc;
  }, { total: 0, done: 0, right: 0 });
  const cards = DATA.papers.map((p) => {
    const s = paperStats(p);
    return `<button class="card paper-card" data-go="#/paper/${p.id}">
      <div>
        <h3>${p.title}</h3>
        <div class="meta">${s.total} 题 · ${p.modules.length} 个模块${p.vocabAvailable ? " · 含生词" : ""}</div>
        <div class="bar"><i style="width:${s.pct}%"></i></div>
      </div>
      <div class="pct">${s.done ? s.pct + "%" : "未做"}</div>
    </button>`;
  }).join("");
  return `${topbar("真题前30", "听力刷题", `<button class="icon-btn" data-act="theme">${db.theme === "dark" ? "光" : "夜"}</button>`)}
    <div class="hero">
      <h2>随时拿出手机练听力</h2>
      <p>做题进度、对错和练习记录都保存在这台手机的浏览器里。清缓存或换浏览器会丢，可到记录页导出备份。</p>
      <div class="stats">
        <div class="stat"><b>${DATA.papers.length}</b><span>套卷</span></div>
        <div class="stat"><b>${totals.done}</b><span>已做 / ${totals.total}</span></div>
        <div class="stat"><b>${totals.done ? Math.round(totals.right / totals.done * 100) : 0}%</b><span>正确率</span></div>
      </div>
      <div class="lan" id="lanBox">添加到主屏幕后，用同一个浏览器打开即可接着刷。</div>
    </div>
    <div class="filters">
      <button class="chip on" data-filter="all">全部</button>
      <button class="chip" data-filter="todo">未完成</button>
      <button class="chip" data-filter="wrong">有错题</button>
      <button class="chip" data-go="#/history">练习记录</button>
      <button class="chip" data-go="#/wrong">错题本</button>
    </div>
    <div class="grid papers">${cards}</div>`;
}

function renderPaper(paper) {
  const s = paperStats(paper);
  const mods = paper.modules.map((m) => {
    const items = m.sections.map((sec) => {
      const n = sec.questions.length;
      const audioOk = sec.kind === "reply" ? sec.questions.some((q) => q.audio) : !!sec.audio;
      return `<button class="card sec" data-go="#/play/${paper.id}/${encodeURIComponent(sec.id)}">
        <div class="mark">${sec.qStart}-${sec.qEnd}</div>
        <div class="grow">
          <h3>${m.title} · ${sec.title}</h3>
          <p>${n} 题${audioOk ? " · 有音频" : " · 暂无音频"}</p>
        </div>
        <span class="tag">${sec.kind === "reply" ? "逐题" : "整段"}</span>
      </button>`;
    }).join("");
    return items;
  }).join("");
  return `${topbar(paper.title, `已做 ${s.done}/${s.total} · 正确 ${s.right}`)}
    <div class="actions">
      <button class="btn" data-go="#/play/${paper.id}/all">整卷刷</button>
      <button class="btn ghost" data-go="#/wrong/${paper.id}">错题本</button>
    </div>
    <div class="section-list">${mods}</div>`;
}

function collectWrong(paper) {
  const db = store.read();
  const items = [];
  const papers = paper ? [paper] : DATA.papers;
  for (const p of papers) for (const m of p.modules) for (const s of m.sections) for (const q of s.questions) {
    const id = qid(p.id, s.id, q.n);
    if (db.results[id] === false) items.push({ paper: p, sec: s, q });
  }
  return items;
}

function optionClass(q, letter, picked, revealed) {
  if (!revealed) return picked === letter ? "picked" : "";
  if (letter === q.answer) return "good";
  if (picked === letter && picked !== q.answer) return "bad";
  return "";
}

function renderOptions(q, picked, revealed) {
  return "ABCD".split("").map((L) => `<button class="opt ${optionClass(q, L, picked, revealed)}" data-pick="${L}">
    <b>${L}</b><span>${q.options[L] || ""}</span>
  </button>`).join("");
}

function playerHtml(label) {
  return `<div class="player">
    <div class="player-row">
      <button class="play" data-act="togglePlay" aria-label="播放">▶</button>
      <div class="grow">
        <div>${label}</div>
        <input type="range" min="0" max="1000" value="0" data-act="seek" />
        <div class="times"><span data-cur>0:00</span> / <span data-dur>0:00</span></div>
      </div>
    </div>
    <div class="speeds">
      ${[0.75, 1, 1.25, 1.5].map((r) => `<button data-rate="${r}" class="${store.read().rate === r ? "on" : ""}">${r}x</button>`).join("")}
    </div>
  </div>`;
}

function fmt(t) {
  if (!isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function bindPlayer(src) {
  const db = store.read();
  audioEl.playbackRate = db.rate || 1;
  if (src && audioEl.dataset.src !== src) {
    audioEl.src = src;
    audioEl.dataset.src = src;
  }
  const playBtn = $("[data-act=togglePlay]");
  const seek = $("[data-act=seek]");
  const cur = $("[data-cur]");
  const dur = $("[data-dur]");
  const sync = () => {
    if (playBtn) playBtn.textContent = audioEl.paused ? "▶" : "❚❚";
    if (dur) dur.textContent = fmt(audioEl.duration || 0);
    if (cur) cur.textContent = fmt(audioEl.currentTime || 0);
    if (seek && audioEl.duration) seek.value = Math.round((audioEl.currentTime / audioEl.duration) * 1000);
  };
  audioEl.ontimeupdate = sync;
  audioEl.onloadedmetadata = sync;
  audioEl.onended = sync;
  sync();
}

function revealBox(sec, q) {
  const bits = [];
  if (q?.stem) bits.push(`<h4>题干 / 听到的句子</h4><p>${q.stem}</p>`);
  if (sec.transcript) bits.push(`<h4>原文</h4><p>${sec.transcript}</p>`);
  if (sec.vocab?.length) {
    bits.push(`<h4>生词</h4><div class="vocab">${sec.vocab.map((v) => `<div><b>${v.word} ${v.pos}</b><span>${v.meaning}</span></div>`).join("")}</div>`);
  }
  return bits.length ? `<div class="reveal">${bits.join("")}</div>` : "";
}

function flattenSections(paper) {
  const list = [];
  for (const m of paper.modules) for (const s of m.sections) list.push(s);
  return list;
}

function renderPlay(paper, secId, qIndex) {
  const sections = flattenSections(paper);
  const allMode = secId === "all";
  let idx = allMode ? 0 : sections.findIndex((s) => s.id === secId);
  if (idx < 0) idx = 0;
  if (allMode) {
    const n = Number(qIndex || 0);
    idx = Math.min(Math.max(n, 0), sections.length - 1);
  }
  const sec = sections[idx];
  const db = store.read();
  const isReply = sec.kind === "reply";
  const qi = Number(sessionStorage.getItem("qi") || 0);
  const q = isReply ? sec.questions[Math.min(qi, sec.questions.length - 1)] : null;
  const src = isReply ? q?.audio : sec.audio;
  const progressLabel = allMode
    ? `${paper.title} · ${idx + 1}/${sections.length} · ${sec.title}`
    : `${paper.title} · ${sec.title}`;

  let body = playerHtml(src ? "点击播放音频" : "本段暂无音频");
  if (isReply) {
    const picked = db.answers[qid(paper.id, sec.id, q.n)] || "";
    const revealed = picked !== "";
    body += `<div class="q">
      <div class="num">第 ${q.n} 题 · ${qi + 1}/${sec.questions.length}</div>
      <h3>Choose the best response</h3>
      ${renderOptions(q, picked, revealed)}
    </div>`;
    if (revealed) body += revealBox(sec, q);
    body += `<div class="actions">
      <button class="btn ghost" data-act="prevQ" ${qi === 0 ? "disabled" : ""}>上一题</button>
      <button class="btn" data-act="nextQ">${qi + 1 === sec.questions.length ? (allMode ? "下一段" : "完成本段") : "下一题"}</button>
    </div>`;
  } else {
    const revealed = sec.questions.every((qq) => typeof db.results[qid(paper.id, sec.id, qq.n)] === "boolean");
    body += sec.questions.map((qq) => {
      const picked = db.answers[qid(paper.id, sec.id, qq.n)] || "";
      return `<div class="q" data-qn="${qq.n}">
        <div class="num">第 ${qq.n} 题</div>
        <h3>${qq.stem || "根据录音选择答案"}</h3>
        ${renderOptions(qq, picked, revealed)}
      </div>`;
    }).join("");
    if (revealed) body += revealBox(sec, null);
    body += `<div class="actions">
      <button class="btn ghost" data-go="${allMode ? `#/play/${paper.id}/all/${Math.max(idx - 1, 0)}` : `#/paper/${paper.id}`}">返回</button>
      <button class="btn" data-act="${revealed ? "nextSec" : "submitSec"}">${revealed ? (allMode && idx + 1 < sections.length ? "下一段" : "完成") : "提交本段"}</button>
    </div>`;
  }
  return `${topbar(progressLabel, isReply ? "听完再选，选完立刻对答案" : "先听完整段，再一起提交")}
    ${body}`;
}

function renderHistory() {
  const db = store.read();
  const sessions = db.sessions || [];
  const body = sessions.length
    ? sessions.map((s) => `<button class="card hist" data-go="#/paper/${s.paperId}">
        <div class="grow">
          <h3>${s.title} · ${s.section}</h3>
          <p>${fmtWhen(s.t)} · ${s.right}/${s.total} 正确</p>
        </div>
        <div class="pct">${s.total ? Math.round(s.right / s.total * 100) : 0}%</div>
      </button>`).join("")
    : `<div class="empty">还没有练习记录。做完一段题后会出现在这里。</div>`;
  return `${topbar("练习记录", `共 ${sessions.length} 次`)}
    <div class="actions">
      <button class="btn ghost" data-act="exportHist">导出备份</button>
      <button class="btn ghost" data-act="importHist">导入备份</button>
    </div>
    <input id="histFile" type="file" accept="application/json" hidden />
    <div class="grid">${body}</div>`;
}

function renderWrong(paper) {
  const items = collectWrong(paper);
  if (!items.length) {
    return `${topbar(paper ? paper.title + " 错题" : "全部错题", "")}<div class="empty">暂无错题，去刷一套吧。</div>`;
  }
  const db = store.read();
  const html = items.map(({ paper: p, sec, q }) => {
    const picked = db.answers[qid(p.id, sec.id, q.n)] || "";
    return `<div class="q">
      <div class="num">${p.title} · ${sec.title} · 第 ${q.n} 题</div>
      <h3>${q.stem || "根据录音选择答案"}</h3>
      ${renderOptions(q, picked, true)}
      ${q.audio || sec.audio ? `<button class="btn ghost" data-audio="${q.audio || sec.audio}">重听</button>` : ""}
    </div>`;
  }).join("");
  return `${topbar(paper ? paper.title + " 错题" : "全部错题", `共 ${items.length} 题`)}${html}`;
}

function route() {
  const parts = hashParts();
  const root = $("#app");
  audioEl.pause();
  let html = "";
  if (parts[0] === "paper") html = renderPaper(paperOf(parts[1]));
  else if (parts[0] === "play") html = renderPlay(paperOf(parts[1]), decodeURIComponent(parts[2] || "all"), parts[3]);
  else if (parts[0] === "wrong") html = renderWrong(parts[1] ? paperOf(parts[1]) : null);
  else if (parts[0] === "history") html = renderHistory();
  else html = renderHome();
  root.innerHTML = html;

  if (parts[0] === "play") {
    const paper = paperOf(parts[1]);
    const sections = flattenSections(paper);
    const allMode = parts[2] === "all";
    let idx = allMode ? Number(parts[3] || 0) : sections.findIndex((s) => s.id === decodeURIComponent(parts[2]));
    if (idx < 0) idx = 0;
    const sec = sections[idx];
    const qi = Number(sessionStorage.getItem("qi") || 0);
    const src = sec.kind === "reply" ? sec.questions[Math.min(qi, sec.questions.length - 1)]?.audio : sec.audio;
    bindPlayer(src ? "./" + src : "");
    if (src) keepAwake();
  }

  fetch("./api/info").then((r) => r.json()).then((info) => {
    const box = $("#lanBox");
    if (box && info.urls?.length) box.innerHTML = "手机访问：" + info.urls.map((u) => `<b>${u}</b>`).join("　");
  }).catch(() => {});
}

function savePick(paper, sec, q, letter) {
  const db = store.read();
  const id = qid(paper.id, sec.id, q.n);
  db.answers[id] = letter;
  db.results[id] = letter === q.answer;
  store.write(db);
}

function nextReply(paper, sec, allMode, secIndex) {
  const qi = Number(sessionStorage.getItem("qi") || 0);
  if (qi + 1 < sec.questions.length) {
    sessionStorage.setItem("qi", String(qi + 1));
    route();
    return;
  }
  logSession(paper, sec);
  sessionStorage.setItem("qi", "0");
  if (allMode) location.hash = `#/play/${paper.id}/all/${secIndex + 1}`;
  else location.hash = `#/paper/${paper.id}`;
}

document.addEventListener("click", async (e) => {
  const go = e.target.closest("[data-go]");
  if (go) {
    const to = go.dataset.go;
    if (to === "back") history.length > 1 ? history.back() : (location.hash = "#/");
    else location.hash = to;
    return;
  }
  const themeBtn = e.target.closest("[data-act=theme]");
  if (themeBtn) {
    const db = store.read();
    db.theme = db.theme === "dark" ? "" : "dark";
    store.write(db);
    applyTheme();
    route();
    return;
  }
  const pick = e.target.closest("[data-pick]");
  if (pick) {
    const parts = hashParts();
    const paper = paperOf(parts[1]);
    const sections = flattenSections(paper);
    const allMode = parts[2] === "all";
    let idx = allMode ? Number(parts[3] || 0) : sections.findIndex((s) => s.id === decodeURIComponent(parts[2]));
    if (idx < 0) idx = 0;
    const sec = sections[idx];
    if (sec.kind === "reply") {
      const qi = Number(sessionStorage.getItem("qi") || 0);
      const q = sec.questions[qi];
      savePick(paper, sec, q, pick.dataset.pick);
      route();
    } else {
      const qn = Number(pick.closest(".q").dataset.qn);
      const q = sec.questions.find((x) => x.n === qn);
      const db = store.read();
      if (sec.questions.every((qq) => typeof db.results[qid(paper.id, sec.id, qq.n)] === "boolean")) return;
      db.answers[qid(paper.id, sec.id, q.n)] = pick.dataset.pick;
      store.write(db);
      route();
    }
    return;
  }
  const act = e.target.closest("[data-act]");
  if (act) {
    const parts = hashParts();
    const paper = parts[0] === "play" ? paperOf(parts[1]) : null;
    const sections = paper ? flattenSections(paper) : [];
    const allMode = parts[2] === "all";
    let idx = allMode ? Number(parts[3] || 0) : sections.findIndex((s) => s.id === decodeURIComponent(parts[2] || ""));
    if (idx < 0) idx = 0;
    const sec = sections[idx];
    if (act.dataset.act === "togglePlay") {
      if (audioEl.paused) { try { await audioEl.play(); keepAwake(); } catch { toast("请先点播放"); } }
      else audioEl.pause();
      bindPlayer(audioEl.dataset.src || "");
    } else if (act.dataset.act === "nextQ") nextReply(paper, sec, allMode, idx);
    else if (act.dataset.act === "prevQ") {
      sessionStorage.setItem("qi", String(Math.max(Number(sessionStorage.getItem("qi") || 0) - 1, 0)));
      route();
    } else if (act.dataset.act === "submitSec") {
      const db = store.read();
      const missing = sec.questions.filter((q) => !db.answers[qid(paper.id, sec.id, q.n)]);
      if (missing.length) { toast(`还有 ${missing.length} 题没选`); return; }
      for (const q of sec.questions) {
        const id = qid(paper.id, sec.id, q.n);
        db.results[id] = db.answers[id] === q.answer;
      }
      store.write(db);
      logSession(paper, sec);
      const right = sec.questions.filter((q) => db.results[qid(paper.id, sec.id, q.n)]).length;
      toast(`本段 ${right}/${sec.questions.length} 正确`);
      route();
    } else if (act.dataset.act === "exportHist") {
      const blob = new Blob([JSON.stringify(store.read(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "zhenti-history.json";
      a.click();
      toast("已导出备份");
    } else if (act.dataset.act === "importHist") {
      $("#histFile")?.click();
    } else if (act.dataset.act === "nextSec") {
      sessionStorage.setItem("qi", "0");
      if (allMode && idx + 1 < sections.length) location.hash = `#/play/${paper.id}/all/${idx + 1}`;
      else location.hash = `#/paper/${paper.id}`;
    }
    return;
  }
  const rate = e.target.closest("[data-rate]");
  if (rate) {
    const db = store.read();
    db.rate = Number(rate.dataset.rate);
    store.write(db);
    audioEl.playbackRate = db.rate;
    document.querySelectorAll("[data-rate]").forEach((b) => b.classList.toggle("on", Number(b.dataset.rate) === db.rate));
    return;
  }
  const replay = e.target.closest("[data-audio]");
  if (replay) {
    audioEl.src = "./" + replay.dataset.audio;
    audioEl.dataset.src = "./" + replay.dataset.audio;
    audioEl.play();
  }
  const filter = e.target.closest("[data-filter]");
  if (filter) {
    document.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("on", b === filter));
    document.querySelectorAll(".paper-card").forEach((card) => {
      const id = card.dataset.go.split("/").pop();
      const p = paperOf(id);
      const s = paperStats(p);
      const wrong = collectWrong(p).length;
      const mode = filter.dataset.filter;
      let show = true;
      if (mode === "todo") show = s.done < s.total;
      if (mode === "wrong") show = wrong > 0;
      card.style.display = show ? "" : "none";
    });
  }
});

document.addEventListener("input", (e) => {
  if (e.target.dataset.act === "seek" && audioEl.duration) {
    audioEl.currentTime = (Number(e.target.value) / 1000) * audioEl.duration;
  }
});

document.addEventListener("change", (e) => {
  if (e.target.id !== "histFile" || !e.target.files?.[0]) return;
  const file = e.target.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result);
      const db = store.read();
      if (incoming.answers) Object.assign(db.answers, incoming.answers);
      if (incoming.results) Object.assign(db.results, incoming.results);
      if (Array.isArray(incoming.sessions)) {
        const seen = new Set(db.sessions.map((s) => `${s.t}|${s.paperId}|${s.section}`));
        for (const s of incoming.sessions) {
          const key = `${s.t}|${s.paperId}|${s.section}`;
          if (!seen.has(key)) db.sessions.push(s);
        }
        db.sessions.sort((a, b) => b.t - a.t);
      }
      store.write(db);
      toast("已导入进度和记录");
      route();
    } catch {
      toast("备份文件无效");
    }
  };
  reader.readAsText(file, "utf-8");
});

window.addEventListener("hashchange", () => {
  const key = location.hash;
  const prev = sessionStorage.getItem("lastHash") || "";
  const secNow = key.split("/").slice(0, 4).join("/");
  const secPrev = prev.split("/").slice(0, 4).join("/");
  if (secNow !== secPrev) sessionStorage.setItem("qi", "0");
  sessionStorage.setItem("lastHash", key);
  route();
});

applyTheme();
fetch("./data/papers.json")
  .then((r) => r.json())
  .then((data) => { DATA = data; route(); })
  .catch(() => { $("#app").innerHTML = "<p class='empty'>题库加载失败，请用 python server.py 启动后再打开。</p>"; });

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
