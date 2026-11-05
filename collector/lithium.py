"""🪨 중국 탄산리튬 가격 매일 (사용자 11/5: "탄산리튬 가격 추이 트래킹 중요 · 매일") → site/data/lithium.json
광저우선물거래소(GFEX) 탄산리튬 선물 연속(주력 LC0) 일봉 종가, 위안/톤 — 시나 파이낸스 선물 일봉 (akshare futures_main_sina 와 같은 공개 주소).
상장(2023-07)부터 전부 다시 받으므로 쌓을 필요 없음. 못 받으면 예전 파일 그대로 둠. .github/workflows/gpe.yml 에서 하루 두 번 (중국장 마감 16:00 KST 뒤 17:20 포함)."""
import json
import sys

from common import DATA, HTTP, REPORT, now_kst, write_json

URL = "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_LC0=/InnerFuturesNewService.getDailyKLine?symbol=LC0"


def parse(txt):
    """'var _LC0=([{"d":"2023-07-21",…,"c":"215100.000",…}]);' → [[날짜, 종가]] (종가 0·빈 값은 뺌)."""
    a = json.loads(txt[txt.index("(") + 1:txt.rindex(")")])
    return [[x["d"], round(float(x["c"]))] for x in a if float(x.get("c") or 0) > 0]


def collect():
    d = parse(HTTP.get(URL, headers={"Referer": "https://finance.sina.com.cn/"}, tries=3, timeout=30).text)
    if len(d) < 200 or d[-1][0] < d[0][0]:
        raise RuntimeError(f"일봉이 이상함 ({len(d)}개)")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "unit": "위안/톤",
            "src": "광저우선물거래소 탄산리튬 선물 연속(주력) 일봉 종가 · 시나 파이낸스", "d": d}


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        s = '/*<script>*/\nvar _LC0=([{"d":"2023-07-21","o":"1","c":"215100.000"},{"d":"2023-07-24","c":"0"},{"d":"2026-11-04","c":"86460.000"}]);'
        assert parse(s) == [["2023-07-21", 215100], ["2026-11-04", 86460]], parse(s)
        print("ok")
    else:
        try:
            out = collect()
            write_json(DATA / "lithium.json", out)
            print(f"  탄산리튬 {len(out['d'])}일 · 마지막 {out['d'][-1]}")
        except Exception as e:  # noqa: BLE001 - 못 받으면 어제 숫자 그대로 (화면엔 날짜가 보임)
            REPORT.block("탄산리튬 가격", str(e)[:80])
            print("  탄산리튬 실패:", e)
