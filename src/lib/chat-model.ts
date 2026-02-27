export type MessageRole = "user" | "assistant";
export type ResponseMode = "mcp" | "general" | "system";

export type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  toolsUsed?: string[];
  responseMode?: ResponseMode;
};

export type StreamEvent =
  | { type: "status"; message: string }
  | { type: "tool_start"; message: string; detail?: string }
  | { type: "tool_done"; message: string }
  | { type: "final"; answer: string; toolsUsed?: string[]; responseMode?: ResponseMode }
  | { type: "error"; message: string };

export function nowKstLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
  return parts.replaceAll(". ", ".").replace(/\.$/, "");
}

export function makeInitialMessages(): ChatMessage[] {
  return [
    {
      id: `init-assistant-${Date.now()}`,
      role: "assistant",
      content: [
        "안녕하세요, **누울곳**입니다.",
        "",
        `오늘은 **${nowKstLabel()} (KST)** 입니다.`,
        "",
        "궁금한 지역이나 단지명을 편하게 말씀해 주세요. 필요한 조회를 순서대로 진행해서 바로 알려드릴게요.",
      ].join("\n"),
    },
  ];
}
