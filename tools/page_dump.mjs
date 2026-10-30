// 페이지를 Edge 로 열고 몇 번 내려 본 뒤 글자 + 링크를 저장 (사람이 보는 화면 그대로)
// 사용: node page_dump.mjs <url> <out.txt> <port> [스크롤 횟수]
import { writeFileSync } from "node:fs";
const [url, out, port = "9333", n = "3"] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.bringToFront");
await sleep(7000);
for (let i = 0; i < +n; i++) { await ev("window.scrollBy(0, innerHeight * 2); document.documentElement.scrollTop"); await sleep(2000); }
if (process.argv[6]) { await ev(process.argv[6]); await sleep(4000); }  // 예: 접힌 칸 펼치기
const txt = await ev("document.body.innerText");
const links = await ev("[...document.querySelectorAll('a[href]')].map(a => (a.innerText.trim().replace(/\\s+/g,' ').slice(0,120) || a.title || '') + ' | ' + a.href).filter((v, i, s) => s.indexOf(v) === i).join('\\n')");
writeFileSync(out, `${txt}\n\n==== LINKS ====\n${links}`, "utf8");
console.log(`${(txt || "").length}자 · ${out}`);
await send("Page.close"); ws.close();
