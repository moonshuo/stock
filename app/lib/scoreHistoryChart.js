const numericScore = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function buildScoreHistoryChart(history = [], options = {}) {
  const width = Number(options.width) || 560;
  const height = Number(options.height) || 132;
  const padding = { top: 14, right: 12, bottom: 24, left: 30, ...(options.padding || {}) };
  const rows = [...history]
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(String(entry?.date || "")))
    .sort((left, right) => left.date.localeCompare(right.date));
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const xFor = (index) => rows.length <= 1
    ? padding.left + plotWidth / 2
    : padding.left + index / (rows.length - 1) * plotWidth;
  const yFor = (value) => padding.top + (100 - clamp(value, 0, 100)) / 100 * plotHeight;
  const points = rows.map((entry, index) => {
    const score = numericScore(entry?.score?.mainline_rank_score);
    const dailyStrength = numericScore(entry?.daily_strength_score);
    return {
      date: entry.date,
      score,
      dailyStrength,
      x: xFor(index),
      scoreY: score === null ? null : yFor(score),
      dailyStrengthY: dailyStrength === null ? null : yFor(dailyStrength),
    };
  });
  return { width, height, padding, plotWidth, plotHeight, points };
}

export function scoreHistoryLineSegments(points = [], yField) {
  const segments = [];
  let current = [];
  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.[yField])) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push(`${point.x.toFixed(2)},${point[yField].toFixed(2)}`);
  }
  if (current.length) segments.push(current);
  return segments;
}
