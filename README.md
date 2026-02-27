# Noowoolgot (누울곳)

Gemini 3 + [`real-estate-mcp`](https://github.com/tae0y/real-estate-mcp) 기반 한국 부동산 정보 챗봇입니다.

## 1) 준비

1. `real-estate-mcp`를 로컬에 클론합니다.
2. `.env.example`를 참고해 `.env.local`을 채웁니다.

```bash
cp .env.example .env.local
```

필수 값:

- `GEMINI_API_KEY`
- `DATA_GO_KR_API_KEY`
- `REAL_ESTATE_MCP_DIR` (`real-estate-mcp` 경로)

## 2) 실행

```bash
npm install
npm run dev
```

- 웹: `http://localhost:5173`
- API: `http://localhost:8787`

## 3) 구조

- 프론트 챗 UI: `src/App.tsx`
- 백엔드 API + MCP 연결: `server/index.mjs`

## 참고 문서

- Gemini JS SDK: <https://googleapis.github.io/js-genai/>
- Gemini Function Calling + MCP: <https://ai.google.dev/gemini-api/docs/function-calling>
- Gemini 모델 목록: <https://ai.google.dev/gemini-api/docs/models>
- real-estate-mcp: <https://github.com/tae0y/real-estate-mcp>
