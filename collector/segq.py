"""🧱 분기 매출을 제품군별·지역별로 쌓은 막대 (사용자 11/4 — 10년치 분기로 펼쳐 보기) → cache/segq.json.
미국 = stockanalysis.com 'Revenue by Segment · Geography' 페이지에 같이 들어 있는 분기 숫자 (무료로 보이는 건 최근 20분기).
한 번 받은 분기는 지우지 않고 쌓아서 해가 갈수록 10년 쪽으로 늘어남. .github/workflows/gpe.yml 에서 하루 두 번.
결과: {코드: {"prod": {분기 끝 날짜: {이름: 달러}}, "geo": {…}}} — main.py 가 달력 분기('26.3Q')·백만 달러로 바꿔 종목 상세에 붙임."""
import re
import sys

from common import CACHE, HTTP, REPORT, load_yaml, read_json, write_json

PATH = CACHE / "segq.json"
KIND = {"prod": "segment", "geo": "geography"}


def sa_parse(html):
    """페이지 안 분기 숫자 {분기 끝 날짜: {이름: 값}} — 'quarterly:[…],trailing:' 사이만 (뒤는 최근 4분기 합계)."""
    i = html.find("data:{quarterly:[")
    j = html.find("],trailing:", i)
    if i < 0 or j < 0:
        raise RuntimeError("분기 표 없음")
    out = {}
    for nm, vals in re.findall(r'\{name:"([^"]+)",type:"[^"]*",valueType:"[^"]*",values:\[(.*?)\]\}', html[i:j]):
        for x, y in re.findall(r'x:"(\d{4}-\d\d-\d\d)",y:(-?[\d.]+(?:e[+-]?\d+)?)', vals):
            out.setdefault(x, {})[nm] = float(y)
    return out


def collect():
    sy = load_yaml("stocks.yaml")
    out, seen = read_json(PATH, {}) or {}, set()
    for h in [x for k in ("holdings", "watchlist", "joint") for x in (sy.get(k) or [])]:
        code = str(h["code"])
        if h.get("market", "KR").upper() != "US" or code in seen:
            continue
        seen.add(code)
        t = "googl" if code == "GOOG" else code.lower()
        for k, page in KIND.items():
            try:
                q = sa_parse(HTTP.get(f"https://stockanalysis.com/stocks/{t}/metrics/revenue-by-{page}/", tries=2, timeout=30).text)
            except Exception as e:  # noqa: BLE001 - 없는 회사(리츠 등)·잠깐 오류는 쌓아 둔 그대로
                if "404" not in str(e):
                    REPORT.block("분기 제품·지역 매출", f"{h['name']} {page}: {str(e)[:60]}")
                continue
            box = out.setdefault(code, {}).setdefault(k, {})
            box.update(q)  # 같은 분기는 새 숫자로 (정정 반영), 예전 분기는 그대로 쌓임
        print(f"  {h['name']}: 제품 {len((out.get(code) or {}).get('prod') or {})} · 지역 {len((out.get(code) or {}).get('geo') or {})}분기")
    return out


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        s = 'x data:{quarterly:[{name:"iPhone",type:"cumulative",valueType:"CURRENCY",values:[{x:"2026-09-30",y:57583000000,change:1},{x:"2026-06-30",y:4.4582e10}]},' \
            '{name:"Mac",type:"c",valueType:"C",values:[{x:"2026-09-30",y:10792000000}]}],trailing:[{name:"iPhone",type:"c",valueType:"C",values:[{x:"2026-09-30",y:254098000000}]}]'
        assert sa_parse(s) == {"2026-09-30": {"iPhone": 57583e6, "Mac": 10792e6}, "2026-06-30": {"iPhone": 44582e6}}, sa_parse(s)
        print("ok")
    else:
        write_json(PATH, collect())
