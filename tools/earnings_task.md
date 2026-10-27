실적발표(컨퍼런스콜) 자동 요약 — 이 컴퓨터의 예약 작업이 매일 따라 하는 순서 (무료: Claude 구독으로 실행)

작업 폴더: C:\Users\hyunm\valuation-dashboard (git, main 브랜치)

1. `git pull --rebase` 후 config/stocks.yaml 의 보유종목(holdings)과 config/earnings.yaml 을 읽는다.
2. 종목마다 최근 끝난 분기(예: 3Q26)의 실적발표가 이미 나왔는지 확인하고, config/earnings.yaml 에 그 분기가 없으면 요약 대상.
   - 미국: 회사 IR 사이트의 공식 'Earnings Call Transcript' PDF 를 우선 쓴다. 대부분 IR 사이트(Q4 Inc.)는
     https://<IR 주소>/feed/FinancialReport.svc/GetFinancialReportList?LanguageId=1&reportTypes=First%20Quarter|Second%20Quarter|Third%20Quarter|Fourth%20Quarter&pageSize=2&pageNumber=0&includeTags=true&year=-1&excludeSelection=1
     에서 문서 목록(DocumentTitle·DocumentPath)을 준다 (예: investor.atmeta.com). 없으면 IR 페이지·보도자료·주주서한(테슬라 등)을 쓴다.
   - 한국: 컨퍼런스콜 원문이 대개 없으니 DART 분기보고서·IR 발표자료·실적 기사로 요약하고 source 에 그렇게 적는다.
   - 로그인·유료벽·로봇 확인(CAPTCHA)이 있는 곳은 우회하지 않고 건너뛴다 (시킹알파·벤징가 등). 받은 파일은 스크래치 폴더의 새 폴더에 두고 python -I 로 텍스트만 뽑는다.
3. config/earnings.yaml 의 해당 종목 맨 위에 아래 형식으로 추가한다 (최신이 위):
   - quarter: 3Q26 / date: 발표일 / source: 출처와 URL
   - body: 1️⃣ 실적 요약(재무성과 — 매출·이익률·순이익·EPS·CAPEX·FCF·현금, YoY / 부문성과 / 가이던스)
           2️⃣ CEO 3~5개, 3️⃣ CFO 3~5개, 4️⃣ Q&A 하이라이트 3~5개 — 각 항목은 제목 + ①② 두 줄, 중요한 건 ⭐️
   - short: '핵심만' 4~6줄 (한 줄에 숫자 하나 이상, 가장 압축)
   원문에 없는 숫자는 만들지 않는다. 쉬운 한국어로.
4. YAML 이 읽히는지 확인(python 으로 load) → 커밋 메시지 "<종목> <분기> 실적발표 요약" + 끝에 빈 줄과
   "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" → `git pull --rebase; git push`.
5. 새로 요약한 게 없으면 아무것도 바꾸지 않는다. 보고는 쉬운 한국어로 짧게, 맨 마지막 줄에 https://valuation-dashboard.pages.dev 를 단독으로.

지킬 것: ~/.tg-secrets 등 비밀 정보 건드리지 않기, GitHub 비밀값 출력 금지, 매수/매도 추천 문구 금지.
