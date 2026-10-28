실적발표(컨퍼런스콜) 자동 요약 — 이 컴퓨터의 예약 작업이 매일 따라 하는 순서 (무료: Claude 구독으로 실행)

작업 폴더: C:\Users\hyunm\valuation-dashboard (git, main 브랜치)

1. `git pull --rebase` 후 site/data/ir_calendar.json (보유·관심·공동자산 종목의 실적발표·컨퍼런스콜 일정, 매 갱신마다 자동으로 새로 받음)과
   config/earnings.yaml 을 읽는다. 일정이 지났거나 오늘인데(dday ≤ 0, 발표 시각이 지난 것) earnings.yaml 에 그 분기가 아직 없는 종목이 요약 대상.
2. 원문 가져오기 — 사람처럼 화면을 열어 읽는다 (숨은 API 를 추측해 부르거나 차단을 우회하지 않는다):
   - 한국: tools/ir_live.ps1(Windows 예약 작업, 10분마다)이 네이버 '발표 자막' 전체를 transcripts\{코드}_{연도}Q{분기}.txt 로 저장해 둔다.
     그 파일을 읽는다. 없으면 site/data/ir_calendar.json 의 script_url(네이버 공개 자막 화면)을
     `node tools/ec_read.mjs <script_url> <저장 파일> <포트>` 로 받는다 (Edge 를 --headless=new --remote-debugging-port=<포트> 로 먼저 띄움).
     자막이 아예 없는 발표면 같은 IR 탭의 IR 자료(PDF 링크)를 쓴다. 네이버 'AI 요약'은 참고만 하고, 요약은 자막 원문 기준으로 직접 쓴다.
   - 미국: 회사 IR 사이트의 공식 'Earnings Call Transcript' PDF. Q4 Inc. IR 사이트는
     https://<IR 주소>/feed/FinancialReport.svc/GetFinancialReportList?LanguageId=1&reportTypes=First%20Quarter|Second%20Quarter|Third%20Quarter|Fourth%20Quarter&pageSize=2&pageNumber=0&includeTags=true&year=-1&excludeSelection=1
     에서 문서 목록을 준다 (예: investor.atmeta.com). 없으면 보도자료·주주서한(테슬라 등).
   - 로그인·유료벽·로봇 확인(CAPTCHA)이 있으면 건너뛰고 보고만 한다. 받은 PDF 는 스크래치 폴더의 새 폴더에 두고 python -I 로 텍스트만 뽑는다.
3. config/earnings.yaml 의 해당 종목 맨 위에 추가한다 (최신이 위, 종목 키는 stocks.yaml 의 code 그대로 — 한국은 "042660" 처럼 따옴표):
   - quarter: 3Q26 / date: 발표일 / source: 출처와 URL (예: "네이버 증권 IR 어닝콜 발표 자막")
   - body: 1️⃣ 실적 요약(재무성과 — 매출·영업이익·이익률·순이익·EPS·CAPEX·FCF·현금, YoY / 부문성과 / 가이던스)
           2️⃣ CEO(또는 발표자) 3~5개, 3️⃣ CFO 3~5개, 4️⃣ Q&A 하이라이트 3~5개 — 각 항목은 제목 + ①② 두 줄, 중요한 건 ⭐️
   - short: '핵심만' 4~6줄 (한 줄에 숫자 하나 이상, 가장 압축)
   원문에 없는 숫자는 만들지 않는다. 쉬운 한국어로.
3-1. 미국 종목이면 config/segments.yaml 의 그 종목 quarters 에 새 분기 부문별 매출(백만 달러)을 한 줄 추가한다.
   출처는 SEC 8-K 보도자료(99.1)·CFO 자료(99.2) 또는 10-Q 의 부문 표 (WebFetch 로 sec.gov 문서 읽기 가능).
   분기 키는 야후 분기 끝 날짜와 같게 (엔비디아 = 7월 말 등), 부문 이름은 위 줄과 같게, 1년 전 같은 분기 줄이 없으면 그것도 같은 표에서 추가.
   한국 종목은 와이즈리포트 '주요제품 매출구성'을 자동으로 받으니 할 일 없음.
   - transcript: 원문 자막 화면 주소 (한국 = script_url) — 사이트에 '발표 자막 원문 보기' 링크로 나옴
4. (tools/ir_live.ps1 이 부른 경우엔 파일 수정까지만 — 확인·올리기는 스크립트가 함)
   YAML 이 읽히는지 확인(python 으로 load) → 커밋 메시지 "<종목> <분기> 실적발표 요약" + 끝에 빈 줄과
   "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" → `git pull --rebase; git push`.
5. 새로 요약한 게 없으면 아무것도 바꾸지 않는다. 보고는 쉬운 한국어로 짧게: 요약한 종목, 못 한 종목과 이유, 다음 3일 일정.
   맨 마지막 줄에 https://valuation-dashboard.pages.dev 를 단독으로.

지킬 것: ~/.tg-secrets 등 비밀 정보 건드리지 않기, GitHub 비밀값 출력 금지, 매수/매도 추천 문구 금지.
