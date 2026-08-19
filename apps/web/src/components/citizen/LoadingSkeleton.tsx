/**
 * (D) 로딩 스켈레톤 - DESIGN.md v3 §6-4 (시안 2c). 답변 카드 구조 예고:
 * 헤더(뱃지 자리 + 확인 뱃지 자리) → 본문 2줄 → 번호 원 + 텍스트 스텝 2개 →
 * 출처 블록 자리(64px, verify-light + 초록 계열 테두리) → 스피너 + 안내 문구.
 * 대기 시간이 길어지면 부모가 단계별 상태 문구를 전달한다.
 */
export default function LoadingSkeleton({
  message = "공식 자료에서 확인하고 있어요.",
  phase = "masking",
}: {
  message?: string;
  phase?: "masking" | "searching" | "verifying";
}) {
  const steps = [
    {
      key: "masking",
      label: "개인정보를 먼저 가리고 있어요",
      done: phase !== "masking",
      active: phase === "masking",
    },
    {
      key: "searching",
      label: "승인된 KB와 공식 출처를 찾고 있어요",
      done: phase === "verifying",
      active: phase === "searching",
    },
    {
      key: "verifying",
      label: "답변 근거와 폴백 여부를 점검하고 있어요",
      done: false,
      active: phase === "verifying",
    },
  ] as const;

  return (
    <div
      role="status"
      aria-label={message.replace(/\.$/, "")}
      className="overflow-hidden rounded-card border border-border bg-white shadow-card"
    >
      {/* 헤더 - 뱃지 자리 + 확인 뱃지 자리 */}
      <div className="flex items-center justify-between border-b border-border-soft bg-card-head px-4 py-3.5">
        <span className="h-[26px] w-24 animate-pulse rounded-[8px] bg-border-soft" />
        <span className="h-[18px] w-30 animate-pulse rounded-[8px] bg-bg-sub" />
      </div>
      <div className="flex flex-col gap-4 p-4">
        {/* 본문 2줄 */}
        <div className="flex flex-col gap-2">
          <span className="h-4 w-[92%] animate-pulse rounded-chip bg-border-soft" />
          <span className="h-4 w-[74%] animate-pulse rounded-chip bg-border-soft" />
        </div>
        {/* 단계형 진행 표시 - 실제 대기 단계와 문구를 맞춘다 */}
        <div className="flex flex-col gap-2.5">
          {steps.map((step, index) => (
            <div key={step.key} className="flex items-center gap-3">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold ${
                  step.done
                    ? "bg-verify-light-2 text-verify-dark"
                    : step.active
                      ? "bg-primary-light text-primary"
                      : "bg-border-soft text-text-faint"
                }`}
              >
                {step.done ? "✓" : index + 1}
              </span>
              <span
                className={`text-note ${
                  step.active
                    ? "font-semibold text-text"
                    : "text-text-sub"
                }`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
        {/* 출처 블록 자리 - 초록 계열 (출처가 올 것임을 예고) */}
        <div className="h-16 animate-pulse rounded-card-s border border-verify-border bg-verify-light" />
        {/* 스피너 + 안내 문구 (PER-001 - 3초 심리 방어선) */}
        <p className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="h-[18px] w-[18px] shrink-0 animate-spin rounded-full border-[3px] border-primary-border border-t-primary"
          />
          <span className="text-[16px] font-semibold text-text-sub">
            {message}
          </span>
        </p>
      </div>
    </div>
  );
}
