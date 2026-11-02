# 텔레그램 API 채널(YoungTiger_stock·DOC_POOL·aethersemiresearch)을 읽어 사이트에 올리는 Windows 예약 작업 등록
# 매일 07:45·17:45 + 일~목 저녁 19:40·21:40·23:40·01:40 (사용자가 휴대폰을 보는 20:00~02:00, 2026-11-02 요청) — 컴퓨터가 켜져 있어야 돎
# 사용자가 직접 실행: (Claude Code 채팅창에서)  ! powershell -NoProfile -File tools\tg_api_task.ps1
# 지우기: Unregister-ScheduledTask -TaskName "ValuationDashboard-TG-API" -Confirm:$false
$repo = Split-Path -Parent $PSScriptRoot
$a = New-ScheduledTaskAction -Execute "$repo\.venv\Scripts\python.exe" -Argument "tools\tg_api_reports.py --push" -WorkingDirectory $repo
$eve = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday, Monday, Tuesday, Wednesday, Thursday -At "19:40"
$eve.Repetition = (New-ScheduledTaskTrigger -Once -At "19:40" -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Hours 6 -Minutes 1)).Repetition
$t = @((New-ScheduledTaskTrigger -Daily -At "07:45"), (New-ScheduledTaskTrigger -Daily -At "17:45"), $eve)
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "ValuationDashboard-TG-API" -Description "밸류 신호등: 텔레그램 API 채널 7개월 글 → site/data/tg_api.json (~/.tg-secrets 읽기만)" -Action $a -Trigger $t -Settings $s -Force | Out-Null
Get-ScheduledTask -TaskName "ValuationDashboard-TG-API" | ForEach-Object { "등록됨: {0} ({1}) — 매일 07:45·17:45 + 일~목 19:40·21:40·23:40·01:40" -f $_.TaskName, $_.State }
