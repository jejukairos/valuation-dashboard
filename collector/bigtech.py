"""📡 신호 탭 🇺🇸 미국: 빅테크 8곳 '고점 대비 하락률' · '올해 수익률' (사용자 11/13 그림 2장을 본떠 매일) → site/data/bigtech.json.
고점 = 상장 뒤 장중 최고가 · 올해 = 작년 마지막 거래일 종가 대비 (올해 상장했으면 첫날 시가 대비) · 야후 일봉 (분할만 반영)
— 2026-11-12 종가로 계산하니 전달받은 그림 숫자 16개가 모두 같았음.   python collector/bigtech.py [--test]"""
import sys

from common import DATA, REPORT, now_kst, write_json

# 그림 순서·이름 그대로 (마소 = 마이크로소프트) — 화면에서 값 순서로 다시 정렬
T = [("AAPL", "애플"), ("MSFT", "마소"), ("AMZN", "아마존"), ("TSLA", "테슬라"), ("META", "메타"), ("GOOGL", "알파벳"), ("NVDA", "엔비디아"), ("SPCX", "스페이스X")]


def calc(df):
    """일봉(마지막 줄 = 가장 최근 거래일) → 종가·장중 최고가·고점 대비 %·올해 기준 가격·올해 %."""
    last = df.index[-1]
    prev = df[df.index.year < last.year]
    base, bn = (float(prev["Close"].iloc[-1]), "작년 말 종가") if len(prev) else (float(df["Open"].iloc[0]), f"{df.index[0]:%y/%m/%d} 상장 첫날 시가")
    c, hi = float(df["Close"].iloc[-1]), float(df["High"].max())
    return {"date": f"{last:%Y-%m-%d}", "close": round(c, 2), "hi": round(hi, 2), "hi_d": f"{df['High'].idxmax():%Y-%m-%d}",
            "dd": round((c / hi - 1) * 100, 1), "base": round(base, 2), "base_n": bn, "ytd": round((c / base - 1) * 100, 1)}


def collect():
    from board import us_ohlcv
    px, rows = us_ohlcv([t for t, _ in T], period="max", adj=False), []
    for t, nm in T:
        df = px.get(t)
        if df is None or len(df) < 2:
            REPORT.block("🇺🇸 빅테크 고점 대비·올해 수익률", f"{nm}({t}) 야후 가격 없음")
            continue
        p = calc(df.iloc[:-1])  # 전 거래일 → 화면 '어제보다'
        rows.append({"t": t, "n": nm, **calc(df), "dd_prev": p["dd"], "ytd_prev": p["ytd"]})
    if not rows:
        raise RuntimeError("야후 가격을 하나도 못 받음")
    write_json(DATA / "bigtech.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "rows": rows})
    print(f"🇺🇸 빅테크 {len(rows)}/{len(T)}곳 · {rows[0]['date']} 종가")


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        import pandas as pd
        ix = pd.to_datetime(["2025-12-30", "2025-12-31", "2026-03-02", "2026-11-12"])
        r = calc(pd.DataFrame({"Open": [90, 95, 120, 110], "High": [100, 99, 130, 112], "Close": [95, 100, 125, 117]}, index=ix))
        assert (r["dd"], r["ytd"], r["base_n"], r["hi_d"]) == (-10.0, 17.0, "작년 말 종가", "2026-03-02"), r
        r = calc(pd.DataFrame({"Open": [150, 140], "High": [212, 150], "Close": [160, 139.94]}, index=pd.to_datetime(["2026-06-12", "2026-11-12"])))
        assert (r["ytd"], r["base_n"], r["dd"]) == (-6.7, "26/06/12 상장 첫날 시가", -34.0), r  # 올해 상장 = 첫날 시가 대비
        print("ok")
    else:
        collect()
