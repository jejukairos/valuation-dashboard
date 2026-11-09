"""💰 한국 정기보고서 연결 주석 '판매비와관리비' 표 → 분기 판관비 항목 (급여·광고선전비·운반비·수수료 …) → cache/dart_sga.json
(사용자 11/10 "매출원가율·판관비율 — 광고선전비율·운반비율 등 나눠서, 모든 종목, 전자공시가 중요").
원문은 cache/dart_raw (tools/dart_docs.py) · 표 읽는 도구는 dart_seg.py 것을 그대로.
- 새 양식(2025~) = '판매비와관리비 (연결)' 제목 칸, 예전 양식 = 연결 주석 본문의 '판매비와관리비' 글자 뒤.
- 값 = '누적' 칸 (없으면 첫 숫자 칸 = 당기·당분기) → 분기 = 누적 차이. 이름이 조금 바뀐 항목('사용권자산상각비' → '사용권자산감가상각비')은
  같은 열쇠로 빼고, 그래도 남는 차이는 '기타(이름 바뀜)'에 (합계는 합계끼리 뺀 값).
- 맞춰 보기: 분기 합계가 DART 손익계산서 (매출총이익 − 영업이익)과 15% 넘게 다르면 버림 (표·칸을 잘못 읽은 것 —
  배터리 회사 AMPC 처럼 영업이익에 다른 수익이 섞인 회사는 10% 안팎 차이가 정상).
  python tools/dart_sga.py [코드 …] · --test"""
import json
import re
import sys

from dart_seg import RAW, ROOT, clean, doc_text, grid, num, sections, unit

OUT = ROOT / "cache" / "dart_sga.json"
SG = re.compile(r"판매비\s*와\s*관리비|판매비\s*및\s*(일반)?관리비|판매비와\s*일반관리비|판매관리비")
ITEM = re.compile(r"급여|복리후생|광고|운반|수수료|감가상각|임차료|판매촉진|여비|세금과공과|연구|물류|수출제비용|보관|용역")
TOTL = re.compile(r"합계|^계$|총계|^(판매비와관리비|판매및일반관리비|판매비와일반관리비|판매관리비)(합계|계)?$")
SUBL = re.compile(r"소계|^(판매비|관리비|일반관리비)(계|합계)?:?$|^\(\d\)")
ISN = re.compile(r"[△▲\-(]?\s*[\d,]*\d(\.\d+)?\s*\)?")  # '3개월' 같은 머리 글자는 숫자 아님


def tables_in(body):
    """(단위, 표, 바로 앞 글) — 앞 글 = '당반기'·'전반기' 같은 작은 제목 (당기·전기 표를 따로 둔 새 양식 구분용)."""
    out, u, cap = [], None, ""
    for blk in re.split(r"(<TABLE\b.*?</TABLE>)", body, flags=re.S):
        if not blk.startswith("<TABLE"):
            t = clean(blk)
            u, cap = unit(t) or u, (t[-120:] if t else cap)
            continue
        g = grid(blk)
        uu = unit(" ".join(" ".join(r) for r in g[:2]))
        if len(g) <= 2:  # '(단위 : 천원)' · '당반기' 만 있는 작은 표
            u, cap = uu or u, " ".join(" ".join(r) for r in g)
            continue
        out.append((uu or u, g, cap))
    return out


def parse_sga(g):
    """판관비 표 → ({항목: 올해 누적}, 합계) — '누적' 칸이 있으면 첫 누적 칸, 없으면 첫 숫자 칸."""
    isn = lambda c: bool(ISN.fullmatch((c or "").strip()))  # noqa: E731
    first = next((i for i, r in enumerate(g) if any(isn(c) for c in r[1:])), None)
    if not first:
        return None
    head, ncol = g[:first], max(len(r) for r in g)
    cols = [j for j in range(1, ncol) if any(len(r) > j and isn(r[j]) for r in g[first:])]
    if not cols:
        return None
    cum = [j for j in cols if "누적" in [re.sub(r"\s+", "", hr[j]) for hr in head if j < len(hr)]]  # '누 적'(삼성전자)
    cur = cum[0] if cum else cols[0]
    items, tot = {}, None
    for r in g[first:]:
        if len(r) <= cur:
            continue
        v = num(r[cur])
        lab = re.sub(r"\s+", " ", next((c for c in reversed(r[:cur]) if c and num(c) is None), "")).strip()
        k = lab.replace(" ", "")
        if v is None or not lab:
            continue
        if TOTL.search(k):
            tot = v if tot is None else tot
        elif not SUBL.search(k):
            items[lab] = items.get(lab, 0) + v
    rd = [k for k in items if re.search(r"총지출|자산화", k)]  # SK하이닉스: '연구개발비 총지출액 + 개발비 자산화 = 경상개발비' → 앞 둘은 겹침
    if tot and rd and abs(sum(items.values()) / tot - 1) > 0.03 and abs((sum(items.values()) - sum(items[k] for k in rd)) / tot - 1) <= 0.03:
        items = {k: v for k, v in items.items() if k not in rd}
    if sum(bool(ITEM.search(k)) for k in items) < 4 or (tot and abs(sum(items.values()) / tot - 1) > 0.03):
        return None
    return items, tot


def report_sga(t):
    """보고서 하나 → ({항목: 원}, 합계 원) — 판매비·관리비를 표 두 개로 나눠 적은 회사(기아)는 둘을 더함."""
    secs = sections(t)
    bodies = [b for ti, b in secs if SG.search(ti) and "(연결)" in ti] or [b for ti, b in secs if SG.search(ti) and not re.search(r"별도", ti)]
    if not bodies:
        for want in (r"연결\s*재무제표\s*(에\s*대한\s*)?주석", r"재무제표\s*(에\s*대한\s*)?주석"):
            note = "".join(b for ti, b in secs if re.search(want, ti))
            bodies = [note[m.start():m.start() + 15000] for m in SG.finditer(note)]
            if bodies:
                break
    for b in bodies:
        got = []
        for u, g, cap in tables_in(b):
            x = parse_sga(g) if u else None
            if not x:
                continue
            prior = re.search(r"전\s*(분|반)?\s*기", cap) and not re.search(r"당\s*(분|반)?\s*기", cap)
            if prior:
                continue
            got.append(({k: v * u for k, v in x[0].items()}, x[1] * u if x[1] else sum(x[0].values()) * u, cap))
            if not re.search(r"판매비의|판매비\s*내역", cap):  # 판매비만 적은 표면 다음 '관리비' 표까지
                break
        if got:
            items = {}
            for it, _, _ in got:
                for k, v in it.items():
                    items[k] = items.get(k, 0) + v
            return items, sum(x[1] for x in got)
    return None


KEY = lambda s: re.sub(r"[\s·ㆍ,/\-\.]|\(.*?\)|및|감가", "", s)  # noqa: E731
# 묶음 (app.js SGA_CAT 와 같게) — 이름으로 짝이 안 맞는 항목은 같은 묶음끼리 뺌 (삼양 2Q '수출제비 및 운반비' → 3Q '운반비'·'수출제비용')
CAT = [("인건비", r"급여|상여|퇴직|복리후생|주식보상|종업원|인건비"), ("광고·판촉비", r"광고|판매촉진|판촉|마케팅|홍보|견본"),
       ("운반·물류비", r"운반|운송|물류|수출제비|보관|배송"), ("연구개발비", r"연구|개발비"), ("감가상각비", r"^(?!.*대손).*상각"), ("수수료·용역비", r"수수료|용역|위탁|외주")]
cat = lambda s: next((c for c, p in CAT if re.search(p, s)), "기타")  # noqa: E731


def diff(items, old):
    """올해 누적 − 지난 분기 누적: 이름이 같으면 그대로, 남은 건 같은 묶음끼리 (누적 크기 비율로 나눠 뺌)."""
    ok = {KEY(n): v for n, v in old.items()}
    q = {n: v - ok.pop(KEY(n)) for n, v in items.items() if KEY(n) in ok}
    left = {n: v for n, v in items.items() if n not in q}
    oc = {}
    for k, v in ok.items():  # 짝 없는 지난 항목 → 묶음별 합
        oc[cat(k)] = oc.get(cat(k), 0) + v
    for c in {cat(n) for n in left}:
        ns = [n for n in left if cat(n) == c]
        s = sum(left[n] for n in ns) or 1
        for n in ns:
            q[n] = left[n] - oc.get(c, 0) * left[n] / s
        oc.pop(c, None)
    return q


def quarters(code):
    """보고서들 → {'26.2Q': {항목: 원}} (누적 차이, 12월 결산 기준 — 결산월은 사업보고서 달)."""
    ix = {}
    for f in RAW.glob("index*.json"):
        ix.update({c: v for c, v in json.loads(f.read_text(encoding="utf-8")).items() if v})
    idx = ix.get(code) or [{"p": f.name[:7], "nm": "", "file": f.name} for f in sorted((RAW / code).glob("*.zip"))]
    fy = next((int(r["p"][5:]) for r in reversed(idx) if "사업보고서" in r["nm"]), 12)
    ytd = {}
    for r in idx:
        f = RAW / code / r["file"]
        if not f.exists():
            continue
        y, m = int(r["p"][:4]), int(r["p"][5:])
        try:
            x = report_sga(doc_text(f))
        except Exception as e:  # noqa: BLE001
            print(f"    ⚠ {code} {r['p']}: {str(e)[:80]}")
            continue
        if x:
            ytd[(y if m <= fy else y + 1, (m - fy) % 12 // 3 or 4)] = (r["p"], x)
    out = {}
    for (fyear, k), (p, (items, tot)) in sorted(ytd.items()):
        prev = ytd.get((fyear, k - 1)) if k > 1 else None
        if k > 1 and not prev:
            continue
        q = diff(items, prev[1][0] if prev else {})
        tq = tot - prev[1][1] if prev else tot
        if abs(sum(q.values()) - tq) > 0.001 * abs(tq or 1):
            q["기타(이름 바뀜)"] = q.get("기타(이름 바뀜)", 0) + tq - sum(q.values())
        out[f"{int(p[2:4]):02d}.{(int(p[5:]) - 1) // 3 + 1}Q"] = q
    return out


def check(code, q):
    """분기 합계 vs DART (매출총이익 − 영업이익, longq 억원) — 15% 또는 매출의 0.5% 안만."""
    p = ROOT / "site" / "data" / "stocks" / f"{code}.json"
    lq = (json.loads(p.read_text(encoding="utf-8")).get("longq") or {}) if p.exists() else {}
    keep, bad = {}, []
    for lb, it in q.items():
        L, s = lq.get(lb) or {}, sum(it.values()) / 1e8
        if L.get("rev") and L.get("gp") is not None and L.get("op") is not None and s > 0 and \
                abs(s - (L["gp"] - L["op"])) <= max(0.15 * abs(L["gp"] - L["op"]), 0.005 * L["rev"]):
            keep[lb] = {k: round(v / 1e8, 1) for k, v in it.items() if abs(v) >= 5e6}  # 억원, 0.05억 미만 항목은 뺌
        else:
            bad.append(lb)
    return keep, bad


def main(codes):
    saved = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for code in codes or sorted(d.name for d in RAW.iterdir() if d.is_dir()):
        keep, bad = check(code, quarters(code))
        old = (saved.get(code) or {}).get("q") or {}
        if not keep and not old:
            print(f"  ✗ {code}: 맞는 분기 없음 ({len(bad)}분기 안 맞음)")
            continue
        q = {**old, **keep}  # 서버는 최근 보고서만 받음 → 새 분기만 이어 붙임
        saved[code] = {"q": dict(sorted(q.items())), "src": "DART 분기·반기·사업보고서 연결 주석 '판매비와관리비' (누적 차이로 분기)"}
        print(f"  {code}: {len(keep)}분기 맞음 · 안 맞음 {len(bad)} {bad[-4:]}")
    OUT.write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")
    print("저장:", OUT)


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        g = [["", "", "3개월", "누적"], ["판매비와관리비 합계", "판매비와관리비 합계", "30", "60"], ["합계", "급여", "10", "20"], ["합계", "광고선전비", "5", "15"],
             ["합계", "운반비", "5", "10"], ["합계", "지급수수료", "5", "10"], ["합계", "감가상각비", "5", "5"]]
        it, tot = parse_sga(g)
        assert tot == 60 and it == {"급여": 20, "광고선전비": 15, "운반비": 10, "지급수수료": 10, "감가상각비": 5}, (it, tot)
        g2 = [["구 분", "당기", "전기"], ["급여", "10", "9"], ["광고선전비", "5", "4"], ["운반비", "3", "3"], ["지급수수료", "2", "2"], ["판매 및 일반관리비", "20", "18"]]
        assert parse_sga(g2) == ({"급여": 10, "광고선전비": 5, "운반비": 3, "지급수수료": 2}, 20), parse_sga(g2)
        assert KEY("사용권자산감가상각비") == KEY("사용권자산상각비") and KEY("대손상각비(환입)") == KEY("대손상각비")
        d = diff({"급여": 30, "운반비": 10, "수출제비용": 30, "광고선전비": 20}, {"급여": 20, "수출제비 및 운반비": 20, "광고선전비": 10})
        assert d == {"급여": 10, "광고선전비": 10, "운반비": 5, "수출제비용": 15}, d
        assert cat("대손상각비") == "기타" and cat("사용권자산상각비") == "감가상각비" and cat("수출제비용") == "운반·물류비"
        print("ok")
    else:
        main(sys.argv[1:])
