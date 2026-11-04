"""🏭 산업 탭 '🗺 시장 그룹판'·'🔭 차트 스캔' — 밤·장 마감 뒤 따로 도는 수집 (.github/workflows/scan.yml → site/data/board.json·scan.json)
시장 그룹판: 한국 = 코스피·코스닥 + KRX 업종지수(구성종목 시총 가중)를 따라가는 업종 ETF, 미국 = 지수·섹터·산업 ETF
  카드마다 2년 주봉 종가 + 30주선, 일(50일선)·주(30주선)·월(10개월선) 추세 칩, 1개월 수익률·3개월 상대수익률(지수 대비)·52주 고점 대비
차트 스캔: 한국 시가총액 상위 300 (KRX, pykrx) + 미국 S&P500 (위키백과 목록) 을 매일 훑어
  일봉 '거래량 터진 갭 상승' · 주봉 '바닥 탈출 · 30주선과 12주 고점 돌파' · 월봉 '바닥 탈출 · 10개월선 돌파' 에 걸린 종목 카드 (RS 점수 = 지수 대비 1년 강도 순위)"""
import io
import re
import sys
from datetime import timedelta

import numpy as np
import pandas as pd

from common import DATA, HTTP, load_yaml, now_kst, read_json, write_json

KR_BOARD = [("KOSPI", "코스피", "^KS11"), ("KOSDAQ", "코스닥", "^KQ11"),
            ("091160", "반도체", None), ("266370", "IT", None), ("305720", "2차전지", None), ("091180", "자동차", None),
            ("494670", "조선", None), ("449450", "방산", None), ("102960", "기계장비", None), ("434730", "원자력", None),
            ("117700", "건설", None), ("117460", "에너지화학", None), ("117680", "철강", None), ("266420", "헬스케어", None),
            ("228790", "화장품", None), ("266410", "필수소비재", None), ("266390", "경기소비재", None), ("266360", "K-콘텐츠", None),
            ("157490", "소프트웨어", None), ("091170", "은행", None), ("102970", "증권", None), ("140700", "보험", None), ("140710", "운송", None)]
US_BOARD = [("SPY", "S&P 500"), ("QQQ", "나스닥100"), ("IWM", "러셀2000"), ("RSP", "S&P 500 동일가중"),
            ("IGV", "소프트웨어"), ("ARKK", "혁신성장(투기 성향)"), ("XLE", "에너지"), ("XOP", "석유·가스 개발"), ("XLV", "헬스케어"),
            ("GDX", "금광"), ("XLK", "기술"), ("SMH", "반도체"), ("XBI", "바이오"), ("XLY", "경기소비재"), ("XLP", "필수소비재"),
            ("XLB", "소재"), ("XLF", "금융"), ("XLC", "커뮤니케이션"), ("XRT", "소매"), ("IYT", "운송"), ("XLI", "산업재"),
            ("XLU", "유틸리티"), ("ITA", "항공우주·방산"), ("URA", "우라늄·원자력"),
            # 사용자 전달 '주요 ETF Weekly'·'많이 오른/빠진 ETF 10' (2026-10-31) 에 있던 것
            ("ARKG", "혁신 바이오(유전체)"), ("OIH", "오일서비스"), ("SLV", "은"), ("GLD", "금"), ("CIBR", "사이버보안"),
            ("MAGS", "빅테크 7"), ("ARKF", "블록체인·핀테크"), ("LYTE", "포토닉스·광학"), ("SOXX", "반도체 30종목"),
            ("NCLD", "AI 클라우드 인프라"), ("DRAM", "메모리 반도체"), ("ETHA", "이더리움 현물"), ("IBIT", "비트코인 현물"),
            ("EWY", "한국 (MSCI)"), ("HUMN", "휴머노이드 로봇"), ("MOO", "농업·애그리비즈니스"), ("USO", "원유"),
            ("SCHD", "미국 배당주"), ("ILF", "중남미"), ("VNQ", "미국 리츠·부동산")]
US_IDX = {"SPY", "QQQ", "IWM", "RSP"}
# 🤖 주요 AI 인프라 상승추세 판단 (사용자 전달 그림 2026-10-31): 200일선 위 = 초록, 아래로 내려오면 = 주황
AI_INFRA = [("SNDK", "샌디스크", "메모리"), ("INTC", "인텔", "CPU"), ("GLW", "코닝", "광통신"), ("NBIS", "네비우스", "데이터센터"),
            ("BE", "블룸에너지", "전력"), ("DELL", "델", "서버")]
SECTOR_KO = {"Information Technology": "정보기술", "Health Care": "헬스케어", "Financials": "금융", "Consumer Discretionary": "경기소비재",
             "Communication Services": "커뮤니케이션", "Industrials": "산업재", "Consumer Staples": "필수소비재", "Energy": "에너지",
             "Utilities": "유틸리티", "Real Estate": "부동산", "Materials": "소재"}
r_ = lambda v, d=2: None if v is None or v != v else round(float(v), d)


# ---------- 가격 ----------
def kr_ohlcv(code, years=10):
    """네이버 차트 데이터 일봉 시가·고가·저가·종가·거래량 (수정주가)."""
    end, start = now_kst(), now_kst() - timedelta(days=365 * years + 10)
    txt = HTTP.get(f"https://api.finance.naver.com/siseJson.naver?symbol={code}&requestType=1"
                   f"&startTime={start:%Y%m%d}&endTime={end:%Y%m%d}&timeframe=day").text
    rows = re.findall(r'\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)', txt)
    if not rows:
        raise RuntimeError(f"{code} 가격 없음")
    df = pd.DataFrame([[float(x) for x in r[1:]] for r in rows], index=pd.to_datetime([r[0] for r in rows]),
                      columns=["Open", "High", "Low", "Close", "Volume"])
    return df[df["Close"] > 0]


def us_ohlcv(tickers, period="10y", adj=True):
    """야후 일봉 (adj=True 배당·분할 반영 수정주가, False = 분할만 반영 — 증권사 차트와 같은 숫자) — 100개씩 나눠 받음."""
    import yfinance as yf
    out = {}
    for i in range(0, len(tickers), 100):
        part = tickers[i:i + 100]
        df = yf.download(part, period=period, interval="1d", auto_adjust=adj, group_by="ticker", threads=True, progress=False)
        for t in part:
            try:
                d = (df[t] if len(part) > 1 else df).dropna(subset=["Close"])
                if len(d) > 60:
                    d.index = d.index.tz_localize(None) if d.index.tz else d.index
                    out[t] = d[["Open", "High", "Low", "Close", "Volume"]]
            except KeyError:
                pass
    return out


def resample(df, rule):
    """일봉 → 주봉(W-FRI)·월봉(ME). 마지막 봉은 진행 중."""
    g = df.resample(rule)
    o = pd.DataFrame({"Open": g["Open"].first(), "High": g["High"].max(), "Low": g["Low"].min(), "Close": g["Close"].last(), "Volume": g["Volume"].sum()})
    return o.dropna(subset=["Close"])


# ---------- 추세 칩 · 그룹판 카드 ----------
def _state(close, n, slope):
    """이평선 위·상승 = up, 아래·하락 = down, 엇갈림 = mix (마지막 봉 기준)."""
    ma = close.rolling(n).mean()
    if len(ma.dropna()) < slope + 1:
        return None, None
    a = close.iloc[-1] > ma.iloc[-1]
    rising = ma.iloc[-1] > ma.iloc[-1 - slope]
    return ("up" if a and rising else "down" if not a and not rising else "mix"), bool(a)


def chip(df, rule, n, slope):
    """일(50일선)·주(30주선)·월(10개월선) 칩. ch = 오늘 종가 때문에 상태가 바뀜 (어제 종가까지로 계산한 상태와 다름 — '오늘 바뀜')."""
    pick = (lambda d: d["Close"]) if rule is None else (lambda d: resample(d, rule)["Close"])
    s0, a = _state(pick(df), n, slope)
    s1, _ = _state(pick(df.iloc[:-1]), n, slope)
    return {"s": s0, "ch": s1 is not None and s0 != s1, "a": a} if s0 else None


def chip_close(close, n, slope):  # 자체 점검용 (종가만)
    return chip(pd.DataFrame({"Open": close, "High": close, "Low": close, "Close": close, "Volume": 0}), None, n, slope)


def board_card(sym, name, df, bench=None, idx=False, n_const=None):
    c = df["Close"]
    wk = resample(df, "W-FRI")["Close"]
    ma30 = wk.rolling(30).mean()
    w2 = wk.iloc[-104:]
    ret = lambda s, k: (s.iloc[-1] / s.iloc[-1 - k] - 1) * 100 if len(s) > k else None
    hi52 = df["High"].iloc[-252:].max() if "High" in df else c.iloc[-252:].max()
    y0 = c[c.index.year < c.index[-1].year]  # 작년 마지막 종가 → 올해 수익률 (올해 상장이면 없음)
    out = {"sym": sym, "name": name, "idx": idx, "n": n_const, "r1w": r_(ret(c, 5), 1), "ytd": r_((c.iloc[-1] / y0.iloc[-1] - 1) * 100, 1) if len(y0) else None,
           "w": [r_(v, 4) for v in w2], "ma": [r_(v, 4) for v in ma30.loc[w2.index]], "d0": w2.index[0].strftime("%Y-%m"),
           "dates": [d.strftime("%y.%m") for d in w2.index], "chg_d": r_(ret(c, 1), 1), "chg_2y": r_((w2.iloc[-1] / w2.iloc[0] - 1) * 100, 0),
           "peak_2y": r_((w2.max() / w2.iloc[0] - 1) * 100, 0), "r1m": r_(ret(c, 21), 0), "dd52": r_((c.iloc[-1] / hi52 - 1) * 100, 0),
           "chips": {"d": chip(df, None, 50, 5), "w": chip(df, "W-FRI", 30, 1), "m": chip(df, "ME", 10, 1)}}
    if bench is not None and len(bench) > 64 and len(c) > 64:
        out["rel3m"] = r_(ret(c, 63) - (bench.iloc[-1] / bench.iloc[-64] - 1) * 100, 0)
    return out


def board():
    import yfinance as yf
    kr, us = [], []
    ks = yf.Ticker("^KS11").history(period="3y")["Close"]
    ks.index = ks.index.tz_localize(None)
    for code, name, yt in KR_BOARD:
        try:
            if yt:
                h = yf.Ticker(yt).history(period="3y")
                h.index = h.index.tz_localize(None)
                df = h[["Open", "High", "Low", "Close", "Volume"]]
            else:
                df = kr_ohlcv(code, 3)
            kr.append(board_card(code, name, df, ks, idx=bool(yt)))
        except Exception as e:  # noqa: BLE001
            print("  그룹판 실패", name, str(e)[:60])
    px = us_ohlcv([t for t, _ in US_BOARD], period="3y")
    spy = px.get("SPY", pd.DataFrame()).get("Close")
    for t, name in US_BOARD:
        if t in px:
            us.append(board_card(t, name, px[t], spy, idx=t in US_IDX))
    key = lambda c: (not c["idx"], -(c.get("rel3m") if c.get("rel3m") is not None else -999))
    pa = us_ohlcv([t for t, _, _ in AI_INFRA], period="3y")
    ai = [ma200_card(t, name, what, pa[t]["Close"]) for t, name, what in AI_INFRA if t in pa]
    try:  # 실패해도 그룹판은 저장
        dr = draw()
    except Exception as e:  # noqa: BLE001
        print("  선 그은 차트 실패", str(e)[:80])
        dr = []
    return {"kr": sorted(kr, key=key), "us": sorted(us, key=key), "ai": [c for c in ai if c], "draw": dr}


# ---------- ✏️ 선 그은 차트: 컵위드핸들 · 200일선 · 채널(지지선·저항선) — 사용자 전달 그림(2026-11-03)처럼, 매번 새 가격으로 다시 계산 ----------
# (티커, 이름, 봉: d 일봉 200개 / w 주봉 104개, 전달받은 글·그림 메모) — 그림을 또 받으면 여기에 한 줄 추가
DRAW = [("WMT", "월마트", "d", "11/3 전달 그림: 6~10월에 컵 모양을 그리고 위로 화살표"),
        ("COST", "코스트코", "d", "11/3 전달 그림: 6~10월에 컵 모양을 그리고 위로 화살표"),
        ("QQQ", "나스닥100 ETF", "d", "11/3 전달 그림: 200일선에 닿은 자리에 동그라미"),
        ("SOXX", "반도체 ETF (30종목)", "w", "11/3 전달 글: 반도체는 기술적으로 상승추세(채널)를 벗어나는 중 — 하락추세로 보고, "
                                         "벗어나기까지 시간이 꽤 걸리며 주도주에서 빠질 가능성이 높다는 개인 의견"),
        # 5번째 칸 = 옵션: ma 이평선 (한국식 5·20·60·120일) · kr 원화 아닌 지수 포인트 → 이평선 배열(역배열)·거래량 지지대·갭 상승도 계산
        ("^KS11", "코스피", "d", "11/4 전달 글(오크트리 블로그 '26.10월 코스피 기술적 분석'): 5·20·60·120일선이 모두 위에 있는 역배열 — "
                               "6개월(120일) 안에 산 사람이 모두 손실 중이라 반등 때마다 '본전' 매물이 나와 저항이 겹겹이, 이 약세 심리는 짧은 게 아니라 오래 쌓인 것. "
                               "바로 아래엔 2~4월 큰 거래량으로 만든 강한 지지대 — 버티면 안심이지만 깨지면 하락 힘이 셀 수 있어 민감하게 볼 구간. "
                               "저항은 갭 상승으로 뚫는 게 가장 좋다(본전 매물이 덜 나옴)는 개인 의견",
         {"ma": (5, 20, 60, 120), "kr": True})]


def cup_shape(c, k):
    """오닐 컵위드핸들 (종가, k = 1주의 봉 수: 일봉 5 · 주봉 1). 앞선 30주 안 25%+ 상승 → 왼쪽 입술 A → 12~40% 바닥 B
    → 오른쪽 입술 C (A 의 90~105%, A~C 7~65주) → 손잡이 (C 뒤 1~10주, 3~15% 눌림, 컵 위쪽 절반) → C 위 종가 = 돌파.
    단계 st: up 오른쪽 올라오는 중(깊이 절반 넘게 회복) · lip 오른쪽 입술(손잡이 전) · handle 손잡이 만드는 중 · out 돌파(2주 안)."""
    from patterns import _piv
    T = len(c) - 1
    piv = sorted(_piv(c, 2 * k), key=lambda i: -c[i])  # 높은 고점부터 = 진짜 왼쪽 입술
    for t in range(T, T - 2 * k - 1, -1):  # 돌파는 2주 전까지 '돌파'
        for a in piv:
            H = c[a]
            if not t - 65 * k <= a <= t - 7 * k or H < 1.25 * c[max(0, a - 30 * k):a + 1].min():
                continue
            b = a + 1 + int(c[a + 1:t + 1].argmin())
            depth = 1 - c[b] / H
            if not 0.12 <= depth <= 0.40 or t - b < k or c[a + 1:b].max(initial=0) > H:
                continue
            C = b + 1 + int(c[b + 1:t].argmax()) if t > b + 1 else t  # 오른쪽 입술 = 바닥 뒤 '어제까지' 가장 높은 종가
            R, h = c[C], c[C + 1:t]
            lip = 0.90 * H <= R <= 1.05 * H and 7 * k <= C - a <= 65 * k
            ok_h = lambda hh: k <= len(hh) <= 10 * k and 0.03 <= 1 - hh.min() / R <= 0.15 and hh.min() >= c[b] + (H - c[b]) / 2
            mid, st = c[b] + (H - c[b]) / 2, None
            if c[t] > R and lip and ok_h(h):
                st = "out"
            elif t == T and c[t] >= R:  # 오늘이 바닥 뒤 가장 높음 = 손잡이 없음
                st = "lip" if 0.90 * H <= c[t] <= 1.05 * H else "up" if mid <= c[t] < 0.90 * H else None
                C, R = t, c[t]
            elif t == T:
                if R < 0.90 * H:
                    st = "up" if c[t] >= mid else None
                elif lip:
                    hh = c[C + 1:t + 1]
                    st = "lip" if len(hh) < k else "handle" if ok_h(hh) else None
            if st is None or (t < T and not (st == "out" and c[T] > R)):
                continue
            return {"st": st, "a": a, "b": b, "c": C, "t": t, "H": H, "R": R, "depth": depth,
                    "pre": c[a] / c[max(0, a - 30 * k):a + 1].min() - 1, "wk": (C - a) // k, "dip": (1 - c[C:T + 1].min() / R) if C < T else 0.0}
    return None


def channel(h, l, c, k, span):
    """오르는 채널 (로그 가격): 최근 span 봉에서 13주 넘게 지난 가장 낮은 저가 A → 그 뒤(2주 전까지) 저가들 중 기울기가 가장 낮은 B
    = 한 번도 깨지지 않은 지지선 A-B. 저항선 = 같은 기울기로 A~B 사이 고가가 가장 높이 닿은 선. 지금 종가가 어디인지 (아래 = 이탈)."""
    T = len(c) - 1
    lo0, end = max(0, T + 1 - span), T - 13 * k
    if end <= lo0 + 4 * k:
        return None
    A = lo0 + int(l[lo0:end + 1].argmin())
    js = np.arange(A + 4 * k, T - 2 * k + 1)
    if not len(js):
        return None
    L, Hh = np.log(l), np.log(h)
    sl = (L[js] - L[A]) / (js - A)
    B, s = int(js[sl.argmin()]), float(sl.min())
    if s <= 0:
        return None  # 오르는 채널만 (내려가는 선은 📐 주봉 차트 모양에서)
    base = L[A] + s * (np.arange(T + 1) - A)
    off = float((Hh[A:B + 1] - base[A:B + 1]).max())
    if off <= 0:
        return None
    lc = np.log(c)
    st = "below" if lc[T] < base[T] else "above" if lc[T] > base[T] + off else "in"
    run = 0  # 지금 상태(아래·안·위)가 몇 봉째인지
    for i in range(T, B, -1):
        if ("below" if lc[i] < base[i] else "above" if lc[i] > base[i] + off else "in") != st:
            break
        run += 1
    return {"a": A, "b": B, "la": float(L[A]), "s": s, "off": off, "st": st, "run": run,
            "lo": float(np.exp(base[T])), "up": float(np.exp(base[T] + off)), "was_above": bool((lc[B:T + 1] > base[B:T + 1] + off).any())}


def ma_align(c, ns):
    """이평선 배열 (ns 짧은 것부터): 정배열 = 짧은 선이 위 (5 > 20 > 60 > 120) · 역배열 = 긴 선이 위 · 그 밖 = 섞임.
    그 상태가 며칠째(run)인지 + 종가가 모든 선 아래(below_all)인지 (사용자 전달 글 11/4: '모든 이평선을 위에 깔고 있는 역배열')."""
    m = pd.concat([c.rolling(n).mean() for n in ns], axis=1).dropna()
    if m.empty:
        return None
    st = ["정배열" if all(a > b for a, b in zip(r, r[1:])) else "역배열" if all(a < b for a, b in zip(r, r[1:])) else "섞임" for r in m.values]
    run = 1
    while run < len(st) and st[-1 - run] == st[-1]:
        run += 1
    last = m.iloc[-1]
    return {"st": st[-1], "run": run, "v": {str(n): r_(last.iloc[i], 2) for i, n in enumerate(ns)}, "below_all": bool(c.iloc[-1] < last.min())}


def vol_shelf(h, l, c, v, n=250, bins=40):
    """거래량 지지대: 최근 n 봉의 (고+저+종)/3 을 가격 칸 bins 개로 나눠 거래량을 더함 → 지금 종가 아래에서 거래량이 가장 많이 쌓인 칸.
    많이 사고판 가격일수록 지지가 강하다는 생각 (사용자 전달 글 11/4: '많은 거래량으로 이루어진 강한 지지대')."""
    h, l, c, v = h[-n:], l[-n:], c[-n:], np.nan_to_num(v[-n:])
    if v.sum() <= 0:
        return None
    edges = np.linspace(l.min(), h.max(), bins + 1)
    vol = np.bincount(np.clip(np.digitize((h + l + c) / 3, edges) - 1, 0, bins - 1), weights=v, minlength=bins)
    below = [i for i in range(bins) if edges[i + 1] <= c[-1]]
    if not below:
        return None
    i = max(below, key=lambda j: vol[j])
    return {"lo": r_(edges[i], 2), "hi": r_(edges[i + 1], 2), "share": r_(vol[i] / vol.sum() * 100, 1), "n": n}


def draw():
    """DRAW 종목마다 캔들 + 이평선 + 컵위드핸들·채널·200일선 계산 (배당 안 깎은 가격 = 증권사 차트와 같은 숫자)."""
    px = us_ohlcv([t for t, *_ in DRAW], period="3y", adj=False)  # 여러 티커라야 받힘 (한 개면 열 이름이 달라 빠짐)
    out = []
    for sym, name, tf, memo, *opt in DRAW:
        o = opt[0] if opt else {}
        d = px.get(sym)
        if d is None:
            continue
        c = d["Close"]
        m2 = ma200_card(sym, name, "", c)  # 200일선 위·아래, 며칠째, 이격
        b = d if tf == "d" else resample(d, "W-FRI")
        k, n = (5, 200) if tf == "d" else (1, 104)
        off = max(0, len(b) - n)
        ch = bars(b, o.get("ma") or ((20, 50, 200) if tf == "d" else (20, 50)))
        ch = {kk: (vv[off:] if isinstance(vv, list) else {m: s[off:] for m, s in vv.items()}) for kk, vv in ch.items()}
        C, Hi, Lo = (b[x].values.astype(float) for x in ("Close", "High", "Low"))
        cup, chn = cup_shape(C, k), channel(Hi, Lo, C, k, n)
        rel = lambda i: i - off
        if cup and cup["a"] >= off:
            sm = pd.Series(C).rolling(2 * k + 1, center=True, min_periods=1).mean().values  # 컵 모양 따라 그리는 굵은 선 (가운데 이동평균)
            cup = {**{x: r_(cup[x], 2) for x in ("H", "R")}, "st": cup["st"], "depth": r_(cup["depth"] * 100, 0), "pre": r_(cup["pre"] * 100, 0),
                   "wk": cup["wk"], "dip": r_(cup["dip"] * 100, 1), **{x: rel(cup[x]) for x in ("a", "b", "c", "t")},
                   "path": [r_(v, 2) for v in sm[cup["a"]:]]}
        else:
            cup = None
        if chn:
            chn = {**chn, "a": rel(chn["a"]), "b": rel(chn["b"]), "lo": r_(chn["lo"], 2), "up": r_(chn["up"], 2)}
        x = {"sym": sym, "name": name, "tf": tf, "memo": memo, "ch": ch, "cup": cup, "chn": chn,
             "ma200": {k_: m2[k_] for k_ in ("s", "days", "gap", "chg_d")} | {"v": m2["ma"][-1]} if m2 else None,
             "last": r_(c.iloc[-1], 2), "date": c.index[-1].strftime("%Y-%m-%d")}
        if o.get("ma"):  # 한국식 이평선 카드: 배열 · 거래량 지지대 · 최근 10봉 안 갭 상승 (오늘 저가 > 어제 고가)
            Op, V = b["Open"].values.astype(float), b["Volume"].values.astype(float)
            g = next((i for i in range(len(C) - 1, len(C) - 11, -1) if Lo[i] > Hi[i - 1]), None)
            x |= {"kr": bool(o.get("kr")), "align": ma_align(b["Close"], o["ma"]), "vs": vol_shelf(Hi, Lo, C, V),
                  "gap": {"i": rel(g), "pct": r_((Op[g] / C[g - 1] - 1) * 100, 1)} if g is not None else None}
        out.append(x)
    return out


def ma200_card(sym, name, what, c, n=205):
    """🤖 AI 인프라 카드: 최근 약 10개월 일봉 종가 + 200일선, 지금 200일선 위(up)·아래(down)와 그 상태가 며칠째인지(days)."""
    ma = c.rolling(200).mean()
    a = (c > ma)[ma.notna()].tolist()
    if not a:
        return None
    k = len(a) - 1
    while k > 0 and a[k - 1] == a[-1]:
        k -= 1
    w = c.index[-n:]
    return {"sym": sym, "name": name, "what": what, "s": "up" if a[-1] else "down", "days": len(a) - k,
            "gap": r_((c.iloc[-1] / ma.iloc[-1] - 1) * 100, 1), "chg_d": r_((c.iloc[-1] / c.iloc[-2] - 1) * 100, 1),
            "t": [d.strftime("%y.%m.%d") for d in w], "c": [r_(v) for v in c.loc[w]], "ma": [r_(v) for v in ma.loc[w]]}


# ---------- 차트 스캔 ----------
def kr_universe(n=300, min_cap=0):
    """KRX 시가총액 상위 n (min_cap 원 이상만, pykrx, 서버의 KRX 로그인 필요) → [(코드, 이름, 업종, 시총)]. 실패하면 보유·관심 한국 종목."""
    try:
        from pykrx import stock
        for back in range(8):
            d = (now_kst() - timedelta(days=back)).strftime("%Y%m%d")
            info = pd.concat([stock.get_market_sector_classifications(d, m) for m in ("KOSPI", "KOSDAQ")])
            if info is not None and len(info) > 1000:
                top = info[info["시가총액"] >= min_cap].sort_values("시가총액", ascending=False).head(n)
                return [(t, r["종목명"], r["업종명"], float(r["시가총액"])) for t, r in top.iterrows()]
    except Exception as e:  # noqa: BLE001
        print("  KRX 시총 순위 실패 → 보유·관심 종목만:", str(e)[:80])
    st = load_yaml("stocks.yaml") or {}
    return [(str(h["code"]), h["name"], h.get("industry", ""), None) for g in st.values() if isinstance(g, list)
            for h in g if isinstance(h, dict) and h.get("market") == "KR" and not h.get("data_code")]


def us_universe():
    """S&P500 구성종목 (위키백과 표) → [(티커, 이름, 섹터, 세부 업종)]."""
    t = HTTP.get("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies").text
    df = pd.read_html(io.StringIO(t))[0]
    return [(str(r["Symbol"]).replace(".", "-"), r["Security"], SECTOR_KO.get(r["GICS Sector"], r["GICS Sector"]), r["GICS Sub-Industry"])
            for _, r in df.iterrows()]


def rs_scores(px, bench):
    """RS 점수 1~99: 3개월 40% + 6·9·12개월 20%씩 가중한 수익률을 지수 대비로 줄 세운 순위 (IBD 방식과 비슷)."""
    raw = {}
    for k, d in px.items():
        c = d["Close"]
        if len(c) < 253:
            continue
        r = lambda n: c.iloc[-1] / c.iloc[-1 - n] - 1
        raw[k] = 0.4 * r(63) + 0.2 * r(126) + 0.2 * r(189) + 0.2 * r(252)
    s = pd.Series(raw)
    return (s.rank(pct=True) * 98 + 1).round().astype(int).to_dict() if len(s) else {}


def scan_one(d):
    """한 종목 일봉 → 걸린 조건 {gap, week, month} + 배지. 조건 숫자는 화면에 그대로 보여 줌."""
    if len(d) < 260:
        return {}
    c, o, h, l, v = d["Close"], d["Open"], d["High"], d["Low"], d["Volume"]
    out = {}
    av50 = v.iloc[-51:-1].mean()
    gap = o.iloc[-1] / c.iloc[-2] - 1
    rng = h.iloc[-1] - l.iloc[-1]
    if gap >= 0.03 and av50 > 0 and v.iloc[-1] >= 3 * av50 and rng > 0 and c.iloc[-1] >= l.iloc[-1] + 0.7 * rng and c.iloc[-1] > c.iloc[-2]:
        out["gap"] = {"gap": r_(gap * 100, 1), "chg": r_((c.iloc[-1] / c.iloc[-2] - 1) * 100, 1), "vol": r_(v.iloc[-1] / av50, 1), "prev": r_(c.iloc[-2], 2)}
    w = resample(d, "W-FRI")
    if len(w) > 45:
        wc, ma30 = w["Close"], w["Close"].rolling(30).mean()
        below = int((wc.iloc[-27:-1] < ma30.iloc[-27:-1]).sum())
        hi12 = w["High"].iloc[-13:-1].max()
        if wc.iloc[-1] > ma30.iloc[-1] and wc.iloc[-1] > hi12 and below >= 15:
            out["week"] = {"below": below, "ma30": r_(ma30.iloc[-1], 2), "hi12": r_(hi12, 2), "vol": r_(w["Volume"].iloc[-1] / w["Volume"].iloc[-11:-1].mean(), 1),
                           "dd2y": r_((wc.iloc[-1] / w["High"].iloc[-105:].max() - 1) * 100, 0)}
    m = resample(d, "ME")
    if len(m) > 24:
        mc, ma10 = m["Close"], m["Close"].rolling(10).mean()
        belowm = int((mc.iloc[-13:-1] < ma10.iloc[-13:-1]).sum())
        hi6 = m["High"].iloc[-7:-1].max()  # 바닥 탈출: 12개월 중 8개월 넘게 10개월선 아래 → 이번 달 10개월선과 6개월 고점을 함께 넘음
        if mc.iloc[-1] > ma10.iloc[-1] and mc.iloc[-2] <= ma10.iloc[-2] and belowm >= 8 and mc.iloc[-1] > hi6:
            out["month"] = {"below": belowm, "ma10": r_(ma10.iloc[-1], 2)}
    if out:
        ma200 = c.rolling(200).mean()
        out["badge"] = {"ma200_up": bool(c.iloc[-1] > ma200.iloc[-1] and (c.iloc[-11:-1] < ma200.iloc[-11:-1]).any()),
                        "hi26w": bool(c.iloc[-1] >= c.iloc[-126:].max()), "hi52w": bool(c.iloc[-1] >= c.iloc[-252:].max()),
                        "dd52": r_((c.iloc[-1] / h.iloc[-252:].max() - 1) * 100, 0)}
    return out


def bars(d, ma_n, rel=None):
    """화면 캔들용: [날짜, 시가, 고가, 저가, 종가, 거래량] + 이평선들 + RS 선 (지수 대비, 처음 = 1)."""
    out = {"t": [x.strftime("%y.%m.%d") for x in d.index], "o": [r_(x, 4) for x in d["Open"]], "h": [r_(x, 4) for x in d["High"]],
           "l": [r_(x, 4) for x in d["Low"]], "c": [r_(x, 4) for x in d["Close"]], "v": [int(x) for x in d["Volume"].fillna(0)]}
    out["ma"] = {str(n): [r_(x, 4) for x in d["Close"].rolling(n).mean()] for n in ma_n}
    if rel is not None:
        b = rel.reindex(d.index, method="ffill")
        rs = d["Close"] / b
        out["rs"] = [r_(x / rs.dropna().iloc[0], 3) if x == x else None for x in rs] if rs.notna().any() else None
    return out


def charts(d, bench):
    w, m = resample(d, "W-FRI"), resample(d, "ME")
    bw, bm = resample(bench.to_frame("Close").assign(Open=bench, High=bench, Low=bench, Volume=0), "W-FRI")["Close"], bench.resample("ME").last()
    full = {"d": bars(d, (50, 200), bench).copy(), "w": bars(w, (10, 30), bw), "m": bars(m, (10,), bm)}
    cut = {"d": 504, "w": 260, "m": 120}  # 일봉 2년 · 주봉 5년 · 월봉 10년
    return {k: {kk: (vv[-cut[k]:] if isinstance(vv, list) else {n: s[-cut[k]:] for n, s in vv.items()} if isinstance(vv, dict) else vv)
                for kk, vv in v.items()} for k, v in full.items()}


def us_extra(t):
    """뉴스 한 줄 · 다음 실적일 (야후) — 카드에 뽑힌 종목만."""
    import yfinance as yf
    tk, out = yf.Ticker(t), {}
    try:
        n = (tk.news or [])[0]
        c = n.get("content") or n
        out["news"] = {"t": c.get("title"), "u": (c.get("canonicalUrl") or {}).get("url") or c.get("link"),
                       "d": str(c.get("pubDate") or "")[:10]}
    except Exception:  # noqa: BLE001
        pass
    try:
        ed = (tk.calendar or {}).get("Earnings Date") or []
        if ed:
            out["earn"] = str(ed[0])[:10]
    except Exception:  # noqa: BLE001
        pass
    return out


def scan():
    import yfinance as yf
    cal = {e["code"]: e["when"][:10] for e in (read_json(DATA / "ir_calendar.json", {}) or {}).get("items", []) if e.get("dday", -1) >= -3}
    res = {}
    # 미국 S&P500
    uni = us_universe()
    meta = {t: (nm, sec, sub) for t, nm, sec, sub in uni}
    px = us_ohlcv([t for t, *_ in uni])
    spy = yf.Ticker("SPY").history(period="10y")["Close"]
    spy.index = spy.index.tz_localize(None)
    # 한국 시총 상위 300
    kuni = kr_universe()
    kpx, kmeta = {}, {}
    for code, nm, sec, cap in kuni:
        try:
            kpx[code] = kr_ohlcv(code)
            kmeta[code] = (nm, sec, cap)
        except Exception as e:  # noqa: BLE001
            print("  가격 실패", code, str(e)[:40])
    ks = yf.Ticker("^KS11").history(period="10y")["Close"]
    ks.index = ks.index.tz_localize(None)
    for mk, P, bench, M in (("us", px, spy, meta), ("kr", kpx, ks, kmeta)):
        rs = rs_scores(P, bench)
        hits = {"gap": [], "week": [], "month": []}
        for k, d in P.items():
            s = scan_one(d)
            for kind in hits:
                if kind in s:
                    hits[kind].append((rs.get(k, 0), k, s))
        out = {}
        for kind, lst in hits.items():
            lst.sort(key=lambda x: -x[0])
            cap_n = 8 if kind == "gap" else 6
            cards = []
            for score, k, s in lst[:cap_n]:
                d = P[k]
                nm, sec, x3 = M[k]
                card = {"code": k, "name": nm, "sec": sec, "sub": x3 if mk == "us" else None, "cap": x3 if mk == "kr" else None,
                        "price": r_(d["Close"].iloc[-1], 2), "chg": r_((d["Close"].iloc[-1] / d["Close"].iloc[-2] - 1) * 100, 1),
                        "rs": score, "hit": s[kind], "badge": s["badge"], "chart": charts(d, bench)}
                if mk == "us":
                    card.update(us_extra(k))
                elif k in cal:
                    card["earn"] = cal[k]
                cards.append(card)
            out[kind] = {"cards": cards, "more": [{"code": k, "name": M[k][0], "rs": sc} for sc, k, _ in lst[cap_n:cap_n + 30]], "n": len(lst)}
        res[mk] = {**out, "universe": len(P)}
    return res


# ---------- 📈 차트 탭: 주봉 정배열 (텔레그램 '[주봉 정배열]' 과 같은 규칙) ----------
ALIGN_MA, ALIGN_CAP = (4, 13, 26, 52), 3e11  # 4주 > 13주 > 26주 > 52주 이동평균 · 그 주 시가총액 3,000억 이상


def kr_weekly(code, years=3):
    """네이버 주봉 (수정주가, 날짜 = 그 주 마지막 거래일)."""
    end, start = now_kst(), now_kst() - timedelta(days=365 * years)
    txt = HTTP.get(f"https://api.finance.naver.com/siseJson.naver?symbol={code}&requestType=1"
                   f"&startTime={start:%Y%m%d}&endTime={end:%Y%m%d}&timeframe=week").text
    rows = re.findall(r'\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)', txt)
    df = pd.DataFrame([[float(x) for x in r[1:]] for r in rows], index=pd.to_datetime([r[0] for r in rows]),
                      columns=["Open", "High", "Low", "Close", "Volume"])
    return df[df["Close"] > 0]


def align_flags(close):
    """주마다 정배열인지 (이평선이 다 있어야 True)."""
    m = [close.rolling(n).mean() for n in ALIGN_MA]
    return (m[0] > m[1]) & (m[1] > m[2]) & (m[2] > m[3])


def align():
    """끝난 주(금요일 장 마감 뒤) 기준 정배열 + 그 주 시총 3,000억 이상 → 통과·신규·이탈(이유)·연속 주 수 + 주봉 차트.
    지난주 시총 = 지금 시총 × (지난주 종가 ÷ 지금 종가) — 시총이 3,000억을 넘나들어도 신규·이탈로 잡혀요 (텔레그램과 같음)."""
    now = now_kst()
    fri = (now - timedelta(days=(now.weekday() - 4) % 7)).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    if now.weekday() == 4 and now.hour < 16:
        fri -= timedelta(days=7)  # 금요일 장중엔 이번 주가 아직 안 끝남
    # 한 주 -33% 까지는 시총 이탈을 잡음 · 끝자리 0 = 보통주 · 리츠·인프라 펀드는 뺌 (원본 글에 없음)
    # shortcut: 리츠는 이름으로 거름 (KRX 업종이 지주사와 같은 '기타금융'), 이름에 안 드러나는 리츠가 생기면 KRX 증권 구분으로
    uni = [u for u in kr_universe(n=5000, min_cap=ALIGN_CAP * 2 / 3) if u[0].endswith("0") and not re.search("(?<!메)리츠|리얼티|인프라", u[1])]  # 메리츠금융지주는 남김
    rows, charts_ = [], {}
    for code, nm, sec, cap in uni:
        try:
            w = kr_weekly(code)
        except Exception as e:  # noqa: BLE001
            print("  주봉 실패", code, str(e)[:40])
            continue
        last = w["Close"].iloc[-1]
        w = w[w.index <= fri]
        if len(w) < max(ALIGN_MA) + 2 or not cap:
            continue
        f = align_flags(w["Close"])
        k = 0
        for x in f.iloc[::-1]:
            if not x:
                break
            k += 1
        c0, c1 = w["Close"].iloc[-1], w["Close"].iloc[-2]
        cap0, cap1 = cap * c0 / last, cap * c1 / last
        rows.append({"code": code, "name": nm, "sec": sec, "cap": r_(cap0, -6), "streak": k, "chg": r_((c0 / c1 - 1) * 100, 1),
                     "now": bool(f.iloc[-1]) and cap0 >= ALIGN_CAP, "prev": bool(f.iloc[-2]) and cap1 >= ALIGN_CAP,
                     "al1": bool(f.iloc[-2]), "al0": bool(f.iloc[-1])})
        charts_[code] = w
    date = max((w.index[-1] for w in charts_.values()), default=fri).strftime("%Y-%m-%d")
    by_cap = lambda r: -r["cap"]
    pas = sorted([r for r in rows if r["now"]], key=by_cap)
    new = sorted([{**r, "why": "cap" if r["al1"] else "align"} for r in rows if r["now"] and not r["prev"]], key=lambda r: (r["why"] != "cap", -r["cap"]))
    out = sorted([{**r, "why": "cap" if r["al0"] else "align"} for r in rows if r["prev"] and not r["now"]], key=lambda r: r["code"])
    keep = {r["code"] for r in pas + out}
    cut = lambda b: {kk: (vv[-104:] if isinstance(vv, list) else {n: s[-104:] for n, s in vv.items()}) for kk, vv in b.items()}  # 2년
    pick = lambda r: {k: r[k] for k in ("code", "name", "sec", "cap", "streak", "chg", "why") if k in r}
    return {"date": date, "rule": "MA4>13>26>52", "min_cap": ALIGN_CAP, "universe": sum(1 for r in rows if r["cap"] >= ALIGN_CAP),
            "pass": [pick(r) for r in pas], "new": [pick(r) for r in new], "out": [pick(r) for r in out],
            "charts": {c: cut(bars(charts_[c], ALIGN_MA)) for c in keep}}


def main():
    t0 = now_kst()
    if "--align" not in sys.argv:
        b = board()
        write_json(DATA / "board.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), **b})
        print(f"■ 시장 그룹판: 한국 {len(b['kr'])} · 미국 {len(b['us'])}")
    if "--board" not in sys.argv:
        try:  # 실패해도 차트 스캔은 돌게
            a = align()
            write_json(DATA / "align.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), **a})
            print(f"■ 주봉 정배열 {a['date']}: {a['universe']}종목 중 통과 {len(a['pass'])} (신규 {len(a['new'])} / 이탈 {len(a['out'])})")
        except Exception as e:  # noqa: BLE001
            print("■ 주봉 정배열 실패:", str(e)[:200])
    if "--board" not in sys.argv and "--align" not in sys.argv:
        s = scan()
        write_json(DATA / "scan.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), **s})
        for mk in ("kr", "us"):
            print(f"■ 차트 스캔 {mk}: {s[mk]['universe']}종목 · 갭 {s[mk]['gap']['n']} · 주봉 {s[mk]['week']['n']} · 월봉 {s[mk]['month']['n']}")
    print(f"걸린 시간 {(now_kst() - t0).seconds // 60}분")


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:  # 자체 점검: 칩 상태와 주봉 돌파 조건
        idx = pd.bdate_range("2023-01-02", periods=400)
        up = pd.Series(range(1, 401), index=idx, dtype=float)
        assert chip_close(up, 50, 5)["s"] == "up" and chip_close(-up + 500, 50, 5)["s"] == "down" and not chip_close(up, 50, 5)["ch"]
        flip = up.copy(); flip.iloc[-1] = 1  # 마지막 날 크게 떨어지면 '오늘 바뀜'
        assert chip_close(flip, 50, 5)["ch"]
        base = [100.0] * 200 + [100 - i * 0.2 for i in range(150)] + [70 + i * 1.5 for i in range(50)]
        d = pd.DataFrame({"Open": base, "High": [x * 1.01 for x in base], "Low": [x * 0.99 for x in base], "Close": base, "Volume": [1e6] * 400}, index=idx)
        s = scan_one(d)
        assert "week" in s and s["week"]["below"] >= 15, s
        drop = up.copy(); drop.iloc[-3:] = 100  # 마지막 3일 200일선 아래로 → 주황 3일째
        m = ma200_card("X", "x", "x", drop)
        assert m["s"] == "down" and m["days"] == 3 and len(m["c"]) == 205 and ma200_card("X", "x", "x", up)["s"] == "up", m
        # 컵위드핸들 (주봉): 60→100 오름, 100→75 컵, 98 회복 → 입술 / 손잡이 92 → 101 돌파
        cupv = list(np.linspace(55, 60, 40)) + list(np.linspace(60, 100, 20)) + list(100 - 25 * np.sin(np.linspace(0, np.pi, 30))[1:])
        assert cup_shape(np.array(cupv), 1)["st"] == "lip"
        assert cup_shape(np.array(cupv + [97, 98, 96, 94, 92, 93]), 1)["st"] == "handle"
        assert cup_shape(np.array(cupv + [97, 98, 96, 94, 92, 93, 101]), 1)["st"] == "out"
        assert cup_shape(np.array(cupv[:-4]), 1)["st"] == "up"
        assert cup_shape(np.array(cupv[:-14]), 1) is None  # 깊이 절반도 회복 못 함
        # 채널: 로그로 일정하게 오르는 지그재그 → 마지막에 아래선 밑으로
        lv = np.log(100) + 0.01 * np.arange(120) + 0.08 * np.abs(np.sin(np.arange(120) / 4))
        cc = np.exp(lv); cc[-1] = cc[-1] * 0.85
        ch_ = channel(cc * 1.01, cc * 0.99, cc, 1, 120)
        assert ch_ and ch_["a"] == 0 and ch_["st"] == "below" and abs(ch_["s"] - 0.01) < 0.002, ch_
        assert channel(cc[:-1] * 1.01, cc[:-1] * 0.99, cc[:-1], 1, 120)["st"] == "in"
        # 이평선 배열: 계속 내리면 역배열 + 종가가 모든 선 아래 · 계속 오르면 정배열
        al = ma_align(-up + 500, (5, 20, 60, 120))
        assert al["st"] == "역배열" and al["below_all"] and al["run"] > 200 and ma_align(up, (5, 20, 60, 120))["st"] == "정배열", al
        # 거래량 지지대: 90 근처에서 거래량이 몰렸고 지금 100 → 지지대는 90 이 든 칸
        pv = np.array([90.0] * 50 + [110.0] * 50 + [100.0]); vv = np.array([10.0] * 50 + [1.0] * 51)
        vs = vol_shelf(pv + 0.5, pv - 0.5, pv, vv, n=101, bins=20)
        assert vs and vs["lo"] <= 90 <= vs["hi"] and vs["hi"] <= 100 and vs["share"] > 80, vs
        print("ok")
    else:
        main()
