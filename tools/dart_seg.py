"""🧱 한국 정기보고서 원문의 '매출실적' 표 → 분기 제품군별·지역별 매출 (2015년~) → cache/dart_seg.json (사용자 11/5 "분기보고서 다 받아줘").
원문은 cache/dart_raw/{코드}/{기간}_{접수번호}.zip (tools/dart_docs.py 가 서버에서 받은 것).
- 표: '사업의 내용' 안 매출 칸의 표들 — 기간 머리('제66기 반기' 등)의 첫 숫자 칸 = 올해 누적.
  품목 칸이 가장 다양한 열을 제품군으로, 수출·내수 칸 또는 지역 이름 표를 지역으로.
- 분기 = 누적 차이 (1분기 그대로 · 2분기 = 반기 − 1분기 · 3분기 = 3분기 누적 − 반기 · 4분기 = 연간 − 3분기 누적).
- 맞춰 보기: 그 분기 제품군 합이 DART 분기 매출(site/data/stocks/{코드}.json longq)과 12% 넘게 다르면 그 분기는 버림
  (부문끼리 사고판 매출이 들어 있다고 표에 쓰인 회사는 25% 까지).
  python tools/dart_seg.py [코드 …]"""
import html
import json
import re
import sys
import zipfile
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "cache" / "dart_raw"
OUT = ROOT / "cache" / "dart_seg.json"
TOT = re.compile(r"^(합\s*계|총\s*계|소\s*계|계|합계\s*\(.*\)|매출\s*합계|총\s*매출액?)$")
DROP = re.compile(r"에누리|내부\s*거래|내부매출|연결\s*조정|조정|제거|차감|할인|consolidat", re.I)
EXP, DOM = re.compile(r"^(수\s*출|해\s*외|수출\s*\(.*\))$"), re.compile(r"^(내\s*수|국\s*내|내수\s*\(.*\))$")
GEO = re.compile(r"국내|내수|수출|해외|미주|미국|북미|북중미|KUS|남미|중남미|유럽|구주|중국|아시아|일본|중동|아프리카|오세아니아|인도|베트남|대만|기타\s*지역|CIS|러시아|캐나다|호주|동남아")
PER = re.compile(r"제\s*\d+\s*기|당\s*(분|반)?기|20\d\d\s*년")
TYPE = re.compile(r"^(제품|상품|용역|제\s*ㆍ?\s*상품.*|제품\s*및\s*상품|상품\s*및\s*제품|기타매출|기타\s*수익|매출유형|서비스)$")


@lru_cache(maxsize=60)  # 매출실적 표·영업부문 주석 두 번 읽을 때 다시 안 풀게
def doc_text(path):
    z = zipfile.ZipFile(path)
    b = z.read(max(z.namelist(), key=lambda x: z.getinfo(x).file_size))
    for enc in ("utf-8", "cp949"):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            pass
    return b.decode("utf-8", "ignore")


def clean(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>|&cr;", " ", s))).strip()


def sections(t):
    out, title = [], ""
    for p in re.split(r"(<TITLE\b[^>]*>.*?</TITLE>)", t, flags=re.S):
        m = re.match(r"<TITLE\b[^>]*>(.*?)</TITLE>", p, re.S)
        if m:
            title = clean(m.group(1))
        else:
            out.append((title, p))
    return out


def grid(tbl):
    """표 → 2차원 칸 (ROWSPAN·COLSPAN 으로 합친 칸은 같은 글자로 채움)."""
    rows, hold = [], {}  # hold[(r, c)] = 위 칸에서 내려온 글자
    for r, tr in enumerate(re.findall(r"<TR\b.*?</TR>", tbl, re.S)):
        row, c = [], 0
        for tag, attr, body in re.findall(r"<(TD|TE|TU|TH)\b([^>]*)>(.*?)</\1>", tr, re.S):
            while (r, c) in hold:
                row.append(hold.pop((r, c)))
                c += 1
            rs = int((re.search(r'ROWSPAN="(\d+)"', attr, re.I) or [0, 1])[1])
            cs = int((re.search(r'COLSPAN="(\d+)"', attr, re.I) or [0, 1])[1])
            v = clean(body)
            for k in range(cs):
                row.append(v)
                for d in range(1, rs):
                    hold[(r + d, c + k)] = v
            c += cs
        while (r, c) in hold:
            row.append(hold.pop((r, c)))
            c += 1
        rows.append(row)
    return rows


def num(s):
    """'1,183,178' · '△271,085' · '(1,234)' · '10,205 ( 4.0%)' · '-' → 숫자 (못 읽으면 None)."""
    s = (s or "").strip()
    if s in ("-", "－", "0"):
        return 0.0
    m = re.match(r"^(△|\(|-|▲)?\s*([\d,]+(?:\.\d+)?)\s*\)?", s)
    if not m or not re.search(r"\d", m.group(2)):
        return None
    v = float(m.group(2).replace(",", ""))
    return -v if m.group(1) in ("△", "(", "-") else v


def unit(s):
    m = re.search(r"단위\s*[:：]?\s*(백만원|천원|억원|십억원|조원|원|천달러|백만달러)", s)
    return {"백만원": 1e6, "천원": 1e3, "억원": 1e8, "십억원": 1e9, "조원": 1e12, "원": 1}.get(m.group(1) if m else "", None)


def sales_tables(t):
    """매출 칸의 (단위, 표) — 새 양식은 '4. 매출 및 수주상황' 제목, 예전 양식은 '사업의 내용' 본문의 '매출' 이후."""
    secs = sections(t)
    body = "".join(b for ti, b in secs if re.search(r"매출", ti) and not re.search(r"주석|재무|원가|채권|연결|수익", ti))
    if not body:
        biz = "".join(b for ti, b in secs if re.search(r"사업의\s*내용", ti))
        i = max(biz.find("매출실적"), biz.find("매출 실적"))
        body = biz[i:] if i >= 0 else ""
    out, u = [], None
    for blk in re.split(r"(<TABLE\b.*?</TABLE>)", body, flags=re.S):
        if not blk.startswith("<TABLE"):
            u = unit(clean(blk)) or u
            continue
        g = grid(blk)
        uu = unit(" ".join(" ".join(r) for r in g[:2]))
        if uu and len(g) <= 2:  # '(단위 : 백만원)' 만 있는 작은 표
            u = uu
            continue
        out.append((uu or u, g))
    return out


def parse(g):
    """표 → [(이름표들, 올해 누적 값)] — 기간 머리 줄의 첫 기간 칸."""
    h = next((i for i, r in enumerate(g[:4]) if sum(bool(PER.search(c)) for c in r) >= 2), None)
    if h is None:
        return None
    cur = next(j for j, c in enumerate(g[h]) if PER.search(c))
    out = []
    for r in g[h + 1:]:
        if len(r) <= cur:
            continue
        v = num(r[cur])
        lab = []
        for c in r[:cur]:
            if c and (not lab or lab[-1] != c) and num(c) is None:
                lab.append(c)
        if v is not None and lab:
            out.append((lab, v))
    return out


def classify(rows):
    """제품군 {이름: 값}, 지역 {이름: 값}, 합계 — 품목 칸이 가장 다양한 열을 이름으로 (같은 이름은 앞 칸을 붙여 구분)."""
    total = next((v for lab, v in reversed(rows) if TOT.match(lab[-1].replace(" ", "")) and len(set(lab)) == 1), None)
    leaf = [(lab, v) for lab, v in rows if not any(TOT.match(x.replace(" ", "")) for x in lab) and not any(DROP.search(x) for x in lab)]
    prod, exp, dom = defaultdict(float), 0.0, 0.0
    split = any(EXP.match(lab[-1]) or DOM.match(lab[-1]) for lab, _ in leaf)
    depth = max((len(l) for l, _ in leaf), default=0)
    cols = []
    for j in range(depth):  # 지역 칸·매출유형 칸이 아닌 열 중 이름이 가장 다양하고 짧은 열
        vals = [l[min(j, len(l) - 1)] for l, _ in leaf]
        if sum(bool(EXP.match(x) or DOM.match(x) or TYPE.match(x.replace(" ", "")) or re.search(r"(제품|상품|용역)\s*[/,·ㆍ및]|[/,·ㆍ및(]\s*(제품|상품)", x)) for x in vals) >= len(vals) / 2:  # 수출·내수 칸, 제품·상품 칸 ('제품/상품'·'유압 (상품/제품)')
            continue
        cols.append((len(set(vals)), -sum(map(len, vals)) / len(vals), j))
    if not cols:
        return None
    j = max(cols)[2]
    for lab, v in leaf:
        reg = lab[-1] if (EXP.match(lab[-1]) or DOM.match(lab[-1])) else None
        if split and reg is None and len(lab) > 1:  # 수출·내수로 나눈 표에서 나누지 않은 줄(용역·기타매출)
            pass
        name = lab[min(j, len(lab) - 1 - (reg is not None))]
        if EXP.match(name) or DOM.match(name):
            continue
        prod[name] += v
        if reg and EXP.match(reg):
            exp += v
        elif reg:
            dom += v
    geo = {"국내": dom, "해외(수출)": exp} if split and exp + dom > 0 else {}
    return dict(prod), geo, total


def geo_table(rows):
    """지역 이름 표 (국내·미주·유럽·중국 …) → {지역: 값}."""
    leaf = [(lab, v) for lab, v in rows if not any(TOT.match(x.replace(" ", "")) for x in lab) and not any(DROP.search(x) for x in lab)]
    if len(leaf) < 2 or sum(bool(GEO.search(lab[-1])) for lab, _ in leaf) < 0.7 * len(leaf):
        return None
    out = defaultdict(float)
    for lab, v in leaf:
        out[lab[-1]] += v
    return dict(out)


def note_tables(t):
    """연결재무제표 주석의 영업부문 칸 (새 양식 = '영업부문 (연결)' 제목, 예전 양식 = 주석 본문의 '영업부문' 글자 뒤 4만 자)."""
    secs = sections(t)
    body = "".join(b for ti, b in secs if re.search(r"영업\s*부문|부문\s*정보|부문별\s*(정보|보고)", ti) and not re.search(r"^\d+-\d+\.|별도|재무제표$", ti) and "(연결)" in ti or re.search(r"영업\s*부문.*연결", ti))
    if not body:
        note = "".join(b for ti, b in secs if re.search(r"연결\s*재무제표\s*주석", ti))
        i = next((m.start() for m in re.finditer(r"영업\s*부문", note) if m.start() > 2000), -1)
        body = note[i:i + 40000] if i >= 0 else ""
    out, u = [], None
    for blk in re.split(r"(<TABLE\b.*?</TABLE>)", body, flags=re.S):
        if not blk.startswith("<TABLE"):
            u = unit(clean(blk)) or u
            continue
        g = grid(blk)
        uu = unit(" ".join(" ".join(r) for r in g[:2]))
        if uu and len(g) <= 2:
            u = uu
            continue
        out.append((uu or u, g))
    return out


SKIPC = re.compile(r"제거|조정|내부|연결\s*조정|consol", re.I)
GSUM = re.compile(r"^(합\s*계|총\s*계|계|연결\s*(합계|금액|후\s*금액)?|연결\s*후\s*(금액|합계)|기업\s*전체\s*총계(\s*합계)?|부문의\s*합계(\s*합계)?|.*\s합계)$")


OPR = r"^(보고)?(부문)?영업(이익|손익)(\(손실\))?$"  # 부문별 영업이익 줄 ('세전부문이익'은 아님)


def parse_note(g, op=False):
    """주석 표 → ({칸: 값}, 합계) — 매출 줄(순매출·외부 매출 먼저, op 면 영업이익 줄)의 칸별 값, 칸 이름은 머리 여러 줄 중 맨 아래 글자."""
    pick = None
    for pat in (OPR,) if op else (r"순\s*매출|외부\s*(고객)?.*(수익|매출)|외부매출", r"^(수익\s*\(매출액\)|매출액|영업수익|수익|매출)$"):
        pick = next((i for i, r in enumerate(g) if r and re.search(pat, r[0].replace(" ", "") if "^" in pat else r[0]) and sum(num(c) is not None for c in r[1:]) >= 2), None)
        if pick is not None:
            break
    if pick is None or pick == 0:
        return None
    head, row, out, tot = g[:pick], g[pick], {}, None
    cum = any(c.strip() == "누적" for hr in head for c in hr)  # '3개월'·'누적' 칸이 같이 있으면(삼성전자) 누적만 — 분기는 누적 차이로 냄
    for j in range(1, len(row)):
        hs, path = [hr[j] if j < len(hr) else "" for hr in head], []
        if cum and "누적" not in [c.strip() for c in hs]:
            continue
        for c in hs:
            if c and c.strip() != "누적" and (not path or path[-1] != c) and num(c) is None and not unit(c) and not PER.fullmatch(c):
                path.append(c)
        v = num(row[j])
        if v is None or not path:
            continue
        leaf = path[-1]
        if GSUM.match(leaf.strip()):
            tot = v
            continue
        if any(SKIPC.search(x) for x in path[1:]) or SKIPC.search(leaf):
            continue
        nm = f"{path[-2]} {leaf}" if len(path) >= 2 and re.fullmatch(r"[A-Z0-9 ]{2,6}|.*이외", leaf) and not re.fullmatch(r"(보고|영업)?\s*부문|지역", path[-2]) else leaf  # 'KUS' → '북중미 KUS' ('보고부문 SDC' 는 'SDC')
        nm = re.sub(r"본사\s*소재지\s*(국가)?", "국내", nm)
        out[nm] = out.get(nm, 0) + v
    return (out, tot) if len(out) >= 2 else None


def parse_note_t(g, op=False):
    """2025년부터 쓰는 세로 양식 (지역·부문이 줄, 매출이 칸 — XBRL 표를 그대로 펼친 모양) → ({칸: 값}, 합계).
    줄 이름에 '… 합계'(부문 사이 거래를 뺀 순매출)가 있는 줄을 쓰고, '영업부문'(총매출)·'제거·조정' 줄은 뺌."""
    h = c = None
    for i in range(min(3, len(g))):
        c = next((j for j, x in enumerate(g[i]) if (re.search(OPR, x.replace(" ", "")) if op else re.search(r"수익\s*\(매출액\)|순\s*매출|^매출액$|영업수익", x))), None)
        if c:
            h = i
            break
    if h is None:
        return None
    rows = []
    for r in g[h + 1:]:
        v = num(r[c]) if len(r) > c else None
        lab = []
        for x in r[:c]:
            if x and (not lab or lab[-1] != x):
                lab.append(x)
        if v is not None and lab:
            rows.append((lab, v))
    net = [x for x in rows if any(re.search(r"합계", l) for l in x[0][1:])]
    out, tot = {}, None
    for lab, v in net or [x for x in rows if not any(SKIPC.search(l) for l in x[0])]:
        core = [l for l in lab if not re.search(r"^지역$|^부문$|기업\s*전체|영업\s*부문|조정|제거|합계$", l)]
        if not core:
            tot = v
            continue
        leaf = core[-1]
        nm = f"{core[-2]} {leaf}" if len(core) >= 2 and re.fullmatch(r"[A-Z0-9 ]{2,6}|.*이외", leaf) else leaf
        nm = re.sub(r"본사\s*소재지\s*(국가)?", "국내", nm)
        if nm == "외국":  # '외국' 묶음 줄 (아래 나라·지역 줄과 겹침)
            continue
        out[nm] = out.get(nm, 0) + v
    return (out, tot) if len(out) >= 2 else None


def bad_names(d):
    """제품군으로 쓰면 안 되는 칸: 재무 항목('매출액'·'영업이익' — 표를 잘못 읽은 것)이나 대부분 지역 이름(→ 지역으로 써야 함)."""
    ks = list(d)
    return any(re.match(r"^(매출액|영업이익|영업손익|당기순이익|순이익|매출총이익|자산|부채|자본|감가상각)", k.replace(" ", "")) for k in ks) \
        or sum(bool(GEO.search(k)) for k in ks) >= 0.6 * len(ks)


def report_note(t):
    """영업부문 주석 → (제품군, 지역, 합계) — 칸 이름이 대부분 지역이면 지역으로."""
    prod = geo = tot = None
    for u, g in note_tables(t):
        x = (parse_note(g) or parse_note_t(g)) if u else None
        if not x:
            continue
        vals, tt = {k: v * u for k, v in x[0].items()}, (x[1] * u if x[1] is not None else None)
        isgeo = sum(bool(GEO.search(k) or k in ("국내",)) for k in vals) >= 0.6 * len(vals)
        if isgeo and geo is None:
            geo, tot = vals, tot or tt
        elif not isgeo and prod is None and not bad_names(vals):
            prod, tot = vals, tot or tt
        if prod is not None and geo is not None:
            break
    return (prod or {}, geo or {}, tot, False) if (prod or geo) else None


def report_op(t):
    """영업부문 주석 → (부문별 영업이익, 같은 표의 부문별 매출, 영업이익 합계) — 이익률을 같은 부문 이름으로 내려고 매출도 같은 표에서."""
    for u, g in note_tables(t):
        x = (parse_note(g, True) or parse_note_t(g, True)) if u else None
        if x:  # 소계 칸·숫자를 이름으로 잘못 읽은 칸은 뺌
            x = ({k: v for k, v in x[0].items() if not TOT.match(k.replace(" ", "")) and not re.search(r"소\s*계$", k) and num(k) is None}, x[1])
        if x and len(x[0]) >= 2 and not any(re.match(r"^(매출|영업이익|영업손익|당기|순이익|자산|부채|자본)", k.replace(" ", "")) for k in x[0]):  # 지역 부문(삼양식품)은 그대로 씀
            r = parse_note(g) or parse_note_t(g)
            rev = {k: v * u for k, v in r[0].items() if k in x[0]} if r else {}
            return {k: v * u for k, v in x[0].items()}, rev, (x[1] * u if x[1] is not None else None), False
    return None


def report(path, src="A"):
    """보고서 하나 → (제품군, 지역, 합계, 내부거래 포함 표인지) — 원 단위. 못 읽으면 None.
    src A = 사업의 내용 '매출실적' 표, B = 연결 주석 '영업부문' 표 (A 가 연결 전체와 안 맞는 회사용: 기아 등)."""
    t = doc_text(path)
    if src == "B":
        return report_note(t)
    if src == "OP":  # (영업이익, 매출, 영업이익 합계) — quarters() 가 prod·geo 자리에 담아 누적 차이를 냄
        return report_op(t)
    tabs = sales_tables(t)
    prod = geo = tot = None
    inner = bool(re.search(r"내부\s*거래(를|가)?\s*포함", t[:400000]))
    for u, g in tabs:
        rows = parse(g)
        if not rows or u is None:
            continue
        rows = [(l, v * u) for l, v in rows]
        if prod is None:
            c = classify(rows)
            if c and len(c[0]) >= 2 and not bad_names(c[0]):
                prod, geo, tot = c
                continue
            if c and tot is None:  # 부문이 하나뿐인 표(SK하이닉스 '반도체 부문')는 합계만
                tot = c[2]
        if not geo or set(geo) == {"국내", "해외(수출)"}:  # 지역 이름 표가 있으면 수출·내수 대신
            gt = geo_table(rows)
            if gt and len(gt) >= 2 and not (tot and abs(sum(gt.values()) / tot - 1) > 0.1):  # 지역 합이 매출 표 합계와 10% 넘게 다르면 다른 표(해외 법인 등)
                geo = gt
    return (prod or {}, geo or {}, tot, inner) if (prod or geo) else None


NK = lambda s: re.sub(r"[\s·ㆍ,/\-\.]|\(.*?\)|및", "", s)  # noqa: E731 — 표기만 다른 칸 이름을 같은 열쇠로


def quarters(code, src="A"):
    """보고서들 → {분기 끝 날짜: {"prod": {}, "geo": {}}} (누적 차이) — 12월 결산 기준 (사업보고서 달로 결산월을 정함)."""
    ix = {}  # index.json · index_{나눈 번호}.json (서버 여러 대가 나눠 받은 목록)
    for f in RAW.glob("index*.json"):
        ix.update({c: v for c, v in json.loads(f.read_text(encoding="utf-8")).items() if v})
    idx = ix.get(code) or [  # 목록이 없으면(받다 멈춤) 파일 이름 '2026.06_접수번호.zip' 으로
        {"p": f.name[:7], "nm": "", "file": f.name} for f in sorted((RAW / code).glob("*.zip"))]
    fy = next((int(r["p"][5:]) for r in reversed(idx) if "사업보고서" in r["nm"]), 12)
    ytd = {}
    for r in idx:
        f = RAW / code / r["file"]
        if not f.exists():
            continue
        y, m = int(r["p"][:4]), int(r["p"][5:])
        k = (m - fy) % 12 // 3 or 4  # 결산 뒤 몇 번째 분기
        fyear = y if m <= fy else y + 1
        try:
            x = report(f, src)
        except Exception as e:  # noqa: BLE001
            print(f"    ⚠ {code} {r['p']}: {str(e)[:80]}")
            continue
        if x:
            ytd[(fyear, k)] = (r["p"], x)
    out = {}
    for (fyear, k), (p, (prod, geo, tot, inner)) in sorted(ytd.items()):
        prev = ytd.get((fyear, k - 1)) if k > 1 else None
        if k > 1 and not prev:
            continue
        end = f"{p[:4]}-{p[5:]}-{'31' if p[5:] in ('03', '12') else '30'}"
        q = {}
        for kind, cur, old in (("prod", prod, prev[1][0] if prev else None), ("geo", geo, prev[1][1] if prev else None)):
            if not cur:
                continue
            if old is None:
                q[kind] = dict(cur)
                continue
            # 이름이 같은 칸끼리 뺌 — 띄어쓰기·쉼표만 다른 이름('소스조미소재'='소스, 조미소재')은 같게, 0 인 칸은 빼고 봄
            c2, o2 = {NK(n): (n, v) for n, v in cur.items() if v}, {NK(n): v for n, v in old.items() if v}
            if set(c2) == set(o2):
                q[kind] = {n: v - o2[k] for k, (n, v) in c2.items()}
            elif len(c2) == len(o2) and len(set(c2) - set(o2)) == 1:  # 칸 하나만 이름이 바뀜 ('이엔에스' → 'E&S', '유제품/기능성식품' → '뉴트리션') — 남은 하나끼리 짝
                (a,), (b,) = set(c2) - set(o2), set(o2) - set(c2)
                q[kind] = {n: v - o2[b if k == a else k] for k, (n, v) in c2.items()}
        if q.get("prod") or q.get("geo"):
            out[end] = {**q, "tot": (tot - (prev[1][2] or 0)) if tot and prev and prev[1][2] else tot if not prev else None, "inner": inner}
    return out


def check(code, q):
    """DART 분기 매출(longq, 억원)과 맞는 분기만 — 제품군·지역 따로 맞춰 봄."""
    p = ROOT / "site" / "data" / "stocks" / f"{code}.json"
    lq = (json.loads(p.read_text(encoding="utf-8")).get("longq") or {}) if p.exists() else {}
    keep, bad = {"prod": {}, "geo": {}}, []
    for end, r in q.items():
        y, m = int(end[:4]), int(end[5:7])
        lb = f"{y % 100:02d}.{(m - 1) // 3 + 1}Q"
        rev = (lq.get(lb) or {}).get("rev")
        lim = 0.25 if r["inner"] else 0.12
        for kind in ("prod", "geo"):
            part = r.get(kind)
            if not part:
                continue
            s = sum(v for v in part.values() if v > 0) / 1e8
            if rev and rev > 0 and abs(s / rev - 1) <= lim and min(part.values()) > -0.05 * rev * 1e8:
                keep[kind][end] = part
            elif kind == "prod" or not r.get("prod"):
                bad.append(f"{lb}({s:,.0f}/{rev or 0:,.0f})")
    return keep, bad

def check_op(code, q):
    """부문 영업이익 합이 DART 분기 영업이익과 매출의 4% 안으로 맞는 분기만 (차이 = 본사 비용·부문 사이 제거) → ({끝: 이익}, {끝: 매출})."""
    p = ROOT / "site" / "data" / "stocks" / f"{code}.json"
    lq = (json.loads(p.read_text(encoding="utf-8")).get("longq") or {}) if p.exists() else {}
    op, rv = {}, {}
    for end, r in q.items():
        y, m = int(end[:4]), int(end[5:7])
        L = lq.get(f"{y % 100:02d}.{(m - 1) // 3 + 1}Q") or {}
        part = r.get("prod")
        if part and L.get("rev") and L.get("op") is not None and abs(sum(part.values()) / 1e8 - L["op"]) <= 0.04 * L["rev"]:
            op[end] = part
            if r.get("geo") and set(r["geo"]) == set(part):
                rv[end] = r["geo"]
    return op, rv


def tidy(q):
    """해마다 조금씩 다른 표기('소스,조미소재'·'소스· 조미소재'·'기 타'·'국내 (내수)')를 같은 칸으로 — 이름은 최신 표기."""
    from difflib import SequenceMatcher
    key = lambda s: {"MEMORY": "메모리", "E&S": "이엔에스", "IT서비스부문": "정보통신부문"}.get(s.strip().upper(), re.sub(r"[\s·ㆍ,/\-\.]|\(.*?\)|및", "", s))  # 이름만 바뀐 부문
    when, disp = defaultdict(set), {}
    for e in sorted(q, reverse=True):
        for m in q[e]:
            disp.setdefault(key(m), m)
            when[key(m)].add(e)
    alias = {}  # 같은 분기에 같이 나온 적 없고 글자가 거의 같거나 순서만 바뀐 칸('조미소재·소스' = '소스,조미소재')
    ks = sorted(when, key=lambda k: max(when[k]), reverse=True)
    for i, a in enumerate(ks):
        for b in ks[i + 1:]:
            if b not in alias and a not in alias and not when[a] & when[b] and (sorted(a) == sorted(b) or SequenceMatcher(None, a, b).ratio() >= 0.85):
                alias[b] = a
                when[a] |= when[b]
    out = {}
    for e, r in q.items():
        row = defaultdict(float)
        for m, v in r.items():
            row[disp[alias.get(key(m), key(m))]] += v
        out[e] = dict(row)
    return out


SRC = {"A": {"prod": "DART 분기·반기·사업보고서 '매출실적' 표 (누적 차이로 분기)", "geo": "DART 보고서 '매출실적' 표 (수출·내수 또는 지역별)"},
       "B": {"prod": "DART 연결재무제표 주석 '영업부문' (누적 차이로 분기)", "geo": "DART 연결재무제표 주석 '영업부문' 지역별"}}


def main(codes):
    saved = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for code in codes or sorted(d.name for d in RAW.iterdir() if d.is_dir()):
        best, bads = {"prod": ({}, "A"), "geo": ({}, "A")}, []
        for src in ("A", "B"):  # 매출실적 표 → 안 맞는 분기가 많으면 영업부문 주석도
            ok, bad = check(code, quarters(code, src))
            for kind in ("prod", "geo"):
                if len(ok[kind]) > len(best[kind][0]):
                    best[kind] = (ok[kind], src)
            bads += bad
            if len(ok["prod"]) >= 16 and len(ok["geo"]) >= 16:
                break
        old, new = saved.get(code) or {}, {}
        for kind in ("prod", "geo"):
            q, src = best[kind]
            if len(q) >= 4 or (old.get(kind) and q):  # 처음엔 4분기 넘게 맞아야, 이미 있으면 새 분기만 이어 붙임 (서버는 최근 보고서만 받음)
                new[kind], new["src_" + kind] = tidy({**(old.get(kind) or {}), **q}), SRC[src][kind]
            elif old.get(kind):
                new[kind], new["src_" + kind] = old[kind], old.get("src_" + kind)
        opq, rvq = check_op(code, quarters(code, "OP"))  # 📊 부문별 영업이익 (사용자 11/6) — 부문을 하나만 쓰는 회사는 없음
        if len(opq) >= 4 or (old.get("op") and opq):
            new["op"], new["op_rev"], new["src_op"] = tidy({**(old.get("op") or {}), **opq}), tidy({**(old.get("op_rev") or {}), **rvq}), "DART 연결재무제표 주석 '영업부문' 영업이익 (누적 차이로 분기)"
        elif old.get("op"):
            new.update({k: old[k] for k in ("op", "op_rev", "src_op") if k in old})
        if not new:
            print(f"  ✗ {code}: 맞는 분기 없음 (안 맞음 {len(bads)}: {' '.join(bads[:5])})")
            continue
        saved[code] = new
        say = lambda k: f"{len(new[k])}분기 {min(new[k])[:7]}~{max(new[k])[:7]} ({best[k][1]})" if new.get(k) else "없음"
        print(f"  {code}: 제품군 {say('prod')} · 지역 {say('geo')} · 부문 이익 {len(new.get('op') or {})}분기")
    OUT.write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")
    print("저장:", OUT)

if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        assert num("1,183,178") == 1183178 and num("△271,085") == -271085 and num("(1,234)") == -1234 and num("10,205 ( 4.0%)") == 10205 and num("-") == 0 and num("면스낵") is None
        g = grid('<TR><TD ROWSPAN="2">A</TD><TD>x</TD><TD>1</TD></TR><TR><TD>y</TD><TD>2</TD></TR><TR><TD COLSPAN="2">합 계</TD><TD>3</TD></TR>')
        assert g == [["A", "x", "1"], ["A", "y", "2"], ["합 계", "합 계", "3"]], g
        rows = [(["식품", "제품", "면스낵", "수 출"], 100), (["식품", "제품", "면스낵", "내 수"], 20), (["식품", "제품", "면스낵", "합 계"], 120),
                (["식품", "제품", "소스", "수 출"], 5), (["식품", "제품", "소스", "내 수"], 5), (["물류 등 용역매출"], 7), (["합 계"], 137)]
        pr, ge, tt = classify(rows)
        assert pr == {"면스낵": 120, "소스": 10, "물류 등 용역매출": 7} and ge == {"국내": 25, "해외(수출)": 105} and tt == 137, (pr, ge, tt)
        assert unit("(단위 : 백만원)") == 1e6 and unit("(단위: 억원)") == 1e8
        assert NK("소스, 조미소재") == NK("소스조미소재") == NK("소스· 조미소재") and NK("유제품/ 기능성식품") == NK("유제품 기능성식품")
        assert re.search(OPR, "영업이익(손실)") and re.search(OPR, "보고부문영업이익") and not re.search(OPR, "세전부문이익(손실)")
        print("ok")
    else:
        main(sys.argv[1:])
