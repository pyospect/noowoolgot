import fs from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { XMLParser } from "fast-xml-parser";
import * as z from "zod/v4";

const REGION_CODES = JSON.parse(
  fs.readFileSync(new URL("../data/region-codes.json", import.meta.url), "utf8")
);

const XML = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
});

const DATA_GO_KR_REQUEST_HEADERS = {
  "User-Agent": "noowoolgot/1.0 (+https://noowoolgot.vercel.app)",
  Accept: "application/xml,text/xml,*/*;q=0.1",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  Connection: "keep-alive",
};

const RESULT_CODE_MESSAGES = {
  "01": "서비스 제공 기관 오류가 발생했습니다.",
  "02": "데이터베이스 오류가 발생했습니다.",
  "03": "조회된 데이터가 없습니다.",
  "04": "HTTP 오류가 발생했습니다.",
  "05": "서비스 응답 시간이 초과되었습니다.",
  "10": "요청 파라미터가 올바르지 않습니다.",
  "11": "필수 파라미터가 누락되었습니다.",
  "12": "요청한 API 서비스 URL을 다시 확인해 주세요.",
  "20": "활용신청 승인 전이거나 권한이 없습니다.",
  "22": "일일 호출 한도를 초과했습니다.",
  "30": "등록되지 않은 서비스키이거나 인코딩 형식이 잘못되었습니다.",
  "31": "만료된 서비스키입니다.",
  "32": "등록된 도메인 또는 IP 제한과 호출 환경이 일치하지 않습니다.",
};

const STATION_REGION_ALIASES = [
  { station: "증미역", regionHint: "서울특별시 강서구" },
  { station: "염창역", regionHint: "서울특별시 강서구" },
  { station: "가양역", regionHint: "서울특별시 강서구" },
  { station: "당산역", regionHint: "서울특별시 영등포구" },
  { station: "여의도역", regionHint: "서울특별시 영등포구" },
  { station: "강남역", regionHint: "서울특별시 강남구" },
  { station: "역삼역", regionHint: "서울특별시 강남구" },
  { station: "선릉역", regionHint: "서울특별시 강남구" },
  { station: "잠실역", regionHint: "서울특별시 송파구" },
  { station: "홍대입구역", regionHint: "서울특별시 마포구" },
  { station: "합정역", regionHint: "서울특별시 마포구" },
  { station: "공덕역", regionHint: "서울특별시 마포구" },
  { station: "신림역", regionHint: "서울특별시 관악구" },
  { station: "노원역", regionHint: "서울특별시 노원구" },
];

let runtimePromise;

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function normalizeEnvValue(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function normalizeApiKey(rawKey) {
  const key = normalizeEnvValue(rawKey);
  if (!key) {
    return "";
  }

  try {
    if (/%[0-9A-Fa-f]{2}/.test(key)) {
      return decodeURIComponent(key);
    }
  } catch {
    // ignore invalid encoded key
  }

  return key;
}

function findRegion(query) {
  const q = normalize(query);
  if (!q) return null;

  let best = null;
  for (const region of REGION_CODES) {
    const full = normalize(region.name);
    const short = normalize(region.short);
    const last = normalize(region.short.split(" ").at(-1));
    const candidates = [full, short, last].filter(Boolean);

    for (const token of candidates) {
      if (q.includes(token)) {
        const score = token.length;
        if (!best || score > best.score) {
          best = { ...region, score };
        }
      }
    }
  }

  return best ? { code: best.code, name: best.name } : null;
}

function findRegionByStationAlias(query) {
  const q = normalize(query);
  if (!q) {
    return null;
  }

  for (const alias of STATION_REGION_ALIASES) {
    if (q.includes(normalize(alias.station))) {
      return findRegion(alias.regionHint);
    }
  }

  return null;
}

function findRegionInText(query) {
  return findRegion(query) ?? findRegionByStationAlias(query);
}

function currentYearMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}${month}`;
}

async function fetchApartmentTrades({ regionCode, yearMonth, serviceKey }) {
  const url = new URL(
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"
  );
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("LAWD_CD", regionCode);
  url.searchParams.set("DEAL_YMD", yearMonth);
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("pageNo", "1");

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: DATA_GO_KR_REQUEST_HEADERS,
  });

  if (!response.ok) {
    const text = await response.text();
    const compact = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(
      compact
        ? `실거래 API HTTP 오류: ${response.status} (${compact})`
        : `실거래 API HTTP 오류: ${response.status}`
    );
  }

  const xml = await response.text();
  const parsed = XML.parse(xml);
  const root = parsed?.response ?? parsed;

  const resultCode = String(root?.header?.resultCode ?? "").trim();
  const resultMsg = String(root?.header?.resultMsg ?? "").trim();
  if (resultCode && resultCode !== "000") {
    const detail = RESULT_CODE_MESSAGES[resultCode] ?? (resultMsg || "실거래 API 오류가 발생했습니다.");
    throw new Error(`[${resultCode}] ${detail}`);
  }

  const itemNode = root?.body?.items?.item;
  const items = Array.isArray(itemNode) ? itemNode : itemNode ? [itemNode] : [];
  const totalCount = Number(root?.body?.totalCount ?? items.length ?? 0);
  return { totalCount, items };
}

function normalizeToolPayload(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const textPart = Array.isArray(result?.content)
    ? result.content.find((part) => part?.type === "text" && typeof part?.text === "string")
    : null;
  if (!textPart?.text) {
    return null;
  }
  try {
    return JSON.parse(textPart.text);
  } catch {
    return null;
  }
}

async function createRuntime() {
  const server = new McpServer({
    name: "noowoolgot-embedded-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "get_region_code",
    {
      description: "질문에서 시군구 코드를 찾습니다.",
      inputSchema: {
        query: z.string().describe("사용자 질문 또는 지역명"),
      },
    },
    async ({ query }) => {
      const region = findRegionInText(query);
      return {
        structuredContent: { region },
        content: [{ type: "text", text: JSON.stringify({ region }) }],
      };
    }
  );

  server.registerTool(
    "get_current_year_month",
    {
      description: "한국 시간 기준 현재 연월(YYYYMM)을 반환합니다.",
    },
    async () => {
      const yearMonth = currentYearMonth();
      return {
        structuredContent: { yearMonth },
        content: [{ type: "text", text: JSON.stringify({ yearMonth }) }],
      };
    }
  );

  server.registerTool(
    "get_apartment_trades",
    {
      description: "국토부 아파트 매매 실거래를 조회합니다.",
      inputSchema: {
        regionCode: z.string().describe("법정동 시군구 코드 5자리"),
        yearMonth: z.string().describe("조회 연월 YYYYMM"),
      },
    },
    async ({ regionCode, yearMonth }) => {
      const serviceKey = normalizeApiKey(process.env.DATA_GO_KR_API_KEY);
      if (!serviceKey) {
        throw new Error("DATA_GO_KR_API_KEY 환경변수가 필요합니다.");
      }
      const trades = await fetchApartmentTrades({ regionCode, yearMonth, serviceKey });
      return {
        structuredContent: trades,
        content: [{ type: "text", text: JSON.stringify(trades) }],
      };
    }
  );

  const client = new Client({
    name: "noowoolgot-embedded-mcp-client",
    version: "1.0.0",
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return { server, client };
}

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = createRuntime();
  }
  return runtimePromise;
}

export async function callEmbeddedMcpTool(name, args) {
  const { client } = await getRuntime();
  const result = await client.callTool({
    name,
    arguments: args,
  });
  if (result?.isError) {
    const text = Array.isArray(result.content)
      ? result.content
          .filter((part) => part?.type === "text")
          .map((part) => part.text)
          .join(" ")
      : "MCP 도구 실행 중 오류가 발생했습니다.";
    throw new Error(text || "MCP 도구 실행 중 오류가 발생했습니다.");
  }
  return normalizeToolPayload(result);
}

export async function listEmbeddedMcpTools() {
  const { client } = await getRuntime();
  const tools = await client.listTools();
  return Array.isArray(tools?.tools) ? tools.tools : [];
}
