"""📐 종목마다 일봉·주봉·월봉 캔들 + 거래량 → site/data/ohlc/{코드}.json (사용자 11/7: '선 읽기' 칸 안 차트 — 지지·저항·피보나치·채널을 고가·저가로).
한국 = 네이버 차트 데이터(수정주가, board.kr_ohlcv) · 미국 = 야후(분할만 반영, 증권사 차트와 같은 숫자).
일봉 약 1년 10개월 · 주봉 약 5년 · 월봉 약 12년만 남겨 파일을 작게 (선 계산은 화면에서 봉마다) + dd = 10년 일봉 종가 + 200주선 (📉 고점 대비 하락률 그림).
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


def dd5(df, dg, years=10):
    """📉 고점 대비 하락률 그림 (사용자 11/13 엔비디아 그림처럼, 전 종목 상세): 최근 10년 일봉 종가 + 그 전 가장 높은 종가 pk0 (가진 13~15년 중)
    + w200 = 200주선 (주봉 종가 200주 평균, 그 주 값을 날마다 이어 씀 — 11/22 '엔비디아 4년 주기 하락' 그림의 파란 선) · 11/22 5년 → 10년 (2018년이 보이게).
    주봉으로 붙이면 고점·바닥이 흐려져서 (엔비디아 25/4 -36.1% vs 일봉 -36.9%) 일봉 그대로."""
    c = df["Close"].dropna()
    cut = c.index[-1] - pd.DateOffset(years=years)
    pre, win = c[c.index < cut], c[c.index >= cut]
    r = (lambda x: round(float(x), dg)) if dg else (lambda x: int(round(float(x))))  # noqa: E731
    wk = c.resample("W-FRI").last().dropna()
    ma = wk.rolling(200).mean()
    w = ma.reindex(win.index, method="ffill")
    return {"pk0": r(pre.max()) if len(pre) else None, "t": [d.strftime("%y-%m-%d") for d in win.index], "c": [r(x) for x in win],
            "w200": [r(x) if x == x else None for x in w], **w200_rsi(wk, ma, cut)}


def w200_rsi(wk, ma, cut, near=10, lo=35, gap_w=12):
    """🛡 200주선 + 주봉 RSI 과매도 신호 (사용자 11/23 엔비디아 '과거 주요 지지 구간' 그림: 18년·22년·26년 동그라미) — 주봉 종가가 200주선 ±near% 안
    + 주봉 RSI(14) lo 이하인 주. gap_w 주 넘게 떨어지면 다른 신호. 신호마다 그 뒤 52주 안 가장 낮은 종가(더 빠진 폭)·26주·52주 뒤 수익률 → 화면 표.
    엔비디아 18/12/21 (+9.8%, RSI 28.6) · 22/9/2 (+8.4%, 34.8) · 26/11/20 (+1.1%, 25.0)."""
    from bigtech import rsi_s
    rs = rsi_s(wk)
    on = [i for i in range(len(wk)) if ma.iloc[i] == ma.iloc[i] and rs[i] is not None and abs(wk.iloc[i] / ma.iloc[i] - 1) * 100 <= near and rs[i] <= lo]
    eps = []
    for i in on:
        if eps and i - eps[-1][-1] <= gap_w:
            eps[-1].append(i)
        else:
            eps.append([i])
    p = lambda a, b: round(float(a / b - 1) * 100, 1)  # noqa: E731
    sig = [{"t": wk.index[e[0]].strftime("%y-%m-%d"), "n": len(e), "gap": p(wk.iloc[e[0]], ma.iloc[e[0]]), "rsi": round(rs[e[0]], 1),
            "low": p(wk.iloc[e[0]:e[0] + 53].min(), wk.iloc[e[0]]), **{f"r{k}": p(wk.iloc[e[0] + k], wk.iloc[e[0]]) for k in (26, 52) if e[0] + k < len(wk)}}
           for e in eps if wk.index[e[0]] >= cut]
    return {"sig": sig, "wrsi": None if rs[-1] is None else round(rs[-1], 1)}


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
    if sys.argv[1:] == ["--test"]:
        ix = pd.date_range("2020-01-03", periods=260, freq="W-FRI")
        v = [100 + i for i in range(230)] + [330 - 8 * i for i in range(1, 16)] + [210 + 5 * i for i in range(15)]  # 오르다 급락해 200주선 근처 → 다시 오름
        wk = pd.Series(v, index=ix, dtype=float)
        s = w200_rsi(wk, wk.rolling(200).mean(), ix[0])
        assert len(s["sig"]) == 1 and s["sig"][0]["rsi"] <= 35 and abs(s["sig"][0]["gap"]) <= 10 and s["sig"][0]["low"] <= 0, s
        print("ok", s["sig"])
    else:
        collect(sys.argv[1:] or None)
