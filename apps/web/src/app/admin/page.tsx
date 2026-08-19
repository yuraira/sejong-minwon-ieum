"use client";

/**
 * 이음센터 운영 현황(Overview) - DESIGN.md v3 §9-1, 계약 적응판.
 * KPI 카드 5개(목표 판정 뱃지) + 실패 패턴 요약 + 최근 실패 질문 패널.
 *
 * KPI 값: 계약의 /api/v1/admin/quality-summary는 200 응답 스키마가 정의되어
 * 있지 않아 typed 연동이 불가능하다 (계약 변경 필요 항목으로 보고).
 * fixture 모드에서만 시연 지표(DEMO_KPI)를 "시연 데이터" 라벨과 함께 표시하고,
 * actual 모드에서는 미제공 안내를 보여준다. 최근 실패 질문 패널은 두 모드
 * 모두 typed listFailedQuestions를 쓴다.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { components } from "../../../../../packages/shared-contracts/src/generated/api";
import { DEMO_KPI, type DemoKpi } from "@/lib/demo-fixtures";
import { INTENT_LABEL, STORED_REASON_LABEL } from "@/lib/labels";
import { useAdmin } from "@/components/admin/AdminShell";
import KpiCard, { type KpiJudgement } from "@/components/admin/KpiCard";
import PageHeader from "@/components/admin/PageHeader";

type FailedQuestion = components["schemas"]["FailedQuestion"];
type FeedbackSummaryResponse = components["schemas"]["FeedbackSummaryResponse"];
type FailureReasonKey = FailedQuestion["fallback_reason"];

const percent = (v: number) => `${Math.round(v * 100)}`;

/**
 * §9-1 목표 대비 판정 - 목표값은 제안서 7.3 품질 지표 상수(신규 데이터 아님):
 * 자동 답변 성공률 80% / 평균 응답시간 3초 이내 / 출처 표기율 100%.
 * 목표가 없는 지표(총 질문 수·폴백률)는 뱃지 없이 캡션 "집계 지표"만.
 */
const GOAL_ANSWER_RATE = 0.8;
const GOAL_RESPONSE_SEC = 3;
const GOAL_CITATION_RATE = 1.0;

function judgeKpi(kpi: DemoKpi): {
  answerRate: KpiJudgement;
  responseTime: KpiJudgement;
  citationRate: KpiJudgement;
} {
  return {
    answerRate:
      kpi.auto_answer_rate >= GOAL_ANSWER_RATE
        ? { tone: "success", label: "목표 달성" }
        : { tone: "warning", label: "목표 미달" },
    responseTime:
      kpi.avg_response_seconds <= GOAL_RESPONSE_SEC
        ? { tone: "success", label: "목표 달성" }
        : { tone: "warning", label: "목표 초과" },
    citationRate:
      kpi.source_citation_rate >= GOAL_CITATION_RATE
        ? { tone: "success", label: "목표 달성" }
        : { tone: "warning", label: "목표 미달" },
  };
}

/** 지표 안내 - KPI 5개 각각의 측정 방식 한 줄 (§9-1 구조 유지) */
const KPI_GUIDE: { id: string; name: string; desc: string }[] = [
  {
    id: "kpi-guide-total",
    name: "총 질문 수",
    desc: "기간 내 시민이 입력한 질문 전체 건수",
  },
  {
    id: "kpi-guide-answer-rate",
    name: "자동 답변 성공률",
    desc: "핵심 20문항과 데모 5문항을 15회 회귀 측정했을 때 승인된 KB 근거로 답변(SUCCESS)한 비율. 목표 80% 이상",
  },
  {
    id: "kpi-guide-fallback-rate",
    name: "폴백률",
    desc: "전체 질문 중 담당 기관 연결(폴백)로 안내한 비율. 근거 부족·개인 조회·법적 판단 같은 사유별 차이를 함께 본다",
  },
  {
    id: "kpi-guide-response-time",
    name: "평균 응답시간",
    desc: "질문 접수부터 답변 표시까지 평균 소요 시간. 표본 25문항을 15회 측정했고 목표는 3초 이내",
  },
  {
    id: "kpi-guide-citation-rate",
    name: "출처 표기율",
    desc: "SUCCESS 답변 중 출처 카드와 확인일이 함께 표시된 비율. 목표 100%",
  },
];

const FAILURE_POLICY: Record<
  FailureReasonKey,
  { label: string; retention: string; candidate: string }
> = {
  INSUFFICIENT_GROUNDING: {
    label: "근거 부족",
    retention: "마스킹 질문을 30일 보관",
    candidate: "운영자 작성 후 별도 승인자 검수",
  },
  PERSONAL_LOOKUP: {
    label: "개인 조회 필요",
    retention: "질문 텍스트 미저장",
    candidate: "KB 후보 비대상, 공식 조회 채널 안내",
  },
  LEGAL_JUDGMENT: {
    label: "법적 판단 필요",
    retention: "질문 텍스트 미저장",
    candidate: "KB 후보 비대상, 기관 상담 안내",
  },
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function summarizeFailures(items: FailedQuestion[]) {
  const reasonCounts = new Map<FailureReasonKey, number>();
  const repeated = new Map<string, number>();
  let candidateEligible = 0;
  let purged = 0;

  for (const item of items) {
    reasonCounts.set(
      item.fallback_reason,
      (reasonCounts.get(item.fallback_reason) ?? 0) + 1,
    );
    if (item.candidate_eligible) candidateEligible += 1;
    if (item.masked_question === null) {
      purged += 1;
      continue;
    }
    repeated.set(item.masked_question, (repeated.get(item.masked_question) ?? 0) + 1);
  }

  return {
    reasonRows: (Object.keys(FAILURE_POLICY) as FailureReasonKey[]).map((reason) => ({
      reason,
      count: reasonCounts.get(reason) ?? 0,
      ...FAILURE_POLICY[reason],
    })),
    candidateEligible,
    purged,
    repeated: [...repeated.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3),
  };
}

export default function AdminOverviewPage() {
  const { transport, actor, mode } = useAdmin();
  const [failures, setFailures] = useState<FailedQuestion[] | null>(null);
  const [feedback, setFeedback] = useState<FeedbackSummaryResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** 지표 안내 앵커 이동 시 1회 하이라이트 대상 - n은 재탭 시 애니메이션 재시작용 */
  const [guideFlash, setGuideFlash] = useState<{ id: string; n: number } | null>(
    null,
  );

  const kpi = mode === "fixture" ? DEMO_KPI : null;
  const recent = failures?.slice(0, 5) ?? null;
  const failureSummary = failures ? summarizeFailures(failures) : null;

  /** KPI 스트립 지표명 탭 → 지표 안내 해당 항목으로 스크롤 + 1회 하이라이트 */
  const goGuide = useCallback((id: string) => {
    setGuideFlash((prev) => ({ id, n: (prev?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!guideFlash) return;
    document.getElementById(guideFlash.id)?.scrollIntoView({ block: "center" });
  }, [guideFlash]);

  // setState는 조회 완료 콜백에서만 - 이펙트 본문 동기 setState 금지 규칙 준수
  const fetchData = useCallback(
    () =>
      Promise.all([
        transport.listFailedQuestions(actor),
        transport.getFeedbackSummary(actor),
      ])
        .then(([failures, feedbackSummary]) => {
          setFailures(
            [...failures.items].sort((a, b) =>
              b.created_at.localeCompare(a.created_at),
            ),
          );
          setFeedback(feedbackSummary);
          setLastUpdated(new Date());
        })
        .catch(() => {
          setFailures([]);
          setFeedback(null);
        }),
    [actor, transport],
  );

  /** 새로고침 버튼 - 진행 표시 포함 */
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchData();
    } finally {
      setRefreshing(false);
    }
  }, [fetchData]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <main id="main" tabIndex={-1}>
      <PageHeader
        title="운영 현황"
        subtitle={
          <>
            <span>모든 지표는 비식별 로그 기준</span>
            <span>{mode === "fixture" ? "시연 데이터" : "실제 local DB"}</span>
          </>
        }
        meta={
          <span className="rounded-pill border border-primary-border bg-primary-light px-4 py-2 text-caption font-bold text-primary">
            최근 30일
          </span>
        }
        lastUpdated={lastUpdated}
        refreshing={refreshing}
        onRefresh={() => void load()}
      />

      <div className="px-5 py-[22px] md:px-7">
        <div className="flex flex-col gap-5">
          {/* 1. KPI 카드 5개 - §9-1 목표 판정 뱃지 */}
          {kpi === null ? (
            <section
              aria-label="품질 지표 안내"
              className="rounded-panel border border-border bg-white p-5"
            >
              <p className="text-admin-body text-text">
                품질 지표(quality-summary)는 응답 스키마가 확정되지 않아 아직
                자동 연동하지 않았습니다.
              </p>
              <p className="mt-1 text-admin-body text-text-sub">
                현재 문서에는 표본 25문항, 15회 회귀 측정 기준을 함께 적어 두었습니다.
              </p>
            </section>
          ) : (
            <div className="flex flex-col gap-2 md:grid md:grid-cols-3 md:gap-3 xl:grid-cols-5">
              {/* 최종 폴리시 12: 목표 없는 지표는 뱃지 없이 캡션 "집계 지표"만 */}
              <KpiCard
                label="총 질문 수"
                value={kpi.total_questions.toLocaleString()}
                unit="건"
                target="집계 지표"
                guideId="kpi-guide-total"
                onGuideClick={goGuide}
              />
              <KpiCard
                label="자동 답변 성공률"
                value={percent(kpi.auto_answer_rate)}
                unit="%"
                target="목표 80% 이상"
                judgement={judgeKpi(kpi).answerRate}
                guideId="kpi-guide-answer-rate"
                onGuideClick={goGuide}
              />
              <KpiCard
                label="폴백률"
                value={percent(kpi.fallback_rate)}
                unit="%"
                target="집계 지표"
                subCaption="폴백은 오류가 아닌 안전 연결입니다"
                guideId="kpi-guide-fallback-rate"
                onGuideClick={goGuide}
              />
              <KpiCard
                label="평균 응답시간"
                value={kpi.avg_response_seconds.toFixed(1)}
                unit="초"
                target="목표 3초 이내"
                judgement={judgeKpi(kpi).responseTime}
                guideId="kpi-guide-response-time"
                onGuideClick={goGuide}
              />
              <KpiCard
                label="출처 표기율"
                value={percent(kpi.source_citation_rate)}
                unit="%"
                target="목표 100%"
                judgement={judgeKpi(kpi).citationRate}
                guideId="kpi-guide-citation-rate"
                onGuideClick={goGuide}
              />
            </div>
          )}

          <section
            aria-label="실패 패턴 요약"
            className="rounded-panel border border-border bg-white p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[16px] font-extrabold text-text">
                  실패 패턴 요약
                </h2>
                <p className="mt-1 text-admin-body text-text-sub">
                  실패 질문을 저장 사유, 후보 전환 가능 여부, 반복 패턴으로 묶어 보는 운영 레이어입니다.
                </p>
              </div>
              <Link
                href="/admin/analytics"
                className="text-caption font-bold text-primary underline hover:text-primary-dark"
              >
                전체 분석 보기
              </Link>
            </div>
            {failures === null ? (
              <p className="mt-3 text-admin-body text-text-sub">불러오는 중…</p>
            ) : failures.length === 0 ? (
              <p className="mt-3 text-admin-body text-text-sub">
                아직 집계할 실패 질문이 없습니다.
              </p>
            ) : (
              <>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {failureSummary?.reasonRows.map((row) => (
                    <div
                      key={row.reason}
                      className="rounded-btn border border-border-soft bg-admin-soft p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-admin-body font-extrabold text-text">
                          {row.label}
                        </h3>
                        <span className="text-[22px] font-extrabold text-primary tabular-nums">
                          {row.count}
                        </span>
                      </div>
                      <p className="mt-2 text-note text-text-sub">{row.retention}</p>
                      <p className="mt-1 text-note text-text-sub">{row.candidate}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-btn border border-border-soft bg-white p-4">
                    <h3 className="text-admin-body font-extrabold text-text">
                      반복 실패 질문
                    </h3>
                    {failureSummary && failureSummary.repeated.length > 0 ? (
                      <ul className="mt-3 space-y-2">
                        {failureSummary.repeated.map(([question, count]) => (
                          <li
                            key={question}
                            className="flex items-start justify-between gap-3 rounded-btn-s bg-admin-soft px-3 py-2"
                          >
                            <span className="text-note text-text">{question}</span>
                            <span className="shrink-0 text-caption font-extrabold text-primary tabular-nums">
                              {count}회
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-note text-text-sub">
                        같은 마스킹 질문의 반복 실패는 아직 없습니다.
                      </p>
                    )}
                  </div>
                  <div className="rounded-btn border border-border-soft bg-admin-soft p-4">
                    <h3 className="text-admin-body font-extrabold text-text">
                      승인 및 ACTIVE 반영 기준
                    </h3>
                    <ul className="mt-3 space-y-2 text-note text-text-sub">
                      <li>운영자와 승인자는 반드시 다른 actor여야 합니다.</li>
                      <li>근거 부족 사유만 KB 후보로 전환됩니다.</li>
                      <li>승인 후에만 시민 검색 대상인 ACTIVE KB가 됩니다.</li>
                      <li>질문 텍스트가 30일 경과로 파기되면 후보 작성이 중단됩니다.</li>
                    </ul>
                    <div className="mt-4 flex flex-wrap gap-3 text-caption text-text-sub">
                      <span>후보 전환 대상 {failureSummary?.candidateEligible ?? 0}건</span>
                      <span>텍스트 파기 {failureSummary?.purged ?? 0}건</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>

          <section
            aria-label="시민 의견 요약"
            className="rounded-panel border border-border bg-white p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[16px] font-extrabold text-text">
                시민 의견
              </h2>
              <span className="text-caption text-text-sub">
                상세 내용은 개인정보 마스킹 후 30일 보관
              </span>
            </div>
            {feedback === null ? (
              <p className="mt-3 text-admin-body text-text-sub">
                의견 집계를 불러오지 못했습니다.
              </p>
            ) : feedback.total === 0 ? (
              <p className="mt-3 text-admin-body text-text-sub">
                아직 저장된 만족도 의견이 없습니다.
              </p>
            ) : (
              <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-btn bg-admin-soft p-3">
                  <dt className="text-caption font-bold text-text-sub">전체</dt>
                  <dd className="mt-1 text-[22px] font-extrabold text-text">
                    {feedback.total}건
                  </dd>
                </div>
                <div className="rounded-btn bg-admin-soft p-3">
                  <dt className="text-caption font-bold text-text-sub">만족</dt>
                  <dd className="mt-1 text-[22px] font-extrabold text-text">
                    {feedback.satisfied}건
                  </dd>
                </div>
                <div className="rounded-btn bg-admin-soft p-3">
                  <dt className="text-caption font-bold text-text-sub">불만족</dt>
                  <dd className="mt-1 text-[22px] font-extrabold text-text">
                    {feedback.dissatisfied}건
                  </dd>
                </div>
                <div className="rounded-btn bg-admin-soft p-3">
                  <dt className="text-caption font-bold text-text-sub">만족률</dt>
                  <dd className="mt-1 text-[22px] font-extrabold text-text">
                    {feedback.satisfaction_rate === null
                      ? "-"
                      : `${Math.round(feedback.satisfaction_rate * 100)}%`}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          {/* 2. 최근 실패 질문 패널 (§9-1) - 실패 질문 화면과 동일 데이터 재사용 */}
          <section
            aria-label="최근 실패 질문"
            className="overflow-hidden rounded-panel border border-border bg-white"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft px-5 py-3.5">
              <h2 className="text-[16px] font-extrabold text-text">
                최근 실패 질문
              </h2>
              <Link
                href="/admin/failures"
                className="flex min-h-11 items-center text-caption font-bold text-primary underline hover:text-primary-dark"
              >
                실패 질문 관리로 →
              </Link>
            </div>
            {/* §14: 빈 상태 - 밋밋한 "없습니다" 금지, 다음 행동 안내 */}
            {(recent ?? []).length === 0 && (
              <p className="px-5 py-6 text-admin-body text-text-sub">
                아직 실패 질문이 없습니다. 시민 화면에서 폴백이 발생하면 이
                목록에 표시됩니다.
              </p>
            )}
            <ul>
              {(recent ?? []).map((f) => (
                <li
                  key={f.id}
                  className="flex flex-col gap-1.5 border-b border-border-soft px-5 py-3 last:border-b-0 md:grid md:grid-cols-[128px_1fr_auto_110px] md:items-center md:gap-3.5"
                >
                  {/* 파기 행 구분 표기 (§9-2 문구 공용) */}
                  {f.masked_question !== null ? (
                    <p className="text-note text-text md:order-2 md:truncate">
                      {f.masked_question}
                    </p>
                  ) : (
                    <p className="text-note text-text-faint md:order-2 md:truncate">
                      보관 기간 경과 (질문 텍스트 파기됨)
                    </p>
                  )}
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
                    <span className="text-[13.5px] text-text-faint tabular-nums md:order-1">
                      {formatDateTime(f.created_at)}
                    </span>
                    {/* 사유 뱃지 한글화(최종 폴리시 9) - 파란 텍스트 금지 규칙 유지 */}
                    <span className="rounded-chip bg-primary-light px-2 py-[3px] text-[12px] font-bold text-text md:order-3 md:justify-self-start">
                      {STORED_REASON_LABEL[f.fallback_reason]}
                    </span>
                    <span className="hidden text-[13.5px] font-bold text-text-sub md:order-4 md:block">
                      {INTENT_LABEL[f.intent]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* 3. 지표 안내 - 각 항목 id = KPI 지표명 앵커 대상 */}
          <section
            aria-label="지표 안내"
            className="rounded-panel border border-border bg-white p-5"
          >
            <h2 className="text-[16px] font-extrabold text-text">지표 안내</h2>
            <dl className="mt-3 space-y-1">
              {KPI_GUIDE.map(({ id, name, desc }) => (
                <div
                  id={id}
                  /* n 포함 key - 같은 항목 재탭 시 리마운트로 애니메이션 재시작 */
                  key={guideFlash?.id === id ? `${id}-${guideFlash.n}` : id}
                  className={`scroll-mt-32 rounded-btn-s px-2 py-1.5 ${
                    guideFlash?.id === id ? "row-highlight" : ""
                  }`}
                >
                  <dt className="text-admin-body font-bold text-text">{name}</dt>
                  <dd className="text-admin-body text-text-sub">{desc}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </main>
  );
}
