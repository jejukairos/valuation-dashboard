# ⭐ 매주 일정 점검 — 이 컴퓨터의 Windows 예약 작업이 매주 일요일 저녁 실행 (무료: Claude 구독)
# 보유·관심·공동 전 종목(stocks.yaml, 한국·미국)을 10개씩 나눠 claude 로 tools/catalyst_task.md 를 돌림
# → config/timeline.yaml 만 고침 → YAML 확인 → 그 파일만 git push (사이트 반영은 다음 데이터 갱신의 timeline.json)
# 사용자 11/26 "매주 점검 이렇게, 보유·관심 전부, 수급·목표가 빼고, 확정·예상 구분" · 비밀 정보는 건드리지 않음 · 로그: transcripts\catalyst_week.log
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$td = Join-Path $repo "transcripts"
New-Item -ItemType Directory -Force $td | Out-Null
$log = Join-Path $td "catalyst_week.log"
function Log($m) { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm') $m" -Encoding UTF8 }
$py = Join-Path $repo ".venv\Scripts\python.exe"
$claude = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = New-Object System.Text.UTF8Encoding $false  # 파이썬에 넘길 때 BOM 없이
$tl = "config/timeline.yaml"
$today = Get-Date -Format "yyyy-MM-dd"

Log "시작"
git pull --rebase --autostash -q
# 종목 묶음: 보유 → 관심 → 공동 순, 같은 종목은 한 번 (우선주 005935 는 보통주와 같아서 뺌), 10개씩 한 줄
$batches = @'
import yaml
d = yaml.safe_load(open("config/stocks.yaml", encoding="utf-8"))
seen, out = set(), []
for g in ("holdings", "watchlist", "joint"):
    for s in d.get(g) or []:
        c = str(s["code"])
        if c not in seen and c != "005935":
            seen.add(c); out.append(f"{c}({s['name']})")
for i in range(0, len(out), 10):
    print(" ".join(out[i:i + 10]))
'@ | & $py -X utf8 -
$sum = @()
$n = 0
foreach ($b in $batches) {
    if (-not $b.Trim()) { continue }
    $n++
    Copy-Item $tl "$tl.bak" -Force
    Remove-Item (Join-Path $td "catalyst_week_last.txt") -ErrorAction SilentlyContinue
    $prompt = "tools/catalyst_task.md 를 읽고 그대로 해줘. 오늘: $today. 이번 종목: $b. 파일 수정만 하고 git 은 하지 마. 모든 답변은 쉬운 한국어로."
    Log "묶음 $n : $b"
    & $claude -p $prompt --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Grep,Glob,WebSearch,WebFetch" 2>&1 | Out-File -Append -FilePath $log -Encoding utf8
    & $py -X utf8 tools\yaml_ok.py $tl 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Log "묶음 $n timeline.yaml 깨짐 - 이 묶음은 되돌림"; Copy-Item "$tl.bak" $tl -Force; continue }
    $f = Join-Path $td "catalyst_week_last.txt"
    if (Test-Path $f) { $sum += Get-Content $f -Encoding UTF8 }
}
Remove-Item "$tl.bak" -ErrorAction SilentlyContinue
git diff --quiet -- $tl
if ($LASTEXITCODE -eq 0) { Log "바뀐 일정 없음 - 끝"; exit 0 }
# 커밋 첫 줄 = 🔔 새 소식 탭 문장
$new = ($sum | ForEach-Object { if ($_ -match "새 (\d+)") { [int]$Matches[1] } else { 0 } } | Measure-Object -Sum).Sum
$late = ($sum | ForEach-Object { if ($_ -match "늦어짐 (\d+)") { [int]$Matches[1] } else { 0 } } | Measure-Object -Sum).Sum
$msg = "⭐ 매주 일정 점검 ($(Get-Date -Format 'M/d')) — 전 종목 앞으로 일정: 새 재료 ${new}개 · 늦어짐 ${late}개`n`n" + (($sum | Select-Object -First 15 | ForEach-Object { "- $_" }) -join "`n") + "`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git commit -q -m $msg -- $tl
for ($i = 0; $i -lt 3; $i++) {
    git push -q 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Log "올림: 새 $new · 늦어짐 $late"; exit 0 }
    git pull --rebase --autostash -q
}
Log "push 실패 (3번) - 다음 주에 다시"
