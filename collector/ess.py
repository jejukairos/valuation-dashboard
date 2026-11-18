"""🔋 글로벌 ESS 신규 설치량 달별 (사용자 11/18: "이런 자료가 올라오면 원본 링크를 타고 가서 알아서 갱신 · 추세가 살았는지 꺾였는지") → site/data/ess.json
원자료 = Benchmark Mineral Intelligence (유료) · 공개된 곳 = 하나증권 김현수 'ESS Battery Monthly' PDF (자료 달의 두 달 뒤 중순).
하나증권 산업분석 목록에서 제목 'ESS Battery' 최신 글을 찾아, PDF 1쪽 표(지역별 그 달·누적 — 글자 그대로)와 지역별 그림의 막대(벡터 좌표)에서 달별 값을 읽는다.
막대 눈금은 표의 누적 값으로 맞추고, 그 달 값이 표와 안 맞으면 그 지역 달별 값은 버린다(표 숫자만 남김). 새 호가 없으면 아무것도 안 함."""
import io
import re
import sys
from html import unescape

from common import DATA, HTTP, REPORT, now_kst, read_json, write_json

HW = "https://www.hanaw.com"
LIST = f"{HW}/main/research/research/list.cmd"
REGIONS = ["글로벌", "북미", "유럽", "중국", "기타"]
NUM = r"(?:-|-?[\d,]+(?:\.\d+)?)"


def find(html):
    """목록 화면 → 가장 위(최신) ESS 월간 {fn, u, t, d} (없으면 None)."""
    html = re.sub(r"</?span[^>]*>", "", html)  # 검색어에 칠한 <span class='search-word'> 가 제목을 끊음
    for m in re.finditer(r'<a href="(/main/research/research/download\.cmd\?[^"]+)"[^>]*>\s*(ESS_Monthly_\d{6}[\w]*\.pdf)\s*</a>', html):
        blk = html[max(0, m.start() - 12000):m.start()]  # 이 글의 제목·날짜는 받기 링크 바로 앞 (가장 가까운 것)
        t, d = re.findall(r'(\d{1,2}월 ESS Battery\s*:[^"<\r\n]+)', blk), re.findall(r"일시\s*:\s*(\d{4})\.(\d{2})\.(\d{2})", re.sub(r"<[^>]+>", " ", blk))
        return {"fn": m.group(2), "u": HW + unescape(m.group(1)), "t": re.sub(r"\s+", " ", unescape(t[-1])).replace("- 관련 문의", "").strip() if t else m.group(2), "d": "-".join(d[-1]) if d else ""}
    return None


def table(text):
    """1쪽 글자 → (자료 달 'YYYY-MM', {지역: [Grid 값, 전년비, BTM 값, 전년비, 합계 값, 전년비, 누적 Grid 값, 전년비, 누적 BTM …, 누적 합계 …]}, 독립형 [값, 전년비, 누적, 전년비])."""
    f = lambda s: None if s == "-" else float(s.replace(",", ""))  # noqa: E731
    ym = re.search(r"(\d{4})년\s*(\d{1,2})월\s*ESS\s*Data", text)
    rows = {r: [f(x) for x in m.group(1).split()] for r in REGIONS if (m := re.search(rf"^\s*{r}\s+((?:{NUM}\s+){{11}}{NUM})\s*$", text, re.M))}
    al = re.search(rf"^\s*Stand-alone\s+((?:{NUM}\s+){{3}}{NUM})\s*$", text, re.M)
    return (f"{ym.group(1)}-{int(ym.group(2)):02d}" if ym else None), rows, ([f(x) for x in al.group(1).split()] if al else None)


def bars(stream):
    """그림 한 장의 내용 스트림 → 쌓은 막대 [(x, 아래 칸 높이, 위 칸 높이)] (색 2개가 같은 개수로 쌓인 그림만, 아니면 None).
    shortcut: 막대를 'm l l l h … f' 경로로 그린 지금 PDF 모양만 읽음 — 그리는 방식이 바뀌면 None 이 되어 표 숫자만 남는다 (그때 re 사각형도 읽도록)."""
    groups, sub, cur = [], [], []
    for m in re.finditer(r"(-?[\d.]+) (-?[\d.]+) ([ml])\b|\b(h|f\*?|S|n)\b", stream):
        if m.group(3):
            cur.append((float(m.group(1)), float(m.group(2))))
        elif m.group(4) == "h":
            if len(cur) == 4:
                sub.append((min(p[0] for p in cur), min(p[1] for p in cur), max(p[1] for p in cur)))
            cur = []
        else:  # f = 칠하기 (한 번에 한 색 막대 묶음) · S·n = 선·자르기 (버림)
            if m.group(4).startswith("f") and len(sub) >= 12:
                groups.append(sorted(sub))
            sub, cur = [], []
    if len(groups) != 2 or len(groups[0]) != len(groups[1]):
        return None
    lo, hi = sorted(groups, key=lambda g: sum(b[1] for b in g))  # 바닥에 붙은 쪽 = 아래 칸 (Grid)
    return [(a[0], a[2] - a[1], b[2] - b[1]) for a, b in zip(lo, hi)]


def series(forms, rows, ym):
    """그림들(막대 목록)과 표 → {지역: [[달, Grid, BTM]]}. 그림과 지역은 '그 달 ÷ 누적' 비율로 짝짓고, 눈금은 누적 Grid 로 맞춘다."""
    y, mth = int(ym[:4]), int(ym[5:])
    rel = lambda a, b: abs(a - b) / max(abs(b), 1e-9)  # noqa: E731
    out, used = {}, set()
    for r, v in rows.items():
        gm, bm, gc, bc = v[0], v[2], v[6], v[8]
        if not (gm and bm and gc and bc):
            continue
        best = None
        for i, f in enumerate(forms):
            if i in used or len(f) < mth:
                continue
            G, B = sum(x[1] for x in f[-mth:]), sum(x[2] for x in f[-mth:])
            if G <= 0 or B <= 0:
                continue
            sc = rel(f[-1][1] / G, gm / gc) + rel(f[-1][2] / B, bm / bc) + rel(B / G, bc / gc)
            if best is None or sc < best[0]:
                best = (sc, i, gc / G)
        if not best or best[0] > 0.15:  # 표와 안 맞는 그림은 안 씀
            continue
        used.add(best[1])
        f, k, n = forms[best[1]], best[2], len(forms[best[1]])
        pts = []
        for j, (_, g, b) in enumerate(f):
            t = y * 12 + (mth - 1) - (n - 1 - j)  # 마지막 막대 = 자료 달
            pts.append([f"{t // 12}-{t % 12 + 1:02d}", round(g * k, 1), round(b * k, 1)])
        pts[-1] = [ym, gm, bm]  # 그 달은 표 숫자 그대로
        out[r] = pts
    return out


def build(pdf, meta, prev=None):
    import pypdf
    R = pypdf.PdfReader(io.BytesIO(pdf))
    ym, rows, alone = table(R.pages[0].extract_text() or "")
    if not ym or "글로벌" not in rows:
        raise RuntimeError("1쪽 표를 못 읽음")
    forms = []
    for p in R.pages:
        xo = (p.get("/Resources") or {}).get("/XObject")
        for o in (xo.get_object().values() if xo else []):
            o = o.get_object()
            if o.get("/Subtype") == "/Form":
                b = bars(o.get_data().decode("latin-1"))
                if b:
                    forms.append(b)
    out = {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "ym": ym, "rep": meta, "tbl": rows, "alone": alone, "m": series(forms, rows, ym),
           "src": "Benchmark Mineral Intelligence (원자료) · 하나증권 2차전지 김현수 'ESS Battery Monthly' (표 = 글자 그대로 · 지난 달들 = 그림 막대에서 읽은 값, ±0.1GWh)"}
    # 지난 호의 '그 달' 숫자가 이번 호에서 얼마로 고쳐졌는지 (하나: "전월 데이터 사후 수정 폭이 매우 커")
    old = (prev or {}).get("tbl", {}).get("글로벌")
    now = next((g + b for d, g, b in out["m"].get("글로벌", []) if d == (prev or {}).get("ym")), None)
    if old and old[4] and now and (prev or {}).get("ym") != ym and abs(now - old[4]) >= 0.3:  # 0.3 미만은 그림 읽기 오차
        out["rev"] = {"ym": prev["ym"], "was": old[4], "now": round(now, 1)}
    elif (prev or {}).get("rev") and prev.get("ym") == ym:
        out["rev"] = prev["rev"]
    return out


def collect(urls=None):
    """새 호가 있으면 ess.json 을 새로 씀 (urls = 손으로 줄 PDF 주소들, 옛것 → 새것 순). 바뀐 게 없으면 None."""
    path, cur = DATA / "ess.json", read_json(DATA / "ess.json", {}) or {}
    todo = [{"fn": u.rsplit("/", 1)[-1], "u": u, "t": "", "d": ""} for u in urls or []]
    if not todo:
        r = HTTP.get(LIST, params={"pid": 3, "cid": 1, "srchTitle": "SUBJECT", "srchWord": "ESS Battery"}, tries=3, timeout=40)
        r.encoding = "utf-8"
        it = find(r.text)
        if not it:
            raise RuntimeError("하나증권 목록에서 ESS 월간을 못 찾음")
        if it["fn"] == (cur.get("rep") or {}).get("fn"):
            print(f"  ESS 월간 새 호 없음 ({it['fn']})")
            return None
        todo = [it]
    for it in todo:
        pdf = HTTP.get(it["u"], tries=3, timeout=60).content
        if pdf[:4] != b"%PDF":
            raise RuntimeError(f"PDF 가 아님 ({it['fn']})")
        cur = build(pdf, it, cur)
        g = cur["tbl"]["글로벌"]
        print(f"  ESS {cur['ym']} · 글로벌 {g[4]}GWh ({g[5]:+.1f}%) · 누적 {g[10]}GWh ({g[11]:+.1f}%) · 달별 그림 {', '.join(f'{k} {len(v)}달' for k, v in cur['m'].items()) or '못 읽음'}"
              + (f" · 고침 {cur['rev']}" if cur.get("rev") else ""))
    write_json(path, cur)
    return cur


def _selftest():
    txt = "2026년 9월 ESS Data in detail I 2026.11.18\n글로벌 24.3 89.6 8.6 57.5 32.9 80.0 209.6 45.1 69.7 53.5 279.3 47.1 \n북미 4.1 -1.8 0.9 29.6 5.0 2.8 42.0 17.5 8.6 30.0 50.6 19.4\n기타 - -100.0 1.7 -28.4\nStand-alone 18.8 90.9 152.3 60.4\n"
    ym, rows, alone = table(txt)
    assert ym == "2026-09" and rows["글로벌"][4] == 32.9 and rows["북미"][1] == -1.8 and "기타" not in rows and alone == [18.8, 90.9, 152.3, 60.4], (ym, rows, alone)
    # 그림: 14달, Grid 높이 = 10 + 달 번호, BTM = 5 (눈금 2pt = 1GWh) → 26년 1~2월 누적 Grid = (23+24)/2
    box = lambda x, y0, y1: f"{x} {y1} m\n{x + 5} {y1} l\n{x + 5} {y0} l\n{x} {y0} l\nh\n"  # noqa: E731
    st = "1 g\n0 0 300 200 re\nf*\n0.4 0.8 0.7 rg\n" + "".join(box(10 * i, 13.5, 13.5 + 10 + i) for i in range(1, 15)) + "f\n0.8 0.9 0.9 rg\n" \
        + "".join(box(10 * i, 13.5 + 10 + i, 13.5 + 15 + i) for i in range(1, 15)) + "f\n0.5 G\n1 1 m\n2 2 l\nS\n"
    b = bars(st)
    assert b and len(b) == 14 and abs(b[-1][1] - 24) < 1e-6 and abs(b[0][2] - 5) < 1e-6, b
    assert bars(st[:st.index("0.8 0.9 0.9 rg")]) is None  # 막대 묶음이 하나뿐인 그림(연계 유형별)은 안 씀
    s = series([b], {"글로벌": [12.0, 0, 2.5, 0, 14.5, 0, 23.5, 0, 5.0, 0, 28.5, 0]}, "2026-02")
    assert s["글로벌"][-1] == ["2026-02", 12.0, 2.5] and s["글로벌"][-2] == ["2026-01", 11.5, 2.5] and s["글로벌"][0][0] == "2025-01", s
    assert series([b], {"글로벌": [30.0, 0, 2.5, 0, 32.5, 0, 23.5, 0, 5.0, 0, 28.5, 0]}, "2026-02") == {}  # 표와 안 맞으면 버림
    h = ('<a subject="2차전지(Overweight) : 8월 ESS Battery : 옛 글 ">1</a><a href="#" subject="2차전지(Overweight) : 9월 <span class=\'search-word\'>ESS Battery</span> : 북미 누적 +19% 성장 ">2</a>'
         '<li>일시 : <b>2026.11.17</b> 오후 4:34:43 </li><a href="/main/research/research/download.cmd?bbsSeq=1&amp;attachFileSeq=1" class="j_fileLink">ESS_Monthly_261118_1.pdf</a>')
    assert find(h) == {"fn": "ESS_Monthly_261118_1.pdf", "u": HW + "/main/research/research/download.cmd?bbsSeq=1&attachFileSeq=1", "t": "9월 ESS Battery : 북미 누적 +19% 성장", "d": "2026-11-17"}, find(h)
    print("ess.py 자체 점검 통과")


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        _selftest()
    else:
        try:
            collect(sys.argv[1:])
        except Exception as e:  # noqa: BLE001 - 못 받으면 지난 숫자 그대로 (화면엔 자료 달이 보임)
            REPORT.block("🔋 ESS 설치량", str(e)[:80])
            print("  ESS 실패:", e)
