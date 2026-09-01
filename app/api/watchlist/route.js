import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WATCHLIST_PATH = path.join(process.cwd(), "data", "watchlist.json");

function normalizeCode(value = "") {
  const code = String(value).replace(/\D/g, "");
  return /^\d{6}$/.test(code) ? code : "";
}

function normalizeWatchlist(value) {
  const stocks = Array.isArray(value?.stocks) ? value.stocks : [];
  const byCode = new Map();
  for (const stock of stocks) {
    const code = normalizeCode(stock?.code);
    if (!code) continue;
    const relatedByCode = new Map();
    for (const related of Array.isArray(stock?.relatedStocks) ? stock.relatedStocks : []) {
      const relatedCode = normalizeCode(related?.code);
      if (!relatedCode || relatedCode === code) continue;
      relatedByCode.set(relatedCode, {
        code: relatedCode,
        name: String(related?.name || `股票${relatedCode}`).trim() || `股票${relatedCode}`,
        note: String(related?.note || "").slice(0, 200)
      });
    }
    byCode.set(code, {
      code,
      name: String(stock?.name || `股票${code}`).trim() || `股票${code}`,
      addedAt: String(stock?.addedAt || new Date().toISOString()),
      relatedStocks: Array.from(relatedByCode.values())
    });
  }
  return Array.from(byCode.values());
}

async function writeWatchlist(stocks) {
  await mkdir(path.dirname(WATCHLIST_PATH), { recursive: true });
  const tempPath = `${WATCHLIST_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ version: "1.0", stocks }, null, 2)}\n`, "utf8");
  await rename(tempPath, WATCHLIST_PATH);
}

export async function GET() {
  try {
    const payload = JSON.parse(await readFile(WATCHLIST_PATH, "utf8"));
    return NextResponse.json({ stocks: normalizeWatchlist(payload) });
  } catch (error) {
    if (error?.code === "ENOENT") return NextResponse.json({ stocks: [] });
    return NextResponse.json({ error: `读取观察池失败：${error.message}` }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const stocks = normalizeWatchlist({ stocks: payload.stocks });
    await writeWatchlist(stocks);
    return NextResponse.json({ ok: true, stocks });
  } catch (error) {
    return NextResponse.json({ error: `保存观察池失败：${error.message}` }, { status: 400 });
  }
}
