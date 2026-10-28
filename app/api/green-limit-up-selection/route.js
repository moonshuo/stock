import { NextResponse } from "next/server.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isChinaAShareNonTradingDay } from "../../../lib/ashare-trading-calendar.js";
import { runDailyMarketTask, loadDailyMarket } from "../daily-market/route.js";
import { selectGreenMainBoardRecentLimitUps } from "../../lib/greenLimitUpSelection.js";
import { scoreGreenLimitUpCandidates, trendScore } from "../../lib/greenLimitUpScoring.js";
import { getMarketData } from "../../../lib/market-data.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WINDOW_TRADING_DAYS = 10;
const STOCK_MAP_PATH = path.join(process.cwd(), "data", "stock_sector_map.json");
const OUTPUT_DIR = path.join(process.cwd(), "output");

function previousDate(date) {
  const cursor = new Date(`${date}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  return cursor.toISOString().slice(0, 10);
}

export async function recentTradingDates(endDate, count = WINDOW_TRADING_DAYS) {
  const dates = [];
  let cursor = endDate;
  for (let attempts = 0; dates.length < count && attempts < count * 5; attempts += 1) {
    if (!await isChinaAShareNonTradingDay(cursor)) dates.unshift(cursor);
    cursor = previousDate(cursor);
  }
  if (dates.length !== count) throw new Error(`无法取得截至 ${endDate} 的 ${count} 个交易日`);
  return dates;
}

function allMarketStocks(payload) {
  // daily-market separates ST/delisting rows for its own market-analysis
  // needs.  A stock-selection condition must inspect the raw market universe
  // rather than inherit that unrelated exclusion.
  return [...(payload.stocks || []), ...(payload.excludedStocks || [])];
}

async function mapLimit(items, concurrency, worker) {
  const results = []; let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) results.push(await worker(items[cursor++]));
  }));
  return results;
}

async function scoreCandidates({ candidates, historicalStocksByDate, dates }) {
  const barsByCode = new Map();
  for (const date of dates) {
    for (const stock of historicalStocksByDate.get(date) || []) {
      if (!barsByCode.has(stock.code)) barsByCode.set(stock.code, []);
      barsByCode.get(stock.code).push(stock);
    }
  }
  const candidateInputs = await mapLimit(candidates, 8, async (stock) => {
    const turnoverRecords = await Promise.all(dates.slice(-5).map(async (date) => {
      try {
        // Read the date-specific cache first, then automatically fetch and
        // persist only this missing historical record.  The data boundary
        // validates provider fields and never substitutes current float data.
        const record = await getMarketData({ kind: "daily_turnover_rate", date, code: stock.code });
        return { rate: record.turnover_rate, error: null };
      } catch (error) {
        return { rate: null, error: `${date}：${error.message}` };
      }
    }));
    return {
      ...stock,
      bars: barsByCode.get(stock.code) || [],
      turnover_rates: turnoverRecords.map((record) => record.rate),
      turnover_errors: turnoverRecords.map((record) => record.error),
    };
  });
  return scoreGreenLimitUpCandidates(candidateInputs);
}

async function requireRecentTertiaryScore(candidates, dates, endDate) {
  const [stockMap, mainline] = await Promise.all([readFile(STOCK_MAP_PATH, "utf8").then(JSON.parse), readFile(path.join(OUTPUT_DIR, `mainline_${endDate}.json`), "utf8").then(JSON.parse)]);
  const stocks = new Map((stockMap.stocks || []).map((stock) => [stock.code, stock]));
  const themes = new Map((mainline.tertiary_themes || []).map((theme) => [theme.key, theme]));
  const evidence = new Map();
  for (const candidate of candidates) {
    const hits = [];
    for (const item of stocks.get(candidate.code)?.classifications || []) for (const tertiary of item.tertiary_sectors || []) {
      const theme = themes.get(`${item.primary_sector}__${item.secondary_sector}__${tertiary}`);
      for (const point of theme?.score_history || []) {
        const score = Number(point?.daily_strength_score);
        if (dates.includes(point.date) && Number.isFinite(score) && score >= 80) hits.push({ date: point.date, tertiary, daily_strength_score: score });
      }
    }
    if (hits.length) evidence.set(candidate.code, hits.sort((a, b) => b.daily_strength_score - a.daily_strength_score || b.date.localeCompare(a.date)));
  }
  return { candidates: candidates.filter((candidate) => evidence.has(candidate.code)).map((candidate) => ({ ...candidate, tertiary_score_hits: evidence.get(candidate.code) })), evidence };
}

function requireGoodTrend(candidates, history, dates) {
  return candidates.filter((candidate) => {
    const closes = dates.flatMap((date) => (history.get(date) || []).filter((stock) => stock.code === candidate.code).map((stock) => stock.price));
    const trend = trendScore({ price: candidate.price, closes });
    return trend?.rising_structure && trend.score >= 60;
  });
}

export async function buildGreenLimitUpSelection(endDate) {
  const dates = await recentTradingDates(endDate);
  const scoringDates = await recentTradingDates(endDate, 20);
  const snapshots = await Promise.all(scoringDates.map(async (date, index) => {
    const payload = await loadDailyMarket(date, { localOnly: true, strictTradingDay: true });
    if (payload.error) throw new Error(`${date}：${payload.error}`);
    const isToday = index === scoringDates.length - 1;
    // "今天绿盘" is a current-price condition.  It is valid intraday only
    // with a fresh full-market snapshot; every earlier day is historical
    // evidence and therefore must be an explicitly confirmed close.
    if (isToday) {
      if (!payload.snapshot?.closing_confirmed && payload.snapshot?.stale !== false) {
        throw new Error(`${date}：当日行情快照已过期，不能用旧盘中报价判断绿盘`);
      }
    } else if (!payload.snapshot?.closing_confirmed) {
      throw new Error(`${date}：本地快照未确认收盘，不能用于近 10 日涨停判断`);
    }
    return payload;
  }));
  const historicalStocksByDate = new Map(snapshots.map((snapshot) => [snapshot.date, allMarketStocks(snapshot)]));
  const today = snapshots.at(-1);
  const limitUpHistory = new Map(dates.map((date) => [date, historicalStocksByDate.get(date) || []]));
  const initialStocks = selectGreenMainBoardRecentLimitUps({
    todayStocks: allMarketStocks(today),
    historicalStocksByDate: limitUpHistory,
  });
  const trendStocks = requireGoodTrend(initialStocks, historicalStocksByDate, scoringDates);
  const tertiaryFilter = await requireRecentTertiaryScore(trendStocks, dates, today.date);
  const stocks = tertiaryFilter.candidates;
  const scoring = await scoreCandidates({ candidates: stocks, historicalStocksByDate, dates: scoringDates });
  return {
    date: today.date,
    trading_dates: dates,
    rule: {
      today: "当日最新价 < 昨收价（收盘后等同于收盘价）",
      board: "仅沪深主板代码：000/001/002/003/600/601/603/605",
      trend: "MA10 高于 MA20、MA10 上行，且价格位于 MA10 附近（趋势分至少 60）；小幅回调不作为删除条件",
      tertiary_score: "任一所属三级板块在最近 10 个交易日的现有系统当日评分 daily_strength_score 中至少一次达到 80 分",
      limit_up_price: "普通主板按昨收上浮 10%、名称标记 ST/*ST/S*ST/SST 的股票按 5%，均按 ¥0.01 四舍五入",
    },
    initial_candidate_count: initialStocks.length,
    trend_qualified_count: trendStocks.length,
    candidate_count: stocks.length,
    stocks,
    scored_candidate_count: scoring.scored.length,
    scored_stocks: scoring.scored,
    unscored_candidates: scoring.unavailable,
    scoring: {
      total: "趋势 40% + 近 5 日加权换手率 30% + 近 5 日下跌放量压力 30%",
      trend: "MA10 必须高于 MA20 且 MA10 上行；偏离 MA10（上/下）每 1 个百分点扣 20 分；连续两日收跌时趋势分最高 20 分",
      turnover: "最近 5 日真实换手率按 1:2:3:4:5 加权，较低者在完整样本中得分更高",
      downside_volume: "最近 5 日按 1:2:3:4:5 加权；下跌日成交量相对前 5 日平均量越大，完整样本中的得分越低",
      missing_data: "系统会自动补齐缺失的目标交易日真实换手率；所有来源均失败时才不计算总分，绝不以成交额、当前流通股本或默认值替代",
    },
    data_quality: {
      source: "本地 5 分钟 Parquet 全市场快照",
      closing_confirmed_dates: dates,
      today_snapshot: today.snapshot?.closing_confirmed ? "closing_confirmed" : "fresh_intraday",
    },
  };
}

export async function GET(request) {
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!DATE_PATTERN.test(date)) return NextResponse.json({ error: "date 必须为 YYYY-MM-DD" }, { status: 400 });
  try {
    const payload = await runDailyMarketTask(() => buildGreenLimitUpSelection(date));
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: error.message || "选股条件计算失败" }, { status: 409 });
  }
}
