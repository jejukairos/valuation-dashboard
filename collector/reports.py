"""📑 리포트 탭: 보유·관심·공동 종목의 증권사 리포트.
한국 = 한경 컨센서스 공개 목록 (날짜·제목·목표주가·투자의견·애널리스트·증권사·PDF 링크),
미국 = 야후 증권사 의견·목표주가 변경 기록 (street.ratings).
근거·EPS·PER 변화 요약은 config/reports.yaml 에 적는다 (원문은 링크로만, 복사 안 함)."""
import re
import sys
import time
from datetime import timedelta
from html import unescape

from common import CACHE, DATA, HTTP, REPORT, load_yaml, now_kst, read_json, write_json

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


def val_basis(text):
    """리포트 첫 장 → 목표주가 계산 방식 한 줄 (우리 말로 다시 씀): '12개월 선행 EPS × PER 15배' · 'SOTP' 등. 못 찾으면 ''."""
    t = re.sub(r"\s+", " ", text or "")
    pat = re.compile(r"(12\s*개월\s*(?:선행|forward|fwd)|12M\s*(?:Fwd|Forward|F)?|12MF|NTM|(?:20)?\d{2}\s*(?:년|E|F)\s*(?:예상|추정)?)?\s*"
                     r"(EPS|BPS|EBITDA|지배주주\s*순이익|순이익|주당순이익|주당순자산)[^.。]{0,60}?(?:목표|Target|타깃|적정)?\s*"
                     r"(P/?E|P/?B|PER|PBR|EV/EBITDA)\s*(?:ratio|멀티플|배수)?\s*(?:을|를|에|는|은)?\s*[×xX]?\s*(\d{1,3}(?:\.\d{1,2})?)", re.I)
    for m in pat.finditer(t):  # '지금 주가는 PER 12배' 같은 현재 값은 빼고, 목표가에 '적용·Target·산정' 한 것만
        if not re.search(r"적용|Target|타깃|목표\s*(?:P|배수|멀티플)|산정|산출", t[max(0, m.start() - 80):m.end() + 40], re.I) or not float(m.group(4)):
            continue
        when = re.sub(r"12\s*개월\s*(?:선행|forward|fwd)|12M\s*(?:Fwd|Forward|F)?|12MF|NTM", "12개월 선행", re.sub(r"\s+", " ", m.group(1) or "").strip(), flags=re.I)
        when = re.sub(r"(\d)\s*(년|E|F)\s*", r"\1\2 ", when).strip()
        what = {"주당순이익": "EPS", "주당순자산": "BPS", "지배주주순이익": "순이익"}.get(re.sub(r"\s+", "", m.group(2)), m.group(2).upper())
        mul = {"PE": "PER", "P/E": "PER", "PB": "PBR", "P/B": "PBR"}.get(m.group(3).upper(), m.group(3).upper())
        return f"{(when + ' ') if when else ''}{what} × {mul} {m.group(4)}배"
    m = re.search(r"(?:목표|Target|타깃)\s*(P/?E|PER|P/?B|PBR|EV/EBITDA)\s*(?:ratio|멀티플|배수)?\s*(?:을|를|는|은|로|:)?\s*[×xX]?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:배|x|X)", t, re.I)
    if m and float(m.group(2)):  # 'Target PER 13배' — 무엇(EPS 몇 년)에 곱했는지는 못 찾음
        return f"목표 {({'PE': 'PER', 'P/E': 'PER', 'PB': 'PBR', 'P/B': 'PBR'}.get(m.group(1).upper(), m.group(1).upper()))} {m.group(2)}배"
    m = re.search(r"SOTP|Sum[- ]of[- ]the[- ]parts|DCF|RIM|잔여이익|(?:영업|사업)\s*가치\s*\+", t, re.I)
    if m and re.search(r"목표\s*주가|적정\s*주가|Target", t[max(0, m.start() - 150):m.end() + 150]):
        return "DCF(미래 현금 할인) 방식" if m.group(0).upper() == "DCF" else "RIM(잔여이익) 방식" if m.group(0) in ("RIM", "잔여이익") else "SOTP(사업별 가치 합산) 방식"
    return ""


PDF = {}  # report_idx → [직전 목표가, 유지·상향·하향, 목표가 계산 방식] (cache/reports_pdf.json, 한 번 읽은 PDF 는 다시 안 받음)


def pdf_prev(url):
    import io

    import pypdf
    r = HTTP.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=40)
    pages = pypdf.PdfReader(io.BytesIO(r.content)).pages
    t0 = pages[0].extract_text()
    t1 = t0 + "\n" + "\n".join(p.extract_text() for p in pages[1:4])  # 계산 방식은 2~4장(밸류에이션 표·본문)에 있는 경우가 많음
    return [*prev_tp(t0), val_basis(t1)]


RATE = {"매수": "BUY", "BUY": "BUY", "STRONGBUY": "BUY+", "적극매수": "BUY+", "OUTPERFORM": "BUY", "OVERWEIGHT": "BUY", "비중확대": "BUY",
        "중립": "HOLD", "HOLD": "HOLD", "NEUTRAL": "HOLD", "MARKETPERFORM": "HOLD", "TRADINGBUY": "TBUY", "단기매수": "TBUY",
        "매도": "SELL", "SELL": "SELL", "REDUCE": "SELL", "UNDERPERFORM": "SELL", "비중축소": "SELL", "NOTRATED": "NR", "NR": "NR", "투자의견없음": "NR", "N/A": "NR", "없음": "NR"}
rate_key = lambda s: RATE.get(re.sub(r"[\s\-_()]", "", (s or "").upper()), re.sub(r"\s", "", (s or "").upper()))


def kr(code, days=DAYS, budget=None):
    now = now_kst()
    r = HTTP.get(f"{HK}/analysis/list", params={"skinType": "business", "sdate": (now - timedelta(days=days)).strftime("%Y-%m-%d"),
                                                "edate": now.strftime("%Y-%m-%d"), "search_text": code, "report_type": "CO", "pagenum": 50},
                 headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.encoding = "utf-8"
    rows = [x for x in parse_hk(r.text) if f"({code})" in x["t"] or code not in x["t"]][:KEEP]
    recent = (now - timedelta(days=3)).strftime("%Y-%m-%d")
    for x in rows:  # 직전 목표가·계산 방식: PDF 첫 두 장에서 (새 리포트만 받음, 한 번에 budget 개까지 · 계산 방식이 없던 옛 기록은 최근 3일 것만 다시)
        k = x["u"].rsplit("=", 1)[-1]
        stale = k in PDF and len(PDF[k]) < 3 and x["d"] >= recent
        if (k not in PDF or stale) and x.get("tp") and (budget is None or budget[0] > 0):
            try:
                PDF[k] = list(pdf_prev(x["u"]))
            except Exception:  # noqa: BLE001
                PDF[k] = [None, "", ""]
            if budget is not None:
                budget[0] -= 1
            time.sleep(0.5)
        prev, how = (PDF.get(k) or [None, ""])[:2]
        if len(PDF.get(k) or []) > 2 and PDF[k][2]:
            x["val"] = PDF[k][2]
        if x.get("tp") and (prev or how == "유지"):
            x["tp_prev"] = x["tp"] if how == "유지" and not prev else prev
        elif how in ("상향", "하향"):
            x["tp_dir"] = how  # 몇 원에서 바뀌었는지는 못 찾았지만 방향은 앎
    for i, x in enumerate(rows):  # 투자의견이 바뀌었는지: 같은 증권사의 바로 전 리포트와 비교 (Buy → Hold 등)
        p = next((y for y in rows[i + 1:] if y["firm"] == x["firm"] and rate_key(y.get("rating")) not in ("", "NR")), None)
        if p and rate_key(x.get("rating")) not in ("", "NR") and rate_key(p["rating"]) != rate_key(x["rating"]):  # '투자의견없음'(업종 글 등)은 바뀜으로 안 셈
            x["rating_prev"] = p["rating"]
    return rows


# 🏭 산업 리포트 → 우리 업종(stocks.yaml industry) 짝짓기: 제목 낱말 + 한경 업종 번호 중 뜻이 분명한 것만
# shortcut: 제목 낱말로만 짝지음 — 제목에 업종 말이 없으면 놓치거나 엉뚱하게 붙을 수 있음, 틀린 게 자주 보이면 낱말을 고칠 것
# (인터넷의 '게임'은 '치킨 게임'·'본게임'까지 걸려서 11/5 뺌)
IND_RE = {"화장품": r"화장품|뷰티|Beauty|코스메틱|ODM", "반도체": r"반도체|메모리|HBM|D램|DRAM|낸드|NAND|파운드리|Semi|후공정",
          "인터넷": r"인터넷|플랫폼|웹툰|포털|네이버|NAVER|커머스", "조선": r"조선|LNG선|선박|해운", "조선기자재": r"조선|LNG선|선박|기자재",
          "자동차": r"자동차|완성차|Auto|전기차|판매량", "자동차부품": r"자동차|완성차|Auto|전기차|부품", "방산": r"방산|방위|국방|Defen[cs]e",
          "방산·철도": r"방산|방위|국방|철도", "건설·원전": r"건설|원전|원자력|SMR|주택|해외수주", "원자력·전력기기": r"원전|원자력|SMR|전력기기|변압기|전선|케이블",
          "전력": r"전력|유틸리티|한전|발전", "ESS·부품": r"ESS|배터리|2차전지|이차전지|양극재|LFP", "기판": r"기판|PCB|MLCC|FC-?BGA|CCL",
          "기판·전자부품": r"기판|PCB|MLCC|FC-?BGA|CCL|전자부품", "OLED 소재": r"OLED|디스플레이", "엔터": r"엔터|K-?pop|케이팝|음반|콘서트|아이돌",
          "유통": r"유통|리테일|Retail|백화점|편의점|면세", "음식료": r"음식료|F&B|식품|라면|음료|주류", "의료기기": r"의료기기|미용기기|에스테틱|메디컬",
          "의류": r"의류|패션|OEM|아웃도어|섬유", "증권": r"증권|브로커리지", "지주": r"지주", "항공": r"항공|여객|LCC",
          "2차전지": r"2차전지|이차전지|배터리|Battery|양극재|음극재|리튬|전고체|셀\s*업체", "정유·2차전지": r"정유|정제마진|석유|Refin|2차전지|이차전지|배터리"}
IND_CODE = {"152": ["조선", "조선기자재"]}  # 029(항공·스페이스X 섞임)·153(철강·코인 섞임)은 뺌 (11/5, 6개월치 보고)
SKIP_RE = r"\bDaily\b|데일리|Coverage at a Gla"  # 매일 나오는 짧은 글·담당 종목 표는 6개월 목록에서 뺌 (중복)
# ⭐ 인뎁스 (사용자 11/5 '인뎁스 리포트면 더 중요 별표시'): PDF 가 20쪽 이상 — 쪽수를 아직 못 셌으면 제목(연간전망·Outlook·심층 등)으로
DEEP_PAGES = 20
DEEP_RE = r"전망|Outlook|심층|In-?depth|Deep[\s-]?dive|딥\s?다이브|인뎁스|Initiation|산업\s*분석|Big\s*Picture"
PAGES = {}  # report_idx → 쪽수 (cache/ind_pages.json, 한 번 센 PDF 는 다시 안 받음 · 못 읽으면 0)


def pdf_pages(url):
    import io

    import pypdf
    r = HTTP.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)  # 한경은 크기만 알려 주지 않아서 통째로 받아 셈
    return len(pypdf.PdfReader(io.BytesIO(r.content)).pages)


def industry(days=183, budget=None):
    """한경 컨센서스 산업 리포트 (최근 days 일, 사용자 11/5 '6개월치') → [{d, t, firm, who, u, inds, p 쪽수, deep}] (inds = 짝지은 우리 업종, 없으면 뺌)."""
    now = now_kst()
    r = HTTP.get(f"{HK}/analysis/list", params={"skinType": "industry", "sdate": (now - timedelta(days=days)).strftime("%Y-%m-%d"),
                                                "edate": now.strftime("%Y-%m-%d"), "report_type": "IN", "pagenum": 5000},  # 6개월 ≈ 1,100개를 한 번에
                 headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.encoding = "utf-8"
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", r.text, re.S):
        a = re.search(r'href="(/analysis/downpdf\?report_idx=\d+)"[^>]*onmouseover[^>]*>(.*?)</a>', row, re.S)
        if not a:
            continue
        td = [unescape(re.sub(r"<[^>]+>", " ", x)).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)] + [""] * 5
        t, c = re.sub(r"\s+", " ", unescape(a.group(2))).strip(), re.search(r"industry_code=(\w+)", row)
        inds = sorted({k for k, rx in IND_RE.items() if re.search(rx, t, re.I)} | set(IND_CODE.get(c.group(1) if c else "", [])))
        if not inds or re.search(SKIP_RE, t, re.I):
            continue
        x, k = {"d": td[0], "t": t, "who": td[3], "firm": td[4], "u": HK + a.group(1), "inds": inds}, a.group(1).rsplit("=", 1)[-1]
        if k not in PAGES and budget and budget[0] > 0:  # 최신 것부터 한 번에 budget 개까지 쪽수 세기
            try:
                PAGES[k] = pdf_pages(x["u"])
            except Exception:  # noqa: BLE001
                PAGES[k] = 0
            budget[0] -= 1
            time.sleep(0.5)
        if PAGES.get(k):
            x["p"] = PAGES[k]
        if (x.get("p") or 0) >= DEEP_PAGES or (not x.get("p") and re.search(DEEP_RE, t, re.I)):
            x["deep"] = 1
        out.append(x)
    return out


def all_co(days=183):
    """🔎 리포트 탭 검색용: 한경 컨센서스 6개월 기업 리포트 전부 (우리 종목 아니어도) → 짧은 줄 [날짜, 코드, 이름, 제목, 목표가, 의견, 증권사, report_idx]."""
    now = now_kst()
    r = HTTP.get(f"{HK}/analysis/list", params={"skinType": "business", "sdate": (now - timedelta(days=days)).strftime("%Y-%m-%d"),
                                                "edate": now.strftime("%Y-%m-%d"), "report_type": "CO", "pagenum": 20000},
                 headers={"User-Agent": "Mozilla/5.0"}, timeout=120)
    r.encoding = "utf-8"
    rows = []
    for x in parse_hk(r.text):
        m = re.match(r"\s*(.+?)\s*\(([0-9A-Z]{6})\)\s*(.*)", x["t"])  # '삼성전자(005930) 제목' · 새 코드는 '0011T0' 처럼 글자 섞임
        if m:
            rows.append([x["d"], m.group(2), m.group(1), m.group(3), x["tp"], x["rating"], x["firm"], x["u"].rsplit("=", 1)[-1]])
    return {"updated_at": now.strftime("%Y-%m-%d %H:%M"), "src": "한경 컨센서스 공개 목록 (최근 6개월 기업 리포트)", "rows": rows}


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
    PAGES.update(read_json(CACHE / "ind_pages.json") or {})
    pb = [80]  # 산업 리포트 쪽수 세기: 한 번에 PDF 80개까지 (처음 6개월치는 여러 번에 나눠 채워짐)
    try:
        ind = industry(budget=pb)
    except Exception as e:  # noqa: BLE001
        REPORT.block("증권사 리포트", f"산업 리포트: {str(e)[:60]}")
        ind = []
    write_json(CACHE / "ind_pages.json", PAGES)
    try:
        write_json(DATA / "rep_all.json", all_co())
    except Exception as e:  # noqa: BLE001  — 검색 목록만 지난 것 그대로
        REPORT.block("증권사 리포트", f"검색용 전체 목록: {str(e)[:60]}")
    print(f"  리포트: {sum(len(x['list']) for x in out)}건 · 요약 {sum(len(x['notes']) for x in out)}건 · PDF 새로 {150 - budget[0]}개 · 산업 {len(ind)}건 (⭐ {sum(1 for x in ind if x.get('deep'))} · 쪽수 새로 {80 - pb[0]}개)")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "src": "한국 = 한경 컨센서스 공개 목록 · 미국 = 야후 증권사 의견 변경 · 요약 = config/reports.yaml",
            "stocks": out, "industry": ind}


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
        assert val_basis("목표주가는 12개월 선행 EPS에 목표 PER 15배를 적용해 산출") == "12개월 선행 EPS × PER 15배"
        assert val_basis("2027년 예상 BPS 에 Target P/B 2.1x 적용") == "2027년 예상 BPS × PBR 2.1배", val_basis("2027년 예상 BPS 에 Target P/B 2.1x 적용")
        assert val_basis("27E EPS에 Target PER 12.0배") == "27E EPS × PER 12.0배", val_basis("27E EPS에 Target PER 12.0배")
        assert val_basis("목표주가는 SOTP 방식으로 산정") == "SOTP(사업별 가치 합산) 방식" and val_basis("실적이 좋다") == ""
        assert val_basis("목표주가는 12M Fwd EPS 에 PER 20.4배를 적용해 산출했다") == "12개월 선행 EPS × PER 20.4배"
        assert val_basis("목표주가 산정 Table 12M Fwd EPS 20,258 Target P/E ratio × 7.7 Target Price 155,000") == "12개월 선행 EPS × PER 7.7배"
        assert val_basis("2027년 예상 실적 기준 현 주가는 P/E 11.7배 수준") == ""  # 지금 값 (목표가 계산 아님)
        assert val_basis("Target PER 13배를 적용") == "목표 PER 13배" and val_basis("Target PER 할인율을 10%에서 20%로") == ""
        assert val_basis("Valuation 지표 EPS 24,413 BPS 141,812 EV/EBITDA 3.1") == ""  # 값 표
        assert rate_key("Buy") == rate_key("매수") == rate_key("BUY ") and rate_key("Hold") != rate_key("Buy") and rate_key("Trading Buy") == "TBUY"
        assert rate_key("투자의견없음") == rate_key("Not Rated") == rate_key("N/A") == "NR" and rate_key(None) == ""
        assert re.search(DEEP_RE, "[2027년 연간전망] 2027, 왜 다시 2차전지인가") and not re.search(DEEP_RE, "[인터넷/게임] IBKS Daily")
        assert re.search(IND_RE["2차전지"], "2027, 왜 다시 2차전지인가") and not re.search(IND_RE["2차전지"], "은행 중심 방어력")
        assert {"조선", "조선기자재", "자동차", "인터넷"} <= set(IND_RE) and not re.search(IND_RE["인터넷"], "CLARITY Act = 치킨 게임")
        print("ok")
    elif sys.argv[1:] == ["--all"]:  # 리포트만 따로 갱신 (tg.yml 저녁 매시간) — 본 갱신(main.py)과 같은 종목 목록
        from common import DATA
        sy, todo, seen = load_yaml("stocks.yaml"), [], set()
        for key, g in (("holdings", "보유"), ("watchlist", "관심"), ("joint", "공동")):
            for h in sy.get(key) or []:
                if str(h["code"]) not in seen:
                    seen.add(str(h["code"]))
                    todo.append((h, g))
        write_json(DATA / "reports.json", collect(todo))
    else:
        for x in kr(sys.argv[1] if len(sys.argv) > 1 else "005930")[:5]:
            print(x)
