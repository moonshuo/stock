export function normalizedRelevanceScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
}

export function relevanceAdjustedCoreScore(rawScore, relevanceScore) {
  if (rawScore === null || rawScore === undefined) return null;
  const raw = Number(rawScore);
  if (!Number.isFinite(raw)) return null;
  return Math.round(raw * normalizedRelevanceScore(relevanceScore));
}
