"""🏁 업종 시총 순위 (사용자 2026-11-27, BRILLER '화장품 시총 변화' 글): 업종 안 1등이 바뀌거나 밑에 있던 회사가 치고 올라오면 신호,
시총이 빠지는 회사는 위험 신호 → 산업 탭 업종 칸 맨 위 표 + 📡 신호 탭 카드 + 🔔 새 소식 (feed.py 가 log 를 읽음).

네이버 증권 업종(WICS 와 같은 이름 79개) 종목·지금 시총 → config/sector_rank.yaml 묶음 → 종목마다 일봉 종가로
1주(5거래일)·1개월(20)·3개월(60) 전 시총 = 지금 시총 × 그때 종가 ÷ 지금 종가 (그 사이 주식 수는 그대로라고 봄 — 증자·소각이 있으면 조금 다름)
→ 그때 순위와 지금 순위. 차트 스캔(scan.yml, 평일 06:40·16:10)에서 board.py 가 부름."""
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import requests

from common import DATA, load_yaml, now_kst, read_json, write_json

API = "https://m.stock.naver.com/api/stocks/industry"
UA = {"User-Agent": "Mozilla/5.0"}
PREF = re.compile(r"\d?우[A-C]?$|우\(전환\)$|리츠$")
H = (5, 20, 60)  # 거래일: 1주 · 1개월 · 3개월
HN = {5: "1주", 20: "1개월", 60: "3개월"}
FETCH_TOP = 30  # 묶음마다 지금 시총 상위 몇 개까지 일봉을 받나 (그 밑은 순위 변화 신호를 안 봄)
LOG_DAYS = 60


def _num(s):
    try:
        return float(str(s).replace(",", ""))
    except ValueError:
        return 0.0


def industries(ses):
    """네이버 업종 이름 → [(코드, 이름, 시총 억원)]."""
    out = {}
    for g in ses.get(f"{API}?page=1&pageSize=100", headers=UA, timeout=20).json()["groups"]:
        rows, p = [], 1
        while p < 30:
            j = ses.get(f"{API}/{g['no']}?page={p}&pageSize=100", headers=UA, timeout=20).json()
            rows += j.get("stocks") or []
            if not j.get("stocks") or len(rows) >= j.get("totalCount", 0):
                break
            p += 1
        out[g["name"]] = [(r["itemCode"], r["stockName"], _num(r.get("marketValue"))) for r in rows if r.get("itemCode")]
    return out


def closes(ses, code, days=130):
    """네이버 일봉 종가 (오래된 것 → 최근)."""
    end, start = now_kst(), now_kst() - timedelta(days=days)
    t = ses.get(f"https://api.finance.naver.com/siseJson.naver?symbol={code}&requestType=1&startTime={start:%Y%m%d}&endTime={end:%Y%m%d}&timeframe=day",
                headers=UA, timeout=20).text
    return [(d, float(c)) for d, c in re.findall(r'\["(\d{8})",\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)', t) if float(c) > 0]


def ranks(caps):
    """{코드: 시총} → {코드: 순위 1~}."""
    return {c: i + 1 for i, c in enumerate(sorted(caps, key=lambda c: -caps[c]))}


TOPN = 10  # 신호는 1~10등 안에서만 (사용자 "1등부터 10등") — 표는 top 까지 보여 줌
GAP = {5: 10, 20: 15}  # 업종 가운데값보다 이만큼(%p) 더 빠지면 🔴 (시장 전체가 빠질 땐 다 같이 빠지니 '업종보다 더'만)


def events(rows, top):
    """한 묶음의 바뀐 것 (1주·1개월): 👑 1등 바뀜 · 🟢 10등 안에서 치고 올라옴 (추월한 회사) · 🔴 10등 안 회사가 업종보다 많이 빠짐 (밀린 회사 포함).
    rows = 순위 계산된 표 (r0 지금, r{h} 그때, p{h} 시총 변화 %)."""
    ev = []
    for h in (5, 20):
        has = [r for r in rows if r.get(f"r{h}")]
        if len(has) < 3:
            continue
        ps = sorted(r[f"p{h}"] for r in has[:top] if r.get(f"p{h}") is not None)
        med = ps[len(ps) // 2] if ps else 0.0
        old1, new1 = min(has, key=lambda r: r[f"r{h}"]), min(has, key=lambda r: r["r0"])
        if old1["code"] != new1["code"]:
            ev.append({"typ": "king", "h": h, "code": new1["code"], "name": new1["name"], "r0": 1, "rh": new1[f"r{h}"], "pass": [old1["name"]], "p": new1.get(f"p{h}"), "med": med})
        for r in has:
            up, p = r[f"r{h}"] - r["r0"], r.get(f"p{h}")
            if up >= 1 and r["r0"] <= TOPN and (h == 5 or up >= 2 or r["r0"] <= 5) and not (r["code"] == new1["code"] and old1["code"] != new1["code"]):  # 1등이 된 건 👑 로 이미
                passed = sorted([x for x in has if x[f"r{h}"] < r[f"r{h}"] and x["r0"] > r["r0"]], key=lambda x: x["r0"])
                ev.append({"typ": "up", "h": h, "code": r["code"], "name": r["name"], "r0": r["r0"], "rh": r[f"r{h}"], "pass": [x["name"] for x in passed][:4], "p": p, "med": med})
            if r[f"r{h}"] <= TOPN and p is not None and p <= -5 and p <= med - GAP[h]:  # 진짜로 5% 넘게 빠졌고 업종보다도 많이
                passed = sorted([x for x in has if x[f"r{h}"] > r[f"r{h}"] and x["r0"] < r["r0"]], key=lambda x: x["r0"])
                ev.append({"typ": "down", "h": h, "code": r["code"], "name": r["name"], "r0": r["r0"], "rh": r[f"r{h}"], "p": p, "med": med, "pass": [x["name"] for x in passed][:4]})
    # 같은 회사·같은 종류가 1주·1개월 둘 다면 1주만 (더 최근)
    seen, out = set(), []
    for e in ev:
        k = (e["typ"], e["code"])
        if k not in seen:
            seen.add(k)
            out.append(e)
    return out


def text(sec, e):
    """새 소식·신호 탭 한 줄."""
    hn, pas = HN[e["h"]], ", ".join(e.get("pass") or [])
    p = f" · 시총 {e['p']:+.0f}% (업종 가운데 {e['med']:+.0f}%)" if e.get("p") is not None else ""
    if e["typ"] == "king":
        return f"{sec} 1등 바뀜: {e['name']} — {pas}을(를) 제치고 1위 ({hn} 전 {e['rh']}위{p})"
    if e["typ"] == "up":
        return f"{sec}: {e['name']} {e['rh']}위 → {e['r0']}위 ({hn}{p})" + (f" — {pas} 추월" if pas else "")
    rk = f"{e['rh']}위 → {e['r0']}위" if e["r0"] != e["rh"] else f"{e['r0']}위 그대로"
    return f"{sec}: {e['name']} 업종보다 많이 빠짐 — {rk} ({hn}{p})" + (f" · {pas}에 밀림" if pas else "")


def build():
    cfg = load_yaml("sector_rank.yaml") or {}
    mn = float(cfg.get("min_cap", 1000))
    ses = requests.Session()
    ind = industries(ses)
    every = {c: (nm, cap) for rows in ind.values() for c, nm, cap in rows}
    plan = []
    for s in cfg.get("sectors") or []:
        drop = {str(x) for x in s.get("drop") or []}
        mem = {c: v for u in s.get("up") or [] for c, *v in ind.get(u, []) if c not in drop}
        mem.update({str(c): list(every[str(c)]) for c in s.get("add") or [] if str(c) in every})
        mem = {c: v for c, v in mem.items() if v[1] >= mn and not PREF.search(v[0])}
        if not mem:
            print(f"  🏁 {s['n']}: 종목 없음 (업종 이름 확인: {s.get('up')})")
            continue
        plan.append((s, sorted(mem.items(), key=lambda kv: -kv[1][1])))
    need = sorted({c for _, mem in plan for c, _ in mem[:FETCH_TOP]})
    with ThreadPoolExecutor(8) as ex:
        px = dict(zip(need, ex.map(lambda c: _safe(closes, ses, c), need)))
    secs, log_new, today = [], [], now_kst().strftime("%Y-%m-%d")
    for s, mem in plan:
        top = int(s.get("top", 15))
        rows = []
        for c, (nm, cap) in mem:
            r = {"code": c, "name": nm, "cap": round(cap)}
            cl = px.get(c) or []
            for h in H:
                if len(cl) > h:
                    r[f"c{h}"] = cap * cl[-1 - h][1] / cl[-1][1]
                    r[f"p{h}"] = round((cl[-1][1] / cl[-1 - h][1] - 1) * 100, 1)
            rows.append(r)
        r0 = ranks({r["code"]: r["cap"] for r in rows})
        for h in H:
            rh = ranks({r["code"]: r[f"c{h}"] for r in rows if f"c{h}" in r})
            for r in rows:
                if r["code"] in rh:
                    r[f"r{h}"] = rh[r["code"]]
        for r in rows:
            r["r0"] = r0[r["code"]]
            for h in H:
                r.pop(f"c{h}", None)
        rows.sort(key=lambda r: r["r0"])
        ev = events(rows, top)
        for e in ev:
            e["t"] = text(s["n"], e)
        secs.append({"n": s["n"], "ind": s.get("ind", ""), "top": top, "n_all": len(rows), "rows": rows[:max(top, 15)], "ev": ev})
        log_new += [{"d": today, "sec": s["n"], **{k: e[k] for k in ("typ", "h", "code", "name", "r0", "rh", "t")}, **({"p": e["p"]} if e.get("p") is not None else {})} for e in ev]
    # log = 처음 본 날만 (같은 묶음·회사·종류·지금 순위면 다시 안 적음) — 🔔 새 소식이 이걸 읽음
    prev = read_json(DATA / "sector_rank.json", {}) or {}
    old = prev.get("log") or []
    key = lambda e: (e["sec"], e["code"], e["typ"], e["r0"] if e["typ"] != "down" else int((e.get("p") or 0) // 10))  # noqa: E731 시총 빠짐은 10%p 구간마다 한 번
    have = {key(e) for e in old}
    cut = (now_kst() - timedelta(days=LOG_DAYS)).strftime("%Y-%m-%d")
    seed = not prev.get("sec")  # 처음 만든 날은 그동안 쌓인 1개월 변화가 한꺼번에 잡혀서 🔔 새 소식엔 안 올림 (신호 탭 카드엔 보임)
    log = [{**e, **({"seed": 1} if seed else {})} for e in log_new if key(e) not in have] + [e for e in old if e["d"] >= cut]
    date = max((cl[-1][0] for cl in px.values() if cl), default="")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "date": f"{date[:4]}-{date[4:6]}-{date[6:]}" if date else "", "min_cap": mn,
            "fetched": sum(1 for v in px.values() if v), "need": len(need), "sec": secs, "log": log[:300]}


def _safe(f, *a):
    try:
        return f(*a)
    except Exception:  # noqa: BLE001 — 한 종목 일봉 실패는 순위 변화만 빠짐
        return []


def main():
    out = build()
    write_json(DATA / "sector_rank.json", out)
    n_ev = sum(len(s["ev"]) for s in out["sec"])
    print(f"■ 🏁 업종 시총 순위 {out['date']}: {len(out['sec'])}묶음 · 일봉 {out['fetched']}/{out['need']} · 바뀐 것 {n_ev} · 새 기록 {sum(1 for e in out['log'] if e['d'] == now_kst().strftime('%Y-%m-%d'))}")
    for s in out["sec"]:
        for e in s["ev"]:
            print("   ", e["t"])


def _test():
    rows = [{"code": "A", "name": "가", "r0": 1, "r5": 2, "p5": 5.0, "r20": 2, "p20": 9.0}, {"code": "B", "name": "나", "r0": 2, "r5": 1, "p5": -12.0, "r20": 1, "p20": -3.0},
            {"code": "C", "name": "다", "r0": 3, "r5": 4, "p5": 2.0, "r20": 5, "p20": 20.0}, {"code": "D", "name": "라", "r0": 4, "r5": 3, "p5": -1.0, "r20": 3, "p20": -16.0},
            {"code": "E", "name": "마", "r0": 5, "r5": 5, "p5": 0.0, "r20": 4, "p20": -2.0}]
    ev = events(rows, 15)  # 가운데값 1주 0% · 1개월 -2%
    kinds = {(e["typ"], e["code"]) for e in ev}
    assert ("king", "A") in kinds and ("up", "A") not in kinds, ev  # 1등이 됨 = 👑 하나만
    assert ("up", "C") in kinds and ("down", "B") in kinds and ("down", "D") not in kinds, ev  # 나 1주 -12% ≤ 0-10 → 🔴 · 라 1개월 -16% > -2-15 → 조용
    assert next(e for e in ev if e["typ"] == "up" and e["code"] == "C")["pass"] == ["라"]
    assert not events([{**r, "p20": -30.0 - i, "p5": -20.0 + i, "r5": r["r0"], "r20": r["r0"]} for i, r in enumerate(rows)], 15)  # 다 같이 빠지고 순위 그대로면 조용
    assert ranks({"x": 3, "y": 9, "z": 1}) == {"y": 1, "x": 2, "z": 3}
    assert PREF.search("삼성전자우") and PREF.search("현대차2우B") and not PREF.search("우리금융지주") and PREF.search("SK리츠")
    print("ok", [text("화장품", e) for e in ev][:3])


if __name__ == "__main__":
    _test() if "--test" in sys.argv else main()
