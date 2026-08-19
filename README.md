# 세종 민원이음 (플랫폼명: 민원이음) — 최종 MVP

> **모르면 지어내지 않고, 알면 끝까지 안내한다.**

세종 민원이음은 시민의 일상어 질문을 승인된 공식 행정 지식과 연결하는 local/private MVP입니다. 시민에게는 절차·준비 서류·수수료·담당 기관·공식 출처를 구조화해 안내하고, 근거가 부족한 질문은 운영자의 작성과 별도 승인자의 검수를 거쳐 새로운 ACTIVE KB로 전환합니다.

## 검증 현황 (2026-07-30 기준)

| 구분 | 결과 |
| --- | --- |
| 품질 지표 | **9 / 9 목표 달성** (핵심 20문항 + 데모 5문항, 15회 회귀 측정) |
| 테스트 | Pytest **2,617 passed** · 공유 계약 96/96 · Vitest 80/80 · Next production build PASS |
| 정적 검사 | Ruff format/check · strict Mypy — 135 files PASS |
| 개인정보 마스킹률 | **1.00** (전 구간) |
| 비밀값 검사 | 현재 파일·공개 Git history finding **0** |
| 데모 시나리오 | 입찰제안서 7.5 사전 공개 5문항 **원문 그대로** 완주 |

상세 근거는 [10. 검증 명령](#10-검증-명령)과 [`REGRESSION-REPORT.html`](REGRESSION-REPORT.html)을 참고하십시오.

## 목차

[1. 해결하려는 문제](#1-해결하려는-문제) ·
[2. 구현 범위](#2-구현-범위) ·
[3. 핵심 설계 원칙](#3-핵심-설계-원칙) ·
[4. 기술 구성](#4-기술-구성) ·
[5. 저장소 구조](#5-저장소-구조) ·
[6. 실행 방법](#6-실행-방법) ·
[7. 개인정보 보호](#7-개인정보-보호) ·
[8. AI 연결](#8-ai-연결) ·
[9. 동작 확인 시나리오](#9-동작-확인-시나리오) ·
[10. 검증 명령](#10-검증-명령) ·
[11. 팀 역할](#11-팀-역할) ·
[12. 현재 한계](#12-현재-한계) ·
[13. 제출 스냅샷](#13-제출-스냅샷)

## 1. 해결하려는 문제

시민은 행정 용어를 정확히 알기 어렵고, 여러 사이트에서 최신 공식 정보를 다시 확인해야 합니다. 담당자는 같은 단순 문의를 반복해서 처리하며, 답하지 못한 질문이 어떤 지식 보강으로 이어져야 하는지 체계적으로 확인하기 어렵습니다.

민원이음은 다음 두 화면을 하나의 개선 흐름으로 연결합니다.

```text
시민용 민원이음
  질문 → 개인정보 마스킹 → 분류 → ACTIVE KB 검색
       → 공식 근거가 있으면 구조화 답변·출처·기관 안내
       → 근거가 부족하면 안전한 폴백

관리자용 이음센터
  실패 질문 → 사유 확인 → KB 후보 작성
            → 작성자와 다른 승인자 검수 → ACTIVE 반영
            → 같은 질문 재질의 시 개선된 공식 답변
```

이 흐름의 핵심은 "답변 실패를 버리지 않고 다음 공식 답변의 재료로 넘긴다"는 점입니다.
관리자 화면은 단순 승인 화면이 아니라, 실패 사유를 구분하고 반복 실패 패턴을 모아
다음 KB 보강 우선순위를 잡는 운영 화면으로 설계했습니다.

반복 질문 자동 취합은 보관 중인 **마스킹 문구의 동일 여부만 비교하는 규칙 기반 집계**입니다.
외부 AI로 질문을 전송하거나 답변 초안을 자동 승인하지 않으며, 실제 후보 작성과 ACTIVE 반영은
계속 담당자의 작성과 별도 승인자의 검수를 거칩니다.

## 2. 구현 범위

- 시민 화면: `/`, `/chat`
- 관리자 화면
  - `/admin`: 품질 지표와 최근 운영 현황
  - `/admin/analytics`: 4주 실패 추이·분야별 빈도·반복 질문 자동 취합·KB 전환 퍼널
  - `/admin/failures`: 실패 질문 사유 확인과 후보 작성
  - `/admin/kb-candidates`: 작성자와 분리된 승인·ACTIVE 반영
- 지원 분야
  - 전입·주민등록
  - 증명서 발급
  - 대형폐기물
  - 지방세 일반 안내
- 응답 상태
  - 공식 근거 기반 `SUCCESS`
  - 필요한 내용을 다시 묻는 `FOLLOWUP`
  - 폴백 사유
    | 사유 | 의미 | 질문 텍스트 저장 | KB 후보 대상 |
    | --- | --- | --- | --- |
    | `INSUFFICIENT_GROUNDING` | 지원 분야이나 승인 근거 부족 | 마스킹 텍스트 30일 | **예** |
    | `CIVIC_SCOPE_GAP` | 행정 민원이나 지원 4분야 밖 | 마스킹 텍스트(범위 확대 검토 큐) | 아니오 |
    | `PERSONAL_LOOKUP` | 개인별 조회 필요 | 저장 안 함 | 아니오 |
    | `LEGAL_JUDGMENT` | 법적 판단 필요 | 저장 안 함 | 아니오 |
    | `OUT_OF_SCOPE` | 행정 민원이 아님 | 저장 안 함 | 아니오 |
    | `PRIVACY_UNRESOLVED` | 마스킹으로 안전을 보장할 수 없음 | 저장 안 함 | 아니오 |
- 관리자 판정 기준
  - `INSUFFICIENT_GROUNDING`만 KB 후보 전환 대상
  - `PERSONAL_LOOKUP`·`LEGAL_JUDGMENT`·`OUT_OF_SCOPE`·`PRIVACY_UNRESOLVED`는 질문 text 미저장
  - 후보 승인자는 작성자와 달라야 하며, 승인 후에만 `ACTIVE`가 된다
- 공식 데이터 기준선
  - ACTIVE KB 19개
  - 공식 기관 3개
  - 지역·민원 매핑 10개
- 승인 흐름
  - `KB-WASTE-03`을 다른 승인자가 검수해 20번째 ACTIVE로 전환
  - 동일 질문 재질의 시 공식 출처가 포함된 `SUCCESS`

## 3. 핵심 설계 원칙

### 공식 근거 우선

시민 답변 검색 대상은 `ACTIVE+OFFICIAL` KB뿐입니다. 출처명·URL·확인일과 기관 정보는 AI가 만들지 않고 서버가 승인된 KB 메타데이터에서 결합합니다.

### 개인정보 최소화

상세 설계는 [7. 개인정보 보호](#7-개인정보-보호)에 있습니다. 요약하면 마스킹이 모든 후속 처리보다
앞서고, 질문 원문은 어느 시점에도 저장하지 않으며, 보관 대상은 마스킹된 실패 질문과 비식별 집계뿐입니다.

`PERSONAL_LOOKUP`, `LEGAL_JUDGMENT`, `OUT_OF_SCOPE`, `PRIVACY_UNRESOLVED`는 KB 후보로 만들지 않으며 질문 text와 실패 질문 행을 저장하지 않습니다.

### 사람의 승인

지원 범위 안에서 공식 근거가 부족한 `INSUFFICIENT_GROUNDING` 질문만 개선 대상으로 연결합니다. KB 후보 작성자와 승인자는 달라야 하며, 승인되지 않은 후보와 mock 데이터는 시민 답변에 사용되지 않습니다.

### 제한된 AI 사용

- 명백한 지원 질문과 개인정보·정책 질문은 서버의 결정론적 경로가 먼저 처리합니다.
- 마스킹을 통과한 안전한 모호 질문은 DeepSeek `deepseek-v4-flash` 분류기를 선택적으로 사용할 수 있습니다.
- 같은 DeepSeek 모델은 ACTIVE KB와 서버 발급 fact ID 안에서 근거 제한형 답변 표현도 선택적으로 보조합니다.
- 기존 Upstage 경로는 rollback 선택지로 보존하지만 기본 설정과 아래 실행 예시는 DeepSeek로 통일합니다.
- 공급자 장애, timeout, JSON·계약 위반, 근거 불일치가 발생하면 공식 KB 기반 TEMPLATE 응답으로 복구합니다.
- 기본 설정은 외부 공급자 비활성화이며 API key는 저장소에 포함하지 않습니다.

분류기 프롬프트는 **순서가 고정된 5단계 판정 절차**입니다. 앞 단계에서 일치하면 즉시 확정하며,
경로를 하나라도 누락하면 해당 트래픽이 다른 경로로 새기 때문에 전 경로를 빠짐없이 나열합니다.

| 순서 | 조건 | 경로 |
| --- | --- | --- |
| 1 | 순수 범주어(서류·증명서·신고·민원·발급)만 있고 종류가 없음 | `NEEDS_FOLLOWUP` |
| 2 | 지목한 서비스·품목이 승인 목록의 한 행에 해당 | `SUPPORTED` |
| 3 | 지원 분야이나 해당 행이 없음 | `NO_TOPIC_MATCH` |
| 4 | 행정 민원이나 지원 분야 밖 | `CIVIC_SCOPE_GAP` |
| 5 | 행정 민원이 아님 | `NON_CIVIC` |

모델 응답은 그대로 채택되지 않습니다. 서버가 발급한 fact ID와 대조해 어긋나면 초안 전체를 폐기하고
결정론적 TEMPLATE 답변으로 되돌아갑니다. 사실·출처·기관 정보는 어느 경우에도 모델이 아니라
서버가 승인 KB에서 결합합니다.

#### 공급자 선택 근거

제안서 6.1이 예고한 `deepseek-v4-flash` / `upstage` 비교 선택을 수행했습니다.
선택 사유는 한국어 답변 품질이 아니라 **구조화 출력 계약의 통과 안정성**입니다.

| | Upstage `solar-pro3` | DeepSeek `deepseek-v4-flash` |
| --- | --- | --- |
| 한국어 답변 품질(인간 평가) | 4.84 / 5 | — *(분류 계약 통과를 채택 전제로 두어 해당 단계 미실시)* |
| strict JSON 통과 | 27 / 30 | — *(동일 사유로 미실시)* |
| 분류 HTTP·JSON·서버 계약 | `KEY_SET_REJECTED` 9/9 → `ENUM_SHAPE_REJECTED` 9/9 | **9 / 9 통과** |
| 분류 정답률 | 채택 불가 | 6/9 → 8/9 |

Upstage는 답변 품질이 좋았으나 서버가 출력을 시민 분류 결과로 안전하게 채택할 증거가 부족했습니다.
Upstage 코드는 삭제하지 않고 선택 가능한 예비 공급자로 유지합니다.
상세 기록은 [`docs/test-reports/LLM-004-DEEPSEEK-LOCAL-ACCEPTANCE.md`](docs/test-reports/LLM-004-DEEPSEEK-LOCAL-ACCEPTANCE.md)에 있습니다.

## 4. 기술 구성

| 영역 | 기술 |
| --- | --- |
| Frontend | Next.js 16.2.10, React 19, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python, Pydantic, psycopg |
| Database | PostgreSQL, Docker Desktop, project-pinned patched Supabase CLI |
| 계약 | OpenAPI, JSON Schema, 생성 TypeScript 타입 |
| 테스트 | Pytest, pgTAP, Vitest, Playwright |
| 패키지 관리 | pnpm workspace, uv |

고정 런타임 버전:

| 도구 | 버전 |
| --- | --- |
| Node.js | 24.12.0 |
| pnpm | 11.13.0 |
| Python | 3.12.13 |
| uv | 0.11.28 |

## 5. 저장소 구조

```text
apps/api                 FastAPI, 질문 처리, 관리자 API
apps/web                 시민·관리자 Next.js 화면
contracts                OpenAPI와 JSON Schema
packages/shared-contracts 생성 TypeScript 계약
database                 논리 DB projection과 rollback
supabase/migrations      실행 가능한 DB migration
supabase/tests/database  pgTAP 검증
data                     공식 KB·기관·평가 질문
scripts                  로컬 DB·seed·실행·회귀 채점·보안 검사
tools/web-e2e            브라우저 E2E
docs                     핵심 아키텍처·보안·데이터·검증 근거
```

주요 파일:

```text
apps/api/src/sejong_ai_api/
  main.py                          범용 FastAPI 앱 팩토리
  local.py                         로컬 조립. DB 신원·환경변수 허용목록 고정
  privacy/redaction.py             개인정보 탐지·마스킹. 파이프라인 최선두
  chat/classification.py           결정론적 의도·정책 분류
  chat/service.py                  질문 처리 오케스트레이션, 생성 실패 시 TEMPLATE 복구
  admin/candidate_binding.py       예약 KB 활성화의 서버측 정확 일치 검증
  llm/classifier_prompt.py         5단계 판정 절차 프롬프트
  llm/deepseek_settings.py         DeepSeek 프로필. 값 불일치 시 fail-closed

apps/web/src/
  components/citizen/AnswerCard.tsx      답변 카드·출처·딥링크
  components/admin/CandidateAuthoringForm.tsx  KB 후보 작성
  lib/reserved-candidate.ts              예약 후보 공식 값(서버 바인딩 미러)

scripts/
  run_regression_metrics.py        20문항 + 데모 5문항 회귀 채점
  verify_database.ps1              로컬 DB migration·rollback·pgTAP 게이트
  verify_data_seed_db.py           공식 데이터 seed와 무결성 검증
  provision_local_context_secret.py  context token secret 생성
  check_secret_patterns.ps1        비밀값 패턴 검사

REGRESSION-METRICS.md              지표 정의와 판정 기준
REGRESSION-RESULTS-20260730.md     회귀 실행 기록
REGRESSION-REPORT.html             품질 검증 결과 보고서
```

## 6. 실행 방법

### 6.1 준비 사항

- Windows 11 — **본 저장소의 실행·검증은 Windows 11 기준으로 수행되었으며, 타 OS는 미검증입니다**
- Windows PowerShell 5.1 이상
- Git
- Docker Desktop
- 위 표의 Node.js, pnpm, Python, uv 버전
- 짧은 영문 경로의 checkout 권장

### 6.2 설치

```powershell
git clone https://github.com/nxtcloud-edu/2026-07-kosj-industry-practice-team02.git
cd 2026-07-kosj-industry-practice-team02

corepack pnpm install --frozen-lockfile --ignore-scripts
uv sync --project apps/api --frozen
```

`.env.example`에는 실제 비밀값이 없습니다. API와 Web을 실행할 때 각각의 예제 파일을 복사하되 API key, DSN, 서명 secret은 커밋하지 않습니다.

### 6.3 화면만 빠르게 확인

DB 없이 화면 구성을 확인하는 fixture 모드입니다. 화면에 `시연용 샘플 — 공식 데이터 아님` 표시가 나타나며 실제 승인과 ACTIVE 전환은 비활성화됩니다.

```powershell
$env:CHAT_UI_MODE = "fixture"
$env:ADMIN_UI_ENABLED = "true"
$env:ADMIN_UI_MODE = "fixture"
corepack pnpm --filter @sejong-ai/web dev
```

- Web: `http://127.0.0.1:3000`
- 시민 화면: `/chat`
- 관리자 화면: `/admin`

### 6.4 실제 local DB 준비

Docker Desktop을 실행한 뒤 저장소 루트에서 진행합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/bootstrap_patched_supabase.ps1 -Install

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/verify_database.ps1
```

`verify_database.ps1`은 disposable local DB를 검증하고 `apps/api/.env`에 local `DATABASE_URL`만 기록합니다. `supabase/config.toml`의 `[db.seed].enabled=false`를 유지하므로 공식 데이터는 별도 단계로 적재합니다.

```powershell
$supabase = ".\.tools\supabase\v2.109.1-sejong-loopback\supabase.exe"
$status = & $supabase status -o env
$dbLine = @($status | Where-Object { $_ -match '^DB_URL=' })
if ($dbLine.Count -ne 1) { throw "LOCAL_DB_STATUS_INVALID" }

$env:SEJONG_ADMIN_DATABASE_URL = (
  $dbLine[0].Substring(7).Trim().Trim('"')
)

uv run --project apps/api --frozen python scripts/verify_data_seed_db.py `
  seed-cycle --release-version 0.1.0-initial.2

uv run --project apps/api --frozen python scripts/verify_data_seed_db.py `
  verify-final --release-version 0.1.0-initial.2

Remove-Item Env:SEJONG_ADMIN_DATABASE_URL
```

이 단계가 완료되면 ACTIVE KB 19개, 공식 기관 3개, 매핑 10개가 기준선입니다.

### 6.5 API 실행

context token secret을 로컬 `.env`에 안전하게 생성한 후 API를 시작합니다. 생성된 값은 출력되지 않습니다.

```powershell
uv run --project apps/api --frozen python scripts/provision_local_context_secret.py
uv run --project apps/api --frozen python scripts/run_local_api.py --port 8000
```

- Health: `http://127.0.0.1:8000/health`
- Ready: `http://127.0.0.1:8000/ready`

정식 19/3/10 기준선과 설정이 준비되면 `/ready`가 200을 반환합니다.

### 6.6 Web 실제 연동

새 PowerShell 터미널에서 실행합니다.

```powershell
$env:API_INTERNAL_BASE_URL = "http://127.0.0.1:8000"
$env:CHAT_UI_MODE = "actual"
$env:ADMIN_UI_ENABLED = "true"
$env:ADMIN_UI_MODE = "actual"
corepack pnpm --filter @sejong-ai/web dev
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다.

## 7. 개인정보 보호

공공 AI에서 가장 먼저 무너질 수 있는 지점이므로, 선언이 아니라 **구조로 강제**했습니다.

### 7.1 마스킹은 모든 처리보다 앞선다

```text
시민 질문
  → 개인정보 탐지·마스킹        ← 저장·분류·검색·외부 호출보다 앞
  → SafeQuestion 생성           ← 검증 통과 없이는 생성 불가
  → 의도 분류 → ACTIVE KB 검색 → 근거 판정 → 답변
```

`SafeQuestion`은 검증을 통과한 `RedactionResult`로만 생성되도록 **타입 수준에서 강제**됩니다
(`apps/api/src/sejong_ai_api/chat/classification.py`). 마스킹을 건너뛰고 분류·검색·외부 호출로
진입하는 경로는 코드상 존재하지 않습니다.

마스킹으로 안전을 보장할 수 없으면 `PRIVACY_UNRESOLVED`로 **닫습니다**. 통과시키지 않습니다.

### 7.2 탐지 대상

주민등록번호, 결제카드번호, 금융계좌, 인증정보(비밀번호·OTP·인증번호), 차량번호, 접수번호,
민감 건강·복지 정보, 상세 주소, 사람 이름을 탐지합니다. 이름과 상세 주소처럼 판단이 모호한
경우에는 통과시키지 않고 `AMBIGUOUS_PERSON_NAME`·`AMBIGUOUS_DETAILED_ADDRESS`로 닫는
**fail-closed** 방식입니다.

### 7.3 저장 정책

| 구분 | 내용 |
| --- | --- |
| **저장 금지** | 질문 원문, 주민등록번호·전화번호·이메일·상세주소·이름·신청번호 등 식별 정보 일체 |
| **저장 대상** | 마스킹된 실패 질문, 분야·처리 결과·사유 코드·지역·응답시간의 비식별 집계 |
| **보관 기간** | 개선 대상 실패 질문의 `masked_question`은 30일. 경과 시 행 삭제가 아니라 해당 텍스트를 `NULL`로 파기 |

30일 경과 후에도 비텍스트 메타데이터와 KB 후보 연결은 유지되어 통계와 개선 이력은 보존됩니다.
질문 원문은 **어느 시점에도** 저장하지 않습니다.

관리자 화면과 문서의 저장 규칙은 동일합니다.

- `INSUFFICIENT_GROUNDING`: 마스킹 질문 30일 보관, KB 후보 가능
- `CIVIC_SCOPE_GAP`: 마스킹 질문만 범위 확대 검토 큐로 30일 보관
- `PERSONAL_LOOKUP`·`LEGAL_JUDGMENT`·`OUT_OF_SCOPE`·`PRIVACY_UNRESOLVED`: 질문 text 미저장

### 7.4 외부 LLM 경계

- 실제 시민 자유 입력과 공개 환경 요청은 **마스킹 여부와 무관하게** 외부 LLM으로 전송하지 않습니다.
- 저장소 출하 기본값은 `CLASSIFIER_PROVIDER=disabled`, `LLM_PROVIDER=disabled`입니다.
- 외부 LLM에 전달되는 것은 **마스킹된 현재 질문과 서버가 발급한 최소 fact ID**뿐입니다.
  후보·mock·비공식 데이터, 출처 메타데이터, 대화 이력, 식별자, 비밀값은 제외됩니다.
- 정책 폴백(`PERSONAL_LOOKUP`·`LEGAL_JUDGMENT`)과 `PRIVACY_UNRESOLVED`, 근거 부족은
  provider 호출 없이 처리합니다.
- 실제 시민 질문에 대한 사용 확대는 별도의 보안·개인정보 승인 절차를 거친 후에만 진행합니다.
  절차는 [`docs/runbooks/LLM-003-LOCAL-GROUNDED-CHAT.md`](docs/runbooks/LLM-003-LOCAL-GROUNDED-CHAT.md)에 고정되어 있습니다.

### 7.5 승인 분리

KB 후보 작성자와 승인자는 반드시 달라야 하며, 작성자의 자가 승인은 서버가 `403`으로 차단합니다.
승인된 후보만 시민 답변에 반영되고, 미승인 후보와 mock 데이터는 사용되지 않습니다.

### 7.6 검증

- 회귀 채점의 `pii_masking_rate`가 전 구간 **1.00**입니다.
- 저장소 현재 파일과 공개 Git history에 대한 비밀값 검사 finding **0**입니다.
- 질문·답변·prompt·provider body·DSN·key는 터미널·파일·로그에 출력하지 않습니다.

## 8. AI 연결

AI 없이도 공식 KB 기반 답변·폴백·관리자 승인 흐름은 작동합니다. AI를 사용할 때는 `apps/api/.env`의 빈 칸에 로컬 key를 입력합니다.

### DeepSeek 질문 분류·근거 제한형 답변 생성

```dotenv
CLASSIFIER_PROVIDER=deepseek
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
UPSTAGE_SYNTHETIC_EVALUATION_MODE=false
UPSTAGE_CLASSIFIER_MODE=false
UPSTAGE_GROUNDED_CHAT_MODE=false
```

두 역할은 Git 밖의 동일한 `DEEPSEEK_API_KEY`를 사용합니다. 모델은 마스킹된 질문과 서버가 선택한 ACTIVE/OFFICIAL KB의 제한된 fact만 받으며, 사실·출처·기관 정보는 계속 서버가 결합합니다. timeout·JSON·계약·근거 검증에 실패하면 공식 KB TEMPLATE 답변으로 전체 복구합니다. 기본값은 계속 `disabled`이고 실제 key를 설정한 `.env`는 Git에 추가하지 않습니다.

## 9. 동작 확인 시나리오

1. `전입신고는 언제까지 해야 하나요?`
   → 공식 절차·출처·신청 경로
2. `아름동에서 대형폐기물은 언제 내놓나요?` (지역 선택 후)
   → 지역 조건 반영 답변과 공식 기관 카드
3. `이사했는데 뭐 해야 하나요?`
   → 단정 없이 민원 유형 선택지를 제시하는 FOLLOWUP
4. `제 자동차세 얼마 나왔나요?`
   → PERSONAL_LOOKUP, 후보 생성 및 질문 저장 없음
5. `침대 2인용 프레임 수수료가 얼마예요?`
   → 승인 전 INSUFFICIENT_GROUNDING
   → 이음센터에서 후보 작성·다른 승인자 승인
   → 20번째 ACTIVE 반영 후 같은 질문 SUCCESS와 공식 출처

위 5문항은 입찰제안서 7.5에 사전 확정해 공개한 데모 시나리오와 **원문 그대로 동일**합니다.

19→20 승인 흐름은 DB 상태를 변경하므로 19 기준선에서 한 번 실행합니다. 다시 실행하려면 local DB migration과 정식 seed 절차로 기준선을 복원합니다.

5번의 KB 후보 내용은 서버가 예약한 `KB-WASTE-03` 공식 값과 **정확히 일치해야** 활성화됩니다
(`apps/api/src/sejong_ai_api/admin/candidate_binding.py`). 한 글자라도 다르면 승인은 성공하지만
KB가 활성화되지 않아 재질의가 계속 폴백합니다. 이 위험을 없애기 위해 후보 작성 폼이 공식 값을
자동으로 채웁니다(`apps/web/src/lib/reserved-candidate.ts`).

## 10. 검증 명령

```powershell
# API
uv run --project apps/api --frozen ruff format --check apps/api
uv run --project apps/api --frozen ruff check apps/api
uv run --project apps/api --frozen mypy apps/api/src apps/api/tests
uv run --project apps/api --frozen pytest -q apps/api/tests

# 공유 계약
corepack pnpm --filter @sejong-ai/shared-contracts generate:check
corepack pnpm --filter @sejong-ai/shared-contracts test

# Web
corepack pnpm --filter @sejong-ai/web lint
corepack pnpm --filter @sejong-ai/web typecheck
corepack pnpm --filter @sejong-ai/web test
corepack pnpm --filter @sejong-ai/web build

# 비밀값 검사
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/check_secret_patterns.ps1
python -B scripts/check_git_history_secrets.py --repo .

# 회귀 채점 (로컬 스택 기동 상태에서)
$env:SEJONG_BASELINE_COMMIT = (git rev-parse --short HEAD)
$env:SEJONG_PROVIDER_MODES  = "classifier=true,grounded=true"
uv run --project apps/api --frozen python scripts/run_regression_metrics.py `
  --origin "http://127.0.0.1:3000"
```

### 10.1 저장소 게이트 결과

2026-07-30 실행 결과입니다.

| 영역 | 결과 |
| --- | --- |
| API Ruff format/check | PASS — 135 files |
| API strict Mypy | PASS — 135 source/test files |
| API Pytest | PASS — 2,617 passed, local DB 전용 8 skipped, 5 subtests passed |
| 공유 계약 | PASS — 96/96 |
| Web lint/typecheck/test/build | PASS — Vitest 80/80, Next production build |
| 현재 파일·공개 Git history 비밀값 검사 | PASS — finding 0 |

`apps/api/tests/privacy/test_redaction.py`의 마스킹 성능 테스트는 2초 기준의 **실행 환경 민감**
항목입니다. Web dev 서버 등 부하가 있는 상태에서는 근소하게 초과할 수 있으므로,
API 테스트는 다른 개발 서버를 내린 상태에서 실행하십시오. Web Vitest도 같습니다.

### 10.2 품질 지표 (입찰제안서 7.3 대응)

핵심 20문항과 데모 5문항을 대상으로 **15회 측정**했습니다.
아래는 `classifier=true,grounded=true` 구성의 최종 측정값입니다.

| 지표 | 목표 | 기준선 | 최종 | 판정 |
| --- | ---: | ---: | ---: | --- |
| 의도 분류 정확도 | 0.85 | 0.80 | **0.85** | 달성 |
| 답변 상태 정확도 | 0.80 | 0.85 | **0.90** | 달성 |
| 출처 표기율 | 1.00 | 1.00 | **1.00** | 달성 |
| 폴백 적절성 | 0.90 | 1.00 | **0.90** | 달성 |
| 답변 가능 질문 성공률 | 0.80 | 0.70 | **1.00** | 달성 |
| 개인정보 마스킹률 | 1.00 | 1.00 | **1.00** | 달성 |
| 평균 응답시간 | 3,000 ms | 625 ms | **1,291 ms** | 달성 |
| 오류율 | 0.00 | 0.00 | **0.00** | 달성 |
| 데모 완주율 | 1.00 | 비교 대상 아님 | **1.00** | 달성 |

읽을 때 기준이 분명하도록, 지표 표기는 아래 원칙을 함께 따릅니다.

- `9 / 9`: 승인된 판정 기준으로 측정한 목표 지표 수
- `90%`: 표본 25문항을 15회 회귀 측정했을 때의 최종 값
- `100%`: 같은 측정에서 해당 항목이 전 구간 충족된 값
- 세부 판정 기준은 `REGRESSION-METRICS.md`, 회차별 결과는 `REGRESSION-RESULTS-20260730.md`

폴백은 **양방향으로 채점**합니다. 답하면 안 되는 질문에 답한 과소 폴백과, 답할 수 있는 질문을
회피한 과잉 폴백을 모두 실패로 집계해 "안 하는 것"으로 점수를 얻는 왜곡을 막습니다.
최종 측정에서 양쪽 모두 0건입니다.

읽을 때 유의할 점:

- **데모 완주율은 선순환 흐름의 승인까지 수행된 상태를 전제**합니다. 갓 초기화한 DB에서
  측정하면 승인 이력이 없어 0.80으로 산출됩니다.
- 데모 완주율의 판정 기준을 한 차례 교정했으므로 **교정 전후 값은 비교하지 않습니다.**
  표본 20문항 기반 8개 지표는 판정 로직을 변경하지 않아 전 구간 비교 가능합니다.
- 측정은 표본 기준이며 전체 민원 정확도로 일반화하지 않습니다.

전체 실행 기록은 [`REGRESSION-RESULTS-20260730.md`](REGRESSION-RESULTS-20260730.md),
지표 정의와 판정 기준은 [`REGRESSION-METRICS.md`](REGRESSION-METRICS.md),
보고서 형태는 [`REGRESSION-REPORT.html`](REGRESSION-REPORT.html)에 있습니다.

Docker DB reset·seed·`/ready=200`·19→20 상태 변경의 기존 검증 근거는
`docs/test-reports/FINAL-LOCAL-DEMO-REHEARSAL.md`와 `docs/data-lineage/MVP-001-KB-WASTE-03-LOCAL-WORKFLOW.md`에 있습니다.

## 11. 팀 역할

| 이름 | 역할 | 담당 |
| --- | --- | --- |
| 김정하 | PM · Frontend · 발표 | 기획, 시민·관리자 화면, 반응형·접근성, 산출물 통합 |
| 곽태성 | Backend | API, DB, 계약, migration, seed와 실행 환경 |
| 이유라 | Data · AI | 증명서·지방세 KB, 검색·AI 품질 |
| 오현송 | Data · AI | 전입·대형폐기물 KB, 테스트셋·QA |

※ 입찰제안서 7.2의 인력 백업 계획("PM이 문서 작업 외 프론트 마크업을 분담")에 따라,
실행 단계에서 프론트 구현을 PM이 분담하고 Backend를 전담 체계로 운영했습니다.

## 12. 현재 한계

- local/private 학습·시연용 MVP입니다.
- **공개 배포와 remote DB는 구성하지 않았습니다.** `local.py`가 DB 신원을
  로컬 루프백으로 고정하고 있어, 배포하려면 별도의 호스팅 조립 경로가 필요합니다.
- **실행·검증 기준 환경은 Windows 11 로컬 스택**이며, 실제 운영 환경의 배포·모니터링·권한 관리는 별도 과제입니다.
- **관리자 화면은 인증이 없습니다.** `X-Demo-Actor-Id`·`X-Demo-Role` 헤더 기반 demo actor를
  사용하므로 공개 환경에 노출하면 안 됩니다. SSO·RBAC는 구현 범위 밖입니다.
- 실제 신청·개인별 조회·본인 인증·정부24 내부 연계는 지원하지 않습니다.
- GPS·최단거리 기관 계산·지도·다국어·음성은 포함하지 않습니다.
- 외부 AI 공급자의 품질·비용·가용성은 운영 환경에서 별도 검증이 필요합니다.
- 저장소 기본값은 외부 AI 비활성화이며, 로컬 검증과 운영 환경의 AI 사용 여부는 분리해서 설명해야 합니다.
- `answer_mode`(`TEMPLATE`/`GENERATED`)는 같은 질문에서도 실행마다 달라질 수 있습니다.
  안전 속성에는 영향이 없으나 개별 답변을 "AI 생성"으로 특정할 수는 없습니다.
- 회귀 채점은 표본 기준이며 전체 민원 정확도로 일반화하지 않습니다.
  화면 계층 구현(딥링크 등)은 API 응답을 보는 채점기가 검증하지 못합니다.
- 일부 행정 용어가 사람 이름으로 오탐되어 `PRIVACY_UNRESOLVED`로 닫히는 사례가 있습니다.
  안전 방향의 오류이나 안전 용어 목록 보완이 필요합니다.
- 데이터는 ACTIVE KB 19건, 기관 3건, 매핑 10건 규모입니다. 실서비스에는 확충이 필요합니다.
- 제안 단계의 KB 확충 목표 100건에 비해 초기 ACTIVE는 19건, 승인 시연 완료 후 20건이므로 확산 전 확충 속도와 운영 인력을 검증해야 합니다.
- 전국 243개 지자체 확산과 질문당 외부 AI 호출 비용 0원은 현재 MVP에서 검증된 결과가 아닙니다. 지자체별 데이터 정비 비용과 선택적 외부 AI 사용 비용을 포함한 운영 검증이 필요합니다.

발표 녹화용 핵심 장면과 자막 문구는 [`docs/PRESENTATION_SUBTITLE_SCRIPT.md`](docs/PRESENTATION_SUBTITLE_SCRIPT.md)에 정리했습니다.

## 13. 제출 스냅샷

- 스냅샷 작성일: 2026-07-30
- 실제 `.env`, key, token, DSN, local DB 상태, 개인정보, 로그, cache와 build 산출물은 포함하지 않습니다.
- 기존 입찰제안서 PDF와 `notice.md`는 원본 그대로 보존합니다.
