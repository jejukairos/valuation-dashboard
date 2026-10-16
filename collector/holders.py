"""주요 주주(5% 이상) 지분 변화: OpenDART '주식등의 대량보유상황보고' (국민연금 등).
5% 이상 주주는 지분이 1%p 이상 바뀌면 공시해야 해서 큰손의 매수·매도를 추적할 수 있다."""
from common import HTTP, REPORT, load_yaml, now_kst, num
from kr_stock import corp_code, dart_key

import pandas as pd


def company(code):
    j = HTTP.get("https://opendart.fss.or.kr/api/majorstock.json",
                 params={"crtfc_key": dart_key(), "corp_code": corp_code(code)}).json()
    if j.get("status") not in ("000", "013"):
        raise RuntimeError(j.get("message"))
    series = {}
    for r in sorted(j.get("list", []), key=lambda x: x["rcept_no"]):
        name = (r.get("repror") or "").strip()
        series.setdefault(name, []).append({
            "date": r["rcept_dt"], "ratio": num(r.get("stkrt")), "shares": num(r.get("stkqy")),
            "chg_ratio": num(r.get("stkrt_irds")), "chg_shares": num(r.get("stkqy_irds")),
            "reason": (r.get("report_resn") or "").replace("\n", " ").strip()[:80],
            "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={r['rcept_no']}"})
    today = pd.Timestamp(now_kst().date())
    recent = []
    for name, rows in series.items():
        for x in rows:
            if x["chg_ratio"] and abs(x["chg_ratio"]) >= 0.5 and (today - pd.Timestamp(x["date"])).days <= 30:
                recent.append({"name": name, **x})
    # 지분 변화가 실제로 있었던 보고(담보계약 변경만 있는 보고는 제외)를 최근순으로
    changes = sorted([{"name": n, **x} for n, rows in series.items() for x in rows if x["chg_ratio"]],
                     key=lambda x: x["date"], reverse=True)
    return {"series": series, "changes": changes[:30], "recent": recent}


def collect():
    out = {}
    for h in load_yaml("stocks.yaml")["holdings"]:
        if h.get("market", "KR") != "KR" or h.get("data_code"):
            continue
        code = str(h["code"])
        try:
            out[code] = company(code)
        except Exception as e:  # noqa: BLE001
            REPORT.fail(f"주요 주주 {h['name']}", f"{type(e).__name__}: {e}")
    REPORT.success("주요 주주 지분 변화")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "companies": out,
            "source": "OpenDART 주식등의 대량보유상황보고 (5% 이상 주주, 1%p 이상 변동 시 공시)"}
