"""📦 관세청 '품목별 국가별 수출입실적(GW)' (공공데이터포털, 키 = CUSTOMS_KEY) → config/exports.yaml series 를 관세청 숫자로 채우고 site/data/exports.json.
API 는 나라 하나 · HS 하나 · 1년 이내씩. 기본은 최근 2년만 다시 받음 (관세청이 고친 숫자 반영) · 'full' = 2020-01 부터 (Comtrade 숫자를 관세청 숫자로 바꿈).
'probe' = 응답 모양만 찍는 첫 시험 (키는 안 찍음). .github/workflows/exports.yml 에서 매일."""
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
ITEM = "https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList"  # 품목별(나라 합계) — '전체' 줄
KEY = unquote(os.environ.get("CUSTOMS_KEY", "").strip())  # 'Encoding' 키를 넣어도 되게 한 번 풂
CN = {"중국": "CN", "홍콩": "HK", "미국": "US", "일본": "JP", "필리핀": "PH", "영국": "GB", "러시아": "RU", "말레이시아": "MY", "네덜란드": "NL", "폴란드": "PL"}
WANT = {"ramen": ("190230", ["중국", "미국", "일본", "필리핀", "영국", "러시아", "말레이시아", "네덜란드"]),
        "cosmetics": ("3304", ["중국", "홍콩", "미국", "일본", "폴란드", "영국"]),
        "skincare": ("330499", ["중국", "홍콩", "미국", "일본", "폴란드", "영국"])}


def get(hs, cnty, a, b, url=URL):
    p = {"serviceKey": KEY, "strtYymm": a, "endYymm": b, "hsSgn": hs, "numOfRows": 1000, "pageNo": 1}
    if cnty:
        p["cntyCd"] = cnty
    err = ""
    for _ in range(3):
        try:
            r = requests.get(url, params=p, timeout=60)
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
    return [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]


def monthly(rows, hs):
    """{YYYY-MM: 백만 달러}. 같은 달에 여러 HS 단계가 섞여 오면 가장 짧은(=hs 자체에 가까운) 단계만 더함 (겹쳐 세지 않게)."""
    lv = {}
    for r in rows:
        m, h = re.fullmatch(r"(\d{4})\.(\d{2})", r.get("year", "")), r.get("hsCd", "")
        if m and h.startswith(hs) and r.get("expDlr", "").lstrip("-").isdigit():
            lv.setdefault(f"{m[1]}-{m[2]}", {}).setdefault(len(h), []).append(int(r["expDlr"]))
    return {ym: round(sum(d[min(d)]) / 1e6, 1) for ym, d in lv.items()}


assert monthly([{"year": "2026.01", "hsCd": "3304", "expDlr": "5000000"}, {"year": "2026.01", "hsCd": "330499", "expDlr": "3000000"},
                {"year": "2026.02", "hsCd": "3304991000", "expDlr": "1000000"}, {"year": "2026.02", "hsCd": "3304999000", "expDlr": "2000000"},
                {"year": "총계", "hsCd": "", "expDlr": "9"}], "3304") == {"2026-01": 5.0, "2026-02": 3.0}


def probe():
    for nm, args in [("미국 라면 25.10", ("190230", "US", "202510", "202510")), ("나라 없이 라면 25.10", ("190230", "", "202510", "202510")),
                     ("미국 화장품 25년", ("3304", "US", "202501", "202512")), ("미국 기초 25.10", ("330499", "US", "202510", "202510")),
                     ("품목별 API 라면 25.10", ("190230", "", "202510", "202510", ITEM)), ("품목별 API 화장품 25.09~10", ("3304", "", "202509", "202510", ITEM)),
                     ("품목별 API 기초 26.01", ("330499", "", "202601", "202601", ITEM))]:
        try:
            rows = get(*args)
            print(nm, len(rows), "줄", rows[:5], monthly(rows, args[0]))
        except Exception as e:  # noqa: BLE001
            print(nm, "실패:", e)


def main(full=False):
    if not KEY:
        sys.exit("CUSTOMS_KEY 없음")
    d = yaml.safe_load(PATH.read_text(encoding="utf-8"))
    now = now_kst()
    y0 = 2020 if full else now.year - 1
    got, fail = 0, []
    for kind, (hs, names) in WANT.items():
        for nm in names:
            for y in range(y0, now.year + 1):
                try:
                    v = monthly(get(hs, CN[nm], f"{y}01", f"{y}12"), hs)
                except Exception as e:  # noqa: BLE001
                    fail.append(f"{kind}/{nm}/{y}: {e}")
                    continue
                d.setdefault(kind, {}).setdefault(nm, {}).update(v)  # 관세청 숫자가 Comtrade·사용자 글 숫자보다 우선
                got += len(v)
                time.sleep(0.3)
    print(f"관세청 {got}칸 · 실패 {len(fail)}", *fail[:10], sep="\n")
    if not got:
        sys.exit("관세청에서 받은 숫자 없음")
    head = PATH.read_text(encoding="utf-8").split("\nramen:", 1)[0]
    body = yaml.safe_dump({k: {s: dict(sorted(v.items())) for s, v in d[k].items()} for k in ("ramen", "cosmetics", "skincare", "makeup") if k in d},
                          allow_unicode=True, sort_keys=False, width=1000)
    PATH.write_text(head.rstrip() + "\n" + body, encoding="utf-8")
    write_json(DATA / "exports.json", yaml.safe_load(PATH.read_text(encoding="utf-8")))


if __name__ == "__main__":
    probe() if "probe" in sys.argv else main("full" in sys.argv)
