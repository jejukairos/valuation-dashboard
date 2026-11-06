"""💾 D램 가격 매일 (사용자 11/6: "D램 가격 크로스체크·트래킹 — 이번에 꺾였어") → site/data/dram.json
트렌드포스(DRAMeXchange) 공개 가격 화면의 표 4개 (DRAM 현물 · DRAM 고정거래가 · 모듈 현물 · GDDR 현물) — robots.txt 가 허용하는
/price/ 화면, 로그인 없이 보이는 숫자만. 공개 화면은 마지막 세션 값만 보여 주므로 받은 날짜를 cache/dram_hist.json 에 쌓는다
(같은 날은 마지막 세션 값으로 덮어씀). .github/workflows/gpe.yml 에서 평일 하루 두 번."""
import re
import sys
from html import unescape

from common import CACHE, DATA, HTTP, REPORT, now_kst, read_json, write_json

URL = "https://www.trendforce.com/price/dram/dram_spot"
SECS = {"dram_spot": "DRAM 현물", "dram_contract": "DRAM 고정거래가", "module_spot": "모듈 현물", "gddr_spot": "GDDR 현물"}
HIST = CACHE / "dram_hist.json"
# 자동 기록 전 값 (11/2 트렌드포스 = keychart.yaml DDR5 카드 · 11/5 = 사용자가 준 스톡이지 화면, 트렌드포스 숫자와 같음)
SEED = {"DDR5 16Gb (2Gx8) 4800/5600": {"2026-11-02": 61.5, "2026-11-05": 60.667},
        "DDR4 16Gb (2Gx8) 3200": {"2026-11-02": 82.8},
        "DDR4 8Gb (1Gx8) 3200": {"2026-11-05": 46.036}}


def _num(s):
    s = re.sub(r"<[^>]+>|[▲▼—]|%", "", unescape(s)).replace(",", "").strip()
    return float(s) if re.fullmatch(r"-?\d+(\.\d+)?", s) else None


def parse(html):
    """→ {섹션 id: {"t": 이름, "date": "2026-11-06 11:00", "rows": [{"n", "mk" 만드는 회사, "avg" 평균값, "chg" 변화 %}]}}
    평균값 = 숫자 칸의 마지막 (현물: 일 고가·저가·세션 고가·저가·평균 / 고정가: 고가·저가·평균), 변화 = 첫 % 칸."""
    out = {}
    for sid, nm in SECS.items():
        m = re.search(rf'<div id="{sid}" class="price-content"(.*?)(?=<div id="\w+" class="price-content"|<!-- 相關報告|$)', html, re.S)
        if not m:
            continue
        upd = re.search(r"Last Update\s*([\d-]+ [\d:]+)", m.group(1))
        rows = []
        for tr in re.findall(r"<tr>(.*?)</tr>", m.group(1), re.S):
            tds = re.findall(r"<td([^>]*)>(.*?)</td>", tr, re.S)
            if len(tds) < 4:
                continue
            name = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", unescape(tds[0][1]))).strip()
            mk = re.search(r'title="([^"]*)"', tds[0][1])
            nums = [v for a, x in tds[1:] if "percent-cell" not in a and (v := _num(x)) is not None]
            pcs = [_num(x) for a, x in tds[1:] if "percent-cell" in a]
            if name and nums:
                rows.append({"n": name, "mk": unescape(mk.group(1)) if mk and mk.group(1) != name else "", "avg": nums[-1], "chg": pcs[0] if pcs else None})
        if rows and upd:
            out[sid] = {"t": nm, "date": upd.group(1), "rows": rows}
    return out


def collect():
    secs = parse(HTTP.get(URL, tries=3, timeout=30).text)
    if "dram_spot" not in secs or not any(r["n"].startswith("DDR5 16Gb") for r in secs["dram_spot"]["rows"]):
        raise RuntimeError("DRAM 현물 표를 못 찾음 (화면 모양이 바뀜?)")
    hist = read_json(HIST) or {}
    for sid, s in secs.items():
        for r in s["rows"]:
            hist.setdefault(sid, {}).setdefault(r["n"], {})[s["date"][:10]] = r["avg"]
    write_json(HIST, hist)
    spot = {n: {**SEED.get(n, {}), **v} for n, v in hist.get("dram_spot", {}).items()}
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "unit": "달러", "u": URL,
            "src": "트렌드포스(DRAMeXchange) 공개 가격 화면 — 세션 평균값", "secs": secs,
            "hist": {n: sorted(v.items()) for n, v in spot.items()},
            "seed": "11/2·11/5 값은 자동 기록 전 (11/2 트렌드포스 · 11/5 스톡이지 화면)"}


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        h = ('<div id="dram_spot" class="price-content" ><p>Last Update 2026-11-06 11:00 (GMT+8)</p><table><tbody><tr>'
             '<td style="width:auto"><span title="SK Hynix、Samsung">DDR5 16Gb (2Gx8) 4800/5600</span></td><td class="lcd-num-l">73.00</td>'
             '<td class="lcd-num-l">46.20</td><td class="lcd-num-l">60.167</td><td class="percent-cell"><span><span>&#9660;</span> -0.82 %</span></td>'
             '<td class="lcd-num-l desktop-only history-cell"><span><a><img></a></span></td></tr></tbody></table></div>'
             '<div id="module_spot" class="price-content" ><p>Last Update 2026-10-26 14:40 (GMT+8)</p><table><tbody><tr>'
             '<td><span title="Samsung">DDR5 RDIMM 32GB 4800/5600</span></td><td class="lcd-num-l">2,370.00</td><td class="lcd-num-l">2,165.00</td>'
             '<td class="percent-cell"><span class="rise-trend"><span>&#9650;</span> 0.70 %</span></td></tr></tbody></table></div><!-- 相關報告 -->')
        p = parse(h)
        assert p["dram_spot"] == {"t": "DRAM 현물", "date": "2026-11-06 11:00", "rows": [{"n": "DDR5 16Gb (2Gx8) 4800/5600", "mk": "SK Hynix、Samsung", "avg": 60.167, "chg": -0.82}]}, p
        assert p["module_spot"]["rows"][0]["avg"] == 2165.0 and p["module_spot"]["rows"][0]["chg"] == 0.7, p
        print("ok")
    else:
        try:
            out = collect()
            write_json(DATA / "dram.json", out)
            d5 = out["hist"].get("DDR5 16Gb (2Gx8) 4800/5600", [])
            print(f"  D램 현물 {out['secs']['dram_spot']['date']} · DDR5 16Gb {d5[-1] if d5 else '-'} · 기록 {len(d5)}일")
        except Exception as e:  # noqa: BLE001 - 못 받으면 예전 파일 그대로 (화면엔 날짜가 보임)
            REPORT.block("D램 가격", str(e)[:80])
            print("  D램 가격 실패:", e)
