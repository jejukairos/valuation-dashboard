"""매일 실행: 수집 → 계산 → site/data/*.json 저장.
실패한 항목은 직전 값을 그대로 쓰고 '실패 목록'에 남긴다."""
import os
import sys
import traceback

import pandas as pd

import compute as C
import kr_stock
import market
import rates
import us_stock
from common import DATA, REPORT, SETTINGS, attempt, load_yaml, now_kst, read_json, rnd, write_json


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
        rate, bond_label, currency = rates_now.get("us10y"), "미국채 10년", "USD"
        sources = {"price": "야후 파이낸스", "consensus": "야후 파이낸스 컨센서스",
                   "history": next((r["src"] for r in hist.values() if not r.get("estimate")), "")}
    else:
        now = kr_stock.naver_now(code)
        px = kr_stock.price_history(code)
        # 우선주처럼 실적은 보통주 자료를 쓰는 경우 (data_code)
        hist, _ = kr_stock.merged_history(str(h.get("data_code") or code), h.get("splits") or [])
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
    poss = [(bands[k]["periods"].get("10y") or bands[k]["periods"].get("all") or {}).get("pos")
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
        ests = sorted(y for y, r in hist.items() if r.get("estimate"))
        nxt = hist.get(ests[-1], {}).get("eps") if ests else None
        fv = None
        try:
            fv = us_stock.finviz_next_eps(code)
        except Exception as e:  # noqa: BLE001
            REPORT.block("Finviz", f"접속 실패 ({str(e)[:60]})")
        if fv and nxt:
            checks.append({"item": f"{C.ylabel(ests[-1])} EPS", "a": fv, "a_src": "Finviz",
                           "b": nxt, "b_src": "야후", "warn": abs(fv / nxt - 1) >= 0.10, "dg": 2})
    else:
        w_eps = hist.get(now_kst().year, {}).get("eps")
        if now.get("fwd_eps") and w_eps:
            diff = now["fwd_eps"] / w_eps - 1
            checks.append({"item": f"{C.ylabel(now_kst().year)} EPS", "a": now["fwd_eps"], "a_src": "네이버 증권",
                           "b": w_eps, "b_src": "와이즈리포트", "warn": abs(diff) >= 0.10})
    det["card"] = {
        "name": name, "code": code, "market": mkt, "price": price, "market_cap": cap_krw, "market_cap_usd": det["market_cap_usd"],
        "currency": currency, "verdict": verdict, "why": why, "fair": rnd(fair, 2 if currency == "USD" else 0),
        "gap": rnd(gap, 4),
        "fair_basis": _basis_text([n for n, _ in fairs], ey, mkey),
        "band_pos": rnd(band_pos, 1), "fwd_per": rnd(fwd_per), "bond_per": rnd(bond_per),
        "bond_ratio": rnd(ratio, 3), "bond_signal": C.bond_signal(ratio), "bond_label": bond_label,
        "div_signal": det.get("div", {}).get("signal") if "DIV" in methods else None,
        "div_yield": det.get("div", {}).get("cur_yield") if "DIV" in methods else None,
        "methods": methods, "avg_price": h.get("avg_price"), "quantity": h.get("quantity"),
        "short_history": any(b.get("short_history") for b in bands.values()),
        "band_start": min((b["start"] for b in bands.values()), default=None),
        "rerating_warning": det.get("per", {}).get("rerating_warning"), "checks": checks,
    }
    return det


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

    print("■ 보유종목")
    cards = []
    prev_cards = {c["code"]: c for c in prev.get("stocks", [])}
    for i, h in enumerate(load_yaml("stocks.yaml")["holdings"]):
        code = str(h["code"])
        try:
            det = stock_detail(h, {"us10y": us10, "kr3y": kr3}, fx)
            det["card"]["order"] = i
            write_json(DATA / "stocks" / f"{code}.json", det)
            cards.append(det["card"])
            REPORT.success(f"{h['name']} 종목 계산")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            REPORT.fail(f"{h['name']} 종목", f"{type(e).__name__}: {e}")
            if code in prev_cards:
                c = dict(prev_cards[code], stale=True, order=i)
                cards.append(c)

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

    print("■ 동종업계")
    import peers
    write_json(DATA / "peers.json", peers.collect())

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
                     "kospi_pbr_marks": SETTINGS.get("kospi_pbr_marks", [])},
    }
    write_json(DATA / "dashboard.json", out)
    print(f"완료: 성공 {len(REPORT.ok)} / 실패 {len(REPORT.failures)}")
    # 절반 넘게 실패하면 GitHub 이 실패 메일을 보내도록 오류 코드로 끝낸다
    if len(REPORT.failures) > max(3, len(REPORT.ok)) or test_fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
