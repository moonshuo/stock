import { NextResponse } from "next/server";
import { getAgentCatalog } from "../../../../lib/agent-context.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try {
    return NextResponse.json(await getAgentCatalog(new URL(request.url).searchParams.get("date")));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

