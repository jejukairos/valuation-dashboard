"""📢 중요 공시만 골라 보기 (OpenDART · 보유·관심·공동 한국 종목, 최근 1년).
단일판매·공급계약은 매출 대비 10% 이상이거나 상대가 글로벌·대기업일 때만. 자사주 매입·소각·처분, 배당, 신규시설투자,
장래사업계획, 밸류업 계획, 유상증자·전환사채. 임원·대주주 1억 원 이상 장내 매매는 holders.py 결과에서 붙인다.
한 번 읽은 본문은 cache/filings/ 에 저장해서 다시 받지 않는다."""
import re

import pandas as pd

from common import CACHE, HTTP, REPORT, load_yaml, now_kst, read_json, write_json
from kr_stock import corp_code, dart_key
from orders import doc_text, parse_doc

FDIR = CACHE / "filings"
KINDS = [  # (공시 이름에 든 말, 꼬리표, 좋고 나쁨, 한 줄 뜻) — 위에서부터 먼저 맞는 것
    ("공급계약해지", "📝 계약 해지", "bad", "받기로 한 매출이 사라져요"),
    ("단일판매", "📝 공급계약", "good", ""),
    ("공급계약체결", "📝 공급계약", "good", ""),
    ("주식소각", "🔥 자사주 소각", "good", "주식 수가 줄어 1주의 몫이 커져요"),
    ("자기주식처분", "⚠ 자사주 처분", "bad", "회사가 가진 주식이 시장에 풀려요"),
    ("자기주식취득", "💰 자사주 매입", "good", "회사가 자기 주식을 사요 (소각까지 하면 더 좋아요)"),
    ("배당", "💵 배당", "", ""),
    ("신규시설투자", "🏗 시설 투자", "", "공장·설비를 늘려요 — 수요에 자신 있다는 뜻, 대신 돈이 나가요"),
    ("유형자산취득", "🏗 시설 투자", "", "공장·땅·설비를 사요"),
    ("장래사업", "🧭 장래 계획", "", "회사가 직접 공시한 앞으로의 계획·목표"),
    ("기업가치제고", "📈 밸류업 계획", "good", "주주환원·자본효율 목표"),
    ("유상증자", "⚠ 유상증자", "bad", "새 주식을 찍어 기존 주주 몫이 묽어져요"),
    ("전환사채", "⚠ 전환사채", "bad", "나중에 주식으로 바뀔 수 있는 빚 — 주식 수가 늘 수 있어요"),
]
BIG = re.compile(r"글로벌|global|대형|apple|애플|nvidia|엔비디아|microsoft|마이크로소프트|google|구글|alphabet|amazon|아마존|테슬라|tesla|"
                 r"intel|인텔|qualcomm|퀄컴|broadcom|브로드컴|tsmc|삼성|현대|기아|한화|롯데|포스코|정부|방위사업청|국방|ministry|army|"
                 r"(?<![a-z])(?:sk|lg|amd|meta)(?![a-z])", re.I)
AMT = ["계약금액(원)", "투자금액(원)", "취득가액(원)", "취득예정금액(원)", "소각예정금액(원)", "배당금총액(원)", "확정발행금액(원)", "권면(전자등록)총액(원)"]
PCT = [("매출액대비(%)", "매출 대비"), ("자기자본대비(%)", "자기자본 대비"), ("자산총액대비(%)", "자산 대비"), ("시가배당율(%)", "시가배당률")]


def kind_of(name):
    nm = re.sub(r"\s|\[.*?\]", "", name)
    if "결과보고" in nm:  # 자사주 취득 '결과' 보고는 빼요 (결정 때 이미 봄)
        return None
    return next((k for k in KINDS if k[0] in nm), None)


def _num_after(t, label):
    m = re.search(re.escape(label) + r"[\s|]*(?:보통주식[\s|]*)?(-?[\d,]+(?:\.\d+)?)", t)
    return float(m.group(1).replace(",", "")) if m else None


def _facts(rcept_no):
    """본문에서 금액(원)과 비율(%) 하나씩 — 양식이 공시마다 달라 첫 번째로 맞는 라벨만."""
    path = FDIR / f"{rcept_no}.json"
    c = read_json(path)
    if c is not None:
        return c
    t = doc_text(rcept_no)
    out = {"amt": next((v for v in (_num_after(t, k) for k in AMT) if v), None),
           "pct": next(([nm, v] for k, nm in PCT if (v := _num_after(t, k)) is not None), None),
           "dps": _num_after(t, "1주당 배당금(원)")}
    write_json(path, out)
    return out


def _eok(v):
    return f"{v / 1e8:,.0f}억" if v else ""


def _list(code, ty, days):
    j = HTTP.get("https://opendart.fss.or.kr/api/list.json",
                 params={"crtfc_key": dart_key(), "corp_code": corp_code(code), "pblntf_ty": ty, "page_count": 100,
                         "bgn_de": (now_kst() - pd.Timedelta(days=days)).strftime("%Y%m%d"), "end_de": now_kst().strftime("%Y%m%d")}).json()
    if j.get("status") not in ("000", "013"):
        raise RuntimeError(j.get("message"))
    return j.get("list", [])  # shortcut: 종류마다 1쪽(최근 100건)만 — 1년에 100건 넘게 내는 회사면 페이지 넘기기 추가


def company(code, days=365):
    out = []
    for f in _list(code, "B", days) + _list(code, "I", days):  # B 주요사항보고(자사주·증자·시설) · I 거래소공시(공급계약·배당·장래계획)
        k = kind_of(f["report_nm"])
        if not k:
            continue
        rn, d = f["rcept_no"], f"{f['rcept_dt'][:4]}-{f['rcept_dt'][4:6]}-{f['rcept_dt'][6:]}"
        row = {"d": d, "k": k[1], "lv": k[2], "t": f["report_nm"].strip(), "why": k[3], "u": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rn}"}
        try:
            if k[1] == "📝 공급계약":
                c = parse_doc(rn)
                ratio, party = c.get("ratio") or 0, c.get("party") or ""
                if ratio < 10 and not BIG.search(party):
                    continue  # 작은 계약은 빼요
                row.update(amt=c.get("amount"), x=" · ".join(s for s in [_eok(c.get("amount")), f"매출 대비 {ratio:g}%" if ratio else "", party,
                           (c.get("name") or "")[:40], f"{c.get('start') or ''}~{c.get('end') or ''}" if c.get("start") else ""] if s))
            else:
                c = _facts(rn)
                row.update(amt=c.get("amt"), x=" · ".join(s for s in [_eok(c.get("amt")), f"주당 {c['dps']:,.0f}원" if c.get("dps") else "",
                           f"{c['pct'][0]} {c['pct'][1]:g}%" if c.get("pct") else ""] if s))
        except Exception:  # noqa: BLE001 - 본문을 못 읽어도 제목·링크는 남겨요
            pass
        out.append(row)
    return out


def collect(hd=None):
    FDIR.mkdir(parents=True, exist_ok=True)
    sy = load_yaml("stocks.yaml")
    out = {}
    for h in [x for k in ("holdings", "watchlist", "joint") for x in (sy.get(k) or [])]:
        code = str(h["code"])
        if h.get("market", "KR") != "KR" or h.get("data_code") or code in out:
            continue
        try:
            rows = company(code)
        except Exception as e:  # noqa: BLE001
            REPORT.fail(f"중요 공시 {h['name']}", f"{type(e).__name__}: {e}")
            continue
        for r in ((((hd or {}).get("companies") or {}).get(code) or {}).get("insider") or {}).get("rows") or []:
            if r.get("amt", 0) >= 1e8:  # 임원·대주주 1억 원 이상 장내 매매 (한국은 대주주·주요 임원 매도가 더 잘 맞는 신호)
                sell = r["kind"] == "매도"
                rows.append({"d": r.get("date") or "", "k": f"👤 {r['role']} {r['kind']}", "lv": "bad" if sell else "good", "amt": r["amt"],
                             "t": f"{r.get('name', '')} ({r.get('pos', '')})", "x": f"{_eok(r['amt'])} · 주당 {r.get('price') or 0:,.0f}원",
                             "why": "대주주·임원이 판 뒤엔 주가가 더 빠지는 경우가 많았어요" if sell else "회사를 잘 아는 사람이 자기 돈으로 샀어요", "u": r.get("url")})
        out[code] = sorted(rows, key=lambda x: x["d"], reverse=True)[:20]
    REPORT.success("중요 공시")
    return {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "companies": out,
            "rule": "최근 1년 · 공급계약은 매출 대비 10% 이상 또는 글로벌·대기업 상대만 · 임원·대주주 장내 매매는 최근 3개월 1억 원 이상",
            "source": "OpenDART 공시 목록·본문"}


if __name__ == "__main__":  # 본문 없이 고르는 규칙만 확인
    assert kind_of("단일판매ㆍ공급계약체결")[1] == "📝 공급계약"
    assert kind_of("[기재정정]단일판매ㆍ공급계약해지")[1] == "📝 계약 해지"
    assert kind_of("자기주식취득결정")[1] == "💰 자사주 매입"
    assert kind_of("자기주식취득신탁계약체결결정")[1] == "💰 자사주 매입"
    assert kind_of("자기주식처분결정")[1] == "⚠ 자사주 처분"
    assert kind_of("주식소각결정")[1] == "🔥 자사주 소각"
    assert kind_of("현금ㆍ현물배당결정")[1] == "💵 배당"
    assert kind_of("신규시설투자등")[1] == "🏗 시설 투자"
    assert kind_of("장래사업ㆍ경영계획(공정공시)")[1] == "🧭 장래 계획"
    assert kind_of("자기주식취득결과보고서") is None and kind_of("기업설명회(IR)개최(안내공시)") is None
    t = "2. 계약금액(원) | | 879,300,000,000 | 매출액대비(%) | 7.8 | 1주당 배당금(원) | 보통주식 | 1,500"
    assert _num_after(t, "계약금액(원)") == 879300000000 and _num_after(t, "매출액대비(%)") == 7.8 and _num_after(t, "1주당 배당금(원)") == 1500
    assert BIG.search("글로벌 대형기업") and BIG.search("SK하이닉스") and not BIG.search("(주)동네상사") and not BIG.search("Desk Co.")
    print("ok")
