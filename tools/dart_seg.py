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
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "cache" / "dart_raw"
OUT = ROOT / "cache" / "dart_seg.json"
TOT = re.compile(r"^(합\s*계|총\s*계|소\s*계|계|합계\s*\(.*\)|매출\s*합계|총\s*매출액?)$")
DROP = re.compile(r"에누리|내부\s*거래|내부매출|연결\s*조정|조정|제거|차감|할인|consolidat", re.I)
EXP, DOM = re.compile(r"^(수\s*출|해\s*외|수출\s*\(.*\))$"), re.compile(r"^(내\s*수|국\s*내|내수\s*\(.*\))$")
GEO = re.compile(r"국내|내수|수출|해외|미주|미국|북미|남미|중남미|유럽|구주|중국|아시아|일본|중동|아프리카|오세아니아|인도|베트남|대만|기타\s*지역|CIS|러시아|캐나다|호주|동남아")
PER = re.compile(r"제\s*\d+\s*기|당\s*(분|반)?기|20\d\d\s*년")
TYPE = re.compile(r"^(제품|상품|용역|제\s*ㆍ?\s*상품.*|제품\s*및\s*상품|상품\s*및\s*제품|기타매출|기타\s*수익|매출유형|서비스)$")


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
        if sum(bool(EXP.match(x) or DOM.match(x) or TYPE.match(x.replace(" ", ""))) for x in vals) >= len(vals) / 2:  # 수출·내수 칸, 제품·상품 칸
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


def report(path):
    """보고서 하나 → (제품군, 지역, 합계, 내부거래 포함 표인지) — 원 단위. 못 읽으면 None."""
    t = doc_text(path)
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
            if c and len(c[0]) >= 2:
                prod, geo, tot = c
                continue
        if prod is not None and not geo or (prod is not None and geo and set(geo) == {"국내", "해외(수출)"}):
            gt = geo_table(rows)
            if gt and len(gt) >= 2:
                geo = gt
    return (prod, geo or {}, tot, inner) if prod else None


def quarters(code):
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
            x = report(f)
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
            elif set(cur) == set(old):  # 이름이 같은 칸끼리만 뺌
                q[kind] = {n: cur[n] - old[n] for n in cur}
        if q.get("prod"):
            out[end] = {**q, "tot": (tot - (prev[1][2] or 0)) if tot and prev and prev[1][2] else tot if not prev else None, "inner": inner}
    return out


def check(code, q):
    """DART 분기 매출(longq, 억원)과 맞는 분기만."""
    p = ROOT / "site" / "data" / "stocks" / f"{code}.json"
    lq = (json.loads(p.read_text(encoding="utf-8")).get("longq") or {}) if p.exists() else {}
    keep, bad = {}, []
    for end, r in q.items():
        y, m = int(end[:4]), int(end[5:7])
        lb = f"{(y if m > 1 else y - 1) % 100:02d}.{(m - 1) // 3 + 1 if m % 3 == 0 else (m + 1) // 3}Q"
        rev = (lq.get(lb) or {}).get("rev")
        s = sum(v for v in r["prod"].values() if v > 0) / 1e8
        lim = 0.25 if r["inner"] else 0.12
        if rev and rev > 0 and abs(s / rev - 1) <= lim and min(r["prod"].values()) > -0.05 * rev * 1e8:
            keep[end] = r
        else:
            bad.append(f"{lb}({s:,.0f}/{rev or 0:,.0f})")
    return keep, bad


def tidy(q):
    """해마다 조금씩 다른 표기('소스,조미소재'·'소스· 조미소재'·'기 타'·'국내 (내수)')를 같은 칸으로 — 이름은 최신 표기."""
    from difflib import SequenceMatcher
    key = lambda s: {"MEMORY": "메모리"}.get(s.strip().upper(), re.sub(r"[\s·ㆍ,/\-\.]|\(.*?\)|및", "", s))
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


def main(codes):
    saved = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for code in codes or sorted(d.name for d in RAW.iterdir() if d.is_dir()):
        q, bad = check(code, quarters(code))
        old = saved.get(code) or {}
        if len(q) < 4 and not (old and q):  # 처음엔 4분기 넘게 맞아야, 이미 있으면 새 분기만 이어 붙임 (서버는 최근 보고서만 받음)
            print(f"  ✗ {code}: 맞는 분기 {len(q)}개 (안 맞음 {len(bad)}: {' '.join(bad[:6])})")
            continue
        prod = tidy({**(old.get("prod") or {}), **{e: r["prod"] for e, r in q.items()}})
        geo = {**(old.get("geo") or {}), **{e: r["geo"] for e, r in q.items() if r.get("geo")}}
        has_geo = len(geo) >= 4
        saved[code] = {"prod": prod, "src_prod": "DART 분기·반기·사업보고서 '매출실적' 표 (누적 차이로 분기)",
                       **({"geo": tidy(geo), "src_geo": "DART 보고서 '매출실적' 표 (수출·내수 또는 지역별)"} if has_geo else {})}
        ks = sorted(q)
        print(f"  {code}: {len(q)}분기 ({ks[0]} ~ {ks[-1]}) · 지역 {'있음' if has_geo else '없음'} · 안 맞음 {len(bad)} {' '.join(bad[:4])}")
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
        print("ok")
    else:
        main(sys.argv[1:])
