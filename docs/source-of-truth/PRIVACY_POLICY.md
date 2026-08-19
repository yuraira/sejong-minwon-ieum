# 개인정보·로그·외부 AI 처리 정책

## 1. 적용 범위

본 정책은 실습 MVP의 시민 질문, 이벤트 로그, 실패 질문, KB 후보, 외부 LLM 호출, 호스팅 인프라 로그에 적용한다. 30일 보관은 법정 보관기간이 아니라 **MVP 내부 운영 기준**이며 실제 기관 운영 시 개인정보 처리방침·기록물 관리 기준·법무 검토에 따라 재정의한다.

## 2. 핵심 원칙

1. 사용자 원문 질문을 애플리케이션 DB에 저장하지 않는다.
2. 개인정보 탐지·마스킹은 외부 LLM 호출 전에 백엔드에서 수행한다.
3. 외부 LLM에는 마스킹된 질문과 승인된 KB 청크만 전달한다.
4. 성공 질문의 텍스트는 저장하지 않고 이벤트 메타데이터만 저장한다.
5. 개선이 필요한 실패 질문의 `masked_question` 텍스트만 생성 후 30일 저장하고, 만료 시 해당 필드만 NULL로 파기한다.
6. 지원 범위 밖 질문은 텍스트를 저장하지 않고 OUT_OF_SCOPE 이벤트만 기록한다.
7. 승인되지 않은 KB 후보는 시민 답변에 사용하지 않는다.
8. 이름·상세주소는 개인정보 누락 방지를 우선해 보수적으로 마스킹하고, 불확실하면 외부 호출 없이 안전 폴백한다.
9. 화면 transcript와 대화 문맥 token은 현재 탭 메모리에만 두고 서버 세션·DB·로그·브라우저 영속 저장소에는 저장하지 않는다.
10. 안전한 마스킹 값을 만들 수 없으면 질문 텍스트를 반환·저장·외부 전송하지 않는다. 이 경우 질문 없는 interaction event만 기록할 수 있다.
11. 마스킹 성공은 저장 또는 provider 호출의 필요조건일 뿐 충분조건이 아니다. local/private에서는 지원 intent·ACTIVE/OFFICIAL·근거 gate까지 통과한 요청만 Upstage로 전송할 수 있고, public/remote/실제 기관 운영은 별도 승인 전 전송하지 않는다.
12. 시민 입력의 “공식 대표번호” 표시는 신뢰 근거가 아니다. 입력 안의 모든 phone-shaped value를 마스킹하고, 공식 기관 연락처는 승인된 KB·기관 메타데이터를 서버가 결합한 카드에서만 제공한다.
13. 안전한 마스킹 문자열을 만들 수 없는 요청은 `PRIVACY_UNRESOLVED`로 분리해 HTTP 200 안전 재질문을 제공한다. 이 outcome에는 질문 text, source/context/office, provider 호출, 실패 질문 row와 후보를 만들지 않고 질문 없는 interaction metadata만 허용한다.
14. 시민 만족도는 답변 `request_id`, 만족/불만족, 선택형 분야·사유만 저장한다. `기타` 상세는
    최대 300자로 받고 서버 마스킹을 통과한 문자열만 정확히 30일 보관한다. raw 상세, 질문·답변,
    provider body는 피드백 테이블·로그·감사 이력에 저장하지 않는다.

위 `PRIVACY_UNRESOLVED` 동작은 D-045와 Q-MVP-001 consumer 구현으로 local/private 활성 계약·route에
적용됐다. 질문 text·source/context/office·provider·failed-question row·candidate·DB event는 모두 0이며,
persistent metadata migration과 public route는 reserved `00700` 및 별도 승인 전까지 비활성이다. 이전의
“아직 적용되지 않았다” 문장은 consumer 구현 전의 역사적 checkpoint였으며 현행 정책이 아니다.

## 3. 저장 금지 정보

- 이름
- 주민등록번호
- 여권·운전면허 번호
- 전화번호
- 이메일
- 상세 주소
- 계좌·카드번호
- 인증번호·비밀번호
- 차량번호
- 민원 접수번호
- 건강·복지 등 민감정보
- 정밀 GPS

애플리케이션 DB에서는 IP와 기기 고유 식별자를 수집·저장하지 않는다. 다만 Vercel·Render·Supabase 등 인프라 사업자가 자동 생성하는 접근 로그는 제공사 설정과 보관정책을 확인하고 가능한 범위에서 최소화한다.

## 4. 마스킹 예시

| 원문 | 저장 가능한 값 |
|---|---|
| 김민수이고 주민번호 900101-1234567인데 확인해줘 | `[이름]이고 주민번호 [주민등록번호]인데 확인해줘` |
| 010-1234-5678로 연락해줘 | `[전화번호]로 연락해줘` |
| 접수번호 SJ-2026-123456 처리됐어? | `접수번호 [접수번호] 처리됐어?` |

마스킹 코어는 원문 값이나 hash를 결과·finding·예외·로그에 넣지 않는다. 정규화·탐지 후에도
개인정보 가능성이 남거나 이름·상세주소를 안전하게 판정할 수 없으면 반환 텍스트를 `None`으로
닫고 실패 질문 row와 provider 호출을 금지한다. 이때도 질문 문장 없는 interaction metadata
event는 기록할 수 있다. 상세 내부 계약은
`AI-001 개인정보 마스킹 코어 정식 명세`를 따른다.

## 5. 이벤트 메타데이터

모든 요청에서 질문 문장 없이 다음 필드를 저장할 수 있다.

```text
interaction_id
occurred_at
intent
answer_status     # SUCCESS / FOLLOWUP / FALLBACK / SYSTEM_ERROR
fallback_reason   # 해당 시
source_count
used_source_ids
response_time_ms
selected_region   # 읍·면·동 수준
routed_office_id
is_test
```

## 6. 실패 질문 추가 필드

현재 local/private MVP에서는 `INSUFFICIENT_GROUNDING`과 별도 범위 확대 검토 대상인
`CIVIC_SCOPE_GAP`에 한해 다음 필드를 저장한다. 이 기준은 관리자 화면과 README의 폴백
정책표에 표시된 저장 범위와 같다.

```text
masked_question
candidate_eligible
candidate_status
text_expires_at
text_purged_at
```

- `INSUFFICIENT_GROUNDING`: `masked_question`을 30일 보관하며 KB 후보 작성 가능
- `CIVIC_SCOPE_GAP`: PII-safe `masked_question`을 별도 범위 확대 검토 큐에 30일 보관하며,
  PM의 범위 편입 결정 전에는 KB 후보 작성·ACTIVE 전환 금지
- `PERSONAL_LOOKUP`: 질문 text·실패 질문 행·후보 저장 금지
- `LEGAL_JUDGMENT`: 질문 text·실패 질문 행·후보 저장 금지
- `OUT_OF_SCOPE`: 텍스트 저장 금지, 이벤트만 저장
- `PRIVACY_UNRESOLVED`: 텍스트 저장·실패 질문 행·후보·provider 호출 금지, 질문 없는 이벤트만 저장
- `FOLLOWUP`: 실패가 아니므로 실패 질문 목록에 저장하지 않음
- `NON_CIVIC` planned: 질문 text와 review row를 저장하지 않는다.
- `text_expires_at`: `created_at + 30일`; 실패 행 전체가 아니라 `masked_question` 텍스트의 만료 시각
- `text_purged_at`: 파기 전에는 NULL, 파기 후에는 실제 처리 시각

## 7. Upstage 외부 LLM 처리 경계

Q-LLM-005=A/D-065의 합성 평가 경계는 LLM-002 actual FAIL 증거로 보존한다. 이후
Q-LLM-006~012/D-072는 공개 운영이 아닌 local/private 입찰 시연 MVP에 한해 Upstage direct API
exact `solar-pro3`의 근거 제한형 시민 chat 사용을 승인했다. API key는 ignored backend local
환경변수에만 두고 브라우저·저장소·GitHub·Codex Cloud·문서·로그에 값이나 잔액을 남기지 않는다.

### 7.1 호출 전 필수 gate

- 백엔드 보수적 masker가 원문 없이 안전한 마스킹 질문을 생성해야 한다.
- deterministic supported intent, ACTIVE/OFFICIAL retrieval과 grounding을 모두 통과해야 한다.
- FOLLOWUP, PRIVACY_UNRESOLVED, INSUFFICIENT_GROUNDING, PERSONAL_LOOKUP, LEGAL_JUDGMENT,
  OUT_OF_SCOPE에는 provider를 호출하지 않는다.
- provider는 기본 disabled이며 local/private chat mode를 서버에서 명시적으로 활성화해야 한다.
  클라이언트 flag, intent, fixture ID, KB ID 또는 mode를 신뢰하지 않는다.
- public/remote/실제 기관 운영의 시민 질문 전송은 별도 개인정보·법무·보안·비용·배포 승인
  전까지 계속 금지한다.

Q-CLASS-001=A/D-086/ADR-0025는 future local/private classifier에 한해 위 deterministic
supported-intent gate 앞의 제한된 예외 방향을 승인했다. PII-safe current question 중
deterministic policy/high-confidence 결과가 없는 ambiguous 입력만 closed-enum 분류를 위해
전송할 수 있고, 답변·KB·source·저장 여부는 전송하거나 모델에 위임하지 않는다.
Q-CLASS-002 budget과 written specification/plan 전 current runtime/actual call은 0이다.

### 7.2 최소 전송

- 전송 허용: 마스킹된 현재 질문, 서버 확정 intent, 실제 답변에 필요한 최소 ACTIVE/OFFICIAL KB,
  server-issued fact ID와 strict output schema
- 전송 금지: raw question, PII finding 원문, 이전 transcript/context token, actor/IP/device,
  secret/DSN/내부 UUID, 전체 DB/KB, CANDIDATE/staging/mock, 관리자 comment/audit
- 모델은 summary와 fact ID만 제안한다. 공식 fact text, source title/URL/verified date와 office는
  서버가 결합한다.
- JSON/schema/ID/fact drift 검증 하나라도 실패하면 모델 결과 전체를 버리고 공식 template를
  사용한다.

### 7.3 보관·실행 제한

- 시민 chat은 timeout 8초, logical attempt 1, hidden retry 0, concurrency 1, process outbound
  attempt 30 이하를 강제한다.
- run/attempt ID에는 개인정보를 넣지 않는다.
- provider request/response, reasoning, raw/masked question과 생성 답변은 DB·파일·로그·오류
  추적에 남기지 않는다.
- 허용 metric은 질문 없는 outcome, latency, attempt, token usage와 aggregate cost뿐이다.
- provider 장애·정책 변경·cap 소진 시 disabled/template 경로를 유지한다.
- provider-disabled final root offline gate는 2026-07-26 PASS했다. 이후 D-075 local actual은
  PII-free masked/grounded fixture 10건만 전송해 typed write-boundary에서 raw fixture/API key
  위반 0, aggregate-only 출력, 공식 사실
  mismatch 0으로 PASS했다. Cloud/CI·public/remote/실제 기관 운영 호출은 계속 0이다.

Upstage 공식 페이지가 `Last Revised: May 21, 2026`로 표시하는 개인정보 처리방침은
Console/Studio API logging이 별도 동의에서
정한 기간 동안 API input/output을 수집할 수 있고, Upstage Service에 입력된 대화·데이터의
국외 처리 항목을 둔다. 실제 계정의 별도 동의·계약 상태는 저장소에서 증명할 수 없다. 따라서
마스킹 질문 전송도 잔여 위험으로 기록하고 local/private MVP에서만 허용한다.

페이지 확인일은 2026-07-25이며 URL slug를 효력일로 해석하지 않는다. 모델·API·가격·개인정보
처리방침은 public/remote 또는 다음 actual 재승인 전에 다시 확인한다.

### 대화 문맥 token

- transcript와 token은 현재 탭의 휘발성 메모리에만 두며 `localStorage`, `sessionStorage`, IndexedDB, cookie, Cache API, URL, analytics, client error snapshot에 저장하지 않는다.
- 15분 TTL의 HMAC-SHA-256 서명형 `context_token`은 무결성만 보장하고 암호화하지 않는다. payload에는 version, intent/region/status enum, optional server-defined follow-up option ID, 발급·만료 시각만 허용한다.
- 질문·답변·요약·source title/URL·KB 본문·actor/user ID·PII·provider 데이터·비밀은 token에 넣지 않는다. token과 서명 secret도 서버 DB와 모든 로그에 저장하지 않는다.
- token은 인증·권한·개인 조회·공식 사실·ACTIVE KB·근거 검증을 대신하지 않는다. 만료·서명 오류·알 수 없는 claim은 상세 오류 없이 문맥 없는 새 요청으로 처리한다.

## 8. 보관·삭제

| 데이터 | 보관 기준 |
|---|---|
| 원문 질문 | 저장하지 않음 |
| 성공 이벤트 메타데이터 | 프로젝트 기간 또는 집계 완료까지 |
| 마스킹 실패 질문 텍스트 | `masked_question`만 생성 후 30일; 만료 시 NULL 파기 |
| 실패 질문 비텍스트 메타데이터·후보 연결 | 텍스트 파기 후에도 프로젝트 산출물 범위에서 유지 |
| 지원 범위 밖 질문 텍스트 | 저장하지 않음 |
| 시민 피드백 | 평점·선택형 코드는 프로젝트 산출물 범위에서 유지; `masked_detail`만 생성 후 정확히 30일, 만료 시 NULL 파기 |
| 대화 transcript·context token | 서버에 저장하지 않음; 현재 탭 메모리에서만 15분 이내 사용 |
| local chat idempotency | UUID key, HMAC request digest, correlation과 분리된 임시 claim token·5분 lease, 엄격한 서버 검증을 통과한 최종 안전 응답과 상태만 논리 TTL 24시간. `GENERATED` summary도 이 제한된 중복 방지 응답에는 포함될 수 있으나 원문·마스킹 질문·prompt·provider body·context token·correlation ID는 저장하지 않고 startup+60초 주기로 만료 행 purge |
| KB 후보·승인 이력 | 프로젝트 산출물 범위에서 유지 |
| 승인 KB | 출처·버전·승인자와 함께 유지 |
| 감사 이력 | 질문·답변 전문 없이 상태 변경 정보만 유지 |

만료 작업은 실패 행 DELETE가 아니라 `masked_question = NULL`, `text_purged_at = 처리 시각`으로 바꾸는 멱등 UPDATE다. 로그에는 대상 ID와 처리 건수만 남기고 텍스트를 남기지 않는다. KB 후보의 `representative_question`은 실패 질문 텍스트를 장기 보관하기 위한 복사본이 아니며, 운영자가 일반화해 작성하고 저장 전 PII 재검사를 통과해야 한다.

피드백 만료 작업도 행 DELETE가 아니라 `masked_detail = NULL`, `detail_purged_at = 처리 시각`으로
바꾸는 멱등 UPDATE다. 만족 의견에는 분야·사유·상세를 받지 않으며, 불만족 `OTHER` 사유에만
상세가 필수다. 같은 `request_id`와 같은 payload 재전송은 멱등 처리하고 다른 payload는 충돌로
거부한다.

백업에서 복구한 경우 외부 요청을 받기 전에 만료된 텍스트 파기 작업을 다시 실행한다. 실제 기관 운영 전에는 백업 보관기간과 삭제 전파 기준을 법무·기록물 정책에 맞게 다시 승인한다.

## 9. 검증

- PII 패턴 포함 테스트 실행
- DB에서 원문 검색 결과 0건
- 서버 액세스 로그에 요청 본문 0건
- 오류 추적 도구에 질문 본문 0건
- 외부 LLM 호출 payload가 마스킹됐는지 테스트 더블로 확인
- 합성 fixture allowlist를 우회한 자유 입력이 Upstage adapter에 도달하지 않는지 확인
- provider payload와 run/attempt ID에 PII·비밀·불필요한 KB 필드가 0건인지 확인
- Upstage 실제 outbound attempt가 run당 30회 이하이고 retry도 합계에 포함되며, cap 지표·로그에 질문/provider body가 0건인지 확인
- context token의 TTL 900초·claim allowlist·tamper/expiry silent reset과 token/secret의 DB·로그·브라우저 영속 저장 0건 확인
- 고정 평가셋에서 보수적 마스킹의 PII 누락 0건과 답변 성공률을 함께 측정하고 완화는 인간 재승인 없이 적용하지 않음
- `masked_text=None` consumer가 HTTP 200 `PRIVACY_UNRESOLVED`와 안전 재질문을 반환하고 source/context/office/provider/failed-question text·row가 모두 0인지 확인
- 텍스트 NULL 파기 job의 경계시각·멱등성·후보 FK 보존 테스트
- 복구 후 서비스 개방 전 만료 텍스트 재파기 테스트
- 피드백 raw 상세·질문·답변 컬럼 0, 마스킹 상세 30일 파기, 만족/불만족 shape와 멱등 충돌 테스트
