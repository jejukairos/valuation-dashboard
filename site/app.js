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
let sortMode = "cheap";
const charts = new Map();

/* ---------- 숫자 표시 ---------- */
function n(v, d = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return "N/A";
  return Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function won(v) { return v == null ? "N/A" : n(v) + "원"; }
function money(v, cur) { return v == null ? "N/A" : cur === "USD" ? "$" + n(v, 2) : n(v) + "원"; }
function bigWon(v) {
  if (v == null) return "N/A";
  if (v >= 1e12) return n(v / 1e12, 1) + "조원";
  if (v >= 1e8) return n(v / 1e8) + "억원";
  return n(v) + "원";
}
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
          ticks: { color: C.muted, maxTicksLimit: 5, maxRotation: 0, autoSkip: true, font: { size: 11 },
            callback(v) { const l = this.getLabelForValue(v); return String(l).slice(0, opt.xlen || 7); } } },
        y: { grid: { color: C.grid }, border: { display: false }, beginAtZero: !!opt.zero,
          ticks: { color: C.muted, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => (opt.yfmt ? opt.yfmt(v) : n(v, 1)) } },
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
// 카드용 주가 차트: 최근 1년 종가 + 이동평균선 (20일 빨강 · 50일 분홍 · 200일 검정) + 볼린저밴드(연하늘색)
const BB_COLOR = "#7cc7f2";
const maLines = () => [["ma20", "20일선", "#e53935"], ["ma50", "50일선", "#ec4899"], ["ma200", "200일선", css("--ink")]];
function priceChartHTML(c) {
  if (!c.chart || !c.chart.close) return "";
  return `<div class="miniband" onclick="event.stopPropagation()">
    <div class="chart-title" style="margin-top:8px">주가 · 이동평균선 <span class="src">최근 1년 · 눌러서 가격 보기</span></div>
    <div class="chart-box mini"><canvas id="pc-${esc(c.code)}"></canvas></div>
    ${legend([["종가", css("--s1"), false], ...maLines().map(([, l, col]) => [l, col, false]), ...(c.chart.bb_up ? [["볼린저밴드", BB_COLOR, false]] : [])])}
  </div>`;
}
function drawPriceCharts(list) {
  for (const c of list) {
    const p = c.chart, cv = p && document.getElementById(`pc-${c.code}`);
    if (!cv) continue;
    const bb = p.bb_up ? [{ label: "볼린저 상단", data: p.bb_up, borderColor: BB_COLOR, borderWidth: 1 },
      { label: "볼린저 하단", data: p.bb_dn, borderColor: BB_COLOR, borderWidth: 1, fill: "-1", backgroundColor: BB_COLOR + "26" }] : [];
    const ds = [...bb, { label: "종가", data: p.close, borderColor: css("--s1"), borderWidth: 2 },
      ...maLines().map(([k, l, col]) => ({ label: l, data: p[k], borderColor: col, borderWidth: 1.3 }))];
    const usd = c.currency === "USD";
    makeChart(cv, p.dates, ds, { fmt: (v) => (usd ? "$" + n(v, 2) : n(v) + "원"), yfmt: (v) => (usd ? "$" + n(v) : v >= 10000 ? n(v / 10000, 0) + "만" : n(v)) });
  }
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
  const pts = [["bear", "Bear", "보수적"], ["base", "Base", "중간"], ["bull", "Bull", "낙관적"]];
  const lo0 = Math.min(c.price, s.bear), hi0 = Math.max(c.price, s.bull);
  const pad = (hi0 - lo0) * 0.08 || hi0 * 0.05;
  const lo = Math.max(0, lo0 - pad), hi = hi0 + pad;
  const at = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const where = c.price < s.bear ? "Bear 보다 낮아요" : c.price < s.base ? "Bear 와 Base 사이예요" : c.price < s.bull ? "Base 와 Bull 사이예요" : "Bull 보다 높아요";
  const parts = s.parts || [];
  const kinds = parts.map((p) => p.kind);
  const multLine = kinds.map((k) => {
    const m = (c.fwd_mult || {})[k] || {};
    const ys = Object.keys(m).filter((y) => y !== "12MF" && m[y] != null);
    const avg = (c.band_avg || {})[k];
    return `<div>지금 가격 = ${ys.map((y) => `${y} ${k} <b>${n(m[y], k === "PBR" ? 2 : 1)}배</b>`).join(" · ")}${avg ? ` <span class="src">(밴드 평균 ${n(avg, k === "PBR" ? 2 : 1)}배)</span>` : ""}</div>`;
  }).join("");
  const how = parts.map((p) => `12MF ${p.kind === "PER" ? "EPS" : "BPS"} ${fmtP(p.base_val)} × ${p.kind} ${n(p.mult.bear, 1)} / ${n(p.mult.base, 1)} / ${n(p.mult.bull, 1)}배 (${esc(p.src)})`).join("<br>");
  return `<div class="scen" onclick="event.stopPropagation()">
    <div class="chart-title" style="margin-top:12px"><b>① 앞으로 실적으로 본 적정주가</b> <span class="src">12개월 선행(12MF)</span></div>
    <div class="scenbar" style="background:linear-gradient(90deg, var(--good-bg) 0 ${at(s.base)}%, var(--warn-bg) ${at(s.base)}% ${at(s.bull)}%, var(--bad-bg) ${at(s.bull)}%)">
      ${pts.map(([k, l]) => `<span class="tick" style="left:${at(s[k])}%"></span><span class="tl" style="left:${at(s[k])}%">${l}</span>`).join("")}
      <span class="dot" style="left:${at(c.price)}%"></span><span class="now" style="left:${at(c.price)}%">지금</span>
    </div>
    <div class="scen3">${pts.map(([k, l, ko]) => {
      const up = (s[k] / c.price - 1) * 100;
      return `<div class="${k}${k === "base" ? " on" : ""}"><span>${l} <span class="src">${ko}</span></span><b>${fmtP(s[k])}</b><em class="${up >= 0 ? "up" : "dn"}">${pct(up, 0, true)}</em></div>`;
    }).join("")}</div>
    <div class="note">지금 가격은 <b>${where}</b>${s.note ? ` · ${esc(s.note)}` : ""}</div>
    <div class="note fm">${multLine}</div>
    <div class="note src">${how}</div>
  </div>`;
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
  for (const x of c.holder_changes || []) {
    pills.push(`<span class="pill ${x.chg < 0 ? "red" : "green"}">👥 ${esc(x.name.replace("공단", ""))} 지분 ${x.chg < 0 ? "▼" : "▲"}${n(Math.abs(x.chg), 2)}%p (${esc(x.date.slice(5))})</span>`);
  }
  if ((c.checks || []).some((x) => x.warn)) pills.push(`<span class="pill yellow">⚠ 출처 간 10%↑ 차이</span>`);
  let mine = "";
  if (c.avg_price && c.quantity) {
    const r = (c.price / c.avg_price - 1) * 100;
    mine = `<div class="sub">내 평단 ${money(c.avg_price, c.currency)} · ${n(c.quantity)}주 · 수익률 ${pct(r, 1, true)}</div>`;
  }
  return `<button class="card stock" data-code="${esc(c.code)}">
    <div class="row1"><span class="name">${esc(c.name)}</span><span class="price">${money(c.price, c.currency)}</span></div>
    <div class="sub">시가총액 ${bigWon(c.market_cap)}${c.market_cap_usd ? ` ($${n(c.market_cap_usd / 1e9, 0)}B)` : ""} ${c.stale ? '<span class="stale">⚠ 직전 데이터</span>' : ""}</div>
    <div class="row2">${lamp(c.verdict)}<div>
      <div class="verdict ${c.verdict}">${L.stock}</div>
      <div class="why">${esc(c.why)}</div></div></div>
    ${c.scen ? scenHTML(c) : `<div class="kv">
      <div class="k">적정가 <span class="src">${esc(c.fair_basis)}</span></div><div class="v">${money(c.fair, c.currency)}</div>
      <div class="k">괴리율 <span class="src nowrap">현재가 ÷ 적정가 − 1</span></div><div class="v">${gap}</div>
    </div>`}
    ${c.scen ? `<div class="chart-title" style="margin-top:14px"><b>② 지난 10년 밴드에서 지금 위치</b> <span class="src">0% = 10년 중 가장 싼 쪽 · 100% = 가장 비싼 쪽</span></div>` : ""}
    <div class="bandbar">${pos == null ? "" : `<span class="dot" style="left:${Math.max(0, Math.min(100, pos))}%"></span>`}</div>
    <div class="bandlbl"><span>밴드 하단 0%</span><span>10년 밴드 위치 ${pos == null ? "N/A" : n(pos, 0) + "%"}</span><span>상단 100%</span></div>
    ${fairTableHTML(c)}
    ${priceChartHTML(c)}
    ${mine}
    <div class="pills">${pills.join("")}</div>
  </button>`;
}
function renderCards() {
  const list = [...DASH.stocks];
  // 한국 → 미국, 각각 가장 매력적인(저평가) 순: 🟢 → 🟡 → 🔴 → N/A, 같은 판정 안에서는 적정가 대비 더 싼 순
  const rank = { green: 0, yellow: 1, red: 2, na: 3 };
  const mk = (c) => (c.market === "US" ? 1 : 0);
  if (sortMode === "cheap") list.sort((a, b) => mk(a) - mk(b) || (rank[a.verdict] ?? 3) - (rank[b.verdict] ?? 3) || (a.gap ?? 9) - (b.gap ?? 9));
  else list.sort((a, b) => mk(a) - mk(b) || a.order - b.order);
  $("#stockCards").innerHTML = list.map(stockCard).join("") || `<div class="empty">종목 데이터가 아직 없어요.</div>`;
  drawPriceCharts(list);
}

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
    <br><span class="src">기간 ${esc(st.from)} ~ · 주간 종가 기준 · ${band.basis === "forward" ? "<b>선행 PER</b>: 각 시점의 1년 뒤 실적(최근은 추정치)으로 계산" : "직전 연도 확정 실적 사용"} · 하단/상단 = 하위 ${DASH.settings.band.low_pct}% / 상위 ${100 - DASH.settings.band.high_pct}% 지점</span>`;
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
   선 = 그 달의 12개월 선행 EPS(BPS) × 배수 4개. Y년 실적은 (Y-1)년 12월 말에 놓고 달마다 직선으로 이어
   네이버(와이즈리포트)와 같은 값이 나온다. 배수 = 최근 5년 선행 배수의 하위 10% ~ 상위 10% 를 4등분. */
const NV_COLORS = ["#d4441c", "#7cc12a", "#a57fd6", "#f5a00f"];
const NV_STYLES = [["rectRot", 0], ["rect", 0], ["triangle", 0], ["triangle", 180]];
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "/");
function nvSeries(d, key) {
  const band = d.bands.PER || d.bands.PBR || d.bands.DIV;
  if (!band) return null;
  const anchors = d.history.filter((r) => r[key] > 0).map((r) => [Date.UTC(r.year - 1, 11, 31), r[key]]).sort((a, b) => a[0] - b[0]);
  if (anchors.length < 2) return null;
  const fwd = (t) => {
    for (let i = 1; i < anchors.length; i++) {
      const [t0, v0] = anchors[i - 1], [t1, v1] = anchors[i];
      if (t >= t0 && t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
    return null;
  };
  const last = new Date(band.dates[band.dates.length - 1]);
  const start = Date.UTC(last.getUTCFullYear() - 4, last.getUTCMonth(), 1);
  const end = anchors[anchors.length - 1][0];
  // 월말 날짜 격자: 과거는 그달 마지막 주 종가, 이번 달은 최근 종가, 미래는 선만
  const months = [];
  for (let y = new Date(start).getUTCFullYear(), m = new Date(start).getUTCMonth(); ; m++) {
    const t = Date.UTC(y, m + 1, 0);
    if (t > end + 86400000 * 31) break;
    months.push(Math.min(t, end));
    if (t >= end) break;
  }
  const px = band.dates.map((s, i) => [Date.parse(s), band.price[i]]);
  const price = months.map((t) => {
    if (t > last.getTime() + 86400000 * 31) return null;
    let v = null;
    for (const [pt, p] of px) { if (pt <= t) v = p; else break; }
    return t > last.getTime() ? px[px.length - 1][1] : v;
  });
  const base = months.map(fwd);
  // 배수: 최근 5년 주간 선행 배수의 하위 10% ~ 상위 10%
  const cut = Date.UTC(last.getUTCFullYear() - 5, last.getUTCMonth(), last.getUTCDate());
  const ms = px.filter(([t]) => t >= cut).map(([t, p]) => { const b = fwd(t); return b ? p / b : null; }).filter((v) => v > 0).sort((a, b) => a - b);
  if (ms.length < 20) return null;
  const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  const lo = q(DASH.settings.band.low_pct / 100), hi = q(DASH.settings.band.high_pct / 100);
  const mults = [0, 1, 2, 3].map((i) => Number((lo + ((hi - lo) * i) / 3).toFixed(1)));
  const curT = last.getTime(), curB = fwd(curT);
  return { labels: months.map(ymd), price, base, mults, cur: curB ? px[px.length - 1][1] / curB : null, lo, hi, months, today: curT };
}
function nvBlock(id, title) {
  return `<div class="nv"><div class="nv-t">${title}</div><div class="chart-box nvbox"><canvas id="${id}"></canvas></div><div class="note" id="${id}-note"></div></div>`;
}
const nvCross = { id: "nvCross", afterDatasetsDraw(ch) {
  const a = ch.tooltip?.getActiveElements?.() || [];
  if (!a.length) return;
  const x = a[0].element.x, { top, bottom } = ch.chartArea, g = ch.ctx;
  g.save(); g.strokeStyle = css("--muted"); g.lineWidth = 1; g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); g.restore();
} };
function drawNv(id, d, key, kind) {
  const s = nvSeries(d, key), cv = document.getElementById(id);
  if (!cv) return;
  if (!s) { cv.parentElement.outerHTML = `<div class="empty">밴드를 그릴 실적 자료가 부족해요.</div>`; return; }
  const C = themeColors(), usd = d.currency === "USD";
  const fmt = (v) => (usd ? "$" + n(v, 2) : n(v) + " 원");
  const ds = s.mults.map((m, i) => ({ label: `${n(m, 1)}배`, data: s.base.map((b) => (b ? Math.round(b * m * (usd ? 100 : 1)) / (usd ? 100 : 1) : null)),
    borderColor: NV_COLORS[i], backgroundColor: NV_COLORS[i], borderWidth: 2.5, pointStyle: NV_STYLES[i][0], pointRotation: NV_STYLES[i][1], pointHoverRadius: 7 }));
  ds.push({ label: "수정주가", data: s.price, borderColor: "#2f6fdb", backgroundColor: "#2f6fdb", borderWidth: 3, pointStyle: "circle", pointHoverRadius: 7 });
  if (charts.has(id)) charts.get(id).destroy();
  charts.set(id, new Chart(cv, {
    type: "line", data: { labels: s.labels, datasets: ds }, plugins: [nvCross],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      elements: { point: { radius: 0, hitRadius: 6 }, line: { tension: 0 } },
      plugins: {
        legend: { position: "bottom", labels: { color: C.ink, boxWidth: 14, boxHeight: 3, padding: 8, font: { size: 12 },
          generateLabels: (ch) => ch.data.datasets.map((x, i) => ({ text: x.label, fillStyle: ch.isDatasetVisible(i) ? x.borderColor : C.grid,
            strokeStyle: "transparent", lineWidth: 0, hidden: false, fontColor: ch.isDatasetVisible(i) ? C.ink : C.muted, datasetIndex: i })) } },
        tooltip: { backgroundColor: C.surface, titleColor: C.ink, bodyColor: C.ink, borderColor: C.grid, borderWidth: 1, padding: 10,
          displayColors: false, titleFont: { size: 14, weight: "normal" }, bodyFont: { size: 14 },
          filter: (it) => it.parsed.y != null,
          callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)}`, labelTextColor: (c) => c.dataset.borderColor } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: C.axis || C.grid },
          ticks: { color: C.muted, autoSkip: false, maxRotation: 0, font: { size: 11 },
            callback(v) { const l = this.getLabelForValue(v); return l.slice(5, 7) === "01" && +l.slice(0, 4) % 2 === 0 ? l.slice(0, 7) + "/01" : ""; } } },
        y: { beginAtZero: true, grid: { color: C.grid }, border: { display: false },
          ticks: { color: C.muted, maxTicksLimit: 4, font: { size: 11 }, callback: (v) => (usd ? "$" + n(v) : n(v)) } },
      },
    },
  }));
  const pos = s.cur == null ? null : Math.max(0, Math.min(100, ((s.cur - s.lo) / (s.hi - s.lo)) * 100));
  $(`#${id}-note`).innerHTML = `지금 12개월 선행 ${kind} <b>${n(s.cur, kind === "PER" ? 1 : 2)}배</b> · 최근 5년 범위 ${n(s.lo, kind === "PER" ? 1 : 2)}~${n(s.hi, kind === "PER" ? 1 : 2)}배${pos == null ? "" : ` (아래에서 ${n(pos, 0)}% 위치)`}
    <br><span class="src">선 = 12개월 선행 ${key === "eps" ? "EPS" : "BPS"} × 배수 · 배수 = 최근 5년 선행 ${kind} 하위 ${DASH.settings.band.low_pct}% ~ 상위 ${100 - DASH.settings.band.high_pct}% 를 4등분 · 아래 이름을 누르면 선을 끄고 켤 수 있어요</span>`;
}

function detailHTML(d) {
  const c = d.card;
  const L = LIGHT[c.verdict] || LIGHT.na;
  let h = `<div class="card" style="margin-top:12px"><div class="light">${lamp(c.verdict)}<div>
      <div class="verdict ${c.verdict}">${L.stock} <span class="sub">${esc(c.why)}</span></div>
      <div class="big">${money(d.price, d.currency)}</div><div class="sub">${esc(d.price_date)} 종가 · 시가총액 ${bigWon(d.market_cap)} <span class="src">${esc(d.sources.price)}</span></div></div></div>
    <div class="kv"><div class="k">적정가 <span class="src">${esc(c.fair_basis)}</span></div><div class="v">${money(c.fair, c.currency)} (${c.gap == null ? "N/A" : pct(c.gap * 100, 0, true)})</div>
    <div class="k">12개월 선행 PER</div><div class="v">${times(c.fwd_per, 2)}</div>
    </div>${scenHTML(c)}`;
  if (bondAlert(c)) h += `<div class="warnbox">⚠ 금리 대비 비쌈: 선행 PER ${times(c.fwd_per, 1)}가 ${esc(c.bond_label)} 금리로 환산한 PER ${times(c.bond_per, 1)}보다 높아요 (주식 이익수익률이 채권 금리보다 낮음).</div>`;
  if (c.short_history) h += `<div class="warnbox">📅 ${esc((c.band_start || "").slice(0, 4))}년부터의 데이터만 있어요. 10년 평균은 가능한 기간으로 계산했어요.</div>`;
  if (c.rerating_warning) h += `<div class="warnbox">${esc(c.rerating_warning)}</div>`;
  for (const x of c.checks || []) {
    h += `<div class="note">${x.warn ? "⚠ " : "✓ "}${esc(x.item)}: ${n(x.a, x.dg || 0)} <span class="src">${esc(x.a_src)}</span> / ${n(x.b, x.dg || 0)} <span class="src">${esc(x.b_src)}</span>${x.warn ? " — 10% 이상 차이" : " — 일치"}</div>`;
  }
  h += `</div>`;

  h += `<h3>밴드차트</h3><div class="card">${nvBlock("nv-per", "PER 차트")}${nvBlock("nv-pbr", "PBR 차트")}</div>`;
  if (d.per && d.bands.PER) {
    const p = d.per;
    const cols = Object.keys(p.eps);
    h += `<h3>PER 적정주가</h3><div class="card">
      <h3 style="margin-top:0">선행 PER</h3><div class="kv">${cols.map((k) => `<div class="k">${k} PER <span class="src">EPS ${k} ${money(p.eps[k], d.currency)} · ${esc(d.sources.consensus)}</span></div><div class="v">${times(p.fwd_per[k], 2)}</div>`).join("")}</div>
      <h3>적정주가 시나리오 (EPS × PER)</h3>${matrixTable(p.matrix, cols, d.price, "PER ↓ · EPS →", null, d.currency)}
      ${p.rerating_warning ? `<div class="warnbox">${esc(p.rerating_warning)}</div>` : ""}</div>`;
  }
  if (d.pbr && d.bands.PBR) {
    const p = d.pbr;
    const cols = Object.keys(p.bps);
    h += `<h3>PBR 적정주가</h3><div class="card">
      <h3 style="margin-top:0">적정주가 (BPS × PBR)</h3>${matrixTable(p.matrix, cols, d.price, "PBR ↓ · BPS →")}
      <h3>ROE 와 PBR</h3><div class="kv">
        <div class="k">ROE 현재 <span class="src">${esc(p.roe_now_label)}</span></div><div class="v">${pct(p.roe_now)}</div>
        <div class="k">ROE 5년 평균</div><div class="v">${pct(p.roe5)}</div>
        <div class="k">ROE 10년 평균 <span class="src">${p.roe10_years}년치</span></div><div class="v">${pct(p.roe10)}</div>
        <div class="k">요구수익률 (국고채 3년 + ${DASH.settings ? "" : ""}위험 프리미엄)</div><div class="v">${pct(p.req_return, 2)}</div>
        <div class="k">적정 PBR ≈ ROE ÷ 요구수익률</div><div class="v">${times(p.fair_pbr, 2)}</div>
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
  drawNv("nv-per", d, "eps", "PER");
  drawNv("nv-pbr", d, "bps", "PBR");
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
  if (!h || !Object.keys(h.series).length) return "";
  const sgn = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "") + n(Math.abs(v), 2) + "%p";
  return `<h3>주요 주주 지분 변화 <span class="src">5% 이상 주주 · 1%p 이상 변동 시 공시</span></h3><div class="card">
    <div class="chart-box tall"><canvas id="holders-chart"></canvas></div><div id="holders-legend"></div>
    <div class="note src">지분 30% 넘는 최대주주는 차트에서 빼고 아래 표에만 보여 줘요.</div>
    <div class="chart-title">최근 지분 변동</div>
    <div class="tbl-wrap"><table class="compact orders"><thead><tr><th>공시일</th><th>주주 · 사유</th><th>변동</th></tr></thead><tbody>
    ${h.changes.slice(0, 12).map((x) => `<tr><td>${esc(x.date.slice(2))}</td>
      <td style="white-space:normal"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a><br><span class="src">${esc(x.reason)}</span></td>
      <td class="${x.chg_ratio < 0 ? "dear" : "cheap"}">${sgn(x.chg_ratio)}<br><span class="src">보유 ${n(x.ratio, 2)}%</span></td></tr>`).join("")}
    </tbody></table></div>
    <div class="note src">${esc(HOLDERS.source)} · ${esc(HOLDERS.updated_at)}</div></div>`;
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
const FLAG = { KR: "🇰🇷", US: "🇺🇸", EU: "🇪🇺", JP: "🇯🇵" };
async function peersBlock(code, noPbr) {
  if (!PEERS) {
    try { PEERS = await (await fetch("data/peers.json?t=" + encodeURIComponent(DASH.updated_at))).json(); }
    catch (e) { return ""; }
  }
  const gs = PEERS.groups.filter((g) => g.holdings.includes(code));
  // 미국 빅테크는 PBR 비교가 의미 없어서 PBR 열과 ROE-PBR 산점도를 뺀다
  return gs.map((g, gi) => {
    const warns = g.rows.filter((r) => r.warn && !noPbr).map((r) => `${esc(r.name)}: ${esc(r.warn)}`);
    return `<h3>동종업계 비교 · ${esc(g.name)}</h3><div class="card">
      <div class="tbl-wrap"><table class="compact"><thead><tr><th>회사</th><th>시총<br>(조원)</th><th>선행<br>PER</th>${noPbr ? "" : "<th>PBR</th>"}<th>ROE</th><th>배당</th></tr></thead><tbody>
      ${g.rows.map((r) => `<tr${r.code === code ? ' class="me"' : ""}><td>${FLAG[r.market] || ""} ${esc(r.name)}${r.stale ? " ⚠" : ""}</td>
        <td>${r.cap_krw == null ? "N/A" : n(r.cap_krw / 1e12, 1)}</td><td>${times(r.fwd_per)}</td>${noPbr ? "" : `<td>${times(r.pbr, 2)}</td>`}
        <td>${pct(r.roe)}</td><td>${pct(r.div, 2)}</td></tr>`).join("")}
      </tbody></table></div>
      ${noPbr ? `<div class="note">미국 빅테크는 PBR 이 의미가 적어서 PBR 비교는 뺐어요.</div>` : `<div class="chart-title">ROE(가로) vs PBR(세로) <span class="src">오른쪽 아래일수록 'ROE 에 비해 PBR 이 낮음'</span></div>
      <div class="chart-box tall"><canvas id="peer-scatter-${gi}"></canvas></div>
      <div id="peer-legend-${gi}"></div>`}
      <div class="note src">시총은 원화 환산(환율: 달러 ${n(PEERS.fx.USD, 0)} · 유로 ${n(PEERS.fx.EUR, 0)} · 엔 ${n(PEERS.fx.JPY, 2)}원) · 한국: 네이버 증권·와이즈리포트(선행 PER = 12개월 선행), ROE 는 최근 연간 실적 · 해외: 야후 파이낸스(선행 PER = 향후 12개월, ROE = 최근 12개월) · ${esc(PEERS.updated_at)}
      ${warns.length ? "<br>" + warns.join("<br>") : ""}</div></div>`;
  }).join("");
}
function drawPeers(code) {
  if (!PEERS) return;
  const C = themeColors();
  PEERS.groups.filter((g) => g.holdings.includes(code)).forEach((g, gi) => {
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
            grid: { color: C.grid }, ticks: { color: C.muted, callback: (v) => (logY && ![0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].includes(v) ? "" : v) } },
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
    $("#sheetBody").innerHTML = detailHTML(d) + brokerHtml + usedCar + orderHtml + holderHtml + peerHtml;
    drawDetailCharts(d);
    if (usedCar) wireManheim();
    drawOrders(code);
    drawHolders(code);
    drawPeers(code);
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
  return `<div class="seg" id="${id}-seg"><button data-y="0">역사적</button><button data-y="10" class="on">10년</button><button data-y="5">5년</button></div>
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
    ${(DASH.settings.kospi_notes || []).length ? `<div class="memo">📝 <b>증권사 코멘트 메모</b>${DASH.settings.kospi_notes.map((x) => `<br>· ${esc(x.text)} <span class="src">(${esc(x.source)}, ${esc(x.date)})</span>`).join("")}</div>` : ""}
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
  return `<h3>${title}</h3><div class="seg" id="${id}-seg"><button data-y="0">전체</button><button data-y="10">10년</button><button data-y="5" class="on">5년</button></div>
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

/* ---------- PBR 계산기 탭 ---------- */
let PBR = null;
async function loadPBR() {
  if (!PBR) {
    try { PBR = await (await fetch("data/pbr_watch.json?t=" + Date.now(), { cache: "no-store" })).json(); }
    catch (e) { $("#pbrCards").innerHTML = `<div class="empty">PBR 계산기 데이터를 불러오지 못했어요.</div>`; return; }
  }
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
  const band = it.band10 ? `<div class="note">10년 PBR 밴드: 하단 ${it.band10.low} · 평균 ${it.band10.avg} · 상단 ${it.band10.high}배 · 지금 위치 <b>${n(it.band10.pos, 0)}%</b> <span class="src">(직전 연도 실적 기준)</span></div>` : "";
  return `<div class="card">
    <div class="stock"><div class="row1"><span class="name">${esc(it.name)}</span><span class="price">${won(it.price)}</span></div></div>
    <div class="sub">${esc(it.date)} 기준 ${it.stale ? '<span class="stale">⚠ 직전 데이터</span>' : ""} · 최근 실적(${it.bps_last.year}) BPS ${n(it.bps_last.bps)} → PBR ${times(it.bps_last.pbr, 2)}</div>
    <div class="tbl-wrap"><table><thead><tr><th>구분</th>${ys.map((y) => `<th class="${cls(y)}">${y}</th>`).join("")}</tr></thead><tbody>
      <tr><td>BPS</td>${ys.map((y) => `<td class="${cls(y)}">${n(it.bps[y])}</td>`).join("")}</tr>
      <tr><td>현재 PBR</td>${ys.map((y) => `<td class="${cls(y)}">${pbrCell(it.pbr[y])}</td>`).join("")}</tr>
      ${it.rows.map((r) => `<tr><td>PBR ${mfmt(r.mult)}</td>${ys.map((y) => `<td class="${cls(y)} ${r.chg[y] != null && Math.abs(r.chg[y]) < 10 ? "hot" : ""}">${r.prices[y] == null ? "N/A" : n(r.prices[y])}<br><span class="src">${pct(r.chg[y], 0, true)}</span></td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    ${it.auto_multiples ? `<div class="note">배수는 10년 PBR 밴드의 하단·평균·상단을 자동으로 넣었어요.</div>` : ""}
    ${sum.length ? `<ul class="summary">${sum.map((s) => `<li>${s}</li>`).join("")}</ul>` : ""}
    ${it.alert ? (it.alert.hit
      ? `<div class="memo" style="background:var(--good-bg);color:var(--good-ink)">✅ 지금 ${esc(it.alert.year)} PBR <b>${it.alert.pbr}배</b> — ${it.alert.below}배 이하예요. <span class="src">(${esc(it.alert.text)})</span></div>`
      : `<div class="memo">🎯 ${esc(it.alert.year)} PBR ${it.alert.below}배 = <b>${n(it.alert.target_price)}원</b> (지금보다 ${pct(it.alert.gap, 1, true)}) · 지금 ${it.alert.pbr}배 <span class="src">(${esc(it.alert.text)})</span></div>`) : ""}
    ${band}
    <div class="calc"><input id="calc-${i}" inputmode="numeric" placeholder="가격을 넣어 보세요 (예: 200000)" aria-label="${esc(it.name)} 가격 입력"></div>
    <div class="calc-out" id="calc-out-${i}"></div>
    ${it.memo ? `<div class="memo">📝 ${esc(it.memo)}</div>` : ""}
    <div class="note src">${esc(it.source)} · 굵은 칸 = 지금 가격과 10% 이내 · 표의 %는 지금 가격 대비</div>
  </div>`;
}
function showView() {
  const view = { "#pbr": "pbr", "#watch": "watch", "#market": "market" }[location.hash] || "main";
  $("#pbrView").hidden = view !== "pbr";
  $("#marketView").hidden = view !== "market";
  if (view === "market") drawMarketCharts(); // 숨겨진 상태에서 그린 차트는 크기가 0이라 보일 때 다시 그림
  $("#watchView").hidden = view !== "watch";
  $("#mainView").hidden = view !== "main";
  document.querySelectorAll("#tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.view === view));
  if (view === "pbr") loadPBR();
  if (view === "watch") loadWatch();
}

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
function renderAll() {
  const s = DASH.status;
  $("#updated").textContent = `마지막 갱신 ${DASH.updated_at} (KST)`;
  const chip = $("#statusChip");
  chip.hidden = false;
  const nf = s.failures.length;
  chip.className = "status-chip" + (nf ? "" : " ok");
  chip.textContent = nf ? `⚠ 실패 ${nf}건` : "✓ 모두 정상";
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
  renderCards();
  kospiCard();
  spBand();
  const srcs = new Set();
  for (const r of Object.values(DASH.rates)) if (r?.source) srcs.add(r.source);
  for (const k of ["sp500_trailing", "sp500_forward", "kospi_forward"]) if (DASH.market[k]?.source) srcs.add(DASH.market[k].source.split(" (")[0]);
  ["네이버 증권", "와이즈리포트", "OpenDART"].forEach((x) => srcs.add(x));
  $("#footer").innerHTML = `<p><b>투자 판단 참고용</b>이에요. 매수·매도 추천이 아니며, 숫자는 출처의 사정으로 틀리거나 늦을 수 있어요.</p>
    <p>데이터 출처: ${[...srcs].map(esc).join(" · ")}</p>
    <p>마지막 갱신: ${esc(DASH.updated_at)} KST · 갱신 시각: 평일 07:30, 18:30</p>`;
}

async function load() {
  try {
    const r = await fetch("data/dashboard.json?t=" + Date.now(), { cache: "no-store" });
    DASH = await r.json();
  } catch (e) {
    $("#updated").textContent = "데이터를 불러오지 못했어요";
    return;
  }
  renderAll();
  route();
}

$("#stockCards").addEventListener("click", (e) => {
  const b = e.target.closest(".stock"); if (!b) return;
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
