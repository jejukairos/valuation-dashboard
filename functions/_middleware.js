// 사이트 전체 비밀번호 잠금 (Cloudflare Pages Functions, 무료).
// 비밀번호는 Cloudflare 화면의 환경 변수 SITE_PASSWORD 에 넣는다. 코드에는 비밀번호가 없다.
const COOKIE = "vd_auth";
const DAYS = 30;

async function token(pw) {
  const data = new TextEncoder().encode("valuation-dashboard:" + pw);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function page(msg) {
  return new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>밸류 신호등 · 로그인</title><style>
:root{color-scheme:light dark}body{margin:0;font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#f9f9f7;color:#0b0b0b;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
@media (prefers-color-scheme:dark){body{background:#0d0d0d;color:#fff}input{background:#1a1a19;color:#fff}}
form{width:100%;max-width:340px}h1{font-size:22px}input,button{width:100%;font-size:18px;padding:14px;border-radius:12px;border:1px solid #c3c2b7;box-sizing:border-box;margin-top:10px}
button{background:#2a78d6;color:#fff;border:0;font-weight:700}p{color:#d03b3b;font-size:14px}</style></head>
<body><form method="post"><h1>🚦 밸류 신호등</h1><input type="password" name="pw" placeholder="비밀번호" autocomplete="current-password" autofocus required>
<button type="submit">들어가기</button>${msg ? `<p>${msg}</p>` : ""}</form></body></html>`,
    // 401 로 보내면 일부 휴대폰 브라우저가 자체 오류 화면을 띄워서 200 으로 보낸다
    { status: 200, headers:{ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

// Cloudflare 의 "Build output directory" 가 site 가 아니라 저장소 맨 위(/)로 돼 있어도
// 화면 파일(site/ 폴더)을 찾아서 보여준다.
async function serveSite(ctx) {
  const url = new URL(ctx.request.url);
  const res = await ctx.next();
  if (res.status !== 404 || url.pathname.startsWith("/site/")) return res;
  const alt = new URL(url);
  alt.pathname = "/site" + (url.pathname === "/" ? "/index.html" : url.pathname);
  let r = await ctx.next(new Request(alt, ctx.request));
  // /site/index.html → /site/ 같은 자동 이동은 안에서 따라간다 (주소창은 그대로)
  for (let i = 0; i < 3 && r.status >= 300 && r.status < 400 && r.headers.get("location"); i++) {
    r = await ctx.next(new Request(new URL(r.headers.get("location"), alt), ctx.request));
  }
  return r;
}

// ✏️ 내 차트 (site/draw.js): 한국 종목·코스피·코스닥 일봉 13년을 네이버 차트 자료에서 대신 받아 줌 (로그인한 사람만) — /px/<코드>
// 거래 정지 날은 시가·고가·저가가 0 이라 종가로 채움. 수정주가 · KRX 만 (넥스트레이드 뺌)
const NV = { headers: { "user-agent": "Mozilla/5.0" } };
const J = (v, status = 200, age = 0) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": age ? `private, max-age=${age}` : "no-store" } });
async function px(code) {
  const fx = /^[A-Za-z0-9]{1,10}\.[A-Za-z]{0,3}$/.test(code);  // 해외 종목 = 네이버 해외 코드에 점 (NVDA.O · 점 없는 뉴욕 종목은 끝에 점: KO.) — 사용자 11/25 '검색하면 다 보이게'
  if (!fx && !/^[A-Z0-9]{2,12}$/.test(code)) return J({ err: "잘못된 코드" }, 400);
  const now = new Date(Date.now() + 9 * 36e5), ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, ""), from = ymd(new Date(now - 13 * 365.25 * 864e5));
  const o = { t: [], o: [], h: [], l: [], c: [], v: [] };
  const add = (d8, op, hi, lo, cl, v) => { const c = +cl; if (!(c > 0)) return; o.t.push(`${d8.slice(2, 4)}-${d8.slice(4, 6)}-${d8.slice(6)}`); o.o.push(+op || c); o.h.push(+hi || c); o.l.push(+lo || c); o.c.push(c); o.v.push(+v || 0); };
  if (fx) {
    const r = await fetch(`https://api.stock.naver.com/chart/foreign/item/${code.replace(/\.$/, "")}/day?startDateTime=${from}0000&endDateTime=${ymd(now)}0000`, NV);
    if (!r.ok) return J({ err: "가격 없음" }, 404);
    for (const x of await r.json()) add(String(x.localDate), x.openPrice, x.highPrice, x.lowPrice, x.closePrice, x.accumulatedTradingVolume);
  } else {
    const r = await fetch(`https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${from}&endTime=${ymd(now)}&timeframe=day`, NV);
    for (const m of (await r.text()).matchAll(/\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g)) add(m[1], m[2], m[3], m[4], m[5], m[6]);
  }
  return o.t.length ? J(o, 200, 300) : J({ err: "가격 없음" }, 404);
}
// 종목 찾기 — /pxq?q=이름 (네이버 자동 완성: 한국 주식·국내 지수 + 해외 주식). 해외는 code = 네이버 해외 코드, tk = 티커, idx = 가격에 소수점
async function pxq(q) {
  if (!q.trim()) return J([]);
  const r = await fetch(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(q.trim().slice(0, 30))}&target=stock,index`, NV);
  const kr = (x) => x.nationCode === "KOR" || (x.category === "index" && /^\/domestic\//.test(x.url || ""));
  const L = ((await r.json()).items || []).filter((x) => kr(x) || (x.category === "stock" && x.reutersCode));
  return J(L.slice(0, 12).map((x) => ({ code: kr(x) ? x.code : x.reutersCode.includes(".") ? x.reutersCode : x.reutersCode + ".", tk: x.code, name: x.name, type: x.typeName, idx: x.category === "index" || !kr(x) })), 200, 60);
}

// 📄 받아 적은 원문: 저장소엔 암호 파일(site/data/irnote/<이름>.bin, tools/irnote_seal.mjs)만 있고,
// 로그인한 사람만 /irnote/<이름> 으로 풀어 본다. 열쇠는 Cloudflare 환경 변수 IRNOTE_KEY (코드·저장소에 없음).
async function irnote(ctx, name) {
  const H = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };
  const k = ctx.env.IRNOTE_KEY;
  if (!k) return new Response("원문 열쇠(IRNOTE_KEY)가 Cloudflare 에 아직 없어요.", { status: 503, headers: H });
  if (!/^[\w-]+$/.test(name)) return new Response("잘못된 이름이에요.", { status: 400, headers: H });
  const u = new URL(`/data/irnote/${name}.bin`, ctx.request.url);
  const r = await serveSite({ ...ctx, request: new Request(u), next: (req) => ctx.next(req || new Request(u)) });
  if (!r.ok) return new Response("원문 파일이 없어요.", { status: 404, headers: H });
  const b = new Uint8Array(await r.arrayBuffer());
  try {
    const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(k.trim()), (c) => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
    return new Response(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, key, b.slice(12)), { headers: H });
  } catch {
    return new Response("원문을 풀지 못했어요 (열쇠가 달라요).", { status: 500, headers: H });
  }
}

export async function onRequest(ctx) {
  // 접속 점검용 (보유종목 정보 없음): 휴대폰이 서버에 닿는지 확인
  if (new URL(ctx.request.url).pathname === "/check") {
    return new Response(
      `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>점검</title></head>
<body style="font:16px system-ui;padding:16px;word-break:break-all"><h3>접속 점검</h3><pre id="o">확인 중…</pre>
<p><a href="/?t=${Date.now()}" style="font-size:20px">👉 대시보드 열기</a></p>
<script>(async()=>{const o=document.getElementById('o');let s='';
try{const r=await fetch('/?t='+Date.now(),{cache:'no-store',credentials:'include'});const t=await r.text();s+='첫 화면 응답: '+r.status+' / 길이 '+t.length+' / 비밀번호칸 '+(t.includes('type="password"'))+'\\n';}catch(e){s+='첫 화면 오류: '+e+'\\n';}
try{const g=navigator.serviceWorker?await navigator.serviceWorker.getRegistrations():[];s+='서비스워커: '+g.length+'개\\n';}catch(e){s+='서비스워커 확인 실패\\n';}
s+='쿠키 사용: '+navigator.cookieEnabled+'\\n';o.textContent=s;})();</script></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
    );
  }
  if (new URL(ctx.request.url).pathname === "/ping-files") {
    // 공개돼도 괜찮은 파일(아이콘·화면 틀)이 실제로 올라가 있는지만 확인
    const out = [];
    // ✏️ 내 차트: 이 서버에서 네이버가 열리는지 (공개 시세의 개수만 — 로그인 없이 확인하려고)
    for (const [label, f] of [["/px 한국 일봉", () => px("005930")], ["/px 해외 일봉", () => px("NVDA.O")], ["/pxq 검색", () => pxq("삼성전자")]]) {
      try { const r = await f(), d = await r.json(); out.push(`${label} → ${r.status} (${d.t ? d.t.length + "봉" : Array.isArray(d) ? d.length + "개" : d.err})`); } catch (_) { out.push(`${label} → 네이버 응답 없음`); }
    }
    for (const p of ["/", "/icon.svg", "/style.css", "/app.js", "/draw.js"]) {  // app.js 는 글자 수만 (배포가 됐는지 Claude 가 로그인 없이 확인)
      const fake = { ...ctx, request: new Request(new URL(p, ctx.request.url), { method: "GET" }),
        next: (req) => ctx.next(req || new Request(new URL(p, ctx.request.url))) };
      const r = await serveSite(fake);
      const body = await r.text();
      out.push(`${p} → ${r.status} (${body.length}자${body.includes("밸류 신호등") ? ", 화면 틀 확인" : ""})`);
    }
    return new Response(out.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  if (new URL(ctx.request.url).pathname === "/ping") {
    const h = ctx.request.headers;
    const cf = ctx.request.cf || {};
    return new Response(
      `OK - 서버에 잘 닿았어요\n시각: ${new Date().toISOString()}\n데이터센터: ${cf.colo || "?"}\n통신사: ${cf.asOrganization || "?"}\nHTTP: ${cf.httpProtocol || "?"}\n브라우저: ${h.get("user-agent") || "?"}\n`,
      { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }
    );
  }
  const pw = ctx.env.SITE_PASSWORD || ctx.env.SITE_Password || ctx.env.site_password;
  if (!pw) return page("관리자 설정 필요: Cloudflare 에 SITE_PASSWORD 가 없어요.");
  const good = await token(pw);
  const cookie = ctx.request.headers.get("cookie") || "";
  if (cookie.split(/;\s*/).includes(`${COOKIE}=${good}`)) {
    const path = new URL(ctx.request.url).pathname;
    if (path.startsWith("/irnote/")) return irnote(ctx, path.slice(8));
    try {
      if (path.startsWith("/px/")) return await px(path.slice(4));
      if (path === "/pxq") return await pxq(new URL(ctx.request.url).searchParams.get("q") || "");
    } catch { return J({ err: "네이버 응답 없음" }, 502); }
    const res = await serveSite(ctx);
    const out = new Response(res.body, res);
    out.headers.set("cache-control", "private, no-cache");
    return out;
  }
  if (ctx.request.method === "POST") {
    const form = await ctx.request.formData();
    if ((form.get("pw") || "") === pw) {
      const url = new URL(ctx.request.url);
      return new Response(null, {
        status: 303,
        headers: {
          location: url.pathname + url.search,
          "set-cookie": `${COOKIE}=${good}; Max-Age=${DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    await new Promise((r) => setTimeout(r, 800));
    return page("비밀번호가 달라요.");
  }
  return page("");
}
