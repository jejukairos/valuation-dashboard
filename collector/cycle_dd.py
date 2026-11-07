"""📉 고점 대비 낙폭: 지금 vs 과거 큰 하락 사이클 (사용자 11/7, 삼성전자 그림처럼 — SK하이닉스도) → site/data/cycle_dd.json
네이버 일봉 수정주가(1999-11~, board.kr_ohlcv) · 고점 = 앞 1년 중 가장 높은 종가이면서 그 뒤 30개월 안에 33% 넘게 빠진 자리.
지금 사이클 = 아직 고점을 되찾지 못한 가장 최근 1년 고점 (15% 넘게 빠져 있을 때). 고점 뒤 30개월까지, 주 1점(5거래일)으로.
  python collector/cycle_dd.py"""
from board import kr_ohlcv
from common import DATA, REPORT, now_kst, write_json

STOCKS = {"005930": "삼성전자", "000660": "SK하이닉스"}
# 고점 해 → 이름 (그림 범례) — 새 사이클이 생기면 한 줄 추가, 없으면 '하락 사이클'
LABEL = {"005930": {2000: "닷컴·IT 붕괴", 2002: "IT 버블 뒤", 2004: "메모리 둔화", 2007: "금융위기", 2008: "금융위기", 2011: "유럽 재정위기",
                    2017: "메모리 사이클", 2018: "메모리 사이클", 2020: "코로나", 2021: "메모리 사이클", 2024: "HBM 지연", 2026: "AI 메모리"},
         "000660": {2000: "닷컴·IT 붕괴", 2004: "메모리 둔화", 2006: "메모리 둔화→금융위기", 2007: "금융위기", 2008: "금융위기", 2010: "메모리 둔화", 2011: "유럽 재정위기",
                    2014: "메모리 둔화", 2015: "메모리 둔화", 2017: "메모리 사이클", 2018: "메모리 사이클", 2020: "코로나", 2021: "메모리 사이클", 2024: "HBM 고점 논란", 2026: "AI 메모리"}}
THR, YEAR, MONTHS, KEEP = 0.33, 250, 30, 8  # 33% 넘게 빠진 사이클 · 앞 1년 고점 · 고점 뒤 30개월 · 지난 사이클 최근 8개


def cycles(dates, c, start=0):
    """[(고점 i, 끝 i, 바닥 i, 되찾음 여부)] — 고점을 되찾으면(종가 ≥ 고점) 그 사이클 끝. 바닥은 고점 뒤 30개월 안에서 잼 (그림에 보이는 만큼).
    다음 고점은 바닥 다음 날부터 다시 찾음 → 큰 사이클 안의 작은 사이클(삼성전자 21년 고점 안의 24년 7월)도 잡힘."""
    out, i, N, W = [], start, len(c), int(MONTHS * 21)
    while i < N:
        if c[i] < max(c[max(0, i - YEAR):i + 1]):  # 앞 1년 최고 종가가 아니면 고점 후보 아님
            i += 1
            continue
        j, lo = i + 1, i
        while j < N and c[j] < c[i]:
            if j - i <= W and c[j] < c[lo]:
                lo = j
            j += 1
        if c[lo] / c[i] - 1 <= -THR or (j >= N and c[lo] / c[i] - 1 <= -0.15):
            out.append((i, min(j, N - 1), lo, j < N))
            i = lo + 1  # 바닥 다음부터 다시
        else:
            i += 1
    return out


def one(code):
    df = kr_ohlcv(code, years=28)
    ds, c = [d.strftime("%Y-%m-%d") for d in df.index], [float(x) for x in df["Close"]]
    eps = []
    s0 = next(k for k, d in enumerate(ds) if d >= "2000-01-01")  # 1999년(하이닉스 구조조정 전 가격)은 빼고
    for p, e, lo, rec in cycles(ds, c, s0):
        end = min(len(c) - 1, p + int(MONTHS * 21))
        pts = [[round(k / 21, 2), round((c[p + k] / c[p] - 1) * 100, 1)] for k in range(0, end - p + 1, 5)]
        if pts[-1][0] != round((end - p) / 21, 2):
            pts.append([round((end - p) / 21, 2), round((c[end] / c[p] - 1) * 100, 1)])
        y = int(ds[p][:4])
        eps.append({"peak_d": ds[p], "peak": c[p], "trough_d": ds[lo], "trough": round((c[lo] / c[p] - 1) * 100, 1), "trough_m": round((lo - p) / 21, 1),
                    "back_m": round((e - p) / 21, 1) if rec else None, "label": LABEL.get(code, {}).get(y, "하락 사이클"), "pts": pts, "now": not rec})
    cur = [x for x in eps if x["now"]][-1:]
    past = [x for x in eps if not x["now"]][-KEEP:]
    last = {"d": ds[-1], "px": c[-1]}
    if cur:
        last["dd"] = round((c[-1] / cur[0]["peak"] - 1) * 100, 1)
        last["m"] = cur[0]["pts"][-1][0]
    return {"name": STOCKS[code], "last": last, "cycles": past + cur}


def collect():
    out = {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "src": "네이버 차트 일봉 수정주가 (1999-11~)", "stocks": {}}
    for code in STOCKS:
        try:
            out["stocks"][code] = one(code)
        except Exception as e:  # noqa: BLE001
            REPORT.block("📉 고점 대비 낙폭 사이클", f"{STOCKS[code]}: {str(e)[:60]}")
    write_json(DATA / "cycle_dd.json", out)
    return out


if __name__ == "__main__":
    # 규칙 점검: 100 → 60 (-40%) → 110 되찾음 = 사이클 1개 · 110 → 95 (-14%) 는 아님
    c = [50.0] * 260 + [100, 90, 70, 60, 80, 110, 120, 103, 115, 125]
    r = cycles(None, c)
    assert len(r) == 1 and r[0][0] == 260 and r[0][2] == 263 and r[0][3], r
    o = collect()
    for k, v in o["stocks"].items():
        print(v["name"], v["last"], [(x["peak_d"], x["trough"], x["trough_m"], x["label"], x["now"]) for x in v["cycles"]])
