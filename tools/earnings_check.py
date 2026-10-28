"""실적 요약 예약 작업(tools/ir_live.ps1) 도우미.
has <코드> <분기>  → earnings.yaml 에 그 분기 요약이 이미 있으면 종료코드 0
export            → earnings.yaml 을 site/data/earnings.json 으로 (전체 갱신을 기다리지 않고 바로 사이트에 반영)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collector"))
from common import DATA, load_yaml, write_json  # noqa: E402

d = load_yaml("earnings.yaml") or {}
if sys.argv[1] == "has":
    sys.exit(0 if any(x.get("quarter") == sys.argv[3] for x in d.get(sys.argv[2]) or []) else 1)
if sys.argv[1] == "export":
    write_json(DATA / "earnings.json", d)
