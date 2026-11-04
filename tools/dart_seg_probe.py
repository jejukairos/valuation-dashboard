"""(임시 시험) DART 정기보고서 XBRL 원본에 부문별·지역별 매출 주석이 들어 있는지 — 몇 년도부터, 어떤 이름으로.
서버(DART_KEY)에서 .github/workflows/probe.yml 로 한 번 돌려 보고 지움."""
import io
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import date
from xml.etree import ElementTree as ET

import requests

KEY = os.environ["DART_KEY"]
API = "https://opendart.fss.or.kr/api"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "collector"))
from kr_stock import corp_code  # noqa: E402

AX = ("SegmentsAxis", "GeographicalAreasAxis", "ProductsAndServicesAxis")
XI, XD, XL = "{http://www.xbrl.org/2003/instance}", "{http://xbrl.org/2006/xbrldi}", "{http://www.w3.org/1999/xlink}"


def reports(cc):
    j = requests.get(f"{API}/list.json", params={"crtfc_key": KEY, "corp_code": cc, "bgn_de": "20240101", "pblntf_ty": "A", "page_count": 100}, timeout=30).json()
    return [r for r in j.get("list") or [] if re.search(r"(분기|반기|사업)보고서", r["report_nm"]) and "기재정정" not in r["report_nm"]]


def rcode(nm):
    if "반기" in nm:
        return "11012"
    if "사업" in nm:
        return "11011"
    return "11013" if re.search(r"\.0[345]\)", nm) else "11014"


def labels(z):
    f = next((n for n in z.namelist() if "lab-ko" in n or "-ko_" in n), None)
    if not f:
        return {}
    root = ET.fromstring(z.read(f))
    loc, txt, arc = {}, {}, {}
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag == "loc":
            loc[el.get(XL + "label")] = el.get(XL + "href", "").split("#")[-1]
        elif tag == "label" and (el.get(XL + "role") or "").endswith("/label"):
            txt[el.get(XL + "label")] = (el.text or "").strip()
        elif tag == "labelArc":
            arc[el.get(XL + "from")] = el.get(XL + "to")
    return {loc[f]: txt.get(t) for f, t in arc.items() if f in loc and txt.get(t)}


def probe(rcept, nm, show):
    r = requests.get(f"{API}/fnlttXbrl.xml", params={"crtfc_key": KEY, "rcept_no": rcept, "reprt_code": rcode(nm)}, timeout=120)
    try:
        z = zipfile.ZipFile(io.BytesIO(r.content))
    except zipfile.BadZipFile:
        print("   zip 아님")
        return
    raw = z.read(next(n for n in z.namelist() if n.endswith(".xbrl")))
    print("   축 글자 수", {a: raw.count(a.encode()) for a in AX}, "| dims 예", re.findall(rb"<xbrldi:\w+Member dimension=\"[^\"]+\">[^<]+<", raw)[:3])
    root = ET.fromstring(raw)
    ctx = {}
    for c in root.iter(XI + "context"):
        dims = [(m.get("dimension").split(":")[-1], (m.text or "").strip()) for m in c.iter(XD + "explicitMember")]
        st, en = c.find(f".//{XI}startDate"), c.find(f".//{XI}endDate")
        dims = [x for x in dims if x[0] != "ConsolidatedAndSeparateFinancialStatementsAxis"]  # 연결·별도 축은 모든 숫자에 붙음
        if len(dims) == 1 and dims[0][0] in AX and st is not None and en is not None:
            ctx[c.get("id")] = (dims[0][0], dims[0][1], st.text.strip(), en.text.strip())
    rows, names = [], Counter()
    for el in root:
        c = ctx.get(el.get("contextRef"))
        if not c:
            continue
        local = el.tag.split("}")[-1]
        names[local] += 1
        if "Revenue" in local and el.text and re.fullmatch(r"-?\d+(\.\d+)?", el.text.strip()):
            d = (date.fromisoformat(c[3]) - date.fromisoformat(c[2])).days
            rows.append((local, c[0], c[1], c[2], c[3], d, float(el.text)))
    per = defaultdict(set)
    for x in rows:
        per[x[1]].add(f"{x[3]}~{x[4]}")
    print("   축 붙은 항목", names.most_common(5), "| 매출 행", len(rows), "| 기간", {a: sorted(v) for a, v in per.items()})
    if show:
        lab = labels(z)
        for x in [x for x in rows if 80 <= x[5] <= 100][:30]:
            print("     ", x[0], x[1], lab.get(x[2].replace(":", "_"), x[2]), x[3], x[4], f"{x[6] / 1e8:,.0f}억")


for code in sys.argv[1:]:
    rs = reports(corp_code(code))
    print("==", code, len(rs))
    for x in rs[:8]:
        print("  •", x["rcept_dt"], x["report_nm"].strip())
        try:
            probe(x["rcept_no"], x["report_nm"], x is rs[0])
        except Exception as e:  # noqa: BLE001
            print("   오류", str(e)[:150])
