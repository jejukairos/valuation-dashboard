# 🚦 밸류 신호등

보유종목이 가치에 비해 싼지 비싼지 한눈에 보는 개인용 대시보드예요. 투자 판단 참고용이에요.

## 어떻게 돌아가나
- 평일 07:30, 18:30(한국 시간)에 GitHub Actions 가 데이터를 모아 `site/data/*.json` 에 저장해요. PC 가 꺼져 있어도 돌아가요.
- 저장되면 Cloudflare Pages 가 사이트를 자동으로 다시 올려요.
- 어떤 출처가 실패하면 직전 값을 그대로 보여주고, 화면 맨 위에 "실패 n건"이 떠요.

## 자주 고치는 파일
| 파일 | 내용 |
|---|---|
| `config/stocks.yaml` | 보유종목, 평가 방식(PER/PBR/DIV), 평단가·수량 |
| `config/pbr_watch.yaml` | PBR 계산기 탭 종목·배수·메모 |
| `config/settings.yaml` | 신호등 기준값(0.5 / 0.75), 적정가 계산법, 밴드 정의 |

## 비밀 정보 (코드에 없음)
- GitHub → Settings → Secrets and variables → Actions: `ECOS_KEY`, `DART_KEY` (선택: `KRX_ID`, `KRX_PW`)
- Cloudflare Pages → 설정 → 환경 변수: `SITE_PASSWORD` (사이트 접속 비밀번호)

## 폴더
- `collector/` 데이터 수집·계산 (파이썬)
- `site/` 화면 (HTML·JS, Chart.js)
- `functions/_middleware.js` 접속 비밀번호
- `cache/` 지난 재무·이력 보관 (매번 다시 받지 않도록)
