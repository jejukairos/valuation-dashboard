"""📰 뉴스 탭: 보유·관심·공동 종목마다 '내 종목' · '경쟁사' · '외신(영어)' 뉴스.
Google 뉴스 RSS 검색(공개 피드, 무료)으로 최근 7일 기사를 받아 cache/news.json 에 30일치를 쌓는다.
여러 언론사가 쓴 같은 기사는 하나로 묶고 몇 곳이 썼는지(n) 남긴다. 검색어·경쟁사는 config/news.yaml."""
import re
import xml.etree.ElementTree as ET
from datetime import timedelta
from email.utils import parsedate_to_datetime

from common import CACHE, HTTP, KST, REPORT, load_yaml, now_kst, read_json, write_json

KEEP_DAYS = 30
CAP = {"own": 15, "rivals": 10, "en": 10, "ib": 10}  # 기사 주소가 길어서 종목당 이 정도만 (뉴스 파일 크기)
EDITION = {"ko": {"hl": "ko", "gl": "KR", "ceid": "KR:ko"}, "en": {"hl": "en-US", "gl": "US", "ceid": "US:en"}}
# 🌍 해외 증권사가 한국 종목에 낸 리포트는 원문이 공개되지 않아서, 그 리포트를 다룬 기사만 모은다 (제목에 종목 + 증권사)
IB = ["골드만", "JP모건", "제이피모건", "모건스탠리", "모건 스탠리", "맥쿼리", "씨티", "노무라", "UBS", "CLSA", "HSBC", "번스타인", "BofA",
      "뱅크오브아메리카", "메릴린치", "도이치", "바클레이즈", "제프리스"]
IB_RE = re.compile("|".join(map(re.escape, IB)), re.I)


def norm(t):
    return re.sub(r"[^0-9a-z가-힣]", "", (t or "").lower())


def _bigrams(t):
    s = norm(t)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def same(a, b):
    """제목을 두 글자씩 쪼갠 조각이 40% 넘게 겹치면 같은 기사(다른 언론사)로 본다."""
    x, y = _bigrams(a), _bigrams(b)
    return bool(x and y) and len(x & y) / len(x | y) >= 0.4


def search(terms, nots=(), lang="ko", ib=False):
    q = " OR ".join(f'"{t}"' for t in terms)
    if ib:  # (종목) (증권사 중 하나) 둘 다 든 기사
        q = f"({q}) ({' OR '.join(chr(34) + w + chr(34) for w in dict.fromkeys(IB))})"
    q += "".join(f" -{w}" for w in nots) + " when:7d"
    r = HTTP.get("https://news.google.com/rss/search", params={"q": q, **EDITION[lang]})
    keys, bad = [norm(t) for t in terms], [norm(w) for w in nots]
    out = []
    for it in ET.fromstring(r.content).findall("./channel/item"):
        src, title = it.findtext("source") or "", it.findtext("title") or ""
        while src and title.endswith(" - " + src):  # 제목 끝의 ' - 언론사' 떼기
            title = title[: -len(src) - 3]
        t = norm(title)
        hit = next((terms[i] for i, k in enumerate(keys) if k in t), None)
        if not hit or any(w in t for w in bad) or (ib and not IB_RE.search(title)):  # 본문에만 검색어가 있는 관계없는 기사는 뺀다
            continue
        out.append({"t": title.strip(), "s": src, "u": it.findtext("link"), "k": hit,
                    "d": parsedate_to_datetime(it.findtext("pubDate")).astimezone(KST).strftime("%Y-%m-%d %H:%M")})
    return out


def merge(old, new, now, cap):
    """새 기사를 쌓아 둔 목록에 합친다: 같은 기사면 언론사(ss)만 늘리고, 30일 지난 건 버린다.
    f = 처음 본 갱신 시각 (now 와 같으면 🆕). 처음 모으는 날(old 가 None)은 🆕 를 달지 않는다."""
    items = [dict(x) for x in old or []]
    for a in sorted(new, key=lambda x: x["d"]):
        hit = next((x for x in items if same(x["t"], a["t"])), None)
        if hit:
            if a["s"] not in hit["ss"]:
                hit["ss"].append(a["s"])
        else:
            items.append({**a, "ss": [a["s"]], "f": now if old is not None else ""})
    cut = (now_kst() - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    return sorted((x for x in items if x["d"] >= cut), key=lambda x: x["d"], reverse=True)[:cap]


def collect(todo):
    cfg = load_yaml("news.yaml") or {}
    cache = read_json(CACHE / "news.json") or {}
    now = now_kst().strftime("%Y-%m-%d %H:%M")
    rows, fails = [], []
    for h, g in todo:
        if h.get("data_code"):  # 우선주는 보통주와 같은 뉴스
            continue
        code, c = str(h["code"]), cfg.get(str(h["code"])) or {}
        mine = cache.setdefault(code, {})
        row = {"code": code, "name": h["name"], "group": g, "also": h.get("_also") or [], "market": h.get("market", "KR").upper(),
               "rival_terms": c.get("rivals") or [], "pins": c.get("pins") or [], "issues": c.get("issues") or []}  # issues = 종목 상세 '📰 핵심 이슈'
        kr = row["market"] == "KR"
        for kind, terms, lang in (("own", c.get("own") or [h["name"]], "ko"), ("rivals", c.get("rivals"), "ko"),
                                  ("en", c.get("en"), "en"), ("ib", (c.get("own") or [h["name"]])[:1] if kr else None, "ko")):
            if terms:
                keys, bad = [norm(t) for t in terms], [norm(w) for w in c.get("not") or ()]
                if mine.get(kind):  # 검색어를 바꾸면 쌓아 둔 기사도 새 검색어로 다시 거른다
                    mine[kind] = [x for x in mine[kind] if any(k in norm(x["t"]) for k in keys) and not any(w in norm(x["t"]) for w in bad)]
                try:
                    mine[kind] = merge(mine.get(kind), search(terms, c.get("not") or (), lang, ib=kind == "ib"), now, CAP[kind])
                except Exception as e:  # noqa: BLE001 - 못 받으면 쌓아 둔 뉴스를 그대로 보여준다
                    fails.append(f"{h['name']} {kind}: {str(e)[:60]}")
            row[kind] = [{"t": x["t"], "s": x["s"], "u": x["u"], "d": x["d"], "k": x.get("k"), "n": len(x["ss"]),
                          "new": x["f"] == now} for x in mine.get(kind) or []]
        rows.append(row)
    write_json(CACHE / "news.json", cache)
    if fails:
        REPORT.fail("뉴스 (Google 뉴스 RSS)", f"{len(fails)}개 검색을 못 받아 직전 뉴스를 보여줘요 — 예: {fails[0]}")
    else:
        REPORT.success("뉴스")
    return {"updated_at": now, "stocks": rows,
            "source": "Google 뉴스 검색 (최근 7일씩 받아 30일치 쌓음 · 검색어는 config/news.yaml)"}


if __name__ == "__main__":  # 혼자 돌려 보기: python collector/news.py
    from common import DATA
    assert same("현대로템, 튀르키예 6.25 참전용사에 새 집 선물", "현대로템, 튀르키예 한국전 참전용사 가정에 새 집 선물")
    assert not same("현대로템, 튀르키예 참전용사에 새 집 선물", "현대로템 K2 전차, 루마니아 수출 기대감")
    m = merge(None, [{"t": "가나다라마", "s": "A", "u": "1", "d": now_kst().strftime("%Y-%m-%d %H:%M")}], "x", 5)
    assert m[0]["f"] == "" and merge(m, [{"t": "가나다라마", "s": "B", "u": "2", "d": m[0]["d"]}], "y", 5)[0]["ss"] == ["A", "B"]
    sy = load_yaml("stocks.yaml")
    todo = [(h, g) for key, g in (("holdings", "보유"), ("watchlist", "관심"), ("joint", "공동")) for h in (sy.get(key) or [])]
    write_json(DATA / "news.json", collect(todo))
    print(REPORT.failures or "ok")
