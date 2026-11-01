"""📦 라면·화장품 수출 예전 달 채우기 (UN Comtrade 공개 미리보기 API, 키 없이 · 한 번에 한 달) → config/exports.yaml.
라면 = HS 1902.30, 화장품 = HS 3304 (기초 = 3304.99), 백만 달러. 한국 관세청이 UN 에 보낸 숫자라 관세청 발표와 조금 다를 수 있음.
이미 적힌 달은 건드리지 않음 (사용자가 보낸 관세청 숫자가 우선). 사용: .venv\\Scripts\\python.exe tools\\exports_backfill.py 2020-01 2025-12"""
import sys
import time
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "config" / "exports.yaml"
P = {0: "전체", 156: "중국", 344: "홍콩", 842: "미국", 392: "일본", 608: "필리핀", 826: "영국", 643: "러시아", 458: "말레이시아", 528: "네덜란드", 616: "폴란드"}
WANT = {"ramen": ("190230", [0, 156, 842, 392, 608, 826, 643, 458, 528]),
        "cosmetics": ("3304", [0, 156, 344, 842, 392, 616, 826]),
        "skincare": ("330499", [0, 156, 344, 842, 392, 616, 826])}


def month(ym):
    r = requests.get("https://comtradeapi.un.org/public/v1/preview/C/M/HS", timeout=60, params={
        "reporterCode": 410, "period": ym.replace("-", ""), "flowCode": "X",
        "cmdCode": ",".join(c for c, _ in WANT.values()), "partnerCode": ",".join(str(p) for p in P)})
    return r.json().get("data") or []


def main(a, b):
    d = yaml.safe_load(PATH.read_text(encoding="utf-8")) if PATH.exists() else {}
    y, m = map(int, a.split("-"))
    while f"{y}-{m:02d}" <= b:
        ym = f"{y}-{m:02d}"
        rows = month(ym)
        for key, (cmd, parts) in WANT.items():
            for r in rows:
                if r["cmdCode"] == cmd and r["partnerCode"] in parts and r.get("primaryValue"):
                    d.setdefault(key, {}).setdefault(P[r["partnerCode"]], {}).setdefault(ym, round(r["primaryValue"] / 1e6, 1))
        print(ym, len(rows))
        time.sleep(1.5)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    head = PATH.read_text(encoding="utf-8").split("\nramen:", 1)[0] if PATH.exists() else ""
    body = yaml.safe_dump({k: {s: dict(sorted(v.items())) for s, v in d[k].items()} for k in ("ramen", "cosmetics", "skincare", "makeup") if k in d},
                          allow_unicode=True, sort_keys=False, width=1000)
    PATH.write_text((head.rstrip() + "\n" if head else "") + body, encoding="utf-8")


if __name__ == "__main__":
    main(*(sys.argv[1:3] if len(sys.argv) > 2 else ("2020-01", "2025-12")))
