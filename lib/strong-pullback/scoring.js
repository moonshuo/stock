const finite = (value) => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));
const round = (value, digits = 2) => Number.isFinite(value) ? +value.toFixed(digits) : null;

export function smoothstep(edge0, edge1, value) {
  if (![edge0, edge1, value].every(Number.isFinite) || edge0 === edge1) return null;
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

export function boundedRatioScore(ratio, preferred = 0.65, width = 0.55) {
  if (!(Number.isFinite(ratio) && ratio > 0 && preferred > 0 && width > 0)) return null;
  return clamp(100 * Math.exp(-0.5 * (Math.log(ratio / preferred) / width) ** 2));
}

export function pullbackPriceScore(changePct, target = -1.5, width = 2.5) {
  if (!(Number.isFinite(changePct) && Number.isFinite(target) && width > 0)) return null;
  return clamp(100 * Math.exp(-0.5 * ((changePct - target) / width) ** 2));
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function movingAverage(rows, days, offset = 0) {
  const values = rows.slice(Math.max(0, rows.length - days - offset), rows.length - offset || undefined)
    .map((row) => finite(row.close)).filter(Number.isFinite);
  return values.length === days ? average(values) : null;
}

function pricePosition(rows, eventIndex, days) {
  const before = rows.slice(Math.max(0, eventIndex - days), eventIndex).map((row) => finite(row.close)).filter(Number.isFinite);
  const eventPrice = finite(rows[eventIndex]?.preClose ?? rows[eventIndex - 1]?.close);
  if (before.length !== days || !Number.isFinite(eventPrice)) return null;
  const minimum = Math.min(...before), maximum = Math.max(...before);
  return maximum > minimum ? clamp((eventPrice - minimum) / (maximum - minimum), 0, 1) : 0.5;
}

function lowerPositionScore(position, reference) {
  if (!Number.isFinite(position)) return null;
  const softness = 0.12;
  return clamp(100 / (1 + Math.exp((position - reference) / softness)));
}

function higherReferenceScore(value, reference, softness) {
  if (!Number.isFinite(value)) return null;
  return clamp(100 / (1 + Math.exp(-(value - reference) / softness)));
}

function eventRecencyScore(age, halfLife) {
  return Number.isFinite(age) && halfLife > 0 ? clamp(100 * Math.exp(-Math.LN2 * age / halfLife)) : null;
}

function weightedScore(parts) {
  if (parts.some((part) => !Number.isFinite(part.score))) return null;
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  return totalWeight > 0 ? parts.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight : null;
}

function weightedGeometricScore(parts) {
  if (parts.some((part) => !Number.isFinite(part.score))) return null;
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  if (!(totalWeight > 0)) return null;
  const logMean = parts.reduce((sum, part) => sum + part.weight * Math.log(Math.max(0.0001, part.score / 100)), 0) / totalWeight;
  return 100 * Math.exp(logMean);
}

function scoreInitiationEvents(rows, config, limitPct) {
  const searchDays = config.windows.initiation_search_days;
  const currentIndex = rows.length - 1;
  const start = Math.max(1, currentIndex - searchDays);
  const volumeDays = config.windows.relative_volume_days;
  const candidates = [];
  for (let index = start; index < currentIndex; index += 1) {
    const row = rows[index];
    const change = finite(row.change_pct);
    const priorVolumes = rows.slice(Math.max(0, index - volumeDays), index).map((item) => finite(item.volume)).filter((value) => value > 0);
    const volume = finite(row.volume);
    const volumeRatio = priorVolumes.length === volumeDays && volume > 0 ? volume / average(priorVolumes) : null;
    const position = pricePosition(rows, index, config.windows.price_position_days);
    const age = currentIndex - index;
    const recency = eventRecencyScore(age, config.windows.initiation_reference_days);
    const positionScore = lowerPositionScore(position, config.references.bottom_price_position);
    const returnScore = higherReferenceScore(change, Math.min(5, limitPct * 0.55), 1.5);
    const limitEventScore = weightedGeometricScore([
      { score: higherReferenceScore(change, limitPct * 0.92, Math.max(0.8, limitPct * 0.08)), weight: 50 },
      { score: positionScore, weight: 30 },
      { score: recency, weight: 20 },
    ]);
    const volumeEventScore = weightedGeometricScore([
      { score: higherReferenceScore(volumeRatio, config.references.breakout_volume_ratio, 0.35), weight: 35 },
      { score: positionScore, weight: 30 },
      { score: returnScore, weight: 15 },
      { score: recency, weight: 20 },
    ]);
    candidates.push({
      date: row.date,
      age_trading_days: age,
      change_pct: change,
      volume_ratio: volumeRatio,
      pre_event_price_position: position,
      recency_score: recency,
      limit_up_score: limitEventScore,
      bottom_volume_score: volumeEventScore,
    });
  }
  const bestLimit = candidates.filter((item) => Number.isFinite(item.limit_up_score)).sort((a, b) => b.limit_up_score - a.limit_up_score)[0] || null;
  const bestVolume = candidates.filter((item) => Number.isFinite(item.bottom_volume_score)).sort((a, b) => b.bottom_volume_score - a.bottom_volume_score)[0] || null;
  const selected = [bestLimit && { type: "limit_up_or_strong_day", ...bestLimit, score: bestLimit.limit_up_score }, bestVolume && { type: "bottom_volume_expansion", ...bestVolume, score: bestVolume.bottom_volume_score }]
    .filter(Boolean).sort((a, b) => b.score - a.score)[0] || null;
  return { score: selected?.score ?? null, selected_event: selected, best_limit_event: bestLimit, best_volume_event: bestVolume };
}

function detail(key, label, raw, score, weight, unit = "") {
  return { key, label, raw: round(raw, 4), unit, score: round(score), weight, contribution: Number.isFinite(score) ? round(score * weight / 100) : null };
}

function scorePullback(rows, config, mode) {
  const current = rows.at(-1) || {};
  const volumeDays = config.windows.relative_volume_days;
  const turnoverDays = config.windows.relative_turnover_days;
  const previous = rows.slice(0, -1);
  const averageVolume = average(previous.slice(-volumeDays).map((row) => finite(row.volume)).filter((value) => value > 0));
  const averageTurnover = average(previous.slice(-turnoverDays).map((row) => finite(row.turnover_rate)).filter((value) => value >= 0));
  const volume = finite(current.volume), turnover = finite(current.turnover_rate), change = finite(current.change_pct);
  const volumeRatio = mode === "intraday"
    ? finite(current.intraday_volume_ratio)
    : Number.isFinite(volume) && volume > 0 && Number.isFinite(averageVolume) && averageVolume > 0 ? volume / averageVolume : null;
  const turnoverRatio = mode === "intraday"
    ? finite(current.intraday_turnover_ratio)
    : Number.isFinite(turnover) && Number.isFinite(averageTurnover) && averageTurnover > 0 ? turnover / averageTurnover : null;
  const weights = config.pullback_subweights;
  const items = [
    detail("price_change", "当日涨跌", change, pullbackPriceScore(change, config.references.pullback_target_pct, config.references.pullback_width_pct), weights.price_change, "%"),
    detail("relative_volume", `成交量 / 前${volumeDays}日均量`, volumeRatio, boundedRatioScore(volumeRatio, config.references.volume_contraction_ratio * 0.8125), weights.relative_volume, "x"),
    detail("relative_turnover", `换手率 / 前${turnoverDays}日均值`, turnoverRatio, boundedRatioScore(turnoverRatio, config.references.volume_contraction_ratio * 0.8125), weights.relative_turnover, "x"),
  ];
  const known = items.filter((item) => Number.isFinite(item.score));
  const availableSubweight = known.reduce((sum, item) => sum + item.weight, 0);
  const knownContribution = known.reduce((sum, item) => sum + item.contribution, 0);
  return {
    score: weightedScore(items), items,
    score_range: { minimum: knownContribution, maximum: knownContribution + 100 - availableSubweight },
    available_subweight_pct: availableSubweight,
    raw: { change_pct: change, volume_ratio: round(volumeRatio, 4), turnover_ratio: round(turnoverRatio, 4), turnover_rate: turnover },
  };
}

function scoreTrend(rows, config) {
  const close = finite(rows.at(-1)?.close);
  const ma5 = movingAverage(rows, 5), ma10 = movingAverage(rows, 10), ma20 = movingAverage(rows, 20);
  const previousMa5 = movingAverage(rows, 5, 1), previousMa10 = movingAverage(rows, 10, 1);
  const slope5 = ma5 && previousMa5 ? ma5 / previousMa5 - 1 : null;
  const slope10 = ma10 && previousMa10 ? ma10 / previousMa10 - 1 : null;
  const directionScore = average([slope5, slope10].map((value) => Number.isFinite(value) ? 100 * smoothstep(-0.03, 0.03, value) : null).filter(Number.isFinite));
  const alignmentGaps = [[ma5, ma10], [ma10, ma20]].map(([short, long]) => short && long ? short / long - 1 : null);
  const alignmentScore = alignmentGaps.every(Number.isFinite) ? average(alignmentGaps.map((value) => 100 * smoothstep(-0.04, 0.04, value))) : null;
  const priceGaps = [ma5, ma10, ma20].map((ma) => close && ma ? close / ma - 1 : null);
  const priceScore = priceGaps.every(Number.isFinite) ? average(priceGaps.map((value) => 100 * smoothstep(-0.08, 0.08, value))) : null;
  const weights = config.trend_subweights;
  const items = [
    detail("ma_direction", "5/10日均线方向", average([slope5, slope10]), directionScore, weights.ma_direction, "ratio"),
    detail("ma_alignment", "5/10/20日均线关系", average(alignmentGaps), alignmentScore, weights.ma_alignment, "ratio"),
    detail("price_vs_ma", "收盘价相对均线", average(priceGaps), priceScore, weights.price_vs_ma, "ratio"),
  ];
  const known = items.filter((item) => Number.isFinite(item.score));
  const availableSubweight = known.reduce((sum, item) => sum + item.weight, 0);
  const knownContribution = known.reduce((sum, item) => sum + item.contribution, 0);
  return {
    score: weightedScore(items), items,
    score_range: { minimum: knownContribution, maximum: knownContribution + 100 - availableSubweight },
    available_subweight_pct: availableSubweight,
    raw: { close, ma5: round(ma5, 4), ma10: round(ma10, 4), ma20: round(ma20, 4), slope5: round(slope5, 6), slope10: round(slope10, 6) },
  };
}

function stockLimitPct(code) {
  return /^(300|301|688)/.test(String(code)) ? 20 : /^(4|8)/.test(String(code)) ? 30 : 10;
}

export function validateStrongPullbackConfig(config) {
  const groups = [config.weights, config.pullback_subweights, config.trend_subweights];
  for (const group of groups) {
    const values = Object.values(group || {}).map(Number);
    if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0) || Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) > 1e-8) {
      throw new Error("评分权重必须为非负数且每组严格合计 100");
    }
  }
  for (const [key, value] of Object.entries(config.windows || {})) {
    if (!Number.isInteger(Number(value)) || Number(value) <= 0 || Number(value) > 500) throw new Error(`观察窗口 ${key} 必须是 1 到 500 的整数`);
  }
  const references = Object.values(config.references || {}).map(Number);
  if (!references.length || references.some((value) => !Number.isFinite(value))) throw new Error("评分参考点必须是有限数值");
  if (!(Number(config.references.breakout_volume_ratio) > 0 && Number(config.references.volume_contraction_ratio) > 0 && Number(config.references.bottom_price_position) >= 0 && Number(config.references.bottom_price_position) <= 1 && Number(config.references.pullback_width_pct) > 0)) throw new Error("评分参考点超出有效范围");
  return config;
}

export function scoreStrongPullback({ stock, rows = [], board = null, config, mode = "close" } = {}) {
  validateStrongPullbackConfig(config);
  const ordered = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const current = ordered.at(-1) || {};
  const issues = [];
  if (!stock?.code) issues.push("missing_stock_code");
  if (!(finite(current.close) > 0 && finite(current.pre_close) > 0)) issues.push("invalid_current_price");
  if (finite(current.raw_volume) === 0) issues.push("suspended_or_invalid_volume");
  if (mode === "close" && !(finite(current.volume) > 0)) issues.push("missing_verified_volume");
  if (ordered.length < config.windows.trend_long_ma_days + 1) issues.push("insufficient_price_history");
  if (mode === "intraday" && !current.intraday_same_time_comparable) issues.push("intraday_same_time_insufficient");
  if (board?.stale) issues.push("stale_sector_score");

  const sectorScore = finite(board?.secondary_score);
  const initiation = scoreInitiationEvents(ordered, config, stockLimitPct(stock?.code));
  const scoringRows = mode === "intraday" && !current.intraday_same_time_comparable
    ? ordered.map((row, index) => index === ordered.length - 1 ? { ...row, volume: null, turnover_rate: null } : row)
    : ordered;
  const pullback = scorePullback(scoringRows, config, mode);
  const trend = scoreTrend(ordered, config);
  const dimensions = [
    { key: "sector_strength", label: "二级板块强度", score: sectorScore, score_range: { minimum: sectorScore ?? 0, maximum: sectorScore ?? 100 }, available_subweight_pct: Number.isFinite(sectorScore) ? 100 : 0, weight: config.weights.sector_strength, contribution: Number.isFinite(sectorScore) ? round(sectorScore * config.weights.sector_strength / 100) : null, raw: board || null, items: [] },
    { key: "recent_initiation", label: "近期启动特征", score: initiation.score, score_range: { minimum: initiation.score ?? 0, maximum: initiation.score ?? 100 }, available_subweight_pct: Number.isFinite(initiation.score) ? 100 : 0, weight: config.weights.recent_initiation, contribution: Number.isFinite(initiation.score) ? round(initiation.score * config.weights.recent_initiation / 100) : null, raw: initiation, items: [] },
    { key: "pullback_quality", label: "回调量价表现", score: pullback.score, score_range: pullback.score_range, available_subweight_pct: pullback.available_subweight_pct, weight: config.weights.pullback_quality, contribution: Number.isFinite(pullback.score) ? round(pullback.score * config.weights.pullback_quality / 100) : null, raw: pullback.raw, items: pullback.items },
    { key: "trend_structure", label: "趋势结构", score: trend.score, score_range: trend.score_range, available_subweight_pct: trend.available_subweight_pct, weight: config.weights.trend_structure, contribution: Number.isFinite(trend.score) ? round(trend.score * config.weights.trend_structure / 100) : null, raw: trend.raw, items: trend.items },
  ];
  const availableWeight = dimensions.reduce((sum, item) => sum + item.weight * item.available_subweight_pct / 100, 0);
  const minimumScore = dimensions.reduce((sum, item) => sum + item.score_range.minimum * item.weight / 100, 0);
  const maximumScore = dimensions.reduce((sum, item) => sum + item.score_range.maximum * item.weight / 100, 0);
  const knownContribution = dimensions.reduce((sum, item) => sum + (item.contribution || 0), 0);
  const full = availableWeight === 100 && !issues.some((issue) => ["invalid_current_price", "suspended_or_invalid_volume", "insufficient_price_history", "intraday_same_time_insufficient", "stale_sector_score"].includes(issue));
  const score = full ? round(knownContribution) : null;
  const missing = dimensions.filter((item) => !Number.isFinite(item.score)).map((item) => item.key);
  const greenFilter = finite(current.change_pct) < 0 && finite(current.change_pct) >= -Math.abs(config.display_filter.maximum_loss_pct);
  return {
    code: String(stock?.code || ""), name: stock?.name || "", mode,
    score, score_range: full ? { minimum: score, maximum: score } : { minimum: round(minimumScore), maximum: round(maximumScore) },
    dimensions, completeness: { available_weight_pct: availableWeight, complete: full, ranking_eligible: full, missing_dimensions: missing, issues },
    display_filter_match: greenFilter,
    market: { date: current.date || null, close: finite(current.close), change_pct: finite(current.change_pct), volume: mode === "intraday" ? finite(current.raw_volume) : finite(current.volume), turnover_rate: finite(current.turnover_rate), intraday_comparison_days: finite(current.intraday_comparison_days) },
    selected_initiation_event: initiation.selected_event,
  };
}
