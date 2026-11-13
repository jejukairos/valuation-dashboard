"""📐 종목마다 일봉·주봉·월봉 캔들 + 거래량 → site/data/ohlc/{코드}.json (사용자 11/7: '선 읽기' 칸 안 차트 — 지지·저항·피보나치·채널을 고가·저가로).
한국 = 네이버 차트 데이터(수정주가, board.kr_ohlcv) · 미국 = 야후(분할만 반영, 증권사 차트와 같은 숫자).
일봉 약 1년 10개월 · 주봉 약 5년 · 월봉 약 12년만 남겨 파일을 작게 (선 계산은 화면에서 봉마다) + dd = 5년 일봉 종가 (📉 고점 대비 하락률 그림).
  python collector/ohlc.py [코드 …]   (코드 없으면 보유·관심·공동 전부)"""
import sys

import pandas as pd

from board import kr_ohlcv, resample, us_ohlcv
from common import DATA, REPORT, load_yaml, now_kst, write_json

OUT = DATA / "ohlc"
KEEP = {"d": 460, "w": 265, "m": 150}  # 일봉 460 = 화면 250봉 + 200일선 계산용


def pack(df, digits):
    """DataFrame → {t: ['26-11-06'…], o, h, l, c, v} (candleSVG 와 같은 모양)."""
    r = lambda s: [round(float(x), digits) if digits else int(round(float(x))) for x in s]  # noqa: E731
    return {"t": [d.strftime("%y-%m-%d") for d in df.index], "o": r(df["Open"]), "h": r(df["High"]), "l": r(df["Low"]), "c": r(df["Close"]),
            "v": [int(x) for x in df["Volume"].fillna(0)]}


def dd5(df, dg):
    """📉 고점 대비 하락률 그림 (사용자 11/13 엔비디아 그림처럼, 전 종목 상세): 최근 5년 일봉 종가 + 그 전 가장 높은 종가 pk0 (가진 13~15년 중).
    주봉으로 붙이면 고점·바닥이 흐려져서 (엔비디아 25/4 -36.1% vs 일봉 -36.9%) 일봉 그대로."""
    c = df["Close"].dropna()
    cut = c.index[-1] - pd.DateOffset(years=5)
    pre, win = c[c.index < cut], c[c.index >= cut]
    r = (lambda x: round(float(x), dg)) if dg else (lambda x: int(round(float(x))))  # noqa: E731
    return {"pk0": r(pre.max()) if len(pre) else None, "t": [d.strftime("%y-%m-%d") for d in win.index], "c": [r(x) for x in win]}


def one(df, us):
    dg = 2 if us else 0
    return {"d": pack(df.tail(KEEP["d"]), dg), "w": pack(resample(df, "W-FRI").tail(KEEP["w"]), dg), "m": pack(resample(df, "ME").tail(KEEP["m"]), dg), "dd": dd5(df, dg)}


def collect(codes=None):
    sy = load_yaml("stocks.yaml")
    hs = [h for k in ("holdings", "watchlist", "joint") for h in (sy.get(k) or []) if not h.get("data_code")]
    hs = [h for i, h in enumerate(hs) if str(h["code"]) not in {str(x["code"]) for x in hs[:i]} and (not codes or str(h["code"]) in codes)]
    OUT.mkdir(parents=True, exist_ok=True)
    us = [str(h["code"]) for h in hs if h.get("market", "KR").upper() == "US"]
    upx = us_ohlcv(["GOOGL" if t == "GOOG" else t for t in us], period="15y", adj=False) if us else {}
    n = 0
    for h in hs:
        code = str(h["code"])
        try:
            if code in us:
                df = upx.get("GOOGL" if code == "GOOG" else code)
                if df is None:
                    raise RuntimeError("야후 가격 없음")
            else:
                df = kr_ohlcv(code, years=13)
            write_json(OUT / f"{code}.json", {"code": code, "name": h["name"], "at": now_kst().strftime("%Y-%m-%d %H:%M"), **one(df, code in us)})
            n += 1
        except Exception as e:  # noqa: BLE001 - 한 종목이 안 돼도 나머지는
            REPORT.block("📐 일·주·월봉 캔들", f"{h['name']}: {str(e)[:60]}")
    print(f"📐 캔들 {n}/{len(hs)}종목")


if __name__ == "__main__":
    collect(sys.argv[1:] or None)
