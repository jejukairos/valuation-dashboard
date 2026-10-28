# 실적발표·컨퍼런스콜 자막 받기 + 요약 — 이 컴퓨터의 Windows 예약 작업이 10분마다 실행 (무료: Claude 구독)
# 1) 보유·관심·공동 종목 중 지금 어닝콜이 열린(또는 6시간 안에 끝난) 한국 종목 → 네이버 '발표 자막'을 Edge 로 열어 transcripts\ 에 저장
#    (라이브 중에는 10분마다 다시 받아 파일이 계속 늘어남)
# 2) 발표가 끝나면(다시보기 준비 완료) claude 로 요약 → config/earnings.yaml · site/data/earnings.json → git push
# 3) 매일 아침 8시대 첫 실행 때 tools/earnings_task.md 순서(미국 공식 원문 등 빠진 것)를 한 번 더 돌림
# 비밀 정보는 건드리지 않음. 로그: transcripts\ir_live.log
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$td = Join-Path $repo "transcripts"
New-Item -ItemType Directory -Force $td | Out-Null
$log = Join-Path $td "ir_live.log"
function Log($m) { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm') $m" -Encoding UTF8 }
$py = Join-Path $repo ".venv\Scripts\python.exe"
$claude = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$port = 9355

function Publish($msg, $files = @("config/earnings.yaml", "config/segments.yaml", "site/data/earnings.json")) {
    # 요약 파일이 읽히면 사이트용 json 도 만들고 그 파일들만 올림
    if ($files -contains "site/data/earnings.json") {
        & $py tools\earnings_check.py export
        if ($LASTEXITCODE -ne 0) { Log "earnings.yaml 읽기 실패 - 올리지 않음"; return $false }
    }
    git add $files
    git commit -q -m "$msg`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- $files
    for ($i = 0; $i -lt 3; $i++) {
        git pull --rebase --autostash -X theirs -q  # 겹치면 지금 올리는 쪽(새 요약·새 표)이 이김
        if ($LASTEXITCODE -ne 0) { git rebase --abort 2>$null; Start-Sleep 20; continue }
        git push -q; if ($LASTEXITCODE -eq 0) { return $true }
    }
    Log "push 실패"; return $false
}

git pull --rebase --autostash -q 2>$null
$cal = Get-Content (Join-Path $repo "site\data\ir_calendar.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$now = Get-Date
foreach ($e in @($cal.items | Where-Object { $_.market -eq "KR" })) {
    $when = ([DateTimeOffset]::Parse($e.when)).LocalDateTime
    if ($e.time_unknown -or $now -lt $when.AddMinutes(-5) -or $now -gt $when.AddHours(6)) { continue }
    try { $ec = (Invoke-RestMethod "https://stock.naver.com/api/stockSecurity/earning-calls/v1/$($e.code)" -TimeoutSec 20).earningCall } catch { Log "$($e.name) 일정 확인 실패: $_"; continue }
    if (-not $ec -or -not $ec.aspUrl) { Log "$($e.name) 자막 화면 없음 (네이버가 자막을 안 주는 발표)"; continue }
    $qtr = "$($ec.fiscalQuarter)Q$($ec.fiscalYear.Substring(2))"
    $txt = Join-Path $td "$($e.code)_$($ec.fiscalYear)Q$($ec.fiscalQuarter).txt"
    if (Test-Path "$txt.done") { continue }
    $p = Start-Process -FilePath $edge -ArgumentList "--headless=new", "--disable-gpu", "--user-data-dir=$td\.edge", "--remote-debugging-port=$port", "--window-size=1280,1400", "about:blank" -PassThru
    Start-Sleep 4
    node tools\ec_read.mjs $ec.aspUrl $txt $port 2>&1 | ForEach-Object { Log "$($e.name) $_" }
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    if ($ec.mediaStatus -ne "DONE" -or -not (Test-Path $txt) -or (Get-Item $txt).Length -lt 2000) { continue }  # 아직 진행 중이면 다음 실행 때 다시
    & $py tools\earnings_check.py has $e.code $qtr
    if ($LASTEXITCODE -eq 0) { New-Item "$txt.done" -ItemType File -Force | Out-Null; continue }
    $prompt = "transcripts\$(Split-Path $txt -Leaf) 는 $($e.name)($($e.code)) $qtr 어닝콜 발표 자막 원문이야. tools/earnings_task.md 3번 형식 그대로 config/earnings.yaml 의 `"$($e.code)`" 맨 위에 quarter: $qtr 요약을 추가해줘 (date: $($when.ToString('yyyy-MM-dd')), source: 네이버 증권 IR 어닝콜 발표 자막, transcript: $($ec.aspUrl)). 원문에 없는 숫자는 만들지 말고 쉬운 한국어로. 파일 수정만 하고 git 은 하지 마."
    & $claude -p $prompt --permission-mode acceptEdits --allowedTools "Read,Edit,Write" 2>&1 | Out-File -Append -FilePath $log -Encoding utf8
    & $py tools\earnings_check.py has $e.code $qtr
    if ($LASTEXITCODE -eq 0 -and (Publish "$($e.name) $qtr 실적발표 요약 (발표 자막)")) { New-Item "$txt.done" -ItemType File -Force | Out-Null; Log "$($e.name) $qtr 요약 올림" }
    else { Log "$($e.name) $qtr 요약 실패 - 다음 실행 때 다시" }
}

# 매일 아침: 다올 'Amazon K-Beauty 데일리' 그림 표 → Claude 가 옮김 → 합계 점검(tools/amazon_img.py) → 🏭 산업 탭 (하루 3번까지)
$today = Get-Date -Format "yyyy-MM-dd"
$astamp = Join-Path $td ".amazon_$(Get-Date -Format yyyyMMdd)"
$tries = if (Test-Path $astamp) { [int](Get-Content $astamp) } else { 0 }
if ($now.Hour -ge 7 -and $tries -lt 3 -and -not (Test-Path "$astamp.done")) {
    $post = $null
    try {
        $h = (Invoke-WebRequest "https://t.me/s/alexppark?q=Amazon%20K-Beauty" -UseBasicParsing -TimeoutSec 30).Content
        $post = $h -split 'data-post="' | Select-Object -Skip 1 | Where-Object { $_ -match "\($today\)" -and $_ -match "photo_wrap" } | Select-Object -Last 1
    } catch { Log "다올 채널 읽기 실패: $_" }
    if ($post) {  # 오늘 글이 아직 없으면 다음 실행 때 다시
        Set-Content $astamp ($tries + 1)
        $ad = Join-Path $td "amazon"; New-Item -ItemType Directory -Force $ad | Out-Null
        $img = [regex]::Match($post, "photo_wrap[^>]*background-image:url\('([^']+)'\)").Groups[1].Value
        Invoke-WebRequest $img -OutFile (Join-Path $ad "$today.jpg") -UseBasicParsing
        $res = Join-Path $ad "$today.txt"
        $prompt = "transcripts\amazon\$today.jpg 는 아마존 K-뷰티 브랜드별 Top100 품목 수 표 그림이야. 그림을 읽고 JSON 한 줄만 출력해: " +
            '{"date":"YYYY-MM-DD","counts":{"브랜드":[미국,영국,독일,프랑스,스페인,이탈리아]},"row_totals":{"브랜드":합계칸},"col_totals":[합계 줄의 미국~이탈리아 6칸]} ' +
            "— 숫자는 품목 수만 (▲▼ 옆 변화 숫자는 빼고, – 는 0). 다른 말은 하지 마."
        & $claude -p $prompt --allowedTools "Read" 2>&1 | Out-File -FilePath $res -Encoding utf8
        & $py tools\amazon_img.py $today "https://t.me/$(($post -split '"')[0])" $res | ForEach-Object { Log "아마존 표: $_" }
        if ($LASTEXITCODE -eq 0) {
            & $py collector\kbeauty.py | Out-Null
            git checkout -- cache/kbeauty.json 2>$null  # 채널 글 묶음은 GitHub 갱신이 관리
            if (Publish "아마존 K-뷰티 $today 표 (다올 그림, Claude 옮김·합계 점검)" @("cache/kbeauty_img.json", "site/data/amazon_kbeauty.json")) {
                New-Item "$astamp.done" -ItemType File -Force | Out-Null; Log "아마존 표 $today 올림"
            }
        }
    }
}

# 매일 아침 한 번: 미국 공식 원문 등 빠진 요약 (earnings_task.md)
$stamp = Join-Path $td ".daily_$(Get-Date -Format yyyyMMdd)"
if ($now.Hour -ge 8 -and -not (Test-Path $stamp)) {
    New-Item $stamp -ItemType File -Force | Out-Null
    $prompt = "tools/earnings_task.md 를 읽고 그 순서대로 오늘 실적발표 요약을 해줘. 한국 종목 자막은 transcripts 폴더에 있으면 그걸 써. 파일 수정만 하고 git 은 하지 마. 모든 답변은 쉬운 한국어로."
    & $claude -p $prompt --permission-mode acceptEdits --allowedTools "Read,Edit,Write,WebFetch,WebSearch" 2>&1 | Out-File -Append -FilePath $log -Encoding utf8
    if (git status --porcelain config/earnings.yaml config/segments.yaml) { if (Publish "실적발표 요약 (매일 점검)") { Log "매일 점검 요약 올림" } } else { Log "매일 점검: 새 요약 없음" }
}
