"""📦 관세청 수출입실적 API (공공데이터포털, 키 = CUSTOMS_KEY) → config/exports.yaml 월별 금액을 2020-01 부터 관세청 숫자로 채우고 site/data/exports.json.
'전체' = 품목별 수출입실적(Itemtrade) · 나라별 = 품목별 국가별(nitemtrade, 나라 하나씩). 둘 다 HS 10자리 줄로 오고, 1년 이내씩 물어봄.
라면 = 1902.30.1010 (관세청 글의 '라면' — 1902.30 의 다른 즉석면은 뺌, 2025-10·2026-09 확인) · 화장품 나눔 (관세청 K-뷰티 글과 맞춘 것, 2026-09 확인): 기초 = 3304.99.1000 기초화장용 · 색조 = 3304.10 립 + 3304.20 아이 + 3304.99.2000 메이크업용.
새 달이 표(latest)보다 새로우면 표도 그 달로 바꿈 (영업일수·5국 묶음은 사용자 글에만 있어서 빠짐). 'probe' = 응답 모양 시험. .github/workflows/exports.yml 에서 매일."""
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import unquote

import requests
import yaml

from common import DATA, now_kst, write_json

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "config" / "exports.yaml"
URL = "https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList"
ITEM = "https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList"  # 나라 합계 — '전체' 줄
KEY = unquote(os.environ.get("CUSTOMS_KEY", "").strip())  # 'Encoding' 키를 넣어도 되게 한 번 풂
CN = {"전체": "", "중국": "CN", "홍콩": "HK", "미국": "US", "일본": "JP", "필리핀": "PH", "영국": "GB", "러시아": "RU", "말레이시아": "MY", "네덜란드": "NL", "폴란드": "PL",
      "독일": "DE", "프랑스": "FR", "스페인": "ES", "이탈리아": "IT", "스웨덴": "SE"}
# 라면 유럽 = 영국·네덜란드·독일·프랑스·스페인·이탈리아·폴란드·스웨덴 합 (app.js EU_C, 사용자 11/10 한화 그림14 '유럽' 증가율 자동)
HS = {"190230": ({"ramen": ("1902301010",)},["전체", "중국", "미국", "일본", "필리핀", "영국", "러시아", "말레이시아", "네덜란드", "독일", "프랑스", "스페인", "이탈리아", "폴란드", "스웨덴"]),
      "3304": ({"cosmetics": ("3304",), "skincare": ("3304991",), "makeup": ("330410", "330420", "3304992")},
               ["전체", "중국", "홍콩", "미국", "일본", "폴란드", "영국"])}
# 💾 반도체·IT (사용자 전달 GS '10월 한국 테크 수출', 2026-11-02): 나라 합계만 · d["tech"][품목] · HBM 은 MCP(복합구조칩)로 잡힘
TECH = {"854232": {"메모리": ("854232",), "D램": ("8542321010",), "낸드": ("8542321030",), "MCP·HBM": ("8542323000",)},
        "852351": {"SSD": ("8523511",)}, "853224": {"MLCC": ("853224",)}, "8524": {"디스플레이": ("8524",)},
        "850760": {"2차전지": ("850760",)}, "8486": {"반도체 장비": ("8486",)}}
# ⚡ 전력기기 · 🥫 음식료 (사용자 전달 증권사 '전력기기/음식료 수출입 통계', 2026-11-02 · HS 이름은 probe 로 확인):
#   변압기 3줄·아이스크림·담배는 코드가 확실. 배전반·GIS·초고압케이블·소스는 증권사 정의를 몰라 후보를 나눠 받음 —
#   10월 확정치(11월 중순)가 들어오면 증권사 전년비(배전반 +1,288% · GIS +168% · 케이블 +54% · 소스 +43%)와 맞는 쪽으로 정리
POWER = {"8504": {"초고압변압기": ("850423",), "배전변압기 650~10,000kVA": ("850422",), "배전변압기 650kVA 이하": ("850421",)},
         "8535": {"GIS·차단기 (72.5kV 이상)": ("853529",)},
         "8537": {"배전반 (1kV 초과)": ("8537203",), "배전반 (1kV 이하)": ("8537104",)},
         "8544": {"전력케이블 (1kV 초과)": ("854460",), "초고압케이블 (8544.60.3)": ("8544603",)}}
FOOD = {"2103": {"소스": ("2103",), "기타 소스 (2103.90.9090)": ("2103909090",)}, "2105": {"아이스크림": ("2105",)}, "2402": {"담배": ("240220",)}}
# 🚗 자동차 (사용자 전달 다올 '월별 한국 자동차 수출액', 산업부 숫자 2026-11-02): 산업부 월별은 car_latest 표, 여기는 관세청 HS 로 2020년부터
CAR = {"8703": {"승용차 (HS 8703)": ("8703",)}, "8704": {"화물차 (HS 8704)": ("8704",)}, "8708": {"자동차부품 (HS 8708)": ("8708",)}}
# 💉 미용 의료기기 (사용자 11/11 다올 박종현 '1-10일 의료기기 수출데이터', 치과·임플란트는 관심 없음 · 📦 수출입 탭):
#   필러 = 3304.99.9000 기타 화장품 (다올 표의 '필러'·'기타 화장품' 줄 숫자가 똑같음) · 톡신 3002.49 · 미용의료기기 9018.90 은 후보 —
#   다올 9월 한 달(톡신 42.7백만$)·10월 표와 맞으면 '후보'를 뗌
MEDX = {"3002": {"톡신 (3002.49 후보)": ("300249",)}, "3304": {"필러·기타 화장품 (3304.99.9000)": ("3304999",)}, "9018": {"미용의료기기 (9018.90 후보)": ("901890",)}}
GROUPS = {"tech": TECH, "power": POWER, "food": FOOD, "car": CAR, "medx": MEDX}  # 나라 합계만 · d[묶음][품목]
DRAM_UP = "D램 단가 (천$/kg)"  # 💾 수출 금액 ÷ 수출 무게 (사용자 11/11 메리츠 'DRAM 중량 기준 수출 단가 사상 최고') — tech 묶음에 같이
Y0 = 2020


SGG = "https://apis.data.go.kr/1220000/sigunguperprlstperacrs/getSigunguPerPrlstPerAcrs"  # 시군구별 (HS 6자리 · 시도 하나씩, 따로 활용신청)
# 💉 시군구 수출 (사용자 11/10 '파마리서치는 의료기기 수출 강릉'): 이름 → (시도코드, HS 6자리, 시군구 이름에 들어간 글자)
#   강릉 3304.99 = 증권가가 리쥬란(파마리서치) 신호로 보는 칸 ('필러' 3304.99.9000 — 회사와 딱 맞진 않지만 흐름이 비슷) · 강원 = 51 (2023-06 전 42)
SGG_JOBS = {"강릉 3304.99 (리쥬란)": ("330499", "강릉")}


def get(hs, cnty, a, b, sido=None):
    p = {"serviceKey": KEY, "strtYymm": a, "endYymm": b, "numOfRows": 1000, "pageNo": 1}
    p.update({"HsSgn": hs, "sidoCd": sido} if sido else {"hsSgn": hs})
    if cnty:
        p["cntyCd"] = cnty
    err = ""
    for _ in range(2):
        try:
            r = requests.get(SGG if sido else URL if cnty else ITEM, params=p, timeout=(10, 40))
            break
        except requests.RequestException as e:  # 메시지에 주소(=키)가 들어갈 수 있어 종류만 남김
            err = type(e).__name__
            time.sleep(5)
    else:
        raise RuntimeError(err)
    try:
        root = ET.fromstring(r.content)
    except ET.ParseError:
        raise RuntimeError(f"HTTP {r.status_code} {r.text[:150]!r}") from None
    auth, code = root.findtext(".//returnAuthMsg"), root.findtext(".//resultCode")
    if auth or code not in (None, "00", "0"):
        raise RuntimeError(f"{code} {auth or root.findtext('.//resultMsg')}")
    items = [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]
    if len(items) >= p["numOfRows"]:  # 한 쪽에 다 안 들어옴 (승용차·부품처럼 세부 코드가 많은 품목) → 기간을 나눠 다시
        raise Full(f"{hs} {a}~{b} {len(items)}줄")
    return items


class Full(RuntimeError):
    pass


def year_rows(hs, cnty, y):
    """한 해 (1,000줄이 넘으면 반년씩 두 번)."""
    try:
        return get(hs, cnty, f"{y}01", f"{y}12")
    except Full:
        return get(hs, cnty, f"{y}01", f"{y}06") + get(hs, cnty, f"{y}07", f"{y}12")


def year_rows_sgg(hs, sido, y):
    """시군구 한 해 (시군구 × 달이라 줄이 많으면 석 달씩)."""
    try:
        return get(hs, "", f"{y}01", f"{y}12", sido=sido)
    except Full:
        return [r for a in range(1, 13, 3) for r in get(hs, "", f"{y}{a:02d}", f"{y}{a + 2:02d}", sido=sido)]


def monthly(rows, kinds):
    """HS 10자리 줄 → {kind: {YYYY-MM: 백만 달러}}. '총계' 줄·10자리가 아닌 줄은 빼서 겹쳐 세지 않음."""
    out = {k: {} for k in kinds}
    for r in rows:
        m, h = re.fullmatch(r"(\d{4})\.(\d{2})", r.get("year", "")), r.get("hsCode") or r.get("hsCd") or ""
        if not (m and len(h) == 10 and r.get("expDlr", "").isdigit()):
            continue
        for k, pre in kinds.items():
            if h.startswith(pre):
                ym = f"{m[1]}-{m[2]}"
                out[k][ym] = out[k].get(ym, 0) + int(r["expDlr"])
    return {k: {ym: round(v / 1e6, 1) for ym, v in s.items()} for k, s in out.items()}


def unit_price(rows, pre):
    """HS 10자리 줄 → {YYYY-MM: 천 달러/kg} = 수출 금액 ÷ 수출 무게(expWgt, kg) · 무게가 0·없는 달은 뺌."""
    usd, kg = {}, {}
    for r in rows:
        m, h = re.fullmatch(r"(\d{4})\.(\d{2})", r.get("year", "")), r.get("hsCode") or r.get("hsCd") or ""
        if m and h.startswith(pre) and r.get("expDlr", "").isdigit() and r.get("expWgt", "").isdigit():
            ym = f"{m[1]}-{m[2]}"
            usd[ym], kg[ym] = usd.get(ym, 0) + int(r["expDlr"]), kg.get(ym, 0) + int(r["expWgt"])
    return {ym: round(usd[ym] / kg[ym] / 1000, 1) for ym in usd if kg[ym]}


assert unit_price([{"year": "2026.10", "hsCode": "8542321010", "expDlr": "5000000000", "expWgt": "62500"}, {"year": "2026.10", "hsCode": "8542323000", "expDlr": "9", "expWgt": "1"},
                   {"year": "2026.09", "hsCode": "8542321010", "expDlr": "7", "expWgt": "0"}], "8542321010") == {"2026-10": 80.0}

_t = monthly([{"year": "2026.09", "hsCode": "3304101000", "expDlr": "7500000"}, {"year": "2026.09", "hsCode": "3304991000", "expDlr": "595200000"},
              {"year": "2026.09", "hsCode": "3304992000", "expDlr": "89300000"}, {"year": "2026.09", "hsCode": "3304999000", "expDlr": "441100000"},
              {"year": "총계", "hsCode": "-", "expDlr": "9"}], HS["3304"][0])
assert _t == {"cosmetics": {"2026-09": 1133.1}, "skincare": {"2026-09": 595.2}, "makeup": {"2026-09": 96.8}}, _t


def sgg_monthly(rows, key):
    """시군구 줄 → {YYYY-MM: 백만 달러} (이름에 key 가 든 시군구만, 같은 달은 더함 · '총계'·빈 줄은 뺌)."""
    out = {}
    for r in rows:
        m, v = re.match(r"(\d{4})\D*(\d{1,2})", r.get("priodTitle", "")), (r.get("expUsdAmt") or "").replace(",", "")
        if m and key in (r.get("sggNm") or "") and v.isdigit():
            ym = f"{m[1]}-{int(m[2]):02d}"
            out[ym] = out.get(ym, 0) + int(v)
    return {ym: round(v / 1e6, 2) for ym, v in out.items()}


assert sgg_monthly([{"priodTitle": "2026.09", "sggNm": "강원특별자치도 강릉시", "expUsdAmt": "4396347"}, {"priodTitle": "2026.09", "sggNm": "원주시", "expUsdAmt": "9"},
                    {"priodTitle": "총계", "sggNm": "", "expUsdAmt": "9"}], "강릉") == {"2026-09": 4.4}


def pct(a, b):
    return round((a / b - 1) * 100) if a is not None and b else None


assert monthly([{"year": "2026.09", "hsCode": c, "expDlr": v} for c, v in (("8542321010", "1000000000"), ("8542323000", "2000000000"), ("8542321030", "500000000"))],
               TECH["854232"]) == {"메모리": {"2026-09": 3500.0}, "D램": {"2026-09": 1000.0}, "낸드": {"2026-09": 500.0}, "MCP·HBM": {"2026-09": 2000.0}}
assert monthly([{"year": "2026.09", "hsCode": c, "expDlr": v} for c, v in (("8544603010", "67600000"), ("8544601010", "16500000"), ("8544700000", "9"))],
               POWER["8544"]) == {"전력케이블 (1kV 초과)": {"2026-09": 84.1}, "초고압케이블 (8544.60.3)": {"2026-09": 67.6}}


def table(d, ym, keys=("ramen", "cosmetics", "skincare", "makeup")):
    """새 달 표: 나라(반도체·IT 는 품목)마다 [금액, 전년비, 전월비]."""
    y, m = int(ym[:4]), int(ym[5:])
    ly, pm = f"{y - 1}-{m:02d}", (f"{y}-{m - 1:02d}" if m > 1 else f"{y - 1}-12")
    lat = {"ym": ym, "src": f"관세청 수출입실적 API ({ym}, 자동 · 받은 날 {now_kst():%Y-%m-%d})"}  # 받은 날 = 카드 '‼️ 수출 데이터 나옴' 7일 (app.js expNew)
    for k in keys:
        lat[k] = {c: [s[ym], pct(s[ym], s.get(ly)), pct(s[ym], s.get(pm))] for c, s in d.get(k, {}).items() if s.get(ym) is not None}
    return lat


def probe():
    """나라별 API 가 열렸는지 + 새 품목 후보의 HS 10자리·품목 이름·26.09 금액 (전력기기·소스·아이스크림·담배 코드 고르기)."""
    for nm, args in [("미국 라면 26.09", ("190230", "US", "202609", "202609"))] + [
            (f"전체 {h} 26.09", (h, "", "202609", "202609")) for h in ("8504", "8535", "8537", "8544", "2103", "2105", "2402")]:
        try:
            rows = get(*args)
            print(nm, len(rows), "줄")
            for r in sorted(rows, key=lambda r: r.get("hsCode") or ""):
                if r.get("year") != "총계":
                    print("   ", r.get("hsCode"), r.get("statKor"), round(int(r.get("expDlr") or 0) / 1e6, 2))
        except Exception as e:  # noqa: BLE001
            print(nm, "실패:", e)
    # 💉 시군구 (강원 강릉 = 파마리서치 · 홍천 = 클래시스 · 춘천 = 휴젤): 시도코드 51(강원특별자치도)·42(옛 강원) × HS 3304.99 · 9018.90 · 3002.49
    for sido, ym, hs in [("51", "202609", "330499"), ("42", "202209", "330499"), ("51", "202609", "901890"), ("51", "202609", "300249")]:
        try:
            rows = get(hs, "", ym, ym, sido=sido)
            print(f"시군구 {sido} {hs} {ym}", len(rows), "줄", *[f"{r.get('priodTitle')} {r.get('sggNm')} {r.get('hsSgn')} {r.get('korePrlstNm')} {r.get('expUsdAmt')}" for r in rows
                                                              if any(k in (r.get("sggNm") or "") for k in ("강릉", "홍천", "춘천"))][:12], sep="\n   ")
        except Exception as e:  # noqa: BLE001
            print(f"시군구 {sido} {hs} {ym} 실패:", e)


def main():
    if not KEY:
        sys.exit("CUSTOMS_KEY 없음")
    d = yaml.safe_load(PATH.read_text(encoding="utf-8"))
    got, fail, now, api = 0, [], now_kst(), {}  # api = 이번에 관세청에서 받은 가장 새 달 (묶음별) → seen

    jobs = ([(hs, kinds, nm, None) for hs, (kinds, names) in HS.items() for nm in names]
            + [(hs, items, "", g) for g, G in GROUPS.items() for hs, items in G.items()])  # "" = 나라 합계 묶음 (반도체·IT · 전력기기 · 음식료)
    for hs, kinds, nm, grp in jobs:
        for y in range(Y0, now.year + 1):
            t0 = time.time()
            try:
                rows = year_rows(hs, CN.get(nm, ""), y)
                v = monthly(rows, kinds)
                if grp == "tech" and hs == "854232":
                    v[DRAM_UP] = unit_price(rows, TECH["854232"]["D램"][0])
                print(hs, nm or grp, y, sum(map(len, v.values())), "칸", f"{time.time() - t0:.0f}초")
            except Exception as e:  # noqa: BLE001
                print(hs, nm or grp, y, "실패", e, f"{time.time() - t0:.0f}초")
                fail.append(f"{hs}/{nm or grp}/{y}: {e}")
                if nm not in ("전체", "") and "등록되지 않은" in str(e):
                    break  # 나라별 API 가 아직 안 열렸으면 그 나라 나머지 해는 건너뜀
                continue
            for k, s in v.items():  # 관세청 숫자가 Comtrade·사용자 글 숫자보다 우선
                (d.setdefault(k, {}).setdefault(nm, {}) if nm else d.setdefault(grp, {}).setdefault(k, {})).update(s)
                got += len(s)
                if s and (grp or nm == "전체"):
                    api[grp or k] = max(api.get(grp or k, ""), max(s))
            time.sleep(0.3)
    for nm, (hs, key) in SGG_JOBS.items():  # 💉 시군구 — 활용신청 전이면 첫 해에 '등록되지 않은 서비스키' → 나머지 해는 건너뜀
        for y in range(Y0, now.year + 1):
            try:
                v = {}
                for sido in ("51", "42"):  # 강원특별자치도(2023-06~) 코드로 먼저, 없으면 옛 코드
                    v = sgg_monthly(year_rows_sgg(hs, sido, y), key)
                    if v:
                        break
                print("시군구", nm, y, len(v), "칸")
            except Exception as e:  # noqa: BLE001
                print("시군구", nm, y, "실패", e)
                fail.append(f"시군구/{nm}/{y}: {e}")
                if "등록되지 않은" in str(e):
                    break
                continue
            d.setdefault("med", {}).setdefault(nm, {}).update(v)
            got += len(v)
            if v:
                api["med"] = max(api.get("med", ""), max(v))
            time.sleep(0.3)
    # seen = 묶음별 '관세청 확정치로 그 달을 처음 받은 날' (카드 ‼️ 7일, app.js expRel) · 처음 보는 묶음은 옛날 날짜로 (거짓 '새로 나옴' 방지)
    seen = d.setdefault("seen", {})
    for k, ym in api.items():
        if ym not in seen.setdefault(k, {}):
            seen[k][ym] = now.strftime("%Y-%m-%d") if seen[k] else "2000-01-01"
    print(f"관세청 {got}칸 · 실패 {len(fail)}", *fail[:12], sep="\n")
    if not got:
        sys.exit("관세청에서 받은 숫자 없음")
    text = PATH.read_text(encoding="utf-8")
    head = text.split("\nramen:", 1)[0]
    new, newt, ch = max(d["ramen"]["전체"]), max(d.get("tech", {}).get("메모리") or [""]), False
    if new > str(d["latest"]["ym"]):
        d["latest"], ch = table(d, new), True
    if newt > str((d.get("tech_latest") or {}).get("ym", "")):
        d["tech_latest"], ch = table(d, newt, ("tech",)), True
    if ch:  # 표를 새로 쓰면 손으로 단 줄 끝 메모는 사라짐 (power_latest·food_latest 같은 손으로 적은 표도 그대로 다시 씀)
        head = "".join(x + "\n" for x in head.splitlines() if x.startswith("#")) + yaml.safe_dump(
            {k: d[k] for k in d if (k == "latest" or k.endswith("_latest")) and d[k]}, allow_unicode=True, sort_keys=False, width=1000, default_flow_style=None)
    body = yaml.safe_dump({k: {s: dict(sorted(v.items())) for s, v in d[k].items()} for k in ("ramen", "cosmetics", "skincare", "makeup", *GROUPS, "med", "seen") if k in d},
                          allow_unicode=True, sort_keys=False, width=1000)
    PATH.write_text(head.rstrip() + "\n" + body, encoding="utf-8")
    write_json(DATA / "exports.json", yaml.safe_load(PATH.read_text(encoding="utf-8")))
    if fail:
        print("::warning::관세청 일부 실패 — 위 목록 (나라별 API 는 신청 뒤 동기화까지 몇 시간 걸릴 수 있음)")


if __name__ == "__main__":
    probe() if "probe" in sys.argv else main()
