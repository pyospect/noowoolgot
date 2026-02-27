import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";

import { ChatMarkdown } from "@/components/chat-markdown";
import { useTurnAnchorLayout } from "@/hooks/use-turn-anchor-layout";
import {
  type ChatMessage,
  type ResponseMode,
  type StreamEvent,
  makeInitialMessages,
  nowKstLabel,
} from "@/lib/chat-model";
import { streamChat } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => makeInitialMessages());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressLogs, setProgressLogs] = useState<string[]>([]);
  const [liveStatus, setLiveStatus] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const {
    activeTurnUserId,
    turnBottomSpacer,
    scrollViewportRef,
    loadingRowRef,
    registerMessageRow,
    beginTurn,
    completeTurn,
    resetTurnAnchor,
  } = useTurnAnchorLayout({
    loading,
    messagesCount: messages.length,
    progressLogCount: progressLogs.length,
    liveStatus,
  });

  useEffect(() => {
    if (activeTurnUserId) {
      return;
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, loading, progressLogs.length, liveStatus, activeTurnUserId]);

  const canSubmit = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  function responseModeLabel(mode: ResponseMode) {
    if (mode === "mcp") {
      return "MCP 기반 답변";
    }
    if (mode === "general") {
      return "일반 답변";
    }
    return "시스템 응답";
  }

  function handleStreamEvent(event: StreamEvent) {
    if (event.type === "status") {
      setLiveStatus(event.message);
      return;
    }

    if (event.type === "tool_start") {
      const detail = event.detail ? ` (${event.detail})` : "";
      setLiveStatus(event.message);
      setProgressLogs((prev) => [...prev, `${event.message}${detail}`]);
      return;
    }

    if (event.type === "tool_done") {
      setLiveStatus(event.message);
      return;
    }

    if (event.type === "error") {
      throw new Error(event.message);
    }

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: event.answer,
      toolsUsed: Array.isArray(event.toolsUsed) ? event.toolsUsed : [],
      responseMode:
        event.responseMode ??
        (Array.isArray(event.toolsUsed) && event.toolsUsed.length > 0 ? "mcp" : "general"),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    completeTurn(assistantMessage.id);
    setLiveStatus("");
  }

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || loading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    beginTurn(userMessage.id);
    setInput("");
    setLoading(true);
    setProgressLogs([]);
    setLiveStatus("질문을 처리하는 중...");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat({
        messages: nextMessages,
        signal: controller.signal,
        onEvent: handleStreamEvent,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      const errorMessage: ChatMessage = {
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        content: `오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      };
      setMessages((prev) => [...prev, errorMessage]);
      completeTurn(errorMessage.id);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
      setLiveStatus("");
    }
  }

  function handleNewChat() {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages(makeInitialMessages());
    setInput("");
    setLoading(false);
    setProgressLogs([]);
    setLiveStatus("");
    resetTurnAnchor();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <main className="h-dvh overflow-hidden bg-[radial-gradient(1000px_500px_at_20%_-10%,#2c3138_0%,#1d2025_45%,#121418_100%)] text-[#eceff3]">
      <div className="mx-auto flex h-full w-full max-w-[1120px] flex-col overflow-hidden px-3 py-3 sm:px-6 sm:py-5">
        <header className="sticky top-0 z-20 rounded-2xl border border-white/10 bg-[#181a1d]/80 px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur sm:px-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold tracking-tight text-white/95 sm:text-lg">누울곳</h1>
              <p className="text-xs text-white/55 sm:text-sm">부동산 실거래 도우미</p>
            </div>
            <div className="flex items-center gap-2">
              <p className="hidden text-xs text-white/65 sm:block">{nowKstLabel()} KST</p>
              <button
                type="button"
                onClick={handleNewChat}
                className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-white/85 transition hover:bg-white/10"
              >
                새 채팅
              </button>
            </div>
          </div>
        </header>

        <section className="relative mt-3 min-h-0 flex-1 overflow-hidden rounded-[28px] border border-white/10 bg-[#17191d]/80 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div
            ref={scrollViewportRef}
            className="h-full overflow-y-auto px-3 pb-44 pt-4 sm:px-8 sm:pb-48 sm:pt-6"
          >
            <div className="mx-auto w-full max-w-[880px] space-y-5 sm:space-y-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  ref={(node) => registerMessageRow(message.id, node)}
                  className={cn("flex w-full", message.role === "user" ? "justify-end" : "justify-start")}
                >
                  {message.role === "user" ? (
                    <div className="max-w-[88%] rounded-2xl rounded-br-md bg-[#2d3137] px-4 py-3 text-[15px] leading-6 text-white/95 shadow-[0_8px_24px_rgba(0,0,0,0.25)] sm:max-w-[60%] sm:text-base">
                      {message.content}
                    </div>
                  ) : (
                    <article className="w-full max-w-[96%] rounded-2xl border border-white/10 bg-[#20242a]/70 px-4 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.2)] sm:max-w-[88%] sm:px-5">
                      <ChatMarkdown content={message.content} />
                      {message.responseMode ? (
                        <p className="mt-4 text-xs text-white/65">
                          응답 경로: {responseModeLabel(message.responseMode)}
                        </p>
                      ) : null}
                      {message.toolsUsed && message.toolsUsed.length > 0 ? (
                        <p className="mt-1 text-xs text-white/55">참고한 조회: {message.toolsUsed.join(", ")}</p>
                      ) : null}
                    </article>
                  )}
                </div>
              ))}

              {loading ? (
                <div ref={loadingRowRef} className="flex w-full justify-start">
                  <article className="w-full max-w-[96%] space-y-2 rounded-2xl border border-white/10 bg-[#20242a]/70 px-4 py-4 text-sm text-white/80 sm:max-w-[88%]">
                    <div className="flex items-center gap-2 text-sm font-medium text-white/90 sm:text-base">
                      <LoaderCircle className="size-4 animate-spin" />
                      {liveStatus || "응답 생성 중..."}
                    </div>
                    {progressLogs.length > 0 ? (
                      <ul className="space-y-1 text-[13px] text-white/65 sm:text-sm">
                        {progressLogs.map((log, index) => (
                          <li key={`${log}-${index}`}>• {log}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                </div>
              ) : null}

              {activeTurnUserId && turnBottomSpacer > 0 ? (
                <div
                  aria-hidden
                  className="transition-[height] duration-150"
                  style={{ height: `${turnBottomSpacer}px` }}
                />
              ) : null}

              <div ref={endRef} />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#17191d] via-[#17191d]/95 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 p-3 sm:p-5">
            <div className="mx-auto w-full max-w-[880px]">
              <form
                onSubmit={handleSubmit}
                className="rounded-2xl border border-white/12 bg-[#2b2f35]/95 p-2 shadow-[0_18px_44px_rgba(0,0,0,0.45)] backdrop-blur"
              >
                <div className="flex items-center gap-2">
                  <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="예) 반포자이 최근 3개월 실거래가"
                    className="h-11 flex-1 bg-transparent px-3 text-[15px] text-white/95 placeholder:text-white/45 outline-none sm:text-base"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (canSubmit) {
                          void sendMessage(input);
                        }
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="grid size-10 place-items-center rounded-full bg-white text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="send"
                  >
                    {loading ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                  </button>
                </div>
              </form>
              <p className="mt-2 px-2 text-[11px] text-white/45 sm:text-xs">
                지역·단지·기간 중 하나만 입력해도 조회를 시작합니다.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
