// 네이버 증권이 공개하는 어닝콜 '발표 자막' 화면을 Edge 로 사람처럼 열어 자막 전체를 글자로 저장한다.
// 자막 목록은 보이는 부분만 그리는 방식이라 맨 위부터 조금씩 내려가며 (말한 사람, 문장) 을 모은다.
// 사용: node tools/ec_read.mjs <자막 화면 URL> <저장할 .txt> <Edge 원격 디버깅 포트>
import { writeFileSync } from "node:fs";

const [url, out, port = "9333"] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.bringToFront");
await sleep(6000);
const clicked = await ev(`(() => { const el = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === '발표 자막').pop(); if (!el) return false; el.click(); return true; })()`);
if (!clicked) { console.error("발표 자막 탭 없음"); process.exit(2); }
await sleep(4000);
const box = await ev(`(() => { window.__box = document.querySelector('[class*=scroll-area]'); if (!__box) return false; __box.style.scrollBehavior = 'auto'; __box.scrollTop = 0; __box.dispatchEvent(new Event('scroll')); return true; })()`);
if (!box) { console.error("자막 목록 없음"); process.exit(2); }
await sleep(1500);
// 화면 밖(헤드리스) 탭은 스크롤 신호가 저절로 안 가서 직접 보낸다
const pick = `[...document.querySelectorAll('[class*=subtitle-list] button')].map((b) => b.innerText.split('\\n').map((s) => s.trim()).filter(Boolean))`;
const seen = new Set(), rows = [];
const take = (items) => { for (const it of items || []) { const said = it.slice(1).join(" "); if (it.length > 1 && !seen.has(said)) { seen.add(said); rows.push(`${it[0]}\n${said}`); } } };
for (let i = 0; i < 3000; i++) {
  take(await ev(pick));
  const end = await ev(`(() => { __box.scrollTop += __box.clientHeight * 0.8; __box.dispatchEvent(new Event('scroll')); return __box.scrollTop + __box.clientHeight >= __box.scrollHeight - 4; })()`);
  await sleep(1500);  // 새 자막이 그려질 때까지
  if (end) { take(await ev(pick)); break; }
}
writeFileSync(out, rows.join("\n\n"), "utf8");
console.log(`발언 ${rows.length}개 · ${rows.join("").length}자 → ${out}`);
await send("Page.close");
ws.close();
