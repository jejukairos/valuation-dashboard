"""미국 보유종목 '월가 의견': 증권사 의견·목표주가 변경(야후) + 에테르 텔레그램 리서치 채널 글(공개 미리보기 검색)."""
import html as H
import re

import pandas as pd

from common import HTTP, now_kst, rnd

CHANNEL = "aetherjapanresearch"
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


def channel_posts(terms, limit=6):
    """채널 공개 미리보기(t.me/s/…)에서 검색어마다 글을 찾아 최신순으로. 본문은 앞부분만 (전체는 원문 링크)."""
    seen = {}
    for q in terms:
        html = HTTP.get(f"https://t.me/s/{CHANNEL}", params={"q": q}).text
        for b in html.split('data-post="')[1:]:
            pid = b.split('"', 1)[0]
            dt = re.search(r'datetime="([^"]+)"', b)
            txt = _text(b)
            if not txt or pid in seen:
                continue
            first = txt.split("\n", 1)[0].strip()
            body = txt[len(first):].strip().replace("내용 요약", "", 1).strip()
            seen[pid] = {"id": pid.split("/")[-1], "url": f"https://t.me/{pid}",
                         "date": pd.Timestamp(dt.group(1)).tz_convert("Asia/Seoul").strftime("%Y-%m-%d %H:%M") if dt else "",
                         "title": first[:160], "excerpt": body[:600], "match": q}
    return sorted(seen.values(), key=lambda x: x["date"], reverse=True)[:limit]
