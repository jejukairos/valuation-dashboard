"""📨 텔레그램 API 로만 읽히는 리포트 채널 (공개 미리보기가 꺼진 곳) — 이 컴퓨터에서만 (Windows 작업 스케줄러 07:45·17:45).
사용자 허락(2026-11-01): ~/.tg-secrets 의 기존 연결(telegram.json api_id·api_hash + session.session)을 그 자리에서 읽기만 함 —
값을 화면에 찍거나 파일 밖으로 옮기지 않음. 결과 = site/data/tg_api.json (서버의 tg_reports.json 과 화면에서 합침).
채널마다 최근 7개월 글을 받아 보유·관심·공동 종목 이름·코드가 나온 글만 (collector/tg_reports.parse 와 같은 칸).
사용: .venv\\Scripts\\python.exe tools\\tg_api_reports.py [--push]"""
import asyncio
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "collector"))
from common import DATA, load_yaml, now_kst, write_json  # noqa: E402
from tg_reports import DAYS, parse  # noqa: E402

SECRETS = Path.home() / ".tg-secrets"
CHANNELS = {"YoungTiger_stock": "KR", "DOC_POOL": "KR", "aethersemiresearch": "US"}  # 사용자 '리포트자료모음' 중 미리보기가 꺼진 3곳
MAX_MSGS = 20000  # 채널당 최대 (7개월이 먼저 끝나면 거기서 멈춤)


def hit(text, names, us):
    """종목 이름·코드가 글에 있나 — '두산'이 '두산에너빌리티'에 걸리지 않게 이름 뒤에 글자가 바로 붙으면 뺌, 미국 티커는 단어로."""
    for n in names:
        if re.fullmatch(r"[A-Z]{1,5}", n):
            if re.search(rf"(?<![A-Za-z]){n}(?![A-Za-z])", text):  # $NVDA 같은 캐시태그도
                return True
        elif re.search(rf"{re.escape(n)}(?![가-힣A-Za-z])", text):
            return True
    return False


async def fetch(cut):
    from telethon import TelegramClient
    cfg = json.loads((SECRETS / "telegram.json").read_text(encoding="utf-8"))
    out = {}
    async with TelegramClient(str(SECRETS / "session"), cfg["api_id"], cfg["api_hash"]) as client:
        for ch in CHANNELS:
            msgs = []
            try:
                async for m in client.iter_messages(ch, limit=MAX_MSGS):
                    if m.date < cut:
                        break
                    if m.message:
                        msgs.append((m.id, m.date, m.message))
            except Exception as e:  # noqa: BLE001 - 한 채널이 안 돼도 나머지는
                print(f"  {ch}: 실패 {type(e).__name__}")
            out[ch] = msgs
            print(f"  {ch}: 글 {len(msgs)}개")
    return out


def main():
    cut = datetime.now(timezone.utc) - timedelta(days=DAYS)
    for i in range(3):  # 다른 프로그램(telegram-stock-review)이 같은 연결을 쓰는 중이면 'database is locked' → 잠깐 뒤 다시
        try:
            raw = asyncio.run(fetch(cut))
            break
        except Exception as e:  # noqa: BLE001
            if "locked" not in str(e) or i == 2:
                raise
            import time
            time.sleep(60)
    sy = load_yaml("stocks.yaml")
    stocks, seen = {}, set()
    for h in [x for k in ("holdings", "watchlist", "joint") for x in (sy.get(k) or [])]:
        code = str(h["code"])
        if h.get("data_code") or code in seen:
            continue
        seen.add(code)
        us = h.get("market", "KR").upper() == "US"
        names = [h["name"]] + ([code] if len(code) > 1 else []) + (["구글", "GOOGL"] if code == "GOOG" else [])
        posts = []
        for ch, mk in CHANNELS.items():
            if (mk == "US") != us:
                continue
            for mid, dt, text in raw.get(ch, []):
                if hit(text, names, us):
                    posts.append({"d": dt.astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%d"), "ch": ch,
                                  "u": f"https://t.me/{ch}/{mid}", **parse(text, names)})
        if posts:
            stocks[code] = sorted(posts, key=lambda p: p["d"], reverse=True)[:30]
    write_json(DATA / "tg_api.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "channels": list(CHANNELS),
                                      "msgs": {ch: len(v) for ch, v in raw.items()}, "stocks": stocks})
    print(f"■ 텔레그램 API 채널: 종목 {len(stocks)}개 · 글 {sum(len(v) for v in stocks.values())}개")
    if "--push" in sys.argv:  # 이 파일만 올림 (다른 작업과 겹치면 다시 얹어서)
        git = lambda *a: subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True)  # noqa: E731
        git("add", "site/data/tg_api.json")
        if git("diff", "--cached", "--quiet").returncode:
            git("commit", "-m", f"텔레그램 API 채널 {now_kst():%Y-%m-%d %H:%M}")
            for _ in range(3):
                git("pull", "--rebase", "--autostash", "-q", "origin", "main")
                if git("push", "-q", "origin", "main").returncode == 0:
                    print("  올림")
                    break


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        assert hit("9. 두산(000150) 목표가 상향", ["두산", "000150"], False) and not hit("두산에너빌리티 수주", ["두산"], False)
        assert hit("NVDA beats, $MU next", ["엔비디아", "NVDA"], True) and not hit("NVDAX fund", ["NVDA"], True)
        print("ok")
    else:
        main()
