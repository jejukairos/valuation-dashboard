// ✏️ 내 차트 — 트레이딩뷰처럼 손으로 선 긋는 캔들 차트 (사용자 11/25: 즐겨찾기 3개 = 추세선·가격 범위·가로줄, 일·주·월·연봉,
// 오른쪽 미래 빈칸, 누르면 점선 십자 + 그 날짜, 지금 주가 점선 + 오른쪽 눈금 꼬리표, 선 색·굵기 바꾸기, 도구 막대는 점 6개를 잡고 옮김)
// 캔들: 한국 종목·코스피·코스닥 = /px/{코드} (functions/_middleware.js 가 네이버 일봉 13년을 대신 받아 줌) → 안 되면 data/ohlc/{코드}.json (우리 종목, 미국은 늘 이쪽)
// 그은 선은 이 기기 브라우저에만 저장 (localStorage "draw:코드"). 점은 [날짜, 가격]이라 일·주·월·연봉 어디서나 같은 자리에 보임
// app.js 의 $, esc, n, css, DASH, OHLC 를 그대로 씀 (app.js 다음에 불러옴)
const DW_TF = [["d", "일"], ["w", "주"], ["m", "월"], ["y", "연"]];
const DW_COL = ["ink", "#e0453a", "#f29d38", "#e8c520", "#4caf50", "#26a69a", "#42bcd4", "#2962ff", "#673ab7", "#e91e63"];
const DW_PEN = "#e6aa6e";  // 형광펜 기본색: 사용자 스탁이지 캡처의 줄 색 (250,238,226) 을 흰 바탕·투명도 0.2 로 거꾸로 계산
const DW_ICON = {
  t: '<path d="M8 20L20 8"/><circle cx="6.5" cy="21.5" r="2"/><circle cx="21.5" cy="6.5" r="2"/>',
  r: '<path d="M5 6h14M9 22h14M14 22V9M11 12l3-3 3 3"/><circle cx="21" cy="6" r="2"/><circle cx="7" cy="22" r="2"/>',
  h: '<path d="M3 14h8M17 14h8"/><circle cx="14" cy="14" r="2.5"/>',
  p: '<path d="M9 17l9-9 3 3-9 9H9v-3zM6 23h16"/>',
};
const DW_TOOL = [["t", "추세선: 두 번 누르거나 끌어서 긋기"], ["r", "가격 범위: 두 점 사이가 몇 % 인지"], ["h", "가로줄: 한 번 누르면 그 가격에 줄"], ["p", "형광펜: 손가락으로 끌어서 칠하기"]];
const DW = { code: "", name: "", dec: 0, tf: "w", tool: "", sel: -1, pend: null, cross: null, end: 0, bw: 8, fix: null, pr: [0, 1], grp: "보유", src: {}, B: null, dr: [], extra: [], raf: 0, head: "" };
const DWG = { W: 0, H: 0, pw: 0, ph: 0, ax: 60, bx: 24 };
const dwGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
const dwSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* 사생활 보호 창이면 화면에만 */ } };
const dwClamp = (v, a, b) => Math.max(a, Math.min(b, v));
// 날짜 ↔ 날 번호 (1970-01-01 = 0). shortcut: 두 자리 연도 70~99 = 19xx, 2070년 넘으면 네 자리로
const dwDay = (t) => { const [y, m, d] = t.split("-").map(Number); return Date.UTC((y >= 70 ? 1900 : 2000) + y, m - 1, d) / 864e5; };
const dwYmd = (day) => { const x = new Date(day * 864e5); return [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), x.getUTCDay()]; };
const dwStr = (day) => { const [y, m, d] = dwYmd(day); return `${String(y).slice(2)}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
// 봉 묶기: key(날 번호) 가 같은 봉끼리 시가 = 첫 봉 · 고가 = 최고 · 저가 = 최저 · 종가 = 끝 봉 · 거래량 = 합
function dwAgg(b, key) {
  const o = { t: [], o: [], h: [], l: [], c: [], v: [] };
  b.t.forEach((t, i) => {
    const k = dwStr(key(dwDay(t))), j = o.t.length - 1;
    if (o.t[j] === k) { o.h[j] = Math.max(o.h[j], b.h[i]); o.l[j] = Math.min(o.l[j], b.l[i]); o.c[j] = b.c[i]; o.v[j] += b.v[i]; }
    else { o.t.push(k); o.o.push(b.o[i]); o.h.push(b.h[i]); o.l.push(b.l[i]); o.c.push(b.c[i]); o.v.push(b.v[i]); }
  });
  return o;
}
const dwFri = (d) => d + 5 - ((d + 4) % 7);  // 그 주 금요일 (주봉 날짜, ohlc.py 와 같음)
const dwMonEnd = (d, add = 0) => { const [y, m] = dwYmd(d); return Date.UTC(y, m + 1 + add, 0) / 864e5; };
const dwYearEnd = (d, add = 0) => Date.UTC(dwYmd(d)[0] + add, 11, 31) / 864e5;
// 그 봉 종류의 봉 + 앞으로 빈칸 날짜 (일봉 2년 · 주봉 5년 · 월봉 10년 · 연봉 20년 — 주말만 건너뜀, 공휴일은 모름)
function dwBars(src, tf) {
  const b = tf === "y" ? dwAgg(src.m, dwYearEnd) : src[tf];
  if (!b?.c?.length) return null;
  const T = b.t.map(dwDay), N = T.length;
  let d = T[N - 1];
  for (let k = { d: 520, w: 260, m: 120, y: 20 }[tf]; k > 0; k--) {
    if (tf === "d") { do d++; while ([0, 6].includes((d + 4) % 7)); } else d = tf === "w" ? d + 7 : tf === "m" ? dwMonEnd(d, 1) : dwYearEnd(d, 1);
    T.push(d);
  }
  return { ...b, T, N, tf, hi: Math.max(...b.h) };
}
const dwIdx = (day) => { const T = DW.B.T; let a = 0, z = T.length - 1; while (a < z) { const m = (a + z) >> 1; if (T[m] < day) a = m + 1; else z = m; } return a; };  // 그 날짜가 들어 있는 봉
// 형광펜은 봉 사이 자리도 씀: 봉 번호(소수) ↔ 날 번호(소수)
const dwIdxF = (day) => { const T = DW.B.T, a = dwIdx(day); return a === 0 || T[a] <= day ? a : a - 1 + (day - T[a - 1]) / (T[a] - T[a - 1]); };
const dwDayF = (f) => { const T = DW.B.T, g = dwClamp(f, 0, T.length - 1), i = Math.min(T.length - 2, Math.floor(g)); return T[i] + (g - i) * (T[i + 1] - T[i]); };
const dwX = (i) => DWG.pw - (DW.end - i) * DW.bw, dwI = (x) => DW.end - (DWG.pw - x) / DW.bw;
const dwY = (p) => ((DW.pr[1] - p) / (DW.pr[1] - DW.pr[0])) * DWG.ph, dwP = (y) => DW.pr[1] - (y / DWG.ph) * (DW.pr[1] - DW.pr[0]);
const dwFmt = (v) => n(v, DW.dec);
// 호가 단위로 맞춤 (한국 주식) · 달러·지수는 소수 둘째 자리
const dwTick = (p) => { if (DW.dec) return Math.round(p * 100) / 100; const u = p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000; return Math.round(p / u) * u; };
const dwDateLab = (day, tf) => { const [y, m, d, w] = dwYmd(day); return tf === "y" ? `${y}년` : tf === "m" ? `${y}년 ${m + 1}월` : `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")} (${"일월화수목금토"[w]})${tf === "w" ? " 주" : ""}`; };
// 화면 자리 → {i: 봉 번호(미래 칸 포함), p: 가격}. 약한 자석: 그 봉 시·고·저·종가가 12px 안이면 거기에 붙음
function dwPos(x, y, magnet = true) {
  const b = DW.B, i = dwClamp(Math.round(dwI(x)), 0, b.T.length - 1);
  let p = dwP(y), best = 12;
  if (magnet && i < b.N) for (const v of [b.o[i], b.h[i], b.l[i], b.c[i]]) { const g = Math.abs(dwY(v) - y); if (g < best) { best = g; p = v; } }
  return { i, p: best < 12 ? p : dwTick(p) };
}
const dwPt = (pos) => [DW.B.T[pos.i], pos.p];
const dwPx = (pt) => [dwX(dwIdx(pt[0])), dwY(pt[1])];
const dwSave = () => { dwSet("draw:" + DW.code, DW.dr); };
const dwAsk = () => { if (!DW.raf) DW.raf = requestAnimationFrame(dwRender); };

function dwFit() {  // 처음 화면: 최근 봉들 + 오른쪽 16% 는 미래 빈칸
  const b = DW.B, k = Math.min(b.N, { d: 140, w: 150, m: 150, y: 30 }[b.tf]);
  DW.bw = dwClamp((DWG.pw * 0.82) / k, 1.5, 40);
  DW.end = b.N - 1 + (DWG.pw * 0.16) / DW.bw;
  DW.fix = null;
}
function dwZoom(f, x) { const i = dwI(x); DW.bw = dwClamp(DW.bw * f, 1.2, 80); DW.end = i + (DWG.pw - x) / DW.bw; dwLim(); }
function dwLim() { DW.end = dwClamp(DW.end, 3, DW.B.T.length + 1); }
function dwSize() {
  const cv = $("#dwCv"), r = $("#dwBox").getBoundingClientRect();
  if (!r.width || !DW.B) return;
  const dpr = window.devicePixelRatio || 1, first = !DWG.W;
  DWG.W = r.width; DWG.H = r.height;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const c = cv.getContext("2d"); c.font = "12px system-ui, sans-serif";
  DWG.ax = Math.ceil(c.measureText(dwFmt(DW.B.hi * 1.3)).width) + 16;
  DWG.pw = DWG.W - DWG.ax; DWG.ph = DWG.H - DWG.bx;
  if (first || DW.refit) { dwFit(); DW.refit = false; }  // 폭만 바뀌면 오른쪽 끝 봉은 그대로
  dwToolPos();
  dwAsk();
}

function dwRender() {
  DW.raf = 0;
  const b = DW.B, cv = $("#dwCv");
  if (!b || !DWG.W || $("#drawView").hidden) return;
  const c = cv.getContext("2d"), { W, H, pw, ph } = DWG, dpr = window.devicePixelRatio || 1;
  const K = { bg: css("--surface"), ink: css("--ink"), ink2: css("--ink-2"), grid: css("--grid"), up: css("--bad"), dn: css("--s1"), mut: css("--muted") };
  const col = (v) => (v === "ink" ? K.ink : v);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = K.bg; c.fillRect(0, 0, W, H);
  c.font = "12px system-ui, sans-serif"; c.textBaseline = "middle";
  // 가격 눈금: 보이는 봉의 고가~저가 (아래 28% 는 거래량 자리) · 눈금을 손으로 늘였으면 그대로 (fix)
  const i0 = Math.max(0, Math.ceil(dwI(0))), i1 = Math.min(b.N - 1, Math.floor(dwI(pw)));
  let lo = Infinity, hi = -Infinity, vmax = 1;
  for (let i = i0; i <= i1; i++) { lo = Math.min(lo, b.l[i]); hi = Math.max(hi, b.h[i]); vmax = Math.max(vmax, b.v[i]); }
  if (!(hi > lo)) { const p = b.c[b.N - 1]; lo = p * 0.95; hi = p * 1.05; }
  DW.pr = DW.fix || [lo - (hi - lo) * 0.28, hi + (hi - lo) * 0.08];
  const line = (x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
  const tag = (y, t, bg) => { c.fillStyle = bg; c.fillRect(pw, y - 10, W - pw, 20); c.fillStyle = "#fff"; c.textAlign = "left"; c.fillText(t, pw + 6, y + 0.5); };
  // 눈금 선 (점선) + 숫자
  const nice = (x) => { const e = 10 ** Math.floor(Math.log10(x)), f = x / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };
  const st = nice((DW.pr[1] - DW.pr[0]) / Math.max(2, ph / 46));
  c.strokeStyle = K.grid; c.lineWidth = 1; c.setLineDash([1, 3]); c.fillStyle = K.ink2; c.textAlign = "left";
  for (let p = Math.max(st, Math.ceil(DW.pr[0] / st) * st); p <= DW.pr[1]; p += st) { const y = Math.round(dwY(p)) + 0.5; line(0, y, pw, y); c.fillText(dwFmt(p), pw + 6, y); }
  const ym = (i) => { const [y, m] = dwYmd(b.T[i]); return b.tf === "y" ? y * 12 : y * 12 + m; };
  const ppm = DW.bw * { d: 21, w: 4.35, m: 1, y: 1 / 12 }[b.tf], ms = [1, 2, 3, 6, 12, 24, 60, 120, 240].find((k) => ppm * k >= 64) || 240;
  c.textAlign = "center";
  for (let i = Math.max(1, Math.floor(dwI(0))); i <= Math.min(b.T.length - 1, Math.ceil(dwI(pw))); i++) {
    const k = ym(i); if (k === ym(i - 1) || k % ms) continue;
    const x = Math.round(dwX(i)) + 0.5, yr = k % 12 === 0;
    c.strokeStyle = K.grid; line(x, 0, x, ph);
    c.font = `${yr ? "700 " : ""}12px system-ui, sans-serif`; c.fillStyle = yr ? K.ink : K.ink2; c.fillText(yr ? k / 12 : `${(k % 12) + 1}월`, x, ph + DWG.bx / 2);
  }
  c.font = "12px system-ui, sans-serif"; c.setLineDash([]);
  c.save(); c.beginPath(); c.rect(0, 0, pw, ph); c.clip();
  // 캔들 + 거래량 (한국식: 오르면 빨강 · 내리면 파랑 — 사이트 다른 차트와 같게)
  const bwid = Math.max(1, DW.bw * 0.7), vh = ph * 0.18;
  for (let i = i0; i <= i1; i++) {
    const x = dwX(i), up = b.c[i] >= b.o[i];
    c.fillStyle = c.strokeStyle = up ? K.up : K.dn;
    c.globalAlpha = 0.3; c.fillRect(x - bwid / 2, ph - (b.v[i] / vmax) * vh, bwid, (b.v[i] / vmax) * vh); c.globalAlpha = 1;
    c.lineWidth = 1; line(Math.round(x) + 0.5, dwY(b.h[i]), Math.round(x) + 0.5, dwY(b.l[i]));
    if (bwid >= 2) { const y1 = dwY(Math.max(b.o[i], b.c[i])), y2 = dwY(Math.min(b.o[i], b.c[i])); c.fillRect(x - bwid / 2, y1, bwid, Math.max(1, y2 - y1)); }
  }
  // 보이는 구간 최고가·최저가 숫자 (스탁이지처럼, 사용자 11/25)
  if (i1 > i0) {
    const mark = (i, v) => { const x = dwX(i), y = dwY(v), left = x > pw - 90; c.strokeStyle = c.fillStyle = K.ink2; c.lineWidth = 1; line(x, y, x + (left ? -8 : 8), y); c.textAlign = left ? "right" : "left"; c.fillText(dwFmt(v), x + (left ? -10 : 10), y); };
    let hI = i0, lI = i0;
    for (let i = i0; i <= i1; i++) { if (b.h[i] > b.h[hI]) hI = i; if (b.l[i] < b.l[lI]) lI = i; }
    mark(hI, b.h[hI]); mark(lI, b.l[lI]);
  }
  // 지금 주가: 점선 (그 봉 종류의 앞 봉 종가보다 오르면 빨강)
  const last = b.c[b.N - 1], prev = b.c[b.N - 2] ?? b.o[b.N - 1], nowCol = last >= prev ? K.up : K.dn, yl = Math.round(dwY(last)) + 0.5;
  c.strokeStyle = nowCol; c.setLineDash([2, 3]); line(0, yl, pw, yl); c.setLineDash([]);
  // 내가 그은 선
  const tags = [];
  const dot = (x, y, cl) => { c.beginPath(); c.arc(x, y, 5, 0, 7); c.fillStyle = K.bg; c.fill(); c.strokeStyle = cl; c.lineWidth = 2; c.stroke(); };
  const shape = (d, sel) => {
    const cl = col(d.c);
    c.strokeStyle = cl; c.lineWidth = d.w || 1;
    if (d.k === "p") {  // 형광펜: 굵고 비치는 손 그림 (고르면 가운데 점선) — 스탁이지 기본값 그대로 (사용자 11/25): 굵기 5 × 4 = 20px · 투명도 0.2 · 둥근 끝 · 부드러운 곡선
      const P = d.pts.map((q) => [dwX(dwIdxF(q[0])), dwY(q[1])]);
      c.beginPath(); c.moveTo(P[0][0], P[0][1]);
      for (let j = 1; j < P.length - 1; j++) c.quadraticCurveTo(P[j][0], P[j][1], (P[j][0] + P[j + 1][0]) / 2, (P[j][1] + P[j + 1][1]) / 2);
      c.lineTo(P.at(-1)[0], P.at(-1)[1]);
      c.globalAlpha = 0.2; c.lineWidth = 5 * (d.w || 4); c.lineCap = c.lineJoin = "round"; c.stroke(); c.globalAlpha = 1; c.lineCap = "butt";
      if (sel) { c.lineWidth = 1.5; c.setLineDash([4, 3]); c.stroke(); c.setLineDash([]); }
      return;
    }
    const [xa, ya] = dwPx(d.a), [xb, yb] = d.b ? dwPx(d.b) : [xa, ya];
    if (d.k === "h") { line(0, Math.round(ya) + 0.5, pw, Math.round(ya) + 0.5); tags.push([ya, dwFmt(d.a[1]), cl]); if (sel) dot(pw - 46, ya, cl); return; }
    if (d.k === "t") { line(xa, ya, xb, yb); if (sel) { dot(xa, ya, cl); dot(xb, yb, cl); } return; }
    // 가격 범위: 두 가격에 짧은 가로줄 + 가운데 화살표 + '차이 (몇 %)' 꼬리표
    const xm = (xa + xb) / 2, dir = yb < ya ? -1 : 1, dp = d.b[1] - d.a[1];
    c.globalAlpha = 0.08; c.fillStyle = cl; c.fillRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya)); c.globalAlpha = 1;
    line(Math.min(xa, xb) - 8, ya, Math.max(xa, xb) + 8, ya); line(Math.min(xa, xb) - 8, yb, Math.max(xa, xb) + 8, yb); line(xm, ya, xm, yb);
    if (Math.abs(yb - ya) > 8) { c.beginPath(); c.moveTo(xm - 6, yb - dir * 8); c.lineTo(xm, yb); c.lineTo(xm + 6, yb - dir * 8); c.stroke(); }
    const t = `${dp > 0 ? "+" : dp < 0 ? "−" : ""}${dwFmt(Math.abs(dp))} (${dp > 0 ? "+" : dp < 0 ? "−" : ""}${n(Math.abs(dp / d.a[1]) * 100, 2)}%)`;
    c.font = "13px system-ui, sans-serif"; const tw = c.measureText(t).width + 16, tx = dwClamp(xm - tw / 2, 2, pw - tw - 2), ty = dwClamp(yb + dir * 20, 14, ph - 14);
    c.fillStyle = K.bg; c.strokeStyle = K.grid; c.lineWidth = 1; c.beginPath(); c.roundRect(tx, ty - 12, tw, 24, 6); c.fill(); c.stroke();
    c.fillStyle = K.ink; c.textAlign = "center"; c.fillText(t, tx + tw / 2, ty + 0.5); c.font = "12px system-ui, sans-serif";
    if (sel) { dot(xa, ya, cl); dot(xb, yb, cl); }
  };
  DW.dr.forEach((d, k) => shape(d, k === DW.sel));
  if (DW.ink) shape({ k: "p", pts: DW.ink, c: DW_PEN, w: 4 });
  if (DW.pend) { const a = dwPt(DW.pend.a); if (DW.pend.b) shape({ k: DW.tool, a, b: dwPt(DW.pend.b), c: DW.tool === "t" ? "ink" : "#2962ff", w: 1 }, true); else dot(...dwPx(a), "#2962ff"); }
  c.restore();
  tags.forEach(([y, t, cl]) => { if (y > 8 && y < ph - 8) tag(y, t, cl); });
  if (yl > 0 && yl < ph) tag(yl, dwFmt(last), nowCol);
  // 십자선: 점선 + 아래 날짜 꼬리표 + 오른쪽 가격 꼬리표 (미래 칸도 날짜가 나옴)
  const X = DW.cross;
  if (X) {
    const x = Math.round(dwX(X.i)) + 0.5, y = Math.round(dwY(X.p)) + 0.5;
    c.strokeStyle = K.mut; c.lineWidth = 1; c.setLineDash([4, 4]);
    if (x > 0 && x < pw) line(x, 0, x, ph);
    if (y > 0 && y < ph) line(0, y, pw, y);
    c.setLineDash([]);
    if (y > 0 && y < ph) tag(y, dwFmt(X.p), K.ink2);
    if (x > 0 && x < pw) { const t = dwDateLab(b.T[X.i], b.tf), tw = c.measureText(t).width + 14, tx = dwClamp(x - tw / 2, 0, W - tw);
      c.fillStyle = K.ink2; c.fillRect(tx, ph + 1, tw, DWG.bx - 2); c.fillStyle = "#fff"; c.textAlign = "center"; c.fillText(t, tx + tw / 2, ph + DWG.bx / 2); }
  }
  // 왼쪽 위 글: 이름 · 봉 종류 / 지금 주가·등락 / 십자선이 봉 위면 그 봉 시·고·저·종·거래량
  const ch = last - prev, i = X && X.i < b.N ? X.i : -1;
  const head = `<b>${esc(DW.name)}</b> · 1${{ d: "일", w: "주", m: "달", y: "년" }[b.tf]}<br><span style="color:${nowCol}">${dwFmt(last)} ${ch >= 0 ? "+" : "−"}${dwFmt(Math.abs(ch))} (${ch >= 0 ? "+" : "−"}${n(Math.abs(ch / prev) * 100, 2)}%)</span>`
    + (i >= 0 ? `<br><span class="src">${dwDateLab(b.T[i], b.tf)} · 시 ${dwFmt(b.o[i])} · 고 ${dwFmt(b.h[i])} · 저 ${dwFmt(b.l[i])} · 종 ${dwFmt(b.c[i])} · 거래량 ${n(b.v[i])}</span>` : "");
  if (head !== DW.head) $("#dwHead").innerHTML = DW.head = head;
}

// 누른 자리에 있는 내 선 (위에 그린 것부터) · 선택된 선의 손잡이: "a"·"b" = 끝점, "m" = 몸통
const dwSegD = (x, y, x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, t = dwClamp(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1), 0, 1); return Math.hypot(x - x1 - t * dx, y - y1 - t * dy); };
function dwHit(d, x, y) {
  if (d.k === "p") { const P = d.pts.map((q) => [dwX(dwIdxF(q[0])), dwY(q[1])]); return P.some((q, j) => j && dwSegD(x, y, ...P[j - 1], ...q) <= 14) ? "m" : null; }
  const [xa, ya] = dwPx(d.a), [xb, yb] = d.b ? dwPx(d.b) : [xa, ya];
  if (d.k === "h") return Math.abs(y - ya) <= 12 ? "m" : null;
  if (Math.hypot(x - xa, y - ya) <= 16) return "a";
  if (Math.hypot(x - xb, y - yb) <= 16) return "b";
  if (d.k === "t") return dwSegD(x, y, xa, ya, xb, yb) <= 12 ? "m" : null;
  return x >= Math.min(xa, xb) - 12 && x <= Math.max(xa, xb) + 12 && y >= Math.min(ya, yb) - 12 && y <= Math.max(ya, yb) + 12 ? "m" : null;
}
const dwFind = (x, y) => { for (let k = DW.dr.length - 1; k >= 0; k--) if (dwHit(DW.dr[k], x, y)) return k; return -1; };
function dwAdd(d) { DW.dr.push(d); DW.sel = -1; DW.tool = ""; DW.pend = null; dwSave(); dwUi(); dwPickDraw(); }  // 긋고 나면 색 막대는 안 뜸 — 선을 눌러야 나옴 (사용자 11/25)
const DW_FS = ['<path d="M4 10V4h6M18 4h6v6M24 18v6h-6M10 24H4v-6"/>', '<path d="M10 4v6H4M24 10h-6V4M18 24v-6h6M4 18h6v6"/>'];  // 전체 화면 켜기 · 끄기
// 전체 화면: 차트 칸을 화면에 꽉 채움 + 브라우저 주소 줄도 숨김 (안 되는 브라우저는 꽉 채우기만)
function dwFull(on) {
  const box = $("#dwBox");
  box.classList.toggle("full", on);
  try { if (on) box.requestFullscreen().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen(); } catch (_) { /* 꽉 채우기만 */ }
  dwUi();
}

// 도구 막대 (즐겨찾기 3개, 점 6개를 잡고 옮김) · 선을 고르면 색·굵기·지우기 막대
function dwUi() {
  $("#dwTools").innerHTML = `<span class="dwgrip" title="잡고 옮기기">⋮⋮</span>` + DW_TOOL.map(([k, t]) => `<button data-tool="${k}" class="${DW.tool === k ? "on" : ""}" title="${t}" aria-label="${t}"><svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6">${DW_ICON[k]}</svg></button>`).join("");
  const d = DW.dr[DW.sel], e = $("#dwEdit");
  e.hidden = !d;
  if (d) e.innerHTML = DW_COL.map((v) => `<button data-c="${v}" class="dwsw${d.c === v ? " on" : ""}" style="background:${v === "ink" ? "var(--ink)" : v}" aria-label="색"></button>`).join("")
    + [1, 2, 3, 4].map((w) => `<button data-w="${w}" class="${(d.w || 1) === w ? "on" : ""}" aria-label="굵기 ${w}"><i style="border-top-width:${w}px"></i>${w}px</button>`).join("") + `<button data-del="1" title="이 선 지우기">🗑</button><button data-x="1" title="이 막대 닫기" aria-label="닫기">✕</button>`;
  const full = $("#dwBox").classList.contains("full");
  $("#dwFs").innerHTML = `<svg viewBox="0 0 28 28" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8">${DW_FS[+full]}</svg>`;
  $("#dwFs").title = full ? "전체 화면 끄기" : "전체 화면";
  $("#dwBtns").innerHTML = `${full ? DW_TF.map(([k, l]) => `<button data-tf="${k}" class="${k === DW.tf ? "on" : ""}">${l}</button>`).join("") : ""}${DW.fix ? `<button data-auto="1">↕ 눈금 자동</button>` : ""}<button data-fit="1">↺ 처음 화면</button>${DW.dr.length ? `<button data-all="1">${DW.arm ? "한 번 더 누르면 전부 지움" : "🗑 선 전부"}</button>` : ""}`;
  dwAsk();
}
function dwToolPos() {  // 저장해 둔 자리 (차트 밖으로 못 나가게)
  const t = $("#dwTools"), p = dwGet("draw:tb", null) || { x: 10, y: 66 };
  t.style.left = dwClamp(p.x, 0, Math.max(0, DWG.pw - 150)) + "px"; t.style.top = dwClamp(p.y, 0, Math.max(0, DWG.ph - 50)) + "px";
  $("#dwFs").style.right = DWG.ax + 6 + "px";  // 오른쪽 가격 눈금 바로 왼쪽
}

// 종목 고르기: 보유 · 관심 · 공동 · 🔎 지수·검색 (찾은 한국 종목은 이 기기에 남음) + 일·주·월·연
function dwPickDraw() {
  const list = DW.grp === "검색" ? DW.extra : DASH.stocks.filter((c) => (c.group || "보유") === DW.grp);
  const has = (code) => (dwGet("draw:" + code, []) || []).length;
  $("#dwPick").innerHTML = `<div class="dwbar"><div class="seg">${["보유", "관심", "공동", "검색"].map((g) => `<button data-g="${g}" class="${g === DW.grp ? "on" : ""}">${g === "검색" ? "🔎 종목 검색" : g}</button>`).join("")}</div>
    <div class="seg">${DW_TF.map(([k, l]) => `<button data-tf="${k}" class="${k === DW.tf ? "on" : ""}">${l}</button>`).join("")}</div></div>
    ${DW.grp === "검색" ? `<div class="dwq"><input id="dwQ" class="sel" type="search" placeholder="종목 이름·코드 (한국·미국, 예: 하나머티, 엔비디아)" autocomplete="off"><div class="dwlist" id="dwQr"></div></div>` : ""}
    <div class="dwlist">${list.map((c) => `<button class="chip${c.code === DW.code ? " on" : ""}" data-code="${esc(c.code)}">${has(c.code) ? "✏️ " : ""}${esc(c.name)}</button>`).join("")}
    ${DW.grp === "검색" && DW.extra.some((c) => c.code === DW.code && !c.keep) ? `<button class="chip" data-rm="${esc(DW.code)}">− 목록에서 빼기</button>` : ""}</div>`;
}
let dwQT = 0;
async function dwSearch(q) {
  const box = $("#dwQr"); if (!box) return;
  if (!q.trim()) { box.innerHTML = ""; return; }
  try {
    const r = await fetch("/pxq?q=" + encodeURIComponent(q.trim())), L = r.ok ? await r.json() : null;
    if ($("#dwQ")?.value !== q) return;  // 그 사이 글자가 바뀜
    box.innerHTML = L ? (L.length ? L.map((x) => `<button class="chip" data-add="${esc(x.code)}" data-tk="${esc(x.tk || "")}" data-nm="${esc(x.name)}" data-idx="${x.idx ? 1 : ""}">＋ ${esc(x.name)} <span class="src">${esc(x.type || "")}</span></button>`).join("") : `<span class="src">못 찾았어요</span>`)
      : `<span class="src">검색이 안 돼요 (서버 응답 ${r.status})</span>`;
  } catch (_) { box.innerHTML = `<span class="src">검색이 안 돼요 (인터넷 확인)</span>`; }
}

async function dwLoad(code, us) {
  if (DW.src[code]) return DW.src[code];
  let s = null;
  if (!us) try {  // 한국: 네이버 일봉 13년 (서버가 대신 받음) → 주봉·월봉은 여기서 묶음
    const r = await fetch("/px/" + encodeURIComponent(code));
    if (r.ok) { const d = await r.json(); if (d?.c?.length) s = { d, w: dwAgg(d, dwFri), m: dwAgg(d, dwMonEnd), at: "네이버 일봉 (KRX)" }; }
  } catch (_) { /* 아래 파일로 */ }
  if (!s) try { OHLC[code] = OHLC[code] || await (await fetch(`data/ohlc/${code}.json?v=${encodeURIComponent(DASH.updated_at)}`)).json(); s = OHLC[code]; } catch (_) { /* 자료 없음 */ }
  return (DW.src[code] = s);
}
async function dwOpen(code) {
  if (!DW.init) dwInit();
  const own = (c) => DASH.stocks.find((x) => x.code === c), last = dwGet("draw:last", {});
  code = code || DW.code || last.code || DASH.stocks[0].code;
  const o = own(code), ex = DW.extra.find((x) => x.code === code);
  if (!o && !ex) return dwOpen(DASH.stocks[0].code);
  if (code !== DW.code || !DW.B) {
    DW.code = code; DW.name = (o || ex).name; DW.dec = o ? (o.currency === "USD" ? 2 : 0) : ex.idx ? 2 : 0;
    DW.grp = !o ? "검색" : DASH.stocks.some((x) => x.code === code && (x.group || "보유") === DW.grp) ? DW.grp : o.group || "보유";  // 보유·공동 둘 다 있는 종목은 보던 묶음 그대로
    DW.dr = dwGet("draw:" + code, []) || []; DW.sel = -1; DW.pend = null; DW.cross = null; DW.tool = ""; DW.B = null; DW.head = "";
    dwPickDraw(); dwUi();
    $("#dwHead").innerHTML = `<b>${esc(DW.name)}</b><br><span class="src">불러오는 중…</span>`;
    const s = await dwLoad(code, o?.market === "US");
    if (DW.code !== code) return;  // 그 사이 다른 종목을 누름
    if (!s) { $("#dwHead").innerHTML = `<b>${esc(DW.name)}</b><br><span class="src">캔들 자료를 못 받았어요</span>`; return; }
    dwSet("draw:last", { code, tf: DW.tf });
    dwTf(DW.tf);
  } else dwSize();
}
function dwTf(tf) {
  const s = DW.src[DW.code]; if (!s) return;
  DW.tf = tf; DW.B = dwBars(s, tf) || dwBars(s, "d"); DW.cross = null; DW.pend = null; DW.refit = true; DW.head = "";
  dwSet("draw:last", { code: DW.code, tf });
  dwPickDraw(); dwUi(); dwSize();
}

function dwInit() {
  DW.init = true;
  const last = dwGet("draw:last", {});
  DW.tf = DW_TF.some(([k]) => k === last.tf) ? last.tf : "w";
  DW.extra = dwGet("draw:extra", null) || [{ code: "KOSPI", name: "코스피", idx: 1, keep: 1 }, { code: "KOSDAQ", name: "코스닥", idx: 1, keep: 1 }];
  const cv = $("#dwCv"), box = $("#dwBox"), PT = new Map();
  let g0 = null, pz = null, tapAt = 0;
  new ResizeObserver(dwSize).observe(box);
  const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener("pointerdown", (e) => {
    if (!DW.B) return;
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 점검용 가짜 누름은 못 잡음 */ }
    const p = at(e); PT.set(e.pointerId, p);
    if (PT.size === 2) { const [a, b] = [...PT.values()]; pz = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, bw: DW.bw, i: dwI((a.x + b.x) / 2) }; g0 = null; DW.ink = null; if (DW.pend?.fresh) DW.pend = null; return; }
    const sel = DW.dr[DW.sel];
    let mode = "pan", hit = null;
    if (p.x > DWG.pw) mode = "axis";
    else if (p.y > DWG.ph) mode = "pan";
    else if (DW.tool === "t" || DW.tool === "r") { mode = "draw"; if (!DW.pend) DW.pend = { a: dwPos(p.x, p.y), fresh: true }; }
    else if (DW.tool === "h") mode = "tap";
    else if (DW.tool === "p") { mode = "pen"; DW.ink = [[dwDayF(dwI(p.x)), dwP(p.y)]]; }
    else if (sel && (hit = dwHit(sel, p.x, p.y))) mode = "edit";
    g0 = { ...p, mode, hit, end: DW.end, fix: [...(DW.fix || DW.pr)], moved: false, orig: sel && JSON.parse(JSON.stringify(sel)), pos: dwPos(p.x, p.y, false) };
    dwAsk();
  });
  cv.addEventListener("pointermove", (e) => {
    if (!DW.B) return;
    const p = at(e);
    if (PT.has(e.pointerId)) PT.set(e.pointerId, p);
    if (pz && PT.size === 2) {  // 두 손가락: 벌리면 봉이 커짐
      const [a, b] = [...PT.values()], mx = (a.x + b.x) / 2;
      DW.bw = dwClamp((pz.bw * Math.hypot(a.x - b.x, a.y - b.y)) / pz.d, 1.2, 80); DW.end = pz.i + (DWG.pw - mx) / DW.bw; dwLim(); return dwAsk();
    }
    if (!g0) {  // 마우스를 그냥 움직일 때: 십자선 · 긋는 중이면 미리 보기
      if (e.pointerType !== "mouse" || PT.size) return;
      if (DW.pend) DW.pend.b = dwPos(p.x, p.y); else DW.cross = p.x < DWG.pw && p.y < DWG.ph ? dwPos(p.x, p.y, false) : null;
      return dwAsk();
    }
    const dx = p.x - g0.x, dy = p.y - g0.y;
    if (!g0.moved && Math.hypot(dx, dy) < 8) return;
    g0.moved = true;
    if (g0.mode === "axis") { const f = Math.exp(dy * 0.006), m = (g0.fix[0] + g0.fix[1]) / 2, h = ((g0.fix[1] - g0.fix[0]) / 2) * f; if (!DW.fix) dwUiSoon(); DW.fix = [m - h, m + h]; }
    else if (g0.mode === "pan") { DW.end = g0.end - dx / DW.bw; dwLim(); if (DW.fix) { const s = (dy / DWG.ph) * (g0.fix[1] - g0.fix[0]); DW.fix = [g0.fix[0] + s, g0.fix[1] + s]; } }
    else if (g0.mode === "draw") DW.pend.b = dwPos(p.x, p.y);
    else if (g0.mode === "pen") DW.ink.push([dwDayF(dwI(p.x)), dwP(p.y)]);
    else if (g0.mode === "edit") {
      const d = DW.dr[DW.sel], o = g0.orig, T = DW.B.T;
      if (d.k === "p") { const df = dx / DW.bw, dp = dwP(p.y) - dwP(g0.y); d.pts = o.pts.map((q) => [dwDayF(dwIdxF(q[0]) + df), q[1] + dp]); }
      else if (g0.hit === "m") { const q = dwPos(p.x, p.y, false), di = q.i - g0.pos.i, dp = dwP(p.y) - dwP(g0.y);
        for (const k of ["a", "b"]) if (o[k]) d[k] = [T[dwClamp(dwIdx(o[k][0]) + di, 0, T.length - 1)], dwTick(o[k][1] + dp)];
        if (d.k === "h") d.a[1] = dwPos(p.x, p.y).p; }
      else d[g0.hit] = dwPt(dwPos(p.x, p.y));
    }
    dwAsk();
  });
  const up = (e) => {
    const p = at(e); PT.delete(e.pointerId);
    if (pz) { if (PT.size < 2) pz = null; g0 = null; return; }
    const g = g0; g0 = null;
    if (!g || !DW.B) return;
    if (g.mode === "pen") { const pts = DW.ink; DW.ink = null; if (pts && pts.length > 2) return dwAdd({ k: "p", pts: pts.map(([d, v]) => [Math.round(d * 100) / 100, dwTick(v)]), c: DW_PEN, w: 4 }); return dwAsk(); }
    if (g.mode === "draw") {
      const q = dwPos(p.x, p.y), a = DW.pend.a;
      if (!g.moved && DW.pend.fresh) { DW.pend.fresh = false; return dwAsk(); }  // 첫 점만 찍음 → 두 번째 누름을 기다림
      if (q.i === a.i && q.p === a.p) return dwAsk();
      return dwAdd({ k: DW.tool, a: dwPt(a), b: dwPt(q), c: DW.tool === "t" ? "ink" : "#2962ff", w: 1 });
    }
    if (g.moved) { if (g.mode === "edit") dwSave(); return dwAsk(); }
    if (g.mode === "axis") { const now = Date.now(); if (now - tapAt < 400) { DW.fix = null; dwUi(); } tapAt = now; return; }  // 눈금을 두 번 누르면 자동으로
    if (p.y > DWG.ph) return;
    if (g.mode === "tap") { const q = dwPos(p.x, p.y); return dwAdd({ k: "h", a: dwPt(q), c: "#2962ff", w: 1 }); }
    const k = dwFind(p.x, p.y);
    if (k >= 0) { DW.sel = k; DW.cross = null; }
    else { const q = dwPos(p.x, p.y, false), X = DW.cross; DW.sel = -1; DW.cross = X && Math.hypot(dwX(X.i) - p.x, dwY(X.p) - p.y) < 14 ? null : q; }  // 십자선 자리를 다시 누르면 숨김
    dwUi();
  };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  cv.addEventListener("wheel", (e) => { if (!DW.B) return; e.preventDefault(); dwZoom(Math.exp(-e.deltaY * 0.0015), at(e).x); dwAsk(); }, { passive: false });
  cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !g0 && DW.cross) { DW.cross = null; dwAsk(); } });
  $("#dwTools").addEventListener("click", (e) => { const b = e.target.closest("[data-tool]"); if (!b) return; DW.tool = DW.tool === b.dataset.tool ? "" : b.dataset.tool; DW.pend = null; DW.sel = -1; DW.cross = null; dwUi(); });
  // 점 6개를 잡고 도구 막대 옮기기
  let tb = null;
  $("#dwTools").addEventListener("pointerdown", (e) => { if (!e.target.closest(".dwgrip")) return; const t = $("#dwTools"); t.setPointerCapture(e.pointerId); tb = { x: e.clientX - t.offsetLeft, y: e.clientY - t.offsetTop }; });
  $("#dwTools").addEventListener("pointermove", (e) => { if (!tb) return; dwSet("draw:tb", { x: e.clientX - tb.x, y: e.clientY - tb.y }); dwToolPos(); });
  $("#dwTools").addEventListener("pointerup", () => { tb = null; });
  $("#dwEdit").addEventListener("click", (e) => {
    const b = e.target.closest("button"), d = DW.dr[DW.sel]; if (!b || !d) return;
    if (b.dataset.x) { DW.sel = -1; return dwUi(); }  // ✕ = 막대만 닫기
    if (b.dataset.c) d.c = b.dataset.c; else if (b.dataset.w) d.w = +b.dataset.w; else { DW.dr.splice(DW.sel, 1); DW.sel = -1; }
    dwSave(); dwUi(); if (b.dataset.del) dwPickDraw();
  });
  $("#dwBtns").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.tf) return dwTf(b.dataset.tf);  // 전체 화면일 때만 나오는 일·주·월·연
    if (b.dataset.auto) DW.fix = null;
    else if (b.dataset.fit) dwFit();
    else if (!DW.arm) { DW.arm = true; setTimeout(() => { DW.arm = false; dwUi(); }, 3000); }  // 실수로 전부 지우지 않게 두 번 누르기
    else { DW.arm = false; DW.dr = []; DW.sel = -1; dwSave(); dwPickDraw(); }
    dwUi();
  });
  $("#dwPick").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const s = b.dataset;
    if (s.g) { DW.grp = s.g; dwPickDraw(); $("#dwQ")?.focus(); }
    else if (s.tf) dwTf(s.tf);
    else if (s.code) location.hash = "#draw/" + s.code;
    else if (s.add) { const mine = DASH.stocks.find((c) => c.code === s.tk);  // 미국 종목이 이미 내 종목이면 그 차트로 (선이 두 군데로 갈리지 않게)
      if (mine) return void (location.hash = "#draw/" + mine.code);
      if (!DASH.stocks.some((c) => c.code === s.add) && !DW.extra.some((c) => c.code === s.add)) { DW.extra.push({ code: s.add, name: s.nm, idx: s.idx ? 1 : 0 }); dwSet("draw:extra", DW.extra); } location.hash = "#draw/" + s.add; }
    else if (s.rm) { DW.extra = DW.extra.filter((c) => c.code !== s.rm); dwSet("draw:extra", DW.extra); location.hash = "#draw/KOSPI"; }
  });
  $("#dwFs").addEventListener("click", () => dwFull(!box.classList.contains("full")));
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && box.classList.contains("full")) dwFull(false); });  // 뒤로 가기·Esc 로 나왔을 때
  $("#dwPick").addEventListener("input", (e) => { if (e.target.id !== "dwQ") return; clearTimeout(dwQT); const q = e.target.value; dwQT = setTimeout(() => dwSearch(q), 300); });
  document.addEventListener("keydown", (e) => {
    if ($("#drawView").hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === "Escape") { DW.tool = ""; DW.pend = null; DW.sel = -1; dwUi(); }
    if ((e.key === "Delete" || e.key === "Backspace") && DW.dr[DW.sel]) { DW.dr.splice(DW.sel, 1); DW.sel = -1; dwSave(); dwUi(); dwPickDraw(); }
  });
}
let dwUiT = 0;
function dwUiSoon() { clearTimeout(dwUiT); dwUiT = setTimeout(dwUi, 0); }  // 눈금을 처음 늘일 때 '↕ 눈금 자동' 버튼이 나오게

// 자체 점검 (화면 점검 스크립트가 부름): 봉 묶기 · 미래 날짜 · 날짜 → 봉 번호
function dwTest() {
  const d = { t: ["26-11-23", "26-11-24", "26-11-25", "26-11-30", "26-12-01"], o: [10, 12, 11, 13, 14], h: [13, 14, 12, 15, 16], l: [9, 11, 8, 12, 13], c: [12, 11, 9, 14, 15], v: [1, 2, 3, 4, 5] };
  const w = dwAgg(d, dwFri), m = dwAgg(d, dwMonEnd), ok = (c, t) => { if (!c) throw new Error("dwTest: " + t); };
  ok(w.t.join() === "26-11-27,26-12-04" && w.o[0] === 10 && w.h[0] === 14 && w.l[0] === 8 && w.c[0] === 9 && w.v[0] === 6, "주봉 " + JSON.stringify(w));
  ok(m.t.join() === "26-11-30,26-12-31" && m.c[0] === 14 && m.v[1] === 5, "월봉 " + JSON.stringify(m));
  const keep = DW.B;
  DW.B = dwBars({ d, w, m }, "d"); ok(dwStr(DW.B.T[5]) === "26-12-02" && dwStr(DW.B.T[8]) === "26-12-07", "일봉 미래 (주말 건너뜀)");
  DW.B = dwBars({ d, w, m }, "w"); ok(dwIdx(dwDay("26-11-25")) === 0 && dwIdx(dwDay("26-12-01")) === 1 && dwStr(DW.B.T[2]) === "26-12-11", "주봉 날짜 자리");
  DW.B = dwBars({ d, w, m }, "m"); ok(dwStr(DW.B.T[2]) === "27-01-31" && dwStr(DW.B.T[3]) === "27-02-28", "월봉 미래");
  DW.B = dwBars({ d, w, m }, "y"); ok(DW.B.N === 1 && DW.B.h[0] === 16 && dwStr(DW.B.T[1]) === "27-12-31", "연봉");
  DW.B = keep;
  return "ok";
}
