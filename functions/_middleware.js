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

export async function onRequest(ctx) {
  const pw = ctx.env.SITE_PASSWORD || ctx.env.SITE_Password || ctx.env.site_password;
  if (!pw) return page("관리자 설정 필요: Cloudflare 에 SITE_PASSWORD 가 없어요.");
  const good = await token(pw);
  const cookie = ctx.request.headers.get("cookie") || "";
  if (cookie.split(/;\s*/).includes(`${COOKIE}=${good}`)) {
    const res = await ctx.next();
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
