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
    lease = get("Capital Lease Obligations") or 0.0
    xl = nc + lease  # 리스 부채는 빼고 (회사가 어닝콜에서 말하는 '부채' 기준)
    ce = get("Cash And Cash Equivalents")
    ce = ce if ce is not None and ce <= cash else cash
    # 🏦 빚 조달 추적: 분기말 총차입금(회사채·대출·리스) 잔액, 야후가 주는 5~6분기
    dq = {str(k.date()): float(v) for k, v in bs.loc["Total Debt"].items() if v == v} if "Total Debt" in bs.index else {}
    # 💵 현금 창고 그림용 (그 나라 돈 그대로): 현금·현금성 / 단기투자 / 총차입금(리스 포함) / 리스
    return {"net_cash": nc, "net_cash_pct": rnd(nc / cap * 100, 1) if cap else None, "net_cash_asof": c.strftime("%Y-%m"),
            "net_cash_xl": xl, "net_cash_xl_pct": rnd(xl / cap * 100, 1) if cap else None,
            "cash_raw": {"cash": ce, "sti": cash - ce, "debt": debt, "lease": lease, "debt_q": dq}}


def _peg(per12, eps_cagr):
    return rnd(per12 / eps_cagr, 2) if (per12 and per12 > 0 and eps_cagr and eps_cagr > 0) else None


def peg_kr(w, price, y, per12=None):
    """🇰🇷 PEG (사용자 11/18 "한국은 PEG 왜곡이 심함") = 내년 예상 PER ÷ 앞으로 성장률. (PEG, 근거) 를 돌려줌.
    성장률 = 영업이익·EPS 연평균 중 낮은 쪽 — 환차손·일회성으로 순이익만 튀면 둘이 벌어지니 덜 부풀린 쪽.
    구간 = 작년 실적 → 내후년 3년. 첫해가 +50% 넘게 뛰었거나 작년이 적자면 올해 → 내후년 2년 (뻥튀기 방지)."""
    lab = lambda yy: f"{str(yy)[2:]}{'' if yy < y else 'E'}"  # noqa: E731
    e1 = w(y + 1, "eps")
    per = price / e1 if (e1 or 0) > 0 else None
    end = y + 2 if (w(y + 2, "eps") or w(y + 2, "op")) else y + 1

    def jumped(k):
        a, b = w(y, k), w(y - 1, k)
        return a is not None and b is not None and (b <= 0 or a / b - 1 > 0.5)

    start = y if (jumped("op") or jumped("eps")) else y - 1
    cg = {k: _cagr(w(end, k), w(start, k), end - start) for k in ("op", "eps")}
    if start == y - 1 and not any(v is not None for v in cg.values()):  # 작년 숫자가 없으면 올해부터
        start, cg = y, {k: _cagr(w(end, k), w(y, k), end - y) for k in ("op", "eps")}
    cands = [(v, k) for k, v in cg.items() if v is not None]
    if not per or not cands:
        return None, None
    g, by = min(cands)
    alt = max(cands) if len(cands) == 2 else None  # 다른 쪽(높은 쪽) 기준이면 얼마인지도 같이 — 화면에 '○○ 기준이면'
    flags = ((["gap"] if len(cands) == 2 and abs(cg["op"] - cg["eps"]) > 10 else []) + (["big"] if g > 50 else [])
             + (["per"] if per12 and abs(per / per12 - 1) > 0.3 else []))
    return (rnd(per / g, 2) if g > 0 else None), {
        "per": rnd(per, 2), "per_y": lab(y + 1), "per12": rnd(per12, 2) if per12 else None, "g": g, "by": {"op": "영업이익", "eps": "EPS"}[by],
        "win": f"{lab(start)}→{lab(end)}", "n": end - start, "op": cg["op"], "eps": cg["eps"], "jump": start == y, "flags": flags,
        "alt": {"by": {"op": "영업이익", "eps": "EPS"}[alt[1]], "g": alt[0], "peg": rnd(per / alt[0], 2)} if alt and alt[0] > 0 and alt[0] != g else None}


def peg_us(hist, price, y, per12, ltg_cmp, my_per=None):
    """🇺🇸 PEG (사용자 11/18) = 내년 예상 PER ÷ 3~5년 EPS 성장률 — 시킹알파 먼저, 없으면 Finviz → Zacks → 나스닥.
    출처별 성장률·PEG 와 내가 정한 성장률(somong.yaml my_per)도 같이, 시킹알파와 Finviz 가 5%p 넘게 다르면 flags 에 gap."""
    e1 = (hist.get(y + 1) or {}).get("eps")
    per, per_y = (price / e1, f"{str(y + 1)[2:]}E") if (e1 or 0) > 0 else (per12, "12MF")
    if not per or per <= 0:
        return None, None
    src = {str(k).split("(")[0]: v for k, v in (ltg_cmp or [])}
    rows = [[k, rnd(src.get(k), 1), rnd(per / src[k], 2) if (src.get(k) or 0) > 0 else None] for k in ("시킹알파", "Finviz", "Zacks", "나스닥")]
    if my_per and my_per > 0:
        rows.append(["내가 정한", my_per, rnd(per / my_per, 2)])
    use = next((r for r in rows[:4] if r[2] is not None), None)
    if not use:
        return None, None
    sa, fv = src.get("시킹알파"), src.get("Finviz")
    flags = ((["gap"] if sa and fv and abs(sa - fv) > 5 else []) + (["big"] if use[1] > 50 else [])
             + (["per"] if per12 and abs(per / per12 - 1) > 0.3 else []))
    return use[2], {"per": rnd(per, 2), "per_y": per_y, "per12": rnd(per12, 2) if per12 else None, "g": use[1], "by": use[0], "srcs": rows, "flags": flags}


def _selftest():  # python collector/table.py
    y = 2026
    W = lambda d: (lambda yy, k: (d.get(yy) or {}).get(k))  # noqa: E731
    p, h = peg_kr(W({y - 1: {"op": 100, "eps": 100}, y: {"op": 120, "eps": 130}, y + 1: {"op": 144, "eps": 169}, y + 2: {"op": 172.8, "eps": 219.7}}), 1690, y, 10.5)
    assert (p, h["win"], h["by"], h["g"], h["flags"], h["alt"]["peg"]) == (0.5, "25→28E", "영업이익", 20.0, [], 0.33), (p, h)  # 3년 · 낮은 쪽
    p, h = peg_kr(W({y - 1: {"op": 10, "eps": -5}, y: {"op": 100, "eps": 100}, y + 1: {"op": 150, "eps": 200}, y + 2: {"op": 225, "eps": 220}}), 2000, y, 10)
    assert h["jump"] and h["n"] == 2 and (h["by"], h["g"]) == ("EPS", 48.3), (p, h)  # 작년 적자·첫해 급증 → 올해부터 2년
    p, h = peg_kr(W({y: {"op": 100, "eps": 100}, y + 1: {"op": 90, "eps": 80}}), 800, y)
    assert p is None and h["g"] < 0 and h["n"] == 1, (p, h)  # 감익이면 PEG 없음
    p, h = peg_us({y + 1: {"eps": 10}}, 200, y, 21, [["시킹알파", 20], ["Zacks", 18], ["Finviz", 26], ["나스닥(내 계산)", None]], 25)
    assert (p, h["by"], h["flags"], h["srcs"][-1]) == (1.0, "시킹알파", ["gap"], ["내가 정한", 25, 0.8]), (p, h)
    p, h = peg_us({y + 1: {"eps": 10}}, 200, y, 21, [["시킹알파", None], ["Zacks", 18], ["Finviz", 25], ["나스닥(내 계산)", 30]])
    assert (p, h["by"]) == (0.8, "Finviz"), (p, h)  # 시킹알파 없으면 Finviz
    assert peg_us({}, 200, y, 21, []) == (None, None)
    print("table.py PEG 자체 점검 통과")


def kr_row(wise, hist, price, cap, px, own_cap=True):
    """own_cap=False: 우선주처럼 실적이 다른 코드 기준이면 시총으로 나누는 P/FCF 는 비움."""
    y = now_kst().year
    w = lambda yy, k: (wise.get(yy) or {}).get(k)  # noqa: E731
    ys = [y - 1, y, y + 1, y + 2]
    lab = lambda yy: f"{str(yy)[2:]}{'' if yy < y else 'E'}"  # noqa: E731
    per12 = C.per12(price, hist)
    eps_cagr = _cagr(w(y + 2, "eps"), w(y - 1, "eps"), 3)
    peg, peg_how = peg_kr(w, price, y, per12)
    return {
        "years": [lab(v) for v in ys],
        "sales_g": [_g(w(v, "sales"), w(v - 1, "sales")) for v in ys[1:]],
        "op_g": [_g(w(v, "op"), w(v - 1, "op")) for v in ys[1:]],
        "eps_g": [_g(w(v, "eps"), w(v - 1, "eps")) for v in ys[1:]],  # 해마다 EPS 증가율 25→26E·26E→27E·27E→28E (사용자 11/18)
        "sales_cagr": _cagr(w(y + 2, "sales"), w(y - 1, "sales"), 3),
        "op_cagr": _cagr(w(y + 2, "op"), w(y - 1, "op"), 3),
        "eps_cagr": eps_cagr,
        "per12": rnd(per12),
        "peg": peg, "peg_how": peg_how,
        "opm": [rnd(w(v, "opm"), 1) for v in ys],
        # 25 = 그해 말 주가 기준(와이즈리포트 값), 26E·27E = 지금 주가 ÷ 추정 EPS·BPS
        # 사용자 11/28 "밸류·재무도 28E 까지 다": PER·PBR·ROE·배당·PSR·예상 FCF 를 28E 까지 (칸 순서 = years · 배당·PSR·예상 FCF 는 26E 부터)
        "per": [w(y - 1, "per")] + [rnd(price / w(v, "eps")) if (w(v, "eps") or 0) > 0 else None for v in (y, y + 1, y + 2)],
        "pbr": [w(y - 1, "pbr")] + [rnd(price / w(v, "bps"), 2) if (w(v, "bps") or 0) > 0 else None for v in (y, y + 1, y + 2)],
        "roe": [rnd(w(v, "roe"), 1) for v in ys],
        "roa": [rnd(w(v, "roa"), 1) for v in ys],  # 순이익 ÷ 총자산 — ROE 와 비슷하면 빚이 적음 (사용자 11/28)
        "dy_last": rnd(w(y - 1, "dps") / price * 100, 2) if w(y - 1, "dps") is not None and price else None,  # 작년에 실제 준 배당 ÷ 지금 주가 (예상 칸과 차이 = 특별배당·증액 기대)
        "debt": [rnd(w(v, "debt"), 0) for v in ys],
        "dd52": _drawdown(px),
        "dy": [rnd(w(v, "dps") / price * 100, 2) if w(v, "dps") is not None else None for v in (y, y + 1, y + 2)],
        "psr_y": [rnd(cap / (w(v, "sales") * 1e8), 2) if (own_cap and cap and (w(v, "sales") or 0) > 0) else None for v in ys[1:]],  # 시가총액 ÷ 그해 예상 매출(억원)
        "fcf_e": [w(v, "fcf") * 1e8 if w(v, "fcf") is not None else None for v in ys[1:]],  # 예상 잉여현금흐름 (원)
        # P/FCF = 지금 시가총액 ÷ 잉여현금흐름(억원) — 버핏이 말하는 '주주 몫 이익'에 가까운 현금 기준 배수 (25 = 확정 실적)
        "pfcf": [rnd(cap / (w(v, "fcf") * 1e8), 1) if (own_cap and cap and (w(v, "fcf") or 0) > 0) else None for v in ys],
    }


def us_row(code, hist, price, cap, px, ltg_cmp=None, my_per=None):
    """야후에서 받을 수 있는 것만: 매출 추정 성장률(올해·내년), 최근 연간 실적 기준 OPM·부채비율·P/FCF, PER·배당.
    ltg_cmp = 3~5년 성장률 출처 비교 [[시킹알파, %], [Zacks, %], …] · my_per = 내가 정한 성장률 → PEG (peg_us)."""
    import yfinance as yf

    from us_stock import _label
    tk = yf.Ticker(code)
    y = now_kst().year
    out = {"years": [f"{str(y - 1)[2:]}", f"{str(y)[2:]}E", f"{str(y + 1)[2:]}E", f"{str(y + 2)[2:]}E"],
           "sales_g": [None, None, None], "op_g": [None, None, None], "opm": [None] * 4, "debt": [None] * 4,
           "roe": [None] * 3, "pbr": [None] * 3, "pfcf": [None] * 4, "dy": [None, None]}
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
            ta = bs.loc["Total Assets", bs.columns[0]] if "Total Assets" in bs.index else None
            out["roa"] = [rnd(inc.loc["Net Income", c0] / ta * 100, 1) if ta and ta > 0 else None]  # 미국은 확정 연간만 (예상 총자산은 무료 자료 없음)
    except Exception:  # noqa: BLE001
        pass
    info = tk.info
    if info.get("priceToBook"):
        out["pbr"][0] = rnd(info["priceToBook"], 2)
    if info.get("dividendRate"):
        out["dy"][0] = rnd(info["dividendRate"] / price * 100, 2)
    eps = lambda yy: (hist.get(yy) or {}).get("eps")  # noqa: E731
    out["per"] = [rnd(price / eps(v)) if (eps(v) or 0) > 0 else None for v in (y - 1, y, y + 1, y + 2)]  # 28E 까지 (사용자 11/28)
    per12 = C.per12(price, hist)
    # EPS 성장률: 작년 실적 → 28E 3년 연평균 (나스닥 추정이 없으면 내년까지 2년 연평균)
    eps_cagr = _cagr(eps(y + 2), eps(y - 1), 3) if eps(y + 2) else _cagr(eps(y + 1), eps(y - 1), 2)
    out["eps_g"] = [_g(eps(v), eps(v - 1)) for v in (y, y + 1, y + 2)]  # 미국은 영업이익 추정이 없어 EPS 증가율만
    peg, peg_how = peg_us(hist, price, y, per12, ltg_cmp, my_per)
    if peg_how is None:  # 성장률 출처가 하나도 없거나 PER 을 못 구하면 예전 방식 (12MF PER ÷ 컨센서스 EPS 연평균)
        peg = _peg(per12, eps_cagr)
    out.update({"per12": rnd(per12), "eps_cagr": eps_cagr, "peg": peg, "peg_how": peg_how, "dd52": _drawdown(px),
                "sales_cagr": None, "op_cagr": None, "us": True})
    return out


if __name__ == "__main__":
    _selftest()
