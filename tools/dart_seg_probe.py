"""(임시 시험) DART 정기보고서 XBRL 원본에 부문별·지역별 매출 주석이 들어 있는지 — 몇 년도부터, 어떤 이름으로.
서버(DART_KEY)에서 .github/workflows/probe.yml 로 한 번 돌려 보고 지움."""
import io
import os
import re
import sys
import zipfile
from collections import Counter

import requests

KEY = os.environ["DART_KEY"]
API = "https://opendart.fss.or.kr/api"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "collector"))
from kr_stock import corp_code  # noqa: E402

AX = ("SegmentsAxis", "GeographicalAreasAxis", "ProductsAndServicesAxis")


def reports(cc):
    out, page = [], 1
    while page < 6:
        j = requests.get(f"{API}/list.json", params={"crtfc_key": KEY, "corp_code": cc, "bgn_de": "20230101", "pblntf_ty": "A",
                                                     "page_count": 100, "page_no": page}, timeout=30).json()
        out += j.get("list") or []
        if page >= int(j.get("total_page") or 1):
            break
        page += 1
    return [r for r in out if re.search(r"(분기|반기|사업)보고서", r["report_nm"]) and "기재정정" not in r["report_nm"]]


def rcode(nm):
    if "반기" in nm:
        return "11012"
    if "사업" in nm:
        return "11011"
    return "11013" if re.search(r"\.0[345]\)", nm) else "11014"


def probe(rcept, nm, show):
    r = requests.get(f"{API}/fnlttXbrl.xml", params={"crtfc_key": KEY, "rcept_no": rcept, "reprt_code": rcode(nm)}, timeout=120)
    try:
        z = zipfile.ZipFile(io.BytesIO(r.content))
    except zipfile.BadZipFile:
        print("   zip 아님")
        return
    inst = [n for n in z.namelist() if n.endswith(".xbrl")]
    t = z.read(inst[0]).decode("utf-8", "ignore")
    print("   facts≈", t.count("contextRef="), "| 축", {a: t.count(a) for a in AX})
    if not show or not any(t.count(a) for a in AX):
        return
    i = t.find("SegmentsAxis") if "SegmentsAxis" in t else t.find("GeographicalAreasAxis")
    print("   context 예:", re.sub(r"\s+", " ", t[max(0, i - 400):i + 500]))
    ids = set()
    for m in re.finditer(r'<(?:\w+:)?context id="([^"]+)">(.*?)</(?:\w+:)?context>', t, re.S):
        if any(a in m.group(2) for a in AX):
            ids.add(m.group(1))
    names = Counter()
    for m in re.finditer(r'<([\w-]+:[\w]+)\s[^>]*contextRef="([^"]+)"', t):
        if m.group(2) in ids:
            names[m.group(1)] += 1
    print("   축 붙은 항목 이름", names.most_common(10))
    k = next((nm for nm, _ in names.most_common() if "Revenue" in nm), None)
    if k:
        j = t.find(f"<{k} ")
        for m in list(re.finditer(rf'<{re.escape(k)}\s[^>]*contextRef="([^"]+)"[^>]*>([^<]+)<', t))[:3]:
            cid = m.group(1)
            cm = re.search(rf'<(?:\w+:)?context id="{re.escape(cid)}">(.*?)</(?:\w+:)?context>', t, re.S)
            print("     ", k, m.group(2), "|", re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", cm.group(1)) if cm else "")[:200])


for code in sys.argv[1:]:
    rs = reports(corp_code(code))
    print("==", code, len(rs))
    for x in rs[:10]:
        print("  •", x["rcept_dt"], x["report_nm"].strip())
        try:
            probe(x["rcept_no"], x["report_nm"], x is rs[0])
        except Exception as e:  # noqa: BLE001
            print("   오류", str(e)[:150])
