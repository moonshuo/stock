import { buildAgentQuestionText, collectAgentContext } from "../../../../lib/agent-context.js";
import { getChatGptAccessToken } from "../../../../lib/agent-auth.js";
import { buildResponsesRequest, parseSseFrames } from "../../../../lib/agent-chat.js";
import { assertLocalAgentRequest } from "../../../../lib/agent-request.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function event(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request) {
  try {
    assertLocalAgentRequest(request, { json: true });
    const body = await request.json();
    const questionText = buildAgentQuestionText(body.question, body.history);
    const { context } = await collectAgentContext(body.selection || {}, {
      origin: new URL(request.url).origin,
      questionText,
    });
    const requestBody = buildResponsesRequest({
      model: body.model,
      question: body.question,
      history: body.history,
      context,
    });
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getChatGptAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      const payload = await upstream.json().catch(() => ({}));
      const message = payload?.error?.message || payload?.detail || `OpenAI 请求失败：HTTP ${upstream.status}`;
      return new Response(JSON.stringify({ error: message }), { status: upstream.status, headers: { "Content-Type": "application/json" } });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body.getReader();
        let pending = "";
        let completed = false;
        try {
          while (true) {
            const { value, done } = await reader.read();
            pending += decoder.decode(value || new Uint8Array(), { stream: !done });
            const parsed = parseSseFrames(pending);
            pending = parsed.rest;
            for (const frame of parsed.frames) {
              const data = frame.split("\n").filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim()).join("\n");
              if (!data || data === "[DONE]") continue;
              let payload;
              try { payload = JSON.parse(data); } catch { continue; }
              if (payload.type === "response.output_text.delta") {
                controller.enqueue(encoder.encode(event("delta", { delta: payload.delta || "" })));
              } else if (payload.type === "response.completed") {
                completed = true;
                controller.enqueue(encoder.encode(event("completed", { ok: true })));
              } else if (payload.type === "response.failed" || payload.type === "error") {
                const error = payload.response?.error || payload.error || payload;
                controller.enqueue(encoder.encode(event("error", { code: error.code, message: error.message || "模型请求失败" })));
              }
            }
            if (done) break;
          }
          if (!completed) controller.enqueue(encoder.encode(event("error", { message: "模型流在完成事件之前结束" })));
        } catch (error) {
          controller.enqueue(encoder.encode(event("error", { message: error.message })));
        } finally {
          controller.close();
        }
      },
      cancel() {
        upstream.body.cancel().catch(() => {});
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
}
