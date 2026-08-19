"use client";

/**
 * 시민 대화 화면 - CLAUDE.md §4 응답 상태 전부 처리, DESIGN.md v3 §6·§8.
 * 프레임: 공지 배너 + 헤더(뒤로가기 44px + 워드마크, sticky) + 680px 대화 컬럼 +
 * 하단 sticky 입력바(개인정보 경고 한 줄 위). 대화 내용은 React state로만 유지,
 * 브라우저 스토리지 저장 금지 (§9). 새 답변은 aria-live="polite"로 알린다.
 *
 * 데이터 계층은 계약 기준(lib/chat-api.ts):
 * - 논리 질문 1건당 UUID Idempotency-Key 1개를 만들고 재시도에는 재사용한다.
 * - signed context_token은 React ref에만 둔다. FALLBACK 응답은 null로 초기화.
 * - 오류는 값 노출 없는 ChatTransportError - retryable이면 "다시 시도" 제공,
 *   422(비재시도)는 입력 확인 안내만. 만료 토큰은 계약상 오류가 아니라
 *   "무맥락"으로 처리되므로 별도 만료 UI는 없다.
 *
 * 태성 리뷰 1: 첫 화면에서 넘어온 질문은 URL 쿼리(?q=)가 아니라 탭 메모리
 * (pending-question)에서 1회성으로 소비한다 - 질문 원문이 URL·히스토리·
 * 서버 로그에 남지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type ChatRequest,
  type ChatResponse,
  type ChatSendOptions,
  type ChatTransport,
  ChatTransportError,
  createChatTransport,
} from "@/lib/chat-api";
import { createFixtureChatTransport } from "@/lib/demo-fixtures";
import {
  createFeedbackTransport,
  createFixtureFeedbackTransport,
  type FeedbackTransport,
} from "@/lib/feedback-api";
import { consumePendingQuestion } from "@/lib/pending-question";
import { isRegion, type Region } from "@/lib/labels";
import { ChatHeader, NoticeBanner } from "@/components/citizen/PageChrome";
import FixtureNotice from "@/components/common/FixtureNotice";
import AnswerCard from "@/components/citizen/AnswerCard";
import FollowupCard from "@/components/citizen/FollowupCard";
import FallbackCard from "@/components/citizen/FallbackCard";
import LoadingSkeleton from "@/components/citizen/LoadingSkeleton";
import PrivacyNotice from "@/components/citizen/PrivacyNotice";
import RegionSelect from "@/components/citizen/RegionSelect";

const INITIAL_WAITING_MESSAGE = "공식 자료에서 확인하고 있어요.";
const SEARCHING_WAITING_MESSAGE = "관련 민원과 공식 출처를 찾고 있어요.";
const VERIFYING_WAITING_MESSAGE = "답변 근거를 다시 확인하고 있어요.";
type LoadingPhase = "masking" | "searching" | "verifying";

interface UserMessage {
  role: "user";
  id: string;
  text: string;
}
interface BotMessage {
  role: "bot";
  id: string;
  response: ChatResponse;
  /** 이 응답을 만든 질문/지역 - 동 변경·지역 승격에 사용 */
  question: string;
  region: Region | null;
}
type Message = UserMessage | BotMessage;

type FailedDraft = Readonly<{
  idempotencyKey: string;
  request: ChatRequest;
  displayText: string;
  retryable: boolean;
}>;

export type ChatTransportMode = "fixture" | "actual";

export default function ChatScreen({
  transportMode = "actual",
  transport: providedTransport,
  feedbackTransport: providedFeedbackTransport,
  createIdempotencyKey = () => crypto.randomUUID(),
}: {
  transportMode?: ChatTransportMode;
  transport?: ChatTransport;
  feedbackTransport?: FeedbackTransport;
  createIdempotencyKey?: () => string;
}) {
  const [transport] = useState<ChatTransport>(
    () =>
      providedTransport ??
      (transportMode === "actual"
        ? createChatTransport()
        : createFixtureChatTransport()),
  );
  const [feedbackTransport] = useState<FeedbackTransport>(
    () =>
      providedFeedbackTransport ??
      (transportMode === "actual"
        ? createFeedbackTransport()
        : createFixtureFeedbackTransport()),
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [waitingMessage, setWaitingMessage] = useState(
    INITIAL_WAITING_MESSAGE,
  );
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("masking");
  const [failedDraft, setFailedDraft] = useState<FailedDraft | null>(null);
  const idRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const askedInitial = useRef(false);
  const contextTokenRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const nextId = () => `msg-${++idRef.current}`;

  const sendRequest = useCallback(
    async (
      request: ChatRequest,
      displayText: string,
      options: Required<ChatSendOptions>,
      { appendUserMessage = true }: { appendUserMessage?: boolean } = {},
    ) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setWaitingMessage(INITIAL_WAITING_MESSAGE);
      setLoadingPhase("masking");
      setLoading(true);
      setFailedDraft(null);
      if (appendUserMessage) {
        setMessages((prev) => [
          ...prev,
          { role: "user", id: nextId(), text: displayText },
        ]);
      }

      try {
        const response = await transport.send(request, options);
        // The network operation is complete; enable the newly rendered
        // response controls before React paints them.
        inFlightRef.current = false;
        // FALLBACK은 계약상 context_token이 항상 null - 탭 메모리 갱신 (§9)
        contextTokenRef.current =
          response.answer_status === "FALLBACK" ? null : response.context_token;
        setMessages((prev) => [
          ...prev,
          {
            role: "bot",
            id: response.request_id,
            response,
            question: request.question,
            region: request.selected_region ?? null,
          },
        ]);
        setInput((current) =>
          current.trim() === request.question ? "" : current,
        );
      } catch (error) {
        setFailedDraft({
          idempotencyKey: options.idempotencyKey,
          request,
          displayText,
          retryable: !(error instanceof ChatTransportError) || error.retryable,
        });
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [transport],
  );

  /** 새 논리 질문 - Idempotency-Key를 새로 발급한다 */
  const ask = useCallback(
    (
      question: string,
      opts?: {
        region?: Region | null;
        displayText?: string;
        contextToken?: string | null;
      },
    ) => {
      const trimmed = question.trim();
      if (!trimmed || inFlightRef.current) return;
      void sendRequest(
        {
          question: trimmed,
          selected_region:
            opts?.region !== undefined ? opts.region : selectedRegion,
          simple_language: true,
          context_token:
            opts?.contextToken !== undefined
              ? opts.contextToken
              : contextTokenRef.current,
        },
        opts?.displayText ?? trimmed,
        { idempotencyKey: createIdempotencyKey() },
      );
    },
    [createIdempotencyKey, selectedRegion, sendRequest],
  );

  // 첫 화면에서 넘어온 질문 자동 전송 - 탭 메모리 1회성 소비 (태성 리뷰 1)
  useEffect(() => {
    if (askedInitial.current) return;
    askedInitial.current = true;
    const pending = consumePendingQuestion();
    if (pending) ask(pending);
  }, [ask]);

  useEffect(() => {
    // §12: prefers-reduced-motion 존중 - smooth 스크롤도 모션이다
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    bottomRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
    });
  }, [messages, loading]);

  useEffect(() => {
    if (!loading) return;
    const searchingTimer = window.setTimeout(
      () => {
        setWaitingMessage(SEARCHING_WAITING_MESSAGE);
        setLoadingPhase("searching");
      },
      2_000,
    );
    const verifyingTimer = window.setTimeout(
      () => {
        setWaitingMessage(VERIFYING_WAITING_MESSAGE);
        setLoadingPhase("verifying");
      },
      6_000,
    );
    return () => {
      window.clearTimeout(searchingTimer);
      window.clearTimeout(verifyingTimer);
    };
  }, [loading]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    ask(q);
  };

  /** FOLLOWUP 선택지 - 지역명이면 selected_region으로 승격해 원 질문 재전송,
   *  아니면 새 질문으로 전송. context_token은 해당 FOLLOWUP 응답의 토큰 사용 */
  const selectFollowup = (message: BotMessage, option: string) => {
    const token = message.response.context_token;
    if (isRegion(option)) {
      setSelectedRegion(option);
      ask(message.question, {
        region: option,
        displayText: `${option}에 살아요`,
        contextToken: token,
      });
      return;
    }
    ask(option, { contextToken: token });
  };

  const startNewConversation = () => {
    if (inFlightRef.current) return;
    setMessages([]);
    setInput("");
    setFailedDraft(null);
    setWaitingMessage(INITIAL_WAITING_MESSAGE);
    contextTokenRef.current = null;
    idRef.current = 0;
    inputRef.current?.focus();
  };

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      {/* fixture 모드 상시 배너 - 공지 배너와 구분되는 앰버 톤 (태성 리뷰 2) */}
      {transportMode === "fixture" && <FixtureNotice />}
      {/* 공지 배너 - 시민 전 페이지 최상단 (대화 화면 개정 1) */}
      <NoticeBanner />
      <ChatHeader
        onNewConversation={startNewConversation}
        disabled={loading}
      />

      {/* 대화 컬럼 - 데스크톱 680px 고정 (§4-2). 새 답변을 스크린리더에 알린다 */}
      <main
        id="main"
        aria-live="polite"
        className="mx-auto flex w-full max-w-[680px] flex-1 flex-col gap-4 px-5 py-5"
      >
        {messages.length === 0 && !loading && (
          <p className="py-8 text-center text-body text-text-sub">
            궁금한 민원을 입력해 주세요.
          </p>
        )}
        {messages.map((msg, index) =>
          msg.role === "user" ? (
            <div key={msg.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-[16px_16px_4px_16px] bg-primary px-4 py-3 text-body leading-[1.45] text-white">
                {msg.text}
              </p>
            </div>
          ) : (
            <BotResponse
              key={msg.id}
              message={msg}
              feedbackTransport={feedbackTransport}
              disabled={loading || index !== messages.length - 1}
              onSelectFollowup={selectFollowup}
              onRegionChange={(message, dong) =>
                {
                  setSelectedRegion(dong);
                  ask(message.question, {
                    region: dong,
                    displayText: `${dong} 기준으로 다시 알려주세요`,
                  });
                }
              }
              onRelatedQuestion={(message, question) =>
                ask(question, { contextToken: message.response.context_token })
              }
            />
          ),
        )}
        {loading && (
          <LoadingSkeleton
            message={waitingMessage}
            phase={loadingPhase}
          />
        )}

        {/* 네트워크·서버 오류 - 재시도가 주인공, 뱃지만 danger 톤 (§6-4).
            재시도는 같은 Idempotency-Key를 재사용한다 (계약). */}
        {failedDraft && (
          <div
            role="alert"
            className="card-enter overflow-hidden rounded-card border border-border bg-white shadow-card"
          >
            <div className="border-b border-border-soft bg-card-head px-4 py-3.5">
              <span className="inline-flex rounded-[8px] bg-danger-light px-2.5 py-1 text-caption font-extrabold text-danger">
                {failedDraft.retryable ? "연결 오류" : "입력 확인"}
              </span>
            </div>
            <div className="flex flex-col gap-3.5 p-4">
              {failedDraft.retryable ? (
                <>
                  <p className="text-body-lg font-semibold text-text [text-wrap:pretty]">
                    지금은 안전한 답변을 만들 수 없어요.{" "}
                    <b className="font-bold">
                      작성하신 질문은 그대로 남아 있습니다.
                    </b>
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void sendRequest(
                        failedDraft.request,
                        failedDraft.displayText,
                        { idempotencyKey: failedDraft.idempotencyKey },
                        { appendUserMessage: false },
                      )
                    }
                    className="min-h-14 w-full rounded-btn bg-primary px-4 text-[18px] font-bold text-white hover:bg-primary-dark active:bg-primary-dark"
                  >
                    다시 시도
                  </button>
                  <a
                    href="tel:044-120"
                    className="flex min-h-14 w-full items-center justify-center rounded-btn border border-primary bg-white px-4 text-[18px] font-bold text-primary hover:bg-hover-tint active:bg-hover-tint"
                  >
                    전화로 문의 044-120
                  </a>
                  <p className="text-note text-text-sub">
                    잠시 후에도 연결되지 않으면 통신 상태를 확인해 주세요.
                  </p>
                </>
              ) : (
                <p className="text-body-lg font-semibold text-text [text-wrap:pretty]">
                  입력 내용을 확인한 뒤 새 질문을 보내 주세요.
                </p>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* 하단 sticky 입력바 - 위에 개인정보 경고 한 줄 (§8) */}
      <div className="sticky bottom-0 border-t border-border-soft bg-white">
        <form
          onSubmit={submit}
          aria-label="민원 질문 작성"
          className="mx-auto w-full max-w-[680px] px-5 pt-1 pb-3"
        >
          {/* 개인정보 경고 한 줄 - 입력 위 (§8) */}
          <div className="pt-2">
            <RegionSelect current={selectedRegion} onSelect={setSelectedRegion} />
          </div>
          <PrivacyNotice />
          <div className="mt-2 flex gap-2">
            <label htmlFor="chat-input" className="sr-only">
              질문 입력
            </label>
            <input
              ref={inputRef}
              id="chat-input"
              type="text"
              value={input}
              maxLength={1000}
              onChange={(e) => setInput(e.target.value)}
              placeholder="질문을 입력하세요"
              className="min-h-12 min-w-0 flex-1 rounded-btn border border-border bg-white px-4 text-body text-text placeholder:text-text-faint focus:border-primary focus-visible:border-primary"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="min-h-12 shrink-0 rounded-btn bg-primary px-5 text-body font-bold text-white hover:bg-primary-dark active:bg-primary-dark disabled:bg-border-soft disabled:text-text-faint"
            >
              {loading ? "답변 확인 중" : "전송"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** 응답 상태별 카드 분기 (계약 answer_status) */
function BotResponse({
  message,
  disabled,
  onSelectFollowup,
  onRegionChange,
  onRelatedQuestion,
  feedbackTransport,
}: {
  message: BotMessage;
  disabled: boolean;
  onSelectFollowup: (message: BotMessage, option: string) => void;
  onRegionChange: (message: BotMessage, dong: Region) => void;
  onRelatedQuestion: (message: BotMessage, question: string) => void;
  feedbackTransport: FeedbackTransport;
}) {
  const { response } = message;

  switch (response.answer_status) {
    case "SUCCESS":
      return (
        <AnswerCard
          response={response}
          region={message.region}
          onRegionChange={
            message.region ? (dong) => onRegionChange(message, dong) : undefined
          }
          onRelatedQuestion={(question) => onRelatedQuestion(message, question)}
          relatedQuestionsDisabled={disabled}
          feedbackTransport={feedbackTransport}
        />
      );
    case "FOLLOWUP":
      return (
        <FollowupCard
          intent={response.intent}
          options={response.followup_options}
          disabled={disabled}
          requestId={response.request_id}
          feedbackTransport={feedbackTransport}
          onSelect={(option) => onSelectFollowup(message, option)}
        />
      );
    case "FALLBACK":
      return (
        <FallbackCard
          fallback={response.fallback}
          requestId={response.request_id}
          feedbackTransport={feedbackTransport}
        />
      );
  }
}
