"""🔔 새 소식 탭 (사용자 2026-11-11): 오늘·어제·이번 주(7일)에 바뀐 것만 한곳에 → site/data/feed.json.
최신 날짜가 위, 같은 날은 💼 보유 → ⭐ 관심 → 🤝 공동 → 🌐 공통. 사이트에 이미 모인 데이터에서 날짜만 보고 골라 담음:
실적(잠정실적 숫자) · IR 요약·컨콜 정리 · 리포트 목표가(한경) · 해외 증권사 한 장 요약 · 중요 공시 · 수출 잠정·확정 · 큰 사건 · 이익 추정치 1주 변화
+ 사이트에 반영·자동 정리한 커밋 (git log — 봇의 정기 갱신 커밋은 뺌). tg.yml·update.yml 끝에서."""
import json
import re
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone

from common import DATA, ROOT, load_yaml, now_kst, write_json

DAYS = 7
PRI = {"보유": 0, "관심": 1, "공동": 2, "공통": 3}
# 📦 수출 묶음 → 이어진 종목 (app.js EXPW 와 같은 짝) — shortcut: 손으로 맞춤, 묶음·종목을 늘리면 두 곳 다
EXP_CODES = {"ramen": ["003230"], "cosmetics": ["278470", "483650", "241710", "251970", "092730"], "medx": ["214450", "214150"],
             "tech": ["005930", "000660"], "power": ["034020"]}
EXP_NAME = {"ramen": "라면", "cosmetics": "화장품", "medx": "미용 의료기기", "tech": "반도체", "power": "변압기"}
BOT = re.compile(r"^(데이터 갱신|리포트·뉴스|관세청 수출|텔레그램 API 채널|시장 그룹판|글로벌 동종|실적발표 요약 \(매일 점검\)|Merge)")
AUTO = re.compile(r"실적발표 요약|녹취록 요약|리포트 한 장 요약|어닝콜")  # PC 예약 작업(claude -p)이 스스로 정리한 커밋


def _j(name):
    try:
        return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _eok(v):
    """억원 숫자 → '1,962억' · 1조 넘으면 '1.2조'."""
    return "-" if v is None else f"{v / 1e4:,.1f}조" if abs(v) >= 1e4 else f"{v:,.0f}억"


def _won(v, us=False):
    return f"${v:,.0f}" if us else f"{v / 1e4:,.0f}만원" if v >= 1e5 else f"{v:,.0f}원"


def stocks():
    """code → (이름, 묶음, 시장) — 보유가 관심·공동보다 먼저 (stocks.yaml 순서)."""
    sy, out = load_yaml("stocks.yaml"), {}
    for k, g in (("holdings", "보유"), ("watchlist", "관심"), ("joint", "공동")):
        for h in sy.get(k) or []:
            out.setdefault(str(h["code"]), (h["name"], g, str(h.get("market", "KR")).upper()))
    return out


def build(today=None, days=DAYS, git=True):
    today = today or now_kst().date()
    cut = (today - timedelta(days=days - 1)).isoformat()
    S, items = stocks(), []
    add = lambda d, code, k, t, u="", go="", g=None, hm="", x=None, cs=None: items.append({  # noqa: E731  x = 그 일의 내용 줄 (화면에 펼쳐 보임, 사용자 11/13) · cs = 수출 묶음에 이어진 종목
        "d": d, "hm": hm, "code": code, "name": S.get(code, ("", ""))[0], "g": g or S.get(code, ("", "공통"))[1], "k": k, "t": t,
        **({"u": u} if u else {}), **({"x": x} if x else {}), **({"cs": cs} if cs else {}), "go": go or (f"#stock/{code}" if code in S else "")})
    xcs = lambda ks: list(dict.fromkeys(c for k in ks for c in EXP_CODES.get(k, []) if c in S))  # noqa: E731

    # 🧾 실적: 잠정실적 숫자(kq) + IR 요약 + 컨콜 깊이 정리를 종목·분기 한 줄로
    D, IRB, ER = _j("dashboard"), _j("ir_brief"), _j("earnings")
    for s in D.get("stocks") or []:
        code, kb = str(s.get("code")), s.get("kq_brief") or {}
        if code not in S:
            continue
        ir = next((e for e in IRB.get(code) or [] if (e.get("date") or "") >= cut), None)
        er = next((e for e in ER.get(code) or [] if (e.get("date") or "") >= cut), None)
        kd = s.get("kq_date") if (s.get("kq_date") or "") >= cut else None
        if not (kd or ir or er):
            continue
        rows = {r["item"]: r for r in kb.get("rows") or []} if kd else {}
        num = " · ".join(f"{nm} {_eok(r['act'])}" + (f" (예상 대비 {r['vs_est']:+.0f}%)" if r.get("vs_est") is not None else "")
                         for nm, key in (("매출", "매출액"), ("영업이익", "영업이익")) if (r := rows.get(key)) and r.get("act") is not None)
        q = (ir or er or {}).get("quarter") or kb.get("latest") or ""
        done = [x for x, ok in (("IR 요약·분석", ir), (f"질의응답 {len(ir.get('qa') or [])}개" if ir and ir.get("qa") else "", ir and ir.get("qa")),
                                ("컨콜 깊이 정리", er)) if ok and x]
        t = f"{q} 실적{' (잠정)' if kd and kb.get('prelim') else ''}" + (f" — {num}" if num else "") + (f" · ✅ {' · '.join(done)}" if done else "")
        add(max(x for x in (kd, ir and ir.get("date"), er and er.get("date")) if x), code, "🧾 실적", t)
    # 📑 한경 리포트: 종목·날짜마다 한 줄 (몇 개 · 목표가 상향/하향/유지)
    for st in _j("reports").get("stocks") or []:
        code, by = str(st.get("code")), {}
        for r in st.get("list") or []:
            if (r.get("d") or "") >= cut and code in S:
                by.setdefault(r["d"], []).append(r)
        for d, rs in by.items():
            up = sum(1 for r in rs if r.get("tp") and r.get("tp_prev") and r["tp"] > r["tp_prev"])
            dn = sum(1 for r in rs if r.get("tp") and r.get("tp_prev") and r["tp"] < r["tp_prev"])
            us = S[code][2] == "US"
            who = "; ".join(f"{r.get('firm', '')} {_won(r['tp'], us)}" + (f" (← {_won(r['tp_prev'], us)})" if r.get("tp_prev") and r["tp_prev"] != r["tp"] else "")
                            for r in rs if r.get("tp"))[:160]
            add(d, code, "📑 리포트", f"리포트 {len(rs)}개" + (f" · 목표가 상향 {up}" if up else "") + (f" · 하향 {dn}" if dn else "") + (f" — {who}" if who else ""),
                go=f"#reports/{code}")
    # 🌏 증권사 리포트 한 장 요약 (리포트 탭) — 종목·날짜마다 한 줄 (몇 곳 · 이익 추정 상향/하향 몇 곳)
    for code, v in (_j("rep_digest").get("stocks") or {}).items():
        by = {}
        for r in v.get("reps") or []:
            if (r.get("d") or "") >= cut and code in S:
                by.setdefault(r["d"], []).append(r)
        for d, rs in by.items():
            dirs = [r.get("est_dir") for r in rs]
            tag = " · ".join(f"이익 추정 {x} {dirs.count(x)}" for x in ("상향", "하향") if dirs.count(x))
            add(d, code, "🌏 증권사 요약", (f"{len(rs)}곳" + (f" · {tag}" if tag else "") + " — " if len(rs) > 1 else (f"{tag} — " if tag else ""))
                + "; ".join(f"{r.get('firm', '')}: {r.get('t', '')}" for r in rs[:2])[:170], u=rs[0].get("u", "") if len(rs) == 1 else "", go=f"#reports/{code}")
    # 📢 중요 공시 (자사주·대주주·임원 매매·공급계약 …) — lv bad 는 화면에서 빨갛게
    for code, fs in (_j("filings").get("companies") or {}).items():
        for f in fs or []:
            if (f.get("d") or "") >= cut and code in S:
                x = f.get("x") if f.get("x") not in (None, "", "0억") else ""
                items.append({**{"d": f["d"], "hm": "", "code": code, "name": S[code][0], "g": S[code][1], "k": f"📢 {f.get('k', '공시')}", "go": f"#stock/{code}"},
                              "t": f"{f.get('t', '')}" + (f" · {x}" if x else ""), **({"u": f["u"]} if f.get("u") else {}), **({"bad": 1} if f.get("lv") == "bad" else {})})
    # 📦 수출: 채널 1~10일·1~20일 잠정 (exp_ten) + 관세청 확정치 처음 받은 날 (exports seen)
    best = lambda ks: min((S[c][1] for k in ks for c in EXP_CODES.get(k, []) if c in S), key=PRI.get, default="공통")  # noqa: E731
    names = lambda ks: "·".join(dict.fromkeys(S[c][0] for k in ks for c in EXP_CODES.get(k, []) if c in S))  # noqa: E731
    for e in _j("exp_ten").get("ten") or []:
        d = re.search(r"\d{4}-\d{2}-\d{2}", e.get("src", ""))
        ks = [k for k in EXP_NAME if e.get(k)]
        if not d or d.group(0) < cut or not ks:
            continue
        main = lambda k: e[k].get("전체") or next(iter(e[k].values()))  # noqa: E731
        t = f"{e['p']} 수출 ({e.get('who', '')}): " + " · ".join(f"{EXP_NAME[k]} {main(k)[1]:+.0f}%" for k in ks) + " (1년 전보다)"
        add(d.group(0), "", "📦 수출", t + (f" — {names(ks)}" if names(ks) else ""), u=e.get("u", ""), go="#exports", g=best(ks), cs=xcs(ks))
    seen, SN = _j("exports").get("seen") or {}, {**EXP_NAME, "power": "전력기기", "food": "소스·아이스크림", "car": "자동차"}
    for d in sorted({v for s in seen.values() for v in s.values() if v >= cut}):
        ks = [k for k, s in seen.items() if d in s.values() and k in SN]  # 기초·색조는 화장품 안이라 뺌
        ym = max(m for k in ks for m, v in seen[k].items() if v == d)
        add(d, "", "📦 수출", f"관세청 {int(ym[5:])}월 확정치 들어옴 — " + "·".join(SN[k] for k in ks), go="#exports", g=best(ks), cs=xcs(ks))
    # 📌 큰 사건 (events.json) · 📈 이익 추정치 1주 변화 (3% 넘게)
    for ev in _j("events") if isinstance(_j("events"), list) else []:
        if (ev.get("date") or "") >= cut and str(ev.get("code")) in S:
            add(ev["date"], str(ev["code"]), "📌 사건", ev.get("title", ""), x=ev.get("easy"))
    dd = (D.get("updated_at") or "")[:10]
    for s in D.get("stocks") or []:
        e, code = s.get("est") or {}, str(s.get("code"))
        if dd >= cut and code in S and isinstance(e.get("1주"), (int, float)) and abs(e["1주"]) >= 3:
            add(dd, code, "📈 추정치", f"{e.get('y', '')}년 {e.get('what', '이익')} 추정치 1주 {e['1주']:+.1f}%" + (f" · 1개월 {e['1개월']:+.1f}%" if isinstance(e.get("1개월"), (int, float)) else ""))
    # 🛠 사이트에 반영 · 🤖 자동 정리 (커밋 제목, 봇 정기 갱신은 뺌) — 제목에 종목 이름이 있으면 그 종목 묶음
    for d, hm, an, subj, body in commits(cut) if git else []:
        if BOT.match(subj) or an in ("valuation-bot", "github-actions[bot]"):
            continue
        code = next((c for c, (nm, *_) in S.items() if nm in subj or (re.fullmatch(r"[A-Z]{2,5}", c) and re.search(rf"\b{c}\b", subj))), "")
        add(d, code, "🤖 자동 정리" if AUTO.search(subj) else "🛠 사이트 반영", subj.lstrip("﻿")[:150], hm=hm, g=None if code else "공통", x=body)
    items.sort(key=lambda x: (x["d"], -PRI.get(x["g"], 3), x["hm"]), reverse=True)
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "days": DAYS, "items": items}


TL_DAYS = 90


def big_moves(t, c, cut, k=2.5, floor=4.0):
    """하루 등락이 지난 1년 하루 변동폭(표준편차)의 k배 넘고 floor% 넘는 날 [(YYYY-MM-DD, %)] — t = 'YY-MM-DD' 일봉 날짜, c = 종가."""
    r = [("20" + t[i], (c[i] / c[i - 1] - 1) * 100) for i in range(1, len(c)) if c[i - 1]]
    y = [v for _, v in r[-250:]]
    if len(y) < 60:
        return []
    m = sum(y) / len(y)
    lim = max(k * (sum((v - m) ** 2 for v in y) / len(y)) ** 0.5, floor)
    return [(d, v) for d, v in r if d >= cut and abs(v) >= lim]


def timeline(today=None):
    """🗓 종목별 주요 타임라인 (사용자 11/15 엔비디아 그림 오른쪽 '주요 타임라인') → timeline.json.
    지난 90일: 실적·중요 공시·목표가 상향/하향·큰 사건·📰 이슈·수출·하루 큰 주가 변동(그날 기사 제목) + 다가올 실적 일정."""
    today = today or now_kst().date()
    cut, td = (today - timedelta(days=TL_DAYS - 1)).isoformat(), today.isoformat()
    S, tl = stocks(), {}
    prev = _j("timeline").get("stocks") or {}
    put = lambda code, row: tl.setdefault(code, []).append({k: v for k, v in row.items() if v})  # noqa: E731
    for it in build(today, TL_DAYS, git=False)["items"]:
        k, t = it["k"], it["t"]
        if k in ("🌏 증권사 요약", "📈 추정치", "📦 수출") or k.startswith("📢") or (k == "📑 리포트" and not re.search("상향|하향", t)):
            continue  # 공시·수출은 아래에서 따로 묶음 · 목표가 그대로인 리포트는 뺌
        head, _, who = t.partition(" — ")
        if k == "📑 리포트":  # '리포트 3개 · 목표가 상향 2 · 하향 1' → '목표가 상향 2 · 하향 1 (리포트 3개)'
            head = "목표가 " + " · ".join(re.findall(r"(?:상향|하향) \d+", head)) + f" ({re.search(r'리포트 \d+개', head)[0]})"
        row = {"d": it["d"], "k": k, "t": head if k == "📑 리포트" else t.split(" · ✅")[0], "u": it.get("u"), "x": who.split("; ") if k == "📑 리포트" and who else it.get("x"),
               "bad": int(k == "📑 리포트" and "하향" in t and "상향" not in t), "good": int(k == "📑 리포트" and "상향" in t and "하향" not in t)}
        if it["code"]:
            put(it["code"], row)
    # 📦 수출: 같은 기간을 여러 채널이 올리면 처음 것 하나 · 그 종목 품목만 · 1~10일·1~20일 잠정은 최근 30일 것만 (한 달 치는 90일 다)
    seen, d30 = set(), (today - timedelta(days=30)).isoformat()
    for e in _j("exp_ten").get("ten") or []:
        m = re.search(r"\d{4}-\d{2}-\d{2}", e.get("src", ""))
        if not m or m[0] < cut or (e.get("upto", 31) < 28 and m[0] < d30):
            continue
        for k, nm in EXP_NAME.items():
            if not e.get(k) or (e["p"], k) in seen:
                continue
            seen.add((e["p"], k))
            it, v = ("", e[k]["전체"]) if "전체" in e[k] else next(iter(e[k].items()))
            if v[1] is not None:
                for code in EXP_CODES[k]:
                    if code in S:
                        put(code, {"d": m[0], "k": "📦 수출", "t": f"{e['p']} {nm}{' ' + it if it else ''} 수출 {v[1]:+.0f}% (1년 전보다 · {e.get('who', '')})", "u": e.get("u")})
    # ✍️ 손으로 넣은 줄 (사용자 전달 그림·글의 타임라인) — config/timeline.yaml
    for code, rows in (load_yaml("timeline.yaml") or {}).items():
        for r in rows or []:
            put(str(code), {"d": str(r["d"]), "k": r.get("k", "🗞 주요 일"), "t": r["t"], "u": r.get("u"), "dl": r.get("dl"), "src": r.get("src"),
                            "bad": int(bool(r.get("bad"))), "good": int(bool(r.get("good"))), "up": int(str(r["d"]) >= td)})
    for code, fs in (_j("filings").get("companies") or {}).items():
        by = {}
        for f in fs or []:  # 국민연금 같은 기관 대주주의 매일 사고팖은 뺌 (임원·최대주주 매매가 아님)
            if (f.get("d") or "") >= cut and code in S and "국민연금" not in f.get("t", ""):
                by.setdefault((f["d"], f.get("k", "공시")), []).append(f)
        for (d, k), fl in by.items():
            x = [f.get("t", "") + (f" · {f['x']}" if f.get("x") not in (None, "", "0억") else "") for f in fl]
            lv = {f.get("lv") for f in fl}
            put(code, {"d": d, "k": f"📢 {k}", "t": x[0] + (f" 외 {len(x) - 1}건" if len(x) > 1 else ""), "x": x if len(x) > 1 else None,
                       "u": fl[0].get("u"), "bad": int("bad" in lv), "good": int("good" in lv and "bad" not in lv)})
    news = {str(s["code"]): s for s in _j("news").get("stocks") or []}
    for code, st in news.items():
        for i in st.get("issues") or []:  # 📰 핵심 이슈 (사용자 전달·손으로 고정한 줄) — 날짜가 '10/3' 꼴
            m = re.fullmatch(r"(\d{1,2})/(\d{1,2})", i.get("d", ""))
            if m and code in S:
                d = date(today.year, int(m[1]), int(m[2]))
                d = (d.replace(year=d.year - 1) if d > today else d).isoformat()
                if d >= cut:
                    put(code, {"d": d, "k": "📰 이슈", "t": i.get("t", ""), "u": i.get("u")})
    for code, (_, _, mk) in S.items():
        o = _j(f"ohlc/{code}").get("dd") or {}
        own = (news.get(code) or {}).get("own") or []
        for d, v in big_moves(o.get("t") or [], o.get("c") or [], cut):
            # 그날 기사 = 그날(미국은 한국 시간 다음 날 아침까지) 가장 많은 곳이 쓴 제목 — 원인이라고 확정한 건 아님 · 뉴스는 3주치만 있어서 지난 줄의 제목은 이어받음
            ds = {d, (date.fromisoformat(d) + timedelta(days=1)).isoformat()} if mk == "US" else {d}
            h = max((x for x in own if (x.get("d") or "")[:10] in ds), key=lambda x: x.get("n") or 1, default=None)
            old = next((r for r in prev.get(code, []) if r.get("d") == d and r.get("mv") is not None and r.get("h")), {})
            put(code, {"d": d, "k": "📈 주가 급등" if v > 0 else "📉 주가 급락", "t": f"하루 {v:+.1f}%", "mv": round(v, 1),
                       "h": h and h.get("t") or old.get("h"), "u": h and h.get("u") or old.get("u"), "bad": int(v < 0), "good": int(v > 0)})
    for e in _j("ir_calendar").get("items") or []:
        code = str(e.get("code"))
        if (e.get("when") or "")[:10] >= td and code in S:
            put(code, {"d": e["when"][:10], "k": "🗓 예정", "t": e.get("title") or "실적 발표", "u": e.get("url"), "up": 1})
    out = {}
    for code in S:
        rows, keys = [r for r in tl.get(code, []) if r["d"] >= cut], set()
        new = {(r["d"], r["k"]) for r in rows}  # 실적 줄은 다음 분기가 나오면 원본에서 사라져서 지난 파일에서 이어받음
        rows += [r for r in prev.get(code, []) if r.get("k") == "🧾 실적" and r.get("d", "") >= cut and (r["d"], r["k"]) not in new]
        uniq = []
        for r in sorted(rows, key=lambda r: (r["d"], r["k"])):
            if (r["d"], r["k"], r["t"]) not in keys:
                keys.add((r["d"], r["k"], r["t"]))
                uniq.append(r)
        past, up = [r for r in uniq if not r.get("up")], [r for r in uniq if r.get("up")]
        if past or up:
            out[code] = past[-30:] + up
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "days": TL_DAYS, "stocks": out}


TRAILER = re.compile(r"^(Co-Authored-By|Claude-Session|Signed-off-by):", re.I)


def body_lines(b):
    """커밋 본문 → 내용 줄 (앞 '- ' 와 서명 줄은 뺌, 최대 15줄)."""
    return [ln.strip().lstrip("-•· ").strip() for ln in (b or "").splitlines() if ln.strip() and not TRAILER.match(ln.strip())][:15]


def commits(cut):
    """(날짜, 시:분, 작성자, 제목, 본문 줄) — 한국 시간."""
    try:  # %cI = 커밋한 곳의 시간대가 붙은 시각 → 한국 시간으로 (윈도·리눅스 TZ 설정과 상관없이) · %x1e = 커밋 사이 구분 (본문에 줄바꿈이 있어서)
        out = subprocess.run(["git", "log", f"--since={cut}T00:00:00+09:00", "--format=%cI%x09%an%x09%s%x09%b%x1e"],
                             cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    rows, kst = [], timezone(timedelta(hours=9))
    for rec in out.split("\x1e"):
        p = rec.strip("\n").split("\t", 3)
        if len(p) == 4:
            t = datetime.fromisoformat(p[0]).astimezone(kst)
            if t.date().isoformat() >= cut:
                rows.append((t.strftime("%Y-%m-%d"), t.strftime("%H:%M"), p[1], p[2], body_lines(p[3])))
    return rows


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        assert _eok(1962) == "1,962억" and _eok(12345) == "1.2조" and _won(1800000) == "180만원" and _won(52000) == "52,000원"
        assert BOT.match("데이터 갱신 2026-11-11 13:29") and not BOT.match("📦 수출입 탭: …") and AUTO.search("삼성전기 3Q26 실적발표 요약 (발표 자막)")
        assert body_lines("- 가 줄\n\n- 나 줄\nCo-Authored-By: x\nClaude-Session: y") == ["가 줄", "나 줄"]
        f = build()
        assert all(x["d"] >= f["items"][-1]["d"] for x in f["items"]) and all(x["g"] in PRI for x in f["items"]), "정렬·묶음"
        t = ["26-01-%02d" % (i % 28 + 1) for i in range(300)]
        c = [100 + (i % 2) for i in range(299)] + [120]
        assert big_moves(t, c, "2026-01-01") == [("2026-01-%02d" % (299 % 28 + 1), (120 / 100 - 1) * 100)], "큰 등락 = 마지막 +20% 하루만"
        tl = timeline()
        assert all(r["d"] <= s[i + 1]["d"] or r.get("up") or s[i + 1].get("up") for s in tl["stocks"].values() for i, r in enumerate(s[:-1])), "타임라인 날짜순"
        print("ok", len(f["items"]), "· 타임라인", len(tl["stocks"]), "종목")
    else:
        f = build()
        write_json(DATA / "feed.json", f)
        print(f"■ 새 소식 {len(f['items'])}개 (7일)")
        tl = timeline()
        write_json(DATA / "timeline.json", tl)
        print(f"■ 종목별 타임라인 {len(tl['stocks'])}종목 ({TL_DAYS}일 + 다가올 일정)")
