"""다올 'Amazon K-Beauty 데일리' 그림 표를 Claude 가 옮긴 결과(JSON 한 줄)를 점검해서 cache/kbeauty_img.json 에 넣는다.
tools/ir_live.ps1 이 부름. 사용: python tools/amazon_img.py <날짜 YYYY-MM-DD> <글 주소> <Claude 출력 파일>
줄 합계·칸 합계가 그림의 합계와 하나라도 다르면 잘못 읽은 것으로 보고 넣지 않음 (종료코드 1)."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collector"))
from common import CACHE, read_json, write_json  # noqa: E402


def check(j, day):
    c = j["counts"]
    assert j["date"] == day, f"날짜가 달라요 ({j['date']})"
    assert all(len(v) == 6 for v in c.values()), "나라 칸이 6개가 아니에요"
    assert all(sum(v) == j["row_totals"][b] for b, v in c.items()), "브랜드 합계가 안 맞아요"
    assert [sum(v[i] for v in c.values()) for i in range(6)] == j["col_totals"], "나라 합계가 안 맞아요"
    return c


if __name__ == "__main__":
    day, url, path = sys.argv[1:4]
    m = re.search(r"\{.*\}", Path(path).read_text(encoding="utf-8"), re.S)
    try:
        counts = check(json.loads(m.group(0)), day)
    except Exception as e:  # noqa: BLE001
        print(f"넣지 않음: {e}")
        sys.exit(1)
    db = read_json(CACHE / "kbeauty_img.json") or {}
    db[day] = {"counts": counts, "url": url}
    write_json(CACHE / "kbeauty_img.json", db)
    print(f"{day} 표 {len(counts)}개 브랜드 넣음")
