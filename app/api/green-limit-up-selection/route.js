import { NextResponse } from "next/server.js";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isChinaAShareNonTradingDay } from "../../../lib/ashare-trading-calendar.js";
import { getMarketDataBatch, hydrateQfqDailyQuoteWindow } from "../../../lib/market-data.js";
import { runDailyMarketTask, loadDailyMarket } from "../daily-market/route.js";
import { selectGreenMainBoardRecentLimitUps } from "../../lib/greenLimitUpSelection.js";
import { scoreGreenLimitUpCandidates } from "../../lib/greenLimitUpScoring.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WINDOW_TRADING_DAYS = 10;
const TERTIARY_SCORE_WINDOW_DAYS = 5;
const TERTIARY_RECENCY_WEIGHTS = [1, 2, 3, 4, 5];
const STOCK_MAP_PATH = path.join(process.cwd(), "data", "stock_sector_map.json");
const UPTREND_SCORE_SCRIPT = path.join(process.cwd(), "scripts", "uptrend_score.py");
const UPTREND_PYTHON = process.env.UPTREND_PYTHON || path.join(process.cwd(), ".venv-uptrend312", "bin", "python");
const UPTREND_MINIMUM_SCORE = 60;
const UPTREND_ANALYSIS_DAYS = 60;
const UPPER_SHADOW_RECENT_DAYS = 3;
const UPPER_SHADOW_TURNOVER_BASELINE_DAYS = 5;
const execFileAsync = promisify(execFile);
const qfqHydrationJobs = new Map();
const qfqHydrationJobsByDate = new Map();

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

function scoreCandidates(candidates) {
  return scoreGreenLimitUpCandidates(candidates);
}

export function upperShadowTurnoverDates(tradingDates = []) {
  return tradingDates.slice(-(UPPER_SHADOW_RECENT_DAYS + UPPER_SHADOW_TURNOVER_BASELINE_DAYS));
}

// The green-close condition is allowed to use a fresh intraday quote, but an
// unfinished session cannot be treated as a confirmed daily candle for trend
// scoring.  During the session, score only through the immediately preceding
// confirmed trading day; after the close, include the current day.  This keeps
// the two observations distinct and avoids both future leakage and a false
// "missing qfq data" failure before providers publish the daily bar.
export function trendAsOfDate(today, selectionDates = []) {
  if (today?.snapshot?.closing_confirmed) return today.date;
  const preceding = selectionDates.at(-2);
  if (!preceding) throw new Error("盘中趋势评分缺少上一交易日收盘快照");
  return preceding;
}

// The trend scorer reads the cache directly so that its OHLC input and the
// reported daily turnover rate retain their separate, auditable sources.  Do
// not derive turnover from 5-minute volume or substitute a later rate.
async function hydrateUpperShadowTurnoverRates(candidates, tradingDates) {
  const dates = upperShadowTurnoverDates(tradingDates);
  const members = candidates.map(({ code, name }) => ({ code, name }));
  if (!members.length || !dates.length) return { requested: 0, available: 0, missing: 0, dates };
  const batches = await Promise.all(dates.map((date) => getMarketDataBatch({
    kind: "daily_turnover_rate", date, members, concurrency: 8,
  })));
  let available = 0;
  for (const batch of batches) for (const record of batch.values()) if (!record?.error && Number.isFinite(Number(record?.turnover_rate)) && Number(record.turnover_rate) > 0) available += 1;
  return { requested: members.length * dates.length, available, missing: members.length * dates.length - available, dates };
}

async function calculateMainlineSnapshot(date) {
  const { GET: getMainline } = await import("../mainline/route.js");
  const response = await getMainline(new Request(`http://localhost/api/mainline?date=${encodeURIComponent(date)}`));
  const payload = await response.json();
  if (!response.ok || payload?.error) {
    throw new Error(`主线评分计算失败：${payload?.error || `HTTP ${response.status}`}`);
  }
  return payload;
}

// A selection is a derived decision, never a persisted result.  Each request
// re-runs the canonical mainline calculation from the reusable daily records.
export async function loadMainlineSnapshotForTertiaryScores(endDate, {
  calculateSnapshot = calculateMainlineSnapshot,
} = {}) {
  return calculateSnapshot(endDate);
}

async function attachRecentTertiaryScores(candidates, dates, endDate) {
  if (!candidates.length) return { candidates: [], unavailable: [] };
  if (dates.length !== TERTIARY_SCORE_WINDOW_DAYS) throw new Error(`三级板块评分需要完整的 ${TERTIARY_SCORE_WINDOW_DAYS} 个交易日`);
  const [stockMap, mainline] = await Promise.all([
    readFile(STOCK_MAP_PATH, "utf8").then(JSON.parse),
    loadMainlineSnapshotForTertiaryScores(endDate),
  ]);
  const stocks = new Map((stockMap.stocks || []).map((stock) => [stock.code, stock]));
  const themes = new Map((mainline.tertiary_themes || []).map((theme) => [theme.key, theme]));
  const eligible = [];
  const unavailable = [];
  const weightTotal = TERTIARY_RECENCY_WEIGHTS.reduce((total, weight) => total + weight, 0);
  for (const candidate of candidates) {
    const paths = [];
    for (const item of stocks.get(candidate.code)?.classifications || []) for (const tertiary of item.tertiary_sectors || []) {
      paths.push({ primary: item.primary_sector, secondary: item.secondary_sector, tertiary });
    }
    const options = [];
    for (const path of paths) {
      const { primary, secondary, tertiary } = path;
      const theme = themes.get(`${primary}__${secondary}__${tertiary}`);
      const scoreByDate = new Map((theme?.score_history || []).map((point) => [point.date, Number(point?.daily_strength_score)]));
      const dailyScores = dates.map((date) => ({ date, daily_strength_score: scoreByDate.get(date) }));
      if (!dailyScores.every((point) => Number.isFinite(point.daily_strength_score))) continue;
      const score = dailyScores.reduce((total, point, index) => total + point.daily_strength_score * TERTIARY_RECENCY_WEIGHTS[index], 0) / weightTotal;
      options.push({
        score,
        primary,
        secondary,
        tertiary,
        dates: [...dates],
        weights: [...TERTIARY_RECENCY_WEIGHTS],
        daily_scores: dailyScores,
      });
    }
    options.sort((left, right) => right.score - left.score
      || left.primary.localeCompare(right.primary, "zh-CN")
      || left.secondary.localeCompare(right.secondary, "zh-CN")
      || left.tertiary.localeCompare(right.tertiary, "zh-CN"));
    if (options.length) {
      eligible.push({ ...candidate, sector_paths: paths, tertiary_score: options[0] });
    } else {
      unavailable.push({
        code: candidate.code,
        name: candidate.name || "",
        missing_data: [paths.length ? "近 5 日三级板块综合评分" : "三级板块归属"],
      });
    }
  }
  return { candidates: eligible, unavailable };
}

// Keep the selector hierarchy in the API contract rather than rebuilding it
// only in the browser.  That makes the rows and the directory derive from the
// same scored candidate set, and makes a missing directory observable instead
// of silently rendering an empty left column.
export function buildSecondaryRankings(scoredStocks = []) {
  const groups = new Map();
  for (const stock of scoredStocks) for (const path of stock.sector_paths || []) {
    if (!path?.primary || !path?.secondary) continue;
    const key = `${path.primary}|${path.secondary}`;
    const group = groups.get(key) || { primary: path.primary, secondary: path.secondary, stocks: new Map() };
    group.stocks.set(String(stock.code), stock);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => {
    const stocks = Array.from(group.stocks.values());
    const scores = stocks.map((stock) => Number(stock.scores?.total)).filter(Number.isFinite);
    return {
      primary: group.primary,
      secondary: group.secondary,
      candidate_count: stocks.length,
      average_total_score: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      highest_total_score: Math.max(...scores),
    };
  }).sort((left, right) => right.average_total_score - left.average_total_score
    || right.highest_total_score - left.highest_total_score
    || right.candidate_count - left.candidate_count
    || left.primary.localeCompare(right.primary, "zh-CN")
    || left.secondary.localeCompare(right.secondary, "zh-CN"))
    .map((group, index) => ({ ...group, rank: index + 1 }));
}

export function buildSectorCatalog(scoredStocks = [], secondaryRankings = buildSecondaryRankings(scoredStocks)) {
  const rankingByKey = new Map(secondaryRankings.map((group) => [`${group.primary}|${group.secondary}`, group]));
  const primaries = new Map();
  for (const stock of scoredStocks) {
    for (const path of stock.sector_paths || []) {
      if (!path?.primary || !path?.secondary || !path?.tertiary) continue;
      const secondaryMap = primaries.get(path.primary) || new Map();
      const tertiaryMap = secondaryMap.get(path.secondary) || new Map();
      const candidateCodes = tertiaryMap.get(path.tertiary) || new Set();
      candidateCodes.add(String(stock.code));
      tertiaryMap.set(path.tertiary, candidateCodes);
      secondaryMap.set(path.secondary, tertiaryMap);
      primaries.set(path.primary, secondaryMap);
    }
  }
  return Array.from(primaries, ([primary, secondaryMap]) => ({
    primary,
    secondaries: Array.from(secondaryMap, ([secondary, tertiaryMap]) => ({
      secondary,
      ...rankingByKey.get(`${primary}|${secondary}`),
      tertiaries: Array.from(tertiaryMap, ([tertiary, candidateCodes]) => ({
        tertiary,
        candidate_codes: Array.from(candidateCodes).sort(),
      })).sort((left, right) => left.tertiary.localeCompare(right.tertiary, "zh-CN")),
    })).sort((left, right) => left.rank - right.rank),
  })).sort((left, right) => left.primary.localeCompare(right.primary, "zh-CN"));
}

function uptrendPresentation(score = {}) {
  const ma = score.evidence?.ma || {};
  const upperShadow = score.evidence?.upper_shadow || {};
  return {
    source: "uptrend_score_v1",
    score: Number(score.trend_score),
    ma5: Number(ma.ma5), ma10: Number(ma.ma10), ma20: Number(ma.ma20),
    components: {
      ma_score: Number(score.ma_score), structure_score: Number(score.structure_score), persistence_score: Number(score.persistence_score),
      stability_score: Number(score.stability_score), volume_score: Number(score.volume_score),
      raw_trend_score: Number(score.raw_trend_score), upper_shadow_penalty: Number(score.upper_shadow_penalty),
    },
    upper_shadow: upperShadow,
    reason: score.reason || "",
  };
}

export function selectCandidatesByUptrendScore(candidates, scoreRows, minimumScore = UPTREND_MINIMUM_SCORE) {
  const byCode = new Map((scoreRows || []).map((row) => [String(row.code), row]));
  const unavailable = [];
  const qualified = [];
  for (const candidate of candidates || []) {
    const score = byCode.get(String(candidate.code));
    const trendScore = score?.trend_score;
    if (trendScore === null || trendScore === undefined || trendScore === "" || !Number.isFinite(Number(trendScore))) {
      unavailable.push({ code: candidate.code, name: candidate.name || "", missing_data: score?.missing_data || ["上涨趋势评分"] });
      continue;
    }
    // The user-selected rule is strictly greater than 60; exactly 60 does
    // not pass and is retained in neither list as a qualified candidate.
    if (Number(trendScore) > minimumScore) qualified.push({ ...candidate, uptrend: uptrendPresentation(score) });
  }
  return { candidates: qualified, unavailable };
}

async function scoreUptrendCandidates(candidates, date, tradingDates) {
  if (!candidates.length) return [];
  if (!Array.isArray(tradingDates) || !tradingDates.length) throw new Error("上涨趋势评分缺少已核验交易日窗口");
  let stdout;
  try {
    ({ stdout } = await execFileAsync(UPTREND_PYTHON, [UPTREND_SCORE_SCRIPT, "--date", date, "--dates", tradingDates.join(","), "--codes", candidates.map((candidate) => candidate.code).join(",")], {
      cwd: process.cwd(), maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
    }));
  } catch (error) {
    throw new Error(`上涨趋势评分不可用：${error.message}`);
  }
  try {
    const payload = JSON.parse(stdout);
    if (!Array.isArray(payload.results)) throw new Error("结果缺少 results 数组");
    return payload.results;
  } catch (error) {
    throw new Error(`上涨趋势评分返回无效：${error.message}`);
  }
}

function candidatesEligibleForTurnoverHydration(candidates, scoreRows) {
  const byCode = new Map((scoreRows || []).map((row) => [String(row.code), row]));
  // The risk rule can only deduct.  A stock whose raw score is already at or
  // below the strict 60-point threshold cannot enter later stages, so avoid
  // fetching eight historical rate records for it.
  return candidates.filter((candidate) => Number(byCode.get(String(candidate.code))?.raw_trend_score) > UPTREND_MINIMUM_SCORE);
}

function qfqHydrationSnapshot(job) {
  if (!job) return { state: "not_started" };
  return {
    state: job.state,
    total_candidates: job.total,
    verified_candidates: job.verified,
    failed_candidates: job.failed,
    started_at: job.started_at,
    completed_at: job.completed_at || null,
    retry_after_seconds: job.state === "preparing" ? 8 : null,
  };
}

export function finalizeQfqHydrationJob(job, results = []) {
  const completed = Array.isArray(results) ? results.length : 0;
  // `hydrateQfqDailyQuoteWindow` handles individual member failures instead
  // of rejecting the entire batch.  Therefore a fulfilled Promise is not
  // evidence that all candidate windows are usable for scoring.
  job.verified = results.filter((result) => result?.ok).length;
  job.failed = Math.max(0, job.total - job.verified, completed - job.verified);
  job.state = job.failed === 0 ? "complete" : job.verified > 0 ? "partial" : "failed";
  job.completed_at = new Date().toISOString();
  return job;
}

function startQfqHydration(endDate, candidates, dates, { retry = false } = {}) {
  // The same selection date has two legitimate windows: intraday ends at the
  // previous close, while the post-close run includes today.  Keep their
  // cache-preparation jobs separate so a failed intraday request cannot mask
  // the later confirmed-close window (or vice versa).
  const key = `${endDate}|${dates.join(",")}|${candidates.map((candidate) => candidate.code).sort().join(",")}`;
  const current = qfqHydrationJobs.get(key);
  if (current && (!retry || current.state === "preparing")) return current;
  const job = {
    state: "preparing", total: candidates.length, verified: 0, failed: 0,
    started_at: new Date().toISOString(), completed_at: null,
  };
  qfqHydrationJobs.set(key, job);
  qfqHydrationJobsByDate.set(endDate, job);
  // Do not make a scan silently fall back to unadjusted local bars while this
  // runs.  The modal receives explicit preparation status and retries after
  // audited rows have accumulated.
  void hydrateQfqDailyQuoteWindow({
    dates, members: candidates, concurrency: 6,
    onMember: (result) => {
      if (result.ok) job.verified += 1;
      else job.failed += 1;
    },
  }).then((results) => {
    finalizeQfqHydrationJob(job, Array.from(results.values()));
  }).catch((error) => {
    job.state = "failed";
    job.error = error.message;
    job.completed_at = new Date().toISOString();
  });
  return job;
}

export async function buildGreenLimitUpSelection(endDate, { retryQfqHydration = false } = {}) {
  const dates = await recentTradingDates(endDate);
  const snapshots = await Promise.all(dates.map(async (date, index) => {
    const payload = await loadDailyMarket(date, { localOnly: true, strictTradingDay: true });
    if (payload.error) throw new Error(`${date}：${payload.error}`);
    const isToday = index === dates.length - 1;
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
  const trendDate = trendAsOfDate(today, dates);
  // The score script accepts a local snapshot only as its volume scaffold;
  // all prices must be pre-verified qfq OHLC for the complete 60-day window.
  // Prepare this independently from the request so an uncached first run is
  // visibly pending rather than falsely reported as zero qualified stocks.
  const qfqDates = await recentTradingDates(trendDate, UPTREND_ANALYSIS_DAYS);
  const qfqHydration = startQfqHydration(today.date, initialStocks, qfqDates, { retry: retryQfqHydration });
  const preliminaryUptrendRows = await scoreUptrendCandidates(initialStocks, trendDate, qfqDates);
  const turnoverCandidates = candidatesEligibleForTurnoverHydration(initialStocks, preliminaryUptrendRows);
  const upperShadowTurnover = await hydrateUpperShadowTurnoverRates(turnoverCandidates, qfqDates);
  const uptrendRows = turnoverCandidates.length ? await scoreUptrendCandidates(initialStocks, trendDate, qfqDates) : preliminaryUptrendRows;
  const uptrendFilter = selectCandidatesByUptrendScore(initialStocks, uptrendRows);
  const trendStocks = uptrendFilter.candidates;
  const tertiaryFilter = await attachRecentTertiaryScores(trendStocks, dates.slice(-TERTIARY_SCORE_WINDOW_DAYS), today.date);
  const stocks = tertiaryFilter.candidates;
  const scoring = scoreCandidates(stocks);
  const rankedStocks = scoring.scored.map((stock, index) => ({ ...stock, total_rank: index + 1 }));
  const secondaryRankings = buildSecondaryRankings(rankedStocks);
  const sectorCatalog = buildSectorCatalog(rankedStocks, secondaryRankings);
  return {
    date: today.date,
    trading_dates: dates,
    rule: {
      today: "当日最新价 < 昨收价（收盘后等同于收盘价）",
      board: "仅沪深主板代码：000/001/002/003/600/601/603/605",
      trend: "日K上涨趋势评分严格大于 60 分：均线趋势 25 分 + 高低点结构 25 分 + 上涨持续性 20 分 + 回调稳定性 20 分 + 成交量配合 10 分，再扣除近 3 日上影线风险；上影越长扣分越多，换手率相对前 5 日放大时加深扣分",
      tertiary_score: "每只股票的每个所属三级方向取最近 5 个交易日 daily_strength_score，按 1:2:3:4:5（越近权重越高）加权；使用可完整计算方向中的最高分，不设置 80 分硬门槛",
      limit_up_price: "普通主板按昨收上浮 10%、名称标记 ST/*ST/S*ST/SST 的股票按 5%，均按 ¥0.01 四舍五入",
    },
    initial_candidate_count: initialStocks.length,
    trend_qualified_count: trendStocks.length,
    trend_scoring_status: qfqHydrationSnapshot(qfqHydration),
    uptrend_unavailable_candidates: uptrendFilter.unavailable,
    tertiary_unavailable_candidates: tertiaryFilter.unavailable,
    candidate_count: stocks.length,
    stocks,
    scored_candidate_count: scoring.scored.length,
    scored_stocks: rankedStocks,
    sector_catalog: sectorCatalog,
    secondary_rankings: secondaryRankings,
    unscored_candidates: scoring.unavailable,
    scoring: {
      total: "上涨趋势 80% + 近 5 日三级板块综合评分 20%",
      trend: "上涨趋势评分：均线趋势 25 分 + 高低点结构 25 分 + 上涨持续性 20 分 + 回调稳定性 20 分 + 成交量配合 10 分，扣除近 3 日上影线风险；仅最终总分严格大于 60 的股票进入后续评分",
      tertiary: "所属三级方向最近 5 个交易日的系统 daily_strength_score，按 1:2:3:4:5 加权，离当前日越近权重越高；缺少任一日评分的方向不参与该股票评分",
      missing_data: "缺少完整三级归属或最近 5 日三级评分的股票不计算总分；绝不以默认分补齐",
    },
    data_quality: {
      source: "本地 5 分钟 Parquet 全市场快照",
      closing_confirmed_dates: dates,
      tertiary_score_dates: dates.slice(-TERTIARY_SCORE_WINDOW_DAYS),
      upper_shadow_turnover_rates: upperShadowTurnover,
      qfq_price_audits: { as_of_date: trendDate, dates: qfqDates, verification: "同花顺前复权 OHLC 与腾讯前复权 OHLC 一致" },
      today_snapshot: today.snapshot?.closing_confirmed ? "closing_confirmed" : "fresh_intraday",
    },
  };
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const date = params.get("date") || "";
  if (!DATE_PATTERN.test(date)) return NextResponse.json({ error: "date 必须为 YYYY-MM-DD" }, { status: 400 });
  // Progress polling observes only the in-flight raw-data audit.  It must not
  // trigger another selection/mainline calculation every few seconds.
  if (params.get("progress") === "1") return NextResponse.json({ date, trend_scoring_status: qfqHydrationSnapshot(qfqHydrationJobsByDate.get(date)) });
  try {
    const payload = await runDailyMarketTask(() => buildGreenLimitUpSelection(date, { retryQfqHydration: params.get("retry") === "1" }));
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: error.message || "选股条件计算失败" }, { status: 409 });
  }
}
