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


FS_RE = re.compile(r"forward 12-month P/E ratio (?:for the S&P 500 )?is (\d+\.\d+).{0,200}?5-year average (?:of |\()(\d+\.\d+).{0,80}?10-year average (?:of |\()(\d+\.\d+)", re.S)


FS_PDF = ("https://advantage.factset.com/hubfs/Website/Resources%20Section/Research%20Desk/"
          "Earnings%20Insight/EarningsInsight_{}.pdf")


def _num(s):
    return float(re.sub(r"[\s,]", "", s))


def sp500_forward():
    """FactSet Earnings Insight 주간 보고서(PDF)에서 선행 PER, 5·10년 평균, 연간 이익 증가율, 지수를 읽고
    26E·27E EPS 를 계산한다. PDF 를 못 받으면 블로그 글에서 선행 PER 만 읽는다."""
    try:
        return _sp500_from_pdf()
    except Exception as e:  # noqa: BLE001
        REPORT.block("FactSet 보고서 PDF", f"못 읽음 → 블로그 글로 대체 ({str(e)[:80]})")
        return _sp500_from_blog()


def _sp500_from_pdf():
    from pypdf import PdfReader
    today = pd.Timestamp(now_kst().date())
    last_err = "PDF 없음"
    for back in range(0, 36):
        d = today - pd.Timedelta(days=back)
        if d.weekday() != 4:  # 금요일자 보고서
            continue
        try:
            r = HTTP.get(FS_PDF.format(d.strftime("%m%d%y")), timeout=40, tries=1)
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
            continue
        if not r.content.startswith(b"%PDF"):
            continue
        pages = PdfReader(io.BytesIO(r.content)).pages
        text = " ".join((p.extract_text() or "") for p in pages[:20])
        text = re.sub(r"\s+", " ", text)
        text = re.sub(r"(?<=\d) (?=\d)", "", text)  # PDF 글자 사이 공백 제거 ('1 9.1' → '19.1')
        text = text.replace(" -", "-").replace("- ", "-")
        m = FS_RE.search(text)
        if not m:
            last_err = "선행 PER 문장 없음"
            continue
        pe, a5, a10 = float(m.group(1)), float(m.group(2)), float(m.group(3))
        y0 = d.year
        g0 = re.search(rf"For CY {y0}, analysts are projecting earnings growth of (-?[\d.]+)%", text)
        g1 = re.search(rf"For CY {y0 + 1}, analysts are projecting earnings growth of (-?[\d.]+)%", text)
        px = re.search(r"closing price of ([\d,]+\.\d+)", text)
        tpe = re.search(r"trailing 12-month P/E ratio is ([\d.]+)", text)
        out = {"value": pe, "avg5": a5, "avg10": a10, "date": d.strftime("%Y-%m-%d"),
               "url": FS_PDF.format(d.strftime("%m%d%y")), "source": "FactSet Earnings Insight (주간 보고서)",
               "trailing_pe": float(tpe.group(1)) if tpe else None}
        if px:
            price = _num(px.group(1))
            f12 = price / pe  # 선행 12개월 EPS
            out["index"] = price
            out["fwd12_eps"] = round(f12, 2)
            if g1:
                gr1 = float(g1.group(1)) / 100
                w0 = max(0.0, (12 - (d.month - 1) - d.day / 31) / 12)
                e0 = f12 / (w0 + (1 - w0) * (1 + gr1))  # 선행 EPS = 올해×남은비중 + 내년×나머지
                out["eps"] = {f"{str(y0)[2:]}E": round(e0, 2), f"{str(y0 + 1)[2:]}E": round(e0 * (1 + gr1), 2),
                              f"{str(y0 + 2)[2:]}E": None}
                out["growth"] = {f"{str(y0)[2:]}E": float(g0.group(1)) if g0 else None,
                                 f"{str(y0 + 1)[2:]}E": float(g1.group(1))}
                out["eps_note"] = (f"FactSet 이 밝힌 선행 PER({pe})·지수({price:,.0f})·CY{y0 + 1} 이익 증가율"
                                   f"({g1.group(1)}%)로 계산한 값. {str(y0 + 2)[2:]}E 는 FactSet 보고서에 없어 N/A")
        _keep_hist(out)
        return out
    raise RuntimeError(last_err)


def _keep_hist(out):
    # 이력 쌓기 (FactSet 은 과거 시계열을 무료로 주지 않으므로 직접 모은다)
    path = CACHE / "sp500_fwd_hist.json"
    h = read_json(path, {})
    h[out["date"]] = out["value"]
    write_json(path, h)
    out["hist"] = sorted([[k, v] for k, v in h.items()])


def _sp500_from_blog():
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
        _keep_hist(out)
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
    ys = [y0, y0 + 1, y0 + 2]
    w0 = max(0.0, (12 - (now.month - 1) - now.day / 31) / 12)  # 올해 남은 비중
    # 같은 종목 묶음으로 연도별 합계를 내야 서로 비교가 된다: 26E~28E 순이익이 모두 있는 종목만 사용
    cap_sum = 0.0
    ni = {y: 0.0 for y in ys}
    eq = {y: 0.0 for y in ys}
    eq_cap = 0.0
    eq_last = 0.0
    used, missing = 0, []
    for code, name, cap in stocks:
        try:
            w = wise_annual(code)
            vals = [w.get(y, {}).get("ni") for y in ys]
            if any(v is None for v in vals) or not w.get(y0 + 1, {}).get("estimate"):
                missing.append(name)
                continue
            cap_sum += cap
            for y, v in zip(ys, vals):
                ni[y] += v
            eqs = [w.get(y, {}).get("equity") for y in ys]
            actual = [y for y, r in w.items() if not r.get("estimate") and r.get("equity")]
            if all(e is not None for e in eqs) and actual:
                eq_cap += cap
                for y, e in zip(ys, eqs):
                    eq[y] += e
                eq_last += w[max(actual)]["equity"]
            used += 1
        except Exception:  # noqa: BLE001
            missing.append(name)
    if used < n * 0.6 or ni[y0 + 1] <= 0:
        raise RuntimeError(f"컨센서스가 있는 종목이 너무 적음 ({used}/{len(stocks)})")
    fwd_ni = w0 * ni[y0] + (1 - w0) * ni[y0 + 1]
    per = cap_sum / fwd_ni
    fwd_eq = w0 * eq[y0] + (1 - w0) * eq[y0 + 1]
    level = None
    try:
        j = HTTP.get("https://m.stock.naver.com/api/index/KOSPI/integration").json()
        level = num({x["code"]: x["value"] for x in j.get("totalInfos", [])}.get("lastClosePrice"))
    except Exception:  # noqa: BLE001
        pass
    lab = lambda y: f"{str(y)[2:]}E"  # noqa: E731
    per_y = {lab(y): round(cap_sum / ni[y], 2) if ni[y] > 0 else None for y in ys}
    pbr_y = {lab(y): round(eq_cap / eq[y], 3) if eq[y] > 0 else None for y in ys}
    years = {
        "per": per_y, "pbr": pbr_y,
        "eps": {k: round(level / v, 1) if (level and v) else None for k, v in per_y.items()},
        "bps": {k: round(level / v, 1) if (level and v) else None for k, v in pbr_y.items()},
        "growth": {lab(y): round((ni[y] / ni[y - 1] - 1) * 100, 1) for y in ys[1:]},
    }
    date = now.strftime("%Y-%m-%d")
    path = CACHE / "kospi_fwd_hist.json"
    h = read_json(path, {})
    h[date] = round(per, 2)
    write_json(path, h)
    return {"value": round(per, 2), "date": date, "used": used, "total": len(stocks), "missing": missing[:20],
            "level": level, "years": years,
            "fwd_pbr": round(eq_cap / fwd_eq, 2) if fwd_eq else None,
            "fwd_roe": round(fwd_ni / fwd_eq * 100, 1) if fwd_eq else None,
            "fwd_ni_jo": round(fwd_ni / 1e4, 1), "cap_jo": round(cap_sum / 1e4),
            "ni_jo": {lab(y): round(ni[y] / 1e4, 1) for y in ys},
            "pbr_now": round(eq_cap / eq_last, 3) if eq_last else None,
            "source": f"직접 계산 · 시총 상위 {len(stocks)}개 중 {used}개 컨센서스 합산",
            "method": ("코스피 지수 EPS = 지수 ÷ PER (PER = 시가총액 합 ÷ 지배순이익 합). "
                       "BPS 도 같은 방식(자본총계(지배) 합). 26E~28E 추정치가 모두 있는 종목만 넣어 연도별로 비교 가능하게 함"),
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
            "hist": [[d.strftime("%Y-%m-%d"), round(float(v), 2)] for d, v in w["PER"].items()],
            "pbr_hist": [[d.strftime("%Y-%m-%d"), round(float(v), 3)] for d, v in w["PBR"].items() if v > 0]}


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
