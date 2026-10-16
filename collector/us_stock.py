"""미국 종목: 야후(yfinance) 가격·추정 EPS, SEC EDGAR 10년 EPS(연락처가 있을 때), Finviz 교차확인."""
import os
import re

import pandas as pd

from common import CACHE, HTTP, REPORT, num, read_json


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
    import time

    import requests
    ua = {"User-Agent": f"personal-valuation-dashboard {contact}", "Accept-Encoding": "gzip, deflate"}

    def get(url):  # SEC 는 브라우저 흉내 없이 연락처만 담은 요청을 원한다 (초당 10회 이하)
        time.sleep(0.3)
        r = requests.get(url, headers=ua, timeout=40)
        if r.status_code != 200:
            raise RuntimeError(f"SEC 접속 실패 (HTTP {r.status_code})")
        return r.json()

    m = get("https://www.sec.gov/files/company_tickers.json")
    cik = next((v["cik_str"] for v in m.values() if v["ticker"].upper() == t.upper()), None)
    if not cik:
        raise RuntimeError("SEC CIK 없음")
    facts = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json")
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
    eps = {}
    # 1) 지난 실적: SEC 10-K (서버에서는 SEC 가 막아서, 한 번 받아 둔 파일을 쓴다)
    try:
        eps = {e: (v, "SEC EDGAR (10-K)") for e, v in sec_eps(t).items()}
    except Exception:  # noqa: BLE001
        saved = (read_json(CACHE / "us_eps_sec.json", {}) or {}).get(t.upper(), {})
        splits = _splits(t)
        for e, r in saved.items():
            v = float(r["val"])
            for sd, ratio in splits:  # 분할 전에 제출된 값은 분할 비율만큼 나눈다
                if pd.Timestamp(r["filed"]) < sd and pd.Timestamp(e) < sd:
                    v /= ratio
            eps[e] = (v, "SEC EDGAR (10-K, 저장본)")
    # 2) 최근 실적: 야후 (새 연간 실적이 나오면 자동으로 추가)
    try:
        inc = tk.income_stmt
        row = [r for r in inc.index if "Diluted EPS" in r]
        for c, v in (inc.loc[row[0]].items() if row else []):
            if v == v and str(c.date()) not in eps:
                eps[str(c.date())] = (float(v), "야후 파이낸스")
    except Exception as e:  # noqa: BLE001
        REPORT.block("야후 재무제표", str(e)[:80])
    for e, (v, src) in eps.items():
        y = _label(e)
        hist[y] = {"eps": round(v, 4), "src": src, "estimate": False, "fy_end": e,
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
    m = re.search(r"EPS next Y(?:</div>)?</td>\s*<td[^>]*>(?:<[^>]+>)*\s*(-?[\d.]+)\s*<", txt)
    if not m:
        m = re.search(r"EPS next Y.{0,300}?>(-?\d+\.\d+)<", txt, re.S)
    return num(m.group(1)) if m else None
