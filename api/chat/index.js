import { readJsonBody, runChat } from "../_lib/chat-core.js";
import { lastUserSnippet, mapErrorStatus, normalizeErrorMessage } from "../_lib/chat-handler-utils.js";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  const startedAt = Date.now();
  const requestId = String(req.headers["x-vercel-id"] ?? req.headers["x-request-id"] ?? "");

  if (req.method !== "POST") {
    console.warn(
      JSON.stringify({
        level: "warn",
        route: "/api/chat",
        requestId,
        method: req.method,
        status: 405,
        message: "Method not allowed",
      })
    );
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const messages = body?.messages ?? [];
    const traceEvents = [];
    const result = await runChat(messages, (event) => {
      traceEvents.push(event?.message ?? event?.type ?? "event");
    });

    console.info(
      JSON.stringify({
        level: "info",
        route: "/api/chat",
        requestId,
        method: req.method,
        status: 200,
        durationMs: Date.now() - startedAt,
        toolsUsed: result?.toolsUsed ?? [],
        modelVersion: result?.modelVersion ?? null,
        messageCount: Array.isArray(messages) ? messages.length : 0,
        lastUser: lastUserSnippet(messages),
        trace: traceEvents.slice(0, 10),
      })
    );

    res.status(200).json(result);
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const status = mapErrorStatus(message);

    console.error(
      JSON.stringify({
        level: "error",
        route: "/api/chat",
        requestId,
        method: req.method,
        status,
        durationMs: Date.now() - startedAt,
        error: message,
      })
    );

    res.status(status).json({
      error: message,
    });
  }
}
