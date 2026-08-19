import type { components } from "../../../../packages/shared-contracts/src/generated/api";
import { INTENT_LABEL, SUPPORTED_INTENTS } from "./labels";

type FailedQuestion = components["schemas"]["FailedQuestion"];
type KBCandidateSummary = components["schemas"]["KBCandidateSummary"];
type SupportedIntent = components["schemas"]["SupportedIntent"];

const DAY_MS = 86_400_000;
const TREND_DAYS = 28;

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function shortDate(value: Date): string {
  return `${value.getUTCMonth() + 1}.${value.getUTCDate()}`;
}

function normalizedQuestion(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

export interface FailureAnalytics {
  total: number;
  newCount: number;
  actionable: number;
  purged: number;
  referenceDate: string | null;
  trend: Array<{ label: string; count: number }>;
  intents: Array<{
    intent: SupportedIntent;
    label: string;
    count: number;
    percent: number;
  }>;
  clusters: Array<{
    question: string;
    count: number;
    intentLabel: string;
    latestAt: string;
  }>;
  funnel: {
    actionable: number;
    drafted: number;
    pending: number;
    approved: number;
  };
}

/**
 * 관리자 화면의 조회 결과만 집계한다. 질문 유사도 판단이나 외부 AI 호출 없이
 * 동일한 마스킹 문구를 묶으므로 원문·개인정보를 새로 만들거나 전송하지 않는다.
 */
export function buildFailureAnalytics(
  failures: FailedQuestion[],
  candidates: KBCandidateSummary[],
  now = new Date(),
): FailureAnalytics {
  const validDates = failures
    .map((item) => new Date(item.created_at))
    .filter((date) => !Number.isNaN(date.getTime()));
  const latestDate = validDates.length
    ? new Date(Math.max(...validDates.map((date) => date.getTime())))
    : null;
  const nowDay = startOfUtcDay(now);
  const latestDay = latestDate ? startOfUtcDay(latestDate) : null;
  const anchor = latestDay && nowDay.getTime() - latestDay.getTime() > (TREND_DAYS - 1) * DAY_MS
    ? latestDay
    : nowDay;
  const trendStart = new Date(anchor.getTime() - (TREND_DAYS - 1) * DAY_MS);

  const trend = Array.from({ length: 4 }, (_, index) => {
    const start = new Date(trendStart.getTime() + index * 7 * DAY_MS);
    const end = new Date(start.getTime() + 6 * DAY_MS);
    return {
      label: `${shortDate(start)}-${shortDate(end)}`,
      count: 0,
    };
  });

  const intentCounts = new Map<SupportedIntent, number>();
  const clusterMap = new Map<
    string,
    { question: string; count: number; intent: SupportedIntent; latestAt: string }
  >();

  for (const item of failures) {
    intentCounts.set(item.intent, (intentCounts.get(item.intent) ?? 0) + 1);

    const created = new Date(item.created_at);
    if (!Number.isNaN(created.getTime())) {
      const bucket = Math.floor(
        (startOfUtcDay(created).getTime() - trendStart.getTime()) / (7 * DAY_MS),
      );
      if (bucket >= 0 && bucket < trend.length) trend[bucket].count += 1;
    }

    if (item.masked_question === null) continue;
    const key = normalizedQuestion(item.masked_question);
    const current = clusterMap.get(key);
    if (!current) {
      clusterMap.set(key, {
        question: item.masked_question,
        count: 1,
        intent: item.intent,
        latestAt: item.created_at,
      });
      continue;
    }
    current.count += 1;
    if (item.created_at > current.latestAt) current.latestAt = item.created_at;
  }

  const total = failures.length;
  const actionable = failures.filter(
    (item) => item.candidate_eligible && item.masked_question !== null,
  ).length;

  return {
    total,
    newCount: failures.filter((item) => item.status === "NEW").length,
    actionable,
    purged: failures.filter((item) => item.masked_question === null).length,
    referenceDate: failures.length === 0 ? null : anchor.toISOString().slice(0, 10),
    trend,
    intents: SUPPORTED_INTENTS.map((intent) => {
      const count = intentCounts.get(intent) ?? 0;
      return {
        intent,
        label: INTENT_LABEL[intent],
        count,
        percent: total === 0 ? 0 : Math.round((count / total) * 100),
      };
    }).sort((a, b) => b.count - a.count),
    clusters: [...clusterMap.values()]
      .sort((a, b) => b.count - a.count || b.latestAt.localeCompare(a.latestAt))
      .slice(0, 5)
      .map((item) => ({
        question: item.question,
        count: item.count,
        intentLabel: INTENT_LABEL[item.intent],
        latestAt: item.latestAt,
      })),
    funnel: {
      actionable,
      drafted: candidates.length,
      pending: candidates.filter((item) => item.status === "PENDING_APPROVAL").length,
      approved: candidates.filter((item) => item.status === "APPROVED").length,
    },
  };
}
