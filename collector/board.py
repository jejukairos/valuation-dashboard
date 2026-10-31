"""🏭 산업 탭 '🗺 시장 그룹판'·'🔭 차트 스캔' — 밤·장 마감 뒤 따로 도는 수집 (.github/workflows/scan.yml → site/data/board.json·scan.json)
시장 그룹판: 한국 = 코스피·코스닥 + KRX 업종지수(구성종목 시총 가중)를 따라가는 업종 ETF, 미국 = 지수·섹터·산업 ETF
  카드마다 2년 주봉 종가 + 30주선, 일(50일선)·주(30주선)·월(10개월선) 추세 칩, 1개월 수익률·3개월 상대수익률(지수 대비)·52주 고점 대비
차트 스캔: 한국 시가총액 상위 300 (KRX, pykrx) + 미국 S&P500 (위키백과 목록) 을 매일 훑어
  일봉 '거래량 터진 갭 상승' · 주봉 '바닥 탈출 · 30주선과 12주 고점 돌파' · 월봉 '바닥 탈출 · 10개월선 돌파' 에 걸린 종목 카드 (RS 점수 = 지수 대비 1년 강도 순위)"""
import io
import re
import sys
from datetime import timedelta

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
            ("XLU", "유틸리티"), ("ITA", "항공우주·방산"), ("URA", "우라늄·원자력")]
US_IDX = {"SPY", "QQQ", "IWM", "RSP"}
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


def us_ohlcv(tickers, period="10y"):
    """야후 일봉 (배당·분할 반영 수정주가) — 100개씩 나눠 받음."""
    import yfinance as yf
    out = {}
    for i in range(0, len(tickers), 100):
        part = tickers[i:i + 100]
        df = yf.download(part, period=period, interval="1d", auto_adjust=True, group_by="ticker", threads=True, progress=False)
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
    out = {"sym": sym, "name": name, "idx": idx, "n": n_const,
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
    return {"kr": sorted(kr, key=key), "us": sorted(us, key=key)}


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
    uni = [u for u in kr_universe(n=5000, min_cap=ALIGN_CAP * 2 / 3) if u[0].endswith("0") and not re.search("리츠|리얼티|인프라", u[1])]
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
        print("ok")
    else:
        main()
