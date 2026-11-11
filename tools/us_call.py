"""🇺🇸 미국 보유·관심 종목 어닝콜 녹취록 자동 받기 (사용자 11/11 "내가 보내지 않아도 알아서 가져와서 번역·요약·Q&A").
  todo        : site/data/ir_calendar.json 에서 발표가 0~10일 지난 미국 보유·관심 종목 → Motley Fool 공개 녹취록(무료)을 받아
                transcripts/us/{티커}_{발표일}.txt 로 저장 (이 컴퓨터에만 — 저장소가 공개라 원문·번역은 사이트에 안 올리고 링크만).
                새로 받은 것만 '티커|이름|발표일|파일|주소' 한 줄씩 출력 → tools/ir_live.ps1 이 claude -p 로 번역·요약·질의응답.
  check 티커 주소 : ir_brief.yaml 그 종목 맨 위 분기에 t_u(이 주소)와 qa 가 들어갔으면 0
  fetch 주소 파일 : 녹취록 한 개만 받아 보기 (점검용)
fool.com robots.txt: /quote/ · /earnings/call-transcripts/ 허용, Content-Signal ai-input=yes. 200 이 아니면 건너뜀 (우회 안 함)."""
import html
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "collector"))
from common import HTTP, load_yaml  # noqa: E402

OUT = ROOT / "transcripts" / "us"
FOOL = "https://www.fool.com"
PAGE = {"GOOG": "googl"}  # Fool 이 다른 티커 화면·주소에 녹취록을 거는 회사 (알파벳 3Q26 = /quote/nasdaq/googl/ · alphabet-googl-…)
DAYS = 10  # 발표 뒤 며칠 동안 녹취록이 올라왔는지 봄 (코어위브 2Q26: 8/11 콜 → Fool 8/18 에 올림)


def links(t):
    """그 종목 Fool 화면에 걸린 그 종목 녹취록 [(올린 날 'YYYY-MM-DD', 주소)] — 나스닥·NYSE 화면 순서로."""
    p = PAGE.get(t, t.lower())
    for ex in ("nasdaq", "nyse"):
        try:
            r = HTTP.get(f"{FOOL}/quote/{ex}/{p}/", timeout=30)
        except RuntimeError:  # 그 거래소 화면이 없음 (404) → 다음 거래소
            continue
        got = {(f"{y}-{m}-{d}", f"{FOOL}/earnings/call-transcripts/{y}/{m}/{d}/{s}/")
               for y, m, d, s in re.findall(r"/earnings/call-transcripts/(\d{4})/(\d\d)/(\d\d)/([a-z0-9-]+)/", r.text)
               if f"-{p}-" in f"-{s}-"}  # 옆 칸의 다른 회사 녹취록은 빼기
        if got:
            return sorted(got)
    return []


def text_of(page):
    """녹취록 화면 → 글자: 본문 칸('article-body transcript-content') 안만, 문단마다 줄바꿈."""
    i = page.find("article-body transcript-content")
    if i < 0:
        return ""
    body = page[page.find(">", i) + 1:].split("</article>", 1)[0]
    body = re.sub(r"<(script|style)\b[\s\S]*?</\1>", "", body)
    body = re.sub(r"</(p|h\d|li|div|tr)>|<br\s*/?>", "\n", body)
    t = html.unescape(re.sub(r"<[^>]+>", "", body)).split("\nRead Next", 1)[0]  # 아래 '다음 글' 목록은 빼기
    return re.sub(r"\n[ \t]*(\n[ \t]*)+", "\n\n", t).strip()


def fetch(u):
    r = HTTP.get(u, timeout=30)
    return text_of(r.text) if r.status_code == 200 else ""


def todo():
    cal = json.loads((ROOT / "site/data/ir_calendar.json").read_text(encoding="utf-8")).get("items") or []
    today = date.today()
    OUT.mkdir(parents=True, exist_ok=True)
    # 야후 일정은 발표가 지나면 곧 다음 분기 날짜로 바뀌어서, 지나간 발표일을 이 컴퓨터에 적어 두고 10일 동안 봄
    st_f = OUT / "_events.json"
    st = json.loads(st_f.read_text(encoding="utf-8")) if st_f.exists() else {}
    for e in cal:
        if e.get("market") == "US" and e.get("group") in ("보유", "관심") and str(e["when"])[:10] <= str(today):
            st[e["code"]] = {"name": e["name"], "when": str(e["when"])[:10]}
    st_f.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
    for code, e in st.items():
        d0 = date.fromisoformat(e["when"])
        f = OUT / f"{code}_{d0}.txt"
        if not 0 <= (today - d0).days <= DAYS or f.exists():
            continue
        try:  # 발표일(미국 날짜) 하루 전 ~ 10일 뒤에 올라온 녹취록만 (지난 분기 것과 안 헷갈리게)
            got = [u for d, u in links(code) if d0 - timedelta(days=1) <= date.fromisoformat(d) <= d0 + timedelta(days=DAYS)]
            t = fetch(got[0]) if got else ""
        except Exception as ex:  # noqa: BLE001
            print(f"# {code} 받기 실패: {str(ex)[:80]}", file=sys.stderr)
            continue
        if len(t) < 5000:  # 아직 안 올라왔거나 화면 모양이 바뀜 → 다음 시간에 다시
            continue
        f.write_text(f"{got[0]}\n\n{t}\n", encoding="utf-8")
        print("|".join([code, e["name"], str(d0), f.relative_to(ROOT).as_posix(), got[0]]))


def check(t, u):
    top = ((load_yaml("ir_brief.yaml") or {}).get(t) or [{}])[0]
    return top.get("t_u") == u and bool(top.get("qa"))


def selftest():
    page = ('<div class="article-body transcript-content"><h2>Full Conference Call Transcript</h2><p>Operator: Hello &amp; welcome.</p>'
            '<script>x=1</script><p>CEO: Revenue grew.</p><p>Read Next</p><p>Other story</p></div></article><p>footer</p>')
    assert text_of(page) == "Full Conference Call Transcript\nOperator: Hello & welcome.\nCEO: Revenue grew.", repr(text_of(page))
    assert text_of("<html>no body</html>") == ""
    print("ok")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "todo"
    if cmd == "todo":
        todo()
    elif cmd == "check":
        sys.exit(0 if check(sys.argv[2], sys.argv[3]) else 1)
    elif cmd == "fetch":
        Path(sys.argv[3]).write_text(fetch(sys.argv[2]), encoding="utf-8")
    else:
        selftest()
