"""보유종목 비교표 한 줄: 성장·수익성·밸류·재무·주주환원 숫자.
한국 = 와이즈리포트 연간표(실적 + 28E 까지 추정), 미국 = 야후(받을 수 있는 것만, 나머지는 비움)."""
import pandas as pd

import compute as C
from common import now_kst, rnd


def _g(a, b):
    """b → a 성장률(%). 적자였거나 적자로 가면 비율이 의미 없어 비움."""
    return rnd((a / b - 1) * 100, 1) if (a is not None and b and b > 0 and a > 0) else None


def _cagr(a, b, n):
    return rnd(((a / b) ** (1 / n) - 1) * 100, 1) if (a and b and a > 0 and b > 0) else None


def _drawdown(px):
    """52주 고점 대비 지금 몇 % 아래인지 (수정주가)."""
    s = px.dropna()
    recent = s[s.index >= s.index[-1] - pd.Timedelta(days=365)]
    return rnd((float(s.iloc[-1]) / float(recent.max()) - 1) * 100, 1) if len(recent) else None


def net_cash(ticker, cap):
    """순현금 = (현금 + 단기투자자산) − 총차입금(리스 포함), 최근 분기 재무상태표 (야후, 한국은 'XXXXXX.KS')."""
    import yfinance as yf
    bs = yf.Ticker(ticker).quarterly_balance_sheet
    c = bs.columns[0]
    get = lambda k: float(bs.loc[k, c]) if k in bs.index and bs.loc[k, c] == bs.loc[k, c] else None  # noqa: E731
    cash = get("Cash Cash Equivalents And Short Term Investments") or get("Cash And Cash Equivalents")
    debt = get("Total Debt") or 0.0
    if cash is None:
        return None
    nc = cash - debt
    xl = nc + (get("Capital Lease Obligations") or 0.0)  # 리스 부채는 빼고 (회사가 어닝콜에서 말하는 '부채' 기준)
    return {"net_cash": nc, "net_cash_pct": rnd(nc / cap * 100, 1) if cap else None, "net_cash_asof": c.strftime("%Y-%m"),
            "net_cash_xl": xl, "net_cash_xl_pct": rnd(xl / cap * 100, 1) if cap else None}


def _peg(per12, eps_cagr):
    return rnd(per12 / eps_cagr, 2) if (per12 and per12 > 0 and eps_cagr and eps_cagr > 0) else None


def kr_row(wise, hist, price, cap, px, own_cap=True):
    """own_cap=False: 우선주처럼 실적이 다른 코드 기준이면 시총으로 나누는 P/FCF 는 비움."""
    y = now_kst().year
    w = lambda yy, k: (wise.get(yy) or {}).get(k)  # noqa: E731
    ys = [y - 1, y, y + 1, y + 2]
    lab = lambda yy: f"{str(yy)[2:]}{'' if yy < y else 'E'}"  # noqa: E731
    f_eps = C.fwd12(hist, "eps")
    per12 = price / f_eps if f_eps and f_eps > 0 else None
    eps_cagr = _cagr(w(y + 2, "eps"), w(y - 1, "eps"), 3)
    return {
        "years": [lab(v) for v in ys],
        "sales_g": [_g(w(v, "sales"), w(v - 1, "sales")) for v in ys[1:]],
        "op_g": [_g(w(v, "op"), w(v - 1, "op")) for v in ys[1:]],
        "sales_cagr": _cagr(w(y + 2, "sales"), w(y - 1, "sales"), 3),
        "op_cagr": _cagr(w(y + 2, "op"), w(y - 1, "op"), 3),
        "eps_cagr": eps_cagr,
        "per12": rnd(per12),
        "peg": _peg(per12, eps_cagr),
        "opm": [rnd(w(v, "opm"), 1) for v in ys],
        # 25 = 그해 말 주가 기준(와이즈리포트 값), 26E·27E = 지금 주가 ÷ 추정 EPS·BPS
        "per": [w(y - 1, "per")] + [rnd(price / w(v, "eps")) if (w(v, "eps") or 0) > 0 else None for v in (y, y + 1)],
        "pbr": [w(y - 1, "pbr")] + [rnd(price / w(v, "bps"), 2) if (w(v, "bps") or 0) > 0 else None for v in (y, y + 1)],
        "roe": [rnd(w(v, "roe"), 1) for v in ys[:3]],
        "debt": [rnd(w(v, "debt"), 0) for v in ys],
        "dd52": _drawdown(px),
        "dy": [rnd(w(v, "dps") / price * 100, 2) if w(v, "dps") is not None else None for v in (y, y + 1)],
        # P/FCF = 시가총액 ÷ 잉여현금흐름(억원) — 버핏이 말하는 '주주 몫 이익'에 가까운 현금 기준 배수
        "pfcf": [rnd(cap / (w(v, "fcf") * 1e8), 1) if (own_cap and cap and (w(v, "fcf") or 0) > 0) else None
                 for v in (y, y + 1, y + 2)],
    }


def us_row(code, hist, price, cap, px):
    """야후에서 받을 수 있는 것만: 매출 추정 성장률(올해·내년), 최근 연간 실적 기준 OPM·부채비율·P/FCF, PER·배당."""
    import yfinance as yf

    from us_stock import _label
    tk = yf.Ticker(code)
    y = now_kst().year
    out = {"years": [f"{str(y - 1)[2:]}", f"{str(y)[2:]}E", f"{str(y + 1)[2:]}E", f"{str(y + 2)[2:]}E"],
           "sales_g": [None, None, None], "op_g": [None, None, None], "opm": [None] * 4, "debt": [None] * 4,
           "roe": [None] * 3, "pbr": [None] * 3, "pfcf": [None] * 3, "dy": [None, None]}
    try:
        re_ = tk.revenue_estimate
        for i, k in enumerate(("0y", "+1y")):
            if re_ is not None and k in re_.index and re_.loc[k, "growth"] == re_.loc[k, "growth"]:
                out["sales_g"][i] = rnd(float(re_.loc[k, "growth"]) * 100, 1)
    except Exception:  # noqa: BLE001
        pass
    try:
        inc, bs = tk.income_stmt, tk.balance_sheet
        c0 = inc.columns[0]
        if _label(c0) == y - 1:
            rev, op = inc.loc["Total Revenue", c0], inc.loc["Operating Income", c0]
            out["opm"][0] = rnd(op / rev * 100, 1)
            liab = bs.loc["Total Liabilities Net Minority Interest", bs.columns[0]]
            eq = bs.loc["Stockholders Equity", bs.columns[0]]
            out["debt"][0] = rnd(liab / eq * 100, 0) if eq > 0 else None
            out["roe"][0] = rnd(inc.loc["Net Income", c0] / eq * 100, 1) if eq > 0 else None
    except Exception:  # noqa: BLE001
        pass
    info = tk.info
    if info.get("priceToBook"):
        out["pbr"][0] = rnd(info["priceToBook"], 2)
    if info.get("dividendRate"):
        out["dy"][0] = rnd(info["dividendRate"] / price * 100, 2)
    eps = lambda yy: (hist.get(yy) or {}).get("eps")  # noqa: E731
    out["per"] = [rnd(price / eps(v)) if (eps(v) or 0) > 0 else None for v in (y - 1, y, y + 1)]
    f_eps = C.fwd12(hist, "eps")
    per12 = price / f_eps if f_eps and f_eps > 0 else None
    # EPS 성장률: 작년 실적 → 28E 3년 연평균 (나스닥 추정이 없으면 내년까지 2년 연평균)
    eps_cagr = _cagr(eps(y + 2), eps(y - 1), 3) if eps(y + 2) else _cagr(eps(y + 1), eps(y - 1), 2)
    out.update({"per12": rnd(per12), "eps_cagr": eps_cagr, "peg": _peg(per12, eps_cagr), "dd52": _drawdown(px),
                "sales_cagr": None, "op_cagr": None, "us": True})
    return out
