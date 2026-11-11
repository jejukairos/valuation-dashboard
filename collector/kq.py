"""최신 분기 실적(잠정) vs 컨센서스 — 한국 종목.
네이버 분기 실적(5분기 실적 + 다음 분기 컨센서스)을 매 갱신마다 받아, 컨센서스는 발표 전 값을 저장해 두고
실적으로 바뀌는 순간 '예상 대비'를 계산한다. 분기 실적은 쌓아서 8분기까지 보여준다. DART 잠정실적 공시가 있으면 링크."""
import functools
import re

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
    # 최신 공시부터, 같은 날 연결·별도 두 공시를 내는 회사(대한항공 등)는 연결 쪽 먼저 (컨센서스·네이버 숫자가 연결 기준)
    # 전부 돌려줌: 기아·현대차는 '월별 판매실적'도 같은 제목(영업(잠정)실적)이라, 분기 표가 읽히는 공시를 골라야 함 (11/11)
    cands.sort(key=lambda r: (r["rcept_dt"], "연결" in r["report_nm"]), reverse=True)
    return [{"date": f"{r['rcept_dt'][:4]}-{r['rcept_dt'][4:6]}-{r['rcept_dt'][6:]}", "name": r["report_nm"].strip(),
             "rcept_no": r["rcept_no"], "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={r['rcept_no']}"} for r in cands]


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


@functools.lru_cache(maxsize=None)
def _texts(rcept_no):
    """공시 본문 글자들 (칸은 | ) — '[첨부추가]' 공시는 첫 파일이 첨부일 수 있어서 전부 (LG에너지솔루션 11/3)."""
    import io
    import re
    import zipfile
    import kr_stock
    r = HTTP.get("https://opendart.fss.or.kr/api/document.xml", params={"crtfc_key": kr_stock.dart_key(), "rcept_no": rcept_no})
    z = zipfile.ZipFile(io.BytesIO(r.content))
    return tuple(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " | ", z.read(nm).decode("utf-8", "ignore"))) for nm in z.namelist())


def match(fl, k, texts=None, loose=False):
    """공시들(최신부터) 중 분기 k 잠정실적 표가 읽히는 첫 공시 → (공시, 숫자).
    없으면 (None, None) — loose 면 '당해실적' 표는 있는데 못 읽은 공시라도 (공시, None) ('반영 대기' 안내용).
    월별 판매실적(기아·현대차, 제목은 똑같이 '영업(잠정)실적')은 표가 없어서 건너뜀."""
    tbl = None
    for f in fl:
        if f["date"] <= _qend(k):
            continue
        try:
            ts = (texts or _texts)(f["rcept_no"])
        except Exception:  # noqa: BLE001 - 본문을 못 받으면 다음 공시
            continue
        p = next((x for x in map(lambda t: parse_prelim(t, k), ts) if x), None)
        if p:
            return f, {**p}
        if tbl is None and any("당해실적" in t for t in ts):
            tbl = f
    return (tbl, None) if loose else (None, None)


def _pct(a, b):
    return (a / b - 1) * 100 if a is not None and b and b > 0 else None


def label(k):
    """'202609' → '26.3Q'"""
    return f"{k[2:4]}.{int(k[4:]) // 3}Q"


def points(qs):
    """✦포인트 — 텔레그램 실적 알림(t.me/maddingStock)과 같은 규칙 (사용자 11/6, 9개 회사로 맞춰 봄):
    1줄 = 최근 5개 분기 최대인 항목 + 영업이익률(직전, 5개 분기 최대면 표시) / 2줄 = QoQ 엇갈림·동반 성장 중 하나
    (매출↓영업이익↑ > 영업이익↑순이익↓ > 매출·영업이익↑ 순서 · 둘 다 줄면 안 씀). 예상 대비는 표에 있어서 안 씀."""
    qs = qs[-5:]
    cur, prev, n = qs[-1], qs[-2] if len(qs) > 1 else None, len(qs)
    tops = [nm for f, nm in (("sales", "매출"), ("op", "영업이익"), ("ni", "순이익"), ("eps", "EPS"))
            if cur.get(f) is not None and all(cur[f] >= (q.get(f) if q.get(f) is not None else -1e18) for q in qs)]
    # 1년 전 같은 분기 영업이익 적자 → 지금 흑자면 맨 앞에 '영업이익 흑자전환' (11/11 도우인시스) · 순이익은 안 씀 (CJ CGV 25.3Q 순손실 → 흑자인데 채널에 없음)
    yo = qs[0] if n == 5 else None
    turn = yo is not None and yo.get("op") is not None and cur.get("op") is not None and yo["op"] < 0 < cur["op"]
    line = ", ".join((["영업이익 흑자전환"] if turn else []) + ([f"{'·'.join(tops)} 최근 {n}개 분기 최대"] if tops and n >= 3 else []))
    opm = lambda q: q["op"] / q["sales"] * 100 if q.get("op") is not None and q.get("sales") else None  # noqa: E731
    if opm(cur) is not None and prev and opm(prev) is not None:
        best = all(opm(cur) >= (opm(q) if opm(q) is not None else -1e9) for q in qs)
        line += f"{', ' if line else ''}영업이익률 {opm(cur):.1f}% (직전 {opm(prev):.1f}%{f', {n}개 분기 최대' if best and n >= 3 else ''})"
    out = [line] if line else []
    if prev:
        so, oo, no = _pct(cur.get("sales"), prev.get("sales")), _pct(cur.get("op"), prev.get("op")), _pct(cur.get("ni"), prev.get("ni"))
        if so is not None and oo is not None and so < 0 < oo:
            out.append(f"매출 감소(QoQ {so:+.1f}%)에도 영업이익 개선(QoQ {oo:+.1f}%)")
        elif oo is not None and no is not None and oo > 0 > no:
            out.append(f"영업이익 증가(QoQ {oo:+.1f}%)에도 순이익 감소(QoQ {no:+.1f}%)")
        elif so is not None and oo is not None and so > 0 and oo > 0:
            out.append(f"매출·영업이익 동반 성장(QoQ {so:+.1f}% · {oo:+.1f}%)")
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
        fl = _filing(code)
    except Exception:  # noqa: BLE001
        fl = []
    # 잠정실적 공시는 났는데 네이버 숫자가 아직 컨센서스면, 공시 표의 숫자로 먼저 채운다 (네이버가 바뀌면 덮어씀)
    # 잠정 숫자는 네이버가 확정 숫자로 바꿀 때까지 매번 다시 읽음 (정정 공시·연결 공시도 반영)
    base = max((k for k, v in hist.items() if not v.get("prelim")), default="")
    nxt = sorted(k for k in cons if k > base)
    wait_f = None
    if nxt:
        f, p = match(fl, nxt[0], loose=True)
        pq = (hist.get(_prev_q(nxt[0])) or {}).get("sales")
        same = bool(p and pq and p["prev"].get("sales") and abs(p["prev"]["sales"] / pq - 1) <= 0.05)
        # 공시 표의 '전기실적'이 네이버 직전 분기와 5% 넘게 다르면 기준이 다른 공시(연결 회사의 별도 공시 등) → 안 씀
        if p and pq and p["prev"].get("sales") and not same:
            p = None
        # 단위를 잘못 읽은 경우 막기: 매출이 컨센서스의 절반 아래·2배 위거나 직전 분기의 1/3 아래면 안 씀 (삼성전자 '조원' 사고)
        # 단, 표의 전기실적이 네이버 직전 분기와 맞으면(same) 단위는 맞은 것 → 진짜 큰 차이라 씀 (씨어스 26.3Q 매출 98억 = 예상 331억의 0.3배, 11/11)
        est = (cons.get(nxt[0]) or {}).get("sales")
        if p and (not p.get("sales") or (not same and ((est and not 0.5 < p["sales"] / est < 2) or (pq and p["sales"] < pq / 3)))):
            p = None
        if p:
            p.pop("prev", None)
            hist[nxt[0]] = {"eps": None, **p, "prelim": True, "seen": (hist.get(nxt[0]) or {}).get("seen", today)}
        elif f is not None:  # 실적 표 공시는 있는데 못 읽음·못 씀 → '반영 대기' + 예전에 잘못 넣은 잠정 숫자 지움
            wait_f = f
            if (hist.get(nxt[0]) or {}).get("prelim"):
                del hist[nxt[0]]
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
    # 잠정실적 표 공시는 났는데 숫자를 못 읽었고 네이버 숫자도 아직 컨센서스면 '반영 대기'
    waiting = bool(wait_f and nxt and wait_f["date"] > _qend(nxt[0]))
    # 발표일·링크: 이 분기 표가 읽히는 잠정실적 공시 (월별 판매 공시 말고) — 공시를 안 내는 회사는 우리가 처음 본 날
    filing = wait_f if waiting else match(fl, last)[0]
    ann = filing["date"] if (filing and not waiting) else hist[last].get("seen")
    return {"latest": label(last), "prelim": hist[last].get("prelim"), "seen": hist[last].get("seen"), "date": ann, "rows": rows, "est_date": (cons.get(last) or {}).get("date"), "quarters": qs,
            "est_bar": est, "points": points(qs), "filing": filing, "waiting": waiting,
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
            for f, nm in (("sales", "매출액"), ("op", "영업이익"), ("eps", "EPS"))]  # 한국과 같은 순서
    qs = [{"q": _qlabel(k), **{f: val(k, f) for f in ("sales", "op", "eps")}, "ni": (qtrs.get(k) or {}).get("ni")} for k in keys]
    annual = [{"q": f"{str(y)[2:]}{'E' if r.get('estimate') else ''}", "est": bool(r.get("estimate")), "eps": r.get("eps")}
              for y, r in sorted((hist or {}).items()) if isinstance(r, dict) and r.get("eps") is not None][-8:]
    return {"cur": "USD", "latest": lab, "prelim": None, "seen": seen[last]["seen"], "date": (eps.get(last) or {}).get("date") or seen[last]["seen"], "rows": rows, "quarters": qs, "est_bar": est,
            "est_date": (cons.get(lab) or {}).get("date"), "points": points(qs), "waiting": False, "annual": annual,
            "filing": {"date": (eps.get(last) or {}).get("date"), "name": "실적발표 (야후)", "url": f"https://finance.yahoo.com/quote/{tkr}/"},
            "next": {"q": _qlabel(nxt_end), "eps": up[2], "sales": (cons.get(_qlabel(nxt_end)) or {}).get("sales"), "date": up[0]} if up else None}


SUM_U = {"KR": {"억원": 1, "조": 1e4, "조원": 1e4, "백만원": 0.01}, "US": {"백만$": 1e6, "$M": 1e6, "$B": 1e9, "억$": 1e8}}
SUM_K = (("sales", r"(?:총)?매출(?:액)?"), ("op", r"(?:GAAP )?영업이익"), ("ni", r"(?:GAAP |지배 ?)?(?:당기)?순이익"))


def from_summary(ent, mkt):
    """실적 정리(config/earnings.yaml 한 분기 — PC 작업이 회사 발표로 씀)의 vs 표 → {q:'26.3Q', date, sales, op, ni} (한국 억원·미국 달러)."""
    m = re.fullmatch(r"([1-4])Q(\d\d)", str((ent or {}).get("quarter") or ""))
    U = SUM_U.get(mkt) or {}
    if not m:
        return None
    vs = [x for x in ent.get("vs") or [] if isinstance(x, dict) and type(x.get("a")) in (int, float)]
    key = lambda x: re.sub(r"\s*\(.*\)$", "", str(x.get("k") or "").strip())  # noqa: E731 - '매출 (AMPC 포함, 새 기준)' → '매출'
    out = {"q": f"{m[2]}.{m[1]}Q", "date": str(ent.get("date") or "")}
    for f, pat in SUM_K:
        r = next((x for x in vs if re.fullmatch(pat, key(x)) and x.get("u") in U), None)
        if r:
            out[f] = r["a"] * U[r["u"]]
    r = next((x for x in vs if re.fullmatch(r"(?:GAAP )?영업이익률", key(x)) and x.get("u") == "%"), None)
    if "op" not in out and out.get("sales") and r:  # 코어위브처럼 영업이익률만 적은 경우 (반올림이라 ±0.05%p)
        out["op"] = out["sales"] * r["a"] / 100
    return out if out.get("sales") else None


def fill(kqd, ents, mkt):
    """야후·네이버·DART 가 아직 안 준 최신 분기 숫자를 실적 정리(회사 발표) 숫자로 먼저 채움 → 그래프·표가 그 분기까지.
    사용자 11/11 "코어위브 실적 다 들어갔는데 그래프는 왜 아직 2Q26?" — 야후 재무제표는 발표 며칠 뒤, 네이버는 잠정 공시를 늦게 넣음.
    자동 숫자가 들어오면 그쪽이 먼저라 이 칸은 저절로 안 씀. 다음 분기(예상만 있던 칸)이거나 마지막 분기의 빈 칸만 채움."""
    if not kqd:
        return kqd
    qs = [dict(q) for q in kqd.get("quarters") or []]
    nx, k = kqd.get("next") or {}, dict(kqd)
    want = {qs[-1]["q"] if qs else None, nx.get("q")} - {None}
    s = next((x for x in map(lambda e: from_summary(e, mkt), ents if isinstance(ents, list) else [ents]) if x and x["q"] in want), None)
    if not s:
        return kqd
    if qs and qs[-1]["q"] == s["q"]:
        cur = qs[-1]
    else:  # 예상만 있던 다음 분기 → 실적
        cur = {"q": s["q"], "sales": None, "op": None, "ni": None, "eps": None}
        qs = (qs + [cur])[-8:]
        k.update(latest=s["q"], prelim=True, est_bar={f: nx.get(f) for f in ROWS if nx.get(f) is not None} or None, est_date=nx.get("date"),
                 next=None, waiting=False, filing=None, date=s["date"] or k.get("date"), seen=s["date"] or k.get("seen"))
        k["rows"] = [{**r, "est": (k["est_bar"] or {}).get(r.get("f") or {"매출액": "sales", "영업이익": "op", "순이익": "ni"}.get(r["item"]))} for r in k.get("rows") or []]
    got = [f for f in ("sales", "op", "ni") if cur.get(f) is None and s.get(f) is not None]
    prev = qs[-2] if len(qs) > 1 else {}
    if not got or (prev.get("sales") and not 0.2 < s["sales"] / prev["sales"] < 5):  # 단위를 잘못 적은 글(억원↔백만원 등)은 안 씀
        return kqd
    cur.update({f: s[f] for f in got}, prelim=True)
    yago = next((q for q in qs if q["q"] == f"{int(s['q'][:2]) - 1:02d}{s['q'][2:]}"), {})
    rows = []
    for r in k.get("rows") or []:
        f = r.get("f") or {"매출액": "sales", "영업이익": "op", "순이익": "ni"}.get(r["item"])
        a = cur.get(f)
        rows.append({**r, "act": a, "vs_est": _pct(a, r.get("est")), "qoq": _pct(a, prev.get(f)), "yoy": _pct(a, yago.get(f))})
    k.update(rows=rows, quarters=qs, points=points(qs), fill={"date": s["date"], "f": got})
    return k


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
    # ✦포인트: 텔레그램 실적 알림 9곳 (26.3Q, 25.3Q~26.3Q 매출·영업이익·순이익·EPS) — 채널은 소수점 아래 숫자로 계산해 0.1%p 다를 수 있어 숫자는 가리고 비교
    import re
    tg = {"카카오": ([(6384, 1005, 651, 147), (7261, 1279, 718, 162), (7009, 1193, 1644, 371), (7139, 1262, 3184, 719), (7029, 1178, 1004, 226)],
                   ["영업이익률 16.8% (직전 17.7%)"]),
          "KG파이낸셜": ([(608, 102, 78, 202), (555, 78, 43, 122), (625, 70, 40, 108), (622, 88, 67, 174), (711, 104, 81, 223)],
                      ["매출·영업이익·순이익·EPS 최근 5개 분기 최대, 영업이익률 14.6% (직전 14.1%)", "매출·영업이익 동반 성장(QoQ +14.3% · +18.5%)"]),
          "에스케이바이오팜": ([(1917, 701, 714, 946), (1944, 463, 1327, 1744), (2279, 898, 1027, 1342), (2474, 971, 851, 1086), (2584, 1163, 543, 693)],
                       ["매출·영업이익 최근 5개 분기 최대, 영업이익률 45.0% (직전 39.2%, 5개 분기 최대)", "영업이익 증가(QoQ +19.8%)에도 순이익 감소(QoQ -36.1%)"]),
          "아이쓰리시스템": ([(324, 42, 33, 469), (285, 38, 52, 719), (324, 44, 49, 669), (395, 48, 38, 524), (424, 59, 44, 602)],
                      ["매출·영업이익 최근 5개 분기 최대, 영업이익률 13.9% (직전 12.2%, 5개 분기 최대)", "매출·영업이익 동반 성장(QoQ +7.5% · +23.5%)"]),
          "덕산네오룩스": ([(983, 175, 141, 541), (1271, 231, 227, 898), (729, 171, 168, 648), (946, 185, 199, 783), (1068, 240, 121, 487)],
                     ["영업이익 최근 5개 분기 최대, 영업이익률 22.5% (직전 19.6%)", "영업이익 증가(QoQ +29.5%)에도 순이익 감소(QoQ -39.6%)"]),
          "에코프로에이치엔": ([(284, 23, 25, 119), (392, 23, 36, 173), (347, 50, 45, 215), (515, 58, 51, 241), (528, 113, 122, 581)],
                       ["매출·영업이익·순이익·EPS 최근 5개 분기 최대, 영업이익률 21.4% (직전 11.3%, 5개 분기 최대)", "매출·영업이익 동반 성장(QoQ +2.5% · +96.9%)"]),
          "인바디": ([(598, 98, 94, 715), (624, 95, 64, 475), (684, 130, 163, 1211), (733, 177, 145, 1050), (713, 193, 44, 326)],
                   ["영업이익 최근 5개 분기 최대, 영업이익률 27.1% (직전 24.1%, 5개 분기 최대)", "매출 감소(QoQ -2.7%)에도 영업이익 개선(QoQ +8.9%)"]),
          "HDC": ([(18221, 1962, 1169, 1229), (13782, 1315, 924, 1614), (12574, 1803, 1072, 1148), (15197, 2284, 2568, 3385), (17106, 2800, 1822, 3234)],
                  ["영업이익 최근 5개 분기 최대, 영업이익률 16.4% (직전 15.0%, 5개 분기 최대)", "영업이익 증가(QoQ +22.6%)에도 순이익 감소(QoQ -29.1%)"]),
          "티엘비": ([(689, 87, 65, 304), (726, 86, 70, 330), (758, 107, 85, 396), (882, 128, 108, 503), (940, 166, 117, 493)],
                   ["매출·영업이익·순이익 최근 5개 분기 최대, 영업이익률 17.7% (직전 14.5%, 5개 분기 최대)", "매출·영업이익 동반 성장(QoQ +6.5% · +29.9%)"]),
          # 사용자 11/6 "실적발표 후 포인트 어떻게 잡는지 학습하라고" — 적자 분기(순이익·EPS 음수)가 섞여도 '최대'를 맞게 잡는지
          "CJ CGV": ([(5831, 233, -287, -181), (6671, 680, -384, -242), (5734, 87, -254, -243), (5940, 115, 226, 166), (6881, 736, 372, 224)],
                     ["매출·영업이익·순이익·EPS 최근 5개 분기 최대, 영업이익률 10.7% (직전 1.9%, 5개 분기 최대)", "매출·영업이익 동반 성장(QoQ +15.9% · +541.6%)"]),
          # 사용자 11/11 "실적발표 포인트들 학습해줘" — 5곳 (영업이익 1년 전 적자 → 흑자전환 · 영업이익률이 직전보다 낮으면 '최대' 없음 · 매출↑영업이익↓ 은 2줄 없음)
          "티에프이": ([(272, 48, 46, 409), (374, 73, 73, 612), (323, 33, 34, 288), (336, 61, 60, 482), (542, 150, 102, 825)],
                   ["매출·영업이익·순이익·EPS 최근 5개 분기 최대, 영업이익률 27.7% (직전 18.2%, 5개 분기 최대)", "매출·영업이익 동반 성장(QoQ +61.3% · +147.4%)"]),
          "에프엔에스테크": ([(172, 32, 33, 344), (135, 15, 9, 87), (130, 35, 32, 311), (140, 38, 35, 346), (212, 62, 57, 688)],
                      ["매출·영업이익·순이익·EPS 최근 5개 분기 최대, 영업이익률 29.2% (직전 27.1%, 5개 분기 최대)", "매출·영업이익 동반 성장(QoQ +51.5% · +64.8%)"]),
          "예스티": ([(187, 11, 2, 29), (195, -24, 33, 47), (275, 31, 32, 133), (420, 46, 19, 82), (438, 110, 83, 382)],
                   ["매출·영업이익·순이익·EPS 최근 5개 분기 최대, 영업이익률 25.1% (직전 11.0%, 5개 분기 최대)", "매출·영업이익 동반 성장(QoQ +4.3% · +140.8%)"]),
          "도우인시스": ([(298, -21, 15, 146), (402, 38, 75, 693), (268, 18, 57, 524), (589, 82, 98, 896), (679, 134, 18, 160)],
                    ["영업이익 흑자전환, 매출·영업이익 최근 5개 분기 최대, 영업이익률 19.7% (직전 13.9%, 5개 분기 최대)", "영업이익 증가(QoQ +63.9%)에도 순이익 감소(QoQ -82.1%)"]),
          "일진전기": ([(4502, 353, 276, 578), (6142, 442, 272, 570), (5061, 508, 359, 753), (6374, 720, 499, 1047), (6376, 700, 514, 1078)],
                   ["매출·순이익·EPS 최근 5개 분기 최대, 영업이익률 11.0% (직전 11.3%)"])}
    mask = lambda s: re.sub(r"[+-]?\d+(?:\.\d+)?", "#", s)  # noqa: E731
    for nm, (rows, want) in tg.items():
        got = points([dict(zip(("sales", "op", "ni", "eps"), r)) for r in [(1, 1, 1, 1)] * 3 + rows])  # 앞 3분기는 5개 분기 밖
        assert [mask(x) for x in got] == [mask(x) for x in want], (nm, got)
    # 공시 고르기: 기아 11/2 '월별 판매실적'(표 없음)은 건너뛰고 10/30 분기 공시를 씀 · 표는 있는데 못 읽으면 loose 일 때만
    fl = [{"date": "2026-11-02", "rcept_no": "m"}, {"date": "2026-10-30", "rcept_no": "q"}, {"date": "2026-08-01", "rcept_no": "old"}]
    docs = {"m": ("기아 2026년 10월 판매실적 | 첨부",), "q": ("첨부 목록", t), "old": (t,)}
    assert match(fl, "202609", docs.get) == (fl[1], parse_prelim(t, "202609"))
    assert match(fl, "202606", docs.get) == (None, None) and match(fl, "202606", docs.get, loose=True) == (fl[1], None)
    assert match(fl[:1], "202609", docs.get, loose=True) == (None, None)
    # 실적 정리로 채우기: 코어위브 3Q26 (야후 재무제표는 2Q26 까지, EPS 만 3Q26)
    us = {"latest": "26.3Q", "rows": [{"item": "매출액", "f": "sales", "act": None, "est": 3.54e9}, {"item": "영업이익", "f": "op", "act": None, "est": None},
                                      {"item": "EPS", "f": "eps", "act": -1.27, "est": -1.55}],
          "quarters": [{"q": "25.3Q", "sales": 1.36e9, "op": 5.2e7, "eps": -0.22}, {"q": "26.2Q", "sales": 2.575e9, "op": -4.9e7, "eps": -0.68}, {"q": "26.3Q", "sales": None, "op": None, "eps": -1.27}]}
    crwv = [{"quarter": "3Q26", "date": "2026-11-10", "vs": [{"k": "매출", "a": 3661, "u": "백만$"}, {"k": "매출총이익률", "a": 67.7, "u": "%"},
                                                            {"k": "조정 영업이익", "a": 379, "u": "백만$"}, {"k": "GAAP 영업이익률", "a": 5.7, "u": "%"}]}]
    g = fill(us, crwv, "US")
    assert g["quarters"][-1]["sales"] == 3.661e9 and round(g["quarters"][-1]["op"] / 1e6, 1) == 208.7 and g["fill"]["f"] == ["sales", "op"], g["quarters"][-1]
    assert round(g["rows"][0]["vs_est"], 1) == 3.4 and round(g["rows"][0]["yoy"]) == 169 and g["rows"][2]["act"] == -1.27 and us["quarters"][-1]["sales"] is None
    assert fill(g, crwv, "US") is g and fill(us, crwv, "KR") is us  # 이미 채움 · 단위가 시장과 다르면 안 씀
    assert fill(us, [{"quarter": "3Q26", "vs": [{"k": "매출", "a": 366100, "u": "백만$"}]}], "US") is us  # 100배 잘못 적은 글
    # 한국: 네이버는 3Q 가 아직 예상(next) → 현대차 실적 정리(조 단위)로 26.3Q 칸을 실적으로
    kr = {"latest": "26.2Q", "waiting": True, "rows": [{"item": "매출액", "act": 480000, "est": None}, {"item": "영업이익", "act": 36000, "est": None}, {"item": "순이익", "act": 30000, "est": None}],
          "quarters": [{"q": "25.3Q", "sales": 466000, "op": 25000, "ni": 25000}, {"q": "26.2Q", "sales": 480000, "op": 36000, "ni": 30000}],
          "next": {"q": "26.3Q", "sales": 450000, "op": 30000, "ni": 25000, "date": "2026-10-28"}}
    hy = [{"quarter": "3Q26", "date": "2026-10-29", "vs": [{"k": "매출", "a": 45.11, "u": "조"}, {"k": "영업이익", "a": 2.68, "u": "조"}, {"k": "영업이익률", "a": 5.9, "u": "%"}]}]
    g = fill(kr, hy, "KR")
    assert g["latest"] == "26.3Q" and not g["waiting"] and g["next"] is None and g["quarters"][-1] == {"q": "26.3Q", "sales": 451100.0, "op": 26800.0, "ni": None, "eps": None, "prelim": True}
    assert round(g["rows"][1]["vs_est"], 1) == -10.7 and g["rows"][2]["act"] is None and g["date"] == "2026-10-29"
    assert from_summary({"quarter": "3Q26", "vs": [{"k": "매출 (AMPC 포함, 새 기준)", "a": 96434, "u": "억원"}]}, "KR")["sales"] == 96434
    assert from_summary({"quarter": "3Q26", "vs": [{"k": "총매출·준비금 수익", "a": 865, "u": "백만$"}]}, "US") is None
    print("ok")
