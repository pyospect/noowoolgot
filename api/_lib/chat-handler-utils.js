export function normalizeErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "알 수 없는 서버 오류가 발생했습니다.");
}

export function mapErrorStatus(message) {
  const msg = String(message ?? "");
  if (
    msg.includes("Invalid JSON") ||
    msg.includes("JSON 본문 파싱") ||
    msg.includes("최소 1개 이상의 사용자 메시지")
  ) {
    return 400;
  }
  if (msg.includes("Method not allowed")) {
    return 405;
  }
  if (msg.includes("실거래 API HTTP 오류") || /^\[\d{2}\]/.test(msg)) {
    return 502;
  }
  return 500;
}

export function lastUserSnippet(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === "user") {
      return String(list[i]?.content ?? "").slice(0, 120);
    }
  }
  return "";
}
