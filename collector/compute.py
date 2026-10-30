"""밴드·적정가·신호 계산. 모든 숫자에 출처를 붙여 화면으로 넘긴다."""
import math
import statistics

import pandas as pd

from common import SETTINGS, now_kst, rnd

BAND = SETTINGS["band"]
SIG = SETTINGS["stock_signal"]


def weekly_close(series):
    s = series.dropna().sort_index()
    w = s.resample("W-FRI").last().dropna()
    if len(s):
        w.index = list(w.index[:-1]) + [s.index[-1]]
    return w


def fy_for(d, fy_month=12):
    """날짜 d 에 '확정 실적'으로 쓸 회계연도: 결산 후 3개월(사업보고서 제출) 뒤부터 사용."""
    y = d.year
    # 12월 결산 기준: 4월부터 전년도 실적 사용
    if fy_month == 12:
        return y - 1 if d.month >= 4 else y - 2
    return y - 1 if d.month > ((fy_month + 3 - 1) % 12) + 1 else y - 2


def stats(values):
    v = [x for x in values if x is not None and math.isfinite(x)]
    if len(v) < 8:
        return None
    s = pd.Series(v)
    return {"avg": rnd(s.mean()), "low": rnd(s.quantile(BAND["low_pct"] / 100)),
            "high": rnd(s.quantile(BAND["high_pct"] / 100)), "min": rnd(s.min()), "max": rnd(s.max()),
            "n": len(v)}


def pct_rank(values, cur):
    v = [x for x in values if x is not None and math.isfinite(x)]
    if not v or cur is None:
        return None
    return round(sum(1 for x in v if x < cur) / len(v) * 100, 1)


def build_band(price_w, hist, key, invert=False, shift=0):
    """key: eps → PER, bps → PBR, dps → 배당수익률.
    shift=1 이면 '조정 PER'·'그해 BPS': 그 시점 기준 1년 뒤 실적(아직 안 나온 해는 추정치)으로 나눈다.
    이익·자본이 빠르게 늘던 시기에 지난 실적 PER·PBR 이 부풀려지는 것을 바로잡는다.
    반환: 주간 날짜·가격·주당값·배수 배열 + 기간별 통계."""
    dates, prices, base, mult = [], [], [], []
    # 각 실적을 '언제부터 쓸 수 있었는지' (결산 후 보고서 제출 시점). 한국 12월 결산 = 다음 해 4월 1일
    avail = sorted((rec.get("avail") or f"{y + 1}-04-01", y) for y, rec in hist.items() if not rec.get("estimate"))
    for d, p in price_w.items():
        ds = d.strftime("%Y-%m-%d")
        known = [y for a, y in avail if a <= ds]
        if not known:
            continue
        fy = max(known) + shift
        rec = hist.get(fy)
        if shift and (rec or {}).get(key) is None:  # 추정치가 없는 종목은 최근 구간만 직전 확정치로
            rec = hist.get(fy - shift)
        if not rec or (rec.get("estimate") and not shift) or rec.get(key) is None:
            continue
        b = rec[key]
        if key == "dps":
            m = b / p * 100 if p else None
        else:
            m = p / b if b and b > 0 else None
        dates.append(d.strftime("%Y-%m-%d"))
        prices.append(round(p, 0))
        base.append(round(b, 2))
        mult.append(rnd(m, 3) if m is not None else None)
    if len(dates) < 20:
        return None
    end = pd.Timestamp(dates[-1])
    out = {"dates": dates, "price": prices, "base": base, "mult": mult, "periods": {}}
    cap = BAND.get("per_cap") if key == "eps" else None
    for label, years in (("all", None), ("10y", 10), ("5y", 5)):
        if years:
            cut = (end - pd.DateOffset(years=years)).strftime("%Y-%m-%d")
            vals = [m for d, m in zip(dates, mult) if d >= cut]
        else:
            vals = mult
            cut = dates[0]
        if cap:  # 이익이 거의 없던 시기의 비정상적인 PER 은 통계에서 뺀다
            vals = [m for m in vals if m is None or m <= cap]
        st = stats(vals)
        if st:
            st["from"] = max(cut, dates[0])
            st["pos"] = pct_rank(vals, mult[-1])
            if invert and st["pos"] is not None:  # 배당수익률은 높을수록 싸다
                st["pos_cheap"] = round(100 - st["pos"], 1)
        out["periods"][label] = st
    out["start"] = dates[0]
    out["basis"] = "forward" if shift else "trailing"
    out["short_history"] = (pd.Timestamp(dates[-1]) - pd.Timestamp(dates[0])).days < 365 * 9.5
    return out


def fwd_years(hist):
    y = now_kst().year
    return [y, y + 1, y + 2]


def ylabel(y):
    return f"{str(y)[2:]}E"


def fwd12(hist, key):
    """12개월 선행값: 올해 추정과 내년 추정을 남은 기간 비율로 섞는다.
    미국처럼 회계연도 끝(fy_end)이 있으면 그 날짜 기준 (마이크로소프트 6월, 엔비디아 1월 결산 등)."""
    now = now_kst()
    fys = sorted((pd.Timestamp(r["fy_end"]), y) for y, r in hist.items() if r.get("fy_end") and r.get(key) is not None)
    if fys:
        today = pd.Timestamp(now.date())
        i = next((k for k, (e, _) in enumerate(fys) if e >= today), None)
        if i is not None and i + 1 < len(fys):
            (e0, y0), (_, y1) = fys[i], fys[i + 1]
            w0 = min(1.0, max(0.0, (e0 - today).days / 365.25))  # 지금 회계연도에 남은 기간 비율
            return w0 * hist[y0][key] + (1 - w0) * hist[y1][key]
    a = hist.get(now.year, {}).get(key)
    b = hist.get(now.year + 1, {}).get(key)
    if a is None or b is None:
        return None
    w0 = max(0.0, (12 - (now.month - 1) - now.day / 31) / 12)
    return w0 * a + (1 - w0) * b


def cons_growth(hist, y0, key="eps"):
    """컨센서스(증권사 추정 합산) 앞으로 3년 성장률 (key = eps 또는 op 영업이익): 작년 실적→올해E→… 중 마지막 3구간 (29E 까지 있으면 26→27→28→29).
    연평균(CAGR)을 쓰되, 한 해가 튀면(역성장, 또는 가장 큰 해가 가장 작은 해의 3배 이상) 해마다 성장률의 중앙값."""
    e = {y: (hist.get(y) or {}).get(key) for y in range(y0 - 1, y0 + 5)}
    ys = [y0 - 1]
    while e.get(ys[-1] + 1) and hist[ys[-1] + 1].get("estimate"):
        ys.append(ys[-1] + 1)
    ys = ys[-4:]
    if len(ys) < 3 or any(not e[y] or e[y] <= 0 for y in ys[:-1]):
        return None
    lab = lambda y: ylabel(y) if hist[y].get("estimate") else str(y)[2:]  # noqa: E731
    steps = [(f"{lab(a)}→{lab(b)}", (e[b] / e[a] - 1) * 100) for a, b in zip(ys, ys[1:])]
    vals = [v for _, v in steps]
    cagr = ((e[ys[-1]] / e[ys[0]]) ** (1 / (len(ys) - 1)) - 1) * 100 if e[ys[-1]] > 0 else None
    odd = cagr is None or min(vals) <= 0 or max(vals) / min(vals) >= 3
    g = statistics.median(vals) if odd else cagr
    txt = " · ".join(f"{k} {v:+.0f}%" for k, v in steps)
    how = f"해마다 성장률이 들쭉날쭉해 중앙값 {g:.1f}%" if odd else f"연평균 {g:.1f}%"
    return g, f"컨센서스 {'영업이익' if key == 'op' else 'EPS'} {txt} → {how}"


def growth_fair(hist, adj_candidates=(), force_adj=False):
    """내 엑셀 '소몽의 적정주가 템플릿' 방식의 적정 PER.
    평균성장률 = 21년~올해(E) EPS 전년 대비 성장률의 중앙값 (코로나·기저효과·금리 급등기 튀는 해의 영향을 줄임).
    역성장한 해가 있거나 성장률이 50% 를 넘으면(이익 변동이 너무 큼) 보정값(앞으로 3~5년 연평균 성장률 추정) 사용.
    force_adj: 보정값이 있으면 늘 보정값 (한국 = 컨센서스 3년 영업이익 성장률).
    적정 PER: Bear(하방) = 성장률 × 1, Base(적정주가) = × 1.5, Bull(최대, 금리가 다시 내려갈 때) = × 2."""
    y = now_kst().year
    years = list(range(y - 6, y + 3))
    eps = {yy: (hist.get(yy) or {}).get("eps") for yy in years}
    yoy = {}
    for yy in range(y - 5, y + 3):
        a, b = eps.get(yy), eps.get(yy - 1)
        yoy[yy] = (a / b - 1) * 100 if (a is not None and b and b > 0) else None
    window = [yoy[yy] for yy in range(y - 5, y + 1) if yoy.get(yy) is not None]
    med = statistics.median(window) if len(window) >= 3 else None
    # 역성장 확인은 최근 3년(작년 전·작년·올해E)만: 오래된 해의 튀는 값은 중앙값이 이미 걸러 준다
    recent = [yoy[yy] for yy in range(y - 2, y + 1) if yoy.get(yy) is not None]
    neg = any(v < 0 for v in recent) or any(eps.get(yy) is not None and eps[yy] <= 0 for yy in range(y - 3, y + 1))
    adj = [(v, src) for v, src in adj_candidates if v is not None and v > 0]
    adj_v, adj_src = min(adj) if adj else (None, None)  # 여러 추정이 있으면 보수적으로 낮은 쪽
    # 과거(중앙값)와 앞으로 예상(보정값)이 2배 넘게 다르면 과거 성장이 계속된다고 보기 어려워 보정값 (PER 상한은 두지 않음)
    gap2 = bool(med and med > 0 and adj_v and max(med, adj_v) / min(med, adj_v) >= 2)
    if force_adj and adj_v:
        g, src = adj_v, adj_src
    elif med is not None and med > 0 and not neg and med <= 50 and not gap2:
        g, src = med, "기본값: 21년~올해 EPS 성장률 중앙값"
    elif adj_v:
        why = ("최근 3년 중 역성장한 해가 있어" if neg else "성장률이 50% 를 넘어" if med and med > 50
               else "과거와 앞으로 예상 성장률이 2배 넘게 달라" if gap2 else "성장률을 구할 수 없어")
        g, src = adj_v, f"보정값({adj_src}) — {why}"
    elif med is not None and med > 0:
        g, src = med, "기본값 (보정값 없음, 변동 큼 주의)"
    else:
        return None
    return {"g": rnd(g, 1), "src": src, "median": rnd(med, 1), "adj": rnd(adj_v, 1), "adj_src": adj_src,
            "mult": {"bear": rnd(g, 1), "base": rnd(g * 1.5, 1), "bull": rnd(g * 2, 1)},
            "years": [ylabel(yy) if (hist.get(yy) or {}).get("estimate") else str(yy)[2:] for yy in years],
            "eps": [eps[yy] for yy in years], "yoy": [None] + [rnd(yoy.get(yy), 1) for yy in years[1:]],
            "window": f"{str(y - 5)[2:]}~{str(y)[2:]}E"}


def market_regime(idx, idx_name, us10y, rate_name="미국채 10년", tight=None):
    """시장 국면: 금리(미국 = 미국채 10년 5%, 한국 = 국고채 3년 3%)가 기준 이상(긴축)이거나 지수가 200일 평균 아래·평균선이 한 달 전보다
    낮으면(약세·횡보) tight. 셋 다 아니면(금리 낮고 지수가 오르는 평균선 위) easy. us10y 자리에 그 나라 금리를 넣음."""
    cfg = SETTINGS.get("market_regime") or {}
    tight = cfg.get("us10y_tight", 5.0) if tight is None else tight
    why = []
    if us10y is not None and us10y >= tight:
        why.append(f"{rate_name} {us10y:.2f}% (≥ {tight:g}%, 긴축)")
    days = cfg.get("ma_days", 200)
    s = idx.dropna() if idx is not None else None
    if s is not None and len(s) > days + 21:
        ma = s.rolling(days).mean()
        if s.iloc[-1] < ma.iloc[-1]:
            why.append(f"{idx_name} {days}일 평균 아래 ({(s.iloc[-1] / ma.iloc[-1] - 1) * 100:+.1f}%)")
        if ma.iloc[-1] < ma.iloc[-22]:
            why.append(f"{idx_name} {days}일 평균선이 한 달 전보다 낮음 (내려가는 중)")
    fixed = cfg.get("mode", "auto")
    mode = fixed if fixed in ("tight", "easy") else ("tight" if why else "easy")
    if not why:
        why.append(f"{rate_name} {us10y:.2f}% · {idx_name} 오르는 {days}일 평균선 위" if us10y is not None else f"{idx_name} 오르는 {days}일 평균선 위")
    return {"mode": mode, "why": why, "manual": fixed in ("tight", "easy"),
            "label": "긴축·약세장" if mode == "tight" else "완화·강세장"}


def too_high(m, e12, price, band, sector=None, sec_name=None):
    """성장률 PER 로 잡은 하방(Bear = 12MF EPS × 성장률 × 1)이 지금 가격보다 50% 넘게 높으면 성장률이 너무 센 것
    (수출주처럼 이익이 한 해 확 튀어 3년 성장률이 부푼 경우, 예: 달바글로벌·에이피알).
    → 업종 PER(sectors.yaml 바닥·보통·최고), 업종이 없으면 이 종목 10년 PER 밴드(하단·평균·상단)로 바꿈. 아니면 None.
    하방 배수(성장률 × 1)부터 12MF PER 상한(35배)을 넘어도 성장률 방식은 의미가 없어서 똑같이 바꿈 (두산에너빌리티 39.6%)."""
    cap = (SETTINGS.get("market_regime") or {}).get("per_max", 35)
    over = m["bear"] > cap
    if not (e12 and e12 > 0 and price and (over or e12 * m["bear"] > price * 1.5)):
        return None
    why = (f"성장률 PER {m['bear']:g}배가 {cap:g}배를 넘어 의미가 없어서" if over else
           f"성장률 PER {m['bear']:g}배로 잡은 하방이 지금 가격보다 {(e12 * m['bear'] / price - 1) * 100:.0f}% 높아서")
    if sector and str(sector.get("kind", "PER")).upper() == "PER":
        return {k: sector[k] for k in ("bear", "base", "bull")}, f"{sec_name} 업종 PER (바닥 · 보통 · 최고) — {why}"
    st = (band or {}).get("periods", {})
    st = st.get("10y") or st.get("all") or {}
    if st.get("low") and st["low"] > 0:
        return {"bear": st["low"], "base": st["avg"], "bull": st["high"]}, f"이 종목 PER 밴드 (하단 · 평균 · 상단) — {why}"
    return None


def scenarios(price, hist, bands, kinds, sector=None, per_growth=None):
    """적정주가 Bear(하방) / Base(적정주가) / Bull(최대): 12개월 선행(12MF) EPS·BPS × 배수.
    PER 배수는 성장률 방식(growth_fair: 성장률 × 1 / 1.5 / 2)이 있으면 그것, 업종 배수(sectors.yaml)를 고른 종목은 그것,
    둘 다 없으면 그 종목의 10년 밴드 하단·평균·상단. PBR 은 10년 밴드. PER·PBR 둘 다 쓰는 종목은 평균."""
    parts = []
    for kind in kinds:
        key = {"PER": "eps", "PBR": "bps"}.get(kind)
        v = fwd12(hist, key) if key else None
        if not v or v <= 0:
            continue
        if kind == "PER" and per_growth:
            m = dict(per_growth["mult"])
            src = per_growth.get("part_src") or f"성장률 {per_growth['g']:g}%"
            how = per_growth.get("how") or f"{per_growth.get('label') or '성장률'} {per_growth['g']:g}% × 1 · 1.5 · 2"
        elif sector and sector.get("kind", "PER").upper() == kind:
            m = {k: sector[k] for k in ("bear", "base", "bull")}
            src = sector["name"]
            how = f"{src} 업종 PER (바닥 · 보통 · 최고)"
        else:
            b = bands.get(kind) or {}
            st = b.get("periods", {}).get("10y") or b.get("periods", {}).get("all") or {}
            if not st.get("avg"):
                continue
            m = {"bear": st["low"], "base": st["avg"], "bull": st["high"]}
            src = "10년 밴드" if st.get("from", "9999") <= f"{now_kst().year - 9}-12-31" else f"{st['from'][:4]}년~ 밴드"
            how = f"{src} {kind} 하단(하위 10%) · 평균 · 상단(상위 10%)"
        # 🐂 강세장(금리가 내려가 돈이 풀릴 때) 범위: 성장률 방식은 성장률 × 1.5 ~ × 2, 업종·밴드 PER 은 보통 ~ 보통 × 2 (10·20·30 → 20~40),
        #    PBR 은 보통 ~ 최고
        grow = kind == "PER" and per_growth and not per_growth.get("part_src")
        bm = ({"lo": per_growth["g"] * 1.5, "hi": per_growth["g"] * 2} if grow else
              {"lo": m["base"], "hi": m["base"] * 2} if kind == "PER" else {"lo": m["base"], "hi": m["bull"]})
        cap, over = None, {}
        if kind == "PER":  # 12MF PER 35배 넘는 칸은 의미가 없다고 봐서 35배로 다시 계산 (⚠ 표시)
            cap = SETTINGS.get("market_regime", {}).get("per_max", 35)
            over = {k: rnd(x, 1) for k, x in {**m, **{"bm_" + kk: vv for kk, vv in bm.items()}}.items() if x and x > cap}
            m = {k: min(x, cap) for k, x in m.items()}
            bm = {k: min(x, cap) for k, x in bm.items()}
        bm["mid"] = (bm["lo"] + bm["hi"]) / 2  # 강세장 Base = 하방·상방 가운데 (성장률 × 1.75)
        parts.append({"kind": kind, "base_val": rnd(v, 2), "mult": {k: rnd(x, 2) for k, x in m.items()}, "src": src, "how": how,
                      "price": {k: v * x for k, x in m.items()}, "bm": {k: rnd(x, 2) for k, x in bm.items()},
                      "bm_price": {k: v * x for k, x in bm.items()}, **({"capped": {"max": cap, "from": over}} if over else {})})
    if not parts:
        return None
    out = {k: sum(p["price"][k] for p in parts) / len(parts) for k in ("bear", "base", "bull")}
    out["bull_mkt"] = {k: rnd(sum(p["bm_price"][k] for p in parts) / len(parts), 2) for k in ("lo", "mid", "hi")}
    for p in parts:
        p["price"] = {k: round(x, 2) for k, x in p.pop("price").items()}
        p.pop("bm_price")
    out["parts"] = parts
    out["note"] = sector.get("note") if sector else None
    # 같은 배수를 28E(2년 뒤) EPS·BPS 에 곱한 적정주가 (화면에서 접어 두고 눌러서 봄)
    y2 = now_kst().year + 2
    p2 = [{"kind": p["kind"], "base_val": rnd(hist[y2][k], 2), "mult": p["mult"]} for p in parts
          if (k := {"PER": "eps", "PBR": "bps"}[p["kind"]]) and (hist.get(y2) or {}).get(k) and hist[y2][k] > 0]
    if p2 and len(p2) == len(parts):
        out["y2"] = {"label": ylabel(y2), "parts": p2,
                     **{s: rnd(sum(p["base_val"] * p["mult"][s] for p in p2) / len(p2), 2) for s in ("bear", "base", "bull")}}
    return out


def fwd_multiples(price, hist, kinds):
    """지금 가격을 앞으로의 실적으로 나눈 배수: 26E·27E·28E·12MF PER(PBR). 예: 28E BPS 기준 PBR 1.0배."""
    out = {}
    for kind in kinds:
        key = {"PER": "eps", "PBR": "bps"}.get(kind)
        if not key:
            continue
        row = {}
        for y in fwd_years(hist):
            v = hist.get(y, {}).get(key)
            row[ylabel(y)] = rnd(price / v) if v and v > 0 else None
        f = fwd12(hist, key)
        row["12MF"] = rnd(price / f) if f and f > 0 else None
        out[kind] = row
    return out


def last_actual(hist):
    ys = [y for y, r in hist.items() if not r.get("estimate") and r.get("eps") is not None]
    return max(ys) if ys else None


def bond_signal(ratio):
    b = SETTINGS["bond_signal"]
    if ratio is None:
        return "na"
    return "green" if ratio <= b["green_max"] else "yellow" if ratio <= b["yellow_max"] else "red"


def per_section(price, hist, band):
    ys = fwd_years(hist)
    eps = {ylabel(y): hist.get(y, {}).get("eps") for y in ys}
    fwd_per = {k: rnd(price / v) if v and v > 0 else None for k, v in eps.items()}
    p10, p5 = band["periods"].get("10y") or {}, band["periods"].get("5y") or {}
    multiples = [("5년 평균", p5.get("avg")), ("10년 평균", p10.get("avg")),
                 ("10년 하단", p10.get("low")), ("10년 상단", p10.get("high"))]
    multiples += [(f"{k} PER", v) for k, v in fwd_per.items()]
    matrix = []
    for name, m in multiples:
        row = {"label": name, "mult": m, "cells": {}}
        for k, e in eps.items():
            row["cells"][k] = round(m * e) if (m and e and e > 0) else None
        matrix.append(row)
    # 리레이팅 경고
    rr = SETTINGS["rerating"]
    la = last_actual(hist)
    warn = None
    e_last = hist.get(la, {}).get("eps") if la else None
    e_far = eps.get(ylabel(ys[2])) or eps.get(ylabel(ys[1]))
    pos = p10.get("pos")
    if pos is not None and e_last and e_far and e_last > 0:
        growth = (e_far / e_last - 1) * 100
        if pos >= rr["band_pos"] and growth < rr["eps_growth"]:
            warn = (f"현재 PER 이 10년 밴드 {pos:.0f}% 위치인데, EPS 는 {la}년 대비 "
                    f"{growth:+.0f}%만 늘 전망 → ⚠ 이미 리레이팅 반영 가능성")
    return {"eps": eps, "fwd_per": fwd_per, "matrix": matrix, "rerating_warning": warn}


def pbr_section(price, hist, band, kr3y, cyclical=False):
    ys = fwd_years(hist)
    bps = {ylabel(y): hist.get(y, {}).get("bps") for y in ys}
    p10 = band["periods"].get("10y") or {}
    rows = []
    for name, m in (("10년 평균", p10.get("avg")), ("10년 하단", p10.get("low")), ("10년 상단", p10.get("high"))):
        rows.append({"label": name, "mult": m,
                     "cells": {k: round(m * v) if m and v else None for k, v in bps.items()}})
    actual = sorted([y for y, r in hist.items() if not r.get("estimate") and r.get("roe") is not None])
    roe5 = [hist[y]["roe"] for y in actual[-5:]]
    roe10 = [hist[y]["roe"] for y in actual[-10:]]
    roe_now = hist.get(ys[0], {}).get("roe")
    roe_last = hist[actual[-1]]["roe"] if actual else None
    req = (kr3y + SETTINGS["pbr"]["risk_premium"]) if kr3y is not None else None
    roe_cur = roe_now if roe_now is not None else roe_last
    roe_avg10 = sum(roe10) / len(roe10) if roe10 else None
    # 이익이 출렁이는 업종은 10년 평균 ROE 로: 고점 ROE(하이닉스 26E 103%)를 쓰면 PBR 이 늘 싸 보이는 착시
    norm = bool(cyclical and roe_avg10 and roe_avg10 > 0)
    roe_basis = roe_avg10 if norm else roe_cur
    fair_pbr = roe_basis / req if (roe_basis is not None and req) else None
    cur_bps = bps.get(ylabel(ys[0])) or (hist.get(actual[-1], {}).get("bps") if actual else None)
    cur_pbr = price / cur_bps if cur_bps else None
    verdict = None
    if fair_pbr and fair_pbr > 0 and cur_pbr:
        r = cur_pbr / fair_pbr
        verdict = ("ROE 에 비해 PBR 이 낮아요 (싸 보임)" if r < 0.8 else
                   "ROE 에 비해 PBR 이 높아요 (비싸 보임)" if r > 1.2 else "ROE 에 맞는 수준의 PBR 이에요")
    return {"bps": bps, "matrix": rows, "roe5": rnd(sum(roe5) / len(roe5)) if roe5 else None,
            "roe10": rnd(roe_avg10), "roe_now": rnd(roe_cur),
            "fair_roe": "ROE 10년 평균 기준 (이익이 출렁이는 업종)" if norm else "ROE 현재 기준",
            "roe_now_label": f"{ylabel(ys[0])} 추정" if roe_now is not None else f"{actual[-1]}년 실적" if actual else "",
            "req_return": rnd(req), "fair_pbr": rnd(fair_pbr), "cur_pbr": rnd(cur_pbr), "verdict": verdict,
            "roe10_years": len(roe10)}


def div_section(price, hist, band, kr3y):
    ys = fwd_years(hist)
    p10 = band["periods"].get("10y") or {}
    actual = sorted([y for y, r in hist.items() if not r.get("estimate") and r.get("dps") is not None])
    la = actual[-1] if actual else None
    dps_last = hist[la]["dps"] if la else None
    cur_yield = dps_last / price * 100 if dps_last and price else None
    payouts = [hist[y]["payout"] for y in actual[-3:] if hist[y].get("payout")]
    payout_avg = sum(payouts) / len(payouts) if payouts else None
    scen = []
    for y in ys[:2]:
        k = ylabel(y)
        d_cons = hist.get(y, {}).get("dps")
        eps = hist.get(y, {}).get("eps")
        d_pay = eps * payout_avg / 100 if (eps and payout_avg) else None
        scen.append({"label": f"{k} 배당금(컨센서스)", "dps": rnd(d_cons, 0)})
        scen.append({"label": f"{k} EPS × 배당성향 {payout_avg:.0f}%" if payout_avg else f"{k} EPS × 배당성향",
                     "dps": rnd(d_pay, 0)})
    yields = [("하방 (10년 최고 수익률)", p10.get("high")), ("10년 평균", p10.get("avg")),
              ("상방 (10년 최저 수익률)", p10.get("low"))]
    no_history = not p10.get("avg")  # 배당을 막 시작해 과거 배당수익률이 없으면 목표 수익률로 계산
    if no_history:
        yields = [(f"수익률 {y}%", y) for y in SETTINGS.get("dividend", {}).get("target_yields", [6, 5, 4, 3])]
    for s in scen:
        s["prices"] = [round(s["dps"] / (yv / 100)) if s["dps"] and yv else None for _, yv in yields]
    dps_years = [{"year": y, "dps": hist[y].get("dps"), "estimate": bool(hist[y].get("estimate")),
                  "payout": rnd(hist[y].get("payout"), 1)}
                 for y in sorted(hist) if hist[y].get("dps") is not None]
    avg = p10.get("avg")
    verdict = None
    fy = hist.get(ys[0], {}).get("dps")
    if no_history and fy and kr3y is not None:
        y = fy / price * 100
        verdict = (f"배당 이력이 짧아 10년 비교 불가 · 올해 예상 배당수익률 {y:.1f}% "
                   f"{'>' if y > kr3y else '<'} 국고채 3년 {kr3y:.2f}% → {'매력' if y > kr3y else '비매력'}")
    elif cur_yield is not None and avg:
        verdict = ("10년 평균보다 배당수익률이 높아요 → 매력" if cur_yield > avg else
                   "10년 평균보다 배당수익률이 낮아요 → 비매력")
    return {"cur_yield": rnd(cur_yield), "dps_last": dps_last, "dps_last_year": la,
            "fwd_yield": rnd(hist.get(ys[0], {}).get("dps", 0) / price * 100) if hist.get(ys[0], {}).get("dps") else None,
            "yield_labels": [n for n, _ in yields], "yield_values": [v for _, v in yields],
            "scenarios": scen, "dps_years": dps_years, "payout_avg": rnd(payout_avg, 1), "no_history": no_history,
            "vs_bond": rnd(cur_yield - kr3y) if (cur_yield is not None and kr3y is not None) else None,
            "verdict": verdict, "signal": ("green" if verdict and "매력" in verdict and "비매력" not in verdict else
                                           "red" if verdict else "na")}


def judge(price, fair, band_pos):
    """적정가 괴리율과 밴드 위치를 조합한 판정 + 한 줄 근거."""
    score, why = [], []
    gap = price / fair - 1 if fair else None
    if gap is not None:
        g = "green" if gap <= SIG["cheap_gap"] else "red" if gap >= SIG["expensive_gap"] else "yellow"
        score.append(g)
        why.append(f"적정가 대비 {gap * 100:+.0f}%")
    if band_pos is not None:
        b = "green" if band_pos <= SIG["band_low"] else "red" if band_pos >= SIG["band_high"] else "yellow"
        score.append(b)
        why.append(f"10년 밴드 {band_pos:.0f}% 위치")
    if not score:
        return "na", "데이터 부족", gap
    if "green" in score and "red" in score:
        verdict = "yellow"
    elif "green" in score:
        verdict = "green"
    elif "red" in score:
        verdict = "red"
    else:
        verdict = "yellow"
    return verdict, " · ".join(why), gap


def long_cagr(lq, px, max_y=10):
    """📏 이익 vs 주가 (지난 최대 10년): 영업이익(4분기 합) 연평균 vs 주가 연평균.
    rerate = (지금 주가 ÷ 최근 4분기 영업이익) ÷ (그때 주가 ÷ 그때 4분기 영업이익) — 1보다 크면 이익보다 주가가 더 올라 '비싸짐'.
    lq = {'16.1Q': {'op': ..}} (📈 10년 실적), px = 날짜별 종가. 5년이 안 되면 None, 시작·끝 영업이익이 0 이하면 연평균·rerate 는 None."""
    op = {int(k[:2]) * 4 + int(k[3]) - 1: v["op"] for k, v in (lq or {}).items() if v.get("op") is not None}
    ttm = lambda i: sum(op[j] for j in range(i - 3, i + 1)) if all(j in op for j in range(i - 3, i + 1)) else None  # noqa: E731
    end = max((i for i in op if ttm(i) is not None), default=None)
    start = min((i for i in op if ttm(i) is not None and end - i <= 4 * max_y), default=None) if end is not None else None
    if start is None or end - start < 20:
        return None
    qe = lambda i: pd.Timestamp(2000 + i // 4, i % 4 * 3 + 3, 1) + pd.offsets.MonthEnd(0)  # noqa: E731
    p0, p1 = px[px.index <= qe(start)], px.iloc[-1]
    if p0.empty:
        return None
    p0, y_op = float(p0.iloc[-1]), (end - start) / 4
    y_px = (px.index[-1] - qe(start)).days / 365.25
    o0, o1 = ttm(start), ttm(end)
    ok = o0 > 0 and o1 > 0
    lab = lambda i: f"{i // 4:02d}.{i % 4 + 1}Q"  # noqa: E731
    return {"from": lab(start), "to": lab(end), "y": round(y_op, 1), "op0": round(o0), "op1": round(o1),
            "op_cagr": round(((o1 / o0) ** (1 / y_op) - 1) * 100, 1) if ok else None, "px0": p0, "px1": float(p1),
            "px_cagr": round(((float(p1) / p0) ** (1 / y_px) - 1) * 100, 1),
            "rerate": round((float(p1) / o1) / (p0 / o0), 2) if ok else None}


if __name__ == "__main__":  # 자체 점검: 하방이 지금 가격보다 50% 넘게 높을 때만 업종 PER → 없으면 PER 밴드
    # 📏 이익 vs 주가: 10년 동안 영업이익 4배(4분기 합 4→16), 주가 2배(100→200) → 이익 연 14.9%, 주가 연 ~7.2%, 배수 0.5배(싸짐)
    lq = {f"{y:02d}.{q}Q": {"op": 1 if y == 16 else 4 if y == 26 else 2} for y in range(16, 27) for q in range(1, 5)}
    px_ = pd.Series([100.0, 200.0], index=pd.to_datetime(["2016-12-30", "2026-12-31"]))
    lc = long_cagr(lq, px_)
    assert (lc["from"], lc["to"], lc["y"], lc["op0"], lc["op1"], lc["op_cagr"], lc["rerate"]) == ("16.4Q", "26.4Q", 10.0, 4, 16, 14.9, 0.5), lc
    assert 7.0 < lc["px_cagr"] < 7.3, lc
    assert long_cagr({k: v for k, v in lq.items() if k >= "23"}, px_) is None  # 5년 안 됨
    lq["16.1Q"]["op"] = -9  # 적자에서 시작 → 연평균 못 구함
    assert long_cagr(lq, px_)["op_cagr"] is None
    m = {"bear": 30, "base": 45, "bull": 60}
    sec = {"kind": "PER", "bear": 10, "base": 20, "bull": 30}
    band = {"periods": {"10y": {"low": 8, "avg": 15, "high": 25}}}
    assert too_high(m, 1000, 100000, band, sec, "화장품 브랜드") is None  # 하방 30,000 < 지금 10만
    assert too_high(m, 1000, 15000, band, sec, "화장품 브랜드")[0] == {"bear": 10, "base": 20, "bull": 30}
    assert too_high(m, 1000, 15000, band)[0] == {"bear": 8, "base": 15, "bull": 25}
    assert too_high(m, 1000, 15000, {}) is None
    # 🐂 강세장 칸 + 12MF PER 35배 상한: 업종 10·20·30 → 강세장 20~35(40 은 ⚠), 성장률 25% → 25·35(37.5)·35(50), 강세장 35~35
    y = now_kst().year
    h = {y: {"eps": 1000}, y + 1: {"eps": 1000}}
    s = scenarios(10000, h, {}, ["PER"], per_growth={"g": 20, "mult": {"bear": 10, "base": 20, "bull": 30}, "part_src": "화장품 브랜드 업종 PER"})
    assert s["bull_mkt"] == {"lo": 20000, "mid": 27500, "hi": 35000} and s["parts"][0]["capped"]["from"] == {"bm_hi": 40}, s
    s = scenarios(10000, h, {}, ["PER"], per_growth={"g": 25, "mult": {"bear": 25, "base": 37.5, "bull": 50}})
    assert (s["bear"], s["base"], s["bull"]) == (25000, 35000, 35000) and s["bull_mkt"] == {"lo": 35000, "mid": 35000, "hi": 35000}, s
    # 하방부터 35배를 넘는 성장률(39.6%)은 성장률 방식 대신 PER 밴드로 (두산에너빌리티)
    assert too_high({"bear": 39.6, "base": 59.4, "bull": 79.2}, 919, 56500, band)[0] == {"bear": 8, "base": 15, "bull": 25}
    print("ok")
