import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FILE_PATH = path.join(process.cwd(), "data", "market_research_progress.json");

async function readProgress() {
  try {
    const value = JSON.parse(await readFile(FILE_PATH, "utf8"));
    return { version: "1.0", completed: value?.completed || {} };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: "1.0", completed: {} };
    throw error;
  }
}

async function writeProgress(progress) {
  await mkdir(path.dirname(FILE_PATH), { recursive: true });
  const temporaryPath = `${FILE_PATH}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
  await rename(temporaryPath, FILE_PATH);
}

export async function GET() {
  try {
    return NextResponse.json(await readProgress());
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const codes = Array.from(new Set((payload.codes || []).map((code) => String(code).replace(/\D/g, "")).filter((code) => /^\d{6}$/.test(code))));
    if (!codes.length || codes.length > 100) {
      return NextResponse.json({ error: "codes 必须是 1 至 100 个六位股票代码" }, { status: 400 });
    }
    const progress = await readProgress();
    const completedAt = new Date().toISOString();
    for (const code of codes) {
      progress.completed[code] = { completed_at: completedAt, batch_id: String(payload.batch_id || "") };
    }
    await writeProgress(progress);
    return NextResponse.json({ ok: true, completed: progress.completed, completedCount: Object.keys(progress.completed).length });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
