"""미국 종목: 야후(yfinance) 가격·추정 EPS, SEC EDGAR 10년 EPS(연락처가 있을 때), Finviz 교차확인."""
import os
import re

import pandas as pd

from common import HTTP, REPORT, now_kst, num


def _label(end):
    """회계연도 끝 날짜 → 화면용 연도. 1~3월 결산(엔비디아 등)은 사실상 전년도 실적이라 한 해 앞당긴다."""
    end = pd.Timestamp(end)
    return end.year if end.month >= 4 else end.year - 1


def _ticker(t):
    import yfinance as yf
    return yf.Ticker(t)


def price_history(t):
    h = _ticker(t).history(period="max", auto_adjust=True)["Close"]
    if h.empty:
        raise RuntimeError("야후 가격 데이터 없음")
    h.index = h.index.tz_localize(None)
    return h


def now_info(t):
    i = _ticker(t).info
    price = i.get("currentPrice") or i.get("regularMarketPrice")
    if not price:
        raise RuntimeError("야후 현재가 없음")
    return {"name": i.get("shortName"), "price": float(price), "market_cap": i.get("marketCap"),
            "currency": i.get("currency", "USD"), "fwd_eps": i.get("forwardEps"), "eps": i.get("trailingEps"),
            "last_fy_end": i.get("lastFiscalYearEnd"), "div_yield": i.get("dividendYield")}


def _splits(t):
    s = _ticker(t).splits
    return [(d.tz_localize(None), float(r)) for d, r in s.items() if r and r != 1] if s is not None else []


def sec_eps(t):
    """SEC EDGAR 10-K 의 희석 EPS. SEC 는 요청자 연락처(SEC_CONTACT)를 요구한다."""
    contact = os.environ.get("SEC_CONTACT")
    if not contact:
        raise RuntimeError("SEC 연락처(SEC_CONTACT)가 없어 SEC 생략")
    ua = {"User-Agent": f"personal-valuation-dashboard {contact}"}
    m = HTTP.get("https://www.sec.gov/files/company_tickers.json", headers=ua).json()
    cik = next((v["cik_str"] for v in m.values() if v["ticker"].upper() == t.upper()), None)
    if not cik:
        raise RuntimeError("SEC CIK 없음")
    facts = HTTP.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json", headers=ua).json()
    gaap = facts.get("facts", {}).get("us-gaap", {})
    rows = (gaap.get("EarningsPerShareDiluted") or gaap.get("EarningsPerShareBasic") or {}).get("units", {}).get("USD/shares", [])
    best = {}
    for r in rows:
        if r.get("form") not in ("10-K", "10-K/A") or not r.get("start") or not r.get("end"):
            continue
        days = (pd.Timestamp(r["end"]) - pd.Timestamp(r["start"])).days
        if not 350 <= days <= 380:
            continue
        e = r["end"]
        if e not in best or r["filed"] > best[e]["filed"]:
            best[e] = r
    splits = _splits(t)
    out = {}
    for e, r in best.items():
        v = float(r["val"])
        filed = pd.Timestamp(r["filed"])
        for sd, ratio in splits:  # 분할 전에 제출된 값은 분할 비율만큼 나눈다
            if filed < sd and pd.Timestamp(e) < sd:
                v /= ratio
        out[e] = v
    return out


def history(t):
    """{화면 연도: {eps, estimate, src, avail, fy_end}}"""
    tk = _ticker(t)
    hist = {}
    try:
        eps = sec_eps(t)
        src = "SEC EDGAR (10-K)"
    except Exception as e:  # noqa: BLE001
        REPORT.block("SEC EDGAR", str(e)[:120])
        inc = tk.income_stmt
        row = [r for r in inc.index if "Diluted EPS" in r]
        eps = {str(c.date()): float(v) for c, v in inc.loc[row[0]].items() if v == v} if row else {}
        src = "야후 (최근 4~5년)"
    for e, v in eps.items():
        y = _label(e)
        hist[y] = {"eps": v, "src": src, "estimate": False, "fy_end": e,
                   "avail": (pd.Timestamp(e) + pd.Timedelta(days=75)).strftime("%Y-%m-%d")}
    # 추정치: 0y = 진행 중인 회계연도, +1y = 그다음 해
    est = tk.earnings_estimate
    info = tk.info
    last_end = pd.Timestamp(info.get("lastFiscalYearEnd"), unit="s") if info.get("lastFiscalYearEnd") else None
    if est is not None and last_end is not None:
        for k, add in (("0y", 1), ("+1y", 2)):
            if k in est.index and est.loc[k, "avg"] == est.loc[k, "avg"]:
                e = last_end + pd.DateOffset(years=add)
                y = _label(e)
                if y in hist and not hist[y].get("estimate"):
                    continue
                hist[y] = {"eps": float(est.loc[k, "avg"]), "estimate": True, "fy_end": e.strftime("%Y-%m-%d"),
                           "src": f"야후 컨센서스 ({int(est.loc[k, 'numberOfAnalysts'])}명)",
                           "low": float(est.loc[k, "low"]), "high": float(est.loc[k, "high"])}
    return hist


def finviz_next_eps(t):
    """Finviz 의 'EPS next Y'(내년 EPS 추정, 달러)."""
    txt = HTTP.get(f"https://finviz.com/quote.ashx?t={t}").text
    m = re.search(r"EPS next Y</td>\s*<td[^>]*>(?:<[^>]+>)*\s*(-?[\d.]+)\s*<", txt)
    if not m:
        m = re.search(r"EPS next Y.{0,300}?>(-?\d+\.\d+)<", txt, re.S)
    return num(m.group(1)) if m else None
