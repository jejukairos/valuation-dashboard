"""📡 신호 탭 🇺🇸 미국: 빅테크 8곳 '고점 대비 하락률' · '올해 수익률' (사용자 11/13 그림 2장을 본떠 매일) → site/data/bigtech.json.
고점 = 상장 뒤 장중 최고가 · 올해 = 작년 마지막 거래일 종가 대비 (올해 상장했으면 첫날 시가 대비) · 야후 일봉 (분할만 반영)
— 2026-11-12 종가로 계산하니 전달받은 그림 숫자 16개가 모두 같았음.   python collector/bigtech.py [--test]"""
import sys

import pandas as pd

from common import DATA, REPORT, now_kst, write_json

# 그림 순서·이름 그대로 (마소 = 마이크로소프트) — 화면에서 값 순서로 다시 정렬
T = [("AAPL", "애플"), ("MSFT", "마소"), ("AMZN", "아마존"), ("TSLA", "테슬라"), ("META", "메타"), ("GOOGL", "알파벳"), ("NVDA", "엔비디아"), ("SPCX", "스페이스X")]
# 사용자 11/22 그림 2장 (주요 지수 ETF · AI 인프라 대장주 + RSI 14): 그림 순서 그대로, 세 번째 칸 = 특징
ETF = [("SPY", "S&P500"), ("QQQ", "나스닥100"), ("DIA", "다우"), ("SOXX", "반도체")]
AI = [("MU", "마이크론", "메모리"), ("SNDK", "샌디스크", "메모리"), ("INTC", "인텔", "CPU/팹"), ("AMD", "AMD", "CPU"), ("DELL", "델", "서버"),
      ("BE", "블룸에너지", "전력"), ("NBIS", "네비우스", "데이터센터"), ("AMAT", "어플라이드머티", "장비"), ("AVGO", "브로드컴", "맞춤/광통신"),
      ("MRVL", "마벨", "맞춤/광통신"), ("LITE", "루멘텀", "광통신"), ("GLW", "코닝", "광통신")]


def rsi_s(c, n=14):
    """RSI(14) 줄 (c 와 같은 길이, 앞 n 칸은 None) — 와일더 방식 (오른 날 평균 ÷ 내린 날 평균을 1/14 씩 이어서 평균, 증권사 차트와 같은 계산).
    30 아래 = 과매도 · 70 위 = 과매수. ohlc.py 주봉 RSI(200주선 + 과매도 신호)도 이걸 씀."""
    d = c.to_numpy(dtype=float)[1:] - c.to_numpy(dtype=float)[:-1]
    out = [None] * len(c)
    if len(d) < n:
        return out
    g, l = d.clip(min=0), -d.clip(max=0)
    ag, al = g[:n].mean(), l[:n].mean()  # 처음 14일은 그냥 평균, 그 뒤로 (앞 평균 × 13 + 오늘) ÷ 14
    out[n] = 100.0 if al == 0 else float(100 - 100 / (1 + ag / al))
    for i in range(n, len(d)):
        ag, al = (ag * (n - 1) + g[i]) / n, (al * (n - 1) + l[i]) / n
        out[i + 1] = 100.0 if al == 0 else float(100 - 100 / (1 + ag / al))
    return out


def rsi(c, n=14):
    """마지막 날 RSI(14) (자료가 15칸 안 되면 None)."""
    return rsi_s(c.dropna(), n)[-1]


def calc(df):
    """일봉(마지막 줄 = 가장 최근 거래일) → 종가·장중 최고가·고점 대비 %·올해 기준 가격·올해 %."""
    last = df.index[-1]
    prev = df[df.index.year < last.year]
    base, bn = (float(prev["Close"].iloc[-1]), "작년 말 종가") if len(prev) else (float(df["Open"].iloc[0]), f"{df.index[0]:%y/%m/%d} 상장 첫날 시가")
    c, hi = float(df["Close"].iloc[-1]), float(df["High"].max())
    wk = df[df.index < last - pd.to_timedelta(last.weekday(), unit="D")]["Close"]  # 주간 = 지난주 마지막 거래일 종가 대비
    return {"wk": round((c / float(wk.iloc[-1]) - 1) * 100, 1) if len(wk) else None, "rsi": None if (r_ := rsi(df["Close"])) is None else round(r_, 1), "date": f"{last:%Y-%m-%d}", "close": round(c, 2), "hi": round(hi, 2), "hi_d": f"{df['High'].idxmax():%Y-%m-%d}",
            "dd": round((c / hi - 1) * 100, 1), "base": round(base, 2), "base_n": bn, "ytd": round((c / base - 1) * 100, 1)}


def collect():
    from board import us_ohlcv
    px, rows = us_ohlcv([t for t, *_ in T + ETF + AI], period="max", adj=False), []
    for t, nm in T:
        df = px.get(t)
        if df is None or len(df) < 2:
            REPORT.block("🇺🇸 빅테크 고점 대비·올해 수익률", f"{nm}({t}) 야후 가격 없음")
            continue
        p = calc(df.iloc[:-1])  # 전 거래일 → 화면 '어제보다'
        rows.append({"t": t, "n": nm, **calc(df), "dd_prev": p["dd"], "ytd_prev": p["ytd"]})
    if not rows:
        raise RuntimeError("야후 가격을 하나도 못 받음")
    more = {k: [{"t": t, "n": nm, "f": f[0] if f else "", **calc(px[t])} for t, nm, *f in L if px.get(t) is not None and len(px[t]) > 15] for k, L in (("etf", ETF), ("ai", AI))}
    write_json(DATA / "bigtech.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "rows": rows, **more})
    print(f"🇺🇸 빅테크 {len(rows)}/{len(T)}곳 · {rows[0]['date']} 종가")


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        ix = pd.to_datetime(["2025-12-30", "2025-12-31", "2026-03-02", "2026-11-12"])
        r = calc(pd.DataFrame({"Open": [90, 95, 120, 110], "High": [100, 99, 130, 112], "Close": [95, 100, 125, 117]}, index=ix))
        assert (r["dd"], r["ytd"], r["base_n"], r["hi_d"]) == (-10.0, 17.0, "작년 말 종가", "2026-03-02"), r
        r = calc(pd.DataFrame({"Open": [150, 140], "High": [212, 150], "Close": [160, 139.94]}, index=pd.to_datetime(["2026-06-12", "2026-11-12"])))
        assert (r["ytd"], r["base_n"], r["dd"]) == (-6.7, "26/06/12 상장 첫날 시가", -34.0), r  # 올해 상장 = 첫날 시가 대비
        c = pd.Series([44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28])
        assert abs(rsi(c) - 70.5) < 0.1, rsi(c)  # 와일더 예제 (StockCharts) 첫 RSI 70.53 — 그 표는 중간 평균을 반올림해서 0.07 차이
        assert rsi(pd.Series(range(30), dtype=float)) == 100.0
        r = calc(pd.DataFrame({"Open": [1] * 3, "High": [1] * 3, "Close": [100, 90, 99]}, index=pd.to_datetime(["2026-11-13", "2026-11-16", "2026-11-20"])))
        assert r["wk"] == -1.0, r  # 금요일 11/20 종가 ÷ 지난주 금요일 11/13 종가
        print("ok")
    else:
        collect()
