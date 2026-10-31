"""데이터 갱신 결과 → site/data/run_status.json (사이트 모든 탭 맨 위 🚨 알림용). update.yml 마지막 단계에서 늘 실행.
사용: python collector/run_status.py <수집 단계 결과 success|failure|cancelled> <시도 번호> <작업 기록 주소>"""
import sys

from common import DATA, now_kst, read_json, write_json

MAX = 3  # update.yml 의 '실패하면 다시 시도' 횟수와 같게

if __name__ == "__main__":
    outcome, attempt, url = (sys.argv[1:] + ["", "1", ""])[:3]
    prev = read_json(DATA / "run_status.json", {}) or {}
    dash = read_json(DATA / "dashboard.json", {}) or {}
    now, ok = now_kst().strftime("%Y-%m-%d %H:%M"), outcome == "success"
    write_json(DATA / "run_status.json", {"at": now, "ok": ok, "outcome": outcome, "attempt": int(attempt or 1), "max": MAX, "url": url,
                                          "data_at": dash.get("updated_at"), "last_ok": now if ok else prev.get("last_ok")})
    print(f"갱신 상태: {'성공' if ok else '실패'} ({outcome}) · {attempt}/{MAX}번째 · 화면 데이터 {dash.get('updated_at')}")
