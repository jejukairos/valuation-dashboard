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

from common import CACHE, DATA, HTTP, load_yaml, now_kst, read_json, write_json

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
            ("SCHD", "미국 배당주"), ("ILF", "중남미"), ("VNQ", "미국 리츠·부동산"),
            # 사용자 전달 선거 뒤 '많이 오른/빠진 ETF 10' (2026-11-05) — 금리·달러·유가·관세 테마 (차트 탭 🧭 메모)
            ("SIL", "은 광산"), ("ITB", "미국 주택건설"), ("IHI", "의료기기"), ("JETS", "항공"), ("TAN", "태양광"),
            ("AWAY", "여행기술"), ("AIPO", "AI·전력 인프라"), ("DRNZ", "드론"), ("MSOS", "마리화나"), ("SHLD", "국방 기술")]
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
    try:
        etf = etf_info()
    except Exception as e:  # noqa: BLE001
        print("  ETF 구성 실패", str(e)[:80])
        etf = {}
    return {"kr": sorted(kr, key=key), "us": sorted(us, key=key), "ai": [c for c in ai if c], "draw": dr, "etf": etf}


def etf_info():
    """🗺 그룹판 카드를 누르면 보이는 '무엇을 따라가나' (사용자 11/4): 한국 ETF = 네이버(이름·운용사·기초지수 설명) + KRX 납입자산구성(PDF, pykrx) 상위 10
    · 미국 ETF = 야후 상위 10 보유 종목. 구성은 자주 안 바뀌어서 7일에 한 번 (한국 구성을 못 받았으면 하루 뒤 다시) — cache/etf_hold.json."""
    f, today = CACHE / "etf_hold.json", now_kst().strftime("%Y-%m-%d")
    old = read_json(f, {}) or {}
    age = (pd.Timestamp(today) - pd.Timestamp(old["d"])).days if old.get("d") else 99
    miss = any(not (old.get("etf", {}).get(c) or {}).get("top") for c, _, yt in KR_BOARD if not yt)
    if old.get("etf") and (age < 1 or (age < 7 and not miss)):
        return old["etf"]
    out = {}
    nmap = {c: nm for c, nm, *_ in kr_universe(n=5000)}  # 종목 이름 (pykrx get_market_ticker_name 은 가끔 None 을 돌려줌)
    for code, _, yt in KR_BOARD:
        if yt:
            continue
        x = {}
        try:
            j = HTTP.get(f"https://m.stock.naver.com/api/stock/{code}/integration", timeout=15).json()
            k = j.get("etfKeyIndicator") or {}
            sents = re.split(r"(?<=다\.)\s+", re.sub(r"\s+", " ", j.get("description") or "").strip())
            x = {"n": j.get("stockName"), "by": k.get("issuerName"), "aum": k.get("marketValue"), "desc": " ".join(sents[:2])[:320]}
        except Exception as e:  # noqa: BLE001
            print("  ETF 설명 실패", code, str(e)[:50])
        try:
            from pykrx import stock
            df = stock.get_etf_portfolio_deposit_file(code)
            df = df[[bool(re.fullmatch(r"\d{6}", str(i))) for i in df.index]]  # 현금·선물 등은 빼고 주식만
            col = "비중" if "비중" in df and df["비중"].sum() > 0 else "금액"
            tot = float(df[col].sum())

            def nm(t):
                if t in nmap:
                    return nmap[t]
                try:
                    v = stock.get_market_ticker_name(t)
                    return v if isinstance(v, str) and v else t
                except Exception:  # noqa: BLE001
                    return t
            x["top"] = [{"c": t, "n": nm(t), "w": r_(float(v) / tot * 100 if col == "금액" else float(v), 1)}
                        for t, v in df[col].sort_values(ascending=False).head(10).items()]
            x["cnt"] = len(df)
        except Exception as e:  # noqa: BLE001
            print("  ETF 구성(PDF) 실패", code, str(e)[:60])
        out[code] = x
    import yfinance as yf
    for t, _ in US_BOARD:
        try:
            th = yf.Ticker(t).funds_data.top_holdings
            out[t] = {"top": [{"c": s, "n": r["Name"], "w": r_(float(r["Holding Percent"]) * 100, 1)} for s, r in th.head(10).iterrows()]}
        except Exception:  # noqa: BLE001 — 금·은·원유·코인 ETF 는 보유 종목이 없음
            out[t] = {}
    write_json(f, {"d": today, "etf": out})
    return out


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
         {"ma": (5, 20, 60, 120), "kr": True}),
        # 5번째 칸 m = M자(쌍봉) 계산 (m_shape)
        ("EWY", "한국 ETF (MSCI 코리아 · 달러)", "w", "11/6 전달 그림 (EWY 주봉): 6월 고점 뒤 M자 — 고점과 고점이 낮아지고 저점과 저점도 낮아짐. "
                                               "그림의 첫 봉우리 근처에 'SK하이닉스 ADR 상장' 표시", {"m": True})]


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


def m_shape(c, k, span):
    """M자(쌍봉) · 고점과 저점이 함께 낮아짐 (사용자 11/6 EWY 주봉 그림), 종가 기준.
    A = 최근 span 봉 가장 높은 종가(첫 봉우리) → 10%+ 눌린 뒤 가장 높은 되돌림 고점 C(두 번째 봉우리, 좌우 2주 고점)
    → B = A~C 사이 가장 낮은 종가(가운데 골 = 목선). C 뒤에 C 보다 높은 종가가 없어야 함.
    st: below 지금 목선 아래 (저점도 낮아짐) · dipped 목선 아래로 갔다가 다시 위 · form 두 번째 봉우리 뒤 내려오는 중."""
    from patterns import _piv
    T = len(c) - 1
    lo0 = max(0, T + 1 - span)
    A = lo0 + int(c[lo0:T + 1].argmax())
    cand = [p for p in _piv(c[:T + 1], 2 * k) if A + 4 * k <= p <= T - k and c[A + 1:p].min() <= 0.9 * c[A]]
    if not cand:
        return None
    C = max(cand, key=lambda p: c[p])
    B = A + 1 + int(c[A + 1:C].argmin())
    if c[C] < c[B] + 0.3 * (c[A] - c[B]) or c[C + 1:T + 1].max() >= c[C]:  # 되돌림이 너무 약하거나, 두 번째 봉우리를 이미 넘음
        return None
    D = C + 1 + int(c[C + 1:T + 1].argmin())  # 두 번째 봉우리 뒤 가장 낮은 종가
    st = "below" if c[T] < c[B] else "dipped" if c[D] < c[B] else "form"
    S = max(0, A - 8 * k) + int(c[max(0, A - 8 * k):A + 1].argmin())  # M 왼쪽 다리 시작 (첫 봉우리 전 8주 안 가장 낮은 곳)
    return {"st": st, "s": S, "a": A, "b": B, "c": C, "d": D, "A": c[A], "B": c[B], "C": c[C], "D": c[D],
            "lh": (c[C] / c[A] - 1) * 100, "ll": (c[D] / c[B] - 1) * 100}


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
    px = us_ohlcv([t for t, *_ in DRAW], period="max", adj=False)  # 여러 티커라야 받힘 (한 개면 열 이름이 달라 빠짐) · 월봉·연봉 때문에 처음부터
    out = []
    for sym, name, tf, memo, *opt in DRAW:
        o = opt[0] if opt else {}
        full = px.get(sym)
        if full is None:
            continue
        d = full[full.index >= full.index[-1] - pd.DateOffset(years=3)]  # 선(컵·채널·지지대) 계산은 예전처럼 최근 3년으로
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
        if o.get("m"):
            mm = m_shape(C, k, 52 * k)
            if mm and mm["s"] >= off:
                x["mm"] = {**{kk: rel(mm[kk]) for kk in "sabcd"}, **{kk: r_(mm[kk], 2) for kk in ("A", "B", "C", "D", "lh", "ll")}, "st": mm["st"]}
        # 📅 일봉·주봉·월봉·연봉 버튼 (사용자 11/4) — 기본 봉(tf)은 위 ch, 나머지는 캔들 + 이평선만 (이평선은 전체 기간으로 계산한 뒤 자름)
        TF = {"d": (d, 200, o.get("ma") or (20, 50, 200)), "w": (resample(full, "W-FRI"), 104, (10, 30)),
              "m": (resample(full, "ME"), 120, (10, 20)), "y": (resample(full, "YE"), 60, (5,))}
        x["tfs"] = {k_: tail(bars(b_, ma_), n_) for k_, (b_, n_, ma_) in TF.items() if k_ != tf}
        out.append(x)
    return out


def tail(b, n):
    """bars() 결과를 끝에서 n 봉만."""
    return {k: (v[-n:] if isinstance(v, list) else {m: s[-n:] for m, s in v.items()} if isinstance(v, dict) else v) for k, v in b.items()}


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


# ---------- 🪜 와인스타인 4단계 (사용자 11/4: 스탠 와인스타인 『주식투자 최적의 타이밍을 잡는 법』 + 전달 그림 '한국 종목 단계 분포') ----------
STAGE_MA, STAGE_LB, STAGE_TH = 30, 4, 1.0  # 30주선 · 4주 전과 비교 · ±1% 넘게 움직여야 '오름/내림' (그 안이면 평평)
# FnGuide WICS 업종 → 20개 묶음 (없는 이름은 '기타' — 로그에 찍어 두고 나중에 넣기)
STAGE_GROUP = {
    "반도체": ["반도체와반도체장비"],
    "IT하드웨어·전자부품": ["전자장비와기기", "디스플레이장비및부품", "디스플레이패널", "전자제품", "컴퓨터와주변기기", "핸드셋", "통신장비", "사무용전자제품"],
    "2차전지·전기장비": ["전기제품", "전기장비"],
    "인터넷·소프트웨어": ["양방향미디어와서비스", "소프트웨어", "IT서비스"],
    "미디어·엔터·게임": ["방송과엔터테인먼트", "게임엔터테인먼트", "광고", "출판", "미디어"],
    "통신": ["무선통신서비스", "다각화된통신서비스"],
    "자동차": ["자동차", "자동차부품"],
    "조선": ["조선"],
    "방산·우주": ["우주항공과국방"],
    "기계·산업재": ["기계", "복합기업", "상업서비스와공급품", "무역회사와판매업체"],
    "건설·건자재": ["건설", "건축자재", "건축제품"],
    "화학·소재": ["화학", "포장재", "종이와목재"],
    "철강·비철금속": ["철강", "비철금속", "금속과광물"],
    "에너지·유틸리티": ["석유와가스", "에너지장비및서비스", "전기유틸리티", "가스유틸리티", "복합유틸리티"],
    "운송": ["해운사", "항공사", "도로와철도운송", "운송인프라", "항공화물운송과물류"],
    "금융": ["은행", "증권", "생명보험", "손해보험", "창업투자", "기타금융", "카드", "부동산"],
    "바이오·헬스케어": ["제약", "생물공학", "건강관리장비와용품", "건강관리업체및서비스", "건강관리기술", "생명과학도구및서비스"],
    "화장품·의류·생활용품": ["화장품", "섬유,의류,신발,호화품", "가정용품", "가정용기기와용품", "레저용장비와제품", "가구"],
    "음식료": ["식품", "음료", "담배"],
    "유통": ["백화점과일반상점", "인터넷과카탈로그소매", "판매업체", "전문소매", "식품과기본식료품소매"],
    "레저·교육·서비스": ["호텔,레스토랑,레저", "교육서비스", "다각화된소비자서비스"],
}
W2G = {w: g for g, ws in STAGE_GROUP.items() for w in ws}


def stage_series(close):
    """주봉 종가 → 주마다 단계 1~4 (30주선이 생기기 전 = None). 와인스타인 4단계를 기계적으로:
    2 = 종가 > 30주선 & 30주선이 4주 전보다 +1% 넘게 오름 · 4 = 종가 < 30주선 & 30주선이 -1% 넘게 내림
    · 그 밖(30주선이 평평하거나 종가와 선 방향이 엇갈림) = 바로 전 확실한 단계가 2 면 3(천장권), 4 면 1(바닥권)
    · 처음(확실한 단계 전)엔 30주선이 26주 전보다 높으면 3, 아니면 1."""
    ma = close.rolling(STAGE_MA).mean()
    sl, m26 = (ma / ma.shift(STAGE_LB) - 1) * 100, ma.shift(26)
    out, last = [], None
    for c, m, s, m0 in zip(close.values, ma.values, sl.values, m26.values):
        if m != m or s != s:
            out.append(None)
            continue
        if c > m and s > STAGE_TH:
            st = last = 2
        elif c < m and s < -STAGE_TH:
            st = last = 4
        else:
            st = 3 if last == 2 else 1 if last == 4 else (3 if m0 == m0 and m > m0 else 1)
        out.append(st)
    return pd.Series(out, index=close.index, dtype="object")


def run_len(s):
    """끝에서부터 같은 값이 몇 번 이어졌나."""
    v, k = list(s), 1
    while k < len(v) and v[-1 - k] == v[-1]:
        k += 1
    return k


def cap_index(closes, caps):
    """구성 종목 시총 가중 지수 (처음 = 100): 주마다 '지난주 시총 비중 × 이번 주 수익률'을 더해 이어 붙임.
    지난주 시총 = 지금 시총 × 지난주 종가 ÷ 지금 종가 (그 사이 주식 수는 그대로라고 봄)."""
    C = pd.concat(closes, axis=1).sort_index()
    last = C.ffill().iloc[-1]
    w = C.mul(pd.Series(caps)[C.columns] / last, axis=1).shift(1)
    r = C / C.shift(1) - 1
    ok = r.notna() & w.notna()
    tot = w.where(ok, 0).sum(axis=1)
    ret = (r.where(ok, 0) * w.where(ok, 0)).sum(axis=1) / tot.where(tot > 0)
    return 100 * (1 + ret.fillna(0)).cumprod()


def wics_map(codes):
    """종목 → FnGuide WICS 업종 (와이즈리포트 기업 개요 — 업종은 잘 안 바뀌어 한 번 받으면 cache/wics.json 에 둠)."""
    from concurrent.futures import ThreadPoolExecutor
    from kr_stock import WISE
    f = CACHE / "wics.json"
    m = read_json(f, {}) or {}
    need = [c for c in codes if c not in m]

    def get(c):
        try:
            w = re.search(r"WICS\s*:\s*([^<]+)", HTTP.get(f"{WISE}/c1010001.aspx?cmp_cd={c}", timeout=20).text)
            return c, w.group(1).strip() if w else ""
        except Exception:  # noqa: BLE001
            return c, None  # 실패는 저장 안 함 → 다음에 다시
    with ThreadPoolExecutor(6) as ex:
        for c, w in ex.map(get, need):
            if w is not None:
                m[c] = w
    if need:
        write_json(f, m)
        print(f"  WICS 업종 새로 {len(need)}종목")
    return m


def stage_card(name, close, bench=None, n=104):
    """업종·지수 카드: 단계·며칠째 · 30주선 대비 · 1개월(4주) · 3개월(13주) 상대 · 2년 선(지수·30주선·주마다 단계)."""
    st, ma = stage_series(close), close.rolling(STAGE_MA).mean()
    ret = lambda s, k: (s.iloc[-1] / s.iloc[-1 - k] - 1) * 100 if len(s) > k else None
    w2 = close.iloc[-n:]
    out = {"name": name, "st": st.iloc[-1], "run": run_len(st.dropna()), "prev": st.iloc[-2] if len(st) > 1 else None,
           "gap": r_((close.iloc[-1] / ma.iloc[-1] - 1) * 100, 1), "chg_w": r_(ret(close, 1), 1), "r1m": r_(ret(close, 4), 0),
           "chg_2y": r_((w2.iloc[-1] / w2.iloc[0] - 1) * 100, 0), "peak_2y": r_((w2.max() / w2.iloc[0] - 1) * 100, 0),
           "t": [d.strftime("%y.%m.%d") for d in w2.index], "c": [r_(v, 2) for v in w2], "ma": [r_(v, 2) for v in ma.iloc[-n:]], "s": list(st.iloc[-n:])}
    if bench is not None and ret(close, 13) is not None and ret(bench, 13) is not None:
        out["rel3m"] = r_(ret(close, 13) - ret(bench, 13), 0)
    return out


def stage(ws, caps, names, fri):
    """🪜 한국 종목·업종 단계 판: ws = {코드: 주봉}, caps = {코드: 지금 시총}. 업종 = WICS 를 20개로 묶은 시총 가중 지수."""
    import yfinance as yf
    idx = {}
    for t, nm in (("^KS11", "코스피"), ("^KQ11", "코스닥")):
        h = yf.Ticker(t).history(period="3y")
        h.index = h.index.tz_localize(None)
        idx[nm] = resample(h[["Open", "High", "Low", "Close", "Volume"]], "W-FRI")["Close"].loc[lambda s: s.index <= fri + timedelta(days=1)]
    ks = idx["코스피"]
    wics = wics_map(list(ws))
    S = {c: stage_series(w["Close"]) for c, w in ws.items()}
    D = pd.DataFrame(S).sort_index().iloc[-104:]  # 주 × 종목 단계
    cnt = D.notna().sum(axis=1)
    dist = {f"s{k}": [r_(v, 1) for v in ((D == k).sum(axis=1) / cnt * 100)] for k in (1, 2, 3, 4)}
    groups, unk = {}, {}
    for c in ws:
        g = W2G.get(wics.get(c) or "", "기타")
        if g == "기타":
            unk[wics.get(c) or "(없음)"] = unk.get(wics.get(c) or "(없음)", 0) + 1
        groups.setdefault(g, []).append(c)
    secs = []
    for g, cs in groups.items():
        if len(cs) < 3:  # 3종목 미만 묶음은 지수가 한두 종목에 끌려가서 뺌
            continue
        card = stage_card(g, cap_index({c: ws[c]["Close"] for c in cs}, {c: caps[c] for c in cs}), ks)
        now = [S[c].iloc[-1] for c in cs if len(S[c]) and S[c].iloc[-1] is not None]
        mem = sorted(cs, key=lambda c: -caps[c])
        secs.append({**card, "n": len(cs), "p2": r_(sum(x == 2 for x in now) / len(now) * 100, 0) if now else None,
                     "p4": r_(sum(x == 4 for x in now) / len(now) * 100, 0) if now else None,
                     "wics": sorted({wics.get(c) or "" for c in cs} - {""}),
                     "mem": [[names[c], c, S[c].iloc[-1], r_(caps[c] / 1e8, 0)] for c in mem]})
    order = {2: 0, 1: 1, 3: 2, 4: 3}
    secs.sort(key=lambda s: (order.get(s["st"], 9), -(s.get("rel3m") if s.get("rel3m") is not None else -999)))
    if unk:
        print("  WICS 묶음 밖(기타):", unk)
    return {"n": len(ws), "t": [d.strftime("%y.%m.%d") for d in D.index], "dist": dist,
            "idx": [stage_card(nm, s, ks if nm != "코스피" else None) for nm, s in idx.items()], "sec": secs, "unk": unk,
            "rule": {"ma": STAGE_MA, "lb": STAGE_LB, "th": STAGE_TH}}


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
    big = [r for r in rows if r["cap"] >= ALIGN_CAP]  # 🪜 4단계 판정 대상 = 정배열과 같은 '시총 3,000억 이상'
    try:
        stg = stage({r["code"]: charts_[r["code"]] for r in big}, {r["code"]: r["cap"] for r in big}, {r["code"]: r["name"] for r in big}, fri)
    except Exception as e:  # noqa: BLE001 — 실패해도 정배열은 저장
        print("  4단계 판 실패:", str(e)[:200])
        stg = None
    return {"date": date, "rule": "MA4>13>26>52", "min_cap": ALIGN_CAP, "universe": len(big),
            "pass": [pick(r) for r in pas], "new": [pick(r) for r in new], "out": [pick(r) for r in out],
            "charts": {c: cut(bars(charts_[c], ALIGN_MA)) for c in keep}, "stage": stg}


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
        # M자: 100 → 200(첫 봉우리) → 150(골) → 180(두 번째) → 140 이면 목선 아래 · 160 까지만이면 내려오는 중 · 210 이면 아님
        mv = list(np.linspace(100, 200, 10)) + list(np.linspace(195, 150, 6)) + list(np.linspace(155, 180, 6)) + [175, 170, 165, 160]
        mm = m_shape(np.array(mv + [140.0]), 1, 52)
        assert mm and mm["st"] == "below" and mm["A"] == 200 and mm["B"] == 150 and mm["C"] == 180 and mm["D"] == 140, mm
        assert m_shape(np.array(mv), 1, 52)["st"] == "form" and m_shape(np.array(mv + [210.0]), 1, 52) is None
        # 이평선 배열: 계속 내리면 역배열 + 종가가 모든 선 아래 · 계속 오르면 정배열
        al = ma_align(-up + 500, (5, 20, 60, 120))
        assert al["st"] == "역배열" and al["below_all"] and al["run"] > 200 and ma_align(up, (5, 20, 60, 120))["st"] == "정배열", al
        # 거래량 지지대: 90 근처에서 거래량이 몰렸고 지금 100 → 지지대는 90 이 든 칸
        pv = np.array([90.0] * 50 + [110.0] * 50 + [100.0]); vv = np.array([10.0] * 50 + [1.0] * 51)
        vs = vol_shelf(pv + 0.5, pv - 0.5, pv, vv, n=101, bins=20)
        assert vs and vs["lo"] <= 90 <= vs["hi"] and vs["hi"] <= 100 and vs["share"] > 80, vs
        # 4단계: 계속 오름 → 2 · 오른 뒤 평평 → 3 · 계속 내림 → 4 · 내린 뒤 평평 → 1
        wi = pd.date_range("2023-01-06", periods=120, freq="W-FRI")
        rise = pd.Series(np.linspace(100, 200, 120), index=wi)
        top = pd.Series(list(np.linspace(100, 200, 70)) + [200 + (3 if i % 2 else -3) for i in range(50)], index=wi)
        assert stage_series(rise).iloc[-1] == 2 and stage_series(top).iloc[-1] == 3
        assert stage_series(-rise + 300).iloc[-1] == 4 and stage_series(-top + 300).iloc[-1] == 1
        assert stage_series(rise).iloc[:29].isna().all() and run_len([1, 2, 2, 2]) == 3
        # 시총 가중 지수: 큰 종목(+10%)·작은 종목(-10%) 이 3:1 이면 한 주 +5%
        ci = cap_index({"a": pd.Series([100.0, 110.0], index=wi[:2]), "b": pd.Series([100.0, 90.0], index=wi[:2])}, {"a": 330.0, "b": 90.0})
        assert abs(ci.iloc[-1] - 105) < 1e-6, ci
        print("ok")
    else:
        main()
