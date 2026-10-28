import { NextResponse } from "next/server";
import { collectAgentContext } from "../../../../lib/agent-context.js";
import { assertLocalAgentRequest } from "../../../../lib/agent-request.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    assertLocalAgentRequest(request, { json: true });
    return NextResponse.json(await collectAgentContext(await request.json(), { origin: new URL(request.url).origin }));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
