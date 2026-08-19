"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import { useAdmin } from "@/components/admin/AdminShell";
import {
  buildFailureAnalytics,
  type FailureAnalytics,
} from "@/lib/failure-analytics";

const FALLBACK_POLICY = [
  {
    reason: "근거 부족",
    retention: "마스킹 질문 30일 보관",
    handling: "실패 큐에서 공식 근거를 작성하고 별도 승인자에게 요청",
    candidate: "KB 후보 가능",
  },
  {
    reason: "개인 조회",
    retention: "질문 텍스트·실패 행 미저장",
    handling: "정부24·위택스 등 본인 인증 조회 채널 안내",
    candidate: "KB 후보 불가",
  },
  {
    reason: "법적 판단",
    retention: "질문 텍스트·실패 행 미저장",
    handling: "일반 정보만 제공하고 담당 기관 상담 안내",
    candidate: "KB 후보 불가",
  },
  {
    reason: "지원 범위 확대",
    retention: "마스킹 질문 30일 별도 보관",
    handling: "범위 확대 검토 큐에서 담당자가 편입 여부 결정",
    candidate: "편입 결정 전 ACTIVE 불가",
  },
  {
    reason: "범위 밖",
    retention: "질문 텍스트·실패 행 미저장",
    handling: "지원 분야와 세종시 대표 민원 창구 안내",
    candidate: "KB 후보 불가",
  },
  {
    reason: "개인정보 미해소",
    retention: "질문 텍스트·실패 행 미저장",
    handling: "질문 없는 비식별 처리 메타데이터만 남기고 재질문 안내",
    candidate: "KB 후보 불가",
  },
] as const;

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function AdminAnalyticsPage() {
  const { transport, actor, mode } = useAdmin();
  const [analytics, setAnalytics] = useState<FailureAnalytics | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    () =>
      Promise.all([
        transport.listFailedQuestions(actor),
        transport.listCandidates(actor),
      ])
        .then(([failures, candidates]) => {
          setAnalytics(buildFailureAnalytics(failures.items, candidates.items));
          setLastUpdated(new Date());
          setError(null);
        })
        .catch(() => {
          setError("분석 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
        }),
    [actor, transport],
  );

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

  const maxTrend = Math.max(1, ...(analytics?.trend.map((item) => item.count) ?? [1]));
  const maxIntent = Math.max(1, ...(analytics?.intents.map((item) => item.count) ?? [1]));

  return (
    <main id="main" tabIndex={-1}>
      <PageHeader
        title="실패 분석"
        subtitle={
          <>
            <span>마스킹된 운영 데이터만 집계</span>
            <span>{mode === "fixture" ? "시연 데이터" : "실제 local DB"}</span>
          </>
        }
        meta={
          <span className="rounded-pill border border-primary-border bg-primary-light px-4 py-2 text-caption font-bold text-primary">
            최신 실패일 기준 4주
          </span>
        }
        lastUpdated={lastUpdated}
        refreshing={refreshing}
        onRefresh={() => void load()}
      />

      <div className="px-5 py-[22px] md:px-7">
        {error && (
          <div role="alert" className="mb-4 rounded-btn border border-border bg-white p-4 text-admin-body text-text">
            {error}
          </div>
        )}

        {analytics === null ? (
          <p className="text-admin-body text-text-sub">분석 데이터를 불러오는 중…</p>
        ) : (
          <div className="flex flex-col gap-5">
            <section aria-label="실패 질문 핵심 지표" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["조회된 실패", analytics.total, "현재 관리자 조회 범위"],
                ["신규 확인 필요", analytics.newCount, "사유 확인 전"],
                ["후보 작성 가능", analytics.actionable, "근거 부족 + 보관 중"],
                ["텍스트 파기", analytics.purged, "30일 경과"],
              ].map(([label, value, caption]) => (
                <article key={label} className="rounded-panel border border-border bg-white p-4">
                  <p className="text-kpi-label font-bold text-text-sub">{label}</p>
                  <p className="mt-2 text-kpi font-extrabold text-text tabular-nums">
                    {value}<span className="ml-1 text-caption font-bold text-text-sub">건</span>
                  </p>
                  <p className="mt-1 text-table-head text-text-faint">{caption}</p>
                </article>
              ))}
            </section>

            <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]" aria-label="실패 추이와 분야별 빈도">
              <article className="rounded-panel border border-border bg-white p-5">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h2 className="text-[16px] font-extrabold text-text">4주 실패 추이</h2>
                    <p className="mt-1 text-note text-text-sub">
                      기준일 {analytics.referenceDate ?? "-"} · 관리자 조회 결과의 생성일 기준
                    </p>
                  </div>
                  <span className="text-caption font-bold text-primary">총 {analytics.trend.reduce((sum, item) => sum + item.count, 0)}건</span>
                </div>
                <div className="mt-5 flex h-52 items-end gap-3 border-b border-border-soft px-1" aria-label="주별 실패 질문 막대 차트">
                  {analytics.trend.map((item) => (
                    <div key={item.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                      <span className="text-caption font-extrabold text-text tabular-nums">{item.count}</span>
                      <div
                        className="w-full max-w-20 rounded-t-btn-s bg-primary"
                        style={{ height: `${Math.max(6, (item.count / maxTrend) * 132)}px` }}
                        title={`${item.label} ${item.count}건`}
                      />
                      <span className="pb-2 text-[11px] font-semibold text-text-faint tabular-nums sm:text-table-head">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-panel border border-border bg-white p-5">
                <h2 className="text-[16px] font-extrabold text-text">분야별 실패 빈도</h2>
                <p className="mt-1 text-note text-text-sub">어느 민원 분야의 KB 보강이 먼저 필요한지 비교합니다.</p>
                <ul className="mt-5 space-y-4">
                  {analytics.intents.map((item) => (
                    <li key={item.intent}>
                      <div className="flex items-center justify-between gap-3 text-note">
                        <span className="font-bold text-text">{item.label}</span>
                        <span className="text-text-sub tabular-nums">{item.count}건 · {item.percent}%</span>
                      </div>
                      <div className="mt-1.5 h-2.5 overflow-hidden rounded-pill bg-bg-sub">
                        <div
                          className="h-full rounded-pill bg-primary"
                          style={{ width: `${(item.count / maxIntent) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            </section>

            <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]" aria-label="자동 취합 제안과 후보 전환 흐름">
              <article className="rounded-panel border border-border bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[16px] font-extrabold text-text">반복 실패 자동 취합</h2>
                    <p className="mt-1 text-note text-text-sub">
                      동일한 마스킹 문구를 규칙으로 묶은 우선 검토 목록입니다. AI 초안이 아니며 담당자가 확인한 뒤에만 후보를 작성합니다.
                    </p>
                  </div>
                  <Link href="/admin/failures" className="flex min-h-11 items-center text-caption font-bold text-primary underline hover:text-primary-dark">
                    실패 질문 관리로
                  </Link>
                </div>
                {analytics.clusters.length === 0 ? (
                  <p className="mt-4 rounded-btn bg-admin-soft p-4 text-note text-text-sub">보관 중인 마스킹 질문이 없어 취합할 패턴이 없습니다.</p>
                ) : (
                  <ol className="mt-4 space-y-2">
                    {analytics.clusters.map((item, index) => (
                      <li key={`${item.question}-${item.intentLabel}`} className="grid gap-2 rounded-btn border border-border-soft bg-admin-soft p-3 sm:grid-cols-[32px_1fr_auto] sm:items-center">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-caption font-extrabold text-primary">{index + 1}</span>
                        <div>
                          <p className="text-note font-bold text-text">{item.question}</p>
                          <p className="mt-0.5 text-table-head text-text-faint">{item.intentLabel} · 최근 {formatDateTime(item.latestAt)}</p>
                        </div>
                        <span className="justify-self-start rounded-pill bg-primary-light px-3 py-1 text-caption font-extrabold text-primary sm:justify-self-end">{item.count}회</span>
                      </li>
                    ))}
                  </ol>
                )}
              </article>

              <article className="rounded-panel border border-border bg-white p-5">
                <h2 className="text-[16px] font-extrabold text-text">KB 전환 흐름</h2>
                <p className="mt-1 text-note text-text-sub">작성과 승인을 분리해 ACTIVE 반영 조건을 확인합니다.</p>
                <dl className="mt-4 space-y-2">
                  {[
                    ["후보 작성 가능", analytics.funnel.actionable],
                    ["후보 생성", analytics.funnel.drafted],
                    ["승인 대기", analytics.funnel.pending],
                    ["ACTIVE 승인 완료", analytics.funnel.approved],
                  ].map(([label, value], index) => (
                    <div key={label} className="flex items-center gap-3 rounded-btn bg-admin-soft px-3 py-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-table-head font-extrabold text-primary">{index + 1}</span>
                      <dt className="flex-1 text-note font-bold text-text">{label}</dt>
                      <dd className="text-admin-body font-extrabold text-primary tabular-nums">{value}건</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 rounded-btn border border-verify-border bg-verify-light px-3 py-2.5 text-note text-verify-dark">
                  작성자와 다른 승인자가 공식 출처·요약·질문 예시를 검수해 승인한 경우만 ACTIVE가 됩니다.
                </p>
              </article>
            </section>

            <section className="rounded-panel border border-border bg-white p-5" aria-labelledby="fallback-policy-title">
              <div>
                <h2 id="fallback-policy-title" className="text-[16px] font-extrabold text-text">폴백 사유별 운영 기준</h2>
                <p className="mt-1 text-note text-text-sub">시민 안내, 저장 범위, 관리자 후속 조치를 같은 기준으로 구분합니다.</p>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-note">
                  <thead>
                    <tr className="border-y border-border-soft bg-admin-soft text-table-head text-text-sub">
                      <th className="px-3 py-2.5 font-bold">폴백 사유</th>
                      <th className="px-3 py-2.5 font-bold">저장·보관</th>
                      <th className="px-3 py-2.5 font-bold">담당자 처리</th>
                      <th className="px-3 py-2.5 font-bold">KB 반영</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FALLBACK_POLICY.map((item) => (
                      <tr key={item.reason} className="border-b border-border-soft align-top">
                        <th className="px-3 py-3 font-extrabold text-text">{item.reason}</th>
                        <td className="px-3 py-3 text-text-sub">{item.retention}</td>
                        <td className="px-3 py-3 text-text-sub">{item.handling}</td>
                        <td className="px-3 py-3 font-bold text-text">{item.candidate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
