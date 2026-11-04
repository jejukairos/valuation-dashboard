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
RC = {"분기보고서": None, "반기보고서": "11012", "사업보고서": "11011"}


def reports(cc):
    out, page = [], 1
    while page < 6:
        j = requests.get(f"{API}/list.json", params={"crtfc_key": KEY, "corp_code": cc, "bgn_de": "20150101", "pblntf_ty": "A",
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


def probe(rcept, nm):
    r = requests.get(f"{API}/fnlttXbrl.xml", params={"crtfc_key": KEY, "rcept_no": rcept, "reprt_code": rcode(nm)}, timeout=120)
    try:
        z = zipfile.ZipFile(io.BytesIO(r.content))
    except zipfile.BadZipFile:
        print("   zip 아님:", r.content[:200])
        return
    inst = [n for n in z.namelist() if n.endswith(".xbrl")]
    print("   파일", len(z.namelist()), "instance", inst[:2], "lab", [n for n in z.namelist() if "lab" in n][:3])
    if not inst:
        return
    t = z.read(inst[0]).decode("utf-8", "ignore")
    print("   facts≈", t.count("contextRef="), "| 축", {a: t.count(a) for a in AX})
    # 축 붙은 context → 멤버
    ctx = {}
    for m in re.finditer(r'<xbrli:context id="([^"]+)">(.*?)</xbrli:context>', t, re.S):
        body = m.group(2)
        dims = re.findall(r'dimension="[^":]*:?([^"]+)">([^<]+)<', body)
        st = re.search(r"<xbrli:startDate>([^<]+)", body)
        en = re.search(r"<xbrli:endDate>([^<]+)", body)
        if dims and st and en:
            ctx[m.group(1)] = (tuple(dims), st.group(1), en.group(1))
    hits = Counter()
    ex = []
    for m in re.finditer(r'<([\w-]+:\w*Revenue\w*)[^>]*contextRef="([^"]+)"[^>]*>([-\d.]+)<', t):
        c = ctx.get(m.group(2))
        if not c or len(c[0]) != 1 or not any(a in c[0][0][0] for a in AX):
            continue
        hits[(m.group(1), c[0][0][0])] += 1
        if len(ex) < 12:
            ex.append((m.group(1).split(":")[1], c[0][0][1].split(":")[-1][:40], c[1], c[2], m.group(3)))
    print("   매출×축", dict(hits.most_common(6)))
    for e in ex:
        print("     ", e)
    # 한글 이름표
    lab = [n for n in z.namelist() if "lab-ko" in n or n.endswith("_lab.xml")]
    if lab:
        lt = z.read(lab[0]).decode("utf-8", "ignore")
        mem = re.findall(r'xlink:label="lab_([^"]*Member[^"]*)"[^>]*>([^<]+)<', lt)[:8]
        print("   이름표 예", mem)


for code in sys.argv[1:]:
    cc = corp_code(code)
    rs = reports(cc)
    print("==", code, "정기보고서", len(rs), "개", rs[-1]["rcept_dt"] if rs else "", "~", rs[0]["rcept_dt"] if rs else "")
    pick = rs[:1]
    for y in ("2023", "2021", "2019", "2016"):
        x = next((r for r in rs if r["rcept_dt"].startswith(y) and "분기" in r["report_nm"]), None)
        if x:
            pick.append(x)
    for x in pick:
        print("  •", x["rcept_dt"], x["report_nm"].strip(), x["rcept_no"])
        try:
            probe(x["rcept_no"], x["report_nm"])
        except Exception as e:  # noqa: BLE001
            print("   오류", str(e)[:150])
