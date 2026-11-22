import { getChatGptAccessToken } from "./agent-auth.js";

const OPENAI_URL = "https://api.openai.com/v1";

export function resolveLlmConfig(options = {}) {
  const env = options.env ?? process.env;
  const apiKey = (options.apiKey ?? env.OPENAI_API_KEY ?? "").trim();
  const provider = options.provider ?? (apiKey ? "openai" : "chatgpt_oauth");
  if (!["openai", "chatgpt_oauth"].includes(provider)) throw new Error("Unknown LLM provider");
  const oauth = provider === "chatgpt_oauth";
  if (!oauth && !apiKey) throw new Error("OPENAI_API_KEY is required");
  const apiMode = oauth ? "responses" : options.apiMode ?? "chat_completions";
  if (!["chat_completions", "responses"].includes(apiMode)) throw new Error("Unknown API mode");
  return {
    provider, apiMode,
    model: options.model || env.OPENAI_MODEL || "gpt-4.1-mini",
    baseUrl: oauth ? OPENAI_URL : (options.baseUrl || env.OPENAI_BASE_URL || OPENAI_URL).replace(/\/+$/, ""),
    apiKey: oauth ? undefined : apiKey,
    timeoutMs: options.timeoutMs ?? 30000,
  };
}

export async function buildLlmRequest(params = {}) {
  const { provider, apiMode, baseUrl, model, apiKey } = resolveLlmConfig(params);
  const { messages, responseFormat } = params;
  if (!Array.isArray(messages) || !messages.length) throw new Error("messages must be a non-empty array");
  const token = apiKey ?? await (params.getAccessToken ?? getChatGptAccessToken)();
  if (!token) throw new Error("Missing ChatGPT access token");
  const responses = apiMode === "responses";
  const body = responses ? { model, input: messages, store: false } : { model, messages };
  if (responseFormat === "json") {
    const format = { type: "json_object" };
    if (responses) body.text = { format };
    else body.response_format = format;
  }
  return {
    provider, model, apiMode,
    url: baseUrl + (responses ? "/responses" : "/chat/completions"),
    init: {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

export async function invokeLlm(params = {}) {
  const { url, init, provider, model, apiMode } = await buildLlmRequest(params);
  const response = await (params.fetch ?? globalThis.fetch)(url, {
    ...init, signal: AbortSignal.timeout(params.timeoutMs ?? 30000),
  });
  const payload = await response.text();
  if (!response.ok) {
    let detail = payload;
    try { detail = JSON.parse(payload)?.error?.message || payload; }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    throw Object.assign(new Error(`HTTP ${response.status}: ${detail}`), { status: response.status });
  }
  const raw = JSON.parse(payload);
  const text = apiMode === "chat_completions" ? raw.choices?.[0]?.message?.content :
    raw.output_text ?? raw.output?.flatMap(item => item.content ?? [])
      .filter(part => part.type === "output_text").map(part => part.text).join("");
  if (typeof text !== "string" || !text.length) throw new Error("LLM response contains no text");
  const json = params.responseFormat === "json" ? JSON.parse(text) : null;
  return { text, json, model: raw.model ?? model, provider, usage: raw.usage ?? null, raw };
}
