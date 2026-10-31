"""매일 실행: 수집 → 계산 → site/data/*.json 저장.
실패한 항목은 직전 값을 그대로 쓰고 '실패 목록'에 남긴다."""
import os
import re
import sys
import traceback

import pandas as pd

import compute as C
import est_track
import flows
import kq
import kr_stock
import manheim
import market
import patterns
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
SEGS = read_json(CACHE / "segments.json") or {}  # 한국 '주요제품 매출구성'(%)을 보고서 시점별로 쌓음 → 부문 비중 추이
SEG_US = load_yaml("segments.yaml") or {}  # 분기 제품·부문별 매출 (공식 실적 자료를 보고 직접 적음, 미국 + 한국 보유종목)
KPI_CFG = load_yaml("kpi.yaml") or {}  # 🔑 핵심 지표 (fcf_add = 야후에 아직 없는 최신 분기 FCF, 보도자료)
NOTES = load_yaml("notes.yaml") or {}  # 적정주가 칸 메모 (증권사 의견, 28E 칸 등)
SEGC = load_yaml("seg_cons.yaml") or {}  # 🎯 사업부문별 컨센서스 vs 실적
SEC_LONG = read_json(CACHE / "sec_longq.json") or {}  # 미국 10년 분기 실적 (tools/sec_backfill.py 로 받아 둠, 백만 달러)
CMP = load_yaml("compare.yaml") or {}  # ⚖️ 비교 탭 설정·손으로 적는 자료 (삼성 DS·낸드·클라우드)
DEBT_NEWS = load_yaml("debt.yaml") or {}  # 🏦 회사채 발행 뉴스 메모 (종목 코드 → [{date, text, url}])
LONGQ, MCAP_W = {}, {}  # 비교 탭에 쓸 종목별 10년 실적·주봉 시가총액
BIGTECH = [("MSFT", "마이크로소프트"), ("GOOG", "알파벳"), ("META", "메타"), ("AMZN", "아마존")]  # 🏗 빅테크 CapEx (메모리 수요)
M7 = BIGTECH + [("AAPL", "애플"), ("NVDA", "엔비디아"), ("TSLA", "테슬라")]  # 💸 M7 현금흐름·CapEx 가이던스


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
        px = us_stock.price_history(code, div="DIV" in methods)
        hist = us_stock.history(code)
        wise = None
        if "DIV" in methods:  # 미국 배당주(리츠 등): 야후 배당 내역 → 연도별 DPS, 올해는 지금 연간 배당(dividendRate)
            for y, v in score.us_dps(code).items():
                hist.setdefault(y, {"estimate": False, "src": "야후 배당 내역"})["dps"] = v
            if now.get("div_rate"):
                hist.setdefault(now_kst().year, {"estimate": True, "src": "야후 연간 배당"})["dps"] = float(now["div_rate"])
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
            # PBR 은 늘 '그해 BPS' 로: BPS 가 1년에 몇 배씩 늘 때(메모리 호황) 지난 BPS 로 나누면 PBR 밴드가 부풀어요
            shift = 1 if key == "bps" or (key == "eps" and basis == "forward") else 0
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
        det["pbr"] = C.pbr_section(price, hist, bands["PBR"], rate_kr3y, cyclical=fm == ["PBR"] or bool(h.get("cyclical")))
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
        # 한국은 시킹알파 같은 3~5년 성장률이 없어 네이버·에프앤가이드 컨센서스(증권사 추정 합산) 앞으로 3년 영업이익 성장률
        # (한국은 영업이익이 더 중요). 영업이익 추정이 없으면 EPS
        cg = C.cons_growth(wise or {}, y0, key="op") or C.cons_growth(hist, y0)
        ltg = cg[0] if cg else None
        adj = [cg or (None, "")]
    # 한국 = 컨센서스 3년 영업이익 성장률, 미국 = 시킹알파 3~5년 EPS 성장률(적어 둔 종목)을 늘 씀
    pg = C.growth_fair(hist, adj, force_adj=mkt == "KR" or bool(mkt == "US" and sa)) if ("PER" in fm and "PER" in bands) else None
    sec_name = h.get("sector") if h.get("fair_mode") == "sector" else None  # 업종 배수는 fair_mode: sector 로 고른 종목만
    sec = dict(SECTORS[sec_name], name=sec_name) if sec_name in SECTORS else None
    if pg:
        pg["label"] = ("3년 영업이익 성장률" if mkt == "KR" and "영업이익" in pg["src"] else
                       "시킹알파 3~5년 EPS 성장률" if "시킹알파" in pg["src"] else "EPS 성장률")
        # 성장률이 너무 세서 하방이 지금 가격보다 50% 넘게 높으면 → 업종 PER, 없으면 이 종목 PER 밴드
        hi = C.too_high(pg["mult"], C.fwd12(hist, "eps"), price, bands.get("PER"), SECTORS.get(h.get("sector")), h.get("sector"))
        if hi:
            pg["raw"], pg["how"] = dict(pg["mult"]), hi[1]
            pg["mult"] = {k: rnd(v, 1) for k, v in hi[0].items()}
            pg["part_src"] = f"{h['sector']} 업종 PER" if "업종" in hi[1] else "PER 밴드"
            if "업종" in hi[1] and (SECTORS.get(h.get("sector")) or {}).get("easy"):
                pg["easy"] = SECTORS[h["sector"]]["easy"]  # 🐂 강세장 칸 업종 배수 (sectors.yaml easy)
    scen = C.scenarios(price, hist, bands, [k for k in ("PER", "PBR") if k in fm and k in bands], sec, per_growth=pg)
    if scen and pg:
        scen["growth"] = pg
        e27 = (hist.get(y0 + 1) or {}).get("eps")
        scen["e27"] = {"eps": e27, **{k: rnd(e27 * v, 2) for k, v in pg["mult"].items()}} if e27 and e27 > 0 else None
        # 쓴 성장률과 다른 쪽(기본값↔보정값)이 2배 넘게 차이 나면, 다른 쪽으로 계산한 12MF 적정주가도 같이 (PER 만 보는 종목)
        other = pg["adj"] if pg["g"] == pg["median"] else pg["median"]
        e12 = C.fwd12(hist, "eps")
        if other and other > 0 and e12 and e12 > 0 and fm == ["PER"] and max(other, pg["g"]) / min(other, pg["g"]) >= 2:
            scen["alt"] = {"g": rnd(other, 1), **{k: rnd(e12 * other * f, 2) for k, f in C.GROWTH_MULT.items()}}
        # 내 엑셀의 성장률 방법들을 나란히: ① 기본값 ② 보정값 ③ Finviz (④ 내가 정한 PER 은 화면에서 somong.yaml 값으로)
        ways = [("기본값", pg["median"], f"{pg['window']} EPS 성장률 중앙값"), ("보정값", adj[0][0], adj[0][1] or "컨센서스 없음")]
        if mkt == "US":
            ways.append(("Finviz", fv5, "Finviz EPS next 5Y"))
        scen["ways"] = [{"name": nm, "g": rnd(g, 1), "src": s, "used": bool(g) and rnd(g, 1) == pg["g"],
                         **({k: rnd(e12 * g * f, 2) for k, f in C.GROWTH_MULT.items()} if g and g > 0 and e12 and e12 > 0 else {})}
                        for nm, g, s in ways]  # 성장률 15% → PER 15배 (숫자 그대로)
        scen["e12"] = rnd(e12, 2) if e12 else None
        if mkt == "US":
            scen["ltg_cmp"] = ltg_cmp
            scen["sa_date"] = sa_d or None
            scen["sa_ref"] = {k: my.get(f"sa_ltg_{k}") for k in ("5y", "sector")} if sa else None  # 참고: 5년 평균·업종 중앙값
            scen["ltg_note"] = ltg_note
    if scen:
        fair = scen["base"]  # 적정가 = Base (하방 × 1 과 최대 × 2 의 평균)
        scen["regime"] = (rates_now.get("regime") or {}).get(mkt)  # 🐂 강세장 칸 옆에 '지금 시장' 표시용
        s_ = SECTORS.get(h.get("sector")) or {}
        scen["rerating"] = h.get("rerating") or s_.get("rerating")
        scen["sector"] = {"name": h.get("sector"), **{k: s_.get(k) for k in ("bear", "base", "bull", "tight", "easy", "history", "notes")}} if s_ else None
        # 📐 PBR 로만 적정가를 매기는데 업종에 리레이팅 기록이 있는 종목(롯데쇼핑): PER 로도 Bear·Base·Bull — 화면에선 접어 둠
        #    🔴 긴축·약세장 = 리레이팅 전 바닥~보통 (sectors.yaml tight 가 있으면 그것) · 🐂 강세장 = 리레이팅 된 보통~최고 (easy)
        e12 = C.fwd12(hist, "eps")
        if fm == ["PBR"] and "PER" in methods and scen["rerating"] and str(s_.get("kind", "PER")).upper() == "PER" and s_.get("base") and e12 and e12 > 0:
            t = s_.get("tight") or [s_["bear"], (s_["bear"] + s_["base"]) / 2, s_["base"]]
            ez = s_.get("easy") or [s_["base"], (s_["base"] + s_["bull"]) / 2, s_["bull"]]
            scen["per_alt"] = {"e12": rnd(e12, 2), "tight": [rnd(x, 1) for x in t], "easy": [rnd(x, 1) for x in ez], "history": s_.get("history")}
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
        # 야후에 아직 없는 최신 분기 손익은 kpi.yaml qtr_add (보도자료, 미국 백만 달러 · 한국 억원). 야후가 주는 칸은 야후 값, 빈 칸만 채움
        for e, v in ((KPI_CFG.get(fcode) or {}).get("qtr_add") or {}).items():
            row = QTRS.setdefault(tkr, {}).setdefault(str(e), {})
            for k, x in v.items():
                row.setdefault(k, x * (1e6 if mkt == "US" else 1e8))
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
        # 🏦 분기별 회사채·장기 차입 발행 (야후 현금흐름표) + 뉴스 메모 (config/debt.yaml)
        tbl["debt_iss"] = {e: q["ltdi"] for e, q in sorted((QTRS.get(tkr) or {}).items())[-6:] if q.get("ltdi") is not None}
        tbl["debt_news"] = DEBT_NEWS.get(code) or []
        try:  # 🌡 기대감 신호 하나 (나머지 = 3개월 주가·PER 밴드 위치, 화면에서 계산)
            tbl["eps_rev90"] = score.eps_rev90(tkr)
        except Exception:  # noqa: BLE001
            pass
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
        # 예상 ROIC: 한국 = 와이즈리포트 예상 영업이익, 미국 = 예상 EPS × 주식 수(세후 순이익으로 NOPAT 대신)
        e_ys = [yy for yy in (y0, y0 + 1) if yy in hist]  # 칸을 26E·27E 로 맞춤 (6월 결산 MS 처럼 이미 확정된 해면 그 실적)
        shares = (now.get("market_cap") / price) if (mkt == "US" and now.get("market_cap") and price) else None
        fwd = [(C.ylabel(yy), ((wise or {}).get(yy) or {}).get("op") * 1e8 if mkt == "KR" and ((wise or {}).get(yy) or {}).get("op") is not None else None,
                hist[yy]["eps"] * shares if shares and hist[yy].get("eps") is not None else None) for yy in e_ys]
        if not h.get("data_code"):
            tbl.update(score.roic_more(fins, QTRS.get(tkr), fwd))
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
    det["pl_year"] = (fins or {}).get("pl")  # 최근 연간 손익 (돈의 흐름 연간판)
    det["qtrs_y"] = (fins or {}).get("annual")  # 실적 요약 그림 연간 보기
    det["kq"] = None
    if mkt == "KR" and not h.get("data_code"):  # 최신 분기 실적(잠정) vs 컨센서스
        try:
            det["kq"] = kq.collect(code)
        except Exception as e:  # noqa: BLE001
            REPORT.block("최신 분기 실적", f"{name}: {str(e)[:60]}")
    elif mkt == "US":  # 미국: EPS 예상 vs 발표 + 매출·영업이익 (야후)
        try:
            det["kq"] = kq.collect_us(code, QTRS.get(tkr), hist)
        except Exception as e:  # noqa: BLE001
            REPORT.block("최신 분기 실적 (미국)", f"{name}: {str(e)[:60]}")
    if mkt == "KR" and det["kq"] and det["qtrs"]:  # 야후에 아직 없는 최신 분기는 잠정실적(매출·영업이익·순이익, 억원 → 원)으로 먼저 — 원가·비용은 분기보고서 뒤
        det["qtrs"] = dict(det["qtrs"])  # 쌓아 두는 야후 캐시(QTRS)는 건드리지 않음
        for q in det["kq"].get("quarters") or []:
            lb = q.get("q") or ""
            if not re.fullmatch(r"\d\d\.[1-4]Q", lb) or not q.get("sales"):
                continue
            e = f"20{lb[:2]}-{('03-31', '06-30', '09-30', '12-31')[int(lb[3]) - 1]}"
            if e > max(det["qtrs"]):
                det["qtrs"][e] = {"rev": q["sales"] * 1e8, "prelim": True, **{k: q[f] * 1e8 for k, f in (("op", "op"), ("ni", "ni")) if q.get(f) is not None}}
    oc = str(h.get("data_code") or code)  # 우선주는 보통주 실적으로
    dq = None
    if mkt == "KR":  # DART 분기보고서 (2015년~, 예전 분기는 갱신마다 조금씩 채움)
        try:
            dq = kr_stock.dart_quarters(oc)
        except Exception as e:  # noqa: BLE001
            REPORT.block("DART 분기 실적", f"{name}: {str(e)[:60]}")
    det["op_yoy"] = op_yoy(oc, mkt, det["kq"], QTRS.get(tkr), (KPI_CFG.get(oc) or {}).get("op_yoy"), dq=dq)
    det["longq"] = long_q(mkt, dq, det["kq"], QTRS.get(tkr), SEC_LONG.get(code))  # 📈 10년 실적 추이
    LONGQ[code] = det["longq"]
    det["shq"] = None  # 📉 주식 수 증가율(YoY)용 분기 주식 수 {분기 끝 날짜: 주}
    if mkt == "KR":  # 보통주 유통주식수 (발행 − 자기주식, 분기 말) — DART 정기보고서
        try:
            det["shq"] = {"src": "dart", "q": kr_stock.dart_shares(oc)}
        except Exception as e:  # noqa: BLE001
            REPORT.block("DART 주식 수", f"{name}: {str(e)[:60]}")
    else:  # 희석 가중평균 — 예전 분기는 SEC (tools/sec_backfill.py), 야후가 주는 최근 5~6분기는 야후 (날짜가 며칠 다른 같은 분기는 야후로)
        yq = {e: v["dil"] for e, v in (QTRS.get(tkr) or {}).items() if v.get("dil")}
        q = {e: v["dil"] * 1e6 for e, v in (SEC_LONG.get(code) or {}).items() if v.get("dil")
             and not any(abs((pd.Timestamp(e) - pd.Timestamp(y)).days) < 20 for y in yq)}
        det["shq"] = {"src": "sec", "q": dict(sorted({**q, **yq}.items()))} if q or yq else None
    sd = CMP.get("samsung_ds") or {}
    if oc == "005930" and sd.get("rev"):  # 삼성전자는 순수 반도체 회사가 아니라 DS(반도체) 부문만 따로 (조원 → 억원)
        det["longq_seg"] = {"name": "DS(반도체)", "q": {str(k): {"rev": v * 1e4, **({"op": sd["op"][k] * 1e4} if (sd.get("op") or {}).get(k) is not None else {})}
                                                    for k, v in sd["rev"].items()}}
    mc = (det.get("now") or {}).get("market_cap")  # 그 나라 돈 기준 시가총액
    if code in (CMP.get("mcap") or []) and mc and price:  # ⚖️ 비교 탭 시가총액 (지금 주식 수 × 주봉 종가 — 자사주·증자는 못 반영)
        MCAP_W[code] = {"cur": currency, "shares": mc / price,
                        "w": {d.strftime("%Y-%m-%d"): rnd(float(v), 2) for d, v in C.weekly_close(px).items()}}
    det["flow"] = None
    if mkt == "KR" and not h.get("data_code"):  # 외국인·기관·개인이 1년 동안 어느 가격대에서 샀나 (KRX)
        try:
            det["flow"] = flows.collect(code, px)
        except Exception as e:  # noqa: BLE001
            REPORT.block("투자자별 매매 (KRX)", f"{name}: {str(e)[:60]}")
    if mkt == "KR" and not h.get("data_code"):
        if det["kq"] and wise:  # 연간 보기: 와이즈리포트 연간 실적 + 추정 (억원)
            det["kq"]["annual"] = [{"q": f"{str(yy)[2:]}{'E' if r.get('estimate') else ''}", "est": bool(r.get("estimate")),
                                    **{f: r.get(f) for f in ("sales", "op", "ni")}} for yy, r in sorted(wise.items()) if r.get("sales") is not None]
        if det["kq"]:  # 분기 보기 뒤에 붙일 다음 분기들 추정 (와이즈리포트 '분기' 탭, 보통 3개 분기)
            try:
                wq = kr_stock.wise_annual(code, freq="Q")
                det["kq"]["fwd"] = [{"q": kq.label(qk) + "E", "est": True, **{f: r.get(f) for f in ("sales", "op", "ni", "eps")}}
                                    for qk, r in sorted(wq.items()) if r.get("estimate") and kq.label(qk) > det["kq"]["latest"]]
            except Exception as e:  # noqa: BLE001
                REPORT.block("와이즈리포트 분기 추정", f"{name}: {str(e)[:60]}")
    det["seg"] = None  # 부문별 매출 (🧩 제품·부문별 매출 칸 · 돈의 흐름 왼쪽)
    if mkt == "KR":
        try:
            pm = kr_stock.product_mix(fcode)
            if pm and pm["asof"]:
                SEGS[fcode] = dict(sorted({**SEGS.get(fcode, {}), pm["asof"]: pm["mix"]}.items())[-8:])
        except Exception as e:  # noqa: BLE001
            REPORT.block("주요제품 매출구성", f"{name}: {str(e)[:60]}")
        if SEGS.get(fcode):
            det["seg"] = {"unit": "pct", "src": "와이즈리포트 주요제품 매출구성 (분기·반기·사업보고서)", "hist": SEGS[fcode]}
    s = SEG_US.get(code) or SEG_US.get(fcode)  # 회사 실적 자료를 보고 직접 적은 분기 금액이 있으면 그걸 씀 (미국 백만 달러, 한국 억원)
    if s:
        det["seg"] = {"unit": "amt", "src": s.get("src"), "hist": {q: {k: v * (1e6 if mkt == "US" else 1e8) for k, v in m.items()} for q, m in s["quarters"].items()}}
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
    ppx = px
    try:  # 📐 주봉 차트 모양 (컵위드핸들·추세선·전고점) — 미국은 배당으로 깎지 않은 주가 (차트 프로그램과 같은 기준)
        ppx = us_stock.price_history(code, div=True) if mkt == "US" and "DIV" not in methods else px
        det["pattern"] = patterns.weekly(ppx, 2 if currency == "USD" else 0)
        det["card"]["pat"] = (det["pattern"] or {}).get("sig") or None
    except Exception as e:  # noqa: BLE001
        REPORT.block("주봉 차트 모양", f"{name}: {str(e)[:60]}")
    try:  # 📏 이익 vs 주가 (지난 최대 10년, 주가는 배당 뺀 값) — 종목 상세 + 비교표 '성장' 칸
        det["long"] = C.long_cagr(det["longq"], ppx)
        if tbl is not None and det["long"]:
            tbl.update(op10=det["long"]["op_cagr"], px10=det["long"]["px_cagr"], rr10=det["long"]["rerate"])
    except Exception as e:  # noqa: BLE001
        REPORT.block("이익 vs 주가 10년", f"{name}: {str(e)[:60]}")
    try:  # 📈 이익 추정치 변화 (매일 쌓음) — 한국 = 와이즈리포트 연간 영업이익 추정(억원), 미국 = 야후 연간 EPS 추정
        if mkt == "KR" and wise and not h.get("data_code"):
            est_track.record(code, {str(y)[2:]: r["op"] for y, r in wise.items() if r.get("estimate") and r.get("op") is not None})
            det["est"] = est_track.view(code, "억원", "영업이익")
        elif mkt == "US":
            vals, trend = est_track.us(tkr, det.get("qtrs_y"))
            est_track.record(code, vals)
            det["est"] = est_track.view(code, "$", "EPS", trend)
        det["card"]["est"] = est_track.brief(det.get("est"))
    except Exception as e:  # noqa: BLE001
        REPORT.block("이익 추정치 변화", f"{name}: {str(e)[:60]}")
    # 카드 꼬리표 '💸 현금흐름': 최근 두 분기 FCF (야후 분기 재무제표 + 아직 야후에 없는 최신 분기는 kpi.yaml fcf_add)
    qf = [(kq._qlabel(e), q["fcf"]) for e, q in sorted((det["qtrs"] or {}).items()) if q.get("fcf") is not None]
    for qk, v in ((KPI_CFG.get(str(h.get("data_code") or code)) or {}).get("fcf_add") or {}).items():
        if qk not in dict(qf):
            qf.append((qk, v * (1e6 if mkt == "US" else 1e8)))  # 미국 백만 달러, 한국 억원
    det["card"]["fcf"] = qf[-2:] if len(qf) >= 2 else None
    det["card"]["sa_div"] = ((SOMONG.get(code) or {}).get("my") or {}).get("sa_div")  # 배당주 점검 (시킹알파 숫자를 직접 적은 것)
    det["card"]["notes"] = NOTES.get(code)
    det["segc"] = SEGC.get(code)
    k = det.get("kq") or {}  # 카드 꼬리표: 새 분기 실적을 발표한 지 3일 안이거나, 잠정실적 공시가 나고 숫자 반영을 기다리는 중
    det["card"]["kq_date"] = k.get("date")  # 마지막 실적 발표일 → 📬 시킹알파 값 다시 볼 때 (화면 saDue)
    if k.get("date") and (now_kst().date() - pd.Timestamp(k["date"]).date()).days <= 3:
        det["card"]["kq_new"] = k["latest"]
        det["card"]["kq_brief"] = {f: k.get(f) for f in ("cur", "latest", "prelim", "date", "rows", "quarters", "est_bar", "filing", "annual", "fwd")}  # 첫 화면 '🧾 실적 발표'
    if k.get("waiting"):
        det["card"]["kq_wait"] = (k.get("next") or {}).get("q")
    return det


def _scen_text(scen):
    """'12MF EPS × Base PER 22.5배 (화장품 브랜드)' 처럼."""
    base = {"PER": "EPS", "PBR": "BPS"}
    parts = [f"12MF {base[p['kind']]} × {p['src']} 평균 {p['kind']}" if "밴드" in p["src"] else
             f"12MF {base[p['kind']]} × {p['kind']} {p['mult']['base']:g}배 ({p['src']})" for p in scen["parts"]]
    return parts[0] if len(parts) == 1 else "두 값 평균: " + " / ".join(parts)


def _round_scen(scen, dg):
    if not scen:
        return None
    return {**{k: rnd(scen[k], dg) for k in ("bear", "base", "bull")}, "parts": scen["parts"], "note": scen["note"],
            "growth": scen.get("growth"), "e27": scen.get("e27"), "alt": scen.get("alt"), "ways": scen.get("ways"), "e12": scen.get("e12"),
            "ltg_cmp": scen.get("ltg_cmp"), "sa_date": scen.get("sa_date"), "ltg_note": scen.get("ltg_note"),
            "rerating": scen.get("rerating"), "sector": scen.get("sector"), "ind": scen.get("ind"),
            "y2": scen.get("y2"), "sa_ref": scen.get("sa_ref"), "regime": scen.get("regime"),
            "bull_mkt": {k: rnd(v, dg) for k, v in (scen.get("bull_mkt") or {}).items()} or None}


def _klabel(e):
    """핵심 지표와 같은 분기 이름: 분기 끝 날짜에서 45일 뺀 날의 달력 분기 ('2026-07-26' → '26.2Q')"""
    d = pd.Timestamp(e) - pd.Timedelta(days=45)
    return f"{d.year % 100:02d}.{(d.month - 1) // 3 + 1}Q"


def _mlabel(lb):
    """kpi.yaml 분기 이름을 달력 분기로: '26.10월'(엔비디아 10월 끝) → '26.3Q', '26.3Q' 는 그대로"""
    m = re.fullmatch(r"(\d\d)\.(\d+)월", lb)
    return _klabel(f"20{m.group(1)}-{int(m.group(2)):02d}-28") if m else lb


def long_q(mkt, dq, kqd, qtrs, sec=None):
    """📈 10년 실적 {'16.1Q': {rev, op, gp, ocf, capex}} — 한국: DART 분기보고서(억원) + 아직 보고서 전인 최신 분기는 네이버(잠정),
    미국: SEC 백필(cache/sec_longq.json, 백만 달러) + 쌓아 둔 야후 분기. 분기 이름은 달력 분기."""
    out = {}
    if mkt == "KR":
        for k, r in (dq or {}).items():
            if r.get("sales") is not None:
                out[kq.label(k)] = {f: rnd(r[s] / 1e8) for f, s in (("rev", "sales"), ("op", "op"), ("gp", "gp")) if r.get(s) is not None}
        for q in (kqd or {}).get("quarters") or []:
            if q.get("sales") is not None and q["q"] not in out:
                out[q["q"]] = {"rev": q["sales"], **({"op": q["op"]} if q.get("op") is not None else {})}
        for e, v in (qtrs or {}).items():  # FCF·CapEx 는 쌓아 둔 야후 분기에서 (원 → 억원)
            r = out.get(_klabel(e))
            if r is not None and v.get("gp") is not None and "gp" not in r:  # 보고서 전 잠정 분기의 매출총이익 (kpi.yaml qtr_add = 회사 IR)
                r["gp"] = rnd(v["gp"] / 1e8)
            if v.get("capex") is not None and v.get("fcf") is not None and r is not None:
                r.update(capex=rnd(abs(v["capex"]) / 1e8), ocf=rnd((v["fcf"] + abs(v["capex"])) / 1e8))
    else:
        for e, v in (sec or {}).items():
            out[_klabel(e)] = dict(v)
        for e, v in (qtrs or {}).items():
            row = out.setdefault(_klabel(e), {})
            row.update({f: rnd(v[f] / 1e6) for f in ("rev", "op", "gp") if v.get(f) is not None})
            if v.get("capex") is not None:
                row["capex"] = rnd(abs(v["capex"]) / 1e6)
                if v.get("fcf") is not None:
                    row["ocf"] = rnd((v["fcf"] + abs(v["capex"])) / 1e6)
    return dict(sorted((k, v) for k, v in out.items() if v.get("rev"))) or None


def op_yoy(code, mkt, kqd, qtrs, manual=None, n=5, dq=None):
    """📈 영업이익 성장률 (YoY) {'26.3Q': %} 최근 n 분기 — 국내는 이걸로 PER 을 정함.
    쌓아 둔 야후 분기 → 네이버 분기(잠정 포함) → DART 분기보고서(1년 전 같은 분기 숫자가 같이 있음, dq) → kpi.yaml op_yoy 순서로 덮어씀.
    1년 전 영업이익이 0 이하(적자)면 성장률을 안 씀."""
    out = {}

    def put(lb, cur, ago):
        if cur is not None and ago and ago > 0:
            out[lb] = rnd((cur / ago - 1) * 100, 1)

    ago = lambda lb: f"{int(lb[:2]) - 1:02d}{lb[2:]}"
    ops = {_klabel(e): v.get("op") for e, v in (qtrs or {}).items()}
    for lb, v in ops.items():
        put(lb, v, ops.get(ago(lb)))
    if mkt == "KR":  # 미국 kq 분기는 위 야후 분기와 같은 숫자 (이름만 '26.7월' 식이라 빼요)
        ops = {q["q"]: q.get("op") for q in (kqd or {}).get("quarters") or []}
        for lb, v in ops.items():
            put(lb, v, ops.get(ago(lb)))
        for k, r in (dq or {}).items():
            put(kq.label(k), r.get("op"), r.get("op_ago"))
    out.update({str(k): v for k, v in (manual or {}).items()})
    return dict(sorted(out.items())[-n:]) or None


def _price_chart(px, currency, days=250):
    """카드·실적 카드 주가 그림 (1개월~1년 탭): 최근 1년 일봉 종가 + 200일 이동평균선. 3년 이상은 화면이 상세 데이터의 주봉을 씀.
    ma200_state: 200일선 이격(%) · 200일선 방향(20거래일 전보다 오르나) · 최근 20거래일 안에 아래→위로 다시 올라온 날."""
    s = px.dropna().astype(float)
    ma = s.rolling(200).mean()
    t = s.iloc[-days:]
    dg = 2 if currency == "USD" else 0
    out = {"dates": [d.strftime("%Y-%m-%d") for d in t.index], "close": [rnd(v, dg) for v in t],
           "ma200": [rnd(v, dg) if v == v else None for v in ma.loc[t.index]]}  # NaN → None
    if len(s) > 221 and ma.iloc[-1] == ma.iloc[-1]:
        above = (s > ma).iloc[-21:]
        up = [i for i in range(1, len(above)) if above.iloc[i] and not above.iloc[i - 1]]  # 아래 → 위
        out["ma200_state"] = {"gap": rnd((s.iloc[-1] / ma.iloc[-1] - 1) * 100, 1), "rising": bool(ma.iloc[-1] > ma.iloc[-21]),
                              "turning": bool(ma.iloc[-1] < ma.iloc[-6]),  # 최근 5거래일은 내려감 = 꺾이는 중 (하락 전환)
                              "cross_up": above.index[up[-1]].strftime("%Y-%m-%d") if up and above.iloc[-1] else None}
    return out


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


def somong_lines():
    """somong.yaml + 종목마다 'my:' 줄 번호(my_line) — 화면의 ✏️ '내가 정한 PER 적기' 링크가 깃허브 그 줄로 바로 가게."""
    sm = load_yaml("somong.yaml") or {}
    code = None
    for i, line in enumerate((DATA.parent.parent / "config" / "somong.yaml").read_text(encoding="utf-8").splitlines(), 1):
        m = re.match(r"""^['"]?([0-9A-Za-z.]+)['"]?:\s*$""", line)
        if m:
            code = m.group(1)
        elif code and line.strip() == "my:" and isinstance(sm.get(code), dict) and isinstance(sm[code].get("my"), dict):
            sm[code]["my_line"] = i
    return sm


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
    rcfg = SETTINGS.get("market_regime") or {}  # 한국 = 국고채 3년 3%, 미국 = 미국채 10년 5% 이상이면 긴축
    regime = {mk: attempt(f"시장 국면 ({nm})", lambda t=t, nm=nm, rt=rt, rn=rn, tt=tt: C.market_regime(us_stock.price_history(t), nm, rt, rn, tt))
              for mk, t, nm, rt, rn, tt in (("KR", "^KS11", "코스피", kr3, "국고채 3년", rcfg.get("kr3y_tight", 3.0)),
                                           ("US", "^GSPC", "S&P500", us10, "미국채 10년", rcfg.get("us10y_tight", 5.0)))}

    print("■ 보유종목")
    cards = []
    prev_cards = {c["code"]: c for c in prev.get("stocks", [])}
    sy = load_yaml("stocks.yaml")
    # 보유 + 관심(watchlist) + 공동자산(joint) 모두 같은 계산. 화면은 group 으로 탭을 나눠 보여줌
    # 같은 종목이 여러 묶음에 있으면(예: 보유이면서 공동자산) 한 번만 계산하고, 나머지 묶음은 카드의 also 로 → 그 탭에도 보임
    todo, first = [], {}
    for key, g in (("holdings", "보유"), ("watchlist", "관심"), ("joint", "공동")):
        for h in sy.get(key) or []:
            if str(h["code"]) in first:
                first[str(h["code"])]["_also"].append(g)
            else:
                first[str(h["code"])] = dict(h, _also=[])
                todo.append((first[str(h["code"])], g))
    budget = float(os.environ.get("STOCK_BUDGET_MIN") or 55) * 60  # ⏱ 시작부터 이만큼 지나면 남은 종목은 직전 값 → 뒤 작업·저장은 끝까지
    skipped = []
    for i, (h, g) in enumerate(todo):
        code = str(h["code"])
        if (now_kst() - t0).total_seconds() > budget and code in prev_cards:
            cards.append(dict(prev_cards[code], stale=True, order=i, group=g, also=h["_also"]))
            skipped.append(h["name"])
            REPORT.block("시간 부족", f"{h['name']}: 직전 값 그대로 (다음 갱신 때 다시 계산)")
            continue
        try:
            det = stock_detail(h, {"us10y": us10, "kr3y": kr3, "regime": regime}, fx)
            det["card"]["order"] = i
            det["card"]["group"], det["card"]["also"] = g, h["_also"]
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
                c = dict(prev_cards[code], stale=True, order=i, group=g, also=h["_also"])
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
                # 🎯 실적이 아직 안 채워진 분기의 사업부문별 예상치가 있으면 표시 (발표 전에 살펴보기)
                segc = next((q for q, v in (SEGC.get(str(h["code"])) or {}).items() if all(i.get("act") is None for i in v.get("items", []))), None)
                cal.append({**ev, "name": h["name"], "code": str(h["code"]), "group": g, "market": h.get("market", "KR").upper(), "dday": days, "segc": segc})
    cal.sort(key=lambda x: x["when"])
    # 🏗 빅테크 CapEx (분기, 십억 달러): 야후 분기 현금흐름표 + 야후에 아직 없는 최신 분기는 kpi.yaml capex_add (보도자료)
    capex = []
    for t, nm in BIGTECH:
        q = {kq._qlabel(e): rnd(-v["capex"] / 1e9, 1) for e, v in sorted((QTRS.get(t) or {}).items()) if v.get("capex") is not None}
        for qk, v in ((KPI_CFG.get(t) or {}).get("capex_add") or {}).items():
            q.setdefault(qk, rnd(v / 1e3, 1))
        est = {qq: next((i for i in v.get("items", []) if str(i["n"]).startswith("CapEx")), None) for qq, v in (SEGC.get(t) or {}).items()}
        est.update({qk: {"n": "CapEx", **v} for qk, v in ((KPI_CFG.get(t) or {}).get("capex_cons") or {}).items()})  # 컨센 표가 부문 예상보다 우선
        capex.append({"t": t, "name": nm, "q": dict(sorted(q.items())), "est": {k: v for k, v in est.items() if v}})
    fcf, guide = [], []
    for t, nm in M7:  # 💸 M7 현금흐름(FCF) 추이 + CapEx 가이던스 (🇺🇸 보유 탭) — 야후 분기 → 보도자료 fcf_add → 예전 분기 fcf_hist
        kc = KPI_CFG.get(t) or {}
        q = {_klabel(e): rnd(v["fcf"] / 1e9, 2) for e, v in sorted((QTRS.get(t) or {}).items()) if v.get("fcf") is not None}
        for add in (kc.get("fcf_add"), kc.get("fcf_hist")):
            for qk, v in (add or {}).items():
                q.setdefault(_mlabel(str(qk)), rnd(v / 1e3, 2))
        if q:
            fcf.append({"t": t, "name": nm, "q": dict(sorted(q.items())[-10:])})
        if kc.get("capex_guide"):
            guide.append({"t": t, "name": nm, "pts": kc["capex_guide"]})
    write_json(DATA / "capex.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "cos": capex, "fcf": fcf, "guide": guide,
                                     "peak": load_yaml("peak.yaml") or None, "money": load_yaml("bigtech.yaml") or None,  # 🔍 빅테크 숨은 숫자
                                     "src": "야후 파이낸스 분기 현금흐름표 (설비투자) · 최신 분기는 보도자료 · 컨센 = config/kpi.yaml capex_cons (없으면 seg_cons.yaml)"})
    write_json(DATA / "ir_calendar.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "items": cal})
    # ⚖️ 비교 탭 (config/compare.yaml): 종목 10년 실적 + 주봉 시가총액 + 원/달러 (분기 평균·주봉) — 달러로 바꿔 나란히 보기
    fx_q, fx_w = {}, {}
    try:
        fxs = us_stock.price_history("KRW=X")
        fx_q = {f"{p.year % 100:02d}.{p.quarter}Q": round(float(v), 1) for p, v in fxs.groupby(fxs.index.to_period("Q")).mean().items()}
        fx_w = {d.strftime("%Y-%m-%d"): round(float(v), 1) for d, v in C.weekly_close(fxs).items()}
    except Exception as e:  # noqa: BLE001
        REPORT.block("비교 탭 환율", str(e)[:60])
    # longq = 모든 종목 (📊 종목 골라 비교)
    write_json(DATA / "compare.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "cfg": CMP,
                                       "longq": {c: v for c, v in LONGQ.items() if v}, "mcap": MCAP_W, "fx_q": fx_q, "fx_w": fx_w})

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
        ins = (hd["companies"].get(c["code"]) or {}).get("insider") or {}
        if ins.get("major_sell") or ins.get("exec_buyers") or ins.get("exec_sellers"):  # 최근 3개월 대주주 장내매도 / 임원 장내매수 (깡토 백테스트) + 임원·대표 장내매도 (사용자 원칙)
            c["insider"] = {k: ins.get(k) for k in ("major_sell", "exec_buyers", "buy", "sell", "exec_sell", "exec_sellers", "ceo_sell")}

    print("■ 중요 공시")
    import filings
    write_json(DATA / "filings.json", filings.collect(hd))  # 📢 종목 상세 '중요 공시' (공급계약·자사주·배당·시설투자·장래계획·임원 매매)

    print("■ 뉴스")
    import news
    write_json(DATA / "news.json", news.collect(todo))

    print("■ 증권사 리포트")
    import reports
    write_json(DATA / "reports.json", reports.collect(todo))

    write_json(DATA / "broker_targets.json", load_yaml("broker_targets.yaml") or {})  # 손으로 적는 증권사 목표주가
    write_json(DATA / "defense.json", {**(load_yaml("defense.yaml") or {}), "sector": SECTORS.get("방산")})  # 🛡 산업 탭 방산 칸
    write_json(DATA / "keychart.json", load_yaml("keychart.yaml") or {})  # 🔑 키팩터·키차트 (산업 탭 + 종목 상세)
    write_json(DATA / "tourism.json", load_yaml("tourism.yaml") or {})  # 출입국 관광통계 (롯데쇼핑 상세)
    write_json(DATA / "kpi.json", load_yaml("kpi.yaml") or {})  # 🔑 종목별 핵심 지표 (실적발표·전자공시에서 옮김, 상세 화면)
    import kbeauty
    write_json(DATA / "amazon_kbeauty.json", kbeauty.collect())  # 🏭 산업 탭: 아마존 K-뷰티 Top100 (텔레그램 3곳 크로스체크)
    write_json(DATA / "profiles.json", load_yaml("profiles.yaml") or {})
    write_json(DATA / "earnings.json", load_yaml("earnings.yaml") or {})  # 실적발표(컨퍼런스콜) 요약
    write_json(DATA / "events.json", load_yaml("events.yaml") or [])  # 🐣 주린이용 쉬운 이벤트 요약 (공시·촉매·전망 변화)
    write_json(CACHE / "ltg_gap.json", LTG_GAP)
    write_json(CACHE / "quarters.json", QTRS)
    write_json(CACHE / "segments.json", SEGS)
    write_json(CACHE / "q_cons.json", kq.CONS)  # 발표 전 컨센서스 (예상 대비 계산용)
    write_json(CACHE / "q_hist.json", kq.HIST)
    write_json(DATA / "somong.json", somong_lines())  # 강의 체크리스트 (지갑털이·올리고폴리·아무나이겨라·굿보스 등)  # 기업 프로필 (한 줄 설명·매출 비중·점유율·IR 링크, 조사해서 적는 값)

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
        "status": {"failures": REPORT.failures, "blocked": REPORT.blocked, "ok": len(REPORT.ok), "stale": skipped,
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
