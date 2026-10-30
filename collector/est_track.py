"""📈 이익 추정치 변화 — 컨센서스를 하루 한 번 cache/est_hist.json 에 쌓아 올라가는지·내려가는지(1일·1주·1개월·3개월) 본다.
한국 = 와이즈리포트 연간 영업이익 추정(억원), 미국 = 야후 연간 EPS 추정($). 미국은 야후가 7·30·60·90일 전 값도 줘서 첫날부터 비교돼요.
사용자가 보낸 다른 출처 숫자(블룸버그 등)는 config/est_seed.yaml 에 적으면 같은 칸에 따로 보여줘요."""
from datetime import timedelta

import yfinance as yf

from common import CACHE, load_yaml, now_kst, read_json, write_json

HIST = CACHE / "est_hist.json"
H = read_json(HIST) or {}
SPANS = (("1일", 1), ("1주", 7), ("1개월", 30), ("3개월", 91), ("6개월", 182), ("1년", 365))
YF = {"1주": "7daysAgo", "1개월": "30daysAgo", "3개월": "90daysAgo"}


def record(code, vals):
    """vals = {"27": 값, ...} — 오늘 날짜 칸을 덮어씀 (하루 여러 번 돌면 마지막 값)."""
    vals = {k: v for k, v in (vals or {}).items() if v is not None}
    if not vals:
        return
    rows = H.setdefault(code, {})
    rows[now_kst().strftime("%Y-%m-%d")] = vals
    for d in sorted(rows)[:-400]:
        del rows[d]
    write_json(HIST, H)  # shortcut: 종목마다 파일을 다시 씀 (작아서 괜찮음) — 느려지면 main 끝에서 한 번만


def _ago(rows, days, today):
    cut = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    ks = [d for d in rows if d <= cut]
    return rows[max(ks)] if ks else None


def _pct(cur, old):
    return round((cur / old - 1) * 100, 2) if cur is not None and old and old > 0 and cur > 0 else None


def us(tkr, annual):
    """야후 eps_trend: 올해·내년 EPS 지금 값 + 7·30·90일 전. 연도 = 마지막 연간 실적 다음 회계연도."""
    t = yf.Ticker(tkr).eps_trend
    y = int(max(annual)[:4]) if annual else now_kst().year - 1
    vals, trend = {}, {}
    for row, fy in (("0y", y + 1), ("+1y", y + 2)):
        if row not in t.index:
            continue
        r, k = t.loc[row], str(fy)[2:]
        vals[k] = round(float(r["current"]), 4) if r["current"] == r["current"] else None
        trend[k] = {nm: float(r[c]) for nm, c in YF.items() if c in r and r[c] == r[c]}
    return vals, trend


def view(code, unit, what, trend=None):
    rows, today = H.get(code) or {}, now_kst()
    if not rows:
        return None
    last = rows[max(rows)]
    chg = {}
    for y in sorted(last):
        ago = {}
        for nm, days in SPANS:
            old = (_ago(rows, days, today) or {}).get(y)
            if old is None and trend and nm in (trend.get(y) or {}):
                old = trend[y][nm]  # 미국: 쌓인 기록이 없으면 야후가 준 과거 값
            if old is not None:
                ago[nm] = [old, _pct(last[y], old)]
        chg[y] = {"now": last[y], "ago": ago}
    return {"unit": unit, "what": what, "since": min(rows), "chg": chg,
            "pts": {y: [[d, v[y]] for d, v in sorted(rows.items()) if v.get(y) is not None] for y in sorted(last)},
            "seed": (load_yaml("est_seed.yaml") or {}).get(code)}


def brief(est):
    """카드·방향판용 한 줄: 내년(없으면 마지막 해) 추정치의 1주·1개월·3개월 변화 %."""
    if not est or not est.get("chg"):
        return None
    y = str(now_kst().year + 1)[2:]
    y = y if y in est["chg"] else max(est["chg"])
    a = est["chg"][y]["ago"]
    b = {"y": y, "what": est["what"], **{nm: (a.get(nm) or [None, None])[1] for nm in ("1주", "1개월", "3개월")}}
    return {**b, "sig": signal(b)}


def signal(b):
    """변곡점 꼬리표: 상향 중 · 하향 중 · 상향 전환? · 꺾임? · 그대로."""
    w, m = (b or {}).get("1주"), (b or {}).get("1개월")
    if w is None and m is None:
        return None
    w, m = w or 0, m if m is not None else w or 0
    if w > 0.5 and m < -0.5:
        return "🔄 상향 전환?"
    if w < -0.5 and m > 0.5:
        return "⚠ 꺾임?"
    if m >= 1 or (w >= 1 and m >= 0):
        return "📈 상향 중"
    if m <= -1 or (w <= -1 and m <= 0):
        return "📉 하향 중"
    return "➖ 그대로"


if __name__ == "__main__":  # 규칙만 확인
    assert signal({"1주": 3.4, "1개월": 5.1}) == "📈 상향 중"
    assert signal({"1주": -2, "1개월": -4}) == "📉 하향 중"
    assert signal({"1주": 1.2, "1개월": -3}) == "🔄 상향 전환?"
    assert signal({"1주": -1.2, "1개월": 4}) == "⚠ 꺾임?"
    assert signal({"1주": 0.1, "1개월": 0.2}) == "➖ 그대로" and signal({}) is None
    assert _pct(591.3, 571.97) == 3.38 and _pct(5, -1) is None
    print("ok")
