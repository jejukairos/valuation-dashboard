"""🚗 산업 탭: 현대차·기아 월별 글로벌 도매판매 — DART '영업(잠정)실적(공정공시)' 월 판매 공시 (매달 1~2일 오후) → site/data/autosales.json
공시 한 건에 이번 달·지난달·작년 같은 달·올해 누적이 다 있어서, 처음 한 번 최근 3년 치 공시를 읽으면 약 4년 치가 채워진다.
그 뒤에는 최근 40일 공시만 본다. 숫자는 cache/autosales.json 에 쌓는다 (그달 공시 값 > 다음 달 공시의 '전기실적' 값)."""
import io
import re
import sys
import zipfile
from datetime import timedelta

from common import CACHE, HTTP, REPORT, now_kst, read_json, write_json

CARS = {"005380": "현대차", "000270": "기아"}
ROWS = {"dom": r"판매대수\s*\(\s*내수\s*\)|국내|내수", "ovs": r"판매대수\s*\(\s*해외\s*\)|해외", "spc": r"판매대수\s*\(\s*특수\s*\)|특수", "tot": r"계|합계"}
N = r"([\d,]+)"


def parse_sales(t):
    """공시 본문(칸을 | 로 나눈 글자) → {ym, cur{dom,ovs,spc,tot}, prev{…} 지난달, ly{…} 작년 같은 달, ytd, ytd_ly} — 월 판매 공시가 아니면 None.
    표 두 개(월·누적)가 같은 칸 이름이라, 이름마다 첫 번째 = 월, 두 번째 = 누적."""
    m = re.search(r"당기실적\s*\|?\s*\(\s*'?(\d{2}|\d{4})\s*[.년]\s*(\d{1,2})\s*월", t)
    if not m or "판매" not in t and "국내" not in t:
        return None
    y, mo = int(m.group(1)), int(m.group(2))
    ym = f"{2000 + y if y < 100 else y}-{mo:02d}"
    num = lambda s: int(s.replace(",", ""))  # noqa: E731
    cur, prev, ly, ytd, ytd_ly = {}, {}, {}, {}, {}
    for k, lab in ROWS.items():
        # 월 표: | 이름 | 이번 달 | 지난달 | 증감% | (흑자전환 칸) | 작년 같은 달 | …
        hits = list(re.finditer(r"\|\s*(?:" + lab + r")\s*\|\s*" + N + r"\s*\|\s*" + N + r"\s*\|[^|]*\|[^|]*\|\s*" + N, t))
        if hits:
            cur[k], prev[k], ly[k] = (num(hits[0].group(i)) for i in (1, 2, 3))
        # 누적 표: | 이름 | 올해 누적 | - | - | - | 작년 누적 |
        c = list(re.finditer(r"\|\s*(?:" + lab + r")\s*\|\s*" + N + r"\s*\|\s*-\s*\|\s*-\s*\|\s*-\s*\|\s*" + N, t))
        if c:
            ytd[k], ytd_ly[k] = num(c[0].group(1)), num(c[0].group(2))
    if "tot" not in cur or "dom" not in cur or "ovs" not in cur:
        return None
    if abs(cur["dom"] + cur["ovs"] + cur.get("spc", 0) - cur["tot"]) > 2:  # 칸을 잘못 읽었으면 버림
        return None
    return {"ym": ym, "cur": cur, "prev": prev, "ly": ly, "ytd": ytd.get("tot"), "ytd_ly": ytd_ly.get("tot")}


def _ym_add(ym, k):
    y, m = int(ym[:4]), int(ym[5:])
    m += k
    return f"{y + (m - 1) // 12}-{(m - 1) % 12 + 1:02d}"


def _filings(code, days):
    import kr_stock
    end, out, page = now_kst(), [], 1
    while True:
        j = HTTP.get("https://opendart.fss.or.kr/api/list.json",
                     params={"crtfc_key": kr_stock.dart_key(), "corp_code": kr_stock.corp_code(code), "pblntf_ty": "I", "page_count": 100, "page_no": page,
                             "bgn_de": (end - timedelta(days=days)).strftime("%Y%m%d"), "end_de": end.strftime("%Y%m%d")}).json()
        out += [r for r in j.get("list") or [] if "영업" in r.get("report_nm", "") and "잠정" in r.get("report_nm", "") and "연결" not in r.get("report_nm", "")]
        if page >= int(j.get("total_page") or 1):
            return out
        page += 1


def _doc(rcept_no):
    import kr_stock
    r = HTTP.get("https://opendart.fss.or.kr/api/document.xml", params={"crtfc_key": kr_stock.dart_key(), "rcept_no": rcept_no})
    z = zipfile.ZipFile(io.BytesIO(r.content))
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " | ", z.read(z.namelist()[0]).decode("utf-8", "ignore")))


def collect():
    db = read_json(CACHE / "autosales.json") or {}
    try:
        for code, nm in CARS.items():
            d = db.setdefault(code, {"months": {}, "seen": []})
            days = 40 if len(d["months"]) > 24 else 365 * 3 + 40  # 처음 한 번은 3년 치
            for f in sorted(_filings(code, days), key=lambda r: r["rcept_dt"]):
                if f["rcept_no"] in d["seen"]:
                    continue
                p = parse_sales(_doc(f["rcept_no"]))
                d["seen"].append(f["rcept_no"])
                if not p:
                    continue  # 분기 잠정실적 등 다른 공시
                M = d["months"]
                M[p["ym"]] = {**p["cur"], "src": "공시"}
                for ym, v in ((_ym_add(p["ym"], -1), p["prev"]), (_ym_add(p["ym"], -12), p["ly"])):
                    if v.get("tot") and M.get(ym, {}).get("src") != "공시":
                        M[ym] = {**v, "src": "다음 공시"}
                d["last"] = {"ym": p["ym"], "date": f"{f['rcept_dt'][:4]}-{f['rcept_dt'][4:6]}-{f['rcept_dt'][6:]}", "ytd": p["ytd"], "ytd_ly": p["ytd_ly"],
                             "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={f['rcept_no']}"}
        write_json(CACHE / "autosales.json", db)
        REPORT.success("현대차·기아 월 판매 (DART)")
    except RuntimeError as e:  # 내 컴퓨터엔 DART 키가 없음 → 쌓아 둔 값으로
        print("  월 판매: 건너뜀 —", str(e)[:60])
    except Exception as e:  # noqa: BLE001
        REPORT.fail("현대차·기아 월 판매 (DART)", str(e)[:80])
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "src": "DART 영업(잠정)실적(공정공시) 월 판매 — 도매(공장 출고) 기준",
            "cars": [{"code": c, "name": CARS[c], "last": db.get(c, {}).get("last"),
                      "months": [[ym, v.get("dom"), v.get("ovs"), v.get("spc"), v.get("tot")] for ym, v in sorted((db.get(c, {}).get("months") or {}).items())]}
                     for c in CARS]}


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:  # 자체 점검: 기아·현대차 2026년 10월 공시 표 모양 그대로
        kia = ("| 구분 (단위:대,%) | 당기실적 ('26.10 월) | 전기실적 ('26.9월) | 전기대비 증감율 (%) | - | 전년동기 실적 ('25.10 월) | 전년동기대비증감율 (%) | - | "
               "판매대수(내수) | 51,007 | 45,705 | +11.6 | - | 40,001 | +27.5 | - | 판매대수(해외) | 239,308 | 236,125 | +1.3 | - | 223,215 | +7.2 | - | "
               "판매대수(특수) | 904 | 745 | +21.3 | - | 801 | +12.9 | - | 계 | 291,219 | 282,575 | +3.1 | - | 264,017 | +10.3 | - | "
               "구분 (단위:대,%) | 당기누적 ('26.10 월) | - | - | - | 전년동기누적 ('25.10 월) | 전년동기누적대비 증감율(%) | - | "
               "판매대수(내수) | 487,308 | - | - | - | 453,943 | +7.4 | - | 판매대수(해외) | 2,276,335 | - | - | - | 2,178,349 | +4.5 | - | "
               "판매대수(특수) | 6,311 | - | - | - | 4,398 | +43.5 | - | 계 | 2,769,954 | - | - | - | 2,636,690 | +5.1 | - |")
        p = parse_sales(kia)
        assert p["ym"] == "2026-10" and p["cur"] == {"dom": 51007, "ovs": 239308, "spc": 904, "tot": 291219}, p
        assert p["prev"]["tot"] == 282575 and p["ly"]["tot"] == 264017 and p["ytd"] == 2769954 and p["ytd_ly"] == 2636690, p
        hmc = ("| 구분(단위:대,%) | 당기실적 (2026년10 월) | 전기실적 (2026년9 월) | 전기대비 증감율(%) | 흑자적 자전환여부 | 전년동기 실적 (2025년10 월) | 전년동기 대비 증감율 (%) | 흑자적 자전환여 부 | "
               "국내 | 49,042 | 49,022 | 0.04 | - | 53,822 | -8.9 | - | 해외 | 280,731 | 261,026 | 7.5 | - | 298,261 | -5.9 | - | 계 | 329,773 | 310,048 | 6.4 | - | 352,083 | -6.3 | - | "
               "구분(단위:대,%) | 당기누적 (2026년 1~10월) | - | - | 흑자적 자전환여부 | 전년동기 누적 (2025년 1~10월) | ")
        p = parse_sales(hmc + "국내 | 497,223 | - | - | - | 589,280 | -15.6 | - | 해외 | 2,721,363 | - | - | - | 2,868,149 | -5.1 | - | 계 | 3,218,586 | - | - | - | 3,457,429 | -6.9 | - |")
        assert p["ym"] == "2026-10" and p["cur"]["tot"] == 329773 and p["ly"]["tot"] == 352083 and p["prev"]["dom"] == 49022 and p["ytd"] == 3218586, p
        assert parse_sales("| 매출액 | 당해실적 | 1,000 |") is None and _ym_add("2026-01", -1) == "2025-12" and _ym_add("2026-10", -12) == "2025-10"
        print("ok")
    else:
        from common import DATA
        write_json(DATA / "autosales.json", collect())
        print(REPORT.failures or "ok")
