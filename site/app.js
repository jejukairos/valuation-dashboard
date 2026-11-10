/* 밸류 신호등 — 화면 그리기. 데이터: data/dashboard.json, data/stocks/<코드>.json */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const LIGHT = {
  green: { emoji: "🟢", market: "매력 구간", stock: "저평가" },
  yellow: { emoji: "🟡", market: "중립", stock: "적정" },
  red: { emoji: "🔴", market: "위험 구간", stock: "고평가" },
  na: { emoji: "⚪", market: "N/A", stock: "N/A" },
};
let DASH = null;
let MKT = "KR"; // 🇰🇷 보유 / 🇺🇸 보유 탭
let sortMode = "cheap";
const charts = new Map();

/* ---------- 숫자 표시 ---------- */
function n(v, d = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return "N/A";
  return Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function won(v) { return v == null ? "N/A" : n(v) + "원"; }
// 💱 사용자 2026-11-04: 엔·달러·유로 등 외화 금액 옆에 (약 ○원) — 화면에 글자가 붙을 때마다 자동으로 (오늘 환율 = peers.json fx)
// shortcut: '억·조·만' 붙은 금액만 바꿈 (주가 '10,880엔' 같은 맨 숫자·'1조 7,306억엔' 앞쪽 조는 안 바뀜), 필요하면 숫자 규칙 넓히기
let FXR = null;
const FXCUR = { 대만달러: "TWD", 홍콩달러: "HKD", 스위스프랑: "CHF", 달러: "USD", $: "USD", 엔: "JPY", 유로: "EUR", "€": "EUR", 파운드: "GBP", "£": "GBP", 위안: "CNY" };
const FXMAG = { 조: 1e12, 천억: 1e11, 억: 1e8, 천만: 1e7, 만: 1e4 };
const FXRE = /(\d[\d,]*(?:\.\d+)?)\s?(조|천억|억|천만|만)\s?(대만달러|홍콩달러|스위스프랑|달러|유로|파운드|위안|엔(?!비|진|터)|\$|€|£)(?!\s?\(약?\s?[\d.,]+\s?[조억만]?원)/g;
const wonize = (s) => s.replace(FXRE, (m, v, mag, u) => {
  const w = parseFloat(v.replace(/,/g, "")) * FXMAG[mag] * (FXR?.[FXCUR[u]] || NaN);
  return !(w > 0) ? m : `${m} (약 ${w >= 1e12 ? n(w / 1e12, w >= 1e14 ? 0 : 1) + "조" : w >= 1e8 ? n(w / 1e8) + "억" : n(w / 1e4) + "만"}원)`;
});
const FXHIT = new RegExp(FXRE.source);  // test 용 (g 없는 판 — lastIndex 꼬임 방지)
function wonDOM(root) {
  if (!FXR || !root) return;
  const fix = (t) => { if (FXHIT.test(t.nodeValue) && !t.parentElement?.closest("svg,script,style,textarea,option")) t.nodeValue = wonize(t.nodeValue); };
  if (root.nodeType === 3) return fix(root);
  if (root.nodeType !== 1) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), ts = [];
  while (tw.nextNode()) ts.push(tw.currentNode);
  ts.forEach(fix);
}
new MutationObserver((ms) => { if (FXR) ms.forEach((m) => m.addedNodes.forEach(wonDOM)); }).observe(document.documentElement, { childList: true, subtree: true });
function money(v, cur) { return v == null ? "N/A" : cur === "USD" ? "$" + n(v, 2) : n(v) + "원"; }
function bigWon(v) {
  if (v == null) return "N/A";
  if (v >= 1e12) return n(v / 1e12, 1) + "조원";
  if (v >= 1e8) return n(v / 1e8) + "억원";
  return n(v) + "원";
}
const capTxt = (o) => (o.market_cap_usd ? `$${n(o.market_cap_usd / 1e9, o.market_cap_usd >= 1e11 ? 0 : 1)}B` : bigWon(o.market_cap));  // 미국 = $B, 한국 = 조원
function pct(v, d = 1, sign = false) {
  if (v == null) return "N/A";
  const r = Number(v.toFixed(d)) || 0; // -0 방지
  return (sign && r > 0 ? "+" : "") + n(r, d) + "%";
}
function times(v, d = 1) { return v == null ? "N/A" : n(v, d) + "배"; }
function lamp(sig, cls = "") { const L = LIGHT[sig] || LIGHT.na; return `<div class="lamp ${sig} ${cls}" aria-hidden="true">${L.emoji}</div>`; }

/* ---------- 차트 ---------- */
function themeColors() {
  return { s1: css("--s1"), s2: css("--s2"), s3: css("--s3"), s4: css("--s4"), s7: css("--s7"),
    ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), grid: css("--grid"), surface: css("--surface") };
}
function makeChart(canvas, labels, datasets, opt = {}) {
  const C = themeColors();
  if (charts.has(canvas.id)) charts.get(canvas.id).destroy();
  const ch = new Chart(canvas, {
    type: opt.type || "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: C.surface, titleColor: C.ink, bodyColor: C.ink, borderColor: C.grid, borderWidth: 1,
          padding: 8, displayColors: true, boxWidth: 8, boxHeight: 8,
          callbacks: { label: (c) => ` ${c.dataset.label}: ${opt.fmt ? opt.fmt(c.parsed.y) : n(c.parsed.y, 2)}` },
        },
      },
      elements: { point: { radius: 0, hoverRadius: 4, hitRadius: 8 }, line: { borderWidth: 2, tension: 0 } },
      scales: {
        x: { grid: { display: false }, border: { color: C.grid },
          ticks: { color: C.muted, maxTicksLimit: 5, maxRotation: 0, autoSkip: true, font: { size: 12 },
            callback(v) { const l = this.getLabelForValue(v); return String(l).slice(0, opt.xlen || 7); } } },
        y: { grid: { color: C.grid }, border: { display: false }, beginAtZero: !!opt.zero,
          ticks: { color: C.muted, maxTicksLimit: 5, font: { size: 12 }, callback: (v) => (opt.yfmt ? opt.yfmt(v) : n(v, 1)) } },
      },
    },
  });
  charts.set(canvas.id, ch);
  return ch;
}
function legend(items) {
  return `<div class="legend">${items.map(([label, color, dash]) => `<span><i class="${dash ? "dash" : ""}" style="border-color:${color}"></i>${esc(label)}</span>`).join("")}</div>`;
}
function sliceYears(dates, years) {
  if (!years) return 0;
  const end = new Date(dates[dates.length - 1]);
  const cut = new Date(end); cut.setFullYear(end.getFullYear() - years);
  const c = cut.toISOString().slice(0, 10);
  const i = dates.findIndex((d) => d >= c);
  return i < 0 ? 0 : i;
}

/* ---------- 1. 시장 신호등 ---------- */
function marketCard(sig, rateObj, extraRate, key) {
  const L = LIGHT[sig.signal] || LIGHT.na;
  if (sig.signal === "na") {
    return `<div class="card"><div class="light">${lamp("na")}<div><div class="verdict na">${esc(sig.name)} · N/A</div>
      <div class="sub">${esc(sig.reason || "")}</div></div></div></div>`;
  }
  const stale = sig.stale || rateObj?.stale ? `<div class="stale">⚠ ${esc(sig.rate_label)} 금리는 이번에 못 받아서 직전 값(${esc(rateObj?.date || "")})이에요</div>` : "";
  return `<div class="card">
    <div class="light">${lamp(sig.signal)}<div>
      <div class="verdict ${sig.signal}">${esc(sig.name)} · ${L.market}</div>
      <div class="sub">비율 <span class="big">${n(sig.ratio, 2)}</span></div>
    </div></div>
    <div class="kv">
      <div class="k kgrp">배수 비교</div><div class="v"></div>
      <div class="k">${esc(sig.per_label)}</div><div class="v">${times(sig.per)}<span class="src">${esc(sig.per_source)}</span></div>
      <div class="k">채권 환산 PER <span class="src nowrap">1 ÷ 금리</span></div><div class="v">${times(sig.bond_per)}</div>
      <div class="k kgrp">수익률 비교</div><div class="v"></div>
      <div class="k">주식 이익수익률 <span class="src nowrap">1 ÷ PER</span></div><div class="v">${pct(sig.earnings_yield, 2)}</div>
      <div class="k">${esc(sig.rate_label)}</div><div class="v">${pct(sig.rate, 2)}<span class="src">${esc(rateObj?.source || "")} · ${esc(rateObj?.date || "")}</span></div>
      ${extraRate ? `<div class="k" style="font-size:12px">${esc(extraRate.label)} (참고)</div><div class="v" style="font-size:12px;font-weight:400">${pct(extraRate.latest, 2)}</div>` : ""}
    </div>${stale}${key === "kr" ? kospiPbrBrief() : ""}
    <div class="chart-title">${esc(sig.rate_label)} 추이 (5년)</div>
    <div class="chart-box"><canvas id="rate-${key}"></canvas></div>
  </div>`;
}
function drawMarketCharts() {
  const C = themeColors();
  for (const [key, rk] of [["us", "us10y"], ["kr", "kr3y"]]) {
    const r = DASH.rates[rk];
    const cv = document.getElementById(`rate-${key}`);
    if (r && cv) {
      const i = sliceYears(r.hist.map((x) => x[0]), 5);
      const h = r.hist.slice(i);
      makeChart(cv, h.map((x) => x[0]), [{ label: "금리", data: h.map((x) => x[1]), borderColor: C.s1 }], { yfmt: (v) => v.toFixed(1) + "%", fmt: (v) => v.toFixed(2) + "%" });
    }
  }
}

/* ---------- 2. 종목 카드 ---------- */
/* 종목별 금리 비교는 차이가 클 때(주식 선행 PER 이 채권 환산 PER 이상)만 보여준다 */
function bondAlert(c) {
  const lim = DASH.settings.bond_signal.stock_alert_above ?? 1.0;
  return c.bond_ratio != null && c.bond_ratio >= lim;
}
// 적정주가 표: 행 = 5년·10년 저점/평균/고점 배수, 열 = 연도별 EPS(BPS) × 배수 (지금보다 몇 %)
function fairTableHTML(c) {
  const fv = c.fv || {};
  const usd = c.currency === "USD";
  const fmtP = (v) => (v == null ? "N/A" : usd ? "$" + n(v, 0) : n(v));
  return Object.entries(fv).map(([kind, t], i) => {
    if (!t.rows || !t.rows.length) return "";
    const base = kind === "PER" ? "EPS" : "BPS";
    const head = `적정주가 · ${base} × ${kind} <span class="src">${t.cols.map((k) => `${k} ${base} ${fmtP(t.base[k])}`).join(" · ")}</span>`;
    // 적정가 기준 방식 표는 펼쳐서, 두 번째 방식 표는 접어서 (눌러서 펼침)
    return `<${i ? "details" : "div"} class="fvt" onclick="event.stopPropagation()">${i ? `<summary class="chart-title" style="margin-top:10px">${head}</summary>` : `<div class="chart-title" style="margin-top:10px">${head}</div>`}
      <table class="compact"><thead><tr><th>${kind} 배수</th>${t.cols.map((k) => `<th>${k}</th>`).join("")}</tr></thead><tbody>
      ${t.rows.map((r) => `<tr class="${r.label.includes("평균") ? "avg" : ""}"><td>${esc(r.label)} <span class="src">${n(r.mult, kind === "PER" ? 1 : 2)}배</span></td>${t.cols.map((k) => r.cells[k] == null ? "<td>N/A</td>" :
        `<td class="${r.cells[k] >= c.price ? "cheap" : "dear"}">${fmtP(r.cells[k])}<br><span class="src">${pct(r.pct[k], 0, true)}</span></td>`).join("")}</tr>`).join("")}
      </tbody></table></${i ? "details" : "div"}>`;
  }).join("");
}
// ① 앞으로 실적(12MF) 기준 Bear/Base/Bull 적정주가 자 위에 지금 가격을 점으로
function scenHTML(c) {
  const s = c.scen;
  if (!s || !s.base) return "";
  const usd = c.currency === "USD";
  const fmtP = (v) => (usd ? "$" + n(v, 0) : n(v));
  // Bear = 하방(이 정도면 바닥, 더 빠지면 안전마진) · Base = 적정주가 · Bull = 상방 (사용자 11/6: '최대' → '상방')
  const pts = [["bear", "Bear", "하방"], ["base", "Base", "적정주가"], ["bull", "Bull", "상방"]];
  const bar = (v) => {  // 하방·적정·상방·지금 위치 막대 (보는 칸마다 눈금을 다시 잡음)
    const lo0 = Math.min(c.price, v.bear), hi0 = Math.max(c.price, v.bull), pad = (hi0 - lo0) * 0.08 || hi0 * 0.05;
    const lo = Math.max(0, lo0 - pad), hi = hi0 + pad, at = (x) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
    return `<div class="scenbar" style="background:linear-gradient(90deg, var(--good-bg) 0 ${at(v.base)}%, var(--warn-bg) ${at(v.base)}% ${at(v.bull)}%, var(--bad-bg) ${at(v.bull)}%)">
      ${pts.map(([k, l]) => `<span class="tick" style="left:${at(v[k])}%"></span><span class="tl" style="left:${at(v[k])}%">${l}</span>`).join("")}
      <span class="dot" style="left:${at(c.price)}%"></span><span class="now" style="left:${at(c.price)}%">지금</span></div>`;
  };
  const fmtB = (x) => (usd ? "$" + n(x, 2) : n(x) + "원");
  const baseOf = (parts, lab) => (parts || []).map((p) => `${lab} ${p.kind === "PER" ? "EPS" : "BPS"} ${fmtB(p.base_val)}`).join(" · ");
  // 칸: 가격 → 배수 → 지금 가격 대비 % (EPS·BPS 는 제목에 한 번만)
  function scenBoxes(v, parts) {
    return `<div class="scen3">${pts.map(([k, l, ko]) => {
      const up = (v[k] / c.price - 1) * 100;
      const why = (parts || []).map((p) => `${p.kind} ${n(p.mult[k], p.kind === "PBR" ? 2 : 1)}배`).join(" · ") + ((parts || []).length > 1 ? " 평균" : "");
      return `<div class="${k}${k === "base" ? " on" : ""}"><span>${l} <b>${ko}</b></span><b>${fmtP(v[k])}</b><span class="src basis">${why}</span><em class="${up >= 0 ? "up" : "dn"}">${pct(up, 0, true)}</em></div>`;
    }).join("")}</div>`;
  }
  // PER·PBR 을 같이 보는 종목(현대차 등): 칸 바로 아래에 방법마다 하방·적정·최대를 따로 (위 칸은 두 값의 평균)
  const partRows = (parts) => ((parts || []).length > 1 ? `<div class="tbl-wrap"><table class="compact" style="width:100%;margin-top:6px"><thead><tr><th style="text-align:left">방법별 <span class="src">위 칸 = 평균</span></th>${pts.map(([, l, ko]) => `<th>${l} ${ko}</th>`).join("")}</tr></thead><tbody>
    ${parts.map((p) => `<tr><td style="text-align:left"><b>${esc(p.kind)}</b> <span class="src">${pts.map(([k]) => n(p.mult[k], p.kind === "PBR" ? 2 : 1)).join(" · ")}배 × ${p.kind === "PER" ? "EPS" : "BPS"}</span></td>${pts.map(([k]) => {
      const x = p.base_val * p.mult[k], up = (x / c.price - 1) * 100;
      return `<td><b>${fmtP(x)}</b><br><em class="${up >= 0 ? "up" : "dn"}">${pct(up, 0, true)}</em></td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>` : "");
  // 📐 PBR 로만 매기는 종목인데 업종 리레이팅 기록이 있으면 PER 로도 (접어 둠): 🔴 약세장 = 리레이팅 전 배수로 보수적 · 🐂 강세장 = 리레이팅 된 배수
  const perAlt = (mode) => {
    const a = s.per_alt;
    if (!a) return "";
    const m = mode === "easy" ? a.easy : a.tight, mm = { bear: m[0], base: m[1], bull: m[2] }, x = (k) => n(mm[k], 1);
    const v = Object.fromEntries(Object.entries(mm).map(([k, f]) => [k, a.e12 * f]));
    const why = mode === "easy" ? `🐂 강세장(금리가 내려가 돈이 들어올 때)엔 리레이팅 됐던 배수를 써요: ${x("bear")} · ${x("base")} · ${x("bull")}배 (업종 보통 ~ 최고) — ${esc(a.history || "")}`
      : `🔴 지금은 긴축·약세장이라 더 보수적으로 리레이팅 전 배수를 썼어요: ${x("bear")} · ${x("base")} · ${x("bull")}배 (업종 바닥 ~ 보통). 리레이팅 때 PER(${esc(a.history || "")})은 금리가 내려가고 돈이 다시 들어올 때나 기대할 수 있어요.`;
    return `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:6px">📐 PER 로도 보기 <span class="src">12MF EPS ${fmtB(a.e12)} × ${x("bear")} · ${x("base")} · ${x("bull")}배 · 눌러서 열기</span></summary>
      ${scenBoxes(v, [{ kind: "PER", mult: mm }])}<div class="note src">${why}<br>💬 이익(순이익)이 해마다 들쭉날쭉해서(일회성 이익·손실) 적정주가는 위 PBR 로 매기고, PER 은 참고로만 봐요. ${s.rerating ? `🔁 ${esc(s.rerating)}` : ""}</div></details>`;
  };
  // 🐂 강세장일 때(금리가 내려가 돈이 풀릴 때): 같은 Bear·Base·Bull 칸을 탭으로 — 성장률 × 1.5·1.75·2, 업종·밴드 PER 은 보통·1.5배·2배
  const bm = s.bull_mkt, reg = s.regime;
  const bv = bm ? { bear: bm.lo, base: bm.mid ?? (bm.lo + bm.hi) / 2, bull: bm.hi } : null;
  const bparts = (s.parts || []).map((p) => ({ ...p, mult: p.bm ? { bear: p.bm.lo, base: p.bm.mid ?? (p.bm.lo + p.bm.hi) / 2, bull: p.bm.hi } : p.mult }));
  const m0 = bv && reg?.mode === "easy" ? "bull" : "now";  // 지금 시장 국면 쪽 탭을 먼저
  const regLine = reg ? `<div class="note src">지금 시장: <b>${reg.mode === "tight" ? "🔴" : "🟢"} ${esc(reg.label)}</b> — ${reg.why.map(esc).join(" · ")}</div>` : "";
  // 카드(button) 안에도 들어가서 버튼 대신 span 탭
  const tabs = bv ? `<span class="seg scenseg" style="margin-top:6px;display:inline-flex"><span data-sm="now" class="${m0 === "now" ? "on" : ""}">${reg?.mode === "tight" ? "🔴 지금 (긴축·약세장)" : "지금 시장"}</span><span data-sm="bull" class="${m0 === "bull" ? "on" : ""}">🐂 강세장일 때</span></span>` : "";
  return `<div class="scen" onclick="event.stopPropagation()">
    <div class="chart-title" style="margin-top:12px"><b>① 앞으로 실적으로 본 적정주가</b> <span class="src">${baseOf(s.parts, "12MF")}</span></div>
    ${tabs}
    ${regLine}
    <div data-sm-box="now"${m0 === "now" ? "" : " hidden"}>${bar(s)}${scenBoxes(s, s.parts)}${partRows(s.parts)}${perAlt("tight")}${multHTML(s)}</div>
    ${bv ? `<div data-sm-box="bull"${m0 === "bull" ? "" : " hidden"}>${bar(bv)}${scenBoxes(bv, bparts)}${partRows(bparts)}${perAlt("easy")}<div class="note src">🐂 금리가 내려가 돈이 풀릴 때 · ${bparts.map((p) => `${p.kind} ${[p.mult.bear, p.mult.base, p.mult.bull].map((x) => n(x, p.kind === "PBR" ? 2 : 1)).join(" · ")}배`).join(" + ")} <span>(성장률 방식 = 기준 PER × 1.5 · 1.75 · 2, 업종·내가 정한 배수는 그 강세장 배수)</span></div></div>` : ""}
    ${s.y2 ? `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:6px">📅 ${esc(s.y2.label)} 기준 <span class="src">같은 배수 × ${baseOf(s.y2.parts, s.y2.label)}${c.notes?.y2?.length ? ` · 🗒 메모 ${c.notes.y2.length}` : ""}</span></summary>${scenBoxes(s.y2, s.y2.parts)}${notesHTML(c.notes?.y2, c, s.y2)}</details>` : ""}
    ${c.notes?.memo?.length ? `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:6px">🗒 증권사 메모 <span class="src">${c.notes.memo.length}개</span></summary>${notesHTML(c.notes.memo, c)}</details>` : ""}
    ${floorHTML(c)}
    ${growthHTML(c)}
  </div>`;
}
// 적정주가 '지금 시장 / 🐂 강세장일 때' 탭 (카드 안 버튼이라 상세로 넘어가지 않게)
document.addEventListener("click", (e) => {
  const b = e.target.closest(".scenseg [data-sm]"); if (!b) return;
  e.stopPropagation();
  const box = b.closest(".scen");
  box.querySelectorAll(".scenseg [data-sm]").forEach((x) => x.classList.toggle("on", x === b));
  box.querySelectorAll("[data-sm-box]").forEach((x) => { x.hidden = x.dataset.smBox !== b.dataset.sm; });
}, true);
// 배수를 어떻게 정했는지 한 줄 (성장률 / 업종 PER / 10년 밴드) — 하방·적정주가·상방 칸 아래, '28E 기준' 바로 위 (사용자 11/6 마지막 요청) · 35배 상한 노란 칸은 뺌
function multHTML(s) {
  const r = s.sa_ref, ref = r && (r["5y"] != null || r.sector != null)  // 시킹알파 같은 줄의 참고값
    ? ` <span style="opacity:.8">(참고: 이 종목 5년 평균 ${r["5y"] == null ? "-" : n(r["5y"], 1) + "%"} · 업종 중앙값 ${r.sector == null ? "-" : n(r.sector, 1) + "%"})</span>` : "";
  return (s.parts || []).map((p) => {
    const m = p.mult, d = p.kind === "PBR" ? 2 : 1;
    return `<div class="note src">📐 ${p.kind} ${n(m.bear, d)} · ${n(m.base, d)} · ${n(m.bull, d)}배 = ${esc(p.how || p.src)}${p.kind === "PER" && /성장률/.test(p.how || "") ? ref : ""}</div>`;
  }).join("");
}
// 배당주 점검 (리얼티 인컴 등): somong.yaml my.sa_div 에 적은 시킹알파 숫자
function divSaHTML(c) {
  const v = c.sa_div;
  if (!v) return "";
  const g = v.growth || {}, est = Object.entries(v.est || {}), P = (x) => (x == null ? "-" : n(x, 2) + "%");
  return `<div class="chart-title" style="margin-top:12px"><b>📬 배당 점검</b> <span class="src">시킹알파 ${esc(v.date || "")} 확인</span></div>
    <div class="kv">
      <div class="k">배당수익률 <span class="src">앞으로 1년 · 4년 평균 ${P(v.yield_avg4)}</span></div><div class="v">${P(v.yield_fwd)}</div>
      <div class="k">연간 배당 예상 <span class="src">컨센서스</span></div><div class="v">${est.map(([y, x]) => `${esc(String(y).slice(2))}E $${n(x, 2)}`).join(" → ")}</div>
      <div class="k">배당 성장률 <span class="src">1년 · 3년 · 5년 · 10년 (연평균)</span></div><div class="v">${[g.ttm, g.cagr3, g.cagr5, g.cagr10].map(P).join(" · ")}</div>
      <div class="k">연속 배당 인상</div><div class="v">${v.years == null ? "-" : n(v.years) + "년"}</div>
      <div class="k">AFFO 배당성향 <span class="src">번 돈(AFFO) 중 배당으로 주는 비율 · 앞으로 1년</span></div><div class="v">${P(v.affo_payout_fwd)}</div>
      <div class="k">AFFO 수익률 · 성장률 <span class="src">앞으로 1년</span></div><div class="v">${P(v.affo_yield_fwd)} · ${P(v.affo_growth_fwd)}</div>
    </div>${v.revisions_down ? `<div class="note src">최근 90일 올해 배당 추정 하향 ${n(v.revisions_down)}건${v.revisions_up != null ? ` · 상향 ${n(v.revisions_up)}건` : ""}</div>` : ""}`;
}
// 하방이 지금 가격보다 50% 넘게 높으면 경고 + 업종 PER 역사 · 네이버 업종 PER · 리레이팅 메모 (접어 둠)
function floorHTML(c) {
  const s = c.scen, ind = s.ind, sec = s.sector;
  const warn = s.bear > c.price * 1.5 ? `<div class="warnbox" style="margin-top:6px">⚠ 하방(Bear)이 지금 가격보다 ${pct((s.bear / c.price - 1) * 100, 0)} 높아요. 추정 EPS 가 너무 높거나 이익이 한 해 튄 건 아닌지 확인이 필요해요.</div>` : "";
  const out = [];
  if (sec && sec.bear != null) {
    out.push(`<div class="note src">🏷 ${esc(sec.name)} PER 역사 <span>(업종 대표값 · 12MF · 이 종목 PER 아님)</span>: 바닥 ${n(sec.bear, 1)} · 보통 ${n(sec.base, 1)} · 최고 ${n(sec.bull, 1)}배${sec.history ? ` — 근거 숫자: ${esc(sec.history)}` : ""}</div>`);
    // 사용자 11/6 '업종 PER 인지, 어떻게 계산된 건지 헷갈려' → 공식으로 계산한 평균이 아니라 위 근거 숫자를 보고 정한 세 단계
    out.push(`<div class="note src">📐 어떻게 정했나: 공식으로 계산한 평균이 아니에요. 증권사 리포트·기사에 나온 이 업종 회사들의 PER(12개월 선행)을 모아 보고 <b>바닥</b> = 업종이 가장 싸게 거래된 수준, <b>보통</b> = 평소 받는 범위, <b>최고</b> = 리레이팅 때 받아 본 수준으로 정한 값이에요 (2026-10-26 조사).${sec.basis ? `<br>→ ${esc(sec.basis)}` : ""}</div>`);
  }
  if (sec?.tight) out.push(`<div class="note">📏 적정주가에 쓰는 배수 (사용자 원칙): 🔴 긴축·약세장 <b>${sec.tight.map((x) => n(x, 1)).join(" · ")}배</b> · 🐂 강세장 <b>${(sec.easy || []).map((x) => n(x, 1)).join(" · ")}배</b> <span class="src">— 하락장엔 지금 PER 근처에서 보수적으로, 금리 인하·수급이 들어올 때 넓힘</span></div>`);
  (sec?.notes || []).forEach((x) => out.push(`<div class="note src">📝 ${esc(x.date)} ${esc(x.source)}: ${esc(x.text)}</div>`));
  if (ind && (ind.per || ind.peer_med)) out.push(`<div class="note src">🏭 네이버 업종 PER${ind.wics ? ` (WICS ${esc(ind.wics)})` : ""}: 최근 4분기 ${ind.per == null ? "-" : n(ind.per, 1) + "배"}${ind.peer_med ? ` · 같은 업종 ${ind.peers.length}곳 중앙값 <b>${n(ind.peer_med, 1)}배</b> (${ind.peers.filter((p) => p.per).map((p) => `${esc(p.name)} ${n(p.per, 1)}${p.fwd ? "" : "*"}`).join(" · ")})` : ""}${ind.peers.some((p) => p.per && !p.fwd) ? " <span>* 추정치 없어 현재 PER</span>" : ""}<br><span>↳ 최근 4분기 = 업종 전체가 지난 1년 실제로 번 이익 기준 PER (와이즈리포트) · 중앙값 = 네이버가 고른 같은 업종 회사들의 추정 PER 가운데 값 — 둘 다 매일 자동</span></div>`);
  if (s.rerating) out.push(`<div class="note src">🔁 리레이팅: ${esc(s.rerating)}</div>`);
  return warn + (out.length ? `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:6px">🏷 업종 PER · 리레이팅 메모</summary>${out.join("")}</details>` : "") + pbrMemoBox(c);
}
// 🏷 업종 PBR · 리레이팅 메모 (사용자 11/6: 업종 PER 메모처럼 — 이 종목 PBR 10년 하단·평균·상단 + 업종 PBR 하단·평균·상단) — PBR 종목만, 열 때 stocks/*.json 으로 계산
const pbrKey = (c) => c.scen?.sector?.name || c.industry;
const pbrMemoBox = (c) => ((c.methods || []).includes("PBR") && c.market !== "US" ? `<details class="fvt pbrmemo" data-code="${esc(c.code)}" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:6px">🏷 업종 PBR · 리레이팅 메모${c.scen?.ind?.pbr_med ? ` <span class="src">같은 업종 지금 ${n(c.scen.ind.pbr_med, 2)}배</span>` : ""}</summary><div class="pmb src">불러오는 중…</div></details>` : "");
document.addEventListener("toggle", async (e) => {
  const el = e.target;
  if (!el.classList?.contains("pbrmemo") || !el.open || el.dataset.done) return;
  el.dataset.done = 1;
  const c = DASH.stocks.find((x) => x.code === el.dataset.code) || {}, v = encodeURIComponent(DASH.updated_at);
  const mem = DASH.stocks.filter((x) => pbrKey(x) === pbrKey(c) && (x.methods || []).includes("PBR") && x.market !== "US" && !/우$/.test(x.name));
  try {
    const ds = await Promise.all(mem.map((x) => fetch(`data/stocks/${x.code}.json?v=${v}`).then((r) => r.json()).catch(() => null)));
    el.querySelector(".pmb").outerHTML = pbrMemoHTML(c, ds.filter((d) => d?.bands?.PBR?.mult?.length));
  } catch (_) { el.querySelector(".pmb").textContent = "자료를 못 불러왔어요"; }
}, true);
function pbrStats(dates, mult) {  // 10년 주간 PBR → 가장 낮음 · 하위 10% · 평균 · 상위 10% · 가장 높음 (compute.py stats 와 같은 잣대)
  const cut = `${+dates.at(-1).slice(0, 4) - 10}${dates.at(-1).slice(4)}`, v = mult.filter((m, i) => m > 0 && dates[i] >= cut).sort((a, b) => a - b);
  if (v.length < 20) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.floor((p / 100) * (v.length - 1)))];
  return { min: v[0], low: q(10), avg: v.reduce((a, b) => a + b, 0) / v.length, high: q(90), max: v.at(-1), from: dates.find((d) => d >= cut), cur: [...mult].reverse().find((m) => m > 0), n: v.length };
}
function pbrMemoHTML(c, ds) {
  const me = ds.find((d) => d.code === c.code), f = (x) => (x == null ? "-" : n(x, 2) + "배");
  const row = (nm, st, b) => (st ? `<tr><td style="text-align:left">${b ? `<b>${nm}</b>` : nm}</td><td>${f(st.low)}</td><td><b>${f(st.avg)}</b></td><td>${f(st.high)}</td><td><b>${f(st.cur)}</b></td></tr>` : "");
  const span = (nm, st) => (st ? `${nm} ${n(st.min, 2)}~${n(st.max, 2)}배` : "");
  const own = me && pbrStats(me.bands.PBR.dates, me.bands.PBR.mult);
  // 업종 = 사이트가 추적하는 같은 업종 PBR 종목들의 주마다 평균 (현대차·기아 등)
  let sec = null;
  if (ds.length > 1) {
    const base = me || ds[0], maps = ds.map((d) => new Map(d.bands.PBR.dates.map((t, i) => [t, d.bands.PBR.mult[i]])));
    const avg = base.bands.PBR.dates.map((t) => { const xs = maps.map((m) => m.get(t)).filter((x) => x > 0); return xs.length === ds.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; });
    sec = pbrStats(base.bands.PBR.dates, avg.map((x) => x ?? 0));
  }
  const ind = c.scen?.ind, ps = c.scen?.pbr_sec, key = pbrKey(c);
  const where = own ? (own.cur <= own.low ? "10년 하단(하위 10%) 아래 — 가장 싼 쪽" : own.cur >= own.high ? "10년 상단(상위 10%) 위 — 가장 비싼 쪽" : own.cur < own.avg ? "10년 평균 아래" : "10년 평균 위") : "";
  return `${own ? `<div class="note" style="margin-top:4px">지금 ${esc(c.name)} PBR <b>${f(own.cur)}</b> → ${where}${sec ? ` · ${esc(key)} 업종(추적 ${ds.length}곳 평균) 지금 ${f(sec.cur)}, 업종 평균 ${f(sec.avg)}` : ""}</div>` : ""}
    <div class="tbl-wrap"><table class="compact" style="width:100%;margin-top:4px"><thead><tr><th style="text-align:left">10년 PBR</th><th>하단</th><th>평균</th><th>상단</th><th>지금</th></tr></thead><tbody>
      ${row(esc(c.name), own, true)}${sec ? row(`${esc(key)} 업종`, sec) : ""}
      ${ds.filter((d) => d.code !== c.code).map((d) => row(`<span class="src">${esc(d.name)}</span>`, pbrStats(d.bands.PBR.dates, d.bands.PBR.mult))).join("")}</tbody></table></div>
    <div class="note src">가장 낮음~가장 높음: ${[span(esc(c.name), own), span(`${esc(key)} 업종`, sec)].filter(Boolean).join(" · ")} · 하단 = 10년 중 아래 10% 자리 · 상단 = 위 10% 자리 · ${sec ? `업종 = 사이트가 추적하는 ${ds.map((d) => esc(d.name)).join("·")} 의 주마다 평균 · ` : ""}PBR = 주가 ÷ 그때 기준 1년 뒤 BPS (주간, ${esc((own || sec)?.from?.slice(0, 4) || "")}년~) · 위 카드의 12MF PBR 과 기준이 달라요${ds.length < 2 ? ` · ${esc(key)} 업종은 사이트가 이 종목만 추적해서 업종 줄이 없어요` : ""}</div>
    ${ind?.pbr_med ? `<div class="note">🏭 지금 같은 업종 PBR${ind.wics ? ` (WICS ${esc(ind.wics)})` : ""}: ${ind.peers.filter((p) => p.pbr > 0).length}곳 중앙값 <b>${n(ind.pbr_med, 2)}배</b>${ind.pbr_own ? ` · ${esc(c.name)} ${n(ind.pbr_own, 2)}배 (${pct((ind.pbr_own / ind.pbr_med - 1) * 100, 0, true)})` : ""}
      <span class="src">(${ind.peers.filter((p) => p.pbr > 0).map((p) => `${esc(p.name)} ${n(p.pbr, 2)}`).join(" · ")}) · 네이버, 지난 결산 BPS 기준</span></div>` : ""}
    ${ps?.history ? `<div class="note src">📰 ${esc(ps.name || key)} PBR 역사 (리포트·기사): ${esc(ps.history)}</div>` : ""}
    ${ps?.rerating ? `<div class="note src">🔁 PBR 리레이팅: ${esc(ps.rerating)}</div>` : ""}
    ${(ps?.links || []).length ? `<div class="note src">출처: ${ps.links.map((l) => `<a href="${esc(l.u)}" target="_blank" rel="noopener">${esc(l.t)}</a>`).join(" · ")}</div>` : ""}
    <div class="kidbox" style="margin-top:6px">🐣 PBR 은 '회사 순자산의 몇 배에 거래되나'예요. 이 종목과 같은 업종의 지난 10년 하단·평균·상단을 나란히 보면, 지금이 업종보다 싼지·비싼지와 역사적으로 어디쯤인지 같이 볼 수 있어요.</div>`;
}
// 성장률 방식 (내 엑셀 '소몽의 적정주가 템플릿'): 기준 PER = 성장률 · 업종 중앙값 · 업종 바닥 중 가장 낮은 값 × 1 · 1.25 · 1.5 (사용자 11/6)
function growthHTML(c) {
  const g = c.scen?.growth;
  if (!g) return "";
  const usd = c.currency === "USD";
  const fmtE = (v) => (v == null ? "-" : usd ? n(v, 2) : n(v));
  const fmtP = (v) => (v == null ? "-" : usd ? "$" + n(v, 0) : n(v));
  const e27 = c.scen.e27, alt = c.scen.alt;
  const warn = alt ? `<div class="warnbox" style="margin-top:6px">⚠ 과거 성장률과 앞으로 예상 성장률이 2배 넘게 달라요. 다른 쪽(${n(alt.g, 1)}%)으로 계산하면
    Bear ${fmtP(alt.bear)} · <b>Base ${fmtP(alt.base)}</b> (${pct((alt.base / c.price - 1) * 100, 0, true)}) · Bull ${fmtP(alt.bull)}</div>` : "";
  return `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:6px">🔎 성장률 계산 자세히 <span class="src">출처 · 연도별</span>${alt ? ' <span class="pill yellow">⚠ 성장률 차이 큼</span>' : ""}${saDue(c) ? ' <span class="pill red">🔴 시킹알파 갱신 필요</span>' : ""}</summary>${warn}
    ${waysHTML(c, fmtP)}
    <div class="note">쓴 성장률: <b>${esc(g.src)}</b></div>
    <div class="note">기본값(${esc(g.window)} EPS 성장률 중앙값) <b>${g.median == null ? "-" : n(g.median, 1) + "%"}</b> · 보정값 ${g.adj == null ? "-" : `<b>${n(g.adj, 1)}%</b> <span class="src">${esc(g.adj_src || "")}</span>`}</div>
    <div class="tbl-wrap"><table class="compact" style="margin-top:6px"><thead><tr><th style="text-align:left">EPS</th>${g.years.map((y) => `<th>${esc(y)}</th>`).join("")}</tr></thead><tbody>
      <tr><td>EPS</td>${g.eps.map((v) => `<td>${fmtE(v)}</td>`).join("")}</tr>
      <tr><td>성장률</td>${g.yoy.map((v) => `<td class="${v != null && v < 0 ? "dear" : ""}">${v == null ? "-" : n(v, 0) + "%"}</td>`).join("")}</tr></tbody></table></div>
    <table class="compact" style="width:100%;margin-top:6px"><thead><tr><th style="text-align:left">적정 PER</th><th>배수</th><th>× 12MF EPS</th>${e27 ? "<th>× 27E EPS</th>" : ""}</tr></thead><tbody>
      ${[["Bear 하방 (기준 × 1)", "bear"], ["Base 적정주가 (× 1.25)", "base"], ["Bull 상방 (× 1.5)", "bull"]].map(([l, k]) => `<tr><td>${l}</td><td style="text-align:right">${n(g.mult[k], 1)}배${g.raw && g.raw[k] !== g.mult[k] ? `<br><span class="src">성장률로는 ${n(g.raw[k], 1)}</span>` : ""}</td>
        <td style="text-align:right"><b>${fmtP(c.scen[k])}</b></td>${e27 ? `<td style="text-align:right">${fmtP(e27[k])}</td>` : ""}</tr>`).join("")}</tbody></table>
    ${c.eps_srcs && Object.keys(c.eps_srcs).length ? `<div class="chart-title" style="margin-top:8px"><b>EPS 추정치 출처</b> <span class="src">시킹알파(유료) 대신 받을 수 있는 출처들의 평균을 써요</span></div>
      <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">연도</th>${["야후", "나스닥", "Finviz", "평균"].map((k) => `<th>${k}</th>`).join("")}</tr></thead><tbody>
      ${Object.entries(c.eps_srcs).map(([y, s]) => `<tr><td>${esc(y)}${s.note ? " ⚠" : ""}</td>${["야후", "나스닥", "Finviz", "평균"].map((k) => `<td${k === "평균" ? ' style="font-weight:700"' : ""}>${s[k] == null ? "-" : n(s[k], 2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${Object.values(c.eps_srcs).some((s) => s.note) ? `<div class="note src">⚠ = 출처끼리 15% 넘게 달라서 평균 대신 야후 값을 썼어요 (일회성 이익 포함 여부 등 기준 차이)</div>` : ""}` : ""}
    <div class="note src">기준 PER = 성장률(13% → 13배) · 같은 업종 중앙값 · 업종 바닥 중 가장 낮은(보수적인) 값 → 하방 × 1 · 적정주가 × 1.25 · 상방 × 1.5 (지금 긴축·약세장) · 🐂 강세장 칸은 × 1.5 · 1.75 · 2 (사용자 원칙 11/6) · 한국은 컨센서스 3년 영업이익 성장률(해마다 성장률 평균), 미국은 3~5년 EPS 성장률 · 성장률로 잡은 하방이 지금 가격보다 50% 넘게 높으면 성장률이 너무 센 것이라 업종 PER(없으면 이 종목 PER 밴드) · PER·PBR 을 같이 보는 종목은 PBR 밴드 값과 평균</div>
  </details>`;
}
// ④ 내가 정한 PER: 12MF EPS × 내 PER = 적정주가 · 기준 PER 대비 몇 배인지 (하방 ×1 · 적정 ×1.25 · 상방 ×1.5 · 강세장 ×2 와 같은 잣대)
const MYPER = {};
const myPerGet = (code) => { try { const v = parseFloat(localStorage.getItem("myper:" + code)); return v > 0 ? v : null; } catch (_) { return null; } };
function myPerOut(code, per) {
  const m = MYPER[code];
  if (!m || !(per > 0) || !m.e12) return '<span class="src">숫자를 넣으면 적정주가가 나와요</span>';
  const v = m.e12 * per, k = m.g > 0 ? per / m.g : null;
  return `<b>${m.fmtP(v)}</b> <em class="${v >= m.price ? "up" : "dn"}">${pct((v / m.price - 1) * 100, 0, true)}</em>${k ? `<div class="src">기준 PER ${n(m.g, 1)}배의 ${n(k, 2)}배 — ${k < 1 ? "하방(×1)보다 낮음" : k <= 1.25 ? "하방 ×1 ~ 적정 ×1.25 사이" : k <= 1.5 ? "적정 ×1.25 ~ 상방 ×1.5 사이" : k <= 2 ? "🐂 강세장 범위 (×1.5 ~ 2)" : "강세장 ×2 보다 높음"}</div>` : ""}`;
}
document.addEventListener("input", (e) => {
  const t = e.target;
  if (!t.matches?.(".myper")) return;
  const v = parseFloat(t.value), code = t.dataset.code;
  try { if (v > 0) localStorage.setItem("myper:" + code, String(v)); else localStorage.removeItem("myper:" + code); } catch (_) { /* 저장 못 해도 계산은 보여 줌 */ }
  t.closest("tr").querySelector(".myper-out").innerHTML = myPerOut(code, v);
});
// 내 엑셀의 적정주가 방법 4가지를 나란히: ① 기본값 ② 보정값 ③ Finviz (성장률 × 1 / 1.25 / 1.5, 업종과 비교 전) ④ 내가 정한 PER (칸에 입력 · 없으면 somong.yaml my.my_per)
function waysHTML(c, fmtP) {
  const w = c.scen?.ways, e12 = c.scen?.e12;
  if (!w || !e12) return "";
  const my = smData(c)?.my || {};
  const up = (v) => (v == null ? "" : ` <em class="${v >= c.price ? "up" : "dn"}">${pct((v / c.price - 1) * 100, 0, true)}</em>`);
  const rows = w.map((x, i) => `<tr${x.used ? ' style="font-weight:700"' : ""}><td style="text-align:left">${"①②③"[i]} ${esc(x.name)}${x.used ? " ✔" : ""}<div class="src">${esc(x.src)}</div></td>
    <td>${x.g == null ? "-" : n(x.g, 1) + "%"}</td>${["bear", "base", "bull"].map((k) => `<td>${x[k] == null ? "-" : fmtP(x[k]) + up(x[k])}</td>`).join("")}</tr>`).join("");
  // ④ 칸에 숫자만 넣으면 바로 계산 (사용자 2026-11-03: 깃허브 편집은 어려움) — 이 기기 브라우저에 저장, 비어 있으면 somong.yaml my_per · EPS 가 바뀌면 저절로 다시 계산
  MYPER[c.code] = { e12, price: c.price, g: c.scen.growth?.x ?? w.find((x) => x.used)?.g, fmtP };
  const per = myPerGet(c.code) ?? my.my_per ?? null;
  const mine = `<tr><td style="text-align:left">④ 내가 정한 PER<div class="src">${my.my_per_note ? `${esc(my.my_per_note)} · ` : ""}칸에 숫자만 넣으면 바로 계산 (이 휴대폰에 저장)</div></td>
    <td><input type="number" inputmode="decimal" min="0" step="0.5" class="myper" data-code="${esc(c.code)}" value="${per ?? ""}" placeholder="예: 20" aria-label="내가 정한 PER" onclick="event.stopPropagation()"> 배</td>
    <td colspan="3" class="myper-out" style="text-align:left">${myPerOut(c.code, per)}</td></tr>`;
  const sa = (c.scen.ltg_cmp || [])[0]?.[1];
  const cmp = (c.scen.ltg_cmp || []).length ? `<div class="note">3~5년 EPS 성장률 출처 비교: ${c.scen.ltg_cmp.map(([k, v], i) => `${esc(k)} <b>${v == null ? "-" : n(v, 1) + "%"}</b>${i && v != null && sa != null ? ` <span class="src">(시킹알파와 ${v - sa >= 0 ? "+" : ""}${n(v - sa, 1)}%p)</span>` : ""}`).join(" · ")}</div>` : "";
  const age = saAge(c);
  const stale = c.scen.ltg_cmp ? (sa == null ? `<div class="warnbox" style="margin-top:6px">⚠ <b>시킹알파 값이 비어 있어요.</b> 시킹알파 → ${esc(c.code)} → Growth 탭 'EPS FWD Long Term Growth (3-5Y CAGR)' 숫자를 config/somong.yaml 의 sa_ltg 에 적어 주세요.</div>`
    : saDue(c) ? `<div class="warnbox" style="margin-top:6px;border-color:var(--bad);background:var(--bad-bg)">🔴 <b>시킹알파 값 갱신 필요!</b> 마지막 확인 ${esc(c.scen.sa_date)} (${age}일 전 · ${esc(saDue(c))}) — 실적 발표 뒤 바뀌었을 수 있으니 Growth 탭에서 다시 확인해 주세요.${(c.scen.ways || []).some((w) => w.name === "보정값" && /대체/.test(w.src)) ? " 그동안은 평소 시킹알파와 가장 가까웠던 출처로 대신 계산하고 있어요." : ""}</div>`
    : `<div class="note src">시킹알파 값 확인일 ${esc(c.scen.sa_date || "-")} (${age ?? "-"}일 전) · 90일이 지나면 빨간 표시로 갱신하라고 알려줘요</div>`) : "";
  return `${stale}<div class="chart-title" style="margin-top:8px"><b>적정주가 4가지 비교</b> <span class="src">12MF EPS ${fmtP(e12)} 기준 · ✔ = 위 Bear/Base/Bull 에 쓴 방법 · 성장률만으로 계산한 값 (업종 중앙값·바닥과 비교 전)${(c.scen.parts || []).length > 1 ? " (위 값은 PBR 밴드와 평균이라 다를 수 있어요)" : ""}</span></div>
    <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">방법</th><th>성장률</th><th>Bear ×1</th><th>Base ×1.25</th><th>Bull ×1.5</th></tr></thead><tbody>${rows}${mine}</tbody></table></div>${cmp}${c.scen.ltg_note ? `<div class="note src">${esc(c.scen.ltg_note)}</div>` : ""}`;
}
// 시킹알파 3-5Y 성장률을 마지막으로 확인한 뒤 지난 날 수 (직접 입력값이라 분기마다 갱신 필요)
function saAge(c) {
  const d = c.scen?.sa_date || c.sa_div?.date;
  return d ? Math.floor((Date.now() - new Date(d + "T00:00:00+09:00")) / 864e5) : null;
}
// 📬 시킹알파 값을 다시 받아야 할 때 (사용자가 올려 줌): 값 없음 · 확인한 뒤 실적 발표(2일 지나 — 애널리스트 추정이 바뀔 시간) · 90일 지남
function saDue(c) {
  if (!c.scen?.ltg_cmp && !c.sa_div) return "";
  const sd = c.scen?.sa_date || c.sa_div?.date, kd = c.kq_date, age = saAge(c);
  if (!sd || (c.scen?.ltg_cmp && c.scen.ltg_cmp[0][1] == null && !c.sa_div)) return "값 없음";
  if (kd && kd > sd && Date.now() - new Date(kd + "T00:00:00+09:00") > 2 * 864e5) return `${kd.slice(5).replace("-", "/")} 실적 발표 뒤 아직`;
  return age > 90 ? `${age}일 지남` : "";
}
function saAlertHTML() {  // 🇺🇸 보유 탭 맨 위
  if (MKT !== "US") return "";
  const L = DASH.stocks.filter((c) => mktOf(c.code) === "US" && saDue(c));
  if (!L.length) return "";
  return `<div class="warnbox" style="margin-top:12px">📬 <b>시킹알파 숫자 올려 주세요</b> (${L.length}종목) <span class="src">실적 발표 뒤 2일이 지났거나 · 값이 없거나 · 90일 지난 종목</span>
    <div style="margin-top:4px">${L.map((c) => `<a href="https://seekingalpha.com/symbol/${encodeURIComponent(c.code)}${c.sa_div ? "" : "/growth"}" target="_blank" rel="noopener">${esc(c.name)}</a> <span class="src">${esc(saDue(c))}</span>`).join(" · ")}</div>
    <div class="src" style="margin-top:4px">Growth 탭 'EPS FWD Long Term Growth (3-5Y CAGR)' 줄(배당주는 Dividends 탭)을 캡처해 채팅에 올려 주시면 config/somong.yaml 에 적어 둘게요</div></div>`;
}
// 미국: 내 엑셀 '소몽의 적정주가 템플릿' (성장률 × 100~200 = 적정 PER, × 올해 EPS)
function somongHTML(c) {
  const s = c.us_tpl?.somong;
  if (!s) return "";
  const $f = (v) => (v == null ? "-" : "$" + n(v, 0));
  const up = (v) => (v == null ? "-" : `<b class="${v >= 0 ? "up" : "dn"}">${pct(v, 0, true)}</b>`);
  const box = (title, k, note) => {
    const x = s[k];
    if (!x) return `<div class="note">${title}: 계산할 수 없어요 (성장률이 0 이하이거나 EPS 가 없음)</div>`;
    return `<div class="tpl"><div class="tpl-t">${title} <span class="src">성장률 ${n(x.growth, 1)}% ${note}</span></div>
      <table class="compact" style="width:100%"><thead><tr><th style="text-align:left"></th><th>적정 PER</th><th>적정주가</th></tr></thead><tbody>
      <tr><td>보통 (성장률 × 100~200)</td><td>${n(x.mult.base_lo, 0)}~${n(x.mult.base_hi, 0)}배</td><td>${$f(x.price.base_lo)}~${$f(x.price.base_hi)}</td></tr>
      <tr><td>강세장 (× 150~250)</td><td>${n(x.mult.bull_lo, 0)}~${n(x.mult.bull_hi, 0)}배</td><td>${$f(x.price.bull_lo)}~${$f(x.price.bull_hi)}</td></tr></tbody></table>
      <div class="note">목표주가 보수 ${$f(x.price.base_hi)} (${up(x.up_cons)}) · 강세 ${$f(x.price.bull_hi)} (${up(x.up_bull)})</div></div>`;
  };
  return `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:10px">🔭 3년 뒤 주가 가정 <span class="src">${esc(c.us_tpl.per_grid?.year || "28E")} EPS × PER 20~110배 · 지금 PER ${n(s.cur_mult, 1)}배</span></summary>
    ${c.us_tpl.finviz_5y != null ? `<div class="note">Finviz EPS next 5Y <b>${n(c.us_tpl.finviz_5y, 1)}%</b> <span class="src">(적정 PER 계산의 보정값 후보)</span></div>` : ""}
    ${(c.us_tpl.per_grid?.rows || []).length ? `<div class="tpl"><div class="tpl-t">${esc(c.us_tpl.per_grid.year)}(3년 뒤) 주가 가정 <span class="src">${esc(c.us_tpl.per_grid.year)} EPS $${n(c.us_tpl.per_grid.eps, 2)} × PER</span></div>
      <div class="pergrid">${c.us_tpl.per_grid.rows.map(([m, p]) => `<div><span>${m}배</span><b>${$f(p)}</b><em class="${p >= c.price ? "up" : "dn"}">${pct((p / c.price - 1) * 100, 0, true)}</em></div>`).join("")}</div></div>` : ""}
    <div class="note src">내 엑셀 '28년(3년 뒤) 주가 가정, PER 밴드 활용' 표 · 상승여력이 마이너스면 미래 성장을 이미 주가에 먼저 반영했거나 월가 예상이 보수적인 경우</div>
  </details>`;
}
// 내 엑셀 '소몽의 주가 판독기' (24.8.28): 4가지를 1~5점으로 매겨 평균 → 바늘 게이지 (1 공포 … 5 광기)
const MOOD = ["공포", "불안", "중립", "과열", "광기"];
const MOOD_ACT = ["역발상 매수(장기)", "분할 매수", "매매 보류", "매도 준비", "분할 매도"]; // 내 엑셀 '매매 판단' 표
const MOOD_COLORS = ["#2a78d6", "#5fb3e8", "#9aa0a6", "#f0a24a", "#d9442b"];
function readerScores(c) {
  const up = (th, v) => (v == null ? null : th.findIndex((x) => v < x) + 1 || th.length + 1); // 구간 → 1~5
  const mkt = DASH.signals?.us?.per;
  const t = c.us_tpl?.tipranks;
  const upside = t && t.avg ? (t.avg / c.price - 1) * 100 : null;
  return [
    ["시장 12MF P/E", mkt, up([15, 16, 18, 19], mkt), `S&P500 · ~15 공포 · 15~16 불안 · 16~18 중립 · 18~19 과열 · 19~ 광기`, `${n(mkt, 1)}배`],
    ["종목 12MF P/E", c.fwd_per, up([10, 20, 30, 50], c.fwd_per), `~10 공포 · 10~20 불안 · 20~30 중립 · 30~50 과열 · 50~ 광기`, `${n(c.fwd_per, 1)}배`],
    ["목표주가 상승여력", upside, upside == null ? null : 6 - up([0, 5, 10, 20], upside), `TipRanks 평균 $${n(t?.avg, 0)} 대비 · 20%~ 공포 · 10~20 불안 · 5~10 중립 · 0~5 과열 · 0% 미만 광기`, pct(upside, 0, true)],
    ["PEG", c.tbl?.peg, up([1, 1.5, 2, 2.5], c.tbl?.peg), `~1 공포 · 1~1.5 불안 · 1.5~2 중립 · 2~2.5 과열 · 2.5~ 광기`, n(c.tbl?.peg, 2)],
  ];
}
function readerHTML(c) {
  if (c.market !== "US") return "";
  const sc = readerScores(c), got = sc.filter((x) => x[2] != null);
  if (got.length < 2) return "";
  const avg = got.reduce((a, x) => a + x[2], 0) / got.length;
  return `<div class="tpl" onclick="event.stopPropagation()"><div class="tpl-t">🧭 주가 판독기 <span class="src">내 엑셀 템플릿 · 4가지 점수 평균</span></div>
    <div class="gauge"><div class="gauge-c"><canvas id="gg-${esc(c.code)}" data-v="${avg}"></canvas></div><div class="gauge-v"><b style="color:${MOOD_COLORS[Math.round(avg) - 1]}">${MOOD[Math.round(avg) - 1]}</b><span>${n(avg, 1)} / 5</span></div></div>
    <div class="moodact">내 엑셀 '매매 판단' 표 기준: <b style="color:${MOOD_COLORS[Math.round(avg) - 1]}">${MOOD[Math.round(avg) - 1]} = ${MOOD_ACT[Math.round(avg) - 1]}</b>
      <div class="src">공포 → 역발상 매수(장기) · 불안 → 분할 매수 · 중립 → 매매 보류 · 과열 → 매도 준비 · 광기 → 분할 매도 <br>(내가 정해 둔 원칙을 보여주는 것이고, 이 사이트의 추천은 아니에요)</div></div>
    <table class="compact" style="width:100%">${sc.map(([lab, , s, why, val]) => `<tr><td>${lab} <b class="rv">${esc(val)}</b><br><span class="src">${esc(why)}</span></td>
      <td style="text-align:right;white-space:nowrap">${s == null ? "-" : `<b style="color:${MOOD_COLORS[s - 1]}">${s} ${MOOD[s - 1]}</b>`}</td></tr>`).join("")}</table></div>`;
}
const needle = { id: "needle", afterDatasetsDraw(ch) {
  const v = +ch.canvas.dataset.v, m = ch.getDatasetMeta(0).data[0];
  if (!m || !v) return;
  const a = Math.PI + ((v - 0.5) / 5) * Math.PI, r = m.outerRadius * 0.95, g = ch.ctx;
  g.save(); g.translate(m.x, m.y); g.rotate(a); g.fillStyle = css("--ink");
  g.beginPath(); g.moveTo(0, -4); g.lineTo(r, 0); g.lineTo(0, 4); g.fill();
  g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill(); g.restore();
} };
function drawGauges(list) {
  for (const c of list) {
    const cv = document.getElementById(`gg-${c.code}`);
    if (!cv) continue;
    if (charts.has(cv.id)) charts.get(cv.id).destroy();
    charts.set(cv.id, new Chart(cv, { type: "doughnut", plugins: [needle],
      data: { labels: MOOD, datasets: [{ data: [1, 1, 1, 1, 1], backgroundColor: MOOD_COLORS, borderWidth: 2, borderColor: css("--surface") }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, rotation: -90, circumference: 180, cutout: "62%",
        plugins: { legend: { display: false }, tooltip: { enabled: false } } } }));
  }
}

// 🏦 월가 의견: 증권사 의견·목표주가 변경 (야후) + 에테르 텔레그램 리서치 채널 글
function streetHTML(c) {
  const st = c.us_tpl?.street;
  if (!st || (!st.ratings && !(st.posts || []).length)) return "";
  const r = st.ratings, s = r?.summary;
  const actCls = { 상향: "up", 하향: "dn", 신규: "", 유지: "", 재확인: "" };
  const tbl = r && r.rows.length ? `<table class="compact" style="width:100%;margin-top:6px"><thead><tr><th style="text-align:left">날짜 · 증권사</th><th>의견</th><th>목표가</th></tr></thead><tbody>
    ${r.rows.slice(0, 12).map((x) => `<tr><td>${esc(x.date.slice(5))} <b>${esc(x.firm)}</b></td>
      <td style="text-align:right"><span class="${actCls[x.action] || ""}">${esc(x.action)}</span> ${x.from && x.from !== x.to ? `${esc(x.from)}→` : ""}${esc(x.to)}</td>
      <td style="text-align:right;white-space:nowrap">${x.pt == null ? "-" : `${x.prior && x.prior !== x.pt ? `$${n(x.prior)}→` : ""}<b class="${x.pt_action === "올림" ? "up" : x.pt_action === "내림" ? "dn" : ""}">$${n(x.pt)}</b>`}</td></tr>`).join("")}</tbody></table>` : "";
  const posts = (st.posts || []).map((p) => `<details class="post"><summary>${p.new ? '<span class="pill green">🆕</span> ' : ""}<span class="src">${esc(p.date)} · ${esc(p.ch || "에테르")}${(p.also || []).length ? ` (${esc(p.also.join("·"))}에도 같은 내용)` : ""}</span> ${esc(p.title)}</summary>
    <div class="pq-b" style="white-space:pre-line">${esc(p.excerpt)}${p.excerpt.length >= 600 ? "…" : ""}</div><a href="${esc(p.url)}" target="_blank" rel="noopener">원문 보기 →</a></details>`).join("");
  const latest = (st.posts || [])[0];
  return `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:10px">🏦 월가 의견
      ${s ? `<span class="src">최근 ${r.days}일: 의견 상향 <b class="up">${s.up}</b> · 하향 <b class="dn">${s.down}</b> · 목표가 올림 <b class="up">${s.raise}</b> · 내림 <b class="dn">${s.lower}</b></span>` : ""}
      ${latest ? `<div class="src">📰 채널 최신 ${esc(latest.date.slice(5, 10))} (${esc(latest.ch || "에테르")}): ${esc(latest.title.slice(0, 50))}</div>` : ""}</summary>
    ${tbl}
    ${posts ? `<div class="chart-title" style="margin-top:10px"><b>📰 텔레그램 리서치 채널</b> <span class="src">에테르의 일본&미국 리서치 · 본루팡 · 펀디지(fundeasy_choi) · 이 종목이 나온 글, 여러 채널에 같은 내용은 하나만 · 🆕 = 지난 갱신 이후 새 글</span></div>${posts}` : ""}
    <div class="note src">의견 변경: 야후 파이낸스(증권사 발표 기록) · 채널 글은 앞부분만, 전체는 원문 링크에서 · 증권사 의견을 옮긴 것이고 이 사이트의 추천은 아니에요</div>
  </details>`;
}

// TipRanks 애널리스트 목표주가 (최근 3개월)
function tipranksHTML(c) {
  const t = c.us_tpl?.tipranks;
  if (!t || !t.avg) return "";
  const cell = (lab, v) => `<div><span>${lab}</span><b>$${n(v, 0)}</b><em class="${v >= c.price ? "up" : "dn"}">${pct((v / c.price - 1) * 100, 0, true)}</em></div>`;
  return `<div class="tpl" onclick="event.stopPropagation()"><div class="tpl-t">🎯 애널리스트 목표주가 <span class="src">TipRanks · 최근 3개월 · ${t.n ?? "-"}명</span></div>
    <div class="scen3" style="margin-top:6px">${cell("최저", t.low)}${cell("평균", t.avg)}${cell("최고", t.high)}</div>
    <div class="note">의견 수: 매수 ${t.buy ?? "-"} · 보유 ${t.hold ?? "-"} · 매도 ${t.sell ?? "-"} <span class="src">(애널리스트 의견을 옮긴 것, 이 사이트의 추천 아님)</span></div></div>`;
}
function stockCard(c) {
  const L = LIGHT[c.verdict] || LIGHT.na;
  const gap = c.gap == null ? "N/A" : pct(c.gap * 100, 0, true);
  const pos = c.band_pos;
  const pills = [];
  if (bondAlert(c)) pills.push(`<span class="pill red">⚠ 금리 대비 비쌈: 선행 PER ${times(c.fwd_per)} > ${esc(c.bond_label)} 환산 PER ${times(c.bond_per, 1)}</span>`);
  if (c.div_signal) pills.push(`<span class="pill ${c.div_signal === "na" ? "" : c.div_signal}">${LIGHT[c.div_signal]?.emoji || ""} 배당 ${pct(c.div_yield, 2)}</span>`);
  if (c.short_history) pills.push(`<span class="pill">📅 ${esc((c.band_start || "").slice(0, 4))}년부터 데이터 (10년 미만)</span>`);
  if (c.rerating_warning) pills.push(`<span class="pill yellow">⚠ 리레이팅 반영 가능성</span>`);
  if (c.new_orders) pills.push(`<span class="pill green">🆕 새 수주 공시 ${c.new_orders}건</span>`);
  if (c.insider?.major_sell) pills.push(`<span class="pill red">⚠ 대주주 장내매도 ${eok(c.insider.major_sell)} (3개월)</span>`);
  if (c.insider?.exec_sellers) pills.push(`<span class="pill red">⚠ ${c.insider.ceo_sell ? `대표이사 포함 ` : ""}임원 ${c.insider.exec_sellers}명 장내매도 ${eok(c.insider.exec_sell)} (3개월)</span>`);
  if (c.insider?.exec_buyers) pills.push(`<span class="pill green">👀 임원 ${c.insider.exec_buyers}명 장내매수 (3개월)</span>`);
  if (c.kq_new) pills.push(`<span class="pill green">🧾 ${esc(c.kq_new)} 실적 나옴</span>`);
  if (c.kq_wait) pills.push(`<span class="pill yellow">🧾 ${esc(c.kq_wait)} 잠정실적 공시 · 숫자 반영 대기</span>`);
  for (const x of c.holder_changes || []) {
    pills.push(`<span class="pill ${x.chg < 0 ? "red" : "green"}">👥 ${esc(x.name.replace("공단", ""))} 지분 ${x.chg < 0 ? "▼" : "▲"}${n(Math.abs(x.chg), 2)}%p (${esc(x.date.slice(5))})</span>`);
  }
  if ((c.checks || []).some((x) => x.warn)) pills.push(`<span class="pill yellow">⚠ 출처 간 EPS 차이 큼</span>`);
  for (const x of expNew(c.code)) pills.unshift(`<span class="pill red" data-go="expw" style="font-weight:700">‼️ ${EXPW_K[x.k].t} ${+x.r.ym.slice(5)}월 나옴 · 누르면 그래프</span>`);  // 가장 중요한 표시라 맨 앞
  const ac = accelOf(c), aw = ac && accVerd(ac.v[1], ac.v[2]);  // 🚀 내년 이익 증가율이 올해보다 높아지나 (accelHTML 과 같은 잣대)
  if (aw === 1 || aw === -1) pills.push(`<span class="pill ${aw === 1 ? "green" : "yellow"}">${ACC_E[aw + 1]} ${ac.b} 증가율 ${esc(ac.ys[1])} ${accVal(ac.v[1])} → ${esc(ac.ys[2])} ${accVal(ac.v[2])}</span>`);
  const newPosts = (c.us_tpl?.street?.posts || []).filter((p) => p.new).length;
  if (newPosts) pills.push(`<span class="pill green">🆕 채널 새 글 ${newPosts}개</span>`);
  if (c.dart_check?.warn) pills.push(`<span class="pill yellow">⚠ DART 공시와 숫자 차이</span>`);
  const m2 = c.chart?.ma200_state;  // 200일선: 다시 위로 올라왔거나(🔔) 아래에 있을 때만 표시
  if (m2?.cross_up) pills.push(`<span class="pill green">🔔 200일선 위로 다시 올라옴 (${esc(m2.cross_up.slice(5).replace("-", "/"))})</span>`);
  else if (m2 && m2.gap < 0) pills.push(`<span class="pill ${ma200Sig(m2) === "🔴" ? "red" : "yellow"}">${ma200Sig(m2)} 200일선 아래 ${pct(m2.gap, 1)} · 선 ${ma200Dir(m2)}</span>`);
  if (c.fcf?.length === 2 && (c.fcf[0][1] < 0 || c.fcf[1][1] < 0)) {  // 현금흐름이 마이너스이거나 막 플러스로 돌아선 종목만
    const [[, a], [q, b]] = c.fcf, [t, cls] = fcfTag(a, b);
    pills.push(`<span class="pill ${cls === "bad" ? "red" : cls ? "yellow" : "green"}">💸 현금흐름 ${t} ${qMoney(b, c.currency === "USD")} (${esc(q)})</span>`);
  }
  let mine = "";
  if (c.avg_price && c.quantity) {
    const r = (c.price / c.avg_price - 1) * 100;
    mine = `<div class="sub">내 평단 ${money(c.avg_price, c.currency)} · ${n(c.quantity)}주 · 수익률 ${pct(r, 1, true)}</div>`;
  }
  // 현재가에 적용된 12개월 선행 EPS·PER (PBR 종목은 BPS·PBR 도): 주가 = EPS × PER
  const pe = [];
  if (c.fwd_per > 0) pe.push(`12MF EPS ${money(c.price / c.fwd_per, c.currency)} × PER <b>${n(c.fwd_per, 1)}배</b>`);
  const pbr = (c.fwd_mult?.PBR || {})["12MF"];
  if (pbr > 0 && (c.methods || []).includes("PBR")) pe.push(`12MF BPS ${money(c.price / pbr, c.currency)} × PBR <b>${n(pbr, 2)}배</b>`);
  if (c.naver_per > 0) pe.push(`<span class="src">참고: 네이버 추정 PER (올해 ${String(new Date().getFullYear()).slice(2)}E 기준) ${n(c.naver_per, 2)}배</span>`);
  return `<button class="card stock" data-code="${esc(c.code)}" data-jump="${esc(c.code)}" data-jname="${esc(c.name)}">
    <div class="row1"><span class="name">${esc(c.name)}</span><span class="price">${money(c.price, c.currency)}</span></div>
    ${pe.map((x) => `<div class="pe">${x}</div>`).join("")}
    <div class="sub">시가총액 ${capTxt(c)} ${c.stale ? '<span class="stale">⚠ 직전 데이터</span>' : ""}</div>
    <div class="row2">${lamp(c.verdict)}<div>
      <div class="verdict ${c.verdict}">${L.stock}</div>
      <div class="why">${esc(c.why)}</div></div></div>
    ${c.scen ? scenHTML(c) : `<div class="kv">
      <div class="k">적정주가 <b>Base</b> <span class="src">${esc(c.fair_basis)}</span></div><div class="v">${money(c.fair, c.currency)}</div>
      <div class="k">괴리율 <span class="src nowrap">현재가 ÷ 적정가 − 1</span></div><div class="v">${gap}</div>
    </div>`}
    ${divSaHTML(c)}
    ${pbrFloorBox(c)}
    ${prefBox(c)}
    <div class="tgday" data-code="${esc(c.code)}" onclick="event.stopPropagation()">${tgDayHTML(c.code)}</div>
    ${tipranksHTML(c)}
    ${streetHTML(c)}
    ${readerHTML(c)}
    ${fairTableHTML(c)}
    ${somongHTML(c)}
    ${somongHTMLcard(c)}
    ${priceBox(c, 6, "span")}
    ${bandPosHTML(c, pos)}
    ${mine}
    <div class="pills">${pills.join("")}</div>
  </button>`;
}
// 🔀 우선주 괴리율 (사용자 11/6: 본주와의 괴리율로 바닥·과열 판단) = (보통주 − 우선주) ÷ 보통주 — 두 종목 주간 종가(배당 밴드와 같은 날짜, 2015년~)
const PREF_COMMON = { "005935": "005930" };
const prefBox = (c) => (PREF_COMMON[c.code] ? `<div class="prefgap" data-code="${esc(c.code)}" onclick="event.stopPropagation()"></div>` : "");
async function prefFill() {
  for (const el of document.querySelectorAll(".prefgap:not([data-done])")) {
    el.dataset.done = 1;
    const v = encodeURIComponent(DASH.updated_at);
    try {
      const [p, q] = await Promise.all([PREF_COMMON[el.dataset.code], el.dataset.code].map((k) => fetch(`data/stocks/${k}.json?v=${v}`).then((r) => r.json())));
      el.innerHTML = prefGapHTML(p, q);
    } catch (_) { el.innerHTML = ""; }
  }
}
function prefGapHTML(p, q) {
  const A = p.bands?.DIV || p.bands?.PER, B = q.bands?.DIV || q.bands?.PER;
  if (!A || !B || !(p.price > 0 && q.price > 0)) return "";
  const m = new Map(B.dates.map((d, i) => [d, B.price[i]]));
  const S = A.dates.map((d, i) => [d, A.price[i], m.get(d)]).filter(([, a, b]) => a > 0 && b > 0).map(([d, a, b]) => [d, (1 - b / a) * 100]);
  if (S.length < 52) return "";
  const now = (1 - q.price / p.price) * 100, dt = q.price_date || S.at(-1)[0];
  if (S.at(-1)[0] >= dt.slice(0, 10)) S.pop();
  S.push([dt.slice(0, 10), now]);
  const v = S.map((x) => x[1]), L = v.length - 1, avg = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - avg) ** 2, 0) / v.length), imin = v.indexOf(Math.min(...v)), imax = v.indexOf(Math.max(...v));
  const pos = (v.filter((x) => x < now).length / v.length) * 100;
  const y5 = S.filter((x) => x[0] >= `${+dt.slice(0, 4) - 5}${dt.slice(4, 10)}`).map((x) => x[1]), a5 = y5.reduce((a, b) => a + b, 0) / y5.length;
  const zone = pos >= 90 ? ["우선주 바닥권", "할인이 역사적으로 가장 넓은 쪽 — 우선주가 보통주보다 상대적으로 가장 싼 구간", "var(--good)"]
    : pos >= 70 ? ["우선주 싼 쪽", "할인이 평소보다 넓음 — 우선주가 상대적으로 싼 편", "var(--good)"]
    : pos > 30 ? ["보통", "할인이 평소 범위", "var(--ink)"]
    : pos > 10 ? ["우선주 비싼 쪽", "할인이 평소보다 좁음 — 우선주가 상대적으로 비싼 편", "var(--warn-ink)"]
    : ["우선주 과열권", "할인이 역사적으로 가장 좁은 쪽 — 우선주가 보통주를 바짝 따라붙은 구간", "var(--bad-ink)"];
  // 그림: 주간 괴리율 · 평균(점선) · 평균 ±1 표준편차(옅은 띠) · 가장 넓을 때·좁을 때·지금
  const W = 340, H = 170, x0 = 30, x1 = W - 56, top = 14, bot = H - 22, hi = Math.max(...v) * 1.08, lo = Math.min(0, Math.min(...v));
  const X = (i) => x0 + ((x1 - x0) * i) / L, Y = (y) => bot - ((y - lo) / (hi - lo)) * (bot - top);
  let g = `<rect x="${x0}" y="${Y(avg + sd)}" width="${x1 - x0}" height="${Y(avg - sd) - Y(avg + sd)}" fill="var(--s1)" opacity=".1"/>`;
  [0, 10, 20, 30, 40].filter((t) => t <= hi).forEach((t) => { g += `<line x1="${x0}" x2="${x1}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)"/><text x="${x0 - 3}" y="${Y(t) + 3}" text-anchor="end" class="qx">${t}%</text>`; });
  S.forEach(([d], i) => { if (i && d.slice(0, 4) !== S[i - 1][0].slice(0, 4) && +d.slice(2, 4) % 2 === 0) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" class="qx">${d.slice(0, 4)}</text>`; });
  g += `<line x1="${x0}" x2="${x1}" y1="${Y(avg)}" y2="${Y(avg)}" stroke="var(--muted)" stroke-dasharray="4 3"/><text x="${x1 + 4}" y="${Y(avg) + 3 + (Math.abs(Y(now) - Y(avg)) < 12 ? (Y(avg) >= Y(now) ? 9 : -9) : 0)}" class="qx">평균 ${n(avg, 0)}%</text>`;
  g += `<path d="${v.map((y, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join("")}" fill="none" stroke="var(--ink)" stroke-width="1.6"/>`;
  g += [[imax, "가장 넓음"], [imin, "가장 좁음"]].map(([i, t]) => `<circle cx="${X(i)}" cy="${Y(v[i])}" r="3" fill="var(--muted)"/><text x="${X(i) + (X(i) > W / 2 ? -5 : 5)}" y="${Y(v[i]) + (i === imax ? 4 : 13)}" text-anchor="${X(i) > W / 2 ? "end" : "start"}" class="qx">${t} ${n(v[i], 0)}% (${S[i][0].slice(2, 7).replace("-", ".")})</text>`).join("");
  g += `<circle cx="${X(L)}" cy="${Y(now)}" r="4.5" fill="${zone[2]}"/><text x="${x1 + 2}" y="${Y(now) + 3}" class="qx" style="font-weight:700">지금 ${n(now, 1)}%</text>`;
  g += tipCols(X, (x1 - x0) / L, top, bot, S.map(([d, y]) => `${d}\n괴리율 ${n(y, 1)}%`));
  return `<div class="chart-title" style="margin-top:14px"><b>🔀 보통주와 괴리율</b> <span class="src">(보통주 − 우선주) ÷ 보통주 · ${esc(S[0][0].slice(0, 4))}년~ 주간</span></div>
    <div class="kv"><div class="k">지금 괴리율 <span class="src">보통주 ${n(p.price)}원 · 우선주 ${n(q.price)}원</span></div><div class="v"><b style="color:${zone[2]}">${n(now, 1)}%</b></div>
      <div class="k">판단 <span class="src">${esc(S[0][0].slice(0, 4))}년~ ${n(v.length)}주 중 아래에서 ${n(pos, 0)}% 자리</span></div><div class="v"><b style="color:${zone[2]}">${zone[0]}</b></div></div>
    <div class="src">${zone[1]} · 평균 ${n(avg, 1)}% (최근 5년 ${n(a5, 1)}%) · 평균 ± 1표준편차 ${n(avg - sd, 1)} ~ ${n(avg + sd, 1)}% · 가장 넓을 때 ${n(v[imax], 1)}% (${esc(S[imax][0])}) · 가장 좁을 때 ${n(v[imin], 1)}% (${esc(S[imin][0])})</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="삼성전자 보통주·우선주 괴리율 추이" style="margin-top:4px">${g}</svg>
    <div class="kidbox" style="margin-top:6px">🐣 우선주는 회사 일에 투표할 권리가 없는 대신 배당을 조금 더 받는 주식이라 대개 보통주보다 싸게 거래돼요. 그 차이(괴리율)가 <b>평소보다 넓으면 우선주가 상대적으로 싸고(바닥 쪽)</b>, <b>좁으면 상대적으로 비싸요(과열 쪽)</b>. 지금은 ${n(now, 1)}%로 평균 ${n(avg, 0)}%보다 ${now >= avg ? "넓어요" : "좁아요"}.</div>
    <details class="fvt"><summary class="chart-title">📰 괴리율이 넓어지고 좁아지는 이유 <span class="src">기사 요약 · 눌러서 열기</span></summary>
      <ul class="irl"><li>넓어질 때: 코스피200·MSCI 같은 지수를 따라가는 ETF·패시브 자금이 보통주에만 들어와요 (26년 6월 34~36%, 5년 중 가장 넓음 — 평균 16.6%의 2배)</li>
        <li>좁아질 때: 배당 매력이 커지거나(금리 하락기) 자사주 소각·주주환원 기대가 우선주에도 퍼질 때 (20년 11월 10% 밑, 21년 6월 8.3%)</li>
        <li>21년 8.3% → 23년 14.2% → 24년 17.4% → 25년 18.5% 로 점점 넓어지는 흐름이었어요</li></ul>
      <div class="note src">출처: <a href="https://www.hankyung.com/article/2026062585451" target="_blank" rel="noopener">한국경제 26.6.25</a> · <a href="https://www.ajunews.com/view/20260614115554102" target="_blank" rel="noopener">아주경제 26.6.14</a> · <a href="https://mobile.newsis.com/view/NISX20260605_0003657504" target="_blank" rel="noopener">뉴시스 26.6.5</a> · <a href="https://newstomato.com/ReadNews.aspx?no=1008443" target="_blank" rel="noopener">뉴스토마토 20.11</a> · 사이트 계산은 주간 종가라 기사 숫자와 조금 달라요 · 참고용 (매수·매도 추천 아님)</div></details>`;
}
// 🧱 PBR 바닥 기록 (사용자 11/6: 삼성전자 PBR 이 어디까지 떨어져서 지지했나, 닫아 둠) — PBR 로 매기는 종목 모두, 열 때 stocks/{코드}.json 주간 PBR 로 계산
const pbrFloorBox = (c) => ((c.methods || []).includes("PBR") && c.market !== "US" ? `<details class="fvt pbrfloor" data-code="${esc(c.code)}" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:6px">🧱 PBR 바닥 기록 <span class="src">어디까지 떨어져서 버텼나 · 눌러서 열기</span></summary><div class="pfb src">불러오는 중…</div></details>` : "");
document.addEventListener("toggle", async (e) => {
  const el = e.target;
  if (!el.classList?.contains("pbrfloor") || !el.open || el.dataset.done) return;
  el.dataset.done = 1;
  try {
    const v = encodeURIComponent(DASH.updated_at), d = await (await fetch(`data/stocks/${el.dataset.code}.json?v=${v}`)).json();
    if (!PBR) { try { PBR = await (await fetch("data/pbr_watch.json?v=" + v)).json(); } catch (_) { /* 들은 기준 줄만 빠짐 */ } }
    el.querySelector(".pfb").outerHTML = pbrFloorHTML(d, DASH.stocks.find((x) => x.code === el.dataset.code) || {});
  } catch (_) { el.querySelector(".pfb").textContent = "자료를 못 불러왔어요"; }
}, true);
function pbrFloors(m, W = 26) {  // 좌우 26주(반년) 안에서 가장 낮고, 그 뒤 반년 안에 15% 넘게 오른 주 = 지지한 바닥 (최근 13주는 아직 확정 아님)
  const out = [];
  for (let i = 0; i < m.length - 13; i++) {
    if (!(m[i] > 0)) continue;
    const win = m.slice(Math.max(0, i - W), i + W + 1).filter((x) => x > 0);
    if (m[i] > Math.min(...win) || out.some((j) => i - j <= W)) continue;
    if (Math.max(...m.slice(i, i + W + 1).filter((x) => x > 0)) >= m[i] * 1.15) out.push(i);
  }
  return out;
}
function pbrFloorHTML(d, c) {
  const b = d.bands?.PBR;
  if (!b?.mult?.length) return `<div class="src">PBR 밴드 자료가 없어요</div>`;
  const m = b.mult, p = b.price, ds = b.dates, L = m.length - 1, fl = pbrFloors(m);
  if (!fl.length) return `<div class="src">뚜렷한 바닥을 못 찾았어요</div>`;
  const chg = (i, w) => (p[Math.min(L, i + w)] && i + w <= L ? pct((p[i + w] / p[i] - 1) * 100, 0, true) : "-");
  const vals = fl.map((i) => m[i]).sort((a, z) => a - z), mid = vals[vals.length >> 1], f12 = (c.fwd_mult?.PBR || {})["12MF"];
  const rows = fl.map((i) => `<tr><td style="text-align:left">${esc(ds[i].slice(0, 7))}</td><td><b>${n(m[i], 2)}배</b></td><td>${n(p[i])}</td><td>${chg(i, 26)}</td><td>${chg(i, 52)}</td></tr>`).join("");
  const mk = (PBR?.items || []).find((x) => x.code === d.code)?.marks || [];
  const heard = mk.filter((x) => /바닥/.test(x[1])).map((x) => `${n(x[0], 1)}배 ${esc(x[1])}`).join(" · ");
  const basis = b.basis === "forward" ? "주가 ÷ 그때 기준 1년 뒤 BPS (아직 안 나온 해는 추정치)" : "주가 ÷ 그때 이미 발표된 BPS";
  return `<div class="note" style="margin-top:4px">지금 이 기준 PBR <b>${n(m[L], 2)}배</b> · 지난 바닥들 가운데 값 <b>${n(mid, 2)}배</b> (지금보다 ${pct((mid / m[L] - 1) * 100, 0, true)}) · 바닥 범위 ${n(vals[0], 2)} ~ ${n(vals.at(-1), 2)}배</div>
    ${heard ? `<div class="note">🗣 들은 기준 (12MF): ${heard} · 지금 12MF PBR <b>${f12 ? n(f12, 2) + "배" : "-"}</b>${f12 ? mk.filter((x) => /바닥/.test(x[1])).map((x) => ` · ${n(x[0], 1)}배까지 ${pct((x[0] / f12 - 1) * 100, 0, true)}`).join("") : ""} <span class="src">(🧮 PBR 탭 기준선)</span></div>` : ""}
    <div class="tbl-wrap"><table class="compact" style="width:100%;margin-top:4px"><thead><tr><th style="text-align:left">바닥</th><th>PBR</th><th>그때 주가</th><th>6개월 뒤</th><th>1년 뒤</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="kidbox" style="margin-top:6px">🐣 PBR 은 '회사 순자산의 몇 배에 거래되나'예요. 과거에 비슷한 PBR 에서 여러 번 하락이 멈추고 다시 올랐다면, 그 근처를 '바닥권'으로 봐요. 다만 이익이 크게 줄거나(적자) 업황이 나빠지면 바닥이 더 내려가기도 해요.</div>
    <div class="note src">PBR = ${basis} · 주간 · ${esc(ds[0].slice(0, 4))}년~ · 바닥 = 앞뒤 반년 중 가장 낮고, 그 뒤 반년 안에 PBR 이 15% 넘게 다시 오른 주 · 12MF PBR(카드 위 숫자)과는 기준이 달라 숫자가 달라요 · 참고용 (매수·매도 추천 아님)</div>`;
}
// ② 지난 10년 밴드 위치 (사용자 11/6: 주가 그림 아래로 · 무슨 PER 인지 눌러서 근거) — collector main.py band_info
const BAND_NM = { PER: "PER", PBR: "PBR", DIV: "배당수익률" };
// 밴드 위치에 쓰는 배수 (main.py poss 와 같은 규칙): 적정가 방법 중 PER·PBR, 없으면 배당수익률
const bandKinds = (c, bands) => { const k = ["PER", "PBR"].filter((x) => (c.methods || []).includes(x) && bands?.[x]); return k.length ? k : bands?.DIV ? ["DIV"] : []; };
function bandPosHTML(c, pos) {
  if (!c.scen && pos == null) return "";
  const B = c.band_info || [], what = B.length ? B.map((b) => BAND_NM[b.k]).join("·") : ["PER", "PBR"].filter((x) => (c.methods || []).includes(x)).join("·") || "PER·PBR";
  return `<div class="chart-title" style="margin-top:14px"><b>② 지난 10년 ${what} 중 지금 자리</b> <span class="src">0% = 10년 중 가장 쌌던 때 · 100% = 가장 비쌌던 때</span></div>
    <div class="bandbar">${pos == null ? "" : `<span class="dot" style="left:${Math.max(0, Math.min(100, pos))}%"></span>`}</div>
    <div class="bandlbl"><span>가장 쌌던 쪽 0%</span><span>지금 ${pos == null ? "N/A" : n(pos, 0) + "%"}</span><span>가장 비쌌던 쪽 100%</span></div>
    <details class="fvt bandwhy" data-code="${esc(c.code)}" onclick="event.stopPropagation()"><summary class="chart-title">📈 밴드 차트 모두 <span class="src">12MF PBR·PER 밴드 · PBR·PER 밴드 · 선행 PER·PBR 추이 + 적정주가 표 · 5년·10년·최대 · 눌러서 열기</span></summary>
      <div class="bwb src">불러오는 중…</div>
      <div class="note src">⚠ 그림마다 쓰는 이익(앞으로 12개월 · 그해 · 지난 12개월)이 달라 배수 숫자가 조금씩 달라요 · 그림을 누르면 그 날 숫자 · 10년이 안 된 종목은 상장·데이터 시작부터 · 참고용 (매수·매도 추천 아님)</div></details>`;
}
// 📈 밴드 그림 묶음 (사용자 11/6 마지막): 신호 탭 · 카드 · 종목 상세 모두 같은 함수 — 그림 먼저, 그다음 적정주가 표
//   PBR 로 매기는 종목(삼성전자·SK하이닉스·현대차·기아…) = 12MF PBR → PBR 밴드 → 12MF PER → PER 밴드 → 선행 PER 추이 → PBR 추이 (Koyfin)
//   PER 로 매기는 종목 = 12MF PER → PER 밴드 → 12MF PBR → PBR 밴드 → 선행 PER 추이 → PBR 추이 (Koyfin)
const pbrFirstOf = (c) => (c?.scen?.parts || []).some((p) => p.kind === "PBR");
const hasBps = (d) => (d.history || []).filter((r) => r.bps > 0).length >= 2;
// ⚠ 추정치 섞임 (사용자 11/6: 올해 칸은 남은 분기가 추정 — 확정 실적·사업보고서 나온 해만 정확) · mode fwd = 12MF·선행(원래 추정 기준), year = 그해 실적을 이어 그린 그림
function estWarnHTML(d, mode, v, fut = true) {  // fut = 오른쪽에 '앞으로' 선이 있는 그림 (Koyfin 추이는 없음)
  const Y = (d.history || []).find((r) => r.estimate)?.year;
  if (!Y) return "";
  const lq = Object.keys(d.qtrs || {}).sort().pop(), qy = lq ? +lq.slice(0, 4) : 0;
  const q = qy >= Y - 1 ? ` · 지금까지 발표된 분기 실적: <b>${qy}년 ${+lq.slice(5, 7)}월 말까지</b>${qy >= Y ? ` (${Y}년 남은 분기는 추정)` : ""}` : "";
  return `<div class="warnbox" style="margin-top:6px;font-size:14px">⚠ <b>추정치 섞임</b> — ${mode === "fwd"
    ? `지금 숫자${fut ? "와 오른쪽 '앞으로' 선" : ""}은 <b>${Y}·${Y + 1}년 ${v} 추정치</b>(증권사 컨센서스)로 계산해요. 지난 구간은 나중에 나온 확정 실적으로 다시 그린 값이에요.`
    : `<b>${Y}년 1월~지금</b> 구간${fut ? "과 오른쪽 '앞으로' 선" : ""}은 <b>${Y}년 ${v} 추정치</b>(증권사 컨센서스)가 섞인 값이에요.`} <b>${Y - 1}년 결산까지는 확정 실적</b>(사업보고서)이라 정확해요${q}.</div>`;
}
function nvOne(d, px, which, tag = "button") {  // 네이버식 밴드 하나 (PER 또는 PBR) — 자기 기간 탭
  const v = which === "per" ? "EPS" : "BPS";
  return `<h3>${which === "per" ? "PER" : "PBR"} 밴드 차트 <span class="src">네이버 방식 · 그해 ${v}</span></h3><div class="card">${segTabs(`${px}nv-${which}-seg`, NV_PERIODS, "5", tag)}${nvBlock(`${px}nv-${which}`, "")}${estWarnHTML(d, "year", v)}</div>`;
}
function wireNvOne(d, px, which) {
  if (!document.getElementById(`${px}nv-${which}`)) return;
  const draw = (p) => drawNv(`${px}nv-${which}`, d, which === "per" ? "eps" : "bps", which.toUpperCase(), p);
  draw("5");
  segWire(`#${px}nv-${which}-seg`, draw);
}
// 📌 pbr_watch.yaml chart_note — 신호 탭 표와 종목 상세 밴드 차트 위에 같은 코멘트 (사용자 11/7 삼성전자)
const pbrNoteHTML = (code) => { const L = (PBR?.items || []).find((x) => x.code === code)?.chart_note || [];
  return L.length ? `<details class="fvt" style="margin:6px 0"><summary class="chart-title">${esc(L[0])}</summary><ul class="irl">${L.slice(1).map((x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`).join("")}</ul></details>` : ""; };  // 닫힘 (사용자 11/7)
function bandChartsHTML(d, px, tag, pbrFirst) {
  return pbrNoteHTML(d.code || d.card?.code) + bandChartsBody(d, px, tag, pbrFirst);
}
function bandChartsBody(d, px, tag, pbrFirst) {
  const P =hasBps(d) ? [per12mfHTML(d, px, tag, "bps"), nvOne(d, px, "pbr", tag)] : [], E = [per12mfHTML(d, px, tag), nvOne(d, px, "per", tag)];
  return (pbrFirst ? [...P, ...E] : [...E, ...P]).join("") + kfBlock(px, tag, "ntm", d) + (hasBps(d) ? kfBlock(px, tag, "pb", d) : "");
}
function wireBandCharts(d, px) {
  wirePer12mf(d, px);
  if (hasBps(d)) { wirePer12mf(d, px, "bps"); wireNvOne(d, px, "pbr"); }
  wireNvOne(d, px, "per");
  wireKf(d, px);
  wireKf(d, px, "pb");  // 그림이 없으면(BPS 부족) drawKf 가 그냥 넘어감
}
let BW_N = 0;
async function bandAllRender(box, c) {  // box = '불러오는 중' 자리 (.bwb) — 카드 '📈 밴드 차트 모두' · 📡 신호 탭 '📈 밴드 차트'
  const px = `bw${++BW_N}-`;
  try {
    const d = await (await fetch(`data/stocks/${c.code}.json?v=${encodeURIComponent(DASH.updated_at)}`)).json();
    const ft = fairTableHTML(c);  // 카드에 있는 '적정주가 · EPS × PER / BPS × PBR' 표 그대로 (사용자: 🔮 표 대신)
    box.outerHTML = bandChartsBody(d, px, "span", pbrFirstOf(c))  // 📌 코멘트는 바깥(신호 표)에 이미 있음
      + (ft ? `<h3>적정주가 표 <span class="src">카드와 같은 표 · 연도별 EPS·BPS × 과거 배수 · 초록 = 지금보다 위</span></h3><div class="card">${ft}</div>` : "");
    wireBandCharts(d, px);
  } catch (err) { box.textContent = "자료를 못 불러왔어요"; console.log("bandwhy", err); }
}
document.addEventListener("toggle", (e) => {
  const el = e.target;
  if (!el.open || el.dataset.done || !(el.classList?.contains("bandwhy") || el.classList?.contains("bandall"))) return;
  el.dataset.done = 1;
  const box = el.querySelector(":scope > .bwb"), c = DASH.stocks.find((x) => x.code === el.dataset.code);
  if (box && c) bandAllRender(box, c);
}, true);
const grp = (c) => c.group || "보유";
function renderCards() {
  const list = DASH.stocks.filter((c) => grp(c) === "보유" && (c.market === "US" ? "US" : "KR") === MKT);
  // 한국 → 미국, 각각 가장 매력적인(저평가) 순: 🟢 → 🟡 → 🔴 → N/A, 같은 판정 안에서는 적정가 대비 더 싼 순
  const rank = { green: 0, yellow: 1, red: 2, na: 3 };
  const mk = (c) => (c.market === "US" ? 1 : 0);
  if (sortMode === "cheap") list.sort((a, b) => mk(a) - mk(b) || (rank[a.verdict] ?? 3) - (rank[b.verdict] ?? 3) || (a.gap ?? 9) - (b.gap ?? 9));
  else list.sort((a, b) => mk(a) - mk(b) || a.order - b.order);
  $("#stockCards").innerHTML = list.map(stockCard).join("") || `<div class="empty">종목 데이터가 아직 없어요.</div>`;
  drawGauges(list);
  prefFill();
  jumpBar("#stockCards", "#cardJump");
  Promise.all([tgGet().catch(() => null), repGet().catch(() => null), dgGet()]).then(() => document.querySelectorAll("#stockCards .tgday").forEach((el) => { el.innerHTML = tgDayHTML(el.dataset.code); }));
}
// 🔎 종목 찾기 줄: 아래에 그려진 [data-jump] 칸들로 이름 목록을 만들고, 이름을 누르거나 검색하면 그 칸으로 스크롤 (실적 탭·보유 탭)
function jumpBar(rootSel, barSel, ph = "🔎 종목 이름 검색 (예: 에이피알) → Enter") {
  const root = $(rootSel), bar = $(barSel);
  if (!root || !bar) return;
  const seen = new Map();  // 종목마다 첫 칸으로
  root.querySelectorAll("[data-jump]").forEach((el) => { if (!seen.has(el.dataset.jump)) seen.set(el.dataset.jump, [el.dataset.jname || el.dataset.jump, el]); });
  if (seen.size < 2) { bar.innerHTML = ""; return; }
  bar.innerHTML = `<div class="jumpbar"><input type="search" placeholder="${esc(ph)}" aria-label="검색" autocomplete="off">
    <div class="chips">${[...seen].map(([c, [nm]]) => `<button class="chip" data-to="${esc(c)}">${esc(nm)}</button>`).join("")}</div></div>`;
  const go = (c) => {
    const el = seen.get(c)?.[1];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1600);
  };
  bar.querySelectorAll("[data-to]").forEach((b) => b.addEventListener("click", () => go(b.dataset.to)));
  const inp = bar.querySelector("input");
  inp.addEventListener("input", () => {  // 쓰는 대로 이름 목록을 줄여 보여 줌
    const q = inp.value.trim().toLowerCase();
    bar.querySelectorAll("[data-to]").forEach((b) => { b.hidden = !!q && !b.textContent.toLowerCase().includes(q) && !b.dataset.to.toLowerCase().includes(q); });
  });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { const b = [...bar.querySelectorAll("[data-to]")].find((x) => !x.hidden); if (b) { go(b.dataset.to); inp.blur(); } } });
}

/* ---------- 보유종목 비교표 (구글 시트처럼: 머리글 눌러 정렬, 산업별 보기, 묶음별 칸) ---------- */
const CMP = { group: "sum", ind: "전체", sort: "cap", dir: -1 };
try { Object.assign(CMP, JSON.parse(localStorage.getItem("cmp") || "{}")); } catch (_) {}
function cmpCols(mk = MKT) {
  const ys =(DASH.stocks.find((c) => c.tbl && c.tbl.years) || {}).tbl?.years || ["25", "26E", "27E", "28E"];
  const t = (k, i) => (c) => (c.tbl ? (i == null ? c.tbl[k] : (c.tbl[k] || [])[i]) : null);
  const G = (v) => (v == null ? "-" : `<span class="${v < 0 ? "neg" : ""}">${pct(v, 0, true)}</span>`);
  const P = (d) => (v) => (v == null ? "-" : n(v, d));
  const R = (d) => (v) => (v == null ? "-" : `<span class="${v < 0 ? "neg" : ""}">${n(v, d)}%</span>`);
  const arrow = (i) => `${ys[i]}→${ys[i + 1]}`;
  // 🇺🇸 탭은 모두 $B: 순현금은 달러 원본(cash_raw), 없으면 원화 값을 수집 때 환율로 되돌림
  const usd = mk === "US", Bn =(v) => (v == null ? "-" : `<span class="${v < 0 ? "neg" : ""}">${n(v, 1)}</span>`);
  const ncUsd = (s, xl) => { const r = s.tbl?.cash_raw, v = s.tbl?.[xl ? "net_cash_xl" : "net_cash"];
    return r ? (r.cash + r.sti - r.debt + (xl ? r.lease : 0)) / 1e9 : v != null && DASH.fx ? v / DASH.fx / 1e9 : null; };
  const c = {
    cap: usd ? { h: "시총<br>($B)", v: (s) => (s.market_cap_usd ? s.market_cap_usd / 1e9 : null), f: P(0) }
      : { h: "시총<br>(조원)", v: (s) => (s.market_cap ? s.market_cap / 1e12 : null), f: P(1) },
    salesC: { h: `매출<br>3년 연평균`, v: t("sales_cagr"), f: G },
    opC: { h: `영업이익<br>3년 연평균`, v: t("op_cagr"), f: G },
    epsC: { h: `EPS<br>3년 연평균`, v: t("eps_cagr"), f: G },
    op10: { h: "영업이익<br>10년 연평균", v: t("op10"), f: G },  // 📏 지난 최대 10년 (종목 상세 '이익 vs 주가')
    px10: { h: "주가<br>10년 연평균", v: t("px10"), f: G },
    rr10: { h: "이익 대비 주가<br>10년 새 몇 배", v: t("rr10"), f: (v) => (v == null ? "-" : `${n(v, 1)}배`) },
    peg: { h: "PEG", v: t("peg"), f: (v, s) => (v == null ? "-" : `<span class="${s.cyclical ? "dim" : ""}">${n(v, 2)}${s.cyclical ? "*" : ""}</span>`) },
    per12: { h: "PER<br>12MF", v: t("per12"), f: (v, s) => (v == null ? "-" : `<span class="${s.cyclical ? "dim" : ""}">${n(v, 1)}${s.cyclical ? "*" : ""}</span>`) },
    dd: { h: "52주 고점<br>대비", v: t("dd52"), f: (v) => (v == null ? "-" : n(v, 0) + "%") },
    nc: usd ? { h: "순현금 ($B)<br>리스 포함", v: (s) => ncUsd(s, false), f: Bn }
      : { h: "순현금 (조원)<br>리스 포함", v: (s) => (s.tbl?.net_cash != null ? s.tbl.net_cash / 1e12 : null), f: Bn },
    ncp: { h: "순현금<br>÷ 시총", v: t("net_cash_pct"), f: R(0) },
    ncx: usd ? { h: "순현금 ($B)<br>리스 제외", v: (s) => ncUsd(s, true), f: Bn }
      : { h: "순현금 (조원)<br>리스 제외", v: (s) => (s.tbl?.net_cash_xl != null ? s.tbl.net_cash_xl / 1e12 : null), f: Bn },
    ncxp: { h: "순현금 리스 제외<br>÷ 시총", v: t("net_cash_xl_pct"), f: R(0) },
    fcfY: { h: "FCF ÷ 시총<br>최근 4분기", v: t("fcf_ttm_yield"), f: R(1) },
  };
  for (let i = 0; i < 3; i++) {
    c["sg" + i] = { h: `매출<br>${arrow(i)}`, v: t("sales_g", i), f: G };
    c["og" + i] = { h: `영업이익<br>${arrow(i)}`, v: t("op_g", i), f: G };
    c["per" + i] = { h: `PER<br>${ys[i]}`, v: t("per", i), f: P(1) };
    c["pbr" + i] = { h: `PBR<br>${ys[i]}`, v: t("pbr", i), f: P(2) };
    c["roe" + i] = { h: `ROE<br>${ys[i]}`, v: t("roe", i), f: R(0) };
  }
  for (let i = 0; i < 4; i++) {
    c["pf" + i] = { h: `P/FCF<br>${ys[i]}`, v: t("pfcf", i), f: P(1) };
    c["opm" + i] = { h: `OPM<br>${ys[i]}`, v: t("opm", i), f: R(1) };
    c["debt" + i] = { h: `부채비율<br>${ys[i]}`, v: t("debt", i), f: (v) => (v == null ? "-" : n(v) + "%") };
  }
  for (let i = 0; i < 2; i++) c["dy" + i] = { h: `배당<br>${ys[i + 1]}`, v: t("dy", i), f: (v) => (v == null ? "-" : n(v, 1) + "%") };
  // 엑셀 '간단 벨류' 지표 (야후 연간 실적: 최근 / 1년 전 / 2년 전)
  const ago = ["최근 연간", "1년 전", "2년 전"];
  const money3 = (v, s) => (v == null ? "-" : `<span class="${v < 0 ? "neg" : ""}">${s.currency === "USD" ? "$" + n(v / 1e9, 1) + "B" : Math.abs(v) >= 1e12 ? n(v / 1e12, 1) + "조" : n(v / 1e8, 0) + "억"}</span>`);
  for (let i = 0; i < 3; i++) {
    c["gpm" + i] = { h: `GPM<br>${ago[i]}`, v: t("gpm", i), f: R(1) };
    c["fcf" + i] = { h: `FCF<br>${ago[i]}`, v: t("fcf3", i), f: money3 };
  }
  c.fcfT = { h: "FCF<br>최근 4분기", v: t("fcf_ttm"), f: money3 };
  // 소몽 체크리스트 (O=2, △=1, X=0 으로 정렬)
  const vnum = { O: 2, "△": 1, X: 0 };
  const smv = (k) => (s) => vnum[smVerdict(smData(s), k)] ?? null;
  const smf = (k) => (v, s) => (v == null ? "-" : badge(smVerdict(smData(s), k)));
  c.smS = { h: "소몽<br>점수", v: (s) => smScore(smData(s)), f: (v) => (v == null ? "-" : `<b class="${v >= 90 ? "ok" : ""}">${v}</b>`) };
  for (const [k, l] of [...SM_KEYS, ["good_boss", "굿보스"], ["giant", "거인의<br>어깨"]]) c["sm_" + k] = { h: l.replace("이겨라", "<br>이겨라"), v: smv(k), f: smf(k) };
  c.ath = { h: "최고가<br>대비", v: (s) => s.mdd?.dd ?? null, f: (v) => (v == null ? "-" : n(v, 0) + "%") };
  c.nev = { h: "다음<br>이벤트", v: (s) => nextEvent(smData(s))?.date ?? null, f: (v, s) => { const e = nextEvent(smData(s)); return e ? `<span class="evt">${esc(e.date)}<br><span class="src">${esc(String(e.what).slice(0, 14))}</span></span>` : "-"; } };
  // ROIC: 확정 연간 → 최근 4분기 → 앞으로 예상 (설비투자가 늘어도 수익률이 유지되는지)
  const rs = DASH.stocks.find((s) => s.tbl?.roic_e?.length)?.tbl || {};
  c.roic = { h: `ROIC<br>${rs.roic_fy ? esc(rs.roic_fy) + " 확정" : "최근 연간"}`, v: t("roic"), f: R(0) };
  c.roicT = { h: "ROIC<br>최근 4분기", v: t("roic_ttm"), f: R(0) };
  for (let i = 0; i < 2; i++) c["roicE" + i] = { h: `ROIC<br>${esc((rs.roic_e?.[i] || [])[0] || (i ? "27E" : "26E"))} 예상`, v: (s) => (s.tbl?.roic_e?.[i] || [])[1] ?? null, f: R(0) };
  c.psr = { h: `PSR<br>${ys[1]}`, v: t("psr"), f: P(1) };
  return c;
}
const CMP_GROUPS = [
  // 앞쪽은 올해(26E) 한눈에, "|" 뒤로는 같은 지표를 연도순으로 이어서 (기울기·연속성 보기)
  ["sum", "요약", ["cap", "salesC", "opC", "per12", "peg", "opm1", "roe1", "debt1", "pf1", "dy0", "dd",
    "|", "opm0", "opm1", "opm2", "opm3", "|", "roe0", "roe1", "roe2", "|", "debt0", "debt1", "debt2", "debt3", "|", "pf0", "pf1", "pf2", "pf3"]],
  ["grow", "성장", ["salesC", "sg0", "sg1", "sg2", "opC", "og0", "og1", "og2", "epsC", "op10", "px10", "rr10"]],
  ["qual", "수익성", ["gpm0", "opm0", "opm1", "opm2", "opm3", "roe0", "roe1", "roe2", "roic", "roicT", "roicE0", "roicE1"]],
  ["val", "밸류", ["per12", "peg", "per0", "per1", "per2", "pbr0", "pbr1", "pbr2", "psr", "pf0", "pf1", "pf2", "pf3"]],
  ["fin", "재무·배당", ["nc", "ncp", "ncx", "fcfT", "fcfY", "fcf0", "fcf1", "fcf2", "debt0", "debt1", "debt2", "debt3", "dy0", "dy1", "dd"]],
  ["som", "소몽", ["smS", "sm_wallet", "sm_oligopoly", "sm_anyone_wins", "sm_good_boss", "sm_giant", "ath", "nev"]],
  ["all", "전체", null],
];
// 미국은 무료로 받을 수 있는 숫자가 달라서 (추정은 EPS·매출 위주, 나머지는 최근 실적) 칸 구성을 따로
const CMP_GROUPS_US = [
  ["sum", "요약", ["cap", "sg0", "sg1", "epsC", "per12", "peg", "gpm0", "opm0", "roic", "roicE1", "ncx", "fcfT", "fcfY", "dy0", "dd"]],
  ["grow", "성장", ["sg0", "sg1", "epsC", "op10", "px10", "rr10"]],
  ["qual", "수익성", ["gpm0", "gpm1", "gpm2", "opm0", "roe0", "roic", "roicT", "roicE0", "roicE1"]],
  ["val", "밸류", ["per12", "peg", "per0", "per1", "per2", "pbr0", "psr"]],
  ["fin", "재무·배당", ["nc", "ncp", "ncx", "ncxp", "fcfT", "fcfY", "fcf0", "fcf1", "fcf2", "debt0", "dy0", "dd"]],
  ["som", "소몽", ["smS", "sm_wallet", "sm_oligopoly", "sm_anyone_wins", "sm_good_boss", "sm_giant", "ath", "nev"]],
  ["all", "전체", null],
];
// 같은 비교표를 🇰🇷/🇺🇸 보유 탭과 ⭐ 관심 탭에 (관심은 🇰🇷/🇺🇸 버튼) — 종목 이름을 누르면 아래 그 종목 칸으로, 나머지 칸은 상세 화면
const CMPW = { group: "sum", ind: "전체", sort: "cap", dir: -1, mkt: "KR" };
try { Object.assign(CMPW, JSON.parse(localStorage.getItem("cmpw") || "{}")); } catch (_) {}
const CMP_T = {
  main: { grp: "보유", st: CMP, save: "cmp", mkt: () => MKT, cards: "#stockCards", el: { group: "#cmpGroup", ind: "#cmpInd", table: "#cmpTable", note: "#cmpNote" } },
  watch: { grp: "관심", st: CMPW, save: "cmpw", mkt: () => CMPW.mkt, cards: "#watchFull", el: { group: "#wcmpGroup", ind: "#wcmpInd", table: "#wcmpTable", note: "#wcmpNote" } },  // 시장은 🇰🇷/🇺🇸 관심 탭이 정함
};
const inGrp = (s, g) => grp(s) === g || (s.also || []).includes(g);
function renderCmp(T = CMP_T.main) {
  const MK = T.mkt(), S = T.st, cols = cmpCols(MK);
  if (!$(T.el.table)) return;
  const GROUPS = MK === "US" ? CMP_GROUPS_US : CMP_GROUPS;
  const g = GROUPS.find((x) => x[0] === S.group) || GROUPS[0];
  const raw = g[2] || [...new Set(GROUPS.slice(0, -1).flatMap((x) => x[2]))];
  const sepAt = new Set(raw.map((k, i) => (i && raw[i - 1] === "|" ? i - raw.slice(0, i).filter((x) => x === "|").length : -1)));  // 구분선 칸 위치
  const keys = raw.filter((k) => k !== "|");
  if (!keys.includes(S.sort) && S.sort !== "name" && S.sort !== "ind") S.sort = keys[0];
  const mine = DASH.stocks.filter((s) => inGrp(s, T.grp) && (s.market === "US" ? "US" : "KR") === MK);
  const inds = ["전체", ...new Set(mine.map((s) => s.industry).filter(Boolean))];
  if (!inds.includes(S.ind)) S.ind = "전체";
  if (T.el.mkt) $(T.el.mkt).innerHTML = ["KR", "US"].map((m) => `<button data-m="${m}" class="${m === MK ? "on" : ""}">${m === "US" ? "🇺🇸 미국" : "🇰🇷 한국"} ${DASH.stocks.filter((s) => inGrp(s, T.grp) && (s.market === "US" ? "US" : "KR") === m).length}</button>`).join("");
  $(T.el.group).innerHTML = GROUPS.map(([k, l]) => `<button data-g="${k}" class="${k === g[0] ? "on" : ""}">${l}</button>`).join("");
  $(T.el.ind).innerHTML = inds.map((x) => `<button data-i="${esc(x)}" class="chip ${x === S.ind ? "on" : ""}">${esc(x)}</button>`).join("");
  let rows = mine.filter((s) => S.ind === "전체" || s.industry === S.ind);
  const val = (s) => (S.sort === "name" ? s.name : S.sort === "ind" ? s.industry || "" : cols[S.sort].v(s));
  rows = rows.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1; // 빈 칸은 정렬 방향과 상관없이 맨 아래
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * S.dir;
  });
  const th = (k, h, i) => `<th data-k="${k}" class="${S.sort === k ? "on" : ""}${sepAt.has(i) ? " sep" : ""}">${h}${S.sort === k ? (S.dir > 0 ? " ▲" : " ▼") : ""}</th>`;
  $(T.el.table).innerHTML = `<table class="cmp"><thead><tr>${th("name", "종목")}${th("ind", "산업")}${keys.map((k, i) => th(k, cols[k].h, i)).join("")}</tr></thead>
    <tbody>${rows.map((s) => `<tr data-code="${esc(s.code)}"><td class="nm" title="아래 ${esc(s.name)} 칸으로 이동">${esc(s.name)} ↓</td><td class="ind">${esc(s.industry || "")}</td>
      ${keys.map((k, i) => `<td${sepAt.has(i) ? ' class="sep"' : ""}>${cols[k].f(cols[k].v(s), s)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  $(T.el.note).innerHTML = `머리글을 누르면 정렬 (한 번 더 누르면 반대로) · <b>종목 이름(↓)을 누르면 아래 그 종목 칸으로</b>, 숫자 칸을 누르면 상세 화면 · 3년 연평균 = 25년 실적 → 28년 추정 ·
    PEG = 12MF PER ÷ EPS 3년 연평균 성장률(%) (1 아래면 성장에 비해 싼 편, 피터 린치 기준) · * = 이익이 크게 출렁이는 업종이라 PER·PEG 가 실제보다 싸 보일 수 있음 ·
    P/FCF = 지금 시가총액 ÷ 그해 잉여현금흐름 (25 = 확정 실적) · PSR = 시가총액 ÷ 올해 예상 매출 · 순현금 = 현금·단기투자 − 총차입금(최근 분기, 야후) · GPM·ROIC·FCF = 야후 연간 실적 ·
    ${MK === "US" ? "미국: 추정치는 야후·나스닥 컨센서스(EPS·매출), 나머지는 최근 실적 · 25 PER 은 지금 주가 ÷ 작년 EPS" : "25 PER·PBR 은 그해 말 주가, 26E·27E 는 지금 주가 기준"}`;
  try { localStorage.setItem(T.save, JSON.stringify(S)); } catch (_) {}
}
// 아래 종목 칸으로 스크롤 + 잠깐 테두리 (jumpBar 와 같은 모양) — 칸이 없으면 false
function jumpTo(root, code) {
  const el = $(root)?.querySelector(`[data-jump="${CSS.escape(code)}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
  return true;
}
for (const T of Object.values(CMP_T)) {
  const S = T.st, re = () => renderCmp(T);
  if (T.el.mkt) $(T.el.mkt)?.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.mkt = b.dataset.m; re(); });
  $(T.el.group)?.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.group = b.dataset.g; re(); });
  $(T.el.ind)?.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.ind = b.dataset.i; re(); });
  $(T.el.table)?.addEventListener("click", (e) => {
    const h = e.target.closest("th");
    if (h) { const k = h.dataset.k; S.dir = S.sort === k ? -S.dir : (k === "name" || k === "ind" ? 1 : -1); S.sort = k; re(); return; }
    const r = e.target.closest("tr[data-code]");
    if (!r) return;
    if (e.target.closest("td.nm") && jumpTo(T.cards, r.dataset.code)) return;  // 이름 → 아래 그 종목 칸
    location.hash = `#stock/${r.dataset.code}`;
  });
}

/* ---------- 기업 프로필 (config/profiles.yaml: 한 줄 설명·정성 평가·매출 비중·점유율·IR 자료) ---------- */
let PROFILES = {};
const DONUT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#7c3aed", "#e05297", "#5b8def", "#8a8a85"];
const VERD = { O: ["good", "O"], "△": ["warn", "△"], X: ["bad", "X"] };
function badge(v) { const x = VERD[v] || ["na", "-"]; return `<span class="vb ${x[0]}">${x[1]}</span>`; }
function profileHTML(code) {
  const p = PROFILES[code];
  if (!p) return "";
  const irList = (p.ir || []).length ? `<ul class="irl">${p.ir.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a></li>`).join("")}</ul>` : "";
  if (!p.one_liner) return irList ? `<h3>📂 IR 자료</h3><div class="card">${irList}${p.ir_notes ? `<div class="note src">${esc(p.ir_notes)}</div>` : ""}</div>` : "";
  const q = (title, o) => (o ? `<div class="pq"><div class="pq-h">${badge(o.verdict)} <b>${title}</b></div><div class="pq-b">${esc(o.why || "")}</div></div>` : "");
  const ol = p.oligopoly || {};
  const donut = (id, title, d, extra = "") => (d && (d.items || []).length ? `<div class="pd"><div class="pd-t">${title}</div>
    <div class="pd-c"><canvas id="${id}"></canvas></div>
    <div class="pd-l">${d.items.map((x, i) => `<span><i style="background:${DONUT[i % DONUT.length]}"></i>${esc(x.name)} <b>${n(x.pct, 0)}%</b></span>`).join("")}</div>
    <div class="note src">${esc(d.market ? d.market + " · " : "")}${esc(d.period || "")}${d.source ? ` · <a href="${esc(d.source)}" target="_blank" rel="noopener">출처</a>` : ""}${d.note ? " · " + esc(d.note) : ""}</div>${extra}</div>` : "");
  const ms = p.market_share;
  const top3 = ms && ms.top3_pct != null ? `<div class="note">${badge(ms.top3_over50 ? "O" : "X")} 상위 3개 회사 합계 <b>${n(ms.top3_pct, 0)}%</b> ${ms.top3_over50 ? "(50% 넘음 → 과점)" : "(50% 안 됨)"}</div>` : "";
  const g = p.gpm;
  return `<h3>🏢 기업 프로필 <span class="src">조사일 ${esc(p.checked_at || "")}</span></h3><div class="card">
    <div class="oneliner">${esc(p.one_liner || "")}</div>
    ${g && g.value != null ? `<div class="note">${badge(g.over30 ? "O" : "X")} 매출총이익률(GPM) <b>${n(g.value, 1)}%</b> ${g.over30 ? "— 30% 이상" : "— 30% 미만"} <span class="src">${esc(g.period || "")}${g.source ? ` · <a href="${esc(g.source)}" target="_blank" rel="noopener">출처</a>` : ""}</span></div>` : ""}
    <div class="chart-title" style="margin-top:12px"><b>올리고폴리오 (성장·독점·진입장벽)</b> ${badge(ol.verdict)}</div>
    <div class="pq-b">📈 ${esc(ol.growth || "-")}<br>👑 ${esc(ol.share || "-")}<br>🏰 ${esc(ol.barriers || "-")}</div>
    ${q("아무나 이겨라 (누가 이기든 돈 버는 구조)", p.pick_and_shovel)}
    ${q("요금 인상 가능? (가격 전가력)", p.pricing_power)}
    ${q("데이터를 모으는 기업?", p.data_company)}
    ${q("내 지갑에서 돈을 빼가나? (구독)", p.wallet)}
    ${p.human_indicator ? `<div class="pq"><div class="pq-h">🧑‍🤝‍🧑 <b>인간지표</b></div><div class="pq-b">${esc(p.human_indicator)}</div></div>` : ""}
    <div class="pdg">${donut("pd-geo-" + code, "🌍 지역별 매출", p.revenue_geo)}${donut("pd-seg-" + code, "🧩 사업별 매출", p.revenue_segment)}${donut("pd-ms-" + code, "🥧 시장 점유율", ms, top3)}</div>
    ${(p.ir || []).length ? `<div class="chart-title" style="margin-top:12px"><b>📂 IR 자료</b></div><ul class="irl">${p.ir.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a></li>`).join("")}</ul>` : ""}
    ${p.notes ? `<div class="note src">메모: ${esc(p.notes)}</div>` : ""}
  </div>`;
}
function drawProfile(code) {
  const p = PROFILES[code];
  if (!p) return;
  for (const [k, d] of [["geo", p.revenue_geo], ["seg", p.revenue_segment], ["ms", p.market_share]]) {
    const cv = document.getElementById(`pd-${k}-${code}`);
    if (!cv || !d) continue;
    if (charts.has(cv.id)) charts.get(cv.id).destroy();
    charts.set(cv.id, new Chart(cv, { type: "doughnut",
      data: { labels: d.items.map((x) => x.name), datasets: [{ data: d.items.map((x) => x.pct), backgroundColor: d.items.map((_, i) => DONUT[i % DONUT.length]), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, cutout: "62%",
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${n(c.parsed, 1)}%` } } } } }));
  }
}

/* ---------- 소몽 체크리스트 (강의: 지갑털이·올리고폴리·아무나이겨라·굿보스/거인의 어깨 → 점수, MDD 반반전략, 여름에 패딩사기, 배당주 점검, 내가 이걸 왜 샀지) ---------- */
let SOMONG = {};
const SM_KEYS = [["wallet", "지갑털이"], ["oligopoly", "올리고폴리"], ["anyone_wins", "아무나이겨라"]];
function smData(c) { return SOMONG[c.code] || (c.code === "005935" ? SOMONG["005930"] : null); }
const smChecked = (s) => (s && SM_KEYS.some(([k]) => s[k]) ? s : null);  // 체크리스트 조사가 있는 종목만 (my 칸만 있는 종목은 빈 표를 안 그림)
function smVerdict(s, k) { return s?.my?.override?.[k] || s?.[k]?.v; } // 내가 고친 값이 있으면 그걸
function smScore(s) {
  if (!s) return null;
  const vs = SM_KEYS.map(([k]) => smVerdict(s, k));
  if (vs.some((v) => !v)) return null;
  let sc = 100 - 10 * vs.filter((v) => v === "X").length - 5 * vs.filter((v) => v === "△").length;
  if (smVerdict(s, "good_boss") === "O" || smVerdict(s, "giant") === "O") sc += 5;
  return Math.min(100, sc);
}
function nextEvent(s) {
  const today = new Date().toISOString().slice(0, 7);
  return (s?.events || []).filter((e) => String(e.date).slice(0, 7) >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
}
function somongHTMLcard(c) {
  const s = smChecked(smData(c));
  const sc = smScore(s);
  const m = c.mdd, d = c.div_check;
  if (!s && !m && !d) return "";
  const chips = s ? SM_KEYS.map(([k, l]) => `${l} ${badge(smVerdict(s, k))}`).join(" ") +
    ` 굿보스 ${badge(smVerdict(s, "good_boss"))} 거인 ${badge(smVerdict(s, "giant"))}` : "";
  const past = s?.past;
  const reason = (k, l) => (s?.[k] ? `<div class="pq"><div class="pq-h">${badge(smVerdict(s, k))} <b>${l}</b>${s[k].who ? ` <span class="src">${esc(s[k].who)}</span>` : ""}</div>
    <div class="pq-b">${esc(s[k].why || "")}${s[k].source ? ` <a href="${esc(s[k].source)}" target="_blank" rel="noopener">출처</a>` : ""}</div></div>` : "");
  // 반반전략: 고점 대비 -10~-50% 구간 가격, 지금 어디까지 내려왔는지
  const ladder = m ? `<div class="chart-title" style="margin-top:12px"><b>📉 현재 MDD · 반반전략 분할매수 구간</b> <span class="src">사상 최고가 ${money(m.peak, c.currency)} (${esc(m.peak_date)}) 대비</span></div>
    <div class="note">지금 고점 대비 <b>${pct(m.dd, 1)}</b></div>
    <div class="ladder">${m.levels.map(([lv, p]) => `<div class="${m.dd <= lv ? "hit" : ""}"><span>${lv}%</span><b>${money(p, c.currency)}</b></div>`).join("")}</div>
    <div class="note src">색칠된 칸 = 이미 그 구간까지 내려옴 · 강의: 월 투자금 절반은 자동 적립, 절반은 비상금으로 모아 고점 대비 하락 구간에서 3번 나눠 사고 마지막 1번은 남겨 두기</div>` : "";
  // 📜 예전에 고점 대비 -40% 넘게 빠진 뒤 흐름 (somong.yaml mdd_hist — 삼성전자, 사용자 2026-11-02): 표 → 그림 → 🐣
  const h = s?.mdd_hist;
  const mh = h ? `<div class="chart-title" style="margin-top:12px"><b>📜 예전에 고점 대비 -40% 넘게 빠졌을 때</b> <span class="src">${esc(h.src)}</span></div>
    <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">언제</th><th>고점 대비 최저</th><th>저점 뒤 1개월</th><th>3개월</th><th>5개월</th></tr></thead><tbody>
    ${h.cases.map(([m2, w, lo, ...r]) => `<tr><td style="text-align:left">${esc(m2)} <span class="src">${esc(w)}</span></td><td>${n(lo, 0)}%</td>${r.map((v) => `<td class="${kcol(v)}">${sg(v, 1)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    ${lineChart({ t: "저점 뒤 누적 수익률 — 예전 5번", labels: h.labels, fl: (v) => `${n(v, 0)}%`, zero: true, tick: (i) => h.labels[i],
      s: [{ n: "하나증권 평균", v: h.path, col: "var(--ink)" }, { n: "우리 계산 평균", v: h.ours, col: "var(--s1)" }, { n: "가운데 값", v: h.median, col: "var(--s3)" }] })}
    <ul class="irl">${(h.lines || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${h.kid ? `<div class="kidbox" style="font-size:13px">🐣 ${esc(h.kid)}</div>` : ""}` : "";
  const ev = (s?.events || []).length ? `<div class="chart-title" style="margin-top:12px"><b>🧥 여름에 패딩사기</b> <span class="src">이벤트(D-DAY) 3~6개월 전에 미리 · 이벤트 날 즈음엔 나눠서 정리</span></div>
    <ul class="irl">${s.events.map((e) => `<li><b>${esc(e.date)}</b> ${esc(e.what)}${e.src ? ` <a href="${esc(e.src)}" target="_blank" rel="noopener">출처</a>` : ""}</li>`).join("")}</ul>
    ${s.season ? `<div class="note">🔁 반복 패턴: ${esc(s.season)}</div>` : ""}` : "";
  const dv = d && d.rows?.length ? `<div class="chart-title" style="margin-top:12px"><b>💰 배당주 점검</b> <span class="src">${d.years.map(([y, v]) => `${String(y).slice(2)}년 ${c.currency === "USD" ? "$" + n(v, 2) : n(v)}`).join(" · ")}</span></div>
    ${d.rows.map((r) => `<div class="note">${badge(r.ok)} ${esc(r.item)} <span class="src">${esc(r.why)}</span></div>`).join("")}` : (d?.verdict ? `<div class="note">💰 ${esc(d.verdict)}</div>` : "");
  const my = s?.my || {};
  const mine = `<div class="chart-title" style="margin-top:12px"><b>📝 내가 이걸 왜 샀지</b></div>
    <div class="note">${my.why_bought ? esc(my.why_bought) : '<span class="src">아직 안 적었어요 (config/somong.yaml 의 my.why_bought)</span>'}
    ${my.review ? ` · 검토: <b>${esc(my.review)}</b>` : ""}${my.rank ? ` · 순위 ${esc(my.rank)}` : ""}${my.greed_price ? ` · 욕망시 ${esc(my.greed_price)}` : ""}</div>
    <div class="note src">강의: 산 이유가 사라지면 매도를 고려 · 수익률이 아니라 '지금 다시 산다면?'으로 순위를 매겨 낮은 순위부터 정리(현금 확보·갈아타기)</div>`;
  return `<details class="fvt sm" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:10px">📋 소몽 체크리스트 ${sc == null ? "" : `<b class="smsc ${sc >= 90 ? "ok" : ""}">${sc}점</b>`}
      ${past?.score != null ? `<span class="src">(25.4.7 당시 ${past.score}점)</span>` : ""}${h ? ' <span class="src">· 📜 -40% 급락 뒤 패턴</span>' : ""}<div class="smchips">${chips}</div></summary>
    ${s ? `<div class="note src">점수 = 100 − X 1개당 10 − △ 1개당 5 (지갑털이·올리고폴리·아무나이겨라) + 굿보스·거인의 어깨 5 · 강의 기준: 90점 넘으면 투자 고려 · 조사일 ${esc(s.checked_at || "")}</div>
      ${reason("wallet", "지갑털이 (내 돈·시간을 점점 더 가져가나)")}${reason("oligopoly", "올리고폴리 (1~3위 합 50% 이상)")}${reason("anyone_wins", "아무나이겨라 (누가 이기든 돈 버나)")}
      ${reason("good_boss", "굿보스 (믿을 만한 경영자)")}${reason("giant", "거인의 어깨 (큰 기관·거물 보유)")}
      ${past ? `<div class="note">🕰 25.4.7 당시 내 판단: 지갑 ${esc(past.wallet || "-")} · 올리고 ${esc(past.oligopoly || "-")} · 아무나 ${esc(past.anyone_wins || "-")} · 굿보스/거인 ${esc(past.boss || "-")} · ${esc(past.score ?? "-")}점${past.season ? " · " + esc(past.season) : ""}${past.range ? " · 하방~상방 " + esc(past.range) : ""}${past.greed ? " · 욕망시 " + esc(past.greed) : ""}</div>` : ""}` : ""}
    ${ladder}${mh}${ev}${dv}${mine}
  </details>`;
}

/* ---------- 매수 전 최종 점검 (내 엑셀 '기업분석 3단계 Q&A' + 재파 체크리스트에서 다른 체크리스트와 겹치는 것 뺀 16개 + 기트정) ----------
   답은 이 기기 브라우저에 저장 (localStorage). 숫자로 볼 수 있는 항목은 자동. */
const PRE_Q = [
  ["이해", [["why", "왜 투자하는가? 초등학생에게 2분 안에 설명하면", "text"], ["circle", "내가 잘 아는 분야인가? (능력범위)", "ox"],
    ["bm", "뭐로 돈 벌고 고객은 누구? (B2B·B2C, 경기 사이클 타는지)", "text"]]],
  ["리스크", [["worst", "최악의 상황은? 일어날 확률은? 내가 견딜 수 있나?", "text"],
    ["drop", "주가가 빠졌다면 원인은?", "sel:시장 전체|섹터|종목 본질|오해·일시적|안 빠짐"],
    ["uncertain", "불확실성이 리스크로 확정됐나? 악재에도 더 안 빠지나?", "text"], ["china", "중국·미중 관계 영향은?", "text"]]],
  ["시장·심리", [["narrative", "내러티브(테마)는 진짜인가? 기술·트렌드·정책(기트정)이 다 받쳐 주나", "chk:기술|트렌드|정책"], ["leader", "주도주인가 소외주인가? 사람들이 이미 몰렸나, 더 몰릴까?", "text"], ["earn", "실적 발표일과 대응 전략은?", "text"]]],
  ["매매 계획", [["style", "트레이딩인가 인베스팅인가? 언제까지 들고 갈까?", "text"], ["target", "목표 주가·시총, 비중, 기간 대비 수익률은?", "text"],
    ["sell", "매도 기준은? (매수 이유 소멸 · 적정가 도달 · 급등 고평가 · 손절선)", "text"],
    ["future", "1~2년 뒤에도 좋아질 주식인가? 회사의 미래를 상상해 보면?", "text"],
    ["done3", "정량(숫자)·정성(스토리)·기술적(차트) 분석을 다 했나?", "chk:정량|정성|기술적"]]],
];
/* ---------- 분기 실적 한눈에: 4칸 핵심지표 + 돈의 흐름 (야후 분기 재무제표, cache 에 쌓음) ---------- */
function qLabel(end) { const [y, m] = end.split("-").map(Number); return m % 3 ? `${String(y).slice(2)}.${m}월` : `${String(y).slice(2)}.${m / 3}Q`; }
function qMoney(v, usd) {
  if (v == null) return "-";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (usd) return `${s}$${n(a / 1e9, a >= 1e10 || a === 0 ? 1 : 2)}B`;  // 미국은 모두 $B (작으면 소수 둘째 자리)
  return a >= 1e12 ? `${s}${n(a / 1e12, 1)}조` : `${s}${n(a / 1e8, 0)}억`;
}
// 점 위 숫자가 선을 덮지 않게: 숫자 칸 반폭(hw) 안에서 양옆 선분이 지나는 가장 높은 곳보다 위에 (pts = [[x, y] | null])
function clearY(pts, i, hw = 14) {
  const [x, y] = pts[i];
  let m = y;
  for (const p of [pts[i - 1], pts[i + 1]]) if (p) m = Math.min(m, y + (p[1] - y) * Math.min(1, hw / Math.max(1, Math.abs(p[0] - x))));
  return Math.max(10, m - 7);
}
// 🖱 그림 숫자 보기: 칸마다 보이지 않는 막대(data-tip, 줄바꿈 = \n) — 마우스를 올리거나 누르면 그 칸 숫자 상자, 그림 밖을 누르면 닫힘
function tipCols(X, w, y0, y1, tips) {
  return tips.map((t, i) => (t ? `<rect class="tiphit" x="${(X(i) - w / 2).toFixed(1)}" y="${y0}" width="${Math.max(1, w).toFixed(1)}" height="${y1 - y0}" data-tip="${esc(t)}"/>` : "")).join("");
}
const TIP = Object.assign(document.createElement("div"), { className: "tipbox", hidden: true });
let TIP_ON = null;
function tipAt(el, x, y) {
  if (!TIP.isConnected) document.body.appendChild(TIP);
  TIP_ON?.classList.remove("on");
  TIP_ON = el;
  el.classList.add("on");
  TIP.innerHTML = el.dataset.tip.split("\n").map((s, i) => (i ? esc(s) : `<b>${esc(s)}</b>`)).join("<br>");
  TIP.hidden = false;
  const r = TIP.getBoundingClientRect(), W = document.documentElement.clientWidth;
  TIP.style.left = `${Math.max(4, Math.min(W - r.width - 4, x + 12))}px`;
  TIP.style.top = `${y - r.height - 12 < 4 ? y + 16 : y - r.height - 12}px`;
}
function tipHide() { if (!TIP_ON) return; TIP.hidden = true; TIP_ON.classList.remove("on"); TIP_ON = null; }
document.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  const t = e.target.closest?.(".tiphit");
  if (t) tipAt(t, e.clientX, e.clientY); else if (!e.target.closest?.("svg")) tipHide();
});
// capture: 카드(button) 안 접힌 칸은 누르기를 막아서(stopPropagation) 그 안 그림도 눌러서 숫자가 보이게 먼저 받음 (사용자 11/6)
document.addEventListener("click", (e) => { const t = e.target.closest?.(".tiphit"); if (t) tipAt(t, e.clientX, e.clientY); else tipHide(); }, true);
// 사용자 11/6: 휴대폰에서 그림을 눌러 뜬 숫자 상자(Chart.js 툴팁)가 그림 밖을 눌러도 남아 있던 것 — 그 그림 말고 다른 곳을 누르면 모두 닫기
document.addEventListener("click", (e) => {
  const cv = e.target.closest?.("canvas");
  for (const ch of Object.values(Chart.instances || {})) {
    if (ch.canvas === cv || !ch.tooltip?.getActiveElements?.().length) continue;
    ch.tooltip.setActiveElements([], { x: 0, y: 0 });
    ch.setActiveElements([]);
    ch.update("none");
  }
}, true);
document.addEventListener("scroll", tipHide, { passive: true, capture: true });  // 화면이 움직이면 상자가 엉뚱한 데 남지 않게
// 막대(값) + 선(%) 미니 차트. 음수 막대는 빨강, 마지막 분기는 진하게
function qPanel(title, tag, labels, bars, line, usd, color, est = null) {  // est: 칸마다 추정(E) 여부 → 회색, 강조는 마지막 실적 칸
  const W = 300, x0 = 14, bw = (W - 2 * x0) / labels.length, li = est ? est.lastIndexOf(false) : bars.length - 1;
  const vals = bars.filter((v) => v != null), hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
  const top = line ? 78 : 40, bot = lo < 0 ? 138 : 150, sc = (bot - top) / ((hi - lo) || 1), zero = top + hi * sc;  // 음수 막대 글자 자리
  // 막대 위 숫자는 단위 없이 짧게 (단위는 제목 옆) — 칸이 좁아도 옆 숫자와 안 겹치게
  const big = Math.max(1, ...vals.map(Math.abs)), [dv, un, dg] = usd ? [1e9, "$B", 1] : big >= 1e12 ? [1e12, "조원", 1] : [1e8, "억원", 0];
  let g = `<line x1="${x0}" x2="${W - x0}" y1="${zero}" y2="${zero}" stroke="var(--axis)"/>`;
  bars.forEach((v, i) => {
    const cx = x0 + bw * i + bw / 2, last = i === li;
    g += `<text x="${cx}" y="166" text-anchor="middle" class="qx">${esc(labels[i])}</text>`;
    if (v == null) return;
    const y = v >= 0 ? zero - v * sc : zero, h = Math.max(1, Math.abs(v) * sc);
    g += `<rect x="${cx - bw * 0.32}" y="${y}" width="${bw * 0.64}" height="${h}" rx="2" fill="${v < 0 ? "var(--bad)" : est?.[i] ? "var(--axis)" : color}" opacity="${last || est?.[i] ? 1 : 0.55}"/>`;
    g += `<text x="${cx}" y="${v >= 0 ? y - 4 : y + h + 11}" text-anchor="middle" class="qv${last ? " b" : ""}">${n(v / dv, dg)}</text>`;
  });
  if (line) {
    const lv = line.filter((v) => v != null), lh = Math.max(...lv), ll = Math.min(...lv), ls = 34 / ((lh - ll) || 1);
    const pts = line.map((v, i) => (v == null ? null : [x0 + bw * i + bw / 2, 56 - (v - ll) * ls]));
    const seg = pts.filter(Boolean);
    if (seg.length > 1) g += `<polyline points="${seg.map((p) => p.join(",")).join(" ")}" fill="none" stroke="var(--ink)" stroke-width="2"/>`;
    pts.forEach((p, i) => { if (p) g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/><text x="${p[0]}" y="${clearY(pts, i)}" text-anchor="middle" class="qv${i === li ? " b hi" : ""}"${line[i] < 0 ? ' style="fill:var(--bad-ink)"' : ""}>${n(line[i], 0)}%</text>`; });
  }
  const [bn, ln] = title.split(" & ");
  g += tipCols((i) => x0 + bw * i + bw / 2, bw, 0, 172, labels.map((l, i) => `${l}${est?.[i] ? " (예상)" : ""}\n${bn}: ${bars[i] == null ? "-" : n(bars[i] / dv, dg) + un}${line ? `\n${ln || "비율"}: ${line[i] == null ? "-" : n(line[i], 1) + "%"}` : ""}`));
  return `<div class="qp"><div class="qt"><b>${title} <span class="src">${un}</span></b>${qTag(tag)}</div><svg viewBox="0 0 ${W} 172" role="img" aria-label="${esc(title)}">${g}</svg></div>`;
}
function qTag(tag) { return tag ? `<span class="qtag${/-|적자|둔화|역성장|하락/.test(tag) ? " bad" : /늘어|줄어|CapEx/.test(tag) ? " warn" : ""}">${esc(tag)}</span>` : ""; }
// 부문별 매출 → [[기간 끝, {부문: 비중%}, {부문: 금액}|null], …] 오래된 순. 한국은 비중(%)만 있어 음수(부문 간 내부거래 제거분)는 빼고 100%로 맞춤
const SEG_COL = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s7)", "var(--muted)"];
const nearDay = (a, b, days = 40) => Math.abs(new Date(a) - new Date(b)) < days * 864e5;
function segPeriods(seg) {
  if (!seg?.hist) return [];
  return Object.entries(seg.hist).map(([k, m]) => {
    const pos = Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]), o = {};
    pos.forEach(([s, v], i) => { const t = pos.length <= 6 || i < 5 ? s : "기타"; o[t] = (o[t] || 0) + v; });  // 화면에 6칸까지
    const tot = pos.reduce((a, [, v]) => a + v, 0);
    return [k.replace("/", "-"), Object.fromEntries(Object.entries(o).map(([s, v]) => [s, (v / tot) * 100])), seg.unit === "amt" ? o : null];
  }).filter(([, sh]) => Object.keys(sh).length > 1).sort(([a], [b]) => a.localeCompare(b));
}
const segAgo = (ps, k) => ps.find(([e]) => nearDay(e, new Date(k) - 365 * 864e5));
function segColors(ps) {  // 최근 비중이 큰 순서로 색을 정해 도넛·추이·돈의 흐름에서 같은 색
  const last = ps.at(-1)[1];
  const names = [...Object.keys(last).sort((a, b) => last[b] - last[a]), ...new Set(ps.flatMap(([, s]) => Object.keys(s)).filter((s) => !(s in last)))];
  return Object.fromEntries(names.map((s, i) => [s, SEG_COL[Math.min(i, SEG_COL.length - 1)]]));
}
const cut = (s, k) => (s.length > k ? s.slice(0, k - 1) + "…" : s);
// 부문별 매출 비중 도넛 + 1년 전 대비 (금액이 있으면 성장률, 비중만 있으면 %p)
function segDonut(ps, col, seg) {
  const [k, sh, amt] = ps.at(-1), pa = segAgo(ps, k), names = Object.keys(sh).sort((a, b) => sh[b] - sh[a]);
  const cx = 74, cy = 90, R = 62, r = 36, pt = (rr, a) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
  let a0 = -Math.PI / 2, g = "";
  names.forEach((s) => {
    const a1 = a0 + (sh[s] / 100) * 2 * Math.PI, big = a1 - a0 > Math.PI ? 1 : 0;
    g += `<path d="M${pt(R, a0)} A${R},${R} 0 ${big} 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 ${big} 0 ${pt(r, a0)} Z" fill="${col[s]}" stroke="var(--surface)" stroke-width="1.5"/>`;
    a0 = a1;
  });
  g += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" class="qv b">${esc(qLabel(k))}</text>`;
  const chg = (s) => (amt && pa?.[2]?.[s] > 0 ? (amt[s] / pa[2][s] - 1) * 100 : null), pp = (s) => (pa && !amt && pa[1][s] != null ? sh[s] - pa[1][s] : null);
  const rh = Math.min(27, 156 / names.length);
  names.forEach((s, i) => {  // 범례 두 줄: 부문 이름 / 비중 · 1년 전 대비
    const y = 18 + i * rh, c = chg(s), p = pp(s);
    const t2 = `${n(sh[s], 1)}%${c != null ? ` · ${c >= 0 ? "+" : ""}${n(c, 0)}% YoY` : p != null ? ` · ${p >= 0 ? "+" : ""}${n(p, 1)}%p` : ""}`;
    g += `<rect x="150" y="${y - 8}" width="9" height="9" rx="2" fill="${col[s]}"/><text x="164" y="${y}" class="qv b">${esc(cut(s, 13))}</text>`
      + `<text x="164" y="${y + 11}" class="qv"${(c ?? p) < 0 ? ' style="fill:var(--bad-ink)"' : ""}>${esc(t2)}</text>`;
  });
  let tag = "";
  if (pa) {
    const top0 = Object.keys(pa[1]).sort((a, b) => pa[1][b] - pa[1][a])[0];
    const best = names.map((s) => [s, chg(s) ?? pp(s)]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1])[0];
    tag = top0 !== names[0] ? `${cut(names[0], 8)} 최대 부문 등극` : best ? `${cut(best[0], 8)} ${best[1] >= 0 ? "+" : ""}${n(best[1], amt ? 0 : 1)}${amt ? "%" : "%p"}` : "";
  }
  const sub = amt ? "1년 전 대비 성장률" : `${esc(k.replace("-", "/"))} 보고서 비중`;
  return `<div class="qp"><div class="qt"><b>부문별 매출 비중 <span class="src">${sub}</span></b>${qTag(tag)}</div><svg viewBox="0 0 300 172" role="img" aria-label="부문별 매출 비중">${g}</svg></div>`;
}
// 부문별 매출 비중 추이 (100% 막대)
function segStack(ps, col) {
  const P = ps.slice(-6), W = 300, x0 = 14, bw = (W - 2 * x0) / P.length, top = 14, bot = 150;
  let g = "";
  P.forEach(([k, sh], i) => {
    const cx = x0 + bw * i + bw / 2, w = Math.min(bw * 0.62, 60);
    let y = bot;
    Object.keys(col).filter((s) => sh[s]).forEach((s) => {
      const h = (sh[s] / 100) * (bot - top);
      y -= h;
      g += `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="${h}" fill="${col[s]}"/>`;
      if (sh[s] >= 9) g += `<text x="${cx}" y="${y + h / 2 + 3.5}" text-anchor="middle" class="qv sw">${n(sh[s], 0)}%</text>`;
    });
    g += `<text x="${cx}" y="166" text-anchor="middle" class="qx">${esc(qLabel(k))}</text>`;
  });
  const a = P[0][1], b = P.at(-1)[1], up = Object.keys(b).map((s) => [s, b[s] - (a[s] || 0)]).sort((x, y) => y[1] - x[1])[0];
  const tag = up && up[1] >= 1 ? `${cut(up[0], 8)} 비중 +${n(up[1], 0)}%p` : "";
  return `<div class="qp"><div class="qt"><b>부문별 매출 비중 추이</b>${qTag(tag)}</div><svg viewBox="0 0 ${W} 172" role="img" aria-label="부문별 매출 비중 추이">${g}</svg></div>`;
}
// 🧩 제품·부문별 매출: 이번 분기 비중(도넛) · 분기별 비중(100% 막대) — 금액은 config/segments.yaml, 없으면 와이즈리포트 비중 (제품별 성장률 선은 ⭐ 성장률 한눈에)
const segQ = (e) => { const [y, m] = e.split("-"); return +m % 3 ? `${y.slice(2)}.${m}월` : qLabel(e); };  // 비중 추이와 같은 이름, 7월·10월 결산도 순서대로 (25.07월)
function segBlock(d) {
  const ps = segPeriods(d.seg);
  if (!ps.length) return "";
  const col = segColors(ps);
  return `<h3>🧩 제품·부문별 매출 <span class="src">${esc(d.seg.src || "")}</span></h3><div class="card"><div class="qgrid">${segDonut(ps, col, d.seg)}${ps.length > 1 ? segStack(ps, col) : ""}</div>
    ${ps.length < 2 ? `<div class="note src">보고서가 나올 때마다 한 칸씩 쌓여 비중 변화가 그려져요</div>` : ""}</div>`;
}
// [부문별 매출 →] 매출 → 매출원가 / 매출총이익 → 영업비용(연구개발·판매·관리·기타) / 영업이익
// prev = 1년 전 같은 분기 (YoY·마진 %p), segs = [[부문, 금액, YoY, 색, 비중%, 추정?], …]
function qSankey(q, usd, prev, segs) {
  const rev = q.rev, cogs = q.cogs ?? (q.gp != null ? rev - q.gp : null), gp = q.gp ?? (cogs != null ? rev - cogs : rev);
  const opex = q.opex ?? gp - q.op;
  const pos = (v) => (v != null && v > 0 ? v : 0);
  // 아마존처럼 물류(풀필먼트)·기술·인프라를 따로 내는 회사는 kpi.yaml qtr_add 의 ful·tni 로
  let items = [["물류(풀필먼트)", pos(q.ful), "ful"], ["기술·인프라", pos(q.tni), "tni"], ["연구개발", q.tni ? 0 : pos(q.rnd), "rnd"], ["판매·마케팅", pos(q.sm), "sm"], ["관리", pos(q.ga), "ga"]];
  if (!items.some(([, v]) => v) && q.sga) items = [["판매·관리", pos(q.sga), "sga"]];
  const known = items.reduce((a, [, v]) => a + v, 0);
  if (opex - known > opex * 0.02) items.push(["기타 영업비용", opex - known, null]);
  items = items.filter(([, v]) => v > 0);
  const sg = segs && segs.length > 1 ? segs : null;
  // 영업이익 → 순이익·법인세·영업외 (App Economy Insights 그림처럼 한 칸 더). 영업외 이익이 커서 순이익 > 영업이익이면 그림 대신 한 줄
  const ni = q.ni, tax = q.tax > 0 ? q.tax : 0, net4 = q.op > 0 && ni > 0 && ni <= q.op;
  // 휴대폰에서 글자가 작아지지 않게 좁게 (부문이 있거나 순이익 칸까지 그리면 넓은 그림을 옆으로 밀어 보기)
  const W = (sg ? 700 : 480) + (net4 ? 130 : 0), H = 240, T = (sg ? 46 : 20) + (net4 ? 34 : 0), k = H / rev, nw = 12;
  const x = (sg ? [244, 374, 504] : [58, 178, 308]).concat(net4 ? [(sg ? 504 : 308) + 150] : []);
  const pct = (v) => `${n((v / rev) * 100, 1)}%`;
  const yo = (key, v) => (key && prev?.[key] > 0 && v != null ? (v / prev[key] - 1) * 100 : null);
  const yoT = (g, tail = " YoY") => (g == null ? "" : `${g >= 0 ? "+" : ""}${n(g, 0)}%${tail}`);
  const pp = (key, v) => (key && prev?.[key] != null && prev.rev ? (v / rev - prev[key] / prev.rev) * 100 : null);
  const ppT = (d) => (d == null ? "" : `${d >= 0 ? "+" : ""}${n(d, 1)}%p`);
  const tone = (d) => (d == null ? "var(--muted)" : d >= 0 ? "var(--good-ink)" : "var(--bad-ink)");
  let low = T + H;  // 그림·글자가 내려간 가장 아래 (잘리지 않게 높이를 여기에 맞춤)
  let flows = "", nodes = "", labels = "";
  const band = (x1, a1, b1, x2, a2, b2, col) => { const m = (x1 + x2) / 2; flows += `<path d="M${x1},${a1} C${m},${a1} ${m},${a2} ${x2},${a2} L${x2},${b2} C${m},${b2} ${m},${b1} ${x1},${b1} Z" fill="${col}" opacity=".28"/>`; };
  const node = (xx, y, h, col) => { nodes += `<rect x="${xx}" y="${y}" width="${nw}" height="${Math.max(h, 1.5)}" fill="${col}" rx="2"/>`; };
  const lab = (xx, y, t1, t2, anchor = "start", col = "var(--ink)", t3 = "", c3 = "var(--muted)") => {
    labels += `<text x="${xx}" y="${y}" text-anchor="${anchor}" class="sk"><tspan font-weight="700" fill="${col}">${esc(t1)}</tspan><tspan x="${xx}" dy="14" class="sk2">${esc(t2)}</tspan>`
      + `${t3 ? `<tspan x="${xx}" dy="13" class="sk2" style="fill:${c3}">${esc(t3)}</tspan>` : ""}</text>`;
  };
  const gapOf = (t3) => (t3 ? 46 : 32);  // 글자 줄 수만큼 다음 칸을 띄움
  node(x[0], T, rev * k, "var(--ink-2)");
  const gR = yo("rev", rev);
  if (sg) {  // 부문 → 매출: 왼쪽에 부문 막대를 띄엄띄엄, 매출 막대로는 붙여서 들어감
    lab(x[0] + nw / 2, T - 26, "총매출", `${qMoney(rev, usd)}${gR != null ? " · " + yoT(gR) : ""}`, "middle");
    const xs = 124;
    let sy = T, ty = T;
    sg.forEach(([s, v, g, col, sh, est]) => {
      const h = (sh / 100) * H, t3 = g != null ? yoT(g) : "";
      band(xs + nw, ty, ty + h, x[0], sy, sy + h, col); node(xs, ty, h, col);
      lab(xs - 6, ty + 12, cut(s, 10), `${est ? "≈" : ""}${qMoney(v, usd)} · ${n(sh, 1)}%`, "end", "var(--ink)", t3, tone(g));
      low = Math.max(low, ty + h, ty + gapOf(t3));
      sy += h; ty += Math.max(h, gapOf(t3)) + 6;
    });
  } else lab(x[0] - 6, T + rev * k / 2 - 10, "매출", qMoney(rev, usd), "end", "var(--ink)", yoT(gR, ""), tone(gR));
  const noCogs = !(cogs > rev * 0.01);  // 네이버처럼 매출원가를 따로 안 나누는 회사
  const gH = (noCogs ? rev : pos(gp)) * k, cH = noCogs ? 0 : pos(cogs) * k, gY = T, cY = T + gH + 14;
  node(x[1], gY, gH, "var(--good)");
  band(x[0] + nw, T, T + gH, x[1], gY, gY + gH, "var(--good)");
  const dG = noCogs ? null : pp("gp", gp);
  lab(x[1] + nw + 6, gY + 12, "매출총이익", `${qMoney(noCogs ? rev : gp, usd)} · 마진 ${pct(noCogs ? rev : gp)}`, "start", "var(--good-ink)", dG != null ? `${ppT(dG)} YoY` : "", tone(dG));
  if (!noCogs) {
    node(x[1], cY, cH, "var(--bad)");
    band(x[0] + nw, T + gH, T + gH + cH, x[1], cY, cY + cH, "var(--bad)");
    lab(x[1] + nw + 6, cY + 12, "매출원가", `${qMoney(cogs, usd)} · 매출의 ${pct(cogs)}`, "start", "var(--bad-ink)", yoT(yo("cogs", cogs)));
    low = Math.max(low, cY + cH, cY + 46);
  }
  // 매출총이익 → 영업이익(위) + 비용들(아래)
  const outs = (q.op > 0 ? [["영업이익", q.op, "var(--good)", "var(--good-ink)", "op"]] : []).concat(items.map(([l, v, key]) => [l, v, "var(--bad)", "var(--bad-ink)", key]));
  let sy = gY, ty = T;
  const gpv = noCogs ? rev : gp;
  const tot = outs.reduce((a, [, v]) => a + v, 0), f = tot > gpv ? gpv / tot : 1;  // 영업손실이면 비용을 매출총이익 폭에 맞춰 줄여 그림
  // 영업이익 → 순이익(위) · 법인세 · 영업외·기타 (영업이익 막대 오른쪽 칸)
  let bot4 = T;
  if (net4) {
    const oth = q.op - ni - tax, n4 = [["순이익", ni, "var(--good)", "var(--good-ink)", "ni"]];
    if (tax) n4.push(["법인세", tax, "var(--bad)", "var(--bad-ink)", "tax"]);
    if (oth > q.op * 0.01) n4.push([tax ? "영업외·기타" : "세금·영업외", oth, "var(--bad)", "var(--bad-ink)", null]);
    const t4 = n4.reduce((a, [, v]) => a + v, 0), f4 = t4 > q.op ? q.op / t4 : 1;  // 작은 영업외 이익이 있으면 폭을 영업이익에 맞춤
    let s4 = T;
    n4.forEach(([l, v, col, ink, key]) => {
      const h = v * k * f * f4, g = yo(key, v);
      const t3 = key === "ni" ? [yoT(g), oth < 0 ? `영업외 이익 +${qMoney(-oth, usd)} 포함` : ""].filter(Boolean).join(" · ") : "";
      band(x[2] + nw, s4, s4 + h, x[3], bot4, bot4 + h, col); node(x[3], bot4, h, col);
      lab(x[3] + nw + 6, bot4 + 12, l, `${qMoney(v, usd)}${key === "ni" ? ` · 마진 ${pct(v)}` : key === "tax" ? "" : ` · 매출의 ${pct(v)}`}`, "start", ink, t3, tone(g));
      low = Math.max(low, bot4 + h, bot4 + gapOf(t3));
      s4 += h; bot4 += Math.max(h, gapOf(t3)) + 6;
    });
  }
  outs.forEach(([l, v, col, ink, key]) => {
    const h = v * k * f, d = pp(key, v);
    const t3 = key === "op" ? (d != null ? `${ppT(d)} YoY (1년 전 ${n((prev.op / prev.rev) * 100, 1)}%)` : "")
      : [yoT(yo(key, v)), d != null ? `(${ppT(d)})` : ""].filter(Boolean).join(" ");
    band(x[1] + nw, sy, sy + h, x[2], ty, ty + h, col); node(x[2], ty, h, col);
    const sub = `${qMoney(v, usd)} · ${key === "op" ? "마진" : "매출의"} ${pct(v)}`;
    if (key === "op" && net4) {  // 오른쪽은 순이익으로 가는 띠 자리라 글자는 막대 위에
      lab(x[2] + nw / 2, T - 40, l, sub, "middle", ink, t3, tone(d));
      sy += h; ty = Math.max(ty + h + 6, bot4 + 6);  // 아래 비용 글자가 순이익 띠와 겹치지 않게
      return;
    }
    lab(x[2] + nw + 6, ty + 12, l, sub, "start", ink, t3, key === "op" ? tone(d) : "var(--muted)");
    low = Math.max(low, ty + h, ty + gapOf(t3));
    sy += h; ty += Math.max(h, gapOf(t3)) + 6;  // 글자가 다음 칸과 겹치지 않게
  });
  const vh = low + 8;
  const loss = (q.op <= 0 ? `<div class="note" style="color:var(--bad-ink)">영업손실 ${qMoney(q.op, usd)} — 영업비용이 매출총이익보다 많아요</div>` : "")
    + (noCogs ? `<div class="note src">이 회사는 매출원가를 따로 나누지 않고 비용을 한꺼번에 영업비용으로 적어서, 매출 = 매출총이익으로 그렸어요.</div>` : "")
    + (sg?.some((s) => s[5]) ? `<div class="note src">≈ 부문 금액 = 이 분기 매출 × 보고서의 부문 비중 (회사가 분기별 부문 금액을 따로 안 줘서 나눠 본 추정)</div>` : "")
    + (q.op > 0 && ni > q.op ? `<div class="note src">순이익 ${qMoney(ni, usd)} — 영업외 이익(투자 평가이익 등)이 커서 영업이익보다 많아요 (⚠ 한 번만 있는 일일 수 있음)</div>` : "");
  const wide = sg || net4;
  const svg = `<svg viewBox="0 0 ${W} ${vh}" class="sankey${wide ? " wide" : ""}"${wide ? ` style="min-width:${Math.round((W * 6) / 7)}px"` : ""} role="img" aria-label="매출에서 순이익까지 돈의 흐름">${flows}${nodes}${labels}</svg>`;
  return (wide ? `<div class="sk-wrap">${svg}</div>` : svg) + loss;
}
// 최신 분기 실적(잠정) vs 컨센서스 — 8분기 막대, 마지막 분기는 회색(발표 전 예상) + 색(실적) 나란히
const kqFmt = (v) => (Math.abs(v) >= 10000 ? n(v / 10000, 1) + "조" : n(v, 0) + "억");  // 억원 → 1조 넘으면 '104.6조'
const kqF = (f, cur) => (cur === "USD" ? (f === "eps" ? (v) => "$" + n(v, 2) : (v) => qMoney(v, true)) : f === "eps" ? (v) => n(v, 0) + "원" : kqFmt);
function kqBars(title, qs, f, est, color, cur, opt = {}) {  // opt.tag = 제목 옆 꼬리표 HTML, opt.sub = 제목 아래 한 줄
  const F = kqF(f, cur);  // 한국: EPS 원·나머지 억원 / 미국: 달러
  const W = 320, x0 = 44, x1 = W - 6, n0 = qs.length, bw = (x1 - x0) / n0;
  const ev = est && est[f] != null ? est[f] : null, vals = qs.map((q) => q[f]).concat(ev ?? []).filter((v) => v != null);
  const hi0 = Math.max(0, ...vals), lo0 = Math.min(0, ...vals), raw = (hi0 - lo0) / 4 || 1, p = 10 ** Math.floor(Math.log10(raw));
  const step = p * (raw / p <= 1 ? 1 : raw / p <= 2 ? 2 : raw / p <= 5 ? 5 : 10);  // 눈금 간격 (1·2·5 단위)
  const hi = Math.ceil((hi0 * 1.08) / step) * step || step, lo = lo0 < 0 ? Math.floor((lo0 * 1.3) / step) * step : 0;  // 음수 막대 아래 숫자 자리
  const top = 30, bot = 150, sc = (bot - top) / (hi - lo), Y = (v) => bot - (v - lo) * sc, zero = Y(0);
  // 막대 위 숫자는 단위 없이 짧게 (단위는 제목 옆) — 휴대폰에서 옆 칸 숫자와 안 겹치게
  const big = Math.max(1, ...vals.map(Math.abs));
  const [div, unit, dg] = f === "eps" ? [1, cur === "USD" ? "$" : "원", cur === "USD" ? 2 : 0] : cur === "USD" ? [1e9, "$B", 1] : big >= 1e4 ? [1e4, "조원", 1] : [1, "억원", 0];
  const SV = (v) => n(v / div, dg);
  let g = "";
  for (let t = lo; t <= hi + step / 2; t += step) g += `<line x1="${x0}" x2="${x1}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)"/><text x="${x0 - 4}" y="${Y(t) + 3}" text-anchor="end" class="qx">${F(t)}</text>`;
  g += `<line x1="${x0}" x2="${x1}" y1="${zero}" y2="${zero}" stroke="var(--axis)"/>`;
  const bar = (cx, w, v, fill) => { const y = v >= 0 ? Y(v) : zero; return `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="${Math.max(1, Math.abs(Y(v) - zero))}" rx="2" fill="${v < 0 ? "var(--bad)" : fill}"/>`; };
  const lab = (cx, y, v, cls, fill) => `<text x="${cx}" y="${y}" text-anchor="middle" class="${cls}"${fill ? ` style="fill:${fill}"` : ""}>${SV(v)}</text>`;
  const ly = (v) => (v >= 0 ? Y(v) - 4 : zero + Math.abs(Y(v) - zero) + 11);
  const li = qs.map((q) => !q.est).lastIndexOf(true);  // 연간 보기: 추정 연도(E)는 회색, 마지막 실적 연도를 색으로
  qs.forEach((q, i) => {
    const cx = x0 + bw * i + bw / 2, last = i === li;
    g += `<text x="${cx}" y="166" text-anchor="middle" class="qx">${esc(q.q)}</text>`;
    if (q[f] == null) {  // 실적이 아직 없는 칸 (잠정실적엔 EPS 가 없음): 예상만 회색으로, 실적 자리는 비워 둠
      if (last && ev != null) g += bar(cx - bw * 0.21, bw * 0.38, ev, "var(--muted)") + lab(cx - bw * 0.21, ly(ev), ev, "qv", "var(--muted)");
      return;
    }
    if (q.est) { g += bar(cx, bw * 0.5, q[f], "var(--axis)") + lab(cx, ly(q[f]), q[f], "qv", "var(--muted)"); return; }
    if (last && ev != null) {  // 예상(진한 회색) vs 실적(색) 막대 나란히 — 숫자는 각 막대 바로 위 가운데, 높이가 비슷해 겹치면 큰 값 숫자를 한 줄 위로 (텔레그램 실적 알림 그림처럼, 사용자 11/6)
      const xe = cx - bw * 0.21, xa = cx + bw * 0.21, v = q[f];
      let ye = ly(ev), ya = ly(v);
      if (Math.abs(ye - ya) < 11 && (ev >= 0) === (v >= 0)) {
        if (ev >= 0) { if (v >= ev) ya = ye - 11; else ye = ya - 11; }  // 위로 쌓기
        else if (v <= ev) ya = ye + 11; else ye = ya + 11;  // 음수는 막대 아래라 더 작은 값을 한 줄 아래로
      }
      g += bar(xe, bw * 0.38, ev, "var(--muted)") + bar(xa, bw * 0.38, v, color) + lab(xe, ye, ev, "qv", "var(--muted)") + lab(xa, ya, v, "qv b", color);
    } else g += bar(cx, bw * 0.5, q[f], last ? color : "var(--grid)") + lab(cx, ly(q[f]), q[f], last ? "qv b" : "qv", last ? (q[f] < 0 ? "var(--bad)" : color) : null);
  });
  g += tipCols((i) => x0 + bw * i + bw / 2, bw, 0, 172, qs.map((q, i) => `${q.q}${q.est ? " (예상 E)" : ""}\n${title}: ${q[f] == null ? "-" : SV(q[f]) + unit}${i === li && ev != null ? `\n예상(컨센서스): ${SV(ev)}${unit}` : ""}`));
  const s = ev != null && ev > 0 && qs[li]?.[f] != null ? (qs[li][f] / ev - 1) * 100 : null;  // 마지막 실적 분기 (뒤에 예상 E 가 붙어도)
  const tag = s == null ? "" : `<span class="qtag${s < 0 ? " bad" : ""}">예상대비 ${s >= 0 ? "+" : ""}${n(s, 1)}%</span>`;
  return `<div class="qp"><div class="qt"><b>${title} <span class="src">${unit}</span></b>${tag || opt.tag || ""}</div>${opt.sub ? `<div class="src">${opt.sub}</div>` : ""}<svg viewBox="0 0 ${W} 172" role="img" aria-label="${esc(title)}">${g}</svg>
    ${ev != null || qs.some((q) => q.est) ? `<div class="src" style="text-align:right;padding:0 4px 4px"><span style="color:var(${ev != null ? "--muted" : "--axis"})">■</span> ${ev != null ? `예상(컨센서스)${qs[li]?.[f] != null || li < 0 ? ` <b>${SV(ev)}</b>` : ""}` : "추정(E)"} · <span style="color:${color}">■</span> 실적${ev != null && qs[li]?.[f] != null ? ` <b style="color:${color}">${SV(qs[li][f])}</b>` : ""}</div>` : ""}</div>`;
}
// 분기 / 연간 실적 막대 — 한국은 영업이익을 맨 앞에 (연간 = 와이즈리포트 연간 실적 + 추정 E)
const KQ_MAP = {};
function kqCharts(k, mode) {
  // 분기 보기: 최근 5분기 실적 + 다음 분기들 예상(E, 와이즈리포트) — 연간 보기처럼 8칸
  const a = mode === "y" && k.annual?.length, qs = a ? k.annual.slice(-8) : k.fwd?.length ? k.quarters.slice(-5).concat(k.fwd) : k.quarters;
  const u = a ? "연간" : "분기", est = a ? null : k.est_bar;
  // 한국·미국 모두 매출액 → 영업이익 → EPS (연간은 EPS 대신 순이익) — 자료가 있는 항목만
  // 분기도 순이익을 영업이익과 EPS 사이에 (잠정실적·컨퍼런스콜엔 순이익은 있는데 EPS 는 정기보고서 때 나옴)
  const order = [["sales", "매출액", "var(--s1)"], ["op", "영업이익", "var(--good)"], ["ni", "당기순이익", "var(--s4)"], ...(a ? [] : [["eps", "EPS", "var(--s3)"]])];
  return order.filter(([f]) => qs.some((q) => q[f] != null)).map(([f, t, c]) => kqBars(`${t} (${u})`, qs, f, est, c, k.cur)).join("");
}
function kqBox(k, code) {
  KQ_MAP[code] = k;
  return `<div class="kqbox" data-code="${esc(code)}">${k.annual?.length ? `<div class="seg kseg" style="margin-top:8px"><button data-k="q" class="on">분기</button><button data-k="y">연간</button></div>` : ""}
    <div class="qgrid" style="margin-top:8px">${kqCharts(k, "q")}</div></div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".kqbox .kseg button"); if (!b) return;
  const box = b.closest(".kqbox");
  box.querySelectorAll(".kseg button").forEach((x) => x.classList.toggle("on", x === b));
  box.querySelector(".qgrid").innerHTML = kqCharts(KQ_MAP[box.dataset.code], b.dataset.k);
});
// 📋 IR 요약 · IR 분석 (config/ir_brief.yaml → data/ir_brief.json) — 사용자 11/6: 텔레그램 실적 알림 채널의 두 칸 형식 · 숫자·그래프 아래 · 두 칸 다 닫아 두고 누르면 펼침
let IRB = {};
// 📋 숫자로 먼저 (사용자 11/6 "IR 요약·분석 미리") — 회사 IR 요약이 아직 없는 분기는 잠정실적 숫자(k = kq)로만 만든 요약을 먼저, 발표가 끝나면 ir_brief.yaml 이 바꿔 넣음 (한국만)
const vsTag = (v) => (v == null ? "" : v >= 10 ? "서프라이즈" : v >= 3 ? "상회" : v > -3 ? "부합" : v > -10 ? "하회" : "쇼크");
function irAuto(k) {
  if (!k?.rows?.length || k.cur === "USD") return null;
  const R = Object.fromEntries(k.rows.map((r) => [r.f || { 매출액: "sales", 영업이익: "op", 순이익: "ni", 당기순이익: "ni" }[r.item], r])), F = (f, v) => kqF(f, k.cur)(v), P = (v, t) => (v == null ? "" : `${t} ${v >= 0 ? "+" : ""}${n(v, 1)}%`);
  const TT = Object.fromEntries(kqTurns(k).map((t, j) => [k.rows[j].item, t]));
  const line = (r) => { if (!r || r.act == null) return null; const t = TT[r.item] || {};
    return `${r.item}: ${F(r.f, r.act)} (${[t.vs ? `예상 ${F(r.f, r.est)} → ${t.vs}` : r.est != null && r.vs_est != null ? `예상 ${F(r.f, r.est)} 대비 ${r.vs_est >= 0 ? "+" : ""}${n(r.vs_est, 1)}% ${vsTag(r.vs_est)}` : "", t.qoq ? `QoQ ${t.qoq}` : P(r.qoq, "QoQ"), t.yoy ? `YoY ${t.yoy}` : P(r.yoy, "YoY")].filter(Boolean).join(" · ")})`; };
  const qs = k.quarters || [], at = (lb) => qs.find((q) => q.q === lb), i = qs.findIndex((q) => q.q === k.latest), om = (q) => (q?.sales > 0 && q.op != null ? (q.op / q.sales) * 100 : null);
  const m = [om(qs[i]), i > 0 ? om(qs[i - 1]) : null, om(at(qAgo(k.latest)))], mm = [m[1] != null ? `직전 분기 ${n(m[1], 1)}%` : "", m[2] != null ? `1년 전 ${n(m[2], 1)}%` : ""].filter(Boolean).join(" · ");
  const sum = [{ h: `${k.latest}${k.prelim ? " 잠정" : ""} 실적 · 연결`, l: [line(R.sales), line(R.op), m[0] != null ? `영업이익률: ${n(m[0], 1)}%${mm ? ` (${mm})` : ""}` : null, line(R.ni)].filter(Boolean) },
    { h: "다음 확인 사항", l: ["회사 설명·부문별 숫자·가이던스 — 회사 IR 자료·컨퍼런스콜이 정리되면 예약 작업이 이 칸을 바꿔 넣어요"] }];
  const o = R.op, s = R.sales, ni = R.ni, ana = [{ h: "한 줄 평가", l: [[o?.vs_est != null ? `영업이익 예상 대비 ${n(o.vs_est, 1)}% ${vsTag(o.vs_est)}` : "", s?.vs_est != null ? `매출 ${n(s.vs_est, 1)}% ${vsTag(s.vs_est)}` : ""].filter(Boolean).join(" · ") || "예상(컨센서스)이 없어 비교 못 함"] }];
  if ((k.points || []).length) ana.push({ h: "✦ 숫자로 본 점 (최근 5개 분기)", l: k.points });
  if (o?.qoq != null && ni?.qoq != null && (o.qoq > 0) !== (ni.qoq > 0)) ana.push({ h: "영업이익과 순이익의 차이", l: [`영업이익 QoQ ${n(o.qoq, 1)}% · 순이익 ${n(ni.qoq, 1)}% — 방향이 달라요. 영업 밖 손익(환율·이자·지분법·평가손익 등) 영향일 수 있어 분기보고서로 확인`] });
  return { quarter: k.latest, period: `${k.latest}${k.prelim ? " 잠정" : ""} · 숫자로 먼저`, date: k.filing?.date, src: "잠정실적 숫자로 자동 요약 (네이버·DART)", u: k.filing?.url, sum, ana, auto: true };
}
// 🧾 큰 숫자 카드 (사용자 11/11: 셀트리온제약·원익IPS 텔레그램 그림처럼, 보유·관심 전 종목) — 숫자는 잠정실적 표(k, 같은 분기일 때만), 글은 IR 요약·분석의 첫 줄들 · 한국식 오름 빨강·내림 파랑
function irCards(e, k) {
  const L = (re, nn = 2) => ((e.ana || []).concat(e.sum || []).find((s) => re.test(s.h || ""))?.l || []).filter((x) => typeof x === "string" && !/^잠정 공시|없음$/.test(x)).slice(0, nn);
  const ul = (a) => (a.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
  let N = null;
  if (k?.rows?.length && k.latest === String(e.quarter || "").replace(/^(\d)Q(\d\d)$/, "$2.$1Q")) {
    const T = kqTurns(k), qs = k.quarters || [], at = (lb) => qs.find((q) => q.q === lb), om = (q) => (q?.sales > 0 && q.op != null ? (q.op / q.sales) * 100 : null);
    const R = {}; k.rows.forEach((r, j) => { R[r.f || { 매출액: "sales", 영업이익: "op", 순이익: "ni", 당기순이익: "ni" }[r.item]] = { ...r, t: T[j].yoy }; });
    const Y = (r) => (!r ? null : r.t ? { s: r.t, up: /흑자|축소/.test(r.t) } : r.yoy == null ? null : { s: `${r.yoy >= 0 ? "+" : ""}${n(r.yoy, 1)}%`, up: r.yoy >= 0 });
    N = { R, Y, F: (r) => (r?.act == null ? "-" : kqF(r.f, k.cur)(r.act)), m: [om(at(k.latest)), om(at(qAgo(k.latest)))] };
  }
  const one = L(/회사 설명|실적 해석/, 1)[0], head = L(/한 줄 평가/, 1)[0];
  let s = "", a = "";
  if (N) {
    const { R, Y, F, m } = N, ys = Y(R.sales), yc = (y) => (y ? `<div class="${y.up ? "irU" : "irD"}">전년 동기 대비 ${esc(y.s)}</div>` : "");
    const col = (lb, r) => `<div><div class="irc-l">${lb}</div><b class="irc-big">${F(r)}</b>${yc(Y(r))}</div>`;
    s = `<div class="irc-box"><div class="irc-l">매출액</div><div class="irc-row"><b class="irc-big">${F(R.sales)}</b>${ys ? `<span class="irc-pill${ys.up ? "" : " pdn"}">전년 동기 대비 ${esc(ys.s)}</span>` : ""}</div></div>
      <div class="irc-box irc-2">${col("영업이익", R.op)}${col("순이익", R.ni)}</div>`;
    const big = (lb, r) => { const y = Y(r); return `<div><div class="irc-l">${lb}</div><b class="${y ? (y.up ? "irU" : "irD") : ""}">${y ? esc(y.s) : "-"}</b></div>`; };
    a = `<div class="irc-box"><div class="irc-l c">전년 동기 대비</div><div class="irc-3">${big("매출액", R.sales)}${big("영업이익", R.op)}${big("순이익", R.ni)}</div>${m[0] != null ? `<div class="c" style="border-top:1px solid var(--border);padding-top:6px">영업이익률 ${m[1] != null ? `${n(m[1], 1)}% → ` : ""}<b>${n(m[0], 1)}%</b></div>` : ""}</div>`;
    if (m[0] != null || one) s += `<div class="irc-box">${m[0] != null ? `<div class="irc-row"><span class="irc-l" style="font-size:15px">영업이익률</span><b style="font-size:20px">${n(m[0], 1)}%</b></div>` : ""}${one ? `<div class="irc-one"${m[0] == null ? ' style="border:0;margin:0;padding:0"' : ""}>${esc(one)}</div>` : ""}</div>`;
  } else if (one) s = `<div class="irc-box"><div class="irc-one" style="border:0;margin:0;padding:0">${esc(one)}</div></div>`;
  const pos = L(/긍정/), neg = L(/우려/), nx = L(/다음 실적에서 볼 것/);
  a = (head ? `<div class="irc-box irc-head">${esc(head)}</div>` : "") + a + (pos.length || neg.length ? `<div class="irc-box irc-2"><div><b class="irU" style="font-size:17px">긍정</b>${ul(pos)}</div><div><b class="irD" style="font-size:17px">우려</b>${ul(neg)}</div></div>` : "") + (nx.length ? `<div class="irc-box"><div class="irc-l c">다음 실적에서 볼 것</div>${ul(nx)}</div>` : "");
  return { s: s && `<div class="irc">${s}</div>`, a: a && `<div class="irc">${a}</div>` };
}
function irBriefHTML(code, name, k) {
  let e = (IRB[code] || IRB[PREF_COMMON[code]] || [])[0];  // 우선주는 보통주 실적 그대로
  const qk = (q) => String(q || "").replace(/^(\d)Q(\d\d)$/, "$2.$1Q");  // '3Q26' → '26.3Q'
  if (k && (!e || qk(e.quarter) < k.latest)) e = irAuto(k) || e;  // 이번 분기 회사 IR 요약이 아직 없으면 숫자로 먼저
  if (!e) return "";
  const cd = irCards(e, k);
  const box = (t, secs, top = "") => `<details class="fvt"><summary class="chart-title"><b>${esc(name || code)} (${esc(code)}) ${t}</b> <span class="src">${esc(e.period || e.quarter || "")}</span></summary>${top}
    ${(secs || []).map((s) => `<div style="margin-top:6px"><b>${esc(s.h)}</b><ul class="irl">${(s.l || []).map((x) => (typeof x === "string" ? x : Object.entries(x || {}).map(([k, v]) => `${k}: ${v}`).join(" "))).map((x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`).join("")}</ul></div>`).join("")}</details>`;  // YAML 이 '제목: 글' 줄을 표로 읽어도 화면이 안 멈추게
  const src = e.u ? `<a href="${esc(e.u)}" target="_blank" rel="noopener">${esc(e.src || "회사 IR 자료")}</a>` : esc(e.src || "");
  return `<div class="card irbox" style="margin-top:8px;background:var(--surface-2)">${box("IR 요약", e.sum, cd.s)}${box("IR 분석", e.ana, cd.a)}
    <div class="src" style="margin-top:6px">📋 ${esc(e.date || "")} · ${src} · ${e.auto ? "회사 설명·해석은 발표가 끝나면 예약 작업이 바꿔 넣어요" : "증감률·이익률은 발표 숫자로 계산한 값"} · 분석은 해석이고 매매 추천이 아니에요</div></div>`;
}
// ✦ 포인트 (collector/kq.py points — 텔레그램 실적 알림과 같은 규칙: 5개 분기 최대·영업이익률 / QoQ 엇갈림·동반 성장)
const kqPtHTML = (k) => ((k.points || []).length ? `<div class="kqpt" style="margin-top:8px"><b>✦ 포인트</b> <span class="src">최근 5개 분기 기준</span><ul class="irl">${k.points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "");
// 실적 · 예상 · 예상 대비 · QoQ · YoY 표 (상세 화면과 첫 화면 '🧾 실적 발표' 같이 씀)
// 흑자전환·적자전환·적자축소·적자확대 — 0 이하가 끼면 % 대신 말로 (텔레그램 실적 알림처럼, 사용자 11/6 CJ CGV 순이익 YoY '흑자전환')
const turnTxt = (a, b) => (a == null || b == null || (a > 0 && b > 0) ? null : b <= 0 && a > 0 ? "흑자전환" : a <= 0 && b > 0 ? "적자전환" : a > b ? "적자축소" : a < b ? "적자확대" : "적자지속");
function kqTurns(k) {  // 줄마다 {vs, qoq, yoy} 말 (null 이면 % 로)
  const qs = k.quarters || [], i = qs.findIndex((q) => q.q === k.latest), cur = qs[i], prev = i > 0 ? qs[i - 1] : null, ago = qs.find((q) => q.q === qAgo(k.latest));
  return (k.rows || []).map((r) => { const f = r.f || { 매출액: "sales", 영업이익: "op", 순이익: "ni", 당기순이익: "ni" }[r.item];
    return { vs: r.act != null && r.est != null && (r.act > 0) !== (r.est > 0) ? (r.act > 0 ? "흑자(예상 적자)" : "적자(예상 흑자)") : null, qoq: turnTxt(cur?.[f], prev?.[f]), yoy: turnTxt(cur?.[f], ago?.[f]) }; });
}
function kqTable(k) {
  const P = (v) => (v == null ? "-" : `<span class="${v < 0 ? "neg" : ""}">${v >= 0 ? "+" : ""}${n(v, 1)}%</span>`), T = kqTurns(k);
  const C = (t, v) => (t ? `<span class="${/^적자(?!축소)/.test(t) ? "neg" : ""}">${t}</span>` : P(v));
  return `<div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">${esc(k.latest)}${k.prelim ? " 잠정" : ""}</th><th>실적</th><th>예상</th><th>예상 대비</th><th>QoQ</th><th>YoY</th></tr></thead><tbody>
    ${k.rows.map((r, j) => `<tr><td>${esc(r.item)}</td><td><b>${r.act == null ? "-" : kqF(r.f, k.cur)(r.act)}</b></td><td>${r.est == null ? "-" : kqF(r.f, k.cur)(r.est)}</td><td>${C(T[j].vs, r.vs_est)}</td><td>${C(T[j].qoq, r.qoq)}</td><td>${C(T[j].yoy, r.yoy)}</td></tr>`).join("")}
  </tbody></table></div>`;
}
// 주가: 기간 탭 (1개월~1년 = 일봉 종가, 3년~10년 = 상세 데이터의 주봉 종가) — 부드러운 선 + 색 채움 + 오른쪽 눈금 + 마지막 가격
const PX_TABS = [[1, "1개월"], [3, "3개월"], [6, "6개월"], [12, "1년"], [36, "3년"], [60, "5년"], [120, "10년"], [999, "MAX"]];  // MAX = 받아 둔 주봉 전부
const PX_LONG = {};  // 코드 → 주봉 종가 (밴드 계산에 쓰는 가격)
function priceBox(c, m = 6, tag = "button") {  // 종목 카드는 카드 자체가 <button> 이라 탭을 span 으로 (button 안 button 은 HTML 이 깨짐)
  if (!c.chart?.dates?.length) return "";
  return `<div class="pbox" data-code="${esc(c.code)}"${tag === "span" ? ' data-btn="1"' : ""}><div class="seg pseg" style="margin-top:8px">${PX_TABS.map(([mm, l]) => `<${tag} data-m="${mm}" class="${mm === m ? "on" : ""}">${l}</${tag}>`).join("")}</div>
    <div class="pbox-in">${priceSpark(c, m, tag === "span")}</div></div>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest(".pbox .pseg [data-m]"); if (!b) return;
  const box = b.closest(".pbox"), c = DASH.stocks.find((x) => x.code === box.dataset.code), m = +b.dataset.m, el = box.querySelector(".pbox-in");
  box.querySelectorAll(".pseg [data-m]").forEach((x) => x.classList.toggle("on", x === b));
  if (m > 12 && !PX_LONG[c.code]) {
    el.innerHTML = `<div class="empty">불러오는 중…</div>`;
    try {
      const d = await (await fetch(`data/stocks/${c.code}.json?v=${encodeURIComponent(DASH.updated_at)}`)).json();
      const bd = Object.values(d.bands || {}).sort((x, y) => (x.dates?.length || 0) - (y.dates?.length || 0)).pop();
      PX_LONG[c.code] = bd ? { dates: bd.dates, close: bd.price } : null;
    } catch (_) { PX_LONG[c.code] = null; }
  }
  el.innerHTML = priceSpark(c, m, !!box.dataset.btn) || `<div class="empty">이 기간 주가 자료가 없어요.</div>`;
});
function priceSpark(c, months = 6, inBtn = false) {
  const ch = months > 12 ? PX_LONG[c.code] : c.chart, wk = months > 12;
  if (!ch?.dates?.length) return "";
  const end = new Date(ch.dates[ch.dates.length - 1]), cut = new Date(end); cut.setMonth(cut.getMonth() - months);
  const i0 = Math.max(0, ch.dates.findIndex((d) => d >= cut.toISOString().slice(0, 10)));
  const ds = ch.dates.slice(i0), v = ch.close.slice(i0), ok = v.filter((x) => x != null);
  if (ok.length < 5) return "";
  // 200일 이동평균선: 일봉은 수집기가 계산한 값, 주봉(3년~)은 40주 평균 (≈ 200거래일)
  const maAll = wk ? ch.close.map((_, i, a) => (i >= 39 ? a.slice(i - 39, i + 1).reduce((s, x) => s + (x || 0), 0) / 40 : null)) : ch.ma200 || [];
  const ma = maAll.slice(i0), mok = ma.filter((x) => x != null);
  const W = 640, x0 = 6, x1 = 560, top = 12, bot = 168;
  const lo0 = Math.min(...ok, ...mok), hi0 = Math.max(...ok, ...mok), raw = (hi0 - lo0) / 4 || 1, p = 10 ** Math.floor(Math.log10(raw));
  const step = p * (raw / p <= 1 ? 1 : raw / p <= 2 ? 2 : raw / p <= 2.5 ? 2.5 : raw / p <= 5 ? 5 : 10);
  const lo = Math.floor(lo0 / step) * step, hi = Math.ceil(hi0 / step) * step;
  const X = (i) => x0 + ((x1 - x0) * i) / (v.length - 1), Y = (y) => bot - ((y - lo) / (hi - lo || 1)) * (bot - top);
  const pts = v.map((y, i) => [X(i), Y(y ?? ok[0])]);
  let d = `M${pts[0][0]},${pts[0][1]}`;  // 곡선 (Catmull-Rom → 베지어)
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i - 1] || pts[i], b = pts[i], c2 = pts[i + 1], e = pts[i + 2] || c2;
    d += ` C${b[0] + (c2[0] - a[0]) / 6},${b[1] + (c2[1] - a[1]) / 6} ${c2[0] - (e[0] - b[0]) / 6},${c2[1] - (e[1] - b[1]) / 6} ${c2[0]},${c2[1]}`;
  }
  const gid = `pg-${c.code}`, last = pts[pts.length - 1], cur = c.currency === "USD" ? "$" : "";
  let g = "";
  for (let t = lo; t <= hi + step / 2; t += step) g += `<line x1="${x0}" x2="${x1}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)"/><text x="${x1 + 8}" y="${Y(t) + 4}" class="qx" style="font-size:11px">${cur}${n(t, t < 100 ? 1 : 0)}</text>`;
  const xl = (i, t) => `<text x="${X(i)}" y="${bot + 18}" text-anchor="middle" class="qx" style="font-size:11px">${t}</text>`;
  ds.forEach((dt, i) => {
    if (months <= 1) { if (i % 5 === 2) g += xl(i, `${+dt.slice(5, 7)}/${+dt.slice(8)}`); }  // 1개월: 주마다 날짜
    else if (wk) { if (i && dt.slice(0, 4) !== ds[i - 1].slice(0, 4)) g += xl(i, `${dt.slice(2, 4)}년`); }  // 3년 이상: 해 바뀔 때
    else if (i && dt.slice(5, 7) !== ds[i - 1].slice(5, 7)) g += xl(i, `${dt.slice(5, 7)}월`);
  });
  const lbl = (PX_TABS.find((x) => x[0] === months) || [0, `${months}개월`])[1];
  const tl = trendLines(v, wk, c, (i) => X(i), Y, x1), cid = `tl-${c.code}-${months}`;
  g += `<clipPath id="${cid}"><rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bot - top}"/></clipPath><g clip-path="url(#${cid})">${tl.svg}</g>`;  // 늘린 선이 그림 밖으로 안 나가게
  if (inBtn) tl.note = tl.short || "";  // 카드 전체가 <button> 이면 접는 칸이 안 열려서 한 줄 요약만 (자세히는 종목 상세·실적 탭)
  const maPts =ma.map((y, i) => (y == null ? null : [X(i), Y(y)])), mseg = maPts.filter(Boolean);
  const maPath = mseg.length > 1 ? `<path d="${mseg.map((p, j) => `${j ? "L" : "M"}${p[0]},${p[1]}`).join(" ")}" fill="none" stroke="var(--s2)" stroke-width="2" stroke-dasharray="6 3"/>` : "";
  return `<div class="qp" style="margin-top:8px"><div class="qt"><b>주가 (${lbl}, ${wk ? "주봉" : "일봉"} 종가)</b>${wk && new Date(ds[0]) - cut > 60 * 864e5 ? `<span class="src">${esc(ds[0])} 부터 (자료 있는 기간)</span>` : ""}</div>
    ${ma200Line(c)}<svg viewBox="0 0 ${W} 192" role="img" aria-label="${esc(c.name)} 주가 ${months}개월">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--s1);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--s1);stop-opacity:.03"/></linearGradient></defs>
    ${g}<path d="${d} L${last[0]},${bot} L${x0},${bot} Z" fill="url(#${gid})"/><path d="${d}" fill="none" stroke="var(--s1)" stroke-width="2.5"/>${maPath}
    <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="var(--s1)"/><rect x="${x1 + 3}" y="${last[1] - 10}" width="${W - x1 - 4}" height="20" rx="4" fill="var(--s1)"/><text x="${x1 + 8}" y="${last[1] + 5}" class="qv b" style="fill:#fff;font-size:13px">${cur}${n(v[v.length - 1], cur ? 2 : 0)}${cur ? "" : "원"}</text></svg>${tl.note}</div>`;  // 지금 값은 오른쪽 눈금 자리에 꼬리표로 (선을 안 가리게)
}
// 📐 선 읽기 칸 안 캔들 차트 (사용자 11/7 "일봉·주봉·월봉 + 거래량, 지지·저항·피보나치·채널 온전히") — data/ohlc/{코드}.json (collector/ohlc.py)
// 꼭짓점 = 고가·저가 · 주봉·월봉은 로그 눈금이라 선도 로그 가격으로 계산 (그림에서 곧게 보이게)
// 이평선 (사용자 11/7): 일봉 20·60·120·200일 · 주봉 4·13·26·52주 · 월봉 5개월 — 색은 [기간, 색] (그림 아래 범례와 같음)
// 일봉 색 (사용자 11/7 다시): 20일 빨강 · 50일 보라 · 100일 주황 · 200일 검정
const TA_TF = [["d", "일봉", 250, 21, [[20, "var(--bad)"], [50, "var(--s7)"], [100, "var(--warn)"], [200, "var(--ink)"]]],
  ["w", "주봉", 156, 4.33, [[4, "var(--bad)"], [13, "var(--s4)"], [26, "var(--s3)"], [52, "var(--s7)"]]], ["m", "월봉", 150, 1, [[5, "var(--s3)"]]]], OHLC = {};
function taAnalyze(full, kind, c) {
  const [, , view, pm, mas] = TA_TF.find((x) => x[0] === kind), M = full.c.length, s0 = Math.max(0, M - view);
  const ma = Object.fromEntries(mas.map(([k]) => [k, full.c.map((_, i) => (i >= k - 1 ? full.c.slice(i - k + 1, i + 1).reduce((a, b) => a + b, 0) / k : null)).slice(s0)]));
  const ch = { ...Object.fromEntries(["t", "o", "h", "l", "c", "v"].map((k) => [k, full[k].slice(s0)])), ma, maCol: Object.fromEntries(mas) }, N = ch.c.length;
  const lg = kind !== "d", F = (v) => (lg ? Math.log(v) : v), I = (v) => (lg ? Math.exp(v) : v), last = ch.c[N - 1];
  const w = kind === "d" ? 5 : kind === "w" ? 3 : 2, tol = kind === "d" ? 0.025 : kind === "w" ? 0.04 : 0.06;
  const piv = (arr, hi) => { const o = []; for (let i = w; i < N - 1; i++) { const s = arr.slice(i - w, Math.min(N, i + w + 1)); if (arr[i] === (hi ? Math.max(...s) : Math.min(...s)) && (!o.length || i - o.at(-1) > w)) o.push(i); } return o; };
  const PH = piv(ch.h, true), PL = piv(ch.l, false), fmt = c.currency === "USD" ? (v) => `$${n(v, 2)}` : (v) => n(Math.round(v / (v >= 10000 ? 100 : 1)) * (v >= 10000 ? 100 : 1), 0);
  const pp = (v) => pct((v / last - 1) * 100, 1, true);
  const per = (s) => (lg ? (Math.exp(s * pm) - 1) * 100 : ((s * pm) / last) * 100);  // 기울기 → 한 달에 몇 %
  const iA = ch.h.indexOf(Math.max(...ch.h)), iC = ch.l.indexOf(Math.min(...ch.l)), lines = [], g = [], leg = [];
  const COL = { r: "var(--bad)", s: "var(--s1)", f: "#d6409f" }  /* 피보 = 분홍 (50일선 보라와 안 겹치게) */, SW = (col, dash) => `<span style="display:inline-block;width:16px;height:0;border-top:3px ${dash ? "dashed" : "solid"} ${col};vertical-align:middle;margin-right:4px"></span>`;
  // 채널: 하락 구조(최고점이 먼저) = 고점선(최고점 → 뒤 꼭짓점 중 다른 고점이 모두 아래인 선) + 평행선(최고점 뒤 최저점) · 상승 구조 = 저점선 + 평행선
  let ch2 = null;
  // 최고점이 저점보다 뒤여도, 최고점 뒤로 12% 넘게 빠졌으면 지금은 하락 구조 (삼양식품 9월 고점 → 11월)
  const dropA = 1 - Math.min(...ch.l.slice(iA)) / ch.h[iA], down = iA < iC || (iA < N - 2 * w && dropA >= 0.12);
  if (down) {
    const B = PH.filter((i) => i > iA + w).map((i) => [i, (F(ch.h[i]) - F(ch.h[iA])) / (i - iA)]).sort((a, b) => b[1] - a[1])[0];
    if (B) { const lo = Math.min(...ch.l.slice(iA).map((v, j) => F(v) - B[1] * j)); ch2 = { kind: "하락", s: B[1], a: iA, b: B[0], top: (i) => F(ch.h[iA]) + B[1] * (i - iA), bot: (i) => lo + B[1] * (i - iA) }; }
  } else {
    const D = PL.filter((i) => i > iC + w).map((i) => [i, (F(ch.l[i]) - F(ch.l[iC])) / (i - iC)]).sort((a, b) => a[1] - b[1])[0];
    if (D) { const hi = Math.max(...ch.h.slice(iC).map((v, j) => F(v) - D[1] * j)); ch2 = { kind: "상승", s: D[1], a: iC, b: D[0], bot: (i) => F(ch.l[iC]) + D[1] * (i - iC), top: (i) => hi + D[1] * (i - iC) }; }
  }
  const rs = (P, arr) => (P.length >= 2 ? (F(arr[P.at(-1)]) - F(arr[P.at(-2)])) / (P.at(-1) - P.at(-2)) : null), sH = rs(PH, ch.h);
  if (ch2) {
    const main = ch2.kind === "하락" ? ch2.top : ch2.bot, now = I(main(N - 1));
    g.push(`<path d="M${ch2.a},${I(ch2.top(ch2.a))}L${N - 1},${I(ch2.top(N - 1))}" data-t="${ch2.kind === "하락" ? "채널 고점선" : "채널 평행선(위)"}"/>`, `<path d="M${ch2.a},${I(ch2.bot(ch2.a))}L${N - 1},${I(ch2.bot(N - 1))}" data-t="${ch2.kind === "하락" ? "채널 평행선(아래)" : "채널 저점선"}"/>`);
    const flat = sH != null && ch2.kind === "하락" && (sH >= 0 || Math.abs(sH) < Math.abs(ch2.s) * 0.5);
    lines.push(`📐 <b>${ch2.kind} 채널</b> · ${ch2.kind === "하락" ? "고점선" : "저점선"} 기울기 한 달 ${pct(per(ch2.s), 1, true)}${sH != null ? ` · 최근 고점 두 개를 이은 기울기 ${pct(per(sH), 1, true)}${flat ? " → <b>완만해짐</b> (형님 원칙: 고점선이 완만해질수록 뚫고 오를 확률↑)" : ""}` : ""}`);
    if (ch2.kind === "하락" && last > now) { const k = ch.c.findIndex((v, i) => i > ch2.b && v > I(ch2.top(i))), vb = k >= 0 ? ch.v[k] / (ch.v.slice(Math.max(0, k - 20), k).reduce((a, b) => a + b, 0) / Math.min(20, k) || 1) : null;
      lines.push(`🔔 <b>하락 채널 고점선 위로 뚫음</b>${k >= 0 ? ` (${ch.t[k]}${vb ? `, 그날 거래량 20봉 평균의 ${n(vb, 1)}배${vb >= 2 ? " — 거래량 터진 돌파" : ""}` : ""})` : ""} · 지금 고점선 ${fmt(now)} (${pp(now)}) — 형님 원칙: 하락 채널 위를 뚫을 때 산 매매가 성공 확률이 높음`); }
    if (ch2.kind === "상승" && last < now) lines.push(`⚠ <b>상승 채널 저점선 아래로 깨짐</b> · 저점선 ${fmt(now)} (${pp(now)}) — 깨진 지지는 저항이 됨`);
    if (ch2.kind === "상승") { const hits = PL.filter((i) => i > ch2.a && Math.abs(F(ch.l[i]) - ch2.bot(i)) < tol).length; if (hits >= 3) lines.push(`⚠ 상승 채널 저점선을 <b>${hits}번</b> 맞음 — 형님 원칙: 3~4번 맞으면 다음엔 크게 깨질 확률↑`); }
  }
  // 지지·저항: 고가·저가 꼭짓점이 tol 안에서 2번 넘게 모인 가격 — 위 2개 = 저항, 아래 2개 = 지지 · 예전엔 지지(저점)였는데 지금 그 아래 = '깨진 지지 → 저항'
  const cl = [];
  [...PH.map((i) => [ch.h[i], "h", i]), ...PL.map((i) => [ch.l[i], "l", i])].sort((a, b) => a[0] - b[0]).forEach(([v, k, i]) => { const x = cl.find((q) => Math.abs(v / q.v - 1) < tol); if (x) { x.n++; x.v = (x.v * (x.n - 1) + v) / x.n; x[k]++; x.lastI = Math.max(x.lastI, i); } else cl.push({ v, n: 1, h: k === "h" ? 1 : 0, l: k === "l" ? 1 : 0, lastI: i }); });
  const far = kind === "d" ? 0.3 : kind === "w" ? 0.45 : 0.6, lv = cl.filter((q) => q.n >= 2 && Math.abs(q.v / last - 1) <= far), R =lv.filter((q) => q.v > last * 1.003).sort((a, b) => a.v - b.v).slice(0, 2), S = lv.filter((q) => q.v < last * 0.997).sort((a, b) => b.v - a.v).slice(0, 2);
  R.forEach((q) => { const brk = q.l >= 1 && q.l >= q.h; g.push(`<hr data-v="${q.v}" data-t="${brk ? "깨진 지지→저항" : "저항"} ${q.n}번 · ${fmt(q.v)}" data-c="r"/>`);
    leg.push([SW(COL.r, 1), `${brk ? "<b>깨진 지지 → 저항</b>" : "저항"} ${fmt(q.v)} (${pp(q.v)}) · <b>${q.n}번</b> 닿음${brk ? " — 형님 원칙: 실패한 매매라도 이 근처까지는 반등해 손실을 메울 수 있음" : q.n >= 3 ? " — 3번 넘게 부딪히면 뚫을 확률↑ (쌍봉·삼봉)" : ""}`]); });
  S.forEach((q) => { g.push(`<hr data-v="${q.v}" data-t="지지 ${q.n}번 · ${fmt(q.v)}" data-c="s"/>`); leg.push([SW(COL.s, 1), `지지 ${fmt(q.v)} (${pp(q.v)}) · <b>${q.n}번</b> 닿음${q.n >= 3 ? " — 지지를 3~4번 맞으면 다음엔 크게 깨질 확률↑" : ""}`]); });
  // 박스(횡보): 최근 d 60봉 · w 26봉 · m 12봉의 고가~저가 폭이 좁으면
  const K = kind === "d" ? 60 : kind === "w" ? 26 : 12, bh = Math.max(...ch.h.slice(-K)), bl = Math.min(...ch.l.slice(-K)), wide = (bh / bl - 1) * 100;
  if (wide < (kind === "d" ? 18 : kind === "w" ? 30 : 45)) { g.push(`<box data-a="${N - K}" data-hi="${bh}" data-lo="${bl}"/>`);
    const at = (last - bl) / (bh - bl || 1);
    leg.push([`<span style="display:inline-block;width:14px;height:10px;background:var(--warn);opacity:.35;vertical-align:middle;margin-right:4px"></span>`, `최근 ${K}${kind === "d" ? "일" : kind === "w" ? "주" : "개월"} <b>박스권</b> ${fmt(bl)} ~ ${fmt(bh)} (폭 ${n(wide, 0)}%) · 지금 박스의 ${n(at * 100, 0)}% 자리${at <= 0.25 ? " — <b>박스 하단</b>: 횡보장 원칙은 하단 매수 (장대 음봉이어도)" : at >= 0.75 ? " — <b>박스 상단</b>: 횡보장 원칙은 상단 매도 (거래량 터진 장대 양봉이어도)" : ""} · 횡보가 길어질수록 아래로 깰 때 더 크게 빠질 수 있음`]); }
  // 피보나치: 보이는 기간 최고점 → 그 뒤 최저점 (하락) 되돌림 38.2·50·61.8% · 아니면 최저점 → 그 뒤 최고점 (상승) 눌림
  const lowAfter = Math.min(...ch.l.slice(iA)), hiAfter = Math.max(...ch.h.slice(iC));
  if (down && lowAfter < ch.h[iA] * 0.85) { const H = ch.h[iA], L = lowAfter;
    [0.382, 0.5, 0.618].forEach((r) => g.push(`<hr data-v="${L + (H - L) * r}" data-t="피보 ${n(r * 100, 1)}%${r === 0.5 ? " · " + fmt(L + (H - L) * r) : ""}" data-c="${r === 0.5 ? "f" : "f2"}"/>`));
    leg.push([SW(COL.f, 1), `피보나치 (하락 되돌림): 고점 ${fmt(H)} (${ch.t[iA]}) → 저점 ${fmt(L)} · <b>50% = ${fmt(L + (H - L) / 2)}</b> (${pp(L + (H - L) / 2)}) · 38.2% ${fmt(L + (H - L) * 0.382)} · 61.8% ${fmt(L + (H - L) * 0.618)} — 하락장 원칙: 반등하면 1/2 자리를 먼저 봄`]); }
  else if (iC < iA && hiAfter > ch.l[iC] * 1.15) { const H = hiAfter, L = ch.l[iC];
    [0.382, 0.5, 0.618].forEach((r) => g.push(`<hr data-v="${H - (H - L) * r}" data-t="피보 눌림 ${n(r * 100, 1)}%${r === 0.5 ? " · " + fmt(H - (H - L) * r) : ""}" data-c="${r === 0.5 ? "f" : "f2"}"/>`));
    leg.push([SW(COL.f, 1), `피보나치 (상승 뒤 눌림): 저점 ${fmt(L)} → 고점 ${fmt(H)} · <b>50% 눌림 = ${fmt(H - (H - L) / 2)}</b> (${pp(H - (H - L) / 2)}) · 38.2% ${fmt(H - (H - L) * 0.382)} · 61.8% ${fmt(H - (H - L) * 0.618)}`]); }
  const run = ch.h[iA] / Math.min(...ch.l.slice(0, iA + 1));
  if (run >= 5) lines.push(`🚫 이 기간 저점에서 고점까지 약 <b>${n(run, 1)}배</b> — 형님 원칙: 짧게 5~10배 오른 종목은 1~2년 쉴 수 있어 쳐다보지 않음${["012450", "003230"].includes(c.code) ? " (단 한화에어로스페이스·삼양식품은 이 원칙에서 빼서 말씀하셨어요)" : ""}`);
  if (c.market !== "US" && c.market_cap && c.market_cap < 1e12) lines.push(`🚫 시가총액 약 ${n(c.market_cap / 1e8, 0)}억 — 형님 원칙: 1조 미만은 손대지 않음`);
  // over: 위 표식 → SVG (회색 채널 · 저항 빨강 점선 · 지지 파랑 점선 · 피보 보라 · 박스 연한 칸)
  // 숫자는 그림에 안 씀 (사용자 11/7 "숫자에 가려져서 보기 힘들어") — 그림 아래 범례(leg)에 색·값
  if (ch2) leg.unshift([SW("var(--ink-2)"), `채널 ${ch2.kind === "하락" ? "고점선" : "저점선"} 지금 ${fmt(I((ch2.kind === "하락" ? ch2.top : ch2.bot)(N - 1)))} (${pp(I((ch2.kind === "하락" ? ch2.top : ch2.bot)(N - 1)))}) · 평행선 ${fmt(I((ch2.kind === "하락" ? ch2.bot : ch2.top)(N - 1)))} (${pp(I((ch2.kind === "하락" ? ch2.bot : ch2.top)(N - 1)))})`]);
  // 선(또는 오른쪽 끝 점)을 누르면 그 선 가격이 뜸 (사용자 11/7 "지지선 얼마인지 저항선 얼마인지") — 다시 누르면 숨김
  const tap = (x1, y1, x2, y2, col, dash, v, t) => `<g class="tamk" onclick="event.stopPropagation();this.classList.toggle('on')"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.5" stroke-opacity=".8"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`
    + `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="14" pointer-events="stroke"/><circle cx="${x2}" cy="${y2}" r="7" fill="transparent"/><circle cx="${x2}" cy="${y2}" r="3.5" fill="${col}"/>`
    + `<text class="tamt" x="${x2 - 8}" y="${y2 - 6}" text-anchor="end" style="fill:${col}">${esc(t)} ${esc(fmt(v))} (${esc(pp(v))})</text></g>`;
  // 가장 최근 봉(당일 종가)을 잘 보이게: 굵은 몸통 + 검은 테두리 (사용자 11/7)
  const lastBar = (X, Y) => { const o = ch.o[N - 1], c2 = ch.c[N - 1], w = Math.max(5, (X(N - 1) - X(N - 2)) * 2.2), col = c2 >= o ? "var(--bad)" : "var(--s1)";
    return `<line x1="${X(N - 1)}" x2="${X(N - 1)}" y1="${Y(ch.h[N - 1])}" y2="${Y(ch.l[N - 1])}" stroke="${col}" stroke-width="1.8"/><rect x="${X(N - 1) - w / 2}" y="${Math.min(Y(o), Y(c2))}" width="${w}" height="${Math.max(2, Math.abs(Y(o) - Y(c2)))}" fill="${col}" stroke="var(--ink)" stroke-width="1.2"/>`; };
  const over = (X, Y) => lastBar(X, Y) + g.filter((s) => !s.includes('data-c="f2"')).map((s) => {
    if (s.startsWith("<path")) { const m = s.match(/M([\d.]+),([\d.e+-]+)L([\d.]+),([\d.e+-]+)/); return tap(X(+m[1]), Y(+m[2]), X(+m[3]), Y(+m[4]), "var(--ink-2)", "", +m[4], s.match(/data-t="([^"]*)"/)?.[1] || "채널"); }
    if (s.startsWith("<box")) { const a = +s.match(/data-a="(\d+)"/)[1], hi = +s.match(/data-hi="([\d.]+)"/)[1], lo = +s.match(/data-lo="([\d.]+)"/)[1]; return `<rect x="${X(a)}" y="${Y(hi)}" width="${X(N - 1) - X(a)}" height="${Y(lo) - Y(hi)}" fill="var(--warn)" fill-opacity=".08" stroke="var(--warn)" stroke-opacity=".4" stroke-dasharray="3 3"/>`; }
    const v = +s.match(/data-v="([\d.e+-]+)"/)[1], k = s.match(/data-c="(\w+)"/)[1], t = s.match(/data-t="([^"]*)"/)[1].split(" · ")[0];
    return tap(X(0), Y(v), X(N - 1), Y(v), COL[k], k === "f" ? "2 3" : "6 4", v, t);
  }).join("");
  return { ch, over, lines, fmt, leg, mas };
}
function taPanel(code, kind) {
  const d = OHLC[code], c = DASH.stocks.find((x) => x.code === code) || {};
  if (!d?.[kind]?.c?.length) return `<div class="src">이 봉 자료가 없어요</div>`;
  const a = taAnalyze(d[kind], kind, c), [, nm, view] = TA_TF.find((x) => x[0] === kind);
  const u = { d: "일", w: "주", m: "개월" }[kind];
  return `${candleSVG(a.ch, kind, a.fmt, null, a.over)}
    <div class="src" style="line-height:1.8">${a.mas.map(([k, col]) => `<span style="display:inline-block;width:16px;height:0;border-top:3px solid ${col};vertical-align:middle;margin-right:3px"></span>${k}${u}선`).join(" · ")} · 아래 막대 = 거래량</div>
    <div style="margin-top:4px;line-height:1.7">${a.leg.map(([sw, t]) => `<div>${sw} ${t}</div>`).join("")}</div>
    <div class="src">${nm} 최근 ${a.ch.c.length}봉${kind !== "d" ? " · 로그 눈금" : ""} · 👆 선이나 선 오른쪽 끝 점을 누르면 그 가격이 떠요 (다시 누르면 숨김) · 괄호 = 지금 가격 대비 · ${esc(d.at || "")}</div>
    <ul class="irl" style="margin-top:6px">${a.lines.map((x) => `<li>${x}</li>`).join("") || "<li>뚜렷한 선이 없어요</li>"}</ul>`;
}
function taTab(b) {  // 버튼 onclick (선 읽기 칸이 카드 눌림을 막느라 클릭을 위로 안 올려서)
  const box = b.closest(".tabox"); box.querySelectorAll(".taseg [data-tf]").forEach((x) => x.classList.toggle("on", x === b));
  box.querySelector(".tain").innerHTML = taPanel(box.dataset.code, b.dataset.tf);
}
document.addEventListener("toggle", async (e) => {  // 📐 선 읽기를 열 때 그 종목 캔들 자료를 받음
  const box = e.target.querySelector?.(":scope > .tabox"); if (!box || !e.target.open || box.dataset.done) return;
  box.dataset.done = 1;
  const code = box.dataset.code;
  try { OHLC[code] = OHLC[code] || await (await fetch(`data/ohlc/${code}.json?v=${encodeURIComponent(DASH.updated_at)}`)).json(); } catch (_) { OHLC[code] = null; }
  if (!OHLC[code]) { box.remove(); return; }  // 자료가 아직 없으면 아래 종가 선 읽기만
  box.hidden = false; e.target.querySelector(".tlold")?.setAttribute("hidden", "");
  box.querySelector(".tain").innerHTML = taPanel(code, "d");
}, true);
// 📐 회색 연한 선 (사용자 11/7, 차트 10년 본 형님에게 배운 것): 고점끼리·저점끼리 이은 채널 · 여러 번 닿은 지지·저항 · 고점에서 내린 폭의 50% (피보나치)
// 종가만 있어서 종가 꼭짓점으로 계산 (장중 고가·저가 아님) — 그림 아래 닫힌 칸에 읽는 법
function trendLines(v, wk, c, X, Y, x1) {
  const N = v.length, f = [];
  v.forEach((y, i) => f.push(y ?? f[i - 1] ?? v.find((z) => z != null)));
  if (N < 30) return { svg: "", note: "" };
  const w = Math.max(3, Math.round(N / 20)), pm = wk ? 4.33 : 21, last = f[N - 1];
  const piv = (hi) => { const o = []; for (let i = w; i < N - Math.max(2, Math.round(w / 2)); i++) { const s = f.slice(Math.max(0, i - w), i + w + 1); if (f[i] === (hi ? Math.max(...s) : Math.min(...s)) && (!o.length || i - o.at(-1)[0] > w)) o.push([i, f[i]]); } return o; };
  const H = piv(true), L = piv(false), ST = 'stroke="var(--muted)" stroke-opacity=".5" stroke-width="1.2"';
  let svg = "";
  const line = (P) => { if (P.length < 2) return null; const [a, b] = P.slice(-2), s = (b[1] - a[1]) / (b[0] - a[0]); return { a, s, at: (i) => b[1] + s * (i - b[0]), prev: P.length > 2 ? (P.at(-2)[1] - P.at(-3)[1]) / (P.at(-2)[0] - P.at(-3)[0]) : null }; };
  const up = line(H), dn = line(L);
  [up, dn].forEach((l) => { if (l) svg += `<line x1="${X(l.a[0])}" y1="${Y(l.at(l.a[0]))}" x2="${X(N - 1)}" y2="${Y(l.at(N - 1))}" ${ST}/>`; });
  // 지지·저항: 꼭짓점 가격이 3% 안에서 2번 넘게 모인 자리 → 지금 위 가장 가까운 = 저항, 아래 = 지지
  const pts = [...H, ...L].map((p) => p[1]).sort((a, b) => a - b), cl = [];
  pts.forEach((p) => { const k = cl.find((x) => Math.abs(p / x.v - 1) < 0.03); if (k) { k.n++; k.v = (k.v * (k.n - 1) + p) / k.n; } else cl.push({ v: p, n: 1 }); });
  const lv = cl.filter((x) => x.n >= 2), res = lv.filter((x) => x.v > last * 1.005).sort((a, b) => a.v - b.v)[0], sup = lv.filter((x) => x.v < last * 0.995).sort((a, b) => b.v - a.v)[0];
  const hl = (x) => { svg += `<line x1="${X(0)}" x2="${x1}" y1="${Y(x.v)}" y2="${Y(x.v)}" ${ST} stroke-dasharray="4 4"/>`; };  // 글자는 그림에 안 씀 (선을 가려서) — 값은 아래 📐 줄
  if (res) hl(res, `저항 ${res.n}번`);
  if (sup) hl(sup, `지지 ${sup.n}번`);
  // 피보나치: 보이는 기간 최고점 → 그 뒤 최저점, 15% 넘게 내렸으면 그 폭의 50% 자리
  const pk = f.indexOf(Math.max(...f)), after = f.slice(pk), tr = Math.min(...after), fib = pk < N - 3 && tr < f[pk] * 0.85 ? tr + (f[pk] - tr) / 2 : null;
  if (fib) hl({ v: fib }, "고점→저점 50%");
  // 읽기 (닫힌 칸)
  const mo = (s) => (s == null ? null : (s * pm / last) * 100), fx = (x) => (x >= 10000 ? n(Math.round(x / 100) * 100, 0) : n(x, x < 100 ? 2 : 0)), pp = (x) => pct((x / last - 1) * 100, 0, true);
  const kind = up && dn ? (up.s > 0 && dn.s > 0 ? "우상향 채널" : up.s < 0 && dn.s < 0 ? "우하향 채널" : up.s < 0 && dn.s > 0 ? "좁아지는 삼각형 (고점은 낮아지고 저점은 높아짐)" : "넓어지는 모양") : null;
  const li = [];
  if (kind) li.push(`채널: <b>${kind}</b> · 고점선 기울기 한 달 ${pct(mo(up.s), 1, true)}${up.prev != null ? ` (그 전 ${pct(mo(up.prev), 1, true)}${Math.abs(up.s) < Math.abs(up.prev) * 0.6 ? " → <b>완만해짐</b>" : ""})` : ""} · 저점선 한 달 ${pct(mo(dn.s), 1, true)}`);
  if (up && last > up.at(N - 1) * 1.01) li.push(`🔔 지금 가격이 <b>고점선 위</b> (${up.s < 0 ? "내려오던 채널 위로 뚫음 — 형님 원칙: 이때 성공 확률이 높고, 고점선이 완만해질수록 더 좋음" : "오르는 채널 위로 — 가파르면 바로 조정이 올 수 있음"})`);
  if (dn && last < dn.at(N - 1) * 0.99) li.push(`⚠ 지금 가격이 <b>저점선 아래</b> (지지가 깨짐 — 깨진 지지가 위에서 저항이 됨, 반등해도 그 근처까지)`);
  if (res) li.push(`저항 ${fx(res.v)} (지금보다 ${pp(res.v)}) · ${res.n}번 닿음${res.n >= 3 ? " — 3번 넘게 부딪히면 뚫을 확률이 높다고 봄" : ""}`);
  if (sup) li.push(`지지 ${fx(sup.v)} (${pp(sup.v)}) · ${sup.n}번 닿음${sup.n >= 3 ? " — 지지를 3~4번 맞으면 다음엔 크게 깨질 수 있다고 봄" : ""}`);
  if (fib) li.push(`피보나치: 보이는 기간 고점 ${fx(f[pk])} → 저점 ${fx(tr)} 의 50% = <b>${fx(fib)}</b> (${pp(fib)}) — 하락장에선 반등해도 이 근처까지를 먼저 봄`);
  const lo2 = Math.min(...f.slice(0, pk + 1)), run = f[pk] / lo2;
  if (run >= 5) li.push(`🚫 이 기간 저점에서 고점까지 약 <b>${n(run, 1)}배</b> — 형님 원칙: 짧은 기간 5~10배 오른 종목은 1~2년 쉴 수 있어 쳐다보지 않음`);
  if (c.market !== "US" && c.market_cap && c.market_cap < 1e12) li.push(`🚫 시가총액 약 ${n(c.market_cap / 1e8, 0)}억 — 형님 원칙: 국장은 1조 미만은 손대지 않음 (거래대금·수급 때문)`);
  if (!li.length) return { svg, note: "" };
  // 보유 탭 카드(카드 전체가 버튼이라 접는 칸이 안 열림)용 한 줄
  const sh = [kind && `${kind.split(" (")[0]}${up?.prev != null && Math.abs(up.s) < Math.abs(up.prev) * 0.6 ? " · 고점선 완만해짐" : ""}`, up && last > up.at(N - 1) * 1.01 && "🔔 고점선 돌파", dn && last < dn.at(N - 1) * 0.99 && "⚠ 저점선 이탈",
    res && `저항 ${fx(res.v)} (${pp(res.v)}, ${res.n}번)`, sup && `지지 ${fx(sup.v)} (${pp(sup.v)}, ${sup.n}번)`, fib && `50% ${fx(fib)} (${pp(fib)})`, run >= 5 && `🚫 ${n(run, 1)}배 급등`].filter(Boolean);
  return { svg, short: `<div class="src" style="padding:2px 4px 4px">📐 ${sh.join(" · ")} <span style="opacity:.7">— 회색 선 · 자세히는 종목 상세</span></div>`, note: `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title">📐 선 읽기 <span class="src">일봉·주봉·월봉 캔들 + 거래량 · 채널 · 지지·저항 · 피보나치 · 박스 (자동 계산 · 추천 아님)</span></summary>
    <div class="tabox" data-code="${esc(c.code)}" hidden><div class="seg taseg" style="margin-top:6px">${TA_TF.map(([k, l]) => `<button data-tf="${k}" class="${k === "d" ? "on" : ""}" onclick="taTab(this)">${l}</button>`).join("")}</div><div class="tain"><div class="src">불러오는 중…</div></div></div>
    <div class="tlold"><ul class="irl">${li.map((x) => `<li>${x}</li>`).join("")}</ul></div>
    <div class="note src">원칙 전체는 📈 차트 탭 맨 위 '📚 차트 원칙'. 선은 같은 규칙으로 자동으로 그어서 사람이 긋는 선과 다를 수 있어요.</div></details>` };
}
// 📈 200일 이동평균선 상태 (미국 주식에서 특히 중요): 🟢 선 위 + 선 오름 · 🟡 하나만 · 🔴 선 아래 + 선 내림 · 🔔 최근 아래→위로 다시 올라옴
function ma200Sig(m) { return !m ? null : m.gap >= 0 && m.rising && !m.turning ? "🟢" : m.gap < 0 && (!m.rising || m.turning) ? "🔴" : "🟡"; }
const ma200Dir = (m) => (m.rising && !m.turning ? "오르는 중" : m.rising ? "꺾이는 중 (최근 5일 하락)" : "내려가는 중");
function ma200Line(c) {
  const m = c.chart?.ma200_state;
  if (!m) return "";
  return `<div class="src" style="padding:0 2px">${ma200Sig(m)} <b style="color:var(--s2)">┅ 200일선</b> 이격 <b>${pct(m.gap, 1, true)}</b> (${m.gap >= 0 ? "선 위" : "선 아래"}) · 200일선 ${ma200Dir(m)}${m.cross_up ? ` · 🔔 <b>${esc(m.cross_up.slice(5).replace("-", "/"))} 200일선 위로 다시 올라옴</b> (이격이 0보다 커진 구간 — 메모해 둘 자리)` : ""}</div>`;
}
// 첫 화면: 최근 3일 안에 실적이 나온 보유·관심 종목 (예상 vs 실적 막대) + 잠정실적 공시는 났는데 숫자 반영을 기다리는 종목
// 🇰🇷 보유 탭엔 한국 종목만, 🇺🇸 보유 탭엔 미국 종목만 (실적 발표·쉬운 요약·일정) — 한국 코드는 숫자 6자리
const mktOf = (code) => (/^\d/.test(String(code || "")) ? "KR" : "US");
function renderTop() {
  $("#estAlert").innerHTML = saAlertHTML() + estAlertHTML();
  $("#patAlert").innerHTML = patAlertHTML();
  const own = (DASH?.stocks || []).filter((c) => grp(c) === "보유" && (c.market === "US" ? "US" : "KR") === MKT);
  $("#bigTech").innerHTML = bigTechHTML() + moneyHTML() + accelHTML(own) + dotMapHTML(own, "보유", MKT);
  accSecFill();
}
// 📍 보유·관심 종목 지도 (사용자 전달 그림 '28년 Fwd EPS 증가율과 PER' 모양, 2026-11-01) — 카드의 fwd_mult 만으로 계산:
// PER 로 적정가를 매기는 종목 = 다음 1년 EPS 증가율(12MF→24MF, EPS 비 = PER 비의 역수) × 12개월 선행 PER (사용자 2026-11-03, 처음엔 24개월 선행) · PBR 로 매기는 종목 = ROE(= PBR ÷ PER, 12MF) × PBR
function dotMap(o) {  // o = {id, t, pts: [{x, y, n, own}], fx, fy, xt, yt}
  const W = 340, H = 330, x0 = 30, x1 = W - 8, top = 22, bot = H - 30;
  const md = o.pts.map((p) => p.y).sort((a, b) => a - b)[o.pts.length >> 1], cap = Math.max(o.cap || 40, 2.5 * md);  // 테슬라·두산에너빌리티처럼 너무 멀면 그림 밖 (회귀선에서도 뺌) — 나머지 점이 몰려 이름이 겹치지 않게
  const inn = o.pts.filter((p) => p.y > 0 && p.y <= cap && p.x >= -30 && p.x <= 100), out = o.pts.filter((p) => !inn.includes(p));
  if (inn.length < 3) return "";
  const mx = inn.reduce((s, p) => s + p.x, 0) / inn.length, my = inn.reduce((s, p) => s + p.y, 0) / inn.length;
  const b = inn.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / (inn.reduce((s, p) => s + (p.x - mx) ** 2, 0) || 1), fit = (x) => my + b * (x - mx);
  const xl = Math.min(0, ...inn.map((p) => p.x)), xh = Math.max(...inn.map((p) => p.x)) * 1.1 + 1, yh = Math.max(...inn.map((p) => p.y)) * 1.1;
  const X = (v) => x0 + ((v - xl) / (xh - xl)) * (x1 - x0), Y = (v) => bot - (v / yh) * (bot - top);
  let g = `<clipPath id="${o.id}c"><rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bot - top}"/></clipPath>`;
  for (let i = 0; i <= 4; i++) {
    const xv = xl + (i / 4) * (xh - xl), yv = (i / 4) * yh;
    g += `<line x1="${x0}" x2="${x1}" y1="${Y(yv)}" y2="${Y(yv)}" stroke="var(--grid)"/><text x="${x0 - 3}" y="${Y(yv) + 3}" text-anchor="end" class="qx">${esc(o.fy(yv))}</text>`
      + `<text x="${X(xv)}" y="${bot + 12}" text-anchor="middle" class="qx">${esc(o.fx(xv))}</text>`;
  }
  if (xl < 0) g += `<line x1="${X(0)}" x2="${X(0)}" y1="${top}" y2="${bot}" stroke="var(--axis)"/>`;
  g += `<line x1="${X(xl)}" x2="${X(xh)}" y1="${Y(fit(xl))}" y2="${Y(fit(xh))}" stroke="var(--muted)" stroke-dasharray="4 3" clip-path="url(#${o.id}c)"/>`;
  g += `<text x="${x1}" y="${bot + 24}" text-anchor="end" class="qx">${esc(o.xt)} →</text><text x="4" y="10" class="qx">↑ ${esc(o.yt)}</text>`;
  // 이름표: 점·다른 이름표와 안 겹치는 자리(오른쪽 → 왼쪽 → 위 → 아래)를 차례로 찾음
  const boxes = inn.map((p) => [X(p.x) - 3.5, Y(p.y) - 3.5, X(p.x) + 3.5, Y(p.y) + 3.5]);
  [...inn].sort((p, q) => q.own - p.own || q.y - p.y).forEach((p) => {
    const cx = X(p.x), cy = Y(p.y), w = [...p.n].reduce((s, ch) => s + (ch.charCodeAt(0) > 255 ? 9.5 : 5.6), 0);
    const cand = [[5, 3.5, 0], [-5, 3.5, 1], [-w / 2, -6, 0], [-w / 2, 13, 0], [5, -6, 0], [5, 13, 0], [-5, -6, 1], [-5, 13, 1]];
    let pick = cand[0];
    for (const c of cand) {
      const bx = c[2] ? cx + c[0] - w : cx + c[0], box = [bx, cy + c[1] - 8.5, bx + w, cy + c[1] + 1.5];
      if (box[0] >= 0 && box[2] <= W && box[1] >= 0 && !boxes.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) { pick = c; boxes.push(box); break; }
    }
    g += `<circle cx="${cx}" cy="${cy}" r="${p.own ? 4.2 : 3.4}" fill="${p.own ? "var(--s1)" : "var(--surface)"}" stroke="${p.own ? "var(--s1)" : "var(--muted)"}" stroke-width="1.6"><title>${esc(`${p.n}: ${o.xt} ${o.fx(p.x)} · ${o.yt} ${o.fy(p.y)}`)}</title></circle>`
      + `<text x="${cx + pick[0]}" y="${cy + pick[1]}" text-anchor="${pick[2] ? "end" : "start"}" style="font-size:9.5px;fill:var(${p.own ? "--ink" : "--muted"});font-weight:${p.own ? 700 : 400}">${esc(p.n)}</text>`;
  });
  const gap = (p) => (p.y / fit(p.x) - 1) * 100, rk = inn.filter((p) => fit(p.x) > 0).sort((p, q) => gap(p) - gap(q));
  return { svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.t)}">${g}</svg>`, rk, gap, out, b };
}
function dotMapHTML(list, g, mk) {  // 사용자 11/6: 탭마다 그 탭 종목만 (보유 = 그 시장 보유 · 관심 = 그 시장 관심 · 공동 = 공동자산 전체)
  const S = (list || []).filter((c) => c.fwd_mult), key = { 보유: "own", 관심: "watch", 공동: "joint" }[g] + (mk || "");
  if (!S.length) return "";
  const kinds = (c) => (c.scen?.parts || []).map((p) => p.kind), nm = (c) => c.name.replace("디펜스앤에어로스페이스", "디펜스");
  const per = [], pbr = [];
  S.forEach((c) => {
    const P = c.fwd_mult.PER || {}, B = c.fwd_mult.PBR || {}, ys = Object.keys(P).filter((k) => /^\d\dE$/.test(k)).sort(), [a, b2, c2] = ys.slice(-3).map((k) => P[k]);
    if (kinds(c).includes("PER") && P["12MF"] > 0 && b2 > 0 && c2 > 0) {
      // 사용자 2026-11-03: 세로 = 12개월 선행 PER · 가로 = 그다음 1년 EPS 증가율 (12MF EPS → 24MF EPS = 12MF PER ÷ 24MF PER − 1)
      // 24MF = 12MF 와 같은 비율로 한 해씩 밀어서 섞음 (비율 w 는 12MF PER 에서 거꾸로 구함 → 미국 회계연도 끝도 그대로 반영)
      let w = a > 0 && a !== b2 ? (1 / P["12MF"] - 1 / b2) / (1 / a - 1 / b2) : NaN;
      if (!(w >= 0 && w <= 1)) { const d = new Date(); w = Math.max(0, (12 - d.getMonth() - d.getDate() / 31) / 12); }
      const p24 = 1 / (w / b2 + (1 - w) / c2);
      per.push({ x: (P["12MF"] / p24 - 1) * 100, y: P["12MF"], n: nm(c), own: 1 });
    }
    if (kinds(c).includes("PBR") && B["12MF"] > 0 && P["12MF"] > 0) pbr.push({ x: (B["12MF"] / P["12MF"]) * 100, y: B["12MF"], n: nm(c), own: 1 });
  });
  const card =(m, t, unit, kid, src) => {
    if (!m) return "";
    const top = (arr) => arr.map((p) => `${esc(p.n)} <span class="src">${pct(m.gap(p), 0, true)}</span>`).join(" · ");
    return `<div class="qp"><div class="qt"><b>${esc(t)}</b></div>
      <div class="src" style="margin:2px 0 4px">선보다 아래 (같은 ${unit}에 비해 배수 낮음): ${top(m.rk.slice(0, 3))}<br>선보다 위 (배수 높음): ${top(m.rk.slice(-3).reverse())}</div>
      ${m.svg}<div class="src">● ${g === "공동" ? "공동자산" : g} 종목 · 점선 = 이 종목들 평균 관계 · 이름 옆 % = 점선에서 위아래로 떨어진 정도 · 점을 누르면 숫자${m.out.length ? ` · 그림 밖: ${m.out.map((p) => `${esc(p.n)} (${n(p.x, 0)}%, ${n(p.y, 1)}배)`).join(", ")}` : ""}</div>
      <div class="kidbox" style="margin-top:6px">🐣 ${kid}${m.b < 0 ? ` <b>지금 이 종목들은 점선이 거꾸로(오른쪽 아래로) 기울어 있어요</b> — ${unit}이 높은 종목이 오히려 배수가 낮게 거래되는 중이에요.` : ""}</div><div class="note src">${src}</div></div>`;
  };
  const m1 = per.length >= 3 && dotMap({ id: `dmper${key}`, t: "", pts: per, fx: (v) => `${n(v, 0)}%`, fy: (v) => `${n(v, 0)}배`, xt: "다음 1년 EPS 증가율", yt: "12개월 선행 PER" });
  const m2 = pbr.length >= 3 && dotMap({ id: `dmpbr${key}`, t: "", pts: pbr, cap: 3, fx: (v) => `${n(v, 0)}%`, fy: (v) => `${n(v, 1)}배`, xt: "ROE (12MF)", yt: "PBR (12MF)" });
  if (!m1 && !m2) return "";
  return `<details class="card" open style="margin-bottom:12px"><summary class="chart-title"><b>📍 ${g === "공동" ? "공동자산" : g} 종목 지도</b> <span class="src">${{ KR: "🇰🇷 ", US: "🇺🇸 " }[mk] || ""}이익 증가율 대비 PER · ROE 대비 PBR · 참고용 (매수·매도 추천 아님)</span></summary>
    <div class="qgrid">${card(m1, "다음 1년 EPS 증가율 × 12개월 선행 PER", "EPS 증가율",
      "오른쪽으로 갈수록 이익이 빨리 늘 거라는 예상, 위로 갈수록 주가가 이익에 비해 비싸요. 보통은 빨리 크는 회사일수록 PER 이 높아서 점들이 점선 근처에 모여요. 점선보다 한참 아래면 '성장에 비해 덜 쳐준다', 한참 위면 '성장보다 더 쳐준다'는 뜻이에요 (예상이 틀리면 달라져요).",
      "PER 로 적정가를 매기는 종목만 · 12개월 선행 PER = 지금 주가 ÷ 앞으로 12개월 EPS (증권사 컨센서스) · EPS 증가율 = 앞으로 12개월 EPS → 그다음 12개월 EPS · PBR 로 매기는 종목(삼성전자·SK하이닉스 등)은 ROE × PBR 그림")}
    ${card(m2, "ROE × PBR (12개월 선행)", "ROE",
      "ROE 는 '내 돈(자본) 100원으로 1년에 얼마 버나', PBR 은 '자본의 몇 배에 사고파나'예요. 돈을 잘 버는(ROE 높은) 회사일수록 PBR 이 높은 게 보통이라 점선 근처에 모여요. 점선보다 아래면 버는 힘에 비해 싸게, 위면 비싸게 거래되는 쪽이에요.",
      "적정가를 BPS × PBR 로 매기는 종목 (현대차·기아처럼 PER·PBR 둘 다 쓰면 양쪽 그림에 다 나옴) · ROE ≈ 12MF PBR ÷ 12MF PER")}</div></details>`;
}
// 🚀 이익 증가율이 1년 전보다 높아지나 (사용자 2026-11-04, 하나증권: 코스피는 이익 '증가율 변화'에 민감 — 2011·2016년 순이익은 2년 연속 사상 최대였지만
//    증가율은 꺾였고, 그때 증가율이 전년보다 높아진 업종이 주도) — EPS 증가율(scen.growth: 마지막 실적 연도 + E 두 해), 없으면 영업이익(tbl.op_g, E 두 해만)
function accelOf(c) {
  const t0 = c.tbl || {};
  if (mktOf(c.code) === "KR" && (t0.op_g || []).some((x) => x != null))  // 한국은 영업이익 증가율 (사용자 11/5) — 작년 = 분기보고서 영업이익 합 (card.op_last), 올해·내년 = 컨센서스
    return { b: "영업이익", ys: (t0.years || []).slice(0, 3), v: [c.op_last ?? null, t0.op_g[0], t0.op_g[1]] };
  const g = c.scen?.growth, ys = g?.years || [], i = ys.findLastIndex((y) => !/E$/.test(y));
  if (i >= 0 && ys[i + 2]) {
    const e = g.eps || [];
    return { b: "EPS", ys: ys.slice(i, i + 3), v: [0, 1, 2].map((k) => (e[i + k] <= 0 ? "적자" : e[i + k - 1] <= 0 ? "흑전" : g.yoy[i + k])) };
  }
  const t = c.tbl || {};
  return (t.op_g || []).some((x) => x != null) ? { b: "영업이익", ys: (t.years || []).slice(0, 3), v: [null, t.op_g[0], t.op_g[1]] } : null;
}
// 1 = 증가율 높아짐(+5%p 넘게 · 흑자 전환 · 흑전 다음 해 플러스), -1 = 낮아짐, 0 = 비슷, null = 못 셈 (하나증권 표와 같은 잣대: 흑전 → 플러스면 상승)
const accVerd = (a, b) => (b === "흑전" ? 1 : typeof b !== "number" ? null : a === "흑전" ? (b > 0 ? 1 : -1) : typeof a !== "number" ? null : b - a >= 5 ? 1 : b - a <= -5 ? -1 : 0);
const ACC_E = ["🐢", "↔", "🚀"];
const accVal = (v) => (v == null ? "-" : typeof v === "number" ? pct(v, 0, true) : v === "흑전" ? "흑자 전환" : v);
function accelHTML(list) {
  const rows = list.filter((c) => !/우$/.test(c.name)).map((c) => ({ c, a: accelOf(c) })).filter((x) => x.a);  // 우선주는 보통주와 같아서 뺌
  if (rows.length < 2) return "";
  const dif = ({ v }) => (typeof v[1] === "number" && typeof v[2] === "number" ? Math.round(v[2] - v[1]) : null);
  const key = ({ a }) => dif(a) ?? (accVerd(a.v[1], a.v[2]) === 1 ? 1e3 : -1e9);
  rows.sort((x, y) => key(y) - key(x));
  const ups = rows.filter((x) => accVerd(x.a.v[1], x.a.v[2]) === 1), kr = list.some((c) => c.market !== "US");
  const td = (v, w) => `<td class="${typeof v === "number" && v < 0 ? "dear" : ""}">${accVal(v)}${w == null ? "" : " " + ACC_E[w + 1]}</td>`;
  const body = rows.map(({ c, a }) => {
    const d = dif(a), w = accVerd(a.v[1], a.v[2]);
    return `<tr><td style="text-align:left;white-space:normal"><a href="#stock/${esc(c.code)}">${esc(c.name.replace("디펜스앤에어로스페이스", " D&A"))}</a>${a.b === "영업이익" && mktOf(c.code) !== "KR" ? "*" : ""}${a.ys.join() !== "25,26E,27E" ? ` <span class="src">${esc(a.ys.join("→"))}</span>` : ""}</td>`
      + `${td(a.v[0])}${td(a.v[1], accVerd(a.v[0], a.v[1]))}${td(a.v[2], w)}<td><b style="color:var(${w === 1 ? "--good" : w === -1 ? "--bad" : "--muted"})">${d == null ? (w === 1 ? "🚀" : "-") : (d > 0 ? "+" : "") + n(d || 0, 0) + "%p"}</b></td></tr>`;
  }).join("");
  return `<details class="card" open style="margin-bottom:12px" onclick="event.stopPropagation()"><summary class="chart-title"><b>🚀 이익 증가율이 1년 전보다 높아지나</b> <span class="src">${kr && list.some((c) => c.market === "US") ? "한국 = 영업이익 · 미국 = EPS" : kr ? "영업이익" : "EPS"} 증가율 · 내년이 올해보다 많이 높아지는 순 · 참고용 (매수·매도 추천 아님)</span></summary>
    ${ups.length ? `<div class="note">📈 내년 증가율이 올해보다 높아지는 종목 <b>${ups.length}곳</b>: ${ups.map((x) => esc(x.c.name)).join(" · ")}</div>` : ""}
    <div class="tbl-wrap"><table class="compact" style="width:100%;margin-top:6px"><thead><tr><th style="text-align:left">종목</th><th>작년</th><th>올해E</th><th>내년E</th><th>내년−올해</th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="kidbox" style="margin-top:6px">🐣 이익이 '얼마나 많은지'보다 '늘어나는 속도가 빨라지는지'를 봐요. 2011년·2016년에 코스피 이익은 2년 연속 사상 최대였지만 늘어나는 속도는 느려졌고, 그때 시장을 이끈 건 속도가 1년 전보다 빨라진 업종이었어요 (하나증권). 🚀 = 1년 전보다 증가율이 5%p 넘게 높아짐 · 🐢 = 5%p 넘게 낮아짐 · ↔ = 비슷.</div>
    <div class="note src">${kr ? "한국 = 영업이익 증가율 (올해·내년 = 에프앤가이드 컨센서스 · 작년 = 분기보고서 영업이익 4개 분기 합) · " : ""}미국 = EPS 증가율 (야후·나스닥·Finviz 평균, 회계연도라 이름 옆에 연도) · * = EPS 증가율이 없어 영업이익 증가율 (올해·내년만) · 흑자 전환은 증가율 대신 글자로</div>
    ${kr ? `<div class="accSec"></div>` : ""}</details>`;
}
// 🏭 코스피 업종별 순이익 증가율 (keychart.yaml eps_g — 증권사 표를 숫자로 옮김) · 우리 종목이 어느 업종인지 같이
function accSecFill() {
  keyLoad().then((k) => {
    const e = k.eps_g, nm = Object.fromEntries((DASH?.stocks || []).map((c) => [c.code, c.name]));
    if (!e?.rows?.length) return;
    const html = `<details class="fvt"><summary class="chart-title" style="margin-top:8px">🏭 ${esc(e.t)} <span class="src">${esc(e.src)} · 눌러서 열기</span></summary>
      ${e.top ? `<div class="note">📌 ${esc(e.top)}</div>` : ""}
      <div class="tbl-wrap"><table class="compact" style="width:100%"><thead><tr><th style="text-align:left">업종 <span class="src">시총 비중 · 우리 종목</span></th><th>26E</th><th>27E</th><th>27E 증가율</th></tr></thead><tbody>
      ${e.rows.map(([s, w, a, b, up, cs]) => `<tr><td style="text-align:left"><b>${esc(s)}</b> <span class="src">${w == null ? "" : n(w, 1) + "%"}</span>${(cs || []).length ? `<br><span class="src">${cs.map((c) => esc(nm[c] || c)).join(" · ")}</span>` : ""}</td>`
        + `<td>${accVal(a)}</td><td>${accVal(b)}</td><td><b style="color:var(${up ? "--good" : "--bad"})">${up ? "🚀 상승" : "🐢 하락"}</b></td></tr>`).join("")}</tbody></table></div>
      ${e.note ? `<div class="note src">${esc(e.note)}</div>` : ""}</details>`;
    document.querySelectorAll(".accSec").forEach((el) => { el.innerHTML = html; });
  });
}
// 🧾 실적 탭 (예전엔 보유 탭 맨 위): 쉬운 요약 · 실적 발표(최근 3일) · 실적발표·컨콜 일정 — 🇰🇷/🇺🇸 버튼
// 사용자 11/8: 첫 화면 탭을 '🧾 실적 보유'(#earn, 공동자산 포함) · '🧾 실적 관심'(#earnw) 둘로, 탭 안에서 전체 · 🇰🇷 한국 · 🇺🇸 미국
let EARN_MKT = "ALL", EARN_GRP = "보유";
const earnOk = (code) => {  // 지금 고른 탭(보유/관심)·시장(전체/한국/미국)에 들어가는 종목인지 — 목록에 없는 코드는 두 탭 모두
  if (EARN_MKT !== "ALL" && mktOf(code) !== EARN_MKT) return false;
  const c = DASH.stocks.find((s) => s.code === code);
  if (!c) return true;
  return [grp(c), ...(c.also || [])].includes(EARN_GRP);  // 11/8: 공동자산은 '실적 공동' 탭에 따로 (여러 묶음에 든 종목은 그 탭 모두)
};
function renderEarn() {
  const h = kqNewsHTML() + irCalHTML();  // 사용자 11/5: 제일 최신 발표가 맨 위 — 쉬운 요약은 그 회사 카드 안·날짜순 목록 안으로
  const where = `${EARN_MKT === "US" ? "미국 " : EARN_MKT === "KR" ? "한국 " : ""}${EARN_GRP === "공동" ? "공동자산" : EARN_GRP}`;
  // 사용자 11/10: 탭이 많아서 🧾 실적 하나로 — 안에서 보유 · 관심 · 공동, 그 아래 전체 · 한국 · 미국
  $("#earnBody").innerHTML = `<div class="seg" style="margin-bottom:6px">${[["#earn", "보유"], ["#earnw", "관심"], ["#earnj", "공동"]].map(([hs, g]) => `<a href="${hs}" class="segl${g === EARN_GRP ? " on" : ""}">${g === "공동" ? "🤝 공동자산" : g === "관심" ? "⭐ 관심" : "💼 보유"}</a>`).join("")}</div>`
    + `<div class="seg earnmk" style="margin-bottom:8px">${[["ALL", "전체"], ["KR", "🇰🇷 한국"], ["US", "🇺🇸 미국"]].map(([k, l]) => `<button data-mk="${k}" class="${k === EARN_MKT ? "on" : ""}">${l}</button>`).join("")}</div>`
    + expBanner() + `<div id="earnJump"></div><div id="earnList">${h || `<div class="empty">이번 분기에 나온 ${where} 종목 실적이 없어요.</div>`}</div>`;
  jumpBar("#earnList", "#earnJump");
}
// ‼️ 첫 화면 맨 위 한 줄: 7일 안에 새 수출·입국 숫자가 들어온 묶음과 그 종목 (누르면 상세 '📦 수출·입국' 칸으로)
function expBanner() {
  const by = {};
  [...new Map((DASH?.stocks || []).map((s) => [s.code, s])).values()].forEach((s) => expNew(s.code).forEach((x) => (by[x.k] ||= { r: x.r, s: [] }).s.push(s)));
  const ks = Object.keys(by);
  return ks.length ? `<div class="warnbox" style="margin-bottom:8px;border-color:var(--bad);font-weight:600">‼️ 📦 새 숫자 나옴 — ${ks.map((k) => `${EXPW_K[k].t} ${+by[k].r.ym.slice(5)}월 (${by[k].s.map((s) => `<a href="#stock/${esc(s.code)}" onclick="GOTO='expw'">${esc(s.name)}</a>`).join("·")})`).join(" · ")} <span class="src" style="font-weight:400">누르면 그래프 · 7일 동안 보여요</span></div>` : "";
}
document.addEventListener("click", (e) => { const b = e.target.closest(".earnmk button"); if (b) { EARN_MKT = b.dataset.mk; renderEarn(); } });
function kqNewsHTML() {
  // 최신 날짜 먼저 (사용자 11/5) — 실적 카드 · 쉬운 요약만 있는 회사 · 공시·전망 변화(events.yaml)를 한 목록에서 (같은 날이면 실적 카드 → 보유 → 관심 순서 그대로)
  const t0 = new Date(), q0 = `${t0.getFullYear()}-${String(Math.floor(t0.getMonth() / 3) * 3 + 1).padStart(2, "0")}-01`, d3 = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  // 사용자 11/10: 이번 분기(달력 분기 시작 뒤) 발표·요약·공시 다 보이게 (분기 첫 3일은 지난 3일도)
  const cut = d3 < q0 ? d3 : q0, nm = (c) => DASH.stocks.find((s) => s.code === c)?.name;
  const easyOf = (code) => { const l = EARNINGS[code]?.[0]; return l?.easy?.length && l.date >= cut ? l : null; };
  const kid = (e) => `<div class="kidbox"><b>${e.code ? `<a href="#stock/${esc(e.code)}">${esc(nm(e.code) || e.code)}</a> · ` : ""}${esc(e.title)}</b> <span class="src">🐣 쉬운 요약 · ${esc(e.date.slice(5).replace("-", "/"))}${e.sum ? " · 누르면 상세 요약" : ""}</span>
      <ul class="irl">${e.easy.map((x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`).join("")}</ul></div>`;
  const list = DASH.stocks.filter((c) => c.kq_brief && earnOk(c.code));
  const wait = DASH.stocks.filter((c) => !c.kq_brief && c.kq_wait && earnOk(c.code));
  const rows = list.map((c) => {
    const k = c.kq_brief, ez = easyOf(c.code);
    const head = `<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap"><b style="font-size:18px;color:var(--s1)">${esc(c.name)} (${esc(c.code)})</b>
      <span class="src">${esc(c.industry || "")}${c.market_cap ? ` · 시총 ${capTxt(c)}` : ""} · ${esc(c.group || "")} · <a href="#stock/${esc(c.code)}">상세 화면</a></span></div>`;
    return { date: k.date || "", html: `<div class="card" data-jump="${esc(c.code)}" data-jname="${esc(c.name)}">${head}
      <div class="sub">${esc(k.latest)}${k.prelim ? " 잠정실적" : " 실적"}${k.filing ? ` · <a href="${esc(k.filing.url)}" target="_blank" rel="noopener">${esc(k.filing.date)} ${k.cur === "USD" ? "발표" : "공시"}</a>` : ""}</div>
      ${ez ? kid({ date: ez.date, title: `${ez.quarter} 실적발표`, easy: ez.easy, sum: true }) : ""}
      ${priceBox(c)}
      ${kqTable(k)}
      ${kqPtHTML(k)}
      ${irBriefHTML(c.code, c.name, k)}
      ${moodHTML(c)}
      ${kqBox(k, c.code)}
    </div>` };
  });
  const shown = new Set(list.map((c) => c.code));
  Object.entries(EARNINGS).forEach(([code, l]) => {  // 실적 카드는 없는데 쉬운 요약은 있는 회사
    const ez = easyOf(code);
    if (ez && !shown.has(code) && earnOk(code)) rows.push({ date: ez.date, html: `<div class="card" data-jump="${esc(code)}" data-jname="${esc(nm(code) || code)}">${kid({ date: ez.date, code, title: `${ez.quarter} 실적발표`, easy: ez.easy, sum: true })}</div>` });
  });
  (EVENTS || []).filter((e) => e.date >= cut && e.easy?.length && (e.code ? earnOk(e.code) : !e.market || EARN_MKT === "ALL" || e.market === EARN_MKT))  // 종목이 없는 이벤트(업종 전체)는 보유·관심 두 탭 모두
    .forEach((e) => rows.push({ date: e.date, html: `<div class="card"${e.code ? ` data-jump="${esc(e.code)}" data-jname="${esc(nm(e.code) || e.code)}"` : ""}>${kid(e)}</div>` }));
  if (!rows.length && !wait.length) return "";
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const waitHtml = wait.length ? `<div class="note">⏳ 잠정실적 공시는 났고 숫자를 읽는 중 (다음 갱신 때 반영): ${wait.map((c) => `<a href="#stock/${esc(c.code)}">${esc(c.name)}</a> ${esc(c.kq_wait || "")}`).join(" · ")}</div>` : "";
  return `<h2>🧾 실적 발표 <span class="src">이번 분기 (${esc(cut.slice(5).replace("-", "/"))}~) · 최신 발표 먼저 · 🐣 = 쉬운 요약 · 회색 = 발표 전 예상(컨센서스), 색 = 실적</span></h2>${waitHtml}<div class="grid">${rows.map((r) => r.html).join("")}</div>`;
}
// ⚠ 회계 기준 바뀜 메모 (keychart.yaml acct) — 이익률을 1년 전·다른 회사와 맞댈 때 꼭 볼 것. full = 🧾 최신 분기 실적 안, 아니면 그림 위 한 줄
function acctHTML(code, full = true) {
  const a = KEYC?.acct?.[code];
  if (!a) return "";
  if (!full) return `<div class="note" style="color:var(--warn-ink)">⚠ ${esc(a.short || a.t)} <span class="src">— 🧾 최신 분기 실적의 '회계 기준 메모'</span></div>`;
  return `<div class="kidbox" style="background:var(--warn-bg)">⚠ <b>회계 기준 메모</b> ${esc(a.t)}<ul class="irl">${(a.lines || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    ${(a.u || []).length ? `<div class="src">출처: ${a.u.map((x) => `<a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)}</a>`).join(" · ")}</div>` : ""}</div>`;
}
function kqHTML(d) {
  const k = d.kq;
  if (!k) return "";
  const nx = k.next;
  return `<h3>🧾 최신 분기 실적 <span class="src">${esc(k.latest)}${k.prelim ? " 잠정" : ""} · ${k.cur === "USD" ? "야후 파이낸스 · 달러 · EPS = 야후 발표 EPS" : "네이버 증권(FnGuide) · 억원"}${k.est_date ? ` · 예상 = ${esc(k.est_date)} 저장한 컨센서스` : ""}</span></h3><div class="card">
    ${k.waiting && nx ? `<div class="warnbox">🧾 ${esc(nx.q)} 잠정실적 공시가 났어요 (${esc(k.filing.date)}). 네이버 숫자에 반영되면 예상 대비가 자동으로 계산돼요. <a href="${esc(k.filing.url)}" target="_blank" rel="noopener">공시 보기</a></div>` : ""}
    ${k.prelim && k.filing ? `<div class="note">🧾 ${esc(k.latest)} 숫자는 <a href="${esc(k.filing.url)}" target="_blank" rel="noopener">DART 잠정실적 공시(${esc(k.filing.date)})</a> 값이에요. 네이버에 확정 숫자가 들어오면 자동으로 바뀌어요 (EPS 는 그때 채워짐).</div>` : ""}
    ${kqTable(k)}
    ${kqPtHTML(k)}
    ${acctHTML(d.code)}
    ${kqBox(k, d.code)}
    <div class="tbl-wrap" style="margin-top:8px"><table class="compact"><thead><tr><th style="text-align:left">분기</th><th>매출액</th><th>영업이익</th><th>순이익</th><th>EPS</th></tr></thead><tbody>
      ${k.quarters.slice().reverse().map((q) => `<tr><td>${esc(q.q)}${q.prelim ? ' <span class="src">잠정</span>' : ""}</td>${["sales", "op", "ni", "eps"].map((f) => `<td>${q[f] == null ? "-" : kqF(f, k.cur)(q[f])}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    ${nx ? `<div class="note">📌 다음 ${esc(nx.q)} 컨센서스: ${[["sales", "매출"], ["op", "영업이익"], ["ni", "순이익"], ["eps", "EPS"]].filter(([f]) => nx[f] != null).map(([f, l]) => `${l} ${kqF(f, k.cur)(nx[f])}`).join(" · ")} <span class="src">(${esc(nx.date)} ${k.cur === "USD" ? "발표 예정" : "기준"}, 발표되면 이 값과 비교해요)</span></div>` : ""}
    ${k.filing ? `<div class="note src">${k.cur === "USD" ? "발표" : "공시"}: <a href="${esc(k.filing.url)}" target="_blank" rel="noopener">${esc(k.filing.date)} ${esc(k.filing.name)}</a></div>` : ""}
    ${(EARNINGS[d.card?.code] || []).length ? "" : earningsHTML(d.card?.code, true)}
    ${irBriefHTML(d.card?.code, d.card?.name, k)}
    ${longHTML(d)}
    ${qtrHTML(d, "q", true)}
  </div>`;
}
const QTR_MAP = {};
document.addEventListener("click", (e) => {
  const b = e.target.closest(".qtrbox .qseg button"); if (!b) return;
  const box = b.closest(".qtrbox");
  box.outerHTML = qtrHTML(QTR_MAP[box.dataset.code], b.dataset.q);
});
// inKq = '🧾 최신 분기 실적' 카드 안에 붙일 때: 위 막대·🔑 핵심 지표와 겹치는 매출·영업이익·FCF 칸과 분기/연간 탭은 빼고 나머지만
function qtrHTML(d, mode = "q", inKq = false) {  // mode: q = 분기, y = 연간 (야후 연간 재무제표)
  const yr = !inKq && mode === "y" && Object.keys(d.qtrs_y || {}).length >= 2, U = yr ? "년" : "분기";
  QTR_MAP[(d.card || d).code] = d;
  const all = Object.entries((yr ? d.qtrs_y : d.qtrs) || {}).filter(([, q]) => q.rev);
  if (all.length < 2) return "";
  const usd = (d.card || d).currency === "USD";
  const getQ = (end) => (all.find(([e]) => nearDay(e, new Date(end) - 365 * 864e5)) || [])[1];  // 1년 전 같은 분기 (끝 날짜 ±40일)
  const get = (end, k) => getQ(end)?.[k] ?? null;
  const qs = all.slice(-5), labels = qs.map(([e]) => (yr ? `FY${e.slice(2, 4)}` : qLabel(e))), L = qs.length - 1;
  const rev = qs.map(([, q]) => q.rev), op = qs.map(([, q]) => q.op ?? null);
  const yoy = qs.map(([e, q]) => { const p = get(e, "rev"); return p && p > 0 ? (q.rev / p - 1) * 100 : null; });
  const opm = qs.map(([, q]) => (q.op != null ? (q.op / q.rev) * 100 : null));
  const gpv = qs.map(([, q]) => (q.gp != null && q.gp < q.rev * 0.995 ? q.gp : null)), gpm = qs.map(([, q], i) => (gpv[i] != null ? (gpv[i] / q.rev) * 100 : null));
  const fcf = qs.map(([, q]) => q.fcf ?? null), capex = qs.map(([, q]) => (q.capex != null ? Math.abs(q.capex) : null));
  // 한 줄 꼬리표: 최근 분기 변화 (몇 분기 연속인지까지)
  const streak = (a) => { let c = 0; for (let i = L; i > 0 && a[i] != null && a[i - 1] != null && a[i] > a[i - 1]; i--) c++; return c; };
  const kR = streak(yoy), kG = streak(gpm);
  const tRev = yoy[L] == null ? "" : yoy[L] < 0 ? "역성장" : kR >= 2 ? `${kR}${U} 연속 성장 가속` : kR ? "성장 가속" : yoy[L - 1] != null ? "성장 둔화" : "";
  const tOp = op[L] != null && op[L - 1] != null ? (op[L - 1] <= 0 && op[L] > 0 ? "흑자 전환" : op[L - 1] > 0 && op[L] <= 0 ? "적자 전환" : opm[L] > opm[L - 1] ? `이익률 +${n(opm[L] - opm[L - 1], 1)}%p` : `이익률 ${n(opm[L] - opm[L - 1], 1)}%p`) : "";
  const dG = gpm[L] != null && gpm[L - 1] != null ? gpm[L] - gpm[L - 1] : null;
  const tG = dG == null ? "" : kG >= 2 ? `${kG}${U} 연속 마진 가속화` : Math.abs(dG) < 0.05 ? "마진 유지" : dG > 0 ? `마진 +${n(dG, 1)}%p` : `마진 ${n(dG, 1)}%p`;
  const tF = fcf[L] != null && fcf[L - 1] != null ? (fcf[L - 1] > 0 && fcf[L] < 0 ? "현금흐름 적자 전환" : fcf[L - 1] < 0 && fcf[L] > 0 ? "현금흐름 흑자 전환" : "") : "";
  const prevC = capex.slice(0, L).filter((v) => v != null), avgC = prevC.length ? prevC.reduce((a, b) => a + b, 0) / prevC.length : null;
  const tC = capex[L] != null && avgC ? (capex[L] > avgC * 1.5 ? "CapEx 대폭 상향" : capex[L] < avgC * 0.67 ? "CapEx 줄어듦" : "") : "";
  const last = qs[L];
  // 돈의 흐름은 원가·비용이 나뉜 마지막 분기로 — 잠정실적만 있는 최신 분기(prelim)는 매출·영업이익·순이익뿐
  const full = all.filter(([, q]) => q.cogs != null || q.gp != null || q.opex != null), fq = full.at(-1) || last, part = fq[0] !== last[0];
  const fLab = yr ? `FY${fq[0].slice(2, 4)}` : qLabel(fq[0]);
  // 부문별 매출: 돈의 흐름 왼쪽은 이 분기와 같은 시점 자료가 있을 때만
  const ps = segPeriods(d.seg), col = ps.length ? segColors(ps) : null;
  const sp = ps.find(([e]) => nearDay(e, fq[0])), spa = sp && segAgo(ps, sp[0]);
  const segs = sp ? Object.keys(col).filter((s) => sp[1][s]).map((s) => [s, sp[2] ? sp[2][s] : (fq[1].rev * sp[1][s]) / 100,
    sp[2] && spa?.[2]?.[s] > 0 ? (sp[2][s] / spa[2][s] - 1) * 100 : null, col[s], sp[1][s], !sp[2]]) : null;
  const nm = (d.card || d).name || "";
  const src = `${esc(last[0])} 끝난 ${yr ? "회계연도" : "분기"} · 야후 파이낸스${last[1].prelim ? " (최신 분기는 DART 잠정실적)" : ""}${d.seg ? " · 부문: " + esc(d.seg.src || "") : ""} · ${usd ? "달러" : "원"}`;
  const head = inKq ? `<div class="chart-title" style="margin-top:14px"><b>📊 손익 구조 · ${esc(labels[L])}</b> <span class="src">${src}</span></div>`
    : `<h3>📊 ${esc(nm)} 실적 요약 (핵심지표) · ${esc(labels[L])} <span class="src">${src}</span></h3><div class="card">${Object.keys(d.qtrs_y || {}).length >= 2 ? `<div class="seg qseg" style="margin-bottom:8px"><button data-q="q" class="${yr ? "" : "on"}">분기</button><button data-q="y" class="${yr ? "on" : ""}">연간</button></div>` : ""}`;
  return `<div class="qtrbox" data-code="${esc((d.card || d).code || "")}">${head}${acctHTML((d.card || d).code, false)}
    <div class="qgrid">
      ${inKq ? "" : qPanel("매출 & 성장률 (1년 전 대비)", tRev, labels, rev, yoy.some((v) => v != null) ? yoy : null, usd, "var(--ink-2)")}
      ${inKq ? "" : qPanel("영업이익 & 영업이익률", tOp, labels, op, opm, usd, "var(--good)")}
      ${gpv.filter((v) => v != null).length >= 2 ? qPanel("매출총이익 & 매출총이익률", tG, labels, gpv, gpm, usd, "var(--s3)") : ""}
      ${inKq ? "" : qPanel("잉여현금흐름 (FCF)", tF, labels, fcf, null, usd, "var(--good)")}
      ${qPanel("설비투자 (CapEx)", tC, labels, capex, null, usd, "var(--warn)")}
    </div>
    <div class="chart-title" style="margin-top:12px"><b>💸 ${esc(nm)} ${esc(fLab)} 얼마 벌어서 어디에 썼나</b> <span class="src">${segs ? "부문 → " : ""}매출 → 원가·비용 → 영업이익 → 순이익 (매출 대비 %, 1년 전 ${yr ? "" : "같은 분기 "}대비)</span></div>
    ${part ? `<div class="note src">⏳ ${esc(labels[L])} 는 잠정실적이라 매출·영업이익·순이익만 있어요 — 원가·비용 나눔은 분기보고서(분기 끝 45일 안)가 나오면 채워져서, 돈의 흐름은 ${esc(fLab)} 기준이에요.</div>` : ""}
    ${qSankey(fq[1], usd, getQ(fq[0]), segs)}
    ${costHTML(DASH.stocks.find((x) => x.code === (d.card || d).code), d)}
    ${yr ? "" : (() => {  // 직전 분기 · 1년 전 같은 분기 (나란히 비교) · 최근 4분기 합계(TTM) · 최근 연간 — 접어 두고 눌러서 보기
      const out = [], pv = full.at(-2), ago = full.find(([e]) => nearDay(e, new Date(fq[0]) - 365 * 864e5));
      if (pv) out.push([`직전 분기 (${qLabel(pv[0])})`, pv[1], getQ(pv[0])]);
      if (ago && ago !== pv) out.push([`1년 전 같은 분기 (${qLabel(ago[0])})`, ago[1], getQ(ago[0])]);
      const q4 = full.slice(-4).map(([, q]) => q);
      if (q4.length === 4 && q4.every((q) => q.rev && q.op != null)) {
        const sum = {};
        for (const key of ["rev", "cogs", "gp", "rnd", "sm", "ga", "sga", "opex", "op"]) if (q4.every((q) => q[key] != null)) sum[key] = q4.reduce((a, q) => a + q[key], 0);
        out.push([`최근 4분기 합계 (${qLabel(full.at(-4)[0])}~${fLab})`, sum]);
      }
      const py = d.pl_year;
      if (py?.rev) out.push([`최근 연간 (${py.end.slice(0, 7)} 결산)`, py]);
      return out.map(([t, q, a]) => `<details class="fvt"><summary class="chart-title">💸 ${esc(t)} <span class="src">매출 ${qMoney(q.rev, usd)} · 영업이익률 ${n((q.op / q.rev) * 100, 1)}% · 눌러서 보기</span></summary>${qSankey(q, usd, a)}</details>`).join("");
    })()}
    <div class="note src">성장률은 1년 전 ${yr ? "" : "같은 분기 "}대비 (${yr ? "야후 연간 재무제표 최근 4년" : "분기 자료가 쌓이면 빈 칸이 채워져요"}) · 한국 종목은 야후 반영이 실적 발표보다 늦을 수 있어요</div>
  ${inKq ? "" : "</div>"}</div>`;
}
// 📈 긴 기간 선(·막대) 그래프 — 휴대폰 한 화면에 10년 치 (안아줘 투자이야기 블로그 그림처럼 왼쪽·오른쪽 두 눈금)
// o = {t, why, tag, labels, s: [{n, v, col, right, bar}], fl, fr (눈금 글자), zero (0 을 눈금에 넣기), tick (i → x 아래 글자)}
function lineChart(o) {
  const Lb = o.labels, N = Lb.length, S = o.s.map((s) => ({ ...s, v: s.v.map((v) => (Number.isFinite(v) ? v : null)) })).filter((s) => s.v.some((v) => v != null));  // 빈 칸·NaN 은 끊어 그림
  if (N < 3 || !S.length) return "";
  const hasR = S.some((s) => s.right), W = 340, x0 = 40, x1 = W - (hasR ? 40 : 10), top = 26, bot = 128;  // 위 26 = 끝 숫자 자리
  const X = (i) => x0 + ((x1 - x0) * (i + 0.5)) / N, bars = S.filter((s) => s.bar), bw = Math.max(1.2, Math.min(9, ((x1 - x0) / N) * 0.75 / (bars.length || 1)));
  const rng = (side) => {
    const ss = S.filter((s) => !!s.right === side), vs = ss.flatMap((s) => s.v).filter((v) => v != null);
    if (!vs.length) return null;
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (o.zero || ss.some((s) => s.bar)) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
    return [lo < 0 || !(o.zero || ss.some((s) => s.bar)) ? lo - pad : lo, hi + pad];
  };
  const R = { false: rng(false), true: rng(true) }, Y = (side, v) => { const [lo, hi] = R[side] || R[!side]; return bot - ((v - lo) / (hi - lo)) * (bot - top); };
  const fl = o.fl || ((v) => n(v, 0)), fr = o.fr || fl;
  let g = "";
  [0, 0.5, 1].forEach((t) => {  // 눈금 3줄 (아래·가운데·위)
    const y = bot - t * (bot - top);
    g += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="var(--grid)"/>`;
    if (R.false) g += `<text x="${x0 - 3}" y="${y + 3}" text-anchor="end" class="qx">${esc(fl(R.false[0] + t * (R.false[1] - R.false[0])))}</text>`;
    if (hasR && R.true) g += `<text x="${x1 + 3}" y="${y + 3}" class="qx">${esc(fr(R.true[0] + t * (R.true[1] - R.true[0])))}</text>`;
  });
  [false, true].forEach((side) => { const r = R[side]; if (r && r[0] < 0 && r[1] > 0 && (!side || !R.false || R.false[0] >= 0)) g += `<line x1="${x0}" x2="${x1}" y1="${Y(side, 0)}" y2="${Y(side, 0)}" stroke="var(--axis)"/>`; });
  const tick = o.tick || ((i) => shortQ(i, Lb));
  Lb.forEach((_, i) => { const t = tick(i); if (t) g += `<text x="${X(i)}" y="${bot + 13}" text-anchor="middle" class="qx">${esc(t)}</text>`; });
  bars.forEach((s, j) => s.v.forEach((v, i) => {
    if (v == null) return;
    const side = !!s.right, y0 = Y(side, 0), y = Y(side, v), x = X(i) - (bw * bars.length) / 2 + j * bw;
    g += `<rect x="${x}" y="${Math.min(y, y0)}" width="${bw * 0.9}" height="${Math.max(0.8, Math.abs(y0 - y))}" fill="${s.col}" opacity="${v < 0 ? 0.55 : 0.85}"/>`;
  }));
  S.filter((s) => !s.bar).forEach((s) => {
    const side = !!s.right;
    let d = "", pen = false;
    s.v.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(side, v).toFixed(1)}`; pen = true; });
    g += `<path d="${d}" fill="none" stroke="${s.col}" stroke-width="${N > 30 ? 1.8 : 2.4}" stroke-linejoin="round"/>`;
    if (N <= 24) s.v.forEach((v, i) => { if (v != null) g += `<circle cx="${X(i)}" cy="${Y(side, v)}" r="2" fill="${s.col}"/>`; });
    const li = s.v.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
    if (li != null) g += `<circle cx="${X(li)}" cy="${Y(side, s.v[li])}" r="3.2" fill="var(--surface)" stroke="${s.col}" stroke-width="2"/>`;
  });
  S.forEach((s) => { const li = s.v.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop(); s.last = li == null ? null : [(s.right ? fr : fl)(s.v[li]), li]; });
  // 끝 숫자: 그림 안 마지막 점 옆에 — 숫자 칸 너비 안에서 모든 선보다 위(lab: "above", 기본) 또는 아래(lab: "below")로 비켜서 선을 안 가리게
  const lp = S.filter((s) => !s.bar).flatMap((s) => s.v.map((v, i) => (v == null ? null : [X(i), Y(!!s.right, v)])).filter(Boolean));
  const placed = [];
  S.filter((s) => !s.bar && s.last).sort((a, b) => (b.lab === "below") - (a.lab === "below")).forEach((s) => {  // 아래 숫자 먼저 → 위 숫자가 그 위로 (매출 위 · 영업이익 아래 순서 유지)
    const t = s.last[0], xr = X(s.last[1]) + 4, w = String(t).length * 7 + 4, ys = lp.filter(([x]) => x >= xr - w - 8 && x <= xr + 8).map(([, y]) => y);
    const up = Math.min(...ys) - 6, dn = Math.max(...ys) + 14;
    let y = s.lab === "below" ? (dn <= bot + 2 ? dn : up) : up >= 12 ? up : dn;
    const below = y === dn;
    for (const p of placed) if (Math.abs(p - y) < 13) y = below ? p + 13 : p - 13;  // 끝 숫자끼리 겹치면 선에서 먼 쪽으로 벌림
    placed.push(y);
    g += `<text x="${xr}" y="${y}" text-anchor="end" class="qv b" style="fill:${s.col};font-size:12px">${esc(t)}</text>`;
  });
  g += tipCols(X, (x1 - x0) / N, 0, 146, Lb.map((l, i) => [l, ...S.map((s) => (s.v[i] == null ? null : `${s.n}: ${(s.right ? fr : fl)(s.v[i])}`))].filter(Boolean).join("\n")));
  const lastQ = (i) => (i === N - 1 ? "" : ` <span style="opacity:.7">(${esc(/^\d\d\.\dQ$/.test(Lb[i]) ? `${Lb[i][3]}Q${Lb[i].slice(0, 2)}` : Lb[i])})</span>`);  // 다른 선보다 일찍 끝나면 그 분기
  const leg = `<div class="src" style="padding:0 4px 4px">${S.map((s) => `<span style="color:${s.col}">${s.bar ? "■" : "●"}</span> ${esc(s.n)}${hasR ? (s.right ? " (오른쪽)" : " (왼쪽)") : ""}${s.last ? ` <b style="color:${s.col};font-size:13px">${esc(s.last[0])}</b>${lastQ(s.last[1])}` : ""}`).join(" · ")}</div>`;
  return `<div class="qp"><div class="qt"><b>${esc(o.t)}</b>${o.tag || ""}</div>${o.why ? `<div class="src">${esc(o.why)}</div>` : ""}<svg viewBox="0 0 ${W} 146" role="img" aria-label="${esc(o.t)}">${g}</svg>${leg}</div>`;
}
const qAgo = (k) => `${String(+k.slice(0, 2) - 1).padStart(2, "0")}${k.slice(2)}`;  // '26.3Q' → '25.3Q'
const usdB = (v) => (v == null ? "-" : `${v < 0 ? "-" : ""}$${n(Math.abs(v), Math.abs(v) >= 100 ? 0 : 1)}B`), fPct = (v) => `${n(v, 0)}%`;
// {라벨: {rev, op, gp}} → 같은 길이 배열들 (usd = 백만 달러 → 십억 달러)
function longSeries(q, ks, usd) {
  const M = (v) => (v == null ? null : usd ? v / 1e3 : v), r = (k) => q[k] || {};
  return { rev: ks.map((k) => M(r(k).rev)), op: ks.map((k) => M(r(k).op)),
    yoy: ks.map((k) => (r(qAgo(k)).rev > 0 && r(k).rev != null ? (r(k).rev / r(qAgo(k)).rev - 1) * 100 : null)),
    opm: ks.map((k) => (r(k).op != null && r(k).rev ? (r(k).op / r(k).rev) * 100 : null)),
    gpm: ks.map((k) => (r(k).gp != null && r(k).rev && r(k).gp < r(k).rev * 0.995 ? (r(k).gp / r(k).rev) * 100 : null)) };
}
const LONG_TABS = [[12, "3년"], [20, "5년"], [40, "10년"], [999, "MAX"]], LONG_MAP = {};
// 📈 10년 실적 추이 (종목 상세): 매출·영업이익 두 눈금 선 · 매출 성장률 · 영업이익률 · 매출총이익률 (+ 삼성전자는 DS 부문만 따로)
function longHTML(d, span = 40) {
  const c = d.card || d, q = d.longq;
  const all = Object.keys(q || {}).sort();
  if (all.length < 6) return "";
  LONG_MAP[c.code] = d;
  const usd = c.currency === "USD", ks = all.slice(-span), s = longSeries(q, ks, usd), fm = usd ? usdB : kqFmt;
  const ch = [
    lineChart({ t: "매출 · 영업이익", labels: ks, s: [{ n: "매출", v: s.rev, col: "var(--s1)" }, { n: "영업이익", v: s.op, col: "var(--warn)", right: true, lab: "below" }], fl: fm, fr: fm, zero: true }),
    stackChart("🧱 제품군별 매출", d.segq?.prod, span, usd, q, d.segq?.src_prod), segPanelHTML(d, usd), callBriefHTML(c.code), stackChart("🌍 지역별 매출", d.segq?.geo, span, usd, q, d.segq?.src_geo),
    lineChart({ t: "매출 성장률 (YoY)", labels: ks, s: [{ n: "YoY", v: s.yoy, col: "var(--s1)", bar: true }], fl: fPct }),
    lineChart({ t: "영업이익률 (OPM)", labels: ks, s: [{ n: "OPM", v: s.opm, col: "var(--good)" }], fl: fPct }),
    s.gpm.filter((v) => v != null).length >= 4 ? lineChart({ t: "매출총이익률 (GPM)", labels: ks, s: [{ n: "GPM", v: s.gpm, col: "var(--s3)" }], fl: fPct }) : "",
  ];
  const sg = d.longq_seg;  // 삼성전자 DS(반도체) 부문
  if (sg?.q) {
    const sk = Object.keys(sg.q).sort().slice(-span), ss = longSeries(sg.q, sk, false);
    ch.push(lineChart({ t: `${sg.name} 매출 · 영업이익`, labels: sk, s: [{ n: "매출", v: ss.rev, col: "var(--s1)" }, { n: "영업이익", v: ss.op, col: "var(--warn)", right: true, lab: "below" }], fl: kqFmt, fr: kqFmt, zero: true }),
      lineChart({ t: `${sg.name} 영업이익률`, labels: sk, s: [{ n: "OPM", v: ss.opm, col: "var(--good)" }], fl: fPct }));
  }
  return `<div class="lnbox" data-code="${esc(c.code)}"><div class="chart-title" style="margin-top:14px"><b>📈 10년 실적 추이</b> <span class="src">${esc(all[0])}~${esc(all.at(-1))} · 분기 · ${usd ? "SEC·야후 (달러)" : "DART 분기보고서 · 최신 분기는 잠정실적 (원)"}</span></div>
    ${acctHTML(c.code, false)}<div class="seg lseg" style="margin-top:6px">${LONG_TABS.map(([m, l]) => `<button data-ln="${m}" class="${m === span ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="qgrid" style="margin-top:6px">${ch.join("")}</div>${all.length < 20 ? `<div class="note src">예전 분기는 갱신 때마다 조금씩 채워져요 (지금 ${all.length}개 분기)</div>` : ""}</div>`;
}
// 🧱 분기 매출을 제품군·지역으로 쌓은 막대 (사용자 11/4, 샤크닌자·무인양품 그림처럼) — d.segq ← collector/segq.py·segments.yaml
// 색 = 보이는 기간 합이 큰 순 (7개 넘으면 6개 + 기타) · 범례 = 최신 분기 비중과 1년 전 대비 · 꼬리표 = 가장 빨리 크는 칸
const STK_COL = ["var(--s1)", "var(--bad)", "var(--s3)", "var(--s4)", "var(--s7)", "var(--s2)"];
function stackChart(t, q, span, usd, lq, src) {
  const L = Object.keys(q || {}).sort().slice(-span), N = L.length;
  if (N < 2) return "";
  const M = (v) => (usd ? v / 1e3 : v), fm = usd ? usdB : kqFmt, tot = {};
  L.forEach((k) => Object.entries(q[k]).forEach(([s, v]) => { if (v > 0) tot[s] = (tot[s] || 0) + v; }));
  // 지금 칸(최신 분기에 있는 칸, 큰 순) 6개까지 진한 색 · 예전 칸(부문을 새로 나누기 전) 6개까지 같은 색을 연하게 · 나머지는 '그 밖' (회사 칸 '기타'와 안 겹치게)
  const lr = q[L.at(-1)], byTot = (a, b) => tot[b] - tot[a];
  const now = Object.keys(tot).filter((s) => lr[s] > 0 && s !== "나머지").sort((a, b) => lr[b] - lr[a]), was = Object.keys(tot).filter((s) => !(lr[s] > 0) && s !== "나머지").sort(byTot);
  const keepN = now.length > 7 ? now.slice(0, 6) : now, keepW = was.length > 7 ? was.slice(0, 6) : was, keep = [...keepN, ...keepW];
  const more = now.length + was.length > keep.length, order = [...keep, ...(more ? ["그 밖"] : []), ...("나머지" in tot ? ["나머지"] : [])];
  const grp = (s) => (s === "나머지" || keep.includes(s) ? s : "그 밖");
  const col = (s) => (s === "그 밖" || s === "나머지" ? "var(--muted)" : STK_COL[(keepN.includes(s) ? keepN.indexOf(s) : keepW.indexOf(s)) % STK_COL.length]);
  const op = (s) => (keepW.includes(s) ? 0.45 : 1);
  const R = L.map((k) => { const r = {}; Object.entries(q[k]).forEach(([s, v]) => { if (v > 0) r[grp(s)] = (r[grp(s)] || 0) + v; }); return r; });
  const sum = (r) => Object.values(r).reduce((a, v) => a + v, 0), hi = Math.max(...R.map(sum)) * 1.06 || 1;
  const W = 340, x0 = 40, x1 = W - 10, top = 14, bot = 128, X = (i) => x0 + ((x1 - x0) * (i + 0.5)) / N, bw = Math.max(1.5, Math.min(26, ((x1 - x0) / N) * 0.72));
  let g = "";
  [0, 0.5, 1].forEach((f) => { const y = bot - f * (bot - top); g += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${x0 - 3}" y="${y + 3}" text-anchor="end" class="qx">${esc(fm(M(f * hi)))}</text>`; });
  R.forEach((r, i) => {
    let y = bot;
    order.forEach((s) => { if (!r[s]) return; const h = (r[s] / hi) * (bot - top); y -= h; g += `<rect x="${X(i) - bw / 2}" y="${y}" width="${bw}" height="${h}" fill="${col(s)}" fill-opacity="${op(s)}"/>`; });
    const tk = shortQ(i, L); if (tk) g += `<text x="${X(i)}" y="${bot + 13}" text-anchor="middle" class="qx">${esc(tk)}</text>`;
  });
  const shr = (r, s) => (sum(r) ? (r[s] / sum(r)) * 100 : 0), last = R.at(-1), ai = L.indexOf(qAgo(L.at(-1))), ago = ai >= 0 ? R[ai] : null;
  const yoy = (s) => (ago?.[s] > 0 && last[s] ? (last[s] / ago[s] - 1) * 100 : null);
  g += tipCols(X, (x1 - x0) / N, 0, 146, L.map((k, i) => [k, ...order.filter((s) => R[i][s]).map((s) => `${s}: ${fm(M(R[i][s]))} (${n(shr(R[i], s), 0)}%)`), `합: ${fm(M(sum(R[i])))}`].join("\n")));
  const fast = order.filter((s) => s !== "그 밖" && s !== "나머지" && shr(last, s) >= 5 && yoy(s) != null).sort((a, b) => yoy(b) - yoy(a))[0];
  const tag = fast ? `<span class="qtag">${esc(cut(fast, 9))} ${yoy(fast) >= 0 ? "+" : ""}${n(yoy(fast), 0)}% 가장 빠름</span>` : "";
  const rev = lq?.[L.at(-1)]?.rev, over = rev ? (sum(last) / rev - 1) * 100 : 0;
  const leg = order.map((s) => { const y = yoy(s);  // 최신 분기에 없는 칸(부문을 새로 나누기 전)도 색을 알 수 있게 '예전 칸'으로
    return last[s] ? `<span style="color:${col(s)}">■</span> ${esc(s)} <b>${n(shr(last, s), 0)}%</b>${y != null ? ` <span${y < 0 ? ' style="color:var(--bad-ink)"' : ""}>(${y >= 0 ? "+" : ""}${n(y, 0)}%)</span>` : ""}`
      : `<span style="color:${col(s)};opacity:${op(s)}">■</span> <span style="opacity:.75">${esc(s)} (예전 칸)</span>`; }).join(" · ");
  return `<div class="qp"><div class="qt"><b>${esc(t)}</b>${tag}</div><div class="src">${esc(L[0])}~${esc(L.at(-1))} 분기 · 범례 = ${esc(L.at(-1))} 비중 (1년 전 대비)${over > 5 ? ` · 부문 합이 매출보다 ${n(over, 0)}% 많아요 (부문끼리 사고판 내부 거래 포함)` : ""}${"나머지" in tot ? " · 나머지 = 회사가 이 표에서 안 나눈 매출" : ""}${src ? ` · 출처 ${esc(src)}` : ""}</div>
    <svg viewBox="0 0 ${W} 146" role="img" aria-label="${esc(t)}">${g}</svg><div class="src" style="padding:0 4px 4px">${leg}</div></div>`;
}
// 📊 부문별 매출·이익 7분기 (사용자 11/6, 카카오 IR 표·그림처럼) — 🧱 아래 접힘: 표(1년 전·전 분기·이번 + YoY·QoQ·비중/이익률) · 쌓은 막대 · 부문마다 작은 막대
// 매출 = d.segq.prod (🧱 와 같은 숫자) · 이익 = d.segq.op (DART 주석 '영업부문' · SEC 사업부문 축, tools/dart_seg.py · sec_segments.py) — 이익률은 같은 표의 부문 매출 op_rev
const qNo = (k) => +k.slice(0, 2) * 4 + +k[3];  // '26.3Q' → 분기 번호
function segChg(a, b, pr) {  // 1년 전·전 분기 대비 — 이익이 0 이하면 흑자 전환·적자 전환·적자 지속
  if (a == null || b == null) return '<span class="src">-</span>';
  if (pr && (a <= 0 || b <= 0)) return `<span class="src" style="${a <= 0 ? "color:var(--bad-ink)" : ""}">${b <= 0 && a > 0 ? "흑자 전환" : b > 0 ? "적자 전환" : "적자 지속"}</span>`;
  if (b <= 0) return '<span class="src">-</span>';
  const p = (a / b - 1) * 100;
  return `<span${p < 0 ? ' style="color:var(--bad-ink)"' : ""}>${n(p, 1)}%</span>`;
}
function segTbl(Q, ks, names, fT, last3, pr) {  // last3 = [이름 → 끝 칸 HTML] (비중 또는 이익률)
  const L = ks.at(-1), P = ks.at(-2), A = qAgo(L), H = [A in Q ? A : null, P, L];
  return `<div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">부문</th>${H.map((k, i) => `<th${i === 2 ? ' style="background:var(--surface-2)"' : ""}>${esc(k || A)}</th>`).join("")}<th>YoY</th><th>QoQ</th><th>${pr ? "이익률" : "비중"}</th></tr></thead><tbody>
    ${names.map((s) => { const v = (k) => (k ? Q[k]?.[s] : null), tot = s === "__tot";
      return `<tr${tot ? ' style="font-weight:700;border-top:2px solid var(--axis)"' : ""}><td style="text-align:left">${esc(tot ? (pr ? "회사 전체 영업이익" : "합계") : s)}</td>${H.map((k, i) => `<td${i === 2 ? ' style="background:var(--surface-2)"' : ""}>${i === 2 ? `<b>${fT(v(k))}</b>` : fT(v(k))}</td>`).join("")}${s === "본사·조정 등" ? '<td class="src">-</td><td class="src">-</td>' : `<td>${segChg(v(L), v(H[0]), pr)}</td><td>${segChg(v(L), v(P), pr)}</td>`}<td>${last3(s)}</td></tr>`; }).join("")}</tbody></table></div>`;
}
function seg7Stack(Q, ks, names, col, fC, fS) {  // 쌓은 막대 + 칸 안 금액 + 막대 위 합계
  const W = 340, x0 = 38, x1 = W - 6, top = 16, bot = 150, N = ks.length;
  const tot = ks.map((k) => names.reduce((a, s) => a + Math.max(0, Q[k]?.[s] || 0), 0)), hi = Math.max(...tot) * 1.1 || 1;
  const X = (i) => x0 + ((x1 - x0) * (i + 0.5)) / N, bw = Math.min(34, ((x1 - x0) / N) * 0.62), Hh = (v) => (v / hi) * (bot - top);
  let g = "";
  [0, 0.5, 1].forEach((f) => { const y = bot - f * (bot - top); g += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${x0 - 3}" y="${y + 3}" text-anchor="end" class="qx">${esc(fC(f * hi))}</text>`; });
  ks.forEach((k, i) => {
    let y = bot;
    names.forEach((s, j) => { const v = Math.max(0, Q[k]?.[s] || 0); if (!v) return; const h = Hh(v); y -= h;
      g += `<rect x="${X(i) - bw / 2}" y="${y}" width="${bw}" height="${h}" fill="${col(s, j)}"><title>${esc(`${k} ${s}: ${fC(v)}`)}</title></rect>`;
      if (h >= 11 && bw >= 22) g += `<text x="${X(i)}" y="${y + h / 2 + 3}" text-anchor="middle" style="font-size:8px;fill:#fff;paint-order:stroke;stroke:rgba(0,0,0,.35);stroke-width:2px">${esc(fS(v))}</text>`; });
    g += `<text x="${X(i)}" y="${y - 3}" text-anchor="middle" class="qv${i === N - 1 ? " b" : ""}">${tot[i] ? esc(fS(tot[i])) : "못 읽음"}</text><text x="${X(i)}" y="${bot + 12}" text-anchor="middle" class="qx"${i === N - 1 ? ' style="font-weight:700"' : ""}>${esc(k)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} 166" role="img" aria-label="부문별 매출 쌓은 막대">${g}</svg><div class="src" style="padding:0 4px 4px">${names.map((s, j) => `<span style="color:${col(s, j)}">■</span> ${esc(s)}`).join(" · ")}</div>`;
}
function seg7Mini(t, ks, vals, c, fS, sub, yoy) {  // 부문 하나: 7분기 막대 (이번 분기만 진하게) + 금액 + 1년 전 대비
  const W = 340, x0 = 6, x1 = W - 6, top = 24, bot = 92, N = ks.length, vv = vals.filter((v) => v != null);
  if (!vv.length) return "";
  const lo = Math.min(0, ...vv), hi = Math.max(0, ...vv), rg = hi - lo || 1, Y = (v) => bot - ((v - lo) / rg) * (bot - top);
  const X = (i) => x0 + ((x1 - x0) * (i + 0.5)) / N, bw = Math.min(30, ((x1 - x0) / N) * 0.6);
  let g = lo < 0 ? `<line x1="${x0}" x2="${x1}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--axis)"/>` : "";
  vals.forEach((v, i) => {
    if (v == null) return;
    const y0 = Y(Math.max(0, v)), h = Math.max(1, Math.abs(Y(v) - Y(0))), last = i === N - 1, yy = yoy?.[i];
    g += `<rect x="${X(i) - bw / 2}" y="${y0}" width="${bw}" height="${h}" fill="${v < 0 ? "var(--bad)" : c}" fill-opacity="${last ? 1 : 0.35}"/>`;
    const ty = v < 0 ? Y(v) + 11 : y0 - 3;
    g += `<text x="${X(i)}" y="${ty}" text-anchor="middle" class="qv${last ? " b" : ""}">${esc(fS(v))}</text>`;
    if (yy != null && v >= 0) g += `<text x="${X(i)}" y="${ty - 10}" text-anchor="middle" style="font-size:8px;fill:var(${yy < 0 ? "--bad-ink" : "--muted"})">${yy >= 0 ? "+" : ""}${n(yy, 1)}%</text>`;
    g += `<text x="${X(i)}" y="${bot + 13}" text-anchor="middle" class="qx">${esc(k2s(ks[i]))}</text>`;
  });
  return `<div class="qp"><div class="qt"><b>${esc(t)}</b>${sub || ""}</div><svg viewBox="0 0 ${W} 110" role="img" aria-label="${esc(t)}">${g}</svg></div>`;
}
const k2s = (k) => k.slice(3) + k.slice(0, 2);  // '26.3Q' → '3Q26' (그림 아래 칸 이름 짧게)
function segPanelHTML(d, usd) {
  const sq = d.segq || {}, lq = d.longq || {}, P = sq.prod || {}, O = sq.op || {}, OR = sq.op_rev || {};
  // 칸 = 마지막 분기까지 이어진 7분기 (못 읽은 분기는 빈칸 — 건너뛰면 1년 전 비교가 틀려 보여서)
  const run7 = (Q) => { const ks = Object.keys(Q).sort(), L = ks.at(-1); if (!L) return []; const r = Array.from({ length: 7 }, (_, i) => { const q = qNo(L) - 6 + i, y = Math.floor((q - 1) / 4); return `${String(y).padStart(2, "0")}.${q - 4 * y}Q`; }); return r.filter((k) => Q[k]).length >= 2 ? r : []; };
  const pk = run7(P), ok0 = Object.keys(O).sort(), endQ = Object.keys(lq).sort().at(-1) || pk.at(-1);
  const ok = ok0.length >= 2 && qNo(endQ) - qNo(ok0.at(-1)) <= 4 ? run7(O) : [];  // 1년 넘게 밀린 부문 이익(표 모양이 바뀌어 못 읽음)은 안 보임
  const uni = (Q, ks) => { const L = ks.at(-1), t = {}; ks.forEach((k) => Object.entries(Q[k] || {}).forEach(([s, v]) => { t[s] = (t[s] || 0) + Math.abs(v); }));  // 7분기에 나온 칸 모두 (이번 분기 큰 순 → 예전 칸)
    return Object.keys(t).filter((s) => s !== "나머지").sort((a, b) => (Q[L]?.[b] ?? -1e15) - (Q[L]?.[a] ?? -1e15) || t[b] - t[a]).concat("나머지" in t ? ["나머지"] : []); };
  if (pk.length < 2 && !ok.length) return "";
  const fT = (v) => (v == null ? "-" : usd ? usdB(v / 1e3) : n(Math.abs(v) < 0.5 ? 0 : v, 0)), fC = (v) => (usd ? usdB(v / 1e3) : kqFmt(v)), fS = (v) => (usd ? n(v / 1e3, 1) : n(v, 0));
  const unit = usd ? "십억 달러($B)" : "억원", col = (s, j) => (s === "나머지" ? "var(--muted)" : STK_COL[j % STK_COL.length]);
  const late = (k) => (endQ && k && qNo(endQ) > qNo(k) ? ` <span class="qtag warn">${esc(k)}까지</span>` : "");
  let h = "";
  if (pk.length >= 2) {
    const L = pk.at(-1), nm = uni(P, pk);
    const Qt = Object.fromEntries(Object.entries(P).map(([k, r]) => [k, { ...r, __tot: Object.values(r).reduce((a, v) => a + (v > 0 ? v : 0), 0) }]));
    const sh = (s) => (s === "__tot" ? "100%" : P[L][s] != null ? `${n((P[L][s] / Qt[L].__tot) * 100, 1)}%` : '<span class="src">-</span>'), yo = (s) => pk.map((k) => (P[qAgo(k)]?.[s] > 0 && P[k]?.[s] != null ? (P[k][s] / P[qAgo(k)][s] - 1) * 100 : null));
    h += `<div class="chart-title" style="margin-top:8px"><b>💵 사업부문별 매출</b> <span class="src">단위 ${unit} · ${esc(sq.src_prod || "")}</span>${late(L)}</div>
      ${segTbl(Qt, pk, [...nm, "__tot"], fT, sh, false)}
      <div class="qgrid" style="margin-top:6px"><div class="qp" style="grid-column:1/-1"><div class="qt"><b>부문 구성 · 막대 위 = 합계</b></div>${seg7Stack(P, pk, nm, col, fC, fS)}</div>
      ${nm.slice(0, 8).map((s, j) => seg7Mini(s, pk, pk.map((k) => P[k]?.[s] ?? null), col(s, j), fS, "", yo(s))).join("")}</div>`;
  }
  if (ok.length) {
    const L = ok.at(-1), nm = uni(O, ok), tq = lq[L]?.op;
    const Qt = Object.fromEntries(ok.concat(qAgo(L)).filter((k) => O[k]).map((k) => { const r = { ...O[k] }, t = lq[k]?.op;
      if (t != null) { r.__tot = t; r["본사·조정 등"] = t - Object.values(O[k]).reduce((a, v) => a + v, 0); } return [k, r]; }));
    const rows = [...nm, ...(tq != null && Math.abs(Qt[L]["본사·조정 등"]) >= Math.abs(tq) * 0.005 ? ["본사·조정 등"] : []), ...(tq != null ? ["__tot"] : [])];
    const mg = (s) => { const r = s === "__tot" ? lq[L]?.rev : OR[L]?.[s], v = Qt[L]?.[s]; return r > 0 && v != null && s !== "본사·조정 등" ? `<span${v < 0 ? ' style="color:var(--bad-ink)"' : ""}>${n((v / r) * 100, 1)}%</span>` : '<span class="src">-</span>'; };
    h += `<div class="chart-title" style="margin-top:12px"><b>💰 사업부문별 영업이익</b> <span class="src">단위 ${unit} · ${esc(sq.src_op || "")} · 이익률 = 부문 이익 ÷ 같은 부문 매출 (부문끼리 사고판 매출 포함일 수 있어요)</span>${late(L)}</div>
      ${segTbl(Qt, ok, rows, fT, mg, true)}
      ${tq != null && rows.includes("본사·조정 등") ? `<div class="note src" style="margin-top:2px">본사·조정 등 = 회사 전체 영업이익 − 부문 합 (본사 비용·부문 사이 거래 지우기 등)</div>` : ""}
      <div class="qgrid" style="margin-top:6px">${nm.slice(0, 8).map((s, j) => { const r = OR[L]?.[s], v = O[L][s];
        return seg7Mini(s, ok, ok.map((k) => O[k]?.[s] ?? null), col(s, j), fS, r > 0 ? `<span class="qtag${v < 0 ? " bad" : ""}">이익률 ${n((v / r) * 100, 1)}%</span>` : "", null); }).join("")}</div>`;
  } else h += `<div class="note src" style="margin-top:8px">💰 부문별 영업이익은 없어요 — 사업부문이 하나인 회사이거나, 회사가 매출만 나눠 공개하거나, 보고서 표 모양이 달라 아직 못 읽었어요.</div>`;
  if (endQ && pk.length && qNo(endQ) > qNo(pk.at(-1))) h += `<div class="note src">${esc(endQ)} 부문 숫자는 분기보고서(분기 끝 뒤 약 45일)가 나오면 채워져요 — 회사 전체 실적은 먼저 나와요.</div>`;
  return `<details class="fvt" style="grid-column:1/-1"><summary class="chart-title"><b>📊 사업부문별 매출·영업이익 (최근 7분기)</b> <span class="src">1년 전·전 분기 대비 · 비중·이익률 · 눌러서 열기</span></summary>${h}</details>`;
}
// 🎤 컨콜·가이던스 요지 ①~⑥ (사용자 11/6, 컨콜 정리 그림처럼) — 맨 위(최신) 분기 earnings.yaml 을 6칸으로 다시 나눔, 칸마다 접힘 · 🧱 아래
const keysHTML = (e) => ((e.keys || []).length ? `<div class="card" style="margin-top:8px;background:var(--surface-2)"><b>🎤 어닝콜 핵심</b>${e.keys.map((x, j) => `<div style="margin-top:6px"><b style="color:${x.tone === "bad" ? "var(--bad-ink)" : "var(--good-ink)"}">${"①②③④⑤⑥"[j] || "·"} ${esc(x.h)}</b> ${x.tone === "bad" ? "⚠" : "✔"}
  ${(x.q || []).map((t) => `<div class="src" style="margin-left:18px">${/^[(（]/.test(t) ? esc(t) : `“${esc(t)}”`}</div>`).join("")}</div>`).join("")}</div>` : "");
function callBriefHTML(code) {
  const L = EARNINGS[code] || [], e = L[0];
  if (!e) return "";
  const li = (a) => `<ul class="irl">${a.map((x) => `<li${String(x).startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`).join("")}</ul>`, prevQ = e.diff_from || L[1]?.quarter;
  const sec = (t, body, cnt) => `<details class="fvt"><summary class="chart-title"><b>${t}</b>${cnt ? ` <span class="src">${cnt}</span>` : ""}${body ? "" : ' <span class="src">· 이번엔 없음</span>'}</summary>${body || '<div class="note src">이번 분기 요약에는 이 칸이 없어요 — 다음 실적부터 예약 작업이 같이 적어요.</div>'}</details>`;
  const s1 = [(e.easy || []).length ? `<div class="kidbox">🐣 ${li(e.easy)}</div>` : "", (e.short || []).length ? `<div class="warnbox" style="margin-top:6px"><b>⚡ 핵심만</b>${li(e.short)}</div>` : "",
    (e.vs || []).length || e.after ? vsHTML({ vs: e.vs, after: e.after }) : "", onceHTML(e.once)].join("");
  const s2 = keysHTML(e) + ((e.facts || []).length ? `<div class="card" style="margin-top:8px;background:var(--surface-2)"><b>🆕 뉴팩트</b> <span class="src">이번 발표에서 새로 나온 사실</span>${li(e.facts)}</div>` : "");
  const s3 = ((e.guide || []).length ? `<div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">항목</th><th style="text-align:left">회사 전망</th><th>시장 예상</th><th></th></tr></thead><tbody>${e.guide.map((x) => `<tr><td style="text-align:left"><b>${esc(x.k)}</b></td><td style="text-align:left;white-space:normal;min-width:10em">${esc(x.a ?? "-")}${typeof x.a === "number" && x.u ? esc(x.u) : ""}</td><td>${esc(x.e ?? "")}</td><td class="src" style="white-space:normal">${esc(x.b || "")}</td></tr>`).join("")}</tbody></table></div>` : "")
    + ((e.guide_note || []).length ? `<div class="note">💬 <b>가이던스 읽는 법</b>${li(e.guide_note)}</div>` : "");
  const s4 = callDiffHTML({ quarter: e.quarter, qa: e.qa, qa_u: e.qa_u });
  const s5 = callDiffHTML({ quarter: e.quarter, diff: e.diff, voice: e.voice }, prevQ);
  const s6 = ((e.check || []).length ? `<div class="card" style="margin-top:8px"><b>✅ 다음 발표 때 확인할 것</b>${li(e.check)}</div>` : "") + callDiffHTML({ miss: e.miss }) + previewHTML(e.next);
  return `<details class="fvt" style="grid-column:1/-1"><summary class="chart-title"><b>🎤 컨콜·가이던스 요지</b> <span class="src">${esc(e.quarter)} · ${esc(e.date || "")} · 6칸 · 눌러서 열기</span></summary>
    <div class="note src" style="margin-top:4px">${esc(e.source || "")}</div>
    ${sec("① 한눈에 보기", s1)}${sec("② 경영진 발표 정리", s2, (e.keys || []).length ? `핵심 ${e.keys.length}개` : "")}${sec("③ 가이던스·목표", s3, (e.guide || []).length ? `${e.guide.length}개` : "")}
    ${sec(`④ 질의응답${(e.qa || []).length ? ` (${e.qa.length}개)` : ""}`, s4)}${sec(`⑤ 직전 분기 콜과 비교${prevQ ? ` (${esc(prevQ)})` : ""}`, s5)}${sec("⑥ 다음 분기까지 체크포인트", s6)}
    <div class="note src">전체 요약(일회성 점검·자세히 보기 포함)은 아래 '📞 실적발표 요약'에 있어요.</div></details>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".lnbox .lseg button"); if (!b) return;
  const box = b.closest(".lnbox");
  box.outerHTML = longHTML(LONG_MAP[box.dataset.code], +b.dataset.ln);
});
// ⚖️ 비교 탭 (data/compare.json = 종목 10년 실적 + config/compare.yaml): 메모리 3사 · 낸드 · 빅테크 CapEx · 클라우드
let CMPD = null, CMP_SPAN = 40;
async function renderCompare() {
  if (!CMPD) { try { CMPD = (await (await fetch("data/compare.json?t=" + Date.now(), { cache: "no-store" })).json()) || {}; } catch (_) { CMPD = {}; } }
  if (!CAPEX) { try { CAPEX = await (await fetch("data/capex.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { CAPEX = {}; } }
  $("#compareBody").innerHTML = compareHTML(CMP_SPAN);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("#compareBody .cseg button"); if (!b) return;
  CMP_SPAN = +b.dataset.cs;
  $("#compareBody").innerHTML = compareHTML(CMP_SPAN);
});
const CMP_COL = { "000660": "var(--warn)", SK하이닉스: "var(--warn)", "005930": "var(--s1)", 삼성전자: "var(--s1)", "삼성전자 DS": "var(--s1)", MU: "var(--good)", 마이크론: "var(--good)", 샌디스크: "var(--good)",
  MSFT: "var(--s1)", GOOG: "var(--bad)", META: "var(--s3)", AMZN: "var(--warn)", ORCL: "var(--s4)" };
const cmpName = (c) => DASH?.stocks?.find((s) => s.code === c)?.name || { MU: "마이크론", ORCL: "오라클", AMZN: "아마존" }[c] || c;
// 분기 눈금 ('26.3Q' 라벨): 8칸 이하 = 분기마다 '3Q26', 16칸 이하 = 1·3분기, 그보다 길면 해마다 '25 (12년 넘으면 2년마다)
const shortQ = (i, L) => {
  const q = L[i], N = L.length;
  if (!/^\d\d\.\dQ$/.test(q || "")) return "";
  const y = q.slice(0, 2), k = +q[3];
  return N <= 8 ? `${k}Q${y}` : N <= 16 ? (k % 2 ? `${k}Q${y}` : "") : k === 1 && +y % (N > 48 ? 2 : 1) === 0 ? `'${y}` : "";
};
// 시가총액(달러, 주봉): 지금 주식 수 × 주봉 종가 (한국은 그 주 원/달러로 나눔)
function mcapChart(D, span) {
  const M = D.mcap || {}, codes = (D.cfg?.mcap || []).filter((c) => M[c]);
  if (!codes.length) return "";
  const fxd = Object.keys(D.fx_w || {}).sort();
  const fxAt = (d) => { let lo = 0, hi = fxd.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (fxd[m] <= d) { r = fxd[m]; lo = m + 1; } else hi = m - 1; } return r ? D.fx_w[r] : null; };
  let ds = [...new Set(codes.flatMap((c) => Object.keys(M[c].w)))].sort();
  if (span < 999) ds = ds.slice(-span * 13);
  const st = Math.max(1, Math.ceil(ds.length / 160)); ds = ds.filter((_, i) => i % st === 0 || i === ds.length - 1);
  const s = codes.map((c) => ({ n: cmpName(c), col: CMP_COL[c] || "var(--ink-2)", v: ds.map((d) => {
    const p = M[c].w[d]; if (p == null) return null;
    const v = p * M[c].shares; return M[c].cur === "USD" ? v / 1e9 : fxAt(d) ? v / fxAt(d) / 1e9 : null; }) }));
  const ev = ds.length > 400 ? 3 : ds.length > 200 ? 2 : 1;
  return lineChart({ t: "시가총액 ($B, 주봉)", why: "지금 주식 수 × 그때 주가 — 자사주 소각·증자는 반영 못 함", labels: ds, s, fl: usdB,
    tick: (i) => (i && ds[i].slice(0, 4) !== ds[i - 1].slice(0, 4) && +ds[i].slice(2, 4) % ev === 0 ? `'${ds[i].slice(2, 4)}` : "") });
}
// 💵 현금 창고 (CNBC 표 모양): 현금·현금성 + 단기투자 = 현금성 자산 합계, 여기서 빚(차입금·사채·리스)을 빼면 순현금
let CASH_MKT = "US";
document.addEventListener("click", (e) => {
  const b = e.target.closest(".cashmk button"); if (!b) return;
  CASH_MKT = b.dataset.mk; $("#cashBox").outerHTML = cashHTML();
});
function cashHTML() {
  const us = CASH_MKT === "US";
  const f = (v) => (us ? qMoney(v, true) : Math.abs(v) >= 1e12 ? `${n(v / 1e12, 1)}조` : `${n(v / 1e8, 0)}억`);
  const rows = (DASH?.stocks || []).filter((s) => s.tbl?.cash_raw && (s.market === "US") === us)
    .map((s) => ({ s, ...s.tbl.cash_raw, t: s.tbl.cash_raw.cash + s.tbl.cash_raw.sti })).sort((a, b) => b.t - a.t);
  const seg = `<div class="seg cashmk" style="margin-bottom:8px"><button data-mk="US" class="${us ? "on" : ""}">🇺🇸 미국</button><button data-mk="KR" class="${us ? "" : "on"}">🇰🇷 한국</button></div>`;
  if (!rows.length) return `<div id="cashBox"><h3>💵 현금 창고</h3><div class="card">${seg}<div class="note src">⏳ 다음 데이터 갱신 때 채워져요.</div></div></div>`;
  const mx = Math.max(...rows.flatMap((r) => [r.cash, r.sti]), 1);
  const bar = (v, col) => `<span class="cbar"><i style="width:${Math.max(0.15, (v / mx) * 6).toFixed(2)}em;background:${col}"></i>${f(v)}</span>`;
  const tr = rows.map(({ s, cash, sti, debt, t }) => {
    const nc = t - debt, pct = s.tbl.net_cash_pct;
    return `<tr><td><a href="#stock/${esc(s.code)}">${esc(s.name)}</a><br><span class="src">${esc(s.group || "")} · ${esc((s.tbl.net_cash_asof || "").slice(2).replace("-", "."))}</span></td>
      <td>${bar(cash, "var(--s1)")}</td><td>${bar(sti, "var(--s3)")}</td><td><b>${f(t)}</b></td><td>${f(debt)}</td>
      <td><b class="${nc < 0 ? "neg" : ""}">${f(nc)}</b>${pct != null ? ` <span class="src">시총의 ${n(pct, Math.abs(pct) < 10 ? 1 : 0)}%</span>` : ""}</td></tr>`;
  }).join("");
  return `<div id="cashBox"><h3>💵 현금 창고 <span class="src">보유·관심 종목 · 최근 분기 재무상태표 (야후) · ${us ? "달러" : "원"}</span></h3><div class="card">${seg}
    <div class="cmp-wrap"><table class="cmp cash"><thead><tr><th>종목 <span class="src">· 기준 분기</span></th><th>현금·현금성</th><th>단기투자</th><th>합계</th><th>빚 (리스 포함)</th><th>순현금</th></tr></thead><tbody>${tr}</tbody></table></div>
    <div class="note src">합계 = 현금·현금성 + 단기투자(단기 국채·정기예금처럼 곧 현금이 되는 것) — CNBC 표의 Total 이에요. 순현금 = 합계 − 빚(차입금·사채·리스 부채). 마이너스면 가진 현금보다 빚이 많아요.
    증권사·리츠·건설·유통처럼 빚이 사업 구조인 회사는 그대로 비교하기 어려워요. 야후에 새 분기가 올라오면 기준 분기가 바뀌어요.</div></div>${debtHTML(rows.map((r) => r.s), f)}</div>`;
}
// 🏦 빚 조달 추적: 분기말 빚 잔액 추이 + 1년 새 늘어난 빚 + 최근 4분기 회사채·장기 대출 발행 + 뉴스 메모 (config/debt.yaml)
function debtHTML(list, f) {
  const day = (d) => new Date(d).getTime() / 864e5;
  const rows = list.map((s) => {
    const dq = s.tbl.cash_raw.debt_q || {}, ks = Object.keys(dq).sort(), last = ks.at(-1);
    const ago = ks.find((k) => Math.abs(day(last) - day(k) - 365) < 40);
    const iss = Object.entries(s.tbl.debt_iss || {}).sort().slice(-4);
    return { s, dq, ks, up: ago ? dq[last] - dq[ago] : null, iss: iss.length ? iss.reduce((a, [, v]) => a + v, 0) : null, n: iss.length };
  }).filter((r) => r.ks.length).sort((a, b) => (b.up ?? -Infinity) - (a.up ?? -Infinity));
  if (!rows.length) return "";
  const spark = (dq, ks) => { const mx = Math.max(...ks.map((k) => dq[k]), 1);
    return `<svg width="${ks.length * 9}" height="22" style="vertical-align:middle">${ks.map((k, i) => `<rect x="${i * 9}" y="${22 - (dq[k] / mx) * 20}" width="6" height="${Math.max(1, (dq[k] / mx) * 20)}" rx="1" fill="${i === ks.length - 1 ? "var(--bad)" : "var(--axis)"}"><title>${esc(k)} ${f(dq[k])}</title></rect>`).join("")}</svg>`; };
  const tr = rows.map(({ s, dq, ks, up, iss, n: cnt }) => `<tr><td><a href="#stock/${esc(s.code)}">${esc(s.name)}</a><br><span class="src">${esc(ks[0].slice(2, 7).replace("-", "."))}~${esc(ks.at(-1).slice(2, 7).replace("-", "."))}</span></td>
      <td>${spark(dq, ks)} ${f(dq[ks.at(-1)])}</td><td><b class="${up > 0 ? "neg" : ""}">${up == null ? "-" : (up > 0 ? "+" : "") + f(up)}</b></td>
      <td>${iss == null ? "-" : f(iss)}${iss != null && cnt < 4 ? ` <span class="src">${cnt}개 분기</span>` : ""}</td></tr>
      ${(s.tbl.debt_news || []).map((x) => `<tr><td colspan="4" style="white-space:normal;text-align:left;position:static"><span class="src">📰 ${esc(x.date)}</span> ${esc(x.text)}${x.url ? ` <a href="${esc(x.url)}" target="_blank" rel="noopener">기사</a>` : ""}</td></tr>`).join("")}`).join("");
  return `<h3>🏦 빚 조달 추적 <span class="src">회사채·대출로 얼마나 빌리나 · 분기 재무제표 (야후)</span></h3><div class="card">
    <div class="cmp-wrap"><table class="cmp cash"><thead><tr><th>종목 <span class="src">· 기간</span></th><th>빚 잔액 (분기말)</th><th>1년 새 늘어난 빚</th><th>회사채·장기 대출 발행<br><span class="src">최근 4분기 합계</span></th></tr></thead><tbody>${tr}</tbody></table></div>
    <div class="note src">빚 잔액 = 회사채 + 은행 대출 + 리스 부채 (막대 = 분기말, 빨강 = 최근). 발행 = 현금흐름표에서 회사채·장기 대출로 새로 받은 돈 (갚은 돈은 안 뺌). 야후 재무제표는 발표 뒤 며칠~몇 주 늦게 들어와서, 최근 큰 발행은 📰 뉴스 메모로 먼저 적어 둬요.</div></div>`;
}
// 📊 종목 골라 비교 — FCF · CapEx · 영업이익률 · 매출 성장률 따로 (기본 M7). 티커나 이름을 넣으면 그 종목 선이 생겨요 (자료 = 종목별 분기 실적)
const PEER_SETS = { M7: ["MSFT", "GOOG", "META", "AMZN", "AAPL", "NVDA", "TSLA"], "빅테크 4": ["MSFT", "GOOG", "META", "AMZN"], 메모리: ["005930", "000660", "MU"] };
let PICKS = PEER_SETS.M7, PICK_MISS = "";
try { const s = JSON.parse(localStorage.getItem("PICKS") || "null"); if (Array.isArray(s) && s.length) PICKS = s; } catch (_) {}
const peerRedraw = () => { try { localStorage.setItem("PICKS", JSON.stringify(PICKS)); } catch (_) {} $("#peerBox").outerHTML = peerHTML(CMP_SPAN); };
document.addEventListener("click", (e) => {
  const s = e.target.closest("#peerBox [data-set]"), r = e.target.closest("#peerBox [data-rm]");
  if (s) { PICKS = [...PEER_SETS[s.dataset.set]]; PICK_MISS = ""; peerRedraw(); }
  if (r) { PICKS = PICKS.filter((c) => c !== r.dataset.rm); peerRedraw(); }
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "peerAdd") return;
  const q = e.target.value.trim(), L = CMPD?.longq || {}, up = q.toUpperCase();
  const code = q.match(/\(([^)]+)\)\s*$/)?.[1] || (L[up] ? up : (DASH?.stocks || []).find((s) => L[s.code] && (s.name === q || s.name.toUpperCase().includes(up)))?.code);
  PICK_MISS = code ? "" : q;
  if (code && !PICKS.includes(code)) PICKS = [...PICKS, code];
  peerRedraw();
});
function peerHTML(span) {
  const D = CMPD || {}, L = D.longq || {}, fx = (k) => D.fx_q?.[k];
  const cs = PICKS.filter((c) => L[c]), usd = cs.some((c) => mktOf(c) === "US");
  // 금액: 미국 백만 달러 · 한국 억원 → 미국이 하나라도 있으면 모두 $B (한국은 그 분기 평균 환율), 아니면 조원
  const amt = (c, k, v) => (v == null ? null : mktOf(c) === "US" ? v / 1e3 : !usd ? v / 1e4 : fx(k) ? v / (fx(k) * 10) : null);
  const ks = [...new Set(cs.flatMap((c) => Object.keys(L[c])))].sort().slice(span < 999 ? -span : 0);
  const fm = usd ? usdB : (v) => `${n(v, 1)}조`, U = usd ? "$B" : "조원";
  const fcf = (c, k) => { const r = L[c][k] || {}; return r.ocf != null && r.capex != null ? amt(c, k, r.ocf - r.capex) : null; };
  const defs = [
    [`현금흐름 FCF (${U})`, fcf, fm, "영업으로 번 현금 − 설비투자 · 0 아래 = 번 돈보다 투자에 더 씀"],
    [`CapEx 설비투자 (${U})`, (c, k) => amt(c, k, L[c][k]?.capex), fm, ""],
    ["영업이익률 (OPM)", (c, k) => { const r = L[c][k] || {}; return r.rev && r.op != null ? (r.op / r.rev) * 100 : null; }, fPct, ""],
    ["매출 성장률 (YoY)", (c, k) => { const r = L[c][k] || {}, p = L[c][qAgo(k)]?.rev; return r.rev && p > 0 ? (r.rev / p - 1) * 100 : null; }, fPct, "1년 전 같은 분기 대비"],
  ];
  // 색: 회사 고유색(CMP_COL)을 먼저, 이미 쓴 색이면 안 쓴 색으로 (선끼리 같은 색 안 되게)
  const PAL = ["var(--s1)", "var(--bad)", "var(--s3)", "var(--warn)", "var(--s7)", "var(--s2)", "var(--ink-2)", "var(--s4)", "var(--good)"], used = new Set();
  const col = Object.fromEntries(cs.map((c) => { const k = CMP_COL[c] && !used.has(CMP_COL[c]) ? CMP_COL[c] : PAL.find((p) => !used.has(p)) || "var(--muted)"; used.add(k); return [c, k]; }));
  const charts = defs.map(([t, f, fl, why]) => {
    const s = cs.map((c) => ({ n: cmpName(c), col: col[c], v: ks.map((k) => f(c, k)) })).filter((x) => x.v.some((v) => v != null));
    return s.length ? lineChart({ t, why, labels: ks, s, fl, zero: true, tick: (i) => shortQ(i, ks) }) : "";
  }).join("");
  // FCF 꼬리표: 몇 분기 연속 적자 · 적자 전환 · 몇 분기 연속 악화 (확정 분기 기준)
  const tags = cs.map((c) => {
    const v = Object.keys(L[c]).sort().map((k) => fcf(c, k)).filter((x) => x != null);
    if (v.length < 2) return "";
    let neg = 0, down = 0;
    for (let i = v.length - 1; i >= 0 && v[i] < 0; i--) neg++;
    for (let i = v.length - 1; i > 0 && v[i] < v[i - 1]; i--) down++;
    const t = neg >= 2 ? `${neg}분기 연속 적자` : neg === 1 ? "적자 전환" : down >= 2 ? `${down}분기 연속 악화` : "";
    return t ? `<span class="qtag bad">${esc(cmpName(c))} ${t}</span>` : "";
  }).join(" ");
  const opts = (DASH?.stocks || []).filter((s) => L[s.code] && !PICKS.includes(s.code)).map((s) => `<option value="${esc(s.name)} (${esc(s.code)})">`).join("");
  return `<div id="peerBox"><h3>📊 종목 골라 비교 <span class="src">분기 확정 실적 · 티커나 종목명을 넣으면 선이 생겨요</span></h3><div class="card">
    <div class="seg" style="margin-bottom:6px">${Object.keys(PEER_SETS).map((k) => `<button data-set="${esc(k)}">${esc(k)}</button>`).join("")}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">${cs.map((c) => `<span class="chip on" data-rm="${esc(c)}" role="button" title="빼기" style="background:${col[c]};border-color:${col[c]}">${esc(cmpName(c))} ✕</span>`).join("")}
      <input id="peerAdd" list="peerList" placeholder="+ 티커·종목명 (예: ORCL, 삼성전자)" style="min-width:12em;padding:4px 8px"><datalist id="peerList">${opts}</datalist></div>
    ${PICK_MISS ? `<div class="note src">‘${esc(PICK_MISS)}’ 는 자료가 없어요 — 보유·관심·공동 종목만 그릴 수 있어요.</div>` : ""}
    ${tags ? `<div style="margin-top:8px">${tags}</div>` : ""}
    <div class="qgrid" style="margin-top:6px">${charts || `<div class="note src">⏳ 종목별 분기 자료를 모으는 중이에요.</div>`}</div>
    <div class="note src">FCF = 영업현금흐름 − 설비투자(총액) · 아마존이 발표하는 FCF 는 설비 매각·보조금을 빼 줘서 조금 덜 나빠요 (26.3Q -$34.8B vs 회사 기준 -$33.5B) · 분기 이름 = 달력 분기 · 3년/5년/10년 탭으로 기간 바꾸기</div></div></div>`;
}
function compareHTML(span) {
  const D = CMPD || {}, cfg = D.cfg || {}, lq = (c) => D.longq?.[c] || {}, fx = (k) => D.fx_q?.[k];
  const keysOf = (...os) => [...new Set(os.flatMap((o) => Object.keys(o || {})))].sort().slice(span < 999 ? -span : 0);
  const box = (t, sub, body, note = "") => `<h3>${t} <span class="src">${sub}</span></h3><div class="card"><div class="qgrid">${body}</div>${note}</div>`;
  const wait = (what) => `<div class="note src">⏳ ${what} 자료를 모으는 중이에요 — 채워지면 그림이 나와요.</div>`;
  const opmOf = (rev, op) => rev.map((r, i) => (r && op[i] != null ? (op[i] / r) * 100 : null));
  const out = [cashHTML(), `<div class="seg cseg" style="margin:14px 0 10px">${LONG_TABS.map(([m, l]) => `<button data-cs="${m}" class="${m === span ? "on" : ""}">${l}</button>`).join("")}</div>`,
    peerHTML(span), capexHTML()];
  // 1) 메모리 3사 — 분기, 달러 (억원 ÷ (그 분기 평균 환율 × 10) = 십억 달러)
  const hy = lq("000660"), mu = lq("MU"), ds = cfg.samsung_ds || {}, kU = (v, k) => (v == null || !fx(k) ? null : v / (fx(k) * 10));
  const mk = keysOf(hy, mu, ds.rev);
  const mem = [
    { n: "SK하이닉스", rev: mk.map((k) => kU(hy[k]?.rev, k)), op: mk.map((k) => kU(hy[k]?.op, k)) },
    { n: "삼성전자 DS", rev: mk.map((k) => kU(ds.rev?.[k] != null ? ds.rev[k] * 1e4 : null, k)), op: mk.map((k) => kU(ds.op?.[k] != null ? ds.op[k] * 1e4 : null, k)) },
    { n: "마이크론", rev: mk.map((k) => (mu[k]?.rev != null ? mu[k].rev / 1e3 : null)), op: mk.map((k) => (mu[k]?.op != null ? mu[k].op / 1e3 : null)) },
  ].filter((x) => x.rev.some((v) => v != null));
  const S = (key, f = (x) => x[key]) => mem.map((x) => ({ n: x.n, v: f(x), col: CMP_COL[x.n] }));
  out.push(box("🧠 메모리 3사", "분기 · 달러(분기 평균 환율) · 삼성전자는 반도체(DS) 부문만",
    (mem.length ? lineChart({ t: "매출 ($B)", labels: mk, s: S("rev"), fl: usdB, zero: true, tick: (i) => shortQ(i, mk) })
      + lineChart({ t: "영업이익 ($B)", labels: mk, s: S("op"), fl: usdB, zero: true, tick: (i) => shortQ(i, mk) })
      + lineChart({ t: "영업이익률 (OPM)", labels: mk, s: S("opm", (x) => opmOf(x.rev, x.op)), fl: fPct, tick: (i) => shortQ(i, mk) }) : "") + mcapChart(D, span),
    (!ds.rev || !Object.keys(ds.rev).length ? wait("삼성전자 DS 부문") : "") + (Object.keys(mu).length < 12 ? wait("마이크론 10년 (SEC)") : "")));
  // 2) 낸드 — 회사가 따로 안 내서 증권가 추정 (블로그 그림에서 읽은 대략값)
  const NY = cfg.nand_y, NQ = cfg.nand_q;
  if (NY?.rev) {
    const ys = keysOf(...Object.values(NY.rev)), cs = Object.keys(NY.rev), yt = (i) => `'${String(ys[i]).slice(2)}`;
    const qk = keysOf(...Object.values(NQ?.rev || {})), qc = Object.keys(NQ?.rev || {});
    const ser = (src, ks, cs_, bar) => cs_.map((c) => ({ n: c, v: ks.map((k) => src[c]?.[k] ?? null), col: CMP_COL[c], bar }));
    const opmS = (src, ks, cs_) => cs_.map((c) => ({ n: c, v: ks.map((k) => (src.rev[c]?.[k] && src.op[c]?.[k] != null ? (src.op[c][k] / src.rev[c][k]) * 100 : null)), col: CMP_COL[c] }));
    out.push(box("💾 낸드 (NAND)", "조원 · 증권가 추정치",
      lineChart({ t: "연간 낸드 매출 (조원)", labels: ys, s: ser(NY.rev, ys, cs, true), fl: (v) => n(v, 0), tick: yt })
      + lineChart({ t: "연간 낸드 영업이익 (조원)", labels: ys, s: ser(NY.op, ys, cs, true), fl: (v) => n(v, 0), tick: yt })
      + lineChart({ t: "연간 낸드 영업이익률", labels: ys, s: opmS(NY, ys, cs), fl: fPct, tick: yt })
      + (qk.length ? lineChart({ t: "분기 낸드 매출 (조원)", labels: qk, s: ser(NQ.rev, qk, qc), fl: (v) => n(v, 0), zero: true, tick: (i) => shortQ(i, qk) })
        + lineChart({ t: "분기 낸드 영업이익 (조원)", labels: qk, s: ser(NQ.op, qk, qc), fl: (v) => n(v, 1), zero: true, tick: (i) => shortQ(i, qk) })
        + lineChart({ t: "분기 낸드 영업이익률", labels: qk, s: opmS(NQ, qk, qc), fl: fPct, tick: (i) => shortQ(i, qk) }) : ""),
      `<div class="note src">출처: ${esc(cfg.nand_src || "")}</div>`));
  }
  // 3) 빅테크 CapEx — 매출 대비 몇 %, 영업이익과 나란히
  const bt = (cfg.bigtech || []).map((c) => {
    const q = lq(c), ks = keysOf(q), capex = ks.map((k) => (q[k]?.capex != null ? q[k].capex / 1e3 : null)), rev = ks.map((k) => q[k]?.rev);
    if (capex.filter((v) => v != null).length < 3) return "";
    return lineChart({ t: `${cmpName(c)} CapEx · 매출 대비`, labels: ks, s: [{ n: "CapEx ($B)", v: capex, col: "var(--s1)", bar: true }, { n: "CapEx ÷ 매출", v: ks.map((k, i) => (rev[i] && capex[i] != null ? (capex[i] * 1e3 / rev[i]) * 100 : null)), col: "var(--warn)", right: true }], fl: usdB, fr: fPct, tick: (i) => shortQ(i, ks) })
      + lineChart({ t: `${cmpName(c)} CapEx vs 영업이익`, labels: ks, s: [{ n: "CapEx", v: capex, col: "var(--s1)" }, { n: "영업이익", v: ks.map((k) => (q[k]?.op != null ? q[k].op / 1e3 : null)), col: "var(--warn)" }], fl: usdB, zero: true, tick: (i) => shortQ(i, ks) });
  }).join("");
  out.push(box("🏗 회사별 CapEx 10년", "분기 · 달러 · 설비투자가 매출의 몇 %인지, 영업이익보다 빨리 느는지", bt, bt ? (Object.keys(lq("MSFT")).length < 12 ? wait("빅테크 10년 (SEC)") : "") : wait("빅테크 CapEx")));
  // 4) 클라우드 — AWS vs 구글 클라우드, 수주잔고(RPO)
  const aws = cfg.aws || {}, gc = cfg.gcloud || {}, rpo = cfg.rpo || {};
  const ck = keysOf(aws.rev, gc.rev), B = (o, k) => (o?.[k] != null ? o[k] / 1e3 : null);
  const ltm = (o, k) => { let s = 0, kk = k; for (let i = 0; i < 4; i++) { if (o?.[kk] == null) return null; s += o[kk]; kk = (+kk[3] === 1 ? `${String(+kk.slice(0, 2) - 1).padStart(2, "0")}.4Q` : `${kk.slice(0, 3)}${+kk[3] - 1}Q`); } return s; };
  let cl = cloudHTML(cfg);
  if (ck.length >= 3) {
    cl += lineChart({ t: "클라우드 매출 ($B) — 긴 흐름", labels: ck, s: CLOUDS.map(([k, nm], i) => ({ n: nm, v: ck.map((q) => B(cfg[k]?.rev, q)), col: KPI_COL[i] })), fl: usdB, zero: true, tick: (i) => shortQ(i, ck) })
      + lineChart({ t: "구글 클라우드 ÷ AWS 매출", labels: ck, s: [{ n: "비율", v: ck.map((k) => (aws.rev?.[k] && gc.rev?.[k] != null ? (gc.rev[k] / aws.rev[k]) * 100 : null)), col: "var(--s1)" }], fl: fPct, tick: (i) => shortQ(i, ck) })
      + lineChart({ t: "영업이익률 (OPM)", why: "애저·OCI 는 회사가 영업이익을 따로 안 줘요", labels: ck, s: [{ n: "AWS", v: ck.map((k) => (aws.rev?.[k] && aws.op?.[k] != null ? (aws.op[k] / aws.rev[k]) * 100 : null)), col: KPI_COL[0] }, { n: "구글 클라우드", v: ck.map((k) => (gc.rev?.[k] && gc.op?.[k] != null ? (gc.op[k] / gc.rev[k]) * 100 : null)), col: KPI_COL[2] }], fl: fPct, tick: (i) => shortQ(i, ck) });
  }
  const rc = Object.keys(rpo), rk = keysOf(...Object.values(rpo));
  if (rk.length >= 3) {
    const base = { AMZN: aws.rev, GOOG: gc.rev };  // 아마존은 AWS, 알파벳은 구글 클라우드 매출로 나눔 (잔고 대부분이 그 사업)
    const rev = (c) => base[c] || Object.fromEntries(Object.entries(lq(c)).map(([k, v]) => [k, v.rev]));
    cl += lineChart({ t: "수주잔고 RPO ($B)", why: "앞으로 매출이 될 계약 잔고", labels: rk, s: rc.map((c) => ({ n: cmpName(c), v: rk.map((k) => rpo[c]?.[k] ?? null), col: CMP_COL[c] })), fl: usdB, zero: true, tick: (i) => shortQ(i, rk) })
      + lineChart({ t: "RPO ÷ 최근 4분기 매출 (몇 년 치 일감)", why: "아마존 = AWS, 알파벳 = 구글 클라우드 매출로 나눔", labels: rk, s: rc.map((c) => ({ n: cmpName(c), v: rk.map((k) => { const l = ltm(rev(c), k); return l && rpo[c]?.[k] != null ? (rpo[c][k] * 1e3) / l : null; }), col: CMP_COL[c] })), fl: (v) => `${n(v, 1)}년`, tick: (i) => shortQ(i, rk) });
  }
  out.push(box("☁️ 클라우드", "분기 · 달러 · 회사 실적 보도자료", cl, cl ? "" : wait("AWS·구글 클라우드·수주잔고")));
  return out.join("") + `<div class="note src">${esc(D.updated_at || "")} 갱신 · 한국 = DART 분기보고서(최신 분기는 잠정실적), 미국 = SEC·야후 분기 재무제표 · 달러 환산 = 분기 평균 원/달러</div>`;
}
// ☁️ 4대 클라우드 (compare.yaml aws·azure·gcloud·oci, 백만 달러): 쌓은 막대(4곳 합) + 성장률 선(4곳 + 합계) — 비교 탭과 종목 상세(hi = 그 회사)
const CLOUDS = [["aws", "AWS", "AMZN"], ["azure", "애저", "MSFT"], ["gcloud", "구글 클라우드", "GOOG"], ["oci", "OCI", "ORCL"]];
function cloudHTML(cfg, hi) {
  const cs = CLOUDS.map(([k, nm, code], i) => ({ nm, code, col: KPI_COL[i], rev: cfg?.[k]?.rev || {}, est: cfg?.[k]?.est || [], yoy: cfg?.[k]?.yoy || {} }));
  const all = [...new Set(cs.flatMap((c) => Object.keys(c.rev)))].sort().filter((q) => cs.every((c) => c.rev[q] != null));
  const ks = all.slice(-9);
  if (ks.length < 2) return "";
  const yo = (o, q) => (o[qAgo(q)] ? (o[q] / o[qAgo(q)] - 1) * 100 : null), tot = Object.fromEntries(all.map((q) => [q, cs.reduce((a, c) => a + c.rev[q], 0)]));
  const last = ks.at(-1), ty = yo(tot, last), me = cs.find((c) => c.code === hi);
  const est = cs.filter((c) => c.est.some((q) => ks.includes(q))).map((c) => `${c.nm} ${c.est.filter((q) => ks.includes(q)).join("·")}`).join(" · ");
  let h = kpiStack({ t: "4대 클라우드 분기 매출 ($B)", u: "$B", s: cs.map((c) => ({ n: c.nm, v: Object.fromEntries(ks.map((q) => [q, c.rev[q] / 1e3])) })),
    tag: ty == null ? "" : ` <span class="qtag">${esc(last)} 합계 1년 전 대비 ${pct(ty, 0, true)}</span>`, why: "AWS·애저·구글 클라우드·OCI 를 쌓은 막대 — 위 숫자가 4곳 합계" })
    + lineChart({ t: "클라우드 매출 성장률 (YoY)", why: "4곳 모두 다시 빨라지는 중인지 · 검은 선 = 4곳 합계", labels: ks,
      s: [...cs.map((c) => ({ n: c.nm, v: ks.map((q) => c.yoy[q] ?? yo(c.rev, q)), col: c.col })), { n: "4곳 합계", v: ks.map((q) => yo(tot, q)), col: "var(--ink)" }], fl: fPct, tick: (i) => shortQ(i, ks) });
  if (me) {  // 종목 상세: 그 회사 클라우드 매출 막대 + 성장률 선 + 4곳 중 비중
    const mk = Object.keys(me.rev).sort().slice(-9);
    h = lineChart({ t: `${me.nm} 분기 매출 & 성장률`, labels: mk, s: [{ n: "매출 ($B)", v: mk.map((q) => me.rev[q] / 1e3), col: me.col, bar: true }, { n: "성장률 (YoY)", v: mk.map((q) => me.yoy[q] ?? yo(me.rev, q)), col: "var(--warn)", right: true }], fl: usdB, fr: fPct, tick: (i) => shortQ(i, mk) })
      + lineChart({ t: `4곳 합계 중 ${me.nm} 비중`, why: "점유율이 오르면 남보다 빨리 크는 중", labels: ks, s: [{ n: "비중", v: ks.map((q) => (me.rev[q] / tot[q]) * 100), col: me.col }], fl: fPct, tick: (i) => shortQ(i, ks) }) + h;
  }
  return h + `<div class="note src" style="grid-column:1/-1">추정 포함: ${esc(est || "없음")} · 애저는 25.3Q·26.3Q 만 회사 공시 금액(나머지는 회사 성장률로 거꾸로 계산) · OCI 는 오라클 6~8월 분기 = 3Q (증권사 그림은 9~11월을 3Q 로 써서 OCI 가 더 크게 보일 수 있어요)</div>`;
}
let CLOUD_CFG = null;
async function cloudBlock(code) {
  if (!CLOUDS.some((c) => c[2] === code)) return "";
  if (!CLOUD_CFG) { try { CLOUD_CFG = (await (await fetch("data/compare.json?t=" + encodeURIComponent(DASH.updated_at))).json())?.cfg || {}; } catch (_) { CLOUD_CFG = {}; } }
  const h = cloudHTML(CLOUD_CFG, code);
  return h ? `<h3>☁️ 클라우드 <span class="src">회사 실적 보도자료 · 분기 · 달러 · <a href="#compare">비교 탭에서 4곳 같이 보기 →</a></span></h3><div class="card"><div class="qgrid">${h}</div></div>` : "";
}
/* ---------- 실적발표(컨퍼런스콜) 요약: 분기 목록 → 누르면 자세한 요약, 맨 아래 '핵심만' (config/earnings.yaml) ---------- */
let EARNINGS = {}, IRCAL = { items: [] };
const IR_NOTE = { t: "노다지IR 컨콜공개 (전체 무료)", u: "https://contents.premium.naver.com/ystreet/irnote/contents" };  // 종목별 글은 earnings.yaml links 에
// 실적발표·컨퍼런스콜 일정 한 줄 (네이버 증권 IR 탭 / 미국은 야후)
function irWhen(e) {
  const d = new Date(e.when), dd = e.dday === 0 ? "오늘" : e.dday > 0 ? `D-${e.dday}` : `${-e.dday}일 전`;
  const t = e.time_unknown ? "" : ` ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `<b>${esc(e.when.slice(5, 10).replace("-", "/"))}${t}</b> <span class="pill ${e.dday === 0 ? "red" : e.dday > 0 && e.dday <= 7 ? "yellow" : ""}">${dd}</span>`;
}
function irCalHTML() {
  const items = (IRCAL.items || []).filter((e) => e.dday >= -2 && e.dday <= 30 && earnOk(e.code));
  if (!items.length) return "";
  const gl = { 보유: "", 관심: " ⭐", 공동: " 🤝" };
  return `<details class="card" open style="margin-bottom:12px"><summary class="chart-title"><b>📅 실적발표·컨퍼런스콜 일정</b> <span class="src">${EARN_GRP === "공동" ? "공동자산" : EARN_GRP} · 앞으로 30일 · 네이버 증권 IR / 야후 · ${esc(IRCAL.updated_at || "")}</span></summary>
    <ul class="irl">${items.map((e) => `<li>${irWhen(e)} <a href="#stock/${esc(e.code)}">${esc(e.name)}</a>${gl[e.group] || ""} · ${esc(e.title || "")}${e.live ? " · 🔴 라이브" : ""}${e.segc ? ` · <a href="#stock/${esc(e.code)}">🎯 ${esc(e.segc)} 부문 예상</a>` : ""}${e.url ? ` · <a href="${esc(e.url)}" target="_blank" rel="noopener">IR 보기</a>` : ""}${e.script_url ? ` · <a href="${esc(e.script_url)}" target="_blank" rel="noopener">📜 실시간 자막</a>` : ""}</li>`).join("")}</ul></details>`;
}
// 🐣 쉬운 요약 (최근 3일 실적발표 easy + config/events.yaml 공시·촉매·전망 변화) — 11/5 부터 🧾 실적 발표 목록 안에 날짜순으로 (kqNewsHTML)
let EVENTS = [];
// 🧾 일회성 점검 (earnings.yaml once): 발표 이익 → 한 번만 있는 이익(+)·비용(−) → 빼면 실질 — 예상 상회·하회가 일회성 때문인지
function onceHTML(o) {
  if (!o) return "";
  return `<div class="kidbox" style="background:var(--warn-bg)">🧾 <b>일회성 점검</b> <span class="src">발표 숫자에 한 번만 있는 이익·비용이 얼마나 섞였나</span>
    <div style="margin-top:4px">발표 <b>${esc(o.rep || "-")}</b>${o.cons ? ` <span class="src">(예상 ${esc(o.cons)})</span>` : ""}</div>
    ${(o.items || []).length ? `<ul class="irl">${o.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <div>→ 일회성 빼면 <b>${esc(o.core || "확인 못 함")}</b>${o.say ? ` — ${esc(o.say)}` : ""}</div></div>`;
}
function earningsHTML(code, inline = false) {  // inline = 요약이 아직 없어 '🧾 최신 분기 실적' 카드 안에 일정 한 줄만
  const list = EARNINGS[code] || [];
  const ev = (IRCAL.items || []).find((e) => e.code === code && e.dday >= -7);
  const next = ev ? `<div class="note">📅 ${irWhen(ev)} ${esc(ev.title || "")}${ev.live ? " · 🔴 라이브 컨퍼런스콜" : ""}${ev.url ? ` · <a href="${esc(ev.url)}" target="_blank" rel="noopener">IR 보기</a>` : ""}${ev.script_url ? ` · <a href="${esc(ev.script_url)}" target="_blank" rel="noopener">📜 실시간 자막</a>` : ""}</div>` : "";
  // 네이버 발표 자막이 있는 발표만 '스크립트'가 있음 — 없는 발표(11/6 삼양·롯데쇼핑·LIG)는 저녁·아침 매일 점검이 공시·IR 자료·기사로 요약
  const how = ev?.script_url ? "발표가 끝나면 예약 작업이 네이버 발표 자막(스크립트)을 읽고 요약해서" : "지금은 네이버 발표 자막(스크립트)이 없어요 — 생기면 예약 작업이 자막을 읽고, 끝내 없으면 저녁 7시대·아침 8시대에 잠정실적 공시·IR 자료·기사로 요약해서";
  if (!list.length && inline) return next ? `${next}<div class="note src">📞 ${how} 바로 아래 📋 칸과 요약에 넣어요.</div>` : "";
  if (!list.length) return next ? `<h3>📞 실적발표</h3><div class="card">${next}<div class="note src">📞 ${how} 여기에 넣어요.</div></div>` : "";
  // 맨 위(최신) 분기만 펼침 → 🧭 바뀐 것 → 그 전 분기들은 접어 둠 (past: true 는 핵심만 짧게)
  const full = (e, i) => `<details class="fvt"${i === 0 ? " open" : ""}><summary class="chart-title"><b>${esc(e.quarter)} 실적발표</b> <span class="src">${esc(e.date || "")} ${esc(e.source || "")}</span></summary>
      ${onceHTML(e.once)}
      ${(e.explain || []).map((x) => `<div class="card" style="margin-top:8px;border:1px solid var(--s1)"><b>🔍 ${esc(x.t)}</b> <span class="src">${esc(x.src || "")}</span>
        ${(x.steps || []).map((s) => `<div style="margin-top:6px"><b>${esc(s.h)}</b><ul class="irl">${(s.lines || []).map((t) => `<li${t.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(t)}</li>`).join("")}</ul></div>`).join("")}
        ${x.table ? `<div class="tbl-wrap"><table class="compact"><thead><tr>${x.table[0].map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${x.table.slice(1).map((r) => `<tr>${r.map((v, k) => `<td${k ? "" : ' style="text-align:left"'}>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
        ${x.kid ? `<div class="kidbox" style="margin-top:6px">🐣 ${esc(x.kid)}</div>` : ""}</div>`).join("")}
      ${i === 0 ? previewHTML(e.next) : ""}
      ${(e.easy || []).length ? `<div class="kidbox">🐣 <b>주린이를 위한 핵심 간단 요약</b><ul class="irl">${e.easy.map((x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${vsHTML(e)}
      ${(e.facts || []).length ? `<div class="card" style="margin-top:8px;background:var(--surface-2)"><b>🆕 뉴팩트</b> <span class="src">이번 발표에서 새로 나온 사실</span><ul class="irl facts">${e.facts.map((x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${callDiffHTML(e, e.diff_from || list[i + 1]?.quarter)}
      ${keysHTML(e)}
      ${e.transcript ? `<div class="note">📜 <a href="${esc(e.transcript)}" target="_blank" rel="noopener">발표 자막 원문 보기 (발표·질의응답 전체)</a></div>` : ""}
      ${i === 0 ? `<div class="note">📎 다른 곳 컨콜 정리: ${[...(e.links || []), IR_NOTE].map((l) => `<a href="${esc(l.u)}" target="_blank" rel="noopener">${esc(l.t)}</a>`).join(" · ")} <span class="src">(원문은 그곳에서 · 여기엔 우리 말로 짧게만)</span></div>` : ""}
      ${(e.short || []).length ? `<div class="warnbox" style="margin-top:6px"><b>⚡ 핵심만</b><ul class="irl">${e.short.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      <details class="fvt"><summary class="chart-title">📄 자세히 보기</summary><div class="note" style="white-space:pre-wrap;line-height:1.7">${esc(e.body || "")}</div></details>
    </details>`;
  // 👥 개인투자자 분위기 (earnings.yaml 맨 위 분기 crowd: {v 한 단어, lines}) — 자동 추정(시장 기대감) 옆에 사용자가 본 분위기
  const cr = list[0]?.crowd, crowd = cr ? `<div class="warnbox" style="margin-top:6px;background:var(--bad-bg);color:var(--bad-ink)">👥 <b>개인투자자 분위기: ${esc(cr.v || "")}</b> <span class="src">(사용자 판단 · ${esc(list[0].quarter)})</span>
    <ul class="irl">${(cr.lines || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  return `<h3>📞 실적발표 요약 <span class="src">${list.length}개 분기 · 맨 위만 펼쳐져 있어요</span></h3><div class="card">${next}${moodHTML(DASH.stocks.find((s) => s.code === code))}${crowd}
    ${full(list[0], 0)}
    ${trendHTML(list.find((e) => e.trend)?.trend)}
    ${list.slice(1).map((e, j) => (e.past ? pastCallHTML(e) : full(e, j + 1))).join("")}
  </div>`;
}
// 🧭 컨퍼런스콜마다 바뀐 것 (earnings.yaml 맨 위 분기의 trend): 태도 흐름 + 돈 쓰는 방향 — 지난 분기들(접힘) 바로 위에 펼쳐서
function trendHTML(t) {
  if (!t) return "";
  return `<div class="card" style="margin-top:8px;background:var(--surface-2)"><b>🧭 컨퍼런스콜마다 바뀐 것</b> <span class="src">${esc(t.span || "")} · 회사 태도와 돈 쓰는 방향</span>
    ${(t.lines || []).length ? `<ul class="irl">${t.lines.map((x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${(t.tone || []).length ? `<div class="tbl-wrap" style="margin-top:6px"><table class="compact"><thead><tr><th style="text-align:left">분기</th><th>태도</th><th style="text-align:left">왜</th></tr></thead><tbody>
      ${t.tone.map((x) => `<tr><td style="text-align:left"><b>${esc(x.q)}</b></td><td>${voiceTag(x.v)}</td><td style="text-align:left;white-space:normal;min-width:12em" class="src">${esc(x.why || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${(t.money || []).length ? `<div style="margin-top:6px"><b>💰 돈 쓰는 방향</b> <span class="src">주주환원·자사주·설비투자·M&A·증설</span><ul class="irl">${t.money.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}</div>`;
}
// 지난 분기 실적발표 (past: true) — 핵심만, 접어 둠
function pastCallHTML(e) {
  return `<details class="fvt"><summary class="chart-title"><b>${esc(e.quarter)} 실적발표</b> ${voiceTag(e.tone)} <span class="src">${esc(e.date || "")} ${esc(e.source || "")}</span></summary>
    ${e.tone_why ? `<div class="note src">태도: ${esc(e.tone_why)}</div>` : ""}
    ${(e.easy || []).length ? `<div class="kidbox">🐣 <b>핵심</b><ul class="irl">${e.easy.map((x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    ${(e.money || []).length ? `<div class="note"><b>💰 돈 쓰는 방향</b><ul class="irl">${e.money.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    ${(e.links || []).length ? `<div class="note src">📎 ${e.links.map((l) => `<a href="${esc(l.u)}" target="_blank" rel="noopener">${esc(l.t)}</a>`).join(" · ")}</div>` : ""}
  </details>`;
}
// 🔄 바로 이전 컨콜과 달라진 점 (diff) · 🎙 말투·뉘앙스 (voice) · 🙊 안 나온 것 (miss) · 📞 비공개 행사 (ndr) — earnings.yaml
const DIFF_T = { good: ["▲ 좋아짐", ""], bad: ["▼ 나빠짐", "bad"], same: ["= 그대로", "muted"], new: ["🆕 새로", "warn"], gone: ["🙊 말 안 함", "bad"], num: ["🔢 계산", "warn"] };
const VOICE_T = { 확신: ["💪 확신", ""], 보수: ["🛡 보수적", "muted"], 조건부: ["🤔 조건부", "warn"], 애매: ["🌫 애매", "warn"], 회피: ["🙈 피함", "bad"], 미룸: ["⏳ 나중에", "warn"] };
const voiceTag = (k) => { if (!k) return ""; const [t, c] = VOICE_T[k] || [k, "warn"]; return `<span class="qtag ${c}" style="white-space:nowrap">${esc(t)}</span>`; };
function callDiffHTML(e, prevQ) {
  const tag = (m, k) => { const [t, c] = m[k] || [k || "", "warn"]; return `<span class="qtag ${c}" style="white-space:nowrap">${esc(t)}</span>`; };
  const out = [];
  if ((e.diff || []).length) out.push(`<div class="card" style="margin-top:8px;background:var(--surface-2)"><b>🔄 바로 이전 컨콜과 달라진 점</b> <span class="src">${esc(prevQ || "지난 콜")} → ${esc(e.quarter)} · 같은 질문에 숫자·말이 어떻게 바뀌었나</span>
    <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">항목</th><th style="text-align:left">${esc(prevQ || "지난 콜")}</th><th style="text-align:left">${esc(e.quarter)}</th><th></th></tr></thead><tbody>
    ${e.diff.map((x) => `<tr><td style="text-align:left"><b>${esc(x.k)}</b></td><td style="text-align:left;white-space:normal;min-width:9em" class="src">${esc(x.b || "-")}</td>
      <td style="text-align:left;white-space:normal;min-width:11em">${esc(x.a || "-")}${x.note ? `<div class="src">${esc(x.note)}</div>` : ""}</td><td>${tag(DIFF_T, x.t)}</td></tr>`).join("")}</tbody></table></div></div>`);
  if ((e.voice || []).length) out.push(`<div class="card" style="margin-top:8px;background:var(--surface-2)"><b>🎙 말투·뉘앙스</b> <span class="src">확신 있게 말했나, 조건을 달았나, 흐렸나, 피했나 (자막 원문 기준)</span>
    ${e.voice.map((x) => `<div style="margin-top:6px">${tag(VOICE_T, x.v)} <b>${esc(x.k)}</b>${x.q ? ` <span class="src">“${esc(x.q)}”</span>` : ""}${x.note ? `<div class="src" style="margin-left:18px">→ ${esc(x.note)}</div>` : ""}</div>`).join("")}</div>`);
  // 💬 질의응답 (사용자 2026-11-02, 주식봇 방식에서 배움): Q번호 · 질문 (증권사) → 답 한 줄 + 우리 말투 표시 — 질문이 어디에 몰렸나 = 시장의 걱정거리
  if ((e.qa || []).length) out.push(`<div class="card" style="margin-top:8px;background:var(--surface-2)"><b>💬 질의응답 ${e.qa.length}개</b> <span class="src">애널리스트가 물은 것 → 회사 답 · 꼬리표 = 답할 때 말투${e.qa_u ? ` · <a href="${esc(e.qa_u)}" target="_blank" rel="noopener">주식봇 요약·전문</a>` : ""}</span>
    ${e.qa.map((x, i) => `<div style="margin-top:6px"><b>Q${i + 1}. ${esc(x.q)}</b>${x.f ? ` <span class="src">(${esc(x.f)})</span>` : ""} ${voiceTag(x.v)}<div style="margin-left:18px">→ ${esc(x.a)}</div></div>`).join("")}</div>`);
  if ((e.miss || []).length) out.push(`<div class="warnbox" style="margin-top:8px"><b>🙊 이번 콜에서 안 나온 것</b> <span class="src">질문도 회사 설명도 없었던 것 — 빠진 말도 신호예요</span><ul class="irl">${e.miss.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`);
  if ((e.ndr || []).length) out.push(`<div class="card" style="margin-top:8px;border:1px dashed var(--axis)"><b>📞 비공개 행사 (NDR·그룹콜)</b> <span class="src">원문이 공개되지 않아 기사·리포트로 알려진 것만</span>
    ${e.ndr.map((x) => `<div style="margin-top:6px"><span class="qtag">${esc(x.d || "")}</span> <b>${esc(x.t)}</b>${(x.lines || []).map((l) => `<div class="src" style="margin-left:18px">· ${esc(l)}</div>`).join("")}${x.after ? `<div style="margin-left:18px">📉 그 뒤 주가: ${esc(x.after)}</div>` : ""}${(x.u || []).length ? `<div class="src" style="margin-left:18px">출처: ${x.u.map((s) => `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>`).join(" · ")}</div>` : ""}</div>`).join("")}</div>`);
  return out.join("");
}
// 🌡 시장 기대감 (자동 · 참고용): 기대가 높으면 좋은 실적에도 '기대 미달'로 빠질 수 있어요 (예: 아마존 3Q26)
// 3가지 신호를 +1(기대 높임) / 0 / -1(기대 낮춤)로 더함: 최근 3개월 주가 · PER 10년 밴드 위치 · 내년 EPS 예상치 90일 변화
function moodHTML(c) {
  if (!c) return "";
  const cl = (c.chart?.close || []).filter((v) => v != null), r3 = cl.length > 64 ? (cl.at(-1) / cl.at(-64) - 1) * 100 : null;
  const bp = c.band_pos, rv = c.tbl?.eps_rev90;
  const sig = [
    r3 == null ? null : [r3 >= 15 ? 1 : r3 <= -10 ? -1 : 0, `최근 3개월 주가 ${pct(r3, 0, true)}`],
    bp == null ? null : [bp >= 80 ? 1 : bp <= 20 ? -1 : 0, `PER 10년 밴드 ${n(bp, 0)}% 위치${bp >= 80 ? " (비싼 편)" : bp <= 20 ? " (싼 편)" : ""}`],
    rv == null ? null : [rv >= 5 ? 1 : rv <= -5 ? -1 : 0, `증권사가 본 내년 이익(EPS)이 3달 전보다 ${n(Math.abs(rv), 1)}% ${rv >= 0 ? "올라감" : "내려감"}`],  // 사용자 11/5: '90일 새 -4.4%' 가 무슨 말인지 모르겠다
  ].filter(Boolean);
  if (!sig.length) return "";
  const s = sig.reduce((a, [v]) => a + v, 0), t = s >= 2 ? "🔥 높음" : s <= -2 ? "🧊 낮음" : "🙂 보통";
  return `<div class="note">🌡 <b>시장 기대감 ${t}</b> <span class="src">(자동 추정 · 참고용)</span> ${sig.map(([v, x]) => `<span class="qtag">${v > 0 ? "▲" : v < 0 ? "▼" : "·"} ${esc(x)}</span>`).join(" ")}
    <div class="src">기대가 높으면(주가가 이미 많이 오름 · 비싼 편 · 예상치가 빠르게 오름) 좋은 실적에도 ‘기대 미달’로 빠질 수 있고, 낮으면 무난한 실적에도 오를 수 있어요.</div></div>`;
}
// 🔮 다음 분기 부문별 추정 (earnings.yaml 최신 분기의 next) — 내가 세운 추정과 근거, 발표 뒤 맞았는지 확인용 (추천 아님)
function previewHTML(x) {
  if (!x) return "";
  return `<div class="card" style="margin-top:8px;border:1px dashed var(--axis)"><b>🔮 ${esc(x.q || "다음 분기")} 부문별 추정</b> <span class="src">Claude 추정 · 근거를 보고 직접 검증해 보세요 (회사 가이던스·지난 흐름 기준, 추천 아님)</span>
    ${x.mood ? `<div style="margin-top:4px">🌡 발표 전 기대감: <b>${esc(x.mood)}</b>${x.mood_why ? ` <span class="src">— ${esc(x.mood_why)}</span>` : ""}</div>` : ""}
    <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">부문</th><th>매출</th><th>영업이익</th><th style="text-align:left">근거</th></tr></thead><tbody>
      ${(x.segs || []).map((r) => `<tr><td style="text-align:left"><b>${esc(r.n)}</b></td><td>${esc(r.rev || "-")}</td><td>${esc(r.op || "-")}</td><td style="text-align:left;white-space:normal;min-width:14em" class="src">${esc(r.why || "")}</td></tr>`).join("")}
    </tbody></table></div>
    ${(x.check || []).length ? `<div style="margin-top:6px"><b>✅ 발표 때 확인할 것</b><ul class="irl">${x.check.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}</div>`;
}
// 📋 실적 vs 예상(컨센서스) · 가이던스 · 발표 뒤 주가 — earnings.yaml vs / guide / after (u 단위: "$B"·"$"·"%"·"조", n 많고 적음이 좋고 나쁨이 아닌 항목, b 판정 직접)
function vsHTML(e) {
  if (!(e.vs || []).length && !(e.guide || []).length && !e.after && !(e.guide_note || []).length) return "";
  const F = (v, u) => (v == null || v === "" ? "-" : typeof v === "string" ? esc(v)
    : (u?.startsWith("$") ? "$" : "") + Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + (u?.startsWith("$") ? u.slice(1) : u || ""));
  const TAG = { 상회: '<span class="qtag">상회</span>', 하회: '<span class="qtag bad">하회</span>' };
  const row = (x) => {
    const num = typeof x.a === "number" && typeof x.e === "number" && x.e !== 0;
    const diff = !num ? "" : x.u === "%" ? `${x.a - x.e >= 0 ? "+" : ""}${(x.a - x.e).toFixed(1)}%p` : pct((x.a / x.e - 1) * 100, 1, true);
    const tag = x.b ? TAG[x.b] || `<span class="src">${esc(x.b)}</span>` : !num ? ""
      : x.n ? `<span class="src">${x.a > x.e ? "예상보다 많음" : "예상보다 적음"}</span>` : TAG[x.a >= x.e ? "상회" : "하회"];
    return `<tr><td style="text-align:left">${esc(x.k)}</td><td><b>${F(x.a, x.u)}</b></td><td>${F(x.e, x.u)}</td><td>${diff}</td><td>${tag}</td></tr>`;
  };
  const tbl = (rows, ah) => (rows || []).length ? `<div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">항목</th><th>${ah}</th><th>예상</th><th>차이</th><th></th></tr></thead><tbody>${rows.map(row).join("")}</tbody></table></div>` : "";
  const up = /^\+/.test(e.after || "");
  return `<div class="card" style="margin-top:8px"><b>📋 실적 vs 예상</b>${e.after ? ` <span class="qtag ${up ? "" : "bad"}">발표 뒤 주가 ${esc(e.after)}</span>` : ""}
    ${tbl(e.vs, "실적")}${(e.guide || []).length ? `<div style="margin-top:6px"><b>🧭 가이던스</b> <span class="src">회사가 내놓은 앞으로 전망</span></div>${tbl(e.guide, "회사 전망")}` : ""}
    ${(e.guide_note || []).length ? `<div class="note" style="margin-top:6px">💬 <b>가이던스 읽는 법</b><ul class="irl">${e.guide_note.map((t) => `<li${t.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(t)}</li>`).join("")}</ul></div>` : ""}</div>`;
}
function preLoad(code) { try { return JSON.parse(localStorage.getItem("pre:" + code) || "{}"); } catch (_) { return {}; } }
function preSave(code, v) { try { localStorage.setItem("pre:" + code, JSON.stringify(v)); } catch (_) {} }
function precheckHTML(d) {
  const c = d.card, a = preLoad(c.code), p = c.pre || {}, s = smData(c), prof = PROFILES[c.code];
  const field = ([k, q, t]) => {
    const v = a[k] ?? "";
    let input;
    if (t === "text") input = `<textarea data-k="${k}" rows="2" placeholder="메모">${esc(v)}</textarea>`;
    else if (t === "ox") input = `<div class="oxs" data-k="${k}">${["O", "△", "X"].map((x) => `<button data-v="${x}" class="${v === x ? "on" : ""}">${x}</button>`).join("")}</div>`;
    else if (t.startsWith("sel:")) input = `<select data-k="${k}" class="sel"><option value="">선택</option>${t.slice(4).split("|").map((x) => `<option ${v === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
    else input = `<div class="chks" data-k="${k}">${t.slice(4).split("|").map((x) => `<label><input type="checkbox" value="${esc(x)}" ${(v || []).includes(x) ? "checked" : ""}> ${esc(x)}</label>`).join("")}</div>`;
    // 자동 힌트
    let hint = "";
    if (k === "china" && prof?.revenue_geo) { const cn = prof.revenue_geo.items.find((x) => /중국|China|홍콩|대만/.test(x.name)); if (cn) hint = `매출 중 ${esc(cn.name)} ${n(cn.pct, 0)}%`; }
    if (k === "leader" && c.mdd) hint = `사상 최고가 대비 ${pct(c.mdd.dd, 0)} · 10년 밴드 ${c.band_pos == null ? "-" : n(c.band_pos, 0) + "%"} 위치`;
    if (k === "earn") { const e = nextEvent(s); if (e) hint = `다음 이벤트: ${esc(e.date)} ${esc(e.what)}`; }
    if (k === "target" && c.scen) hint = `Base ${money(c.scen.base, c.currency)} · Bull ${money(c.scen.bull, c.currency)}${c.us_tpl?.tipranks ? ` · TipRanks 평균 $${n(c.us_tpl.tipranks.avg, 0)}` : ""}`;
    if (k === "narrative") hint = "셋 다 맞아야 진짜 내러티브 (예: AI는 셋 다, 코로나 때 나이키는 셋 다 놓침) · 한 테마에 80%를 둬도 20~30%는 다음 테마를 찾아보기";
    if (k === "why" && prof?.one_liner) hint = `참고(조사): ${esc(prof.one_liner)}`;
    return `<div class="preq"><div class="preq-q">${esc(q)}</div>${hint ? `<div class="note src">💡 ${hint}</div>` : ""}${input}</div>`;
  };
  const auto = [];
  if (p.equity) auto.push(`${badge(p.equity.down_years.length ? "△" : "O")} 자본총계(BPS) ${p.equity.from}~${p.equity.to}년 연평균 ${pct(p.equity.cagr, 1, true)}${p.equity.down_years.length ? ` · 줄어든 해 ${p.equity.down_years.join(", ")}` : " · 매년 늘었음"}`);
  if (p.peak) auto.push(`${badge(p.peak.flag ? "△" : "O")} 이익 피크아웃 신호: EPS 성장 ${p.peak.y[0]}→${p.peak.y[1]} ${pct(p.peak.g1, 0, true)}, ${p.peak.y[1]}→${p.peak.y[2]} ${pct(p.peak.g2, 0, true)}${p.peak.flag ? " (성장이 크게 꺾임)" : ""}`);
  if (p.dilution) auto.push(`${badge(p.dilution.length ? "X" : "O")} 최근 1년 주식 수 늘리는 공시(유상증자·CB·BW): ${p.dilution.length ? p.dilution.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.date)} ${esc(x.name)}</a>`).join(", ") : "없음"}`);
  if (c.mdd) auto.push(`${badge(c.mdd.dd > -5 ? "△" : "O")} 전고점: ${c.mdd.dd > -5 ? "사상 최고가 근처 (돌파 시도 구간)" : `사상 최고가보다 ${pct(c.mdd.dd, 0)} 아래`}`);
  const filled = PRE_Q.flatMap((g) => g[1]).filter(([k]) => a[k] && (a[k].length ?? 1)).length;
  const total = PRE_Q.flatMap((g) => g[1]).length;
  return `<h3>✅ 매수 전 최종 점검 <span class="src">${filled} / ${total} 작성</span></h3><div class="card" id="precheck" data-code="${esc(c.code)}">
    <div class="note src">내 엑셀 '기업분석 3단계 Q&A'·재파 체크리스트에서 다른 체크리스트(점수·프로필·소몽)와 겹치는 건 빼고 남긴 질문이에요. 적은 답은 <b>이 휴대폰(브라우저)에만</b> 저장돼요.</div>
    ${auto.length ? `<div class="chart-title" style="margin-top:10px"><b>자동 확인</b></div>${auto.map((x) => `<div class="note">${x}</div>`).join("")}` : ""}
    ${PRE_Q.map(([g, qs]) => `<div class="chart-title" style="margin-top:12px"><b>${g}</b></div>${qs.map(field).join("")}`).join("")}
  </div>`;
}
function wirePrecheck() {
  const box = $("#precheck");
  if (!box) return;
  const code = box.dataset.code;
  const save = () => {
    const v = {};
    box.querySelectorAll("textarea, select").forEach((x) => { if (x.value) v[x.dataset.k] = x.value; });
    box.querySelectorAll(".oxs").forEach((x) => { const on = x.querySelector("button.on"); if (on) v[x.dataset.k] = on.dataset.v; });
    box.querySelectorAll(".chks").forEach((x) => { const c = [...x.querySelectorAll("input:checked")].map((i) => i.value); if (c.length) v[x.dataset.k] = c; });
    preSave(code, v);
  };
  box.addEventListener("input", save);
  box.addEventListener("change", save);
  box.addEventListener("click", (e) => {
    const b = e.target.closest(".oxs button"); if (!b) return;
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b && !x.classList.contains("on")));
    save();
  });
}

/* ---------- 점수 체크리스트 탭 ---------- */
let SCORE_MKT = "전체";
function scoreColor(v) { return v == null ? "na" : v >= 80 ? "green" : v >= 60 ? "yellow" : "red"; }
function renderScore() {
  if (!DASH) return;
  const mk = ["전체", "한국", "미국"];
  $("#scoreMkt").innerHTML = mk.map((x) => `<button data-m="${x}" class="chip ${x === SCORE_MKT ? "on" : ""}">${x}</button>`).join("");
  const list = DASH.stocks.filter((c) => c.score && (SCORE_MKT === "전체" || (SCORE_MKT === "미국") === (c.market === "US")))
    .sort((a, b) => (b.score.total ?? -1) - (a.score.total ?? -1));
  $("#scoreCards").innerHTML = list.map((c) => {
    const s = c.score;
    const bars = s.sections.map((x) => `<div class="sbar"><span>${esc(x.name.replace(" (직접 입력)", ""))}</span><i><b style="width:${x.max ? (x.got / x.max) * 100 : 0}%"></b></i>
      <em>${x.max ? `${x.got}/${x.max}` : "입력 전"}</em></div>`).join("");
    const detail = s.sections.map((x) => `<div class="chart-title" style="margin-top:10px"><b>${esc(x.name)}</b> <span class="src">${x.max ? `${x.got} / ${x.max}점` : "점수 없음"}</span></div>
      <table class="compact" style="width:100%"><tbody>${x.rows.map((r) => `<tr><td>${esc(r.item)}<br><span class="src">${esc(r.why || "")}</span></td>
        <td style="text-align:right;font-weight:700">${r.pt == null ? '<span class="src">-</span>' : r.pt + "점"}</td></tr>`).join("")}</tbody></table>`).join("");
    return `<div class="card score-card">
      <div class="row1" style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span style="font-weight:700;font-size:17px">${esc(c.name)} <span class="src">${esc(c.industry || "")}</span></span>
        <span class="verdict ${scoreColor(s.total)}" style="font-size:26px">${s.total == null ? "N/A" : n(s.total, 0)}<span class="src" style="font-size:12px"> / 100</span></span></div>
      <div class="sub">${s.got} / ${s.max}점 · ${s.manual ? "직접 입력 항목 포함" : "자동 계산 항목만 (비즈니스 모델 등은 checklist.yaml 에 입력하면 더해져요)"}</div>
      ${bars}
      ${s.memo ? `<div class="memo">📝 ${esc(s.memo)}</div>` : ""}
      <details class="fvt"><summary class="chart-title" style="margin-top:8px">항목별 점수 보기</summary>${detail}
        <div class="note src">각 항목 10점 만점 · 기준: PER·PBR 은 지금 배수 ÷ 그 종목의 과거 평균, PEG 는 1 아래가 좋음(린치), 부채비율 50% 이하 10점 ~ 400% 넘으면 1점, 유동비율 200% 이상 10점 등 · 재무제표는 야후 연간 실적</div></details>
      <div class="note"><a href="#stock/${esc(c.code)}">상세 화면 →</a></div>
    </div>`;
  }).join("") || `<div class="empty">점수 데이터가 아직 없어요 (다음 갱신 후 나와요).</div>`;
}
$("#scoreMkt")?.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; SCORE_MKT = b.dataset.m; renderScore(); });

/* ---------- 3. 종목 상세 ---------- */
const PERIODS = [["all", "역사적"], ["10y", "10년"], ["5y", "5년"]];

function bandBlock(id, band, kind) {
  const tabs = PERIODS.filter(([k]) => band.periods[k]).map(([k, l], i) => `<button data-p="${k}" class="${i === 1 || (i === 0 && !band.periods["10y"]) ? "on" : ""}">${l}</button>`).join("");
  return `<div class="seg" id="${id}-seg">${tabs}</div>
    <div class="chart-box tall"><canvas id="${id}"></canvas></div>
    <div id="${id}-legend"></div><div class="note" id="${id}-stats"></div>`;
}
function drawBand(id, band, kind, period) {
  const C = themeColors();
  const st = band.periods[period] || band.periods.all;
  const i0 = period === "all" ? 0 : band.dates.findIndex((d) => d >= st.from);
  const dates = band.dates.slice(i0);
  const unit = kind === "DIV" ? "%" : "배";
  let ds;
  let fmt = (v) => n(v) + "원";
  let yfmt = (v) => (v >= 10000 ? n(v / 10000, 0) + "만" : n(v));
  if (kind === "DIV") {
    const y = band.mult.slice(i0);
    ds = [
      { label: "배당수익률", data: y, borderColor: C.s1 },
      { label: `상단 ${n(st.high, 2)}%`, data: y.map(() => st.high), borderColor: C.s4, borderDash: [6, 4] },
      { label: `평균 ${n(st.avg, 2)}%`, data: y.map(() => st.avg), borderColor: C.s2, borderDash: [6, 4] },
      { label: `하단 ${n(st.low, 2)}%`, data: y.map(() => st.low), borderColor: C.s3, borderDash: [6, 4] },
    ];
    fmt = (v) => n(v, 2) + "%"; yfmt = (v) => v.toFixed(1) + "%";
  } else {
    const base = band.base.slice(i0);
    ds = [
      { label: "수정주가", data: band.price.slice(i0), borderColor: C.s1 },
      { label: `상단 ${n(st.high, 2)}${unit}`, data: base.map((b) => b * st.high), borderColor: C.s4, borderDash: [6, 4] },
      { label: `평균 ${n(st.avg, 2)}${unit}`, data: base.map((b) => b * st.avg), borderColor: C.s2, borderDash: [6, 4] },
      { label: `하단 ${n(st.low, 2)}${unit}`, data: base.map((b) => b * st.low), borderColor: C.s3, borderDash: [6, 4] },
    ];
  }
  makeChart(document.getElementById(id), dates, ds, { fmt, yfmt });
  $(`#${id}-legend`).innerHTML = legend(ds.map((d) => [d.label, d.borderColor, !!d.borderDash]));
  const cur = band.mult[band.mult.length - 1];
  const nm = kind === "DIV" ? "배당수익률" : kind;
  $(`#${id}-stats`).innerHTML =
    `현재 ${nm} <b>${n(cur, 2)}${unit}</b> · 평균 ${n(st.avg, 2)}${unit} · 하단 ${n(st.low, 2)} · 상단 ${n(st.high, 2)} (최저 ${n(st.min, 2)} / 최고 ${n(st.max, 2)}) · 밴드 위치 <b>${n(st.pos, 0)}%</b>
    <br><span class="src">기간 ${esc(st.from)} ~ · 주간 종가 기준 · ${band.basis !== "forward" ? "직전 연도 확정 실적 사용" : kind === "PBR" ? "<b>그해 BPS</b>: 각 시점의 그해 BPS(올해는 추정치)로 계산 · BPS 가 빨리 늘 때 PBR 이 부풀지 않게" : "<b>선행 PER</b>: 각 시점의 1년 뒤 실적(최근은 추정치)으로 계산"} · 하단/상단 = 하위 ${DASH.settings.band.low_pct}% / 상위 ${100 - DASH.settings.band.high_pct}% 지점</span>`;
}
function wireBand(id, band, kind) {
  const seg = document.getElementById(`${id}-seg`);
  const first = seg.querySelector("button.on") || seg.querySelector("button");
  drawBand(id, band, kind, first.dataset.p);
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    drawBand(id, band, kind, b.dataset.p);
  });
}
function matrixTable(rows, cols, price, rowHead, what, cur) {
  const near = (v) => v && Math.abs(v / price - 1) < 0.05;
  return `<div class="tbl-wrap"><table><thead><tr><th>${esc(rowHead)}</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.label)} <span class="src">${r.mult == null ? "" : n(r.mult, 2) + "배"}</span></td>${cols.map((c) => {
      const v = r.cells[c];
      if (v == null) return "<td>N/A</td>";
      const up = (v / price - 1) * 100;
      return `<td class="${up >= 0 ? "cheap" : "dear"} ${near(v) ? "near" : ""}">${n(v)}<br><span class="src">${pct(up, 0, true)}</span></td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="note">칸 아래 %는 ${what ? `현재 ${what} ${n(price, 2)}` : `현재가 ${money(price, cur)}`} 대비 차이 (초록 = 지금보다 높음, 빨강 = 낮음). 파란 테두리 = 지금과 5% 이내.</div>`;
}

/* ---------- 네이버 증권식 PER·PBR 밴드차트 ----------
   선 = 그 달의 EPS(BPS) × 배수 4개. Y년 실적(추정치 포함)은 Y년 12월 말에 놓고 달마다 직선으로 이어
   네이버(와이즈리포트)와 같은 값이 나온다 (기아 2028/06/30 = 27E·28E 를 6:6 으로 섞은 값으로 확인).
   미래는 마지막 추정 연도의 9월 30일까지 (네이버와 같음). 배수 = 보는 기간 배수의 하위 10% ~ 상위 10% 를 4등분. */
// 밴드 선 색: 눈이 덜 아프게 너무 밝은 연두·주황 대신 차분하고 서로 잘 구분되는 색 (아래 배수 → 위 배수) · 12MF PER 밴드도 같은 색
const BAND_COL = ["#7b8494", "#2e8b57", "#c98a12", "#c0392b", "#7d5ba6"];
const NV_COLORS = BAND_COL.slice(1);
const NV_STYLES = [["rectRot", 0], ["rect", 0], ["triangle", 0], ["triangle", 180]];
const NV_PERIODS = [["5", "5년"], ["10", "10년"], ["all", "최대"]];
const DAY = 86400000;
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "/");
function nvSeries(d, key, period) {
  const band = d.bands.PER || d.bands.PBR || d.bands.DIV;
  if (!band) return null;
  const anchors = d.history.filter((r) => r[key] > 0).map((r) => [Date.UTC(r.year, 11, 31), r[key]]).sort((a, b) => a[0] - b[0]);
  if (anchors.length < 2) return null;
  const at = (t) => {
    for (let i = 1; i < anchors.length; i++) {
      const [t0, v0] = anchors[i - 1], [t1, v1] = anchors[i];
      if (t >= t0 && t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
    return null;
  };
  const px = band.dates.map((s, i) => [Date.parse(s), band.price[i]]);
  const last = px[px.length - 1][0];
  const L = new Date(last);
  const first = Math.max(px[0][0], anchors[0][0]);
  const start = period === "all" ? first : Math.max(first, Date.UTC(L.getUTCFullYear() - +period, L.getUTCMonth(), 1));
  const end = Date.UTC(new Date(anchors[anchors.length - 1][0]).getUTCFullYear(), 8, 30);
  // 월말 날짜 격자: 과거는 그달 마지막 주 종가, 이번 달은 최근 종가, 미래는 선만
  const months = [];
  const S = new Date(start);
  for (let m = S.getUTCMonth(); ; m++) {
    const t = Date.UTC(S.getUTCFullYear(), m + 1, 0);
    if (t > end) break;
    months.push(t);
  }
  let j = 0, v = null;
  const price = months.map((t) => {
    while (j < px.length && px[j][0] <= t) v = px[j++][1];
    return t - last > 31 * DAY ? null : t > last ? px[px.length - 1][1] : v;
  });
  // 배수: 보는 기간(과거) 주간 배수의 하위 10% ~ 상위 10%
  const ms = px.filter(([t]) => t >= start).map(([t, p]) => { const b = at(t); return b ? p / b : null; })
    .filter((x) => x > 0 && (key !== "eps" || x <= (DASH.settings.band.per_cap || 1e9))).sort((a, b) => a - b);
  if (ms.length < 20) return null;
  const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  const lo = q(DASH.settings.band.low_pct / 100), hi = q(DASH.settings.band.high_pct / 100);
  const dg = key === "bps" && hi < 3 ? 2 : 1;
  const mults = [0, 1, 2, 3].map((i) => Number((lo + ((hi - lo) * i) / 3).toFixed(dg)));
  const curB = at(last);
  const years = (end - start) / (365 * DAY);
  return { labels: months.map(ymd), price, base: months.map(at), mults, dg, cur: curB ? px[px.length - 1][1] / curB : null, lo, hi,
    from: ymd(start), tickStep: Math.max(1, Math.ceil(years / 3.5)) };
}
function nvBlock(id, title) {
  return `<div class="nv"><div class="nv-t">${title}</div><div class="chart-box nvbox"><canvas id="${id}"></canvas></div><div class="note" id="${id}-note"></div></div>`;
}
// px = 이름 앞 구분자 (종목 상세는 "", 카드 안 ② 칸은 종목마다 다르게) · tag = 카드(button) 안에서는 span 탭
const segTabs = (id, items, on, tag = "button") => `<div class="seg pseg" id="${id}">${items.map(([k, l]) => `<${tag} data-p="${k}" class="${k === on ? "on" : ""}">${l}</${tag}>`).join("")}</div>`;
function segWire(sel, fn) {
  const s = $(sel);
  if (!s) return;
  s.addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    e.stopPropagation();
    s.querySelectorAll("[data-p]").forEach((x) => x.classList.toggle("on", x === b));
    fn(b.dataset.p);
  });
}
const nvCross = { id: "nvCross", afterDatasetsDraw(ch) {
  const a = ch.tooltip?.getActiveElements?.() || [];
  if (!a.length) return;
  const x = a[0].element.x, { top, bottom } = ch.chartArea, g = ch.ctx;
  g.save(); g.strokeStyle = css("--muted"); g.lineWidth = 1; g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); g.restore();
} };
function drawNv(id, d, key, kind, period) {
  const s = nvSeries(d, key, period), cv = document.getElementById(id);
  if (!cv) return;
  if (!s) { cv.parentElement.outerHTML = `<div class="empty">밴드를 그릴 실적 자료가 부족해요.</div>`; return; }
  const C = themeColors(), usd = d.currency === "USD";
  const fmt = (v) => (usd ? "$" + n(v, 2) : n(v) + " 원");
  const ds = s.mults.map((m, i) => ({ label: `${n(m, s.dg)}배`, data: s.base.map((b) => (b ? Math.round(b * m * (usd ? 100 : 1)) / (usd ? 100 : 1) : null)),
    borderColor: NV_COLORS[i], backgroundColor: NV_COLORS[i], borderWidth: 2.4, pointStyle: NV_STYLES[i][0], pointRotation: NV_STYLES[i][1], pointHoverRadius: 7 }));
  ds.push({ label: "수정주가", data: s.price, borderColor: C.s1, backgroundColor: C.s1, borderWidth: 3.5, pointStyle: "circle", pointHoverRadius: 7 });
  if (charts.has(id)) charts.get(id).destroy();
  charts.set(id, new Chart(cv, {
    type: "line", data: { labels: s.labels, datasets: ds }, plugins: [nvCross],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      elements: { point: { radius: 0, hitRadius: 6 }, line: { tension: 0 } },
      plugins: {
        legend: { position: "bottom", labels: { color: C.ink, boxWidth: 16, boxHeight: 4, padding: 10, font: { size: 13 },
          generateLabels: (ch) => ch.data.datasets.map((x, i) => ({ text: x.label, fillStyle: ch.isDatasetVisible(i) ? x.borderColor : C.grid,
            strokeStyle: "transparent", lineWidth: 0, hidden: false, fontColor: ch.isDatasetVisible(i) ? C.ink : C.muted, datasetIndex: i })) } },
        tooltip: { backgroundColor: C.surface, titleColor: C.ink, bodyColor: C.ink, borderColor: C.grid, borderWidth: 1, padding: 10,
          displayColors: false, titleFont: { size: 14, weight: "normal" }, bodyFont: { size: 14 },
          filter: (it) => it.parsed.y != null,
          callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)}`, labelTextColor: (c) => c.dataset.borderColor } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: C.axis || C.grid },
          ticks: { color: C.muted, autoSkip: false, maxRotation: 0, font: { size: 12 },
            callback(v) { const l = this.getLabelForValue(v); return l.slice(5, 7) === "01" && +l.slice(0, 4) % s.tickStep === 0 ? l.slice(0, 7) + "/01" : ""; } } },
        y: { beginAtZero: true, grid: { color: C.grid }, border: { display: false },
          ticks: { color: C.muted, maxTicksLimit: 4, font: { size: 12 }, callback: (v) => (usd ? "$" + n(v) : n(v)) } },
      },
    },
  }));
  const pos = s.cur == null ? null : Math.max(0, Math.min(100, ((s.cur - s.lo) / (s.hi - s.lo)) * 100));
  const dk = kind === "PER" ? 1 : 2, nm = { 5: "최근 5년", 10: "최근 10년", all: "전체 기간" }[period];
  $(`#${id}-note`).innerHTML = `지금 ${kind} <b>${n(s.cur, dk)}배</b> · ${nm} 범위 ${n(s.lo, dk)}~${n(s.hi, dk)}배${pos == null ? "" : ` (아래에서 ${n(pos, 0)}% 위치)`}
    <br><span class="src">${s.from}~ · 선 = ${key === "eps" ? "EPS" : "BPS"} × 배수 (연간 실적·추정치를 각 해 12월 말에 두고 달마다 이음, 네이버 방식) · 배수 = ${nm} ${kind} 하위 ${DASH.settings.band.low_pct}% ~ 상위 ${100 - DASH.settings.band.high_pct}% 를 4등분 · 아래 이름을 누르면 선을 끄고 켤 수 있어요</span>`;
}

/* ---------- Koyfin 식 추이 (선 하나 + High / Median / Low) ----------
   mode "ntm" = 선행 PER: NTM EPS = 앞으로 12개월 EPS (Y년 실적을 (Y-1)년 12월 말에 두고 직선 보간 = 올해·내년 추정을 남은 기간 비율로 섞음).
   mode "pb"  = PBR (사용자 11/6, 후행 PER 추이 대신): BPS = Y년 말 BPS 를 그해 12월 말에 두고 직선 보간 (지난 결산 순자산 기준 P/B, 올해 칸은 연말 추정 포함).
   1년 이하 기간은 일별 종가, 그보다 길면 주간 종가. High / Median / Low = 그 기간 최고·가운데·최저. */
const KF_PERIODS = [["all", "ALL"], ["10y", "10Y"], ["5y", "5Y"], ["1y", "1Y"], ["ytd", "YTD"], ["6m", "6M"], ["3m", "3M"]];
const KF_M = (mode) => (mode === "pb"
  ? { id: "kfb", key: "bps", off: 0, dg: 2, title: "PBR 추이", lab: "P/B", e: "BPS = 그때의 주당 순자산 (해마다 연말 BPS 를 12월 말에 두고 이음 — 'PBR 밴드 차트'와 같은 BPS, 올해 칸은 연말 추정 포함) · Koyfin 의 P/B 도 지난 결산 순자산 기준이에요" }
  : { id: "kf", key: "eps", off: 1, dg: 1, title: "선행 PER 추이", lab: "P/E (NTM)", e: "NTM EPS = 앞으로 12개월 EPS (올해·내년 추정을 남은 기간 비율로 섞음, 지난 시점은 실제 실적으로 계산 — 12MF PER 밴드와 같은 EPS) · Koyfin 은 그 당시 컨센서스를 써서 과거 구간 숫자가 조금 다를 수 있어요" });
function kfSeries(d, period, mode = "ntm") {
  const M = KF_M(mode);
  const anchors = d.history.filter((r) => r[M.key] > 0).map((r) => [Date.UTC(r.year - M.off, 11, 31), r[M.key]]).sort((a, b) => a[0] - b[0]);
  const base = (t) => {
    for (let i = 1; i < anchors.length; i++) {
      const [t0, v0] = anchors[i - 1], [t1, v1] = anchors[i];
      if (t >= t0 && t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
    return null;
  };
  const band = d.bands.PER || d.bands.PBR || d.bands.DIV;
  const ch = d.card.chart;
  const short = ["1y", "ytd", "6m", "3m"].includes(period);
  let pts = short && ch ? ch.dates.map((s, i) => [Date.parse(s), ch.close[i]]) : band ? band.dates.map((s, i) => [Date.parse(s), band.price[i]]) : [];
  if (!pts.length) return null;
  const L = new Date(pts[pts.length - 1][0]);
  const back = { "10y": [10, 0], "5y": [5, 0], "1y": [1, 0], "6m": [0, 6], "3m": [0, 3] }[period];
  const from = period === "all" ? 0 : period === "ytd" ? Date.UTC(L.getUTCFullYear(), 0, 1)
    : Date.UTC(L.getUTCFullYear() - back[0], L.getUTCMonth() - back[1], L.getUTCDate());
  pts = pts.filter(([t]) => t >= from).map(([t, p]) => { const e = base(t); return [t, e ? p / e : null]; })
    .filter(([, v]) => v != null && v > 0 && (M.key !== "eps" || v <= (DASH.settings.band.per_cap || 1e9)));
  if (pts.length < 5) return null;
  const vs = pts.map((x) => x[1]).sort((a, b) => a - b);
  return { labels: pts.map(([t]) => ymd(t)), pe: pts.map((x) => Math.round(x[1] * 100) / 100),
    hi: vs[vs.length - 1], med: vs[Math.floor(vs.length / 2)], lo: vs[0], cur: pts[pts.length - 1][1] };
}
function kfBlock(px = "", tag = "button", mode = "ntm", d = null) {
  const M = KF_M(mode);
  return `<h3>${M.title} <span class="src">Koyfin 방식 · ${M.lab}</span></h3><div class="card">
    ${segTabs(`${px}${M.id}-seg`, KF_PERIODS, "10y", tag)}
    <div class="chart-box nvbox"><canvas id="${px}${M.id}-chart"></canvas></div><div class="note" id="${px}${M.id}-note"></div>${d ? estWarnHTML(d, mode === "pb" ? "year" : "fwd", mode === "pb" ? "BPS" : "EPS", false) : ""}</div>`;
}
function drawKf(d, period, px = "", mode = "ntm") {
  const M = KF_M(mode), s = kfSeries(d, period, mode), cv = document.getElementById(`${px}${M.id}-chart`);
  if (!cv) return;
  if (!s) { if (charts.has(`${px}${M.id}-chart`)) charts.get(`${px}${M.id}-chart`).destroy(); $(`#${px}${M.id}-note`).textContent = "이 기간은 자료가 부족해요."; return; }
  const C = themeColors(), flat = (v) => s.pe.map(() => v), f = (v) => n(v, M.dg);
  const ds = [{ label: M.lab, data: s.pe, borderColor: mode === "pb" ? C.s3 : C.s7, borderWidth: 3 },
    { label: `High ${f(s.hi)}배`, data: flat(s.hi), borderColor: BAND_COL[3], borderDash: [6, 4], borderWidth: 2 },
    { label: `Median ${f(s.med)}배`, data: flat(s.med), borderColor: C.ink2, borderDash: [6, 4], borderWidth: 2 },
    { label: `Low ${f(s.lo)}배`, data: flat(s.lo), borderColor: BAND_COL[1], borderDash: [6, 4], borderWidth: 2 }];
  makeChart(cv, s.labels, ds, { fmt: (v) => f(v) + "배", yfmt: (v) => n(v, mode === "pb" ? 1 : 0) + "x", xlen: 7 });
  const pos = s.hi > s.lo ? ((s.cur - s.lo) / (s.hi - s.lo)) * 100 : null;
  $(`#${px}${M.id}-note`).innerHTML = `${legend(ds.map((x) => [x.label, x.borderColor, !!x.borderDash]))}
    지금 ${M.lab} <b>${f(s.cur)}배</b> · 이 기간 가운데값 ${f(s.med)}배 대비 ${pct((s.cur / s.med - 1) * 100, 0, true)}${pos == null ? "" : ` · 최저~최고 사이 ${n(pos, 0)}% 위치`}
    <br><span class="src">${M.e}</span>`;
}
function wireKf(d, px = "", mode = "ntm") {
  drawKf(d, "10y", px, mode);
  segWire(`#${px}${KF_M(mode).id}-seg`, (p) => drawKf(d, p, px, mode));
}


// PER 적정주가 — 종목 상세에서 밴드 그림 묶음(bandChartsHTML) 바로 아래에
function perValHTML(d) {
  let h = "";
  if (d.per && d.bands.PER) {
    const p = d.per;
    const cols = Object.keys(p.eps);
    h += `<h3>PER 적정주가</h3><div class="card">
      <h3 style="margin-top:0">선행 PER</h3><div class="kv">${cols.map((k) => `<div class="k">${k} PER <span class="src">EPS ${k} ${money(p.eps[k], d.currency)} · ${esc(d.sources.consensus)}</span></div><div class="v">${times(p.fwd_per[k], 2)}</div>`).join("")}</div>
      <h3>적정주가 시나리오 (EPS × PER)</h3>${matrixTable(p.matrix, cols, d.price, "PER ↓ · EPS →", null, d.currency)}
      ${p.rerating_warning ? `<div class="warnbox">${esc(p.rerating_warning)}</div>` : ""}</div>`;
  }
  return h;
}
function detailHTML(d) {
  const c = d.card;
  const L = LIGHT[c.verdict] || LIGHT.na;
  let h = `<div class="card" style="margin-top:12px"><div class="light">${lamp(c.verdict)}<div>
      <div class="verdict ${c.verdict}">${L.stock} <span class="sub">${esc(c.why)}</span></div>
      <div class="big">${money(d.price, d.currency)}</div><div class="sub">${esc(d.price_date)} 종가 · 시가총액 ${capTxt(d)} <span class="src">${esc(d.sources.price)}</span></div></div></div>
    <div class="kv"><div class="k">적정주가 <b>Base</b> <span class="src">${esc(c.fair_basis)}</span></div><div class="v">${money(c.fair, c.currency)} (${c.gap == null ? "N/A" : pct(c.gap * 100, 0, true)})</div>
    <div class="k">12개월 선행 PER</div><div class="v">${times(c.fwd_per, 2)}</div>
    </div>${scenHTML(c)}`;
  if (bondAlert(c)) h += `<div class="warnbox">⚠ 금리 대비 비쌈: 선행 PER ${times(c.fwd_per, 1)}가 ${esc(c.bond_label)} 금리로 환산한 PER ${times(c.bond_per, 1)}보다 높아요 (주식 이익수익률이 채권 금리보다 낮음).</div>`;
  if (c.short_history) h += `<div class="warnbox">📅 ${esc((c.band_start || "").slice(0, 4))}년부터의 데이터만 있어요. 10년 평균은 가능한 기간으로 계산했어요.</div>`;
  if (c.rerating_warning) h += `<div class="warnbox">${esc(c.rerating_warning)}</div>`;
  for (const x of c.checks || []) {
    h += `<div class="note">${x.warn ? "⚠ " : "✓ "}${esc(x.item)}: ${n(x.a, x.dg || 0)} <span class="src">${esc(x.a_src)}</span> / ${n(x.b, x.dg || 0)} <span class="src">${esc(x.b_src)}</span>${x.warn ? ` — ${n(Math.abs(x.a / x.b - 1) * 100, 1)}% 차이` : " — 거의 일치"}</div>`;
  }
  const dc = c.dart_check;
  if (dc) {
    h += `<div class="chart-title" style="margin-top:12px"><b>📑 DART 공시 대조</b> <span class="src">${esc(dc.report)} (누적) vs 네이버·와이즈리포트</span></div>
      <table class="compact" style="width:100%"><thead><tr><th style="text-align:left">항목 (억원)</th><th>DART</th><th>네이버</th><th>차이</th></tr></thead><tbody>
      ${dc.rows.map((r) => `<tr><td>${esc(r.item)}</td><td style="text-align:right">${n(r.dart)}</td><td style="text-align:right">${n(r.wise)}</td>
        <td style="text-align:right">${r.diff == null ? "-" : (r.diff > 1 ? "⚠ " : "✓ ") + n(r.diff, 1) + "%"}</td></tr>`).join("")}</tbody></table>`;
  }
  h += `</div>`;

  h += `<!--profile-->`;
  if (d.pbr && d.bands.PBR) {
    const p = d.pbr;
    const cols = Object.keys(p.bps);
    h += `<h3>PBR 적정주가</h3><div class="card">
      <h3 style="margin-top:0">적정주가 (BPS × PBR)</h3>${matrixTable([...p.matrix, { label: "PBR 1배 (= BPS)", mult: 1, cells: p.bps }], cols, d.price, "PBR ↓ · BPS →")}
      <h3>ROE 와 PBR</h3><div class="kv">
        <div class="k">ROE 현재 <span class="src">${esc(p.roe_now_label)}</span></div><div class="v">${pct(p.roe_now)}</div>
        <div class="k">ROE 5년 평균</div><div class="v">${pct(p.roe5)}</div>
        <div class="k">ROE 10년 평균 <span class="src">${p.roe10_years}년치</span></div><div class="v">${pct(p.roe10)}</div>
        <div class="k">요구수익률 (국고채 3년 + ${DASH.settings ? "" : ""}위험 프리미엄)</div><div class="v">${pct(p.req_return, 2)}</div>
        <div class="k">적정 PBR ≈ ROE ÷ 요구수익률 <span class="src">${esc(p.fair_roe || "")}</span></div><div class="v">${times(p.fair_pbr, 2)}</div>
        <div class="k">현재 PBR <span class="src">올해 추정 BPS 기준</span></div><div class="v">${times(p.cur_pbr, 2)}</div></div>
      ${p.verdict ? `<div class="note"><b>${esc(p.verdict)}</b></div>` : ""}</div>`;
  }
  if (d.div && d.bands.DIV) {
    const v = d.div;
    h += `<h3>배당</h3><div class="card">${v.no_history ? `<div class="warnbox">배당을 시작한 지 얼마 안 돼서 과거 배당수익률 밴드는 없어요. 대신 목표 배당수익률로 적정주가를 계산했어요.</div>` : bandBlock("band-div", d.bands.DIV, "DIV")}
      <div class="kv">
        <div class="k">현재 배당수익률 <span class="src">${v.dps_last_year}년 배당금 ${n(v.dps_last)}원 기준</span></div><div class="v">${pct(v.cur_yield, 2)}</div>
        <div class="k">올해 예상 배당수익률 <span class="src">컨센서스</span></div><div class="v">${pct(v.fwd_yield, 2)}</div>
        <div class="k">국고채 3년 대비</div><div class="v">${v.vs_bond == null ? "N/A" : (v.vs_bond > 0 ? "+" : "") + n(v.vs_bond, 2) + "%p"}</div>
        <div class="k">최근 3년 평균 배당성향</div><div class="v">${pct(v.payout_avg)}</div></div>
      ${v.verdict ? `<div class="note"><b>${LIGHT[v.signal]?.emoji || ""} ${esc(v.verdict)}</b></div>` : ""}
      <div class="chart-title">연도별 주당배당금(DPS) <span class="src">옅은 막대 = 추정</span></div>
      <div class="chart-box"><canvas id="dps-chart"></canvas></div>
      <h3>배당으로 본 적정주가 (배당금 ÷ 배당수익률)</h3>
      <div class="tbl-wrap"><table><thead><tr><th>배당금 가정</th>${v.yield_labels.map((l, i) => `<th>${esc(v.no_history ? l : l.split(" ")[0])}<br><span class="src">${pct(v.yield_values[i], 2)}</span></th>`).join("")}</tr></thead>
      <tbody>${v.scenarios.filter((s) => s.dps).map((s) => `<tr><td>${esc(s.label)}<br><span class="src">${s.dps == null ? "N/A" : n(s.dps) + "원"}</span></td>${s.prices.map((p) => p == null ? "<td>N/A</td>" : `<td class="${p >= d.price ? "cheap" : "dear"}">${n(p)}<br><span class="src">${pct((p / d.price - 1) * 100, 0, true)}</span></td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="note">${v.no_history ? "배당금 ÷ 목표 배당수익률 = 그 수익률이 되는 주가예요. 목표 수익률은 config/settings.yaml 의 dividend.target_yields 에서 바꿀 수 있어요." : "하방 = 10년 중 배당수익률이 가장 높았던 수준(상위 10%)까지 주가가 내려간 경우, 상방 = 가장 낮았던 수준(하위 10%)까지 오른 경우예요."}</div></div>`;
  }
  h += `<h3>연도별 실적</h3><div class="card"><div class="tbl-wrap"><table><thead><tr><th>연도</th><th>EPS</th><th>BPS</th><th>DPS</th><th>ROE</th><th>배당성향</th><th>출처</th></tr></thead><tbody>
    ${d.history.map((r) => `<tr><td>${r.year}${r.estimate ? "E" : ""}</td><td>${n(r.eps, d.currency === "USD" ? 2 : 0)}</td><td>${n(r.bps)}</td><td>${n(r.dps)}</td><td>${pct(r.roe)}</td><td>${pct(r.payout)}</td><td class="src">${esc(r.src)}</td></tr>`).join("")}
    </tbody></table></div><div class="note">출처: 가격 ${esc(d.sources.price)} · 추정치 ${esc(d.sources.consensus)} · 과거 실적 ${esc(d.sources.history)}</div></div>
    <div class="note">평단가·수량은 <b>config/stocks.yaml</b> 의 avg_price, quantity 에 넣으면 표시돼요.</div>`;
  return h;
}
function drawDetailCharts(d) {
  if (d.div && d.bands.DIV) {
    if (!d.div.no_history) wireBand("band-div", d.bands.DIV, "DIV");
    const C = themeColors();
    const ys = d.div.dps_years;
    makeChart(document.getElementById("dps-chart"), ys.map((y) => y.year + (y.estimate ? "E" : "")),
      [{ label: "주당배당금", data: ys.map((y) => y.dps), backgroundColor: ys.map((y) => (y.estimate ? C.s1 + "66" : C.s1)), borderRadius: 4, borderSkipped: "start", maxBarThickness: 28 }],
      { type: "bar", zero: true, fmt: (v) => n(v) + "원", yfmt: (v) => n(v), xlen: 6 });
  }
}
/* ---------- 미국 중고차 가격지수 (현대차·기아 상세 화면) ---------- */
const AUTO_CODES = ["005380", "000270"];
function manheimBlock() {
  const M = DASH.market.manheim;
  if (!M || !M.hist || M.hist.length < 24) return "";
  const h = M.hist, last = h[h.length - 1], prev = h[h.length - 2];
  const peak = h.reduce((a, b) => (b[1] > a[1] ? b : a));
  const yoys = h.filter((x) => x[2] != null);
  const yHi = yoys.reduce((a, b) => (b[2] > a[2] ? b : a)), yLo = yoys.reduce((a, b) => (b[2] < a[2] ? b : a));
  const gfc = h.filter((x) => x[0] >= "2008-01" && x[0] <= "2009-12").reduce((a, b) => (b[1] < a[1] ? b : a));
  const pre = M.prelim?.includes(last[0]) ? " (그달 1~15일 잠정치)" : "";
  const mom = (last[1] / prev[1] - 1) * 100;
  return `<h3>🚗 미국 중고차 가격지수 (Manheim)</h3><div class="card">
    <div class="tiles">
      <div class="tile"><div class="tl">${esc(last[0])}${pre}</div><div class="tv">${n(last[1], 1)}</div><div class="src">1997년 1월 = 100 · 계절조정</div></div>
      <div class="tile"><div class="tl">전월 / 전년 대비</div><div class="tv" style="font-size:20px">${pct(mom, 1, true)} / ${pct(last[2], 1, true)}</div><div class="src">Manheim · Cox Automotive</div></div>
    </div>
    <div class="seg" id="mh-seg"><button data-v="idx" class="on">지수</button><button data-v="yoy">전년 대비 %</button></div>
    <div class="seg" id="mh-yseg" style="margin-left:6px"><button data-y="0">전체</button><button data-y="10" class="on">10년</button><button data-y="5">5년</button></div>
    <div class="chart-box tall"><canvas id="mh-chart"></canvas></div>
    <div class="memo" style="margin-top:10px">
      <b>중고차 값이 오르면 자동차 회사에 좋은가?</b> — 보통은 도움이 되는 쪽이에요.
      <br>· 새 차 할인(인센티브)을 덜 써도 돼서 대당 이익이 좋아져요.
      <br>· 리스로 나간 차를 돌려받아 팔 때 손해가 줄어, 할부·리스 금융(현대캐피탈 아메리카 등) 이익에 도움이 돼요.
      <br>· 타던 차를 비싸게 넘길 수 있어 새 차를 살 여력이 커져요.
      <br><b>역사적으로는</b>
      <br>· 2008년 금융위기: 지수가 ${n(gfc[1], 0)}(${esc(gfc[0])})까지 떨어짐 — 완성차 업체가 가장 어려웠던 시기.
      <br>· 2021~2022년 반도체 부족: 새 차를 못 만들어 전년 대비 ${pct(yHi[2], 0, true)}(${esc(yHi[0])})까지 급등, 최고 ${n(peak[1], 1)}(${esc(peak[0])}). 할인이 거의 사라져 현대차·기아가 역대 최대 이익을 낸 시기(2022~2023년)와 겹쳐요.
      <br>· 그 뒤 공급이 풀리며 ${pct(yLo[2], 0, true)}(${esc(yLo[0])})까지 내려와 정상화.
      <br><b>볼 점</b>: 왜 오르는지가 중요해요. 수요가 좋아서 오르면 좋은 신호지만, 재고(공급)가 줄어서 오르면 판매 대수는 늘지 않을 수 있어요. 주가와 1:1로 같이 움직이지는 않아요.
    </div>
    <div class="note src">출처: 1997-01~2025-11 Manheim 공개 엑셀, 이후 매달 Cox Automotive 발표 기사에서 자동으로 붙임${M.prelim_url ? ` · <a href="${esc(M.prelim_url)}" target="_blank" rel="noopener">최근 발표</a>` : ""}</div>
  </div>`;
}
function wireManheim() {
  const h = DASH.market.manheim.hist;
  let view = "idx", years = 10;
  const draw = () => {
    const C = themeColors();
    const i0 = years ? Math.max(0, h.length - years * 12) : 0;
    const s = h.slice(i0);
    const ds = view === "idx"
      ? [{ label: "Manheim 지수", data: s.map((x) => x[1]), borderColor: C.s1 }]
      : [{ label: "전년 대비", data: s.map((x) => x[2]), borderColor: C.s2 }, { label: "0%", data: s.map(() => 0), borderColor: C.muted, borderDash: [4, 3], borderWidth: 1 }];
    makeChart(document.getElementById("mh-chart"), s.map((x) => x[0]), ds,
      view === "idx" ? { fmt: (v) => n(v, 1), yfmt: (v) => n(v, 0) } : { fmt: (v) => pct(v, 1, true), yfmt: (v) => v.toFixed(0) + "%" });
  };
  const seg = (id, fn) => document.getElementById(id).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    document.getElementById(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    fn(b); draw();
  });
  seg("mh-seg", (b) => { view = b.dataset.v; });
  seg("mh-yseg", (b) => { years = Number(b.dataset.y); });
  draw();
}

/* ---------- ✈️ 한국 출입국 관광통계 (config/tourism.yaml, 손으로 적음 — 롯데쇼핑 상세 맨 아래) ---------- */
let TOUR = null;
const TOUR_K = [["out", "아웃바운드", "내국인 출국", "s1"], ["in", "인바운드", "외국인 입국", "s2"], ["cn", "중국인 입국", "외국인 중", "s3"]];
// 🔑 핵심 지표: 종목마다 주가를 움직이는 숫자 (config/kpi.yaml — 실적발표·컨퍼런스콜·전자공시에서 옮김, 분기마다 이어 적음)
let KPI = null;
const KPI_ALIAS = { "005935": "005930" };  // 삼성전자우 = 보통주 지표
const KPI_COL = ["var(--s1)", "var(--bad)", "var(--s3)", "var(--s4)"];
const kpiF = (v, u = "") => (u.startsWith("$") ? (v < 0 ? "-$" : "$") + n(Math.abs(v), Number.isInteger(v) ? 0 : 1) + u.slice(1)
  : u === "억원" && Math.abs(v) >= 1e4 ? n(v / 1e4, 1) + "조" : n(v, Number.isInteger(v) ? 0 : 1) + u);  // 1조 넘는 억원은 '30.3조'
// 쌓은 막대 (연간 신규 수주 국내/중국, 빅테크 CapEx 회사별 등): 칸 위에 합계, ytd = 아직 진행 중인 해
function kpiStack(ch) {
  const ks = [...new Set(ch.s.flatMap((s) => Object.keys(s.v || {})))].sort();
  if (ks.length < 2) return "";
  const tot = ks.map((k) => ch.s.reduce((a, s) => a + (s.v?.[k] || 0), 0)), hi = Math.max(...tot) * 1.15 || 1;
  const W = 320, x0 = 10, x1 = W - 10, top = 20, bot = 140, bw = (x1 - x0) / ks.length, Y = (v) => bot - (v / hi) * (bot - top);
  let g = `<line x1="${x0}" x2="${x1}" y1="${bot}" y2="${bot}" stroke="var(--axis)"/>`;
  ks.forEach((k, i) => {
    const cx = x0 + bw * i + bw / 2, ytd = k === String(ch.ytd);
    let acc = 0;
    ch.s.forEach((s, si) => {
      const v = s.v?.[k];
      if (!v) return;
      g += `<rect x="${cx - bw * 0.3}" y="${Y(acc + v)}" width="${bw * 0.6}" height="${Math.max(1, Y(acc) - Y(acc + v))}" fill="${KPI_COL[si % 4]}"${ytd ? ' opacity=".75"' : ""}/>`;
      acc += v;
    });
    g += `<text x="${cx}" y="${Y(tot[i]) - 4}" text-anchor="middle" class="qv${i === ks.length - 1 ? " b" : ""}">${kpiF(rnd1(tot[i]), ch.u)}</text>`
      + `<text x="${cx}" y="${bot + 15}" text-anchor="middle" class="qx">${esc(/^\d{4}$/.test(k) ? k.slice(2) : k)}${ytd ? " YTD" : ""}</text>`;
  });
  g += tipCols((i) => x0 + bw * i + bw / 2, bw, 0, 160, ks.map((k, i) => [`${k}${k === String(ch.ytd) ? " (YTD)" : ""}`, ...ch.s.map((s) => (s.v?.[k] ? `${s.n}: ${kpiF(rnd1(s.v[k]), ch.u)}` : null)), ch.s.length > 1 ? `합계: ${kpiF(rnd1(tot[i]), ch.u)}` : null].filter(Boolean).join("\n")));
  const leg = `<div class="src" style="padding:0 4px 4px">${ch.s.map((s, si) => `<span style="color:${KPI_COL[si % 4]}">■</span> ${esc(s.n)}`).join(" · ")}${ch.ytd_note ? ` · YTD = ${esc(ch.ytd_note)}` : ""}${ch.note ? ` · ${esc(ch.note)}` : ""}</div>`;
  return `<div class="qp"><div class="qt"><b>${esc(ch.t)}</b>${ch.tag || ""}</div>${ch.why ? `<div class="src">${esc(ch.why)}</div>` : ""}<svg viewBox="0 0 ${W} 160" role="img" aria-label="${esc(ch.t)}">${g}</svg>${leg}${ch.kid ? `<div class="kidbox" style="margin:4px;font-size:13px">🐣 ${esc(ch.kid)}</div>` : ""}</div>`;
}
const rnd1 = (v) => Math.round(v * 10) / 10;
// 📊 분기 매출 · 영업이익 · 영업이익률 한 그림 (막대 두 개 + 위에 영업이익률 선, 최근 5분기 실적)
function comboHTML(d) {
  const k = d.kq, qs = (k?.quarters || []).filter((q) => q.sales != null && q.op != null && q.sales > 0).slice(-5);
  if (qs.length < 2) return "";
  const usd = k.cur === "USD", mx = Math.max(...qs.map((q) => q.sales));
  // 단위: 한국 = 1조 넘으면 조원(소수 한 자리) 아니면 억원, 미국 = 모두 $B (10억 달러 미만이면 소수 둘째 자리)
  const [div, unit, dg] = usd ? [1e9, "$B", mx >= 1e10 ? 1 : 2] : mx >= 1e4 ? [1e4, "조원", 1] : [1, "억원", 0];
  const V = (v) => n(v / div, dg), W = 320, x0 = 8, x1 = W - 8, bw = (x1 - x0) / qs.length, top = 84, bot = 150;
  const lo = Math.min(0, ...qs.map((q) => q.op)), hi = mx * 1.1, Y = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top), zero = Y(0);
  const opm = qs.map((q) => (q.op / q.sales) * 100), lmin = Math.min(...opm), lmax = Math.max(...opm), LY = (v) => 62 - ((v - lmin) / (lmax - lmin || 1)) * 34;
  let g = `<line x1="${x0}" x2="${x1}" y1="${zero}" y2="${zero}" stroke="var(--axis)"/>`;
  const bar = (x, v, fill) => { const y = v >= 0 ? Y(v) : zero; return `<rect x="${x}" y="${y}" width="${bw * 0.34}" height="${Math.max(1, Math.abs(Y(v) - zero))}" rx="2" fill="${v < 0 ? "var(--bad)" : fill}"/>`; };
  qs.forEach((q, i) => {
    const cx = x0 + bw * i + bw / 2, last = i === qs.length - 1, b = last ? " b" : "";
    g += bar(cx - bw * 0.37, q.sales, "var(--s1)") + bar(cx + bw * 0.03, q.op, "var(--s4)")
      + `<text x="${cx - bw * 0.2}" y="${Y(q.sales) - 4}" text-anchor="middle" class="qv${b}" style="font-size:9px">${V(q.sales)}</text>`
      + `<text x="${cx + bw * 0.2}" y="${q.op >= 0 ? Y(q.op) - 4 : zero + Math.abs(Y(q.op) - zero) + 10}" text-anchor="middle" class="qv${b}" style="font-size:9px${q.op < 0 ? ";fill:var(--bad-ink)" : ""}">${V(q.op)}</text>`
      + `<line x1="${cx}" x2="${cx}" y1="${LY(opm[i]) + 5}" y2="${top - 4}" stroke="var(--grid)" stroke-dasharray="2 3"/>`
      + `<text x="${cx}" y="166" text-anchor="middle" class="qx">${esc(q.q)}${q.prelim ? " 잠정" : ""}</text>`;
  });
  g += `<polyline points="${qs.map((q, i) => `${x0 + bw * i + bw / 2},${LY(opm[i])}`).join(" ")}" fill="none" stroke="var(--ink-2)" stroke-width="2"/>`;
  const op = qs.map((_, i) => [x0 + bw * i + bw / 2, LY(opm[i])]);
  qs.forEach((q, i) => {
    const cx = x0 + bw * i + bw / 2;
    g += `<circle cx="${cx}" cy="${LY(opm[i])}" r="3.5" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="2"/><text x="${cx}" y="${clearY(op, i)}" text-anchor="middle" class="qv${i === qs.length - 1 ? " b" : ""}"${opm[i] < 0 ? ' style="fill:var(--bad-ink)"' : ""}>${n(opm[i], 1)}%</text>`;
  });
  g += tipCols((i) => x0 + bw * i + bw / 2, bw, 0, 172, qs.map((q, i) => `${q.q}${q.prelim ? " 잠정" : ""}\n매출: ${V(q.sales)}${unit}\n영업이익: ${V(q.op)}${unit}\n영업이익률: ${n(opm[i], 1)}%`));
  return `<div class="qp"><div class="qt"><b>📊 분기 매출 · 영업이익 · 영업이익률</b><span class="src">${unit}</span></div><svg viewBox="0 0 ${W} 172" role="img" aria-label="분기 매출 영업이익 영업이익률">${g}</svg>
    <div class="src" style="padding:0 4px 4px"><span style="color:var(--s1)">■</span> 매출 · <span style="color:var(--s4)">■</span> 영업이익 · <span style="color:var(--ink-2)">●</span> 영업이익률</div></div>`;
}
// 📦 수주 읽는 법: 신규 수주 vs 수주잔고(누적) · 언제 매출이 되나(kpi.yaml orders_lag) · 수주÷매출, 잔고÷연 매출 계산
function ordersGuideHTML(k, d) {
  const stack = (k.charts || []).find((c) => c.kind === "stack"), bl = (k.charts || []).find((c) => /잔고/.test(c.t));
  if (!k.orders_lag && !stack && !bl) return "";
  // 조원으로: $B × 10억 × 환율 ÷ 1조 = $B × 환율 ÷ 1,000
  const fx = DASH.fx || null, toJo = (v, u) => (u === "조원" ? v : u === "억원" ? v / 1e4 : u === "$B" && fx ? (v * fx) / 1e3 : u === "$M" && fx ? (v * fx) / 1e6 : null);
  const ann = Object.fromEntries((d.kq?.annual || []).filter((r) => !r.est && r.sales).map((r) => [`20${r.q}`, r.sales / 1e4]));  // 연도 → 매출(조원)
  const out = [];
  if (stack) {  // 신규 수주 ÷ 그해 매출 (Book-to-Bill)
    const bb = Object.keys(ann).sort().slice(-3).map((y) => {
      const t = stack.s.reduce((a, s) => a + (s.v?.[y] || 0), 0), j = t ? toJo(t, stack.u) : null;
      return j && y !== String(stack.ytd) ? `${y.slice(2)}년 ${n(j / ann[y], 1)}배` : null;
    }).filter(Boolean);
    if (bb.length) out.push(`① <b>신규 수주 ÷ 그해 매출</b>: ${bb.join(" · ")} <span class="src">1배보다 크면 일감이 쌓이는 중, 작으면 줄어드는 중${stack.u.startsWith("$") ? ` · 달러 수주는 지금 환율 ${n(fx, 0)}원으로 바꿔서 대략` : ""}</span>`);
  }
  if (bl) {  // 수주잔고 ÷ 최근 연 매출 = 몇 년 치 일감
    const s = bl.s[0], q = Object.keys(s.v || {}).sort().at(-1), j = q ? toJo(s.v[q], bl.u) : null, y = Object.keys(ann).sort().at(-1);
    if (j && y) out.push(`② <b>수주잔고 ÷ 연 매출</b>: ${esc(q)} 잔고 ${n(j, 1)}조 ÷ ${y.slice(2)}년 매출 ${n(ann[y], 1)}조 = <b>약 ${n(j / ann[y], 1)}년 치 일감</b>${bl.u.startsWith("$") ? ` <span class="src">(달러는 환율 ${n(fx, 0)}원으로 바꿈)</span>` : ""}`);
  }
  out.push("③ <b>비싸게 받은 주문이 언제 매출로 들어오는지</b> (위 '언제 매출이 되나') — 그때 이익률이 올라가요");
  out.push("④ 수주가 많아도 원가(강재·인건비)가 오르거나 환율이 불리하면 이익은 줄 수 있어요 — 영업이익률을 같이 보기");
  return `<div class="card" style="margin-top:8px;background:var(--surface-2)"><b>📦 수주 읽는 법</b>
    <ul class="irl" style="margin-top:4px">
      <li>🆕 <b>신규 수주</b> = 그해 새로 받은 주문 (앞으로 매출이 될 씨앗)${stack ? " — 위 '연간 신규 수주' 막대" : ""}</li>
      <li>📦 <b>수주잔고(누적 수주)</b> = 받아 놓고 아직 매출로 안 바뀐 주문 전체 = 남은 일감${bl ? ` — 위 '${esc(bl.t)}'` : ""}</li>
      <li>🔁 올해 말 잔고 = 작년 말 잔고 + 올해 신규 수주 − 올해 매출로 바뀐 만큼</li>
      ${k.orders_lag ? `<li>⏳ <b>언제 매출이 되나</b>: ${esc(k.orders_lag)}</li>` : ""}
    </ul>
    <div class="kidbox" style="margin-top:6px">👀 <b>수주에서 꼭 볼 것</b><ul class="irl">${out.map((x) => `<li>${x}</li>`).join("")}</ul></div></div>`;
}
// 연간 매출 & 영업이익률 (와이즈리포트 실적 + 추정 E): 막대 = 매출, 선 = 영업이익률(OPM)
function annualOpmHTML(d) {
  const a = (d.kq?.annual || []).filter((r) => r.sales != null).slice(-8);
  if (a.length < 3 || d.currency === "USD") return "";
  return qPanel("📈 연간 매출 & 영업이익률", "회색 = 추정(E)", a.map((r) => r.q), a.map((r) => r.sales * 1e8),
    a.map((r) => (r.op != null && r.sales ? (r.op / r.sales) * 100 : null)), false, "var(--s1)", a.map((r) => !!r.est));
}
function kpiChart(ch) {
  if (ch.kind === "stack") return kpiStack(ch);
  const gd = ch.g;  // 회사 가이던스 {q, lo, hi, si 몇 번째 선}: 맨 끝 칸에 점선 범위
  const qs = [...new Set([...ch.s.flatMap((s) => Object.keys(s.v || {})), ...(gd ? [gd.q] : [])])].sort();
  const vals = [...ch.s.flatMap((s) => Object.values(s.v || {})), ...(gd ? [gd.lo, gd.hi] : [])].filter((v) => v != null);
  if (qs.length < 2 || !vals.length) return "";
  const many = ch.s.length > 1, W = 320, x0 = 26, x1 = W - (many ? 62 : 26), top = 28, bot = 138;  // 선이 여러 개면 끝 숫자를 오른쪽에
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = (hi0 - lo0) * 0.18 || Math.abs(hi0) * 0.2 || 1;
  const lo = lo0 - pad, hi = hi0 + pad, Y = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top), X = (i) => x0 + ((x1 - x0) * i) / (qs.length - 1);
  const lab = (i) => qs.length <= 7 || (qs.length - 1 - i) % 2 === 0;  // 칸이 많으면 하나 걸러 이름 (마지막은 항상)
  let g = qs.map((q, i) => `<line x1="${X(i)}" x2="${X(i)}" y1="${top - 6}" y2="${bot}" stroke="var(--grid)"/>${lab(i) ? `<text x="${X(i)}" y="${bot + 16}" text-anchor="middle" class="qx">${esc(q)}</text>` : ""}`).join("");
  if (lo0 < 0 && hi0 > 0) g += `<line x1="${x0 - 10}" x2="${x1 + 10}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--axis)" stroke-dasharray="3 3"/>`;
  const ends = [];  // 선이 여러 개면 마지막 값만 글자로 (겹치지 않게 아래로 밀기)
  ch.s.forEach((s, si) => {
    const col = (ch.col || KPI_COL)[si % (ch.col || KPI_COL).length], pts = qs.map((q, i) => [i, s.v?.[q]]).filter(([, v]) => v != null);
    g += `<path d="${pts.map(([i, v], j) => `${j ? "L" : "M"}${X(i)},${Y(v)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="${s.star ? 5 : 3}" stroke-linejoin="round"/>`;
    const xy = pts.map(([i, v]) => [X(i), Y(v)]);
    pts.forEach(([i, v], j) => {
      const last = j === pts.length - 1;
      g += `<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="var(--surface)" stroke="${col}" stroke-width="2.5"/>`;
      if (many) { if (last) ends.push([X(i), Y(v), v, col]); }  // 선이 여럿이면 끝 숫자만 오른쪽 빈칸에
      else g += `<text x="${X(i)}" y="${clearY(xy, j, 20)}" text-anchor="middle" class="qv${last ? " b" : ""}"${last ? ` style="fill:${col};font-size:13px"` : ""}>${kpiF(v, ch.u)}</text>`;  // 선 위로 비켜서
    });
  });
  ends.sort((a, b) => a[1] - b[1]).forEach((e, i, a) => { if (i && e[1] - a[i - 1][1] < 14) e[1] = a[i - 1][1] + 14; });
  const over = ends.length ? ends[ends.length - 1][1] - (bot - 4) : 0;  // 아래 분기 이름과 겹치면 통째로 위로
  if (over > 0) ends.forEach((e) => { e[1] -= over; });
  ends.forEach(([x, y, v, col]) => {  // 선이 마지막 칸 전에 끝나면(오른쪽에 가이던스 칸) 점 위에
    g += x < X(qs.length - 1) - 1 ? `<text x="${x}" y="${y - 10}" text-anchor="middle" class="qv b" style="fill:${col};font-size:13px">${kpiF(v, ch.u)}</text>`
      : `<text x="${x + 8}" y="${y + 4}" text-anchor="start" class="qv b" style="fill:${col};font-size:13px">${kpiF(v, ch.u)}</text>`;
  });
  const rng = gd ? (gd.lo === gd.hi ? kpiF(gd.lo, ch.u) : `${kpiF(gd.lo, "")}~${kpiF(gd.hi, ch.u)}`) : "";
  if (gd) {  // 마지막 실제 값 → 가이던스 가운데로 점선, 범위는 옅은 막대
    const gi = qs.indexOf(gd.q), s0 = ch.s[gd.si || 0], col = (ch.col || KPI_COL)[(gd.si || 0) % (ch.col || KPI_COL).length];
    const lq = qs.slice(0, gi).reverse().find((q) => s0.v?.[q] != null), mid = (gd.lo + gd.hi) / 2;
    if (lq) g += `<line x1="${X(qs.indexOf(lq))}" y1="${Y(s0.v[lq])}" x2="${X(gi)}" y2="${Y(mid)}" stroke="${col}" stroke-width="2" stroke-dasharray="4 3"/>`;
    g += `<rect x="${X(gi) - 6}" y="${Y(gd.hi) - 2}" width="12" height="${Math.max(4, Y(gd.lo) - Y(gd.hi) + 4)}" rx="4" fill="${col}" fill-opacity=".22" stroke="${col}" stroke-dasharray="3 2"/>`
      + `<line x1="${X(gi)}" x2="${X(gi)}" y1="17" y2="${Y(gd.hi) - 2}" stroke="${col}" stroke-dasharray="1 2"/>`
      + `<text x="${X(gi) + 8}" y="13" text-anchor="end" class="qv b" style="fill:${col}">가이던스 ${rng}</text>`;  // 맨 위 빈 줄에 (마지막 값 글자와 안 겹치게)
  }
  g += tipCols(X, (x1 - x0) / (qs.length - 1), 0, 160, qs.map((q) => [q, ...ch.s.map((s) => (s.v?.[q] == null ? null : `${s.n}: ${kpiF(s.v[q], ch.u)}`)), gd && q === gd.q ? `회사 가이던스: ${rng}` : null].filter(Boolean).join("\n")));
  const leg = many ? `<div class="src" style="padding:0 4px 4px">${ch.s.map((s, si) => `<span style="color:${(ch.col || KPI_COL)[si % (ch.col || KPI_COL).length]}">●</span> ${s.star ? "⭐" : ""}${esc(s.n)}`).join(" · ")}</div>` : "";
  return `<div class="qp${ch.star ? " star" : ""}"><div class="qt"><b>${ch.star ? "⭐ " : ""}${esc(ch.t)}</b>${ch.tag || ""}</div>${ch.why ? `<div class="src">${esc(ch.why)}</div>` : ""}<svg viewBox="0 0 ${W} 160" role="img" aria-label="${esc(ch.t)}">${g}</svg>${leg}${ch.note ? `<div class="src" style="padding:0 4px 4px;color:var(--warn-ink)">${esc(ch.note)}</div>` : ""}${ch.kid ? `<div class="kidbox" style="margin:4px;font-size:13px">🐣 ${esc(ch.kid)}</div>` : ""}</div>`;
}
// 📏 이익 vs 주가 (지난 최대 10년, collector compute.long_cagr): 숫자 표 → 🐣 무슨 뜻 → 🔭 앞으로 3년 단순 계산 → 📌 읽는 법
// 오래 보면 주가 상승률 ≈ 이익 성장률 × 값(PER) 변화 — 같은 회사도 비싸게 사면(씨젠 PER 35배) 이익 12배에 주가 4배, 싸게 사면(한미 5~7배) 120배
function longCagrHTML(d) {
  const L = d.long;
  if (!L) return "";
  const usd = d.currency === "USD", t = d.card?.tbl || {};
  const M = (v) => (usd ? `$${n(v / 1e3, 1)}B` : kpiF(v, "억원")), W = (v) => (usd ? `$${n(v, 2)}` : `${n(v, 0)}원`);
  const G = (v) => (v == null ? "-" : `<b class="${v < 0 ? "neg" : ""}">${pct(v, 1, true)}</b>`), X = (a, b) => `${n(b / a, 1)}배`;
  const r = L.rerate, ry = r ? (r ** (1 / L.y) - 1) * 100 : null;
  const what = L.op_cagr == null ? `시작이나 지금 영업이익이 적자(0 이하)라 이익 연평균은 못 구해요. 주가만 연 ${pct(L.px_cagr, 1, true)} 움직였어요.`
    : r > 1.15 ? `이익은 ${X(L.op0, L.op1)}, 주가는 ${X(L.px0, L.px1)} — 주가가 이익보다 더 많이 올랐어요. 같은 이익에 매기는 값(PER)이 ${n(r, 1)}배로 비싸졌다는 뜻이에요. 앞으로 이 값이 제자리로 내려오면 이익이 늘어도 주가는 덜 오를 수 있어요.`
    : r < 0.87 ? `이익은 ${X(L.op0, L.op1)} 늘었는데 주가는 ${X(L.px0, L.px1)} — 같은 이익에 매기는 값(PER)이 ${n(r, 1)}배로 싸졌어요. 비싸게 시작했거나(씨젠처럼) 시장이 이익이 계속될지 의심한다는 뜻이에요.`
    : `이익이 ${X(L.op0, L.op1)}, 주가도 ${X(L.px0, L.px1)} — 주가가 이익을 거의 그대로 따라왔어요.`;
  const fg = usd ? t.eps_cagr : t.op_cagr, avg = (d.per?.matrix || []).find((m) => m.label === "10년 평균")?.mult, p12 = t.per12;
  const back = fg != null && avg && p12 > 0 && !d.card?.cyclical ? ((1 + fg / 100) * (avg / p12) ** (1 / 3) - 1) * 100 : null;
  const fwd = fg == null ? "" : `<div class="note">🔭 <b>앞으로 3년 단순 계산</b> — 예상 ${usd ? "EPS" : "영업이익"} 연평균 ${G(fg)} (컨센서스)${p12 ? ` · 지금 12개월 선행 PER ${n(p12, 1)}배${avg ? ` (10년 평균 ${n(avg, 1)}배)` : ""}` : ""}
    <ul class="irl">${d.card?.cyclical ? `<li class="kid-warn">⚠ 이익이 크게 오르내리는 업종이라 'PER 그대로' 계산은 빼요 — 이익 꼭대기에서 PER 이 가장 낮아 보이고, 이익이 꺾이면 주가가 먼저 내려요</li>`
      : `<li>PER 이 지금 그대로면 → 주가도 대략 연 ${G(fg)}</li>${back != null ? `<li>3년 뒤 PER 이 10년 평균으로 돌아가면 → 대략 연 ${G(back)}</li>` : ""}`}</ul>
    <span class="src">이익 성장 × PER 변화만 본 산수예요 · 배당·주식 수 변화는 뺐어요 · 매수·매도 추천이 아니에요</span></div>`;
  return `<h3>📏 이익 vs 주가 <span class="src">${esc(L.from)} → ${esc(L.to)} · ${n(L.y, 1)}년 · 영업이익 = 4분기 합 · 주가 = 배당 뺀 값</span></h3><div class="card">
    <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left"></th><th>${L.y % 1 ? n(L.y, 1) : L.y}년 전</th><th>지금</th><th>몇 배</th><th>연평균</th></tr></thead><tbody>
      <tr><td style="text-align:left">영업이익</td><td>${M(L.op0)}</td><td>${M(L.op1)}</td><td>${L.op0 > 0 && L.op1 > 0 ? X(L.op0, L.op1) : "-"}</td><td>${G(L.op_cagr)}</td></tr>
      <tr><td style="text-align:left">주가</td><td>${W(L.px0)}</td><td>${W(L.px1)}</td><td>${X(L.px0, L.px1)}</td><td>${G(L.px_cagr)}</td></tr>
      ${r ? `<tr><td style="text-align:left">이익 대비 주가<br><span class="src">≈PER, 1배 위 = 비싸짐</span></td><td></td><td></td><td><b>${n(r, 1)}배</b></td><td>${G(ry)}</td></tr>` : ""}
    </tbody></table></div>
    <div class="kidbox">🐣 ${what}</div>
    ${fwd}
    <div class="note src">📌 읽는 법: 오래 보면 주가 상승률 ≈ 이익 성장률 + 값(PER)이 변한 몫. 같은 이익 성장이라도 싸게 산 한미반도체(PER 5~7배)는 이익 14배에 주가 120배, 비싸게 산 씨젠(PER 35배)은 이익 12배에 주가 4배 — 그래서 '이익이 얼마나 늘까'와 '지금 값이 과거보다 비싼가'를 같이 봐요. 반도체처럼 오르내림이 큰 회사는 시작·끝이 호황이냐 불황이냐에 따라 숫자가 크게 달라져요. 영업이익은 회사 전체 숫자라, 자사주를 많이 사서 주식 수가 줄면(애플) 주가가 이익보다 빨리 오른 것처럼 보이고 새 주식을 많이 찍으면 반대예요.</div></div>`;
}
// 📈 영업이익 성장률 (YoY): 매출 성장률 바로 아래 — 국내는 이 성장률로 PER 을 몇 배 줄지 정함 (kpi.yaml 에 같은 제목 그래프가 있으면 그걸 씀)
function opYoyHTML(d, k) {
  const v = d.op_yoy;
  if (!v || k.charts.some((c) => /^영업이익 성장률/.test(c.t))) return "";
  return kpiChart({ t: "영업이익 성장률 (YoY)", u: "%", s: [{ n: "영업이익", v }], why: "1년 전 같은 분기보다 영업이익이 얼마나 늘었나 · 국내 종목은 이 성장률로 PER 을 몇 배 줄지 정해요" + (k.op_note ? ` · ⚠ ${k.op_note}` : "") })
    || `<div class="qp"><div class="qt"><b>영업이익 성장률 (YoY)</b></div><div class="note">${Object.entries(v).map(([q, x]) => `${esc(q)} <b>${pct(x, 1, true)}</b>`).join(" · ")} <span class="src">분기 자료가 더 쌓이면 그래프로</span></div></div>`;
}
// 현금흐름(FCF = 영업현금흐름 − 설비투자): 야후 분기 재무제표 + 야후에 아직 없는 최신 분기는 kpi.yaml fcf_add (보도자료)
function fcfSeries(d, k) {
  const usd = d.currency === "USD", qs = Object.entries(d.qtrs || {}).filter(([, q]) => q.fcf != null).map(([e, q]) => ({ q: qLabel(e), fcf: q.fcf, capex: q.capex }));
  for (const [q, v] of Object.entries(k?.fcf_add || {})) if (!qs.some((x) => x.q === q)) qs.push({ q, fcf: v * (usd ? 1e6 : 1e8), add: true });
  return qs.slice(-6);
}
function fcfTag(a, b) {  // 직전 분기 a → 이번 분기 b
  return a >= 0 && b < 0 ? ["적자 전환", "bad"] : a < 0 && b < 0 ? (b < a ? ["적자 폭 확대", "bad"] : ["적자 폭 축소", "warn"])
    : a < 0 ? ["흑자 전환", ""] : b >= a ? ["직전 분기보다 늘어남", ""] : ["직전 분기보다 줄어듦", "warn"];
}
function fcfBars(d, k) {
  const s = fcfSeries(d, k), usd = d.currency === "USD";
  if (s.length < 2) return "";
  const [t, cls] = fcfTag(s.at(-2).fcf, s.at(-1).fcf), cx = s.filter((x) => x.capex != null).at(-1);
  const sub = `영업현금흐름 − 설비투자(CapEx)${cx ? ` · ${esc(cx.q)} CapEx ${qMoney(Math.abs(cx.capex), usd)}` : ""}${s.some((x) => x.add) ? ` · ${s.filter((x) => x.add).map((x) => esc(x.q)).join("·")} 는 보도자료 숫자 (야후 반영 전)` : ""}`;
  return kqBars("💸 현금흐름 (FCF)", s.map((x) => ({ q: x.q, fcf: usd ? x.fcf : x.fcf / 1e8 })), "fcf", null, "var(--s1)", usd ? "USD" : "KRW",
    { tag: `<span class="qtag ${cls}">${t}</span>`, sub });
}
// 🔁 반복되는 패턴 메모 (kpi.yaml patterns): 예전 같은 일 → 그 뒤 숫자 흐름 → 이번 · 다음에 확인할 것 · 확인 결과
function patternHTML(p) {
  const li = (x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`;
  return `<div class="warnbox" style="margin-top:8px"><b>🔁 ${esc(p.t)}</b> <span class="src">${esc(p.date || "")}</span>
    ${(p.steps || []).length ? `<div style="margin-top:4px">${p.steps.map((s) => `<b>${esc(s.q)}</b> ${esc(s.v)}${s.note ? ` <span class="src">(${esc(s.note)})</span>` : ""}`).join(" → ")}</div>` : ""}
    <ul class="irl">${(p.lines || []).map(li).join("")}</ul>
    ${p.check ? `<div>👀 <b>확인할 때</b>: ${esc(p.check)}</div>` : ""}${p.result ? `<div>✅ <b>결과</b>: ${esc(p.result)}</div>` : ""}
    ${p.src ? `<div class="src" style="margin-top:4px">출처: ${esc(p.src)}</div>` : ""}</div>`;
}
// 1년 전 같은 분기(±20일)와 비교한 성장률 {달력 분기: %} — 결산 달이 다른 회사(엔비디아·마이크론)도 '끝나기 45일 전'이 든 달력 분기로 맞춤
function yoyOf(rows) {
  const T = (e) => new Date(e).getTime(), out = {};
  const cq = (e) => { const t = new Date(T(e) - 45 * 864e5); return `${String(t.getFullYear()).slice(2)}.${Math.floor(t.getMonth() / 3) + 1}Q`; };
  for (const [e, v] of [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const p = rows.find(([e2]) => Math.abs(T(e) - 365.25 * 864e5 - T(e2)) < 20 * 864e5);
    if (p && p[1] > 0 && v != null) out[cq(e)] = rnd1((v / p[1] - 1) * 100);
  }
  return out;
}
const last6 = (o) => Object.fromEntries(Object.entries(o).slice(-6));
// ⭐ 성장률 한눈에 (애플·팔란티어 요약 그림처럼): 매출 성장률 · 매출총이익률 · 영업이익률 · 제품별 · 지역별 (+ 고객·부문 비중)
// 숫자는 자동(10년 분기 실적·segments.yaml) — 별표·가이던스·지역·조정 이익률은 config/growth.yaml, 📍 변곡점·🐣 설명은 여기서 계산
let GROWTH = null;
const GROW_RE = /^매출 성장률|지역별 성장률|해외 매출 성장률|국내·해외 매출 성장률/;  // kpi.yaml 의 이 그래프는 🔑 핵심 지표 대신 이 칸에
const agoQ = (q) => `${String(+q.slice(0, 2) - 1).padStart(2, "0")}${q.slice(2)}`;  // '26.3Q' → '25.3Q'
function revYoy(d) {  // 10년 분기 실적 (키 = 달력 분기 '26.3Q') — 없으면 야후 분기 실적
  const L = d.longq || {}, v = {};
  for (const q of Object.keys(L).sort()) { const p = L[agoQ(q)]; if (p?.rev > 0 && L[q].rev != null) v[q] = rnd1((L[q].rev / p.rev - 1) * 100); }
  return last6(Object.keys(v).length >= 2 ? v : yoyOf(Object.entries(d.qtrs || {}).filter(([, q]) => q.rev).map(([e, q]) => [e, q.rev])));
}
function margin(d, key) {  // 매출총이익률(gp)·영업이익률(op) {분기: %}
  const L = d.longq || {};
  return last6(Object.fromEntries(Object.keys(L).sort().filter((q) => L[q].rev > 0 && L[q][key] != null).map((q) => [q, rnd1((L[q][key] / L[q].rev) * 100)])));
}
// 📍 변곡점: 오르다 1~2분기 전 꼭대기를 찍고 내려오면 '고점 찍고 둔화', 내리다 바닥에서 오르면 '바닥 찍고 반등', 0 을 넘나들면 '플러스·역성장 전환'
// 그 밖엔 'n분기 연속 가속·둔화' (th/2 보다 작은 움직임은 제자리로 봄)
function turnOf(v, th, w, zero) {  // v = {분기: 값}, th = 의미 있는 변화(%p), w = ["가속","둔화"]|["상승","하락"], zero = 0 을 넘나드는 걸 볼지(성장률)
  const x = Object.values(v).filter((y) => y != null), n = x.length;
  if (n < 2) return null;
  const a = x[n - 1], b = x[n - 2], d1 = a - b, o = { a, b, f: b, up: d1 >= 0, pt: false };
  if (zero && b < 0 && a >= 0) return { ...o, t: "플러스 전환", pt: true };
  if (zero && b >= 0 && a < 0) return { ...o, t: "역성장 전환", pt: true };
  if (zero) th = Math.max(th, Math.max(...x.map(Math.abs)) * 0.1);  // 성장률이 100%대면 3%p 흔들림은 잡음
  const sg = (i) => { const dd = x[i] - x[i - 1]; return Math.abs(dd) < th / 2 ? 0 : Math.sign(dd); };
  const hist = x.slice(0, -1), ex = d1 < 0 ? Math.max(...hist) : Math.min(...hist), p = hist.lastIndexOf(ex);
  const into = p >= 1 && (d1 < 0 ? ex > x[p - 1] : ex < x[p - 1]);  // 오르다 찍은 꼭대기(내리다 찍은 바닥)인가
  if (into && n - 1 - p <= 2 && Math.abs(a - ex) >= th && Math.abs(d1) >= th / 2) return { ...o, f: ex, t: d1 < 0 ? `고점 찍고 ${w[1]}` : "바닥 찍고 반등", pt: true };
  if (sg(n - 1) === 0) return { ...o, t: a >= Math.max(...x) - th / 2 ? "최고 수준 유지" : a <= Math.min(...x) + th / 2 ? "최저 수준 머묾" : "비슷한 흐름" };
  let k = 1;
  while (n - 1 - k >= 1 && sg(n - 1 - k) === sg(n - 1)) k++;
  return { ...o, t: k >= 2 ? `${k}분기 연속 ${w[d1 > 0 ? 0 : 1]}` : w[d1 > 0 ? 0 : 1] };
}
function growTag(t, bad) { return t ? `<span class="qtag${bad ? " bad" : ""}">${esc(t)}</span>` : ""; }
function guideOf(G, d, key, si = 0) {  // growth.yaml guide → 그래프 끝 점선 범위 {q, lo, hi, si} (연간 가이던스는 글로만)
  const x = G?.guide;
  if (!x || !/^\d\d\.\dQ$/.test(x.q || "")) return null;
  let r = x[key];
  if (key === "rev_yoy" && !r && x.rev) { const p = d.longq?.[agoQ(x.q)]?.rev; r = p > 0 ? x.rev.map((v) => rnd1((v / p - 1) * 100)) : null; }
  if (key === "opm" && !r && x.op && x.rev) r = x.op.map((v, i) => rnd1((v / x.rev[i]) * 100));  // 영업이익 금액으로 준 가이던스(아마존) → 이익률로 계산
  return r ? { q: x.q, lo: Math.min(...r), hi: Math.max(...r), si } : null;
}
// 💰 매출원가율·판관비율 + 판관비 쪼개 보기 (사용자 11/10, 한화 삼양 리포트처럼 광고선전비율·운반비율 — 모든 종목)
//   비율 = 10년 분기 실적(longq) · 쪼개기: 한국 = 전자공시 연결 주석 '판매비와관리비' 표 (tools/dart_sga.py, 억원), 미국 = 야후 분기 연구개발·판매마케팅·일반관리
const SGA_CAT = [["인건비", /급여|상여|퇴직|복리후생|주식보상|종업원|인건비/], ["광고·판촉비", /광고|판매촉진|판촉|마케팅|홍보|견본/],
  ["운반·물류비", /운반|운송|물류|수출제비|보관|배송/], ["연구개발비", /연구|개발비/], ["감가상각비", /^(?!.*대손).*상각/], ["수수료·용역비", /수수료|용역|위탁|외주/]];
function costCards(d, pts) {
  const L = d.longq || {}, usd = d.currency === "USD", out = [];
  const lq = Object.keys(L).sort().filter((q) => L[q].rev > 0 && L[q].gp != null && L[q].op != null).slice(-6);  // 매출총이익이 아직 없는 잠정 실적 분기는 빼고
  const cg = Object.fromEntries(lq.map((q) => [q, rnd1(100 - (L[q].gp / L[q].rev) * 100)]));
  const sg = Object.fromEntries(lq.map((q) => [q, rnd1(((L[q].gp - L[q].op) / L[q].rev) * 100)]));
  const sn = usd ? "판관비율 (연구개발 포함)" : "판관비율", tt = turnOf(sg, 0.8, ["상승", "하락"]);
  if (tt?.pt) pts.push(`${sn} <b>${esc(tt.t)}</b> (${n(tt.f, 1)}% → ${n(tt.a, 1)}%)`);
  if (Object.keys(cg).length >= 2) out.push(kpiChart({ t: "매출원가율 · 판관비율", u: "%", s: [{ n: "매출원가율", v: cg }, { n: sn, v: sg }], col: ["var(--s3)", "var(--s4)"],
    tag: tt ? growTag(`판관비율 ${tt.t}`, /상승|반등/.test(tt.t)) : "", why: "100원어치 팔 때 재료·생산비(원가)와 인건비·광고·운반비(판관비)로 몇 원 나가나 · 100 − 둘 = 영업이익률" }));
  // 쪼개기 {분기: {묶음: 금액}} — 한국 억원(DART), 미국 달러(야후 qtrs, 분기 끝 날짜 → '26.3Q')
  const parts = {}, names = {};
  if (d.sga?.q) for (const [q, it] of Object.entries(d.sga.q)) {
    parts[q] = {};
    for (const [nm, v] of Object.entries(it)) {
      const c = (SGA_CAT.find(([, re]) => re.test(nm)) || ["기타"])[0];
      parts[q][c] = (parts[q][c] || 0) + v;
      (names[c] ??= new Set()).add(nm.replace(/,\s*판관비$/, ""));
    }
  } else if (usd) for (const [e, x] of Object.entries(d.qtrs || {})) {
    if (!x.rev || (x.rnd == null && x.sm == null && x.ga == null)) continue;
    parts[`${e.slice(2, 4)}.${Math.ceil(+e.slice(5, 7) / 3)}Q`] = { 연구개발비: x.rnd || 0, "판매·마케팅비": x.sm || 0, 일반관리비: x.ga || 0, rev: x.rev };
  }
  const rev = (q) => (usd && !d.sga ? parts[q].rev : L[q]?.rev);
  const qs = Object.keys(parts).filter((q) => rev(q) > 0).sort().slice(-6);
  if (qs.length < 2) return out;
  const cats = [...new Set(qs.flatMap((q) => Object.keys(parts[q])))].filter((c) => c !== "rev" && (parts[qs.at(-1)][c] || 0) / rev(qs.at(-1)) >= 0.003)  // 매출의 0.3% 넘는 묶음만
    .sort((a, b) => (parts[qs.at(-1)][b] || 0) - (parts[qs.at(-1)][a] || 0));
  const s = cats.slice(0, 7).map((c) => ({ n: c, v: Object.fromEntries(qs.map((q) => [q, parts[q][c] == null ? null : rnd1((parts[q][c] / rev(q)) * 100)])) }));
  const grp = ["운반·물류비", "광고·판촉비", "수수료·용역비"].filter((c) => names[c]).map((c) => `${c} = ${[...names[c]].slice(0, 4).join("·")}`).join(" · ");
  out.push(kpiChart({ t: "판관비 쪼개 보기 (매출 대비 %)", u: "%", s, col: ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s7)", "var(--muted)", "var(--ink-2)"],
    why: d.sga ? `전자공시(DART) 연결 주석 판관비 표 · 손익계산서와 15% 넘게 안 맞는 분기는 뺌${grp ? ` · ${grp}` : ""}` : "야후 분기 실적 (회사가 나눈 연구개발·판매마케팅·일반관리비)" }));
  return out;
}
function growAllHTML(code, d, k) {
  const G = GROWTH?.[code] || GROWTH?.[KPI_ALIAS[code]] || {}, st = new Set((G.star || []).map((s) => s.split(":")[0]));
  const starLine = (kind) => (G.star || []).filter((s) => s.startsWith(kind + ":")).map((s) => s.slice(kind.length + 1));
  const pts = [], cards = [];  // pts = 📍 변곡점 한 줄씩
  const pp = (a, b) => `${n(b, 1)}% → ${n(a, 1)}%`;
  // ① 매출 성장률 — kpi.yaml 에 직접 적은 그래프가 있으면 그것
  const kRev = k.charts.find((c) => /^매출 성장률/.test(c.t)), rv = kRev ? kRev.s[0]?.v || {} : revYoy(d), rg = guideOf(G, d, "rev_yoy");
  const rt = turnOf(rv, 2, ["가속", "둔화"], true), last = Object.keys(rv).sort().at(-1);
  if (rt?.pt) pts.push(`매출 성장률 <b>${esc(rt.t)}</b> (${pp(rt.a, rt.f)})`);
  const rgT = rg && rt ? ((rg.lo + rg.hi) / 2 < rt.a - 2 ? "성장 둔화 전망" : (rg.lo + rg.hi) / 2 > rt.a + 2 ? "성장 가속 전망" : "비슷한 성장 전망") : null;
  cards.push(kpiChart({ ...(kRev || {}), t: "매출 성장률 (YoY)", u: "%", s: [{ n: "매출", v: rv }], g: rg, star: st.has("rev"), col: ["var(--s1)"],
    tag: growTag(rgT || (rt && `성장 ${rt.t}`), /둔화|역성장/.test(rgT || rt?.t || "")),
    why: kRev?.why || "1년 전 같은 분기보다 매출이 얼마나 늘었나 · 분기 실적으로 자동" }));
  // ② 매출총이익률 ③ 영업이익률 (회사 '조정' 숫자가 있으면 선 두 개)
  const mg = (key, t, col, gk, extra) => {
    const v = margin(d, key), s = [{ n: extra ? "회계 기준" : t, v }, ...(extra ? [{ n: "회사 조정", v: last6(extra) }] : [])];
    if (Object.keys(v).length < 2) return;
    const main = extra ? s[1].v : v, tt = turnOf(main, 0.8, ["상승", "하락"]), gd = guideOf(G, d, extra ? "adj_opm" : gk, extra ? 1 : 0);
    if (tt?.pt) pts.push(`${extra ? "조정 " : ""}${t} <b>${esc(tt.t)}</b> (${pp(tt.a, tt.f)})`);
    const gT = gd && tt ? ((gd.lo + gd.hi) / 2 < tt.a - 0.8 ? "마진 하락 전망" : (gd.lo + gd.hi) / 2 > tt.a + 0.8 ? "마진 상승 전망" : "마진 유지 전망") : null;
    cards.push(kpiChart({ t, u: "%", s, g: gd, star: st.has(gk), col: extra ? [col, "var(--s3)"] : [col],
      tag: growTag(gT || (tt && `마진 ${tt.t}`), /하락/.test(gT || tt?.t || "")),
      why: key === "gp" ? "100원어치 팔아 재료·생산비를 빼고 남는 돈" : `인건비·광고·연구비까지 빼고 남는 돈${extra ? " · 회사 조정 = 주식 보상 비용 등을 뺀 숫자 (회사가 이걸로 말함)" : ""}` }));
  };
  mg("gp", "매출총이익률", "var(--s2)", "gm");
  mg("op", "영업이익률", "var(--s4)", "opm", G.adj_opm);
  cards.push(...costCards(d, pts));
  // ④ 제품·부문별 성장률 (segments.yaml 금액, 비중 3% 넘는 큰 제품 5개까지)
  const ps = segPeriods(d.seg);
  if (ps.length) {
    const col = segColors(ps), lastS = ps.at(-1)[1], sl = starLine("prod");
    const yo = ps.map(([q, , a]) => [q, a, segAgo(ps, q)?.[2]]).filter(([, a, p]) => a && p);
    const top = Object.keys(col).filter((s) => lastS[s] >= 3).slice(0, 5);
    const s = top.map((nm) => ({ n: nm, star: sl.includes(nm), v: Object.fromEntries(yo.filter(([, a, p]) => p[nm] > 0 && a[nm] != null).map(([q, a, p]) => [segQ(q), rnd1((a[nm] / p[nm] - 1) * 100)])) }));
    if (yo.length >= 2) cards.push(multiCard("제품·부문별 성장률 (YoY)", s, top.map((nm) => col[nm]), st.has("prod"), "부문", pts));
    // ⑥ 고객·부문 비중 — 1등이 바뀌면 변곡점 ('상업 첫 추월')
    if (st.has("mix") && ps.length >= 2) {
      const P = ps.slice(-6), names = Object.keys(col).slice(0, 3), lead = (sh) => Object.keys(sh).sort((a, b) => sh[b] - sh[a])[0];
      const now = lead(P.at(-1)[1]), was = lead(P.at(-2)[1]), first = !P.slice(0, -1).some(([, sh]) => lead(sh) === now);
      const tag = now !== was ? `${now} ${first ? "첫" : "다시"} 추월` : `${now} 비중 1위 유지`;
      if (now !== was) pts.push(`고객·부문 비중 <b>${esc(now)}이 ${esc(was)} 추월</b>${first ? ` (최근 ${P.length}분기 중 처음)` : ""} (${n(P.at(-1)[1][now], 1)}% vs ${n(P.at(-1)[1][was], 1)}%)`);
      cards.push(kpiChart({ t: "고객·부문 비중", u: "%", col: names.map((nm) => col[nm]), star: true, tag: growTag(tag, false),
        s: names.map((nm) => ({ n: nm, v: Object.fromEntries(P.map(([q, sh]) => [segQ(q), rnd1(sh[nm] || 0)])) })), why: "매출 100 중 몇이 어디서 나오나" }));
    }
  }
  // ⑤ 지역별 성장률: growth.yaml region → 없으면 kpi.yaml 의 지역·해외 성장률 그래프
  const kReg = k.charts.find((c) => /지역별 성장률|해외 매출 성장률|국내·해외 매출 성장률/.test(c.t));
  const reg = G.region ? Object.entries(G.region).map(([nm, v]) => ({ n: nm, v: last6(Object.fromEntries(Object.entries(v).sort())) })) : kReg?.s;
  if (reg?.length) {
    const sl = starLine("region");
    cards.push(multiCard("지역별 매출 성장률 (YoY)", reg.map((s) => ({ ...s, star: sl.includes(s.n) })), null, st.has("region"), "지역", pts, G.region_src || kReg?.why));
  }
  if (!cards.some(Boolean)) return "";
  // 🧭 가이던스 줄 + 🐣 쉬운 설명 (숫자 → 그림 → 🐣)
  const usd = d.currency === "USD", x = G.guide, gTxt = x ? [x.rev_yoy && `매출 ${pct(x.rev_yoy[0], 0, true)}~${n(x.rev_yoy[1], 0)}%`,
    x.rev && `매출 ${usd ? (x.rev[1] < 1e4 ? `$${n(x.rev[0])}~${n(x.rev[1])}M` : `$${n(x.rev[0] / 1e3, 1)}~${n(x.rev[1] / 1e3, 1)}B`) :`${kpiF(x.rev[0], "억원")}~${kpiF(x.rev[1], "억원")}`}${rg ? ` (YoY ${pct(rg.lo, 0, true)}~${n(rg.hi, 0)}%)` : ""}`,
    x.gm && `매출총이익률 ${[...new Set(x.gm)].join("~")}%`, x.opm && `영업이익률 ${x.opm.join("~")}%`, x.adj_opm && `조정 영업이익률 ${x.adj_opm.join("~")}%`,
    x.op && `영업이익 ${usd ? `$${n(x.op[0] / 1e3, 1)}~${n(x.op[1] / 1e3, 1)}B` : `${kpiF(x.op[0], "억원")}~${kpiF(x.op[1], "억원")}`}${x.rev ? " (그래프 이익률은 이걸로 계산)" : ""}`,
    x.affo && `주당 AFFO $${x.affo.join("~")}`].filter(Boolean).join(" · ") || "숫자 가이던스 없음" : "";
  const gmv = margin(d, "gp"), opv = margin(d, "op"), gl = Object.values(gmv).at(-1), ol = Object.values(opv).at(-1);
  const kid = [rt && `매출이 1년 전 같은 때보다 ${n(Math.abs(rt.a), 1)}% ${rt.a >= 0 ? "늘었어요" : "줄었어요"}${Math.abs(rt.a - rt.b) >= 1 ? ` — 늘어나는 속도는 ${rt.a > rt.b ? "빨라졌어요" : "느려졌어요"} (${pp(rt.a, rt.b)})` : ""}.`,
    gl != null && `100원어치 팔면 재료·생산비를 빼고 ${n(gl, 0)}원이 남고${ol != null ? `, 인건비·광고비까지 빼면 ${n(ol, 0)}원이 남아요` : "요"}.`,
    rgT && `회사는 다음 분기에 ${rgT.replace(" 전망", "")}을 예상했어요 (가이던스).`].filter(Boolean).join(" ");
  return `<h3>⭐ 성장률 한눈에 <span class="src">${esc(last || "")}까지 · 실적이 나오면 자동으로 이어 그려요 · ⭐ = 이 회사 주가를 가장 움직이는 칸</span></h3><div class="card">
    ${G.why ? `<div class="note" style="margin-top:0">⭐ <b>이 회사 핵심</b>: ${esc(G.why)}</div>` : ""}
    ${G.once ? `<div class="note" style="color:var(--warn-ink);font-weight:600">⚠ 한 번만 있는 일: ${esc(G.once)}</div>` : ""}
    <div class="note">📍 <b>변곡점</b>:${pts.length ? pts.slice(0, 6).join(" · ") + (pts.length > 6 ? ` <span class="src">외 ${pts.length - 6}개는 그래프 꼬리표에</span>` : "") : "이번 분기는 큰 방향 전환 없음 (흐름 그대로)"}</div>
    ${gTxt ? `<div class="note">🧭 <b>회사 가이던스${x.q ? ` (${esc(x.q)})` : ""}</b>:${gTxt}${x.note ? ` <span class="src">${esc(x.note)}</span>` : ""} <span class="src">${esc(x.date || "")}${x.src ? ` · <a href="${esc(x.src)}" target="_blank" rel="noopener">원문</a>` : ""}</span></div>` : ""}
    <div class="qgrid" style="margin-top:8px">${cards.join("")}</div>
    ${kid ? `<div class="kidbox" style="margin-top:8px">🐣 ${kid}</div>` : ""}</div>`;
}
// 선 여러 개 (제품별·지역별 성장률): 꼬리표 = '전 부문 둔화' · 'A·B 역성장' · 별표 선 상태, 꺾인 선은 📍 에
function multiCard(t, s, col, star, word, pts, why) {
  col = col || ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s7)", "var(--muted)", "var(--ink-2)"];  // 지역이 7개여도 색이 겹치지 않게
  const tr =s.map((x) => [x.n, turnOf(x.v || {}, 3, ["가속", "둔화"], true), x.star]).filter(([, r]) => r);
  if (!tr.length) return kpiChart({ t, u: "%", s, col, star, why });
  const neg = tr.filter(([, r]) => r.a < 0).map(([nm]) => cut(nm, 6)), dn = tr.filter(([, r]) => !r.up).length;
  tr.filter(([, r]) => r.pt).forEach(([nm, r]) => pts.push(`${esc(nm)} 성장률 <b>${esc(r.t)}</b> (${n(r.f, 1)}% → ${n(r.a, 1)}%)`));
  const sr = tr.find(([, , st]) => st);
  const tag = [dn === tr.length && tr.length > 1 ? `전 ${word} 성장 둔화` : dn === 0 && tr.length > 1 ? `전 ${word} 성장 가속` : sr ? `${cut(sr[0], 6)} ${sr[1].t}` : "",
    neg.length ? `${neg.join("·")} 역성장` : ""].filter(Boolean).join(" · ");
  return kpiChart({ t, u: "%", s, col, star, why, tag: growTag(tag, /둔화|역성장/.test(tag)) });
}
// 📉 주식 수 증가율 (YoY): 새 주식을 찍으면(증자·주식 보상·전환사채 전환) 이익이 그대로여도 한 주당 몫(EPS)이 줄어요 — 모든 종목
function dilHTML(d) {
  const S = d.shq, v = last6(yoyOf(Object.entries(S?.q || {}))), ks = Object.keys(v);
  if (ks.length < 2) return "";
  const g = v[ks.at(-1)], eps = (1 / (1 + g / 100) - 1) * 100;
  const kid = Math.abs(g) < 0.5 ? "1년 전과 주식 수가 거의 같아요 — 한 주가 가져가는 몫이 묽어지지 않았어요."
    : g > 0 ? `1년 새 주식이 ${n(g, 1)}% 늘었어요. 회사 이익이 그대로여도 한 주가 가져가는 몫(EPS)은 약 ${n(-eps, 1)}% 줄어요. 새 주식을 찍어 돈을 모으거나(증자) 직원에게 주식으로 월급을 주면 이렇게 돼요.`
    : `1년 새 주식이 ${n(-g, 1)}% 줄었어요 (자사주를 사서 없앰). 이익이 그대로여도 한 주가 가져가는 몫은 약 ${n(eps, 1)}% 늘어요.`;
  return kpiChart({ t: S.src === "dart" ? "주식 수 증가율 (YoY)" : "희석주식수 증가율 (YoY)", u: "%", s: [{ n: "주식 수", v }], kid,
    why: S.src === "dart" ? "보통주 유통주식수 (발행 − 자사주, 분기 말) · DART 분기·반기·사업보고서 — 3분기 보고서는 11월 중순"
      : "희석 가중평균 주식 수 (주식 보상·전환사채 포함) · 최근 분기 야후, 예전 분기 SEC (예전 4분기는 연간·9개월 평균으로 계산한 근사값)",
    note: g >= 5 ? "⚠ 1년 새 5% 넘게 늘었어요 — 증자·주식 보상이 이익 성장을 깎아 먹는지 확인" : "" });
}
// 👥 직원 수 (data/employees.json ← collector/employees.py): AI 시대엔 직원이 늘어나는지·줄어드는지 + 1인당 매출 — 모든 종목
let EMP = null;
function empHTML(d) {
  const e = EMP?.stocks?.[d.code] || EMP?.stocks?.[KPI_ALIAS[d.code]], pts = Object.entries(e?.pts || {}).sort();
  if (pts.length < 2) return "";
  const yearly = new Set(pts.map(([ds]) => ds.slice(5, 7))).size === 1;  // 한 해 한 번(미국 회계연도 말)이면 칸 이름은 연도만
  const big = Math.max(...pts.map((p) => p[1])) >= 1e4, lab = (ds) => (yearly ? ds.slice(0, 4) : `${ds.slice(2, 4)}.${ds.slice(5, 7)}`);  // 1만 명 넘으면 '만명'으로 (막대 위 글자가 겹치지 않게)
  const v = Object.fromEntries(pts.map(([ds, x]) => [lab(ds), big ? x / 1e4 : x]));
  const [d1, n1] = pts.at(-1), prev = pts.filter(([ds]) => ds <= `${+d1.slice(0, 4) - 1}${d1.slice(4)}`).at(-1), yoy = prev ? (n1 / prev[1] - 1) * 100 : null;
  const usd = d.currency === "USD", L = d.longq || {}, revY = (y) => { const q = [1, 2, 3, 4].map((k) => L[`${String(y).slice(2)}.${k}Q`]?.rev); return q.every((x) => x != null) ? q.reduce((a, x) => a + x, 0) : null; };
  const yE = +d1.slice(0, 4) - (+d1.slice(5, 7) < 12 ? 1 : 0), per = (y) => { const r = revY(y), p = pts.filter(([ds]) => ds.startsWith(String(y))).at(-1) || pts.filter(([ds]) => ds.startsWith(String(y + 1))).at(0); return r && p ? r / p[1] : null; };
  const p1 = per(yE), p0 = per(yE - 1), pf = (x) => (usd ? `$${n(x * 1e6 / 1e3, 0)}K` : `${n(x, 1)}억원`);
  const note = p1 ? `1인당 매출 ${yE}년 ${pf(p1)}${p0 ? ` (1년 전 ${pf(p0)}, ${pct((p1 / p0 - 1) * 100, 0, true)})` : ""}` : "";
  return kpiStack({ kind: "stack", t: `👥 직원 수 ${big ? n(n1 / 1e4, 1) + "만" : n(n1)}명${yoy != null ? ` · 1년 새 ${pct(yoy, 1, true)}` : ""}`, u: big ? "만" : "명", s: [{ n: "직원 수", v }],
    why: `${e.src || ""}${e.stale ? " · 이번엔 못 받아 직전 값" : ""} · 날짜 = 회계연도 말(한국은 12월 말·6월 말)`, note,
    kid: "AI 로 같은 일을 더 적은 사람이 하게 되면, 직원 수는 그대로거나 줄어도 매출은 늘어요. 그래서 직원 수와 '1인당 매출'이 같이 오르는지(혹은 직원은 줄고 1인당 매출은 오르는지)가 AI 시대의 핵심 신호예요." });
}
async function growthBlock(code, d) {  // kpiBlock 다음에 부름 (KPI 를 씀)
  if (GROWTH === null) { try { GROWTH = (await (await fetch("data/growth.json?v=" + encodeURIComponent(DASH.updated_at))).json()) || {}; } catch (_) { GROWTH = {}; } }
  return growAllHTML(code, d, KPI?.[code] || KPI?.[KPI_ALIAS[code]] || { charts: [] });
}
async function kpiBlock(code, d) {
  if (KPI === null) { try { KPI = (await (await fetch("data/kpi.json?v=" + encodeURIComponent(DASH.updated_at))).json()) || {}; } catch (_) { KPI = {}; } }
  if (EMP === null) { try { EMP = (await (await fetch("data/employees.json?t=" + Date.now(), { cache: "no-store" })).json()) || {}; } catch (_) { EMP = {}; } }
  const k = KPI[code] || KPI[KPI_ALIAS[code]] || { charts: [], auto: true };  // kpi.yaml 에 없는 종목도 자동 그림(손익·현금흐름·주식 수)은 보여 줌
  const ch = k.charts.filter((c) => !GROW_RE.test(c.t)).map(kpiChart);  // 매출·지역 성장률은 ⭐ 성장률 한눈에 로
  ch.unshift(comboHTML(d));  // 맨 앞: 분기 매출·영업이익·영업이익률
  ch.splice(2, 0, opYoyHTML(d, k), fcfBars(d, k), dilHTML(d), empHTML(d), annualOpmHTML(d));  // 그다음 영업이익 성장률 · 현금흐름 · 주식 수 증가율 · 직원 수 · 연간 매출 & 영업이익률
  if (!ch.some(Boolean)) return "";
  return `<h3>🔑 핵심 지표 <span class="src">${k.auto ? "자동 계산 — 분기 실적·현금흐름·주식 수 (사업부별 숫자는 아직 안 넣음)" : `${esc(k.latest || "")}까지 · 실적발표·컨퍼런스콜·전자공시에서 옮김`}</span></h3><div class="card kpi">
    ${k.key ? `<div class="note" style="margin-top:0"><b>주가를 움직이는 열쇠:</b> ${esc(k.key)}</div>` : ""}
    ${(k.patterns || []).map(patternHTML).join("")}
    <div class="qgrid" style="margin-top:8px">${ch.join("")}</div>
    ${ordersGuideHTML(k, d)}
    ${k.memo ? `<div class="note src">${esc(k.memo)}</div>` : ""}
    ${k.src?.length ? `<div class="note src">출처: ${k.src.map((s) => (s.u ? `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>` : esc(s.t))).join(" · ")}</div>` : ""}
  </div>`;
}
// 🎯 사업부문별 컨센서스(예상) vs 실적 (config/seg_cons.yaml) — 실적이 비어 있으면 '다음 실적 전에 볼 예상치'
function segcHTML(d) {
  const sc = d.segc;
  if (!sc) return "";
  const du = d.currency === "USD" ? "$B" : "억원";
  const F = (v, u) => (v == null ? "-" : u === "$" ? "$" + n(v, 2) : kpiF(v, u));
  return Object.keys(sc).sort().reverse().slice(0, 2).map((q) => {
    const x = sc[q], done = (x.items || []).some((i) => i.act != null);
    const rows = (x.items || []).map((i) => {
      const u = i.u || du, has = i.act != null && i.est != null;
      const diff = !has ? "" : i.est > 0 ? pct((i.act / i.est - 1) * 100, 1, true) : (i.act - i.est >= 0 ? "+" : "") + F(rnd1(i.act - i.est), u);
      const tag = !has ? "" : i.neutral ? `<span class="src">${i.act > i.est ? "예상보다 많음" : "예상보다 적음"}</span>`
        : i.act >= i.est ? '<span class="qtag">상회</span>' : '<span class="qtag bad">하회</span>';
      return `<tr><td style="text-align:left">${esc(i.n)}</td><td>${F(i.est, u)}</td>${done ? `<td><b>${F(i.act, u)}</b></td><td>${diff}</td><td>${tag}</td>` : ""}</tr>`;
    }).join("");
    return `<h3>🎯 ${esc(q)} 사업부문별 ${done ? "예상 vs 실적" : "예상 <span class=\"src\">발표 전에 살펴보세요</span>"}</h3><div class="card segc">
      <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">항목</th><th>예상</th>${done ? "<th>실적</th><th>예상 대비</th><th></th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>
      ${x.memo ? `<div class="note src">${esc(x.memo)}</div>` : ""}<div class="note src">출처: ${esc(x.src || "")}</div></div>`;
  }).join("");
}
// 🏗 빅테크 CapEx (마이크로소프트·알파벳·메타·아마존): 데이터센터 투자가 늘어야 메모리(삼성전자·SK하이닉스)를 더 사요
let CAPEX = null;
function capexHTML() {
  const cs = CAPEX?.cos || [];
  if (!cs.length) return "";
  const qs = [...new Set(cs.flatMap((c) => Object.keys(c.q)))].sort().slice(-6);
  const gaps = qs.map((q) => [q, cs.filter((c) => c.q[q] == null).map((c) => c.name)]).filter(([, m]) => m.length);
  const tot = (q) => cs.reduce((a, c) => a + (c.q[q] || 0), 0), full = (q) => cs.every((c) => c.q[q] != null);
  const ago = (q) => `${String(+q.slice(0, 2) - 1).padStart(2, "0")}${q.slice(2)}`;
  const lq = [...qs].reverse().find(full), yoy = lq && full(ago(lq)) ? (tot(lq) / tot(ago(lq)) - 1) * 100 : null;
  const chart = kpiStack({ t: "빅테크 4곳 분기 CapEx (설비투자)", u: "$B", s: cs.map((c) => ({ n: c.name, v: Object.fromEntries(qs.filter((q) => c.q[q] != null).map((q) => [q, c.q[q]])) })),
    tag: yoy == null ? "" : `<span class="qtag${yoy < 0 ? " bad" : ""}">${esc(lq)} 합계 1년 전 대비 ${pct(yoy, 0, true)}</span>`,
    why: "데이터센터 투자가 늘어야 메모리(삼성전자·SK하이닉스)를 더 사요", note: gaps.length ? gaps.map(([q, m]) => `${q} ${m.join("·")} 빠짐`).join(" · ") + " (발표 전·야후 반영 전)" : "" });
  const rows = cs.map((c) => {
    const k = Object.keys(c.q).sort().at(-1), v = c.q[k], p = c.q[ago(k)];
    return `<tr><td style="text-align:left">${esc(c.name)}</td><td>${esc(k)}</td><td><b>$${n(v, 1)}B</b></td><td>${p ? pct((v / p - 1) * 100, 0, true) : "-"}</td></tr>`;
  }).join("");
  return `<h3>🏗 빅테크 CapEx <span class="src">${esc(CAPEX.updated_at || "")}</span></h3><div class="card">
    ${peakHTML()}
    <div class="qgrid">${chart}${capexGuideSVG(CAPEX.guide)}${peakChart()}</div>
    ${capexConsHTML()}
    <div class="tbl-wrap" style="margin-top:8px"><table class="compact"><thead><tr><th style="text-align:left">회사</th><th>최근 분기</th><th>CapEx (막대 기준)</th><th>1년 전 대비</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note src">${esc(CAPEX.src || "")} · 막대는 현금으로 나간 설비투자(야후 기준). 마이크로소프트가 발표하는 CapEx 는 금융리스를 더한 숫자라 더 커요</div></div>`;
}
// 🎯 CapEx 컨센 대비 (kpi.yaml capex_cons · capex_guide cons): ① 분기 발표 vs 컨센 ② 올해 가이던스 vs 컨센 — hi = 종목 상세에서 굵게 볼 회사
function capexConsHTML(hi) {
  const cs = CAPEX?.cos || [], gs = (CAPEX?.guide || []).filter((g) => g.pts.at(-1)?.cons);
  const q = [...new Set(cs.flatMap((c) => Object.keys(c.est || {})))].sort().reverse().find((k) => cs.every((c) => c.est?.[k]?.act != null));
  if (!q && !gs.length) return "";
  const B = (v, d = 2) => `${v < 0 ? "-" : ""}$${n(Math.abs(v), d)}B`, rng = (p) => (p.lo === p.hi ? B(p.lo, 0) : `$${n(p.lo, 0)}~${n(p.hi, 0)}B`), mid = (p) => (p.lo + p.hi) / 2;
  const nm = (t, name) => (t === hi ? `👉 <b>${esc(name)}</b>` : esc(name));
  const gap = (a, e) => `${pct((a / e - 1) * 100, 1, true)} <span class="src">${a >= e ? "▲ 더" : "▼ 덜"}</span>`;
  const sum = (a) => a.reduce((x, y) => x + y, 0), who = (a, up) => a.filter(([, g]) => (up ? g >= 0 : g < 0)).map(([c, g]) => `${esc(c)} ${pct(g, 0, true)}`).join(", ");
  let out = "";
  if (q) {
    const r = cs.map((c) => [c, c.est[q]]), sa = sum(r.map(([, e]) => e.act)), se = sum(r.map(([, e]) => e.est)), gq = r.map(([c, e]) => [c.name, (e.act / e.est - 1) * 100]);
    out += `<div class="chart-title" style="margin-top:10px"><b>🎯 ${esc(q)} 분기 CapEx — 발표 vs 컨센</b> <span class="src">많고 적음이 좋고 나쁨은 아님 · 메모리·장비 회사엔 '더 쓴 곳'이 수요</span></div>
      <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">회사</th><th>발표</th><th>컨센</th><th>컨센 대비</th></tr></thead><tbody>
      ${r.map(([c, e]) => `<tr><td style="text-align:left">${nm(c.t, c.name)}${(e.s || "").includes(" · ") ? `<br><span class="src">${esc(e.s.split(" · ").slice(1).join(" · "))}</span>` : ""}</td><td><b>${B(e.act)}</b></td><td>${B(e.est)}</td><td>${gap(e.act, e.est)}</td></tr>`).join("")}
      <tr><td style="text-align:left"><b>4곳 합계</b></td><td><b>${B(sa)}</b></td><td>${B(se)}</td><td><b>${gap(sa, se)}</b></td></tr></tbody></table></div>
      <div class="src">더 씀: ${who(gq, true) || "없음"} · 덜 씀: ${who(gq, false) || "없음"}</div>`;
  }
  if (gs.length) {
    const r = gs.map((g) => [g, g.pts.at(-1), g.pts.at(-2)]), sa = sum(r.map(([, p]) => mid(p))), se = sum(r.map(([, p]) => p.cons));
    const big = [...r].sort((a, b) => Math.abs(mid(b[1]) - b[1].cons) - Math.abs(mid(a[1]) - a[1].cons))[0];
    out += `<div class="chart-title" style="margin-top:10px"><b>🎯 ${esc(r[0][1].y || "")}년 CapEx 가이던스 — 회사 계획 vs 컨센</b> <span class="src">${esc(r[0][1].q)} 발표 · 범위면 가운데 값으로 비교</span></div>
      <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">회사</th><th>직전 → 이번</th><th></th><th>컨센</th><th>컨센 대비</th></tr></thead><tbody>
      ${r.map(([g, p, pp]) => `<tr><td style="text-align:left">${nm(g.t, g.name)}</td><td>${pp ? `${rng(pp)} → ` : ""}<b>${rng(p)}</b></td><td><span class="qtag${/하향|감소/.test(p.how) ? " bad" : /상향/.test(p.how) ? "" : " muted"}">${esc(p.how || "")}</span></td><td>${B(p.cons, 0)}</td><td>${gap(mid(p), p.cons)}</td></tr>`).join("")}
      <tr><td style="text-align:left"><b>${r.length}곳 합계</b></td><td><b>${B(sa, 0)}</b></td><td></td><td>${B(se, 0)}</td><td><b>${gap(sa, se)}</b></td></tr></tbody></table></div>
      <div class="src">합계 차이 ${B(sa - se, 0)} 중 가장 큰 곳: ${esc(big[0].name)} ${B(mid(big[1]) - big[1].cons, 0)}</div>`;
  }
  const s = [...new Set(cs.map((c) => (c.est?.[q]?.s || "").split(" · ")[0]).filter(Boolean))].join(", ");
  return out + `<div class="note src">컨센 출처: ${esc(s || "-")} · 회사 발표 기준 숫자라 막대(야후 현금흐름표)와 조금 다를 수 있어요</div>`;
}
// 🏗 종목 상세: 빅테크 4곳이면 'CapEx 컨센 대비' (이 회사 줄을 👉 로)
async function capexBlock(code) {
  if (!["MSFT", "GOOG", "META", "AMZN"].includes(code)) return "";
  if (!CAPEX) { try { CAPEX = await (await fetch("data/capex.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { CAPEX = {}; } }
  const h = capexConsHTML(code);
  return h ? `<h3>🏗 빅테크 CapEx — 컨센 대비 <span class="src">4곳을 같이 봐야 흐름이 보여요 · ${esc(CAPEX.updated_at || "")}</span></h3><div class="card">${h}</div>` : "";
}
// 💸 M7 현금흐름(FCF) 추이 + 🏗 CapEx 가이던스 (🇺🇸 보유 탭, 실적 일정 아래) — 지금은 현금을 버는지가 가장 중요 (capex.json fcf · guide)
const M7_COL = ["var(--s1)", "var(--bad)", "var(--good)", "var(--warn)", "var(--s3)", "var(--s4)", "var(--ink-2)"];
function bigTechHTML() {
  if (MKT !== "US") return "";
  const fs = (CAPEX?.fcf || []).filter((c) => Object.keys(c.q).length >= 2);
  if (!fs.length) return "";
  const qs = [...new Set(fs.flatMap((c) => Object.keys(c.q)))].sort().slice(-8), cur = qs.at(-1);
  const chart = kpiChart({ t: "M7 분기 현금흐름 (FCF)", u: "$B", col: M7_COL, why: "영업으로 번 현금 − 설비투자 · 0 아래 = 번 돈보다 투자에 더 씀",
    s: fs.map((c) => ({ n: c.name, v: Object.fromEntries(qs.filter((q) => c.q[q] != null).map((q) => [q, c.q[q]])) })) });
  const rows = fs.map((c) => {
    const ks = Object.keys(c.q).sort(), k = ks.at(-1), v = c.q[k], p = c.q[ks.at(-2)];
    let down = 0; for (let i = ks.length - 1; i > 0 && c.q[ks[i]] < c.q[ks[i - 1]]; i--) down++;
    const tag = p >= 0 && v < 0 ? ["적자 전환", "bad"] : down >= 2 ? [`${down}분기 연속 악화`, "bad"] : p == null ? ["", ""] : fcfTag(p, v);
    return `<tr><td style="text-align:left">${esc(c.name)}</td><td>${esc(k)}${k < cur ? ` <span class="src">(${esc(cur)} 발표 전)</span>` : ""}</td><td><b>${kpiF(v, "$B")}</b></td><td>${p == null ? "-" : kpiF(p, "$B")}</td><td><span class="qtag ${tag[1]}">${tag[0]}</span></td></tr>`;
  }).join("");
  return `<details class="card" open style="margin-bottom:12px"><summary class="chart-title"><b>💸 빅테크 현금흐름 · CapEx 가이던스</b> <span class="src">M7 · 지금은 현금을 버는지가 가장 중요 · ${esc(CAPEX.updated_at || "")}</span></summary>
    ${peakHTML()}
    <div class="qgrid">${capexGuideSVG(CAPEX.guide)}${peakChart()}${chart}</div>
    ${capexConsHTML()}
    <div class="tbl-wrap" style="margin-top:8px"><table class="compact"><thead><tr><th style="text-align:left">회사</th><th>최근 분기</th><th>FCF</th><th>직전 분기</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note src">FCF = 영업현금흐름 − 설비투자(Purchases of property and equipment) · 야후 분기 재무제표 + 보도자료 · 회사마다 분기 끝 날짜가 달라 분기 끝에서 45일 뺀 달력 분기로 맞춤</div></details>`;
}
// 🔍 빅테크 숨은 숫자 (config/bigtech.yaml → capex.json money): 쉬운 요약 → 숫자 표 → 그래프(밑에 🐣 설명) → 장부에 없는 약속 → 돈은 어디서
const BT_COL = { MSFT: "var(--s1)", GOOG: "var(--bad)", META: "var(--good)", AMZN: "var(--warn)" };  // M7 현금흐름 그림과 같은 색
function moneyHTML() {
  const m = CAPEX?.money;
  if (MKT !== "US" || !m?.charts) return "";
  const C = Object.fromEntries(m.charts.map((c) => [c.k, c.s])), q = m.asof, ago = `${+q.slice(0, 2) - 1}${q.slice(2)}`;
  const g = (k, t, qq = q) => C[k]?.[t]?.[qq], B = (v) => (v == null ? "-" : kpiF(v, "$B")), li = (x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`;
  const rows = Object.entries(m.names).map(([t, nm]) => {
    const cap = (CAPEX.cos || []).find((c) => c.t === t)?.q?.[q], ls = m.lease?.v?.[t]?.at(-1), da0 = g("da", t, ago);
    return `<tr><td style="text-align:left">${esc(nm)}</td><td><b>${kpiF(g("capex_rev", t), "%")}</b><br><span class="src">1년 전 ${kpiF(g("capex_rev", t, ago), "%")}</span></td>
      <td><b>${B(g("da", t))}</b><br><span class="src">${da0 ? `1년 새 ${pct((g("da", t) / da0 - 1) * 100, 0, true)}` : "-"}</span></td>
      <td>${B(g("ltd", t, ago))} →<br><b>${B(g("ltd", t))}</b></td><td><b>${g("buyback", t) == null ? "안 함" : B(g("buyback", t))}</b></td>
      <td>${ls ? `<b>${B(ls)}</b>${cap ? `<br><span class="src">이번 분기 CapEx 의 ${n(ls / cap, 1)}배</span>` : ""}` : "-"}</td></tr>`;
  }).join("");
  const charts = m.charts.map((c) => kpiChart({ ...c, col: Object.keys(c.s).map((t) => BT_COL[t]), s: Object.entries(c.s).map(([t, v]) => ({ n: m.names[t], v })) })).join("");
  const promise = [m.lease, m.commit].filter(Boolean).map((p) => `<div class="chart-title" style="margin-top:10px"><b>📦 ${esc(p.t)}</b> <span class="src">${esc(p.q.join(" → "))}</span></div>
    <div class="tbl-wrap"><table class="compact"><tbody>${Object.entries(p.v).map(([t, [a, b]]) => `<tr><td style="text-align:left">${esc(m.names[t])}</td><td>${B(a)} → <b>${B(b)}</b> <span class="src">${pct((b / a - 1) * 100, 0, true)}</span></td></tr>`).join("")}</tbody></table></div>
    ${p.kid ? `<div class="kidbox" style="font-size:13px">🐣 ${esc(p.kid)}</div>` : ""}`).join("");
  return `<details class="card" open style="margin-bottom:12px"><summary class="chart-title"><b>🔍 빅테크 숨은 숫자</b> <span class="src">투자 → 감가상각 → 빚 · ${esc(q)} · SEC 10-Q 원문으로 계산</span></summary>
    <div class="kidbox" style="margin-top:0">🐣 <b>한눈에</b><ul class="irl">${(m.easy || []).map(li).join("")}</ul></div>
    <div class="tbl-wrap" style="margin-top:8px"><table class="compact"><thead><tr><th style="text-align:left">${esc(q)}</th><th>매출 대비 CapEx</th><th>감가상각비</th><th>장기 빚 (1년 전 → 지금)</th><th>자사주 매입</th><th>아직 시작 안 된 리스</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="qgrid" style="margin-top:8px">${charts}</div>
    ${promise}
    <div class="kidbox">💰 <b>모자란 돈은 어디서 구했나</b><ul class="irl">${(m.funding || []).map(li).join("")}</ul></div>
    <div class="note"><b>📌 숫자 읽을 때 주의</b><ul class="irl">${(m.notes || []).map(li).join("")}</ul></div>
    <div class="note src">출처: ${(m.src || []).map((s) => `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>`).join(" · ")} · 매수·매도 추천이 아니에요</div></details>`;
}
// ⚠️ 증시 고점 신호 점검 3가지 (config/peak.yaml) — 빅테크 CapEx 가 정체되면 관련주 고점 가능성 ↑ (참고용, 추천 아님)
function peakHTML() {
  const p = CAPEX?.peak;
  if (!p) return "";
  const f = p.forecast?.v, ks = f ? Object.keys(f).sort() : [];
  const gr = ks.slice(1).map((k, i) => [k, (f[k] / f[ks[i]] - 1) * 100]).filter(([k]) => +k >= 25);
  return `<div class="warnbox" style="margin:0 0 8px"><b>⚠️ ${esc(p.title || "")}</b> <span class="src">${esc(p.date || "")}</span>
    <div style="margin-top:4px">“${esc(p.rule || "")}”</div>
    ${p.now ? `<div style="margin-top:4px">👉 <b>${esc(p.now)}</b></div>` : ""}
    <div style="margin-top:6px"><b>🔎 고점 신호 점검 3가지</b></div>
    <ul class="irl">${(p.signals || []).map((s, i) => `<li>${i + 1}) <b>${esc(s.n)}</b>: <span class="qtag bad">${esc(s.s || "")}</span> ${esc(s.now || "")}${s.when ? ` <span class="src">(${esc(s.when)} 예상)</span>` : ""}</li>`).join("")}</ul>
    ${gr.length ? `<div style="margin-top:4px">📉 ${esc(p.forecast.t || "CapEx 전망")} 증가율: ${gr.map(([k, g]) => `${k}년 <b>${pct(g, 0, true)}</b>`).join(" → ")} <span class="src">— 금액은 계속 늘지만 늘어나는 속도가 꺾이는 게 핵심</span></div>` : ""}
    ${p.history ? `<div class="src" style="margin-top:4px">📚 ${esc(p.history)}</div>` : ""}
    <div class="src" style="margin-top:4px">출처: ${esc(p.src || "")} · 참고용 신호 점검이에요 (매수·매도 추천 아님)</div></div>`;
}
function peakChart() {
  const f = CAPEX?.peak?.forecast;
  return f?.v ? kpiChart({ t: `${f.t} ($B)`, u: "$B", why: "그림에서 눈으로 읽은 대략값 · 26년 이후 기울기가 눕는지 보기",
    s: [{ n: "CapEx", v: Object.fromEntries(Object.keys(f.v).sort().map((k) => [`'${k}`, f.v[k]])) }] }) : "";
}
// 🏗 회사별 연간 CapEx 가이던스가 실적 발표 때마다 어떻게 바뀌었나 (막대 = 범위 가운데 값, 마지막 막대 색 = 상향 파랑·유지 회색·감소 빨강)
function capexGuideSVG(gs) {
  gs = (gs || []).filter((g) => (g.pts || []).length);
  if (!gs.length) return "";
  const key = (q) => q.slice(2) + q[0], qs = [...new Set(gs.flatMap((g) => g.pts.map((p) => p.q)))].sort((a, b) => key(a).localeCompare(key(b))).slice(-4);
  const mid = (p) => (p.lo + p.hi) / 2, hi = Math.max(...gs.flatMap((g) => g.pts.map((p) => Math.max(p.hi, p.cons || 0)))) * 1.18;
  const W = 320, top = 26, bot = 132, gw = (W - 10) / gs.length, bw = Math.min(12, (gw * 0.8) / qs.length), Y = (v) => bot - (v / hi) * (bot - top);
  const C = (h) => (/감소|하향|이연/.test(h || "") ? "var(--bad)" : /상향|첫/.test(h || "") ? "var(--s1)" : "var(--ink-2)");
  let g = `<line x1="4" x2="${W - 4}" y1="${bot}" y2="${bot}" stroke="var(--axis)"/>`;
  gs.forEach((c, gi) => {
    const x0 = 5 + gi * gw + (gw - bw * qs.length) / 2, last = c.pts.at(-1);
    qs.forEach((q, i) => {
      const p = c.pts.find((x) => x.q === q); if (!p) return;
      const isL = p === last, x = x0 + i * bw;
      g += `<rect x="${x + 1}" y="${Y(mid(p))}" width="${bw - 2}" height="${bot - Y(mid(p))}" fill="${isL ? C(p.how) : "var(--ink-2)"}" opacity="${isL ? 1 : 0.2 + 0.15 * i}"/>`;
      if (isL) g += `<text x="${x + bw / 2}" y="${Y(Math.max(mid(p), p.cons || 0)) - 5}" text-anchor="middle" class="qv b" style="fill:${C(p.how)}">$${n(mid(p), 0)}B</text>`;
      if (isL && p.cons) g += `<line x1="${x - 2}" x2="${x + bw + 2}" y1="${Y(p.cons)}" y2="${Y(p.cons)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 2"/>`;  // 점선 = 컨센
    });
    const lab = last.q !== qs.at(-1) ? "발표 전" : last.how || "";  // 이번 분기 아직 발표 안 함 (예: 아마존)
    g += `<text x="${5 + gi * gw + gw / 2}" y="${bot + 14}" text-anchor="middle" class="qx">${esc(c.name)}</text><text x="${5 + gi * gw + gw / 2}" y="${bot + 27}" text-anchor="middle" class="qx" style="fill:${lab === "발표 전" ? "var(--ink-2)" : C(last.how)}">${esc(lab)}</text>`;
  });
  const why = gs.filter((c) => c.pts.at(-1).why).map((c) => `${esc(c.name)}: ${esc(c.pts.at(-1).why)}`);
  return `<div class="qp"><div class="qt"><b>🏗 빅테크 CapEx 가이던스</b></div><div class="src">회사가 말한 1년 설비투자 계획 · 막대 = ${qs.map(esc).join(" → ")} 발표 때 (범위면 가운데 값)${gs.some((c) => c.pts.at(-1).cons) ? " · 점선 = 시장 예상(컨센)" : ""}</div>
    <svg viewBox="0 0 ${W} 166" role="img" aria-label="빅테크 CapEx 가이던스">${g}</svg>
    <div class="src">${gs.map((c) => `${esc(c.name)} ${c.pts.map((p) => (p.lo === p.hi ? `$${n(p.lo, 0)}B` : `$${n(p.lo, 0)}~${n(p.hi, 0)}B`)).join(" → ")}${c.pts.at(-1).y ? ` (${esc(c.pts.at(-1).y)})` : ""}${c.pts.at(-1).cons ? ` · 컨센 $${n(c.pts.at(-1).cons, 0)}B` : ""}`).join(" · ")}${why.length ? `<br>${why.join(" · ")}` : ""}</div></div>`;
}
// 📈 12MF PER 밴드 (증권사 그림처럼 10·15·20배 … 고정 배수 선): 각 주의 12개월 선행 EPS = 그해 EPS × 남은 기간 + 다음 해 EPS × 지난 기간
// shortcut: 과거 시점의 선행 EPS 는 당시 컨센서스 대신 실제 연간 EPS(지난 해는 실적, 앞 해는 지금 추정)로 계산 — 무료로 과거 컨센서스를 받게 되면 바꾸기
const P12_PERIODS = [["5", "5년"], ["10", "10년"], ["all", "최대"]];  // 사용자 11/6: 밴드는 5년·10년·최대 탭으로
function per12mfSeries(d, yrs = "5", key = "eps") {  // key = eps → 12MF PER 밴드 · bps → 12MF PBR 밴드 (사용자 11/6)
  const b = d.bands?.[key === "bps" ? "PBR" : "PER"] || d.bands?.PER || d.bands?.PBR, eps = Object.fromEntries((d.history || []).map((r) => [r.year, r[key]]));  // 주가 줄은 어느 밴드든 같음
  if (!b?.dates?.length) return null;
  const f12 = (ds) => {
    const dt = new Date(ds), y = dt.getFullYear(), w0 = Math.max(0, (12 - dt.getMonth() - dt.getDate() / 31) / 12);
    const a = eps[y], c = eps[y + 1], e = a != null && c != null ? w0 * a + (1 - w0) * c : null;
    return e != null && e > 0 ? e : null;
  };
  const pts = b.dates.map((ds, i) => [ds, b.price[i], f12(ds)]).filter((p) => p[2] != null).slice(yrs === "all" ? 0 : -52 * +yrs);  // 최근 N년 (주간)
  if (pts.length < 20) return null;
  const today = pts.length;  // 이 뒤로는 앞으로 (주가 없이 추정치 EPS 로 그린 선)
  for (let t = new Date(pts.at(-1)[0]); ;) {  // 다음 해 EPS 추정치가 있는 동안 4주마다 앞으로
    t = new Date(t.getTime() + 28 * 864e5);
    const ds = t.toISOString().slice(0, 10), e = f12(ds);
    if (e == null) break;
    pts.push([ds, null, e]);
  }
  const r = pts.slice(0, today).map((p) => p[1] / p[2]).sort((x, y) => x - y), lo = r[Math.floor(r.length * 0.05)], hi = r[Math.floor(r.length * 0.95)];
  const step = (key === "bps" ? [0.1, 0.2, 0.25, 0.5, 1, 2] : [2, 2.5, 5, 10, 20, 50]).find((s) => (hi - lo) / s <= 5) || (key === "bps" ? 5 : 100);
  const ms = [];
  for (let m = Math.max(step, Math.floor(lo / step) * step); m <= Math.ceil(hi / step) * step + 1e-9 && ms.length < 6; m += step) ms.push(m);
  return { pts, ms, now: pts[today - 1][1] / pts[today - 1][2], end: pts.at(-1)[0], f12 };  // f12 = 아무 날짜의 12개월 선행 EPS (앞으로 적정주가 표)
}
/* ---------- 🌍 글로벌 동종 대비 12MF PER (data/global_pe.json ← collector/global_pe.py · config/global_peers.yaml) ---------- */
let GPE = null;
const gpeGet = async () => { if (!GPE) GPE = await (await fetch("data/global_pe.json?t=" + Date.now(), { cache: "no-store" })).json(); return GPE; };
const GPE_COL = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s7)", "var(--bad)", "var(--muted)"];
const monOf = (ds) => { const t = new Date(ds + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const ym = (ds) => `${ds.slice(2, 4)}.${+ds.slice(5, 7)}`;
// 주간 선 그림: lines [{n, v:[…], col, w, dash}] (왼쪽 = 배) + prem [… %] (오른쪽 축, 면) + marks [{i, t, up}] 작은 글씨 + 프리미엄 구간 빨간 상자
function gpeChart(dates, lines, o = {}) {
  const N = dates.length, W = 380, H = 236, x0 = 30, x1 = W - (o.prem ? 36 : 10), top = 16, bot = H - 22;
  const X = (i) => x0 + ((x1 - x0) * i) / Math.max(1, N - 1), all = lines.flatMap((l) => l.v).filter((v) => v != null);
  const hi = Math.ceil((Math.max(...all) * 1.12) / 5) * 5, Y = (v) => bot - (v / hi) * (bot - top);
  const pv = (o.prem || []).filter((v) => v != null), plo = pv.length ? Math.floor((Math.min(...pv, 0) - 12) / 10) * 10 : 0, phi = pv.length ? Math.ceil((Math.max(...pv, 0) + 12) / 10) * 10 : 1;
  const YR = (v) => bot - ((v - plo) / (phi - plo)) * (bot - top);
  const path = (a, Yf) => a.map((v, i) => (v == null ? "" : `${i && a[i - 1] != null ? "L" : "M"}${X(i).toFixed(1)},${Yf(v).toFixed(1)}`)).join("");
  let g = [0, hi / 2, hi].map((v) => `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${x0 - 3}" y="${Y(v) + 3}" text-anchor="end" class="qx">${n(v, 0)}</text>`).join("");
  if (pv.length) {
    g += [plo, 0, phi].map((v) => `<text x="${x1 + 3}" y="${YR(v) + 3}" class="qx">${v > 0 ? "+" : ""}${v}%</text>`).join("");
    g += `<path d="M${X(0)},${YR(plo)} ${o.prem.map((v, i) => (v == null ? "" : `L${X(i).toFixed(1)},${YR(v).toFixed(1)}`)).join("")} L${X(N - 1)},${YR(plo)} Z" fill="var(--s1)" fill-opacity=".14"/>`;
    g += `<line x1="${x0}" x2="${x1}" y1="${YR(0)}" y2="${YR(0)}" stroke="var(--s1)" stroke-opacity=".35" stroke-dasharray="2 3"/>`;
    let s = null, e = null, gap = 0;  // 프리미엄(+) 구간 = 빨간 상자 (4주 넘게 이어진 곳만, 3주 안 끊김은 이어 봄)
    const box = () => { if (s != null && e - s >= 3) g += `<rect x="${X(s)}" y="${top}" width="${X(e) - X(s)}" height="${bot - top}" fill="none" stroke="var(--bad)" stroke-width="1.6"/><text x="${(X(s) + X(e)) / 2}" y="${top - 4}" text-anchor="middle" class="qx" style="fill:var(--bad-ink)">프리미엄</text>`; s = null; };
    o.prem.forEach((v, i) => {
      if (v != null && v > 0) { if (s == null) s = i; e = i; gap = 0; } else if (s != null && ++gap >= 3) box();
    });
    box();
  }
  dates.forEach((d, i) => { if (i && d.slice(5, 7) !== dates[i - 1].slice(5, 7) && ["01", "07"].includes(d.slice(5, 7))) g += `<text x="${X(i)}" y="${bot + 14}" text-anchor="middle" class="qx">${ym(d)}</text>`; });
  if (o.hline) g += `<line x1="${x0}" x2="${x1}" y1="${Y(o.hline.v)}" y2="${Y(o.hline.v)}" stroke="var(--ink-2)" stroke-dasharray="5 3"/><text x="${x0 + 3}" y="${Y(o.hline.v) - 3}" class="qx">${esc(o.hline.t)}</text>`;
  lines.forEach((l) => { g += `<path d="${path(l.v, Y)}" fill="none" stroke="${l.col}" stroke-width="${l.w || 2}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ""} stroke-linejoin="round"/>`; });
  (o.marks || []).forEach((m) => {  // 바닥·꼭대기 옆 작은 글씨 (이유)
    const v = lines[0].v[m.i];
    if (v == null) return;
    const y = Y(v), ty = m.up ? Math.max(top + 8, y - 14) : Math.min(bot - 4, y + 18), anc = X(m.i) > (x0 + x1) / 2 ? "end" : "start";
    g += `<circle cx="${X(m.i)}" cy="${y}" r="3" fill="var(--ink)"/><line x1="${X(m.i)}" x2="${X(m.i)}" y1="${y}" y2="${ty - (m.up ? -3 : 9)}" stroke="var(--ink-2)" stroke-width=".8"/>`
      + m.t.split("\n").map((t, k) => `<text x="${X(m.i)}" y="${ty + k * 10}" text-anchor="${anc}" class="qx" style="font-size:9px;fill:var(--ink)">${esc(t)}</text>`).join("");
  });
  g += tipCols(X, (x1 - x0) / Math.max(1, N - 1), top, bot, dates.map((d, i) => [d, ...lines.map((l) => (l.v[i] == null ? null : `${l.n}: ${n(l.v[i], 1)}배`)), o.prem && o.prem[i] != null ? `${o.prem[i] >= 0 ? "프리미엄" : "할인"} ${pct(o.prem[i], 0, true)}` : null].filter(Boolean).join("\n")));
  const leg = `<div class="src" style="padding:0 4px">${lines.map((l) => `<span style="color:${l.col}">━</span> ${esc(l.n)}`).join(" · ")}${pv.length ? ` · <span style="color:var(--s1);opacity:.5">■</span> 프리미엄(+)·할인(−) % (오른쪽)` : ""}</div>`;
  return `${leg}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="12MF PER 비교">${g}</svg>`;
}
// 종목 상세 맨 위(12MF PER 밴드 위): 우리 종목 12MF PER vs 글로벌 동종 가운데 값 + 프리미엄·할인 + 타임라인 메모
function globalPeHTML(d) {
  const G = Object.values(GPE?.groups || {}).find((g) => g.codes.includes(d.code));
  const b = d.bands?.PER, eps = Object.fromEntries((d.history || []).map((r) => [r.year, r.eps]));
  if (!G || !b?.dates?.length || !Object.keys(G.avg || {}).length) return "";
  const f12 = (ds) => { const t = new Date(ds), y = t.getFullYear(), w0 = Math.max(0, (12 - t.getMonth() - t.getDate() / 31) / 12), a = eps[y], c = eps[y + 1]; return a != null && c != null ? w0 * a + (1 - w0) * c : null; };
  // 과거 칸을 '나중에 나온 실제 이익'으로 섞으면 이익이 크게 는 회사(에이피알)는 PER 이 너무 낮게, 무너진 회사는 너무 높게 나와요 →
  // 그때까지 발표된 최근 4분기 영업이익으로 어림한 주당이익(마지막 연간 EPS × 최근 4분기 영업이익 ÷ 그해 영업이익)의 0.6~1.6배 안으로 묶음
  const act = Object.fromEntries((d.history || []).filter((r) => !r.estimate && r.eps != null).map((r) => [r.year, r.eps]));
  const QO = {}, AO = {};  // 분기 영업이익 (10년 실적·분기 실적) · 연간 영업이익 (와이즈리포트 연간)
  Object.entries(d.longq || {}).forEach(([k, v]) => { if (v.op != null) QO[k] = v.op; });
  (d.kq?.quarters || []).forEach((x) => { if (/^\d\d\.[1-4]Q$/.test(x.q || "") && x.op != null) QO[x.q] = x.op; });
  (d.kq?.annual || []).forEach((x) => { if (!x.est && x.op != null) AO[2000 + +x.q] = x.op; });
  const qs = Object.keys(QO).sort(), qEnd = (k) => Date.UTC(2000 + +k.slice(0, 2), +k[3] * 3, 0);
  const known = (t) => {
    const yA = Object.keys(act).map(Number).filter((y) => Date.UTC(y + 1, 2, 31) <= t).pop();
    if (yA == null || !(act[yA] > 0)) return null;
    const rep = qs.filter((k) => qEnd(k) + 45 * 864e5 <= t).slice(-4), ttm = (rep.reduce((a, k) => a + QO[k], 0) * 4) / (rep.length || 1);
    // 주당이익 ÷ 영업이익 비율: 그때까지 알던 해들의 가운데 값 (한 해 일회성 이익·손실에 덜 흔들리게)
    const rs = Object.keys(AO).map(Number).filter((y) => y <= yA && act[y] > 0 && AO[y] > 0).map((y) => act[y] / AO[y]).sort((a, b) => a - b);
    return rep.length && ttm > 0 && rs.length ? ttm * rs[Math.floor(rs.length / 2)] : act[yA];  // 1~4분기를 1년치로 늘려 씀
  };
  const mine = {}, free = new Date(b.dates.at(-1)).getTime() - 91 * 864e5;  // 최근 3개월은 지금 컨센서스 그대로
  b.dates.forEach((ds, i) => {
    let e = f12(ds);
    const k = e > 0 && new Date(ds).getTime() < free ? known(new Date(ds).getTime()) : null;
    if (k) e = Math.min(Math.max(e, 0.6 * k), 1.6 * k);
    if (e > 0 && b.price[i]) mine[monOf(ds)] = b.price[i] / e;
  });
  const ds = Object.keys(G.avg).filter((x) => mine[x] != null && mine[x] <= 100).sort();
  if (ds.length < 12) return "";
  const sv = ds.map((x) => mine[x]), av = ds.map((x) => G.avg[x]), pr = ds.map((x, i) => (sv[i] / av[i] - 1) * 100);
  const L = ds.length - 1, imin = pr.indexOf(Math.min(...pr)), imax = pr.indexOf(Math.max(...pr));
  const notes = (G.notes?.[d.code] || []).map((x) => ({ i: ds.findIndex((y) => y.slice(0, 7) >= x.d), t: x.t })).filter((m) => m.i >= 0);
  const near = (i) => notes.some((m) => Math.abs(m.i - i) <= 8);
  const wrap = (t) => t.replace(/(.{1,16})(\s|$)/g, "$1\n").trim();  // 작은 글씨 줄바꿈
  const marks = [...notes.map((m) => ({ i: m.i, t: wrap(`${ym(ds[m.i])} ${m.t}`), up: pr[m.i] > (pr[imin] + pr[imax]) / 2 })),
    ...(near(imin) ? [] : [{ i: imin, t: `${ym(ds[imin])} 할인 최대\n${pct(pr[imin], 0, true)}`, up: false }]),
    ...(near(imax) || pr[imax] <= 0 ? [] : [{ i: imax, t: `${ym(ds[imax])} 프리미엄 최대\n${pct(pr[imax], 0, true)}`, up: true }]),
    ...(near(L) ? [] : [{ i: L, t: `지금 ${pct(pr[L], 0, true)}`, up: pr[L] > 0 }])];
  const rank = pr.filter((v) => v < pr[L]).length / pr.length, where = rank <= 0.1 ? "비교 기간 중 가장 싼 쪽" : rank >= 0.9 ? "비교 기간 중 가장 비싼 쪽" : `비교 기간 중 아래에서 ${Math.round(rank * 100)}% 자리`;
  const peers = G.peers.map((p) => `${esc(p.n)} ${p.now == null ? "-" : n(p.now, 1) + "배"}`).join(" · ");
  const pbrOnly = (d.card?.scen?.parts || []).length && d.card.scen.parts.every((p) => p.kind === "PBR");  // 롯데쇼핑처럼 이익이 들쭉날쭉해 PBR 로 매기는 종목
  return `<h3>🌍 글로벌 동종 대비 12MF PER <span class="src">${esc(G.title)} · ${esc(ym(ds[0]))}~${esc(ym(ds[L]))} 주간 · ${esc(GPE.updated_at || "")}</span></h3><div class="card">
    <div class="note" style="margin-top:0">지금 ${esc(d.name)} <b>${n(sv[L], 1)}배</b> · 글로벌 동종 가운데 값 <b>${n(av[L], 1)}배</b> → <b style="color:${pr[L] < 0 ? "var(--s1)" : "var(--bad-ink)"}">${pr[L] < 0 ? "할인" : "프리미엄"} ${pct(pr[L], 0, true)}</b> (${where})
      <br><span class="src">할인이 가장 컸던 때 ${ym(ds[imin])} ${pct(pr[imin], 0, true)}${pr[imax] > 0 ? ` · 프리미엄이 가장 컸던 때 ${ym(ds[imax])} ${pct(pr[imax], 0, true)}` : ` · 비교 기간 내내 할인 (가장 작을 때 ${ym(ds[imax])} ${pct(pr[imax], 0, true)})`} · 동종 지금: ${peers}</span></div>
    ${gpeChart(ds, [{ n: d.name, v: sv, col: "var(--ink)", w: 2.4 }, { n: "글로벌 동종 가운데 값", v: av, col: "var(--s1)", w: 2.4 }], { prem: pr, marks, hline: { v: sv[L], t: `지금 ${n(sv[L], 1)}배` } })}
    ${pbrOnly ? `<div class="warnbox" style="margin-top:6px">⚠ 이 종목은 순이익이 해마다 들쭉날쭉해서(일회성 이익·손실) 적정주가를 PBR 로 매겨요 — 이 PER 비교, 특히 과거 칸은 참고로만 보세요</div>` : ""}
    <div class="kidbox" style="margin-top:6px">🐣 회사가 1년에 버는 돈 1원에 주식시장이 얼마를 쳐주는지(PER)를 세계 대표 회사들과 나란히 본 그림이에요. 검은 선이 파란 선보다 아래면 '할인', 위면 '프리미엄'(빨간 상자)이에요. 파란 면이 내려갈수록 할인이 커진 거예요 — 지금은 ${pct(pr[L], 0, true)}로 ${where}예요. 할인이 크다고 꼭 싼 건 아니고, 왜 할인받는지(환율·성장 둔화·신뢰) 이유를 같이 봐야 해요.</div>
    <div class="note src">${esc(GPE.how || "")} · 우리 종목: 이번·다음 해 EPS 를 섞되, 3개월 넘은 과거 칸은 그때까지 발표된 분기 영업이익으로 어림한 이익의 0.6~1.6배 안으로 묶음 · ⚠ 과거 칸은 '그때 증권사 예상'이 아니라 어림이라 리포트 그림과 다를 수 있어요 (지금 칸은 컨센서스 그대로) · 작은 글씨 = config/global_peers.yaml notes (+ 할인·프리미엄이 가장 컸던 때·지금은 자동)</div></div>`;
}
// 🏭 산업 탭: 업종마다 글로벌 대표 3~6곳 12MF PER + 가운데 값
// 🏭 산업 탭 업종 칸 하나: 🌍 글로벌 대표 기업 12MF PER (config/global_peers.yaml 그룹)
function gpeCard(k) {
  const g = GPE?.groups?.[k], ds = Object.keys(g?.avg || {}).sort().filter((x) => !g.since || x >= g.since);  // since = 그림 시작 (M7 최근 2년)
  if (ds.length < 12) return "";
  const nm = (c) => DASH.stocks.find((x) => x.code === c)?.name || c;
  const avn = g.avg_name || "가운데 값", last = g.avg[ds.at(-1)];
  const lines = g.peers.map((p, i) => ({ n: p.n, t: p.t, v: ds.map((x) => p.pe[x] ?? null), col: GPE_COL[i % GPE_COL.length], w: 1.6 })).filter((l) => !(g.skip || []).includes(l.t))  // 평균에서 뺀 회사(테슬라)는 그림에서도 빼서 눈금이 눌리지 않게
    .concat([{ n: avn, v: ds.map((x) => g.avg[x]), col: "var(--ink)", w: 2.6, dash: "5 3" }]);
  // table (M7, 사용자 11/9 전달 표 모양): 시가총액 큰 순 · 이번 주 등락 · 지금 12MF PER (100배 넘어도 그대로)
  const fx = DASH.fx, tbl = g.table ? `<table class="compact" style="margin:6px 0"><tr><th>회사</th><th>시가총액</th><th>이번 주</th><th>12MF PER</th></tr>
    ${[...g.peers].sort((a, b) => (b.cap || 0) - (a.cap || 0)).map((p) => `<tr><td>${esc(p.n)}</td><td>${p.cap && fx ? `${n((p.cap * fx) / 1e12, 0)}조원` : "-"}</td><td style="color:${p.wk < 0 ? "var(--s1)" : "var(--bad-ink)"}">${p.wk == null ? "-" : pct(p.wk, 2, true)}</td><td><b>${p.pe_now == null ? "-" : n(p.pe_now, 1) + "배"}</b></td></tr>`).join("")}
    <tr><td colspan="3"><b>${esc(avn)}</b></td><td><b>${n(last, 1)}배</b></td></tr></table>
    <div class="src">시가총액 = 야후 달러 시가총액 × 오늘 환율 · 이번 주 = 지난주 금요일 종가 대비 · 12MF PER = 지금 주가 ÷ 앞으로 12개월 예상 EPS (이번·다음 회계연도 섞음)</div>` : "";
  return `<h3>🌍 글로벌 대표 기업 12MF PER <span class="src">${esc(g.title)} · 주간 · 야후 · ${esc(GPE.updated_at || "")}</span></h3><div class="card">
    <div class="note" style="margin-top:0">지금 ${esc(avn)} <b>${n(last, 1)}배</b>${g.table ? "" : ` · ${g.peers.map((p) => `${esc(p.n)} ${p.now == null ? "-" : n(p.now, 1) + "배"}`).join(" · ")}`}</div>
    ${tbl}${gpeChart(ds, lines)}${g.codes.length ? `<div class="src">우리 종목과 할인·프리미엄은 종목 상세 맨 위 '🌍 글로벌 동종 대비': ${g.codes.map((c) => `<a href="#stock/${esc(c)}">${esc(nm(c))}</a>`).join(" · ")}</div>` : ""}
    <div class="note src">검은 점선 = ${esc(avn)}${g.avg_name ? "" : "(중앙값)"} · ${esc(GPE.how || "")}${g.skip?.length ? ` · 그림에는 평균에서 뺀 ${esc(g.peers.filter((p) => g.skip.includes(p.t)).map((p) => p.n).join("·"))} 선이 없어요 (지금 값은 표에)` : ""}</div></div>`;
}
// 📦 라면·화장품 수출 (config/exports.yaml → data/exports.json): 이번 달 나라별 표(전년·전월비, 영업일수 감안 일평균) + 2020년부터 월별 금액 + 전년비
let EXP = null;
const EXP_NOTE = "월별 금액 = 관세청 수출입실적 API (공공데이터포털, 매일 확인 · 확정치는 다음 달 중순쯤) · 아직 API 에 없는 최신 달 = 관세청 월초 발표 (사용자 전달)";
// [제목, HS, 그림·표에 쓸 줄 (앞 2개 = 연도별 같은 달 그림, 앞 3개 = 전년비 그림, 6번째부터 = 둘째 전년비 그림), 표 첫 칸, 억 달러로 보기, 밑 메모]
const EXP_K = { ramen: ["🍜 라면 수출", "HS 1902.30.1010", ["전체", "미국", "중국", "일본"], "나라", false, EXP_NOTE],
  cosmetics: ["💄 화장품 수출", "HS 3304", ["전체", "미국", "중국", "일본", "영국"], "나라", false, `${EXP_NOTE} · 기초 = 기초화장용(3304.99.10) · 색조 = 립 + 아이 + 메이크업용`],
  tech: ["💾 반도체·IT 수출", "나라 합계", ["메모리", "D램", "MCP·HBM", "낸드", "SSD", "MLCC", "디스플레이", "2차전지", "반도체 장비"], "품목", true,
    `${EXP_NOTE} · 메모리 = HS 8542.32 전체 · D램 = 8542.32.1010 · 낸드 = 8542.32.1030 (플래시) · MCP·HBM = 8542.32.3000 복합구조칩 (HBM 이 여기로 잡힘) · SSD = 8523.51.1 · MLCC = 8532.24 · 디스플레이 = 8524 · 2차전지 = 8507.60 (리튬이온) · 반도체 장비 = 8486 · 표(맨 위)는 증권사 묶음이라 그림 숫자와 정의가 다를 수 있어요`],
  power: ["⚡ 전력기기 수출", "나라 합계", ["초고압변압기", "배전변압기 650~10,000kVA", "초고압케이블 (8544.60.3)", "GIS·차단기 (72.5kV 이상)", "배전반 (1kV 초과)"], "품목 · 지역", false,
    `${EXP_NOTE} · 초고압변압기 = HS 8504.23 (10,000kVA 초과) · 배전변압기 = 8504.22 (650~10,000kVA) · 8504.21 (650kVA 이하) · 증권사 정의 확인 전 후보: GIS·차단기 = 8535.29 (72.5kV 이상) · 배전반 = 8537.20.3000 (1kV 초과 배전용) · 초고압케이블 = 8544.60.3 · 표(맨 위)는 증권사 1일 잠정치 (전월비·전년비만)`],
  car: ["🚗 자동차 수출", "산업부 월별 · 관세청 HS", ["승용차 (HS 8703)", "자동차부품 (HS 8708)", "화물차 (HS 8704)"], "달", 1,
    `표·선 그림 = 산업통상부 월별 자동차 수출액 (다올투자증권 글, 사용자 전달) · 아래 월별 그림 = 관세청 수출입실적 API (매일 확인 · 확정치는 다음 달 중순쯤) · 승용차 = HS 8703 (중고차 포함이라 산업부 '자동차'와 금액이 다를 수 있어요) · 화물차 = 8704 · 자동차부품 = 8708`],
  food: ["🥫 소스·아이스크림·담배 수출", "나라 합계", ["소스", "담배", "아이스크림"], "품목 · 지역", false,
    `${EXP_NOTE} · 소스 = HS 2103 전체 (후보: 2103.90.9090 기타 소스) · 아이스크림 = 2105 · 담배 = 2402.20 필터담배 · 라면은 위 🍜 라면 칸 · 표(맨 위)는 증권사 1일 잠정치 (전월비·전년비만)`] };
// 🍜 올해 1~N월 라면 지역별 수출 증가율 (한화 그림14 모양, 사용자 11/10 "트래킹 할 수 있는 것만") — 관세청 숫자로 자동
//   두 해 모두 1~N월이 다 있는 지역만 (나라별 API 가 열리면 중국·미국·유럽이 저절로 들어옴) · 유럽 = 아래 나라 합
const EU_C = ["영국", "네덜란드", "독일", "프랑스", "스페인", "이탈리아", "폴란드", "스웨덴"];
function ramenYtdHTML() {
  const R = EXP?.ramen, last = Object.keys(R?.["전체"] || {}).sort().at(-1);
  if (!last) return "";
  const y = +last.slice(0, 4), m = +last.slice(5), ms = (yy) => Array.from({ length: m }, (_, i) => `${yy}-${String(i + 1).padStart(2, "0")}`);
  const sum = (cs, yy) => (cs.length && cs.every((c) => ms(yy).every((k) => R[c]?.[k] != null)) ? cs.reduce((t, c) => t + ms(yy).reduce((a, k) => a + R[c][k], 0), 0) : null);
  const reg = [["전체", ["전체"]], ["중국", ["중국"]], ["미국", ["미국"]], ["유럽", EU_C.filter((c) => R[c])]];
  const rows = reg.map(([nm, cs]) => [nm, sum(cs, y), sum(cs, y - 1)]).filter(([, a, b]) => a != null && b > 0).map(([nm, a, b]) => [nm, rnd1((a / b - 1) * 100), a]);
  if (!rows.length) return "";
  const miss = reg.map(([nm]) => nm).filter((nm) => !rows.some(([r]) => r === nm));
  return `<div class="card" style="margin-top:8px"><div class="chart-title"><b>🍜 ${y}년 1~${m}월 라면 지역별 수출 증가율</b> <span class="src">관세청 · 매달 자동 · 1년 전 같은 기간보다</span></div>
    ${rows.length >= 2 ? keyChart({ q: rows.map((r) => r[0]), u: "%", d: 1, col: ["#f39a2e"], bars: [{ n: "증가율", v: rows.map((r) => r[1]) }] }) : ""}
    <div class="note">${rows.map(([nm, g, a]) => `${esc(nm)} <b>${sg(g, 1)}</b> <span class="src">(${n(a / 100, 1)}억$)</span>`).join(" · ")}</div>
    <div class="note src">${miss.length ? `${miss.join("·")}: 올해 달마다 숫자가 다 있지 않아 아직 계산 못 함 — 관세청 나라별 API(공공데이터포털 '품목별 국가별 수출입실적')를 신청하면 자동으로 들어와요 · ` : ""}유럽 = ${EU_C.join("·")} 합 · 한화 그림14 (1~10월): 전체 26.2 · 중국 23.8 · 미국 29.1 · 유럽 45.7%</div></div>`;
}
function expHTML(kind) {
  const E = EXP?.[kind], L = EXP?.[`${kind}_latest`] || EXP?.latest, [title, hs, show, col1, eok, note] = EXP_K[kind];
  if (!L || (!E && !L[kind])) return "";  // 월별 그림(E)이 아직 없어도 증권사 표만 먼저
  const fm = (v) => (v == null ? "-" : `${n(v / 100, eok === true ? 0 : eok || 2)}억$`);  // 모든 업종 억 달러 (원화는 wonize 가 붙임) · eok 숫자 = 소수 자리 (자동차 65.5억)
  const dy = (yy) => (yy == null ? null : ((1 + yy / 100) * L.days.ly / L.days.this - 1) * 100);  // 영업일수 감안 일평균 전년비 (영업일수는 사용자 글에만 있음)
  const hv = (k) => Object.values(L[k]).some((r) => r[0] != null);  // 금액이 하나도 없으면(증권사 % 만 준 표) 금액 칸을 뺌
  const tbl = (k, nm) => (L[k] ? `<div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">${esc(nm)}${hv(k) ? "" : ` (${esc(L.ym)})`}</th>${hv(k) ? `<th>${esc(L.vh || L.ym)}</th>` : ""}<th>전년비</th><th>전월비</th>${L.days ? "<th>일평균 전년비</th>" : ""}</tr></thead><tbody>
    ${Object.entries(L[k]).map(([c, [v, yy, mm]]) => `<tr><td style="text-align:left">${esc(c)}</td>${hv(k) ? `<td><b>${fm(v)}</b></td>` : ""}<td class="${kcol(yy)}">${sg(yy)}</td><td class="${kcol(mm)}">${sg(mm)}</td>${L.days ? `<td class="${kcol(dy(yy))}">${sg(dy(yy))}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : "");
  const ms = [...new Set(Object.values(E || {}).flatMap((s) => Object.keys(s)))].sort(), all = [];
  if (ms.length) for (let y = +ms[0].slice(0, 4), m = +ms[0].slice(5); `${y}-${String(m).padStart(2, "0")}` <= ms.at(-1); m === 12 ? (y++, m = 1) : m++) all.push(`${y}-${String(m).padStart(2, "0")}`);
  // 연도별 같은 달 비교 (가로 1~12월, 해마다 선 하나 · 올해만 주황 굵게 — 사용자 전달 그림 모양)
  const yrs = [...new Set(ms.map((x) => x.slice(0, 4)))].sort(), YC = ["#c7d9f2", "#9cc0ea", "#6fa2de", "#4383cf", "#2563b0", "#173f7a"];
  // 단위는 모든 업종 똑같이 억 달러 (사용자 11/5 '173? 63? 뭐지') — 0 부터 그림, 예시 한 줄은 원화가 저절로 붙음(wonize)
  const season = (c) => (E?.[c] ? lineChart({ t: `${c} 월별 수출 (억 달러) — 연도별 같은 달 비교`, why: `숫자 단위 = 억 달러 · 예) ${eok ? "10" : "1.5"}억 달러 · 색깔별 숫자 = 그해 가장 최근 달`, zero: true,
    labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`), fl: (v) => n(v / 100, eok ? 0 : 2),
    s: yrs.map((y, i) => ({ n: `${y}년`, v: Array.from({ length: 12 }, (_, m) => E[c][`${y}-${String(m + 1).padStart(2, "0")}`] ?? null), col: i === yrs.length - 1 ? "#e8692f" : YC[Math.max(0, YC.length - (yrs.length - 1) + i)] })),
    tick: (i) => (i % 2 === 0 ? `${i + 1}월` : "") }) : "");
  const ago = (x) => `${+x.slice(0, 4) - 1}${x.slice(4)}`, yoy = all.slice(-36);
  const yl = (cs) => cs.filter((c) => E[c]).map((c, i) => ({ n: c, v: yoy.map((x) => (E[c][x] && E[c][ago(x)] ? (E[c][x] / E[c][ago(x)] - 1) * 100 : null)), col: i ? GPE_COL[(i - 1) % GPE_COL.length] : "var(--ink)" }));
  const ych = (t, cs) => lineChart({ t, labels: yoy, s: yl(cs), fl: (v) => `${n(v, 0)}%`, zero: true, tick: (i) => (yoy[i].endsWith("-01") ? `'${yoy[i].slice(2, 4)}` : "") });
  return `<h3 id="kc-exp-${kind}">${title} <span class="src">${hs} · 월별 · 단위 억 달러 · ${esc(L.src || "")}</span></h3><div class="card">
    ${(L.notes || []).length ? `<ul class="irl" style="margin-top:0">${L.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${tbl(kind, col1)}${kind === "cosmetics" ? `<details class="fvt"><summary class="chart-title">기초(스킨케어) · 색조(메이크업·립·아이) 나눠 보기</summary>${tbl("skincare", "기초")}${tbl("makeup", "색조")}</details>` : ""}
    ${L.timeline && L[kind] ? (() => {  // 🚗 줄 = 달인 표 → 선으로 이은 월별 그림 (막대 = 전년비) + 🐣
      const R = Object.entries(L[kind]).reverse(), lb = R.map(([k]) => k);
      return lineChart({ t: `월별 ${title.replace(/^\S+\s/, "")} — 선으로 이음`, labels: lb, fl: (v) => `${n(v, 0)}억`, fr: (v) => `${n(v, 0)}%`,
        s: [{ n: "수출액 (억 달러)", v: R.map(([, r]) => (r[0] == null ? null : r[0] / 100)), col: "var(--ink)" }, { n: "전년비 %", v: R.map(([, r]) => r[1]), bar: true, right: true, col: "var(--s1)" }],
        tick: (i) => (i % 2 === 0 || i === lb.length - 1 ? `${lb[i].slice(0, 2)}.${+lb[i].slice(3)}` : "") })
        + (L.kid ? `<div class="kidbox" style="margin:4px 0;font-size:13px">🐣 ${esc(L.kid)}</div>` : "");
    })() : ""}
    ${L.days ? `<div class="src">영업일수 ${L.days.this}일 (${L.days.prev ? `전월 ${L.days.prev}일 · ` : ""}작년 ${L.days.ly}일) · 일평균 전년비 = 영업일수를 맞춘 비교</div>` : ""}
    <div class="qgrid">${season(show[0])}${season(show[1])}</div>
    ${E ? ych("전년 같은 달 대비 %", show.slice(0, 3)) : ""}${E && show.length > 5 ? ych("전년 같은 달 대비 % (부품·장비)", show.slice(5)) : ""}
    <div class="note src">${note}</div></div>`;
}
// ‼️ 📦 종목별 수출·입국 추적 (사용자 11/10 "수출 발표 뜨는 날 빨간 느낌표 → 누르면 그동안 트래킹한 그래프, 막대·선으로 · 숫자만 보면 머리에 안 남음")
//   카드 꼬리표 = 새 숫자를 받은 지 7일 안 (최신 표 src 의 날짜 · 관세청 확정치 seen · 입국자 seen) → 누르면 상세 '📦 수출·입국 데이터 추적' 칸으로 바로
let TN = null, GOTO = null;  // TN = data/tour_nat.json (국적별 입국, collector/tour_stats.py) · GOTO = 상세를 열고 갈 칸
const EXPW = { "003230": ["ramen"], "278470": ["cosmetics", "tour"], "483650": ["cosmetics", "tour"], "241710": ["cosmetics"], "251970": ["cosmetics"], "092730": ["cosmetics"],
  "214450": ["med", "tour"], "214150": ["tour"], "005930": ["tech"], "005935": ["tech"], "000660": ["tech"], "009150": ["mlcc"],
  "005380": ["car"], "000270": ["car"], "012330": ["car"], "023530": ["tour"], "004170": ["tour"], "069960": ["tour"], "003490": ["tour"] };
// s = 월별 줄 묶음 · m = 큰 줄 · sub = 나눠 볼 줄 · L = 최신 표 (lk = 표 안 이름, timeline 표는 날짜만 씀) · dv·u·dg = 그림 단위 · seen = 확정치 받은 날 묶음
const EXPW_K = {
  ramen: { t: "🍜 라면 수출", s: () => EXP?.ramen, m: "전체", sub: ["미국", "중국", "일본"], L: () => EXP?.latest, lk: "ramen", dv: 100, u: "억$", dg: 2, seen: "ramen", hs: "관세청 HS 1902.30.1010" },
  cosmetics: { t: "💄 화장품 수출", s: () => EXP?.cosmetics && { ...EXP.cosmetics, "기초(스킨케어)": EXP.skincare?.["전체"] }, m: "전체", sub: ["기초(스킨케어)", "미국", "중국", "일본"],
    L: () => EXP?.latest, lk: "cosmetics", dv: 100, u: "억$", dg: 1, seen: "cosmetics", hs: "관세청 HS 3304 · 기초 = 3304.99.10" },
  tech: { t: "💾 메모리 반도체 수출", s: () => EXP?.tech, m: "메모리", sub: ["D램", "MCP·HBM", "낸드"], L: () => EXP?.tech_latest, lk: "tech", dv: 100, u: "억$", dg: 0, seen: "tech", hs: "관세청 HS 8542.32 · HBM 은 MCP 칸 · 표 = 증권사 묶음" },
  mlcc: { t: "🔋 MLCC 수출", s: () => EXP?.tech, m: "MLCC", sub: [], dv: 100, u: "억$", dg: 1, seen: "tech", hs: "관세청 HS 8532.24" },
  car: { t: "🚗 자동차 수출", s: () => EXP?.car, m: "승용차 (HS 8703)", sub: ["자동차부품 (HS 8708)"], L: () => EXP?.car_latest, dv: 100, u: "억$", dg: 0, seen: "car", hs: "관세청 HS 8703·8708" },
  med: { t: "💉 강릉 화장품·필러 수출 (리쥬란 신호)", s: () => EXP?.med, m: "강릉 3304.99 (리쥬란)", sub: [], dv: 0.01, u: "만$", dg: 0, seen: "med", hs: "관세청 시군구 · 강릉 HS 3304.99 (회사와 딱 맞진 않지만 흐름이 비슷하다고 보는 칸)" },
  tour: { t: "✈️ 외국인 입국자 수", s: () => TN?.nat, m: "전체", sub: ["중국", "일본", "미국", "유럽", "대만"], dv: 1e4, u: "만 명", dg: 0, hs: "관광지식정보시스템 국적별 입국 (원자료 법무부)" } };
const ymAdd = (x, d) => { const t = +x.slice(0, 4) * 12 + +x.slice(5) - 1 + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const kDays = (d) => (Date.now() - Date.parse(`${d}T00:00:00+09:00`)) / 864e5;
function expRel(k) {  // 가장 최근에 새 숫자를 받은 날 {ym, d}
  const K = EXPW_K[k], L = K.L?.(), ld = L?.src?.match(/\d{4}-\d{2}-\d{2}/)?.[0], out = [];
  if (L?.ym && ld) out.push({ ym: L.ym, d: ld });
  const sn = k === "tour" ? TN?.seen : EXP?.seen?.[K.seen], ym = sn && Object.keys(sn).sort().at(-1);
  if (ym) out.push({ ym, d: sn[ym] });
  return out.sort((a, b) => b.d.localeCompare(a.d))[0] || null;
}
const expNew = (code) => (EXPW[code] || []).map((k) => ({ k, r: expRel(k) })).filter((x) => x.r && kDays(x.r.d) >= -1 && kDays(x.r.d) <= 7);
function expwOne(k, isNew) {
  const K = EXPW_K[k], S = K.s(), M = S[K.m], last = Object.keys(M).sort().at(-1), lab = Array.from({ length: 25 }, (_, i) => ymAdd(last, i - 24));
  const V = (s, x) => (s?.[x] == null ? null : s[x] / K.dv), ch = (a, b) => (a != null && b ? (a / b - 1) * 100 : null);
  const yo = (s, x) => ch(s?.[x], s?.[ymAdd(x, -12)]), mo = (s, x) => ch(s?.[x], s?.[ymAdd(x, -1)]), fv = (v) => `${n(v, K.dg)}${K.u}`;
  const tk = (i) => ((lab.length - 1 - i) % 6 === 0 ? `${lab[i].slice(2, 4)}.${+lab[i].slice(5)}` : "");
  const c1 = lineChart({ t: `월별 ${K.t.replace(/^\S+\s/, "")} (막대) · 1년 전보다 % (선)`, why: `막대 단위 = ${K.u} · 예) ${fv(V(M, last))} = ${+last.slice(5)}월`, labels: lab, zero: true, tick: tk,
    fl: (v) => n(v, K.dg), fr: (v) => `${n(v, 0)}%`, s: [{ n: `${K.m} (${K.u})`, v: lab.map((x) => V(M, x)), bar: true, col: "var(--s1)" }, { n: "1년 전보다 %", v: lab.map((x) => yo(M, x)), right: true, col: "#e8692f" }] });
  // 분기 합계 (세 달이 다 있는 분기만) + 1년 전 같은 분기보다 % · 아직 덜 찬 이번 분기는 글로
  const qOf = (x) => `${x.slice(2, 4)}.${Math.ceil(+x.slice(5) / 3)}Q`, qMs = (q) => [1, 2, 3].map((j) => `20${q.slice(0, 2)}-${String((q[3] - 1) * 3 + j).padStart(2, "0")}`);
  const qSum = (q, upto = 3) => { const xs = qMs(q).slice(0, upto); return xs.every((x) => M[x] != null) ? xs.reduce((a, x) => a + M[x], 0) : null; };
  const qs = [...new Set(Object.keys(M).sort().map(qOf))].filter((q) => qSum(q) != null).slice(-12), qy = qAgo;
  const c2 = qs.length >= 5 ? lineChart({ t: "분기 합계 (막대) · 1년 전 같은 분기보다 % (선)", why: `막대 단위 = ${K.u}`, labels: qs, zero: true, fl: (v) => n(v, K.dg), fr: (v) => `${n(v, 0)}%`,
    s: [{ n: `분기 합계 (${K.u})`, v: qs.map((q) => qSum(q) / K.dv), bar: true, col: "var(--s3)" }, { n: "1년 전보다 %", v: qs.map((q) => ch(qSum(q), qSum(qy(q)))), right: true, col: "#e8692f" }] }) : "";
  const cq = qOf(last), cn = qMs(cq).indexOf(last) + 1, part = cn < 3 ? ch(qSum(cq, cn), qSum(qy(cq), cn)) : null;
  // 나눠 보기 (나라·국적·품목): 1년 전 같은 달보다 % 선 · 입국자는 사람 수 선도
  const subs = K.sub.filter((c) => S[c] && lab.filter((x) => yo(S[c], x) != null).length >= 6);
  const what = k === "tour" ? "국적별" : k === "tech" ? "품목별" : "나라별";
  const c3 = subs.length ? lineChart({ t: `${what} — 1년 전 같은 달보다 %`, labels: lab, zero: true, tick: tk, fl: (v) => `${n(v, 0)}%`, s: subs.map((c, i) => ({ n: c, v: lab.map((x) => yo(S[c], x)), col: GPE_COL[i % GPE_COL.length] })) }) : "";
  const c3b = k === "tour" ? lineChart({ t: "국적별 입국자 수 (만 명)", labels: lab, zero: true, tick: tk, fl: (v) => n(v, 0), s: subs.map((c, i) => ({ n: c, v: lab.map((x) => V(S[c], x)), col: GPE_COL[i % GPE_COL.length] })) }) : "";
  // 최신 달 한눈에: 글로 받은 표(나라별 전년·전월비)가 있으면 그것, 없으면 월별 숫자로 계산
  const L = K.L?.(), T = L && !L.timeline && K.lk && L[K.lk];
  const rows = T ? Object.entries(T).map(([c, [v, y, m]]) => ({ n: c, now: v == null ? null : v / K.dv, u: K.u, d: K.dg, yoy: y, qoq: m }))
    : [K.m, ...K.sub].filter((c) => S[c]?.[last] != null).map((c) => ({ n: c, now: S[c][last] / K.dv, u: K.u, d: K.dg, yoy: yo(S[c], last), qoq: mo(S[c], last) }));
  const tm = T ? L.ym : last, c4 = rows.length > 1 ? chgChart({ t: `${+tm.slice(5)}월 한눈에 — ${what}`, qh: "지난달보다", rows, note: T ? L.src : `${K.hs} · ${tm}` }) : "";
  // 🐣 쉬운 요약: 이번 달 · 속도가 빨라지나(최근 3개월 vs 그 전 3개월) · 가장 빨리 느는 곳 · 이번 분기 지금까지
  const avg3 = (o) => { const v = [0, 1, 2].map((i) => yo(M, ymAdd(last, -i - o))).filter((x) => x != null); return v.length === 3 ? (v[0] + v[1] + v[2]) / 3 : null; };
  const r3 = avg3(0), p3 = avg3(3), best = rows.filter((r) => K.sub.includes(r.n) && r.yoy != null).sort((a, b) => b.yoy - a.yoy)[0];  // 작은 나라(네덜란드 +70%)는 빼고 큰 나라끼리
  const speed = r3 > p3 + 3 ? (r3 > 0 ? "🚀 더 빨리 늘고 있어요" : "덜 줄고 있어요 (회복 신호인지 다음 달 확인)") : r3 < p3 - 3 ? (r3 > 0 ? "🐢 느는 속도가 느려졌어요 (변곡점인지 다음 달 확인)" : "📉 더 많이 줄고 있어요") : "비슷한 속도예요";
  const kid = [`${+last.slice(5)}월 ${K.m === "전체" ? "" : `${K.m} `}${fv(V(M, last))} — 1년 전보다 ${sg(yo(M, last))}, 지난달보다 ${sg(mo(M, last))}`,
    r3 != null && p3 != null ? `최근 3개월 평균 ${sg(r3)} (그 전 3개월 ${sg(p3)}) → ${speed}` : "",
    best ? `${K.sub.length < 2 ? "나눠 보면" : best.yoy > 0 ? "가장 빨리 느는 곳" : "가장 덜 줄어든 곳"}: ${best.n} ${sg(best.yoy)} (${+tm.slice(5)}월)` : "", part != null ? `${cq[3]}분기 지금까지 (${cn}개월) 1년 전 같은 기간보다 ${sg(part)}` : ""].filter(Boolean);
  return `<div class="card" style="margin-top:8px"><div class="chart-title"><b>${K.t}</b> ${isNew ? `<span class="pill red">‼️ 새로 나옴</span> ` : ""}<span class="src">${esc(K.hs)} · ${last}까지</span></div>
    <div class="kidbox" style="margin:4px 0;font-size:13px">🐣 ${kid.map(esc).join("<br>")}</div>
    <div class="qgrid">${c1}${c2}</div>${c4}<div class="qgrid">${c3}${c3b}</div>
    ${k === "ramen" || k === "cosmetics" ? `<div class="note src">2026년 1~8월 나라별 칸은 비어 있어요 — 관세청 '품목별 국가별 수출입실적' API 를 신청하면 자동으로 채워져요 (9·10월은 글로 받은 숫자)</div>` : ""}
    ${k === "tech" ? `<div class="note src">💾 D램 현물 가격(매일)은 이 화면 맨 위 칸에 있어요 · 산업 탭 💾 반도체 칸에 품목 전체</div>` : ""}</div>`;
}
function expwHTML(code) {
  const all = EXPW[code] || [], ks = all.filter((k) => EXPW_K[k].s()?.[EXPW_K[k].m]);
  if (!all.length) return "";
  const nw = expNew(code).map((x) => x.k), open = nw.length || GOTO === "expw";
  const wait = all.includes("med") && !ks.includes("med") ? `<div class="warnbox" style="margin-top:8px">💉 강릉 화장품·필러 수출(리쥬란 신호): 관세청 '시군구별 품목별 수출입실적' API 를 공공데이터포털에서 활용신청하면 2020년부터 자동으로 들어와요 (11/10 시험: '등록되지 않은 서비스키')</div>` : "";
  return `<details class="fvt" id="expw"${open ? " open" : ""}><summary class="chart-title" style="margin-top:12px"><b>📦 수출·입국 데이터 추적</b> ${nw.length ? `<span class="pill red">‼️ 새로 나옴</span> ` : ""}<span class="src">${all.map((k) => EXPW_K[k].t).join(" · ")} · 기관도 개인도 같이 보는 원천 숫자 · 누르면 펼침</span></summary>
    ${ks.map((k) => expwOne(k, nw.includes(k))).join("")}${wait}
    <div class="note src">📅 발표: 매달 1일 지난달 잠정 (증권사 글로 들어옴) · 11일·21일 1~10일·1~20일 잠정 (관세청 보도자료, 반도체·자동차 같은 큰 품목 위주 — 라면·화장품 품목 숫자는 자동으로 못 받아요, 글을 보내 주시면 표에 넣어요) · 15일쯤 지난달 확정 (관세청 API, 여기 그림에 자동) · 외국인 입국자는 다음 달 하순 (자동) · 빨간 ‼️ 는 새 숫자를 받은 뒤 7일 · 사고팔 판단이 아니라 숫자 확인용이에요</div></details>`;
}
// 12MF 밴드 (key eps = PER · bps = PBR): 선 = 배수 × 그 시점의 12개월 선행 EPS·BPS, 오른쪽은 추정치로 그린 앞으로의 선
const P12K = (key) => (key === "bps" ? { k: "PBR", v: "BPS", id: "b12", dg: 2 } : { k: "PER", v: "EPS", id: "p12", dg: 1 });
function per12mfHTML(d, px = "", tag = "button", key = "eps") {
  const K = P12K(key);  // 적정가 방법과 관계없이 자료가 있으면 (사용자 11/6: 12MF PBR 밴드를 모든 종목에)
  const s = per12mfSeries(d, "5", key);
  if (!s) return "";
  return `<h3>📈 12MF ${K.k} 밴드 <span class="src">앞으로 ${esc(s.end.slice(0, 7))}까지 · 지금 ${n(s.now, K.dg)}배</span></h3><div class="card">
    ${segTabs(`${px}${K.id}-seg`, P12_PERIODS, "5", tag)}
    <div id="${px}${K.id}-legend"></div><div class="chart-box tall"><canvas id="${px}${K.id}"></canvas></div><div class="note" id="${px}${K.id}-note"></div>${estWarnHTML(d, "fwd", K.v)}
    <div class="note src">선 = 배수 × 그 시점의 12개월 선행 ${K.v} (올해·내년 ${K.v} 를 남은 달 수만큼 섞음) · 주가가 끝난 오른쪽은 추정치 ${K.v} 로 그린 앞으로의 선 · 배수 = 그 기간 ${K.k} 하위 5%~상위 5% 를 딱 떨어지는 간격으로.
    ${key === "eps" ? "적정가 계산과 같은 기준이에요. 'PER 밴드 차트'는 네이버 방식(그해 EPS 를 12월 말에 두고 이음)이라 PER 숫자가 달라요" : "📡 신호 탭 표의 12MF PBR 과 같은 기준이에요. 'PBR 밴드 차트'는 네이버 방식이라 숫자가 달라요"}</div></div>`;
}
function wirePer12mf(d, px = "", key = "eps") {
  drawPer12mf(d, px, "5", key);
  segWire(`#${px}${P12K(key).id}-seg`, (p) => drawPer12mf(d, px, p, key));
}
function drawPer12mf(d, px = "", yrs = "5", key = "eps") {
  const K = P12K(key), cv = document.getElementById(`${px}${K.id}`), s = cv && per12mfSeries(d, yrs, key);
  if (!s) return;
  const C = themeColors(), usd = d.currency === "USD";
  const ds = [{ label: "주가", data: s.pts.map((p) => p[1]), borderColor: C.s1, borderWidth: 3.5 },
    ...s.ms.map((m, i) => ({ label: `${n(m, K.dg)}배`, data: s.pts.map((p) => p[2] * m), borderColor: BAND_COL[i % BAND_COL.length], borderWidth: 2.4 }))];
  makeChart(cv, s.pts.map((p) => p[0]), ds, { fmt: (v) => (usd ? "$" + n(v, 2) : n(v) + "원"), yfmt: (v) => (usd ? "$" + n(v) : v >= 10000 ? n(v / 10000, 0) + "만" : n(v)) });
  document.getElementById(`${px}${K.id}-legend`).innerHTML = legend(ds.map((x) => [x.label, x.borderColor, false]));
  const pe = s.pts.filter((p) => p[1] != null).map((p) => p[1] / p[2]).sort((a, b) => a - b), pos = (pe.filter((x) => x < s.now).length / pe.length) * 100;
  const nt = document.getElementById(`${px}${K.id}-note`);
  if (nt) nt.innerHTML = `지금 12MF ${K.k} <b>${n(s.now, K.dg)}배</b> · 이 기간 ${n(pe[0], K.dg)}~${n(pe.at(-1), K.dg)}배 · 가운데 ${n(pe[pe.length >> 1], K.dg)}배 · 아래에서 <b>${n(pos, 0)}%</b> 자리 (${esc(s.pts[0][0].slice(0, 7))}~)`;
}
// 🗒 증권사 메모 (config/notes.yaml) — pbr·per 배수를 적은 메모는 우리 28E BPS·EPS × 그 배수도 계산
function notesHTML(list, c, y2) {
  if (!list?.length) return "";
  const usd = c.currency === "USD", fmtP = (v) => (usd ? "$" + n(v, 0) : n(v));
  const calc = ["pbr", "per"].map((k) => {
    const ms = [...new Set(list.flatMap((x) => x[k] || []))].sort((a, b) => a - b), base = y2?.parts?.find((p) => p.kind === k.toUpperCase())?.base_val;
    return ms.length && base ? `<div class="note src">우리 ${esc(y2.label)} ${k === "pbr" ? "BPS" : "EPS"} ${fmtP(base)} 기준: ${ms.map((m) => `${k.toUpperCase()} ${m}배 ${fmtP(base * m)} (${pct((base * m / c.price - 1) * 100, 0, true)})`).join(" · ")}</div>` : "";
  }).join("");
  return `${list.map((x) => `<div class="note">🗒 <b>${esc(x.src)}</b> <span class="src">${esc(x.date || "")}</span> ${esc(x.text)}</div>`).join("")}${calc}`;
}
// 👥 누가 어느 가격에 샀나: KRX 투자자별 순매수 거래대금(억원) × 그날 종가, 최근 1년
const FLOW_G = [["외국인", "--s1"], ["기관", "--s3"], ["개인", "--s4"]];
function flowHTML(d) {
  const f = d.flow;
  if (!f || !(f.zones || []).length) return "";
  const sg = (v) => (v == null ? "N/A" : (v > 0 ? "+" : "") + kqFmt(v)), pw = (v) => (v >= 1e5 ? n(v / 1e4, 0) + "만" : n(v));
  const mx = Math.max(1, ...f.zones.flatMap((z) => FLOW_G.map(([g]) => Math.abs(z[g] || 0))));
  const tile = ([g, col]) => {
    const x = f.groups[g] || {}, z = f.zones[x.top];
    return `<div class="tile"><div class="tl" style="color:var(${col})"><b>${g}</b> 1년 순매수</div><div class="tv" style="font-size:20px">${sg(x.sum)}</div>
      <div class="src">최근 20거래일 ${sg(x.m1)}<br>순매수한 날 평균 ${x.avg_buy ? pw(x.avg_buy) + "원" : "N/A"}<br>가장 많이 산 가격대 ${z ? `<b>${pw(z.lo)}~${pw(z.hi)}원</b>` : "없음 (내내 순매도)"}</div></div>`;
  };
  const rows = f.zones.slice().reverse().map((z) => {
    const now = d.price >= z.lo && d.price <= z.hi;
    return `<tr${now ? ' class="now"' : ""}><td>${pw(z.lo)}~${pw(z.hi)}${now ? " <b>◀ 지금</b>" : ""}<br><span class="src">${z.days}일</span></td>${FLOW_G.map(([g, col]) => {
      const v = z[g] || 0, w = (Math.abs(v) / mx) * 50;
      return `<td><div class="fz"><i style="${v >= 0 ? "left" : "right"}:50%;width:${w}%;background:var(${col});opacity:${v >= 0 ? 1 : 0.4}"></i></div><span class="src">${z.days ? sg(v) : ""}</span></td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<h3>👥 누가 어느 가격에 샀나 <span class="src">${esc(f.from)} ~ ${esc(f.to)} · 순매수 = 산 돈 − 판 돈</span></h3><div class="card">
    <div class="tiles t3">${FLOW_G.map(tile).join("")}</div>
    <table class="flow"><thead><tr><th>가격대 (그날 종가)</th>${FLOW_G.map(([g, col]) => `<th style="color:var(${col})">${g}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    <div class="note src">막대가 가운데 선 오른쪽이면 그 가격대에서 순매수, 왼쪽(흐린 색)이면 순매도예요. 외국인·기관·개인·기타법인을 모두 더하면 0이에요 (누가 사면 누군가는 팔아요).
      '평균'은 순매수한 날의 종가를 주식 수로 평균한 값이라 실제 체결가와는 조금 달라요. 출처: ${esc(f.src)}</div>
  </div>`;
}
async function tourBlock(code) {
  if (!TOUR) { try { TOUR = await (await fetch("data/tourism.json?t=" + Date.now(), { cache: "no-store" })).json() || {}; } catch (_) { TOUR = {}; } }
  if (!(TOUR.codes || []).includes(code) || !TOUR.months) return "";
  const ms = Object.keys(TOUR.months).sort(), last = ms[ms.length - 1], L = TOUR.months[last], P = TOUR.months[ms[ms.length - 2]] || {};
  const mo = +last.slice(5), man = (v) => n(v / 1e4, 0) + "만 명";
  const tile = ([k, lab, sub]) => { const x = L[k] || {}; return `<div class="tile"><div class="tl">${esc(lab)} <span class="src">${esc(sub)}</span></div><div class="tv" style="font-size:20px">${man(x.v)}</div>
    <div class="src">전월 ${pct(x.mom, 1, true)} · 전년 ${pct(x.yoy, 1, true)}<br>2019년 같은 달의 <b>${n(x.vs19, 1)}%</b></div></div>`; };
  const move = (k) => (P[k]?.vs19 ? `${n(P[k].vs19, 1)}% → ${n(L[k].vs19, 1)}%` : `${n(L[k].vs19, 1)}%`);
  return `<h3>✈️ 한국 출입국 관광통계 <span class="src">${last.slice(0, 4)}년 ${mo}월</span></h3><div class="card">
    <div class="tiles">${TOUR_K.map(tile).join("")}</div>
    <div class="chart-title" style="margin-top:12px"><b>${mo}월끼리 비교</b> <span class="src">만 명 · 2018·2019·${+last.slice(0, 4) - 1}년은 원문의 '대비 %'로 거꾸로 계산</span></div>
    <div id="tour-leg1"></div><div class="chart-box"><canvas id="tour-bar"></canvas></div>
    <div class="chart-title" style="margin-top:12px"><b>코로나 전(2019년 같은 달) 대비</b> <span class="src">100% = 2019년 수준 · 매달 쌓여요</span></div>
    <div id="tour-leg2"></div><div class="chart-box"><canvas id="tour-line"></canvas></div>
    <div class="memo" style="margin-top:10px">
      <b>롯데쇼핑과 어떤 관계?</b>
      <br>· 외국인, 특히 중국인 관광객이 늘면 백화점(명동 본점·잠실 등) 외국인 매출에 도움이 돼요. 롯데면세점은 호텔롯데 회사라 롯데쇼핑 실적에는 직접 안 들어가요.
      <br>· 내국인 해외여행(아웃바운드)이 늘면 국내에서 쓸 돈이 해외로 빠져서 백화점·마트에는 부담이 될 수 있어요.
      <br><b>${mo}월</b>: 중국인 입국 2019년 대비 ${move("cn")} (전월 ${pct(L.cn?.mom, 1, true)}, 전년 ${pct(L.cn?.yoy, 1, true)}) · 외국인 전체 ${move("in")} · 내국인 출국 ${move("out")}
    </div>
    <div class="note src">출처: ${TOUR.url ? `<a href="${esc(TOUR.url)}" target="_blank" rel="noopener">${esc(TOUR.source)}</a>` : esc(TOUR.source || "")} · config/tourism.yaml 에 매달 손으로 적음${Object.values(TOUR.months).some((m) => m.out?.est) ? " · 명 수가 원문에 없는 달은 다음 달 값 ÷ (1 + 전월 대비)로 계산" : ""}</div>
  </div>`;
}
function drawTour() {
  if (!document.getElementById("tour-bar")) return;
  const C = themeColors(), ms = Object.keys(TOUR.months).sort(), last = ms[ms.length - 1], L = TOUR.months[last], y = +last.slice(0, 4);
  const yrs = [["2018년", C.muted, (x) => x.v / (x.vs18 / 100)], ["2019년", C.s4, (x) => x.v / (x.vs19 / 100)],
    [`${y - 1}년`, C.s3, (x) => x.v / (1 + x.yoy / 100)], [`${y}년`, C.s1, (x) => x.v]];
  const bars = yrs.map(([label, col, f]) => ({ label, backgroundColor: col, borderColor: col, data: TOUR_K.map(([k]) => (L[k] ? f(L[k]) / 1e4 : null)) }));
  document.getElementById("tour-leg1").innerHTML = legend(yrs.map(([l, c]) => [l, c]));
  makeChart(document.getElementById("tour-bar"), TOUR_K.map((k) => k[1]), bars, { type: "bar", zero: true, fmt: (v) => n(v, 1) + "만 명", yfmt: (v) => n(v, 0) });
  const lines = TOUR_K.map(([k, lab, , s]) => ({ label: lab, borderColor: C[s], backgroundColor: C[s], pointRadius: 3, data: ms.map((m) => TOUR.months[m][k]?.vs19 ?? null) }));
  lines.push({ label: "2019년 수준", data: ms.map(() => 100), borderColor: C.muted, borderDash: [4, 3], borderWidth: 1, pointRadius: 0 });
  document.getElementById("tour-leg2").innerHTML = legend(lines.map((d) => [d.label, d.borderColor, !!d.borderDash]));
  makeChart(document.getElementById("tour-line"), ms, lines, { fmt: (v) => n(v, 1) + "%", yfmt: (v) => v.toFixed(0) + "%" });
}

/* ---------- 증권사 목표주가 트래킹 (config/broker_targets.yaml, 손으로 적음) ---------- */
let BROKER = null;
async function brokerBlock(code, price, cur) {
  if (!BROKER) {
    try { BROKER = await (await fetch("data/broker_targets.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { BROKER = {}; }
  }
  const snaps = [...(BROKER[code] || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!snaps.length) return "";
  const last = snaps[snaps.length - 1], prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  const names = Object.keys(last.targets || {}).sort((a, b) => last.targets[b] - last.targets[a]);
  const vals = names.map((k) => last.targets[k]);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const chg = (k) => {
    const p = prev && prev.targets && prev.targets[k];
    return p ? `<br><span class="src">${esc(String(prev.date).slice(5))} ${n(p)} → ${pct((last.targets[k] / p - 1) * 100, 0, true)}</span>` : "";
  };
  const row = (k, v, extra = "") => `<tr><td>${esc(k)}</td><td>${money(v, cur)}${extra}</td><td class="${v >= price ? "cheap" : "dear"}">${pct((v / price - 1) * 100, 0, true)}</td></tr>`;
  return `<h3>🎯 증권사 목표주가 <span class="src">${esc(String(last.date))} · ${esc(last.source || "")}</span></h3><div class="card">
    <div class="kv"><div class="k">평균 (${names.length}곳)</div><div class="v">${money(Math.round(avg), cur)} <span class="${avg >= price ? "verdict green" : "verdict red"}" style="font-size:13px">${pct((avg / price - 1) * 100, 0, true)}</span></div>
      <div class="k">최고 / 최저</div><div class="v">${money(Math.max(...vals), cur)} / ${money(Math.min(...vals), cur)}</div>
      <div class="k">현재가</div><div class="v">${money(price, cur)}${last.price_at ? ` <span class="src">(${esc(String(last.date).slice(5))} 당시 ${n(last.price_at)})</span>` : ""}</div></div>
    <div class="tbl-wrap"><table class="compact"><thead><tr><th>증권사</th><th>목표주가</th><th>현재가 대비</th></tr></thead><tbody>
      ${names.map((k) => row(k, last.targets[k], chg(k))).join("")}
      ${Object.entries(last.others || {}).map(([k, v]) => row(k + " (개인·방송)", v)).join("")}
    </tbody></table></div>
    <div class="note">${snaps.length > 1 ? `${snaps.length}번 기록 중 최근 두 번을 비교해요.` : "날짜별로 config/broker_targets.yaml 에 추가하면 이전 기록과 비교돼요."} 현재가 대비 %는 지금 주가 기준이에요.</div>
  </div>`;
}

/* ---------- 수주 공시 (방산 등) ---------- */
let ORDERS = null;
function eok(v) { return v == null ? "N/A" : v >= 1e12 ? n(v / 1e12, 2) + "조" : n(v / 1e8, 0) + "억"; }
async function ordersBlock(code) {
  if (ORDERS === null) {
    try { ORDERS = await (await fetch("data/orders.json?t=" + encodeURIComponent(DASH.updated_at))).json(); }
    catch (e) { ORDERS = {}; }
  }
  const o = ORDERS[code];
  if (!o) return "";
  const y = String(new Date().getFullYear());
  const live = o.contracts.filter((c) => !c.cancelled && c.amount);
  const regions = {};
  live.filter((c) => (c.contract_date || c.filed) >= String(Number(y) - 2)).forEach((c) => {
    const r = (c.region || "기타").split(/[,(]/)[0].trim();
    regions[r] = (regions[r] || 0) + c.amount;
  });
  const topReg = Object.entries(regions).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const row = (c) => `<tr class="${c.cancelled ? "cancel" : ""}">
      <td>${esc((c.contract_date || c.filed).slice(2))}</td>
      <td style="white-space:normal;min-width:9em">${c.new ? "🆕 " : ""}<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name || c.title)}</a>
        ${c.cancelled ? `<span class="pill red">해지 ${esc(c.cancelled)}</span>` : ""}${c.corrected ? `<span class="pill">정정 ${esc(c.last_update)}</span>` : ""}
        <br><span class="src">${esc((c.party || "").slice(0, 40))}${c.region ? " · " + esc(c.region) : ""}${c.start ? " · " + esc(c.start.slice(2)) : ""}${c.end ? " ~ " + esc(c.end.slice(2)) : ""}</span>
        ${c.pay_terms && c.pay_terms !== "-" ? `<br><span class="src">💰 ${esc(c.pay_terms.slice(0, 60))}</span>` : ""}
        <br><span class="src">${esc(c.quarter || "")} 보고 · ${c.corrected ? "정정" : "신규"}</span></td>
      <td>${eok(c.amount)}<br><span class="src">${c.ratio == null ? "" : "매출의 " + n(c.ratio, 1) + "%"}</span></td></tr>`;
  const newOnes = o.contracts.filter((c) => c.new);
  return `<h3>수주 공시 <span class="src">${esc(o.source)}</span></h3><div class="card">
    ${newOnes.length ? `<div class="memo" style="background:var(--good-bg);color:var(--good-ink)">🆕 최근 7일 새 수주 공시 ${newOnes.length}건: ${newOnes.map((c) => esc(c.name || "")).join(", ")}</div>` : ""}
    <div class="tiles">
      <div class="tile"><div class="tl">최근 12개월 수주</div><div class="tv">${eok(o.last12)}</div><div class="src">공시 기준 합계</div></div>
      <div class="tile"><div class="tl">${y}년 수주</div><div class="tv">${eok(o.by_year[y] || 0)}</div><div class="src">계약일 기준</div></div>
    </div>
    ${backlogBlock(o)}
    ${o.memo ? `<div class="memo">📝 ${esc(o.memo)}</div>` : ""}
    <div class="chart-title">연도별 수주 공시 금액 (조원)</div>
    <div class="chart-box"><canvas id="orders-chart"></canvas></div>
    ${topReg.length ? `<div class="chart-title">최근 3년 지역별</div><div class="pills">${topReg.map(([r, v]) => `<span class="pill">${esc(r)} ${eok(v)}</span>`).join("")}</div>` : ""}
    <div class="chart-title">계약 목록 (최근순)</div>
    <div class="tbl-wrap"><table class="compact orders"><thead><tr><th>계약일</th><th>내용 · 상대 · 지역</th><th>금액</th></tr></thead>
    <tbody>${o.contracts.slice(0, 15).map(row).join("")}</tbody></table></div>
    ${o.contracts.length > 15 ? `<details><summary class="note">이전 계약 ${o.contracts.length - 15}건 더 보기</summary><div class="tbl-wrap"><table class="compact orders"><tbody>${o.contracts.slice(15).map(row).join("")}</tbody></table></div></details>` : ""}
    <div class="note src">금액은 공시 당시 원화 환산액, 정정 공시가 나오면 최신 금액으로 바뀌어요. 해지된 계약은 합계에서 빠져요. 계약명을 누르면 DART 원문이 열려요. · ${esc(o.updated_at)}
    ${(o.unreadable || []).length ? `<br>양식이 달라 자동으로 못 읽은 공시 ${o.unreadable.length}건: ${o.unreadable.map((u) => `<a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.filed)}</a>`).join(", ")}` : ""}</div>
  </div>`;
}
/* 수주잔고 + 비율 (내 시트의 판단 기준을 함께 보여줌) */
function backlogBlock(o) {
  const b = o.backlog;
  if (!b) return "";
  const jo = (v) => (v == null ? "N/A" : v >= 10000 ? n(v / 10000, 1) + "조" : n(v, 0) + "억");
  const grade = (r) => r == null ? "" : r >= 5 ? "🟢 구조적 성장 국면 (5배 이상)" : r >= 3 ? "🟡 안정적 (3~4배)" : r > 2 ? "보통 (2~3배)" : "🔴 불안정·가시성 낮음 (2배 이하)";
  const segs = Object.entries(b.segments || {}).sort((a, c) => c[1] - a[1]);
  const max = segs.length ? segs[0][1] : 1;
  return `<div class="chart-title">수주잔고 <span class="src">${esc(b.as_of)} 기준 · ${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.source)}</a>` : esc(b.source)}</span></div>
    <div class="tiles">
      <div class="tile"><div class="tl">총 수주잔고</div><div class="tv">${jo(b.total)}</div><div class="src">${esc(b.as_of)}</div></div>
      <div class="tile"><div class="tl">잔고 ÷ ${b.sales_last_year} 매출</div><div class="tv">${n(b.backlog_to_sales_last, 2)}배</div><div class="src">${grade(b.backlog_to_sales_last)}</div></div>
      <div class="tile"><div class="tl">잔고 ÷ 올해 예상 매출</div><div class="tv">${n(b.backlog_to_sales_now, 2)}배</div><div class="src">${grade(b.backlog_to_sales_now)}</div></div>
      <div class="tile"><div class="tl">올해 신규수주 ÷ 예상 매출</div><div class="tv">${n(b.book_to_bill, 2)}</div><div class="src">${b.book_to_bill == null ? "" : b.book_to_bill >= 1 ? "🟢 1 이상: 성장" : "1 미만: 정체"} · 공시 합계 ${jo(b.new_orders_this_year)}</div></div>
    </div>
    ${segs.map(([k, v]) => `<div class="note" style="margin:4px 0 0">${esc(k)} <b>${jo(v)}</b>
      <div style="height:8px;border-radius:4px;background:var(--surface-2);margin-top:2px"><div style="height:8px;border-radius:4px;background:var(--s1);width:${(v / max) * 100}%"></div></div></div>`).join("")}
    <div class="note src">판단 기준(내 시트): 잔고÷매출 2배 이하 불안정·가시성 낮음 / 3~4배 안정적 / 5배 이상 구조적 성장 · 신규수주÷매출 1 이상 성장, 1 미만 정체.
    올해 신규수주는 공시(매출 대비 일정 규모 이상) 합계라서 실제 수주보다 작을 수 있어요.${o.backlog.history ? " 현대로템 잔고는 config/orders.yaml 에 분기마다 직접 입력해요." : ""}</div>`;
}

function drawOrders(code) {
  const o = ORDERS && ORDERS[code];
  const cv = document.getElementById("orders-chart");
  if (!o || !cv) return;
  const C = themeColors();
  const ys = Object.keys(o.by_year).sort();
  makeChart(cv, ys, [{ label: "수주", data: ys.map((y) => o.by_year[y] / 1e12), backgroundColor: C.s1, borderRadius: 4, borderSkipped: "start", maxBarThickness: 28 }],
    { type: "bar", zero: true, fmt: (v) => n(v, 2) + "조원", yfmt: (v) => n(v, 0), xlen: 4 });
}

/* ---------- 주요 주주(국민연금 등) 지분 변화 ---------- */
let HOLDERS = null;
async function holdersBlock(code) {
  if (HOLDERS === null) {
    try { HOLDERS = await (await fetch("data/holders.json?t=" + encodeURIComponent(DASH.updated_at))).json(); }
    catch (e) { HOLDERS = { companies: {} }; }
  }
  const h = HOLDERS.companies[code];
  if (!h) return "";
  const ins = insiderHTML(h.insider);
  if (!Object.keys(h.series || {}).length) return ins;
  const sgn = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "") + n(Math.abs(v), 2) + "%p";
  return `${ins}<h3>주요 주주 지분 변화 <span class="src">5% 이상 주주 · 1%p 이상 변동 시 공시</span></h3><div class="card">
    <div class="chart-box tall"><canvas id="holders-chart"></canvas></div><div id="holders-legend"></div>
    <div class="note src">지분 30% 넘는 최대주주는 차트에서 빼고 아래 표에만 보여 줘요.</div>
    <div class="chart-title">최근 지분 변동</div>
    <div class="tbl-wrap"><table class="compact orders"><thead><tr><th>공시일</th><th>주주 · 사유</th><th>변동</th></tr></thead><tbody>
    ${h.changes.slice(0, 12).map((x) => `<tr><td>${esc(x.date.slice(2))}</td>
      <td style="white-space:normal"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a><br><span class="src">${esc(x.reason)}</span></td>
      <td class="${x.chg_ratio < 0 ? "dear" : "cheap"}">${sgn(x.chg_ratio)}<br><span class="src">보유 ${n(x.ratio, 2)}%</span></td></tr>`).join("")}
    </tbody></table></div>
    <div class="note src">${esc(HOLDERS.source)} · ${esc(HOLDERS.updated_at)} · 국민연금 같은 기관의 5% 지분 변동은 아래 '내부자 거래'(대주주·임원 본인 돈) 통계와는 다른 성격이에요.</div></div>`;
}
function eok(v) { return !v ? "0" : v >= 1e8 ? `${n(v / 1e8, 1)}억` : `${n(v / 1e4, 0)}만`; }
// 깡토 백테스트 (2016~2026.10, 임원·주요주주 소유보고 약 14만 건 중 장내매수·장내매도만, 거래대금 10억↑, 같은 날 거래대금 비슷한 종목 대비 초과수익)
const KKANGTO = {
  major_sell: "대주주 장내매도 496건: 시장 대비 1개월 −2.7% · 5개월 −11.5% · 1년 −19.7%, 이긴 비율 34% → 28% → 20%. 5개월 뒤 시장보다 나았던 해가 11년 중 0번 → '꽤 무거운 경고'",
  exec_buy: "임원(대주주 아님) 본인 돈 장내매수 7,310건: 5개월 +5.0% · 1년 +13.2%, 5개월 기준 11년 모두 플러스. 대표이사 매수 2,843건도 5개월 +3.0% (11년 중 9년) → 여러 명이 사면 관심종목에 올릴 이유",
  major_buy: "대주주 장내매수 1,229건: 평균 1개월 +0.4% · 5개월 +1.2% · 1년 +3.2%지만 중간값은 −1.2% · −3.8% · −9.2%, 이긴 비율 46% → 41% → '매수 이유는 못 된다'. 코스피가 고점 대비 20%↑ 빠진 하락장에서 산 196건도 1년 +30.8% 올랐지만 시장 대비는 −4.0%(이긴 비율 35%)",
};
function insiderHTML(x) {
  if (!x || !(x.rows || []).length) return "";
  const big = [];
  if (x.major_sell) big.push(`<div class="warnbox" style="margin-top:6px;background:var(--bad-bg);color:var(--bad-ink)">⚠ <b>대주주 장내매도 ${eok(x.major_sell)}</b><div class="note src">${KKANGTO.major_sell}</div></div>`);
  // 국내는 임원·대표가 팔 때가 뒤 주가에 더 잘 맞음 (사용자 원칙 · 미국은 CEO·임원 매수가 더 의미) — 행이 아직 없는 옛 데이터는 표에서 직접 셈
  const es = (x.rows || []).filter((r) => r.kind === "매도" && r.role !== "대주주"), esN = x.exec_sellers ?? new Set(es.map((r) => r.name)).size;
  const ceoS = x.ceo_sell ?? new Set(es.filter((r) => r.role === "대표이사").map((r) => r.name)).size;
  if (esN) big.unshift(`<div class="warnbox" style="margin-top:6px;background:var(--bad-bg);color:var(--bad-ink);border-color:var(--bad)">🚨 <b>${ceoS ? `대표이사 ${ceoS}명 포함 ` : ""}임원 ${esN}명 장내매도 ${eok(x.exec_sell ?? es.reduce((a, r) => a + r.amt, 0))}</b> (최근 3개월)
    <div class="note" style="color:var(--bad-ink)">국내 주식은 주요 임원·대표가 팔면 뒤 주가가 안 좋은 경우가 많아요 — 꼭 확인 (미국은 CEO·임원 매수가 더 의미 있는 신호). 아래 빨간 줄이 매도 거래예요.</div></div>`);
  if (x.exec_buyers) big.push(`<div class="warnbox" style="margin-top:6px;background:var(--good-bg);color:var(--good-ink)">👀 <b>임원 ${x.exec_buyers}명 장내매수${x.ceo_buy ? ` (대표이사 ${x.ceo_buy}명 포함)` : ""}</b><div class="note src">${KKANGTO.exec_buy}</div></div>`);
  if (x.major_buy) big.push(`<div class="note">ℹ 대주주 장내매수 ${eok(x.major_buy)} <span class="src">${KKANGTO.major_buy}</span></div>`);
  const tag = (r) => `<span class="pill ${r.kind === "매도" ? "red" : r.role === "대주주" ? "" : "green"}">${esc(r.role)}</span>`;  // 매도 = 빨강 (누가 팔든)
  return `<h3>👥 내부자 거래 <span class="src">최근 3개월 장내매수·매도 · 임원·주요주주 소유보고 (스톡옵션·상여 제외)</span></h3><div class="card">
    <div class="mini"><div>매수<b class="cheap">${eok(x.buy)}</b><span class="src">${x.buyers}명</span></div><div>매도<b class="dear">${eok(x.sell)}</b><span class="src">${x.sellers}명</span></div>
      <div>순매수<b class="${x.buy - x.sell < 0 ? "dear" : "cheap"}">${x.buy - x.sell < 0 ? "−" : ""}${eok(Math.abs(x.buy - x.sell))}</b></div></div>
    ${big.join("")}
    <div class="tbl-wrap" style="margin-top:8px"><table class="compact orders"><thead><tr><th>변동일</th><th>보고자</th><th>사유</th><th>증감(주)</th><th>단가</th><th>금액</th></tr></thead><tbody>
      ${x.rows.slice(0, 15).map((r) => `<tr${r.kind === "매도" ? ' style="background:var(--bad-bg);font-weight:700"' : ""}><td>${esc((r.date || "").slice(2))}</td><td style="white-space:normal"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a> ${tag(r)}<br><span class="src">${esc(r.pos || "")}</span></td>
        <td>장내${esc(r.kind)}</td><td class="${r.chg < 0 ? "dear" : "cheap"}">${r.chg > 0 ? "+" : ""}${n(r.chg, 0)}</td><td>${n(r.price, 0)}</td><td>${eok(r.amt)}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="note src">참고(깡토 블로그 백테스트, 한 사람의 통계): 대주주가 산다는 건 매수 이유가 못 되고, 대주주가 판다는 건 꽤 무거운 경고. 임원이 여러 명 사면 관심종목에 올릴 만함. 그래도 추세(신고가·상대강도)를 먼저 보고, 시장이 나쁘면 비중은 작게. 통계는 과거 결과일 뿐 앞으로를 보장하지 않아요.</div>
  </div>`;
}
function drawHolders(code) {
  const h = HOLDERS && HOLDERS.companies[code];
  const cv = document.getElementById("holders-chart");
  if (!h || !cv) return;
  const C = themeColors();
  const pal = [C.s1, C.s3, C.s4, C.s7];
  const labels = [...new Set(Object.values(h.series).flat().map((x) => x.date))].sort();
  // 최대주주처럼 30% 넘는 주주는 선이 너무 위에 있어 다른 주주 변화가 안 보여서 차트에서는 뺀다(표에는 나옴)
  const lastRatio = (nm) => (h.series[nm].at(-1) || {}).ratio || 0;
  let names = Object.keys(h.series).filter((nm) => lastRatio(nm) < 30);
  if (!names.length) names = Object.keys(h.series);
  names.sort((a, b) => (a.includes("국민연금") ? -1 : b.includes("국민연금") ? 1 : lastRatio(b) - lastRatio(a)));
  let pi = 0;
  const ds = names.slice(0, 5).map((nm) => {
    const rows = h.series[nm];
    const data = labels.map((d) => { const r = rows.filter((x) => x.date <= d).pop(); return r ? r.ratio : null; });
    const nps = nm.includes("국민연금");
    return { label: nm, data, borderColor: nps ? C.s2 : pal[pi++ % pal.length], borderWidth: nps ? 3 : 2, stepped: "before", spanGaps: true };
  });
  makeChart(cv, labels, ds, { fmt: (v) => n(v, 2) + "%", yfmt: (v) => n(v, 0) + "%", xlen: 7 });
  document.getElementById("holders-legend").innerHTML = legend(ds.map((d) => [d.label, d.borderColor, false]));
}

/* ---------- 4. 동종업계 비교 ---------- */
let PEERS = null;
const FLAG = { KR: "🇰🇷", US: "🇺🇸", EU: "🇪🇺", JP: "🇯🇵", TW: "🇹🇼", CN: "🇨🇳" };
async function peersBlock(code, noPbr) {
  if (!PEERS) {
    try { PEERS = await (await fetch("data/peers.json?t=" + encodeURIComponent(DASH.updated_at))).json(); }
    catch (e) { return ""; }
  }
  const gs = peerGroupsFor(code);
  const calls = await peerCallsHTML(code);
  // 미국 빅테크는 PBR 비교가 의미 없어서 PBR 열과 ROE-PBR 산점도를 뺀다
  return gs.map((g, gi) => {
    const warns = g.rows.filter((r) => r.warn && !noPbr).map((r) => `${esc(r.name)}: ${esc(r.warn)}`);
    const seg = g.sort === "seg", open = peerMain(g, code);
    const cnt = ["US", "EU"].map((m) => `${FLAG[m]} ${g.rows.filter((r) => r.market === m).length}곳`).join(" · ");
    const body = `${g.why ? `<div class="note src" style="margin-top:0">${esc(g.why)} · ${seg ? "관련 부문 매출 큰 순 (그 부문이 없는 회사는 뒤에 시총 순)" : "시가총액 큰 순"} · ${cnt}</div>` : ""}
      <div class="tbl-wrap"><table class="compact"><thead><tr><th>회사</th>${seg ? "<th>관련 부문<br>연 매출</th>" : ""}<th>시총<br>(조원)</th><th>EPS<br>TTM</th><th>EPS<br>12MF</th><th>PER<br>TTM</th><th>PER<br>12MF</th><th>OPM</th>${noPbr ? "" : "<th>PBR</th>"}<th>ROE</th><th>배당</th></tr></thead><tbody>
      ${g.rows.map((r) => {
        const eps = (v) => (v == null ? "-" : `<span class="${v < 0 ? "dear" : ""}">${n(v, Math.abs(v) >= 100 ? 0 : 2)}</span>`);
        const per = (v, e) => (e != null && e <= 0 ? '<span class="dear">적자</span>' : v == null ? "-" : n(v, 1) + "x");
        const sg = r.seg ? `${r.seg_krw ? `<b>${n(r.seg_krw / 1e12, 1)}조</b>` : "-"}<br><span class="src">${esc(r.seg.n)} ${esc(String(r.seg.fy || ""))}${r.seg.exp != null ? ` · 수출 ${n(r.seg.exp, 0)}%` : ""}</span>` : "-";
        return `<tr${r.code === code ? ' class="me"' : ""}><td>${FLAG[r.market] || ""} ${esc(r.name)}${r.stale ? " ⚠" : ""}<br><span class="src">${esc(r.code)}</span></td>${seg ? `<td>${sg}</td>` : ""}
        <td>${r.cap_krw == null ? "N/A" : n(r.cap_krw / 1e12, 1)}</td><td>${eps(r.eps_ttm)}</td><td>${eps(r.eps_12mf)}</td>
        <td>${per(r.per_ttm, r.eps_ttm)}</td><td><b>${per(r.fwd_per, r.eps_12mf)}</b></td><td>${r.opm == null ? "-" : `<span class="${r.opm < 0 ? "dear" : ""}">${n(r.opm, 1)}%</span>`}</td>
        ${noPbr ? "" : `<td>${times(r.pbr, 2)}</td>`}<td>${pct(r.roe)}</td><td>${pct(r.div, 2)}</td></tr>`;
      }).join("")}
      </tbody></table></div>
      ${noPbr ? `<div class="note">미국 빅테크는 PBR 이 의미가 적어서 PBR 비교는 뺐어요.</div>` : `<div class="chart-title">ROE(가로) vs PBR(세로) <span class="src">오른쪽 아래일수록 'ROE 에 비해 PBR 이 낮음'</span></div>
      <div class="chart-box tall"><canvas id="peer-scatter-${gi}"></canvas></div>
      <div id="peer-legend-${gi}"></div>`}
      <div class="note src">시총은 원화 환산(환율: 달러 ${n(PEERS.fx.USD, 0)} · 유로 ${n(PEERS.fx.EUR, 0)} · 엔 ${n(PEERS.fx.JPY, 2)}원) · 한국: 네이버 증권·와이즈리포트(선행 PER = 12개월 선행), ROE 는 최근 연간 실적 · 해외: 야후 파이낸스(선행 PER = 향후 12개월, ROE = 최근 12개월)${seg ? " · 관련 부문 매출 = 각 회사 연간 보고서의 그 사업부문 숫자를 지금 환율로" : ""} · ${esc(PEERS.updated_at)}
      ${warns.length ? "<br>" + warns.join("<br>") : ""}</div>`;
    return open ? `<h3>동종업계 비교 · ${esc(g.name)}</h3><div class="card">${body}</div>`
      : `<details class="card" style="margin-top:8px"><summary class="chart-title"><b>동종업계 비교 · ${esc(g.name)}</b> <span class="src">눌러서 열기</span></summary>${body}</details>`;
  }).join("") + calls;
}
// 그 종목의 비교 그룹: 주력(main)부터 펼치고 나머지는 접음 (main 이 없는 그룹은 holdings 모두 주력)
const peerMain = (g, code) => !g.main || g.main.includes(code);
function peerGroupsFor(code) {
  const gs = (PEERS?.groups || []).filter((g) => g.holdings.includes(code));
  return [...gs.filter((g) => peerMain(g, code)), ...gs.filter((g) => !peerMain(g, code))];
}
// 🎙 경쟁사 컨퍼런스콜 (config/peer_calls.yaml, 사용자 2026-11-03): 시총 큰 순 · 1조 미만 빼기 · 우리가 요약하는 종목은 그 요약을 그대로
let PCALL = null;
async function peerCallsHTML(code) {
  if (!PCALL) { try { PCALL = await (await fetch("data/peer_calls.json?t=" + Date.now(), { cache: "no-store" })).json() || {}; } catch (_) { PCALL = {}; } }
  const list = PCALL.lists?.[code];
  if (!list?.length) return "";
  const rowOf = {};
  (PEERS?.groups || []).forEach((g) => g.rows.forEach((r) => { rowOf[r.code] = r; }));
  // 최신 발표 순 (사용자 2026-11-03 — 처음엔 시총 순) · 날짜가 같으면 시총 큰 순 · 요약 없는 곳은 맨 뒤
  const when = (x) => x.own?.date || x.e?.date || "";
  const ps = list.map((c) => { const own = (EARNINGS[c] || []).find((q) => !q.past); return { c, r: rowOf[c] || {}, own, e: own ? null : (PCALL.calls?.[c] || [])[0] }; })
    .filter((x) => x.r.cap_krw == null || x.r.cap_krw >= 1e12)
    .sort((a, b) => String(when(b)).localeCompare(String(when(a))) || (b.r.cap_krw ?? -1) - (a.r.cap_krw ?? -1));
  const li = (x) => `<li>${esc(x)}</li>`;
  const TGP = (await tgGet().catch(() => null))?.peers || {};  // 📨 텔레그램 '미국 주식 인사이더' 실적·어닝콜 요약 (collector/tg_reports.py PEER_Q)
  const item = (x) => {
    const { own, e } = x;
    const f = (TGP[x.c] || [])[0], newer = f && f.d > String(e?.date || own?.date || "");
    const feed = f ? `<div class="src">📨 미국 주식 인사이더 요약: <a href="${esc(f.u)}" target="_blank" rel="noopener">${esc(f.t)}</a> ${mdDay(f.d)}${newer ? " — 아래 우리 요약보다 새 글이에요 (다음 예약 작업 때 반영)" : ""}</div>` : "";
    const name = x.r.name || PCALL.names?.[x.c] || x.c, tag = PCALL.tags?.[x.c];
    const meta = [x.r.cap_krw != null ? `시총 ${n(x.r.cap_krw / 1e12, 1)}조` : "", own ? `${own.quarter}${own.date ? " · " + own.date : ""} · 우리 요약` : e ? `${e.quarter}${e.date ? " · " + e.date : ""}` : "아직 없음"].filter(Boolean).join(" · ");
    // 사용자 2026-11-03: 숫자 말고 '지난 콜 대비 달라진 점'(뉴팩트·어조·K뷰티 첫 언급·새 사업·비용)이 먼저 — 숫자는 접어 둠
    const ownDiff = (own?.diff || []).slice(0, 4).map((d) => `${d.t === "bad" ? "⚠" : d.t === "good" ? "🚀" : "🆕"} ${d.k}: ${d.b} → ${d.a}`);
    const diff = own ? ownDiff : e?.diff || [];
    const head = `${FLAG[x.r.market] || ""} <b>${esc(name)}</b>${tag ? ` <span class="qtag muted">${esc(tag)}</span>` : ""} ${e?.tone ? voiceTag(e.tone) : ""} <span class="src">${esc(meta)}</span>`
      + (diff[0] ? `<div class="src" style="font-weight:400;margin:2px 0 0 1.2em">📌 ${esc(diff[0])}</div>` : "");
    const diffBox = diff.length ? `<div class="chart-title" style="margin-top:6px"><b>📌 지난 콜${(own?.diff_from || e?.prev) ? ` ${esc(own?.diff_from || e.prev)}` : ""} 대비 달라진 점</b></div><ul class="irl">${diff.map(li).join("")}</ul>` : "";
    const nums = (vs, short) => (vs || short?.length ? `<details style="margin-top:4px"><summary class="src">🔢 숫자 보기</summary>${vs ? `<div class="note">${esc(vs)}</div>` : ""}<ul class="irl">${(short || []).map(li).join("")}</ul></details>` : "");
    const body = own ? `${diffBox}${(own.voice || []).slice(0, 1).map((v) => `<div class="note">💬 ${voiceTag(v.v)} “${esc(v.q)}”</div>`).join("")}${nums(null, (own.short || []).slice(0, 3))}<div class="note"><a href="#stock/${esc(x.c)}">이 종목 상세에서 전체 요약 보기 →</a></div>`
      : e ? `${e.none ? `<div class="note">ℹ️ ${esc(e.none)}</div>` : ""}${diffBox}${e.quote ? `<div class="note">💬 “${esc(e.quote)}”</div>` : ""}
        ${!diff.length ? `<ul class="irl">${(e.short || []).map(li).join("")}</ul>` : ""}${e.guide ? `<div class="note">🧭 가이던스: ${esc(e.guide)}</div>` : ""}
        ${e.us ? `<div class="kidbox" style="margin-top:6px">👉 우리 종목에는: ${esc(e.us)}</div>` : ""}${diff.length ? nums(e.vs, e.short) : e.vs ? `<div class="note src">${esc(e.vs)}</div>` : ""}
        <div class="src">${esc(e.src || "")}${e.u ? ` · <a href="${esc(e.u)}" target="_blank" rel="noopener">원문 보기</a>` : ""}</div>`
      : `<div class="note src">요약이 아직 없어요.</div>`;
    return `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:6px">${head}${newer ? ` <span class="qtag">📨 새 실적 요약 ${mdDay(f.d)}</span>` : ""}</summary>${feed}${body}</details>`;
  };
  return `<h3>🎙 경쟁사 컨퍼런스콜</h3><div class="card"><div class="note src">최신 발표 순 · 📌 = 지난 콜 대비 달라진 점 (🆕 새 사실 · 💪 어조·포부 · 🇰🇷 K-뷰티·한국 언급 · 🚀 성장성 · 🧭 새 사업 · ⚠ 비용·위험) · 시총 1조 원 미만은 빼요 · 눌러서 열기</div>${ps.map(item).join("")}</div>`;
}
function drawPeers(code) {
  if (!PEERS) return;
  const C = themeColors();
  peerGroupsFor(code).forEach((g, gi) => {
    const cv = document.getElementById(`peer-scatter-${gi}`);
    if (!cv) return;
    const pts = (f) => g.rows.filter((r) => r.roe != null && r.pbr != null && f(r)).map((r) => ({ x: r.roe, y: r.pbr, name: r.name }));
    const ds = [
      { label: "국내", data: pts((r) => r.market === "KR" && r.code !== code), backgroundColor: C.s1, pointRadius: 6, pointHoverRadius: 8 },
      { label: "해외", data: pts((r) => r.market !== "KR" && r.code !== code), backgroundColor: C.s3, pointRadius: 6, pointHoverRadius: 8 },
      { label: "내 종목", data: pts((r) => r.code === code), backgroundColor: C.s2, pointRadius: 10, pointHoverRadius: 12, borderColor: C.surface, borderWidth: 2 },
    ];
    const ys = ds.flatMap((d) => d.data.map((p) => p.y)).filter((v) => v > 0);
    const logY = ys.length && Math.max(...ys) / Math.min(...ys) > 15; // 차이가 너무 크면 로그 눈금
    if (charts.has(cv.id)) charts.get(cv.id).destroy();
    charts.set(cv.id, new Chart(cv, {
      type: "scatter", data: { datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false },
          tooltip: { backgroundColor: C.surface, titleColor: C.ink, bodyColor: C.ink, borderColor: C.grid, borderWidth: 1,
            callbacks: { label: (c) => ` ${c.raw.name}: ROE ${c.raw.x.toFixed(1)}% · PBR ${c.raw.y.toFixed(2)}배` } } },
        scales: {
          x: { title: { display: true, text: "ROE (%)", color: C.muted }, grid: { color: C.grid }, ticks: { color: C.muted } },
          y: { type: logY ? "logarithmic" : "linear", title: { display: true, text: logY ? "PBR (배, 로그 눈금)" : "PBR (배)", color: C.muted },
            grid: { color: C.grid }, ticks: { color: C.muted, callback: (v) => (logY && ![0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].includes(v) ? "" : +v.toFixed(2)) } },  // 2.4000000000000004 → 2.4 (사용자 11/5: 소수점 2자리까지)
        },
      },
    }));
    document.getElementById(`peer-legend-${gi}`).innerHTML = `<div class="legend">${ds.map((d) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;border:0;background:${d.backgroundColor}"></i>${d.label}</span>`).join("")}</div>`;
  });
}

async function openStock(code) {
  const sheet = $("#sheet");
  sheet.classList.add("open");
  document.body.style.overflow = "hidden";
  const c = DASH.stocks.find((x) => x.code === code);
  $("#sheetTitle").textContent = c ? c.name : code;
  $("#sheetBody").innerHTML = `<div class="empty">불러오는 중…</div>`;
  sheet.scrollTop = 0;
  try {
    const d = await (await fetch(`data/stocks/${code}.json?v=${encodeURIComponent(DASH.updated_at)}`)).json();
    const peerHtml = await peersBlock(code, d.market === "US");
    const orderHtml = await ordersBlock(code);
    const holderHtml = await holdersBlock(code);
    const usedCar = AUTO_CODES.includes(code) ? manheimBlock() : "";
    const brokerHtml = await brokerBlock(code, d.price, d.currency);
    const tourHtml = await tourBlock(code);
    const kpiHtml = await kpiBlock(code, d);
    const growHtml = await growthBlock(code, d);
    const issueHtml = (await filingsBlock(code)) + (await repBlock(code)) + estHTML(d) + cycHTML(code) + patHTML(d) +(await keyBlock(code));  // 📰 핵심 이슈 칸은 뺌 (사용자 11/5)
    const capexHtml = (await cloudBlock(code)) + (await capexBlock(code));
    const liHtml = LI_CODES.includes(code) ? (await liGet(), liHTML(code)) : DR_CODES.includes(code) ? (await drGet(), drHTML(code)) : "";  // 🪨 셀 회사는 맨 위에 탄산리튬 · 💾 메모리 회사는 D램 값
    await consGet();
    const consG = consFor(code), consHtml = consG ? consHTML(consG, false) : "";  // 📈 그 종목 업종 컨센서스 (닫아 둠)
    try { await gpeGet(); } catch (_) { /* 🌍 글로벌 비교 그림만 빠짐 */ }
    const EXP_CODE = { "003230": ["ramen", "🍜 라면 수출"], "278470": ["cosmetics", "💄 화장품 수출"], "483650": ["cosmetics", "💄 화장품 수출"], "034020": ["power", "⚡ 전력기기 수출 (변압기·GIS·케이블)"],
      ...Object.fromEntries(["005380", "000270", "012330"].map((c) => [c, ["car", "🚗 자동차 수출 (산업부 월별·관세청)"]])),
      ...Object.fromEntries(["005930", "005935", "000660", "009150"].map((c) => [c, ["tech", "💾 반도체·IT 수출 (메모리·HBM·MLCC 등)"]])) }[code];  // 📦 수출 데이터 → 산업 탭 그 칸
    const expLink = EXP_CODE ? `<div class="note"><a href="#industry" data-kc="exp-${EXP_CODE[0]}">📦 ${EXP_CODE[1]} 월별 데이터 (관세청·2020년부터) → 산업 탭에서 보기</a></div>` : "";
    $("#sheetBody").innerHTML = detailHTML(d).replace("<!--profile-->", () => liHtml + (PREF_COMMON[code] ? `<div class="card">${prefBox({ code })}</div>` : "") + kqHTML(d) + (!d.kq && (IRB[code] || IRB[PREF_COMMON[code]]) ? `<h3>📋 IR 요약 · IR 분석 <span class="src">회사 발표 → 해석 · 숫자·그래프는 바로 위, 심층 요약은 아래</span></h3>${irBriefHTML(code, d.card?.name)}` : "") + growHtml + consHtml + (d.kq && !(EARNINGS[code] || []).length ? "" : earningsHTML(code)) + issueHtml + segcHTML(d) + segBlock(d) + capexHtml + expwHTML(code) + expLink + kpiHtml + globalPeHTML(d) + bandChartsHTML(d, "", "button", pbrFirstOf(d.card)) + perValHTML(d) + longCagrHTML(d) + (d.kq ? "" : (d.longq ? `<div class="card">${longHTML(d)}</div>` : "") + qtrHTML(d)) + profileHTML(code) + precheckHTML(d)) + brokerHtml + usedCar + orderHtml + holderHtml + flowHTML(d) + peerHtml + tourHtml;
    drawDetailCharts(d);
    prefFill();
    wireBandCharts(d, "");
    drawProfile(code);
    wirePrecheck();
    if (usedCar) wireManheim();
    drawOrders(code);
    drawHolders(code);
    drawPeers(code);
    drawTour();
    if (GOTO) { const g = GOTO; GOTO = null; setTimeout(() => document.getElementById(g)?.scrollIntoView({ block: "start" }), 300); }  // 위 그림이 다 그려진 뒤 바로 이동 (부드럽게 움직이면 중간에 멈춤)
  } catch (e) {
    $("#sheetBody").innerHTML = `<div class="empty">상세 데이터를 불러오지 못했어요.</div>`;
  }
}
function closeSheet() {
  $("#sheet").classList.remove("open");
  document.body.style.overflow = "";
}
function route() {
  const m = location.hash.match(/^#stock\/(\w+)/);
  if (m) openStock(m[1]); else { closeSheet(); showView(); }
}

/* ---------- 5. S&P500 PER 밴드 ---------- */
// 크로스체크: 우리 숫자 vs 우산(NNN) 채널 (5% 넘게 다르면 ⚠)
function crossCheck() {
  const w = DASH.market.woosan, el = $("#crossCheck");
  if (!el) return;
  if (!w) { el.innerHTML = `<div class="empty">우산 채널 숫자를 아직 못 받았어요.</div>`; return; }
  const k = DASH.market.kospi_forward || {}, sp = DASH.market.sp500_forward || {};
  const st = (code) => DASH.stocks.find((c) => c.code === code)?.fwd_per;
  const rows = [
    ["KOSPI 12m fwd P/E", k.value, w.kospi_pe, "배"], ["KOSPI 12m fwd P/E 3년 평균", null, w.kospi_pe3, "배"], ["KOSPI 12m fwd P/E 5년 평균", null, w.kospi_pe5, "배"],
    ["KOSPI 12m fwd 순이익(지배)", k.fwd_ni_jo, w.kospi_ni, "조원"], ["코스닥 12m fwd P/E", null, w.kosdaq_pe, "배"],
    ["S&P500 12m fwd P/E", sp.value, w.sp_pe, "배"], ["S&P500 12m fwd P/E 3년 평균", null, w.sp_pe3, "배"],
    ["S&P500 12m fwd P/E 5년 평균", sp.avg5, w.sp_pe5, "배"], ["S&P500 12m fwd EPS", sp.fwd12_eps, w.sp_eps, ""],
    ...[["GOOGL", "GOOG", "알파벳"], ["NVDA", "NVDA", "엔비디아"], ["MSFT", "MSFT", "마이크로소프트"], ["META", "META", "메타"], ["TSLA", "TSLA", "테슬라"], ["AAPL", null, "애플"], ["AMZN", null, "아마존"]]
      .map(([t, code, nm]) => [`${nm} 12m P/E`, code ? st(code) : null, (w.mag7 || {})[t], "배"]),
  ];
  el.innerHTML = `<div class="tbl-wrap"><table class="compact" style="width:100%"><thead><tr><th style="text-align:left">항목</th><th>이 사이트</th><th>우산 채널</th><th>차이</th></tr></thead><tbody>
    ${rows.filter((r) => r[2] != null).map(([lab, a, b, u]) => {
      const d = a != null && b ? (a / b - 1) * 100 : null;
      return `<tr><td>${esc(lab)}</td><td style="text-align:right">${a == null ? '<span class="src">없음</span>' : n(a, 1) + u}</td><td style="text-align:right">${n(b, 1)}${u}</td>
        <td style="text-align:right">${d == null ? "-" : `${Math.abs(d) > 5 ? "⚠ " : "✓ "}${pct(d, 1, true)}`}</td></tr>`;
    }).join("")}</tbody></table></div>
    <div class="note src">우산 채널 ${esc(w.date || "")} 글 기준 (매그7 ${esc(w.mag7_date || "")}) · <a href="${esc(w.url || "https://t.me/WoosanXNNN")}" target="_blank" rel="noopener">원문</a> ·
      이 사이트: 코스피 = 시총 상위 150개 중 컨센서스 있는 종목 합산, S&P500 = FactSet 주간 보고서, 종목 = 12MF EPS(야후·나스닥·Finviz) 기준 · 채널은 Yardeni·LSEG(Datastream) 기준이라 조금 다를 수 있어요 · 5% 넘게 다르면 ⚠</div>`;
}
function spBand() {
  const t = DASH.market.sp500_trailing;
  const f = DASH.market.sp500_forward;
  const el = $("#spBand");
  if (!t || !t.hist) { el.innerHTML = `<div class="empty">N/A — S&P500 PER 데이터를 받지 못했어요.</div>`; return; }
  const tcur = t.hist[t.hist.length - 1];
  el.innerHTML = `<div class="tiles">
      <div class="tile"><div class="tl">선행 12개월 PER</div><div class="tv">${f ? times(f.value) : "N/A"}</div><div class="src">FactSet · ${esc(f?.date || "")}</div></div>
      <div class="tile"><div class="tl">후행 PER (차트 기준)</div><div class="tv">${times(tcur[1])}</div><div class="src">multpl · ${esc(tcur[0])}</div></div>
    </div>
    <h3>후행 PER 밴드</h3>
    ${hBandHTML("sp")}
    <div class="note">차트는 후행 PER(지난 12개월 실적, ${esc(t.source)}) 기준이에요. 선행 PER 과거 이력은 무료 출처가 없어서 FactSet 값을 매번 모으고 있어요.</div>
    <h3>선행 PER 기준값 <span class="src">FactSet</span></h3>
    <div class="kv">
      <div class="k">선행 12개월 PER</div><div class="v">${f ? times(f.value) : "N/A"}</div>
      <div class="k">선행 PER 5년 평균</div><div class="v">${f ? times(f.avg5) : "N/A"}</div>
      <div class="k">선행 PER 10년 평균</div><div class="v">${f ? times(f.avg10) : "N/A"}</div></div>
    ${f && f.eps ? indexEPS(f, "sp") : `<div class="note">연도별 EPS: N/A (FactSet 보고서를 읽지 못했어요)</div>`}`;
  wireHBand("sp", t.hist, "S&P500 PER", "배", 1, 10);
}

/* 지수 연도별 EPS 표 + 'EPS × PER = 지수' 시나리오 */
function indexEPS(f, kind) {
  const ys = Object.keys(f.eps);
  const lvl = f.index;
  const extra = [["5년 평균", f.avg5], ["10년 평균", f.avg10]];
  const mults = [...(DASH.settings.index_scenarios?.sp500_per || [16, 18, 20, 22]).map((m) => [`${m}배`, m]), ...extra.map(([l, m]) => [`선행 ${l} ${m}배`, m])];
  const rows = mults.map(([label, m]) => ({ label, mult: null, cells: Object.fromEntries(ys.map((y) => [y, f.eps[y] ? Math.round(f.eps[y] * m) : null])) }));
  return `<h3>연도별 EPS·PER <span class="src">FactSet · ${esc(f.date)}</span></h3>
    <div class="tbl-wrap"><table><thead><tr><th></th>${ys.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>
      <tr><td>EPS ($)</td>${ys.map((y) => `<td>${f.eps[y] == null ? "N/A" : n(f.eps[y], 1)}</td>`).join("")}</tr>
      <tr><td>이익 증가율</td>${ys.map((y) => `<td>${f.growth?.[y] == null ? "N/A" : pct(f.growth[y], 1, true)}</td>`).join("")}</tr>
      <tr><td>PER (현재 지수 ${n(lvl)})</td>${ys.map((y) => `<td>${f.eps[y] ? times(lvl / f.eps[y]) : "N/A"}</td>`).join("")}</tr>
    </tbody></table></div>
    <div class="note">${esc(f.eps_note || "")}</div>
    <h3>지수 시나리오 (EPS × PER)</h3>${matrixTable(rows, ys, lvl, "PER ↓ · EPS →", "지수")}`;
}

/* 가로선 밴드 차트 (S&P500 PER, 코스피 PBR 등 지수 배수) */
function hBandHTML(id) {
  return `<div class="seg" id="${id}-seg"><button data-y="5">5년</button><button data-y="10" class="on">10년</button><button data-y="0">최대</button></div>
    <div class="chart-box tall"><canvas id="${id}-chart"></canvas></div><div id="${id}-legend"></div><div class="note" id="${id}-stats"></div>`;
}
function wireHBand(id, hist, name, unit, dg, startYears, marks = []) {
  const draw = (years) => {
    const C = themeColors();
    const dates = hist.map((x) => x[0]);
    const h = hist.slice(sliceYears(dates, years));
    const v = h.map((x) => x[1]).sort((a, b) => a - b);
    const q = (p) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
    const avg = v.reduce((a, b) => a + b, 0) / v.length;
    const lo = q(DASH.settings.band.low_pct / 100), hi = q(DASH.settings.band.high_pct / 100);
    const cur = h[h.length - 1][1];
    const posv = (v.filter((x) => x < cur).length / v.length) * 100;
    const ds = [
      { label: name, data: h.map((x) => x[1]), borderColor: C.s1 },
      { label: `상단 ${hi.toFixed(dg)}${unit}`, data: h.map(() => hi), borderColor: C.s4, borderDash: [6, 4] },
      { label: `평균 ${avg.toFixed(dg)}${unit}`, data: h.map(() => avg), borderColor: C.s2, borderDash: [6, 4] },
      { label: `하단 ${lo.toFixed(dg)}${unit}`, data: h.map(() => lo), borderColor: C.s3, borderDash: [6, 4] },
      // 내 기준선 (예: 코스피 PBR 0.8·0.9배)
      ...marks.map((m) => ({ label: `내 기준 ${m.value}${unit}`, data: h.map(() => m.value), borderColor: "#d03b3b", borderDash: [2, 3], borderWidth: 1.5 })),
    ];
    makeChart(document.getElementById(`${id}-chart`), h.map((x) => x[0]), ds, { fmt: (x) => x.toFixed(dg + 1) + unit, yfmt: (x) => x.toFixed(dg) });
    $(`#${id}-legend`).innerHTML = legend(ds.map((d) => [d.label, d.borderColor, !!d.borderDash]));
    $(`#${id}-stats`).innerHTML = `현재 <b>${cur.toFixed(dg + 1)}${unit}</b> · 밴드 위치 <b>${posv.toFixed(0)}%</b> <span class="src">(하단 0% · 상단 100%) ${h[0][0]} ~ ${h[h.length - 1][0]}</span>`;
  };
  draw(startYears);
  const seg = document.getElementById(`${id}-seg`);
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    draw(Number(b.dataset.y));
  });
}

/* ---------- 코스피 밸류에이션 ---------- */
function kospiCard() {
  const k = DASH.market.kospi_forward;
  const t = DASH.market.kospi_trailing || {};
  const el = $("#kospiBand");
  if (!k || !k.years) { el.innerHTML = `<div class="empty">N/A — 코스피 컨센서스를 계산하지 못했어요.</div>`; return; }
  const Y = k.years;
  const ys = Object.keys(Y.per);
  const lvl = k.level;
  const sc = DASH.settings.index_scenarios || {};
  const perRows = (sc.kospi_per || [8, 9, 10, 11, 12]).map((m) => ({ label: `${m}배`, mult: null, cells: Object.fromEntries(ys.map((y) => [y, Y.eps[y] ? Math.round(Y.eps[y] * m) : null])) }));
  const pbrRows = (sc.kospi_pbr || [0.8, 1.0, 1.2]).map((m) => ({ label: `${m}배`, mult: null, cells: Object.fromEntries(ys.map((y) => [y, Y.bps[y] ? Math.round(Y.bps[y] * m) : null])) }));
  const hasBand = t.pbr_hist && t.pbr_hist.length > 20;
  el.innerHTML = `<div class="tiles">
      <div class="tile"><div class="tl">선행 12개월 PER</div><div class="tv">${times(k.value)}</div><div class="src">직접 계산 · ${esc(k.date)}</div></div>
      <div class="tile"><div class="tl">선행 12개월 PBR</div><div class="tv">${times(k.fwd_pbr, 2)}</div><div class="src">직접 계산 · ROE ${pct(k.fwd_roe)}</div></div>
      <div class="tile"><div class="tl">12개월 선행 순이익</div><div class="tv">${k.fwd_ni_jo == null ? "N/A" : n(k.fwd_ni_jo, 1) + "조"}</div><div class="src">26E ${n(k.ni_jo?.[ys[0]], 0)}조 · 27E ${n(k.ni_jo?.[ys[1]], 0)}조</div></div>
      <div class="tile"><div class="tl">PBR (지난 실적)</div><div class="tv">${times(hasBand ? t.pbr : k.pbr_now, 2)}</div><div class="src">${hasBand ? "KRX · " + esc(t.date) : "직접 계산"}</div></div>
    </div>
    ${(DASH.settings.kospi_notes || []).length ? `<div class="memo">📝 <b>시장 코멘트 메모</b>${DASH.settings.kospi_notes.map((x) => `<br>· ${esc(x.text)} <span class="src">(${esc(x.source)}, ${esc(x.date)})</span>`).join("")}</div>` : ""}
    ${DASH.market.kospi_fwd_bands ? fwdBandHTML("kfpbr", "12개월 선행 PBR 밴드") + fwdBandHTML("kfper", "12개월 선행 PER 밴드") : ""}
    ${hasBand ? kospiMarksTable() : ""}
    <h3>PBR 밴드 (지난 실적 기준, KRX)</h3>
    ${hasBand ? hBandHTML("kp") : `<div class="warnbox">코스피 PBR 10년 이력은 한국거래소(KRX) 자료에만 있어요. KRX 계정을 연결하면 여기에 밴드 차트가 나와요.</div>`}
    <h3>연도별 EPS·BPS·PER·PBR <span class="src">코스피 ${n(lvl, 2)} 기준</span></h3>
    <div class="tbl-wrap"><table><thead><tr><th></th>${ys.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>
      <tr><td>EPS (지수 포인트)</td>${ys.map((y) => `<td>${n(Y.eps[y], 0)}</td>`).join("")}</tr>
      <tr><td>이익 증가율</td>${ys.map((y) => `<td>${Y.growth[y] == null ? "-" : pct(Y.growth[y], 1, true)}</td>`).join("")}</tr>
      <tr><td>PER</td>${ys.map((y) => `<td>${times(Y.per[y], 2)}</td>`).join("")}</tr>
      <tr><td>BPS (지수 포인트)</td>${ys.map((y) => `<td>${n(Y.bps[y], 0)}</td>`).join("")}</tr>
      <tr><td>PBR</td>${ys.map((y) => `<td>${times(Y.pbr[y], 2)}</td>`).join("")}</tr>
    </tbody></table></div>
    <div class="note">${esc(k.method)} · ${esc(k.source)}</div>
    <h3>코스피 시나리오: EPS × PER</h3>${matrixTable(perRows, ys, lvl, "PER ↓ · EPS →", "지수")}
    <h3>코스피 시나리오: BPS × PBR</h3>${matrixTable(pbrRows, ys, lvl, "PBR ↓ · BPS →", "지수")}
    <div class="note">시나리오 배수는 config/settings.yaml 의 index_scenarios 에서 바꿀 수 있어요.</div>`;
  if (hasBand) wireHBand("kp", t.pbr_hist, "코스피 PBR", "배", 2, 10, DASH.settings.kospi_pbr_marks || []);
  if (DASH.market.kospi_fwd_bands) {
    const kb = DASH.settings.kospi_bands || {};
    wireFwdBand("kfpbr", "f_bps", kb.pbr || [0.7, 0.8, 0.9, 1.0, 1.1], "PBR");
    wireFwdBand("kfper", "f_eps", kb.per || [5, 6, 7, 8], "PER");
  }
}

/* 코스피 12개월 선행 PER·PBR 밴드 (지수 선 + '선행 EPS·BPS × 배수' 선) */
function fwdBandHTML(id, title) {
  return `<h3>${title}</h3><div class="seg" id="${id}-seg"><button data-y="5" class="on">5년</button><button data-y="10">10년</button><button data-y="0">최대</button></div>
    <div class="chart-box tall"><canvas id="${id}-chart"></canvas></div><div id="${id}-legend"></div><div class="note" id="${id}-stats"></div>`;
}
function wireFwdBand(id, key, mults, unitName) {
  const B = DASH.market.kospi_fwd_bands;
  const draw = (years) => {
    const C = themeColors();
    const i0 = sliceYears(B.dates, years);
    const dates = B.dates.slice(i0), lv = B.level.slice(i0), f = B[key].slice(i0);
    const cols = [C.s3, C.muted, C.s7, "#d03b3b", C.s4, C.s2];
    const ds = [{ label: "코스피", data: lv, borderColor: C.s1, borderWidth: 2 },
      ...mults.map((m, i) => ({ label: `${m}배`, data: f.map((x) => (x ? Math.round(x * m) : null)), borderColor: cols[i % cols.length],
        borderDash: m === 1 ? [6, 3] : [], borderWidth: m === 1 ? 2 : 1.5 }))];
    makeChart(document.getElementById(`${id}-chart`), dates, ds, { fmt: (v) => n(v, 0), yfmt: (v) => n(v, 0) });
    $(`#${id}-legend`).innerHTML = legend(ds.map((d) => [d.label, d.borderColor, !!d.borderDash?.length]));
    const cur = lv[lv.length - 1], fc = f[f.length - 1];
    $(`#${id}-stats`).innerHTML = `지금 코스피 ${n(cur, 0)} = 선행 ${unitName} <b>${n(cur / fc, 2)}배</b> · ` +
      mults.map((m) => `${m}배 = <b>${n(fc * m, 0)}</b>`).join(" · ") + `<br><span class="src">${esc(B.note)}</span>`;
  };
  draw(5);
  const seg = document.getElementById(`${id}-seg`);
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    draw(Number(b.dataset.y));
  });
}

/* 금리 신호등 한국 카드 안에 넣는 코스피 PBR 요약 */
function kospiPbrBrief() {
  const t = DASH.market.kospi_trailing || {};
  const h = t.pbr_hist || [];
  if (!t.pbr || h.length < 20) return "";
  const dates = h.map((x) => x[0]);
  const v = h.slice(sliceYears(dates, 10)).map((x) => x[1]);
  const pos = (v.filter((x) => x < t.pbr).length / v.length) * 100;
  const ms = kospiMarks();
  return `<div class="memo" style="margin-top:12px">
    <b>코스피 PBR ${n(t.pbr, 2)}배</b> · 10년 밴드 ${n(pos, 0)}% 위치
    · 선행 PBR ${n(DASH.market.kospi_forward?.fwd_pbr, 2)}배
    ${ms.map((m) => `<br>· PBR ${m.value}배${m.label.startsWith("PBR") ? "" : ` (${esc(m.label.split(" (")[0])})`} = 코스피 선행 기준 <b>${m.level_f ? n(m.level_f, 0) : "N/A"}</b> <span class="nowrap">(${pct(m.chg_f, 0, true)})</span> · 지난 실적 기준 ${n(m.level, 0)}`).join("")}
    <br><a href="#kospiBand" onclick="document.getElementById('kospiBand').scrollIntoView({behavior:'smooth'});return false;">PBR 밴드 차트 보기 ↓</a></div>`;
}

/* 코스피 PBR 내 기준선: 그 PBR 이 되는 코스피 지수와 지금 대비 % */
function kospiMarks() {
  const t = DASH.market.kospi_trailing || {};
  const lvl = DASH.market.kospi_forward?.level;
  if (!t.pbr || !lvl) return [];
  const fp = DASH.market.kospi_forward?.fwd_pbr;
  return (DASH.settings.kospi_pbr_marks || []).map((m) => {
    const at = (lvl * m.value) / t.pbr;            // 지난 실적(KRX) PBR 기준
    const af = fp ? (lvl * m.value) / fp : null;     // 12개월 선행 PBR 기준 (증권사 차트와 같은 기준)
    return { ...m, level: at, chg: (at / lvl - 1) * 100, level_f: af, chg_f: af ? (af / lvl - 1) * 100 : null };
  });
}
function kospiMarksTable() {
  const ms = kospiMarks();
  if (!ms.length) return "";
  const t = DASH.market.kospi_trailing;
  const fp = DASH.market.kospi_forward?.fwd_pbr;
  return `<h3>내 기준선: 코스피가 얼마면? <span class="src">지금 선행 PBR ${n(fp, 2)}배 · 지난 실적 PBR ${n(t.pbr, 2)}배</span></h3>
    <div class="tbl-wrap"><table class="compact"><thead><tr><th>기준</th><th>PBR</th><th>선행 기준<br>코스피</th><th>지난 실적 기준<br>코스피</th></tr></thead><tbody>
    ${ms.map((m) => `<tr><td style="white-space:normal">${esc(m.label)}</td><td>${m.value}배</td>
      <td>${m.level_f ? n(m.level_f, 0) : "N/A"}<br><span class="src">${pct(m.chg_f, 1, true)}</span></td>
      <td>${n(m.level, 0)}<br><span class="src">${pct(m.chg, 1, true)}</span></td></tr>`).join("")}
    </tbody></table></div>
    <div class="note">선행 기준 = 12개월 선행 BPS(직접 계산, 증권사 차트와 같은 방식) · 지난 실적 기준 = KRX PBR. 자본(BPS)이 그대로라고 보고 계산했어요. 기준선은 config/settings.yaml 의 kospi_pbr_marks 에서 바꿀 수 있어요.</div>`;
}

/* ---------- 📡 신호 탭 (사용자 11/6: 맨 왼쪽 · PBR 탭을 안으로) — 코스피·코스닥·삼성전자·SK하이닉스: 지수(주가)가 얼마면 PBR·PER 이 몇 배인지 + 지금 자리 ---------- */
const SIG_REF = { d: "11/5", L: 5383.8, pbf: 1.02, pbt: 1.34, pef: 3.76, pet: 8.55 };  // 사용자 11/6 전달 증권사 표 (코스피, 비교용)
const niceStep = (x) => { const p = 10 ** Math.floor(Math.log10(x)); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= x); };  // x 보다 크거나 같은 '딱 떨어지는' 간격 (코스피 200 · 삼성 1만 · 하이닉스 5만)
function sigTable(o) {  // o = {name, unit, L 지금 수준, date, m {pbf 12MF PBR, pbt TTM PBR, pef 12MF PER, pet TTM PER}, marks [{v, kind, t}], pos, src}
  const st = niceStep(o.L * 0.0325), lv = [o.L];  // 지금 ~ -26% 를 8~9줄로
  for (let x = Math.ceil(o.L / st) * st + st; x >= o.L * 0.74; x -= st) if (Math.abs(x - o.L) > st * 0.2) lv.push(x);
  lv.sort((a, b) => b - a);
  const K = ["pbf", "pbt", "pef", "pet"], d = o.dec || 0;
  const rows = lv.map((x) => { const now = x === o.L;
    return `<tr${now ? ' style="background:var(--warn-bg);font-weight:700"' : ""}><td style="text-align:left;white-space:nowrap">${n(x, now ? d : 0)}${now ? " ◀ 지금" : ` <span class="src">${pct((x / o.L - 1) * 100, 0, true)}</span>`}</td>${K.map((k) => `<td>${o.m[k] > 0 ? n((o.m[k] * x) / o.L, 2) : "-"}</td>`).join("")}</tr>`; }).join("");
  const mk = (o.marks || []).filter((m) => o.m[m.kind] > 0).map((m) => { const x = (o.L * m.v) / o.m[m.kind]; return `${esc(m.t)} = <b>${n(x, 0)}</b> (${pct((x / o.L - 1) * 100, 0, true)})`; });
  return `<div class="card" style="margin-bottom:10px"><div class="chart-title"><b>${esc(o.name)}</b> <span class="src">${esc(o.date || "")}</span></div>
    <div class="tbl-wrap"><table class="compact" style="width:100%"><thead><tr><th rowspan="2" style="text-align:left">${esc(o.unit)}</th><th colspan="2">PBR (배)</th><th colspan="2">PER (배)</th></tr><tr><th>12MF</th><th>TTM</th><th>12MF</th><th>TTM</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${o.pos ? `<div class="note">📍 ${o.pos}</div>` : ""}${mk.length ? `<div class="note">📏 ${mk.join(" · ")}</div>` : ""}<div class="note src">${o.src}</div>${o.extra || ""}</div>`;
}
// 📈 표 아래 밴드 차트 (사용자 11/6, 닫힘): 지수 = 시장 탭과 같은 함수(fwdBand·hBand)·같은 자료 · 종목 = 상세 화면과 같은 bandAllRender (한 번 갱신되면 같이 바뀜)
const idxBandBox = (k, what) => `<details class="fvt idxband" data-k="${k}"><summary class="chart-title">📈 밴드 차트 <span class="src">${what} · 5년·10년·최대 · 눌러서 열기</span></summary><div class="ibb"></div></details>`;
const stockBandBox = (code) => `<details class="fvt bandall" data-code="${esc(code)}"><summary class="chart-title">📈 밴드 차트 <span class="src">12MF PBR·PER 밴드 · PBR·PER 밴드 · 선행 PER·PBR 추이 + 적정주가 표 · 5년·10년·최대 · 눌러서 열기</span></summary><div class="bwb src">불러오는 중…</div></details>`;
document.addEventListener("toggle", (e) => {
  const el = e.target;
  if (!el.classList?.contains("idxband") || !el.open || el.dataset.done) return;
  el.dataset.done = 1;
  const M = DASH.market || {}, box = el.querySelector(".ibb"), kb = DASH.settings.kospi_bands || {};
  if (el.dataset.k === "kospi") {
    const kt = M.kospi_trailing || {};
    // 순서 (사용자 11/7): 12MF PBR → PBR → 12MF PER → PER
    box.innerHTML = (M.kospi_fwd_bands ? fwdBandHTML("sg-kfpbr", "12개월 선행 PBR 밴드") : "")
      + (kt.pbr_hist?.length > 20 ? `<h3>PBR 밴드 <span class="src">지난 실적 · KRX</span></h3>${hBandHTML("sg-kpbr")}` : "")
      + (M.kospi_fwd_bands ? fwdBandHTML("sg-kfper", "12개월 선행 PER 밴드") : "")
      + (kt.hist?.length > 20 ? `<h3>PER 밴드 <span class="src">지난 실적 · KRX</span></h3>${hBandHTML("sg-kper")}` : "") || `<div class="src">밴드 자료가 없어요</div>`;
    if (M.kospi_fwd_bands) { wireFwdBand("sg-kfper", "f_eps", kb.per || [5, 6, 7, 8], "PER"); wireFwdBand("sg-kfpbr", "f_bps", kb.pbr || [0.7, 0.8, 0.9, 1.0, 1.1], "PBR"); }
    if (kt.hist?.length > 20) wireHBand("sg-kper", kt.hist, "코스피 PER", "배", 1, 10);
    if (kt.pbr_hist?.length > 20) wireHBand("sg-kpbr", kt.pbr_hist, "코스피 PBR", "배", 2, 10, DASH.settings.kospi_pbr_marks || []);
  } else {
    const kq = M.kosdaq_trailing || {};
    // 코스피와 같은 순서 (PBR → PER) · 코스닥 12MF 밴드는 무료 과거 자료가 없어 빠짐
    box.innerHTML = ((kq.pbr_hist?.length > 20 ? `<h3>PBR 밴드 <span class="src">지난 실적 · KRX</span></h3>${hBandHTML("sg-qpbr")}` : "")
      + (kq.hist?.length > 20 ? `<h3>PER 밴드 <span class="src">지난 실적 · KRX</span></h3>${hBandHTML("sg-qper")}` : "") || `<div class="src">밴드 자료가 없어요</div>`)
      + `<div class="note src">12MF PBR·PER 밴드는 코스닥 선행 실적의 무료 과거 자료가 없어서 아직 없어요 (코스피만)</div>`;
    if (kq.hist?.length > 20) wireHBand("sg-qper", kq.hist, "코스닥 PER", "배", 1, 10);
    if (kq.pbr_hist?.length > 20) wireHBand("sg-qpbr", kq.pbr_hist, "코스닥 PBR", "배", 2, 10);
  }
}, true);
/* ---------- 😱 CNN 공포·탐욕 지수 (📡 신호 탭 맨 위, 사용자 11/9: '숫자 바로 아래 선, 기간 탭에 따라 바뀌게') ← data/fng.json ---------- */
let FNG = null;
const FNG_TF = [["1m", "1개월", 1], ["3m", "3개월", 3], ["6m", "6개월", 6], ["1y", "1년", 12], ["all", "전체", 0]];
const fngRate = (v) => (v < 25 ? "극단적 공포" : v < 45 ? "공포" : v <= 55 ? "중립" : v <= 75 ? "탐욕" : "극단적 탐욕");
const fngCol = (v) => (v < 45 ? "var(--bad-ink)" : v <= 55 ? "var(--ink-2)" : "var(--s3)");
function fngChart(tf) {
  const H0 = FNG.hist, mo = FNG_TF.find((x) => x[0] === tf)?.[2], ex = new Set(FNG.exact || []);
  let from = "";
  if (mo) { const t = new Date(H0.at(-1)[0] + "T00:00:00Z"); t.setUTCMonth(t.getUTCMonth() - mo); from = t.toISOString().slice(0, 10); }
  const h = H0.filter((r) => r[0] > from), N = h.length, W = 380, H = 200, x0 = 26, x1 = W - 10, top = 8, bot = H - 20;
  const X = (i) => x0 + ((x1 - x0) * i) / Math.max(1, N - 1), Y = (v) => bot - (v / 100) * (bot - top);
  let g = `<rect x="${x0}" y="${Y(25)}" width="${x1 - x0}" height="${Y(0) - Y(25)}" fill="var(--bad)" fill-opacity=".08"/><rect x="${x0}" y="${Y(100)}" width="${x1 - x0}" height="${Y(75) - Y(100)}" fill="var(--s3)" fill-opacity=".08"/>`;
  g += [0, 25, 50, 75, 100].map((v) => `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"${v % 50 ? ' stroke-dasharray="3 3"' : ""}/><text x="${x0 - 3}" y="${Y(v) + 3}" text-anchor="end" class="qx">${v}</text>`).join("");
  g += `<text x="${x0 + 3}" y="${Y(25) + 10}" class="qx" style="fill:var(--bad-ink)">극단적 공포</text><text x="${x0 + 3}" y="${Y(100) + 10}" class="qx" style="fill:var(--s3)">극단적 탐욕</text>`;
  const step = Math.max(1, Math.ceil(N / 6));  // 아래 날짜: 1개월은 며칠마다, 길면 달이 바뀔 때
  h.forEach(([d], i) => {
    const lab = mo === 1 ? (i % step === 0 ? `${+d.slice(5, 7)}/${+d.slice(8)}` : "") : i && d.slice(5, 7) !== h[i - 1][0].slice(5, 7) && (mo !== 0 || ["01", "07"].includes(d.slice(5, 7))) && (mo <= 6 || +d.slice(5, 7) % 3 === 1) ? ym(d) : "";
    if (lab) g += `<line x1="${X(i)}" x2="${X(i)}" y1="${top}" y2="${bot}" stroke="var(--grid)"/><text x="${X(i)}" y="${bot + 13}" text-anchor="middle" class="qx">${lab}</text>`;
  });
  g += `<path d="${h.map((r, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(r[1]).toFixed(1)}`).join("")}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"/>`;
  g += `<circle cx="${X(N - 1)}" cy="${Y(h[N - 1][1])}" r="4" fill="var(--s1)"/>`;
  g += tipCols(X, (x1 - x0) / Math.max(1, N - 1), top, bot, h.map(([d, v]) => `${d}\n${v} · ${fngRate(v)}${ex.has(d) ? "" : "\n(그림에서 읽은 값 ±3)"}`));
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="CNN 공포·탐욕 지수 추이">${g}</svg>`;
}
function fngTab(b) {
  const box = b.closest(".fngbox"); box.querySelectorAll(".fngseg [data-tf]").forEach((x) => x.classList.toggle("on", x === b));
  box.querySelector(".fngin").innerHTML = fngChart(b.dataset.tf);
}
function fngHTML() {
  if (!FNG?.hist?.length) return "";
  const [d, v] = FNG.hist.at(-1);
  const span = (new Date(d) - new Date(FNG.hist[0][0])) / 864e5 > 400;
  return `<h3 style="margin-top:0">😱 CNN 공포·탐욕 지수 <span class="src">미국 주식시장 분위기 · 0~100 · ${esc(FNG.updated || d)}</span></h3><div class="card fngbox" style="margin-bottom:10px">
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><b style="font-size:40px;line-height:1;color:${fngCol(v)}">${v}</b><b style="font-size:17px;color:${fngCol(v)}">${fngRate(v)}</b><span class="src">${esc(d)} 기준</span></div>
    <div class="seg fngseg" style="margin-top:8px">${FNG_TF.filter((x) => x[0] !== "all" || span).map(([k, l]) => `<button data-tf="${k}" class="${k === "1y" ? "on" : ""}" onclick="fngTab(this)">${l}</button>`).join("")}</div>
    <div class="fngin">${fngChart("1y")}</div>
    <div class="kidbox" style="margin-top:6px">🐣 미국 투자자들이 지금 얼마나 겁먹었는지(0쪽)·들떴는지(100쪽)를 CNN 이 7가지 시장 숫자(주가 흐름·변동성·옵션·안전자산 등)로 매긴 점수예요. 25 아래(빨간 띠) = 겁이 아주 큰 때, 75 위(초록 띠) = 아주 들뜬 때. 선을 누르면 그날 숫자가 나와요.</div>
    <div class="note src">출처 CNN Fear &amp; Greed Index · ${esc(FNG.how || "")} · ⚠ CNN 이 프로그램 접속을 막아 두어 자동 갱신은 안 돼요 — 새 숫자를 보내 주시면 이어 붙여요</div></div>`;
}
const pctRank = (h, v, yrs = 10) => { const ds = h.map((x) => x[0]), a = h.slice(sliceYears(ds, yrs)).map((x) => x[1]).filter((x) => x > 0); return a.length ? { pos: (a.filter((x) => x < v).length / a.length) * 100, avg: a.reduce((s, x) => s + x, 0) / a.length, from: h[sliceYears(ds, yrs)]?.[0] } : null; };
async function signalHTML() {
  const M = DASH.market || {}, kf = M.kospi_forward || {}, kt = M.kospi_trailing || {}, kq = M.kosdaq_trailing || {}, ws = M.woosan || {}, out = [];
  try { FNG = FNG || await (await fetch("data/fng.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { /* 😱 공포·탐욕 칸만 빠짐 */ }
  if (kf.level && kf.value) {  // 코스피: 12MF = 시총 상위 150 컨센서스 합산(직접 계산) · TTM = KRX (같은 날 종가로 맞춤)
    const L = kf.level, adj = kt.level ? L / kt.level : 1, r = kt.pbr_hist ? pctRank(kt.pbr_hist, kt.pbr) : null;
    out.push(sigTable({ name: "코스피", unit: "지수", L, dec: 1, date: `${kt.date || kf.date} 종가 기준`,
      m: { pbf: kf.fwd_pbr, pbt: kt.pbr && kt.pbr * adj, pef: kf.value, pet: kt.per && kt.per * adj },
      marks: (DASH.settings?.kospi_pbr_marks || []).map((m) => ({ v: m.value, kind: "pbf", t: `12MF PBR ${m.value}배${m.label && !m.label.startsWith("PBR") ? ` (${m.label.split(" (")[0]})` : ""}` })),
      pos: r ? `TTM PBR ${n(kt.pbr, 2)}배 = ${esc(String(r.from || "").slice(0, 4))}년부터 10년 중 아래에서 <b>${n(r.pos, 0)}%</b> 자리 (10년 평균 ${n(r.avg, 2)}배)` : "",
      src: `12MF = 시총 상위 150곳 중 ${kf.used || "-"}곳 컨센서스 합산 (직접 계산) · TTM = KRX 지난 실적 · 📷 비교: 전달 증권사 표(${SIG_REF.d} ${n(SIG_REF.L, 1)}) PBR ${SIG_REF.pbf}·${SIG_REF.pbt} · PER ${SIG_REF.pef}·${SIG_REF.pet}`,
      extra: idxBandBox("kospi", "12MF PBR · PBR · 12MF PER · PER (지난 실적)") }));
  }
  if (kq.level && kq.pbr) {  // 코스닥: KRX 후행 PER·PBR (+ KRX 선행 PER, 없으면 우산 텔레그램 주간 12MF PER)
    const r = kq.pbr_hist ? pctRank(kq.pbr_hist, kq.pbr) : null, fpe = kq.fwd_per || (ws.kosdaq_pe ? ws.kosdaq_pe : null);
    out.push(sigTable({ name: "코스닥", unit: "지수", L: kq.level, dec: 2, date: `${kq.date} 종가 기준`, m: { pbf: null, pbt: kq.pbr, pef: fpe, pet: kq.per },
      pos: r ? `TTM PBR ${n(kq.pbr, 2)}배 = 10년 중 아래에서 <b>${n(r.pos, 0)}%</b> 자리 (10년 평균 ${n(r.avg, 2)}배)` : "",
      src: `TTM = KRX 지난 실적 · 12MF PER = ${kq.fwd_per ? "KRX 선행 PER" : `우산 텔레그램 주간 숫자 (${esc(ws.date || "")} 기준이라 지수와 날짜가 달라요)`} · 12MF PBR 은 무료 자료가 없어 비워 둠`,
      extra: idxBandBox("kosdaq", "PBR · PER (지난 실적)") }));
  } else out.push(`<div class="card" style="margin-bottom:10px"><b>코스닥</b> <span class="src">KRX 코스닥 PER·PBR 을 다음 데이터 갱신 때부터 받아요${ws.kosdaq_pe ? ` · 지금은 12MF PER ${n(ws.kosdaq_pe, 1)}배만 (우산 텔레그램 ${esc(ws.date || "")})` : ""}</span></div>`);
  const v = encodeURIComponent(DASH.updated_at);
  for (const code of ["005930", "000660", "005380", "000270"]) {  // 삼성전자 · SK하이닉스 · 현대차 · 기아 (사용자 11/6 순서)
    const c = DASH.stocks.find((x) => x.code === code);
    if (!c) continue;
    let d = {};
    try { d = await (await fetch(`data/stocks/${code}.json?v=${v}`)).json(); } catch (_) { /* TTM 칸만 빠짐 */ }
    const L = c.price, now = d.now || {}, adj = now.price ? L / now.price : 1, fm = c.fwd_mult || {}, b = d.bands?.PBR?.periods?.["10y"];
    const mk = ((PBR?.items || []).find((x) => x.code === code)?.marks || []).map(([val, lab]) => ({ v: val, kind: "pbf", t: `12MF PBR ${val}배 ${lab}` }));
    out.push(sigTable({ name: c.name, unit: "주가 (원)", L, date: `${d.price_date || ""} 종가 기준`.trim(),
      m: { pbf: fm.PBR?.["12MF"], pbt: now.pbr && now.pbr * adj, pef: fm.PER?.["12MF"], pet: now.per && now.per * adj }, marks: mk,
      pos: b ? `PBR (1년 뒤 BPS 기준) 10년 중 아래에서 <b>${n(b.pos, 0)}%</b> 자리 (하단 ${n(b.low, 2)} · 평균 ${n(b.avg, 2)} · 상단 ${n(b.high, 2)}배)` : "",
      src: `12MF = 증권사 컨센서스 앞으로 12개월 EPS·BPS (카드 위 숫자와 같음) · TTM = 네이버 지난 실적 PER·PBR${mk.length ? " · 📏 = 🧮 PBR 기준선 (아래 계산기와 같음)" : ""}`, extra: pbrNoteHTML(code) + stockBandBox(code) }));
  }
  // 📈 밴드 차트 (사용자 11/6): 보유 종목마다 눌러서 — bandAllRender (그림 먼저, 그다음 카드와 같은 적정주가 표)
  const own = DASH.stocks.filter((c) => grp(c) === "보유" && !/우$/.test(c.name)).sort((a, b) => (a.market === "US") - (b.market === "US"));
  const row = (c) => `<details class="fvt bandall" data-code="${esc(c.code)}" style="margin-top:4px"><summary class="chart-title"><b>${c.market === "US" ? "🇺🇸" : "🇰🇷"} ${esc(c.name)}</b> <span class="src">${money(c.price, c.currency)}${c.band_pos != null ? ` · 10년 자리 ${n(c.band_pos, 0)}%` : ""}${c.scen?.base ? ` · 적정주가 대비 ${pct((c.price / c.scen.base - 1) * 100, 0, true)}` : ""}</span></summary><div class="bwb src">불러오는 중…</div></details>`;
  const bands = `<details class="card" style="margin-top:12px"><summary class="chart-title" style="margin-top:0"><b>📈 밴드 차트 — 보유 종목</b> <span class="src">눌러서 열기 · 종목을 누르면 12MF·PBR·PER 밴드 · 선행 PER·PBR 추이 + 적정주가 표 · 5년·10년·최대</span></summary>
    <div class="kidbox" style="margin-top:6px">🐣 밴드 선은 '그 배수를 받으면 주가가 얼마인지'예요. 오른쪽(앞으로)은 증권사 이익 추정치로 그린 선이라, 지금 주가가 어느 선 근처인지 볼 수 있어요. 그림을 누르면 그 날 숫자가 나와요.</div>${own.map(row).join("")}</details>`;
  return `${fngHTML()}<div class="kidbox" style="margin-bottom:10px">🐣 위에서 아래로 갈수록 '지수(주가)가 이만큼 빠지면 PBR·PER 이 몇 배가 되나'예요. 노란 줄이 지금이에요. <b>12MF</b> = 앞으로 12개월 예상 실적 기준, <b>TTM</b> = 지난 12개월(지난 결산) 실제 실적 기준이에요. 이익이 크게 늘 때는 12MF 숫자가 TTM 보다 훨씬 낮게 나와요.</div>${out.join("")}${bands}`;
}

/* ---------- PBR 계산기 (📡 신호 탭 아래쪽) ---------- */
let PBR = null;
async function loadPBR() {
  if (!PBR) {
    try { PBR = await (await fetch("data/pbr_watch.json?t=" + Date.now(), { cache: "no-store" })).json(); }
    catch (e) { $("#pbrCards").innerHTML = `<div class="empty">PBR 계산기 데이터를 불러오지 못했어요.</div>`; return; }
  }
  signalHTML().then((h) => { $("#signalBody").innerHTML = h; }).catch(() => { $("#signalBody").innerHTML = `<div class="empty">신호 표를 못 그렸어요.</div>`; });
  const base = PBR.base_year;
  $("#pbrIntro").innerHTML = `연도별 추정 BPS(주당순자산) × PBR 배수로 가격을 계산해요. <b>${esc(base)}</b> 열이 기준 연도예요. 갱신 ${esc(PBR.updated_at)}`;
  $("#pbrCards").innerHTML = PBR.items.map((it, i) => pbrCard(it, base, i)).join("") || `<div class="empty">config/pbr_watch.yaml 에 종목을 넣어 주세요.</div>`;
  PBR.items.forEach((it, i) => {
    const inp = document.getElementById(`calc-${i}`);
    const out = document.getElementById(`calc-out-${i}`);
    const run = () => {
      const p = Number(String(inp.value).replace(/[^\d.]/g, ""));
      if (!p) { out.textContent = ""; return; }
      const parts = Object.entries(it.bps).map(([y, b]) => `${y} ${b ? (p / b).toFixed(2) + "배" : "N/A"}`);
      out.innerHTML = `<b>${n(p)}원</b> = ${parts.join(" · ")} <span class="src">(지금보다 ${pct((p / it.price - 1) * 100, 1, true)})</span>`;
    };
    inp.addEventListener("input", run);
  });
}
const mfmt = (m) => m.toFixed(Math.round(m * 100) % 10 ? 2 : 1);
function pbrCard(it, base, i) {
  const ys = Object.keys(it.bps);
  const cls = (y) => (y === base ? "base" : "");
  const pbrVals = it.rows.map((r) => r.mult);
  const lo = Math.min(...pbrVals), hi = Math.max(...pbrVals);
  const pbrCell = (v) => (v == null ? "N/A" : `<span class="${v <= lo ? "pill green" : v >= hi ? "pill red" : ""}">${v.toFixed(2)}배</span>`);
  const b0 = it.bps[base];
  const sum = [];
  if (b0) {
    sum.push(`지금 <b>${n(it.price)}원</b> = ${esc(base)} PBR <b>${(it.price / b0).toFixed(2)}배</b>`);
    for (const r of [...it.rows].sort((a, b) => b.mult - a.mult)) {
      const p = r.prices[base];
      if (!p) continue;
      const c = r.chg[base];
      sum.push(`${esc(base)} PBR <b>${mfmt(r.mult)}배</b> = ${n(p)}원 <span class="${c < 0 ? "verdict red" : "verdict green"}" style="font-size:13px">(지금보다 ${pct(c, 0, true)})</span>`);
    }
  }
  const band = it.band10 ? `<div class="note">10년 PBR 밴드: ${it.band10.min != null ? `가장 낮았던 때 ${it.band10.min} · ` : ""}하단 ${it.band10.low} · 평균 ${it.band10.avg} · 상단 ${it.band10.high}${it.band10.max != null ? ` · 가장 높았던 때 ${it.band10.max}` : ""}배 · 지금 위치 <b>${n(it.band10.pos, 0)}%</b> <span class="src">(직전 연도 실적 기준)</span></div>` : "";
  // 📏 내 기준선 (사용자 11/5: 삼성전자 0.7배 = 저평가, 1배 = 매력적) — 연도마다 지금 PBR 이 어느 자리인지
  // + 11/5 증권사 시각 바닥 1.2배(삼성)·1.0배(하이닉스) — marks 세 번째 칸 = 누구 기준인지, 같은 배수는 이름을 합쳐 보여 줌
  const ms = [...(it.marks || [])].sort((a, b) => a[0] - b[0]), mk = (m) => ms.filter(([v]) => v === m).map(([, t]) => t).join(" · ");
  const where = (p) => {
    const z = ms.find(([v]) => p <= v), dn = ms.filter(([v]) => v < p).at(-1);
    return [z && `${z[0]}배(<b>${esc(mk(z[0]))}</b>) 아래`, dn && `${dn[0]}배(${esc(mk(dn[0]))})까지 ${pct((dn[0] / p - 1) * 100, 0, true)}`].filter(Boolean).join(" · ");
  };
  const who = {}; ms.forEach(([v, t, s = ""]) => (who[s] ||= []).push(`${v}배 ${esc(t)}`));
  const marks = ms.length ? `<div class="kidbox" style="margin-top:8px">📏 <b>기준선</b><ul class="irl">${Object.entries(who).map(([s, a]) => `<li>${a.join(" · ")}${s ? ` <span class="src">${esc(s)}</span>` : ""}</li>`).join("")}</ul>
    <b>지금은</b><ul class="irl">${ys.filter((y) => it.pbr[y]).map((y) => `<li>${esc(y)} <b>${it.pbr[y].toFixed(2)}배</b> — ${where(it.pbr[y])}</li>`).join("")}</ul></div>` : "";
  return `<div class="card">
    <div class="stock"><div class="row1"><span class="name">${esc(it.name)}</span><span class="price">${won(it.price)}</span></div></div>
    <div class="sub">${esc(it.date)} 기준 ${it.stale ? '<span class="stale">⚠ 직전 데이터</span>' : ""} · 최근 실적(${it.bps_last.year}) BPS ${n(it.bps_last.bps)} → PBR ${times(it.bps_last.pbr, 2)}</div>
    <div class="tbl-wrap"><table><thead><tr><th>구분</th>${ys.map((y) => `<th class="${cls(y)}">${y}${y === "12MF" ? '<br><span class="src">앞 12개월</span>' : ""}</th>`).join("")}</tr></thead><tbody>
      <tr><td>BPS</td>${ys.map((y) => `<td class="${cls(y)}">${n(it.bps[y])}</td>`).join("")}</tr>
      <tr><td>현재 PBR</td>${ys.map((y) => `<td class="${cls(y)}">${pbrCell(it.pbr[y])}</td>`).join("")}</tr>
      ${it.rows.map((r) => `<tr><td>PBR ${mfmt(r.mult)}${mk(r.mult) ? `<br><b style="white-space:normal">${esc(mk(r.mult))}</b>` : ""}</td>${ys.map((y) => `<td class="${cls(y)} ${r.chg[y] != null && Math.abs(r.chg[y]) < 10 ? "hot" : ""}">${r.prices[y] == null ? "N/A" : n(r.prices[y])}<br><span class="src">${pct(r.chg[y], 0, true)}</span></td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    ${it.auto_multiples ? `<div class="note">배수는 10년 PBR 밴드의 하단·평균·상단을 자동으로 넣었어요.</div>` : ""}
    ${sum.length ? `<ul class="summary">${sum.map((s) => `<li>${s}</li>`).join("")}</ul>` : ""}
    ${it.alert ? (it.alert.hit
      ? `<div class="memo" style="background:var(--good-bg);color:var(--good-ink)">✅ 지금 ${esc(it.alert.year)} PBR <b>${it.alert.pbr}배</b> — ${it.alert.below}배 이하예요. <span class="src">(${esc(it.alert.text)})</span></div>`
      : `<div class="memo">🎯 ${esc(it.alert.year)} PBR ${it.alert.below}배 = <b>${n(it.alert.target_price)}원</b> (지금보다 ${pct(it.alert.gap, 1, true)}) · 지금 ${it.alert.pbr}배 <span class="src">(${esc(it.alert.text)})</span></div>`) : ""}
    ${marks}${band}
    <div class="calc"><input id="calc-${i}" inputmode="numeric" placeholder="가격을 넣어 보세요 (예: 200000)" aria-label="${esc(it.name)} 가격 입력"></div>
    <div class="calc-out" id="calc-out-${i}"></div>
    ${Array.isArray(it.memo) ? `<details class="fvt"><summary class="chart-title">📝 메모·전달받은 글 <span class="src">${it.memo.length}개 · 눌러서 보기</span></summary><ul class="irl">${it.memo.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : it.memo ? `<div class="memo">📝 ${esc(it.memo)}</div>` : ""}
    <div class="note src">${esc(it.source)} · 굵은 칸 = 지금 가격과 10% 이내 · 표의 %는 지금 가격 대비</div>
  </div>`;
}
function showView() {
  const nc = location.hash.match(/^#news\/(\w+)/), rc = location.hash.match(/^#reports\/(\w+)/);  // 종목 상세에서 들어오면 그 종목만
  NEWS_CODE = nc ? nc[1] : "";
  REP_CODE = rc ? rc[1] : "";
  // 처음 열면 🧾 실적 보유 탭 (사용자 11/5) — 🇰🇷 보유는 #kr · 🧾 실적 관심은 #earnw (11/8, 같은 화면을 관심 종목으로)
  const view = { "": "earn", "#": "earn", "#kr": "main", "#pbr": "pbr", "#signal": "pbr", "#watch": "watch", "#uswatch": "uswatch", "#joint": "joint", "#market": "market", "#us": "us", "#earn": "earn", "#earnw": "earnw", "#earnj": "earnj", "#score": "score", "#news": "news", "#reports": "reports", "#industry": "industry", "#chart": "chart", "#compare": "compare", "#policy": "policy" }[nc ? "#news" : rc ? "#reports" : location.hash] || "main";
  const eg = { earn: "보유", earnw: "관심", earnj: "공동" }[view];  // 🧾 실적 보유 · 관심 · 공동 (같은 화면, 종목 묶음만 바꿈)
  $("#earnView").hidden = !eg;
  if (eg) { EARN_GRP = eg; renderEarn(); }  // 보유·관심·공동을 바꿔도 전체/한국/미국 고른 건 그대로
  $("#chartView").hidden = view !== "chart";
  if (view === "chart") loadAlign();
  $("#reportsView").hidden = view !== "reports";
  if (view === "reports") loadReports();
  $("#pbrView").hidden = view !== "pbr";
  $("#compareView").hidden = view !== "compare";
  if (view === "compare") renderCompare();
  $("#newsView").hidden = view !== "news";
  if (view === "news") loadNews();
  $("#industryView").hidden = view !== "industry";
  if (view === "industry") loadIndustry();
  $("#policyView").hidden = view !== "policy";
  if (view === "policy") renderPolicy();
  $("#marketView").hidden = view !== "market";
  $("#scoreView").hidden = view !== "score";
  if (view === "score") renderScore();
  // 🇰🇷 보유 / 🇺🇸 보유 는 같은 화면을 시장만 바꿔서 보여준다
  const mkt = view === "us" ? "US" : "KR";
  if ((view === "main" || view === "us") && MKT !== mkt) { MKT = mkt; renderTop(); renderCmp(); renderCards(); }
  $("#cmpTitle").textContent = MKT === "US" ? "미국 보유종목 비교표" : "한국 보유종목 비교표";
  $("#cardTitle").textContent = MKT === "US" ? "미국 보유종목 신호등" : "한국 보유종목 신호등";
  $("#mainView").hidden = !(view === "main" || view === "us");
  // 💼 보유 · ⭐ 관심 탭 하나씩, 안에서 🇰🇷 한국 · 🇺🇸 미국 (사용자 11/10: 실적 탭처럼) — #kr·#us·#watch·#uswatch 주소는 그대로
  document.querySelectorAll("#tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.view === (eg ? "earn" : { us: "main", uswatch: "watch" }[view] || view)));
  document.querySelectorAll(".mktseg a").forEach((a) => a.classList.toggle("on", a.dataset.v === view));
  $("#watchView").hidden = !(view === "watch" || view === "uswatch");
  $("#jointView").hidden = view !== "joint";
  if (view === "market") drawMarketCharts(); // 숨겨진 상태에서 그린 차트는 크기가 0이라 보일 때 다시 그림
  if (view === "pbr") loadPBR();
  if (view === "watch" || view === "uswatch") renderWatchTab(view === "uswatch" ? "US" : "KR");
  if (view === "joint") renderGroup("공동", "#jointCards");
}
// ⭐ 관심 탭도 보유 탭처럼 🇰🇷/🇺🇸 따로 (같은 화면, 시장만 바꿈) — 2027 주도섹터 그림·빠른 판단 표는 한국 종목뿐이라 🇰🇷 에만, 🆕 상장 준비 회사는 🇺🇸 에만
function renderWatchTab(mk) {
  CMPW.mkt = mk;
  $("#watchTitle").textContent = mk === "US" ? "🇺🇸 미국 관심종목" : "🇰🇷 한국 관심종목";
  $("#watchSectors").hidden = $("#watchQuick").hidden = mk === "US";
  renderGroup("관심", "#watchFull", mk);
  renderCmp(CMP_T.watch);
  jumpBar("#watchFull", "#watchJump");
  if (mk === "KR") loadWatch();
  ipoWatch(mk);
}
// 🆕 상장 준비 중인 관심 회사 (keychart.yaml ipo — 아직 주가가 없어 신호등·비교표 대신 실적 카드만)
async function ipoWatch(mk) {
  $("#ipoWatch").innerHTML = "";
  if (mk !== "US") return;
  const L = (await keyLoad()).ipo || [];
  if (location.hash !== "#uswatch") return;  // 기다리는 사이 다른 탭으로 갔으면 그리지 않음
  $("#ipoWatch").innerHTML = L.length ? `<h3>🆕 상장 준비 중 <span class="src">아직 주식이 없어 적정주가·비교표는 상장 뒤에 · 공시·보도 숫자로 그림 · 매수·매도 추천 아님</span></h3>
    ${L.map((c) => `${(c.top || []).length ? `<div class="kidbox" style="margin-top:8px">📌 <b>${esc(c.name || "")} 핵심</b><ul class="irl">${c.top.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}${keyCard(c, true)}`).join("")}` : "";
}
// 보유 말고도 보유종목처럼 다 추적하는 묶음 (stocks.yaml 의 watchlist = 관심, joint = 공동자산) — 매력적인 순 · mkt 를 주면 그 시장만
function renderGroup(g, el, mkt) {
  const rank = { green: 0, yellow: 1, red: 2, na: 3 }, mk = (c) => (c.market === "US" ? 1 : 0);
  const list = DASH.stocks.filter((c) => (grp(c) === g || (c.also || []).includes(g)) && (!mkt || (c.market === "US" ? "US" : "KR") === mkt)).sort((a, b) => mk(a) - mk(b) || (rank[a.verdict] ?? 3) - (rank[b.verdict] ?? 3) || (a.gap ?? 9) - (b.gap ?? 9));
  $(el).innerHTML = list.map(stockCard).join("") || `<div class="empty">config/stocks.yaml 의 ${g === "공동" ? "joint" : "watchlist"} 에 종목을 넣으면 여기에 보여요.</div>`;
  const ax = $({ "#watchFull": "#watchAccel", "#jointCards": "#jointAccel" }[el] || "#none");  // 📐 주봉 차트 모양 + 🚀 이익 증가율 가속 표 (보유 탭과 같은 칸, 11/5)
  if (ax) { ax.innerHTML = patAlertHTML(list) + accelHTML(list) + dotMapHTML(list, g, mkt); accSecFill(); }
  drawGauges(list);
  liGet().then(() => { const s = liStat(LI); if (s) LI_CODES.forEach((c) => $(el).querySelector(`.card.stock[data-code="${c}"] .pills`)?.insertAdjacentHTML("afterbegin", liPill(s))); });  // 🪨 셀 회사 카드에 리튬 한 줄
}

/* ---------- 🏭 산업 탭: 아마존 K-뷰티 Top100 품목 수 (config/amazon_kbeauty.yaml, 날마다 손으로 적음) ---------- */
let AMZ = null, AMZ_B = "";
/* ---------- 🗺 시장 그룹판 · 🔭 차트 스캔 (data/board.json · scan.json, collector/board.py — 밤·장 마감 뒤 따로 갱신) ---------- */
let BOARD = null, SCAN = null, SCAN_MKT = "kr";
const kcol = (v) => (v == null ? "" : v > 0 ? "kup" : v < 0 ? "kdn" : "");  // 오르면 빨강·내리면 파랑 (한국식)
const sg = (v, d = 0, u = "%") => (v == null ? "-" : `${v > 0 ? "+" : ""}${n(v, d)}${u}`);
function boardSpark(c) {
  const w = c.w.filter((v) => v != null);
  if (w.length < 10) return "";
  const W = 220, H = 74, x0 = 2, x1 = 186, top = 12, bot = 58, all = [...w, ...c.ma.filter((v) => v != null)];
  const lo = Math.min(...all), hi = Math.max(...all), X = (i) => x0 + ((x1 - x0) * i) / (c.w.length - 1), Y = (v) => bot - ((v - lo) / (hi - lo || 1)) * (bot - top);
  const path = (a) => a.map((v, i) => (v == null ? "" : `${i && a[i - 1] != null ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).join("");
  let g = `<path d="${path(c.ma)}" fill="none" stroke="var(--warn)" stroke-width="1.4" opacity=".85"/><path d="${path(c.w)}" fill="none" stroke="var(--ink)" stroke-width="1.3"/>`;
  c.dates.forEach((d, i) => { if (/\.(01|07)$/.test(d) && (i === 0 || c.dates[i - 1] !== d)) g += `<text x="${X(i)}" y="${H - 4}" text-anchor="middle" class="qx">${d}</text>`; });
  const li = c.w.length - 1;
  g += `<text x="${x1 + 3}" y="${Y(c.w[li]) + 4}" class="qv b">${sg(c.chg_2y)}</text>`;
  if (c.peak_2y != null && c.peak_2y > (c.chg_2y ?? 0) + 8) g += `<text x="${x1 + 3}" y="${top - 2}" class="qx">${sg(c.peak_2y)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.name)} 2년 주봉">${g}</svg>`;
}
function chipHTML(k, ch) {
  if (!ch) return "";
  const ar = ch.s === "up" ? "▲" : ch.s === "down" ? "▼" : ch.a ? "▲" : "▼";
  return `<span class="bchip ${ch.s}${ch.ch ? " chg" : ""}" title="${ch.s === "up" ? "이평 위·이평 상승" : ch.s === "down" ? "이평 아래·이평 하락" : "엇갈림"}${ch.ch ? " (오늘 바뀜)" : ""}">${k}${ar}</span>`;
}
// 🪜 와인스타인 4단계 판 (align.json stage ← collector/board.py stage) — 사용자 11/4: 스탠 와인스타인 『주식투자 최적의 타이밍을 잡는 법』 + 전달 그림 '한국 종목 단계 분포'
const STG = { 1: ["1단계", "바닥", "var(--muted)"], 2: ["2단계", "상승", "var(--bad)"], 3: ["3단계", "천장", "var(--warn)"], 4: ["4단계", "하락", "var(--s1)"] };
const stgTag = (s, run) => (STG[s] ? `<span class="sbadge" style="background:none;border:1.5px solid ${STG[s][2]};color:${STG[s][2]}">${STG[s][0]} ${STG[s][1]}${run ? ` · ${run}주째` : ""}</span>` : "");
const eun = (w) => ((w.charCodeAt(w.length - 1) - 0xac00) % 28 ? "은" : "는"), iga = (w) => ((w.charCodeAt(w.length - 1) - 0xac00) % 28 ? "이" : "가");
function stageSpark(c) {  // 2년 주봉 (검정) + 30주선 (주황) + 주마다 단계 배경색
  const W = 300, H = 112, x0 = 4, x1 = 258, top = 12, bot = 90, N = c.c.length;
  const vals = [...c.c, ...c.ma].filter((v) => v != null), lo = Math.min(...vals), hi = Math.max(...vals);
  const X = (i) => x0 + ((x1 - x0) * i) / (N - 1), Y = (v) => bot - ((v - lo) / (hi - lo || 1)) * (bot - top), bw = (x1 - x0) / (N - 1);
  let g = "";
  c.s.forEach((s, i) => { if (STG[s]) g += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${top}" width="${(bw + 0.4).toFixed(1)}" height="${bot - top}" fill="${STG[s][2]}" fill-opacity=".14"/>`; });
  c.t.forEach((d, i) => { if (i && d.slice(0, 5) !== c.t[i - 1].slice(0, 5) && /\.(01|07)$/.test(d.slice(0, 5))) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" class="qx">${d.slice(0, 5)}</text>`; });
  const path = (a) => a.map((v, i) => (v == null ? "" : `${i && a[i - 1] != null ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).join("");
  g += `<path d="${path(c.ma)}" fill="none" stroke="var(--warn)" stroke-width="1.6"/><path d="${path(c.c)}" fill="none" stroke="var(--ink)" stroke-width="1.6"/>`;
  g += `<text x="${x1 + 3}" y="${Y(c.c[N - 1]) + 4}" class="qv b">${sg(c.chg_2y)}</text>`;
  if (c.peak_2y != null && c.peak_2y > (c.chg_2y ?? 0) + 8) g += `<text x="${x1 + 3}" y="${top + 2}" class="qx">${sg(c.peak_2y)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.name)} 2년 주봉·30주선·단계">${g}</svg>`;
}
function stageDist(S) {  // 주마다 판정 대상 종목의 단계 비율 (아래부터 2 → 1 → 3 → 4, 가운데 점선 = 50%)
  const W = 600, H = 182, x0 = 4, x1 = 510, top = 8, bot = 156, T = S.t, N = T.length;
  const X = (i) => x0 + ((x1 - x0) * i) / (N - 1), Y = (p) => bot - (p / 100) * (bot - top);
  let g = "", base = Array(N).fill(0);
  const labs = [];
  [2, 1, 3, 4].forEach((k) => {
    const v = (S.dist[`s${k}`] || []).map((x) => x ?? 0), up = base.map((b, i) => b + v[i]);
    const pts = [...up.map((u, i) => `${X(i).toFixed(1)},${Y(u).toFixed(1)}`), ...base.map((b, i) => `${X(i).toFixed(1)},${Y(b).toFixed(1)}`).reverse()];
    g += `<polygon points="${pts.join(" ")}" fill="${STG[k][2]}" fill-opacity=".5"/>`;
    labs.push({ y: Y((base[N - 1] + up[N - 1]) / 2) + 4, t: `${STG[k][0]} ${n(v[N - 1], 0)}%`, col: STG[k][2] });
    base = up;
  });
  labs.forEach((l, i) => { if (i && l.y > labs[i - 1].y - 12) l.y = labs[i - 1].y - 12; });  // 아래부터 쌓으며 글자가 안 겹치게
  g += labs.map((l) => `<text x="${x1 + 5}" y="${l.y.toFixed(1)}" class="qx" style="fill:${l.col};font-weight:700">${l.t}</text>`).join("");
  g += `<line x1="${x0}" x2="${x1}" y1="${Y(50)}" y2="${Y(50)}" stroke="var(--ink)" stroke-dasharray="4 3" opacity=".55"/>`;
  T.forEach((d, i) => { if (i && d.slice(0, 5) !== T[i - 1].slice(0, 5) && /\.(01|07)$/.test(d.slice(0, 5))) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" class="qx">${d.slice(0, 5)}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="한국 종목 단계 분포 2년">${g}</svg>`;
}
function stageHTML(S, date) {
  if (!S?.sec?.length) return "";
  const secs = S.sec, D = S.dist, L = (S.t || []).length - 1, ago = Math.max(0, L - 4);
  const by = (k) => secs.filter((s) => s.st === k), nm = (a) => a.map((s) => s.name.split("·")[0]).join("·");
  const parts = [2, 1, 3, 4].map((k) => { const a = by(k); return !a.length ? (k === 2 ? "2단계는 없고" : "") : `${STG[k][0]} ${a.length}개${k !== 4 ? `(${nm(a)})` : ""}`; }).filter(Boolean);
  const chg = secs.filter((s) => s.prev && s.prev !== s.st);
  const pj = parts.join(", "), lc = pj.replace(/\)$/, "").slice(-1);
  const sum = `${S.idx.map((x) => `${x.name}${eun(x.name)} ${STG[x.st]?.[0] || "-"} ${x.run}주째(30주선 ${sg(x.gap, 0)})`).join(", ")}예요. 업종 ${secs.length}개 가운데 ${pj}${(lc.charCodeAt(0) - 0xac00) % 28 ? "이에요" : "예요"}.`
    + (chg.length ? ` 이번 주 ${chg.map((s) => `${s.name}${iga(s.name)} ${s.prev}→${s.st}단계`).join(", ")}로 바뀌었어요.` : "")
    + ` 종목 중 2단계 비중은 4주 전 ${n(D.s2[ago], 0)}% → ${n(D.s2[L], 0)}%, 4단계는 ${n(D.s4[ago], 0)}% → ${n(D.s4[L], 0)}%예요.`;
  const mem = (s) => `<details class="binfo" style="margin-top:4px"><summary class="src">ⓘ 구성 종목 ${s.n}개 · 어떤 업종을 묶었나</summary>
    <div class="src">${s.mem.slice(0, 40).map(([m, , st]) => `<span style="color:${STG[st]?.[2] || "inherit"}">●</span>${esc(m)}`).join(" · ")}${s.mem.length > 40 ? ` 외 ${s.mem.length - 40}개` : ""}</div>
    <div class="src" style="margin-top:4px">● 색 = 그 종목의 지금 단계 · 시가총액 큰 순 · 묶은 WICS 업종: ${(s.wics || []).map(esc).join(" · ")} · 이 업종 지수 = 위 종목들을 시가총액 크기만큼 섞음</div></details>`;
  const card = (c, idx) => `<div class="bcard"${idx ? ' style="border:2px solid var(--ink)"' : ""}><div class="bhd"><b>${esc(c.name)}</b><span class="${kcol(c.chg_w)} bchd">${sg(c.chg_w, 1)}</span></div>
    <div style="margin:2px 0">${stgTag(c.st, c.run)}${c.prev && c.prev !== c.st ? ` <span class="src">이번 주 ${c.prev}→${c.st}</span>` : ""}</div>${stageSpark(c)}
    <div class="src bft">${c.n ? `${c.n}종목 · ` : ""}30주선 대비 ${sg(c.gap, 0)} · 1개월 ${sg(c.r1m)}${c.rel3m != null ? ` · 3개월 상대 ${sg(c.rel3m, 0, "%p")}` : ""}${c.p2 != null ? ` · 종목 2단계 ${n(c.p2, 0)}%·4단계 ${n(c.p4, 0)}%` : ""}</div>${c.mem ? mem(c) : ""}</div>`;
  const rows = [[1, "바닥 (기초 다지기)", "오래 내린 뒤 30주선이 평평해지고, 주가가 선 위아래를 오가요", "아직 방향이 없어 기다리는 구간", "4단계 다음에 30주선이 평평하거나(4주 사이 ±1% 안) 주가와 선 방향이 엇갈림"],
    [2, "상승", "주가가 바닥 범위와 30주선 위로 올라서고, 선도 오르기 시작해요", "책에서 '사는 구간'으로 봐요 — 거래량이 같이 늘며 올라서면 더 믿을 만하다고 해요", "주가 > 30주선 그리고 30주선이 4주 전보다 +1% 넘게 오름"],
    [3, "천장", "많이 오른 뒤 30주선이 평평해지고, 주가가 선 위아래로 크게 흔들려요", "새로 사지 않고 번 것을 지키는 구간", "2단계 다음에 1단계와 같은 '애매한' 상태 (선이 평평하거나 방향이 엇갈림)"],
    [4, "하락", "주가가 30주선 아래로 내려가고, 선도 꺾여 내려가요", "책에서 '갖고 있지 말라'는 구간 — 싸 보여도 더 내릴 수 있다고 해요", "주가 < 30주선 그리고 30주선이 4주 전보다 -1% 넘게 내림"]];
  const how = `<details class="fvt"><summary class="chart-title" style="margin-top:8px">🔎 어떻게 나누나 — 책 내용 · 우리 계산 규칙 (눌러서 열기)</summary>
    <div class="kidbox" style="margin-top:6px">🐣 주가는 계절처럼 한 바퀴를 돌아요. 스탠 와인스타인은 <b>30주(약 7개월) 평균 가격선</b>을 기준으로 그 한 바퀴를 4단계로 나눴어요 — 땅을 다지고(1) · 오르고(2) · 꼭대기에서 흔들리고(3) · 내려가요(4). 그리고 다시 1단계로 돌아와요.</div>
    <div class="tbl-wrap"><table class="compact" style="width:100%;margin-top:6px"><thead><tr><th style="text-align:left">단계</th><th style="text-align:left">모양</th><th style="text-align:left">책에서 보는 법</th><th style="text-align:left">우리 계산 규칙</th></tr></thead><tbody>
      ${rows.map(([k, a, b, c2, d]) => `<tr><td style="text-align:left;white-space:nowrap"><b style="color:${STG[k][2]}">${k} ${a}</b></td><td style="text-align:left;white-space:normal">${b}</td><td style="text-align:left;white-space:normal">${c2}</td><td style="text-align:left;white-space:normal">${d}</td></tr>`).join("")}</tbody></table></div>
    <ul class="irl" style="margin-top:6px">
      <li>📅 주봉 = 금요일 종가 (끝난 주만) · 30주선 = 최근 30주 종가 평균 · 평일 아침·장 마감 뒤 다시 계산${date ? ` · 지금 ${esc(date)} 주 기준` : ""}</li>
      <li>🧮 처음 판정: 확실한 2·4단계가 나오기 전엔 30주선이 26주 전보다 높으면 3, 낮으면 1 · 그 뒤로는 '바로 전 확실한 단계'를 기억해서 2 다음 애매함 = 3, 4 다음 애매함 = 1</li>
      <li>👥 판정 대상 = 코스피·코스닥 보통주 중 그 주 시가총액 3,000억 이상 ${n(S.n)}종목 (리츠·인프라 펀드 빼고 — 📈 주봉 정배열과 같은 종목들)</li>
      <li>🏭 업종 = FnGuide WICS 업종(와이즈리포트)을 ${secs.length}개로 묶음 (3종목 미만 묶음은 뺌) · 업종 지수 = 그 업종 종목을 시가총액 크기만큼 섞어 매주 수익률을 이어 붙인 값 · 카드의 ⓘ 에 묶은 종목·업종</li>
      <li>📊 분포 그림 = 주마다 판정 대상 중 각 단계 종목 비율 · 빨강(2단계)이 두꺼울수록 오르는 종목이 많은 시장, 파랑(4단계)이 두꺼울수록 내리는 종목이 많은 시장</li>
      <li>🔢 카드 숫자: 30주선 대비 = 업종 지수 ÷ 30주선 − 1 · 1개월 = 4주 수익률 · 3개월 상대 = 13주 수익률 − 코스피 13주 수익률 · 종목 2단계·4단계 = 그 업종 종목 중 지금 2·4단계 비율 · 배경색 = 그 주의 업종 단계 · 코스피·코스닥 = 야후 지수 주봉</li>
      <li>⚠ 한계: 지금 시총 3,000억 이상인 종목으로만 과거를 계산해서 예전에 컸다가 작아진 종목은 빠져요 (생존 편향) · 책은 저항선·거래량·상대강도까지 눈으로 보지만 여기선 30주선 규칙만 기계적으로 써요 · 참고용 (매수·매도 추천 아님)</li></ul>
    <div class="note src">📚 스탠 와인스타인 『주식투자 최적의 타이밍을 잡는 법』(원서 Secrets for Profiting in Bull and Bear Markets) · 🗣 11/3 전달 글 (주식하는하루키 블로그): 사이클 주식(조선·방산·유행 타는 소비재)이나 한 번 크게 오른 주식에 잘 맞는 방법 · 지금 한국 업종 대부분(약 80%)이 3~4단계, 1~2단계는 20% 정도 · 다시 1~2단계로 가려면 매출·영업이익이 빨라지거나 앞으로의 기대가 올라가야 하는데 그런 업종이 아직 잘 안 보인다는 개인 의견 → 🚀 '이익 증가율이 1년 전보다 높아지나' 표(보유·관심 탭)와 같이 보기</div></details>`;
  return `<h3 data-jump="stage" data-jname="🪜 4단계 (한국)">🪜 와인스타인 4단계 — 한국 업종·종목 <span class="src">2년 주봉 · 30주선 · ${esc(date || "")} 주</span></h3>
    <div class="kidbox">${esc(sum)}</div>
    <div class="card" style="margin-top:8px;padding:8px 10px"><div class="chart-title"><b>한국 종목 단계 분포 · 2년 주봉</b></div>
      <div class="src">판정 대상 ${n(S.n)}종목 · 2단계 ${n(D.s2[L], 0)}% (4주 전 ${n(D.s2[ago], 0)}%) · 4단계 ${n(D.s4[L], 0)}% (4주 전 ${n(D.s4[ago], 0)}%) · 가운데 점선 = 50% · 빨강(2단계)이 두꺼울수록 사기 좋은 시장, 파랑(4단계)이 두꺼울수록 피할 시장 (책의 시각)</div>${stageDist(S)}</div>
    <div class="bgrid" style="margin-top:8px">${S.idx.map((x) => card(x, true)).join("")}${secs.map((s) => card(s)).join("")}</div>${how}`;
}
function boardHTML() {
  const B = BOARD;
  if (!B?.kr && !B?.us) return "";
  // ⓘ 무엇을 따라가나 (사용자 11/4): ETF 이름·기초지수 설명·상위 10 구성 종목 + 이 카드 숫자의 출처 (board.py etf_info, 7일마다)
  const info = (c, kr) => {
    const e = (B.etf || {})[c.sym] || {}, top = e.top || [];
    const what = kr && c.idx ? `${c.sym === "KOSPI" ? "유가증권시장(코스피)" : "코스닥시장"}에 상장된 종목 전체를 시가총액 크기만큼 섞은 지수예요 (큰 회사일수록 많이 반영).`
      : kr ? `${esc(e.n || `${c.sym} ETF`)}${e.by ? ` · ${esc(e.by)}` : ""}${e.aum ? ` · 순자산 ${esc(e.aum)}원` : ""}<br>${esc(e.desc || "")}` : `${esc(c.sym)} ETF — 아래 종목들을 이 비중대로 담아요.`;
    const list = top.length ? `<div class="src" style="margin-top:4px"><b>담은 종목 상위 ${top.length}</b>${e.cnt ? ` (전체 ${e.cnt}종목)` : ""}: ${top.map((t) => `${esc(t.n)} ${t.w == null ? "" : n(t.w, 1) + "%"}`).join(" · ")}</div>`
      : !c.idx || !kr ? `<div class="src" style="margin-top:4px">${kr ? "구성 종목 목록은 다음 갱신(KRX 자료) 때 채워져요." : "보유 종목 목록이 없는 ETF예요 (금·은·원유·코인처럼 실물·선물을 담음)."}</div>` : "";
    const src = kr && c.idx ? `가격 = 야후 ${c.sym === "KOSPI" ? "^KS11" : "^KQ11"} 지수` : kr ? `가격 = 네이버 ETF 일봉 (시장 가격) · 구성 = KRX 납입자산구성내역(PDF)` : `가격 = 야후 수정주가 · 구성 = 야후 상위 10 보유`;
    return `<details class="binfo" style="margin-top:4px"><summary class="src">ⓘ 무엇을 따라가나 · 구성 종목</summary><div class="src">${what}</div>${list}
      <div class="src" style="margin-top:4px">📏 ${src} · 칩: 일 = 50일선 · 주 = 30주선 · 월 = 10개월선 (선 위·선 오름 = ▲) · 2년 그림 = 주봉 종가와 30주선${c.idx ? "" : ` · 3개월 상대 = 이 ETF 3개월 수익률 − ${kr ? "코스피" : "S&P500(SPY)"} 3개월 수익률`}</div></details>`;
  };
  const card = (c, kr) => {
    const chg = Object.values(c.chips || {}).some((x) => x?.ch);
    return `<div class="bcard${c.idx ? " idx" : ""}${chg ? " bchg" : ""}"><div class="bhd"><b>${esc(c.name)}</b> <span class="src">${esc(c.idx ? "" : kr ? `${c.sym} ETF` : c.sym)}</span><span class="${kcol(c.chg_d)} bchd">${sg(c.chg_d, 1)}</span></div>
      ${boardSpark(c)}
      <div class="bchips">${chipHTML("일", c.chips?.d)}${chipHTML("주", c.chips?.w)}${chipHTML("월", c.chips?.m)}</div>
      <div class="src bft">1주 <b class="${kcol(c.r1w)}">${sg(c.r1w, 1)}</b> · 올해 <b class="${kcol(c.ytd)}">${sg(c.ytd, 1)}</b> · 1개월 ${sg(c.r1m)} · ${c.idx ? `52주 고점 대비 ${sg(c.dd52)}` : `3개월 상대 ${sg(c.rel3m, 0, "%p")}`}</div>${info(c, kr)}</div>`;
  };
  // 지수는 정해진 순서로 맨 앞 (코스피·코스닥 / S&P500·나스닥100·러셀2000·동일가중), 업종은 3개월 상대 강도 센 순서
  const IO = ["KOSPI", "KOSDAQ", "SPY", "QQQ", "IWM", "RSP"], r3 = (c) => c.rel3m ?? -999;
  const order = (list) => [...list.filter((c) => c.idx).sort((a, b) => IO.indexOf(a.sym) - IO.indexOf(b.sym)), ...list.filter((c) => !c.idx).sort((a, b) => r3(b) - r3(a))];
  const sec = (t, list, kr, jn) => (list?.length ? `<h3 data-jump="${jn}" data-jname="${jn}">${t}</h3><div class="bgrid">${order(list).map((c) => card(c, kr)).join("")}</div>` : "");
  return `<h2 data-jump="board" data-jname="🗺 시장 그룹판">🗺 시장 그룹판 <span class="src">일·주·월 추세 · 2년 주봉 종가와 30주선 · ${esc(B.updated_at || "")}</span></h2>
    <div class="note src">칩: <span class="bchip up">일▲</span> 이평 위·이평 상승 · <span class="bchip down">주▼</span> 이평 아래·이평 하락 · <span class="bchip mix">월▲</span> 엇갈림 · <span class="bchip up chg">일▲</span> 오늘 바뀜 · 일 = 50일선, 주 = 30주선, 월 = 10개월선 · 업종은 3개월 상대수익률(지수 대비) 순 · 주황 테두리 = 오늘 칩이 바뀐 곳 · 카드의 ⓘ 를 누르면 무엇을 따라가는지·구성 종목</div>
    ${sec("🇰🇷 한국 — 업종은 KRX 업종지수(구성종목 시총 가중)를 따라가는 ETF", B.kr, true, "🇰🇷 한국 업종")}${stageHTML(ALIGN?.stage, ALIGN?.date)}${sec("🇺🇸 미국 — 지수·섹터·산업 ETF", B.us, false, "🇺🇸 미국 업종")}${aiHTML(B.ai)}`;
}
// 🤖 주요 AI 인프라 상승추세 판단: 일봉 종가(검정) + 200일선(파랑) · 🟢 200일선 위 · 🟠 아래로 내려옴 (한 달 안에 바뀌면 🟢→🟠)
function aiHTML(list) {
  if (!list?.length) return "";
  const dot = (s) => `<span style="color:${s === "up" ? "var(--good)" : "var(--warn)"};font-size:18px">●</span>`;
  const card = (c) => {
    const W = 320, H = 170, x0 = 34, x1 = 312, top = 14, bot = 146, all = [...c.c, ...c.ma].filter((v) => v != null);
    const lo = Math.min(...all), hi = Math.max(...all), X = (i) => x0 + ((x1 - x0) * i) / (c.c.length - 1), Y = (v) => bot - ((v - lo) / (hi - lo || 1)) * (bot - top);
    const path = (a) => a.map((v, i) => (v == null ? "" : `${i && a[i - 1] != null ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).join("");
    let g = [lo, (lo + hi) / 2, hi].map((v) => `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${x0 - 4}" y="${Y(v) + 4}" text-anchor="end" class="qx">${n(v, v < 100 ? 1 : 0)}</text>`).join("");
    c.t.forEach((d, i) => { if (i && d.slice(0, 5) !== c.t[i - 1].slice(0, 5) && /\.(01|04|07|10)$/.test(d.slice(0, 5))) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" class="qx">${d.slice(0, 5)}</text>`; });
    g += `<path d="${path(c.ma)}" fill="none" stroke="var(--s1)" stroke-width="3"/><path d="${path(c.c)}" fill="none" stroke="var(--ink)" stroke-width="2"/>`;
    const L = c.c.length - 1, flip = c.days <= 20;  // 한 달(20거래일) 안에 상태가 바뀌었으면 끝을 동그라미로
    if (flip) g += `<circle cx="${X(L) - 6}" cy="${Y(c.c[L])}" r="16" fill="${c.s === "up" ? "var(--good)" : "var(--warn)"}" fill-opacity=".18" stroke="${c.s === "up" ? "var(--good)" : "var(--warn)"}" stroke-width="2"/>`;
    g += tipCols(X, (x1 - x0) / L, top, bot, c.t.map((d, i) => `${d}\n종가 $${n(c.c[i], 2)}${c.ma[i] != null ? `\n200일선 $${n(c.ma[i], 2)}` : ""}`));
    const sig = flip ? `${dot(c.s === "up" ? "down" : "up")}→${dot(c.s)}` : dot(c.s);
    return `<div class="card" style="padding:8px 10px"><div class="bhd"><b>${esc(c.name)}</b> <span class="src">${esc(c.what)} · ${esc(c.sym)}</span><span class="bchd">${sig}</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.name)} 일봉과 200일선">${g}</svg>
      <div class="src">$${n(c.c[L], 2)} <span class="${kcol(c.chg_d)}">${sg(c.chg_d, 1)}</span> · 200일선 $${n(c.ma[L], 2)} 대비 <b style="color:${c.s === "up" ? "var(--good)" : "var(--warn-ink)"}">${sg(c.gap, 1)}</b> · ${c.s === "up" ? "위" : "아래"} ${c.days}일째</div></div>`;
  };
  const down = list.filter((c) => c.s === "down");
  return `<h3 data-jump="ai" data-jname="🤖 AI 인프라 200일선">🤖 주요 AI 인프라 상승추세 판단 <span class="src">일봉 약 10개월 · 검정 = 종가 · <span style="color:var(--s1)">━</span> 200일선</span></h3>
    <div class="kidbox">🐣 200일선은 지난 200일(약 10개월) 평균 가격이에요. 주가가 이 선 위에 있으면 큰 흐름이 올라가는 중(🟢), 아래로 내려오면 큰 흐름이 꺾일 수 있다는 경고(🟠)예요. 지금 6곳 중 <b>${down.length}곳</b>${down.length ? `(${down.map((c) => esc(c.name)).join("·")})` : ""}이 200일선 아래예요.</div>
    <div class="grid g2" style="margin-top:8px">${list.map(card).join("")}</div>
    <div class="note src">${dot("up")} 200일선 위 · ${dot("down")} 200일선 아래 · ${dot("up")}→${dot("down")} 최근 한 달 안에 아래로 내려옴 (동그라미) · 사용자 전달 '주요 AI인프라 상승추세 판단'(10/31) 6종목 · 야후 수정주가 · 기술적 분석은 참고 수단일 뿐이에요 (매수·매도 추천 아님)</div>`;
}
// ✏️ 선 그은 차트 (board.json draw ← collector/board.py draw): 오닐 컵위드핸들 · 200일선 · 지지선·저항선 채널 — 갱신 때마다 새 가격으로 다시 계산
const DRAWBOX = [];  // 카드마다 (봉) => 차트 HTML
document.addEventListener("click", (e) => {
  const b = e.target.closest(".dtfseg [data-dtf]"); if (!b) return;
  const seg = b.closest(".dtfseg"), i = seg.dataset.di, box = document.querySelector(`.cbox[data-di="${i}"]`);
  if (!box || !DRAWBOX[i]) return;
  seg.querySelectorAll("[data-dtf]").forEach((x) => x.classList.toggle("on", x === b));
  box.innerHTML = DRAWBOX[i](b.dataset.dtf);
});
function drawHTML(list, at) {
  if (!list?.length) return "";
  const ST = { up: "컵 오른쪽이 올라오는 중", lip: "컵 오른쪽 입술 · 손잡이는 아직", handle: "손잡이 만드는 중", out: "손잡이 고점 돌파" };
  const ok = (b) => (b ? "✅" : "⬜");
  const card = (x, i) => {
    const fmt = (v) => (x.kr ? n(v, 2) : `$${n(v, 2)}`), wk = x.tf === "w", u = wk ? "주" : "일", p = x.cup, q = x.chn, m = x.ma200, t = x.ch.t, N = t.length;
    const lines = [], al = x.align, vs = x.vs;
    // 한국식 이평선 카드 (코스피, 사용자 전달 글 11/4): 이평선 배열 · 거래량 지지대 · 갭 상승
    if (al) { const ks = Object.keys(al.v); lines.push(`📉 이평선 ${ks.join("·")}일: <b style="color:${al.st === "역배열" ? "var(--warn-ink)" : al.st === "정배열" ? "var(--good)" : "inherit"}">${al.st}</b> ${al.run}일째${al.below_all ? " · <b>종가가 모든 이평선 아래</b>" : ""}`
      + `<div class="src">${ks.map((k) => `${k}일 ${fmt(al.v[k])} (${sg((x.last / al.v[k] - 1) * 100, 1)})`).join(" · ")} — 괄호 = 지금 종가가 그 선보다 얼마나 위·아래</div>`); }
    if (vs) lines.push(`🧱 거래량 지지대: <b>${fmt(vs.lo)} ~ ${fmt(vs.hi)}</b> (지금 대비 ${sg((vs.hi / x.last - 1) * 100, 1)}) — 최근 ${vs.n}일 거래량의 ${n(vs.share, 0)}% 가 이 가격대`
      + `<div class="src">지금 가격 아래에서 거래량이 가장 많이 쌓인 가격 칸 · 많이 사고판 가격일수록 받침이 강하지만, 깨지면 떨어지는 힘도 커요</div>`);
    if (x.gap) lines.push(`⤴ ${t[x.gap.i]} 갭 상승 (시가 ${sg(x.gap.pct, 1)}, 하루 종일 전날 고가 위) — 본전 매물을 건너뛰는 오름`);
    const w50 = wk ? x.ch.ma?.["50"]?.at(-1) : null;  // 주봉은 50주선(≈1년 평균)도
    if (m) lines.push(`200일선 ${fmt(m.v)} 대비 <b style="color:${m.s === "up" ? "var(--good)" : "var(--warn-ink)"}">${sg(m.gap, 1)}</b> · ${m.s === "up" ? "위" : "아래"} ${m.days}일째${Math.abs(m.gap) <= 3 ? " · <b>200일선 시험 중</b> (±3% 안)" : ""}${w50 ? ` · 50주선 ${fmt(w50)} 대비 ${sg((x.last / w50 - 1) * 100, 1)}` : ""}`);
    if (p) lines.push(`☕ 컵위드핸들: <b>${ST[p.st]}</b> — ${t[p.a]} 고점 ${fmt(p.H)} → ${p.depth}% 눌린 바닥(${t[p.b]}) → 지금 왼쪽 고점의 ${Math.round((x.last / p.H) * 100)}%`
      + `<div class="src">오닐 조건: 앞선 상승 +${p.pre}% ${ok(p.pre >= 25)} · 깊이 ${p.depth}% ${ok(p.depth <= 33)}(12~33%) · 기간 ${p.wk}주 ${ok(p.wk >= 7)}(7주+) · 손잡이 ${p.st === "handle" || p.st === "out" ? `${n(p.dip, 1)}% 눌림 ✅` : "⬜ 아직"}</div>`);
    if (q) lines.push(`📏 채널: <b style="color:${q.st === "below" ? "var(--warn-ink)" : "inherit"}">${q.st === "below" ? "지지선 아래로 이탈" : q.st === "above" ? "저항선 위" : "채널 안"}</b> ${q.run}${u === "주" ? "주" : "일"}째 — 지지선 ${fmt(q.lo)} (${sg((x.last / q.lo - 1) * 100, 1)}) · 저항선 ${fmt(q.up)} (${sg((x.last / q.up - 1) * 100, 1)})`
      + `<div class="src">${q.a >= 0 ? t[q.a] : ""} 저점과 ${t[q.b]} 저점을 이은 지지선 (그 사이 한 번도 안 깨짐) · 저항선은 같은 기울기${q.was_above && q.st !== "above" ? " · 한때 저항선 위로 올라갔다가 다시 내려옴" : ""}</div>`);
    const M = x.mm;  // Ⓜ M자 (쌍봉): 고점과 고점·저점과 저점이 낮아짐 (사용자 11/6 EWY 주봉 그림)
    if (M) lines.push(`Ⓜ M자(쌍봉): <b style="color:${M.st === "form" ? "inherit" : "var(--warn-ink)"}">${{ below: "고점도 저점도 낮아짐 — 가운데 골(목선) 아래", dipped: "목선 아래로 갔다가 다시 위", form: "두 번째 고점이 더 낮음 · 목선은 아직 위" }[M.st]}</b>`
      + `<div class="src">고점 ${t[M.a]} ${fmt(M.A)} → ${t[M.c]} ${fmt(M.C)} (<b>${sg(M.lh, 1)}</b>) · 저점 ${t[M.b]} ${fmt(M.B)} → ${t[M.d]} ${fmt(M.D)} (<b>${sg(M.ll, 1)}</b>) · 목선 = 두 고점 사이 가장 낮은 종가 ${fmt(M.B)}, 지금 ${sg((x.last / M.B - 1) * 100, 1)}</div>`);
    const over = (X, Y) => {
      let g = "";
      const path = (pts) => pts.map(([i, v], j) => `${j ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
      if (M) g += `<path d="${path([[M.s, x.ch.c[M.s]], [M.a, M.A], [M.b, M.B], [M.c, M.C], [N - 1, x.last]])}" fill="none" stroke="var(--warn)" stroke-width="6" stroke-opacity=".7" stroke-linecap="round" stroke-linejoin="round"/>`
        + `<line x1="${X(M.b)}" x2="${X(N - 1)}" y1="${Y(M.B)}" y2="${Y(M.B)}" stroke="var(--warn-ink)" stroke-width="1.5" stroke-dasharray="5 4"/>`
        + [[M.a, M.A, "고점1"], [M.c, M.C, "고점2"], [M.b, M.B, "저점1"]].map(([i, v, s], j) => `<text x="${X(i)}" y="${Y(v) + (j < 2 ? -8 : 16)}" text-anchor="middle" class="qx" style="font-weight:700">${s}</text>`).join("");
      if (p) g += `<path d="${path(p.path.map((v, j) => [p.a + j, v]))}" transform="translate(0,7)" fill="none" stroke="var(--good)" stroke-width="9" stroke-opacity=".3" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (q) {
        const i0 = Math.max(0, q.a), ln = (k) => path(Array.from({ length: N - i0 }, (_, j) => [i0 + j, Math.exp(q.la + q.s * (i0 + j - q.a) + k)]));
        g += `<path d="${ln(0)}" fill="none" stroke="var(--s7)" stroke-width="2.5" opacity=".8"/><path d="${ln(q.off)}" fill="none" stroke="var(--s7)" stroke-width="2.5" opacity=".8"/>`
          + [q.a, q.b].filter((i) => i >= 0).map((i) => `<circle cx="${X(i)}" cy="${Y(Math.exp(q.la + q.s * (i - q.a)))}" r="4" fill="var(--s7)"/>`).join("");
      }
      if (m && !wk && Math.abs(m.gap) <= 3) g += `<circle cx="${X(N - 1)}" cy="${Y(m.v)}" r="14" fill="none" stroke="var(--good)" stroke-width="3"/>`;
      if (vs) g += `<rect x="${X(0)}" y="${Y(vs.hi)}" width="${X(N - 1) - X(0)}" height="${Math.max(2, Y(vs.lo) - Y(vs.hi))}" fill="var(--bad)" fill-opacity=".12"/><line x1="${X(0)}" x2="${X(N - 1)}" y1="${Y(vs.lo)}" y2="${Y(vs.lo)}" stroke="var(--bad)" stroke-width="2"/>`;
      return g;
    };
    const ref = p ? (p.st === "handle" || p.st === "out" ? { v: p.R, t: "손잡이 고점" } : { v: p.H, t: "컵 왼쪽 고점" }) : null;
    // 📅 일봉·주봉·월봉·연봉 (사용자 11/4) — 기본 봉엔 계산한 선까지, 다른 봉은 캔들 + 이평선만 (board.py draw tfs)
    const TFN = { d: "일봉", w: "주봉", m: "월봉", y: "연봉" };
    const cap = (tf) => (tf === x.tf ? `${wk ? "주봉 2년 · 로그 눈금 · 초록 20주선 · 회색 50주선(≈1년 평균)" : al ? "일봉 약 10개월 · 파랑 5일 · 초록 20일 · 주황 60일 · 빨강 120일선" : "일봉 약 10개월 · 초록 20일선 · 회색 50일선 · 주황 200일선"}${vs ? " · 빨간 띠 = 거래량 지지대" : ""}${q ? " · 보라 = 지지선·저항선" : ""}${p ? " · 연두 띠 = 컵 모양" : ""}${M ? " · 주황 굵은 선 = M자 · 점선 = 목선" : ""}`
      : `${{ d: "일봉 약 10개월", w: "주봉 2년 · 로그 눈금", m: "월봉 10년 · 로그 눈금", y: "연봉 (올해 봉은 진행 중) · 로그 눈금" }[tf]} · 이평선 ${Object.keys(x.tfs[tf]?.ma || {}).join("·")}${{ d: "일", w: "주", m: "개월", y: "년" }[tf]}${tf === "w" ? " (30주선 = 와인스타인 기준선)" : ""} · 계산한 선은 ${TFN[x.tf]}에서만`);
    DRAWBOX[i] = (tf) => (tf === x.tf || x.tfs?.[tf] ? `${tf === x.tf ? candleSVG(x.ch, x.tf, fmt, ref, over) : candleSVG(x.tfs[tf], tf, fmt)}<div class="src">${cap(tf)} · ${esc(x.date)} 종가</div>` : "");
    const tfBtn = `<div class="seg dtfseg" data-di="${i}" style="margin-top:6px">${["d", "w", "m", "y"].filter((k) => k === x.tf || x.tfs?.[k]).map((k) => `<button data-dtf="${k}" class="${k === x.tf ? "on" : ""}">${TFN[k]}</button>`).join("")}</div>`;
    return `<div class="card" style="padding:8px 10px"><div class="bhd"><b style="font-size:17px">${esc(x.kr ? x.name : x.sym)}</b> <span class="src">${esc(x.kr ? "지수 · 포인트" : x.name)}</span><span class="bchd"><b>${fmt(x.last)}</b> <span class="${kcol(m?.chg_d)}">${sg(m?.chg_d, 1)}</span></span></div>
      ${lines.map((l) => `<div style="margin-top:4px">${l}</div>`).join("")}
      ${tfBtn}<div class="cbox" data-di="${i}">${DRAWBOX[i](x.tf)}</div>
      ${x.memo ? `<div class="note src">🗣 ${esc(x.memo)}</div>` : ""}</div>`;
  };
  return `<h2 data-jump="draw" data-jname="✏️ 선 그은 차트">✏️ 선 그은 차트 <span class="src">컵위드핸들 · 200일선 · 지지선·저항선 채널 · M자 · 역배열·거래량 지지대 · 일·주·월·연봉 · ${esc(at || "")}</span></h2>
    <div class="grid g2">${list.map(card).join("")}</div>
    <div class="kidbox">🐣 <b>컵위드핸들</b>(윌리엄 오닐): 주가가 커피잔처럼 둥글게 내려갔다 올라온 뒤, 손잡이처럼 살짝 쉬었다가 손잡이 고점을 넘는 모양이에요. <b>200일선</b>: 약 10개월 평균 가격 — 위에 있으면 큰 흐름이 위쪽이에요. <b>채널</b>: 바닥끼리 이은 선(지지선)과, 같은 기울기로 꼭대기에 닿는 선(저항선) 사이 길 — 지지선 아래로 내려오면 오르던 길을 벗어난 거예요. <b>역배열</b>: 이평선은 그 기간에 산 사람들의 평균 가격(평단)이에요. 긴 선(120일)이 맨 위·짧은 선(5일)이 맨 아래로 줄 서면, 6개월 안에 산 사람이 모두 손해 중이라 오를 때마다 '본전이면 팔자'는 물량이 겹겹이 나와요. <b>거래량 지지대</b>: 많이 사고판 가격대라 받침이 강해요 — 대신 깨지면 떨어지는 힘도 커요. <b>M자(쌍봉)</b>: 한 번 꼭대기를 찍고 내려왔다가 다시 올라갔는데 첫 꼭대기를 못 넘고(고점이 낮아짐) 또 내려와요. 두 꼭대기 사이 골(목선)까지 깨면 저점도 낮아진 것 — 오르던 흐름이 꺾였다는 신호로 봐요.</div>
    <div class="note src">선은 사람이 긋지 않고 갱신 때마다 같은 규칙으로 다시 계산해요 (평일 아침·한국장 마감 뒤 + 일~목 저녁 8시~새벽 2시 매시간) · 야후, 배당 안 깎은 가격 (증권사 차트와 같은 숫자) · 채널은 로그 가격 기준 · 기술적 분석은 참고 수단일 뿐이에요 (매수·매도 추천 아님)</div>`;
}
// 캔들 차트 (일봉 2년 · 주봉 5년 · 월봉 10년): 이평선 · RS 선(지수 대비) · 거래량 · 마지막 가격 · 기준선(전일 종가 / 12주 고점)
function candleSVG(ch, kind, fmt, ref, over) {  // over(X, Y, lo, hi) = 위에 덧그릴 선 (가격 칸 밖은 잘림)
  if (!ch?.c?.length) return "";
  const N = ch.c.length, W = 600, x0 = 4, x1 = 540, top = 14, bot = 168, rs0 = 178, rs1 = 206, v0 = 214, v1 = 250, H = 262, logS = kind !== "d";
  const lows = ch.l.filter((v) => v > 0), his = ch.h.filter((v) => v > 0), lo = Math.min(...lows), hi = Math.max(...his);
  const f = (v) => (logS ? Math.log(v) : v), Y = (v) => bot - ((f(v) - f(lo)) / (f(hi) - f(lo) || 1)) * (bot - top);
  const X = (i) => x0 + ((x1 - x0) * (i + 0.5)) / N, bw = Math.max(0.6, ((x1 - x0) / N) * 0.7);
  let g = "";
  // shortcut: 두 자리 연도라 70~99 = 19xx 로 봄 (2070년 넘으면 날짜를 네 자리로)
  const Y4 = (y) => `${+y >= 70 ? 19 : 20}${y}`;
  ch.t.forEach((t, i) => { const y = t.slice(0, 2), m = t.slice(3, 5); if (i && t.slice(0, 5) !== ch.t[i - 1].slice(0, 5) && (kind === "d" ? ["01", "07"].includes(m) : kind === "y" ? +y % 5 === 0 : m === "01")) g += `<line x1="${X(i)}" x2="${X(i)}" y1="${top}" y2="${v1}" stroke="var(--grid)" stroke-dasharray="2 3"/><text x="${X(i)}" y="${H - 1}" text-anchor="middle" class="qx">${kind === "d" ? `${y}.${m}` : Y4(y)}</text>`; });
  const vmax = Math.max(...ch.v) || 1;
  ch.c.forEach((c, i) => {
    const o = ch.o[i], h = ch.h[i], l = ch.l[i]; if (!(c > 0 && o > 0)) return;
    const col = c >= o ? "var(--bad)" : "var(--s1)";
    g += `<line x1="${X(i)}" x2="${X(i)}" y1="${Y(h)}" y2="${Y(l)}" stroke="${col}" stroke-width="${Math.min(1, bw)}"/>`;
    if (bw >= 1.2) g += `<rect x="${X(i) - bw / 2}" y="${Math.min(Y(o), Y(c))}" width="${bw}" height="${Math.max(0.8, Math.abs(Y(o) - Y(c)))}" fill="${col}"/>`;
    g += `<rect x="${X(i) - bw / 2}" y="${v1 - (ch.v[i] / vmax) * (v1 - v0)}" width="${bw}" height="${(ch.v[i] / vmax) * (v1 - v0)}" fill="${col}" opacity=".35"/>`;
  });
  const maCol = { 5: "var(--s1)", 20: "var(--s3)", 50: "var(--ink-2)", 60: "var(--warn)", 120: "var(--bad)", 200: "var(--warn)", 10: kind === "m" ? "var(--warn)" : "var(--ink-2)", 30: "var(--warn)", ...AL_COL, ...(ch.maCol || {}) };  // ch.maCol = 📐 선 읽기 차트가 정한 색
  Object.entries(ch.ma || {}).forEach(([k, a]) => { let d = ""; a.forEach((v, i) => { if (v > 0) d += `${d && a[i - 1] > 0 ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; }); g += `<path d="${d}" fill="none" stroke="${maCol[k] || "var(--ink-2)"}" stroke-width="1.5"/>`; });
  if (ch.rs?.length) {
    const rv = ch.rs.filter((v) => v != null), rl = Math.min(...rv), rh = Math.max(...rv), RY = (v) => rs1 - ((v - rl) / (rh - rl || 1)) * (rs1 - rs0);
    let d = ""; ch.rs.forEach((v, i) => { if (v != null) d += `${d ? "L" : "M"}${X(i).toFixed(1)},${RY(v).toFixed(1)}`; });
    g += `<path d="${d}" fill="none" stroke="var(--s7)" stroke-width="1.3"/><text x="${x1 + 6}" y="${RY(rv.at(-1)) + 4}" class="qx" style="fill:var(--s7)">RS</text>`;
  }
  if (ref) g += `<line x1="${x0}" x2="${x1}" y1="${Y(ref.v)}" y2="${Y(ref.v)}" stroke="var(--ink-2)" stroke-dasharray="4 3"/><text x="${x1 - 4}" y="${Y(ref.v) - 4}" text-anchor="end" class="qx">${esc(ref.t)} ${fmt(ref.v)}</text>`;
  const maU = kind === "w" ? "주선" : kind === "m" ? "개월선" : "일선";
  g += tipCols(X, (x1 - x0) / N, top, v1, ch.t.map((t, i) => [t, `시가 ${fmt(ch.o[i])} · 고가 ${fmt(ch.h[i])}`, `저가 ${fmt(ch.l[i])} · 종가 ${fmt(ch.c[i])}`,
    ...Object.entries(ch.ma || {}).map(([k, a]) => (a[i] > 0 ? `${k}${maU} ${fmt(a[i])}` : null)), `거래량 ${n(ch.v[i])}`].filter(Boolean).join("\n")));
  // 덧그린 선은 봉 설명 칸 위에 (📐 선을 누르면 가격이 뜨게)
  if (over) { const cid = "cp" + Math.random().toString(36).slice(2, 8); g += `<clipPath id="${cid}"><rect x="${x0}" y="${top - 6}" width="${x1 - x0 + 20}" height="${bot - top + 12}"/></clipPath><g clip-path="url(#${cid})">${over(X, Y, lo, hi)}</g>`; }
  const last = ch.c.at(-1);
  g += `<text x="${x1 + 6}" y="${Y(hi) + 8}" class="qx">${fmt(hi)}</text><text x="${x1 + 6}" y="${Y(lo)}" class="qx">${fmt(lo)}</text>`
    + `<path d="M${x1 + 2},${Y(last)} l6,-4 v8 z" fill="var(--ink)"/><text x="${x1 + 10}" y="${Y(last) + 4}" class="qv b">${fmt(last)}</text>`;
  return `<svg viewBox="0 0 ${W + 50} ${H + 4}" class="cndl" role="img" aria-label="캔들 차트">${g}</svg>`;
}
const SCAN_KIND = { gap: ["일봉", "거래량 터진 갭 상승", "d", "8~20일을 내다보는 차트"], week: ["주봉", "바닥 탈출 · 30주선과 12주 고점 돌파", "w", "8~20주를 내다보는 차트"], month: ["월봉", "바닥 탈출 · 10개월선과 6개월 고점 돌파", "m", "8~20개월을 내다보는 차트"] };
const SCAN_TF = [["d", "일봉 2년"], ["w", "주봉 5년"], ["m", "월봉 10년"]], SCAN_MAP = {};
function scanCard(c, kind, mk, tf) {
  const us = mk === "us", fmt = us ? (v) => `$${n(v, 2)}` : (v) => `${n(v, 0)}원`, h = c.hit || {}, b = c.badge || {};
  SCAN_MAP[`${mk}:${c.code}`] = [c, kind, mk];
  const ref = kind === "gap" && tf === "d" ? { v: h.prev, t: "전일 종가" } : kind === "week" && tf === "w" ? { v: h.hi12, t: "12주 고점" } : null;
  const badges = [`<span class="sbadge k">${SCAN_KIND[kind][0]} · ${SCAN_KIND[kind][1]}</span>`, b.ma200_up ? `<span class="sbadge y">200일선 돌파</span>` : "",
    b.hi52w ? `<span class="sbadge r">52주 신고가</span>` : b.hi26w ? `<span class="sbadge r">26주 신고가</span>` : "", `<span class="sbadge p">RS ${c.rs}</span>`,
    c.earn ? `<span class="sbadge y">실적 ${esc(c.earn.slice(5).replace("-", "/"))}</span>` : ""].join("");
  const foot = kind === "gap" ? `시가 갭 ${sg(h.gap, 1)} · 종가 ${sg(h.chg, 1)} · 거래량 ${n(h.vol, 1)}배 · 고가권 마감 · 전일 종가 ${fmt(h.prev)}`
    : kind === "week" ? `26주 중 ${h.below}주 30주선 아래 → 30주선 ${fmt(h.ma30)}·12주 고점 ${fmt(h.hi12)} 돌파 · 이번 주 거래량 ${n(h.vol, 1)}배 · 2년 고점 대비 ${sg(h.dd2y)}`
    : `12개월 중 ${h.below}개월 10개월선 아래 → 10개월선 ${fmt(h.ma10)} 돌파`;
  return `<div class="card scard" data-sk="${esc(mk)}:${esc(c.code)}"><div class="bhd"><b style="font-size:17px">${esc(us ? c.code : c.name)}</b> <span class="src">${esc(us ? c.name : c.code)}</span><span class="bchd"><b>${fmt(c.price)}</b> <span class="${kcol(c.chg)}">${sg(c.chg, 1)}</span></span></div>
    <div class="src">${esc([c.sec, c.sub].filter(Boolean).join(" · "))}${c.cap ? ` · 시총 ${bigWon(c.cap)}` : ""}</div>
    <div style="margin:6px 0">${badges}</div>
    <div class="src">최근 뉴스 · ${c.news?.t ? `<a href="${esc(c.news.u || "#")}" target="_blank" rel="noopener">${esc(c.news.t)}</a> ${esc(c.news.d || "")}`
      : `<a href="${us ? `https://finance.yahoo.com/quote/${encodeURIComponent(c.code)}/news` : `https://finance.naver.com/item/news.naver?code=${encodeURIComponent(c.code)}`}" target="_blank" rel="noopener">${us ? "야후 파이낸스" : "네이버 증권"}에서 보기</a>`}</div>
    <div class="seg sseg" style="margin-top:6px">${SCAN_TF.map(([k, l]) => `<button data-tf="${k}" class="${k === tf ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="cbox">${candleSVG(c.chart?.[tf], tf, fmt, ref)}<div class="src">${tf === "d" ? "일봉 2년 · 회색 50일선 · 주황 200일선" : tf === "w" ? "주봉 5년 · 회색 10주선 · 주황 30주선 · 로그 눈금" : "월봉 10년 · 주황 10개월선 · 로그 눈금"} · 보라 = RS 선 (지수 대비)</div></div>
    <div class="src" style="margin-top:4px">${foot} · 52주 고점 대비 ${sg(b.dd52)}</div></div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".scard .sseg button"); if (b) { const el = b.closest(".scard"), [c, kind, mk] = SCAN_MAP[el.dataset.sk]; el.outerHTML = scanCard(c, kind, mk, b.dataset.tf); return; }
  const m = e.target.closest(".scanmk button"); if (m) { SCAN_MKT = m.dataset.mk; $("#scanBox").outerHTML = scanHTML(); chartJump(); }
});
function scanHTML() {
  const S = SCAN?.[SCAN_MKT];
  if (!SCAN?.kr && !SCAN?.us) return "";
  const kinds = Object.keys(SCAN_KIND).map((k) => {
    const x = S?.[k];
    if (!x) return "";
    return `<h3>${SCAN_KIND[k][0]} <span class="src">${SCAN_KIND[k][3]} · 오늘 ${x.n}개</span></h3><div class="chart-title"><b>${SCAN_KIND[k][1]}</b></div>
      ${x.cards.length ? `<div class="grid g2">${x.cards.map((c) => scanCard(c, k, SCAN_MKT, SCAN_KIND[k][2])).join("")}</div>` : `<div class="note src">오늘은 조건에 걸린 종목이 없어요.</div>`}
      ${x.more?.length ? `<details class="fvt"><summary class="chart-title">▶ 그 밖에 ${x.more.length}개</summary><div class="src">${x.more.map((m) => `${esc(m.name)} (RS ${m.rs})`).join(" · ")}</div></details>` : ""}`;
  }).join("");
  return `<div id="scanBox"><h2 data-jump="scan" data-jname="🔭 차트 스캔">🔭 차트 스캔 <span class="src">${SCAN_MKT === "kr" ? "한국 시가총액 상위" : "미국 S&P500"} ${S?.universe || 0}종목 · ${esc(SCAN.updated_at || "")}</span></h2>
    <div class="seg scanmk" style="margin-bottom:8px"><button data-mk="kr" class="${SCAN_MKT === "kr" ? "on" : ""}">🇰🇷 한국</button><button data-mk="us" class="${SCAN_MKT === "us" ? "on" : ""}">🇺🇸 미국</button></div>
    <div class="note src">펀더멘털로 고른 종목을 차트로 확인하는 용도예요 (아이디어 찾기 · 매수/매도 추천 아님). RS = 지수 대비 1년 강도 순위 1~99 (3개월 40% + 6·9·12개월 20%씩)</div>${kinds}</div>`;
}
// 📈 차트 탭: 주봉 정배열 (site/data/align.json ← collector/board.py align) — 텔레그램 '[주봉 정배열]' 글과 같은 순서·모양
const AL_COL = { 4: "var(--bad)", 13: "var(--s4)", 26: "var(--s3)", 52: "var(--s7)" };
let ALIGN = null;
// 📈 차트 탭 = 🗺 시장 그룹판(한국·미국·AI 인프라 200일선) → 🔭 차트 스캔 → 주봉 정배열 (그룹판·스캔은 2026-11-01 산업 탭에서 옮김)
async function loadAlign() {
  if (!BOARD) { try { BOARD = await (await fetch("data/board.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { BOARD = {}; } }
  if (!SCAN) { try { SCAN = await (await fetch("data/scan.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { SCAN = {}; } }
  if (!ALIGN) { try { ALIGN = await (await fetch("data/align.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { ALIGN = null; } }
  $("#chartBody").innerHTML = chartRulesHTML() + drawHTML(BOARD.draw, BOARD.updated_at) + boardHTML() + scanHTML() + `<h2 data-jump="align" data-jname="📈 주봉 정배열">📈 주봉 정배열</h2><p class="sub">코스피·코스닥 시가총액 3,000억 이상에서 주봉 이동평균이 4주 &gt; 13주 &gt; 26주 &gt; 52주로 줄 선(정배열) 종목 — 매주 금요일 종가 기준, 평일 아침·장 마감 뒤 갱신. 종목을 누르면 주봉 차트가 열려요. 매수·매도 추천 아님.</p>`
    + (ALIGN ? alignHTML(ALIGN) : `<div class="empty">⏳ 다음 차트 스캔(평일 아침·장 마감 뒤) 때 채워져요.</div>`) + pbHTML();
  chartJump();
}
// 📚 돌파 vs 눌림목 (사용자 11/4: 블로그 '요약하는 고잉' 글을 차트 탭 맨 아래에) — 글의 그림은 같은 모양으로 다시 그리고, 지금 그 자리에 있는 종목을 붙임
const PB_Z = [[35, 625], [175, 460], [232, 538], [348, 392], [407, 495], [512, 312], [583, 440], [683, 227], [754, 365], [848, 138], [910, 292]];  // 계단처럼 오르는 지그재그 (홀수 번째 = 고점)
function pbSVG(kind) {
  const Z = PB_Z;
  let g = "", o = "";
  Z.slice(1).forEach((b, i) => { g += `<line x1="${Z[i][0]}" y1="${Z[i][1]}" x2="${b[0]}" y2="${b[1]}" stroke="${b[1] < Z[i][1] ? "var(--bad)" : "var(--s1)"}" stroke-width="9" stroke-linecap="round"/>`; });
  for (let i = 1; i < 9; i += 2) {
    const [pk, tr, nx] = [Z[i], Z[i + 1], Z[i + 2]], cx = tr[0] + ((nx[0] - tr[0]) * (tr[1] - pk[1])) / (tr[1] - nx[1]);  // 다음 오름선이 이 고점 높이를 넘는 x
    g += `<line x1="${pk[0] - 110}" x2="${cx + 60}" y1="${pk[1]}" y2="${pk[1]}" stroke="var(--bad)" stroke-width="5" stroke-dasharray="1 10" stroke-linecap="round"/>`;
    const [x, y] = kind === "b" ? [cx, pk[1]] : [pk[0] + (tr[0] - pk[0]) * 0.65, pk[1] + (tr[1] - pk[1]) * 0.65];
    o += `<circle cx="${x}" cy="${y}" r="22" fill="none" stroke="var(--good)" stroke-width="7"/>`;
  }
  return `<svg viewBox="20 110 910 530" role="img" aria-label="${kind === "b" ? "전고점을 넘는 곳에 표시한 돌파 자리" : "오른 뒤 내려오는 구간에 표시한 눌림목 자리"}">${g}${o}</svg>`;
}
// 📚 차트 원칙 (사용자 11/7: 차트 10년 넘게 본 형님에게 배운 것 — 차트 탭 맨 위, 닫힘) · 주가 그림의 회색 선·'📐 선 읽기'가 이 원칙으로 계산
const CHART_RULES = [
  ["🧠 가장 중요한 것", ["본전 심리 — 물린 사람은 본전 근처에서 판다. 지지·저항이 생기는 이유", "내 눈에 직관적으로 보이는 게 아닐 수도 있다 — 선을 그어서 확인"]],
  ["📐 채널 (고점끼리·저점끼리 잇기)", ["우하향 채널의 고점선을 위로 뚫을 때 산 매매가 성공 확률이 높음", "뚫은 뒤 옆으로 기면서 고점선 기울기가 40도 → 20도 → 10도처럼 완만해지면 우상향 추세로 바뀔 수 있음", "고점선이 가파를수록 뚫어도 바로 조정이 올 수 있음", "우상향 채널에서 아래 지지선을 3~4번 맞으면 다음엔 크게 깨질 확률이 높음"]],
  ["🧱 지지·저항", ["얼마나 오래 옆으로 기었나 vs 빠르게 급락했나가 중요 — 빠른 급락 뒤엔 반등이 나올 수 있음", "지지를 깨고 내려가면 그 지지가 저항이 됨 → 실패한 매매라도 그 근처까지는 반등해 손실을 메울 수 있음", "지지부진하게 옆으로 기면 사고파는 사람이 많다는 뜻 — 위 저항을 3번 부딪히면(쌍봉·삼봉) 뚫을 확률이 높다고 볼 수 있음", "10만 → 20만원 오를 때 15만원에서 판 사람은 15만원 아래에서 다시 삼 → 거래가 쌓이며 횡보 → 횡보가 길어질수록 아래로 깰 때 더 크게 빠질 수 있음"]],
  ["📈 장마다 다른 매매", ["상승장: 옆으로 기다 거래량 터지며 뚫고, 그 저항이 지지로 바뀌어 살짝 받쳐 줄 때가 기회 — 가장 쉬운 매매", "횡보장: 멀리서 보면 박스가 보임 → 박스 아래에서 사고 위에서 판다. 아래에서 장대 음봉이 나와도 사는 자리, 위에서 거래량 터진 장대 양봉이어도 파는 자리 (아래에서 산 건 실패해도 반등이 있어 실패라고 보기 어려움)", "하락장: 피보나치 — 최고점에서 내린 폭의 1/2(50%)은 되돌린다. 살 때 늘 이 자리를 신경 씀"]],
  ["🚫 국장에서 하지 말 것", ["짧은 기간 6·7·8배·10배 오른 종목(현대로템·단기 급등한 SK하이닉스·삼성전자 등)은 최소 1~2년 쉰다고 보고 쳐다보지 않음 (한화에어로스페이스·삼양식품은 예외로 봄)", "시가총액 1조 미만은 손대지 않음 (여의도 생태계 — 수급·거래대금)", "1조 이상이라도 그 섹터 대장(1등주)에서 잘 먹힘 — 거래대금이 많아서"]],
];
function chartRulesHTML() {
  return `<details class="card" style="margin-bottom:12px"><summary class="chart-title" style="margin-top:0"><b>📚 차트 원칙</b> <span class="src">차트 10년 넘게 본 형님에게 배운 것 (11/7) · 주가 그림의 연한 회색 선·'📐 선 읽기'가 이 원칙으로 계산 · 눌러서 열기 · 추천 아님</span></summary>
    ${CHART_RULES.map(([h, l]) => `<div style="margin-top:8px"><b>${h}</b><ul class="irl">${l.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`).join("")}
    <div class="note src">회색 선은 종가 꼭짓점으로 자동 계산: 고점선 = 최근 고점 2개를 이은 선 · 저점선 = 최근 저점 2개 · 지지·저항 = 꼭짓점이 3% 안에서 2번 넘게 모인 가격 · 50% = 보이는 기간 최고점 → 그 뒤 최저점 폭의 절반</div></details>`;
}
function pbHTML() {
  const has = (k) => (DASH?.stocks || []).filter((c) => c.pat?.some((s) => s.k === k)).map((c) => `<a href="#stock/${esc(c.code)}">${esc(c.name)}</a>`).join(" · ") || "지금은 없음";
  const s2 = (ALIGN?.stage?.sec || []).filter((s) => s.st === 2).map((s) => esc(s.name)).join(" · ") || "지금은 없음";
  const rows = [["언제 들어가나", "오르던 주가가 전고점(빨간 점선)을 뚫고 올라가는 순간", "한 번 오른 뒤 잠깐 내려오는 구간(파란 선)"],
    ["좋은 점", "전고점에서 팔려던 물량이 이미 소화돼 오름세가 이어질 때가 많아요 · 들어가자마자 움직이는 경우가 많아요 · 상승장에서 힘을 써요", "되도록 싸게 산다는 원칙에 맞아요 · 평균 가격이 잘 잡히면 오래 들고 있기 편해요"],
    ["아쉬운 점", "뚫는 척하다 다시 내려오는 가짜 돌파(휩쏘)가 잦아요 · 이미 오른 뒤 따라가는 모양이라 손절선이 멀어요 · 돌파하자마자 꺾이면 대응이 어려워요", "어느 정도 물릴 각오가 필요하고 바로 안 움직여요 · 잠깐 쉬는 건지 진짜 하락(떨어지는 칼날)인지 아무도 몰라요 · 정말 센 주도주는 이런 눌림을 잘 안 줘요"]];
  return `<h2 data-jump="study" data-jname="📚 돌파 vs 눌림목">📚 차트 공부 — 돌파 매매 vs 눌림목 매매 <span class="src">블로그 '요약하는 고잉' 글 요약 · 그림은 같은 모양으로 다시 그림 · 11/4</span></h2>
    <div class="tbl-wrap"><table class="compact" style="width:100%"><thead><tr><th></th><th style="text-align:left">🚀 돌파 매매</th><th style="text-align:left">🧪 눌림목 매매</th></tr></thead><tbody>
      ${rows.map(([a, b, c]) => `<tr><td style="text-align:left;white-space:nowrap"><b>${a}</b></td><td style="text-align:left;white-space:normal">${b}</td><td style="text-align:left;white-space:normal">${c}</td></tr>`).join("")}</tbody></table></div>
    <div class="grid g2" style="margin-top:8px">
      <div class="card"><div class="chart-title"><b>🚀 돌파 자리</b></div>${pbSVG("b")}<div class="src">초록 ○ = 오르는 선이 전고점 점선을 넘는 곳</div></div>
      <div class="card"><div class="chart-title"><b>🧪 눌림목 자리</b></div>${pbSVG("p")}<div class="src">초록 ○ = 오른 뒤 내려오는 파란 선 위</div></div></div>
    <div class="src">빨강 = 오르는 구간 · 파랑 = 내리는 구간 · 빨간 점선 = 전고점 · 초록 ○ = 들어가는 자리</div>
    <div class="kidbox" style="margin-top:6px">🐣 계단을 오르는 공을 떠올려 봐요. <b>돌파</b>는 공이 계단 턱(점선)을 넘는 순간 따라가요 — 빨리 움직이지만 턱에 걸려 다시 굴러떨어지는 헛걸음이 잦아요. <b>눌림목</b>은 한 칸 오른 공이 살짝 굴러 내려왔을 때 따라가요 — 싸게 타지만 한참 기다려야 하고, 그대로 계단 밑까지 굴러갈 수도 있어요.</div>
    <div class="note src">🗣 글쓴이 결론: 어느 쪽이 늘 옳은 게 아니라 <b>시장 분위기(장세)</b>가 중요해서 둘을 섞어 써요 · 글쓴이는 평소엔 눌림목을 주로 하고, 그달 뚜렷한 주도 업종에서는 돌파를 해요 · 돌파로 잘 안 되면 눌림 쪽으로 바꿔 보고, 눌림이 몸에 익어야 돌파도 된다는 생각 · 화면을 자주 못 보는 직장인에게는 눌림 쪽이 편하다는 의견</div>
    <div class="card" style="margin-top:8px"><b>📍 지금 이 사이트에서 두 자리 찾기</b> <span class="src">보유·관심·공동 종목 · 주봉 종가 기준</span><ul class="irl">
      <li>🚀 <b>전고점 돌파</b> (13주 넘게 못 넘던 큰 고점을 주봉 종가로 넘음): ${has("brk")}</li>
      <li>🧪 <b>전고점 지지 시험</b> (넘었던 전고점까지 다시 내려옴 = 눌림목 자리): ${has("test")}</li>
      <li>🪜 <b>주도 업종 후보</b> (와인스타인 2단계 업종): ${s2} · 🔭 차트 스캔 칸은 돌파 쪽 조건(30주선·12주 고점·10개월선 돌파, 갭 상승)이에요</li></ul>
      <div class="src">📚 와인스타인 책도 두 자리를 같이 다뤄요 — 1단계 → 2단계로 넘어가며 저항선을 거래량과 함께 뚫는 돌파가 첫 자리, 돌파한 뒤 그 선 근처로 되돌아오는 눌림이 두 번째 자리예요.</div></div>
    <div class="note src">공부용 요약이에요 · 모양이 맞아도 실패가 많아요 · 매수·매도 추천이 아니에요</div>`;
}
// 차트 탭 맨 위 바로가기 (사용자 11/4: 키워드를 누르면 그 칸으로) — 칸 제목의 data-jump 를 모음
const chartJump = () => jumpBar("#chartBody", "#chartJump", "🔎 칸 이름 검색 (예: 4단계) → Enter");
function alignHTML(A) {
  const eok = (v) => `${n(v / 1e8, 0)}억`, WHY = { cap: "시총 3,000억 넘음", align: "정배열 새로" }, WHYO = { cap: "시총 3,000억 아래로", align: "정배열 깨짐" };
  // 한 줄 = 누르면 주봉 차트가 열리는 details (차트는 열 때 그림)
  const row = (r, tail = "", tag = "") => `<details class="alrow" data-code="${esc(r.code)}"><summary>${esc(r.name)} <span class="src">(${esc(r.code)})</span> ${eok(r.cap)}${tail}${tag ? ` <span class="sbadge ${tag[1]}">${esc(tag[0])}</span>` : ""}</summary><div class="cbox"></div></details>`;
  const top3 = [...A.pass].sort((a, b) => b.streak - a.streak || b.cap - a.cap).slice(0, 3);
  const newSet = new Set(A.new.map((r) => r.code));
  return `<div class="card" style="line-height:1.7"><b>[주봉 정배열]</b> ${esc(A.date)} 기준 · ${esc(A.rule)}
    <div><b>통과 ${A.pass.length}종목</b> (신규 ${A.new.length} / 이탈 ${A.out.length}) <span class="src">· 시총 3,000억 이상 ${A.universe}종목 중 · ${esc(A.updated_at || "")}</span></div>
    <h3 style="margin:10px 0 2px">▶️ 신규 진입 ${A.new.length}</h3>${A.new.map((r) => row(r, "", r.why === "cap" ? [WHY.cap, "y"] : null)).join("") || `<div class="src">없음</div>`}
    <h3 style="margin:10px 0 2px">▼ 이탈 ${A.out.length}</h3>${A.out.map((r) => row(r, "", [WHYO[r.why], r.why === "cap" ? "y" : "r"])).join("") || `<div class="src">없음</div>`}
    <h3 style="margin:10px 0 2px">최장 유지</h3>${top3.map((r) => row(r, ` <b>${r.streak}주</b>`)).join("")}</div>
    <h3>통과 ${A.pass.length}종목 전체 <span class="src">시총 큰 순 · 연속 = 정배열이 이어진 주 수 · 주간 = 이번 주 등락</span></h3>
    <div class="card">${A.pass.map((r) => row(r, ` · ${r.streak}주 · <span class="${kcol(r.chg)}">${sg(r.chg, 1)}</span>${r.sec ? ` <span class="src">${esc(r.sec)}</span>` : ""}`, newSet.has(r.code) ? ["신규", "k"] : null)).join("")}</div>
    <div class="note src">선 색: <span style="color:${AL_COL[4]}">━ 4주</span> · <span style="color:${AL_COL[13]}">━ 13주</span> · <span style="color:${AL_COL[26]}">━ 26주</span> · <span style="color:${AL_COL[52]}">━ 52주</span> 이동평균 · 주봉 2년 · 로그 눈금 · 지난주 시총은 지금 시총 × (지난주 종가 ÷ 지금 종가)로 계산해서 3,000억 근처 종목은 원본과 다를 수 있어요 · 아이디어 찾기 용도 (매수·매도 추천 아님)</div>`;
}
document.addEventListener("toggle", (e) => {  // toggle 은 버블링이 안 돼서 capture 로
  const d = e.target;
  if (!d.matches?.(".alrow") || !d.open || d.dataset.done) return;
  const c = d.dataset.code, s = DASH?.stocks?.find((x) => x.code === c);
  d.querySelector(".cbox").innerHTML = candleSVG(ALIGN?.charts?.[c], "w", (v) => `${n(v, 0)}원`)
    + `<div class="src"><a href="https://finance.naver.com/item/fchart.naver?code=${esc(c)}" target="_blank" rel="noopener">네이버 차트</a>${s ? ` · <a href="#stock/${esc(c)}">우리 상세</a>` : ""}</div>`;
  d.dataset.done = 1;
}, true);
// 📊 기판 3사 26E~28E 비교 (사용자 11/9 메리츠 대덕전자 NDR 표 모양 — 경쟁사는 빼고 3종목만, 26년 추가, 영업이익·EPS 증가율)
//   휴대폰에서 옆으로 밀지 않게 회사를 칸(열)으로 · 숫자 = peers.json ann (와이즈리포트 컨센서스)
const CMP3 = ["009150", "353200", "007660"];
function cmp3HTML() {
  const rs = CMP3.map((c) => (PEERS?.groups || []).flatMap((g) => g.rows).find((r) => r.code === c && r.ann)).filter(Boolean);
  if (rs.length < 2) return "";
  const a = (r, y, k) => r.ann[y]?.[k] ?? null, gr = (x, y) => (x > 0 && y > 0 ? (x / y - 1) * 100 : null);  // 적자였거나 적자로 가면 비움 (table._g 와 같은 규칙)
  const yrs = Object.keys(rs[0].ann).sort().slice(1, 4);  // 올해E ~ 2년 뒤E (첫 해 = 작년 실적, 증가율 계산용)
  const M = [["P/E (배)", "낮을수록 이익에 비해 쌈", (r, y) => (a(r, y, "eps") > 0 && r.price ? r.price / a(r, y, "eps") : null), (v) => n(v, 1), -1],
    ["P/B (배)", "낮을수록 자산에 비해 쌈", (r, y) => (a(r, y, "bps") > 0 && r.price ? r.price / a(r, y, "bps") : null), (v) => n(v, 2), -1],
    ["영업이익 증가율 (%)", "전년 대비", (r, y) => gr(a(r, y, "op"), a(r, y - 1, "op")), (v) => sg(v, 1), 1],
    ["EPS 증가율 (%)", "전년 대비 주당순이익", (r, y) => gr(a(r, y, "eps"), a(r, y - 1, "eps")), (v) => sg(v, 1), 1],
    ["ROE (%)", "자기자본 대비 순이익", (r, y) => a(r, y, "roe"), (v) => n(v, 1), 1],
    ["매출액 (억원)", "", (r, y) => a(r, y, "sales"), (v) => n(v, 0), 0],
    ["영업이익 (억원)", "", (r, y) => a(r, y, "op"), (v) => n(v, 0), 0]];
  const nm = (r) => (DASH.stocks.some((s) => s.code === r.code) ? `<a href="#stock/${esc(r.code)}">${esc(r.name)}</a>` : esc(r.name));
  const body = M.map(([t, why, f, fm, best]) => `<tr><th colspan="${rs.length + 1}" style="text-align:left">${esc(t)}${why ? ` <span class="src">${esc(why)}</span>` : ""}</th></tr>`
    + yrs.map((y) => {
      const v = rs.map((r) => f(r, +y)), ok = v.filter((x) => x != null), b = best && ok.length > 1 ? (best < 0 ? Math.min(...ok) : Math.max(...ok)) : null;
      return `<tr><td>${y.slice(2)}E</td>${v.map((x) => `<td>${x == null ? "-" : x === b ? `<b>${fm(x)}</b>` : fm(x)}</td>`).join("")}</tr>`;
    }).join("")).join("");
  return `<h3>📊 기판 3사 ${yrs[0].slice(2)}E~${yrs.at(-1).slice(2)}E 비교 <span class="src">컨센서스 · ${esc(PEERS.updated_at || "")}</span></h3><div class="card">
    <div class="tbl-wrap"><table class="compact"><thead><tr><th></th>${rs.map((r) => `<th>${nm(r)}</th>`).join("")}</tr>
    <tr><td>시가총액</td>${rs.map((r) => `<td>${r.cap_krw ? n(r.cap_krw / 1e12, 1) + "조원" : "-"}</td>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>
    <div class="kidbox">🐣 굵은 글씨 = 세 회사 중 가장 싸거나(P/E·P/B) 가장 높은 값이에요. 이익이 빨리 크는데(증가율↑) P/E 가 낮으면 이익에 비해 덜 비싼 거예요.</div>
    <div class="note src">P/E·P/B = 지금 주가 ÷ 그해 예상 EPS·BPS · 증가율 = 전년 대비 (적자였으면 비움) · 예상 = 와이즈리포트(에프앤가이드) 증권사 평균 · ${esc(yrs[0].slice(2))}E 는 3분기까지 실적 + 4분기 예상 ·
    EV/EBITDA 는 안 넣음: 세 회사 모두 빚이 적어 P/E 와 순서가 같아요 (메리츠 11/9 표 27E: 대덕전자 5.7 · 이수페타시스 7.4 · 삼성전기 10.1배)</div></div>`;
}
async function loadIndustry() {
  if (!PEERS) { try { PEERS = await (await fetch("data/peers.json?t=" + encodeURIComponent(DASH.updated_at))).json(); } catch (_) { /* 📊 기판 3사 표만 빠짐 */ } }
  if (!AMZ) {
    try { AMZ = await (await fetch("data/amazon_kbeauty.json?t=" + Date.now(), { cache: "no-store" })).json(); }
    catch (e) { $("#industryBody").innerHTML = `<div class="empty">산업 데이터를 불러오지 못했어요.</div>`; return; }
  }
  if (!CAPEX) { try { CAPEX = await (await fetch("data/capex.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { CAPEX = {}; } }
  if (!DEF) { try { DEF = await (await fetch("data/defense.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { DEF = {}; } }
  await keyLoad();
  try { await gpeGet(); } catch (_) { /* 🌍 업종별 글로벌 PER 만 빠짐 */ }
  if (!EXP) { try { EXP = await (await fetch("data/exports.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { EXP = {}; } }
  if (!AUTOS) { try { AUTOS = await (await fetch("data/autosales.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { AUTOS = {}; } }
  await liGet();
  await drGet();
  await consGet();
  // 업종별로 한 칸씩 (2026-11-01 사용자 요청) — 맨 위 이름 목록을 누르면 그 업종 칸으로 · 🗺 시장 그룹판·🔭 차트 스캔은 📈 차트 탭
  const K = KEYC?.industry || {}, used = new Set(), key = (k) => { if (!K[k]) return ""; used.add(k); return keyGroup(k, K[k]); };
  const secs = [["📈 업종 컨센서스 한눈에", consIndHTML], ["💄 화장품", () => key("화장품") + consSec(["화장품"]) + expHTML("cosmetics") + gpeCard("화장품") + amzHTML()],
    ["🍜 라면·음식료", () => key("음식료") + consSec(["음식료"]) + expHTML("ramen") + ramenYtdHTML() + expHTML("food")],
    ["💾 반도체", () => drHTML() + `<div class="card" style="margin-top:8px">${cycHTML("005930")}${cycHTML("000660")}</div>` + consSec(["반도체"]) + expHTML("tech") + key("반도체")], ["⚡ 전력기기", () => consSec(["전력기기"]) + expHTML("power")], ["🔋 2차전지·ESS", () => liHTML() + consSec(["2차전지", "ESS"]) + key("2차전지")], ["🧱 기판·CCL", () => cmp3HTML() + consSec(["기판"]) + key("기판") + gpeCard("CCL·기판")],
    ["🛡 방산", () => consSec(["방산"]) + key("방산") + gpeCard("방산") + defenseHTML()], ["🤖 AI·빅테크", () => gpeCard("M7") + key("AI 자금줄") + capexHTML()],
    ["🏬 백화점", () => consSec(["유통"]) + gpeCard("백화점")], ["🎤 엔터", () => key("엔터")], ["🚗 자동차", () => autosalesHTML() + consSec(["자동차"]) + key("자동차") + expHTML("car") + gpeCard("자동차")], ["🦾 로봇", () => gpeCard("로봇")]]
    .map(([t, f]) => [t, f()]);
  secs.push(["🔑 그 밖의 업종", Object.keys(K).filter((k) => !used.has(k)).map((k) => keyGroup(k, K[k])).join("")], ["⚖️ 고정비·변동비 (전 업종)", costIndHTML()]);
  $("#industryBody").innerHTML = secs.filter(([, h]) => h).map(([t, h]) => `<section data-jump="${esc(t)}" data-jname="${esc(t)}" style="margin-top:18px"><h2 style="border-bottom:2px solid var(--border);padding-bottom:4px">${t}</h2>${h}</section>`).join("");
  jumpBar("#industryBody", "#indJump", "🔎 업종 검색 (예: 화장품) → Enter");
  setTimeout(kcGo, 50);  // 종목 상세에서 '자세한 내용 →' 으로 왔으면 그 카드로
  drawAmz();
}
// 🚗 현대차·기아 월별 글로벌 도매판매 (data/autosales.json ← collector/autosales.py, DART 월 판매 공시가 올라오면 다음 갱신 때 자동)
//   사용자 2026-11-03: 증권사 막대그림보다 쉽게 — 몇 대 팔았는지 + 전월·전 분기·전년 같은 때 대비 % 를 숫자로 먼저
let AUTOS = null;
function autosalesHTML() {
  const cars = (AUTOS?.cars || []).filter((c) => c.months.length);
  if (!cars.length) return "";
  const addM = (ym, k) => { const t = +ym.slice(0, 4) * 12 + (+ym.slice(5) - 1) + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
  const pc = (a, b) => (a != null && b ? (a / b - 1) * 100 : null);
  const cell = (v) => `<b class="${v == null ? "" : v >= 0 ? "kup" : "kdn"}">${sg(v, 1)}</b>`;
  const card = (c) => {
    const M = Object.fromEntries(c.months.map((r) => [r[0], r])), L = c.months.at(-1)[0], tot = (ym) => M[ym]?.[4] ?? null;
    const sum3 = (end) => { const v = [0, -1, -2].map((k) => tot(addM(end, k))); return v.every((x) => x != null) ? v.reduce((a, b) => a + b, 0) : null; };
    const qE = addM(L, -(+L.slice(5) % 3)), qLab = `${qE.slice(2, 4)}년 ${(+qE.slice(5)) / 3}분기`, mo = +L.slice(5);
    const r = M[L], lyR = M[addM(L, -12)];
    const rows = [[`${mo}월`, tot(L), "전월", pc(tot(L), tot(addM(L, -1))), pc(tot(L), tot(addM(L, -12)))],
      [qLab, sum3(qE), "전 분기", pc(sum3(qE), sum3(addM(qE, -3))), pc(sum3(qE), sum3(addM(qE, -12)))],
      ...(mo % 3 ? [[`최근 3개월 (${addM(L, -2).slice(5)}~${mo}월)`, sum3(L), "직전 3개월", pc(sum3(L), sum3(addM(L, -3))), pc(sum3(L), sum3(addM(L, -12)))]] : []),
      ...(c.last?.ytd && c.last.ym === L ? [[`올해 누적 (1~${mo}월)`, c.last.ytd, "", null, pc(c.last.ytd, c.last.ytd_ly)]] : [])];
    const tbl = `<div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">기간</th><th>판매 (대)</th><th>전월·전 분기 대비</th><th>작년 같은 때 대비</th></tr></thead><tbody>
      ${rows.map(([k, v, w, a, b]) => `<tr><td style="text-align:left">${esc(k)}</td><td><b>${v == null ? "-" : n(v)}</b></td><td>${w ? `<span class="src">${w}</span> ${cell(a)}` : "-"}</td><td>${cell(b)}</td></tr>`).join("")}</tbody></table></div>`;
    // 분기별 (최근 6분기, QoQ·YoY) · 연도별 (12달 다 있는 해 + 올해 누적은 작년 같은 달까지와 비교) — 사용자 2026-11-03 "QoQ·YoY 가 중요, 연도별도"
    const qRows = [0, 1, 2, 3, 4, 5].map((k) => addM(qE, -3 * k)).filter((e) => sum3(e) != null)
      .map((e) => [`${e.slice(2, 4)}.${(+e.slice(5)) / 3}Q`, sum3(e), pc(sum3(e), sum3(addM(e, -3))), pc(sum3(e), sum3(addM(e, -12)))]);
    const yt = (y, upto) => { const v = Array.from({ length: upto }, (_, i) => tot(`${y}-${String(i + 1).padStart(2, "0")}`)); return v.every((x) => x != null) ? v.reduce((a, b) => a + b, 0) : null; };
    const Y0 = +L.slice(0, 4), yRows = [Y0 - 3, Y0 - 2, Y0 - 1].filter((y) => yt(y, 12) != null).map((y) => [`${y}년`, yt(y, 12), pc(yt(y, 12), yt(y - 1, 12))]);
    if (mo < 12) yRows.push([`${Y0}년 1~${mo}월`, yt(Y0, mo) ?? c.last?.ytd, pc(yt(Y0, mo) ?? c.last?.ytd, yt(Y0 - 1, mo) ?? c.last?.ytd_ly)]);
    const mini = (h, rs, cols) => `<div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">${h}</th><th>판매 (대)</th>${cols.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>
      ${rs.map(([k, v, ...p]) => `<tr><td style="text-align:left">${esc(k)}</td><td>${v == null ? "-" : n(v)}</td>${p.map((x) => `<td>${cell(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const qy = `<div class="grid g2" style="margin-top:6px">${qRows.length ? mini("분기별", qRows, ["QoQ", "YoY"]) : ""}${yRows.length ? mini("연도별", yRows, ["YoY"]) : ""}</div>`;
    const split = r ? `<div class="note">${mo}월 국내 <b>${n(r[1])}</b>대 (${sg(pc(r[1], lyR?.[1]), 1)}) · 해외 <b>${n(r[2])}</b>대 (${sg(pc(r[2], lyR?.[2]), 1)})${r[3] ? ` · 특수 ${n(r[3])}대` : ""} <span class="src">괄호 = 작년 같은 달 대비</span></div>` : "";
    // 그림: 최근 36개월 막대 (같은 달 = 주황) · 점선 = 이번 달 · 막대에 손을 대면 그달 숫자
    const rs = c.months.slice(-36).filter((x) => x[4]), N = rs.length, W = 600, H = 196, x0 = 52, x1 = 592, top = 14, bot = 166;
    const vs = rs.map((x) => x[4]), lo = Math.floor((Math.min(...vs) * 0.92) / 1e4) * 1e4, hi = Math.max(...vs) * 1.02;
    const X = (i) => x0 + ((x1 - x0) * (i + 0.5)) / N, bw = ((x1 - x0) / N) * 0.72, Y = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top);
    let g = [lo, (lo + hi) / 2, hi].map((v) => `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${x0 - 4}" y="${Y(v) + 4}" text-anchor="end" class="qx">${n(v / 1e4, 0)}만</text>`).join("");
    rs.forEach((x, i) => {
      g += `<rect x="${X(i) - bw / 2}" y="${Y(x[4])}" width="${bw}" height="${bot - Y(x[4])}" rx="1.5" fill="${x[0].slice(5) === L.slice(5) ? "var(--s2)" : "var(--s1)"}"/>`;
      if (x[0].endsWith("-01")) g += `<text x="${X(i)}" y="${H - 14}" text-anchor="middle" class="qx">'${x[0].slice(2, 4)}</text>`;
    });
    g += `<line x1="${x0}" x2="${x1}" y1="${Y(tot(L))}" y2="${Y(tot(L))}" stroke="var(--ink-2)" stroke-dasharray="4 3"/><text x="${x1}" y="${Y(tot(L)) - 4}" text-anchor="end" class="qv b">${n(tot(L))}</text>`;
    g += tipCols(X, (x1 - x0) / N, top, bot, rs.map((x) => `${x[0]}\n${n(x[4])}대 (국내 ${n(x[1])} · 해외 ${n(x[2])})\n전월 ${sg(pc(x[4], tot(addM(x[0], -1))), 1)} · 작년 같은 달 ${sg(pc(x[4], tot(addM(x[0], -12))), 1)}`));
    return `<div class="card" style="padding:8px 10px"><div class="bhd"><b style="font-size:17px">${esc(c.name)}</b> <span class="src">${esc(c.code)} · ${esc(L)} 판매</span>${c.last?.url ? `<span class="bchd"><a href="${esc(c.last.url)}" target="_blank" rel="noopener" class="src">DART 공시 ${esc(c.last.date.slice(5))}</a></span>` : ""}</div>
      ${tbl}${split}${qy}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.name)} 월별 판매">${g}</svg>
      <div class="src">최근 36개월 · <span style="color:var(--s2)">■</span> 매년 ${mo}월 · 점선 = 이번 달 · 세로축은 ${n(lo / 1e4, 0)}만 대부터 (차이가 잘 보이게)</div></div>`;
  };
  return `<h3>🚗 현대차·기아 글로벌 도매판매 <span class="src">DART 월 판매 공시 (매달 1~2일) · 공시가 올라오면 다음 갱신 때 자동 · ${esc(AUTOS.updated_at || "")}</span></h3>
    <div class="grid g2">${cars.map(card).join("")}</div>
    <div class="kidbox">🐣 도매판매 = 공장에서 대리점·해외 법인으로 내보낸 차 수예요 (손님에게 판 '소매'와는 조금 달라요). 차는 달마다 일하는 날 수가 달라서, <b>작년 같은 달</b>과 비교하는 게 가장 정확해요. 전월·전 분기 대비는 흐름이 바뀌는지 볼 때 써요.</div>`;
}
// 🔑 키팩터 · 키차트 (config/keychart.yaml): 업종 묶음 = 산업 탭 + 그 업종 종목 상세, 종목 묶음 = 그 종목 상세
let KEYC = null;
async function keyLoad() {
  if (!KEYC) { try { KEYC = await (await fetch("data/keychart.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { KEYC = {}; } }
  return KEYC;
}
// 🔁 변화 막대표 (kind: chg): 지표마다 '지금 값' + 1년 전 대비 · 지난 분기 대비를 막대로 (초록 = 늘어남, 빨강 = 줄어듦, 🧭 점선 = 회사 가이던스)
//   rows [{n, now, ago 1년 전, prev 지난 분기, u 단위, d 소수, pp: true → %p 차이, yoy·qoq 직접 % (값이 없을 때), g: true 가이던스}]
//   사용자 2026-11-03: "숫자만으론 와닿지 않아 — 작년 동기·전 분기 대비 변화를 그림으로, 가이던스는 그림 안에"
function chgChart(ch) {
  const cap = ch.cap || 150, pc = (a, b, pp) => (a == null || b == null ? null : pp ? a - b : b > 0 ? (a / b - 1) * 100 : null);
  const R = (ch.rows || []).map((r) => ({ ...r, y: r.yoy ?? pc(r.now, r.ago, r.pp), q: r.qoq ?? pc(r.now, r.prev, r.pp) }));
  const mx = Math.max(1, ...R.flatMap((r) => [r.y, r.q]).filter((v) => v != null).map((v) => Math.min(Math.abs(v), cap)));
  const bar = (v, r) => (v == null ? `<span class="src">-</span>`
    : `<span class="cbar"><i style="width:${Math.max(2, (Math.min(Math.abs(v), cap) / mx) * 36)}px;background:${v < 0 ? "var(--bad)" : "var(--good)"}${r.g ? ";opacity:.4;outline:1px dashed var(--ink-2)" : ""}"></i><b style="color:${v < 0 ? "var(--bad-ink)" : "var(--good-ink)"}">${v > 0 ? "+" : ""}${n(v, Math.abs(v) < 10 ? 1 : 0)}${r.pp ? "%p" : "%"}</b></span>`);
  const val = (r) => (r.now == null ? "" : `${n(r.now, r.d ?? (Math.abs(r.now) < 100 && !Number.isInteger(r.now) ? 1 : 0))}${r.u || ""}`);
  return `<div class="qp"><div class="qt"><b>${esc(ch.t)}</b>${ch.tag || ""}</div>${ch.why ? `<div class="src">${esc(ch.why)}</div>` : ""}
    <div style="overflow-x:auto"><table class="compact" style="width:100%;font-size:12px"><tr><th style="text-align:left"></th><th>지금</th><th style="text-align:left">1년 전보다</th><th style="text-align:left">${ch.qh || "지난 분기보다"}</th></tr>
    ${R.map((r) => `<tr${r.g ? ' style="background:var(--surface-2)"' : ""}><td style="text-align:left">${r.g ? "🧭 " : ""}${esc(r.n)}</td><td style="white-space:nowrap"><b>${esc(val(r))}</b></td><td style="text-align:left">${bar(r.y, r)}</td><td style="text-align:left">${bar(r.q, r)}</td></tr>`).join("")}</table></div>
    ${ch.note ? `<div class="src" style="padding:4px">${esc(ch.note)}</div>` : ""}${ch.kid ? `<div class="kidbox" style="margin:4px;font-size:13px">🐣 ${esc(ch.kid)}</div>` : ""}</div>`;
}
// 그림: 쌓은 막대(bars) · 같은 단위 선(lines) · 위쪽 띠의 % 선(pct). 억원이 1조를 넘으면 조원, 칸이 많으면 연도는 1Q 에만
// 📈 kind: mcap — 시가총액 주봉 (collector/mcap.py 가 q·v 채움) + 사건 번호 (ev [{d: "2025-08", t}]) · 휴대폰이라 글은 그림 아래 번호 목록으로
function evLine(ch) {
  const q = ch.q || [], v = ch.v || [], N = q.length;
  if (N < 10) return "";
  const lo = ch.lo || 0, W = 340, x0 = 34, x1 = W - 8, top = 14, bot = 150, hi = Math.max(...v) * (lo ? 1.03 : 1.1), X = (i) => x0 + ((x1 - x0) * i) / (N - 1), Y = (y) => bot - ((y - lo) / (hi - lo)) * (bot - top);
  const t0 = 10 ** Math.floor(Math.log10((hi - lo) / 4)), tk = [1, 2, 5, 10].map((m) => m * t0).find((s) => (hi - lo) / s <= 5);
  let g = ch.base ? `<line x1="${x0}" x2="${x1}" y1="${Y(ch.base)}" y2="${Y(ch.base)}" stroke="var(--ink-2)" stroke-dasharray="4 3"/>` : "";  // base = 기준선 (소비자심리 100)
  for (let y = lo; y <= hi; y += tk) g += `<line x1="${x0}" x2="${x1}" y1="${Y(y)}" y2="${Y(y)}" stroke="var(--grid)"/><text x="${x0 - 3}" y="${Y(y) + 3}" text-anchor="end" class="qx">${n(y, 0)}</text>`;
  q.forEach((d, i) => { if (!i || d.slice(0, 4) !== q[i - 1].slice(0, 4)) g += `${i ? `<line x1="${X(i)}" x2="${X(i)}" y1="${top}" y2="${bot}" stroke="var(--grid)"/>` : ""}<text x="${X(i)}" y="${bot + 14}" text-anchor="${i ? "middle" : "start"}" class="qx">'${d.slice(2, 4)}</text>`; });
  g += `<path d="${v.map((y, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--s1)" stroke-width="2"/>`;
  const ev = (ch.ev || []).map((e, k) => { const i = q.findIndex((d) => d >= (e.d.length === 7 ? `${e.d}-15` : e.d)); return { ...e, k: k + 1, i: i < 0 ? N - 1 : i }; });
  ev.forEach((e) => { const x = X(e.i), y = Y(v[e.i]), up = e.k % 2; g += `<line x1="${x}" x2="${x}" y1="${y}" y2="${y + (up ? -14 : 14)}" stroke="var(--ink-2)" stroke-dasharray="2 2"/><circle cx="${x}" cy="${y}" r="2.5" fill="var(--ink)"/>`
    + `<text x="${x}" y="${y + (up ? -17 : 24)}" text-anchor="middle" class="qv b" style="font-size:9px">${e.k}</text>`; });
  const mx = Math.max(...v), im = v.indexOf(mx), last = v.at(-1), m6 = Math.min(...v.slice(-7));
  // 🛍 소비자심리: 지금 반등 신호인지 (6개월 최저 < 100 에서 +5 이상) · 예전에 롯데쇼핑 주가가 오른 건 최저 80 아래였을 때
  const stat = ch.kind === "ccsi" ? `<div class="note">${last - m6 >= 5 && m6 < 100 ? `🔔 <b>반등 신호</b> — 6개월 최저 ${n(m6, 1)} → 지금 ${n(last, 1)}${m6 < 80 ? " · 최저가 80 아래 (예전에 주가가 오른 조건)" : " · 최저가 80 위 (예전엔 이때 주가가 대부분 안 오름)"}` : `신호 없음 — 6개월 최저 ${n(m6, 1)} · 지금 ${n(last, 1)} (100 = 보통)`}${ch.src_auto ? ` <span class="src">${esc(ch.src_auto)}</span>` : ""}</div>` : "";
  g += tipCols(X, (x1 - x0) / (N - 1), 0, bot + 16, q.map((d, i) => `${d}\n시가총액 ${n(v[i], 0)}${ch.u ? " " + ch.u : ""}${ev.filter((e) => e.i === i).map((e) => `\n${e.k}. ${e.t}`).join("")}`));
  return `<div class="qp" style="grid-column:1/-1"><div class="qt"><b>${esc(ch.t)}</b></div>${ch.why ? `<div class="src">${esc(ch.why)}</div>` : ""}
    ${stat || `<div class="note">지금 <b>${n(last, 0)}${esc(ch.u || "")}</b> (${esc(q.at(-1))}) · 최고 ${n(mx, 0)} (${esc(q[im])}) 대비 <b>${pct((last / mx - 1) * 100, 0, true)}</b></div>`}
    <svg viewBox="0 0 ${W} ${bot + 20}" width="100%" role="img" aria-label="${esc(ch.t)}">${g}</svg>
    <ol class="irl" style="font-size:12px;margin:4px 0 0;padding-left:22px">${ev.map((e) => `<li value="${e.k}"><span class="src">${esc(e.d.slice(2, 7).replace("-", "."))}</span> ${esc(e.t)}</li>`).join("")}</ol>
    ${ch.kid ? `<div class="kidbox">🐣 ${esc(ch.kid)}</div>` : ""}</div>`;
}
function keyChart(ch) {
  if (ch.kind === "mcap" || ch.kind === "ccsi") return evLine(ch);
  // kind: line → 0 아래(적자)도 그리는 꺾은선 + 칸마다 숫자 (종목 그래프와 같은 모양)
  if (ch.kind === "line") return kpiChart({ ...ch, s: (ch.lines || []).map((s) => ({ n: s.n, v: Object.fromEntries((ch.q || []).map((q, i) => [q, s.v[i]]).filter(([, v]) => v != null)) })) });
  if (ch.kind === "chg") return chgChart(ch);
  // side: true → 막대를 쌓지 않고 나란히 (미국 상업 vs 정부처럼 둘이 같이 크는지 보기) · gq [칸 이름] → 그 칸은 회사 가이던스 (옅은 점선 막대) · col → 막대 색
  const L = ch.q || [], N = L.length, W = 320, x0 = 12, bw = (W - 2 * x0) / N, X = (i) => x0 + bw * i + bw / 2, side = !!ch.side, gq = new Set(ch.gq || []);
  const bars = ch.bars || [], lines = ch.lines || [], tot = L.map((_, i) => (side ? Math.max(0, ...bars.map((s) => s.v[i] || 0)) : bars.reduce((a, s) => a + (s.v[i] || 0), 0)));
  const all = [...(bars.length ? tot : []), ...lines.flatMap((s) => s.v)].filter((v) => v != null);
  if (N < 2 || !all.length) return "";
  const jo = ch.u === "억원" && Math.max(...all) >= 1e4, dv = jo ? 1e4 : 1, un = jo ? "조원" : ch.u || "", V = (v) => n(v / dv, jo ? 1 : ch.d || 0);  // d = 소수 자리 (DDR5 값 등)
  const top = ch.pct ? 72 : 24, bot = 146, hi = Math.max(...all) * 1.08, Y = (v) => bot - (v / hi) * (bot - top);
  const BC = ch.col || ["var(--muted)", "var(--s1)", "var(--s3)", "var(--s4)"];
  let g = `<line x1="${x0}" x2="${W - x0}" y1="${bot}" y2="${bot}" stroke="var(--axis)"/>`;
  L.forEach((q, i) => {
    const isG = gq.has(q), fill = (c) => (isG ? `fill="${c}" fill-opacity=".22" stroke="${c}" stroke-dasharray="3 2"` : `fill="${c}" opacity=".8"`);
    g += `<text x="${X(i)}" y="${bot + 15}" text-anchor="middle" class="qx"${isG ? ' style="font-weight:700"' : ""}>${esc(ch.every ? ((N - 1 - i) % ch.every === 0 ? q : "") : N <= 8 || i === 0 || q.startsWith("1Q") ? q : q.slice(0, 2))}</text>`;  // every = 몇 칸마다 이름 (분기 39칸 수출 비중)
    if (!bars.length) return;
    if (side) {  // 나란히: 칸마다 막대 여러 개, 숫자는 마지막 두 칸만 (나머지는 위 표·누르면 보기)
      const w = (bw * 0.76) / bars.length;
      bars.forEach((s, si) => {
        const v = s.v[i], x = X(i) - bw * 0.38 + si * w, c = BC[si % BC.length];
        if (v == null) return;
        g += `<rect x="${x}" y="${Y(v)}" width="${w - 1}" height="${Math.max(1, bot - Y(v))}" ${fill(c)}/>`;
        if (i >= N - 2) g += `<text x="${x + w / 2}" y="${Y(v) - 3 - (si % 2) * 10}" text-anchor="${si % 2 ? "start" : "end"}" class="qv b" style="font-size:9px;fill:${c}">${V(v)}</text>`;  // 옆 막대 숫자와 안 겹치게 바깥쪽·위아래로
      });
      return;
    }
    let acc = 0;
    bars.forEach((s, si) => { const v = s.v[i]; if (!v) return; g += `<rect x="${X(i) - bw * 0.32}" y="${Y(acc + v)}" width="${bw * 0.64}" height="${Math.max(1, Y(acc) - Y(acc + v))}" ${fill(BC[si % BC.length])}/>`; acc += v; });
    g += `<text x="${X(i)}" y="${Y(tot[i]) - 4}" text-anchor="middle" class="qv${i === N - 1 || isG ? " b" : ""}">${V(tot[i])}</text>`;
  });
  const ends = [];  // 선은 끝 숫자만 (겹치면 아래로 밀기)
  lines.forEach((s, si) => {
    const col = KPI_COL[si % 4], pts = s.v.map((v, i) => [i, v]).filter(([, v]) => v != null);
    g += `<path d="${pts.map(([i, v], j) => `${j ? "L" : "M"}${X(i)},${Y(v)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>`
      + pts.map(([i, v]) => `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="var(--surface)" stroke="${col}" stroke-width="2"/>`).join("");
    const xy = pts.map(([i, v]) => [X(i), Y(v)]);
    ends.push([xy.at(-1)[0], clearY(xy, xy.length - 1, 16), pts.at(-1)[1], col]);
  });
  ends.sort((a, b) => b[1] - a[1]).forEach((e, i, a) => { if (i && a[i - 1][1] - e[1] < 14) e[1] = a[i - 1][1] - 14; });  // 겹치면 위로 (선 쪽으로 안 내려가게)
  ends.forEach(([x, y, v, col]) => { g += `<text x="${x}" y="${y}" text-anchor="middle" class="qv b" style="fill:${col}">${V(v)}</text>`; });
  if (ch.pct) {  // % 선은 막대 위쪽 띠에 따로 (숫자는 칸마다)
    const pv = ch.pct.v, lv = pv.filter((v) => v != null), lh = Math.max(...lv), ll = Math.min(...lv), PY = (v) => 56 - ((v - ll) / ((lh - ll) || 1)) * 34;
    const pp = pv.map((v, i) => (v == null ? null : [X(i), PY(v)]));
    g += `<polyline points="${pv.map((v, i) => (v == null ? "" : `${X(i)},${PY(v)}`)).join(" ")}" fill="none" stroke="var(--ink)" stroke-width="2"/>`
      + pv.map((v, i) => (v == null ? "" : `<circle cx="${X(i)}" cy="${PY(v)}" r="3" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/><text x="${X(i)}" y="${clearY(pp, i)}" text-anchor="middle" class="qv${i === pv.length - 1 ? " b" : ""}"${v < 0 || v < lh / 4 ? ' style="fill:var(--bad-ink)"' : ""}>${n(v, 0)}%</text>`)).join("");
  }
  g += tipCols(X, bw, 0, 166, L.map((q, i) => [q, ...[...bars, ...lines].map((s) => (s.v[i] == null ? null : `${s.n}: ${V(s.v[i])}${un && un !== "%" ? " " + un : un}`)), ch.pct?.v[i] != null ? `${ch.pct.n}: ${n(ch.pct.v[i], 1)}%` : null].filter(Boolean).join("\n")));
  const leg = [...bars.map((s, si) => `<span style="color:${BC[si % BC.length]}">■</span> ${esc(s.n)}`), ...lines.map((s, si) => `<span style="color:${KPI_COL[si % 4]}">●</span> ${esc(s.n)}`),
    ...(ch.pct ? [`● ${esc(ch.pct.n)}`] : [])].join(" · ");
  // tbl: true → 그림 위에 모든 칸 숫자 표 (수치 먼저 → 그림 → 🐣 kid)
  const tb = ch.tbl ? `<div style="overflow-x:auto"><table class="compact" style="width:100%;font-size:11px"><tr><th></th>${L.map((q) => `<th>${esc(q)}</th>`).join("")}</tr>
    ${[...bars, ...lines].map((s) => `<tr><td style="text-align:left">${esc(s.n)}</td>${L.map((_, i) => `<td>${s.v[i] == null ? "-" : i === N - 1 ? `<b>${V(s.v[i])}</b>` : V(s.v[i])}</td>`).join("")}</tr>`).join("")}</table></div>` : "";
  return `<div class="qp"><div class="qt"><b>${esc(ch.t)} <span class="src">${esc(un)}</span></b></div>${ch.why ? `<div class="src">${esc(ch.why)}</div>` : ""}${tb}
    <svg viewBox="0 0 ${W} 166" role="img" aria-label="${esc(ch.t)}">${g}</svg><div class="src" style="padding:0 4px 4px">${leg}${ch.note ? `<br>${esc(ch.note)}` : ""}</div>
    ${ch.kid ? `<div class="kidbox" style="margin:4px;font-size:13px">🐣 ${esc(ch.kid)}</div>` : ""}</div>`;
}
// 이익 변동 요인 (from → 요인들 → to): 막대 길이 = 크기, 빨강 = 줄인 요인
function keyWf(w) {
  const mx = Math.max(w.from[1], w.to[1], ...w.steps.map((s) => Math.abs(s[1]))) || 1;
  const row = (name, v, col, sign) => `<tr><td style="text-align:left">${esc(name)}</td><td style="text-align:left"><span class="cbar"><i style="width:${Math.max(2, (Math.abs(v) / mx) * 120)}px;background:${col}"></i>${sign && v > 0 ? "+" : ""}${n(v, 0)}</span></td></tr>`;
  return `<div class="qp"><div class="qt"><b>${esc(w.t)} <span class="src">억원 · 대략</span></b></div><table class="compact" style="width:100%">
    ${row(w.from[0], w.from[1], "var(--muted)")}${w.steps.map(([k, v]) => row(k, v, v < 0 ? "var(--bad)" : "var(--good)", true)).join("")}${row(w.to[0], w.to[1], "var(--s1)")}</table></div>`;
}
// 📍 기준일(발표 전일 등) 대비 지금 주가와 그 뒤 가장 낮았던 종가 — 예전 같은 일(then)과 나란히
function keyTrack(t) {
  const c = t && DASH.stocks.find((x) => x.code === t.code);
  if (!c) return "";
  const ch = c.chart || {}, i = (ch.dates || []).findIndex((d) => d > t.d), after = i < 0 ? [] : ch.close.slice(i).filter((v) => v != null);
  const r = (v) => pct((v / t.p - 1) * 100, 1, true);
  return `<div class="note">📍 <b>${esc(c.name)} 주가</b>: ${esc(t.n)}(${esc(t.d.slice(5).replace("-", "/"))}) ${n(t.p, 0)}원 대비 지금 <b>${r(c.price)}</b>${after.length ? ` · 그 뒤 가장 낮은 종가 ${r(Math.min(...after))}` : ""}${t.then ? ` <span class="src">(예전 ${esc(t.then)})</span>` : ""}</div>`;
}
function keyCard(c, open) {
  const li = (x) => `<li>${esc(x)}</li>`;
  return `<details class="card" style="margin-top:8px;background:var(--surface-2)"${c.id ? ` id="kc-${esc(c.id)}"` : ""}${open ? " open" : ""}><summary><b>📌 ${esc(c.t)}</b> <span class="src">${esc(c.d || "")}</span></summary>
    <div class="qgrid" style="margin-top:6px">${(c.charts || []).map(keyChart).join("")}${(c.wf || []).map(keyWf).join("")}</div>
    ${(c.img || []).map((x) => `<figure style="margin:6px 0"><img src="${esc(x.src)}" alt="${esc(x.alt || c.t)}" loading="lazy" style="width:100%;height:auto;border-radius:8px;background:#fff"><figcaption class="src">${esc(x.cap || "")}</figcaption></figure>`).join("")}
    ${(c.lines || []).length ? `<ul class="irl">${c.lines.map(li).join("")}</ul>` : ""}${keyTrack(c.track)}
    ${c.go ? `<div class="note"><a href="#industry" data-kc="${esc(c.go)}">👉 자세한 내용: 산업 탭 '${esc(c.go_t || "전체 카드")}' 보기 →</a></div>` : ""}
    ${(c.turn || []).length ? `<div class="kidbox" style="margin-top:6px">🔄 <b>변곡점 체크</b><ul class="irl">${c.turn.map(li).join("")}</ul></div>` : ""}
    <div class="note src">출처: ${esc(c.src || "")}${(c.u || []).map((x) => ` · <a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)}</a>`).join("")}</div></details>`;
}
// 묶음 하나: 키팩터 한 줄 + 변곡점 체크 + 카드들 (code = 지금 보는 종목 → 그 종목이 주인공인 카드만 펼침, 산업 탭은 모두 펼침)
function keyGroup(name, g, code) {
  return `<div class="card" style="margin-top:8px"><b>🔑 ${esc(name)} 키팩터</b> ${esc(g.key || "")}
    ${(g.turn || []).length ? `<div class="kidbox" style="margin-top:6px">🔄 <b>업종 변곡점 체크</b><ul class="irl">${g.turn.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}${evHTML(g.ev)}${vcHTML(g.vc)}
    ${(g.cards || []).filter((c) => code || !c.stock_only).map((c) => keyCard(c, !code || [].concat(c.code).includes(code))).join("")}</div>`;
}
// 📅 업종 이벤트 일정표 (keychart.yaml 묶음의 ev: {t 제목, src, note, rows [{d 정렬 날짜, w 보이는 날짜, e 이벤트, p 확인 포인트, k 1 = 특히 중요}]}) — 사용자 11/5 2차전지 일정
function evHTML(ev) {
  if (!ev?.rows?.length) return "";
  const today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10), nx = ev.rows.find((x) => x.d >= today);
  const tr = (x) => {
    const past = x.d < today, dd = Math.round((new Date(x.d) - new Date(today)) / 864e5), exact = /^\d+\/\d+$/.test(x.w);
    return `<tr style="${past ? "opacity:.45;" : ""}${x.k ? "background:var(--warn-bg);" : ""}${x === nx ? "outline:2px solid var(--s1);" : ""}"><td style="white-space:nowrap">${esc(x.w)}${past ? `<br><span class="src">지남</span>` : exact ? `<br><b class="src">${dd ? `D-${dd}` : "오늘"}</b>` : ""}</td>`
      + `<td style="text-align:left;white-space:normal">${x.k ? "⭐ " : ""}${esc(x.e)}</td><td style="text-align:left;white-space:normal" class="src">${esc(x.p || "")}</td></tr>`;
  };
  return `<details class="fvt" open style="margin-top:8px"><summary class="chart-title"><b>📅 ${esc(ev.t || "주요 일정")}</b> <span class="src">⭐ = 특히 중요 · 파란 테두리 = 다음 일정 · 지난 일정은 흐리게</span></summary>
    <div class="tbl-wrap"><table class="compact" style="width:100%"><thead><tr><th>일정</th><th style="text-align:left">이벤트</th><th style="text-align:left">확인 포인트</th></tr></thead><tbody>${ev.rows.map(tr).join("")}</tbody></table></div>
    ${ev.note ? `<div class="kidbox" style="margin-top:6px">${esc(ev.note)}</div>` : ""}${ev.src ? `<div class="note src">출처: ${esc(ev.src)}</div>` : ""}</details>`;
}
// 🏛 정책 탭 (사용자 11/5: "맨 끝에 정책 탭 — 선거·정책 이런 걸 메모해 나가기") ← keychart.yaml policy: {ev 일정표, notes [카드 + top 핵심 줄], 최신이 위}
async function renderPolicy() {
  const P = (await keyLoad()).policy || {};
  $("#policyBody").innerHTML = (P.notes || []).map((c) => `${(c.top || []).length ? `<div class="kidbox" style="margin-top:12px">📌 <b>${esc(c.t)}</b> <span class="src">${esc(c.d || "")}</span><ul class="irl">${c.top.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}${keyCard(c, true)}`).join("")
    + evHTML(P.ev) || `<div class="empty">config/keychart.yaml 의 policy 에 메모를 넣으면 여기에 보여요.</div>`;
}
// 🔗 밸류체인 표 (keychart.yaml 묶음의 vc: [{t, why, kid, rows [[단계, 회사들]]}]) — 우리 종목 이름은 굵게
function vcHTML(vc) {
  if (!vc?.length) return "";
  const ours = [...new Set((DASH?.stocks || []).map((c) => c.name))].sort((a, b) => b.length - a.length);
  const bold = (t) => ours.reduce((s, nm) => s.split(esc(nm)).join(`<b>${esc(nm)}</b>`), esc(t));
  return vc.map((v) => `<details class="fvt" open style="margin-top:8px"><summary class="chart-title"><b>🔗 ${esc(v.t)}</b> <span class="src">굵은 글씨 = 이 사이트에서 보는 종목</span></summary>
    <div class="tbl-wrap"><table class="compact" style="width:100%"><tbody>${v.rows.map(([s, x]) => `<tr><td style="white-space:nowrap;text-align:left"><b>${esc(s)}</b></td><td style="text-align:left;white-space:normal">${bold(x)}</td></tr>`).join("")}</tbody></table></div>
    ${v.kid ? `<div class="kidbox" style="margin-top:6px">🐣 ${esc(v.kid)}</div>` : ""}${v.why ? `<div class="note src">${esc(v.why)}</div>` : ""}</details>`).join("");
}
/* ---------- 📈 업종별 매출·영업이익 컨센서스 추이 (data/cons_ind.json ← collector/cons_trend.py) — 사용자 11/5: 증권사 '셀 업체 컨센서스' 그림처럼 모든 업종, 종목 상세에선 닫아 둠 ---------- */
let CONS = null;
async function consGet() { if (!CONS) { try { CONS = await (await fetch("data/cons_ind.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { CONS = {}; } } return CONS; }
const consJo = (v) => (Math.abs(v) >= 1e4 ? `${n(v / 1e4, 1)}조` : `${n(v, 0)}억`);
function consRef(s, mo) {  // mo 달(×30일) 전이거나 그보다 앞선 마지막 점 — 지난 1년은 달마다 점이라 그달 말 값
  const L = s.at(-1)?.[0];
  if (!L) return null;
  const cut = new Date(+new Date(L) - mo * 30 * 864e5).toISOString().slice(0, 10);
  return [...s].reverse().find((x) => x[0] <= cut) || null;
}
function consChg(s, mo) {
  const r = consRef(s, mo), v = s.at(-1)?.[1];
  return r && v != null ? { p: r[1] > 0 && v > 0 ? (v / r[1] - 1) * 100 : null, d: v - r[1] } : null;
}
const consCell = (c) => (c ? `<b class="${kcol(c.d)}">${c.p != null ? sg(c.p, 1) : (c.d > 0 ? "+" : "") + consJo(c.d)}</b>` : "-");
function consHTML(g, open) {
  const ys = CONS.years, nm = { rev: "매출", op: "영업이익" };
  const chart = (it) => {
    const L = [...new Set(ys.flatMap((y) => g[it][y].map((x) => x[0])))].sort(), at = (y) => { const m = Object.fromEntries(g[it][y]); return L.map((d) => m[d] ?? null); };
    return lineChart({ t: `${nm[it]} 컨센서스`, labels: L, s: [{ n: `${ys[0]}년`, v: at(ys[0]), col: "var(--s1)" }, { n: `${ys[1]}년`, v: at(ys[1]), col: "var(--muted)", right: true, lab: "below" }],
      fl: consJo, fr: consJo, tick: (i) => (/-(01|04|07|10)-/.test(L[i]) && (!i || L[i].slice(0, 7) !== L[i - 1].slice(0, 7)) ? `${L[i].slice(2, 4)}.${L[i].slice(5, 7)}` : "") });
  };
  const rows = ["rev", "op"].flatMap((it) => ys.map((y) => { const s = g[it][y]; return s.length ? `<tr><td style="text-align:left">${nm[it]} ${y}E</td><td><b>${consJo(s.at(-1)[1])}</b></td><td>${consCell(consChg(s, 1))}</td><td>${consCell(consChg(s, 3))}</td></tr>` : ""; })).join("");
  const r1 = consChg(g.op[ys[0]], 1) || {}, o3 = consChg(g.op[ys[1]], 3), o3a = consChg(g.op[ys[0]], 3), word = (c) => (c?.d > 0 ? "올라갔어요" : c?.d < 0 ? "내려갔어요" : "그대로예요");
  const kid = o3 ? `🐣 증권사들이 보는 ${esc(g.k)} 회사들의 내년(${ys[1]}년) 영업이익이 3달 전보다 ${o3.p != null ? n(Math.abs(o3.p), 1) + "% " : ""}${word(o3)}${o3a ? ` · 올해(${ys[0]}년)는 ${o3a.p != null ? n(Math.abs(o3a.p), 1) + "% " : ""}${word(o3a)}` : ""}. 숫자가 꾸준히 올라가면 '실적 기대가 높아지는 업종', 꺾여 내려가면 '기대가 낮아지는 업종'이에요.` : "";
  const ref = (b) => { const r = consRef(g.op[ys[0]], b); return r ? `${+r[0].slice(5, 7)}/${+r[0].slice(8, 10)} 대비` : ""; };
  const memo = Object.keys(g.mem || {}).length ? ` · 일부 칸은 자료가 짧은 종목을 뺀 합계` : "";
  return `<details class="card" style="margin-top:8px"${open ? " open" : ""}><summary class="chart-title"><b>📈 ${esc(g.k)} 매출·영업이익 컨센서스</b> <span class="src">${g.names.map(esc).join(" · ")} 합계 · 영업이익 ${ys[1]}E ${ref(3)} ${consCell(o3)}</span></summary>
    <div class="tbl-wrap"><table class="compact" style="width:100%;margin-top:6px"><thead><tr><th style="text-align:left">합계</th><th>지금</th><th>${ref(1)}</th><th>${ref(3)}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="grid g2">${chart("rev")}${chart("op")}</div>
    ${kid ? `<div class="kidbox" style="margin-top:6px">${kid}</div>` : ""}
    <div class="note src">${esc(CONS.src || "")} · ${esc(g[`op`][ys[0]].at(-1)?.[0] || "")} 기준 · 지난 1년은 달마다, 11/5 부터는 매일 점이 쌓여요${memo} · 영업이익이 적자→흑자로 바뀌면 % 대신 금액 차이 · 매수·매도 추천 아님</div></details>`;
}
function consIndHTML() {  // 산업 탭 맨 위: 모든 업종 한눈에 (내년 영업이익 예상이 3달 전보다 많이 오른 순)
  const G = CONS?.groups || [];
  if (!G.length) return "";
  const y = CONS.years[1], k3 = (g) => consChg(g.op[y], 3);
  const S = [...G].sort((a, b) => (k3(b)?.p ?? -1e9) - (k3(a)?.p ?? -1e9));
  return `<div class="note src">한국 보유·관심·공동 종목을 업종끼리 더한 증권사 컨센서스(와이즈리포트) · 업종을 누르면 아래에서 그림이 열려요 · 업종 칸이 따로 있는 곳(2차전지·반도체·방산 …)은 그 칸에도 있어요</div>
    <div class="tbl-wrap"><table class="compact" style="width:100%"><thead><tr><th style="text-align:left">업종</th><th>${CONS.years[0]}E 영업이익<br><span class="src">3달 전 대비</span></th><th>${y}E 영업이익<br><span class="src">3달 전 대비</span></th><th>${y}E 매출<br><span class="src">3달 전 대비</span></th></tr></thead><tbody>
    ${S.map((g) => `<tr><td style="text-align:left;white-space:normal"><a href="#industry" data-cons="${esc(g.k)}">${esc(g.k)}</a> <span class="src">${g.names.length}곳</span></td><td>${consCell(consChg(g.op[CONS.years[0]], 3))}</td><td>${consCell(k3(g))}</td><td>${consCell(consChg(g.rev[y], 3))}</td></tr>`).join("")}</tbody></table></div>
    <div id="consAll">${S.map((g) => `<div data-consk="${esc(g.k)}">${consHTML(g, false)}</div>`).join("")}</div>`;
}
document.addEventListener("click", (e) => {  // 한눈에 표의 업종 이름 → 그 업종 그림 열고 스크롤
  const a = e.target.closest("[data-cons]"); if (!a) return;
  e.preventDefault();
  const d = document.querySelector(`#consAll [data-consk="${CSS.escape(a.dataset.cons)}"] details`);
  if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); }
});
const consFor = (code) => (CONS?.groups || []).find((g) => g.codes.includes(code));
const consSec = (ks) => [...new Set(ks.flatMap((k) => (CONS?.groups || []).filter((g) => g.k.includes(k))))].map((g) => consHTML(g, true)).join("");  // ks 순서대로 (2차전지 → ESS)
/* ---------- 🪨 중국 탄산리튬 가격 (data/lithium.json ← collector/lithium.py, 평일 하루 두 번) — 사용자 11/5: 매일 트래킹, 삼성SDI·LG엔솔 상세에서 바로 ---------- */
let LI = null;
const LI_CODES = ["006400", "373220", "096770"];  // 셀 회사: 삼성SDI · LG에너지솔루션 · SK이노베이션(SK온)
async function liGet() { if (!LI) { try { LI = await (await fetch("data/lithium.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { LI = {}; } } return LI; }
function liStat(L) {
  const d = L?.d || [];
  if (d.length < 30) return null;
  const last = d.at(-1), t0 = +new Date(last[0]);
  const at = (days) => { for (let i = d.length - 1; i >= 0; i--) if (+new Date(d[i][0]) <= t0 - days * 864e5) return d[i][1]; return null; };
  const ch = (v) => (v ? (last[1] / v - 1) * 100 : null), y1 = String(+last[0].slice(0, 4) - 1) + last[0].slice(4);
  const hi = d.filter((x) => x[0] >= y1).reduce((a, b) => (b[1] > a[1] ? b : a)), m1 = ch(at(28));
  return { last, a1: at(365), d1: ch(d.at(-2)[1]), w1: ch(at(7)), m1, m3: ch(at(91)), y1: ch(at(365)), ytd: ch([...d].reverse().find((x) => x[0] < last[0].slice(0, 4))?.[1]), hi, dd: ch(hi[1]),
    tr: m1 == null ? null : m1 <= -5 ? ["🔻", "내리는 중", "--bad"] : m1 >= 5 ? ["🔺", "오르는 중", "--good"] : ["↔", "멈춤 (4주 ±5% 안)", "--muted"] };
}
const liW = (v) => `${n(v / 1e4, 1)}만 위안`;
const liPill = (s) => `<span class="pill ${s.tr[0] === "🔻" ? "red" : s.tr[0] === "🔺" ? "green" : "yellow"}">🪨 탄산리튬 ${liW(s.last[1])}/톤 · 4주 ${sg(s.m1, 1)} · 1년 고점 ${sg(s.dd, 0)}</span>`;
function liHTML(code) {
  const s = liStat(LI);
  if (!s) return "";
  const wk = {};  // 주마다 마지막 날 (2025년부터 — 증권사 그림과 같은 기간)
  LI.d.filter((x) => x[0] >= "2025-01-01").forEach(([dt, v]) => { const t = new Date(dt), k = new Date(t - ((t.getDay() + 1) % 7) * 864e5).toISOString().slice(0, 10); wk[k] = [dt, v]; });
  const W = Object.values(wk), cell = (t, v) => `<div class="k">${t}</div><div class="v"><b class="${kcol(v)}">${sg(v, 1)}</b></div>`;
  const me = code ? `<div class="note">🔗 ${esc(DASH?.stocks?.find((c) => c.code === code)?.name || "")}는 배터리 <b>셀</b> 회사예요 → 리튬이 싸지면 재료값이 줄어드는 쪽. 다만 판매가격도 금속값에 몇 달 늦게 따라 내려가서, 값이 빨리 내리면 비싸게 사 둔 재료 때문에 잠깐 이익률이 깎이기도 해요(역래깅).</div>` : "";
  return `<div class="card" style="margin-top:8px" data-jump="lithium" data-jname="🪨 탄산리튬"><div class="chart-title"><b>🪨 중국 탄산리튬 가격 (매일)</b> <span class="src">${esc(s.last[0])} 종가 · <b style="color:var(${s.tr[2]})">${s.tr[0]} ${s.tr[1]}</b></span></div>
    <div style="font-size:20px;margin:4px 0"><b>${liW(s.last[1])}</b> <span class="src">/톤</span> <span class="${kcol(s.d1)}">${sg(s.d1, 1)}</span> <span class="src">하루</span></div>
    <div class="kv" style="grid-template-columns:repeat(4,auto);gap:2px 10px">${cell("1주", s.w1)}${cell("4주", s.m1)}${cell("3개월", s.m3)}${cell("1년", s.y1)}${cell("올해", s.ytd)}${cell(`1년 고점 ${esc(s.hi[0].slice(2, 7).replace("-", "."))} ${liW(s.hi[1])} 대비`, s.dd)}</div>
    ${lineChart({ t: "탄산리튬 선물 (주마다 마지막 날 종가, 만 위안/톤)", labels: W.map((x) => x[0]), s: [{ n: "탄산리튬", v: W.map((x) => x[1] / 1e4), col: "var(--s1)" }], fl: (v) => n(v, 1),
      tick: (i) => (i && W[i][0].slice(5, 7) !== W[i - 1][0].slice(5, 7) && /-(01|07)-/.test(W[i][0]) ? `${W[i][0].slice(2, 4)}.${W[i][0].slice(5, 7)}` : "") })}
    <div class="kidbox" style="margin-top:6px">🐣 리튬은 배터리에 꼭 들어가는 재료예요. 1년 전엔 1톤에 ${liW(s.a1 || 0)}쯤 하던 게 ${esc(s.hi[0].slice(2, 4))}년 ${+s.hi[0].slice(5, 7)}월 ${liW(s.hi[1])}까지 올랐다가 지금 ${liW(s.last[1])}로 내려왔어요. 배터리를 <b>만드는</b> 회사(셀)엔 재료값이 싸지는 일이지만, 재료를 <b>파는</b> 회사(양극재 등 소재)엔 파는 값이 내려가는 일이에요.</div>
    <ul class="irl" style="margin-top:6px">
      <li>📉 왜 내리나 (신한투자증권): 중국 안 재고가 늘고 · 광산 공급이 늘고 · 전기차 수요가 약해서</li>
      <li>🔋 셀 회사 (LG에너지솔루션·삼성SDI·SK온) = 원재료 비용이 줄어드는 쪽</li>
      <li>🧪 소재 회사 (에코프로비엠·포스코퓨처엠·엘앤에프) = 판매가격 하락 + 재고평가손실 (비싸게 산 재고 값이 깎임)</li>
      <li>🔄 볼 것: 소재 회사는 수주가 느는 것보다, <b>리튬값이 멈추고(↔) 공장 가동률이 돌아와</b> 실제 이익이 나아지는지가 중요</li></ul>${me}
    <div class="note src">출처: ${esc(LI.src || "")} · ${esc(LI.updated_at || "")} 받음 · 4주 −5% 아래 = 🔻 · +5% 위 = 🔺 · 그 사이 = ↔ · 증권사 그림(KOMIS 현물, 달러/kg)과 단위·기준이 달라 숫자가 조금 달라요 · 원화는 오늘 환율로 바꾼 대략</div></div>`;
}
/* ---------- 💾 D램 가격 (data/dram.json ← collector/dram.py, 트렌드포스 공개 화면 평일 하루 두 번 · 받은 날은 쌓아 둠) — 사용자 11/6: 크로스체크·트래킹, "이번에 꺾였어" ---------- */
let DR = null;
const DR_CODES = ["005930", "005935", "000660", "MU"], DR_MAIN = "DDR5 16Gb (2Gx8) 4800/5600";
async function drGet() { if (!DR) { try { DR = await (await fetch("data/dram.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { DR = {}; } } return DR; }
function drStat(D, name = DR_MAIN) {
  const h = D?.hist?.[name] || [], row = D?.secs?.dram_spot?.rows?.find((r) => r.n === name);
  if (!h.length || !row) return null;
  const hi = h.reduce((a, b) => (b[1] >= a[1] ? b : a)), last = h.at(-1), dd = (last[1] / hi[1] - 1) * 100;
  let down = 0; for (let i = h.length - 1; i > 0 && h[i][1] < h[i - 1][1]; i--) down++;  // 기록된 날끼리 연속 하락
  const tr = row.chg < 0 && dd <= -1 ? ["🔻", `꺾임 — 고점 대비 ${sg(dd, 1)}`, "--bad"] : row.chg > 0 && last[1] >= hi[1] ? ["🔺", "최고가", "--good"] : ["↔", "멈춤", "--muted"];
  return { h, row, hi, last, dd, down, tr };
}
const drFix = () => {  // DDR5 고정거래가 = keychart.yaml 'ddr5-price' 카드 (산업부 월별)
  const c = (KEYC?.industry?.반도체?.cards || []).find((x) => x.id === "ddr5-price")?.charts?.[0], l = c?.lines?.find((x) => x.n === "고정거래가");
  return l ? [l.v.at(-1), c.q.at(-1)] : null;
};
function drHTML(code) {
  const s = drStat(DR);
  if (!s) return "";
  const sec = DR.secs, ds = sec.dram_spot, d4 = ds.rows.find((r) => r.n.startsWith("DDR4 16Gb (2Gx8) 3200")), c4 = sec.dram_contract?.rows?.find((r) => r.n === "DDR4 16Gb 2Gx8"), fx = drFix();
  const usd = (v) => "$" + n(v, v >= 100 ? 0 : 2), md = (dt) => `${+dt.slice(5, 7)}/${+dt.slice(8, 10)}`;
  const dates = s.h.map((x) => x[0]), ser = [{ n: "DDR5 16Gb", v: s.h.map((x) => x[1]), col: "var(--s1)" }];  // DDR5 하나만 — 여러 개를 한 눈금에 그리면 -2% 꺾임이 평평하게 보임 (DDR4 는 아래 표)
  const tbl = Object.values(sec).map((x) => `<tr><td colspan="4" style="text-align:left;background:var(--surface-2)"><b>${esc(x.t)}</b> <span class="src">${esc(x.date.slice(0, 10))}</span></td></tr>`
    + x.rows.map((r) => `<tr><td style="text-align:left">${esc(r.n)}</td><td>${usd(r.avg)}</td><td class="${kcol(r.chg)}">${r.chg == null ? "-" : sg(r.chg, 2)}</td><td class="src">${esc(r.mk || "")}</td></tr>`).join("")).join("");
  const gap = (a, b) => sg((a / b - 1) * 100, 0);
  const me = code ? `<div class="note">🔗 ${esc(DASH?.stocks?.find((c) => c.code === code)?.name || "")}는 D램을 <b>파는</b> 회사예요 → 값이 오르면 이익이 늘고, 꺾이면 몇 달 뒤 고정거래가·이익에 반영돼요.</div>` : "";
  return `<div class="card" style="margin-top:8px" data-jump="dram" data-jname="💾 D램 가격"><div class="chart-title"><b>💾 D램 현물 가격 (매일)</b> <span class="src">${esc(ds.date)} (대만 시각) · <b style="color:var(${s.tr[2]})">${s.tr[0]} ${s.tr[1]}</b></span></div>
    <div style="font-size:20px;margin:4px 0"><b>${usd(s.row.avg)}</b> <span class="src">DDR5 16Gb 칩 1개 · 세션 평균</span> <span class="${kcol(s.row.chg)}">${sg(s.row.chg, 2)}</span> <span class="src">지난 세션</span></div>
    <ul class="irl">
      <li>${s.dd < 0 ? "🔻" : "🔺"} 기록 중 고점 ${usd(s.hi[1])} (${md(s.hi[0])}) → 지금 ${usd(s.last[1])} = <b class="${kcol(s.dd)}">${sg(s.dd, 1)}</b>${s.down ? ` · 기록된 날 기준 <b>${s.down}번 연속 하락</b>` : ""}</li>
      ${fx ? `<li>⚖️ DDR5 현물 ${usd(s.row.avg)} vs 고정거래가 ${usd(fx[0])} (${esc(fx[1])}, 산업부) → 현물이 <b>${gap(s.row.avg, fx[0])}</b> 위 · 현물이 고정가 아래로 내려오면 보통 고정가도 꺾여요</li>` : ""}
      ${d4 && c4 ? `<li>🧓 DDR4 16Gb 현물 ${usd(d4.avg)} vs 고정거래가 ${usd(c4.avg)} (${esc(sec.dram_contract.date.slice(0, 7))}) → 현물이 ${gap(d4.avg, c4.avg)} 위</li>` : ""}
    </ul>
    ${lineChart({ t: "DDR5 16Gb 현물 (세션 평균, 달러) — 받은 날마다 쌓임", labels: dates, s: ser, fl: (v) => n(v, 2), tick: (i) => md(dates[i]) })}
    <details class="fvt"><summary class="chart-title">📋 트렌드포스 표 전체 (현물·고정거래가·모듈·GDDR)</summary><div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">제품</th><th>평균값</th><th>변화</th><th>만드는 곳</th></tr></thead><tbody>${tbl}</tbody></table></div></details>
    <div class="kidbox" style="margin-top:6px">🐣 컴퓨터·서버에 들어가는 메모리 칩 값이에요. 그날그날 시장에서 사고파는 값(현물)이 최근 조금씩 내렸어요. 큰 회사끼리 한 달 단위로 정하는 값(고정거래가)은 아직 오르는 중이라, 현물이 고정가 쪽으로 계속 내려오는지가 '꺾였나'를 가르는 신호예요.</div>
    <ul class="irl" style="margin-top:6px">
      <li>🔎 볼 것 ①: 현물이 며칠·몇 주 연속으로 내리는지 (하루 이틀 -1% 는 흔한 흔들림)</li>
      <li>🔎 볼 것 ②: 11월 고정거래가 (11월 말 발표) — 한 달 오름폭 +3~4% 가 0%·마이너스로 바뀌는지</li>
      <li>🔎 볼 것 ③: 트렌드포스 10월 고정가 글 요약 — 4분기에도 PC D램 값은 오르지만 오름폭이 줄어드는 중, 노트북 판매 약세·재고 증가가 협상을 빡빡하게 함</li></ul>${me}
    <div class="note src">출처: <a href="${esc(DR.u)}" target="_blank" rel="noopener">${esc(DR.src)}</a> · ${esc(DR.updated_at)} 받음 · ${esc(DR.seed || "")} · 꺾임 = 지난 세션 하락 + 기록 중 고점보다 1% 넘게 아래 (예측 아님) · 원화는 오늘 환율로 바꾼 대략</div></div>`;
}
// 종목 상세의 '자세한 내용 →' 링크: 산업 탭으로 가서 그 카드(id="kc-…")를 펼치고 스크롤
let KC_GO = null;
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-kc]");
  if (!a) return;
  KC_GO = a.dataset.kc;
  if (location.hash === "#industry") { e.preventDefault(); kcGo(); }
});
function kcGo() {
  const el = KC_GO && document.getElementById(`kc-${KC_GO}`);
  if (!el) return;
  KC_GO = null;
  el.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
function keyIndHTML() {
  const I = Object.entries(KEYC?.industry || {});
  return I.length ? `<h2>🔑 키팩터 · 키차트 <span class="src">업종마다 주가를 움직이는 숫자와 변곡점에서 볼 것 · 증권사 그림은 숫자로 다시 그림 · 매수·매도 추천 아님</span></h2>${I.map(([k, g]) => keyGroup(k, g)).join("")}` : "";
}
// ⚖️ 고정비 vs 변동비 (keychart.yaml cost): 산업 탭 업종 줄 + 종목 상세 한 칸 (재무제표 비율은 최근 4분기로 자동)
function costRow(code, ind) {
  const R = KEYC?.cost?.ind || [];
  return R.find((r) => (r.codes || []).includes(code)) || R.find((r) => (r.k || []).some((k) => (ind || "").includes(k)));
}
const costDots = (lv) => `고정비 ${"●".repeat(lv)}${"○".repeat(5 - lv)}`;
function costIndHTML() {
  const C = KEYC?.cost;
  if (!C?.ind?.length) return "";
  const who = (r) => [...new Set(DASH.stocks.filter((c) => costRow(c.code, c.industry) === r).map((c) => c.name))].join("·");
  return `<h2>⚖️ 고정비 vs 변동비 <span class="src">업종마다 '덜 팔아도 나가는 돈'이 얼마나 큰가 · 눌러서 보기 · 매수·매도 추천 아님</span></h2><div class="card">
    <ul class="irl" style="margin-top:0">${(C.why || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    ${C.kid ? `<div class="kidbox">🐣 ${esc(C.kid)}</div>` : ""}
    ${C.ind.map((r) => `<details style="border-top:1px solid var(--border);padding:6px 0;margin-top:6px"><summary><b>${esc(r.n)}</b> · ${esc(r.t)} <span class="src">${costDots(r.lv)}${who(r) ? ` · ${esc(who(r))}` : ""}</span></summary>
      <div style="font-size:13px;line-height:1.7;margin-top:4px">💸 큰 비용: ${esc(r.big)}<br>👉 ${esc(r.so)}</div></details>`).join("")}</div>`;
}
function costHTML(c, d) {
  const r = c && costRow(c.code, c.industry), s = c && KEYC?.cost?.stock?.[c.code];
  if (!r && !s) return "";
  const e4 = Object.entries(d.qtrs || {}).filter(([, q]) => q.rev && !q.prelim).slice(-4), q4 = e4.map(([, q]) => q);  // 잠정(매출·이익만) 분기는 빼고
  const sum = (k) => (q4.length === 4 && q4.every((q) => q[k] != null) ? q4.reduce((a, q) => a + Math.abs(q[k]), 0) : 0);
  const P = [["매출원가", "cogs"], ["영업비용", "opex"], ["연구개발", "rnd"], ["설비투자", "capex"]].map(([t, k]) => (sum(k) && sum("rev") ? `${t} ${n((sum(k) / sum("rev")) * 100, 0)}%` : "")).filter(Boolean);
  const so = r ? (s ? r.so.match(/볼 것:.*$/)?.[0] || "" : r.so) : "";  // 종목 줄이 있으면 업종 설명은 겹쳐서 '볼 것'만
  return `<div class="kidbox">⚖️ <b>비용 구조${r ? `: ${esc(r.t)}` : ""}</b>${r ? ` <span class="src">${esc(r.n)} · ${costDots(r.lv)}</span>` : ""}
    <div>${esc(s || r.big)}</div>${P.length ? `<div class="src">재무제표로 보면 (${qLabel(e4[0][0])}~${qLabel(e4[3][0])} 4분기 합계, 매출 대비): ${P.join(" · ")}</div>` : ""}${so ? `<div>👉 ${esc(so)}</div>` : ""}</div>`;
}
async function keyBlock(code) {
  const K = await keyLoad(), c = DASH.stocks.find((x) => x.code === code), ind = c?.industry || "";
  const gs = [...Object.entries(K.industry || {}).filter(([k, g]) => ind.includes(k) || (g.codes || []).includes(code)), ...(K.stock?.[code] ? [[c?.name || code, K.stock[code]]] : [])];
  return gs.length ? `<h3>🔑 키팩터 · 키차트 <span class="src">주가를 움직이는 숫자 · 변곡점 체크 (산업 탭에도 있어요)</span></h3>${gs.map(([k, g]) => keyGroup(k, g, code)).join("")}` : "";
}
// 🛡 방산 (config/defense.yaml): 지정학 연표(사실) + 글쓴이 가설 + 우리 방산 종목 숫자 (stocks.yaml industry 에 '방산')
let DEF = null;
function defenseHTML() {
  const D = DEF || {}, sec = D.sector || {};
  const cs = (DASH?.stocks || []).filter((c) => /방산/.test(c.industry || ""));
  if (!D.timeline && !cs.length) return "";
  const r3 = (c) => { const cl = (c.chart?.close || []).filter((v) => v != null); return cl.length > 64 ? (cl.at(-1) / cl.at(-64) - 1) * 100 : null; };
  const tl = (D.timeline || []).map((x, i) => `<div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px${x.q ? ";opacity:.75" : ""}">
      <span class="qtag${x.q ? "" : " bad"}" style="min-width:4.6em;text-align:center">${esc(x.d)}</span>
      <div><b>${x.q ? "❓" : "⚔️"} ${esc(x.n)}</b> <span class="src">${esc(x.w || "")}</span>${x.note ? `<div class="src">${esc(x.note)}</div>` : ""}</div></div>${i < D.timeline.length - 1 ? `<div class="src" style="margin-left:2.2em">↓</div>` : ""}`).join("");
  const rows = cs.map((c) => `<tr><td style="text-align:left"><a href="#stock/${esc(c.code)}">${esc(c.name)}</a> <span class="src">${esc(c.group || "")}</span></td>
      <td>${r3(c) == null ? "-" : pct(r3(c), 0, true)}</td><td>${c.tbl?.dd52 == null ? "-" : n(c.tbl.dd52, 0) + "%"}</td><td>${c.tbl?.per12 == null ? "-" : n(c.tbl.per12, 1) + "배"}</td><td>${c.band_pos == null ? "-" : n(c.band_pos, 0) + "%"}</td></tr>`).join("");
  return `<h2>🛡 방산 <span class="src">${esc(D.src || "")}</span></h2><div class="card">
    ${D.title ? `<b>🌏 ${esc(D.title)}</b> <span class="src">(일어난 순서)</span>${tl}` : ""}
    ${D.view ? `<div class="warnbox" style="margin-top:10px">💬 ${esc(D.view)}</div>` : ""}
    ${(D.facts || []).length ? `<ul class="irl">${D.facts.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    ${(D.memo || []).length ? `<div class="src" style="margin-top:4px">📝 전달받은 글의 메모 (사실 확인 전): ${D.memo.map(esc).join(" · ")}</div>` : ""}
    ${D.link ? `<div class="note">🔗 ${esc(D.link)}</div>` : ""}
    ${rows ? `<div class="tbl-wrap" style="margin-top:8px"><table class="compact"><thead><tr><th style="text-align:left">우리 방산 종목</th><th>3개월 주가</th><th>52주 고점 대비</th><th>PER 12MF</th><th>PER 10년 밴드</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
    ${sec.history ? `<div class="note src">📚 업종 PER: ${esc(sec.history)}<br>🔁 ${esc(sec.rerating || "")}</div>` : ""}
    <div class="note src">지정학 메모는 생각할 거리예요 (매수·매도 추천 아님) · 지도 그림 원본은 다올 퀀트 글에서</div></div>`;
}
const amzSum = (a) => (a || []).reduce((x, y) => x + y, 0);
function amzHTML() {
  const A = AMZ, ds = Object.keys(A.days).sort(), d = ds[ds.length - 1], p = ds[ds.length - 2];
  const cur = A.days[d].counts, prv = p ? A.days[p].counts : null;
  const brands = Object.keys(cur).sort((a, b) => amzSum(cur[b]) - amzSum(cur[a]));
  const cell = (v, pv, total) => {
    const df = prv ? v - (pv ?? 0) : 0;
    const arrow = df ? ` <span style="color:var(${df > 0 ? "--good-ink" : "--bad-ink"});font-weight:700">${df > 0 ? "▲" : "▼"}${Math.abs(df)}</span>` : "";
    return !v && !df && !total ? '<span class="src">–</span>' : `${total ? `<b>${v}</b>` : v}${arrow}`;
  };
  const tag = (b) => {
    const m = (A.brands || {})[b], c = m && DASH.stocks.find((x) => x.code === m.stock);
    return m ? ` <span class="src">${esc(m.company)}</span>${c ? `<span class="tag">${esc(c.group)}</span>` : ""}` : "";
  };
  const rows = brands.map((b) => {
    const v = cur[b], pv = prv?.[b] || [];
    const moved = prv && v.some((x, i) => x !== (pv[i] ?? 0));
    return `<tr${moved ? ' style="background:var(--na-bg)"' : ""}><td style="text-align:left">${esc(b)}${tag(b)}</td>${v.map((x, i) => `<td>${cell(x, pv[i])}</td>`).join("")}<td>${cell(amzSum(v), amzSum(pv), true)}</td></tr>`;
  }).join("");
  const colSum = (day, i) => Object.values(day || {}).reduce((s, a) => s + (a[i] || 0), 0);
  const tot = A.countries.map((_, i) => `<td>${cell(colSum(cur, i), prv ? colSum(prv, i) : null, true)}</td>`).join("");
  const all = (day) => A.countries.reduce((s, _, i) => s + colSum(day, i), 0);
  const fl = (c) => A.flags?.[A.countries.indexOf(c)] || "";
  const mv = (A.days[d].moves || []).map((m) => {
    const ic = m.out ? "❌" : m.new ? "🆕" : m.chg > 0 ? "⚡" : "⚠️";
    const what = m.out ? `#${m.rank} → 탈락` : m.new ? `#${m.rank} 새로 진입` : `#${m.rank} ${m.chg > 0 ? "▲" : "▼"}${Math.abs(m.chg)}`;
    return `<li>${ic} ${fl(m.c)} <b>${esc(m.b)}</b> ${m.u ? `<a href="${esc(m.u)}" target="_blank" rel="noopener">${esc(m.t)}</a>` : esc(m.t)} <span class="src">${esc(what)}</span></li>`;
  }).join("");
  const chips = ["", ...brands].map((b) => `<button data-b="${esc(b)}" class="chip ${b === AMZ_B ? "on" : ""}">${b ? esc(b) : "브랜드별 합계"}</button>`).join("");
  const how = A.days[d].how;
  return `<h3>💄 아마존 K-뷰티 Top100 품목 수 <span class="src">${esc(d)}${p ? ` · ▲▼ = ${esc(p.slice(5).replace("-", "/"))} 대비` : ""}</span></h3>
  <div class="card">
    ${how ? `<div class="${how.startsWith("추정") ? "warnbox" : "note src"}" style="margin:0 0 8px">표 출처: ${esc(how)}</div>` : ""}
    <div class="tbl-wrap"><table class="compact" style="width:100%;text-align:center"><thead><tr><th style="text-align:left">브랜드</th>${A.countries.map((c, i) => `<th>${A.flags?.[i] || ""} ${esc(c)}</th>`).join("")}<th>합계</th></tr></thead>
      <tbody>${rows}<tr style="border-top:2px solid var(--border)"><td style="text-align:left"><b>합계</b></td>${tot}<td>${cell(all(cur), prv ? all(prv) : null, true)}</td></tr></tbody></table></div>
    ${mv ? `<details style="margin-top:12px"><summary class="chart-title"><b>오늘 순위 변동 ${(A.days[d].moves || []).length}개</b> <span class="src">⚡ 크게 오름 · ⚠️ 크게 내림 · ❌ Top100 탈락 · 🆕 새로 진입 · 눌러서 보기</span></summary><ul class="irl">${mv}</ul></details>` : ""}
    <div class="chart-title" style="margin-top:12px"><b>추이</b> <span class="src">날마다 쌓여요 · 브랜드를 누르면 나라별</span></div>
    <div class="chips" id="amz-chips" style="margin:6px 0">${chips}</div>
    <div id="amz-leg"></div><div class="chart-box"><canvas id="amz-chart"></canvas></div>
    ${amzCross(A.days[d], cur)}
    <div class="note src">출처: ${esc(A.source || "")}${A.channels ? ` (${Object.entries({ daol: "다올", kyobo: "교보", kmj: "한투" }).map(([k, l]) => `<a href="${esc(A.channels[k])}" target="_blank" rel="noopener">${l}</a>`).join(" · ")})` : ""} · 상장사 연결: 메디큐브 = 에이피알, 달바 = 달바글로벌, COSRX = 아모레퍼시픽 자회사${ds.some((x) => A.days[x].derived) ? ` · ${ds.filter((x) => A.days[x].derived).map((x) => x.slice(5).replace("-", "/")).join(", ")}은 다음 날 표의 ▲▼로 거꾸로 계산` : ""}</div>
  </div>`;
}
// 세 채널(다올·교보·한투)은 같은 아마존 순위를 세는 거라 표는 위 하나만 (사용자 11/5 '3개 채널 동일한 거 1개만, 중복 빼고')
//   → 다른 채널과 몇 칸 다른지 한 줄 + 우리 종목 브랜드(메디큐브·달바) 제품별 순위만 접어서 (한투)
function amzCross(day, cur) {
  const K = day.kyobo, M = day.kmj, ci = AMZ.countries, IT = ci.indexOf("이탈리아");
  if (!K && !M) return "";
  let bad = 0, cmp = 0;
  const chk = (v, ref) => { if (v != null && ref != null) { cmp++; bad += v !== ref; } };
  const col = (i) => Object.values(cur).reduce((s, a) => s + (a[i] || 0), 0), all = ci.reduce((s, _, i) => s + col(i), 0);
  if (K) { ci.forEach((c, i) => chk(K.countries?.[c], col(i))); chk(K.total, all); }
  for (const b of new Set([...Object.keys(M?.brands || {}), ...Object.keys(K?.brands || {}).filter((x) => cur[x])])) {
    const v = cur[b] || ci.map(() => 0), m = M?.brands?.[b];
    if (m) { ci.forEach((c, i) => i !== IT && chk(m[c] || 0, v[i])); chk(amzSum(Object.values(m)), amzSum(v) - v[IT]); }
    if (K?.brands?.[b] != null) chk(K.brands[b], amzSum(v));
  }
  const R = M?.ranks || {}, ours = Object.keys(R).filter((b) => DASH.stocks.some((x) => x.code === AMZ.brands?.[b]?.stock));
  const rk = ours.map((b) => `<details style="margin-top:6px"><summary><b>${esc(b)}</b> 제품별 순위 <span class="src">${esc(AMZ.brands[b].company)} · 숫자 = 그 나라 Top100 순위 · 눌러서 보기</span></summary>
    <div class="tbl-wrap"><table class="compact" style="width:100%;text-align:center"><thead><tr><th style="text-align:left">제품</th>${ci.slice(0, IT).map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${Object.entries(R[b]).map(([p, r]) => `<tr><td style="text-align:left">${esc(p)}</td>${ci.slice(0, IT).map((c) => `<td>${r[c] ? (r[c] <= 10 ? `<b>${r[c]}</b>` : r[c]) : '<span class="src">–</span>'}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`).join("");
  return `<div class="note src" style="margin-top:10px">🔍 같은 날 ${[K && "교보", M && "한투"].filter(Boolean).join("·")} 숫자와 비교: ${bad ? `${cmp}칸 중 ${bad}칸이 조금 달라요 (채널마다 순위를 잰 시각이 달라서)` : `${cmp}칸 모두 같아요`}</div>${rk}`;
}
function drawAmz() {
  const C = themeColors(), A = AMZ, ds = Object.keys(A.days).sort(), last = A.days[ds[ds.length - 1]].counts;
  const cols = [C.s1, C.s2, C.s3, C.s4, C.s7, C.ink2, C.muted];
  const top = Object.keys(last).sort((a, b) => amzSum(last[b]) - amzSum(last[a])).slice(0, 7);
  const sets = AMZ_B
    ? A.countries.map((c, i) => ({ label: `${A.flags?.[i] || ""} ${c}`, data: ds.map((d) => A.days[d].counts[AMZ_B]?.[i] ?? 0) }))
    : top.map((b) => ({ label: b, data: ds.map((d) => amzSum(A.days[d].counts[b])) }));
  sets.forEach((s, i) => Object.assign(s, { borderColor: cols[i % cols.length], backgroundColor: cols[i % cols.length], pointRadius: 3 }));
  document.getElementById("amz-leg").innerHTML = legend(sets.map((s) => [s.label, s.borderColor]));
  makeChart(document.getElementById("amz-chart"), ds.map((d) => d.slice(5).replace("-", "/")), sets, { zero: true, fmt: (v) => v + "개", yfmt: (v) => v.toFixed(0) });
}
$("#industryBody").addEventListener("click", (e) => { const b = e.target.closest("#amz-chips button"); if (!b) return; AMZ_B = b.dataset.b; loadIndustry(); });

/* ---------- 📑 리포트 탭 (data/reports.json): 한국 = 한경 컨센서스 공개 목록, 미국 = 야후 증권사 의견 변경, 요약 = config/reports.yaml ---------- */
let REPS = null, REP_MKT = "KR", REP_GRP = "전체", REP_CODE = "";  // REP_CODE = '#reports/코드' 로 들어오면 그 종목만
const repGet = async () => { if (!REPS) REPS = await (await fetch("data/reports.json?t=" + Date.now(), { cache: "no-store" })).json(); return REPS; };
const tpTxt = (v, mkt) => (v == null ? "-" : mkt === "US" ? `$${n(v, 0)}` : `${n(v, 0)}원`);
/* ---------- 📈 이익 추정치 · 목표주가 방향 (stocks/{코드}.json est · dashboard 카드 est · reports.json) ----------
   증권사 컨센서스(한국 = 영업이익, 미국 = EPS)가 올라가는지 매일 쌓아 보고, 목표가를 올리는 곳·내리는 곳과 같이 본다.
   이익 추정이 올라가면 기대감·수급이 따라올 수 있어서 — 꺾이거나 돌아서는 '변곡점'을 놓치지 않으려고 (참고용, 추천 아님) */
const EST_ORD = { "🔄 상향 전환?": 0, "⚠ 꺾임?": 1, "📈 상향 중": 2, "📉 하향 중": 3, "➖ 그대로": 4 };
const estP = (p) => (p == null ? '<span class="src">-</span>' : (p = Math.abs(p) < 0.05 ? 0 : p, `<b style="color:var(${p > 0 ? "--good-ink" : p < 0 ? "--bad-ink" : "--ink-2"})">${p > 0 ? "▲" : p < 0 ? "▼" : ""}${n(Math.abs(p), 1)}%</b>`));  // -0.01% 를 '▼0.0%' 빨강으로 안 보이게
function tpCnt(code) {  // 최근 30일 목표가 올린 곳·내린 곳
  const cut = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), X = ((REPS?.stocks || []).find((x) => x.code === code)?.list || []).filter((x) => x.d >= cut && x.tp);
  return [X.filter((x) => (x.tp_prev && x.tp > x.tp_prev) || x.tp_dir === "상향").length, X.filter((x) => (x.tp_prev && x.tp < x.tp_prev) || x.tp_dir === "하향").length];
}
function estAlertHTML() {  // 첫 화면: 방향 개수 + 변곡점 종목만
  const L = (DASH?.stocks || []).filter((c) => c.est?.sig && mktOf(c.code) === MKT);
  if (!L.length) return "";
  const cnt = (s) => L.filter((c) => c.est.sig === s).length, turn = L.filter((c) => /전환|꺾임/.test(c.est.sig));
  return `<div class="card" style="margin-bottom:12px"><b>📈 이익 추정치 방향</b> <span class="src">증권사 예상 이익이 올라가면 기대감·수급이 따라올 수 있어요 · 매일 갱신 · 참고용</span>
    <div style="margin-top:4px">${Object.keys(EST_ORD).map((s) => `${s} <b>${cnt(s)}</b>`).join(" · ")}</div>
    ${turn.length ? `<ul class="irl">${turn.map((c) => `<li><a href="#stock/${esc(c.code)}">${esc(c.name)}</a> <b>${esc(c.est.sig)}</b> — ${esc(c.est.y)}년 ${esc(c.est.what)} 예상 1주 ${estP(c.est["1주"])} · 1개월 ${estP(c.est["1개월"])}</li>`).join("")}</ul>` : ""}</div>`;
}
/* ---------- 📐 주봉 차트 모양 (collector/patterns.py → stocks/{코드}.json pattern · 카드 pat) — 조건에 맞는 모양만 알려 줌, 매수·매도 판단 아님 ---------- */
const PAT = { cup: ["☕", "컵위드핸들"], hi: ["📐", "하락 추세선 돌파"], lo: ["📉", "추세 아래선 이탈"], brk: ["🚀", "전고점 돌파"], test: ["🧪", "전고점 지지 시험"], lost: ["⚠", "전고점 아래로"] };
const patLi = (s) => `${PAT[s.k]?.[0] || ""} <b>${esc(s.t)}</b> <span class="src">${esc(s.d)}</span>`;
function patAlertHTML(list = (DASH?.stocks || []).filter((c) => mktOf(c.code) === MKT && c.group === "보유")) {  // 보유 탭: 그 시장 보유 종목만 (사용자 11/6) · 관심·공동 탭: 그 묶음 종목 (종류별 개수 + 목록)
  const ord = Object.keys(PAT), L = list.filter((c) => c.pat?.length)
    .sort((a, b) => Math.min(...a.pat.map((s) => ord.indexOf(s.k))) - Math.min(...b.pat.map((s) => ord.indexOf(s.k))));  // 컵·추세선 돌파가 위로
  if (!L.length) return "";
  const cnt = Object.entries(PAT).map(([k, [i, t]]) => [i, t, L.filter((c) => c.pat.some((s) => s.k === k)).length]).filter(([, , x]) => x);
  return `<details class="card" style="margin-bottom:12px" open><summary><b>📐 주봉 차트 모양</b> <span class="src">${cnt.map(([i, t, x]) => `${i} ${t} <b>${x}</b>`).join(" · ")} · 주봉 종가 기준 · 줄을 누르면 차트가 열려요 · 참고용</span></summary>
    <ul class="irl" style="list-style:none;padding-left:2px">${L.map((c) => `<li><details class="patrow" data-code="${esc(c.code)}"><summary><a href="#stock/${esc(c.code)}">${esc(c.name)}</a> ${c.pat.map(patLi).join(" · ")} <span class="src">▾ 차트</span></summary><div class="cbox"></div></details></li>`).join("")}</ul></details>`;
}
document.addEventListener("toggle", (e) => {  // 📐 줄을 열 때 그 종목 주봉 차트를 받아 그림 (toggle 은 버블링이 안 돼서 capture)
  const el = e.target;
  if (!el.matches?.(".patrow") || !el.open || el.dataset.done) return;
  el.dataset.done = 1;
  const box = el.querySelector(".cbox");
  box.innerHTML = `<div class="src">불러오는 중…</div>`;
  fetch(`data/stocks/${el.dataset.code}.json?v=${encodeURIComponent(DASH.updated_at)}`).then((r) => r.json())
    .then((d) => { box.innerHTML = patSVG(d) + `<div class="src"><a href="#stock/${esc(el.dataset.code)}">상세 화면에서 '모양 읽는 법'까지 보기 →</a></div>`; })
    .catch(() => { box.innerHTML = `<div class="src">차트를 못 불러왔어요 — <a href="#stock/${esc(el.dataset.code)}">상세 화면</a>에서 봐 주세요</div>`; });
}, true);
function patSVG(d) {  // 최근 3년 주봉 종가 + 추세선·전고점·손잡이 고점 선 (상세 화면·첫 화면 목록 같이 씀)
  const p = d.pattern;
  if (!p?.w?.length) return "";
  const ws = p.w, W = 340, x0 = 6, x1 = W - 52, top = 10, bot = 146, t0 = +new Date(ws[0][0]), t1 = +new Date(ws.at(-1)[0]);
  const vs = [...ws.map((x) => x[1]), ...p.levels.map((l) => l.v)], lo = Math.min(...vs) * 0.97, hi = Math.max(...vs) * 1.03;
  const X = (dt) => x0 + ((x1 - x0) * (+new Date(dt) - t0)) / (t1 - t0 || 1), Y = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top);
  const F = (v) => (d.currency === "USD" ? `$${n(v, 2)}` : n(v, 0));
  let g = "";
  ws.forEach(([dt], i) => { if (i && dt.slice(0, 4) !== ws[i - 1][0].slice(0, 4)) g += `<line x1="${X(dt)}" x2="${X(dt)}" y1="${top}" y2="${bot}" stroke="var(--grid)"/><text x="${X(dt) + 2}" y="${bot + 14}" class="qx">'${dt.slice(2, 4)}</text>`; });
  g += `<polyline points="${ws.map(([dt, v]) => `${X(dt)},${Y(v)}`).join(" ")}" fill="none" stroke="var(--ink-2)" stroke-width="1.6"/>`;
  p.levels.forEach((l) => { g += `<line x1="${x0}" x2="${x1}" y1="${Y(l.v)}" y2="${Y(l.v)}" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="5 3"/><text x="${x1 + 3}" y="${Y(l.v) + 4}" class="qv b" style="font-size:10px">${esc(F(l.v))}</text>`; });
  p.lines.forEach((l) => { g += `<polyline points="${l.p.map(([dt, v]) => `${X(dt)},${Y(v)}`).join(" ")}" fill="none" stroke="${l.k === "cup" ? "var(--good)" : "var(--s2)"}" stroke-width="2.2"${l.k === "lo" ? ' stroke-dasharray="6 3"' : ""}/>`; });
  const last = ws.at(-1);
  g += `<circle cx="${X(last[0])}" cy="${Y(last[1])}" r="3.5" fill="var(--ink)"/><text x="${x1 + 3}" y="${Math.min(bot, Math.max(top + 8, Y(last[1]) + 16))}" class="qv" style="font-size:10px">${esc(F(last[1]))}</text>`;
  return `<svg viewBox="0 0 ${W} 166" role="img" aria-label="최근 3년 주봉 종가와 추세선">${g}</svg>
    <div class="src" style="padding:0 4px 4px">── 주봉 종가 · <span style="color:var(--s2)">━</span> 고점끼리 이은 하락 추세선 · <span style="color:var(--s2)">┅</span> 저점끼리 이은 선 · <span style="color:var(--warn)">┅</span> 전고점·손잡이 고점 · <span style="color:var(--good)">━</span> 컵 모양</div>`;
}
// 📉 고점 대비 낙폭: 지금 vs 과거 큰 하락 사이클 (사용자 11/7 삼성전자 그림처럼, SK하이닉스도) — data/cycle_dd.json ← collector/cycle_dd.py (갱신 때마다)
// x = 고점 뒤 몇 개월 · y = 고점 대비 % · 빨강 굵은 선 = 지금 · 점 = 각 사이클 바닥 · 종목 상세(주봉 모양 위) + 🏭 산업 탭 반도체
let CYC = null;
const CYC_COL = ["#a3a3a3", "#c9a27a", "#9cb8d8", "#5b8fd1", "#2a9d8f", "#b39ddb", "#e0a458", "#7fb8a8"];
const CYC_NOTE = {  // 전달받은 시각 (닫힘) — 사용자 11/7
  "005930": ["최악이면 '진짜 바닥'은 10만원 중후반으로 봄 — 28년 이익 60% 넘게 역성장 + PBR 0.9배를 가정", "컨센서스를 안 믿고 28년을 보수적으로 잡아도 PBR 은 1배 수준", "지금 50% 넘는 고점 대비 낙폭은 닷컴버블 수준 — 'AI 버블'이 이미 터진 걸 가정한 주가·밸류라는 시각 (연쇄 청산이 나면 더 빠질 수도)", "내년 배당수익률이 10% 가까울 수 있다고 봄"],
};
function cycHTML(code, open = false) {
  const S = CYC?.stocks?.[code];
  if (!S?.cycles?.length) return "";
  const cur = S.cycles.find((x) => x.now), past = S.cycles.filter((x) => !x.now), L = S.last;
  const all = S.cycles.flatMap((x) => x.pts.map((p) => p[1])), lo = Math.max(-95, Math.floor(Math.min(-60, ...all) / 10) * 10), hi = 30;
  const W = 640, x0 = 44, x1 = 600, top = 12, bot = 250, X = (m) => x0 + ((x1 - x0) * Math.min(m, 30)) / 30, Y = (v) => bot - ((Math.min(v, hi) - lo) / (hi - lo)) * (bot - top);
  const lab = (x) => `${x.peak_d.slice(0, 4)}.${+x.peak_d.slice(5, 7)}`, wonK = (v) => (v >= 10000 ? `${n(v / 10000, 2)}만원` : `${n(v, 0)}원`);
  let g = "";
  for (let v = lo; v <= hi; v += 20) g += `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? "var(--ink-2)" : "var(--grid)"}"/><text x="${x0 - 4}" y="${Y(v) + 4}" text-anchor="end" class="qx">${v > 0 ? "+" : ""}${v}%</text>`;
  for (let m = 0; m <= 30; m += 5) g += `<text x="${X(m)}" y="${bot + 16}" text-anchor="middle" class="qx">${m}</text>`;
  const path = (pts) => pts.map(([m, v], j) => `${j ? "L" : "M"}${X(m).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  past.forEach((x, i) => { const col = CYC_COL[i % CYC_COL.length], t = [x.trough_m, x.trough];  // 바닥 점 = 일봉 바닥 (주 1점 그림보다 정확)
    g += `<path d="${path(x.pts)}" fill="none" stroke="${col}" stroke-width="1.8"/><circle cx="${X(t[0])}" cy="${Y(t[1])}" r="3" fill="${col}"/><text x="${X(t[0])}" y="${Y(t[1]) + 13}" text-anchor="middle" class="qx" style="fill:${col}">${n(t[1], 0)}%</text>`; });
  if (cur) { const e = cur.pts.at(-1);
    g += `<path d="${path(cur.pts)}" fill="none" stroke="var(--bad)" stroke-width="3.5"/><circle cx="${X(e[0])}" cy="${Y(e[1])}" r="5" fill="var(--bad)"/>`
      + `<text x="${X(e[0]) + 8}" y="${Y(e[1]) + 4}" class="qv b" style="fill:var(--bad)">${n(e[1], 1)}% (${wonK(L.px)})</text>`; }
  g += `<text x="${(x0 + x1) / 2}" y="${bot + 30}" text-anchor="middle" class="qx">고점 뒤 몇 개월</text>`;
  // 같은 시점 과거 낙폭 · 과거 바닥 → 이번 고점 기준 가격
  const at = (x, m) => { const p = x.pts.reduce((a, q) => (Math.abs(q[0] - m) < Math.abs(a[0] - m) ? q : a)); return Math.abs(p[0] - m) <= 0.6 ? p[1] : null; };
  const tr = past.map((x) => x.trough).sort((a, b) => a - b), med = tr[tr.length >> 1], deeper = past.filter((x) => x.trough < (L.dd ?? 0));
  const px = (dd) => wonK(cur.peak * (1 + dd / 100));
  const lines = cur ? [
    `지금: <b>${lab(cur)} 고점 ${wonK(cur.peak)}</b> → ${esc(L.d.slice(5).replace("-", "/"))} ${wonK(L.px)} = <b style="color:var(--bad-ink)">${n(L.dd, 1)}%</b> · 고점 뒤 ${n(L.m, 1)}개월`,
    `같은 ${n(L.m, 1)}개월 시점 과거 낙폭: ${past.map((x) => [lab(x), at(x, L.m)]).filter(([, v]) => v != null).map(([l, v]) => `${l} ${n(v, 0)}%`).join(" · ")}`,
    `지난 사이클 바닥: ${n(tr[0], 0)}% ~ ${n(tr.at(-1), 0)}% (가운데 ${n(med, 0)}%) → 이번 고점에 대 보면 <b>${px(tr[0])} ~ ${px(tr.at(-1))}</b> (가운데 ${px(med)}) — 참고용 계산, 예측 아님`,
    deeper.length ? `지금 낙폭보다 깊었던 사이클: ${deeper.map((x) => `${lab(x)} ${esc(x.label)} ${n(x.trough, 0)}%`).join(" · ")} — 나머지 ${past.length - deeper.length}개보다는 이미 깊음` : `지금 낙폭이 지난 ${past.length}개 사이클 바닥보다 모두 깊음`,
  ] : [];
  const leg = [...past.map((x, i) => `<span style="display:inline-block;width:16px;height:0;border-top:3px solid ${CYC_COL[i % CYC_COL.length]};vertical-align:middle;margin-right:4px"></span>${lab(x)} 고점 (${esc(x.label)}) 바닥 ${n(x.trough, 0)}% · ${n(x.trough_m, 1)}개월 뒤${x.back_m != null ? ` · 고점 되찾는 데 ${n(x.back_m, 0)}개월` : ""}`),
    ...(cur ? [`<span style="display:inline-block;width:16px;height:0;border-top:4px solid var(--bad);vertical-align:middle;margin-right:4px"></span><b>${lab(cur)} 고점 (지금, ${esc(cur.label)})</b>`] : [])];
  const note = CYC_NOTE[code];
  return `<details class="fvt"${open ? " open" : ""}><summary class="chart-title"><b>📉 ${esc(S.name)} 고점 대비 낙폭: 지금 vs 과거 하락 사이클</b> <span class="src">${cur ? `지금 ${n(L.dd, 1)}% · 고점 뒤 ${n(L.m, 1)}개월 · ` : ""}매일 자동 · 눌러서 열기</span></summary>
    <svg viewBox="0 0 ${W} ${bot + 36}" role="img" aria-label="${esc(S.name)} 고점 대비 낙폭">${g}</svg>
    <div class="src" style="line-height:1.7">${leg.join("<br>")}</div>
    <ul class="irl" style="margin-top:6px">${lines.map((x) => `<li>${x}</li>`).join("")}</ul>
    <div class="kidbox" style="margin-top:6px">🐣 고점을 0%로 놓고, 고점 뒤 몇 달 동안 얼마나 빠졌는지를 사이클마다 겹쳐 그린 거예요. 빨간 굵은 선(지금)이 과거 선들 중 어디쯤 있는지 보면 '이번 하락이 얼마나 깊고 빠른지'를 비교할 수 있어요. 과거에 여기서 멈췄다고 이번에도 멈춘다는 뜻은 아니에요.</div>
    ${note ? `<details class="fvt"><summary class="chart-title">📌 전달받은 시각 (11/7) <span class="src">그 글의 생각 · 추천 아님 · 눌러서 보기</span></summary><ul class="irl">${note.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}
    <div class="note src">고점 = 앞 1년 중 가장 높은 종가이면서 그 뒤 30개월 안에 33% 넘게 빠진 자리 · 바닥 = 고점 뒤 30개월 안 가장 낮은 종가 · 일봉 종가(장중 저가 아님) · ${esc(CYC.src || "")} · ${esc(CYC.updated_at || "")}</div></details>`;
}
function patHTML(d) {  // 종목 상세: 차트 + 조건 설명
  const p = d.pattern;
  if (!p?.w?.length) return "";
  const sig = p.sig.length ? `<ul class="irl">${p.sig.map((s) => `<li>${patLi(s)}</li>`).join("")}</ul>` : `<div class="note src" style="margin-top:0">지금은 조건에 맞는 모양이 없어요</div>`;
  return `<details${p.sig.length ? " open" : ""}><summary><h3 style="display:inline">📐 주봉 차트 모양 <span class="src">${esc(p.asof)} 주 종가까지 · ${p.sig.length ? p.sig.map((s) => esc(s.t)).join(" · ") : "해당 없음"}</span></h3></summary><div class="card">${sig}
    ${patSVG(d)}
    <div class="kidbox" style="margin-top:6px">👀 <b>모양 읽는 법</b><ul class="irl">
      <li>☕ <b>컵위드핸들</b> (윌리엄 오닐): 크게 오른 뒤 12~40% 쉬며 U자 컵을 만들고, 손잡이처럼 3~15% 살짝 눌렸다가 손잡이 고점을 넘는 모양</li>
      <li>📐 <b>하락 추세선</b>: 점점 낮아지는 고점끼리 이은 선 — 위로 뚫으면 내림세가 끝나 가는지 보는 자리 · 저점끼리 이은 선 아래로 깨지면 내림이 빨라질 수 있는 자리</li>
      <li>🚀 <b>전고점 돌파</b>: 13주 넘게 못 넘던 큰 고점을 주봉 종가로 넘음 · 🧪 <b>지지 시험</b>: 넘었던 전고점까지 다시 내려옴 — 예전에 막던 가격이 이제 받쳐 주는지 보는 자리</li>
    </ul></div>
    <div class="note src">주봉 종가로만 계산해요 (장중 꼬리는 안 봄) · 모양이 맞아도 실패가 많아요 · 매수·매도 추천이 아니에요</div></div></details>`;
}
function estHTML(d) {  // 종목 상세: 연도별 추정치 지금 vs 1일·1주·1개월·3개월·6개월·1년 전 + 흐름 그림 + 다른 출처(블룸버그 등)
  const e = d.est, sd = e?.seed, tw = (TGR?.stocks?.[d.code] || []).filter((x) => x.est_w != null).slice(0, 8);
  const rv = revHTML(d.code);
  if (!e && !sd && !tw.length && !rv) return "";
  const us = e?.unit === "$", F = (v) => (v == null ? "-" : us ? `$${n(v, 2)}` : kpiF(v, "억원")), SP = ["1일", "1주", "1개월", "3개월", "6개월", "1년"];
  const ys = Object.keys(e?.chg || {}).sort(), b = DASH.stocks.find((x) => x.code === d.code)?.est, [tu, td] = tpCnt(d.code);
  let h = b?.sig ? `<div class="note" style="margin-top:0"><b>${esc(b.sig)}</b> — ${esc(b.y)}년 ${esc(b.what)} 예상 1주 ${estP(b["1주"])} · 1개월 ${estP(b["1개월"])} · 3개월 ${estP(b["3개월"])}${tu || td ? ` · 목표가 최근 30일 <b style="color:var(--good-ink)">올림 ${tu}</b> · <b style="color:var(--bad-ink)">내림 ${td}</b>` : ""}</div>` : "";
  if (ys.length) h += `<div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">${esc(e.what)} 예상</th><th>지금</th>${SP.map((s) => `<th>${s} 전</th>`).join("")}</tr></thead><tbody>
    ${ys.map((y) => `<tr><td style="text-align:left">${esc(y)}E</td><td><b>${F(e.chg[y].now)}</b></td>${SP.map((s) => { const a = e.chg[y].ago[s]; return `<td title="${a ? esc(F(a[0])) : ""}">${a ? estP(a[1]) : '<span class="src">-</span>'}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`;
  const ds = [...new Set(ys.flatMap((y) => (e.pts[y] || []).map((p) => p[0])))].sort();
  if (ds.length >= 3) {
    const at = Object.fromEntries(ys.map((y) => [y, Object.fromEntries(e.pts[y])]));
    h += `<div class="qgrid" style="margin-top:8px">${lineChart({ t: `${e.what} 예상 흐름 (${e.since}부터${e.daily > e.since ? ` · ${e.daily} 전은 달마다, 그 뒤 매일` : " 매일"})`, labels: ds, s: ys.map((y, i) => ({ n: `${y}E`, v: ds.map((x) => at[y][x] ?? null), col: KPI_COL[i % 4] })), fl: (v) => (us ? `$${n(v, 2)}` : kpiF(Math.round(v), "억원")), tick: (i) => (i === 0 || i === ds.length - 1 ? ds[i].slice(ds[0].slice(0, 4) === ds.at(-1).slice(0, 4) ? 5 : 2) : "") })}</div>`;
  }
  h += rv;
  if (tw.length) h += `<div class="note">📨 <b>텔레그램 ked_epic_ai 퀀트 시그널</b> — 12M Fwd 영업이익 추정치 <b>1주 변화</b> (시장 전체 상·하위 10위에 들 때만 나와요): ${tw.map((x) => `<a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.d.slice(5).replace("-", "/"))}</a> ${estP(x.est_w)}`).join(" · ")}</div>`;
  if (sd) {  // 사용자가 보낸 다른 출처 (config/est_seed.yaml)
    const cols = Object.keys(Object.values(sd.rows)[0] || {}).filter((k) => k !== "지금");
    h += `<div class="chart-title" style="margin-top:10px"><b>📎 ${esc(sd.src || "")}</b> <span class="src">${esc(sd.what)} 예상 · ${esc(sd.unit)}${sd.vs ? ` · ${esc(sd.vs.d)} 대비 ${Object.keys(sd.rows).map((y) => (sd.vs[y] ? `${y}E ${n(sd.vs[y], 1)} → ${n(sd.rows[y]["지금"], 1)} (${pct((sd.rows[y]["지금"] / sd.vs[y] - 1) * 100, 1, true)})` : "")).filter(Boolean).join(" · ")}` : ""}</span></div>
      <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">연도</th><th>지금</th>${cols.map((c) => `<th>${esc(c)} 전</th>`).join("")}</tr></thead><tbody>
      ${Object.entries(sd.rows).map(([y, r]) => `<tr><td style="text-align:left">${esc(y)}E</td><td><b>${n(r["지금"], 1)}</b></td>${cols.map((c) => `<td title="${n(r[c], 1)}">${estP(r[c] ? (r["지금"] / r[c] - 1) * 100 : null)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  return `<h3>📈 이익 추정치 변화 <span class="src">${us ? "야후 EPS 컨센서스" : "와이즈리포트 영업이익 컨센서스"} · 매일 갱신 · 칸에 마우스를 올리면 그때 값</span></h3><div class="card">${h}</div>`;
}
/* ---------- 📑 리포트 한 줄 = 목표가 먼저 (사용자 11/6) ----------
   한경 목록 + 텔레그램 채널에 온 리포트 + 사용자 전달 요약(reports.yaml) + 한 장 요약(data/rep_digest.json ← config/rep_digest.yaml, PC 예약 작업이 매시간)
   을 '같은 증권사·같은 날(±1일)'로 묶음. 최신 날짜 먼저, 같은 날이면 목표가 올린 리포트를 맨 위 (약세장이라 상향을 먼저 — 사용자 11/6).
   줄을 누르면: 근거(무엇 × 몇 배) · 이익 추정 상향·하향 · 실적 vs 컨센서스 · 어조 · 일정(확정/예상/가정) · 캐파 · 주주환원 · 리스크 · 🚨 임원 매도·증여 */
let DG = null;
const dgGet = async () => { if (!DG) { try { DG = await (await fetch("data/rep_digest.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { DG = { stocks: {} }; } } return DG; };
const GRP_ORD = { 보유: 0, 공동: 1, 관심: 2 }, DIR_ORD = { 상향: 0, 신규: 1, 유지: 2, 하향: 4 };
const cleanT = (t) => (t || "").replace(/^[^)]*\([0-9A-Z]{6}\)\s*/, "");
const rateH = (x) => (x.rating_prev ? `<span class="src">${esc(x.rating_prev)} →</span> <b style="color:var(--warn-ink)">${esc(x.rating)}</b>` : esc(x.act ? `${x.act} · ${x.rating || ""}` : x.rating || ""));
function repMerge(code, r) {
  const rows = [], gap = (a, b) => Math.abs(new Date(a) - new Date(b)) / 864e5;
  const find = (d, firm, tp) => rows.find((y) => fKey(y.firm) === fKey(firm) && gap(y.d, d) <= 1 && (!tp || !y.tp || y.tp === tp));
  for (const x of r?.list || []) rows.push({ ...x, links: [] });
  for (const x of TGR?.stocks?.[code] || []) {  // 텔레그램: 증권사 이름이 있는 리포트 글만 (퀀트 순위·주간 리비전·리포트 종합 글은 빼고)
    if (!x.firm || x.est_w != null || x.rev || x.sum) continue;
    const y = find(x.d, x.firm, x.tp);
    if (y) { y.links.push(x); y.tp ??= x.tp; y.tp_prev ??= x.tp_prev; y.tp_dir ||= x.dir; }
    else rows.push({ d: x.d, hm: x.hm, firm: x.firm, t: x.t, tp: x.tp, tp_prev: x.tp_prev, tp_dir: x.dir, links: [x] });
  }
  for (const m of r?.notes || []) { const y = find(m.d, m.firm); if (y) y.note = m; else rows.push({ d: m.d, firm: m.firm, t: m.t, tp: m.tp, tp_prev: m.tp_prev, rating: m.rating, note: m, links: [] }); }
  for (const g of DG?.stocks?.[code]?.reps || []) {
    const same = g.idx && rows.find((z) => z.u?.endsWith("=" + g.idx)), y = same || find(g.d, g.firm, g.tp);
    if (same && g.tp) { y.tp = g.tp; y.tp_prev = g.tp_prev ?? y.tp_prev; }  // 같은 PDF 면 본문에서 읽은 목표가가 맞음 (한경 목록 숫자가 틀린 때: 기아 유안타 29,000 → 129,000)
    if (y) { y.dg = g; y.tp ??= g.tp; y.tp_prev ??= g.tp_prev; y.who ||= g.who; y.tp_dir ||= g.dir; y.tu ||= g.u; }
    else rows.push({ d: g.d, firm: g.firm, who: g.who, t: g.t, tp: g.tp, tp_prev: g.tp_prev, tp_dir: g.dir, rating: g.rating, dg: g, tu: g.u, links: [] });
  }
  const last = {};  // 이전 목표가가 빈 줄(한경 목록에 많음)은 같은 증권사 바로 전 리포트 목표가로 채움
  [...rows].sort((a, b) => a.d.localeCompare(b.d)).forEach((x) => { const k = fKey(x.firm); if (x.tp && !x.tp_prev && !x.tp_dir && last[k]) x.tp_prev = last[k]; if (x.tp) last[k] = x.tp; });
  // 방향: 목표가 비교 → 채널이 적은 방향 → 미국 의견 변경(신규 = 커버리지 시작, 상향·하향 = 의견 올림·내림) → 제목에 '커버리지 개시'
  rows.forEach((x) => { x.dir = x.tp && x.tp_prev ? (x.tp > x.tp_prev ? "상향" : x.tp < x.tp_prev ? "하향" : "유지") : x.tp_dir || { 신규: "신규", 상향: "상향", 하향: "하향", 유지: "유지", 재확인: "유지" }[x.act] || (/커버리지\s*개시|신규\s*커버|Initiat/i.test(x.t || "") ? "신규" : ""); });
  return rows.sort((a, b) => b.d.localeCompare(a.d) || (DIR_ORD[a.dir] ?? 3) - (DIR_ORD[b.dir] ?? 3) || (b.hm || "").localeCompare(a.hm || ""));
}
const CONS_ICO = { 서프라이즈: "🎉", 상회: "👍", 부합: "➖", 하회: "👎", 쇼크: "💥" }, KIND_CLS = { 확정: "", 예상: "warn", 가정: "bad" };
function repRow(x, mkt) {
  const g = x.dg || {}, nt = x.note || {}, val = g.val || nt.val || x.val, pts = g.pts || nt.why || [], has = !!(g.pts || g.val || nt.why);
  const pc = x.tp && x.tp_prev && x.tp !== x.tp_prev ? (x.tp / x.tp_prev - 1) * 100 : null, col = (d) => (d === "상향" ? "--good-ink" : d === "하향" ? "--bad-ink" : "--ink-2");
  const tpH = x.tp ? `🎯 ${pc != null ? `<span class="src">${tpTxt(x.tp_prev, mkt)} →</span> ` : ""}<b>${tpTxt(x.tp, mkt)}</b>${x.dir ? ` <b style="color:var(${col(x.dir)})">${x.dir === "상향" ? "▲" : x.dir === "하향" ? "▼" : ""}${pc != null ? n(Math.abs(pc), 0) + "% " : ""}${esc(x.dir)}</b>` : ""}` : "";
  const cons = Object.keys(CONS_ICO).find((k) => (g.cons_tag || "").includes(k));
  const tags = [val ? `📐 ${esc(val)}` : "", g.est_dir ? `<b style="color:var(${col(g.est_dir)})">${g.est_dir === "상향" ? "📈" : g.est_dir === "하향" ? "📉" : "➖"} 이익 추정 ${esc(g.est_dir)}</b>` : "",
    cons ? `${CONS_ICO[cons]} 실적 ${esc(g.cons_tag)}` : "", (g.insider || []).length ? `<b style="color:var(--bad-ink)">🚨 임원·대주주</b>` : "", g.tone ? `💬 ${esc(g.tone)}` : ""].filter(Boolean);
  const li = (L) => ((L || []).length ? `<ul class="irl">${L.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "");
  const sec = (h, body) => (body ? `<div style="margin-top:6px"><b>${h}</b>${body}</div>` : "");
  const sched = (g.sched || []).length ? `<ul class="irl">${g.sched.map((s) => `<li><span class="qtag ${KIND_CLS[s.kind] ?? "warn"}">${esc(s.kind || "?")}</span> <b>${esc(s.when || "")}</b> ${esc(s.what || "")}</li>`).join("")}</ul>` : "";
  const links = [x.u ? `<a href="${esc(x.u)}" target="_blank" rel="noopener">📄 원문 PDF</a>` : "", ...(x.links || []).map((y) => `<a href="${esc(y.u)}" target="_blank" rel="noopener">${tgLab(y)}</a>`),
    x.tu ? `<a href="${esc(x.tu)}" target="_blank" rel="noopener">🔗 텔레그램 글</a>` : "", nt.u && nt.u !== x.u ? `<a href="${esc(nt.u)}" target="_blank" rel="noopener">원문</a>` : ""].filter(Boolean);
  const body = has ? [sec("📐 목표가 근거", val ? ` ${esc(val)}${g.val_why ? `<div class="src">${esc(g.val_why)}</div>` : ""}` : ""), sec("📊 이익 추정", g.est || nt.eps ? ` ${esc(g.est || nt.eps)}` : ""),
    sec("🧾 실적 vs 컨센서스", g.cons ? ` ${esc(g.cons)}` : ""), sec("💬 어조", g.tone ? ` <b>${esc(g.tone)}</b>${g.tone_why ? ` — ${esc(g.tone_why)}` : ""}` : ""),
    sec("📅 일정·촉매", sched), sec("🏭 캐파·증설", li(g.capa)), sec("💰 주주환원", li(g.ret)), sec('<span style="color:var(--warn-ink)">⚠ 리스크</span>', li(g.risk)),
    (g.insider || []).length ? `<div class="note" style="background:var(--bad-bg)"><b style="color:var(--bad-ink)">🚨 임원·대표·대주주 매도·증여</b>${li(g.insider)}</div>` : "", sec("✦ 핵심", li(pts))].join("")
    : `<div class="src">요약은 아직 없어요 — 이 컴퓨터 예약 작업이 매시간 새 리포트를 요약해요${x.u || x.links?.length ? " · 지금은 원문에서 확인" : ""}</div>`;
  const edge = x.dir === "상향" ? "var(--good)" : x.dir === "하향" ? "var(--bad)" : "transparent";
  return `<details class="rpd" style="border-left:3px solid ${edge};padding-left:6px"><summary><span class="src">${mdDay(x.d)}</span> <b>${IB_FIRM.test(x.firm || "") && mkt !== "US" ? "🌍 " : ""}${esc(x.firm || "")}</b>${x.who || g.who ? ` <span class="src">${esc(x.who || g.who)}</span>` : ""} ${tpH}${x.rating ? ` · <span class="src">${rateH(x)}</span>` : ""}${has ? " ✍️" : ""}
    ${tags.length ? `<div class="rpt" style="font-size:13px">${tags.join(" · ")}</div>` : ""}${(x.t || g.t) && !/상향\/하향 보고서/.test(x.t || "") ? `<div class="src rpt">${esc(cleanT(g.t || x.t))}</div>` : ""}</summary><div class="rpb">${body}${links.length ? `<div class="src" style="margin-top:6px">${links.join(" · ")}</div>` : ""}</div></details>`;
}
function repRowsHTML(code, r, max = 8, more = true) {
  const mkt = r?.market || mktOf(code), L = repMerge(code, r);
  if (!L.length) return `<div class="src">최근 7개월 리포트 없음</div>`;
  if (more) max = Math.min(15, Math.max(max, L.filter((x) => x.d >= kstDay(6)).length));  // 최근 7일 것은 다 펼쳐 둠 (실적 날 10곳 넘게 나와도)
  const rest = L.slice(max);
  return L.slice(0, max).map((x) => repRow(x, mkt)).join("") + (rest.length && more ? `<details style="margin-top:4px"><summary class="src">이전 리포트 ${rest.length}개 더 (최근 7개월)</summary>${rest.map((x) => repRow(x, mkt)).join("")}</details>` : "");
}
// 🧵 종목별 흐름 (요약의 flow — 최신 순으로 이어 쓴 타임라인)
const repFlowHTML = (code) => { const f = DG?.stocks?.[code]; return f?.flow ? `<div class="note" style="margin-top:6px">🧵 <b>흐름</b> <span class="src">최신 → 예전 · ${esc(f.flow_d || "")}</span><div>${esc(f.flow)}</div></div>` : ""; };
// 🧭 증권사별 6개월: 목표가가 어떻게 바뀌어 왔나 (같은 값이 이어지면 한 칸) + 어조 변화 (요약이 있는 리포트만)
function repFirmHTML(code, r) {
  const mkt = r?.market || mktOf(code), cut = kstDay(183), by = new Map();
  for (const x of repMerge(code, r).filter((x) => x.d >= cut && x.tp).reverse()) { const k = fKey(x.firm); if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  if (!by.size) return "";
  const rows = [...by.values()].sort((a, b) => b.at(-1).d.localeCompare(a.at(-1).d)).map((L) => {
    const seg = [];
    for (const x of L) { const p = seg.at(-1); if (p && p.tp === x.tp) p.d2 = x.d; else seg.push({ tp: x.tp, d: x.d, up: p ? x.tp > p.tp : null }); }
    const path = seg.map((s) => `${s.up == null ? "" : `<b style="color:var(${s.up ? "--good-ink" : "--bad-ink"})">${s.up ? "▲" : "▼"}</b>`}${tpTxt(s.tp, mkt)} <span class="src">(${mdDay(s.d)}${s.d2 ? "~" + mdDay(s.d2) : ""})</span>`).join(" → ");
    const tones = L.map((x) => x.dg?.tone).filter(Boolean).reduce((m, t) => (m.at(-1) === t ? m : [...m, t]), []);
    const who = [...new Set(L.flatMap((x) => (x.who || x.dg?.who || "").split(/[,·]/)).map((s) => s.trim()).filter(Boolean))].join(", ");
    return `<tr><td style="text-align:left;white-space:nowrap"><b>${esc(L.at(-1).firm)}</b>${who ? `<div class="src">${esc(who)}</div>` : ""}</td><td style="text-align:left;white-space:normal;min-width:12em">${path}${tones.length ? `<div>💬 ${esc(tones.join(" → "))}</div>` : ""}</td></tr>`;
  }).join("");
  return `<details style="margin-top:8px"><summary><b>🧭 증권사별 6개월 목표가·어조</b> <span class="src">${by.size}곳 · 같은 값이 이어지면 한 칸 · 💬 어조는 요약이 있는 리포트만</span></summary>
    <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">증권사·애널리스트</th><th style="text-align:left">목표가 (예전 → 최신) · 어조</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
// 최근 7개월 목표가 올린 곳·내린 곳 (30일 안 개수 따로) + 증권사별 최신 목표가 평균 — 한경 목록 + 텔레그램 리포트 채널에 나온 목표가
function repSum(r) {
  const tg = (TGR?.stocks?.[r.code] || []).filter((x) => x.tp && x.firm).map((x) => ({ d: x.d, firm: x.firm, tp: x.tp, tp_dir: x.dir }));
  const all = [...(r.list || []), ...tg].sort((a, b) => (a.d < b.d ? 1 : -1));
  const cut = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10), L = all.filter((x) => x.d >= cut(214) && x.tp), n30 = L.filter((x) => x.d >= cut(30)).length;
  const up = L.filter((x) => (x.tp_prev && x.tp > x.tp_prev) || x.tp_dir === "상향").length, dn = L.filter((x) => (x.tp_prev && x.tp < x.tp_prev) || x.tp_dir === "하향").length;
  const last = Object.values(Object.fromEntries([...L].reverse().map((x) => [x.firm, x.tp])));
  const avg = last.length ? last.reduce((a, b) => a + b, 0) / last.length : null, c = DASH.stocks.find((s) => s.code === r.code);
  return L.length || avg ? `<div class="note">최근 7개월 리포트 ${L.length}개 (30일 안 ${n30}개)${tg.length ? ` <span class="src">· 텔레그램 채널 목표가 ${tg.length}개 포함</span>` : ""} · 목표가 <b style="color:var(--good-ink)">올림 ${up}</b> · <b style="color:var(--bad-ink)">내림 ${dn}</b>${avg ? ` · 증권사 ${last.length}곳 최신 목표가 평균 <b>${tpTxt(avg, r.market)}</b>${c?.price ? ` (지금 주가 대비 ${pct((avg / c.price - 1) * 100, 0, true)})` : ""}` : ""}</div>` : "";
}
// 📨 텔레그램 리포트 채널 (data/tg_reports.json ← collector/tg_reports.py, 하루 두 번): 최근 7개월 글 — 제목·그 종목 줄·목표가만, 원문은 링크
let TGR = null;
const tgGet = async () => {
  if (TGR) return TGR;
  TGR = await (await fetch("data/tg_reports.json?t=" + Date.now(), { cache: "no-store" })).json();
  try {  // + 미리보기가 꺼진 채널 (data/tg_api.json ← 이 컴퓨터의 텔레그램 API, tools/tg_api_reports.py) — 같은 칸으로 합침
    const A = await (await fetch("data/tg_api.json?t=" + Date.now(), { cache: "no-store" })).json();
    for (const [c, L] of Object.entries(A.stocks || {})) TGR.stocks[c] = tgSort([...(TGR.stocks[c] || []), ...L]).slice(0, 40);
    TGR.kr = [...(TGR.kr || []), ...(A.channels || [])];
    TGR.api_at = A.updated_at;
  } catch (_) { /* API 채널만 빠짐 */ }
  return TGR;
};
const tgSort = (L) => [...L].sort((a, b) => (b.d + (b.hm || "")).localeCompare(a.d + (a.hm || "")));
const kstDay = (k = 0) => new Date(Date.now() + 9 * 36e5 - k * 864e5).toISOString().slice(0, 10);
const tgLab = (x) => (x.pdf ? "📥 PDF·요약" : x.ch === "ked_epic_ai" ? "✨ 요약" : x.ib ? "🌏 해외 증권사 요약" : "🔗 원문");
// 목표가: '540,000 → 435,000 하향' (에픽 AI 요약은 이전 목표가도 있음)
const tgTp = (x, code) => (x.tp ? `${x.tp_prev ? `${tpTxt(x.tp_prev, mktOf(code))} → ` : ""}<b>${tpTxt(x.tp, mktOf(code))}</b>${x.dir
  ? ` <b style="color:${x.dir === "하향" ? "var(--bad-ink)" : x.dir === "상향" ? "var(--good-ink)" : "inherit"}">${esc(x.dir)}</b>` : ""}` : "");
// 같은 증권사 글(DOC_POOL PDF + 에픽 AI 요약)은 한 줄로 링크를 나란히, 증권사가 없는 업종·시황 글은 제목으로
function tgRows(L, code) {
  const by = new Map();
  for (const x of L) { const k = x.firm || x.u; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  return [...by.values()].map((g) => {
    const t = g.find((x) => x.tp_prev) || g.find((x) => x.tp) || g[0];
    return `<li><span class="src">${esc(g[0].d.slice(5).replace("-", "/"))}${g[0].hm ? " " + esc(g[0].hm) : ""}</span> ${g[0].firm ? `<b>${esc(g[0].firm)}</b> ${tgTp(t, code)}` : esc(g[0].t)}
      · ${g.map((x) => `<a href="${esc(x.u)}" target="_blank" rel="noopener">${tgLab(x)}</a>${x.src ? ` · <a href="${esc(x.src)}" target="_blank" rel="noopener">📰 원문</a>` : ""}`).join(" · ")}</li>`;
  }).join("");
}
// 📊 maddingStock '주간 EPS 컨센서스 리비전' (일요일 밤) — 최근 7일 안에 그 종목이 TOP 8·적자·참고 칸에 나왔으면 한 줄 (사용자 2026-11-02 '일주일 유지')
const revTxt = (r) => (r.note ? esc(r.note) : `${r.y1 != null ? `올해 EPS ${estP(r.y1)} · 내년 ${estP(r.y2)}` : ""}${r.op != null ? ` · 영업이익 ${estP(r.op)}` : ""}${r.px != null ? ` · 주가 ${sg(r.px, 1)}` : ""}`);
const revSec = (s) => (s.includes("상향 TOP") ? "▲ 상향 TOP 8" : s.includes("하향 TOP") ? "▼ 하향 TOP 8" : s.includes("적자") ? "적자·저EPS 영업이익" : s);
function revHTML(code) {
  const x = tgSort((TGR?.stocks?.[code] || []).filter((p) => p.rev && p.d >= kstDay(6)))[0];
  return x ? `<div class="note" style="margin-top:6px">📊 <b>주간 EPS 리비전</b> <span class="src">maddingStock ${esc(x.rev.wk)} · 전주 대비</span> <b>${esc(revSec(x.rev.sec))}</b> ${revTxt(x.rev)} · <a href="${esc(x.u)}" target="_blank" rel="noopener">원문</a></div>` : "";
}
// 📄 오늘·어제 리포트 (보유 탭 카드, 소몽 체크리스트 위 — 사용자 2026-11-02·03): ① 이 종목 증권사 리포트 (한경 컨센서스 목록 + 텔레그램으로 온 것 + 사용자 전달 요약 reports.yaml)
//   → ② 이 업종 산업 리포트 (reports.json industry) → ③ 둘 다 없을 때만 🌐 인터넷(텔레그램) 글 · 최대 10개 · 줄을 누르면 요약·목표가 계산 방식
const fKey = (f) => (f || "").replace(/^한투/, "한국").replace(/\s/g, "").slice(0, 2).toUpperCase();  // 증권사 이름 앞 두 글자로 같은 곳 찾기 (IM증권 = iM증권)
const mdDay = (d) => d.slice(5).replace("-", "/");
function tgDayHTML(code) {
  if (!TGR && !REPS) return "";
  const d1 = kstDay(1), mkt = mktOf(code), r = REPS?.stocks?.find((s) => s.code === code);
  // 사용자 11/6: 기업 리포트만 — 시황·전략·산업분석 글, 업종 리포트(📑 리포트 탭 🏭 산업 칩에 있음), 인터넷 글 대체 목록은 뺌
  const co = repMerge(code, r).filter((x) => x.d >= d1 && !REP_MACRO.test(x.t || ""));  // 최신 날짜 먼저 · 같은 날이면 상향이 위
  const at = [REPS?.updated_at, TGR?.updated_at, TGR?.api_at, DG?.updated_at].filter(Boolean).map((s) => s.slice(5)).join(" · ");
  // 🧾 텔레그램 AI 채널 '증권사 리포트 종합' (최근 10일) ↔ 우리 한경 목록 같은 기간 (사용자 2026-11-03 크로스체크)
  const sm = tgSort((TGR?.stocks?.[code] || []).filter((x) => x.sum && x.d >= kstDay(9)))[0];
  let sumLine = "";
  if (sm) {
    const from = new Date(new Date(sm.d + "T00:00:00Z") - 4 * 864e5).toISOString().slice(0, 10);
    const ours = (r?.list || []).filter((x) => x.d >= from && x.d <= sm.d), up = ours.filter((x) => (x.tp_prev && x.tp > x.tp_prev) || x.tp_dir === "상향").length, dn = ours.filter((x) => (x.tp_prev && x.tp < x.tp_prev) || x.tp_dir === "하향").length;
    const s = sm.sum, tp = [s.up != null ? `상향 ${s.up}` : "", s.keep != null ? `유지 ${s.keep}` : "", s.down != null ? `하향 ${s.down}` : ""].filter(Boolean).join(" · ");
    sumLine = `<div class="note" style="margin-top:6px">🧾 <b>증권사 리포트 종합</b> <span class="src">${mdDay(sm.d)} 텔레그램 AI 기업분석 채널</span> — ${s.n ? `${s.n}곳` : ""}${tp ? ` · 목표가 ${tp}` : ""}
      <span class="src">↔ 우리 한경 목록 ${mdDay(from)}~${mdDay(sm.d)} ${ours.length}곳 · 상향 ${up} · 하향 ${dn}</span> · <a href="${esc(sm.u)}" target="_blank" rel="noopener">종합 글</a></div>`;
  }
  const n_ = Math.min(10, co.length);
  return (n_ ? `<div class="chart-title" style="margin-top:12px"><b>📄 오늘·어제 기업 리포트 ${n_}개</b> <span class="src">목표가 먼저 · 같은 날이면 상향이 위 · 눌러서 근거·이익 추정·일정 · 확인 ${esc(at)}</span></div>${co.slice(0, 10).map((x) => repRow(x, mkt)).join("")}`
    : `<div class="src" style="margin-top:10px">📄 오늘·어제 새 기업 리포트 없음 · 확인 ${esc(at)}</div>`) + sumLine + revHTML(code);
}
const REP_MACRO = /시황|전략|산업\s*분석|Daily|데일리|모닝|마감|매크로|경제|채권|이슈\s*점검/i;  // 기업 리포트만 (시황·업종 글 빼기)
// 📌 리포트 탭 맨 위 (사용자 11/9): 보유 → 관심 → 공동 묶음마다 최근 7일 기업 리포트를 ▲상향 → 🆕신규(이닛) → ▼하향 → ➖유지 순, 같은 칸 안은 최신이 위
//   줄마다 📥 PDF = 원문 주소로 바로 받기 (한경 PDF·텔레그램 PDF 글) — 사이트에 파일을 두지 않아 무겁지 않음 · 한국·미국 같은 기준
const TOP_DIR = [["상향", "▲ 목표가 상향", "--good-ink"], ["신규", "🆕 신규 (이닛)", "--s1"], ["하향", "▼ 목표가 하향", "--bad-ink"], ["유지", "➖ 유지", "--ink-2"], ["", "· 방향 모름 (이전 목표가 없음)", "--ink-2"]];
function repTopHTML(mkt, sel) {
  const d7 = kstDay(6);
  return ["보유", "관심", "공동"].filter((g) => sel === "전체" || sel === g).map((g) => {
    const S = DASH.stocks.filter((c) => mktOf(c.code) === mkt && [grp(c), ...(c.also || [])].includes(g) && !/우$/.test(c.name));
    const rows = S.flatMap((c) => repMerge(c.code, REPS?.stocks?.find((r) => r.code === c.code)).filter((x) => x.d >= d7 && !REP_MACRO.test(x.t || "")).map((x) => ({ ...x, code: c.code, name: c.name })))
      .sort((a, b) => b.d.localeCompare(a.d) || (b.hm || "").localeCompare(a.hm || ""));
    const row = (x) => {
      const pdf = x.u || (x.links || []).find((y) => y.pdf)?.u, alt = !pdf && (x.tu || x.links?.[0]?.u);
      const btn = pdf ? `<a href="${esc(pdf)}" target="_blank" rel="noopener" class="chip" style="float:right;margin-left:6px">📥 PDF${x.u ? "" : " (텔레그램)"}</a>` : alt ? `<a href="${esc(alt)}" target="_blank" rel="noopener" class="chip" style="float:right;margin-left:6px">🔗 원문</a>` : "";
      return repRow(x, mkt).replace("<summary>", `<summary>${btn}<a href="#reports/${esc(x.code)}"><b>${esc(x.name)}</b></a> · `);
    };
    const parts = TOP_DIR.map(([k, lab, col]) => [k, lab, col, rows.filter((x) => (x.dir || "") === k)]).filter((p) => p[3].length);
    const cnt = parts.map(([, lab, col, L]) => `<b style="color:var(${col})">${lab.split(" (")[0]} ${L.length}</b>`).join(" · ");
    return `<details class="card" style="margin-bottom:10px"${g === "보유" || sel === g ? " open" : ""}><summary><b>📌 ${g} 종목 리포트 — 최근 7일 ${rows.length}개</b> <span class="src">${cnt || "새 리포트 없음"}</span></summary>
      ${rows.length ? `<div class="src" style="margin-top:4px">${g === "보유" ? "▲ 상향 → 🆕 신규 → ▼ 하향 → ➖ 유지 순 · 같은 칸은 최신이 위 · " : ""}📥 PDF = 원문을 바로 받기 (한경 컨센서스 PDF · 텔레그램 PDF 글) · 7일 지나면 저절로 빠져요${mkt === "US" ? " · 미국은 야후 의견 변경이라 PDF 가 없는 줄이 많아요" : ""}</div>` : ""}
      ${parts.map(([, lab, col, L]) => `<div style="margin-top:8px"><b style="color:var(${col})">${lab} ${L.length}</b></div>${L.slice(0, 8).map(row).join("")}${L.length > 8 ? `<details><summary class="src">${L.length - 8}개 더</summary>${L.slice(8).map(row).join("")}</details>` : ""}`).join("")}</details>`;
  }).join("");
}
// 📥 최근 7일 리포트 (리포트 탭 맨 위): 보유·관심·공동 종목, 날짜별 — 링크만 (PDF 는 텔레그램에 있어 사이트 용량을 안 씀, 7일 지나면 저절로 빠짐)
function tgWeekHTML(mkt, grp = "전체") {  // 보유·관심·공동 칩을 누르면 그 묶음 종목만, 전체는 보유 → 공동 → 관심 순 (사용자 11/6)
  if (!TGR) return "";
  const names = {}, go = {}, days = {};
  for (const c of DASH.stocks) if (mktOf(c.code) === mkt && (grp === "전체" || c.group === grp)) { names[c.code] = c.name; go[c.code] = Math.min(go[c.code] ?? 9, GRP_ORD[c.group] ?? 9); }
  for (const [code, L] of Object.entries(TGR.stocks || {})) {
    if (!names[code]) continue;
    for (const x of L) if (x.d >= kstDay(6) && x.est_w == null && (x.pdf || x.tp || x.ib || x.ch === "ked_epic_ai")) ((days[x.d] ||= {})[code] ||= []).push(x);
  }
  const D = Object.keys(days).sort().reverse(), wd = (d) => "일월화수목금토"[new Date(d + "T12:00:00Z").getUTCDay()], lab = grp === "전체" ? "보유·공동·관심" : grp;
  const RV = Object.keys(TGR.stocks || {}).filter((c) => names[c]).sort((a, b) => go[a] - go[b]).map((c) => [c, revHTML(c)]).filter(([, h]) => h);
  if (!D.length && !RV.length) return "";
  const ch = (u, t) => `<a href="https://t.me/${u}" target="_blank" rel="noopener">${t}</a>`;
  return `<div class="card" style="margin-bottom:10px">${RV.length ? `<b>📊 이번 주 EPS 리비전 — ${lab} 종목</b> <span class="src">${ch("maddingStock", "maddingStock")} 주간 글에 이름이 나온 종목만 (TOP 8 밖 '외 N종목'은 이름이 없어요) · 7일 유지</span>
    ${RV.map(([c, h]) => h.replace("📊 <b>주간 EPS 리비전</b>", `<b>${esc(names[c])}</b>`)).join("")}<div style="margin-top:10px"></div>` : ""}<b>📥 최근 7일 리포트 — ${lab} 종목</b>
    <div class="src">📥 PDF·요약 = ${ch("DOC_POOL", "DOC_POOL")} (누르면 텔레그램에서 PDF 받기) · ✨ 요약 = ${ch("ked_epic_ai", "에픽 AI")} 리서치 요약 (목표가 올림·내림) · 🌏 = ${ch("bumgore", "bumgore")} 해외 증권사(골드만·JP모건 등) 리포트 요약 · 7일 지나면 목록에서 저절로 빠져요 · 확인 ${esc([TGR.updated_at, TGR.api_at].filter(Boolean).join(" · "))}</div>
    ${D.map((d, i) => {
      const S = Object.entries(days[d]).sort((a, b) => go[a[0]] - go[b[0]] || b[1].length - a[1].length), n = S.reduce((a, [, L]) => a + L.length, 0);
      return `<details${i === 0 ? " open" : ""} style="margin-top:6px"><summary><b>${esc(d.slice(5).replace("-", "/"))} (${wd(d)})</b> <span class="src">${S.length}종목 · ${n}개</span></summary>
        ${S.map(([code, L]) => `<div style="margin-top:6px"><a href="#reports/${esc(code)}"><b>${esc(names[code])}</b></a><ul class="irl">${tgRows(tgSort(L), code)}</ul></div>`).join("")}</details>`;
    }).join("")}</div>`;
}
function tgHTML(code, max) {
  const L = TGR?.stocks?.[code] || [], P = L.filter((x) => x.est_w == null).slice(0, max);  // 추정치 순위 글은 📈 이익 추정치 칸에
  if (!P.length) return "";
  const D = (x) => esc(x.d.slice(5).replace("-", "/"));
  return `<div class="news-h" style="margin-top:10px">📨 텔레그램 리포트 채널 <span class="src">최근 7개월 ${L.length}개 · ${esc((TGR.kr || []).concat(TGR.us || []).length)}개 채널 · ${esc(TGR.updated_at || "")}</span></div>
    <ul class="irl">${P.map((x) => `<li><span class="src">${D(x)} · ${esc(x.ch)}</span> <a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)}</a>${x.pdf ? ' <span class="src">📥 PDF</span>' : ""}${x.tp ? ` · 🎯 ${esc(x.firm || "")} ${tgTp(x, code)}` : ""}${x.s ? `<div class="src">${esc(x.s)}</div>` : ""}</li>`).join("")}</ul>`;
}
async function loadReports() {
  try { await repGet(); } catch (_) { $("#reportsBody").innerHTML = `<div class="empty">리포트를 아직 못 받았어요. 다음 데이터 갱신 뒤에 보여요.</div>`; return; }
  try { await newsGet(); } catch (_) { /* 해외 증권사 기사만 빠짐 */ }
  try { await tgGet(); } catch (_) { /* 텔레그램 채널 글만 빠짐 */ }
  await dgGet();
  const all = REPS.stocks || [], grps = ["전체", ...Object.keys(GRP_ORD).filter((g) => all.some((r) => r.group === g)), "산업"];  // 🏭 산업 = 우리 종목 업종 산업 리포트 6개월 (사용자 11/5)
  $("#reportsIntro").innerHTML = `${esc(REPS.updated_at || "")} 갱신 · ${esc(REPS.src || "")}${DG?.updated_at ? ` · 한 장 요약 ${esc(DG.updated_at)}` : ""}<br><span class="src">맨 위 📌 = 보유 → 관심 → 공동 최근 7일 리포트 (▲상향 → 🆕신규 → ▼하향 → ➖유지, 📥 PDF 바로 받기) · 그 아래 종목 카드 줄 = 목표가 먼저 (최신 날짜가 위, 같은 날이면 목표가 올린 리포트가 위 — 약세장이라 상향을 먼저) · 줄을 누르면 근거·이익 추정·컨센서스·어조·일정(확정/예상/가정)·캐파·주주환원·리스크·🚨임원 매도 · 원문은 PDF·텔레그램 링크로 · 참고용 (매수·매도 추천 아님)</span>`;
  const latest = (r) => repMerge(r.code, r)[0]?.d || "";
  const list = REP_CODE ? all.filter((r) => r.code === REP_CODE)
    : all.filter((r) => r.market === REP_MKT && (REP_GRP === "전체" || r.group === REP_GRP)).sort((a, b) => (REP_GRP === "전체" ? (GRP_ORD[a.group] ?? 9) - (GRP_ORD[b.group] ?? 9) : 0) || latest(b).localeCompare(latest(a)));
  const find = `<input id="repQ" class="sel" type="search" value="${esc(REP_Q)}" placeholder="🔎 기업명·종목코드로 리포트 찾기 (예: 에코프로, 005930)" aria-label="기업명으로 리포트 찾기" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:6px"><div id="repFind">${repFindHTML()}</div>`;
  $("#reportsBody").innerHTML = find + (REP_CODE ? `<div class="note"><a href="#reports">← 전체 종목 리포트</a></div>` : `<div class="seg repmk" style="margin-bottom:8px"><button data-mk="KR" class="${REP_MKT === "KR" ? "on" : ""}">🇰🇷 한국 리포트</button><button data-mk="US" class="${REP_MKT === "US" ? "on" : ""}">🇺🇸 미국 리포트</button></div>
    <div class="chips repgrp" style="margin-bottom:10px">${grps.map((g) => `<button data-g="${esc(g)}" class="chip ${g === REP_GRP ? "on" : ""}">${g === "산업" ? "🏭 " : ""}${esc(g)}</button>`).join("")}</div>${REP_GRP === "산업" ? "" : repTopHTML(REP_MKT, REP_GRP) + tgWeekHTML(REP_MKT, REP_GRP)}`)
    + (REP_GRP === "산업" && !REP_CODE ? indRepHTML() : `<div class="grid g2">${list.map((r) => { const tg = tgHTML(r.code, 15); return `<div class="card" id="rep-${esc(r.code)}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><b style="font-size:17px">${esc(r.name)}</b>
      <span class="src">${esc(r.group)} · <a href="#stock/${esc(r.code)}">상세 화면</a></span></div>${repSum(r)}${repFlowHTML(r.code)}${repRowsHTML(r.code, r, 8)}${repFirmHTML(r.code, r)}
      ${tg ? `<details style="margin-top:6px"><summary class="src">📨 텔레그램 채널 글 전체 (시황·업종 글 포함)</summary>${tg}</details>` : ""}${ibHTML(r.code)}</div>`; }).join("") || `<div class="empty">리포트가 없어요.</div>`}</div>`);
}
// 🏭 산업 리포트 (reports.json industry ← 한경 컨센서스 산업 리포트 6개월, 제목 낱말로 우리 업종에 짝지음) — ⭐ 인뎁스(20쪽+) 먼저
const indRow = (x) => `<li><span class="src">${mdDay(x.d)}</span> ${x.deep ? "⭐ <b>" : ""}<a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)}</a>${x.deep ? "</b>" : ""} <span class="src">${esc(x.firm)}${x.p ? ` · ${x.p}쪽` : ""}${x.more ? ` · 같은 제목 ${x.more}번 더 (최신만)` : ""}</span></li>`;
const indUniq = (L) => { const m = new Map(); for (const x of L) { const k = `${x.firm}|${x.t}`; if (m.has(k)) m.get(k).more++; else m.set(k, { ...x, more: 0 }); } return [...m.values()]; };  // 'F&B Weekly Talk' 같은 연재물은 최신 한 줄로 (중복 빼기)
function indRepHTML() {
  const I = REPS.industry || [], S = DASH.stocks.filter((c) => mktOf(c.code) === "KR" && c.industry && !/우$/.test(c.name));
  const inds = [...new Set(["보유", "관심", "공동"].flatMap((g) => S.filter((c) => c.group === g).map((c) => c.industry)))];
  const cut = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), newDeep = indUniq(I.filter((x) => x.deep && x.d >= cut)).slice(0, 10);
  const empty = [], body = inds.map((k) => {
    const L = I.filter((x) => x.inds.includes(k)), D = indUniq(L.filter((x) => x.deep)), R = indUniq(L.filter((x) => !x.deep));
    if (!L.length) { empty.push(k); return ""; }
    const who = [...new Set(S.filter((c) => c.industry === k).map((c) => `${c.name}${c.group === "보유" ? "" : `(${c.group})`}`))].join("·");
    return `<details class="card" style="margin-bottom:8px"><summary><b>${esc(k)}</b> <span class="src">${esc(who)} · ${L.length}개 · ⭐ ${D.length}</span></summary>
      ${D.length ? `<ul class="irl" style="list-style:none;padding-left:2px">${D.map(indRow).join("")}</ul>` : ""}
      ${R.length ? `<details style="margin-top:6px"${D.length ? "" : " open"}><summary class="src">그 밖의 리포트 ${R.length}개 (최신 순)</summary><ul class="irl" style="list-style:none;padding-left:2px">${R.map(indRow).join("")}</ul></details>` : ""}</details>`;
  }).join("");
  return `<div class="card" style="margin-bottom:10px"><b>🏭 산업 리포트 — 보유·관심·공동 종목 업종 · 최근 6개월</b>
    <div class="src">⭐ = 인뎁스 (20쪽 넘는 리포트 · 쪽수를 아직 못 센 건 제목에 연간전망·Outlook·심층) · 업종은 제목 낱말로 짝지어서 가끔 엉뚱하게 붙을 수 있어요 · 원문 = 한경 컨센서스 PDF · 확인 ${esc(REPS.updated_at || "")}</div>
    ${newDeep.length ? `<div style="margin-top:8px"><b>🆕 최근 30일 ⭐ 인뎁스</b></div><ul class="irl" style="list-style:none;padding-left:2px">${newDeep.map((x) => indRow(x).replace("</li>", ` <span class="qtag">${esc(x.inds.join("·"))}</span></li>`)).join("")}</ul>` : ""}</div>
    ${body}${empty.length ? `<div class="note src">6개월 동안 짝지어진 산업 리포트 없음: ${esc(empty.join(" · "))}</div>` : ""}`;
}
// 🔎 기업명 검색 (사용자 11/5): 우리 종목 + 한경 6개월 기업 리포트 전부(rep_all.json, 처음 입력할 때만 받음) + 산업 리포트 제목
let REPA = null, REP_Q = "", REP_PICK = "";
const repAllGet = async () => { if (!REPA) { try { REPA = await (await fetch("data/rep_all.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { REPA = { rows: [] }; } } return REPA; };
const HK_PDF = "https://consensus.hankyung.com/analysis/downpdf?report_idx=";
function repFindHTML() {
  const q = REP_Q.trim().toLowerCase();
  if (!q) return "";
  const co = new Map(), hit = (name, code) => name.toLowerCase().includes(q) || code.toLowerCase().startsWith(q);
  for (const r of REPS?.stocks || []) if (hit(r.name, r.code)) co.set(r.code, { name: r.name, ours: r, n: 0 });
  for (const x of REPA?.rows || []) if (hit(x[2], x[1])) { if (!co.has(x[1])) co.set(x[1], { name: x[2], n: 0 }); co.get(x[1]).n++; }
  const C = [...co.entries()].sort((a, b) => !!b[1].ours - !!a[1].ours || b[1].n - a[1].n).slice(0, 12);
  const pick = REP_PICK && co.get(REP_PICK), P = pick ? (REPA?.rows || []).filter((x) => x[1] === REP_PICK) : [];
  const ind = (REPS?.industry || []).filter((x) => x.t.toLowerCase().includes(q)).slice(0, 8);
  return `<div class="card" style="margin-bottom:10px">${C.length ? `<div class="chips">${C.map(([c, v]) => `<button class="chip${c === REP_PICK ? " on" : ""}" data-find="${esc(c)}" data-ours="${v.ours ? 1 : ""}">${esc(v.name)} <span class="src">${v.ours ? esc(v.ours.group) + " · " : ""}${v.n ? `${v.n}개` : esc(c)}</span></button>`).join("")}</div>` : `<div class="src">'${esc(REP_Q)}' — 최근 6개월 한경 컨센서스 기업 리포트에 없는 이름이에요${REPA ? "" : " (목록 받는 중…)"}</div>`}
    ${pick ? `<div style="margin-top:8px"><b>${esc(pick.name)}</b> <span class="src">${esc(REP_PICK)} · 최근 6개월 ${P.length}개 · 한경 컨센서스</span><div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">날짜 · 증권사</th><th style="text-align:left">제목</th><th>목표주가</th><th>의견</th></tr></thead><tbody>
      ${P.slice(0, 40).map((x) => `<tr><td style="text-align:left;white-space:nowrap"><span class="src">${esc(mdDay(x[0]))}</span> ${esc(x[6])}</td><td style="text-align:left;white-space:normal;min-width:12em"><a href="${HK_PDF}${esc(x[7])}" target="_blank" rel="noopener">${esc(x[3])}</a></td><td>${x[4] ? n(x[4], 0) + "원" : "-"}</td><td>${esc(x[5] || "")}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
    ${ind.length ? `<div style="margin-top:8px"><b>🏭 산업 리포트 제목에 '${esc(REP_Q)}'</b></div><ul class="irl" style="list-style:none;padding-left:2px">${ind.map(indRow).join("")}</ul>` : ""}
    <div class="src" style="margin-top:4px">이름을 누르면 리포트 목록 · 보유·관심·공동 종목은 요약·목표가 변화까지 있는 칸으로 가요</div></div>`;
}
document.addEventListener("input", async (e) => {
  if (e.target.id !== "repQ") return;
  REP_Q = e.target.value; REP_PICK = "";
  $("#repFind").innerHTML = repFindHTML();
  if (REP_Q.trim() && !REPA) { await repAllGet(); $("#repFind").innerHTML = repFindHTML(); }
});
document.addEventListener("click", (e) => {
  const m = e.target.closest("#reportsBody .repmk button"), g = e.target.closest("#reportsBody .repgrp button"), f = e.target.closest("#repFind [data-find]");
  if (m) { REP_MKT = m.dataset.mk; loadReports(); }
  if (g) { REP_GRP = g.dataset.g; loadReports(); }
  if (f && f.dataset.ours) { REP_PICK = ""; location.hash = `#reports/${f.dataset.find}`; }
  else if (f) { REP_PICK = REP_PICK === f.dataset.find ? "" : f.dataset.find; $("#repFind").innerHTML = repFindHTML(); }
});
// 🎯 증권사 시각 (종목 상세, 핵심 이슈 아래): 요약 1개 + 최근 리포트 4개 → 리포트 탭으로
async function repBlock(code) {
  let r;
  try { r = (await repGet()).stocks.find((x) => x.code === code); } catch (_) { r = null; }
  try { await newsGet(); } catch (_) { /* 뉴스 없으면 해외 증권사 기사만 빠짐 */ }
  try { await tgGet(); } catch (_) { /* 텔레그램 채널 글만 빠짐 */ }
  await dgGet();
  const ib = ibHTML(code), tg = tgHTML(code, 5), has = repMerge(code, r).length;
  if (!has && !ib && !tg) return "";
  return `<h3>🎯 증권사 시각 <span class="src"><a href="#reports/${esc(code)}">리포트 탭에서 전체 보기 →</a></span></h3><div class="card">${has ? `${r ? repSum(r) : ""}${repFlowHTML(code)}${repRowsHTML(code, r, 4, false)}` : ""}
    ${tg ? `<details style="margin-top:6px"><summary class="src">📨 텔레그램 채널 글</summary>${tg}</details>` : ""}${ib}
    <div class="note"><a href="#reports/${esc(code)}">📑 ${esc(r?.name || "")} 리포트 전체 (요약·목표가 변화) 보기 →</a></div></div>`;
}
// 🌍 해외 증권사(골드만·JP모건·모건스탠리 등)가 한국 종목에 낸 리포트 — 원문이 비공개라 그걸 다룬 기사 (news.json ib)
const IB_FIRM = /골드만|JP모건|제이피모건|모건\s?스탠리|맥쿼리|씨티|노무라|UBS|CLSA|HSBC|번스타인|BofA|뱅크오브아메리카|메릴린치|도이치|바클레이즈|제프리스/i;
function ibHTML(code) {
  const L = (NEWS?.stocks?.find((x) => x.code === code)?.ib || []).slice(0, 5);
  return L.length ? `<div class="news-h" style="margin-top:10px">🌍 해외 증권사 리포트 (기사로 알려진 것 · 원문은 비공개)</div>${newsList(L)}` : "";
}

/* ---------- 📰 뉴스 탭: 내 종목 · 경쟁사 · 외신 (config/news.yaml, Google 뉴스 30일치 쌓임) ---------- */
let NEWS = null, NEWS_GRP = "전체", NEWS_CODE = "";  // NEWS_CODE = '#news/코드' 로 들어오면 그 종목만
const newsGet = async () => { if (!NEWS) NEWS = await (await fetch("data/news.json?t=" + Date.now(), { cache: "no-store" })).json(); return NEWS; };
// 📢 중요 공시 (data/filings.json): 공급계약(매출 10%+·글로벌/대기업) · 자사주 · 배당 · 시설투자 · 장래계획 · 임원·대주주 1억+ 장내 매매
let FILINGS = null;
async function filingsBlock(code) {
  if (FILINGS === null) { try { FILINGS = await (await fetch("data/filings.json?t=" + encodeURIComponent(DASH.updated_at))).json(); } catch (_) { FILINGS = {}; } }
  const rows = FILINGS.companies?.[code] || [];
  if (!rows.length) return "";
  const cap = DASH.stocks.find((x) => x.code === code)?.market_cap;
  return `<h3>📢 중요 공시 <span class="src">${esc(FILINGS.rule || "")} · ${esc(FILINGS.updated_at || "")}</span></h3><div class="card">
    <ul class="irl">${rows.map((r) => `<li><span class="src">${esc(r.d)}</span> <span class="qtag${r.lv === "bad" ? " bad" : r.lv === "good" ? "" : " muted"}">${esc(r.k)}</span> ${esc(r.t)}${r.x ? ` — <b>${esc(r.x)}</b>` : ""}${cap && r.amt && /공급계약|시설/.test(r.k) ? ` <span class="src">시총 대비 ${n((r.amt / cap) * 100, 1)}%</span>` : ""}${r.why ? ` <span class="src">· ${esc(r.why)}</span>` : ""}${r.u ? ` <a href="${esc(r.u)}" target="_blank" rel="noopener">공시</a>` : ""}</li>`).join("")}</ul></div>`;
}
async function loadNews() {
  try { await newsGet(); }
  catch (e) { $("#newsCards").innerHTML = `<div class="empty">뉴스를 아직 못 받았어요. 다음 데이터 갱신 뒤에 보여요.</div>`; return; }
  const nNew = (r) => ["own", "rivals", "en"].reduce((a, k) => a + (r[k] || []).filter((x) => x.new).length, 0);
  const grps = ["전체", ...new Set(NEWS.stocks.flatMap((r) => [r.group, ...(r.also || [])])), "🆕 새 기사"];
  $("#newsIntro").innerHTML = `${NEWS.stocks.length}개 종목 · 갱신 ${esc(NEWS.updated_at)} · 🆕 = 지난 갱신 뒤 새 기사 · 같은 기사를 여러 언론사가 쓰면 하나로 묶어 '외 N곳'<br><span class="src">${esc(NEWS.source)}</span>`;
  $("#newsGrp").innerHTML = grps.map((g) => `<button data-g="${esc(g)}" class="chip ${g === NEWS_GRP ? "on" : ""}">${esc(g)}</button>`).join("");
  const list = NEWS_CODE ? NEWS.stocks.filter((r) => r.code === NEWS_CODE)
    : NEWS.stocks.filter((r) => NEWS_GRP === "전체" || r.group === NEWS_GRP || (r.also || []).includes(NEWS_GRP) || (NEWS_GRP === "🆕 새 기사" && nNew(r)));
  $("#newsCards").innerHTML = (NEWS_CODE ? `<div class="note" style="grid-column:1/-1"><a href="#news">← 전체 종목 뉴스</a></div>` : "") + (list.map((r) => newsCard(r, nNew(r))).join("") || `<div class="empty">새 기사가 없어요.</div>`);
}
function newsList(xs, showK) {
  const li = (x) => `<li><a href="${esc(x.u)}" target="_blank" rel="noopener">${x.new ? '<span class="pill green">🆕</span> ' : ""}${esc(x.t)}</a>
    <span class="src">${esc(x.d.slice(5).replace("-", "/"))} · ${esc(x.s)}${x.n > 1 ? ` 외 ${x.n - 1}곳` : ""}${showK && x.k ? ` · ${esc(x.k)}` : ""}</span></li>`;
  if (!xs.length) return `<div class="src">최근 30일 기사 없음</div>`;
  return `<ul class="news">${xs.slice(0, 4).map(li).join("")}</ul>${xs.length > 4 ? `<details><summary class="src">더 보기 (${xs.length - 4}건)</summary><ul class="news">${xs.slice(4).map(li).join("")}</ul></details>` : ""}`;
}
function newsCard(r, nNew) {
  const pin = (p) => `<li>📌 <a href="${esc(p.u)}" target="_blank" rel="noopener">${esc(p.t)}</a><span class="src">${esc(p.d || "")} · ${esc(p.s || "")}</span>${p.memo ? `<span class="note">${esc(p.memo)}</span>` : ""}</li>`;
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><b style="font-size:17px">${esc(r.name)}</b>
      <span class="src">${esc(r.group)}${nNew ? ` · 🆕 ${nNew}건` : ""} · <a href="#stock/${esc(r.code)}">상세 화면</a></span></div>
    ${(r.issues || []).length ? `<ul class="irl">${r.issues.map((x) => `<li>${x.d ? `<span class="src">${esc(x.d)}</span> ` : ""}<b>${esc(x.t || x)}</b></li>`).join("")}</ul>` : ""}
    ${r.pins.length ? `<ul class="news">${r.pins.map(pin).join("")}</ul>` : ""}
    <div class="news-h">📰 내 종목</div>${newsList(r.own)}
    ${r.rival_terms.length ? `<div class="news-h">⚔️ 경쟁사 <span class="src">${esc(r.rival_terms.join(" · "))}</span></div>${newsList(r.rivals, true)}` : ""}
    ${r.en.length ? `<div class="news-h">🌍 외신 (영어)</div>${newsList(r.en)}` : ""}
  </div>`;
}
$("#newsGrp").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; NEWS_GRP = b.dataset.g; loadNews(); });

/* ---------- 관심종목 탭 (내 시트 '빠른 판단' 자동화) ---------- */
let WATCH = null;
async function loadWatch() {
  if (!WATCH) {
    try { WATCH = await (await fetch("data/watch.json?t=" + Date.now(), { cache: "no-store" })).json(); }
    catch (e) { $("#watchCards").innerHTML = `<div class="empty">관심종목 데이터를 불러오지 못했어요.</div>`; return; }
  }
  $("#watchIntro").innerHTML = `${WATCH.rows.length}개 종목 · 갱신 ${esc(WATCH.updated_at)}<br><span class="src">${esc(WATCH.note)}</span>`;
  let s = "up";
  try { s = localStorage.getItem("watchSort") || "up"; } catch (_) {}
  $("#watchSort").value = s;
  renderWatch(s);
}
function renderWatch(mode) {
  const rows = WATCH.rows.map((r, i) => ({ ...r, i }));
  const big = (k) => (a, b) => (b[k] ?? -1e9) - (a[k] ?? -1e9);
  const small = (k) => (a, b) => (a[k] ?? 1e9) - (b[k] ?? 1e9);
  const sorter = { up: big("up_pct"), down: big("down_pct"), up5: big("up5_pct"), down5: big("down5_pct"), peg: small("peg"), per: small("per26"), mdd: small("mdd"),
    cap: big("market_cap"), sheet: (a, b) => a.i - b.i }[mode] || big("up_pct");
  rows.sort(sorter);
  $("#watchCards").innerHTML = rows.map(watchCard).join("");
}
function watchRange(label, price, lo, hi, loPct, hiPct) {
  const pos = lo && hi && hi > lo ? Math.max(0, Math.min(100, ((price - lo) / (hi - lo)) * 100)) : null;
  if (pos == null) return `<div class="note">${label} 하방·상방: N/A (밴드 자료 부족)</div>`;
  return `<div class="sub" style="margin-top:8px;font-weight:700">${label} 밴드</div>
    <div class="range"><span class="dot" style="left:${pos}%"></span></div>
    <div class="rangelbl"><span>하방 ${n(lo)}<br><b class="${loPct < 0 ? "verdict red" : "verdict green"}" style="font-size:13px">${pct(loPct, 0, true)}</b></span>
      <span style="text-align:right">상방 ${n(hi)}<br><b class="verdict green" style="font-size:13px">${pct(hiPct, 0, true)}</b></span></div>`;
}
function watchCard(r) {
  const y = (k) => (r.op_yoy || {})[k];
  const yk = Object.keys(r.op_yoy || {});
  const cell = (label, v) => `<div>${label}<b>${v}</b></div>`;
  const open = r.holding ? `onclick="location.hash='#stock/${esc(r.code)}'" style="cursor:pointer"` : "";
  return `<div class="card" ${open}>
    <div class="row1" style="display:flex;justify-content:space-between;gap:8px"><span class="name" style="font-weight:700;font-size:17px">${esc(r.name)}${r.holding ? '<span class="tag">보유</span>' : ""}</span>
      <span class="price" style="font-weight:700">${won(r.price)}</span></div>
    <div class="sub">시가총액 ${bigWon(r.market_cap)} · 적정가 기준 ${r.fair === "PBR" ? "PBR" : "선행 PER"} 밴드 ${r.stale ? '<span class="stale">⚠ 직전 데이터</span>' : ""}</div>
    ${watchRange("10년", r.price, r.down, r.up, r.down_pct, r.up_pct)}
    ${watchRange("5년", r.price, r.down5, r.up5, r.down5_pct, r.up5_pct)}
    <div class="mini">
      ${cell("PER 25·26E·27E", `${n(r.per25, 1)} · ${n(r.per26, 1)} · ${n(r.per27, 1)}`)}
      ${cell("PBR 25·26E·27E", `${n(r.pbr25, 2)} · ${n(r.pbr26, 2)} · ${n(r.pbr27, 2)}`)}
      ${cell("PEG (26E)", n(r.peg, 2))}
      ${cell("ROE 26E", pct(r.roe26))}
      ${cell("부채비율 26E", pct(r.debt26, 0))}
      ${cell("고점 대비", `${pct(r.mdd, 0)}`)}
      ${cell("EPS 성장(26~28)", pct(r.eps_g, 0, true))}
      ${cell("매출 성장(25~27)", pct(r.sales_g, 0, true))}
      ${cell(`영업이익 YoY ${yk.map((k) => k).join("·")}`, yk.map((k) => (y(k) == null ? "-" : n(y(k), 0) + "%")).join(" · "))}
    </div>
    <div class="note src">52주 최고가 ${n(r.high52)} · 10년 밴드 ${esc(r.band_from || "")}~ (하단 ${n(r.band_low, 2)} / 평균 ${n(r.band_avg, 2)} / 상단 ${n(r.band_high, 2)}배) · 5년 밴드 ${esc(r.band5_from || "")}~ (하단 ${n(r.band5_low, 2)} / 평균 ${n(r.band5_avg, 2)} / 상단 ${n(r.band5_high, 2)}배)${r.holding ? " · 누르면 상세 화면" : ""}</div>
  </div>`;
}

/* ---------- 전체 ---------- */
// 🚨 데이터 갱신이 끝까지 안 됐을 때 모든 탭 맨 위에 (data/run_status.json ← update.yml '갱신 상태 기록') + 시간이 모자라 직전 값으로 둔 종목
let RUNST = null;
function runAlertHTML(rs, s) {
  const st = s?.stale || [];
  if (rs && !rs.ok) return `<div class="warnbox" style="margin-top:8px;border-color:var(--bad);background:var(--bad-bg)">🚨 <b>데이터 갱신이 끝까지 안 됐어요</b> <span class="src">(${esc(rs.at)} · ${rs.attempt}/${rs.max}번째 시도${rs.outcome === "cancelled" ? " · 시간 초과" : ""})</span><br>
    화면 숫자는 <b>${esc(rs.data_at || "-")}</b> 갱신 기준이에요. ${rs.attempt < rs.max ? "자동으로 다시 시도하고 있어요." : `${rs.max}번 다 실패해서 다음 예약 갱신(평일 07:30·18:30) 때 다시 해요.`}${rs.last_ok ? ` · 마지막 성공 ${esc(rs.last_ok)}` : ""} · <a href="${esc(rs.url)}" target="_blank" rel="noopener">작업 기록</a></div>`;
  return st.length ? `<div class="warnbox" style="margin-top:8px">⏱ 이번 갱신은 시간이 모자라 ${st.length}종목(${st.map(esc).join("·")})을 직전 값으로 뒀어요 — 다음 갱신 때 다시 계산해요.</div>` : "";
}
function renderAll() {
  const s = DASH.status;
  $("#updated").textContent = `마지막 갱신 ${DASH.updated_at} (KST)`;
  const chip = $("#statusChip");
  chip.hidden = false;
  const nf = s.failures.length, bad = RUNST && !RUNST.ok;
  chip.className = "status-chip" + (nf || bad ? "" : " ok");
  chip.textContent = bad ? "🚨 갱신 실패" : nf ? `⚠ 실패 ${nf}건` : "✓ 모두 정상";
  $("#runAlert").innerHTML = runAlertHTML(RUNST, s);
  $("#failBox").innerHTML = nf || s.blocked.length ? `<details class="fail card" style="margin-top:12px" ${nf ? "" : ""}>
      <summary>${nf ? `⚠ 이번 갱신에서 ${nf}개 항목을 못 받아서 직전 값을 보여주고 있어요` : "ℹ 대체 출처를 쓴 항목"}</summary>
      <ul>${s.failures.map((f) => `<li><b>${esc(f.item)}</b> — ${esc(f.reason)}</li>`).join("")}
      ${s.blocked.map((b) => `<li>${esc(b.source)}: ${esc(b.reason)}</li>`).join("")}</ul></details>` : "";
  const b = DASH.settings.bond_signal;
  $("#ruleLine").textContent = `비율 = 주식 선행 PER ÷ 채권 환산 PER(1 ÷ 금리). ${b.green_max} 이하 🟢 매력 · ${b.yellow_max} 이하 🟡 중립 · 그 위 🔴 위험`;
  $("#marketSignals").innerHTML =
    marketCard(DASH.signals.us, DASH.rates.us10y, null, "us") +
    marketCard(DASH.signals.kr, DASH.rates.kr3y, DASH.rates.kr10y ? { label: "국고채 10년", latest: DASH.rates.kr10y.latest } : null, "kr");
  drawMarketCharts();
  renderTop();
  renderCmp();
  renderCards();
  kospiCard();
  spBand();
  crossCheck();
  const srcs = new Set();
  for (const r of Object.values(DASH.rates)) if (r?.source) srcs.add(r.source);
  for (const k of ["sp500_trailing", "sp500_forward", "kospi_forward"]) if (DASH.market[k]?.source) srcs.add(DASH.market[k].source.split(" (")[0]);
  ["네이버 증권", "와이즈리포트", "OpenDART"].forEach((x) => srcs.add(x));
  $("#footer").innerHTML = `<p><b>투자 판단 참고용</b>이에요. 매수·매도 추천이 아니며, 숫자는 출처의 사정으로 틀리거나 늦을 수 있어요.</p>
    <p>데이터 출처: ${[...srcs].map(esc).join(" · ")}</p>
    <p>💱 외화 금액 옆 괄호 (약 ○원) = 오늘 환율로 바꾼 대략의 원화 (그때 환율 아님)</p>
    <p>마지막 갱신: ${esc(DASH.updated_at)} KST · 갱신 시각: 전체 = 평일 07:30, 18:30 · 리포트·텔레그램·뉴스 = 매일 07:30, 17:30 + 일~목 19:30~01:30 매시간</p>`;
}

async function load() {
  try {
    const r = await fetch("data/dashboard.json?t=" + Date.now(), { cache: "no-store" });
    DASH = await r.json();
    try { PROFILES = await (await fetch("data/profiles.json?t=" + Date.now(), { cache: "no-store" })).json() || {}; } catch (_) { PROFILES = {}; }
    try { EARNINGS = await (await fetch("data/earnings.json?t=" + Date.now(), { cache: "no-store" })).json() || {}; } catch (_) { EARNINGS = {}; }
    try { IRCAL = await (await fetch("data/ir_calendar.json?t=" + Date.now(), { cache: "no-store" })).json() || { items: [] }; } catch (_) { IRCAL = { items: [] }; }
    try { IRB = await (await fetch("data/ir_brief.json?t=" + Date.now(), { cache: "no-store" })).json() || {}; } catch (_) { IRB = {}; }
    try { [EXP, TN] = await Promise.all(["exports", "tour_nat"].map((f) => fetch(`data/${f}.json?t=` + Date.now(), { cache: "no-store" }).then((r) => r.json()).catch(() => ({})))); } catch (_) { EXP = {}; TN = {}; }  // ‼️ 📦 카드 꼬리표
    try { PBR = await (await fetch("data/pbr_watch.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { /* 📌 코멘트·기준선만 빠짐 */ }
    try { CYC = await (await fetch("data/cycle_dd.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { CYC = null; }  // 📉 고점 대비 낙폭 사이클
    try { EVENTS = await (await fetch("data/events.json?t=" + Date.now(), { cache: "no-store" })).json() || []; } catch (_) { EVENTS = []; }
    try { SOMONG = await (await fetch("data/somong.json?t=" + Date.now(), { cache: "no-store" })).json() || {}; } catch (_) { SOMONG = {}; }
    try { CAPEX = await (await fetch("data/capex.json?t=" + Date.now(), { cache: "no-store" })).json() || {}; } catch (_) { CAPEX = {}; }  // 🇺🇸 탭 빅테크 현금흐름
    try { RUNST = await (await fetch("data/run_status.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { RUNST = null; }  // 🚨 갱신 실패 알림
  } catch (e) {
    $("#updated").textContent = "데이터를 불러오지 못했어요";
    return;
  }
  renderAll();
  route();
  // 💱 환율 받고 나서 이미 그려진 글자도 한 번 바꿈 (그 뒤는 MutationObserver 가 자동)
  fetch("data/peers.json?t=" + encodeURIComponent(DASH.updated_at)).then((r) => r.json()).then((j) => { PEERS ??= j; FXR = j?.fx || null; wonDOM(document.body); }).catch(() => {});
}

for (const id of ["#stockCards", "#watchFull", "#jointCards"]) $(id).addEventListener("click", (e) => {
  const b = e.target.closest(".stock"); if (!b || e.target.closest(".pseg, .scenseg")) return;  // 주가 기간·강세장 탭은 상세로 넘어가지 않음
  GOTO = e.target.closest("[data-go]")?.dataset.go || null;  // ‼️ 수출 꼬리표 → 상세 '📦 수출·입국' 칸으로
  location.hash = `#stock/${b.dataset.code}`;
});
$("#watchSort").addEventListener("change", (e) => {
  try { localStorage.setItem("watchSort", e.target.value); } catch (_) {}
  if (WATCH) renderWatch(e.target.value);
});
$("#sortSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  sortMode = b.dataset.sort;
  $("#sortSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  try { localStorage.setItem("sort", sortMode); } catch (_) {}
  renderCards();
});
$("#backBtn").addEventListener("click", () => {
  if (history.length > 1 && location.hash) history.back(); else { location.hash = ""; closeSheet(); }
});
window.addEventListener("hashchange", route);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (DASH) { renderAll(); route(); } });
try {
  const s = localStorage.getItem("sort");
  if (s) { sortMode = s; document.querySelectorAll("#sortSeg button").forEach((x) => x.classList.toggle("on", x.dataset.sort === s)); }
} catch (_) {}
load();
