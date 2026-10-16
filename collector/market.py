"""시장 전체: S&P500 PER(multpl 후행, FactSet 선행), 코스피 PER(선행: 상위 종목 합산 / 후행: KRX)."""
import io
import os
import re
from datetime import datetime

import pandas as pd

from common import CACHE, HTTP, REPORT, SETTINGS, now_kst, num, read_json, write_json
from kr_stock import wise_annual


# ---------- S&P500 ----------
def sp500_trailing():
    r = HTTP.get("https://www.multpl.com/s-p-500-pe-ratio/table/by-month")
    df = pd.read_html(io.StringIO(r.text))[0]
    df.columns = ["date", "v"]
    df["v"] = df["v"].astype(str).str.extract(r"([\d.]+)")[0].astype(float)
    df["date"] = pd.to_datetime(df["date"])
    df = df.dropna().sort_values("date")
    return {"source": "multpl.com (후행 PER, 월별)",
            "hist": [[d.strftime("%Y-%m-%d"), round(v, 2)] for d, v in zip(df["date"], df["v"])]}


FS_RE = re.compile(r"forward 12-month P/E ratio (?:for the S&P 500 )?is (\d+\.\d+).{0,200}?5-year average \((\d+\.\d+)\).{0,80}?10-year average \((\d+\.\d+)\)", re.S)


def sp500_forward():
    """FactSet Earning Insight 최신 글에서 선행 12개월 PER 과 5·10년 평균을 읽는다."""
    urls = []
    for page in ("https://insight.factset.com/topic/earnings", "https://insight.factset.com/topic/earnings/page/2"):
        t = HTTP.get(page).text
        for u in re.findall(r'href="(https://insight\.factset\.com/[a-z0-9\-]+)"', t):
            if u not in urls and "/topic" not in u and "/page" not in u and "/author" not in u:
                urls.append(u)
    for u in urls[:12]:
        t = HTTP.get(u).text
        text = re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", t)).replace("’", "'")
        m = FS_RE.search(text)
        if not m:
            continue
        dm = re.search(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})', t) or \
            re.search(r'article:published_time" content="(\d{4}-\d{2}-\d{2})', t)
        date = dm.group(1) if dm else now_kst().strftime("%Y-%m-%d")
        out = {"value": float(m.group(1)), "avg5": float(m.group(2)), "avg10": float(m.group(3)),
               "date": date, "url": u, "source": "FactSet Earnings Insight"}
        # 이력 쌓기 (FactSet 은 과거 시계열을 무료로 주지 않으므로 직접 모은다)
        path = CACHE / "sp500_fwd_hist.json"
        h = read_json(path, {})
        h[date] = out["value"]
        write_json(path, h)
        out["hist"] = sorted([[k, v] for k, v in h.items()])
        return out
    raise RuntimeError("FactSet 최근 글에서 선행 PER 문장을 못 찾음")


# ---------- 코스피 ----------
def kospi_forward():
    """코스피 시가총액 상위 N개 종목의 (시가총액 합 ÷ 12개월 선행 지배순이익 합).
    FnGuide 가 집계하는 '코스피 12개월 선행 PER' 을 무료 데이터로 근사한 값."""
    n = int(SETTINGS.get("kospi_forward", {}).get("top_n", 50))
    stocks = []
    page = 1
    while len(stocks) < n and page <= 5:
        j = HTTP.get(f"https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page={page}&pageSize=60").json()
        for s in j.get("stocks", []):
            name = s.get("stockName", "")
            if s.get("stockEndType") != "stock" or re.search(r"우[A-Z]?$|우\(", name) or not s["itemCode"].endswith("0"):
                continue
            stocks.append((s["itemCode"], name, num(s.get("marketValue"))))  # 억원
        page += 1
    stocks = stocks[:n]
    now = now_kst()
    y0 = now.year
    w0 = max(0.0, (12 - (now.month - 1) - now.day / 31) / 12)  # 올해 남은 비중
    cap_sum = ni_sum = 0.0
    used, missing = 0, []
    for code, name, cap in stocks:
        try:
            w = wise_annual(code)
            a, b = w.get(y0, {}).get("ni"), w.get(y0 + 1, {}).get("ni")
            if a is None or b is None or not w.get(y0 + 1, {}).get("estimate"):
                missing.append(name)
                continue
            cap_sum += cap
            ni_sum += w0 * a + (1 - w0) * b
            used += 1
        except Exception:  # noqa: BLE001
            missing.append(name)
    if used < n * 0.6 or ni_sum <= 0:
        raise RuntimeError(f"컨센서스가 있는 종목이 너무 적음 ({used}/{len(stocks)})")
    per = cap_sum / ni_sum
    date = now.strftime("%Y-%m-%d")
    path = CACHE / "kospi_fwd_hist.json"
    h = read_json(path, {})
    h[date] = round(per, 2)
    write_json(path, h)
    return {"value": round(per, 2), "date": date, "used": used, "total": len(stocks), "missing": missing[:20],
            "source": f"직접 계산 · 시총 상위 {len(stocks)}개 중 {used}개 컨센서스 합산",
            "hist": sorted([[k, v] for k, v in h.items()])}


def kospi_trailing():
    """KRX 코스피 PER·PBR·배당수익률 (KRX 로그인 계정이 GitHub Secrets 에 있을 때만)."""
    if not (os.environ.get("KRX_ID") and os.environ.get("KRX_PW")):
        raise RuntimeError("KRX 로그인 계정이 없어 후행 PER 은 생략 (선택 사항)")
    from pykrx import stock
    end = now_kst().strftime("%Y%m%d")
    df = stock.get_index_fundamental("20000101", end, "1001")
    if df is None or df.empty:
        raise RuntimeError("KRX 응답 없음")
    df = df[df["PER"] > 0]
    w = df.resample("W-FRI").last().dropna()
    last = df.iloc[-1]
    return {"per": float(last["PER"]), "pbr": float(last["PBR"]), "div": float(last.get("배당수익률", 0) or 0),
            "date": df.index[-1].strftime("%Y-%m-%d"), "source": "KRX (pykrx)",
            "hist": [[d.strftime("%Y-%m-%d"), round(float(v), 2)] for d, v in w["PER"].items()]}


def collect():
    from common import attempt
    return {
        "sp500_trailing": attempt("S&P500 후행 PER (multpl)", sp500_trailing),
        "sp500_forward": attempt("S&P500 선행 PER (FactSet)", sp500_forward),
        "kospi_forward": attempt("코스피 선행 PER (직접 계산)", kospi_forward),
        "kospi_trailing": _optional(kospi_trailing),
    }


def _optional(fn):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        print(f"  - 코스피 후행 PER 생략: {e}")
        return {"error": str(e)}
