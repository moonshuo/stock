export const GREEN_LIMIT_UP_SCORE_WEIGHTS = Object.freeze({ trend: .8, tertiary: .2 });

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

// Only complete, date-aligned inputs receive a score.  The route supplies the
// best complete 5-day tertiary score for each stock, preserving its source
// theme and every daily observation for auditability.
export function scoreGreenLimitUpCandidates(candidateInputs = []) {
  const complete = [];
  const unavailable = [];
  for (const input of candidateInputs) {
    // The selection route supplies the configured Python/pandas uptrend score.
    // Keep the legacy calculator only for direct unit callers that do not
    // provide a trend; the production route never silently falls back to it.
    const trend = input.uptrend || trendScore({ price: input.price, closes: input.bars?.map((bar) => bar.price) || [] });
    const tertiary = input.tertiary_score;
    const tertiaryScore = finite(tertiary?.score);
    const missing = [!trend && "上涨趋势评分", tertiaryScore === null && "近 5 日三级板块综合评分"].filter(Boolean);
    if (missing.length) {
      unavailable.push({ code: input.code, name: input.name || "", missing_data: missing });
      continue;
    }
    complete.push({ ...input, trend, tertiary: { ...tertiary, score: tertiaryScore } });
  }
  const scored = complete.map((item) => {
    const total = item.trend.score * GREEN_LIMIT_UP_SCORE_WEIGHTS.trend
      + item.tertiary.score * GREEN_LIMIT_UP_SCORE_WEIGHTS.tertiary;
    return {
      code: item.code, name: item.name, price: item.price, preClose: item.preClose, changePct: item.changePct,
      limit_up_dates: item.limit_up_dates, limit_up_count: item.limit_up_count,
      sector_paths: item.sector_paths || [],
      scores: {
        total,
        trend: item.trend,
        tertiary: item.tertiary,
      },
    };
  }).sort((left, right) => right.scores.total - left.scores.total || right.limit_up_count - left.limit_up_count || left.code.localeCompare(right.code));
  return { scored, unavailable };
}
