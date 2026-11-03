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
ROWS = {"dom": r"판매대수\(내수\)|국내|내수", "ovs": r"판매대수\(해외\)|해외", "spc": r"판매대수\(특수\)|특수", "tot": r"계|합계"}


def _rows(x):
    """공시 문서(DART XML 의 TD·TE·TU 든 화면 HTML 의 td 든) → 표 줄마다 [칸 글자, …]"""
    return [[re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip() for _, c in re.findall(r"<(T[DHEU])\b[^>]*>(.*?)</\1\s*>", tr, re.S | re.I)]
            for tr in re.findall(r"<TR\b[^>]*>(.*?)</TR\s*>", x, re.S | re.I)]


def parse_sales(rows):
    """표 줄들 → {ym, cur{dom,ovs,spc,tot}, prev{…} 지난달, ly{…} 작년 같은 달, ytd, ytd_ly} — 월 판매 공시가 아니면 None.
    칸 순서가 해마다 다름 (2023 현대차 = 5칸, 2026 기아 = '흑자전환' 칸 포함) → 머리 줄에서 '당기실적·전기실적·전년동기실적' 칸 위치를 찾아 그 칸만 읽음."""
    num = lambda s: int(s.replace(",", "")) if re.fullmatch(r"[\d,]+", s or "") else None  # noqa: E731
    at = lambda r, i: num(r[i]) if i is not None and i < len(r) else None  # noqa: E731
    ym, mode, col = None, None, {}
    cur, prev, ly, ytd, ytd_ly = {}, {}, {}, {}, {}
    for r in rows:
        sq = [c.replace(" ", "") for c in r]
        j = " ".join(r)
        if sq and re.search(r"단위:대", sq[0]):  # 판매 표 머리 줄 (매출액 표는 '백만원')
            pos = lambda p: next((i for i, c in enumerate(sq) if p in c), None)  # noqa: E731
            if "당기실적" in j:
                m = re.search(r"당기실적\s*\(\s*'?(\d{2}|\d{4})\s*[.년]\s*(\d{1,2})\s*월", j)
                if m:
                    y = int(m.group(1))
                    ym = f"{2000 + y if y < 100 else y}-{int(m.group(2)):02d}"
                mode, col = "m", {"cur": pos("당기실적"), "prev": pos("전기실적"), "ly": pos("전년동기실적")}
            elif "당기누적" in j:
                mode, col = "c", {"cur": pos("당기누적"), "ly": pos("전년동기누적")}
            continue
        k = next((k for k, p in ROWS.items() if sq and re.fullmatch(p, sq[0])), None)
        if not k or not mode:
            continue
        if mode == "m" and k not in cur and at(r, col["cur"]) is not None:
            cur[k], prev[k], ly[k] = at(r, col["cur"]), at(r, col["prev"]), at(r, col["ly"])
        elif mode == "c" and k not in ytd:
            ytd[k], ytd_ly[k] = at(r, col["cur"]), at(r, col["ly"])
    prev, ly = ({k: v for k, v in x.items() if v is not None} for x in (prev, ly))
    if not ym or any(cur.get(k) is None for k in ("tot", "dom", "ovs")):
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
    return _rows(z.read(z.namelist()[0]).decode("utf-8", "ignore"))


def collect():
    db = read_json(CACHE / "autosales.json") or {}
    try:
        for code, nm in CARS.items():
            d = db.setdefault(code, {"months": {}, "seen": []})
            if not d["months"]:
                d["seen"] = []  # 하나도 못 읽었으면 처음부터 다시 (11/3 첫 실행은 칸 나누기를 잘못해 38건 모두 놓침)
            days = 40 if len(d["months"]) > 24 else 365 * 3 + 40  # 처음 한 번은 3년 치
            miss = 0
            for f in sorted(_filings(code, days), key=lambda r: r["rcept_dt"]):
                if f["rcept_no"] in d["seen"]:
                    continue
                p = parse_sales(_doc(f["rcept_no"]))
                if not p:
                    miss += 1
                    continue  # 분기 잠정실적 등 다른 공시 — seen 에 안 넣어 읽는 법을 고치면 다시 읽음
                d["seen"].append(f["rcept_no"])
                M = d["months"]
                M[p["ym"]] = {**p["cur"], "src": "공시"}
                for ym, v in ((_ym_add(p["ym"], -1), p["prev"]), (_ym_add(p["ym"], -12), p["ly"])):
                    if v.get("tot") and M.get(ym, {}).get("src") != "공시":
                        M[ym] = {**v, "src": "다음 공시"}
                d["last"] = {"ym": p["ym"], "date": f"{f['rcept_dt'][:4]}-{f['rcept_dt'][4:6]}-{f['rcept_dt'][6:]}", "ytd": p["ytd"], "ytd_ly": p["ytd_ly"],
                             "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={f['rcept_no']}"}
            print(f"  월 판매 {nm}: {len(d['months'])}개월 · 못 읽은 공시 {miss}건")
        if not any(db[c]["months"] for c in CARS):
            raise ValueError("판매 공시를 하나도 못 읽음 — 표 모양이 바뀌었는지 확인")
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
    if sys.argv[1:2] == ["--test"]:  # 자체 점검: 기아 2026년 10월(흑자전환 칸 있음)·현대차 2023년 9월(5칸) 표 모양 그대로
        T = lambda rows: "".join("<TR>" + "".join(f"<TD><P>{c}</P></TD>" for c in r.split("|")) + "</TR>" for r in rows)  # noqa: E731
        kia = T(["구분 (단위:대,%)|당기실적<BR/>('26.10 월)|전기실적 ('26.9월)|전기대비 증감율 (%)|흑자적자전환여부|전년동기 실적 ('25.10 월)|전년동기대비증감율 (%)|흑자적자전환여부",
                 "판매대수(내수)|51,007|45,705|+11.6|-|40,001|+27.5|-", "판매대수(해외)|239,308|236,125|+1.3|-|223,215|+7.2|-",
                 "판매대수(특수)|904|745|+21.3|-|801|+12.9|-", "계|291,219|282,575|+3.1|-|264,017|+10.3|-",
                 "구분 (단위:대,%)|당기누적 ('26.10 월)|-|-|-|전년동기누적 ('25.10 월)|전년동기누적대비 증감율(%)|-",
                 "판매대수(내수)|487,308|-|-|-|453,943|+7.4|-", "판매대수(해외)|2,276,335|-|-|-|2,178,349|+4.5|-",
                 "판매대수(특수)|6,311|-|-|-|4,398|+43.5|-", "계|2,769,954|-|-|-|2,636,690|+5.1|-"])
        p = parse_sales(_rows(kia))
        assert p["ym"] == "2026-10" and p["cur"] == {"dom": 51007, "ovs": 239308, "spc": 904, "tot": 291219}, p
        assert p["prev"]["tot"] == 282575 and p["ly"]["tot"] == 264017 and p["ytd"] == 2769954 and p["ytd_ly"] == 2636690, p
        hmc = T(["구분|당기실적|전기실적|전기대비증감율(%)|전년동기실적|전년동기대비증감율(%)", "매출액|당해실적|-|-|-|-",  # 위쪽 매출액 표는 건너뜀
                 "구분(단위:대,%)|당기실적 (2023년9월)|전기실적 (2023년8월)|전기대비 증감율(%)|전년동기실적 (2022년9월)|전년동기 대비 증감율(%)",
                 "국내|53,911|55,555|-3.0|56,910|-5.3", "해외|303,240|296,115|2.4|300,645|0.9", "계|357,151|351,670|1.6|357,555|-0.1",
                 "구분(단위:대,%)|당기누적 (2023년1월~9월)|-|-|전년동기누적 (2022년1월~9월)|전년동기 누적대비 증감율(%)",
                 "국내|563,519|-|-|496,835|13.4", "해외|2,563,482|-|-|2,407,216|6.5", "계|3,127,001|-|-|2,904,051|7.7"])
        p = parse_sales(_rows(hmc))
        assert p["ym"] == "2023-09" and p["cur"] == {"dom": 53911, "ovs": 303240, "tot": 357151} and p["prev"]["tot"] == 351670 and p["ly"]["dom"] == 56910, p
        assert p["ytd"] == 3127001 and p["ytd_ly"] == 2904051, p
        assert parse_sales(_rows(T(["매출액|당해실적|1,000"]))) is None and _ym_add("2026-01", -1) == "2025-12" and _ym_add("2026-10", -12) == "2025-10"
        for f in sys.argv[2:]:  # 실제 공시 화면 HTML 로도 확인: python autosales.py --test a.html b.html
            print(f[-14:], parse_sales(_rows(open(f, encoding="utf-8").read())))
        print("ok")
    else:
        from common import DATA
        write_json(DATA / "autosales.json", collect())
        print(REPORT.failures or "ok")
