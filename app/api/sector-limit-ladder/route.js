import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server.js";
import { isChinaAShareNonTradingDay } from "../../../lib/ashare-trading-calendar.js";
import { buildSectorLimitLadder } from "../../../lib/sector-limit-ladder.js";
import { stockBoardLabel } from "../../lib/stockBoard.js";
import { loadDailyMarket } from "../daily-market/route.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const date = params.get("date") || "";
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
  const primary = params.get("primary") || "";
  const secondary = params.get("secondary") || "";
  const tertiary = params.get("tertiary") || "";
  const board = params.get("board") || "";
  const period = Number(params.get("period") || 5);
  const end = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+end) || end.toISOString().slice(0, 10) !== date ||
      date > today || date < "2024-01-01" || !primary || ![5, 10, 20, 30].includes(period)) {
    return NextResponse.json({ error: "请选择产业板块及有效交易日（2024年起）" }, { status: 400 });
  }
  try {
    if (await isChinaAShareNonTradingDay(date)) {
      return NextResponse.json({ error: `${date} 为非交易日` }, { status: 422 });
    }
    const library = JSON.parse(await readFile(path.join(process.cwd(), "data", "stock_sector_map.json"), "utf8"));
    const members = new Map();
    for (const stock of library.stocks) {
      if (board && stockBoardLabel(stock.code) !== board) continue;
      const matches = (stock.classifications || []).filter((entry) => entry.primary_sector === primary &&
        (!secondary || entry.secondary_sector === secondary) &&
        (!tertiary || entry.tertiary_sectors?.includes(tertiary)));
      if (!matches.length) continue;
      const member = members.get(stock.code) || { code: stock.code, name: stock.name, directions: [], relevance: null };
      for (const entry of matches) {
        for (const direction of entry.tertiary_sectors || []) {
          if (tertiary && tertiary !== direction) continue;
          const label = `${entry.secondary_sector} / ${direction}`;
          if (!member.directions.includes(label)) member.directions.push(label);
        }
        if (Number.isFinite(entry.relevance_score)) member.relevance = Math.max(member.relevance ?? 0, entry.relevance_score);
      }
      members.set(stock.code, member);
    }
    if (!members.size) return NextResponse.json({ error: "所选分类没有股票" }, { status: 404 });
    const dates = [];
    // Warm-up covers the rolling count and regular post-IPO observation.
    for (const cursor = new Date(end); dates.length < period + 18; cursor.setUTCDate(cursor.getUTCDate() - 1)) {
      const sessionDate = cursor.toISOString().slice(0, 10);
      if (!(await isChinaAShareNonTradingDay(sessionDate))) dates.push(sessionDate);
    }
    dates.reverse();
    const sessions = [];
    for (let offset = 0; offset < dates.length; offset += 4) {
      const batch = await Promise.all(dates.slice(offset, offset + 4).map(async (sessionDate) => {
        const market = await loadDailyMarket(sessionDate, { strictTradingDay: true, localOnly: sessionDate !== today });
        if (market.error || market.date !== sessionDate) {
          return { date: sessionDate, available: false, issue: market.error || "行情日期不一致" };
        }
        const final = market.snapshot?.closing_confirmed === true;
        const available = final || sessionDate === today;
        return {
          date: sessionDate, available, final, source: market.sourceNote,
          issue: available ? (market.snapshot?.stale ? "盘中快照滞后" : null) : "缺少已确认收盘的行情",
          quotes: available ? [...market.stocks, ...market.excludedStocks].filter((row) => members.has(row.code)) : [],
        };
      }));
      sessions.push(...batch);
    }
    const result = buildSectorLimitLadder({ sessions, members: [...members.values()], period, includeSt: params.get("includeSt") !== "0" });
    if (result.current.final) {
      await Promise.all(result.ladder.map(async (stock) => {
        try {
          const filename = path.join(process.cwd(), "data", "daily_turnover_rate", date, `${stock.code}.json`);
          const cached = JSON.parse(await readFile(filename, "utf8"));
          if (cached.date === date && cached.code === stock.code && Number.isFinite(cached.turnover_rate)) {
            stock.turnoverRate = cached.turnover_rate;
            stock.turnoverSource = cached.source;
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }));
    }
    return NextResponse.json({
      primary, secondary, tertiary, memberCount: members.size,
      classificationBasis: "使用当前产业库成员回看历史行情。缺少当时版本，结果只用于当前成分复盘。",
      ...result,
      current: { ...result.current, live: date === today },
    });
  } catch (error) {
    return NextResponse.json({ error: `梯队数据读取失败：${error.message}` }, { status: 502 });
  }
}
