"""📑 리포트 탭: 보유·관심·공동 종목의 증권사 리포트.
한국 = 한경 컨센서스 공개 목록 (날짜·제목·목표주가·투자의견·애널리스트·증권사·PDF 링크),
미국 = 야후 증권사 의견·목표주가 변경 기록 (street.ratings).
근거·EPS·PER 변화 요약은 config/reports.yaml 에 적는다 (원문은 링크로만, 복사 안 함)."""
import re
import sys
import time
from datetime import timedelta
from html import unescape

from common import CACHE, HTTP, REPORT, load_yaml, now_kst, read_json, write_json

HK = "https://consensus.hankyung.com"
KEEP = 30  # 종목당 최근 리포트 수
DAYS = 214  # 오늘 기준 7개월 전까지 발행된 리포트 (사용자 요청 2026-11-01)


def _num(s):
    s = re.sub(r"[^\d.]", "", s or "")
    return float(s) if s else None


def parse_hk(html):
    """한경 컨센서스 목록 HTML → [{d, t, tp, rating, who, firm, u}] (목표가 0·빈 칸은 None)."""
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        a = re.search(r'href="(/analysis/downpdf\?report_idx=\d+)"[^>]*onmouseover[^>]*>(.*?)</a>', row, re.S)
        if not a:
            continue
        td = [unescape(re.sub(r"<[^>]+>", " ", x)).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        td += [""] * (6 - len(td))  # 0 날짜 · 1 제목 · 2 목표가 · 3 의견 · 4 작성자 · 5 증권사
        out.append({"d": td[0], "t": re.sub(r"\s+", " ", unescape(a.group(2))).strip(), "tp": _num(td[2]) or None,
                    "rating": re.sub(r"\s+", " ", td[3]), "who": td[4], "firm": td[5], "u": HK + a.group(1)})
    return out


def prev_tp(text):
    """리포트 첫 장 글자 → (직전 목표가, '유지'·'상향'·'하향'·'신규'·'') — 목록만으로는 중간 리포트가 빠져 틀릴 수 있어서 PDF 에서 직접.
    증권사마다 적는 법이 달라서 몇 가지: '직전 목표주가 1,480,000원' · '목표주가(유지): 1,300,000원' · '목표주가 1,300,000원(기존 1,600,000원)' · '(M)'."""
    t = text or ""
    m = (re.search(r"(?:직전|이전|기존|종전)\s*(?:목표\s*주?가|TP)\s*[:：]?\s*([\d,]{4,})", t)
         or re.search(r"목표\s*주?가[^\n]{0,30}?\(\s*(?:직전|이전|기존|종전)\s*[:：]?\s*([\d,]{4,})", t)
         or (re.search(r"현재\s+직전", t) and re.search(r"목표\s*주?가\s+[\d,]{4,}\s+([\d,]{4,})", t)))  # 표: 목표주가 350,000 460,000 ▼
    h = (re.search(r"목표\s*주?가\s*[(\[]\s*(유지|상향|하향|신규)", t)
         or re.search(r"목표\s*주?가[^\n]{0,25}?[\d,]{4,}\s*원\s*[(\[]?\s*(유지|상향|하향)", t)  # 600,000원(유지) · 1,800,000원 유지
         or re.search(r"목표\s*주?가는?\s*[\d,]{4,}\s*원?으로\s*(상향|하향)", t))
    how = h.group(1) if h else ("유지" if re.search(r"목표\s*주?가[^\n]{0,20}\(M\)", t) else "")
    return (float(m.group(1).replace(",", "")) if m else None), how


PDF = {}  # report_idx → 직전 목표가 (cache/reports_pdf.json, 한 번 읽은 PDF 는 다시 안 받음)


def pdf_prev(url):
    import io

    import pypdf
    r = HTTP.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=40)
    return prev_tp(pypdf.PdfReader(io.BytesIO(r.content)).pages[0].extract_text())


def kr(code, days=DAYS, budget=None):
    now = now_kst()
    r = HTTP.get(f"{HK}/analysis/list", params={"skinType": "business", "sdate": (now - timedelta(days=days)).strftime("%Y-%m-%d"),
                                                "edate": now.strftime("%Y-%m-%d"), "search_text": code, "report_type": "CO", "pagenum": 50},
                 headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.encoding = "utf-8"
    rows = [x for x in parse_hk(r.text) if f"({code})" in x["t"] or code not in x["t"]][:KEEP]
    for x in rows:  # 직전 목표가: PDF 첫 장에서 (새 리포트만 받음, 한 번에 budget 개까지)
        k = x["u"].rsplit("=", 1)[-1]
        if k not in PDF and x.get("tp") and (budget is None or budget[0] > 0):
            try:
                PDF[k] = list(pdf_prev(x["u"]))
            except Exception:  # noqa: BLE001
                PDF[k] = [None, ""]
            if budget is not None:
                budget[0] -= 1
            time.sleep(0.5)
        prev, how = (PDF.get(k) or [None, ""])[:2]
        if x.get("tp") and (prev or how == "유지"):
            x["tp_prev"] = x["tp"] if how == "유지" and not prev else prev
        elif how in ("상향", "하향"):
            x["tp_dir"] = how  # 몇 원에서 바뀌었는지는 못 찾았지만 방향은 앎
    return rows


def collect(todo):
    """todo = [(종목 설정, 묶음)] → reports.json {updated_at, stocks: [{code, name, market, group, notes, list}]}"""
    import street
    notes = load_yaml("reports.yaml") or {}
    PDF.update(read_json(CACHE / "reports_pdf.json") or {})
    budget = [150]  # 한 번 갱신에 새 PDF 150개까지 (처음엔 여러 번에 나눠 채워짐)
    out = []
    for h, g in todo:
        if h.get("data_code"):  # 우선주는 보통주 리포트와 같음
            continue
        code, mkt = str(h["code"]), h.get("market", "KR").upper()
        try:
            if mkt == "KR":
                lst = kr(code, budget=budget)
                time.sleep(1)  # 공개 페이지라 천천히
            else:
                rt = street.ratings("GOOGL" if code == "GOOG" else code, days=DAYS) or {}
                lst = [{"d": x["date"], "firm": x["firm"], "rating": x["to"] + (f" ← {x['from']}" if x["from"] and x["from"] != x["to"] else ""),
                        "act": x["action"], "tp": x["pt"], "tp_prev": x["prior"] if x["prior"] != x["pt"] else None} for x in rt.get("rows") or []][:KEEP]
        except Exception as e:  # noqa: BLE001
            REPORT.block("증권사 리포트", f"{h['name']}: {str(e)[:60]}")
            lst = []
        out.append({"code": code, "name": h["name"], "market": mkt, "group": g, "notes": notes.get(code) or [], "list": lst})
    write_json(CACHE / "reports_pdf.json", PDF)
    print(f"  리포트: {sum(len(x['list']) for x in out)}건 · 요약 {sum(len(x['notes']) for x in out)}건 · PDF 새로 {150 - budget[0]}개")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "src": "한국 = 한경 컨센서스 공개 목록 · 미국 = 야후 증권사 의견 변경 · 요약 = config/reports.yaml",
            "stocks": out}


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:  # 자체 점검: 목록 한 줄 파싱 + 같은 증권사 이전 목표가
        row = ('<tr class="first"><td class="first txt_number">2026-10-30</td><td class="text_l"><a href="/analysis/downpdf?report_idx=653517" '
               'onmouseover="x" target="_blank">삼성전자(005930) 실적은 좋지만</a><div class="layerPop"><ul><li>요약</li></ul></div></td>'
               '<td class="text_r txt_number">350,000</td><td> 매수 </td><td>김운호</td><td>IBK투자증권</td><td>x</td></tr>')
        p = parse_hk(row)
        assert p[0] == {"d": "2026-10-30", "t": "삼성전자(005930) 실적은 좋지만", "tp": 350000.0, "rating": "매수", "who": "김운호",
                        "firm": "IBK투자증권", "u": HK + "/analysis/downpdf?report_idx=653517"}, p[0]
        assert prev_tp("BUY (M)\n 목표주가 1,480,000원 (M)\n 직전 목표주가 1,480,000원\n 현재주가") == (1480000.0, "유지")
        assert prev_tp("목표주가(하향) 1,300,000원 이전 목표주가: 1,600,000원") == (1600000.0, "하향")
        assert prev_tp("Buy (유지)\n목표주가(유지): 1,300,000원\n현재 주가") == (None, "유지")
        assert prev_tp("목표주가 1,300,000원(기존 1,600,000원)") == (1600000.0, "") and prev_tp("목표주가 350,000원") == (None, "")
        assert prev_tp("목표주가 (하향) 350,000원\n현재 직전 변동\n목표주가 350,000 460,000 ▼") == (460000.0, "하향")
        assert prev_tp("목표주가(12M) 600,000원(유지)") == (None, "유지") and prev_tp("투자의견 BUY, 목표주가 1,800,000원 유지") == (None, "유지")
        print("ok")
    else:
        for x in kr(sys.argv[1] if len(sys.argv) > 1 else "005930")[:5]:
            print(x)
