"""PBR 계산기: 연도별 추정 BPS × PBR 배수 = 가격, 지금 가격에서 몇 % 내리면 PBR 몇 배인지."""
from common import DATA, REPORT, load_yaml, now_kst, read_json, rnd
from kr_stock import naver_now, wise_annual


def _band_multiples(code):
    """보유종목이라 10년 PBR 밴드가 계산돼 있으면 하단·평균·상단을 가져온다."""
    det = read_json(DATA / "stocks" / f"{code}.json", {}) or {}
    p = ((det.get("bands") or {}).get("PBR") or {}).get("periods", {})
    st = p.get("10y") or p.get("all")
    if not st:
        return None, None
    return [st["low"], st["avg"], st["high"]], st


def _alert(cfg, bps, price):
    """예: 28E PBR 이 1배 이하인지, 아니면 1배가 되려면 몇 % 내려야 하는지."""
    a = cfg.get("alert")
    if not a or not bps.get(a["year"]):
        return None
    b = bps[a["year"]]
    pbr = price / b
    target = b * a["below"]
    return {"year": a["year"], "below": a["below"], "text": a.get("text", ""), "pbr": rnd(pbr, 2),
            "hit": pbr <= a["below"], "target_price": round(target), "gap": rnd((target / price - 1) * 100, 1)}


def item(cfg, base):
    code = str(cfg["code"])
    now = naver_now(code)
    w = wise_annual(code)
    y0 = now_kst().year
    ys = [y0, y0 + 1, y0 + 2]
    lab = lambda y: f"{str(y)[2:]}E"  # noqa: E731
    price = now["price"]
    bps = {lab(y): w.get(y, {}).get("bps") for y in ys}
    actual = [y for y, r in w.items() if not r.get("estimate") and r.get("bps")]
    last_y = max(actual) if actual else None
    mults = cfg.get("multiples") or []
    band = None
    auto = False
    if not mults:
        mults, band = _band_multiples(code)
        auto = True
        if not mults:
            mults = [0.8, 1.0, 1.2]
            auto = False
    else:
        _, band = _band_multiples(code)
    rows = []
    for m in mults:
        cells = {k: round(b * m) if b else None for k, b in bps.items()}
        chg = {k: round((v / price - 1) * 100, 1) if v else None for k, v in cells.items()}
        rows.append({"mult": round(m, 2), "prices": cells, "chg": chg})
    return {
        "name": cfg.get("name") or now.get("name"), "code": code, "price": price,
        "date": now_kst().strftime("%Y-%m-%d"),
        "bps": bps, "pbr": {k: rnd(price / b, 2) if b else None for k, b in bps.items()},
        "bps_last": {"year": last_y, "bps": w[last_y]["bps"] if last_y else None,
                     "pbr": rnd(price / w[last_y]["bps"], 2) if last_y else None},
        "rows": rows, "auto_multiples": auto, "memo": cfg.get("memo") or "", "alert": _alert(cfg, bps, price),
        "band10": {k: band.get(k) for k in ("low", "avg", "high", "pos", "from")} if band else None,
        "source": "BPS: 와이즈리포트 컨센서스(네이버 종목분석) · 가격: 네이버 증권",
    }


def collect():
    cfg = load_yaml("pbr_watch.yaml") or {}
    base = cfg.get("base_year", "27E")
    out, prev = [], {i["code"]: i for i in (read_json(DATA / "pbr_watch.json", {}) or {}).get("items", [])}
    for s in cfg.get("stocks", []):
        try:
            out.append(item(s, base))
            REPORT.success(f"PBR 계산기 {s.get('name')}")
        except Exception as e:  # noqa: BLE001
            REPORT.fail(f"PBR 계산기 {s.get('name')}", f"{type(e).__name__}: {e}")
            if str(s["code"]) in prev:
                out.append(dict(prev[str(s["code"])], stale=True))
    return {"base_year": base, "updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "items": out}
