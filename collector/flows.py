"""누가 어느 가격대에서 샀나: KRX 투자자별 거래실적(개인·외국인·기관 순매수 거래대금, 일별) × 그날 종가.
KRX 로그인(GitHub Secrets 의 KRX_ID·KRX_PW)이 있어야 받아져요. 내 컴퓨터에서는 로그인이 없어 비어 있어요."""
import pandas as pd

from common import now_kst, rnd

GROUPS = {"외국인": "외국인합계", "기관": "기관합계", "개인": "개인"}
ZONES = 8


def zones(net, close, n=ZONES):
    """net: 날짜별 순매수 거래대금(원, GROUPS 의 열), close: 날짜별 종가 → 가격대별 순매수 합계(억원)와 그룹 요약."""
    df = net.join(close.rename("px"), how="inner").dropna(subset=["px"])
    lo, hi = float(df["px"].min()), float(df["px"].max())
    step = (hi - lo) / n or 1.0
    df["z"] = ((df["px"] - lo) // step).clip(upper=n - 1).astype(int)
    zs = []
    for i in range(n):
        part = df[df["z"] == i]
        zs.append({"lo": round(lo + step * i), "hi": round(lo + step * (i + 1)), "days": len(part),
                   **{g: rnd(part[c].sum() / 1e8, 0) for g, c in GROUPS.items()}})
    groups = {}
    for g, c in GROUPS.items():
        buy = df[df[c] > 0]
        shares = (buy[c] / buy["px"]).sum()  # 순매수한 날의 주식 수 ≈ 거래대금 ÷ 종가
        top = max(range(n), key=lambda i: zs[i][g])
        groups[g] = {"sum": rnd(df[c].sum() / 1e8, 0), "m1": rnd(df[c].tail(20).sum() / 1e8, 0),
                     "avg_buy": round(buy[c].sum() / shares) if shares else None,
                     "top": top if zs[top][g] > 0 else None}
    return {"zones": zs, "groups": groups}


def collect(code, close):
    from pykrx import stock
    end = now_kst()
    start = end - pd.DateOffset(years=1)
    df = stock.get_market_trading_value_by_date(start.strftime("%Y%m%d"), end.strftime("%Y%m%d"), code)
    if df is None or df.empty:  # pykrx 는 실패해도 오류 대신 빈 표를 줘요
        raise RuntimeError("KRX 응답 없음 (로그인 계정이 없거나 접속 실패)")
    df.index = pd.to_datetime(df.index)
    close = close[close.index >= df.index[0]]
    return {"from": df.index[0].strftime("%Y-%m-%d"), "to": df.index[-1].strftime("%Y-%m-%d"),
            "src": "KRX 투자자별 거래실적 (순매수 거래대금, 일별)", **zones(df[list(GROUPS.values())], close)}


if __name__ == "__main__":  # 자체 점검: 싼 구간에서 외국인, 비싼 구간에서 개인이 산 가짜 자료
    ix = pd.date_range("2026-01-01", periods=40, freq="D")
    px = pd.Series([100.0 + i * 5 for i in range(40)], index=ix)
    net = pd.DataFrame({"외국인합계": [1e10 if i < 10 else -2e9 for i in range(40)],
                        "기관합계": [0.0] * 40,
                        "개인": [-1e10 if i < 10 else 1e8 * i for i in range(40)]}, index=ix)
    o = zones(net, px)
    g = o["groups"]
    assert g["외국인"]["top"] == 0 and g["개인"]["top"] == 7, g
    assert g["기관"]["top"] is None and g["기관"]["avg_buy"] is None
    assert 100 <= g["외국인"]["avg_buy"] <= 145, g["외국인"]  # 처음 10일(100~145원)에만 순매수
    assert g["외국인"]["sum"] == 400 and g["외국인"]["m1"] == -400, g["외국인"]  # 1000억 − 600억, 최근 20일 −400억
    assert sum(z["days"] for z in o["zones"]) == 40 and o["zones"][-1]["hi"] == 295
    print("ok", g)
