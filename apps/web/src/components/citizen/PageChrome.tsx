/**
 * 시민 화면군 공통 요소 - DESIGN.md v3.1 §8.
 * 공지 배너(§8-1) / 헤더(§8-2, 로고 + 기관 소속 표기) / 공공형 푸터(§8-5) /
 * 대화 헤더(뒤로가기 + 로고 심볼 + 워드마크). 색·간격·반경·타이포는 v3 토큰.
 */
import Link from "next/link";
import Logo, { Wordmark } from "@/components/common/Logo";

/** 공지 배너 - 시민 전 페이지 최상단 (대화 화면 포함 - 대화 화면 개정 1) */
export function NoticeBanner() {
  return (
    <div className="flex h-8 items-center justify-center gap-1.5 bg-primary-dark px-4 text-caption text-white">
      <svg
        aria-hidden="true"
        className="h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8h.01M12 11v5" />
      </svg>
      <span className="truncate">
        세종특별자치시 민원 안내 시범 서비스입니다.
      </span>
    </div>
  );
}

/** §8-2. 헤더 - 로고(심볼 + 워드마크) + 소속 표기. sticky, 하단 1px border-soft */
export function CitizenHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border-soft bg-white">
      <div className="mx-auto flex w-full max-w-[680px] items-center justify-between px-5 py-3">
        <Link href="/" aria-label="민원이음 메인으로 이동" className="rounded-btn-s">
          <Wordmark symbolClassName="h-7 w-7" />
        </Link>
        <span className="text-[13px] font-semibold text-text-sub">
          세종특별자치시
        </span>
      </div>
    </header>
  );
}

/** 대화 화면 헤더 - 뒤로가기 44px + 로고 심볼 + 워드마크 (§8 대화 프레임) */
export function ChatHeader({
  onNewConversation,
  disabled = false,
}: {
  onNewConversation?: () => void;
  disabled?: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-border-soft bg-white">
      <div className="mx-auto flex w-full max-w-[680px] items-center gap-2.5 px-5 py-2.5">
        <Link
          href="/"
          aria-label="첫 화면으로 돌아가기"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn-s border border-border bg-white text-text hover:bg-bg-sub active:bg-bg-sub"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <Link
          href="/"
          aria-label="민원이음 메인으로 이동"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-btn-s"
        >
          <span className="shrink-0 text-primary">
            <Logo className="h-6 w-6" />
          </span>
          {/* 워드마크 문법(볼드·검정 수정): 세종·민원 text 볼드 / 이음 primary */}
          <h1 className="min-w-0 truncate text-card-title font-extrabold text-text">
            세종 민원<span className="text-primary">이음</span>
          </h1>
        </Link>
        {onNewConversation && (
          <button
            type="button"
            disabled={disabled}
            onClick={onNewConversation}
            className="min-h-11 shrink-0 rounded-btn-s border border-border bg-white px-3 text-[15px] font-bold text-primary hover:border-primary hover:bg-hover-tint disabled:opacity-60"
          >
            새 대화
          </button>
        )}
      </div>
    </header>
  );
}

/** §8-5. 공공형 푸터 - bg-sub 배경, 상단 1px border, 3단 구성 */
export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-bg-sub">
      <div className="mx-auto w-full max-w-[680px] space-y-3 px-5 py-6">
        {/* 1단: 서비스명 + 근거 배지 */}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-note text-text">
          {/* 워드마크 문법(최종 폴리시 4) */}
          <span className="font-bold">
            <span className="font-normal text-text-sub">세종</span> 민원
            <span className="text-primary">이음</span>
          </span>
          <span className="flex items-center gap-1 font-semibold text-primary">
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            모든 안내는 승인된 지식베이스에 근거합니다
          </span>
        </p>
        {/* 2단: 운영 정보 - §13-1: " · " 금지, 여백(12px)으로 구분 */}
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-note text-text-sub">
          <span>운영: 세종특별자치시 디지털행정혁신단</span>
          <span>
            대표전화{" "}
            <a
              href="tel:044-300-3000"
              className="text-primary underline hover:text-primary-dark"
            >
              044-300-3000
            </a>{" "}
            (평일 09:00~18:00)
          </span>
          <span className="cursor-default text-primary underline">
            개인정보 처리 안내
          </span>
        </p>
        {/* 3단: 시연 고지 */}
        <p className="text-[13px] leading-[1.5] text-text-sub">
          본 서비스는 고려대학교 세종캠퍼스 산업체 실습 시연용입니다.
        </p>
      </div>
    </footer>
  );
}
