"""주요 주주(5% 이상) 지분 변화: OpenDART '주식등의 대량보유상황보고' (국민연금 등).
5% 이상 주주는 지분이 1%p 이상 바뀌면 공시해야 해서 큰손의 매수·매도를 추적할 수 있다.
+ 내부자 거래: '임원ㆍ주요주주 특정증권등 소유상황보고' 중 장내매수·장내매도만 (스톡옵션·상여·무상증자 제외)."""
import io
import re
import zipfile

from common import CACHE, HTTP, REPORT, load_yaml, now_kst, num, read_json, write_json
from kr_stock import corp_code, dart_key

import pandas as pd

DOCS = read_json(CACHE / "insider_docs.json") or {}  # {접수번호: [거래 행]} 한 번 읽은 공시는 다시 받지 않음


def _doc_rows(rcept_no):
    """공시 원문(OpenDART document.xml)에서 장내매수·장내매도 행: 변동일·증감 주식수·단가.
    표 칸 순서(변동 전 → 증감 → 변동 후 → 단가)는 '변동 전 + 증감 = 변동 후'로 확인해서 맞는 것만 쓴다."""
    key = "v1:" + rcept_no  # 읽는 방식을 고치면 v2 로 올려 다시 읽게
    if key in DOCS:
        return DOCS[key]
    z = HTTP.get("https://opendart.fss.or.kr/api/document.xml", params={"crtfc_key": dart_key(), "rcept_no": rcept_no})
    rows = []
    with zipfile.ZipFile(io.BytesIO(z.content)) as zf:
        for nm in zf.namelist():
            t = zf.read(nm).decode("utf-8", "ignore")
            for tr in re.findall(r"<TR[^>]*>(.*?)</TR>", t, re.S | re.I):
                cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip()
                         for c in re.findall(r"<T[DEHU][^>]*>(.*?)</T[DEHU]>", tr, re.S | re.I)]
                kind = "매수" if any("장내매수" in c for c in cells) else "매도" if any("장내매도" in c for c in cells) else None
                if not kind:
                    continue
                dm = next((re.search(r"(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})", c) for c in cells
                           if re.search(r"\d{4}\D{1,3}\d{1,2}\D{1,3}\d{1,2}", c)), None)
                nums = [num(c.replace("(", "-").replace(")", "")) for c in cells]
                nums = [v for v in nums if v is not None]
                for i in range(len(nums) - 3):  # 변동 전, 증감, 변동 후, 단가
                    b, d, a, p = nums[i:i + 4]
                    if (abs(b + d - a) <= 1 or abs(b - d - a) <= 1) and d != 0 and p > 0:  # 매도를 부호 없이 적은 보고서도 있음
                        rows.append({"date": f"{dm.group(1)}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}" if dm else None,
                                     "kind": kind, "chg": abs(d) if kind == "매수" else -abs(d), "price": p})
                        break
    DOCS[key] = rows
    return rows


def insider(code, days=90, max_docs=25):
    """최근 3개월 임원·주요주주 장내매수/매도: 금액·사람 수, 대주주/임원/대표이사 구분 (깡토 백테스트 구분 그대로)."""
    j = HTTP.get("https://opendart.fss.or.kr/api/elestock.json", params={"crtfc_key": dart_key(), "corp_code": corp_code(code)}).json()
    if j.get("status") not in ("000", "013"):
        raise RuntimeError(j.get("message"))
    since = (now_kst() - pd.Timedelta(days=days)).strftime("%Y%m%d")
    reps = sorted((r for r in j.get("list", []) if r.get("rcept_dt", "") >= since and num(r.get("sp_stock_lmp_irds_cnt"))),
                  key=lambda r: r["rcept_no"], reverse=True)[:max_docs]
    rows = []
    for r in reps:
        ofc, major = (r.get("isu_exctv_ofcps") or "-").strip(), (r.get("isu_main_shrholdr") or "-").strip()
        role = "대주주" if ("주주" in major or "최대주주" in ofc) else "대표이사" if "대표" in ofc else "임원"
        try:
            trades = _doc_rows(r["rcept_no"])
        except Exception:  # noqa: BLE001
            continue
        for t in trades:
            rows.append({**t, "name": (r.get("repror") or "").strip(), "pos": ofc if ofc != "-" else major, "role": role,
                         "amt": round(abs(t["chg"]) * t["price"]),
                         "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={r['rcept_no']}"})
    rows.sort(key=lambda x: x.get("date") or "", reverse=True)
    sumamt = lambda k, f=lambda x: True: sum(x["amt"] for x in rows if x["kind"] == k and f(x))  # noqa: E731
    who = lambda k, f=lambda x: True: len({x["name"] for x in rows if x["kind"] == k and f(x)})  # noqa: E731
    return {"days": days, "buy": sumamt("매수"), "sell": sumamt("매도"), "buyers": who("매수"), "sellers": who("매도"),
            "major_sell": sumamt("매도", lambda x: x["role"] == "대주주"), "major_buy": sumamt("매수", lambda x: x["role"] == "대주주"),
            "exec_buyers": who("매수", lambda x: x["role"] != "대주주"), "ceo_buy": who("매수", lambda x: x["role"] == "대표이사"),
            "rows": rows[:40], "reports": len(reps),
            # shortcut: 원인 확인용 (DART 키가 GitHub 에만 있어 내 컴퓨터에서 못 돌려 봄) — 장내 거래가 잘 잡히면 지우기
            "debug": {"status": j.get("status"), "n": len(j.get("list", [])), "last": max((r.get("rcept_dt", "") for r in j.get("list", [])), default=None),
                      "keys": sorted((j.get("list") or [{}])[0].keys()), "sample": {k: (j.get("list") or [{}])[-1].get(k) for k in
                      ("rcept_dt", "repror", "isu_exctv_ofcps", "isu_main_shrholdr", "sp_stock_lmp_irds_cnt")}}}


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
    sy = load_yaml("stocks.yaml")
    for h in [x for k in ("holdings", "watchlist", "joint") for x in (sy.get(k) or [])]:
        if h.get("market", "KR") != "KR" or h.get("data_code"):
            continue
        code = str(h["code"])
        try:
            out[code] = company(code)
        except Exception as e:  # noqa: BLE001
            REPORT.fail(f"주요 주주 {h['name']}", f"{type(e).__name__}: {e}")
            continue
        try:
            out[code]["insider"] = insider(code)
        except Exception as e:  # noqa: BLE001
            REPORT.block("내부자 거래", f"{h['name']}: {str(e)[:60]}")
    write_json(CACHE / "insider_docs.json", dict(sorted(DOCS.items())[-3000:]))
    REPORT.success("주요 주주 지분 변화")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "companies": out,
            "source": "OpenDART 주식등의 대량보유상황보고 (5% 이상 주주, 1%p 이상 변동 시 공시)"}
