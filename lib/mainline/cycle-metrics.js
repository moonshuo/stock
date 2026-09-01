import { readFileSync } from "fs";
import path from "path";

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const median = (values) => {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  const i = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[i] : (rows[i - 1] + rows[i]) / 2;
};
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const limitUp = (code, pct) => (String(code).startsWith("300") || String(code).startsWith("301") || String(code).startsWith("688") ? pct >= 19.5 : String(code).startsWith("8") || String(code).startsWith("4") ? pct >= 29 : pct >= 9.8);
const change = (now, before) => Number.isFinite(now) && Number.isFinite(before) ? now - before : null;
const ratio = (now, before) => Number.isFinite(now) && Number.isFinite(before) && before !== 0 ? now / before - 1 : null;

function dailyRows(theme, day) {
  let byDay = themeDailyRowsCache.get(theme);
  if (!byDay) {
    byDay = new WeakMap();
    themeDailyRowsCache.set(theme, byDay);
  }
  const cached = byDay.get(day);
  if (cached) return cached;
  const quotes = day.__stockMap || new Map((day.stocks || []).map((stock) => [stock.code, stock]));
  const rows = theme.members.map((member) => ({ ...member, quote: quotes.get(member.code) }))
    .filter((item) => Number.isFinite(finite(item.quote?.changePct)));
  byDay.set(day, rows);
  return rows;
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

const percentile = (values, value) => {
  const usable = values.filter(Number.isFinite);
  if (!Number.isFinite(value) || !usable.length) return null;
  return usable.filter((item) => item <= value).length / usable.length;
};
const amountPoints = (ratio) => !Number.isFinite(ratio) ? null : ratio < .8 ? 0 : ratio < 1 ? 5 : ratio < 1.2 ? 12 : ratio < 1.5 ? 17 : 20;
const themeAmountPoints = (rank) => !Number.isFinite(rank) ? null : rank < .5 ? 0 : rank < .7 ? 4 : rank < .9 ? 7 : 10;
const marketAmountPoints = (rank) => !Number.isFinite(rank) ? null : rank < .7 ? 0 : rank < .9 ? 2 : 5;
const turnoverPoints = (ratio) => !Number.isFinite(ratio) ? null : ratio < .9 ? 0 : ratio < 1.1 ? 2 : ratio < 1.3 ? 3 : 5;
const floatCapCache = new Map();
const floatCapIndexCache = new Map();
const FLOAT_CAP_INDEX_DIR = path.join(process.cwd(), "data", "historical_market_cap_index");
const dayStockMapCache = new WeakMap();
const themeDailyRowsCache = new WeakMap();
function stockMapFor(day) {
  if (!day || typeof day !== "object") return new Map();
  const cached = dayStockMapCache.get(day);
  if (cached) return cached;
  const map = new Map((day.stocks || []).map((stock) => [stock.code, stock]));
  dayStockMapCache.set(day, map);
  return map;
}
function floatMarketCap(date, code) {
  const key = `${date}|${code}`;
  if (floatCapCache.has(key)) return floatCapCache.get(key);
  try {
    // The historical-cap cache is one JSON file per stock.  Reading those
    // files for every member of every theme turns a 10-day mainline scan
    // into tens of thousands of synchronous filesystem operations.  The
    // date index contains exactly the same cached values, keyed by code.
    // Keep the per-stock fallback so a missing/stale index cannot change a
    // score or silently fabricate a market-cap value.
    let index = floatCapIndexCache.get(date);
    if (!index) {
      try {
        const payload = JSON.parse(readFileSync(path.join(FLOAT_CAP_INDEX_DIR, `${date}.json`), "utf8"));
        index = payload?.values && typeof payload.values === "object" ? payload.values : {};
      } catch { index = {}; }
      floatCapIndexCache.set(date, index);
    }
    const indexedValue = finite(index[code]);
    const value = Number.isFinite(indexedValue)
      ? indexedValue
      : finite(JSON.parse(readFileSync(path.join(process.cwd(), "data", "historical_market_cap", date, `${code}.json`), "utf8")).free_float_market_cap);
    floatCapCache.set(key, value);
    return value;
  } catch { floatCapCache.set(key, null); return null; }
}

// Formal-emergence core evidence. It deliberately does not reuse the older
// capacity-core labels: the selected cores and every score are calculated here.
function strictCoreResponse(theme, daily, index, current) {
  const prior20 = daily.slice(Math.max(0, index - 20), index);
  const marketReturn = daily[index]?.__marketMedianReturn ?? median((daily[index]?.stocks || []).map((stock) => finite(stock.changePct)));
  const themeMedian = median(current.map((item) => finite(item.quote.changePct)));
  const rankedByCap = current.map((item) => {
    const history = prior20.map((day) => quoteFor(day, item.code)).filter(Boolean);
    return { ...item, history, averageAmount20: average(history.map((quote) => finite(quote.amount))), freeFloatMarketCap: floatMarketCap(daily[index]?.date, item.code) };
  }).filter((item) => Number.isFinite(item.averageAmount20) && Number.isFinite(item.freeFloatMarketCap)).sort((a, b) => b.freeFloatMarketCap - a.freeFloatMarketCap);
  const candidateCodes = new Set((theme.capacity_core_candidates || []).map((item) => item.code));
  const fallbackCandidates = current.filter((item) => candidateCodes.has(item.code)).map((item) => {
    const history = prior20.map((day) => quoteFor(day, item.code)).filter(Boolean);
    return { ...item, history, averageAmount20: average(history.map((quote) => finite(quote.amount))), freeFloatMarketCap: null };
  }).filter((item) => Number.isFinite(item.averageAmount20)).sort((a, b) => b.averageAmount20 - a.averageAmount20);
  const poolSize = current.length < 3 ? current.length : Math.max(3, Math.ceil(current.length * .3));
  const poolUniverse = [...rankedByCap, ...fallbackCandidates.filter((item) => !rankedByCap.some((row) => row.code === item.code))];
  const topByAmount20 = [...poolUniverse].sort((a, b) => b.averageAmount20 - a.averageAmount20);
  const topByTodayAmount = [...poolUniverse].sort((a, b) => finite(b.quote.amount) - finite(a.quote.amount));
  const ranked = poolUniverse.slice(0, poolSize).filter((item) => {
    const history5 = item.history.slice(-5), average5 = average(history5.map((row) => finite(row.amount)));
    const amountRatio5 = finite(item.quote.amount) / average5;
    return topByAmount20.findIndex((row) => row.code === item.code) < Math.ceil(poolUniverse.length * .5)
      || topByTodayAmount.findIndex((row) => row.code === item.code) < Math.ceil(poolUniverse.length * .5)
      || amountRatio5 >= 1.1 || candidateCodes.has(item.code);
  });
  const marketAmounts = daily[index]?.__marketAmounts || (daily[index]?.stocks || []).map((stock) => finite(stock.amount));
  const themeAmounts = current.map((item) => finite(item.quote.amount));
  const rows = ranked.map((item) => {
    const quote = item.quote, history5 = item.history.slice(-5);
    const amount = finite(quote.amount), amountAvg5 = average(history5.map((row) => finite(row.amount)));
    const amountRatio5 = Number.isFinite(amount) && Number.isFinite(amountAvg5) && amountAvg5 > 0 ? amount / amountAvg5 : null;
    const turnover = finite(quote.turnoverRate);
    const turnoverAverage5 = average(history5.map((row) => finite(row.turnoverRate)));
    const turnoverRatio5 = Number.isFinite(turnover) && Number.isFinite(turnoverAverage5) && turnoverAverage5 > 0 ? turnover / turnoverAverage5 : null;
    const themePercentile = percentile(themeAmounts, amount), marketPercentile = percentile(marketAmounts, amount);
    const high = finite(quote.high), low = finite(quote.low), close = finite(quote.price);
    const closeLocation = [high, low, close].every(Number.isFinite) ? high === low ? .5 : (close - low) / (high - low) : null;
    const changePct = finite(quote.changePct), relativeMarket = Number.isFinite(changePct) && Number.isFinite(marketReturn) ? changePct - marketReturn : null;
    const relativeTheme = Number.isFinite(changePct) && Number.isFinite(themeMedian) ? changePct - themeMedian : null;
    const capitalParts = [amountPoints(amountRatio5), themeAmountPoints(themePercentile), marketAmountPoints(marketPercentile), turnoverPoints(turnoverRatio5)];
    const capitalScore = capitalParts.every(Number.isFinite) ? capitalParts.reduce((sum, value) => sum + value, 0) : null;
    const priceSignals = [changePct > 0, relativeMarket >= .5, relativeTheme >= -2.5, closeLocation >= .5, !(changePct <= -4 && amountRatio5 >= 1.3 && closeLocation <= .25)].filter(Boolean).length;
    const priceScore = [changePct > 0 ? 8 : 0, relativeMarket >= .5 ? 8 : 0, relativeTheme >= -2.5 ? 6 : 0, closeLocation >= .6 ? 8 : closeLocation >= .4 ? 4 : 0].reduce((sum, value) => sum + value, 0);
    const weakTwoDays = [...item.history.slice(-1), quote].filter((row) => Number.isFinite(finite(row.changePct)) && Number.isFinite(themeMedian) && finite(row.changePct) - themeMedian <= -3).length >= 2;
    const severe = (changePct <= -4 && amountRatio5 >= 1.3 && closeLocation <= .25) || weakTwoDays && close < average(item.history.slice(-10).map((row) => finite(row.price))) * .99;
    const structure = !severe && !(changePct <= -4 && amountRatio5 >= 1.3 && closeLocation <= .25);
    const capitalConfirmed = capitalScore !== null && capitalScore >= 22;
    const pricePositive = priceSignals >= 2 && structure;
    const response = (capitalConfirmed || pricePositive) && structure && !severe;
    return { code: item.code, name: item.name, average_amount_20: item.averageAmount20, amount_ratio_5: amountRatio5, turnover_ratio_5: turnoverRatio5, amount_theme_percentile: themePercentile, amount_market_percentile: marketPercentile, close_location: closeLocation, relative_return_market: relativeMarket, relative_return_theme: relativeTheme, capital_score: capitalScore, price_score: priceScore, price_signal_count: priceSignals, structure_score: structure ? 30 : 0, capital_activity_confirmed: capitalConfirmed, price_response_positive: pricePositive, structure_preserved: structure, severe_core_breakdown: severe, core_response_confirmed: response };
  });
  const totalWeight = rows.reduce((sum, row) => sum + Math.sqrt(row.average_amount_20), 0);
  rows.forEach((row) => { row.core_weight = totalWeight > 0 ? Math.sqrt(row.average_amount_20) / totalWeight : null; });
  for (let pass = 0; pass < rows.length; pass += 1) {
    const capped = rows.filter((row) => row.core_weight > .25), excess = capped.reduce((sum, row) => sum + row.core_weight - .25, 0), open = rows.filter((row) => row.core_weight < .25);
    if (!excess || !open.length) break;
    capped.forEach((row) => { row.core_weight = .25; });
    const openWeight = open.reduce((sum, row) => sum + row.core_weight, 0);
    open.forEach((row) => { row.core_weight += excess * row.core_weight / openWeight; });
  }
  rows.forEach((row) => { row.composite_score = [row.capital_score, row.price_score, row.structure_score].every(Number.isFinite) ? row.capital_score + row.price_score + row.structure_score : null; });
  const weighted = rows.every((row) => Number.isFinite(row.composite_score) && Number.isFinite(row.core_weight)) ? rows.reduce((sum, row) => sum + row.composite_score * row.core_weight, 0) : null;
  const severeWeight = rows.reduce((sum, row) => sum + (row.severe_core_breakdown ? row.core_weight || 0 : 0), 0);
  const positiveRows = rows.filter((row) => row.price_response_positive && !row.severe_core_breakdown);
  const positiveWeight = positiveRows.reduce((sum, row) => sum + (row.core_weight || 0), 0);
  rows.forEach((row) => { row.response_status = row.severe_core_breakdown ? "severe_breakdown" : row.price_response_positive ? "positive_response" : row.structure_preserved ? "neutral_response" : "weak_response"; });
  const neutralWeight = rows.filter((row) => row.response_status === "neutral_response").reduce((sum, row) => sum + row.core_weight, 0);
  const weakWeight = rows.filter((row) => row.response_status === "weak_response").reduce((sum, row) => sum + row.core_weight, 0);
  const positiveRatio = rows.length ? positiveRows.length / rows.length : null;
  const veryStrongBreadth = current.length && current.filter((item) => finite(item.quote.changePct) > 0).length / current.length >= .75 && themeMedian >= 3;
  const weakConfirmation = positiveWeight >= .5 && severeWeight < .2 && veryStrongBreadth;
  const confirmed = positiveRatio >= .5 && positiveWeight >= .6 && severeWeight < .3 || weakConfirmation;
  const internalDivergence = positiveWeight >= .5 && severeWeight < .3 && (neutralWeight > 0 || weakWeight > 0 || severeWeight > 0);
  return { primary_capacity_cores: rows.slice(0, 3), capacity_core_pool: rows, capacity_core_pool_size: rows.length, capacity_core_weighted_score: weighted, capacity_core_positive_count: positiveRows.length, capacity_core_positive_count_ratio: positiveRatio, capacity_core_positive_weight: positiveWeight, capacity_core_neutral_weight: neutralWeight, capacity_core_weak_weight: weakWeight, capacity_core_severe_weight: severeWeight, capacity_core_pool_weighted_return: rows.reduce((sum, row) => sum + (current.find((item) => item.code === row.code)?.quote?.changePct || 0) * row.core_weight, 0), capacity_core_rotation: internalDivergence, core_internal_divergence: internalDivergence, core_pool_status: internalDivergence ? "internal_divergence" : confirmed ? "confirmed" : "insufficient_response", capacity_core_weak_confirmation: weakConfirmation, capacity_core_response_confirmed: confirmed, capacity_core_status: confirmed ? "core_participating" : "core_weak_divergence", capacity_core_current_return: average(rows.map((row) => current.find((item) => item.code === row.code)?.quote?.changePct)), capacity_core_return: average(rows.map((row) => current.find((item) => item.code === row.code)?.quote?.changePct)), capacity_core_count: rows.length, capacity_core_up_ratio: rows.length ? rows.filter((row) => current.find((item) => item.code === row.code)?.quote?.changePct > 0).length / rows.length : null, capacity_core_severe_breakdown: severeWeight >= .5 };
}

// Capacity-core selection is supplied by the existing core module.  This only
// measures its same-day response; it never promotes a small-cap winner into a
// capacity core by itself.
function capacityCoreResponse(theme, daily, index, current, config) {
  const candidates = theme.capacity_core_candidates || [];
  const codes = new Set(candidates.map((item) => item.code));
  const rows = current.filter((item) => codes.has(item.code));
  const threshold = config.emergence?.thresholds || {};
  const lookback = daily.slice(Math.max(0, index - 5), index);
  const marketReturn = daily[index]?.__marketMedianReturn ?? median((daily[index]?.stocks || []).map((stock) => finite(stock.changePct)));
  const coreSignals = rows.map((item) => {
    const history = lookback.map((day) => (day.stocks || []).find((stock) => stock.code === item.code)).filter(Boolean);
    const returnAverage5d = average(history.map((stock) => finite(stock.changePct)));
    const amountAverage5d = average(history.map((stock) => finite(stock.amount)).filter((value) => Number.isFinite(value) && value > 0));
    const todayReturn = finite(item.quote.changePct);
    const todayAmount = finite(item.quote.amount);
    const returnVsMarket = Number.isFinite(todayReturn) && Number.isFinite(marketReturn)
      && todayReturn >= marketReturn + (threshold.capacity_core_excess_return_vs_market_pct ?? 1);
    const returnVsAverage = Number.isFinite(todayReturn) && Number.isFinite(returnAverage5d)
      && todayReturn >= returnAverage5d + (threshold.capacity_core_excess_return_vs_5d_average_pct ?? 1);
    const amountRatio5d = Number.isFinite(todayAmount) && todayAmount > 0 && Number.isFinite(amountAverage5d) && amountAverage5d > 0
      ? todayAmount / amountAverage5d : null;
    const amountExpanded = Number.isFinite(amountRatio5d) && amountRatio5d >= (threshold.capacity_core_min_amount_ratio_5d ?? 1);
    return {
      code: item.code,
      return_vs_market: returnVsMarket,
      return_vs_5d_average: returnVsAverage,
      amount_expanded: amountExpanded,
      qualifies: returnVsMarket && returnVsAverage && amountExpanded,
      change_pct: todayReturn,
      market_median_return_pct: marketReturn,
      average_return_5d_pct: returnAverage5d,
      amount_ratio_5d: amountRatio5d,
    };
  });
  const returns = coreSignals.map((item) => item.change_pct).filter(Number.isFinite);
  const amountRatios = coreSignals.map((item) => item.amount_ratio_5d).filter(Number.isFinite);
  const coreReturn = average(returns);
  const upRatio = returns.length ? returns.filter((value) => value > 0).length / returns.length : null;
  const amountRatio = average(amountRatios);
  const capitalActivity = Number.isFinite(amountRatio) && amountRatio >= (threshold.capital_activity_ratio ?? 1.1);
  const pricePositive = Number.isFinite(coreReturn) && coreReturn > (threshold.price_positive_return_pct ?? 0) && upRatio >= .5;
  // Historical OHLC platform fields are not available in the daily feed.  A
  // core that is not materially weak is treated as structure-preserved, but
  // this is surfaced as partial evidence rather than a high-confidence claim.
  const structurePreserved = Number.isFinite(coreReturn) && coreReturn > -2 && (upRatio ?? 0) >= .33;
  const severeBreakdown = Number.isFinite(coreReturn) && coreReturn <= (threshold.severe_breakdown_return_pct ?? -4) && (upRatio ?? 1) < .5;
  const confirmed = capitalActivity && (pricePositive || structurePreserved) && !severeBreakdown;
  const qualifiedCount = coreSignals.filter((item) => item.qualifies).length;
  const minimumCoreCount = threshold.minimum_capacity_core_count ?? 2;
  const requiredQualifiedCount = Math.ceil(rows.length * (threshold.capacity_core_majority_ratio ?? .6));
  const startupConfirmed = rows.length >= minimumCoreCount && qualifiedCount >= requiredQualifiedCount;
  const status = severeBreakdown ? "core_severe_breakdown"
    : confirmed && amountRatio >= (threshold.capital_strengthening_ratio ?? 1.4) && pricePositive ? "core_strengthening"
    : confirmed ? "core_participating"
    : Number.isFinite(coreReturn) && coreReturn <= 0 ? "core_weak_divergence"
    : rows.length ? "core_neutral" : "unavailable";
  return {
    capacity_core_status: status,
    capacity_core_response_confirmed: confirmed,
    capacity_core_return: Number.isFinite(coreReturn) ? +coreReturn.toFixed(2) : null,
    capacity_core_current_return: Number.isFinite(coreReturn) ? +coreReturn.toFixed(2) : null,
    capacity_core_count: rows.length,
    capacity_core_up_ratio: Number.isFinite(upRatio) ? +upRatio.toFixed(3) : null,
    capacity_core_amount_ratio_5d: Number.isFinite(amountRatio) ? +amountRatio.toFixed(2) : null,
    capacity_core_capital_activity_confirmed: capitalActivity,
    capacity_core_price_response_positive: pricePositive,
    capacity_core_structure_preserved: structurePreserved,
    capacity_core_severe_breakdown: severeBreakdown,
    capacity_core_missing_data: amountRatios.length ? [] : ["capacity_core_amount_5d"],
    capacity_core_startup_confirmed: startupConfirmed,
    capacity_core_startup_qualified_count: qualifiedCount,
    capacity_core_startup_required_count: requiredQualifiedCount,
    capacity_core_startup_evidence: coreSignals,
  };
}

function quoteFor(day, code) {
  if (day?.__stockMap) return day.__stockMap.get(code) || null;
  return (day?.stocks || []).find((stock) => stock.code === code) || null;
}

function upperShadowRatio(quote) {
  const high = finite(quote?.high), low = finite(quote?.low), open = finite(quote?.open), close = finite(quote?.price);
  if (![high, low, open, close].every(Number.isFinite) || high <= low) return null;
  return (high - Math.max(open, close)) / (high - low);
}

function selectCoreSnapshot(theme, daily, index, config) {
  const observed = dailyRows(theme, daily[index]);
  const coreConfig = config.core_thresholds || {};
  // 龙头池不是当日涨幅前三。用最近五个交易日的前排出现次数、强势日、
  // 累计强度和最早启动位置构成滚动候选池，供下一日反馈与周期判断使用。
  const leaderWindow = daily.slice(Math.max(0, index - 4), index + 1);
  const poolSize = Math.min(10, Math.max(5, Math.ceil(observed.length * .3)));
  const leaders = observed.map((item) => {
    const history = leaderWindow.map((day) => ({ date: day.date, quote: quoteFor(day, item.code) })).filter((row) => row.quote);
    const frontlineDays = history.filter((row) => {
      const rows = dailyRows(theme, leaderWindow.find((day) => day.date === row.date));
      const topCount = Math.max(1, Math.ceil(rows.length * .2));
      return [...rows].sort((left, right) => finite(right.quote.changePct) - finite(left.quote.changePct)).slice(0, topCount).some((candidate) => candidate.code === item.code);
    }).length;
    const strongDays = history.filter((row) => finite(row.quote.changePct) >= (config.high_gain_pct ?? 5) || limitUp(item.code, finite(row.quote.changePct))).length;
    const firstStrong = history.findIndex((row) => finite(row.quote.changePct) >= (config.high_gain_pct ?? 5) || limitUp(item.code, finite(row.quote.changePct)));
    const cumulative = history.reduce((total, row) => total + finite(row.quote.changePct), 0);
    const candidateScore = frontlineDays * 4 + strongDays * 5 + Math.max(0, 5 - (firstStrong < 0 ? 5 : firstStrong)) + cumulative * .35;
    return { ...item, candidate_score: candidateScore, frontline_days: frontlineDays, strong_days: strongDays };
  }).filter((item) => item.candidate_score > 0)
    .sort((left, right) => right.candidate_score - left.candidate_score || finite(right.quote.changePct) - finite(left.quote.changePct))
    .slice(0, poolSize);
  const capacityRanked = observed.map((item) => {
    const history = daily.slice(Math.max(0, index - 4), index + 1).map((day) => quoteFor(day, item.code)).filter(Boolean);
    const averageAmount = average(history.map((quote) => finite(quote.amount)));
    const averageClose = average(history.map((quote) => finite(quote.price)));
    const amount = finite(item.quote.amount), close = finite(item.quote.price);
    return { ...item, amount, qualifies: Number.isFinite(amount) && Number.isFinite(averageAmount) && amount >= averageAmount && Number.isFinite(close) && Number.isFinite(averageClose) && close >= averageClose };
  }).filter((item) => Number.isFinite(item.amount)).sort((left, right) => right.amount - left.amount);
  const ratio = Number.isFinite(Number(coreConfig.capacity_core_ratio)) ? Number(coreConfig.capacity_core_ratio) : .3;
  const capacityCount = Math.max(1, Math.ceil(capacityRanked.length * ratio));
  const capacity = capacityRanked.slice(0, capacityCount);
  return {
    date: daily[index]?.date || null,
    leaders: leaders.map(({ code, name, candidate_score, frontline_days, strong_days }) => ({ code, name, candidate_score: +candidate_score.toFixed(2), frontline_days, strong_days })),
    leader_candidate_pool: leaders.map(({ code, name, candidate_score, frontline_days, strong_days }) => ({ code, name, candidate_score: +candidate_score.toFixed(2), frontline_days, strong_days })),
    capacity_cores: capacity.map(({ code, name }) => ({ code, name })),
  };
}

function poolStats(codes, currentByCode) {
  const returns = [...codes].map((code) => finite(currentByCode.get(code)?.quote?.changePct)).filter(Number.isFinite);
  return {
    count: returns.length,
    median_return: returns.length ? median(returns) : null,
    positive_rate: returns.length ? returns.filter((value) => value > 0).length / returns.length : null,
    severe_negative_rate: returns.length ? returns.filter((value) => value <= -7).length / returns.length : null,
  };
}

function feedbackLabel(stats) {
  if (!stats.count) return "insufficient_data";
  if (stats.median_return > 0 && stats.positive_rate >= .5) return "positive";
  if (stats.median_return > -1 && stats.positive_rate >= .4) return "mixed";
  return "negative";
}

// Profit effect always evaluates yesterday's participants using today's close.
// Today's new strong stocks deliberately do not enter any pool here.
function profitEffectObservation(theme, daily, index, current, config, previousSnapshot) {
  const evaluationDate = daily[index]?.date || "";
  const sourcePoolDate = index ? daily[index - 1]?.date || "" : "";
  const empty = {
    evaluation_date: evaluationDate, source_pool_date: sourcePoolDate, profit_effect: "insufficient_data",
    frontline_next_day_median_return: null, frontline_positive_rate: null,
    active_member_next_day_median_return: null, active_member_positive_rate: null,
    limit_up_next_day_median_return: null, severe_negative_rate: null,
    leader_feedback: "insufficient_data", capacity_core_feedback: "insufficient_data", ordinary_member_feedback: "insufficient_data",
    positive_evidence: [], negative_evidence: [], reason: "缺少前一交易日前排、核心或活跃成员股票池，赚钱效应数据不足。",
  };
  if (!index || !previousSnapshot) return empty;
  const previous = dailyRows(theme, daily[index - 1]);
  const currentByCode = new Map(current.map((item) => [item.code, item]));
  const limitUpCodes = new Set(previous.filter((item) => limitUp(item.code, finite(item.quote.changePct))).map((item) => item.code));
  const highGainCodes = new Set(previous.filter((item) => finite(item.quote.changePct) >= config.high_gain_pct).map((item) => item.code));
  const activeCodes = new Set(previous.filter((item) => Math.abs(finite(item.quote.changePct)) >= config.active_change_pct).map((item) => item.code));
  const frontlineCoreCodes = new Set([...previous].sort((left, right) => finite(right.quote.changePct) - finite(left.quote.changePct)).slice(0, 3).map((item) => item.code));
  const leaderCodes = new Set((previousSnapshot.leaders || []).map((item) => item.code));
  const capacityCodes = new Set((previousSnapshot.capacity_cores || []).map((item) => item.code));
  const frontlineCodes = new Set([...leaderCodes, ...limitUpCodes, ...highGainCodes, ...frontlineCoreCodes]);
  const frontline = poolStats(frontlineCodes, currentByCode);
  const active = poolStats(activeCodes, currentByCode);
  const limitUpStats = poolStats(limitUpCodes, currentByCode);
  const leader = poolStats(leaderCodes, currentByCode);
  const capacity = poolStats(capacityCodes, currentByCode);
  const ordinaryCodes = new Set([...activeCodes].filter((code) => !leaderCodes.has(code) && !capacityCodes.has(code)));
  const ordinary = poolStats(ordinaryCodes, currentByCode);
  const combined = poolStats(new Set([...frontlineCodes, ...activeCodes]), currentByCode);
  if (!frontline.count || !active.count) return empty;
  const allCorePositive = [leader, capacity, ordinary].every((stats) => stats.count && stats.median_return > 0);
  const coreHasResistance = [leader, capacity].some((stats) => stats.count && stats.median_return >= 0);
  const strongConditions = [frontline.median_return >= .5, frontline.positive_rate >= .6, active.median_return > 0, combined.severe_negative_rate < .1, allCorePositive].filter(Boolean).length;
  const normalConditions = [frontline.median_return >= -.3, frontline.positive_rate >= .5, active.median_return >= 0, combined.severe_negative_rate < .15].filter(Boolean).length;
  const deterioratingConditions = [frontline.median_return <= -1, frontline.positive_rate < .4, limitUpStats.count && limitUpStats.median_return < 0, combined.severe_negative_rate >= .2, [leader, capacity, ordinary].every((stats) => stats.count && stats.median_return < 0)].filter(Boolean).length;
  let profitEffect = "normal";
  if (strongConditions >= 4) profitEffect = "strong";
  else if (deterioratingConditions >= 3) profitEffect = "deteriorating";
  else if (frontline.median_return < 0 && frontline.positive_rate < .5 && coreHasResistance && combined.severe_negative_rate < .35) profitEffect = "weakening";
  else if (normalConditions < 3 && frontline.median_return < 0) profitEffect = "weakening";
  const positiveEvidence = [
    frontline.median_return > 0 && "前排次日收益中位数为正",
    frontline.positive_rate >= .6 && "前排正收益比例不低于60%",
    active.median_return > 0 && "活跃成员收益中位数为正",
    allCorePositive && "龙头、中军和普通成员均获正反馈",
  ].filter(Boolean);
  const negativeEvidence = [
    frontline.median_return < 0 && "前排次日收益中位数为负",
    frontline.positive_rate < .4 && "前排正收益比例低于40%",
    limitUpStats.count && limitUpStats.median_return < 0 && "昨日涨停股今日普遍补跌",
    combined.severe_negative_rate >= .2 && "严重负反馈比例升高",
    [leader, capacity, ordinary].every((stats) => stats.count && stats.median_return < 0) && "龙头、中军和普通成员同步亏损",
  ].filter(Boolean);
  const labels = { strong: "赚钱效应强", normal: "赚钱效应正常", weakening: "赚钱效应弱化", deteriorating: "赚钱效应恶化" };
  return {
    evaluation_date: evaluationDate, source_pool_date: sourcePoolDate, profit_effect: profitEffect,
    frontline_next_day_median_return: frontline.median_return, frontline_positive_rate: frontline.positive_rate,
    active_member_next_day_median_return: active.median_return, active_member_positive_rate: active.positive_rate,
    limit_up_next_day_median_return: limitUpStats.median_return, severe_negative_rate: combined.severe_negative_rate,
    leader_feedback: feedbackLabel(leader), capacity_core_feedback: feedbackLabel(capacity), ordinary_member_feedback: feedbackLabel(ordinary),
    positive_evidence: positiveEvidence, negative_evidence: negativeEvidence,
    reason: `${labels[profitEffect]}：前排池取自 ${sourcePoolDate} 的龙头、涨停、大涨和前排核心；活跃成员池也固定为前一交易日，不使用 ${evaluationDate} 新增强势股。`,
    frontline_member_count: frontline.count, active_member_count: active.count,
  };
}

// A core is selected on t-1 and assessed only with t's market data.  This is
// deliberately separate from the target-day core module so the cycle engine
// cannot replace a weakening core with today's strongest stock.
function previousCoreObservation(theme, daily, index, current, config, previousSnapshot) {
  if (!index) return { previous_leaders: [], previous_capacity_cores: [], leader_status: "unavailable", capacity_core_status: "unavailable" };
  const previous = dailyRows(theme, daily[index - 1]);
  const coreConfig = config.core_thresholds || {};
  const snapshot = previousSnapshot || selectCoreSnapshot(theme, daily, index - 1, config);
  const previousByCode = new Map(previous.map((item) => [item.code, item]));
  const leaders = (snapshot.leaders || []).map((stock) => previousByCode.get(stock.code)).filter(Boolean);
  const capacity = (snapshot.capacity_cores || []).map((stock) => previousByCode.get(stock.code)).filter(Boolean);
  const todayByCode = new Map(current.map((item) => [item.code, item]));
  const themeMedian = median(current.map((item) => finite(item.quote.changePct)));
  const assess = (item) => {
    const today = todayByCode.get(item.code)?.quote;
    const history = daily.slice(Math.max(0, index - 4), index + 1).map((day) => quoteFor(day, item.code)).filter(Boolean);
    const ma5 = average(history.map((quote) => finite(quote.price)));
    const close = finite(today?.price), changePct = finite(today?.changePct), amount = finite(today?.amount);
    const amountAverage = average(daily.slice(Math.max(0, index - 5), index).map((day) => finite(quoteFor(day, item.code)?.amount)));
    const shadow = upperShadowRatio(today);
    const amountRatio5d = Number.isFinite(amount) && Number.isFinite(amountAverage) && amountAverage > 0 ? amount / amountAverage : null;
    const closePosition = Number.isFinite(today?.high) && Number.isFinite(today?.low) && today.high > today.low && Number.isFinite(close)
      ? (close - today.low) / (today.high - today.low) : null;
    const trendBroken = Number.isFinite(close) && Number.isFinite(ma5) && close < ma5 * (coreConfig.ma_break_ratio ?? .96);
    const weakClose = Number.isFinite(closePosition) && closePosition <= (coreConfig.weak_close_position ?? .35);
    const amountWeak = Number.isFinite(amountRatio5d) && amountRatio5d <= (coreConfig.amount_shrink_ratio ?? .7);
    const weakRelative = Number.isFinite(changePct) && Number.isFinite(themeMedian) && changePct < themeMedian - (coreConfig.weak_relative_return_pct ?? .5);
    const recentReturns = history.map((quote) => finite(quote.changePct)).filter(Number.isFinite);
    const continuityWeak = recentReturns.slice(-3).filter((value) => value < 0).length >= 2;
    const severeSignals = [trendBroken, Number.isFinite(changePct) && changePct <= (coreConfig.core_breakdown_return_pct ?? -4), weakClose, amountWeak, weakRelative, continuityWeak].filter(Boolean).length;
    const broken = severeSignals >= (coreConfig.core_breakdown_min_evidence ?? 3);
    return { code: item.code, name: item.name, change_pct: changePct, amount_ratio_5d: amountRatio5d, ma5, close_position: closePosition, upper_shadow_ratio: shadow, trend_broken: trendBroken, weak_relative: weakRelative, continuity_weak: continuityWeak, severe_breakdown_evidence: severeSignals, broken, long_upper_shadow: Number.isFinite(shadow) && shadow >= (coreConfig.long_upper_shadow_ratio ?? .45), active: Number.isFinite(changePct) && changePct >= 0 };
  };
  const leaderRows = leaders.map(assess), capacityRows = capacity.map(assess);
  const leaderReturn = average(leaderRows.map((item) => item.change_pct));
  const capacityReturn = average(capacityRows.map((item) => item.change_pct));
  const leaderBrokenCount = leaderRows.filter((item) => item.broken).length;
  const leaderBroken = leaderRows.length > 0 && leaderBrokenCount >= Math.ceil(leaderRows.length / 2);
  const capacityBroken = capacityRows.length > 0 && capacityRows.filter((item) => item.broken).length >= Math.ceil(capacityRows.length / 2);
  const leaderActiveRatio = leaderRows.length ? leaderRows.filter((item) => item.active && !item.broken).length / leaderRows.length : null;
  const leaderDrives = Number.isFinite(leaderReturn) && Number.isFinite(themeMedian)
    && leaderReturn >= themeMedian + (coreConfig.leader_excess_return_pct ?? .5)
    && (leaderActiveRatio ?? 0) >= .5;
  const capacityActive = capacityRows.length > 0 && capacityRows.filter((item) => item.active && !item.broken).length >= Math.ceil(capacityRows.length / 2);
  return {
    previous_leaders: leaderRows,
    previous_capacity_cores: capacityRows,
    leader_return: leaderReturn,
    leader_group_size: leaderRows.length,
    leader_broken_count: leaderBrokenCount,
    leader_active_ratio: leaderActiveRatio,
    leader_status: leaderBroken ? "broken" : leaderDrives ? "driving" : leaderReturn >= 0 ? "stable" : "weakening",
    leader_structure_broken: leaderBroken,
    leader_drives_theme: leaderDrives,
    capacity_core_return: capacityReturn,
    capacity_core_count: capacityRows.length,
    capacity_core_up_ratio: capacityRows.length ? capacityRows.filter((item) => item.active).length / capacityRows.length : null,
    capacity_core_amount_ratio_5d: average(capacityRows.map((item) => item.amount_ratio_5d)),
    capacity_core_status: capacityBroken ? "core_severe_breakdown" : capacityActive ? "core_participating" : "core_weak_divergence",
    capacity_core_broken: capacityBroken,
    capacity_core_long_upper_count: capacityRows.filter((item) => item.long_upper_shadow).length,
  };
}

export function buildCycleMetrics(themes, daily, config) {
  // Build one code index per trading day for this analysis task.  All themes
  // and all look-back calculations reuse it; no cache is persisted between
  // separate tasks.
  daily = daily.map((day) => {
    const stocks = day.stocks || [];
    // These market-wide values are invariant for every theme on the same
    // trading day.  Reusing them avoids repeatedly sorting the full market
    // inside each theme's core-response calculation.
    return {
      ...day,
      __stockMap: stockMapFor(day),
      __marketMedianReturn: median(stocks.map((stock) => finite(stock.changePct))),
      __marketAmounts: stocks.map((stock) => finite(stock.amount)),
    };
  });
  const perTheme = new Map();
  for (const theme of themes) {
    const taskCoreSnapshots = [];
    const metrics = daily.map((day, index) => {
      const current = dailyRows(theme, day);
      const previous = index ? dailyRows(theme, daily[index - 1]) : [];
      const previousLimits = new Set(previous.filter((item) => limitUp(item.code, finite(item.quote.changePct))).map((item) => item.code));
      const returns = current.map((item) => finite(item.quote.changePct));
      const limited = current.filter((item) => limitUp(item.code, finite(item.quote.changePct)));
      const highGain = current.filter((item) => finite(item.quote.changePct) >= config.high_gain_pct);
      const amount = current.reduce((sum, item) => sum + (finite(item.quote.amount) || 0), 0);
      const trendBreakouts = current.filter((item) => {
        const history = daily.slice(Math.max(0, index - 3), index).map((day) => quoteFor(day, item.code)).filter(Boolean);
        const averageAmount = average(history.map((quote) => finite(quote.amount)));
        const averageClose = average(history.map((quote) => finite(quote.price)));
        return finite(item.quote.changePct) > 0 && Number.isFinite(finite(item.quote.amount)) && Number.isFinite(averageAmount)
          && finite(item.quote.amount) >= averageAmount * 1.2 && Number.isFinite(averageClose) && finite(item.quote.price) >= averageClose;
      });
      const validStrong = current.filter((item) => {
        const pct = finite(item.quote.changePct);
        const history5 = daily.slice(Math.max(0, index - 5), index).map((prior) => quoteFor(prior, item.code)).filter(Boolean);
        const amountRatio5 = finite(item.quote.amount) / average(history5.map((quote) => finite(quote.amount)));
        return limitUp(item.code, pct) || pct >= 5 || (pct >= 3 && Number.isFinite(amountRatio5) && amountRatio5 >= 1.2);
      }).filter((item) => item.independent_event_driven !== true);
      const effectiveStrongCodes = new Set(validStrong.map((item) => item.code));
      const rankedByReturn = [...current].sort((a, b) => finite(b.quote.changePct) - finite(a.quote.changePct));
      const frontline = validStrong.filter((item) => {
        const returnRank = rankedByReturn.findIndex((row) => row.code === item.code) + 1;
        const amountRank = [...current].sort((a, b) => finite(b.quote.amount) - finite(a.quote.amount)).findIndex((row) => row.code === item.code) + 1;
        const history5 = daily.slice(Math.max(0, index - 5), index).map((prior) => quoteFor(prior, item.code)).filter(Boolean);
        const amountRatio5 = finite(item.quote.amount) / average(history5.map((quote) => finite(quote.amount)));
        return returnRank <= Math.max(1, Math.ceil(current.length * .2)) && (amountRatio5 >= 1.2 || amountRank <= Math.ceil(current.length * .3));
      });
      const promotion = limited.filter((item) => previousLimits.has(item.code)).length;
      const newFirst = limited.filter((item) => !previousLimits.has(item.code)).length;
      const coreObservation = previousCoreObservation(theme, daily, index, current, config, taskCoreSnapshots[index - 1]);
      const profitEffect = profitEffectObservation(theme, daily, index, current, config, taskCoreSnapshots[index - 1]);
      const taskCoreSnapshot = selectCoreSnapshot(theme, daily, index, config);
      taskCoreSnapshots[index] = taskCoreSnapshot;
      return {
        date: day.date,
        member_count: theme.members.length,
        active_member_count: current.filter((item) => Math.abs(finite(item.quote.changePct)) >= config.active_change_pct).length,
        up_count: returns.filter((value) => value > 0).length,
        high_gain_count: highGain.length,
        limit_up_count: limited.length,
        failed_limit_count: null,
        large_loss_count: returns.filter((value) => value <= config.large_loss_pct).length,
        effective_member_count: effectiveStrongCodes.size,
        strong_member_count: effectiveStrongCodes.size,
        same_logic_ratio: effectiveStrongCodes.size ? 1 : null,
        dynamic_logic_unified: !theme.members.some((member) => member.independent_event_driven === true),
        independent_event_count: theme.members.filter((member) => member.independent_event_driven === true).length,
        leader_or_frontline_formed: frontline.length > 0,
        new_first_limit_count: index ? newFirst : null,
        promotion_count: index ? promotion : null,
        promotion_rate: index && limited.length ? promotion / limited.length : null,
        new_branch_count: null,
        theme_amount: amount || null,
        market_amount: (day.stocks || []).reduce((sum, stock) => sum + (finite(stock.amount) || 0), 0) || null,
        theme_amount_change_ratio: index ? ratio(amount, previous.reduce((sum, item) => sum + (finite(item.quote.amount) || 0), 0)) : null,
        theme_amount_market_rank: null,
        leader_status: coreObservation.leader_status,
        leader_return: coreObservation.leader_return,
        leader_next_day_return: null,
        leader_new_high: null,
        ...capacityCoreResponse(theme, daily, index, current, config),
        ...coreObservation,
        ...strictCoreResponse(theme, daily, index, current),
        task_core_snapshot: taskCoreSnapshot,
        capacity_core_amount_ratio: null,
        capacity_core_breakout_status: null,
        next_day_median_return: profitEffect.frontline_next_day_median_return,
        next_day_positive_ratio: profitEffect.frontline_positive_rate,
        frontline_member_count: profitEffect.frontline_member_count ?? null,
        negative_feedback_ratio: profitEffect.severe_negative_rate,
        profit_effect: profitEffect,
        relative_strength_score: median(returns),
        market_median_return: median((day.stocks || []).map((stock) => finite(stock.changePct))),
        theme_relative_return: null,
        relative_strength_rank: null,
        _valid_member_count: current.length,
      };
    });
    perTheme.set(theme.key, metrics);
  }
  // Ranking is calculated against all valid dynamic themes on the same day.
  for (let index = 0; index < daily.length; index += 1) {
    const ranked = [...perTheme.entries()].map(([key, values]) => ({ key, value: values[index] }))
      .filter((item) => Number.isFinite(item.value.relative_strength_score))
      .sort((left, right) => right.value.relative_strength_score - left.value.relative_strength_score);
    ranked.forEach((item, rank) => { item.value.relative_strength_rank = rank + 1; item.value._theme_count = ranked.length; });
    const rankedCapacity = [...perTheme.entries()].map(([key, values]) => ({ key, value: values[index] }))
      .filter((item) => Number.isFinite(item.value.capacity_core_current_return))
      .sort((left, right) => right.value.capacity_core_current_return - left.value.capacity_core_current_return);
    rankedCapacity.forEach((item, rank) => {
      item.value.capacity_core_relative_rank = rank + 1;
      item.value._capacity_core_theme_count = rankedCapacity.length;
    });
  }
  for (const values of perTheme.values()) {
    values.forEach((value, index) => {
      const previous = values[index - 1];
      const prior3 = values.slice(Math.max(0, index - 3), index);
      const averagePrior = (field) => average(prior3.map((item) => finite(item[field])));
      const priorActive = averagePrior("active_member_count"), priorStrong = averagePrior("strong_member_count"), priorUpRatio = averagePrior("up_ratio"), priorMedian = averagePrior("relative_strength_score");
      value.up_ratio = value._valid_member_count ? value.up_count / value._valid_member_count : null;
      value.theme_relative_return = Number.isFinite(value.relative_strength_score) && Number.isFinite(value.market_median_return) ? value.relative_strength_score - value.market_median_return : null;
      value.active_count_ratio = Number.isFinite(priorActive) && priorActive > 0 ? value.active_member_count / priorActive : null;
      value.strong_count_ratio = Number.isFinite(priorStrong) && priorStrong > 0 ? value.strong_member_count / priorStrong : null;
      value.up_ratio_change = Number.isFinite(priorUpRatio) && Number.isFinite(value.up_ratio) ? value.up_ratio - priorUpRatio : null;
      value.median_return_change = Number.isFinite(priorMedian) ? value.relative_strength_score - priorMedian : null;
      const breadthSignals = [value.active_count_ratio >= 1.5 && value.active_member_count - priorActive >= 2, value.strong_count_ratio >= 2, value.up_ratio_change >= .2, value.median_return_change >= 1.5].filter(Boolean).length;
      value.breadth_expansion_confirmed = prior3.length >= 3 && breadthSignals >= 2;
      value.breadth_expansion_signal_count = breadthSignals;
      value.limit_up_count_change = previous ? change(value.limit_up_count, previous.limit_up_count) : null;
      value.high_gain_count_change = previous ? change(value.high_gain_count, previous.high_gain_count) : null;
      value.active_member_count_change = previous ? change(value.active_member_count, previous.active_member_count) : null;
      value.new_first_limit_count_change = previous ? change(value.new_first_limit_count, previous.new_first_limit_count) : null;
      value.promotion_rate_change = previous ? change(value.promotion_rate, previous.promotion_rate) : null;
      value.theme_amount_change = previous ? ratio(value.theme_amount, previous.theme_amount) : null;
      value.next_day_median_return_change = previous ? change(value.next_day_median_return, previous.next_day_median_return) : null;
      value.negative_feedback_ratio_change = previous ? change(value.negative_feedback_ratio, previous.negative_feedback_ratio) : null;
      value.relative_strength_rank_change = previous ? change(previous.relative_strength_rank, value.relative_strength_rank) : null;
    });
  }
  return perTheme;
}

export function cycleScores(metrics, config) {
  const last = metrics.at(-1); const prev = metrics.at(-2); const prev2 = metrics.at(-3);
  if (!last || !prev) return { expansion_score: null, core_strength_score: null, profit_effect_score: null, contraction_score: null, negative_feedback_score: null, repair_score: null };
  const w = config.expansion_weights;
  const directional = (value, scale) => clamp(50 + (value ?? 0) * scale, 0, 100) / 100;
  const rankImprovement = directional(last.relative_strength_rank_change, 14);
  const expansion = Math.round(
    w.limit_and_high_gain * directional((last.limit_up_count_change ?? 0) + (last.high_gain_count_change ?? 0), 12)
    + w.new_first_limit * directional(last.new_first_limit_count_change, 14)
    + w.active_members * directional(last.active_member_count_change, 8)
    + w.promotion * directional(last.promotion_rate_change, 90)
    + w.new_branches * 0.5
    + w.theme_amount * directional(last.theme_amount_change, 65)
    + w.relative_strength * rankImprovement
  );
  const negative = Math.round(clamp(
    30 * directional(-(last.limit_up_count_change ?? 0), 14)
    + 20 * directional(-(last.new_first_limit_count_change ?? 0), 16)
    + 20 * directional(-(last.active_member_count_change ?? 0), 9)
    + 15 * directional(-(last.relative_strength_rank_change ?? 0), 16)
    + 15 * directional(last.negative_feedback_ratio_change, 150), 0, 100));
  const profit = ({ strong: 85, normal: 60, weakening: 35, deteriorating: 15 })[last.profit_effect?.profit_effect]
    ?? (Number.isFinite(last.next_day_median_return) ? Math.round(clamp(50 + last.next_day_median_return * 7 - (last.negative_feedback_ratio || 0) * 35, 0, 100)) : null);
  const core = Math.round(clamp(45 + Math.max(0, last.leader_return || 0) * 4 + Math.max(0, last.promotion_rate || 0) * 25 + Math.max(0, last.relative_strength_rank_change || 0) * 5, 0, 100));
  const repair = Math.round(clamp((prev2 ? (prev2.limit_up_count > prev.limit_up_count ? 25 : 10) : 10) + 25 * directional(last.limit_up_count_change, 14) + 25 * directional(last.active_member_count_change, 9) + 25 * directional(last.theme_amount_change, 65), 0, 100));
  return { expansion_score: expansion, core_strength_score: core, profit_effect_score: profit, contraction_score: negative, negative_feedback_score: Number.isFinite(last.negative_feedback_ratio) ? Math.round(last.negative_feedback_ratio * 100) : null, repair_score: repair };
}
