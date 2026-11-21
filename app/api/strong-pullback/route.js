import { NextResponse } from "next/server";
import { analyzeMainlines } from "../../../lib/mainline.js";
import { analyzeStrongPullbacks, readStrongPullbackSnapshot, saveStrongPullbackSnapshot } from "../../../lib/strong-pullback/service.js";
import { loadDailyMarket, runDailyMarketTask } from "../daily-market/route.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function booleanParam(value) {
  if (value === null) return undefined;
  return value === "1" || value === "true";
}

async function evaluate(options) {
  return runDailyMarketTask(() => analyzeStrongPullbacks({ ...options, loadDailyMarket, analyzeMainlines }));
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const date = params.get("date") || "";
  try {
    if (params.get("saved") === "1") return NextResponse.json(await readStrongPullbackSnapshot(date));
    return NextResponse.json(await evaluate({
      date,
      requestedMode: params.get("mode") || "auto",
      sortBy: params.get("sort") || "score",
      displayFilterEnabled: booleanParam(params.get("green_filter")),
      code: params.get("code") || "",
      resultLimit: Number(params.get("limit") || 200),
    }));
  } catch (error) {
    return NextResponse.json({ error: `缩量回调评分失败：${error.message}` }, { status: 400 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await evaluate({
      date: body.date,
      requestedMode: body.mode || "auto",
      configOverride: body.config || {},
      sortBy: body.sort || "score",
      displayFilterEnabled: body.green_filter,
      code: body.code || "",
      resultLimit: body.action === "save_snapshot" ? null : Number(body.limit || 200),
    });
    if (body.action === "save_snapshot") {
      const savedSnapshot = await saveStrongPullbackSnapshot(result);
      return NextResponse.json({ date: result.date, summary: result.summary, saved_snapshot: savedSnapshot });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: `缩量回调评分失败：${error.message}` }, { status: 400 });
  }
}
