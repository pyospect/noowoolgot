import { GoogleGenAI } from "@google/genai";

import { callEmbeddedMcpTool, listEmbeddedMcpTools } from "./embedded-mcp.js";

const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
const MAX_CONTEXT_MESSAGES = 20;
const MAX_TOOL_ROUNDS = 8;

const SYSTEM_INSTRUCTION = `너는 누울곳(Noowoolgot) 부동산 챗봇이다.
- 한국어로 짧고 정확하게, 부드러운 해요체로 답변한다.
- 실거래/지역코드 등 사실성 있는 질문은 제공된 도구(function)를 우선 사용한다.
- 도구 결과에 없는 수치/단지명/날짜는 추정해서 만들지 않는다.
- 도구를 호출하지 않았다면 사실처럼 보이는 정보성 답변을 만들지 말고, MCP 조회가 필요하다는 안내와 필요한 입력(지역/단지/기간) 요청만 제공한다.
- 지역/기간/유형 중 정보가 부족하면 필요한 항목만 한 번에 묶어서 질문한다.
- 면적(전용/계약/대지/건축 등)을 보여줄 때는 ㎡와 평을 함께 표기한다. 평수는 ㎡/3.305785로 계산해 소수점 첫째 자리까지 반올림한다.
- 사용자가 불만을 표현하면 짧게 사과한 뒤 재확인 또는 재조회 방법을 안내한다.
- 내부 구현이나 시스템 구조를 단정하지 않는다.`;

const TOOL_LABELS = {
  get_region_code: "지역 코드를 확인",
  get_current_year_month: "기준 연월을 확인",
  get_apartment_trades: "아파트 매매 실거래를 조회",
};

let geminiClient;
let functionDeclarations;
let functionDeclarationsPromise;

function normalizeEnvValue(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function getGeminiModel() {
  return normalizeEnvValue(process.env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
}

function getGeminiApiKey() {
  return (
    normalizeEnvValue(process.env.GEMINI_API_KEY) ||
    normalizeEnvValue(process.env.GOOGLE_API_KEY)
  );
}

function getGeminiClient() {
  if (geminiClient) {
    return geminiClient;
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY 또는 GOOGLE_API_KEY를 설정해 주세요.");
  }

  geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => message && typeof message === "object")
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: String(message.content ?? "").trim() }],
    }))
    .filter((message) => message.parts[0].text.length > 0)
    .slice(-MAX_CONTEXT_MESSAGES);
}

function lastUserMessage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === "user") {
      return String(list[i].content ?? "");
    }
  }
  return "";
}

function normalizeInputSchema(schema) {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    return schema;
  }
  return {
    type: "object",
    properties: {},
  };
}

async function getFunctionDeclarations() {
  if (functionDeclarations) {
    return functionDeclarations;
  }
  if (functionDeclarationsPromise) {
    return functionDeclarationsPromise;
  }

  functionDeclarationsPromise = (async () => {
    const tools = await listEmbeddedMcpTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      parametersJsonSchema: normalizeInputSchema(tool.inputSchema),
    }));
  })();

  try {
    functionDeclarations = await functionDeclarationsPromise;
    return functionDeclarations;
  } finally {
    functionDeclarationsPromise = undefined;
  }
}

function normalizeErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "알 수 없는 오류가 발생했습니다.");
}

function toolLabel(toolName) {
  return TOOL_LABELS[toolName] ?? `${toolName} 도구 실행`;
}

function summarizeArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return "";
  }

  const entries = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .slice(0, 3);

  if (entries.length === 0) {
    return "";
  }

  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(", ");
}

function sendEvent(onEvent, event) {
  if (typeof onEvent === "function") {
    onEvent(event);
  }
}

function extractModelParts(response) {
  return Array.isArray(response?.candidates?.[0]?.content?.parts)
    ? response.candidates[0].content.parts
    : [];
}

function extractFunctionCalls(response) {
  const modelParts = extractModelParts(response);
  return modelParts
    .map((part, index) => {
      const call = part?.functionCall;
      if (!call || typeof call.name !== "string" || call.name.length === 0) {
        return null;
      }

      return {
        id: call.id ?? `${Date.now()}-${index}-${call.name}`,
        name: call.name,
        args: call.args && typeof call.args === "object" ? call.args : {},
      };
    })
    .filter(Boolean);
}

function toFunctionResponsePayload(result, errorMessage) {
  if (errorMessage) {
    return {
      isError: true,
      error: errorMessage,
    };
  }

  if (result && typeof result === "object" && !Array.isArray(result)) {
    return {
      isError: false,
      ...result,
    };
  }

  return {
    isError: false,
    value: result ?? null,
  };
}

function formatPyeong(value) {
  const rounded = Math.round(value * 10) / 10;
  const minimumFractionDigits = Number.isInteger(rounded) ? 0 : 1;
  return rounded.toLocaleString("ko-KR", {
    minimumFractionDigits,
    maximumFractionDigits: 1,
  });
}

function appendPyeongToAreaText(answer) {
  const text = String(answer ?? "");
  if (!text) {
    return "";
  }

  const AREA_PATTERN = /(\d{1,4}(?:,\d{3})*(?:\.\d+)?)\s*(㎡|m²|m2|제곱미터)/gi;
  return text.replace(AREA_PATTERN, (match, value, _unit, offset, source) => {
    const sqm = Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(sqm) || sqm <= 0) {
      return match;
    }

    const tail = source.slice(offset + match.length, offset + match.length + 20);
    if (/^\s*\(\s*[\d.,]+\s*평\s*\)|^\s*[\d.,]+\s*평/.test(tail)) {
      return match;
    }

    const pyeong = formatPyeong(sqm / 3.305785);
    return `${match} (${pyeong}평)`;
  });
}

function buildNonMcpGuardAnswer() {
  return [
    "요청해 주셔서 감사해요. 이번에는 MCP 조회 결과가 아직 없어서 정확한 안내를 바로 드리기 어려워요.",
    "- 사실/수치/시세/날짜는 MCP 결과를 확인한 뒤에만 안내해드려요.",
    "- `지역 + 단지 + 기간` 중 가능한 항목을 함께 보내주시면 바로 조회해볼게요.",
    "",
    "예: `마포구 공덕래미안 최근 3개월 실거래가`, `강남구 2026년 2월 거래건수`",
  ].join("\n");
}

function nowInKstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

function currentDateLabelKst() {
  const now = nowInKstParts();
  return `${now.year}-${now.month}-${now.day}`;
}

function currentDateKoreanLabelKst() {
  const now = nowInKstParts();
  return `${Number(now.year)}년 ${Number(now.month)}월 ${Number(now.day)}일`;
}

function currentWeekdayKst() {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    weekday: "long",
  }).format(new Date());
}

function isDateQuestion(query) {
  const text = String(query ?? "");
  return /(오늘.*(며칠|몇일|날짜|무슨\s*날|요일)|오늘이?\s*몇|today|what.*date)/i.test(text);
}

function buildDateAnswer() {
  return `오늘은 ${currentDateKoreanLabelKst()} (${currentWeekdayKst()}, KST)이에요.`;
}

function isMcpStatusQuestion(query) {
  const text = String(query ?? "").toLowerCase();
  const keywords = [
    "mcp",
    "툴",
    "tool",
    "연결",
    "연동",
    "어떤 조회",
    "어떤 툴",
    "무슨 조회",
    "무슨 툴",
    "왜 다르",
    "로컬",
    "운영",
  ];
  return keywords.some((keyword) => text.includes(keyword));
}

function buildMcpStatusAnswer(tools) {
  const toolNames = Array.isArray(tools)
    ? tools
        .map((tool) => String(tool?.name ?? "").trim())
        .filter(Boolean)
        .join(", ")
    : "";

  return [
    "누울곳 서버 상태를 확인해봤어요.",
    "",
    `- 확인 시각(KST): ${currentDateLabelKst()}`,
    "- 현재 운영 경로: embedded-mcp예요.",
    `- 활성 MCP 도구: ${toolNames || "(없음)"}`,
  ].join("\n");
}

async function runChatWithTools(messages, onEvent) {
  const contents = normalizeMessages(messages);
  if (contents.length === 0) {
    throw new Error("최소 1개 이상의 사용자 메시지가 필요합니다.");
  }

  const ai = getGeminiClient();
  const tools = await getFunctionDeclarations();
  const toolsUsed = new Set();
  const conversation = [...contents];
  let modelVersion = getGeminiModel();

  sendEvent(onEvent, {
    type: "status",
    message: "질문을 분석하고 있어요.",
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await ai.models.generateContent({
      model: getGeminiModel(),
      contents: conversation,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2,
        thinkingConfig: {
          thinkingBudget: 0,
          includeThoughts: false,
        },
        tools: [{ functionDeclarations: tools }],
        automaticFunctionCalling: {
          disable: true,
        },
      },
    });

    modelVersion = response.modelVersion ?? modelVersion;
    const modelParts = extractModelParts(response);
    const functionCalls = extractFunctionCalls(response);

    if (functionCalls.length === 0) {
      const answer =
        toolsUsed.size > 0
          ? appendPyeongToAreaText(
              response.text?.trim() ??
                "응답을 생성하지 못했습니다. 질문을 조금 더 구체적으로 작성해 주세요."
            )
          : buildNonMcpGuardAnswer();
      return {
        answer,
        toolsUsed: [...toolsUsed].map((name) => toolLabel(name)),
        responseMode: toolsUsed.size > 0 ? "mcp" : "general",
        modelVersion,
      };
    }

    conversation.push({ role: "model", parts: modelParts });

    for (const call of functionCalls) {
      const label = toolLabel(call.name);
      const detail = summarizeArgs(call.args);
      toolsUsed.add(call.name);

      sendEvent(onEvent, {
        type: "tool_start",
        message: `${label} 중...`,
        detail,
      });

      let toolResult = null;
      let toolErrorMessage = "";

      try {
        toolResult = await callEmbeddedMcpTool(call.name, call.args);
      } catch (error) {
        toolErrorMessage = normalizeErrorMessage(error);
      }

      conversation.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              id: call.id,
              name: call.name,
              response: toFunctionResponsePayload(toolResult, toolErrorMessage),
            },
          },
        ],
      });

      sendEvent(onEvent, {
        type: "tool_done",
        message: toolErrorMessage ? `${label} 실패` : `${label} 완료`,
      });
    }
  }

  throw new Error("도구 호출 단계가 너무 길어 중단했습니다. 질문 범위를 좁혀 다시 시도해 주세요.");
}

export async function runChat(messages, onEvent) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const query = lastUserMessage(safeMessages);

  if (!query.trim()) {
    throw new Error("최소 1개 이상의 사용자 메시지가 필요합니다.");
  }

  if (isDateQuestion(query)) {
    sendEvent(onEvent, { type: "tool_start", message: "한국 시간 기준 날짜를 확인 중..." });
    const answer = buildDateAnswer();
    sendEvent(onEvent, { type: "tool_done", message: "현재 날짜 확인 완료" });
    return {
      answer,
      toolsUsed: ["현재 날짜 확인"],
      responseMode: "system",
      modelVersion: "deterministic-kst",
    };
  }

  if (isMcpStatusQuestion(query)) {
    sendEvent(onEvent, { type: "tool_start", message: "시스템 상태를 확인 중..." });
    let tools = [];
    try {
      tools = await listEmbeddedMcpTools();
    } catch {
      tools = [];
    }
    sendEvent(onEvent, { type: "tool_done", message: "시스템 상태 확인 완료" });
    return {
      answer: buildMcpStatusAnswer(tools),
      toolsUsed: ["시스템 상태 확인"],
      responseMode: "system",
      modelVersion: "diagnostic",
    };
  }

  if (!getGeminiApiKey()) {
    return {
      answer: "일반 대화 응답을 위해 GEMINI_API_KEY(또는 GOOGLE_API_KEY)가 필요해요.",
      toolsUsed: ["설정 확인"],
      responseMode: "system",
      modelVersion: "config-check",
    };
  }

  return await runChatWithTools(safeMessages, onEvent);
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("JSON 본문 파싱에 실패했습니다."));
      }
    });
    req.on("error", reject);
  });
}
