"""📊 섹터별 대표 ETF (📡 신호 탭 🇰🇷 맨 위, 사용자 11/13 블로그 '요약하는 고잉' 23개 목록 그대로) → site/data/sector_etf.json.
현재가·등락률·시가총액(억원) = 네이버 ETF 목록 한 번 · 일봉(시가·고가·저가·전일 종가) = 네이버 차트 데이터 (board.kr_ohlcv).
  python collector/sector_etf.py [--test]"""
import sys

from common import DATA, REPORT, now_kst, write_json

# (코드, 이름) — 블로그 순서 그대로. 바꾸려면 여기만 (코드는 네이버 ETF 목록에서 이름이 정확히 같은 것, 11/13 확인)
ETF = [("069500", "KODEX 200"), ("229200", "KODEX 코스닥150"), ("396500", "TIGER 반도체TOP10"), ("455850", "SOL AI반도체소부장"),
       ("462900", "KoAct 바이오헬스케어액티브"), ("305720", "KODEX 2차전지산업"), ("091180", "KODEX 자동차"), ("487240", "KODEX AI전력핵심설비"),
       ("0091P0", "TIGER 코리아원자력"), ("0148J0", "TIGER 코리아휴머노이드로봇산업"), ("228790", "TIGER 화장품"), ("466920", "SOL 조선TOP3플러스"),
       ("449450", "PLUS K방산"), ("421320", "PLUS 우주항공"), ("457990", "PLUS 태양광&ESS"), ("385510", "KODEX 신재생에너지액티브"),
       ("228800", "TIGER 여행레저"), ("475050", "ACE KPOP포커스"), ("157490", "TIGER 소프트웨어"), ("0219B0", "KoAct 광통신&위성네트워크액티브"),
       ("117700", "KODEX 건설"), ("466940", "TIGER 은행고배당플러스TOP10"), ("102970", "KODEX 증권")]


def row(code, name, df, cap=None):
    """일봉 마지막 두 줄 → 화면 한 줄 (등락률 = 전일 종가 대비)."""
    t, y = df.iloc[-1], df.iloc[-2]
    return {"c": code, "n": name, "d": f"{df.index[-1]:%Y-%m-%d}", "p": float(t["Close"]), "o": float(t["Open"]), "h": float(t["High"]),
            "l": float(t["Low"]), "pc": float(y["Close"]), "r": round((t["Close"] / y["Close"] - 1) * 100, 2), "cap": cap}


def collect():
    from board import HTTP, kr_ohlcv
    caps = {}
    try:  # 시가총액(억원)은 네이버 ETF 목록에만 있음 — 못 받아도 가격·일봉은 그대로
        j = HTTP.get("https://finance.naver.com/api/sise/etfItemList.nhn", params={"etfType": 0}, timeout=20,
                     headers={"Referer": "https://finance.naver.com/sise/etf.naver"}).json()
        caps = {x["itemcode"]: x.get("marketSum") for x in j["result"]["etfItemList"]}
    except Exception as e:  # noqa: BLE001
        REPORT.block("📊 섹터별 대표 ETF 시가총액", str(e)[:60])
    rows = []
    for code, name in ETF:
        try:
            df = kr_ohlcv(code, years=0.05)  # 약 4주 — 마지막 두 거래일만 씀
            if len(df) < 2:
                raise RuntimeError("일봉 2개 미만")
            rows.append(row(code, name, df, caps.get(code)))
        except Exception as e:  # noqa: BLE001 - 한 ETF 가 안 돼도 나머지는
            REPORT.block("📊 섹터별 대표 ETF", f"{name}: {str(e)[:50]}")
    if not rows:
        raise RuntimeError("ETF 가격을 하나도 못 받음")
    write_json(DATA / "sector_etf.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "rows": rows})
    print(f"📊 섹터별 대표 ETF {len(rows)}/{len(ETF)}개 · {rows[0]['d']}")


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        import pandas as pd
        df = pd.DataFrame({"Open": [100, 101], "High": [102, 106], "Low": [99, 100], "Close": [100, 104.5]}, index=pd.to_datetime(["2026-11-12", "2026-11-13"]))
        r = row("069500", "KODEX 200", df, 217159)
        assert (r["r"], r["pc"], r["o"], r["d"], r["cap"]) == (4.5, 100.0, 101.0, "2026-11-13", 217159), r
        assert len({c for c, _ in ETF}) == len(ETF) == 23
        print("ok")
    else:
        collect()
