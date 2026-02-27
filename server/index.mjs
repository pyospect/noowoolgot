import path from "node:path";
import process from "node:process";

import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 8787);
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
const MCP_DIRECTORY = process.env.REAL_ESTATE_MCP_DIR
  ? path.resolve(process.env.REAL_ESTATE_MCP_DIR)
  : path.resolve(process.cwd(), "../real-estate-mcp");
const MCP_COMMAND = process.env.MCP_COMMAND ?? "uv";

const SYSTEM_INSTRUCTION = `너는 누울곳(Noowoolgot) 부동산 정보 챗봇이다.
- 한국어로 명확하고 간결하게 답변한다.
- 실거래/전월세/청약/온비드/지역코드 관련 사실 질문은 MCP 도구를 우선 사용한다.
- 지역명이 모호하면 먼저 가능한 지역 후보를 보여주고 사용자 확인을 요청한다.
- 숫자 요약(최저/최고/평균/건수)과 핵심 인사이트를 함께 제시한다.
- 데이터가 없거나 오류가 나면 원인과 재시도 방법을 안내한다.`;

const TOOL_LABELS = {
  get_region_code: "지역 코드를 확인",
  get_current_year_month: "기준 연월을 확인",
  get_apartment_trades: "아파트 매매 실거래를 조회",
  get_apartment_rent: "아파트 전월세 실거래를 조회",
  get_officetel_trades: "오피스텔 매매 실거래를 조회",
  get_officetel_rent: "오피스텔 전월세 실거래를 조회",
  get_villa_trades: "빌라/연립다세대 매매 실거래를 조회",
  get_villa_rent: "빌라/연립다세대 전월세 실거래를 조회",
  get_single_house_trades: "단독/다가구 매매 실거래를 조회",
  get_single_house_rent: "단독/다가구 전월세 실거래를 조회",
  get_commercial_trade: "상업용 건물 매매 실거래를 조회",
  get_apt_subscription_info: "아파트 청약 공고를 조회",
  get_apt_subscription_results: "아파트 청약 결과를 조회",
  get_public_auction_items: "공매 입찰 결과를 조회",
  get_onbid_thing_info_list: "온비드 공매 물건을 조회",
  get_onbid_ctgr_mid_sm_code_info: "온비드 용도 코드를 조회",
  get_onbid_dpsl_mtd_code_info: "온비드 처분 방식 코드를 조회",
  get_onbid_addr1_info: "온비드 주소(시도) 코드를 조회",
  get_onbid_addr2_info: "온비드 주소(시군구) 코드를 조회",
  get_onbid_addr3_info: "온비드 주소(읍면동) 코드를 조회",
};

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

let geminiClient;
let mcpConnection;
let mcpConnectionPromise;
let mcpFunctionDeclarations;

function getGeminiClient() {
  if (geminiClient) {
    return geminiClient;
  }

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY 또는 GOOGLE_API_KEY를 설정해 주세요.");
  }

  geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
}

function parseMcpArgs(rawValue) {
  if (!rawValue || typeof rawValue !== "string") {
    return [
      "run",
      "--directory",
      MCP_DIRECTORY,
      "python",
      "src/real_estate/mcp_server/server.py",
    ];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    return rawValue.split(" ").filter(Boolean);
  }

  return [
    "run",
    "--directory",
    MCP_DIRECTORY,
    "python",
    "src/real_estate/mcp_server/server.py",
  ];
}

function getMcpEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
}

async function connectMcp() {
  if (mcpConnection) {
    return mcpConnection;
  }
  if (mcpConnectionPromise) {
    return mcpConnectionPromise;
  }

  mcpConnectionPromise = (async () => {
    const transport = new StdioClientTransport({
      command: MCP_COMMAND,
      args: parseMcpArgs(process.env.MCP_ARGS),
      env: getMcpEnv(),
      stderr: "pipe",
      cwd: process.cwd(),
    });

    const stderr = transport.stderr;
    if (stderr) {
      stderr.on("data", (chunk) => {
        const line = String(chunk).trim();
        if (line.length > 0) {
          console.error(`[real-estate-mcp] ${line}`);
        }
      });
    }

    const client = new Client({
      name: "noowoolgot-client",
      version: "1.0.0",
    });

    try {
      await client.connect(transport);
    } catch (error) {
      const code = typeof error === "object" && error ? error.code : undefined;
      if (code === "ENOENT" && MCP_COMMAND === "uv") {
        throw new Error(
          "`uv` 명령을 찾을 수 없습니다. https://docs.astral.sh/uv/getting-started/installation/ 를 참고해 uv를 설치해 주세요."
        );
      }
      throw error;
    }

    const connection = { client, transport };
    mcpConnection = connection;
    return connection;
  })();

  try {
    return await mcpConnectionPromise;
  } finally {
    mcpConnectionPromise = undefined;
  }
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
    .slice(-20);
}

function toolLabel(toolName) {
  return TOOL_LABELS[toolName] ?? "필요한 부동산 데이터를 조회";
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

function normalizeToolResultForModel(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  return {
    isError: Boolean(result?.isError),
    structuredContent: result?.structuredContent ?? null,
    content,
  };
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

async function getMcpFunctionDeclarations(client) {
  if (mcpFunctionDeclarations) {
    return mcpFunctionDeclarations;
  }

  const toolsResponse = await client.listTools();
  mcpFunctionDeclarations = toolsResponse.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    parametersJsonSchema: normalizeInputSchema(tool.inputSchema),
  }));
  return mcpFunctionDeclarations;
}

function sendStreamEvent(sendEvent, event) {
  if (typeof sendEvent === "function") {
    sendEvent(event);
  }
}

async function runChatWithTools(messages, sendEvent) {
  if (!process.env.DATA_GO_KR_API_KEY) {
    throw new Error("DATA_GO_KR_API_KEY가 없습니다. real-estate-mcp 실행을 위해 필요합니다.");
  }

  const contents = normalizeMessages(messages);
  if (contents.length === 0) {
    throw new Error("최소 1개 이상의 메시지가 필요합니다.");
  }

  const ai = getGeminiClient();
  const { client } = await connectMcp();
  const functionDeclarations = await getMcpFunctionDeclarations(client);
  const toolsUsed = new Set();

  sendStreamEvent(sendEvent, {
    type: "status",
    message: "질문을 분석하고 필요한 데이터를 정리하는 중이에요.",
  });

  const conversation = [...contents];
  let modelVersion = GEMINI_MODEL;
  const maxRounds = 8;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: conversation,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2,
        thinkingConfig: {
          thinkingBudget: 0,
          includeThoughts: false,
        },
        tools: [{ functionDeclarations }],
        automaticFunctionCalling: {
          disable: true,
        },
      },
    });

    modelVersion = response.modelVersion ?? modelVersion;
    const modelParts = Array.isArray(response?.candidates?.[0]?.content?.parts)
      ? response.candidates[0].content.parts
      : [];
    const functionCalls = modelParts
      .map((part) => part?.functionCall)
      .filter((call) => typeof call?.name === "string" && call.name.length > 0);

    if (functionCalls.length === 0) {
      const answer =
        response.text?.trim() ??
        "응답을 생성하지 못했습니다. 입력 문장을 조금 더 구체적으로 작성해 주세요.";

      return {
        answer,
        toolsUsed: [...toolsUsed].map((toolName) => toolLabel(toolName)),
        modelVersion,
      };
    }

    const normalizedCalls = functionCalls.map((call, index) => ({
      id: call.id ?? `${Date.now()}-${index}-${call.name}`,
      name: call.name,
      args: call.args ?? {},
    }));

    conversation.push({ role: "model", parts: modelParts });

    for (const call of normalizedCalls) {
      const friendlyLabel = toolLabel(call.name);
      const argsSummary = summarizeArgs(call.args);
      toolsUsed.add(call.name);

      sendStreamEvent(sendEvent, {
        type: "tool_start",
        message: `${friendlyLabel} 중...`,
        detail: argsSummary,
      });

      let toolResult;
      try {
        toolResult = await client.callTool({
          name: call.name,
          arguments: call.args,
        });
      } catch (error) {
        toolResult = {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : "도구 실행 중 알 수 없는 오류가 발생했습니다.",
            },
          ],
        };
      }

      conversation.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              id: call.id,
              name: call.name,
              response: normalizeToolResultForModel(toolResult),
            },
          },
        ],
      });

      sendStreamEvent(sendEvent, {
        type: "tool_done",
        message: `${friendlyLabel} 완료`,
      });
    }
  }

  throw new Error("도구 호출 단계가 너무 길어 중단했습니다. 질문 범위를 조금 좁혀서 다시 시도해 주세요.");
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: GEMINI_MODEL,
    mcpDirectory: MCP_DIRECTORY,
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
    hasDataGoKrKey: Boolean(process.env.DATA_GO_KR_API_KEY),
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const result = await runChatWithTools(req.body?.messages);
    return res.json(result);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "알 수 없는 서버 오류가 발생했습니다.";
    const statusCode =
      message.includes("DATA_GO_KR_API_KEY") || message.includes("최소 1개 이상의 메시지")
        ? 400
        : 500;
    return res.status(statusCode).json({ error: message });
  }
});

app.post("/api/chat/stream", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    const result = await runChatWithTools(req.body?.messages, sendEvent);
    sendEvent({
      type: "final",
      ...result,
    });
  } catch (error) {
    console.error(error);
    sendEvent({
      type: "error",
      message: error instanceof Error ? error.message : "알 수 없는 서버 오류가 발생했습니다.",
    });
  } finally {
    res.end();
  }
});

const server = app.listen(API_PORT, () => {
  console.log(`Noowoolgot API server listening on http://localhost:${API_PORT}`);
});

async function shutdown() {
  server.close();
  if (mcpConnection?.client) {
    try {
      await mcpConnection.client.close();
    } catch {
      // ignore
    }
  }
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
