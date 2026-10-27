"""매일 실행: 수집 → 계산 → site/data/*.json 저장.
실패한 항목은 직전 값을 그대로 쓰고 '실패 목록'에 남긴다."""
import os
import sys
import traceback

import pandas as pd

import compute as C
import kq
import kr_stock
import manheim
import market
import rates
import score
import street
import table
import us_stock
from common import CACHE, DATA, REPORT, SETTINGS, attempt, load_yaml, now_kst, read_json, rnd, write_json

SECTORS = load_yaml("sectors.yaml") or {}
SOMONG = load_yaml("somong.yaml") or {}
LTG_GAP = read_json(CACHE / "ltg_gap.json") or {}
QTRS = read_json(CACHE / "quarters.json") or {}  # 분기 실적 (야후는 최근 5~6분기만 줘서 쌓아 둠)  # 종목 → 시킹알파 확인일 → Zacks·나스닥과의 차이(%p)


def keep_prev(new, prev, label):
    """새 값이 없으면 직전 값을 쓰고 '이전 데이터' 표시."""
    if new:
        return new
    if prev:
        p = dict(prev)
        p["stale"] = True
        print(f"  ↺ {label}: 직전 데이터 사용")
        return p
    return None


def asof_series(hist):
    s = pd.Series({pd.Timestamp(d): v for d, v in hist})
    return s.sort_index()


def market_signal(name, per, per_label, per_source, rate, rate_label):
    if per is None or rate is None:
        return {"name": name, "signal": "na", "reason": "PER 또는 금리 데이터 없음"}
    bond_per = 100 / rate
    ratio = per / bond_per
    return {"name": name, "per": rnd(per), "per_label": per_label, "per_source": per_source,
            "rate": rnd(rate, 3), "rate_label": rate_label, "bond_per": rnd(bond_per),
            "ratio": rnd(ratio, 3), "signal": C.bond_signal(ratio),
            "earnings_yield": rnd(100 / per), "premium": rnd(100 / per - rate)}


def premium_hist(per_hist, rate_hist):
    if not per_hist or not rate_hist:
        return []
    r = asof_series(rate_hist)
    out = []
    for d, pe in per_hist:
        ts = pd.Timestamp(d)
        if ts < r.index[0] or not pe:
            continue
        rv = r[:ts].iloc[-1]
        out.append([d, round(100 / pe - rv, 2)])
    return out


def _basis_text(names, ey, mkey):
    """화면에 짧고 자연스럽게: '27E EPS × 10년 평균 PER' 처럼."""
    if not names:
        return ""
    if names == ["배당"]:
        return "올해 배당금 ÷ 10년 평균 배당수익률"
    span = {"avg5": "5년 평균", "avg10": "10년 평균", "low10": "10년 하단", "high10": "10년 상단"}[mkey]
    base = {"PER": "EPS", "PBR": "BPS"}
    parts = [f"{ey} {base[n]} × {span} {n}" for n in names if n in base]
    return parts[0] if len(parts) == 1 else "두 값 평균: " + " / ".join(parts)


def usdkrw():
    import yfinance as yf
    h = yf.Ticker("KRW=X").history(period="5d")["Close"].dropna()
    if h.empty:
        raise RuntimeError("환율 데이터 없음")
    return round(float(h.iloc[-1]), 2)


def stock_detail(h, rates_now, fx):
    """한국·미국 종목 공통: 가격·실적을 받아 밴드·적정가·신호를 계산."""
    code = str(h["code"])
    name = h["name"]
    mkt = h.get("market", "KR").upper()
    methods = [m.upper() for m in h.get("methods", ["PER"])]
    if mkt == "US":
        now = us_stock.now_info(code)
        px = us_stock.price_history(code)
        hist = us_stock.history(code)
        wise = None
        rate, bond_label, currency = rates_now.get("us10y"), "미국채 10년", "USD"
        sources = {"price": "야후 파이낸스", "consensus": "야후 파이낸스 컨센서스",
                   "history": next((r["src"] for r in hist.values() if not r.get("estimate")), "")}
    else:
        now = kr_stock.naver_now(code)
        px = kr_stock.price_history(code)
        # 우선주처럼 실적은 보통주 자료를 쓰는 경우 (data_code)
        hist, wise = kr_stock.merged_history(str(h.get("data_code") or code), h.get("splits") or [])
        rate, bond_label, currency = rates_now.get("kr3y"), "국고채 3년", "KRW"
        sources = {"price": "네이버 증권", "consensus": "와이즈리포트(네이버 종목분석)",
                   "history": "OpenDART 사업보고서 + 와이즈리포트"}
        if h.get("data_code"):
            sources["history"] += f" (실적·배당은 보통주 {h['data_code']} 기준)"
    rate_kr3y = rate
    price = now.get("price") or float(px.iloc[-1])
    pw = C.weekly_close(px)
    bands = {}
    for key, label in (("eps", "PER"), ("bps", "PBR"), ("dps", "DIV")):
        if label in methods or (label == "PBR" and "PER" in methods):
            basis = h.get("per_basis") or SETTINGS["band"].get("per_basis", "trailing")
            shift = 1 if (key == "eps" and basis == "forward") else 0
            b = C.build_band(pw, hist, key, invert=(key == "dps"), shift=shift)
            if b:
                bands[label] = b
    cap_krw = now.get("market_cap") * fx if (currency == "USD" and now.get("market_cap") and fx) else now.get("market_cap")
    det = {"name": name, "code": code, "market": mkt, "methods": methods, "price": price,
           "price_date": px.index[-1].strftime("%Y-%m-%d"), "market_cap": cap_krw,
           "market_cap_usd": now.get("market_cap") if currency == "USD" else None, "fx": fx if currency == "USD" else None,
           "currency": currency, "now": now, "note": h.get("note", ""),
           "avg_price": h.get("avg_price"), "quantity": h.get("quantity"),
           "history": [{"year": y, **{k: (rnd(v, 2) if isinstance(v, float) else v) for k, v in r.items()}}
                       for y, r in sorted(hist.items())],
           "bands": bands, "sources": sources}
    fairs = []
    fm = [x.upper() for x in (h.get("fair_methods") or methods)]  # 적정가에 쓸 방식 (사이클 업종은 PBR 만)
    ey = SETTINGS["fair_value"]["eps_year"]
    if ey == "auto":  # 올해(밴드 배수가 쓰는 해) 실적 기준 → 지금 주가와 같은 시점끼리 비교
        ey = f"{now_kst().year % 100}E"
    mkey = SETTINGS["fair_value"]["multiple"]
    yr = 2000 + int(ey[:2])
    pick = {"avg5": ("5y", "avg"), "avg10": ("10y", "avg"), "low10": ("10y", "low"), "high10": ("10y", "high")}[mkey]

    def mult(label):
        b = bands.get(label)
        p = (b or {}).get("periods", {}).get(pick[0]) or (b or {}).get("periods", {}).get("all")
        return (p or {}).get(pick[1])

    if "PER" in methods and "PER" in bands:
        det["per"] = C.per_section(price, hist, bands["PER"])
        e = hist.get(yr, {}).get("eps")
        if e and mult("PER") and "PER" in fm:
            fairs.append(("PER", e * mult("PER")))
    if "PBR" in methods and "PBR" in bands:
        det["pbr"] = C.pbr_section(price, hist, bands["PBR"], rate_kr3y)
        b = hist.get(yr, {}).get("bps")
        if b and mult("PBR") and "PBR" in fm:
            fairs.append(("PBR", b * mult("PBR")))
    if "DIV" in methods and "DIV" in bands:
        det["div"] = C.div_section(price, hist, bands["DIV"], rate_kr3y)
        if methods == ["DIV"]:
            d = hist.get(now_kst().year, {}).get("dps")
            y10 = (bands["DIV"]["periods"].get("10y") or {}).get("avg")
            if d and y10:
                fairs.append(("배당", d / (y10 / 100)))
    fair = sum(v for _, v in fairs) / len(fairs) if fairs else None
    # 적정가 = Bear/Base/Bull 의 Base (12MF 실적 × 업종 배수 또는 10년 밴드 배수). 배당만 보는 종목은 위 값 그대로
    # 성장률 방식 적정 PER (내 엑셀 템플릿). 보정값: 미국 = 시킹알파 3~5Y CAGR(직접 입력), 한국 = 컨센서스 앞으로 3년 EPS 성장률
    y0 = now_kst().year
    fv5 = ltg = None
    ests = sorted(yy for yy, r in hist.items() if r.get("estimate") and r.get("eps"))
    e_now = (hist.get(y0) or {}).get("eps")
    if ests and ests[-1] > y0 and e_now and e_now > 0 and (hist[ests[-1]].get("eps") or 0) > 0:
        ltg = ((hist[ests[-1]]["eps"] / e_now) ** (1 / (ests[-1] - y0)) - 1) * 100
    if mkt == "US":
        try:
            fv5 = us_stock.finviz_eps_5y(code)
        except Exception as e:  # noqa: BLE001
            REPORT.block("Finviz", f"EPS next 5Y 접속 실패 ({str(e)[:50]})")
        # 엑셀 ② 보정값 = 시킹알파 Growth 탭 'EPS FWD Long Term Growth (3-5Y CAGR)': somong.yaml my.sa_ltg 에 적은 값.
        # shortcut: 자동 수집은 시킹알파가 막아서 직접 입력, 비어 있으면 나스닥 컨센서스 연평균으로 임시 대신
        my = ((SOMONG.get(code) or {}).get("my") or {})
        try:
            zk = us_stock.zacks_ltg(code)
        except Exception as e:  # noqa: BLE001
            zk = None
            REPORT.block("Zacks", f"Next 5 Years 접속 실패 ({str(e)[:50]})")
        # 3~5년 성장률 출처 비교 (시킹알파 기준으로 얼마나 다른지 화면에 표시)
        ltg_cmp = [["시킹알파", my.get("sa_ltg")], ["Zacks", zk], ["Finviz", fv5], ["나스닥(내 계산)", rnd(ltg, 1) if ltg else None]]
        sa, sa_d = my.get("sa_ltg"), str(my.get("sa_ltg_date") or "")
        sa_age = (now_kst().date() - pd.Timestamp(sa_d).date()).days if sa_d else 999
        # 시킹알파 값을 넣을 때마다 그날의 Zacks·나스닥과의 차이를 기록 → 값이 오래되면 평소 더 가까웠던 쪽으로 대체
        subs = {"Zacks": zk, "나스닥": ltg}
        hist_gap = LTG_GAP.setdefault(code, {})
        if sa and sa_age <= 90:
            hist_gap[sa_d] = {k: rnd(v - float(sa), 2) for k, v in subs.items() if v is not None}
        avg_gap = {k: sum(abs(g[k]) for g in hist_gap.values() if k in g) / n
                   for k in subs if (n := sum(1 for g in hist_gap.values() if k in g))}
        best = min((k for k in avg_gap if subs[k] is not None), key=avg_gap.get, default=None)
        ltg_note = (f"시킹알파와 평소 차이 (확인 {len(hist_gap)}번 평균): " + " · ".join(f"{k} ±{v:.1f}%p" for k, v in avg_gap.items())
                    + (f" → 시킹알파가 오래되면 {best} 로 대체" if best and avg_gap[best] <= 5 else " → 둘 다 5%p 넘게 달라 대체하지 않음")) if avg_gap else None
        if sa and sa_age > 90 and best and avg_gap[best] <= 5:
            ltg = subs[best]
            adj = [(ltg, f"{best} {ltg:.1f}% — 시킹알파 값이 {sa_age}일 지나 대체 (평소 차이 ±{avg_gap[best]:.1f}%p)")]
        elif sa:
            ltg = float(sa)
            adj = [(ltg, f"시킹알파 EPS FWD Long Term Growth (3-5Y CAGR), {sa_d or '날짜 미기록'} 입력" + (" — 오래된 값" if sa_age > 90 else ""))]
        else:
            adj = [(ltg, f"시킹알파 값 미입력 → 임시로 나스닥 컨센서스 {C.ylabel(y0)}→{C.ylabel(ests[-1])} EPS 연평균")] if ltg and ltg > 0 else [(fv5, "Finviz EPS next 5Y")]
    else:
        # 한국은 시킹알파 같은 3~5년 성장률이 없어 네이버·에프앤가이드 컨센서스(증권사 추정 합산) 앞으로 3년 EPS 성장률
        cg = C.cons_growth(hist, y0)
        ltg = cg[0] if cg else None
        adj = [cg or (None, "")]
    pg = C.growth_fair(hist, adj) if ("PER" in fm and "PER" in bands) else None
    sec_name = h.get("sector") if h.get("fair_mode") == "sector" else None  # 업종 배수는 fair_mode: sector 로 고른 종목만
    sec = dict(SECTORS[sec_name], name=sec_name) if sec_name in SECTORS else None
    if pg:  # Bear 는 바닥 PER, Base·Bull 은 업종이 받아 본 PER 까지만 (sectors.yaml)
        pg["raw"] = dict(pg["mult"])
        pg["mult"], pg["limit"] = C.floor_cap(pg["mult"], bands.get("PER"), SECTORS.get(h.get("sector")), h.get("sector"))
    scen = C.scenarios(price, hist, bands, [k for k in ("PER", "PBR") if k in fm and k in bands], sec, per_growth=pg)
    if scen and pg:
        scen["growth"] = pg
        e27 = (hist.get(y0 + 1) or {}).get("eps")
        scen["e27"] = {"eps": e27, **{k: rnd(e27 * v, 2) for k, v in pg["mult"].items()}} if e27 and e27 > 0 else None
        # 쓴 성장률과 다른 쪽(기본값↔보정값)이 2배 넘게 차이 나면, 다른 쪽으로 계산한 12MF 적정주가도 같이 (PER 만 보는 종목)
        other = pg["adj"] if pg["g"] == pg["median"] else pg["median"]
        e12 = C.fwd12(hist, "eps")
        if other and other > 0 and e12 and e12 > 0 and fm == ["PER"] and max(other, pg["g"]) / min(other, pg["g"]) >= 2:
            scen["alt"] = {"g": rnd(other, 1), **{k: rnd(e12 * other * f, 2) for k, f in (("bear", 1), ("base", 1.5), ("bull", 2))}}
        # 내 엑셀의 성장률 방법들을 나란히: ① 기본값 ② 보정값 ③ Finviz (④ 내가 정한 PER 은 화면에서 somong.yaml 값으로)
        ways = [("기본값", pg["median"], f"{pg['window']} EPS 성장률 중앙값"), ("보정값", adj[0][0], adj[0][1] or "컨센서스 없음")]
        if mkt == "US":
            ways.append(("Finviz", fv5, "Finviz EPS next 5Y"))
        scen["ways"] = [{"name": nm, "g": rnd(g, 1), "src": s, "used": bool(g) and rnd(g, 1) == pg["g"],
                         **({k: rnd(e12 * g * f, 2) for k, f in (("bear", 1), ("base", 1.5), ("bull", 2))} if g and g > 0 and e12 and e12 > 0 else {})}
                        for nm, g, s in ways]  # 성장률 15% → PER 15배 (숫자 그대로)
        scen["e12"] = rnd(e12, 2) if e12 else None
        if mkt == "US":
            scen["ltg_cmp"] = ltg_cmp
            scen["sa_date"] = sa_d or None
            scen["ltg_note"] = ltg_note
    if scen:
        # 시장 국면: 긴축·약세장이면 성장률 PER 은 × 1(Bear 칸)이 적정가, 완화·강세장이면 × 1.5(Base 칸). 밴드·업종 배수 부분은 늘 Base
        reg = (rates_now.get("regime") or {}).get(mkt)
        grow = any(p["src"].startswith("성장률") for p in scen["parts"])
        fk = "bear" if grow and reg and reg["mode"] == "tight" else "base"
        fair = sum(p["price"][fk if p["src"].startswith("성장률") else "base"] for p in scen["parts"]) / len(scen["parts"])
        scen["regime"], scen["fair_key"] = (reg if grow else None), fk
        s_ = SECTORS.get(h.get("sector")) or {}
        scen["rerating"] = h.get("rerating") or s_.get("rerating")
        scen["sector"] = {"name": h.get("sector"), **{k: s_.get(k) for k in ("bear", "base", "bull", "history", "notes")}} if s_ else None
        if mkt == "KR":
            try:
                scen["ind"] = kr_stock.sector_per(str(h.get("data_code") or code))
            except Exception as e:  # noqa: BLE001
                REPORT.block("네이버 업종 PER", f"{name}: {str(e)[:60]}")
    poss =[(bands[k]["periods"].get("10y") or bands[k]["periods"].get("all") or {}).get("pos")
            for k in ("PER", "PBR") if k in bands and k in methods]
    poss = [p for p in poss if p is not None]
    if not poss and "DIV" in bands:
        poss = [(bands["DIV"]["periods"].get("10y") or {}).get("pos_cheap")]
    band_pos = sum(poss) / len(poss) if poss and poss[0] is not None else None
    verdict, why, gap = C.judge(price, fair, band_pos)
    f_eps = C.fwd12(hist, "eps")
    fwd_per = price / f_eps if f_eps and f_eps > 0 else None
    bond_per = 100 / rate_kr3y if rate_kr3y else None
    ratio = fwd_per / bond_per if (fwd_per and bond_per) else None
    # 출처 교차확인 (10% 이상 차이면 ⚠)
    checks = []
    if mkt == "US":
        for yy in sorted(hist):  # 같은 해 추정치를 출처끼리 비교 (가장 높은 값 vs 가장 낮은 값, 10% 넘게 다르면 ⚠)
            s = {k: v for k, v in (hist[yy].get("srcs") or {}).items() if v}
            if hist[yy].get("estimate") and len(s) >= 2:
                hi_k, lo_k = max(s, key=s.get), min(s, key=s.get)
                checks.append({"item": f"{C.ylabel(yy)} EPS", "a": s[hi_k], "a_src": hi_k, "b": s[lo_k], "b_src": lo_k,
                               "warn": s[lo_k] > 0 and s[hi_k] / s[lo_k] - 1 >= 0.10, "dg": 2})
    else:
        w_eps = hist.get(now_kst().year, {}).get("eps")
        if now.get("fwd_eps") and w_eps:
            diff = now["fwd_eps"] / w_eps - 1
            checks.append({"item": f"{C.ylabel(now_kst().year)} EPS", "a": now["fwd_eps"], "a_src": "네이버 증권",
                           "b": w_eps, "b_src": "와이즈리포트", "warn": abs(diff) >= 0.05})
    try:  # 보유종목 비교표 한 줄 (실패해도 카드는 그대로)
        tbl = (table.us_row(code, hist, price, now.get("market_cap"), px) if mkt == "US" else
               table.kr_row(wise or {}, hist, price, cap_krw, px, own_cap=not h.get("data_code")))
    except Exception as e:  # noqa: BLE001
        REPORT.fail(f"{name} 비교표", f"{type(e).__name__}: {e}")
        tbl = None
    dart_check = None
    if mkt == "KR" and not h.get("data_code"):  # DART 최신 정기보고서 vs 네이버(와이즈리포트) 숫자 대조
        try:
            dart_check = kr_stock.cross_check(code, wise or {})
        except Exception as e:  # noqa: BLE001
            REPORT.block("DART 보고서 대조", f"{name}: {str(e)[:60]}")
    # 야후 재무제표 (순현금·점수 체크리스트·미국 템플릿). 우선주는 보통주 회사 값을 쓴다
    fcode = str(h.get("data_code") or code)
    tkr = score.yf_ticker(fcode, mkt)
    fins = None
    if tkr:
        try:
            fins = score.fin(tkr)
        except Exception as e:  # noqa: BLE001
            REPORT.block("야후 재무제표", f"{name}: {str(e)[:60]}")
        try:  # 분기 실적 한눈에 (매출·이익률·FCF·CapEx·돈의 흐름)
            QTRS[tkr] = score.quarters(tkr, QTRS.get(tkr))
        except Exception as e:  # noqa: BLE001
            REPORT.block("야후 분기 실적", f"{name}: {str(e)[:60]}")
    if tbl is not None and tkr and not h.get("data_code"):  # 순현금 (우선주는 회사 전체 값이라 뺌)
        try:
            nc = table.net_cash(tkr, now.get("market_cap"))
        except Exception:  # noqa: BLE001
            nc = None
        if nc:
            if mkt == "US" and fx:
                nc["net_cash"] *= fx  # 화면은 원화(조원)로
                nc["net_cash_xl"] *= fx
            tbl.update(nc)
        # 최근 4분기 FCF 합계와 시총 대비 (연간 FCF 는 투자가 급증하는 구간을 늦게 보여줘서)
        q4 = [q.get("fcf") for _, q in sorted((QTRS.get(tkr) or {}).items())[-4:]]
        if len(q4) == 4 and all(v is not None for v in q4):
            tbl["fcf_ttm"] = sum(q4)
            tbl["fcf_ttm_yield"] = rnd(sum(q4) / now["market_cap"] * 100, 1) if now.get("market_cap") else None
    # PSR = 시가총액 ÷ 올해 예상 매출
    psr = None
    if mkt == "KR" and wise and not h.get("data_code"):
        s26 = (wise.get(now_kst().year) or {}).get("sales")
        psr = now.get("market_cap") / (s26 * 1e8) if (s26 and now.get("market_cap")) else None
    elif mkt == "US":
        try:
            import yfinance as yf
            re_ = yf.Ticker(code).revenue_estimate
            psr = now.get("market_cap") / float(re_.loc["0y", "avg"]) if (now.get("market_cap") and re_ is not None and "0y" in re_.index) else None
        except Exception:  # noqa: BLE001
            psr = None
    if tbl is not None:  # 엑셀 '간단 벨류'의 GPM·ROIC·FCF, PSR (한국·미국 공통)
        tbl.update(score.us_extra(fins, now.get("market_cap")))
        tbl["psr"] = rnd(psr, 2)
    st5 = (bands.get("PER") or {}).get("periods", {})
    per5 = (st5.get("5y") or st5.get("all") or {}).get("avg")
    stp = (bands.get("PBR") or {}).get("periods", {})
    pbr10 = (stp.get("10y") or stp.get("all") or {}).get("avg")
    try:
        checks_score = score.checklist(code, {"cyclical": fm == ["PBR"] or bool(h.get("cyclical")), "currency": currency},
                                       tbl, fins, per5, pbr10, psr)
        checks_score["psr"] = rnd(psr, 2)
    except Exception as e:  # noqa: BLE001
        REPORT.fail(f"{name} 점수 체크리스트", f"{type(e).__name__}: {e}")
        checks_score = None
    # 현재 MDD (강의 'MDD' 시트): 사상 최고가(수정주가) 대비 지금 몇 % 아래 + 고점 대비 -10~-50% 가격
    try:
        s = px.dropna()
        peak, peak_d = float(s.max()), s.idxmax().strftime("%Y-%m-%d")
        mdd = {"peak": rnd(peak, 2), "peak_date": peak_d, "dd": rnd((price / peak - 1) * 100, 1),
               "levels": [[lv, rnd(peak * (1 + lv / 100), 2)] for lv in (-10, -15, -20, -30, -35, -40, -45, -50)]}
    except Exception:  # noqa: BLE001
        mdd = None
    # 매수 전 최종 점검 중 숫자로 볼 수 있는 것 (자본총계 추이, 이익 피크아웃, 주식 수 희석 공시)
    pre = {}
    act = sorted(y for y, r in hist.items() if not r.get("estimate") and (r.get("bps") or 0) > 0)[-10:]
    if len(act) >= 3:
        b = [hist[y]["bps"] for y in act]
        pre["equity"] = {"from": act[0], "to": act[-1], "down_years": [y for y, p, q in zip(act[1:], b, b[1:]) if q < p * 0.98],
                         "cagr": rnd(((b[-1] / b[0]) ** (1 / (len(b) - 1)) - 1) * 100, 1)}
    y0 = now_kst().year
    e = [(hist.get(y) or {}).get("eps") for y in (y0, y0 + 1, y0 + 2)]
    if all(v and v > 0 for v in e):
        g1, g2 = (e[1] / e[0] - 1) * 100, (e[2] / e[1] - 1) * 100
        pre["peak"] = {"g1": rnd(g1, 0), "g2": rnd(g2, 0), "y": [C.ylabel(y) for y in (y0, y0 + 1, y0 + 2)],
                       "flag": g2 < 0 or (g1 > 0 and g2 < g1 / 3)}
    if mkt == "KR" and not h.get("data_code"):
        try:
            pre["dilution"] = kr_stock.dart_dilution(code)
        except Exception as ex:  # noqa: BLE001
            REPORT.block("DART 공시목록", f"{name}: {str(ex)[:50]}")
    try:  # 배당주 점검 (강의): 한국은 DART·와이즈리포트 실적의 DPS, 미국은 야후 배당 지급 내역
        dps = score.us_dps(code) if mkt == "US" else {y: r.get("dps") for y, r in hist.items() if not r.get("estimate")}
        div_check = score.dividend_check(dps)
    except Exception as e:  # noqa: BLE001
        REPORT.block("배당 이력", f"{name}: {str(e)[:60]}")
        div_check = None
    us_tpl = None
    if mkt == "US":  # ltg·fv5 는 위 적정가 계산에서 받아 둔 값
        try:
            tr = us_stock.tipranks(code)
        except Exception as e:  # noqa: BLE001
            tr = None
            REPORT.block("TipRanks", f"목표주가 접속 실패 ({str(e)[:50]})")
        street_info = {}
        try:
            street_info["ratings"] = street.ratings("GOOGL" if code == "GOOG" else code)  # 알파벳은 증권사 기록이 GOOGL 쪽에 쌓임
        except Exception as e:  # noqa: BLE001
            REPORT.block("야후 의견 변경", f"{name}: {str(e)[:50]}")
        try:  # 채널 검색어: 한글 이름 (+ 알파벳은 구글도), 티커
            terms = [name] + (["구글"] if code == "GOOG" else []) + [code]
            street_info["posts"] = street.channel_posts(terms)
        except Exception as e:  # noqa: BLE001
            REPORT.block("텔레그램 채널", f"{name}: {str(e)[:50]}")
        e28 = (hist.get(y0 + 2) or {}).get("eps")
        try:
            us_tpl = {"somong": score.somong(hist, price, ltg, fv5),
                      "finviz_5y": fv5, "tipranks": tr, "street": street_info,
                      # 내 엑셀: '28년(3년 뒤) 주가 가정' = 28E EPS × PER 20~110
                      "per_grid": {"year": C.ylabel(y0 + 2), "eps": e28,
                                   "rows": [[m, rnd(m * e28, 2)] for m in range(20, 120, 10)] if e28 and e28 > 0 else []},
                      "ltg_src":f"{C.ylabel(y0)}→{C.ylabel(ests[-1])} EPS 연평균 (나스닥 컨센서스)" if ltg else None}
        except Exception as e:  # noqa: BLE001
            REPORT.fail(f"{name} 적정주가 템플릿", f"{type(e).__name__}: {e}")
    det["qtrs"] = QTRS.get(tkr) if tkr else None  # 분기 실적 한눈에 (상세 화면 전용)
    det["kq"] = None
    if mkt == "KR" and not h.get("data_code"):  # 최신 분기 실적(잠정) vs 컨센서스
        try:
            det["kq"] = kq.collect(code)
        except Exception as e:  # noqa: BLE001
            REPORT.block("최신 분기 실적", f"{name}: {str(e)[:60]}")
    det["card"] = {
        "name": name, "code": code, "market": mkt, "price": price, "industry": h.get("industry"), "tbl": tbl, "dart_check": dart_check,
        "score": checks_score, "us_tpl": us_tpl, "div_check": div_check, "mdd": mdd, "pre": pre,
        # 이익이 크게 출렁여 적정가를 PBR 로만 보는 종목 → 비교표에서 PER·PEG 주의 표시
        "cyclical": fm == ["PBR"] or bool(h.get("cyclical")),
        "market_cap": cap_krw, "market_cap_usd": det["market_cap_usd"],
        "currency": currency, "verdict": verdict, "why": why, "fair": rnd(fair, 2 if currency == "USD" else 0),
        "gap": rnd(gap, 4),
        "fair_basis": _scen_text(scen) if scen else _basis_text([n for n, _ in fairs], ey, mkey),
        "scen": _round_scen(scen, 2 if currency == "USD" else 0),
        "fwd_mult": C.fwd_multiples(price, hist, [k for k in ("PER", "PBR") if k in methods and k in bands]),
        # 네이버 증권이 보여주는 올해 추정 PER (컨센서스 EPS 기준) — 카드의 12MF PER 과 나란히 비교용
        "naver_per": now.get("fwd_per") if mkt == "KR" else None,
        "band_avg": {k:(bands[k]["periods"].get("10y") or bands[k]["periods"].get("all") or {}).get("avg")
                     for k in ("PER", "PBR") if k in bands},
        "band_pos": rnd(band_pos, 1), "fwd_per": rnd(fwd_per), "bond_per": rnd(bond_per),
        "bond_ratio": rnd(ratio, 3), "bond_signal": C.bond_signal(ratio), "bond_label": bond_label,
        "div_signal": det.get("div", {}).get("signal") if "DIV" in methods else None,
        "div_yield": det.get("div", {}).get("cur_yield") if "DIV" in methods else None,
        "methods": methods, "avg_price": h.get("avg_price"), "quantity": h.get("quantity"),
        "short_history": any(b.get("short_history") for b in bands.values()),
        "band_start": min((b["start"] for b in bands.values()), default=None),
        "rerating_warning": det.get("per", {}).get("rerating_warning"), "checks": checks,
        "chart": _price_chart(px, currency),
        # 적정가에 쓰는 방식 표를 먼저, 나머지 방식도 이어서 (예: 삼성전자 = PBR 표 → PER 표)
        # 미국: 연도별 EPS 추정치 출처 (야후·나스닥·Finviz) 와 쓴 평균값
        "eps_srcs": {C.ylabel(yy): {**hist[yy]["srcs"], "평균": rnd(hist[yy]["eps"], 2), "note": hist[yy].get("srcs_note")}
                     for yy in sorted(hist) if hist[yy].get("estimate") and hist[yy].get("srcs")} if mkt == "US" else None,
        "fv": _fair_table(bands, hist, price, currency,
                          [k for k in ("PER", "PBR") if k in fm] + [k for k in ("PER", "PBR") if k not in fm]),
    }
    k = det.get("kq") or {}  # 카드 꼬리표: 새 분기 실적이 3일 안에 반영됐거나, 잠정실적 공시가 나고 숫자 반영을 기다리는 중
    if k.get("seen") and (now_kst().date() - pd.Timestamp(k["seen"]).date()).days <= 3:
        det["card"]["kq_new"] = k["latest"]
    if k.get("waiting"):
        det["card"]["kq_wait"] = (k.get("next") or {}).get("q")
    return det


def _scen_text(scen):
    """'12MF EPS × Base PER 22.5배 (화장품 브랜드)' 처럼."""
    base = {"PER": "EPS", "PBR": "BPS"}
    fk = scen.get("fair_key", "base")
    reg = f", {scen['regime']['label']}" if scen.get("regime") else ""
    parts = [f"12MF {base[p['kind']]} × {p['src']} 평균 {p['kind']}" if "밴드" in p["src"] else
             f"12MF EPS × PER {p['mult'][fk]:g}배 ({'Bear' if fk == 'bear' else 'Base'} 칸 · {p['src']}{reg})" if p["src"].startswith("성장률") else
             f"12MF {base[p['kind']]} × {p['kind']} {p['mult']['base']:g}배 ({p['src']})" for p in scen["parts"]]
    return parts[0] if len(parts) == 1 else "두 값 평균: " + " / ".join(parts)


def _round_scen(scen, dg):
    if not scen:
        return None
    return {**{k: rnd(scen[k], dg) for k in ("bear", "base", "bull")}, "parts": scen["parts"], "note": scen["note"],
            "growth": scen.get("growth"), "e27": scen.get("e27"), "alt": scen.get("alt"), "ways": scen.get("ways"), "e12": scen.get("e12"),
            "ltg_cmp": scen.get("ltg_cmp"), "sa_date": scen.get("sa_date"), "ltg_note": scen.get("ltg_note"),
            "rerating": scen.get("rerating"), "sector": scen.get("sector"), "ind": scen.get("ind"),
            "regime": scen.get("regime"), "fair_key": scen.get("fair_key")}


def _price_chart(px, currency, days=250):
    """카드용 주가 차트: 최근 1년 종가 + 20·50·200일 이동평균선 + 볼린저밴드(20일, ±2σ)."""
    s = px.dropna().astype(float)
    dg = 2 if currency == "USD" else 0
    ma = {n: s.rolling(n).mean() for n in (20, 50, 200)}
    sd = s.rolling(20).std(ddof=0)
    t = s.iloc[-days:]
    f = lambda ser: [rnd(v, dg) if v == v else None for v in ser.loc[t.index]]  # noqa: E731 (NaN → None)
    return {"dates": [d.strftime("%Y-%m-%d") for d in t.index], "close": f(s),
            "ma20": f(ma[20]), "ma50": f(ma[50]), "ma200": f(ma[200]),
            "bb_up": f(ma[20] + 2 * sd), "bb_dn": f(ma[20] - 2 * sd)}


def _fair_table(bands, hist, price, currency, kinds):
    """적정주가 표: (27E·28E EPS) × (5년·10년 PER 저점·평균·고점), PBR 은 (26E·27E·28E BPS) × 같은 배수."""
    y = now_kst().year
    dg = 2 if currency == "USD" else 0
    out = {}
    for kind in kinds or ["PER"]:
        b = bands.get(kind)
        if not b:
            continue
        key, years = ("eps", [y + 1, y + 2]) if kind == "PER" else ("bps", [y, y + 1, y + 2])
        base = {C.ylabel(yy): (hist.get(yy) or {}).get(key) for yy in years}
        rows, seen = [], set()
        for per_key, span in (("5y", "5년"), ("10y", "10년")):
            st = b["periods"].get(per_key) or {}
            if not st.get("avg") or st.get("from") in seen:  # 자료가 5년이 안 되면 10년 줄은 같은 값이라 뺌
                continue
            seen.add(st.get("from"))
            span_txt = span if st.get("from", "") <= f"{y - (5 if per_key == '5y' else 10)}-12-31" else f"{st['from'][:4]}~"
            for lab, mk in (("저점", "min"), ("평균", "avg"), ("고점", "max")):
                m = st.get(mk)
                cells = {k: (rnd(v * m, dg) if (m and v and v > 0) else None) for k, v in base.items()}
                rows.append({"label": f"{span_txt} {lab}", "mult": rnd(m, 2),
                             "cells": cells, "pct": {k: rnd((v / price - 1) * 100, 0) if v else None for k, v in cells.items()}})
        out[kind] = {"cols": list(base), "base": {k: rnd(v, dg) for k, v in base.items()}, "rows": rows}
    return out


def main():
    t0 = now_kst()
    print(f"[{t0:%Y-%m-%d %H:%M} KST] 수집 시작")
    prev = read_json(DATA / "dashboard.json", {}) or {}
    prev_rates = prev.get("rates", {})
    prev_mkt = prev.get("market", {})

    test_fail = os.environ.get("TEST_FAIL") == "true"
    if test_fail:  # 실패 알림 시험: 한국은행 키를 일부러 틀리게 해서 금리 수집을 실패시킨다
        print("※ 실패 시험 모드")
        os.environ["ECOS_KEY"] = "TEST-INVALID-KEY"
        rates.NAVER_BOND.clear()
    print("■ 금리")
    r = rates.collect()
    for k in r:
        r[k] = keep_prev(r[k], prev_rates.get(k), k)
    print("■ 시장")
    m = market.collect()
    for k in ("sp500_trailing", "sp500_forward", "kospi_forward"):
        m[k] = keep_prev(m[k], prev_mkt.get(k), k)
    if m.get("kospi_trailing", {}).get("error") and prev_mkt.get("kospi_trailing", {}).get("per"):
        m["kospi_trailing"] = dict(prev_mkt["kospi_trailing"], stale=True)
    m["manheim"] = keep_prev(attempt("미국 중고차 가격지수 (Manheim)", manheim.collect),
                             prev_mkt.get("manheim"), "manheim")
    m["kospi_fwd_bands"] = keep_prev(attempt("코스피 선행 PER·PBR 밴드", market.kospi_fwd_bands,
                                             m.get("kospi_forward"), m.get("kospi_trailing")),
                                     prev_mkt.get("kospi_fwd_bands"), "kospi_fwd_bands")
    # 크로스체크: 우산(NNN) 텔레그램 채널의 주간 밸류에이션 숫자
    m["woosan"] = keep_prev(attempt("우산 채널 밸류에이션 (크로스체크)", street.woosan), prev_mkt.get("woosan"), "woosan")

    us10 = (r.get("us10y") or {}).get("latest")
    kr3 = (r.get("kr3y") or {}).get("latest")
    spf = m.get("sp500_forward") or {}
    spt = m.get("sp500_trailing") or {}
    if spf.get("value"):
        us_sig = market_signal("미국", spf["value"], "S&P500 선행 12개월 PER", spf.get("source"), us10, "미국채 10년")
    elif spt.get("hist"):
        us_sig = market_signal("미국", spt["hist"][-1][1], "S&P500 후행 PER (선행 없음)", spt.get("source"), us10, "미국채 10년")
    else:
        us_sig = market_signal("미국", None, "", "", us10, "미국채 10년")
    kf = m.get("kospi_forward") or {}
    kt = m.get("kospi_trailing") or {}
    if kf.get("value"):
        kr_sig = market_signal("한국", kf["value"], "코스피 선행 12개월 PER", kf.get("source"), kr3, "국고채 3년")
    elif kt.get("per"):
        kr_sig = market_signal("한국", kt["per"], "코스피 후행 PER (선행 없음)", kt.get("source"), kr3, "국고채 3년")
    else:
        kr_sig = market_signal("한국", None, "", "", kr3, "국고채 3년")
    us_sig["premium_hist"] = premium_hist(spt.get("hist", [])[-12 * 20:], (r.get("us10y") or {}).get("hist"))
    us_sig["premium_hist_label"] = "S&P500 후행 PER 기준 (월별)"
    # 선행 PER 이력이 충분히 쌓이기 전에는 KRX 후행 PER(2000년~)로 긴 추이를 보여준다
    kr3_hist = (r.get("kr3y") or {}).get("hist")
    if len(kf.get("hist", [])) < 30 and kt.get("hist"):
        kr_sig["premium_hist"] = premium_hist(kt["hist"][-52 * 20:], kr3_hist)
        kr_sig["premium_hist_label"] = "코스피 후행 PER 기준 (KRX, 주간)"
    else:
        kr_sig["premium_hist"] = premium_hist(kf.get("hist", []), kr3_hist)
        kr_sig["premium_hist_label"] = "코스피 선행 PER 기준 (갱신할 때마다 쌓임)"

    fx = attempt("원/달러 환율", usdkrw) or prev.get("fx")
    # 시장 국면 (긴축·약세 / 완화·강세): 종목 적정가를 성장률 × 1 로 볼지 × 1.5 로 볼지
    regime = {mk: attempt(f"시장 국면 ({nm})", lambda t=t, nm=nm: C.market_regime(us_stock.price_history(t), nm, us10))
              for mk, t, nm in (("KR", "^KS11", "코스피"), ("US", "^GSPC", "S&P500"))}

    print("■ 보유종목")
    cards = []
    prev_cards = {c["code"]: c for c in prev.get("stocks", [])}
    sy = load_yaml("stocks.yaml")
    # 보유 + 관심(watchlist) + 공동자산(joint) 모두 같은 계산. 화면은 group 으로 탭을 나눠 보여줌
    todo = [(h, g) for key, g in (("holdings", "보유"), ("watchlist", "관심"), ("joint", "공동")) for h in (sy.get(key) or [])]
    for i, (h, g) in enumerate(todo):
        code = str(h["code"])
        try:
            det = stock_detail(h, {"us10y": us10, "kr3y": kr3, "regime": regime}, fx)
            det["card"]["order"] = i
            det["card"]["group"] = g
            # 텔레그램 채널 글 중 지난 갱신 때 없던 글에 🆕 표시 (처음 모으는 날은 표시 안 함)
            posts = ((det["card"].get("us_tpl") or {}).get("street") or {}).get("posts") or []
            old_st = ((prev_cards.get(code) or {}).get("us_tpl") or {}).get("street") or {}
            if old_st.get("posts") is not None:
                old_ids = {p["id"] for p in old_st["posts"]} | set(old_st.get("seen") or [])
                old_ids |= {f"aetherjapanresearch/{x}" for x in old_ids if str(x).isdigit()}  # 예전 저장 형식(번호만)
                for p in posts:
                    p["new"] = p["id"] not in old_ids
                det["card"]["us_tpl"]["street"]["seen"] = sorted(old_ids | {p["id"] for p in posts})[-200:]
            elif posts:
                det["card"]["us_tpl"]["street"]["seen"] = [p["id"] for p in posts]
            write_json(DATA / "stocks" / f"{code}.json", det)
            cards.append(det["card"])
            REPORT.success(f"{h['name']} 종목 계산")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            REPORT.fail(f"{h['name']} 종목", f"{type(e).__name__}: {e}")
            if code in prev_cards:
                c = dict(prev_cards[code], stale=True, order=i, group=g)
                cards.append(c)

    print("■ 실적발표·컨퍼런스콜 일정")
    cal = []
    for h, g in todo:
        try:
            if h.get("market", "KR").upper() == "US":
                import yfinance as yf
                d = (yf.Ticker(h["code"]).calendar or {}).get("Earnings Date") or []
                ev = {"when": str(d[0]), "time_unknown": True, "title": "실적발표",
                      "url": f"https://finance.yahoo.com/quote/{h['code']}/"} if d else None
            elif not h.get("data_code"):
                ev = kr_stock.ir_schedule(str(h["code"]))
            else:
                ev = None
        except Exception as e:  # noqa: BLE001
            REPORT.block("실적발표 일정", f"{h['name']}: {str(e)[:50]}")
            ev = None
        if ev:
            days = (pd.Timestamp(ev["when"][:10]).date() - now_kst().date()).days
            if -7 <= days <= 90:  # 지난 1주 ~ 앞으로 3개월
                cal.append({**ev, "name": h["name"], "code": str(h["code"]), "group": g, "market": h.get("market", "KR").upper(), "dday": days})
    cal.sort(key=lambda x: x["when"])
    write_json(DATA / "ir_calendar.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "items": cal})

    print("■ 수주 공시")
    import orders
    o = orders.collect()
    if o:
        write_json(DATA / "orders.json", o)
        for c in cards:  # 최근 7일 안에 새 수주 공시가 있으면 카드에 표시
            od = o.get(c["code"])
            if od:
                c["new_orders"] = sum(1 for x in od["contracts"] if x.get("new"))

    print("■ 주요 주주 지분")
    import holders
    hd = holders.collect()
    write_json(DATA / "holders.json", hd)
    for c in cards:  # 최근 30일 안에 5% 이상 주주(국민연금 등)의 0.5%p 이상 지분 변동 공시가 있으면 카드에 표시
        rc = (hd["companies"].get(c["code"]) or {}).get("recent") or []
        if rc:
            c["holder_changes"] = [{"name": x["name"], "chg": x["chg_ratio"], "date": x["date"]} for x in rc]

    write_json(DATA / "broker_targets.json", load_yaml("broker_targets.yaml") or {})  # 손으로 적는 증권사 목표주가
    write_json(DATA / "profiles.json", load_yaml("profiles.yaml") or {})
    write_json(DATA / "earnings.json", load_yaml("earnings.yaml") or {})  # 실적발표(컨퍼런스콜) 요약
    write_json(CACHE / "ltg_gap.json", LTG_GAP)
    write_json(CACHE / "quarters.json", QTRS)
    write_json(CACHE / "q_cons.json", kq.CONS)  # 발표 전 컨센서스 (예상 대비 계산용)
    write_json(CACHE / "q_hist.json", kq.HIST)
    write_json(DATA / "somong.json", load_yaml("somong.yaml") or {})  # 강의 체크리스트 (지갑털이·올리고폴리·아무나이겨라·굿보스 등)  # 기업 프로필 (한 줄 설명·매출 비중·점유율·IR 링크, 조사해서 적는 값)

    print("■ 동종업계")
    import peers
    write_json(DATA / "peers.json", peers.collect())

    print("■ 관심종목")
    import watch
    write_json(DATA / "watch.json", watch.collect())

    print("■ PBR 계산기")
    import pbr_watch
    write_json(DATA / "pbr_watch.json", pbr_watch.collect())

    out = {
        "updated_at": t0.strftime("%Y-%m-%d %H:%M"),
        "rates": r, "market": m, "signals": {"us": us_sig, "kr": kr_sig},
        "stocks": cards, "fx": fx,
        "status": {"failures": REPORT.failures, "blocked": REPORT.blocked, "ok": len(REPORT.ok),
                   "finished_at": now_kst().strftime("%Y-%m-%d %H:%M")},
        "settings": {"bond_signal": SETTINGS["bond_signal"], "stock_signal": SETTINGS["stock_signal"],
                     "fair_value": SETTINGS["fair_value"], "band": SETTINGS["band"],
                     "index_scenarios": SETTINGS.get("index_scenarios", {}),
                     "kospi_pbr_marks": SETTINGS.get("kospi_pbr_marks", []),
                     "kospi_bands": SETTINGS.get("kospi_bands", {}), "kospi_notes": SETTINGS.get("kospi_notes", [])},
    }
    write_json(DATA / "dashboard.json", out)
    print(f"완료: 성공 {len(REPORT.ok)} / 실패 {len(REPORT.failures)}")
    # 절반 넘게 실패하면 GitHub 이 실패 메일을 보내도록 오류 코드로 끝낸다
    if len(REPORT.failures) > max(3, len(REPORT.ok)) or test_fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
