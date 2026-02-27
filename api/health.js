export const config = {};

function normalizeEnvValue(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

export default function handler(_req, res) {
  const model = normalizeEnvValue(process.env.GEMINI_MODEL) || "gemini-3-flash-preview";
  const geminiKey =
    normalizeEnvValue(process.env.GEMINI_API_KEY) || normalizeEnvValue(process.env.GOOGLE_API_KEY);
  const dataKey = normalizeEnvValue(process.env.DATA_GO_KR_API_KEY);

  res.status(200).json({
    ok: true,
    model,
    hasGeminiKey: Boolean(geminiKey),
    hasDataGoKrKey: Boolean(dataKey),
    mode: "vercel-serverless",
  });
}
