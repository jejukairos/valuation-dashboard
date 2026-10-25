"""점수 체크리스트 (내 엑셀 '점수 체크리스트' 자동화) + 미국 '소몽 적정주가 템플릿'.
숫자로 매길 수 있는 항목은 자동, 나머지(비즈니스 모델 등)는 config/checklist.yaml 에 직접 적은 점수를 쓴다.
항목마다 10점 만점, 총점 = 받은 점수 ÷ (점수가 있는 항목 수 × 10) × 100."""
import statistics

import yfinance as yf

from common import load_yaml, now_kst, rnd

MANUAL = load_yaml("checklist.yaml") or {}


def yf_ticker(code, mkt):
    """야후 티커: 미국은 그대로, 한국은 코스피(.KS) → 코스닥(.KQ) 순으로 자료가 있는 쪽."""
    if mkt == "US":
        return code
    for suf in (".KS", ".KQ"):
        try:
            if not yf.Ticker(code + suf).quarterly_balance_sheet.empty:
                return code + suf
        except Exception:  # noqa: BLE001
            pass
    return None


def fin(tkr):
    """연간 재무제표 주요 줄 {키: [최근, 1년 전, 2년 전, …]} + 연도 목록."""
    tk = yf.Ticker(tkr)
    inc, bs, cf = tk.income_stmt, tk.balance_sheet, tk.cashflow
    pick = {"rev": (inc, "Total Revenue"), "gp": (inc, "Gross Profit"), "op": (inc, "Operating Income"),
            "ni": (inc, "Net Income"), "sga": (inc, "Selling General And Administration"),
            "rnd": (inc, "Research And Development"), "tax": (inc, "Tax Rate For Calcs"),
            "ca": (bs, "Current Assets"), "cl": (bs, "Current Liabilities"), "inv": (bs, "Inventory"),
            "ar": (bs, "Accounts Receivable"), "debt": (bs, "Total Debt"), "eq": (bs, "Stockholders Equity"),
            "liab": (bs, "Total Liabilities Net Minority Interest"), "cash": (bs, "Cash Cash Equivalents And Short Term Investments"),
            "cfo": (cf, "Operating Cash Flow"), "cfi": (cf, "Investing Cash Flow"), "cff": (cf, "Financing Cash Flow"),
            "fcf": (cf, "Free Cash Flow")}
    out = {"years": [c.year for c in inc.columns]}
    for k, (df, row) in pick.items():
        out[k] = [float(v) if v == v else None for v in df.loc[row].values] if row in df.index else []
    return out


def _at(f, k, i=0):
    s = f.get(k) or []
    return s[i] if len(s) > i else None


def _div(a, b):
    return a / b if (a is not None and b) else None


def _bucket(v, steps, default):
    """steps = [(기준, 점수), …] 위에서부터 v >= 기준이면 그 점수."""
    if v is None:
        return None
    for th, pt in steps:
        if v >= th:
            return pt
    return default


def _lower_better(v, steps, default):
    if v is None:
        return None
    for th, pt in steps:
        if v <= th:
            return pt
    return default


def checklist(code, c, tbl, f, per5_avg, pbr10_avg, psr):
    """c = 카드(가격·배수), tbl = 비교표 한 줄, f = 연간 재무제표. 반환: 섹션별 항목 목록과 총점."""
    m = MANUAL.get(code) or MANUAL.get(str(code)) or {}
    t = tbl or {}
    f = f or {}
    pct = lambda a, b: _div(a, b) * 100 if _div(a, b) is not None else None  # noqa: E731
    # 비율 지표들
    per_ratio = _div(t.get("per12"), per5_avg)
    pbr_now = (t.get("pbr") or [None, None])[1] or (t.get("pbr") or [None])[0]
    pbr_ratio = _div(pbr_now, pbr10_avg)
    dy = (t.get("dy") or [None])[0]
    net_margin = pct(_at(f, "ni"), _at(f, "rev"))
    sga_now, sga_old = pct(_at(f, "sga"), _at(f, "rev")), pct(_at(f, "sga", 2), _at(f, "rev", 2))
    rnd_r = pct(_at(f, "rnd"), _at(f, "rev"))
    debt_r = pct(_at(f, "liab"), _at(f, "eq"))
    cur_r = pct(_at(f, "ca"), _at(f, "cl"))
    quick_r = pct((_at(f, "ca") or 0) - (_at(f, "inv") or 0), _at(f, "cl")) if _at(f, "ca") is not None else None
    ar_g = _div(_at(f, "ar"), _at(f, "ar", 1))
    rev_g = _div(_at(f, "rev"), _at(f, "rev", 1))
    ar_gap = (ar_g - rev_g) * 100 if (ar_g and rev_g) else None
    cfo_ni = _div(_at(f, "cfo"), _at(f, "ni")) if (_at(f, "ni") or 0) > 0 else None
    fcfs = [v for v in (f.get("fcf") or [])[:3] if v is not None]
    cfo, cfi, cff = _at(f, "cfo"), _at(f, "cfi"), _at(f, "cff")

    def fcf_trend():
        if len(fcfs) < 2:
            return None
        if all(v > 0 for v in fcfs):
            return 10 if fcfs[0] >= fcfs[-1] else 8
        return 5 if fcfs[0] > 0 else 2

    def cf_pattern():
        if None in (cfo, cfi, cff):
            return None, ""
        s = lambda v: "+" if v >= 0 else "−"  # noqa: E731
        pat = f"영업{s(cfo)} 투자{s(cfi)} 재무{s(cff)}"
        if cfo < 0:
            return 2, pat + " (본업에서 현금이 빠져나감)"
        if cfi < 0 and cff < 0:
            return 10, pat + " (번 돈으로 투자하고 빚 갚음·주주환원)"
        if cfi < 0:
            return 7, pat + " (번 돈 + 차입·증자로 투자)"
        return 6, pat + " (투자 회수로 빚 갚음)"

    pat_pt, pat_txt = cf_pattern()
    f1 = lambda v, d=1, u="": "-" if v is None else f"{v:,.{d}f}{u}"  # noqa: E731
    sec = [
        ("비즈니스 모델 (직접 입력)", [
            ("산업에서 1위(또는 1위가 될) 기업인가", m.get("rank"), "직접 입력"),
            ("독점적인 제품·서비스가 있는가", m.get("moat"), "직접 입력"),
            ("향후 몇 년간 매출이 늘 잠재력", m.get("growth"), "직접 입력"),
            ("산업 시장 규모가 커지는가", m.get("market"), "직접 입력"),
            ("경쟁 강도 (치열할수록 낮게)", m.get("competition"), "직접 입력"),
        ]),
        ("가치평가", [
            ("PER: 12MF PER ÷ 5년 평균", _lower_better(per_ratio, [(0.7, 10), (0.85, 8), (1.0, 7), (1.15, 5), (1.3, 3)], 1),
             f"{f1(t.get('per12'))}배 ÷ {f1(per5_avg)}배 = {f1(per_ratio, 2)}"),
            ("PSR: 시가총액 ÷ 올해 예상 매출", _lower_better(psr, [(1, 10), (2, 8), (4, 7), (8, 5), (15, 3)], 1), f"{f1(psr)}배"),
            ("PBR: 올해 PBR ÷ 10년 평균", _lower_better(pbr_ratio, [(0.7, 10), (0.85, 8), (1.0, 7), (1.15, 5), (1.3, 3)], 1),
             f"{f1(pbr_now, 2)}배 ÷ {f1(pbr10_avg, 2)}배 = {f1(pbr_ratio, 2)}"),
            ("PEG (12MF PER ÷ EPS 성장률)", None if c.get("cyclical") else _lower_better(t.get("peg"), [(0.5, 10), (1, 8), (1.5, 6), (2, 4), (3, 2)], 1),
             "이익이 출렁이는 업종이라 제외" if c.get("cyclical") else f1(t.get("peg"), 2)),
            ("배당 수익률 (올해 예상)", _bucket(dy, [(5, 10), (3, 8), (2, 6), (1, 4), (0.01, 2)], 0), f1(dy, 2, "%")),
        ]),
        ("손익계산서", [
            ("매출 성장 (3년 연평균)", _bucket(t.get("sales_cagr"), [(30, 10), (20, 9), (15, 8), (10, 7), (5, 6), (0, 4)], 2), f1(t.get("sales_cagr"), 1, "%")),
            ("순이익 성장 (EPS 3년 연평균)", _bucket(t.get("eps_cagr"), [(30, 10), (20, 9), (15, 8), (10, 7), (5, 6), (0, 4)], 2), f1(t.get("eps_cagr"), 1, "%")),
            ("매출 규모가 동종 업계 대비 좋은가", m.get("sales_scale"), "직접 입력"),
            ("순이익률 (최근 연간)", _bucket(net_margin, [(30, 10), (20, 9), (15, 8), (10, 7), (5, 5), (0.01, 3)], 1), f1(net_margin, 1, "%")),
            ("판관비율 (3년 전보다)", None if sga_now is None or sga_old is None else
             _lower_better(sga_now - sga_old, [(-1, 10), (1, 8), (3, 6)], 4), f"{f1(sga_old)}% → {f1(sga_now)}%"),
            ("R&D 비율 (매출 대비)", _bucket(rnd_r, [(10, 10), (5, 8), (2, 6), (0.01, 5)], None) if rnd_r is not None else m.get("rnd"),
             f1(rnd_r, 1, "%") if rnd_r is not None else "자료 없음 · 직접 입력"),
        ]),
        ("재무상태표", [
            ("부채비율 (부채 ÷ 자본)", _lower_better(debt_r, [(50, 10), (100, 8), (200, 6), (400, 4)], 1), f1(debt_r, 0, "%")),
            ("유동비율 (100% 이상 좋음)", _bucket(cur_r, [(200, 10), (150, 9), (100, 7), (80, 4)], 2), f1(cur_r, 0, "%")),
            ("당좌비율 (재고 뺀 유동비율)", _bucket(quick_r, [(150, 10), (100, 8), (80, 5)], 2), f1(quick_r, 0, "%")),
            ("매출채권 증가율 − 매출 증가율", _lower_better(ar_gap, [(10, 10), (20, 7), (40, 4)], 2),
             f"{f1(ar_gap, 0)}%p (매출보다 채권이 너무 빨리 늘면 주의)"),
        ]),
        ("현금흐름표", [
            ("영업현금흐름 ÷ 순이익", _bucket(cfo_ni, [(1.0, 10), (0.8, 8), (0.5, 5)], 2), f1(cfo_ni, 2, "배")),
            ("잉여현금흐름(FCF) 추이 (3년)", fcf_trend(), " → ".join(f"{v / 1e12:,.1f}조" if abs(v) >= 1e11 else f"{v / 1e8:,.0f}억" for v in reversed(fcfs)) if c.get("currency") != "USD" else
             " → ".join(f"${v / 1e9:,.1f}B" for v in reversed(fcfs))),
            ("현금흐름 구조", pat_pt, pat_txt),
        ]),
    ]
    out, got, mx = [], 0, 0
    for name, items in sec:
        rows = [{"item": a, "pt": p, "why": w} for a, p, w in items]
        s = [r["pt"] for r in rows if r["pt"] is not None]
        got += sum(s)
        mx += 10 * len(s)
        out.append({"name": name, "rows": rows, "got": sum(s), "max": 10 * len(s)})
    return {"sections": out, "total": rnd(got / mx * 100, 1) if mx else None, "got": got, "max": mx,
            "manual": bool(m), "memo": m.get("memo")}


def somong(hist, price, lt_growth):
    """내 엑셀 '소몽의 적정주가 템플릿': 성장률 × 100~200(보통) / 150~250(강세장) = 적정 PER, × 올해 EPS."""
    y = now_kst().year
    years = list(range(y - 5, y + 3))
    eps = {yy: (hist.get(yy) or {}).get("eps") for yy in years}
    gr = {yy: (eps[yy] / eps[yy - 1] - 1) if (eps.get(yy) and eps.get(yy - 1) and eps[yy - 1] > 0) else None for yy in years[1:]}
    med = [gr[yy] for yy in range(y - 3, y + 2) if gr.get(yy) is not None]  # 엑셀: MEDIAN(23~27년 성장률)
    g = statistics.median(med) if med else None
    e0 = eps.get(y)

    def case(gg):
        if not gg or gg <= 0 or not e0 or e0 <= 0:
            return None
        m = {"base_lo": gg * 100, "base_hi": gg * 200, "bull_lo": gg * 150, "bull_hi": gg * 250}
        p = {k: v * e0 for k, v in m.items()}
        return {"growth": rnd(gg * 100, 1), "mult": {k: rnd(v, 1) for k, v in m.items()}, "price": {k: rnd(v, 2) for k, v in p.items()},
                "up_cons": rnd((p["base_hi"] / price - 1) * 100, 1), "up_bull": rnd((p["bull_hi"] / price - 1) * 100, 1)}
    return {"years": [f"{str(v)[2:]}{'E' if (hist.get(v) or {}).get('estimate') else ''}" for v in years],
            "eps": [eps[v] for v in years], "growth": [None] + [rnd(gr[v] * 100, 1) if gr.get(v) is not None else None for v in years[1:]],
            "cur_mult": rnd(price / e0, 1) if e0 and e0 > 0 else None, "eps_now": e0,
            "default": case(g), "adjusted": case(lt_growth / 100 if lt_growth else None), "lt_growth": lt_growth}


def us_extra(f, cap):
    """엑셀 '간단 벨류'에서 기존 화면에 없던 것: GPM 3년, ROIC, FCF 3년 (야후 연간 실적, 한국·미국 공통)."""
    if not f:
        return {}
    ys = f.get("years") or []
    gpm = [rnd(_div(_at(f, "gp", i), _at(f, "rev", i)) * 100, 1) if _div(_at(f, "gp", i), _at(f, "rev", i)) is not None else None for i in range(3)]
    op, tax, debt, eq, cash = _at(f, "op"), _at(f, "tax") or 0.21, _at(f, "debt") or 0, _at(f, "eq"), _at(f, "cash") or 0
    ic = (debt + eq - cash) if eq else None
    roic = rnd(op * (1 - tax) / ic * 100, 1) if (op and ic and ic > 0) else None
    return {"fy": [str(v)[2:] for v in ys[:3]], "gpm": gpm, "roic": roic,
            "fcf3": [rnd(v, 0) if v is not None else None for v in (f.get("fcf") or [])[:3]]}  # 원 또는 달러 그대로
