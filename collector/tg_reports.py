"""📨 텔레그램 리포트 채널 (사용자 '리포트자료모음' 폴더): 보유·관심·공동 종목 이름·코드로 공개 미리보기(t.me/s/…)를 검색해
오늘 기준 7개월 안의 글 → site/data/tg_reports.json (tg.yml: 매일 07:30·17:30 + 일~목 19:30~01:30 매시간, 본 갱신과 따로).
한국 종목 = KR 채널, 미국 종목 = US 채널. 원문은 링크로만 — 제목·종목이 나온 줄·숫자(목표주가, 12M Fwd 영업이익 추정치 1주 변화)만 저장.
미리보기가 꺼진 채널(OFF)은 텔레그램 API 가 있어야 읽혀서 아직 빠짐."""
import re
import sys

import pandas as pd

from common import DATA, HTTP, load_yaml, now_kst, write_json
from street import _text

KR_CH = ["report_figure_by_offset", "ked_epic_ai", "maddingStock"]
US_CH = ["Fundeasyearnings", "fundeasy_choi"]
OFF = ["YoungTiger_stock", "DOC_POOL", "aethersemiresearch"]  # t.me/s 미리보기가 꺼져 있음 (2026-11-01 확인)
DAYS, PAGES = 214, 3  # 7개월 · 검색어마다 최대 3쪽(쪽당 약 20글)


def search(ch, q, cut):
    """채널에서 q 로 검색 → [{id, d, text}] (cut 보다 오래된 글이 나오면 그만, 최대 PAGES 쪽)."""
    out, before = [], None
    for _ in range(PAGES):
        html = HTTP.get(f"https://t.me/s/{ch}", params={"q": q, **({"before": before} if before else {})}, tries=2, timeout=20).text
        blocks = html.split('data-post="')[1:]
        if not blocks:
            break
        for b in blocks:
            pid, dt, t = b.split('"', 1)[0], re.search(r'datetime="([^"]+)"', b), _text(b)
            if t and dt:
                ts = pd.Timestamp(dt.group(1)).tz_convert("Asia/Seoul")
                out.append({"id": pid, "d": ts.strftime("%Y-%m-%d"), "hm": ts.strftime("%H:%M"), "text": t})
        oldest = min((x["d"] for x in out), default=cut)
        before = min(int(b.split('"', 1)[0].rsplit("/", 1)[-1]) for b in blocks)
        if oldest < cut or len(blocks) < 15:
            break
    return [x for x in out if x["d"] >= cut]


FIRM = r"([가-힣A-Za-z&]+(?:투자증권|증권|자산운용|리서치|Securities))"


def about(text, names):
    """종목 이름이 증권사(키움증권 등)면 다른 종목 리포트의 '글쓴 증권사'로도 나와서, 첫 줄(제목)에 있거나 종목 코드가 있을 때만 그 종목 글."""
    return not names[0].endswith("증권") or names[0] in text.strip().split("\n", 1)[0] or any(c in text for c in names[1:])


def parse(text, names):
    """글 → {t 제목, s 종목이 나온 줄, tp 목표주가, firm 증권사, dir 상향·하향·유지, est_w 12M Fwd 영업이익 1주 변화 %}."""
    lines = [x.strip() for x in text.split("\n") if x.strip()]
    title = lines[0][:140] if lines else ""
    i = next((k for k, x in enumerate(lines) if any(n in x for n in names)), None)
    out = {"t": title, "s": " ".join(lines[i:i + 2])[:160] if i is not None and i > 0 else ""}
    own = any(n in title for n in names)  # 제목에 그 종목이 있는 글 (리포트 요약) — 여러 종목 표는 그 줄만
    row = next((re.search(rf"{re.escape(n)}\s*\|\s*([\d,]{{5,}})\s*\|\s*{FIRM}", text) for n in names if re.search(rf"{re.escape(n)}\s*\|", text)), None)
    # '목표주가 540,000원 >> 435,000원' (ked_epic_ai 요약) 은 화살표 뒤가 새 목표가, 앞은 tp_prev
    tp = re.search(r"(?:목표\s*주?가|TP)\s*(?:\([^)]*\))?\s*[:：]?\s*([\d,]{5,})\s*원(?:\s*(?:>>|→|->|➡️?|▶)\s*([\d,]{5,})\s*원)?", text) if own else None
    if row:  # '[리서치] 목표주가 상향/하향 보고서' 표: 종목 | 목표가 | 증권사
        out.update(tp=float(row.group(1).replace(",", "")), firm=row.group(2))
    elif tp:
        out["tp"] = float((tp.group(2) or tp.group(1)).replace(",", ""))
        if tp.group(2):
            out["tp_prev"] = float(tp.group(1).replace(",", ""))
        f = next((m.group(1) for m in re.finditer(FIRM, text) if m.group(1) not in names), None)  # 종목이 증권사(키움증권)면 그 이름은 건너뜀
        if f:
            out["firm"] = f
    if own and (d := re.search(r"목표\s*주?가\s*(상향|하향|유지)", title)):
        out["dir"] = d.group(1)
    if "추정치 변화" in title and "1주" in title:
        m = next((re.search(rf"\d+\.\s*{re.escape(n)}\s*([+-]\d+(?:\.\d+)?)%", text) for n in names if re.search(rf"\d+\.\s*{re.escape(n)}\s*[+-]", text)), None)
        if m:
            out["est_w"] = float(m.group(1))
    return out


def collect():
    sy = load_yaml("stocks.yaml")
    cut = (now_kst() - pd.Timedelta(days=DAYS)).strftime("%Y-%m-%d")
    out, fails, seen_codes = {}, [], set()
    for h in [x for k in ("holdings", "watchlist", "joint") for x in (sy.get(k) or [])]:
        code = str(h["code"])
        if h.get("data_code") or code in seen_codes:
            continue
        seen_codes.add(code)
        us = h.get("market", "KR").upper() == "US"
        names = [h["name"]] + ([code] if len(code) > 1 else []) + (["구글", "GOOGL"] if code == "GOOG" else [])  # 'O'(리얼티 인컴) 같은 한 글자 티커는 검색어로 안 씀
        posts = {}
        for ch in US_CH if us else KR_CH:
            for q in names:
                try:
                    for x in filter(lambda x: about(x["text"], names), search(ch, q, cut)):
                        posts.setdefault(x["id"], {"d": x["d"], "ch": ch, "u": f"https://t.me/{x['id']}", **parse(x["text"], names)})
                except Exception as e:  # noqa: BLE001 - 한 채널이 막혀도 나머지는 모은다
                    fails.append(f"{ch} {q}: {str(e)[:50]}")
        out[code] = sorted(posts.values(), key=lambda p: p["d"], reverse=True)[:30]
        print(f"  {h['name']}: {len(out[code])}개")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "days": DAYS, "kr": KR_CH, "us": US_CH, "off": OFF,
            "fails": fails[:30], "stocks": out}


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:  # 자체 점검: 퀀트 시그널 글에서 그 종목의 1주 변화·목표주가 줄
        t = ("[퀀트 시그널] 12M Fwd 영업이익 추정치 변화 | 1주간 변화\n📉 하위 10개 기업 (1주간 변화)\n8. 롯데에너지머티리얼즈 -32.2%\n9. 롯데쇼핑 -7.7%\n10. 로보티즈 -6.2%")
        p = parse(t, ["롯데쇼핑", "023530"])
        assert p["est_w"] == -7.7 and p["s"].startswith("9. 롯데쇼핑") and "tp" not in p, p
        p = parse("[✨ 리서치 요약] 롯데쇼핑 목표주가 하향 리포트 요약\n하나증권: 목표주가 155,000원\n투자의견 Buy", ["롯데쇼핑", "023530"])
        assert p["tp"] == 155000 and p["firm"] == "하나증권" and p["dir"] == "하향" and "est_w" not in p, p
        p = parse("[✨ 리서치 요약] 에이피알 목표주가 하향 리포트 요약\n목표주가 540,000원 >> 435,000원 | 투자의견 매수-유지 | 유안타증권", ["에이피알", "278470"])
        assert (p["tp"], p["tp_prev"], p["firm"], p["dir"]) == (435000, 540000, "유안타증권", "하향"), p
        assert not about("[✨ 리서치 요약] 에이피알 목표주가 하향\n목표주가 460,000원 | 키움증권", ["키움증권", "039490"])
        assert about("[키움증권 / 증권]\n3분기 순이익 증가", ["키움증권", "039490"]) and about("에이피알 | 키움증권", ["에이피알", "278470"])
        assert parse("[키움증권 / 증권]\n목표주가 370,000원\n한국투자증권", ["키움증권", "039490"])["firm"] == "한국투자증권"
        p = parse("[✨ 리서치] 목표주가 상향/하향 보고서\n- 롯데쇼핑 | 120,000 | 하나증권\n- 롯데케미칼 | 60,000 | 하나증권", ["롯데쇼핑"])
        assert p["tp"] == 120000 and p["firm"] == "하나증권" and "dir" not in p, p
        assert "est_w" not in parse("[퀀트 시그널] 12M Fwd 영업이익 추정치 변화 | 1주간 변화\n1. 롯데에너지머티리얼즈 +3.1%", ["롯데쇼핑"])
        assert "tp" not in parse("오늘 실적발표 예정\n• 롯데쇼핑 (023530)\n• 신세계 목표주가 300,000원", ["롯데쇼핑"])  # 다른 종목 목표가는 안 잡음
        print("ok")
    else:
        d = collect()
        write_json(DATA / "tg_reports.json", d)
        print(f"■ 텔레그램 리포트 채널: {sum(len(v) for v in d['stocks'].values())}개 · 실패 {len(d['fails'])}")
