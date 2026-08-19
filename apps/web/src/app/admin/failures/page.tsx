"use client";

/**
 * 답변 실패 질문 관리 - CLAUDE.md §6 (2) + DESIGN.md v3 §9-2, 계약 적응판.
 * - 필터 칩(r-pill) + 칩 위 요약 한 줄 (전체 N건 / 신규 N건).
 *   필터는 계약 StoredFailureReason 3종 - OUT_OF_SCOPE는 저장되지 않는다.
 * - 신규 도착 하이라이트: 새로고침 후 새로 등장한 행 highlight→2초 페이드.
 * - 흐름(계약): NEW → 사유 확정(PATCH /reason) → 근거 부족 건만 KB 후보 생성
 *   (초안 자동 구성 → POST 생성 → POST 승인 요청) → 승인 화면 이동 배너.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { components } from "../../../../../../packages/shared-contracts/src/generated/api";
import { STORED_REASON_LABEL, type StoredFailureReason } from "@/lib/labels";
import { useAdmin } from "@/components/admin/AdminShell";
import CandidateAuthoringForm from "@/components/admin/CandidateAuthoringForm";
import CivicScopeGapPanel from "@/components/admin/CivicScopeGapPanel";
import FailureTable from "@/components/admin/FailureTable";
import EmptyState from "@/components/admin/EmptyState";
import PageHeader from "@/components/admin/PageHeader";
import Toast from "@/components/common/Toast";
import { AdminTransportError } from "@/lib/admin-api";

type FailedQuestion = components["schemas"]["FailedQuestion"];
type KBCandidateSummary = components["schemas"]["KBCandidateSummary"];
type KBCandidateCreate = components["schemas"]["KBCandidateCreate"];
type CivicScopeGapSummary = components["schemas"]["CivicScopeGapSummary"];
type CivicScopeGapDecision = components["schemas"]["CivicScopeGapReviewRequest"]["decision"];

type Filter = "ALL" | StoredFailureReason;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "전체" },
  { key: "INSUFFICIENT_GROUNDING", label: STORED_REASON_LABEL.INSUFFICIENT_GROUNDING },
  { key: "PERSONAL_LOOKUP", label: STORED_REASON_LABEL.PERSONAL_LOOKUP },
  { key: "LEGAL_JUDGMENT", label: STORED_REASON_LABEL.LEGAL_JUDGMENT },
];

const REASON_POLICY = [
  {
    key: "INSUFFICIENT_GROUNDING",
    title: "근거 부족",
    detail: "마스킹 질문을 30일 보관하고, 운영자가 KB 후보로 전환할 수 있습니다.",
  },
  {
    key: "PERSONAL_LOOKUP",
    title: "개인 조회 필요",
    detail: "질문 텍스트는 저장하지 않고 공식 조회 채널로 연결합니다.",
  },
  {
    key: "LEGAL_JUDGMENT",
    title: "법적 판단 필요",
    detail: "질문 텍스트는 저장하지 않고 기관 상담 안내로 닫습니다.",
  },
] as const;

/**
 * 직전 로드의 id 집합 - 모듈 스코프로 유지해 페이지를 떠났다 돌아와도
 * "새로 등장한" 행을 판별한다 (§9-2 - 데모 #5에서 시민 폴백이 도착하는
 * 순간을 하이라이트로 보이게 하는 장치). 탭 리로드 시에만 초기화.
 */
let knownFailureIds: Set<string> | null = null;

function candidateErrorMessage(
  error: unknown,
  phase: "create" | "submit",
): string {
  if (!(error instanceof AdminTransportError)) {
    return phase === "create"
      ? "KB 후보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요."
      : "승인 요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
  if (error.code === "ADMIN_FORBIDDEN") {
    return "작성 운영자 역할에서만 이 작업을 할 수 있어요.";
  }
  if (error.code === "ADMIN_VALIDATION_FAILED") {
    return "입력값이나 공식 출처 주소를 확인해 주세요.";
  }
  if (error.code === "ADMIN_INVALID_STATE") {
    return phase === "create"
      ? "이미 후보가 있거나 현재 실패 질문 상태에서는 저장할 수 없어요."
      : "이미 승인 요청됐거나 현재 후보 상태에서는 다시 요청할 수 없어요.";
  }
  return phase === "create"
    ? "KB 후보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요."
    : "승인 요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export default function AdminFailuresPage() {
  const { transport, actor, role, notifyDataChanged } = useAdmin();
  const [items, setItems] = useState<FailedQuestion[] | null>(null);
  const [candidates, setCandidates] = useState<KBCandidateSummary[]>([]);
  const [scopeGaps, setScopeGaps] = useState<CivicScopeGapSummary[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [draftBanner, setDraftBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [editingFailure, setEditingFailure] = useState<FailedQuestion | null>(null);
  const [scopeBusyId, setScopeBusyId] = useState<string | null>(null);

  // setState는 조회 완료 콜백에서만 - 이펙트 본문 동기 setState 금지 규칙 준수
  const fetchData = useCallback(
    () =>
      Promise.all([
        transport.listFailedQuestions(actor),
        transport.listCandidates(actor),
        transport.listCivicScopeGaps(actor),
      ])
        .then(([failureResponse, candidateResponse, scopeResponse]) => {
          const failures = failureResponse.items;
          // 최초 로드는 하이라이트 없음, 이후엔 새로 등장한 id만 1회성 하이라이트.
          if (knownFailureIds !== null) {
            const fresh = failures
              .filter((f) => !knownFailureIds!.has(f.id))
              .map((f) => f.id);
            if (fresh.length > 0) setHighlightIds(new Set(fresh));
          }
          knownFailureIds = new Set(failures.map((f) => f.id));
          setItems(failures);
          setCandidates(candidateResponse.items);
          setScopeGaps(scopeResponse.items);
          setLastUpdated(new Date());
          setError(null);
        })
        .catch(() => {
          setError("운영 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
        }),
    [actor, transport],
  );

  /** 새로고침 버튼·상태 변경 후 재조회 - 진행 표시 포함 */
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

  /** NEW → REASON_CONFIRMED (계약 PATCH /reason - 현재 저장 사유를 확정) */
  const confirmReason = async (id: string) => {
    const target = (items ?? []).find((f) => f.id === id);
    if (!target) return;
    setBusyId(id);
    try {
      await transport.confirmReason(actor, id, {
        reason: target.fallback_reason,
      });
      await load();
      notifyDataChanged();
      setToast("사유가 확정되었습니다");
    } catch {
      setToast("사유를 확정하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusyId(null);
    }
  };

  /** 운영자 작성 → 저장. 저장 실패와 승인 요청 실패를 구분한다. */
  const createDraft = async (draft: KBCandidateCreate) => {
    setBusyId(draft.failed_question_id);
    let created: Awaited<ReturnType<typeof transport.createCandidate>>;
    try {
      created = await transport.createCandidate(actor, draft);
    } catch (error) {
      setToast(candidateErrorMessage(error, "create"));
      setBusyId(null);
      return;
    }
    setEditingFailure(null);
    try {
      await transport.submitCandidate(actor, created.id);
      setDraftBanner(draft.title);
      setToast("운영자가 작성한 KB 후보가 승인 요청되었습니다");
    } catch (error) {
      setToast(
        `KB 후보는 저장됐습니다. ${candidateErrorMessage(error, "submit")}`,
      );
    } finally {
      await load();
      notifyDataChanged();
      setBusyId(null);
    }
  };

  const submitDraft = async (candidateId: string, title: string) => {
    const candidate = candidates.find((item) => item.id === candidateId);
    if (!candidate) return;
    setBusyId(candidate.failed_question_id);
    try {
      await transport.submitCandidate(actor, candidateId);
      setDraftBanner(title);
      setToast("저장된 KB 후보를 승인 요청했습니다");
      await load();
      notifyDataChanged();
    } catch (error) {
      setToast(candidateErrorMessage(error, "submit"));
    } finally {
      setBusyId(null);
    }
  };

  const reviewScopeGap = async (
    id: string,
    decision: CivicScopeGapDecision,
    reviewComment: string,
  ) => {
    setScopeBusyId(id);
    try {
      await transport.reviewCivicScopeGap(actor, id, {
        decision,
        review_comment: reviewComment,
      });
      await load();
      notifyDataChanged();
      setToast(
        decision === "PLANNED"
          ? "다음 지원 범위 검토 대상으로 표시했습니다"
          : "지원 범위 검토 목록에서 제외했습니다",
      );
    } catch {
      setToast("지원 범위 검토 결과를 반영하지 못했어요.");
    } finally {
      setScopeBusyId(null);
    }
  };

  const candidateByFailureId = useMemo(
    () =>
      new Map(
        candidates.map((candidate) => [candidate.failed_question_id, candidate]),
      ),
    [candidates],
  );

  const filtered = useMemo(
    () =>
      (items ?? []).filter((i) => filter === "ALL" || i.fallback_reason === filter),
    [items, filter],
  );

  const countOf = (key: Filter) =>
    (items ?? []).filter((i) => key === "ALL" || i.fallback_reason === key).length;

  const newCount = (items ?? []).filter((i) => i.status === "NEW").length;

  return (
    <main id="main" tabIndex={-1}>
      <PageHeader
        title="답변 실패 질문 관리"
        subtitle={
          <>
            <span>시민 화면에서 답하지 못한 질문이 저장 사유별로 모입니다</span>
            <span>질문 텍스트는 마스킹 후 30일 보관 뒤 파기</span>
          </>
        }
        meta={
          items !== null ? (
            <span className="text-caption text-text-sub">
              신규{" "}
              <b className="text-[16px] font-extrabold text-primary tabular-nums">
                {newCount}
              </b>
              건
            </span>
          ) : undefined
        }
        lastUpdated={lastUpdated}
        refreshing={refreshing}
        onRefresh={() => void load()}
      />

      <div className="px-5 py-[22px] md:px-7">
        {/* 초안 생성 배너 - 데모 #5: 승인 화면으로 매끄럽게 전환 */}
        {draftBanner && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-btn border border-primary-border bg-primary-light px-4 py-3">
            <p className="text-admin-body text-text">
              KB 후보 초안이 생성되었습니다:{" "}
              <span className="font-bold">{draftBanner}</span>
            </p>
            <Link
              href="/admin/kb-candidates"
              className="min-h-11 shrink-0 content-center rounded-btn-s bg-primary px-4 text-admin-body font-bold text-white hover:bg-primary-dark active:bg-primary-dark"
            >
              KB 후보 승인으로 이동
            </Link>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-btn border border-border bg-white px-4 py-3" role="alert">
            <p className="text-admin-body text-text">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 min-h-11 rounded-btn-s border border-primary bg-white px-4 text-admin-body font-bold text-primary hover:bg-primary-light"
            >
              다시 불러오기
            </button>
          </div>
        )}

        {/* 요약 한 줄 - §13-1: 구분자 가운뎃점 없이 여백 구분 */}
        {items !== null && (
          <p className="flex flex-wrap gap-x-3 text-note text-text-sub">
            <span>전체 {items.length}건</span>
            <span>신규 {newCount}건</span>
          </p>
        )}

        <section className="mt-3 grid gap-3 md:grid-cols-3" aria-label="사유별 처리 기준">
          {REASON_POLICY.map((item) => (
            <article
              key={item.key}
              className="rounded-btn border border-border-soft bg-white p-4"
            >
              <h2 className="text-admin-body font-extrabold text-text">
                {item.title}
              </h2>
              <p className="mt-2 text-note text-text-sub">{item.detail}</p>
            </article>
          ))}
        </section>

        <div className="mt-3 rounded-btn border border-primary-border bg-primary-light px-4 py-3 text-note text-text-sub">
          KB 승인 후 ACTIVE가 되려면 승인자가 작성자와 달라야 하고, 공식 출처·요약·질문 예시가 모두 채워져 있어야 합니다.{" "}
          <Link href="/admin/analytics" className="font-bold text-primary underline hover:text-primary-dark">
            전체 폴백 정책과 실패 추이 보기
          </Link>
        </div>

        {/* 저장 사유 3종 필터 - r-pill, 활성=primary 채움 (§9-2) */}
        <div
          role="group"
          aria-label="저장 사유 필터"
          className="mt-2 flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-x-visible md:pb-0"
        >
          {FILTERS.map(({ key, label }) => {
            const active = filter === key;
            const count = countOf(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(key)}
                className={`min-h-11 shrink-0 rounded-pill px-[18px] text-[14.5px] whitespace-nowrap ${
                  active
                    ? "bg-primary font-extrabold text-white hover:bg-primary-dark"
                    : "border border-border bg-white font-bold text-text-sub hover:border-primary hover:text-primary"
                } ${count === 0 && !active ? "opacity-40" : ""}`}
              >
                {label} {count}
              </button>
            );
          })}
        </div>

        <div className="mt-3.5">
          {items === null ? (
            <p className="text-admin-body text-text-sub">불러오는 중…</p>
          ) : filtered.length === 0 ? (
            <EmptyState
              title={
                filter === "ALL"
                  ? "아직 실패 질문이 없습니다"
                  : `'${FILTERS.find((f) => f.key === filter)?.label}' 사유의 실패 질문이 없습니다`
              }
              description="시민 화면에서 폴백이 발생하면 이 목록에 새로 들어옵니다. 새로고침으로 확인해 보세요."
              action={
                <button
                  type="button"
                  onClick={() => void load()}
                  className="min-h-11 rounded-btn-s border border-primary bg-white px-4 text-admin-body font-bold text-primary hover:bg-primary-light active:bg-primary-light"
                >
                  새로고침
                </button>
              }
            />
          ) : (
            <FailureTable
              items={filtered}
              candidateByFailureId={candidateByFailureId}
              busyId={busyId}
              highlightIds={highlightIds}
              canOperate={role === "OPERATOR"}
              onConfirmReason={(id) => void confirmReason(id)}
              onCreateDraft={(id) =>
                setEditingFailure((items ?? []).find((item) => item.id === id) ?? null)
              }
              onSubmitDraft={(candidateId, title) =>
                void submitDraft(candidateId, title)
              }
            />
          )}
        </div>
        {editingFailure && (
          <CandidateAuthoringForm
            failure={editingFailure}
            busy={busyId === editingFailure.id}
            onCancel={() => setEditingFailure(null)}
            onSubmit={(draft) => void createDraft(draft)}
          />
        )}
        <CivicScopeGapPanel
          items={scopeGaps}
          canReview={role === "APPROVER"}
          busyId={scopeBusyId}
          onReview={(id, decision, comment) =>
            void reviewScopeGap(id, decision, comment)
          }
        />
      </div>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </main>
  );
}
