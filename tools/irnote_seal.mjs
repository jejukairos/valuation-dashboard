// 📄 받아 적은 원문 (transcripts/*_irnote*.txt, gitignored) → 암호 파일 site/data/irnote/<이름>.bin
// 저장소가 공개라 유료 노트 글을 그대로 못 올림 → AES-256-GCM 으로 잠그고, functions/_middleware.js 가
// Cloudflare 환경 변수 IRNOTE_KEY 로 로그인한 사람에게만 /irnote/<이름> 에서 풀어 줌 (사용자 11/25 "원문으로 남겨줘")
// 파일 모양 = 앞 12바이트 iv + 암호문 + 태그 16바이트 (WebCrypto AES-GCM 과 같음)
// 사용: node tools/irnote_seal.mjs [이름 ...]   이름 = transcripts 파일 이름에서 .txt 뺀 것 (없으면 *_irnote*.txt 전부)
//       node tools/irnote_seal.mjs --test       암호화 → 풀기 자체 점검
// 열쇠 = ~/.vd-irnote-key (저장소 밖, 없으면 새로 만듦) — 같은 값을 Cloudflare IRNOTE_KEY 에 넣어야 풀림
import { createCipheriv, randomBytes, webcrypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const KEYF = join(homedir(), ".vd-irnote-key");
const seal = (key, txt) => {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([iv, c.update(txt, "utf8"), c.final(), c.getAuthTag()]);
};
// 풀기는 Cloudflare 와 같은 WebCrypto 로 → 만든 파일이 서버에서도 풀리는지 바로 확인
const open = async (key, b) => {
  const k = await webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  return Buffer.from(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12) }, k, b.subarray(12))).toString("utf8");
};

if (process.argv[2] === "--test") {
  const k = randomBytes(32), t = "원문 점검 ✅ abc\n둘째 줄";
  if ((await open(k, seal(k, t))) !== t) throw new Error("풀기 실패");
  let bad = false;
  try { await open(randomBytes(32), seal(k, t)); } catch { bad = true; }
  if (!bad) throw new Error("다른 열쇠로도 풀림");
  console.log("ok");
  process.exit(0);
}

if (!existsSync(KEYF)) writeFileSync(KEYF, randomBytes(32).toString("base64") + "\n", { mode: 0o600 });
const key = Buffer.from(readFileSync(KEYF, "utf8").trim(), "base64");
if (key.length !== 32) throw new Error(`열쇠가 32바이트가 아님: ${KEYF}`);
const TD = join(ROOT, "transcripts"), OD = join(ROOT, "site", "data", "irnote");
mkdirSync(OD, { recursive: true });
const args = process.argv.slice(2);
const names = args.length ? args : readdirSync(TD).filter((f) => /_irnote.*\.txt$/.test(f)).map((f) => f.slice(0, -4));
for (const n of names) {
  if (!/^[\w-]+$/.test(n)) throw new Error(`이름에 쓸 수 없는 글자: ${n}`);  // 서버(_middleware.js)도 같은 규칙
  const src = join(TD, `${n}.txt`), dst = join(OD, `${n}.bin`);
  if (!existsSync(src)) { console.log("없음:", n); continue; }
  // shortcut: 글이 안 바뀌면 다시 안 만듦 (커밋이 매번 바뀌지 않게) — 열쇠를 바꾸면 site/data/irnote/*.bin 을 지우고 다시 돌릴 것
  if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs) { console.log("그대로:", n); continue; }
  const txt = readFileSync(src, "utf8"), b = seal(key, txt);
  if ((await open(key, b)) !== txt) throw new Error(`되풀기 실패: ${n}`);
  writeFileSync(dst, b);
  console.log("만듦:", n, `${b.length}바이트`);
}
