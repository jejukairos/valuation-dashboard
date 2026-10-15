"""공통 도구: HTTP 요청(지연·재시도), JSON 저장, 실패 기록."""
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data"
CACHE = ROOT / "cache"
KST = timezone(timedelta(hours=9))

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130 Safari/537.36")


def now_kst():
    return datetime.now(KST)


def load_yaml(name):
    with open(ROOT / "config" / name, encoding="utf-8") as f:
        return yaml.safe_load(f)


SETTINGS = load_yaml("settings.yaml")
DELAY = float(SETTINGS.get("request_delay", 1.0))


class Http:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"})
        self.last = 0.0

    def get(self, url, tries=3, timeout=40, **kw):
        err = None
        for i in range(tries):
            wait = DELAY - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            try:
                r = self._get_deadline(url, timeout, **kw)
                self.last = time.time()
                if r.status_code == 200:
                    return r
                err = f"HTTP {r.status_code}"
                if r.status_code in (401, 402, 403, 404):
                    break
            except requests.RequestException as e:
                self.last = time.time()
                err = type(e).__name__
            time.sleep(2 * (i + 1))
        raise RuntimeError(f"{url.split('?')[0]} 접속 실패 ({err})")

    def _get_deadline(self, url, timeout, **kw):
        """느리게 조금씩 오는 응답도 전체 시간(timeout×2)을 넘기면 끊는다."""
        start = time.time()
        r = self.s.get(url, timeout=timeout, stream=True, **kw)
        chunks = []
        for c in r.iter_content(65536):
            chunks.append(c)
            if time.time() - start > timeout * 2:
                r.close()
                raise requests.Timeout("전체 응답 시간 초과")
        r._content = b"".join(chunks)
        r._content_consumed = True
        return r


HTTP = Http()


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False, default=_clean)
    os.replace(tmp, path)


def _clean(o):
    if hasattr(o, "item"):
        return o.item()
    return str(o)


def num(x):
    """'1,234.5원' 같은 문자열 → 숫자. 실패하면 None."""
    if x is None:
        return None
    if isinstance(x, (int, float)):
        if x != x or x in (float("inf"), float("-inf")):
            return None
        return float(x)
    s = str(x).replace(",", "").replace("%", "").replace("배", "").replace("원", "").strip()
    try:
        v = float(s)
        return v if v == v else None
    except ValueError:
        return None


def rnd(x, n=2):
    return None if x is None else round(float(x), n)


class Report:
    """수집 결과 기록. 실패한 항목은 화면에 그대로 보여준다."""

    def __init__(self):
        self.failures = []
        self.ok = []
        self.blocked = []

    def fail(self, item, reason):
        print(f"  ✗ {item}: {reason}")
        self.failures.append({"item": item, "reason": str(reason)[:200]})

    def success(self, item):
        print(f"  ✓ {item}")
        self.ok.append(item)

    def block(self, source, reason):
        if not any(b["source"] == source for b in self.blocked):
            self.blocked.append({"source": source, "reason": reason})


REPORT = Report()


def attempt(item, fn, *a, **kw):
    try:
        out = fn(*a, **kw)
        REPORT.success(item)
        return out
    except Exception as e:  # noqa: BLE001 - 실패해도 사이트는 계속 만든다
        REPORT.fail(item, f"{type(e).__name__}: {e}")
        return None
