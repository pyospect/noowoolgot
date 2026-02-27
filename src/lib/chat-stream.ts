import type { ChatMessage, StreamEvent } from "@/lib/chat-model";

type StreamChatParams = {
  messages: ChatMessage[];
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
};

function parseErrorMessage(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return "요청 처리 중 오류가 발생했습니다.";
}

function normalizeEvent(raw: unknown): StreamEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const event = raw as Partial<StreamEvent> & { type?: unknown };
  if (typeof event.type !== "string") {
    return null;
  }

  if (event.type === "status" && typeof event.message === "string") {
    return { type: "status", message: event.message };
  }
  if (event.type === "tool_start" && typeof event.message === "string") {
    return {
      type: "tool_start",
      message: event.message,
      detail: typeof event.detail === "string" ? event.detail : undefined,
    };
  }
  if (event.type === "tool_done" && typeof event.message === "string") {
    return { type: "tool_done", message: event.message };
  }
  if (event.type === "final" && typeof event.answer === "string") {
    const responseMode =
      event.responseMode === "mcp" || event.responseMode === "general" || event.responseMode === "system"
        ? event.responseMode
        : undefined;
    return {
      type: "final",
      answer: event.answer,
      toolsUsed: Array.isArray(event.toolsUsed)
        ? event.toolsUsed.filter((tool): tool is string => typeof tool === "string")
        : undefined,
      responseMode,
    };
  }
  if (event.type === "error" && typeof event.message === "string") {
    return { type: "error", message: event.message };
  }

  return null;
}

export async function streamChat({ messages, signal, onEvent }: StreamChatParams) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  });

  if (!response.ok || !response.body) {
    let message = "요청 처리 중 오류가 발생했습니다.";
    try {
      const data = await response.json();
      message = parseErrorMessage(data);
    } catch {
      // ignore parse error
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const parsed = normalizeEvent(JSON.parse(line));
      if (!parsed) {
        continue;
      }
      onEvent(parsed);
    }
  }
}
