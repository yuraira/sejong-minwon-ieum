import { describe, expect, it } from "vitest";
import type { components } from "../../../../packages/shared-contracts/src/generated/api";
import { buildFailureAnalytics } from "./failure-analytics";

type FailedQuestion = components["schemas"]["FailedQuestion"];
type KBCandidateSummary = components["schemas"]["KBCandidateSummary"];

function failure(
  id: string,
  question: string | null,
  createdAt: string,
  intent: FailedQuestion["intent"] = "BULKY_WASTE",
): FailedQuestion {
  return {
    id,
    masked_question: question,
    intent,
    fallback_reason: "INSUFFICIENT_GROUNDING",
    candidate_eligible: true,
    status: "NEW",
    created_at: createdAt,
    text_expires_at: "2026-08-31T00:00:00Z",
    text_purged_at: question === null ? "2026-08-01T00:00:00Z" : null,
  };
}

describe("buildFailureAnalytics", () => {
  it("groups only retained masked questions and calculates the four-week trend", () => {
    const result = buildFailureAnalytics(
      [
        failure("1", "침대 프레임 수수료", "2026-08-18T01:00:00Z"),
        failure("2", "  침대   프레임 수수료 ", "2026-08-12T01:00:00Z"),
        failure("3", null, "2026-08-01T01:00:00Z", "LOCAL_TAX_GENERAL"),
      ],
      [],
      new Date("2026-08-19T12:00:00Z"),
    );

    expect(result.total).toBe(3);
    expect(result.actionable).toBe(2);
    expect(result.purged).toBe(1);
    expect(result.trend.map((bucket) => bucket.count)).toEqual([0, 1, 1, 1]);
    expect(result.clusters[0]).toMatchObject({ count: 2, intentLabel: "대형폐기물" });
  });

  it("reports candidate workflow states without treating rejected items as ACTIVE", () => {
    const base = {
      failed_question_id: "1",
      status: "PENDING_APPROVAL",
    } as KBCandidateSummary;
    const result = buildFailureAnalytics(
      [failure("1", "질문", "2026-08-18T01:00:00Z")],
      [
        base,
        { ...base, failed_question_id: "2", status: "APPROVED" },
        { ...base, failed_question_id: "3", status: "REJECTED" },
      ],
      new Date("2026-08-19T12:00:00Z"),
    );

    expect(result.funnel).toEqual({
      actionable: 1,
      drafted: 3,
      pending: 1,
      approved: 1,
    });
  });
});
