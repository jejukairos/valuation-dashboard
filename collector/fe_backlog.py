"""🔧 전공정 장비 8곳 분기 말 수주잔고 (사용자 11/20 YM리서치 그림 '수주잔고 공개하는 전공정 장비사') → site/data/fe_backlog.json
DART 정기보고서 'II. 사업의 내용 – 수주상황' 표를 읽음. 회사마다 표 모양이 셋:
  ① 보통 표: 수주총액 · 기납품액 · 수주잔고 → '합 계' 줄 맨 끝 숫자 (원익IPS·주성·에스티아이 …)
  ② 계약잔액 표: 기초 · 신규계약 · 수익인식 · 기말 → 첫 줄(당분기) 기말 (유진테크)
  ③ '기말공사계약잔액' 줄 → 첫 숫자(당분기) (케이씨텍)
쌓은 분기는 cache/fe_backlog.json (git 에 저장) · 새 분기보고서는 갱신 때마다 확인해서 한 칸씩 (DART 키는 서버에만).
  python collector/fe_backlog.py --test   (규칙 점검)"""
import re

from common import CACHE, DATA, REPORT, now_kst, read_json, write_json

FE = {"240810": "원익IPS", "036930": "주성엔지니어링", "084370": "유진테크", "095610": "테스",
      "281820": "케이씨텍", "083450": "GST", "036200": "유니셈", "039440": "에스티아이"}
HIST = CACHE / "fe_backlog.json"
SINCE = "1Q23"  # 사용자 그림처럼 23년 1분기부터
UNIT = {"원": 1e-8, "천원": 1e-5, "백만원": 1e-2, "억원": 1}  # → 억원
N = r"([\d,]+)"
SEP = r"\s*\|\s*"


def _n(s):
    return float(s.replace(",", ""))


def parse(t):
    """보고서 글자(칸은 ' | ') → 분기 말 수주잔고 (억원). 못 찾으면 None."""
    c = re.sub(r"(\|\s*)+", "| ", t)
    for m in re.finditer(r"수\s*주\s*(?:상\s*황|계약\s*잔액)", c):
        seg = c[m.start():m.start() + 5000]
        seg = seg[:seg.find("위험관리")] if "위험관리" in seg else seg
        x = re.search(r"기말공사계약잔액[^|]*(?:\|\s*\(\*\)\s*)?" + SEP + N, seg)  # ③
        v, at = x and x.group(1), x and x.start()
        if not v:  # ② 기초 | 신규계약 | 수익인식 | 기말 | 이름 | a | b | c | 기말
            x = re.search(r"기초" + SEP + r"신규\s*계약" + SEP + r"수익\s*인식" + SEP + r"기말" + SEP + r"[^|\d][^|]*" + (SEP + N) * 4, seg)
            v, at = x and x.group(4), x and x.start()
        if not v and "수주잔고" in seg:  # ① '합 계' 줄의 숫자·'-' 칸 중 맨 끝 숫자 (칸 = 앞뒤가 '|' — 바로 뒤 '5. 위험관리' 의 5 는 빼고)
            h = seg.find("수주잔고")
            x = re.search(r"합\s*계((?:" + SEP + r"(?:-|[\d,]+)(?=\s*\|))+)", seg[h:])
            nums = re.findall(r"[\d,]*\d", x.group(1)) if x else []
            if x and not nums:  # 합계 줄이 '- | - | -' 뿐이면 바로 위 품목 줄 (테스 3Q24 — 품목 하나)
                nums = re.findall(r"\|\s*([\d,]*\d)(?=\s*\|)", seg[h:h + x.start() + 1])
            v, at = nums and nums[-1], h
        u = v and re.findall(r"단위\s*:?\s*(억원|백만원|천원|원)", seg[:at])  # 그 표 바로 위 단위 (위쪽 매출 표 단위와 다를 수 있음 — 원익IPS)
        if u:
            return round(_n(v) * UNIT[u[-1]])
    return None


def qlabel(period):
    """'2026.09' → '3Q26'"""
    y, m = period.split(".")
    return f"{(int(m) - 1) // 3 + 1}Q{y[2:]}"


def qkey(q):
    return (q[-2:], q[0])


def qrange(a, b):
    """'3Q25' ~ '2Q26' → ['3Q25', '4Q25', '1Q26', '2Q26']"""
    k = lambda q: int(q[2:]) * 4 + int(q[0]) - 1  # noqa: E731
    return [f"{i % 4 + 1}Q{i // 4:02d}" for i in range(k(a), k(b) + 1)]


def collect():
    """새 분기보고서가 나온 회사만 원문을 받아 한 칸 붙임 → site/data/fe_backlog.json"""
    from orders import _last_periodic, doc_text
    H = read_json(HIST, {})
    for code, name in FE.items():
        try:
            rep = _last_periodic(code)
            p = re.search(r"\((\d{4}\.\d{2})\)", rep["report_nm"])
            q = qlabel(p.group(1)) if p else None
            if q and q not in H.get(code, {}):
                v = parse(doc_text(rep["rcept_no"]))
                if v is None:
                    raise RuntimeError(f"{q} 보고서에서 수주잔고 표를 못 읽음")
                H.setdefault(code, {})[q] = {"v": v, "rcept": rep["rcept_no"]}
                write_json(HIST, H)
        except Exception as e:  # noqa: BLE001 - 한 곳이 안 돼도 나머지는 그대로
            REPORT.block("🔧 전공정 수주잔고", f"{name}: {str(e)[:60]}")
    out = {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "src": "DART 분기·반기·사업보고서 '수주상황' (억원)", "stocks": {}}
    for code, name in FE.items():
        h = {q: r for q, r in H.get(code, {}).items() if qkey(q) >= qkey(SINCE)}
        if h:
            last = max(h, key=qkey)
            out["stocks"][code] = {"name": name, "q": [[q, h[q]["v"] if q in h else None] for q in qrange(SINCE, last)],  # 빠진 분기는 빈칸 (막대가 붙어 보이지 않게)
                                   "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={h[last]['rcept']}"}
    write_json(DATA / "fe_backlog.json", out)
    return out


def _test():
    t1 = "다. 수주상황 | (단위 : 백만원) | 품목 | 수주일자 | 납기 | 수주총액 | 기납품액 | 수주잔고 | 수량 | 금액 | 수량 | 금액 | 수량 | 금액 | 반도체/Display 장비 | 2026년 3분기 | - | - | 1,513,762 | - | 883,697 | - | 630,065 | 합 계 | - | 1,513,762 | - | 883,697 | - | 630,065 | ※ 수주상황은 | 5. 위험관리"
    t2 = "4-2. 수주상황 | (1) 당분기말 장비수주 등 계약잔액 | (단위 : 천원) | 구 분 | 기초 | 신규계약 | 수익인식 | 기말 | 반도체 전공정장비 | 95,645,534 | 376,134,813 | 266,860,284 | 204,920,063 | (2) 전기말 | 기초 | 신규계약 | 수익인식 | 기말 | 반도체 전공정장비 | 84,406,992 | 309,317,594 | 298,079,051 | 95,645,534 | 5. 위험관리"
    t3 = "다. 수주계약잔액 | (기준일 : | 2024년 12월 31일 | ) | (단위 : 천원) | 구분 | 당기 | 전기 | 기초공사계약잔액 | 40,755,952 | 40,751,987 | 수 익 | (219,283,493) | (135,482,935) | 기말공사계약잔액 | (*) | 18,268,106 | 40,755,952 | 5. 위험관리"
    t4 = "4. 매출 및 수주상황 | 가. 매출실적 | (단위 : 천원) | 합 계 | 719,159,935 | 909,795,691 | " + t1  # 위 매출 표는 천원, 수주 표는 백만원
    t5 = "3. 수주상황 | (단위 : 천원, 대 ) | 품목 | 수주총액 | 기납품액 | 수주잔고 | 수량 | 금액 | 수량 | 금액 | 수량 | 금액 | 합 계 | 4,512 | 273,771,190 | 2,781 | 171,055,139 | 1,731 | 102,716,051 | 5. "  # 유니셈 (위험관리에서 잘림)
    t6 = "다. 수주상황(별도기준) | (단위 : 억원 ) | 품목 | 수주총액 | 기납품액 | 수주잔고 | SCRUBBER | - | - | - | 3,394 | - | 2,303 | - | 1,091 | 합 계 | - | 4,203 | - | 2,897 | - | 1,306 | - 상기"  # GST
    t7 = "다. 수주상황 | (단위 : 백만원) | 품목 | 수주잔고 | 반도체 장비 등 | - | - | - | 202,310 | - | 153,475 | - | 48,835 | 합 계 | - | - | - | * 세부내역"  # 테스 3Q24
    got = [parse(t) for t in (t1, t2, t3, t4, t5, t6, t7)]
    assert got == [6301, 2049, 183, 6301, 1027, 1306, 488], got
    assert qlabel("2026.09") == "3Q26" and qlabel("2024.12") == "4Q24" and qkey("4Q24") < qkey("1Q25")
    assert qrange("3Q25", "2Q26") == ["3Q25", "4Q25", "1Q26", "2Q26"] and len(qrange("1Q23", "3Q26")) == 15
    print("ok")


if __name__ == "__main__":
    import sys
    _test() if "--test" in sys.argv else print(collect())
