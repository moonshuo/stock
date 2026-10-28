function normalizedScope(scope = {}) {
  return {
    primaries: new Set([scope.primary, ...(scope.primaries || [])].filter(Boolean).map(String)),
    secondary: scope.secondary ? String(scope.secondary) : "",
    tertiary: scope.tertiary ? String(scope.tertiary) : "",
  };
}

function classificationPrimary(stock, classification) {
  return classification?.primary_sector || classification?.primarySector || stock?.primary_sector || "";
}

function matchingClassifications(stock, scope = {}) {
  const target = normalizedScope(scope);
  return (stock?.classifications || []).filter((classification) => {
    const primary = classificationPrimary(stock, classification);
    if (target.primaries.size && !target.primaries.has(primary)) return false;
    if (target.secondary && classification.secondary_sector !== target.secondary) return false;
    if (target.tertiary && !(classification.tertiary_sectors || []).includes(target.tertiary)) return false;
    return true;
  });
}

// A stock can have several directory relationships.  For a single displayed
// directory it contributes through its strongest matching relationship only;
// this avoids counting the same stock twice in a combined primary/collection.
export function relevanceWeightForScope(stock, scope = {}) {
  const matches = matchingClassifications(stock, scope);
  const weights = matches
    .map((classification) => Number(classification.relevance_score))
    .filter(Number.isFinite)
    .map((weight) => Math.max(0, Math.min(1, weight)));
  return weights.length ? Math.max(...weights) : 0;
}

export function relevanceAdjustedAverageChange(stocks = [], quotes = {}, scope = {}, isExcluded = () => false) {
  const seen = new Set();
  const contributions = [];
  for (const stock of stocks) {
    if (!stock?.code || seen.has(stock.code) || isExcluded(stock, quotes)) continue;
    seen.add(stock.code);
    if (!matchingClassifications(stock, scope).length) continue;
    const changePct = Number(quotes?.[stock.code]?.changePct ?? stock.changePct);
    if (!Number.isFinite(changePct)) continue;
    contributions.push(changePct * relevanceWeightForScope(stock, scope));
  }
  if (!contributions.length) return null;
  return contributions.reduce((sum, contribution) => sum + contribution, 0) / contributions.length;
}
