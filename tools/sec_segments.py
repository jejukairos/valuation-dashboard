"""🧱 미국 10-Q·10-K 를 모두 받아 분기 제품군별·지역별 매출 (2014년~) → cache/sec_seg.json (사용자 11/5 "분기보고서 다 받아줘").
보고서마다 숫자가 담긴 XBRL 파일을 받아 '제품·서비스' 축 · '사업부문' 축 · '지역' 축이 붙은 매출만 골라요.
SEC 는 연락처를 요구해서 SEC_CONTACT 환경변수로만 넣어요 (코드·저장소에는 안 남음). GitHub 서버는 SEC 가 막아서 이 컴퓨터에서 실행.
받은 원본 XBRL 은 cache/sec_raw/{티커}/ (gzip, 저장소에 안 올림) — 다시 돌리면 새 보고서만 받아요.
  PowerShell:  $env:SEC_CONTACT="내 이메일"; .venv\\Scripts\\python.exe tools\\sec_segments.py [티커 …]"""
import gzip
import json
import os
import re
import sys
import time
from collections import defaultdict
from datetime import date
from itertools import combinations
from pathlib import Path
from xml.etree import ElementTree as ET

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "cache" / "sec_raw"
OUT = ROOT / "cache" / "sec_seg.json"
XI, XD, XL = "{http://www.xbrl.org/2003/instance}", "{http://xbrl.org/2006/xbrldi}", "{http://www.w3.org/1999/xlink}"
AXES = {"ProductOrServiceAxis": "prod", "StatementBusinessSegmentsAxis": "seg", "StatementGeographicalAxis": "geo"}
REV = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax",
       "SalesRevenueNet", "SalesRevenueGoodsNet", "SalesRevenueServicesNet"]  # 앞 이름 먼저
SKIP = re.compile(r"Elimination|Intersegment|Corporate|Reconcil|Consolidat|Unallocat|NonSegment|AllOtherSegments|Hedg|^(us-gaap|srt):OperatingSegmentsMember$", re.I)
GEO = re.compile(r"America|Europe|China|Japan|Asia|Pacific|EMEA|International|Domestic|United States|Rest of|Taiwan|Korea|Singapore|Canada|Foreign", re.I)
S = requests.Session()


def get(url):
    for i in range(4):
        time.sleep(0.12)  # SEC 는 초당 10번 이하
        r = S.get(url, timeout=90)
        if r.status_code == 200:
            return r
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(3 + 5 * i)
            continue
        raise RuntimeError(f"SEC {r.status_code} {url}")
    raise RuntimeError(f"SEC 다시 시도해도 실패 {url}")


def days(s, e):
    return (date.fromisoformat(e) - date.fromisoformat(s)).days


def filings(cik):
    """10-Q·10-K (정정 보고서 빼고) [(기간 끝, 양식, 접수번호)] 2014년~."""
    j = get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json").json()
    pages = [j["filings"]["recent"]]
    if min(pages[0]["reportDate"] or ["9999"]) > "2014-01-01":  # 최근 1,000건 안에 2014년이 없으면 예전 목록도
        pages += [get(f"https://data.sec.gov/submissions/{f['name']}").json() for f in j["filings"].get("files", [])]
    return sorted({(rd, f, a) for p in pages for f, a, rd in zip(p["form"], p["accessionNumber"], p["reportDate"])
                   if f in ("10-Q", "10-K") and rd and rd >= "2014-01-01"})


def download(t, cik, acc):
    """보고서의 XBRL 숫자 파일 + 이름표 파일 (gzip 으로 보관, 있으면 안 받음)."""
    d = RAW / t
    xi, xl = d / f"{acc}.xml.gz", d / f"{acc}_lab.xml.gz"
    if not xi.exists():
        base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}"
        items = [x["name"] for x in get(f"{base}/index.json").json()["directory"]["item"]]
        inst = next((n for n in items if n.endswith("_htm.xml")), None) or next(
            (n for n in items if n.endswith(".xml") and not re.search(r"_(cal|def|lab|pre)\.xml$|FilingSummary", n)), None)
        if not inst:
            raise RuntimeError(f"XBRL 파일 없음 {acc}")
        lab = next((n for n in items if n.endswith("_lab.xml")), None)
        d.mkdir(parents=True, exist_ok=True)
        if lab:
            xl.write_bytes(gzip.compress(get(f"{base}/{lab}").content))
        xi.write_bytes(gzip.compress(get(f"{base}/{inst}").content))  # 숫자 파일을 마지막에 (중간에 끊기면 다음에 다시)
    return gzip.decompress(xi.read_bytes()), gzip.decompress(xl.read_bytes()) if xl.exists() else b""


def labels(xml):
    if not xml:
        return {}
    root = ET.fromstring(xml)
    loc, txt, arc = {}, {}, {}
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag == "loc":
            loc[el.get(XL + "label")] = el.get(XL + "href", "").split("#")[-1]
        elif tag == "label" and (el.get(XL + "role") or "").endswith("/label"):
            txt[el.get(XL + "label")] = (el.text or "").strip()
        elif tag == "labelArc":
            arc[el.get(XL + "from")] = el.get(XL + "to")
    return {loc[f]: re.sub(r"\s*\[Member\]$|\s+Segment$", "", txt[t]) for f, t in arc.items() if f in loc and txt.get(t)}


def facts(xml):
    """축 하나만 붙은 매출 {(축, 멤버, 시작, 끝): 값}."""
    root = ET.fromstring(xml)
    ctx = {}
    for c in root.iter(XI + "context"):
        ms = list(c.iter(XD + "explicitMember"))
        st, en = c.find(f".//{XI}startDate"), c.find(f".//{XI}endDate")
        if len(ms) != 1 or st is None or en is None:
            continue
        ax, m = ms[0].get("dimension").split(":")[-1], (ms[0].text or "").strip()
        if ax in AXES and not SKIP.search(m):
            ctx[c.get("id")] = (AXES[ax], m, st.text.strip(), en.text.strip())
    out = {}
    for el in root:
        c, nm = ctx.get(el.get("contextRef")), el.tag.split("}")[-1]
        if c and nm in REV and el.text and re.fullmatch(r"-?\d+(\.\d+)?", el.text.strip()):
            p = REV.index(nm)
            if c not in out or p < out[c][0]:
                out[c] = (p, float(el.text))
    return {k: v for k, (_, v) in out.items()}


def quarterly(vals):
    """{(멤버, 시작, 끝): 값} → {끝: {멤버: 3개월 값}} — 4분기 = 연간 − 같은 해 9개월 (없으면 − 그 해 3개 분기 합)."""
    q = defaultdict(dict)
    for (m, s, e), v in vals.items():
        if 80 <= days(s, e) <= 100:
            q[e][m] = v
    for (m, s, e), v in vals.items():
        if 350 <= days(s, e) <= 380 and m not in q.get(e, {}):
            nine = next((v9 for (m9, s9, e9), v9 in vals.items() if m9 == m and s9 == s and 260 <= days(s9, e9) <= 285), None)
            three = [r[m] for ee, r in q.items() if s < ee < e and m in r]
            if nine is not None:
                q[e][m] = v - nine
            elif len(three) == 3:
                q[e][m] = v - sum(three)
    par = parents(q)
    return {e: {m: v for m, v in r.items() if m not in par} for e, r in sorted(q.items())}


def parents(q):
    """여러 분기에서 늘 같은 칸들의 합과 같은 칸(예: 애플 '제품' = 아이폰+맥+아이패드+웨어러블) — 쌓으면 두 번 세니까 뺌.
    한 분기만 우연히 맞는 건 안 뺌 (분기의 절반 이상·2번 넘게 같은 칸 묶음이어야)."""
    hit = defaultdict(list)
    for r in q.values():
        ms = [m for m in r if r[m] > 0]
        for m in ms:
            oth = [x for x in ms if x != m and r[x] < r[m]]
            if len(oth) <= 14:
                hit[m].append({frozenset(c) for k in range(2, min(len(oth), 8) + 1) for c in combinations(oth, k)
                               if abs(sum(r[x] for x in c) - r[m]) <= r[m] * 0.003})
    return {m for m, L in hit.items() if any(sum(s in x for x in L) >= max(2, len(L) / 2) for s in set().union(*L))}

def pretty(m, lab):
    """멤버 이름표: 보고서 이름표 → 없으면 'IPhoneMember' 를 띄어 씀."""
    k = m.replace(":", "_")
    if lab.get(k):
        return lab[k]
    s = re.sub(r"Member$", "", m.split(":")[-1])
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)


def ticker(t, cik):
    vals, lab, n = defaultdict(dict), {}, 0
    for rd, form, acc in filings(cik):
        try:
            xi, xl = download(t, cik, acc)
            f = facts(xi)
        except Exception as e:  # noqa: BLE001 - 한 보고서가 깨져도 나머지는 계속
            print(f"    ⚠ {t} {rd} {form}: {str(e)[:80]}")
            continue
        lab.update(labels(xl))  # 최신 보고서 이름표가 덮어씀
        for (ax, m, s, e), v in f.items():
            vals[ax][(m, s, e)] = v  # 같은 기간은 나중 보고서 숫자 (정정·재분류 반영)
        n += 1
    qs = {ax: quarterly(v) for ax, v in vals.items()}
    many = lambda ax: sum(len(r) >= 2 for r in qs.get(ax, {}).values())
    seg_geo = qs.get("seg") and sum(bool(GEO.search(pretty(m, lab))) for r in qs["seg"].values() for m in r) > 0.6 * sum(len(r) for r in qs["seg"].values())
    geo_ax = "geo" if many("geo") >= 8 else "seg" if seg_geo and many("seg") >= 8 else None
    prod_ax = "prod" if many("prod") >= 8 else "seg" if many("seg") >= 8 and geo_ax != "seg" else None
    name = lambda r: {pretty(m, lab): v for m, v in r.items()}
    out = {"filings": n}
    for k, ax in (("prod", prod_ax), ("geo", geo_ax)):
        if ax:
            out[k] = {e: name(r) for e, r in qs[ax].items() if len(r) >= 2}
            out["src_" + k] = f"SEC 10-Q·10-K XBRL ({ {'prod': '제품·서비스', 'seg': '사업부문', 'geo': '지역'}[ax]} 축)"
    return out


def main(only):
    contact = os.environ.get("SEC_CONTACT")
    if not contact:
        sys.exit("SEC_CONTACT(연락처 이메일) 환경변수가 없어요")
    S.headers.update({"User-Agent": f"personal-valuation-dashboard {contact}", "Accept-Encoding": "gzip, deflate"})
    st = yaml.safe_load(open(ROOT / "config" / "stocks.yaml", encoding="utf-8"))
    tickers = only or sorted({str(h["code"]) for g in st.values() if isinstance(g, list) for h in g if isinstance(h, dict) and h.get("market") == "US"})
    cik = {v["ticker"].upper(): int(v["cik_str"]) for v in get("https://www.sec.gov/files/company_tickers.json").json().values()}
    saved = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for t in tickers:
        c = cik.get(t) or cik.get({"GOOG": "GOOGL"}.get(t, ""))
        if not c:
            print("  CIK 없음", t)
            continue
        try:
            saved[t] = ticker(t, c)
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {t}: {str(e)[:100]}")
            continue
        r = saved[t]
        print(f"  {t}: 보고서 {r['filings']}개 · 제품 {len(r.get('prod') or {})}분기 · 지역 {len(r.get('geo') or {})}분기")
        OUT.write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")  # 종목마다 저장 (중간에 끊겨도 남게)
    print("저장:", OUT)


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        v = {("A", "2025-01-01", "2025-03-31"): 10, ("A", "2025-04-01", "2025-06-30"): 12, ("A", "2025-07-01", "2025-09-30"): 13,
             ("A", "2025-01-01", "2025-09-30"): 35, ("A", "2025-01-01", "2025-12-31"): 50, ("B", "2025-01-01", "2025-12-31"): 8,
             ("B", "2025-01-01", "2025-03-31"): 2, ("B", "2025-04-01", "2025-06-30"): 2, ("B", "2025-07-01", "2025-09-30"): 2}
        q = quarterly(v)
        assert q["2025-12-31"] == {"A": 15, "B": 2} and q["2025-03-31"] == {"A": 10, "B": 2}, q
        two = {"q1": {"제품": 100, "아이폰": 60, "맥": 25, "아이패드": 15, "서비스": 40}, "q2": {"제품": 110, "아이폰": 70, "맥": 24, "아이패드": 16, "서비스": 45}}
        assert parents(two) == {"제품"}, parents(two)  # 서비스(40) = 맥+아이패드 는 1분기만 우연 → 안 뺌
        assert pretty("aapl:IPhoneMember", {}) == "IPhone" and pretty("aapl:MacMember", {"aapl_MacMember": "Mac"}) == "Mac"
        assert SKIP.search("us-gaap:IntersegmentEliminationMember") and not SKIP.search("aapl:IPhoneMember")
        print("ok")
    else:
        main(sys.argv[1:])
