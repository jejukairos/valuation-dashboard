"""실적 요약 예약 작업(tools/ir_live.ps1) 도우미.
has <코드> <분기>  → earnings.yaml 에 그 분기 요약이 이미 있으면 종료코드 0
export            → earnings.yaml 을 site/data/earnings.json 으로 (전체 갱신을 기다리지 않고 바로 사이트에 반영)
export_ir         → ir_brief.yaml(📋 IR 요약·IR 분석)을 site/data/ir_brief.json 으로 (earnings.yaml 과 따로 — 둘이 동시에 고쳐져도 안 겹치게)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collector"))
from common import DATA, load_yaml, write_json  # noqa: E402

d = load_yaml("earnings.yaml") or {}
if sys.argv[1] == "has":  # has 코드 분기 [script] — script = 네이버 발표 자막으로 쓴 요약만 (출처에 '발표 자막', tools/ir_live.ps1)
    sys.exit(0 if any(x.get("quarter") == sys.argv[3] and (len(sys.argv) < 5 or "발표 자막" in str(x.get("source") or "")) for x in d.get(sys.argv[2]) or []) else 1)
if sys.argv[1] == "export":
    write_json(DATA / "earnings.json", d)
if sys.argv[1] == "export_ir":
    ir = load_yaml("ir_brief.yaml") or {}
    bad = [f"{c} {e.get('quarter')}" for c, l in ir.items() for e in l if not (e.get("sum") and e.get("ana"))]
    if bad:
        sys.exit(f"ir_brief.yaml: IR 요약(sum)·IR 분석(ana) 둘 다 있어야 함 — {bad}")
    for l in ir.values():  # '제목: 글' 처럼 따옴표 없이 콜론+띄어쓰기가 든 줄은 YAML 이 표로 읽음 → 다시 글자로 (11/7 실적 탭 멈춤)
        for e in l:
            for s in (e.get("sum") or []) + (e.get("ana") or []):
                s["l"] = [x if isinstance(x, str) else " ".join(f"{k}: {v}" for k, v in (x or {}).items()) for x in s.get("l") or []]
    write_json(DATA / "ir_brief.json", ir)
