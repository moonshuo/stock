import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { isThirdBoardStockCode } from "../../lib/sectorSystem";

export const dynamic = "force-dynamic";

const EASTMONEY_UNIVERSE_URL = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=6000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m%3A0%2Bt%3A6%2Cm%3A1%2Bt%3A2%2Cm%3A1%2Bt%3A23&fields=f12%2Cf14";
const STOCK_NAME_MAP_PATH = path.join(process.cwd(), "data", "stock_name_map.json");

async function persistStockNames(stocks) {
  let previous = { version: "1.0", names: {} };
  try {
    previous = JSON.parse(await readFile(STOCK_NAME_MAP_PATH, "utf8"));
  } catch {}
  const names = { ...(previous.names || {}) };
  let changed = false;
  for (const stock of stocks) {
    if (names[stock.code] !== stock.name) {
      names[stock.code] = stock.name;
      changed = true;
    }
  }
  if (!changed) return Object.keys(names).length;
  await mkdir(path.dirname(STOCK_NAME_MAP_PATH), { recursive: true });
  const tempPath = `${STOCK_NAME_MAP_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ version: "1.1", updated_at: new Date().toISOString(), names }, null, 2)}\n`, "utf8");
  await rename(tempPath, STOCK_NAME_MAP_PATH);
  return Object.keys(names).length;
}

async function readLocalStockNames() {
  try {
    const payload = JSON.parse(await readFile(STOCK_NAME_MAP_PATH, "utf8"));
    return Object.entries(payload?.names || {})
      .map(([code, name]) => ({ code: String(code), name: String(name || "").trim() }))
      .filter((stock) => /^\d{6}$/.test(stock.code) && stock.name && !isThirdBoardStockCode(stock.code));
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const response = await fetch(EASTMONEY_UNIVERSE_URL, {
      cache: "force-cache",
      next: { revalidate: 60 * 60 * 12 },
      headers: {
        Referer: "https://quote.eastmoney.com/",
        "User-Agent": "Mozilla/5.0"
      }
    });
    if (!response.ok) throw new Error(`股票库请求失败：${response.status}`);
    const payload = await response.json();
    const stocks = (payload?.data?.diff || []).map((item) => ({
      code: String(item.f12 || ""),
      name: String(item.f14 || "").trim()
    })).filter((stock) => stock.code && stock.name && !isThirdBoardStockCode(stock.code));
    if (!stocks.length) throw new Error("全市场股票池返回为空");
    const localNameCount = await persistStockNames(stocks);
    return NextResponse.json({ stocks, source: "eastmoney", localNameCount, updatedAt: new Date().toISOString() });
  } catch (error) {
    const stocks = await readLocalStockNames();
    if (stocks.length) {
      return NextResponse.json({ stocks, source: "local-name-cache", fallbackReason: error.message, updatedAt: new Date().toISOString() });
    }
    return NextResponse.json({ stocks: [], error: error.message }, { status: 502 });
  }
}
