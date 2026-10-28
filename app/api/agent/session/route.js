import { NextResponse } from "next/server";
import { getChatGptSession } from "../../../../lib/agent-auth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getChatGptSession());
  } catch (error) {
    return NextResponse.json({ authenticated: false, plan_usage_enabled: false, error: error.message }, { status: 500 });
  }
}

