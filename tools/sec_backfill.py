"""미국 종목 10년 분기 실적을 받아 두기 (SEC EDGAR companyfacts) — 서버(GitHub)에서는 SEC 가 막혀서 이 컴퓨터에서 가끔 한 번씩 실행.
SEC 는 요청하는 사람의 연락처를 요구해요. 본인 연락처를 SEC_CONTACT 환경변수로만 넣어요 (코드·저장소·결과 파일에는 남지 않음).
  PowerShell:  $env:SEC_CONTACT="내 이메일"; .venv\\Scripts\\python.exe tools\\sec_backfill.py
SEC 가 이 컴퓨터를 막으면 차선으로 알파밴티지 무료 키(ALPHAVANTAGE_KEY 환경변수)를 써요 — 같은 명령에 키만 더 넣으면 됨.
결과: cache/sec_longq.json {티커: {분기 끝 날짜: {rev, op, gp, ocf, capex, rpo}}} (백만 달러, 2014년~) — 수집기가 야후 분기와 합쳐 📈 10년 실적·⚖️ 비교 탭에 씀."""
import json
import os
import sys
import time
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
TAGS = {  # 앞에 있는 이름을 먼저 쓰고, 없는 분기만 뒤 이름으로 채움 (회사·연도마다 쓰는 이름이 달라서)
    "rev": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
            "RevenueFromContractWithCustomerIncludingAssessedTax"],
    "op": ["OperatingIncomeLoss"],
    "gp": ["GrossProfit"],
    "cogs": ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
    "ocf": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "rpo": ["RevenueRemainingPerformanceObligation"],
}


def quarters(rows):
    """한 항목의 공시 행들 → {분기 끝 날짜: 3개월 값}. 같은 기간은 가장 늦게 낸 값(정정 반영).
    10-Q 현금흐름처럼 누적(6·9개월)만 있으면 누적끼리 빼서 3개월을 만듦 (4분기 = 연간 − 9개월)."""
    span = {}
    for r in rows:
        if not (r.get("start") and r.get("end")):
            continue
        key = (r["start"], r["end"])
        if key not in span or r["filed"] > span[key]["filed"]:
            span[key] = r
    days = lambda s, e: (time.mktime(time.strptime(e, "%Y-%m-%d")) - time.mktime(time.strptime(s, "%Y-%m-%d"))) / 86400
    out = {e: float(r["val"]) for (s, e), r in span.items() if 80 <= days(s, e) <= 100}
    for (s, e), r in sorted(span.items(), key=lambda x: x[0][1]):
        if e in out or days(s, e) <= 100:
            continue
        prev = [(e2, x) for (s2, e2), x in span.items() if s2 == s and 80 <= days(e2, e) <= 100]
        if prev:
            out[e] = float(r["val"]) - float(prev[0][1]["val"])
    return out


def avg_quarters(rows, splits=()):
    """가중평균 주식 수(희석) 공시 행 → {분기 끝 날짜: 3개월 평균}. 평균이라 빼기 대신 기간 가중:
    4분기 = (연간 평균 × 연간 일수 − 9개월 평균 × 9개월 일수) ÷ 남은 일수. 분할 전에 낸 값은 분할 비율만큼 곱함."""
    span = {}
    for r in rows:
        if r.get("start") and r.get("end") and ((r["start"], r["end"]) not in span or r["filed"] > span[(r["start"], r["end"])]["filed"]):
            span[(r["start"], r["end"])] = r
    days = lambda s, e: (time.mktime(time.strptime(e, "%Y-%m-%d")) - time.mktime(time.strptime(s, "%Y-%m-%d"))) / 86400
    val = {}
    for (s, e), r in span.items():
        v = float(r["val"])
        for sd, ratio in splits:
            if r["filed"] < sd and e < sd:
                v *= ratio
        val[(s, e)] = v
    out = {e: v for (s, e), v in val.items() if 80 <= days(s, e) <= 100}
    for (s, e), v in val.items():
        if e in out or days(s, e) <= 100:
            continue
        prev = [(e2, x) for (s2, e2), x in val.items() if s2 == s and 80 <= days(e2, e) <= 100]
        if prev:
            L, L2 = days(s, e), days(s, prev[0][0])
            out[e] = (v * L - prev[0][1] * L2) / (L - L2)
    return out


def instants(rows):
    best = {}
    for r in rows:
        if not r.get("start") and r.get("end") and (r["end"] not in best or r["filed"] > best[r["end"]]["filed"]):
            best[r["end"]] = r
    return {e: float(r["val"]) for e, r in best.items()}


def pull(facts, splits=()):
    g = (facts.get("facts") or {}).get("us-gaap") or {}
    dil = avg_quarters(((g.get("WeightedAverageNumberOfDilutedSharesOutstanding") or {}).get("units") or {}).get("shares") or [], splits)
    got = {}
    for k, names in TAGS.items():
        vals = {}
        for nm in names:
            rows = ((g.get(nm) or {}).get("units") or {}).get("USD") or []
            for e, v in (instants(rows) if k == "rpo" else quarters(rows)).items():
                vals.setdefault(e, v)
        got[k] = vals
    out = {}
    for e in sorted(set(got["rev"]) | set(got["ocf"])):
        if e < "2014-01-01":
            continue
        row = {k: round(got[k][e] / 1e6) for k in ("rev", "op", "gp", "ocf", "capex") if e in got[k]}
        if "gp" not in row and e in got["cogs"] and "rev" in row:
            row["gp"] = round(row["rev"] - got["cogs"][e] / 1e6)
        rp = next((v for d, v in got["rpo"].items() if abs(time.mktime(time.strptime(d, "%Y-%m-%d")) - time.mktime(time.strptime(e, "%Y-%m-%d"))) < 20 * 86400), None)
        if rp is not None:
            row["rpo"] = round(rp / 1e6)
        if e in dil:
            row["dil"] = round(dil[e] / 1e6, 1)  # 희석 주식 수 (백만 주)
        if row:
            out[e] = row
    return out


def av_pull(inc, cf):
    """알파밴티지 분기 손익·현금흐름 (이미 3개월 값) → SEC 와 같은 모양 {분기 끝 날짜: {rev, op, gp, ocf, capex}} (백만 달러)."""
    num = lambda r, k: float(r[k]) / 1e6 if r.get(k) not in (None, "", "None") else None  # noqa: E731
    out = {}
    for rows, keys in ((inc, (("rev", "totalRevenue"), ("op", "operatingIncome"), ("gp", "grossProfit"))),
                       (cf, (("ocf", "operatingCashflow"), ("capex", "capitalExpenditures")))):
        for r in (rows or {}).get("quarterlyReports") or []:
            e = r.get("fiscalDateEnding") or ""
            if e < "2014-01-01":
                continue
            for k, src in keys:
                v = num(r, src)
                if v is not None:
                    out.setdefault(e, {})[k] = round(abs(v) if k == "capex" else v)
    for row in out.values():  # 매출총이익이 영업이익보다 작으면 잘못 들어온 값 (예: 아마존 2016년 4분기 -189억$) → 버림
        if row.get("gp") is not None and row.get("op") is not None and row["gp"] < row["op"]:
            del row["gp"]
    return out


def alpha_vantage(tickers, saved):
    """SEC 가 막혔을 때 차선: 알파밴티지 무료 키 (하루 25번 · 종목당 2번). 키는 ALPHAVANTAGE_KEY 환경변수로만.
    SEC 값이 이미 있는 칸은 그대로 두고 빈 칸만 채움."""
    key = os.environ.get("ALPHAVANTAGE_KEY")
    if not key:
        sys.exit("SEC 가 막혀 있어요. 차선책: https://www.alphavantage.co/support/#api-key 에서 무료 키를 받아\n"
                 "  $env:ALPHAVANTAGE_KEY=\"받은 키\"; .venv\\Scripts\\python.exe tools\\sec_backfill.py")
    for t in tickers:
        got = []
        for fn in ("INCOME_STATEMENT", "CASH_FLOW"):
            time.sleep(1.5)
            j = requests.get("https://www.alphavantage.co/query", params={"function": fn, "symbol": t, "apikey": key}, timeout=60).json()
            if "quarterlyReports" not in j:  # 하루 한도·잘못된 키 → 여기까지 받은 것만 저장
                print("  알파밴티지 멈춤:", t, str(j.get("Information") or j.get("Note") or j.get("Error Message") or j)[:120])
                return saved
            got.append(j)
        new = av_pull(*got)
        old = saved.get(t, {})
        saved[t] = {e: {**new.get(e, {}), **old.get(e, {})} for e in sorted(set(new) | set(old))}
        ks = sorted(saved[t])
        print(f"  {t}: {len(ks)}개 분기 ({ks[0]} ~ {ks[-1]}) · 알파밴티지")
    return saved


def main():
    st = yaml.safe_load(open(ROOT / "config" / "stocks.yaml", encoding="utf-8"))
    cmp_ = yaml.safe_load(open(ROOT / "config" / "compare.yaml", encoding="utf-8")) or {}
    tickers = sorted({str(h["code"]) for g in st.values() if isinstance(g, list) for h in g if isinstance(h, dict) and h.get("market") == "US"}
                     | {str(c) for c in cmp_.get("codes") or [] if not str(c).isdigit()})
    path = ROOT / "cache" / "sec_longq.json"
    saved = json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {}
    contact = os.environ.get("SEC_CONTACT")
    r = None
    if contact:
        ua = {"User-Agent": f"personal-valuation-dashboard {contact}", "Accept-Encoding": "gzip, deflate"}
        r = requests.get("https://www.sec.gov/files/company_tickers.json", headers=ua, timeout=40)
    if r is None or r.status_code != 200:  # SEC 연락처가 없거나 SEC 가 막으면 → 알파밴티지
        print("SEC 사용 안 함:", "연락처(SEC_CONTACT) 없음" if r is None else f"SEC 응답 {r.status_code}")
        path.write_text(json.dumps(alpha_vantage(tickers, saved), ensure_ascii=False, indent=0), encoding="utf-8")
        print("저장:", path)
        return
    cik = {v["ticker"].upper(): v["cik_str"] for v in r.json().values()}
    cik["GOOG"] = cik.get("GOOG") or cik.get("GOOGL")
    for t in tickers:
        if not cik.get(t):
            print("  CIK 없음", t)
            continue
        time.sleep(0.3)  # SEC 는 초당 10번 이하
        r = requests.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik[t]):010d}.json", headers=ua, timeout=60)
        if r.status_code != 200:
            print("  실패", t, r.status_code)
            continue
        import yfinance as yf
        sp = [(str(d.date()), float(x)) for d, x in yf.Ticker(t).splits.items() if x and x != 1]
        new = pull(r.json(), sp)
        saved[t] = {e: {**saved.get(t, {}).get(e, {}), **new.get(e, {})} for e in sorted(set(saved.get(t, {})) | set(new))}
        ks = sorted(saved[t])
        print(f"  {t}: {len(ks)}개 분기 ({ks[0] if ks else '-'} ~ {ks[-1] if ks else '-'})")
    path.write_text(json.dumps(saved, ensure_ascii=False, indent=0), encoding="utf-8")
    print("저장:", path)


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:  # 자체 점검: 누적 현금흐름 → 분기 3개월 (2분기 = 6개월 − 1분기, 4분기 = 연간 − 9개월)
        R = lambda s, e, v, f="2025-01-01": {"start": s, "end": e, "val": v, "filed": f}
        q = quarters([R("2024-01-01", "2024-03-31", 10), R("2024-01-01", "2024-06-30", 25), R("2024-01-01", "2024-09-30", 45),
                      R("2024-01-01", "2024-12-31", 70), R("2024-01-01", "2024-03-31", 11, "2025-06-01")])
        assert q == {"2024-03-31": 11, "2024-06-30": 14, "2024-09-30": 20, "2024-12-31": 25}, q
        # 주식 수 평균: 1~3분기 100·100·130 이고 9개월 평균 110, 연간 평균 115 → 4분기 ≈ 130 · 분할(10:1) 전에 낸 값은 ×10
        w = avg_quarters([R("2024-01-01", "2024-03-31", 100), R("2024-04-01", "2024-06-30", 100), R("2024-07-01", "2024-09-30", 130),
                          R("2024-01-01", "2024-09-30", 110), R("2024-01-01", "2024-12-31", 115), R("2023-10-01", "2023-12-31", 9, "2024-01-20")],
                         [("2024-06-10", 10.0)])
        assert abs(w["2024-12-31"] - 130) < 0.5 and w["2023-12-31"] == 90 and w["2024-03-31"] == 100, w
        a = av_pull({"quarterlyReports": [{"fiscalDateEnding": "2026-09-30", "totalRevenue": "17103000000", "operatingIncome": "2880000000", "grossProfit": "None"},
                                          {"fiscalDateEnding": "2013-12-31", "totalRevenue": "1"}]},
                    {"quarterlyReports": [{"fiscalDateEnding": "2026-09-30", "operatingCashflow": "4025000000", "capitalExpenditures": "-486000000"}]})
        assert a == {"2026-09-30": {"rev": 17103, "op": 2880, "ocf": 4025, "capex": 486}}, a
        b = av_pull({"quarterlyReports": [{"fiscalDateEnding": "2016-12-31", "totalRevenue": "43741000000", "operatingIncome": "1255000000", "grossProfit": "-18922000000"}]}, {})
        assert b == {"2016-12-31": {"rev": 43741, "op": 1255}}, b
        print("ok")
    else:
        main()
