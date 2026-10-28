const RECENCY_WEIGHTS = [1, 2, 3, 4, 5];

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const rounded = (value, digits = 6) => Number(value.toFixed(digits));

export function trendScore({ price, closes = [] } = {}) {
  const current = finite(price);
  const values = closes.map(finite).filter((value) => value !== null && value > 0);
  if (!Number.isFinite(current) || current <= 0 || values.length !== 20) return null;
  const ma10 = values.slice(-10).reduce((total, value) => total + value, 0) / 10;
  const priorMa10 = values.slice(0, 10).reduce((total, value) => total + value, 0) / 10;
  const ma20 = values.reduce((total, value) => total + value, 0) / 20;
  const deviationPct = (current / ma10 - 1) * 100;
  const ma10SlopePct = (ma10 / priorMa10 - 1) * 100;
  let downCloseStreak = 0;
  for (let index = values.length - 1; index > 0 && values[index] < values[index - 1]; index -= 1) downCloseStreak += 1;
  const proximityScore = Math.max(0, 100 - Math.abs(deviationPct) * 20);
  const risingStructure = ma10 > ma20 && ma10SlopePct > 0;
  return {
    ma10: rounded(ma10),
    ma20: rounded(ma20),
    deviation_pct: rounded(deviationPct),
    ma10_slope_pct: rounded(ma10SlopePct), down_close_streak: downCloseStreak, rising_structure: risingStructure,
    score: rounded(Math.min(proximityScore, risingStructure ? 100 : 35)),
  };
}

export function weightedRecentTurnover(turnoverRates = []) {
  if (turnoverRates.length !== RECENCY_WEIGHTS.length) return null;
  const values = turnoverRates.map(finite);
  if (values.some((value) => value === null || value < 0)) return null;
  const totalWeight = RECENCY_WEIGHTS.reduce((total, weight) => total + weight, 0);
  return values.reduce((total, value, index) => total + value * RECENCY_WEIGHTS[index], 0) / totalWeight;
}

export function downsideAcceptancePressure({ recentBars = [], turnoverRates = [] } = {}) {
  if (recentBars.length !== 5 || turnoverRates.length !== 5) return null;
  const turnover = turnoverRates.map(finite);
  if (turnover.some((value) => value === null || value < 0)) return null;
  const totalWeight = RECENCY_WEIGHTS.reduce((total, weight) => total + weight, 0);
  let pressure = 0;
  for (let index = 0; index < recentBars.length; index += 1) {
    const bar = recentBars[index] || {};
    const close = finite(bar.price), preClose = finite(bar.preClose);
    if (![close, preClose].every((value) => value !== null) || preClose <= 0) return null;
    // A small decline on low turnover means selling pressure was absorbed;
    // a deep decline with high turnover means chips changed hands under stress.
    const declinePct = Math.max(0, (preClose - close) / preClose * 100);
    pressure += RECENCY_WEIGHTS[index] * declinePct * turnover[index];
  }
  return pressure / totalWeight;
}

function percentileScores(rows, field) {
  const sorted = rows.slice().sort((left, right) => left[field] - right[field] || left.code.localeCompare(right.code));
  if (sorted.length === 1) return new Map([[sorted[0].code, 100]]);
  const scores = new Map();
  let index = 0;
  while (index < sorted.length) {
    let end = index + 1;
    while (end < sorted.length && sorted[end][field] === sorted[index][field]) end += 1;
    const averageRank = (index + end - 1) / 2;
    const score = 100 * (1 - averageRank / (sorted.length - 1));
    for (let cursor = index; cursor < end; cursor += 1) scores.set(sorted[cursor].code, score);
    index = end;
  }
  return scores;
}

// Only complete, date-aligned inputs receive a score.  Turnover and downside
// volume are cross-sectional percentiles: lower weighted turnover / lower
// downside-volume pressure scores higher without hidden fixed thresholds.
export function scoreGreenLimitUpCandidates(candidateInputs = []) {
  const complete = [];
  const unavailable = [];
  for (const input of candidateInputs) {
    const trend = trendScore({ price: input.price, closes: input.bars?.map((bar) => bar.price) || [] });
    const turnover = weightedRecentTurnover(input.turnover_rates || []);
    const volumePressure = downsideAcceptancePressure({ recentBars: input.bars?.slice(-5) || [], turnoverRates: input.turnover_rates || [] });
    const missing = [!trend && "10 日价格", turnover === null && "近 5 日真实换手率", volumePressure === null && "10 日成交量"].filter(Boolean);
    if (missing.length) {
      unavailable.push({ code: input.code, name: input.name || "", missing_data: missing, turnover_errors: (input.turnover_errors || []).filter(Boolean) });
      continue;
    }
    complete.push({ ...input, trend, weighted_turnover_rate: turnover, downside_volume_pressure: volumePressure });
  }
  const turnoverScores = percentileScores(complete, "weighted_turnover_rate");
  const volumeScores = percentileScores(complete, "downside_volume_pressure");
  const scored = complete.map((item) => {
    const turnoverScore = turnoverScores.get(item.code);
    const volumeScore = volumeScores.get(item.code);
    const total = item.trend.score * .4 + turnoverScore * .3 + volumeScore * .3;
    return {
      code: item.code, name: item.name, price: item.price, preClose: item.preClose, changePct: item.changePct,
      limit_up_dates: item.limit_up_dates, limit_up_count: item.limit_up_count,
      scores: {
        total,
        trend: item.trend,
        turnover: { weighted_rate: item.weighted_turnover_rate, score: turnoverScore },
        downside_volume: { pressure: item.downside_volume_pressure, score: volumeScore },
      },
    };
  }).sort((left, right) => right.scores.total - left.scores.total || right.limit_up_count - left.limit_up_count || left.code.localeCompare(right.code));
  return { scored, unavailable };
}
