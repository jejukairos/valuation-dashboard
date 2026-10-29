실적발표(컨퍼런스콜) 자동 요약 — 이 컴퓨터의 예약 작업이 매일 따라 하는 순서 (무료: Claude 구독으로 실행)

작업 폴더: 이 저장소 폴더 (git, main 브랜치)

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
   - easy: 🐣 주린이를 위한 핵심 간단 요약 3~4줄 — 초등학생도 알아듣는 말로. 첫 줄은 "이 회사는 무엇으로 돈을 버는지 + 이번에 잘했나/못했나",
     어려운 말(컨센서스·마진·CAPEX 등)은 쉬운 말로 바꾸거나 괄호로 풀기, 비유 하나는 좋음 (예: 예약이 꽉 찬 식당), 숫자는 꼭 필요한 것 1~2개만.
     매수/매도 추천·주가 전망은 쓰지 않는다. 첫 화면 '🐣 오늘의 쉬운 요약'에 3일 동안 나온다.
     ⭐ 꼭 넣기: 일회성 비용·이익(소송·합의금, 평가손익, 환율, 충당금, 임단협 비용 선반영, 물량 당겨잡기 등)이 숫자를 키우거나 줄였으면
     "⚠ 한 번만 있는 일: …" 으로 시작하는 줄을 반드시 하나 넣고 (화면에서 강조됨), 그걸 빼면 어떤지 한 마디. 빼지 말 것 —
     계속될 숫자인지(지속성)가 가장 중요하다. 계절성이 큰 업종(조선 조업일수·유통 4분기 등)은 1년 전 같은 분기와 비교한 말도 넣기.
     수주 업종이면 신규 수주와 수주잔고를 헷갈리지 않게 구분해서 쓰기 (신규 수주 = 새로 받은 주문, 수주잔고 = 남은 일감).
   원문에 없는 숫자는 만들지 않는다. 쉬운 한국어로.
3-1. 미국 종목이면 config/segments.yaml 의 그 종목 quarters 에 새 분기 부문별 매출(백만 달러)을 한 줄 추가한다.
   출처는 SEC 8-K 보도자료(99.1)·CFO 자료(99.2) 또는 10-Q 의 부문 표 (WebFetch 로 sec.gov 문서 읽기 가능).
   분기 키는 야후 분기 끝 날짜와 같게 (엔비디아 = 7월 말 등), 부문 이름은 위 줄과 같게, 1년 전 같은 분기 줄이 없으면 그것도 같은 표에서 추가.
   한국 종목은 와이즈리포트 '주요제품 매출구성'을 자동으로 받으니 할 일 없음.
   - transcript: 원문 자막 화면 주소 (한국 = script_url) — 사이트에 '발표 자막 원문 보기' 링크로 나옴
3-2. config/kpi.yaml 에 그 종목이 있으면 (🔑 핵심 지표) 같은 그래프·같은 선 이름에 새 분기 값("26.4Q" 같은 키)을 추가하고,
   선마다 가장 오래된 분기를 지워 5개만 남긴다. latest 를 새 분기로, src 에 이번 자료(제목·URL)를 맨 앞에 넣는다.
   값은 이번 발표 자료(보도자료·IR PDF·자막)에 있는 숫자만 — 못 찾은 선은 그 분기를 비워 둔다. 핵심 지표가 바뀌었다고 판단되면(컨퍼런스콜 질문이
   다른 숫자에 몰림) 그래프를 새로 만들지 말고 보고에 한 줄로 알린다.
   미국 종목은 💸 현금흐름도: site/data/stocks/{티커}.json 의 qtrs 에 새 분기(끝 날짜)가 아직 없으면 kpi.yaml 그 종목에
   fcf_add: {"26.4Q": 값} 을 넣는다 (보도자료 현금흐름표의 영업현금흐름 − 설비투자(Purchases of property and equipment), 백만 달러,
   키는 분기 끝 달 기준 — 엔비디아 1월 끝 = "27.1월"). 야후에 들어오면 화면이 야후 값을 쓰니 지난 fcf_add 는 지워도 된다.
3-3. 🎯 사업부문별 컨센서스 (config/seg_cons.yaml):
   - 발표 3일 전 ~ 발표 전 (ir_calendar dday 0~3): 그 종목·그 분기의 부문별 예상치(매출·영업이익·주요 부문·CapEx·EPS)를 공개 기사·증권사 리뷰
     (예: '스트리트어카운트 예상', '컨센서스', '시장 예상치')에서 찾아 est 로 넣는다. 찾은 곳을 src 에. 못 찾으면 넣지 않는다 (만들지 않기).
   - 발표 뒤: 같은 분기 항목에 실적(act)을 보도자료·IR 숫자로 채운다. 예상만 있고 실적이 비어 있는 분기가 있으면 사이트 첫 화면 일정에 '🎯 부문 예상'이 떠요.
   - 보고 맨 위에 "다음 실적 전 부문별 예상" (종목·분기·핵심 항목 2~3개)을 짧게 적는다.
3-4. 🐣 실적발표 말고도 주가를 바꿀 만한 새 일이 있으면 config/events.yaml 맨 위에 추가한다 (date·code·title·easy 2~4줄·src, easy 규칙은 위와 같음):
   - site/data/orders.json 에 최근 3일 새로 잡힌 큰 수주 공시 (그 회사 연 매출의 10% 이상이거나 '최대' 같은 말이 붙은 것)
   - site/data/stocks/{코드}.json 의 kq 에 잠정실적이 새로 반영됐는데 earnings.yaml 요약이 아직 없을 때 (예상 대비 크게 웃돌거나 밑돈 경우)
   - config/notes.yaml 에 새로 적힌 증권사 메모 중 전망이 크게 바뀐 것 · site/data/news.json 에서 여러 언론사가 같이 쓴 큰 소식
   같은 일을 두 번 넣지 않는다 (같은 date·code·title 이 있으면 건너뜀). 3일 지난 것은 지우지 말고 그대로 둔다 (화면이 알아서 숨김).
4. (tools/ir_live.ps1 이 부른 경우엔 파일 수정까지만 — 확인·올리기는 스크립트가 함)
   YAML 이 읽히는지 확인(python 으로 load) → 커밋 메시지 "<종목> <분기> 실적발표 요약" + 끝에 빈 줄과
   "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" → `git pull --rebase; git push`.
5. 새로 요약한 게 없으면 아무것도 바꾸지 않는다. 보고는 쉬운 한국어로 짧게: 요약한 종목, 못 한 종목과 이유, 다음 3일 일정.
   맨 마지막 줄에 https://valuation-dashboard.pages.dev 를 단독으로.

지킬 것: ~/.tg-secrets 등 비밀 정보 건드리지 않기, GitHub 비밀값 출력 금지, 매수/매도 추천 문구 금지.
