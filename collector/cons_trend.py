"""📈 업종별 매출·영업이익 컨센서스 추이 (사용자 11/5: 증권사 '셀 업체 매출액·영업이익 컨센서스' 선 그림처럼 모든 업종)
→ cache/cons_hist.json (종목마다 쌓음) · site/data/cons_ind.json (업종 합계)
한국 = 와이즈리포트 컨센서스 화면의 '컨센서스 추이' (그 화면이 부르는 cF5002 — 지난 1년 달마다 + 어제). 받은 날짜는 지우지 않고 쌓아서 이제부터는 매일 점이 생김.
업종 = stocks.yaml industry · MERGE 글자가 들면 한 묶음 (SK이노베이션 '정유·2차전지' → 2차전지, 현대로템 '방산·철도' → 방산 …). 미국은 무료로 받을 수 있는 매출·영업이익 추정 추이가 없어 뺌.
.github/workflows/gpe.yml 에서 평일 하루 두 번."""
import json
import sys

from common import CACHE, DATA, HTTP, REPORT, load_yaml, now_kst, read_json, write_json

W = "https://navercomp.wisereport.co.kr/v2/company"
ITEM = {"rev": "121000", "op": "121500"}  # 매출액 · 영업이익 (억원)
MERGE = ["2차전지", "조선", "기판", "자동차", "방산"]
HIST = CACHE / "cons_hist.json"


def group(ind):
    return next((k for k in MERGE if k in ind), ind)


def parse(js):
    """cF5002 응답 → {날짜: 평균 컨센서스(억원)} — chart2 가 고른 항목(매출·영업이익), chart1 은 EPS."""
    c = json.loads(js["chart2"])
    if c.get("item_unit") != "억원":
        raise RuntimeError(f"단위가 {c.get('item_unit')}")
    return {d.replace("/", "-"): round(v, 1) for d, v in zip(c["categories"], c["avg"]) if v is not None}


def fetch(code, fy, item):
    r = HTTP.get(f"{W}/ajax/cF5002.aspx?cmp_cd={code}&dt={now_kst():%Y%m%d}&yymm={fy}12&frq=Y&acc_cd={ITEM[item]}&fingubun=MAIN&chartType=svg",
                 headers={"Referer": f"{W}/c1050001.aspx?cmp_cd={code}"}, timeout=20, tries=2)
    return parse(r.json())


def total(H, codes, y, item):
    """업종 합계 [[날짜, 억원]] — 거의 모든 날짜에 숫자가 있는 종목만 넣고, 그 종목들이 다 있는 날짜만 (종목이 빠졌다 들어와 튀는 걸 막음)."""
    rows = {c: H[c][y][item] for c in codes if H.get(c, {}).get(y, {}).get(item)}
    if not rows:
        return [], []
    alld = sorted(set().union(*rows.values()))
    mem = [c for c, r in rows.items() if len(r) >= 0.6 * len(alld) and alld[-1] in r] or [max(rows, key=lambda c: len(rows[c]))]
    ds = sorted(set.intersection(*[set(rows[c]) for c in mem]))
    return [[d, round(sum(rows[c][d] for c in mem), 1)] for d in ds], mem


def collect():
    sy, H = load_yaml("stocks.yaml"), read_json(HIST, {}) or {}
    y0 = now_kst().year
    ys = [str(y0)[2:], str(y0 + 1)[2:]]
    seen, grp, names = set(), {}, {}
    for h in [x for k in ("holdings", "watchlist", "joint") for x in (sy.get(k) or [])]:
        code = str(h["code"])
        if h.get("market", "KR").upper() != "KR" or code in seen or h["name"].endswith("우"):
            continue
        seen.add(code)
        names[code] = h["name"]
        grp.setdefault(group(h.get("industry") or "기타"), []).append(code)
        for y in ys:
            for item in ITEM:
                try:
                    H.setdefault(code, {}).setdefault(y, {}).setdefault(item, {}).update(fetch(code, "20" + y, item))
                except Exception as e:  # noqa: BLE001 - 컨센서스가 없는 종목(분석가 없음)·잠깐 오류는 쌓아 둔 그대로
                    if "단위" in str(e):
                        REPORT.block("업종 컨센서스", f"{h['name']} {y} {item}: {e}")
    write_json(HIST, H)
    out = []
    for k, codes in grp.items():
        g = {"k": k, "rev": {}, "op": {}, "mem": {}}
        for item in ITEM:
            for y in ys:
                g[item][y], mem = total(H, codes, y, item)
                g["mem"][f"{item}{y}"] = mem
        used = sorted(set().union(*g["mem"].values()), key=codes.index)
        if not used:
            continue
        g["codes"], g["names"] = used, [names[c] for c in used]
        g["mem"] = {k2: v for k2, v in g["mem"].items() if v != used}  # 모든 칸이 같은 종목이면 생략
        out.append(g)
        print(f"  {k}: {' · '.join(g['names'])} — 영업이익 {ys[0]}E {len(g['op'][ys[0]])}점")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "years": ys, "src": "와이즈리포트 컨센서스 추이 (종목별 평균 추정치를 업종끼리 더함, 억원)", "groups": out}


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        js = {"chart2": json.dumps({"item_unit": "억원", "categories": ["2025/11/28", "2026/11/04"], "avg": [480.52, None]})}
        assert parse(js) == {"2025-11-28": 480.5}, parse(js)
        H = {"a": {"26": {"op": {"2026-01": 1, "2026-02": 2, "2026-03": 3}}}, "b": {"26": {"op": {"2026-02": 10, "2026-03": 20}}}, "c": {"26": {"op": {"2026-03": 5}}}}
        assert total(H, ["a", "b", "c"], "26", "op") == ([["2026-02", 12], ["2026-03", 23]], ["a", "b"]), total(H, ["a", "b", "c"], "26", "op")
        assert group("정유·2차전지") == "2차전지" and group("방산·철도") == "방산" and group("전력") == "전력"
        print("ok")
    else:
        write_json(DATA / "cons_ind.json", collect())
