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


def _filing(code, days=45):  # 삼성전자처럼 분기 끝 1주 뒤(10월 8일) 잠정실적을 내는 회사도 확정 실적 전까지 잡히게
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
    cands = [r for r in j.get("list", []) if "잠정" in r.get("report_nm", "") and "실적" in r.get("report_nm", "")]
    # 같은 날 연결·별도 두 공시를 내는 회사(대한항공 등)는 연결 쪽 (컨센서스·네이버 숫자가 연결 기준)
    same = [r for r in cands if cands and r["rcept_dt"] == cands[0]["rcept_dt"]]
    hit = next((r for r in same if "연결" in r["report_nm"]), cands[0] if cands else None)
    return {"date": f"{hit['rcept_dt'][:4]}-{hit['rcept_dt'][4:6]}-{hit['rcept_dt'][6:]}", "name": hit["report_nm"].strip(),
            "rcept_no": hit["rcept_no"], "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={hit['rcept_no']}"} if hit else None


UNIT = {"원": 1e-8, "천원": 1e-5, "백만원": 1e-2, "억원": 1, "조원": 1e4}  # 삼성전자는 '조원' (195.3 처럼 소수)


def parse_prelim(t, k):
    """잠정실적 공시 본문(칸을 | 로 나눈 글자)에서 분기 k('202609')의 '당해실적' 매출·영업이익·순이익 → 억원.
    공시의 당기실적 기간이 그 분기가 아니면 None."""
    import re
    m = re.search(r"당기실적[\s|]*\d{4}\D\d{2}\D\d{2}[\s|~]*(\d{4})\D(\d{2})\D(\d{2})", t)
    q = re.search(r"(\d{2})년 (\d)분기", t)  # 기간 칸이 없으면 첫 '(26년 3분기)' = 당기실적 머리글
    if (m and "-".join(m.groups()) != _qend(k)) or (not m and not (q and q.groups() == (k[2:4], str(int(k[4:]) // 3)))):
        return None
    u = re.search(r"단위\s*:\s*(조원|천원|백만원|억원|원)", t)
    out, prev = {}, {}
    num_ = lambda s: (lambda x: round(-x if s[0] in "△-(" else x))(float(re.sub(r"[^\d.]", "", s)) * UNIT[u.group(1) if u else "억원"])  # noqa: E731
    N = r"([△-]?\(?[\d,]+(?:\.\d+)?\)?)"  # 숫자 칸 (조원은 소수점 있음)
    for f, lab in (("sales", r"매출액(?:\([^)]*\))?"), ("op", r"영업이익(?:\([^)]*\))?"), ("ni", r"당기순이익(?:\([^)]*\))?")):
        v = re.search(lab + r"[\s|]*당해실적[\s|]*" + N + r"(?:[\s|]+" + N + ")?", t)
        if v:
            out[f] = num_(v.group(1))
            if v.group(2):
                prev[f] = num_(v.group(2))  # 같은 표의 '전기실적' (기준 확인용)
    return {**out, "prev": prev} if out.get("sales") is not None else None


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
    # 잠정 숫자는 네이버가 확정 숫자로 바꿀 때까지 매번 다시 읽음 (정정 공시·연결 공시도 반영)
    base = max((k for k, v in hist.items() if not v.get("prelim")), default="")
    nxt = sorted(k for k in cons if k > base)
    if filing and nxt and filing["date"] > _qend(nxt[0]):
        try:
            p = _prelim(filing, nxt[0])
            pq = (hist.get(_prev_q(nxt[0])) or {}).get("sales")
            # 공시 표의 '전기실적'이 네이버 직전 분기와 5% 넘게 다르면 기준이 다른 공시(연결 회사의 별도 공시 등) → 안 씀
            if p and pq and p["prev"].get("sales") and abs(p["prev"]["sales"] / pq - 1) > 0.05:
                p = None
            # 단위를 잘못 읽은 경우 막기: 매출이 컨센서스의 절반 아래·2배 위거나 직전 분기의 1/3 아래면 안 씀 (삼성전자 '조원' 사고)
            est = (cons.get(nxt[0]) or {}).get("sales")
            if p and (not p.get("sales") or (est and not 0.5 < p["sales"] / est < 2) or (pq and p["sales"] < pq / 3)):
                p = None
            if p:
                p.pop("prev", None)
                hist[nxt[0]] = {"eps": None, **p, "prelim": True, "seen": (hist.get(nxt[0]) or {}).get("seen", today)}
            elif (hist.get(nxt[0]) or {}).get("prelim"):
                del hist[nxt[0]]  # 예전에 잘못 넣은 잠정 숫자 지움
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
    # 발표일: 이 분기의 잠정실적 공시일 (공시를 안 내는 회사는 우리가 처음 본 날)
    ann = filing["date"] if (filing and not waiting and filing["date"] > _qend(last)) else hist[last].get("seen")
    return {"latest": label(last), "prelim": hist[last].get("prelim"), "seen": hist[last].get("seen"), "date": ann, "rows": rows, "est_date": (cons.get(last) or {}).get("date"), "quarters": qs,
            "est_bar": est, "points": points(qs, est), "filing": filing, "waiting": waiting,
            "next": {"q": label(nxt[0]), **{f: cons[nxt[0]].get(f) for f in ROWS}, "date": cons[nxt[0]].get("date")} if nxt else None}


def _prev_q(k):
    """'202609' → '202606', '202603' → '202512'"""
    y, m = int(k[:4]), int(k[4:])
    return f"{y - 1}12" if m <= 3 else f"{y}{m - 3:02d}"


def _qlabel(end):
    """'2026-07-27' → '26.7월', '2026-09-30' → '26.3Q' (화면의 qLabel 과 같게)"""
    m = int(end[5:7])
    return f"{end[2:4]}.{m // 3}Q" if m % 3 == 0 else f"{end[2:4]}.{m}월"


def collect_us(tkr, qtrs, hist):
    """미국: 야후 실적발표 표(조정 EPS 예상 vs 발표) + 분기 재무제표(매출·영업이익, qtrs) + 발표 전 매출 예상(저장해 둠).
    한국 collect() 와 같은 모양으로 돌려줘서 화면을 같이 쓴다 (cur = USD)."""
    import yfinance as yf
    if not qtrs:
        return None
    tk = yf.Ticker(tkr)
    ed = tk.get_earnings_dates(limit=16)
    if ed is None or ed.empty:
        return None
    today, key = now_kst().strftime("%Y-%m-%d"), "US:" + tkr
    first = key not in HIST
    cons, seen = CONS.setdefault(key, {}), HIST.setdefault(key, {})
    ends = sorted(qtrs)
    f_ = lambda v: None if v != v else float(v)  # noqa: E731 (NaN → None)
    rep = [(dt.strftime("%Y-%m-%d"), f_(r["Reported EPS"]), f_(r["EPS Estimate"])) for dt, r in ed.sort_index().iterrows()]
    eps = {}
    for d, a, e in (x for x in rep if x[1] is not None):
        # 발표일 10~75일 전에 끝난 분기 = 그 발표가 다룬 분기. 재무제표가 아직 안 들어온 새 분기면 마지막 분기 + 91일
        q = next((x for x in reversed(ends) if 10 <= (pd.Timestamp(d) - pd.Timestamp(x)).days <= 75), None)
        if q is None and d > ends[-1]:
            q = (pd.Timestamp(ends[-1]) + pd.Timedelta(days=91)).strftime("%Y-%m-%d")
        if q and q < d:
            eps[q] = {"eps": a, "est": e, "date": d}
    keys = sorted(set(ends) | set(eps))[-8:]
    last = max(eps) if eps else keys[-1]
    keys = [k for k in keys if k <= last]
    seen.setdefault(last, {"seen": "" if first else today})
    lab, nxt_end = _qlabel(last), (pd.Timestamp(last) + pd.Timedelta(days=91)).strftime("%Y-%m-%d")
    up = next((x for x in rep if x[1] is None and x[0] >= today), None)
    try:  # 다음 분기(아직 발표 전) 매출 예상을 저장 → 발표되면 '예상 대비'
        rv = tk.revenue_estimate
        if up is not None and rv is not None and "0q" in rv.index:
            cons[_qlabel(nxt_end)] = {"sales": f_(rv.loc["0q", "avg"]), "eps": up[2], "date": today}
    except Exception:  # noqa: BLE001
        pass
    val = lambda k, f: None if k is None else (eps.get(k) or {}).get("eps") if f == "eps" else (qtrs.get(k) or {}).get("rev" if f == "sales" else f)  # noqa: E731
    prev = keys[-2] if len(keys) > 1 else None
    yago = next((k for k in keys if 330 <= (pd.Timestamp(last) - pd.Timestamp(k)).days <= 400), None)
    est = {"eps": (eps.get(last) or {}).get("est"), "sales": (cons.get(lab) or {}).get("sales")}
    rows = [{"item": nm, "f": f, "act": val(last, f), "est": est.get(f), "vs_est": _pct(val(last, f), est.get(f)),
             "qoq": _pct(val(last, f), val(prev, f)), "yoy": _pct(val(last, f), val(yago, f))}
            for f, nm in (("eps", "EPS"), ("sales", "매출액"), ("op", "영업이익"))]
    qs = [{"q": _qlabel(k), **{f: val(k, f) for f in ("sales", "op", "eps")}, "ni": (qtrs.get(k) or {}).get("ni")} for k in keys]
    annual = [{"q": f"{str(y)[2:]}{'E' if r.get('estimate') else ''}", "est": bool(r.get("estimate")), "eps": r.get("eps")}
              for y, r in sorted((hist or {}).items()) if isinstance(r, dict) and r.get("eps") is not None][-8:]
    return {"cur": "USD", "latest": lab, "prelim": None, "seen": seen[last]["seen"], "date": (eps.get(last) or {}).get("date") or seen[last]["seen"], "rows": rows, "quarters": qs, "est_bar": est,
            "est_date": (cons.get(lab) or {}).get("date"), "points": [], "waiting": False, "annual": annual,
            "filing": {"date": (eps.get(last) or {}).get("date"), "name": "실적발표 (야후)", "url": f"https://finance.yahoo.com/quote/{tkr}/"},
            "next": {"q": _qlabel(nxt_end), "eps": up[2], "sales": (cons.get(_qlabel(nxt_end)) or {}).get("sales"), "date": up[0]} if up else None}


def _qend(k):
    """분기 마지막 날 'YYYY-MM-DD' (이 날 이후 공시면 그 분기 실적 공시가 아니라 다음 분기)."""
    return (pd.Timestamp(f"{k[:4]}-{k[4:]}-01") + pd.offsets.MonthEnd(0)).strftime("%Y-%m-%d")


if __name__ == "__main__":  # 잠정실적 표 읽기 점검 (HD현대중공업 26년 3분기 공시 모양)
    t = ("당기실적 | 2026-07-01 | ~ | 2026-09-30 | 1. 실적내용 | 단위 : 억원, % | (26년 3분기) | "
         "매출액 | 당해실적 | 57,325 | 63,136 | -9.2 | 누계실적 | 179,453 | 영업이익 | | 당해실적 | | 8,917 | 10,357 | "
         "당기순이익 | 당해실적 | △1,234 | 8,179")
    assert parse_prelim(t, "202609") == {"sales": 57325, "op": 8917, "ni": -1234,
                                         "prev": {"sales": 63136, "op": 10357, "ni": 8179}}, parse_prelim(t, "202609")
    assert _prev_q("202609") == "202606" and _prev_q("202603") == "202512"
    assert parse_prelim(t.replace("단위 : 억원", "단위 : 백만원"), "202609")["sales"] == 573
    tj = t.replace("단위 : 억원", "단위 : 조원").replace("57,325 | 63,136", "195.3 | 171.5").replace("8,917 | 10,357", "107.4 | 89.5")
    assert parse_prelim(tj, "202609")["sales"] == 1953000 and parse_prelim(tj, "202609")["op"] == 1074000  # 삼성전자 '조원'
    assert parse_prelim(t, "202606") is None and parse_prelim(t.replace("당기실적 | 2026-07-01 | ~ | 2026-09-30 | ", ""), "202609")
    print("ok")
