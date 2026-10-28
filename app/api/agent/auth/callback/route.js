import { NextResponse } from "next/server";
import { completeChatGptAuthorization } from "../../../../../lib/agent-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const destination = new URL("/", request.url);
  destination.searchParams.set("agent", "1");
  try {
    await completeChatGptAuthorization(request.url);
    destination.searchParams.set("auth", "success");
  } catch (error) {
    destination.searchParams.set("auth", "error");
    destination.searchParams.set("message", String(error.message || "登录失败").slice(0, 240));
  }
  return NextResponse.redirect(destination);
}
