"""숫자 점검 (사용자 11/15 "잘못된 숫자 체킹"): 사이트 데이터끼리 다시 계산해 안 맞는 곳만 출력. 아무것도 고치지 않음.
쓰기: .venv\\Scripts\\python.exe tools\\num_audit.py   (보유 → 관심 → 공동 순)
"""
import json, re, sys
from datetime import date
from pathlib import Path
import yaml
sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
R = ROOT / "site/data"
D = json.loads((R / "dashboard.json").read_text(encoding="utf-8"))
IRB = yaml.safe_load((ROOT / "config/ir_brief.yaml").read_text(encoding="utf-8")) or {}
today = date.fromisoformat(D["updated_at"][:10])
far = lambda a, b, tol: a is not None and b not in (None, 0) and abs(a / b - 1) > tol
qk = lambda q: re.sub(r"^(\d)Q(\d\d)$", r"\2.\1Q", str(q or ""))
out = {}
def flag(c, lv, msg): out.setdefault(c["code"], []).append((lv, msg))

for c in sorted(D["stocks"], key=lambda c: (["보유", "관심", "공동"].index(c.get("group", "관심")), c.get("order", 0))):
    code, p = c["code"], c.get("price")
    try: d = json.loads((R / f"stocks/{code}.json").read_text(encoding="utf-8"))
    except Exception as e: flag(c, "🔴", f"상세 파일 못 읽음 {e}"); continue
    # ① 적정주가·배수
    s = c.get("scen") or {}
    if s.get("base"):
        if not (s["bear"] <= s["base"] <= s["bull"]): flag(c, "🔴", f"하방·적정·상방 순서 뒤집힘 {s['bear']:.0f}/{s['base']:.0f}/{s['bull']:.0f}")
        if far(c.get("fair"), s["base"], 0.005): flag(c, "🔴", f"적정주가 {c['fair']} ≠ Base {s['base']}")
        if c.get("gap") is not None and p and abs((p / c["fair"] - 1) - c["gap"]) > 0.005: flag(c, "🔴", f"적정가 대비 {c['gap']:+.3f} ≠ 다시 계산 {p / c['fair'] - 1:+.3f}")
        for pt in s.get("parts") or []:
            if pt["kind"] == "PER" and len(s["parts"]) == 1 and c.get("fwd_per") and far(p / pt["base_val"], c["fwd_per"], 0.02): flag(c, "🟡", f"12MF PER {c['fwd_per']} ≠ 주가÷12MF EPS {p / pt['base_val']:.2f}")
    elif "PER" in (c.get("methods") or []) or "PBR" in (c.get("methods") or []): flag(c, "🟡", "적정주가(하방·적정·상방) 없음")
    fp = c.get("fwd_per")
    if fp is not None and (fp <= 0 or fp > 150): flag(c, "🟡", f"12MF PER {fp} (범위 밖)")
    m = c.get("mdd") or {}
    if m.get("peak") and p and abs((p / m["peak"] - 1) * 100 - m["dd"]) > 0.6: flag(c, "🟡", f"고점 대비 {m['dd']}% ≠ 다시 계산 {(p / m['peak'] - 1) * 100:.1f}%")
    if far(d.get("price"), p, 0.001): flag(c, "🔴", f"카드 주가 {p} ≠ 상세 주가 {d.get('price')}")
    pd_ = d.get("price_date")
    if pd_ and (today - date.fromisoformat(pd_[:10])).days > 5: flag(c, "🟡", f"주가 날짜 {pd_} (5일 넘게 안 바뀜)")
    for x in c.get("checks") or []:
        if x.get("warn"): flag(c, "🟡", f"출처끼리 다름: {x['item']} {x['a_src']} {x['a']} vs {x['b_src']} {x['b']}")
    for r in (c.get("dart_check") or {}).get("rows", []):
        if (r.get("diff") or 0) > 1: flag(c, "🟡", f"DART 대조 {r['item']} {r['dart']} vs {r['wise']} ({r['diff']}%)")
    # ② 최신 분기 실적 (kq): 증감률·예상 대비 다시 계산
    k = d.get("kq") or {}
    Q = {q["q"]: q for q in k.get("quarters") or []}
    lat = k.get("latest")
    ago = f"{int(lat[:2]) - 1:02d}{lat[2:]}" if lat and re.match(r"\d\d\.\dQ$", lat) else None
    for r in k.get("rows") or []:
        f = {"매출액": "sales", "영업이익": "op", "순이익": "ni"}.get(r["item"])
        a, e = r.get("act"), r.get("est")
        if a is not None and e and r.get("vs_est") is not None and abs((a / e - 1) * 100 - r["vs_est"]) > 0.6: flag(c, "🔴", f"{lat} {r['item']} 예상 대비 {r['vs_est']:.1f}% ≠ {((a / e - 1) * 100):.1f}%")
        b = (Q.get(ago) or {}).get(f) if f else None
        if a is not None and b and b > 0 and r.get("yoy") is not None and abs((a / b - 1) * 100 - r["yoy"]) > 0.6: flag(c, "🔴", f"{lat} {r['item']} YoY {r['yoy']:.1f}% ≠ {((a / b - 1) * 100):.1f}% ({b} → {a})")
        if f and lat in Q and Q[lat].get(f) is not None and far(a, Q[lat][f], 0.005): flag(c, "🔴", f"{lat} {r['item']} 표 {a} ≠ 분기 목록 {Q[lat][f]}")
    # ③ 긴 분기 실적 (📊 실적 4칸 재료): 단위·부호 이상
    lq = d.get("longq") or {}
    ks = sorted(lq)
    for i, q in enumerate(ks[-12:]):
        v = lq[q]; rev, op, gp = v.get("rev"), v.get("op"), v.get("gp")
        if rev is None: continue
        if rev <= 0: flag(c, "🔴", f"{q} 매출 {rev}")
        if gp is not None and rev > 0 and not (-0.2 <= gp / rev <= 1.0): flag(c, "🔴", f"{q} 매출총이익률 {gp / rev * 100:.0f}%")
        if op is not None and gp is not None and op > gp * 1.02 and op > 0: flag(c, "🟡", f"{q} 영업이익 {op} > 매출총이익 {gp}")
        if op is not None and rev > 0 and abs(op / rev) > 0.8: flag(c, "🟡", f"{q} 영업이익률 {op / rev * 100:.0f}%")
        j = ks.index(q)
        pv = lq[ks[j - 1]].get("rev") if j else None
        if pv and pv > 0 and not (0.4 <= rev / pv <= 2.5): flag(c, "🟡", f"{q} 매출이 전 분기의 {rev / pv:.1f}배 ({pv} → {rev}) — 단위·누적 확인")
    if lat and lat in lq and k.get("cur") != "USD":
        ka = next((r["act"] for r in k["rows"] if r["item"] == "매출액"), None)
        if far(lq[lat].get("rev"), ka, 0.02): flag(c, "🔴", f"{lat} 매출: 📊 그림 {lq[lat].get('rev')} ≠ 🧾 표 {ka}")
        ko = next((r["act"] for r in k["rows"] if r["item"] == "영업이익"), None)
        if ko and far(lq[lat].get("op"), ko, 0.02): flag(c, "🔴", f"{lat} 영업이익: 📊 그림 {lq[lat].get('op')} ≠ 🧾 표 {ko}")
    if lat and ks and max(ks) < lat: flag(c, "🟡", f"📊 실적 그림이 {max(ks)} 까지 (🧾 표는 {lat})")
    # ④ IR 칸: 같은 분기인데 표의 매출·영업이익 숫자가 글에 없음 (한국, 억원)
    e = (IRB.get(code) or [None])[0]
    if e and lat and k.get("cur") != "USD":
        if qk(e.get("quarter")) < lat: flag(c, "🟡", f"IR 칸이 {e.get('quarter')} — 최신 {lat} 것이 아직 없음 (숫자로 먼저 보임)")
        elif qk(e.get("quarter")) == lat:
            txt = json.dumps(e, ensure_ascii=False)
            for r in k["rows"][:2]:
                a = r.get("act")
                if a is None: continue
                forms = {f"{a:,.0f}", f"{a / 1e4:.2f}조", f"{a / 1e4:.1f}조", f"{a / 1e4:.2f}".rstrip("0") + "조", f"{int(a // 1e4)}조 {a % 1e4:,.0f}", f"{int(a // 1e4)}조{a % 1e4:,.0f}", f"{int(a / 1e3 + 0.5) / 10:.1f}조"}
                if abs(a) >= 100 and not any(x in txt for x in forms): flag(c, "🟡", f"IR 칸 글에 {lat} {r['item']} {a:,.0f}억이 안 보임 (다른 숫자를 썼는지 확인)")

n = {"🔴": 0, "🟡": 0}
for c in D["stocks"]:
    for lv, _ in out.get(c["code"], []): n[lv] += 1
print(f"점검 {len(D['stocks'])}종목 · 🔴 틀림 의심 {n['🔴']} · 🟡 확인 필요 {n['🟡']} · 자료 {D['updated_at']}")
for g in ("보유", "관심", "공동"):
    rows = [(c, out[c["code"]]) for c in D["stocks"] if c.get("group") == g and c["code"] in out]
    print(f"\n== {g} ({len(rows)}종목)")
    for c, fs in rows:
        print(f"{c['name']} ({c['code']})")
        for lv, msg in sorted(fs, key=lambda x: x[0] != "🔴"): print(f"   {lv} {msg}")
