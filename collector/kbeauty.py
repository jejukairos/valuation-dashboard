"""🏭 산업 탭: 아마존 K-뷰티 Top100 — 텔레그램 공개 채널 3곳 글을 읽어 날마다 쌓고 서로 맞춰 본다(크로스체크).
- 다올 박종현 (alexppark) 'Amazon K-Beauty 데일리': 나라별 순위 변동(⚡⚠️❌🆕) + 가끔 '📌 브랜드별 품목 수' 글
- 교보 (kyobofnbcosmetic) '아마존 K-뷰티 데일리': 나라별 K-뷰티 품목 수(= Top100 내 비중 %) + 6개국 브랜드별 합계
- 한투 김명주 (kmj_retailcosmetics) '브랜드별 제품 수': 에이피알·달바 등 나라별 품목 수 + 제품별 순위
나라×브랜드 표 = 다올 글의 품목 수가 있으면 그 값, 없으면 전날 표 − 탈락 + 신규 (config/amazon_kbeauty.yaml 에 손으로 옮긴 날이 우선)."""
import re
from datetime import timedelta

import pandas as pd

from common import CACHE, HTTP, REPORT, load_yaml, now_kst, read_json, write_json
from street import _text

C6 = ["미국", "영국", "독일", "프랑스", "스페인", "이탈리아"]
FLAG = {"🇺🇸": "미국", "🇬🇧": "영국", "🇩🇪": "독일", "🇫🇷": "프랑스", "🇪🇸": "스페인", "🇮🇹": "이탈리아"}
SRC = {"daol": ("alexppark", "Amazon K-Beauty 데일리"), "kyobo": ("kyobofnbcosmetic", "아마존 K-뷰티 데일리"),
       "kmj": ("kmj_retailcosmetics", "브랜드별 제품 수")}


def _posts(channel, q, days=30):
    """공개 미리보기 검색 결과를 최근 days 일치까지 (한 쪽 20개씩 뒤로 넘김)."""
    out, before, cut = [], None, (now_kst() - timedelta(days=days)).strftime("%Y-%m-%d")
    for _ in range(6):
        html = HTTP.get(f"https://t.me/s/{channel}", params={"q": q, **({"before": before} if before else {})}).text
        blocks = html.split('data-post="')[1:]
        if not blocks:
            break
        for b in blocks:
            dt = re.search(r'datetime="([^"]+)"', b)
            if dt:
                out.append((b.split('"', 1)[0], pd.Timestamp(dt.group(1)).tz_convert("Asia/Seoul"), _text(b)))
        before = min(int(b.split('"', 1)[0].split("/")[1]) for b in blocks)
        if min(x[1] for x in out).strftime("%Y-%m-%d") < cut:
            break
    return out


def parse_daol(t):
    m = re.search(r"Amazon K-Beauty 데일리 \((\d{4}-\d{2}-\d{2})\)", t)
    if not m:
        return None
    c, block, counts, moves = None, False, {}, []
    for line in t.splitlines():
        s = line.strip()
        f = next((v for k, v in FLAG.items() if s.startswith(k)), None)
        if f:
            c, block = f, False
        elif s.startswith("📌"):
            block = True
        elif not s:
            block = False
        elif block and c:
            x = re.match(r"(.+?)\s+(\d+)$", s)
            if x:
                counts.setdefault(c, {})[x.group(1).strip()] = int(x.group(2))
        elif c:
            x = re.match(r"(⚡|⚠️?|❌|🆕)\s*(.+?)\s{2,}(.+?)\s+#(\d+)\s*(.*)$", s)
            if x:
                tail = x.group(5)
                chg = re.search(r"([▲▼])(\d+)", tail)
                moves.append({"c": c, "b": x.group(2).strip(), "t": x.group(3).strip(), "rank": int(x.group(4)),
                              **({"out": True} if "탈락" in tail else {}), **({"new": True} if "신규" in tail else {}),
                              **({"chg": int(chg.group(2)) * (1 if chg.group(1) == "▲" else -1)} if chg else {})})
    return m.group(1), {"counts": counts, "moves": moves}


def parse_kyobo(t):
    m = re.search(r"아마존 K-뷰티 데일리 \((\d{2})\.(\d{2})\.(\d{2})\)", t)
    if not m:
        return None
    share = {FLAG[f]: int(v) for f, v in re.findall(r"(🇺🇸|🇬🇧|🇩🇪|🇫🇷|🇪🇸|🇮🇹) \S+ (?:잠정 )?(\d+)%", t)}
    tot = re.search(r"6개국 합계 (?:잠정 )?[\d.]+% \((\d+)개\)", t)
    brands = {b.strip(): int(n) for b, n in re.findall(r"^\d+위 (.+?) (\d+)개", t, re.M)}
    return f"20{m.group(1)}-{m.group(2)}-{m.group(3)}", {"countries": share, "total": int(tot.group(1)) if tot else None, "brands": brands}


def parse_kmj(t, year):
    m = re.search(r"브랜드별 제품 수\((\d{1,2})/(\d{1,2})\)", t)
    if not m:
        return None
    brands, ranks, cur = {}, {}, None
    for line in t.splitlines():
        x = re.match(r"\d+\. (.+?) Top 100 내 제품 수: (.+)$", line.strip())
        if x:
            cur = x.group(1).strip()
            brands[cur] = {c: int(n) for c, n in re.findall(r"(\S+) (\d+)개", x.group(2))}
            continue
        x = re.match(r"- (.+?): (.+)$", line.strip())
        if x and cur:
            ranks.setdefault(cur, {})[x.group(1).strip()] = {c: int(n) for c, n in re.findall(r"(\S+) (\d+)위", x.group(2))}
    return f"{year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}", {"brands": brands, "ranks": ranks}


def build(cache, cfg):
    """날짜별 나라×브랜드 표: 손으로 옮긴 날 > 다올 글의 품목 수 > 전날 − 탈락 + 신규."""
    alias = cfg.get("aliases") or {}
    nm = lambda b: alias.get(b, b)  # noqa: E731
    img = read_json(CACHE / "kbeauty_img.json") or {}  # 다올 그림 표를 내 컴퓨터의 Claude 가 옮긴 것 (tools/amazon_img.py)
    manual = cfg.get("days") or {}
    days, prev = {}, None
    for d in sorted(set(cache["daol"]) | set(manual) | set(img)):
        dl, man = cache["daol"].get(d) or {}, manual.get(d) or img.get(d) or {}
        if man.get("counts"):
            counts = {nm(b): list(v) for b, v in man["counts"].items()}
            how = "다올 표 그림 (손으로 옮김)" if d in manual else "다올 표 그림 (Claude 가 옮기고 합계 점검)"
        elif prev is not None or dl.get("counts"):
            counts = {b: list(v) for b, v in (prev or {}).items()}
            how = "다올 글 품목 수" if len(dl.get("counts") or {}) == 6 else "추정: 전날 표 − 탈락 + 신규 (빠진 날이 있으면 틀릴 수 있어요)"
            for i, c in enumerate(C6):
                if c in (dl.get("counts") or {}):  # 그 나라 품목 수가 글에 있으면 그 값
                    for b in counts:
                        counts[b][i] = 0
                    for b, n in dl["counts"][c].items():
                        counts.setdefault(nm(b), [0] * 6)[i] = n
                    continue
                for mv in dl.get("moves") or []:
                    if mv["c"] == c and (mv.get("out") or mv.get("new")):
                        row = counts.setdefault(nm(mv["b"]), [0] * 6)
                        row[i] = max(0, row[i] + (1 if mv.get("new") else -1))
        else:
            continue
        counts = {b: v for b, v in counts.items() if any(v)}
        moves = man.get("moves") or [{**m, "b": nm(m["b"])} for m in dl.get("moves") or []]
        ky, km = cache["kyobo"].get(d), cache["kmj"].get(d)
        days[d] = {"counts": counts, "how": how, "moves": moves, "derived": man.get("derived"),
                   "kyobo": ky and {**ky, "brands": {nm(b): n for b, n in ky["brands"].items()}},
                   "kmj": km and {**km, "brands": {nm(b): v for b, v in km["brands"].items()},
                                  "ranks": {nm(b): v for b, v in km["ranks"].items()}}}
        prev = counts
    return days


def collect():
    cfg = load_yaml("amazon_kbeauty.yaml") or {}
    cache = read_json(CACHE / "kbeauty.json") or {}
    for k in SRC:
        cache.setdefault(k, {})
    fails = []
    for k, (ch, q) in SRC.items():
        try:
            for pid, dt, t in _posts(ch, q, days=30 if not cache[k] else 4):
                r = parse_daol(t) if k == "daol" else parse_kyobo(t) if k == "kyobo" else parse_kmj(t, dt.year)
                if r:
                    cache[k][r[0]] = {**r[1], "url": f"https://t.me/{pid}"}
        except Exception as e:  # noqa: BLE001 - 한 채널이 막혀도 쌓아 둔 값으로 보여준다
            fails.append(f"{ch}: {str(e)[:60]}")
    write_json(CACHE / "kbeauty.json", cache)
    if fails:
        REPORT.fail("아마존 K-뷰티 (텔레그램)", "; ".join(fails))
    else:
        REPORT.success("아마존 K-뷰티 (텔레그램)")
    return {**{k: v for k, v in cfg.items() if k not in ("days", "aliases")}, "countries": C6, "days": build(cache, cfg),
            "channels": {k: f"https://t.me/{ch}" for k, (ch, _) in SRC.items()}}


if __name__ == "__main__":  # 혼자 돌려 보기: python collector/kbeauty.py
    from common import DATA
    write_json(DATA / "amazon_kbeauty.json", collect())
    print(REPORT.failures or "ok")
