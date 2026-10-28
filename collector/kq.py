"""최신 분기 실적(잠정) vs 컨센서스 — 한국 종목.
네이버 분기 실적(5분기 실적 + 다음 분기 컨센서스)을 매 갱신마다 받아, 컨센서스는 발표 전 값을 저장해 두고
실적으로 바뀌는 순간 '예상 대비'를 계산한다. 분기 실적은 쌓아서 8분기까지 보여준다. DART 잠정실적 공시가 있으면 링크."""
import pandas as pd

from common import CACHE, HTTP, now_kst, num, read_json

CONS = read_json(CACHE / "q_cons.json") or {}   # {코드: {"202609": {sales, op, ni, eps, date}}} 발표 전 마지막 컨센서스
HIST = read_json(CACHE / "q_hist.json") or {}   # {코드: {"202606": {sales, op, ni, eps}}} 분기 실적 (억원, EPS 원)
ROWS = {"sales": "매출액", "op": "영업이익", "ni": "당기순이익", "eps": "EPS"}


def _naver(code):
    fi = (HTTP.get(f"https://m.stock.naver.com/api/stock/{code}/finance/quarter").json() or {}).get("financeInfo") or {}
    rows = {r.get("title"): r.get("columns") or {} for r in fi.get("rowList", [])}
    out = {}
    for t in fi.get("trTitleList", []):
        k = t.get("key")
        out[k] = (t.get("isConsensus") == "Y", {f: num((rows.get(nm) or {}).get(k, {}).get("value")) for f, nm in ROWS.items()})
    return out


def _filing(code, days=14):
    """최근 DART 잠정실적 공시 (공정공시). DART 키가 없으면(내 컴퓨터) 건너뜀."""
    import kr_stock
    try:
        key = kr_stock.dart_key()
    except RuntimeError:
        return None
    end = now_kst()
    j = HTTP.get("https://opendart.fss.or.kr/api/list.json",
                 params={"crtfc_key": key, "corp_code": kr_stock.corp_code(code), "pblntf_ty": "I", "page_count": 100,
                         "bgn_de": (end - pd.Timedelta(days=days)).strftime("%Y%m%d"), "end_de": end.strftime("%Y%m%d")}).json()
    hit = next((r for r in j.get("list", []) if "잠정" in r.get("report_nm", "") and "실적" in r.get("report_nm", "")), None)
    return {"date": f"{hit['rcept_dt'][:4]}-{hit['rcept_dt'][4:6]}-{hit['rcept_dt'][6:]}", "name": hit["report_nm"].strip(),
            "rcept_no": hit["rcept_no"], "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={hit['rcept_no']}"} if hit else None


UNIT = {"원": 1e-8, "천원": 1e-5, "백만원": 1e-2, "억원": 1}


def parse_prelim(t, k):
    """잠정실적 공시 본문(칸을 | 로 나눈 글자)에서 분기 k('202609')의 '당해실적' 매출·영업이익·순이익 → 억원.
    공시의 당기실적 기간이 그 분기가 아니면 None."""
    import re
    m = re.search(r"당기실적[\s|]*\d{4}\D\d{2}\D\d{2}[\s|~]*(\d{4})\D(\d{2})\D(\d{2})", t)
    q = re.search(r"(\d{2})년 (\d)분기", t)  # 기간 칸이 없으면 첫 '(26년 3분기)' = 당기실적 머리글
    if (m and "-".join(m.groups()) != _qend(k)) or (not m and not (q and q.groups() == (k[2:4], str(int(k[4:]) // 3)))):
        return None
    u = re.search(r"단위\s*:\s*(천원|백만원|억원|원)", t)
    out = {}
    for f, lab in (("sales", r"매출액(?:\([^)]*\))?"), ("op", r"영업이익(?:\([^)]*\))?"), ("ni", r"당기순이익(?:\([^)]*\))?")):
        v = re.search(lab + r"[\s|]*당해실적[\s|]*([△-]?\(?[\d,]+\)?)", t)
        if v:
            s = v.group(1)
            x = float(re.sub(r"[^\d]", "", s)) * UNIT[u.group(1) if u else "억원"]
            out[f] = round(-x if s[0] in "△-(" else x)
    return out if out.get("sales") is not None else None


def _prelim(filing, k):
    import io
    import re
    import zipfile
    import kr_stock
    r = HTTP.get("https://opendart.fss.or.kr/api/document.xml", params={"crtfc_key": kr_stock.dart_key(), "rcept_no": filing["rcept_no"]})
    z = zipfile.ZipFile(io.BytesIO(r.content))
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " | ", z.read(z.namelist()[0]).decode("utf-8", "ignore")))
    return parse_prelim(t, k)


def _pct(a, b):
    return (a / b - 1) * 100 if a is not None and b and b > 0 else None


def label(k):
    """'202609' → '26.3Q'"""
    return f"{k[2:4]}.{int(k[4:]) // 3}Q"


def points(qs, est):
    """한 줄 포인트: 최근 N개 분기 최대, 영업이익률 변화, 이익 엇갈림, 예상 대비."""
    cur, prev = qs[-1], qs[-2] if len(qs) > 1 else None
    out, n = [], len(qs)
    tops = [nm for f, nm in (("sales", "매출"), ("op", "영업이익"), ("ni", "순이익"), ("eps", "EPS"))
            if cur.get(f) is not None and all(cur[f] >= (q.get(f) if q.get(f) is not None else -1e18) for q in qs)]
    if tops and n >= 3:
        out.append(f"{'·'.join(tops)} 최근 {n}개 분기 최대")
    opm = lambda q: q["op"] / q["sales"] * 100 if q.get("op") is not None and q.get("sales") else None  # noqa: E731
    if opm(cur) is not None and prev and opm(prev) is not None:
        best = all(opm(cur) >= (opm(q) if opm(q) is not None else -1e9) for q in qs)
        out.append(f"영업이익률 {opm(cur):.1f}% (직전 {opm(prev):.1f}%{f', {n}개 분기 최대' if best and n >= 3 else ''})")
    if prev:
        so, oo, no = _pct(cur.get("sales"), prev.get("sales")), _pct(cur.get("op"), prev.get("op")), _pct(cur.get("ni"), prev.get("ni"))
        if oo is not None and no is not None and oo > 0 > no:
            out.append(f"영업이익 증가(QoQ {oo:+.1f}%)에도 순이익 감소(QoQ {no:+.1f}%)")
        elif so is not None and oo is not None and so > 0 and oo > 0:
            out.append(f"매출·영업이익 동반 성장(QoQ {so:+.1f}% · {oo:+.1f}%)")
        elif so is not None and oo is not None and so < 0 and oo < 0:
            out.append(f"매출·영업이익 동반 감소(QoQ {so:+.1f}% · {oo:+.1f}%)")
    s = _pct(cur.get("op"), (est or {}).get("op"))
    if s is not None and abs(s) >= 10:
        out.append(f"영업이익 예상 {'상회' if s > 0 else '하회'} ({s:+.1f}%)")
    return out


def collect(code):
    today = now_kst().strftime("%Y-%m-%d")
    first = code not in HIST  # 처음 모으는 날은 '새 실적' 표시를 하지 않음
    cons, hist = CONS.setdefault(code, {}), HIST.setdefault(code, {})
    for k, (is_est, d) in _naver(code).items():
        if is_est:
            if any(v is not None for v in d.values()):
                cons[k] = {**d, "date": today}  # 발표 전까지 계속 최신 컨센서스로 덮어씀
        elif d.get("sales") is not None:
            hist[k] = {**d, "seen": (hist.get(k) or {}).get("seen", "" if first else today)}  # 실적이 처음 보인 날
    try:
        filing = _filing(code)
    except Exception:  # noqa: BLE001
        filing = None
    # 잠정실적 공시는 났는데 네이버 숫자가 아직 컨센서스면, 공시 표의 숫자로 먼저 채운다 (네이버가 바뀌면 덮어씀)
    nxt = sorted(k for k in cons if k > max(hist, default=""))
    if filing and nxt and filing["date"] > _qend(nxt[0]):
        try:
            p = _prelim(filing, nxt[0])
            if p:
                hist[nxt[0]] = {"eps": None, **p, "prelim": True, "seen": (hist.get(nxt[0]) or {}).get("seen", today)}
        except Exception:  # noqa: BLE001 - 못 읽으면 '반영 대기'로 남김
            pass
    keys = sorted(hist)[-8:]
    if len(keys) < 2:
        return None
    qs = [{**{f: hist[k].get(f) for f in ROWS}, "q": label(k), "prelim": hist[k].get("prelim")} for k in keys]
    last = keys[-1]
    est = {f: v for f, v in (cons.get(last) or {}).items() if f in ROWS} or None
    yk = f"{int(last[:4]) - 1}{last[4:]}"
    cur, prev, yago = hist[last], hist[keys[-2]], hist.get(yk)
    rows = []
    for f, nm in (("sales", "매출액"), ("op", "영업이익"), ("ni", "순이익")):
        rows.append({"item": nm, "act": cur.get(f), "est": (est or {}).get(f), "vs_est": _pct(cur.get(f), (est or {}).get(f)),
                     "qoq": _pct(cur.get(f), prev.get(f)), "yoy": _pct(cur.get(f), (yago or {}).get(f))})
    nxt = sorted(k for k in cons if k > last)
    # 잠정실적 공시는 났는데 공시 숫자도 못 읽었고 네이버 숫자도 아직 컨센서스면 '반영 대기'
    waiting = bool(filing and nxt and filing["date"] > _qend(nxt[0]))
    return {"latest": label(last), "prelim": hist[last].get("prelim"), "seen": hist[last].get("seen"), "rows": rows, "est_date": (cons.get(last) or {}).get("date"), "quarters": qs,
            "est_bar": est, "points": points(qs, est), "filing": filing, "waiting": waiting,
            "next": {"q": label(nxt[0]), **{f: cons[nxt[0]].get(f) for f in ROWS}, "date": cons[nxt[0]].get("date")} if nxt else None}


def _qend(k):
    """분기 마지막 날 'YYYY-MM-DD' (이 날 이후 공시면 그 분기 실적 공시가 아니라 다음 분기)."""
    return (pd.Timestamp(f"{k[:4]}-{k[4:]}-01") + pd.offsets.MonthEnd(0)).strftime("%Y-%m-%d")


if __name__ == "__main__":  # 잠정실적 표 읽기 점검 (HD현대중공업 26년 3분기 공시 모양)
    t = ("당기실적 | 2026-07-01 | ~ | 2026-09-30 | 1. 실적내용 | 단위 : 억원, % | (26년 3분기) | "
         "매출액 | 당해실적 | 57,325 | 63,136 | -9.2 | 누계실적 | 179,453 | 영업이익 | | 당해실적 | | 8,917 | 10,357 | "
         "당기순이익 | 당해실적 | △1,234 | 8,179")
    assert parse_prelim(t, "202609") == {"sales": 57325, "op": 8917, "ni": -1234}, parse_prelim(t, "202609")
    assert parse_prelim(t.replace("단위 : 억원", "단위 : 백만원"), "202609")["sales"] == 573
    assert parse_prelim(t, "202606") is None and parse_prelim(t.replace("당기실적 | 2026-07-01 | ~ | 2026-09-30 | ", ""), "202609")
    print("ok")
