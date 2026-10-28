import { NextResponse } from "next/server";
import { beginChatGptAuthorization } from "../../../../../lib/agent-auth.js";
import { assertLocalAgentRequest } from "../../../../../lib/agent-request.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    assertLocalAgentRequest(request);
    return NextResponse.json({ authorization_url: await beginChatGptAuthorization(request.url) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
