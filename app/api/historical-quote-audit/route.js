import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { loadDailyMarket } from "../daily-market/route";
import { auditHistoricalDailyQuote } from "../../../lib/historical-daily-reconciliation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROOT = process.cwd();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function differs(local, remote) {
  return Math.abs(number(local?.price) - number(remote?.close)) > 0.011
    || Math.abs(number(local?.preClose) - number(remote?.pre_close)) > 0.011;
}

export async function POST(request) {
  try {
    const { code, date, refresh = false } = await request.json();
    const normalizedCode = String(code || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
    const market = await loadDailyMarket(date, { localOnly: true });
    if (market?.error) return NextResponse.json({ error: market.error }, { status: market.status || 404 });
    const local = (market.stocks || []).find((item) => item.code === normalizedCode) || (market.excludedStocks || []).find((item) => item.code === normalizedCode);
    if (!local) return NextResponse.json({ error: "本地行情中未找到该股票" }, { status: 404 });
    const audit = await auditHistoricalDailyQuote({ code: normalizedCode, date: market.date, refresh });
    const apply = audit.consensus && differs(local, audit.consensus);
    let correction = null;
    if (apply) {
      correction = { version: "1.0", code: normalizedCode, date: market.date, source: audit.consensus.source, verified_by: audit.quotes.filter((quote) => Math.abs(quote.close - audit.consensus.close) <= 0.011 && Math.abs(quote.pre_close - audit.consensus.pre_close) <= 0.011).map((quote) => quote.source), close: audit.consensus.close, pre_close: audit.consensus.pre_close, open: audit.consensus.open, high: audit.consensus.high, low: audit.consensus.low, change_pct: audit.consensus.change_pct, applied_at: new Date().toISOString() };
      const file = path.join(ROOT, "data", "historical_quote_corrections", market.date, `${normalizedCode}.json`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(correction, null, 2)}\n`, "utf8");
    }
    return NextResponse.json({ date: market.date, code: normalizedCode, local: { close: local.price, pre_close: local.preClose, change_pct: local.changePct, source: market.source }, audit, correction, status: apply ? "correction_saved" : audit.consensus ? "local_matches_consensus" : "unresolved" });
  } catch (error) {
    return NextResponse.json({ error: error.message || "历史行情核验失败" }, { status: 500 });
  }
}
