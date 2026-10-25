"""미국 보유종목 '월가 의견': 증권사 의견·목표주가 변경(야후) + 텔레그램 리서치 채널(에테르·본루팡·펀디지) 글 (공개 미리보기 검색)."""
import html as H
import re

import pandas as pd

from common import HTTP, now_kst, rnd

ACTION = {"up": "상향", "down": "하향", "init": "신규", "main": "유지", "reit": "재확인"}
PT_ACTION = {"Raises": "올림", "Lowers": "내림", "Maintains": "유지", "Announces": "신규", "Sets": "신규"}


def ratings(code, days=90):
    """최근 days 일 증권사 의견 변경: 날짜·증권사·의견(이전→지금)·목표주가(이전→지금)."""
    import yfinance as yf
    ud = yf.Ticker(code).upgrades_downgrades
    if ud is None or ud.empty:
        return None
    ud = ud.copy()
    ud.index = pd.to_datetime(ud.index).tz_localize(None)
    cut = pd.Timestamp(now_kst().date()) - pd.Timedelta(days=days)
    r = ud[ud.index >= cut].sort_index(ascending=False)
    rows = []
    for d, x in r.iterrows():
        pt, prior = x.get("currentPriceTarget"), x.get("priorPriceTarget")
        rows.append({"date": d.strftime("%Y-%m-%d"), "firm": x["Firm"], "action": ACTION.get(x["Action"], x["Action"]),
                     "from": x.get("FromGrade") or "", "to": x.get("ToGrade") or "",
                     "pt": rnd(pt, 0) if pt and pt == pt and pt > 0 else None,
                     "prior": rnd(prior, 0) if prior and prior == prior and prior > 0 else None,
                     "pt_action": PT_ACTION.get(x.get("priceTargetAction"), x.get("priceTargetAction") or "")})
    n = lambda f: sum(1 for x in rows if f(x))  # noqa: E731
    return {"days": days, "rows": rows[:25],
            "summary": {"up": n(lambda x: x["action"] == "상향"), "down": n(lambda x: x["action"] == "하향"),
                        "raise": n(lambda x: x["pt_action"] == "올림"), "lower": n(lambda x: x["pt_action"] == "내림"),
                        "count": len(rows)}}


def _text(block):
    m = re.search(r'<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', block, re.S)
    if not m:
        return ""
    t = re.sub(r"<br\s*/?>", "\n", m.group(1))
    t = re.sub(r"<[^>]+>", "", t)
    return H.unescape(t).strip()


CHANNELS = [("aetherjapanresearch", "에테르"), ("bornlupin", "본루팡"), ("fundeasy_choi", "펀디지")]  # 앞 채널이 우선 (겹치면 앞 채널 글만 남김)


def _sig(p):
    """겹침 비교용: 제목+앞부분에서 공백·기호를 뺀 글자 2개 묶음."""
    s = re.sub(r"[\W_]+", "", (p["title"] + p["excerpt"][:150]).lower())
    return {s[i:i + 2] for i in range(len(s) - 1)}


def _same(a, b):
    x, y = _sig(a), _sig(b)
    return bool(x and y) and len(x & y) / len(x | y) >= 0.4


def woosan():
    """우산(NNN) 텔레그램 채널(@WoosanXNNN)의 주간 밸류에이션 숫자 — 사이트 숫자 크로스체크용.
    KOSPI·코스닥·S&P500 12m fwd P/E(3·5년 평균), 12m fwd 순이익·EPS, 매그7 12m P/E."""
    texts = []
    for q in ("12m fwd P/E", "Magnificent 7"):
        html = HTTP.get("https://t.me/s/WoosanXNNN", params={"q": q}).text
        for b in html.split('data-post="')[1:]:
            dt = re.search(r'datetime="([^"]+)"', b)
            t = _text(b)
            if t and dt:
                texts.append((dt.group(1), b.split('"', 1)[0], t))
    texts.sort(reverse=True)  # 최신 글부터
    pats = {"kospi_pe": r"KOSPI 12m fwd P/E\s*:?\s*([\d.]+)x", "kospi_pe3": r"KOSPI 12m fwd P/E 3yr Avg\.?\s*([\d.]+)x",
            "kospi_pe5": r"KOSPI 12m fwd P/E 5yr Avg\.?\s*([\d.]+)x", "kospi_ni": r"KOSPI 12m fwd 순이익\(지배[^)]*\)\s*:?\s*([\d,.]+)",
            "kosdaq_pe": r"코스닥 12m fwd P/E\s*:?\s*([\d.]+)x", "sp_pe": r"S&P500 12m fwd P/E\s*:?\s*([\d.]+)x",
            "sp_pe3": r"S&P500 12m fwd P/E 3yr Avg\.?\s*([\d.]+)x", "sp_pe5": r"S&P500 12m fwd P/E 5yr Avg\.?\s*([\d.]+)x",
            "sp_eps": r"S&P500 12m fwd EPS\s*:?\s*([\d,.]+)"}
    out, mag7 = {}, {}
    for dt, pid, t in texts:
        for k, p in pats.items():
            m = re.search(p, t)
            if m and k not in out:
                out[k] = float(m.group(1).replace(",", ""))
                out.setdefault("date", pd.Timestamp(dt).tz_convert("Asia/Seoul").strftime("%Y-%m-%d"))
                out.setdefault("url", f"https://t.me/{pid}")
        if not mag7 and "Magnificent 7" in t:
            mag7 = {s: float(v) for s, v in re.findall(r"^(GOOGL|NVDA|AAPL|MSFT|AMZN|META|TSLA)\s+([\d.]+)x", t, re.M)}
            if mag7:
                out["mag7_date"] = pd.Timestamp(dt).tz_convert("Asia/Seoul").strftime("%Y-%m-%d")
    if not out:
        raise RuntimeError("우산 채널에서 숫자를 못 찾음")
    out["mag7"] = mag7
    return out


def channel_posts(terms, limit=12, channel=None, per_channel=5):
    """채널 공개 미리보기(t.me/s/…)에서 검색어마다 글을 찾아 최신순으로. 본문은 앞부분만 (전체는 원문 링크).
    channel 을 안 주면 CHANNELS 전부를 합치고, 같은 내용(제목·앞부분이 40% 넘게 겹침)은 하나만 남긴다.
    채널마다 최대 per_channel 개, 제목에 종목 이름이 들어간 글을 먼저 고른다 (스쳐 지나가는 언급은 뒤로)."""
    if channel is None:
        allp = []
        for ch, label in CHANNELS:
            try:
                got = channel_posts(terms, limit=20, channel=ch)
            except Exception:  # noqa: BLE001 - 한 채널이 막혀도 나머지는 보여준다
                continue
            got.sort(key=lambda p: (not any(t.lower() in p["title"].lower() for t in terms), p["date"] and -pd.Timestamp(p["date"]).value))
            picked = 0
            for p in got:
                if picked >= per_channel:
                    break
                p["ch"] = label
                dup = next((q for q in allp if _same(p, q)), None)
                if dup:
                    if dup["ch"] != label and label not in dup.get("also", []):
                        dup.setdefault("also", []).append(label)  # 다른 채널에도 같은 내용
                    continue
                allp.append(p)
                picked += 1
        return sorted(allp, key=lambda x: x["date"], reverse=True)[:limit]
    seen = {}
    for q in terms:
        html = HTTP.get(f"https://t.me/s/{channel}", params={"q": q}).text
        for b in html.split('data-post="')[1:]:
            pid = b.split('"', 1)[0]
            dt = re.search(r'datetime="([^"]+)"', b)
            txt = _text(b)
            if not txt or pid in seen:
                continue
            first = txt.split("\n", 1)[0].strip()
            body = txt[len(first):].strip().replace("내용 요약", "", 1).strip()
            seen[pid] = {"id": pid, "url": f"https://t.me/{pid}",
                         "date": pd.Timestamp(dt.group(1)).tz_convert("Asia/Seoul").strftime("%Y-%m-%d %H:%M") if dt else "",
                         "title": first[:160], "excerpt": body[:600], "match": q}
    return sorted(seen.values(), key=lambda x: x["date"], reverse=True)[:limit]
