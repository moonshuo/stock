import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { loadDailyMarket } from "../daily-market/route";
import { GET as getCapacityCore } from "../capacity-core/route";
import { GET as getLeader } from "../leader/route";
import { buildMainlineTradeCandidates } from "../../../lib/mainline-trade-candidates";
import { classificationPrimarySector, normalizeCode } from "../../lib/sectorSystem";
import { selectTradeMainlines, TRADE_MAINLINE_LIMIT } from "../../../lib/trade-mainline-selection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const STOCK_MAP_PATH = path.join(process.cwd(), "data", "stock_sector_map.json");
async function tradingDaysTo(date, count = 20) {
  const cursor = new Date(`${date}T12:00:00Z`), days = [];
  for (let attempts = 0; days.length < count && attempts < 70; attempts += 1) {
    if (![0, 6].includes(cursor.getUTCDay())) {
      const payload = await loadDailyMarket(cursor.toISOString().slice(0, 10));
      if (!payload?.error) days.unshift(payload);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}

function restoreThemeMembers(theme, stocks) {
  if (Array.isArray(theme?.members) && theme.members.length) return theme.members;
  const secondary = theme?.name || theme?.secondary;
  return stocks.filter((stock) => (stock.classifications || []).some((item) => (
    classificationPrimarySector(stock, item) === theme.primary && item.secondary_sector === secondary
  ))).map((stock) => ({ code: normalizeCode(stock.code), name: stock.name }));
}

export async function POST(request) {
  try {
    const { date, confirmed_mainlines = [], stocks = [] } = await request.json();
    // Trade selection is intentionally live: every request refreshes the
    // leader/capacity evidence before calculating the candidate pool.
    const force = true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !Array.isArray(confirmed_mainlines) || !confirmed_mainlines.length) return NextResponse.json({ error: "date 与 confirmed_mainlines 为必填参数" }, { status: 400 });
    // The caller has already completed the current-date mainline workflow.
    // This module only selects stocks inside those supplied directions; it
    // must not apply a second status, rank, or cycle-stage gate here.
    // The browser receives a compact mainline payload without members.  Use
    // the authoritative local stock map to restore them; client payloads are
    // only a convenience and must not decide whether a theme is selectable.
    const stockMap = JSON.parse(await readFile(STOCK_MAP_PATH, "utf8"));
    const sourceStocks = stockMap.stocks || [];
    const requestedMainlineCount = confirmed_mainlines.filter((item) => item?.primary && (item?.name || item?.secondary)).length;
    const requestedPrimaryCount = new Set(confirmed_mainlines.filter((item) => item?.primary && (item?.name || item?.secondary)).map((item) => item.primary)).size;
    const tradeMainlines = selectTradeMainlines(confirmed_mainlines)
      .map((item) => ({ ...item, members: restoreThemeMembers(item, sourceStocks), trade_selection_basis: "top_primary_started_secondary" }))
      .filter((item) => item.members.length);
    if (!tradeMainlines.length) return NextResponse.json({ status: "no_trade_mainline", reference_pool: [], tradable_pool: [], mainline_trade_candidates: { A: [], B: [], C: [], rejected: [] } });
    const daily_history = await tradingDaysTo(date);
    const evidence = await Promise.all(tradeMainlines.map(async (theme) => {
      const params = new URLSearchParams({ date, primary: theme.primary, secondary: theme.name || theme.secondary });
      if (force) params.set("force", "1");
      const [capacityResponse, leaderResponse] = await Promise.all([getCapacityCore(new Request(`http://localhost/api/capacity-core?${params}`)), getLeader(new Request(`http://localhost/api/leader?${params}`))]);
      const [capacity, leader] = await Promise.all([capacityResponse.json(), leaderResponse.json()]);
      return { capacity: capacity.candidates || [], leader: leader.leader_analysis?.candidates || [] };
    }));
    const members = tradeMainlines.flatMap((theme) => theme.members || []);
    const mainline_frontline_codes = tradeMainlines.flatMap((theme) => theme.hierarchy?.frontline_stocks || []).map((stock) => stock.code);
    const selectedThemes = tradeMainlines.map((theme) => ({ primary: theme.primary, name: theme.name || theme.secondary, selection_basis: theme.trade_selection_basis }));
    const selectedPrimaries = [...new Set(tradeMainlines.map((theme) => theme.primary))];
    return NextResponse.json({ version: 3, date, recomputed: Boolean(force), requested_mainline_count: requestedMainlineCount, requested_primary_count: requestedPrimaryCount, selected_primary_mainlines: selectedPrimaries, selected_mainline_limit: TRADE_MAINLINE_LIMIT, trade_mainlines: selectedThemes, confirmed_mainlines: selectedThemes, ...buildMainlineTradeCandidates({ confirmed_mainlines: tradeMainlines, stocks: sourceStocks, daily_history, leader_candidates: evidence.flatMap((item) => item.leader), capacity_candidates: evidence.flatMap((item) => item.capacity), mainline_frontline_codes }) });
  } catch (error) { return NextResponse.json({ error: error.message || "主线可交易股票分析失败" }, { status: 500 }); }
}
