import { NextResponse } from "next/server.js";
import { loadDailyMarket } from "../daily-market/route.js";
import { isChinaAShareNonTradingDay } from "../../../lib/ashare-trading-calendar.js";
import { getMarketData } from "../../../lib/market-data.js";
import { metadataFromHistoricalTurnover } from "../../../lib/backtest-market-metadata.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CODE_PATTERN = /^\d{6}$/;
const MAX_DAYS = 120;
const LOCAL_DISPLAY_DAYS = 20;
const hydrationJobs = new Map();
const hydrationJobsByKey = new Map();
const n = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function previousDate(date) {
  const cursor = new Date(`${date}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  return cursor.toISOString().slice(0, 10);
}

function localBar(market, code) {
  const quote = (market.stocks || []).find((stock) => stock.code === code);
  if (!quote || ![quote.open, quote.high, quote.low, quote.price, quote.preClose, quote.vol].every((value) => Number.isFinite(Number(value)))) return null;
  return {
    date: market.date, open: Number(quote.open), high: Number(quote.high), low: Number(quote.low), close: Number(quote.price),
    pre_close: Number(quote.preClose), volume: Number(quote.vol), amount: n(quote.amount), change_pct: n(quote.changePct),
    data_status: "local_snapshot", price_source: "local_market_snapshot",
  };
}

async function tradingDates(endDate, count) {
  const dates = [];
  let cursor = endDate;
  for (let attempts = 0; dates.length < count && attempts < count * 4; attempts += 1) {
    if (!await isChinaAShareNonTradingDay(cursor)) dates.unshift(cursor);
    cursor = previousDate(cursor);
  }
  return dates;
}

// This never starts a network fetch. It gives the chart an immediate local
// view and lets the hydration task report precisely which dates remain absent.
export async function loadLocalStockKline({ code, endDate, days = LOCAL_DISPLAY_DAYS }) {
  const dates = await tradingDates(endDate, Math.max(10, Math.min(LOCAL_DISPLAY_DAYS, Number(days) || LOCAL_DISPLAY_DAYS)));
  const results = await Promise.all(dates.map((date) => loadDailyMarket(date, { localOnly: true, strictTradingDay: true })));
  const bars = results.map((market, index) => !market?.error && market.date === dates[index] && market.snapshot?.closing_confirmed ? localBar(market, code) : null).filter(Boolean);
  const unavailableDates = dates.filter((date) => !bars.some((bar) => bar.date === date));
  return {
    code, end_date: endDate, bars, mode: "local_immediate", local_window_days: dates.length,
    unavailable_dates: unavailableDates, data_quality_warnings: unavailableDates.length ? [`本地快照缺少 ${unavailableDates.length} 个交易日；后台会尝试补齐。`] : [],
  };
}

function validVerifiedBar({ date, dailyQuote, turnover }) {
  const [open, high, low, close, preClose] = ["open", "high", "low", "close", "pre_close"].map((field) => n(dailyQuote?.[field]));
  const volume = n(turnover?.historical_quote?.volume);
  const amount = n(turnover?.historical_quote?.amount);
  if (![open, high, low, close, preClose, volume, amount].every((value) => Number.isFinite(value) && value > 0)
    || high < Math.max(open, close) || low > Math.min(open, close)) return null;
  const metadata = metadataFromHistoricalTurnover({ turnoverRate: turnover.turnover_rate, historicalQuote: turnover.historical_quote });
  return {
    date, open, high, low, close, pre_close: preClose, volume, amount,
    change_pct: Number.isFinite(n(dailyQuote?.change_pct)) ? n(dailyQuote.change_pct) : (close / preClose - 1) * 100,
    turnover_rate: n(turnover.turnover_rate), free_float_market_cap: metadata?.free_float_market_cap ?? null,
    data_status: "verified", price_source: "two_source_verified_daily_quote", volume_source: turnover.source || "daily_turnover_rate",
  };
}

async function mapLimit(items, concurrency, worker) {
  const results = []; let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) results.push(await worker(items[cursor++]));
  }));
  return results;
}

async function hydrateStockKline(job) {
  const dates = await tradingDates(job.end_date, job.target_days);
  job.total = dates.length;
  const local = await loadLocalStockKline({ code: job.code, endDate: job.end_date, days: LOCAL_DISPLAY_DAYS });
  const localByDate = new Map(local.bars.map((bar) => [bar.date, bar]));
  const records = await mapLimit(dates, 4, async (date) => {
    try {
      const [dailyQuote, turnover] = await Promise.all([
        getMarketData({ kind: "daily_quote", date, code: job.code }),
        getMarketData({ kind: "daily_turnover_rate", date, code: job.code }),
      ]);
      const bar = validVerifiedBar({ date, dailyQuote, turnover });
      if (!bar) throw new Error("日线或量额字段不完整");
      job.completed += 1;
      return { date, bar, error: null };
    } catch (error) {
      job.completed += 1;
      return { date, bar: localByDate.get(date) || null, error: error.message };
    }
  });
  const unavailable = records.filter((record) => !record.bar).map((record) => ({ date: record.date, reason: record.error }));
  const fallbackLocal = records.filter((record) => record.bar?.data_status === "local_snapshot").map((record) => record.date);
  return {
    code: job.code, end_date: job.end_date, bars: records.map((record) => record.bar).filter(Boolean).sort((left, right) => left.date.localeCompare(right.date)),
    mode: "hydrated", target_days: job.target_days, verified_days: records.filter((record) => record.bar?.data_status === "verified").length,
    local_fallback_days: fallbackLocal, unavailable_dates: unavailable,
    data_quality_warnings: unavailable.length ? [`${unavailable.length} 个交易日仍缺少经过验证的日线或量额数据。`] : [],
  };
}

function startHydration({ code, endDate, days }) {
  const targetDays = Math.max(LOCAL_DISPLAY_DAYS, Math.min(MAX_DAYS, Number(days) || 60));
  const key = `${code}|${endDate}|${targetDays}`;
  const existingId = hydrationJobsByKey.get(key);
  const existing = existingId && hydrationJobs.get(existingId);
  if (existing && ["queued", "running"].includes(existing.status)) return existing;
  const id = `${key}|${Date.now()}`;
  const job = { id, key, code, end_date: endDate, target_days: targetDays, status: "queued", total: 0, completed: 0, result: null, error: null, created_at: new Date().toISOString() };
  hydrationJobs.set(id, job); hydrationJobsByKey.set(key, id);
  Promise.resolve().then(async () => {
    job.status = "running";
    try { job.result = await hydrateStockKline(job); job.status = "completed"; }
    catch (error) { job.error = error.message; job.status = "failed"; }
    job.finished_at = new Date().toISOString();
  });
  return job;
}

function jobPayload(job) {
  return { job_id: job.id, status: job.status, completed: job.completed, total: job.total, result: job.status === "completed" ? job.result : null, error: job.error, created_at: job.created_at, finished_at: job.finished_at || null };
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const jobId = String(params.get("job_id") || "");
  if (jobId) {
    const job = hydrationJobs.get(jobId);
    return job ? NextResponse.json(jobPayload(job)) : NextResponse.json({ error: "补充任务不存在或服务已重启" }, { status: 404 });
  }
  const code = String(params.get("code") || "");
  const endDate = String(params.get("end_date") || "");
  const days = Number(params.get("days") || LOCAL_DISPLAY_DAYS);
  if (!CODE_PATTERN.test(code) || !DATE_PATTERN.test(endDate)) return NextResponse.json({ error: "code 必须为6位股票代码，end_date 必须为 YYYY-MM-DD" }, { status: 400 });
  if (!Number.isInteger(days) || days < 10 || days > MAX_DAYS) return NextResponse.json({ error: `days 必须为10至${MAX_DAYS}的整数` }, { status: 400 });
  try {
    const result = await loadLocalStockKline({ code, endDate, days });
    if (!result.bars.length) return NextResponse.json({ error: "本地行情归档中没有该股票的可用日K数据。" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error?.message || "本地日K数据暂时不可用。" }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const code = String(body.code || ""), endDate = String(body.end_date || ""), days = Number(body.days || 60);
    if (!CODE_PATTERN.test(code) || !DATE_PATTERN.test(endDate) || !Number.isInteger(days) || days < 10 || days > MAX_DAYS) return NextResponse.json({ error: "补充参数无效" }, { status: 400 });
    return NextResponse.json(jobPayload(startHydration({ code, endDate, days })), { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "无法启动日K补充任务" }, { status: 500 });
  }
}
