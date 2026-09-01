import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { backfillHistoricalDate, loadDailyMarket } from "../daily-market/route";
import { classificationPrimarySector, isStStockName, normalizeCode } from "../../lib/sectorSystem";
import { ensureDailyTurnover, ensureHistoricalMarketCap } from "../../../lib/intraday5m";
import { relevanceWeightForScope } from "../../../lib/relevance-adjusted-return.js";
import { relevanceAdjustedCoreScore } from "../../../lib/core-relevance-score.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, "data", "capacity_core");
const STOCK_MAP_PATH = path.join(ROOT, "data", "stock_sector_map.json");
const CACHE_VERSION = "3.6";
const MIN_TOTAL_MARKET_CAP = 100 * 100000000;

const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const amount = (value) => numberOrNull(value) || 0;

function priorWeekdays(date, count = 3) {
  const cursor = new Date(`${date}T12:00:00Z`);
  const result = [];
  while (result.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (![0, 6].includes(cursor.getUTCDay())) result.push(cursor.toISOString().slice(0, 10));
  }
  return result;
}

// Calendar weekdays are not enough for A shares: public holidays such as
// 5/1 have no bars.  Probe the market loader and retain only real sessions.
async function loadPriorTradingDays(date, count = 3) {
  const cursor = new Date(`${date}T12:00:00Z`);
  const days = [];
  for (let attempts = 0; days.length < count && attempts < 40; attempts += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if ([0, 6].includes(cursor.getUTCDay())) continue;
    const candidate = cursor.toISOString().slice(0, 10);
    const payload = await loadDailyMarket(candidate);
    if (!payload?.error) days.push(payload);
    // A weekday can still be a mainland-market holiday (for example Qingming
    // on 2026-04-06).  It is not a valid historical session and must be
    // skipped just like a weekend, rather than aborting every capacity-core
    // analysis that happens to look back across the holiday.
  }
  if (days.length < count) throw new Error(`目标日前仅找到 ${days.length}/${count} 个有效交易日`);
  return days;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function cachePath(date, primary, secondary) {
  const key = `${primary}__${secondary}`.replace(/[<>:"/\\|?*]/g, "_");
  return path.join(CACHE_DIR, date, `${key}.json`);
}

async function membersFor(primary, secondary) {
  const stockMap = await readJson(STOCK_MAP_PATH);
  return (stockMap.stocks || []).filter((stock) => !isStStockName(stock.name) &&
    (stock.classifications || []).some((item) =>
      classificationPrimarySector(stock, item) === primary && item.secondary_sector === secondary
    )
  ).map((stock) => ({
    code: normalizeCode(stock.code),
    name: String(stock.name || ""),
    relevance_score: relevanceWeightForScope(stock, { primary, secondary }),
  }));
}

function rank(rows, code) {
  return rows.findIndex((item) => item.code === code) + 1;
}

function rankPercentile(rankValue, count) {
  if (!Number.isFinite(rankValue) || !Number.isFinite(count) || count <= 0) return null;
  if (count === 1) return 1;
  return Math.max(0, Math.min(1, 1 - (rankValue - 1) / (count - 1)));
}

function capitalCapacityScore(sectorRank, sectorCount) {
  return 50 * (rankPercentile(sectorRank, sectorCount) ?? 0);
}

function missingMemberAmounts(days, members) {
  const codes = new Set(members.map((item) => item.code));
  return days.flatMap((day) => {
    const seen = new Set((day.stocks || []).filter((stock) => amount(stock.amount) > 0).map((stock) => stock.code));
    return [...codes].filter((code) => !seen.has(code)).map((code) => ({ date: day.date, code }));
  });
}

async function enrichMissingDailyAmounts(days, members) {
  for (const day of days) {
    const byCode = new Map((day.stocks || []).map((stock) => [stock.code, stock]));
    await Promise.all(members.map(async (member) => {
      const existing = byCode.get(member.code);
      if (existing && amount(existing.amount) > 0) return;
      try {
        const fallback = await ensureDailyTurnover({ date: day.date, code: member.code });
        if (existing) {
          existing.amount = fallback.amount;
          existing.amount_type = fallback.amount_type;
          existing.amount_source = fallback.source;
        } else {
          const stock = { code: member.code, name: member.name, amount: fallback.amount, amount_type: fallback.amount_type, amount_source: fallback.source, changePct: null };
          day.stocks = [...(day.stocks || []), stock];
          byCode.set(member.code, stock);
        }
      } catch { /* The caller will return insufficient_data if all sources fail. */ }
    }));
  }
}

async function buildAnalysis(date, primary, secondary, members, days) {
  const memberCodes = new Set(members.map((item) => item.code));
  const evidence = new Map(members.map((item) => [item.code, {
    code: item.code, name: item.name, relevance_score: item.relevance_score, daily: [], capital_total: 0,
  }]));
  const missing = [];

  for (const day of days) {
    const market = (day.stocks || []).filter((stock) => amount(stock.amount) > 0)
      .sort((left, right) => amount(right.amount) - amount(left.amount));
    const sector = market.filter((stock) => memberCodes.has(stock.code));
    if (!sector.length) {
      missing.push(`${day.date}: no sector member amounts`);
      continue;
    }
    for (const stock of sector) {
      const item = evidence.get(stock.code);
      if (!item) continue;
      const sectorRank = rank(sector, stock.code);
      const score = capitalCapacityScore(sectorRank, sector.length);
      item.capital_total += score / days.length;
      item.daily.push({
        date: day.date,
        amount: amount(stock.amount),
        amount_type: stock.amount_type || "reported",
        amount_source: stock.amount_source || "local_5m_snapshot",
        close: numberOrNull(stock.price),
        change_pct: numberOrNull(stock.changePct),
        sector_amount_rank: sectorRank,
        sector_member_count: sector.length,
        capital_score: score,
      });
    }
  }

  const candidates = [...evidence.values()].map((item) => {
    const completeDays = item.daily.length;
    const rankStrength = completeDays
      ? item.daily.reduce((sum, day) => sum + (day.sector_member_count <= 1 ? 1 : 1 - (day.sector_amount_rank - 1) / (day.sector_member_count - 1)), 0) / completeDays
      : 0;
    const sectorTop3Days = item.daily.filter((day) => day.sector_amount_rank <= 3).length;
    // Each day contributes an equal share.  The sector amount rank is mapped
    // linearly: rank 1 gets the day's full share; the last rank gets zero.
    const activityDailyScores = item.daily.map((day) => 30 / days.length * (rankPercentile(day.sector_amount_rank, day.sector_member_count) ?? 0));
    const continuedActivity = Math.round(activityDailyScores.reduce((sum, value) => sum + value, 0));
    const capitalCapacity = Math.round(item.capital_total);
    const complete = completeDays === days.length;
    const rawScore = complete ? capitalCapacity + continuedActivity : null;
    const score = relevanceAdjustedCoreScore(rawScore, item.relevance_score);
    const missingData = [];
    if (completeDays < days.length) missingData.push("three_day_amount");
    return {
      ...item,
      sector_top3_days: sectorTop3Days,
      raw_score: rawScore,
      score,
      score_max: complete ? 80 : null,
      relevance_adjusted_score_max: complete ? relevanceAdjustedCoreScore(80, item.relevance_score) : null,
      score_details: {
        capital_capacity: capitalCapacity,
        continued_activity: continuedActivity,
        raw_total: rawScore,
        relevance_score: item.relevance_score,
        relevance_adjusted_total: score,
        sustained_activity_evidence: {
          sector_top3_days: sectorTop3Days,
          average_sector_rank_strength: +rankStrength.toFixed(3),
          daily_rank_scores: activityDailyScores.map((value) => +value.toFixed(2)),
        },
      },
      verdict: !complete ? "insufficient_data" : score >= 75 ? "confirmed_capacity_core" : score >= 65 ? "capacity_core_candidate" : score >= 55 ? "possible_capacity_stock" : "not_capacity_core",
      intraday_support: {
        status: "unavailable",
        score: null,
        confidence: "unavailable",
        reason: "缺少连续分钟OHLCV，无法判断盘中回调、止跌和修复结构",
        missing_data: ["continuous_intraday_ohlcv"],
      },
      missing_data: missingData,
      reason: completeDays === days.length
        ? `已按近三日题材内成交额排名计算原始分，并乘以 ${(item.relevance_score * 100).toFixed(0)}% 关联度得到最终分。`
        : "近三日成交额数据不完整，不能确认容量中军。",
    };
  });

  // Market cap is a hard eligibility requirement, not an extra score.  Only
  // stocks that would otherwise reach the candidate range are fetched, so the
  // automatic mainline scan does not make needless quote requests.
  await Promise.all(candidates.filter((item) => item.verdict !== "insufficient_data" && (item.score ?? 0) >= 55).map(async (item) => {
    const observed = item.daily[0];
    try {
      const cap = await ensureHistoricalMarketCap({ date: observed?.date, code: item.code, close: observed?.close });
      item.market_cap = cap.market_cap;
      item.free_float_market_cap = cap.free_float_market_cap;
      item.market_cap_type = cap.market_cap_type;
      item.market_cap_source = cap.source;
      item.market_cap_observed_date = observed?.date || null;
      item.score_details.market_cap_eligibility = {
        minimum_total_market_cap: MIN_TOTAL_MARKET_CAP,
        total_market_cap: cap.market_cap,
        eligible: cap.market_cap >= MIN_TOTAL_MARKET_CAP,
      };
      if (cap.market_cap < MIN_TOTAL_MARKET_CAP) {
        item.verdict = "not_capacity_core";
        item.reason = `总市值约 ${(cap.market_cap / 100000000).toFixed(1)} 亿元，未达到容量中军最低 100 亿元门槛。`;
      }
    } catch (error) {
      item.verdict = "insufficient_data";
      item.missing_data.push("historical_market_cap");
      item.score_details.market_cap_eligibility = {
        minimum_total_market_cap: MIN_TOTAL_MARKET_CAP,
        total_market_cap: null,
        eligible: false,
        error: error.message,
      };
      item.reason = "市值数据不足，不能确认容量中军。";
    }
  }));

  candidates.sort((left, right) => (Number.isFinite(right.score) ? right.score : -Infinity) - (Number.isFinite(left.score) ? left.score : -Infinity) || left.code.localeCompare(right.code));

  return {
    version: CACHE_VERSION,
    date,
    primary_sector: primary,
    secondary_sector: secondary,
    status: candidates.some((item) => ["confirmed_capacity_core", "capacity_core_candidate"].includes(item.verdict)) ? "partial_evidence" : "daily_evidence_only",
    methodology: {
      score_out_of: 80,
      available_score_out_of: 80,
      scoring_components: {
        capital_capacity: 50,
        continued_activity: 30,
      },
      final_score_rule: "最终分 = 原始容量中军分 × 股票对当前一级/二级方向的最高匹配 relevance_score。候选门槛和最终排名均使用关联度调整后的分数。",
      eligibility_requirements: {
        minimum_total_market_cap: MIN_TOTAL_MARKET_CAP,
        minimum_total_market_cap_yi: 100,
        note: "总市值低于100亿元或市值数据不足的股票，不得认定为容量中军。历史市值使用观测日收盘价与当前总股本推算，并明确标为估算值。",
      },
      data_window: "仅使用目标交易日前的三个交易日，不使用目标日及之后的数据。",
      current_coverage: "资金容量50分、持续活跃30分均仅使用题材内成交额排名百分位：每个交易日内，题材成交额第1名获得该日满分，最后1名为0，其余线性分配；近三日得分相加。全市场成交额排名、板块带动度与分歧承接均不参与容量中军评分。",
    },
    candidates,
    missing_data: [...new Set(missing)],
    generated_at: new Date().toISOString(),
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = String(searchParams.get("date") || "");
  const primary = String(searchParams.get("primary") || "").trim();
  const secondary = String(searchParams.get("secondary") || "").trim();
  const force = searchParams.get("force") === "1";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !primary || !secondary) {
    return NextResponse.json({ error: "date、primary、secondary 为必填参数" }, { status: 400 });
  }

  try {
    if (!force) {
      try {
        const cached = await readJson(cachePath(date, primary, secondary));
        if (cached?.version === CACHE_VERSION) return NextResponse.json({ ...cached, source: "cache" });
      } catch { /* First calculation, or a cache that has been cleared. */ }
    }
    const members = await membersFor(primary, secondary);
    if (!members.length) return NextResponse.json({ error: "该二级主线没有已归类股票" }, { status: 404 });
    let days = await loadPriorTradingDays(date, 3);
    const dates = days.map((day) => day.date);

    await enrichMissingDailyAmounts(days, members);
    const missing = missingMemberAmounts(days, members);
    if (missing.length) {
      await Promise.all([...new Set(missing.map((item) => item.date))].map(async (value) => {
        const compact = value.replace(/-/g, "");
        await backfillHistoricalDate({ dashed: value, compact, year: compact.slice(0, 4) });
      }));
      days = await Promise.all(dates.map((value) => loadDailyMarket(value)));
      await enrichMissingDailyAmounts(days, members);
    }

    const analysis = await buildAnalysis(date, primary, secondary, members, days);
    await mkdir(path.dirname(cachePath(date, primary, secondary)), { recursive: true });
    await writeFile(cachePath(date, primary, secondary), `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
    return NextResponse.json({ ...analysis, source: "computed" });
  } catch (error) {
    return NextResponse.json({ error: `容量中军分析失败：${error.message}` }, { status: 500 });
  }
}
