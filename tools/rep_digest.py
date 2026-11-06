"""📑 리포트 한 장 요약(다이제스트) — config/rep_digest.yaml → site/data/rep_digest.json (리포트 탭·보유 탭 '오늘·어제 리포트' 줄을 누르면 보임)
  todo [--days 3] [--max 10]: 우리 종목(보유→공동→관심) 한경 리포트 중 요약이 없는 것 → PDF 글자를 transcripts/reports/<번호>.txt 로 (이 컴퓨터에만, 사이트엔 안 올림)
  export: yaml 점검 → json (깨졌으면 멈춤)
  --test: 자체 점검
지침 = tools/rep_digest_task.md (PC 예약 작업 ir_live.ps1 이 매시간 Claude 로 돌림)"""
import io
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
Y, J, TXT = ROOT / "config" / "rep_digest.yaml", ROOT / "site" / "data" / "rep_digest.json", ROOT / "transcripts" / "reports"
GRP = {"보유": 0, "공동": 1, "관심": 2}
KST = timezone(timedelta(hours=9))


def load():
    return yaml.safe_load(Y.read_text(encoding="utf-8")) or {} if Y.exists() else {}


def check(D):
    """{코드: {flow?, flow_d?, reps: [{d, firm, idx|u, pts…}]}} 모양인지 — 틀리면 이유 목록."""
    bad = []
    for code, v in (D or {}).items():
        if not isinstance(v, dict) or not isinstance(v.get("reps", []), list):
            bad.append(f"{code}: {{flow, reps: [...]}} 모양이 아님")
            continue
        for i, r in enumerate(v.get("reps") or []):
            if not isinstance(r, dict) or not r.get("d") or not r.get("firm"):
                bad.append(f"{code} #{i}: d·firm 없음")
            elif not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(r["d"])):
                bad.append(f"{code} #{i}: 날짜 {r['d']}")
            elif not (r.get("pts") or r.get("val")):
                bad.append(f"{code} #{i}: pts(핵심)·val(근거) 둘 다 없음")
            for k in ("pts", "risk", "ret", "capa", "insider", "sched"):
                if k in r and not isinstance(r[k], list):
                    bad.append(f"{code} #{i}: {k} 는 목록이어야 함")
    return bad


# '5억 달러 (약 6,700억원)' 처럼 요약에 직접 적은 원화는 지움 → 사이트 wonize 가 오늘 환율로 다시 붙임 (요약 쓸 때 환율이 제각각이라)
FXW = re.compile(r"(\d[\d,.]*\s?(?:조|천억|억|천만|만)\s?(?:대만달러|홍콩달러|달러|유로|파운드|위안|엔|\$|€|£))\s?\(약\s?[\d,.]+\s?(?:조|억|만)?\s?(?:[\d,.]+\s?(?:억|만)\s?)?원\)")
unfx = lambda v: FXW.sub(r"\1", v) if isinstance(v, str) else [unfx(x) for x in v] if isinstance(v, list) else {k: unfx(x) for k, x in v.items()} if isinstance(v, dict) else v  # noqa: E731


def export():
    D = load()
    bad = check(D)
    if bad:
        sys.exit("rep_digest.yaml 점검 실패:\n" + "\n".join(bad[:20]))
    out = unfx({code: {**v, "reps": [{**r, "d": str(r["d"]), **({"idx": str(r["idx"])} if r.get("idx") else {})} for r in v.get("reps") or []]} for code, v in D.items()})
    J.write_text(json.dumps({"updated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "stocks": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"rep_digest.json: {len(out)}종목 · {sum(len(v.get('reps') or []) for v in out.values())}개")


HEAD = ("# 📑 증권사 리포트 한 장 요약 — tools/rep_digest_task.md 형식 · 기계가 합침 (tools/rep_digest.py merge) · 7개월 지난 건 저절로 빠짐\n"
        "# 코드: {flow 최신 순 흐름, flow_d, reps: [최신이 위로 {d, firm, who, idx|u, tp, tp_prev, dir, val, est, cons, tone, sched, capa, ret, risk, insider, pts…}]}\n")
rkey = lambda r: str(r.get("idx") or r.get("u") or f"{r['d']}|{fk(r.get('firm'))}")  # noqa: E731


def merge(path):
    """새 요약 파일(이번에 쓴 것만) → config/rep_digest.yaml 에 합침: 같은 리포트(idx·u)는 새 것으로, 최신 순, 7개월(214일) 지난 건 뺌, flow 는 새로 쓴 게 있으면 바꿈."""
    if not Path(path).exists():  # Claude 가 넣을 게 없다고 본 때 (같은 리포트가 이미 있음 등)
        print("새 요약 없음")
        return
    N = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    bad = check(N)
    if bad:
        sys.exit(f"{path} 점검 실패:\n" + "\n".join(bad[:20]))
    D, cut = load(), (datetime.now(KST) - timedelta(days=214)).strftime("%Y-%m-%d")
    for code, v in N.items():
        cur = D.setdefault(str(code), {"reps": []})
        new = {rkey(r) for r in v.get("reps") or []}
        L = [*(v.get("reps") or []), *[r for r in cur.get("reps") or [] if rkey(r) not in new]]
        cur["reps"] = sorted([r for r in L if str(r["d"]) >= cut], key=lambda r: str(r["d"]), reverse=True)
        cur.update({k: v[k] for k in ("flow", "flow_d") if v.get(k)})
    Y.write_text(HEAD + yaml.safe_dump(D, allow_unicode=True, sort_keys=False, width=1000), encoding="utf-8")
    print(f"합침: {len(N)}종목 {sum(len(v.get('reps') or []) for v in N.values())}개 → 전체 {sum(len(v['reps']) for v in D.values())}개")


def pdf_text(url, pages=8, cap=14000):
    import pypdf
    import requests
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    r.raise_for_status()
    P = pypdf.PdfReader(io.BytesIO(r.content)).pages
    return "\n".join((p.extract_text() or "") for p in P[:pages])[:cap], len(P)


fk = lambda f: re.sub(r"\s", "", (f or "").replace("한투", "한국"))[:2].upper()  # noqa: E731 - 증권사 앞 두 글자 (app.js fKey 와 같음)


def tg_post(u):
    """텔레그램 공개 글 한 개 글자 (t.me/채널/번호?embed=1)."""
    import requests
    sys.path.insert(0, str(ROOT / "collector"))
    from street import _text
    return _text(requests.get(u + "?embed=1&mode=tme", headers={"User-Agent": "Mozilla/5.0"}, timeout=30).text)


def todo(days=3, mx=10):
    """요약할 것: ① 한경 PDF (우리 종목) ② 한경에 없는 증권사의 텔레그램 '✨ 리서치 요약'(에픽 AI)·해외 증권사 요약(bumgore·aethersemiconductor) 글."""
    R = json.loads((ROOT / "site" / "data" / "reports.json").read_text(encoding="utf-8"))
    D = load()
    have = {str(r.get("idx")) for v in D.values() for r in (v.get("reps") or []) if r.get("idx")}
    have_u = {r.get("u") for v in D.values() for r in (v.get("reps") or []) if r.get("u")}
    cut = (datetime.now(KST) - timedelta(days=days)).strftime("%Y-%m-%d")
    S = {s["code"]: s for s in R["stocks"] if s["market"] == "KR"}
    rows = [(s, x) for s in S.values() for x in s.get("list") or [] if x["d"] >= cut and x.get("u") and x["u"].rsplit("=", 1)[-1] not in have]
    hk = {(s["code"], x["d"], fk(x["firm"])) for s in S.values() for x in s.get("list") or []}
    prev = lambda d: (datetime.strptime(d, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")  # noqa: E731 - 요약 글은 다음 날 아침에 오기도
    try:
        T = json.loads((ROOT / "site" / "data" / "tg_reports.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        T = {}
    for code, L in (T.get("stocks") or {}).items():
        for x in L if code in S else []:
            # 제목에 우리 종목 이름이 있을 때만 (계열사·동종 회사 리포트 '한화시스템 … 한화오션 지분' 같은 건 우리 종목 리포트가 아님 — 11/6 11개 섞였음)
            ok = S[code]["name"] in x.get("t", "") and ((x["ch"] == "ked_epic_ai" and "리서치 요약" in x.get("t", "")) or (x["ch"] in ("bumgore", "aethersemiconductor") and x.get("ib")))  # 에테르 새 채널 (사용자 11/6: 미국·외국계 리포트)
            if ok and x["d"] >= cut and x["u"] not in have_u and not any((code, d, fk(x.get("firm"))) in hk for d in (x["d"], prev(x["d"]))):
                rows.append((S[code], {**x, "tg": True}))
    TXT.mkdir(parents=True, exist_ok=True)
    sent = set((TXT / ".sent").read_text(encoding="utf-8-sig").split()) if (TXT / ".sent").exists() else set()  # 이미 Claude 에 넘긴 파일 (요약할 게 없다고 뺀 글을 매시간 다시 넘기지 않게)
    name = lambda x: f"tg_{x['u'].split('t.me/', 1)[-1].replace('/', '_')}.txt" if x.get("tg") else f"{x['u'].rsplit('=', 1)[-1]}.txt"  # noqa: E731
    rows = sorted([p for p in rows if name(p[1]) not in sent], key=lambda p: (-int(p[1]["d"].replace("-", "")), GRP.get(p[0]["group"], 9)))
    out = []
    for s, x in rows[:mx]:
        if x.get("tg"):  # 텔레그램 요약 글
            f = TXT / name(x)
            if not f.exists():
                try:
                    t = tg_post(x["u"])
                except Exception as e:  # noqa: BLE001
                    print(f"  {s['name']} 텔레그램 글 실패: {str(e)[:60]}", file=sys.stderr)
                    continue
                f.write_text(f"# {s['name']} ({s['code']}) · 묶음 {s['group']} · {x['d']} {x.get('hm', '')} · {x.get('firm', '')} · 텔레그램 {x['ch']}\n# 제목: {x.get('t', '')}\n"
                             f"# 목표가 {x.get('tp')} · 직전 {x.get('tp_prev')} · 방향 {x.get('dir', '')}\n# 원문: {x['u']}\n\n{t}", encoding="utf-8")
                time.sleep(0.5)
            out.append(f"transcripts/reports/{f.name}")
            continue
        k = x["u"].rsplit("=", 1)[-1]
        f = TXT / f"{k}.txt"
        if not f.exists():
            try:
                t, n = pdf_text(x["u"])
            except Exception as e:  # noqa: BLE001 - 한 장 못 받아도 나머지는
                print(f"  {s['name']} {x['firm']} PDF 실패: {str(e)[:60]}", file=sys.stderr)
                continue
            head = (f"# {s['name']} ({s['code']}) · 묶음 {s['group']} · {x['d']} · {x['firm']} · 애널리스트 {x.get('who', '')}\n"
                    f"# 제목: {x['t']}\n# 목표가 {x.get('tp')} · 직전 {x.get('tp_prev')} · 방향 {x.get('tp_dir', '')} · 의견 {x.get('rating', '')}"
                    f"{' ← ' + x['rating_prev'] if x.get('rating_prev') else ''}\n# idx: {k} · 원문: {x['u']} · {n}쪽 중 앞 8쪽\n\n")
            f.write_text(head + t, encoding="utf-8")
            time.sleep(0.5)
        out.append(f"transcripts/reports/{k}.txt")
    # 흐름(flow)을 이어 쓰라고: 그 종목의 지금 flow + 한경 최근 목표가 12개 → transcripts/reports/_ctx.yaml
    tp = lambda v: f"{int(v):,}" if v else "-"  # noqa: E731
    ctx = {c: {"name": S[c]["name"], "flow": (D.get(c) or {}).get("flow", ""),
               "recent": [f"{x['d'][5:]} {x['firm']} {tp(x.get('tp'))}{' (직전 ' + tp(x['tp_prev']) + ')' if x.get('tp_prev') else ''}" for x in (S[c].get("list") or [])[:12]]}
           for c in {s["code"] for s, _ in rows[:mx]}}
    (TXT / "_ctx.yaml").write_text(yaml.safe_dump(ctx, allow_unicode=True, sort_keys=False, width=1000), encoding="utf-8")
    print("\n".join(out))
    return out


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--test"]:
        assert check({"005930": {"flow": "x", "reps": [{"d": "2026-11-04", "firm": "iM증권", "idx": 1, "pts": ["a"]}]}}) == []
        assert check({"005930": {"reps": [{"d": "11/04", "firm": "x", "pts": ["a"]}]}})[0].endswith("11/04")
        assert check({"005930": {"reps": [{"d": "2026-11-04", "firm": "x"}]}}) and check({"005930": [1]})
        assert check({"005930": {"reps": [{"d": "2026-11-04", "firm": "x", "val": "v", "risk": "a"}]}})[0].endswith("목록이어야 함")
        assert rkey({"d": "2026-11-04", "firm": "iM증권", "idx": 653749}) == "653749" and rkey({"d": "2026-11-04", "firm": "IM증권"}) == "2026-11-04|IM"
        assert unfx({"a": ["HBM 매출 60억 달러 (약 8조원) 넘음", "5억$ (약 6,700억원)", "$4/Gb (약 5,400원)"]}) == {"a": ["HBM 매출 60억 달러 넘음", "5억$", "$4/Gb (약 5,400원)"]}
        assert fk("IM증권") == fk("iM증권") and fk("한투") == fk("한국투자증권") and fk("한화투자증권") != fk("한국투자증권")
        print("ok")
    elif a[:1] == ["export"]:
        export()
    elif a[:1] == ["merge"]:
        merge(a[1])
    elif a[:1] == ["todo"]:
        g = lambda k, d: int(a[a.index(k) + 1]) if k in a else d  # noqa: E731
        todo(g("--days", 3), g("--max", 10))
    else:
        print(__doc__)
