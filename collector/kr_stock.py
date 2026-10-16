"""한국 종목: 네이버(가격·현재 지표), 와이즈리포트(컨센서스·최근 5년), OpenDART(10년 이상 재무)."""
import ast
import io
import os
import re
import zipfile
from xml.etree import ElementTree

import pandas as pd

from common import CACHE, HTTP, REPORT, now_kst, num, read_json, write_json

WISE = "https://navercomp.wisereport.co.kr/v2/company"


# ---------- 네이버 ----------
def price_history(code, start="19900101"):
    """수정주가 일별 종가 (네이버 차트 데이터)."""
    end = now_kst().strftime("%Y%m%d")
    url = (f"https://api.finance.naver.com/siseJson.naver?symbol={code}&requestType=1"
           f"&startTime={start}&endTime={end}&timeframe=day")
    txt = HTTP.get(url).text
    rows = re.findall(r'\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)', txt)
    if not rows:
        raise RuntimeError("네이버 가격 데이터 없음")
    return pd.Series([float(r[4]) for r in rows], index=pd.to_datetime([r[0] for r in rows]))


def parse_won_hangeul(s):
    """'41조 714억' → 원 단위 숫자"""
    if not s:
        return None
    s = s.replace(",", "").replace("원", "")
    total = 0.0
    m = re.search(r"([\d.]+)조", s)
    if m:
        total += float(m.group(1)) * 1e12
    m = re.search(r"([\d.]+)억", s)
    if m:
        total += float(m.group(1)) * 1e8
    return total or None


def naver_now(code):
    j = HTTP.get(f"https://m.stock.naver.com/api/stock/{code}/integration").json()
    info = {x["code"]: x["value"] for x in j.get("totalInfos", [])}
    # integration 의 lastClosePrice 는 오늘 한국거래소 종가가 아닐 때가 있고(5단계 검증에서 발견),
    # basic 의 값은 저녁에 넥스트레이드 시간외 가격이 섞인다 → 일별 시세의 마지막 종가(한국거래소 정규장)를 쓴다
    price = num(info.get("lastClosePrice"))
    try:
        start = (now_kst() - pd.Timedelta(days=14)).strftime("%Y%m%d")
        price = float(price_history(code, start=start).iloc[-1])
    except Exception:  # noqa: BLE001
        pass
    cap = parse_won_hangeul(info.get("marketValue"))
    return {
        "name": j.get("stockName"),
        "price": price,
        "market_cap": cap,
        "per": num(info.get("per")), "eps": num(info.get("eps")),
        "fwd_per": num(info.get("cnsPer")), "fwd_eps": num(info.get("cnsEps")),
        "pbr": num(info.get("pbr")), "bps": num(info.get("bps")),
        "div_yield": num(info.get("dividendYieldRatio")), "dps": num(info.get("dividend")),
    }


# ---------- 와이즈리포트 (네이버 종목분석) ----------
ROWS = {
    "eps": "EPS", "bps": "BPS", "dps": "현금DPS", "roe": "ROE", "payout": "현금배당성향",
    "ni": "당기순이익(지배)", "equity": "자본총계(지배)", "sales": "매출액", "per": "PER", "pbr": "PBR", "shares": "발행주식수(보통주)",
}


def wise_annual(code):
    """{연도: {eps, bps, dps, roe, payout, ni(억원), estimate}} — 최근 5년 실적 + 3년 추정."""
    page = f"{WISE}/c1010001.aspx?cmp_cd={code}"
    r = HTTP.get(page)
    m = re.search(r"encparam\s*:\s*'([^']+)'", r.text)
    if not m:
        raise RuntimeError("와이즈리포트 페이지 형식 변경")
    rr = HTTP.get(f"{WISE}/ajax/cF1001.aspx", headers={"Referer": page},
                  params={"cmp_cd": code, "fin_typ": "0", "freq_typ": "Y", "extY": "0", "extQ": "0",
                          "encparam": m.group(1)})
    rr.encoding = "utf-8"
    tb = pd.read_html(io.StringIO(rr.text))[-1]
    cols = [c[1] if isinstance(c, tuple) else c for c in tb.columns]
    tb.columns = cols
    names = tb.iloc[:, 0].astype(str).str.replace(r"\s+", "", regex=True)
    out = {}
    for ci, c in enumerate(cols[1:], start=1):
        ym = re.match(r"(\d{4})/(\d{2})", str(c))
        if not ym:
            continue
        y = int(ym.group(1))
        rec = {"estimate": "(E)" in str(c), "fy_month": int(ym.group(2))}
        for k, label in ROWS.items():
            hit = names[names.str.startswith(label.replace(" ", ""))]
            if k in ("ni", "equity", "sales"):
                hit = names[names == label]
            if len(hit):
                rec[k] = num(tb.iloc[hit.index[0], ci])
        out[y] = rec
    if not out:
        raise RuntimeError("와이즈리포트 표가 비어 있음")
    return out


# ---------- OpenDART ----------
def dart_key():
    k = os.environ.get("DART_KEY")
    if not k:
        raise RuntimeError("DART_KEY 가 없어요 (GitHub Secrets 확인)")
    return k


def corp_code(stock_code):
    path = CACHE / "dart_corp.json"
    m = read_json(path, {})
    age = now_kst().timestamp() - m.get("_ts", 0)
    if stock_code not in m or age > 30 * 86400:
        r = HTTP.get(f"https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key={dart_key()}", timeout=120)
        z = zipfile.ZipFile(io.BytesIO(r.content))
        root = ElementTree.fromstring(z.read(z.namelist()[0]))
        m = {"_ts": now_kst().timestamp()}
        for el in root.iter("list"):
            sc = (el.findtext("stock_code") or "").strip()
            if sc:
                m[sc] = el.findtext("corp_code")
        write_json(path, m)
    if stock_code not in m:
        raise RuntimeError("DART 회사코드를 못 찾음")
    return m[stock_code]


def _amt(x):
    if x in (None, "", "-"):
        return None
    try:
        return float(str(x).replace(",", ""))
    except ValueError:
        return None


def _dart_fin(cc, year):
    for fs in ("CFS", "OFS"):
        j = HTTP.get("https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json",
                     params={"crtfc_key": dart_key(), "corp_code": cc, "bsns_year": year,
                             "reprt_code": "11011", "fs_div": fs}).json()
        if j.get("status") == "000":
            return j["list"]
    return []


def _dart_div(cc, year):
    j = HTTP.get("https://opendart.fss.or.kr/api/alotMatter.json",
                 params={"crtfc_key": dart_key(), "corp_code": cc, "bsns_year": year, "reprt_code": "11011"}).json()
    return j.get("list", []) if j.get("status") == "000" else []


def dart_history(stock_code, splits=()):
    """OpenDART 사업보고서로 2014년~ 연도별 EPS·BPS·DPS·ROE. 지난 연도는 캐시에 보관."""
    path = CACHE / f"dart_{stock_code}.json"
    cache = read_json(path, {})
    now = now_kst()
    last_fy = now.year - 1 if now.month >= 4 else now.year - 2
    years = list(range(last_fy, 2015, -3))
    if cache.get("last_fy") == last_fy and cache.get("data") and cache.get("v") == 2:
        return {int(k): v for k, v in cache["data"].items()}

    cc = corp_code(stock_code)
    data = {}
    for ry in sorted(years):  # 오래된 보고서 → 최신 보고서 순(최신 값이 덮어씀)
        offs = {"thstrm": 0, "frmtrm": 1, "bfefrmtrm": 2}
        rows = _dart_fin(cc, ry)
        for col, off in offs.items():
            y = ry - off
            eps = ni = eq = None
            for r in rows:
                # 옛 보고서는 'ifrs_', 최근 보고서는 'ifrs-full_' 로 시작한다
                aid = r.get("account_id", "").split("_", 1)[-1]
                v = _amt(r.get(f"{col}_amount"))
                if v is None:
                    continue
                if eps is None and aid == "BasicEarningsLossPerShare":
                    eps = v
                elif ni is None and aid == "ProfitLossAttributableToOwnersOfParent":
                    ni = v
                elif eq is None and aid == "EquityAttributableToOwnersOfParent":
                    eq = v
            if ni is None:  # 계정 이름으로 한 번 더 (지배기업 소유주 귀속 순이익)
                for r in rows:
                    nm = r.get("account_nm", "").replace(" ", "")
                    if r.get("sj_div") in ("IS", "CIS") and "지배기업" in nm and ("소유주" in nm or "귀속" in nm) \
                            and "포괄" not in nm and _amt(r.get(f"{col}_amount")) is not None:
                        ni = _amt(r.get(f"{col}_amount"))
                        break
            if eq is None:
                for r in rows:
                    nm = r.get("account_nm", "").replace(" ", "")
                    if r.get("sj_div") == "BS" and "지배기업" in nm and "지분" in nm and _amt(r.get(f"{col}_amount")) is not None:
                        eq = _amt(r.get(f"{col}_amount"))
                        break
            if eps is None:
                for r in rows:
                    if "기본주당" in r.get("account_nm", "") and _amt(r.get(f"{col}_amount")) is not None:
                        eps = _amt(r.get(f"{col}_amount"))
                        break
            if eps is None and ni is None:
                continue
            rec = data.setdefault(y, {})
            rec.update({k: v for k, v in {"eps": eps, "ni": ni, "equity": eq}.items() if v is not None})
            # 유효 주식수 = 순이익 ÷ EPS → BPS = 자본 ÷ 주식수
            if eps and ni and eq and abs(eps) > 0:
                rec["bps"] = eq / (ni / eps)
            rec["src_report"] = ry
        for r in _dart_div(cc, ry):
            se = r.get("se", "")
            for col, off in {"thstrm": 0, "frmtrm": 1, "lwfr": 2}.items():
                y = ry - off
                v = _amt(r.get(col))
                if v is None:
                    continue
                if "주당 현금배당금" in se and r.get("stock_knd", "보통주") in ("보통주", "", None):
                    data.setdefault(y, {})["dps"] = v
                elif "현금배당성향" in se:
                    data.setdefault(y, {})["payout"] = v
    # 액면분할 보정: 분할 이전에 제출된 보고서 값은 비율로 나눈다
    for sp in splits or []:
        sy = int(str(sp["date"])[:4])
        for y, rec in data.items():
            if rec.get("src_report", 9999) + 1 < sy:
                for k in ("eps", "bps", "dps"):
                    if rec.get(k) is not None:
                        rec[k] = rec[k] / float(sp["ratio"])
    # ROE = 순이익 ÷ 평균 자본
    for y, rec in data.items():
        prev = data.get(y - 1, {})
        if rec.get("ni") is not None and rec.get("equity"):
            base = (rec["equity"] + prev["equity"]) / 2 if prev.get("equity") else rec["equity"]
            rec["roe"] = rec["ni"] / base * 100
    if not data:
        raise RuntimeError("DART 재무 데이터 없음")
    write_json(path, {"last_fy": last_fy, "data": data, "v": 2})
    return data


def _sane(dart):
    """단위가 섞인 옛 보고서 값 걸러내기: 순이익÷EPS(=주식수)가 다른 해와 2배 넘게 다르면 버린다."""
    shares = {y: r["ni"] / r["eps"] for y, r in dart.items()
              if r.get("ni") and r.get("eps") and r["ni"] * r["eps"] > 0}
    if not shares:
        return {}
    med = sorted(shares.values())[len(shares) // 2]
    ok = {}
    for y, r in dart.items():
        s = shares.get(y)
        if s is None:
            # 적자 해: EPS 부호만 맞으면 같은 주식수로 크기 검증
            if r.get("ni") and r.get("eps") and abs(r["ni"] / r["eps"]) / med < 2 and abs(r["ni"] / r["eps"]) / med > 0.5:
                ok[y] = r
            continue
        if 0.5 < s / med < 2:
            ok[y] = r
    return ok


def merged_history(code, splits=()):
    """연도별 실적: 최근 5년은 와이즈리포트(네이버와 같은 값), 그 이전은 DART. 추정치(E)도 포함."""
    wise = None
    try:
        wise = wise_annual(code)
    except Exception as e:  # noqa: BLE001
        REPORT.fail(f"{code} 컨센서스(와이즈리포트)", e)
    dart = {}
    try:
        dart = dart_history(code, splits)
    except Exception as e:  # noqa: BLE001
        REPORT.fail(f"{code} 10년 재무(DART)", e)
    hist = {}
    for y, rec in _sane(dart).items():
        hist[int(y)] = {k: rec.get(k) for k in ("eps", "bps", "dps", "roe", "payout")} | {"src": "DART"}
    for y, rec in (wise or {}).items():
        base = hist.get(y, {})
        merged = dict(base)
        for k in ("eps", "bps", "dps", "roe", "payout"):
            if rec.get(k) is not None:
                merged[k] = rec[k]
        merged["src"] = "와이즈리포트(추정)" if rec["estimate"] else "와이즈리포트"
        merged["estimate"] = rec["estimate"]
        merged["ni"] = rec.get("ni")
        hist[y] = merged
    return hist, wise
