"""✈️ 국적별 방한 외래관광객 (관광지식정보시스템 know.tour.go.kr '국적별 입국' 월별 · 키 없음 · 원자료 법무부 출입국 → 한국관광공사)
→ site/data/tour_nat.json — 사용자 11/10 '외국인 입국자 수, 미국·유럽·중국·일본 나눠서' (에이피알·달바·파마리서치·롯데쇼핑 등 상세 📦 칸 + 카드 ‼️).
seen = 그 달 숫자를 처음 받은 날 (카드 '‼️ 입국자 수 나옴' 7일). 보통 다음 달 하순에 한 달치가 붙어요. .github/workflows/exports.yml 에서 매일."""
import re
import sys

import requests

from common import DATA, now_kst, read_json, write_json

PAGE = "https://know.tour.go.kr/stat/entryTourStatDis19Re.do"
URL = "https://know.tour.go.kr/stat/entryTourStatDis_DataXML.do"
OUT = DATA / "tour_nat.json"
# 보여줄 줄 = 국적 코드 (지역 합계 줄은 코드가 모두 1 이라 이름으로) · 동남아 = 아래 6개국 합
NAT = {"중국": "112", "일본": "130", "미국": "275", "대만": "113", "홍콩": "120"}
REG = {"전체": "전 체", "유럽": "구 주"}  # 이름 사이 빈칸은 지워서 맞춤
SEA = ["155", "170", "143", "164", "125", "185"]  # 필리핀·태국·말레이시아·싱가포르·인도네시아·베트남


def parse(b):
    """XML 줄 → {이름(코드 또는 지역 이름): {YYYY-MM: 명}}."""
    out = {}
    for row in re.findall(rb"<row>(.*?)</row>", b, re.S):
        nm = re.sub(r"\s+", "", re.search(rb"<NAT_NM>(.*?)</NAT_NM>", row, re.S)[1].decode("utf-8", "replace"))
        cd = re.search(rb"<TS_ENT_NAT_CD>(.*?)</TS_ENT_NAT_CD>", row, re.S)[1].decode().strip()
        out[nm if cd == "1" else cd] = {f"{a[:4].decode()}-{a[4:].decode()}": int(v) for a, v in re.findall(rb"<CUR_(\d{6})>(\d+)</CUR_", row)}
    return out


_t = parse("<rows><row><NAT_NM>전  체</NAT_NM><TS_ENT_NAT_CD>1</TS_ENT_NAT_CD><CUR_202609>2062042</CUR_202609></row>"
           "<row><NAT_NM>중  국</NAT_NM><TS_ENT_NAT_CD>112</TS_ENT_NAT_CD><CUR_202608>827385</CUR_202608><CUR_202609>656944</CUR_202609></row></rows>".encode())
assert _t == {"전체": {"2026-09": 2062042}, "112": {"2026-08": 827385, "2026-09": 656944}}, _t


def main():
    now = now_kst()
    s = requests.Session()
    s.headers["User-Agent"] = "Mozilla/5.0 (valuation-dashboard)"
    s.get(PAGE, timeout=30)  # 세션 쿠키
    d = {"searchDivision": "entryNationality", "searchDateDivision": "MONTH", "searchStartYear": "2016", "searchStartMonth": "01",
         "searchEndYear": str(now.year), "searchEndMonth": f"{now.month:02d}", "mergyYN": "Y", "advancedSearchYn": "N", "searchType": "", "searchYItem": "SE"}
    r = s.post(URL, data=d, timeout=120)
    r.raise_for_status()
    raw = parse(r.content)
    nat = {k: raw[c] for k, c in NAT.items() if c in raw}
    nat.update({k: raw[nm.replace(" ", "")] for k, nm in REG.items() if nm.replace(" ", "") in raw})
    ms = sorted({m for c in SEA if c in raw for m in raw[c]})
    nat["동남아 6국"] = {m: sum(raw[c].get(m, 0) for c in SEA if c in raw) for m in ms}
    if not nat.get("전체") or len(nat) < 6:
        sys.exit(f"관광 통계 모양이 바뀜: {sorted(raw)[:20]}")
    ok = {m for m, v in nat["전체"].items() if v > 0}  # 아직 안 나온 달은 0 으로 와요 → 뺌
    nat = {k: {m: v for m, v in s.items() if m in ok} for k, s in nat.items()}
    order = ["전체", "중국", "일본", "미국", "유럽", "대만", "홍콩", "동남아 6국"]
    old = read_json(OUT, {}) or {}
    seen = old.get("seen") or {}
    for m in nat["전체"]:
        seen.setdefault(m, now.strftime("%Y-%m-%d") if old else "2000-01-01")  # 처음 만들 땐 옛 달을 '새로 나옴'으로 치지 않음
    write_json(OUT, {"updated": now.strftime("%Y-%m-%d %H:%M"), "src": "관광지식정보시스템 (한국문화관광연구원) 국적별 입국 · 원자료 법무부 출입국",
                     "url": PAGE, "seen": dict(sorted(seen.items())[-36:]), "nat": {k: dict(sorted(nat[k].items())) for k in order if k in nat}})
    print("국적별 입국", max(nat["전체"]), {k: nat[k][max(nat["전체"])] for k in order if k in nat})


if __name__ == "__main__":
    main()
