"""📈 keychart.yaml 의 kind: mcap 그림 채우기 — 시가총액 주봉 = 네이버 수정주가 × 그때 주식 수 (사용자 11/10 파마리서치 '시가총액 추이 + 사건').
주식 수 = 종목 json shq (분기 말 주식 수, 그 주보다 앞선 가장 가까운 분기 · 없으면 가장 이른 분기) → 없으면 지금 시총 ÷ 지금 주가.
실패하면 그 그림만 비워 둠 (화면은 '데이터 없음' 대신 그림을 안 그림)."""
import json

import pandas as pd

from common import DATA


def series(close, shares_q, now_shares):
    """주봉 종가 Series × 주식 수 → (날짜 목록, 십억원 목록)."""
    sq = sorted((pd.Timestamp(k), v) for k, v in (shares_q or {}).items() if v)
    out_d, out_v = [], []
    for d, px in close.items():
        sh = next((v for k, v in reversed(sq) if k <= d), sq[0][1] if sq else now_shares)
        if sh and px == px:
            out_d.append(d.strftime("%Y-%m-%d"))
            out_v.append(round(px * sh / 1e9))
    return out_d, out_v


def ccsi(ch):
    """🛍 kind: ccsi — 한국은행 ECOS 소비자심리지수 (511Y002 · FME 소비자심리지수 · 99988 전체, 월) 로 q·v 이어 붙임 (YAML 시작값 위에 덮어씀).
    키는 GitHub Secrets 에만 → 이 컴퓨터에선 건너뜀 · 실패해도 시작값 그대로."""
    import os

    from common import HTTP, now_kst
    key = os.environ.get("ECOS_KEY")
    if not key:
        return
    try:
        rows = HTTP.get(f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/1000/511Y002/M/200807/{now_kst():%Y%m}/FME/99988", timeout=20).json() \
            .get("StatisticSearch", {}).get("row") or []
        got = {f"{r['TIME'][:4]}-{r['TIME'][4:6]}-01": float(r["DATA_VALUE"]) for r in rows}
        if len(got) < 12:
            raise RuntimeError(f"ECOS 줄 {len(got)}개")
        m = {**dict(zip(ch.get("q") or [], ch.get("v") or [])), **got}
        ch["q"], ch["v"] = sorted(m), [m[x] for x in sorted(m)]
        ch["src_auto"] = f"ECOS {max(got)[:7]}"
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ 소비자심리지수 ECOS: {type(e).__name__}: {str(e)[-80:]}")


def fill(k):
    from kr_stock import naver_now, price_history
    for grp in [*(k.get("industry") or {}).values(), *(k.get("stock") or {}).values()]:
        for card in grp.get("cards") or []:
            for ch in card.get("charts") or []:
                if ch.get("kind") == "ccsi":
                    ccsi(ch)
                if ch.get("kind") != "mcap":
                    continue
                code = str(ch["code"])
                try:
                    px = price_history(code, start=str(ch.get("from", "2020-01-01")).replace("-", ""))
                    wk = px.resample("W-FRI").last().dropna()
                    wk.index = list(wk.index[:-1]) + [px.index[-1]]  # 이번 주는 마지막 거래일 날짜로
                    p = DATA / "stocks" / f"{code}.json"
                    shq = (json.loads(p.read_text(encoding="utf-8")).get("shq") or {}).get("q") if p.exists() else None
                    now = naver_now(code) if not shq else {}
                    ch["q"], ch["v"] = series(wk, shq, (now.get("market_cap") or 0) / now["price"] if now.get("price") else None)
                except Exception as e:  # noqa: BLE001
                    print(f"  ⚠ 시가총액 그림 {code}: {type(e).__name__}: {e}")
    return k


if __name__ == "__main__":
    c = pd.Series([100.0, 110.0, 120.0], index=pd.to_datetime(["2024-01-05", "2024-06-07", "2024-12-06"]))
    assert series(c, {"2024-03-31": 10e6, "2024-09-30": 12e6}, None) == (["2024-01-05", "2024-06-07", "2024-12-06"], [1, 1, 1]), "십억 반올림"
    d, v = series(c * 1e4, {"2024-03-31": 10e6, "2024-09-30": 12e6}, None)
    assert v == [10000, 11000, 14400], v  # 1월은 가장 이른 분기 주식 수, 6월 = 3월 말, 12월 = 9월 말
    assert series(c * 1e4, None, 5e6)[1] == [5000, 5500, 6000]
    print("ok")
