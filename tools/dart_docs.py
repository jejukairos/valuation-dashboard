"""🧱 한국 종목 정기보고서(분기·반기·사업보고서) 원문을 모두 받기 (사용자 11/5 "분기보고서 다 받아줘 — 한국은 전자공시시스템").
DART OpenAPI '공시서류원본파일'(document.xml) — 2015년~, 같은 기간 보고서가 정정되면 마지막 정정본.
DART 키는 서버(GitHub Secrets)에만 있어서 .github/workflows/dart_docs.yml 에서 돌리고, 받은 원문은 실행 결과 묶음(아티팩트)으로 올려요.
결과: dart_raw/{코드}/{기간}_{접수번호}.zip + dart_raw/index.json — 이 컴퓨터에서 gh run download 로 받아 cache/dart_raw/ 에 두고 표를 읽어요."""
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dart_raw"
API = "https://opendart.fss.or.kr/api"
KEY = os.environ.get("DART_KEY", "")
sys.path.insert(0, str(ROOT / "collector"))


def call(path, **params):
    for i in range(5):
        r = requests.get(f"{API}/{path}", params={"crtfc_key": KEY, **params}, timeout=120)
        if r.headers.get("content-type", "").startswith(("application/json", "text/xml", "application/xml")) and b"<status>020</status>" in r.content[:300] \
                or (path.endswith(".json") and r.json().get("status") == "020"):  # 020 = 요청 한도 넘음 → 쉬었다 다시
            time.sleep(30 * (i + 1))
            continue
        return r
    raise RuntimeError(f"DART 한도 초과가 계속됨 {path}")


def period(nm):
    """'[기재정정]분기보고서 (2025.09)' → '2025.09'"""
    m = re.search(r"\((\d{4})\.(\d{2})\)", nm)
    return f"{m.group(1)}.{m.group(2)}" if m else None


def reports(cc):
    rows, page = [], 1
    while True:
        j = call("list.json", corp_code=cc, bgn_de="20150101", pblntf_ty="A", page_count=100, page_no=page).json()
        rows += j.get("list") or []
        if page >= int(j.get("total_page") or 1):
            break
        page += 1
    best = {}
    for r in rows:  # 같은 기간은 마지막 기재정정본 (첨부 정정·추가는 본문이 같아서 뺌)
        nm, p = r["report_nm"], period(r["report_nm"])
        if not p or not re.search(r"(분기|반기|사업)보고서", nm) or re.search(r"첨부(정정|추가)", nm):
            continue
        if p not in best or r["rcept_dt"] > best[p]["rcept_dt"]:
            best[p] = r
    return [best[p] for p in sorted(best)]


def main(codes, days=None, part=None):
    from kr_stock import corp_code
    since = time.strftime("%Y%m%d", time.localtime(time.time() - days * 86400)) if days else "0"  # --days N = 최근 N일 안에 낸 보고서만 (새 분기 이어 붙이기)
    sy = yaml.safe_load(open(ROOT / "config" / "stocks.yaml", encoding="utf-8"))
    if not codes:
        codes = sorted({str(h["code"]) for g in sy.values() if isinstance(g, list) for h in g
                        if isinstance(h, dict) and h.get("market", "KR") == "KR" and not h.get("data_code")})
    if part:  # --part=i/N : 서버 N대에 나눠 동시에 받음 (보고서 하나에 20초 넘게 걸려서)
        i, k = map(int, part.split("/"))
        codes = codes[i::k]
    ix = OUT / (f"index_{part.split('/')[0]}.json" if part else "index.json")
    idx, n = (json.loads(ix.read_text(encoding="utf-8")) if ix.exists() else {}), 0
    for code in codes:
        try:
            rs = reports(corp_code(code))
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {code} 목록: {str(e)[:80]}")
            continue
        d = OUT / code
        d.mkdir(parents=True, exist_ok=True)
        idx[code] = [x for x in idx.get(code, []) if x["dt"] < since]  # 예전에 받아 둔 목록은 그대로
        for r in (x for x in rs if x["rcept_dt"] >= since):
            f = d / f"{period(r['report_nm'])}_{r['rcept_no']}.zip"
            if not f.exists():
                z = call("document.xml", rcept_no=r["rcept_no"]).content
                if z[:2] != b"PK":
                    print(f"    ⚠ {code} {r['report_nm']}: zip 아님 {z[:120]!r}")
                    continue
                f.write_bytes(z)
                n += 1
            idx[code].append({"p": period(r["report_nm"]), "nm": r["report_nm"].strip(), "rcept": r["rcept_no"], "dt": r["rcept_dt"], "file": f.name})
        print(f"  {code}: 보고서 {len(idx[code])}개 ({idx[code][0]['p'] if idx[code] else '-'} ~ {idx[code][-1]['p'] if idx[code] else '-'})", flush=True)
        ix.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")  # 종목마다 저장 (중간에 멈춰도 목록이 남게)
    print(f"새로 받은 원문 {n}개 · 저장 {OUT}")


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        assert period("[기재정정]분기보고서 (2025.09)") == "2025.09" and period("사업보고서 (2024.12)") == "2024.12"
        print("ok")
    else:
        a = sys.argv[1:]
        d = next((int(x.split("=")[1]) for x in a if x.startswith("--days=")), None)
        pt = next((x.split("=")[1] for x in a if x.startswith("--part=")), None)
        main([x for x in a if not x.startswith("--")], d, pt)
