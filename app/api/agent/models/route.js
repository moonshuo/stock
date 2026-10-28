import { NextResponse } from "next/server";
import { getChatGptAccessToken } from "../../../../lib/agent-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${await getChatGptAccessToken()}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: payload?.error?.message || payload?.detail || `模型列表读取失败：HTTP ${response.status}` }, { status: response.status });
    const source = Array.isArray(payload.models) ? payload.models : Array.isArray(payload.data) ? payload.data : [];
    const models = source.filter((item) => item.visibility === undefined || item.visibility === "list")
      .map((item) => ({ id: item.slug || item.id, name: item.display_name || item.name || item.slug || item.id }))
      .filter((item) => item.id);
    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
}

