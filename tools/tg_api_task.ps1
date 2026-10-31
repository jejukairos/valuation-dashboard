# 텔레그램 API 채널(YoungTiger_stock·DOC_POOL·aethersemiresearch)을 매일 07:45·17:45 에 읽어 사이트에 올리는 Windows 예약 작업 등록
# 사용자가 직접 실행: (Claude Code 채팅창에서)  ! powershell -NoProfile -File tools\tg_api_task.ps1
# 지우기: Unregister-ScheduledTask -TaskName "ValuationDashboard-TG-API" -Confirm:$false
$repo = Split-Path -Parent $PSScriptRoot
$a = New-ScheduledTaskAction -Execute "$repo\.venv\Scripts\python.exe" -Argument "tools\tg_api_reports.py --push" -WorkingDirectory $repo
$t = @((New-ScheduledTaskTrigger -Daily -At "07:45"), (New-ScheduledTaskTrigger -Daily -At "17:45"))
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "ValuationDashboard-TG-API" -Description "밸류 신호등: 텔레그램 API 채널 7개월 글 → site/data/tg_api.json (~/.tg-secrets 읽기만)" -Action $a -Trigger $t -Settings $s -Force | Out-Null
Get-ScheduledTask -TaskName "ValuationDashboard-TG-API" | ForEach-Object { "등록됨: {0} ({1}) — 매일 07:45·17:45" -f $_.TaskName, $_.State }
