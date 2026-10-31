"""👥 직원 수 추이 (사용자 요청 2026-11-01 — AI 시대엔 직원이 늘어나는지 줄어드는지가 중요) → site/data/employees.json.
한국 = DART '직원 현황'(사업보고서 12월 말 · 반기보고서 6월 말, 한 번 낸 보고서는 cache/demp_{코드}.json 에 보관, 갱신마다 최근 해부터 조금씩),
미국 = stockanalysis.com 종목별 직원 수 표 (회사 연간 보고서 숫자, 회계연도 말). .github/workflows/gpe.yml 에서 하루 두 번."""
import re
import sys

from common import CACHE, DATA, HTTP, REPORT, load_yaml, now_kst, read_json, write_json


def _num(x):
    s = re.sub(r"[^\d.\-]", "", str(x or ""))
    return float(s) if s not in ("", "-", ".") else None


def kr_total(rows):
    """직원 현황 행(사업부문 × 성별) → 전체 직원 수. 합계 행이 있으면 그것만 (같은 사람을 두 번 세지 않게)."""
    T = lambda s: bool(re.search(r"합\s*계|총\s*계|^\s*계\s*$|전\s*체", s or ""))  # noqa: E731
    a = [r for r in rows if T(r.get("fo_bbm")) and T(r.get("sexdstn"))]
    b = [r for r in rows if T(r.get("fo_bbm")) and not T(r.get("sexdstn"))]
    c = [r for r in rows if not T(r.get("fo_bbm")) and T(r.get("sexdstn"))]
    tot = sum(_num(r.get("sm")) or 0 for r in (a or b or c or rows))
    return int(tot) if tot > 0 else None


def kr(code, limit=8):
    from kr_stock import corp_code, dart_key
    path = CACHE / f"demp_{code}.json"
    cache = read_json(path, {})
    cc, y = corp_code(code), now_kst().year
    todo = [(yy, rc) for yy in range(y, y - 11, -1) for rc in ("11011", "11012") if f"{yy}_{rc}" not in cache]
    for year, rc in todo[:limit]:
        j = HTTP.get("https://opendart.fss.or.kr/api/empSttus.json",
                     params={"crtfc_key": dart_key(), "corp_code": cc, "bsns_year": year, "reprt_code": rc}).json()
        rows = j.get("list") or []
        if rows and (n := kr_total(rows)):
            cache[f"{year}_{rc}"] = n
        elif j.get("status") == "013" and year < y - 1:  # 오래된 보고서가 없으면 (상장 전) 다시 안 받음
            cache[f"{year}_{rc}"] = 0
    write_json(path, cache)
    return {f"{k[:4]}-{'12-31' if k.endswith('11011') else '06-30'}": v for k, v in sorted(cache.items()) if v}


def us(t):
    """stockanalysis.com '직원 수' 표 → {회계연도 말 날짜: 직원 수}."""
    html = re.sub(r"<!--.*?-->", "", HTTP.get(f"https://stockanalysis.com/stocks/{t.lower()}/employees/", tries=2, timeout=30).text)
    mon = {m: i + 1 for i, m in enumerate(("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"))}
    out = {}
    for m, d, yy, n in re.findall(r"<td[^>]*>\s*([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\s*</td>\s*<td[^>]*>\s*([\d,]+)\s*</td>", html):
        out[f"{yy}-{mon[m]:02d}-{int(d):02d}"] = int(n.replace(",", ""))
    if not out:
        raise RuntimeError("직원 수 표를 못 찾음")
    return dict(sorted(out.items())[-12:])


def collect():
    sy = load_yaml("stocks.yaml")
    prev = (read_json(DATA / "employees.json", {}) or {}).get("stocks") or {}
    out, seen = {}, set()
    for h in [x for k in ("holdings", "watchlist", "joint") for x in (sy.get(k) or [])]:
        code = str(h["code"])
        if h.get("data_code") or code in seen:
            continue
        seen.add(code)
        mk = h.get("market", "KR").upper()
        try:
            pts = us("GOOGL" if code == "GOOG" else code) if mk == "US" else kr(code)
            out[code] = {"src": "stockanalysis.com (회사 연간 보고서)" if mk == "US" else "DART 직원 현황 (사업·반기보고서)", "pts": pts}
        except Exception as e:  # noqa: BLE001 - 못 받으면 직전 값
            REPORT.block("직원 수", f"{h['name']}: {str(e)[:60]}")
            if code in prev:
                out[code] = {**prev[code], "stale": True}
        print(f"  {h['name']}: {len((out.get(code) or {}).get('pts') or {})}개")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "stocks": out}


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        rows = [{"fo_bbm": "DX", "sexdstn": "남", "sm": "1,000"}, {"fo_bbm": "DX", "sexdstn": "여", "sm": "500"},
                {"fo_bbm": "합계", "sexdstn": "남", "sm": "1,200"}, {"fo_bbm": "합계", "sexdstn": "여", "sm": "600"}]
        assert kr_total(rows) == 1800 and kr_total(rows[:2]) == 1500
        assert kr_total([{"fo_bbm": "전체", "sexdstn": "합계", "sm": "90"}, {"fo_bbm": "전체", "sexdstn": "남", "sm": "50"}]) == 90
        print("ok")
    else:
        write_json(DATA / "employees.json", collect())
