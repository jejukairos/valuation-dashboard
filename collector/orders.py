"""수주(단일판매·공급계약) 공시: OpenDART 에서 공시 목록 → 본문 표를 읽어 계약별로 정리.
한 번 읽은 공시는 cache/orders/ 에 저장해서 다시 받지 않는다."""
import io
import re
import zipfile

import pandas as pd

from common import CACHE, HTTP, REPORT, load_yaml, now_kst, read_json, write_json
from kr_stock import corp_code, dart_key

ODIR = CACHE / "orders"


def _clean(txt):
    t = re.sub(r"<[^>]+>", " | ", txt)
    t = re.sub(r"&[a-z]+;", " ", t)
    return re.sub(r"\s+", " ", t)


def _after(text, label, n=1):
    """'라벨 | | 값' 구조에서 라벨 뒤 n 번째 값."""
    m = re.search(re.escape(label) + r"((?:\s*\|\s*)+)([^|]+)", text)
    if not m:
        return None
    v = m.group(2).strip()
    return v or None


def _date(s):
    """'2026.02.04', '2023년 9월 14일', '2026-09-10' → '2026-09-10'. 못 읽으면 원문 그대로(None 이면 None)."""
    if not s:
        return None
    m = re.search(r"(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})", s)
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def _num(s):
    if not s:
        return None
    s = s.replace(",", "").strip()
    try:
        return float(re.match(r"-?[\d.]+", s).group(0))
    except Exception:  # noqa: BLE001
        return None


def parse_doc(rcept_no):
    path = ODIR / f"{rcept_no}.json"
    cached = read_json(path)
    if cached:
        return cached
    r = HTTP.get("https://opendart.fss.or.kr/api/document.xml", params={"crtfc_key": dart_key(), "rcept_no": rcept_no})
    z = zipfile.ZipFile(io.BytesIO(r.content))
    data = z.read(z.namelist()[0])
    raw = None
    for enc in ("utf-8", "cp949"):  # 2022년 이전 공시는 EUC-KR(cp949)
        try:
            raw = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    t = _clean(raw or data.decode("utf-8", "ignore"))
    # 정정 공시는 '정정후' 값이 본문 아래 원래 양식에 다시 나오므로 본문(양식) 부분부터 읽는다
    body = t
    k = t.rfind("1. 판매ㆍ공급계약 구분")
    if k < 0:
        k = t.rfind("1. 판매ㆍ공급계약")
    if k > 0:
        body = t[k:]
    name = (_after(body, "체결계약명") or _after(body, "해지계약명") or _after(body, "세부내용")
            or _after(body, "판매ㆍ공급계약 내용"))
    out = {
        "rcept_no": rcept_no,
        "name": name,
        "amount": _num(_after(body, "계약금액(원)")) or _num(_after(body, "해지금액(원)")),
        "revenue": _num(_after(body, "최근매출액(원)")),
        "ratio": _num(_after(body, "매출액대비(%)")),
        "party": _after(body, "계약상대"),
        "region": _after(body, "판매ㆍ공급지역"),
        "start": _date(_after(body, "시작일")),
        "end": _date(_after(body, "종료일")),
        "contract_date": _date(_after(body, "계약(수주)일자") or _after(body, "계약(수주)일") or _after(body, "계약일자")
                               or _after(body, "해지일자")),
        "orig_filed": _date(_after(t, "정정관련 공시서류제출일")),
        "reason": _after(t, "정정사유") or _after(t, "해지사유"),
    }
    if out["amount"] is None and not out["name"]:
        raise RuntimeError("본문 양식을 못 읽음")
    write_json(path, out)
    return out


def company(cfg):
    code = str(cfg["code"])
    cc = corp_code(code)
    start = cfg.get("since", "20200101")
    end = now_kst().strftime("%Y%m%d")
    filings = []
    page = 1
    while True:
        j = HTTP.get("https://opendart.fss.or.kr/api/list.json",
                     params={"crtfc_key": dart_key(), "corp_code": cc, "bgn_de": start, "end_de": end,
                             "pblntf_ty": "I", "page_no": page, "page_count": 100}).json()
        for x in j.get("list", []):
            if "단일판매" in x["report_nm"] or "공급계약" in x["report_nm"]:
                filings.append(x)
        if page >= int(j.get("total_page", 1) or 1):
            break
        page += 1
    filings.sort(key=lambda x: x["rcept_no"])  # 오래된 것부터
    contracts = {}  # 최초 공시 접수일(YYYY-MM-DD) → 계약
    cancels, unreadable = [], []
    for f in filings:
        try:
            d = parse_doc(f["rcept_no"])
        except Exception:  # noqa: BLE001 - 양식이 다른 공시(첨부 문서 등)는 링크만 남긴다
            unreadable.append({"filed": f["rcept_dt"], "title": f["report_nm"].strip(),
                               "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={f['rcept_no']}"})
            continue
        filed = f"{f['rcept_dt'][:4]}-{f['rcept_dt'][4:6]}-{f['rcept_dt'][6:]}"
        title = f["report_nm"].strip()
        url = f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={f['rcept_no']}"
        if "해지" in title:
            cancels.append({**d, "filed": filed, "title": title, "url": url})
            continue
        key = d.get("orig_filed") if "정정" in title and d.get("orig_filed") else filed
        prev = contracts.get(key)
        rec = {**(prev or {}), **{k: v for k, v in d.items() if v is not None},
               "filed": key, "last_update": filed, "url": url, "title": title,
               "corrected": bool(prev) or "정정" in title}
        if prev and prev.get("amount") and d.get("amount") and prev["amount"] != d["amount"]:
            rec["first_amount"] = prev.get("first_amount", prev["amount"])
        contracts[key] = rec
    for c in cancels:  # 해지 공시를 원래 계약에 표시 (같은 계약상대 + 해지 이전에 체결된 계약)
        party = (c.get("party") or "")[:15]
        targets = [x for x in contracts.values()
                   if party and (x.get("party") or "")[:15] == party and x["filed"] <= c["filed"]]
        if not targets and c.get("name"):
            targets = [x for x in contracts.values() if x.get("name") and c["name"][:8] in x["name"]]
        for t in targets:
            t["cancelled"] = c["filed"]
            t["cancel_reason"] = c.get("reason")
    rows = sorted(contracts.values(), key=lambda x: x.get("contract_date") or x["filed"], reverse=True)
    today = pd.Timestamp(now_kst().date())
    by_year = {}
    for r in rows:
        if r.get("cancelled") or not r.get("amount"):
            continue
        y = (r.get("contract_date") or r["filed"])[:4]
        by_year[y] = by_year.get(y, 0) + r["amount"]
        r["new"] = (today - pd.Timestamp(r["last_update"])).days <= 7
    last12 = sum(r["amount"] for r in rows if r.get("amount") and not r.get("cancelled")
                 and pd.Timestamp(r.get("contract_date") or r["filed"]) >= today - pd.DateOffset(years=1))
    return {"code": code, "name": cfg["name"], "since": start, "contracts": rows, "by_year": by_year,
            "last12": last12, "count": len(rows), "unreadable": unreadable, "updated_at": now_kst().strftime("%Y-%m-%d %H:%M"),
            "source": "OpenDART 단일판매·공급계약 체결 공시 (정정 공시는 최신 금액으로 반영)"}


def collect():
    ODIR.mkdir(parents=True, exist_ok=True)
    cfg = load_yaml("orders.yaml") or {}
    out = {}
    for c in cfg.get("companies", []):
        try:
            out[str(c["code"])] = company(c)
            REPORT.success(f"수주 {c['name']}")
        except Exception as e:  # noqa: BLE001
            REPORT.fail(f"수주 {c['name']}", f"{type(e).__name__}: {e}")
    return out
