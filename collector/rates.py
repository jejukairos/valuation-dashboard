"""금리: 미국채 10년(FRED → 야후 대체), 국고채 3년·10년(한국은행 ECOS)."""
import io
import os

import pandas as pd

from common import CACHE, HTTP, REPORT, now_kst, read_json, write_json

START = "2006-01-01"


def weekly(series):
    """일별 → 주간(금요일) 마지막 값. [[날짜, 값], ...]"""
    s = series.dropna().sort_index()
    w = s.resample("W-FRI").last().dropna()
    out = [[d.strftime("%Y-%m-%d"), round(float(v), 3)] for d, v in w.items()]
    # 마지막 주는 실제 최신 날짜로
    if len(s):
        out[-1] = [s.index[-1].strftime("%Y-%m-%d"), round(float(s.iloc[-1]), 3)]
    return out


def pack(series, source):
    s = series.dropna().sort_index()
    return {"latest": round(float(s.iloc[-1]), 3), "date": s.index[-1].strftime("%Y-%m-%d"),
            "source": source, "hist": weekly(s)}


def us10y():
    try:
        r = HTTP.get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd={START}", timeout=25, tries=1)
        df = pd.read_csv(io.StringIO(r.text))
        df.columns = ["date", "v"]
        s = pd.Series(pd.to_numeric(df["v"], errors="coerce").values, index=pd.to_datetime(df["date"]))
        if s.dropna().empty:
            raise RuntimeError("빈 데이터")
        return pack(s, "FRED DGS10")
    except Exception as e:  # FRED 가 막히면 야후(^TNX)로
        REPORT.block("FRED", f"접속 실패 → Yahoo ^TNX 로 대체 ({e})")
        import yfinance as yf
        h = yf.Ticker("^TNX").history(start=START)["Close"]
        h.index = h.index.tz_localize(None)
        return pack(h, "Yahoo ^TNX")


def ecos(code, name):
    key = os.environ.get("ECOS_KEY")
    if not key:
        raise RuntimeError("ECOS_KEY 가 없어요 (GitHub Secrets 확인)")
    # 지난 값은 cache 에 보관하고, 최근 분만 새로 받는다 (해외 서버에서 ECOS 가 느려서)
    path = CACHE / f"ecos_{code}.json"
    old = read_json(path, {})
    end = now_kst().strftime("%Y%m%d")
    start = (pd.Timestamp(max(old)) - pd.Timedelta(days=20)).strftime("%Y%m%d") if old else "20060101"
    url = f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/10000/817Y002/D/{start}/{end}/{code}"
    source = f"한국은행 ECOS ({name})"
    try:
        j = HTTP.get(url, timeout=20, tries=2).json()
        rows = j.get("StatisticSearch", {}).get("row")
        if not rows:
            raise RuntimeError(f"ECOS 응답 이상: {str(j)[:120]}")
        for x in rows:
            old[f"{x['TIME'][:4]}-{x['TIME'][4:6]}-{x['TIME'][6:]}"] = float(x["DATA_VALUE"])
    except Exception as e:  # noqa: BLE001 - 해외 서버에서 ECOS 가 자주 막혀서 네이버로 대체
        if not old:
            raise
        REPORT.block("한국은행 ECOS", f"접속 실패 → 네이버 증권 채권금리로 최근 값 대체 ({str(e)[-60:]})")
        ric = NAVER_BOND.get(code)
        if not ric:
            raise RuntimeError(f"한국은행 ECOS 접속 실패, 대체 출처도 못 씀 ({str(e)[-60:]})")
        j = HTTP.get(f"https://m.stock.naver.com/front-api/marketIndex/prices?category=bond&reutersCode={ric}&page=1&pageSize=30").json()
        last_ecos = max(old)
        for x in j.get("result", []):
            d = x["localTradedAt"][:10]
            if d > last_ecos:
                old[d] = float(x["closePrice"])
        source = f"한국은행 ECOS ({name}) + 최근값 네이버 증권"
    write_json(path, old)
    s = pd.Series(old)
    s.index = pd.to_datetime(s.index)
    return pack(s, source)


NAVER_BOND = {"010200000": "KR3YT%3DRR", "010210000": "KR10YT%3DRR"}


def collect():
    from common import attempt
    return {
        "us10y": attempt("미국채 10년", us10y),
        "kr3y": attempt("국고채 3년", ecos, "010200000", "국고채 3년"),
        "kr10y": attempt("국고채 10년", ecos, "010210000", "국고채 10년"),
    }
