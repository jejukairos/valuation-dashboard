"""관심종목 탭: 내 시트 '빠른 판단' 항목을 모두 자동으로 다시 계산.
시가총액·PER·PBR(25 실적/26E/27E)·PEG·ROE·부채비율·EPS·매출 성장률·적정주가 하방/상방·여력·52주 고점 대비 하락률·영업이익 YoY."""
import pandas as pd

import compute as C
from common import DATA, REPORT, load_yaml, now_kst, read_json, rnd
from kr_stock import merged_history, naver_now, price_history


def _yoy(w, key, y):
    a, b = (w.get(y) or {}).get(key), (w.get(y - 1) or {}).get(key)
    if a is None or b is None or b == 0:
        return None
    return (a / b - 1) * 100 if b > 0 else None  # 적자에서 흑자 전환 등은 비율이 의미 없어 비움


def _avg(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def row(cfg, holdings):
    code = str(cfg["code"])
    now = naver_now(code)
    price = now["price"]
    hist, w = merged_history(code)
    w = w or {}
    y = now_kst().year
    method = (cfg.get("fair") or "PER").upper()
    key = "eps" if method == "PER" else "bps"
    px = price_history(code)
    band = C.build_band(C.weekly_close(px), hist, key, shift=1)  # PER = 1년 뒤 EPS, PBR = 그해 BPS
    # 52주 최고가는 액면분할이 반영된 '수정주가'로 (네이버 요약값은 분할 전 가격이 섞일 때가 있음)
    recent = px[px.index >= px.index[-1] - pd.Timedelta(days=365)]
    adj_high = float(recent.max()) if len(recent) else None
    periods = (band or {}).get("periods") or {}
    st = periods.get("10y") or periods.get("all") or {}
    base27 = (hist.get(y + 1) or {}).get(key)
    down = base27 * st["low"] if (base27 and st.get("low")) else None
    mid = base27 * st["avg"] if (base27 and st.get("avg")) else None
    up = base27 * st["high"] if (base27 and st.get("high")) else None
    # 5년 밴드로 본 하방/상방 (최근 5년 눈높이)
    s5 = periods.get("5y") or {}
    d5 = base27 * s5["low"] if (base27 and s5.get("low")) else None
    u5 = base27 * s5["high"] if (base27 and s5.get("high")) else None

    def per_at(yy):
        e = (w.get(yy) or {}).get("eps")
        return price / e if e and e > 0 else None

    def pbr_at(yy):
        b = (w.get(yy) or {}).get("bps")
        return price / b if b and b > 0 else None

    eps_g = _avg([_yoy(w, "eps", yy) for yy in (y, y + 1, y + 2)])
    sales_g = _avg([_yoy(w, "sales", yy) for yy in (y - 1, y, y + 1)])
    per26 = per_at(y)
    high = adj_high or now.get("high52")
    return {
        "name": cfg.get("name") or now.get("name"), "code": code, "holding": code in holdings, "fair": method,
        "price": price, "market_cap": now.get("market_cap"),
        "per25": (w.get(y - 1) or {}).get("per"), "per26": rnd(per26), "per27": rnd(per_at(y + 1)),
        "pbr25": (w.get(y - 1) or {}).get("pbr"), "pbr26": rnd(pbr_at(y), 2), "pbr27": rnd(pbr_at(y + 1), 2),
        "peg": rnd(per26 / eps_g, 2) if (per26 and eps_g and eps_g > 0) else None,
        "roe26": (w.get(y) or {}).get("roe"), "debt26": (w.get(y) or {}).get("debt"),
        "eps_g": rnd(eps_g, 1), "sales_g": rnd(sales_g, 1),
        "down": rnd(down, 0), "mid": rnd(mid, 0), "up": rnd(up, 0),
        "down_pct": rnd((down / price - 1) * 100, 1) if down else None,
        "up_pct": rnd((up / price - 1) * 100, 1) if up else None,
        "band_from": st.get("from"), "band_low": st.get("low"), "band_avg": st.get("avg"), "band_high": st.get("high"),
        "down5": rnd(d5, 0), "up5": rnd(u5, 0),
        "down5_pct": rnd((d5 / price - 1) * 100, 1) if d5 else None,
        "up5_pct": rnd((u5 / price - 1) * 100, 1) if u5 else None,
        "band5_from": s5.get("from"), "band5_low": s5.get("low"), "band5_avg": s5.get("avg"), "band5_high": s5.get("high"),
        "high52": high, "mdd": rnd((price / high - 1) * 100, 1) if high else None,
        "op_yoy": {str(yy)[2:]: rnd(_yoy(w, "op", yy), 1) for yy in (y - 1, y, y + 1)},
    }


def collect():
    cfg = load_yaml("watch.yaml") or {}
    sy = load_yaml("stocks.yaml")
    holdings = {str(h["code"]) for h in sy["holdings"]}
    tracked = holdings | {str(h["code"]) for k in ("watchlist", "joint") for h in (sy.get(k) or [])}  # 상세 화면이 있는 종목
    prev = {r["code"]: r for r in (read_json(DATA / "watch.json", {}) or {}).get("rows", [])}
    rows = []
    for s in cfg.get("stocks", []):
        if str(s["code"]) in holdings:  # 보유종목은 보유 탭에서 보므로 관심종목에서 뺌 (팔면 다시 나타남)
            continue
        try:
            rows.append(row(s, tracked))
        except Exception as e:  # noqa: BLE001
            REPORT.fail(f"관심종목 {s['name']}", f"{type(e).__name__}: {e}")
            if str(s["code"]) in prev:
                rows.append(dict(prev[str(s["code"])], stale=True))
    REPORT.success("관심종목")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "rows": rows,
            "note": ("현재가 기준 PER·PBR(25는 연말 실적 기준) · 성장률은 와이즈리포트 연간 값의 전년 대비 평균 · "
                     "적정주가 하방/상방 = 27E EPS(또는 BPS) × 10년·5년 밴드 하단/상단(하위·상위 10%) · "
                     "고점 대비 하락률 = 현재가 ÷ 52주 최고가 − 1")}
