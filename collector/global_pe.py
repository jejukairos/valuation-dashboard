"""🌍 업종별 글로벌 대표 기업 12MF PER (config/global_peers.yaml → site/data/global_pe.json, .github/workflows/gpe.yml).
12MF EPS = 그 주가 속한 회계연도와 다음 회계연도 EPS 를 남은 기간 비율로 섞음 (우리 '12MF PER 밴드'와 같은 방식).
과거 칸은 실제 이익 — 야후 '정상화 이익'(일회성 뺀 순이익) ÷ 희석 주식 수, 없으면 희석 EPS. 앞 두 해는 야후 컨센서스(0y·+1y).
적자거나 100배 넘는 칸은 그 회사만 빼고 평균 (2곳 이상일 때만 평균)."""
import sys

import pandas as pd

from common import DATA, load_yaml, now_kst, write_json

PE_MAX, START = 100, "2022-01-01"


def annual_eps(tk, info):
    """{회계연도 끝: EPS} — 지난 해 실적(정상화) + 이번·다음 회계연도 컨센서스. 가격과 화폐가 다르면 맞춤 (펜스 ×100, 다른 통화는 지금 환율)."""
    inc = tk.income_stmt
    sh = inc.loc["Diluted Average Shares"] if "Diluted Average Shares" in inc.index else None
    out = {}
    for c in inc.columns:
        v = None
        if sh is not None and "Normalized Income" in inc.index and inc.loc["Normalized Income", c] == inc.loc["Normalized Income", c] and sh[c] == sh[c] and sh[c]:
            v = float(inc.loc["Normalized Income", c]) / float(sh[c])
        elif "Diluted EPS" in inc.index and inc.loc["Diluted EPS", c] == inc.loc["Diluted EPS", c]:
            v = float(inc.loc["Diluted EPS", c])
        if v is not None:
            out[pd.Timestamp(c)] = v
    actual = set(out)
    est, last = tk.earnings_estimate, info.get("lastFiscalYearEnd")
    if est is not None and last:
        e0 = pd.Timestamp(last, unit="s").normalize()
        for k, add in (("0y", 1), ("+1y", 2)):
            if k in est.index and est.loc[k, "avg"] == est.loc[k, "avg"]:
                out.setdefault(e0 + pd.DateOffset(years=add), float(est.loc[k, "avg"]))
    cur, fin = info.get("currency"), info.get("financialCurrency") or info.get("currency")
    f = 100.0 if cur == "GBp" and fin == "GBP" else 1.0
    if cur and fin and cur.upper() != fin.upper():
        import yfinance as yf
        f = float(yf.Ticker(f"{fin.upper()}{cur.upper()}=X").history(period="5d")["Close"].iloc[-1]) * (100 if cur == "GBp" else 1)
    return {e: v * f for e, v in sorted(out.items())}, actual


def fwd12_at(t, fys):
    """t 시점 12MF EPS: t 가 속한 회계연도(끝 e0)와 다음 회계연도를 남은 기간 비율로."""
    i = next((k for k, (e, _) in enumerate(fys) if e >= t), None)
    if i is None or i + 1 >= len(fys):
        return None
    (e0, a), (_, b) = fys[i], fys[i + 1]
    w0 = min(1.0, max(0.0, (e0 - t).days / 365.25))
    return w0 * a + (1 - w0) * b


def pe_series(close, eps, actual=None, recent=91):
    """주마다 12MF PER. actual = 실제 실적이 나온 회계연도 끝들 (없으면 전부 실적으로 봄).
    뒤에 이익이 무너진 회사(에스티로더·시세이도)는 '나중 실적'으로 섞으면 그때 PER 이 부풀려져서, 섞은 값이 그때 알던 마지막 실적의
    60% 아래면 그 마지막 실적을 쓰고, 크게 큰 회사는 1.6배까지만 (그때 증권사 예상 대신 어림). 그때 알던 실적이 하나도 없는 주(자료 시작 전)는 뺌.
    최근 recent 일은 지금 컨센서스 그대로 (묶지 않음)."""
    fys, act = sorted(eps.items()), sorted(actual if actual is not None else eps)
    free = (pd.Timestamp(close.index.max()).tz_localize(None) if pd.Timestamp(close.index.max()).tzinfo else pd.Timestamp(close.index.max())) - pd.Timedelta(days=recent)
    out = {}
    for t, p in close.items():
        t = pd.Timestamp(t).tz_localize(None) if pd.Timestamp(t).tzinfo else pd.Timestamp(t)
        known = [eps[a] for a in act if a < t]
        if not known:
            continue
        e = fwd12_at(t, fys)
        if e is not None and known[-1] > 0 and t < free:  # 그때 알던 마지막 실적의 0.6~1.6배 안으로 (무너진 회사는 그때 알던 실적, 크게 큰 회사는 1.6배까지만)
            e = known[-1] if e < 0.6 * known[-1] else min(e, 1.6 * known[-1])
        if e and e > 0 and p == p and 0 < p / e <= PE_MAX:
            out[(t - pd.Timedelta(days=t.weekday())).strftime("%Y-%m-%d")] = round(p / e, 2)  # 거래소마다 주 날짜가 달라 그 주 월요일로 맞춤
    return out


def collect():
    import yfinance as yf
    cfg = load_yaml("global_peers.yaml") or {}
    tick = sorted({p["t"] for g in cfg.values() for p in g.get("peers") or []})
    px = yf.download(tick, start=START, interval="1wk", auto_adjust=False, progress=False, group_by="ticker")
    groups, fails = {}, []
    for name, g in cfg.items():
        peers = []
        for p in g.get("peers") or []:
            try:
                tk = yf.Ticker(p["t"])
                info = tk.info
                close = px[p["t"]]["Close"].dropna()
                pe = pe_series(close, *annual_eps(tk, info))
                peers.append({**p, "pe": pe, "now": list(pe.values())[-1] if pe else None, "fwd_yahoo": info.get("forwardPE")})
            except Exception as e:  # noqa: BLE001 - 한 회사가 막혀도 나머지로 평균
                fails.append(f"{p['t']}: {str(e)[:60]}")
        ds = sorted({d for x in peers for d in x["pe"]})
        avg = {}
        for i, d in enumerate(ds):  # 그 주 값이 아직 없는 회사는 바로 전 주 값 (마지막 주가 일부 거래소만 있어 평균이 튀지 않게)
            vs = [x["pe"].get(d, x["pe"].get(ds[i - 1]) if i else None) for x in peers]
            vs = sorted(v for v in vs if v is not None)
            if len(vs) >= 2:  # 3곳 이상이면 중앙값 (이익이 크게 흔들린 한 곳이 평균을 끌고 가지 않게), 2곳이면 평균
                k = len(vs) // 2
                avg[d] = round(vs[k] if len(vs) % 2 else (vs[k - 1] + vs[k]) / 2, 2)
        groups[name] = {"title": g.get("title") or name, "codes": g.get("codes") or [], "notes": g.get("notes") or {},
                        "peers": peers, "avg": avg}
        print(f"  {name}: {len(peers)}곳 · 평균 {len(avg)}주 · 지금 {list(avg.values())[-1] if avg else '-'}배")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "groups": groups, "fails": fails,
            "how": "12MF EPS = 이번·다음 회계연도 EPS 를 남은 기간 비율로 섞음 · 과거는 실제 이익(일회성 뺀 정상화 이익), 뒤에 이익이 무너진 해는 그때 알던 마지막 실적 · 적자·100배 넘는 칸은 빼고 가운데 값(중앙값) · 야후"}


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:  # 자체 점검: 12MF EPS 섞기와 걸러내기
        fys = [(pd.Timestamp("2025-12-31"), 10.0), (pd.Timestamp("2026-12-31"), 20.0), (pd.Timestamp("2027-12-31"), 30.0)]
        assert abs(fwd12_at(pd.Timestamp("2026-07-02"), fys) - 25.0) < 0.1 and fwd12_at(pd.Timestamp("2028-01-05"), fys) is None
        s = pe_series(pd.Series([250.0, 2600.0], index=pd.to_datetime(["2026-07-02", "2026-07-09"])), dict(fys))
        assert list(s) == ["2026-06-29"] and abs(s["2026-06-29"] - 10) < 0.05, s  # 그 주 월요일 · 100배 넘는 칸은 뺌
        crash = {pd.Timestamp("2023-12-31"): 10.0, pd.Timestamp("2024-12-31"): 2.0, pd.Timestamp("2025-12-31"): 1.0}
        s = pe_series(pd.Series([300.0, 300.0, 300.0], index=pd.to_datetime(["2023-06-01", "2024-03-01", "2024-12-01"])), crash, {pd.Timestamp("2023-12-31"), pd.Timestamp("2024-12-31")})
        assert list(s) == ["2024-02-26"] and s["2024-02-26"] == 30.0, s  # 그때 알던 실적 없는 주는 빼고, 뒤에 무너진 이익 대신 그때 알던 10 (마지막 주는 묶지 않아 300/1.1 → 100배 넘어 빠짐)
        boom = {pd.Timestamp("2023-12-31"): 10.0, pd.Timestamp("2024-12-31"): 40.0, pd.Timestamp("2025-12-31"): 50.0}
        s = pe_series(pd.Series([320.0, 320.0], index=pd.to_datetime(["2024-03-01", "2025-11-01"])), boom, {pd.Timestamp("2023-12-31"), pd.Timestamp("2024-12-31")})
        assert s == {"2024-02-26": 20.0}, s  # 크게 큰 회사: 그때 알던 10 × 1.6 = 16 → 20배 (마지막 주는 다음 회계연도 추정이 없어 빠짐)
        print("ok")
    else:
        write_json(DATA / "global_pe.json", collect())
