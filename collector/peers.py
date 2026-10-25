"""동종업계 비교: 시가총액(원화), EPS TTM·12MF, PER TTM·12MF, 영업이익률, PBR, ROE, 배당수익률."""
from common import DATA, REPORT, load_yaml, now_kst, read_json, rnd
from kr_stock import naver_now, wise_annual

FX_TICKERS = {"USD": "KRW=X", "EUR": "EURKRW=X", "GBP": "GBPKRW=X", "JPY": "JPYKRW=X",
              "CHF": "CHFKRW=X", "TWD": "TWDKRW=X", "SEK": "SEKKRW=X", "NOK": "NOKKRW=X"}


def fx_rates():
    import yfinance as yf
    out = {"KRW": 1.0}
    for cur, t in FX_TICKERS.items():
        try:
            h = yf.Ticker(t).history(period="5d")["Close"].dropna()
            if not h.empty:
                out[cur] = float(h.iloc[-1])
        except Exception:  # noqa: BLE001
            pass
    return out


def kr_row(p):
    now = naver_now(p["code"])
    w = wise_annual(p["code"])
    actual = [y for y, r in w.items() if not r.get("estimate") and r.get("roe") is not None]
    roe = w[max(actual)]["roe"] if actual else None
    # 보유종목 카드와 같은 '12개월 선행 PER'(올해·내년 추정 EPS 를 남은 기간 비율로 섞음)으로 맞춘다
    t = now_kst()
    a, b = w.get(t.year, {}).get("eps"), w.get(t.year + 1, {}).get("eps")
    w0 = max(0.0, (12 - (t.month - 1) - t.day / 31) / 12)
    f12 = (w0 * a + (1 - w0) * b) if (a is not None and b is not None) else None
    fwd_per = now["price"] / f12 if (f12 and f12 > 0 and now.get("price")) else now.get("fwd_per")
    opm_y = max((y for y, r in w.items() if not r.get("estimate") and r.get("opm") is not None), default=None)
    return {"cap_krw": now.get("market_cap"), "fwd_per": fwd_per, "pbr": now.get("pbr"),
            "roe": roe, "div": now.get("div_yield"), "currency": "KRW",
            # 사진의 글로벌 피어 표처럼: EPS TTM·12MF, PER TTM·12MF, 영업이익률
            "eps_ttm": now.get("eps"), "eps_12mf": f12, "per_ttm": now.get("per"),
            "opm": w[opm_y]["opm"] if opm_y else None,
            "src": f"네이버 증권 · ROE {max(actual)}년 와이즈리포트" if actual else "네이버 증권"}


def yf_row(p, fx):
    import yfinance as yf
    i = yf.Ticker(p["code"]).info
    cur = i.get("currency") or "USD"
    cap_cur = "GBP" if cur == "GBp" else cur  # 런던 주가는 펜스(GBp)지만 시가총액은 파운드
    cap = i.get("marketCap")
    rate = fx.get(cap_cur)
    warn = None
    pbr = i.get("priceToBook")
    if i.get("financialCurrency") and i.get("financialCurrency") != cap_cur:
        # 주가(예: 달러)와 장부가(예: 대만달러) 통화가 다르면 야후 PBR 이 틀리므로 비운다
        warn = f"PBR N/A: 재무제표 통화({i['financialCurrency']})와 주가 통화({cap_cur})가 달라 계산 불가"
        pbr = None
    roe = i.get("returnOnEquity")
    opm = i.get("operatingMargins")
    price = i.get("currentPrice") or i.get("regularMarketPrice")
    eps_f = i.get("forwardEps")
    # 선행 PER 은 지금 가격 ÷ 야후 선행 EPS 로 다시 계산 (야후 forwardPE 는 갱신이 늦을 때가 있음), 적자면 비움
    fwd = price / eps_f if (price and eps_f and eps_f > 0) else (None if (eps_f is not None and eps_f <= 0) else i.get("forwardPE"))
    return {"cap_krw": cap * rate if (cap and rate) else None, "fwd_per": fwd,
            "pbr": pbr, "roe": roe * 100 if roe is not None else None,
            "div": i.get("dividendYield"), "currency": cap_cur, "src": "야후 파이낸스", "warn": warn,
            "eps_ttm": i.get("trailingEps"), "eps_12mf": eps_f, "per_ttm": i.get("trailingPE") if (i.get("trailingEps") or 0) > 0 else None,
            "opm": opm * 100 if opm is not None else None}


def collect():
    cfg = load_yaml("peers.yaml") or {}
    prev = {}
    for g in (read_json(DATA / "peers.json", {}) or {}).get("groups", []):
        for r in g.get("rows", []):
            prev[r["code"]] = r
    fx = fx_rates()
    cache, groups = {}, []
    for g in cfg.get("groups", []):
        rows = []
        for p in g.get("peers", []):
            code = str(p["code"])
            if code not in cache:
                try:
                    r = kr_row({**p, "code": code}) if p.get("market", "KR") == "KR" else yf_row({**p, "code": code}, fx)
                    cache[code] = r
                except Exception as e:  # noqa: BLE001
                    REPORT.fail(f"피어 {p['name']}", f"{type(e).__name__}: {e}")
                    cache[code] = dict(prev[code], stale=True) if code in prev else None
            r = cache[code]
            if r is None:
                continue
            rows.append({"name": p["name"], "code": code, "market": p.get("market", "KR"),
                         **{k: (rnd(v, 2) if isinstance(v, float) and k != "cap_krw" else v) for k, v in r.items()
                            if k not in ("name", "code", "market")}})
        rows.sort(key=lambda x: -(x.get("cap_krw") or 0))
        groups.append({"name": g["name"], "holdings": [str(h) for h in g.get("holdings", [])], "rows": rows})
        REPORT.success(f"피어 그룹 {g['name']}")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "fx": {k: round(v, 4) for k, v in fx.items()},
            "groups": groups}
