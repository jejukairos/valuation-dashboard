"""한국 종목: 네이버(가격·현재 지표), 와이즈리포트(컨센서스·최근 5년), OpenDART(10년 이상 재무)."""
import ast
import io
import math
import os
import re
import statistics
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
        "high52": num(info.get("highPriceOf52Weeks")), "low52": num(info.get("lowPriceOf52Weeks")),
    }


def ir_schedule(code):
    """네이버 증권의 실적발표·컨퍼런스콜 일정 (종목 IR 탭에 보이는 정보): 날짜·시간, 분기, 라이브 여부."""
    out = {"code": code, "url": f"https://stock.naver.com/domestic/stock/{code}/ir"}
    ec = (HTTP.get(f"https://stock.naver.com/api/stockSecurity/earning-calls/v1/{code}").json() or {}).get("earningCall") or {}
    if ec.get("eventDatetime"):
        out.update(when=ec["eventDatetime"], time_unknown=bool(ec.get("isEventTimeUnknown")), live=ec.get("contentType") == "LIVE",
                   title=f"{ec.get('fiscalYear')}년 {ec.get('fiscalQuarter')}분기 어닝콜", replay=bool(ec.get("isReplayProvided")),
                   script_url=ec.get("aspUrl"), media=ec.get("mediaStatus"))  # 네이버가 공개하는 실시간 발표 자막 화면
    ir = (HTTP.get(f"https://m.stock.naver.com/api/stock/{code}/integration").json() or {}).get("irScheduleInfo") or {}
    if ir.get("irScheduleDate") and not out.get("when"):
        out.update(when=ir["irScheduleDate"], time_unknown=True, title=ir.get("title"))
    elif ir.get("title"):
        out["ir_title"] = ir["title"]
    return out if out.get("when") else None


def sector_per(code):
    """네이버 업종 PER: WICS 업종 PER(최근 4분기) + 네이버가 고른 같은 업종 회사들의 추정 PER(없으면 현재 PER)."""
    t = HTTP.get(f"{WISE}/c1010001.aspx?cmp_cd={code}").text
    m = re.search(r"업종PER\s*<b[^>]*>\s*([-\d.,]+)", t)
    w = re.search(r"WICS\s*:\s*([^<]+)", t)
    peers = []
    me = HTTP.get(f"https://m.stock.naver.com/api/stock/{code}/integration").json()
    for p in (me.get("industryCompareInfo") or [])[:6]:
        try:
            info = {x["code"]: x["value"] for x in HTTP.get(f"https://m.stock.naver.com/api/stock/{p['itemCode']}/integration").json().get("totalInfos", [])}
        except Exception:  # noqa: BLE001
            continue
        f, c = num(info.get("cnsPer")), num(info.get("per"))
        peers.append({"name": p.get("stockName"), "per": f or c, "fwd": bool(f), "pbr": num(info.get("pbr"))})
    vals = [p["per"] for p in peers if p["per"] and p["per"] > 0]
    med = round(statistics.median(vals), 2) if vals else None
    # 업종 PBR (사용자 11/6): 같은 업종 회사들의 PBR 중앙값 (네이버 = 지난 결산 BPS 기준) + 이 종목 같은 기준 PBR
    pv = [p["pbr"] for p in peers if p.get("pbr") and p["pbr"] > 0]
    own = {x["code"]: x["value"] for x in me.get("totalInfos", [])}
    return {"wics": w.group(1).strip() if w else None, "per": num(m.group(1)) if m else None, "peers": peers, "peer_med": med,
            "pbr_med": round(statistics.median(pv), 2) if pv else None, "pbr_own": num(own.get("pbr"))}


def product_mix(code):
    """와이즈리포트 기업개요 '주요제품 매출구성'(최근 분기·반기·사업보고서, %) → {"asof": "2026/06", "mix": {제품: %}}.
    '기타'가 음수면 부문 사이 내부거래를 뺀 몫이라 그대로 둔다 (화면에서 양수만 100%로 맞춤)."""
    import html
    t = HTTP.get(f"{WISE}/c1020001.aspx?cmp_cd={code}").text
    i = t.find('id="cTB203"')
    if i < 0:
        return None
    body = t[i:t.find("</table>", i)]
    mix = {html.unescape(k).strip(): num(v) for k, v in
           re.findall(r'<th scope="row"[^>]*title="([^"]+)".*?<td[^>]*>\s*([-\d.,]+)\s*</td>', body, re.S)}
    mix = {k: v for k, v in mix.items() if v is not None}
    m = re.search(r"주요제품 매출구성\((\d{4})\s*/\s*(\d{2})\)", t)
    return {"asof": f"{m.group(1)}/{m.group(2)}" if m else None, "mix": mix} if mix else None


# ---------- 와이즈리포트 (네이버 종목분석) ----------
ROWS = {
    "eps": "EPS", "bps": "BPS", "dps": "현금DPS", "roe": "ROE", "payout": "현금배당성향",
    "ni": "당기순이익(지배)", "equity": "자본총계(지배)", "sales": "매출액", "op": "영업이익(발표기준)",
    "debt": "부채비율", "per": "PER", "pbr": "PBR", "shares": "발행주식수(보통주)",
    "fcf": "FCF", "opm": "영업이익률",
}


def wise_annual(code, freq="Y"):
    """{연도: {eps, bps, dps, roe, payout, ni(억원), estimate}} — 최근 5년 실적 + 3년 추정.
    freq="Q" 면 같은 페이지의 '분기' 탭: {"202612": {...}} — 최근 5분기 실적 + 보통 3분기 추정."""
    page = f"{WISE}/c1010001.aspx?cmp_cd={code}"
    r = HTTP.get(page)
    m = re.search(r"encparam\s*:\s*'([^']+)'", r.text)
    if not m:
        raise RuntimeError("와이즈리포트 페이지 형식 변경")
    rr = HTTP.get(f"{WISE}/ajax/cF1001.aspx", headers={"Referer": page},
                  params={"cmp_cd": code, "fin_typ": "0", "freq_typ": freq, "extY": "0", "extQ": "0",
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
            if k in ("ni", "equity", "sales", "op"):
                hit = names[names == label]
            if len(hit):
                rec[k] = num(tb.iloc[hit.index[0], ci])
        out[y if freq == "Y" else f"{y}{ym.group(2)}"] = rec
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
    # 사용자 11/6 '모든 종목 10년치 이상': 3년 간격이면 '전전기' 칸이 없는 회사는 중간 해가 비어서 → 해마다 사업보고서 (2015 보고서의 전기 = 2014)
    years = list(range(last_fy, 2014, -1))
    ver = 4 if splits else 3  # 분할 보정 고친 뒤(11/14) 분할 있는 종목만 한 번 다시 받음
    if cache.get("last_fy") == last_fy and cache.get("data") and cache.get("v") == ver:
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
                # 옛 보고서는 'ifrs_', 최근 보고서는 'ifrs-full_' 로 시작한다 · 자본변동표(SCE) 같은 이름 행은 빼고 손익(IS·CIS)·재무상태(BS) 에서만
                aid = r.get("account_id", "").split("_", 1)[-1]
                v = _amt(r.get(f"{col}_amount"))
                sj = r.get("sj_div")
                if v is None:
                    continue
                if eps is None and aid == "BasicEarningsLossPerShare" and sj in ("IS", "CIS"):
                    eps = v
                elif ni is None and aid == "ProfitLossAttributableToOwnersOfParent" and sj in ("IS", "CIS"):
                    ni = v
                elif eq is None and aid == "EquityAttributableToOwnersOfParent" and sj == "BS":
                    eq = v
            if ni is None:  # 계정 이름으로 한 번 더 (지배기업 소유주 귀속 순이익)
                for r in rows:
                    nm = r.get("account_nm", "").replace(" ", "")
                    if r.get("sj_div") in ("IS", "CIS") and "지배기업" in nm and ("소유주" in nm or "귀속" in nm) \
                            and "포괄" not in nm and _amt(r.get(f"{col}_amount")) is not None:
                        ni = _amt(r.get(f"{col}_amount"))
                        break
            if eq is None:  # 옛 보고서: '지배기업의 소유주에게 귀속되는 자본' 처럼 '지분' 대신 '자본'
                for r in rows:
                    nm = r.get("account_nm", "").replace(" ", "")
                    if r.get("sj_div") == "BS" and "지배기업" in nm and ("지분" in nm or "자본" in nm) and "비지배" not in nm \
                            and _amt(r.get(f"{col}_amount")) is not None:
                        eq = _amt(r.get(f"{col}_amount"))
                        break
            if eq is None and not any("비지배" in r.get("account_nm", "") for r in rows if r.get("sj_div") == "BS"):
                for r in rows:  # 비지배지분이 없는 회사(별도 재무제표 등) = 자본총계가 곧 주주 몫
                    if r.get("sj_div") == "BS" and (r.get("account_id", "").split("_", 1)[-1] == "Equity" or r.get("account_nm", "").replace(" ", "") == "자본총계") \
                            and _amt(r.get(f"{col}_amount")) is not None:
                        eq = _amt(r.get(f"{col}_amount"))
                        break
            if eps is None:
                for r in rows:
                    if "기본주당" in r.get("account_nm", "") and r.get("sj_div") in ("IS", "CIS") and _amt(r.get(f"{col}_amount")) is not None:
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
                    data.setdefault(y, {}).update(dps=v, dps_report=ry)  # 배당 표는 분할 뒤 보고서에도 옛 금액 그대로라 보고서 해를 따로
                elif "현금배당성향" in se:
                    data.setdefault(y, {})["payout"] = v
    # 액면분할 보정: 분할 이전에 제출된 보고서 값은 비율로 나눈다 · 사업보고서는 다음 해 3월 말까지 냄
    #   (11/14: 삼성전자 2017 보고서는 2018-03 제출 = 5월 분할 전인데 '보고서 해 + 1 < 분할 해' 로 빠져서 2015 EPS 126,305원이 남아 그 해가 버려졌음)
    for sp in splits or []:
        for y, rec in data.items():
            for k in ("eps", "bps", "dps"):
                ry = rec.get("dps_report" if k == "dps" else "src_report", 9999)
                if rec.get(k) is not None and f"{ry + 1}-03-31" < str(sp["date"]):
                    rec[k] = rec[k] / float(sp["ratio"])
            # 분할 뒤 보고서인데도 3년 전 칸 배당이 옛 금액인 경우 (삼성 2018 보고서의 2016 DPS 28,500원): 배당성향으로 본 금액의 '분할 비율 배'면 나눔
            if rec.get("dps") and rec.get("eps") and rec.get("payout") and 0.7 < rec["dps"] / (rec["eps"] * rec["payout"] / 100) / float(sp["ratio"]) < 1.4:
                rec["dps"] = rec["dps"] / float(sp["ratio"])
    # ROE = 순이익 ÷ 평균 자본
    for y, rec in data.items():
        prev = data.get(y - 1, {})
        if rec.get("ni") is not None and rec.get("equity"):
            base = (rec["equity"] + prev["equity"]) / 2 if prev.get("equity") else rec["equity"]
            rec["roe"] = rec["ni"] / base * 100
    # 이번에 못 받은 해(접속 실패 등)는 예전 캐시 값을 그대로 (예전 값은 이미 분할 보정됨)
    for k, v in (cache.get("data") or {}).items():
        if int(k) not in data or not (data[int(k)].get("eps") or data[int(k)].get("ni")):
            data[int(k)] = {**v, **{kk: vv for kk, vv in data.get(int(k), {}).items() if vv is not None}}
    if not data:
        raise RuntimeError("DART 재무 데이터 없음")
    write_json(path, {"last_fy": last_fy, "data": data, "v": ver})
    return data


# ---------- 최신 정기보고서 대조 (분기·반기·사업보고서) ----------
REPORTS = [("11014", "3분기보고서", 9), ("11012", "반기보고서", 6), ("11013", "1분기보고서", 3), ("11011", "사업보고서", 12)]
ACCTS = {"sales": (["Revenue"], ["매출액", "수익(매출액)", "영업수익"]),
         "op": (["OperatingIncomeLoss"], ["영업이익", "영업이익(손실)"]),
         "gp": (["GrossProfit"], ["매출총이익", "매출총이익(손실)"]),
         "ni":(["ProfitLossAttributableToOwnersOfParent"], ["지배기업의소유주에게귀속되는당기순이익", "지배기업소유주지분"])}


def dart_latest(stock_code):
    """DART 에 올라온 가장 최근 정기보고서의 누적 매출·영업이익·지배주주 순이익(원)."""
    cc = corp_code(stock_code)
    y = now_kst().year
    for year, (rc, nm, month) in [(y, r) for r in REPORTS[:3]] + [(y - 1, REPORTS[3])] + [(y - 1, r) for r in REPORTS[:3]]:
        rows = _dart_fin(cc, year) if rc == "11011" else _dart_fin_q(cc, year, rc)
        if not rows:
            continue
        out = {"report": f"{year}년 {nm}", "year": year, "month": month}
        # 손익계산서(IS)를 먼저, 없으면 포괄손익계산서(CIS)
        pl = sorted((r for r in rows if r.get("sj_div") in ("IS", "CIS")), key=lambda r: r.get("sj_div") != "IS")
        for k, (ids, names) in ACCTS.items():
            def hit(r):
                aid = r.get("account_id", "").split("_", 1)[-1]
                nmr = r.get("account_nm", "").replace(" ", "")
                if aid in ids or nmr in names:
                    return True
                # 지배주주 순이익은 회사마다 이름이 달라서 한 번 더: '지배' + '순이익', 포괄·비지배 제외
                return k == "ni" and "지배" in nmr and "순이익" in nmr and "비지배" not in nmr and "포괄" not in nmr
            for r in pl:
                if hit(r):
                    v = _amt(r.get("thstrm_add_amount")) if rc != "11011" else None
                    v = v if v is not None else _amt(r.get("thstrm_amount"))
                    if v is not None:
                        out[k] = v
                        break
        return out
    raise RuntimeError("DART 정기보고서 없음")


QREP = {"11013": "03", "11012": "06", "11014": "09", "11011": "12"}
QF = ("thstrm_amount", "thstrm_add_amount", "frmtrm_amount", "frmtrm_q_amount", "frmtrm_add_amount")


def _acct_row(rows, k):
    """정기보고서 행에서 매출(sales)·영업이익(op) 한 줄 — 손익계산서(IS) 먼저, 없으면 포괄손익계산서(CIS)."""
    ids, names = ACCTS[k]
    pl = sorted((r for r in rows if r.get("sj_div") in ("IS", "CIS")), key=lambda r: r.get("sj_div") != "IS")
    return next((r for r in pl if r.get("account_id", "").split("_", 1)[-1] in ids or r.get("account_nm", "").replace(" ", "") in names), None)


def q_from_reports(cache):
    """{'2026_11012': {'op': {thstrm_amount: 이번 분기 3개월, frmtrm_q_amount: 1년 전 같은 분기 3개월, …}}} → {'202606': {op, op_ago, sales, sales_ago}}.
    4분기 = 사업보고서 연간 − 같은 해 3분기보고서 누적 (1년 전도 같은 방식)."""
    out = {}
    for key, v in cache.items():
        year, rc = key.split("_")
        if not v:  # 보고서가 없는 해(상장 전 등)
            continue
        row = {}
        for k in ("sales", "op", "gp"):
            a = v.get(k) or {}
            if rc == "11011":
                q3 = (cache.get(f"{year}_11014") or {}).get(k) or {}
                cur, ago, c9, a9 = a.get("thstrm_amount"), a.get("frmtrm_amount"), q3.get("thstrm_add_amount"), q3.get("frmtrm_add_amount")
                row[k] = cur - c9 if None not in (cur, c9) else None
                row[k + "_ago"] = ago - a9 if None not in (ago, a9) else None
            else:
                row[k] = a.get("thstrm_amount")
                row[k + "_ago"] = a.get("frmtrm_q_amount") if a.get("frmtrm_q_amount") is not None else (
                    a.get("frmtrm_add_amount") if rc == "11013" else None)  # 1분기는 누적 = 3개월
        out[f"{year}{QREP[rc]}"] = row
    return dict(sorted(out.items()))


def dart_quarters(stock_code, limit=None):
    """2015년~ 정기보고서(1분기·반기·3분기·사업보고서)의 분기 3개월 매출·영업이익·매출총이익과 1년 전 같은 분기 (원).
    한 번 낸 보고서는 바뀌지 않으니 캐시 (cache/dartq_{코드}.json) — 영업이익 성장률·📈 10년 실적 그래프용.
    예전 분기는 갱신마다 최근 것부터 limit 개씩만 새로 받아 몇 번의 갱신에 걸쳐 채움 (DART 하루 한도·갱신 시간 보호)."""
    path = CACHE / f"dartq_{stock_code}.json"
    cache = read_json(path, {})
    cc = corp_code(stock_code)
    now = now_kst()
    y = now.year
    limit = SETTINGS_LIMIT if limit is None else limit
    todo = [(yy, rc) for yy in range(y, 2014, -1) for rc in ("11014", "11012", "11013", "11011")
            if f"{yy}_{rc}" not in cache or (cache[f"{yy}_{rc}"] and "gp" not in cache[f"{yy}_{rc}"])]
    for year, rc in todo[:limit]:
        rows = _dart_fin(cc, year) if rc == "11011" else _dart_fin_q(cc, year, rc)
        if rows:
            cache[f"{year}_{rc}"] = {k: {f: _amt((_acct_row(rows, k) or {}).get(f)) for f in QF} for k in ("sales", "op", "gp")}
        elif year < y - 1:  # 2년 넘게 지난 보고서가 없으면 상장 전 → 빈 칸으로 기억 (다시 안 받음). 최근 것은 아직 안 냈을 수 있어 그냥 둠
            cache[f"{year}_{rc}"] = {}
    write_json(path, cache)
    return q_from_reports(cache)


SETTINGS_LIMIT = 16  # 갱신 한 번에 종목당 새로 받을 예전 보고서 수 (약 4년 치)


def _dart_fin_q(cc, year, rc):
    for fs in ("CFS", "OFS"):
        j = HTTP.get("https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json",
                     params={"crtfc_key": dart_key(), "corp_code": cc, "bsns_year": year,
                             "reprt_code": rc, "fs_div": fs}).json()
        if j.get("status") == "000":
            return j["list"]
    return []


def dart_shares(stock_code, limit=8):
    """정기보고서 '주식의 총수' → {분기 끝 날짜: 보통주 유통주식수 (발행 − 자기주식)} — 주식 수 증가율(YoY)용.
    dart_quarters 처럼 한 번 낸 보고서는 캐시 (cache/darts_{코드}.json), 갱신마다 limit 개씩 최근 3년 치를 채움."""
    path = CACHE / f"darts_{stock_code}.json"
    cache = read_json(path, {})
    cc, y = corp_code(stock_code), now_kst().year
    todo = [(yy, rc) for yy in range(y, y - 4, -1) for rc in ("11014", "11012", "11013", "11011") if f"{yy}_{rc}" not in cache]
    for year, rc in todo[:limit]:
        j = HTTP.get("https://opendart.fss.or.kr/api/stockTotqySttus.json",
                     params={"crtfc_key": dart_key(), "corp_code": cc, "bsns_year": year, "reprt_code": rc}).json()
        row = next((r for r in j.get("list") or [] if "보통" in (r.get("se") or "")), None)
        if row and _amt(row.get("distb_stock_co")):
            cache[f"{year}_{rc}"] = _amt(row["distb_stock_co"])
        elif j.get("status") == "013" and year < y - 1:  # 013 = 자료 없음. 오래된 보고서가 없으면 상장 전 → 0 으로 기억 (다시 안 받음)
            cache[f"{year}_{rc}"] = 0
    write_json(path, cache)
    vs = sorted(v for v in cache.values() if v)
    med = vs[len(vs) // 2] if vs else 0
    # 회사가 보고서에 주식 수를 1,000배로 잘못 적은 칸은 뺌 (네오팜 25년 말 156억 주 → 주식 수 +99,900% 로 보였음, 11/12) — 중앙값의 1/50~50배 밖
    return {f"{k[:4]}-{QREP[k[5:]]}-{'31' if QREP[k[5:]] in ('03', '12') else '30'}": v for k, v in sorted(cache.items()) if v and med / 50 < v < med * 50}


def dart_dilution(stock_code, days=365):
    """최근 1년 주식 수가 늘 수 있는 공시 (유상증자·전환사채(CB)·신주인수권부사채(BW)·교환사채) — 주요사항보고서."""
    cc = corp_code(stock_code)
    end = now_kst()
    j = HTTP.get("https://opendart.fss.or.kr/api/list.json",
                 params={"crtfc_key": dart_key(), "corp_code": cc, "bgn_de": (end - pd.Timedelta(days=days)).strftime("%Y%m%d"),
                         "end_de": end.strftime("%Y%m%d"), "pblntf_ty": "B", "page_count": 100}).json()
    if j.get("status") not in ("000", "013"):  # 013 = 자료 없음
        raise RuntimeError(f"DART 공시목록 {j.get('status')}")
    keys = ("유상증자결정", "전환사채권발행결정", "신주인수권부사채권발행결정", "교환사채권발행결정")
    return [{"date": f"{r['rcept_dt'][:4]}-{r['rcept_dt'][4:6]}-{r['rcept_dt'][6:]}", "name": r["report_nm"].strip(),
             "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={r['rcept_no']}"}
            for r in j.get("list", []) if any(k in r.get("report_nm", "") for k in keys)]


def wise_quarters(code):
    """와이즈리포트 분기 실적 {(연, 월): {sales, op, ni}} (억원) — DART 누적값과 맞춰 보기용."""
    page = f"{WISE}/c1010001.aspx?cmp_cd={code}"
    r = HTTP.get(page)
    m = re.search(r"encparam\s*:\s*'([^']+)'", r.text)
    rr = HTTP.get(f"{WISE}/ajax/cF1001.aspx", headers={"Referer": page},
                  params={"cmp_cd": code, "fin_typ": "0", "freq_typ": "Q", "extY": "0", "extQ": "0", "encparam": m.group(1)})
    rr.encoding = "utf-8"
    tb = pd.read_html(io.StringIO(rr.text))[-1]
    cols = [c[1] if isinstance(c, tuple) else c for c in tb.columns]
    names = tb.iloc[:, 0].astype(str).str.replace(r"\s+", "", regex=True)
    rowi = {k: names[names == lab].index for k, lab in (("sales", "매출액"), ("op", "영업이익"), ("ni", "당기순이익(지배)"))}
    out = {}
    for ci, c in enumerate(cols[1:], start=1):
        ym = re.match(r"(\d{4})/(\d{2})", str(c))
        if not ym or "(E)" in str(c):
            continue
        out[(int(ym.group(1)), int(ym.group(2)))] = {k: num(tb.iloc[ix[0], ci]) if len(ix) else None for k, ix in rowi.items()}
    return out


def cross_check(stock_code, wise_annual_data):
    """DART 최신 보고서(누적) vs 네이버·와이즈리포트 값. 차이(%)를 돌려준다."""
    d = dart_latest(stock_code)
    if d["month"] == 12:
        w = {k: (wise_annual_data.get(d["year"]) or {}).get(k if k != "ni" else "ni") for k in ACCTS}
        w["op"] = (wise_annual_data.get(d["year"]) or {}).get("op")
    else:
        q = wise_quarters(stock_code)
        parts = [v for (yy, mm), v in q.items() if yy == d["year"] and mm <= d["month"]]
        w = {k: (sum(p[k] for p in parts) if parts and all(p.get(k) is not None for p in parts) and len(parts) == d["month"] // 3 else None)
             for k in ACCTS}
    rows = []
    for k, lab in (("sales", "매출액"), ("op", "영업이익"), ("ni", "순이익(지배)")):
        a = d.get(k) / 1e8 if d.get(k) is not None else None
        b = w.get(k)
        diff = abs(a / b - 1) * 100 if (a is not None and b) else None
        rows.append({"item": lab, "dart": round(a) if a is not None else None, "wise": b, "diff": round(diff, 2) if diff is not None else None})
    return {"report": d["report"], "rows": rows, "warn": any((r["diff"] or 0) > 1 for r in rows)}


def _sane(dart):
    """단위가 섞인 옛 보고서 값 바로잡기: 순이익÷EPS(=주식수)가 다른 해와 2배 넘게 다르거나 EPS 가 비면
    EPS = 순이익 ÷ 여러 해 가운데 주식수 (사용자 11/6 '10년치 이상' — 예전엔 그 해를 버렸음, 현대로템 14~16년 EPS 가 1,000배로 들어옴).
    순이익 없이 EPS 만 있는 해는 다른 해 EPS 와 20배 넘게 다르지 않을 때만."""
    shares = {y: r["ni"] / r["eps"] for y, r in dart.items()
              if r.get("ni") and r.get("eps") and r["ni"] * r["eps"] > 0}
    if not shares:
        return {}
    med = sorted(shares.values())[len(shares) // 2]
    ok = {}
    for y, r in dart.items():
        s = shares.get(y)
        if s is not None and 0.5 < s / med < 2:
            ok[y] = r
        elif s is not None:  # 단위만 틀림 (1,000배 등): 10의 거듭제곱만큼만 바로잡음 — 유상증자로 주식 수가 바뀐 회사도 안전
            k = round(math.log10(s / med))
            if abs(k) >= 2 and 0.5 < s / med / 10 ** k < 2:  # 100배·1,000배(원↔천원)만 — 10배쯤은 실제 증자·감자일 수 있음
                ok[y] = dict(r, eps=r["eps"] * 10 ** k, eps_fixed=True)
    for y, r in dart.items():  # EPS 가 빈 해: 앞뒤 2년 안 실제 주식 수(순이익÷EPS)로만
        if y in ok or not r.get("ni") or r.get("eps") is not None:
            continue
        near = [ok[z]["ni"] / ok[z]["eps"] for z in sorted(ok, key=lambda z: abs(z - y)) if abs(z - y) <= 2
                and not ok[z].get("eps_fixed") and ok[z].get("ni") and ok[z].get("eps") and ok[z]["ni"] * ok[z]["eps"] > 0]
        if near:
            ok[y] = dict(r, eps=r["ni"] / near[0], eps_fixed=True)
    eps_ok = sorted(abs(r["eps"]) for r in ok.values() if r.get("eps"))
    me = eps_ok[len(eps_ok) // 2] if eps_ok else None
    for y, r in dart.items():
        if y not in ok and not r.get("ni") and r.get("eps") and me and 1 / 20 < abs(r["eps"]) / me < 20:
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
    clean = _sane(dart)
    # BPS = 자본 ÷ 주식수. 이익이 거의 없던 해는 '순이익÷EPS' 로 구한 주식수가 크게 틀어지므로
    # 그 해 주식수가 여러 해 가운데값과 1.5배 넘게 다르면 가운데값을 쓴다
    shares = sorted(r["ni"] / r["eps"] for r in clean.values() if r.get("ni") and r.get("eps") and r["ni"] * r["eps"] > 0)
    med = shares[len(shares) // 2] if shares else None
    for y, rec in clean.items():
        if med and rec.get("equity"):
            s = rec["ni"] / rec["eps"] if (rec.get("ni") and rec.get("eps") and rec["ni"] * rec["eps"] > 0) else med
            if not (med / 1.5 < s < med * 1.5):
                s = med
            rec = dict(rec, bps=rec["equity"] / s)
        hist[int(y)] = {k: rec.get(k) for k in ("eps", "bps", "dps", "roe", "payout")} | {"src": "DART"}
    # DART 값이 와이즈리포트와 겹치는 해에 단위가 다르면(예: 1/40) 보정하거나 버린다
    if wise:
        for key in ("eps", "bps", "dps"):
            ratios = [wise[y][key] / dart_v for y in wise if not wise[y].get("estimate")
                      and (dart_v := (hist.get(y) or {}).get(key)) and wise[y].get(key) and dart_v * wise[y][key] > 0]
            if key == "bps":
                # BPS 는 1년에 2배 넘게 바뀌기 어렵다 → 와이즈리포트 첫 해부터 한 해씩 거슬러 올라가며
                # 바로 다음 해와 2배 넘게 차이 나는 DART 값은 버린다 (보고서마다 단위가 섞인 경우)
                wy = min((y for y in wise if not wise[y].get("estimate") and wise[y].get("bps")), default=None)
                if wy:
                    nxt = wise[wy]["bps"]
                    for y in sorted((y for y in hist if y < wy), reverse=True):
                        v = hist[y].get("bps")
                        if v is None:
                            continue
                        if v <= 0 or not 0.5 < nxt / v < 2:
                            hist[y]["bps"] = None
                            hist[y]["roe"] = None  # 같은 자본 숫자로 낸 ROE 도 틀림 (현대백화점 2017~20년 ROE 200%대)
                        else:
                            nxt = v
                continue
            if not ratios:
                continue
            r = sorted(ratios)[len(ratios) // 2]
            if 0.8 < r < 1.25:
                continue
            consistent = all(0.8 < x / r < 1.25 for x in ratios)
            for y, rec in hist.items():
                if rec.get("src") == "DART" and rec.get(key) is not None:
                    rec[key] = rec[key] * r if consistent else None
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


if __name__ == "__main__":  # 자체 점검: 분기 3개월 영업이익과 1년 전 같은 분기 (4분기 = 연간 − 3분기 누적)
    rep = {"2025_11014": {"op": {"thstrm_amount": 30, "thstrm_add_amount": 80, "frmtrm_q_amount": 20, "frmtrm_add_amount": 60}},
           "2025_11011": {"op": {"thstrm_amount": 120, "frmtrm_amount": 90}},
           "2026_11013": {"op": {"thstrm_amount": 50, "frmtrm_q_amount": None, "frmtrm_add_amount": 25}}}
    q = q_from_reports(rep)
    assert q["202509"]["op"] == 30 and q["202509"]["op_ago"] == 20
    assert q["202512"]["op"] == 40 and q["202512"]["op_ago"] == 30
    assert q["202603"]["op"] == 50 and q["202603"]["op_ago"] == 25
    # 옛 DART 값 바로잡기: 주식 수 100주 · 2014년 EPS 가 1,000배(원↔천원) → 1/1000 · 2015년 EPS 빔 → 2016년 주식 수로 · 2013년 10배 차이(증자일 수 있음) → 버림
    dd = {2014: {"ni": 1000, "eps": 10000}, 2015: {"ni": 2000}, 2016: {"ni": 3000, "eps": 30}, 2017: {"ni": 4000, "eps": 40},
          2018: {"ni": 5000, "eps": 50}, 2013: {"ni": 1000, "eps": 100}}
    sn = _sane(dd)
    assert sn[2014]["eps"] == 10 and sn[2015]["eps"] == 20 and sn[2016]["eps"] == 30 and 2013 not in sn, sn
    print("ok")
