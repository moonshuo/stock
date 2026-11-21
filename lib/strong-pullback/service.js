import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { isStStockName } from "../../app/lib/sectorSystem.js";
import { scoreStrongPullback, validateStrongPullbackConfig } from "./scoring.js";

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, "data", "strong_pullback_config.json");
const STOCK_MAP_PATH = path.join(ROOT, "data", "stock_sector_map.json");
const OUTPUT_DIR = path.join(ROOT, "output", "strong_pullback");
const finite = (value) => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function mergeConfig(base, override = {}) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object") merged[key] = { ...base[key], ...value };
    else if (["version", "status", "disclaimer"].includes(key)) merged[key] = base[key];
  }
  return validateStrongPullbackConfig(merged);
}

async function availableMarketDates(endDate, count) {
  const years = (await readdir(path.join(ROOT, "5分钟数据"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name)).map((entry) => entry.name);
  const compactEnd = String(endDate).replace(/\D/g, "");
  const files = [];
  for (const year of years) {
    if (year > compactEnd.slice(0, 4)) continue;
    const names = await readdir(path.join(ROOT, "5分钟数据", year));
    files.push(...names.filter((name) => /^\d{8}\.parquet$/.test(name) && name.slice(0, 8) <= compactEnd)
      .map((name) => `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}`));
  }
  return files.sort().slice(-count);
}

async function mapLimit(items, limit, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await worker(items[index], index);
    }
  }));
  return result;
}

async function loadDailyMetricsByDate(date, codes) {
  const directory = path.join(ROOT, "data", "daily_turnover_rate", date);
  let names;
  try { names = await readdir(directory); } catch { return new Map(); }
  const codeSet = new Set(codes);
  const files = names.filter((name) => /^\d{6}\.json$/.test(name) && codeSet.has(name.slice(0, 6)));
  const rows = await mapLimit(files, 64, async (name) => {
    try {
      const record = await readJson(path.join(directory, name));
      const turnoverRate = finite(record.turnover_rate);
      const volume = finite(record.historical_quote?.volume);
      const amount = finite(record.historical_quote?.amount);
      return turnoverRate === null && !(volume > 0) ? null : [name.slice(0, 6), { turnover_rate: turnoverRate, volume: volume > 0 ? volume : null, amount: amount > 0 ? amount : null }];
    } catch { return null; }
  });
  return new Map(rows.filter(Boolean));
}

function clockMinute(value) {
  const match = String(value || "").match(/(?:T|\s)(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

async function attachIntradaySameTimeComparisons({ date, histories, historyDates, dailyMetrics, minimumDays }) {
  const directory = path.join(ROOT, "data", "intraday_5m");
  let dates;
  try {
    dates = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name < date && historyDates.includes(entry.name))
      .map((entry) => entry.name).sort();
  } catch {
    return { comparable_stocks: 0, historical_dates: [] };
  }
  const metricsByDate = new Map(historyDates.map((day, index) => [day, dailyMetrics[index]]));
  const observations = new Map();
  for (const day of dates) {
    let files;
    try { files = (await readdir(path.join(directory, day))).filter((name) => /^\d{6}\.json$/.test(name) && histories.has(name.slice(0, 6))); }
    catch { continue; }
    const records = await mapLimit(files, 32, async (name) => {
      const code = name.slice(0, 6);
      const current = histories.get(code)?.at(-1);
      const targetMinute = clockMinute(current?.trade_time);
      const daily = metricsByDate.get(day)?.get(code);
      if (!Number.isFinite(targetMinute) || !(daily?.volume > 0) || !(daily?.turnover_rate > 0)) return null;
      try {
        const record = await readJson(path.join(directory, day, name));
        const volume = (record.bars || []).filter((bar) => {
          const minute = clockMinute(bar.time);
          return Number.isFinite(minute) && minute <= targetMinute;
        }).reduce((sum, bar) => sum + Math.max(0, finite(bar.volume) || 0), 0);
        if (!(volume > 0)) return null;
        const floatShares = daily.volume / (daily.turnover_rate / 100);
        return floatShares > 0 ? { code, date: day, volume, turnover_rate: volume / floatShares * 100, float_shares: floatShares } : null;
      } catch { return null; }
    });
    for (const record of records.filter(Boolean)) {
      if (!observations.has(record.code)) observations.set(record.code, []);
      observations.get(record.code).push(record);
    }
  }
  let comparableStocks = 0;
  for (const [code, samples] of observations) {
    if (samples.length < minimumDays) continue;
    const current = histories.get(code)?.at(-1);
    const currentVolume = finite(current?.raw_volume);
    const averageVolume = samples.reduce((sum, item) => sum + item.volume, 0) / samples.length;
    const averageTurnover = samples.reduce((sum, item) => sum + item.turnover_rate, 0) / samples.length;
    const averageFloatShares = samples.reduce((sum, item) => sum + item.float_shares, 0) / samples.length;
    if (!(currentVolume > 0 && averageVolume > 0 && averageTurnover > 0 && averageFloatShares > 0)) continue;
    const currentTurnover = currentVolume / averageFloatShares * 100;
    Object.assign(current, {
      turnover_rate: currentTurnover,
      intraday_volume_ratio: currentVolume / averageVolume,
      intraday_turnover_ratio: currentTurnover / averageTurnover,
      intraday_comparison_days: samples.length,
      intraday_same_time_comparable: true,
    });
    comparableStocks += 1;
  }
  return { comparable_stocks: comparableStocks, historical_dates: dates };
}

function boardKey(primary, secondary) {
  return `${primary || ""}__${secondary || ""}`;
}

function tertiaryKey(primary, secondary, tertiary) {
  return `${primary || ""}__${secondary || ""}__${tertiary || ""}`;
}

async function loadBoardSnapshot(date, currentMarket, analyzeMainlines, loadDailyMarket) {
  const file = path.join(ROOT, "output", `mainline_${date}.json`);
  let payload = null;
  let fileInfo = null;
  let snapshotReadError = null;
  try { [payload, fileInfo] = await Promise.all([readJson(file), stat(file)]); } catch (error) { snapshotReadError = error.message; }
  const currentVersion = String(currentMarket?.snapshot_id || "").split("|").slice(1).join("|");
  const reusable = payload?.date === date && (!currentVersion || !payload.market_snapshot_version || payload.market_snapshot_version === currentVersion);
  if (!reusable) {
    if (typeof analyzeMainlines !== "function") throw new Error(`${date} 缺少与当前行情一致的板块评分快照`);
    payload = await analyzeMainlines(date, (value) => loadDailyMarket(value, { localOnly: true, strictTradingDay: true }));
    fileInfo = null;
  }
  const timestamp = currentMarket?.snapshot?.captured_at || currentMarket?.snapshot?.latest_quote_time || (fileInfo ? fileInfo.mtime.toISOString() : null);
  return { payload, timestamp, source: reusable ? path.relative(ROOT, file) : "live_mainline_calculation", fallback_reason: reusable ? null : snapshotReadError || "persisted_snapshot_not_reusable" };
}

async function loadRecentBoardRanks(dates, currentPayload) {
  const rows = [];
  const failures = [];
  for (const date of dates.slice(-5)) {
    if (date === currentPayload.date) {
      rows.push({ date, themes: (currentPayload.themes || currentPayload.all_themes || []).map((theme) => ({ key: theme.key || boardKey(theme.primary, theme.name), rank: theme.mainline_rank ?? theme.rank, score: theme.mainline_rank_score ?? theme.score })) });
      continue;
    }
    try {
      const debug = await readJson(path.join(ROOT, "output", `mainline_debug_${date}.json`));
      rows.push({ date, themes: (debug.themes || []).map((theme) => {
        const [primary, secondary] = String(theme.theme || "").split(" / ");
        return { key: boardKey(primary, secondary), rank: theme.rank, score: theme.score };
      }) });
    } catch (error) { failures.push({ date, error: error.message }); }
  }
  const byTheme = new Map();
  for (const row of rows) for (const theme of row.themes) {
    if (!byTheme.has(theme.key)) byTheme.set(theme.key, []);
    byTheme.get(theme.key).push({ date: row.date, rank: finite(theme.rank), score: finite(theme.score) });
  }
  return { byTheme, covered_dates: rows.map((row) => row.date), requested_dates: dates.slice(-5), failures };
}

function selectBoard(stock, secondaryByKey, tertiaryByKey, rankHistory, sectorTimestamp, marketDate) {
  const candidates = [];
  for (const classification of stock.classifications || []) {
    const primary = classification.primary_sector || stock.primary_sector || "";
    const secondary = classification.secondary_sector || "";
    const secondaryTheme = secondaryByKey.get(boardKey(primary, secondary));
    for (const tertiary of classification.tertiary_sectors?.length ? classification.tertiary_sectors : [""]) {
      const tertiaryTheme = tertiaryByKey.get(tertiaryKey(primary, secondary, tertiary));
      candidates.push({ primary, secondary, tertiary, secondaryTheme, tertiaryTheme, relevance_score: finite(classification.relevance_score) });
    }
  }
  candidates.sort((left, right) => (finite(right.secondaryTheme?.mainline_rank_score ?? right.secondaryTheme?.score) ?? -Infinity) - (finite(left.secondaryTheme?.mainline_rank_score ?? left.secondaryTheme?.score) ?? -Infinity)
    || (right.relevance_score ?? 0) - (left.relevance_score ?? 0));
  const selected = candidates[0];
  if (!selected) return null;
  const secondaryScore = finite(selected.secondaryTheme?.mainline_rank_score ?? selected.secondaryTheme?.score);
  const tertiaryScore = finite(selected.tertiaryTheme?.mainline_rank_score ?? selected.tertiaryTheme?.score);
  const history = rankHistory.get(boardKey(selected.primary, selected.secondary)) || [];
  return {
    primary: selected.primary, secondary: selected.secondary, tertiary: selected.tertiary,
    secondary_score: secondaryScore,
    secondary_rank: finite(selected.secondaryTheme?.mainline_rank ?? selected.secondaryTheme?.rank),
    tertiary_score: tertiaryScore,
    tertiary_rank: finite(selected.tertiaryTheme?.mainline_rank ?? selected.tertiaryTheme?.rank),
    recent_rank_history: history,
    recent_rank_change: history.length > 1 && history[0].rank !== null && history.at(-1).rank !== null ? history[0].rank - history.at(-1).rank : null,
    score_date: selected.secondaryTheme ? marketDate : null,
    score_timestamp: sectorTimestamp,
    stale: !selected.secondaryTheme,
    alternatives: candidates.slice(1, 5).map((item) => ({ primary: item.primary, secondary: item.secondary, tertiary: item.tertiary, secondary_score: finite(item.secondaryTheme?.mainline_rank_score ?? item.secondaryTheme?.score), tertiary_score: finite(item.tertiaryTheme?.mainline_rank_score ?? item.tertiaryTheme?.score) })),
  };
}

function explanation(result) {
  const factors = result.dimensions.flatMap((dimension) => [
    Number.isFinite(dimension.score) ? { label: dimension.label, score: dimension.score, contribution: dimension.contribution, raw: dimension.raw } : null,
    ...(dimension.items || []).filter((item) => Number.isFinite(item.score)).map((item) => ({ label: item.label, score: item.score, contribution: item.contribution, raw: item.raw, unit: item.unit })),
  ]).filter(Boolean);
  return {
    positive: [...factors].sort((a, b) => b.score - a.score).slice(0, 3),
    negative: [...factors].sort((a, b) => a.score - b.score).slice(0, 3),
    low_score_reason: result.score === null
      ? `不能形成完整分：${[...result.completeness.missing_dimensions, ...result.completeness.issues].join("、") || "数据不足"}`
      : [...factors].sort((a, b) => a.score - b.score).slice(0, 2).map((item) => `${item.label} ${item.score.toFixed(1)} 分`).join("；"),
  };
}

function sortResults(results, sortBy) {
  const key = sortBy === "sector_strength" || sortBy === "recent_initiation" || sortBy === "pullback_quality" || sortBy === "trend_structure" ? sortBy : "score";
  const value = (item) => key === "score" ? finite(item.score) : finite(item.dimensions.find((dimension) => dimension.key === key)?.score);
  return [...results].sort((left, right) => (value(right) ?? -Infinity) - (value(left) ?? -Infinity) || left.code.localeCompare(right.code));
}

export async function analyzeStrongPullbacks({ date, requestedMode = "auto", configOverride = {}, sortBy = "score", displayFilterEnabled, code = "", resultLimit = 200, loadDailyMarket, analyzeMainlines } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("date 必须为 YYYY-MM-DD");
  if (typeof loadDailyMarket !== "function") throw new Error("loadDailyMarket dependency is required");
  const [baseConfig, stockMapDocument] = await Promise.all([readJson(CONFIG_PATH), readJson(STOCK_MAP_PATH)]);
  const config = mergeConfig(baseConfig, configOverride);
  const requiredHistoryDays = Math.max(
    config.windows.history_trading_days + 1,
    config.windows.price_position_days + config.windows.initiation_search_days + 1,
    config.windows.trend_long_ma_days + 1,
  );
  const historyDates = await availableMarketDates(date, requiredHistoryDays);
  if (historyDates.at(-1) !== date) throw new Error(`${date} 没有本地行情文件，不能用其他日期代替`);
  const markets = await mapLimit(historyDates, 4, async (day) => {
    const market = await loadDailyMarket(day, { localOnly: true, strictTradingDay: true });
    if (market?.error) throw new Error(`${day}: ${market.error}`);
    return market;
  });
  const currentMarket = markets.at(-1);
  const mode = requestedMode === "intraday" || requestedMode === "close" ? requestedMode : currentMarket.snapshot?.closing_confirmed ? "close" : "intraday";
  if (mode === "close" && !currentMarket.snapshot?.closing_confirmed) throw new Error("当前行情尚未确认到 15:00，不能生成收盘确认分");
  const boardSnapshot = await loadBoardSnapshot(date, currentMarket, analyzeMainlines, loadDailyMarket);
  const rankHistory = await loadRecentBoardRanks(historyDates, boardSnapshot.payload);
  const secondaryByKey = new Map((boardSnapshot.payload.themes || boardSnapshot.payload.all_themes || []).map((theme) => [theme.key || boardKey(theme.primary, theme.name), theme]));
  const tertiaryByKey = new Map((boardSnapshot.payload.tertiary_themes || []).map((theme) => [theme.key || tertiaryKey(theme.primary, theme.secondary, theme.name), theme]));
  const stocks = stockMapDocument.stocks || [];
  const stockByCode = new Map(stocks.map((stock) => [String(stock.code), stock]));
  const targetCode = String(code || "").replace(/\D/g, "");
  const histories = new Map(stocks.map((stock) => [String(stock.code), []]));
  for (const market of markets) {
    const quotes = [...(market.stocks || []), ...(market.excludedStocks || [])];
    for (const quote of quotes) {
      const rows = histories.get(String(quote.code));
      if (!rows) continue;
      rows.push({ date: market.date, open: finite(quote.open), high: finite(quote.high), low: finite(quote.low), close: finite(quote.price), pre_close: finite(quote.preClose), change_pct: finite(quote.changePct), volume: null, raw_volume: finite(quote.vol), amount: finite(quote.amount), trade_time: quote.tradeTime, intraday_same_time_comparable: mode === "close" });
    }
  }
  // Materialise once: Map iterators are single-use and would otherwise make
  // only the first trading date receive verified volume/turnover records.
  const metricCodes = targetCode ? [targetCode] : [...stockByCode.keys()];
  const dailyMetrics = await mapLimit(historyDates, 3, (day) => loadDailyMetricsByDate(day, metricCodes));
  historyDates.forEach((day, index) => {
    for (const [stockCode, value] of dailyMetrics[index]) {
      const row = histories.get(stockCode)?.find((item) => item.date === day);
      if (row) {
        row.turnover_rate = value.turnover_rate;
        row.volume = value.volume;
        if (value.amount) row.amount = value.amount;
      }
    }
  });
  const intradayComparison = mode === "intraday"
    ? await attachIntradaySameTimeComparisons({ date, histories, historyDates, dailyMetrics, minimumDays: config.windows.intraday_minimum_comparison_days })
    : { comparable_stocks: 0, historical_dates: [] };
  const scored = [];
  const poolExcluded = [];
  for (const stock of stocks) {
    if (targetCode && String(stock.code) !== targetCode) continue;
    const poolIssues = [];
    if (config.pool.exclude_st && isStStockName(stock.name)) poolIssues.push("st_excluded_by_pool_config");
    if (config.pool.minimum_listing_days !== null) poolIssues.push("listing_date_unavailable");
    if (poolIssues.length) {
      poolExcluded.push({ code: stock.code, name: stock.name, reasons: poolIssues });
      continue;
    }
    const board = selectBoard(stock, secondaryByKey, tertiaryByKey, rankHistory.byTheme, boardSnapshot.timestamp, date);
    const result = scoreStrongPullback({ stock, rows: histories.get(String(stock.code)) || [], board, config, mode });
    result.board = board;
    result.pool = { eligible: true, st_check: config.pool.exclude_st ? "passed" : "disabled", listing_days_check: config.pool.minimum_listing_days === null ? "disabled" : "unavailable" };
    result.explanation = explanation(result);
    scored.push(result);
  }
  const sortedAll = sortResults(scored, sortBy);
  let eligibleRank = 0;
  sortedAll.forEach((item) => { item.strategy_rank = item.completeness.ranking_eligible ? ++eligibleRank : null; });
  const filterEnabled = displayFilterEnabled === undefined ? config.display_filter.green_day_max_loss_enabled : Boolean(displayFilterEnabled);
  const displayed = targetCode ? sortedAll : filterEnabled ? sortedAll.filter((item) => item.display_filter_match) : sortedAll;
  const boundedLimit = Number.isInteger(Number(resultLimit)) && Number(resultLimit) > 0 ? Math.min(1000, Number(resultLimit)) : null;
  const returned = boundedLimit ? displayed.slice(0, boundedLimit) : displayed;
  const mapHash = createHash("sha256").update(JSON.stringify(stockMapDocument)).digest("hex").slice(0, 16);
  return {
    version: config.version, status: config.status, disclaimer: config.disclaimer,
    date, mode, generated_at: new Date().toISOString(),
    timestamps: { market: currentMarket.snapshot?.captured_at || currentMarket.snapshot?.latest_quote_time || null, sector_score: boardSnapshot.timestamp, sector_score_stale: boardSnapshot.payload.date !== date },
    sources: { market: currentMarket.parquetPath, market_snapshot_id: currentMarket.snapshot_id, sector_score: boardSnapshot.source, sector_score_fallback_reason: boardSnapshot.fallback_reason, turnover: "data/daily_turnover_rate/YYYY-MM-DD/*.json", membership: "data/stock_sector_map.json" },
    config,
    data_scope: {
      history_start: historyDates[0], history_end: historyDates.at(-1), history_trading_days: historyDates.length,
      board_rank_history_requested_dates: rankHistory.requested_dates, board_rank_history_covered_dates: rankHistory.covered_dates,
      board_rank_history_failures: rankHistory.failures,
      membership_version: stockMapDocument.version || null, membership_hash: mapHash,
      historical_membership_limitation: date < new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) ? "没有逐日成分关系版本；未保存过的历史日期不能宣称为严格无成分泄漏回放。" : null,
      historical_replay_eligible: date >= new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }),
      listing_date_available: false,
      intraday_same_time_status: mode === "intraday" ? (intradayComparison.comparable_stocks ? "partially_available" : "intraday_same_time_insufficient") : "not_applicable",
      intraday_same_time_comparable_stocks: intradayComparison.comparable_stocks,
      intraday_same_time_historical_dates: intradayComparison.historical_dates,
    },
    summary: {
      mapped_stocks: stocks.length, pool_eligible: scored.length, pool_excluded: poolExcluded.length,
      complete_scores: sortedAll.filter((item) => item.completeness.complete).length,
      incomplete_scores: sortedAll.filter((item) => !item.completeness.complete).length,
      display_filter_enabled: filterEnabled, displayed: displayed.length, returned: returned.length,
    },
    sort_by: sortBy,
    results: returned,
    all_result_count: sortedAll.length,
    pool_excluded: targetCode ? poolExcluded : poolExcluded.slice(0, 100),
  };
}

export async function saveStrongPullbackSnapshot(result) {
  if (!result?.date || !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) throw new Error("有效评分结果才能保存快照");
  if (result.data_scope?.historical_membership_limitation) throw new Error("缺少目标日成分关系快照，禁止把事后历史重算保存成正式每日快照");
  await mkdir(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `${result.date}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ ...result, snapshot_saved_at: new Date().toISOString() }, null, 2)}\n`, "utf8");
  await rename(temporary, file);
  return { path: path.relative(ROOT, file), date: result.date };
}

export async function readStrongPullbackSnapshot(date) {
  return readJson(path.join(OUTPUT_DIR, `${date}.json`));
}
