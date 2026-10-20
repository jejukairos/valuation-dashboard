"""미국 중고차 도매가격 지수 (Manheim Used Vehicle Value Index, 1997년 1월 = 100, 계절조정).
과거: Manheim 이 공개한 엑셀(1997-01 ~ 2025-11)을 cache/manheim.json 에 저장해 둠.
이후: 매달 Cox Automotive 기사 본문 'Key Metrics' 첫 줄에서 숫자를 읽어 한 달씩 붙인다
(월간 확정치가 아직 없으면 그달 1~15일 '중순 잠정치')."""
import re

from common import CACHE, HTTP, now_kst, read_json, write_json

PATH = CACHE / "manheim.json"
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
URL = "https://www.coxautoinc.com/insights/manheim-used-vehicle-value-index-{}{}-{}-trends/"
NUM = re.compile(r"Key Metrics.{0,160}?(?:to|was)\s+(\d{3}(?:\.\d)?)", re.S)


def _read(y, m, mid):
    try:
        r = HTTP.get(URL.format("mid-" if mid else "", MONTHS[m - 1], y), tries=1)
    except RuntimeError:  # 아직 기사가 없음 (404)
        return None, None
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>|&nbsp;", " ", r.text))
    hit = NUM.search(t)
    return (float(hit.group(1)) if hit else None), r.url


def collect():
    data = read_json(PATH, {}) or {}
    hist = data.get("hist") or {}          # "YYYY-MM": 값
    prelim = data.get("prelim") or {}      # 잠정치(중순)로 넣은 달
    now = now_kst()
    # 잠정치로 넣은 달이 있으면 그 달부터 다시 (확정치로 바꾸기 위해)
    start = min(prelim) if prelim else None
    y, m = map(int, (start or max(hist)).split("-"))
    if start:
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    added = []
    # 마지막 확정 달 다음부터 이번 달까지 (잠정치 달은 확정치가 나오면 바꿈)
    while (y, m) < (now.year, now.month):
        m += 1
        if m > 12:
            y, m = y + 1, 1
        key = f"{y}-{m:02d}"
        v, _ = _read(y, m, mid=False)
        if v:
            hist[key] = v
            prelim.pop(key, None)
            added.append(key)
            continue
        v, url = _read(y, m, mid=True)
        if v:
            hist[key] = v
            prelim[key] = url
            added.append(key + "(잠정)")
        break
    data.update(hist=dict(sorted(hist.items())), prelim=prelim)
    write_json(PATH, data)
    ks = sorted(hist)
    yoy = {k: round((hist[k] / hist[f"{int(k[:4]) - 1}{k[4:]}"] - 1) * 100, 1)
           for k in ks if f"{int(k[:4]) - 1}{k[4:]}" in hist}
    print(f"  - Manheim: {ks[-1]} {hist[ks[-1]]} 새로 {added or '없음'}")
    return {"source": "Manheim / Cox Automotive (계절조정, 1997년 1월 = 100)",
            "hist": [[k, round(hist[k], 1), yoy.get(k)] for k in ks],
            "prelim": sorted(prelim), "prelim_url": prelim.get(ks[-1])}
