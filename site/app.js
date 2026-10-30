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
  // Bear = 하방(이 정도면 바닥, 더 빠지면 안전마진) · Base = 적정주가(평균) · Bull = 최대(금리가 다시 내려갈 때)
  const pts = [["bear", "Bear", "하방"], ["base", "Base", "적정주가"], ["bull", "Bull", "최대"]];
  const bar = (v) => {  // 하방·적정·최대·지금 위치 막대 (보는 칸마다 눈금을 다시 잡음)
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
    <div data-sm-box="now"${m0 === "now" ? "" : " hidden"}>${bar(s)}${scenBoxes(s, s.parts)}</div>
    ${bv ? `<div data-sm-box="bull"${m0 === "bull" ? "" : " hidden"}>${bar(bv)}${scenBoxes(bv, bparts)}<div class="note src">🐂 금리가 내려가 돈이 풀릴 때 · 성장률 × 1.5 · 1.75 · 2 (업종·밴드 PER 은 보통 · 1.5배 · 2배)</div></div>` : ""}
    ${regLine}
    ${s.y2 ? `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:6px">📅 ${esc(s.y2.label)} 기준 <span class="src">같은 배수 × ${baseOf(s.y2.parts, s.y2.label)}${c.notes?.y2?.length ? ` · 🗒 메모 ${c.notes.y2.length}` : ""}</span></summary>${scenBoxes(s.y2, s.y2.parts)}${notesHTML(c.notes?.y2, c, s.y2)}</details>` : ""}
    ${multHTML(s)}
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
// 배수를 어떻게 정했는지 한 줄 (성장률 × 1·1.5·2 / 업종 PER / 10년 밴드)
function multHTML(s) {
  const r = s.sa_ref, ref = r && (r["5y"] != null || r.sector != null)  // 시킹알파 같은 줄의 참고값
    ? ` <span style="opacity:.8">(참고: 이 종목 5년 평균 ${r["5y"] == null ? "-" : n(r["5y"], 1) + "%"} · 업종 중앙값 ${r.sector == null ? "-" : n(r.sector, 1) + "%"})</span>` : "";
  return (s.parts || []).map((p) => {
    const m = p.mult, d = p.kind === "PBR" ? 2 : 1;
    const NM = { bear: "하방", base: "적정주가", bull: "최대", bm_lo: "강세장 하방", bm_hi: "강세장 상방" };
    const cap = p.capped ? `<div class="warnbox" style="margin-top:4px">⚠ 12MF PER ${p.capped.max}배가 넘는 칸은 의미가 없다고 봐서 ${p.capped.max}배로 다시 계산했어요 — 원래 ${Object.entries(p.capped.from).map(([k, v]) => `${NM[k] || k} ${n(v, 1)}배`).join(" · ")}</div>` : "";
    return `<div class="note src">📐 ${p.kind} ${n(m.bear, d)} · ${n(m.base, d)} · ${n(m.bull, d)}배 = ${esc(p.how || p.src)}${p.kind === "PER" && /성장률/.test(p.how || "") ? ref : ""}</div>${cap}`;
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
  if (sec) out.push(`<div class="note src">🏷 ${esc(sec.name)} PER 역사: 바닥 ${n(sec.bear, 1)} · 보통 ${n(sec.base, 1)} · 최고 ${n(sec.bull, 1)}배${sec.history ? ` — ${esc(sec.history)}` : ""}</div>`);
  (sec?.notes || []).forEach((x) => out.push(`<div class="note src">📝 ${esc(x.date)} ${esc(x.source)}: ${esc(x.text)}</div>`));
  if (ind && (ind.per || ind.peer_med)) out.push(`<div class="note src">🏭 네이버 업종 PER${ind.wics ? ` (WICS ${esc(ind.wics)})` : ""}: 최근 4분기 ${ind.per == null ? "-" : n(ind.per, 1) + "배"}${ind.peer_med ? ` · 같은 업종 ${ind.peers.length}곳 중앙값 <b>${n(ind.peer_med, 1)}배</b> (${ind.peers.filter((p) => p.per).map((p) => `${esc(p.name)} ${n(p.per, 1)}${p.fwd ? "" : "*"}`).join(" · ")})` : ""}${ind.peers.some((p) => p.per && !p.fwd) ? " <span>* 추정치 없어 현재 PER</span>" : ""}</div>`);
  if (s.rerating) out.push(`<div class="note src">🔁 리레이팅: ${esc(s.rerating)}</div>`);
  return warn + (out.length ? `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:6px">🏷 업종 PER · 리레이팅 메모</summary>${out.join("")}</details>` : "");
}
// 성장률 방식 (내 엑셀 '소몽의 적정주가 템플릿'): 성장률 = EPS 전년 대비 성장률 중앙값, PER = 성장률 × 1 / 1.5 / 2
function growthHTML(c) {
  const g = c.scen?.growth;
  if (!g) return "";
  const usd = c.currency === "USD";
  const fmtE = (v) => (v == null ? "-" : usd ? n(v, 2) : n(v));
  const fmtP = (v) => (v == null ? "-" : usd ? "$" + n(v, 0) : n(v));
  const e27 = c.scen.e27, alt = c.scen.alt;
  const warn = alt ? `<div class="warnbox" style="margin-top:6px">⚠ 과거 성장률과 앞으로 예상 성장률이 2배 넘게 달라요. 다른 쪽(${n(alt.g, 1)}%)으로 계산하면
    Bear ${fmtP(alt.bear)} · <b>Base ${fmtP(alt.base)}</b> (${pct((alt.base / c.price - 1) * 100, 0, true)}) · Bull ${fmtP(alt.bull)}</div>` : "";
  return `<details class="fvt" onclick="event.stopPropagation()"><summary class="chart-title" style="margin-top:6px">🔎 성장률 계산 자세히 <span class="src">출처 · 연도별</span>${alt ? ' <span class="pill yellow">⚠ 성장률 차이 큼</span>' : ""}${c.scen.ltg_cmp && (saAge(c) == null || saAge(c) > 90) ? ' <span class="pill red">🔴 시킹알파 갱신 필요</span>' : ""}</summary>${warn}
    ${waysHTML(c, fmtP)}
    <div class="note">쓴 성장률: <b>${esc(g.src)}</b></div>
    <div class="note">기본값(${esc(g.window)} EPS 성장률 중앙값) <b>${g.median == null ? "-" : n(g.median, 1) + "%"}</b> · 보정값 ${g.adj == null ? "-" : `<b>${n(g.adj, 1)}%</b> <span class="src">${esc(g.adj_src || "")}</span>`}</div>
    <div class="tbl-wrap"><table class="compact" style="margin-top:6px"><thead><tr><th style="text-align:left">EPS</th>${g.years.map((y) => `<th>${esc(y)}</th>`).join("")}</tr></thead><tbody>
      <tr><td>EPS</td>${g.eps.map((v) => `<td>${fmtE(v)}</td>`).join("")}</tr>
      <tr><td>성장률</td>${g.yoy.map((v) => `<td class="${v != null && v < 0 ? "dear" : ""}">${v == null ? "-" : n(v, 0) + "%"}</td>`).join("")}</tr></tbody></table></div>
    <table class="compact" style="width:100%;margin-top:6px"><thead><tr><th style="text-align:left">적정 PER</th><th>배수</th><th>× 12MF EPS</th>${e27 ? "<th>× 27E EPS</th>" : ""}</tr></thead><tbody>
      ${[["Bear 하방 (× 1)", "bear"], ["Base 적정주가 (× 1.5)", "base"], ["Bull 최대 (× 2)", "bull"]].map(([l, k]) => `<tr><td>${l}</td><td style="text-align:right">${n(g.mult[k], 1)}배${g.raw && g.raw[k] !== g.mult[k] ? `<br><span class="src">성장률로는 ${n(g.raw[k], 1)}</span>` : ""}</td>
        <td style="text-align:right"><b>${fmtP(c.scen[k])}</b></td>${e27 ? `<td style="text-align:right">${fmtP(e27[k])}</td>` : ""}</tr>`).join("")}</tbody></table>
    ${c.eps_srcs && Object.keys(c.eps_srcs).length ? `<div class="chart-title" style="margin-top:8px"><b>EPS 추정치 출처</b> <span class="src">시킹알파(유료) 대신 받을 수 있는 출처들의 평균을 써요</span></div>
      <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">연도</th>${["야후", "나스닥", "Finviz", "평균"].map((k) => `<th>${k}</th>`).join("")}</tr></thead><tbody>
      ${Object.entries(c.eps_srcs).map(([y, s]) => `<tr><td>${esc(y)}${s.note ? " ⚠" : ""}</td>${["야후", "나스닥", "Finviz", "평균"].map((k) => `<td${k === "평균" ? ' style="font-weight:700"' : ""}>${s[k] == null ? "-" : n(s[k], 2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${Object.values(c.eps_srcs).some((s) => s.note) ? `<div class="note src">⚠ = 출처끼리 15% 넘게 달라서 평균 대신 야후 값을 썼어요 (일회성 이익 포함 여부 등 기준 차이)</div>` : ""}` : ""}
    <div class="note src">내 엑셀 방식: 하방 = 성장률 × 1 (더 빠지면 안전마진), 적정주가 = × 1.5, 최대 = × 2 (금리가 다시 내려갈 때) · 한국은 컨센서스 3년 영업이익 성장률, 미국은 3~5년 EPS 성장률 · 성장률로 잡은 하방이 지금 가격보다 50% 넘게 높으면 성장률이 너무 센 것이라 업종 PER(없으면 이 종목 PER 밴드) · PER·PBR 을 같이 보는 종목은 PBR 밴드 값과 평균</div>
  </details>`;
}
// 내 엑셀의 적정주가 방법 4가지를 나란히: ① 기본값 ② 보정값 ③ Finviz (성장률 × 1 / 1.5 / 2) ④ 내가 정한 PER (somong.yaml my.my_per)
function waysHTML(c, fmtP) {
  const w = c.scen?.ways, e12 = c.scen?.e12;
  if (!w || !e12) return "";
  const my = smData(c)?.my || {};
  const up = (v) => (v == null ? "" : ` <em class="${v >= c.price ? "up" : "dn"}">${pct((v / c.price - 1) * 100, 0, true)}</em>`);
  const rows = w.map((x, i) => `<tr${x.used ? ' style="font-weight:700"' : ""}><td style="text-align:left">${"①②③"[i]} ${esc(x.name)}${x.used ? " ✔" : ""}<div class="src">${esc(x.src)}</div></td>
    <td>${x.g == null ? "-" : n(x.g, 1) + "%"}</td>${["bear", "base", "bull"].map((k) => `<td>${x[k] == null ? "-" : fmtP(x[k]) + up(x[k])}</td>`).join("")}</tr>`).join("");
  const mp = my.my_per ? e12 * my.my_per : null;
  const mine = `<tr><td style="text-align:left">④ 내가 정한 PER<div class="src">${my.my_per ? esc(my.my_per_note || "") : "config/somong.yaml 의 my.my_per 에 적으면 나와요"}</div></td>
    <td>${my.my_per ? n(my.my_per, 0) + "배" : "-"}</td><td colspan="3">${mp ? `<b>${fmtP(mp)}</b>${up(mp)}` : "-"}</td></tr>`;
  const sa = (c.scen.ltg_cmp || [])[0]?.[1];
  const cmp = (c.scen.ltg_cmp || []).length ? `<div class="note">3~5년 EPS 성장률 출처 비교: ${c.scen.ltg_cmp.map(([k, v], i) => `${esc(k)} <b>${v == null ? "-" : n(v, 1) + "%"}</b>${i && v != null && sa != null ? ` <span class="src">(시킹알파와 ${v - sa >= 0 ? "+" : ""}${n(v - sa, 1)}%p)</span>` : ""}`).join(" · ")}</div>` : "";
  const age = saAge(c);
  const stale = c.scen.ltg_cmp ? (sa == null ? `<div class="warnbox" style="margin-top:6px">⚠ <b>시킹알파 값이 비어 있어요.</b> 시킹알파 → ${esc(c.code)} → Growth 탭 'EPS FWD Long Term Growth (3-5Y CAGR)' 숫자를 config/somong.yaml 의 sa_ltg 에 적어 주세요.</div>`
    : age > 90 ? `<div class="warnbox" style="margin-top:6px;border-color:var(--bad);background:var(--bad-bg)">🔴 <b>시킹알파 값 갱신 필요!</b> 마지막 확인 ${esc(c.scen.sa_date)} (${age}일 전) — 한 분기가 지났어요. 실적 발표 뒤 바뀌었을 수 있으니 Growth 탭에서 다시 확인해 주세요.${(c.scen.ways || []).some((w) => w.name === "보정값" && /대체/.test(w.src)) ? " 그동안은 평소 시킹알파와 가장 가까웠던 출처로 대신 계산하고 있어요." : ""}</div>`
    : `<div class="note src">시킹알파 값 확인일 ${esc(c.scen.sa_date || "-")} (${age ?? "-"}일 전) · 90일이 지나면 빨간 표시로 갱신하라고 알려줘요</div>`) : "";
  return `${stale}<div class="chart-title" style="margin-top:8px"><b>적정주가 4가지 비교</b> <span class="src">12MF EPS ${fmtP(e12)} 기준 · ✔ = 위 Bear/Base/Bull 에 쓴 방법 · 업종 PER 로 바꾸기 전 값${(c.scen.parts || []).length > 1 ? " (위 값은 PBR 밴드와 평균이라 다를 수 있어요)" : ""}</span></div>
    <div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">방법</th><th>성장률</th><th>Bear ×1</th><th>Base ×1.5</th><th>Bull ×2</th></tr></thead><tbody>${rows}${mine}</tbody></table></div>${cmp}${c.scen.ltg_note ? `<div class="note src">${esc(c.scen.ltg_note)}</div>` : ""}`;
}
// 시킹알파 3-5Y 성장률을 마지막으로 확인한 뒤 지난 날 수 (직접 입력값이라 분기마다 갱신 필요)
function saAge(c) {
  const d = c.scen?.sa_date;
  return d ? Math.floor((Date.now() - new Date(d + "T00:00:00+09:00")) / 864e5) : null;
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
  if (c.insider?.exec_buyers) pills.push(`<span class="pill green">👀 임원 ${c.insider.exec_buyers}명 장내매수 (3개월)</span>`);
  if (c.kq_new) pills.push(`<span class="pill green">🧾 ${esc(c.kq_new)} 실적 나옴</span>`);
  if (c.kq_wait) pills.push(`<span class="pill yellow">🧾 ${esc(c.kq_wait)} 잠정실적 공시 · 숫자 반영 대기</span>`);
  for (const x of c.holder_changes || []) {
    pills.push(`<span class="pill ${x.chg < 0 ? "red" : "green"}">👥 ${esc(x.name.replace("공단", ""))} 지분 ${x.chg < 0 ? "▼" : "▲"}${n(Math.abs(x.chg), 2)}%p (${esc(x.date.slice(5))})</span>`);
  }
  if ((c.checks || []).some((x) => x.warn)) pills.push(`<span class="pill yellow">⚠ 출처 간 EPS 차이 큼</span>`);
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
  return `<button class="card stock" data-code="${esc(c.code)}">
    <div class="row1"><span class="name">${esc(c.name)}</span><span class="price">${money(c.price, c.currency)}</span></div>
    ${pe.map((x) => `<div class="pe">${x}</div>`).join("")}
    <div class="sub">시가총액 ${capTxt(c)} ${c.stale ? '<span class="stale">⚠ 직전 데이터</span>' : ""}</div>
    <div class="row2">${lamp(c.verdict)}<div>
      <div class="verdict ${c.verdict}">${L.stock}</div>
      <div class="why">${esc(c.why)}</div></div></div>
    ${c.scen ? scenHTML(c) : `<div class="kv">
      <div class="k">적정가 <span class="src">${esc(c.fair_basis)}</span></div><div class="v">${money(c.fair, c.currency)}</div>
      <div class="k">괴리율 <span class="src nowrap">현재가 ÷ 적정가 − 1</span></div><div class="v">${gap}</div>
    </div>`}
    ${divSaHTML(c)}
    ${c.scen ? `<div class="chart-title" style="margin-top:14px"><b>② 지난 10년 밴드에서 지금 위치</b> <span class="src">0% = 10년 중 가장 싼 쪽 · 100% = 가장 비싼 쪽</span></div>` : ""}
    <div class="bandbar">${pos == null ? "" : `<span class="dot" style="left:${Math.max(0, Math.min(100, pos))}%"></span>`}</div>
    <div class="bandlbl"><span>밴드 하단 0%</span><span>10년 밴드 위치 ${pos == null ? "N/A" : n(pos, 0) + "%"}</span><span>상단 100%</span></div>
    ${somongHTMLcard(c)}
    ${tipranksHTML(c)}
    ${streetHTML(c)}
    ${readerHTML(c)}
    ${fairTableHTML(c)}
    ${somongHTML(c)}
    ${priceBox(c, 6, "span")}
    ${mine}
    <div class="pills">${pills.join("")}</div>
  </button>`;
}
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
}

/* ---------- 보유종목 비교표 (구글 시트처럼: 머리글 눌러 정렬, 산업별 보기, 묶음별 칸) ---------- */
const CMP = { group: "sum", ind: "전체", sort: "cap", dir: -1 };
try { Object.assign(CMP, JSON.parse(localStorage.getItem("cmp") || "{}")); } catch (_) {}
function cmpCols() {
  const ys = (DASH.stocks.find((c) => c.tbl && c.tbl.years) || {}).tbl?.years || ["25", "26E", "27E", "28E"];
  const t = (k, i) => (c) => (c.tbl ? (i == null ? c.tbl[k] : (c.tbl[k] || [])[i]) : null);
  const G = (v) => (v == null ? "-" : `<span class="${v < 0 ? "neg" : ""}">${pct(v, 0, true)}</span>`);
  const P = (d) => (v) => (v == null ? "-" : n(v, d));
  const R = (d) => (v) => (v == null ? "-" : `<span class="${v < 0 ? "neg" : ""}">${n(v, d)}%</span>`);
  const arrow = (i) => `${ys[i]}→${ys[i + 1]}`;
  // 🇺🇸 탭은 모두 $B: 순현금은 달러 원본(cash_raw), 없으면 원화 값을 수집 때 환율로 되돌림
  const usd = MKT === "US", Bn = (v) => (v == null ? "-" : `<span class="${v < 0 ? "neg" : ""}">${n(v, 1)}</span>`);
  const ncUsd = (s, xl) => { const r = s.tbl?.cash_raw, v = s.tbl?.[xl ? "net_cash_xl" : "net_cash"];
    return r ? (r.cash + r.sti - r.debt + (xl ? r.lease : 0)) / 1e9 : v != null && DASH.fx ? v / DASH.fx / 1e9 : null; };
  const c = {
    cap: usd ? { h: "시총<br>($B)", v: (s) => (s.market_cap_usd ? s.market_cap_usd / 1e9 : null), f: P(0) }
      : { h: "시총<br>(조원)", v: (s) => (s.market_cap ? s.market_cap / 1e12 : null), f: P(1) },
    salesC: { h: `매출<br>3년 연평균`, v: t("sales_cagr"), f: G },
    opC: { h: `영업이익<br>3년 연평균`, v: t("op_cagr"), f: G },
    epsC: { h: `EPS<br>3년 연평균`, v: t("eps_cagr"), f: G },
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
  ["grow", "성장", ["salesC", "sg0", "sg1", "sg2", "opC", "og0", "og1", "og2", "epsC"]],
  ["qual", "수익성", ["gpm0", "opm0", "opm1", "opm2", "opm3", "roe0", "roe1", "roe2", "roic", "roicT", "roicE0", "roicE1"]],
  ["val", "밸류", ["per12", "peg", "per0", "per1", "per2", "pbr0", "pbr1", "pbr2", "psr", "pf0", "pf1", "pf2", "pf3"]],
  ["fin", "재무·배당", ["nc", "ncp", "ncx", "fcfT", "fcfY", "fcf0", "fcf1", "fcf2", "debt0", "debt1", "debt2", "debt3", "dy0", "dy1", "dd"]],
  ["som", "소몽", ["smS", "sm_wallet", "sm_oligopoly", "sm_anyone_wins", "sm_good_boss", "sm_giant", "ath", "nev"]],
  ["all", "전체", null],
];
// 미국은 무료로 받을 수 있는 숫자가 달라서 (추정은 EPS·매출 위주, 나머지는 최근 실적) 칸 구성을 따로
const CMP_GROUPS_US = [
  ["sum", "요약", ["cap", "sg0", "sg1", "epsC", "per12", "peg", "gpm0", "opm0", "roic", "roicE1", "ncx", "fcfT", "fcfY", "dy0", "dd"]],
  ["grow", "성장", ["sg0", "sg1", "epsC"]],
  ["qual", "수익성", ["gpm0", "gpm1", "gpm2", "opm0", "roe0", "roic", "roicT", "roicE0", "roicE1"]],
  ["val", "밸류", ["per12", "peg", "per0", "per1", "per2", "pbr0", "psr"]],
  ["fin", "재무·배당", ["nc", "ncp", "ncx", "ncxp", "fcfT", "fcfY", "fcf0", "fcf1", "fcf2", "debt0", "dy0", "dd"]],
  ["som", "소몽", ["smS", "sm_wallet", "sm_oligopoly", "sm_anyone_wins", "sm_good_boss", "sm_giant", "ath", "nev"]],
  ["all", "전체", null],
];
function renderCmp() {
  const cols = cmpCols();
  const GROUPS = MKT === "US" ? CMP_GROUPS_US : CMP_GROUPS;
  const g = GROUPS.find((x) => x[0] === CMP.group) || GROUPS[0];
  const raw = g[2] || [...new Set(GROUPS.slice(0, -1).flatMap((x) => x[2]))];
  const sepAt = new Set(raw.map((k, i) => (i && raw[i - 1] === "|" ? i - raw.slice(0, i).filter((x) => x === "|").length : -1)));  // 구분선 칸 위치
  const keys = raw.filter((k) => k !== "|");
  if (!keys.includes(CMP.sort) && CMP.sort !== "name" && CMP.sort !== "ind") CMP.sort = keys[0];
  const mine = DASH.stocks.filter((s) => grp(s) === "보유" && (s.market === "US" ? "US" : "KR") === MKT);
  const inds = ["전체", ...new Set(mine.map((s) => s.industry).filter(Boolean))];
  if (!inds.includes(CMP.ind)) CMP.ind = "전체";
  $("#cmpGroup").innerHTML = GROUPS.map(([k, l]) => `<button data-g="${k}" class="${k === g[0] ? "on" : ""}">${l}</button>`).join("");
  $("#cmpInd").innerHTML = inds.map((x) => `<button data-i="${esc(x)}" class="chip ${x === CMP.ind ? "on" : ""}">${esc(x)}</button>`).join("");
  let rows = mine.filter((s) => CMP.ind === "전체" || s.industry === CMP.ind);
  const val = (s) => (CMP.sort === "name" ? s.name : CMP.sort === "ind" ? s.industry || "" : cols[CMP.sort].v(s));
  const us = (s) => (s.market === "US" ? 1 : 0);
  rows = rows.sort((a, b) => {
    if (us(a) !== us(b)) return us(a) - us(b); // 한국 먼저, 미국은 아래에 따로
    const x = val(a), y = val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1; // 빈 칸은 정렬 방향과 상관없이 맨 아래
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * CMP.dir;
  });
  const th = (k, h, i) => `<th data-k="${k}" class="${CMP.sort === k ? "on" : ""}${sepAt.has(i) ? " sep" : ""}">${h}${CMP.sort === k ? (CMP.dir > 0 ? " ▲" : " ▼") : ""}</th>`;
  $("#cmpTable").innerHTML = `<table class="cmp"><thead><tr>${th("name", "종목")}${th("ind", "산업")}${keys.map((k, i) => th(k, cols[k].h, i)).join("")}</tr></thead>
    <tbody>${rows.map((s) => `<tr data-code="${esc(s.code)}"><td>${esc(s.name)}</td><td class="ind">${esc(s.industry || "")}</td>
      ${keys.map((k, i) => `<td${sepAt.has(i) ? ' class="sep"' : ""}>${cols[k].f(cols[k].v(s), s)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  $("#cmpNote").innerHTML = `머리글을 누르면 정렬 (한 번 더 누르면 반대로) · 종목을 누르면 상세 화면 · 3년 연평균 = 25년 실적 → 28년 추정 ·
    PEG = 12MF PER ÷ EPS 3년 연평균 성장률(%) (1 아래면 성장에 비해 싼 편, 피터 린치 기준) · * = 이익이 크게 출렁이는 업종이라 PER·PEG 가 실제보다 싸 보일 수 있음 ·
    P/FCF = 지금 시가총액 ÷ 그해 잉여현금흐름 (25 = 확정 실적) · PSR = 시가총액 ÷ 올해 예상 매출 · 순현금 = 현금·단기투자 − 총차입금(최근 분기, 야후) · GPM·ROIC·FCF = 야후 연간 실적 ·
    ${MKT === "US" ? "미국: 추정치는 야후·나스닥 컨센서스(EPS·매출), 나머지는 최근 실적 · 25 PER 은 지금 주가 ÷ 작년 EPS" : "25 PER·PBR 은 그해 말 주가, 26E·27E 는 지금 주가 기준"}`;
  try { localStorage.setItem("cmp", JSON.stringify(CMP)); } catch (_) {}
}
$("#cmpGroup")?.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; CMP.group = b.dataset.g; renderCmp(); });
$("#cmpInd")?.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; CMP.ind = b.dataset.i; renderCmp(); });
$("#cmpTable")?.addEventListener("click", (e) => {
  const h = e.target.closest("th");
  if (h) { const k = h.dataset.k; CMP.dir = CMP.sort === k ? -CMP.dir : (k === "name" || k === "ind" ? 1 : -1); CMP.sort = k; renderCmp(); return; }
  const r = e.target.closest("tr[data-code]");
  if (r) location.hash = `#stock/${r.dataset.code}`;
});

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
      ${past?.score != null ? `<span class="src">(25.4.7 당시 ${past.score}점)</span>` : ""}<div class="smchips">${chips}</div></summary>
    ${s ? `<div class="note src">점수 = 100 − X 1개당 10 − △ 1개당 5 (지갑털이·올리고폴리·아무나이겨라) + 굿보스·거인의 어깨 5 · 강의 기준: 90점 넘으면 투자 고려 · 조사일 ${esc(s.checked_at || "")}</div>
      ${reason("wallet", "지갑털이 (내 돈·시간을 점점 더 가져가나)")}${reason("oligopoly", "올리고폴리 (1~3위 합 50% 이상)")}${reason("anyone_wins", "아무나이겨라 (누가 이기든 돈 버나)")}
      ${reason("good_boss", "굿보스 (믿을 만한 경영자)")}${reason("giant", "거인의 어깨 (큰 기관·거물 보유)")}
      ${past ? `<div class="note">🕰 25.4.7 당시 내 판단: 지갑 ${esc(past.wallet || "-")} · 올리고 ${esc(past.oligopoly || "-")} · 아무나 ${esc(past.anyone_wins || "-")} · 굿보스/거인 ${esc(past.boss || "-")} · ${esc(past.score ?? "-")}점${past.season ? " · " + esc(past.season) : ""}${past.range ? " · 하방~상방 " + esc(past.range) : ""}${past.greed ? " · 욕망시 " + esc(past.greed) : ""}</div>` : ""}` : ""}
    ${ladder}${ev}${dv}${mine}
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
// 막대(값) + 선(%) 미니 차트. 음수 막대는 빨강, 마지막 분기는 진하게
function qPanel(title, tag, labels, bars, line, usd, color, est = null) {  // est: 칸마다 추정(E) 여부 → 회색, 강조는 마지막 실적 칸
  const W = 300, x0 = 14, bw = (W - 2 * x0) / labels.length, li = est ? est.lastIndexOf(false) : bars.length - 1;
  const vals = bars.filter((v) => v != null), hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
  const top = line ? 78 : 40, bot = lo < 0 ? 138 : 150, sc = (bot - top) / ((hi - lo) || 1), zero = top + hi * sc;  // 음수 막대 글자 자리
  let g = `<line x1="${x0}" x2="${W - x0}" y1="${zero}" y2="${zero}" stroke="var(--axis)"/>`;
  bars.forEach((v, i) => {
    const cx = x0 + bw * i + bw / 2, last = i === li;
    g += `<text x="${cx}" y="166" text-anchor="middle" class="qx">${esc(labels[i])}</text>`;
    if (v == null) return;
    const y = v >= 0 ? zero - v * sc : zero, h = Math.max(1, Math.abs(v) * sc);
    g += `<rect x="${cx - bw * 0.32}" y="${y}" width="${bw * 0.64}" height="${h}" rx="2" fill="${v < 0 ? "var(--bad)" : est?.[i] ? "var(--axis)" : color}" opacity="${last || est?.[i] ? 1 : 0.55}"/>`;
    g += `<text x="${cx}" y="${v >= 0 ? y - 4 : y + h + 11}" text-anchor="middle" class="qv${last ? " b" : ""}">${qMoney(v, usd)}</text>`;
  });
  if (line) {
    const lv = line.filter((v) => v != null), lh = Math.max(...lv), ll = Math.min(...lv), ls = 34 / ((lh - ll) || 1);
    const pts = line.map((v, i) => (v == null ? null : [x0 + bw * i + bw / 2, 56 - (v - ll) * ls]));
    const seg = pts.filter(Boolean);
    if (seg.length > 1) g += `<polyline points="${seg.map((p) => p.join(",")).join(" ")}" fill="none" stroke="var(--ink)" stroke-width="2"/>`;
    pts.forEach((p, i) => { if (p) g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/><text x="${p[0]}" y="${p[1] - 8}" text-anchor="middle" class="qv${i === li ? " b hi" : ""}"${line[i] < 0 ? ' style="fill:var(--bad-ink)"' : ""}>${n(line[i], 0)}%</text>`; });
  }
  return `<div class="qp"><div class="qt"><b>${title}</b>${qTag(tag)}</div><svg viewBox="0 0 ${W} 172" role="img" aria-label="${esc(title)}">${g}</svg></div>`;
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
  const P = ps.slice(-5), W = 300, x0 = 14, bw = (W - 2 * x0) / P.length, top = 14, bot = 150;
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
      if (last && ev != null) g += bar(cx - bw * 0.21, bw * 0.38, ev, "var(--axis)") + lab(cx, ly(ev), ev, "qv", "var(--muted)");
      return;
    }
    if (q.est) { g += bar(cx, bw * 0.5, q[f], "var(--axis)") + lab(cx, ly(q[f]), q[f], "qv", "var(--muted)"); return; }
    if (last && ev != null) {  // 예상(회색) vs 실적(색) 막대 나란히 — 숫자는 칸 가운데에 위아래로 (옆 칸과 안 겹치게)
      let ye = ly(ev), ya = ly(q[f]);
      if (Math.abs(ye - ya) < 12) { if (ya <= ye) ya = ye - 12; else ye = ya - 12; }
      g += bar(cx - bw * 0.21, bw * 0.38, ev, "var(--axis)") + bar(cx + bw * 0.21, bw * 0.38, q[f], color)
        + lab(cx, ye, ev, "qv", "var(--muted)") + lab(cx, ya, q[f], "qv b", color);
    } else g += bar(cx, bw * 0.5, q[f], last ? color : "var(--grid)") + lab(cx, ly(q[f]), q[f], last ? "qv b" : "qv", last ? (q[f] < 0 ? "var(--bad)" : color) : null);
  });
  const s = ev != null && ev > 0 && qs[li]?.[f] != null ? (qs[li][f] / ev - 1) * 100 : null;  // 마지막 실적 분기 (뒤에 예상 E 가 붙어도)
  const tag = s == null ? "" : `<span class="qtag${s < 0 ? " bad" : ""}">예상대비 ${s >= 0 ? "+" : ""}${n(s, 1)}%</span>`;
  return `<div class="qp"><div class="qt"><b>${title} <span class="src">${unit}</span></b>${tag || opt.tag || ""}</div>${opt.sub ? `<div class="src">${opt.sub}</div>` : ""}<svg viewBox="0 0 ${W} 172" role="img" aria-label="${esc(title)}">${g}</svg>
    ${ev != null || qs.some((q) => q.est) ? `<div class="src" style="text-align:right;padding:0 4px 4px"><span style="color:var(--axis)">■</span> ${ev != null ? "예상(컨센서스)" : "추정(E)"} · <span style="color:${color}">■</span> 실적</div>` : ""}</div>`;
}
// 분기 / 연간 실적 막대 — 한국은 영업이익을 맨 앞에 (연간 = 와이즈리포트 연간 실적 + 추정 E)
const KQ_MAP = {};
function kqCharts(k, mode) {
  // 분기 보기: 최근 5분기 실적 + 다음 분기들 예상(E, 와이즈리포트) — 연간 보기처럼 8칸
  const a = mode === "y" && k.annual?.length, qs = a ? k.annual.slice(-8) : k.fwd?.length ? k.quarters.slice(-5).concat(k.fwd) : k.quarters;
  const u = a ? "연간" : "분기", est = a ? null : k.est_bar;
  // 한국·미국 모두 매출액 → 영업이익 → EPS (연간은 EPS 대신 순이익) — 자료가 있는 항목만
  const order = [["sales", "매출액", "var(--s1)"], ["op", "영업이익", "var(--good)"], a ? ["ni", "순이익", "var(--s3)"] : ["eps", "EPS", "var(--s3)"]];
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
// 실적 · 예상 · 예상 대비 · QoQ · YoY 표 (상세 화면과 첫 화면 '🧾 실적 발표' 같이 씀)
function kqTable(k) {
  const P = (v) => (v == null ? "-" : `<span class="${v < 0 ? "neg" : ""}">${v >= 0 ? "+" : ""}${n(v, 1)}%</span>`);
  return `<div class="tbl-wrap"><table class="compact"><thead><tr><th style="text-align:left">${esc(k.latest)}${k.prelim ? " 잠정" : ""}</th><th>실적</th><th>예상</th><th>예상 대비</th><th>QoQ</th><th>YoY</th></tr></thead><tbody>
    ${k.rows.map((r) => `<tr><td>${esc(r.item)}</td><td><b>${r.act == null ? "-" : kqF(r.f, k.cur)(r.act)}</b></td><td>${r.est == null ? "-" : kqF(r.f, k.cur)(r.est)}</td><td>${P(r.vs_est)}</td><td>${P(r.qoq)}</td><td>${P(r.yoy)}</td></tr>`).join("")}
  </tbody></table></div>`;
}
// 주가: 기간 탭 (1개월~1년 = 일봉 종가, 3년~10년 = 상세 데이터의 주봉 종가) — 부드러운 선 + 색 채움 + 오른쪽 눈금 + 마지막 가격
const PX_TABS = [[1, "1개월"], [3, "3개월"], [6, "6개월"], [12, "1년"], [36, "3년"], [60, "5년"], [120, "10년"], [999, "MAX"]];  // MAX = 받아 둔 주봉 전부
const PX_LONG = {};  // 코드 → 주봉 종가 (밴드 계산에 쓰는 가격)
function priceBox(c, m = 6, tag = "button") {  // 종목 카드는 카드 자체가 <button> 이라 탭을 span 으로 (button 안 button 은 HTML 이 깨짐)
  if (!c.chart?.dates?.length) return "";
  return `<div class="pbox" data-code="${esc(c.code)}"><div class="seg pseg" style="margin-top:8px">${PX_TABS.map(([mm, l]) => `<${tag} data-m="${mm}" class="${mm === m ? "on" : ""}">${l}</${tag}>`).join("")}</div>
    <div class="pbox-in">${priceSpark(c, m)}</div></div>`;
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
  el.innerHTML = priceSpark(c, m) || `<div class="empty">이 기간 주가 자료가 없어요.</div>`;
});
function priceSpark(c, months = 6) {
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
  const maPts = ma.map((y, i) => (y == null ? null : [X(i), Y(y)])), mseg = maPts.filter(Boolean);
  const maPath = mseg.length > 1 ? `<path d="${mseg.map((p, j) => `${j ? "L" : "M"}${p[0]},${p[1]}`).join(" ")}" fill="none" stroke="var(--s2)" stroke-width="2" stroke-dasharray="6 3"/>` : "";
  return `<div class="qp" style="margin-top:8px"><div class="qt"><b>주가 (${lbl}, ${wk ? "주봉" : "일봉"} 종가)</b>${wk && new Date(ds[0]) - cut > 60 * 864e5 ? `<span class="src">${esc(ds[0])} 부터 (자료 있는 기간)</span>` : ""}</div>
    ${ma200Line(c)}<svg viewBox="0 0 ${W} 192" role="img" aria-label="${esc(c.name)} 주가 ${months}개월">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--s1);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--s1);stop-opacity:.03"/></linearGradient></defs>
    ${g}<path d="${d} L${last[0]},${bot} L${x0},${bot} Z" fill="url(#${gid})"/><path d="${d}" fill="none" stroke="var(--s1)" stroke-width="2.5"/>${maPath}
    <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="var(--s1)"/><text x="${last[0] - 8}" y="${last[1] - 10}" text-anchor="end" class="qv b" style="fill:var(--s1);font-size:13px;paint-order:stroke;stroke:var(--surface);stroke-width:3px">${cur}${n(v[v.length - 1], cur ? 2 : 0)}${cur ? "" : "원"}</text></svg></div>`;
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
  $("#easyNews").innerHTML = easyNewsHTML();
  $("#kqNews").innerHTML = kqNewsHTML();
  $("#irCal").innerHTML = irCalHTML();
  $("#bigTech").innerHTML = bigTechHTML();
}
function kqNewsHTML() {
  // 최근 발표일 먼저 (같은 날이면 보유 → 관심 순서 그대로)
  const list = DASH.stocks.filter((c) => c.kq_brief && mktOf(c.code) === MKT).sort((a, b) => (b.kq_brief.date || "").localeCompare(a.kq_brief.date || ""));
  const wait = DASH.stocks.filter((c) => !c.kq_brief && c.kq_wait && mktOf(c.code) === MKT);
  if (!list.length && !wait.length) return "";
  const waitHtml = wait.length ? `<div class="note">⏳ 잠정실적 공시는 났고 숫자를 읽는 중 (다음 갱신 때 반영): ${wait.map((c) => `<a href="#stock/${esc(c.code)}">${esc(c.name)}</a> ${esc(c.kq_wait || "")}`).join(" · ")}</div>` : "";
  return `<h2>🧾 실적 발표 <span class="src">최근 3일 · 회색 = 발표 전 예상(컨센서스), 색 = 실적</span></h2>${waitHtml}<div class="grid">${list.map((c) => {
    const k = c.kq_brief;
    const head = `<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap"><b style="font-size:18px;color:var(--s1)">${esc(c.name)} (${esc(c.code)})</b>
      <span class="src">${esc(c.industry || "")}${c.market_cap ? ` · 시총 ${capTxt(c)}` : ""} · ${esc(c.group || "")} · <a href="#stock/${esc(c.code)}">상세 화면</a></span></div>`;
    return `<div class="card">${head}
      <div class="sub">${esc(k.latest)}${k.prelim ? " 잠정실적" : " 실적"}${k.filing ? ` · <a href="${esc(k.filing.url)}" target="_blank" rel="noopener">${esc(k.filing.date)} ${k.cur === "USD" ? "발표" : "공시"}</a>` : ""}</div>
      ${priceBox(c)}
      ${kqTable(k)}
      ${moodHTML(c)}
      ${kqBox(k, c.code)}
    </div>`;
  }).join("")}</div>`;
}
function kqHTML(d) {
  const k = d.kq;
  if (!k) return "";
  const nx = k.next;
  return `<h3>🧾 최신 분기 실적 <span class="src">${esc(k.latest)}${k.prelim ? " 잠정" : ""} · ${k.cur === "USD" ? "야후 파이낸스 · 달러 · EPS = 야후 발표 EPS" : "네이버 증권(FnGuide) · 억원"}${k.est_date ? ` · 예상 = ${esc(k.est_date)} 저장한 컨센서스` : ""}</span></h3><div class="card">
    ${k.waiting && nx ? `<div class="warnbox">🧾 ${esc(nx.q)} 잠정실적 공시가 났어요 (${esc(k.filing.date)}). 네이버 숫자에 반영되면 예상 대비가 자동으로 계산돼요. <a href="${esc(k.filing.url)}" target="_blank" rel="noopener">공시 보기</a></div>` : ""}
    ${k.prelim && k.filing ? `<div class="note">🧾 ${esc(k.latest)} 숫자는 <a href="${esc(k.filing.url)}" target="_blank" rel="noopener">DART 잠정실적 공시(${esc(k.filing.date)})</a> 값이에요. 네이버에 확정 숫자가 들어오면 자동으로 바뀌어요 (EPS 는 그때 채워짐).</div>` : ""}
    ${kqTable(k)}
    ${(k.points || []).length ? `<div class="chart-title" style="margin-top:8px"><b>✦ 포인트</b></div><ul class="irl">${k.points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${kqBox(k, d.code)}
    <div class="tbl-wrap" style="margin-top:8px"><table class="compact"><thead><tr><th style="text-align:left">분기</th><th>매출액</th><th>영업이익</th><th>순이익</th><th>EPS</th></tr></thead><tbody>
      ${k.quarters.slice().reverse().map((q) => `<tr><td>${esc(q.q)}${q.prelim ? ' <span class="src">잠정</span>' : ""}</td>${["sales", "op", "ni", "eps"].map((f) => `<td>${q[f] == null ? "-" : kqF(f, k.cur)(q[f])}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    ${nx ? `<div class="note">📌 다음 ${esc(nx.q)} 컨센서스: ${[["sales", "매출"], ["op", "영업이익"], ["ni", "순이익"], ["eps", "EPS"]].filter(([f]) => nx[f] != null).map(([f, l]) => `${l} ${kqF(f, k.cur)(nx[f])}`).join(" · ")} <span class="src">(${esc(nx.date)} ${k.cur === "USD" ? "발표 예정" : "기준"}, 발표되면 이 값과 비교해요)</span></div>` : ""}
    ${k.filing ? `<div class="note src">${k.cur === "USD" ? "발표" : "공시"}: <a href="${esc(k.filing.url)}" target="_blank" rel="noopener">${esc(k.filing.date)} ${esc(k.filing.name)}</a></div>` : ""}
    ${(EARNINGS[d.card?.code] || []).length ? "" : earningsHTML(d.card?.code, true)}
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
  // 부문별 매출: 돈의 흐름 왼쪽은 이 분기와 같은 시점 자료가 있을 때만
  const ps = segPeriods(d.seg), col = ps.length ? segColors(ps) : null;
  const sp = ps.find(([e]) => nearDay(e, last[0])), spa = sp && segAgo(ps, sp[0]);
  const segs = sp ? Object.keys(col).filter((s) => sp[1][s]).map((s) => [s, sp[2] ? sp[2][s] : (last[1].rev * sp[1][s]) / 100,
    sp[2] && spa?.[2]?.[s] > 0 ? (sp[2][s] / spa[2][s] - 1) * 100 : null, col[s], sp[1][s], !sp[2]]) : null;
  const nm = (d.card || d).name || "";
  const src = `${esc(last[0])} 끝난 ${yr ? "회계연도" : "분기"} · 야후 파이낸스${d.seg ? " · 부문: " + esc(d.seg.src || "") : ""} · ${usd ? "달러" : "원"}`;
  const head = inKq ? `<div class="chart-title" style="margin-top:14px"><b>📊 손익 구조 · ${esc(labels[L])}</b> <span class="src">${src}</span></div>`
    : `<h3>📊 ${esc(nm)} 실적 요약 (핵심지표) · ${esc(labels[L])} <span class="src">${src}</span></h3><div class="card">${Object.keys(d.qtrs_y || {}).length >= 2 ? `<div class="seg qseg" style="margin-bottom:8px"><button data-q="q" class="${yr ? "" : "on"}">분기</button><button data-q="y" class="${yr ? "on" : ""}">연간</button></div>` : ""}`;
  return `<div class="qtrbox" data-code="${esc((d.card || d).code || "")}">${head}
    <div class="qgrid">
      ${inKq ? "" : qPanel("매출 & 성장률 (1년 전 대비)", tRev, labels, rev, yoy.some((v) => v != null) ? yoy : null, usd, "var(--ink-2)")}
      ${inKq ? "" : qPanel("영업이익 & 영업이익률", tOp, labels, op, opm, usd, "var(--good)")}
      ${gpv.filter((v) => v != null).length >= 2 ? qPanel("매출총이익 & 매출총이익률", tG, labels, gpv, gpm, usd, "var(--s3)") : ""}
      ${!yr && ps.length ? segDonut(ps, col, d.seg) : ""}
      ${inKq ? "" : qPanel("잉여현금흐름 (FCF)", tF, labels, fcf, null, usd, "var(--good)")}
      ${qPanel("설비투자 (CapEx)", tC, labels, capex, null, usd, "var(--warn)")}
      ${!yr && ps.length > 1 ? segStack(ps, col) : ""}
    </div>
    <div class="chart-title" style="margin-top:12px"><b>💸 ${esc(nm)} ${esc(labels[L])} 얼마 벌어서 어디에 썼나</b> <span class="src">${segs ? "부문 → " : ""}매출 → 원가·비용 → 영업이익 → 순이익 (매출 대비 %, 1년 전 ${yr ? "" : "같은 분기 "}대비)</span></div>
    ${qSankey(last[1], usd, getQ(last[0]), segs)}
    ${yr ? "" : (() => {  // 최근 4분기 합계(TTM) · 최근 연간 — 분기는 계절성이 있어 1년치로도 보기
      const q4 = all.slice(-4).map(([, q]) => q), out = [];
      if (q4.length === 4 && q4.every((q) => q.rev && q.op != null)) {
        const sum = {};
        for (const key of ["rev", "cogs", "gp", "rnd", "sm", "ga", "sga", "opex", "op"]) if (q4.every((q) => q[key] != null)) sum[key] = q4.reduce((a, q) => a + q[key], 0);
        out.push([`최근 4분기 합계 (${qLabel(all.at(-4)[0])}~${labels[L]})`, sum]);
      }
      const py = d.pl_year;
      if (py?.rev) out.push([`최근 연간 (${py.end.slice(0, 7)} 결산)`, py]);
      return out.map(([t, q]) => `<details class="fvt"><summary class="chart-title">💸 ${esc(t)} <span class="src">매출 ${qMoney(q.rev, usd)} · 영업이익률 ${n((q.op / q.rev) * 100, 1)}% · 눌러서 보기</span></summary>${qSankey(q, usd)}</details>`).join("");
    })()}
    <div class="note src">성장률은 1년 전 ${yr ? "" : "같은 분기 "}대비 (${yr ? "야후 연간 재무제표 최근 4년" : "분기 자료가 쌓이면 빈 칸이 채워져요"}) · 한국 종목은 야후 반영이 실적 발표보다 늦을 수 있어요</div>
  ${inKq ? "" : "</div>"}</div>`;
}
// 📈 긴 기간 선(·막대) 그래프 — 휴대폰 한 화면에 10년 치 (안아줘 투자이야기 블로그 그림처럼 왼쪽·오른쪽 두 눈금)
// o = {t, why, tag, labels, s: [{n, v, col, right, bar}], fl, fr (눈금 글자), zero (0 을 눈금에 넣기), tick (i → x 아래 글자)}
function lineChart(o) {
  const Lb = o.labels, N = Lb.length, S = o.s.map((s) => ({ ...s, v: s.v.map((v) => (Number.isFinite(v) ? v : null)) })).filter((s) => s.v.some((v) => v != null));  // 빈 칸·NaN 은 끊어 그림
  if (N < 3 || !S.length) return "";
  const hasR = S.some((s) => s.right), W = 340, x0 = 40, x1 = W - (hasR ? 40 : 10), top = 14, bot = 128;
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
  const ends = [];
  S.filter((s) => !s.bar).forEach((s) => {
    const side = !!s.right;
    let d = "", pen = false;
    s.v.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(side, v).toFixed(1)}`; pen = true; });
    g += `<path d="${d}" fill="none" stroke="${s.col}" stroke-width="${N > 30 ? 1.8 : 2.4}" stroke-linejoin="round"/>`;
    if (N <= 24) s.v.forEach((v, i) => { if (v != null) g += `<circle cx="${X(i)}" cy="${Y(side, v)}" r="2" fill="${s.col}"/>`; });
    const li = s.v.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
    if (li != null) { g += `<circle cx="${X(li)}" cy="${Y(side, s.v[li])}" r="3.2" fill="var(--surface)" stroke="${s.col}" stroke-width="2"/>`; ends.push([X(li), Y(side, s.v[li]), (side ? fr : fl)(s.v[li]), s.col]); }
  });
  // 끝 숫자: 점 왼쪽 위에, 선끼리 가까우면 13 씩 벌림 (동그라미·다른 숫자와 안 겹치게)
  ends.forEach((e) => { e[1] = Math.max(top + 4, e[1] - 7); });
  ends.sort((a, b) => a[1] - b[1]).forEach((e, i, a) => { if (i && e[1] - a[i - 1][1] < 13) e[1] = a[i - 1][1] + 13; });
  ends.forEach(([x, y, t, col]) => { g += `<text x="${Math.min(x, x1) - 6}" y="${y}" text-anchor="end" class="qv b" style="fill:${col};paint-order:stroke;stroke:var(--surface);stroke-width:3px">${esc(t)}</text>`; });
  const leg = S.length > 1 ? `<div class="src" style="padding:0 4px 4px">${S.map((s) => `<span style="color:${s.col}">${s.bar ? "■" : "●"}</span> ${esc(s.n)}${hasR ? (s.right ? " (오른쪽)" : " (왼쪽)") : ""}`).join(" · ")}</div>` : "";
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
    lineChart({ t: "매출 · 영업이익", labels: ks, s: [{ n: "매출", v: s.rev, col: "var(--s1)" }, { n: "영업이익", v: s.op, col: "var(--warn)", right: true }], fl: fm, fr: fm, zero: true }),
    lineChart({ t: "매출 성장률 (YoY)", labels: ks, s: [{ n: "YoY", v: s.yoy, col: "var(--s1)" }], fl: fPct }),
    lineChart({ t: "영업이익률 (OPM)", labels: ks, s: [{ n: "OPM", v: s.opm, col: "var(--good)" }], fl: fPct }),
    s.gpm.filter((v) => v != null).length >= 4 ? lineChart({ t: "매출총이익률 (GPM)", labels: ks, s: [{ n: "GPM", v: s.gpm, col: "var(--s3)" }], fl: fPct }) : "",
  ];
  const sg = d.longq_seg;  // 삼성전자 DS(반도체) 부문
  if (sg?.q) {
    const sk = Object.keys(sg.q).sort().slice(-span), ss = longSeries(sg.q, sk, false);
    ch.push(lineChart({ t: `${sg.name} 매출 · 영업이익`, labels: sk, s: [{ n: "매출", v: ss.rev, col: "var(--s1)" }, { n: "영업이익", v: ss.op, col: "var(--warn)", right: true }], fl: kqFmt, fr: kqFmt, zero: true }),
      lineChart({ t: `${sg.name} 영업이익률`, labels: sk, s: [{ n: "OPM", v: ss.opm, col: "var(--good)" }], fl: fPct }));
  }
  return `<div class="lnbox" data-code="${esc(c.code)}"><div class="chart-title" style="margin-top:14px"><b>📈 10년 실적 추이</b> <span class="src">${esc(all[0])}~${esc(all.at(-1))} · 분기 · ${usd ? "SEC·야후 (달러)" : "DART 분기보고서 · 최신 분기는 잠정실적 (원)"}</span></div>
    <div class="seg lseg" style="margin-top:6px">${LONG_TABS.map(([m, l]) => `<button data-ln="${m}" class="${m === span ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="qgrid" style="margin-top:6px">${ch.join("")}</div>${all.length < 20 ? `<div class="note src">예전 분기는 갱신 때마다 조금씩 채워져요 (지금 ${all.length}개 분기)</div>` : ""}</div>`;
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
  let cl = "";
  if (ck.length >= 3) {
    cl += lineChart({ t: "클라우드 매출 ($B)", labels: ck, s: [{ n: "AWS", v: ck.map((k) => B(aws.rev, k)), col: "var(--warn)" }, { n: "구글 클라우드", v: ck.map((k) => B(gc.rev, k)), col: "var(--s1)" }], fl: usdB, zero: true, tick: (i) => shortQ(i, ck) })
      + lineChart({ t: "구글 클라우드 ÷ AWS 매출", labels: ck, s: [{ n: "비율", v: ck.map((k) => (aws.rev?.[k] && gc.rev?.[k] != null ? (gc.rev[k] / aws.rev[k]) * 100 : null)), col: "var(--s1)" }], fl: fPct, tick: (i) => shortQ(i, ck) })
      + lineChart({ t: "매출 성장률 (YoY)", labels: ck, s: [{ n: "AWS", v: ck.map((k) => (aws.rev?.[qAgo(k)] ? (aws.rev[k] / aws.rev[qAgo(k)] - 1) * 100 : null)), col: "var(--warn)" }, { n: "구글 클라우드", v: ck.map((k) => (gc.rev?.[qAgo(k)] > 0 && gc.rev?.[k] != null ? (gc.rev[k] / gc.rev[qAgo(k)] - 1) * 100 : null)), col: "var(--s1)" }], fl: fPct, tick: (i) => shortQ(i, ck) })
      + lineChart({ t: "영업이익률 (OPM)", labels: ck, s: [{ n: "AWS", v: ck.map((k) => (aws.rev?.[k] && aws.op?.[k] != null ? (aws.op[k] / aws.rev[k]) * 100 : null)), col: "var(--warn)" }, { n: "구글 클라우드", v: ck.map((k) => (gc.rev?.[k] && gc.op?.[k] != null ? (gc.op[k] / gc.rev[k]) * 100 : null)), col: "var(--s1)" }], fl: fPct, tick: (i) => shortQ(i, ck) });
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
  const items = (IRCAL.items || []).filter((e) => e.dday >= -2 && e.dday <= 30 && mktOf(e.code) === MKT);
  if (!items.length) return "";
  const gl = { 보유: "", 관심: " ⭐", 공동: " 🤝" };
  return `<details class="card" open style="margin-bottom:12px"><summary class="chart-title"><b>📅 실적발표·컨퍼런스콜 일정</b> <span class="src">보유·관심·공동 · 앞으로 30일 · 네이버 증권 IR / 야후 · ${esc(IRCAL.updated_at || "")}</span></summary>
    <ul class="irl">${items.map((e) => `<li>${irWhen(e)} <a href="#stock/${esc(e.code)}">${esc(e.name)}</a>${gl[e.group] || ""} · ${esc(e.title || "")}${e.live ? " · 🔴 라이브" : ""}${e.segc ? ` · <a href="#stock/${esc(e.code)}">🎯 ${esc(e.segc)} 부문 예상</a>` : ""}${e.url ? ` · <a href="${esc(e.url)}" target="_blank" rel="noopener">IR 보기</a>` : ""}${e.script_url ? ` · <a href="${esc(e.script_url)}" target="_blank" rel="noopener">📜 실시간 자막</a>` : ""}</li>`).join("")}</ul></details>`;
}
// 🐣 오늘의 쉬운 요약 (첫 화면): 최근 3일 실적발표 요약의 easy + config/events.yaml (공시·촉매·전망 변화) — 바쁠 때 이것만 읽어도 되게
let EVENTS = [];
function easyNewsHTML() {
  const cut = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10), nm = (c) => DASH.stocks.find((s) => s.code === c)?.name;
  const items = [
    ...Object.entries(EARNINGS).flatMap(([code, l]) => (l[0]?.easy?.length && l[0].date >= cut ? [{ date: l[0].date, code, title: `${l[0].quarter} 실적발표`, easy: l[0].easy, sum: true }] : [])),
    ...(EVENTS || []).filter((e) => e.date >= cut && e.easy?.length),
  ].filter((e) => !(e.market || e.code) || (e.market || mktOf(e.code)) === MKT)  // 종목·시장이 없는 이벤트(업종 전체)는 두 탭 모두
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!items.length) return "";
  return `<details class="card" open style="margin-bottom:12px"><summary class="chart-title"><b>🐣 오늘의 쉬운 요약</b> <span class="src">최근 3일 · 실적발표·공시·증권사 전망 변화 · 핵심만 쉬운 말로</span></summary>
    ${items.map((e) => `<div class="kidbox"><b>${e.code ? `<a href="#stock/${esc(e.code)}">${esc(nm(e.code) || e.code)}</a> · ` : ""}${esc(e.title)}</b> <span class="src">${esc(e.date.slice(5).replace("-", "/"))}${e.sum ? " · 누르면 상세 요약" : ""}</span>
      <ul class="irl">${e.easy.map((x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`).join("")}</ul></div>`).join("")}</details>`;
}
function earningsHTML(code, inline = false) {  // inline = 요약이 아직 없어 '🧾 최신 분기 실적' 카드 안에 일정 한 줄만
  const list = EARNINGS[code] || [];
  const ev = (IRCAL.items || []).find((e) => e.code === code && e.dday >= -7);
  const next = ev ? `<div class="note">📅 ${irWhen(ev)} ${esc(ev.title || "")}${ev.live ? " · 🔴 라이브 컨퍼런스콜" : ""}${ev.url ? ` · <a href="${esc(ev.url)}" target="_blank" rel="noopener">IR 보기</a>` : ""}${ev.script_url ? ` · <a href="${esc(ev.script_url)}" target="_blank" rel="noopener">📜 실시간 자막</a>` : ""}</div>` : "";
  if (!list.length && inline) return next ? `${next}<div class="note src">📞 발표가 끝나면 예약 작업이 스크립트를 읽고 요약해서 바로 아래에 넣어요.</div>` : "";
  if (!list.length) return next ? `<h3>📞 실적발표</h3><div class="card">${next}<div class="note src">발표가 끝나면 예약 작업이 스크립트를 읽고 요약해서 여기에 넣어요.</div></div>` : "";
  return `<h3>📞 실적발표 요약 <span class="src">${list.length}개 분기 · 누르면 펼쳐져요</span></h3><div class="card">${next}${moodHTML(DASH.stocks.find((s) => s.code === code))}
    ${list.map((e, i) => `<details class="fvt"${i === 0 ? " open" : ""}><summary class="chart-title"><b>${esc(e.quarter)} 실적발표</b> <span class="src">${esc(e.date || "")} ${esc(e.source || "")}</span></summary>
      ${i === 0 ? previewHTML(e.next) : ""}
      ${(e.easy || []).length ? `<div class="kidbox">🐣 <b>주린이를 위한 핵심 간단 요약</b><ul class="irl">${e.easy.map((x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${vsHTML(e)}
      ${(e.facts || []).length ? `<div class="card" style="margin-top:8px;background:var(--surface-2)"><b>🆕 뉴팩트</b> <span class="src">이번 발표에서 새로 나온 사실</span><ul class="irl facts">${e.facts.map((x) => `<li${x.startsWith("⚠") ? ' class="kid-warn"' : ""}>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${(e.keys || []).length ? `<div class="card" style="margin-top:8px;background:var(--surface-2)"><b>🎤 어닝콜 핵심</b>${e.keys.map((x, j) => `<div style="margin-top:6px"><b style="color:${x.tone === "bad" ? "var(--bad-ink)" : "var(--good-ink)"}">${"①②③④⑤⑥"[j] || "·"} ${esc(x.h)}</b> ${x.tone === "bad" ? "⚠" : "✔"}
        ${(x.q || []).map((t) => `<div class="src" style="margin-left:18px">${/^[(（]/.test(t) ? esc(t) : `“${esc(t)}”`}</div>`).join("")}</div>`).join("")}</div>` : ""}
      ${e.transcript ? `<div class="note">📜 <a href="${esc(e.transcript)}" target="_blank" rel="noopener">발표 자막 원문 보기 (발표·질의응답 전체)</a></div>` : ""}
      ${i === 0 ? `<div class="note">📎 다른 곳 컨콜 정리: ${[...(e.links || []), IR_NOTE].map((l) => `<a href="${esc(l.u)}" target="_blank" rel="noopener">${esc(l.t)}</a>`).join(" · ")} <span class="src">(원문은 그곳에서 · 여기엔 우리 말로 짧게만)</span></div>` : ""}
      ${(e.short || []).length ? `<div class="warnbox" style="margin-top:6px"><b>⚡ 핵심만</b><ul class="irl">${e.short.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      <details class="fvt"><summary class="chart-title">📄 자세히 보기</summary><div class="note" style="white-space:pre-wrap;line-height:1.7">${esc(e.body || "")}</div></details>
    </details>`).join("")}
  </div>`;
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
    rv == null ? null : [rv >= 5 ? 1 : rv <= -5 ? -1 : 0, `내년 EPS 예상치 90일 새 ${pct(rv, 1, true)}`],
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
  if (!(e.vs || []).length && !(e.guide || []).length && !e.after) return "";
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
    ${tbl(e.vs, "실적")}${(e.guide || []).length ? `<div style="margin-top:6px"><b>🧭 가이던스</b> <span class="src">회사가 내놓은 앞으로 전망</span></div>${tbl(e.guide, "회사 전망")}` : ""}</div>`;
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
const NV_COLORS = ["#d4441c", "#7cc12a", "#a57fd6", "#f5a00f"];
const NV_STYLES = [["rectRot", 0], ["rect", 0], ["triangle", 0], ["triangle", 180]];
const NV_PERIODS = [["5", "5년"], ["10", "10년"], ["all", "역사적"]];
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
function nvSeg() {
  return `<div class="seg" id="nv-seg">${NV_PERIODS.map(([k, l], i) => `<button data-p="${k}" class="${i ? "" : "on"}">${l}</button>`).join("")}</div>`;
}
function wireNv(d) {
  const draw = (p) => { drawNv("nv-per", d, "eps", "PER", p); drawNv("nv-pbr", d, "bps", "PBR", p); };
  draw("5");
  $("#nv-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $("#nv-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    draw(b.dataset.p);
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
            callback(v) { const l = this.getLabelForValue(v); return l.slice(5, 7) === "01" && +l.slice(0, 4) % s.tickStep === 0 ? l.slice(0, 7) + "/01" : ""; } } },
        y: { beginAtZero: true, grid: { color: C.grid }, border: { display: false },
          ticks: { color: C.muted, maxTicksLimit: 4, font: { size: 11 }, callback: (v) => (usd ? "$" + n(v) : n(v)) } },
      },
    },
  }));
  const pos = s.cur == null ? null : Math.max(0, Math.min(100, ((s.cur - s.lo) / (s.hi - s.lo)) * 100));
  const dk = kind === "PER" ? 1 : 2, nm = { 5: "최근 5년", 10: "최근 10년", all: "전체 기간" }[period];
  $(`#${id}-note`).innerHTML = `지금 ${kind} <b>${n(s.cur, dk)}배</b> · ${nm} 범위 ${n(s.lo, dk)}~${n(s.hi, dk)}배${pos == null ? "" : ` (아래에서 ${n(pos, 0)}% 위치)`}
    <br><span class="src">${s.from}~ · 선 = ${key === "eps" ? "EPS" : "BPS"} × 배수 (연간 실적·추정치를 각 해 12월 말에 두고 달마다 이음, 네이버 방식) · 배수 = ${nm} ${kind} 하위 ${DASH.settings.band.low_pct}% ~ 상위 ${100 - DASH.settings.band.high_pct}% 를 4등분 · 아래 이름을 누르면 선을 끄고 켤 수 있어요</span>`;
}

/* ---------- Koyfin 식 선행 PER(NTM) 추이 ----------
   NTM EPS = 앞으로 12개월 EPS (Y년 실적을 (Y-1)년 12월 말에 두고 직선 보간 = 올해·내년 추정을 남은 기간 비율로 섞음).
   1년 이하 기간은 일별 종가, 그보다 길면 주간 종가. High / Median / Low = 그 기간 최고·가운데·최저. */
const KF_PERIODS = [["all", "ALL"], ["10y", "10Y"], ["5y", "5Y"], ["1y", "1Y"], ["ytd", "YTD"], ["6m", "6M"], ["3m", "3M"]];
function kfSeries(d, period) {
  const anchors = d.history.filter((r) => r.eps > 0).map((r) => [Date.UTC(r.year - 1, 11, 31), r.eps]).sort((a, b) => a[0] - b[0]);
  const ntm = (t) => {
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
  pts = pts.filter(([t]) => t >= from).map(([t, p]) => { const e = ntm(t); return [t, e ? p / e : null]; })
    .filter(([, v]) => v != null && v > 0 && v <= (DASH.settings.band.per_cap || 1e9));
  if (pts.length < 5) return null;
  const vs = pts.map((x) => x[1]).sort((a, b) => a - b);
  return { labels: pts.map(([t]) => ymd(t)), pe: pts.map((x) => Math.round(x[1] * 100) / 100),
    hi: vs[vs.length - 1], med: vs[Math.floor(vs.length / 2)], lo: vs[0], cur: pts[pts.length - 1][1] };
}
function kfBlock() {
  return `<h3>선행 PER 추이 <span class="src">Koyfin 방식 · P/E (NTM)</span></h3><div class="card">
    <div class="seg" id="kf-seg">${KF_PERIODS.map(([k, l]) => `<button data-p="${k}" class="${k === "10y" ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="chart-box nvbox"><canvas id="kf-chart"></canvas></div><div class="note" id="kf-note"></div></div>`;
}
function drawKf(d, period) {
  const s = kfSeries(d, period), cv = document.getElementById("kf-chart");
  if (!cv) return;
  if (!s) { if (charts.has("kf-chart")) charts.get("kf-chart").destroy(); $("#kf-note").textContent = "이 기간은 자료가 부족해요."; return; }
  const C = themeColors(), flat = (v) => s.pe.map(() => v);
  const ds = [{ label: "P/E (NTM)", data: s.pe, borderColor: "#7c3aed", borderWidth: 2 },
    { label: `High ${n(s.hi, 1)}배`, data: flat(s.hi), borderColor: C.muted, borderDash: [5, 4], borderWidth: 1 },
    { label: `Median ${n(s.med, 1)}배`, data: flat(s.med), borderColor: C.ink2, borderDash: [5, 4], borderWidth: 1.3 },
    { label: `Low ${n(s.lo, 1)}배`, data: flat(s.lo), borderColor: C.muted, borderDash: [5, 4], borderWidth: 1 }];
  makeChart(cv, s.labels, ds, { fmt: (v) => n(v, 1) + "배", yfmt: (v) => n(v, 0) + "x", xlen: 7 });
  const pos = s.hi > s.lo ? ((s.cur - s.lo) / (s.hi - s.lo)) * 100 : null;
  $("#kf-note").innerHTML = `${legend(ds.map((x) => [x.label, x.borderColor, !!x.borderDash]))}
    지금 P/E (NTM) <b>${n(s.cur, 1)}배</b> · 이 기간 가운데값 ${n(s.med, 1)}배 대비 ${pct((s.cur / s.med - 1) * 100, 0, true)}${pos == null ? "" : ` · 최저~최고 사이 ${n(pos, 0)}% 위치`}
    <br><span class="src">NTM EPS = 앞으로 12개월 EPS (올해·내년 추정을 남은 기간 비율로 섞음, 지난 시점은 실제 실적으로 계산) · Koyfin 은 그 당시 컨센서스를 써서 과거 구간 숫자가 조금 다를 수 있어요</span>`;
}
function wireKf(d) {
  drawKf(d, "10y");
  $("#kf-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $("#kf-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    drawKf(d, b.dataset.p);
  });
}

function detailHTML(d) {
  const c = d.card;
  const L = LIGHT[c.verdict] || LIGHT.na;
  let h = `<div class="card" style="margin-top:12px"><div class="light">${lamp(c.verdict)}<div>
      <div class="verdict ${c.verdict}">${L.stock} <span class="sub">${esc(c.why)}</span></div>
      <div class="big">${money(d.price, d.currency)}</div><div class="sub">${esc(d.price_date)} 종가 · 시가총액 ${capTxt(d)} <span class="src">${esc(d.sources.price)}</span></div></div></div>
    <div class="kv"><div class="k">적정가 <span class="src">${esc(c.fair_basis)}</span></div><div class="v">${money(c.fair, c.currency)} (${c.gap == null ? "N/A" : pct(c.gap * 100, 0, true)})</div>
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
  h += `<h3>밴드차트</h3><div class="card">${nvSeg()}${nvBlock("nv-per", "PER 차트")}${nvBlock("nv-pbr", "PBR 차트")}</div>`;
  h += kfBlock();
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
  wireNv(d);
  wireKf(d);
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
  const leg = `<div class="src" style="padding:0 4px 4px">${ch.s.map((s, si) => `<span style="color:${KPI_COL[si % 4]}">■</span> ${esc(s.n)}`).join(" · ")}${ch.ytd_note ? ` · YTD = ${esc(ch.ytd_note)}` : ""}${ch.note ? ` · ${esc(ch.note)}` : ""}</div>`;
  return `<div class="qp"><div class="qt"><b>${esc(ch.t)}</b>${ch.tag || ""}</div>${ch.why ? `<div class="src">${esc(ch.why)}</div>` : ""}<svg viewBox="0 0 ${W} 160" role="img" aria-label="${esc(ch.t)}">${g}</svg>${leg}</div>`;
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
  qs.forEach((q, i) => {
    const cx = x0 + bw * i + bw / 2;
    g += `<circle cx="${cx}" cy="${LY(opm[i])}" r="3.5" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="2"/><text x="${cx}" y="${LY(opm[i]) - 8}" text-anchor="middle" class="qv${i === qs.length - 1 ? " b" : ""}"${opm[i] < 0 ? ' style="fill:var(--bad-ink)"' : ""}>${n(opm[i], 1)}%</text>`;
  });
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
  const qs = [...new Set(ch.s.flatMap((s) => Object.keys(s.v || {})))].sort();
  const vals = ch.s.flatMap((s) => Object.values(s.v || {})).filter((v) => v != null);
  if (qs.length < 2 || !vals.length) return "";
  const many = ch.s.length > 1, W = 320, x0 = 26, x1 = W - (many ? 62 : 26), top = 28, bot = 138;  // 선이 여러 개면 끝 숫자를 오른쪽에
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = (hi0 - lo0) * 0.18 || Math.abs(hi0) * 0.2 || 1;
  const lo = lo0 - pad, hi = hi0 + pad, Y = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top), X = (i) => x0 + ((x1 - x0) * i) / (qs.length - 1);
  let g = qs.map((q, i) => `<line x1="${X(i)}" x2="${X(i)}" y1="${top - 6}" y2="${bot}" stroke="var(--grid)"/><text x="${X(i)}" y="${bot + 16}" text-anchor="middle" class="qx">${esc(q)}</text>`).join("");
  if (lo0 < 0 && hi0 > 0) g += `<line x1="${x0 - 10}" x2="${x1 + 10}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--axis)" stroke-dasharray="3 3"/>`;
  const ends = [];  // 선이 여러 개면 마지막 값만 글자로 (겹치지 않게 아래로 밀기)
  ch.s.forEach((s, si) => {
    const col = (ch.col || KPI_COL)[si % (ch.col || KPI_COL).length], pts = qs.map((q, i) => [i, s.v?.[q]]).filter(([, v]) => v != null);
    g += `<path d="${pts.map(([i, v], j) => `${j ? "L" : "M"}${X(i)},${Y(v)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round"/>`;
    pts.forEach(([i, v], j) => {
      const last = j === pts.length - 1;
      g += `<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="var(--surface)" stroke="${col}" stroke-width="2.5"/>`;
      if (last) ends.push([X(i), Y(v), v, col]);
      else if (!many) g += `<text x="${X(i)}" y="${Y(v) - 9}" text-anchor="middle" class="qv">${kpiF(v, ch.u)}</text>`;
    });
  });
  ends.sort((a, b) => a[1] - b[1]).forEach((e, i, a) => { if (i && e[1] - a[i - 1][1] < 14) e[1] = a[i - 1][1] + 14; });
  const over = ends.length ? ends[ends.length - 1][1] - (bot - 4) : 0;  // 아래 분기 이름과 겹치면 통째로 위로
  if (over > 0) ends.forEach((e) => { e[1] -= over; });
  ends.forEach(([x, y, v, col]) => { g += `<text x="${many ? x + 8 : x - 2}" y="${many ? y + 4 : y - 9}" text-anchor="${many ? "start" : "end"}" class="qv b" style="fill:${col};font-size:13px;paint-order:stroke;stroke:var(--surface);stroke-width:3px">${kpiF(v, ch.u)}</text>`; });
  const leg = many ? `<div class="src" style="padding:0 4px 4px">${ch.s.map((s, si) => `<span style="color:${(ch.col || KPI_COL)[si % (ch.col || KPI_COL).length]}">●</span> ${esc(s.n)}`).join(" · ")}</div>` : "";
  return `<div class="qp"><div class="qt"><b>${esc(ch.t)}</b></div>${ch.why ? `<div class="src">${esc(ch.why)}</div>` : ""}<svg viewBox="0 0 ${W} 160" role="img" aria-label="${esc(ch.t)}">${g}</svg>${leg}</div>`;
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
async function kpiBlock(code, d) {
  if (KPI === null) { try { KPI = (await (await fetch("data/kpi.json?v=" + encodeURIComponent(DASH.updated_at))).json()) || {}; } catch (_) { KPI = {}; } }
  const k = KPI[code] || KPI[KPI_ALIAS[code]];
  if (!k?.charts?.length) return "";
  const ch = k.charts.map(kpiChart);
  ch.unshift(comboHTML(d));  // 맨 앞: 분기 매출·영업이익·영업이익률
  ch.splice(2, 0, opYoyHTML(d, k), fcfBars(d, k), annualOpmHTML(d));  // 매출 성장률 다음에 영업이익 성장률 · 현금흐름 · 연간 매출 & 영업이익률
  return `<h3>🔑 핵심 지표 <span class="src">${esc(k.latest || "")}까지 · 실적발표·컨퍼런스콜·전자공시에서 옮김</span></h3><div class="card kpi">
    <div class="note" style="margin-top:0"><b>주가를 움직이는 열쇠:</b> ${esc(k.key || "")}</div>
    ${(k.patterns || []).map(patternHTML).join("")}
    <div class="qgrid" style="margin-top:8px">${ch.join("")}</div>
    ${ordersGuideHTML(k, d)}
    ${k.memo ? `<div class="note src">${esc(k.memo)}</div>` : ""}
    <div class="note src">출처: ${(k.src || []).map((s) => (s.u ? `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>` : esc(s.t))).join(" · ")}</div>
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
    const k = Object.keys(c.q).sort().at(-1), v = c.q[k], p = c.q[ago(k)], e = c.est?.[k];
    return `<tr><td style="text-align:left">${esc(c.name)}</td><td>${esc(k)}</td><td><b>$${n(v, 1)}B</b></td><td>${p ? pct((v / p - 1) * 100, 0, true) : "-"}</td><td>${e ? `$${n(e.est, 1)}B → $${n(e.act, 1)}B${e.n !== "CapEx" ? `<br><span class="src">${esc(e.n.replace("CapEx ", ""))}</span>` : ""}` : "-"}</td></tr>`;
  }).join("");
  return `<h3>🏗 빅테크 CapEx <span class="src">${esc(CAPEX.updated_at || "")}</span></h3><div class="card">
    ${peakHTML()}
    <div class="qgrid">${chart}${capexGuideSVG(CAPEX.guide)}${peakChart()}</div>
    <div class="tbl-wrap" style="margin-top:8px"><table class="compact"><thead><tr><th style="text-align:left">회사</th><th>최근 분기</th><th>CapEx</th><th>1년 전 대비</th><th>예상 → 발표</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note src">${esc(CAPEX.src || "")} · 막대는 현금으로 나간 설비투자(야후 기준). 마이크로소프트가 발표하는 CapEx 는 금융리스를 더한 숫자라 더 커요</div></div>`;
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
    <div class="tbl-wrap" style="margin-top:8px"><table class="compact"><thead><tr><th style="text-align:left">회사</th><th>최근 분기</th><th>FCF</th><th>직전 분기</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note src">FCF = 영업현금흐름 − 설비투자(Purchases of property and equipment) · 야후 분기 재무제표 + 보도자료 · 회사마다 분기 끝 날짜가 달라 분기 끝에서 45일 뺀 달력 분기로 맞춤</div></details>`;
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
  const mid = (p) => (p.lo + p.hi) / 2, hi = Math.max(...gs.flatMap((g) => g.pts.map((p) => p.hi))) * 1.18;
  const W = 320, top = 26, bot = 132, gw = (W - 10) / gs.length, bw = Math.min(12, (gw * 0.8) / qs.length), Y = (v) => bot - (v / hi) * (bot - top);
  const C = (h) => (/감소|하향|이연/.test(h || "") ? "var(--bad)" : /상향|첫/.test(h || "") ? "var(--s1)" : "var(--ink-2)");
  let g = `<line x1="4" x2="${W - 4}" y1="${bot}" y2="${bot}" stroke="var(--axis)"/>`;
  gs.forEach((c, gi) => {
    const x0 = 5 + gi * gw + (gw - bw * qs.length) / 2, last = c.pts.at(-1);
    qs.forEach((q, i) => {
      const p = c.pts.find((x) => x.q === q); if (!p) return;
      const isL = p === last, x = x0 + i * bw;
      g += `<rect x="${x + 1}" y="${Y(mid(p))}" width="${bw - 2}" height="${bot - Y(mid(p))}" fill="${isL ? C(p.how) : "var(--ink-2)"}" opacity="${isL ? 1 : 0.2 + 0.15 * i}"/>`;
      if (isL) g += `<text x="${x + bw / 2}" y="${Y(mid(p)) - 5}" text-anchor="middle" class="qv b" style="fill:${C(p.how)}">$${n(mid(p), 0)}B</text>`;
    });
    const lab = last.q !== qs.at(-1) ? "발표 전" : last.how || "";  // 이번 분기 아직 발표 안 함 (예: 아마존)
    g += `<text x="${5 + gi * gw + gw / 2}" y="${bot + 14}" text-anchor="middle" class="qx">${esc(c.name)}</text><text x="${5 + gi * gw + gw / 2}" y="${bot + 27}" text-anchor="middle" class="qx" style="fill:${lab === "발표 전" ? "var(--ink-2)" : C(last.how)}">${esc(lab)}</text>`;
  });
  const why = gs.filter((c) => c.pts.at(-1).why).map((c) => `${esc(c.name)}: ${esc(c.pts.at(-1).why)}`);
  return `<div class="qp"><div class="qt"><b>🏗 빅테크 CapEx 가이던스</b></div><div class="src">회사가 말한 1년 설비투자 계획 · 막대 = ${qs.map(esc).join(" → ")} 발표 때 (범위면 가운데 값)</div>
    <svg viewBox="0 0 ${W} 166" role="img" aria-label="빅테크 CapEx 가이던스">${g}</svg>
    <div class="src">${gs.map((c) => `${esc(c.name)} ${c.pts.map((p) => (p.lo === p.hi ? `$${n(p.lo, 0)}B` : `$${n(p.lo, 0)}~${n(p.hi, 0)}B`)).join(" → ")}${c.pts.at(-1).y ? ` (${esc(c.pts.at(-1).y)})` : ""}`).join(" · ")}${why.length ? `<br>${why.join(" · ")}` : ""}</div></div>`;
}
// 📈 12MF PER 밴드 (증권사 그림처럼 10·15·20배 … 고정 배수 선): 각 주의 12개월 선행 EPS = 그해 EPS × 남은 기간 + 다음 해 EPS × 지난 기간
// shortcut: 과거 시점의 선행 EPS 는 당시 컨센서스 대신 실제 연간 EPS(지난 해는 실적, 앞 해는 지금 추정)로 계산 — 무료로 과거 컨센서스를 받게 되면 바꾸기
function per12mfSeries(d) {
  const b = d.bands?.PER, eps = Object.fromEntries((d.history || []).map((r) => [r.year, r.eps]));
  if (!b?.dates?.length) return null;
  const pts = b.dates.map((ds, i) => {
    const dt = new Date(ds), y = dt.getFullYear(), w0 = Math.max(0, (12 - dt.getMonth() - dt.getDate() / 31) / 12);
    const a = eps[y], c = eps[y + 1], e = a != null && c != null ? w0 * a + (1 - w0) * c : null;
    return [ds, b.price[i], e != null && e > 0 ? e : null];
  }).filter((p) => p[2] != null).slice(-156);  // 최근 3년 (주간)
  if (pts.length < 20) return null;
  const r = pts.map((p) => p[1] / p[2]).sort((x, y) => x - y), lo = r[Math.floor(r.length * 0.05)], hi = r[Math.floor(r.length * 0.95)];
  const step = [2, 2.5, 5, 10, 20, 50].find((s) => (hi - lo) / s <= 5) || 100;
  const ms = [];
  for (let m = Math.max(step, Math.floor(lo / step) * step); m <= Math.ceil(hi / step) * step + 1e-9 && ms.length < 6; m += step) ms.push(m);
  return { pts, ms, now: pts.at(-1)[1] / pts.at(-1)[2] };
}
function per12mfHTML(d) {
  if (!(d.methods || []).includes("PER")) return "";
  const s = per12mfSeries(d);
  if (!s) return "";
  return `<h3>📈 12MF PER 밴드 <span class="src">최근 3년 · 지금 ${n(s.now, 1)}배 · ${s.ms.map((m) => n(m, 1) + "배").join(" · ")} 선</span></h3><div class="card">
    <div id="p12-legend"></div><div class="chart-box tall"><canvas id="p12"></canvas></div>
    <div class="note src">선 = 배수 × 그 시점의 12개월 선행 EPS. 과거 선행 EPS 는 당시 컨센서스 대신 실제 연간 EPS(앞 해는 지금 추정치)로 계산해서 증권사 그림과 조금 다를 수 있어요</div></div>`;
}
function drawPer12mf(d) {
  const cv = document.getElementById("p12"), s = cv && per12mfSeries(d);
  if (!s) return;
  const C = themeColors(), usd = d.currency === "USD", shades = [C.muted, C.ink2, C.s3, C.s4, C.s2, C.s7];
  const ds = [{ label: "주가", data: s.pts.map((p) => p[1]), borderColor: C.s1, borderWidth: 2.5 },
    ...s.ms.map((m, i) => ({ label: `${n(m, 1)}배`, data: s.pts.map((p) => p[2] * m), borderColor: shades[i % shades.length], borderWidth: 1.3 }))];
  makeChart(cv, s.pts.map((p) => p[0]), ds, { fmt: (v) => (usd ? "$" + n(v, 2) : n(v) + "원"), yfmt: (v) => (usd ? "$" + n(v) : v >= 10000 ? n(v / 10000, 0) + "만" : n(v)) });
  document.getElementById("p12-legend").innerHTML = legend(ds.map((x) => [x.label, x.borderColor, false]));
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
  if (x.exec_buyers) big.push(`<div class="warnbox" style="margin-top:6px;background:var(--good-bg);color:var(--good-ink)">👀 <b>임원 ${x.exec_buyers}명 장내매수${x.ceo_buy ? ` (대표이사 ${x.ceo_buy}명 포함)` : ""}</b><div class="note src">${KKANGTO.exec_buy}</div></div>`);
  if (x.major_buy) big.push(`<div class="note">ℹ 대주주 장내매수 ${eok(x.major_buy)} <span class="src">${KKANGTO.major_buy}</span></div>`);
  const tag = (r) => (r.role === "대주주" ? `<span class="pill ${r.kind === "매도" ? "red" : ""}">대주주</span>` : r.role === "대표이사" ? `<span class="pill green">대표이사</span>` : `<span class="pill ${r.kind === "매수" ? "green" : ""}">임원</span>`);
  return `<h3>👥 내부자 거래 <span class="src">최근 3개월 장내매수·매도 · 임원·주요주주 소유보고 (스톡옵션·상여 제외)</span></h3><div class="card">
    <div class="mini"><div>매수<b class="cheap">${eok(x.buy)}</b><span class="src">${x.buyers}명</span></div><div>매도<b class="dear">${eok(x.sell)}</b><span class="src">${x.sellers}명</span></div>
      <div>순매수<b class="${x.buy - x.sell < 0 ? "dear" : "cheap"}">${x.buy - x.sell < 0 ? "−" : ""}${eok(Math.abs(x.buy - x.sell))}</b></div></div>
    ${big.join("")}
    <div class="tbl-wrap" style="margin-top:8px"><table class="compact orders"><thead><tr><th>변동일</th><th>보고자</th><th>사유</th><th>증감(주)</th><th>단가</th><th>금액</th></tr></thead><tbody>
      ${x.rows.slice(0, 15).map((r) => `<tr><td>${esc((r.date || "").slice(2))}</td><td style="white-space:normal"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a> ${tag(r)}<br><span class="src">${esc(r.pos || "")}</span></td>
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
      <div class="tbl-wrap"><table class="compact"><thead><tr><th>회사</th><th>시총<br>(조원)</th><th>EPS<br>TTM</th><th>EPS<br>12MF</th><th>PER<br>TTM</th><th>PER<br>12MF</th><th>OPM</th>${noPbr ? "" : "<th>PBR</th>"}<th>ROE</th><th>배당</th></tr></thead><tbody>
      ${g.rows.map((r) => {
        const eps = (v) => (v == null ? "-" : `<span class="${v < 0 ? "dear" : ""}">${n(v, Math.abs(v) >= 100 ? 0 : 2)}</span>`);
        const per = (v, e) => (e != null && e <= 0 ? '<span class="dear">적자</span>' : v == null ? "-" : n(v, 1) + "x");
        return `<tr${r.code === code ? ' class="me"' : ""}><td>${FLAG[r.market] || ""} ${esc(r.name)}${r.stale ? " ⚠" : ""}<br><span class="src">${esc(r.code)}</span></td>
        <td>${r.cap_krw == null ? "N/A" : n(r.cap_krw / 1e12, 1)}</td><td>${eps(r.eps_ttm)}</td><td>${eps(r.eps_12mf)}</td>
        <td>${per(r.per_ttm, r.eps_ttm)}</td><td><b>${per(r.fwd_per, r.eps_12mf)}</b></td><td>${r.opm == null ? "-" : `<span class="${r.opm < 0 ? "dear" : ""}">${n(r.opm, 1)}%</span>`}</td>
        ${noPbr ? "" : `<td>${times(r.pbr, 2)}</td>`}<td>${pct(r.roe)}</td><td>${pct(r.div, 2)}</td></tr>`;
      }).join("")}
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
    const tourHtml = await tourBlock(code);
    const kpiHtml = await kpiBlock(code, d);
    $("#sheetBody").innerHTML = detailHTML(d).replace("<!--profile-->", kqHTML(d) + (d.kq && !(EARNINGS[code] || []).length ? "" : earningsHTML(code)) + segcHTML(d) + kpiHtml + per12mfHTML(d) + (d.kq ? "" : (d.longq ? `<div class="card">${longHTML(d)}</div>` : "") + qtrHTML(d)) + profileHTML(code) + precheckHTML(d)) + brokerHtml + usedCar + orderHtml + holderHtml + flowHTML(d) + peerHtml + tourHtml;
    drawDetailCharts(d);
    drawPer12mf(d);
    drawProfile(code);
    wirePrecheck();
    if (usedCar) wireManheim();
    drawOrders(code);
    drawHolders(code);
    drawPeers(code);
    drawTour();
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
  const view = { "#pbr": "pbr", "#watch": "watch", "#joint": "joint", "#market": "market", "#us": "us", "#score": "score", "#news": "news", "#industry": "industry", "#compare": "compare" }[location.hash] || "main";
  $("#pbrView").hidden = view !== "pbr";
  $("#compareView").hidden = view !== "compare";
  if (view === "compare") renderCompare();
  $("#newsView").hidden = view !== "news";
  if (view === "news") loadNews();
  $("#industryView").hidden = view !== "industry";
  if (view === "industry") loadIndustry();
  $("#marketView").hidden = view !== "market";
  $("#scoreView").hidden = view !== "score";
  if (view === "score") renderScore();
  // 🇰🇷 보유 / 🇺🇸 보유 는 같은 화면을 시장만 바꿔서 보여준다
  const mkt = view === "us" ? "US" : "KR";
  if ((view === "main" || view === "us") && MKT !== mkt) { MKT = mkt; renderTop(); renderCmp(); renderCards(); }
  $("#cmpTitle").textContent = MKT === "US" ? "미국 보유종목 비교표" : "한국 보유종목 비교표";
  $("#cardTitle").textContent = MKT === "US" ? "미국 보유종목 신호등" : "한국 보유종목 신호등";
  $("#mainView").hidden = !(view === "main" || view === "us");
  document.querySelectorAll("#tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.view === view));
  $("#watchView").hidden = view !== "watch";
  $("#jointView").hidden = view !== "joint";
  if (view === "market") drawMarketCharts(); // 숨겨진 상태에서 그린 차트는 크기가 0이라 보일 때 다시 그림
  if (view === "pbr") loadPBR();
  if (view === "watch") { renderGroup("관심", "#watchFull"); loadWatch(); }
  if (view === "joint") renderGroup("공동", "#jointCards");
}
// 보유 말고도 보유종목처럼 다 추적하는 묶음 (stocks.yaml 의 watchlist = 관심, joint = 공동자산) — 매력적인 순
function renderGroup(g, el) {
  const rank = { green: 0, yellow: 1, red: 2, na: 3 }, mk = (c) => (c.market === "US" ? 1 : 0);
  const list = DASH.stocks.filter((c) => grp(c) === g || (c.also || []).includes(g)).sort((a, b) => mk(a) - mk(b) || (rank[a.verdict] ?? 3) - (rank[b.verdict] ?? 3) || (a.gap ?? 9) - (b.gap ?? 9));
  $(el).innerHTML = list.map(stockCard).join("") || `<div class="empty">config/stocks.yaml 의 ${g === "공동" ? "joint" : "watchlist"} 에 종목을 넣으면 여기에 보여요.</div>`;
  drawGauges(list);
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
function boardHTML() {
  const B = BOARD;
  if (!B?.kr && !B?.us) return "";
  const card = (c, kr) => {
    const chg = Object.values(c.chips || {}).some((x) => x?.ch);
    return `<div class="bcard${c.idx ? " idx" : ""}${chg ? " bchg" : ""}"><div class="bhd"><b>${esc(c.name)}</b> <span class="src">${esc(c.idx ? "" : kr ? `${c.sym} ETF` : c.sym)}</span><span class="${kcol(c.chg_d)} bchd">${sg(c.chg_d, 1)}</span></div>
      ${boardSpark(c)}
      <div class="bchips">${chipHTML("일", c.chips?.d)}${chipHTML("주", c.chips?.w)}${chipHTML("월", c.chips?.m)}</div>
      <div class="src bft">1개월 ${sg(c.r1m)} · ${c.idx ? `52주 고점 대비 ${sg(c.dd52)}` : `3개월 상대 ${sg(c.rel3m, 0, "%p")}`}</div></div>`;
  };
  const sec = (t, list, kr) => (list?.length ? `<h3>${t}</h3><div class="bgrid">${list.map((c) => card(c, kr)).join("")}</div>` : "");
  return `<h2>🗺 시장 그룹판 <span class="src">일·주·월 추세 · 2년 주봉 종가와 30주선 · ${esc(B.updated_at || "")}</span></h2>
    <div class="note src">칩: <span class="bchip up">일▲</span> 이평 위·이평 상승 · <span class="bchip down">주▼</span> 이평 아래·이평 하락 · <span class="bchip mix">월▲</span> 엇갈림 · <span class="bchip up chg">일▲</span> 오늘 바뀜 · 일 = 50일선, 주 = 30주선, 월 = 10개월선 · 업종은 3개월 상대수익률(지수 대비) 순 · 주황 테두리 = 오늘 칩이 바뀐 곳</div>
    ${sec("🇰🇷 한국 — 업종은 KRX 업종지수(구성종목 시총 가중)를 따라가는 ETF", B.kr, true)}${sec("🇺🇸 미국 — 지수·섹터·산업 ETF", B.us, false)}`;
}
// 캔들 차트 (일봉 2년 · 주봉 5년 · 월봉 10년): 이평선 · RS 선(지수 대비) · 거래량 · 마지막 가격 · 기준선(전일 종가 / 12주 고점)
function candleSVG(ch, kind, fmt, ref) {
  if (!ch?.c?.length) return "";
  const N = ch.c.length, W = 600, x0 = 4, x1 = 540, top = 14, bot = 168, rs0 = 178, rs1 = 206, v0 = 214, v1 = 250, H = 262, logS = kind !== "d";
  const lows = ch.l.filter((v) => v > 0), his = ch.h.filter((v) => v > 0), lo = Math.min(...lows), hi = Math.max(...his);
  const f = (v) => (logS ? Math.log(v) : v), Y = (v) => bot - ((f(v) - f(lo)) / (f(hi) - f(lo) || 1)) * (bot - top);
  const X = (i) => x0 + ((x1 - x0) * (i + 0.5)) / N, bw = Math.max(0.6, ((x1 - x0) / N) * 0.7);
  let g = "";
  ch.t.forEach((t, i) => { const y = t.slice(0, 2), m = t.slice(3, 5); if (i && t.slice(0, 5) !== ch.t[i - 1].slice(0, 5) && (kind === "d" ? ["01", "07"].includes(m) : m === "01")) g += `<line x1="${X(i)}" x2="${X(i)}" y1="${top}" y2="${v1}" stroke="var(--grid)" stroke-dasharray="2 3"/><text x="${X(i)}" y="${H - 1}" text-anchor="middle" class="qx">${kind === "d" ? `${y}.${m}` : `20${y}`}</text>`; });
  const vmax = Math.max(...ch.v) || 1;
  ch.c.forEach((c, i) => {
    const o = ch.o[i], h = ch.h[i], l = ch.l[i]; if (!(c > 0 && o > 0)) return;
    const col = c >= o ? "var(--bad)" : "var(--s1)";
    g += `<line x1="${X(i)}" x2="${X(i)}" y1="${Y(h)}" y2="${Y(l)}" stroke="${col}" stroke-width="${Math.min(1, bw)}"/>`;
    if (bw >= 1.2) g += `<rect x="${X(i) - bw / 2}" y="${Math.min(Y(o), Y(c))}" width="${bw}" height="${Math.max(0.8, Math.abs(Y(o) - Y(c)))}" fill="${col}"/>`;
    g += `<rect x="${X(i) - bw / 2}" y="${v1 - (ch.v[i] / vmax) * (v1 - v0)}" width="${bw}" height="${(ch.v[i] / vmax) * (v1 - v0)}" fill="${col}" opacity=".35"/>`;
  });
  const maCol = { 50: "var(--ink-2)", 200: "var(--warn)", 10: kind === "m" ? "var(--warn)" : "var(--ink-2)", 30: "var(--warn)" };
  Object.entries(ch.ma || {}).forEach(([k, a]) => { let d = ""; a.forEach((v, i) => { if (v > 0) d += `${d && a[i - 1] > 0 ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; }); g += `<path d="${d}" fill="none" stroke="${maCol[k] || "var(--ink-2)"}" stroke-width="1.5"/>`; });
  if (ch.rs?.length) {
    const rv = ch.rs.filter((v) => v != null), rl = Math.min(...rv), rh = Math.max(...rv), RY = (v) => rs1 - ((v - rl) / (rh - rl || 1)) * (rs1 - rs0);
    let d = ""; ch.rs.forEach((v, i) => { if (v != null) d += `${d ? "L" : "M"}${X(i).toFixed(1)},${RY(v).toFixed(1)}`; });
    g += `<path d="${d}" fill="none" stroke="var(--s7)" stroke-width="1.3"/><text x="${x1 + 6}" y="${RY(rv.at(-1)) + 4}" class="qx" style="fill:var(--s7)">RS</text>`;
  }
  if (ref) g += `<line x1="${x0}" x2="${x1}" y1="${Y(ref.v)}" y2="${Y(ref.v)}" stroke="var(--ink-2)" stroke-dasharray="4 3"/><text x="${x1 - 4}" y="${Y(ref.v) - 4}" text-anchor="end" class="qx">${esc(ref.t)} ${fmt(ref.v)}</text>`;
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
  const m = e.target.closest(".scanmk button"); if (m) { SCAN_MKT = m.dataset.mk; $("#scanBox").outerHTML = scanHTML(); }
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
  return `<div id="scanBox"><h2>🔭 차트 스캔 <span class="src">${SCAN_MKT === "kr" ? "한국 시가총액 상위" : "미국 S&P500"} ${S?.universe || 0}종목 · ${esc(SCAN.updated_at || "")}</span></h2>
    <div class="seg scanmk" style="margin-bottom:8px"><button data-mk="kr" class="${SCAN_MKT === "kr" ? "on" : ""}">🇰🇷 한국</button><button data-mk="us" class="${SCAN_MKT === "us" ? "on" : ""}">🇺🇸 미국</button></div>
    <div class="note src">펀더멘털로 고른 종목을 차트로 확인하는 용도예요 (아이디어 찾기 · 매수/매도 추천 아님). RS = 지수 대비 1년 강도 순위 1~99 (3개월 40% + 6·9·12개월 20%씩)</div>${kinds}</div>`;
}
async function loadIndustry() {
  if (!AMZ) {
    try { AMZ = await (await fetch("data/amazon_kbeauty.json?t=" + Date.now(), { cache: "no-store" })).json(); }
    catch (e) { $("#industryBody").innerHTML = `<div class="empty">산업 데이터를 불러오지 못했어요.</div>`; return; }
  }
  if (!CAPEX) { try { CAPEX = await (await fetch("data/capex.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { CAPEX = {}; } }
  if (!BOARD) { try { BOARD = await (await fetch("data/board.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { BOARD = {}; } }
  if (!SCAN) { try { SCAN = await (await fetch("data/scan.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (_) { SCAN = {}; } }
  $("#industryBody").innerHTML = boardHTML() + scanHTML() + capexHTML() + amzHTML();
  drawAmz();
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
    ${mv ? `<div class="chart-title" style="margin-top:12px"><b>오늘 순위 변동</b> <span class="src">⚡ 크게 오름 · ⚠️ 크게 내림 · ❌ Top100 탈락 · 🆕 새로 진입</span></div><ul class="irl">${mv}</ul>` : ""}
    <div class="chart-title" style="margin-top:12px"><b>추이</b> <span class="src">날마다 쌓여요 · 브랜드를 누르면 나라별</span></div>
    <div class="chips" id="amz-chips" style="margin:6px 0">${chips}</div>
    <div id="amz-leg"></div><div class="chart-box"><canvas id="amz-chart"></canvas></div>
    ${amzCross(A.days[d], cur)}
    <div class="note src">출처: ${esc(A.source || "")}${A.channels ? ` (${Object.entries({ daol: "다올", kyobo: "교보", kmj: "한투" }).map(([k, l]) => `<a href="${esc(A.channels[k])}" target="_blank" rel="noopener">${l}</a>`).join(" · ")})` : ""} · 상장사 연결: 메디큐브 = 에이피알, 달바 = 달바글로벌, COSRX = 아모레퍼시픽 자회사${ds.some((x) => A.days[x].derived) ? ` · ${ds.filter((x) => A.days[x].derived).map((x) => x.slice(5).replace("-", "/")).join(", ")}은 다음 날 표의 ▲▼로 거꾸로 계산` : ""}</div>
  </div>`;
}
// 크로스체크: 다올 표 vs 교보(나라별 K-뷰티 수·브랜드 합계) vs 한투(브랜드×나라, 이탈리아 빼고) — 다른 칸은 빨간 글씨
function amzCross(day, cur) {
  const K = day.kyobo, M = day.kmj, ci = AMZ.countries, IT = ci.indexOf("이탈리아");
  if (!K && !M) return "";
  let bad = 0;
  const td = (v, ref) => { const x = v != null && ref != null && v !== ref; bad += x; return `<td${x ? ' style="color:var(--bad-ink);font-weight:700"' : ""}>${v ?? '<span class="src">–</span>'}</td>`; };
  const src = (o, l) => (o?.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${l}</a>` : l);
  const col = (i) => Object.values(cur).reduce((s, a) => s + (a[i] || 0), 0), all = ci.reduce((s, _, i) => s + col(i), 0);
  let rows = K ? `<tr><td style="text-align:left"><b>K-뷰티 전체</b></td><td>다올</td>${ci.map((_, i) => `<td>${col(i)}</td>`).join("")}<td>${all}</td></tr>
    <tr><td></td><td>${src(K, "교보")}</td>${ci.map((c, i) => td(K.countries?.[c], col(i))).join("")}${td(K.total, all)}</tr>` : "";
  const bs = [...new Set([...Object.keys(M?.brands || {}), ...Object.keys(K?.brands || {}).filter((b) => cur[b])])].sort((a, b) => amzSum(cur[b]) - amzSum(cur[a]));
  for (const b of bs) {
    const v = cur[b] || ci.map(() => 0), m = M?.brands?.[b];
    rows += `<tr style="border-top:1px solid var(--border)"><td style="text-align:left"><b>${esc(b)}</b></td><td>다올</td>${v.map((x) => `<td>${x}</td>`).join("")}<td>${amzSum(v)}</td></tr>`;
    if (m) rows += `<tr><td></td><td>${src(M, "한투")}</td>${ci.map((c, i) => (i === IT ? '<td class="src">안 셈</td>' : td(m[c] || 0, v[i]))).join("")}${td(amzSum(Object.values(m)), amzSum(v) - v[IT])}</tr>`;
    if (K?.brands?.[b] != null) rows += `<tr><td></td><td>${src(K, "교보")}</td><td colspan="${ci.length}" class="src">나라별 숫자 없음</td>${td(K.brands[b], amzSum(v))}</tr>`;
  }
  const R = M?.ranks || {};
  const rk = Object.keys(R).map((b) => `<details ${["메디큐브", "달바"].includes(b) ? "open" : ""}><summary><b>${esc(b)}</b> 제품별 순위 <span class="src">한투 · 숫자 = 그 나라 Top100 순위</span></summary>
    <div class="tbl-wrap"><table class="compact" style="width:100%;text-align:center"><thead><tr><th style="text-align:left">제품</th>${ci.slice(0, IT).map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${Object.entries(R[b]).map(([p, r]) => `<tr><td style="text-align:left">${esc(p)}</td>${ci.slice(0, IT).map((c) => `<td>${r[c] ? (r[c] <= 10 ? `<b>${r[c]}</b>` : r[c]) : '<span class="src">–</span>'}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`).join("");
  return `<div class="chart-title" style="margin-top:14px"><b>🔍 크로스체크 (같은 날 세 채널)</b> <span class="src">${bad ? `다른 칸 ${bad}개 (빨간 글씨) — 채널마다 순위를 잰 시각이 달라서 조금씩 차이가 나요` : "세 채널 숫자가 모두 같아요"} · 한투 합계는 이탈리아 빼고 비교</span></div>
    <div class="tbl-wrap"><table class="compact" style="width:100%;text-align:center"><thead><tr><th style="text-align:left">브랜드</th><th>출처</th>${ci.map((c, i) => `<th>${AMZ.flags?.[i] || ""}</th>`).join("")}<th>합계</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${rk ? `<div style="margin-top:10px">${rk}</div>` : ""}`;
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

/* ---------- 📰 뉴스 탭: 내 종목 · 경쟁사 · 외신 (config/news.yaml, Google 뉴스 30일치 쌓임) ---------- */
let NEWS = null, NEWS_GRP = "전체";
async function loadNews() {
  if (!NEWS) {
    try { NEWS = await (await fetch("data/news.json?t=" + Date.now(), { cache: "no-store" })).json(); }
    catch (e) { $("#newsCards").innerHTML = `<div class="empty">뉴스를 아직 못 받았어요. 다음 데이터 갱신 뒤에 보여요.</div>`; return; }
  }
  const nNew = (r) => ["own", "rivals", "en"].reduce((a, k) => a + (r[k] || []).filter((x) => x.new).length, 0);
  const grps = ["전체", ...new Set(NEWS.stocks.flatMap((r) => [r.group, ...(r.also || [])])), "🆕 새 기사"];
  $("#newsIntro").innerHTML = `${NEWS.stocks.length}개 종목 · 갱신 ${esc(NEWS.updated_at)} · 🆕 = 지난 갱신 뒤 새 기사 · 같은 기사를 여러 언론사가 쓰면 하나로 묶어 '외 N곳'<br><span class="src">${esc(NEWS.source)}</span>`;
  $("#newsGrp").innerHTML = grps.map((g) => `<button data-g="${esc(g)}" class="chip ${g === NEWS_GRP ? "on" : ""}">${esc(g)}</button>`).join("");
  const list = NEWS.stocks.filter((r) => NEWS_GRP === "전체" || r.group === NEWS_GRP || (r.also || []).includes(NEWS_GRP) || (NEWS_GRP === "🆕 새 기사" && nNew(r)));
  $("#newsCards").innerHTML = list.map((r) => newsCard(r, nNew(r))).join("") || `<div class="empty">새 기사가 없어요.</div>`;
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
    <p>마지막 갱신: ${esc(DASH.updated_at)} KST · 갱신 시각: 평일 07:30, 18:30</p>`;
}

async function load() {
  try {
    const r = await fetch("data/dashboard.json?t=" + Date.now(), { cache: "no-store" });
    DASH = await r.json();
    try { PROFILES = await (await fetch("data/profiles.json?t=" + Date.now(), { cache: "no-store" })).json() || {}; } catch (_) { PROFILES = {}; }
    try { EARNINGS = await (await fetch("data/earnings.json?t=" + Date.now(), { cache: "no-store" })).json() || {}; } catch (_) { EARNINGS = {}; }
    try { IRCAL = await (await fetch("data/ir_calendar.json?t=" + Date.now(), { cache: "no-store" })).json() || { items: [] }; } catch (_) { IRCAL = { items: [] }; }
    try { EVENTS = await (await fetch("data/events.json?t=" + Date.now(), { cache: "no-store" })).json() || []; } catch (_) { EVENTS = []; }
    try { SOMONG = await (await fetch("data/somong.json?t=" + Date.now(), { cache: "no-store" })).json() || {}; } catch (_) { SOMONG = {}; }
    try { CAPEX = await (await fetch("data/capex.json?t=" + Date.now(), { cache: "no-store" })).json() || {}; } catch (_) { CAPEX = {}; }  // 🇺🇸 탭 빅테크 현금흐름
  } catch (e) {
    $("#updated").textContent = "데이터를 불러오지 못했어요";
    return;
  }
  renderAll();
  route();
}

for (const id of ["#stockCards", "#watchFull", "#jointCards"]) $(id).addEventListener("click", (e) => {
  const b = e.target.closest(".stock"); if (!b || e.target.closest(".pseg, .scenseg")) return;  // 주가 기간·강세장 탭은 상세로 넘어가지 않음
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
