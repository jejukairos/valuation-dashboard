"""📐 주봉 차트 모양 — 조건에 맞으면 종목 상세·첫 화면에 한 줄로 알려 줌 (매수·매도 판단 아님).
① 윌리엄 오닐 컵위드핸들 ② 하락 추세선(고점-고점 / 저점-저점) 돌파·이탈 ③ 전고점 돌파 ④ 돌파한 전고점으로 다시 내려와 지지 시험.
shortcut: 주봉 '종가'만으로 판단 (장중 고가·저가 꼬리는 못 봄) — 더 정확히 하려면 가격 수집을 고가·저가 포함으로 바꿀 것."""
import numpy as np

from compute import weekly_close


def _piv(w, k, hi=True):
    """좌우 k주 안에서 가장 높은(hi) / 낮은 주. 마지막 k주는 아직 확정이 안 돼서 뺌."""
    return [i for i in range(k, len(w) - k) if w[i] == (w[i - k:i + k + 1].max() if hi else w[i - k:i + k + 1].min())]


def _prior(w, T):
    """전고점: 2년 안에서 가장 높았고 13주 넘게 못 넘던 고점(좌우 13주 최고), 최근 3년 안에 넘은 것 → [(고점 주, 처음 넘은 주, 값)]"""
    out = []
    for j in _piv(w, 13):
        L = w[j]
        up = np.nonzero(w[j + 1:T + 1] > L)[0]
        if len(up) and up[0] + 1 >= 13 and T - (j + 1 + up[0]) <= 156 and L >= w[max(0, j - 104):j + 1].max():
            out.append((j, j + 1 + int(up[0]), L))
    return out


def _line(w, T, hi):
    """하락 추세선: 최근 2.5년 안 가장 높은 고점 A ~ 그 뒤 더 낮은 고점 B (저점선은 A 뒤 첫 큰 저점 ~ 더 낮은 저점).
    A~B 사이 종가가 선 밖(2% 넘게)으로 나간 적 없어야 함. → (A, B, 기울기, 처음 뚫은 주 | None)"""
    lo = max(0, T - 130)
    hp = [i for i in _piv(w, 6) if lo <= i <= T - 4]
    if not hp:
        return None
    A0 = max(hp, key=lambda i: w[i])
    piv = hp if hi else [i for i in _piv(w, 6, False) if A0 < i <= T - 4]
    if len(piv) < 2:
        return None
    A, sign = (A0 if hi else piv[0]), (1 if hi else -1)
    for B in reversed([i for i in piv if i - A >= 8 and w[i] < w[A]]):
        s = (w[B] - w[A]) / (B - A)
        ln = w[A] + s * (np.arange(len(w)) - A)
        if np.any(sign * (w[A + 1:B] - ln[A + 1:B] * (1 + sign * 0.02)) > 0):
            continue  # 사이에서 선을 뚫은 적이 있으면 다음 B
        if hi and w[A] / w[B] - 1 < 0.10:
            return None  # 10% 도 안 내려온 선은 추세라 부르기 어려움
        brk = np.nonzero(sign * (w[B + 1:T + 1] - ln[B + 1:T + 1]) > 0)[0]
        return A, B, s, (B + 1 + int(brk[0]) if len(brk) else None)
    return None


def _cup(w, T):
    """오닐 컵위드핸들: 25% 넘게 오른 뒤 왼쪽 입술 → 12~40% 내려간 둥근 바닥 → 왼쪽 입술 90~105% 까지 회복(오른쪽 입술, 7~65주)
    → 3~15% 짧게 눌림(손잡이 1~10주, 컵 위쪽 절반) → 손잡이 고점 위로 종가가 올라서면 '돌파'."""
    for t in (T, T - 1, T - 2):  # 돌파는 2주 전까지 '돌파'로 보여 줌
        for a in sorted((i for i in _piv(w, 4) if t - 75 <= i <= t - 9), reverse=True):
            H = w[a]
            if H < 1.25 * w[max(0, a - 30):a + 1].min():
                continue
            b = a + 1 + int(w[a + 1:t].argmin())
            if not 0.12 <= 1 - w[b] / H <= 0.40 or b >= t - 3:
                continue
            c = b + 1 + int(w[b + 1:t].argmax())
            R = w[c]
            if not (0.90 * H <= R <= 1.05 * H and 7 <= c - a <= 65) or w[a + 1:c].max() > max(H, R):
                continue
            out = w[t] > R
            h = w[c + 1:t] if out else w[c + 1:t + 1]
            if not 1 <= len(h) <= 10 or not 0.03 <= 1 - h.min() / R <= 0.15 or h.min() < w[b] + (H - w[b]) / 2:
                continue
            if t < T and not (out and w[T] > R):
                continue
            return {"a": a, "b": b, "c": c, "R": R, "out": bool(out), "ago": T - t}
    return None


def weekly(px, dg=0, weeks=156):
    """일별 종가 → {"w": 최근 3년 주봉, "sig": [{k, t, d}], "lines": [...], "levels": [...]}"""
    s = weekly_close(px)
    if len(s) < 60:
        return None
    w, D = s.values.astype(float), [d.strftime("%Y-%m-%d") for d in s.index]
    T, r = len(w) - 1, lambda v: round(float(v), dg) if dg else int(round(float(v)))  # 한국(원)은 정수 — '257,000.0' 이 안 되게
    sig, lines, levels = [], [], []
    cup = _cup(w, T)
    if cup:
        R, depth = cup["R"], (1 - w[cup["b"]] / w[cup["a"]]) * 100
        levels.append({"v": r(R), "t": "손잡이 고점"})
        lines.append({"k": "cup", "p": [[D[i], r(w[i])] for i in (cup["a"], cup["b"], cup["c"])]})
        sig.append({"k": "cup", "t": "컵위드핸들 돌파" if cup["out"] else "컵위드핸들 만드는 중",
                    "d": f"{D[cup['a']][:7]} 고점 → {depth:.0f}% 눌린 컵 {cup['c'] - cup['a']}주 → 손잡이 고점 {r(R):,}"
                         + (f" 위로 종가 돌파{f' ({cup['ago']}주 전)' if cup['ago'] else ''}" if cup["out"] else f" 아래 {(w[T] / R - 1) * 100:.1f}%")})
    for hi in (True, False):
        ln = _line(w, T, hi)
        if not ln:
            continue
        A, B, sl, brk = ln
        if brk is not None and T - brk > 26:
            continue  # 반년 넘게 전에 뚫린 선은 그리지 않음
        end = brk if brk is not None else T
        lines.append({"k": "hi" if hi else "lo", "p": [[D[A], r(w[A])], [D[end], r(w[A] + sl * (end - A))]]})
        if brk is not None and T - brk <= 3 and (w[T] > w[A] + sl * (T - A)) == hi:
            sig.append({"k": "hi" if hi else "lo", "t": "하락 추세선 위로 돌파" if hi else "하락 추세 아래선 이탈",
                        "d": f"{D[A][:7]}·{D[B][:7]} {'고점' if hi else '저점'}을 이은 선을 {D[brk][5:]} 주 종가로 {'뚫고 올라감' if hi else '깨고 내려감'}"})
    pri = _prior(w, T)
    fresh = [p for p in pri if T - p[1] <= 2 and w[T] > p[2]]
    near = [p for p in pri if T - p[1] >= 4 and w[p[1]:T + 1].max() >= p[2] * 1.10 and p[2] * 0.97 <= w[T] <= p[2] * 1.05]
    lost = [p for p in pri if T - p[1] >= 4 and w[T] < p[2] * 0.97 and T - max(i for i in range(p[1], T + 1) if w[i] >= p[2] * 0.97) <= 4
            and w[p[1]:T + 1].max() >= p[2] * 1.10]
    for kind, ps, t in (("brk", fresh, "전고점 돌파"), ("test", near, "돌파한 전고점 지지 시험"), ("lost", lost, "돌파한 전고점 아래로 다시 내려옴")):
        if ps:
            j, t0, L = max(ps, key=lambda p: p[2])
            levels.append({"v": r(L), "t": "전고점"})
            d = {"brk": f"{D[j][:7]} 고점 {r(L):,} 을 {t0 - j}주 만에 주봉 종가로 넘음",
                 "test": f"{D[t0][:7]} 넘었던 {D[j][:7]} 고점 {r(L):,} 근처로 내려옴 (지금 {(w[T] / L - 1) * 100:+.1f}%) — 여기서 버티는지가 관심",
                 "lost": f"{D[t0][:7]} 넘었던 {D[j][:7]} 고점 {r(L):,} 아래로 내려옴 (지금 {(w[T] / L - 1) * 100:+.1f}%)"}[kind]
            sig.append({"k": kind, "t": t, "d": d})
            break  # 전고점 신호는 하나만 (돌파 > 지지 시험 > 이탈)
    return {"asof": D[T], "w": [[D[i], r(w[i])] for i in range(max(0, T - weeks + 1), T + 1)], "sig": sig, "lines": lines, "levels": levels}


if __name__ == "__main__":  # 간단 점검: 모양을 일부러 만든 주가로
    import pandas as pd

    def mk(v):
        idx = pd.date_range("2020-01-03", periods=len(v), freq="W-FRI")
        return pd.Series(v, index=idx, dtype=float)

    # 전고점 지지 시험: 100 고점 → 60주 동안 못 넘음 → 돌파해서 150 → 다시 101
    v = list(np.linspace(50, 100, 30)) + list(np.linspace(99, 70, 30)) + list(np.linspace(71, 99, 30)) + list(np.linspace(102, 150, 12)) + list(np.linspace(148, 101, 10))
    res = weekly(mk(v))
    assert any(x["k"] == "test" for x in res["sig"]), res["sig"]
    # 전고점 돌파: 막 넘은 주
    res = weekly(mk(list(np.linspace(50, 100, 30)) + list(np.linspace(99, 70, 30)) + list(np.linspace(71, 99, 30)) + [103]))
    assert any(x["k"] == "brk" for x in res["sig"]), res["sig"]
    # 컵위드핸들 돌파: 60→100 오름, 100→75 컵, 75→98 회복, 98→92 손잡이, 101 돌파
    cup = list(np.linspace(60, 100, 20)) + list(100 - 25 * np.sin(np.linspace(0, np.pi, 30))[1:]) + [97, 98, 96, 94, 92, 93, 101]
    res = weekly(mk(list(np.linspace(55, 60, 40)) + cup))
    assert any(x["k"] == "cup" and "돌파" in x["t"] for x in res["sig"]), res["sig"]
    # 하락 추세선 돌파: 지그재그로 내려가다 선 위로
    z = []
    for i in range(6):
        z += list(np.linspace(100 - i * 8, 80 - i * 8, 8)) + list(np.linspace(80 - i * 8, 92 - (i + 1) * 8, 8))
    res = weekly(mk(list(np.linspace(60, 100, 20)) + z + [70, 75, 82]))
    assert any(x["k"] == "hi" for x in res["sig"]), res["sig"]
    print("patterns 점검 통과")
