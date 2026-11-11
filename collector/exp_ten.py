"""📦 수출입 탭 (사용자 2026-11-11): 텔레그램 공개 채널의 관세청 1~10일·1~20일·한 달 잠정 글 → site/data/exp_ten.json (tg.yml, 하루 여러 번).
- 교보 음식료·화장품(kyobofnbcosmetic) '⚡️YYYY년 M/1~D 라면|화장품 수출' · '⚡️YYYY년 M월 …' → 나라별 표 (전년비·전월비 = 작년·지난달 같은 기간, how same)
- 다올 박종현(alexppark) '★ YYYY.M월 1-D일 의료기기|화장품 수출데이터' → 품목별 표 (금액 = 1~D일을 한 달로 늘린 값, 작년·지난달 한 달 전체와 비교, how run)
- 한투 김명주·한화 한유정 채널은 같은 때 나온 수출 글의 제목·숫자 줄만 (교차 확인용, 원문은 링크)."""
import calendar
import re
import sys

import pandas as pd

import tg_reports
from common import DATA, now_kst, write_json

KYOBO, DAOL = "kyobofnbcosmetic", "alexppark"
# 한투 김명주 · 한화 한유정 (원화 기준) · HJS_YSK '[전력기기/음식료 수출입 통계 Update]' (표는 그림이라 코멘트 줄만, 사용자 11/11 "라면 트래킹 · 변압기·GIS 관심, 담배는 관심 없음")
CROSS = ["kmj_retailcosmetics", "hanwha_yujunghan", "HJS_YSK"]
ITEM = {"라면": "ramen", "화장품": "cosmetics", "음식료/담배": "ramen", "의료기기": "medx"}
SKIP = ("임플란트", "치과영상장비", "지혈제", "콘택트렌즈")  # 사용자 11/11 "치과·임플란트 이런 건 관심 없어"
KW = {"ramen": "라면", "cosmetics": "화장품|기초|색조|마스크팩", "medx": "톡신|필러|미용의료기기|의료기기", "power": "변압기|GIS|배전반|케이블"}  # 글이 어느 칸 얘기인지
TITLE = re.compile(r"(\d{4})년\s*(\d{1,2})(?:/1\s*~\s*(\d{1,2})|월)\s*(라면|화장품|음식료/담배)\s*수출")
ROW = re.compile(r"^>?\s*([^$>]+?)\s*\$([\d,.]+)m\s*\(yy\s*([+-]?[\d.]+)%,\s*mm\s*([+-]?[\d.]+)%\)")
WD = re.compile(r"\d+월 영업일수\s*:\s*(\d+)일\s*/\s*\d+월 영업일수\s*:\s*(\d+)일\s*/\s*작년\s*\d+월 영업일수\s*:\s*(\d+)일")
DTITLE = re.compile(r"★\s*(\d{4})\.(\d{1,2})월\s*(?:1-(\d{1,2})일|전월전체)\s*(의료기기|화장품)\s*수출데이터")
# '1. 톡신 38.0 (+21.5% / -11.5%)' · '- 미국 0.4 (…)' (11월~) 또는 '1. 톡신 42.7백만달러 (YoY +3.4%, MoM -18.0%)' · '> 미국 …' (10월까지)
DROW = re.compile(r"^(?:(\d+)\.|[->])\s*(.+?)\s+([\d,.]+)(?:백만달러)?\s*\((?:YoY\s*)?([+-]?[\d.]+)%\s*[,/]\s*(?:MoM\s*)?([+-]?[\d.]+)%\)")


TRASS = "ked_epic_ai"  # (TRASS-BF) 잠정 수출 — 반도체·전자부품·변압기·화장품·라면 성장률 + '반도체 수출' 글은 금액·D램 단가 (사용자 11/11 "엄청 빨리 올라옴")
TTITLE = re.compile(r"\(TRASS-BF\)\s*(잠정|반도체)\s*수출\s*\|\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일")
# '- 디램: +631% Y/Y, +45% M/M (*ATH*)' (잠정 수출) · '- 디램(모듈포함): 수출액 $10,186mn, Y/Y +631%, M/M +45%' (반도체 수출)
TROW = re.compile(r"^-\s*(.+?):\s*(?:수출액\s*\$([\d,.]+)mn,\s*)?(?:Y/Y\s*([+-]?[\d.]+)%|([+-]?[\d.]+)%\s*Y/Y),\s*(?:M/M\s*([+-]?[\d.]+)%|([+-]?[\d.]+)%\s*M/M)(.*)$")
TUP = re.compile(r"^-\s*(.+?)\s*수출단가는\s*\$([\d,.]+)/kg로\s*전년 대비\s*([+-]?[\d.]+)%,\s*전월 대비\s*([+-]?[\d.]+)%")
TNAME = {"디램(모듈포함)": "디램", "디램(모듈제외)": "디램 (모듈 제외)", "플래시메모리(낸드)": "낸드", "대형변압기(10,000KVA이상)": "대형변압기 (10,000kVA 이상)"}  # 키 = 빈칸 뺀 이름
TITEM = {"디램": "tech", "디램 (모듈 제외)": "tech", "낸드": "tech", "SSD": "tech", "MCP(HBM)": "tech", "반도체장비": "tech", "MLCC": "tech", "PCB": "tech",
         "대형변압기 (10,000kVA 이상)": "power", "화장품": "cosmetics", "라면": "ramen"}  # 동·휘발유·경유·가전 같은 줄은 우리 종목과 멀어서 뺌


def parse_trass(text):
    """TRASS-BF 글 → {ym, upto, p, items {칸: {줄: [금액(백만$)|단가(천$/kg)|None, 전년비, 전월비]}}, ath {칸: [사상 최고 줄]}} · 화장품·라면 줄 이름은 '전체'."""
    m = TTITLE.search(" ".join(text.strip().split("\n")[:2]))
    if not m:
        return None
    _, y, mo, d = m.groups()
    items, ath = {}, {}
    for line in text.split("\n"):
        s = line.strip()
        r, u = TROW.match(s), TUP.match(s)
        if r:
            nm = TNAME.get(r.group(1).replace(" ", ""), r.group(1).strip())
            k = TITEM.get(nm)
            if not k:
                continue
            key = "전체" if k in ("ramen", "cosmetics") else nm
            items.setdefault(k, {})[key] = [float(r.group(2).replace(",", "")) if r.group(2) else None, float(r.group(3) or r.group(4)), float(r.group(5) or r.group(6))]
            if "ATH" in r.group(7):
                ath.setdefault(k, []).append(key)
        elif u:  # 'DRAM(모듈 제외) 수출단가는 $93,578/kg' → 'D램 단가 (모듈 제외, 천$/kg)'
            g = re.match(r"(\S+?)\s*\((.+)\)$", u.group(1).strip())
            base, note = (g.group(1), g.group(2) + ", ") if g else (u.group(1).strip(), "")
            items.setdefault("tech", {})[f"{base.replace('DRAM', 'D램')} 단가 ({note}천$/kg)"] = \
                [round(float(u.group(2).replace(",", "")) / 1000, 1), float(u.group(3)), float(u.group(4))]
    if not items:
        return None
    last = calendar.monthrange(int(y), int(mo))[1]
    ym, upto, p = _ym(y, mo, None if int(d) >= last else d)
    return {"ym": ym, "upto": upto, "p": p, "items": items, "ath": ath}


def _ym(y, mo, d):
    """(ym, upto, 이름) — d 없음 = 한 달 전체 (upto = 그달 마지막 날)."""
    y, mo = int(y), int(mo)
    last = calendar.monthrange(y, mo)[1]
    return f"{y}-{mo:02d}", int(d) if d else last, f"{mo}월 1~{d}일" if d else f"{mo}월 한 달"


def parse(text):
    """교보 글 → {ym, upto, p, item, rows {나라: [금액(백만$), 전년비, 전월비]}, days} · 다른 글이면 None.
    일평균 칸은 영업일수로 다시 계산되니 안 읽음 · '음식료/담배' 글은 맨 앞 라면 칸만."""
    m = TITLE.search(" ".join(text.strip().split("\n")[:2]))
    if not m:
        return None
    y, mo, d, k = m.groups()
    want, cur, rows = "화장품" if k == "화장품" else "라면", None, {}
    for line in text.split("※", 1)[0].split("\n")[1:]:  # ※ 아래 = 영업일수 감안 일평균
        s = line.strip()
        r = ROW.match(s)
        if r and cur == want:
            rows[r.group(1).strip()] = [float(r.group(2).replace(",", "")), float(r.group(3)), float(r.group(4))]
        elif s and not r and not s.startswith(("*", ">")):
            cur = s  # 칸 이름 줄 (라면 · 소스 · 담배 …)
    w = WD.search(text)
    if "전체" not in rows:
        return None
    ym, upto, p = _ym(y, mo, d)
    return {"ym": ym, "upto": upto, "p": p, "item": ITEM[k], "rows": rows,
            **({"days": {"this": int(w.group(1)), "prev": int(w.group(2)), "ly": int(w.group(3))}} if w else {})}


def parse_daol(text):
    """다올 글 → {ym, upto, p, item, rows {품목 · 나라: [한 달로 늘린 금액(백만$), 전년비, 전월비]}} · 관심 없는 치과·임플란트 등은 뺌."""
    m = DTITLE.search(" ".join(text.strip().split("\n")[:3]))
    if not m:
        return None
    y, mo, d, k = m.groups()
    top, rows = None, {}
    for line in text.split("\n"):
        r = DROW.match(line.strip())
        if not r:
            continue
        nm = r.group(2).strip()
        if r.group(1):
            top = nm
        if top in SKIP:
            continue
        rows[nm if r.group(1) else f"{top} · {nm}"] = [float(r.group(3).replace(",", "")), float(r.group(4)), float(r.group(5))]
    if not rows:
        return None
    ym, upto, p = _ym(y, mo, d)
    return {"ym": ym, "upto": upto, "p": p, "item": ITEM[k], "rows": rows}


def cross(x):
    """다른 증권사 채널의 수출 데이터 글 → 제목 + 숫자 줄 (없으면 None)."""
    t = x["text"].strip()
    head = " ".join([s for s in t.split("\n") if s.strip()][:3])
    if "수출" not in head or not re.search(r"잠정|데이터|확정|Update|\d+\s*[~-]\s*\d+일", head):
        return None
    # 숫자 줄 + '(초고압변압기) …' 같은 코멘트 줄 · 담배 문장은 뺌 (사용자 관심 없음 — '(라면 및 담배)' 줄은 라면 문장만)
    no_tob = lambda ln: " ".join(p for p in re.split(r"(?<=\.)\s+", ln.replace("라면 및 담배", "라면")) if "담배" not in p).strip()  # noqa: E731
    lines = [no_tob(ln)[:220] for ln in t.split("\n")[1:] if re.search(r"\d", ln) and re.search(r"%|억|\$|달러", ln) or ln.strip().startswith("(")]
    lines = [ln for ln in lines if ln][:14]
    return {"d": x["d"], "hm": x["hm"], "u": f"https://t.me/{x['id']}", "t": " · ".join([s.strip() for s in t.split("\n") if s.strip()][:2])[:160],
            "items": [k for k, kw in KW.items() if re.search(kw, t)], "lines": lines}


def collect():
    now, fails = now_kst(), []
    cut, ccut = (now - pd.Timedelta(days=400)).strftime("%Y-%m-%d"), (now - pd.Timedelta(days=60)).strftime("%Y-%m-%d")
    tg_reports.PAGES = 8  # 1년 치 10일 글까지 (쪽당 약 20글)
    ten = {}
    for ch, qs, f, how, who in ((KYOBO, ("영업일수", "라면 수출", "화장품 수출"), parse, "same", "교보 음식료·화장품"),
                                (DAOL, ("수출데이터",), parse_daol, "run", "다올 의료기기·화장품"),
                                (TRASS, ("TRASS",), parse_trass, "same", "TRASS-BF (ked_epic_ai)")):
        for q in qs:
            try:
                for x in sorted(tg_reports.search(ch, q, cut), key=lambda x: x["id"]):  # 같은 날 두 글(성장률·반도체 금액)은 차례로 합침
                    r = f(x["text"])
                    if not r:
                        continue
                    e = ten.setdefault((who, r["ym"], r["upto"]), {"p": r["p"], "ym": r["ym"], "upto": r["upto"], "how": how, "who": who,
                                                                   "src": f"{who} 텔레그램 {x['d']} (자동)", "u": f"https://t.me/{x['id']}"})
                    for k, rows in (r["items"] if "items" in r else {r["item"]: r["rows"]}).items():
                        old = e.setdefault(k, {})
                        for nm, v in rows.items():  # 금액 있는 줄이 % 만 있는 줄보다 우선
                            if nm not in old or v[0] is not None:
                                old[nm] = v
                    for k, names in r.get("ath", {}).items():
                        e.setdefault("ath", {}).setdefault(k, [])
                        e["ath"][k] = sorted(set(e["ath"][k]) | set(names))
                    if r.get("days"):
                        e["days"] = r["days"]
            except Exception as e:  # noqa: BLE001 - 한 채널이 막혀도 나머지는 모은다
                fails.append(f"{ch} {q}: {str(e)[:60]}")
    posts = {}
    for ch in CROSS:
        try:
            for x in tg_reports.search(ch, "수출", ccut):
                c = cross(x)
                if c:
                    posts[x["id"]] = {"ch": ch, **c}
        except Exception as e:  # noqa: BLE001
            fails.append(f"{ch}: {str(e)[:60]}")
    return {"updated_at": now.strftime("%Y-%m-%d %H:%M"), "ten": sorted(ten.values(), key=lambda e: (e["ym"], e["upto"], e["how"]), reverse=True),
            "posts": sorted(posts.values(), key=lambda p: p["d"] + p["hm"], reverse=True)[:40], "fails": fails}


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:  # 자체 점검: 사용자가 11/11 보낸 교보 글 그대로
        t = ("⚡️2026년 11/1~10 라면 수출\n\n라면 \n전체 $50.2m (yy 31%, mm 14%)\n> 중국 $12.9m (yy -1%, mm 3%)\n> 미국 $11.3m (yy 73%, mm 85%)\n\n"
             "※영업일수 감안한 일 평균 수출 \n라면 \n전체 $7.2m (yy 12%, mm -19%)\n\n* 11월 영업일수: 7일 / 10월 영업일수: 5일 / 작년 11월 영업일수: 6일")
        r = parse(t)
        assert r == {"ym": "2026-11", "upto": 10, "p": "11월 1~10일", "item": "ramen", "days": {"this": 7, "prev": 5, "ly": 6},
                     "rows": {"전체": [50.2, 31, 14], "중국": [12.9, -1, 3], "미국": [11.3, 73, 85]}}, r
        r = parse("⚡️2026년 10/1~20 화장품 수출\n\n화장품\n> 전체 $660.7m (yy 80%, mm -23%)\n> 동남아 5국 $1,020.5m (yy -5%, mm 0%)")
        assert r["item"] == "cosmetics" and r["rows"]["동남아 5국"] == [1020.5, -5, 0] and "days" not in r, r
        r = parse("⚡️2026년 10월 음식료/담배 수출\n\n라면\n> 전체 $173.0m (yy 33%, mm 2%)\n> 미국 $31.8m (yy 64%, mm 20%)\n\n소스\n> 전체 $40.0m (yy 43%, mm 4%)")
        assert (r["p"], r["upto"], r["item"], r["rows"]) == ("10월 한 달", 31, "ramen", {"전체": [173.0, 33, 2], "미국": [31.8, 64, 20]}), r
        assert parse("음식료/화장품 데일리 뉴스\nK라면 수출 4.2배") is None
        r = parse_daol("[다올 의료기기/화장품 박종현]\n★ 2026.11월 1-10일 의료기기 수출데이터\n(백만달러, YoY / MoM)\n\n1. 톡신 38.0 (+21.5% / -11.5%)\n- 미국 0.4 (-33.0% / -52.7%)\n\n"
                       "3. 임플란트 59.3 (-7.0% / -15.8%)\n- 중국 16.6 (-17.4% / -25.0%)\n\n5. 필러 351.8 (+40.1% / -17.6%)")
        assert (r["p"], r["item"], r["rows"]) == ("11월 1~10일", "medx", {"톡신": [38.0, 21.5, -11.5], "톡신 · 미국": [0.4, -33.0, -52.7], "필러": [351.8, 40.1, -17.6]}), r
        r = parse_daol("[다올]\n★ 2026.9월 전월전체 화장품 수출데이터\n\n1. 기초 화장품 575.9백만달러 (YoY +24.4%, MoM +8.7%)\n > 중국 1,033.2백만달러 (YoY -1.0%, MoM +2.0%)")
        assert (r["p"], r["item"], r["rows"]) == ("9월 한 달", "cosmetics", {"기초 화장품": [575.9, 24.4, 8.7], "기초 화장품 · 중국": [1033.2, -1.0, 2.0]}), r
        r = parse_trass("(TRASS-BF) 잠정 수출 | 2026년 11월 10일\n※ 매월 1-10일까지의 수치 기준\n- 디램: +631% Y/Y, +45% M/M (*ATH*)\n- 동: +113% Y/Y, +59% M/M\n"
                        "- 대형변압기(10,000KVA 이상): +193% Y/Y, +28% M/M\n- 화장품: +68% Y/Y, +24% M/M")
        assert (r["p"], r["items"], r["ath"]) == ("11월 1~10일", {"tech": {"디램": [None, 631, 45]}, "power": {"대형변압기 (10,000kVA 이상)": [None, 193, 28]},
                                                                 "cosmetics": {"전체": [None, 68, 24]}}, {"tech": ["디램"]}), r
        r = parse_trass("(TRASS-BF) 반도체 수출 | 2026년 8월 31일\n[수출금액]\n- 디램(모듈포함): 수출액 $23,569mn, Y/Y +412%, M/M +11%\n"
                        "- 디램(모듈제외): 수출액 $15,733mn, Y/Y +501%, M/M +16%\n- DRAM(모듈 제외)수출단가는 $88,523/kg로 전년 대비 +401%, 전월 대비 -4%")
        assert (r["p"], r["items"]["tech"]) == ("8월 한 달", {"디램": [23569, 412, 11], "디램 (모듈 제외)": [15733, 501, 16], "D램 단가 (모듈 제외, 천$/kg)": [88.5, 401, -4]}), r
        c = cross({"d": "2026-10-12", "hm": "10:28", "id": "hanwha_yujunghan/5848",
                   "text": "[한화투자증권 한유정] 음식료/화장품 10월 1~10일 수출 잠정치 발표\n\n라면: 603억(74.7% yoy, -32.3% mom)\n뉴스 링크"})
        assert c["items"] == ["ramen", "cosmetics"] and c["lines"] == ["라면: 603억(74.7% yoy, -32.3% mom)"], c
        assert cross({"d": "2026-10-14", "hm": "08:51", "id": "a/1", "text": "[다올] 10/14 화장품 뉴스\n수출 늘어"}) is None
        c = cross({"d": "2026-10-12", "hm": "09:00", "id": "HJS_YSK/866", "text": "[전력기기/음식료 수출입 통계 Update]\n\n※ 10/1~10/10 잠정치\n\n*Comment\n"
                   "(초고압변압기) 미국향 수출 호조세 · GIS YoY 상승률에 주목\n(라면 및 담배) 라면 YoY 수출 지속. 담배는 미국향 MoM 상승\n(담배) 인도네시아 MoM (+) 전환"})
        assert c["items"] == ["ramen", "power"] and c["lines"] == ["(초고압변압기) 미국향 수출 호조세 · GIS YoY 상승률에 주목", "(라면) 라면 YoY 수출 지속."], c
        print("ok")
    else:
        d = collect()
        write_json(DATA / "exp_ten.json", d)
        print(f"■ 수출 10일 잠정: {len(d['ten'])}개 · 교차 확인 글 {len(d['posts'])}개 · 실패 {len(d['fails'])}", *d["fails"], sep="\n")
